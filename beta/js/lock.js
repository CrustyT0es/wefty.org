/* Vault: locked notes. A locked note's words are encrypted on the device (AES-GCM, with a key made from the
   owner's PIN by PBKDF2) before they go anywhere; the cloud only ever holds the scrambled text in `secret`.
   The settings row keeps a salt and a short encrypted check, so a PIN can be tested without any note. A forgotten
   PIN can't be got round: that's the point, and setting one says so. Unlocked stays unlocked UNLOCK_MINUTES.

   What a PIN is for, and what it isn't (the sheets below and privacy.html say so, WORDS): it keeps a locked note's
   words from someone holding or borrowing a device, and they're sealed in the cloud too. It's a short number, so
   whoever has a copy of the sealed note (and the salt and check kept beside it) can try every PIN in time: about
   80 ms a try, 13 minutes for all the 4-digit ones on one core. The title, folder, due date and reminder of a
   locked note are not sealed: only its words (and, since 1.22.6, its flash cards' progress, see tuck). */
'use strict';

V.lock = (() => {
  const ROUNDS = 310000;
  const CHECK = 'vault-pin-ok';
  const UNLOCK_MINUTES = 5;
  let key = null;
  let keySalt = null;  // the PIN salt the key was made with: a PIN changed on the other device makes it useless
  let lastUse = 0;
  // (1.22.5) Keys of earlier PINs (their salts: the settings row's extra.pin_old, and a PIN made here by an older Wefty
  // that the cloud's replaced, meta 'pin-orphans') that open notes still sealed with them: found with the PIN typed
  // (the same digits kept) or the old PIN asked for (tryOld). Only ever used to open: a note opened with one is sealed
  // again with the PIN in use now.
  let oldKeys = [];
  // (1.22.6, N6) A PIN change whose answer never came, and the read after it got none either (js/cloud.js
  // pinAfterAll): it may have gone. The old PIN's keys are kept for this page meanwhile ({ salt: the new PIN's, oldKeys }),
  // so the new PIN, once this device learns the cloud has it, opens the notes still sealed with the old one too (and
  // they're sealed again, settle). Let go with the other keys (forget), and once a PIN change is used (adopt).
  let pending = null;
  // (1.22.5, SEC-03) Wrong PINs, kept on this device (a reload doesn't start them again): after TRIES_FREE in a row,
  // each next try waits, longer each time (waits.first, doubling, waits.most at most).
  const TRIES = 'wefty-pin-tries';
  const TRIES_FREE = 5;
  // (tests shorten them) row: how long a PIN that isn't this device's waits for the cloud's lock row before it counts
  // as wrong; bank: how often the wait gone by is written down; settle: how soon after unlocking the notes are tidied.
  const waits = { first: 30000, most: 3600000, row: 2500, bank: 5000, settle: 1500 };
  /* What the sheets say about a PIN (one or two plain sentences each; privacy.html says the same). */
  const WORDS = {
    make: 'At least 4 digits. It keeps a locked note\'s words from anyone holding or borrowing your device, and '
      + 'they\'re scrambled in the cloud too. It\'s a short number, so it isn\'t strong protection against someone '
      + 'with a copy of the scrambled note and time to try every PIN. If you forget it, nobody can open your locked '
      + 'notes.',
    ask: 'Your PIN keeps your locked notes from anyone else using this device. If you\'ve forgotten it, nobody can '
      + 'open them.',
    wait: 'The wait only counts while Wefty is open.',
  };

  const b64 = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes)));
  const unb64 = (text) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));

  async function derive(pin, salt) {
    const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: ROUNDS, hash: 'SHA-256' }, base,
      { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  }

  async function seal(withKey, text) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const sealed = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, withKey, new TextEncoder().encode(text));
    const out = new Uint8Array(12 + sealed.byteLength);
    out.set(iv);
    out.set(new Uint8Array(sealed), 12);
    return 'v1:' + b64(out);
  }

  async function open(withKey, payload) {
    if (!payload || !payload.startsWith('v1:')) throw new Error('This locked note is damaged.');
    const bytes = unb64(payload.slice(3));
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes.slice(0, 12) }, withKey, bytes.slice(12));
    return new TextDecoder().decode(plain);
  }

  const currentSalt = () => (V.data.settings || {}).pin_salt || null;
  const fresh = () => !!key && keySalt === currentSalt() && Date.now() - lastUse < UNLOCK_MINUTES * 60000;

  /* A key for `pin` that opens `check` (made with `salt`), or null. */
  async function keyFor(pin, salt, check) {
    try {
      const tried = await derive(pin, unb64(salt));
      return (await open(tried, check)) === CHECK ? tried : null;
    } catch (error) {
      return null;
    }
  }
  /* The earlier PINs' salts and checks (see oldKeys). */
  async function earlier() {
    const extra = (V.data.settings || {}).extra || {};
    const kept = Array.isArray(extra.pin_old) ? extra.pin_old : [];
    const here = V.db ? (await V.db.meta('pin-orphans').catch(() => null)) || [] : [];
    const seen = new Set();  // (one kept in the cloud and here too counts once)
    return [...kept, ...here].filter((one) => one && typeof one.salt === 'string' && typeof one.check === 'string'
      && one.salt !== currentSalt() && !seen.has(one.salt) && !!seen.add(one.salt));
  }
  async function findOld(pin) {
    const found = [];
    for (const one of await earlier()) {
      const made = await keyFor(pin, one.salt, one.check);
      if (made) found.push(made);
    }
    return found;
  }

  /* -- wrong PINs (SEC-03)

     After TRIES_FREE wrong PINs in a row each next try waits, longer each time. (1.22.6) The wait runs on this
     page's own steady clock (performance.now(), which the device's date and time never move) and only counts time
     Wefty saw go by while it was open: moving the device's clock, forwards or back, doesn't shorten it, and neither
     does closing Wefty and coming back (before, the wait ended at a time of day, so each move of the clock gave one
     more guess). Kept as { n, until, seen }: `until - seen` is what was left of the wait when it was last written
     down, at `seen` by this device's clock (which only tells this page's own writing from another tab's). A Wefty
     before 1.22.6 reads `n` and `until` (a time of day: it goes by the clock, as ever) and writes no `seen`: a wait
     it wrote is taken once at what's left of it by the clock, then counted like any other. */
  let triesHere = null;  // (the same, in memory, only where storage can't be used: a private window)
  let mark = null;       // { seen, at }: this page's look at the wait as kept (`at` on the steady clock)
  let looked = false;    // this page has taken the kept wait over (its first look writes it down afresh)
  let banking = 0;
  const steady = () => performance.now();
  const waitFor = (n) => (n >= TRIES_FREE ? Math.min(waits.most, waits.first * 2 ** (n - TRIES_FREE)) : 0);
  const kept = () => {
    try {
      const value = JSON.parse(localStorage.getItem(TRIES) || 'null');
      return value && typeof value === 'object' ? value : null;
    } catch (error) {
      return triesHere;
    }
  };
  const triesWrite = (value) => {
    triesHere = value;
    looked = true;
    mark = value && value.seen ? { seen: value.seen, at: steady() } : null;
    try {
      if (value) localStorage.setItem(TRIES, JSON.stringify(value));
      else localStorage.removeItem(TRIES);
    } catch (error) { /* a private window: this page only (triesHere) */ }
  };
  /* The wrong tries in a row, and how much of the wait is still to go: { n, left }. */
  function tries() {
    const was = kept();
    const n = was ? Number(was.n) || 0 : 0;
    const until = was ? Number(was.until) || 0 : 0;
    if (n <= 0 || until <= 0) return { n: Math.max(0, n), left: 0 };
    const seen = Number(was.seen) || 0;
    const most = waitFor(n);  // (never longer than the wait this many tries earns)
    if (!seen || !looked) {
      // This page's first look (or a wait a Wefty before 1.22.6 wrote, which has no `seen`: what's left of it by the
      // clock, this once): written down afresh, and counted from here.
      const left = Math.min(Math.max(0, seen ? until - seen : until - Date.now()), most);
      const now = Date.now();
      triesWrite({ n, until: left > 0 ? now + left : 0, seen: now });
      if (left > 0) bankSoon();
      return { n, left };
    }
    if (!mark || mark.seen !== seen) mark = { seen, at: steady() };  // (another tab wrote it: counted from now)
    const left = Math.min(Math.max(0, until - seen), most) - (steady() - mark.at);
    if (left > 0) bankSoon();
    return { n, left: Math.max(0, left) };
  }
  /* What's gone by of the wait is written down now and then (and when Wefty goes out of sight), so a reload or a
     closed tab carries on from there, not from the start. */
  function bank() {
    const { n, left } = tries();
    const was = kept();
    if (!n || !was || !(Number(was.until) > 0)) { clearInterval(banking); banking = 0; return; }
    const now = Date.now();
    triesWrite({ n, until: left > 0 ? now + left : 0, seen: now });
  }
  function bankSoon() {
    if (!banking) banking = setInterval(() => { if (!document.hidden) bank(); }, waits.bank);
  }
  function wrongPin() {
    const n = tries().n + 1;
    const wait = waitFor(n);
    const now = Date.now();
    triesWrite({ n, until: wait ? now + wait : 0, seen: now });
    if (wait) bankSoon();
  }
  function rightPin() {
    triesWrite(null);
  }
  /* How long until the PIN can be tried again (0: now). */
  const waitLeft = () => tries().left;
  /* That wait in words: "30 seconds", "2 minutes", "1 hour". */
  function waitWords(ms = waitLeft()) {
    const seconds = Math.ceil(ms / 1000);
    if (seconds < 60) return `${seconds} second${seconds === 1 ? '' : 's'}`;
    const minutes = Math.ceil(seconds / 60);
    if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'}`;
    return '1 hour';
  }
  try {
    tries();  // (the wait is counted from the moment this page opened, not from the first time it's asked about)
    document.addEventListener('visibilitychange', () => { if (document.hidden) bank(); });
    window.addEventListener('pagehide', bank);
    // (another tab of Wefty wrote it: this page counts on from what that one wrote, without writing it again)
    window.addEventListener('storage', (event) => {
      if (event.key !== TRIES && event.key !== null) return;
      const was = kept();
      mark = was && Number(was.seen) ? { seen: Number(was.seen), at: steady() } : null;
    });
  } catch (error) { /* (no page to listen to: the wait is still counted whenever it's asked about) */ }

  /* Sealing and opening need the key of the PIN in use now (however long ago it was unlocked: an open note stays
     open while it's on screen); asking for the PIN again is down to `unlocked`. */
  function usable() {
    if (!key) throw new Error('Unlock with your PIN first.');
    if (keySalt !== currentSalt()) {
      key = null;
      throw new Error('Your PIN was changed on your other device. Unlock the note again with the new PIN.');
    }
    lastUse = Date.now();
    return key;
  }

  /* Opens `payload` with the PIN in use now, else an earlier PIN's key: { text, old } (old: it needs sealing again). */
  async function openAny(payload) {
    const current = usable();
    try {
      return { text: await open(current, payload), old: false };
    } catch (error) {
      for (const earlierKey of oldKeys) {
        try { return { text: await open(earlierKey, payload), old: true }; } catch (again) { /* the next one */ }
      }
      throw error;
    }
  }

  /* The key `pin` makes with this device's copy of the PIN ({ key, salt }), or null. */
  async function keyNow(pin) {
    const settings = V.data.settings || {};
    if (!settings.pin_salt || !settings.pin_check) return null;
    const made = await keyFor(pin, settings.pin_salt, settings.pin_check);
    return made ? { key: made, salt: settings.pin_salt } : null;
  }

  /* (1.22.6, SEC-03) Before a PIN counts as wrong: the lock row is read from the cloud (waits.row ms at most, and
     not at all offline: unlocking never waits on a network that isn't there). True when it brought another PIN, or
     other earlier ones, than this device had: the PIN typed is then tried once more. A PIN changed on another device
     a moment ago isn't known here until the next look at the settings (every 2 minutes at best), and the right new
     PIN used to be counted as wrong five times and then made to wait. */
  const lockMark = () => JSON.stringify([currentSalt(), (((V.data.settings || {}).extra || {}).pin_old || [])
    .map((one) => one && one.salt)]);
  async function fresher() {
    if (!V.cloud || !V.cloud.lockRow) return false;
    const before = lockMark();
    try { await V.cloud.lockRow(waits.row); } catch (error) { return false; }
    return lockMark() !== before;
  }

  /* -- what's sealed with a locked note's words (1.22.6, SEC-22)

     A locked note's seal is JSON: { body } and, beside it, { cards }: its flash cards' progress, which sat in the
     row's extra.cards in plain before. Each card's code there is a short hash (32 bits) of its hidden word or its
     term, and a word list finds short words from such a hash at once, so the codes gave a locked note's words away
     to whoever holds the cloud. Locked notes aren't studied, so nothing needs them outside the seal; unlocking the
     note puts them back (untuck), with the progress they had. Out of the row too: Test me's kept questions and
     answers (extra.quiz, since 1.22.5) and the print of the note as it was when plain (extra.edited_print: a hash of
     its words among other things). A Wefty before 1.22.6 reads only `body` from the seal, and seals { body } alone
     when words are changed there: the cards in that note then start afresh once it's unlocked, nothing more. */
  const isObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
  /* Whether a locked note's row still has something of its words beside the seal. */
  const loose = (row) => !!row.extra && ('cards' in row.extra || 'quiz' in row.extra);
  /* `inside` (the seal's JSON) and `extra` (the row's) with what belongs in the seal moved into it. */
  function tuck(inside, extra) {
    const out = { ...(extra || {}) };
    const sealed = { ...(isObject(inside) ? inside : {}) };
    if (isObject(out.cards) && Object.keys(out.cards).length) sealed.cards = { ...(isObject(sealed.cards) ? sealed.cards : {}), ...out.cards };
    delete out.cards;
    delete out.quiz;
    delete out.edited_at;
    delete out.edited_print;
    return { inside: sealed, extra: out };
  }
  /* The other way, as a note's lock is taken off: its cards' progress back in `extra` (only the cards `keep` lets
     through: the ones still in its words). */
  function untuck(inside, extra, keep = (cards) => cards) {
    const out = { ...(extra || {}) };
    const cards = isObject(inside) && isObject(inside.cards) ? keep(inside.cards) : null;
    if (cards && Object.keys(cards).length) out.cards = { ...cards, ...(isObject(out.cards) ? out.cards : {}) };
    return out;
  }

  /* -- with the keys in hand (1.22.6)

     Right after the PIN is typed (and after an earlier one is, or the PIN is changed), while the keys are here:
     every locked note on this device that only opens with an earlier PIN is sealed again with the one in use now,
     and what an older Wefty left in plain beside a seal goes into it (tuck). Then the earlier PINs' checks are let go
     (letGo), once nothing needs them: each is a way to guess that old PIN, and people's new PINs look like their old
     ones. The note open in the editor is left to the editor (it seals its own note again as it's shown). */
  let settleTimer = 0;
  let settling = null;
  let owed = false;  // something couldn't be done yet only because this device wasn't in step with the cloud
  let copiesAt = 0;  // when the sealed older versions were last gone through with an earlier PIN's key (this page)
  const COPIES_EVERY = 10 * 60000;
  const lockedIds = () => [...V.data.notes.values()].filter((row) => row.locked && row.secret && !row._purge).map((row) => row.id);
  function settleSoon(ms = waits.settle) {
    clearTimeout(settleTimer);
    settleTimer = setTimeout(() => { settle().catch((error) => console.warn('Wefty: tidying locked notes', error)); }, ms);
  }
  function settle() {
    if (settling) return settling;
    settling = (async () => {
      if (!fresh() || !V.cloud || !V.cloud.sb || !V.data.notes) return;
      owed = false;
      const shut = await sealAgain();
      // While an earlier PIN's key is here (it was just typed, or the PIN just changed), the sealed older versions in
      // History still under it are sealed again too (js/history.js sealedNow): later only the PIN in use is typed, and
      // they'd keep that earlier PIN's check from ever going.
      if (oldKeys.length && V.history && V.history.sealedNow && Date.now() - copiesAt > COPIES_EVERY) {
        if (navigator.onLine && ['synced', 'held'].includes(V.cloud.status)) {
          copiesAt = Date.now();
          await V.history.sealedNow(lockedIds(), { again: true }).catch(() => false);
        } else owed = true;
      }
      await letGo(shut);
    })().finally(() => { settling = null; });
    return settling;
  }

  /* Returns how many locked notes here don't open with the PIN in use now (and weren't sealed again just now). Each
     is written straight to the cloud, only on the version this device has (V.cloud.reseal says why): so only while
     this device is in step with it, and never a note with a change of its own still to go up. */
  async function sealAgain() {
    let shut = 0;
    const inStep = () => navigator.onLine && ['synced', 'held'].includes(V.cloud.status);
    for (const row of [...V.data.notes.values()]) {
      if (!row.locked || !row.secret || row._purge) continue;
      let got;
      try { got = await openAny(row.secret); } catch (error) { shut++; continue; }  // (no key here opens it: as it is)
      if (!got.old && !loose(row)) continue;
      const left = () => { if (got.old) shut++; };
      if (!inStep() || row._dirty) { owed = true; left(); continue; }
      if (V.editor && V.editor.openId && V.editor.openId() === row.id) { left(); continue; }
      let inside = null;
      try { inside = JSON.parse(got.text); } catch (error) { /* not a seal Wefty made */ }
      if (!isObject(inside)) { left(); continue; }
      const next = tuck(inside, row.extra);
      const secret = await seal(usable(), JSON.stringify(next.inside));
      let went = false;
      try { went = V.data.notes.get(row.id) === row && await V.cloud.reseal(row.id, secret, next.extra); } catch (error) { went = false; }
      if (!went) left();
    }
    return shut;
  }

  /* The earlier PINs' checks (the cloud's extra.pin_old, this device's meta 'pin-orphans') let go once nothing is
     sealed with them (the ones V.cloud.oldPinsDue says may go by now: js/cloud.js has the rest of the rule). How
     that's known: this device is in step with the cloud (synced, nothing here waiting to go up), so it has every note
     the cloud has; with the key in hand, every locked note (the Trash's too) opens with the PIN in use now; and so
     does every sealed older version of them in History (js/history.js sealedNow, which seals the ones under an
     earlier PIN again while its key is here). A note or a version that opens with no key here, or can't be read just
     now, keeps every check: never a note that nothing can open. */
  async function letGo(shut) {
    if (shut || !(await earlier()).length) return;
    const due = await V.cloud.oldPinsDue();
    if (!due.length) return;
    const inStep = V.cloud.status === 'synced' && ![...V.data.notes.values()].some((row) => row._dirty);
    owed = owed || !inStep;
    if (!inStep) return;
    const ids = [];
    for (const row of V.data.notes.values()) {
      if (!row.locked || row._purge || !row.secret) continue;
      try { await open(usable(), row.secret); } catch (error) { return; }
      ids.push(row.id);
    }
    if (!V.history || !V.history.sealedNow || !(await V.history.sealedNow(ids))) return;
    if (!fresh() || V.cloud.status !== 'synced') return;
    await V.cloud.forgetOldPins(due);
  }
  try {
    V.on('status', (state) => { if (state === 'synced' && owed && fresh()) settleSoon(300); });
  } catch (error) { /* (no events here) */ }

  return {
    hasPin: () => !!(V.data.settings && V.data.settings.pin_salt && V.data.settings.pin_check),
    unlocked: () => fresh(),
    forget: () => { key = null; keySalt = null; oldKeys = []; copiesAt = 0; pending = null; },
    touch: () => { if (key) lastUse = Date.now(); },
    waitLeft,
    waitWords,
    waits,  // (tests shorten them)
    WORDS,
    tuck,
    untuck,
    settle,
    /* "Too many wrong PINs. Try again in 2 minutes." (and that the wait only counts while Wefty is open) while a wait
       is on, else ''. */
    waitSaid: () => (waitLeft() ? `Too many wrong PINs. Try again in ${waitWords()}. ${WORDS.wait}` : ''),
    /* Whether there's an earlier PIN a note may still be sealed with (see tryOld). */
    hasEarlier: async () => (await earlier()).length > 0,

    /* (1.22.5) A new PIN, not used yet: { values: the settings row's new columns, key }. It's used (`adopt`) only
       once the cloud took it (V.cloud.setPin): a PIN the cloud turned down never seals anything. */
    async prepare(pin) {
      const salt = crypto.getRandomValues(new Uint8Array(16));
      const made = await derive(pin, salt);
      return { values: { pin_salt: b64(salt), pin_check: await seal(made, CHECK) }, key: made };
    },
    adopt(prepared) {
      key = prepared.key;
      keySalt = prepared.values.pin_salt;
      oldKeys = prepared.oldKeys || oldKeys;
      pending = null;
      lastUse = Date.now();
      rightPin();
      settleSoon();
    },
    /* A new PIN used at once (the settings row's new columns), as before 1.22.5: what's left of it is for tests that
       set a PIN up quickly. The app's own ways use prepare, V.cloud.setPin, then adopt; a PIN sent from here by
       V.cloud.saveSettings never goes over the cloud's either (js/cloud.js's unsentPin). */
    async make(pin) {
      const prepared = await this.prepare(pin);
      this.adopt(prepared);
      return prepared.values;
    },

    /* `settle` false: the notes aren't tidied after it (rekey: the PIN is about to change). */
    async unlock(pin, { settle: tidy = true } = {}) {
      if (waitLeft()) return false;  // (SEC-03: callers say how long first; this is the backstop)
      let made = await keyNow(pin);
      if (!made && await fresher()) made = await keyNow(pin);  // (SEC-03: the cloud's PIN, if it's another by now)
      if (!made) { wrongPin(); return false; }
      rightPin();
      key = made.key;
      keySalt = made.salt;
      lastUse = Date.now();
      // (1.22.6, N6: the PIN changed here a moment ago, whose answer never came, is the cloud's: the old one's keys too)
      const before = pending && pending.salt === made.salt ? pending.oldKeys : [];
      if (before.length) pending = null;
      oldKeys = [...before, ...(await findOld(pin))];  // (an earlier PIN of the same digits: its notes open too)
      if (tidy) settleSoon();
      return true;
    },

    /* (1.22.5) The PIN a note was locked with before (its salt kept in pin_old, or a PIN made here that the cloud's
       replaced): true when it opens one of them. (1.22.6, SEC-03) It opens what's still sealed with it and nothing
       more: only the PIN in use now clears the count of wrong tries (before, anyone who knew an earlier PIN could
       type it after four wrong guesses and start the count again, so the wait never came). */
    async tryOld(pin) {
      if (waitLeft()) return false;
      let found = await findOld(pin);
      if (!found.length && await fresher()) found = await findOld(pin);
      if (!found.length) { wrongPin(); return false; }
      oldKeys = [...oldKeys, ...found];
      settleSoon();  // (every note it opens is sealed again with the PIN in use now, so it's never needed twice)
      return true;
    },

    async encrypt(text) {
      return seal(usable(), text);
    },

    async decrypt(payload) {
      return (await openAny(payload)).text;
    },
    openAny,

    /* Changing the PIN: every locked note is opened (with the PIN in use, or an earlier one it opens) and sealed again
       with the new one, here, in memory. Nothing is used until the cloud took the new PIN: `adopt(result)` then (see
       js/settings.js). One that can't be opened at all stays as it is. Null when `oldPin` isn't the PIN. */
    async rekey(oldPin, newPin, notes) {
      if (!(await this.unlock(oldPin, { settle: false }))) return null;
      const from = keySalt;
      const prepared = await this.prepare(newPin);
      const changed = [];
      for (const note of notes) {
        if (!note.locked || !note.secret) continue;
        let text;
        try { text = (await openAny(note.secret)).text; } catch (error) { continue; }
        changed.push({ ...note, secret: await seal(prepared.key, text) });
      }
      // (the old PIN's key stays for opening only: a note a device that was offline seals with it still opens)
      pending = { salt: prepared.values.pin_salt, oldKeys: [key, ...oldKeys] };
      return { ...prepared, settings: prepared.values, notes: changed, from, oldKeys: [key, ...oldKeys] };
    },

    /* The PIN pad, as a promise of the PIN (or null). `make` asks twice and says what a PIN is for and that it can't
       be recovered; asked for, it says the same in a line unless the caller has its own `hint`. */
    askPin({ title = 'Enter your PIN', make = false, hint = '' } = {}) {
      return new Promise((resolve) => {
        let first = null;
        let answer = null;
        const dots = V.h('div.pin-dots');
        const note = V.h('p.hint.pin-about', { text: make ? WORDS.make : hint || WORDS.ask });
        const heading = V.h('p.pin-title', { text: make ? 'Pick a PIN for locked notes' : '' });
        let typed = '';
        const draw = () => {
          V.clear(dots, [...typed].map(() => V.h('span.dot.full')), typed ? null : V.h('span.dot'));
        };
        const press = async (digit) => {
          if (digit === 'back') typed = typed.slice(0, -1);
          else if (digit === 'ok') return submit();
          else if (typed.length < 12) typed += digit;
          draw();
        };
        const submit = () => {
          if (typed.length < 4) { note.textContent = 'At least 4 digits.'; return; }
          if (make && first === null) {
            first = typed; typed = ''; draw();
            heading.textContent = 'Type it once more';
            return;
          }
          if (make && typed !== first) {
            first = null; typed = ''; draw();
            heading.textContent = 'They didn\'t match. Pick a PIN';
            return;
          }
          answer = typed;
          sheet.close();
        };
        const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'back', '0', 'ok'];
        const pad = V.h('div.pin-pad', {}, keys.map((k) => V.h('button.pin-key' + (k === 'ok' ? '.go' : ''), {
          type: 'button', onclick: () => press(k), 'aria-label': k === 'back' ? 'Delete' : k === 'ok' ? 'OK' : k,
        }, k === 'back' ? V.icon('back') : k === 'ok' ? V.icon('check') : k)));
        const typing = (event) => {
          if (/^[0-9]$/.test(event.key)) { event.preventDefault(); press(event.key); }
          else if (event.key === 'Backspace') { event.preventDefault(); press('back'); }
          else if (event.key === 'Enter') { event.preventDefault(); submit(); }
        };
        document.addEventListener('keydown', typing, true);
        const sheet = V.sheet({
          title, content: [heading, dots, note, pad],
          onClose: () => { document.removeEventListener('keydown', typing, true); resolve(answer); },
        });
        draw();
      });
    },
  };
})();
