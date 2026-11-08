// chat.js: a small conversation engine with no music in it. A flow is a list
// of questions; the engine asks the first visible one not yet answered, keeps
// the answered ones as a readable transcript, lets any of them be changed in
// place, and hands the end to the host's own review. The flow owns its state;
// the engine keeps only which questions are answered and which one is open.
// songflow.js gives it the music questions; nothing here knows a song.
//
// A question:
//   id, stage                      who it is and which progress stage it is in
//   prompt(ctx), help(ctx)         the question and a line under it
//   kind                           "cards" or "text"
//   when(ctx)                      false hides it (conditional progression)
//   optional, skipLabel(ctx)       may be skipped, and what skipping means
//   suggestion(ctx)                {value, label, why} where a default exists
//   collapse, collapseLabel        cards stay behind a closed "Choose another"
//                                  while a suggestion is offered
//   options(ctx)                   cards: [{value, label, detail, tag, group,
//                                  mark, markLabel}]
//   searchable, filter             cards: a search box; a chip filter
//                                  {label, chips(ctx), get(ctx), set(v)}
//   placeholder(ctx), inputmode    text
//   validate(value, ctx)           text: an error sentence, or ""
//   value(ctx), summary(ctx)       the answer now, and how it reads back
//                                  ({text, skipped})
//   apply(value)                   sets the answer (null skips); returns
//                                  {notes: [], reopen: [ids]} for the
//                                  dependent answers it changed
//   applySuggestion()              takes the suggestion; returns the same
//   advanced                       [{label(ctx), open(ctx), options(ctx),
//                                  value(ctx), apply(v)}], chips kept in a
//                                  closed disclosure
"use strict";

const Chat = (() => {
  // ---- the core: plain values in, plain values out ----

  const visible = (flow, ctx) => flow.questions.filter((q) => !q.when || q.when(ctx));

  // current is the first visible question not answered, or null at the end.
  const current = (flow, ctx, answered) => visible(flow, ctx).find((q) => !answered.includes(q.id)) || null;

  // progress says which stage the conversation is in, of how many.
  function progress(flow, ctx, answered) {
    const q = current(flow, ctx, answered);
    const index = q ? flow.stages.indexOf(q.stage) : flow.stages.length - 1;
    return { index, count: flow.stages.length, label: flow.stages[index] };
  }

  // settle returns the answered list after an answer: this question in it,
  // each reopened one out of it.
  function settle(answered, id, reopen) {
    const out = answered.filter((a) => !(reopen || []).includes(a));
    if (id && !out.includes(id)) out.push(id);
    return out;
  }

  // ---- the view ----

  function h(tag, attrs, ...kids) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === "class") n.className = v;
      else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v === true ? "" : v);
    }
    for (const c of kids.flat()) if (c != null && c !== false) n.append(c);
    return n;
  }

  // mount draws a flow into root. host gives ctx(), the meta it saved
  // ({answered}), save(meta), and review(node, api), which draws the end.
  function mount(root, flow, host) {
    let meta = { answered: [], editing: null, ...(host.meta || {}) };
    let notes = [];
    let focusNext = null;

    const api = {
      edit(id) { meta.editing = id; notes = []; focusNext = id; draw(); },
      reset(next) { meta = { answered: [], editing: null, ...(next || {}) }; notes = []; focusNext = "current"; save(); draw(); },
      draw() { draw(); },
      meta: () => meta,
      progress: () => progress(flow, host.ctx(), meta.answered),
    };

    function save() { host.save({ answered: meta.answered }); }

    function done(q, result) {
      const wasEditing = meta.editing === q.id;
      meta.answered = settle(meta.answered, q.id, result && result.reopen);
      meta.editing = null;
      notes = (result && result.notes) || [];
      focusNext = wasEditing && !notes.length ? "answer:" + q.id : "current";
      save();
      draw();
    }

    // ---- one question's controls ----

    function cardsInput(q, ctx) {
      const value = q.value(ctx);
      const sug = q.suggestion && q.suggestion(ctx);
      const wrap = h("div", { class: "q-input" });
      if (sug) {
        wrap.append(h("div", { class: "suggest" },
          h("div", { class: "suggest-text" },
            h("span", { class: "eyebrow" }, "Suggested"),
            h("strong", {}, sug.label),
            sug.why ? h("span", { class: "why" }, sug.why) : null),
          h("button", { class: "primary", type: "button", onclick: () => done(q, q.applySuggestion()) }, "Use suggestion")));
      }
      const list = h("div", { class: "cards-area" });
      let search = "";
      const drawList = () => {
        const opts = q.options(host.ctx());
        const term = search.trim().toLowerCase();
        const shown = term ? opts.filter((o) => (o.label + " " + (o.detail || "") + " " + (o.tag || "")).toLowerCase().includes(term)) : opts;
        const groups = [];
        for (const o of shown) {
          let g = groups.find((x) => x.name === (o.group || ""));
          if (!g) groups.push((g = { name: o.group || "", items: [] }));
          g.items.push(o);
        }
        list.replaceChildren(...(shown.length ? groups.map((g) => h("div", { class: "card-group" },
          g.name ? h("p", { class: "group-name" }, g.name) : null,
          h("ul", { class: "cards", "aria-label": g.name || null }, g.items.map((o) => h("li", {}, h("button", {
            type: "button", class: "opt" + (o.value === value ? " on" : ""),
            "aria-pressed": String(o.value === value),
            onclick: () => done(q, q.apply(o.value)),
          },
            h("span", { class: "opt-head" },
              o.mark ? h("span", { class: "mark", title: o.markLabel || null }, o.mark) : null,
              h("span", { class: "opt-label" }, o.label),
              o.mark && o.markLabel ? h("span", { class: "sr" }, ", " + o.markLabel) : null,
              o.tag ? h("span", { class: "opt-tag" }, o.tag) : null),
            o.detail ? h("span", { class: "opt-detail" }, o.detail) : null)))))) : [h("p", { class: "small" }, "Nothing matches. Clear the search to see them all.")]));
      };
      const tools = h("div", { class: "list-tools" });
      if (q.searchable) {
        const id = "search-" + q.id;
        tools.append(h("label", { class: "search", for: id }, h("span", { class: "sr" }, "Search " + q.searchable),
          h("input", { id, type: "search", placeholder: "Search " + q.searchable, autocomplete: "off",
            oninput: (e) => { search = e.target.value; drawList(); } })));
      }
      if (q.filter) {
        const f = q.filter;
        const row = h("div", { class: "chips", role: "group", "aria-label": f.label });
        const drawChips = () => row.replaceChildren(h("span", { class: "chips-label", "aria-hidden": "true" }, f.label),
          ...f.chips(host.ctx()).map((c) => h("button", {
            type: "button", class: "chip" + (f.get(host.ctx()) === c.value ? " on" : ""), "aria-pressed": String(f.get(host.ctx()) === c.value),
            onclick: () => { f.set(c.value); drawChips(); drawList(); },
          }, c.label)));
        drawChips();
        tools.append(row);
      }
      drawList();
      const body = tools.childNodes.length ? [tools, list] : [list];
      if (sug && q.collapse) {
        wrap.append(h("details", { class: "more" }, h("summary", {}, q.collapseLabel || "Choose another"), ...body));
      } else {
        wrap.append(...body);
      }
      return wrap;
    }

    function textInput(q, ctx) {
      const id = "in-" + q.id;
      const err = h("p", { class: "field-error", id: id + "-err", role: "alert", hidden: true });
      const input = h("input", {
        id, type: "text", value: q.value(ctx) || "", autocomplete: "off", inputmode: q.inputmode || null,
        placeholder: q.placeholder ? q.placeholder(ctx) : null, "aria-describedby": id + "-err",
        enterkeyhint: "next",
      });
      const submit = () => {
        const v = input.value.trim();
        if (!v) {
          if (q.optional) return done(q, q.apply(null));
          err.textContent = "Type an answer, or use the suggestion.";
          err.hidden = false;
          return;
        }
        const msg = q.validate ? q.validate(v, host.ctx()) : "";
        if (msg) { err.textContent = msg; err.hidden = false; input.setAttribute("aria-invalid", "true"); input.focus(); return; }
        done(q, q.apply(v));
      };
      input.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); submit(); } });
      return h("div", { class: "q-input" },
        h("label", { class: "sr", for: id }, q.prompt(ctx)),
        input, err,
        h("div", { class: "row tight" },
          h("button", { class: "primary", type: "button", onclick: submit }, "Next"),
          q.optional ? h("button", { class: "ghost", type: "button", onclick: () => done(q, q.apply(null)) }, q.skipLabel ? q.skipLabel(ctx) : "Skip") : null));
    }

    function advancedInput(q, ctx) {
      if (!q.advanced) return null;
      return q.advanced.filter((a) => a.options(ctx).length).map((a) => {
        const v = a.value(ctx);
        return h("details", { class: "more", open: a.open && a.open(ctx) },
          h("summary", {}, a.label(ctx)),
          h("div", { class: "chips", role: "group", "aria-label": a.label(ctx) }, a.options(ctx).map((o) => h("button", {
            type: "button", class: "chip" + (o.value === v ? " on" : ""), "aria-pressed": String(o.value === v),
            onclick: () => { const r = a.apply(o.value); notes = (r && r.notes) || []; save(); draw(); },
          }, o.label))));
      });
    }

    function questionCard(q, ctx, editing) {
      const head = h("h2", { class: "q-prompt", id: "q-" + q.id, tabindex: "-1" }, q.prompt(ctx));
      const help = q.help ? q.help(ctx) : "";
      const skip = q.optional && q.kind === "cards"
        ? h("button", { class: "ghost", type: "button", onclick: () => done(q, q.apply(null)) }, q.skipLabel ? q.skipLabel(ctx) : "Skip")
        : null;
      return h("section", { class: "q" + (editing ? " editing" : ""), "aria-labelledby": "q-" + q.id, "data-q": q.id },
        h("div", { class: "q-top" },
          h("span", { class: "stage" }, q.stage + (q.optional ? " · optional" : "")),
          editing ? h("button", { class: "link", type: "button", onclick: () => { meta.editing = null; focusNext = "answer:" + q.id; draw(); } }, "Cancel") : null),
        head,
        help ? h("p", { class: "q-help" }, help) : null,
        q.kind === "text" ? textInput(q, ctx) : cardsInput(q, ctx),
        advancedInput(q, ctx),
        skip ? h("div", { class: "row tight" }, skip) : null);
    }

    function answerRow(q, ctx) {
      const s = q.summary(ctx);
      return h("li", { class: "turn", "data-a": q.id },
        h("p", { class: "asked" }, q.prompt(ctx)),
        h("div", { class: "said" + (s.skipped ? " skipped" : "") },
          h("span", { class: "said-text" }, s.text),
          h("button", { class: "link", type: "button", "aria-label": "Change: " + q.prompt(ctx), onclick: () => api.edit(q.id) }, "Change")));
    }

    function draw() {
      const ctx = host.ctx();
      const qs = visible(flow, ctx);
      const cur = current(flow, ctx, meta.answered);
      const p = progress(flow, ctx, meta.answered);
      const children = [];

      children.push(h("div", { class: "progress-row" },
        h("p", { class: "progress-text", "aria-live": "polite" }, `${p.label} · step ${p.index + 1} of ${p.count}`),
        h("ol", { class: "steps", "aria-hidden": "true" }, flow.stages.map((s, i) => h("li", { class: i < p.index ? "done" : i === p.index ? "now" : null })))));

      const turns = h("ol", { class: "transcript", "aria-label": "Your answers so far" });
      for (const q of qs) {
        if (!meta.answered.includes(q.id)) continue;
        turns.append(meta.editing === q.id ? h("li", {}, questionCard(q, ctx, true)) : answerRow(q, ctx));
      }
      if (turns.childNodes.length) children.push(turns);
      if (notes.length) {
        children.push(h("div", { class: "notes", role: "status" }, notes.map((n) => h("p", {}, n))));
      }
      if (!meta.editing) {
        if (cur) children.push(questionCard(cur, ctx, false));
        else {
          const end = h("div", { class: "end" });
          host.review(end, api);
          children.push(end);
        }
      }
      root.replaceChildren(...children);

      // Focus: the question that just opened, or the answer just changed.
      const want = focusNext;
      focusNext = null;
      if (!want) return;
      let target = null;
      if (want === "current") target = cur ? (root.querySelector(`[data-q="${cur.id}"] input[type="text"]`) || root.querySelector("#q-" + cur.id)) : root.querySelector(".end h2");
      else if (want.startsWith("answer:")) target = root.querySelector(`[data-a="${want.slice(7)}"] .link`);
      else target = root.querySelector(`[data-q="${want}"] input[type="text"]`) || root.querySelector("#q-" + want);
      if (target) {
        target.focus({ preventScroll: true });
        target.scrollIntoView({ block: "nearest" });
      }
    }

    draw();
    return api;
  }

  return { visible, current, progress, settle, mount, h };
})();

globalThis.Chat = Chat;
