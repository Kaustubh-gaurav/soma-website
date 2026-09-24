/* SOMA slideshow.
   Each scene plays its clip once, then moves on by itself. The visitor can also move with the
   wheel, trackpad, arrow keys, a swipe, or the section rail. Scenes crossfade, and on the last scene the lines close into a box around the form. */
(function () {
  "use strict";

  // Where form submissions go. Paste a Formspree (or similar) endpoint here to start receiving them.
  var FORM_ENDPOINT = "";

  var FALLBACK_SECONDS = 5.5;   // used if a clip's length cannot be read
  var LEAVE_MS = 500;           // how long a leaving scene stays drawn: covers --fade in style.css
  var READY_WAIT_MS = 4000;     // longest the slideshow waits for a slow clip before moving on anyway
  var WHEEL_THRESHOLD = 30;     // how much wheel travel counts as one step
  var SWIPE_THRESHOLD = 50;

  var stage = document.getElementById("stage");
  var scenes = Array.prototype.slice.call(document.querySelectorAll(".scene"));
  var railList = document.querySelector(".rail__list");
  var last = scenes.length - 1;
  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  var params = new URLSearchParams(location.search);
  var autoAdvance = !params.has("still");     // ?still stops the timer, handy while reviewing
  var current = 0;
  var busy = false;
  var timer = null;
  var token = 0;                // bumps on every scene change, so stale timers and listeners do nothing

  // ---------- Rail: every video section, so not the home screen or the form ----------

  var railItems = scenes.map(function (scene, i) {
    if (i === 0 || i === last) return null;
    var li = document.createElement("li");
    var b = document.createElement("button");
    b.type = "button";
    b.className = "rail__item";
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

  // ---------- Video ----------

  function videoOf(i) { return scenes[i] && scenes[i].querySelector("video"); }

  function warm(i) {
    var v = videoOf(i);
    if (v && v.preload !== "auto") { v.preload = "auto"; v.load(); }
  }

  // Once the first clip can play, fetch the rest one at a time, in scene order, so each one is
  // already buffered by the time its scene comes up and they never compete for bandwidth.
  function preloadRest() {
    var queue = scenes.map(function (s, i) { return i; }).filter(function (i) { return videoOf(i) && i !== current; });
    (function nextInQueue() {
      var i = queue.shift();
      if (i === undefined) return;
      var v = videoOf(i);
      if (v.readyState >= 4) return nextInQueue();
      var done = function () { v.removeEventListener("canplaythrough", done); v.removeEventListener("error", done); nextInQueue(); };
      v.addEventListener("canplaythrough", done);
      v.addEventListener("error", done);
      warm(i);
    })();
  }

  function isReady(v) { return !v || v.readyState >= 3; }

  // Calls fn once the clip has enough data to play smoothly, or after READY_WAIT_MS at most.
  function whenReady(v, fn) {
    if (isReady(v)) return fn();
    var fired = false;
    var once = function () { if (fired) return; fired = true; v.removeEventListener("canplay", once); fn(); };
    v.addEventListener("canplay", once);
    setTimeout(once, READY_WAIT_MS);
  }

  function startScene(i) {
    clearTimeout(timer);
    var my = ++token;
    var v = videoOf(i);
    warm(i + 1);
    if (!v) return;                                   // the form has no clip and no timer

    var seconds = isFinite(v.duration) && v.duration > 0 ? v.duration : FALLBACK_SECONDS;
    if (v.currentTime > 0.05) { try { v.currentTime = 0; } catch (e) {} }
    if (!reduceMotion) {
      var p = v.play();
      if (p && p.catch) p.catch(function () {});
    }
    if (!autoAdvance || i >= last) return;

    // Count the clip's time from when it is actually playing, not from when it was asked to,
    // then only cut to the next scene once that clip is ready, so nothing opens on a frozen frame.
    var armed = false;
    var arm = function () {
      if (armed || my !== token) return;
      armed = true;
      timer = setTimeout(function () {
        whenReady(videoOf(i + 1), function () { if (my === token && !document.hidden) go(i + 1); });
      }, seconds * 1000);
    };
    if (!v.paused && v.readyState >= 3) arm();
    else { v.addEventListener("playing", arm, { once: true }); setTimeout(arm, READY_WAIT_MS); }
  }

  function stopScene(i) {
    var v = videoOf(i);
    if (v) setTimeout(function () { if (i !== current) v.pause(); }, LEAVE_MS);
  }

  // ---------- Moving between scenes ----------

  function go(next) {
    if (next === "last") next = last;
    next = Math.max(0, Math.min(last, next));
    if (next === current || busy) return;

    var from = scenes[current];
    var to = scenes[next];
    scenes.forEach(function (s) { if (s !== from) s.classList.remove("is-leaving"); });
    from.classList.remove("is-active");
    from.classList.add("is-leaving");
    to.classList.add("is-active");

    var prev = current;
    current = next;
    busy = true;
    setState();
    stopScene(prev);
    startScene(next);

    setTimeout(function () {
      from.classList.remove("is-leaving");
      busy = false;
    }, reduceMotion ? 50 : LEAVE_MS);
  }

  function setState() {
    stage.classList.toggle("is-home", current === 0);
    stage.classList.toggle("is-boxed", current === last);
    scenes.forEach(function (s, i) {
      var on = i === current;
      s.setAttribute("aria-hidden", on ? "false" : "true");
      if ("inert" in s) s.inert = !on;
    });
    syncRail();
  }

  // ---------- Input ----------

  // Wheel and trackpad: one step per gesture. A trackpad keeps sending small events after the
  // fingers lift, so the stage waits for a quiet moment before it accepts the next gesture.
  var wheelSum = 0, wheelQuietTimer = null, wheelLocked = false;
  stage.addEventListener("wheel", function (e) {
    e.preventDefault();
    clearTimeout(wheelQuietTimer);
    wheelQuietTimer = setTimeout(function () { wheelLocked = false; wheelSum = 0; }, 180);
    if (wheelLocked || busy) return;
    wheelSum += e.deltaY;
    if (Math.abs(wheelSum) >= WHEEL_THRESHOLD) {
      go(current + (wheelSum > 0 ? 1 : -1));
      wheelLocked = true;
      wheelSum = 0;
    }
  }, { passive: false });

  var touchY = null;
  stage.addEventListener("touchstart", function (e) {
    touchY = e.touches[0].clientY;
  }, { passive: true });
  stage.addEventListener("touchend", function (e) {
    if (touchY === null) return;
    var dy = touchY - e.changedTouches[0].clientY;
    touchY = null;
    if (Math.abs(dy) > SWIPE_THRESHOLD) go(current + (dy > 0 ? 1 : -1));
  });

  document.addEventListener("keydown", function (e) {
    var t = e.target;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
    if (["ArrowDown", "PageDown", " "].indexOf(e.key) > -1) { e.preventDefault(); go(current + 1); }
    else if (["ArrowUp", "PageUp"].indexOf(e.key) > -1) { e.preventDefault(); go(current - 1); }
    else if (e.key === "Home") { e.preventDefault(); go(0); }
    else if (e.key === "End") { e.preventDefault(); go(last); }
  });

  document.querySelectorAll("[data-goto]").forEach(function (el) {
    el.addEventListener("click", function (e) {
      e.preventDefault();
      var g = el.dataset.goto;
      go(g === "last" ? last : parseInt(g, 10));
    });
  });

  // Pause the timer while the tab is in the background, and pick it up again on return.
  document.addEventListener("visibilitychange", function () {
    if (document.hidden) { clearTimeout(timer); var v = videoOf(current); if (v) v.pause(); }
    else startScene(current);
  });

  // ---------- Form ----------

  var form = document.getElementById("request-form");
  var status = form.querySelector(".form__status");
  form.addEventListener("submit", function (e) {
    e.preventDefault();
    var ok = true;
    ["name", "email"].forEach(function (n) {
      var input = form.elements[n];
      var bad = !input.value.trim() || (n === "email" && !/^\S+@\S+\.\S+$/.test(input.value));
      input.closest(".field").classList.toggle("is-invalid", bad);
      if (bad) ok = false;
    });
    if (!ok) { status.textContent = "Please add your name and a valid email."; return; }

    if (!FORM_ENDPOINT) {
      status.textContent = "Thanks. This form is not connected yet, so nothing was sent.";
      return;
    }
    status.textContent = "Sending…";
    fetch(FORM_ENDPOINT, { method: "POST", headers: { Accept: "application/json" }, body: new FormData(form) })
      .then(function (r) {
        if (!r.ok) throw new Error(r.status);
        form.reset();
        status.textContent = "Thanks. We will be in touch.";
      })
      .catch(function () { status.textContent = "Something went wrong. Please try again."; });
  });

  // ---------- Hairlines ----------

  // One screen pixel in CSS pixels, and the hairline thickness rounded to whole screen pixels,
  // so every rule renders equally sharp at any display scaling or browser zoom.
  function setHairline() {
    var dpr = window.devicePixelRatio || 1;
    stage.style.setProperty("--snap", (1 / dpr) + "px");
    stage.style.setProperty("--hair", (Math.max(1, Math.round(dpr)) / dpr) + "px");
  }
  setHairline();
  window.addEventListener("resize", setHairline);

  // ---------- Start ----------

  // ?s=3 opens on a given scene, which makes reviewing one screen easier.
  var startAt = parseInt(params.get("s"), 10);
  if (startAt > 0 && startAt <= last) {
    scenes[0].classList.remove("is-active");
    scenes[startAt].classList.add("is-active");
    current = startAt;
  }
  setState();

  // ---------- Loader ----------

  // The count runs on time, along an ease out curve: quick through the low numbers, slowing into
  // 100 over LOADER_MS. If the fonts or the opening clip are not ready by then, it eases into the
  // 90s and creeps on until they are, then glides the rest of the way. It never waits longer
  // than LOADER_MAX_MS. The slideshow only starts once the cover fades, so the first clip gets
  // its full time on screen.
  var LOADER_MS = 2200;
  var LOADER_MAX_MS = 10000;
  var loader = document.getElementById("loader");
  var countEl = document.getElementById("loader-count");
  var firstVideo = videoOf(current);
  if (firstVideo) warm(current);

  var fontsDone = false;
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { fontsDone = true; });
  else fontsDone = true;

  function assetsReady() {
    return fontsDone && (!firstVideo || firstVideo.readyState >= 3);
  }

  function easeOutCubic(x) { return 1 - Math.pow(1 - x, 3); }

  function begin() {
    startScene(current);
    if (firstVideo && firstVideo.readyState < 3) firstVideo.addEventListener("canplay", preloadRest, { once: true });
    else preloadRest();
  }

  if (!loader || params.has("noload") || reduceMotion) {
    if (loader) loader.classList.add("is-done");
    begin();
  } else {
    var t0 = performance.now();
    var shown = 0;
    var finished = false;
    var finish = function () {
      if (finished) return;
      finished = true;
      loader.style.setProperty("--p", "1");
      countEl.textContent = "100";
      loader.setAttribute("aria-valuenow", 100);
      setTimeout(function () {
        loader.classList.add("is-done");
        begin();
      }, 250);                                                // a beat at 100 before the reveal
    };
    // Safety net: animation frames pause in background tabs, so a plain timer guarantees the
    // loader always finishes.
    setTimeout(finish, LOADER_MAX_MS + 1000);
    (function tick(now) {
      if (finished) return;
      var elapsed = now - t0;
      var curve = easeOutCubic(Math.min(1, elapsed / LOADER_MS));
      var goal;
      if (assetsReady() || elapsed > LOADER_MAX_MS) {
        goal = curve;
      } else {
        // Still loading: the same curve, topped out at 90, then a slow creep towards 98.
        var over = Math.max(0, elapsed - LOADER_MS);
        goal = 0.9 * curve + 0.08 * (1 - Math.exp(-over / 2500));
      }
      // Follow the goal closely; the light smoothing only softens the moment loading finishes.
      shown += (goal - shown) * 0.25;
      if (goal >= 1 && shown > 0.998) shown = 1;
      loader.style.setProperty("--p", shown.toFixed(4));
      var pct = Math.floor(shown * 100);
      countEl.textContent = pct;
      loader.setAttribute("aria-valuenow", pct);
      if (shown < 1) return requestAnimationFrame(tick);
      finish();
    })(t0);
  }
})();
