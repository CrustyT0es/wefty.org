/* Wefty 2.0, ui/: everything that floats (lane A2, "overlays"; LOOK-BRIEF 1.1 law 1, 1.2's SOLID, 1.6 and 1.8's sheet,
   menu, dialog and toast rows, 2.1 "everything that floats").

   js/util.js's seven builders (V.sheet, V.menu, V.confirm, V.ask, V.toast, V.notice, V.contextMenu) still build the
   nodes they always built, with the same signatures and return values; they hand their opening, placing, leaving and
   removal to V.overlay, here. One path for what opens and leaves:
     - A panel (a sheet, a dialog, a menu) is SOLID from its first frame: its opacity never moves, but in the last 60 ms
       of leaving. Only its scrim fades: one node, `.ui-scrim`, the first child of a sheet's `.layer` (the layer itself
       no longer paints or fades), and the phone's status bar follows it (V.theme.scrim).
     - The panel and its scrim carry data-ui="entering" | "open" | "leaving" (frozen: ui/README.txt). The REAL node
       leaves, never a copy, and this file owns both the leave and the removal, through V.motion.later: at time scale 0
       (the test profile) the node is gone inside the task that closed it.
     - A sheet rises on today's .433 s spring (--spring-sheet) at opacity 1, follows a finger 1:1 from its grabber, its
       title, or its body while the body is at its top, can be caught mid-way, and sinks as itself (X, Cancel, the
       scrim, Esc, a flick: whatever closes it today; nothing new closes one). From 700 px it is a dialog: it grows from
       what asked (.92 to 1) and shrinks back in 140 ms.
     - A menu grows from its button's box (.86 to 1 on the tap spring) through one placer, between the screen's head and
       what the foot claims, inside the screen, and shrinks into its button in 140 ms; the thing it belongs to lifts
       (V.motion.lift). On a phone a menu holds at most 5 rows: a longer one is one sheet (the long sheet) with its
       danger row (Move to Trash) pinned in its foot and the reading switches as one "Reading" row opening in place.
     - A drop-down (a <select>) opens Wefty's own list; inside a phone's sheet the field opens its list in place (never
       a sheet on a sheet). Esc closes only the topmost thing (`stack`).
     - A toast is solid, wraps and grows upward to four lines (never cut), sits 8 px above what the foot claims (above an
       open sheet's buttons) and keeps that place until the toasts are gone; two at most: a toast with an action is never
       replaced before its time (a second stacks above it, a third waits its turn); the same words again are one toast;
       a tap on its body closes it; it sinks and fades in 160 ms. Its node stays in #toasts.
   Moves use the tokens' curves (as before / new, lite, calm) read from the page, so the value sets switch them. */
'use strict';

(() => {
const V = (window.V = window.V || {});
const root = document.documentElement;
const HAS_WAAPI = typeof Element !== 'undefined' && typeof Element.prototype.animate === 'function';
const ID = 'ui-overlay';  // every move of this file is named so (a test or a film tells them from a screen's own)

/* ------------------------------------------------------------------ small things */

const motion = () => V.motion || {};
const D = () => motion().D || { press: 90, fade: 120, exit: 160, swap: 180, enter: 240, stagger: 40 };
// (the one timer: at time scale 0 it runs at once, in the same task)
const later = (fn, ms) => (motion().later ? motion().later(fn, ms) : (() => { const id = setTimeout(fn, ms); return { cancel() { clearTimeout(id); } }; })());
const calm = () => root.classList.contains('calm');
const lite = () => root.classList.contains('lite');
const media = (q) => { try { return window.matchMedia(q).matches; } catch (error) { return false; } };
const phone = () => media('(max-width: 699px)');
const coarse = () => media('(pointer: coarse)');
const clamp = (n, low, high) => Math.min(high, Math.max(low, n));
const shows = (el) => !!el && !el.hidden && el.getClientRects().length > 0;
/* The page's own px per screen px (bigger text: the page zoomed). */
const zoomOf = (el) => { const z = el && el.offsetWidth ? el.getBoundingClientRect().width / el.offsetWidth : 1; return Number.isFinite(z) && z > 0 ? z : 1; };
const box = (el, z = 1) => { const r = el.getBoundingClientRect(); return { left: r.left / z, right: r.right / z, top: r.top / z, bottom: r.bottom / z, width: r.width / z, height: r.height / z }; };

/* A token of ui/tokens.css as the page has it now (lite, calm and the two value sets change them). */
const token = (name) => getComputedStyle(root).getPropertyValue(name).trim();
function msOf(name, fallback) {
  const v = token(name);
  const n = parseFloat(v);
  if (!v || !Number.isFinite(n)) return fallback;
  return /ms$/.test(v) ? n : /s$/.test(v) ? n * 1000 : n;
}
/* A spring or curve by its token names: { easing, duration }. */
const curve = (easing, duration, fallback) => ({ easing: token(easing) || 'ease-out', duration: msOf(duration, fallback) });
const tap = () => curve('--spring-tap', '--d-tap', 320);
const settle = () => curve('--spring-settle', '--d-settle', 320);
const sheetIn = () => (lite() ? curve('--spring-pill', '--d-pill', 300) : curve('--spring-sheet', '--d-sheet', 433));
const sheetOut = () => curve('--ease-sheet-out', '--d-sheet-out', 170);
const shrinkOut = () => ({ easing: token('--ease-in') || 'ease-in', duration: msOf('--d-menu-out', 140) });
const scrimIn = () => msOf('--d-scrim-in', 240);
const scrimOut = () => msOf('--d-scrim-out', 170);
const FADE_LAST = 60;  // ms: the only fade a panel has, at the end of its leave (law 1)

/* One running move per element and job: a new one cancels the old. */
const jobs = new WeakMap();
function play(el, frames, options, job = 'move') {
  if (!el || !HAS_WAAPI) return null;
  const mine = jobs.get(el) || {};
  jobs.set(el, mine);
  if (mine[job]) { try { mine[job].cancel(); } catch (error) { /* gone */ } }
  let animation = null;
  try { animation = el.animate(frames, { id: ID, ...options }); } catch (error) { return null; }
  mine[job] = animation;
  animation.finished.then(() => { if (mine[job] === animation) delete mine[job]; }, () => {});
  return animation;
}
function stop(el, job) {
  const mine = el && jobs.get(el);
  if (!mine) return;
  for (const key of job ? [job] : Object.keys(mine)) {
    if (mine[key]) { try { mine[key].cancel(); } catch (error) { /* gone */ } delete mine[key]; }
  }
}
/* Where `el` is now on the y axis (a move under way included) and its scale. */
function now(el) {
  try {
    const m = new DOMMatrixReadOnly(getComputedStyle(el).transform);
    return { y: m.m42, x: m.m41, scale: Math.hypot(m.a, m.b) || 1 };
  } catch (error) { return { y: 0, x: 0, scale: 1 }; }
}
const state = (el, value) => { if (el && el.dataset.ui !== value) el.dataset.ui = value; };
/* What a leave does once its move has played (the node taken away): when the move itself has finished, so its last
   frames are always shown (a move begins at the next frame, and a timer of the same length took a sheet away with its
   head still in sight, a menu at nine tenths of itself); `ms` later still, at most, as a backstop (a hidden tab draws no
   frames); at time scale 0 at once, inside the task that began it (later()'s rule). */
/* A panel's one fade: the last FADE_LAST ms of its leave, in time (linear, its own move), whatever curve the move has. In
   the move's own keyframes a fast-ending curve squeezed it into one frame: a menu went from nine tenths to nothing. */
function fadeLast(el, length) {
  return play(el, [{ opacity: 1 }, { opacity: 0 }], { duration: Math.min(FADE_LAST, length), delay: Math.max(0, length - FADE_LAST),
    easing: 'linear', fill: 'forwards' }, 'fade');
}
function afterMove(animation, ms, fn) {
  let ran = false;
  const once = () => { if (!ran) { ran = true; fn(); } };
  const scale = V.look && V.look.timeScale ? V.look.timeScale() : 1;
  if (!animation || scale === 0 || animation.playState === 'finished') { later(once, ms); return; }
  animation.finished.then(once, once);
  later(once, ms * 2 + 120);
}

/* ------------------------------------------------------------------ the stack: Esc closes only the topmost */

const stack = [];  // { node, close(how), back }, oldest first
/* (lane B1) Each one is registered with V.back too (ui/nav.js: Back, a swipe and the focus going home), keeping its own
   Esc here; the sheets the sign-in, sign-out and password code opens never are (V.back.fenced). */
function push(node, close, kind = 'sheet') {
  const entry = { node, close, back: null };
  stack.push(entry);
  const B = V.back;
  if (B && B.push && !(kind === 'sheet' && B.fenced && B.fenced(node))) {
    try { entry.back = B.push((how) => entry.close(how), { node, kind, esc: false,
      opener: document.activeElement && document.activeElement !== document.body ? null : asker() }); } catch (error) { console.error(error); }
  }
  return entry;
}
function drop(entry) {
  const i = stack.indexOf(entry);
  if (i >= 0) stack.splice(i, 1);
  if (entry && entry.back) { const back = entry.back; entry.back = null; try { back.done(); } catch (error) { console.error(error); } }
}
/* Whether `node` is the topmost open overlay (a sheet, a menu, an open drop-down list). */
function isTop(node) {
  for (let i = stack.length - 1; i >= 0; i--) {
    if (!stack[i].node.isConnected) { stack.splice(i, 1); continue; }
    return stack[i].node === node;
  }
  return true;
}

/* ------------------------------------------------------------------ what asked (a dialog grows from it) */

let pressed = null;  // { el, at }: the last thing a pointer went down on
document.addEventListener('pointerdown', (event) => {
  if (event.target && event.target.nodeType === 1) pressed = { el: event.target, at: performance.now() };
}, { capture: true, passive: true });
function asker() {
  const el = pressed && performance.now() - pressed.at < 1500 && pressed.el.isConnected ? pressed.el : document.activeElement;
  if (!el || el === document.body || el === root || !el.getClientRects || !el.getClientRects().length) return null;
  return el.closest('button, a, [role=button], [role=menuitem], input, select, .card, li') || el;
}

/* ------------------------------------------------------------------ a tap that came too soon */

/* What has just come up takes no tap in its first EARLY_MS (the critic's double tap on the +: the second tap, 100 ms in,
   landed on a row of the rising sheet and opened a Checklist note; the Snap row, the camera, was in reach too). A sheet,
   a dialog, a menu, the note and the study screen: the layer carries data-ui-early (overlay.css: nothing in it is hit,
   so no row lights either) and a pointer's press, release and click on it then do nothing at all; it never closes
   either, and nothing under it is reached. What has just begun to leave keeps its place deaf for as long (its panel's
   box as it began to go): the second tap of a double tap on a sheet's X or a menu's row lands on nothing, never on the
   page under it (the same critic: Upcoming opened under a closed sheet). The keyboard is never held back (Enter,
   Space, Esc: a click with no pointer is a key's), nor a script's own click, nor anything at time scale 0. */
const EARLY_MS = 250;
const EARLY_LAYERS = '.layer, .editor-layer, .nt-layer';  // (what #layers takes that is early: never the strip or a tip)
const CATCH = '.sheet > .g-grab, .sheet > .sheet-head';
const deadZones = [];  // { left, top, right, bottom, until }: where something began to leave
const instant = () => (V.look && V.look.timeScale ? V.look.timeScale() === 0 : false);
function early(layer) {
  if (!layer || instant() || layer.hasAttribute('data-ui-early')) return;
  layer.setAttribute('data-ui-early', '');
  later(() => layer.removeAttribute('data-ui-early'), EARLY_MS);
}
function deafWhere(panel) {
  if (!panel || instant() || !panel.getClientRects().length) return;
  const r = panel.getBoundingClientRect();
  const until = performance.now() + EARLY_MS;
  deadZones.push({ left: r.left, top: r.top, right: r.right, bottom: r.bottom, until });
}
function tooSoon(event) {
  if (!event.isTrusted || (event.type === 'click' && event.detail === 0) || instant()) return false;
  const target = event.target;
  if (target && target.nodeType === 1 && target.closest('#layers > [data-ui-early]')) {
    // (a finger may still catch a sheet by its grabber or title as it rises: the pull's own pointer events go through,
    // never a click, and never on a button there, the X)
    return !(/^pointer/.test(event.type) && target.closest(CATCH) && !target.closest('button'));
  }
  const t = performance.now();
  for (let i = deadZones.length - 1; i >= 0; i--) if (deadZones[i].until <= t) deadZones.splice(i, 1);
  if (!deadZones.length || typeof event.clientX !== 'number') return false;
  const { clientX: x, clientY: y } = event;
  return deadZones.some((z) => x >= z.left && x <= z.right && y >= z.top && y <= z.bottom);
}
for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click', 'dblclick', 'contextmenu']) {
  window.addEventListener(type, (event) => {
    if (!tooSoon(event)) return;
    event.stopImmediatePropagation();
    if (event.cancelable) event.preventDefault();
  }, { capture: true });
}

/* ------------------------------------------------------------------ the scrim */

/* The scrim of a sheet's layer: made and faded in (the status bar following it), and faded out as it leaves. */
function scrimFor(wrap) {
  const scrim = document.createElement('div');
  scrim.className = 'ui-scrim';
  scrim.setAttribute('aria-hidden', 'true');
  state(scrim, 'entering');
  wrap.prepend(scrim);
  void getComputedStyle(scrim).opacity;  // (its first frame at 0, so the kit's transition plays)
  state(scrim, 'open');
  if (V.theme && V.theme.scrim) { try { V.theme.scrim(true, scrimIn()); } catch (error) { console.error(error); } }
  return scrim;
}
function scrimGoes(scrim, ms = scrimOut()) {
  if (!scrim || scrim.dataset.ui === 'leaving') return;
  // (a dialog's scrim goes with the dialog, in its 140 ms: the panel's last-60-ms fade then ends as it is taken away)
  if (ms !== scrimOut()) scrim.style.transitionDuration = `${ms}ms`;
  state(scrim, 'leaving');
  if (V.theme && V.theme.scrim) { try { V.theme.scrim(false, ms); } catch (error) { console.error(error); } }
}

/* ------------------------------------------------------------------ sheets and dialogs */

const sheets = new WeakMap();  // panel -> its controller
const FILLER = 12;  // px: a phone's sheet carries a filler of its own colour under it (the kit's), so it sinks past it

/* V.sheet hands its layer (`wrap`, the .layer) and panel (`.sheet`) here once they are on the page. `close(how)` is
   V.sheet's own close (what a flick or a press on the scrim calls); `dismissable` false: nothing but its own buttons
   close it. Returns { leave(how) }, which V.sheet's close calls. */
function sheet(wrap, panel, { close, dismissable = true } = {}) {
  wrap.classList.add('ui-host');
  const scrim = scrimFor(wrap);
  state(panel, 'entering');
  wrap.classList.add('shown');
  // (the handle a finger pulls: pinned as .layer .g-grab)
  if (!panel.querySelector(':scope > .g-grab')) {
    const grab = document.createElement('div');
    grab.className = 'g-grab';
    grab.setAttribute('aria-hidden', 'true');
    panel.prepend(grab);
  }
  const ctl = { wrap, panel, scrim, close, dismissable, leaving: false, flick: null, entry: null, opened: null };
  sheets.set(panel, ctl);
  ctl.entry = push(panel, (how) => close(how), 'sheet');
  // Its entrance: a phone's sheet rises from below the screen at opacity 1; a dialog grows from what asked.
  let length = 0;
  if (!calm()) {
    if (phone()) {
      const from = panel.offsetHeight + FILLER + 8;
      const { easing, duration } = sheetIn();
      length = duration;
      play(panel, [{ transform: `translateY(${from}px)` }, { transform: 'translateY(0px)' }], { duration, easing }, 'move');
    } else {
      originAt(panel, asker());
      const { easing, duration } = tap();
      length = duration;
      play(panel, [{ transform: 'scale(.92)' }, { transform: 'scale(1)' }], { duration, easing }, 'move');
    }
  }
  ctl.opened = later(() => { if (!ctl.leaving) state(panel, 'open'); }, Math.max(length, scrimIn()));
  // The rows inside rise in with it, a little one after the other (a sheet whose content is one wrapper holding the rows
  // rises row by row too): from its first frame, 40 ms apart, the fifth and later together, so its body is never empty.
  // (They began 90 ms late, 40 apart up to the eighth: the critics saw a dialog's lower rows blank until about 600 ms,
  // TS-08, and a phone's sheet arrive with nothing under its title.)
  const body = panel.querySelector(':scope > .sheet-body');
  if (body && motion().enter) {
    const only = body.children.length === 1 ? body.firstElementChild : null;
    const rows = only && only.tagName === 'DIV' && !only.className && only.children.length > 1 ? only : body;
    try { motion().enter(rows, { stagger: D().stagger, max: 5, delay: 0 }); } catch (error) { console.error(error); }
  }
  pull(ctl);
  return { leave: (how) => leaveSheet(ctl, how) };
}

/* A dialog grows from (and shrinks back to) what asked: its transform origin is that thing's middle, held inside it. */
function originAt(panel, from) {
  if (!from) { panel.style.transformOrigin = ''; return; }
  const z = zoomOf(panel);
  const p = box(panel, z);
  const a = box(from, z);
  const x = clamp(a.left + a.width / 2 - p.left, 0, p.width);
  const y = clamp(a.top + a.height / 2 - p.top, 0, p.height);
  panel.style.transformOrigin = `${x.toFixed(1)}px ${y.toFixed(1)}px`;
}

/* The sheet goes, as itself, from wherever it is now (risen, rising, or under a finger): a phone's sinks, a dialog
   shrinks back, calm fades; then the layer is taken away. */
function leaveSheet(ctl, how = '') {
  if (ctl.leaving) return;
  ctl.leaving = true;
  const { wrap, panel, scrim } = ctl;
  drop(ctl.entry);
  if (ctl.opened) ctl.opened.cancel();
  if (ctl.endDrag) ctl.endDrag();
  deafWhere(panel);
  state(panel, 'leaving');
  wrap.classList.add('leaving');
  const at = now(panel);
  stop(panel);
  if (motion().spring) { try { panel.getAnimations().forEach((a) => a.cancel()); } catch (error) { /* gone */ } }
  panel.classList.remove('g-dragging');
  panel.style.transition = '';
  panel.style.willChange = '';
  let length;
  let move = null;
  const fadeAt = (ms) => Math.max(0, (ms - FADE_LAST) / ms);
  if (calm()) {
    // (calm: no travel; it stays where it is and fades in its last 60 ms)
    length = D().fade;
    const where = at.y ? `translateY(${at.y.toFixed(1)}px)` : 'none';
    move = play(panel, [{ transform: where, opacity: 1 }, { transform: where, opacity: 1, offset: fadeAt(length) }, { transform: where, opacity: 0 }],
      { duration: length, fill: 'forwards' }, 'move');
  } else if (phone()) {
    const to = panel.offsetHeight + FILLER + 8;
    const flick = how === 'flick' && ctl.flick ? ctl.flick : null;
    let easing;
    if (flick) {
      // (a flick goes at least as fast as the finger was going: today's feel, kept)
      length = Math.max(110, Math.min(170, (to - at.y) / Math.max(flick.speed, 1.2)));
      easing = 'cubic-bezier(.25,.6,.45,1)';
    } else ({ easing, duration: length } = sheetOut());
    move = play(panel, [{ transform: `translateY(${at.y.toFixed(1)}px)` }, { transform: `translateY(${to}px)` }],
      { duration: length, easing, fill: 'forwards' }, 'move');
  } else {
    // (back towards what asked it: the origin it grew from is kept)
    const { easing, duration } = shrinkOut();
    length = duration;
    move = play(panel, [{ transform: `scale(${at.scale.toFixed(3)})` }, { transform: 'scale(.92)' }], { duration: length, easing, fill: 'forwards' }, 'move');
    fadeLast(panel, length);
  }
  panel.style.transform = '';
  // (a phone's sheet is out of sight before its scrim has gone; a dialog and its scrim end together)
  const scrimMs = phone() && !calm() ? scrimOut() : length;
  scrimGoes(scrim, scrimMs);
  // (taken away once its own move has played, never by a clock that runs ahead of it; the scrim's longer fade kept)
  afterMove(move, length, () => later(() => wrap.remove(), Math.max(0, scrimMs - length)));
}

/* A phone's sheet goes with the finger: from its grabber or its title row, or from its body while the body is at its
   top (a finger moving up there still scrolls it; not a sheet that asks for a password or a code). A long pull, or a quick flick, closes it; anything less springs it
   back. One that can't be dismissed only springs back. Today's pull, kept exactly: one to one down, a band up past its
   open place, a flick past .45 px a ms, a pull past a third (150 px at most). */
function pull(ctl) {
  const { panel } = ctl;
  const grab = panel.querySelector(':scope > .g-grab');
  const head = panel.querySelector(':scope > .sheet-head');
  // (the body too, but never a sheet that asks for a password or a code: the sign-in, sign-out and password sheets close
  // exactly the ways they did, by their grabber and title, so nothing new can close one while it checks who it is)
  const own = panel.querySelector(':scope > .sheet-body');
  const body = own && !own.querySelector('input[type=password], input[autocomplete="one-time-code"], .itsyou') ? own : null;
  let g = null;
  let swallow = null;
  const settleBack = () => {
    panel.classList.remove('g-dragging');
    panel.style.transition = ''; panel.style.transform = ''; panel.style.willChange = '';
  };
  // (the body's own touch: at its top a finger going down is the sheet's, going up scrolls it: touch-action pan-down)
  const bodyTouch = () => {
    if (!body) return;
    const want = body.scrollTop <= 0 ? 'pan-down' : '';
    if (body.style.touchAction !== want) body.style.touchAction = want;
  };
  if (body) { bodyTouch(); body.addEventListener('scroll', bodyTouch, { passive: true }); }
  const TEXT = 'input:not([type=checkbox]):not([type=radio]), textarea, select, [contenteditable]:not([contenteditable="false"])';
  const down = (event, fromBody) => {
    if (g || ctl.leaving || !phone() || (event.pointerType === 'mouse' && event.button > 0)) return;
    if (fromBody && (event.pointerType === 'mouse' || body.scrollTop > 0 || (event.target.closest && event.target.closest(TEXT)))) return;
    g = { id: event.pointerId, x: event.clientX, y: event.clientY, mode: 'wait', base: 0, at: 0, from: 0, last: [], fromBody, el: event.currentTarget };
  };
  const move = (event) => {
    if (!g || event.pointerId !== g.id) return;
    const dx = event.clientX - g.x, dy = event.clientY - g.y;
    if (g.mode === 'wait') {
      if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return;
      if (Math.abs(dx) > Math.abs(dy) || (g.fromBody && (dy < 0 || body.scrollTop > 0))) { g.mode = 'none'; return; }
      g.mode = 'drag';
      try { g.el.setPointerCapture(event.pointerId); } catch (error) { /* fine without */ }
      // Taken from wherever it is now: still rising, or springing back from the last pull. Never from its open place,
      // so it never jumps under the finger.
      const at = now(panel).y;
      stop(panel);
      try { panel.getAnimations().forEach((a) => { if (a.id === ID || !a.id) a.cancel(); }); } catch (error) { /* gone */ }
      panel.classList.add('g-dragging');
      panel.style.transition = 'none';
      panel.style.willChange = 'transform';
      panel.style.transform = `translateY(${at.toFixed(1)}px)`;
      g.base = Math.abs(at) < 1 ? 0 : at - dy;  // (at rest: one to one from where the finger went down)
      g.from = Math.max(0, at);
    }
    if (g.mode !== 'drag') return;
    // down: with the finger, one to one; up past where it is open: held by a band, less and less
    const raw = g.base + dy;
    const rubber = motion().rubber;
    const y = raw >= 0 ? raw : -(rubber ? rubber(-raw, 70) : Math.min(14, Math.sqrt(-raw) * 2.2));
    g.at = y;
    panel.style.transform = `translateY(${y.toFixed(1)}px)`;
    g.last.push([performance.now(), raw]);
    if (g.last.length > 6) g.last.shift();
  };
  const back = (speed) => {
    if (motion().spring && !calm()) {
      motion().spring(panel, { from: now(panel).y, to: 0, velocity: speed, onDone: settleBack });
      return;
    }
    // (calm: back in a short glide, as before)
    panel.style.transition = `transform ${D().fade}ms ease-out`;
    panel.style.transform = 'translateY(0px)';
    later(settleBack, D().fade + 20);
  };
  const end = (event, cancelled) => {
    if (!g || (event && event.pointerId !== g.id)) return;
    const was = g;
    g = null;
    if (was.mode !== 'drag') return;
    // (the click that ends a drag is not a tap)
    const dropSwallow = () => { window.removeEventListener('click', swallow, true); swallow = null; };
    if (swallow) dropSwallow();
    swallow = (ev) => { ev.stopPropagation(); ev.preventDefault(); dropSwallow(); };
    window.addEventListener('click', swallow, true);
    setTimeout(() => { if (swallow) dropSwallow(); }, 350);
    const first = was.last[0], last = was.last[was.last.length - 1];
    // (px per ms; a finger held still before it lifts has none left)
    const still = !last || performance.now() - last[0] > 90;
    const speed = !still && first && last[0] > first[0] ? (last[1] - first[1]) / (last[0] - first[0]) : 0;
    const far = Math.min(150, panel.offsetHeight * 0.3);
    const pulled = was.at - was.from;  // (caught on its way up and let go: it carries on up unless it was pulled down)
    // A flick down (however short), or a pull past a third: it goes, at least as fast as the finger was going. Else it
    // springs back from where it is, with the finger's speed.
    if (!cancelled && ctl.dismissable && ((was.at > far && pulled > 24) || (speed > 0.45 && was.at > 20 && pulled > 0))) {
      ctl.flick = { speed: Math.max(0, speed) };
      ctl.close('flick');
      return;
    }
    back(cancelled ? 0 : speed);
  };
  ctl.endDrag = () => { g = null; };
  const handles = [grab, head].filter(Boolean);
  for (const handle of handles) {
    handle.addEventListener('pointerdown', (event) => down(event, false));
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', (event) => end(event, false));
    handle.addEventListener('pointercancel', (event) => end(event, true));
  }
  if (body) {
    body.addEventListener('pointerdown', (event) => { if (event.pointerType !== 'mouse') down(event, true); });
    body.addEventListener('pointermove', move);
    body.addEventListener('pointerup', (event) => end(event, false));
    body.addEventListener('pointercancel', (event) => end(event, true));
  }
}

/* Tab stays inside the open sheet (a dialog must not let the keyboard wander into the page behind it). The topmost
   sheet; a menu above it, or a layer that traps the keyboard itself (Help), is left to do its own. */
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
document.addEventListener('keydown', (event) => {
  if (event.key !== 'Tab' || event.defaultPrevented || event.ctrlKey || event.altKey || event.metaKey) return;
  const layers = document.querySelectorAll('#layers > .layer:not(.leaving)');
  const top = layers[layers.length - 1];
  if (!top || top.classList.contains('menu-layer')) return;
  const panel = top.querySelector(':scope > .sheet');
  if (!panel) return;
  const items = [...panel.querySelectorAll(FOCUSABLE)].filter((el) => el.getClientRects().length && !el.closest('[inert]'));
  if (!items.length) return;
  const at = items.indexOf(document.activeElement);
  if (!panel.contains(document.activeElement)) { event.preventDefault(); items[event.shiftKey ? items.length - 1 : 0].focus(); return; }
  if (event.shiftKey && at <= 0) { event.preventDefault(); items[items.length - 1].focus(); }
  else if (!event.shiftKey && at === items.length - 1) { event.preventDefault(); items[0].focus(); }
});

/* ------------------------------------------------------------------ the one placer */

/* What the foot of the screen claims, as the top edge of the highest thing there (page px): the tab bar on a phone, a
   full-screen note's tools and the question it asks over them, Chat's typing box, a study screen's answers. null: none. */
const FOOT = ['#app > nav.tabs', '.editor-layer.shown:not(.g-leaving) .editor-tools', '.editor-layer.shown:not(.g-leaving) .editor-ask .ask-card',
  '.chat-composer > :not([hidden])', '.layer.study-layer:not(.leaving) .study-foot', '.layer.study-layer:not(.leaving) .study-answers',
  // (Notes' pick bar, ui/dock.js's 'pick': since it covers the dock whole on a phone, a toast's place over the dock lay
  // on its top row, the X, "1 picked" and Pick all: critic 2's must-fix 3)
  '.pick-bar'];
/* How far down a thing is drawn from where it rests (screen px): the translate and transform of it and of what holds it. */
function moved(el) {
  let dy = 0;
  for (let e = el; e && e !== document.body && e !== root; e = e.parentElement) {
    const cs = getComputedStyle(e);
    if (cs.translate && cs.translate !== 'none') dy += parseFloat(cs.translate.split(/\s+/)[1]) || 0;
    if (cs.transform && cs.transform !== 'none') { try { dy += new DOMMatrixReadOnly(cs.transform).m42; } catch (error) { /* none */ } }
  }
  return dy;
}
function footTop(z, below = -Infinity) {
  const H = innerHeight / z;
  let top = null;
  for (const el of document.querySelectorAll(FOOT.join(', '))) {
    if (!shows(el)) continue;
    const r = box(el, z);
    // (where it rests, not where a move has it now: a note's question rises 10 px into its place as it comes, and a
    // toast slotted in that task sat 2 px over it for the rest of the run)
    const lift = moved(el) / z;
    r.top -= lift; r.bottom -= lift;
    // (only what sits at the foot: a bar across the lower part of the screen, not a rail down its side)
    if (r.top < H * 0.45 || r.height > H * 0.5 || r.width < 120 || r.bottom < below) continue;
    if (top === null || r.top < top) top = r.top;
  }
  return top;
}
/* The rail of a wide screen (its left edge holds the tabs): its right edge, page px, or null. */
function railRight(z) {
  const rail = document.querySelector('#app > nav.tabs');
  if (!shows(rail)) return null;
  const r = box(rail, z);
  return r.left <= 1 && r.height > (innerHeight / z) * 0.6 && r.width < 160 ? r.right : null;
}
const HEADS = '.editor-bar, .app-head, .chat-head, .page-head, .list-title, .study-top';
function headBottom(anchor, z) {
  const screen = anchor && anchor.closest && (anchor.closest('.editor') || anchor.closest('main.view') || anchor.closest('#layers > .layer'));
  if (!screen) return null;
  // (the head over this anchor: shown, above it, across its column. A screen holds hidden heads too, Chat's list head
  // on a phone while a chat is open, and wide screens a head a column: the first one found isn't always its own)
  const a = box(anchor, z);
  let bottom = null;
  for (const head of screen.querySelectorAll(HEADS)) {
    if (!shows(head) || head.contains(anchor)) continue;
    const h = box(head, z);
    if (a.top < h.bottom - 1 || h.right <= a.left || h.left >= a.right) continue;
    if (bottom === null || h.bottom > bottom) bottom = h.bottom;
  }
  return bottom;
}

/* Where a menu goes: from its button (or the point it was opened at), between the screen's head and what its foot
   claims, inside the screen, never over the rail's tabs; at most 440 px tall on a wide screen. `opts`: V.menu's
   (at, align). Returns 'above' | 'below' | 'point' | 'strip' (how to put it back when the screen changes size). */
function placeMenu(list, anchor, opts = {}) {
  const z = zoomOf(list);
  const W = innerWidth / z, H = innerHeight / z;
  if (anchor && !opts.at && anchor.closest && anchor.closest('.editor-tools') && list.classList.contains('tools-more-menu')) return placeTray(list, anchor, z);
  const a = anchor && anchor.getBoundingClientRect ? box(anchor, z) : { left: 0, right: 0, top: 0, bottom: 0, width: 0, height: 0 };
  const whole = anchor === document.body || anchor === root || !anchor;
  let lo = 8, hi = H - 8, left = 8;
  const right = W - 8;
  // (a sheet covers the foot: what opens from inside one may use the screen down to its edge)
  if (!whole && !(anchor.closest && anchor.closest('#layers .sheet'))) {
    const head = headBottom(anchor, z);
    if (head !== null) lo = Math.max(lo, head + 8);
    const foot = footTop(z, a.bottom - 1);
    if (foot !== null && a.bottom <= foot + 1) hi = Math.min(hi, foot - 8);
  }
  const rail = railRight(z);
  const inRail = rail !== null && anchor && anchor.closest && !!anchor.closest('#app > nav.tabs');
  if (rail !== null) left = Math.max(left, rail + 8);
  if (opts.at) { lo = 8; hi = H - 8; }
  const most = W >= 700 ? 440 : Infinity;
  list.style.maxHeight = `${Math.max(120, Math.min(most, hi - lo))}px`;
  cutUnderWords(list);
  const width = list.offsetWidth;
  let height = list.offsetHeight;
  const fitX = (x) => clamp(x, left, Math.max(left, right - width));
  let x, y, how;
  const over = overRows.get(list);
  if (over && over.isConnected && !opts.at && height <= hi - lo) {
    // A drop-down inside a phone's sheet opens in place: the field becomes its list, the option in use lying where the
    // field was (its words where they were), the others above and below it, held inside the screen.
    x = fitX(a.left);
    y = a.top + (a.height - over.offsetHeight) / 2 - over.offsetTop;
    list.style.left = `${x}px`;
    list.style.top = `${clamp(y, lo, Math.max(lo, hi - height))}px`;
    stillEdge(list);
    return 'over';
  }
  if (opts.at) {
    // At a point: from there down and right, else turned to fit (left of it, above it). A finger's: above the finger.
    const px = opts.at.x / z, py = opts.at.y / z;
    x = opts.at.touch ? fitX(px - width / 2) : fitX(px + width + 8 <= right ? px : px - width);
    y = py + height + 8 <= H ? py : py - height;
    if (opts.at.touch) {
      // Above the finger when it fits, else below it; a menu too long for either side scrolls on the bigger one, so
      // the finger never covers it.
      const above = py - 16 - 8;
      const below = H - (py + 28) - 8;
      if (height > above && height > below && Math.max(above, below) >= 160) {
        list.style.maxHeight = `${Math.max(above, below)}px`;
        cutUnderWords(list);
        height = list.offsetHeight;
        y = above >= below ? py - 16 - Math.min(height, above) : py + 28;
      } else y = height <= above ? py - height - 16 : py + 28;
    }
    how = 'point';
  } else if (inRail) {
    // (the picture at the rail's foot: to the right of the rail, its foot level with the picture, close enough to it to
    // read as its menu: at the rail's own edge, never over it)
    x = clamp(Math.max(rail, a.right + 8), rail, Math.max(rail, right - width));
    y = a.bottom - height;
    how = 'beside';
  } else if (opts.align === 'up') {
    x = fitX(a.left);
    y = a.top - height - 8;
    how = 'above';
  } else {
    x = fitX(a.right - width);
    const below = hi - (a.bottom + 4);
    const above = a.top - 4 - lo;
    if (height <= below) { y = a.bottom + 4; how = 'below'; }
    else if (height <= above) { y = a.top - 4 - height; how = 'above'; }
    else {
      // neither side holds it whole: the side with more room, scrolling inside itself
      const room = Math.max(below, above);
      list.style.maxHeight = `${Math.max(120, room)}px`;
      cutUnderWords(list);
      height = list.offsetHeight;
      if (below >= above) { y = a.bottom + 4; how = 'below'; } else { y = a.top - 4 - height; how = 'above'; }
    }
  }
  list.style.left = `${x}px`;
  list.style.top = `${clamp(y, opts.at ? 8 : lo, Math.max(opts.at ? 8 : lo, (opts.at ? H - 8 : hi) - height))}px`;
  stillEdge(list);
  return how;
}
/* A menu too tall for its room scrolls: it is made a little shorter so its last row in sight is cut just under its words
   (35 to 64 % of the row), never through its letters (the critic's Chromebook film: History as slivers over Trash). */
function cutUnderWords(list) {
  const view = list.clientHeight;
  if (list.scrollHeight <= view + 1) return;
  // (in the list's own px, from offsets: it may be growing from its button, scaled, as the screen changes size)
  const within = (el) => { let y = 0; for (let e = el; e && e !== list; e = e.offsetParent) y += e.offsetTop; return y; };
  const rows = [...list.querySelectorAll(':scope > .menu-item, :scope > * > .menu-item')].filter((row) => row.offsetParent !== null);
  // (a row pinned at its foot, Move to Trash, takes the bottom of the view: the rows above it end where it begins)
  const pinned = rows.filter((row) => getComputedStyle(row).position === 'sticky');
  const room = pinned.length ? Math.min(...pinned.map((row) => within(row) - list.scrollTop)) : view;
  let cut = 0;
  for (const row of rows) {
    if (pinned.includes(row)) continue;
    const at = within(row);
    const h = row.offsetHeight;
    const label = row.querySelector('span');
    const words = label ? within(label) - at + label.offsetHeight - 2 : h / 2;
    const end = at + clamp(words, h * CUT_LEAST, h * CUT_MOST);
    if (end > room) break;
    cut = end;
  }
  const shorter = room - cut;
  if (cut > 0 && shorter > 0.5 && list.offsetHeight - shorter >= 120) list.style.maxHeight = `${Math.floor(list.offsetHeight - shorter)}px`;
}
/* How far a menu's rows can scroll: its light edge moves by that much over the whole scroll (overlay.css), so it stays. */
function stillEdge(list) {
  const range = Math.max(0, list.scrollHeight - list.clientHeight);
  list.style.setProperty('--ui-scroll-range', `${range}px`);
}

/* The editor's + More: its tray of tiles comes out of its button just above the floating tools strip (the note's words
   stay in sight over it), as wide as the strip, never over the strip; below the strip when the tray fits only there (a
   wide screen's strip at the top of the note), else on the side with more room, its tiles scrolling. */
function placeTray(list, anchor, z) {
  const strip = anchor.closest('.editor-tools');
  const s = box(strip, z);
  const a = box(anchor, z);
  const width = Math.min(s.width, 460);
  list.style.width = `${width}px`;
  list.style.maxWidth = 'none';
  list.style.left = `${Math.max(s.left, Math.min(s.right - width, a.left + a.width / 2 - width / 2))}px`;
  list.style.maxHeight = 'none';
  list.style.overflowY = 'auto';
  const tall = list.offsetHeight;
  const H = innerHeight / z;
  const above = s.top - 16;
  const below = H - s.bottom - 16;
  const under = tall > above && (tall <= below || below > above);
  list.style.maxHeight = `${Math.max(120, Math.min(tall, under ? below : above))}px`;
  const height = list.offsetHeight;
  list.style.top = `${under ? Math.min(s.bottom + 8, H - height - 8) : Math.max(8, s.top - 8 - height)}px`;
  list.dataset.gUnder = under ? '1' : '';
  stillEdge(list);
  return 'strip';
}

/* ------------------------------------------------------------------ menus */

const menus = new Set();  // the menus open now: { list, wrap, anchor, opts, how, lifted, entry, close }
const longs = new Set();  // the long menus (sheets) open now: { anchor, close }

/* V.menu hands its layer and list here once they are on the page: placed, grown from its button, its owner lifted.
   `close(how)` is V.menu's own. Returns the entry V.menu gives back to leaveMenu. */
const overRows = new WeakMap();  // a drop-down's menu -> the row in use, lying where its field was (openPick)
let nextOver = null;  // { anchor, row }: set by openPick for the menu V.menu makes next
function menu(wrap, list, anchor, opts, close) {
  if (nextOver && nextOver.anchor === anchor) overRows.set(list, nextOver.row);
  nextOver = null;
  const entry = { list, wrap, anchor, opts, close, lifted: null, how: null, entry: null, leaving: false };
  entry.how = placeMenu(list, anchor, opts);
  state(list, 'entering');
  // From its button's middle (or the point it was opened at), held inside the menu.
  const z = zoomOf(list);
  const r = box(list, z);
  let ox = r.width / 2, oy = 0;
  if (opts.at) { ox = opts.at.x / z - r.left; oy = opts.at.y / z - r.top; }
  else if (anchor && anchor.getBoundingClientRect && anchor !== document.body) {
    const a = box(anchor, z);
    ox = a.left + a.width / 2 - r.left; oy = a.top + a.height / 2 - r.top;
  }
  list.style.transformOrigin = `${clamp(ox, 0, list.offsetWidth).toFixed(1)}px ${clamp(oy, 0, list.offsetHeight).toFixed(1)}px`;
  let length = 0;
  if (calm()) {
    length = D().fade;
    play(list, [{ opacity: 0 }, { opacity: 1 }], { duration: length, easing: 'linear' }, 'move');
  } else {
    const { easing, duration } = tap();
    length = duration;
    play(list, [{ transform: 'scale(.86)' }, { transform: 'scale(1)' }], { duration, easing }, 'move');
  }
  later(() => { if (!entry.leaving) state(list, 'open'); }, length);
  // The thing it belongs to lifts while it's open (not the page itself, nor something nearly as big).
  if (anchor && anchor !== document.body && anchor !== root && motion().lift && anchor.isConnected) {
    const a = box(anchor, 1);
    if (a.width * a.height < innerWidth * innerHeight * 0.4) { entry.lifted = anchor; try { motion().lift(anchor, true); } catch (error) { console.error(error); } }
  }
  entry.entry = push(list, (how) => close(how), 'menu');
  menus.add(entry);
  return entry;
}

/* The menu goes as itself: it shrinks into its button in 140 ms (calm: a fade), its last 60 ms a fade; then its layer
   is taken away. While it goes it takes no press on the page beside it (its layer lets presses through), and its own
   rows are deaf (V.menu's rows check it's closed). */
function leaveMenu(entry, how) {
  if (!entry || entry.leaving) return;
  entry.leaving = true;
  menus.delete(entry);
  drop(entry.entry);
  const { list, wrap } = entry;
  if (entry.lifted) { try { motion().lift(entry.lifted, false); } catch (error) { /* gone */ } }
  if (!list.isConnected) { wrap.remove(); return; }
  const at = now(list);  // (where it is before the leaving classes can move it)
  deafWhere(list);
  state(list, 'leaving');
  wrap.classList.add('leaving');
  stop(list);
  let length;
  let move;
  if (calm()) {
    length = D().fade;
    move = play(list, [{ opacity: 1 }, { opacity: 0 }], { duration: length, easing: 'linear', fill: 'forwards' }, 'move');
  } else {
    const { easing, duration } = shrinkOut();
    length = duration;
    // (back to the size it grew from, .86: the grow run backwards, its last 60 ms a fade)
    move = play(list, [{ transform: `scale(${at.scale.toFixed(3)})` }, { transform: 'scale(.86)' }], { duration: length, easing, fill: 'forwards' }, 'move');
    fadeLast(list, length);
  }
  afterMove(move, length, () => wrap.remove());
  void how;
}

/* One menu at a time; and a menu never outlives the screen it was opened on (Back, a tab, a note closed under it, its
   button gone). */
function closeMenus({ stranded = false } = {}) {
  // (a phone's long menu, a sheet, goes the same ways a menu does: another tab, its row gone, another menu)
  for (const long of [...longs]) {
    const a = long.anchor;
    if (stranded && a && (a === document.body || (a.isConnected && a.getClientRects().length))) continue;
    try { long.close('outside'); } catch (error) { console.error(error); }
  }
  for (const entry of [...menus]) {
    if (!entry.list.isConnected) { menus.delete(entry); continue; }
    const a = entry.anchor;
    if (stranded && a && (a === document.body || (a.isConnected && a.getClientRects().length))) continue;
    try { entry.close('outside'); } catch (error) { console.error(error); }
  }
}
window.addEventListener('popstate', () => closeMenus());
if (V.on) { V.on('tab', () => closeMenus()); V.on('note-left', () => closeMenus({ stranded: true })); }

/* The screen changed size (the keyboard came or went, the phone turned): each open menu goes back by its button. */
function replace() {
  for (const entry of menus) {
    const { list, anchor, opts, how } = entry;
    if (!list.isConnected || !anchor || !anchor.isConnected || !anchor.getClientRects().length || how === 'point') continue;
    try { placeMenu(list, anchor, opts); } catch (error) { console.error(error); }
  }
}
window.addEventListener('resize', replace);
if (window.visualViewport) window.visualViewport.addEventListener('resize', replace);

/* Opened by the keyboard: Tab or the arrows used (html.g-kbd), a key, a click a key made (Enter or Space on a button:
   Chrome's clicks are pointer events, with no pointer type then). A menu opened by a finger or the mouse lights nothing
   (the menu itself has the keyboard). */
function byKeyboard() {
  if (root.classList.contains('g-kbd')) return true;
  const ev = window.event;
  if (!ev) return false;
  if (/^key/.test(ev.type)) return true;
  return ev.type === 'click' && (ev.pointerType === '' || (ev.pointerType === undefined && ev.detail === 0));
}

/* ------------------------------------------------------------------ the long menu: one sheet on a phone */

/* On a phone (a finger), a menu of more than 5 rows, or one that can't fit between the screen's top bar and its bottom
   bar, is one sheet from the foot, never more than 70 % of the screen: its title says what it is for (a note's own
   name, cut in its middle when long), its rows in small groups (things to do; sending and copying; studying), the
   reading switches as one "Reading" row that opens in place, and its danger row (Move to Trash) pinned in the sheet's
   foot, always in sight. If rows are still hidden, the last one in sight is cut at about half its height, so the list
   shows it goes on. It closes by a pull down, a tap beside it, Esc or Back; an item acts as the sheet starts to go (a
   switch acts at once and the sheet stays). A menu with a piece of its own (+ More's tiles, the picture's head, a
   drop-down's list) is never made a sheet. Returns V.menu's { close, el } or null. */
const MOST_ROWS = 5;
/* The rows in the order the menu gives them (its own lines, else the order it lists them: most used first), with the
   ones seldom used after one line (History, Archive, Save as template, the lock), then the switches ("Reading"), then the
   danger row, pinned in the foot. */
const SELDOM = /^(history|archive|unarchive|save as template|make it a normal note|remove the lock|lock\b)/i;
const READING = /quick read|dyslexia/i;
function groupOf(item) {
  if (item.danger) return 9;
  if (typeof item.checked === 'boolean') return 3;
  return SELDOM.test(item.label || '') ? 2 : 0;
}
function menuTitle(anchor, options) {
  const editor = anchor && anchor.closest && anchor.closest('.editor');
  const title = editor && editor.querySelector('.note-title');
  if (title && (title.value || '').trim()) return title.value.trim();
  if (editor) return 'This note';
  return String(options.label || '').replace(/:\s*(more )?options$/i, '').trim() || 'Options';
}
function longMenu(anchor, items, options = {}) {
  if (!phone() || !coarse()) return null;
  const list = (items || []).filter(Boolean);
  if (list.some((item) => item.node)) return null;
  const real = list.filter((item) => !item.sep);
  const room = innerHeight - 170;  // (the screen less its top bar and its bottom bar)
  if (real.length <= MOST_ROWS && real.length * 52 + 24 <= room) return null;
  let done = false;
  let sheet = null;
  let stepped = false;
  const mine = { anchor, close: (how) => closeWith(how) };
  // (`after`: what the item does, once the sheet has begun to go and its Back step is gone, so a step the item makes
  // itself, a note opened say, is never the one taken back)
  const closeWith = (how, after = null) => {
    if (done) return;
    done = true;
    longs.delete(mine);
    window.removeEventListener('popstate', back);
    if (sheet) sheet.close();
    const then = () => {
      if (options.onClose) { try { options.onClose(how); } catch (error) { console.error(error); } }
      if (after) { try { after(); } catch (error) { if (V.problem) V.problem(error); } }
    };
    if (stepped && history.state && history.state.vault === 'menu-sheet') {
      stepped = false;
      let ran = false;
      const once = () => { if (ran) return; ran = true; window.removeEventListener('popstate', once); then(); };
      window.addEventListener('popstate', once);
      setTimeout(once, 400);
      history.back();
    } else then();
  };
  const back = () => { stepped = false; closeWith('escape'); };
  // groups: the menu's own (by its lines), else by kind; the danger rows always last, in the foot
  const ordered = [];
  if (list.some((item) => item.sep)) {
    let group = 0;
    for (const item of list) { if (item.sep) group++; else ordered.push([item.danger ? 99 : group, item]); }
  } else for (const item of real) ordered.push([groupOf(item), item]);
  ordered.sort((a, b) => a[0] - b[0]);
  const iconOf = (item) => (!item.icon ? null : typeof item.icon === 'string' ? V.icon(item.icon) : item.icon.cloneNode(true));
  const switchRow = (item) => {
    const input = V.h('input.switch', { type: 'checkbox', checked: item.checked, disabled: item.disabled ? true : null,
      'aria-label': item.label, onchange: () => { try { item.onClick(); } catch (error) { if (V.problem) V.problem(error); } } });
    const row = V.h('label.menu-item.g-msheet-item.g-msheet-switch', { role: 'menuitemcheckbox', 'aria-checked': String(item.checked) },
      iconOf(item), V.h('span.g-msheet-label', { text: item.label }), input);
    input.addEventListener('change', () => { row.setAttribute('aria-checked', String(input.checked)); });
    return row;
  };
  const itemRow = (item) => V.h('button.menu-item.g-msheet-item' + (item.danger ? '.danger' : ''), { type: 'button', role: 'menuitem',
    disabled: item.disabled ? true : null, onclick: () => closeWith('item', () => item.onClick()) },
  iconOf(item), V.h('span.g-msheet-label', { text: item.label }));
  const reading = ordered.filter(([, item]) => typeof item.checked === 'boolean');
  const joined = reading.length >= 2 && reading.every(([, item]) => READING.test(item.label || ''));
  const rows = [];
  const foot = [];
  let last = null;
  for (const [group, item] of ordered) {
    if (item.danger) { foot.push(itemRow(item)); continue; }
    if (joined && typeof item.checked === 'boolean') {
      if (rows.some((row) => row.classList && row.classList.contains('g-msheet-more'))) continue;
      if (last !== null && group !== last) rows.push(V.h('div.g-msheet-gap', { 'aria-hidden': 'true' }));
      last = group;
      rows.push(...readingRows(reading.map(([, it]) => switchRow(it))));
      continue;
    }
    if (last !== null && group !== last) rows.push(V.h('div.g-msheet-gap', { 'aria-hidden': 'true' }));
    last = group;
    rows.push(typeof item.checked === 'boolean' ? switchRow(item) : itemRow(item));
  }
  const body = V.h('div.g-msheet-list', { role: 'menu', 'aria-label': options.label || null }, rows);
  sheet = V.sheet({ title: menuTitle(anchor, options), content: body, onClose: () => closeWith('outside') });
  longs.add(mine);
  const panel = sheet.el;
  panel.classList.add('g-msheet');
  // (the menu's own class on the sheet itself, `cls`: what looks for that menu finds this one, the whole of it on the screen)
  if (options.cls) panel.classList.add(...String(options.cls).split(/\s+/).filter(Boolean));
  if (foot.length) panel.append(V.h('div.g-msheet-foot', { role: 'group', 'aria-label': options.label || null }, foot));
  // (the browser's own menu never comes up over this one, or beside it, as over any menu)
  panel.addEventListener('contextmenu', (event) => event.preventDefault());
  const scrim = panel.parentElement;
  if (scrim) scrim.addEventListener('contextmenu', (event) => { if (event.target === scrim || event.target.classList.contains('ui-scrim')) event.preventDefault(); });
  // (the title cut to one line first: the list's room is what the head leaves)
  cutTitle(panel.querySelector(':scope > .sheet-head h2'));
  fitLong(panel);
  // (lane B1: its Back is V.back's one guard step, as every sheet's; Back closes it as Esc did. Without ui/nav.js, its own step.)
  const reg = sheets.get(panel) && sheets.get(panel).entry && sheets.get(panel).entry.back;
  if (reg && reg.setClose) reg.setClose(() => closeWith('escape'));
  else {
    try { history.pushState({ ...(history.state || {}), vault: 'menu-sheet' }, ''); stepped = true; } catch (error) { /* no Back step */ }
    window.addEventListener('popstate', back);
  }
  // (the keyboard: on its first item, as a menu's)
  requestAnimationFrame(() => { const first = panel.querySelector('button:not([disabled]), input:not([disabled])'); if (first && byKeyboard()) first.focus(); });
  return { close: () => closeWith('item'), el: panel };
}

/* The reading switches as one row, "Reading", that opens in place: its switches under it, the rows below moving down
   on the settle spring (and back up when it closes). */
function readingRows(switches) {
  const more = V.h('div.g-msheet-sub', { hidden: true }, switches);
  const chevron = V.icon('down');
  const row = V.h('button.menu-item.g-msheet-item.g-msheet-more', { type: 'button', 'aria-expanded': 'false',
    onclick: () => openIn(row, more, row.getAttribute('aria-expanded') !== 'true') },
  V.icon('text'), V.h('span.g-msheet-label', { text: 'Reading' }), chevron);
  return [row, more];
}
function openIn(row, more, open) {
  const list = row.parentElement;
  const after = [...list.children].slice([...list.children].indexOf(more) + 1);
  const before = after.map((el) => el.getBoundingClientRect().top);
  row.setAttribute('aria-expanded', String(open));
  more.hidden = !open;
  if (calm()) return;
  const { easing, duration } = settle();
  after.forEach((el, i) => {
    const dy = before[i] - el.getBoundingClientRect().top;
    if (Math.abs(dy) > 0.5) play(el, [{ transform: `translateY(${dy.toFixed(1)}px)` }, { transform: 'translateY(0px)' }], { duration, easing }, 'move');
  });
  if (open && motion().enter) { try { motion().enter(more, { stagger: D().stagger, max: 8 }); } catch (error) { /* plain */ } }
  // (what opened in sight: the list scrolls it in, softly)
  if (open) { try { more.scrollIntoView({ block: 'nearest', behavior: calm() ? 'auto' : 'smooth' }); } catch (error) { /* fine */ } }
}

/* The long sheet shows every row when they all fit under the screen's head row (the tallest a sheet may be: 558 on the
   owner's 610: a Today row's seven actions, the picture's menu). Longer, it is never more than 70 % of the screen (427
   there) and takes all of that it can: its list is cut so the last row in sight shows between 35 and 65 % of itself with
   its words whole (cut just under the letters where that is inside the range), and fades there (`g-msheet-cut`, gone
   once the list is scrolled to its end): the list reads as going on, never as letters clipped. The foot's danger row
   stays whole under it. */
const CUT_LEAST = 0.35;
const CUT_MOST = 0.64;  // (65 % the brief's most, less a rounding)
const MORE_GAP = 12;  // px
function fitLong(panel) {
  const body = panel.querySelector(':scope > .sheet-body');
  if (!body) return;
  const z = zoomOf(panel);
  const H = innerHeight / z;
  body.style.maxHeight = '';
  body.classList.remove('g-msheet-cut');
  const own = body.querySelector('.g-msheet-list');
  if (own) own.style.rowGap = '';
  const total = panel.offsetHeight;
  // (every row in it, the sheet itself no taller than a sheet may be, under the head row: nothing to cut)
  const head = parseFloat(token('--head-h')) || 52;
  if (body.scrollHeight + (total - body.clientHeight) <= H - head + 1) return;
  const limit = Math.floor(H * 0.7);
  const room = limit - (total - body.offsetHeight);  // (what's left for the list's own box, its padding in it)
  const rows = [...body.querySelectorAll('.g-msheet-item')].filter((el) => el.offsetParent !== null);
  // (where they rest, in the panel's own px: the rows are still rising in, so their boxes on the screen aren't)
  const within = (el) => { let y = 0; for (let e = el; e && e !== panel; e = e.offsetParent) y += e.offsetTop; return y; };
  const top = within(body);
  // The deepest row whose words fit whole above the cut (cut just under them, held inside 35 to 65 % of the row)...
  let cut = 0, last = null;
  for (const row of rows) {
    const at = within(row) - top;
    const h = row.offsetHeight;
    const label = row.querySelector('.g-msheet-label');
    const words = label ? within(label) - within(row) + label.offsetHeight - 2 : h / 2;
    const end = at + clamp(words, h * CUT_LEAST, h * CUT_MOST);
    if (end > room) break;
    cut = end;
    last = row;
  }
  if (!last) cut = Math.max(52, room);
  else {
    // ...then what's left of the room spaces the rows above it a little more (at most MORE_GAP a gap), so the sheet takes
    // the height it may and the cut stays under the words.
    const list = last.parentElement;
    const before = [...list.children].indexOf(last);
    const gap = parseFloat(getComputedStyle(list).rowGap) || 0;
    const more = before > 0 ? Math.min(MORE_GAP, Math.floor((room - cut) / before)) : 0;
    if (more > 0) { list.style.rowGap = `${gap + more}px`; cut += more * before; }
  }
  // (max-height is the content's when the box is content-box: its padding is on top of it)
  const style = getComputedStyle(body);
  const padding = style.boxSizing === 'border-box' ? 0 : parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
  body.style.maxHeight = `${Math.floor(cut - padding)}px`;
  const ends = () => body.classList.toggle('g-msheet-cut', body.scrollTop + body.clientHeight < body.scrollHeight - 1);
  ends();
  body.addEventListener('scroll', ends, { passive: true });
}

/* A long title cut in its middle (an intended cut: data-cut). Measured on the string, with the title's own font on a
   canvas (no layout of its own: the sheet was laid out once already, for its rise), so the sheet's first frame shows the
   cut title: worked out after its first frame, a busy page painted the browser's end-cut first and swapped the words
   in front of the owner. Where a canvas can't measure, it is worked out after the tap's task, as before. */
let pen = null;
function cutTitle(h2) {
  if (!h2) return;
  const full = h2.textContent;
  const apply = (text) => { h2.textContent = text; h2.dataset.cut = 'middle'; h2.title = full; };
  const middle = (n) => full.slice(0, Math.ceil(n / 2)) + '…' + full.slice(full.length - Math.floor(n / 2));
  const room = h2.clientWidth;
  try {
    if (!pen) pen = document.createElement('canvas').getContext('2d');
    if (pen && room > 0) {
      const style = getComputedStyle(h2);
      pen.font = style.font || `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
      if ('letterSpacing' in pen) pen.letterSpacing = style.letterSpacing === 'normal' ? '0px' : style.letterSpacing;
      const wide = (text) => pen.measureText(text).width;
      const slack = 2;  // (the browser's own shaping can differ from the canvas's by a pixel)
      if (wide(full) <= room - slack) return;
      let lo = 1, hi = full.length;
      while (lo < hi) { const mid = Math.ceil((lo + hi) / 2); if (wide(middle(mid)) <= room - slack) lo = mid; else hi = mid - 1; }
      apply(middle(lo));
      return;
    }
  } catch (error) { /* no canvas: after the task, by the title's own box */ }
  requestAnimationFrame(() => {
    if (!h2.isConnected || h2.scrollWidth <= h2.clientWidth + 1) return;
    let lo = 1, hi = full.length;
    const fits = (n) => { h2.textContent = middle(n); return h2.scrollWidth <= h2.clientWidth + 1; };
    while (lo < hi) { const mid = Math.ceil((lo + hi) / 2); if (fits(mid)) lo = mid; else hi = mid - 1; }
    apply(middle(lo));
  });
}

/* ------------------------------------------------------------------ drop-downs: Wefty's own list */

/* A drop-down (a <select>: a note's folder, a reminder's repeat...) opens Wefty's own list: on a wide screen, and inside
   a sheet on a phone, a menu growing out of the field, as wide as it at least (never a sheet on a sheet; Esc closes only
   the list); on a phone's page a sheet from the foot. It is a listbox of options: the one in use ticked,
   folders inside folders indented with their emoji on a small square, "New folder..." last under a line; the arrow keys,
   Home, End, Page Up and Down move, letters typed find, Enter or Space (or a tap) picks, Esc or a press beside it
   closes. Picking sets the select's value and tells it as the browser would (input, then change), so the app's own code
   is untouched. A select with `multiple` or a size, or one that's disabled, is left as it is. */
const PICK_SPACE = /^[\s  - ]+/;
const PICK_EMOJI = /^((?:\p{Extended_Pictographic}|\p{Regional_Indicator})(?:️|‍|\p{Emoji_Modifier}|\p{Extended_Pictographic}|\p{Regional_Indicator})*)\s+/u;
const pickable = (sel) => !!sel && sel.tagName === 'SELECT' && !sel.multiple && !(sel.size > 1) && !sel.disabled && sel.options.length > 0
  && !!sel.closest('#app, #layers');
function pickOptions(sel) {
  return [...sel.options].map((option) => {
    const raw = option.textContent || '';
    const lead = (raw.match(PICK_SPACE) || [''])[0].length;
    let text = raw.slice(lead).trim();
    const emoji = text.match(PICK_EMOJI);
    if (emoji) text = text.slice(emoji[0].length);
    const fresh = option.value === 'new-folder' || /^new folder/i.test(text);
    return { option, value: option.value, text, emoji: emoji ? emoji[1] : '', depth: Math.min(6, lead), disabled: option.disabled, fresh };
  });
}
function labelOf(sel) {
  const named = sel.getAttribute('aria-label');
  if (named) return named;
  const label = sel.closest('label') || (sel.id && document.querySelector(`label[for="${CSS.escape(sel.id)}"]`));
  return label ? (label.textContent || '').replace(sel.textContent || '', '').trim() || 'Choose' : 'Choose';
}
let picking = null;  // the drop-down open now: { sel, close }
function openPick(sel, keyed) {
  if (picking) { const same = picking.sel === sel; picking.close(); if (same) return null; }
  const items = pickOptions(sel);
  const current = sel.selectedIndex;
  const label = labelOf(sel);
  // (a phone's sheet of its own for one on the page; inside a sheet already, the list opens in place out of its field, as
  // a wide screen's does: never a sheet on a sheet)
  const asSheet = phone() && coarse() && !sel.closest('.sheet');
  let handle = null;
  let done = false;
  const finish = (item) => {
    if (done) return;
    done = true;
    picking = null;
    if (handle) handle.close();
    if (item && !item.disabled) {
      if (keyed || asSheet) { try { sel.focus({ preventScroll: true }); } catch (error) { /* gone */ } }
      if (sel.value !== item.value) {
        sel.value = item.value;
        sel.dispatchEvent(new Event('input', { bubbles: true }));
        sel.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }
  };
  const row = (item, i) => {
    const on = i === current;
    const button = V.h('button.menu-item.g-pick-option' + (on ? '.on' : '') + (item.fresh ? '.fresh' : ''), {
      type: 'button', role: 'option', tabindex: '-1', 'aria-selected': String(on), disabled: item.disabled ? true : null,
      dataset: { value: item.value, depth: String(item.depth) }, onclick: () => finish(item),
    },
    item.fresh ? V.h('span.g-pick-badge', {}, V.icon('folder-plus')) : item.emoji ? V.h('span.g-pick-badge', { text: item.emoji, 'aria-hidden': 'true' }) : null,
    V.h('span.g-pick-text', { text: item.text }),
    on ? V.h('span.g-pick-tick', { 'aria-hidden': 'true' }, V.icon('check')) : null);
    if (item.depth) button.style.setProperty('--g-pick-depth', String(item.depth));
    return button;
  };
  const rows = items.map(row);
  const list = V.h('div.g-pick-list', { role: 'listbox', 'aria-label': label });
  items.forEach((item, i) => {
    if (item.fresh && i > 0) list.append(V.h('div.menu-sep.g-pick-sep', { role: 'separator' }));
    list.append(rows[i]);
  });
  const usable = () => rows.filter((b) => !b.disabled);
  let typed = '';
  let typedAt = 0;
  const keys = (event) => {
    const all = usable();
    if (!all.length) return undefined;
    const at = all.indexOf(document.activeElement);
    const from = at >= 0 ? at : Math.max(0, all.indexOf(rows[current]));
    const go = (i) => { event.preventDefault(); event.stopPropagation(); const to = all[Math.max(0, Math.min(all.length - 1, i))]; to.focus(); to.scrollIntoView({ block: 'nearest' }); };
    if (event.key === 'ArrowDown') return go(at < 0 ? from : from + 1);
    if (event.key === 'ArrowUp') return go(at < 0 ? from : from - 1);
    if (event.key === 'Home') return go(0);
    if (event.key === 'End') return go(all.length - 1);
    if (event.key === 'PageDown') return go(from + 8);
    if (event.key === 'PageUp') return go(from - 8);
    if (event.key === 'Tab') { event.preventDefault(); finish(null); try { sel.focus({ preventScroll: true }); } catch (error) { /* gone */ } return undefined; }
    if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey && event.key !== ' ') {
      const t = performance.now();
      typed = (t - typedAt > 800 ? '' : typed) + event.key.toLowerCase();
      typedAt = t;
      const start = typed.length === 1 ? from + 1 : from;
      const order = all.slice(start).concat(all.slice(0, start));
      const found = order.find((b) => (b.querySelector('.g-pick-text').textContent || '').toLowerCase().startsWith(typed))
        || (typed.length > 1 && typed.split('').every((c) => c === typed[0])
          ? order.find((b) => (b.querySelector('.g-pick-text').textContent || '').toLowerCase().startsWith(typed[0])) : null);
      if (found) go(all.indexOf(found));
      else { event.preventDefault(); event.stopPropagation(); }
    }
    return undefined;
  };
  if (asSheet) {
    handle = V.sheet({ title: label, content: list, onClose: () => { if (!done) { done = true; picking = null; } } });
    handle.el.classList.add('g-pick-sheet');
  } else {
    // (as wide as its field at least: its own width, never one a move under way gives its box on the screen)
    const layers = document.getElementById('layers');
    if (layers) layers.style.setProperty('--g-pick-min', `${Math.ceil(sel.offsetWidth)}px`);
    const inPlace = phone() && !!sel.closest('.sheet');
    nextOver = inPlace && rows[current] ? { anchor: sel, row: rows[current] } : null;
    handle = V.menu(sel, [{ node: list }], { cls: 'g-pick-menu', label, returnFocus: !!keyed,
      onClose: () => { if (!done) { done = true; picking = null; } } });
    nextOver = null;
    if (handle && handle.el) handle.el.setAttribute('role', 'presentation');
  }
  if (handle && handle.el) handle.el.addEventListener('keydown', keys, true);
  picking = { sel, close: () => finish(null) };
  const chosen = rows[current] && !rows[current].disabled ? rows[current] : usable()[0];
  const into = keyed || asSheet;
  requestAnimationFrame(() => {
    if (!chosen || !chosen.isConnected) return;
    chosen.scrollIntoView({ block: 'nearest' });
    if (into) chosen.focus({ preventScroll: true });
  });
  if (into && chosen) chosen.focus({ preventScroll: true });
  return handle;
}

document.addEventListener('mousedown', (event) => {
  if (event.button !== 0) return;
  const sel = event.target && event.target.closest ? event.target.closest('select') : null;
  if (!pickable(sel)) return;
  event.preventDefault();
  openPick(sel, false);
}, true);
document.addEventListener('keydown', (event) => {
  const sel = event.target;
  if (!pickable(sel) || event.ctrlKey || event.metaKey) return;
  const opens = event.key === ' ' || event.key === 'Enter' || event.key === 'F4' || event.key === 'ArrowDown' || event.key === 'ArrowUp';
  if (!opens) return;
  event.preventDefault();
  event.stopPropagation();
  openPick(sel, true);
}, true);
V.glassPick = openPick;

/* ------------------------------------------------------------------ toasts */

/* The slot: 8 px above what the foot claims (above an open sheet's buttons), and on a wide screen from the left edge
   of the content, 24 px over the foot. Worked out when the first of a run of toasts comes and kept until they've all
   gone, so a toast never jumps (a sheet closing under it, another coming). */
const GAP = 8;
function slot(box_) {
  const z = zoomOf(document.body) || 1;
  const H = innerHeight / z;
  // (while folders are arranged, the toasts go to the top, off the tree being dragged in: as 1.17 had it)
  box_.classList.toggle('ui-top', shows(document.querySelector('.arrange-list')));
  if (media('(min-width: 900px)')) { box_.style.removeProperty('--ui-toast-bottom'); return; }
  // (a sheet open covers the foot: above its own buttons then)
  const sheetTop = topSheetActions(z);
  const foot = sheetTop !== null ? sheetTop : footTop(z);
  const bottom = foot === null ? null : H - foot + GAP;
  if (bottom === null) box_.style.removeProperty('--ui-toast-bottom');
  else box_.style.setProperty('--ui-toast-bottom', `${Math.round(bottom)}px`);
}
/* The top of the open sheet's buttons (or of the sheet, when it has none), page px. */
function topSheetActions(z) {
  const layers = document.querySelectorAll('#layers > .layer:not(.leaving):not(.menu-layer)');
  for (let i = layers.length - 1; i >= 0; i--) {
    const panel = layers[i].querySelector(':scope > .sheet');
    if (!panel || !shows(panel)) continue;
    const bar = panel.querySelector(':scope > .sheet-actions, :scope > .g-msheet-foot');
    const r = box(shows(bar) ? bar : panel, z);
    return r.top;
  }
  return null;
}

const toasts = new WeakMap();  // a toast showing -> { timer, lasting, gone, ms }
const waiting = [];  // toasts that wait their turn: { item, opts, done(gone) }
const MOST = 2;
const showing = (box_) => [...box_.querySelectorAll(':scope > .toast:not(.msg-card)')].filter((t) => t.dataset.ui !== 'leaving' && !t.classList.contains('leaving'));

/* V.toast hands its new item here: { ms, lasting (it has a button), text }. Returns the function that makes it go. */
function toast(item, opts = {}) {
  const box_ = document.getElementById('toasts');
  if (!box_) return () => {};
  // The same words again (two to-dos ticked quickly: "Nice, done." twice): the toast showing them takes the new one's
  // buttons and its time, so there's one toast, and its Undo is the latest one's.
  if (typeof opts.text === 'string') {
    const same = showing(box_).find((t) => { const w = t.querySelector(':scope > span'); return w && w.textContent === opts.text; });
    if (same) {
      same.className = item.className;
      state(same, 'open');
      same.replaceChildren(...item.childNodes);
      const was = toasts.get(same);
      if (was && was.timer) clearTimeout(was.timer);
      const gone = () => leaveCard(same);
      toasts.set(same, { lasting: !!opts.lasting, gone, timer: setTimeout(gone, opts.ms || 3200) });
      if (motion().press) { try { motion().press(same, { scale: 0.97 }); } catch (error) { /* plain */ } }
      return gone;
    }
  }
  let goneNow = null;
  const goneLater = () => { if (goneNow) goneNow(); else { const i = waiting.findIndex((w) => w.item === item); if (i >= 0) waiting.splice(i, 1); } };
  const show = () => { goneNow = place(item, opts); };
  const up = showing(box_);
  if (up.length >= MOST) {
    // a toast with no button gives way at once; one with a button is never replaced before its time: this one waits
    const plain = up.find((t) => toasts.has(t) && !toasts.get(t).lasting) || up.find((t) => !toasts.has(t));
    if (plain) { leaveCard(plain); show(); } else waiting.push({ item, opts, show });
  } else show();
  return goneLater;
}
/* A toast onto the page: above the others (they stay where they are), its time running, swiped and tapped away. */
function place(item, opts) {
  const box_ = document.getElementById('toasts');
  if (!box_.querySelector(':scope > .toast, :scope > .notice')) slot(box_);
  // (#toasts lays its cards out from the foot up, ui/overlay.css: the newest, last, comes above the others, which stay)
  box_.append(item);
  card(item);
  const gone = () => leaveCard(item);
  toasts.set(item, { lasting: !!opts.lasting, gone, timer: setTimeout(gone, opts.ms || 3200) });
  return gone;
}
/* What every card in #toasts has (a toast, the message card, V.notice's card): its states, a swipe sideways, a tap on its
   body to close it. */
function card(el) {
  state(el, 'entering');
  // It rises 16 px from the foot's claim, .94 to 1 on the pill spring, solid all the way (a toast of four lines is no
  // small thing that may fade); calm: the stylesheets' own short fade (overlay.css leaves it to them).
  const { easing, duration } = curve('--spring-pill', '--d-pill', 460);
  if (!calm()) play(el, [{ transform: 'translateY(16px) scale(.94)' }, { transform: 'none' }], { duration, easing }, 'move');
  later(() => { if (el.dataset.ui === 'entering') state(el, 'open'); }, calm() ? D().fade : duration);
  swipeAway(el);
  el.addEventListener('click', (event) => {
    if (event.defaultPrevented || (event.target.closest && event.target.closest('button, a, input, select, textarea, label'))) return;
    if (el.classList.contains('notice')) return;  // (a card from V.notice has its own x and stays while it's looked at)
    const x = el.querySelector(':scope > .mc-x');
    if (x) x.click(); else leaveCard(el);
  });
}
/* A card leaves: it sinks and fades in 160 ms, then it's taken away and the ones above come down to fill its place (on
   the settle spring), and a toast waiting its turn comes. */
function leaveCard(el, { quick = false } = {}) {
  if (!el || el.dataset.ui === 'leaving') return;
  const kept = toasts.get(el);
  if (kept && kept.timer) clearTimeout(kept.timer);
  toasts.delete(el);
  // (where it is now, read before the leaving class: the stylesheets' .toast.leaving would move it 10 px in one frame)
  const at = el.isConnected ? now(el) : null;
  state(el, 'leaving');
  el.classList.add('leaving');
  if (!el.isConnected) { pump(); return; }
  const length = quick ? D().fade : D().exit;
  try { el.getAnimations().forEach((a) => { if (a.animationName) a.cancel(); }); } catch (error) { /* gone */ }
  const move = play(el, calm() ? [{ opacity: 1 }, { opacity: 0 }]
    : [{ transform: `translate(${at.x.toFixed(1)}px, ${at.y.toFixed(1)}px)`, opacity: 1 }, { transform: `translate(${at.x.toFixed(1)}px, ${(at.y + 10).toFixed(1)}px) scale(.96)`, opacity: 0 }],
  { duration: length, easing: token('--ease-in') || 'ease-in', fill: 'forwards' }, 'move');
  afterMove(move, length, () => { gather(el.parentElement, () => el.remove()); pump(); });
}
/* `change()` takes something out of #toasts; the cards that stay move from where they were to where they are now. */
function gather(box_, change) {
  if (!box_) { change(); return; }
  const stay = [...box_.children].filter((c) => c.dataset.ui !== 'leaving');
  const before = stay.map((c) => c.getBoundingClientRect().top);
  change();
  if (calm()) return;
  const { easing, duration } = settle();
  stay.forEach((c, i) => {
    if (!c.isConnected) return;
    const dy = before[i] - c.getBoundingClientRect().top;
    if (Math.abs(dy) > 0.5) play(c, [{ translate: `0 ${dy.toFixed(1)}px` }, { translate: '0 0' }], { duration, easing }, 'gather');
  });
}
function pump() {
  const box_ = document.getElementById('toasts');
  if (!box_) return;
  while (waiting.length && showing(box_).length < MOST) waiting.shift().show();
}

/* A toast swiped sideways goes (V.motion.swipe); a finger that takes it while it's still rising takes it from there
   (its rise is cancelled: MOT-22). Calm: nothing is swiped. */
const swiping = new WeakSet();
function swipeAway(item) {
  if (calm() || !item || swiping.has(item) || !motion().swipe) return;
  swiping.add(item);
  item.addEventListener('pointerdown', () => {
    try { item.getAnimations().forEach((a) => { if (a.animationName && a.playState === 'running') a.cancel(); }); } catch (error) { /* gone */ }
    // (its own rise too: the finger has it now)
    if (item.dataset.ui === 'entering') stop(item, 'move');
  }, { passive: true });
  motion().swipe(item, {
    left: true, right: true, card: item, threshold: 70,
    onCommit: () => {
      // a card from V.notice has its own close (its onClose runs); the message card too; a toast simply goes
      const x = item.querySelector(':scope > .icon-btn, :scope > .mc-x');
      if (x) x.click(); else { state(item, 'leaving'); item.classList.add('leaving'); toasts.delete(item); gather(item.parentElement, () => item.remove()); pump(); }
    },
  });
}

/* V.notice's card: it comes like a toast (placed with them, above them) and goes like one. */
function notice(el) {
  const box_ = document.getElementById('toasts');
  if (box_ && !box_.querySelector(':scope > .toast, :scope > .notice')) slot(box_);
  // (the card it takes the place of keeps its place as it goes: this one comes above it, then settles down into it.
  // Prepended under it, the one going jumped up by this one's height in one frame)
  const going = box_ ? [...box_.querySelectorAll(':scope > .notice[data-ui="leaving"]')].pop() : null;
  if (going && going !== el) going.after(el);
  card(el);
}

/* ------------------------------------------------------------------ what a screen closing leaves behind */

/* A screen taken away from under a menu opened on it: the menu goes too. A toast taken away by its own code (an Undo
   that's no longer true): a toast waiting its turn comes. */
function watchLayers() {
  const layers = document.getElementById('layers');
  if (layers) {
    new MutationObserver((records) => {
      for (const record of records) for (const node of record.addedNodes) if (node.nodeType === 1 && node.matches(EARLY_LAYERS)) early(node);
      if (menus.size && records.some((record) => record.removedNodes.length)) closeMenus({ stranded: true });
    }).observe(layers, { childList: true });
  }
  const box_ = document.getElementById('toasts');
  if (box_) {
    new MutationObserver((records) => { if (waiting.length && records.some((record) => record.removedNodes.length)) pump(); })
      .observe(box_, { childList: true });
  }
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', watchLayers); else watchLayers();

V.overlay = {
  sheet, menu, leaveMenu, longMenu, placeMenu, closeMenus, byKeyboard, isTop,
  toast, notice, leaveCard, card, slot,
  pick: openPick,
  /* (for tests and films: what's open now) */
  open: () => stack.map((entry) => entry.node),
};
})();
