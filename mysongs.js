// My songs (WO-01M74B9SYGPKK1DWP65ZMFA36C, DISPATCH-2026-11-10-MUSIC-036):
// songs kept in the Operator's own Supabase project, behind their sign-in,
// one version per save until one is marked finished. This file has no DOM:
// app.js draws My songs over it, and mysongs.test.mjs tests it under node
// with a stand-in fetch.
//
// It talks to one address, the project's, with the publishable key, which is
// made to ship in a page: it lets a visitor ask to sign in and nothing more.
// What a signed-in Operator reads and writes is held to their own rows by the
// store's row-level security (supabase/migrations). No other key is here.
//
// Sign-in is by a link sent by email. Opened, the link comes back to the
// browser it opened in with the session in its #hash, and take() reads it.
// Copied and pasted into this page, its token is traded here for a session by
// signInHere(), so the browser the Operator uses is the one signed in,
// wherever their mail app opens links (DISPATCH-2026-11-12-MUSIC-039). A code,
// when the email shows one, is taken the same way. Either way the session is
// kept in this browser under music.auth, shared by its tabs and refreshed,
// until the Operator signs out: the project sets no time limit.
"use strict";

const musicSongs = (() => {
  const URL = "https://lxnnwoqvefqynutwwuad.supabase.co";
  const KEY = "sb_publishable_WFnwxKPINgo_KKCKCJzCHA_Aym2YrQA";
  const SESSION_KEY = "music.auth";
  const OPEN_KEY = "music.mySong";
  const WRITING_KEY = "music.songStore";
  const FORMAT = "music-song.v1";
  // LIMITS are the store's own checks (the migration's), so the page can say
  // what is too long before the store refuses it.
  const LIMITS = { title: 200, lyric: 20000, style: 4000, structure: 200, note: 500, answers: 32768 };
  const UNTITLED = "Untitled song";
  const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  const PAUSED = "The store did not answer. The Supabase project may be paused: a free project pauses after a week unused. Restore it from the Supabase dashboard, then try again. Nothing here was lost.";

  // trouble is what the page says when a call fails: the store's own words
  // where it gives them, and what to do.
  function trouble(status, body) {
    const said = body && typeof body === "object" ? body.msg || body.message || body.error_description || body.error || "" : "";
    if (status === 0 || status === 540 || /paused/i.test(String(said)) || (status === 503 && !said)) return PAUSED;
    if (status === 401) return "Your sign-in has run out. Sign in again.";
    if (status === 429) return "Too many tries for now. The sign-in email can be sent only a few times an hour; wait, then try again.";
    if (/signups? not allowed/i.test(String(said))) return "That email has no account here, and new accounts are turned off.";
    return said ? `The store refused it: ${said}.`.replace(/\.\.$/, ".") : `The store refused it (HTTP ${status}).`;
  }

  // codeOf is a typed sign-in code with its spaces and dashes taken out, or ""
  // when it is not one.
  function codeOf(typed) {
    const c = String(typed || "").replace(/[\s-]/g, "");
    return /^\d{6,10}$/.test(c) ? c : "";
  }

  // linkOf is the token in a pasted sign-in link, or "" when the text is not
  // this project's sign-in link.
  function linkOf(typed) {
    let u;
    try { u = new globalThis.URL(String(typed || "").trim()); } catch { return ""; }
    if (u.origin !== URL || u.pathname !== "/auth/v1/verify") return "";
    return u.searchParams.get("token") || "";
  }

  // fromHash reads what the sign-in link left in the page's #hash: a session,
  // or the reason it failed. It is null when the hash is not the link's.
  function fromHash(hash, nowSec) {
    const p = new URLSearchParams(String(hash || "").replace(/^#/, ""));
    if (p.get("error") || p.get("error_code")) {
      const code = p.get("error_code") || p.get("error");
      const why = code === "otp_expired"
        ? "The sign-in link has run out or was used already. Send a new one."
        : `Sign-in failed: ${(p.get("error_description") || code).replace(/\+/g, " ")}.`;
      return { error: why };
    }
    const at = p.get("access_token");
    const rt = p.get("refresh_token");
    if (!at || !rt) return null;
    const exp = Number(p.get("expires_at")) || (nowSec + (Number(p.get("expires_in")) || 3600));
    return { session: { access_token: at, refresh_token: rt, expires_at: exp } };
  }

  // stable writes a value as JSON with its keys in order, so two answers are
  // compared by what they hold, not the order they were set in.
  function stable(v) {
    if (Array.isArray(v)) return `[${v.map(stable).join(",")}]`;
    if (v && typeof v === "object") return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stable(v[k])}`).join(",")}}`;
    return JSON.stringify(v === undefined ? null : v);
  }

  // plain is a lyric as it is compared and kept: line ends made plain and
  // the end trimmed.
  const plain = (s) => String(s || "").replace(/\r\n/g, "\n").replace(/[ \t\r\n]+$/, "");

  // changed reports whether the box or the answers differ from a version.
  function changed(version, lyric, answers) {
    if (!version) return true;
    return plain(version.lyric) !== plain(lyric) || stable(version.answers || {}) !== stable(answers || {});
  }

  // titleOf is a song's title from its answers.
  const titleOf = (answers) => String((answers && answers.title) || "").trim().slice(0, LIMITS.title) || UNTITLED;

  // tooLong names the first field over the store's limit, or "".
  function tooLong(v) {
    const words = { lyric: "The lyric", style: "The style", structure: "The structure", note: "The note", title: "The title" };
    for (const f of Object.keys(words)) {
      if (v[f] != null && String(v[f]).length > LIMITS[f]) return `${words[f]} is over ${LIMITS[f].toLocaleString("en-US")} characters.`;
    }
    if (v.answers && stable(v.answers).length > LIMITS.answers) return "The answers are too long to keep.";
    return "";
  }

  // versionRow is what a save sends: the lyric, the answers it was written
  // from, the Suno style text, the structure and a note.
  const versionRow = (id, v) => ({
    song_id: id,
    lyric: plain(v.lyric),
    answers: v.answers || {},
    style: String(v.style || ""),
    structure: String(v.structure || ""),
    note: String(v.note || "").trim().slice(0, LIMITS.note),
  });

  // diff compares two lyrics line by line: each line kept ( ), taken out (-)
  // or put in (+), by the longest run they share.
  function diff(a, b) {
    const x = plain(a).split("\n");
    const y = plain(b).split("\n");
    if (x.length * y.length > 4e6) {
      return x.map((t) => ({ op: "-", text: t })).concat(y.map((t) => ({ op: "+", text: t })));
    }
    const n = x.length;
    const m = y.length;
    const L = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) L[i][j] = x[i] === y[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
    }
    const out = [];
    let i = 0;
    let j = 0;
    while (i < n && j < m) {
      if (x[i] === y[j]) { out.push({ op: " ", text: x[i] }); i++; j++; }
      else if (L[i + 1][j] >= L[i][j + 1]) out.push({ op: "-", text: x[i++] });
      else out.push({ op: "+", text: y[j++] });
    }
    while (i < n) out.push({ op: "-", text: x[i++] });
    while (j < m) out.push({ op: "+", text: y[j++] });
    return out;
  }

  // exportSong is a song and every version as one music-song.v1 file, the
  // oldest version first, to keep or to bring back with Import.
  function exportSong(song, versions, now) {
    return {
      format: FORMAT,
      exported_at: new Date(now).toISOString(),
      song: { title: song.title, answers: song.answers || {}, latest_n: song.latest_n, finished_n: song.finished_n ?? null },
      versions: (versions || []).slice().sort((p, q) => p.n - q.n).map((v) => ({
        n: v.n, lyric: v.lyric, answers: v.answers || {}, style: v.style || "", structure: v.structure || "", note: v.note || "", created_at: v.created_at,
      })),
    };
  }

  // parseImport reads a music-song.v1 file, or says why it cannot.
  function parseImport(text) {
    let d;
    try { d = JSON.parse(String(text || "")); } catch { return { error: "That file is not a song exported from My songs." }; }
    if (!d || d.format !== FORMAT) return { error: `That file is not a ${FORMAT} song exported from My songs.` };
    if (!d.song || typeof d.song !== "object" || !Array.isArray(d.versions) || !d.versions.length) return { error: "That song file has no versions." };
    const versions = d.versions.slice().sort((p, q) => (p.n || 0) - (q.n || 0));
    for (const v of versions) {
      if (!v || typeof v.lyric !== "string") return { error: "A version in that file has no lyric." };
      const long = tooLong(v);
      if (long) return { error: `In that file, version ${v.n}: ${long}` };
    }
    const title = String(d.song.title || "").trim().slice(0, LIMITS.title) || UNTITLED;
    return { song: { title, answers: d.song.answers && typeof d.song.answers === "object" ? d.song.answers : {}, finished_n: d.song.finished_n ?? null }, versions };
  }

  // client is My songs over a fetch and a store for the session: sign-in,
  // and the songs and versions behind it.
  function client({ fetchFn, storage, now = () => Date.now() }) {
    let session = storage.get(SESSION_KEY);
    const nowSec = () => Math.floor(now() / 1000);
    const keep = (s) => {
      session = s;
      if (s) storage.set(SESSION_KEY, s); else storage.drop(SESSION_KEY);
    };
    // newer is the session another tab of this page has kept since this one
    // read it, or null. The store turns a refresh token into a new one, so a
    // tab that refreshed with an old one would be refused and sign out.
    const newer = () => {
      const s = storage.get(SESSION_KEY);
      return s && s.refresh_token && (!session || s.refresh_token !== session.refresh_token) ? s : null;
    };

    async function call(method, path, { body, bearer, prefer } = {}) {
      const headers = { apikey: KEY, Authorization: `Bearer ${bearer || KEY}` };
      if (body !== undefined) headers["Content-Type"] = "application/json";
      if (prefer) headers.Prefer = prefer;
      let r;
      try {
        r = await fetchFn(URL + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), cache: "no-store" });
      } catch {
        return { ok: false, status: 0, error: trouble(0) };
      }
      const text = await r.text();
      let data = text;
      try { data = text ? JSON.parse(text) : null; } catch { /* keep the text */ }
      if (!r.ok) return { ok: false, status: r.status, body: data, error: trouble(r.status, data) };
      return { ok: true, status: r.status, body: data };
    }

    // refresh trades the refresh token for a new session, once at a time
    // however many calls ask. A session another tab refreshed is taken as it
    // is. A refusal signs the Operator out, since the session cannot be used
    // again, unless another tab kept a new one meanwhile.
    let refreshing = null;
    function refresh() {
      if (!refreshing) refreshing = refreshOnce().finally(() => { refreshing = null; });
      return refreshing;
    }
    async function refreshOnce() {
      const other = newer();
      if (other) {
        session = other;
        if (other.expires_at - 60 > nowSec()) return true;
      }
      if (!session || !session.refresh_token) return false;
      const used = session.refresh_token;
      const r = await call("POST", "/auth/v1/token?grant_type=refresh_token", { body: { refresh_token: used } });
      if (!r.ok) {
        const since = newer();
        if (since) { session = since; return true; }
        if (r.status >= 400 && r.status < 500) keep(null);
        return false;
      }
      keep(sessionOf(r.body, session.user));
      return true;
    }

    const sessionOf = (b, user) => ({
      access_token: b.access_token,
      refresh_token: b.refresh_token,
      expires_at: Number(b.expires_at) || nowSec() + (Number(b.expires_in) || 3600),
      user: b.user ? { id: b.user.id, email: b.user.email } : user || null,
    });

    // token is a usable access token, refreshed when it runs out within a
    // minute, or "" when no one is signed in.
    async function token() {
      const other = newer();
      if (other) session = other;
      if (!session) return "";
      if (session.expires_at - 60 <= nowSec() && !(await refresh())) return "";
      return session ? session.access_token : "";
    }

    // rest calls the store as the signed-in Operator, refreshing once when
    // the store says the token has run out.
    async function rest(method, path, body) {
      let t = await token();
      if (!t) return { ok: false, status: 401, error: "Sign in to keep songs here." };
      let r = await call(method, "/rest/v1" + path, { body, bearer: t, prefer: "return=representation" });
      if (r.status === 401 && (await refresh())) {
        t = await token();
        r = await call(method, "/rest/v1" + path, { body, bearer: t, prefer: "return=representation" });
      }
      if (r.status === 401) keep(null);
      return r;
    }
    const one = (r) => (r.ok ? { ok: true, row: Array.isArray(r.body) ? r.body[0] || null : r.body } : r);
    const enc = encodeURIComponent;

    const api = {
      user: () => (session && session.user) || null,
      signedIn: () => !!(session && session.access_token && session.user),

      // sendLink asks the store to email a sign-in code and a link that
      // returns to back, the page's own address.
      async sendLink(email, back) {
        const e = String(email || "").trim();
        if (!EMAIL.test(e)) return { ok: false, error: "Type the email you sign in with." };
        const r = await call("POST", `/auth/v1/otp?redirect_to=${enc(back)}`, { body: { email: e, create_user: true } });
        if (!r.ok) return r;
        return { ok: true, text: `A sign-in email is on its way to ${e}. Press and hold its Sign in link, copy it and paste it below to sign in here, or open it in this browser. It works once, within the hour.` };
      },

      // signInHere signs this browser in with the sign-in email's link,
      // pasted, or with its code, typed with the email it went to.
      async signInHere(email, typed) {
        const hash = linkOf(typed);
        let body;
        if (hash) body = { type: "email", token_hash: hash };
        else {
          const code = codeOf(typed);
          if (!code) return { ok: false, error: "Paste the Sign in link from the email: press and hold it in the email, copy it, and paste it here." };
          const e = String(email || "").trim();
          if (!EMAIL.test(e)) return { ok: false, error: "Type the email the code was sent to." };
          body = { type: "email", email: e, token: code };
        }
        const r = await call("POST", "/auth/v1/verify", { body });
        if (!r.ok) {
          if (r.status === 403 || /expired|invalid/i.test(String((r.body && (r.body.msg || r.body.message || r.body.error_code)) || ""))) {
            return { ok: false, status: r.status, error: hash
              ? "That link has run out or was used already. Send a new email."
              : "That code is wrong, has run out or was used already. Check it, or send a new email." };
          }
          return r;
        }
        if (!r.body || !r.body.access_token || !r.body.refresh_token || !r.body.user) return { ok: false, error: "The store did not give a session for that code. Send a new email." };
        keep(sessionOf(r.body));
        return { ok: true, user: session.user };
      },

      // take reads the sign-in link's #hash. It answers null when the hash
      // is not the link's, else whether the Operator is now signed in.
      async take(hash) {
        const h = fromHash(hash, nowSec());
        if (!h) return null;
        if (h.error) return { ok: false, error: h.error };
        const u = await call("GET", "/auth/v1/user", { bearer: h.session.access_token });
        if (!u.ok) return { ok: false, error: u.error };
        keep({ ...h.session, user: { id: u.body.id, email: u.body.email } });
        return { ok: true, user: session.user };
      },

      async signOut() {
        const t = session && session.access_token;
        keep(null);
        storage.drop(OPEN_KEY);
        storage.drop(WRITING_KEY);
        if (t) await call("POST", "/auth/v1/logout", { bearer: t });
        return { ok: true };
      },

      // list is the Operator's songs, the latest changed first.
      async list() {
        const r = await rest("GET", "/songs?select=id,title,answers,latest_n,finished_n,created_at,updated_at&order=updated_at.desc");
        return r.ok ? { ok: true, songs: r.body || [] } : r;
      },

      async song(id) {
        const r = one(await rest("GET", `/songs?id=eq.${enc(id)}&select=*`));
        if (r.ok && !r.row) return { ok: false, status: 404, error: "That song is not in My songs any more." };
        return r.ok ? { ok: true, song: r.row } : r;
      },

      // versions is a song's versions, the latest first.
      async versions(id) {
        const r = await rest("GET", `/song_versions?song_id=eq.${enc(id)}&select=n,lyric,answers,style,structure,note,created_at&order=n.desc`);
        return r.ok ? { ok: true, versions: r.body || [] } : r;
      },

      // create starts a song with its first version. The store numbers it 1.
      async create(v) {
        const title = String(v.title || titleOf(v.answers)).trim().slice(0, LIMITS.title) || UNTITLED;
        const long = tooLong({ ...v, title });
        if (long) return { ok: false, error: long };
        const s = one(await rest("POST", "/songs", { title, answers: v.answers || {} }));
        if (!s.ok) return s;
        const ver = one(await rest("POST", "/song_versions", versionRow(s.row.id, v)));
        if (!ver.ok) {
          await rest("DELETE", `/songs?id=eq.${enc(s.row.id)}`);
          return ver;
        }
        return { ok: true, song: { ...s.row, latest_n: ver.row.n, answers: ver.row.answers }, version: ver.row };
      },

      // save keeps the box as the song's next version. A new version
      // unmarks a finished one: the store does that itself.
      async save(id, v) {
        const long = tooLong(v);
        if (long) return { ok: false, error: long };
        const r = one(await rest("POST", "/song_versions", versionRow(id, v)));
        return r.ok ? { ok: true, version: r.row } : r;
      },

      // restore keeps an older version as the newest, so nothing between is
      // lost.
      restore(id, v) {
        return api.save(id, { ...v, note: `restored from v${v.n}` });
      },

      async finish(id, n) {
        const r = one(await rest("PATCH", `/songs?id=eq.${enc(id)}`, { finished_n: n }));
        return r.ok ? { ok: true, song: r.row } : r;
      },

      async reopen(id) {
        const r = one(await rest("PATCH", `/songs?id=eq.${enc(id)}`, { finished_n: null }));
        return r.ok ? { ok: true, song: r.row } : r;
      },

      async rename(id, title) {
        const t = String(title || "").trim();
        if (!t) return { ok: false, error: "A song needs a title." };
        if (t.length > LIMITS.title) return { ok: false, error: `The title is over ${LIMITS.title} characters.` };
        const r = one(await rest("PATCH", `/songs?id=eq.${enc(id)}`, { title: t }));
        return r.ok ? { ok: true, song: r.row } : r;
      },

      // remove deletes a song and, with it, every version.
      async remove(id) {
        const r = await rest("DELETE", `/songs?id=eq.${enc(id)}`);
        if (!r.ok) return r;
        if (!Array.isArray(r.body) || r.body.length !== 1) return { ok: false, error: "That song was not deleted: it is not in My songs." };
        if (storage.get(OPEN_KEY) === id) storage.drop(OPEN_KEY);
        if (storage.get(WRITING_KEY) === id) storage.drop(WRITING_KEY);
        return { ok: true };
      },

      // importSong makes a new song from a parsed file, its versions saved in
      // their order, and marks finished the one that was.
      async importSong(d) {
        const [first, ...rest] = d.versions;
        const made = await api.create({ ...first, title: d.song.title, note: first.note || `imported v${first.n}` });
        if (!made.ok) return made;
        const id = made.song.id;
        const numbers = new Map([[first.n, made.version.n]]);
        for (const v of rest) {
          const r = await api.save(id, { ...v, note: v.note || `imported v${v.n}` });
          if (!r.ok) return { ...r, error: `${r.error} The song was made with ${numbers.size} of ${d.versions.length} versions.`, song: made.song };
          numbers.set(v.n, r.version.n);
        }
        if (d.song.finished_n != null && numbers.has(d.song.finished_n)) await api.finish(id, numbers.get(d.song.finished_n));
        const s = await api.song(id);
        return { ok: true, song: s.ok ? s.song : made.song, count: numbers.size };
      },

      // The song open in My songs, and the song Write a song saved, are kept
      // in this browser by id only.
      openId: () => storage.get(OPEN_KEY) || null,
      setOpen: (id) => (id ? storage.set(OPEN_KEY, id) : storage.drop(OPEN_KEY)),
      writingId: () => storage.get(WRITING_KEY) || null,
      setWriting: (id) => (id ? storage.set(WRITING_KEY, id) : storage.drop(WRITING_KEY)),
    };
    return api;
  }

  return { URL, KEY, SESSION_KEY, OPEN_KEY, WRITING_KEY, FORMAT, LIMITS, UNTITLED, PAUSED, trouble, codeOf, linkOf, fromHash, stable, plain, changed, titleOf, tooLong, diff, exportSong, parseImport, client };
})();

globalThis.musicSongs = musicSongs;
