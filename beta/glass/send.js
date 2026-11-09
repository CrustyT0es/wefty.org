/* Wefty 2.0 "glass": the words you send fly into place (the 2.0 hotfix; the owner: "for sending an AI message I want there to
   be a slide out animation for the text"). Chat's box and Share's words box (js/chat.js, js/send.js) are not touched: this
   file reads what they do from outside, only while the glass look is on.

   When Send is pressed and the box is emptied (only then: a message that can't go yet stays in its box and nothing flies), a
   copy of the words lifts out of the box where they were; once the message is drawn in its new place (Chat: your bubble;
   Share: the new row in "Sent and received"), the copy slides up into it as the bubble's own copy forms round it, about
   400 ms with a spring that settles, and then the real one is shown. The box's placeholder fades back as the words leave,
   and Chat's "Thinking..." comes in after the bubble has landed. The real message is hidden only while its copy is shown
   (a style rule by its own name, so a redraw doesn't show it early), so it is never shown twice and never lost: a message
   that doesn't arrive in its place (the chat was left) just lets its copy fade, and words that go back into the box fly back
   into it (`back()`: the box holds the very words sent again; new words typed meanwhile don't count). Lite: shorter, no
   forming. Calm: nothing moves, the message fades in (120 ms).

   V.glass.fly.flying(key) says whether a message is still on its way (Chat's own entrance can leave its bubble alone). */
'use strict';

(() => {
const V = window.V;
if (!V) return;
const root = document.documentElement;
const HAS_WAAPI = typeof Element !== 'undefined' && typeof Element.prototype.animate === 'function';
const on = () => !!(V.look && V.look.isGlass());
const calm = () => root.classList.contains('calm');
const lite = () => root.classList.contains('lite');

const FLY_MS = 430;        // the flight
const LITE_MS = 240;
const WAIT_MS = 3000;      // how long the copy waits for the message to be drawn in its place
const FLIGHT = 'cubic-bezier(.2,1.12,.32,1)';  // (a spring that settles: a touch past, then still)
const EASE = 'cubic-bezier(.2,.8,.2,1)';

/* -- what is hidden while its copy flies: one <style>, by the message's own name */
let sheet = null;
const rules = new Map();
const flying = new Set();
function hide(key, css) {
  rules.set(key, css);
  paint();
}
function unhide(key) {
  if (!rules.delete(key)) return;
  paint();
}
function paint() {
  if (!sheet || !sheet.isConnected) {
    sheet = document.createElement('style');
    sheet.id = 'g-fly-rules';
    document.head.appendChild(sheet);
  }
  sheet.textContent = [...rules.values()].join('\n');
}

const zoomOf = () => { const b = document.body; return b && b.offsetWidth ? b.getBoundingClientRect().width / b.offsetWidth || 1 : 1; };
function animate(el, keyframes, options) {
  if (!el || !HAS_WAAPI) return null;
  try { return el.animate(keyframes, options); } catch (error) { return null; }
}

/* The words as they sit in `box` (a textarea): a copy over them, in their own look, where they are now. */
function lift(box) {
  const s = getComputedStyle(box);
  const r = box.getBoundingClientRect();
  const z = zoomOf();
  const copy = document.createElement('div');
  copy.className = 'g-fly-words';
  copy.setAttribute('aria-hidden', 'true');
  copy.textContent = box.value;
  Object.assign(copy.style, {
    position: 'fixed', left: `${r.left / z}px`, top: `${r.top / z}px`, width: `${r.width / z}px`, height: `${r.height / z}px`,
    margin: '0', boxSizing: 'border-box', overflow: 'hidden', pointerEvents: 'none', zIndex: '96',
    paddingTop: s.paddingTop, paddingRight: s.paddingRight, paddingBottom: s.paddingBottom, paddingLeft: s.paddingLeft,
    font: s.font, letterSpacing: s.letterSpacing, color: s.color, textAlign: s.textAlign,
    whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', background: 'transparent', border: '0',
  });
  document.body.appendChild(copy);
  copy.scrollTop = box.scrollTop;
  // (the box under it is empty now: its placeholder comes back as the words leave, not under them)
  const quiet = animate(box, [{ opacity: 0 }, { opacity: 0 }], { duration: WAIT_MS + FLY_MS, fill: 'forwards' });
  const lifted = { copy, box, quiet, at: performance.now(), rect0: { left: r.left, top: r.top }, flight: null, frame: 0 };
  follow(lifted);
  return lifted;
}

/* The copy keeps over its box: the on-screen keyboard going away, or the page being laid out again, moves the box while the
   message is on its way (the owner's recording: the words stayed where the box had been, under the last answer). Once the
   flight begins this same clock also keeps its end on the message's words, which scroll into place as it flies: the copy
   always lands where the real words are, whatever moved on the way. `lifted.flight` is { animation, target, shapeStuff }. */
function follow(lifted) {
  const place = () => {
    const { copy, box } = lifted;
    if (lifted.stopped || !copy.isConnected) return false;
    const z = zoomOf();
    let sx = 0, sy = 0;
    if (box.isConnected) {
      const r = box.getBoundingClientRect();
      sx = (r.left - lifted.rect0.left) / z;
      sy = (r.top - lifted.rect0.top) / z;
    }
    let x = sx, y = sy;
    const f = lifted.flight;
    // (the message's words are drawn again, as a new element, when the app redraws its list: found again, so the copy lands on the
    // ones that are there and not on a place where nothing is any more)
    if (f && !f.target.isConnected && lifted.find) {
      let again = null;
      try { again = lifted.find(); } catch (error) { /* it keeps the old one */ }
      if (again && again.isConnected) f.target = again;
    }
    if (f && f.target.isConnected) {
      const timing = f.animation && f.animation.effect && f.animation.effect.getComputedTiming ? f.animation.effect.getComputedTiming() : null;
      const e = timing && timing.progress != null ? timing.progress : 1;
      const tb = f.target.getBoundingClientRect();
      const ex = (tb.left + f.padLb * z - lifted.rect0.left - f.padLa * z) / z;
      const ey = (tb.top + f.padTb * z - lifted.rect0.top - f.padTa * z) / z;
      x = sx + (ex - sx) * e;
      y = sy + (ey - sy) * e;
      f.e = e;
      f.at = { x, y };
      if (f.shape) {
        // the bubble forming round the words: its words are where the copy's are (its first letter sits `k` in from its corner)
        f.shape.style.translate = `${(lifted.rect0.left / z + f.padLa + x) - (f.base.left / z + f.kx / z) }px ${(lifted.rect0.top / z + f.padTa + y) - (f.base.top / z + f.ky / z)}px`;
        if (f.clip && f.clip.isConnected) {
          // never over the box it came out of: what would hang below the box's top edge is cut off
          const edge = f.clip.getBoundingClientRect().top;
          const bottom = lifted.rect0.top + (f.padTa + y) * z - f.ky + f.height;   // (where its lower edge is now)
          const cut = Math.max(0, bottom - edge) / z;
          f.shape.style.clipPath = cut > 0 ? `inset(0 0 ${cut}px 0)` : 'none';
        }
      }
    }
    copy.style.translate = `${x}px ${y}px`;
    lifted.x = x; lifted.y = y;
    return true;
  };
  const step = () => {
    lifted.frame = 0;
    if (place()) lifted.frame = requestAnimationFrame(step);
  };
  lifted.place = place;   // (the flight puts the forming bubble where the words are the moment it is made, not a frame later)
  step();
}
function unfollow(lifted) {
  lifted.stopped = true;
  if (lifted.frame) cancelAnimationFrame(lifted.frame);
  lifted.frame = 0;
}

function settleBox(lifted, delay = 0) {
  const { box, quiet } = lifted;
  if (quiet) { try { quiet.cancel(); } catch (error) { /* gone */ } }
  if (box && box.isConnected && !calm()) animate(box, [{ opacity: 0 }, { opacity: 1 }], { duration: 260, delay, easing: EASE, fill: 'backwards' });
}

/* The copy fades where it is: the message didn't arrive in its place (it is back in its box, or its screen went). */
function letGo(lifted) {
  settleBox(lifted);
  const gone = () => { unfollow(lifted); lifted.copy.remove(); };
  const a = animate(lifted.copy, [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateY(-6px)' }],
    { duration: calm() ? 100 : 200, easing: EASE, fill: 'forwards' });
  if (a) a.finished.then(gone, gone); else gone();
}

/* The copy slides into `target` (the message's words in their new place, drawn, `hidden` until now by `key`'s rule), and the
   target's own copy forms round it; the real one is shown at the end, in the same frame both copies go. The flight is worked
   out again at every frame (`follow`) from where the box and the words are right then, so a chat that scrolls, a keyboard that
   goes away or a screen laid out again while it flies change nothing: the words land exactly on the real ones, in one
   continuous motion. `clip` (an element) is a line the forming bubble never crosses: it comes out of the box (Chat's), never
   drawn over its edge. If the words go back into the box while they fly (Chat drew the message, then found nothing to send it
   with), the copy turns round where it is and flies back into the box, whose words show again the moment it lands: never two
   copies apart, never none. */
function land(lifted, target, key, done, back, clip) {
  const { copy } = lifted;
  const z = zoomOf();
  const b = target.getBoundingClientRect();
  const sa = getComputedStyle(copy);
  const sb = getComputedStyle(target);
  const ms = lite() ? LITE_MS : FLY_MS;
  const shape = target.cloneNode(true);
  shape.classList.add('g-fly-shape');
  shape.setAttribute('aria-hidden', 'true');
  shape.removeAttribute('id');
  Object.assign(shape.style, {
    position: 'fixed', left: `${b.left / z}px`, top: `${b.top / z}px`, width: `${b.width / z}px`, height: `${b.height / z}px`,
    margin: '0', boxSizing: 'border-box', pointerEvents: 'none', zIndex: '95', maxWidth: 'none',
  });
  document.body.appendChild(shape);
  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    unfollow(lifted);
    unhide(key);
    shape.remove();
    copy.remove();
    flying.delete(key);
    if (done) done();
  };
  // (their progress is the eased clock `follow` reads: the copy's opacity, the bubble's opacity and size)
  const flight = animate(copy, [{ opacity: 1 }, { opacity: 0 }], { duration: ms, easing: FLIGHT, fill: 'forwards' });
  const formed = animate(shape, lite() ? [{ opacity: 0 }, { opacity: 1 }]
    : [{ transform: 'scale(.94)', opacity: 0 }, { opacity: 1, offset: 0.55 }, { transform: 'none', opacity: 1 }],
  { duration: ms, easing: FLIGHT, fill: 'both' });
  lifted.flight = {
    animation: flight || formed, target, shape, clip: clip || null, height: b.height, base: { left: b.left, top: b.top },
    padLa: parseFloat(sa.paddingLeft) || 0, padTa: parseFloat(sa.paddingTop) || 0,
    padLb: parseFloat(sb.paddingLeft) || 0, padTb: parseFloat(sb.paddingTop) || 0,
    kx: (parseFloat(sb.paddingLeft) || 0) * z, ky: (parseFloat(sb.paddingTop) || 0) * z,
  };
  if (lifted.place) lifted.place();
  settleBox(lifted, ms * 0.35);
  // (the words back in the box while they fly: turn round)
  const turn = () => {
    finished = true;
    const box = lifted.box;
    const f = lifted.flight;
    lifted.flight = null;
    const at = f && f.at ? f.at : { x: lifted.x || 0, y: lifted.y || 0 };
    const seen = Math.max(parseFloat(getComputedStyle(copy).opacity) || 0, parseFloat(getComputedStyle(shape).opacity) || 0);
    for (const a of [flight, formed]) { try { if (a) a.cancel(); } catch (error) { /* gone */ } }
    shape.remove();
    unhide(key);
    flying.delete(key);
    const held = box && box.isConnected ? (box.getAnimations().forEach((a) => { try { a.cancel(); } catch (error) { /* gone */ } }),
      animate(box, [{ opacity: 0 }, { opacity: 0 }], { duration: 2000, fill: 'forwards' })) : null;
    const home = () => { unfollow(lifted); copy.remove(); if (held) { try { held.cancel(); } catch (error) { /* gone */ } } };
    // (the copy was placed by `follow`; from here the way home is the same property's, to where its box is now)
    unfollow(lifted);
    const r = box && box.isConnected ? box.getBoundingClientRect() : null;
    const homeX = r ? (r.left - lifted.rect0.left) / z : 0;
    const homeY = r ? (r.top - lifted.rect0.top) / z : 0;
    copy.style.translate = `${at.x}px ${at.y}px`;
    const a = animate(copy, [{ translate: `${at.x}px ${at.y}px`, opacity: seen }, { translate: `${homeX}px ${homeY}px`, opacity: 1 }],
      { duration: lite() ? 180 : 320, easing: EASE, fill: 'forwards' });
    if (a) a.finished.then(home, home); else home();
    setTimeout(home, 800);
  };
  const watch = () => {
    if (finished) return;
    if (back && back()) { turn(); return; }
    requestAnimationFrame(watch);
  };
  if (back) requestAnimationFrame(watch);
  // (landed: the clock is done, and the copy has had its last frame on the words)
  const landed = flight || formed;
  if (landed) landed.finished.then(() => requestAnimationFrame(finish), finish); else finish();
  setTimeout(finish, ms + 400);  // (a page put out of sight holds its animations: the message is shown all the same)
}

/* A message about to be sent from `box` (called as Send is pressed, before the app's own handler runs): the copy lifts out at
   once and what will be the message's new place is hidden (`hidden`, a CSS selector), so nothing shows twice even when the
   app draws it in the same moment. Returns { go(find, back, after), cancel() }: go once the box is seen emptied (`find()`
   gives the message's words in their new place once drawn, or null; `back()` says it went back into its box), cancel when
   it wasn't (the message didn't go). */
function prepare({ box, key, hidden, clip }) {
  if (!on() || !box) return null;
  if (calm() || !HAS_WAAPI) {  // (nothing moves: the message fades in where it lands)
    return {
      go(find, back) {
        const start = performance.now();
        const look = () => {
          const target = find();
          if (target) { animate(target, [{ opacity: 0 }, { opacity: 1 }], { duration: 120, easing: 'linear' }); return; }
          if (performance.now() - start < WAIT_MS && !back()) requestAnimationFrame(look);
        };
        requestAnimationFrame(look);
      },
      cancel() {},
    };
  }
  const lifted = lift(box);
  flying.add(key);
  hide(key, `${hidden} { opacity: 0 !important; }`);
  animate(lifted.copy, [{ transform: 'none' }, { transform: 'translateY(-4px)' }], { duration: 180, easing: EASE, fill: 'forwards' });
  const drop = () => {
    unhide(key);
    flying.delete(key);
    letGo(lifted);
  };
  return {
    go(find, back, after) {
      lifted.find = find;
      const look = () => {
        if (!flying.has(key)) return;
        const target = find();
        if (target && target.getClientRects().length) { land(lifted, target, key, after, back, typeof clip === 'function' ? clip() : clip); return; }
        if (back() || performance.now() - lifted.at > WAIT_MS || !lifted.box.isConnected) { drop(); return; }
        requestAnimationFrame(look);
      };
      look();
    },
    cancel() {
      // (it didn't go: the words never left the box, so the copy simply goes and the box is as it was)
      unhide(key);
      flying.delete(key);
      if (lifted.quiet) { try { lifted.quiet.cancel(); } catch (error) { /* gone */ } }
      unfollow(lifted);
      lifted.copy.remove();
    },
  };
}

/* Everything flying taken away at once (another screen, the look switched off): the real messages are shown. */
function clear() {
  for (const key of [...flying]) unhide(key);
  flying.clear();
  rules.clear();
  if (sheet) sheet.textContent = '';
  document.querySelectorAll('.g-fly-words, .g-fly-shape').forEach((el) => el.remove());
}

/* ================================================================== Chat */

/* Send is pressed (its button, or Enter where Enter sends): what is in the box, and the turns already drawn. Read before
   js/chat.js's own handler (a listener that runs first), looked at again after it: the box is emptied only when the message
   goes (a message that has to wait for an answer to finish, or for its files, stays in the box). */
function chatBefore() {
  if (!on()) return;
  const box = document.querySelector('.chat-app textarea.chat-input');
  const text = box && box.value.trim();
  if (!text || box.disabled) return;
  const thread = document.querySelector('.chat-app .chat-thread');
  const had = new Set(thread ? [...thread.querySelectorAll(':scope > .chat-turn')].map((t) => t.dataset.turn) : []);
  const key = `chat:${Date.now().toString(36)}`;
  const old = [...had].map((id) => `[data-turn="${CSS.escape(id)}"]`).join(', ');
  // (any turn drawn from now on that wasn't there: the bubble and, under it, "Thinking...", until the words have landed)
  const flight = prepare({ box, key, hidden: `html[data-look="glass"] .chat-app .chat-thread > .chat-turn${old ? `:not(${old})` : ''} > :is(.chat-you, .chat-claude)`,
    clip: () => box.closest('.chat-box') || box });
  if (!flight) return;
  let turnId = '';
  const turnOf = () => {
    const now = document.querySelector('.chat-app .chat-thread');
    if (!now) return null;
    const turns = [...now.querySelectorAll(':scope > .chat-turn')];
    return (turnId ? turns.find((t) => t.dataset.turn === turnId)
      : turns.reverse().find((t) => !had.has(t.dataset.turn) && (t.querySelector(':scope > .chat-you .chat-you-text') || {}).textContent === text)) || null;
  };
  setTimeout(() => {
    if (!box.isConnected || box.value.trim()) { flight.cancel(); return; }  // (it didn't go: it has to wait, or files are going up)
    flight.go(() => {
      const turn = turnOf();
      if (!turn) return null;
      if (!turnId) {
        turnId = turn.dataset.turn;
        hide(key, `html[data-look="glass"] .chat-turn[data-turn="${CSS.escape(turnId)}"] > :is(.chat-you, .chat-claude) { opacity: 0 !important; }`);
      }
      return turn.querySelector(':scope > .chat-you .chat-you-text');
    }, () => box.value.trim() === text, () => {
      // "Thinking..." (or the first words, or Waiting to send) comes in under the bubble
      const turn = turnOf();
      const answer = turn && turn.querySelector(':scope > .chat-claude');
      if (answer) animate(answer, [{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'none' }], { duration: lite() ? 160 : 320, easing: EASE });
    });
  }, 0);
}
document.addEventListener('click', (event) => {
  const go = event.target && event.target.closest ? event.target.closest('.chat-app .chat-go') : null;
  if (go) chatBefore();
}, true);
document.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter' || event.shiftKey || event.isComposing || !event.target || !event.target.matches) return;
  if (event.target.matches('.chat-app textarea.chat-input')) chatBefore();
}, true);

/* ================================================================== Share's words */

/* Send (or Ctrl+Enter) with words in Share's box: they fly into the new row of "Sent and received". */
function shareBefore() {
  if (!on()) return;
  const box = document.querySelector('.view[data-tab=send] .send-card textarea.send-text');
  const text = box && box.value.trim();
  if (!text) return;
  const list = document.querySelector('.view[data-tab=send] .transfers');
  const had = new Set(list ? [...list.querySelectorAll(':scope > .transfer')].map((t) => t.dataset.id || t.dataset.group || '') : []);
  const key = `share:${Date.now().toString(36)}`;
  const keep = [...had].filter(Boolean).map((id) => `:not([data-id="${CSS.escape(id)}"], [data-group="${CSS.escape(id)}"])`).join('');
  // (only the row's words: the row itself rises in round them, glass/share.js)
  const flight = prepare({ box, key, hidden: `html[data-look="glass"] .view[data-tab=send] .transfers > .transfer${keep} .t-name` });
  if (!flight) return;
  const rowOf = () => {
    const now = document.querySelector('.view[data-tab=send] .transfers');
    return now ? [...now.querySelectorAll(':scope > .transfer')].find((t) => !had.has(t.dataset.id || t.dataset.group || '')) || null : null;
  };
  setTimeout(() => {
    if (!box.isConnected || box.value.trim()) { flight.cancel(); return; }
    flight.go(() => { const row = rowOf(); return row ? row.querySelector('.t-name') : null; }, () => box.value.trim() === text);
  }, 0);
}
document.addEventListener('click', (event) => {
  const button = event.target && event.target.closest ? event.target.closest('.view[data-tab=send] .send-row .btn.primary') : null;
  if (button) shareBefore();
}, true);
document.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter' || !(event.ctrlKey || event.metaKey) || event.isComposing || !event.target || !event.target.matches) return;
  if (event.target.matches('.view[data-tab=send] textarea.send-text')) shareBefore();
}, true);

V.on('tab', clear);
V.on('look', () => { if (!on()) clear(); });

V.glass = V.glass || {};
V.glass.fly = { flying: (key) => (key ? flying.has(key) : flying.size > 0), clear };
})();
