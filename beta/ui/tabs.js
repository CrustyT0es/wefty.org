/* Wefty 2.0, ui/: a tab's arrival (lane B, "tab transition"; the look brief 1.8's "A tab" row, Q2 answered yes).

   The owner: "when I switch from today to notes its a sudden change, could u create a smooth transition?"

   What a tab tapped does now (js/start.js's tapped() and show() call this):
     - in the tap's own task the pill starts (glass/shell.js, as before) and the old screen's content eases down to
       85 % (D.press, 90 ms, linear) while it waits for the new one: never a held dim screen, never an empty one;
     - as the finger presses the tab (prepare(), on its pointerdown), else in the pill's first frame (js/start.js), the
       old screen's own nodes go where the new one will be drawn over them (aside(): a second main.view of the old tab, inert, its scroll places kept, only its
       screenful in sight drawn again), so that work is done while the finger is down, never in the new screen's draw
       (fix round 3);
     - the new screen is drawn exactly when it was before (the task right after the pill's first frame, never later);
       the old one stays where it had got to while the new one's content comes up over it from 60 % (D.fade, 'out'),
       and goes from about half of what it showed in UNDER_MS, its header and top band at once: a fade-through over
       several frames, never a cut (fix round 2: with one screen on the glass, 92 % of the picture changed in one
       frame), never two pages of words both readable (fix round 3). The new screen glides
       in 12 px from the pill's side (right or left in the phone's bar, below or above on the Chromebook's rail) over
       240 ms (D.enter) on the settle spring's shape; more than 12 px cut Notes' title for a frame;
     - a screen drawn again on its own while it moves (Today on 'data', 'streak', 'status') gets the same move on
       the same clock (a MutationObserver while a move is under way);
     - the header moves with its screen, as one (the owner: "Id want the headers and the other texts and elements all
       to move the same"): its title, its buttons and your picture fade and glide exactly as the content does, the
       old header going with its old screen (its top band all but gone the frame the new one shows), the new one coming
       in with its new screen;
     - the dock, the rail, the pill, the fog and the canvas behind are never touched.

   Only `translate` and `opacity`, both on the screen's own node, main.view's child (Today's page, Notes' layout,
   Share's page, the Chat app), so the header and everything under it share one move. No layout, no filter,
   no will-change, nothing on main.view itself (it holds Notes' fixed +). Nothing here reads the layout or a computed
   style: the parts are found by their classes, the old screen's opacity from its animation's own clock (the leave's
   one keyframe starts each part from where it is, a part still coming in on its own included, with nothing read).

   Why not the View Transitions API: tried first (it keeps a picture of the old screen). It pauses all rendering from
   the tap until the new screen is drawn, so the pill, which must move in the tap's frame, stood still for the whole
   draw (about 300 ms on the filmed phone); it also put the screen's picture over the dock's fog, and dropped the move
   when a named header vanished. This way costs nothing the draw didn't already cost.

   Interrupted: a tab tapped while the new screen comes in sends that screen out from the opacity it had reached; a
   draw that never comes (Back, a deep link, a newer tab) is cut off by whatever is drawn next. A screen drawn by
   anything but a tab tap arrives as before (glass/loading.js's brightening).

   Lite: the same fades, no travel. Calm (and Reduce Motion): none. The test profile (time scale 0): none: the screen
   is drawn in the tap's own task, its DOM final at once. */
'use strict';

(() => {
const V = (window.V = window.V || {});
if (V.tabMove) return;  // (once only)
const root = document.documentElement;
const HAS = typeof Element !== 'undefined' && typeof Element.prototype.animate === 'function';

const ORDER = ['today', 'notes', 'share', 'claude'];   // the tabs as they stand in the bar (and down the rail)
/* main.view's children that are not the screen: the pull's pill, words for a screen reader. (Notes' own +, fixed over the
   dock's right end, is its screen's: it fades and glides with it, as the header does.) */
const NOT_SCREEN = '.g-pull-hint, .sr-only, [hidden], .g-tbar-wrap';
const HEADS = '[data-ui-head], .app-head, .list-title';  // a screen's header, the first found (B3's: data-ui-head)
/* The old screen (its header with it) eases down to this while it waits for the new one (linear: no fast fall); the
   new one comes up from where it had really got to. (WORDS_FLOOR: what a header's words alone once eased to; no move
   of their own is made now, so it only bounds the empty one.) */
const FLOOR = 0.85;
const WORDS_FLOOR = 0.4;
const IN_PX = 12;    // the new screen comes in this far from the pill's side (more cut Notes' title for a frame)
const UNDER_FROM = 0.6;  // with the old screen held under it, the new one's content comes up from here
const UNDER_START = 0.6;  // ...and the old one, under it, goes from here (times where its leave had got to)
const UNDER_MS = 90;  // the old screen, under the new one, is gone in this long (linear; critic 3: from full over
                      // 120 ms its words stayed readable through the new ones for about 100 ms)
const OUT = 'ui-tab-out';
const IN = 'ui-tab-in';

let leaving = null;   // the old screen going, until the new one is drawn
let coming = null;    // the new screen coming in

const instant = () => { try { return !!(V.look && V.look.timeScale && V.look.timeScale() === 0); } catch (error) { return true; } };
const calm = () => root.classList.contains('calm');
const lite = () => root.classList.contains('lite');
const reduced = () => { try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (error) { return false; } };
const wide = () => { try { return !!(V.wide && V.wide()); } catch (error) { return false; } };
const glass = () => { try { return !!(V.look && V.look.isGlass && V.look.isGlass()); } catch (error) { return false; } };
const D = () => (V.motion && V.motion.D) || { press: 90, fade: 120, swap: 180, enter: 240 };
const ease = (name) => { try { return V.motion.easing(name).easing; } catch (error) { return 'ease-out'; } };
const view = () => document.querySelector('#app > main.view');
/* ui/motion.js's 'out' curve (the press's: fast first, easing into its end), as a function: OUT there is made from it. */
const FRAME = 1000 / 60;
const outCurve = (x) => (1 - Math.exp(-4 * x)) / (1 - Math.exp(-4));
const shift = (axis, px) => (axis === 'X' ? `${px}px 0px` : `0px ${px}px`);

/* The screen's own node(s) and its header, by class alone. What fades is the screen's node itself, header and all
   (one move: the header never stands still while the rest glides); `words` is kept empty for the moves below. */
function parts(main) {
  const screens = [];
  for (const el of main.children) if (!el.matches(NOT_SCREEN)) screens.push(el);
  let head = null;
  for (const el of screens) { head = el.querySelector(HEADS); if (head) break; }
  return { screens, head, words: [], body: screens };
}

const wanted = () => HAS && glass() && !instant() && !calm() && !reduced();

/* What an opacity move of ours had really reached, read off its own clock (never a style): its start while it is
   still pending (not on the glass yet), else where its keyframes are at the document's last frame. */
function reached(a, from, to, ms) {
  if (!a) return to;
  try {
    if (a.pending || a.currentTime === null) return from;
    if (a.playState === 'finished') return to;
    // (the document's clock in a task runs a frame ahead of the last frame painted: that frame's value is taken, so
    // the new screen never starts darker than the old one was last seen)
    const x = Math.max(0, Math.min(1, (Number(a.currentTime) - FRAME) / Math.max(1, ms)));
    return from + (to - from) * x;
  } catch (error) { return to; }
}
function run(el, frames, options, id) {
  try { return el.animate(frames, { ...options, id }); } catch (error) { return null; }
}
function drop(move) {
  if (!move) return;
  for (const a of move.anims) { try { a.cancel(); } catch (error) { /* gone */ } }
}

/* A screen drawn again on its own while it is moving (Today redraws itself on 'data', 'streak' and 'status'; critic 2's
   must-fix 4: the dim popped back to full before the swap, and a glide was dropped part-way): the parts it put in
   are given the same move, on the same clock, so the picture goes on from where it was. Watched only while a move
   is under way; a mutation's callback runs once a task, after the draw, and reads no layout. */
let watcher = null;
function watch(main) {
  if (typeof MutationObserver !== 'function' || !main) return;
  if (!watcher) {
    watcher = new MutationObserver(() => {
      for (const move of [leaving, coming]) if (move && move.again) { try { move.again(); } catch (error) { /* left as it is */ } }
      if (!leaving && !coming) { watcher.disconnect(); watcher.on = null; }
    });
  }
  if (watcher.on === main) return;
  watcher.disconnect();
  watcher.observe(main, { childList: true, subtree: true });
  watcher.on = main;
}
/* `list` of [element, keyframes, timing]: each animated, and again for one put in its place later (same start). */
function moves(make, id) {
  const done = new WeakSet();
  const anims = [];
  let start = null;
  const again = () => {
    if (start === null) for (const a of anims) { if (a && a.startTime !== null) { start = a.startTime; break; } }
    for (const [el, frames, timing] of make()) {
      if (done.has(el)) continue;
      done.add(el);
      const a = run(el, frames, timing, id);
      if (!a) continue;
      if (start !== null) { try { a.startTime = start; } catch (error) { /* starts now */ } }
      anims.push(a);
    }
  };
  return { anims, again, startAt: (t) => { start = t; for (const a of anims) { try { a.startTime = t; } catch (error) { /* as it was */ } } } };
}

/* The old screen starts going, in the tap's own task. `from`, `to`: tab ids. */
function leave(from, to) {
  drop(leaving);
  leaving = null;
  // (a second tab tapped before the first one's screen was drawn: the old screen, already held, stays where it is and
  // goes on going; main.view is empty until the draw)
  const waiting = held && view() && !parts(view()).screens.length ? held : null;
  if (!waiting) forget();
  if (!wanted()) { forget(); drop(coming); coming = null; return; }
  const a = ORDER.indexOf(from);
  const b = ORDER.indexOf(to);
  const main = waiting ? waiting.el : view();
  if (a < 0 || b < 0 || a === b || !main) return;
  const d = D();
  // (a screen still coming in goes from the opacity it had reached: its own move is let go of in this same task)
  let start = 1;
  let wordsStart = 1;
  if (coming) { start = coming.at(); wordsStart = coming.wordsAt(); drop(coming); coming = null; }
  if (!parts(main).screens.length) return;
  const ms = d.press;
  const timing = { duration: ms, easing: 'linear', fill: 'forwards' };
  const floor = Math.min(start, FLOOR);
  const wordsFloor = Math.min(wordsStart, WORDS_FLOOR);
  // (from a whole screen, from where each part is: one keyframe, so the start is its underlying value, its own fade in
  // included (a section of a screen just drawn, still coming in, faded from 1 here flashed up before going down), with
  // nothing read; going on from a screen still coming in, from what that showed)
  const fades = moves(() => parts(main).body.map((el) => [el, start < 1 ? [{ opacity: start }, { opacity: floor }] : [{ opacity: floor }], timing]), OUT);
  const wordFades = moves(() => parts(main).words.map((el) => [el, [{ opacity: wordsStart }, { opacity: wordsFloor }], timing]), OUT);
  fades.again();
  wordFades.again();
  // (from the tap itself, not from the frame after it: the pill's first frame already shows the screen easing, and is
  // committed to the glass in that frame, so it keeps going during the new screen's draw)
  let now = null;
  try { now = document.timeline.currentTime; } catch (error) { now = null; }
  if (now !== null) { fades.startAt(now); wordFades.startAt(now); }
  const anims = fades.anims;
  const words = wordFades.anims;
  leaving = {
    get anims() { return anims.concat(words); }, dir: b > a ? 1 : -1, axis: wide() ? 'Y' : 'X', quick: lite(),
    at: () => reached(anims[0], start, floor, ms), wordsAt: () => reached(words[0], wordsStart, wordsFloor, ms),
    again: () => { fades.again(); wordFades.again(); },
    // (paused at the frame last painted: the document's clock in a task runs a frame ahead of it, as in reached())
    hold: () => {
      let t = 0;
      try { t = anims[0] && !anims[0].pending && anims[0].currentTime !== null ? Math.max(0, Math.min(ms, Number(anims[0].currentTime) - FRAME)) : 0; } catch (error) { t = ms; }
      for (const x of anims.concat(words)) { try { x.pause(); x.currentTime = t; } catch (error) { /* as it is */ } }
    },
  };
  watch(main);
}

/* The old screen, held under the new one while it comes in (critic 2's must-fix 1: with one screen on the glass the
   change was a cut whatever the fades did). js/start.js asks for this on the tab's pointerdown (prepare()), else
   (a key, a click with no press first) in the pill's first frame right after leave() (show() calls it again, which then only adopts what is held, or holds it then for a draw nothing held
   for: a page that wasn't painted): the
   old screen's own nodes (never a clone) go into a second main.view of their own, its data-tab the old one so every
   rule that drew them still does, inert and hidden from a screen reader, under main.view (#app is a stacking context:
   z-index under), and leave with the new one's arrival.
   Fix round 3 (critic 3):
     - only the screenful in sight is drawn again: every part out of sight is locked first (content-visibility hidden at
       the size it had, so nothing in sight moves), so the moved tree is not styled and laid out again in the new
       screen's draw, and the move is made while the finger is still down (must-fix 3: the first new frame came 40 ms late
       on the phone, 80 at the Chromebook's size); a part above the screenful is left as it is;
     - its scroll places go back in this same task, before anything is painted (must-fix 1: put back a frame later,
       the first frame showed the held screen at its top; tests/test_wefty_20_tabmove.py films it);
     - its header and the parts of its top band (BAND) are all but gone (BAND_FROM, then nothing two frames on) from the
       first frame that shows the new screen (drawn()): they lay over the new header's words as a second page
       (must-fix 2).
   Everything is read first (the layout is still the frame's), then written; all of it is undone in forget(). */
let held = null;
function forget() {
  if (!held) return;
  const was = held;
  held = null;
  for (const a of was.anims) { try { a.cancel(); } catch (error) { /* gone */ } }
  try { was.el.remove(); } catch (error) { /* gone */ }
  // (after it is out of the page, where undoing them costs nothing; a part a screen took back for itself meanwhile
  // is whole again before it is painted)
  for (const [el, cv, cis] of was.locks) {
    try { el.style.contentVisibility = cv; el.style.containIntrinsicSize = cis; } catch (error) { /* gone */ }
  }
}
const DEEPEST = 14;     // (how far down a part in sight is looked into for its parts out of sight)
/* A screen's top band: the rows right under its header that read as part of it (Today's greeting with its date and
   counts, and its line; Notes' chips; Share's switch), hidden with the header when the new screen comes in. Only
   those of them still near the top (BAND_PX under the header at most), never a list's own content. */
const BAND = '.today-greet, .today-line, .list-column > .chips, .share-switch, [data-ui-band]';
const BAND_PX = 12;
const BAND_FROM = 0.15;
const BAND_MS = 34;
const px = (v) => parseFloat(v) || 0;
/* The parts of `screens` out of sight, with the content size each has (for contain-intrinsic-size), read only. */
function outOfSight(screens) {
  const vw = window.innerWidth || 0;
  const vh = window.innerHeight || 0;
  const found = [];
  if (!vw || !vh) return found;
  const visit = (el, depth) => {
    for (const child of el.children) {
      const r = child.getBoundingClientRect();
      if (!r.width && !r.height) continue;  // (not drawn, or display: contents: left as it is)
      // (a part above the screenful stays as it is: locked, the margins it shares with what is inside it no longer
      // collapse, and everything under it moved 10 px down on Today scrolled)
      if (r.bottom <= 0) continue;
      if (r.top >= vh || r.right <= 0 || r.left >= vw) {
        const cs = getComputedStyle(child);
        if (cs.display === 'inline' || cs.display.startsWith('table-')) continue;
        const w = r.width - px(cs.paddingLeft) - px(cs.paddingRight) - px(cs.borderLeftWidth) - px(cs.borderRightWidth);
        const h = r.height - px(cs.paddingTop) - px(cs.paddingBottom) - px(cs.borderTopWidth) - px(cs.borderBottomWidth);
        found.push([child, Math.max(0, w), Math.max(0, h)]);
      } else if (depth < DEEPEST && child.childElementCount) visit(child, depth + 1);
    }
  };
  for (const s of screens) visit(s, 0);
  return found;
}
/* The old screen's header and the parts of its top band, read only. */
function topBand(main, head, body) {
  if (!head) return [];
  const h = head.getBoundingClientRect();
  const out = [head];
  // (the band's parts anywhere in the screen: the screen fades as one node now, so they are no longer its body's own)
  for (const screen of body) {
    for (const el of screen.querySelectorAll(BAND)) {
      const r = el.getBoundingClientRect();
      if ((r.width || r.height) && r.top < h.bottom + BAND_PX) out.push(el);
    }
  }
  return out;
}
function aside(main, scrolled, early = false) {
  if (held && main && !parts(main).screens.length) { held.leave = leaving; return !!leaving; }  // (held already, above)
  forget();
  if ((!leaving && !early) || !main || !wanted() || typeof document.createElement !== 'function') return false;
  const { screens, head, body } = parts(main);
  if (!screens.length) return false;
  // (reads: scroll places, what is out of sight, the top band)
  const scrolls = [];
  for (const el of scrolled || [main]) {
    try {
      const top = el.scrollTop;
      const left = el.scrollLeft;
      if ((top || left) && (el === main || screens.some((s) => s.contains(el)))) scrolls.push([el, top, left]);
    } catch (error) { /* not read */ }
  }
  let hidden = [];
  let band = [];
  try { hidden = outOfSight(screens); } catch (error) { hidden = []; }
  try { band = topBand(main, head, body); } catch (error) { band = []; }
  // (writes)
  const locks = [];
  for (const [part, w, h] of hidden) {
    locks.push([part, part.style.contentVisibility, part.style.containIntrinsicSize]);
    part.style.containIntrinsicSize = `${w}px ${h}px`;
    part.style.contentVisibility = 'hidden';
  }
  const back = screens.map((x) => [x, x.nextSibling]);
  const el = document.createElement('main');
  el.className = 'view ui-tab-old';
  if (main.dataset.tab) el.dataset.tab = main.dataset.tab;
  if (main.dataset.nav) el.dataset.nav = main.dataset.nav;
  el.inert = true;
  el.setAttribute('aria-hidden', 'true');
  for (const s of screens) el.append(s);
  main.after(el);
  held = { el, anims: [], locks, band, leave: leaving, main, scrolls, back };
  // (back where they were in this same task: laid out now, with only the screenful in sight to lay out)
  for (const [x, top, left] of scrolls) {
    const at = x === main ? el : x;
    try { if (top) at.scrollTop = top; if (left) at.scrollLeft = left; } catch (error) { /* gone */ }
  }
  return true;
}

/* A tab pressed (js/start.js, on its pointerdown: a finger's press comes 60 to 100 ms before its click): the old screen
   is held already, so the work of moving it is done while the finger is still down, never in the new screen's frames.
   It shows exactly as it did. `unprepare` puts it back where it was when no tap came of the press. */
const prepare = (main, scrolled) => !held && !leaving && aside(main, scrolled, true);
function unprepare() {
  if (!held || held.leave || leaving) return;
  const was = held;
  const screens = [...was.el.children];
  try {
    for (const [x, next] of was.back) {
      if (x.parentElement !== was.el) continue;
      if (next && next.parentElement === was.main) was.main.insertBefore(x, next); else was.main.append(x);
    }
    for (const x of screens) if (x.parentElement === was.el) was.main.append(x);
  } catch (error) { /* as it is */ }
  forget();
  for (const [x, top, left] of was.scrolls) { try { if (top) x.scrollTop = top; if (left) x.scrollLeft = left; } catch (error) { /* gone */ } }
}

/* js/start.js's show(), once a screen has been drawn after a tab's leave(): the new screen comes in. */
function drawn() {
  const was = leaving;
  leaving = null;
  if (!was) { forget(); return; }
  const under = held;
  // (what the old screen had really reached: 1 if its move never got to the glass)
  const reachedAt = was.at();
  const wordsFrom = was.wordsAt();
  // (the old screen's own fades stay with it, under the new one, for as long as it shows: let go of with it)
  // (held where they had got to: the old screen under the new one shows what it showed, never dims on below it)
  if (under) { was.hold(); under.anims.push(...was.anims); } else drop(was);
  const main = view();
  if (!main || !wanted()) { forget(); return; }
  if (!parts(main).screens.length) { forget(); return; }
  const d = D();
  const px = was.quick ? 0 : was.dir * IN_PX;
  // (with the old screen under it the new one can come up from well below full: the two together never show less
  // than the old one did; without it (no screen to hold), from what the old one had reached, as before)
  const from = under ? Math.min(reachedAt, UNDER_FROM) : reachedAt;
  // (no start time given: each starts in the frame that first shows the new screen, however long the draw took)
  const fade = { duration: d.fade, easing: ease('out') };
  const travel = { duration: d.enter, easing: ease('settle') };  // (12 px over D.enter, the settle spring's shape)
  const fades = moves(() => (from < 0.999 ? parts(main).body.map((el) => [el, [{ opacity: from }, { opacity: 1 }], fade]) : []), IN);
  const wordFades = moves(() => (wordsFrom < 0.999 ? parts(main).words.map((el) => [el, [{ opacity: wordsFrom }, { opacity: 1 }], fade]) : []), IN);
  const travels = moves(() => {
    if (!px) return [];
    const { screens } = parts(main);
    // (the header rides with its screen: no move of its own)
    return screens.map((el) => [el, [{ translate: shift(was.axis, px) }, { translate: '0px 0px' }], travel]);
  }, IN);
  // (Notes' own + arrives with its screen, in its place: never its own pop-in under the tab's move, which glass/notes.js
  // also stops for a tab's arrival, a task later)
  for (const el of parts(main).screens) if (el.matches('.fab') && el.dataset) el.dataset.gnStill = '';
  for (const m of [travels, fades, wordFades]) m.again();
  if (under) {
    // (the old screen goes as the new one covers it, from about half of what it showed (UNDER_START) in UNDER_MS:
    // from full over 120 ms its words read through the new ones as a second page, critic 3's must-fix 2)
    // (a frame after the new one starts rising: its parts redrawn meanwhile start on their own clock, up to a frame late)
    const going = run(under.el, [{ opacity: UNDER_START }, { opacity: 0 }], { duration: UNDER_MS, delay: FRAME, easing: 'linear', fill: 'both' }, OUT);
    // (its header and top band all but gone from the first frame that shows the new screen, never before it: from
    // BAND_FROM over two frames, on their own clock, as a move the gate's second-tap check sees under way)
    for (const part of under.band || []) {
      const a = run(part, [{ opacity: BAND_FROM }, { opacity: 0 }], { duration: BAND_MS, easing: 'linear', fill: 'forwards' }, OUT);
      if (a) under.anims.push(a);
    }
    // (on the new screen's clock: the old one's fade alone was started a frame or two before the new one's at the
    // Chromebook's size, which showed both dimmer for those frames)
    const lead = fades.anims[0] || wordFades.anims[0] || travels.anims[0];
    if (lead && going) {
      lead.ready.then(() => { if (held === under && lead.startTime !== null) { try { going.startTime = lead.startTime; } catch (error) { /* as it is */ } } }, () => {});
    }
    if (going) {
      under.anims.push(going);
      going.finished.then(() => { if (held === under) forget(); }, () => {});
    } else forget();
  }
  const mine = {
    get anims() { return fades.anims.concat(wordFades.anims, travels.anims); },
    again: () => { for (const m of [fades, wordFades, travels]) m.again(); },
  };
  const level = (list, start) => {
    const f = list[0];
    if (!f) return 1;
    try { return f.currentTime === null || f.pending ? start : start + (1 - start) * outCurve(Math.min(1, f.currentTime / d.fade)); } catch (error) { return 1; }
  };
  // (a tab tapped while this one comes in sends it out from what the two together showed)
  mine.at = () => { const o = level(fades.anims, from); return under && held === under ? Math.max(o, Math.min(1, o + (1 - o) * reachedAt)) : o; };
  mine.wordsAt = () => level(wordFades.anims, wordsFrom);
  // (with nothing to move, a quick draw is a plain swap: still this tab's arrival for the rest of this task, so
  // glass/loading.js's brightening, asked for right after this, does not dim it again)
  coming = mine;
  watch(main);
  const done = () => { if (coming === mine) coming = null; };
  const all = mine.anims;
  if (!all.length) { Promise.resolve().then(done); return; }
  Promise.all(all.map((x) => x.finished)).then(done, done);
}

/* Whether a tab's move is under way (glass/loading.js then leaves the new screen's brightening to it). */
const moving = () => !!(leaving || coming);

V.tabMove = { leave, aside, prepare, unprepare, drawn, moving, IDS: [OUT, IN] };
})();
