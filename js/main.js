/* SOMA V2.
   One fixed stage. Scroll, arrow keys, a swipe or the rail move one section at a time. The frame
   rules animate to each section's geometry, so lines slide, grow and retract between screens.
   Sections never advance on their own; inside them, the specimen layers, the Hear transcript and
   the Understand steps run on their own clocks. */
(function () {
  "use strict";

  // Where form submissions go. Paste a Formspree (or similar) endpoint here to start receiving them.
  var FORM_ENDPOINT = "";

  var LEAVE_MS = 500;
  var LATE_MS = 320;                     // 09 to 11: how long the old column takes to clear
  var WHEEL_THRESHOLD = 30;
  var SWIPE_THRESHOLD = 50;

  var stage = document.getElementById("stage");
  var board = document.getElementById("board");
  var scenes = Array.prototype.slice.call(board.querySelectorAll(".scene"));
  var railList = board.querySelector(".rail__list");
  var last = scenes.length - 1;
  var REQUEST = scenes.findIndex(function (s) { return s.classList.contains("scene--form"); });
  var SWAP = ["Custom", "Hospitals"].map(function (l) { return scenes.findIndex(function (s) { return s.dataset.label === l; }); });
  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var params = new URLSearchParams(location.search);
  if (params.has("still")) stage.classList.add("no-anim");

  var current = 0;
  var busy = false;

  // ---------- Frame geometry per section, in design pixels ----------
  // The board is 1280 x 832 scaled by k and stretched by DX or DY in the other direction, so each
  // value is written the way Figma constrains it: left or top values stay put, right hand ones
  // add DX, fold and below add DY, the boxed form screens centre.
  // col: an extra vertical rule. col2: a fainter one (08). rows: horizontal rules from col to v2.
  // rx: crosses on the row ends. panel: the paper wash in the right hand column.
  var DX = 0, DY = 0, K = 1, isPhone = false, VW = 1280, VH = 832;
  var BASE_H = 670;                                         // h1 + 1 to fold, in Figma
  // Rules between equal rows: 06 and 07 have four rows (248, 416, 583), 09 has five (215 to 617).
  function split(of) { var out = []; for (var j = 1; j < of; j++) out.push(Math.floor(81 + (BASE_H + DY) * j / of)); return out; }
  function geoFor(i) {
    var g = { v1: 80, v2: 1200 + DX, h1: 80, fold: 751 + DY };
    switch (i) {
      case 0: g.scrim = 1; g.backed = 1; break;                                    // 01 Hero
      case 1: case 2: case 3: case 4: g.scrim = 1; break;                            // 02 to 05
      case 5: case 6: g.col = 365; g.rows = split(4); g.rx = 1; g.panel = 1; break; // 06, 07
      case 7: g.col = 720 + DX; g.col2 = 960 + DX; break;                           // 08 Delivery
      case 8: g.scrim = 1; g.col = 746 + DX; g.rows = split(5); g.panel = 1; break; // 09 Custom
      case 9: g.col = 746 + DX; g.panel = 1; break;                                 // 11 Hospitals
      case 10: g.v1 = 240 + DX / 2; g.v2 = 1040 + DX / 2; g.h1 = 88 + DY / 2; g.fold = 760 + DY / 2; g.noRail = 1; break; // 12 Request
      case 11: g.h1 = 512 + DY; g.noRail = 1; g.backed = 1; break;                  // 13 Footer
    }
    return g;
  }
  // Phones: the board is not scaled, so geometry is in real pixels.
  function phoneGeo(i) {
    var g = geoFor(i);
    var o = { v1: 20, v2: VW - 20, h1: 64, fold: VH - 96, scrim: g.scrim, backed: g.backed, noRail: g.noRail };
    var span = o.fold - o.h1;
    if (i === 5 || i === 6) { o.col = 20; o.colHidden = 1; o.rows = [1, 2, 3].map(function (n) { return Math.round(o.h1 + span * n / 4); }); o.rx = 1; o.panel = 1; }
    if (i === 8) { o.col = 20; o.colHidden = 1; o.rows = [1, 2, 3, 4].map(function (n) { return o.h1 + 1 + 56 * n; }); }
    if (i === 10) o.fold = VH - 24;
    if (i === 11) o.h1 = VH - 300;
    return o;
  }

  var F = {};
  Array.prototype.forEach.call(stage.querySelectorAll(".frame > [data-f]"), function (el) { F[el.dataset.f] = el; });
  var panelEl = stage.querySelector(".panel"), scrimEl = stage.querySelector(".scrim");
  var dpr = window.devicePixelRatio || 1;
  function px(v) { return Math.round(v * K * dpr) / dpr; }             // design px to snapped screen px
  var lastCol = 720, lastCol2 = 960, lastRows = [248, 416, 583, 617];
  function put(el, x, y, sx, sy, o) {
    el.style.transform = "translate(" + x + "px," + y + "px)" + (sx != null ? " scale(" + sx + "," + sy + ")" : "");
    if (o != null) el.style.opacity = o;
  }

  function applyGeometry(i) {
    var g = isPhone ? phoneGeo(i) : geoFor(i);
    if (g.col != null) lastCol = g.col;
    if (g.col2 != null) lastCol2 = g.col2;
    var X1 = px(g.v1), X2 = px(g.v2), Y1 = px(g.h1), Y2 = px(g.fold), C = px(lastCol), C2 = px(lastCol2);
    var len = Math.max(0, Y2 - Y1), colOn = g.col != null && !g.colHidden ? 1 : 0;
    put(F.v1, X1, 0); put(F.v2, X2, 0); put(F.h1, 0, Y1); put(F.fold, 0, Y2);
    put(F.col, C, Y1, 1, len * colOn || 0.0001);
    put(F.col2, C2, Y1, 1, g.col2 != null ? len : 0.0001);
    var rows = g.rows || [];
    for (var r = 0; r < 4; r++) {
      if (rows[r] != null) lastRows[r] = rows[r];
      var w = rows[r] != null ? X2 - C : 0.0001;
      put(F["r" + (r + 1)], X2 - w, px(lastRows[r]), w, 1);
    }
    put(F.tl, X1, Y1); put(F.tr, X2, Y1); put(F.bl, X1, Y2); put(F.br, X2, Y2);
    put(F.ct, C, Y1, null, null, colOn); put(F.cb, C, Y2, null, null, colOn);
    for (var x = 1; x <= 3; x++) put(F["x" + x], X2, px(lastRows[x - 1]), null, null, g.rx ? 1 : 0);
    put(panelEl, C + px(1), Y1 + px(1), Math.max(0, X2 - C - px(1)), Math.max(0, len - px(1)), g.panel ? 1 : 0);
    scrimEl.style.opacity = g.scrim ? 1 : 0;
    board.style.setProperty("--logo-x", isPhone ? 36 : g.v1 + 25);
    board.style.setProperty("--nav-x", isPhone ? -36 : g.v2 - 27 - (1280 + DX));
    stage.classList.toggle("no-rail", !!g.noRail);
    stage.classList.toggle("show-backed", !!g.backed);
  }

  // ---------- Fit the board to the window ----------
  var loaderSegs = [];
  var rebuildWave = null, resizeTimer = 0;
  function layout() {
    var vw = window.innerWidth, vh = window.innerHeight;
    isPhone = vw <= 760; VW = vw; VH = vh;
    dpr = window.devicePixelRatio || 1;
    K = isPhone ? 1 : Math.min(vw / 1280, vh / 832);
    DX = isPhone ? 0 : vw / K - 1280; DY = isPhone ? 0 : vh / K - 832;
    stage.style.setProperty("--k", K);
    board.style.setProperty("--bw", 1280 + DX); board.style.setProperty("--bh", 832 + DY);
    board.style.setProperty("--dx", DX + "px"); board.style.setProperty("--dy", DY + "px");
    stage.classList.add("is-resizing");
    clearTimeout(resizeTimer); resizeTimer = setTimeout(function () { stage.classList.remove("is-resizing"); }, 120);
    applyGeometry(current);
    if (rebuildWave) rebuildWave();
    // Loader: each rule grows out of its two crosses, towards the screen edges and the middle.
    var g = isPhone ? phoneGeo(0) : geoFor(0);
    var X1 = px(g.v1), X2 = px(g.v2), Y1 = px(g.h1), Y2 = px(g.fold);
    [["tl", X1, Y1], ["tr", X2, Y1], ["bl", X1, Y2], ["br", X2, Y2]].forEach(function (c) {
      var el = document.querySelector("#loader .cross--" + c[0]);
      if (el) { el.style.left = c[1] + "px"; el.style.top = c[2] + "px"; }
    });
    var cnt = document.querySelector(".loader__count");
    cnt.style.left = (isPhone ? 36 : px(105)) + "px";
    cnt.style.top = (isPhone ? vh - 152 : px(671 + DY)) + "px";
    var mx = (X1 + X2) / 2, my = (Y1 + Y2) / 2;
    loaderSegs.forEach(function (sg) {
      var st = sg.el.style;
      if (sg.h) {
        var y = sg.line === "h1" ? Y1 : Y2;
        st.top = y + "px"; st.height = "1px";
        if (sg.part === 0) { st.left = "0px"; st.width = X1 + "px"; st.transformOrigin = "100% 50%"; }
        if (sg.part === 1) { st.left = X1 + "px"; st.width = (mx - X1) + "px"; st.transformOrigin = "0 50%"; }
        if (sg.part === 2) { st.left = mx + "px"; st.width = (X2 - mx) + "px"; st.transformOrigin = "100% 50%"; }
        if (sg.part === 3) { st.left = X2 + "px"; st.width = (vw - X2) + "px"; st.transformOrigin = "0 50%"; }
      } else {
        var x = sg.line === "v1" ? X1 : X2;
        st.left = x + "px"; st.width = "1px";
        if (sg.part === 0) { st.top = "0px"; st.height = Y1 + "px"; st.transformOrigin = "50% 100%"; }
        if (sg.part === 1) { st.top = Y1 + "px"; st.height = (my - Y1) + "px"; st.transformOrigin = "50% 0"; }
        if (sg.part === 2) { st.top = my + "px"; st.height = (Y2 - my) + "px"; st.transformOrigin = "50% 100%"; }
        if (sg.part === 3) { st.top = Y2 + "px"; st.height = (vh - Y2) + "px"; st.transformOrigin = "50% 0"; }
      }
    });
  }

  // ---------- Rail ----------
  var railItems = scenes.map(function (scene, i) {
    if (i === 0 || i >= REQUEST) return null;
    var li = document.createElement("li");
    var b = document.createElement("button");
    b.type = "button";
    b.className = "rail__item t-caps14";
    b.setAttribute("aria-label", scene.dataset.label);
    var label = document.createElement("span");
    label.className = "rail__label";
    label.textContent = scene.dataset.label;
    b.appendChild(label);
    b.addEventListener("click", function () { go(i); });
    li.appendChild(b);
    railList.appendChild(li);
    return b;
  });
  function syncRail() {
    railItems.forEach(function (b, i) {
      if (!b) return;
      var on = i === current;
      b.classList.toggle("is-current", on);
      if (on) b.setAttribute("aria-current", "step"); else b.removeAttribute("aria-current");
    });
  }

  // ---------- Media ----------
  var medias = Array.prototype.slice.call(stage.querySelectorAll(".media-layer > [data-scene]"));
  function mediaFor(i) { return medias.filter(function (m) { return +m.dataset.scene === i; })[0]; }
  function videosIn(el) { return el ? Array.prototype.slice.call(el.querySelectorAll("video")) : []; }
  // Reduce Motion still plays the clips: they are what the page shows. It only cuts the slides.
  // A browser that refuses to start a muted clip on its own (Low Power Mode, data saver) gets it
  // started by the visitor's first tap, click or key.
  var blocked = false;
  function play(v) {
    var p = v.play();
    if (p && p.catch) p.catch(function (err) { if (err && err.name === "NotAllowedError") blocked = true; });
  }
  ["touchend", "click", "keydown"].forEach(function (t) {
    document.addEventListener(t, function () {
      if (!blocked) return; blocked = false;
      videosIn(mediaFor(current)).forEach(function (v) { if (current !== 1 || v.classList.contains("is-shown")) play(v); });
    }, true);
  });
  // Buffer a clip ahead of time without restarting a download that is already running.
  function warm(i) {
    videosIn(mediaFor(i)).forEach(function (v) {
      if (v.preload === "auto") return;
      v.preload = "auto";
      if (v.readyState < 2 && v.networkState !== 2) v.load();
    });
  }
  // A clip that fails to load gets one more try.
  medias.forEach(function (m) {
    videosIn(m).forEach(function (v) {
      var tried = false;
      v.addEventListener("error", function () {
        if (tried) return; tried = true;
        setTimeout(function () { v.load(); if (+m.dataset.scene === current && current !== 1) play(v); }, 1500);
      });
    });
  });

  function showMedia(next, prev) {
    var to = mediaFor(next), from = mediaFor(prev);
    medias.forEach(function (m) { if (m !== to && m !== from) m.classList.remove("is-on", "is-leaving"); });
    if (from && from !== to) {
      from.classList.remove("is-on"); from.classList.add("is-leaving");
      setTimeout(function () { from.classList.remove("is-leaving"); if (mediaFor(current) !== from) videosIn(from).forEach(function (v) { v.pause(); }); }, LEAVE_MS);
    }
    // Looping clips carry on from where they were; no seek, so nothing stalls on the way in.
    if (to) { to.classList.add("is-on"); if (next !== 1) videosIn(to).forEach(play); }
    warm(next + 1);
  }

  // ---------- Section controllers ----------
  var controllers = {};

  // 02 Specimen: five layers, each one play of the clip; the underline under the active layer
  // fills as the clip plays, and the next layer starts when the clip ends. Every layer changes
  // more than the footage: the readout under the clock, its overlay, and the band's figures.
  (function () {
    var scene = scenes[1];
    var raw = stage.querySelector(".spec-vid--raw"), ann = stage.querySelector(".spec-vid--annotated");
    var toggles = Array.prototype.slice.call(scene.querySelectorAll(".toggle"));
    var layers = Array.prototype.slice.call(scene.querySelectorAll(".spec-layer, .readout__item"));
    var metrics = scene.querySelector(".metrics");
    var chips = Array.prototype.slice.call(metrics.children);
    var clock = document.getElementById("spec-clock");
    var capsEl = document.getElementById("spec-captions");
    var phasesEl = document.getElementById("spec-phases");
    var NOW = 6;                                           // phase 07 of 11
    for (var n = 0; n < 11; n++) { var seg = document.createElement("i"); if (n < NOW) seg.className = "is-done"; if (n === NOW) seg.className = "is-now"; phasesEl.appendChild(seg); }
    var nowSeg = phasesEl.children[NOW];
    var CAPS = [["00:42:12 · Surgeon", "Prepare the graft."], ["00:42:14 · Assistant", "Graft ready."], ["00:42:16 · Surgeon", "Hold here."]];
    var layer = 0, active = false, raf = 0, v = raw, capIdx = -1;
    function videoFor(l) { return l === 1 ? ann : raw; }
    function caption(i) {
      capsEl.innerHTML = "";
      [i - 1, i].forEach(function (j) {
        if (j < 0) return;
        var li = document.createElement("li"); if (j < i) li.className = "is-prev";
        li.innerHTML = '<span class="who t-caps12"></span><span class="said"></span>';
        li.children[0].textContent = CAPS[j][0]; li.children[1].textContent = CAPS[j][1];
        capsEl.appendChild(li);
      });
    }
    function set(l) {
      layer = l; capIdx = -1;
      var nv = videoFor(l);
      [raw, ann].forEach(function (x) { if (x !== nv) { x.pause(); x.classList.remove("is-shown"); } });
      v = nv; v.classList.add("is-shown");
      try { v.currentTime = 0; } catch (e) {}
      play(v);
      toggles.forEach(function (t, i) { t.classList.toggle("is-active", i === l); t.setAttribute("aria-selected", i === l); t.style.setProperty("--progress", 0); });
      layers.forEach(function (x) { x.classList.toggle("is-on", +x.dataset.layer === l); });
      var any = false;
      chips.forEach(function (c) { var on = +c.dataset.for === l; c.classList.toggle("is-hl", on); any = any || on; });
      metrics.classList.toggle("is-focused", any);
      nowSeg.style.setProperty("--p", 0);
    }
    function tick() {
      if (!active) return;
      var d = isFinite(v.duration) && v.duration > 0 ? v.duration : 5.5;
      var p = Math.min(1, v.currentTime / d);
      var t = toggles[layer]; if (t) t.style.setProperty("--progress", p.toFixed(4));
      var sec = 12 + Math.floor(v.currentTime);
      clock.textContent = "00:42:" + (sec < 10 ? "0" : "") + sec;
      if (layer === 3) nowSeg.style.setProperty("--p", p.toFixed(4));
      if (layer === 4) { var c = Math.min(CAPS.length - 1, Math.floor(p * CAPS.length)); if (c !== capIdx) { capIdx = c; caption(c); } }
      raf = requestAnimationFrame(tick);
    }
    [raw, ann].forEach(function (x) { x.addEventListener("ended", function () { if (active && x === v) set((layer + 1) % toggles.length); }); });
    toggles.forEach(function (t, i) { t.addEventListener("click", function () { set(i); }); });
    controllers[1] = {
      enter: function () { active = true; set(0); cancelAnimationFrame(raf); raf = requestAnimationFrame(tick); },
      leave: function () { active = false; cancelAnimationFrame(raf); setTimeout(function () { if (current !== 1) { raw.pause(); ann.pause(); } }, LEAVE_MS); }
    };
  })();

  // 04 Hear: the waveform plays like an audio player (visual only). The playhead crosses it,
  // bars before it light up, and the transcript scrolls so the line being spoken holds its slot.
  (function () {
    var barsEl = document.getElementById("wave-bars");
    var ph = document.getElementById("playhead"), phTime = document.getElementById("playhead-time");
    var box = document.getElementById("transcript"), list = box.querySelector(".transcript__list");
    var lines = Array.prototype.slice.call(list.children);
    var W = 0, BAR = 5, LOOP = 12000, FIRST = 2;           // lines[2] is spoken over the first speaker cell
    var SEG0 = [[0, 321], [321, 643], [643, 954], [954, 1088]];   // speaker cells from Figma, at 1088 wide
    var SEG = SEG0, bars = [];
    var active = false, raf = 0, t0 = 0, lastIdx = -1, lastBar = -1;
    rebuildWave = function () {
      var w = barsEl.offsetWidth || 1088;
      if (bars.length && Math.abs(w - W) < 2) return;
      W = w;
      var f = W / 1088;
      SEG = SEG0.map(function (s) { return [s[0] * f, s[1] * f]; });
      barsEl.innerHTML = ""; bars = []; lastBar = -1;
      var N = Math.floor(W / BAR);
      for (var i = 0; i < N; i++) {
        var x = i * BAR, inSeg = SEG.some(function (s) { return x >= s[0] + 8 && x < s[1] - 30 * f; });
        var speech = inSeg && Math.sin(i * 0.19) > -0.35;
        var h = speech ? 6 + Math.abs(Math.sin(i * 1.7)) * 12 + Math.abs(Math.sin(i * 0.37)) * 8 : 2;
        var b = document.createElement("i"); b.style.height = Math.round(h) + "px";
        barsEl.appendChild(b); bars.push(b);
      }
    };
    rebuildWave();
    function speak(idx, jump) {
      var a = FIRST + idx;                                  // the active line sits in the third slot
      list.classList.toggle("is-jump", !!jump);
      list.style.setProperty("--row", a - 2);
      lines.forEach(function (l, j) {
        var rel = j - a;
        l.className = rel === 0 ? "is-active" : rel === -1 ? "is-past" : rel === -2 ? "is-far" : rel === 1 ? "is-next" : "";
      });
      if (jump) { box.classList.remove("is-reset"); void box.offsetWidth; box.classList.add("is-reset"); requestAnimationFrame(function () { list.classList.remove("is-jump"); }); }
    }
    function tick(now) {
      if (!active) return;
      var t = ((now - t0) % LOOP) / LOOP, x = t * W;
      ph.style.transform = "translateX(" + x.toFixed(1) + "px)";
      var sec = 12 + Math.floor(t * 12);
      phTime.textContent = "00:42:" + (sec < 10 ? "0" : "") + sec;
      var upto = Math.floor(x / BAR);
      if (upto !== lastBar) {
        if (upto < lastBar) { for (var j = 0; j < bars.length; j++) bars[j].classList.toggle("is-played", j <= upto); }
        else for (var k = Math.max(0, lastBar + 1); k <= upto && k < bars.length; k++) bars[k].classList.add("is-played");
        lastBar = upto;
      }
      var idx = SEG.findIndex(function (s) { return x >= s[0] && x < s[1]; });
      if (idx !== lastIdx && idx > -1) { speak(idx, idx < lastIdx || lastIdx === -1); lastIdx = idx; }
      raf = requestAnimationFrame(tick);
    }
    controllers[3] = {
      enter: function () { active = true; t0 = performance.now(); lastIdx = -1; lastBar = -1; bars.forEach(function (b) { b.classList.remove("is-played"); }); raf = requestAnimationFrame(tick); },
      leave: function () { active = false; cancelAnimationFrame(raf); }
    };
  })();

  // 05 Understand: the five steps light up in order, and the phase loader moves with them.
  (function () {
    var steps = Array.prototype.slice.call(document.querySelectorAll("#understand-steps span"));
    var seg = document.getElementById("understand-seg");
    var STEP_MS = 2400, timer = 0, i = 0;
    function show() {
      steps.forEach(function (s, j) { s.classList.toggle("is-done", j < i); s.classList.toggle("is-active", j === i); });
      seg.style.setProperty("--seg", Math.round((270 - 40) * i / (steps.length - 1)) + "px");
    }
    controllers[4] = {
      enter: function () { i = 0; show(); clearInterval(timer); timer = setInterval(function () { i = (i + 1) % steps.length; show(); }, STEP_MS); },
      leave: function () { clearInterval(timer); }
    };
  })();

  // 08 Delivery: hovering or clicking a file moves the highlight and swaps the preview.
  (function () {
    var tree = document.getElementById("tree");
    var files = Array.prototype.slice.call(tree.querySelectorAll(".file"));
    var nameEl = document.getElementById("preview-name"), body = document.getElementById("preview-body");
    var THUMBS = { "surgeon_pov.mp4": "02-egocentric", "scope.mp4": "04-fine-motion", "room.mp4": "03-multiview" };
    function hash(s) { var h = 0; for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return h; }
    function render(btn) {
      var name = btn.textContent.trim(), kind = btn.dataset.kind;
      nameEl.textContent = name;
      body.innerHTML = "";
      if (kind === "mp4") {
        var img = document.createElement("img"); img.className = "preview__thumb"; img.alt = ""; img.src = "assets/video/" + THUMBS[name] + ".jpg?v=3"; body.appendChild(img);
      } else if (kind === "wav") {
        var w = document.createElement("div"); w.className = "preview__wave";
        var hs = hash(name);
        for (var i = 0; i < 48; i++) { var b = document.createElement("i"); b.style.height = (4 + Math.abs(Math.sin(i * 0.9 + hs % 7)) * 40 * (Math.sin(i * 0.23 + hs % 3) > -0.3 ? 1 : 0.2)) + "px"; w.appendChild(b); }
        body.appendChild(w);
      } else if (kind === "folder") {
        var idx = files.indexOf(btn);
        for (var j = idx + 1; j < files.length && !files[j].classList.contains("is-folder") && !files[j].classList.contains("is-root"); j++) {
          var d = document.createElement("div"); d.className = "t-b14 c-sec"; d.textContent = files[j].textContent; body.appendChild(d);
        }
      } else {
        var h = hash(name);
        for (var r = 0; r < 14; r++) {
          var line = document.createElement("div"); line.className = "line";
          var indent = [0, 1, 2, 2, 2, 2, 1, 1, 2, 2, 2, 1, 1, 0][r];
          line.style.paddingLeft = (indent * 14) + "px";
          var k = document.createElement("span"); k.className = "k"; k.style.width = (40 + ((h >> (r % 16)) + r * 37) % 50) + "px";
          var v = document.createElement("span"); v.className = "v"; v.style.width = (30 + ((h >> ((r + 5) % 16)) + r * 53) % 70) + "px";
          line.appendChild(k); line.appendChild(v); body.appendChild(line);
        }
      }
    }
    var selected = tree.querySelector(".file.is-selected");
    files.forEach(function (f) {
      f.addEventListener("mouseenter", function () { render(f); });
      f.addEventListener("focus", function () { render(f); });
      f.addEventListener("click", function () { selected.classList.remove("is-selected"); selected = f; f.classList.add("is-selected"); render(f); });
    });
    tree.addEventListener("mouseleave", function () { render(selected); });
    render(selected);
  })();

  // ---------- Moving between sections ----------
  function go(next) {
    if (next === "request") next = REQUEST;
    next = Math.max(0, Math.min(last, next));
    if (next === current || busy) return;
    var from = scenes[current], to = scenes[next], prev = current;
    scenes.forEach(function (s) { if (s !== from) s.classList.remove("is-leaving", "is-quick"); s.classList.remove("is-late"); });
    // 09 and 11 share the right hand column: the old column clears first, then the new one rises in.
    var late = !reduceMotion && ((prev === SWAP[0] && next === SWAP[1]) || (prev === SWAP[1] && next === SWAP[0])) ? LATE_MS : 0;
    to.style.setProperty("--late", late + "ms");
    from.classList.remove("is-active"); from.classList.add("is-leaving");
    from.classList.toggle("is-quick", !!late);
    to.classList.toggle("is-late", !!late);
    to.classList.add("is-active");
    if (controllers[prev]) controllers[prev].leave();
    current = next;
    busy = true;
    setState();
    showMedia(next, prev);
    if (controllers[next]) controllers[next].enter();
    setTimeout(function () { from.classList.remove("is-leaving", "is-quick"); busy = false; }, reduceMotion ? 50 : LEAVE_MS + late);
  }

  function setState() {
    applyGeometry(current);
    scenes.forEach(function (s, i) {
      var on = i === current;
      s.setAttribute("aria-hidden", on ? "false" : "true");
      if ("inert" in s) s.inert = !on;
    });
    syncRail();
  }

  // ---------- Input ----------
  var wheelSum = 0, wheelQuietTimer = null, wheelLocked = false;
  stage.addEventListener("wheel", function (e) {
    e.preventDefault();
    clearTimeout(wheelQuietTimer);
    wheelQuietTimer = setTimeout(function () { wheelLocked = false; wheelSum = 0; }, 180);
    if (wheelLocked || busy) return;
    wheelSum += e.deltaY;
    if (Math.abs(wheelSum) >= WHEEL_THRESHOLD) { go(current + (wheelSum > 0 ? 1 : -1)); wheelLocked = true; wheelSum = 0; }
  }, { passive: false });

  var touchY = null;
  stage.addEventListener("touchstart", function (e) { touchY = e.touches[0].clientY; }, { passive: true });
  stage.addEventListener("touchend", function (e) {
    if (touchY === null) return;
    var dy = touchY - e.changedTouches[0].clientY; touchY = null;
    if (Math.abs(dy) > SWIPE_THRESHOLD) go(current + (dy > 0 ? 1 : -1));
  });

  document.addEventListener("keydown", function (e) {
    var t = e.target;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT")) return;
    if (["ArrowDown", "PageDown", " "].indexOf(e.key) > -1) { e.preventDefault(); go(current + 1); }
    else if (["ArrowUp", "PageUp"].indexOf(e.key) > -1) { e.preventDefault(); go(current - 1); }
    else if (e.key === "Home") { e.preventDefault(); go(0); }
    else if (e.key === "End") { e.preventDefault(); go(last); }
  });

  document.querySelectorAll("[data-goto]").forEach(function (el) {
    el.addEventListener("click", function (e) {
      e.preventDefault();
      var g = el.dataset.goto;
      go(g === "request" ? "request" : parseInt(g, 10));
    });
  });

  document.addEventListener("visibilitychange", function () {
    var m = mediaFor(current);
    if (document.hidden) { videosIn(m).forEach(function (v) { v.pause(); }); if (controllers[current]) controllers[current].leave(); }
    else { if (current !== 1) videosIn(m).forEach(play); if (controllers[current]) controllers[current].enter(); }
  });

  // ---------- Form ----------
  var form = document.getElementById("request-form");
  var status = form.querySelector(".form__status");
  var done = document.getElementById("form-done");
  form.addEventListener("submit", function (e) {
    e.preventDefault();
    var ok = true;
    ["name", "email", "building"].forEach(function (n) {
      var input = form.elements[n];
      var bad = !input.value.trim() || (n === "email" && !/^\S+@\S+\.\S+$/.test(input.value));
      input.closest(".field").classList.toggle("is-invalid", bad);
      if (bad) ok = false;
    });
    if (!ok) { status.textContent = "Please add your name, a valid work email and what you are building."; return; }
    if (!FORM_ENDPOINT) { status.textContent = "Thanks. This form is not connected yet, so nothing was sent."; return; }
    status.textContent = "Sending…";
    fetch(FORM_ENDPOINT, { method: "POST", headers: { Accept: "application/json" }, body: new FormData(form) })
      .then(function (r) {
        if (!r.ok) throw new Error(r.status);
        form.reset(); form.hidden = true; done.hidden = false; status.textContent = "";
      })
      .catch(function () { status.textContent = "Something went wrong. Please try again."; });
  });

  // ---------- Start ----------
  var loader = document.getElementById("loader");
  ["h1", "fold"].forEach(function (line) { for (var p = 0; p < 4; p++) { var e = document.createElement("span"); e.className = "seg seg--h"; loader.insertBefore(e, loader.firstChild); loaderSegs.push({ el: e, h: 1, line: line, part: p }); } });
  ["v1", "v2"].forEach(function (line) { for (var p = 0; p < 4; p++) { var e = document.createElement("span"); e.className = "seg seg--v"; loader.insertBefore(e, loader.firstChild); loaderSegs.push({ el: e, h: 0, line: line, part: p }); } });
  loader.querySelectorAll(".seg--h1, .seg--fold, .seg--v1, .seg--v2").forEach(function (e) { e.remove(); });
  layout();
  window.addEventListener("resize", layout);

  var startAt = parseInt(params.get("s"), 10);
  if (startAt > 0 && startAt <= last) { scenes[0].classList.remove("is-active"); scenes[startAt].classList.add("is-active"); current = startAt; }
  setState();

  function begin() {
    showMedia(current, -1);
    if (controllers[current]) controllers[current].enter();
    // Warm the rest, in order, once the first section is playing.
    var order = medias.map(function (m) { return +m.dataset.scene; }).filter(function (i) { return i !== current; });
    (function nextInQueue() {
      var i = order.shift(); if (i === undefined) return;
      var vs = videosIn(mediaFor(i)), left = vs.length;
      if (!left) return nextInQueue();
      vs.forEach(function (v) {
        var fin = function () { v.removeEventListener("canplaythrough", fin); v.removeEventListener("error", fin); if (--left === 0) nextInQueue(); };
        if (v.readyState >= 4) return fin();
        v.addEventListener("canplaythrough", fin); v.addEventListener("error", fin);
        if (v.preload !== "auto") { v.preload = "auto"; v.load(); }
      });
    })();
  }

  // Loader: the rules grow out of the four crosses while a count runs to 100.
  var LOADER_MS = 2200, LOADER_MAX_MS = 10000;
  var countEl = document.getElementById("loader-count");
  var firstVideos = videosIn(mediaFor(current));
  firstVideos.forEach(function (v) { v.preload = "auto"; });
  var fontsDone = false;
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { fontsDone = true; }); else fontsDone = true;
  function assetsReady() { return fontsDone && firstVideos.every(function (v) { return v.readyState >= 3; }); }
  function easeOutCubic(x) { return 1 - Math.pow(1 - x, 3); }

  if (params.has("noload") || reduceMotion) { loader.classList.add("is-done"); begin(); }
  else {
    var t0 = performance.now(), shown = 0, finished = false;
    var finish = function () {
      if (finished) return; finished = true;
      loader.style.setProperty("--p", "1"); countEl.textContent = "100"; loader.setAttribute("aria-valuenow", 100);
      setTimeout(function () { loader.classList.add("is-done"); begin(); }, 250);
    };
    setTimeout(finish, LOADER_MAX_MS + 1000);
    (function tick(now) {
      if (finished) return;
      var elapsed = now - t0, curve = easeOutCubic(Math.min(1, elapsed / LOADER_MS)), goal;
      if (assetsReady() || elapsed > LOADER_MAX_MS) goal = curve;
      else goal = 0.9 * curve + 0.08 * (1 - Math.exp(-Math.max(0, elapsed - LOADER_MS) / 2500));
      shown += (goal - shown) * 0.25;
      if (goal >= 1 && shown > 0.998) shown = 1;
      loader.style.setProperty("--p", shown.toFixed(4));
      var pct = Math.floor(shown * 100);
      countEl.textContent = pct; loader.setAttribute("aria-valuenow", pct);
      if (shown < 1) return requestAnimationFrame(tick);
      finish();
    })(t0);
  }
})();
