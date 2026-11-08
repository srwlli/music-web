// The page around musicweb. All the music logic is the Go tool's own,
// compiled to WebAssembly (cmd/musicweb); this file only draws the page,
// calls musicParse, musicRebuild and musicLibrary, hands musicSong and
// musicCheck to songflow.js, and keeps the viewer's choices in this browser.
// The decisions it makes without the DOM are in logic.js, which node tests.
"use strict";

const $ = (id) => document.getElementById(id);
const TABS = ["song", "review"];

const store = {
  get(key) {
    try { return JSON.parse(localStorage.getItem(key) || "null"); } catch { return null; }
  },
  set(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage is optional */ }
  },
  drop(key) {
    try { localStorage.removeItem(key); } catch { /* storage is optional */ }
  },
};

function el(tag, attrs, ...children) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k === "class") n.className = v;
    else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v);
  }
  for (const c of children) if (c != null) n.append(c);
  return n;
}

// ---- tabs ----

// showTab selects a tab. Only the selected tab is in the Tab order (a roving
// tabindex); the arrow keys, Home and End move between them.
function showTab(name, focus) {
  for (const t of TABS) {
    $("tab-" + t).setAttribute("aria-selected", String(t === name));
    $("tab-" + t).tabIndex = t === name ? 0 : -1;
    $("panel-" + t).hidden = t !== name;
  }
  if (focus) $("tab-" + name).focus();
  store.set("music.tab", name);
}

function initTabs() {
  for (const t of TABS) {
    $("tab-" + t).addEventListener("click", () => showTab(t));
    $("tab-" + t).addEventListener("keydown", (e) => {
      const next = musicLogic.tabFor(e.key, t, TABS);
      if (!next) return;
      e.preventDefault();
      showTab(next, true);
    });
  }
}

// ---- write a song ----

// Write a song is a conversation: songflow.js asks the questions and holds
// the song, chat.js draws them, and this section draws the end: a short
// review, then the brief, the Suno style and lyrics template, the terminal
// command under Advanced, and the lyric pasted back and checked.
let lib;
let flow;
let chatApi;

// recovery is what the page says when the engine cannot answer: what
// happened, and what to do about it.
function recovery(message) {
  return el("div", { class: "error recovery", role: "alert" },
    el("p", {}, `The music engine stopped${message ? `: ${message}` : ""}.`),
    el("p", {}, "Reload the page. Your answers are kept in this browser and come back."),
    el("p", {}, "If it fails again, serve this folder with ", el("code", {}, "music.wasm"), " and ", el("code", {}, "wasm_exec.js"),
      " beside the page. A page opened as a file cannot load them."),
    el("p", {}, "In a terminal, ", el("code", {}, "music song new"), " makes the same song."));
}

// output is one result with its Copy button.
function output(id, title, hint, text, tall) {
  return el("div", { class: "card result" },
    el("div", { class: "out-head" },
      el("h3", {}, title, hint ? el("span", { class: "hint" }, hint) : null),
      el("button", { class: "copy", type: "button", "data-copy": id, "aria-label": `Copy the ${title.toLowerCase()}` }, "Copy")),
    el("pre", { id, class: "box" + (tall ? " tall" : "") }, text || ""));
}

// checkLyric checks the pasted lyric against the song's structure, as
// music song check does, and draws what it found into node.
function checkLyric(node) {
  const lyric = flow.lyric();
  if (!lyric.trim()) { node.replaceChildren(); return; }
  const res = flow.check(lyric);
  if (res.fatal) { node.replaceChildren(recovery(res.error)); return; }
  if (res.error) { node.replaceChildren(el("p", { class: "small check-miss", role: "status" }, res.error)); return; }
  const name = flow.structure().name;
  const status = res.missing.length
    ? el("p", { class: "small check-miss", role: "status" },
      `Missing ${res.missing.map((s) => `[${s}]`).join(", ")} for ${name}. Ask your agent for them, or write them in.`)
    : el("p", { class: "small check-ok", role: "status" }, `✓ Every section of ${name} is there.`);
  const sheet = el("div", { class: "card result" },
    el("div", { class: "out-head" },
      el("h3", {}, "Song sheet", el("span", { class: "hint" }, "the lyric under its style, as music song check writes it")),
      el("div", { class: "row tight" },
        el("button", { class: "copy", type: "button", "data-copy": "out-sheet", "aria-label": "Copy the song sheet" }, "Copy"),
        el("button", { class: "ghost", type: "button", onclick: () => sendToReview(res.sheet) }, "Review these lyrics"))),
    el("pre", { id: "out-sheet", class: "box tall" }, res.sheet));
  node.replaceChildren(status, sheet);
}

// sendToReview opens the lyric in Review lyrics. A review with a keep or a
// reject in it is never discarded: Review offers to replace it, on the page.
function sendToReview(text) {
  showTab("review", true);
  if (!$("review").hidden && !musicLogic.mayReplace(review.lines)) {
    review.waiting = text;
    $("replace-card").hidden = false;
    $("replace").focus();
    return;
  }
  $("lyrics-in").value = text;
  startReview();
}

// drawEnd draws the conversation's end into node: the answers that decide the
// song, then, once asked for, the outputs. Changing an answer above redraws
// it with the new outputs.
function drawEnd(node, api) {
  const s = flow.state();
  const Q = (id) => flow.flow.questions.find((q) => q.id === id);
  const shown = new Set(Chat.visible(flow.flow, s).map((q) => q.id));
  const rows = [["Song type", "type"], ["Sound", "profile"], ["Style", "style"], ["Structure", "structure"], ["Tempo", "tempo"], ["Title", "title"]]
    .filter(([, id]) => shown.has(id))
    .map(([label, id]) => [label, Q(id).summary(s)]);
  node.append(
    el("h2", { tabindex: "-1" }, "Your song"),
    el("dl", { class: "summary" }, ...rows.flatMap(([label, a]) => [el("dt", {}, label), el("dd", a.skipped ? { class: "skipped" } : {}, a.text)])));

  if (!flow.written()) {
    node.append(
      el("p", { class: "small" }, "That is every question. Change any answer above, or write the prompts now."),
      el("div", { class: "row" }, el("button", {
        class: "primary", type: "button",
        onclick: () => {
          flow.setWritten(true);
          api.draw();
          const h = $("out-title") || document.querySelector(".end .error");
          if (h) h.focus();
        },
      }, "Write the prompts")));
    return;
  }

  const o = flow.outputs();
  if (o.fatal) { node.append(recovery(o.error)); return; }
  if (o.error) {
    node.append(el("p", { class: "error", role: "alert", tabindex: "-1" }, `${o.error}. Change the answer it names above.`));
    return;
  }
  const lyricId = "song-lyric";
  const checked = el("div", { class: "checked" });
  const area = el("textarea", { id: lyricId, rows: "10", spellcheck: "false", placeholder: "[Intro]\n…" });
  area.value = flow.lyric();
  area.addEventListener("input", () => { flow.setLyric(area.value); checkLyric(checked); });
  node.append(
    el("h2", { id: "out-title", tabindex: "-1", class: "out-title" }, "The prompts"),
    el("p", { class: "small" }, "Give the brief to your agent to write the lyric. The style and the template go into Suno."),
    output("out-brief", "Brief", "for your agent to write the lyric", o.brief, true),
    output("out-style", "Style", "for Suno's style field", o.styleText),
    output("out-template", "Lyrics template", "the structure's sections, for Suno's lyrics field", o.template),
    el("details", { class: "more advanced" },
      el("summary", {}, "Advanced: the terminal command"),
      el("p", { class: "small" }, "Makes this song in a folder under songs/, to finish in a terminal."),
      output("out-command", "Terminal command", "", musicLogic.commandText(o.command))),
    helperState.hello ? drawHelper(el("div", { id: "helper-card", class: "card result helper" })) : null,
    el("div", { class: "card result" },
      el("h3", {}, el("label", { for: lyricId }, "Paste the lyric back")),
      el("p", { class: "small" }, "It is checked here against the structure's sections, as ", el("code", {}, "music song check"), " checks it. Nothing is sent anywhere."),
      area),
    checked);
  checkLyric(checked);
}

// ---- musicserve ----

// helperState is the local helper, when musicserve served this page: what it
// said it can run, and the write going now or last ended. Without musicserve
// hello stays null and the finish screen is as it always was.
const helperState = { hello: null, res: null, timer: 0 };

// drawHelper draws the helper's card into node: a button for each agent and
// what the run is doing. A run that ends with a lyric puts it in the paste
// box below, so it is checked there as a pasted lyric is.
function drawHelper(node) {
  const res = helperState.res;
  const st = musicHelper.status(res);
  const running = !!res && !st.done;
  const buttons = musicHelper.agents(helperState.hello).map((a) => el("button", {
    class: "ghost", type: "button",
    ...(running || !a.found ? { disabled: "" } : {}),
    ...(a.found ? {} : { title: `${a.name} is not on PATH on this machine` }),
    onclick: () => startHelper(a.name),
  }, `Write with ${musicHelper.name(a.name)}`));
  const said = el("p", { id: "helper-status", class: "small" + (st.ok ? " check-ok" : res && st.done && st.text ? " check-miss" : ""), role: "status", tabindex: "-1" }, st.text);
  const parts = [
    el("h3", {}, "Write the lyric here", el("span", { class: "hint" }, "with your own agent, through musicserve")),
    el("p", { class: "small" },
      "musicserve runs the agent you choose on this machine, signed in as you already are. It makes the song's folder, lets the agent write only there, and checks the lyric as ",
      el("code", {}, "music song check"), " does. Nothing goes to Suno."),
    el("div", { class: "row tight helper-agents" }, ...buttons),
    said,
  ];
  if (res && res.signIn) parts.push(el("p", { class: "small" }, "To sign in: ", el("code", {}, res.signIn.replace(/^run /, ""))));
  if (res && res.output && !st.ok && st.done) {
    parts.push(el("details", { class: "more" }, el("summary", {}, "What the agent said"), el("pre", { class: "box" }, res.output)));
  }
  if (res && res.style && st.done) parts.push(output("out-helper-style", "Style", `${res.folder}/style.txt, for Suno's style field`, res.style));
  node.replaceChildren(...parts);
  return node;
}

// startHelper hands the song to an agent through musicserve, then asks after
// the run until it ends.
async function startHelper(agent) {
  helperState.res = { status: "running", agent, folder: "songs/…", seconds: 0 };
  redrawHelper();
  helperState.res = await musicHelper.write(fetch.bind(globalThis), agent, musicLogic.songRequest(flow.state()));
  afterHelper();
}

// afterHelper redraws the card and, while the run goes on, asks again. When
// it ends with a lyric, the lyric goes into the paste box and is checked.
function afterHelper() {
  clearTimeout(helperState.timer);
  const res = helperState.res;
  if (!musicHelper.status(res).done) {
    redrawHelper();
    helperState.timer = setTimeout(async () => {
      helperState.res = await musicHelper.run(fetch.bind(globalThis));
      afterHelper();
    }, musicHelper.POLL_MS);
    return;
  }
  if (res && res.lyric) {
    flow.setLyric(res.lyric);
    chatApi.draw();
  } else {
    redrawHelper();
  }
  const s = $("helper-status");
  if (s) s.focus();
}

function redrawHelper() {
  const card = $("helper-card");
  if (card) drawHelper(card);
}

// initHelper asks musicserve, only when it served this page, which agents it
// can run, and picks up a run that was going when the page was reloaded.
async function initHelper() {
  const h = await musicHelper.hello(fetch.bind(globalThis), location);
  if (!h) return;
  helperState.hello = h;
  const res = await musicHelper.run(fetch.bind(globalThis));
  if (res.status === "running") {
    helperState.res = res;
    afterHelper();
  }
  chatApi.draw();
}

function initSong() {
  flow = SongFlow.create({ lib, engine: SongFlow.engine(globalThis), store });
  const loaded = flow.load();
  $("migrated").hidden = !loaded.migrated;
  chatApi = Chat.mount($("chat"), flow.flow, {
    meta: loaded.meta,
    ctx: () => flow.state(),
    save: (meta) => { flow.saveChat(meta); $("migrated").hidden = true; },
    review: drawEnd,
  });

  // Start over asks first, on the page, and clears only the song.
  const guard = (open) => {
    $("confirm").hidden = !open;
    $("start-over").setAttribute("aria-expanded", String(open));
    (open ? $("confirm-keep") : $("start-over")).focus();
  };
  $("start-over").addEventListener("click", () => guard($("confirm").hidden));
  $("confirm-keep").addEventListener("click", () => guard(false));
  $("confirm").addEventListener("keydown", (e) => { if (e.key === "Escape") guard(false); });
  $("confirm-clear").addEventListener("click", () => {
    flow.clear();
    $("confirm").hidden = true;
    $("start-over").setAttribute("aria-expanded", "false");
    $("migrated").hidden = true;
    chatApi.reset();
  });
}

// ---- the look ----

// The theme follows the device unless the viewer picks one; the panels are
// glass unless they pick solid. Both are kept in this browser.
function initLook() {
  const root = document.documentElement;
  const set = (theme, glass) => {
    if (theme === "system") root.removeAttribute("data-theme"); else root.setAttribute("data-theme", theme);
    if (glass === "solid") root.setAttribute("data-glass", "solid"); else root.removeAttribute("data-glass");
    for (const b of document.querySelectorAll("[data-theme-set]")) b.setAttribute("aria-pressed", String(b.dataset.themeSet === theme));
    for (const b of document.querySelectorAll("[data-glass-set]")) b.setAttribute("aria-pressed", String(b.dataset.glassSet === glass));
  };
  let theme = musicLogic.theme(store.get("music.theme"));
  let glass = musicLogic.panels(store.get("music.glass"));
  set(theme, glass);
  for (const b of document.querySelectorAll("[data-theme-set]")) {
    b.addEventListener("click", () => { theme = musicLogic.theme(b.dataset.themeSet); store.set("music.theme", theme); set(theme, glass); });
  }
  for (const b of document.querySelectorAll("[data-glass-set]")) {
    b.addEventListener("click", () => { glass = musicLogic.panels(b.dataset.glassSet); store.set("music.glass", glass); set(theme, glass); });
  }
}

// ---- review lyrics ----

// waiting is a lyric sent from Write a song while a review with decisions in
// it is open; rebuilt is the last rebuild, which Download saves.
const review = { lines: [], slug: "", current: 0, waiting: "", rebuilt: null };

function saveReview() {
  store.set("music.review", {
    text: $("lyrics-in").value,
    statuses: review.lines.map((l) => l.status),
    current: review.current,
  });
}

function startReview(statuses, current) {
  const res = JSON.parse(musicParse($("lyrics-in").value));
  const place = musicLogic.errorPlace(!$("review").hidden);
  for (const id of ["parse-error", "review-error"]) {
    $(id).hidden = !res.error || id !== place;
    $(id).textContent = id === place ? res.error || "" : "";
  }
  if (res.error) return false;
  $("replace-card").hidden = true;
  review.waiting = "";

  review.lines = res.result.lines;
  review.slug = res.slug || "untitled-song";
  if (statuses && statuses.length === review.lines.length) {
    review.lines.forEach((l, i) => { l.status = statuses[i]; });
  }
  review.current = Math.min(current || 0, review.lines.length - 1);

  const m = res.result.metadata;
  $("meta").replaceChildren(...[["Title", m.title], ["Genre", m.genre], ["Mood", m.mood], ["Tempo", m.tempo], ["Style", m.style]]
    .filter(([, v]) => v)
    .map(([k, v]) => el("div", {}, el("span", {}, k), v)));

  $("paste-card").hidden = true;
  $("review").hidden = false;
  drawLines();
  return true;
}

// drawLines draws the review's lines. The current line is the one in the Tab
// order; Enter or Space on a focused line selects it.
function drawLines() {
  const ol = $("lines");
  const hadFocus = ol.contains(document.activeElement);
  ol.replaceChildren();
  review.lines.forEach((l, i) => {
    if (i === 0 || l.sectionLabel !== review.lines[i - 1].sectionLabel) {
      ol.append(el("li", { class: "section" }, l.sectionLabel || "(no section)"));
    }
    const select = () => { review.current = i; drawLines(); };
    const li = el("li", {
      class: `line ${l.status}${i === review.current ? " current" : ""}`, "data-i": i,
      tabindex: i === review.current ? "0" : "-1", "aria-current": String(i === review.current),
      onclick: select,
      onkeydown: (e) => { if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); select(); } },
    },
      el("span", { class: "n" }, String(l.lineNumber)),
      el("span", { class: "text" }, l.content),
      el("span", { class: "acts" },
        el("button", { class: "k", title: "Keep (K)", onclick: (e) => { e.stopPropagation(); decide(i, "kept"); } }, "Keep"),
        el("button", { class: "r", title: "Reject (R)", onclick: (e) => { e.stopPropagation(); decide(i, "rejected"); } }, "Reject")));
    ol.append(li);
  });
  const cur = ol.querySelector(".current");
  if (cur && !isVisible(cur)) cur.scrollIntoView({ block: "nearest" });
  if (cur && hadFocus) cur.focus();
  rebuild();
  saveReview();
}

function isVisible(node) {
  const r = node.getBoundingClientRect();
  return r.top >= 70 && r.bottom <= window.innerHeight;
}

function decide(i, status) {
  review.lines[i].status = status;
  review.current = Math.min(i + 1, review.lines.length - 1);
  drawLines();
}

function rebuild() {
  const res = JSON.parse(musicRebuild(JSON.stringify(review.lines)));
  review.rebuilt = res;
  $("download").disabled = !musicLogic.canDownload(res);
  if (res.error) { $("revised").textContent = res.error; return; }
  $("revised").textContent = res.revised;
  const c = res.counts;
  $("bar").style.width = c.progress + "%";
  $("counts").textContent = `Kept ${c.kept}, rejected ${c.rejected}, left ${c.pending} of ${c.total} lines.`;
}

function initReview() {
  $("read").addEventListener("click", () => startReview());
  $("reset").addEventListener("click", () => {
    review.lines = [];
    review.rebuilt = null;
    $("download").disabled = true;
    $("review").hidden = true;
    $("replace-card").hidden = true;
    $("review-error").hidden = true;
    $("paste-card").hidden = false;
    saveReview();
  });
  $("replace").addEventListener("click", () => {
    $("lyrics-in").value = review.waiting;
    startReview();
  });
  $("keep-open").addEventListener("click", () => {
    review.waiting = "";
    $("replace-card").hidden = true;
  });
  $("keep-rest").addEventListener("click", () => {
    review.lines.forEach((l) => { if (l.status === "pending") l.status = "kept"; });
    drawLines();
  });
  $("download").addEventListener("click", () => {
    if (!musicLogic.canDownload(review.rebuilt)) return;
    const blob = new Blob([review.rebuilt.revised + "\n"], { type: "text/plain" });
    const a = el("a", { href: URL.createObjectURL(blob), download: `${review.slug}-revised.txt` });
    document.body.append(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 0);
  });

  document.addEventListener("keydown", (e) => {
    if ($("panel-review").hidden || $("review").hidden || !review.lines.length) return;
    if (e.ctrlKey || e.metaKey || e.altKey || /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName)) return;
    const key = e.key.toLowerCase();
    if (key === "k") decide(review.current, "kept");
    else if (key === "r") decide(review.current, "rejected");
    else if (key === "b" || key === "arrowup") { review.current = Math.max(0, review.current - 1); drawLines(); }
    else if (key === "arrowdown") { review.current = Math.min(review.lines.length - 1, review.current + 1); drawLines(); }
    else return;
    e.preventDefault();
  });

  const saved = store.get("music.review");
  if (saved && saved.text) {
    $("lyrics-in").value = saved.text;
    if (saved.statuses && saved.statuses.length) startReview(saved.statuses, saved.current);
  }
  $("lyrics-in").addEventListener("input", () => saveReview());
}

// ---- start ----

function initCopy() {
  document.addEventListener("click", async (e) => {
    const b = e.target.closest("button.copy");
    if (!b) return;
    const text = $(b.dataset.copy).textContent;
    const label = musicLogic.copyLabel(text);
    const shown = () => {
      b.textContent = label;
      b.classList.toggle("done", musicLogic.copyable(text));
      setTimeout(() => { b.textContent = "Copy"; b.classList.remove("done"); }, 1200);
    };
    if (!musicLogic.copyable(text)) return shown();
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const t = el("textarea", {}, text);
      document.body.append(t);
      t.select();
      document.execCommand("copy");
      t.remove();
    }
    shown();
  });
}

window.musicReady = () => {
  lib = JSON.parse(musicLibrary());
  $("version").textContent = lib.version;
  try { localStorage.removeItem("music.generate"); } catch { /* storage is optional */ }
  $("loading").hidden = true;
  initTabs();
  initCopy();
  initLook();
  initSong();
  initHelper();
  initReview();
  showTab(TABS.includes(store.get("music.tab")) ? store.get("music.tab") : "song");
};

(async () => {
  try {
    const go = new Go();
    let result;
    try {
      result = await WebAssembly.instantiateStreaming(fetch("music.wasm"), go.importObject);
    } catch {
      const bytes = await (await fetch("music.wasm")).arrayBuffer();
      result = await WebAssembly.instantiate(bytes, go.importObject);
    }
    go.run(result.instance);
  } catch (err) {
    $("loading").replaceChildren(recovery("the page could not start it, " + err.message));
    $("loading").classList.remove("notice");
  }
})();
