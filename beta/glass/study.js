/* Wefty 2.0 "glass", area: Study. This file belongs to the Study builder; nobody else edits it.
   Studying (js/review.js, learn.js, study.js, exams.js): the flash card screen, Learn and Test me, the end of a go, tests and their countdowns.
   Rules (vault/web/glass/README.md has the rest): everything here is inert unless V.look.isGlass() (and listen to V.on('look') so the switch works live); use the tokens in
   glass.css (--g-*, and the app's own names, which glass redefines); only transform and opacity animate; call
   V.motion's helpers instead of writing your own; nothing here changes the classic look.

   What this file does (the look itself is study.css):
     - the card's moves (js/review.js tells of each one just before it draws the card again: V.emit('study-move',
       { card, kind })). The card as it was is copied (a "ghost", never focusable, hidden from screen readers) and the
       two move together:
         flip / unflip   a real turn in 3D: the ghost turns away from 0 to 180 degrees while the card turns in from -180
                         to 0, each with its back hidden, on one spring that settles (two animations of the same length
                         and curve started together, so nothing hands over mid-turn and nothing stalls)
         know            "I know it": a green stamp and glow on the ghost, which flies off to the right; sparks from the
                         button; the next card rises from the pile
         still           "Still learning": a violet stamp; the ghost slides gently back down into the pile (no shake)
                         while the next card rises over it
         next, skip      a plain slide: the ghost goes left, the next card comes in from the right
         back            the card before comes back in from the left; the one showing goes back into the pile
       Calm: a 120 ms crossfade, nothing moves. Lite: shorter, no overshoot, no stamps or sparks.
     - the pile under the card (how many are left: the count "4 of 31" tells), and the progress thread (a wavy line
       that fills smoothly: the app's own thin bar says how far, an SVG weft draws it)
     - the end of a go: the check is drawn, sparks fly once, the edge light blooms (V.emit('edge', 'done'))
     - Learn / Test me: each new question slides in (its choices one after the other); a right pick sparks from its
       check (study.css does the green, the pulse, the red and the soft shake)
   Everything it adds is taken away again when the look goes back to classic. */
'use strict';

(() => {
const V = window.V;
if (!V) return;

const on = () => !!(V.look && V.look.isGlass && V.look.isGlass());
const M = () => V.motion || null;
const calm = () => !!(M() && M().calm());
const lite = () => !!(M() && M().lite());
const HAS_WAAPI = typeof Element !== 'undefined' && typeof Element.prototype.animate === 'function';
const SPRING_TURN = 'cubic-bezier(.3,1.22,.4,1)';   // the board's flip: a turn that settles with a small overshoot
const SLIDE = 'cubic-bezier(.25,1.18,.35,1)';        // the board's slides and springs
const EASE = 'cubic-bezier(.2,.8,.2,1)';
const THROW = 'cubic-bezier(.32,.55,.5,1)';          // off it goes: moving from the very first frame, easing off as it leaves
const SVG = 'http://www.w3.org/2000/svg';

/* ---------------------------------------------------------------- the card's moves */

let running = [];   // the animations of the move now running (a new move finishes them first)
let ghosts = [];    // the copies they fly

function settleAll() {
  for (const a of running) { try { a.finish(); } catch (error) { try { a.cancel(); } catch (e) { /* gone */ } } }
  running = [];
  for (const g of ghosts) g.remove();
  ghosts = [];
}

function anim(el, frames, options) {
  if (!el || !HAS_WAAPI) return null;
  let a = null;
  try { a = el.animate(frames, options); } catch (error) { return null; }
  running.push(a);
  const drop = () => { running = running.filter((x) => x !== a); };
  a.finished.then(drop, drop);
  return a;
}

/* A copy of the card as it is now, laid exactly over it, in the study screen's layer (outside the panel: the card itself
   never moves and keeps its place, so nothing in the panel is ever measured mid-flight). */
function copyOf(card, layer) {
  const copy = card.cloneNode(true);
  copy.classList.add('g-study-ghost');
  copy.classList.remove('turned', 'g-turning');
  copy.removeAttribute('id');
  copy.setAttribute('aria-hidden', 'true');
  copy.setAttribute('tabindex', '-1');
  copy.inert = true;
  for (const el of copy.querySelectorAll('[id]')) el.removeAttribute('id');
  const l = layer.getBoundingClientRect();
  const r = card.getBoundingClientRect();
  // (CSS zoom: the boxes are in screen pixels, the layer's own lengths in its own)
  const zoom = layer.offsetWidth ? l.width / layer.offsetWidth : 1;
  Object.assign(copy.style, {
    position: 'absolute', margin: '0', left: `${(r.left - l.left) / zoom}px`, top: `${(r.top - l.top) / zoom}px`,
    width: `${r.width / zoom}px`, height: `${r.height / zoom}px`, pointerEvents: 'none', zIndex: '5',
  });
  return copy;
}

function stamp(ghost, kind) {
  const label = document.createElement('span');
  label.className = `g-study-stamp ${kind}`;  // (top right, clear of the card's "Answer")
  label.textContent = kind === 'know' ? 'I know it' : 'Still learning';
  ghost.append(label);
}

/* Sparks from a button (V.motion.spark draws them in a box of their own over it, in the layer: the button clips what it holds). */
function sparkFrom(button, layer) {
  if (!button || !layer || !M() || lite() || calm()) return;
  const host = document.createElement('span');
  host.className = 'g-study-sparks';
  host.setAttribute('aria-hidden', 'true');
  const b = button.getBoundingClientRect();
  const l = layer.getBoundingClientRect();
  const zoom = layer.offsetWidth ? l.width / layer.offsetWidth : 1;
  Object.assign(host.style, { left: `${(b.left - l.left + b.width / 2) / zoom}px`, top: `${(b.top - l.top + b.height / 2) / zoom}px` });
  layer.append(host);
  ghosts.push(host);
  const handle = M().spark(host);
  const gone = () => { host.remove(); ghosts = ghosts.filter((g) => g !== host); };
  if (handle && handle.finished) handle.finished.then(gone, gone); else setTimeout(gone, 700);
}

let pendingMove = null;

V.on('study-move', (detail) => {
  if (!on() || !detail || !detail.card) return;
  const { card, kind } = detail;
  settleAll();
  const layer = card.closest('.study-layer');
  if (!card.isConnected || !layer || !HAS_WAAPI) return;
  const move = { card, kind, layer, ghost: copyOf(card, layer), button: null };
  if (/^(know|still|next)$/.test(kind)) {
    const panel = card.closest('.study');
    move.button = panel ? panel.querySelector(`.study-btn[data-answer=${kind}]`) : null;
  }
  pendingMove = move;
  // (the card is drawn again right after this, in the same task: the move runs once that's done)
  queueMicrotask(() => { if (pendingMove === move) { pendingMove = null; play(move); } });
});

/* The card itself waits, unseen but in its place, while its copies move; it shows again the moment they've arrived
   (where it is, so nothing jumps). */
function hold(card, time) {
  return anim(card, [{ opacity: 0 }, { opacity: 0 }], { duration: time, fill: 'none' });
}

function play(move) {
  const { card, kind, ghost, layer } = move;
  if (!layer.isConnected) return;
  const there = card.isConnected && !!card.closest('.study-stage');
  const gone = (el) => () => { el.remove(); ghosts = ghosts.filter((g) => g !== el); };
  const put = (el) => { ghosts.push(el); layer.append(el); };
  if (calm()) {
    // nothing moves: the card as it was fades away over the new one
    put(ghost);
    const a = anim(ghost, [{ opacity: 1 }, { opacity: 0 }], { duration: 120, easing: 'linear', fill: 'forwards' });
    if (a) a.finished.then(gone(ghost), gone(ghost)); else gone(ghost)();
    return;
  }
  const quick = lite();
  const fresh = there ? copyOf(card, layer) : null;
  if (kind === 'flip' || kind === 'unflip') {
    if (!fresh) { return; }
    const way = kind === 'flip' ? 1 : -1;
    const time = quick ? 260 : 640;
    const easing = quick ? EASE : SPRING_TURN;
    const persp = 'perspective(1200px)';
    for (const el of [ghost, fresh]) { el.classList.add('g-turning'); put(el); }
    hold(card, time);
    const a = anim(ghost, [{ transform: `${persp} rotateY(0deg)` }, { transform: `${persp} rotateY(${180 * way}deg)` }],
      { duration: time, easing, fill: 'forwards' });
    const b = anim(fresh, [{ transform: `${persp} rotateY(${-180 * way}deg)` }, { transform: `${persp} rotateY(0deg)` }],
      { duration: time, easing, fill: 'forwards' });
    // the card lifts a little as it turns and sets down again (its own property, so it never fights the turn)
    if (!quick) {
      for (const el of [ghost, fresh]) anim(el, [{ scale: '1' }, { scale: '1.035' }, { scale: '1' }], { duration: time * 0.8, easing: 'ease-in-out' });
    }
    const end = () => { gone(ghost)(); gone(fresh)(); };
    Promise.all([a, b].filter(Boolean).map((x) => x.finished.catch(() => {}))).then(end, end);
    return;
  }
  // The others: the ghost leaves, the card (if there's one still) comes in. Words never show through words: a ghost on top
  // stays solid until it's nearly gone; a ghost going under the new card lets its words go first.
  ghost.classList.add('g-leaving', `g-${kind}`);
  let out;
  let over = true;      // whether the ghost is drawn over the card coming in
  let empties = false;  // whether the ghost's words fade first (it goes under)
  let into = 'pile';
  if (kind === 'know') {
    if (!quick) stamp(ghost, 'know');
    out = [{ transform: 'none', opacity: 1 }, { opacity: 1, offset: 0.62 }, { transform: 'translate3d(122%,-18px,0) rotate(10deg)', opacity: 0 }];
  } else if (kind === 'still') {
    if (!quick) stamp(ghost, 'still');
    out = [{ transform: 'none', opacity: 1 }, { opacity: 1, offset: 0.35 }, { transform: 'translate3d(0,20px,0) scale(.9)', opacity: 0 }];
    over = false;
    empties = true;
  } else if (kind === 'back') {
    out = [{ transform: 'none', opacity: 1 }, { opacity: 1, offset: 0.45 }, { transform: 'translate3d(0,16px,0) scale(.92)', opacity: 0 }];
    over = false;
    empties = true;
    into = 'left';
  } else {  // next, skip: a plain slide
    out = [{ transform: 'none', opacity: 1 }, { opacity: 1, offset: 0.55 }, { transform: 'translate3d(-72%,0,0) rotate(-3deg)', opacity: 0 }];
    into = 'right';
  }
  if (fresh && !over) put(ghost);
  if (fresh) put(fresh);
  if (!fresh || over) put(ghost);
  const outTime = quick ? 200 : kind === 'know' ? 440 : kind === 'still' ? 460 : kind === 'back' ? 420 : 380;
  // (one curve for the whole way: moving from the first frame, easing off as it leaves; no keyframe of its own easing)
  const a = anim(ghost, out, { duration: outTime, easing: kind === 'still' || kind === 'back' ? EASE : THROW, fill: 'forwards' });
  if (a) a.finished.then(gone(ghost), gone(ghost)); else gone(ghost)();
  if (empties && !quick) {
    for (const part of ghost.querySelectorAll(':scope > :not(.g-study-stamp)')) {
      anim(part, [{ opacity: 1 }, { opacity: 0 }], { duration: kind === 'still' ? 200 : 130, delay: kind === 'still' ? 70 : 0, easing: 'linear', fill: 'forwards' });
    }
  }
  if (move.button && !quick && M()) M().press(move.button, { scale: 0.95 });
  if (kind === 'know' && move.button) sparkFrom(move.button, layer);
  if (!fresh) return;  // (the end: its own entrance)
  const from = into === 'left' ? { transform: 'translate3d(-118%,0,0) rotate(-7deg)', opacity: 1 }
    : into === 'right' ? { transform: 'translate3d(64px,0,0) scale(.97)', opacity: 0 }
      : { transform: 'translate3d(0,18px,0) scale(.93)', opacity: 0 };
  const time = quick ? 220 : into === 'left' ? 560 : 500;
  const delay = quick ? 0 : kind === 'know' ? 90 : kind === 'still' ? 150 : 30;
  hold(card, time + delay);
  const frames = into === 'left' ? [from, { transform: 'none', opacity: 1 }] : [from, { opacity: 1, offset: 0.4 }, { transform: 'none', opacity: 1 }];
  const c = anim(fresh, frames, { duration: time, delay, easing: quick ? EASE : SLIDE, fill: 'both' });
  if (c) c.finished.then(gone(fresh), gone(fresh)); else gone(fresh)();
}

/* ---------------------------------------------------------------- the screen: the pile, the thread, the end */

const watched = new WeakSet();

function bind(layer) {
  if (!on() || !layer) return;
  const panel = layer.querySelector('.study');
  if (!panel) return;
  thread(panel);
  pile(panel);
  if (watched.has(layer)) return;
  watched.add(layer);
  // The first card rises from the pile as the screen fades in.
  requestAnimationFrame(() => {
    const card = panel.querySelector('.study-stage > .flash-card');
    if (!card || !on() || calm() || !HAS_WAAPI || pendingMove || running.length) return;
    const copy = copyOf(card, layer);
    ghosts.push(copy);
    layer.append(copy);
    const quick = lite();
    const time = quick ? 200 : 560;
    hold(card, time + 80);
    const a = anim(copy, [{ transform: 'translate3d(0,26px,0) scale(.92)', opacity: 0 }, { opacity: 1, offset: 0.35 }, { transform: 'none', opacity: 1 }],
      { duration: time, delay: quick ? 0 : 80, easing: quick ? EASE : SLIDE, fill: 'both' });
    const gone = () => { copy.remove(); ghosts = ghosts.filter((g) => g !== copy); };
    if (a) a.finished.then(gone, gone); else gone();
  });
  // (the count and the stage change with each card: the pile follows the count, the end and Learn are looked at)
  const observer = new MutationObserver((records) => {
    if (!on()) return;
    let stageChanged = false;
    let lineChanged = false;
    for (const r of records) {
      if (r.type === 'attributes') { thread(panel); continue; }
      const el = r.target.nodeType === 1 ? r.target : r.target.parentElement;
      if (el && el.closest('.study-line')) lineChanged = true;
      else stageChanged = true;
    }
    if (lineChanged) pile(panel);
    if (stageChanged) look(panel);
  });
  const fill = panel.querySelector('.study-bar i');
  if (fill) observer.observe(fill, { attributes: true, attributeFilter: ['style'] });
  const line = panel.querySelector('.study-line');
  if (line) observer.observe(line, { childList: true, characterData: true, subtree: true });
  const stage = panel.querySelector('.study-stage');
  if (stage) observer.observe(stage, { childList: true, subtree: true });
  look(panel);
}

/* The thread under the count: a wavy line drawn as far as the app's bar says. */
function thread(panel) {
  const where = panel.querySelector('.study-where');
  const fill = panel.querySelector('.study-bar i');
  if (!where || !fill) return;
  let svg = where.querySelector(':scope > svg.g-study-weft');
  const part = Math.max(0, Math.min(1, (parseFloat(fill.style.width) || 0) / 100));
  if (!svg) {
    svg = document.createElementNS(SVG, 'svg');
    svg.setAttribute('class', 'g-study-weft');
    svg.setAttribute('aria-hidden', 'true');
    for (const cls of ['g-weft-track', 'g-weft-fill']) {
      const path = document.createElementNS(SVG, 'path');
      path.setAttribute('class', cls);
      path.setAttribute('pathLength', '100');
      svg.append(path);
    }
    const bar = where.querySelector('.study-bar');
    if (bar) bar.after(svg); else where.append(svg);
    where.classList.add('g-has-weft');
    wave(svg);
    if (typeof ResizeObserver === 'function') new ResizeObserver(() => wave(svg)).observe(svg);
    svg.style.setProperty('--g-part', String(part));
    svg.getBoundingClientRect();  // (the first fill is where it is, not drawn in)
    svg.classList.add('g-ready');
    return;
  }
  svg.style.setProperty('--g-part', String(part));
}

/* The thread's wave, made for its own width (one hump every 45 px or so, never stretched). */
function wave(svg) {
  const width = Math.max(40, Math.round(svg.clientWidth || 358));
  if (svg.dataset.width === String(width)) return;
  svg.dataset.width = String(width);
  svg.setAttribute('viewBox', `0 0 ${width} 12`);
  const n = Math.max(2, Math.round((width - 4) / 45));
  const step = (width - 4) / n;
  let d = 'M2 6';
  for (let i = 0; i < n; i++) {
    const x = 2 + i * step;
    const y = i % 2 ? 11 : 1;
    d += ` C ${(x + step / 3).toFixed(1)} ${y}, ${(x + (2 * step) / 3).toFixed(1)} ${y}, ${(x + step).toFixed(1)} 6`;
  }
  for (const path of svg.querySelectorAll('path')) path.setAttribute('d', d);
}

/* How many cards wait under this one: 0, 1, or 2 (and more). */
function pile(panel) {
  const stage = panel.querySelector('.study-stage');
  if (!stage) return;
  const text = (panel.querySelector('.study-progress') || {}).textContent || '';
  const m = /(\d+) of (\d+)/.exec(text);
  const left = m ? Math.max(0, Number(m[2]) - Number(m[1])) : 0;
  stage.dataset.gPile = String(Math.min(2, left));
}

const seen = new WeakSet();
let lastQuestion = '';

function look(panel) {
  const stage = panel.querySelector('.study-stage');
  if (!stage) return;
  const end = stage.querySelector(':scope > .study-end');
  if (end && !seen.has(end)) { seen.add(end); ended(end); }
  const learn = stage.querySelector('.learn-card');
  if (learn) question(panel, learn);
}

/* The end of a go (or of Learn): the check draws itself, sparks fly once, the edge light blooms. A pause between
   Learn's sets is calmer: no sparks, no bloom. */
function ended(end) {
  lastQuestion = '';
  const mark = end.querySelector('.study-end-mark');
  const pause = end.classList.contains('learn-pause');
  if (mark) {
    for (const path of mark.querySelectorAll('path, polyline')) path.setAttribute('pathLength', '1');
    if (!pause && !lite() && !calm()) {
      for (let i = 1; i <= 6; i++) {
        const dot = document.createElement('i');
        dot.className = `g-end-spark s${i}`;
        dot.setAttribute('aria-hidden', 'true');
        mark.append(dot);
        setTimeout(() => dot.remove(), 1400);
      }
    }
  }
  if (!pause) { try { V.emit('edge', 'done'); } catch (error) { /* (nothing listening) */ } }
  if (M()) M().enter(end, { stagger: 50, delay: 90 });
}

/* Learn: a new question slides in; an answer only changes the colours (study.css). A right pick sparks. */
function question(panel, card) {
  const body = card.parentElement;
  const key = `${card.dataset.card || ''}|${card.dataset.kind || ''}|${(panel.querySelector('.study-progress') || {}).textContent || ''}`;
  const right = body ? body.querySelector('.learn-option.right') : null;
  const wrongOne = body ? body.querySelector('.learn-option.wrong') : null;
  if (right && !wrongOne && !seen.has(right)) {
    seen.add(right);
    if (!lite() && !calm() && M()) {
      const host = document.createElement('span');
      host.className = 'g-learn-sparks';
      host.setAttribute('aria-hidden', 'true');
      right.append(host);
      const handle = M().spark(host);
      const gone = () => host.remove();
      if (handle && handle.finished) handle.finished.then(gone, gone); else setTimeout(gone, 700);
    }
  }
  const typedRight = body && body.querySelector('.learn-input.right');
  if (typedRight && !seen.has(typedRight)) { seen.add(typedRight); if (M()) M().press(typedRight, { scale: 0.97 }); }
  if (key === lastQuestion || !body) return;
  const fresh = !body.querySelector('.learn-option.right, .learn-option.wrong, .learn-feedback, .learn-input.right, .learn-input.wrong');
  lastQuestion = key;
  if (!fresh || !HAS_WAAPI) return;
  if (calm()) {
    try { body.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 120, easing: 'linear' }); } catch (error) { /* (old browser) */ }
    return;
  }
  const quick = lite();
  try {
    card.animate([{ opacity: 0, transform: 'translate3d(0,16px,0) scale(.97)' }, { opacity: 1, transform: 'none' }],
      { duration: quick ? 180 : 500, easing: EASE, fill: 'backwards' });
  } catch (error) { /* (old browser) */ }
  if (M()) M().enter(body, { selector: '.learn-option, .learn-type, .learn-options.one .btn, .learn-was', stagger: 45, delay: quick ? 0 : 80 });
}

/* ---------------------------------------------------------------- on and off */

function sweep() {
  const layers = document.getElementById('layers');
  if (!layers) return;
  for (const layer of layers.querySelectorAll(':scope > .study-layer')) bind(layer);
}

function undo() {
  settleAll();
  for (const svg of document.querySelectorAll('svg.g-study-weft')) {
    const where = svg.parentElement;
    svg.remove();
    if (where) where.classList.remove('g-has-weft');
  }
  for (const el of document.querySelectorAll('.g-end-spark, .g-learn-sparks, .g-study-sparks')) el.remove();
}

function start() {
  const layers = document.getElementById('layers');
  if (!layers || start.done) return;
  start.done = true;
  new MutationObserver(() => { if (on()) sweep(); }).observe(layers, { childList: true });
}

V.on('look', () => {
  if (on()) { start(); sweep(); return; }
  undo();
});
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => { start(); if (on()) sweep(); });
else { start(); if (on()) sweep(); }
})();
