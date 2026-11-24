/* Vault: keeping this device and the cloud in step.

   Everything shows from this device's copy first (V.data, saved in V.db), so the app opens at once and works
   offline. A change made here is saved here with _dirty set, then sent (push). Changes from elsewhere come in by
   Supabase Realtime as they happen, and by asking for "everything since" (pull) on start, every so often, and when
   the app comes back to the front: rows carry the cloud's own updated_at, so nothing is missed. A row changed here
   and not sent yet always wins over the cloud's copy until it's sent.

   Notes are sent only if the cloud still has the version they were changed from (_base_at, its updated_at): when
   another device (or Jarvis) got there first, the two are put together line by line (V.mergeLines, from _base, the
   version both started from) and that is sent instead; where both changed the very same lines (or a locked note's
   sealed words), this device's stay and the other version is kept as a "(conflict copy)" note beside it. So two
   devices typing in one note at once both keep their words. A plain version never goes over one locked on another
   device (1.22.5): the two go together sealed, with the PIN, which is asked for when it isn't unlocked here (the
   change waits here until then). Folders and files: the last device to send wins.

   On the phone the supabase client signs in itself (its session in localStorage). In the PC app the Python side
   owns the sign-in (vault/cloud.py, shared with Jarvis), and the page asks it for each access token (V.pc). */
'use strict';

V.data = { notes: new Map(), folders: new Map(), transfers: new Map(), clips: [], settings: {}, user: null };

/* ---------------------------------------------------------------- the PC app's side (vault/desktop.py) */

V.pc = V.desktop ? (() => {
  let bridge = null;
  let next = 1;
  const waiting = new Map();
  const ready = new Promise((resolve) => {
    const connect = () => new window.QWebChannel(window.qt.webChannelTransport, (channel) => {
      bridge = channel.objects.vault;
      bridge.reply.connect((id, json) => {
        const done = waiting.get(id);
        if (!done) return;
        waiting.delete(id);
        const answer = JSON.parse(json || '{}');
        if (answer.error) done.reject(Object.assign(new Error(answer.error), { kind: answer.kind || '' }));
        else done.resolve(answer);
      });
      bridge.event.connect((name, json) => V.emit('pc:' + name, JSON.parse(json || '{}')));
      resolve();
    });
    if (window.QWebChannel && window.qt) connect();
    else window.addEventListener('DOMContentLoaded', connect);
  });
  const call = async (name, args = {}) => {
    await ready;
    const id = next++;
    return new Promise((resolve, reject) => {
      waiting.set(id, { resolve, reject });
      bridge.call(id, name, JSON.stringify(args));
    });
  };
  // What every PC app since Vault 1.0 answers. A newer one lists its calls in config's `can` (calls are only ever
  // added, never taken away: tests/test_vault_desktop.py keeps this list), so a page newer than its PC app can ask
  // V.pc.can() before using one.
  const BRIDGE_V1 = ['appReady', 'quietClipboard', 'config', 'token', 'health', 'signIn', 'signOut', 'changePassword',
    'setUp', 'saveFile', 'openFile', 'showFile', 'openLink', 'setClipboard', 'notify', 'setPref', 'pickFolder'];
  let calls = BRIDGE_V1;
  // Vault on its own (config.standalone, vault/standalone): no Jarvis on this PC, so a newer PC part comes as a new
  // Vault ZIP, and AI keys are pasted in Settings > AI as on a phone (js/ai.js).
  let standalone = false;
  return {
    ready,
    call,
    can: (name) => calls.includes(name),
    knows: (config) => {
      if (config && Array.isArray(config.can)) calls = config.can;
      standalone = !!(config && config.standalone);
    },
    standalone: () => standalone,
    howToUpdate: () => (standalone
      ? 'Get the newest Wefty from the person who invited you, unzip it and double-click its setup-wefty.bat.'
      : 'Open Jarvis and click Update: Wefty comes with it.'),
    token: () => call('token').then((answer) => answer.token),
    setClipboard: (text) => call('setClipboard', { text }),
    notify: (title, text) => call('notify', { title, text }).catch(() => {}),
  };
})() : null;

/* ---------------------------------------------------------------- the cloud */

V.cloud = (() => {
  const FIELDS = {
    notes: ['id', 'folder_id', 'title', 'body', 'pinned', 'due', 'done', 'locked', 'secret', 'attachments', 'template',
      'deleted', 'deleted_at', 'extra'],
    folders: ['id', 'name', 'icon', 'sort', 'deleted', 'extra'],
    transfers: ['id', 'kind', 'name', 'path', 'size', 'mime', 'text', 'from_device', 'to_device', 'received_at',
      'deleted', 'extra'],
  };
  // What a column holds when a row made here doesn't say (every row sent has every column, as one bulk upsert has
  // to: a column missing from it would be set to null).
  const BLANK = {
    folder_id: null, title: '', body: '', pinned: false, due: null, done: false, locked: false, secret: null,
    attachments: [], template: '', deleted: false, deleted_at: null, extra: {}, name: '', icon: '', sort: 0,
    kind: 'file', path: null, size: 0, mime: '', text: '', from_device: '', to_device: '', received_at: null,
  };
  const SYNCED = ['folders', 'notes', 'transfers'];
  // What a note changed here also keeps, for putting it together with another device's change (never sent):
  // _base / _base_at = the cloud's version it was changed from, _theirs = a newer cloud version that came meanwhile,
  // _merged / _mine = a token for the last time another device's words were put in here, and this device's version
  // just before (so a save from a copy older than that keeps them: see carryBase), _sent = a new note as it was sent
  // the first time, while no answer has said whether the cloud took it (see sendNew). Of a note that's locked now,
  // these are kept without its plain words (1.22.6: see shut). _unanswered (1.22.6): the prints of this device's own
  // changes sent while no answer has said what became of them (see unanswered).
  const NOTE_LOCAL = ['_base', '_base_at', '_theirs', '_merged', '_mine', '_sent', '_unanswered'];
  const MOST_TRIES = 4;
  const POLL_LIVE = 120000;   // with Realtime working, a safety check every 2 minutes
  const POLL_OFFLINE = 20000; // without it, every 20 seconds
  const TRASH_DAYS = 30;
  let sb = null;
  let config = null;
  let channel = null;
  let live = false;
  let timer = null;
  let pushing = null;
  let pushAgain = false;
  let status = 'idle';
  // (1.22.6) This page let go of its sign-in for good: signed out here, or it found the kept sign-in gone or someone
  // else's. From then on it never looks at the cloud again, and nothing a look still on its way brings is kept here
  // (a late answer after Delete my account was the next person's copy, DEV-09). A sign-in starts a new page.
  let ended = false;
  const links = new Map();
  const forgotten = new Map();  // note id -> the note as it was when it was forgotten here, deleted for good (see save)
  // The settings row as the cloud has it, read since this page started (each sync reads it first of all). Until then
  // V.data.settings is only this device's copy, or nothing at all on a new or wiped device, so a choice that hangs on
  // it ("Use Claude too", js/ai.js) waits for this (settingsReady) instead of taking "nothing" for "off".
  let settingsRead = false;
  // The last try at reading it failed (offline, the cloud asleep or not answering): a wait for it then ends at once, or
  // with a fresh try (settingsReady), never sits out its whole time for a row that can't come.
  let settingsFailed = false;
  let readingSettings = false;  // a sync that reads it is under way
  const settingsWaiters = new Set();
  const SETTING_FIELDS = ['pin_salt', 'pin_check', 'extra'];
  V.on('signed-out', () => { settingsRead = false; settingsFailed = false; });

  const setStatus = (value) => { if (value !== status) { status = value; V.emit('status', value); } };
  // Rows the cloud set aside (a note too big to go up): the status is honest about them ('held') instead of a plain
  // 'synced', and clears as soon as they're changed, removed or finally accepted.
  const heldCount = () => SYNCED.reduce((n, table) => n + [...V.data[table].values()]
    .filter((row) => row._refused && row._refused === row._dirty && !row._purge).length, 0);
  // (1.22.6: the browser's "offline" only counts while the cloud hasn't answered lately either, offlineHint; and an
  // error already said in plain words keeps its kind)
  const offlineError = (error) => offlineHint() || (!!error && error.kind === 'offline')
    || /fetch|network|load failed|timed? ?out/i.test(String(error && (error.message || error)));
  const authError = (error) => error && (error.kind === 'signed-out' || error.status === 401 ||
    /JWT|refresh token|not authenticated|signed out/i.test(error.message || ''));

  /* (1.22.5) The sign-in kept here ('vault-auth', supabase-js's session) belongs to the cloud whose sign-in service
     made it, and its access token says which: 'iss', https://<ref>.supabase.co/auth/v1. A client made for any other
     cloud never gets it, so a saved cloud changed under someone signed in (before 1.22.5 a #connect= link could do
     that, from any web page) can't send their sign-in there: that cloud just sees nobody signed in, and the sign-in
     stays kept for its own cloud. A token that names no cloud by its address can't be told apart, and is kept as
     before. Nothing stored changes. */
  function issuerOf(text) {
    try {
      const session = typeof text === 'string' ? JSON.parse(text) : text;
      const part = String((session && session.access_token) || '').split('.')[1] || '';
      const claims = JSON.parse(atob(part.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - part.length % 4) % 4)));
      return claims && typeof claims.iss === 'string' ? claims.iss : '';
    } catch (error) {
      return '';
    }
  }
  const originOf = (url) => { try { return new URL(String(url)).origin; } catch (error) { return ''; } };
  /* Whether a kept session (its text, or the object) may go to the cloud at `url`. */
  function madeBy(session, url) {
    const iss = issuerOf(session);
    if (!/^https?:\/\//i.test(iss)) return true;
    return !!originOf(url) && originOf(iss) === originOf(url);
  }
  /* The kept session's text when it belongs to `url` (or names no cloud), else null. */
  function keptFor(url) {
    let text = null;
    try { text = localStorage.getItem('vault-auth'); } catch (error) { return null; }
    return text && madeBy(text, url) ? text : null;
  }
  /* localStorage as supabase-js sees it for the cloud at `url`: another cloud's session isn't there. */
  const storageFor = (url) => ({
    getItem: (key) => {
      const value = localStorage.getItem(key);
      return key === 'vault-auth' && value && !madeBy(value, url) ? null : value;
    },
    setItem: (key, value) => { localStorage.setItem(key, value); },
    removeItem: (key) => { localStorage.removeItem(key); },
  });

  /* (1.22.6, PLAT-16) A deadline on every request to the cloud: a school wifi's sign-in page, or one bar of signal,
     can take a request and never answer, and a sync waiting on it waited for ever ("Syncing..." until Wefty was
     closed, and nothing else went up meanwhile). Each request now gives up after its part's time and fails like a
     dropped connection, so what it carried waits here and goes at the next look, as offline. A caller's own signal
     still stops it sooner. `deadlines` can be changed (tests do).
     - What a request carries gets time to go up on a slow link too, counted from its first byte: its size in bytes
       (UTF-8, as it goes) at `deadlines.bytesPerSecond`, 4 KB a second, one bar of signal at its worst, on top of the
       part's own time. Before, only a body over 1 MB got more, and the 30 s cut a long note going up at 20 KB a
       second part-way, every time, for ever, with everything behind it waiting (N2: a step back from 1.22.5).
     - Given up, it ends as an AbortError whose words still say "Failed to fetch (no answer in time)": the library sends
       a read that failed any other way three times more (after 1, 2 and 4 s), so a look with no answer took four
       deadlines, not one (N14). The words are what every caller goes by (offlineError: /fetch/).
     - Once the answer has started, its words may still stop coming (a connection that dies half way): the answer is
       given up when nothing more of it comes for the part's time, never while it's moving (as files going up, below:
       watched).
     - A read the cloud answers 503 or 520 is asked again by the library after the wait the answer names
       (Retry-After), with no limit: never more than `deadlines.retryAfter` seconds here. */
  const deadlines = { auth: 20000, rest: 30000, functions: 45000, storage: 60000, bytesPerSecond: 4096, retryAfter: 5,
    probe: 8000 };
  const NO_ANSWER = 'Failed to fetch (no answer in time)';
  const STOPPED_COMING = 'Failed to fetch (the answer stopped coming)';
  const gaveUp = (words) => new DOMException(words, 'AbortError');
  function partOf(url) {
    const path = (() => { try { return new URL(String(url)).pathname; } catch (error) { return String(url); } })();
    const part = (path.match(/^\/(auth|rest|functions|storage)\/v1\//) || [])[1];
    return part || 'rest';
  }
  /* How many bytes `body` is as it goes up (a string as UTF-8: a plain letter is 1, an accent 2, Chinese or Korean 3,
     an emoji 4). */
  function bytesOf(body) {
    if (!body) return 0;
    if (typeof body === 'string') {
      let n = body.length;
      for (let i = 0; i < body.length; i++) {
        const c = body.charCodeAt(i);
        if (c >= 0x80) n += c >= 0x800 && (c < 0xd800 || c > 0xdfff) ? 2 : 1;
      }
      return n;
    }
    if (typeof body.size === 'number') return body.size;
    if (typeof body.byteLength === 'number') return body.byteLength;
    if (typeof URLSearchParams === 'function' && body instanceof URLSearchParams) return bytesOf(body.toString());
    return 0;
  }
  function deadlineFor(url, init) {
    const part = partOf(url);
    let ms = deadlines[part] || deadlines.rest;
    const size = bytesOf(init && init.body);
    if (size) ms += Math.ceil(size * 1000 / Math.max(1, deadlines.bytesPerSecond));
    return ms;
  }
  /* (1.22.6, N1 and ACC-13) What a table or file request must never go out with, on the web: the cloud's public key as
     its pass while a sign-in is still kept here (the library couldn't renew it just now and asks as nobody, which the
     cloud answers 401: that isn't a sign-out, see renewSoon), or another account's pass (another tab of this browser
     signed someone else in: this page's person is signed out here, see restart). The words it fails with ('' = it may
     go): like a dropped connection, so what it carried waits here. */
  function bearerOf(input, init) {
    const headers = (init && init.headers) || (input && typeof input === 'object' && input.headers) || null;
    if (!headers) return '';
    if (typeof headers.get === 'function') return headers.get('Authorization') || '';
    const pairs = Array.isArray(headers) ? headers : Object.entries(headers);
    const found = pairs.find(([name]) => /^authorization$/i.test(String(name)));
    return found ? String(found[1] || '') : '';
  }
  function subOf(token) {
    try {
      const part = String(token || '').split('.')[1] || '';
      const claims = JSON.parse(atob(part.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - part.length % 4) % 4)));
      return claims && typeof claims.sub === 'string' ? claims.sub : '';
    } catch (error) {
      return '';
    }
  }
  function mustNotGo(url, input, init) {
    if (V.desktop || !config) return '';
    let path = '';
    try { path = new URL(String(url)).pathname; } catch (error) { return ''; }
    if (!/^\/(rest|storage)\/v1\//.test(path)) return '';
    const pass = bearerOf(input, init).replace(/^Bearer\s+/i, '');
    if (!pass) return '';
    if (pass === config.key) return kept() ? 'Failed to fetch (the sign-in is being renewed)' : '';
    const me = V.data.user && V.data.user.id;
    const whose = subOf(pass);
    if (me && whose && whose !== me) { restart(); return 'Failed to fetch (someone else signed in here)'; }
    return '';
  }
  function deadlineFetch(input, init = {}) {
    const url = typeof input === 'string' ? input : (input && input.url) || String(input);
    const why = mustNotGo(url, input, init);
    // (named AbortError: the library asks again three times after a TypeError, never after this)
    if (why) return Promise.reject(new DOMException(why, 'AbortError'));
    const control = new AbortController();
    const theirs = init.signal || (input && typeof input === 'object' && input.signal) || null;
    const stop = () => control.abort(theirs && theirs.reason !== undefined ? theirs.reason
      : new DOMException('The request was stopped.', 'AbortError'));
    if (theirs) { if (theirs.aborted) stop(); else theirs.addEventListener('abort', stop, { once: true }); }
    const timer = setTimeout(() => control.abort(gaveUp(NO_ANSWER)), deadlineFor(url, init));
    const letGo = () => { clearTimeout(timer); if (theirs) theirs.removeEventListener('abort', stop); };
    return fetch(input, { ...init, signal: control.signal }).then((response) => {
      clearTimeout(timer);
      heardFrom(url, response);
      return watched(response, control, deadlines[partOf(url)] || deadlines.rest, letGo);
    }, (error) => { letGo(); throw error; });
  }
  // (The kept sign-in's own client only: a throwaway one, such as the move pass's swap, sees a 429 as it came.)
  function keptFetch(input, init) {
    const url = typeof input === 'string' ? input : (input && input.url) || String(input);
    return deadlineFetch(input, init).then((response) => busyRenewal(url, response));
  }
  /* (1.22.6, round C, DEV2-04) "Too many requests" (429) to a renewal of the kept sign-in is the cloud's wait-and-try-again,
     as it is for the tables (refusalOf), but the library lets go of the sign-in for any answer it doesn't know as that
     (only 5xx are): so it's handed the library's own "try again later" instead (503). A real refusal (400, 401, 403,
     404) and every other request are left as they came. */
  function busyRenewal(url, response) {
    if (!response || response.status !== 429 || typeof Response !== 'function') return response;
    if (!/\/auth\/v1\/token\?(?:.*&)?grant_type=refresh_token/.test(url)) return response;
    try { return new Response(response.body, { status: 503, statusText: 'Busy', headers: response.headers }); } catch (error) { return response; }
  }
  // (null-body answers: nothing to watch)
  const EMPTY_ANSWER = new Set([101, 103, 204, 205, 304]);
  /* The answer as the caller sees it: its words given up when they stop coming for `ms` (each piece that comes starts
     the wait again: a slow answer that keeps coming is never cut), and a Retry-After over `deadlines.retryAfter`
     seconds said as that. `done` once it's over (the caller's own signal no longer needed). */
  function watched(response, control, ms, done) {
    if (!response || typeof Response !== 'function' || typeof Headers !== 'function') { done(); return response; }
    const after = Number.parseInt(response.headers.get('Retry-After') || '', 10);
    const shorten = [503, 520].includes(response.status) && Number.isFinite(after) && after > deadlines.retryAfter;
    const watch = !!response.body && !EMPTY_ANSWER.has(response.status) && typeof TransformStream === 'function';
    if (!shorten && !watch) { done(); return response; }
    let body = response.body;
    if (watch) {
      let timer = 0;
      let out = null;
      const over = () => { clearTimeout(timer); done(); };
      const stalled = () => {
        const why = gaveUp(STOPPED_COMING);
        try { if (out) out.error(why); } catch (error) { /* (already over) */ }  // (what the reader is told)
        control.abort(why);  // (and the request itself let go)
      };
      const wait = () => { clearTimeout(timer); timer = setTimeout(stalled, ms); };
      wait();
      body = response.body.pipeThrough(new TransformStream({
        start(controller) { out = controller; },
        transform(piece, controller) { wait(); controller.enqueue(piece); },
        flush() { over(); },
      }));
      // (an answer nobody reads, or one read to its end or given up: the wait goes with it)
      control.signal.addEventListener('abort', over, { once: true });
    } else {
      done();
    }
    const headers = new Headers(response.headers);
    if (shorten) headers.set('Retry-After', String(deadlines.retryAfter));
    try {
      return new Response(body, { status: response.status, statusText: response.statusText, headers });
    } catch (error) {
      return response;  // (an answer that can't be made again as it was: the caller gets it as it came)
    }
  }

  /* -- what the cloud's answers say (1.22.6)

     When it last answered anything at all: a browser that says it's offline (navigator.onLine) while the cloud
     answers is wrong (PLAT-16-online: Chrome and Edge on Windows sometimes say so for hours, and the PC app runs on
     Chromium too), so that's a hint here, never a stop (see sync). And whether its answers to the tables are refusals
     for now (SEC-23): over its plan's limits (402), too many requests (429), asleep (540) or in trouble (5xx), as when
     someone uses up a free cloud's month. Its words are said once (sayRefusing): the notes stay on this device and go
     up once it takes them again; nothing is set aside for good for it (refused). */
  let answeredAt = -Infinity;
  let refusing = null;  // { kind: 'full' | 'busy' | 'asleep' | 'trouble', looks, said } until the tables answer again
  let refusalSaid = -Infinity;
  const REFUSAL_GAP = 30 * 60000;  // (said again for a new spell of it only after this long)
  const refusalOf = (status) => (status === 402 ? 'full' : status === 429 ? 'busy' : status === 540 ? 'asleep'
    : status >= 500 && status < 600 ? 'trouble' : '');
  function heardFrom(url, response) {
    if (!config || !response || originOf(url) !== originOf(config.url)) return;
    answeredAt = performance.now();
    if (partOf(url) !== 'rest') return;
    const kind = refusalOf(response.status);
    if (response.status >= 200 && response.status < 300) refusing = null;
    else if (kind) refusing = { looks: 0, ...(refusing || {}), kind };
  }
  const ANSWERED_FOR = 60000;  // (the cloud answered this lately: the browser's "offline" is taken as wrong)
  const answeredLately = () => performance.now() - answeredAt < ANSWERED_FOR;
  /* Whether to go by the browser's "offline": only when the cloud hasn't answered since the browser last said it went
     offline (or for ANSWERED_FOR). (The PC app always tries: its own Python can tell what's wrong, whyNot.) */
  const offlineHint = () => !navigator.onLine && !V.desktop && !answeredLately();
  try { window.addEventListener('offline', () => { answeredAt = -Infinity; }); } catch (error) { /* (no window here) */ }
  const REFUSING_WORDS = {
    asleep: 'Your cloud is asleep, so it isn\'t taking changes right now. Your notes are safe on this device and will go up once it\'s awake.',
    other: 'The cloud is refusing changes right now. Your notes are safe on this device and will go up later.',
  };
  /* Said once a refusal has lasted: at once for a cloud over its plan's limits, after a second look for the rest (a
     cloud that's busy for a moment says nothing). */
  function sayRefusing(state) {
    if (!refusing || !['error', 'asleep', 'offline', 'held'].includes(state)) return;
    refusing.looks += 1;
    if (refusing.kind !== 'full' && refusing.looks < 2) return;
    if (performance.now() - refusalSaid < REFUSAL_GAP || refusing.said) return;
    refusing.said = true;
    refusalSaid = performance.now();
    V.toast(refusing.kind === 'asleep' ? REFUSING_WORDS.asleep : REFUSING_WORDS.other, { kind: 'err', ms: 10000 });
  }
  V.on('status', (state) => { try { sayRefusing(state); } catch (error) { /* (words only) */ } });

  function client(cfg) {
    // The same cloud asked for again on the web (js/doors.js made its client before the start got here): the one
    // already made, so a session never has two clients renewing it (each renewal uses the last one's token up).
    if (sb && !V.desktop && config && config.url === cfg.url && config.key === cfg.key) {
      config = cfg;
      return sb;
    }
    config = cfg;
    const options = { realtime: { params: { eventsPerSecond: 5 } }, global: { headers: { 'x-vault': V.VERSION }, fetch: keptFetch } };
    if (V.desktop) options.accessToken = () => V.pc.token();
    else {
      options.auth = { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: 'vault-auth',
        storage: storageFor(cfg.url) };
    }
    sb = window.supabase.createClient(cfg.url, cfg.key, options);
    // (1.22.6, N1) The library's own renewal working while a look waits for one: that look now, not at the next check.
    if (!V.desktop && sb.auth.onAuthStateChange) {
      sb.auth.onAuthStateChange((event) => {
        if (event !== 'TOKEN_REFRESHED' || !renewing || ended) return;
        renewing = false;
        clearTimeout(renewTimer);
        renewTimer = 0;
        setTimeout(() => sync(), 0);  // (outside the library's own turn)
      });
    }
    return sb;
  }

  async function accessToken() {
    if (V.desktop) return V.pc.token();
    // (offline: no waiting on a renewal that can't happen; what needed it goes once the internet's back, as ever. The
    // browser's word for it only while the cloud hasn't answered lately either, 1.22.6: offlineHint)
    if (offlineHint() && kept()) throw new Error('Failed to fetch (offline)');
    const { data } = await sb.auth.getSession();
    // (1.22.6, ACC-13: another account's, signed in from another tab, is never this page's person's to use)
    if (data.session && V.data.user && data.session.user && data.session.user.id !== V.data.user.id) {
      restart();
      throw new Error('Failed to fetch (someone else signed in here)');
    }
    if (data.session) return data.session.access_token;
    // An expired session can't be renewed offline, but it's still kept: only a real sign-out is one. (1.22.6: the
    // renewal is asked for again once the library's minute is up, see renewSoon.)
    if (!navigator.onLine || keptFor(config && config.url)) {
      if (navigator.onLine && kept()) renewSoon();
      throw new Error('Failed to fetch (offline)');
    }
    throw Object.assign(new Error('Signed out'), { kind: 'signed-out' });
  }

  /* -- this device's copy */

  async function loadLocal() {
    for (const table of SYNCED) {
      V.data[table] = new Map((await V.db.all(table)).map((row) => [row.id, row]));
    }
    V.data.clips = (await V.db.all('clips')).sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
    V.data.settings = (await V.db.meta('settings')) || {};
    for (const table of SYNCED) V.emit('data', table);
  }

  async function keep(table, rows, { fromCloud = true } = {}) {
    if (ended) return [];  // (1.22.6: an answer on its way when this page let go of its sign-in is never kept)
    const map = V.data[table];
    const changed = [];
    for (const row of rows) {
      const here = map.get(row.id);
      if (fromCloud && here && here._dirty) {
        // Ours isn't sent yet, so it stays; a newer note from the cloud is kept aside to be put together with it (one
        // deleted for good elsewhere too: whether ours outlives that is decided as it's sent, see mergeIn).
        if (table === 'notes' && newer(row, here) && !(here._theirs && here._theirs.updated_at >= row.updated_at)) {
          const waiting = { ...here, _theirs: row };
          map.set(row.id, waiting);
          await V.db.put(table, waiting);
        }
        continue;
      }
      if (table === 'notes' && isBuried(row)) {  // deleted for good on another device: forgotten here too (DATA-02)
        if (here) await forget(here);
        continue;
      }
      if (row.deleted && table !== 'notes') {
        if (here) { map.delete(row.id); await V.db.del(table, row.id); changed.push(row); }
        continue;
      }
      if (fromCloud && here && here.updated_at && row.updated_at && here.updated_at >= row.updated_at) continue;
      map.set(row.id, row);
      changed.push(row);
    }
    if (changed.length) {
      await V.db.putMany(table, changed.filter((row) => map.has(row.id)));
      V.emit('data', table);
    }
    return changed;
  }

  /* A change made on this device: shown and saved at once, sent soon after. `quiet` (a note whose flash cards moved
     on, js/review.js): when nothing else in it changed, it isn't an edit, so it keeps its place in the lists. */
  async function save(table, row, { quiet = false } = {}) {
    let stamped = { ...row, _dirty: stamp(), _edited: new Date().toISOString() };
    // (1.22.6, ACC-13) Someone else signed in from another tab: this page's person's change never goes into their copy
    if (foreign()) { restart(); return stamped; }
    if (table === 'notes') {
      const here = V.data.notes.get(row.id);
      if (quiet && here && !here._purge && notePrint(stamped) === notePrint(here)) {
        const was = V.editedAt(here) || stamped._edited;
        stamped._edited = was;
        stamped.extra = { ...(stamped.extra || {}), edited_at: was, edited_print: notePrint(stamped) };
      }
      stamped = carryBase(stamped, here, row);
      if (!here && forgotten.has(row.id)) {
        // Deleted for good elsewhere, and saved here from a copy something still held (the open note, a flash card's
        // progress): only new words, a new title or new files bring it back, as for a change that hadn't gone up
        // (madeHere); anything else leaves it gone.
        const was = forgotten.get(row.id);
        if (!madeHere(stamped, was)) return stamped;
        stamped._base = was;
        forgotten.delete(row.id);
      }
      if (stamped.locked) shutCopies(stamped);  // (1.22.6: nothing of a locked note's plain words stays here)
    }
    // (sent soon even when this device couldn't keep it, its storage full: it's in memory, and would wait for the next
    // look otherwise, DATA-24)
    try { await put(table, stamped); } finally { pushSoon(); }
    return stamped;
  }

  /* (1.22.6) A locked note sealed again as it was (js/lock.js sealAgain: with the PIN in use now, and what belongs in
     its seal moved into it): `secret` and `extra` written straight to the cloud, only if it still has the version this
     device has, and only when this device has no change of its own to that note waiting. It's never a change to be
     put together with another device's: two devices tidying the same note at the same moment would each have "changed
     its words" (two seals of the same words never look alike), and a conflict copy would come of it; and a note
     changed here outlives a Delete forever made elsewhere meanwhile (DATA-17), which a tidy mustn't cause. Nor is it
     an edit: the time the note was last changed stays, here and on the other devices (extra.edited_at with its
     print, as a quiet save keeps it). True when it was written; false when the cloud has another version by now (the
     next look brings it, and the next time the PIN is typed sees to it). */
  async function reseal(id, secret, extra) {
    const row = V.data.notes.get(id);
    if (!sb || !row || !row.locked || row._dirty || row._purge || !row.updated_at) return false;
    const was = V.editedAt(row);
    const next = { ...fieldsOf(row), secret, extra: { ...(extra || {}) } };
    next.extra.edited_at = was;
    next.extra.edited_print = notePrint(next);
    const { data, error, status } = await sb.from('notes').update({ secret: next.secret, extra: next.extra })
      .eq('id', id).eq('updated_at', row.updated_at).select();
    if (error) throw Object.assign(error, { status });
    if (!data || !data.length) return false;
    heard(data[0].updated_at);
    // (changed here while it went: that change goes up as ever, and is put together with this version then)
    if (V.data.notes.get(id) === row) await keep('notes', [row._edited ? { ...data[0], _edited: row._edited } : data[0]], { fromCloud: false });
    return true;
  }

  /* -- when a note was last edited

     The lists sort by it and say it ("2 min ago"): this device's own last change (_edited), else the cloud's
     updated_at. The cloud's moves on with any change, a flash card's progress too, so a quiet save also writes the
     time the note had into extra.edited_at, with a print of everything in the note but its flash cards
     (extra.edited_print): the other devices go by that time for as long as the print still matches, and by the
     cloud's again as soon as the note really changes, wherever that was. History (js/history.js) only ever looks at
     the title and the words, so cards moving on never make a copy either. */
  // (checkin: after a test, how it went, js/checkin.js: asked and answered quietly, never an edit)
  // (quiz: Test me's wrong choices made by the AI, js/learn.js: kept quietly, never an edit)
  // (after_test: whether a finished test's cards keep coming or rest, js/review.js: kept quietly, never an edit)
  const QUIET_KEYS = new Set(['cards', 'edited_at', 'edited_print', 'checkin', 'quiz', 'after_test']);
  const prints = new WeakMap();
  function notePrint(row) {
    if (typeof row._print === 'string') return row._print;  // (a version kept without its words: the print it had, see shut)
    if (prints.has(row)) return prints.get(row);
    const extra = Object.fromEntries(Object.entries(row.extra || {}).filter(([key]) => !QUIET_KEYS.has(key)));
    const text = stable([row.title || '', row.locked ? row.secret || '' : row.body || '', row.folder_id || null,
      !!row.pinned, row.due || null, !!row.done, !!row.locked, !!row.deleted, row.template || '',
      (row.attachments || []).map((a) => (a && (a.path || a.id)) || ''), extra]);
    let h = 0x811c9dc5;
    for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193) >>> 0;
    const print = h.toString(36) + '.' + text.length.toString(36);
    prints.set(row, print);
    return print;
  }
  V.editedAt = (row) => (!row ? '' : row._edited
    || (row.extra && row.extra.edited_at && row.extra.edited_print === notePrint(row) ? row.extra.edited_at : '')
    || row.updated_at || row.created_at || '');

  async function put(table, row) {
    V.data[table].set(row.id, row);
    await V.db.put(table, row);
    V.emit('data', table);
  }

  const stamp = () => Date.now() + Math.random();

  /* -- notes changed on two devices at once */

  /* jsonb comes back from the cloud with its keys in another order: compared with them sorted. */
  const sortedKeys = (v) => (Array.isArray(v) ? v.map(sortedKeys) : v && typeof v === 'object'
    ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortedKeys(v[k])])) : v);
  const stable = (v) => JSON.stringify(sortedKeys(v === undefined ? null : v));
  const fieldsOf = (row) => Object.fromEntries(FIELDS.notes.map((f) => [f, f in row ? row[f] : BLANK[f]]));
  const newer = (row, here) => !!row.updated_at && row.updated_at > (here._base_at || here.updated_at || '');

  /* The version a note changed here was changed from: the cloud's, when it wasn't changed here before; else what it
     already had. A save from a copy older than another device's words put in here (the open note, saved before it
     heard of them) keeps those words: the save's changes go in on top. */
  function carryBase(next, here, given) {
    for (const key of NOTE_LOCAL) delete next[key];
    if (!here || here._purge) return next;
    if (!here._dirty) {
      if (here.updated_at) { next._base = fieldsOf(here); next._base_at = here.updated_at; }
      return next;
    }
    for (const key of NOTE_LOCAL) if (key in here) next[key] = here[key];
    if (!here._merged) return next;
    if (given._merged === here._merged) {  // saved from a copy that has them: nothing more to do
      delete next._merged;
      delete next._mine;
      return next;
    }
    if (!here._mine || next._purge) return next;
    const { row } = combine(here._mine, fieldsOf(next), fieldsOf(here));
    return { ...next, ...row, _mine: fieldsOf(next) };
  }

  /* Each setting kept in `extra` as this device changed it, else as theirs. Flash cards (extra.cards) one card at a
     time, so cards studied on both devices at once all keep their progress (and Test me's wrong choices, extra.quiz). */
  function mergeExtra(start, mine, theirs, top = true) {
    const was = start || {};
    const now = mine || {};
    const out = { ...(theirs || {}) };
    for (const key of new Set([...Object.keys(was), ...Object.keys(now)])) {
      if (stable(was[key]) === stable(now[key])) continue;
      if (top && (key === 'cards' || key === 'quiz') && isObject(now[key]) && isObject(out[key])) out[key] = mergeExtra(was[key], now[key], out[key], false);
      // (after a test, js/checkin.js: an answer given on the other device beats "asked" from this one)
      else if (top && key === 'checkin' && isObject(out.checkin) && out.checkin.mood && !(isObject(now.checkin) && now.checkin.mood)) continue;
      // (after a test, js/review.js: the answer as this device changed it, the decks kept from a menu deck by deck)
      else if (top && key === 'after_test' && isObject(now[key]) && isObject(out[key]) && now[key].day === out[key].day) {
        const base = isObject(was[key]) && was[key].day === now[key].day ? was[key] : {};
        const merged = mergeExtra({ ...base, woke: null }, { ...now[key], woke: null }, out[key], false);
        const woke = mergeExtra(isObject(base.woke) ? base.woke : {}, isObject(now[key].woke) ? now[key].woke : {},
          isObject(out[key].woke) ? out[key].woke : {}, false);
        if (Object.keys(woke).length) merged.woke = woke; else delete merged.woke;
        out[key] = merged;
      }
      else if (key in now) out[key] = now[key];
      else delete out[key];
    }
    return out;
  }
  const isObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

  /* A note's pictures, files, memos and drawings, each kept unless one side removed it, and each side's new ones added
     (this device's first). */
  function mergeFiles(start, mine, theirs) {
    const id = (a) => (a && (a.path || a.id)) || stable(a);
    const was = new Map((start || []).map((a) => [id(a), a]));
    const there = new Map((theirs || []).map((a) => [id(a), a]));
    const here = new Set((mine || []).map(id));
    const out = [];
    for (const a of mine || []) {
      const key = id(a);
      if (was.has(key) && !there.has(key)) continue;  // removed on the other device
      const changedThere = there.has(key) && stable(there.get(key)) !== stable(was.get(key));
      out.push(changedThere && stable(a) === stable(was.get(key)) ? there.get(key) : a);
    }
    for (const a of theirs || []) if (!was.has(id(a)) && !here.has(id(a))) out.push(a);
    return out;
  }

  /* A note's words as they're kept: a locked note's are its sealed ones. */
  const words = (r) => (r.locked ? 'sealed:' + (r.secret || '') : 'plain:' + (r.body || ''));

  /* (1.22.6, SEC-22) Nothing of a locked note's plain words stays on this device. The versions kept beside a note
     changed here (_base, _mine, _sent: the cloud's version it was changed from, this device's from before a merge, a
     new note as first sent) held the whole unlocked note until the next sync, so a note locked offline sat in plain in
     this device's storage for as long as it stayed offline. Once the note is locked they're kept shut: without their
     words, and without what extra keeps that's made from them (flash cards' codes, Test me's questions and answers:
     emptied, not removed, so a merge still sees this device took them out). In their place: `_shut`, a print of the
     words, which only answers "are another version's words the same?" (what a merge asks of them: did the other
     device change the words too), and `_print`, the print the whole version had (what a lost first send is known
     by). Both are short hashes, so whoever has this device's storage could still check a guess of the whole text
     against them, until the next sync replaces them; the words themselves aren't there. A newer plain version from
     the cloud kept aside (_theirs) is let go: it's read again as the locked one goes up. Never sent anywhere. */
  function wordsMark(text) {
    let a = 0x811c9dc5;
    let b = 0x9747b28c;
    for (let i = 0; i < text.length; i++) {
      const c = text.charCodeAt(i);
      a = Math.imul(a ^ c, 0x01000193) >>> 0;
      b = Math.imul(b ^ c, 0x5bd1e995) >>> 0;
      b = (b ^ (b >>> 15)) >>> 0;
    }
    return a.toString(36) + '.' + b.toString(36) + '.' + text.length.toString(36);
  }
  const isShut = (r) => !!r && typeof r._shut === 'string';
  function shut(version) {
    if (!version || version.locked || isShut(version)) return version;
    const extra = { ...(version.extra || {}) };
    if ('cards' in extra) extra.cards = {};
    if ('quiz' in extra) extra.quiz = {};
    if ('edited_print' in extra) extra.edited_print = '';
    return { ...version, body: '', extra, _shut: wordsMark(version.body || ''), _print: notePrint(version) };
  }
  function shutCopies(row) {
    for (const key of ['_base', '_mine', '_sent']) if (row[key]) row[key] = shut(row[key]);
    if (row._theirs && !row._theirs.locked) delete row._theirs;
    // (the prints of plain versions sent with no answer go too: a short hash of the words, see unanswered)
    if (Array.isArray(row._unanswered)) {
      const sealed = row._unanswered.filter((one) => one && one.sealed);
      if (sealed.length) row._unanswered = sealed; else delete row._unanswered;
    }
    return row;
  }
  /* Whether two versions have the same words (a shut one by its print). */
  function sameWords(a, b) {
    if (a.locked || b.locked || (!isShut(a) && !isShut(b))) return words(a) === words(b);
    const mark = (r) => (isShut(r) ? r._shut : wordsMark(r.body || ''));
    return mark(a) === mark(b);
  }

  /* (The review of 1.22.5) This device's plain words and a version locked on another device (or written into while
     locked there), both changed since `base` (or nothing known of where they started): they only go together sealed,
     with the PIN (sealTogether). A plain version never goes over a locked one: before, the plain words won, and a note
     locked on the PC was unlocked again, its words in plain, by an edit the phone had made offline. */
  const lockedThere = (base, mine, theirs) => !!theirs.locked && !mine.locked
    && (!base || (!sameWords(mine, base) && !sameWords(theirs, base)));

  /* `mine` and `theirs`, both changed from `base`: each field as the side that changed it has it, the title and words
     put together line by line. `clash`: both changed the very same lines (or a locked note's sealed words, which
     can't be put together), where this device's stay. `sealed` ({ secret, conflict }, sealTogether): the words both
     have, put together and sealed; without it, plain words never win over a locked version (lockedThere): its
     sealed words stay. A locked note never keeps Test me's questions and answers (extra.quiz: words in plain). */
  function combine(base, mine, theirs, sealed = null) {
    const changed = (r, f) => stable(r[f]) !== stable(base[f]);
    const row = {};
    for (const f of FIELDS.notes) row[f] = changed(mine, f) ? mine[f] : theirs[f];
    row.id = mine.id;
    row.extra = mergeExtra(base.extra, mine.extra, theirs.extra);
    row.attachments = mergeFiles(base.attachments, mine.attachments, theirs.attachments);
    let clash = false;
    if (changed(mine, 'title') && changed(theirs, 'title') && mine.title !== theirs.title) {
      const titles = V.mergeLines(base.title || '', mine.title || '', theirs.title || '');
      row.title = titles.text.replace(/\n+/g, ' ');
      clash = titles.conflict;
    }
    const mineWords = !sameWords(mine, base);
    const theirWords = !sameWords(theirs, base);
    if (sealed) {
      Object.assign(row, { locked: true, secret: sealed.secret, body: '' });
      clash = clash || sealed.conflict;
      return { row: noQuiz(row, true), clash };
    }
    const from = mineWords && !lockedThere(base, mine, theirs) ? mine : theirs;
    Object.assign(row, { locked: !!from.locked, secret: from.secret || null, body: from.body || '' });
    if (from === mine && mineWords && theirWords && words(mine) !== words(theirs)) {
      // (a base kept without its words, 1.22.6: nothing to put the two together from, so both are kept)
      if (!mine.locked && !theirs.locked && !base.locked && !isShut(base)) {
        const merged = V.mergeLines(base.body || '', mine.body || '', theirs.body || '');
        row.body = merged.text;
        clash = clash || merged.conflict;
      } else {
        clash = true;
      }
    }
    return { row: noQuiz(row), clash };
  }
  /* `sealedHere` (1.22.6): this device sealed the result itself, with its flash cards' progress in the seal
     (sealTogether), so they leave the row too. One that's locked without that (the other device's seal as it is) keeps
     any an older Wefty left there, until a device with the PIN moves them into the seal (js/lock.js sealAgain). */
  function noQuiz(row, sealedHere = false) {
    if (row.locked && row.extra && ('quiz' in row.extra || (sealedHere && 'cards' in row.extra))) {
      const { quiz, ...rest } = row.extra;
      if (sealedHere) delete rest.cards;
      row.extra = rest;
    }
    return row;
  }

  /* `mine` and `theirs` with nothing known about where they started (a new note a Wefty before 1.22.5 sent, whose
     answer was lost): neither wins in silence. This device's version stays in the note, with the other's files too, and
     when their title or words differ the other version is kept whole beside it (`clash`: a conflict copy, which says
     so). `sealed`: this device's words, sealed, as the other version is locked (lockedThere). */
  function bothKept(mine, theirs, sealed = null) {
    const row = { ...mine, extra: mergeExtra({}, mine.extra, theirs.extra),
      attachments: mergeFiles([], mine.attachments, theirs.attachments) };
    if (sealed) Object.assign(row, { locked: true, secret: sealed.secret, body: '' });
    return { row: noQuiz(row, !!sealed), clash: words(mine) !== words(theirs) || (mine.title || '') !== (theirs.title || '') };
  }

  /* This device's plain words and the other version's locked ones (lockedThere) put together and sealed with the PIN,
     while it's unlocked here: { secret, conflict } (conflict: both changed the very same lines, where this device's
     stay, the other version kept whole beside it). Null when it isn't unlocked here, or the other version can't be
     opened with it (sealed with a PIN this device doesn't know): then this device's words wait here (waitForPin). */
  async function sealTogether(base, mine, theirs) {
    if (!V.lock || !V.lock.unlocked()) return null;
    try {
      const inside = async (row) => (row.locked ? JSON.parse(await V.lock.decrypt(row.secret)) || {} : { body: row.body || '' });
      const open = async (row) => (await inside(row)).body || '';
      const theirs_ = await inside(theirs);
      const theirText = theirs_.body || '';
      const mineText = await open(mine);
      const merged = base && !isShut(base) ? V.mergeLines(await open(base), mineText, theirText)
        : { text: mineText, conflict: mineText !== theirText };
      // (1.22.6) What else the other device's seal holds stays in it (its flash cards' progress, js/lock.js tuck), and
      // the cards' progress either row still has in plain goes in beside it: the result keeps none in its row (noQuiz).
      const inRow = (row) => (isObject((row.extra || {}).cards) ? row.extra.cards : {});
      const cards = { ...(isObject(theirs_.cards) ? theirs_.cards : {}), ...inRow(theirs), ...inRow(mine) };
      const sealedIn = { ...theirs_, body: merged.text };
      if (Object.keys(cards).length) sealedIn.cards = cards;
      return { secret: await V.lock.encrypt(JSON.stringify(sealedIn)), conflict: !!merged.conflict };
    } catch (error) {
      return null;
    }
  }

  /* Locked on another device, and the PIN isn't unlocked here: this device's change stays here, unsent (never plain over
     the lock), with the locked version beside it (_theirs), until the PIN is typed (askPin): the next sync then seals
     them together. Counted as held ('held': js/profile.js says so, with Type PIN). */
  const pinAsked = new Set();  // (the notes it was said for on this page: once each)
  /* `beside` (1.22.6): the other way round. Locked here, and its words changed on another device meanwhile: that
     version is kept beside it once the PIN is typed (lockedCopy), and isn't kept on this device till then (it's in
     plain, and the cloud has it: it's read again). */
  async function waitForPin(now, theirs, { beside = false } = {}) {
    // (kept here once: each later sync finds it waiting as it was, and leaves it be)
    if (beside) {
      if (now._pinWait !== now._dirty || now._theirs) {
        const waiting = { ...now, _pinWait: now._dirty };
        delete waiting._theirs;
        await put('notes', waiting);
      }
    } else if (now._pinWait !== now._dirty || !now._theirs || now._theirs.updated_at !== theirs.updated_at) {
      await put('notes', { ...now, _theirs: theirs, _pinWait: now._dirty });
    }
    if (!pinAsked.has(now.id)) {
      pinAsked.add(now.id);
      const name = V.noteTitle ? V.noteTitle(beside ? now : theirs) : ((beside ? now : theirs).title || '').trim() || 'A note';
      V.toast(beside ? `"${name}" was changed on your other device after you locked it here. Type your PIN so both versions stay locked.`
        : `"${name}" was locked on your other device. Type your PIN so the changes you made here go into it.`,
      { action: 'Type PIN', onAction: () => { askPin().catch(V.problem); }, ms: 12000 });
    }
    return null;
  }
  /* (1.22.6, SEC-22) A plain version to be kept beside a note that's locked (a conflict copy: locked here, its words
     changed on another device meanwhile, or both changed its title), sealed with the PIN: before, the copy was a plain
     note, with the locked note's words in it for every device and the cloud to read. Null when the PIN isn't unlocked
     here (waitForPin then). */
  async function lockedCopy(version) {
    if (!V.lock || !V.lock.unlocked()) return null;
    try {
      return { ...version, locked: true, body: '', secret: await V.lock.encrypt(JSON.stringify({ body: version.body || '' })) };
    } catch (error) {
      return null;
    }
  }
  const pinWaiting = () => [...V.data.notes.values()].filter((row) => row._pinWait && row._pinWait === row._dirty && !row._purge);
  const pinCount = () => pinWaiting().length;

  /* The PIN typed here (5 tries, then the wrong-PIN wait, as in the editor): the notes waiting for it go up, sealed. */
  async function askPin() {
    for (let tries = 0; tries < 5; tries++) {
      if (V.lock.waitLeft()) { V.toast(V.lock.waitSaid(), { kind: 'err', ms: 6000 }); return false; }
      const pin = await V.lock.askPin({ title: tries ? 'Wrong PIN, try again' : 'Enter your PIN',
        hint: !pinCount() ? '' : pinWaiting().every((row) => row.locked)
          ? 'The version from your other device is kept beside your locked note, locked too.'
          : 'Your changes to a note locked on your other device go into it, locked.' });
      if (!pin) return false;
      if (await V.lock.unlock(pin)) {
        pinAsked.clear();
        await sync();
        return true;
      }
    }
    V.toast(V.lock.waitSaid() || 'Too many tries.', { kind: 'err', ms: 6000 });
    return false;
  }

  /* -- changes sent whose answer never came (1.22.6, N3, N12, DEV-08)

     A change can reach the cloud and its answer still be lost (a deadline, the wifi dropping on the way back). The
     cloud's version is then this device's own, and must never be taken for another device's: the next send from here
     finds the cloud changed since its base and puts the two together, and from the base it had, its own earlier
     words looked like someone else's (a "(conflict copy)" of one's own sentence), and an Undo after a Move to Trash
     that went this way was undone in silence (the note back in the Trash on every device). So every change sent is
     noted (`_unanswered`: its print, and whether it was sealed) until an answer says what became of it: taken (the
     cloud has it, settle), or not (no row matched, or the cloud turned it down with a 4xx; a 5xx may come after it
     was done, so it stays). A version from the cloud with one of these prints is this device's own: it's the base
     (mergeIn), and a Delete forever still knows it (bury). Kept with the note here (a local-only field, never sent:
     fieldsOf), so a reload in between changes nothing; the newest MOST_UNANSWERED; once the note is locked, only the
     prints of sealed versions (shutCopies). An older Wefty ignores the field. */
  const MOST_UNANSWERED = 6;
  // (1.22.6, integrated: after a goodbye, end(), nothing more is written for that person here)
  function noteUnanswered(id, print, sealed) {
    if (ended) return;
    const now = V.data.notes.get(id);
    if (!now) return;
    const next = { ...now, _unanswered: [...(now._unanswered || []), { print, sealed: !!sealed }].slice(-MOST_UNANSWERED) };
    V.data.notes.set(id, next);
    V.db.put('notes', next).catch(() => { /* (memory still has it) */ });
  }
  function answeredFor(id, print) {
    if (ended) return;
    const now = V.data.notes.get(id);
    const list = (now && now._unanswered) || [];
    const at = list.findIndex((one) => one && one.print === print);
    if (at < 0) return;
    const next = { ...now, _unanswered: list.filter((one, i) => i !== at) };
    if (!next._unanswered.length) delete next._unanswered;
    V.data.notes.set(id, next);
    V.db.put('notes', next).catch(() => { /* (memory still has it) */ });
  }
  /* Whether `version` (the cloud's) is one this device sent and never heard back about. */
  const sentFromHere = (now, version) => !!now && Array.isArray(now._unanswered) && !!version
    && now._unanswered.some((one) => one && one.print === notePrint(fieldsOf(version)));

  /* This device's version of note `id` put together with the cloud's newer `theirs`, saved here to be sent (based on
     theirs now). Returns it, or null when there's nothing to send any more. Where both started from: what this device
     sent as a new note while no answer said the cloud had it (_sent, DATA-01: the cloud's version came from it), else
     the cloud's version itself when it's a change this device sent and never heard back about (_unanswered), else the
     cloud's version this one was changed from (_base). */
  async function mergeIn(id, theirs) {
    const now = V.data.notes.get(id);
    if (!now || !now._dirty || now._purge) return null;
    if (isBuried(theirs)) {
      // Deleted for good on another device while this one had changes to it that hadn't gone up (DATA-17): new words,
      // a new title or files outlive that, sent whole over the emptied row; anything less leaves it deleted.
      if (!madeHere(now)) { await forget(now); return null; }
      const extra = { ...(now.extra || {}) };
      delete extra.purged;
      const mine = { ...now, extra, updated_at: theirs.updated_at, _base: fieldsOf(theirs), _base_at: theirs.updated_at,
        _dirty: stamp() };
      delete mine._theirs;
      delete mine._sent;
      delete mine._unanswered;  // (1.22.6: based on the cloud's version now)
      await put('notes', mine);
      keptAfterDelete(mine);
      return mine;
    }
    // (1.22.6) A change of this device's that reached the cloud but whose answer never came (a deadline, a dropped
    // answer, any of the ones since): the cloud's version is that change, so it's the base, and nothing is a clash (no
    // conflict copy of one's own words, no Undo undone).
    const base = now._sent || (sentFromHere(now, theirs) ? fieldsOf(theirs) : now._base) || null;
    // (the review of 1.22.5) Locked on another device: this device's plain words only go into it sealed, with the PIN.
    let sealed = null;
    if (lockedThere(base, fieldsOf(now), fieldsOf(theirs))) {
      sealed = await sealTogether(base, fieldsOf(now), fieldsOf(theirs));
      if (!sealed) return waitForPin(now, theirs);
      if (V.data.notes.get(id) !== now) return null;  // (changed here meanwhile: the next try puts that together)
    }
    const { row, clash } = base ? combine(base, fieldsOf(now), fieldsOf(theirs), sealed)
      : bothKept(fieldsOf(now), fieldsOf(theirs), sealed);
    // (1.22.6) The other version kept beside a note that stays locked is never a plain note: sealed, with the PIN.
    let beside = theirs;
    if (clash && row.locked && !theirs.locked) {
      beside = await lockedCopy(theirs);
      if (!beside) return waitForPin(now, theirs, { beside: true });
      if (V.data.notes.get(id) !== now) return null;  // (changed here meanwhile: the next try puts that together)
    }
    const merged = { ...now, ...row, updated_at: theirs.updated_at, _base: fieldsOf(theirs), _base_at: theirs.updated_at,
      _merged: V.uuid(), _mine: now._merged && now._mine ? now._mine : fieldsOf(now), _dirty: stamp() };
    delete merged._theirs;
    delete merged._sent;
    delete merged._pinWait;
    delete merged._unanswered;  // (1.22.6: based on the cloud's version now; what goes next is noted as it goes)
    if (merged.locked) shutCopies(merged);
    await put('notes', merged);
    if (clash) await conflictCopy(now, beside);
    if (sealed) {
      const name = V.noteTitle ? V.noteTitle(merged) : (merged.title || '').trim() || 'A note';
      V.toast(`"${name}" was locked on your other device, so it's locked here too, with your changes in it.`, { ms: 8000 });
    }
    return merged;
  }

  /* -- notes deleted for good

     Delete forever empties a note's row in the cloud instead of removing it (bury): its title, words, files and
     settings go, it stays deleted, marked extra.purged. A device that wasn't listening then hears of it with the other
     changes and forgets the note too (keep), so nothing it does later can send it back (DATA-02). A Wefty before 1.22.5
     shows it as an empty note in its Trash and empties it after its 30 days, as it does any; one that had changes to
     it that hadn't gone up puts them together with the emptied row, and what it added then shows in the Trash on every
     device (a row with words or files in it is never taken for an emptied one). An older Wefty removes the row itself:
     a device that wasn't listening learns of that from the cloud's list of notes (checkGone). */
  const buried = (at) => ({ folder_id: null, title: '', body: '', pinned: false, due: null, done: false, locked: false,
    secret: null, attachments: [], template: '', deleted: true, deleted_at: at, extra: { purged: at } });
  const isBuried = (row) => !!row && row.deleted === true && !!(row.extra && row.extra.purged)
    && !String(row.title || '').trim() && !row.body && !row.secret && !(row.attachments || []).length;
  const filesOf = (row) => (row.attachments || []).flatMap((a) => [a && a.path, a && a.preview]).filter(Boolean);

  /* A note deleted for good: gone from this device too, with the pictures it kept of it and its History copies that
     hadn't gone up. */
  async function forget(row) {
    if (!V.data.notes.has(row.id)) return;
    forgotten.set(row.id, fieldsOf(row));
    V.data.notes.delete(row.id);
    await V.db.del('notes', row.id);
    for (const path of filesOf(row)) await V.db.del('files', path).catch(() => {});
    if (V.history) await V.history.forget(row.id, { cloud: false }).catch(() => {});
    V.emit('data', 'notes');
  }

  /* Whether this device changed a note's words, title or files, or put it back from the Trash, since `base` (the
     version it was changed from): what a delete for good on another device mustn't take with it (DATA-17). A flash
     card's progress, a pin or a move isn't. Nothing known of that version: as if so. */
  function madeHere(now, base = now._sent || now._base) {
    if (!base) return true;
    const key = (a) => (a && (a.path || a.id)) || stable(a);
    const had = new Set((base.attachments || []).map(key));
    return !sameWords(now, base) || (now.title || '') !== (base.title || '') || (!!base.deleted && !now.deleted)
      || (now.attachments || []).some((a) => !had.has(key(a)));
  }

  function keptAfterDelete(row) {
    const name = V.noteTitle ? V.noteTitle(row) : (row.title || '').trim() || 'A note';
    V.toast(`"${name}" was deleted on another device, but it had new changes here, so it's kept.`, { ms: 9000 });
  }

  /* The other device's version, kept whole as a note of its own beside this one. */
  async function conflictCopy(mine, theirs) {
    const name = (theirs.title || '').trim() || (V.noteTitle ? V.noteTitle(theirs) : '') || 'Untitled';
    const title = `${name} (conflict copy)`.slice(0, 200);
    const copy = { ...fieldsOf(theirs), id: V.uuid(), title, pinned: false, attachments: [], template: '', deleted: false,
      deleted_at: null, extra: { conflict_of: mine.id, conflict_at: new Date().toISOString() },
      _dirty: stamp(), _edited: new Date().toISOString() };
    await put('notes', copy);
    pushAgain = true;
    V.emit('conflict', { id: mine.id, copy: copy.id });
    V.toast(`"${name}" was changed on two devices at once. Both versions are kept: the other one is in "${title}".`,
      { ms: 9000 });
  }

  /* -- asking the cloud */

  /* Every row of `table` changed since the last look, oldest first, a page at a time, paged on (updated_at, id): one
     statement stamps every row it changes with the same time (vault/schema.sql's now()), so a page that ends inside
     such a run goes on with the rest of that time by id before the next time. Paged on the time alone, more than a
     page of rows sharing one were read again and again and nothing after them ever came, while it said "synced"
     (DATA-12). True when it stopped at its most pages: the rest comes with another look straight after. */
  const PAGE = 500;  // (under the cloud's own cap on the rows one answer has: Supabase's is 1000)
  async function pull(table) {
    const sinceKey = 'since:' + table;
    const since = await V.db.meta(sinceKey);
    // (10 s back: a row written in a transaction that began before the newest one seen, and ended after it, is
    // stamped with that earlier time)
    const from = since ? new Date(new Date(since).getTime() - 10000).toISOString() : '1970-01-01T00:00:00Z';
    let newest = since || null;
    let after = null;  // the last time read whole: the next page starts past it
    const take = async (data) => {
      const changed = await keep(table, data);
      if (table === 'transfers') V.emit('transfers-in', changed.filter((t) => !t.deleted));
    };
    const rows = async (asked) => {
      const { data, error, status } = await asked;
      if (error) throw Object.assign(error, { status });
      return data;
    };
    for (let page = 0; page < 80; page++) {
      const ask = sb.from(table).select('*');
      const data = await rows((after ? ask.gt('updated_at', after) : ask.gte('updated_at', from))
        .order('updated_at', { ascending: true }).order('id', { ascending: true }).limit(PAGE));
      await take(data);
      if (!data.length) break;
      const last = data[data.length - 1];
      newest = last.updated_at;
      if (data.length < PAGE) break;
      for (let id = last.id; ;) {  // the rest stamped with the same time as the page's last row, by id
        const tied = await rows(sb.from(table).select('*').eq('updated_at', last.updated_at).gt('id', id)
          .order('id', { ascending: true }).limit(PAGE));
        await take(tied);
        if (tied.length < PAGE) break;
        id = tied[tied.length - 1].id;
      }
      after = last.updated_at;
      if (page === 79) {  // (the most pages for one look: kept, and another look follows)
        if (!ended) await V.db.meta(sinceKey, newest);
        return true;
      }
    }
    // (1.22.6: never "read up to here" for rows this page let go of: the next sign-in here would never ask for them)
    if (newest && !ended) await V.db.meta(sinceKey, newest);
    return false;
  }

  /* Notes a Wefty before 1.22.5 deleted for good while this device wasn't listening: it removes the row, so nothing
     about it comes in with the changes. So at the first sync after starting, and every 6 hours after, the cloud is
     asked which notes it has (their ids alone), and a note this device had from it, with nothing here waiting to go
     up, that isn't there any more is forgotten here too (DATA-02). Only after the whole list came back: a page that
     can't be had leaves everything as it was. */
  const LIST_EVERY = 6 * 3600000;
  let listedAt = -Infinity;
  async function checkGone() {
    if (performance.now() - listedAt < LIST_EVERY) return;
    const had = [...V.data.notes.values()].filter((row) => row.updated_at && !row._dirty);
    const there = new Set();
    let after = '';
    for (let page = 0; had.length; page++) {
      if (page >= 200) return;  // (200,000 notes: not a whole list)
      let ask = sb.from('notes').select('id').order('id', { ascending: true }).limit(1000);
      if (after) ask = ask.gt('id', after);
      const { data, error, status } = await ask;
      if (error) throw Object.assign(error, { status });
      if (!data.length) break;
      for (const row of data) there.add(row.id);
      after = data[data.length - 1].id;
    }
    listedAt = performance.now();
    // (no notes at all, while this device has some the cloud gave it: rather the wrong cloud than everything deleted)
    if (!there.size) return;
    for (const row of had) if (!there.has(row.id) && V.data.notes.get(row.id) === row) await forget(row);
  }

  let clipsChecked = false;  // the first check after starting only catches up: nothing is copied for old ones
  async function pullClips() {
    const { data, error, status } = await sb.from('clips').select('*').order('created_at', { ascending: false }).limit(30);
    if (error) throw Object.assign(error, { status });
    if (ended) return;
    const known = new Set(V.data.clips.map((c) => c.id));
    V.data.clips = data;
    await V.db.clear('clips');
    await V.db.putMany('clips', data);
    V.emit('data', 'clips');
    const fresh = data.filter((c) => !known.has(c.id));
    if (clipsChecked && fresh.length) V.emit('clip-in', fresh[0]);
    clipsChecked = true;
  }

  /* The settings columns changed here and not sent yet: the ones saveSettings was given (`_send`), else (a copy left
     dirty by a Vault before 1.9, when only a PIN ever made it so) the PIN's two. Never extra unless it was given:
     extra is changed straight in the cloud (changeExtra), and this device's copy of it may be old. */
  const unsentSettings = (here) => (Array.isArray(here._send) && here._send.length ? here._send : ['pin_salt', 'pin_check'])
    .filter((f) => SETTING_FIELDS.includes(f) && f in here);

  function settingsArrived() {
    settingsRead = true;
    settingsFailed = false;
    for (const done of [...settingsWaiters]) done(true);
  }

  /* The settings row as the cloud has it, kept here: what's changed here and not sent yet (a new PIN) stays; everything
     else is the cloud's (extra too). The PIN this device had, if the cloud's is another now, is kept first
     (keepReplaced). */
  async function keepSettings(data) {
    if (ended) return;
    const here = V.data.settings || {};
    await keepReplaced(here, data);
    const mine = here._dirty ? Object.fromEntries(unsentSettings(here).map((f) => [f, here[f]])) : null;
    V.data.settings = mine ? { ...data, ...mine, _dirty: here._dirty, _send: Object.keys(mine) } : data;
    await V.db.meta('settings', V.data.settings);
    V.emit('data', 'settings');
    sendOrphans();
  }

  async function pullSettings() {
    const { data, error, status } = await sb.from('settings').select('*').maybeSingle();
    if (error) throw Object.assign(error, { status });
    if (data) await keepSettings(data);
    settingsArrived();
  }

  /* (1.22.6, SEC-03) The lock row read from the cloud right now, on its own, and kept here: for a PIN typed that
     isn't this device's (js/lock.js: the PIN may have been changed on another device a moment ago, and the settings
     aren't in Realtime). `ms` at most, and nothing at all offline: unlocking never waits on a network that isn't
     there. Throws when it couldn't be read in time. */
  function lockRow(ms) {
    if (!sb || !navigator.onLine) return Promise.reject(Object.assign(new Error('Offline'), { kind: 'offline' }));
    const stop = new AbortController();
    let timer = 0;
    const late = new Promise((resolve, reject) => {
      timer = setTimeout(() => { stop.abort(); reject(Object.assign(new Error('The cloud didn\'t answer in time'), { kind: 'offline' })); }, ms);
    });
    const read = (async () => {
      const { data, error, status } = await sb.from('settings').select('*').maybeSingle().abortSignal(stop.signal);
      if (error) throw Object.assign(error, { status });
      if (stop.signal.aborted) return;  // (too late: the next look at the cloud brings it)
      if (data) await keepSettings(data);
      settingsArrived();
    })();
    read.catch(() => {});
    return Promise.race([read, late]).finally(() => clearTimeout(timer));
  }

  /* One change to the settings row's extra (changeExtra), made only on the version of it just read: written with
     "if the cloud still has updated_at = what was read" (settings_touch moves it on every write), so another device's
     change landing in between (a tally, "Use Claude too") is read again and kept, never written over. A read that
     fails writes nothing: this device's copy may be old, or empty on a new device, and must never replace the
     cloud's. */
  async function writeExtra(change, signal) {
    for (let tries = 0; tries < MOST_TRIES; tries++) {
      if (signal.aborted) throw lateExtra();
      const read = await sb.from('settings').select('extra, updated_at').maybeSingle().abortSignal(signal);
      if (signal.aborted) throw lateExtra();
      if (read.error) throw Object.assign(read.error, { status: read.status });
      const have = read.data;
      // (no row yet: a new account. This device's copy is all there is of it, if anything.)
      const merged = change({ ...((have ? have.extra : (V.data.settings || {}).extra) || {}) });
      const wrote = have
        ? await sb.from('settings').update({ extra: merged }).eq('updated_at', have.updated_at).select().maybeSingle()
          .abortSignal(signal)
        : await sb.from('settings').insert({ extra: merged }).select().maybeSingle().abortSignal(signal);
      if (signal.aborted) throw lateExtra();
      if (wrote.error) {
        if (!have && (wrote.status === 409 || wrote.error.code === '23505')) continue;  // made elsewhere meanwhile
        throw Object.assign(wrote.error, { status: wrote.status });
      }
      if (!wrote.data) continue;  // changed elsewhere since it was read: read again
      heard(wrote.data.updated_at);
      await keepSettings(wrote.data);
      settingsArrived();
      return wrote.data.extra || merged;
    }
    throw new Error('Your settings were being changed on another device at the same moment. Try again.');
  }
  /* -- the locked notes' PIN (1.22.5)

     The PIN's two columns (pin_salt, pin_check: js/lock.js) seal every locked note, so they're only ever written on
     the lock row as the cloud has it right now, and only if it still has the PIN this device started from (`from`:
     the salt it was unlocked with, null for a first PIN). Before 1.22.5 they went up by a plain upsert: a device that
     was offline (or hadn't read the row) made a "new" PIN whose salt replaced the cloud's, and every note locked with
     the old one could never be opened again (SEC-04, DATA-11). A changed PIN keeps the one it replaces in
     extra.pin_old (its salt and check, the newest 5), written in the same request: a note still sealed with it (sent
     late by a device that was offline) still opens with the old PIN (js/lock.js). Older Weftys never read pin_old and
     keep it (they change extra on the newest copy, or not at all). Nothing else about the lock changes. */
  const PIN_OLD = 5;
  /* When an earlier PIN was replaced (the `at` kept with it, which its 30 days run from, see forgetOldPins): the
     latest of the times known here, the cloud's own (cloudNow, or `row`'s last write) and this device's, so a device
     whose date is behind never makes it look older than it is. */
  const replacedAt = (row) => new Date(Math.max(Date.now(), cloudNow() || 0, Date.parse((row && row.updated_at) || '') || 0)).toISOString();
  const oldOf = (extra) => (extra && Array.isArray(extra.pin_old) ? extra.pin_old : [])
    .filter((one) => one && typeof one.salt === 'string' && typeof one.check === 'string');
  const pinUnsent = (here) => !!here._dirty && unsentSettings(here).some((f) => f === 'pin_salt' || f === 'pin_check');

  /* (1.22.6, SEC-04) The PIN this device knew, replaced in the cloud by one whose change kept nothing of it: a Wefty
     before 1.22.5 sets or changes a PIN with a plain write of its two columns, and this device then took the cloud's
     row and dropped its own salt, so a note it had locked offline with the PIN before (and sent up after) opened with
     no PIN at all, old or new. The replaced salt and check are kept: here first (meta 'pin-orphans', before this
     device's copy of the row changes: a page closed in between loses nothing), then beside the cloud's PIN
     (extra.pin_old, sendOrphans), so those notes open with the earlier PIN on every device from 1.22.5 on, and are
     sealed again with the PIN in use once they are. Nothing is kept for a change that kept it already (V.cloud.setPin
     puts the old one in pin_old in the same write), or twice. A copy that can't be stored here stops the cloud's row
     being taken at all (the look fails and is tried again), never a PIN let go unkept. */
  async function keepReplaced(here, row) {
    if (!here || !row || !here.pin_salt || !here.pin_check || pinUnsent(here)) return;
    if (here.owner && row.owner && here.owner !== row.owner) return;  // (another person's row: never theirs to keep)
    if (row.pin_salt === here.pin_salt) return;
    if (oldOf(row.extra).some((one) => one.salt === here.pin_salt)) return;
    const kept = (await V.db.meta('pin-orphans')) || [];
    if (kept.some((one) => one && one.salt === here.pin_salt)) return;
    await V.db.meta('pin-orphans', [...kept, { salt: here.pin_salt, check: here.pin_check, at: replacedAt(row),
      sent: false }].slice(-PIN_OLD));
  }

  /* This device's kept PINs (meta 'pin-orphans') that the cloud doesn't have beside its own yet go there
     (extra.pin_old), each once: not waited for, and tried again at the next look when the cloud couldn't be reached. */
  let orphansGoing = false;
  function sendOrphans() {
    if (orphansGoing || !sb) return;
    orphansGoing = true;
    (async () => {
      const kept = (await V.db.meta('pin-orphans').catch(() => null)) || [];
      const now = V.data.settings || {};
      const todo = kept.filter((one) => one && one.salt && one.check && !one.sent && one.salt !== now.pin_salt);
      if (!todo.length) return;
      const missing = todo.filter((one) => !oldOf(now.extra).some((have) => have.salt === one.salt));
      if (missing.length) {
        await changeExtra((extra) => {
          const have = oldOf(extra);
          const add = missing.filter((one) => !have.some((old) => old.salt === one.salt))
            .map((one) => ({ salt: one.salt, check: one.check, at: one.at || replacedAt(null) }));
          return add.length ? { ...extra, pin_old: [...have, ...add].slice(-PIN_OLD) } : extra;
        });
      }
      const after = (await V.db.meta('pin-orphans').catch(() => null)) || [];
      const done = new Set(todo.map((one) => one.salt));
      await V.db.meta('pin-orphans', after.map((one) => (one && done.has(one.salt) ? { ...one, sent: true } : one)));
    })().catch((error) => console.warn('Wefty: an earlier PIN kept on this device only for now', error && error.message))
      .finally(() => { orphansGoing = false; });
  }

  /* (1.22.6) The earlier PINs' checks let go, once nothing is sealed with them (js/lock.js letGo makes sure of that
     for what this device can see: every locked note and every sealed older version opens with the PIN in use). Each
     is a way to guess that old PIN for whoever holds a copy of the settings, so none is kept for good any more.
     This device's own (meta 'pin-orphans') go at once. The cloud's (extra.pin_old) go only when both of these hold
     too, for what no device can see from here, a note another device sealed with the earlier PIN and hasn't sent yet:
     - the PIN was replaced OLD_PIN_DAYS ago or more, by the cloud's own time: a device back after weeks offline
       still finds the check;
     - every device this account has used runs a Wefty that keeps its own replaced PIN and puts it back beside the
       cloud's (keepReplaced: 1.22.6 on; by the devices' own lines in extra.devices, js/access.js). A device still on
       an older Wefty brings late notes sealed with the old PIN and nothing to open them with, so while one is listed
       the cloud's copies stay. Checked again on the cloud's newest extra as it's written. */
  const OLD_PIN_DAYS = 30;
  const KEEPS_ITS_OWN = [1, 22, 6];
  const atLeast = (version, least) => {
    const parts = String(version || '').split('.').map((part) => Number(part) || 0);
    for (let i = 0; i < least.length; i++) if ((parts[i] || 0) !== least[i]) return (parts[i] || 0) > least[i];
    return true;
  };
  const allKeepTheirOwn = (extra) => Object.values((extra && isObject(extra.devices) && extra.devices) || {})
    .every((device) => !isObject(device) || typeof device.kind !== 'string' || atLeast(device.version, KEEPS_ITS_OWN));
  const oldEnough = (one, now) => {
    const at = Date.parse(one.at || '');
    return Number.isFinite(at) && now - at >= OLD_PIN_DAYS * 86400000;
  };
  const mayGo = (extra, now) => (now !== null && allKeepTheirOwn(extra)
    ? oldOf(extra).filter((one) => oldEnough(one, now)).map((one) => one.salt) : []);
  /* The salts of the earlier PINs' checks that would go now (the cloud's that may, and all of this device's own). The
     cloud's only by the cloud's own time (a device's date may be weeks off: one set ahead for a game once emptied a
     Trash, DATA-05): when it isn't known yet and this device's clock says one is due, it's asked for (a write of the
     settings as they are, whose answer carries it). */
  async function oldPinsDue() {
    const kept = (await V.db.meta('pin-orphans').catch(() => null)) || [];
    const extra = () => (V.data.settings || {}).extra;
    if (cloudNow() === null && mayGo(extra(), Date.now()).length) await changeExtra((same) => same).catch(() => {});
    return [...new Set([...mayGo(extra(), cloudNow()), ...kept.filter((one) => one && one.salt).map((one) => one.salt)])];
  }
  async function forgetOldPins(salts) {
    const gone = new Set(salts);
    if (mayGo((V.data.settings || {}).extra, cloudNow()).some((salt) => gone.has(salt))) {
      await changeExtra((extra) => {
        const going = new Set(mayGo(extra, cloudNow()).filter((salt) => gone.has(salt)));
        if (!going.size) return extra;
        const left = oldOf(extra).filter((one) => !going.has(one.salt));
        const next = { ...extra };
        if (left.length) next.pin_old = left; else delete next.pin_old;
        return next;
      });
    }
    const kept = (await V.db.meta('pin-orphans').catch(() => null)) || [];
    const left = kept.filter((one) => !one || !gone.has(one.salt));
    if (left.length !== kept.length) await V.db.meta('pin-orphans', left);
  }
  const offlinePin = () => Object.assign(new Error('Connect to the internet first: Wefty checks your cloud for a PIN you '
    + 'already have before it sets one.'), { kind: 'offline' });
  /* (1.22.6) What a PIN that couldn't be set or changed says, in plain words (before, the library's own: "TypeError:
     Failed to fetch (no answer in time)"). */
  const PIN_WORDS = {
    notChanged: 'Your PIN wasn\'t changed: Wefty couldn\'t reach your cloud. Your old PIN still works. Try again when '
      + 'you\'re online.',
    notSet: 'No PIN was set: Wefty couldn\'t reach your cloud. Try again when you\'re online.',
    refusing: 'Your cloud is refusing changes right now, so your PIN wasn\'t changed. Try again later.',
    other: 'Your PIN wasn\'t changed. Try again in a moment.',
    unsure: 'Wefty lost touch with your cloud while changing your PIN. Once you\'re online, try your new PIN. If it '
      + 'doesn\'t work, your old one still does.',
    unsureFirst: 'Wefty lost touch with your cloud while setting your PIN. Try again when you\'re online.',
  };
  function pinTrouble(error, from) {
    if (error && error.kind) return error;
    const status = Number(error && error.status) || 0;
    if (!status && offlineError(error)) return Object.assign(new Error(from ? PIN_WORDS.notChanged : PIN_WORDS.notSet), { kind: 'offline' });
    if (refusalOf(status)) return Object.assign(new Error(PIN_WORDS.refusing), { kind: 'refusing', status });
    return Object.assign(new Error(PIN_WORDS.other), { status, cause: error });
  }
  const changedFirst = (from) => Object.assign(new Error(from
    ? 'Your PIN was changed on another device first. Unlock with that one, then change it again if you like.'
    : 'You have a PIN already (set on another device). Use that one.'), { kind: 'pin-changed' });
  /* (1.22.6, N6) A new PIN written, and no answer (or the cloud's trouble, which may come after it was done): the lock
     row is read once. With the salt this device just made, it went: as if answered (the row is kept here, and the
     caller uses the new PIN and seals the notes again). Otherwise it didn't, and that's said. Before, the device said
     it failed while the cloud had it: the old PIN was "Wrong PIN" after the next look, and the new one opened none of
     the locked notes until "Its earlier PIN" was typed too. If even that read gets no answer, it's said that it may
     have gone (js/lock.js keeps the old PIN's key for this page, so the new PIN opens the notes once it's known). */
  async function pinAfterAll(values, from) {
    let have;
    try {
      const read = await sb.from('settings').select('*').maybeSingle();
      if (read.error) throw Object.assign(read.error, { status: read.status });
      have = read.data;
    } catch (error) {
      throw Object.assign(new Error(from ? PIN_WORDS.unsure : PIN_WORDS.unsureFirst), { kind: 'offline', unsure: true });
    }
    if (have && have.pin_salt === values.pin_salt) {
      await tookCloudPin(have);
      return have;
    }
    if (have) await tookCloudPin(have);  // (the lock row as the cloud has it now)
    if (((have && have.pin_salt) || null) !== (from || null)) throw changedFirst(from);
    throw Object.assign(new Error(from ? PIN_WORDS.notChanged : PIN_WORDS.notSet), { kind: 'offline' });
  }
  async function setPin(values, { from = null } = {}) {
    if (!V.desktop && !navigator.onLine) throw offlinePin();
    for (let tries = 0; tries < MOST_TRIES; tries++) {
      const read = await sb.from('settings').select('*').maybeSingle();
      if (read.error) throw pinTrouble(Object.assign(read.error, { status: read.status }), from);
      const have = read.data;
      const salt = (have && have.pin_salt) || null;
      if (salt !== (from || null)) {
        if (have) await tookCloudPin(have);
        throw changedFirst(from);
      }
      let wrote;
      if (have) {
        const change = { pin_salt: values.pin_salt, pin_check: values.pin_check };
        if (from) {
          const extra = { ...(have.extra || {}) };
          const kept = (Array.isArray(extra.pin_old) ? extra.pin_old : [])
            .filter((one) => one && one.salt !== from && one.salt !== values.pin_salt);
          extra.pin_old = [...kept, { salt: from, check: have.pin_check, at: replacedAt(have) }].slice(-PIN_OLD);
          change.extra = extra;
        }
        wrote = await sb.from('settings').update(change).eq('updated_at', have.updated_at).select().maybeSingle();
      } else {
        wrote = await sb.from('settings').insert({ pin_salt: values.pin_salt, pin_check: values.pin_check }).select().maybeSingle();
      }
      if (wrote.error) {
        if (!have && (wrote.status === 409 || wrote.error.code === '23505')) continue;  // made elsewhere meanwhile
        // (1.22.6, N6: no answer, or the cloud's trouble: whether it went is read once)
        if (!wrote.status || wrote.status >= 500) return pinAfterAll(values, from);
        throw pinTrouble(Object.assign(wrote.error, { status: wrote.status }), from);
      }
      if (!wrote.data) continue;  // changed elsewhere since it was read: read again
      await tookCloudPin(wrote.data);
      return wrote.data;
    }
    throw new Error('Your settings were being changed on another device at the same moment. Try again.');
  }
  /* The lock row as the cloud has it, kept here (any PIN made here and not sent is the cloud's no more: see
     unsentPin). */
  async function tookCloudPin(row) {
    const here = V.data.settings || {};
    await keepReplaced(here, row);  // (1.22.6: changed on another device by an older Wefty, which kept nothing of it)
    const send = Array.isArray(here._send) ? here._send.filter((f) => f !== 'pin_salt' && f !== 'pin_check') : [];
    const mine = here._dirty && send.length ? Object.fromEntries(send.filter((f) => f in here).map((f) => [f, here[f]])) : null;
    V.data.settings = mine ? { ...row, ...mine, _dirty: here._dirty, _send: send } : row;
    await V.db.meta('settings', V.data.settings);
    settingsArrived();
    V.emit('data', 'settings');
    sendOrphans();
  }
  /* A PIN made here by a Wefty before 1.22.5 and never sent (made offline): sent only if the cloud has none yet. If it
     has one, the cloud's stays, and this one is kept here (meta 'pin-orphans'), so the notes locked with it here still
     open with it (js/lock.js) and are sealed again with the cloud's PIN once they are. The row as the cloud has it. */
  async function unsentPin(salt, check) {
    if (!salt || !check) return null;
    try {
      return await setPin({ pin_salt: salt, pin_check: check });
    } catch (error) {
      if (error.kind !== 'pin-changed') throw error;
      const kept = (await V.db.meta('pin-orphans').catch(() => null)) || [];
      if (!kept.some((one) => one.salt === salt)) {
        await V.db.meta('pin-orphans', [...kept, { salt, check, at: new Date().toISOString(), sent: false }].slice(-PIN_OLD));
      }
      // ... and in the cloud's pin_old too: the notes it locked here (sent before this) open on every device with it.
      await changeExtra((extra) => ({ ...extra, pin_old: [...(Array.isArray(extra.pin_old) ? extra.pin_old : [])
        .filter((one) => one && one.salt !== salt), { salt, check, at: new Date().toISOString() }].slice(-PIN_OLD) }))
        .then(async () => {
          const after = (await V.db.meta('pin-orphans').catch(() => null)) || [];
          await V.db.meta('pin-orphans', after.map((one) => (one && one.salt === salt ? { ...one, sent: true } : one)));
        })
        .catch((failed) => console.warn('Wefty: an earlier PIN kept here only for now', failed));
      V.toast('You set a PIN on another device too. Wefty keeps that one: the notes you locked here open with the PIN '
        + 'you used here, then they switch to it.', { ms: 10000 });
      return V.data.settings;
    }
  }

  // One at a time on this device too (a tally written while "Use Claude too" is switched): each starts once the one
  // before has finished. supabase-js never gives up on a request by itself, so each change has `waits.extra` ms in all
  // (its reads, writes and tries again): past that its requests are stopped and it fails as any change that couldn't
  // reach the cloud does (the tally keeps the cost owed, a switch goes back and says so), and the next one goes. One
  // hung request on stalled mobile data used to hold every later change (a switch stayed greyed out for minutes).
  let extraChain = Promise.resolve();
  // (renew: how long the start waits for the cloud to renew a sign-in before showing the notes from the kept one)
  const waits = { extra: 20000, renew: 2000 };  // (tests shorten them)
  const lateExtra = () => Object.assign(new Error('The cloud didn\'t answer in time, so that setting wasn\'t changed. '
    + 'Try again in a moment.'), { kind: 'offline', late: true });

  function changeExtra(change) {
    const run = extraChain.catch(() => {}).then(() => timedExtra(change));
    extraChain = run;
    return run;
  }

  /* writeExtra(change), given waits.extra ms: its requests are stopped once they're up (an aborted request that had
     already reached the cloud may still land: a later read of the row shows it), and it rejects with lateExtra. */
  function timedExtra(change) {
    const stop = new AbortController();
    let timer = null;
    const late = new Promise((resolve, reject) => {
      timer = setTimeout(() => { stop.abort(); reject(lateExtra()); }, waits.extra);
    });
    return Promise.race([writeExtra(change, stop.signal), late]).finally(() => clearTimeout(timer));
  }

  async function push() {
    if (pushing) { pushAgain = true; return pushing; }
    pushing = (async () => {
      do {
        pushAgain = false;
        for (const table of ['folders', 'notes', 'transfers']) {
          const dirty = [...V.data[table].values()].filter((row) => row._dirty);
          for (const row of dirty.filter((r) => r._purge)) {
            if (table === 'notes') { await bury(row); continue; }
            const { error } = await sb.from(table).delete().eq('id', row.id);
            if (error) throw error;
            V.data[table].delete(row.id);
            await V.db.del(table, row.id);
            V.emit('data', table);
          }
          const sending = dirty.filter((r) => !r._purge && r._refused !== r._dirty && !resting(table, r));
          // Notes the cloud already has (or a version of which came from it: _theirs) go one by one, each only if it
          // still has their version; new ones go as new rows, never over one it has (sendNew); the rest in bulk.
          const known = table === 'notes' ? sending.filter((r) => r._base_at || r.updated_at || r._theirs) : [];
          const fresh = sending.filter((r) => !known.includes(r));
          if (table === 'notes') {
            known.push(...(await sendNew(fresh)).map((id) => V.data.notes.get(id)).filter(Boolean));
          } else {
            for (let i = 0; i < fresh.length; i += 50) {
              const chunk = fresh.slice(i, i + 50);
              const body = chunk.map((row) => Object.fromEntries(FIELDS[table].map((f) => [f, f in row ? row[f] : BLANK[f]])));
              await settle(table, chunk, await send(table, chunk, body));
            }
          }
          for (let i = 0; i < known.length; i += 6) {  // a few at a time (moving a folder's worth of notes)
            await Promise.all(known.slice(i, i + 6).map((row) => pushNote(row.id)));
          }
        }
        if (V.data.settings._dirty) {
          // Only the columns changed here: the rest of the row (extra's "Use Claude too" and the AI tally, which
          // another device may have changed since this one last looked) stays as the cloud has it.
          const { _dirty } = V.data.settings;
          const sent = Object.fromEntries(unsentSettings(V.data.settings).map((f) => [f, V.data.settings[f]]));
          let data = null;
          // (1.22.5) A PIN made here by an older Wefty and never sent: never over the cloud's (unsentPin).
          if ('pin_salt' in sent || 'pin_check' in sent) {
            data = await unsentPin(sent.pin_salt, sent.pin_check);
            delete sent.pin_salt;
            delete sent.pin_check;
          }
          if (Object.keys(sent).length) {
            const answer = await sb.from('settings').upsert(sent).select().single();
            if (answer.error) throw Object.assign(answer.error, { status: answer.status });
            data = answer.data;
            heard(data && data.updated_at);
          }
          if (V.data.settings._dirty === _dirty) {
            if (data) V.data.settings = data;
            else { const { _dirty: _, _send, ...rest } = V.data.settings; V.data.settings = rest; }
            await V.db.meta('settings', V.data.settings);
            if (data) V.emit('data', 'settings');
          }
        }
      } while (pushAgain);
    })().finally(() => { pushing = null; });
    return pushing;
  }

  /* What the cloud took back: kept as sent (unless changed again meanwhile: then that's sent next, made from this). */
  async function settle(table, chunk, data) {
    const settled = [];
    const after = [];
    for (const sent of data) {
      heard(sent.updated_at);  // (what the cloud stamped it with: its time now)
      later.delete(table + ':' + sent.id);  // (it went: a later turn-down starts its wait over)
      const before = chunk.find((r) => r.id === sent.id);
      const now = V.data[table].get(sent.id);
      if (!now || !before) continue;
      if (now._dirty !== before._dirty) {
        if (table === 'notes' && !now._purge) {
          const next = { ...now, _base: fieldsOf(sent), _base_at: sent.updated_at, updated_at: sent.updated_at };
          delete next._sent;  // (the cloud has it: its own version is known now)
          delete next._unanswered;  // (1.22.6: and what went before it doesn't matter any more)
          if (next._theirs && !newer(next._theirs, next)) delete next._theirs;
          V.data.notes.set(sent.id, next);
          await V.db.put('notes', next);
        }
        continue;
      }
      settled.push({ ...sent, _edited: now._edited });
      if (now._theirs && now._theirs.updated_at > sent.updated_at) after.push(now._theirs);  // came after ours
    }
    await keep(table, settled, { fromCloud: false });
    if (after.length) await keep(table, after);
  }

  /* One note the cloud already has, sent only if the cloud still has the version it was changed from (one request).
     If not, the cloud's version is fetched and put together with this one, and that goes instead. */
  async function pushNote(id) {
    for (let tries = 0; tries < MOST_TRIES; tries++) {
      let row = V.data.notes.get(id);
      if (!row || !row._dirty || row._purge || row._refused === row._dirty || resting('notes', row)) return;
      if (row._theirs && newer(row._theirs, row)) {
        row = await mergeIn(id, row._theirs);
        if (!row) return;
      }
      if (!row._base_at && !row.updated_at) {  // (no version of it the cloud has is known here: as a new note)
        if (!(await sendNew([row])).length) return;
        continue;
      }
      const values = fieldsOf(row);
      const print = notePrint(values);
      noteUnanswered(id, print, row.locked);  // (1.22.6: until an answer says what became of it)
      delete values.id;
      const { data, error, status } = await sb.from('notes').update(values).eq('id', id)
        .eq('updated_at', row._base_at || row.updated_at).select();
      if (error) {
        // (the cloud said no: this one wasn't taken. A 5xx may come after it was done, so that one stays noted)
        if (status >= 400 && status < 500) answeredFor(id, print);
        await refused('notes', row, Object.assign(error, { status }));
        return;
      }
      if (data && data.length) { await settle('notes', [row], data); return; }
      answeredFor(id, print);  // (no row had the version it was changed from: this one wasn't taken)
      const got = await sb.from('notes').select('*').eq('id', id).maybeSingle();
      if (got.error) throw Object.assign(got.error, { status: got.status });
      if (!got.data) {
        // Gone from the cloud: deleted for good on a Wefty before 1.22.5, which removes the row. New words, a new
        // title or files here put it back, words and all (DATA-17); anything less leaves it deleted.
        if (!madeHere(row)) { await forget(row); return; }
        if (!(await sendNew([row])).length) { keptAfterDelete(row); return; }
        continue;  // (it was back already: put together with that)
      }
      if (!(await mergeIn(id, got.data))) return;
    }
  }

  /* A note deleted for good here: its row emptied in the cloud (see buried), then forgotten here. */
  async function bury(row) {
    const swept = row._purge === 'swept';  // (by the Trash's own 30 days, not asked for)
    const at = new Date(cloudNow() || Date.now()).toISOString();
    // Only the version this device last saw there (DATA-06): one put back or changed on another device since stays.
    const seen = row._base_at || row.updated_at;
    if (seen && await buryIf(row.id, at, seen, swept)) { await afterBurial(row); return; }
    const got = await sb.from('notes').select('*').eq('id', row.id).maybeSingle();
    if (got.error) throw Object.assign(got.error, { status: got.status });
    const there = got.data;
    if (!there || isBuried(there)) { await afterBurial(row); return; }  // (deleted for good elsewhere already)
    // The cloud has what this device has (a change of its own whose answer was lost), or a new note's first send
    // (DATA-01) that's in the Trash there too: still the one being deleted.
    const mine = notePrint(there) === notePrint(row) || (!!row._sent && notePrint(there) === notePrint(row._sent))
      || sentFromHere(row, there) || (!seen && there.deleted);
    if (mine) {
      if (await buryIf(row.id, at, there.updated_at, swept)) await afterBurial(row);
      return;  // (else changed again this very moment: the next look decides)
    }
    // Put back or changed on another device since: kept, as the cloud has it, and said.
    if (V.data.notes.get(row.id) === row) await put('notes', there);
    if (!swept) {
      V.toast(`"${V.noteTitle ? V.noteTitle(there) : (there.title || 'A note')}" was changed on another device, so it `
        + 'wasn\'t deleted.', { ms: 8000 });
    }
  }

  /* The note's row emptied in the cloud (see buried), only if it still has updated_at `seen` (and, swept by the
     Trash's 30 days, is still in the Trash there). True when it was. */
  async function buryIf(id, at, seen, swept) {
    let ask = sb.from('notes').update(buried(at)).eq('id', id).eq('updated_at', seen);
    if (swept) ask = ask.eq('deleted', true);
    const { data, error, status } = await ask.select('id, updated_at');
    if (error) throw Object.assign(error, { status });
    if (!data || !data.length) return false;
    heard(data[0].updated_at);
    return true;
  }

  /* Once its row is emptied: the note's files and History go (only then: a delete that didn't happen takes nothing
     with it, DATA-06), and it's forgotten here. Offline, the next look does it again. */
  async function afterBurial(row) {
    try {
      const files = filesOf(row);
      if (files.length) await remove(files);
      if (V.history) await V.history.forget(row.id);
    } catch (error) {
      if (offlineError(error) || authError(error)) throw error;
      console.warn('Wefty: a deleted note\'s files', error);
    }
    if (V.data.notes.get(row.id) === row) await forget(row);
  }

  /* New notes (DATA-01): each goes up as a new row, never over one the cloud already has. A first send whose answer
     was lost may have reached the cloud all the same, and another device may have written in that note since: so what
     goes is kept here first (_sent), and after a try that got no answer, the cloud is asked before trying again. A
     note it turns out to have is kept beside its version there (_theirs), to be put together from _sent by pushNote.
     Returns the ids of those. */
  async function sendNew(rows) {
    const there = [];
    const unsure = rows.filter((r) => r._sent);
    for (let i = 0; i < unsure.length; i += 50) there.push(...await lookUp(unsure.slice(i, i + 50).map((r) => r.id)));
    const first = rows.filter((r) => !there.includes(r.id));
    for (let i = 0; i < first.length; i += 50) {
      const chunk = await goingNow(first.slice(i, i + 50));
      const taken = await send('notes', chunk, chunk.map(fieldsOf), { fresh: true });
      await settle('notes', chunk, taken);
      const left = chunk.filter((r) => !taken.some((t) => t.id === r.id)).map((r) => V.data.notes.get(r.id))
        .filter((now) => now && now._dirty && !now._purge && now._refused !== now._dirty && !resting('notes', now))
        .map((now) => now.id);
      if (left.length) there.push(...await lookUp(left));  // (not taken: the cloud had it already)
    }
    return there;
  }

  /* The cloud's own version of each of these notes it has, kept beside this device's (_theirs). Returns their ids. */
  async function lookUp(ids) {
    const { data, error, status } = await sb.from('notes').select('*').in('id', ids);
    if (error) throw Object.assign(error, { status });
    await keep('notes', data);
    return data.map((row) => row.id);
  }

  /* New notes about to go: what goes is kept with each first (_sent: see sendNew), so it's there if no answer comes. */
  async function goingNow(rows) {
    const marked = [];
    for (const row of rows) {
      const now = V.data.notes.get(row.id);
      if (!now) continue;
      const next = { ...now, _sent: fieldsOf(row) };
      V.data.notes.set(row.id, next);
      marked.push(next);
    }
    // (a device too full to keep it still sends: the words reach the cloud, and this page remembers what went)
    if (marked.length) await V.db.putMany('notes', marked).catch((error) => console.warn('Wefty: not kept here', error));
    return rows;
  }

  /* (1.22.5) Only a row the cloud truly can't take is set aside: one too big (413), or a 400 from its own checks
     (Postgres 23514, a check like a note's size; 22001, a value too long). Any other turn-down (402, 403, 404, 408,
     409, 429, another 400) is the cloud's trouble for now, not the row's: it stays to go up, tried again after a wait
     that grows (RETRY first 30 s, doubling to 30 min) and starts over once it goes. */
  const RETRY = { first: 30000, most: 30 * 60000 };
  const cantTake = (err) => !!err && (err.status === 413
    || (err.status === 400 && ['23514', '22001'].includes(String(err.code || ''))));
  const later = new Map();  // `${table}:${id}` -> { wait, until }: rows the cloud turned down for now
  let retryTimer = null;
  const resting = (table, row) => { const one = later.get(table + ':' + row.id); return !!one && one.until > Date.now(); };
  const restingCount = () => [...later.keys()].filter((key) => {
    const [table, ...id] = key.split(':');
    const row = V.data[table] && V.data[table].get(id.join(':'));
    return row && row._dirty && !row._purge;
  }).length;
  function tryLater(table, row) {
    const key = table + ':' + row.id;
    const before = later.get(key);
    const wait = before ? Math.min(before.wait * 2, RETRY.most) : RETRY.first;
    later.set(key, { wait, until: Date.now() + wait });
    const soonest = Math.min(...[...later.values()].map((one) => one.until).filter((at) => at > Date.now())) - Date.now();
    clearTimeout(retryTimer);
    retryTimer = setTimeout(() => { retryTimer = null; sync({ pullFirst: false }).catch(() => {}); }, Math.max(0, soonest) + 50);
  }

  /* A row the cloud won't take (a note over its size check) is set aside until it's changed again (cantTake); any
     other turn-down waits and goes again (tryLater); a network or sign-in problem stops this round instead. */
  async function refused(table, row, err) {
    if (authError(err) || offlineError(err) || !(err.status >= 400 && err.status < 500)) throw err;
    if (!cantTake(err)) {
      tryLater(table, row);
      console.warn('Wefty: the cloud turned a row down for now, trying again later', table, row.id, err.status);
      return;
    }
    later.delete(table + ':' + row.id);
    const now = V.data[table].get(row.id);
    if (now && now._dirty === row._dirty) {
      const aside = { ...now, _refused: now._dirty };
      V.data[table].set(row.id, aside);
      await V.db.put(table, aside);
    }
    console.warn('Vault: the cloud refused a row', table, row.id, err.message);
    V.toast(table === 'notes' ? `"${row.title || 'A note'}" couldn't be saved to the cloud: it's too big. ` +
      'Make it shorter and it goes up.' : 'Something couldn\'t be saved to the cloud.', { kind: 'err', ms: 8000,
      help: table === 'notes' ? 'too-big' : '' });  // (1.22: Help says what to do, js/help.js)
  }

  /* One bulk upsert; if the cloud refuses it (not a network or sign-in problem), each row on its own, so a row it
     won't take (a note over its size limit) is set aside until it's changed again instead of stopping all sync.
     `fresh`: new rows only (notes, sendNew): a row the cloud already has is left as it is there, and not answered. */
  async function send(table, chunk, body, { fresh = false } = {}) {
    const upsert = (rows) => sb.from(table).upsert(rows, fresh ? { ignoreDuplicates: true } : undefined).select();
    const { data, error, status } = await upsert(body);
    if (!error) return data;
    const failed = Object.assign(error, { status });
    if (authError(failed) || offlineError(failed) || !(status >= 400 && status < 500)) throw failed;
    if (chunk.length === 1) { await refused(table, chunk[0], failed); return []; }
    const taken = [];
    for (let i = 0; i < chunk.length; i++) {
      const one = await upsert([body[i]]);
      if (!one.error) { taken.push(...one.data); continue; }
      await refused(table, chunk[i], Object.assign(one.error, { status: one.status }));
    }
    return taken;
  }

  const pushSoon = V.debounce(() => sync({ pullFirst: false }), 700);
  /* Whether anything changed here is still to go up (what a send would send). */
  const waitingHere = () => !!(V.data.settings && V.data.settings._dirty)
    || SYNCED.some((table) => [...V.data[table].values()].some((row) => row._dirty && row._refused !== row._dirty));

  /* -- the kept sign-in, while the app runs (1.22.6)

     A sign-in is only over when the kept one is (kept() null): the library lets it go when the cloud turns its renewal
     down (signed out from another device, a new password, the account deleted), and Sign out takes it away. A renewal
     that couldn't get through (no connection, the sign-in service down for a moment, a wifi that takes requests and
     never answers) leaves it kept: the library then waits a minute before it tries again, asking the cloud as nobody
     meanwhile, which the cloud answers 401. That used to bring the sign-in screen up over the notes (N1). Now it's
     "offline", and once the library's minute is up a renewal is asked for here, then a look. */
  let renewTimer = 0;
  let renewing = false;  // waiting for a renewal (the library's own, or renewNow): the first one that works brings a look
  const passExpired = (session) => !session || !session.expires_at || session.expires_at * 1000 <= Date.now() + 30000;
  function renewSoon() {
    if (V.desktop || !sb || ended) return;
    renewing = true;
    if (renewTimer) return;
    const failed = sb.auth && sb.auth.lastRefreshFailure;  // (the library's minute: until when it won't ask again)
    const left = failed && Number(failed.expiresAt) ? Number(failed.expiresAt) - Date.now() : 0;
    renewTimer = setTimeout(renewNow, Math.min(Math.max(left, 0) + 500, 65000));
  }
  async function renewNow() {
    renewTimer = 0;
    if (ended || !sb) return;
    if (!kept()) { renewing = false; sync(); return; }  // (let go meanwhile: the look says so)
    if (!navigator.onLine) return;  // ('online' brings a look, and that one asks again if it has to)
    let fresh = false;
    let refused = false;
    try {
      const { data, error } = await sb.auth.refreshSession();
      fresh = !error && !!(data && data.session);
      // (the cloud's own no: ended elsewhere, or used up. The library keeps a sign-in it turned down for as long as its
      // last pass lasts, which the tables may refuse already: let go of now, as the library would once it ran out)
      refused = !!error && error.name !== 'AuthRetryableFetchError' && [400, 401, 403, 404].includes(error.status);
    } catch (error) { /* tried again below */ }
    if (refused && kept()) { try { localStorage.removeItem('vault-auth'); } catch (error) { /* private mode */ } }
    if (fresh || !kept()) { renewing = false; sync(); return; }
    renewSoon();  // (still couldn't get through: after the library's next minute)
  }

  /* The kept sign-in is someone else's than this page's person (another tab of this browser signed them out, then
     someone else in), on the web. */
  function foreign() {
    if (V.desktop || !V.data.user) return false;
    const session = kept();
    return !!session && session.user.id !== V.data.user.id;
  }

  /* This page's person isn't signed in here any more, by another tab's doing (ACC-13): this page lets go at once and
     starts again, as whoever is signed in now (or at the sign-in screen). With someone else signed in, nothing more of
     this page's is written here (this device's copy is theirs now: V.db closed); signed out, what this page still
     saves is its own person's (kept for them, or wiped with the rest as the other tab's Sign out marked it nobody's). */
  let restarting = false;
  function restart() {
    if (restarting || V.desktop) return;
    restarting = true;
    const someoneElse = foreign();
    end();
    if (someoneElse && V.db && V.db.close) V.db.close();
    for (const table of SYNCED) V.data[table] = new Map();
    V.data.clips = [];
    V.data.settings = {};
    setTimeout(() => location.reload(), 0);
  }

  /* A sign-in the cloud ended (or another tab signed out): said, once. js/start.js shows the sign-in screen, and
     takes away what this device kept for the person but what only it has (V.settings.forgetSent). */
  function signedOut() {
    if (ended) return;
    ended = true;
    clearTimeout(timer);
    clearTimeout(renewTimer);
    setStatus('signed-out');
    V.emit('signed-out');
  }

  let syncing = null;
  let syncAgain = false;
  let pullAgain = false;  // a look stopped at its most pages: another one straight after
  /* (1.22.6, PLAT-16-online) Whether the cloud answers at all (any answer, a refusal too): one small request to the
     sign-in service's health, `deadlines.probe` at most. */
  async function answers() {
    if (!config) return false;
    const stop = new AbortController();
    const timer = setTimeout(() => stop.abort(), deadlines.probe);
    try {
      const answer = await deadlineFetch(`${config.url}/auth/v1/health`, { headers: { apikey: config.key }, cache: 'no-store',
        credentials: 'omit', signal: stop.signal });
      await answer.text().catch(() => '');  // (read to its end: nothing left waiting)
      return true;
    } catch (error) {
      return false;
    } finally {
      clearTimeout(timer);
    }
  }
  const PROBE_EVERY = 15000;  // (a look while the browser says it's offline: at most this often)
  let probedAt = -Infinity;
  async function sync({ pullFirst = true } = {}) {
    if (!sb || ended) return;
    if (foreign()) { restart(); return; }  // (1.22.6, ACC-13: someone else signed in, in another tab)
    if (syncing) { syncAgain = true; return syncing; }
    // Only an answer from the cloud says "synced" (PLAT-16): a send with nothing to send asks nothing, so the state
    // stays as the last answer left it (it said "synced" offline).
    if (!pullFirst && !waitingHere()) return;
    // (1.22.6, PLAT-16-online) With the browser saying it's offline, the cloud is still asked whether it answers, now
    // and then (the 20 s check, coming back to the front, a change to send: PROBE_EVERY at most): Chrome sometimes
    // says so wrongly for hours, and nothing went up all that time. Quietly: it stays "offline" until the cloud has
    // answered, and a look that gets an answer goes on as any other. The 'online' event brings the next look at once.
    const hinted = offlineHint();
    if (hinted && performance.now() - probedAt < PROBE_EVERY) { setStatus('offline'); return; }
    syncing = (async () => {
      if (hinted) {
        probedAt = performance.now();
        if (!(await answers())) { setStatus('offline'); return; }
      }
      setStatus('syncing');
      try {
        let more = false;
        if (pullFirst) {
          readingSettings = !settingsRead;
          await pullSettings();  // first: one small row, which the AI's choices wait for (a first sync can take a while)
          readingSettings = false;
          for (const table of SYNCED) if (await pull(table)) more = true;
          await checkGone().catch((error) => {  // (a look that didn't work is tried again at the next sync)
            if (authError(error) || offlineError(error)) throw error;
            console.warn('Wefty: couldn\'t list the notes', error);
          });
          await pullClips();
        }
        await push();
        await emptyTrash();
        // (never "synced" with rows still to come: the next look goes on at once)
        if (more) pullAgain = true;
        // (1.22.5: rows the cloud turned down for now aren't "synced": they wait for their next go)
        setStatus(more ? 'syncing' : heldCount() || pinCount() ? 'held' : restingCount() ? 'error' : 'synced');
      } catch (error) {
        if (readingSettings) {  // the settings couldn't be read: whatever waits for them goes on with this device's copy
          readingSettings = false;
          settingsFailed = true;
          for (const done of [...settingsWaiters]) done(false);
        }
        // (1.22.6, N1) On the web a sign-in is over only when the kept one is: the library lets it go when the cloud
        // turns its renewal down (DATA-03). A 401 while it's still kept is a renewal that couldn't get through: offline,
        // and renewed once the library tries again. (On the PC, Python says signed out only when it is.)
        if (!V.desktop && V.data.user) {
          if (!kept()) { signedOut(); return; }
          if (foreign()) { restart(); return; }
          if (authError(error) || passExpired(kept())) renewSoon();
          setStatus(authError(error) ? 'offline' : await whyNot(error));
          if (!offlineError(error) && !authError(error)) console.warn('Vault sync:', error);
          return;
        }
        if (authError(error)) { signedOut(); return; }
        setStatus(await whyNot(error));
        if (!offlineError(error)) console.warn('Vault sync:', error);
      }
    })().finally(() => {
      readingSettings = false;
      syncing = null;
      if (pullAgain) {  // (rows still to come: they're read now, and anything saved meanwhile goes with them)
        pullAgain = false;
        syncAgain = false;
        setTimeout(() => sync(), 0);
      } else if (syncAgain) {  // something was saved while this one ran: send it now, not at the next check
        syncAgain = false;
        setTimeout(() => sync({ pullFirst: false }), 0);
      }
    });
    return syncing;
  }

  /* Offline, the free cloud asleep (a week unused), or something else. A sleeping project's error page has no
     CORS headers, so the page only sees "Failed to fetch": the PC app asks from Python, which can tell. */
  async function whyNot(error) {
    if (/paused|\b540\b/i.test(String(error && (error.message || error))) || (error && error.status === 540)) return 'asleep';
    if (offlineHint()) return 'offline';
    if (V.desktop) {
      const health = await V.pc.call('health').catch(() => ({}));
      if (health.state === 'asleep' || health.state === 'offline') return health.state;
    }
    return offlineError(error) ? 'offline' : 'error';
  }

  /* -- the cloud's time

     What can't be undone goes by the cloud's clock, never this device's date (a phone set 40 days ahead for a game
     emptied everyone's Trash, DATA-05). Its time comes back with every write (updated_at is the cloud's now()) and
     is moved on by this page's own steady clock (performance.now(), which a changed date doesn't move). null until a
     write has come back since the page opened. */
  let cloudClock = null;  // { at: the cloud's time then (ms), mark: performance.now() then }
  const cloudNow = () => (cloudClock ? cloudClock.at + (performance.now() - cloudClock.mark) : null);
  function heard(time) {
    const at = Date.parse(time || '');
    if (!Number.isFinite(at)) return;
    const now = cloudNow();
    if (now === null || at > now) cloudClock = { at, mark: performance.now() };
  }

  /* Notes in the Trash 30 days by the cloud's time (since the cloud last stamped them: their updated_at) are deleted
     for good, each only if it's still as this device saw it (see bury). Until the cloud's time is known, the Trash
     waits. */
  async function emptyTrash() {
    const now = cloudNow();
    if (now === null) return;
    const cutoff = now - TRASH_DAYS * 86400000;
    for (const note of [...V.data.notes.values()]) {
      if (note.deleted && !note._dirty && note.updated_at && Date.parse(note.updated_at) < cutoff) {
        await purgeNote(note, { swept: true });
      }
    }
  }

  /* Deleted for good: its History copies not sent yet go at once (never sent now); its row is emptied in the cloud,
     then its files and History there go (bury). */
  async function purgeNote(note, { swept = false } = {}) {
    if (V.history) await V.history.forget(note.id, { cloud: false }).catch(() => {});
    await save('notes', { ...note, _purge: swept ? 'swept' : true });
  }

  function listen() {
    if (channel) sb.removeChannel(channel);
    channel = sb.channel('vault-' + V.device + '-' + Math.random().toString(36).slice(2, 8));
    for (const table of ['notes', 'folders', 'transfers', 'clips']) {
      channel.on('postgres_changes', { event: '*', schema: 'public', table }, (change) => arrived(table, change));
    }
    channel.subscribe((state) => {
      live = state === 'SUBSCRIBED';
      if (live) sync();
      schedule();
    });
  }

  async function arrived(table, change) {
    if (table === 'clips') {
      if (change.eventType !== 'INSERT') return;
      const clip = change.new;
      if (V.data.clips.some((c) => c.id === clip.id)) return;
      V.data.clips = [clip, ...V.data.clips].slice(0, 30);
      await V.db.put('clips', clip);
      V.emit('data', 'clips');
      V.emit('clip-in', clip);
      return;
    }
    if (change.eventType === 'DELETE') {
      const id = change.old && change.old.id;
      const here = id && V.data[table].get(id);
      if (!here) return;
      if (table === 'notes') {
        // (one with changes here that haven't gone up stays: sending it decides, as when it's found gone, DATA-17)
        if (!here._dirty) await forget(here);
        return;
      }
      V.data[table].delete(id);
      await V.db.del(table, id);
      V.emit('data', table);
      return;
    }
    // Realtime leaves out big values (a row over about 1 MB): fetch those the usual way instead.
    if ((change.errors && change.errors.length) || (table === 'notes' && !('body' in (change.new || {})))) {
      sync();
      return;
    }
    const changed = await keep(table, [change.new]);
    if (table === 'transfers') V.emit('transfers-in', changed.filter((t) => !t.deleted));
  }

  function schedule() {
    clearTimeout(timer);
    if (ended) return;
    timer = setTimeout(() => { sync(); schedule(); }, live ? POLL_LIVE : POLL_OFFLINE);
  }

  /* -- files */

  async function upload(path, blob, { mime, onProgress } = {}) {
    const token = await accessToken();
    const address = `${config.url}/storage/v1/object/vault/${path.split('/').map(encodeURIComponent).join('/')}`;
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', address);
      xhr.setRequestHeader('apikey', config.key);
      xhr.setRequestHeader('Authorization', 'Bearer ' + token);
      xhr.setRequestHeader('x-upsert', 'true');
      xhr.setRequestHeader('Content-Type', mime || blob.type || 'application/octet-stream');
      // (1.22.6, PLAT-16) No answer and no bytes moving for the storage deadline: given up like a dropped connection.
      // A slow upload that keeps moving is never cut (each bit of progress starts the wait again).
      let stall = 0;
      const wait = () => { clearTimeout(stall); stall = setTimeout(() => { xhr.abort(); reject(new Error('No internet: it\'ll go when you\'re back online.')); }, deadlines.storage); };
      xhr.upload.onprogress = (event) => { wait(); if (onProgress && event.lengthComputable) onProgress(event.loaded / event.total); };
      xhr.onloadend = () => clearTimeout(stall);
      wait();
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) return resolve();
        let message = 'The upload didn\'t work (' + xhr.status + ').';
        try { message = JSON.parse(xhr.responseText).message || message; } catch (e) { /* not JSON */ }
        // (1.22.6, SEC-23: a cloud refusing for now, over its plan's limits, busy, asleep or in trouble, in plain words;
        // the file waits where it was, as when offline)
        if (refusalOf(xhr.status)) {
          reject(Object.assign(new Error('The cloud isn\'t taking files right now. Try again in a while.'), { kind: 'refusing',
            status: xhr.status }));
          return;
        }
        if (/maximum allowed size|too large|payload/i.test(message)) message = blob && blob.size > V.FILE_MOST ? V.fileOver('That file') : V.FILE_REFUSED;
        // (1.21: turned down because the person's own room for files is full? js/send.js's V.storage asks the cloud)
        if (V.storage && V.storage.isRefusal(xhr.status, message)) {
          V.storage.refused(new Error(message)).then(reject, () => reject(new Error(message)));
          return;
        }
        reject(new Error(message));
      };
      xhr.onerror = () => reject(new Error('No internet: it\'ll go when you\'re back online.'));
      xhr.send(blob);
    });
  }

  /* (1.22.6) A file that couldn't be had, in plain words (the library's own, "Failed to fetch (no answer in time)",
     reached the screen through the pen's sheet and others): `status`, the cloud's answer when there was one. */
  function fileTrouble(error, status = (error && (error.status || error.statusCode)) || 0) {
    if (error && error.kind) return error;
    const answered = Number(status) || 0;
    const said = (words, kind) => Object.assign(new Error(words), { kind, status: answered, cause: error });
    if (!answered && offlineError(error)) return said('That needs the internet. It opens once you\'re online.', 'offline');
    if (answered === 404 || /not.?found/i.test(String((error && error.message) || ''))) return said('That file isn\'t in the cloud any more.', 'gone');
    if (refusalOf(answered)) return said('The cloud isn\'t sending files right now. Try again in a while.', 'refusing');
    return error;
  }

  async function link(path, { download } = {}) {
    const known = links.get(path + '|' + (download || ''));
    if (known && known.until > Date.now()) return known.url;
    const { data, error } = await sb.storage.from('vault').createSignedUrl(path, 3600, download ? { download } : undefined);
    if (error) throw fileTrouble(error);
    links.set(path + '|' + (download || ''), { url: data.signedUrl, until: Date.now() + 3000000 });
    return data.signedUrl;
  }

  /* (1.22.6) A file fetched by its signed link with the cloud's deadlines (deadlineFetch: the storage part's time
     until its answer starts, then given up only once its bytes stop coming): before, such a download had no deadline
     at all, and one a wifi took and never answered waited for ever. `init`: fetch's own (a caller's signal still stops
     it sooner). Throws plain words (fileTrouble). */
  async function download(path, init = {}) {
    let response;
    try {
      response = await deadlineFetch(await link(path), init);
    } catch (error) {
      throw fileTrouble(error);
    }
    if (!response.ok) throw fileTrouble(new Error('Couldn\'t load that file.'), response.status);
    return response;
  }

  /* A small file (a note's picture), from this device's copy when it has one. */
  async function blob(path) {
    const kept = await V.db.get('files', path);
    if (kept) return kept.blob;
    let got;
    try {
      got = await (await download(path)).blob();
    } catch (error) {
      const said = fileTrouble(error);  // (its words stopping half way too)
      throw said && said.kind ? said : Object.assign(new Error('Couldn\'t load that picture.'), { cause: error });
    }
    // (kept here unless big; a full device only goes without that copy, the picture still shows: DATA-10)
    if (got.size < 6 * 1024 * 1024) await V.db.put('files', { key: path, blob: got, at: Date.now() }).catch(() => {});
    return got;
  }

  /* -- files removed while the cloud couldn't be reached (1.22.6, N4)

     A file's removal used to be asked for once, and its failure let go (the callers: V.cloud.remove(...).catch(() =>
     {})): a Drive file, a note's picture, a drawing or a sent file deleted with no connection stayed in the cloud for
     good, where nothing shows it, counted against the person's room. Now each such path is noted here first (meta
     'remove-later') and let go once the cloud has answered its removal (done, or there's nothing there: 400, 404);
     the rest are asked for again after each look that ends synced, each only while nothing on this device has it any
     more (a note's picture put back with Undo, here or on another device, stays, and is no longer to go). Only files
     that are never made again under the same name (Drive, sent files, notes' files, History copies, chat files): a
     key or a chat's own file is made again at its name, and is asked for once, as before. A path that keeps being
     turned down is let go after REMOVE_TRIES. Nothing in the cloud changes; an older Wefty ignores the list. */
  const REMOVE_LATER = 'remove-later';
  const REMOVE_TRIES = 20;
  const removable = (path) => /^[^/]+\/(drive|transfers|notes|history|pcfiles|phonefiles)\//.test(path)
    || /^[^/]+\/chats\/[^/]+\/files\//.test(path);
  let laterChain = Promise.resolve();
  function laterChange(change) {
    const run = laterChain.catch(() => {}).then(async () => {
      if (ended) return;  // (after a goodbye: nothing more written here)
      const was = await V.db.meta(REMOVE_LATER).catch(() => null);
      const list = Array.isArray(was) ? was.filter((one) => one && typeof one.path === 'string') : [];
      const next = change(list);
      if (next !== list) await V.db.meta(REMOVE_LATER, next);
    });
    laterChain = run.catch(() => {});
    return run;
  }
  async function remove(paths) {
    if (!paths.length) return;
    const later = paths.filter((path) => typeof path === 'string' && removable(path));
    if (later.length) {
      await laterChange((list) => [...list.filter((one) => !later.includes(one.path)),
        ...later.map((path) => ({ path, tries: (list.find((one) => one.path === path) || { tries: 0 }).tries }))].slice(-2000))
        .catch(() => { /* (a full device: asked for once, as before) */ });
    }
    const { error } = await sb.storage.from('vault').remove(paths);
    const status = Number(error && (error.status || error.statusCode)) || 0;
    if (later.length) {
      const answered = !error || status === 400 || status === 404;
      laterChange((list) => list.flatMap((one) => (!later.includes(one.path) ? [one]
        : answered || one.tries + 1 >= REMOVE_TRIES ? [] : [{ ...one, tries: one.tries + 1 }]))).catch(() => {});
    }
    if (error) throw error;
  }
  /* The paths something on this device still has: a note's files (one in the Trash too) and what's sent or in Drive. */
  function pathsInUse() {
    const used = new Set();
    for (const row of V.data.notes.values()) if (!row._purge) for (const path of filesOf(row)) used.add(path);
    for (const row of V.data.transfers.values()) {
      if (row.deleted || row._purge) continue;
      if (row.path) used.add(row.path);
      if (row.extra && typeof row.extra.thumb === 'string') used.add(row.extra.thumb);
    }
    return used;
  }
  let removing = null;
  let removeTimer = 0;
  async function removeWaiting() {
    if (removing || !sb || ended || status !== 'synced') return removing;
    removing = (async () => {
      const was = await V.db.meta(REMOVE_LATER).catch(() => null);
      const list = Array.isArray(was) ? was.filter((one) => one && typeof one.path === 'string') : [];
      if (!list.length) return;
      const used = pathsInUse();
      const back = list.filter((one) => used.has(one.path)).map((one) => one.path);
      if (back.length) await laterChange((now) => now.filter((one) => !back.includes(one.path)));
      const going = list.filter((one) => !used.has(one.path)).map((one) => one.path);
      for (let i = 0; i < going.length; i += 100) await remove(going.slice(i, i + 100));
    })().catch(() => { /* (the next look that ends synced asks again) */ }).finally(() => { removing = null; });
    return removing;
  }
  V.on('status', (state) => {
    if (state !== 'synced') return;
    clearTimeout(removeTimer);
    removeTimer = setTimeout(() => { removeWaiting(); }, 300);
  });

  /* -- signing in and out */

  /* Who's signed in: { id, email }, plus invited (a friend's account in the owner's cloud: js/access.js) and name. */
  /* Who the account is in this cloud (1.21, V.who): the owner (app_metadata.wefty_owner, which only the cloud's
     admin side can set: the helper's set-up marks the owner's account), invited (an invite or a join QR code), or
     signed up by themselves (the Terms ticked, kept in user_metadata.terms, or an account made by Google). An account
     with none of these is a cloud's own from before 1.21, when nobody could sign up alone: its owner. Never from the
     list of linked sign-ins (the owner may add Google to theirs), only from how the account was made. */
  const whoOf = (meta, app) => {
    if (app.wefty_owner) return 'owner';
    if (meta.invited_by || app.vault_invited_by || app.vault_join) return 'invited';
    if (meta.terms || (app.provider && app.provider !== 'email')) return 'self';
    return 'owner';
  };
  const person = (account) => {
    const meta = (account && account.user_metadata) || {};
    const app = (account && account.app_metadata) || {};
    return { id: account.id, email: account.email, invited: !!(meta.invited_by || app.vault_invited_by),
      name: String(meta.name || '').slice(0, 60), who: whoOf(meta, app) };
  };

  /* The sign-in this device keeps (supabase-js's own copy, 'vault-auth'), as it is, without asking the cloud. Its hour
     may be up, and renewing it needs the cloud: 25 s or more offline (the library tries again and again), for ever on a
     wifi with no internet. null when there's none, and when the one kept is another cloud's (keptFor: never this
     cloud's sign-in). */
  function kept() {
    if (V.desktop) return null;
    try {
      const session = JSON.parse(keptFor(config && config.url) || 'null');
      return session && session.user && session.user.id && session.refresh_token ? session : null;
    } catch (error) { return null; }
  }

  async function user() {
    if (V.desktop) {
      const answer = await V.pc.call('config');
      return answer.signedIn ? { id: answer.userId, email: answer.email, invited: !!answer.invited,
        name: answer.name || '', ...(answer.who ? { who: answer.who } : {}) } : null;
    }
    // The notes show first (DATA-03): who's signed in comes from the kept sign-in, renewed behind the app. Online the
    // cloud is asked first, but never waited for long (waits.renew), so a sign-in it ended still goes straight to the
    // sign-in screen when it answers quickly; later, a sync finds that out (see sync).
    const session = kept();
    if (session) {
      const fresh = !navigator.onLine ? undefined : await Promise.race([
        sb.auth.getSession().then(({ data }) => data.session, () => undefined),
        new Promise((done) => setTimeout(done, waits.renew))]);
      if (fresh === null && !kept()) return null;  // (the cloud ended it: the library let it go)
      const who = person((fresh || session).user);
      try { localStorage.setItem('vault-user', JSON.stringify(who)); } catch (e) { /* private mode */ }
      return who;
    }
    const { data } = await sb.auth.getSession();
    if (data.session) {
      const who = person(data.session.user);
      try { localStorage.setItem('vault-user', JSON.stringify(who)); } catch (e) { /* private mode */ }
      return who;
    }
    // Offline with a session that ran out while the phone was away: still signed in, just can't renew yet. (Only a
    // session this cloud made: another cloud's isn't this one's sign-in.)
    try {
      if (keptFor(config && config.url) && localStorage.getItem('vault-user')) return JSON.parse(localStorage.getItem('vault-user'));
    } catch (e) { /* private mode */ }
    return null;
  }

  /* The password sign-in. On the web, a cloud that asks for a CAPTCHA (js/doors.js) gets a fresh token for each try;
     what went wrong keeps the cloud's own code and status (js/doors.js's words say it). */
  let codeUsed = '';  // (1.22.5) an invite's code this page signed in with (see signedInCode)
  async function signIn(email, password) {
    codeUsed = '';
    let used = password;
    if (V.desktop) {
      await V.pc.call('signIn', { email, password });
      used = V.inviteCode(password) || password;  // (the PC's Python takes it as the account has it)
    } else {
      const check = async () => ({ captchaToken: V.doors && V.doors.captcha ? await V.doors.captcha() : '' });
      let { error } = await sb.auth.signInWithPassword({ email: email.trim(), password, options: await check() });
      // An invite code typed as it's shown (k7qx-9mrt-2b): the account has it as K7QX9MRT2B (vault/invites.py).
      const code = V.inviteCode(password);
      if (error && /invalid login/i.test(error.message) && code && code !== password) {
        ({ error } = await sb.auth.signInWithPassword({ email: email.trim(), password: code, options: await check() }));
        used = code;
      }
      if (error) {
        const words = /invalid login/i.test(error.message) ? 'That e-mail or password isn\'t right.'
          : V.doors && V.doors.words ? V.doors.words(error) : error.message;
        throw Object.assign(new Error(words), { code: error.code || '', status: error.status || 0, name: error.name || 'Error' });
      }
    }
    if (V.inviteCode(password)) codeUsed = used;
    V.data.user = await user();
  }

  /* This page stops talking to the cloud for good (signing out, Delete my account, js/settings.js forgetHere): no more
     looks, renewals or live changes, and nothing a look still on its way brings is kept. */
  function end() {
    ended = true;
    renewing = false;
    clearTimeout(timer);
    clearTimeout(renewTimer);
    try { if (channel && sb) sb.removeChannel(channel); } catch (error) { /* (only background work) */ }
    if (sb && !V.desktop) {
      try { if (sb.removeAllChannels) sb.removeAllChannels(); } catch (error) { /* */ }
      try { if (sb.auth.stopAutoRefresh) sb.auth.stopAutoRefresh().catch(() => {}); } catch (error) { /* */ }
    }
  }

  /* The cloud told this sign-in is over, with its own pass (renewed first when its hour is up): true when it heard. */
  async function tellCloud(session) {
    if (!session || !config) return false;
    const ask = (path, init) => deadlineFetch(`${config.url}/auth/v1/${path}`, { ...init,
      headers: { apikey: config.key, 'Content-Type': 'application/json', ...(init.headers || {}) } });
    try {
      let pass = session.access_token;
      if (passExpired(session) && session.refresh_token) {
        const renewed = await ask('token?grant_type=refresh_token', { method: 'POST',
          body: JSON.stringify({ refresh_token: session.refresh_token }) });
        if (renewed.ok) pass = (await renewed.json().catch(() => ({}))).access_token || pass;
      }
      const answer = await ask('logout?scope=local', { method: 'POST', headers: { Authorization: `Bearer ${pass}` } });
      return answer.ok || [401, 403, 404].includes(answer.status);
    } catch (error) {
      return false;
    }
  }

  /* Signing out here. (1.22.6, N15 and DEV-11) This device forgets the sign-in first, at once, and the cloud is told
     after: `wait` ms at most are given to that (a wifi that takes requests and never answers held the notes on screen
     for the sign-in's whole deadline, and closing Wefty meanwhile left it signed in). If the cloud never hears, its
     sign-in stays alive with nobody holding it (its pass was only here), until Sign out my other devices or a new
     password ends it. On the PC, Python signs it out (Jarvis's too), and that's waited for. Resolves { told }: true
     once the cloud heard, false when it couldn't be told. */
  async function signOut({ wait = 3000 } = {}) {
    V.emit('signing-out');  // (what else this device keeps for this person goes too: js/ai.js's list of Gemini models)
    const session = kept();
    end();
    let told = Promise.resolve(false);
    try {
      if (V.desktop) await V.pc.call('signOut');
      else told = tellCloud(session);
    } finally {
      await V.db.wipe();
      try {
        for (const key of Object.keys(localStorage)) {
          if (key === 'vault-auth' || key.startsWith('vault-auth-') || key === 'vault-user') localStorage.removeItem(key);
        }
      } catch (e) { /* private mode */ }
    }
    if (wait > 0) await Promise.race([told, new Promise((done) => { setTimeout(done, wait); })]);
    return { told };
  }

  /* (1.22.6, SEC-11) "Sign out my other devices": every other sign-in of this account ends at the cloud (its renewal
     is refused from now on), this one stays. A phone left at school, or a code typed on someone else's device, stops
     there within the hour its last pass lasts. On the PC, Python holds the sign-in: only a Jarvis that can do it
     (signOutOthers) offers it. Run after `adopt` (the check's own fresh sign-in is this device's by then), so the
     sign-in this device had before, and any copy of it taken off this device, end with the rest (ACC-10). The library
     says nothing when the sign-in service refuses (401, 403, 404: this device's own sign-in was ended first, from
     elsewhere), so the sign-in service is asked afterwards whether this one is still good: if it isn't, nothing was
     signed out, and it's said (ACC-09). */
  const canSignOutOthers = () => !V.desktop || !!(V.pc && V.pc.can && V.pc.can('signOutOthers'));
  const unreached = () => Object.assign(new Error('Couldn\'t reach the cloud. Try again when you\'re online.'), { kind: 'offline' });
  async function signOutOthers() {
    if (V.desktop) return V.pc.call('signOutOthers');
    const { error } = await sb.auth.signOut({ scope: 'others' });
    if (error) {
      if (offlineError(error)) throw unreached();
      throw new Error(error.message || String(error));
    }
    const { data, error: asked } = await sb.auth.getUser();
    if (asked || !data || !data.user) {
      if (asked && offlineError(asked)) throw unreached();
      throw Object.assign(new Error('Your cloud didn\'t sign anything out: this device\'s own sign-in had ended. Sign in '
        + 'again here, then try again.'), { kind: 'refused' });
    }
    return true;
  }

  /* What signing out would throw away here (settings.js forgetHere wipes all of it), part by part: rows and the
     settings not sent, files sent but not gone up (outgoing), page photos or shared files waiting (js/capture.js),
     shares not taken in yet, the note-taker's recordings not written down yet (js/notetaker.js), chat messages
     waiting to send and chats not up yet (js/chat.js), a drawing not saved (js/ink.js), and History copies not up
     yet (js/history.js). */
  async function unsentParts() {
    const safe = async (fn) => { try { return Number(await fn()) || 0; } catch (error) { return 0; } };
    let changes = (await V.db.all('outgoing')).length + (V.data.settings._dirty ? 1 : 0);
    for (const table of SYNCED) changes += [...V.data[table].values()].filter((row) => row._dirty).length;
    if (V.capture && V.capture.waitingFiles) changes += await safe(() => V.capture.waitingFiles());
    changes += await safe(async () => (await V.db.all('shared')).length);
    return {
      changes,
      recordings: V.notetaker && V.notetaker.unsent ? await safe(() => V.notetaker.unsent()) : 0,
      chats: V.chat && V.chat.unsent ? await safe(() => V.chat.unsent()) : 0,
      drawing: await safe(async () => ((await V.db.meta('ink-draft')) ? 1 : 0)),
      history: V.history && V.history.unsent ? await safe(() => V.history.unsent()) : 0,
    };
  }
  async function unsent() {
    const parts = await unsentParts();
    return Object.values(parts).reduce((a, b) => a + b, 0);
  }

  /* -- "is it you?" (1.22.5, SEC-07)

     Before something that can't be undone (deleting the account, a new password), the person shows it's them: the
     account's password, checked with a sign-in of its own (a client that keeps it in memory, ended right after), so
     the one in use here is left as it is. An account with no password (made with Google), or one who forgot it, gets
     a code by e-mail instead (web only). On the PC, Python signs in again with it. Throws with words when it isn't.

     (1.22.6) The cloud asks too now (the helper's version 7: signing a device in, deleting an account, the owner's
     Remove): `keep` keeps that sign-in for the one call it guards, `{ session, client }` (its access token goes with
     the call as `proof`), then `endCheck` ends it, or `adopt` makes it this device's own (Sign out my other devices,
     a new password: the sign-in this device had before ends with the others, copies of it too). On the PC it's
     `{ pc: true }`: Python's own sign-in is the fresh one, and it goes with Python's calls. Only an account with no
     password (made with Google: hasPassword false) is offered a code by e-mail (1.22.6, ACC-03: the mail app on the
     same phone is no password); a code for the helper isn't traded here, the helper trades it itself. */
  let checking = null;  // the client a code was sent from, until it's typed
  function checkClient() {
    const held = new Map();
    const storage = { getItem: (key) => (held.has(key) ? held.get(key) : null), setItem: (key, value) => { held.set(key, String(value)); },
      removeItem: (key) => { held.delete(key); } };
    return window.supabase.createClient(config.url, config.key, { global: { fetch: deadlineFetch }, auth: { storage, storageKey: 'wefty-check',
      persistSession: true, autoRefreshToken: false, detectSessionInUrl: false } });
  }
  const notYou = () => Object.assign(new Error('That isn\'t your password. Try again.'), { kind: 'not-you' });
  const PC_CANT_CHECK = 'This PC can\'t check it\'s you in this Wefty cloud (it asks for a robot check the PC app can\'t '
    + 'show). Do it on your phone or Chromebook instead.';
  async function proved(temp, data, keep = false) {
    const who = data && (data.user || (data.session && data.session.user));
    const me = V.data.user && V.data.user.id;
    const session = data && data.session;
    if (!keep || !session || !who || who.id !== me) temp.auth.signOut({ scope: 'local' }).catch(() => {});  // (its job done: ended)
    if (!who || !me || who.id !== me) throw notYou();
    return keep && session ? { session, client: temp } : true;
  }
  /* Ends a check's sign-in that was kept (`keep`) and not adopted. Never throws. */
  function endCheck(held) {
    if (!held || !held.client || held.adopted) return;
    held.adopted = true;  // (once)
    held.client.auth.signOut({ scope: 'local' }).catch(() => {});
  }
  /* The kept check's sign-in becomes this device's own (web): the library takes it as if signed in just now. False
     when the cloud couldn't be asked (the check's sign-in is ended then). */
  async function adopt(held) {
    if (V.desktop || !held || !held.session) return !!held;
    const { error } = await sb.auth.setSession({ access_token: held.session.access_token, refresh_token: held.session.refresh_token });
    if (error) { endCheck(held); return false; }
    held.adopted = true;
    return true;
  }
  /* Whether the signed-in account has a password: one made with an e-mail and a password lists "email" among its
     providers (one made with Google, never given one, doesn't), as the cloud said at the last sign-in or renewal (the
     helper reads it the same way). Unsure, or on the PC: it has. */
  function hasPassword() {
    if (V.desktop) return true;
    const session = kept();
    const app = (session && session.user && session.user.app_metadata) || {};
    if (Array.isArray(app.providers)) return app.providers.includes('email');
    return typeof app.provider === 'string' ? app.provider === 'email' : true;
  }
  /* (1.22.6, N7) Whether the account is still there, asked of the sign-in service with `token` (a check's, or this
     device's): true, false (gone), or null (no answer). Straight, so the library never acts on the answer itself. */
  async function accountThere(token) {
    if (!token) return null;
    try {
      const response = await deadlineFetch(`${config.url}/auth/v1/user`, { headers: { apikey: config.key, Authorization: `Bearer ${token}` } });
      if (response.ok) return true;
      return [401, 403, 404].includes(response.status) ? false : null;
    } catch (error) {
      return null;
    }
  }
  async function checkPassword(password, { keep = false } = {}) {
    const email = String((V.data.user || {}).email || '');
    if (!password) throw notYou();
    if (V.desktop) {
      try { await V.pc.call('signIn', { email, password }); } catch (error) {
        if (/isn't right|invalid/i.test(error.message || '')) throw notYou();
        // (ACC-16: a cloud with a robot check refuses Python's password sign-in, which is the PC's whole check)
        if (/captcha|robot check/i.test(error.message || '') || error.code === 'captcha_failed') {
          throw Object.assign(new Error(PC_CANT_CHECK), { kind: 'pc-captcha' });
        }
        throw error;
      }
      return keep ? { pc: true } : true;
    }
    const temp = checkClient();
    const captchaToken = V.doors && V.doors.captcha ? await V.doors.captcha() : '';
    const { data, error } = await temp.auth.signInWithPassword({ email, password, options: captchaToken ? { captchaToken } : {} });
    if (error) {
      if (/invalid login|invalid_credentials/i.test(`${error.code} ${error.message}`)) throw notYou();
      throw Object.assign(new Error(V.doors && V.doors.words ? V.doors.words(error) : error.message), { code: error.code || '' });
    }
    return proved(temp, data, keep);
  }
  async function sendCheckCode() {
    const email = String((V.data.user || {}).email || '');
    checking = checkClient();
    const captchaToken = V.doors && V.doors.captcha ? await V.doors.captcha() : '';
    const { error } = await checking.auth.signInWithOtp({ email, options: { shouldCreateUser: false, captchaToken } });
    if (error) throw Object.assign(new Error(V.doors && V.doors.words ? V.doors.words(error) : error.message), { code: error.code || '' });
    return email;
  }
  async function checkCode(code, { keep = false } = {}) {
    const email = String((V.data.user || {}).email || '');
    const temp = checking || checkClient();
    const { data, error } = await temp.auth.verifyOtp({ email, token: String(code || '').replace(/\D/g, ''), type: 'email' });
    if (error) {
      throw Object.assign(new Error(V.doors && V.doors.words ? V.doors.words(error) : 'That code isn\'t right, or it ran out.'),
        { kind: 'not-you' });
    }
    checking = null;
    return proved(temp, data, keep);
  }

  /* A new password. It also ends an invite's one-time code: a friend's account says must_change_password until
     they choose their own (js/access.js), and the PC's changePassword clears it the same way (vault/cloud.py).
     (1.22.5) `current`, the password now when it's known (typed to show it's them, an invite's code, a join's), goes
     along: a cloud with Supabase's "Require current password when updating" switched on wants it, and one without it
     ignores it. A Jarvis without changePasswordChecked takes the new one alone, as before. */
  async function changePassword(password, { current = '' } = {}) {
    if (V.desktop) {
      if (current && V.pc.can('changePasswordChecked')) return V.pc.call('changePasswordChecked', { password, current });
      return V.pc.call('changePassword', { password });
    }
    const { error } = await sb.auth.updateUser({ password, ...(current ? { current_password: current } : {}),
      data: { must_change_password: false } });
    if (error) {
      const said = `${error.code} ${error.message}`;
      if (/same_password|different from the old/i.test(said)) throw new Error('That\'s the password you have now: pick a new one.');
      if (/current_password_(invalid|mismatch)/i.test(said)) throw new Error('That isn\'t your password now. Try again.');
      if (/current_password_required/i.test(said)) {
        throw new Error('Your cloud wants the password you have now for that. Forgot it? Sign out, then tap Forgot password.');
      }
      throw new Error(error.message);
    }
  }

  /* Whether the signed-in account is still on its one-time invite code (asked fresh when it seems so: it may have
     been chosen on another device). Offline, what this device last heard. */
  async function mustChange() {
    if (V.desktop) {
      const config = await V.pc.call('config');
      if (!config.mustChange) return false;
      if (!V.pc.can('account')) return true;
      try { return !!(await V.pc.call('account')).mustChange; } catch (error) { return true; }
    }
    // (from the kept sign-in first, as user() does: the start never waits on the cloud for this, DATA-03)
    const session = kept() || (await sb.auth.getSession()).data.session;
    const meta = session && session.user && session.user.user_metadata;
    if (!meta || !meta.must_change_password) return false;
    if (!navigator.onLine) return true;  // (offline: as it was)
    try {
      const fresh = await Promise.race([sb.auth.getUser(), new Promise((done) => setTimeout(() => done(null), 5000))]);
      if (fresh && !fresh.error && fresh.data && fresh.data.user) return !!(fresh.data.user.user_metadata || {}).must_change_password;
    } catch (error) { /* offline: as it was */ }
    return true;
  }

  /* This device's copy belongs to one person. A copy left by someone else who used Vault here (they never signed
     out, and another person signed in after) is wiped first: never shown to the next one, never sent up as theirs.
     (1.22.6, DEV-09) A copy forgotten here (Sign out, Delete my account) is marked as nobody's (NOBODY) as the last
     step, so whatever landed in it afterwards is wiped for whoever signs in next too. Every Wefty since 1.8 reads the
     mark the same way. A copy with no mark at all (from before marks were written) is still taken by whoever signs in:
     it may hold notes that never went up. */
  async function ownCopy() {
    const me = V.data.user && V.data.user.id;
    if (!me) return;
    const was = await V.db.meta('owner');
    if (was && was !== me) {
      await V.db.wipe();
      // (1.22.6, round C, DEV2-03) and the note-taker's recordings waiting to be written down: the room sound of the
      // person who was here before is never kept for, or sent as, the next one's
      try { indexedDB.deleteDatabase('wefty-listening'); } catch (error) { /* (none, or a browser that can't) */ }
    }
    if (was !== me) await V.db.meta('owner', me);
  }

  const NOBODY = '(nobody)';

  /* (1.22.6, ACC-13) Wefty open in another tab or window of this browser, signing this person out there (the kept
     sign-in taken away) or someone else in (another account's): this page lets go and starts again at once, as
     whoever is signed in now. Before, it went on showing every note from memory, and carried on as the next person at
     its next look, writing what was typed there into their account. A renewal (the same account) changes nothing. */
  function watchOtherTabs() {
    if (V.desktop) return;
    window.addEventListener('storage', (event) => {
      if (event.storageArea !== localStorage || (event.key !== 'vault-auth' && event.key !== null) || ended) return;
      if (!V.data.user) return;
      if (event.key === null || !event.newValue) { restart(); return; }  // (taken away, or all of this site's storage)
      let session = null;
      try { session = JSON.parse(event.newValue); } catch (error) { /* damaged: as if gone */ }
      const whose = session && session.user && session.user.id;
      if (!whose || whose !== V.data.user.id) restart();
    });
  }

  /* Shows this device's copy at once; the returned promise is the first sync with the cloud. */
  async function start() {
    settingsRead = false;  // (this person's settings: read again from the cloud)
    await ownCopy();
    await loadLocal();
    window.addEventListener('online', () => sync());
    window.addEventListener('offline', () => setStatus('offline'));
    V.on('back', () => sync());
    watchOtherTabs();
    listen();
    schedule();
    return { firstSync: sync() };
  }

  return {
    client, start, sync, save, keep, push, upload, link, blob, remove, purgeNote, user, signIn, signOut, kept,
    changePassword, accessToken, unsent, unsentParts, RETRY, resting: () => [...later].map(([key, one]) => ({ key, wait: one.wait })), mergeExtra, notePrint, mustChange, madeBy, keptFor, setPin,
    lockRow, oldPinsDue, forgetOldPins, reseal,
    checkPassword, sendCheckCode, checkCode, deadlines, deadlineFetch, signOutOthers, canSignOutOthers,
    // (1.22.6) end: this page stops talking to the cloud for good (js/settings.js forgetHere); NOBODY: the mark of a
    // copy forgotten here (ownCopy)
    end, NOBODY, get ended() { return ended; },
    endCheck, adopt, hasPassword, accountThere, PC_CANT_CHECK,
    /* (1.22.5) The invite code this page signed in with just now ('' when none): a friend's first password then goes
       with it as the password now (chooseScreen), for a cloud that asks for that. Memory only. */
    signedInCode: () => codeUsed,
    waits,  // (tests shorten them)
    get sb() { return sb; },
    /* The cloud the client was made for ({ url, key }), or null before there's one (js/doors.js). */
    cloudConfig: () => (config ? { url: config.url, key: config.key } : null),
    get status() { return status; },
    get held() { return heldCount(); },
    /* (1.22.6, SEC-23) The cloud answers the tables but turns changes down for now: '' when it isn't, else 'full'
       (over its plan's limits), 'busy' (too many requests), 'asleep' or 'trouble' (5xx). */
    get refusing() { return refusing ? refusing.kind : ''; },
    /* (1.22.6) A file by its signed link, with the cloud's deadlines (`init`: fetch's own); throws plain words. */
    download,
    /* (1.22.5) Notes changed here that wait for the PIN, as another device locked them meanwhile (waitForPin); askPin
       asks for it, then sends them sealed. */
    get waitingPin() { return pinCount(); },
    /* (1.22.6) How many of those are the other way round: locked here, and changed on another device meanwhile. */
    get waitingPinHere() { return pinWaiting().filter((row) => row.locked).length; },
    askPin,
    get live() { return live; },
    /* Settings columns changed on this device (a new PIN): kept here at once, and only these columns go up. */
    async saveSettings(values) {
      const here = V.data.settings || {};
      const send = [...new Set([...(here._dirty ? unsentSettings(here) : []), ...Object.keys(values)])];
      V.data.settings = { ...here, ...values, _dirty: Date.now(), _send: send };
      await V.db.meta('settings', V.data.settings);
      pushSoon();
    },
    /* A change to the settings row's extra for every device (`change(extra)` gives the new extra, and may be run again
       on a newer one): made on the cloud's newest extra, only if nobody changed it in between (writeExtra), one
       change at a time here, each given waits.extra ms at most (timedExtra: a hung request never holds the next one);
       extra alone goes up, never the PIN's columns. Throws when the cloud can't be read or written in time (every
       caller copes: the tally keeps what it owes, a switch goes back and says so).
       A Vault older than 1.9.1 on another device still writes its own copy of the whole extra when it sends a new PIN
       (and a Chromebook's first announce did): that can put "Use Claude too" back to what that device last saw
       (usually off), as 1.9.0 could the tally. It ends once that device updates. */
    changeExtra,
    /* Whether the settings row has been read from the cloud since this page started; settingsReady(ms) waits for that
       (true), or gives up (false: this device's copy is all there is for now, as when offline): after `ms`, at once
       when offline (or the cloud is asleep, or the PC app says it can't be reached), and as soon as a read under way
       fails. After a read that failed, a fresh one is tried (and waited for) when the network seems to be there. */
    settingsRead: () => settingsRead,
    settingsReady(ms) {
      if (settingsRead) return Promise.resolve(true);
      const cut = !navigator.onLine || status === 'asleep' || (V.desktop && settingsFailed && status === 'offline');
      if (settingsFailed && !readingSettings && navigator.onLine) {
        // A fresh try (after a sync that doesn't read the settings, when one is running): its failure ends the wait.
        Promise.resolve(syncing).catch(() => {}).then(() => { if (!settingsRead && !readingSettings) sync(); });
      }
      if (cut) return Promise.resolve(false);
      return new Promise((resolve) => {
        const done = (value) => { clearTimeout(timer); settingsWaiters.delete(done); resolve(value); };
        const timer = setTimeout(() => done(false), ms);
        settingsWaiters.add(done);
      });
    },
    async insertClip(text) {
      const row = { id: V.uuid(), text, from_device: V.device, created_at: new Date().toISOString() };
      const { data, error, status } = await sb.from('clips').insert({ id: row.id, text, from_device: V.device }).select().single();
      if (error) throw Object.assign(error, { status });
      heard(data && data.created_at);
      if (!V.data.clips.some((c) => c.id === data.id)) V.data.clips = [data, ...V.data.clips].slice(0, 30);
      await V.db.put('clips', data);
      V.emit('data', 'clips');
      return data || row;
    },
  };
})();
