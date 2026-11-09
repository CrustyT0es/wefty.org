/* Wefty 2.0 "glass": V.motion, the shared motion helpers. Foundations wrote them; every area calls them and never
   re-implements them (so every press, tick, open and load feels like the same app). Plain script, shares `V`.

   Rules the helpers keep (the owner's priority is SATISFYING animation that still runs smoothly on a cheap school
   Chromebook):
     - only `transform` and `opacity` animate (and stroke-dashoffset to draw a thread), never layout;
     - press .12 s, springs and slides .46 s cubic-bezier(.25,1.18,.35,1), entrances .5 s, a stagger of at most 8 items;
     - every animation can be started again at once (the old one is cancelled), and nothing is left behind: no stray
       element, no inline style that was not there before, no will-change once it stops moving;
     - LITE (V.motion.lite(): weak device, or Settings > Appearance > Animations): springs shortened, no overshoot, no
       decoration (sparks, glows); CALM (V.motion.calm(): prefers-reduced-motion, or Calm): nothing moves, only fades
       of 120 ms or less, and a number or a screen simply changes;
     - they use Web Animations where there is `element.animate`, and finish at once where there is not.
   Every helper returns a handle { cancel(), finished: Promise } (or a function to undo what it bound), and is safe to
   call with a missing element (it does nothing).

   The helpers:
     enter(container, { stagger = 45, selector, max = 8, delay = 0 })   the .enter rise: children come up one after the other
     press(el)                         one spring pulse (a tap done with the keyboard, a tile that was chosen)
     press.follow(el, { scale = .94 })   a pointer press that springs back; returns a function that unbinds it
     spark(el)                         the four-spark burst from the middle of a ticked box
     roll(el, from, to, { duration })  rolling numbers: the digits turn like an odometer and end on exactly `to`
     weft(svgPath, { duration, delay })  a thread draws itself (a path, or an svg holding one)
     flip(fromEl, toEl, { reverse })   a shared element opening (reverse: closing): toEl grows out of fromEl's box; the handle
                                       also has restore() (fromEl visible again), done by itself on cancel or when toEl is removed
     swipe(el, { left, right, onCommit })   swipe a card sideways: past the threshold it commits, below it springs back
     pull(scroller, { onRelease })     pull down at the top: the thread goes taut, let go past the mark and it syncs
     peek(el, { onPeek })              press and hold: a preview floats up while held
     shrink(scroller, title, { bar })  a large title that collapses into a slim bar as the page scrolls
     lite(), calm()                    the two modes (lite(true) / lite(false) set the automatic one)
   Also: V.motion.watch() measures the frame rate for a few seconds and turns lite on for good on a slow device. */
'use strict';

(() => {
const V = (window.V = window.V || {});

const EASE = 'cubic-bezier(.2,.8,.2,1)';
const SLIDE = 'cubic-bezier(.25,1.18,.35,1)';
const SPRING = 'cubic-bezier(.34,1.45,.64,1)';
const EXIT = 'cubic-bezier(.5,0,.8,.4)';
const ROLL = 'cubic-bezier(.22,1,.36,1)';
const root = document.documentElement;
const HAS_WAAPI = typeof Element !== 'undefined' && typeof Element.prototype.animate === 'function';

/* -- the two modes (the classes on <html> come from js/look.js, which keeps them up to date) */
const calm = () => root.classList.contains('calm');
const lite = (on) => {
  if (on === undefined) return root.classList.contains('lite');
  if (V.look && V.look.liteAuto) V.look.liteAuto(!!on);
  else root.classList.toggle('lite', !!on);
  return !!on;
};
const quick = () => calm() || lite();
const buzz = (ms) => { try { if (navigator.vibrate && !calm()) navigator.vibrate(ms); } catch (error) { /* not allowed here */ } };

/* -- one handle for every animation: cancel() stops it where it is and finished says when it ended (or was cut short) */
const NOTHING = () => ({ cancel() {}, finished: Promise.resolve() });
const live = new WeakMap();  // element -> { key: handle }: the one running for that job, which a new start cancels
function take(el, key) {
  const jobs = live.get(el) || {};
  if (jobs[key]) { try { jobs[key].cancel(); } catch (error) { /* gone already */ } }
  live.set(el, jobs);
  return jobs;
}
function play(el, keyframes, options, key) {
  if (!el || !HAS_WAAPI) return NOTHING();
  const jobs = take(el, key || 'main');
  let animation;
  try { animation = el.animate(keyframes, options); } catch (error) { return NOTHING(); }
  const handle = {
    animation,
    cancel() { try { animation.cancel(); } catch (error) { /* gone */ } },
    finished: animation.finished.then(() => handle, () => handle),
  };
  jobs[key || 'main'] = handle;
  animation.finished.then(() => { if (jobs[key || 'main'] === handle) delete jobs[key || 'main']; }, () => {});
  return handle;
}
const done = (animation, fn) => { if (animation) animation.finished.then(fn, fn); else fn(); };

/* ---------------------------------------------------------------- enter */

/* The board's .enter: each child rises 12 px and fades in (no scale as in the board's: a button measured mid-rise came out under
   44 px and failed the tap-size tests, and .985 can't be seen), .5 s, one after the other (45 ms apart, the first 8 only: a
   long list does not take seconds to appear). Calm: a short fade, no rise. */
function enter(container, { stagger = 45, selector = '', max = 8, delay = 0 } = {}) {
  if (!container) return NOTHING();
  const items = selector ? [...container.querySelectorAll(selector)] : [...container.children];
  const handles = items.map((item, i) => {
    const wait = delay + Math.min(i, Math.max(0, max - 1)) * stagger;
    if (calm()) {
      return play(item, [{ opacity: 0 }, { opacity: 1 }], { duration: 120, delay: Math.min(wait, 120), easing: 'linear', fill: 'backwards' }, 'enter');
    }
    return play(item, [{ opacity: 0, transform: 'translateY(12px)' }, { opacity: 1, transform: 'none' }],
      { duration: lite() ? 180 : 500, delay: lite() ? Math.min(wait, 90) : wait, easing: EASE, fill: 'backwards' }, 'enter');
  });
  return { cancel() { handles.forEach((h) => h.cancel()); }, finished: Promise.all(handles.map((h) => h.finished)).then(() => undefined) };
}

/* ---------------------------------------------------------------- press */

/* `scale` as its own property where there is one, so a press never fights an element's own transform. */
const OWN_SCALE = typeof CSS !== 'undefined' && CSS.supports && CSS.supports('scale', '1');
const scaled = (n) => (OWN_SCALE ? { scale: String(n) } : { transform: `scale(${n})` });

/* One spring pulse: in to .94 in .12 s, then out past 1 and settle. */
function press(el, { scale = 0.94 } = {}) {
  if (!el || calm()) return NOTHING();
  if (lite()) return play(el, [scaled(1), scaled(scale), scaled(1)], { duration: 160, easing: 'ease-out' }, 'press');
  return play(el, [{ ...scaled(1), offset: 0 }, { ...scaled(scale), offset: 0.28, easing: EASE }, { ...scaled(1.035), offset: 0.7 }, { ...scaled(1), offset: 1 }],
    { duration: 420, easing: SPRING }, 'press');
}
/* A pointer press that follows the finger: down to `scale` in .12 s, and a spring back when it lets go or leaves. */
press.follow = (el, { scale = 0.94 } = {}) => {
  if (!el) return () => {};
  let down = null;
  let held = null;  // the press held down (it keeps its end: cancelled when the spring back begins)
  const grow = () => {
    if (down === null) return;
    down = null;
    if (held) { held.cancel(); held = null; }
    if (calm()) return;
    play(el, [scaled(scale), scaled(1.03), scaled(1)], { duration: lite() ? 140 : 380, easing: lite() ? 'ease-out' : SPRING }, 'press');
  };
  const start = (event) => {
    if (event.button > 0) return;
    down = event.pointerId;
    if (calm()) return;
    held = play(el, [scaled(1), scaled(scale)], { duration: 120, easing: EASE, fill: 'forwards' }, 'press');
  };
  const end = (event) => { if (down !== null && (event.pointerId === down || event.pointerId === undefined)) grow(); };
  el.addEventListener('pointerdown', start);
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);
  el.addEventListener('pointerleave', end);
  return () => {
    el.removeEventListener('pointerdown', start);
    el.removeEventListener('pointerup', end);
    el.removeEventListener('pointercancel', end);
    el.removeEventListener('pointerleave', end);
    if (held) { held.cancel(); held = null; }
    take(el, 'press');
    live.delete(el);
  };
};

/* ---------------------------------------------------------------- spark */

const SPARKS = [[-17, -15], [17, -15], [-15, 16], [16, 15]];
/* The four-spark burst from the middle of `el` (a ticked box). Sparks are made, flown and removed again: nothing stays. */
function spark(el) {
  if (!el || !HAS_WAAPI || quick()) return NOTHING();
  const made = SPARKS.map(([x, y]) => {
    const dot = document.createElement('i');
    dot.className = 'g-spark';
    dot.setAttribute('aria-hidden', 'true');
    el.appendChild(dot);
    const flight = dot.animate([{ opacity: 1, transform: 'translate(0,0) scale(1)' }, { opacity: 0, transform: `translate(${x}px,${y}px) scale(.3)` }],
      { duration: 550, easing: EASE, fill: 'forwards' });
    const gone = () => dot.remove();
    flight.finished.then(gone, gone);
    return flight;
  });
  return { cancel() { made.forEach((f) => { try { f.cancel(); } catch (error) { /* gone */ } }); }, finished: Promise.all(made.map((f) => f.finished.catch(() => {}))).then(() => undefined) };
}

/* ---------------------------------------------------------------- roll */

const rolls = new WeakMap();
/* Rolling numbers: the digits of `from` turn like an odometer into those of `to`, the last digit first. It ends on exactly
   String(to) as plain text (nothing of the machinery stays). Calm or lite: the number just changes (lite: quickly). */
function roll(el, from, to, { duration = 750 } = {}) {
  if (!el) return NOTHING();
  const end = String(to);
  const before = rolls.get(el);
  if (before) before.cancel();
  if (String(from) === end || !HAS_WAAPI || calm()) { el.textContent = end; return NOTHING(); }
  const start = String(from).padStart(end.length, '0').slice(-end.length);
  const hidden = document.createElement('span');
  hidden.className = 'sr-only';
  hidden.textContent = end;
  const wheel = document.createElement('span');
  wheel.className = 'g-roll';
  wheel.setAttribute('aria-hidden', 'true');
  const columns = [];
  [...end].forEach((ch, i) => {
    if (!/[0-9]/.test(ch)) {
      const plain = document.createElement('span');
      plain.className = 'g-roll-d';
      plain.textContent = ch;
      wheel.appendChild(plain);
      return;
    }
    const digit = document.createElement('span');
    digit.className = 'g-roll-d';
    const strip = document.createElement('span');
    strip.className = 'g-roll-s';
    for (let n = 0; n < 10; n++) {
      const cell = document.createElement('span');
      cell.textContent = String(n);
      strip.appendChild(cell);
    }
    digit.appendChild(strip);
    wheel.appendChild(digit);
    columns.push({ strip, from: /[0-9]/.test(start[i]) ? Number(start[i]) : 0, to: Number(ch), place: end.length - 1 - i });
  });
  el.textContent = '';
  el.append(hidden, wheel);
  const time = lite() ? 250 : duration;
  const animations = columns.map((column) => {
    const a = (position) => `translateY(${-position * 10}%)`;
    const animation = column.strip.animate([{ transform: a(column.from) }, { transform: a(column.to) }],
      { duration: time, delay: lite() ? 0 : column.place * 70, easing: ROLL, fill: 'both' });
    return animation;
  });
  const settle = () => { if (rolls.get(el) === job) { rolls.delete(el); el.textContent = end; } };
  const job = {
    cancel() { animations.forEach((a) => { try { a.cancel(); } catch (error) { /* gone */ } }); if (rolls.get(el) === job) { rolls.delete(el); el.textContent = end; } },
    finished: Promise.all(animations.map((a) => a.finished.catch(() => {}))).then(() => { settle(); }),
  };
  rolls.set(el, job);
  return job;
}

/* ---------------------------------------------------------------- weft */

/* A thread draws itself from one end to the other. `svgPath` is a path, or an svg with one; afterwards the path is the
   plain line it was (the dashes are only there while it draws). */
function weft(svgPath, { duration = 1200, delay = 250, from = 'start' } = {}) {
  const path = svgPath && svgPath.tagName && svgPath.tagName.toLowerCase() === 'path' ? svgPath
    : svgPath && svgPath.querySelector ? svgPath.querySelector('path') : null;
  if (!path || !HAS_WAAPI || calm()) return NOTHING();
  let length = 420;
  try { length = Math.ceil(path.getTotalLength()) || length; } catch (error) { /* not drawn yet */ }
  path.style.strokeDasharray = String(length);
  const away = from === 'end' ? -length : length;
  const handle = play(path, [{ strokeDashoffset: away }, { strokeDashoffset: 0 }],
    { duration: lite() ? 300 : duration, delay: lite() ? 0 : delay, easing: EASE, fill: 'backwards' }, 'weft');
  done(handle.animation, () => { path.style.strokeDasharray = ''; });
  return handle;
}

/* ---------------------------------------------------------------- flip */

const rect = (el) => el.getBoundingClientRect();
const hiders = new WeakMap();  // fromEl -> the flip now hiding it (an older flip ending must not show it again)
/* A shared element opening: `toEl` (the note, the sheet) grows out of the box `fromEl` (the card) has on screen, with
   the board's slide spring, and settles in its own place. reverse: it shrinks back into `fromEl` and fades. `fromEl` is
   hidden meanwhile (visibility) so it looks like one thing that moved. Nothing is cloned, nothing is left behind. Where
   fromEl is out of sight or tiny, toEl just scales and fades a little. */
function flip(fromEl, toEl, { reverse = false, duration = 460, onDone } = {}) {
  if (!toEl) { if (onDone) onDone(); return NOTHING(); }
  let before = fromEl ? fromEl.style.visibility : '';
  let hidden = false;
  const mine = {};
  let watcher = null;
  /* Puts fromEl back as it was. Runs when a closing flip ends, when the flip is cancelled, and by itself when toEl leaves
     the page some other way (the note was deleted, Back was handled elsewhere): the card is never left invisible. */
  const restore = () => {
    if (watcher) { watcher.disconnect(); watcher = null; }
    if (fromEl && hidden) {
      hidden = false;
      if (hiders.get(fromEl) === mine) { hiders.delete(fromEl); fromEl.style.visibility = before; }
    }
  };
  mine.let = () => { if (watcher) { watcher.disconnect(); watcher = null; } hidden = false; };
  const hide = () => {
    if (!fromEl || reverse) return;
    const earlier = hiders.get(fromEl);
    if (earlier) before = earlier.before;  // (what it was before the older flip hid it)
    mine.before = before;
    hiders.set(fromEl, mine);
    fromEl.style.visibility = 'hidden';
    hidden = true;
    if (earlier) earlier.let();  // (the older flip lets go of it; it is mine now)
    if (window.MutationObserver && document.body) {
      watcher = new MutationObserver(() => { if (!toEl.isConnected || !fromEl.isConnected) restore(); });
      watcher.observe(document.body, { childList: true, subtree: true });
    }
  };
  const wrap = (handle) => ({
    animation: handle.animation,
    finished: handle.finished,
    cancel() { handle.cancel(); if (!reverse) restore(); },
    restore,
  });
  const ended = (animation) => {
    // (a cancelled animation is idle: it never arrived, so the card comes back; an opened one stays hidden under its note)
    const arrived = !animation || animation.playState === 'finished';
    if (reverse) {
      // (closing: the card an opening hid comes back; a closing that was itself cut short leaves it to whatever came next)
      if (arrived && fromEl) {
        const held = hiders.get(fromEl);
        if (held) { held.let(); hiders.delete(fromEl); }
        fromEl.style.visibility = held ? held.before : before;
      }
    } else if (!arrived) restore();
    if (onDone) onDone();
  };
  if (calm() || !HAS_WAAPI) {
    hide();
    const fade = play(toEl, reverse ? [{ opacity: 1 }, { opacity: 0 }] : [{ opacity: 0 }, { opacity: 1 }], { duration: 120, easing: 'linear', fill: reverse ? 'forwards' : 'backwards' }, 'flip');
    if (fade.animation) done(fade.animation, () => ended(fade.animation)); else ended(null);
    return wrap(fade);
  }
  const to = rect(toEl);
  const from = fromEl ? rect(fromEl) : null;
  const usable = from && from.width > 10 && from.height > 10 && to.width > 0 && to.height > 0
    && from.bottom > 0 && from.top < window.innerHeight && from.right > 0 && from.left < window.innerWidth;
  const small = usable
    ? { transform: `translate(${from.left - to.left}px,${from.top - to.top}px) scale(${from.width / to.width},${from.height / to.height})` }
    : { transform: 'scale(.96)' };
  const style = toEl.style;
  const origin = style.transformOrigin;
  style.transformOrigin = '0 0';
  hide();
  const frames = reverse ? [{ transform: 'none', opacity: 1 }, { ...small, opacity: 0 }] : [{ ...small, opacity: usable ? 0.55 : 0 }, { transform: 'none', opacity: 1 }];
  const handle = play(toEl, frames, {
    duration: lite() ? 220 : duration, easing: reverse ? 'cubic-bezier(.3,.9,.3,1)' : SLIDE, fill: reverse ? 'forwards' : 'backwards',
  }, 'flip');
  if (handle.animation) done(handle.animation, () => { style.transformOrigin = origin; ended(handle.animation); });
  else { style.transformOrigin = origin; ended(null); }
  return wrap(handle);
}

/* ---------------------------------------------------------------- swipe */

/* Swipe a card sideways. `el` is the row's wrapper and its first child the card that moves (or `card`). right / left turn a
   direction on ({ label, className } for the colour behind, or just true). Past `threshold` px (80) the card is "armed"
   (data-armed on el, a buzz) and letting go flies it off and says onCommit('right'|'left', el); below it springs back.
   Vertical scrolling still works (touch-action: pan-y; only a mostly sideways move starts it). Returns { destroy() }. */
function swipe(el, { left = null, right = null, onCommit, threshold = 80, max = 150, card = null } = {}) {
  if (!el) return { destroy() {} };
  const moving = () => card || el.firstElementChild;
  let g = null;
  const previousAction = el.style.touchAction;
  el.style.touchAction = 'pan-y';
  const sides = { right: right || null, left: left || null };
  const back = el.querySelector(':scope > .g-swipe-back');
  let flying = false;       // a card is flying off or springing back: a new touch waits until it has landed
  const drops = new Set();  // click swallowers still listening
  const timers = new Set(); // what is still to happen (so destroy() can drop it)
  const later = (fn, ms) => { const id = setTimeout(() => { timers.delete(id); fn(); }, ms); timers.add(id); return id; };
  const reset = () => {
    const c = moving();
    if (c) { c.style.transform = ''; c.style.transition = ''; }
    ['data-swiping', 'data-dir', 'data-armed'].forEach((a) => el.removeAttribute(a));
    if (back) back.style.opacity = '';
  };
  const down = (event) => {
    if (event.button > 0 || g || flying) return;
    g = { id: event.pointerId, x: event.clientX, y: event.clientY, mode: 'wait', dx: 0, armed: false, dir: '' };
  };
  const move = (event) => {
    if (!g || event.pointerId !== g.id) return;
    const dx = event.clientX - g.x, dy = event.clientY - g.y;
    if (g.mode === 'wait') {
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
      if (Math.abs(dx) > Math.abs(dy) * 1.2 && (dx > 0 ? sides.right : sides.left)) {
        g.mode = 'swipe';
        el.setAttribute('data-swiping', '1');
        try { el.setPointerCapture(event.pointerId); } catch (error) { /* fine without */ }
        const c = moving();
        if (c) c.style.transition = 'none';
      } else { g.mode = 'none'; return; }
    }
    if (g.mode !== 'swipe') return;
    const wanted = dx >= 0 ? 'right' : 'left';
    // a side that is not turned on does not move past a little give
    const enabled = !!sides[wanted];
    const reach = enabled ? Math.abs(dx) : Math.min(Math.abs(dx), 14) * 0.3;
    const x = (reach <= max ? reach : max + (reach - max) * 0.3) * (dx >= 0 ? 1 : -1);
    g.dx = x;
    const c = moving();
    if (c) c.style.transform = `translateX(${x.toFixed(1)}px)`;
    if (g.dir !== wanted) { g.dir = wanted; el.setAttribute('data-dir', wanted === 'right' ? 'r' : 'l'); }
    if (back) back.style.opacity = String(Math.min(1, Math.abs(x) / 56));
    const armed = enabled && Math.abs(x) >= threshold;
    if (armed !== g.armed) { g.armed = armed; el.setAttribute('data-armed', armed ? '1' : '0'); if (armed) buzz(8); }
  };
  const end = (event, cancelled) => {
    if (!g || (event && event.pointerId !== g.id)) return;
    const was = g;
    g = null;
    if (was.mode !== 'swipe') return;
    // The click that ends a swipe is not a tap. It is swallowed until it has come (a touch's synthesized click arrives a
    // little after the finger lifts) or 350 ms have gone, whichever is first.
    const swallow = (ev) => { ev.stopPropagation(); ev.preventDefault(); drop(); };
    let dropId = 0;
    const drop = () => { window.removeEventListener('click', swallow, true); clearTimeout(dropId); timers.delete(dropId); drops.delete(drop); };
    drops.add(drop);
    window.addEventListener('click', swallow, true);
    dropId = later(drop, 350);
    const c = moving();
    if (!c) { reset(); return; }
    const quickly = calm() || lite();
    flying = true;
    if (was.armed && !cancelled) {
      const side = was.dx > 0 ? 'right' : 'left';
      c.style.transition = `transform ${quickly ? '.12s' : '.26s'} ${EXIT}, opacity ${quickly ? '.12s' : '.26s'} linear`;
      c.style.transform = `translateX(${side === 'right' ? 460 : -460}px)`;
      c.style.opacity = '0';
      later(() => {
        flying = false;
        c.style.opacity = '';
        reset();
        if (onCommit) onCommit(side, el);
      }, quickly ? 140 : 270);
    } else {
      c.style.transition = quickly ? 'transform .14s ease-out' : `transform .46s ${SLIDE}`;
      c.style.transform = 'translateX(0px)';
      if (back) { back.style.transition = 'opacity .2s ease'; back.style.opacity = '0'; }
      later(() => { flying = false; if (back) back.style.transition = ''; reset(); }, quickly ? 160 : 480);
    }
  };
  const up = (event) => end(event, false);
  const cancel = (event) => end(event, true);
  el.addEventListener('pointerdown', down);
  el.addEventListener('pointermove', move);
  el.addEventListener('pointerup', up);
  el.addEventListener('pointercancel', cancel);
  return {
    destroy() {
      el.removeEventListener('pointerdown', down);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', cancel);
      el.style.touchAction = previousAction;
      for (const id of timers) clearTimeout(id);  // (no commit or spring-back lands after this)
      for (const drop of [...drops]) drop();
      timers.clear();
      flying = false;
      g = null;
      reset();
      const c = moving();
      if (c) c.style.opacity = '';
    },
  };
}

/* ---------------------------------------------------------------- pull */

/* Pull down at the top of `scroller` to sync: its content (the first child, or `wrap`) follows the finger with some
   resistance and a hint ("Pull to sync", "Let go to sync", "Syncing...", "Synced") shows above it. Past 64 px it is
   armed; letting go then calls onRelease(), holds at 44 px until what it returns settles (or its done() is called),
   then springs back. Less than that springs back at once. Touch uses touch events (a page scroll must stay possible) and
   a mouse uses pointer events. Returns { destroy() }. */
function pull(scroller, { onRelease, wrap = null, threshold = 64, labels = {} } = {}) {
  if (!scroller) return { destroy() {} };
  const words = { pull: 'Pull to sync', ready: 'Let go to sync', syncing: 'Syncing...', synced: 'Synced', ...labels };
  // (the content that follows the finger is the first child that is not the hint or the screen-reader line)
  let hint = scroller.querySelector(':scope > .g-pull-hint');
  const body = () => wrap || [...scroller.children].find((child) => child !== hint && !child.classList.contains('sr-only')) || null;
  const madeHint = !hint;
  if (!hint) {
    hint = document.createElement('div');
    hint.className = 'g-pull-hint';
    hint.setAttribute('aria-hidden', 'true');
    scroller.insertBefore(hint, scroller.firstChild);
  }
  const status = document.createElement('span');  // what a screen reader hears
  status.className = 'sr-only';
  status.setAttribute('role', 'status');
  scroller.appendChild(status);
  let drag = null;
  let busy = false;
  let phase = '';
  const say = (key) => { hint.textContent = words[key] || ''; };
  const set = (y, instant) => {
    const target = body();
    if (!target) return;
    target.style.transition = instant ? 'none' : `transform ${quick() ? '.2s ease' : `.5s ${SLIDE}`}`;
    target.style.transform = y ? `translate3d(0,${y.toFixed(1)}px,0)` : '';
    hint.style.transition = instant ? 'none' : 'opacity .2s ease';
    hint.style.opacity = String(Math.min(1, y / 36));
  };
  const settleBack = () => {
    set(0, false);
    const target = body();
    setTimeout(() => {
      if (target) { target.style.transition = ''; target.style.transform = ''; }
      hint.style.opacity = ''; hint.style.transition = '';
      busy = false; phase = ''; status.textContent = '';
      scroller.removeAttribute('data-phase');
    }, quick() ? 220 : 520);
  };
  const begin = (x, y, pointerId) => {
    if (busy || scroller.scrollTop > 0) return false;
    drag = { x, y, on: false, p: 0, pointerId };
    return true;
  };
  const track = (x, y) => {
    if (!drag) return false;
    const dy = y - drag.y, dx = x - drag.x;
    if (!drag.on) {
      if (dy < -4 || Math.abs(dx) > Math.max(8, dy)) { drag = null; return false; }
      if (dy < 6 || scroller.scrollTop > 0) return false;
      drag.on = true;
      // (the mouse is captured only once it is really pulling: a plain click on a button inside must still reach the button)
      if (drag.pointerId !== undefined) { try { scroller.setPointerCapture(drag.pointerId); } catch (error) { /* fine without */ } }
    }
    const p = 120 * (1 - Math.exp(-Math.max(0, dy - 6) / 190));
    drag.p = p;
    set(p, true);
    const next = p >= threshold ? 'ready' : 'pull';
    if (next !== phase) { phase = next; say(next); scroller.setAttribute('data-phase', next); if (next === 'ready') buzz(8); }
    return true;
  };
  const release = () => {
    const d = drag;
    drag = null;
    if (!d || !d.on) return;
    if (d.p >= threshold && onRelease && !busy) {
      busy = true;
      say('syncing'); status.textContent = words.syncing; scroller.setAttribute('data-phase', 'syncing');
      set(44, false);
      let ended = false;
      const over = (ok) => {
        if (ended) return;
        ended = true;
        say(ok === false ? 'pull' : 'synced'); status.textContent = ok === false ? '' : words.synced;
        scroller.setAttribute('data-phase', ok === false ? '' : 'synced');
        setTimeout(settleBack, quick() ? 250 : 650);
      };
      let result;
      try { result = onRelease(over); } catch (error) { over(false); return; }
      if (result && typeof result.then === 'function') result.then(() => over(true), () => over(false));
      else if (onRelease.length === 0) over(true);
    } else settleBack();
  };
  // a mouse (pointer events) ...
  // (the mouse is captured once it pulls, so letting go outside the scroller still ends the pull)
  const pdown = (event) => {
    if (event.pointerType === 'touch' || event.button !== 0) return;
    begin(event.clientX, event.clientY, event.pointerId);
  };
  const pmove = (event) => { if (event.pointerType !== 'touch') track(event.clientX, event.clientY); };
  const pup = (event) => {
    if (event.pointerType === 'touch') return;
    try { scroller.releasePointerCapture(event.pointerId); } catch (error) { /* not held */ }
    release();
  };
  // ... and a finger (touch events, which can stop the page scrolling while the pull is on)
  const tstart = (event) => { if (event.touches.length === 1) begin(event.touches[0].clientX, event.touches[0].clientY); };
  const tmove = (event) => {
    if (!event.touches.length) return;
    if (track(event.touches[0].clientX, event.touches[0].clientY) && event.cancelable) event.preventDefault();
  };
  const tend = () => release();
  scroller.addEventListener('pointerdown', pdown);
  scroller.addEventListener('pointermove', pmove);
  scroller.addEventListener('pointerup', pup);
  scroller.addEventListener('pointercancel', pup);
  scroller.addEventListener('lostpointercapture', pup);
  scroller.addEventListener('touchstart', tstart, { passive: true });
  scroller.addEventListener('touchmove', tmove, { passive: false });
  scroller.addEventListener('touchend', tend);
  scroller.addEventListener('touchcancel', tend);
  return {
    destroy() {
      for (const [type, fn] of [['pointerdown', pdown], ['pointermove', pmove], ['pointerup', pup], ['pointercancel', pup], ['lostpointercapture', pup], ['touchstart', tstart], ['touchmove', tmove], ['touchend', tend], ['touchcancel', tend]]) {
        scroller.removeEventListener(type, fn);
      }
      const target = body();
      if (target) { target.style.transition = ''; target.style.transform = ''; }
      if (madeHint) hint.remove();
      status.remove();
      scroller.removeAttribute('data-phase');
    },
  };
}

/* ---------------------------------------------------------------- peek */

/* Press and hold on `el` (450 ms, without moving more than 8 px): onPeek({ el, x, y }) returns the element to show (or
   null), which floats up near the finger on a soft glass and goes again when the finger lets go (or after `sticky` is
   closed with the returned close()). Right-click menus and a phone's own long-press menu are held off while it shows.
   Returns { destroy() }. */
function peek(el, { onPeek, hold = 450, sticky = false } = {}) {
  if (!el) return { destroy() {} };
  let timer = 0;
  let start = null;
  let shown = null;
  const close = () => {
    const s = shown;
    shown = null;
    if (!s) return;
    const gone = () => s.remove();
    if (calm() || !HAS_WAAPI) { gone(); return; }
    const a = s.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'scale(.95)' }], { duration: 160, easing: 'ease-out', fill: 'forwards' });
    a.finished.then(gone, gone);
  };
  const show = () => {
    timer = 0;
    if (!start || shown) return;
    let content = null;
    try { content = onPeek ? onPeek({ el, x: start.x, y: start.y, close }) : null; } catch (error) { console.error(error); }
    if (!content) return;
    const box = document.createElement('div');
    box.className = 'g-peek';
    box.setAttribute('role', 'dialog');
    box.append(content);
    document.body.appendChild(box);
    const r = rect(el);
    const w = box.offsetWidth, h = box.offsetHeight;
    const below = r.bottom + 14 + h < window.innerHeight - 12;
    box.style.left = `${Math.max(12, Math.min(window.innerWidth - w - 12, r.left + (r.width - w) / 2))}px`;
    box.style.top = `${Math.max(12, below ? r.bottom + 14 : r.top - 14 - h)}px`;
    shown = box;
    buzz(10);
    play(box, [{ opacity: 0, transform: 'translateY(8px) scale(.94)' }, { opacity: 1, transform: 'none' }],
      { duration: calm() ? 120 : lite() ? 160 : 320, easing: calm() || lite() ? 'ease-out' : SPRING, fill: 'backwards' }, 'peek');
  };
  const down = (event) => {
    if (event.button > 0) return;
    start = { x: event.clientX, y: event.clientY, id: event.pointerId };
    clearTimeout(timer);
    timer = setTimeout(show, hold);
  };
  const move = (event) => {
    if (!start || event.pointerId !== start.id || shown) return;
    if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > 8) { clearTimeout(timer); timer = 0; start = null; }
  };
  const up = () => {
    clearTimeout(timer); timer = 0; start = null;
    if (!sticky) close();
  };
  const menu = (event) => { if (shown || timer) event.preventDefault(); };
  el.addEventListener('pointerdown', down);
  el.addEventListener('pointermove', move);
  el.addEventListener('pointerup', up);
  el.addEventListener('pointercancel', up);
  el.addEventListener('contextmenu', menu);
  return {
    close,
    destroy() {
      clearTimeout(timer);
      el.removeEventListener('pointerdown', down);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      el.removeEventListener('contextmenu', menu);
      if (shown) { shown.remove(); shown = null; }
    },
  };
}

/* ---------------------------------------------------------------- shrink */

let shrinks = 0;  // names the scroll timelines apart
const SCROLL_DRIVEN = typeof CSS !== 'undefined' && CSS.supports && CSS.supports('animation-timeline', 'scroll()');
/* A large title (`title`) that shrinks and fades as `scroller` scrolls, while a slim glass `bar` fades in under the top
   edge. Where CSS scroll-driven animations exist the stylesheet does it (classes g-shrink-title and g-shrink-bar, no
   script work at all); elsewhere one passive scroll listener writes once per frame. `force: 'js'` uses the script.
   Returns { destroy() }. */
function shrink(scroller, title, { bar = null, distance = 84, force = '' } = {}) {
  if (!scroller || !title) return { destroy() {} };
  if (calm()) { return { destroy() {} }; }
  if (SCROLL_DRIVEN && force !== 'js') {
    // The scroller gets a named scroll timeline and the title / bar follow it (rules in glass.css); a title or bar outside
    // the scroller needs the name in scope on an ancestor they share. The compositor does the rest: no script per frame.
    const name = `--g-shrink-${++shrinks}`;
    let scope = scroller;
    while (scope && !(scope.contains(title) && (!bar || scope.contains(bar)))) scope = scope.parentElement;
    const before = { timeline: scroller.style.scrollTimeline, scope: scope && scope !== scroller ? scope.style.timelineScope : '' };
    scroller.style.scrollTimeline = `${name} block`;
    if (scope && scope !== scroller) scope.style.timelineScope = name;
    title.style.animationTimeline = name;
    title.style.setProperty('--g-shrink-d', `${distance}px`);
    title.classList.add('g-shrink-title');
    if (bar) { bar.style.animationTimeline = name; bar.style.setProperty('--g-shrink-d', `${distance}px`); bar.classList.add('g-shrink-bar'); }
    return {
      destroy() {
        title.classList.remove('g-shrink-title');
        title.style.animationTimeline = ''; title.style.removeProperty('--g-shrink-d');
        if (bar) { bar.classList.remove('g-shrink-bar'); bar.style.animationTimeline = ''; bar.style.removeProperty('--g-shrink-d'); }
        scroller.style.scrollTimeline = before.timeline;
        if (scope && scope !== scroller) scope.style.timelineScope = before.scope;
      },
    };
  }
  let frame = 0;
  title.style.transformOrigin = '0 0';
  const paint = () => {
    frame = 0;
    const y = Math.max(0, scroller.scrollTop);
    const p = Math.min(1, y / distance);
    title.style.transform = `translate3d(0,${(p * 18).toFixed(1)}px,0) scale(${(1 - p * 0.16).toFixed(3)})`;
    title.style.opacity = String(Math.max(0, 1 - p * 1.25));
    if (bar) {
      const q = Math.min(1, Math.max(0, (y - distance * 0.62) / (distance * 0.52)));
      bar.style.opacity = String(q);
      bar.style.transform = `translate3d(0,${((1 - q) * -8).toFixed(1)}px,0)`;
      bar.style.pointerEvents = q > 0.6 ? 'auto' : 'none';
    }
  };
  const onScroll = () => { if (!frame) frame = requestAnimationFrame(paint); };
  scroller.addEventListener('scroll', onScroll, { passive: true });
  paint();
  return {
    destroy() {
      scroller.removeEventListener('scroll', onScroll);
      if (frame) cancelAnimationFrame(frame);
      title.style.transform = ''; title.style.opacity = ''; title.style.transformOrigin = '';
      if (bar) { bar.style.opacity = ''; bar.style.transform = ''; bar.style.pointerEvents = ''; }
    },
  };
}

/* ---------------------------------------------------------------- watch */

/* The frame-drop monitor: for `seconds` it measures the time between frames; if a third of them took over 40 ms (a
   cheap Chromebook with blur on) the device is too slow for the full look: lite from now on (kept per device, until
   Animations is set to Full). Only run once Wefty has something moving, so a page sitting still costs nothing. */
let watching = 0;  // the sampling window now running (a newer call replaces it)
function watch(seconds = 5) {
  if (!window.requestAnimationFrame || document.hidden || lite() || (V.look && V.look.animations && V.look.animations() === 'full')) return;
  const mine = ++watching;
  let last = 0, frames = 0, slow = 0;
  const stop = performance.now() + seconds * 1000;
  const tick = (now) => {
    if (mine !== watching) return;
    if (document.hidden) { watching = 0; return; }  // a hidden page's frames mean nothing
    if (last) { frames++; if (now - last > 40) slow++; }
    last = now;
    if (now < stop) { requestAnimationFrame(tick); return; }
    watching = 0;
    // (a page that managed only a few frames in the whole window is the slowest kind: it counts, it isn't left unjudged)
    if (frames >= 3 && slow / frames > 0.33) lite(true);
  };
  requestAnimationFrame(tick);
}

V.motion = { enter, press, spark, roll, weft, flip, swipe, pull, peek, shrink, lite, calm, watch, EASE, SLIDE, SPRING };
})();
