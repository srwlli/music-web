// The page around musicweb. All the music logic is the Go tool's own,
// compiled to WebAssembly (cmd/musicweb); this file only draws the page,
// calls musicParse, musicRebuild, musicLibrary, musicSong and musicCheck, and
// keeps the viewer's choices in this browser.
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

// ---- lists ----

const byId = (list, id) => list.find((x) => x.id === id);

function fill(select, rows, value) {
  select.replaceChildren(...rows.map(({ item, mark }) => el("option", { value: item.id }, mark + item.name)));
  if (rows.some((r) => r.item.id === value)) select.value = value;
}

function about(node, parts) {
  node.replaceChildren();
  parts.filter(Boolean).forEach((p, i) => {
    if (i) node.append(el("br"));
    if (Array.isArray(p)) node.append(el("b", {}, p[0] + ": "), p[1]);
    else node.append(p);
  });
}

// ---- write a song ----

// song is the tab's state: the Operator's choices, which of the structure
// and style were picked by hand, and what musicSong last chose for the rest.
let lib;
let song;
const SONG_FIELDS = musicLogic.SONG_INPUTS.concat("tempo");

const sentence = (s) => s.charAt(0).toUpperCase() + s.slice(1) + ".";

// soLists draws the structure list grouped Short, Standard, Long, each with
// its bars and length, and the style list with this sound's styles first, the
// profile's own marked ★, each with its tempo and band.
function soLists() {
  const p = byId(lib.profiles, song.profile);
  $("so-structure").replaceChildren(...musicLogic.groups(lib.structures).map((g) =>
    el("optgroup", { label: g.size }, ...g.items.map((s) =>
      el("option", { value: s.id }, `${s.name} · ${s.bar_count} bars · ${s.typical_length}`)))));
  $("so-structure").value = song.structure;
  $("so-style").replaceChildren(...musicLogic.styleGroups(lib, song.profile, song.band, song.style).map((g) =>
    el("optgroup", { label: g.label }, ...g.items.map((s) =>
      el("option", { value: s.id }, musicLogic.styleOption(s, s.id === p.style))))));
  $("so-style").value = song.style;
}

// soAlso draws the secondary type list without the primary type, and drops
// a secondary type that is now the primary or has none.
function soAlso() {
  const rows = [{ item: { id: "", name: "None" }, mark: "" }]
    .concat(lib.types.filter((t) => t.id !== song.type).map((item) => ({ item, mark: "" })));
  if (!song.type || song.also === song.type) song = { ...song, also: "" };
  fill($("so-also"), rows, song.also);
  $("so-also").value = song.also;
  $("so-also").disabled = !song.type;
}

function soDescribe(res) {
  const p = byId(lib.profiles, song.profile);
  about($("so-profile-about"), [p.summary]);
  const t = byId(lib.types, song.type);
  about($("so-type-about"), [t ? t.definition : "No song type: the profile's own structure, and no type's rules in the brief."]);

  for (const kind of ["structure", "style"]) {
    const list = kind === "structure" ? lib.structures : lib.styles;
    const item = byId(list, song[kind]);
    $(`so-${kind}-reason`).textContent = item && !res.error
      ? sentence(musicLogic.reason(kind, song.picked[kind], item.size, t)) : "";
    $(`so-${kind}-back`).hidden = !song.picked[kind];
  }
  const s = byId(lib.structures, song.structure);
  about($("so-structure-about"), s ? [["Sections", s.sections.join(" → ")]] : []);
  const st = byId(lib.styles, song.style);
  about($("so-style-about"), st ? [st.best_for, ["Tempo", musicLogic.tempoWords(st)], ["Group", st.group.name]] : []);
}

// writeSong asks musicSong for the song as `music song new` would make it,
// takes what it chose, and draws the four outputs.
function writeSong() {
  const res = JSON.parse(musicSong(JSON.stringify(musicLogic.songRequest(song))));
  song = musicLogic.settle(song, res);
  store.set("music.song", song);
  $("so-error").hidden = !res.error;
  $("so-error").textContent = res.error || "";
  soLists();
  soDescribe(res);
  $("so-brief").textContent = res.brief || "";
  $("so-style-text").textContent = res.styleText || "";
  $("so-template").textContent = res.template || "";
  $("so-command").textContent = musicLogic.commandText(res.command);
  checkSong();
}

// checkSong checks the pasted lyric against the chosen structure, as music
// song check does.
function checkSong() {
  const out = $("so-check");
  out.className = "small";
  const lyric = $("so-lyric").value;
  if (!lyric.trim()) {
    out.textContent = "";
    $("so-sheet-card").hidden = true;
    return;
  }
  const res = JSON.parse(musicCheck(JSON.stringify({ ...musicLogic.songRequest(song), lyric })));
  if (res.error) {
    out.textContent = res.error;
    out.classList.add("check-miss");
    $("so-sheet-card").hidden = true;
    return;
  }
  const name = byId(lib.structures, song.structure).name;
  if (res.missing.length) {
    out.textContent = `Missing ${res.missing.map((s) => `[${s}]`).join(", ")} for ${name}. Ask your agent for them, or write them in.`;
    out.classList.add("check-miss");
  } else {
    out.textContent = `✓ Every section of ${name} is there.`;
    out.classList.add("check-ok");
  }
  $("so-sheet").textContent = res.sheet;
  $("so-sheet-card").hidden = false;
}

function initSong() {
  fill($("so-profile"), lib.profiles.map((item) => ({ item, mark: "" })), lib.defaultProfile);
  fill($("so-type"), [{ item: { id: "", name: "No song type" }, mark: "" }].concat(lib.types.map((item) => ({ item, mark: "" }))), "");
  fill($("so-band"), [{ item: { id: "", name: "Any tempo" }, mark: "" }]
    .concat(lib.bands.map((b) => ({ item: { id: b.id, name: `${b.id}, ${b.note}` }, mark: "" }))), "");
  song = musicLogic.restore(store.get("music.song"), lib);
  $("so-profile").value = song.profile;
  $("so-type").value = song.type;
  $("so-band").value = song.band;
  soAlso();
  for (const f of SONG_FIELDS) document.querySelector(`[data-song="${f}"]`).value = song[f];
  $("so-lyric").value = store.get("music.songLyric") || "";

  const set = (field, value) => {
    song = musicLogic.choose(song, field, value);
    if (field === "type") soAlso();
    writeSong();
  };
  for (const f of ["profile", "type", "also", "structure", "style", "band"]) {
    $("so-" + f).addEventListener("change", (e) => set(f, e.target.value));
  }
  for (const f of SONG_FIELDS) {
    document.querySelector(`[data-song="${f}"]`).addEventListener("input", (e) => set(f, e.target.value));
  }
  for (const kind of ["structure", "style"]) {
    $(`so-${kind}-back`).addEventListener("click", () => {
      song = musicLogic.suggest(song, kind);
      writeSong();
      $("so-" + kind).focus();
    });
  }
  $("so-lyric").addEventListener("input", () => {
    store.set("music.songLyric", $("so-lyric").value);
    checkSong();
  });
  // A review with a decision in it is never discarded: the Review tab
  // offers to replace it, on the page.
  $("so-review").addEventListener("click", () => {
    const text = $("so-sheet").textContent;
    showTab("review");
    if (!$("review").hidden && !musicLogic.mayReplace(review.lines)) {
      review.waiting = text;
      $("replace-card").hidden = false;
      $("replace").focus();
      return;
    }
    $("lyrics-in").value = text;
    startReview();
  });
  writeSong();
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
  initSong();
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
    $("loading").textContent = "The page could not start: " + err.message;
    $("loading").classList.add("error");
  }
})();
