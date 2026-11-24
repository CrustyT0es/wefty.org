/* Wefty 2.0, ui/: Back and the layer (lane B1; LOOK-BRIEF Wave B's B1 row and 1.8's full-screen row).

   V.back: the Samsung's Back (and the browser's), Esc, the scrim, the X and a swipe back close the ONE topmost menu,
   sheet, dialog or drop-down list, and nothing under it.
     - One guard step above today's history steps: when the first thing that floats opens, a step is pushed (its state is
       a copy of the step under it, with `uiBack: { id }`), so a Back lands exactly where today's code already was and
       every existing popstate listener sees the state it saw before (they keep closing their own things: a note, the
       study screen, Settings...). Back off that step closes the topmost thing; if more stay open, a new guard is pushed.
     - Closed another way (its X, an item, the scrim, a swipe), the guard step stays where it is, dead (its id is no
       longer the live one): it is never taken back with history.back(), which runs later than the tap and would take
       back whatever the tap opened instead (a note opened from a menu). A person's Back off a dead step steps over it
       (that press goes on to what is under), and a script's history.back() from a dead step goes back two, so code
       that takes its own step back (a note's close) still lands below its step. A dead step that is still the current
       one is used again by the next thing that opens.
     - Focus goes back to what opened it (or the next thing still open), and is never left on <body>.
     - #app is inert while a sheet, a dialog or a full-screen layer is open (a menu or a drop-down list leaves it be).
     - A swipe to the right on a phone closes the topmost of them too (below: glass/swipeback.js keeps the screens).
     - A dismissal writes nothing: Back and Esc close exactly as Esc does today (how = 'escape').
     - The sheets the sign-in, sign-out and password code opens are left exactly as they were (`fenced`): no guard step,
       no inert, no focus work (LOOK-BRIEF section 4, limit 2).
   V.back.push(close, { node, kind, opener, esc }) registers something (ui/overlay.js does it for every sheet, dialog,
   menu and drop-down; a later wave's folder and class do it too) and returns { done(), close(how) }: `done()` when it
   has closed by itself. `esc` (true by default; ui/overlay.js's own builders keep their own Esc and pass false): Esc
   closes it here when it is on top. V.back.close(how) closes the topmost; V.back.top(), V.back.count() for tests.

   V.layer (1.8's full-screen row: a note, study, a class; used first by later waves, nothing moves onto it now):
     V.layer.from(el)     what a layer grows from, read now (before the tap's draw changes it): { el, box, radius }
     V.layer.open(screen, { from, label, onClose })   `screen` (an element, drawn already) shown full screen, SOLID from
                          its first frame: it grows from `from`'s box on the screen spring (translate + scale, radius 28
                          while moving), the tapped thing's own copy held over it (in #stage) and cross-faded out in 120 ms;
                          with nothing to grow from it slides in from the right over a dim. Registered with V.back (Back,
                          Esc, a swipe close it). Returns { el, close(how) }; closing runs the same move backwards in 150 ms.
   At time scale 0 (the test profile) every move here ends inside the task that began it (V.motion.later, and Web
   Animations made with no length). */
'use strict';

(() => {
const V = (window.V = window.V || {});
if (V.back && V.layer) return;
const H = window.history;
const root = document.documentElement;
const HAS_WAAPI = typeof Element !== 'undefined' && typeof Element.prototype.animate === 'function';
const P = History.prototype;
const nativeBack = () => P.back.call(H);  // (a person's Back carried on: never one of the app's own steps, js/start.js)
const nativePush = (state) => P.pushState.call(H, state, '');

const motion = () => V.motion || {};
const later = (fn, ms) => (motion().later ? motion().later(fn, ms) : (() => { const id = setTimeout(fn, ms); return { cancel() { clearTimeout(id); } }; })());
const instant = () => !!(V.look && V.look.timeScale && V.look.timeScale() === 0);
const calm = () => root.classList.contains('calm');
const token = (name) => getComputedStyle(root).getPropertyValue(name).trim();
function msOf(name, fallback) {
  const v = token(name);
  const n = parseFloat(v);
  if (!v || !Number.isFinite(n)) return fallback;
  return /ms$/.test(v) ? n : /s$/.test(v) ? n * 1000 : n;
}

/* ------------------------------------------------------------------ the history steps */

const PAGE = Math.random().toString(36).slice(2, 8);  // (a step from before a reload is never this page's live one)
let made = 0;
let liveId = null;   // the guard step that stands for what is open now (the current entry, or under one pushed over it)
let backSpent = false;  // a Back under way has already closed something (ui/overlay.js closes menus on every popstate)
let skipping = 0;    // our own steps over a guard: this listener lets their popstates by (everyone else hears them)
const guardOf = (state) => (state && state.uiBack && state.uiBack.id) || null;
const nav = () => (window.navigation && window.navigation.currentEntry ? window.navigation : null);
const indexNow = () => { const n = nav(); return n ? n.currentEntry.index : -1; };
let seen = H.state;  // the current entry's state, kept true by the wrappers below and by popstate
let seenIndex = indexNow();
const look = () => { seen = H.state; seenIndex = indexNow(); };
for (const name of ['pushState', 'replaceState']) {
  const own = H[name];
  H[name] = function tracked(...args) { const out = own.apply(H, args); look(); return out; };
}
/* A script's own step back from under a guard goes back over the guard too (a note closed by its button, its step under one). */
/* (what was there before: js/start.js's own wrappers, when it came first, count each step it takes once; when it comes
   after, it wraps these) */
const below = { back: H.back, go: H.go };
for (const name of ['back', 'go']) {
  H[name] = function stepping(...args) {
    const id = guardOf(H.state);
    const delta = name === 'back' ? -1 : Number(args[0]) || 0;
    // (a script's step back from a dead guard: it means its own step, under ours, so both go. From the live one it is
    // Back, as a person's: the topmost thing closes, and it lands where it did before.)
    if (id && id !== liveId && delta < 0) {
      skip();
      return below.go.call(H, delta - 1);
    }
    if (delta !== 0) travel();
    return below[name].apply(H, args);
  };
}

/* One of our own steps under way. A step that lands nowhere (the first entry: nothing under it) makes no popstate, so the
   count is let go after a second (a plain timer: no move waits on it, and at time scale 0 too history lands later). */
let skipTimer = 0;
function skip() {
  skipping++;
  clearTimeout(skipTimer);
  skipTimer = setTimeout(() => { skipping = 0; if (wanted) { wanted = false; prune(); if (entries.some((e) => alive(e) && e.guard)) pushGuard(); } }, 1000);
}

/* A script's own step under way (js/notes.js's picking, stopped, steps back a moment after; Settings leaving): history
   lands a task or more later, so a guard pushed meanwhile would be the step it takes back (an Export sheet opened in the
   same tap was closed so). The guard waits for it to land. */
let travelling = 0;
let travelTimer = 0;
let wanted = false;
function travel() {
  travelling++;
  clearTimeout(travelTimer);
  travelTimer = setTimeout(() => { travelling = 0; if (wanted) { wanted = false; pushGuard(); } }, 1000);
}

function pushGuard() {
  if (V.desktop) return;  // (the PC app has no Back: Esc and the X)
  if (travelling || skipping) { wanted = true; return; }
  const here = H.state;
  const id = guardOf(here);
  if (id && id === liveId) return;
  if (id) { liveId = id; return; }  // (a dead guard still current: used again)
  const mine = `${PAGE}-${++made}`;
  try { nativePush({ ...(here && typeof here === 'object' ? here : {}), uiBack: { id: mine } }); } catch (error) { return; }
  liveId = mine;
  look();
}
/* A Back under way: the guard was the current entry and no longer is, and our popstate listener hasn't run yet. */
const backUnderWay = () => !!liveId && guardOf(seen) === liveId && guardOf(H.state) !== liveId;

/* ------------------------------------------------------------------ what is open */

const entries = [];  // oldest first
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), '
  + 'textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
const TEXT = 'textarea, select, [contenteditable]:not([contenteditable="false"]), input:not([type=checkbox]):not([type=radio])'
  + ':not([type=button]):not([type=submit]):not([type=reset])';
const alive = (e) => !e.over && (!e.node || e.node.isConnected);
function prune() {
  for (let i = entries.length - 1; i >= 0; i--) if (!alive(entries[i])) { const [gone] = entries.splice(i, 1); finish(gone, false); }
}
function top() {
  for (let i = entries.length - 1; i >= 0; i--) if (alive(entries[i])) return entries[i];
  return null;
}

/* #app inert while a sheet, a dialog or a layer is open (only what this made inert is given back: Help, the tour and the
   study screen keep their own). */
let stilled = false;
const STILLS = (e) => e.kind === 'sheet' || e.kind === 'layer';
function holdApp() {
  const app = document.getElementById('app');
  if (!app || !('inert' in app)) return;
  if (entries.some((e) => alive(e) && STILLS(e))) {
    if (!app.inert) { app.inert = true; stilled = true; }
  } else if (stilled) {
    stilled = false;
    // (something of its own made it inert meanwhile: it stays so)
    if (!document.querySelector('#layers > .help-layer, #layers > .study-layer, .tour')) app.inert = false;
  }
}

const usable = (el) => !!el && el !== document.body && el.isConnected && !el.closest('[inert]') && el.getClientRects().length > 0
  && !el.closest('[data-ui="leaving"], .leaving');
function focusIn(node) {
  if (!node || !node.isConnected) return false;
  const first = node.matches(FOCUSABLE) ? node : null;
  const target = first || node;
  if (!first && !node.hasAttribute('tabindex')) node.setAttribute('tabindex', '-1');
  try { target.focus({ preventScroll: true }); } catch (error) { return false; }
  return document.activeElement === target;
}
const lost = (gone) => {
  const a = document.activeElement;
  return !a || a === document.body || a === root || !a.isConnected || !!a.closest('[inert]') || (!!gone && !!gone.node && gone.node.contains(a))
    || !!a.closest('[data-ui="leaving"]');
};
/* After something closed (in a microtask: after its own code put the focus where it wanted): the focus, if it was left
   nowhere, goes to what is still open on top, else to what opened it, else to the screen. */
function refocus(gone) {
  if (!lost(gone)) return;
  const t = top();
  if (t && t.node && focusIn(t.node)) return;
  const opener = twin(gone && gone.opener);
  if (usable(opener) && !opener.matches(TEXT)) { try { opener.focus({ preventScroll: true }); } catch (error) { /* gone */ } if (!lost(gone)) return; }
  const main = document.querySelector('#app > main.view') || document.getElementById('app');
  if (main && !main.closest('[inert]')) focusIn(main);
}

/* What opened it, or the same thing drawn again since (a screen redraws its rows: the one with its id, key or data-id). */
function twin(el) {
  if (!el || el.isConnected) return el;
  for (const name of ['id', 'data-key', 'data-id']) {
    const value = el.getAttribute && el.getAttribute(name);
    if (!value) continue;
    const found = [...document.querySelectorAll(`${el.tagName}[${name}]`)].find((other) => other.getAttribute(name) === value
      && (other.className === el.className || name === 'id'));
    if (found) return found;
  }
  return el;
}

let lastGone = null;  // the thing that closed last: a sheet opened from its row was opened by what opened it
function finish(entry, focus = true) {
  lastGone = entry;
  if (entry.finished) return;
  entry.finished = true;
  entry.over = true;
  const i = entries.indexOf(entry);
  if (i >= 0) entries.splice(i, 1);
  holdApp();
  if (backUnderWay()) backSpent = true;
  else if (!entries.some((e) => alive(e) && e.guard)) liveId = null;  // (its step stays, dead)
  if (focus) queueMicrotask(() => refocus(entry));
}

function opener() {
  const a = document.activeElement;
  return a && a !== document.body && a !== root ? a : null;
}

function push(close, opts = {}) {
  prune();
  let from = opts.opener || opener();
  // (a menu's row that opened this: the menu has gone, so what opened the menu opened this)
  if (from && lastGone && lastGone.node && lastGone.node.contains(from) && lastGone.opener) from = lastGone.opener;
  const entry = { close, node: opts.node || null, kind: opts.kind || 'sheet', opener: from, esc: opts.esc !== false,
    guard: opts.guard !== false, over: false, finished: false };
  entries.push(entry);
  if (STILLS(entry)) {
    holdApp();
    // (the focus was on #app, now inert: what opened puts it on its first box or button in the next frame, V.sheet's
    // own way; if nothing has by the frame after, the panel itself takes it, so it is never left on <body>)
    if (lost(null) && entry.node) {
      requestAnimationFrame(() => requestAnimationFrame(() => { if (alive(entry) && lost(null)) focusIn(entry.node); }));
    }
  }
  if (entry.guard) pushGuard();
  return {
    done: () => finish(entry),
    close: (how) => entry.close(how),
    setClose: (fn) => { entry.close = fn; },  // (what Back calls instead: ui/overlay.js's long menu)
    node: entry.node,
  };
}

/* The topmost thing closes (how: 'escape' for Back and Esc, so it closes exactly as Esc does; 'swipe'). */
function closeTop(how = 'escape') {
  prune();
  const t = top();
  if (!t) return false;
  try { t.close(how); } catch (error) { console.error(error); }
  if (alive(t) && !t.node) finish(t);  // (a close with nothing to watch is done once called)
  return true;
}

window.addEventListener('popstate', () => {
  const left = seen;
  const leftIndex = seenIndex;
  look();
  const again = () => {
    if (travelling || skipping || !wanted) return;
    wanted = false;
    prune();
    if (entries.some((e) => alive(e) && e.guard)) pushGuard();
  };
  if (skipping) {
    skipping--;
    if (!skipping) clearTimeout(skipTimer);
    again();
    return;
  }
  if (travelling) {
    // (a script's own step landed: not a person's Back; a guard asked for meanwhile goes on top of where it landed)
    travelling--;
    if (!travelling) clearTimeout(travelTimer);
    again();
    return;
  }
  const forward = leftIndex >= 0 && seenIndex > leftIndex;
  const id = guardOf(left);
  if (!id || forward || guardOf(seen) === id) { backSpent = false; return; }
  if (id === liveId) {
    // Back off the live guard: the one topmost thing closes (unless a menu already went on this popstate).
    liveId = null;
    if (!backSpent) closeTop('escape');
    backSpent = false;
    prune();
    if (entries.some((e) => alive(e) && e.guard)) pushGuard();
    return;
  }
  // Back off a dead guard: nothing showed (it is a copy of the step under it), so that press goes on.
  backSpent = false;
  skip();
  nativeBack();
});

/* A swipe back (a phone's finger drawn clearly to the right, 12 px and 1.5 times its up or down) on the topmost thing that
   floats closes it the way Back does: it sinks or shrinks as itself, nothing follows the finger. glass/swipeback.js keeps
   the screens (a note, a chat, Settings...); it leaves sheets and menus alone, so the two never meet. Not from text being
   typed in or picked, a slider, a sideways scroller or something that moves sideways itself (but from the left edge). */
const SWIPE = { start: 12, slant: 1.5, edge: 24 };
const SIDEWAYS = 'canvas, .viewer, .flash-card, .share-switch, .ink-stage, [data-g-sideways], input[type=range], video, audio';
let finger = null;  // { id, x0, y0, node }
const phoneNow = () => { try { return matchMedia('(max-width: 699px)').matches; } catch (error) { return false; } };
function sideways(target, stop) {
  const active = document.activeElement;
  if (active && active !== document.body && active.matches && active.matches(TEXT) && active.contains(target)) return true;
  try { const sel = getSelection(); if (sel && !sel.isCollapsed && sel.rangeCount && sel.getRangeAt(0).intersectsNode(target)) return true; } catch (error) { /* none */ }
  for (let el = target; el && el !== stop && el !== document.body; el = el.parentElement) {
    if (el.scrollWidth > el.clientWidth + 1 && /auto|scroll/.test(getComputedStyle(el).overflowX)) return true;
  }
  return false;
}
window.addEventListener('pointerdown', (event) => {
  finger = null;
  if (event.pointerType !== 'touch' || !event.isPrimary || !phoneNow()) return;
  prune();
  const t = top();
  const target = event.target && event.target.nodeType === 1 ? event.target : null;
  if (!t || !t.node || !t.guard || !target) return;
  const layer = target.closest('#layers > *');
  if (!layer || !layer.contains(t.node)) return;
  const edge = event.clientX <= SWIPE.edge;
  if (sideways(target, layer) || (!edge && target.closest(SIDEWAYS))) return;
  finger = { id: event.pointerId, x0: event.clientX, y0: event.clientY, node: t.node };
}, { capture: true, passive: true });
window.addEventListener('pointermove', (event) => {
  if (!finger || event.pointerId !== finger.id) return;
  const dx = event.clientX - finger.x0;
  const dy = event.clientY - finger.y0;
  if (dx < -6 || Math.abs(dy) > Math.max(10, dx / SWIPE.slant)) { finger = null; return; }
  if (dx < SWIPE.start || dx < Math.abs(dy) * SWIPE.slant) return;
  const was = finger;
  finger = null;
  const t = top();
  if (t && t.node === was.node) closeTop('escape');
}, { capture: true, passive: true });
for (const type of ['pointerup', 'pointercancel']) window.addEventListener(type, (event) => { if (finger && event.pointerId === finger.id) finger = null; }, true);

/* Esc for what registered here with its own Esc wanted (a layer, a later wave's screen): before the builders' own. */
window.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape' || event.defaultPrevented || event.isComposing) return;
  prune();
  const t = top();
  if (!t || !t.esc) return;
  event.stopPropagation();
  event.preventDefault();
  closeTop('escape');
}, true);

/* The sheets the sign-in, sign-out and password code opens (LOOK-BRIEF section 4, limit 2): left exactly as they were. */
const FENCED_TITLES = new Set(['Sign out?', 'Sign out and lose changes?', 'Stop listening and sign out?', 'Change password',
  'Sign out your other devices?', 'Delete my account', 'Add a phone or computer']);
const FENCED_PARTS = 'input[type=password], input[autocomplete="one-time-code"], .itsyou, .change-password, .sign-out-others, '
  + '.delete-account, .connect';
function fenced(panel) {
  const app = document.getElementById('app');
  if (app && app.classList.contains('gate')) return true;
  if (!panel) return false;
  if (FENCED_TITLES.has((panel.getAttribute('aria-label') || '').trim())) return true;
  return !!panel.querySelector(FENCED_PARTS);
}

V.back = {
  push,
  close: closeTop,
  top: () => { prune(); const t = top(); return t ? { kind: t.kind, node: t.node } : null; },
  count: () => { prune(); return entries.length; },
  fenced,
  /* (for tests: the guard step) */
  live: () => liveId,
};

/* ------------------------------------------------------------------ V.layer: a full-screen layer */

const SCREEN_IN = () => ({ easing: token('--spring-screen') || 'ease-out', duration: msOf('--d-screen', 450) });
const CROSS = 120;   // ms: the tapped thing's copy and the new screen cross-fade
const BACK_MS = 150; // ms: the way back
const FADE_LAST = 60;

function boxOf(el) {
  const r = el.getBoundingClientRect();
  return { left: r.left, top: r.top, width: r.width, height: r.height };
}
function fromOf(el) {
  if (!el || !el.isConnected || !el.getClientRects().length) return null;
  const radius = parseFloat(getComputedStyle(el).borderTopLeftRadius) || 0;
  return { el, box: boxOf(el), radius };
}
/* Where a layer the size of the window sits so that it covers `b`: translate + scale from its top left corner. */
const toBox = (b) => `translate(${b.left.toFixed(1)}px, ${b.top.toFixed(1)}px) scale(${(b.width / innerWidth).toFixed(4)}, ${(b.height / innerHeight).toFixed(4)})`;

function stage() {
  let el = document.getElementById('stage');
  if (!el) {
    el = document.createElement('div');
    el.id = 'stage';
    el.className = 'ui-stage';
    el.setAttribute('aria-hidden', 'true');
    el.inert = true;
    const layers = document.getElementById('layers') || document.body;
    layers.append(el);
  }
  return el;
}

function open(screen, { from = null, label = '', onClose = null } = {}) {
  const layers = document.getElementById('layers');
  const source = from && from.box ? from : fromOf(from);
  const el = document.createElement('div');
  el.className = 'ui-layer';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  if (label) el.setAttribute('aria-label', label);
  el.dataset.ui = 'entering';
  const body = document.createElement('div');
  body.className = 'ui-layer-screen';
  if (screen) body.append(screen);
  let scrim = null;
  if (!source) {
    scrim = document.createElement('div');
    scrim.className = 'ui-scrim ui-layer-dim';
    scrim.setAttribute('aria-hidden', 'true');
    scrim.dataset.ui = 'entering';
  }
  el.append(body);
  if (scrim) layers.append(scrim);
  layers.append(el);
  if (scrim) { void getComputedStyle(scrim).opacity; scrim.dataset.ui = 'open'; }
  let closed = false;
  let ghost = null;
  const play = (target, frames, options) => (HAS_WAAPI ? target.animate(frames, { id: 'ui-layer', ...options }) : null);
  let length = 0;
  if (calm()) {
    length = CROSS;
    play(el, [{ opacity: 0 }, { opacity: 1 }], { duration: length, easing: 'linear' });
  } else if (source) {
    const { easing, duration } = SCREEN_IN();
    length = duration;
    play(el, [{ transform: toBox(source.box), borderRadius: token('--r28') || '28px' }, { transform: 'none', borderRadius: '0px' }],
      { duration, easing });
    // (the tapped thing's own words, held where it was, cross-fading into the new screen's first screenful)
    if (!instant() && source.el && source.el.isConnected && typeof source.el.cloneNode === 'function') {
      ghost = source.el.cloneNode(true);
      ghost.removeAttribute('id');
      ghost.classList.add('ui-ghost');
      Object.assign(ghost.style, { left: `${source.box.left}px`, top: `${source.box.top}px`, width: `${source.box.width}px`,
        height: `${source.box.height}px` });
      stage().append(ghost);
      play(ghost, [{ opacity: 1 }, { opacity: 0 }], { duration: CROSS, easing: 'linear', fill: 'forwards' });
      play(body, [{ opacity: 0 }, { opacity: 1 }], { duration: CROSS, easing: 'linear' });
      const g = ghost;
      later(() => g.remove(), CROSS);
    }
  } else {
    const { easing, duration } = SCREEN_IN();
    length = duration;
    play(el, [{ transform: 'translateX(100%)' }, { transform: 'none' }], { duration, easing });
  }
  later(() => { if (!closed) el.dataset.ui = 'open'; }, length);
  const close = (how = '') => {
    if (closed) return;
    closed = true;
    if (back) back.done();
    if (ghost) ghost.remove();
    el.dataset.ui = 'leaving';
    const ms = calm() ? CROSS : BACK_MS;
    let move = null;
    if (calm()) move = play(el, [{ opacity: 1 }, { opacity: 0 }], { duration: ms, easing: 'linear', fill: 'forwards' });
    else {
      const to = source && source.el && source.el.isConnected && source.el.getClientRects().length ? boxOf(source.el) : null;
      move = play(el, [{ transform: 'none', borderRadius: '0px' }, to ? { transform: toBox(to), borderRadius: token('--r28') || '28px' }
        : { transform: 'translateX(100%)' }], { duration: ms, easing: token('--ease-in') || 'ease-in', fill: 'forwards' });
      if (to) play(el, [{ opacity: 1 }, { opacity: 0 }], { duration: FADE_LAST, delay: ms - FADE_LAST, easing: 'linear', fill: 'forwards' });
    }
    if (scrim) scrim.dataset.ui = 'leaving';
    const gone = () => { el.remove(); if (scrim) scrim.remove(); };
    if (!move || instant()) later(gone, ms);
    else { let ran = false; const once = () => { if (!ran) { ran = true; gone(); } }; move.finished.then(once, once); later(once, ms * 2 + 120); }
    if (onClose) { try { onClose(how); } catch (error) { console.error(error); } }
  };
  const back = push((how) => close(how), { node: el, kind: 'layer', opener: source ? source.el : null });
  const active = document.activeElement;
  if (!active || active === el || !el.contains(active)) focusIn(el.querySelector(FOCUSABLE) || el);
  return { el, close };
}

V.layer = { open, from: fromOf };

})();
