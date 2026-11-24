/* Wefty 2.0 "glass", area: Note-taker. This file belongs to the Note-taker builder; nobody else edits it.
   The note-taker (js/notetaker.js, dictation.js, capture.js): its start screen, live screen, strip and problem screens.
   Rules (vault/web/glass/README.txt has the rest): everything here is inert unless V.look.isGlass() (and listen to V.on('look') so the switch works live); use the tokens in
   glass.css (--g-*, and the app's own names, which glass redefines); only transform and opacity animate; call
   V.motion's helpers instead of writing your own; nothing here changes the classic look.

   What this file does (the look itself is notetaker.css; js/notetaker.js only says two things for it: 'notetaker-mic',
   the microphone AI listening opened, and 'notetaker-made', the notes made). Nothing here ever changes what the
   note-taker does, saves or says: it only adds pictures and motion, and takes them away again when the look is classic.
     - the start screen: its parts rise in one after the other the first time it shows
     - the live screen: the clock goes in the status line ("Listening · 4:13"), the three threads under it move with the
       sound (the microphone's loudness where the app has it, AI listening's; else each word as it's heard gives them a
       swell; else they breathe gently), on a spring that settles, so they never jump; each new paragraph rises in
     - writing the notes: three dots that bob in place of the spinner, and a thread of light along the card's foot
     - Pocket mode: the line fades in again each time it moves; waking, the black fades away
     - the notes made: the edge light runs once, and the notes' sections come in one after the other in the note
   Everything stops when nothing is on the screen to move (no rAF when the threads aren't there, the page is hidden, or
   lite / calm). */
'use strict';

(() => {
const V = window.V;
if (!V) return;

const on = () => !!(V.look && V.look.isGlass());
const quiet = () => !!(V.motion && (V.motion.calm() || V.motion.lite()));
const edge = (kind) => { try { V.emit('edge', kind); } catch (error) { /* nobody is listening */ } };
const layers = () => document.getElementById('layers');

/* ---------------------------------------------------------------- the threads */

/* A thread: a plain box; its wave (a mask on its ::before) and the flow along it are notetaker.css's. */
function wire() {
  const el = document.createElement('div');
  el.className = 'g-nt-wire';
  return el;
}

// How much each thread swells with the sound, and where it rests (the board's numbers).
const WIRES = [{ k: 0.7, phase: 0 }, { k: 0.85, phase: 2.1 }, { k: 0.45, phase: 4.2 }];
const REST = 0.32;

/* The sound: a level from 0 to 1. `bump` (a word heard) adds to it, it fades by itself, and the microphone's loudness
   (AI listening) is read each frame when there is one. */
const sound = { level: 0, mic: null };
function bump(amount = 0.45) { sound.level = Math.min(1, sound.level + amount); }

function micOpened(stream) {
  micClosed();
  const Context = window.AudioContext || window.webkitAudioContext;
  if (!on() || !Context || !stream || !stream.getAudioTracks) return;
  try {
    const ctx = new Context();
    const source = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    analyser.smoothingTimeConstant = 0.5;
    source.connect(analyser);  // (never to the speakers: nothing is played)
    sound.mic = { ctx, analyser, stream, data: new Uint8Array(analyser.fftSize) };
    if (ctx.state === 'suspended' && ctx.resume) ctx.resume().catch(() => {});
  } catch (error) {
    sound.mic = null;  // (the words still give the threads their swell)
  }
}
function micClosed() {
  const was = sound.mic;
  sound.mic = null;
  if (was) { try { was.ctx.close(); } catch (error) { /* closed already */ } }
}
function micLevel() {
  const m = sound.mic;
  if (!m) return null;
  if (!m.stream.getAudioTracks().some((track) => track.readyState === 'live')) { micClosed(); return null; }
  if (m.ctx.state !== 'running') return null;
  m.analyser.getByteTimeDomainData(m.data);
  let sum = 0;
  for (let i = 0; i < m.data.length; i++) { const v = (m.data[i] - 128) / 128; sum += v * v; }
  const rms = Math.sqrt(sum / m.data.length);
  return Math.min(1, rms * 7);
}

/* One loop for whichever threads are on the screen: each thread's swell follows its target on a spring (a little give, then
   it settles), so a word or a loud moment swells them smoothly and they ease back down. */
const loop = { raf: 0, last: 0, threads: null, wires: [], amp: [REST, REST, REST], vel: [0, 0, 0], start: 0 };

function frame(now) {
  loop.raf = 0;
  const threads = loop.threads;
  if (!on() || !threads || !threads.isConnected || document.hidden || quiet()) { settle(); return; }
  const dt = Math.min(0.05, loop.last ? (now - loop.last) / 1000 : 0.016);
  loop.last = now;
  const state = threads.dataset.state || 'on';
  const heard = micLevel();
  sound.level = heard !== null ? Math.max(heard, sound.level * Math.exp(-dt * 6)) : sound.level * Math.exp(-dt * 1.6);
  const t = (now - loop.start) / 1000;
  for (let i = 0; i < loop.wires.length; i++) {
    const w = WIRES[i];
    const breathe = 0.05 * Math.sin(t * 1.9 + w.phase) + 0.03 * Math.sin(t * 3.1 + w.phase * 1.7);
    const target = state === 'on' ? REST + breathe + sound.level * w.k * (0.85 + 0.3 * (0.5 + 0.5 * Math.sin(t * 5.3 + w.phase)))
      : state === 'paused' ? 0.1 : 0.2;
    // a spring: stiff enough to follow speech, damped just under critical so it settles with a hint of give
    const force = 150 * (target - loop.amp[i]) - 20 * loop.vel[i];
    loop.vel[i] += force * dt;
    loop.amp[i] += loop.vel[i] * dt;
    const amp = Math.max(0.04, Math.min(1.25, loop.amp[i]));
    loop.wires[i].style.transform = `scaleY(${amp.toFixed(3)})`;
  }
  loop.raf = requestAnimationFrame(frame);
}
function run() {
  if (loop.raf || !loop.threads || document.hidden || quiet() || !window.requestAnimationFrame) return;
  loop.last = 0;
  if (!loop.start) loop.start = performance.now();
  loop.raf = requestAnimationFrame(frame);
}
/* Stopped: the inline swell goes, so the stylesheet's own still picture (lite, calm) shows. */
function settle() {
  if (loop.raf) cancelAnimationFrame(loop.raf);
  loop.raf = 0;
  for (const w of loop.wires) w.style.transform = '';
}

/* ---------------------------------------------------------------- the live screen */

const seen = new WeakSet();       // paragraphs already on the screen (a new one rises in)
let watchedWords = null;          // the .nt-words being watched for words
let wordsWatch = null;
let clockWatch = null;

/* (only when it changes: setting it again would be a change the watch below sees, again and again) */
let shownState = '';   // the state the live screen showed last (the screen is drawn again at each change, so its own marks start afresh)
function setState(threads, state, status) {
  const was = shownState;
  shownState = state;
  if (threads.dataset.state !== state) threads.dataset.state = state;
  // Listening <-> Paused (and the rest): the words of the status line swap in and its dot springs, so the change is felt as the
  // threads settle; the first time a screen shows its state nothing moves (its parts rise in).
  if (!was || was === state || !status || !V.motion || V.motion.calm() || typeof status.animate !== 'function') return;
  const word = status.querySelector('.nt-state-word');
  const dot = status.querySelector('.nt-dot');
  const lit = V.motion.lite();
  if (word) word.animate([{ opacity: 0.1, transform: `translateY(${lit ? 0 : 6}px)` }, { opacity: 1, transform: 'none' }], { duration: lit ? 140 : 380, easing: lit ? 'ease-out' : V.motion.SPRING });
  if (dot && !lit) dot.animate([{ scale: '.35' }, { scale: '1' }], { duration: 460, easing: V.motion.SPRING });
}

function stateOf(status) {
  return (status && status.dataset.state) || 'wait';
}

function decorateLive(live) {
  const status = live.querySelector(':scope > .nt-state');
  const words = live.querySelector(':scope > .nt-words');
  if (!status || !words) return;
  // The clock in the status line ("Listening · 4:13"), read from the top row's own (which stays, hidden).
  if (!status.querySelector('.g-nt-clock')) {
    const clock = document.createElement('span');
    clock.className = 'g-nt-clock num';
    clock.setAttribute('aria-hidden', 'true');  // (the time isn't read out each second; the bar at the top says the minutes)
    status.querySelector('.nt-state-word').after(clock);
    copyClock();
  }
  // The threads, under the status line.
  let threads = live.querySelector(':scope > .g-nt-threads');
  const fresh = !threads;
  if (!threads) {
    threads = document.createElement('div');
    threads.className = 'g-nt-threads';
    threads.setAttribute('aria-hidden', 'true');
    threads.append(wire(), wire(), wire());
    status.after(threads);
  }
  setState(threads, stateOf(status), status);
  if (loop.threads !== threads) {
    loop.threads = threads;
    loop.wires = [...threads.children];
    // A fresh screen: the threads open out from a flat line on the spring (a screen drawn again keeps where they were).
    if (fresh && !document.querySelector('.nt-layer.g-nt-seen-live')) { loop.amp = [0.12, 0.12, 0.12]; loop.vel = [0, 0, 0]; }
    run();
  }
  // Words heard swell the threads; a new paragraph rises in.
  if (watchedWords !== words) {
    if (wordsWatch) wordsWatch.disconnect();
    watchedWords = words;
    for (const para of words.querySelectorAll('.nt-para')) seen.add(para);
    wordsWatch = new MutationObserver((changes) => {
      if (!on()) return;
      let grew = false;
      for (const change of changes) {
        if (change.type === 'characterData') grew = true;
        for (const node of change.addedNodes) {
          if (node.nodeType === 3) grew = true;
          else if (node.classList && node.classList.contains('nt-para') && !seen.has(node)) { seen.add(node); grew = true; rise(node); }
        }
      }
      if (grew) bump();
    });
    wordsWatch.observe(words, { childList: true, subtree: true, characterData: true });
  }
}

/* A new paragraph: up from a little below and in from clear (V.motion.enter's rise, on the new paragraphs only). */
function rise(para) {
  if (!V.motion || !para.parentNode) return;
  para.classList.add('g-nt-new');
  queueMicrotask(() => {
    const box = para.parentNode;
    if (!box) return;
    const fresh = [...box.querySelectorAll(':scope > .g-nt-new')];
    if (!fresh.length) return;
    fresh.forEach((each) => each.classList.remove('g-nt-new'));
    fresh.forEach((each) => each.classList.add('g-nt-rising'));
    V.motion.enter(box, { selector: ':scope > .g-nt-rising', stagger: 60, max: 4 });
    fresh.forEach((each) => each.classList.remove('g-nt-rising'));
  });
}

function copyClock() {
  const time = document.querySelector('.nt-layer .nt-bar .nt-time');
  const clock = document.querySelector('.nt-layer .g-nt-clock');
  if (!time || !clock) return;
  const words = time.hidden || !time.textContent ? '' : ` · ${time.textContent}`;
  if (clock.textContent !== words) clock.textContent = words;
}
function watchClock() {
  const time = document.querySelector('.nt-layer .nt-bar .nt-time');
  if (!time || (clockWatch && clockWatch.target === time)) return;
  if (clockWatch) clockWatch.observer.disconnect();
  const observer = new MutationObserver(() => { if (on()) copyClock(); });
  observer.observe(time, { childList: true, characterData: true, subtree: true, attributes: true, attributeFilter: ['hidden'] });
  clockWatch = { observer, target: time };
}

/* ---------------------------------------------------------------- writing the notes */

function decorateMaking(card) {
  if (card.classList.contains('nt-problem')) return;
  if (!card.querySelector(':scope > .g-nt-dots')) {
    const dots = document.createElement('span');
    dots.className = 'g-nt-dots';
    dots.setAttribute('aria-hidden', 'true');
    dots.append(document.createElement('i'), document.createElement('i'), document.createElement('i'));
    const spinner = card.querySelector(':scope > .spinner');
    if (spinner) spinner.after(dots); else card.prepend(dots);
  }
  if (!card.querySelector(':scope > .g-nt-run')) {
    const run = document.createElement('span');
    run.className = 'g-nt-run';
    run.setAttribute('aria-hidden', 'true');
    card.append(run);
  }
}

/* ---------------------------------------------------------------- one look over the screen */

const entered = new WeakSet();  // screens (by their element) that have risen in once

function look() {
  if (!on()) return;
  const layer = document.querySelector('#layers > .nt-layer');
  if (layer) {
    const ready = layer.querySelector('.nt-ready');
    if (ready && !entered.has(ready)) {
      entered.add(ready);
      if (V.motion) V.motion.enter(ready, { stagger: 40, max: 8, delay: 60 });
    }
    const live = layer.querySelector('.nt-live');
    if (live) {
      decorateLive(live);
      watchClock();
      copyClock();
      if (!layer.classList.contains('g-nt-seen-live')) {
        layer.classList.add('g-nt-seen-live');  // (the first time: the screen's parts rise in; later redraws stay put)
        if (V.motion) V.motion.enter(live, { selector: ':scope > :not(.nt-words)', stagger: 50, max: 6 });
      }
      const status = live.querySelector(':scope > .nt-state');
      const threads = live.querySelector(':scope > .g-nt-threads');
      if (status && threads) setState(threads, stateOf(status), status);
    } else if (loop.threads && !loop.threads.isConnected) {
      loop.threads = null;
      loop.wires = [];
      settle();
    }
    const making = layer.querySelector('.nt-making');
    if (making) {
      decorateMaking(making);
      if (!entered.has(making) && V.motion) {
        entered.add(making);
        V.motion.enter(making.parentNode, { selector: ':scope > .nt-making', stagger: 0, max: 1 });
      }
    }
  } else if (loop.threads) {
    loop.threads = null;
    loop.wires = [];
    settle();
  }
}

/* Looked over at once (a MutationObserver's callback runs before the next paint, so a screen just drawn never shows a frame
   without its threads, or before it starts to rise in). */
function soon() {
  if (on()) look();
}

/* Watched: what's added to #layers and inside the note-taker's screen (its parts are drawn again often), and the status
   line's state (the threads follow it). Pocket mode and its wake are on <body>. */
let layersWatch = null;
let bodyWatch = null;
function watch() {
  const box = layers();
  if (box && !layersWatch) {
    layersWatch = new MutationObserver((changes) => {
      for (const change of changes) {
        // (the words are watched on their own, above: only the screen's parts coming and going matter here)
        if (change.target.closest && change.target.closest('.nt-words')) continue;
        soon();
        return;
      }
    });
    layersWatch.observe(box, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-state'] });
  }
  if (!bodyWatch && document.body) {
    // Pocket mode comes and goes on <body>: its line watched while it's there, and its going is the wake.
    bodyWatch = new MutationObserver((changes) => {
      if (!on()) return;
      for (const change of changes) {
        for (const node of change.removedNodes) if (node.classList && node.classList.contains('nt-pocket')) woke();
        for (const node of change.addedNodes) if (node.classList && node.classList.contains('nt-pocket')) pocketCame();
      }
    });
    bodyWatch.observe(document.body, { childList: true });
  }
  look();
}

/* ---------------------------------------------------------------- Pocket mode */

const pocketWatch = new MutationObserver((changes) => { for (const c of changes) if (on()) moved(c.target); });
let pocketSeen = null;
function pocketCame() {
  const el = document.querySelector('body > .nt-pocket');
  if (!el || el === pocketSeen) return;
  pocketSeen = el;
  pocketWatch.disconnect();
  pocketWatch.observe(el, { attributes: true, attributeFilter: ['style'] });
}
/* The line moved (each minute): it fades in again where it is now. */
function moved(el) {
  const text = el.querySelector('.nt-pocket-text');
  if (!text || !text.animate) return;
  text.animate([{ opacity: 0 }, { opacity: 1 }], { duration: V.motion && V.motion.calm() ? 120 : 2400, easing: 'ease-in-out' });
}
/* Woken: the black fades away over the screen it was hiding (the note-taker's own code has already taken it away). */
function woke() {
  pocketSeen = null;
  pocketWatch.disconnect();
  const black = document.createElement('div');
  black.className = 'g-nt-wake';
  black.setAttribute('aria-hidden', 'true');
  document.body.append(black);
  const calm = V.motion && V.motion.calm();
  const gone = () => black.remove();
  if (!black.animate) { gone(); return; }
  const fade = black.animate([{ opacity: 1 }, { opacity: 0 }], { duration: calm ? 120 : V.motion && V.motion.lite() ? 220 : 480, easing: 'cubic-bezier(.4, 0, .2, 1)', fill: 'forwards' });
  fade.onfinish = gone;
  fade.oncancel = gone;
  setTimeout(gone, 900);  // (never left over the screen)
  // the live screen settles in under it: the threads open out again
  loop.amp = loop.amp.map((a) => Math.min(a, 0.1));
}

/* ---------------------------------------------------------------- the notes made */

/* The note opens with its notes above the transcript: the edge light runs once, and the notes' parts (Summary, Key points,
   Terms, To do...) come in one after the other, down to the transcript, which stays where it is. */
function made({ id, shown } = {}) {
  if (!on()) return;
  edge('saved');
  if (!shown) return;
  const began = Date.now();
  const find = () => {
    if (!on()) return;
    const editor = V.editor && V.editor.openId && V.editor.openId() === id ? document.querySelector('.editor .blocks') : null;
    if (!editor || !editor.children.length) {
      if (Date.now() - began < 2000) requestAnimationFrame(find);
      return;
    }
    const parts = [];
    for (const block of editor.children) {
      const text = block.querySelector('textarea');
      if (block.classList.contains('heading-block') && text && /^\s*transcript\s*$/i.test(text.value)) break;
      parts.push(block);
      if (parts.length >= 8) break;
    }
    if (!parts.length || !V.motion) return;
    parts.forEach((part) => part.classList.add('g-nt-reveal'));
    V.motion.enter(editor, { selector: ':scope > .g-nt-reveal', stagger: 70, max: 8, delay: 120 }).finished
      .then(() => parts.forEach((part) => part.classList.remove('g-nt-reveal')), () => {});
  };
  requestAnimationFrame(find);
}

/* ---------------------------------------------------------------- the look coming and going */

function strip() {
  // Classic again: nothing of this file's is left (the screen is the note-taker's own again).
  settle();
  shownState = '';
  loop.threads = null;
  loop.wires = [];
  micClosed();
  for (const el of document.querySelectorAll('.g-nt-threads, .g-nt-clock, .g-nt-dots, .g-nt-run, .g-nt-wake')) el.remove();
  for (const el of document.querySelectorAll('.g-nt-reveal, .g-nt-seen-live')) el.classList.remove('g-nt-reveal', 'g-nt-seen-live');
}

V.on('look', () => { if (on()) watch(); else strip(); });
V.on('notetaker-mic', (stream) => { if (on()) micOpened(stream); });
V.on('notetaker-made', (what) => made(what || {}));
V.on('notetaker', ({ listening } = {}) => { if (!listening) micClosed(); soon(); });
document.addEventListener('visibilitychange', () => { if (on() && !document.hidden) run(); });
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => { if (on()) watch(); });
else if (on()) watch();

/* ---- the 2.0 hotfix (kept from the preview's first look): the live screen starts at its top. js/notetaker.js draws it in the
   same box the start screen was in, which a phone with bigger text has scrolled down to its Start button: the screen that took
   its place kept that scroll, with its top out of sight (and, where it couldn't scroll, out of reach). */
let topLayers = null;
const topBodies = typeof MutationObserver === 'function' ? new MutationObserver((records) => {
  if (!on()) return;
  for (const r of records) {
    if ([...r.addedNodes].some((n) => n.nodeType === 1 && n.classList.contains('nt-live'))) r.target.scrollTop = 0;
  }
}) : null;
function topWatch() {
  if (!topBodies) return;
  topBodies.disconnect();
  for (const body of document.querySelectorAll('#layers > .nt-layer .nt-body')) topBodies.observe(body, { childList: true });
}
function topStart() {
  const box = document.getElementById('layers');
  if (!box || topLayers || !topBodies) return;
  topLayers = new MutationObserver(topWatch);
  topLayers.observe(box, { childList: true });
  topWatch();
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', topStart, { once: true }); else topStart();
})();
