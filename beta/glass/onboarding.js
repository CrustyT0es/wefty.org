/* Wefty 2.0 "glass", area: Onboarding. This file belongs to the Onboarding builder; nobody else edits it.
   Everything before the app (js/start.js's gate screens, welcome.js, doors.js, pair.js, tour.js, help.js): sign-in, sign-up, the welcome steps, the tour, Help.
   Rules (vault/web/glass/README.txt has the rest): everything here is inert unless V.look.isGlass() (and listens to
   V.on('look') so the switch works live); only transform and opacity animate; V.motion's helpers do the moving.

   What this file does (the look itself is onboarding.css; js/start.js says when a screen before the app is drawn with
   its 'gate-leaving' / 'gate-screen' events, and js/welcome.js says which step shows with 'welcome-step'):
     - screen to screen (the board's "step 1 to 2", "step 2 to 3" and "back a step"): the screen that goes slides off
       to the left as a picture (a copy with no ids, inert, gone after .46 s) while the new one slides in from the right,
       its parts rising one after the other; going back (a screen shown just before) slides the other way. The wordmark
       and the welcome's top bar stay where they are. A screen drawn again (an error said, a chip picked) doesn't move.
       Lite: the new screen only, a short slide. Calm: a fade;
     - the welcome steps' top bar, the board's: a Back arrow (js/welcome.js's V.welcome.back(), glass only), the progress
       as a thread that fills up to the step (it slides on from where it was), and "2 of 5". */
'use strict';

(() => {
const V = window.V;
if (!V) return;

const on = () => !!(V.look && V.look.isGlass());
const calm = () => !!(V.motion && V.motion.calm && V.motion.calm());
const lite = () => !!(V.motion && V.motion.lite && V.motion.lite());
const SLIDE = 'cubic-bezier(.25,1.18,.35,1)';
const EASE = 'cubic-bezier(.2,.8,.2,1)';
const HAS_WAAPI = typeof Element !== 'undefined' && typeof Element.prototype.animate === 'function';
const SVG = 'http://www.w3.org/2000/svg';
// The board's progress thread (220 x 12), measured as 100 long (pathLength).
const THREAD = 'M0 6 C 9 1, 18 11, 27.5 6 S 46 1, 55 6 S 73.5 11, 82.5 6 S 101 1, 110 6 S 128.5 11, 137.5 6 S 156 1, 165 6 S 183.5 11, 192.5 6 S 211 1, 220 6';
// What stays put while a screen slides: the wordmark and the welcome's top bar.
const STILL = ':scope > .gate-brand, :scope > .g-wel-top, :scope > .welcome-dots';
const STAYS = '.gate-brand, .g-wel-top, .welcome-dots';  // (the same, for matches(), where :scope is the element itself)

const animate = (el, frames, options) => {
  if (!el || !HAS_WAAPI) return null;
  try { return el.animate(frames, options); } catch (error) { return null; }
};
const titleOf = (box) => {
  const h = box && box.querySelector(':scope > h1');
  return h ? h.textContent.trim() : '';
};

/* ---------------------------------------------------------------- screen to screen */

const seen = [];      // the titles of the screens shown, oldest first (a title shown just before = going back)
let leaving = null;   // { rect, title } of the screen going
let ghost = null;

function dropGhost() { if (ghost) { ghost.remove(); ghost = null; } }

V.on('gate-leaving', ({ old }) => {
  leaving = null;
  if (!on() || !old) return;
  leaving = { rect: old.getBoundingClientRect(), title: titleOf(old) };
});

function rise(box, delay) {
  if (!V.motion || !V.motion.enter) return;
  V.motion.enter(box, { selector: `:scope > *:not(.gate-brand):not(.g-wel-top):not(.welcome-dots)`, delay, stagger: 50, max: 8 });
}

function slide(box, old, step, dir) {
  dropGhost();
  if (calm()) { animate(box, [{ opacity: 0 }, { opacity: 1 }], { duration: 120, easing: 'linear' }); return; }
  const moving = [...box.children].filter((el) => !el.matches(STAYS));
  if (lite()) {
    for (const el of moving) animate(el, [{ opacity: 0, transform: `translateX(${dir * 24}px)` }, { opacity: 1, transform: 'none' }], { duration: 180, easing: EASE });
    return;
  }
  const width = window.innerWidth || step.rect.width;
  ghost = document.createElement('div');
  ghost.className = 'g-gate-ghost';
  ghost.setAttribute('aria-hidden', 'true');
  ghost.inert = true;
  for (const el of old.querySelectorAll('[id]')) el.removeAttribute('id');
  for (const el of old.querySelectorAll('input, textarea, button, select, a')) el.tabIndex = -1;
  for (const el of old.querySelectorAll(STILL)) el.style.visibility = 'hidden';
  ghost.style.left = `${step.rect.left}px`;
  ghost.style.top = `${step.rect.top}px`;
  ghost.style.width = `${step.rect.width}px`;
  ghost.append(old);
  document.body.append(ghost);
  const mine = ghost;
  const gone = animate(mine, [{ transform: 'none', opacity: 1 }, { transform: `translateX(${-dir * width}px)`, opacity: 0.2 }],
    { duration: 460, easing: SLIDE, fill: 'forwards' });
  for (const el of moving) animate(el, [{ transform: `translateX(${dir * width}px)` }, { transform: 'none' }], { duration: 460, easing: SLIDE });
  rise(box, 120);
  const end = () => { if (ghost === mine) dropGhost(); else mine.remove(); };
  const sweep = () => {
    if (!mine.isConnected) return;
    if (gone && !document.hidden && (gone.playState === 'running' || gone.playState === 'paused')) { setTimeout(sweep, 700); return; }
    end();
  };
  if (gone) gone.finished.then(end, end);
  setTimeout(sweep, 700);
}

V.on('gate-screen', ({ box, old }) => {
  const step = leaving;
  leaving = null;
  if (!on() || !box) return;
  const title = titleOf(box);
  if (step && title && title === step.title) return;  // (the same screen drawn again: a problem said, a chip picked)
  let dir = 1;
  if (title && seen.length > 1 && seen[seen.length - 2] === title) { dir = -1; seen.pop(); } else if (title) seen.push(title);
  if (seen.length > 20) seen.splice(0, seen.length - 20);
  if (!step || !old) { if (!calm()) rise(box, 60); return; }
  slide(box, old, step, dir);
});

/* ---------------------------------------------------------------- the welcome steps' top bar */

let shownProgress = null;  // the share of the thread filled when it was last drawn (0 to 1)

function thread() {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('class', 'g-wel-thread');
  svg.setAttribute('viewBox', '0 0 220 12');
  svg.setAttribute('aria-hidden', 'true');
  for (const cls of ['g-wel-track', 'g-wel-fill']) {
    const path = document.createElementNS(SVG, 'path');
    path.setAttribute('class', cls);
    path.setAttribute('d', THREAD);
    path.setAttribute('pathLength', '100');
    svg.append(path);
  }
  return svg;
}

V.on('welcome-step', ({ at, of, back }) => {
  if (!on()) return;
  const box = document.querySelector('#app.gate > .gate-box');
  const dots = box && box.querySelector(':scope > .welcome-dots');
  if (!dots) return;
  const top = document.createElement('div');
  top.className = 'g-wel-top';
  const arrow = document.createElement('button');
  arrow.type = 'button';
  arrow.className = 'icon-btn g-wel-back';
  arrow.setAttribute('aria-label', 'Back a step');
  arrow.append(V.icon ? V.icon('back') : document.createTextNode('‹'));
  arrow.disabled = !back;
  arrow.addEventListener('click', () => { if (V.welcome && V.welcome.back) V.welcome.back(); });
  const count = document.createElement('span');
  count.className = 'g-wel-count';
  count.setAttribute('aria-hidden', 'true');  // (the dots say it: "Step 2 of 5: your classes")
  count.textContent = `${at + 1} of ${of}`;
  box.prepend(top);
  top.append(arrow, dots, count);
  const svg = thread();
  dots.append(svg);
  const fill = svg.querySelector('.g-wel-fill');
  const share = Math.max(0, Math.min(1, (at + 1) / of));
  fill.style.strokeDashoffset = String(100 - share * 100);
  if (shownProgress !== null && shownProgress !== share && !calm()) {
    animate(fill, [{ strokeDashoffset: 100 - shownProgress * 100 }, { strokeDashoffset: 100 - share * 100 }],
      { duration: lite() ? 200 : 600, easing: EASE });
  }
  shownProgress = share;
});
// ("You're all set": the thread full, as the last step's)
V.on('gate-screen', ({ box }) => {
  if (!on() || !box) return;
  const dots = box.querySelector(':scope > .welcome-dots');
  if (!dots || box.querySelector('.g-wel-top')) return;
  if (dots.getAttribute('aria-label') !== 'All steps done') return;
  const top = document.createElement('div');
  top.className = 'g-wel-top g-wel-done';
  box.prepend(top);
  top.append(dots);
  const svg = thread();
  dots.append(svg);
  const fill = svg.querySelector('.g-wel-fill');
  fill.style.strokeDashoffset = '0';
  if (shownProgress !== null && shownProgress < 1 && !calm()) {
    animate(fill, [{ strokeDashoffset: 100 - shownProgress * 100 }, { strokeDashoffset: 0 }], { duration: 600, easing: EASE });
  }
  shownProgress = null;
});

V.on('look', () => { dropGhost(); });

/* ---------------------------------------------------------------- a chip picked or put back

   js/welcome.js draws the step again when a chip is tapped, so the chip is a new one that is already lit (or already not): its
   stylesheet transition has nothing to go from. The chip tapped is remembered at the tap, and found again once the step is
   drawn (before it is painted): it springs up as it lights, and settles down as it goes out. Calm: nothing moves. */
let tappedChip = '';
let chipWatch = null;
function springChip() {
  const name = tappedChip;
  if (!name || calm() || !HAS_WAAPI) return;
  const now = [...document.querySelectorAll('.subject-chip')].find((c) => (c.dataset.name || c.textContent || '').trim() === name);
  if (!now || now.dataset.gSprung === name + '|' + now.classList.contains('on')) return;
  now.dataset.gSprung = name + '|' + now.classList.contains('on');
  tappedChip = '';
  if (chipWatch) { chipWatch.disconnect(); chipWatch = null; }
  const lit = now.classList.contains('on');
  const frames = lit
    ? [{ transform: 'scale(.9)' }, { transform: 'translateY(-4px) scale(1.06)', offset: 0.45 }, { transform: 'translateY(-2px)' }]
    : [{ transform: 'translateY(-2px)' }, { transform: 'scale(.95)', offset: 0.4 }, { transform: 'none' }];
  animate(now, frames, { duration: lite() ? 160 : 420, easing: SLIDE });
}
document.addEventListener('click', (event) => {
  if (!on()) return;
  const chip = event.target && event.target.closest ? event.target.closest('.subject-chip') : null;
  tappedChip = chip ? (chip.dataset.name || chip.textContent || '').trim() : '';
  if (!tappedChip) return;
  // (the step is drawn again by the app's own handler, which runs after this one: the new chip is found in the same task, by a
  // mutation callback, before anything is painted)
  const app = document.getElementById('app');
  if (!app || typeof MutationObserver !== 'function') return;
  if (chipWatch) chipWatch.disconnect();
  chipWatch = new MutationObserver(springChip);
  chipWatch.observe(app, { childList: true, subtree: true });
  setTimeout(() => { if (chipWatch) { chipWatch.disconnect(); chipWatch = null; } tappedChip = ''; }, 600);
}, true);

})();
