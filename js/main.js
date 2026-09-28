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
  var WHEEL_THRESHOLD = 30;
  var SWIPE_THRESHOLD = 50;

  var stage = document.getElementById("stage");
  var board = document.getElementById("board");
  var scenes = Array.prototype.slice.call(board.querySelectorAll(".scene"));
  var railList = board.querySelector(".rail__list");
  var last = scenes.length - 1;
  var REQUEST = scenes.findIndex(function (s) { return s.classList.contains("scene--form"); });
  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var params = new URLSearchParams(location.search);
  if (params.has("still")) stage.classList.add("no-anim");

  var current = 0;
  var busy = false;

  // ---------- Frame geometry per section, in design pixels ----------
  // col: an extra vertical rule (drawn in, or retracted when a section has none).
  // col2: a second, fainter rule (08). rows: horizontal rules from col to v2. rx: crosses on row ends.
  var BASE = { v1: 80, v2: 1200, h1: 80, fold: 751 };
  var GEO = [
    { scrim: 1, backed: 1 },                                              // 01 Hero
    { scrim: 1 },                                                         // 02 Specimen
    { scrim: 1 },                                                         // 03 See
    { scrim: 1 },                                                         // 04 Hear
    { scrim: 1 },                                                         // 05 Understand
    { col: 365, rows: [248, 416, 583], rx: 1, panel: 1 },                 // 06 Data scale
    { col: 380, rows: [248, 416, 583], rx: 1, panel: 1 },                 // 07 Available data
    { col: 720, col2: 960 },                                              // 08 Delivery
    { scrim: 1, col: 746, rows: [215, 349, 483, 617], panel: 1 },         // 09 Custom collection
    { col: 720, panel: 1 },                                               // 11 Hospitals
    { v1: 240, v2: 1040, h1: 88, fold: 760, noRail: 1 },                  // 12 Request
    { h1: 512, noRail: 1, backed: 1 }                                     // 13 Footer
  ];
  var lastCol = 720, lastCol2 = 960, lastRows = [248, 416, 583, 617];
  var isPhone = false, VW = 1280, VH = 832;
  var rebuildWave = null;

  // Phones: the board is not scaled, so geometry is in real pixels.
  function phoneGeo(i) {
    var g = GEO[i] || {};
    var o = { v1: 20, v2: VW - 20, h1: 64, fold: VH - 96, scrim: g.scrim, backed: g.backed, noRail: g.noRail };
    var span = o.fold - o.h1;
    if (i === 5 || i === 6) { o.col = 20; o.colHidden = 1; o.rows = [1, 2, 3].map(function (n) { return Math.round(o.h1 + span * n / 4); }); o.rx = 1; o.panel = 1; }
    if (i === 8) { o.col = 20; o.colHidden = 1; o.rows = [1, 2, 3, 4].map(function (n) { return o.h1 + 1 + 56 * n; }); }
    if (i === 10) o.fold = VH - 24;
    if (i === 11) o.h1 = VH - 300;
    return o;
  }

  function applyGeometry(i) {
    var g = isPhone ? phoneGeo(i) : (GEO[i] || {});
    var s = stage.style;
    ["v1", "v2", "h1", "fold"].forEach(function (k) { s.setProperty("--" + k, g[k] != null ? g[k] : BASE[k]); });
    if (g.col != null) lastCol = g.col;
    if (g.col2 != null) lastCol2 = g.col2;
    s.setProperty("--col", lastCol);
    s.setProperty("--col-d", g.col != null && !g.colHidden ? 1 : 0);
    s.setProperty("--col2", lastCol2);
    s.setProperty("--col2-d", g.col2 != null ? 1 : 0);
    var rows = g.rows || [];
    for (var r = 0; r < 4; r++) {
      if (rows[r] != null) lastRows[r] = rows[r];
      s.setProperty("--r" + (r + 1), lastRows[r]);
      s.setProperty("--r" + (r + 1) + "-d", rows[r] != null ? 1 : 0);
    }
    s.setProperty("--rx-d", g.rx ? 1 : 0);
    s.setProperty("--panel-o", g.panel ? 1 : 0);
    s.setProperty("--scrim-o", g.scrim ? 1 : 0);
    stage.classList.toggle("no-rail", !!g.noRail);
    stage.classList.toggle("show-backed", !!g.backed);
  }

  // ---------- Fit the 1280 x 832 board to the window ----------
  var loaderSegs = [];
  function layout() {
    var vw = window.innerWidth, vh = window.innerHeight;
    isPhone = vw <= 760; VW = vw; VH = vh;
    var k = isPhone ? 1 : Math.min(vw / 1280, vh / 832);
    var ox = isPhone ? 0 : (vw - 1280 * k) / 2, oy = isPhone ? 0 : (vh - 832 * k) / 2;
    stage.style.setProperty("--k", k);
    stage.style.setProperty("--ox", ox);
    stage.style.setProperty("--oy", oy);
    applyGeometry(current);
    if (rebuildWave) rebuildWave();
    // Loader segments: each rule grows out of its two crosses, towards the screen edges and
    // towards the middle, and meets itself at 100%.
    var X1 = isPhone ? 20 : ox + 80 * k, X2 = isPhone ? vw - 20 : ox + 1200 * k, Y1 = isPhone ? 64 : oy + 80 * k, Y2 = isPhone ? vh - 96 : oy + 751 * k;
    [["tl", X1, Y1], ["tr", X2, Y1], ["bl", X1, Y2], ["br", X2, Y2]].forEach(function (c) {
      var el = document.querySelector("#loader .cross--" + c[0]);
      if (el) { el.style.left = c[1] + "px"; el.style.top = c[2] + "px"; }
    });
    var mx = (X1 + X2) / 2, my = (Y1 + Y2) / 2;
    loaderSegs.forEach(function (sg) {
      var e = sg.el, st = e.style;
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
  function play(v) { if (reduceMotion) return; var p = v.play(); if (p && p.catch) p.catch(function () {}); }
  function warm(i) { videosIn(mediaFor(i)).forEach(function (v) { if (v.preload !== "auto") { v.preload = "auto"; v.load(); } }); }

  function showMedia(next, prev) {
    var to = mediaFor(next), from = mediaFor(prev);
    medias.forEach(function (m) { if (m !== to && m !== from) m.classList.remove("is-on", "is-leaving"); });
    if (from && from !== to) { from.classList.remove("is-on"); from.classList.add("is-leaving"); setTimeout(function () { from.classList.remove("is-leaving"); videosIn(from).forEach(function (v) { if (+from.dataset.scene !== current) v.pause(); }); }, LEAVE_MS); }
    if (to) { to.classList.add("is-on"); if (next !== 1) videosIn(to).forEach(function (v) { if (v.currentTime > 0.05) try { v.currentTime = 0; } catch (e) {} play(v); }); }
    warm(next + 1);
  }

  // ---------- Section controllers ----------
  var controllers = {};

  // 02 Specimen: five layers, each one play of the clip; the underline under the active layer
  // fills as the clip plays, and the next layer starts when the clip ends.
  (function () {
    var scene = scenes[1];
    var raw = stage.querySelector(".spec-vid--raw"), ann = stage.querySelector(".spec-vid--annotated");
    var toggles = Array.prototype.slice.call(scene.querySelectorAll(".toggle"));
    var layers = Array.prototype.slice.call(scene.querySelectorAll(".spec-layer"));
    var clock = document.getElementById("spec-clock");
    var capWho = document.getElementById("spec-cap-who"), capLine = document.getElementById("spec-cap-line");
    var phaseSeg = scene.querySelector(".spec-layer--phase .phase-track i");
    var CAPS = [["00:42:12 · Surgeon", "Prepare the graft."], ["00:42:15 · Assistant", "Graft ready."], ["00:42:18 · Surgeon", "Hold here."]];
    var layer = 0, active = false, raf = 0, v = raw;
    function videoFor(l) { return l === 1 ? ann : raw; }
    function set(l) {
      layer = l;
      var nv = videoFor(l);
      [raw, ann].forEach(function (x) { if (x !== nv) { x.pause(); x.classList.remove("is-shown"); } });
      v = nv; v.classList.add("is-shown");
      try { v.currentTime = 0; } catch (e) {}
      play(v);
      toggles.forEach(function (t, i) { t.classList.toggle("is-active", i === l); t.setAttribute("aria-selected", i === l); t.style.setProperty("--progress", 0); });
      layers.forEach(function (x) { x.classList.toggle("is-on", +x.dataset.layer === l); });
    }
    function tick() {
      if (!active) return;
      var d = isFinite(v.duration) && v.duration > 0 ? v.duration : 5.5;
      var p = Math.min(1, v.currentTime / d);
      var t = toggles[layer]; if (t) t.style.setProperty("--progress", p.toFixed(4));
      var sec = 12 + Math.floor(v.currentTime);
      clock.textContent = "00:42:" + (sec < 10 ? "0" : "") + sec;
      if (layer === 4) { var c = CAPS[Math.min(CAPS.length - 1, Math.floor(p * CAPS.length))]; if (capLine.textContent !== c[1]) { capWho.textContent = c[0]; capLine.textContent = c[1]; } }
      if (layer === 3) phaseSeg.style.setProperty("--seg", Math.round(p * 230) + "px");
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
  // bars before it light up, and the transcript follows the speaker under the playhead.
  (function () {
    var scene = scenes[3];
    var barsEl = document.getElementById("wave-bars");
    var ph = document.getElementById("playhead"), phTime = document.getElementById("playhead-time");
    var lines = Array.prototype.slice.call(document.querySelectorAll("#transcript li"));
    var W = 0, BAR = 5, LOOP = 12000;
    var SEG0 = [[0, 321], [321, 643], [643, 954], [954, 1088]];   // speaker cells from Figma, at 1088 wide
    var SEG = SEG0, bars = [];
    var active = false, raf = 0, t0 = 0, lastIdx = -1, lastBar = -1;
    // Bars are built to the waveform's real width (1088 on the board, the screen width on phones).
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
    function tick(now) {
      if (!active) return;
      var t = ((now - t0) % LOOP) / LOOP, px = t * W;
      ph.style.setProperty("--ph", px.toFixed(1) + "px");
      var sec = 12 + Math.floor(t * 12);
      phTime.textContent = "00:42:" + (sec < 10 ? "0" : "") + sec;
      var upto = Math.floor(px / BAR);
      if (upto !== lastBar) { bars.forEach(function (b, j) { b.classList.toggle("is-played", j <= upto); }); lastBar = upto; }
      var idx = SEG.findIndex(function (s) { return px >= s[0] && px < s[1]; });
      if (idx !== lastIdx) { lines.forEach(function (l, j) { l.classList.toggle("is-active", j === idx); l.classList.toggle("is-past", j < idx - 1); }); lastIdx = idx; }
      raf = requestAnimationFrame(tick);
    }
    controllers[3] = {
      enter: function () { active = true; t0 = performance.now(); lastIdx = -1; lastBar = -1; raf = requestAnimationFrame(tick); },
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
    scenes.forEach(function (s) { if (s !== from) s.classList.remove("is-leaving"); });
    from.classList.remove("is-active"); from.classList.add("is-leaving");
    to.classList.add("is-active");
    if (controllers[prev]) controllers[prev].leave();
    current = next;
    busy = true;
    setState();
    showMedia(next, prev);
    if (controllers[next]) controllers[next].enter();
    setTimeout(function () { from.classList.remove("is-leaving"); busy = false; }, reduceMotion ? 50 : LEAVE_MS);
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
