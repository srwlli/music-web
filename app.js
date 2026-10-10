// The page around musicweb. All the music logic is the Go tool's own,
// compiled to WebAssembly (cmd/musicweb); this file only draws the page,
// calls musicCatalog, musicGenerate, musicParse and musicRebuild, and keeps
// the viewer's choices in this browser.
"use strict";

const $ = (id) => document.getElementById(id);
const FIELDS = ["genre", "mood", "tempo", "vocalStyle", "instrumentation"];

const store = {
  get(key) {
    try { return JSON.parse(localStorage.getItem(key) || "null"); } catch { return null; }
  },
  set(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage is optional */ }
  },
};

let cat;

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

function showTab(name) {
  for (const t of ["generate", "review"]) {
    $("tab-" + t).setAttribute("aria-selected", String(t === name));
    $("panel-" + t).hidden = t !== name;
  }
  store.set("music.tab", name);
}

// ---- write a prompt ----

const byId = (list, id) => list.find((x) => x.id === id);

// ordered puts the recommended ids first, marked ★ then +, and the rest after.
function ordered(list, recommended) {
  const rec = recommended || [];
  const first = rec.map((id, i) => ({ item: byId(list, id), mark: i === 0 ? "★ " : "+ " })).filter((x) => x.item);
  const rest = list.filter((x) => !rec.includes(x.id)).map((item) => ({ item, mark: "" }));
  return first.concat(rest);
}

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

function genState() {
  const overrides = {};
  for (const f of FIELDS) {
    const v = document.querySelector(`[data-field="${f}"]`).value.trim();
    if (v !== "") overrides[f] = v;
  }
  return {
    type: $("type").value,
    structure: $("structure").value,
    style: $("style").value,
    any: $("any").checked,
    title: $("title").value,
    overrides,
  };
}

// refreshLists redraws the structure and style lists for the chosen type and
// structure, moving a choice the new list does not recommend to its first
// recommendation.
function refreshLists(changed) {
  const type = $("type").value;
  const recStructures = type ? cat.structuresFor[type] : null;
  let structure = $("structure").value;
  if (changed === "type" && type && !$("any").checked && !recStructures.includes(structure)) {
    structure = recStructures[0];
  }
  fill($("structure"), ordered(cat.structures, recStructures), structure);

  structure = $("structure").value;
  const recStyles = cat.stylesFor[structure] || [];
  let style = $("style").value;
  if ((changed === "type" || changed === "structure") && !recStyles.includes(style)) style = recStyles[0];
  fill($("style"), ordered(cat.styles, recStyles), style);
}

function describe() {
  const t = byId(cat.types, $("type").value);
  about($("type-about"), t ? [t.subtitle, t.goal] : ["Any song type: every structure is open."]);

  const s = byId(cat.structures, $("structure").value);
  about($("structure-about"), [
    s.description,
    ["Sections", s.sections.join(" → ")],
    ["Bars", `${s.bar_count} · ${s.typical_length}`],
  ]);
  const type = $("type").value;
  $("any-row").hidden = !type || cat.structuresFor[type].includes(s.id);

  const st = byId(cat.styles, $("style").value);
  about($("style-about"), [
    st.best_for,
    ["Tempo", `${st.tempo} BPM`],
    ["Vocals", st.vocal_type === "none" ? "instrumental" : st.vocal_type],
  ]);
}

function generate(changed) {
  if (changed === "type" || changed === "structure") refreshLists(changed);
  describe();
  const state = genState();
  store.set("music.generate", state);

  // The style's own values, shown greyed out in the empty fields.
  const defaults = JSON.parse(musicGenerate(JSON.stringify({ structure: state.structure, style: state.style, type: "" })));
  if (defaults.metadata) {
    for (const f of FIELDS) document.querySelector(`[data-field="${f}"]`).placeholder = defaults.metadata[f] || "";
  }

  const res = JSON.parse(musicGenerate(JSON.stringify(state)));
  $("gen-error").hidden = !res.error;
  $("gen-error").textContent = res.error || "";
  if (res.error) {
    for (const id of ["out-style", "out-lyrics", "out-prompt"]) $(id).textContent = "";
    return;
  }
  const p = res.prompt;
  const cut = p.indexOf("\n\n---\n\n");
  const styleLine = p.split("\n").find((l) => l.startsWith("Style: ")) || "";
  $("out-style").textContent = styleLine.slice("Style: ".length);
  $("out-lyrics").textContent = cut >= 0 ? p.slice(cut + 7) : "";
  $("out-prompt").textContent = p;
}

function initGenerate() {
  fill($("type"), [{ item: { id: "", name: "Any song type" }, mark: "" }].concat(cat.types.map((item) => ({ item, mark: "" }))), "");
  fill($("structure"), ordered(cat.structures, null), cat.structures[0].id);
  fill($("style"), ordered(cat.styles, cat.stylesFor[cat.structures[0].id]), cat.stylesFor[cat.structures[0].id][0]);

  const saved = store.get("music.generate");
  if (saved) {
    $("type").value = byId(cat.types, saved.type) ? saved.type : "";
    $("any").checked = !!saved.any;
    refreshLists("type");
    if (byId(cat.structures, saved.structure)) $("structure").value = saved.structure;
    refreshLists("structure");
    if (byId(cat.styles, saved.style)) $("style").value = saved.style;
    $("title").value = saved.title || "";
    for (const f of FIELDS) {
      const v = saved.overrides && saved.overrides[f];
      document.querySelector(`[data-field="${f}"]`).value = v || "";
      if (v) $("details").open = true;
    }
  }

  $("type").addEventListener("change", () => generate("type"));
  $("structure").addEventListener("change", () => generate("structure"));
  $("style").addEventListener("change", () => generate("style"));
  $("any").addEventListener("change", () => generate("any"));
  $("title").addEventListener("input", () => generate("title"));
  for (const f of FIELDS) document.querySelector(`[data-field="${f}"]`).addEventListener("input", () => generate(f));
  generate();
}

// ---- review lyrics ----

const review = { lines: [], slug: "", current: 0 };

function saveReview() {
  store.set("music.review", {
    text: $("lyrics-in").value,
    statuses: review.lines.map((l) => l.status),
    current: review.current,
  });
}

function startReview(statuses, current) {
  const res = JSON.parse(musicParse($("lyrics-in").value));
  $("parse-error").hidden = !res.error;
  $("parse-error").textContent = res.error || "";
  if (res.error) return false;

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

function drawLines() {
  const ol = $("lines");
  ol.replaceChildren();
  review.lines.forEach((l, i) => {
    if (i === 0 || l.sectionLabel !== review.lines[i - 1].sectionLabel) {
      ol.append(el("li", { class: "section" }, l.sectionLabel || "(no section)"));
    }
    const li = el("li", { class: `line ${l.status}${i === review.current ? " current" : ""}`, "data-i": i, onclick: () => { review.current = i; drawLines(); } },
      el("span", { class: "n" }, String(l.lineNumber)),
      el("span", { class: "text" }, l.content),
      el("span", { class: "acts" },
        el("button", { class: "k", title: "Keep (K)", onclick: (e) => { e.stopPropagation(); decide(i, "kept"); } }, "Keep"),
        el("button", { class: "r", title: "Reject (R)", onclick: (e) => { e.stopPropagation(); decide(i, "rejected"); } }, "Reject")));
    ol.append(li);
  });
  const cur = ol.querySelector(".current");
  if (cur && !isVisible(cur)) cur.scrollIntoView({ block: "nearest" });
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
    $("review").hidden = true;
    $("paste-card").hidden = false;
    saveReview();
  });
  $("keep-rest").addEventListener("click", () => {
    review.lines.forEach((l) => { if (l.status === "pending") l.status = "kept"; });
    drawLines();
  });
  $("download").addEventListener("click", () => {
    const blob = new Blob([$("revised").textContent + "\n"], { type: "text/plain" });
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
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const t = el("textarea", {}, text);
      document.body.append(t);
      t.select();
      document.execCommand("copy");
      t.remove();
    }
    b.textContent = "Copied";
    b.classList.add("done");
    setTimeout(() => { b.textContent = "Copy"; b.classList.remove("done"); }, 1200);
  });
}

window.musicReady = () => {
  cat = JSON.parse(musicCatalog());
  $("version").textContent = cat.version;
  $("loading").hidden = true;
  $("tab-generate").addEventListener("click", () => showTab("generate"));
  $("tab-review").addEventListener("click", () => showTab("review"));
  initCopy();
  initGenerate();
  initReview();
  showTab(store.get("music.tab") === "review" ? "review" : "generate");
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
