/* Wefty 2.0, ui/: the motion runtime's first part (lane A3, "press and motion"; LOOK-BRIEF 1.7 and 1.8).

   What it holds, on V.motion (glass/motion.js adds its helpers to the same object afterwards):
     D          the durations, in ms: press 90, fade 120, exit 160, swap 180, enter 240, stagger 40 (the CSS tokens of the same
                numbers are --d-press, --d-fade, --d-exit, --d-swap, --d-enter, --d-stagger, in ui/tokens.css)
     SPRINGS    the four springs by their stiffness k and damping d (mass 1): tap (700, 32), pill (520, 36), screen (380, 34),
                settle (900, 60); each also says `ms` (how long it takes to settle) and `easing` (a CSS linear() made from it).
                Lite's are stiffer (k x 1.6, d x 1.3): SPRINGS.lite.tap and so on.
     easing(name)   { easing, duration } for a spring by name (or 'out', the press's own curve) in the mode in effect now:
                lite's stiffer springs on a lite device, Full's elsewhere
     later(fn, ms)  the one timer new code uses: fn after ms, scaled by the motion policy's time scale (V.look.timeScale():
                1 everywhere Wefty runs; 0 in the test profile, where fn runs at once, in the same task). Returns
                { cancel() }. An error in fn is reported as an uncaught error is, never thrown at the caller.
     press(el, { scale })   one pulse (a key pressing a control, something chosen by code); never on a control the
                pointer has just pressed (one press a control: MOT-13)
     press.follow(el, { scale })   el is pressable even where the table below doesn't name it; returns a function that
                unbinds it (glass/editor.js binds its tools this way)
     lift(el, on)   a thing whose menu is open lifts to 1.02 and shows no outline (on = true), and settles back (false)
     buzz(ms)   the one way to buzz: never in calm, never while the note-taker listens, in Pocket mode, or while
                dictation or a voice memo records (a classroom is quiet, and the microphone hears the motor); false when
                it didn't

   The press engine (LOOK-BRIEF 1.7, TS-05, SCA-29, MOT-13): ONE engine, on pointerdown, never :active. The thing reaches
   its depth in D.press and lets go on the tap spring when the finger or the button comes up. Depths: SMALL .88 for things
   up to 44 px (a circle, a tab's icon, a tick), BUTTON .96 for buttons, chips, tiles, day cells and the + (as one piece),
   CARD .985 with the quiet glass light (--glass-quiet) for cards and rows. It moves the `scale` property, never
   `transform` (which places things). More than 8 px of travel is a scroll: the press lets go in 120 ms. The press is
   seen in the first frame after the pointerdown: the move starts one frame in (its start time is the last frame's), so
   the frame that follows already shows it. Calm: no scale; the thing dims a little (a fade of D.press).
   The things it presses are found by the app's own pinned classes (PRESSABLE below), so no screen's file changes. It
   never fights js/drag.js (a thing held to be dragged, or a drag going on: the press lets go and the drag's own lift
   shows) or a swipe (8 px of travel lets go first), and it listens passively: nothing waits for it at a scroll's start.

   The stylesheets have no :active press of their own (tools/press_hover_codemod.py took them out): this is the one
   press. Two things keep their own :active because the engine never presses them (NEVER): the study card and the note's
   folder <select>.

   The last input (LAY-23): <html data-input="mouse"> once a mouse has moved, "touch" or "pen" when a finger or a pen
   comes down. Every :hover that changes the look sits inside @media (hover: hover) (the codemod), so a phone never keeps
   the last thing tapped lit; data-input is there for a script or a rule that has to know the last pointer. Before any input, "mouse" where the main pointer can hover and is fine, else "touch". */
'use strict';

(() => {
const V = (window.V = window.V || {});
const M = (V.motion = V.motion || {});
const root = document.documentElement;
const HAS_WAAPI = typeof Element !== 'undefined' && typeof Element.prototype.animate === 'function';

/* ------------------------------------------------------------------ the numbers */

const D = Object.freeze({ press: 90, fade: 120, exit: 160, swap: 180, enter: 240, stagger: 40 });
const LITE_ENTER = 200;  // (LOOK-BRIEF 1.9: lite's enter; every other wait is the same in lite)
const SCROLL_SLOP = 8;   // px of travel that make a press a scroll
const LET_GO_SCROLL = 120;  // ms a press takes to let go when it became a scroll

/* A spring (mass 1) from 0 to 1 at rest, sampled: [values every 1/60 s] until it settles. */
function springCurve(k, d) {
  const values = [0];
  let x = -1;  // displacement from the end
  let v = 0;
  const dt = 1 / 600;
  let still = 0;
  for (let t = 0; t < 3; ) {
    for (let i = 0; i < 10; i++) { const a = -k * x - d * v; v += a * dt; x += v * dt; t += dt; }
    values.push(1 + x);
    still = Math.abs(x) < 0.002 && Math.abs(v) < 0.05 ? still + 1 : 0;
    if (still >= 2) break;
  }
  values[values.length - 1] = 1;
  return values;
}
const linear = (values) => `linear(${values.map((n) => +n.toFixed(4)).join(', ')})`;
function made(k, d) {
  const values = springCurve(k, d);
  return Object.freeze({ k, d, ms: Math.round((values.length - 1) * (1000 / 60)), easing: linear(values) });
}
const SPRING_KD = { tap: [700, 32], pill: [520, 36], screen: [380, 34], settle: [900, 60] };
const full = {};
const lite = {};
for (const [name, [k, d]] of Object.entries(SPRING_KD)) {
  full[name] = made(k, d);
  lite[name] = made(+(k * 1.6).toFixed(1), +(d * 1.3).toFixed(1));
}
const SPRINGS = Object.freeze({ ...full, lite: Object.freeze(lite) });

/* The press's own curve: fast at first (so the first frame already shows it), easing into its depth. */
const OUT = linear(Array.from({ length: 13 }, (_, i) => (1 - Math.exp(-4 * i / 12)) / (1 - Math.exp(-4))));

const isCalm = () => root.classList.contains('calm');
const isLite = () => root.classList.contains('lite');
function easing(name) {
  if (name === 'out') return { easing: OUT, duration: D.press };
  const set = isLite() ? SPRINGS.lite : SPRINGS;
  const spring = set[name] || set.settle;
  return { easing: spring.easing, duration: spring.ms };
}

/* ------------------------------------------------------------------ later */

const timeScale = () => (V.look && V.look.timeScale ? V.look.timeScale() : 1);
const report = (error) => {
  if (typeof window.reportError === 'function') window.reportError(error);
  else setTimeout(() => { throw error; }, 0);
};
function later(fn, ms = 0) {
  const scale = timeScale();
  let id = 0;
  let over = false;
  const run = () => {
    if (over) return;
    over = true;
    try { fn(); } catch (error) { report(error); }
  };
  if (scale === 0) run();
  else id = setTimeout(run, Math.max(0, Number(ms) || 0) * scale);
  return { cancel() { over = true; if (id) { clearTimeout(id); id = 0; } } };
}

/* ------------------------------------------------------------------ buzz */

/* Quiet now: a classroom is listening (the note-taker, Pocket mode, dictation, a voice memo), or calm. */
function hushed() {
  if (isCalm()) return true;
  try {
    const nt = V.notetaker;
    if (nt && ((nt.listening && nt.listening()) || (nt.pocketOn && nt.pocketOn()))) return true;
    if (V.dictation && V.dictation.listening && V.dictation.listening()) return true;
    if (document.querySelector('.editor-tools.recording, .nt-pocket')) return true;
  } catch (error) { return true; }
  return false;
}
function buzz(ms) {
  if (hushed()) return false;
  try { if (navigator.vibrate) return !!navigator.vibrate(ms); } catch (error) { /* not allowed here */ }
  return false;
}

/* ------------------------------------------------------------------ the last input */

const firstInput = () => {
  try { return matchMedia('(hover: hover) and (pointer: fine)').matches ? 'mouse' : 'touch'; } catch (error) { return 'touch'; }
};
const setInput = (kind) => { if (root.dataset.input !== kind) root.dataset.input = kind; };
setInput(firstInput());

/* ------------------------------------------------------------------ the press engine */

/* Every move of the press, the pulse and lift is named, so a test or a film can tell the press from a screen's own moves. */
const PRESS_ID = 'ui-press';
const SMALL = 0.88;
const BUTTON = 0.96;
const CARD = 0.985;

/* What can be pressed, by the app's own pinned classes: [selector, depth, the part that presses (a selector inside it;
   none: itself), how it's lit]. The first ancestor of the pointer's target that matches any row is the thing pressed
   (so a tick inside a row presses the tick, the row's words press the row). A `null` depth: sized by itself (SMALL up to
   44 px across, else BUTTON). Kept in step with tests/contract.json: every class here is pinned. */
const PRESSABLE = [
  // the shell: tabs (their icon presses), your picture, the logo
  ['.tab', SMALL, '.tab-icon'], ['.me', SMALL], ['.rail-home', SMALL], ['.head-home', SMALL],
  // round and small things
  ['.icon-btn', SMALL], ['.today-tick', SMALL], ['.today-row-more', SMALL], ['.tick', SMALL], ['.up-tick', SMALL],
  ['.remove-item', SMALL], ['.search-clear', SMALL], ['.chat-more', SMALL], ['.chat-go', SMALL], ['.chat-quote-x', SMALL],
  ['.chat-copy-code', SMALL], ['.viewer-nav', SMALL], ['.files-tick', SMALL], ['.ink-swatch', SMALL],
  ['.repeat-day', SMALL], ['.tool-btn', SMALL], ['.deck-quiz', SMALL], ['.nt-strip-stop', SMALL],
  // buttons, chips, tiles, day cells, the +
  ['.fab', BUTTON], ['.btn', null], ['.chip', BUTTON], ['.today-tile', BUTTON], ['.tile', BUTTON], ['.wday', BUTTON],
  ['.segmented button', BUTTON], ['.filter-pill', BUTTON], ['.list-go', BUTTON], ['.deck-go', BUTTON],
  ['.today-link', BUTTON], ['.dp-all', BUTTON], ['.subject-chip', BUTTON], ['.model-choice', BUTTON],
  ['.chat-pill', BUTTON], ['.chat-ask-chip', BUTTON], ['.chat-action-btn', BUTTON], ['.toast-action', BUTTON],
  ['.study-btn', BUTTON], ['.more-tool', BUTTON], ['.tool-more', BUTTON], ['.pin-key', BUTTON], ['.pick-all', BUTTON],
  ['.pick-action', BUTTON], ['.pick-export', BUTTON], ['.link-chip', BUTTON], ['.files-source', BUTTON],
  ['.files-view-btn', BUTTON], ['.select-btn', BUTTON], ['.news-option', BUTTON], ['.doors-show', BUTTON],
  ['.nt-strip-open', BUTTON], ['.dictate-stop', BUTTON], ['.ask-btn', BUTTON], ['.play-btn', BUTTON],
  // cards and rows: the quiet light
  ['button.card', CARD], ['.today-row-text', CARD, ':scope'], ['.today-note', CARD], ['.today-deck', CARD],
  ['.test-text', CARD], ['.test-main', CARD], ['.deck-main', CARD], ['.list-fold', CARD], ['.subfolder', CARD],
  ['.crumb', CARD], ['.set-cat', CARD], ['.chat-row', CARD], ['.menu-item', CARD], ['.g-msheet-item', CARD],
  ['.g-pick-option', CARD], ['.folder-choice', CARD], ['.files-row', CARD], ['.send-to-row', CARD], ['.help-q', CARD],
  ['.files-open', CARD], ['.thumb', CARD], ['.file-open', CARD],
  // what only a stylesheet :active pressed before (tools/press_hover_codemod.py took those out): the engine has them now
  ['.week-step', SMALL], ['.start-close', SMALL], ['.checkin-mood', SMALL], ['.g-strip-go', SMALL],
  ['.covers-tick', SMALL], ['.nt-never-box', SMALL], ['input[name="terms"]', SMALL],
  ['.up-when', BUTTON], ['.link-btn', BUTTON], ['.today-count', BUTTON], ['.streak-chip', BUTTON], ['.fw-chip', BUTTON],
  ['.dp-note', BUTTON], ['.set-help-link', BUTTON], ['.files-move-to', BUTTON], ['.chat-chip.opens', BUTTON],
  ['.chat-chip.note', BUTTON], ['.chat-sent-pic', BUTTON], ['.chat-ask-pop', BUTTON],
  ['.set-hit', CARD], ['.set-more-head', CARD], ['.learn-option', CARD],
];
/* A Today row's words press the whole row (its tick and its dots press themselves). */
const ROW_OF = { '.today-row-text': '.today-row' };
const ALL = PRESSABLE.map(([selector]) => selector).join(', ');
/* Never pressed: a box being typed in, words, a thing being dragged, the study card (it flips and is thrown by its own
   gestures). */
const NEVER = 'input:not([type=checkbox]):not([type=radio]), textarea, select, [contenteditable]:not([contenteditable="false"]), '
  + '.flash-card, .drag-ghost, .leaving';

const followed = new WeakMap();  // el -> depth, from press.follow
const lifted = new WeakSet();

function depthOf(node, row) {
  if (followed.has(node)) return followed.get(node);
  const depth = row ? row[1] : BUTTON;
  if (depth !== null) return depth;
  const box = node.getBoundingClientRect();
  return Math.max(box.width, box.height) <= 48 ? SMALL : BUTTON;
}
/* The thing a pointer down on `target` presses: { el (what scales), depth, light } or null. */
function pressedBy(target) {
  if (!target || target.nodeType !== 1 || !target.closest) return null;
  if (target.closest(NEVER)) return null;
  for (let node = target; node && node !== document.body && node !== root; node = node.parentElement) {
    const follow = followed.has(node);
    if (!follow && !node.matches(ALL)) continue;
    if (node.disabled || node.getAttribute('aria-disabled') === 'true' || node.closest('[inert]')) return null;
    const row = follow ? null : PRESSABLE.find(([selector]) => node.matches(selector));
    const depth = depthOf(node, row);
    let el = node;
    if (row && ROW_OF[row[0]]) el = node.closest(ROW_OF[row[0]]) || node;
    else if (row && row[2] && row[2] !== ':scope') el = node.querySelector(row[2]) || node;
    return { el, depth, light: depth === CARD };
  }
  return null;
}

/* One running press (or lift) per element: { anim, light, at } */
const state = new WeakMap();
let current = null;  // { el, id, x, y, depth, light, watch }

const numberScale = (el) => {
  const s = getComputedStyle(el).scale;
  if (!s || s === 'none') return 1;
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : 1;
};
const stop = (animation) => { if (animation) { try { animation.cancel(); } catch (error) { /* gone */ } } };
/* A move that starts one frame in: the frame after the pointerdown already shows it. Its start is the last frame's
   time; when the pointerdown is handled at the very start of a frame (input comes first in a frame, so that frame is
   the one painted next), one frame earlier still. */
const FRAME = 1000 / 60;
function startNow(animation) {
  try {
    const t = document.timeline && document.timeline.currentTime;
    if (!animation || t === null || t === undefined || animation.playState === 'finished') return animation;
    animation.startTime = performance.now() - t < FRAME / 2 ? t - FRAME : t;
  } catch (error) { /* it starts on the next frame instead */ }
  return animation;
}

/* A press or a lift scales a thing; inside a scroller that snaps (Today's Jump back in, the week strip), a scaled snap
   target moves its snap position, so the scroller re-snaps by a pixel or two: a scroll event under a still finger,
   which ends V.contextMenu's long press (and closes a menu that closes on scroll). While a thing is scaled, its
   scroller's snapping is held (inline scroll-snap-type none: no scroll of its own), and given back once it is at 1
   again, at its snap position; a finger that scrolls gives it back at once, so its own scroll snaps as ever. */
const snapHolds = new Map();  // scroller -> { n, inline }
function holdSnap(el) {
  let scroller = null;
  try {
    for (let p = el.parentElement; p && p !== document.body && p !== root; p = p.parentElement) {
      if (getComputedStyle(p).scrollSnapType === 'none') continue;
      if (p.scrollWidth > p.clientWidth + 1 || p.scrollHeight > p.clientHeight + 1) { scroller = p; break; }
    }
  } catch (error) { scroller = null; }
  if (!scroller) return null;
  const hold = snapHolds.get(scroller) || { n: 0, inline: scroller.style.scrollSnapType };
  if (!hold.n) scroller.style.scrollSnapType = 'none';
  hold.n += 1;
  snapHolds.set(scroller, hold);
  let given = false;
  return () => {
    if (given) return;
    given = true;
    hold.n -= 1;
    if (hold.n > 0) return;
    snapHolds.delete(scroller);
    if (scroller.style.scrollSnapType === 'none') scroller.style.scrollSnapType = hold.inline || '';
    if (!scroller.getAttribute('style')) scroller.removeAttribute('style');
  };
}
function giveSnap(s) { if (s && s.snap) { const give = s.snap; s.snap = null; give(); } }

/* The quiet light of a card or a row: a see-through inset wash over its fill, under its words. */
function lightOf(el, rest) {
  const styles = getComputedStyle(el);
  const wash = (styles.getPropertyValue('--glass-quiet') || styles.getPropertyValue('--accent-wash') || '').trim();
  if (!wash) return null;
  const tail = rest && rest !== 'none' ? `, ${rest}` : '';
  return { on: `inset 0 0 0 100vmax ${wash}${tail}`, off: `inset 0 0 0 100vmax transparent${tail}` };
}

function pressDown(found, event) {
  if (!HAS_WAAPI) return;
  const { el, depth } = found;
  const s = state.get(el) || {};
  state.set(el, s);
  if (lifted.has(el)) return;
  const styles = getComputedStyle(el);
  const from = numberScale(el);
  stop(s.anim);
  stop(s.lightAnim);
  if (!s.snap) s.snap = holdSnap(el);
  s.at = performance.now();
  s.pointer = true;
  const calm = isCalm();
  const timing = { id: PRESS_ID, duration: D.press, easing: OUT, fill: 'forwards' };
  s.anim = calm ? el.animate([{ opacity: 1 }, { opacity: 0.82 }], timing) : el.animate([{ scale: String(from) }, { scale: String(depth) }], timing);
  startNow(s.anim);
  s.light = found.light ? lightOf(el, styles.boxShadow) : null;
  if (s.light) s.lightAnim = startNow(el.animate([{ boxShadow: s.light.off }, { boxShadow: s.light.on }], timing));
  current = { el, s, id: event ? event.pointerId : null, x: event ? event.clientX : 0, y: event ? event.clientY : 0, watch: 0 };
  watchHeld(current);
}

/* Let go: `scrolled` (it became a scroll, or the browser took the touch) lets go in 120 ms; a tap springs back. */
function letGo(press, scrolled) {
  if (!press) return;
  if (current === press) current = null;
  if (press.watch) { cancelAnimationFrame(press.watch); press.watch = 0; }
  const { el, s } = press;
  if (!s.anim) { giveSnap(s); return; }
  if (lifted.has(el)) return;  // (its menu opened: lift() has it now)
  const calm = isCalm();
  const was = calm ? null : numberScale(el);
  const opacity = calm ? Number(getComputedStyle(el).opacity) : 1;
  const hold = s.anim;
  const holdLight = s.lightAnim;
  const curve = scrolled || calm ? { easing: OUT, duration: calm ? D.press : LET_GO_SCROLL } : easing('tap');
  s.anim = calm ? el.animate([{ opacity: String(opacity) }, {}], { id: PRESS_ID, duration: curve.duration, easing: curve.easing })
    : el.animate([{ scale: String(was) }, {}], { id: PRESS_ID, duration: curve.duration, easing: curve.easing });
  stop(hold);
  if (s.light) {
    const light = s.light;
    s.lightAnim = el.animate([{ boxShadow: light.on }, { boxShadow: light.off }], { id: PRESS_ID, duration: D.fade, easing: OUT });
    stop(holdLight);
  }
  const mine = s.anim;
  if (scrolled) giveSnap(s);  // (the finger scrolls: its scroll snaps as ever)
  const done = () => { if (s.anim === mine) { s.anim = null; s.lightAnim = null; s.light = null; s.pointer = false; giveSnap(s); } };
  mine.finished.then(done, () => {});
}

/* While held: a drag that begins (js/drag.js's hold, or a drag going on) or a menu that lifts it takes over at once. */
function watchHeld(press) {
  const tick = () => {
    press.watch = 0;
    if (current !== press) return;
    const { el } = press;
    if (!el.isConnected || el.classList.contains('drag-held') || root.classList.contains('dragging')) { letGo(press, true); return; }
    press.watch = requestAnimationFrame(tick);
  };
  press.watch = requestAnimationFrame(tick);
}

function onDown(event) {
  if (event.pointerType === 'mouse') setInput('mouse');
  else if (event.pointerType === 'touch' || event.pointerType === 'pen') setInput(event.pointerType);
  if (!event.isPrimary || (event.pointerType === 'mouse' && event.button !== 0)) return;
  if (current) letGo(current, true);
  if (root.classList.contains('dragging')) return;
  let found = null;
  try { found = pressedBy(event.target); } catch (error) { found = null; }
  if (found) pressDown(found, event);
}
function onMove(event) {
  if (event.pointerType === 'mouse' && root.dataset.input !== 'mouse' && (event.movementX || event.movementY)) setInput('mouse');
  const press = current;
  if (!press || event.pointerId !== press.id) return;
  if (Math.hypot(event.clientX - press.x, event.clientY - press.y) > SCROLL_SLOP) letGo(press, true);
}
function onUp(event) {
  const press = current;
  if (press && event.pointerId === press.id) letGo(press, event.type !== 'pointerup');
}
for (const [type, fn] of [['pointerdown', onDown], ['pointermove', onMove], ['pointerup', onUp], ['pointercancel', onUp]]) {
  document.addEventListener(type, fn, { capture: true, passive: true });
}
// (the page going away mid-press, or a key's own press)
window.addEventListener('blur', () => { if (current) letGo(current, true); });
// (only a scroll of what holds the pressed thing is the finger scrolling it: a list scrolled by code elsewhere, a chat
// following its answer or a strip put back in place, never takes a press away)
document.addEventListener('scroll', (event) => {
  if (!current) return;
  const t = event.target;
  if (!t || t === document || t === root || t === document.body || (t.contains && t.contains(current.el))) letGo(current, true);
}, { capture: true, passive: true });

/* A key pressing a control (Enter, Space): it presses while the key is down. */
let keyPress = null;
document.addEventListener('keydown', (event) => {
  if (event.repeat || (event.key !== 'Enter' && event.key !== ' ') || event.ctrlKey || event.metaKey || event.altKey) return;
  const target = document.activeElement;
  if (!target || target === document.body) return;
  let found = null;
  try { found = pressedBy(target); } catch (error) { found = null; }
  if (!found || found.el !== target && !target.contains(found.el) && !found.el.contains(target)) return;
  if (current) letGo(current, true);
  pressDown(found, null);
  keyPress = current;
}, { capture: true, passive: true });
document.addEventListener('keyup', () => { if (keyPress) { const press = keyPress; keyPress = null; if (current === press) letGo(press, false); } },
  { capture: true, passive: true });

/* ------------------------------------------------------------------ press, press.follow, lift */

/* One pulse: in to `scale` and out past 1 on the tap spring (a key, or something chosen by code). Never on a control the
   engine is pressing or has just let go (one press a control). */
function press(el, { scale = BUTTON } = {}) {
  if (!el || !HAS_WAAPI || isCalm()) return { cancel() {}, finished: Promise.resolve() };
  const s = state.get(el) || {};
  state.set(el, s);
  if (s.pointer || lifted.has(el)) return { cancel() {}, finished: Promise.resolve() };
  stop(s.anim);
  const down = el.animate([{ scale: '1' }, { scale: String(scale) }], { id: PRESS_ID, duration: D.press, easing: OUT });
  const tap = easing('tap');
  let back = null;
  s.anim = down;
  const handle = {
    cancel() { stop(down); stop(back); },
    finished: down.finished.then(() => {
      if (s.anim !== down) return handle;
      back = el.animate([{ scale: String(scale) }, {}], { id: PRESS_ID, duration: tap.duration, easing: tap.easing });
      s.anim = back;
      return back.finished.then(() => { if (s.anim === back) s.anim = null; return handle; }, () => handle);
    }, () => handle),
  };
  return handle;
}
/* `el` presses like the table's things, at the nearest of the three depths to `scale`. Returns the unbinding. */
press.follow = (el, { scale = 0.94 } = {}) => {
  if (!el) return () => {};
  const depth = scale <= 0.92 ? SMALL : scale <= 0.975 ? BUTTON : CARD;
  followed.set(el, depth);
  return () => {
    followed.delete(el);
    if (current && current.el === el) letGo(current, true);
  };
};

/* A thing whose menu is open lifts (1.02) and shows no outline; lift(el, false) settles it back. */
function lift(el, on = true) {
  if (!el) return;
  const s = state.get(el) || {};
  state.set(el, s);
  if (current && current.el === el) { if (current.watch) cancelAnimationFrame(current.watch); current = null; }
  if (on) {
    if (lifted.has(el)) return;
    lifted.add(el);
    s.outline = el.style.outline;
    s.hadStyleLift = el.hasAttribute('style');
    el.style.outline = 'none';
    el.setAttribute('data-lifted', '');
    if (!HAS_WAAPI) return;
    if (!s.snap) s.snap = holdSnap(el);
    const was = isCalm() ? 1 : numberScale(el);
    stop(s.lightAnim); s.lightAnim = null; s.light = null;
    const hold = s.anim;
    const curve = easing('tap');
    s.anim = isCalm() ? null : el.animate([{ scale: String(was) }, { scale: '1.02' }], { id: PRESS_ID, duration: curve.duration, easing: curve.easing, fill: 'forwards' });
    stop(hold);
    s.pointer = false;
    return;
  }
  if (!lifted.has(el)) return;
  lifted.delete(el);
  if (el.style.outline === 'none') el.style.outline = s.outline || '';
  el.removeAttribute('data-lifted');
  if (!s.hadStyleLift && el.getAttribute('style') === '') el.removeAttribute('style');
  if (!HAS_WAAPI || !s.anim) { giveSnap(s); return; }
  const was = numberScale(el);
  const hold = s.anim;
  const curve = easing('settle');
  const back = el.animate([{ scale: String(was) }, {}], { id: PRESS_ID, duration: curve.duration, easing: curve.easing });
  s.anim = back;
  stop(hold);
  back.finished.then(() => { if (s.anim === back) { s.anim = null; giveSnap(s); } }, () => {});
}

Object.assign(M, { D, SPRINGS, easing, later, buzz, press, lift });
})();
