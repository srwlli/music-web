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
  SONG_INPUTS: ["title", "emotion", "scene", "arc", "hook"],

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
};

globalThis.musicLogic = musicLogic;
