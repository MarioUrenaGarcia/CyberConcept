(function () {
  "use strict";

  const STORAGE_PROGRESS = "cyberconcept.progress";
  const STORAGE_CONFIG = "cyberconcept.config";
  const STORAGE_THEME = "cyberconcept.theme";

  const CAT_BY_ID = Object.fromEntries(CATEGORIES.map((c) => [c.id, c]));
  const ITEMS = ACRONYMS.map((x, i) => Object.assign({}, x, { id: x.a + "|" + x.c + "|" + x.e, idx: i }));

  const MODES = [
    { id: "write", name: "Escribir", desc: "Ves las siglas y escribes su significado." },
    { id: "choice", name: "Opción múltiple", desc: "Ves las siglas y eliges el significado entre cuatro." },
    { id: "reverse", name: "Inverso", desc: "Ves el significado y escribes las siglas." },
    { id: "mixed", name: "Mixto", desc: "Las tres dinámicas mezcladas al azar." }
  ];
  const MODE_BY_ID = Object.fromEntries(MODES.map((m) => [m.id, m]));
  const COUNT_OPTIONS = [10, 20, 40, 0, -1];
  const INFINITE_BATCH = 20;
  const TIMER_OPTIONS = [0, 10, 20, 30];
  const STOPWORDS = new Set(["and", "of", "the", "for", "to", "in", "on", "a", "an", "y", "de", "del", "la", "el", "los", "las", "en", "por", "con"]);

  const app = document.getElementById("app");

  // Estado

  const state = {
    view: "setup",
    config: loadConfig(),
    session: null,
    glossary: { q: "", cat: "all" },
    progress: loadProgress()
  };

  let timerHandle = null;

  // Utilidades

  function esc(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function stripAccents(s) {
    return s.normalize("NFD").replace(/[̀-ͯ]/g, "");
  }

  function normText(s) {
    const base = stripAccents(String(s)).toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").trim();
    return base.split(" ").filter((w) => w && !STOPWORDS.has(w)).join(" ");
  }

  function normAcronym(s) {
    return stripAccents(String(s)).toLowerCase().replace(/[^a-z0-9]+/g, "");
  }

  function levenshtein(a, b) {
    if (a === b) return 0;
    if (!a.length) return b.length;
    if (!b.length) return a.length;
    let prev = new Array(b.length + 1);
    let cur = new Array(b.length + 1);
    for (let j = 0; j <= b.length; j++) prev[j] = j;
    for (let i = 1; i <= a.length; i++) {
      cur[0] = i;
      for (let j = 1; j <= b.length; j++) {
        const cost = a[i - 1] === b[j - 1] ? 0 : 1;
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      }
      const tmp = prev;
      prev = cur;
      cur = tmp;
    }
    return prev[b.length];
  }

  function similarity(a, b) {
    const max = Math.max(a.length, b.length);
    if (!max) return 1;
    return 1 - levenshtein(a, b) / max;
  }

  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const t = a[i];
      a[i] = a[j];
      a[j] = t;
    }
    return a;
  }

  function weightedSample(pool, n, weightFn) {
    const remaining = pool.slice();
    const out = [];
    while (out.length < n && remaining.length) {
      let total = 0;
      const weights = remaining.map((it) => {
        const w = Math.max(0.2, weightFn(it));
        total += w;
        return w;
      });
      let r = Math.random() * total;
      let k = 0;
      for (; k < remaining.length; k++) {
        r -= weights[k];
        if (r <= 0) break;
      }
      if (k >= remaining.length) k = remaining.length - 1;
      out.push(remaining[k]);
      remaining.splice(k, 1);
    }
    return out;
  }

  function topicKey(cat, topic) {
    return cat + "::" + topic;
  }

  function topicsOf(catId) {
    const seen = [];
    for (const it of ITEMS) {
      if (it.c === catId && !seen.includes(it.t)) seen.push(it.t);
    }
    return seen;
  }

  function plural(n, one, many) {
    return n + " " + (n === 1 ? one : many);
  }

  function formatTime(ms) {
    const s = Math.round(ms / 1000);
    const m = Math.floor(s / 60);
    const r = s % 60;
    return m ? m + " min " + String(r).padStart(2, "0") + " s" : r + " s";
  }

  // Persistencia

  function loadProgress() {
    try {
      const raw = localStorage.getItem(STORAGE_PROGRESS);
      const parsed = raw ? JSON.parse(raw) : {};
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch (err) {
      console.warn("No se pudo leer el progreso guardado", err);
      return {};
    }
  }

  function saveProgress() {
    try {
      localStorage.setItem(STORAGE_PROGRESS, JSON.stringify(state.progress));
    } catch (err) {
      console.warn("No se pudo guardar el progreso", err);
    }
  }

  function defaultConfig() {
    const topics = [];
    for (const c of CATEGORIES) for (const t of topicsOf(c.id)) topics.push(topicKey(c.id, t));
    return { mode: "write", cats: CATEGORIES.map((c) => c.id), topics: topics, count: 20, timer: 0, prioritize: true };
  }

  function loadConfig() {
    const def = defaultConfig();
    try {
      const raw = localStorage.getItem(STORAGE_CONFIG);
      if (!raw) return def;
      const saved = JSON.parse(raw);
      const validTopics = new Set(def.topics);
      const cfg = {
        mode: MODE_BY_ID[saved.mode] ? saved.mode : def.mode,
        cats: Array.isArray(saved.cats) ? saved.cats.filter((c) => CAT_BY_ID[c]) : def.cats,
        topics: Array.isArray(saved.topics) ? saved.topics.filter((t) => validTopics.has(t)) : def.topics,
        count: COUNT_OPTIONS.includes(saved.count) ? saved.count : def.count,
        timer: TIMER_OPTIONS.includes(saved.timer) ? saved.timer : def.timer,
        prioritize: typeof saved.prioritize === "boolean" ? saved.prioritize : def.prioritize
      };
      return cfg;
    } catch (err) {
      console.warn("No se pudo leer la configuracion guardada", err);
      return def;
    }
  }

  function saveConfig() {
    try {
      localStorage.setItem(STORAGE_CONFIG, JSON.stringify(state.config));
    } catch (err) {
      console.warn("No se pudo guardar la configuracion", err);
    }
  }

  function statsOf(item) {
    return state.progress[item.id] || { ok: 0, fail: 0, last: 0 };
  }

  function recordResult(item, correct) {
    const s = statsOf(item);
    const next = { ok: s.ok + (correct ? 1 : 0), fail: s.fail + (correct ? 0 : 1), last: Date.now() };
    state.progress[item.id] = next;
    saveProgress();
  }

  // Tema

  function applyTheme(theme) {
    document.documentElement.setAttribute("data-theme", theme);
  }

  function initTheme() {
    let theme = null;
    try {
      theme = localStorage.getItem(STORAGE_THEME);
    } catch (err) {
      theme = null;
    }
    if (theme !== "light" && theme !== "dark") {
      theme = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    }
    applyTheme(theme);
    document.getElementById("theme-toggle").addEventListener("click", () => {
      const next = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
      applyTheme(next);
      try {
        localStorage.setItem(STORAGE_THEME, next);
      } catch (err) {
        console.warn("No se pudo guardar el tema", err);
      }
    });
  }

  // Componentes de marcado

  function iconSvg(id, cls) {
    return '<svg class="icon ' + (cls || "") + '" aria-hidden="true"><use href="#i-' + id + '"/></svg>';
  }

  function catIcon(cat) {
    return '<span class="cat-icon" style="--cat:' + cat.color + '">' + iconSvg(cat.id) + "</span>";
  }

  function tiles(text, size) {
    const cls = "tiles" + (size ? " " + size : "");
    let out = '<span class="' + cls + '" aria-label="' + esc(text) + '">';
    for (const ch of text) {
      if (ch === " ") out += '<span class="tile space" aria-hidden="true"></span>';
      else if (/[A-Za-z0-9]/.test(ch)) out += '<span class="tile" aria-hidden="true">' + esc(ch) + "</span>";
      else out += '<span class="tile sym" aria-hidden="true">' + esc(ch) + "</span>";
    }
    return out + "</span>";
  }

  function catChip(cat, topic) {
    return (
      '<span class="stage-cat">' + catIcon(cat) + "<span>" + esc(cat.name) + "</span>" +
      (topic ? '<span class="sep">/</span><span>' + esc(topic) + "</span>" : "") + "</span>"
    );
  }

  // Seleccion del banco

  function currentPool() {
    const topics = new Set(state.config.topics);
    const cats = new Set(state.config.cats);
    return ITEMS.filter((it) => cats.has(it.c) && topics.has(topicKey(it.c, it.t)));
  }

  function selectionWeight(it) {
    const s = statsOf(it);
    const seen = s.ok + s.fail > 0;
    return 1 + 3 * s.fail + (seen ? 0 : 0.8) - Math.min(s.ok, 4) * 0.2;
  }

  function buildQueue(pool, count, prioritize) {
    const n = count === 0 ? pool.length : count === -1 ? Math.min(INFINITE_BATCH, pool.length) : Math.min(count, pool.length);
    if (prioritize) return weightedSample(pool, n, selectionWeight);
    return shuffle(pool).slice(0, n);
  }

  // En modo infinito se anaden tandas nuevas evitando repetir lo recien preguntado.
  function extendQueue(session) {
    const pool = currentPool();
    if (!pool.length) return;
    const recent = new Set(session.queue.slice(-Math.min(5, Math.max(0, pool.length - 1))).map((it) => it.id));
    const candidates = pool.filter((it) => !recent.has(it.id));
    const source = candidates.length ? candidates : pool;
    const batch = buildQueue(source, -1, state.config.prioritize);
    session.queue = session.queue.concat(batch);
  }

  // Sesion

  function startSession(queue, modeId, infinite) {
    state.session = {
      mode: modeId,
      infinite: !!infinite,
      queue: queue,
      i: 0,
      results: [],
      startedAt: Date.now(),
      streak: 0,
      bestStreak: 0,
      current: null
    };
    state.view = "practice";
    prepareQuestion();
    render();
  }

  function pickQuestionMode(modeId) {
    if (modeId !== "mixed") return modeId;
    const opts = ["write", "choice", "reverse"];
    return opts[Math.floor(Math.random() * opts.length)];
  }

  function buildOptions(item) {
    const target = normText(item.e);
    const sameCat = ITEMS.filter((o) => o.c === item.c && o.id !== item.id && normText(o.e) !== target);
    const others = ITEMS.filter((o) => o.c !== item.c && normText(o.e) !== target);
    const chosen = [];
    const used = new Set([target]);
    for (const o of shuffle(sameCat).concat(shuffle(others))) {
      const k = normText(o.e);
      if (used.has(k)) continue;
      used.add(k);
      chosen.push(o);
      if (chosen.length === 3) break;
    }
    return shuffle([item].concat(chosen));
  }

  function prepareQuestion() {
    const s = state.session;
    const item = s.queue[s.i];
    const qmode = pickQuestionMode(s.mode);
    s.current = {
      item: item,
      qmode: qmode,
      options: qmode === "choice" ? buildOptions(item) : null,
      hintLevel: 0,
      answered: false,
      result: null,
      remaining: state.config.timer,
      startedAt: Date.now()
    };
  }

  function clearTimer() {
    if (timerHandle) {
      clearInterval(timerHandle);
      timerHandle = null;
    }
  }

  function startTimer() {
    clearTimer();
    const cur = state.session && state.session.current;
    if (!cur || !state.config.timer || cur.answered) return;
    timerHandle = setInterval(() => {
      const c = state.session && state.session.current;
      if (!c || c.answered) {
        clearTimer();
        return;
      }
      c.remaining -= 1;
      updateTimerDisplay();
      if (c.remaining <= 0) {
        clearTimer();
        submitAnswer(null, true);
      }
    }, 1000);
  }

  function updateTimerDisplay() {
    const el = app.querySelector("[data-timer]");
    const cur = state.session && state.session.current;
    if (!el || !cur) return;
    el.textContent = cur.remaining + " s";
    el.parentElement.classList.toggle("timer-low", cur.remaining <= 5);
  }

  function checkWritten(item, answer) {
    const given = normText(answer);
    if (!given) return { correct: false, close: false };
    const candidates = [item.e].concat(item.alt || []).map(normText);
    if (candidates.includes(given)) return { correct: true, close: false };
    const best = Math.max.apply(null, candidates.map((c) => similarity(c, given)));
    return { correct: best >= 0.86, close: best >= 0.86 };
  }

  function checkReverse(item, answer) {
    const given = normAcronym(answer);
    if (!given) return { correct: false, close: false };
    return { correct: given === normAcronym(item.a), close: false };
  }

  function submitAnswer(answer, timedOut) {
    const s = state.session;
    const cur = s.current;
    if (!cur || cur.answered) return;
    clearTimer();
    const item = cur.item;
    let verdict;
    let shown = answer;
    if (timedOut) {
      verdict = { correct: false, close: false };
      shown = "";
    } else if (cur.qmode === "choice") {
      verdict = { correct: answer && answer.id === item.id, close: false };
      shown = answer ? answer.e : "";
    } else if (cur.qmode === "reverse") {
      verdict = checkReverse(item, answer || "");
    } else {
      verdict = checkWritten(item, answer || "");
    }
    cur.answered = true;
    cur.result = {
      item: item,
      qmode: cur.qmode,
      correct: !!verdict.correct,
      close: !!verdict.close,
      hint: cur.hintLevel > 0,
      answer: shown,
      timedOut: !!timedOut,
      ms: Date.now() - cur.startedAt
    };
    s.results.push(cur.result);
    if (cur.result.correct) {
      s.streak += 1;
      s.bestStreak = Math.max(s.bestStreak, s.streak);
    } else {
      s.streak = 0;
    }
    recordResult(item, cur.result.correct);
    renderPractice(true);
  }

  function nextQuestion() {
    const s = state.session;
    if (!s || !s.current || !s.current.answered) return;
    if (s.i + 1 >= s.queue.length) {
      if (s.infinite) extendQueue(s);
      if (s.i + 1 >= s.queue.length) {
        s.finishedAt = Date.now();
        state.view = "results";
        render();
        return;
      }
    }
    s.i += 1;
    prepareQuestion();
    renderPractice(false);
  }

  // Marcador en vivo: compara palabra por palabra y letra por letra lo escrito con la respuesta.

  function hintMax(qmode) {
    return qmode === "reverse" ? 2 : 5;
  }

  function splitWords(s) {
    return stripAccents(String(s)).split(/[^A-Za-z0-9]+/).filter(Boolean);
  }

  function revealCount(len, level) {
    const table = [0, 1, 2, 3, Math.ceil(len / 2), len - 1];
    let r = 0;
    for (let l = 1; l <= level && l < table.length; l++) r = Math.max(r, table[l]);
    return Math.max(0, Math.min(len, r));
  }

  function expectedWords(item, qmode) {
    return qmode === "reverse" ? [item.a.replace(/[^A-Za-z0-9]/g, "")] : splitWords(item.e);
  }

  function renderWord(ew, uw, reveal, showBlanks) {
    let html = "";
    let complete = uw !== null && uw.length === ew.length;
    const len = Math.max(ew.length, uw === null ? 0 : uw.length);
    for (let j = 0; j < len; j++) {
      if (uw !== null && j < uw.length) {
        const ok = j < ew.length && uw[j].toLowerCase() === ew[j].toLowerCase();
        if (!ok) complete = false;
        html += '<span class="tl ' + (ok ? "ok" : "bad") + '">' + esc(uw[j]) + "</span>";
      } else if (j < reveal) {
        html += '<span class="tl hint">' + esc(ew[j]) + "</span>";
      } else if (showBlanks) {
        html += '<span class="tl blank">_</span>';
      }
    }
    return { html: html, complete: complete };
  }

  function trackerHtml(item, typed, level, qmode) {
    const exp = expectedWords(item, qmode);
    const usr = qmode === "reverse" ? [typed.replace(/[^A-Za-z0-9]/g, "")].filter(Boolean) : splitWords(typed);
    const withHint = level > 0;
    let u = 0;
    let okWords = 0;
    let parts = "";
    for (let i = 0; i < exp.length; i++) {
      const ew = exp[i];
      const isStop = STOPWORDS.has(ew.toLowerCase());
      let uw = u < usr.length ? usr[u] : null;
      while (uw !== null && STOPWORDS.has(uw.toLowerCase()) && uw.toLowerCase() !== ew.toLowerCase() && !isStop) {
        u++;
        uw = u < usr.length ? usr[u] : null;
      }
      const matchesStop = isStop && uw !== null && uw.toLowerCase() === ew.toLowerCase();
      if (isStop && !matchesStop) {
        if (withHint || u < usr.length) parts += '<span class="tw stop">' + esc(ew) + "</span>";
        continue;
      }
      if (uw === null) {
        if (withHint) parts += '<span class="tw">' + renderWord(ew, null, revealCount(ew.length, level), true).html + "</span>";
        continue;
      }
      const r = renderWord(ew, uw, revealCount(ew.length, level), withHint);
      if (r.complete && !isStop) okWords++;
      parts += '<span class="tw' + (r.complete ? " done" : "") + (isStop ? " stop" : "") + '">' + r.html + "</span>";
      u++;
    }
    for (; u < usr.length; u++) {
      parts += '<span class="tw extra">' + esc(usr[u]) + "</span>";
    }
    const total = exp.filter((w) => !STOPWORDS.has(w.toLowerCase())).length;
    let summary = "";
    if (okWords >= total && usr.length) summary = "Todo coincide, pulsa Enter";
    else if (withHint) summary = okWords + " de " + total + (total === 1 ? " palabra" : " palabras");
    else if (usr.length) summary = plural(okWords, "palabra bien", "palabras bien");
    else summary = "Escribe y verás cómo vas";
    return '<div class="tracker-words">' + parts + '</div><div class="tracker-summary">' + summary + "</div>";
  }

  function updateTracker() {
    const cur = state.session && state.session.current;
    const box = app.querySelector("[data-tracker]");
    const input = app.querySelector(".answer-input");
    if (!cur || !box || !input) return;
    box.innerHTML = trackerHtml(cur.item, input.value, cur.hintLevel, cur.qmode);
  }

  function hintButtonLabel(cur) {
    const max = hintMax(cur.qmode);
    if (cur.hintLevel >= max) return "Sin más pistas";
    return cur.hintLevel === 0 ? "Pista" : "Pista " + (cur.hintLevel + 1) + " de " + max;
  }

  // Render: configuracion

  function renderSetup() {
    const cfg = state.config;
    const pool = currentPool();
    const selectedCats = new Set(cfg.cats);
    const selectedTopics = new Set(cfg.topics);
    const counts = {};
    for (const it of ITEMS) {
      counts[it.c] = (counts[it.c] || 0) + 1;
      const k = topicKey(it.c, it.t);
      counts[k] = (counts[k] || 0) + 1;
    }

    const modeCards = MODES.map((m) => {
      let sample = "";
      if (m.id === "write") sample = '<span class="mini-tile">S</span><span class="mini-tile">I</span><span class="mini-line"></span>';
      else if (m.id === "choice") sample = '<span class="mini-tile">E</span><span class="mini-line ok"></span><span class="mini-line"></span>';
      else if (m.id === "reverse") sample = '<span class="mini-line"></span><span class="mini-tile">?</span>';
      else sample = '<span class="mini-tile">M</span><span class="mini-line"></span><span class="mini-tile">?</span>';
      return (
        '<button type="button" class="mode-card" data-mode="' + m.id + '" aria-pressed="' + (cfg.mode === m.id) + '">' +
        '<span class="mode-sample" aria-hidden="true">' + sample + "</span>" +
        "<h3>" + esc(m.name) + "</h3><p>" + esc(m.desc) + "</p></button>"
      );
    }).join("");

    const catCards = CATEGORIES.map((c) => {
      const on = selectedCats.has(c.id);
      return (
        '<button type="button" class="cat-card" style="--cat:' + c.color + '" data-cat="' + c.id + '" aria-pressed="' + on + '">' +
        catIcon(c) + '<span class="cat-name">' + esc(c.name) + '</span><span class="cat-count">' + counts[c.id] + "</span></button>"
      );
    }).join("");

    const topicGroups = CATEGORIES.filter((c) => selectedCats.has(c.id))
      .map((c) => {
        const chips = topicsOf(c.id)
          .map((t) => {
            const k = topicKey(c.id, t);
            return (
              '<button type="button" class="chip" data-topic="' + esc(k) + '" aria-pressed="' + selectedTopics.has(k) + '">' +
              esc(t) + '<span class="count">' + counts[k] + "</span></button>"
            );
          })
          .join("");
        return (
          '<div class="topic-group" style="--cat:' + c.color + '"><div class="topic-group-name"><span class="dot"></span>' + esc(c.name) +
          '</div><div class="chips">' + chips + "</div></div>"
        );
      })
      .join("");

    const countSeg = COUNT_OPTIONS.map((n) =>
      '<button type="button" data-count="' + n + '" aria-pressed="' + (cfg.count === n) + '">' + (n === 0 ? "Todos" : n === -1 ? "Infinito" : n) + "</button>"
    ).join("");
    const timerSeg = TIMER_OPTIONS.map((n) =>
      '<button type="button" data-timer-opt="' + n + '" aria-pressed="' + (cfg.timer === n) + '">' + (n === 0 ? "Sin límite" : n + " s") + "</button>"
    ).join("");

    const effective = cfg.count === 0 ? pool.length : Math.min(cfg.count, pool.length);
    const modeName = MODE_BY_ID[cfg.mode].name;
    const summary = cfg.count === -1 ? "Infinito, " + pool.length + " acrónimos en rotación" : effective + " de " + pool.length + " acrónimos";

    app.innerHTML =
      '<div class="setup">' +
      '<div class="setup-hero"><div><h1>Las siglas que siempre se te escapan</h1>' +
      '<p class="muted">Elige cómo practicar, qué categorías y qué temas. Al escribir se acepta cualquier forma razonable: sin acentos, sin guiones y sin importar mayúsculas.</p></div>' +
      '<div class="demo-tiles" aria-hidden="true">' + tiles("SIEM", "small") + "</div></div>" +
      '<section class="section" aria-labelledby="h-mode"><div class="section-head"><h2 id="h-mode">Modo</h2></div><div class="mode-grid">' + modeCards + "</div></section>" +
      '<section class="section" aria-labelledby="h-cats"><div class="section-head"><h2 id="h-cats">Categorías</h2><div class="actions">' +
      '<button type="button" class="link-btn" data-cats-all>Todas</button><button type="button" class="link-btn" data-cats-none>Ninguna</button></div></div>' +
      '<div class="cat-grid">' + catCards + "</div></section>" +
      '<section class="section" aria-labelledby="h-topics"><div class="section-head"><h2 id="h-topics">Temas</h2><div class="actions">' +
      '<button type="button" class="link-btn" data-topics-all>Todos</button><button type="button" class="link-btn" data-topics-none>Ninguno</button></div></div>' +
      (topicGroups ? '<div class="topic-groups">' + topicGroups + "</div>" : '<div class="empty">Selecciona al menos una categoría para ver sus temas.</div>') +
      "</section>" +
      '<section class="section" aria-labelledby="h-settings"><div class="section-head"><h2 id="h-settings">Sesión</h2></div><div class="settings-grid">' +
      '<div class="setting"><span class="setting-label">Preguntas</span><div class="segmented" role="group" aria-label="Número de preguntas">' + countSeg + "</div>" +
      '<span class="setting-help">' + (cfg.count === -1 ? "Siguen saliendo acrónimos hasta que termines la sesión." : "Si el banco elegido tiene menos, se usan todas.") + "</span></div>" +
      '<div class="setting"><span class="setting-label">Tiempo por pregunta</span><div class="segmented" role="group" aria-label="Tiempo por pregunta">' + timerSeg + "</div>" +
      '<span class="setting-help">Al agotarse cuenta como fallo y se muestra la respuesta.</span></div>' +
      '<div class="setting"><span class="setting-label">Orden</span><button type="button" class="switch" role="switch" aria-checked="' + cfg.prioritize + '" data-prioritize>' +
      '<span class="switch-track"></span><span>Priorizar lo que fallo y lo nuevo</span></button>' +
      '<span class="setting-help">Usa tu historial para que salgan más seguido los acrónimos que fallas o que no has visto.</span></div>' +
      "</div></section>" +
      '<div class="start-bar"><div class="summary"><strong>' + summary + "</strong><span>" + esc(modeName) +
      (cfg.timer ? ", " + cfg.timer + " s por pregunta" : "") + "</span></div>" +
      '<button type="button" class="btn btn-primary btn-lg" data-start' + (pool.length ? "" : " disabled") + ">Empezar</button></div>" +
      "</div>";
  }

  function bindSetup(e) {
    const t = e.target;
    const cfg = state.config;
    const modeBtn = t.closest("[data-mode]");
    if (modeBtn) {
      cfg.mode = modeBtn.getAttribute("data-mode");
      saveConfig();
      renderSetup();
      return;
    }
    const catBtn = t.closest("[data-cat]");
    if (catBtn) {
      const id = catBtn.getAttribute("data-cat");
      const keys = topicsOf(id).map((tp) => topicKey(id, tp));
      if (cfg.cats.includes(id)) {
        cfg.cats = cfg.cats.filter((c) => c !== id);
        cfg.topics = cfg.topics.filter((k) => !keys.includes(k));
      } else {
        cfg.cats.push(id);
        for (const k of keys) if (!cfg.topics.includes(k)) cfg.topics.push(k);
      }
      saveConfig();
      renderSetup();
      return;
    }
    const topicBtn = t.closest("[data-topic]");
    if (topicBtn) {
      const k = topicBtn.getAttribute("data-topic");
      cfg.topics = cfg.topics.includes(k) ? cfg.topics.filter((x) => x !== k) : cfg.topics.concat([k]);
      saveConfig();
      renderSetup();
      return;
    }
    if (t.closest("[data-cats-all]")) {
      const def = defaultConfig();
      cfg.cats = def.cats;
      cfg.topics = def.topics;
      saveConfig();
      renderSetup();
      return;
    }
    if (t.closest("[data-cats-none]")) {
      cfg.cats = [];
      cfg.topics = [];
      saveConfig();
      renderSetup();
      return;
    }
    if (t.closest("[data-topics-all]")) {
      cfg.topics = [];
      for (const c of cfg.cats) for (const tp of topicsOf(c)) cfg.topics.push(topicKey(c, tp));
      saveConfig();
      renderSetup();
      return;
    }
    if (t.closest("[data-topics-none]")) {
      cfg.topics = [];
      saveConfig();
      renderSetup();
      return;
    }
    const countBtn = t.closest("[data-count]");
    if (countBtn) {
      cfg.count = Number(countBtn.getAttribute("data-count"));
      saveConfig();
      renderSetup();
      return;
    }
    const timerBtn = t.closest("[data-timer-opt]");
    if (timerBtn) {
      cfg.timer = Number(timerBtn.getAttribute("data-timer-opt"));
      saveConfig();
      renderSetup();
      return;
    }
    if (t.closest("[data-prioritize]")) {
      cfg.prioritize = !cfg.prioritize;
      saveConfig();
      renderSetup();
      return;
    }
    if (t.closest("[data-start]")) {
      const pool = currentPool();
      if (!pool.length) return;
      startSession(buildQueue(pool, cfg.count, cfg.prioritize), cfg.mode, cfg.count === -1);
    }
  }

  // Render: practica

  function renderPractice(afterAnswer) {
    const s = state.session;
    const cur = s.current;
    const item = cur.item;
    const cat = CAT_BY_ID[item.c];
    const total = s.queue.length;
    const done = s.i + (cur.answered ? 1 : 0);
    const pct = s.infinite ? 100 : Math.round((done / total) * 100);
    const correctSoFar = s.results.filter((r) => r.correct).length;
    const counter = s.infinite ? "Pregunta " + (s.i + 1) : (s.i + 1) + " de " + total;

    let body = "";
    if (cur.qmode === "reverse") {
      body =
        '<div class="prompt"><p class="question">Escribe las siglas de</p><p class="expansion">' + esc(item.e) + "</p>" +
        '<p class="description">' + esc(item.d) + "</p></div>";
    } else {
      body = tiles(item.a) + (cur.qmode === "write" ? '<p class="prompt question muted" style="text-align:center">Escribe el significado completo</p>' : "");
    }

    let answerArea = "";
    if (!cur.answered) {
      if (cur.qmode === "choice") {
        answerArea =
          '<div class="options" role="group" aria-label="Opciones">' +
          cur.options
            .map(
              (o, i) =>
                '<button type="button" class="option" data-option="' + i + '"><span class="key">' + (i + 1) + "</span><span>" + esc(o.e) + "</span>" +
                iconSvg("check", "mark") + "</button>"
            )
            .join("") +
          "</div>";
      } else {
        const placeholder = cur.qmode === "reverse" ? "Siglas" : "Significado en inglés";
        answerArea =
          '<form class="answer-form" data-answer-form autocomplete="off"><div class="answer-row">' +
          '<input class="answer-input" type="text" name="answer" placeholder="' + placeholder + '" aria-label="' + placeholder + '" autocomplete="off" autocapitalize="off" spellcheck="false">' +
          '<button type="submit" class="btn btn-primary">Comprobar</button></div>' +
          '<div class="tracker" data-tracker aria-live="polite">' + trackerHtml(item, "", cur.hintLevel, cur.qmode) + "</div>" +
          '<div class="answer-tools"><span class="small muted">' + (cur.qmode === "reverse" ? "Verde: letra correcta. Rojo: no coincide." : "Verde: letra correcta. Rojo: no coincide. La pista abre los huecos.") + "</span>" +
          '<button type="button" class="btn btn-ghost" data-hint' + (cur.hintLevel >= hintMax(cur.qmode) ? " disabled" : "") + ">" + iconSvg("bulb") +
          hintButtonLabel(cur) + "</button></div></form>";
      }
    } else {
      const r = cur.result;
      if (cur.qmode === "choice") {
        answerArea =
          '<div class="options">' +
          cur.options
            .map((o, i) => {
              let cls = "option";
              let mark = "check";
              if (o.id === item.id) cls += " correct";
              else if (r.answer && normText(o.e) === normText(r.answer)) {
                cls += " wrong";
                mark = "x";
              } else cls += " dim";
              return '<button type="button" class="' + cls + '" disabled><span class="key">' + (i + 1) + "</span><span>" + esc(o.e) + "</span>" + iconSvg(mark, "mark") + "</button>";
            })
            .join("") +
          "</div>";
      }
      let title;
      if (r.correct && r.close) title = r.hint ? "Correcto, con pista y una pequeña diferencia de escritura" : "Correcto, con una pequeña diferencia de escritura";
      else if (r.correct) title = r.hint ? "Correcto, con pista" : "Correcto";
      else if (r.timedOut) title = "Se acabó el tiempo";
      else title = "No es así";
      const yours = !r.correct && r.answer ? '<p class="feedback-note">' + (cur.qmode === "choice" ? "Elegiste: " : "Escribiste: ") + esc(r.answer) + "</p>" : "";
      answerArea +=
        '<div class="feedback ' + (r.correct ? "ok" : "bad") + '" role="status"><span class="mark">' + iconSvg(r.correct ? "check" : "x") + "</span>" +
        '<div class="feedback-body"><p class="feedback-title">' + title + "</p>" +
        '<p class="feedback-answer">' + esc(item.a) + " significa " + esc(item.e) + "</p>" +
        '<p class="feedback-desc">' + esc(item.d) + "</p>" + yours + "</div></div>" +
        '<div class="stage-foot"><div class="keys"><span><kbd>Enter</kbd> siguiente</span></div>' +
        '<button type="button" class="btn btn-primary" data-next autofocus>' + (!s.infinite && s.i + 1 >= total ? "Ver resultados" : "Siguiente") + "</button></div>";
    }

    const keysHelp = cur.answered
      ? ""
      : cur.qmode === "choice"
        ? '<div class="keys"><span><kbd>1</kbd><kbd>2</kbd><kbd>3</kbd><kbd>4</kbd> elegir</span></div>'
        : '<div class="keys"><span><kbd>Enter</kbd> comprobar</span><span><kbd>Alt</kbd>+<kbd>H</kbd> pista</span></div>';

    app.innerHTML =
      '<div class="practice">' +
      '<div class="practice-top"><div class="practice-meta"><div class="stats">' +
      '<span class="stat">' + counter + "</span>" +
      '<span class="stat">' + iconSvg("check") + correctSoFar + "</span>" +
      '<span class="stat' + (s.streak >= 3 ? " streak-hot" : "") + '">' + iconSvg("flame") + s.streak + "</span>" +
      (state.config.timer ? '<span class="stat' + (cur.remaining <= 5 ? " timer-low" : "") + '">' + iconSvg("clock") + "<span data-timer>" + cur.remaining + " s</span></span>" : "") +
      "</div>" +
      '<button type="button" class="btn btn-ghost" data-quit>' + iconSvg("back") + (s.infinite ? "Terminar" : "Salir") + "</button></div>" +
      (s.infinite
        ? '<div class="progress-track infinite" aria-hidden="true"><div class="progress-fill"></div></div></div>'
        : '<div class="progress-track" role="progressbar" aria-valuenow="' + done + '" aria-valuemin="0" aria-valuemax="' + total + '"><div class="progress-fill" style="width:' + pct + '%"></div></div></div>') +
      '<div class="stage" style="--cat:' + cat.color + '"><div class="stage-body">' +
      catChip(cat, item.t) + body + answerArea + keysHelp +
      "</div></div></div>";

    const tilesEl = app.querySelector(".stage .tiles");
    if (afterAnswer && tilesEl) tilesEl.classList.add(cur.result.correct ? "pop" : "shake");
    if (afterAnswer && cur.qmode === "reverse") {
      const stage = app.querySelector(".stage");
      if (stage && !cur.result.correct) stage.classList.add("shake");
    }

    const input = app.querySelector(".answer-input");
    if (input) input.focus({ preventScroll: true });
    const nextBtn = app.querySelector("[data-next]");
    if (nextBtn) nextBtn.focus({ preventScroll: true });
    if (!afterAnswer) window.scrollTo({ top: 0 });

    if (!cur.answered) startTimer();
  }

  function bindPractice(e) {
    const t = e.target;
    const s = state.session;
    if (!s) return;
    const opt = t.closest("[data-option]");
    if (opt && !s.current.answered) {
      submitAnswer(s.current.options[Number(opt.getAttribute("data-option"))], false);
      return;
    }
    if (t.closest("[data-hint]")) {
      useHint();
      return;
    }
    if (t.closest("[data-next]")) {
      nextQuestion();
      return;
    }
    if (t.closest("[data-quit]")) {
      quitSession();
    }
  }

  function useHint() {
    const cur = state.session && state.session.current;
    if (!cur || cur.answered || cur.qmode === "choice" || cur.hintLevel >= hintMax(cur.qmode)) return;
    cur.hintLevel += 1;
    updateTracker();
    const btn = app.querySelector("[data-hint]");
    if (btn) {
      btn.innerHTML = iconSvg("bulb") + hintButtonLabel(cur);
      if (cur.hintLevel >= hintMax(cur.qmode)) btn.disabled = true;
    }
    const input = app.querySelector(".answer-input");
    if (input) input.focus();
  }

  function quitSession() {
    const s = state.session;
    if (s && s.infinite && s.results.length) {
      clearTimer();
      s.finishedAt = Date.now();
      state.view = "results";
      render();
      return;
    }
    if (s && s.results.length && s.results.length < s.queue.length) {
      if (!window.confirm("¿Salir de la práctica? Se perderá el resumen de esta sesión, pero tu progreso ya quedó guardado.")) return;
    }
    clearTimer();
    state.session = null;
    state.view = "setup";
    render();
  }

  function onPracticeSubmit(e) {
    const form = e.target.closest("[data-answer-form]");
    if (!form) return;
    e.preventDefault();
    const input = form.querySelector(".answer-input");
    submitAnswer(input ? input.value : "", false);
  }

  function onPracticeKey(e) {
    const s = state.session;
    if (!s || !s.current) return;
    const cur = s.current;
    if (cur.answered) {
      if (e.key === "Enter") {
        e.preventDefault();
        nextQuestion();
      }
      return;
    }
    if (cur.qmode === "choice" && /^[1-4]$/.test(e.key) && !e.altKey && !e.ctrlKey && !e.metaKey) {
      const idx = Number(e.key) - 1;
      if (cur.options[idx]) {
        e.preventDefault();
        submitAnswer(cur.options[idx], false);
      }
      return;
    }
    if (e.altKey && (e.key === "h" || e.key === "H")) {
      e.preventDefault();
      useHint();
    }
  }

  // Render: resultados

  function renderResults() {
    const s = state.session;
    const total = s.results.length;
    const correct = s.results.filter((r) => r.correct).length;
    const wrong = s.results.filter((r) => !r.correct);
    const pct = total ? Math.round((correct / total) * 100) : 0;
    const elapsed = (s.finishedAt || Date.now()) - s.startedAt;

    const strip = s.results
      .map((r) => {
        const cls = "score-cell" + (r.correct ? (r.hint || r.close ? " hint" : "") : " bad");
        const label = r.correct ? (r.hint ? "correcto con pista" : "correcto") : "fallo";
        return '<span class="' + cls + '" title="' + esc(r.item.a + ": " + label) + '">' + esc(r.item.a) + "</span>";
      })
      .join("");

    const review = wrong.length
      ? '<section class="section"><div class="section-head"><h2>Para repasar</h2><span class="muted small">' + wrong.length + (wrong.length === 1 ? " fallo" : " fallos") + "</span></div>" +
        '<div class="review-list">' +
        wrong
          .map((r) => {
            const cat = CAT_BY_ID[r.item.c];
            const yours = r.timedOut ? "Sin respuesta, se acabó el tiempo" : r.answer ? (r.qmode === "choice" ? "Elegiste " : "Escribiste ") + "<s>" + esc(r.answer) + "</s>" : "Sin respuesta";
            return (
              '<div class="review-item" style="--cat:' + cat.color + '">' + tiles(r.item.a, "small") +
              '<div class="body"><p class="right">' + esc(r.item.e) + '</p><p class="yours">' + yours + '</p><p class="desc">' + esc(r.item.d) + "</p>" +
              '<p class="cat"><span class="dot"></span>' + esc(cat.name) + "</p></div></div>"
            );
          })
          .join("") +
        "</div></section>"
      : '<div class="empty">Sin fallos en esta sesión. Prueba con más preguntas, otra categoría o el modo inverso.</div>';

    let headline;
    if (pct === 100) headline = "Sesión perfecta";
    else if (pct >= 80) headline = "Casi todo en su sitio";
    else if (pct >= 50) headline = "Vas por buen camino";
    else headline = "Toca repasar";

    app.innerHTML =
      '<div class="results"><div class="results-head"><h1>' + headline + "</h1>" +
      '<p class="muted">' + correct + " de " + total + " en modo " + esc(MODE_BY_ID[s.mode].name).toLowerCase() + (s.infinite ? ", sesión infinita" : "") + ".</p></div>" +
      '<div class="score-strip" aria-label="Resultado por pregunta">' + strip + "</div>" +
      '<div class="results-figures">' +
      '<div class="figure"><strong>' + pct + " %</strong><span>precisión</span></div>" +
      '<div class="figure"><strong>' + s.bestStreak + "</strong><span>mejor racha</span></div>" +
      '<div class="figure"><strong>' + formatTime(elapsed) + "</strong><span>tiempo total</span></div>" +
      '<div class="figure"><strong>' + formatTime(total ? elapsed / total : 0) + "</strong><span>por pregunta</span></div>" +
      "</div>" +
      '<div class="results-actions">' +
      (wrong.length ? '<button type="button" class="btn btn-primary" data-retry-wrong>Repasar los fallos</button>' : "") +
      '<button type="button" class="btn' + (wrong.length ? "" : " btn-primary") + '" data-repeat>' + (s.infinite ? "Otra sesión infinita" : "Repetir con otras preguntas") + "</button>" +
      '<button type="button" class="btn btn-ghost" data-nav="setup">Cambiar configuración</button>' +
      "</div>" + review + "</div>";
  }

  function bindResults(e) {
    const t = e.target;
    const s = state.session;
    if (t.closest("[data-retry-wrong]")) {
      const wrongItems = s.results.filter((r) => !r.correct).map((r) => r.item);
      startSession(shuffle(wrongItems), s.mode, false);
      return;
    }
    if (t.closest("[data-repeat]")) {
      const pool = currentPool();
      startSession(buildQueue(pool, state.config.count, state.config.prioritize), s.mode, state.config.count === -1);
    }
  }

  // Render: glosario

  function renderGlossary() {
    const g = state.glossary;
    const q = normText(g.q);
    const qa = normAcronym(g.q);
    let list = ITEMS;
    if (g.cat !== "all") list = list.filter((it) => it.c === g.cat);
    if (q) {
      list = list.filter((it) => normAcronym(it.a).includes(qa) || normText(it.e).includes(q) || normText(it.d).includes(q) || normText(it.t).includes(q));
    }

    const chips =
      '<button type="button" class="chip" data-gcat="all" aria-pressed="' + (g.cat === "all") + '">Todas</button>' +
      CATEGORIES.map((c) => '<button type="button" class="chip" data-gcat="' + c.id + '" aria-pressed="' + (g.cat === c.id) + '">' + esc(c.name) + "</button>").join("");

    const groups = CATEGORIES.map((c) => {
      const entries = list.filter((it) => it.c === c.id);
      if (!entries.length) return "";
      return (
        '<section class="glossary-group" style="--cat:' + c.color + '"><h2>' + catIcon(c) + esc(c.name) + '<span class="count">' + entries.length + "</span></h2>" +
        '<div class="entry-list">' +
        entries
          .map((it) => {
            const st = statsOf(it);
            return (
              '<div class="entry">' + tiles(it.a, "small") +
              '<div class="body"><p class="exp">' + esc(it.e) + '</p><p class="desc">' + esc(it.d) + '</p><p class="topic">' + esc(it.t) + "</p></div>" +
              masteryDots(st) + "</div>"
            );
          })
          .join("") +
        "</div></section>"
      );
    }).join("");

    app.innerHTML =
      '<div class="glossary"><div class="section-head"><h1>Glosario</h1><span class="muted">' + list.length + " de " + ITEMS.length + "</span></div>" +
      '<div class="glossary-tools"><label class="search">' + iconSvg("search") +
      '<input type="search" data-gsearch placeholder="Buscar siglas, significado o descripción" value="' + esc(g.q) + '" aria-label="Buscar en el glosario"></label>' +
      '<div class="chips">' + chips + "</div></div>" +
      (groups || '<div class="empty">Nada coincide con esa búsqueda.</div>') + "</div>";
  }

  function focusGlossarySearch() {
    const input = app.querySelector("[data-gsearch]");
    if (input && window.matchMedia("(min-width: 761px)").matches) input.focus({ preventScroll: true });
  }

  function masteryDots(st) {
    const total = st.ok + st.fail;
    if (!total) return '<span class="mastery" title="Sin practicar"><i></i><i></i><i></i><i></i><i></i></span>';
    const okDots = Math.round((st.ok / total) * 5);
    let out = '<span class="mastery" title="' + plural(st.ok, "acierto", "aciertos") + ", " + plural(st.fail, "fallo", "fallos") + '">';
    for (let i = 0; i < 5; i++) out += '<i class="' + (i < okDots ? "ok" : "bad") + '"></i>';
    return out + "</span>";
  }

  function bindGlossary(e) {
    const chip = e.target.closest("[data-gcat]");
    if (chip) {
      state.glossary.cat = chip.getAttribute("data-gcat");
      renderGlossary();
      const input = app.querySelector("[data-gsearch]");
      if (input) input.focus();
    }
  }

  function onGlossaryInput(e) {
    const input = e.target.closest("[data-gsearch]");
    if (!input) return;
    state.glossary.q = input.value;
    const pos = input.selectionStart;
    renderGlossary();
    const fresh = app.querySelector("[data-gsearch]");
    if (fresh) {
      fresh.focus();
      try {
        fresh.setSelectionRange(pos, pos);
      } catch (err) {
        // Algunos navegadores no permiten fijar la seleccion en type=search.
      }
    }
  }

  // Render: progreso

  function renderProgress() {
    const perCat = CATEGORIES.map((c) => {
      const its = ITEMS.filter((it) => it.c === c.id);
      let seen = 0;
      let ok = 0;
      let fail = 0;
      let mastered = 0;
      for (const it of its) {
        const st = statsOf(it);
        if (st.ok + st.fail) seen++;
        ok += st.ok;
        fail += st.fail;
        if (st.ok >= 2 && st.ok > st.fail) mastered++;
      }
      return { cat: c, total: its.length, seen: seen, ok: ok, fail: fail, mastered: mastered };
    });

    const totalAnswers = perCat.reduce((a, p) => a + p.ok + p.fail, 0);

    const catRows = perCat
      .map((p) => {
        const acc = p.ok + p.fail ? Math.round((p.ok / (p.ok + p.fail)) * 100) : null;
        const seenPct = (p.seen / p.total) * 100;
        const masteredPct = (p.mastered / p.total) * 100;
        return (
          '<div class="cat-progress" style="--cat:' + p.cat.color + '">' + catIcon(p.cat) +
          '<div class="bars"><div class="label"><span>' + esc(p.cat.name) + "</span><span>" + plural(p.mastered, "dominado", "dominados") + ", " + plural(p.seen, "visto", "vistos") + " de " + p.total + "</span></div>" +
          '<div class="bar" aria-hidden="true"><i class="ok" style="width:' + masteredPct + '%"></i><i class="seen" style="width:' + Math.max(0, seenPct - masteredPct) + '%"></i></div></div>' +
          '<span class="pct">' + (acc === null ? "" : acc + " %") + "</span></div>"
        );
      })
      .join("");

    const weak = ITEMS.map((it) => ({ it: it, st: statsOf(it) }))
      .filter((x) => x.st.fail > 0)
      .sort((a, b) => b.st.fail - b.st.ok - (a.st.fail - a.st.ok) || b.st.last - a.st.last)
      .slice(0, 12);

    const weakList = weak.length
      ? '<div class="weak-list">' +
        weak
          .map((x) => {
            const cat = CAT_BY_ID[x.it.c];
            return (
              '<div class="weak-item" style="--cat:' + cat.color + '">' + tiles(x.it.a, "tiny") +
              '<div><p class="exp">' + esc(x.it.e) + '</p><p class="cat">' + esc(cat.name) + "</p></div>" +
              '<span class="ratio"><b>' + x.st.fail + "</b>" + (x.st.fail === 1 ? " fallo, " : " fallos, ") + plural(x.st.ok, "acierto", "aciertos") + "</span></div>"
            );
          })
          .join("") +
        "</div>"
      : '<div class="empty">Aún no hay fallos registrados. Cuando los haya, aparecerán aquí para que los repases.</div>';

    app.innerHTML =
      '<div class="progress-view"><div class="section-head"><h1>Progreso</h1><span class="muted">' + totalAnswers + (totalAnswers === 1 ? " respuesta" : " respuestas") + " registradas</span></div>" +
      '<p class="muted" style="max-width:60ch">Un acrónimo cuenta como dominado cuando lo has acertado al menos dos veces y más veces de las que lo has fallado. El porcentaje es tu precisión en esa categoría.</p>' +
      '<section class="section"><div class="section-head"><h2>Por categoría</h2></div><div class="cat-progress-list">' + catRows + "</div></section>" +
      '<section class="section"><div class="section-head"><h2>Los que más fallas</h2>' +
      (weak.length ? '<button type="button" class="btn btn-primary" data-practice-weak>Practicar estos</button>' : "") + "</div>" + weakList + "</section>" +
      '<section class="section"><div class="section-head"><h2>Datos</h2></div>' +
      '<div><button type="button" class="btn" data-reset-progress' + (totalAnswers ? "" : " disabled") + ">Borrar todo el progreso</button></div></section></div>";
  }

  function bindProgress(e) {
    const t = e.target;
    if (t.closest("[data-practice-weak]")) {
      const weak = ITEMS.filter((it) => statsOf(it).fail > 0)
        .sort((a, b) => statsOf(b).fail - statsOf(b).ok - (statsOf(a).fail - statsOf(a).ok))
        .slice(0, 20);
      if (weak.length) startSession(shuffle(weak), state.config.mode, false);
      return;
    }
    if (t.closest("[data-reset-progress]")) {
      if (!window.confirm("¿Borrar todo el progreso guardado en este navegador? Esta acción no se puede deshacer.")) return;
      state.progress = {};
      saveProgress();
      renderProgress();
    }
  }

  // Enrutado y eventos globales

  function render() {
    clearTimer();
    for (const link of document.querySelectorAll(".nav-link")) {
      const target = link.getAttribute("data-nav");
      const active = target === state.view || (target === "setup" && (state.view === "practice" || state.view === "results"));
      if (active) link.setAttribute("aria-current", "page");
      else link.removeAttribute("aria-current");
    }
    if (state.view === "practice") renderPractice(false);
    else if (state.view === "results") renderResults();
    else if (state.view === "glossary") {
      renderGlossary();
      focusGlossarySearch();
    } else if (state.view === "progress") renderProgress();
    else renderSetup();
    window.scrollTo({ top: 0 });
  }

  function navigate(view) {
    if (state.view === "practice" && state.session && !state.session.finishedAt) {
      const s = state.session;
      if (s.results.length && s.results.length < s.queue.length) {
        if (!window.confirm("¿Salir de la práctica? Se perderá el resumen de esta sesión, pero tu progreso ya quedó guardado.")) return;
      }
      clearTimer();
      state.session = null;
    }
    state.view = view;
    render();
  }

  document.addEventListener("click", (e) => {
    const nav = e.target.closest("[data-nav]");
    if (nav) {
      e.preventDefault();
      navigate(nav.getAttribute("data-nav"));
      return;
    }
    if (!app.contains(e.target)) return;
    if (state.view === "setup") bindSetup(e);
    else if (state.view === "practice") bindPractice(e);
    else if (state.view === "results") bindResults(e);
    else if (state.view === "glossary") bindGlossary(e);
    else if (state.view === "progress") bindProgress(e);
  });

  app.addEventListener("submit", (e) => {
    if (state.view === "practice") onPracticeSubmit(e);
    else e.preventDefault();
  });

  app.addEventListener("input", (e) => {
    if (state.view === "glossary") onGlossaryInput(e);
    else if (state.view === "practice" && e.target.classList.contains("answer-input")) updateTracker();
  });

  document.addEventListener("keydown", (e) => {
    if (state.view !== "practice") return;
    const tag = e.target && e.target.tagName;
    if (tag === "INPUT" && e.key !== "Enter" && !e.altKey) return;
    if (tag === "INPUT" && e.key === "Enter" && !state.session.current.answered) return;
    onPracticeKey(e);
  });

  // Arranque

  initTheme();
  document.getElementById("footer-count").textContent = ITEMS.length + " acrónimos en " + CATEGORIES.length + " categorías.";
  render();
})();
