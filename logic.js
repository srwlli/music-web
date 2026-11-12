// The page's decisions, with no DOM: app.js calls them, and logic.test.mjs
// tests them under node. Each takes plain values and returns plain values.
"use strict";

const musicLogic = {
  // mayReplace reports whether a new lyric may replace the open review: only
  // when no line of it has been kept or rejected. A review with a decision
  // in it is replaced only when the Operator says so on the page.
  mayReplace(lines) {
    return !(lines || []).some((l) => l.status === "kept" || l.status === "rejected");
  },

  // errorPlace names where a parse error is shown: beside the paste box when
  // it is on screen, else above the open review, so it is always in the panel
  // the Operator is looking at.
  errorPlace(reviewOpen) {
    return reviewOpen ? "review-error" : "parse-error";
  },

  // copyable reports whether a box has anything to copy.
  copyable(text) {
    return (text || "").trim() !== "";
  },

  // copyLabel is what a Copy button says after it is pressed.
  copyLabel(text) {
    return musicLogic.copyable(text) ? "Copied" : "Nothing to copy";
  },

  // canDownload reports whether Download may save: only a revised lyric,
  // never an error and never nothing.
  canDownload(rebuilt) {
    return !!rebuilt && !rebuilt.error && musicLogic.copyable(rebuilt.revised);
  },

  // tabFor returns the tab a key selects from the current one, by the tabs
  // pattern: ArrowLeft and ArrowRight move and wrap, Home and End go to the
  // first and last. Any other key selects none, and returns null.
  tabFor(key, current, tabs) {
    const i = tabs.indexOf(current);
    switch (key) {
      case "ArrowLeft": return tabs[(i - 1 + tabs.length) % tabs.length];
      case "ArrowRight": return tabs[(i + 1) % tabs.length];
      case "Home": return tabs[0];
      case "End": return tabs[tabs.length - 1];
    }
    return null;
  },

  // ---- write a song ----

  // SONG_INPUTS are the song's own words, as `music song new` takes them.
  // The concept, theme and perspective came later
  // (WO-01M786VZW4SAAKDVHDRC0H0C8P); a perspective is one of PERSPECTIVES.
  SONG_INPUTS: ["concept", "theme", "perspective", "title", "emotion", "scene", "arc", "hook"],
  PERSPECTIVES: ["first", "second", "third"],

  // songRequest is what musicSong is asked for: the profile, the song types,
  // the tempo and the inputs as they stand, and a structure or style only
  // where the Operator picked one by hand. Every other is left empty, so the
  // Go side chooses it again as the terminal does. A secondary type goes
  // only with a primary one.
  songRequest(state) {
    const s = state || {};
    const picked = s.picked || {};
    const req = {
      profile: s.profile || "",
      type: s.type || "",
      also: s.type ? s.also || "" : "",
      structure: picked.structure ? s.structure || "" : "",
      style: picked.style ? s.style || "" : "",
      tempo: s.tempo || "",
    };
    for (const k of musicLogic.SONG_INPUTS) req[k] = s[k] || "";
    return req;
  },

  // choose returns the state after the Operator sets one field. A structure
  // or style set by hand is the Operator's own and stays through any later
  // change; a change to anything else keeps the picks as they are.
  choose(state, field, value) {
    const picked = { ...(state.picked || {}) };
    if (field === "structure" || field === "style") picked[field] = true;
    return { ...state, [field]: value, picked };
  },

  // suggest returns a structure or style to the suggestion: it is no longer
  // the Operator's, and is chosen again.
  suggest(state, field) {
    return { ...state, picked: { ...(state.picked || {}), [field]: false } };
  },

  // settle takes musicSong's reply into the state: the structure and style
  // it chose. A refusal changes nothing.
  settle(state, reply) {
    if (!reply || reply.error) return state;
    return { ...state, structure: reply.structure, style: reply.style };
  },

  // reason is the plain words shown beside a structure or style: the
  // Operator's own choice, the size a song type asked for, or the
  // profile's own. type is the primary song type, if any.
  reason(kind, picked, size, type) {
    if (picked) return "your choice";
    if (kind === "style") return "the profile's own style";
    if (type && type.size) return `${size}, because the song type is ${type.name}`;
    return `${size}, the profile's own structure`;
  },

  // quote writes one argument so a shell reads it back as it is. A plain
  // word goes as it is; text with none of $ ` " \ ! goes in double quotes,
  // which bash and PowerShell read alike; anything else goes in single
  // quotes, with each ' written as '\'' for bash.
  quote(arg) {
    const a = String(arg);
    if (/^[A-Za-z0-9_.,\/:=@%+-]+$/.test(a)) return a;
    if (!/[$`"\\!]/.test(a)) return `"${a}"`;
    return `'${a.replace(/'/g, "'\\''")}'`;
  },

  // commandText is the `music song new` line musicSong returns, one
  // argument to an element, as one line to paste into a terminal.
  commandText(args) {
    return (args || []).map(musicLogic.quote).join(" ");
  },

  // SIZES is the order the structure list is grouped in (R3).
  SIZES: ["Short", "Standard", "Long"],

  // groups returns the structures grouped by size, Short, Standard then
  // Long, each group in the list's own order. An empty group is left out.
  groups(structures) {
    return musicLogic.SIZES
      .map((size) => ({ size, items: (structures || []).filter((s) => s.size === size) }))
      .filter((g) => g.items.length);
  },

  // tempoWords says a style's tempo and band, and wide when its range is.
  tempoWords(style) {
    return `${style.tempo} BPM · ${style.band}${style.wide ? ", wide" : ""}`;
  },

  // styleOption is a style's line in the list, ★ when it is the profile's own.
  styleOption(style, own) {
    return `${own ? "★ " : ""}${style.name} · ${musicLogic.tempoWords(style)}`;
  },

  // styleGroups returns the style list as the page shows it: For this sound
  // first (the profile's own style, then the rest of its group by nearest
  // tempo), then every other group in its own order, each style once. A band
  // narrows the list to that band, but never drops the style in use, and an
  // empty group is left out. It arranges the list and chooses nothing.
  styleGroups(library, profile, band, inUse) {
    const styles = library.styles || [];
    const sound = (library.stylesFor || {})[profile] || [];
    const shown = (s) => !band || s.band === band || s.id === inUse;
    const first = sound.map((id) => styles.find((s) => s.id === id)).filter((s) => s && shown(s));
    return [{ label: "For this sound", items: first }]
      .concat((library.groups || []).map((g) => ({
        label: g.name,
        items: styles.filter((s) => s.group.id === g.id && !sound.includes(s.id) && shown(s)),
      })))
      .filter((g) => g.items.length);
  },

  // restore returns the remembered song state, kept only where the library
  // still holds it: an id it no longer has falls back to the default, and a
  // pick of one is no pick.
  restore(saved, library) {
    const has = (list, id) => !!id && (list || []).some((x) => x.id === id);
    const s = saved && typeof saved === "object" ? saved : {};
    const state = {
      profile: has(library.profiles, s.profile) ? s.profile : library.defaultProfile,
      type: has(library.types, s.type) ? s.type : "",
      also: "",
      structure: has(library.structures, s.structure) ? s.structure : "",
      style: has(library.styles, s.style) ? s.style : "",
      tempo: typeof s.tempo === "string" ? s.tempo : "",
      band: has(library.bands, s.band) ? s.band : "",
      picked: {},
    };
    state.also = state.type && has(library.types, s.also) ? s.also : "";
    const picked = s.picked || {};
    for (const k of ["structure", "style"]) state.picked[k] = !!picked[k] && state[k] !== "";
    for (const k of musicLogic.SONG_INPUTS) state[k] = typeof s[k] === "string" ? s[k] : "";
    if (!musicLogic.PERSPECTIVES.includes(state.perspective)) state.perspective = "";
    return state;
  },

  // ---- the conversation ----

  // tempoRange is a style's tempo as [low, high]; a style with one tempo
  // gives [n, n], and one with none gives null.
  tempoRange(style) {
    const m = /^(\d+)(?:-(\d+))?$/.exec((style && style.tempo) || "");
    return m ? [Number(m[1]), Number(m[2] || m[1])] : null;
  },

  // hasRange reports whether a style has a tempo to choose: a range, not
  // one number. Only then is the tempo asked.
  hasRange(style) {
    const r = musicLogic.tempoRange(style);
    return !!r && r[0] !== r[1];
  },

  // tempoCheck is what is wrong with a typed tempo for a style, as one
  // sentence, or "" when it is a whole number in the style's range.
  tempoCheck(value, style) {
    const r = musicLogic.tempoRange(style);
    const v = String(value == null ? "" : value).trim();
    if (!r) return "This style has no tempo to choose.";
    if (!/^\d+$/.test(v)) return `Type one whole number, such as ${Math.round((r[0] + r[1]) / 2)}.`;
    if (Number(v) < r[0] || Number(v) > r[1]) return `${v} is outside ${style.name}'s ${style.tempo} BPM.`;
    return "";
  },

  // firstSentence is a text's first sentence, or the whole text.
  firstSentence(text) {
    const t = String(text || "").trim();
    return (/^.*?[.!?](\s|$)/.exec(t) || [t])[0].trim();
  },

  // chatMeta is the conversation's memory as the page restores it: the
  // questions answered and whether the outputs were written. A song saved
  // with no conversation beside it is one the form-based page saved: every
  // answer in it is taken as given, so it opens on the review, migrated. An
  // id the flow no longer asks is dropped.
  chatMeta(savedSong, savedChat, ids) {
    if (savedChat && typeof savedChat === "object" && Array.isArray(savedChat.answered)) {
      const answered = savedChat.answered.filter((id, i, a) => ids.includes(id) && a.indexOf(id) === i);
      return { answered, written: !!savedChat.written && answered.length > 0, migrated: false };
    }
    if (savedSong && typeof savedSong === "object") return { answered: ids.slice(), written: false, migrated: true };
    return { answered: [], written: false, migrated: false };
  },

  // THEMES are the page's theme choices; system follows the device.
  THEMES: ["system", "dark", "light"],

  // theme is a saved theme choice if it is one, else system.
  theme(saved) {
    return musicLogic.THEMES.includes(saved) ? saved : "system";
  },

  // panels is a saved panel choice, glass or solid; glass unless solid.
  panels(saved) {
    return saved === "solid" ? "solid" : "glass";
  },

  // sunoLyric is what the page offers for Suno's Lyrics box: the pasted or
  // written lyric, trimmed, once the check found every section, and nothing
  // otherwise. Suno sings whatever is in that box (DISPATCH-2026-11-08-MUSIC-019),
  // so the brief is never offered there: a paste holding the brief's first
  // line is the brief, whatever its sections, and gets a note instead.
  sunoLyric(lyric, res, brief) {
    const text = String(lyric || "").trim();
    if (!text || !res || res.error || res.fatal || !Array.isArray(res.missing)) return { text: "", note: "" };
    const head = String(brief || "").split("\n")[0].trim();
    if (head && text.includes(head)) {
      return { text: "", note: "That is the brief, not a lyric. Give the brief to Claude, ChatGPT or another AI, and paste back the lyric it writes." };
    }
    // A lyric that still says [LYRICS NEEDED] is not finished, and Suno
    // would sing the mark (WO-01M78DENQEB904PB2NZ7XMG3S8 R8).
    const n = musicLogic.needed(text);
    if (n && !res.missing.length) return { text: "", note: musicLogic.neededText(n), needed: n };
    return { text: res.missing.length ? "" : text, note: "" };
  },

  // editRequest is the request musicCheck takes for a song opened in Edit a
  // song (DISPATCH-2026-11-09-MUSIC-033): the song's own choices, as
  // musicserve read them from its song.json, and the lyric in the box. So the
  // page checks the lyric as `music song check` checks lyric.txt.
  editRequest(song, lyric) {
    return Object.assign({}, song || {}, { lyric: String(lyric || "") });
  },

  // savedForm is a lyric as song.Save writes it: Windows line ends made
  // plain and one line end after the last line, so the page can say whether
  // the box differs from the lyric on disk.
  savedForm(lyric) {
    const text = String(lyric || "").replace(/\r\n/g, "\n").replace(/[ \t\r\n]+$/, "");
    return text ? text + "\n" : "";
  },

  // edited reports whether the box holds a lyric other than the one saved.
  edited(saved, box) {
    return musicLogic.savedForm(saved) !== musicLogic.savedForm(box);
  },

  // editCheck is what the editor says about the box, from musicCheck's
  // answer: ok once the lyric has every section of the song's structure.
  editCheck(lyric, res) {
    if (!String(lyric || "").trim()) return { ok: false, text: "The box is empty." };
    if (!res || res.error || res.fatal || !Array.isArray(res.missing)) {
      return { ok: false, text: (res && (res.error || res.fatal)) || "The lyric could not be checked." };
    }
    if (res.missing.length) return { ok: false, text: `Missing: ${res.missing.join(", ")}.` };
    const n = musicLogic.needed(lyric);
    if (n) return { ok: false, text: musicLogic.neededText(n) };
    return { ok: true, text: "Every section is there." };
  },

  // ---- the line editor (WO-01M78DENQEB904PB2NZ7XMG3S8) ----

  // NEEDED is the mark a removed line leaves, as lyrics.Needed writes it.
  NEEDED: "[LYRICS NEEDED]",

  // needed counts the lines of a lyric that are the mark and nothing else.
  needed(lyric) {
    return String(lyric || "").split(/\r?\n/).filter((l) => l.trim() === musicLogic.NEEDED).length;
  },

  // neededText says how many lines still need words (R8).
  neededText(n) {
    return `${n} line${n === 1 ? " still says" : "s still say"} ${musicLogic.NEEDED}. Write ${n === 1 ? "it" : "them"}, or ask your AI to, before it goes to Suno.`;
  },

  // NO_WORDS is review.ErrNoWords: a change to nothing is refused, because a
  // line left to be written is removed.
  NO_WORDS: "A changed line needs words. To leave it to be written, remove it.",
  ONE_LINE: "A changed line is one line. Change each line on its own.",

  // act applies one act to the line at index i and gives back a new state,
  // leaving the old one as it was, so Undo can put it back. The acts mirror
  // review.Session (R1): keep keeps the words as they are now; change takes
  // new words, keeps the pasted ones in original the first time, and clears
  // original when the words go back to the pasted ones; remove puts the
  // pasted words back and marks the line, which Revise writes as
  // [LYRICS NEEDED]; restore puts the pasted words back and keeps the line.
  // After keep, change or remove the editor moves to the next line. An act it
  // refuses gives back the state unchanged with an error.
  act(state, act, text) {
    const i = state.current;
    const old = state.lines[i];
    if (!old) return { state, error: "There is no line to act on." };
    const line = { ...old };
    let next = i;
    switch (act) {
      case "keep":
        line.status = "kept";
        next = i + 1;
        break;
      case "remove":
        if (line.original) { line.content = line.original; delete line.original; }
        line.status = "rejected";
        next = i + 1;
        break;
      case "change": {
        const words = String(text == null ? "" : text).trim();
        if (!words) return { state, error: musicLogic.NO_WORDS };
        if (/[\r\n]/.test(words)) return { state, error: musicLogic.ONE_LINE };
        if (!line.original && words !== line.content) line.original = line.content;
        line.content = words;
        if (line.content === line.original) delete line.original;
        line.status = "kept";
        next = i + 1;
        break;
      }
      case "restore":
        if (!line.original) return { state, error: "This line has its pasted words." };
        line.content = line.original;
        delete line.original;
        break;
      default:
        return { state, error: `Unknown act ${act}.` };
    }
    const lines = state.lines.slice();
    lines[i] = line;
    const undo = (state.undo || []).concat([{ i, line: old }]);
    return { state: { ...state, lines, undo, current: Math.min(next, lines.length - 1) }, error: "" };
  },

  // undo steps back through the acts, one at a time, to the line it changed.
  undo(state) {
    const stack = state.undo || [];
    if (!stack.length) return state;
    const { i, line } = stack[stack.length - 1];
    const lines = state.lines.slice();
    lines[i] = line;
    return { ...state, lines, undo: stack.slice(0, -1), current: i };
  },

  // keepRest keeps every line not yet decided, each its own step for Undo,
  // and stays on the line it was on.
  keepRest(state) {
    const lines = state.lines.slice();
    const undo = (state.undo || []).slice();
    lines.forEach((l, i) => {
      if (l.status !== "pending") return;
      undo.push({ i, line: l });
      lines[i] = { ...l, status: "kept" };
    });
    return { ...state, lines, undo };
  },

  // move goes to line i, kept inside the lyric.
  move(state, i) {
    const n = state.lines.length;
    return { ...state, current: n ? Math.max(0, Math.min(n - 1, i)) : 0 };
  },

  // badge is what a line's status says on the page.
  badge(line) {
    if (!line) return { kind: "pending", text: "" };
    if (line.status === "rejected") return { kind: "rejected", text: `Removed: ${musicLogic.NEEDED}` };
    if (line.status === "kept") return line.original ? { kind: "changed", text: "Changed" } : { kind: "kept", text: "Kept" };
    return { kind: "pending", text: "Not decided" };
  },

  // shown is a line as the revised lyric will read it.
  shown(line) {
    return line.status === "rejected" ? musicLogic.NEEDED : line.content;
  },

  // view is what the editor shows at the current line: where it is, its
  // section, the line itself with its status, and the lines either side as
  // the revised lyric will read them, or "" at either end.
  view(state) {
    const lines = state.lines || [];
    const i = state.current;
    const line = lines[i];
    if (!line) return null;
    const near = (j) => (lines[j] ? musicLogic.shown(lines[j]) : "");
    const section = line.sectionLabel ? line.sectionLabel.replace(/^\[|\]$/g, "") : "No section";
    return {
      i,
      n: i + 1,
      total: lines.length,
      where: `Line ${i + 1} of ${lines.length} · ${section}`,
      section,
      text: line.content,
      original: line.original || "",
      badge: musicLogic.badge(line),
      prev: near(i - 1),
      next: near(i + 1),
      first: i === 0,
      last: i === lines.length - 1,
      canUndo: (state.undo || []).length > 0,
    };
  },

  // tally counts the acts as music review's summary does: kept counts the
  // lines kept as written, apart from the changed ones.
  tally(counts) {
    const c = counts || {};
    const changed = c.changed || 0;
    return `Kept ${(c.kept || 0) - changed}, changed ${changed}, removed ${c.rejected || 0}, left ${c.pending || 0} of ${c.total || 0} lines.`;
  },

  // keyAct is the act a key asks for in the editor, or "" for none. Keys
  // typed into a text box, or with Ctrl, Meta or Alt, are never acts.
  keyAct(key, inBox, mods) {
    if (inBox || mods) return "";
    const k = String(key || "").toLowerCase();
    return { k: "keep", c: "change", r: "remove", u: "undo", b: "back", arrowup: "back", arrowleft: "back", arrowdown: "next", arrowright: "next" }[k] || "";
  },

  // sourceText says where the lyric in the editor came from.
  sourceText(source) {
    const s = source || {};
    if (s.kind === "mine") return `From My songs: ${s.title || "a song"}, version ${s.n}`;
    if (s.kind === "edit") return `From Edit a song: songs/${s.slug}/lyric.txt`;
    if (s.kind === "song") return `From Write a song${s.title ? `: ${s.title}` : ""}`;
    return "Pasted here";
  },

  // targets are where the finished lyric can go, by where it came from (R7):
  // back to its own place first, then Copy and Download always. Edit a song's
  // save needs musicserve, so it is offered only when the helper answered.
  targets(source, helper) {
    const s = source || {};
    const out = [];
    if (s.kind === "mine" && s.id) out.push({ id: "mine", label: `Save as version ${(s.n || 0) + 1}` });
    if (s.kind === "edit" && s.slug && helper) out.push({ id: "edit", label: "Save to lyric.txt" });
    if (s.kind === "song") out.push({ id: "song", label: "Put it in the lyric box" });
    out.push({ id: "copy", label: "Copy" }, { id: "download", label: "Download" });
    return out;
  },

  // edits are the changed lines of a review, saved with its statuses so a
  // reload puts the new words back: [index, words, pasted words] each.
  edits(lines) {
    const out = [];
    (lines || []).forEach((l, i) => { if (l.original) out.push([i, l.content, l.original]); });
    return out;
  },

  // reapply puts saved statuses and edits back on freshly parsed lines, when
  // they still fit the lyric, and gives back whether they did.
  reapply(lines, statuses, edits) {
    if (!Array.isArray(statuses) || statuses.length !== lines.length) return false;
    lines.forEach((l, i) => { l.status = statuses[i]; });
    for (const e of edits || []) {
      const [i, content, original] = e;
      if (lines[i] && lines[i].content === original) { lines[i].content = content; lines[i].original = original; }
    }
    return true;
  },
};

globalThis.musicLogic = musicLogic;
