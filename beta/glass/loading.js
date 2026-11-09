/* Wefty 2.0 "glass", area: Loading. This file belongs to the Loading builder; nobody else edits it.
   Loading and waiting: the splash with the 3D logo, the first screen's skeletons, the way one screen gives way to the next,
   the edge light, and the frame-drop check that turns lite on for a device that struggles. Plain script, shares `V`.
   Inert unless V.look.isGlass() (and it listens to V.on('look') so the switch in Settings works live, both ways); every
   animation is transform or opacity (a thread's stroke-dashoffset is the one other), through Web Animations, and every
   one can start again at once.

   What's here:
     V.splash   the splash screen (its markup and CSS are inline in index.html, so it paints before any script runs).
                V.splash.done() ends it: js/start.js calls it when the first screen is drawn (or a sign-in screen is), and the
                logo settles away at once (after at least 380 ms of it, so it never flashes). Hard stops: 6 s in the CSS (no
                script needed), 7 s here. Only on a cold start: the page itself is the cold start, tabs never bring it back.
                Calm (prefers-reduced-motion, or Settings > Appearance > Animations: Calm): the logo only fades. Lite: fewer
                layers, no sway, no wave. The app's first screen rises in (V.motion.enter) as the splash goes.
                The entrance (index.html) is sampled from damped springs, one continuous curve with linear easing between its
                keyframes (so the spin never stops part-way), done by .9 s; the exit is the stage's and the veil's own, and never
                replaces an entrance animation that is still running.
     V.skel     skeletons: soft glass shapes with a light sweeping along a thread, drawn over the part of Today, Notes or Chat whose
                data is on its way, and ONLY then: this device has no notes yet and the first sync is running. After 250 ms (a wait
                under that shows nothing, not a flash of grey), gone the moment the data is there; the real screen rises in.
                V.skel.today() / notes() / chat() / bubbles() / list() / rows() / week() make the shapes for other screens.
     transitions  a screen that gives way to another (a tab, Settings) slides and fades in, from the side it is on in the tab bar.
     V.edge     the edge light. A thin glass edge of light round the screen's corners, invisible at rest. Other parts only say
                V.emit('edge', kind): saved (one thread round the screen), done (the whole edge blooms), synced, arrived (a thread),
                error (a short red-tinted flash), loading (a slow loop). One run per 1.5 s; none while a sheet's scrim is fading in
                or the page is hidden; in Calm only the bloom, as a plain fade, and the flash. V.edge.loading(true|false) starts and
                ends the slow loop (after 1.2 s of waiting; it ends in a bloom). Settings > Appearance: V.edge.enabled() /
                setEnabled(on) and corners() / setCorners('round' | 'square').
     V.loading  the frame-drop check on the first screen changes (judge, feed, samples) and the status watcher (an offline or
                asleep cloud is said once, in a message card; a sync that works again after trouble is one thread of light). */
'use strict';

(() => {
const V = window.V;
if (!V) return;
const root = document.documentElement;
const EASE = 'cubic-bezier(.2,.8,.2,1)';
const HAS_WAAPI = typeof Element !== 'undefined' && typeof Element.prototype.animate === 'function';

const on = () => !!(V.look && V.look.isGlass());
const calm = () => root.classList.contains('calm');
const lite = () => root.classList.contains('lite');
const away = () => document.hidden || !!(V.away && V.away());
const keep = (key) => { try { return localStorage.getItem(key); } catch (error) { return null; } };
const store = (key, value) => {
  try { if (value === null) localStorage.removeItem(key); else localStorage.setItem(key, value); } catch (error) { /* a private window: nothing is kept */ }
};
const cancelAll = (list) => { for (const a of list) { try { a.cancel(); } catch (error) { /* gone */ } } };

/* ================================================================== the frame-drop check */

/* A device that struggles shows it in the time between frames. The splash's frames say little (the main thread is busy
   booting, while the logo itself turns on the compositor), so what turns lite on is the first three screen changes: if most
   of their frames take over 50 ms the device is too slow for the full look (V.motion.lite(true): kept per device, until
   Animations is set to Full). The splash's own frames only decide whether its logo may turn. */
const samples = { splash: [], transition: [] };
let judged = false;
function judge(deltas) {
  const d = (deltas || []).filter((x) => x > 0 && x < 2000);
  const n = d.length;
  if (n < 12) return { n, slow: 0, median: 0, verdict: 'unknown' };
  const sorted = [...d].sort((a, b) => a - b);
  const median = sorted[n >> 1];
  const slow = d.filter((x) => x > 50).length;
  return { n, slow, median, verdict: median > 40 || slow / n > 0.45 ? 'slow' : 'ok' };
}
/* Deltas for `label` (the tests feed their own); three screen changes' worth that say slow turn lite on. */
function feed(label, deltas) {
  const list = samples[label] || (samples[label] = []);
  list.push(deltas);
  const flat = list.flat();
  const result = judge(flat);
  if (label === 'transition' && list.length >= 3 && !judged && result.verdict !== 'unknown') {
    judged = true;
    if (result.verdict === 'slow' && V.motion && V.motion.lite && !V.motion.lite() && !(V.look && V.look.animations && V.look.animations() === 'full')) V.motion.lite(true);
  }
  return result;
}
function sample(label, ms) {
  if (!window.requestAnimationFrame || document.hidden) return;
  const deltas = [];
  let last = 0;
  const stop = performance.now() + ms;
  const tick = (now) => {
    if (document.hidden) return;
    if (last) deltas.push(now - last);
    last = now;
    if (now < stop) requestAnimationFrame(tick);
    else feed(label, deltas);
  };
  requestAnimationFrame(tick);
}

/* ================================================================== the splash screen */

const MIN_SHOW = 380;     // ms of it before it may go: a logo that flashes is worse than one that waits a moment
const HARD_STOP = 7000;   // (the CSS has its own at 6 s, for when no script runs)
const splashState = { el: null, finished: false, exiting: false, gone: false, timer: 0, hard: 0, why: '', slowSeen: false };

const paintedAt = () => {
  try {
    const mark = performance.getEntriesByType('paint').find((e) => e.name === 'first-paint');
    if (mark) return mark.startTime;
  } catch (error) { /* an old browser */ }
  return 0;
};

/* The first screen rises in as the splash goes: each part of it one after the other (V.motion.enter), but not what already
   has an animation of its own running (Today's own entrance). Nothing in Calm. */
function startEntrance() {
  if (calm() || !V.motion || !V.motion.enter) return;
  const view = document.querySelector('main.view');
  const page = view && view.firstElementChild;
  if (!page || page.classList.contains('g-skel')) return;
  const items = [...page.children].filter((c) => c.nodeType === 1 && !c.classList.contains('g-skel') && !c.hidden
    && !c.classList.contains('fab') && !(c.getAnimations && c.getAnimations().length));
  if (!items.length) return;
  items.forEach((c) => c.setAttribute('data-g-rise', ''));
  V.motion.enter(page, { selector: ':scope > [data-g-rise]', stagger: 55, delay: 70 }).finished.then(() => {
    items.forEach((c) => c.removeAttribute('data-g-rise'));
  });
}

function removeSplash() {
  const s = splashState;
  clearTimeout(s.timer);
  clearTimeout(s.hard);
  if (s.el) s.el.remove();
  s.el = null;
  if (!s.gone) {
    s.gone = true;
    edge.loading(false, 'splash');
    V.emit('splash', 'gone');
  }
}

function exitSplash() {
  const s = splashState;
  if (!s.el || s.exiting) return;
  s.exiting = true;
  edge.loading(false, 'splash');
  startEntrance();
  s.el.classList.add('gs-out');
  s.el.addEventListener('animationend', (event) => { if (event.target === s.el && event.animationName === 'gs-bye') removeSplash(); });
  setTimeout(removeSplash, 800);  // (the animation never ran: the page was hidden, or animations are off)
}

/* The first screen is drawn (or a sign-in screen): the splash settles away. Safe to call any number of times. */
function splashDone(why = 'ready') {
  const s = splashState;
  if (!s.el || s.finished) return;
  s.finished = true;
  s.why = why;
  const wait = calm() ? 0 : Math.max(0, MIN_SHOW - (performance.now() - paintedAt()));
  s.timer = setTimeout(exitSplash, wait);
  V.emit('splash', 'done');
}

function startSplash() {
  const s = splashState;
  s.el = document.getElementById('g-splash');
  if (!s.el) return;
  if (!on()) { s.el.remove(); s.el = null; s.gone = true; return; }  // (classic never shows it)
  s.hard = setTimeout(() => { if (s.el) { s.finished = true; s.why = 'timeout'; removeSplash(); } }, HARD_STOP);
  edge.loading(true, 'splash');  // (still up after 1.2 s: the edge starts its slow loop)
  if (!calm() && !lite()) {
    // (the main thread's frames while the app boots under the splash)
    const deltas = [];
    let last = 0;
    const tick = (now) => {
      if (!s.el || s.exiting) return;
      if (last) deltas.push(now - last);
      last = now;
      // (six frames in a row over 90 ms: the page can hardly draw at all. The logo's turn runs on the compositor and is never
      // stopped or restarted for that (a spin that is cut and jumps looks like a hitch); only the thread, which is painted on the
      // main thread, stops drawing itself and just shows: gs-slow in the CSS)
      if (deltas.length >= 6 && deltas.slice(-6).every((x) => x > 90)) { s.slowSeen = true; root.classList.add('gs-slow'); }
      if (now < 1500) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }
}

V.splash = {
  /* Still showing (or leaving)? */
  active: () => !!splashState.el,
  done: splashDone,
  /* Ends it at once, no animation (a screen that needs the whole page). */
  remove: removeSplash,
  /* What it did: { finished, exiting, gone, why }. For the tests. */
  state: () => ({ finished: splashState.finished, exiting: splashState.exiting, gone: splashState.gone, why: splashState.why }),
};

/* ================================================================== skeletons */

const NS = 'http://www.w3.org/2000/svg';
function box(tag, cls, kids, vars) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (vars) for (const [k, v] of Object.entries(vars)) e.style.setProperty(`--${k}`, String(v));
  for (const kid of kids || []) if (kid) e.append(kid);
  return e;
}
const card = (cls, k, kids) => box('div', `g-sk-card ${cls || ''}`.trim(), kids, { k });
const line = (width, cls) => { const e = box('span', `g-sk-line ${cls || ''}`.trim()); if (width) e.style.width = width; return e; };
/* The thread under a card, with a bright dash that runs along it. */
function thread(k) {
  const s = document.createElementNS(NS, 'svg');
  s.setAttribute('class', 'g-sk-thread');
  s.setAttribute('viewBox', '0 0 120 8');
  s.setAttribute('aria-hidden', 'true');
  s.style.setProperty('--k', String(k));
  for (const cls of ['base', 'run']) {
    const p = document.createElementNS(NS, 'path');
    p.setAttribute('d', 'M1 4 C 6 1, 11 7, 16 4 S 26 1, 31 4 S 41 7, 46 4 S 56 1, 61 4 S 71 7, 76 4 S 86 1, 91 4 S 101 7, 106 4 S 116 1, 119 4');
    p.setAttribute('class', cls);
    if (cls === 'run') p.setAttribute('pathLength', '100');
    s.append(p);
  }
  return s;
}
const layer = (label) => { const e = box('div', 'g-skel'); e.setAttribute('role', 'status'); e.setAttribute('aria-label', label); return e; };
const hide = (e) => { e.setAttribute('aria-hidden', 'true'); return e; };

/* The week strip: day cards. */
function week(count = 4) {
  return hide(box('div', 'g-sk-days', Array.from({ length: count }, (_, i) => card('g-sk-day', i, [line(), line(i % 2 ? '70%' : '48%'), thread(i)]))));
}
/* List rows: a box and two lines each (a to-do). */
function rows(count = 3) {
  const widths = [['62%', '38%'], ['74%', '44%'], ['52%', '34%'], ['68%', '40%']];
  return hide(card('', 1, [box('div', 'g-sk-rows', Array.from({ length: count }, (_, i) => box('div', 'g-sk-row',
    [box('span', 'g-sk-box'), box('div', 'g-sk-text', [line(widths[i % 4][0]), line(widths[i % 4][1])])])))]));
}
/* Note cards: a title, two lines and a thread. */
function list(count = 3) {
  const titles = ['58%', '44%', '66%', '50%'];
  const second = ['92%', '86%', '90%', '84%'];
  const third = ['74%', '62%', '52%', '66%'];
  return hide(box('div', '', Array.from({ length: count }, (_, i) => card('g-sk-note', i,
    [line(titles[i % 4], 'title'), line(second[i % 4]), line(third[i % 4]), thread(i)]))));
}
/* A chat's messages: yours on the right, the answer's on the left. */
function bubbles(count = 3) {
  return hide(box('div', 'g-sk-bubbles', Array.from({ length: count }, (_, i) => card(i % 2 ? 'g-sk-bubble ai' : 'g-sk-bubble you', i,
    i % 2 ? [line('90%'), line('64%')] : [line('80%')]))));
}
function today() {
  const e = layer('Loading your day');
  const mine = box('div', 'g-sk-mine', [hide(box('div', 'g-sk-head', [line(), line()])), rows(3)]);
  const tests = box('div', 'g-sk-tests', [hide(card('g-sk-more', 4, [line('48%', 'title'), line('30%')]))]);
  e.append(week(), hide(box('div', 'g-sk-tiles', Array.from({ length: 5 }, (_, i) => box('div', 'g-sk-tile', [card('', i), line()])))),
    hide(box('div', 'g-sk-cols', [mine, tests])));
  return e;
}
function notes() {
  const e = layer('Loading your notes');
  e.append(hide(box('div', 'g-sk-chips', [64, 98, 112, 92].map((w, i) => { const c = card('', i); c.style.width = `${w}px`; return c; }))), list(3));
  return e;
}
function chat() {
  const e = layer('Loading your chats');
  e.append(hide(box('div', 'g-sk-chat', [0, 1, 2, 3].map((i) => card('g-sk-chatrow', i, [line(['64%', '52%', '70%', '58%'][i], 'title'), line(['38%', '30%', '42%', '34%'][i])])))));
  return e;
}

/* "The data is on its way": the first sync is running and this device has no notes or folders yet. A device that already
   holds its copy never shows a skeleton (it draws the real screen at once). */
let firstDone = false;
function waiting() {
  if (!V.cloud || !V.data || firstDone) return false;
  if (V.cloud.status !== 'syncing') return false;
  return V.data.notes.size === 0 && V.data.folders.size === 0;
}

/* Where a skeleton starts: under the lowest of the parts that stay (those that are drawn: offsetParent is null for a part that is not). */
function lowest(host, selector) {
  let bottom = 0;
  for (const part of host.querySelectorAll(selector)) {
    if (part.offsetParent === null) continue;
    bottom = Math.max(bottom, part.offsetTop + part.offsetHeight);
  }
  return bottom;
}

const KINDS = {
  today: {
    cls: 'g-wait-today', make: today, label: 'day',
    host: () => document.querySelector('.view[data-tab="today"] > .page.today'),
    top: (host) => lowest(host, ':scope > .today-line, :scope > .today-greet, :scope > .app-head'),
    rise: (host) => [...host.children].filter((c) => !/(^|\s)(app-head|today-greet|today-line|g-skel)(\s|$)/.test(c.className)),
  },
  notes: {
    cls: 'g-wait-notes', make: notes, label: 'notes',
    host: () => document.querySelector('.view[data-tab="notes"] .list-column'),
    top: (host) => lowest(host, ':scope > .list-head, :scope > .list-title, :scope > .chips'),
    rise: (host) => [...host.querySelectorAll(':scope > .chips, :scope > .list')],
  },
  claude: {
    cls: 'g-wait-chat', make: chat, label: 'chats',
    host: () => document.querySelector('.view[data-tab="claude"] .chat-list'),
    top: () => 8,
    rise: (host) => [...host.children].filter((c) => !c.classList.contains('g-skel')),
  },
};
const SHOW_AFTER = 250;   // under this the screen simply waits: a flash of grey is slower than nothing
const GIVE_UP = 20000;    // never longer than this: the real screen shows whatever the sync is doing
const REVEAL_WAIT = 160;  // the screens redraw themselves when the data lands: the cover stays a moment, then the real thing rises in

let cur = null;           // { kind, host, layer, timers, watch }
let revealTimer = 0;
let gaveUp = false;       // covered for GIVE_UP ms and still waiting: not covered again until the wait has been over once
let frame = 0;

function watchView(on_) {
  if (cur && cur.watch) { cur.watch.disconnect(); cur.watch = null; }
  const view = document.querySelector('main.view');
  if (!on_ || !view || !window.MutationObserver) return;
  cur.watch = new MutationObserver(() => {
    // (the screen drew itself again, a new element in place of the covered one: Today does that on any 'data', 'streak' or
    // 'status' while the first sync is still held. Looked at now, before the browser can paint, so the new one is never seen
    // uncovered; waiting for the next frame left it bare for a frame, and the skeleton gone with it)
    if (cur && !cur.host.isConnected) { update(); return; }
    if (frame) return;
    frame = requestAnimationFrame(() => { frame = 0; update(); });
  });
  cur.watch.observe(view, { childList: true, subtree: true });
}

function placeLayer() {
  if (!cur) return;
  const spec = KINDS[cur.kind];
  if (!cur.layer) cur.layer = spec.make();
  const host = cur.host;
  cur.layer.style.setProperty('--g-skel-top', `${spec.top(host)}px`);
  const style = getComputedStyle(host);
  cur.layer.style.paddingLeft = style.paddingLeft;
  cur.layer.style.paddingRight = style.paddingRight;
  if (cur.layer.parentNode !== host) host.append(cur.layer);
}

function cover(kind, host) {
  const spec = KINDS[kind];
  const mine = { kind, host, layer: null, timers: [], watch: null, since: performance.now() };
  cur = mine;
  host.classList.add('g-wait', spec.cls);
  host.setAttribute('aria-busy', 'true');
  // (by the cover, not its element: a screen that draws itself again keeps its cover, moved to the new element)
  cur.timers.push(setTimeout(() => { if (cur === mine) placeLayer(); }, SHOW_AFTER));
  cur.timers.push(setTimeout(() => { if (cur === mine) { gaveUp = true; uncover(); } }, GIVE_UP));
  edge.loading(true, 'skeleton');
  watchView(true);
}

/* The covered screen drew itself again (the same screen, a new element) while its data is still on its way: the cover goes to
   the new element at once, as it was: no new 250 ms wait, no second rise, and the edge light's wait goes on undisturbed. */
function moveCover(host) {
  const spec = KINDS[cur.kind];
  cur.host.classList.remove('g-wait', spec.cls);
  cur.host.removeAttribute('aria-busy');
  cur.host = host;
  host.classList.add('g-wait', spec.cls);
  host.setAttribute('aria-busy', 'true');
  if (cur.layer) placeLayer();
}

/* Takes the cover off: the skeleton fades, the real screen is there under it and rises in. `quick`: no animation (the screen
   is gone, or the look was switched off). */
function uncover(quick) {
  const was = cur;
  if (!was) return;
  cur = null;
  clearTimeout(revealTimer);
  revealTimer = 0;
  was.timers.forEach(clearTimeout);
  if (was.watch) was.watch.disconnect();
  const spec = KINDS[was.kind];
  const host = was.host;
  host.classList.remove('g-wait', spec.cls);
  host.removeAttribute('aria-busy');
  edge.loading(false, 'skeleton');
  const skeleton = was.layer;
  if (skeleton) {
    if (quick || !HAS_WAAPI || !host.isConnected) skeleton.remove();
    else {
      skeleton.classList.add('g-sk-out');
      const gone = () => skeleton.remove();
      skeleton.addEventListener('animationend', gone, { once: true });
      setTimeout(gone, 400);
    }
  }
  if (!quick && host.isConnected && !calm() && skeleton && V.motion && V.motion.enter) {
    const items = spec.rise(host);
    items.forEach((c) => c.setAttribute('data-g-rise', ''));
    if (items.length) V.motion.enter(host, { selector: ':scope > [data-g-rise]', stagger: 55 }).finished.then(() => items.forEach((c) => c.removeAttribute('data-g-rise')));
  }
}

/* One look at the screen: cover it if its data is on its way, take the cover off if it has arrived. Safe to call any time. */
function update() {
  if (!on()) { uncover(true); return; }
  const kind = KINDS[V.tab ? V.tab() : ''] ? V.tab() : '';
  if (gaveUp) { if (!waiting()) gaveUp = false; if (!cur) return; }
  if (!kind || !waiting()) {
    if (cur && !revealTimer) revealTimer = setTimeout(() => { revealTimer = 0; if (!waiting()) uncover(); }, cur.layer ? REVEAL_WAIT : 0);
    return;
  }
  clearTimeout(revealTimer);
  revealTimer = 0;
  const host = KINDS[kind].host();
  if (!host || (kind === 'claude' && !host.offsetParent)) { if (cur && cur.kind !== kind) uncover(true); return; }
  if (cur && cur.kind === kind && cur.host !== host && !cur.host.isConnected) moveCover(host);
  else if (cur && (cur.kind !== kind || cur.host !== host)) uncover(true);
  if (!cur) cover(kind, host);
  else if (cur.layer && !cur.layer.isConnected) placeLayer();
  else if (!cur.layer) { /* (its 250 ms are still running) */ }
}

V.skel = {
  waiting, today, notes, chat, bubbles, list, rows, week,
  /* The part of the screen covered now ('today', 'notes', 'claude'), or ''. */
  active: () => (cur ? cur.kind : ''),
  /* Whether its skeleton shapes are drawn yet (after 250 ms). */
  shown: () => !!(cur && cur.layer && cur.layer.isConnected),
  update,
};

/* ================================================================== screens give way to each other */

/* Where each screen sits in the tab bar: a screen further right comes in from the right, one further left from the left. */
const ORDER = { today: 0, notes: 1, send: 2, files: 2, clips: 2, claude: 3, settings: 4 };
let lastView = null;
let transitions = 0;

function slide(was, view) {
  if (!HAS_WAAPI) return;
  const main = document.querySelector('main.view');
  if (!main) return;
  const dir = (ORDER[view] === undefined ? 1 : ORDER[view]) >= (ORDER[was] === undefined ? 1 : ORDER[was]) ? 1 : -1;
  for (const item of [...main.children]) {
    if (item.nodeType !== 1 || item.classList.contains('fab') || item.hidden) continue;
    for (const a of item.getAnimations()) { if (a.id === 'g-slide') a.cancel(); }
    let frames;
    let options;
    if (calm()) { frames = [{ opacity: 0.3 }, { opacity: 1 }]; options = { duration: 120, easing: 'linear' }; }
    else if (lite()) { frames = [{ opacity: 0.3 }, { opacity: 1 }]; options = { duration: 160, easing: 'ease-out' }; }
    else { frames = [{ opacity: 0.3, transform: `translateX(${dir * 18}px)` }, { opacity: 1, transform: 'none' }]; options = { duration: 320, easing: EASE }; }
    try { item.animate(frames, { ...options, id: 'g-slide' }); } catch (error) { /* gone */ }
  }
}

V.on('tab', (view) => {
  const was = lastView;
  lastView = view;
  update();
  if (was === null || !on() || view === was) return;  // (the first screen is the splash's: nothing slides in the cold start)
  slide(was, view);
  transitions++;
  if (transitions <= 3) sample('transition', 420);
});

/* ================================================================== the edge light */

const edge = (() => {
  const KEY = 'wefty-edge';
  const CORNERS = 'wefty-edge-corners';
  const GAP = 1500;                                          // one run per 1.5 s
  const LOOP_AFTER = 1200;                                   // a wait this long starts the slow loop
  const RANK = { error: 5, done: 4, arrived: 3, saved: 2, synced: 1 };
  let el = null;
  let run = null;
  let disc = null;
  let bloom = null;
  let glow = null;
  let job = null;                                            // what is on now: { kind, anims }
  let last = { kind: '', at: -1e9 };
  let started = [];                                          // the kinds started, newest last (for the tests)
  const reasons = new Set();                                 // who is waiting (the splash, a skeleton, a caller)
  let loopTimer = 0;
  let looping = false;

  const enabled = () => keep(KEY) !== 'off';
  const corners = () => (keep(CORNERS) === 'square' ? 'square' : 'round');
  function applyCorners() {
    if (on() && corners() === 'square') root.dataset.edgeCorners = 'square';
    else delete root.dataset.edgeCorners;
  }

  function build() {
    if (el && el.isConnected) return el;
    el = document.createElement('div');
    el.id = 'g-edge';
    el.hidden = true;
    el.setAttribute('aria-hidden', 'true');
    disc = box('i', 'ge-disc');
    run = box('div', 'ge-run', [box('div', 'ge-ring', [disc])]);
    glow = box('div', 'ge-glow');
    bloom = box('div', 'ge-bloom');
    el.append(run, glow, bloom);
    document.body.append(el);
    return el;
  }

  function sheetFading() {
    // a sheet's scrim coming in (a layer that is not yet shown): its own motion has the screen's attention
    return !!document.querySelector('#layers > .layer:not(.shown):not(.leaving)');
  }

  function clear() {
    if (job) { cancelAll(job.anims); job = null; }
    looping = false;
    if (el) { el.hidden = true; el.classList.remove('ge-loop'); delete el.dataset.tone; }
  }

  function over(mine) {
    if (job !== mine) return;
    cancelAll(mine.anims);  // (a finished animation keeps its last frame; the light is gone, so nothing of it is left behind)
    job = null;
    if (el) el.hidden = true;
    if (reasons.size && loopTimer === -1) startLoop();  // (still waiting: the slow loop goes on)
  }

  function play(kind, tone, anims, ms) {
    const mine = { kind, anims };
    job = mine;
    started.push(kind);
    if (started.length > 40) started.shift();
    const finish = () => over(mine);
    Promise.all(anims.map((a) => a.finished.catch(() => {}))).then(finish);
    setTimeout(finish, ms + 300);  // (a page that was hidden never finishes its animations)
    return true;
  }

  /* One thread of light round the screen: the head of a conic gradient turns once, with its violet tail fading behind it. */
  function thread(kind) {
    const quick = lite();
    const ms = quick ? 820 : 1150;
    el.classList.remove('ge-loop');
    delete el.dataset.tone;
    el.hidden = false;
    const anims = [
      disc.animate([{ transform: 'translate(-50%, -50%) rotate(0deg)' }, { transform: 'translate(-50%, -50%) rotate(400deg)' }],
        { duration: ms, easing: 'cubic-bezier(.45,.1,.35,1)', fill: 'both' }),
      run.animate([{ opacity: 0 }, { opacity: 1, offset: 0.08 }, { opacity: 1, offset: 0.62 }, { opacity: 0 }], { duration: ms, easing: 'linear', fill: 'both' }),
    ];
    if (quick) anims.push(glow.animate([{ opacity: 0 }, { opacity: 0.85, offset: 0.3 }, { opacity: 0.85, offset: 0.55 }, { opacity: 0 }], { duration: ms, easing: 'linear', fill: 'both' }));
    return play(kind, '', anims, ms);
  }

  /* The whole edge lights up and fades (done); a short softer red one for a failure. Calm: a still ring that fades in and out. */
  function flash(kind) {
    const failed = kind === 'error';
    el.classList.remove('ge-loop');
    if (failed) el.dataset.tone = 'err'; else delete el.dataset.tone;
    el.hidden = false;
    let frames;
    let ms;
    if (calm()) {
      ms = 480;  // (fades of 120 ms: in, a hold, out)
      frames = [{ opacity: 0 }, { opacity: failed ? 0.8 : 1, offset: 0.25 }, { opacity: failed ? 0.8 : 1, offset: 0.75 }, { opacity: 0 }];
    } else if (failed) {
      ms = lite() ? 520 : 760;
      frames = [{ opacity: 0 }, { opacity: 0.8, offset: 0.2 }, { opacity: 0.35, offset: 0.6 }, { opacity: 0 }];
    } else {
      ms = lite() ? 760 : 1300;
      frames = [{ opacity: 0 }, { opacity: 0.55, offset: 0.25 }, { opacity: 1, offset: 0.42 }, { opacity: 0.5, offset: 0.72 }, { opacity: 0 }];
    }
    return play(kind, failed ? 'err' : '', [bloom.animate(frames, { duration: ms, easing: 'linear', fill: 'both' })], ms);
  }

  /* The slow loop: a shorter tail, once round every two seconds, until the wait is over. */
  function startLoop() {
    if (!on() || !enabled() || calm() || !HAS_WAAPI || away()) return;
    build();
    clear();
    el.classList.add('ge-loop');
    delete el.dataset.tone;
    el.hidden = false;
    looping = true;
    const anims = [
      disc.animate([{ transform: 'translate(-50%, -50%) rotate(0deg)' }, { transform: 'translate(-50%, -50%) rotate(360deg)' }], { duration: 2000, iterations: Infinity, easing: 'linear' }),
      run.animate([{ opacity: 0 }, { opacity: 0.9 }], { duration: 300, easing: 'linear', fill: 'forwards' }),
    ];
    if (lite()) anims.push(glow.animate([{ opacity: 0.5 }, { opacity: 0.8 }], { duration: 1000, direction: 'alternate', iterations: Infinity, easing: 'ease-in-out', fill: 'both' }));
    job = { kind: 'loading', anims };
    started.push('loading');
    loopTimer = -1;
  }

  function stopLoop(bloomAfter) {
    if (!looping) return;
    const mine = job;
    looping = false;
    if (mine && mine.kind === 'loading') { cancelAll(mine.anims); job = null; }
    if (el) { el.classList.remove('ge-loop'); el.hidden = true; }
    if (bloomAfter && on() && enabled() && !away()) { build(); flash('done'); last = { kind: 'done', at: performance.now() }; }
  }

  /* Someone is waiting (the splash, a skeleton, a caller with its own reason): after 1.2 s the slow loop starts, and it ends
     in a bloom when the last of them has done. A wait that was over before 1.2 s shows nothing at all. */
  function loading(onOff, reason = 'caller') {
    if (onOff) {
      if (!on() || !enabled() || calm()) return false;
      const first = reasons.size === 0;
      reasons.add(reason);
      if (first) loopTimer = setTimeout(() => { loopTimer = 0; if (reasons.size && !job) { build(); startLoop(); } }, LOOP_AFTER);
      return true;
    }
    reasons.delete(reason);
    if (reasons.size) return true;
    if (loopTimer > 0) { clearTimeout(loopTimer); loopTimer = 0; }
    loopTimer = 0;
    if (looping) stopLoop(true);
    return true;
  }

  /* One moment, by kind. Returns whether it started. */
  function go(kind) {
    if (kind && typeof kind === 'object') kind = kind.kind;
    if (!on() || !enabled() || !HAS_WAAPI || away()) return false;
    if (kind === 'loading') return loading(true, 'event');
    if (!(kind in RANK)) return false;
    if (calm() && kind !== 'done' && kind !== 'error') return false;
    if (kind !== 'error' && sheetFading()) return false;
    const now = performance.now();
    if (kind !== 'error' && now - last.at < GAP && RANK[kind] <= RANK[last.kind]) return false;  // (one run per 1.5 s)
    build();
    const wasLooping = looping;
    clear();
    last = { kind, at: now };
    if (wasLooping) loopTimer = -1;  // (the wait goes on after this one)
    return kind === 'done' || kind === 'error' ? flash(kind) : thread(kind);
  }

  function remove() {
    clear();
    reasons.clear();
    clearTimeout(loopTimer);
    loopTimer = 0;
    if (el) el.remove();
    el = null;
    delete root.dataset.edgeCorners;
  }

  document.addEventListener('visibilitychange', () => { if (document.hidden) { clear(); } });

  return {
    run: go, loading, enabled, corners, applyCorners, remove, clear,
    setEnabled(onOff) {
      store(KEY, onOff ? null : 'off');
      if (!onOff) { reasons.clear(); clear(); }
      V.emit('edge-settings', { enabled: enabled(), corners: corners() });
      return enabled();
    },
    setCorners(value) {
      store(CORNERS, value === 'square' ? 'square' : null);
      applyCorners();
      V.emit('edge-settings', { enabled: enabled(), corners: corners() });
      return corners();
    },
    /* What is on now: { kind, loop } or null; and the kinds started so far (newest last). For the tests. */
    running: () => (job ? { kind: job.kind, loop: looping } : null),
    started: () => started.slice(),
    waiting: () => [...reasons],
  };
})();
V.edge = edge;

V.on('edge', (kind) => { edge.run(kind); });

/* ================================================================== a cloud that can't be reached, and one that is back */

let troubled = false;
let troubleTimer = 0;
const told = {};
const saidCount = {};
const TELL_EVERY = 10 * 60 * 1000;
const WORDS = {
  offline: { title: 'Offline', icon: 'cloud', text: 'You\'re offline. Your notes are saved on this device and will sync when you\'re back.' },
  asleep: { title: 'Cloud asleep', icon: 'cloud', text: 'Your cloud is asleep. Everything is still there, and what you write is kept here until it wakes.' },
};
/* Said once (and not again for ten minutes), after it has lasted a moment: a wifi that blinks says nothing. */
function say(kind) {
  const words = WORDS[kind];
  if (!words || !on() || performance.now() - (told[kind] || -1e9) < TELL_EVERY) return;
  told[kind] = performance.now();
  saidCount[kind] = (saidCount[kind] || 0) + 1;
  const retry = () => { try { V.cloud.sync(); } catch (error) { /* offline still */ } };
  if (typeof V.messageCard === 'function') V.messageCard({ icon: words.icon, title: words.title, text: words.text, action: { label: 'Try again', onClick: retry }, kind: 'warn', ms: 9000 });
  else if (V.toast) V.toast(words.text, { action: 'Try again', onAction: retry, ms: 7000 });
}

V.on('status', (value) => {
  if (value !== 'syncing' && value !== 'idle') firstDone = true;
  update();
  if (!on()) return;
  const bad = value === 'offline' || value === 'held' || value === 'asleep' || value === 'error';
  if (value === 'synced' && troubled) { troubled = false; edge.run('synced'); }
  if (bad) troubled = true;
  clearTimeout(troubleTimer);
  if (value === 'offline' || value === 'asleep') troubleTimer = setTimeout(() => { if (V.cloud && V.cloud.status === value) say(value); }, 2500);
});
V.on('data', () => { if (cur) update(); });

/* ================================================================== the look switched, live */

V.on('look', () => {
  if (!on()) { uncover(true); edge.remove(); return; }
  edge.applyCorners();
  update();
});
V.on('animations', () => { if (cur) update(); });

edge.applyCorners();
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', startSplash, { once: true });
else startSplash();

V.loading = {
  judge,
  /* Frame times (ms) for a label ('splash', 'transition'); three screen changes of slow ones turn lite on (a test's way in). */
  feed,
  samples: () => ({ splash: samples.splash.flat(), transition: samples.transition.flat() }),
  /* The splash's own check: has it seen frames too slow to let the logo turn? */
  splashSlow: () => splashState.slowSeen,
  /* How many screen changes have slid in since the page opened, and how many times each cloud trouble has been said. */
  transitions: () => transitions,
  said: () => ({ ...saidCount }),
};
})();
