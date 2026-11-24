/* Wefty 2.0 "glass", area: Settings. This file belongs to the Settings builder; nobody else edits it.
   Settings (js/settings.js, settingsui.js, profile.js's menu): the home, the pages and their cards, the search.
   Rules (vault/web/glass/README.txt has the rest): everything here is inert unless V.look.isGlass() (and listens to
   V.on('look') so the switch works live); only transform and opacity animate; V.motion's helpers do the moving.

   What this file does (the look itself is settings.css; js/settingsui.js only says when it draws, with its
   'settings-leaving' / 'settings-drawn' / 'settings-list' events):
     - the board's touches on the screen drawn: a thread under the big title (drawn once per page, never on a redraw of
       the same page), and your account as its own card at the top of the list (a phone's home);
     - a phone's page push and back (the board's "open Appearance" and "back"): the page that goes stays on the screen
       as a picture for a moment (a copy with no ids, inert, hidden from screen readers, gone after .46 s) while the new
       one slides in over it from the right; back, the page slides off to the right and the home comes back from the
       left. Wide, a page swapped on the right rises in. Lite: only the new page, a short slide. Calm: a fade;
     - the segmented controls (Theme, Animations, Corners...): one lit pill that slides to the picked option with a
       little stretch, as the board's Theme picker does, instead of the picked option simply changing. */
'use strict';

(() => {
const V = window.V;
if (!V) return;

const on = () => !!(V.look && V.look.isGlass());
const calm = () => !!(V.motion && V.motion.calm && V.motion.calm());
const lite = () => !!(V.motion && V.motion.lite && V.motion.lite());
const SLIDE = 'cubic-bezier(.25,1.18,.35,1)';
const EASE = 'cubic-bezier(.2,.8,.2,1)';
const STRETCH = 'cubic-bezier(.25,.8,.3,1)';
const HAS_WAAPI = typeof Element !== 'undefined' && typeof Element.prototype.animate === 'function';
const SVG = 'http://www.w3.org/2000/svg';
// The board's thread under a title (358 x 12, one wave every 45 px).
const WEFT = 'M0 6 C 15 1, 30 11, 45 6 S 75 1, 90 6 S 120 11, 135 6 S 165 1, 180 6 S 210 11, 225 6 S 255 1, 270 6 S 300 11, 315 6 S 345 1, 358 6';

const animate = (el, frames, options) => {
  if (!el || !HAS_WAAPI) return null;
  try { return el.animate(frames, options); } catch (error) { return null; }
};

/* ---------------------------------------------------------------- the thread under the title */

function weft(after, draw) {
  if (!after || !after.parentNode) return null;
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('class', 'g-set-weft');
  svg.setAttribute('viewBox', '0 0 358 12');
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(SVG, 'path');
  path.setAttribute('class', 'g-weft');
  path.setAttribute('d', WEFT);
  svg.append(path);
  after.after(svg);
  if (draw && V.motion && V.motion.weft && !calm()) V.motion.weft(path, { delay: lite() ? 0 : 200, duration: lite() ? 300 : 1100 });
  return svg;
}

/* ---------------------------------------------------------------- your account, a card of its own (a phone's home) */

function profileCard(root) {
  const home = root.querySelector('.settings-home nav.set-home');
  if (!home || home.querySelector('.g-set-profile')) return;
  const row = home.querySelector('.set-cat[data-cat="account"]');
  if (!row) return;
  const card = document.createElement('div');
  card.className = 'set-group card g-set-profile';
  home.prepend(card);
  card.append(row);
  // (a group left empty by the move: none today, as Account shares its group, but never an empty card)
  for (const group of home.querySelectorAll('.set-group')) if (!group.children.length) group.remove();
}

/* ---------------------------------------------------------------- the segmented controls: one lit pill that slides */

const picked = new Map();  // a control's name (its page and aria-label) -> the option picked when it was last drawn
const watched = new WeakMap();

function placePill(seg) {
  const pill = seg.querySelector(':scope > .g-seg-hl');
  const button = seg.querySelector(':scope > button[aria-checked="true"]');
  if (!pill || !button) return;
  pill.style.left = `${button.offsetLeft}px`;
  pill.style.top = `${button.offsetTop}px`;
  pill.style.width = `${button.offsetWidth}px`;
  pill.style.height = `${button.offsetHeight}px`;
}

function segments(root, pageId, move) {
  for (const seg of root.querySelectorAll('.segmented')) {
    if (seg.classList.contains('share-switch') || seg.querySelector(':scope > .g-seg-hl')) continue;
    const buttons = [...seg.children].filter((el) => el.tagName === 'BUTTON');
    const now = buttons.findIndex((b) => b.getAttribute('aria-checked') === 'true' || b.getAttribute('aria-selected') === 'true');
    if (now < 0) continue;
    const key = `${pageId}|${seg.getAttribute('aria-label') || ''}|${buttons.length}`;
    const was = picked.get(key);
    picked.set(key, now);
    seg.classList.add('g-seg');
    const pill = document.createElement('span');
    pill.className = 'g-seg-hl';
    pill.setAttribute('aria-hidden', 'true');
    pill.append(document.createElement('i'));
    seg.prepend(pill);
    placePill(seg);
    if (typeof ResizeObserver === 'function' && !watched.has(seg)) {
      const ro = new ResizeObserver(() => { if (seg.isConnected) placePill(seg); else ro.disconnect(); });
      ro.observe(seg);
      watched.set(seg, ro);
    }
    if (!move || was === undefined || was === now || !buttons[was] || calm()) continue;
    const dx = buttons[was].offsetLeft - buttons[now].offsetLeft;
    const dy = buttons[was].offsetTop - buttons[now].offsetTop;
    if (!dx && !dy) continue;
    animate(pill, [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }],
      { duration: lite() ? 200 : 460, easing: lite() ? EASE : SLIDE });
    if (!lite()) {
      animate(pill.firstChild, [{ transform: 'none' }, { transform: 'scale(1.07, .94)', offset: 0.28 },
        { transform: 'scale(.985, 1.015)', offset: 0.6 }, { transform: 'none' }], { duration: 460, easing: STRETCH });
    }
  }
}

/* ---------------------------------------------------------------- a phone's page push and back */

let leaving = null;   // { rect, dir } of the page going, measured before it went
let ghost = null;     // the picture of it while it slides away
// (glass/swipeback.js: a swipe back let go part of the way hands over to the carousels here, which then start where the finger
// left the screen: { x, p } with p its share of the way, else null)
const swiped = () => { try { return V.swipeBack && V.swipeBack.taken ? V.swipeBack.taken() : null; } catch (error) { return null; } };

function dropGhost() {
  if (ghost) { ghost.remove(); ghost = null; }
}

V.on('settings-leaving', ({ old, page, was, wide }) => {
  leaving = null;
  if (!on() || wide || was === null || was === undefined || page === was || !old) return;
  leaving = { rect: old.getBoundingClientRect(), dir: page ? 1 : -1, from: swiped() };
});

function push(root, step) {
  const page = root.querySelector(':scope > .page') || root.firstElementChild;  // (the pull-to-sync pill is the first child, shell.js)
  if (!page || !HAS_WAAPI) return;
  const { dir, rect, old } = step;
  dropGhost();
  if (calm()) {
    animate(page, [{ opacity: 0 }, { opacity: 1 }], { duration: 120, easing: 'linear' });
    return;
  }
  if (lite()) {
    animate(page, [{ opacity: 0, transform: `translateX(${dir * 24}px)` }, { opacity: 1, transform: 'none' }], { duration: 180, easing: EASE });
    return;
  }
  // The page that goes: the old one itself (already out of the page), as an inert picture with no ids, where it was.
  ghost = document.createElement('div');
  ghost.className = 'g-set-ghost' + (dir > 0 ? ' under' : ' over');
  ghost.setAttribute('aria-hidden', 'true');
  ghost.inert = true;
  for (const el of old.querySelectorAll('[id]')) el.removeAttribute('id');
  old.removeAttribute('id');
  for (const el of old.querySelectorAll('input, textarea, button, select, a')) el.tabIndex = -1;
  ghost.style.left = `${rect.left}px`;
  ghost.style.top = `${rect.top}px`;
  ghost.style.width = `${rect.width}px`;
  ghost.append(old);
  document.body.append(ghost);
  const mine = ghost;
  // A page pushed or going back: the screen's own box (`root`, which a redraw of the page a moment after it opens doesn't take
  // away) and the picture of the page that goes, a page's width apart at every frame, driven from one clock (V.motion.tween);
  // the picture used to stay under the new page as it came, and the page, which is glass, showed it through itself.
  const z = parseFloat(getComputedStyle(document.documentElement).zoom) || 1;
  const dist = Math.ceil(rect.width / z);
  const app = document.getElementById('app');
  const clipped = app ? app.style.overflowX : '';
  if (app) app.style.overflowX = 'clip';
  const end = () => {
    root.style.transform = '';
    if (app && app.style.overflowX === 'clip') app.style.overflowX = clipped;
    if (ghost === mine) dropGhost(); else mine.remove();
  };
  if (dir > 0 && V.motion && V.motion.enter && page.querySelectorAll(':scope > .set-page > *, :scope > .set-about').length) {
    V.motion.enter(page, { selector: ':scope > .set-about, :scope > .set-page > *', delay: 90, stagger: 50 });
  }
  if (!V.motion || !V.motion.tween || !V.motion.bezier) { end(); return; }
  const left = 1 - (step.from ? step.from.p : 0);  // (the part of the way still to go: all of it, unless a swipe began it)
  const move = V.motion.tween(460, V.motion.bezier(0.22, 1, 0.36, 1), (e) => {
    root.style.transform = e >= 1 ? '' : `translateX(${dir * dist * left * (1 - e)}px)`;
    mine.style.transform = `translateX(${-dir * dist * left * e}px)`;
  });
  move.finished.then(end, end);
  setTimeout(() => { if (mine.isConnected) end(); }, 2200);   // (never left on the screen)
}

/* ---------------------------------------------------------------- after each drawing */

V.on('settings-drawn', ({ root, page, was, wide, old, searching }) => {
  if (!on() || !root) { leaving = null; return; }
  const fresh = page !== was;  // (a page shown now, not the same one drawn again with new data)
  // The thread under the big title (a phone: under the head; wide: under the page's title).
  if (wide) {
    weft(root.querySelector('.set-main > .set-title'), fresh);
  } else {
    weft(root.querySelector('.page.settings > header.app-head'), fresh);
    profileCard(root);
  }
  segments(root, page, !fresh);
  const step = leaving;
  leaving = null;
  if (!fresh) return;
  if (step && !wide && old) { push(root, { ...step, old }); return; }
  if (was === null || was === undefined) {
    // Settings opened: the home's parts (or the wide page's) rise in, one after the other.
    if (!V.motion || !V.motion.enter) return;
    if (wide) {
      V.motion.enter(root, { selector: '.set-side > :not(.set-list), .set-side .set-group, .set-main > *', delay: 40, stagger: 40 });
    } else if (!page) {
      V.motion.enter(root, { selector: '.settings-home > :not(.set-list), .settings-home .set-group', delay: 40, stagger: 45 });
    } else {
      V.motion.enter(root, { selector: '.settings-sub > *', delay: 40, stagger: 45 });
    }
    return;
  }
  if (wide && V.motion && V.motion.enter && !searching) {
    V.motion.enter(root, { selector: '.set-main > *', delay: 0, stagger: 40 });
  }
});

// A search typed or cleared: the home's list drawn again (the account card again too), results rising in.
V.on('settings-list', ({ searching }) => {
  if (!on()) return;
  const root = document.querySelector('main.view[data-tab="settings"]');
  if (!root) return;
  if (!searching && !V.wide()) profileCard(root);
  if (searching && V.motion && V.motion.enter && !calm()) {
    const groups = root.querySelectorAll('.set-results > *');
    if (groups.length) V.motion.enter(root, { selector: '.set-results > *', stagger: 30, max: 5 });
  }
});

// The look switched while Settings shows: drawn again, so nothing of the other look stays.
V.on('look', () => {
  dropGhost();
  if (V.tab && V.tab() === 'settings' && V.settings && V.settings.draw) {
    try { V.settings.draw(); } catch (error) { /* (drawn at the next change) */ }
  }
});
V.on('tab', (tab) => { if (tab !== 'settings') dropGhost(); });

/* ---------------------------------------------------------------- Settings coming in over a screen, and going back

   The owner's recording: Settings appeared at once (with the menu it was opened from still fading over it). On a phone the
   screen that goes is photographed as it is replaced (js/start.js: 'screen-leaving'), and Settings pushes in from the right
   as that picture goes off to the left, a screen's width each, on one curve and one clock, so the two are never over each
   other; leaving Settings it is the other way round. Wide, and lite and calm, keep the shell's own short slide. */
const CAROUSEL = 'cubic-bezier(.22,1,.36,1)';
let carried = null;   // { ghost, dir }
function dropCarried() {
  if (carried) { carried.ghost.remove(); carried = null; }
}
V.on('screen-leaving', ({ was, view }) => {
  dropCarried();
  if (!on() || V.wide() || calm() || lite() || !HAS_WAAPI || (view !== 'settings' && was !== 'settings')) return;
  const main = document.querySelector('main.view');
  if (!main) return;
  const z = parseFloat(getComputedStyle(document.documentElement).zoom) || 1;
  const r = main.getBoundingClientRect();
  const ghost = document.createElement('div');
  ghost.className = 'g-set-carry';
  ghost.setAttribute('aria-hidden', 'true');
  ghost.inert = true;
  Object.assign(ghost.style, { position: 'fixed', left: `${r.left / z}px`, top: `${r.top / z}px`, width: `${r.width / z}px`, height: `${r.height / z}px`,
    overflow: 'hidden', pointerEvents: 'none', zIndex: '0', margin: '0' });
  const holder = document.createElement('div');
  holder.className = main.className;
  holder.dataset.tab = main.dataset.tab;
  holder.style.cssText = 'position:absolute;inset:0;overflow:hidden;';
  for (const child of main.children) {
    if (child.nodeType !== 1 || child.hidden || child.classList.contains('fab')) continue;
    const copy = child.cloneNode(true);
    for (const el of copy.querySelectorAll('[id]')) el.removeAttribute('id');
    for (const el of copy.querySelectorAll('input, textarea, button, select, a')) el.tabIndex = -1;
    holder.append(copy);
  }
  holder.scrollTop = main.scrollTop;
  ghost.append(holder);
  document.body.append(ghost);
  carried = { ghost, holder, dir: view === 'settings' ? 1 : -1, width: Math.ceil(r.width / z), from: swiped() };
});
V.on('tab', () => {
  const step = carried;
  carried = null;
  if (!step) return;
  const main = document.querySelector('main.view');
  if (!main || !on() || V.wide() || calm() || lite() || !HAS_WAAPI) { step.ghost.remove(); return; }
  const { dir, width, ghost, holder } = step;
  const left = 1 - (step.from ? step.from.p : 0);  // (a swipe back began it: the rest of the way)
  const ms = 470;
  // (the shell's own fade and 18 px slide for a change of screen is let go: this is the move)
  Promise.resolve().then(() => { for (const child of main.children) for (const a of child.getAnimations()) if (a.id === 'g-slide') a.cancel(); });
  // The move is the screen's own box (`main.view`), which a redraw of Settings' page, a moment after it opens, doesn't take
  // away, and it is driven from one clock with the picture of the screen that goes (V.motion.tween): the two keep exactly a
  // screen's width apart from the first painted frame to the last. The app is clipped sideways meanwhile: a screen a
  // screen's width off to the right once made Chrome zoom out to show it.
  const app = document.getElementById('app');
  const before = app ? app.style.overflowX : '';
  if (app) app.style.overflowX = 'clip';
  const settle = () => {
    ghost.remove();
    main.style.transform = '';
    if (app && app.style.overflowX === 'clip') app.style.overflowX = before;
  };
  if (!V.motion || !V.motion.tween || !V.motion.bezier) { settle(); return; }
  const move = V.motion.tween(ms, V.motion.bezier(0.22, 1, 0.36, 1), (e) => {
    main.style.transform = e >= 1 ? '' : `translateX(${dir * width * left * (1 - e)}px)`;
    holder.style.transform = `translateX(${-dir * width * left * e}px)`;
  });
  move.finished.then(settle, settle);
  setTimeout(settle, ms + 1500);
});

/* ---------------------------------------------------------------- More options (and any card that opens): height and fade

   js/settingsui.js opens and closes a page's More options by toggling `hidden`, so its rows appeared in a frame. After the
   app has done that (the next frame, before it is painted) the region is opened or closed on its height and a fade, with its
   rows coming in one after the other; its chevron turns by its own transition. Calm: a fade. */
document.addEventListener('click', (event) => {
  if (!on() || !HAS_WAAPI) return;
  const head = event.target && event.target.closest ? event.target.closest('.set-more-head') : null;
  const region = head && head.parentElement ? head.parentElement.querySelector(':scope > .set-more-rows') : null;
  if (!region) return;
  requestAnimationFrame(() => {
    if (!region.isConnected) return;
    const opening = !region.hidden;
    region.getAnimations().forEach((a) => { if (a.id === 'g-more') a.cancel(); });
    if (calm()) { if (opening) animate(region, [{ opacity: 0 }, { opacity: 1 }], { duration: 120, easing: 'linear' }); return; }
    if (!opening) region.hidden = false;   // (it is shut already: shown again for the way out)
    const full = region.scrollHeight;
    const was = region.style.overflow;
    region.style.overflow = 'hidden';
    const frames = opening ? [{ height: '0px', opacity: 0 }, { height: `${full}px`, opacity: 1 }] : [{ height: `${full}px`, opacity: 1 }, { height: '0px', opacity: 0 }];
    const a = animate(region, frames, { duration: lite() ? 180 : opening ? 420 : 300, easing: opening ? SLIDE : EASE, id: 'g-more' });
    const end = () => { region.style.overflow = was; if (!opening) region.hidden = true; };
    if (a) { a.finished.then(end, end); setTimeout(() => { if (region.style.overflow === 'hidden') end(); }, 900); } else end();
    if (opening && !lite() && V.motion && V.motion.enter) V.motion.enter(region, { selector: ':scope > .setting', delay: 60, stagger: 36, max: 6 });
  });
}, true);

V.glassSettings = { segments, picked };
})();
