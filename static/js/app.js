/* ============================================================================
   IrisLab — frontend logic
   Vanilla JS: theme toggle, numeric inputs, presets, live prediction,
   reveal animations, nav.
   ========================================================================== */
(function () {
  "use strict";

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  /* ----------------------------- theme toggle --------------------------- */
  const themeToggle = $("#themeToggle");

  function currentTheme() {
    return document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
  }

  // Light is ALWAYS the default. Only an explicit choice saved by the
  // toggle below (handled by the inline bootstrap in <head>) can change it.
  themeToggle.addEventListener("click", () => {
    const next = currentTheme() === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    try { localStorage.setItem("irislab-theme", next); } catch (e) {}
  });

  /* ----------------------------- scroll progress ------------------------ */
  const scrollBar = $("#scrollBar");
  const nav = $("#nav");
  window.addEventListener(
    "scroll",
    () => {
      const max = document.documentElement.scrollHeight - window.innerHeight;
      scrollBar.style.width = (max > 0 ? (window.scrollY / max) * 100 : 0) + "%";
      nav.classList.toggle("scrolled", window.scrollY > 24);
    },
    { passive: true }
  );

  /* --------------------------------- nav -------------------------------- */
  const navToggle = $("#navToggle");
  const navLinks = $("#navLinks");
  navToggle.addEventListener("click", () => {
    const open = navLinks.classList.toggle("open");
    navToggle.classList.toggle("open", open);
    navToggle.setAttribute("aria-expanded", String(open));
  });
  navLinks.addEventListener("click", (e) => {
    if (e.target.closest("a")) {
      navLinks.classList.remove("open");
      navToggle.classList.remove("open");
      navToggle.setAttribute("aria-expanded", "false");
    }
  });

  /* ------------------------------- reveal ------------------------------- */
  const revealObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("in");
          revealObserver.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.12, rootMargin: "0px 0px -40px 0px" }
  );
  $$(".reveal").forEach((el) => revealObserver.observe(el));

  /* --------------------------- measurement inputs ----------------------- */
  const inputs = {};
  const ranges = {};
  $$("input[type='number']").forEach((input) => {
    inputs[input.id] = input;
    ranges[input.id] = { min: parseFloat(input.min), max: parseFloat(input.max) };
  });
  const measureKeys = ["sepal_length", "sepal_width", "petal_length", "petal_width"];

  function clampValue(input, raw) {
    const { min, max } = ranges[input.id];
    let num = parseFloat(raw);
    if (isNaN(num) || !isFinite(num)) num = min;
    return Math.min(max, Math.max(min, num));
  }

  function markValid(input) {
    input.closest(".input-wrap").classList.remove("invalid");
  }

  Object.values(inputs).forEach((input) => {
    input.addEventListener("input", markValid);
    input.addEventListener("change", () => {
      input.value = clampValue(input, input.value).toFixed(1);
    });
    // Enter key inside any box triggers the prediction
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        predictBtn.click();
      }
    });
  });

  /* ± stepper buttons */
  $$(".step-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const input = inputs[btn.dataset.target];
      const step = parseFloat(btn.dataset.step);
      const next = clampValue(input, (parseFloat(input.value) || 0) + step);
      input.value = next.toFixed(1);
      markValid(input);
      input.focus();
    });
  });

  /* ------------------------------- presets ------------------------------ */
  const PRESETS = {
    setosa: { sepal_length: 5.0, sepal_width: 3.4, petal_length: 1.5, petal_width: 0.2 },
    versicolor: { sepal_length: 5.9, sepal_width: 2.8, petal_length: 4.3, petal_width: 1.3 },
    virginica: { sepal_length: 6.6, sepal_width: 3.0, petal_length: 5.5, petal_width: 2.0 },
  };
  const rnd = (min, max) => Math.round((min + Math.random() * (max - min)) * 10) / 10;

  $$(".preset-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const preset = btn.dataset.preset;
      const values =
        preset === "random"
          ? {
              sepal_length: rnd(3.0, 8.0),
              sepal_width: rnd(1.8, 4.8),
              petal_length: rnd(0.8, 7.2),
              petal_width: rnd(0.0, 3.0),
            }
          : PRESETS[preset];
      Object.entries(values).forEach(([key, value]) => {
        inputs[key].value = value.toFixed(1);
        markValid(inputs[key]);
      });
    });
  });

  /* ------------------------------ predict ------------------------------- */
  const predictBtn = $("#predictBtn");
  const btnLabel = predictBtn.querySelector(".btn-label");
  const panelIdle = $("#resultIdle");
  const panelLoading = $("#resultLoading");
  const panelCard = $("#resultCard");
  const panelError = $("#resultError");
  const errorMsg = $("#errorMsg");
  const donutArc = $("#donutArc");
  const CIRCUMFERENCE = 314.16;

  const showPanel = (name) => {
    [panelIdle, panelLoading, panelCard, panelError].forEach((p) =>
      p.classList.add("hidden")
    );
    name.classList.remove("hidden");
  };

  predictBtn.addEventListener("click", async () => {
    const payload = {};
    let hasInvalid = false;
    measureKeys.forEach((key) => {
      const input = inputs[key];
      const value = clampValue(input, input.value);
      if (input.value === "" || isNaN(parseFloat(input.value))) {
        input.closest(".input-wrap").classList.add("invalid");
        hasInvalid = true;
      }
      payload[key] = Number(value.toFixed(1));
    });
    if (hasInvalid) return;

    btnLabel.textContent = "Classifying…";
    predictBtn.disabled = true;
    showPanel(panelLoading);

    try {
      const res = await fetch("/api/predict", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `API responded with ${res.status}`);
      renderResult(data);
    } catch (err) {
      errorMsg.textContent =
        err.name === "TypeError"
          ? "Could not reach the API. Check your connection and try again."
          : err.message;
      showPanel(panelError);
    } finally {
      btnLabel.textContent = "Classify flower";
      predictBtn.disabled = false;
    }
  });

  function renderResult(data) {
    const species = data.prediction;
    const card = panelCard;

    // theme-aware colours come from CSS via [data-species]
    card.dataset.species = species;

    $("#resultBadge").textContent = "● " + species;
    $("#latencyChip").textContent = (data.latency_ms ?? 0).toFixed(1) + " ms";
    $("#speciesName").textContent = species;
    $("#speciesBlurb").textContent = SPECIES_BLURBS[species] || "Iris species predicted by the model.";

    // input echo
    const keys = ["sepal_length", "sepal_width", "petal_length", "petal_width"];
    $("#inputEcho").querySelectorAll("dd").forEach((dd, i) => {
      dd.textContent = Number(data.input[keys[i]]).toFixed(1) + " cm";
    });

    // donut
    const conf = Math.max(0, Math.min(1, data.confidence || 0));
    donutArc.style.strokeDashoffset = CIRCUMFERENCE * (1 - conf);
    $("#confidencePct").textContent = (conf * 100).toFixed(1) + "%";

    // class bars (restart animation by forcing reflow)
    Object.entries(data.confidence_scores || {}).forEach(([name, score]) => {
      const bar = document.getElementById("bar-" + name);
      const val = document.getElementById("val-" + name);
      if (!bar) return;
      bar.style.width = "0%";
      void bar.offsetWidth;
      bar.style.width = (score * 100).toFixed(1) + "%";
      val.textContent = (score * 100).toFixed(1) + "%";
    });

    $("#rawJson").textContent = JSON.stringify(data, null, 2);
    showPanel(panelCard);
  }

  const SPECIES_BLURBS = {
    setosa: "Iris setosa — compact petals, linearly separable from the rest.",
    versicolor: "Iris versicolor — the mid-band iris, most prone to overlap.",
    virginica: "Iris virginica — the large-flowered iris with wide petals.",
  };

  /* --------------------------- copy curl button ------------------------- */
  const copyBtn = $("#copyCurl");
  copyBtn.addEventListener("click", async () => {
    const text = $("#curlSnippet").textContent;
    try {
      await navigator.clipboard.writeText(text);
      copyBtn.textContent = "Copied!";
      copyBtn.classList.add("copied");
    } catch {
      copyBtn.textContent = "Ctrl+C";
    }
    setTimeout(() => {
      copyBtn.textContent = "Copy";
      copyBtn.classList.remove("copied");
    }, 1800);
  });

  /* ------------------------------ count-up ------------------------------ */
  const animateCount = (el) => {
    const target = parseFloat(el.dataset.countup);
    const suffix = el.dataset.suffix || (el.textContent.includes("%") ? "%" : "");
    const decimals = el.dataset.countup.includes(".") ? 1 : 0;
    const duration = 1100;
    const start = performance.now();
    const tick = (now) => {
      const p = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - p, 3);
      el.textContent = (target * eased).toFixed(decimals) + suffix;
      if (p < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  };
  const countObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          animateCount(entry.target);
          countObserver.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.6 }
  );
  $$("[data-countup]").forEach((el) => countObserver.observe(el));

  /* ---------------------- model info (live accuracy) -------------------- */
  fetch("/api/model-info")
    .then((r) => r.json())
    .then((info) => {
      const el = $("#statAccuracy");
      if (info && typeof info.test_accuracy === "number" && el) {
        el.textContent = (info.test_accuracy * 100).toFixed(1) + "%";
        const stat = el.closest("[data-countup]");
        if (stat) stat.dataset.countup = String((info.test_accuracy * 100).toFixed(1));
      }
    })
    .catch(() => {});

  /* -------------------------------- footer ------------------------------ */
  $("#year").textContent = new Date().getFullYear();
})();
