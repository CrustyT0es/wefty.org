/* Wefty 2.0 "glass", area: Chat. This file belongs to the Chat builder; nobody else edits it.
   Chat (js/chat.js, chattools.js): the chat list, messages and the box, the agent's action list, attached notes.
   Rules (vault/web/glass/README.md has the rest): everything here is inert unless V.look.isGlass() (and listen to V.on('look') so the switch works live); use the tokens in
   glass.css (--g-*, and the app's own names, which glass redefines); only transform and opacity animate; call
   V.motion's helpers instead of writing your own; nothing here changes the classic look.

   What this file does (the look itself is chat.css; js/chat.js draws everything, as in the classic look):
     - words landing (GlassChat.dc.html "typing word by word"): js/chat.js draws an answer again each frame while it comes
       in, so what has just arrived is found by its length and each new word is wrapped in a span.g-word that rises 3 px
       as it fades in, one after the other (at most 600 ms for a piece, never out of order). The spans are gone at the
       next frame's drawing, so they're made again with the time they had left (a negative animation-delay): nothing
       restarts or jumps. A caret blinks after the last word while it writes;
     - thinking: the three shimmering lines keep one clock across redraws (their delay is the page's clock), so they
       never jump back;
     - an answer that lands (answering -> done): its buttons, the agent's list and the sources rise in (V.motion.enter);
       the edge light runs once when Chat changed something in Wefty (V.emit('edge', 'saved'));
     - a message sent: your bubble rises in, then the answer's "Thinking..." under it; a chat opened: its last messages
       rise in one after the other;
     - the model's name in the box rises in when it changes (the board's model switch).
   Calm: none of it (a word, a message or a name simply appears). Lite: the same, shorter (chat.css). */
'use strict';

(() => {
const V = window.V;
if (!V) return;

const on = () => !!(V.look && V.look.isGlass());
const calm = () => !!(V.motion && V.motion.calm && V.motion.calm());
const lite = () => !!(V.motion && V.motion.lite && V.motion.lite());
const clock = () => (window.performance && performance.now ? performance.now() : Date.now());

const WORD_MS = 260;   // a word's rise (chat.css .g-word)
const STAGGER = 28;    // between words of one piece (less for a long piece: a piece is shown in at most SPREAD)
const SPREAD = 600;

let app = null;        // the .chat-app being watched
let observer = null;
let swapWatch = null;  // (the class of .chat-app: a phone's list <-> chat)
let showingNow = false;
let place = '';        // the chat drawn last (.chat-scroll's data-place)
const turns = new Map();  // turn id -> { state, len, pieces: [{ start, end, at, step }], ids }
let nameShown = '';

/* The text an answer has so far: its text nodes in order (never inside code, a Copy button or the thinking row). */
function textNodes(body) {
  const out = [];
  if (!body) return out;
  const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) => (node.parentElement && node.parentElement.closest('pre, code, button, .chat-thinking') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  });
  for (let node = walker.nextNode(); node; node = walker.nextNode()) out.push(node);
  return out;
}

/* Each word of [start, end) in a span that rises in, `delayOf(i)` ms from now (negative: it began that long ago). */
function wrapWords(nodes, start, end, delayOf) {
  let pos = 0;
  const found = [];
  for (const node of nodes) {
    const len = node.data.length;
    const a = Math.max(start, pos);
    const b = Math.min(end, pos + len);
    if (a < b) {
      const re = /\S+/g;
      const text = node.data.slice(a - pos, b - pos);
      for (let m = re.exec(text); m; m = re.exec(text)) found.push({ node, from: a - pos + m.index, to: a - pos + m.index + m[0].length });
    }
    pos += len;
  }
  // (the last word first: splitting a node at a later place leaves the earlier offsets where they were)
  found.forEach((w, i) => { w.i = i; });
  for (const w of found.reverse()) {
    let piece = w.node;
    if (w.to < piece.data.length) piece.splitText(w.to);
    if (w.from > 0) piece = piece.splitText(w.from);
    const span = document.createElement('span');
    span.className = 'g-word';
    span.style.animationDelay = `${Math.round(delayOf(w.i))}ms`;
    piece.replaceWith(span);
    span.append(piece);
  }
}

function caret(nodes) {
  const last = nodes[nodes.length - 1];
  if (!last || !last.parentNode) return;
  const mark = document.createElement('span');
  mark.className = 'g-caret';
  mark.setAttribute('aria-hidden', 'true');
  (last.parentElement && last.parentElement.classList.contains('g-word') ? last.parentElement : last).after(mark);
}

/* An answer still coming in, as js/chat.js has just drawn it. */
function writing(turn, was) {
  const body = turn.querySelector('.chat-claude > .chat-reply-body:not(.chat-partial)');
  const nodes = textNodes(body);
  const len = nodes.reduce((sum, n) => sum + n.data.length, 0);
  const now = clock();
  const pieces = (was && was.pieces) || [];
  if (was && was.state === 'answering' && len > was.len && !calm()) {
    const prev = pieces[pieces.length - 1];
    const words = (nodes.map((n) => n.data).join('').slice(was.len, len).match(/\S+/g) || []).length || 1;
    const step = Math.min(lite() ? 10 : STAGGER, SPREAD / words);
    const at = Math.max(now, prev ? prev.at + prev.words * prev.step : now);  // (after the piece before has shown)
    pieces.push({ start: was.len, end: len, at, step, words });
  }
  const live = pieces.filter((p) => now - (p.at + p.words * p.step) < WORD_MS + 40 && p.end <= len);
  for (const p of [...live].reverse()) wrapWords(textNodes(body), p.start, p.end, (i) => p.at + i * p.step - now);
  if (len) caret(textNodes(body));
  // (the shimmer of "Thinking..." keeps the page's clock: drawn again, it goes on where it was)
  for (const lines of turn.querySelectorAll('.chat-think-lines')) lines.style.setProperty('--g-shimmer-at', `${-Math.round(now % 1200)}ms`);
  return { state: 'answering', len, pieces: live };
}

/* An answer that has just finished: what came with it rises in under the words. */
function landed(turn) {
  if (!V.motion || !V.motion.enter) return;
  V.motion.enter(turn, { selector: '.chat-claude > :is(.chat-note, .chat-actions-done, .chat-sources, .chat-actions)', stagger: 70, max: 4 });
  if (turn.querySelector('.chat-action:not(.undone):not(.ask)')) V.emit('edge', 'saved');
}

/* A message just sent: the bubble, then "Thinking..." under it. */
function sent(turn) {
  if (!V.motion || !V.motion.enter) return;
  // (glass/send.js flies the words into the bubble and brings "Thinking..." in after they land: this rise would play on the
  // bubble a second time as it is shown, the hotfix agent's note)
  if (V.glass && V.glass.fly && V.glass.fly.flying()) return;
  V.motion.enter(turn, { selector: ':scope > .chat-you, :scope > .chat-claude', stagger: 110, max: 2 });
}

function look(mutations) {
  if (!on() || !app || !app.isConnected) return;
  const thread = app.querySelector('.chat-thread');
  const scroll = app.querySelector('.chat-scroll');
  const now = scroll ? scroll.dataset.place || '' : '';
  const added = new Set();
  let nameChanged = false;
  for (const m of mutations) {
    for (const node of m.addedNodes) if (node.nodeType === 1 && node.classList.contains('chat-turn') && node.parentNode === thread) added.add(node);
    const target = m.target.nodeType === 1 ? m.target : m.target.parentElement;
    if (target && target.closest && target.closest('.chat-model-name')) nameChanged = true;
  }
  if (nameChanged) {
    const name = app.querySelector('.chat-model-name');
    const words = name ? name.textContent : '';
    if (name && nameShown && words !== nameShown && !calm() && name.animate) {
      name.animate([{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'none' }],
        { duration: lite() ? 160 : 360, easing: V.motion ? V.motion.SPRING : 'ease-out' });
    }
    nameShown = words;
  }
  if (!added.size) return;
  const opened = now !== place;
  if (opened) {
    place = now;
    turns.clear();
    if (V.motion && V.motion.enter && thread && !calm()) V.motion.enter(thread, { selector: ':scope > .chat-turn, :scope > .chat-empty', stagger: 50, max: 5 });
  }
  for (const turn of added) {
    const id = turn.dataset.turn;
    if (!id) continue;
    const was = turns.get(id);
    const state = turn.dataset.state || '';
    if (state === 'answering') turns.set(id, writing(turn, was || (opened ? null : { state: 'new', len: 0, pieces: [] })));
    else turns.set(id, { state, len: 0, pieces: [] });
    if (opened) continue;
    if (!was) sent(turn);
    else if (was.state === 'answering' && (state === 'done' || state === 'cut')) landed(turn);
  }
}

/* A phone shows the list of chats or one chat, never both: the one that comes in slides in from its side on the spring (a
   chat from the right, the list from the left), as Settings' pages do, so a tap never changes the screen in one frame.
   Wide shows both: nothing moves. Calm: a short fade. */
let attachedAt = 0;
let touchedAt = 0;       // the last press or key (a tap on a chat moves the screens at once, however soon after arriving)
for (const type of ['pointerdown', 'keydown']) document.addEventListener(type, () => { touchedAt = performance.now(); }, true);
function swap() {
  if (!on() || !app || !app.isConnected) return;
  const showing = app.classList.contains('showing-chat');
  if (showing === showingNow) return;
  showingNow = showing;
  // (round 4: Chat arriving from another tab, its list or its chat chosen as it's drawn, is simply there: only a tap moves)
  if (touchedAt < attachedAt && performance.now() - attachedAt < 600) return;
  const side = app.querySelector(':scope > .chat-side');
  const pane = app.querySelector(':scope > .chat-pane');
  if (!side || !pane) return;
  const sideShown = getComputedStyle(side).display !== 'none';
  const paneShown = getComputedStyle(pane).display !== 'none';
  if (sideShown === paneShown) return;   // (wide shows both)
  const el = showing ? pane : side;
  if (typeof el.animate !== 'function') return;
  if (calm()) { el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 120, easing: 'linear' }); return; }
  const dx = showing ? 36 : -36;
  el.animate([{ opacity: 0, transform: `translateX(${dx}px)` }, { opacity: 1, transform: 'none' }],
    { duration: lite() ? 180 : 420, easing: lite() ? 'ease-out' : (V.motion ? V.motion.SPRING : 'ease-out') });
}

/* The conversation stays where it is while the on-screen keyboard rises or goes (the owner's recording: the screen shrank
   under the answer, the foot of it went behind the box, and the chat jumped). A chat read at its foot keeps the same words
   at its foot: when the screen's size changes, the thread is moved by what its room changed, in the same frame as the
   change, so what was in sight is still in sight. Only a thread within a few lines of its end: one scrolled up is left. */
let footGap = 0;       // how far the thread's foot was below what was showing, the last time anyone scrolled it
let resized = 0;       // when the screen's size last changed (scrolls just after it are the browser's own)
function remember(event) {
  if (!on() || performance.now() - resized < 250) return;
  const sc = event.target;
  if (sc && sc.classList && sc.classList.contains('chat-scroll')) footGap = sc.scrollHeight - sc.clientHeight - sc.scrollTop;
}
function resizing() {
  if (!on() || !app || !app.isConnected) return;
  const sc = app.querySelector('.chat-scroll');
  if (!sc || !sc.isConnected || footGap > 160) return;
  resized = performance.now();
  const keep = () => { sc.scrollTop = sc.scrollHeight - sc.clientHeight - footGap; };
  keep();
  requestAnimationFrame(keep);
}
document.addEventListener('scroll', remember, true);
window.addEventListener('resize', resizing);
if (window.visualViewport) window.visualViewport.addEventListener('resize', resizing);

/* (round 4, the owner: "the typing box doesn't float") The box floats over the foot of the conversation (glass/chat.css
   lays the composer over the scroller). Measured whenever the composer's size changes (a line more, a picture, the notice,
   the bar of words picked): the thread leaves that much room under its last words, plus FADE, so a chat read to its end
   shows its last words whole above the box; and the scroller's mask fades the words out over the FADE px before the box,
   shows them faint through it (blurred by its glass) and hides them in the gap under it. A thread at its end stays at
   its end. Only inline styles on the thread and the scroller change (neither is inherited): nothing else is restyled. */
const FADE = 40;
let floatWatch = null;
function float() {
  if (!on() || !app || !app.isConnected) return;
  const pane = app.querySelector(':scope > .chat-pane');
  const scroll = pane && pane.querySelector(':scope > .chat-scroll');
  const thread = scroll && scroll.querySelector(':scope > .chat-thread');
  const composer = pane && pane.querySelector(':scope > .chat-composer');
  if (!thread || !composer || !composer.getClientRects().length || getComputedStyle(composer).position !== 'absolute') return;
  const shown = [...composer.children].filter((el) => !el.hidden && el.getClientRects().length);
  const box = composer.querySelector(':scope > .chat-box');
  if (!shown.length || !box) return;
  // (offsets, never screen rectangles: the same with the page zoomed)
  const foot = scroll.offsetTop + scroll.offsetHeight;
  const top = composer.offsetTop + Math.min(...shown.map((el) => el.offsetTop));
  const under = Math.max(0, Math.round(foot - top));
  const below = Math.max(0, Math.round(foot - (composer.offsetTop + box.offsetTop + box.offsetHeight)));
  const room = `${under + FADE}px`;
  const mask = `linear-gradient(to top, transparent ${below}px, rgba(0, 0, 0, .72) ${under}px, #000 ${under + FADE}px)`;
  const atEnd = scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight < 2;
  if (thread.style.paddingBottom !== room) thread.style.paddingBottom = room;
  if (scroll.dataset.gMask !== mask) {
    scroll.dataset.gMask = mask;
    scroll.style.webkitMaskImage = mask;
    scroll.style.maskImage = mask;
  }
  if (atEnd && scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight >= 2) scroll.scrollTop = scroll.scrollHeight;
}
function unfloat(root) {
  if (!root) return;
  const scroll = root.querySelector('.chat-scroll');
  const thread = root.querySelector('.chat-thread');
  if (thread) thread.style.paddingBottom = '';
  if (scroll) { scroll.style.webkitMaskImage = ''; scroll.style.maskImage = ''; delete scroll.dataset.gMask; }
}
/* (round 4) The row under the words is never wider than the box: where Attach, the model, Think, Web and Send don't fit
   on one line (a narrow phone with bigger text), Think and Web leave the row (.g-tight) and are two switches in the model's
   sheet instead, and a dot on the model's chip says when one of them is on. Nothing changes where they fit. */
let toolsWatch = null;
function fitTools() {
  if (!on() || !app || !app.isConnected) return;
  const box = app.querySelector('.chat-pane > .chat-composer > .chat-box');
  const row = box && box.querySelector(':scope > .chat-tools');
  const model = row && row.querySelector(':scope > .chat-model');
  if (!row || !model || !row.getClientRects().length) return;
  const toggles = [...row.querySelectorAll(':scope > .chat-toggle')].filter((t) => !t.hidden);
  const tight = box.classList.contains('g-tight');
  let want = false;
  if (toggles.length) {
    const gap = parseFloat(getComputedStyle(row).columnGap) || 0;
    const size = parseFloat(getComputedStyle(app).getPropertyValue('--ch-size')) || 36;
    // (tight, the two are out of the row: what it would need with them back)
    want = row.scrollWidth + (tight ? toggles.length * (size + gap) : 0) > row.clientWidth + 0.5;
  }
  if (want !== tight) box.classList.toggle('g-tight', want);
  const lit = want ? toggles.filter((t) => t.getAttribute('aria-pressed') === 'true').length : 0;
  if ((model.dataset.gOn || '0') !== String(lit)) model.dataset.gOn = String(lit);
}
function modelSheetSwitches(event) {
  if (!on() || !app) return;
  const model = event.target && event.target.closest ? event.target.closest('.chat-app .chat-model') : null;
  const box = model && model.closest('.chat-box');
  if (!box || !box.classList.contains('g-tight')) return;
  const sheets = [...document.querySelectorAll('#layers .sheet')].filter((s) => s.querySelector('.model-choices'));
  const sheet = sheets[sheets.length - 1];
  const choices = sheet && sheet.querySelector('.model-choices');
  if (!choices || sheet.querySelector('.g-model-toggles')) return;
  const rows = [...box.querySelectorAll('.chat-tools > .chat-toggle')].filter((t) => !t.hidden).map((button) => {
    const name = (button.querySelector('span:not(.icon)') || {}).textContent || button.title;
    const input = V.h('input.switch', { type: 'checkbox', checked: button.getAttribute('aria-pressed') === 'true',
      onchange: () => { button.click(); input.checked = button.getAttribute('aria-pressed') === 'true'; fitTools(); } });
    return V.h('label.g-model-toggle', {}, V.h('span.g-model-toggle-text', {}, V.h('span.g-model-toggle-name', { text: name }),
      V.h('span.g-model-toggle-about', { text: button.title })), input);
  });
  if (rows.length) choices.after(V.h('div.g-model-toggles', {}, rows));
}
document.addEventListener('click', modelSheetSwitches);

function watchFloat() {
  if (floatWatch) floatWatch.disconnect();
  if (toolsWatch) toolsWatch.disconnect();
  floatWatch = null;
  toolsWatch = null;
  const composer = app && app.querySelector('.chat-pane > .chat-composer');
  if (!composer) return;
  const step = () => { float(); fitTools(); };
  step();
  if (typeof ResizeObserver !== 'function') return;
  floatWatch = new ResizeObserver(step);
  floatWatch.observe(composer);
  const model = composer.querySelector('.chat-model');
  if (model) floatWatch.observe(model);  // (a model's name of another length)
  if (typeof MutationObserver !== 'function') return;
  toolsWatch = new MutationObserver(fitTools);  // (Think and Web shown for Claude, pressed or not)
  const row = composer.querySelector('.chat-tools');
  if (row) toolsWatch.observe(row, { attributes: true, subtree: true, attributeFilter: ['hidden', 'aria-pressed'] });
}

function attach() {
  if (!on()) return detach();
  const now = document.querySelector('.chat-app');
  if (!now || now === app) return;
  detach();
  app = now;
  place = '';
  nameShown = (app.querySelector('.chat-model-name') || {}).textContent || '';
  showingNow = app.classList.contains('showing-chat');
  attachedAt = performance.now();
  footGap = 0;
  watchFloat();
  if (typeof MutationObserver !== 'function') return;
  swapWatch = new MutationObserver(swap);
  swapWatch.observe(app, { attributes: true, attributeFilter: ['class'] });
  observer = new MutationObserver(look);
  observer.observe(app, { childList: true, subtree: true, characterData: true });
  const scroll = app.querySelector('.chat-scroll');
  place = scroll ? scroll.dataset.place || '' : '';
  // (what's drawn already is known: the screen's own entrance brought it in, and a redraw of it moves nothing)
  for (const turn of app.querySelectorAll('.chat-thread > .chat-turn')) {
    if (turn.dataset.turn) turns.set(turn.dataset.turn, { state: turn.dataset.state || '', len: turn.dataset.state === 'answering' ? textNodes(turn.querySelector('.chat-claude > .chat-reply-body')).reduce((n, t) => n + t.data.length, 0) : 0, pieces: [] });
  }
}

function detach() {
  if (observer) observer.disconnect();
  if (swapWatch) swapWatch.disconnect();
  if (floatWatch) floatWatch.disconnect();
  if (toolsWatch) toolsWatch.disconnect();
  toolsWatch = null;
  if (!on()) {
    const gone = app || document.querySelector('.chat-app');
    unfloat(gone);
    if (gone) gone.querySelectorAll('.chat-box.g-tight').forEach((b) => b.classList.remove('g-tight'));
  }
  observer = null;
  swapWatch = null;
  floatWatch = null;
  app = null;
  turns.clear();
}

// (the shots and tests can replay "an answer lands" on a drawn turn)
V.on('chat-landed', (turn) => { if (on() && turn && turn.nodeType === 1) landed(turn); });
V.on('tab', (tab) => { if (tab === 'claude') requestAnimationFrame(attach); else detach(); });
V.on('look', () => (on() ? requestAnimationFrame(attach) : detach()));
if (on()) requestAnimationFrame(attach);
})();
