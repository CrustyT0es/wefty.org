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
/* ---- round-2 fixes (R2-10): a pressed primary (and the round +) gets .g-sweep for .7 s, so its sheen sweeps across once
   even under a finger (a quick tap ends :active before the sweep is half way). glass.css draws it; nothing in lite or calm. */
const sweeping = new WeakMap();
document.addEventListener('pointerdown', (event) => {
  if (!on() || root.classList.contains('lite') || root.classList.contains('calm')) return;
  const button = event.target && event.target.closest && event.target.closest('.btn.primary, .fab');
  if (!button || button.disabled) return;
  clearTimeout(sweeping.get(button));
  button.classList.remove('g-sweep');
  const start = () => {
    button.classList.add('g-sweep');
    sweeping.set(button, setTimeout(() => { button.classList.remove('g-sweep'); sweeping.delete(button); }, 760));
  };
  // (a sweep already running starts again from the left: one frame without the class first)
  if (sweeping.has(button)) requestAnimationFrame(() => requestAnimationFrame(start));
  else start();
}, true);
/* (A screen drawn after a tab tap is a long frame: the new screen's entrance animations would wait for the frame after it
   to begin, so a frame or two showed almost nothing between the two screens. Each one that is still waiting starts at
   the frame the tap was handled in, so the first frame of the new screen is already partly risen in.) */
function startWaiting() {
  if (!on() || !document.timeline || document.timeline.currentTime == null) return;
  const view = document.querySelector('main.view');
  if (!view || typeof view.getAnimations !== 'function') return;
  const t = document.timeline.currentTime;
  for (const a of view.getAnimations({ subtree: true })) {
    try { if (a.pending && a.playState === 'running' && a.startTime == null) a.startTime = t; } catch (error) { /* fine */ }
  }
}
V.on('tab', () => { if (on()) Promise.resolve().then(startWaiting); });
/* ---- end of the round-2 fixes block */

/* ---- the 2.0 hotfix (the owner's first look) */

/* Which way the keyboard got somewhere: html.g-kbd while the keys are moving round the screen (Tab, or the arrows outside
   a text field), gone at the next press of a finger, a pen or the mouse. A text field shows no ring of its own on a tap
   or a click (glass.css: the caret says where the typing goes), and a clear rounded one for the keyboard. */
const TEXT_ENTRY = 'textarea, select, [contenteditable]:not([contenteditable="false"]), input:not([type=checkbox]):not([type=radio])'
  + ':not([type=button]):not([type=submit]):not([type=reset]):not([type=range]):not([type=color]):not([type=file]):not([type=image])';
const MOVES = new Set(['Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown']);
document.addEventListener('keydown', (event) => {
  if (!on() || !MOVES.has(event.key) || event.ctrlKey || event.metaKey || event.altKey) return;
  const t = event.target;
  if (event.key !== 'Tab' && t && t.closest && t.closest(TEXT_ENTRY)) return;  // (the arrows in a field move its caret)
  root.classList.add('g-kbd');
}, true);
const pointed = () => root.classList.remove('g-kbd');
for (const type of ['pointerdown', 'mousedown', 'touchstart']) document.addEventListener(type, pointed, { capture: true, passive: true });

/* A phone's on-screen keyboard: html.g-typing while a text field has the typing and the screen has got shorter than it was
   (the keyboard took the room: Wefty asks for the page to be resized, interactive-widget=resizes-content, and an iPhone
   shrinks only the visual viewport). glass.css slides the floating tab bar down out of the way, and back when the keyboard
   goes (Android's Back puts the keyboard away and leaves the field focused: the height says so). */
const KEYBOARD = 120;      // px the screen must lose before it counts as a keyboard (a phone's is 250 or more)
let tallest = 0;
let tallestFor = 0;        // the width `tallest` was measured at (a turned phone starts again)
const touchy = () => { try { return window.matchMedia('(pointer: coarse)').matches; } catch (error) { return false; } };
function screenHeight() {
  const vv = window.visualViewport;
  return Math.round(vv ? Math.min(window.innerHeight, vv.height * (vv.scale || 1)) : window.innerHeight);
}
function typingNow() {
  const el = document.activeElement;
  return !!(el && el !== document.body && el.matches && el.matches(TEXT_ENTRY) && !el.disabled && !el.readOnly);
}
function checkTyping() {
  // (a text box has the focus: the aurora's drift is paused meanwhile, glass.css; the owner's typing lag, 1.22.2)
  if (on() && typingNow() !== root.classList.contains('g-field')) root.classList.toggle('g-field', typingNow());
  else if (!on()) root.classList.remove('g-field');
  if (!on() || !touchy()) { root.classList.remove('g-typing'); return; }
  const height = screenHeight();
  const width = window.innerWidth;
  if (width !== tallestFor) { tallestFor = width; tallest = 0; }
  if (height > tallest) tallest = height;
  const typing = typingNow() && tallest - height >= KEYBOARD;
  if (root.classList.contains('g-typing') !== typing) root.classList.toggle('g-typing', typing);
}
const checkSoon = () => requestAnimationFrame(checkTyping);
document.addEventListener('focusin', checkSoon, true);
document.addEventListener('focusout', () => setTimeout(checkTyping, 60), true);  // (focus moving to another field: no flicker)
window.addEventListener('resize', checkTyping);
if (window.visualViewport) window.visualViewport.addEventListener('resize', checkTyping);
V.on('look', () => { if (!on()) root.classList.remove('g-typing', 'g-kbd'); else checkTyping(); });
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', checkTyping, { once: true }); else checkTyping();

/* Pull to sync, on every main screen (the owner: "I can sync from any screen"). One behaviour: V.motion.pull on the screen's
   own scroller, its glass pill, and syncNow(): one sync at a time (a pull while one runs shows its spinner until it is done),
   then "Synced" with a tick and the edge light, or the app's own state in words ("You're offline", "Couldn't sync"). Today and
   Notes bind it on their own scrollers (glass/today.js, glass/notes.js); the shell binds it everywhere else: Share's three
   parts, the Chat list (never inside a conversation, where pulling is for reading what came before), Settings' home and its
   pages. A phone's (a finger's) only, as Today's and Notes' are; never in classic. */
let syncing = null;
function outcome(failed) {
  const status = V.cloud && V.cloud.status;
  if (status === 'offline' || (typeof navigator !== 'undefined' && navigator.onLine === false)) return 'offline';
  if (failed || /^(error|asleep|signed-out)$/.test(String(status || ''))) return 'error';
  return 'synced';
}
function syncNow() {
  if (syncing) return syncing;
  let result = null;
  try { result = V.cloud && V.cloud.sync ? V.cloud.sync() : null; } catch (error) { result = Promise.reject(error); }
  syncing = Promise.resolve(result).then(() => outcome(false), () => outcome(true)).then((how) => {
    syncing = null;
    try { V.emit('edge', how === 'synced' ? 'synced' : 'error'); } catch (error) { /* nobody is listening */ }
    return how;
  });
  return syncing;
}
/* `scroller` gets the pull (its pill made here unless it has one), `wrap` is what moves with the finger. */
function pullSync(scroller, { wrap = null, allow = null, pill = true } = {}) {
  if (!scroller || !V.motion || !V.motion.pull) return { destroy() {} };
  let made = null;
  if (pill && !scroller.querySelector(':scope > .g-pull-hint')) {
    made = document.createElement('div');
    made.className = 'g-pull-hint g-pull-pill';
    made.setAttribute('aria-hidden', 'true');
    scroller.insertBefore(made, scroller.firstChild);
  }
  const handle = V.motion.pull(scroller, { wrap, allow, onRelease: (over) => { syncNow().then((how) => over(how)); } });
  return { destroy() { handle.destroy(); if (made) made.remove(); }, refresh() { if (handle.refresh) handle.refresh(); } };
}

const PULLED = /^(send|files|clips|claude|settings)$/;
let pulling = null;   // { scroller, handle }
let pullWatch = null;
const finger = () => { try { return matchMedia('(pointer: coarse)').matches && !(V.wide && V.wide()); } catch (error) { return false; } };
/* The scroller of the screen showing, or null where the shell gives no pull. */
function pullScroller() {
  const main = document.querySelector('#app > main.view');
  if (!main || !PULLED.test(main.dataset.tab || '')) return null;
  if (main.dataset.tab !== 'claude') return main;
  const app = main.querySelector('.chat-app');
  if (!app || app.classList.contains('showing-chat')) return null;  // (a conversation: never)
  const side = app.querySelector('.chat-side');
  return side && /(auto|scroll)/.test(getComputedStyle(side).overflowY) ? side : app.querySelector('.chat-list');
}
function unpull() {
  if (pulling) { pulling.handle.destroy(); pulling = null; }
}
function repull() {
  if (!on() || !finger()) { unpull(); return; }
  const scroller = pullScroller();
  // (the same screen drawn again, a sync's redraw of Settings say: the pull stays, its pill and state put back)
  if (pulling && pulling.scroller === scroller && scroller) { pulling.handle.refresh(); return; }
  unpull();
  if (!scroller) return;
  const main = scroller.matches('main.view');
  const wrap = main ? () => [...scroller.children].find((el) => !el.classList.contains('g-pull-hint') && !el.classList.contains('fab') && el.tagName !== 'SPAN') || null : null;
  const handle = pullSync(scroller, { wrap });
  pulling = { scroller, handle, hint: scroller.querySelector(':scope > .g-pull-hint') };
}
const repullSoon = (() => { let queued = false; return () => { if (queued) return; queued = true; requestAnimationFrame(() => { queued = false; repull(); }); }; })();
let chatWatch = null;
function watchPull() {
  if (typeof MutationObserver !== 'function') return;
  const main = document.querySelector('#app > main.view');
  if (!main) return;
  // (a screen drawn again: the pull follows; a chat opened or closed on a phone, too)
  if (!pullWatch) {
    pullWatch = new MutationObserver(repullSoon);
    pullWatch.observe(main, { childList: true });
  }
  if (!chatWatch) chatWatch = new MutationObserver(repullSoon);
  chatWatch.disconnect();
  const app = main.dataset.tab === 'claude' ? main.querySelector('.chat-app') : null;
  if (app) chatWatch.observe(app, { attributes: true, attributeFilter: ['class'] });
}
/* The phone's system bars (the owner: "keep the purple flow behind the notifications and the Samsung buttons"). A web page
   can't draw behind Android's status bar, but it can colour it: in glass the theme-color is the colour of the canvas's top
   edge (the aurora's tint of the time of day, worked out from its gradients for a phone's screen: a deep violet in dark, its
   light top in light, black in Pure black), or a full-screen note's own top while one is open on a phone. An installed app's
   navigation bar takes it too. Followed live: the tint, the theme, the look, a note opening or closing. Classic's own
   colours (js/theme.js) are put back when the look is switched off. (Only the real phone can show the bars themselves.) */
const BAR_TOPS = {
  dark: { morning: '#25152d', day: '#1e1537', night: '#140e2b', note: '#21193f' },
  light: { morning: '#f1def8', day: '#e4d8ff', night: '#e1d9ff', note: '#f3ebfe' },
};
let barsOwned = false;
function barColour() {
  if (root.hasAttribute('data-black')) return '#000000';
  const theme = root.dataset.theme === 'light' ? 'light' : 'dark';
  const phone = !(V.wide && V.wide());
  if (phone && document.querySelector('#layers > .editor-layer.shown, #layers > .layer.ink-layer')) return BAR_TOPS[theme].note;
  return BAR_TOPS[theme][root.dataset.tod || hourOf()] || BAR_TOPS[theme].day;
}
function paintBars() {
  if (!on()) {
    if (barsOwned) {
      barsOwned = false;
      try { if (V.theme && V.theme.set) V.theme.set(V.theme.choice()); } catch (error) { /* (they stay until the next change) */ }
    }
    return;
  }
  const colour = barColour();
  barsOwned = true;
  for (const meta of document.querySelectorAll('meta[name=theme-color]')) if (meta.content !== colour) meta.content = colour;
}
const paintBarsSoon = (() => { let queued = false; return () => { if (queued) return; queued = true; Promise.resolve().then(() => { queued = false; paintBars(); }); }; })();
if (typeof MutationObserver === 'function') {
  // (js/theme.js writes its own colour at each change of theme: glass's is put back over it; and the tint of the day, or a
  // note opening over everything, changes it)
  new MutationObserver(() => { if (on() || barsOwned) paintBarsSoon(); })
    .observe(root, { attributes: true, attributeFilter: ['data-tod', 'data-theme', 'data-black', 'data-look'] });
  const watchBars = () => {
    const head = document.head;
    if (head) new MutationObserver(() => { if (on()) paintBarsSoon(); }).observe(head, { subtree: true, attributes: true, attributeFilter: ['content'] });
    const layers = document.getElementById('layers');
    // (a layer coming or going, or shown: the note's .shown comes a frame after it is put in)
    if (layers) {
      new MutationObserver((records) => {
        if (on() && records.some((r) => r.type === 'childList' || r.target.parentNode === layers)) paintBarsSoon();
      }).observe(layers, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
    }
    paintBars();
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', watchBars, { once: true }); else watchBars();
}
V.on('theme', paintBarsSoon);
V.on('look', paintBarsSoon);
if (V.onWide) V.onWide(paintBarsSoon);

V.on('tab', () => { if (on()) { requestAnimationFrame(watchPull); repullSoon(); } else unpull(); });
V.on('look', () => { if (on()) { watchPull(); repullSoon(); } else unpull(); });
window.addEventListener('resize', repullSoon);
/* ---- end of the 2.0 hotfix block */
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', sync, { once: true });
else sync();

V.glass = {
  enabled: on,
  /* Pull to sync (the 2.0 hotfix): syncNow() syncs, one at a time ('synced' | 'offline' | 'error'); pullSync(scroller, { wrap })
     gives a scroller the pull with its pill. */
  syncNow,
  pullSync,
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
