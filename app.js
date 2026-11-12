// The page around musicweb. All the music logic is the Go tool's own,
// compiled to WebAssembly (cmd/musicweb); this file only draws the page,
// calls musicParse, musicRebuild and musicLibrary, hands musicSong and
// musicCheck to songflow.js, and keeps the viewer's choices in this browser.
// The decisions it makes without the DOM are in logic.js, which node tests.
"use strict";

const $ = (id) => document.getElementById(id);
// TABS are the tabs shown. Edit a song joins them only when musicserve
// answers (initEdit), so the published page has the two it always had.
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

// output is one result with its Copy button. Its title says where it goes
// (DISPATCH-2026-11-08-MUSIC-019); what names the text for the Copy button.
function output(id, title, hint, text, tall, what) {
  return el("div", { class: "card result" },
    el("div", { class: "out-head" },
      el("h3", {}, title, hint ? el("span", { class: "hint" }, hint) : null),
      el("button", { class: "copy", type: "button", "data-copy": id, "aria-label": `Copy ${what || title}` }, "Copy")),
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
  const o = flow.outputs();
  const suno = musicLogic.sunoLyric(lyric, res, o && o.brief);
  if (suno.note) { node.replaceChildren(el("p", { class: "small check-miss", role: "status" }, suno.note)); return; }
  const status = res.missing.length
    ? el("p", { class: "small check-miss", role: "status" },
      `Missing ${res.missing.map((s) => `[${s}]`).join(", ")} for ${name}. Ask your AI for them, or write them in. Suno's Lyrics box waits until every section is there.`)
    : el("p", { class: "small check-ok", role: "status" }, `✓ Every section of ${name} is there.`);
  const lyricBox = suno.text
    ? output("out-suno-lyric", "Suno: Lyrics box", "paste the finished lyric here, in Custom mode", suno.text, true, "the finished lyric, for Suno's Lyrics box")
    : null;
  const sheet = el("div", { class: "card result" },
    el("div", { class: "out-head" },
      el("h3", {}, "Song sheet, not for Suno", el("span", { class: "hint" }, "the style and the lyric together, as music song check writes it, to keep or to review")),
      el("div", { class: "row tight" },
        el("button", { class: "copy", type: "button", "data-copy": "out-sheet", "aria-label": "Copy the song sheet" }, "Copy"),
        el("button", { class: "ghost", type: "button", onclick: () => sendToReview(res.sheet) }, "Review these lyrics"))),
    el("pre", { id: "out-sheet", class: "box tall" }, res.sheet));
  node.replaceChildren(status, lyricBox || "", sheet);
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
      el("p", { class: "small" }, "That is every question. Change any answer above, or write the outputs now."),
      el("div", { class: "row" }, el("button", {
        class: "primary", type: "button",
        onclick: () => {
          flow.setWritten(true);
          api.draw();
          mineAutoKeep();
          const h = $("out-title") || document.querySelector(".end .error");
          if (h) h.focus();
        },
      }, "Write the outputs")));
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
    el("h2", { id: "out-title", tabindex: "-1", class: "out-title" }, "What goes where"),
    el("p", { class: "small" }, "Each box says where it goes. The brief is for Claude, ChatGPT or another AI to write the lyric from, never for Suno, which would sing it. The style goes in Suno's Style box. Paste the lyric your AI writes back below, and once every section is there it is given for Suno's Lyrics box."),
    output("out-brief", "For Claude, ChatGPT or another AI", "ask it to write the lyrics from this. Never paste it into Suno", o.brief, true, "the brief, for Claude, ChatGPT or another AI"),
    output("out-style", "Suno: Style box", "paste this into Suno's Style box, in Custom mode", o.styleText, false, "the style, for Suno's Style box"),
    output("out-template", "Sections, not for Suno", "the structure's section markers in order, for your AI or for you to write under", o.template, false, "the sections"),
    el("details", { class: "more advanced" },
      el("summary", {}, "Advanced: the terminal command"),
      el("p", { class: "small" }, "Makes this song in a folder under songs/, to finish in a terminal."),
      output("out-command", "Terminal command", "", musicLogic.commandText(o.command))),
    mineWriteCard(),
    helperState.hello ? drawHelper(el("div", { id: "helper-card", class: "card result helper" })) : null,
    el("div", { class: "card result" },
      el("h3", {}, el("label", { for: lyricId }, "Paste the finished lyric back")),
      el("p", { class: "small" }, "The lyric your AI wrote, not the brief. It is checked here against the structure's sections, as ", el("code", {}, "music song check"), " checks it, and then given for Suno's Lyrics box. Nothing is sent anywhere."),
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
  if (res && res.style && st.done) parts.push(output("out-helper-style", "Suno: Style box", `${res.folder}/style.txt, paste it into Suno's Style box`, res.style, false, "the style, for Suno's Style box"));
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
  initEdit();
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
    if (mine.api) { mine.api.setWriting(null); mine.writeSaid = ""; }
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

// ---- edit a song ----

// Edit a song (DISPATCH-2026-11-09-MUSIC-033) is musicserve's: it opens a
// song folder's lyric.txt, checks the box as music song check does while the
// Operator types, and saves through musicserve, which keeps the lyric it
// replaces as lyric-prev-<n>.txt. Without musicserve its tab stays hidden.
const edit = { song: null, timer: 0 };
const fetchFn = (...a) => fetch(...a);

// editShow shows what the box holds: the check, and whether it differs from
// lyric.txt.
function editShow() {
  const box = $("edit-lyric").value;
  const res = SongFlow.engine(globalThis).check(musicLogic.editRequest(edit.song.song, box));
  if (res.fatal) { $("edit-song").hidden = true; $("edit-card").append(recovery(res.error)); return; }
  const c = musicLogic.editCheck(box, res);
  const name = edit.song.structure;
  $("edit-check").className = "small " + (c.ok ? "check-ok" : "check-miss");
  $("edit-check").textContent = c.ok ? `✓ Every section of ${name} is there.` : `${c.text}${res.missing && res.missing.length ? ` (${name})` : ""}`;
  const changed = musicLogic.edited(edit.song.lyric, box);
  $("edit-save").disabled = !changed || !box.trim();
  $("edit-revert").disabled = !changed;
}

// editDraw draws an opened or saved song. After a save it adds the two
// outputs for Suno, each with Copy.
function editDraw(o, saved) {
  edit.song = o;
  $("edit-song").hidden = false;
  $("edit-title").textContent = o.title;
  $("edit-about").textContent = `${o.folder} · ${o.structure}${o.song && o.song.tempo ? ` · ${o.song.tempo} BPM` : ""}`;
  $("edit-style").textContent = o.style || "";
  $("edit-lyric").value = o.lyric || "";
  $("edit-previous").textContent = (o.previous || []).length ? `Kept before: ${o.previous.join(", ")}.` : "";
  const outs = [];
  if (saved) {
    outs.push(output("out-edit-lyric", "Suno: Lyrics box", "paste the saved lyric here, in Custom mode", (o.lyric || "").trim(), true, "the saved lyric, for Suno's Lyrics box"));
    outs.push(output("out-edit-style", "Suno: Style box", `${o.folder}/style.txt, paste it into Suno's Style box`, o.style, false, "the style, for Suno's Style box"));
  }
  $("edit-outputs").replaceChildren(...outs);
  editShow();
}

function editError(text) {
  $("edit-error").hidden = !text;
  $("edit-error").textContent = text || "";
}

async function editOpen(slug) {
  editError("");
  $("edit-said").textContent = "";
  if (!slug) { $("edit-song").hidden = true; edit.song = null; return; }
  const o = await musicHelper.open(fetchFn, slug);
  if (o.status !== "open") { $("edit-song").hidden = true; edit.song = null; editError(o.message || "musicserve could not open that song."); return; }
  store.set("music.editSong", slug);
  editDraw(o, false);
}

async function editSave() {
  if (!edit.song) return;
  $("edit-save").disabled = true;
  const res = await musicHelper.save(fetchFn, edit.song.slug, $("edit-lyric").value);
  const said = musicHelper.saved(res);
  if (said.ok) editDraw(res, true);
  else editShow();
  $("edit-said").className = "small " + (said.ok ? "check-ok" : "check-miss");
  $("edit-said").textContent = said.text;
  $("edit-said").focus();
}

// initEdit shows Edit a song once musicserve has answered, and fills its
// list of songs by title.
async function initEdit() {
  TABS.push("edit");
  $("tab-edit").hidden = false;
  $("tab-edit").addEventListener("click", () => showTab("edit"));
  $("tab-edit").addEventListener("keydown", (e) => {
    const next = musicLogic.tabFor(e.key, "edit", TABS);
    if (!next) return;
    e.preventDefault();
    showTab(next, true);
  });
  const pick = $("edit-pick");
  const songs = await musicHelper.songs(fetchFn);
  pick.replaceChildren(el("option", { value: "" }, songs.length ? "Choose a song…" : "No songs in songs/ yet"),
    ...songs.map((x) => el("option", { value: x.slug }, `${x.title} (${x.stage})`)));
  pick.addEventListener("change", () => editOpen(pick.value));
  $("edit-lyric").addEventListener("input", () => {
    clearTimeout(edit.timer);
    edit.timer = setTimeout(editShow, 150);
  });
  $("edit-save").addEventListener("click", editSave);
  $("edit-revert").addEventListener("click", () => {
    if (!edit.song) return;
    $("edit-lyric").value = edit.song.lyric || "";
    editShow();
  });
  const last = store.get("music.editSong");
  if (last && songs.some((x) => x.slug === last)) {
    pick.value = last;
    await editOpen(last);
  }
  if (store.get("music.tab") === "edit") showTab("edit");
}

// ---- my songs ----

// My songs (DISPATCH-2026-11-10-MUSIC-036) keeps songs in the Operator's own
// store, behind their sign-in, one version per save until one is finished.
// mysongs.js talks to the store; this section draws it. Its tab shows only
// when mysongs.js has loaded, so a musicserve built before it still serves a
// working page.
const mine = {
  api: null, songs: [], song: null, versions: [], box: "", note: "", signEmail: "", signCode: "",
  said: null, compare: null, lines: null, confirm: "", renaming: false, loading: false, kept: null, writeSaid: "",
};

const when = (iso) => {
  try { return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }); } catch { return ""; }
};
const nameIn = (list, id) => ((list || []).find((x) => x.id === id) || { name: id || "" }).name;

// mineSay sets what My songs says next, ok or not.
function mineSay(ok, text) {
  mine.said = text ? { ok, text } : null;
}

function mineSaid() {
  if (!mine.said) return null;
  return el("p", { id: "mine-said", class: mine.said.ok ? "small check-ok" : "error", role: mine.said.ok ? "status" : "alert", tabindex: "-1" }, mine.said.text);
}

function mineFocusSaid() {
  const s = $("mine-said");
  if (s) s.focus();
}

// mineDraw draws My songs: the sign-in, the list, or the song open.
function mineDraw() {
  const root = $("mine");
  if (!root) return;
  if (!mine.api.signedIn()) root.replaceChildren(mineSignIn());
  else if (mine.song) root.replaceChildren(...mineEditor());
  else root.replaceChildren(mineList());
}

// AUTH_EMAIL keeps the email a sign-in was sent to, in this browser only, so
// the code can be typed after the page was closed to read the mail.
const AUTH_EMAIL = "music.authEmail";

function mineSignIn() {
  const input = el("input", { id: "mine-email", type: "email", autocomplete: "email", inputmode: "email", placeholder: "you@example.com", required: "", value: mine.signEmail || store.get(AUTH_EMAIL) || "", oninput: () => { mine.signEmail = input.value; } });
  const form = el("form", { class: "row", onsubmit: async (e) => {
    e.preventDefault();
    const b = form.querySelector("button");
    b.disabled = true;
    const r = await mine.api.sendLink(input.value, location.origin + location.pathname);
    b.disabled = false;
    if (r.ok) store.set(AUTH_EMAIL, input.value.trim());
    mineSay(r.ok, r.ok ? r.text : r.error);
    mineDraw();
    if (r.ok && $("mine-code")) $("mine-code").focus();
    else mineFocusSaid();
  } },
  el("label", { for: "mine-email" }, "Email"), input,
  el("button", { class: "primary", type: "submit" }, "Email me a sign-in link"));
  const code = el("input", { id: "mine-code", type: "text", inputmode: "url", autocomplete: "one-time-code", autocapitalize: "off", spellcheck: "false", placeholder: "paste the email's Sign in link", required: "", value: mine.signCode || "", oninput: () => { mine.signCode = code.value; } });
  const codeForm = el("form", { class: "row", onsubmit: async (e) => {
    e.preventDefault();
    const b = codeForm.querySelector("button");
    b.disabled = true;
    const r = await mine.api.signInHere(input.value, code.value);
    b.disabled = false;
    if (!r.ok) { mineSay(false, r.error); mineDraw(); mineFocusSaid(); return; }
    store.drop(AUTH_EMAIL);
    mine.signEmail = "";
    mine.signCode = "";
    mineSay(true, `Signed in as ${r.user.email}.`);
    mineDraw();
    await mineLoad(mine.api.openId());
    mineFocusSaid();
  } },
  el("label", { for: "mine-code" }, "Link"), code,
  el("button", { class: "primary", type: "submit" }, "Sign in"));
  return el("div", { class: "card" },
    el("h2", {}, "My songs ", el("span", { class: "hint" }, "kept in your own store, version by version, until each is finished")),
    el("p", { class: "small" }, "Sign in with your email, once on each device. In the email, press and hold the Sign in link, copy it and paste it below: this page is signed in, and stays signed in until you sign out, wherever your mail app opens links. Opening the link works too, in the browser it opens in. Only you can read or change your songs."),
    form, codeForm, mineSaid(),
    el("p", { class: "small" }, "Without signing in, Write a song and Review lyrics work as before, kept in this browser."));
}

// mineLoad lists the songs again and, when one is open, reads it again.
async function mineLoad(id) {
  mine.loading = true;
  const r = await mine.api.list();
  mine.loading = false;
  if (!r.ok) { mineSay(false, r.error); mineDraw(); return; }
  mine.songs = r.songs;
  if (id) await mineOpen(id, true);
  else mineDraw();
}

// mineOpen opens one song: the song, its versions, and the latest in the box.
async function mineOpen(id, quiet) {
  const [s, v] = await Promise.all([mine.api.song(id), mine.api.versions(id)]);
  if (!s.ok || !v.ok) {
    mine.api.setOpen(null);
    mine.song = null;
    mineSay(false, (s.ok ? v : s).error);
    mineDraw();
    return;
  }
  mine.song = s.song;
  mine.versions = v.versions;
  mine.box = mine.versions.length ? mine.versions[0].lyric : "";
  mine.note = "";
  mine.compare = null;
  mine.lines = null;
  mine.confirm = "";
  mine.renaming = false;
  mine.kept = null;
  mine.api.setOpen(id);
  if (!quiet) mineSay(true, "");
  mineDraw();
}

function mineList() {
  const file = el("input", { type: "file", accept: ".json,application/json", hidden: "", onchange: async () => {
    const f = file.files && file.files[0];
    if (!f) return;
    const d = musicSongs.parseImport(await f.text());
    file.value = "";
    if (d.error) { mineSay(false, d.error); mineDraw(); mineFocusSaid(); return; }
    const r = await mine.api.importSong(d);
    mineSay(r.ok, r.ok ? `Imported ${r.song.title}, with ${r.count} version${r.count === 1 ? "" : "s"}.` : r.error);
    await mineLoad(null);
    mineFocusSaid();
  } });
  const items = mine.songs.map((s) => el("li", {},
    el("button", { class: "song-row", type: "button", onclick: () => mineOpen(s.id) },
      el("span", { class: "song-title" }, s.title),
      el("span", { class: "small" }, [
        `version ${s.latest_n}`,
        s.finished_n ? `finished at version ${s.finished_n}` : "in progress",
        `changed ${when(s.updated_at)}`,
      ].join(" · ")))));
  const u = mine.api.user();
  return el("div", { class: "card" },
    el("div", { class: "out-head" },
      el("h2", {}, "My songs"),
      el("div", { class: "row tight" },
        el("span", { class: "small" }, `Signed in as ${u ? u.email : "you"}`),
        el("button", { class: "ghost", type: "button", onclick: async () => { await mine.api.signOut(); mine.songs = []; mine.song = null; mineSay(true, "Signed out."); mineDraw(); } }, "Sign out"))),
    el("p", { class: "small" }, "A song starts in Write a song: press Write the outputs there and it is kept here as version 1. Open a song to edit its lyric, save versions, compare and restore them, and mark one finished."),
    el("div", { class: "row" },
      el("button", { class: "primary", type: "button", onclick: () => showTab("song", true) }, "Start a song"),
      el("button", { class: "ghost", type: "button", onclick: () => file.click() }, "Import a song file"), file),
    mineSaid(),
    mine.loading ? el("p", { class: "small" }, "Loading your songs…")
      : items.length ? el("ul", { class: "songs" }, ...items) : el("p", { class: "small" }, "No songs yet."));
}

// mineLatest is the song's newest version.
const mineLatest = () => mine.versions[0] || null;
const mineAnswers = () => (mineLatest() || {}).answers || mine.song.answers || {};

// mineCheck checks the box against the song's structure, as music song
// check does.
function mineCheck() {
  return SongFlow.engine(globalThis).check({ ...musicLogic.songRequest(mineAnswers()), lyric: mine.box });
}

// mineState is what the editor's buttons and check say about the box.
function mineState() {
  const res = mineCheck();
  const c = musicLogic.editCheck(mine.box, res);
  const changed = musicSongs.changed(mineLatest(), mine.box, mineAnswers());
  return { res, c, changed };
}

// mineBits updates the check and the buttons while the Operator types,
// without drawing the box again.
function mineBits() {
  const { c, changed } = mineState();
  const latest = mineLatest();
  const check = $("mine-check");
  if (check) { check.className = "small " + (c.ok ? "check-ok" : "check-miss"); check.textContent = c.ok ? `✓ Every section of ${mineStructure()} is there.` : `${c.text} (${mineStructure()})`; }
  const save = $("mine-save");
  if (save) save.disabled = !changed || !mine.box.trim();
  const undo = $("mine-undo");
  if (undo) undo.disabled = !changed;
  const fin = $("mine-finish");
  if (fin) {
    fin.disabled = changed || !c.ok || !latest;
    $("mine-finish-why").textContent = changed ? "Save the box as a version first." : c.ok ? "" : "Every section must be there first.";
  }
}

const mineStructure = () => nameIn(lib.structures, mineAnswers().structure);

async function mineSave(note) {
  const latest = mineLatest();
  const r = await mine.api.save(mine.song.id, {
    lyric: mine.box, answers: mineAnswers(), style: latest ? latest.style : "", structure: latest ? latest.structure : mineAnswers().structure, note,
  });
  if (!r.ok) { mineSay(false, r.error); mineDraw(); mineFocusSaid(); return; }
  await mineOpen(mine.song.id, true);
  mineSay(true, `Saved as version ${r.version.n}.`);
  mineDraw();
  mineFocusSaid();
}

function mineEditor() {
  const s = mine.song;
  const latest = mineLatest();
  const box = el("textarea", { id: "mine-lyric", rows: "22", spellcheck: "true" });
  box.value = mine.box;
  box.addEventListener("input", () => { mine.box = box.value; mineBits(); });
  const note = el("input", { id: "mine-note", type: "text", maxlength: String(musicSongs.LIMITS.note), placeholder: "what changed, if you like" });
  note.value = mine.note;
  note.addEventListener("input", () => { mine.note = note.value; });

  const head = mine.renaming
    ? el("form", { class: "row tight rename", onsubmit: async (e) => {
      e.preventDefault();
      const r = await mine.api.rename(s.id, e.target.querySelector("input").value);
      if (r.ok) { mine.song = { ...s, title: r.song.title }; mine.renaming = false; mineSay(true, "Renamed."); } else mineSay(false, r.error);
      mineDraw();
    } },
    el("label", { for: "mine-title" }, "Title"),
    el("input", { id: "mine-title", type: "text", value: s.title, maxlength: String(musicSongs.LIMITS.title) }),
    el("button", { class: "primary", type: "submit" }, "Rename"),
    el("button", { class: "ghost", type: "button", onclick: () => { mine.renaming = false; mineDraw(); } }, "Cancel"))
    : el("div", { class: "out-head" },
      el("h2", { id: "mine-head", tabindex: "-1" }, s.title),
      el("button", { class: "ghost", type: "button", onclick: () => { mine.renaming = true; mineDraw(); $("mine-title").focus(); } }, "Rename"));

  const a = mineAnswers();
  const about = [nameIn(lib.profiles, a.profile), nameIn(lib.styles, a.style), mineStructure(), a.tempo ? `${a.tempo} BPM` : ""].filter(Boolean).join(" · ");

  const editor = el("div", { class: "card" },
    head,
    el("p", { class: "small" }, about),
    el("p", { class: "small" }, `Version ${s.latest_n} is the latest${s.finished_n ? `; version ${s.finished_n} is finished` : ""}. Saving keeps every version before it.`),
    el("h3", {}, el("label", { for: "mine-lyric" }, "Lyric"), el("span", { class: "hint" }, " type your changes; the check runs as you type, as music song check does")),
    box,
    el("p", { id: "mine-check", class: "small", role: "status" }),
    el("label", { for: "mine-note", class: "small" }, "A note for this version"), note,
    el("div", { class: "row" },
      el("button", { id: "mine-save", class: "primary", type: "button", onclick: () => mineSave(mine.note) }, `Save as version ${s.latest_n + 1}`),
      el("button", { id: "mine-undo", class: "ghost", type: "button", onclick: () => { mine.box = latest ? latest.lyric : ""; mineDraw(); } }, "Undo my changes"),
      el("button", { class: "ghost", type: "button", "aria-expanded": String(!!mine.lines), onclick: () => mineLinesToggle() }, "Keep or reject lines")),
    mineSaid(),
    mine.lines ? mineLines() : null);

  const finished = s.finished_n ? mine.versions.find((v) => v.n === s.finished_n) : null;
  const finish = el("div", { class: "card result" },
    finished
      ? el("div", {},
        el("div", { class: "out-head" },
          el("h3", {}, `Finished: version ${finished.n}`, el("span", { class: "hint" }, "these two go into Suno, in Custom mode")),
          el("button", { class: "ghost", type: "button", onclick: async () => { const r = await mine.api.reopen(s.id); if (r.ok) mine.song = { ...s, finished_n: null }; mineSay(r.ok, r.ok ? "Reopened: no version is marked finished." : r.error); mineDraw(); } }, "Reopen")),
        output("mine-suno-lyric", "Suno: Lyrics box", `version ${finished.n}'s lyric`, musicSongs.plain(finished.lyric), true, "the finished lyric, for Suno's Lyrics box"),
        output("mine-suno-style", "Suno: Style box", "the style it was written for", finished.style, false, "the style, for Suno's Style box"))
      : el("div", {},
        el("h3", {}, "Finish"),
        el("p", { class: "small" }, "When the latest saved version is the one, mark it finished. Its lyric and style are then given for Suno's boxes. A later save unmarks it."),
        el("div", { class: "row" },
          el("button", { id: "mine-finish", class: "primary", type: "button", onclick: async () => {
            const r = await mine.api.finish(s.id, latest.n);
            if (r.ok) mine.song = { ...s, finished_n: latest.n };
            mineSay(r.ok, r.ok ? `Version ${latest.n} is finished.` : r.error);
            mineDraw();
          } }, latest ? `Mark version ${latest.n} finished` : "Mark finished"),
          el("span", { id: "mine-finish-why", class: "small" }))));

  const versions = el("div", { class: "card" },
    el("h3", {}, "Versions ", el("span", { class: "hint" }, "the latest first; restoring keeps the old one as the newest, so nothing is lost")),
    el("ol", { class: "versions", reversed: "" }, ...mine.versions.map((v) => el("li", {},
      el("div", {},
        el("strong", {}, `Version ${v.n}`),
        el("span", { class: "small" }, ` · ${when(v.created_at)}${v.note ? ` · ${v.note}` : ""}${s.finished_n === v.n ? " · finished" : ""}`)),
      el("div", { class: "row tight" },
        el("button", { class: "ghost", type: "button", "aria-expanded": String(!!mine.compare && mine.compare.n === v.n), onclick: () => { mine.compare = mine.compare && mine.compare.n === v.n ? null : { n: v.n }; mineDraw(); } }, "Compare with the box"),
        v.n === latest.n ? null : el("button", { class: "ghost", type: "button", onclick: async () => {
          const r = await mine.api.restore(s.id, v);
          if (!r.ok) { mineSay(false, r.error); mineDraw(); return; }
          await mineOpen(s.id, true);
          mineSay(true, `Version ${v.n} is restored as version ${r.version.n}.`);
          mineDraw();
          mineFocusSaid();
        } }, "Restore")),
      mine.compare && mine.compare.n === v.n ? mineDiff(v) : null))));

  const file = s.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "song";
  const tools = el("div", { class: "card" },
    el("h3", {}, "More"),
    el("div", { class: "row" },
      el("button", { class: "ghost", type: "button", onclick: () => mineToWrite() }, "Change its answers in Write a song"),
      el("button", { class: "ghost", type: "button", onclick: () => {
        const blob = new Blob([JSON.stringify(musicSongs.exportSong(s, mine.versions, Date.now()), null, 2) + "\n"], { type: "application/json" });
        const link = el("a", { href: URL.createObjectURL(blob), download: `${file}.music-song.json` });
        document.body.append(link);
        link.click();
        setTimeout(() => { URL.revokeObjectURL(link.href); link.remove(); }, 0);
      } }, "Export every version"),
      helperState.hello ? el("button", { class: "ghost", type: "button", onclick: () => mineKeep() }, "Write to songs/ on this machine") : null,
      el("button", { class: "ghost danger", type: "button", "aria-expanded": String(mine.confirm === "delete"), onclick: () => { mine.confirm = mine.confirm === "delete" ? "" : "delete"; mineDraw(); } }, "Delete")),
    mine.confirm === "delete" ? el("div", { class: "card confirm", role: "group" },
      el("p", {}, `Delete ${s.title} and all ${mine.versions.length} of its versions? This cannot be undone. Export it first to keep a copy.`),
      el("div", { class: "row tight" },
        el("button", { class: "primary", type: "button", onclick: async () => {
          const r = await mine.api.remove(s.id);
          if (!r.ok) { mineSay(false, r.error); mineDraw(); return; }
          mine.song = null;
          mineSay(true, `Deleted ${s.title}.`);
          await mineLoad(null);
          mineFocusSaid();
        } }, "Delete it"),
        el("button", { class: "ghost", type: "button", onclick: () => { mine.confirm = ""; mineDraw(); } }, "Keep it"))) : null,
    mine.confirm === "write" ? el("div", { class: "card confirm", role: "group" },
      el("p", {}, "Write a song holds another song. Replace it there with this one? That song stays in My songs if it was kept."),
      el("div", { class: "row tight" },
        el("button", { class: "primary", type: "button", onclick: () => mineToWrite(true) }, "Replace it"),
        el("button", { class: "ghost", type: "button", onclick: () => { mine.confirm = ""; mineDraw(); } }, "Cancel"))) : null,
    mine.kept ? el("p", { class: "small " + (mine.kept.ok ? "check-ok" : "check-miss"), role: "status" }, mine.kept.text) : null);

  setTimeout(mineBits, 0);
  return [
    el("div", { class: "row mine-back" },
      el("button", { class: "ghost", type: "button", onclick: async () => { mine.song = null; mine.api.setOpen(null); mineSay(true, ""); await mineLoad(null); } }, "← All songs")),
    editor, finish, versions, tools,
  ];
}

// mineDiff shows a version against the box, line by line.
function mineDiff(v) {
  const rows = musicSongs.diff(v.lyric, mine.box);
  const same = rows.every((r) => r.op === " ");
  return el("div", { class: "diff-wrap" },
    el("p", { class: "small" }, same ? `Version ${v.n} and the box are the same.` : `Version ${v.n} against the box: − only in version ${v.n}, + only in the box.`),
    same ? null : el("pre", { class: "box diff" }, ...rows.map((r) => el("span", { class: r.op === "+" ? "add" : r.op === "-" ? "del" : "same" }, `${r.op === " " ? " " : r.op === "+" ? "+" : "−"} ${r.text}\n`))));
}

// mineLinesToggle opens the box's lines to keep or reject, as Review lyrics
// does; the revision goes back into the box, where it can be typed over.
function mineLinesToggle() {
  if (mine.lines) { mine.lines = null; mineDraw(); return; }
  const res = JSON.parse(musicParse(mine.box));
  if (res.error) { mineSay(false, res.error); mineDraw(); return; }
  mine.lines = res.result.lines;
  mineDraw();
}

function mineLines() {
  const ol = el("ol", { class: "lines" });
  mine.lines.forEach((l, i) => {
    if (i === 0 || l.sectionLabel !== mine.lines[i - 1].sectionLabel) ol.append(el("li", { class: "section" }, l.sectionLabel || "(no section)"));
    const set = (st) => { l.status = l.status === st ? "pending" : st; mineDraw(); };
    ol.append(el("li", { class: `line ${l.status}` },
      el("span", { class: "n" }, String(l.lineNumber)),
      el("span", { class: "text" }, l.content),
      el("span", { class: "acts" },
        el("button", { class: "k", type: "button", "aria-pressed": String(l.status === "kept"), onclick: () => set("kept") }, "Keep"),
        el("button", { class: "r", type: "button", "aria-pressed": String(l.status === "rejected"), onclick: () => set("rejected") }, "Reject"))));
  });
  const rejected = mine.lines.filter((l) => l.status === "rejected").length;
  return el("div", { class: "card mine-lines" },
    el("p", { class: "small" }, "Reject a line and the revision marks it [LYRICS NEEDED], for you or your AI to rewrite. Lines you leave are kept."),
    ol,
    el("div", { class: "row" },
      el("button", { class: "primary", type: "button", disabled: rejected ? null : "", onclick: () => {
        const lines = mine.lines.map((l) => ({ ...l, status: l.status === "rejected" ? "rejected" : "kept" }));
        const r = JSON.parse(musicRebuild(JSON.stringify(lines)));
        if (r.error) { mineSay(false, r.error); mineDraw(); return; }
        mine.box = r.revised;
        mine.lines = null;
        mineSay(true, `${rejected} line${rejected === 1 ? " is" : "s are"} marked [LYRICS NEEDED] in the box. Save it as a version when it is right.`);
        mineDraw();
      } }, `Put the revision in the box (${rejected} rejected)`)));
}

// mineToWrite opens the song in Write a song, to change its answers there;
// a new version is saved from there. Another song open there is replaced
// only after the Operator says so.
function mineToWrite(sure) {
  const s = mine.song;
  const chat = store.get(SongFlow.CHAT_KEY);
  const other = chat && (chat.answered || []).length && mine.api.writingId() !== s.id;
  if (other && !sure) { mine.confirm = "write"; mineDraw(); return; }
  store.set(SongFlow.KEY, mineAnswers());
  store.set(SongFlow.CHAT_KEY, { answered: flow.flow.questions.map((q) => q.id), written: true });
  store.set(SongFlow.LYRIC_KEY, mine.box);
  mine.api.setWriting(s.id);
  mine.confirm = "";
  const loaded = flow.load();
  chatApi.reset({ answered: loaded.meta.answered });
  showTab("song", true);
}

// mineKeep writes the open song to songs/<slug> through musicserve, on this
// machine only.
async function mineKeep() {
  if (!mine.box.trim()) { mine.kept = { ok: false, text: "The box has no lyric to write. Nothing was written." }; mineDraw(); return; }
  const r = await musicHelper.keep(fetchFn, musicLogic.songRequest(mineAnswers()), mine.box);
  mine.kept = musicHelper.kept(r);
  mineDraw();
}

// mineWriteCard is Write a song's line about My songs, under the outputs.
function mineWriteCard() {
  if (!mine.api) return null;
  const card = el("div", { id: "mine-write", class: "card result" });
  mineWriteDraw(card);
  return card;
}

function mineWriteDraw(card) {
  if (!mine.api.signedIn()) {
    card.replaceChildren(el("p", { class: "small" }, "Sign in under My songs to keep this song there, version by version, until it is finished. ",
      el("button", { class: "ghost", type: "button", onclick: () => showTab("mine", true) }, "Go to My songs")));
    return;
  }
  const id = mine.api.writingId();
  const o = flow.outputs();
  const v = { answers: flow.state(), lyric: flow.lyric(), style: o && o.styleText ? o.styleText : "", structure: flow.structure().id };
  const said = el("span", { class: "small", role: "status" }, mine.writeSaid || "");
  const go = async (fn) => {
    const r = await fn();
    mine.writeSaid = r.ok ? r.text : r.error;
    mineWriteDraw(card);
    await mineLoad(mine.song ? mine.song.id : null);
  };
  card.replaceChildren(
    el("h3", {}, "My songs"),
    id
      ? el("div", { class: "row tight" },
        el("button", { class: "ghost", type: "button", onclick: () => go(async () => {
          const r = await mine.api.save(id, { ...v, note: "from Write a song" });
          return r.ok ? { ok: true, text: `Saved as version ${r.version.n}.` } : r;
        }) }, "Save this as a new version"),
        el("button", { class: "ghost", type: "button", onclick: async () => { showTab("mine", true); await mineOpen(id); } }, "Open in My songs"),
        said)
      : el("div", { class: "row tight" },
        el("button", { class: "primary", type: "button", onclick: () => go(() => mineCreate(v)) }, "Keep it in My songs"),
        said));
}

// mineCreate keeps the song Write a song holds as a new song, version 1.
async function mineCreate(v) {
  const r = await mine.api.create({ ...v, note: "from Write a song" });
  if (!r.ok) return r;
  mine.api.setWriting(r.song.id);
  return { ok: true, text: `Kept in My songs as ${r.song.title}, version 1.` };
}

// mineAutoKeep keeps the song in My songs when Write the outputs is pressed,
// once, if the Operator is signed in.
async function mineAutoKeep() {
  if (!mine.api || !mine.api.signedIn() || mine.api.writingId()) return;
  const o = flow.outputs();
  if (!o || o.error) return;
  const r = await mineCreate({ answers: flow.state(), lyric: flow.lyric(), style: o.styleText, structure: flow.structure().id });
  mine.writeSaid = r.ok ? r.text : r.error;
  const card = $("mine-write");
  if (card) mineWriteDraw(card);
  if (r.ok) await mineLoad(null);
}

// initMine adds My songs' tab when mysongs.js has loaded. It runs before
// initTabs, so the tab is in TABS.
function initMine() {
  if (typeof musicSongs === "undefined") return;
  mine.api = musicSongs.client({ fetchFn, storage: store });
  TABS.splice(1, 0, "mine");
  $("tab-mine").hidden = false;
}

// startMine reads a sign-in link coming back, then lists the songs.
async function startMine() {
  if (!mine.api) return;
  const t = await mine.api.take(location.hash);
  if (t) {
    history.replaceState(null, "", location.pathname + location.search);
    mineSay(t.ok, t.ok ? `Signed in as ${t.user.email}.` : t.error);
    showTab("mine");
  }
  mineDraw();
  if (mine.api.signedIn()) await mineLoad(mine.api.openId());
  if (chatApi) chatApi.draw();
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
  initMine();
  initTabs();
  initCopy();
  initLook();
  initSong();
  initHelper();
  initReview();
  const tab = store.get("music.tab");
  showTab(TABS.includes(tab) ? tab : "song");
  if (tab === "edit") store.set("music.tab", tab);
  startMine();
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
