/* ============================================================================
   IrisLab — frontend logic
   Vanilla JS: sliders, presets, live prediction, reveal animations, nav.
   ========================================================================== */
(function () {
  "use strict";

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

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

  /* ------------------------------- sliders ------------------------------ */
  const sliders = {};
  $$('input[type="range"]').forEach((input) => {
    sliders[input.id] = input;
    const update = () => {
      const pct = ((input.value - input.min) / (input.max - input.min)) * 100;
      input.style.setProperty("--fill", pct.toFixed(2) + "%");
      const out = document.getElementById(input.id + "-out");
      if (out) out.textContent = Number(input.value).toFixed(1) + " cm";
    };
    input.addEventListener("input", update);
    update();
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
        const input = sliders[key];
        input.value = value;
        input.dispatchEvent(new Event("input", { bubbles: false }));
      });
    });
  });

  /* ------------------------------- species ------------------------------ */
  const SPECIES_META = {
    setosa: {
      color: "#2dd4bf",
      soft: "rgba(45, 212, 191, 0.15)",
      blurb: "Iris setosa — compact petals, linearly separable from the rest.",
    },
    versicolor: {
      color: "#a78bfa",
      soft: "rgba(139, 92, 246, 0.16)",
      blurb: "Iris versicolor — the mid-band iris, most prone to overlap.",
    },
    virginica: {
      color: "#f472b6",
      soft: "rgba(244, 114, 182, 0.16)",
      blurb: "Iris virginica — the large-flowered iris with wide petals.",
    },
  };

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
    const payload = {
      sepal_length: Number(sliders.sepal_length.value),
      sepal_width: Number(sliders.sepal_width.value),
      petal_length: Number(sliders.petal_length.value),
      petal_width: Number(sliders.petal_width.value),
    };

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
    const meta = SPECIES_META[species] || SPECIES_META.versicolor;
    const card = panelCard;

    card.style.setProperty("--species-main", meta.color);
    card.style.setProperty("--species-soft", meta.soft);

    $("#resultBadge").textContent = "● " + species;
    $("#latencyChip").textContent = (data.latency_ms ?? 0).toFixed(1) + " ms";
    $("#speciesName").textContent = species;
    $("#speciesName").style.color = meta.color;
    $("#speciesBlurb").textContent = meta.blurb;

    // input echo
    const echo = $("#inputEcho");
    const labels = ["Sepal L", "Sepal W", "Petal L", "Petal W"];
    const keys = ["sepal_length", "sepal_width", "petal_length", "petal_width"];
    echo.querySelectorAll("dd").forEach((dd, i) => {
      dd.textContent = Number(data.input[keys[i]]).toFixed(1) + " cm";
    });
    void labels;

    // donut
    const conf = Math.max(0, Math.min(1, data.confidence || 0));
    donutArc.style.stroke = meta.color;
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
