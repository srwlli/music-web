// songflow.js: Write a song's questions, over chat.js. It holds the one
// authoritative song state, in the shape the form-based page saved under
// music.song (musicLogic.restore's), with the Operator's picks kept apart from
// the engine's suggestions (state.picked). Every choice is the engine's:
// musicSong suggests the structure and style as `music song new` would choose
// them, and gives the outputs. The engine and the storage are handed in, so
// node can drive the same questions over the real music.wasm
// (web/flow.test.mjs). It draws nothing; chat.js draws.
"use strict";

const SongFlow = (() => {
  const L = globalThis.musicLogic;
  const KEY = "music.song";
  const CHAT_KEY = "music.songChat";
  const LYRIC_KEY = "music.songLyric";
  const SKIP = "Let the writer choose";

  // engine wraps the page's Go functions. A function that is missing or
  // throws (the Go program has exited, or never started) answers
  // {error, fatal: true}, so the page can say how to recover; a refusal
  // ({error}) is the engine's own answer and names what to change.
  function engine(g) {
    const call = (name, req) => {
      if (!g || typeof g[name] !== "function") return { error: `the engine has no ${name}`, fatal: true };
      try {
        return JSON.parse(g[name](JSON.stringify(req)));
      } catch (e) {
        return { error: String((e && e.message) || e), fatal: true };
      }
    };
    return { song: (req) => call("musicSong", req), check: (req) => call("musicCheck", req) };
  }

  function create({ lib, engine: eng, store }) {
    const byId = (list, id) => (list || []).find((x) => x.id === id) || null;
    const profileOf = (s) => byId(lib.profiles, s.profile) || byId(lib.profiles, lib.defaultProfile);
    const typeOf = (s) => byId(lib.types, s.type);
    const structureOf = (s) => byId(lib.structures, s.structure);
    const styleOf = (s) => byId(lib.styles, s.style);
    const nameOf = (list, id) => (byId(list, id) || { name: id }).name;

    let state = L.restore(null, lib);
    let chat = { answered: [], written: false };
    let given = new Set(); // the questions the Operator has answered
    const cache = new Map();

    // suggested is what the engine chooses with nothing picked by hand: the
    // structure and style `music song new` would choose, and why. It depends
    // only on the profile and the song types. null when the engine fails.
    function suggested(s) {
      const k = [s.profile, s.type, s.type ? s.also : ""].join("|");
      if (!cache.has(k)) {
        const r = eng.song(L.songRequest({ ...s, picked: {}, tempo: "" }));
        cache.set(k, r && !r.error ? { structure: r.structure, structureReason: r.structureReason, style: r.style, styleReason: r.styleReason } : null);
      }
      return cache.get(k);
    }

    // derive settles what is not the Operator's on the suggestion, or, with no
    // engine, on the profile's own structure and style.
    function derive() {
      const sug = suggested(state);
      const p = profileOf(state);
      if (!state.picked.structure) state.structure = sug ? sug.structure : p.structure;
      if (!state.picked.style) state.style = sug ? sug.style : p.style;
    }

    const saveSong = () => {
      store.set(KEY, state);
      store.set(CHAT_KEY, chat);
    };

    // change runs one change to the state, settles the rest, saves, and says
    // what moved in the answers already given: a suggestion that moved, a
    // pick that stayed while its suggestion moved, a tempo the style no
    // longer holds.
    function change(fn) {
      const before = { ...state, sug: suggested(state) };
      fn();
      derive();
      const sug = suggested(state);
      const notes = [];
      const reopen = [];
      const lists = { structure: lib.structures, style: lib.styles };
      for (const f of ["structure", "style"]) {
        if (!given.has(f)) continue;
        const was = before.sug ? before.sug[f] : null;
        const now = sug ? sug[f] : null;
        if (state.picked[f]) {
          if (was !== now && now) notes.push(`Your ${f}, ${nameOf(lists[f], state[f])}, stays. The suggestion would now be ${nameOf(lists[f], now)}.`);
        } else if (before[f] !== state[f]) {
          notes.push(`The suggested ${f} is now ${nameOf(lists[f], state[f])}.`);
        }
      }
      if (state.tempo && before.style !== state.style) {
        const st = styleOf(state);
        if (!L.hasRange(st)) {
          notes.push(`${st.name} has one tempo, ${st.tempo} BPM, so your tempo of ${state.tempo} is cleared.`);
          state.tempo = "";
          reopen.push("tempo");
        } else if (L.tempoCheck(state.tempo, st)) {
          notes.push(`Your tempo, ${state.tempo} BPM, is outside ${st.name}'s ${st.tempo} BPM, so it is cleared. Choose another or skip it.`);
          state.tempo = "";
          reopen.push("tempo");
        }
      }
      saveSong();
      return { notes, reopen };
    }

    const answer = (id, fn) => {
      given.add(id);
      return change(fn);
    };

    // A text answer: free words, kept as typed, optional, and an empty one
    // skipped. Dictation fills it as typing does.
    const text = (id, stage, prompt, help, placeholder) => ({
      id, stage, kind: "text", optional: true,
      prompt: () => prompt,
      help: typeof help === "function" ? help : () => help,
      placeholder: () => placeholder,
      skipLabel: () => SKIP,
      value: (s) => s[id] || "",
      summary: (s) => (s[id] ? { text: s[id], skipped: false } : { text: SKIP, skipped: true }),
      apply: (v) => answer(id, () => { state[id] = v == null ? "" : String(v).trim(); }),
    });

    const sizeTag = (t) => (t.size ? `${t.size} song` : null);
    const tempoOf = (s) => styleOf(s);

    // The perspectives, as the brief words them, shorter.
    const persons = [
      { value: "first", label: "First person", detail: "The singer is the \"I\" and tells what they saw, did and felt." },
      { value: "second", label: "Second person", detail: "Sung to \"you\", one person, from the first line to the last." },
      { value: "third", label: "Third person", detail: "Someone else's story, told from outside it." },
    ];

    const questions = [
      text("concept", "Idea", "What is the one thing the song says?",
        "The concept: one idea every section serves. Skip it and the writer chooses one.",
        "a light left on is a question nobody asks out loud"),
      {
        id: "type", stage: "Song type", kind: "cards", optional: true,
        prompt: () => "What is the song for?",
        help: () => "A song type is what the song is about and for. The sound comes next.",
        skipLabel: () => "No song type",
        searchable: "song types",
        options: () => lib.types.map((t) => ({ value: t.id, label: t.name, detail: L.firstSentence(t.definition), tag: sizeTag(t) })),
        value: (s) => s.type,
        summary: (s) => {
          const t = typeOf(s);
          if (!t) return { text: "No song type", skipped: true };
          const also = byId(lib.types, s.also);
          return { text: also ? `${t.name}, with some ${also.name}` : t.name, skipped: false };
        },
        apply: (v) => {
          const first = [];
          const r = answer("type", () => {
            if (!v) {
              if (state.also) first.push(`With no song type, ${nameOf(lib.types, state.also)} as a second type is cleared too.`);
              state.type = "";
              state.also = "";
              return;
            }
            if (state.also === v) {
              first.push(`${nameOf(lib.types, v)} is now the main one, so it is no longer the second type.`);
              state.also = "";
            }
            state.type = v;
          });
          if (!v && !first.length && r.notes.length) first.push("With no song type, the profile's own structure is suggested.");
          return { notes: first.concat(r.notes), reopen: r.reopen };
        },
        advanced: [{
          label: () => "Add a lesser second type",
          open: (s) => !!s.also,
          options: (s) => (s.type
            ? [{ value: "", label: "None" }].concat(lib.types.filter((t) => t.id !== s.type).map((t) => ({ value: t.id, label: t.name })))
            : []),
          value: (s) => s.also || "",
          apply: (v) => change(() => { state.also = state.type ? v || "" : ""; }),
        }],
      },
      {
        id: "profile", stage: "Sound", kind: "cards",
        prompt: () => "Which sound should it have?",
        help: () => "A profile is a way of writing: its delivery, its themes, its line rules.",
        searchable: "profiles",
        collapse: true, collapseLabel: "Choose another sound",
        suggestion: () => {
          const p = byId(lib.profiles, lib.defaultProfile);
          return { value: p.id, label: p.name, why: "The tool's default sound." };
        },
        options: (s) => {
          const t = typeOf(s);
          const pairs = t && t.pairs_with ? t.pairs_with.filter((id) => byId(lib.profiles, id)) : [];
          const opt = (p, group) => ({
            value: p.id, label: p.name, detail: p.summary, group,
            mark: p.id === lib.defaultProfile ? "★" : null, markLabel: p.id === lib.defaultProfile ? "the tool's default" : null,
          });
          if (!pairs.length) return lib.profiles.map((p) => opt(p, ""));
          return pairs.map((id) => opt(byId(lib.profiles, id), `Pairs with ${t.name}`))
            .concat(lib.profiles.filter((p) => !pairs.includes(p.id)).map((p) => opt(p, "Other profiles")));
        },
        value: (s) => s.profile,
        summary: (s) => ({ text: profileOf(s).name, skipped: false }),
        apply: (v) => answer("profile", () => { state.profile = byId(lib.profiles, v) ? v : lib.defaultProfile; }),
        applySuggestion: () => answer("profile", () => { state.profile = lib.defaultProfile; }),
      },
      {
        id: "style", stage: "Sound", kind: "cards",
        prompt: () => "Which style should it be played in?",
        help: (s) => `The style is the music under the words. ${profileOf(s).name} has its own; any style can carry it.`,
        searchable: "styles",
        collapse: true, collapseLabel: "Choose another style",
        suggestion: (s) => {
          const sug = suggested(s);
          const st = byId(lib.styles, sug ? sug.style : profileOf(s).style);
          return { value: st.id, label: `${st.name} · ${L.tempoWords(st)}`, why: sug && sug.styleReason ? sug.styleReason : "The profile's own style." };
        },
        filter: {
          label: "Tempo band",
          chips: () => [{ value: "", label: "Any" }].concat((lib.bands || []).map((b) => ({ value: b.id, label: b.id }))),
          get: (s) => s.band || "",
          set: (v) => { state.band = v || ""; saveSong(); },
        },
        options: (s) => {
          const own = profileOf(s).style;
          return L.styleGroups(lib, s.profile, s.band, s.style).flatMap((g) => g.items.map((st) => ({
            value: st.id, label: st.name, detail: L.tempoWords(st), group: g.label,
            mark: st.id === own ? "★" : null, markLabel: st.id === own ? "the profile's own" : null,
          })));
        },
        value: (s) => s.style,
        summary: (s) => {
          const st = styleOf(s);
          return { text: `${st.name} · ${L.tempoWords(st)}${s.picked.style ? "" : " (suggested)"}`, skipped: false };
        },
        apply: (v) => answer("style", () => { state = L.choose(state, "style", v); }),
        applySuggestion: () => answer("style", () => { state = L.suggest(state, "style"); }),
      },
      text("theme", "Theme & feeling", "What is it about?",
        (s) => {
          const th = profileOf(s).themes;
          const list = Array.isArray(th) ? th.join(", ") : String(th || "");
          return list ? `The theme is the subject. This profile writes about ${list}.` : "The theme is the subject, in your own words.";
        },
        "waiting up for someone"),
      text("emotion", "Theme & feeling", "What should it feel like?",
        "The mood: two feelings in tension work best. Name them in your own words.",
        "regret and resolve"),
      {
        id: "perspective", stage: "Story", kind: "cards", optional: true,
        prompt: () => "Whose voice is it in?",
        help: (s) => {
          const t = typeOf(s);
          return t ? `Skip it and ${t.name}'s own point of view stands.` : "Skip it and the writer chooses.";
        },
        skipLabel: (s) => (typeOf(s) ? "Let the song type decide" : SKIP),
        options: () => persons,
        value: (s) => s.perspective || "",
        summary: (s) => {
          const p = persons.find((x) => x.value === s.perspective);
          return p ? { text: p.label, skipped: false } : { text: typeOf(s) ? "Let the song type decide" : SKIP, skipped: true };
        },
        apply: (v) => answer("perspective", () => { state.perspective = L.PERSPECTIVES.includes(v) ? v : ""; }),
      },
      text("scene", "Story", "Where does it happen?", "The scene carries the story: a place, a moment, who is there.", "a parking lot at closing time"),
      text("arc", "Story", "How does it change from start to end?", "Where the song starts and where it lands.", "from holding on to letting go"),
      text("hook", "Hook & title", "Is there a line it keeps coming back to?", "The hook, in your words. Skip it and the writer finds one.", "the last light on"),
      text("title", "Hook & title", "What is it called?", "Skip it and the writer names it.", "Closing Time Lights"),
      {
        id: "structure", stage: "Structure & tempo", kind: "cards",
        prompt: () => "How should it be built?",
        help: () => "The sections the song is written in, and how long it runs.",
        searchable: "structures",
        collapse: true, collapseLabel: "Choose another structure",
        suggestion: (s) => {
          const sug = suggested(s);
          const st = byId(lib.structures, sug ? sug.structure : profileOf(s).structure);
          return { value: st.id, label: `${st.name} · ${st.size}`, why: sug && sug.structureReason ? sug.structureReason : "The profile's own structure." };
        },
        options: () => L.groups(lib.structures).flatMap((g) => g.items.map((st) => ({
          value: st.id, label: st.name, group: g.size,
          detail: [st.bar_count ? `${st.bar_count} bars` : "", st.typical_length || "", (st.sections || []).join(" · ")].filter(Boolean).join(" · "),
        }))),
        value: (s) => s.structure,
        summary: (s) => {
          const st = structureOf(s);
          return { text: `${st.name} · ${st.size}${s.picked.structure ? "" : " (suggested)"}`, skipped: false };
        },
        apply: (v) => answer("structure", () => { state = L.choose(state, "structure", v); }),
        applySuggestion: () => answer("structure", () => { state = L.suggest(state, "structure"); }),
      },
      {
        id: "tempo", stage: "Structure & tempo", kind: "text", optional: true, inputmode: "numeric",
        when: (s) => L.hasRange(tempoOf(s)),
        prompt: () => "What tempo?",
        help: (s) => { const st = tempoOf(s); return `${st.name} plays at ${st.tempo} BPM. Skip it to leave the tempo to the style.`; },
        placeholder: (s) => { const r = L.tempoRange(tempoOf(s)); return r ? String(Math.round((r[0] + r[1]) / 2)) : ""; },
        skipLabel: () => "Use the style's own",
        validate: (v, s) => L.tempoCheck(v, tempoOf(s)),
        value: (s) => s.tempo || "",
        summary: (s) => (s.tempo ? { text: `${s.tempo} BPM`, skipped: false } : { text: "The style's own tempo", skipped: true }),
        apply: (v) => answer("tempo", () => { state.tempo = v == null ? "" : String(v).trim(); }),
      },
    ];

    const flow = {
      stages: ["Idea", "Song type", "Sound", "Theme & feeling", "Story", "Hook & title", "Structure & tempo", "Review"],
      questions,
    };
    const ids = questions.map((q) => q.id);

    return {
      flow,
      KEY, CHAT_KEY, LYRIC_KEY,

      // load restores the song and the conversation. A song the form-based
      // page saved, with no conversation beside it, opens on the review.
      load() {
        const saved = store.get(KEY);
        const m = L.chatMeta(saved, store.get(CHAT_KEY), ids);
        state = L.restore(saved, lib);
        derive();
        chat = { answered: m.answered, written: m.written };
        given = new Set(m.answered);
        if (saved) saveSong();
        return { meta: { answered: m.answered.slice() }, migrated: m.migrated };
      },

      // clear forgets the song, the conversation and the pasted lyric, and
      // nothing else: a review and the open tab stay.
      clear() {
        for (const k of [KEY, CHAT_KEY, LYRIC_KEY]) store.drop(k);
        state = L.restore(null, lib);
        chat = { answered: [], written: false };
        given = new Set();
        derive();
      },

      state: () => state,
      saveChat(meta) {
        chat = { ...chat, answered: ((meta && meta.answered) || []).slice() };
        if (!chat.answered.length) chat.written = false;
        for (const id of chat.answered) given.add(id);
        saveSong();
      },
      setWritten(on) { chat = { ...chat, written: !!on }; saveSong(); },
      written: () => chat.written,
      setLyric(t) { if (t) store.set(LYRIC_KEY, t); else store.drop(LYRIC_KEY); },
      lyric: () => store.get(LYRIC_KEY) || "",

      outputs: () => eng.song(L.songRequest(state)),
      check: (lyric) => eng.check({ ...L.songRequest(state), lyric }),

      structure: () => structureOf(state),
      style: () => styleOf(state),
      profile: () => profileOf(state),
      type: () => typeOf(state),
    };
  }

  return { create, engine, KEY: "music.song", CHAT_KEY: "music.songChat", LYRIC_KEY: "music.songLyric" };
})();

globalThis.SongFlow = SongFlow;
