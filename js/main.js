/* SOMA slideshow.
   Each scene plays its clip once, then moves on by itself. The visitor can also move with the
   wheel, trackpad, arrow keys, a swipe, or the section rail. The old scene slides up, the new
   one slides in from below, and on the last scene the lines close into a box around the form. */
(function () {
  "use strict";

  // Where form submissions go. Paste a Formspree (or similar) endpoint here to start receiving them.
  var FORM_ENDPOINT = "";

  var FALLBACK_SECONDS = 5.5;   // used if a clip's length cannot be read
  var FADE_MS = 450;            // keep in step with --fade in style.css
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

  // ---------- Rail: every scene after the home screen ----------

  var railItems = scenes.map(function (scene, i) {
    if (i === 0) return null;
    var li = document.createElement("li");
    var b = document.createElement("button");
    b.type = "button";
    b.className = "rail__item";
    b.textContent = scene.dataset.label;
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
    // Keep the current item one row down, so the previous one shows above it (as in the Figma frames).
    var li = railItems[current] && railItems[current].parentElement;
    if (li) {
      var prev = li.previousElementSibling;
      railList.scrollTo({ top: prev ? prev.offsetTop - railList.offsetTop : 0, behavior: reduceMotion ? "auto" : "smooth" });
    }
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

  function startScene(i) {
    clearTimeout(timer);
    var v = videoOf(i);
    var seconds = FALLBACK_SECONDS;
    if (v) {
      if (isFinite(v.duration) && v.duration > 0) seconds = v.duration;
      scenes[i].style.setProperty("--dur", seconds + "s");
      try { v.currentTime = 0; } catch (e) {}
      if (!reduceMotion) {
        var p = v.play();
        if (p && p.catch) p.catch(function () {});
      }
    }
    warm(i + 1);
    if (autoAdvance && i < last) {
      timer = setTimeout(function () { if (!document.hidden) go(i + 1); }, seconds * 1000);
    }
  }

  function stopScene(i) {
    var v = videoOf(i);
    if (v) setTimeout(function () { if (i !== current) v.pause(); }, FADE_MS);
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
    }, reduceMotion ? 50 : FADE_MS);
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
    if (railList.contains(e.target)) return;          // the rail scrolls itself
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
    if (railList.contains(e.target)) return;
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

  // ---------- Start ----------

  // ?s=3 opens on a given scene, which makes reviewing one screen easier.
  var startAt = parseInt(params.get("s"), 10);
  if (startAt > 0 && startAt <= last) {
    scenes[0].classList.remove("is-active");
    scenes[startAt].classList.add("is-active");
    current = startAt;
  }
  setState();
  startScene(current);

  var first = videoOf(current);
  if (first && first.readyState < 3) first.addEventListener("canplay", preloadRest, { once: true });
  else preloadRest();
})();
