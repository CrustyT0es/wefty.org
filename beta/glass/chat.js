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
function swap() {
  if (!on() || !app || !app.isConnected) return;
  const showing = app.classList.contains('showing-chat');
  if (showing === showingNow) return;
  showingNow = showing;
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

function attach() {
  if (!on()) return detach();
  const now = document.querySelector('.chat-app');
  if (!now || now === app) return;
  detach();
  app = now;
  place = '';
  nameShown = (app.querySelector('.chat-model-name') || {}).textContent || '';
  showingNow = app.classList.contains('showing-chat');
  footGap = 0;
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
  observer = null;
  swapWatch = null;
  app = null;
  turns.clear();
}

// (the shots and tests can replay "an answer lands" on a drawn turn)
V.on('chat-landed', (turn) => { if (on() && turn && turn.nodeType === 1) landed(turn); });
V.on('tab', (tab) => { if (tab === 'claude') requestAnimationFrame(attach); else detach(); });
V.on('look', () => (on() ? requestAnimationFrame(attach) : detach()));
if (on()) requestAnimationFrame(attach);
})();
