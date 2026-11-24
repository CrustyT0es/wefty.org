/* Wefty 2.0 "glass", area: Overlays. This file belongs to the Overlays builder; nobody else edits it.
   What floats over the app beyond what ui/overlay.js does: since 2.0's overlays lane, opening, placing, leaving and
   taking away every sheet, menu, dialog, toast and drop-down is ui/overlay.js's (V.overlay, called by js/util.js's
   builders). What's left here:
     - the message card (V.messageCard): an error that needs more than a line (it has a Help button or another button,
       or is long) is shown as a card in #toasts: an icon chip, a bold first line, one plain sentence, one purple button
       and a close mark. The error's own words are never changed (but a browser's raw "Failed to fetch": V.plainError);
       one error at a time (a newer one takes the place of the ones still showing), three cards at most;
     - segmented controls get the board's sliding highlight (V.overlays.segmented(el) does the same for any other
       .segmented), and ticked boxes pop;
     - the note-taker's bar comes down from the top as it appears.
   V.messageCard({ icon, title, text, action: { label, onClick }, secondary: { label, onClick }, onClose, kind, ms }) returns
   { el, close() }. */
'use strict';

(() => {
const V = window.V;
if (!V) return;
const root = document.documentElement;
const SLIDE = 'cubic-bezier(.25,1.18,.35,1)';
const HAS_WAAPI = typeof Element !== 'undefined' && typeof Element.prototype.animate === 'function';

const calm = () => root.classList.contains('calm');
const lite = () => root.classList.contains('lite');

/* One running animation per element and job: a new one cancels the old (so everything can start again at once). */
const running = new WeakMap();
function play(el, keyframes, options, job = 'overlay') {
  if (!el || !HAS_WAAPI) return null;
  const jobs = running.get(el) || {};
  running.set(el, jobs);
  if (jobs[job]) { try { jobs[job].cancel(); } catch (error) { /* gone */ } }
  let animation = null;
  try { animation = el.animate(keyframes, options); } catch (error) { return null; }
  jobs[job] = animation;
  animation.finished.then(() => { if (jobs[job] === animation) delete jobs[job]; }, () => {});
  return animation;
}

/* ================================================================== the message card */

/* The Help card an error belongs to (js/help.js's V.help.forError says which): the card's first line and its icon. Only
   what is shown over the error's own sentence, which is never changed. */
const CARDS = {
  'storage-full': ['Storage full', 'file'],
  'sign-in-check': ['Sign-in check', 'lock'],
  move: ['Move to wefty.org', 'alert'],
  gemini: ['Gemini key', 'key'],
  'ai-trouble': ['AI unavailable', 'spark'],
  notifications: ['Notifications', 'bell'],
  'too-big': ['Note too big', 'cloud'],
  'file-too-big': ['File too big', 'file'],
  asleep: ['Cloud asleep', 'cloud'],
  'signed-out': ['Signed out', 'lock'],
  'forgot-password': ['Sign-in', 'key'],
  offline: ['Offline', 'cloud'],
  update: ['Update needed', 'download'],
};
const PLAIN_TITLE = 'Something went wrong';
/* Cards that say where things stand rather than that something broke: amber, with no red flash of the edge light. */
const WARN = new Set(['offline', 'asleep', 'too-big', 'file-too-big', 'signed-out', 'update']);

function messageCard({ icon = 'alert', title = '', text = '', action = null, secondary = null, onClose = null, kind = 'err', ms = 6500 } = {}) {
  const box = document.getElementById('toasts');
  if (!box) return null;
  let closed = false;
  let timer = 0;
  let held = false;
  const wait = () => { clearTimeout(timer); if (!held && !closed) timer = setTimeout(() => close(), ms); };
  function close() {
    if (closed) return;
    closed = true;
    clearTimeout(timer);
    // (it goes as itself: ui/overlay.js)
    if (V.overlay) V.overlay.leaveCard(el); else el.remove();
    if (onClose) { try { onClose(); } catch (error) { console.error(error); } }
  }
  const button = (spec, cls) => V.h('button.toast-action.' + cls + (spec.help && !cls.includes('toast-help') ? '.toast-help' : ''), {
    type: 'button', text: spec.label,
    onclick: () => { try { if (spec.onClick) spec.onClick(); } finally { close(); } },
  });
  const actions = [];
  if (action && action.label) actions.push(button(action, 'mc-go'));
  if (secondary && secondary.label) actions.push(button(secondary, actions.length ? 'toast-help.mc-more' : 'mc-go.toast-help'));
  const el = V.h('div.toast.msg-card' + (kind === 'err' || kind === 'warn' ? '.err' : '') + (kind === 'warn' ? '.warn' : ''), { role: 'status' },
    V.h('span.mc-chip', {}, V.icon(icon)),
    V.h('div.mc-body', {},
      title ? V.h('strong.mc-title', { text: title }) : null,
      V.h('span.mc-text', { text }),
      actions.length ? V.h('div.mc-actions', {}, actions) : null),
    V.iconButton('x', 'Close', () => close(), 'quiet.mc-x'));
  el.addEventListener('mouseenter', () => { held = true; clearTimeout(timer); });
  el.addEventListener('mouseleave', () => { held = el.contains(document.activeElement); wait(); });
  el.addEventListener('focusin', () => { held = true; clearTimeout(timer); });
  el.addEventListener('focusout', (event) => { if (!el.contains(event.relatedTarget)) { held = el.matches(':hover'); wait(); } });
  if (V.overlay && !box.querySelector(':scope > .toast, :scope > .notice')) V.overlay.slot(box);
  box.append(el);
  if (V.overlay) V.overlay.card(el);
  const all = box.querySelectorAll(':scope > .toast');  // (three at most)
  for (let i = 0; i < all.length - 3; i++) all[i].remove();
  wait();
  if (kind === 'err') V.emit('edge', 'error');  // (the edge light's soft red flash, once. A warning has none)
  return { el, close };
}
V.messageCard = messageCard;

/* V.toast: an error toast that needs more than a line becomes the message card. The rest are the app's own toasts
   (where they sit, how they stack and go: ui/overlay.js). */
const plainToast = V.toast;
V.toast = function toast(text, options = {}) {
  const o = options || {};
  if (V.plainError) text = V.plainError(text);  // (1.22.6: never a raw "Failed to fetch", on the card either)
  const helps = !!o.help && !!(V.help && V.help.open);
  // One error at a time. A newer error takes the place of the ones still showing (a key typed wrong three times
  // stacked three cards over the sheet, its Save under them); the other toasts (an Undo) stay.
  if (o.kind === 'err') {
    const box = document.getElementById('toasts');
    for (const old of box ? [...box.querySelectorAll(':scope > .toast.err:not(.leaving)')] : []) {
      const x = old.querySelector(':scope > .mc-x');
      if (x) { x.click(); continue; }  // (a message card closes itself: its own leaving and onClose)
      if (V.overlay) V.overlay.leaveCard(old); else old.remove();
    }
  }
  if (o.kind === 'err' && typeof text === 'string' && (helps || o.action || text.length > 60)) {
    try {
      const [title, icon] = (helps && CARDS[o.help]) || [PLAIN_TITLE, 'alert'];
      const helpSpec = helps ? { label: 'Help', help: true, onClick: () => V.help.open({ card: o.help }) } : null;
      const own = o.action ? { label: o.action, onClick: o.onAction } : null;
      messageCard({ icon, title, text, action: own || helpSpec, secondary: own ? helpSpec : null,
        kind: helps && WARN.has(o.help) ? 'warn' : 'err', ms: Math.max(Number(o.ms) || 0, 6500) });
      return undefined;
    } catch (error) { console.error(error); }
  }
  return plainToast.call(this, text, options);
};

/* ================================================================== segmented controls: the sliding highlight */

const segs = new WeakMap();
function segmented(seg) {
  if (!seg || seg.nodeType !== 1 || segs.has(seg) || !seg.classList.contains('segmented')) return;
  const hl = document.createElement('span');
  hl.className = 'g-seg-hl g-still';
  hl.setAttribute('aria-hidden', 'true');
  hl.appendChild(document.createElement('i'));
  seg.classList.add('g-seg');
  seg.prepend(hl);
  const state = { hl, last: '', flip: 0, observer: null, resize: null };
  segs.set(seg, state);
  const picked = () => [...seg.children].find((b) => b.tagName === 'BUTTON'
    && (b.getAttribute('aria-checked') === 'true' || b.getAttribute('aria-selected') === 'true' || b.classList.contains('on')));
  const place = (still) => {
    const b = picked();
    if (!b || !b.offsetWidth) { hl.style.opacity = '0'; return; }
    hl.style.opacity = '';
    const key = [b.offsetLeft, b.offsetTop, b.offsetWidth, b.offsetHeight].join();
    if (key === state.last) return;
    const first = !state.last;
    state.last = key;
    hl.style.width = b.offsetWidth + 'px';
    hl.style.height = b.offsetHeight + 'px';
    if (still || first) hl.classList.add('g-still'); else hl.classList.remove('g-still');
    hl.style.transform = `translate(${b.offsetLeft}px, ${b.offsetTop}px)`;
    if (still || first) {
      requestAnimationFrame(() => requestAnimationFrame(() => hl.classList.remove('g-still')));
    } else {
      state.flip ^= 1;  // (the little stretch can start again at once)
      hl.classList.remove('g-sa', 'g-sb');
      void hl.offsetWidth;
      hl.classList.add(state.flip ? 'g-sa' : 'g-sb');
    }
  };
  state.place = place;
  state.observer = new MutationObserver((records) => {
    if (records.every((r) => r.target === hl || hl.contains(r.target))) return;
    if (!seg.contains(hl)) seg.prepend(hl);
    place(false);
  });
  state.observer.observe(seg, { attributes: true, attributeFilter: ['aria-checked', 'aria-selected', 'class'], subtree: true, childList: true });
  if (typeof ResizeObserver !== 'undefined') {
    state.resize = new ResizeObserver(() => { state.last = ''; place(true); });
    state.resize.observe(seg);
  }
  place(true);
}
V.overlays = { segmented, messageCard };

/* ================================================================== ticked boxes pop */

document.addEventListener('change', (event) => {
  const box = event.target;
  if (!box || box.tagName !== 'INPUT' || box.type !== 'checkbox' || !box.matches('.covers-tick, .nt-never-box, input[name="terms"]')) return;
  if (box.checked && V.motion && V.motion.press) V.motion.press(box, { scale: 0.86 });
});

/* ================================================================== what comes into #layers */

/* Segmented controls in what opens (a sheet, a screen) slide; the note-taker's bar comes down from the top as it appears,
   a soft spring (calm: it fades in). */
function start() {
  const layers = document.getElementById('layers');
  if (!layers) return;
  new MutationObserver((records) => {
    for (const record of records) {
      for (const node of record.addedNodes) {
        if (node.nodeType !== 1) continue;
        if (record.target === layers && node.classList.contains('nt-strip')) {
          play(node, calm() ? [{ opacity: 0 }, { opacity: 1 }] : [{ transform: 'translateY(-100%)', opacity: 0.4 }, { transform: 'none', opacity: 1 }],
            { duration: calm() ? 120 : lite() ? 180 : 420, easing: calm() ? 'linear' : SLIDE }, 'strip');
          continue;
        }
        if (node.classList.contains('segmented')) segmented(node);
        for (const seg of node.querySelectorAll ? node.querySelectorAll('.segmented') : []) segmented(seg);
      }
    }
  }).observe(layers, { childList: true, subtree: true });
  for (const seg of layers.querySelectorAll('.segmented')) segmented(seg);
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
