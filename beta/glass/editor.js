/* Wefty 2.0 "glass", area: Editor. This file belongs to the Editor builder; nobody else edits it.
   The note's page (js/editor.js, format.js, ink.js...): the writing page, its title and tools strip, + More, the Read view, locked notes, the picture viewer.
   Rules (vault/web/glass/README.txt has the rest): everything here is inert unless V.look.isGlass() (and listen to V.on('look') so the switch works live); use the tokens in
   glass.css (--g-*, and the app's own names, which glass redefines); only transform and opacity animate; call
   V.motion's helpers instead of writing your own; nothing here changes the classic look.

   What it plays (glass/editor.css has the look):
     - a note opening: on a phone the full-screen note fades in while its page rises 14 px (the board's .nv-body); wide,
       the side pane's note rises. The thread under its title draws itself (V.motion.weft);
     - a note closing: back into its card when the card is on screen (the board's shrink), else it sinks and fades. (The
       layer stays a moment longer for it: js/editor.js asks V.glass.editorLeaving how long, 200 ms in classic.)
     - every press in the tools, + More's tiles, the PIN pad and the repeat days springs (V.motion.press.follow), a key
       press pulses once (V.motion.press); the marks' pressed pills spring in (CSS);
     - + More's tiles rise one after the other as the menu pops out of its button (the pop is glass/overlays.js's);
     - a checklist box ticked: the gradient fills it, the check draws in (CSS) and the sparks fly (V.motion.spark); the
       last open box of a note ticked blooms the edge light (V.emit('edge', 'done'));
     - Write <-> Read: the words rise into place (the board's swap) while the card under them melts away (CSS);
     - pinning: the pin springs (the board's pinA); the PIN pad's dots pop in as they fill; a picture opened grows in;
     - how saving goes: a calm dot by "Saved" (data-g-sync on .save-state), which pops once the change has landed;
     - a note left after real changes: one thread of the edge light (V.emit('edge', 'saved')), never while typing.

   THE GROW-OPEN HOOK (for the Notes side, which owns the card growing into the note):
     V.glass.editorOpening(card, { run = true } = {})
   Call it right before V.editor.open(id), in the same task (a card's click handler, before Notes opens the note). The next
   note to open on a phone then comes out of `card`:
     run: true (the default)  the editor grows it: V.motion.flip(card, layer) with the board's slide spring, rounded corners
                              while it grows, its page fading up from 90 ms in (the board's .nv-body). Nothing else to do.
     run: false               the editor stands aside: the layer has no entrance of its own and no transition (class
                              g-growing: rounded, clipped), so the caller's own transform/opacity animation of it is the
                              only one; the page inside still fades up. Call the handle's done() when it has landed (or
                              it is taken off by itself after 1.2 s).
   Returns { layer: Promise<Element|null>, done() } (layer: the note's layer once it is on the page; null when no note
   opened within a second, or wide, where the note goes into the side pane and just rises). Closing needs nothing: the
   note shrinks back into its note's card (button.card[data-id]) by itself when that card is in sight.
   Classic: editorOpening does nothing and returns the same shape. */
'use strict';

(() => {
const V = window.V;
if (!V) return;
const root = document.documentElement;
const HAS_WAAPI = typeof Element !== 'undefined' && typeof Element.prototype.animate === 'function';
const EASE = 'cubic-bezier(.2,.8,.2,1)';
const SPRING = 'cubic-bezier(.34,1.45,.64,1)';
const EXIT = 'cubic-bezier(.5,0,.8,.4)';

const on = () => !!(V.look && V.look.isGlass());
const calm = () => root.classList.contains('calm');
const lite = () => root.classList.contains('lite');
const M = () => V.motion || null;

/* One running animation per element and job (a new one cancels the old: everything can start again at once). */
const running = new WeakMap();
function play(el, keyframes, options, job = 'editor') {
  if (!el || !HAS_WAAPI || !el.isConnected) return null;
  const jobs = running.get(el) || {};
  running.set(el, jobs);
  if (jobs[job]) { try { jobs[job].cancel(); } catch (error) { /* gone */ } }
  let animation = null;
  try { animation = el.animate(keyframes, options); } catch (error) { return null; }
  jobs[job] = animation;
  animation.finished.then(() => { if (jobs[job] === animation) delete jobs[job]; }, () => {});
  return animation;
}

/* ================================================================== the thread under the title */

function wavePath(width, period, y, a) {
  const n = Math.max(1, Math.round(width / period));
  const s = width / n;
  let d = `M0 ${y}`;
  for (let i = 0; i < n; i++) {
    const x = i * s;
    d += ` C ${(x + s / 3).toFixed(1)} ${y - a}, ${(x + (2 * s) / 3).toFixed(1)} ${y + a}, ${(x + s).toFixed(1)} ${y}`;
  }
  return d;
}
const SVG = 'http://www.w3.org/2000/svg';
const wefts = new WeakMap();  // editor element -> { svg, path, width }
let sizer = null;
function shapeWeft(state) {
  const width = Math.round(state.svg.getBoundingClientRect().width / (zoomOf(state.svg) || 1));
  if (!width || width === state.width) return;
  state.width = width;
  state.svg.setAttribute('viewBox', `0 0 ${width} 12`);
  state.path.setAttribute('d', wavePath(width, 45, 6, 5));
}
const zoomOf = (el) => { const z = parseFloat(getComputedStyle(document.documentElement).zoom); return z > 0 ? z : 1; };
function ensureWeft(editor) {
  if (!on() || !editor) return null;
  const scroll = editor.querySelector(':scope > .editor-scroll');
  const meta = scroll && scroll.querySelector(':scope > .note-meta');
  if (!scroll || !meta) return null;
  let state = wefts.get(editor);
  if (!state || !state.svg.isConnected || state.svg.parentNode !== scroll) {
    const svg = document.createElementNS(SVG, 'svg');
    svg.setAttribute('class', 'g-ed-weft');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('preserveAspectRatio', 'none');
    const path = document.createElementNS(SVG, 'path');
    svg.appendChild(path);
    meta.after(svg);
    state = { svg, path, width: 0 };
    wefts.set(editor, state);
    if (!sizer && typeof ResizeObserver !== 'undefined') {
      sizer = new ResizeObserver((seen) => seen.forEach((s) => { const e = s.target.closest('.editor'); const st = e && wefts.get(e); if (st) shapeWeft(st); }));
    }
    if (sizer) sizer.observe(svg);
  }
  shapeWeft(state);
  return state;
}

/* ================================================================== a note opening and closing */

let growFrom = null;  // { card, at, run, resolve, done } from V.glass.editorOpening

function editorOpening(card, { run = true } = {}) {
  let resolve = () => {};
  const layer = new Promise((r) => { resolve = r; });
  const handle = { layer, done() {} };
  if (!on() || !card) { resolve(null); return handle; }
  if (growFrom) growFrom.resolve(null);
  growFrom = { card, at: performance.now(), run, resolve, done: null };
  const mine = growFrom;
  handle.done = () => { if (mine.done) mine.done(); else mine.cancelled = true; };
  setTimeout(() => { if (growFrom === mine) { growFrom = null; mine.resolve(null); } }, 1000);
  return handle;
}

/* The page inside a note rises into place (the board's .nv-body): from `delay` ms, 14 px, a short fade. */
function riseIn(editor, { delay = 0, from = 14 } = {}) {
  if (!editor) return null;
  if (calm()) return play(editor, [{ opacity: 0 }, { opacity: 1 }], { duration: 120, easing: 'linear', fill: 'backwards' }, 'in');
  return play(editor, [{ opacity: 0, transform: `translateY(${from}px)` }, { opacity: 1, transform: 'none' }],
    { duration: lite() ? 180 : 420, delay: lite() ? 0 : delay, easing: EASE, fill: 'backwards' }, 'in');
}

function opened(id) {
  if (!on()) return;
  const editor = V.editor.root();
  if (!editor) return;
  watchEditor(editor);
  const layer = editor.parentElement && editor.parentElement.classList.contains('editor-layer') ? editor.parentElement : null;
  const weft = ensureWeft(editor);
  if (weft && M()) M().weft(weft.path, { duration: 900, delay: layer ? 260 : 160 });
  marked.set(editor, fingerprint());
  const grow = growFrom && growFrom.card.isConnected && performance.now() - growFrom.at < 1000 ? growFrom : null;
  growFrom = null;
  if (!layer) {
    // wide: the side pane's note fades in where it stays (nothing moves: the pane is part of the page, and a box's letters
    // are where a click lands from the first frame)
    if (grow) grow.resolve(null);
    play(editor, [{ opacity: 0 }, { opacity: 1 }], { duration: calm() ? 120 : lite() ? 140 : 260, easing: calm() ? 'linear' : EASE, fill: 'backwards' }, 'in');
    return;
  }
  if (grow) { growIn(grow, layer, editor); return; }
  // no card: the note fades in over everything while its page rises
  if (calm()) play(layer, [{ opacity: 0 }, { opacity: 1 }], { duration: 120, easing: 'linear', fill: 'backwards' }, 'layer');
  else {
    // (the page settles from a hair smaller as it fades in, about its top: until it has, it isn't quite at the screen's
    // left edge, which is what the older tests wait for before they tap, as they did for the classic slide)
    const origin = layer.style.transformOrigin;
    layer.style.transformOrigin = '50% 24%';
    const a = play(layer, [{ opacity: 0, transform: 'scale(.975)' }, { opacity: 1, offset: 0.45 }, { opacity: 1, transform: 'none' }],
      { duration: lite() ? 180 : 460, easing: EASE, fill: 'backwards' }, 'layer');
    const back = () => { layer.style.transformOrigin = origin; };
    if (a) a.finished.then(back, back); else back();
    riseIn(editor, { delay: 30 });
  }
}

/* A note growing out of its card and shrinking back (the owner's recordings: the card turned into an empty dark box before the
   note's words came, the words faded in late and dim, and on the way back an empty box landed where the card was).
   The real note is a full-screen layer; what shows of it is a rounded window that starts as the card and grows to the whole
   screen, the note scaled evenly (never squashed) from the card's width up to full size, solid from the first frame. The
   card's own copy lies over it for the first moments and fades as the note's words are there, so there is never an empty
   box; going back it is the other way round, ending in the card itself (the real card is shown under the layer as it
   goes). Only the layer's transform and a clip-path animate (one element). */
const hiddenCards = new WeakSet();
function hideCard(card) { if (card && card.isConnected) { card.style.visibility = 'hidden'; hiddenCards.add(card); } }
function showCard(card) { if (card && hiddenCards.has(card)) { hiddenCards.delete(card); card.style.visibility = ''; } }

function windowOf(card) {
  if (!card || !card.isConnected) return null;
  const z = zoomOf();
  const from = card.getBoundingClientRect();
  const W = window.innerWidth || 0;
  const H = window.innerHeight || 0;
  if (!(from.width > 10 && from.height > 10 && W > 0 && H > 0 && from.bottom > 0 && from.top < H && from.right > 0 && from.left < W)) return null;
  const s = from.width / W;
  const radius = parseFloat(getComputedStyle(card).borderTopLeftRadius) || 22;
  const tall = H / z;
  const window_ = from.height / s / z;   // (the card's height, in the layer's own size)
  return {
    s, z, width: from.width / z, height: from.height / z,
    small: { transform: `translate(${from.left / z}px, ${from.top / z}px) scale(${s})`, clipPath: `inset(0px 0px ${Math.max(0, tall - window_)}px 0px round ${radius / s}px)` },
    full: { transform: 'none', clipPath: 'inset(0px 0px 0px 0px round 0px)' },
  };
}

/* The card's own look, copied (a phone's cards are styled by their own class), sitting at the layer's top left at its natural
   size: its scale is the opposite of the layer's, so it never looks bigger or smaller than the card did. */
function cardCopy(card, w) {
  const copy = card.cloneNode(true);
  copy.classList.add('g-grow-card');
  copy.removeAttribute('id');
  copy.removeAttribute('data-id');
  for (const el of copy.querySelectorAll('[id]')) el.removeAttribute('id');
  copy.setAttribute('aria-hidden', 'true');
  copy.tabIndex = -1;
  copy.inert = true;
  Object.assign(copy.style, { position: 'absolute', left: '0', top: '0', width: `${w.width}px`, height: `${w.height}px`, margin: '0',
    transformOrigin: '0 0', pointerEvents: 'none', zIndex: '3', visibility: 'visible', transition: 'none' });
  return copy;
}

function growIn(grow, layer, editor) {
  grow.resolve(layer);
  layer.classList.add('g-growing');
  let ended = false;
  const end = () => {
    if (ended) return;
    ended = true;
    // (another animation of the layer still going, the caller's: the corners stay round until it lands)
    const still = HAS_WAAPI ? layer.getAnimations().filter((a) => a.playState === 'running') : [];
    if (still.length) Promise.all(still.map((a) => a.finished.catch(() => {}))).then(() => layer.classList.remove('g-growing'));
    else layer.classList.remove('g-growing');
  };
  grow.done = end;
  if (grow.cancelled) end();
  if (calm()) {
    play(layer, [{ opacity: 0 }, { opacity: 1 }], { duration: 120, easing: 'linear', fill: 'backwards' }, 'layer');
    end();
    return;
  }
  if (!grow.run) { riseIn(editor, { delay: 90 }); setTimeout(end, 1200); return; }
  // the window: the note itself, scaled evenly and solid from the first frame, a rounded window that grows out of the card
  const w = windowOf(grow.card);
  if (w && HAS_WAAPI) {
    const T = lite() ? 240 : 460;
    const OUT = 'cubic-bezier(.16,1,.3,1)';   // (quick off the mark, so the note covers the list at once, and no overshoot: a corner can't go negative)
    layer.classList.add('g-window');
    layer.style.transformOrigin = '0 0';
    hideCard(grow.card);
    const copy = cardCopy(grow.card, w);
    layer.appendChild(copy);
    const move = play(layer, [w.small, w.full], { duration: T, easing: OUT, fill: 'backwards' }, 'grow');
    play(copy, [{ transform: `scale(${1 / w.s})` }, { transform: 'scale(1)' }], { duration: T, easing: OUT, fill: 'forwards' }, 'grow');
    play(copy, [{ opacity: 1 }, { opacity: 0 }], { duration: T * 0.34, easing: 'linear', fill: 'forwards' }, 'fade');
    play(editor, [{ opacity: 0 }, { opacity: 1 }], { duration: T * 0.3, easing: 'linear', fill: 'backwards' }, 'in');
    const landed = () => { copy.remove(); layer.classList.remove('g-window'); layer.style.transformOrigin = ''; end(); };
    if (move) move.finished.then(landed, landed); else landed();
    setTimeout(landed, T + 600);
    return;
  }
  riseIn(editor, { delay: 90 });
  const flip = M() ? M().flip(grow.card, layer, { duration: 460 }) : null;
  // (round-2 fix R2-07: the layer is solid from its first frame, so the card turns into the note rather than the list
  // showing through it; this opacity runs over the flip's own, as the close's 'hold' does, and its transform is kept)
  if (flip && flip.animation) play(layer, [{ opacity: 1 }, { opacity: 1 }], { duration: lite() ? 220 : 460, easing: 'linear', fill: 'backwards' }, 'solid');
  if (flip && flip.finished) flip.finished.then(end, end); else end();
  setTimeout(end, 1200);
}

/* js/editor.js, closing a phone's note: how long its layer stays for the way out (0: classic, removed as before). The
   note shrinks back into its card when the card is in sight, else sinks and fades. */
function editorLeaving(layer, id) {
  if (!on() || !layer || !HAS_WAAPI) return 0;
  layer.classList.add('g-leaving');
  const editor = layer.querySelector(':scope > .editor');
  if (calm()) {
    play(layer, [{ opacity: 1 }, { opacity: 0 }], { duration: 120, easing: 'linear', fill: 'forwards' }, 'layer');
    return 140;
  }
  const card = id ? cardOf(id) : null;
  const w = card ? windowOf(card) : null;
  if (w) {
    // back into the card: the window shrinks onto it, the note's words give way to the card's own copy as it lands (never an
    // empty box), and the layer lets go last, with the real card under it
    const T = lite() ? 240 : 440;
    layer.classList.add('g-growing', 'g-window');   // (g-window: square, with the window's own corners; the older name stays for what looks for it)
    layer.style.transformOrigin = '0 0';
    const copy = cardCopy(card, w);
    layer.appendChild(copy);
    play(layer, [w.full, w.small], { duration: T, easing: 'cubic-bezier(.3,.9,.3,1)', fill: 'forwards' }, 'grow');
    play(copy, [{ transform: 'scale(1)' }, { transform: `scale(${1 / w.s})` }], { duration: T, easing: 'cubic-bezier(.3,.9,.3,1)', fill: 'forwards' }, 'grow');
    play(copy, [{ opacity: 0 }, { opacity: 0, offset: 0.3 }, { opacity: 1, offset: 0.72 }, { opacity: 1 }], { duration: T, easing: 'linear', fill: 'forwards' }, 'fade');
    if (editor) play(editor, [{ opacity: 1 }, { opacity: 1, offset: 0.22 }, { opacity: 0, offset: 0.62 }, { opacity: 0 }], { duration: T, easing: 'linear', fill: 'forwards' }, 'in');
    play(layer, [{ opacity: 1 }, { opacity: 1, offset: 0.74 }, { opacity: 0 }], { duration: T, easing: 'linear', fill: 'forwards' }, 'hold');
    setTimeout(() => showCard(card), Math.round(T * 0.6));
    return T + 30;
  }
  if (card && M()) {
    if (editor) play(editor, [{ opacity: 1 }, { opacity: 0 }], { duration: 120, easing: 'linear', fill: 'forwards' }, 'in');
    layer.classList.add('g-growing');
    const time = lite() ? 220 : 420;
    const flip = M().flip(card, layer, { reverse: true, duration: time });
    if (!flip.animation) return 200;
    // (the board's close: the page stays solid while it shrinks and only fades in its last part, so it reads as the
    // note going back into its card, not as a fade; this opacity runs over the flip's own, its transform is kept)
    play(layer, [{ opacity: 1 }, { opacity: 1, offset: 0.57 }, { opacity: 0 }], { duration: time, easing: 'linear', fill: 'forwards' }, 'hold');
    return lite() ? 240 : 440;
  }
  if (editor) play(editor, [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateY(10px)' }], { duration: 170, easing: EXIT, fill: 'forwards' }, 'in');
  play(layer, [{ opacity: 1 }, { opacity: 0 }], { duration: 200, delay: 20, easing: EXIT, fill: 'forwards' }, 'layer');
  return 230;
}

/* The note's card on the Notes screen, when it's there and in sight. */
function cardOf(id) {
  const card = [...document.querySelectorAll('button.card[data-id]')].find((c) => c.dataset.id === id);
  if (!card || !card.getClientRects().length) return null;
  const r = card.getBoundingClientRect();
  return r.width > 10 && r.height > 10 && r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth ? card : null;
}

/* ================================================================== the edge light: a note left after real changes */

const marked = new WeakMap();  // editor element -> what its note was when it opened
const fingerprint = () => {
  const n = V.editor.current && V.editor.current();
  if (!n) return '';
  let words = '';
  try { words = V.editor.words(); } catch (error) { words = n.body || ''; }
  return JSON.stringify([n.id, n.title || '', words, (n.attachments || []).length]);
};
V.on('note-left', () => {
  if (!on()) return;
  const editor = V.editor.root();
  if (!editor || !marked.has(editor)) return;
  const before = marked.get(editor);
  marked.delete(editor);
  const after = fingerprint();
  if (before && after && before !== after) V.emit('edge', 'saved');
});

/* ================================================================== each open note: Write <-> Read, the sync dot */

const watched = new WeakSet();
function watchEditor(editor) {
  if (!editor || watched.has(editor) || typeof MutationObserver === 'undefined') return;
  watched.add(editor);
  let reading = editor.classList.contains('reading');
  new MutationObserver(() => {
    const now = editor.classList.contains('reading');
    if (now === reading) return;
    reading = now;
    if (!on()) return;
    // the words rise into place, the card melting away (or back) under them (the board's sw-a)
    const body = editor.querySelector('.editor-body');
    if (!body) return;
    const items = [...body.children].filter((c) => c.getClientRects().length).slice(0, 3);
    items.forEach((item) => {
      if (calm()) play(item, [{ opacity: 0 }, { opacity: 1 }], { duration: 120, easing: 'linear', fill: 'backwards' }, 'swap');
      else play(item, [{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'none' }], { duration: lite() ? 160 : 420, easing: EASE, fill: 'backwards' }, 'swap');
    });
  }).observe(editor, { attributes: true, attributeFilter: ['class'] });
  syncDot(editor, false);
}

let lastStatus = '';
function syncDot(editor, fresh) {
  const status = (V.cloud && V.cloud.status) || '';
  const scope = editor || document;
  for (const el of scope.querySelectorAll('.save-state')) {
    if (!on()) { delete el.dataset.gSync; continue; }
    el.dataset.gSync = status === 'syncing' ? 'syncing' : ['offline', 'held', 'error', 'asleep'].includes(status) ? 'offline' : 'synced';
    if (fresh && status === 'synced' && lastStatus === 'syncing' && !calm()) {
      el.classList.remove('g-landed');
      void el.offsetWidth;
      el.classList.add('g-landed');
      setTimeout(() => el.classList.remove('g-landed'), 600);
    }
  }
}
V.on('status', () => {
  const editor = V.editor && V.editor.root && V.editor.root();
  if (editor && editor.isConnected) syncDot(editor, true);
  lastStatus = (V.cloud && V.cloud.status) || '';
});
// The note drawn again (a change from another device, unlocked): its thread and its dot again, no animation.
V.on('data', () => {
  if (!on()) return;
  const editor = V.editor && V.editor.root && V.editor.root();
  if (!editor || !editor.isConnected) return;
  ensureWeft(editor);
  watchEditor(editor);
  syncDot(editor, false);
});

/* ================================================================== presses */

/* Every press springs (V.motion.press.follow, bound the first time each one is pressed); a key's press pulses once. */
const PRESSES = [
  ['.editor .tool-btn, .ink-tools .tool-btn', 0.86], ['.more-tool', 0.94], ['.pin-key', 0.92], ['.repeat-day', 0.9],
  ['.editor .tool-more', 0.94], ['.ink-swatch', 0.88],
];
const bound = new WeakMap();
function pressable(target) {
  if (!target || !target.closest) return null;
  for (const [selector, scale] of PRESSES) {
    const el = target.closest(selector);
    if (el) return [el, scale];
  }
  return null;
}
document.addEventListener('pointerdown', (event) => {
  if (!on() || !M()) return;
  const found = pressable(event.target);
  if (!found || bound.has(found[0])) return;
  // (bound now, at the document on the way down: its own listener still hears this very press)
  bound.set(found[0], M().press.follow(found[0], { scale: found[1] }));
}, true);
document.addEventListener('click', (event) => {
  if (!on() || !M()) return;
  const target = event.target;
  // a key (Enter, Space) pressing a tool: one pulse
  if (event.detail === 0) {
    const found = pressable(target);
    if (found) M().press(found[0], { scale: found[1] });
  }
  // a checklist box: ticked, the sparks fly (its look is the stylesheet's)
  const tick = target.closest && target.closest('.editor .check-row > .tick, .editor .read-check > .tick');
  if (tick) ticked(tick, event.detail === 0);
  // the pin: it springs (the bar is drawn again, so the new pin is found a moment later)
  const pin = target.closest && target.closest('.editor-bar .icon-btn.keep-caret');
  if (pin) setTimeout(() => pinned(pin), 0);
});

function ticked(tick, byKey) {
  const row = tick.parentElement;
  if (!row || !row.classList.contains('done')) return;
  if (byKey) M().press(tick, { scale: 0.82 });
  M().spark(tick);
  // the note's last open box ticked (and it had a few): the edge light blooms
  const editor = tick.closest('.editor');
  const rows = editor ? [...editor.querySelectorAll('.check-row, .read-check')] : [];
  if (rows.length >= 2 && rows.every((r) => r.classList.contains('done'))) V.emit('edge', 'done');
}

function pinned(old) {
  const bar = old.isConnected ? old.parentElement : document.querySelector('.editor .editor-bar');
  const pin = bar && bar.querySelector('.icon-btn.keep-caret');
  const icon = pin && pin.querySelector('.icon');
  if (!icon || calm()) return;
  play(icon, [{ transform: 'scale(.7) rotate(-14deg)' }, { transform: 'scale(1.14)', offset: 0.6 }, { transform: 'none' }],
    { duration: lite() ? 160 : 420, easing: lite() ? 'ease-out' : SPRING }, 'pin');
}

/* ================================================================== what opens over the note */

function opening(layer) {
  if (!on() || !layer || layer.nodeType !== 1) return;
  // + More: its tiles come in one after the other as the menu pops out of its button
  const tiles = layer.querySelector('.tools-more-menu .more-tools');
  if (tiles && M()) M().enter(tiles, { stagger: 18, delay: 30, max: 6 });
  // the PIN pad: each dot pops in as it fills
  const dots = layer.querySelector('.pin-dots');
  if (dots && typeof MutationObserver !== 'undefined') {
    let filled = dots.querySelectorAll('.dot.full').length;
    new MutationObserver(() => {
      const now = dots.querySelectorAll('.dot.full');
      if (now.length > filled && on() && !calm()) {
        play(now[now.length - 1], [{ transform: 'scale(.3)' }, { transform: 'scale(1.3)', offset: 0.55 }, { transform: 'none' }],
          { duration: lite() ? 140 : 360, easing: lite() ? 'ease-out' : SPRING }, 'pop');
      }
      filled = now.length;
    }).observe(dots, { childList: true });
  }
  // a picture opened big: it grows in once its sheet is up
  const img = layer.querySelector('.sheet .viewer img');
  if (img) {
    if (calm()) play(img, [{ opacity: 0 }, { opacity: 1 }], { duration: 120, easing: 'linear', fill: 'backwards' }, 'pic');
    else play(img, [{ opacity: 0, transform: 'scale(.92)' }, { opacity: 1, transform: 'none' }],
      { duration: lite() ? 180 : 460, delay: lite() ? 0 : 120, easing: lite() ? 'ease-out' : 'cubic-bezier(.25,1.18,.35,1)', fill: 'backwards' }, 'pic');
  }
}

let layersWatch = null;
function start() {
  if (layersWatch) return;
  const layers = document.getElementById('layers');
  if (!layers || typeof MutationObserver === 'undefined') return;
  layersWatch = new MutationObserver((records) => {
    if (!on()) return;
    for (const record of records) for (const node of record.addedNodes) opening(node);
  });
  layersWatch.observe(layers, { childList: true });
}

/* The look switched on or off: the thread, the dots and the marks put on here come and go with it. */
function sync() {
  const editor = V.editor && V.editor.root && V.editor.root();
  if (on()) {
    start();
    if (editor && editor.isConnected) { ensureWeft(editor); watchEditor(editor); syncDot(editor, false); }
    return;
  }
  for (const el of document.querySelectorAll('.g-ed-weft')) el.remove();
  for (const el of document.querySelectorAll('.save-state[data-g-sync]')) { delete el.dataset.gSync; el.classList.remove('g-landed'); }
  for (const el of document.querySelectorAll('.editor-layer.g-growing, .editor-layer.g-leaving')) el.classList.remove('g-growing', 'g-leaving');
}

/* ================================================================== the tools strip on a wide screen (round 4)

   The owner's Chromebook: with the notes list beside the note, the tools strip only shows its first tools and the rest are cut
   off at its edge. On a wide screen the strip scrolls as it always did (the wheel, a finger, Tab), and now says so: its words
   fade out under a round glass arrow on each side that has more, and a click on the arrow slides the strip a page along. The
   arrows never take the caret or the keyboard (Tab goes along the tools themselves, each one scrolled clear of the arrows). */
const WIDE = window.matchMedia ? matchMedia('(min-width: 900px)') : null;
const strips = new WeakSet();
function stripArrows(tools) {
  const strip = tools && tools.querySelector(':scope > .tool-strip');
  if (!strip || strips.has(strip)) return;
  strips.add(strip);
  const arrow = (dir) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'g-strip-go ' + dir;
    b.tabIndex = -1;
    b.setAttribute('aria-hidden', 'true');
    b.title = dir === 'prev' ? 'More tools to the left' : 'More tools to the right';
    b.append(V.icon(dir === 'prev' ? 'back' : 'next'));
    b.addEventListener('mousedown', (event) => event.preventDefault());  // (the caret stays where it was)
    b.addEventListener('click', () => {
      const by = Math.max(88, strip.clientWidth - 72) * (dir === 'prev' ? -1 : 1);
      strip.scrollBy({ left: by, behavior: calm() ? 'auto' : 'smooth' });
    });
    return b;
  };
  const prev = arrow('prev');
  const next = arrow('next');
  tools.append(prev, next);
  const update = () => {
    if (!strip.isConnected) return;
    const show = on() && (!WIDE || WIDE.matches) && !strip.closest('.editor.reading');
    const left = show && strip.scrollLeft > 2;
    const right = show && strip.scrollWidth - strip.clientWidth - strip.scrollLeft > 2;
    tools.classList.toggle('g-strip-l', left);
    tools.classList.toggle('g-strip-r', right);
    prev.style.left = `${strip.offsetLeft}px`;
    next.style.left = `${strip.offsetLeft + strip.clientWidth - next.offsetWidth}px`;
  };
  strip.addEventListener('scroll', update, { passive: true });
  if (window.ResizeObserver) new ResizeObserver(update).observe(strip);
  update();
}
function strips_() {
  if (!on()) return;
  const editor = V.editor && V.editor.root && V.editor.root();
  const tools = editor && editor.querySelector('.editor-tools');
  if (tools) stripArrows(tools);
}

V.on('note-opened', (id) => { opened(id); strips_(); });
V.on('look', () => { strips_(); document.querySelectorAll('.editor-tools').forEach((t) => { if (!on()) t.classList.remove('g-strip-l', 'g-strip-r'); }); });
V.on('look', sync);
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', sync, { once: true }); else sync();

V.glass = V.glass || {};
V.glass.editorOpening = editorOpening;
V.glass.editorLeaving = editorLeaving;
})();
