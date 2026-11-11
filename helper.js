// The page's side of musicserve, the local helper, with no DOM: app.js calls
// it, and helper.test.mjs tests it under node with a stand-in fetch. The page
// asks for the helper only when musicserve itself served it, on 127.0.0.1;
// anywhere else, such as the published page, it asks nothing and the finish
// screen is as it always was (WO-01M6W319Q6KTMDD6S3S6A4G5AT D5). Every path
// is relative, so a call goes only to the address that served the page.
"use strict";

const musicHelper = {
  // POLL_MS is how often a running write is asked after.
  POLL_MS: 2000,

  // served reports whether musicserve served this page: plain http on
  // 127.0.0.1, which is the only address musicserve listens on.
  served(loc) {
    return !!loc && loc.protocol === "http:" && loc.hostname === "127.0.0.1";
  },

  // hello asks the helper which agents it can run. It is null when the page
  // was not served by musicserve, or the helper does not answer as itself.
  async hello(fetchFn, loc) {
    if (!musicHelper.served(loc)) return null;
    try {
      const r = await fetchFn("api/hello", { cache: "no-store" });
      if (!r.ok) return null;
      const h = await r.json();
      return h && Array.isArray(h.agents) ? h : null;
    } catch {
      return null;
    }
  },

  // write asks for a token for this one write, then hands the helper the
  // song and the agent. It returns the helper's answer: running when the
  // agent has started, else why it did not.
  async write(fetchFn, agent, song) {
    try {
      const t = await fetchFn("api/token", { method: "POST", cache: "no-store" });
      const tok = await t.json();
      if (!t.ok || !tok.token) return tok && tok.status ? tok : { status: "error", message: "the helper gave no token" };
      const r = await fetchFn("api/write", {
        method: "POST",
        cache: "no-store",
        headers: { "Content-Type": "application/json", "X-Music-Token": tok.token },
        body: JSON.stringify({ agent, song }),
      });
      return await r.json();
    } catch {
      return musicHelper.gone();
    }
  },

  // songs lists the song folders musicserve can open, by title
  // (DISPATCH-2026-11-09-MUSIC-033). It is [] when the helper gives none.
  async songs(fetchFn) {
    try {
      const r = await fetchFn("api/songs", { cache: "no-store" });
      const b = await r.json();
      return r.ok && b && Array.isArray(b.songs) ? b.songs : [];
    } catch {
      return [];
    }
  },

  // open reads one song for the editor: its title, style, lyric, the
  // sections the lyric lacks and the request musicCheck takes. It writes
  // nothing.
  async open(fetchFn, slug) {
    try {
      const r = await fetchFn(`api/song?slug=${encodeURIComponent(slug)}`, { cache: "no-store" });
      return await r.json();
    } catch {
      return musicHelper.gone();
    }
  },

  // post asks for a token for this one call, then posts body to path with
  // it. It returns musicserve's answer, or why there was none.
  async post(fetchFn, path, body) {
    try {
      const t = await fetchFn("api/token", { method: "POST", cache: "no-store" });
      const tok = await t.json();
      if (!t.ok || !tok.token) return tok && tok.status ? tok : { status: "error", message: "the helper gave no token" };
      const r = await fetchFn(path, {
        method: "POST",
        cache: "no-store",
        headers: { "Content-Type": "application/json", "X-Music-Token": tok.token },
        body: JSON.stringify(body),
      });
      return await r.json();
    } catch {
      return musicHelper.gone();
    }
  },

  // save hands musicserve the lyric, behind a token. musicserve keeps the
  // lyric it replaces as lyric-prev-<n>.txt.
  save(fetchFn, slug, lyric) {
    return musicHelper.post(fetchFn, "api/save", { slug, lyric });
  },

  // keep writes a song from My songs into a new folder under songs/, with
  // its lyric, behind a token (DISPATCH-2026-11-10-MUSIC-036). musicserve
  // never writes over a folder that is there.
  keep(fetchFn, song, lyric) {
    return musicHelper.post(fetchFn, "api/keep", { song, lyric });
  },

  // kept is what the page says about a keep.
  kept(res) {
    const r = res || {};
    if (r.status === "kept") {
      const missing = (r.missing || []).length ? ` It still has no ${r.missing.join(", ")}.` : " It has every section.";
      return { ok: true, text: `Written to ${r.folder}, with its lyric, brief and style.${missing}` };
    }
    const why = (r.message || "musicserve did not write the song").trim().replace(/[.!?]?$/, ".");
    return { ok: false, text: `${why} Nothing was written.` };
  },

  // saved is what the page says about a save: ok when the lyric is on
  // disk, and the text to show.
  saved(res) {
    const r = res || {};
    const where = `${r.folder || "the song's folder"}/lyric.txt`;
    const missing = (r.missing || []).length ? ` It still has no ${r.missing.join(", ")}.` : " It has every section.";
    switch (r.status) {
      case "saved":
        return { ok: true, text: `Saved ${where}.${r.kept ? ` The lyric before it is kept as ${r.kept}.` : ""}${missing}` };
      case "unchanged":
        return { ok: true, text: `Nothing to save: ${where} is already this lyric.${missing}` };
      case "refused":
        return { ok: false, text: `${r.message || "musicserve refused the save."} Nothing was saved.` };
    }
    return { ok: false, text: `${r.message || "musicserve did not save the lyric."} Nothing was saved.` };
  },

  // run asks after the write going now, or the last one to finish.
  async run(fetchFn) {
    try {
      const r = await fetchFn("api/run", { cache: "no-store" });
      return await r.json();
    } catch {
      return musicHelper.gone();
    }
  },

  // gone is the answer when the helper stops answering.
  gone() {
    return { status: "error", message: "musicserve stopped answering. Start it again, then reload this page." };
  },

  // agents are the helper's agents in its order, each with whether it can
  // be used now.
  agents(hello) {
    return ((hello && hello.agents) || []).map((a) => ({ name: a.name, form: a.form, found: !!a.found }));
  },

  // clock writes seconds as m:ss.
  clock(seconds) {
    const s = Math.max(0, Math.floor(seconds || 0));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  },

  // NAMES are how the page names each agent.
  NAMES: { claude: "Claude", codex: "Codex", agy: "agy" },

  // name is how the page names an agent.
  name(agent) {
    return musicHelper.NAMES[agent] || agent || "the agent";
  },

  // status is what the page says about a run: done when it has ended, ok
  // when it gave a lyric with every section, and the text to show.
  status(res) {
    if (!res) return { done: true, ok: false, text: "" };
    const r = res;
    const who = musicHelper.name(r.agent);
    switch (r.status) {
      case "idle":
        return { done: true, ok: false, text: "" };
      case "running":
        return { done: false, ok: false, text: `${who} is writing the lyric in ${r.folder}: ${musicHelper.clock(r.seconds)}` };
      case "written":
        return { done: true, ok: true, text: `${who} wrote the lyric in ${r.folder}, and it has every section.` };
      case "missing":
        return { done: true, ok: false, text: `${who}'s lyric has no ${(r.missing || []).join(", ")}. Write it in below, or run it again.` };
      case "timeout":
      case "failed":
      case "busy":
      case "error":
        return { done: true, ok: false, text: r.message || `${who} did not finish.` };
      case "refused":
        return { done: true, ok: false, text: `${r.message || "musicserve refused the write."} Reload the page and try again.` };
    }
    return { done: true, ok: false, text: r.message || "musicserve gave an answer the page does not know." };
  },
};

globalThis.musicHelper = musicHelper;
