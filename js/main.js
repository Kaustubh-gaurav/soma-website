/* SOMA V2. Drives both pages: index.html (data buyers) and hospitals.html (For Hospitals).
   One fixed stage. Scroll, arrow keys, a swipe or the rail move one section at a time. The frame
   rules animate to each section's geometry, so lines slide, grow and retract between screens.
   A section also moves on by itself once its clip has played (5 s when it has none); inside it,
   the specimen layers, the Hear transcript and the Understand steps run on their own clocks. */
(function () {
  "use strict";

  // Where form submissions go. Paste a Formspree (or similar) endpoint here to start receiving them.
  var FORM_ENDPOINT = "";

  var LEAVE_MS = 500;
  var OUT_MS = 350;                      // how long the old screen takes to clear (--out in style.css)
  var WHEEL_THRESHOLD = 60;
  var SWIPE_THRESHOLD = 50;

  var stage = document.getElementById("stage");
  var board = document.getElementById("board");
  var scenes = Array.prototype.slice.call(board.querySelectorAll(".scene"));
  var railList = board.querySelector(".rail__list");
  var last = scenes.length - 1;
  var REQUEST = scenes.findIndex(function (s) { return s.classList.contains("scene--form"); });
  var SPEC = scenes.findIndex(function (s) { return s.classList.contains("scene--specimen"); });   // its clips wait for the layer clock
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
  // Each section names its geometry in data-geo, so the same engine draws the home page and
  // the For Hospitals page.
  function typeOf(i) { return (scenes[i] && scenes[i].dataset.geo) || "scrim"; }
  function geoFor(i) {
    var g = { v1: 80, v2: 1200 + DX, h1: 80, fold: 751 + DY };
    switch (typeOf(i)) {
      case "hero": g.scrim = 1; g.backed = 1; break;                                   // 01 Hero
      case "scrim": g.scrim = 1; break;                                                 // 02 to 05
      case "rows4": g.col = 365; g.rows = split(4); g.rx = 1; g.panel = 1; break;       // 06, 07
      case "delivery": g.col = 720 + DX; g.col2 = 960 + DX; break;                      // 08 Delivery
      case "custom": g.scrim = 1; g.col = 722 + DX; g.rows = split(5); g.panel = 1; g.blur = 1; break; // 09 Custom
      case "h-rows4": g.col = 722 + DX; g.rows = split(4); g.rx = 1; g.panel = 1; break; // Hospitals: infrastructure
      case "h-col": g.col = 722 + DX; break;                                            // Hospitals: opportunity, start small
      case "form-sample":                                                               // 12 Request a sample
        g.v1 = 366 + DX / 2; g.v2 = 914 + DX / 2; g.h1 = 172 + DY / 2; g.fold = 660 + DY / 2;
        g.noRail = 1; g.backed = 1; g.stack = 1; g.bx = g.v1 + 25; g.bw = 499; break;
      case "form-assess":                                                               // Hospitals: assessment
        g.v1 = 247 + DX / 2; g.v2 = 1033 + DX / 2; g.h1 = 192 + DY / 2; g.fold = 615 + DY / 2;
        g.noRail = 1; g.backed = 1; g.bx = g.v1 + 25; g.bw = 737; break;
      case "footer": g.h1 = 512 + DY; g.noRail = 1; g.backed = 1; break;                // 13 Footer
    }
    return g;
  }
  // Phones: the board is not scaled, so geometry is in real pixels.
  function phoneGeo(i) {
    var g = geoFor(i), t = typeOf(i);
    var o = { v1: 20, v2: VW - 20, h1: 64, fold: VH - 96, scrim: g.scrim, backed: g.backed, noRail: g.noRail };
    var span = o.fold - o.h1;
    if (t === "rows4") { o.col = 20; o.colHidden = 1; o.rows = [1, 2, 3].map(function (n) { return Math.round(o.h1 + span * n / 4); }); o.rx = 1; o.panel = 1; }
    if (t === "custom") { o.col = 20; o.colHidden = 1; o.rows = [1, 2, 3, 4].map(function (n) { return o.h1 + 1 + 56 * n; }); }
    if (t === "form-sample" || t === "form-assess") o.fold = VH - 24;
    if (t === "footer") o.h1 = VH - 300;
    return o;
  }

  var F = {};
  Array.prototype.forEach.call(stage.querySelectorAll(".frame > [data-f]"), function (el) { F[el.dataset.f] = el; });
  var panelEl = stage.querySelector(".panel"), scrimEl = stage.querySelector(".scrim");
  var dpr = window.devicePixelRatio || 1;
  function px(v) { return Math.round(v * K * dpr) / dpr; }             // design px to snapped screen px
  var lastCol = 720, lastCol2 = 960, lastRows = [248, 416, 583, 617];
  // Pieces are sized to their real length (a stretched 1 px square blurs on the GPU) and drawn in
  // or retracted with a 0 to 1 scale, which rests at 1 so the line stays crisp.
  // A piece that was hidden jumps to its new place before it appears, so it draws in from its own
  // rule (a row grows left from the right rule) instead of sliding over from the last screen.
  function snap(el, apply) {
    el.style.transition = "none"; apply(); void el.offsetWidth; el.style.transition = "";
  }
  function put(el, x, y, o) {
    var tr = "translate(" + x + "px," + y + "px)";
    if (o != null) {
      if (!o) { el._on = false; el.style.opacity = 0; return; }      // fades out where it is
      if (!el._on) snap(el, function () { el.style.transform = tr; el.style.opacity = 0; });
      el._on = true; el.style.opacity = o;
    }
    el.style.transform = tr;
  }
  // The row rules (r1 to r4) are horizontal, col and col2 vertical. Orientation comes from the
  // piece, not its size: a row can clamp to 1 px wide (a form box ending left of the last column)
  // and would then read as vertical and never retract.
  function seg(el, x, y, w, h, on) {
    var horiz = el.dataset.f.charAt(0) === "r";
    var tr = function (k) { return "translate(" + x + "px," + y + "px) scale(" + (horiz ? k : 1) + "," + (horiz ? 1 : k) + ")"; };
    if (on && !el._on) snap(el, function () { el.style.width = w + "px"; el.style.height = h + "px"; el.style.transform = tr(0); });
    el._on = !!on;
    if (!on) { el.style.transform = el.style.transform.replace(/scale\([^)]*\)/, "scale(" + (horiz ? 0 : 1) + "," + (horiz ? 1 : 0) + ")"); return; }
    el.style.width = w + "px"; el.style.height = h + "px";
    el.style.transform = tr(1);
  }

  function applyGeometry(i) {
    var g = isPhone ? phoneGeo(i) : geoFor(i);
    if (g.col != null) lastCol = g.col;
    if (g.col2 != null) lastCol2 = g.col2;
    var X1 = px(g.v1), X2 = px(g.v2), Y1 = px(g.h1), Y2 = px(g.fold), C = px(lastCol), C2 = px(lastCol2);
    var len = Math.max(0, Y2 - Y1), colOn = g.col != null && !g.colHidden ? 1 : 0;
    put(F.v1, X1, 0); put(F.v2, X2, 0); put(F.h1, 0, Y1); put(F.fold, 0, Y2);
    seg(F.col, C, Y1, 1, len, colOn);
    seg(F.col2, C2, Y1, 1, len, g.col2 != null ? 1 : 0);
    var rows = g.rows || [];
    for (var r = 0; r < 4; r++) {
      if (rows[r] != null) lastRows[r] = rows[r];
      seg(F["r" + (r + 1)], C, px(lastRows[r]), Math.max(1, X2 - C), 1, rows[r] != null ? 1 : 0);
    }
    put(F.tl, X1, Y1); put(F.tr, X2, Y1); put(F.bl, X1, Y2); put(F.br, X2, Y2);
    put(F.ct, C, Y1, colOn); put(F.cb, C, Y2, colOn);
    for (var x = 1; x <= 3; x++) put(F["x" + x], X2, px(lastRows[x - 1]), g.rx ? 1 : 0);
    panelEl.style.width = Math.max(0, X2 - C - 1) + "px"; panelEl.style.height = Math.max(0, len - 1) + "px";
    put(panelEl, C + 1, Y1 + 1, g.panel ? 1 : 0);
    scrimEl.style.opacity = g.scrim ? 1 : 0;
    board.style.setProperty("--logo-x", isPhone ? 36 : g.v1 + 25);
    board.style.setProperty("--nav-x", isPhone ? -36 : g.v2 - 27 - (1280 + DX));
    // The backed strip spans the frame by default; the form screens pull it in to their box.
    board.style.setProperty("--backed-x", (g.bx != null ? g.bx : 113) + "px");
    board.style.setProperty("--backed-w", (g.bw != null ? g.bw : 1055 + DX) + "px");
    stage.classList.toggle("no-rail", !!g.noRail);
    stage.classList.toggle("show-backed", !!g.backed);
    stage.classList.toggle("backed-stack", !!g.stack);
    stage.classList.toggle("panel-blur", !!g.blur);
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
    cnt.style.top = (isPhone ? vh - 152 : px(626 + DY)) + "px";
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
    if (i === 0 || scene.hasAttribute("data-norail")) return null;
    var li = document.createElement("li");
    var b = document.createElement("button");
    b.type = "button";
    b.className = "rail__item t-nav14";
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
      videosIn(mediaFor(current)).forEach(function (v) { if (current !== SPEC || v.classList.contains("is-shown")) play(v); });
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
        setTimeout(function () { v.load(); if (+m.dataset.scene === current && current !== SPEC) play(v); }, 1500);
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
    if (to) { to.classList.add("is-on"); if (next !== SPEC) videosIn(to).forEach(play); }
    warm(next + 1);
  }

  // ---------- Section controllers ----------
  var controllers = {};

  // A transcript column, as in Figma: each line carries its start and end (ms, on its video's
  // clock, offset by data-from). A line pops up (big and white) when it starts and stays up until
  // the next line takes its place, the same in every transcript. The lines next to it are soft,
  // the rest dim; before the first line, the first is soft.
  function transcriptOf(box) {
    var from = +box.dataset.from || 0;
    var lines = Array.prototype.slice.call(box.querySelectorAll("li")).map(function (li) {
      var who = li.querySelector(".t-caps12").textContent.split("·");
      return { li: li, at: +li.dataset.at - from, end: +li.dataset.end - from, who: who.length > 1 ? who.pop().trim() : "" };
    });
    var lastKey = "";
    return {
      from: from, lines: lines,
      update: function (ms) {
        var latest = -1, now = -1;
        lines.forEach(function (l, j) { if (ms >= l.at) latest = j; });
        now = latest;
        var key = latest + ":" + now;
        if (key === lastKey) return;
        lastKey = key;
        lines.forEach(function (l, j) {
          l.li.classList.toggle("is-active", j === now);
          l.li.classList.toggle("is-near", j !== now && (latest < 0 ? j === 0 : Math.abs(j - latest) <= 1));
        });
      }
    };
  }

  // 02 Specimen: the clip is the five layers back to back, 2 s each (raw, instruments, anatomy,
  // phase, transcript), so the clip's own time drives everything: which layer is lit, how far its
  // underline has filled, and the transcript. Clicking a layer seeks the clip to that layer.
  if (SPEC > -1) (function () {
    var scene = scenes[SPEC];
    var v = document.getElementById("spec-vid");
    var toggles = Array.prototype.slice.call(scene.querySelectorAll(".toggle"));
    var tr = transcriptOf(document.getElementById("spec-transcript"));
    var LAYER = 2, layer = -1, active = false, raf = 0;
    function set(l) {
      layer = l;
      toggles.forEach(function (t, i) { t.classList.toggle("is-active", i === l); t.setAttribute("aria-selected", i === l); if (i !== l) t.style.setProperty("--progress", 0); });
    }
    function tick() {
      if (!active) return;
      var t = v.currentTime || 0;
      var l = Math.min(toggles.length - 1, Math.floor(t / LAYER));
      if (l !== layer) set(l);
      toggles[l].style.setProperty("--progress", Math.min(1, (t - l * LAYER) / LAYER).toFixed(4));
      tr.update(t * 1000);
      raf = requestAnimationFrame(tick);
    }
    toggles.forEach(function (t, i) { t.addEventListener("click", function () { try { v.currentTime = i * LAYER + 0.01; } catch (e) {} play(v); }); });
    controllers[SPEC] = {
      enter: function () { active = true; layer = -1; try { v.currentTime = 0; } catch (e) {} play(v); cancelAnimationFrame(raf); raf = requestAnimationFrame(tick); },
      leave: function () { active = false; cancelAnimationFrame(raf); setTimeout(function () { if (current !== SPEC) v.pause(); }, LEAVE_MS); }
    };
  })();
  function sceneOf(el) { return el ? scenes.indexOf(el.closest(".scene")) : -1; }

  // 04 Hear: an audio player over the clip, which is 01:00 onwards of the recording. The clip's own
  // time drives it: the playhead, the bars before it, the speaker named over each stretch they
  // speak, and the words of the line being spoken. The waveform only has speech inside a line.
  if (document.getElementById("wave-bars")) (function () {
    var barsEl = document.getElementById("wave-bars"), spk = document.getElementById("wave-speakers");
    var ph = document.getElementById("playhead"), phTime = document.getElementById("playhead-time");
    var v = document.getElementById("hear-vid");
    var tr = transcriptOf(document.getElementById("transcript")), lines = tr.lines;
    var DUR = 11.83 * 1000;                                 // until the clip's metadata says otherwise
    var labels = [];
    function placeLabels() {
      labels.forEach(function (s) { s.remove(); });
      labels = lines.map(function (l) {
        var s = document.createElement("span");
        s.className = "t-caps12";
        s.textContent = l.who;
        s.style.left = (l.at / DUR * 100).toFixed(2) + "%";
        spk.appendChild(s); return s;
      });
    }
    var W = 0, BAR = 5, bars = [];
    var active = false, raf = 0, lastBar = -1;
    rebuildWave = function (force) {
      var w = barsEl.offsetWidth || 1088;
      if (!force && bars.length && Math.abs(w - W) < 2) return;
      W = w;
      barsEl.innerHTML = ""; bars = []; lastBar = -1;
      var N = Math.floor(W / BAR);
      for (var i = 0; i < N; i++) {
        var ms = (i * BAR + 1) / W * DUR;
        var inLine = lines.some(function (l) { return ms >= l.at && ms < l.end; });
        var speech = inLine && Math.sin(i * 0.23) > -0.55;  // short gaps between words
        var h = speech ? 6 + Math.abs(Math.sin(i * 1.7)) * 12 + Math.abs(Math.sin(i * 0.37)) * 8 : 2;
        var b = document.createElement("i"); b.style.height = Math.round(h) + "px";
        barsEl.appendChild(b); bars.push(b);
      }
    };
    placeLabels(); rebuildWave();
    v.addEventListener("loadedmetadata", function () { if (isFinite(v.duration) && v.duration > 0) { DUR = v.duration * 1000; placeLabels(); rebuildWave(true); } });
    function stamp(ms) {
      var s = Math.floor((tr.from + ms) / 1000), m = Math.floor(s / 60) % 60, h = Math.floor(s / 3600);
      s = s % 60;
      return [h, m, s].map(function (n) { return (n < 10 ? "0" : "") + n; }).join(":");
    }
    function tick() {
      if (!active) return;
      var ms = Math.min(DUR, (v.currentTime || 0) * 1000), x = ms / DUR * W;
      ph.style.transform = "translateX(" + x.toFixed(1) + "px)";
      phTime.textContent = stamp(ms);
      var upto = Math.floor(x / BAR);
      if (upto !== lastBar) {
        if (upto < lastBar) { for (var j = 0; j < bars.length; j++) bars[j].classList.toggle("is-played", j <= upto); }
        else for (var k = Math.max(0, lastBar + 1); k <= upto && k < bars.length; k++) bars[k].classList.add("is-played");
        lastBar = upto;
      }
      tr.update(ms);
      lines.forEach(function (l, j) { labels[j].classList.toggle("is-active", ms >= l.at && ms < l.end); });
      raf = requestAnimationFrame(tick);
    }
    controllers[sceneOf(barsEl)] = {
      enter: function () { active = true; try { v.currentTime = 0; } catch (e) {} lastBar = -1; bars.forEach(function (b) { b.classList.remove("is-played"); }); raf = requestAnimationFrame(tick); },
      leave: function () { active = false; cancelAnimationFrame(raf); }
    };
  })();

  // 05 Understand: the five steps light up in order.
  // Clicking a step jumps to it; the order carries on from there.
  if (document.getElementById("understand-steps")) (function () {
    var steps = Array.prototype.slice.call(document.querySelectorAll("#understand-steps .step"));
    var seg = document.getElementById("understand-steps");
    var STEP_MS = 2000, timer = 0, i = 0;
    function show() {
      steps.forEach(function (s, j) { s.classList.toggle("is-done", j < i); s.classList.toggle("is-active", j === i); s.setAttribute("aria-pressed", j === i); });
    }
    function run() { clearInterval(timer); timer = setInterval(function () { i = (i + 1) % steps.length; show(); }, STEP_MS); }
    steps.forEach(function (s, j) { s.addEventListener("click", function () { i = j; show(); run(); }); });
    controllers[sceneOf(seg)] = {
      enter: function () { i = 0; show(); run(); },
      leave: function () { clearInterval(timer); }
    };
  })();

  // 08 Delivery: hovering or clicking a file moves the highlight and swaps the preview.
  if (document.getElementById("tree")) (function () {
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
    // Never two screens at once: the old footage and copy clear first, then the new ones come in.
    var late = reduceMotion ? 0 : OUT_MS;
    to.style.setProperty("--late", late + "ms");
    from.classList.remove("is-active"); from.classList.add("is-leaving");
    to.classList.add("is-active");
    if (controllers[prev]) controllers[prev].leave();
    current = next;
    busy = true;
    setState();
    showMedia(next, prev);
    if (controllers[next]) controllers[next].enter();
    setTimeout(function () { from.classList.remove("is-leaving"); }, late + 50);
    setTimeout(function () { busy = false; }, reduceMotion ? 50 : LEAVE_MS + late);
    armAuto();
  }

  // Auto advance: a section with footage moves on once its clip has played through (the longest
  // one when it has several); a section without footage moves on after 5 s. The forms wait for
  // the visitor and the last section stays. Any move, by hand or not, restarts the count.
  // ?still turns it off.
  var AUTO_MS = 5000, autoTimer = 0, autoPoll = 0, started = false;
  function stopAuto() { clearTimeout(autoTimer); clearInterval(autoPoll); }
  function armAuto() {
    stopAuto();
    if (!started || params.has("still")) return;
    var at = current;
    if (at >= last || scenes[at].classList.contains("scene--form")) return;
    var vs = videosIn(mediaFor(at));
    if (!vs.length) { autoTimer = setTimeout(function () { if (current === at) go(at + 1); }, AUTO_MS); return; }
    var main = vs.reduce(function (a, b) { return (b.duration || 0) > (a.duration || 0) ? b : a; });
    var prevT = 0, moved = false;
    autoPoll = setInterval(function () {
      if (current !== at) return stopAuto();
      var d = main.duration, t = main.currentTime;
      if (t > 0.3) moved = true;
      // done at the end, or when a looping clip wraps round to the start
      if ((isFinite(d) && d > 0 && t >= d - 0.12) || (moved && t < prevT - 0.5)) { stopAuto(); go(at + 1); }
      prevT = t;
    }, 100);
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
  // Scroll moves by stride and speed. A gesture is every wheel event until the wheel has been quiet
  // for 200 ms. A small scroll moves one section; every further STRIDE of travel adds one, and a
  // really fast flick adds one more. The move is decided 120 ms in (or as soon as the wheel goes
  // quiet), so a big scroll jumps straight to its section instead of stepping through each one;
  // if the same gesture keeps going, the extra sections are added once the current move lands.
  var STRIDE = 700, QUIET_MS = 200, DECIDE_MS = 120;
  var gest = null, pendingTo = null, quietTimer = 0, decideTimer = 0;
  function stepsFor(g) {
    var dist = Math.abs(g.sum);
    if (dist < WHEEL_THRESHOLD) return 0;
    var n = 1 + Math.floor(Math.max(0, dist - WHEEL_THRESHOLD) / STRIDE);
    var speed = g.peak;                                     // px per ms over the fastest 100 ms
    if (dist > 4 * WHEEL_THRESHOLD && speed > 6) n += 1;    // only a really fast flick earns a bonus
    return n;
  }
  function wheelTarget() {
    if (!gest || !gest.decided) return;
    var to = Math.max(0, Math.min(last, gest.base + gest.dir * stepsFor(gest)));
    if (to === current) return;
    if (busy) { pendingTo = to; return; }
    pendingTo = null; go(to);
  }
  function decide() { clearTimeout(decideTimer); if (gest && !gest.decided) { gest.decided = true; wheelTarget(); } }
  // A move queued during a transition lands when that transition ends.
  setInterval(function () { if (pendingTo != null && !busy) { var to = pendingTo; pendingTo = null; if (to !== current) go(to); } }, 60);
  stage.addEventListener("wheel", function (e) {
    e.preventDefault();
    var now = performance.now();
    var dy = e.deltaMode === 1 ? e.deltaY * 40 : e.deltaMode === 2 ? e.deltaY * 800 : e.deltaY;
    if (!dy) return;
    var dir = dy > 0 ? 1 : -1;
    if (!gest || gest.dir !== dir) {
      gest = { dir: dir, sum: 0, base: current, t0: now, hist: [], peak: 0, decided: false };
      clearTimeout(decideTimer); decideTimer = setTimeout(decide, DECIDE_MS);
    }
    gest.sum += dy;
    gest.hist.push([now, Math.abs(dy)]);
    while (gest.hist.length && now - gest.hist[0][0] > 100) gest.hist.shift();
    if (gest.hist.length >= 3) {                            // speed needs a few events; one notch is not a flick
      var span = Math.max(40, now - gest.hist[0][0]);
      var recent = gest.hist.reduce(function (t, h) { return t + h[1]; }, 0);
      gest.peak = Math.max(gest.peak, recent / span);
    }
    if (gest.decided) wheelTarget();
    clearTimeout(quietTimer);
    quietTimer = setTimeout(function () { decide(); gest = null; }, QUIET_MS);
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
    else { if (current !== SPEC) videosIn(m).forEach(play); if (controllers[current]) controllers[current].enter(); }
  });

  // ---------- Forms ----------
  // Each form lists its required fields in data-required and the message to show when they
  // are missing in data-missing; the success panel is the next .form-done in its section.
  Array.prototype.forEach.call(document.querySelectorAll("form.form"), function (form) {
    var status = form.querySelector(".form__status");
    var done = form.parentNode.querySelector(".form-done");
    var required = (form.dataset.required || "").split(/\s+/).filter(Boolean);
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var ok = true;
      required.forEach(function (n) {
        var input = form.elements[n];
        var v = input.value.trim();
        var bad = !v || (n === "email" && !/^\S+@\S+\.\S+$/.test(v)) || (n === "phone" && v.replace(/\D/g, "").length < 7);
        input.closest(".field").classList.toggle("is-invalid", bad);
        if (bad) ok = false;
      });
      if (!ok) { status.textContent = form.dataset.missing || "Please fill in the required fields."; return; }
      if (!FORM_ENDPOINT) { status.textContent = "Thanks. This form is not connected yet, so nothing was sent."; return; }
      status.textContent = "Sending…";
      var data = new FormData(form); data.append("form", form.id);
      fetch(FORM_ENDPOINT, { method: "POST", headers: { Accept: "application/json" }, body: data })
        .then(function (r) {
          if (!r.ok) throw new Error(r.status);
          form.reset(); form.hidden = true; if (done) done.hidden = false; status.textContent = "";
        })
        .catch(function () { status.textContent = "Something went wrong. Please try again."; });
    });
  });

  // ---------- Start ----------
  var loader = document.getElementById("loader");
  ["h1", "fold"].forEach(function (line) { for (var p = 0; p < 4; p++) { var e = document.createElement("span"); e.className = "seg seg--h"; loader.insertBefore(e, loader.firstChild); loaderSegs.push({ el: e, h: 1, line: line, part: p }); } });
  ["v1", "v2"].forEach(function (line) { for (var p = 0; p < 4; p++) { var e = document.createElement("span"); e.className = "seg seg--v"; loader.insertBefore(e, loader.firstChild); loaderSegs.push({ el: e, h: 0, line: line, part: p }); } });
  loader.querySelectorAll(".seg--h1, .seg--fold, .seg--v1, .seg--v2").forEach(function (e) { e.remove(); });
  layout();
  window.addEventListener("resize", layout);

  var startAt = location.hash === "#request" ? REQUEST : parseInt(params.get("s"), 10);
  if (startAt > 0 && startAt <= last) { scenes[0].classList.remove("is-active"); scenes[startAt].classList.add("is-active"); current = startAt; }
  setState();

  function begin() {
    showMedia(current, -1);
    if (controllers[current]) controllers[current].enter();
    started = true; armAuto();
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
  // Short by design: about 1.4 s, never more than 4 s, and only once per visit (the second page,
  // Home or For Hospitals, skips it; the head script hides it before first paint).
  var LOADER_MS = 1400, LOADER_MAX_MS = 4000;
  var SEEN = "soma-loaded", seen = false;
  try { seen = sessionStorage.getItem(SEEN) === "1"; } catch (e) {}
  var countEl = document.getElementById("loader-count");
  var firstVideos = videosIn(mediaFor(current));
  firstVideos.forEach(function (v) { v.preload = "auto"; });
  var fontsDone = false;
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { fontsDone = true; }); else fontsDone = true;
  function assetsReady() { return fontsDone && firstVideos.every(function (v) { return v.readyState >= 2; }); }   // first frame is enough
  function easeOutCubic(x) { return 1 - Math.pow(1 - x, 3); }

  if (params.has("noload") || reduceMotion || seen) { loader.classList.add("is-done"); begin(); }
  else {
    var t0 = performance.now(), shown = 0, finished = false;
    var finish = function () {
      if (finished) return; finished = true;
      try { sessionStorage.setItem(SEEN, "1"); } catch (e) {}
      loader.style.setProperty("--p", "1"); countEl.textContent = "100"; loader.setAttribute("aria-valuenow", 100);
      setTimeout(function () { loader.classList.add("is-done"); begin(); }, 250);
    };
    setTimeout(finish, LOADER_MAX_MS + 500);
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
