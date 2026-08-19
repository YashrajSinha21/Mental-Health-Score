(() => {
  "use strict";

  // Point this at wherever your FastAPI backend is running.
  // Local dev default, matching: uvicorn main:app --port 2200 --reload
  const API_BASE = "http://127.0.0.1:2200";

  const form = document.getElementById("predict-form");
  const submitBtn = document.getElementById("submit-btn");
  const resetBtn = document.getElementById("reset-btn");
  const errorRetryBtn = document.getElementById("error-retry-btn");

  const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ===========================================================
     COLOR HELPERS
     =========================================================== */
  function hexToRgb(hex) {
    const h = hex.replace("#", "");
    return {
      r: parseInt(h.substring(0, 2), 16),
      g: parseInt(h.substring(2, 4), 16),
      b: parseInt(h.substring(4, 6), 16),
    };
  }
  function rgbToHex({ r, g, b }) {
    const c = (n) => Math.round(Math.max(0, Math.min(255, n))).toString(16).padStart(2, "0");
    return `#${c(r)}${c(g)}${c(b)}`;
  }
  function lerpColor(hexA, hexB, t) {
    const a = hexToRgb(hexA), b = hexToRgb(hexB);
    return rgbToHex({
      r: a.r + (b.r - a.r) * t,
      g: a.g + (b.g - a.g) * t,
      b: a.b + (b.b - a.b) * t,
    });
  }
  // rose (low) -> amber (mid) -> mint (high)
  function colorForScore(score01) {
    if (score01 < 0.5) return lerpColor("#E8637A", "#F2A94D", score01 / 0.5);
    return lerpColor("#F2A94D", "#5FD6A6", (score01 - 0.5) / 0.5);
  }

  /* ===========================================================
     WAVE ENGINE — draws a sine path and animates its phase.
     Used for the ambient hero banner and the live signal panel.
     =========================================================== */
  function createWave(pathEl, { width, height }) {
    let amplitude = height * 0.12;
    let frequency = 0.018;
    let speed = 0.03;
    let jitter = 0;
    let color = "#5B6280";
    let phase = 0;
    let raf = null;

    function points() {
      const midY = height / 2;
      const step = 6;
      let d = "";
      for (let x = 0; x <= width; x += step) {
        const noise = jitter ? (Math.random() - 0.5) * jitter : 0;
        const y = midY + Math.sin(x * frequency + phase) * amplitude + noise;
        d += (x === 0 ? "M " : "L ") + x.toFixed(1) + " " + y.toFixed(1) + " ";
      }
      return d;
    }

    function frame() {
      phase += speed;
      pathEl.setAttribute("d", points());
      pathEl.style.stroke = color;
      raf = requestAnimationFrame(frame);
    }

    function start() {
      if (raf) return;
      if (prefersReducedMotion) {
        pathEl.setAttribute("d", points());
        pathEl.style.stroke = color;
        return;
      }
      frame();
    }

    function set(next) {
      if (next.amplitude !== undefined) amplitude = next.amplitude;
      if (next.frequency !== undefined) frequency = next.frequency;
      if (next.speed !== undefined) speed = next.speed;
      if (next.jitter !== undefined) jitter = next.jitter;
      if (next.color !== undefined) color = next.color;
      if (prefersReducedMotion) {
        pathEl.setAttribute("d", points());
        pathEl.style.stroke = color;
      }
    }

    return { start, set };
  }

  const heroWave = createWave(document.getElementById("hero-wave-path"), { width: 800, height: 200 });
  heroWave.set({ amplitude: 26, frequency: 0.012, speed: 0.012, jitter: 0, color: "#3A4568" });
  heroWave.start();

  const signalWave = createWave(document.getElementById("wave-path"), { width: 400, height: 160 });
  function setIdleWave() {
    signalWave.set({ amplitude: 14, frequency: 0.02, speed: 0.02, jitter: 0, color: "#3A4568" });
  }
  function setLoadingWave() {
    signalWave.set({ amplitude: 20, frequency: 0.045, speed: 0.09, jitter: 3, color: "#6C8EFF" });
  }
  function setResultWave(score) {
    const t = Math.max(0, Math.min(1, score / 10));
    const amplitude = 8 + t * 26;        // shallow & tight when low, deep & rolling when high
    const frequency = 0.05 - t * 0.032;  // rapid/erratic when low, slow/calm when high
    const jitter = (1 - t) * 4;          // jagged when low, smooth when high
    signalWave.set({ amplitude, frequency, speed: 0.02 + t * 0.01, jitter, color: colorForScore(t) });
  }
  function setErrorWave() {
    signalWave.set({ amplitude: 2, frequency: 0.02, speed: 0.015, jitter: 1.5, color: "#E8637A" });
  }
  setIdleWave();
  signalWave.start();

  /* ===========================================================
     SIGNAL PANEL STATE SWITCHING
     =========================================================== */
  const signalStates = {
    idle: document.getElementById("state-idle"),
    loading: document.getElementById("state-loading"),
    result: document.getElementById("state-result"),
    error: document.getElementById("state-error"),
  };
  function showSignal(name) {
    Object.values(signalStates).forEach((el) => el.classList.remove("is-active"));
    signalStates[name].classList.add("is-active");
  }

  /* ===========================================================
     WIZARD — steps, rail, next/back
     =========================================================== */
  const steps = Array.from(document.querySelectorAll(".step"));
  const railSteps = Array.from(document.querySelectorAll(".rail-step"));
  let currentStep = 0;

  const stepFieldIds = {
    0: ["age", "gender", "country"],
    1: ["academic_level", "most_used_platform", "purpose_of_use", "avg_daily_usage_hours", "daily_unlocks"],
    2: ["study_hours", "physical_activity_hours", "sleep_hours_per_night", "stress_level"],
  };

  function renderStep() {
    steps.forEach((s) => s.classList.toggle("is-active", Number(s.dataset.step) === currentStep));
    railSteps.forEach((r) => {
      const n = Number(r.dataset.step);
      r.classList.toggle("is-active", n === currentStep);
      r.classList.toggle("is-done", n < currentStep);
    });
  }

  function goToStep(n) {
    currentStep = n;
    renderStep();
  }

  document.querySelectorAll(".step-next").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (!validateStep(currentStep)) return;
      goToStep(Math.min(currentStep + 1, steps.length - 1));
    });
  });

  document.querySelectorAll(".step-back").forEach((btn) => {
    btn.addEventListener("click", () => goToStep(Math.max(currentStep - 1, 0)));
  });

  railSteps.forEach((r) => {
    r.addEventListener("click", () => {
      const target = Number(r.dataset.step);
      if (target <= currentStep) {
        goToStep(target);
      } else if (validateStep(currentStep)) {
        goToStep(target);
      }
    });
  });

  renderStep();

  /* ===========================================================
     STEPPER CONTROLS (age / daily unlocks)
     =========================================================== */
  document.querySelectorAll(".stepper").forEach((wrap) => {
    const input = wrap.querySelector("input");
    const min = Number(wrap.dataset.min ?? 0);
    const max = Number(wrap.dataset.max ?? Infinity);
    const step = Number(wrap.dataset.step ?? 1);
    wrap.querySelectorAll(".stepper-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const dir = Number(btn.dataset.dir);
        const current = input.value === "" ? (dir > 0 ? min : min) : Number(input.value);
        let next = current + dir * step;
        next = Math.max(min, Math.min(max, next));
        input.value = next;
        clearFieldError(input);
      });
    });
  });

  /* ===========================================================
     PILL GROUPS (gender / academic_level / purpose_of_use)
     =========================================================== */
  document.querySelectorAll(".pillgroup").forEach((group) => {
    const name = group.dataset.name;
    const hiddenInput = document.getElementById(name);
    group.querySelectorAll(".pill").forEach((pill) => {
      pill.addEventListener("click", () => {
        group.querySelectorAll(".pill").forEach((p) => p.classList.remove("active"));
        pill.classList.add("active");
        hiddenInput.value = pill.dataset.value;
        clearFieldError(hiddenInput);
      });
    });
  });

  /* ===========================================================
     SEGMENTED CONTROL (stress_level)
     =========================================================== */
  const segGroup = document.getElementById("stress_level_group");
  const stressHiddenInput = document.getElementById("stress_level");
  segGroup.querySelectorAll(".seg-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      segGroup.querySelectorAll(".seg-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      stressHiddenInput.value = btn.dataset.value;
      clearFieldError(stressHiddenInput);
    });
  });

  /* ===========================================================
     SLIDERS — live readouts
     =========================================================== */
  document.querySelectorAll(".slider").forEach((slider) => {
    const readout = document.getElementById(`${slider.id}-readout`);
    function update() {
      if (readout) readout.textContent = `${Number(slider.value).toFixed(1)} hrs`;
    }
    slider.addEventListener("input", update);
    update();
  });

  /* ===========================================================
     FIELD ERROR HELPERS
     =========================================================== */
  function fieldWrapper(input) {
    return input.closest(".field");
  }
  function setFieldError(input, message) {
    const wrap = fieldWrapper(input);
    if (!wrap) return;
    wrap.classList.add("field-error");
    const msgEl = wrap.querySelector(".error-msg");
    if (msgEl) msgEl.textContent = message;
  }
  function clearFieldError(input) {
    const wrap = fieldWrapper(input);
    if (!wrap) return;
    wrap.classList.remove("field-error");
    const msgEl = wrap.querySelector(".error-msg");
    if (msgEl) msgEl.textContent = "";
  }
  function clearAllErrors() {
    form.querySelectorAll(".field").forEach((f) => f.classList.remove("field-error"));
    form.querySelectorAll(".error-msg").forEach((m) => (m.textContent = ""));
  }

  /* ===========================================================
     VALIDATION
     =========================================================== */
  const numericRules = {
    age: [10, 100],
    avg_daily_usage_hours: [0, 24],
    daily_unlocks: [0, Infinity],
    study_hours: [0, 24],
    physical_activity_hours: [0, 24],
    sleep_hours_per_night: [0, 24],
  };
  const requiredTextFields = ["gender", "country", "academic_level", "most_used_platform", "purpose_of_use"];

  function readValue(key) {
    const el = document.getElementById(key);
    if (!el) return "";
    return el.value;
  }

  function validateStep(stepIndex) {
    let ok = true;
    const ids = stepFieldIds[stepIndex];
    ids.forEach((key) => {
      const input = key === "stress_level" ? stressHiddenInput : document.getElementById(key);
      const val = readValue(key);

      if (numericRules[key]) {
        const [min, max] = numericRules[key];
        const num = key === "age" || key === "daily_unlocks" ? parseInt(val, 10) : parseFloat(val);
        if (val === "" || Number.isNaN(num)) {
          setFieldError(input, "This field is required.");
          ok = false;
        } else if (num < min || num > max) {
          setFieldError(input, `Must be between ${min} and ${max === Infinity ? "0+" : max}.`);
          ok = false;
        } else {
          clearFieldError(input);
        }
        return;
      }

      if (!val || String(val).trim() === "") {
        setFieldError(input, key === "stress_level" ? "Pick a stress level." : "This field is required.");
        ok = false;
      } else {
        clearFieldError(input);
      }
    });
    return ok;
  }

  function validateAll() {
    let ok = true;
    for (let i = 0; i < steps.length; i++) {
      const stepOk = validateStep(i);
      if (!stepOk) ok = false;
    }
    return ok;
  }

  /* ===========================================================
     PAYLOAD
     =========================================================== */
  function collectPayload() {
    const fd = new FormData(form);
    return {
      age: fd.get("age") === "" ? NaN : parseInt(fd.get("age"), 10),
      gender: fd.get("gender") || "",
      country: (fd.get("country") || "").trim(),
      academic_level: fd.get("academic_level") || "",
      most_used_platform: fd.get("most_used_platform") || "",
      purpose_of_use: fd.get("purpose_of_use") || "",
      avg_daily_usage_hours: fd.get("avg_daily_usage_hours") === "" ? NaN : parseFloat(fd.get("avg_daily_usage_hours")),
      daily_unlocks: fd.get("daily_unlocks") === "" ? NaN : parseInt(fd.get("daily_unlocks"), 10),
      study_hours: fd.get("study_hours") === "" ? NaN : parseFloat(fd.get("study_hours")),
      physical_activity_hours: fd.get("physical_activity_hours") === "" ? NaN : parseFloat(fd.get("physical_activity_hours")),
      sleep_hours_per_night: fd.get("sleep_hours_per_night") === "" ? NaN : parseFloat(fd.get("sleep_hours_per_night")),
      stress_level: fd.get("stress_level") || "",
    };
  }

  /* ===========================================================
     RESULT / ERROR RENDERING
     =========================================================== */
  function setSubmitting(isSubmitting) {
    submitBtn.disabled = isSubmitting;
    submitBtn.classList.toggle("loading", isSubmitting);
  }

  function bandFor(score) {
    if (score < 4) {
      return {
        label: "Signal: strained",
        context: "Your responses suggest elevated strain right now. Small shifts in sleep or screen time can go a long way.",
      };
    }
    if (score < 7) {
      return {
        label: "Signal: balanced",
        context: "Your rhythm looks fairly steady, with some room to recover and reset.",
      };
    }
    return {
      label: "Signal: strong",
      context: "Your habits point to a well-supported, resilient baseline. Keep it up.",
    };
  }

  function renderResult(score) {
    const clamped = Math.max(0, Math.min(10, score));
    const { label, context } = bandFor(clamped);
    document.getElementById("score-number").textContent = score.toFixed(2);
    document.getElementById("score-band").textContent = label;
    document.getElementById("score-context").textContent = context;
    setResultWave(clamped);
    showSignal("result");
  }

  function renderError(label, copy) {
    document.getElementById("error-label").textContent = label;
    document.getElementById("error-copy").textContent = copy;
    setErrorWave();
    showSignal("error");
  }

  /* ===========================================================
     SERVER-SIDE (422) VALIDATION MAPPING
     =========================================================== */
  function applyServerValidationErrors(detail) {
    if (!Array.isArray(detail)) return false;
    let matched = false;
    let firstBadStep = null;
    detail.forEach((err) => {
      const field = Array.isArray(err.loc) ? err.loc[err.loc.length - 1] : null;
      const input = field === "stress_level" ? stressHiddenInput : (field ? document.getElementById(field) : null);
      if (input) {
        setFieldError(input, err.msg || "Invalid value.");
        matched = true;
        Object.entries(stepFieldIds).forEach(([stepIdx, ids]) => {
          if (ids.includes(field) && firstBadStep === null) firstBadStep = Number(stepIdx);
        });
      }
    });
    if (firstBadStep !== null) goToStep(firstBadStep);
    return matched;
  }

  /* ===========================================================
     SUBMIT
     =========================================================== */
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    clearAllErrors();

    if (!validateAll()) {
      for (let i = 0; i < steps.length; i++) {
        if (!validateStep(i)) { goToStep(i); break; }
      }
      return;
    }

    const payload = collectPayload();

    setSubmitting(true);
    setLoadingWave();
    showSignal("loading");

    try {
      const res = await fetch(`${API_BASE}/predict`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (res.status === 422) {
        const body = await res.json().catch(() => null);
        const matched = body && applyServerValidationErrors(body.detail);
        renderError(
          "Check your inputs",
          matched
            ? "The API rejected a few fields — details are marked on the form."
            : "The API rejected this submission. Please review your inputs and try again."
        );
        return;
      }

      if (!res.ok) {
        let detailMsg = `The API responded with status ${res.status}.`;
        const body = await res.json().catch(() => null);
        if (body && typeof body.detail === "string") detailMsg = body.detail;
        renderError("Prediction failed", detailMsg);
        return;
      }

      const data = await res.json();
      if (typeof data.predicted_mental_health_score !== "number") {
        renderError("Unexpected response", "The API responded, but the score was missing or malformed.");
        return;
      }

      renderResult(data.predicted_mental_health_score);
    } catch (err) {
      renderError(
        "Can't reach the server",
        `Couldn't connect to ${API_BASE}. Make sure the backend is running (uvicorn main:app --port 2200 --reload) and reachable from this page.`
      );
    } finally {
      setSubmitting(false);
    }
  });

  // live-clear errors as the user edits
  form.querySelectorAll("input, select").forEach((el) => {
    el.addEventListener("input", () => clearFieldError(el));
    el.addEventListener("change", () => clearFieldError(el));
  });

  resetBtn.addEventListener("click", () => {
    setIdleWave();
    showSignal("idle");
  });
  errorRetryBtn.addEventListener("click", () => {
    setIdleWave();
    showSignal("idle");
  });
})();