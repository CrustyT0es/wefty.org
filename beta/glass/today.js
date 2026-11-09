/* Wefty 2.0 "glass", area: Today. This file belongs to the Today builder; nobody else edits it.
   Today's screen (js/today.js): the week strip, Quick actions, the picked day's rows and ticking them, Tests coming up, Flash cards, Jump back in, the pull to sync and the large title that shrinks.
   Rules (vault/web/glass/README.txt has the rest): everything here is inert unless V.look.isGlass() (and listen to V.on('look') so the switch works live); use the tokens in
   glass.css (--g-*, and the app's own names, which glass redefines); only transform and opacity animate; call
   V.motion's helpers instead of writing your own; nothing here changes the classic look.

   What this file does, and why it is built this way.
   js/today.js draws Today's whole page again at every change (a sync, a tick, a new note), and only the picked day's panel
   on its own when another day is picked. So no CSS transition can run on a part that was drawn a moment ago, and an
   animation started on a part is gone with the next draw. This file therefore:
     - watches the screen (one MutationObserver) and DECORATES each new page: the thread under the greeting, the week's
       sliding highlight, a fill for each box, a strike for each done title, a ring and a thread for each test, the slim
       bar the title folds into, the pull to sync;
     - plays the MOMENTS with V.motion at the moment they happen: the entrance (only when Today is opened, never again for
       a data refresh: a draw that lands in the first 1.4 s carries the entrance on from where it was, so nothing
       restarts), a day picked (its card rises again), a to-do ticked or unticked (it is shown at once on the row that was
       tapped, and the draw that follows plays the same moment on from where it had got to), the rows that move when one
       is done (they slide, a moment later), the last to-do of the day (a glow on the thread and an `edge` event).
   Nothing here is in classic: with the look off, Today is drawn again and every part made here is gone. */
'use strict';

(() => {
const V = window.V;
if (!V || !V.look) return;
const root = document.documentElement;
const SVG = 'http://www.w3.org/2000/svg';
const EASE = 'cubic-bezier(.2,.8,.2,1)';
const HAS_WAAPI = typeof Element !== 'undefined' && typeof Element.prototype.animate === 'function';
const ENTRANCE_MS = 1400;  // the first part of an opening, in which a redraw carries the entrance on

const on = () => !!V.look.isGlass();
const calm = () => root.classList.contains('calm');
const lite = () => root.classList.contains('lite');
const motion = () => V.motion || null;
const now = () => performance.now();
const full = () => !calm() && !lite();  // (the decoration: rolling numbers, sparks, glows; lite and calm have none)

let view = null;          // main.view, where Today is drawn
let observer = null;
let page = null;          // the page now decorated
let panelEl = null;       // the picked day's panel now decorated
let panelDay = '';
let panelRows = 0;
let rowsState = null;     // { day, map: tick key -> ticked, tops: tick key -> top in the panel }
let opened = 0;           // when Today was opened (js/start.js's 'tab'), until a real draw has used it
let openStart = 0;        // when the entrance now running began
let sawPlaceholder = false;
let finishedDay = '';     // the day whose last to-do was ticked here (its "All done" line stays while nothing is left on it)
let moment = null;        // the last change on the rows (a tick), carried on into the draws that follow it: { t0, day, changed, gone, from, justDone, mine }
let pending = null;       // a tick in flight: { key, to, t0, sparked, undo: [animations], timer }
let sliderDay = '';
let sliderFlip = 0;
let pullHandle = null;
let shrinkHandle = null;
let hold = null;          // the marker that keeps Today from being drawn while a pull is syncing
let numbers = {};         // the last value of each rolling number, by name
let lastDay = '';
const timers = new Set();
let ringId = 0;

const later = (fn, ms) => { const id = setTimeout(() => { timers.delete(id); fn(); }, ms); timers.add(id); return id; };
const edge = (kind) => { try { V.emit('edge', kind); } catch (error) { /* nobody is listening */ } };

/* -- small helpers */
function svg(tag, attrs = {}, cls = '') {
  const el = document.createElementNS(SVG, tag);
  for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, String(value));
  if (cls) el.setAttribute('class', cls);
  return el;
}
/* The board's thread: a wave across `width`, one period about `period` long, `y` the middle, `a` how far it swings. */
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
const lengthOf = (path) => { try { return Math.ceil(path.getTotalLength()) || 100; } catch (error) { return 100; } };
function animate(el, keyframes, options) {
  if (!el || !HAS_WAAPI || !el.isConnected) return null;
  try { return el.animate(keyframes, options); } catch (error) { return null; }
}
/* A path drawn from nothing to all of it, from `elapsed` ms in already. */
function drawPath(path, { duration = 500, delay = 0, elapsed = 0, reverse = false } = {}) {
  if (!path || calm()) return null;
  const length = lengthOf(path);
  path.style.strokeDasharray = String(length);
  const a = animate(path, reverse ? [{ strokeDashoffset: 0 }, { strokeDashoffset: length }] : [{ strokeDashoffset: length }, { strokeDashoffset: 0 }],
    { duration: lite() ? 160 : duration, delay: (lite() ? 0 : delay) - elapsed, easing: EASE, fill: 'both' });
  if (a) a.finished.then(() => { path.style.strokeDasharray = ''; if (reverse) path.style.strokeDashoffset = ''; }, () => {});
  return a;
}

/* -- the thread under the greeting */
function weftLine(p, elapsed, opening) {
  const line = p.querySelector(':scope > .today-line');
  if (!line) return;
  line.textContent = '';
  const w = Math.max(60, Math.round(line.getBoundingClientRect().width) || 358);
  const d = wavePath(w, 45, 6, 5);
  const main = svg('svg', { viewBox: `0 0 ${w} 12`, preserveAspectRatio: 'none', 'aria-hidden': 'true' }, 'g-hweft');
  main.appendChild(svg('path', { d }));
  const glow = svg('svg', { viewBox: `0 0 ${w} 12`, preserveAspectRatio: 'none', 'aria-hidden': 'true' }, 'g-hweft g-hglow');
  glow.appendChild(svg('path', { d }));
  line.append(main, glow);
  if (opening && elapsed >= 0 && motion()) motion().weft(main.firstChild, { duration: 1200, delay: 250 - elapsed });
}
function glowLine(elapsed = 0) {
  const glow = page && page.querySelector('.today-line .g-hglow');
  if (!glow || !full()) return;
  animate(glow, [{ opacity: 0 }, { opacity: 1, offset: 0.35 }, { opacity: 0 }], { duration: 1200, delay: 150 - elapsed, easing: EASE });
}

/* -- the week's days: today's label on one line (the 2.0 hotfix: "Today · Mon 9" broke onto two lines on the owner's phone,
   with its bigger text and a reminder's dot beside it). "Today" keeps its size and the date beside it is a step smaller;
   the label's words, and what a screen reader says, are the same. */
function dayLabels(p) {
  p.querySelectorAll('.today-week-days .wday .wd-label:not(.g-split)').forEach((label) => {
    const found = /^(\S+) · (.+)$/.exec(label.textContent || '');
    if (!found) return;
    const name = document.createElement('span');
    name.className = 'g-wd-name';
    name.textContent = found[1];
    const date = document.createElement('span');
    date.className = 'g-wd-date';
    date.textContent = ` · ${found[2]}`;
    label.textContent = '';
    label.append(name, date);
    label.classList.add('g-split');
  });
}

/* -- the week's sliding highlight */
function placeSlider(p, animateIt) {
  const strip = p.querySelector('.today-week-days');
  if (!strip) return;
  let slider = strip.querySelector(':scope > .g-slider');
  if (!slider) {
    slider = document.createElement('div');
    slider.className = 'g-slider';
    slider.setAttribute('aria-hidden', 'true');
    slider.appendChild(document.createElement('i'));
    strip.insertBefore(slider, strip.firstChild);
  }
  const cell = strip.querySelector('.wday[aria-selected="true"]');
  if (!cell || !cell.offsetWidth) { slider.hidden = true; return; }
  slider.hidden = false;
  slider.style.width = `${cell.offsetWidth}px`;
  slider.style.height = `${cell.offsetHeight}px`;
  const to = `translate3d(${cell.offsetLeft}px, ${cell.offsetTop}px, 0)`;
  const same = slider.style.transform === to;
  if (!animateIt || calm() || same) {
    slider.classList.add('g-still');
    slider.style.transform = to;
    void slider.offsetWidth;
    slider.classList.remove('g-still');
  } else {
    slider.style.transform = to;
    slider.classList.remove('g-sa', 'g-sb');
    void slider.offsetWidth;
    slider.classList.add(sliderFlip++ % 2 ? 'g-sa' : 'g-sb');
  }
  sliderDay = cell.dataset.day || '';
}

/* -- numbers that roll */
function wrapNumber(el) {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const text = walker.currentNode;
    const found = /\d+/.exec(text.nodeValue);
    if (!found) continue;
    const before = text.nodeValue.slice(0, found.index);
    const after = text.nodeValue.slice(found.index + found[0].length);
    const span = document.createElement('span');
    span.className = 'g-num';
    span.textContent = found[0];
    const parent = text.parentNode;
    if (before) parent.insertBefore(document.createTextNode(before), text);
    parent.insertBefore(span, text);
    if (after) text.nodeValue = after; else text.remove();
    return span;
  }
  return null;
}
function rollNumbers(p, opening) {
  const spots = [];
  const add = (el, name, wrap) => {
    if (!el) return;
    const target = wrap ? wrapNumber(el) : (/^\d+$/.test(el.textContent.trim()) ? el : null);
    if (target) spots.push([target, name]);
  };
  const day = (p.querySelector('.today-sec[data-section=day]') || {}).dataset;
  add(p.querySelector('.tile-count'), 'badge', false);
  add(p.querySelector('.fc-n b'), 'cards', false);
  add(p.querySelector('.dg-meta > span:first-child'), `todo:${day ? day.day : ''}`, true);
  p.querySelectorAll('.today-test').forEach((card, i) => {
    add(card.querySelector('.today-days b'), `days:${i}`, false);
    add(card.querySelector('.test-nums b'), `known:${i}`, true);
  });
  p.querySelectorAll('.today-count').forEach((el) => add(el.querySelector('span'), (el.dataset.key || 'count'), true));
  const m = motion();
  for (const [el, name] of spots) {
    const value = Number(el.textContent);
    const was = numbers[name];
    numbers[name] = value;
    if (!m || !full()) continue;
    if (opening) m.roll(el, 0, value);
    else if (was !== undefined && was !== value) m.roll(el, was, value, { duration: 320 });
  }
}

/* -- a test: its ring and its thread */
function testCards(p, elapsed, opening) {
  p.querySelectorAll('.today-test').forEach((card) => {
    const bar = card.querySelector('.today-bar');
    const label = bar ? bar.getAttribute('aria-label') || '' : '';
    const found = /(\d+)\s+of\s+(\d+)/.exec(label);
    const frac = found && Number(found[2]) ? Math.min(1, Number(found[1]) / Number(found[2])) : 0;
    const days = card.querySelector('.today-days');
    if (days && !days.querySelector('.g-ring')) {
      const id = `g-ring-${++ringId}`;
      const ring = svg('svg', { viewBox: '0 0 64 64', 'aria-hidden': 'true' }, 'g-ring');
      const defs = svg('defs');
      const grad = svg('linearGradient', { id, x1: 0, y1: 0, x2: 1, y2: 1 });
      grad.append(svg('stop', { offset: 0 }, 'g-ring-stop-a'), svg('stop', { offset: 1 }, 'g-ring-stop-b'));
      defs.appendChild(grad);
      const track = svg('circle', { cx: 32, cy: 32, r: 26 }, 'g-ring-bg');
      const fg = svg('circle', { cx: 32, cy: 32, r: 26 }, 'g-ring-fg');
      fg.style.stroke = `url(#${id})`;
      fg.style.transition = 'none';
      fg.style.strokeDasharray = '163.4';
      const target = 163.4 * (1 - frac);
      fg.style.strokeDashoffset = target.toFixed(1);
      if (!frac) fg.style.opacity = '0';
      ring.append(defs, track, fg);
      days.insertBefore(ring, days.firstChild);
      if (opening && frac && !calm()) animate(fg, [{ strokeDashoffset: 163.4 }, { strokeDashoffset: target }], { duration: lite() ? 200 : 1200, delay: (lite() ? 0 : 350) - elapsed, easing: EASE, fill: 'backwards' });
    }
    if (bar && !bar.querySelector('.g-thread')) {
      const w = Math.round(bar.getBoundingClientRect().width);
      if (w > 20) {
        const d = wavePath(w, 40, 6, 5);
        const thread = svg('svg', { viewBox: `0 0 ${w} 12`, preserveAspectRatio: 'none', 'aria-hidden': 'true' }, 'g-thread');
        const track = svg('path', { d }, 'g-track');
        const fill = svg('path', { d }, 'g-fill-line');
        thread.append(track, fill);
        bar.appendChild(thread);
        const length = lengthOf(fill);
        const target = length * (1 - frac);
        fill.style.transition = 'none';
        fill.style.strokeDasharray = String(length);
        fill.style.strokeDashoffset = target.toFixed(1);
        if (!frac) fill.style.opacity = '0';
        if (opening && frac && !calm()) animate(fill, [{ strokeDashoffset: length }, { strokeDashoffset: target }], { duration: lite() ? 200 : 1100, delay: (lite() ? 0 : 400) - elapsed, easing: EASE, fill: 'backwards' });
      }
    }
    if (opening && full()) {
      card.classList.add('sweeping');
      requestAnimationFrame(() => requestAnimationFrame(() => card.classList.add('go')));
      later(() => card.classList.remove('sweeping', 'go'), 1500);
    }
  });
}

/* -- the rows of the picked day */
function strikeLines(strong, elapsed, animateIt) {
  strong.querySelectorAll(':scope > .g-strike').forEach((el) => el.remove());
  const box = strong.getBoundingClientRect();
  if (!box.width) return [];
  const made = [];
  const walker = document.createTreeWalker(strong, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const text = walker.currentNode;
    if (!text.nodeValue.trim() || (text.parentElement && text.parentElement.closest('.sr-only'))) continue;
    const range = document.createRange();
    range.selectNodeContents(text);
    for (const r of range.getClientRects()) {
      const width = Math.min(r.right, box.right) - Math.max(r.left, box.left);
      if (width < 6) continue;
      const w = Math.round(width + 4);
      const el = svg('svg', { viewBox: `0 0 ${w} 8`, preserveAspectRatio: 'none', 'aria-hidden': 'true' }, 'g-strike');
      el.style.left = `${Math.round(Math.max(r.left, box.left) - box.left - 2)}px`;
      el.style.top = `${Math.round(r.top - box.top + r.height / 2 - 4)}px`;
      el.style.width = `${w}px`;
      const path = svg('path', { d: wavePath(w, 22, 4, 2.5) });
      el.appendChild(path);
      strong.appendChild(el);
      made.push(path);
    }
  }
  if (made.length) strong.closest('li').classList.add('g-struck');
  if (animateIt) made.forEach((path) => drawPath(path, { duration: 500, delay: 40, elapsed }));
  return made;
}
function clearStrike(li) {
  li.querySelectorAll('.g-strike').forEach((el) => el.remove());
  li.classList.remove('g-struck');
}
function fillTicks(panel) {
  panel.querySelectorAll('.today-tick').forEach((tick) => {
    if (tick.querySelector('.g-fill')) return;
    const fill = document.createElement('i');
    fill.className = 'g-fill';
    fill.setAttribute('aria-hidden', 'true');
    tick.insertBefore(fill, tick.firstChild);
  });
}
function strikeDone(panel) {
  panel.querySelectorAll('li.today-row.done').forEach((li) => {
    const strong = li.querySelector('.today-row-text strong');
    if (strong && !strong.querySelector('.g-strike')) strikeLines(strong, 0, false);
  });
}

/* The sparks fly from a box that is about to be redrawn, so they are made on a small fixed host that stays. */
function sparks(tick) {
  const m = motion();
  if (!m || !full()) return;
  const r = tick.getBoundingClientRect();
  const host = document.createElement('div');
  host.className = 'g-spark-host';
  host.setAttribute('aria-hidden', 'true');
  host.style.left = `${r.left + r.width / 2 - 22}px`;
  host.style.top = `${r.top + r.height / 2 - 22}px`;
  document.body.appendChild(host);
  const flight = m.spark(host);
  const gone = () => host.remove();
  if (flight && flight.finished) flight.finished.then(gone, gone); else gone();
  later(gone, 900);
}

/* A to-do ticked (done) or unticked, on row `li`, `elapsed` ms after it began (the redraw comes a moment later: the same
   moment then goes on from where it had got to). Returns what it started, so an unconfirmed one can be taken back. */
function playTick(li, done, elapsed, first) {
  const out = [];
  if (!li || calm()) return out;
  const tick = li.querySelector('.today-tick');
  const fill = tick && tick.querySelector('.g-fill');
  const path = tick && tick.querySelector('.icon svg path');
  const strong = li.querySelector('.today-row-text strong');
  const keep = first ? 'forwards' : 'both';
  const push = (a) => { if (a) out.push(a); };
  const quickly = lite();
  if (done) {
    push(animate(fill, [{ opacity: 0 }, { opacity: 1 }], { duration: 250, delay: -elapsed, easing: EASE, fill: keep }));
    if (path) { path.style.strokeDasharray = '40'; push(animate(path, [{ strokeDashoffset: 40 }, { strokeDashoffset: 0 }], { duration: quickly ? 160 : 300, delay: (quickly ? 0 : 60) - elapsed, easing: EASE, fill: keep })); }
    if (first && motion()) motion().press(tick, { scale: 0.8 });
    if (strong) {
      const made = first ? strikeLines(strong, elapsed, true) : [...strong.querySelectorAll('.g-strike path')];
      if (!first) made.forEach((p) => push(drawPath(p, { duration: 500, delay: 40, elapsed })));
      else made.forEach((p) => { p.style.strokeDashoffset = ''; });
    }
  } else {
    push(animate(fill, [{ opacity: 1 }, { opacity: 0 }], { duration: 200, delay: -elapsed, easing: EASE, fill: keep }));
    if (path) { path.style.strokeDasharray = '40'; push(animate(path, [{ strokeDashoffset: 0 }, { strokeDashoffset: 40 }], { duration: 180, delay: -elapsed, easing: EASE, fill: keep })); }
    if (motion() && first) motion().press(tick, { scale: 0.86 });
  }
  return out;
}

/* ---- the 2.0 hotfix (the owner's first look: two rows drawn on top of each other at the top of the day). The rows' moves have
   one plan, and no two rows ever cross: (1) the tick is seen where it was tapped; (2) a row that is moving to another place
   (ticked, unticked) fades out where it was, and a row that has gone (the last box of its note) fades out as a copy where it
   was; (3) then the rows that make room slide, all together, with no overshoot, and what is under the list slides with
   them; (4) last, the moved row fades in at its new place (so does a row that came back: an Undo, another device), once the
   rows have left it. Before, a row going down melted and formed again while the others slid through it, and a later tick
   played an earlier row's leaving again (the copy came back over the row now in its place, for as long as ticks kept
   coming). A draw that comes while the plan plays (a sync) plays it on from where it had got to; a new change after the
   first fades has begun starts a new plan from the rows' natural places. Calm: none of it, the rows are simply where they are. */
const ROW_FULL = { out: 300, outMs: 160, slide: 460, slideMs: 420, in: 760, inMs: 240 };
const ROW_LITE = { out: 140, outMs: 100, slide: 240, slideMs: 220, in: 380, inMs: 140 };
const SETTLE = 'cubic-bezier(.22,1,.36,1)';  // (the rows' slide: no overshoot, so a row never swings into its neighbour)
const rowPlan = () => (lite() ? ROW_LITE : ROW_FULL);
const ROW_SELECTOR = '.dp-list > li.today-row:not(.g-ghost-row)';
/* (the page's own px per screen px: with the page zoomed, bigger text, a box is measured in the screen's px, and moved in its own) */
const zoomOf = (el) => (el && el.offsetWidth ? el.getBoundingClientRect().width / el.offsetWidth || 1 : 1);

function readRows(panel) {
  const map = new Map();
  const tops = new Map();
  const lis = new Map();  // (the rows themselves and their heights, so a row gone after a draw can still leave smoothly)
  const heights = new Map();
  const base = panel.getBoundingClientRect().top;
  const z = zoomOf(panel);
  panel.querySelectorAll(ROW_SELECTOR).forEach((li) => {
    const tick = li.querySelector('.today-tick');
    if (!tick) return;
    const r = li.getBoundingClientRect();
    map.set(tick.dataset.key, tick.getAttribute('aria-pressed') === 'true');
    tops.set(tick.dataset.key, (r.top - base) / z);
    lis.set(tick.dataset.key, li);
    heights.set(tick.dataset.key, r.height / z);
  });
  const list = panel.querySelector('.dp-list') || panel.querySelector('.dp-none');
  const listBottom = list ? (list.getBoundingClientRect().bottom - base) / z : 0;
  return { day: panel.dataset.day || '', map, tops, lis, heights, listBottom };
}

/* The plan played on `panel`'s rows, `elapsed` ms after the moment `m` began (m.from: the rows as they were before it). */
function moveRows(panel, m, elapsed) {
  if (!HAS_WAAPI || calm()) return;
  const P = rowPlan();
  const base = panel.getBoundingClientRect().top;
  const z = zoomOf(panel);
  const from = m.from;
  const moved = new Set(m.changed.map(([key]) => key));
  const here = new Set();
  panel.querySelectorAll(ROW_SELECTOR).forEach((li) => {
    const tick = li.querySelector('.today-tick');
    if (!tick) return;
    const key = tick.dataset.key;
    here.add(key);
    if (!from.tops.has(key)) {  // (came: it waits, then fades in once the others have made room)
      animate(li, [{ opacity: 0 }, { opacity: 1 }], { duration: P.inMs, delay: P.in - elapsed, easing: EASE, fill: 'backwards' });
      return;
    }
    const delta = from.tops.get(key) - (li.getBoundingClientRect().top - base) / z;
    if (Math.abs(delta) < 2 || Math.abs(delta) > 2000) return;
    if (moved.has(key)) {
      // (moving to another place: out where it was, hidden while the others slide, in where it now is)
      const span = P.in + P.inMs - P.out;
      const there = `translateY(${Math.round(delta)}px)`;
      const gone = P.outMs / span;
      animate(li, [
        { transform: there, opacity: 1, offset: 0, easing: EASE },
        { transform: there, opacity: 0, offset: gone },
        { transform: 'none', opacity: 0, offset: Math.min(1, gone + 0.0005) },
        { transform: 'none', opacity: 0, offset: (P.in - P.out) / span, easing: EASE },
        { transform: 'none', opacity: 1, offset: 1 },
      ], { duration: span, delay: P.out - elapsed, easing: 'linear', fill: 'backwards' });
    } else {
      animate(li, [{ transform: `translateY(${Math.round(delta)}px)` }, { transform: 'none' }],
        { duration: P.slideMs, delay: P.slide - elapsed, easing: SETTLE, fill: 'backwards' });
    }
  });
  const list = panel.querySelector('.dp-list') || panel.querySelector('.dp-none');
  if (!list) return;
  // A row that has gone: a copy where it was fades out (only while that is still to come: never once it has faded).
  if (elapsed < P.out + P.outMs) {
    const listTop = (list.getBoundingClientRect().top - base) / z;
    for (const [key, old] of from.lis) {
      if (here.has(key) || !m.gone.includes(key) || !old) continue;
      const ghost = old.cloneNode(true);
      ghost.classList.add('g-ghost-row');
      ghost.setAttribute('aria-hidden', 'true');
      ghost.inert = true;
      const tick = ghost.querySelector('.today-tick');
      if (tick) tick.setAttribute('aria-pressed', 'true');
      Object.assign(ghost.style, { position: 'absolute', left: '0', right: '0', top: `${(from.tops.get(key) || 0) - listTop}px`, pointerEvents: 'none', margin: '0', zIndex: '1' });
      if (getComputedStyle(list).position === 'static') list.style.position = 'relative';
      list.appendChild(ghost);
      playTick(ghost, true, elapsed, false);
      const fade = animate(ghost, [{ opacity: 1 }, { opacity: 0 }], { duration: P.outMs, delay: P.out - elapsed, easing: EASE, fill: 'forwards' });
      const remove = () => ghost.remove();
      if (fade) fade.finished.then(remove, remove); else remove();
      later(remove, P.out + P.outMs + 200 - elapsed);
    }
  }
  // What is under the list moves with the rows: from where it was (the list is longer or shorter now).
  const shift = from.listBottom - (list.getBoundingClientRect().bottom - base) / z;
  if (Math.abs(shift) < 2 || Math.abs(shift) > 2000) return;
  const after = [];
  for (let el = list.nextElementSibling; el; el = el.nextElementSibling) after.push(el);
  for (let el = panel.nextElementSibling; el; el = el.nextElementSibling) after.push(el);
  after.filter((el) => el.getClientRects().length && !el.classList.contains('alldone-line')).slice(0, 12).forEach((el) => {
    animate(el, [{ transform: `translateY(${Math.round(shift)}px)` }, { transform: 'none' }],
      { duration: P.slideMs, delay: P.slide - elapsed, easing: SETTLE, fill: 'backwards' });
  });
}
/* ---- end of the 2.0 hotfix block */
const openLeft = (state) => [...state.map.values()].filter((done) => !done).length;

/* "All done for today": under the list, with the thread, once nothing is left on today's list. */
function allDone(panel, state, animateIt, elapsed = 0) {
  panel.querySelectorAll('.alldone-line').forEach((el) => el.remove());
  if (!panel.classList.contains('is-today') || openLeft(state)) return;
  // (a list with every row done, or one that has emptied because the last to-do of its note was ticked: then it was this page that did it)
  if (!state.map.size && finishedDay !== state.day) return;
  const list = panel.querySelector('.dp-list') || panel.querySelector('.dp-none');
  if (!list) return;
  const line = document.createElement('p');
  line.className = 'alldone-line';
  const mark = svg('svg', { viewBox: '0 0 30 6', 'aria-hidden': 'true', width: 30, height: 6 });
  mark.style.flex = 'none';
  mark.style.overflow = 'visible';
  const path = svg('path', { d: 'M1 3 C 4 0.5, 7 5.5, 10.5 3 S 17 0.5, 20 3 S 26 5.5, 29 3' });
  path.setAttribute('style', 'fill:none;stroke-linecap:round;stroke-width:1.8;stroke:var(--accent)');
  mark.appendChild(path);
  line.append(mark, document.createTextNode('All done for today. Nice work.'));
  list.after(line);
  if (animateIt && !calm()) animate(line, [{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'none' }], { duration: lite() ? 180 : 600, delay: (lite() ? 0 : 450) - elapsed, easing: EASE, fill: 'backwards' });
}

/* A panel (drawn with the page, or drawn again on its own when a day is picked): decorated; `mode` says what is playing.
   A to-do ticked or unticked (here, from its menu, from an Undo, or from another device) is a MOMENT: its tick, its strike,
   the rows that move, the glow of the last one. The draw that shows it plays it from the start; the draws that follow it
   (a sync lands 300 ms later and draws the page again) play it on from where it had got to, so nothing is cut short. */
function decoratePanel(panel, mode = {}) {
  if (!panel) return;
  fillTicks(panel);
  const state = readRows(panel);
  strikeDone(panel);
  const before = rowsState;
  let first = false;
  let fresh = [];  // (the keys changed in this draw: only they spark, when the change came from elsewhere)
  let doneNow = false;  // (the last to-do of the day ticked in this draw: the edge light blooms once)
  if (before && before.day === state.day && !mode.opening && !mode.picked) {
    const changed = [...state.map].filter(([key, done]) => before.map.has(key) && before.map.get(key) !== done);
    // (a to-do that was the last box of its note takes the note off today's list: it was ticked, and it has gone)
    // (round-2 fix: also a row already shown ticked, whose note went a moment later: the same tick, going)
    const gone = [...before.map].filter(([key, done]) => !state.map.has(key)
      && (!done || (pending && pending.key === key) || (moment && moment.changed.some(([k]) => k === key)))).map(([key]) => key);
    const came = [...state.map.keys()].filter((key) => !before.map.has(key));  // (an Undo, another device)
    if (changed.length || gone.length || came.length) {
      const mine = !!pending && (changed.some(([key, done]) => pending.key === key && pending.to === done) || (pending.to && gone.includes(pending.key)));
      const ticked = changed.some(([, done]) => done) || gone.length > 0;
      const justDone = panel.classList.contains('is-today') && !openLeft(state) && openLeft(before) > 0 && ticked;
      if (mine) clearTimeout(pending.timer);
      const t = mine ? pending.t0 : now();
      // (2.0 hotfix) The moment playing goes on with this change in it when it is the same tick going on (the row ticked a
      // moment ago, whose note has now gone) or when nothing of it has moved yet: one plan, from the rows as they were.
      // Otherwise this change is a new moment, from the rows' natural places: never an earlier moment's leaving again.
      const live = moment && moment.day === state.day ? moment : null;
      const going = !!live && gone.length > 0 && gone.every((key) => live.changed.some(([k]) => k === key));
      const joins = !!live && (going || now() - live.t0 < rowPlan().out);
      if (joins) {
        const merged = new Map(live.changed);
        for (const [key, done] of changed) merged.set(key, done);
        moment = { ...live, t0: going ? live.t0 : Math.max(live.t0, t), changed: [...merged].filter(([key]) => state.map.has(key)),
          gone: [...new Set([...live.gone, ...gone])], justDone: live.justDone || justDone, mine: live.mine || mine };
      } else {
        moment = { t0: t, day: state.day, changed, gone, from: before, justDone, mine };
      }
      fresh = changed.map(([key]) => key);
      doneNow = justDone && !(joins && live.justDone);
      if (mine) pending = null;
      first = true;
    }
  }
  if (moment && (moment.day !== state.day || mode.opening || mode.picked || now() - moment.t0 > 1300)) moment = null;
  if (moment) {
    const elapsed = Math.max(0, now() - moment.t0);
    const ticks = [...panel.querySelectorAll(`${ROW_SELECTOR} .today-tick`)];
    for (const [key, done] of moment.changed) {
      const tick = ticks.find((t) => t.dataset.key === key);
      if (!tick) continue;
      if (first && done && !moment.mine && fresh.includes(key)) { sparks(tick); if (motion() && full()) motion().press(tick, { scale: 0.8 }); }
      playTick(tick.closest('li'), done, elapsed, false);
    }
    moveRows(panel, moment, elapsed);
    if (moment.justDone) finishedDay = state.day;
    allDone(panel, state, moment.justDone, elapsed);
    if (moment.justDone) { if (first && doneNow) edge('done'); glowLine(elapsed); }
  } else {
    allDone(panel, state, false);
  }
  if (openLeft(state) > 0 || (finishedDay && finishedDay !== state.day)) finishedDay = '';
  rowsState = state;
  panelEl = panel;
  panelDay = state.day;
  panelRows = panel.querySelectorAll('.dp-list > li').length;
}

/* The day panel drawn again on its own: another day picked (it rises again) or Show all (the rows that came rise). */
function panelChanged() {
  const next = page && page.querySelector('.today-sec[data-section=day]');
  if (next === panelEl) return;
  const day = next ? next.dataset.day || '' : '';
  const was = { day: panelDay, rows: panelRows };
  if (!next) { panelEl = null; panelDay = ''; panelRows = 0; rowsState = null; return; }
  const picked = day !== was.day;
  decoratePanel(next, { picked });
  if (calm()) return;
  if (picked) {
    // (it rises without a change of size: a button never measures smaller than 44 px while it comes)
    [...next.querySelectorAll('.dp-head, .dp-list, .dp-none, .dp-foot, .dp-written')].forEach((el, i) => {
      animate(el, [{ opacity: 0, transform: 'translateY(10px)' }, { opacity: 1, transform: 'none' }],
        { duration: lite() ? 160 : 460, delay: lite() ? 0 : Math.min(i, 5) * 50, easing: EASE, fill: 'backwards' });
    });
  } else if (panelRows > was.rows) {  // (Show all: the rows that came rise, one after the other)
    [...next.querySelectorAll('.dp-list > li')].slice(was.rows).forEach((el, i) => {
      animate(el, [{ opacity: 0, transform: 'translateY(10px)' }, { opacity: 1, transform: 'none' }],
        { duration: lite() ? 160 : 400, delay: lite() ? 0 : Math.min(i, 5) * 40, easing: EASE, fill: 'backwards' });
    });
  }
}

/* -- the slim bar the greeting folds into (a phone), and the pull to sync */
function topBar(p) {
  if (shrinkHandle) { shrinkHandle.destroy(); shrinkHandle = null; }
  if (V.wide && V.wide()) return;
  const hello = p.querySelector('.today-hello');
  const m = motion();
  if (!hello || !m) return;
  const wrap = document.createElement('div');
  wrap.className = 'g-tbar-wrap';
  const bar = document.createElement('button');
  bar.type = 'button';
  bar.className = 'g-tbar g-bar';
  bar.tabIndex = -1;
  bar.setAttribute('aria-label', 'Back to the top');
  const mark = V.mark ? V.mark(26, 'g-tbar-mark', { colour: true }) : null;
  const name = document.createElement('span');
  name.className = 'g-tbar-t';
  name.textContent = 'Today';
  const date = document.createElement('span');
  date.className = 'g-tbar-d';
  const dateText = p.querySelector('.today-date');
  date.textContent = dateText ? dateText.textContent.replace(/^[A-Za-z]+, /, (day) => day.slice(0, 3) + ', ') : '';
  if (mark) bar.append(mark);
  bar.append(name, date);
  bar.addEventListener('click', () => { if (view) view.scrollTo({ top: 0, behavior: calm() ? 'auto' : 'smooth' }); });
  wrap.appendChild(bar);
  // (beside the page, not in it: the page's own children are the same in every look)
  view.insertBefore(wrap, p);
  shrinkHandle = m.shrink(view, hello, { bar });
}
function pullToSync(p) {
  if (pullHandle) { pullHandle.destroy(); pullHandle = null; }
  const m = motion();
  if (!m || !view || (V.wide && V.wide())) return;  // (a pull is for a finger: a wide screen has none)
  pullHandle = m.pull(view, {
    wrap: p,
    onRelease: () => {
      // (Today isn't drawn again while the pull is open: its thread is where the finger left it)
      if (!hold) {
        hold = document.createElement('span');
        hold.className = 'sr-only';
        hold.setAttribute('aria-expanded', 'true');
        view.appendChild(hold);
      }
      const done = () => {
        later(() => { if (hold) { hold.remove(); hold = null; } }, 1400);
      };
      let result = null;
      try { result = V.cloud && V.cloud.sync ? V.cloud.sync() : null; } catch (error) { result = null; }
      const finish = Promise.resolve(result).catch(() => {});
      finish.then(done);
      return finish;
    },
  });
}

/* -- a new page */
function drawn(p) {
  const placeholder = !!p.querySelector('.today-getting');
  const real = !!opened && !placeholder;
  const settled = sawPlaceholder && !placeholder;
  if (placeholder) sawPlaceholder = true;
  const opening = real || settled;
  if (!placeholder) { opened = 0; sawPlaceholder = false; }
  const continuing = !opening && !placeholder && openStart && now() - openStart < ENTRANCE_MS;
  if (opening) openStart = now();
  const elapsed = opening ? 0 : continuing ? now() - openStart : -1;
  const animating = elapsed >= 0;
  page = p;
  panelEl = null;
  const day = (p.querySelector('.today-sec[data-section=day]') || {}).dataset;
  const today = day ? day.day : '';
  if (animating) { p.classList.add('g-opening'); later(() => p.classList.remove('g-opening'), Math.max(0, ENTRANCE_MS - elapsed)); }

  weftLine(p, elapsed, animating);
  dayLabels(p);
  placeSlider(p, false);
  testCards(p, Math.max(0, elapsed), animating);
  rollNumbers(p, opening);
  topBar(p);
  pullToSync(p);
  const panel = p.querySelector('.today-sec[data-section=day]');
  // (the same day, drawn again: what was ticked or unticked since plays; another day or an opening: nothing does)
  decoratePanel(panel, { opening: animating || (day && lastDay !== day.day && !!lastDay) });
  lastDay = today || lastDay;
  if (animating && !calm()) {  // (calm: nothing is made to wait, the page is simply there)
    // The board's rise (12 px and a fade, .5 s, 45 ms apart, the first 8 only), without its tiny change of size: a button
    // measures 44 px the whole time it comes, and a part that is looked at while it comes is still the size it is.
    const parts = p.querySelectorAll(':scope > header, :scope > .today-greet, :scope > .today-week, :scope > .today-welcome, :scope > .today-sec, :scope > .today-getting, .today-col > .today-sec, .today-col > .today-trouble');
    parts.forEach((el, i) => {
      const wait = Math.min(i, 7) * 45;
      animate(el, [{ opacity: 0, transform: 'translateY(12px)' }, { opacity: 1, transform: 'none' }],
        { duration: lite() ? 180 : 500, delay: (lite() ? Math.min(wait, 90) : wait) - elapsed, easing: EASE, fill: 'backwards' });
    });
  }
}

function refresh() {
  if (!on() || !view || !view.isConnected || view.dataset.tab !== 'today') return;
  const p = view.querySelector(':scope > .page.today');
  if (!p) return;
  if (p !== page) { drawn(p); return; }
  const cell = p.querySelector('.today-week-days .wday[aria-selected="true"]');
  if (cell && (cell.dataset.day || '') !== sliderDay) placeSlider(p, true);
  panelChanged();
}

/* -- ticks tapped: shown at once on the row, before the draw that follows */
function onTap(event) {
  if (!on() || !page || !page.isConnected || event.defaultPrevented) return;
  const tick = event.target && event.target.closest ? event.target.closest('.today-tick') : null;
  if (!tick || !page.contains(tick) || !tick.dataset.key) return;
  const li = tick.closest('li');
  const to = tick.getAttribute('aria-pressed') !== 'true';
  if (pending) { clearTimeout(pending.timer); pending = null; }
  pending = { key: tick.dataset.key, to, t0: now(), undo: [] };
  if (to) sparks(tick);
  pending.undo = playTick(li, to, 0, true);
  // (no draw came: a list that changed, a note that is locked... the row goes back as it was)
  pending.timer = setTimeout(() => {
    const mine = pending;
    pending = null;
    if (!mine) return;
    mine.undo.forEach((a) => { try { a.cancel(); } catch (error) { /* gone */ } });
    if (li && li.isConnected) clearStrike(li);
  }, 1800);
  timers.add(pending.timer);
}

/* -- binding */
function relayout() {
  if (!on() || !page || !page.isConnected) return;
  weftLine(page, -1, false);
  page.querySelectorAll('.today-bar .g-thread').forEach((el) => el.remove());
  page.querySelectorAll('.today-test').forEach((card) => {
    const bar = card.querySelector('.today-bar');
    if (bar && !bar.querySelector('.g-thread')) {
      const found = /(\d+)\s+of\s+(\d+)/.exec(bar.getAttribute('aria-label') || '');
      const frac = found && Number(found[2]) ? Number(found[1]) / Number(found[2]) : 0;
      const w = Math.round(bar.getBoundingClientRect().width);
      if (w > 20) {
        const d = wavePath(w, 40, 6, 5);
        const thread = svg('svg', { viewBox: `0 0 ${w} 12`, preserveAspectRatio: 'none', 'aria-hidden': 'true' }, 'g-thread');
        const track = svg('path', { d }, 'g-track');
        const fill = svg('path', { d }, 'g-fill-line');
        thread.append(track, fill);
        bar.appendChild(thread);
        const length = lengthOf(fill);
        fill.style.transition = 'none';
        fill.style.strokeDasharray = String(length);
        fill.style.strokeDashoffset = (length * (1 - frac)).toFixed(1);
        if (!frac) fill.style.opacity = '0';
      }
    }
  });
  page.querySelectorAll('li.today-row.done .today-row-text strong').forEach((strong) => strikeLines(strong, 0, false));
  placeSlider(page, false);
}

function bind() {
  if (view && view.isConnected) return;
  view = document.querySelector('main.view');
  if (!view) return;
  if (observer) observer.disconnect();
  observer = new MutationObserver(() => refresh());
  observer.observe(view, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-selected'] });
}
function leave() {
  if (pullHandle) { pullHandle.destroy(); pullHandle = null; }
  if (shrinkHandle) { shrinkHandle.destroy(); shrinkHandle = null; }
  if (hold) { hold.remove(); hold = null; }
  for (const id of timers) clearTimeout(id);
  timers.clear();
  page = null; panelEl = null; panelDay = ''; panelRows = 0; rowsState = null; pending = null; moment = null; finishedDay = ''; sliderDay = '';
  document.querySelectorAll('.g-spark-host').forEach((el) => el.remove());
}
function stop() {
  if (observer) { observer.disconnect(); observer = null; }
  leave();
  view = null;
  opened = 0; openStart = 0; sawPlaceholder = false; numbers = {}; lastDay = '';
}

V.on('tab', (name) => {
  if (!on()) return;
  bind();
  if (name === 'today') { opened = now(); refresh(); } else if (page) { leave(); }
});
/* The look switched off: what this file made on the page that is showing is taken away again, where it stands (Today is not drawn
   again for it: nothing else of the app is touched by a change of look). */
function undecorate() {
  if (!view) return;
  view.querySelectorAll(':scope > .g-tbar-wrap, :scope > .g-pull-hint').forEach((el) => el.remove());
  const p = view.querySelector(':scope > .page.today');
  if (!p) return;
  p.classList.remove('g-opening');
  p.querySelectorAll('.g-slider, .g-hweft, .g-fill, .g-strike, .g-ring, .g-thread, .alldone-line, .g-spark, .sr-only[aria-expanded]').forEach((el) => el.remove());
  p.querySelectorAll('.g-struck').forEach((el) => el.classList.remove('g-struck'));
  p.querySelectorAll('.wd-label.g-split').forEach((el) => { el.textContent = el.textContent; el.classList.remove('g-split'); });
  p.querySelectorAll('.sweeping, .go').forEach((el) => el.classList.remove('sweeping', 'go'));
  p.querySelectorAll('.today-line').forEach((el) => { el.textContent = ''; });
  p.querySelectorAll('.g-num').forEach((el) => { const said = el.querySelector('.sr-only'); el.replaceWith(document.createTextNode(said ? said.textContent : el.textContent)); });
  p.querySelectorAll('.g-roll').forEach((el) => el.remove());
  p.querySelectorAll('.today-bar > svg').forEach((el) => el.remove());
  document.querySelectorAll('.g-spark-host').forEach((el) => el.remove());
}

V.on('look', () => {
  if (on()) {
    bind();
    if (view && view.dataset.tab === 'today') { page = null; opened = now(); refresh(); }  // (decorated where it stands, the entrance plays)
  } else {
    undecorate();
    stop();
  }
});
document.addEventListener('click', onTap, true);
window.addEventListener('resize', V.debounce ? V.debounce(relayout, 150) : relayout);
if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { if (on() && page) relayout(); }, () => {});
if (on()) bind();
})();
