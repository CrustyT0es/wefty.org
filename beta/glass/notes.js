/* Wefty 2.0 "glass", area: Notes. This file belongs to the Notes builder; nobody else edits it.
   Notes (js/notes.js, organise.js, drag.js): the list and its cards, folders and chips, swipe, a card growing open into
   the note, the pick bar, the empty folder.
   Rules (vault/web/glass/README.txt has the rest): everything here is inert unless V.look.isGlass() (and listens to
   V.on('look') so the switch works live); use the tokens in glass.css (--g-*, and the app's own names, which glass
   redefines); only transform and opacity animate; call V.motion's helpers instead of writing your own; nothing here
   changes the classic look.

   What this file does, and why it is built this way.
   js/notes.js draws Notes once when the tab opens (render), then draws the list, the chips and the folder rail again
   in place at every change (a sync, a pin, a search typed). An animation started on a card is gone with the next
   draw, so this file watches the screen and plays each MOMENT when it happens:
     - the entrance: the rows rise in one after the other when Notes is opened (never for a data refresh: a draw that
       lands in the first 1.4 s carries the entrance on from where it was, so nothing restarts), and the list alone
       again, quicker, when another list is picked (a chip, a folder; never a letter typed in the search);
     - the picked chip's highlight slides from the chip it was on to the new one (and the folder rail's, wide);
     - a phone's swipe on a card: right pins it (or unpins), left moves it to the Trash. The card follows the finger
       sideways, a colour behind it says what letting go does, past 80 px it's armed; let go and it flies off, the
       cards under it close up smoothly, and the toast's Undo brings it back with the others making room. Up and down
       still scroll, a finger held still 450 ms still picks the card and drags it (js/drag.js), a tap still opens it;
     - a fold ("Past week") opening: its cards rise in and what's under it slides down (and back up as it closes);
     - a phone's pull at the top of the list syncs (V.motion.pull), with the edge light when it's done;
     - a card tapped on a phone grows into the note (a glass shell grows from the card's box to the whole screen and
       the note fades in over it) and shrinks back into the card when the note closes (a plain fade where the card
       isn't on the screen);
     - a card picked sparks.
   The swipe is Notes' own gesture (with V.motion.swipe's numbers: 80 px to arm, 150 px before it resists, the same
   springs) because it has to give way to js/drag.js's hold and to the list being drawn again (js/notes.js holdDraws).
   Nothing here is in classic: with the look off, everything made here is taken away where it stands. */
'use strict';

(() => {
const V = window.V;
if (!V || !V.look) return;
const root = document.documentElement;
const HAS_WAAPI = typeof Element !== 'undefined' && typeof Element.prototype.animate === 'function';
const EASE = 'cubic-bezier(.2,.8,.2,1)';
const SLIDE = 'cubic-bezier(.25,1.18,.35,1)';
const EXIT = 'cubic-bezier(.5,0,.8,.4)';
const ENTRANCE_MS = 1400;  // the first part of an opening, in which a redraw carries the entrance on
const ARM = 80;            // px a card is swiped before letting go commits (V.motion.swipe's)
const MAX = 150;           // px it follows the finger freely; past it, it resists
const FLIP_WAIT = 1600;    // ms a change has to be drawn in, for the cards to close up or make room

const on = () => !!V.look.isGlass();
const calm = () => root.classList.contains('calm');
const lite = () => root.classList.contains('lite');
const wide = () => !!(V.wide && V.wide());
const now = () => performance.now();
const coarse = () => { try { return window.matchMedia('(pointer: coarse)').matches; } catch (error) { return false; } };
const buzz = (ms) => { try { if (navigator.vibrate && !calm()) navigator.vibrate(ms); } catch (error) { /* not allowed here */ } };
const edge = (kind) => { try { V.emit('edge', kind); } catch (error) { /* nobody is listening */ } };

let view = null;           // main.view
let layout = null;         // the .notes-layout now decorated
let column = null;         // its .list-column (a phone's scroller)
let list = null;           // its .list
let chips = null;          // its .chips
let rail = null;           // its .folders
let viewWatch = null;      // main.view's own children (a new layout)
let listWatch = null;      // the list's cards, drawn again; a card picked
let barsWatch = null;      // the chips and the rail, drawn again
let opened = 0;            // when Notes was opened (js/start.js's 'tab'), until a layout has used it
let openStart = 0;         // when the entrance now running began
let lastFilter = null;     // the list shown last (its filter, without the search)
let flipPlan = null;       // { at, rects: Map key -> rect, fresh: Set of keys that come in anew }
let tidiedFor = null;      // the picked chip the chips row was last tidied for (tidyChips)
let pullHandle = null;
let pullHint = null;
const timers = new Set();
const later = (fn, ms) => { const id = setTimeout(() => { timers.delete(id); fn(); }, ms); timers.add(id); return id; };

function startNow(a) {
  try { if (a && document.timeline && document.timeline.currentTime != null) a.startTime = document.timeline.currentTime; } catch (error) { /* fine */ }
}
function animate(el, keyframes, options) {
  if (!el || !HAS_WAAPI || !el.isConnected) return null;
  try { return el.animate(keyframes, options); } catch (error) { return null; }
}
const filterOf = () => ((column && column.dataset.place) || '').split('|')[0];

/* -- the entrance */

/* What rises when Notes opens, in order: the chips, then the list's own rows (the first eight wait their
   turn; the rest come with the eighth). Wide: the folder rail and the search row too. */
function risers(l) {
  const out = [];
  const add = (el) => { if (el && el.getClientRects().length) out.push(el); };
  if (wide()) add(l.querySelector('.folders'));
  const col = l.querySelector('.list-column');
  if (col) {
    if (wide()) add(col.querySelector(':scope > .list-head'));
    // (the top row, with its buttons, is where it belongs from the first frame: round 4)
    add(col.querySelector(':scope > .chips'));
  }
  const rows = l.querySelector('.list');
  if (rows) for (const child of rows.children) { if (out.length > 14) break; add(child); }
  return out;
}
function rise(els, { elapsed = 0, stagger = 45, duration = 500, from = 12, delay = 0 } = {}) {
  if (calm()) return;
  els.forEach((el, i) => {
    const wait = delay + Math.min(i, 7) * stagger;
    animate(el, from ? [{ opacity: 0, transform: `translateY(${from}px)` }, { opacity: 1, transform: 'none' }] : [{ opacity: 0 }, { opacity: 1 }],
      { duration: lite() ? 180 : duration, delay: (lite() ? Math.min(wait, 90) : wait) - elapsed, easing: EASE, fill: 'backwards' });
  });
}
/* The thread under a phone's title draws itself (its mask is the wave: it's revealed from the left). */
function drawThread(l, elapsed = 0) {
  const title = l.querySelector('.list-column > .list-title');
  if (!title || wide() || calm() || !HAS_WAAPI) return;
  try {
    title.animate([{ transform: 'scaleX(0)', opacity: 0 }, { transform: 'scaleX(1)', opacity: 0.9 }],
      { duration: lite() ? 200 : 1100, delay: (lite() ? 0 : 220) - elapsed, easing: EASE, fill: 'backwards', pseudoElement: '::after' });
  } catch (error) { /* a browser without pseudo-element animations: the thread is simply there */ }
}
function entrance(l) {
  const col = l.querySelector('.list-column');
  if (col && col.classList.contains('g-wait')) return;  // (the skeleton is up: glass/loading.js rises the screen as it goes)
  openStart = now();
  // (opened again where it was left, js/start.js putting the list back where it was scrolled to: the rows fade in where
  // they stand, as anything that moves them would move what it measures)
  const kept = !!(col && col.scrollTop > 0);
  rise(risers(l), { from: kept ? 0 : 12 });
  if (!kept) drawThread(l);
}

/* -- the picked chip's highlight (and the rail's), sliding from where it was */

const slides = new WeakMap();  // container -> { key, box } (where its highlight was last put)
function placeSlide(box, selector, animateIt) {
  if (!box || !box.isConnected) return;
  let slide = box.querySelector(':scope > .gn-slide');
  const target = box.querySelector(selector);
  if (!target || !box.offsetParent || !target.offsetWidth) {
    if (slide) slide.hidden = true;
    box.classList.remove('gn-slid');
    return;
  }
  if (!slide) {
    slide = document.createElement('div');
    slide.className = 'gn-slide';
    slide.setAttribute('aria-hidden', 'true');
    slide.appendChild(document.createElement('i'));
    box.appendChild(slide);
  }
  slide.hidden = false;
  const next = { x: target.offsetLeft, y: target.offsetTop, w: target.offsetWidth, h: target.offsetHeight };
  const key = target.dataset.id || target.textContent;
  const was = slides.get(box);
  slide.style.width = `${next.w}px`;
  slide.style.height = `${next.h}px`;
  slide.style.transform = `translate3d(${next.x}px, ${next.y}px, 0)`;
  box.classList.add('gn-slid');
  slides.set(box, { key, box: next });
  if (!animateIt || !was || was.key === key || calm() || !HAS_WAAPI) return;
  const from = was.box;
  if (Math.abs(from.x - next.x) < 1 && Math.abs(from.y - next.y) < 1) return;
  animate(slide, [
    { transform: `translate3d(${from.x}px, ${from.y}px, 0) scale(${(from.w / next.w).toFixed(3)}, ${(from.h / next.h).toFixed(3)})` },
    { transform: `translate3d(${next.x}px, ${next.y}px, 0)` },
  ], { duration: lite() ? 220 : 460, easing: lite() ? 'ease-out' : SLIDE });
  // (the pill squashes a little as it lands, the tab bar's stretch)
  if (!lite()) animate(slide.firstElementChild, [{ transform: 'none' }, { transform: 'scale(1.06, .94)', offset: 0.28 }, { transform: 'scale(.985, 1.015)', offset: 0.6 }, { transform: 'none' }], { duration: 460, easing: 'cubic-bezier(.25,.8,.3,1)' });
}
function placeSlides(animateIt) {
  if (chips) { tidyChips(); placeSlide(chips, ':scope > .chip.on', animateIt); }
  if (rail) placeSlide(rail, '.nav-item.on', animateIt);
}

/* -- the cards closing up, or making room: where each one was, then where it is (transform only) */

function keyOf(el) {
  if (el.matches('.up-row')) return `u:${el.dataset.id}`;
  if (el.matches('button.card')) return `c:${el.dataset.id}`;
  if (el.matches('.subfolder')) return `s:${el.dataset.id}`;
  // (a heading by its name alone: its count changes with what moved)
  if (el.matches('.list-fold, .list-section')) return `h:${(el.querySelector('span') || el).textContent.trim().slice(0, 40)}`;
  return '';
}
function keyed(container) {
  const out = new Map();
  if (!container) return out;
  const top = -300, bottom = window.innerHeight + 300;
  for (const el of container.querySelectorAll('button.card[data-id], .up-row[data-id], .subfolder[data-id], .list-fold, .list-section')) {
    if (el.matches('button.card') && el.closest('.up-row')) continue;
    const r = el.getBoundingClientRect();
    if (!r.height || r.bottom < top || r.top > bottom) continue;
    const key = keyOf(el);
    if (key && !out.has(key)) out.set(key, { el, r });
  }
  return out;
}
/* A change is about to be drawn (a swipe let go, an Undo, a pick bar's action): where things are now is kept, and the
   draw that follows moves them from there. `fresh`: the notes that come in anew rather than move (a swiped card). */
function expectChange(fresh = []) {
  if (!list || calm()) return;
  const rects = new Map();
  for (const [key, { r }] of keyed(list)) rects.set(key, r);
  flipPlan = { at: now(), rects, fresh: new Set(fresh.map((id) => `c:${id}`)) };
}
function playFlip(plan, container, { newcomers = true } = {}) {
  if (!plan || !container || calm()) return;
  const after = keyed(container);
  let moved = 0;
  let came = 0;
  for (const [key, { el, r }] of after) {
    const was = plan.rects.get(key);
    if (was && !plan.fresh.has(key)) {
      const dx = was.left - r.left, dy = was.top - r.top;
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) continue;
      if (moved++ > 24) continue;
      const a = animate(el, [{ transform: `translate(${dx.toFixed(1)}px, ${dy.toFixed(1)}px)` }, { transform: 'none' }],
        { duration: lite() ? 200 : 460, easing: lite() ? 'ease-out' : SLIDE });
      // (it moves from the very next frame: a list drawn again is a long frame, and a pending animation would wait one
      // more before it starts, the cards standing still for that long: R2-02)
      startNow(a);
    } else if (newcomers && (!was || plan.fresh.has(key)) && r.top < window.innerHeight && r.bottom > 0) {
      if (came > 6) continue;
      // (a swiped card coming in anew, a note just pinned, comes at once: no pause after the fly-out, R2-02)
      const swiped = plan.fresh.has(key);
      const a = animate(el, [{ opacity: 0, transform: 'translateY(10px) scale(.97)' }, { opacity: 1, transform: 'none' }],
        { duration: lite() ? 180 : 420, delay: lite() || swiped ? 0 : 60 + came * 40, easing: EASE, fill: 'backwards' });
      if (swiped) startNow(a);
      came++;
    }
  }
}

/* -- a phone's search: the glass circle grows into the field, and shrinks back into it (the owner's screen recording:
   nothing moved for a moment, then the row swapped at once, the list jumped, and on the way back the row came back in two
   steps). js/notes.js swaps the title row for the search row with one class (.searching) and focuses the box in the same
   tap, so the keyboard starts at once; this watches that class and, before the frame is painted, keeps both rows on the
   screen for the move: the title row and the chips stay where they are (fading, the name sliding away), the search row is
   put over them (absolutely, exactly where it goes once alone: the two are as tall as each other, so the list never moves),
   and a capsule of glass (.gn-morph: two round ends and a stretched middle, so only transform moves it and it stays round)
   goes from the circle's box to the field's while the field's words fade in and the "Try" pills slide down in. Back, Esc,
   or the box left empty: the same, the other way, from wherever the last move had got to. Calm: the two rows crossfade. */
const MORPH_MS = 460;
const UNMORPH_MS = 400;
const MORPH_LITE = 220;
const GROW = 'cubic-bezier(.22,1.12,.36,1)';  // (a little past the field and back: a spring)
const SHRINK = 'cubic-bezier(.3,.85,.3,1)';
let morph = null;          // { anims, capsule, ghost, head, help, timer }
let searchWatch = null;
let wasSearching = false;
let drawnAt = 0;           // when this column had been on the screen a frame (a search opened as Notes is drawn doesn't morph)
let press = null;          // the circle pressed: { button, anim }

const rectOf = (el) => { const r = el.getBoundingClientRect(); return { left: r.left, top: r.top, width: r.width, height: r.height }; };
function capsuleRect(capsule) {  // the capsule's visible box (its two ends), on the screen
  const l = capsule.querySelector(':scope > .gn-l').getBoundingClientRect();
  const r = capsule.querySelector(':scope > .gn-r').getBoundingClientRect();
  return { left: l.left, top: l.top, width: r.right - l.left, height: l.height };
}
const opacityOf = (el) => { const v = parseFloat(getComputedStyle(el).opacity); return Number.isFinite(v) ? v : 1; };

function endMorph() {
  if (!morph) return;
  const m = morph;
  morph = null;
  clearTimeout(m.timer);
  for (const a of m.anims) { try { a.cancel(); } catch (error) { /* gone */ } }
  if (m.capsule) m.capsule.remove();
  if (m.ghost) m.ghost.remove();
  for (const el of [m.head, m.help]) if (el) { el.style.top = el.style.left = el.style.width = ''; }
  if (column) column.classList.remove('gn-morphing');
  if (column && !column.classList.contains('searching')) for (const el of [m.head, m.help]) if (el) el.style.minHeight = '';
}

function morphSearch(open, removed) {
  const head = column && column.querySelector(':scope > .list-head');
  const title = column && column.querySelector(':scope > .list-title');
  const help = column && column.querySelector(':scope > .search-help');
  const row = column && column.querySelector(':scope > .chips');
  const box = head && head.querySelector(':scope > .search-box');
  if (!head || !title || !box || wide()) { endMorph(); return; }
  // (a move still going, such as Back tapped while the field grows: the new one starts where that one had got to)
  const from = morph && morph.capsule ? capsuleRect(morph.capsule) : null;
  const seen = morph ? { title: opacityOf(title), row: row ? opacityOf(row) : 1, box: opacityOf(box.querySelector('.search') || box) } : null;
  endMorph();
  const pressed = press;
  press = null;
  const letPressGo = () => { if (pressed) { try { pressed.anim.cancel(); } catch (error) { /* gone */ } } };
  if (!HAS_WAAPI || !drawnAt || !column.getClientRects().length) {
    letPressGo();
    if (!open) { head.style.minHeight = ''; if (help) help.style.minHeight = ''; }
    return;
  }
  const m = { anims: [], capsule: null, ghost: null, head, help, timer: 0 };
  morph = m;
  column.classList.add('gn-morphing');
  // (the circle as it is now, pressed in a little under the finger: the capsule starts from exactly that)
  const circleButton = title.querySelector('.notes-search');
  const circleAt = circleButton && circleButton.getClientRects().length ? rectOf(circleButton) : null;
  letPressGo();
  // the search row over the title row, the pills over the chips: the same places and heights as they take alone
  head.style.minHeight = `${title.offsetHeight}px`;
  // (the column's own width: the title row reaches 12 px past it, under the picture, and the search row doesn't)
  const pad = getComputedStyle(column);
  const inner = column.clientWidth - (parseFloat(pad.paddingLeft) || 0) - (parseFloat(pad.paddingRight) || 0);
  head.style.top = `${title.offsetTop}px`; head.style.left = `${parseFloat(pad.paddingLeft) || 0}px`; head.style.width = `${inner}px`;
  let pills = help;
  if (!open && removed && removed.length && row) {
    // (the "Try" pills are already gone from their row: the ones just taken out fade where they were)
    pills = m.ghost = document.createElement('div');
    pills.className = 'search-help gn-help-ghost';
    pills.setAttribute('aria-hidden', 'true');
    pills.inert = true;
    for (const node of removed) pills.append(node);
    column.insertBefore(pills, row);
  }
  for (const el of [help, m.ghost]) {
    if (!el || !row) continue;
    el.style.minHeight = `${row.offsetHeight}px`;
    el.style.top = `${row.offsetTop}px`; el.style.left = `${row.offsetLeft}px`; el.style.width = `${row.offsetWidth}px`;
  }
  // (each starts on the frame the tap is painted in, not one later: the field is moving the moment the finger lifts)
  const go = (el, keyframes, options) => { const a = animate(el, keyframes, options); if (a) { startNow(a); m.anims.push(a); } return a; };
  const soft = calm();
  const ms = lite() ? MORPH_LITE : open ? MORPH_MS : UNMORPH_MS;
  const ease = lite() ? EASE : open ? GROW : SHRINK;
  const words = [...box.children].filter((el) => !el.matches('.icon'));
  const icon = box.querySelector(':scope > .icon');
  const back = head.querySelector(':scope > .search-back');
  const line = title.querySelector('.title-stack') || title.querySelector('h1');
  const pillsIn = pills ? [...pills.children] : [];
  let total = ms;
  if (soft) {
    // Calm: the rows crossfade where they are
    const d = 200;
    go(title, [{ opacity: seen ? seen.title : open ? 1 : 0 }, { opacity: open ? 0 : 1 }], { duration: d, easing: 'linear', fill: open ? 'forwards' : 'backwards' });
    if (row) go(row, [{ opacity: seen ? seen.row : open ? 1 : 0 }, { opacity: open ? 0 : 1 }], { duration: d, easing: 'linear', fill: open ? 'forwards' : 'backwards' });
    for (const el of [box, back, pills]) if (el) go(el, [{ opacity: open ? 0 : 1 }, { opacity: open ? 1 : 0 }], { duration: d, easing: 'linear', fill: open ? 'backwards' : 'forwards' });
    total = d;
  } else {
    const z = (head.getBoundingClientRect().width / head.offsetWidth) || 1;
    const base = rectOf(box);
    const circle = circleAt;
    if (circle && circle.width > 0) {
      const W = box.offsetWidth;
      const h = box.offsetHeight;
      const capsule = m.capsule = document.createElement('div');
      capsule.className = 'gn-morph';
      capsule.setAttribute('aria-hidden', 'true');
      Object.assign(capsule.style, { left: `${box.offsetLeft}px`, top: `${box.offsetTop}px`, width: `${W}px`, height: `${h}px` });
      const piece = (cls, left, width, radius) => {
        const el = document.createElement('i');
        el.className = cls;
        Object.assign(el.style, { left: `${left}px`, width: `${width}px`, borderRadius: radius });
        capsule.append(el);
        return el;
      };
      piece('gn-l', 0, h / 2, `${h / 2}px 0 0 ${h / 2}px`);
      const mid = piece('gn-m', h / 2, Math.max(1, W - h), '0');
      const end = piece('gn-r', W - h / 2, h / 2, `0 ${h / 2}px ${h / 2}px 0`);
      head.insertBefore(capsule, head.firstChild);
      // a box on the screen -> how the capsule is moved and stretched to be it (from the field's own box)
      const shape = (v) => {
        const s = v.height / base.height;
        const inner = Math.max(h, (h * v.width) / v.height);
        return {
          whole: `translate(${(v.left - base.left) / z}px, ${(v.top - base.top) / z}px) scale(${s})`,
          mid: `scaleX(${Math.max(0, (inner - h) / Math.max(1, W - h))})`,
          end: `translateX(${inner - W}px)`,
        };
      };
      const a = shape(from || (open ? circle : base));
      const b = shape(open ? base : circle);
      const timing = { duration: ms, easing: ease, fill: 'both' };
      go(capsule, [{ transform: a.whole }, { transform: b.whole }], timing);
      go(mid, [{ transform: a.mid }, { transform: b.mid }], timing);
      go(end, [{ transform: a.end }, { transform: b.end }], timing);
      // the circle's glass becomes the field's (its ring lights up as it gets there), and back
      const look = getComputedStyle(box);
      const own = { backgroundColor: look.backgroundColor, boxShadow: look.boxShadow };
      const bare = { backgroundColor: 'rgba(0, 0, 0, 0)', boxShadow: 'none' };
      if (open) {
        go(capsule, [{ opacity: 1 }, { opacity: 1, offset: 0.6 }, { opacity: 0 }], { duration: ms, easing: 'linear', fill: 'both' });
        go(box, [{ ...bare }, { ...bare, offset: 0.6 }, { ...own }], { duration: ms, easing: 'linear', fill: 'backwards' });
      } else {
        go(capsule, [{ opacity: from ? 1 : 0 }, { opacity: 1, offset: 0.3 }, { opacity: 1 }], { duration: ms, easing: 'linear', fill: 'both' });
        go(box, [{ ...own }, { ...bare, offset: 0.3 }, { ...bare }], { duration: ms, easing: 'linear', fill: 'forwards' });
      }
      // the magnifier goes with it, from the circle's middle to its place in the field
      if (icon) {
        const there = circleButton && circleButton.querySelector('.icon');
        const c = there && there.getClientRects().length ? rectOf(there) : null;
        const i = rectOf(icon);
        if (c) {
          const moved = `translate(${(c.left + c.width / 2 - i.left - i.width / 2) / z}px, ${(c.top + c.height / 2 - i.top - i.height / 2) / z}px)`;
          go(icon, open ? [{ transform: moved }, { transform: 'none' }] : [{ transform: 'none' }, { transform: moved }], { duration: ms, easing: ease, fill: open ? 'backwards' : 'forwards' });
        }
      }
    } else {
      go(box, [{ opacity: open ? 0 : 1 }, { opacity: open ? 1 : 0 }], { duration: 200, easing: EASE, fill: open ? 'backwards' : 'forwards' });
    }
    if (open) {
      for (const el of words) go(el, [{ opacity: seen ? seen.box : 0 }, { opacity: 1 }], { duration: 220, delay: 120, easing: EASE, fill: 'backwards' });
      if (back) go(back, [{ opacity: 0, transform: 'translateX(12px)' }, { opacity: 1, transform: 'none' }], { duration: 320, delay: 50, easing: SLIDE, fill: 'backwards' });
      go(title, [{ opacity: seen ? seen.title : 1 }, { opacity: 0 }], { duration: 180, easing: EASE, fill: 'forwards' });
      if (line) go(line, [{ transform: 'none' }, { transform: 'translateX(-18px)' }], { duration: 300, easing: EASE, fill: 'forwards' });
      if (row) go(row, [{ opacity: seen ? seen.row : 1, transform: 'none' }, { opacity: 0, transform: 'translateY(8px)' }], { duration: 180, easing: EASE, fill: 'forwards' });
      pillsIn.forEach((el, i) => go(el, [{ opacity: 0, transform: 'translateY(-12px)' }, { opacity: 1, transform: 'none' }],
        { duration: 380, delay: 80 + Math.min(i, 5) * 28, easing: SLIDE, fill: 'backwards' }));
      total = Math.max(ms, 80 + 5 * 28 + 380);
    } else {
      for (const el of words) go(el, [{ opacity: seen ? seen.box : 1 }, { opacity: 0 }], { duration: 110, easing: EASE, fill: 'forwards' });
      if (back) go(back, [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateX(12px)' }], { duration: 150, easing: EASE, fill: 'forwards' });
      go(title, [{ opacity: seen ? seen.title : 0 }, { opacity: 1 }], { duration: 260, delay: 90, easing: EASE, fill: 'backwards' });
      if (line) go(line, [{ transform: 'translateX(-18px)' }, { transform: 'none' }], { duration: 360, delay: 60, easing: SLIDE, fill: 'backwards' });
      if (row) go(row, [{ opacity: seen ? seen.row : 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'none' }], { duration: 320, delay: 100, easing: SLIDE, fill: 'backwards' });
      pillsIn.forEach((el) => go(el, [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateY(-8px)' }], { duration: 140, easing: EASE, fill: 'forwards' }));
      total = Math.max(ms, 100 + 320);
    }
  }
  m.timer = later(() => { if (morph === m) endMorph(); }, total + 30);
}

function searchMoved(records) {
  if (!on() || !column) return;
  const help = column.querySelector(':scope > .search-help');
  // (wide: the pills come in as the box is focused, once: glass/notes.css's .gn-help-in)
  if (help && !help.hidden && records.some((r) => r.type === 'attributes' && r.target === help && r.attributeName === 'hidden')) {
    help.classList.add('gn-help-in');
    later(() => help.classList.remove('gn-help-in'), 700);
  }
  const searching = column.classList.contains('searching');
  if (searching === wasSearching) return;
  wasSearching = searching;
  if (wide()) return;
  const removed = [];
  for (const r of records) if (r.type === 'childList' && r.target === help) for (const node of r.removedNodes) if (node.nodeType === 1) removed.push(node);
  morphSearch(searching, removed);
}
/* The circle pressed: it gives under the finger at once (Chrome only shows :active once it's sure the finger isn't
   scrolling), and the field grows from it as the tap lands. */
function searchPress(event) {
  if (!on() || wide() || calm() || (event.button || 0) > 0) return;
  const button = event.target && event.target.closest ? event.target.closest('.list-title .notes-search') : null;
  if (!button) return;
  if (press) { try { press.anim.cancel(); } catch (error) { /* gone */ } }
  const anim = animate(button, [{ transform: 'none' }, { transform: 'scale(.9)' }], { duration: 110, easing: EASE, fill: 'forwards' });
  if (!anim) return;
  startNow(anim);
  press = { button, anim };
  const mine = press;
  const letGo = () => {
    for (const type of ['pointerup', 'pointercancel']) window.removeEventListener(type, letGo, true);
    // (a frame later: a tap's click opens the search, which takes the circle from here)
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (press !== mine) return;
      press = null;
      if (!button.isConnected) return;
      const back = animate(button, [{ transform: 'scale(.9)' }, { transform: 'none' }], { duration: 260, easing: SLIDE });
      try { anim.cancel(); } catch (error) { /* gone */ }
      if (!back) return;
    }));
  };
  for (const type of ['pointerup', 'pointercancel']) window.addEventListener(type, letGo, true);
}
function watchSearch() {
  if (searchWatch) searchWatch.disconnect();
  searchWatch = null;
  drawnAt = 0;
  if (!column) return;
  wasSearching = column.classList.contains('searching');
  searchWatch = new MutationObserver(searchMoved);
  searchWatch.observe(column, { attributes: true, attributeFilter: ['class'] });
  const help = column.querySelector(':scope > .search-help');
  if (help) searchWatch.observe(help, { childList: true, attributes: true, attributeFilter: ['hidden'] });
  const mine = column;
  requestAnimationFrame(() => requestAnimationFrame(() => { if (column === mine) drawnAt = now(); }));
}
function unwatchSearch() {
  if (searchWatch) { searchWatch.disconnect(); searchWatch = null; }
  endMorph();
  if (press) { try { press.anim.cancel(); } catch (error) { /* gone */ } press = null; }
  if (column) for (const el of column.querySelectorAll(':scope > .list-head, :scope > .search-help')) el.style.minHeight = '';
  drawnAt = 0;
}

/* -- a list drawn again */

function listDrawn() {
  if (!list || !list.isConnected) return;
  const filter = filterOf();
  const otherList = lastFilter !== null && filter !== lastFilter;
  lastFilter = filter;
  const plan = flipPlan && now() - flipPlan.at < FLIP_WAIT ? flipPlan : null;
  flipPlan = null;
  const elapsed = openStart ? now() - openStart : Infinity;
  if (elapsed < ENTRANCE_MS) {
    // (a sync landing while Notes is still coming in: the new rows carry the entrance on from where it was)
    rise([...list.children].filter((el) => el.getClientRects().length).slice(0, 12), { elapsed, delay: 3 * 45, from: column && column.scrollTop > 0 ? 0 : 12 });
  } else if (otherList) {
    // another list picked (a chip, a folder, a #tag): its rows rise in again, quicker
    rise([...list.children].filter((el) => el.getClientRects().length).slice(0, 12), { stagger: 30, duration: 380, from: 10 });
  } else if (plan) {
    playFlip(plan, list);
  }
  if (pullHint) setPullTop();
}

/* -- a fold opening ("Past week"): its cards rise in, what's under it slides down (and up again as it closes) */

function foldTapped(event) {
  if (!on() || !list) return;
  const head = event.target && event.target.closest ? event.target.closest('.list-fold') : null;
  if (!head || !list.contains(head) || calm()) return;
  const plan = { rects: new Map(), fresh: new Set() };
  for (const [key, { r }] of keyed(list)) plan.rects.set(key, r);
  const opening = head.getAttribute('aria-expanded') !== 'true';
  requestAnimationFrame(() => {
    if (!head.isConnected) return;
    playFlip(plan, list, { newcomers: false });
    const box = head.nextElementSibling;
    if (opening && box && box.matches('.fold-notes') && !box.hidden) {
      [...box.children].slice(0, 10).forEach((card, i) => {
        animate(card, [{ opacity: 0, transform: 'translateY(-10px) scale(.98)' }, { opacity: 1, transform: 'none' }],
          { duration: lite() ? 160 : 400, delay: lite() ? 0 : Math.min(i, 7) * 45, easing: EASE, fill: 'backwards' });
      });
    }
  });
}

/* -- a card picked: its box sparks */

function picked(mutations) {
  if (!V.motion || calm() || lite()) return;
  for (const m of mutations) {
    if (m.type !== 'attributes' || m.attributeName !== 'class') continue;
    const el = m.target;
    if (!el.matches || !el.matches('button.card.selected') || /\bselected\b/.test(m.oldValue || '')) continue;
    const box = el.querySelector('.pick');
    if (box && box.getClientRects().length) V.motion.spark(box);
  }
}

/* -- a phone's swipe: right pins, left moves to the Trash */

let sw = null;  // { id, card, pid, x0, y0, mode: 'wait' | 'swipe' | 'none', x, armed, dir, reveal }
function sidesFor(id) {
  const note = V.data && V.data.notes ? V.data.notes.get(id) : null;
  if (!note || note.deleted) return null;
  const O = V.organise || {};
  const archived = O.isArchived ? O.isArchived(note) : false;
  const template = O.isTemplate ? O.isTemplate(note) : false;
  return { right: !archived && !template, left: true, pinned: !!note.pinned };
}
function swipeable(card) {
  if (!on() || wide() || !card || !list || !list.contains(card) || card.closest('.up-row')) return false;
  if (list.classList.contains('picking') || (V.notes && V.notes.picking && V.notes.picking())) return false;
  const filter = filterOf();
  return filter !== 'trash' && filter !== 'review';
}
function revealFor(card, sides) {
  const r = card.getBoundingClientRect();
  const l = list.getBoundingClientRect();
  const el = document.createElement('div');
  el.className = 'gn-reveal';
  el.setAttribute('aria-hidden', 'true');
  const word = (text) => { const s = document.createElement('span'); s.textContent = text; return s; };
  const pin = document.createElement('span');
  pin.className = 'gn-rv gn-rv-pin';
  pin.append(V.icon ? V.icon(sides.pinned ? 'pin-on' : 'pin') : '', word(sides.pinned ? 'Unpin' : 'Pin'));
  const del = document.createElement('span');
  del.className = 'gn-rv gn-rv-del';
  del.append(word('Trash'), V.icon ? V.icon('trash') : '');
  el.append(pin, del);
  el.dataset.armed = '0';
  Object.assign(el.style, { left: `${r.left - l.left}px`, top: `${r.top - l.top}px`, width: `${r.width}px`, height: `${r.height}px`, opacity: '0' });
  list.classList.add('gn-has-reveal');
  list.appendChild(el);
  return el;
}
function swipeDown(event) {
  if (sw || event.pointerType === 'mouse' || !event.isPrimary) return;
  const card = event.target && event.target.closest ? event.target.closest('button.card[data-id]') : null;
  if (!swipeable(card)) return;
  sw = { id: card.dataset.id, card, pid: event.pointerId, x0: event.clientX, y0: event.clientY, mode: 'wait', x: 0, armed: false, dir: '', reveal: null, sides: null };
}
function swipeMove(event) {
  if (!sw || event.pointerId !== sw.pid) return;
  const dx = event.clientX - sw.x0, dy = event.clientY - sw.y0;
  if (sw.mode === 'wait') {
    if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
    const sides = sidesFor(sw.id);
    const held = sw.card.classList.contains('drag-held') || (V.drag && V.drag.dragging && V.drag.dragging());
    if (held || !sides || !sw.card.isConnected || Math.abs(dx) <= Math.abs(dy) * 1.2 || !(dx > 0 ? sides.right : sides.left)) { sw.mode = 'none'; return; }
    sw.mode = 'swipe';
    sw.sides = sides;
    if (V.notes && V.notes.holdDraws) V.notes.holdDraws(true);
    sw.reveal = revealFor(sw.card, sides);
    sw.card.classList.add('gn-swiping');
    try { sw.card.setPointerCapture(event.pointerId); } catch (error) { /* fine without */ }
  }
  if (sw.mode !== 'swipe') return;
  const wanted = dx >= 0 ? 'right' : 'left';
  const enabled = !!sw.sides[wanted];
  const reach = enabled ? Math.abs(dx) : Math.min(Math.abs(dx), 14) * 0.3;
  const x = (reach <= MAX ? reach : MAX + (reach - MAX) * 0.3) * (dx >= 0 ? 1 : -1);
  sw.x = x;
  // (round-2 fix R2-02: the last moves are kept, so letting go flies on at the finger's own speed)
  const t = event.timeStamp || now();
  (sw.trail || (sw.trail = [])).push([t, x]);
  while (sw.trail.length > 2 && t - sw.trail[0][0] > 90) sw.trail.shift();
  sw.card.style.transform = `translateX(${x.toFixed(1)}px)`;
  const dir = x >= 0 ? 'r' : 'l';
  if (sw.dir !== dir) { sw.dir = dir; sw.reveal.dataset.dir = dir; }
  sw.reveal.style.opacity = String(Math.min(1, Math.abs(x) / 56));
  const armed = enabled && Math.abs(x) >= ARM;
  if (armed !== sw.armed) { sw.armed = armed; sw.reveal.dataset.armed = armed ? '1' : '0'; if (armed) buzz(8); }
}
/* The click a lifted swipe makes is not a tap (it would open the note). */
function swallowClick() {
  const swallow = (ev) => { ev.stopPropagation(); ev.preventDefault(); drop(); };
  const drop = () => { window.removeEventListener('click', swallow, true); };
  window.addEventListener('click', swallow, true);
  later(drop, 350);
}
function swipeEnd(event, cancelled) {
  if (!sw || (event && event.pointerId !== sw.pid)) return;
  const was = sw;
  sw = null;
  if (was.mode !== 'swipe') return;
  swallowClick();
  const { card, reveal } = was;
  const release = () => { if (V.notes && V.notes.holdDraws) V.notes.holdDraws(false); };
  const clean = () => {
    card.classList.remove('gn-swiping');
    card.style.transform = ''; card.style.transition = ''; card.style.opacity = '';
    if (reveal) reveal.remove();
    if (list && !list.querySelector(':scope > .gn-reveal')) list.classList.remove('gn-has-reveal');
  };
  if (was.armed && !cancelled) {
    const side = was.x > 0 ? 'right' : 'left';
    const quick = calm() || lite();
    // (round-2 fix R2-02: the card flies on from where the finger let go at the finger's own speed or faster, slowing
    // as it goes (an ease-out whose first slope, 3.5 times the average, is matched to that speed), never starting from
    // still; the cards below start closing up while it's still going, from 45 % of its time, when it has left the screen)
    const trail = was.trail || [];
    const first = trail[0], last = trail[trail.length - 1];
    const speed = first && last && last[0] > first[0] ? Math.abs(last[1] - first[1]) / (last[0] - first[0]) : 0;  // px per ms
    const travel = Math.max(40, 460 - Math.abs(was.x));
    const fly = quick ? 120 : Math.round(Math.min(300, Math.max(190, (3.5 * travel) / Math.max(speed, 0.6))));
    card.style.transition = quick ? `transform .12s ${EXIT}, opacity .12s linear`
      : `transform ${fly}ms cubic-bezier(.2,.7,.3,1), opacity ${fly}ms cubic-bezier(.4,0,1,1)`;
    card.style.transform = `translateX(${side === 'right' ? 460 : -460}px)`;
    card.style.opacity = '0';
    if (reveal) { reveal.style.transition = `opacity ${quick ? '.12s' : `${Math.round(fly * 0.9)}ms`} linear ${quick ? '.12s' : `${Math.round(fly * 0.3)}ms`}`; reveal.style.opacity = '0'; }
    later(() => {
      expectChange([was.id]);
      if (reveal) reveal.remove();
      release();
      const O = V.organise;
      const note = V.data.notes.get(was.id);
      let done = null;
      try {
        if (O && note) done = side === 'right' ? O.pin([was.id], !note.pinned) : O.trash([was.id]);
      } catch (error) { console.error(error); }
      Promise.resolve(done).catch((error) => { if (V.problem) V.problem(error); });
      // (nothing changed, so nothing was drawn again: the note-taker held it, say) the card comes back where it was
      later(() => {
        if (!card.isConnected) return;
        card.style.transition = 'none';
        card.style.transform = '';
        animate(card, [{ opacity: 0, transform: 'scale(.97)' }, { opacity: 1, transform: 'none' }], { duration: 260, easing: EASE });
        clean();
      }, 1400);
    }, quick ? 140 : Math.round(fly * 0.45));
  } else {
    card.style.transition = calm() ? 'transform .12s ease-out' : lite() ? 'transform .16s ease-out' : `transform .46s ${SLIDE}`;
    card.style.transform = 'translateX(0px)';
    if (reveal) { reveal.style.transition = 'opacity .2s ease'; reveal.style.opacity = '0'; }
    later(() => { clean(); release(); }, calm() ? 140 : lite() ? 180 : 480);
  }
}
function swipeTouch(event) {
  // (while a card is swiped, the list doesn't scroll under the finger)
  if (sw && sw.mode === 'swipe' && event.cancelable) event.preventDefault();
}

const swipeUp = (event) => swipeEnd(event, false);
const swipeCancel = (event) => swipeEnd(event, true);
const HANDLERS = [['pointerdown', searchPress], ['pointerdown', swipeDown], ['pointermove', swipeMove], ['pointerup', swipeUp], ['pointercancel', swipeCancel],
  ['touchmove', swipeTouch, { passive: false }]];

/* -- a phone's pull at the top of the list */

function setPullTop() {
  if (!pullHint || !list || !column) return;
  pullHint.style.setProperty('--gn-pull-top', `${Math.max(0, list.offsetTop - 2)}px`);
}
function bindPull() {
  unbindPull();
  const m = V.motion;
  if (!m || !m.pull || !column || !list || wide() || !coarse()) return;
  if (list.classList.contains('picking')) return;  // (picking: a pull would fight the long press)
  pullHint = document.createElement('div');
  pullHint.className = 'g-pull-hint gn-pull';
  pullHint.setAttribute('aria-hidden', 'true');
  column.insertBefore(pullHint, column.firstChild);
  setPullTop();
  pullHandle = m.pull(column, {
    wrap: list,
    // (the same sync as every screen's pull, one at a time, with the edge light: glass/shell.js)
    onRelease: (over) => {
      if (V.glass && V.glass.syncNow) { V.glass.syncNow().then((how) => over(how)); return; }
      let result = null;
      try { result = V.cloud && V.cloud.sync ? V.cloud.sync() : null; } catch (error) { result = Promise.reject(error); }
      Promise.resolve(result).then(() => { edge('synced'); over(true); }, () => over(false));
    },
  });
}
function unbindPull() {
  if (pullHandle) { pullHandle.destroy(); pullHandle = null; }
  if (pullHint) { pullHint.remove(); pullHint = null; }
}

/* -- a card growing into the note, and shrinking back */

let tapped = null;  // { id, card, at }: a card tapped on a phone, which is about to open
let grown = null;   // { id, layer }: the note grown from its card, shrinking back into it when it closes
let layersWatch = null;
function cardTapped(event) {
  if (!on() || wide() || !list) return;
  const card = event.target && event.target.closest ? event.target.closest('button.card[data-id]') : null;
  if (!card || !list.contains(card) || event.shiftKey || event.ctrlKey || event.metaKey) { tapped = null; return; }
  if (list.classList.contains('picking') || filterOf() === 'trash') { tapped = null; return; }
  tapped = { id: card.dataset.id, card, at: now() };
  // (merge, round 2: the note's layer is opaque glass now, so the editor grows the layer itself out of the card and
  // shrinks it back (glass/editor.js, V.glass.editorOpening / editorLeaving); this file's own shell is only the
  // fallback for an editor without that hook, so the two never play at once)
  if (V.glass && typeof V.glass.editorOpening === 'function') { V.glass.editorOpening(card); tapped = null; }
}
function shell() {
  const el = document.createElement('div');
  el.className = 'g-grow-shell';
  el.setAttribute('aria-hidden', 'true');
  const layers = document.getElementById('layers') || document.body;
  layers.appendChild(el);
  return el;
}
function grow(layer) {
  const t = tapped;
  tapped = null;
  if (!t || now() - t.at > 700 || !V.editor || V.editor.openId() !== t.id || calm() || !V.motion || !V.motion.flip) return;
  const card = t.card.isConnected ? t.card : list && list.querySelector(`button.card[data-id="${CSS.escape(t.id)}"]`);
  if (!card) return;
  grown = { id: t.id, layer };
  layer.classList.add('g-grow');
  const s = shell();
  const flip = V.motion.flip(card, s, { duration: lite() ? 220 : 460 });
  // The note itself: hidden while the shell grows under it, then it fades in and settles.
  const content = layer.firstElementChild;
  const start = () => {
    try { layer.getAnimations().forEach((a) => { if (!a.id || !a.id.startsWith('gn-')) a.finish(); }); } catch (error) { /* none */ }
    const fade = animate(layer, [{ opacity: 0 }, { opacity: 1 }], { duration: lite() ? 140 : 280, delay: lite() ? 60 : 90, easing: EASE, fill: 'backwards' });
    if (fade) fade.id = 'gn-grow';
    if (content && !lite()) animate(content, [{ transform: 'translateY(14px)' }, { transform: 'none' }], { duration: 420, delay: 90, easing: EASE, fill: 'backwards' });
  };
  // (the layer is shown a frame after it's added: its own fade-in waits for that, and is finished at once then)
  if (layer.classList.contains('shown')) start(); else requestAnimationFrame(() => requestAnimationFrame(start));
  animate(layer, [{ opacity: 0 }, { opacity: 0 }], { duration: 90, fill: 'backwards' });
  flip.finished.then(() => {
    s.remove();
    layer.classList.remove('g-grow');
  });
  later(() => { if (s.isConnected) s.remove(); layer.classList.remove('g-grow'); }, 1200);
}
function shrink(layer) {
  const g = grown;
  grown = null;
  if (!g || !on() || wide() || calm() || !V.motion || !V.motion.flip) return;
  const card = list && list.isConnected ? list.querySelector(`button.card[data-id="${CSS.escape(g.id)}"]`) : null;
  const s = shell();
  if (layer && layer.isConnected) {
    layer.classList.add('g-shrink');
    animate(layer, [{ opacity: 1 }, { opacity: 0 }], { duration: 120, easing: 'linear', fill: 'forwards' });
  }
  // The board's close: the shell shrinks back into the card on a soft spring and only fades in its last part, so it
  // reads as the note going back into its card (V.motion.flip's reverse fades all the way, which reads as a fade).
  const r = card ? card.getBoundingClientRect() : null;
  const usable = r && r.width > 10 && r.height > 10 && r.bottom > 0 && r.top < window.innerHeight;
  const w = window.innerWidth || 1, h = window.innerHeight || 1;
  const small = usable ? `translate(${r.left.toFixed(1)}px, ${r.top.toFixed(1)}px) scale(${(r.width / w).toFixed(4)}, ${(r.height / h).toFixed(4)})`
    : 'translate(2%, 2%) scale(.96)';
  s.style.transformOrigin = '0 0';
  const time = lite() ? 220 : usable ? 420 : 240;
  const move = animate(s, [{ transform: 'none' }, { transform: small }], { duration: time, easing: 'cubic-bezier(.3,.9,.3,1)', fill: 'forwards' });
  animate(s, [{ opacity: 1 }, { opacity: 1, offset: usable ? 0.57 : 0 }, { opacity: 0 }], { duration: time, easing: 'linear', fill: 'forwards' });
  if (move) move.finished.then(() => s.remove(), () => s.remove());
  later(() => { if (s.isConnected) s.remove(); }, 1000);
}
function layersChanged(mutations) {
  if (!on()) return;
  for (const m of mutations) {
    if (m.type === 'childList') {
      for (const node of m.addedNodes) if (node.nodeType === 1 && node.classList.contains('editor-layer')) grow(node);
      for (const node of m.removedNodes) {
        // (Back closes the note by taking the layer away at once)
        if (node.nodeType === 1 && node.classList.contains('editor-layer') && grown && grown.layer === node && node.classList.contains('shown')) shrink(null);
      }
    } else if (m.type === 'attributes' && m.target.classList.contains('editor-layer')) {
      const layer = m.target;
      if (grown && grown.layer === layer && /\bshown\b/.test(m.oldValue || '') && !layer.classList.contains('shown')) shrink(layer);
    }
  }
}

/* -- the chips row never shows a sliver of a chip at its left edge (round-2 fix R2-15): when a chip is cut there, the row
   is scrolled so the chip before the one picked starts on the 16 px gutter (or the picked one, if both don't fit).
   Only as another list is opened (the picked chip changed: js/notes.js has just brought it into sight). The same list
   drawn again (a sync landing, a note saved) leaves the row where a finger scrolled it, as the classic look does: tidied
   at every draw, the row sprang back to the picked chip under a finger reaching for a folder further along, and the tap
   landed on another chip (round 4, found by tests/test_wefty_notes_head.py under this look). */
function tidyChips() {
  if (!chips || wide() || !chips.offsetParent || chips.offsetParent === document.body) return;
  const on = chips.querySelector(':scope > .chip.on');
  if (!on || getComputedStyle(chips).position !== 'relative') return;
  const key = on.dataset.id || on.textContent;
  if (key === tidiedFor) return;
  tidiedFor = key;
  const at = chips.scrollLeft;
  const cut = [...chips.children].some((c) => c.offsetLeft < at && c.offsetLeft + c.offsetWidth > at + 1);
  if (!cut) return;
  const pad = parseFloat(getComputedStyle(chips).paddingLeft) || 16;
  const before = on.previousElementSibling && on.previousElementSibling.matches('.chip') ? on.previousElementSibling : null;
  const fits = before && on.offsetLeft + on.offsetWidth - before.offsetLeft <= chips.clientWidth - 2 * pad;
  const target = fits ? before : on;
  chips.scrollLeft = Math.max(0, target.offsetLeft - pad);
}

/* -- binding to the screen */

function decorate(l) {
  layout = l;
  column = l.querySelector('.list-column');
  list = l.querySelector('.list');
  chips = l.querySelector('.list-column > .chips');
  rail = l.querySelector('.folders');
  lastFilter = filterOf();
  if (listWatch) listWatch.disconnect();
  listWatch = new MutationObserver((mutations) => {
    if (!on()) return;
    // (the list's own rows drawn again; the colour behind a swiped card coming and going isn't that)
    const mine = (node) => node.nodeType === 1 && node.classList.contains('gn-reveal');
    if (mutations.some((m) => m.type === 'childList' && m.target === list
      && [...m.addedNodes, ...m.removedNodes].some((node) => !mine(node)))) listDrawn();
    picked(mutations);
    const picking = list.classList.contains('picking');
    if (!!pullHandle === picking && !wide()) bindPull();
  });
  listWatch.observe(list, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'], attributeOldValue: true });
  if (barsWatch) barsWatch.disconnect();
  barsWatch = new MutationObserver((mutations) => {
    if (!on()) return;
    if (mutations.some((m) => m.target === chips)) { tidyChips(); placeSlide(chips, ':scope > .chip.on', true); }
    if (mutations.some((m) => m.target === rail)) placeSlide(rail, '.nav-item.on', true);
  });
  if (chips) barsWatch.observe(chips, { childList: true });
  if (rail) barsWatch.observe(rail, { childList: true });
  if (column) for (const [type, fn, opts] of HANDLERS) column.addEventListener(type, fn, opts);
  placeSlides(false);
  bindPull();
  watchSearch();
}
function undecorate() {
  unwatchSearch();
  if (column) for (const [type, fn, opts] of HANDLERS) column.removeEventListener(type, fn, opts);
  if (listWatch) { listWatch.disconnect(); listWatch = null; }
  if (barsWatch) { barsWatch.disconnect(); barsWatch = null; }
  unbindPull();
  for (const box of [chips, rail]) {
    if (!box) continue;
    box.classList.remove('gn-slid');
    const slide = box.querySelector(':scope > .gn-slide');
    if (slide) slide.remove();
    slides.delete(box);
  }
  if (list) {
    list.querySelectorAll(':scope > .gn-reveal').forEach((el) => el.remove());
    list.classList.remove('gn-has-reveal');
    list.querySelectorAll('.gn-swiping').forEach((el) => { el.classList.remove('gn-swiping'); el.style.transform = ''; el.style.transition = ''; el.style.opacity = ''; });
  }
  document.querySelectorAll('.g-grow-shell').forEach((el) => el.remove());
  if (sw && V.notes && V.notes.holdDraws) V.notes.holdDraws(false);
  sw = null;
  layout = column = list = chips = rail = null;
  flipPlan = null;
  lastFilter = null;
}
function refresh() {
  if (!on() || !view || !view.isConnected || view.dataset.tab !== 'notes') return;
  const l = view.querySelector(':scope > .notes-layout');
  if (!l) return;
  if (l === layout) return;
  undecorate();
  decorate(l);
  // (round 4: the rows rise in only when Notes is the app's first screen; arriving from another tab it's there in its place,
  // the New note button too)
  if (opened) {
    opened = 0;
    if (!(V.motion && V.motion.switched && V.motion.switched())) entrance(l);
    else view.querySelectorAll(':scope > .fab').forEach((fab) => fab.getAnimations().forEach((a) => { try { a.finish(); } catch (error) { /* fine */ } }));
  }
}
function bind() {
  if (viewWatch && view && view.isConnected) return;
  view = document.querySelector('main.view');
  if (!view) return;
  if (viewWatch) viewWatch.disconnect();
  viewWatch = new MutationObserver(() => refresh());
  viewWatch.observe(view, { childList: true });
  const layers = document.getElementById('layers');
  if (layers && !layersWatch) {
    layersWatch = new MutationObserver(layersChanged);
    layersWatch.observe(layers, { childList: true, attributes: true, attributeFilter: ['class'], attributeOldValue: true, subtree: true });
  }
}
function stop() {
  if (viewWatch) { viewWatch.disconnect(); viewWatch = null; }
  if (layersWatch) { layersWatch.disconnect(); layersWatch = null; }
  undecorate();
  for (const id of timers) clearTimeout(id);
  timers.clear();
  view = null;
  opened = 0; openStart = 0; tapped = null; grown = null;
}

V.on('tab', (name) => {
  if (!on()) return;
  bind();
  if (name === 'notes') {
    opened = now();
    if (layout && !layout.isConnected) undecorate();
    refresh();
  } else if (layout) undecorate();
});
V.on('look', () => {
  if (on()) {
    bind();
    if (view && view.dataset.tab === 'notes') { opened = now(); refresh(); }
  } else stop();
});
// An Undo on a toast (a note put back, unpinned...): the cards make room for what comes back.
document.addEventListener('click', (event) => {
  if (!on() || !list || !list.isConnected) return;
  const target = event.target && event.target.closest ? event.target : null;
  if (!target) return;
  if (target.closest('#toasts .toast-action, .pick-bar .pick-action, .menu-item')) expectChange();
  else if (target.closest('.list-fold')) foldTapped(event);
  else cardTapped(event);
}, true);
window.addEventListener('resize', V.debounce ? V.debounce(() => { if (on() && layout) { placeSlides(false); setPullTop(); } }, 150) : () => {});
if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { if (on() && layout) placeSlides(false); }, () => {});
if (on()) bind();

V.glassNotes = {
  /* For tests: what's going on now. */
  state: () => ({ decorated: !!layout, swiping: !!(sw && sw.mode === 'swipe'), pull: !!pullHandle, grown: grown ? grown.id : null }),
};
})();
