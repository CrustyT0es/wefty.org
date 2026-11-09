/* Wefty 2.0 "glass": the shell. Owns the frame js/start.js builds (nav.tabs, the tab buttons, the rail), the aurora behind
   it, and V.glass. Inert unless the glass look is on (V.look.isGlass()); it listens for V.on('look') so the switch in
   Settings works at once, with no reload, in both directions.

   What it does:
     - the aurora: three tint layers (morning, day, night) behind the app, cross-faded by the local hour (html[data-tod]);
     - the sliding indicator behind the tab you are on (one element moved with transform, with the board's little
       stretch), on the phone's floating bar and on the Chromebook's rail alike;
     - the weft that passes between tabs: the thread under the tab you leave is drawn out towards the tab you are going
       to, and the thread under the new tab is drawn in from the side you came from (the board's w-in / w-out logic and
       timing). It starts the moment a tab is tapped, not when the screen has been drawn;
     - badges that pop when a number appears or changes;
     - V.glass: surface(el) (the board's glass on any element), tod() / setTod(), enabled().
   Classic is not touched: when the look is switched off everything made here is removed again. */
'use strict';

(() => {
const V = (window.V = window.V || {});
const root = document.documentElement;
const EASE = 'cubic-bezier(.2,.8,.2,1)';
const EXIT = 'cubic-bezier(.5,0,.8,.4)';
const HAS_WAAPI = typeof Element !== 'undefined' && typeof Element.prototype.animate === 'function';

const on = () => !!(V.look && V.look.isGlass());
const calm = () => root.classList.contains('calm');
const lite = () => root.classList.contains('lite');

let aurora = null;
let slide = null;
let nav = null;
let index = -1;          // the tab that shows as on, by its place in the bar
let flip = 0;            // alternates, so the indicator's stretch can run again
let todTimer = 0;
let todOverride = '';
let resizer = null;
let observer = null;     // a new nav.tabs in #app
let badgeWatch = null;   // a number changing in a badge
let weftLength = 24;

/* -- time of day: the aurora's tint */
function hourOf() {
  const h = new Date().getHours();
  return h >= 5 && h < 12 ? 'morning' : h >= 12 && h < 18 ? 'day' : 'night';
}
function tod(value) {
  if (value === undefined) return root.dataset.tod || hourOf();
  todOverride = ['morning', 'day', 'night'].includes(value) ? value : '';
  root.dataset.tod = todOverride || hourOf();
  return root.dataset.tod;
}
function tickTod() { root.dataset.tod = todOverride || hourOf(); }

/* -- the aurora */
function makeAurora() {
  if (aurora && aurora.isConnected) return;
  aurora = document.createElement('div');
  aurora.id = 'g-aurora';
  aurora.setAttribute('aria-hidden', 'true');
  for (const cls of ['tl-m', 'tl-d', 'tl-n']) {
    const layer = document.createElement('div');
    layer.className = `tl ${cls}`;
    aurora.appendChild(layer);
  }
  document.body.insertBefore(aurora, document.body.firstChild);
}

/* -- the tab bar / rail */
const tabsOf = () => (nav ? [...nav.querySelectorAll(':scope > .tab')] : []);
const pathOf = (tab) => (tab ? tab.querySelector('.weave path') : null);

function measureWeft() {
  const path = pathOf(tabsOf()[0]);
  if (!path) return;
  let length = 0;
  try { length = Math.ceil(path.getTotalLength()); } catch (error) { length = 0; }
  if (length > 4) { weftLength = length; nav.style.setProperty('--g-weft', String(length)); }
}

/* Put the indicator under the tab that is on (no animation when `still`). Nothing is on (Settings on a phone hides the
   bar; wide, Settings has no tab): the indicator waits out of sight. */
function place(still) {
  if (!nav || !slide) return;
  const tabs = tabsOf();
  const now = tabs.findIndex((tab) => tab.classList.contains('on'));
  if (now < 0 || !nav.offsetWidth) {
    slide.style.opacity = '0';
    return;
  }
  const tab = tabs[now];
  if (still) slide.classList.add('g-still');
  slide.style.opacity = '1';
  slide.style.width = `${tab.offsetWidth}px`;
  slide.style.height = `${tab.offsetHeight}px`;
  slide.style.transform = `translate3d(${tab.offsetLeft}px,${tab.offsetTop}px,0)`;
  if (still) {
    void slide.offsetWidth;  // (settle at once, then let it slide again)
    requestAnimationFrame(() => slide && slide.classList.remove('g-still'));
  }
}

/* The weft passes from the tab left to the tab arrived at: out of the old one towards the new, into the new one from
   the side it came from. Restartable (a newer pass cancels the older), and left alone in calm (the CSS state is final). */
function pass(from, to) {
  const tabs = tabsOf();
  if (from === to || !tabs[to]) return;
  if (calm() || !HAS_WAAPI) return;
  const dir = from < 0 ? 0 : to > from ? 1 : -1;
  const L = weftLength;
  const goes = pathOf(tabs[from]);
  const comes = pathOf(tabs[to]);
  const quick = lite();
  if (goes && dir) {
    goes.getAnimations().forEach((a) => a.cancel());
    const out = goes.animate([{ strokeDashoffset: 0 }, { strokeDashoffset: -dir * L }], { duration: quick ? 1 : 240, easing: EXIT, fill: 'both' });
    const release = () => { try { out.cancel(); } catch (error) { /* gone */ } };
    out.finished.then(release, release);
  }
  if (comes) {
    comes.getAnimations().forEach((a) => a.cancel());
    comes.animate([{ strokeDashoffset: (dir || 1) * L }, { strokeDashoffset: 0 }], { duration: quick ? 120 : 400, delay: quick ? 0 : 140, easing: EASE, fill: 'backwards' });
  }
}

/* The indicator's little stretch as it lands (the board's), alternating two names so it can run again at once. */
function stretch() {
  if (!slide || calm() || lite()) return;
  flip ^= 1;
  slide.classList.remove('g-sa', 'g-sb');
  slide.classList.add(flip ? 'g-sa' : 'g-sb');
}

/* The words under the pill. A tab's text is white while the pill is behind it: the tab left keeps its white a moment (the
   pill hasn't moved off it yet), and the tabs the pill sweeps past light up for as long as it takes to cross them, so
   dark words never sit on the purple (they did, in light). */
const lit = new Map();  // tab -> timers
function light(tab, wait, ms) {
  for (const id of lit.get(tab) || []) clearTimeout(id);
  const on = setTimeout(() => tab.classList.add('g-over'), wait);
  const off = setTimeout(() => { tab.classList.remove('g-over'); lit.delete(tab); }, wait + ms);
  lit.set(tab, [on, off]);
}
function words(from, to) {
  if (calm() || from < 0) return;
  const tabs = tabsOf();
  const lo = Math.min(from, to), hi = Math.max(from, to);
  // (the pill springs across in about .3 s: a tab it passes is under it for the middle of that)
  for (let i = lo + 1; i < hi; i++) light(tabs[i], lite() ? 20 : 80 + Math.abs(i - from) * 40, lite() ? 120 : 170);
}

/* Show tab `to` (its index) as current: the indicator, the weft, the stretch. */
function go(to, early) {
  if (to === index) { if (!early) place(false); return; }
  const from = index;
  index = to;
  if (to < 0) { place(true); return; }
  if (from < 0) { place(true); return; }
  const tabs = tabsOf();
  if (early) {
    // (the tab was tapped: the screen has not been drawn yet, so the tab's own class is still the old one)
    const tab = tabs[to];
    slide.style.opacity = '1';
    slide.style.width = `${tab.offsetWidth}px`;
    slide.style.height = `${tab.offsetHeight}px`;
    slide.style.transform = `translate3d(${tab.offsetLeft}px,${tab.offsetTop}px,0)`;
  } else {
    place(false);
  }
  stretch();
  pass(from, to);
  words(from, to);
}

function decorate() {
  const found = document.querySelector('#app > nav.tabs');
  if (found === nav) return;
  undecorate();
  nav = found;
  if (!nav) return;
  slide = document.createElement('span');
  slide.className = 'g-tabslide g-still';
  slide.setAttribute('aria-hidden', 'true');
  slide.appendChild(document.createElement('i'));
  nav.insertBefore(slide, nav.firstChild);
  measureWeft();
  index = tabsOf().findIndex((tab) => tab.classList.contains('on'));
  place(true);
  nav.addEventListener('click', tapped, true);
  if (window.ResizeObserver) {
    resizer = new ResizeObserver(() => { measureWeft(); place(true); });
    resizer.observe(nav);
  }
  badgeWatch = new MutationObserver(badges);
  badgeWatch.observe(nav, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['hidden'] });
}

function undecorate() {
  if (nav) {
    nav.removeEventListener('click', tapped, true);
    nav.style.removeProperty('--g-weft');
    for (const path of nav.querySelectorAll('.weave path')) path.getAnimations().forEach((a) => a.cancel());
    for (const tab of nav.querySelectorAll('.tab')) tab.classList.remove('g-over');
  }
  for (const timers of lit.values()) timers.forEach(clearTimeout);
  lit.clear();
  if (resizer) { resizer.disconnect(); resizer = null; }
  if (badgeWatch) { badgeWatch.disconnect(); badgeWatch = null; }
  if (slide) slide.remove();
  slide = null;
  nav = null;
  index = -1;
}

/* A tab tapped: the indicator and the weft answer at once. start.js draws the screen after (and says 'tab'). */
function tapped(event) {
  const tab = event.target && event.target.closest && event.target.closest('.tab');
  if (!tab || !nav || !on()) return;
  const to = tabsOf().indexOf(tab);
  if (to >= 0 && to !== index) go(to, true);
}

/* A badge's number changing pops it (appearing is the stylesheet's). */
let popped = new WeakMap();
function badges(records) {
  if (calm() || !HAS_WAAPI) return;
  const seen = new Set();
  for (const record of records) {
    const badge = record.target && (record.target.nodeType === 1 ? record.target : record.target.parentElement);
    const mark = badge && badge.closest && badge.closest('.badge');
    if (!mark || mark.hidden || seen.has(mark) || record.attributeName === 'hidden') continue;
    seen.add(mark);
    const before = popped.get(mark);
    if (before) before.cancel();
    popped.set(mark, mark.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.3)', offset: 0.35 }, { transform: 'scale(1)' }],
      { duration: lite() ? 160 : 420, easing: 'cubic-bezier(.34,1.45,.64,1)' }));
  }
}

/* -- the aurora rests when nothing happens: after 8 s without a touch, key or scroll the drift stops (html.g-idle), so a
   page sitting open doesn't recompute the tab bar's blur every frame; any input starts it again. It also stands still
   while a page is scrolling and while a sheet is open (glass.css), the two times the bars behind it are busiest. */
let idleMs = 8000;
let idleTimer = 0;
let lastInput = 0;
const WAKE = ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart', 'scroll'];
function wake() {
  const now = Date.now();
  if (root.classList.contains('g-idle')) root.classList.remove('g-idle');
  if (now - lastInput < 1000 && idleTimer) return;  // (one timer a second at most, however many events come)
  lastInput = now;
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => root.classList.add('g-idle'), idleMs);
}
let scrollTimer = 0;
function scrolling() {
  if (!root.classList.contains('g-scrolling')) root.classList.add('g-scrolling');
  clearTimeout(scrollTimer);
  scrollTimer = setTimeout(() => root.classList.remove('g-scrolling'), 180);
}
function watchIdle(onOff) {
  for (const type of WAKE) {
    if (onOff) window.addEventListener(type, wake, { passive: true, capture: true });
    else window.removeEventListener(type, wake, { capture: true });
  }
  if (onOff) window.addEventListener('scroll', scrolling, { passive: true, capture: true });
  else { window.removeEventListener('scroll', scrolling, { capture: true }); clearTimeout(scrollTimer); root.classList.remove('g-scrolling'); }
  clearTimeout(idleTimer);
  idleTimer = 0;
  root.classList.remove('g-idle');
  if (onOff) wake();
}

/* -- the frame-drop monitor starts once Wefty has settled (its first sync done, or a few seconds), not in the cold start's
   busy boot, which would make a quick device look slow and leave it lite for a week. */
let settleTimer = 0;
let settled = false;
function settle() {
  if (settled) return;
  settled = true;
  clearTimeout(settleTimer);
  setTimeout(() => { if (on() && V.motion && V.motion.watch) V.motion.watch(5); }, 2500);
}

/* -- on and off */
function enable() {
  if (!document.body) return;
  tickTod();
  makeAurora();
  if (!todTimer) todTimer = setInterval(tickTod, 60000);
  decorate();
  if (!observer) {
    const app = document.getElementById('app');
    if (app) {
      observer = new MutationObserver(() => { if (on()) decorate(); });
      observer.observe(app, { childList: true });
    }
  }
  watchIdle(true);
  if (!settled && !settleTimer) settleTimer = setTimeout(settle, 12000);  // (the first 'synced' says it sooner)
}
function disable() {
  if (todTimer) { clearInterval(todTimer); todTimer = 0; }
  if (observer) { observer.disconnect(); observer = null; }
  undecorate();
  watchIdle(false);
  if (aurora) { aurora.remove(); aurora = null; }
  delete root.dataset.tod;
}
const sync = () => (on() ? enable() : disable());

V.on('look', sync);
V.on('status', (value) => { if (on() && (value === 'synced' || value === 'offline' || value === 'held')) settle(); });
V.on('tab', () => {
  if (!on()) return;
  decorate();
  if (nav) go(tabsOf().findIndex((tab) => tab.classList.contains('on')), false);
});
V.on('animations', () => { if (on() && nav) place(true); });
V.on('theme', () => { if (on() && nav) place(true); });
// A wide screen and a narrow one lay the bar out differently (a rail, a floating bar): the indicator follows.
window.addEventListener('resize', () => { if (on() && nav) place(true); });
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', sync, { once: true });
else sync();

V.glass = {
  enabled: on,
  tod,
  setTod: tod,
  /* How long the aurora drifts with nothing touched, in ms (8 s; the tests shorten it). */
  idleAfter(ms) { if (ms > 0) { idleMs = ms; lastInput = 0; if (on()) wake(); } return idleMs; },
  /* The board's glass on any element (rounded, soft fill, the light edge, the drop shadow). */
  surface(el, { sheen = false } = {}) {
    if (el) { el.classList.add('g'); if (sheen) el.classList.add('sheen'); }
    return el;
  },
};
})();
