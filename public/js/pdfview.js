// PDF viewer: only the pages near the screen are drawn, so a 600-page book costs about as much as a 5-page one.
import { $, el } from './ui.js';
import { resolveColors, luminance } from './themes.js';
import { loadLib, docFromBlob, docFromUrl } from './pdflib.js';
import { getFile, putFile } from './bookdb.js';

const GAP = 14;
const PAD = 16;
let ctx; // { state, save, toast, openNote, uid, onChange }
let R, scrollEl, pagesEl, sideEl, hlBar;
let V = null; // the open book
let wired = false;

export function initPdf(c) { ctx = c; }

const prefs = () => (ctx.state.pdfPrefs ||= { zoom: 1, tint: 'theme' });

function build() {
  if (R) return;
  const btn = (id, label, title, cls = 'btn ghost small') => el('button', { id, class: cls, title: title || label, 'aria-label': title || label }, label);
  R = el('div', { id: 'pdfr', class: 'pdf-reader', hidden: true, role: 'dialog', 'aria-label': 'PDF reader' },
    el('div', { class: 'reader-bar pdf-bar' },
      btn('pBack', '‹ Back', 'Close (Esc)'),
      el('span', { id: 'pTitle', class: 'grow ellipsis pdf-title' }),
      el('span', { class: 'pdf-pager' }, el('input', { id: 'pPage', type: 'number', min: 1, 'aria-label': 'Page number' }), el('span', { id: 'pTotal', class: 'muted' })),
      el('span', { class: 'pdf-zoom' }, btn('pZoomOut', '−', 'Zoom out (-)'), el('span', { id: 'pZoomLbl', class: 'muted' }), btn('pZoomIn', '+', 'Zoom in (+)'), btn('pFit', 'Fit', 'Fit width (0)')),
      btn('pTint', 'Match theme', 'Tint the pages to match your theme'),
      btn('pSideBtn', 'Contents', 'Contents, search and your highlights (C)'),
      btn('pKeep', 'Keep a copy', 'Save this PDF on this device so it opens offline'),
      el('a', { id: 'pOpen', class: 'btn ghost small', target: '_blank', rel: 'noopener noreferrer', hidden: true }, 'Original ↗')),
    el('div', { class: 'pdf-prog' }, el('i', { id: 'pProg' })),
    el('div', { class: 'pdf-main' },
      sideEl = el('aside', { id: 'pSide', class: 'pdf-side', hidden: true }),
      scrollEl = el('div', { id: 'pScroll', class: 'pdf-scroll', tabindex: 0 }, pagesEl = el('div', { id: 'pPages' }))),
    el('div', { id: 'pMsg', class: 'pdf-msg', hidden: true }));
  hlBar = el('div', { class: 'sel-bar pdf-hlbar', hidden: true },
    el('button', { 'data-a': 'hl' }, 'Highlight'), el('button', { 'data-a': 'note' }, 'Add note'));
  document.body.append(R, hlBar);
  wire();
}

function wire() {
  if (wired) return;
  wired = true;
  $('#pBack').onclick = closePdf;
  $('#pZoomIn').onclick = () => setZoom(prefs().zoom * 1.2);
  $('#pZoomOut').onclick = () => setZoom(prefs().zoom / 1.2);
  $('#pFit').onclick = () => setZoom(1);
  $('#pTint').onclick = () => { prefs().tint = prefs().tint === 'theme' ? 'off' : 'theme'; ctx.save(); applyTint(); };
  $('#pSideBtn').onclick = () => toggleSide();
  $('#pPage').addEventListener('change', (e) => goTo(Number(e.target.value)));
  $('#pPage').addEventListener('keydown', (e) => { if (e.key === 'Enter') { goTo(Number(e.target.value)); scrollEl.focus(); } });
  $('#pKeep').onclick = keepCopy;
  scrollEl.addEventListener('scroll', onScroll, { passive: true });
  scrollEl.addEventListener('click', onClick);
  scrollEl.addEventListener('wheel', (e) => { // trackpad pinch / ctrl+wheel zooms the book, not the whole page
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    clearTimeout(wheelT);
    wheelZoom *= Math.exp(-e.deltaY * 0.01);
    wheelT = setTimeout(() => { setZoom(prefs().zoom * wheelZoom); wheelZoom = 1; }, 120);
  }, { passive: false });
  new ResizeObserver(() => { if (V && !R.hidden) relayout(true); }).observe(scrollEl);
  document.addEventListener('quiet-theme', applyTint);
  document.addEventListener('quiet-hl', () => { redrawAllHighlights(); if (sideTab === 'marks') renderSide(); });
  document.addEventListener('selectionchange', onSelection);
  hlBar.addEventListener('mousedown', (e) => e.preventDefault());
  hlBar.addEventListener('click', (e) => { const a = e.target.dataset?.a; if (a) makeHighlight(a === 'note'); });
  document.addEventListener('keydown', onKey, true);
}
let wheelT;
let wheelZoom = 1;

// ---------- opening ----------
export async function openBook(meta, { page } = {}) {
  build();
  closeDoc();
  const tok = ((V && V.token) || 0) + 1;
  V = { token: tok, meta, doc: null, total: 0, sizes: [], tops: [], scale: 1, fit: 1, rendered: new Map(), els: [], cur: 0, texts: [], proxy: false, wanted: new Set(), active: 0, lib: null, w: 0 };
  R.hidden = false;
  document.body.classList.add('no-scroll');
  $('#pTitle').textContent = meta.title;
  $('#pOpen').hidden = meta.kind !== 'link';
  if (meta.kind === 'link') $('#pOpen').href = meta.url;
  $('#pKeep').hidden = true;
  pagesEl.replaceChildren();
  sideEl.hidden = true;
  say('Opening…');
  meta.opened = Date.now();
  let doc;
  try {
    V.lib = await loadLib();
    doc = await loadSource(meta);
  } catch (e) {
    if (tok === V.token) fail(meta, e);
    return;
  }
  if (tok !== V.token) { doc.destroy(); return; }
  V.doc = doc;
  V.total = doc.numPages;
  const p1 = await doc.getPage(1);
  const v1 = p1.getViewport({ scale: 1 });
  V.sizes = Array.from({ length: V.total }, () => ({ w: v1.width, h: v1.height }));
  if (!meta.pages || meta.pages !== V.total) meta.pages = V.total;
  $('#pTotal').textContent = '/ ' + V.total;
  $('#pPage').max = V.total;
  say(null);
  V.els = Array.from({ length: V.total }, (_, i) => el('div', { class: 'pdf-page', 'data-i': i, 'aria-label': 'Page ' + (i + 1) }));
  pagesEl.replaceChildren(...V.els);
  applyTint();
  $('#pZoomLbl').textContent = Math.round(prefs().zoom * 100) + '%';
  if (meta.kind === 'link' && !V.proxy) $('#pKeep').hidden = false;
  relayout(false);
  const start = page ? { p: page - 1, f: 0 } : meta.pos || { p: 0, f: 0 };
  const p = Math.min(Math.max(0, start.p), V.total - 1);
  scrollEl.scrollTop = V.tops[p] + (start.f || 0) * V.sizes[p].h * V.scale - (start.f ? 0 : 0);
  scrollEl.focus({ preventScroll: true });
  ctx.save();
  update();
  if (!V.proxy) loadSizes(tok);
}

async function loadSource(meta) {
  if (meta.kind === 'file') {
    const blob = await getFile(meta.id);
    if (!blob) { const e = new Error('This book’s file is no longer in this browser’s storage — browsers can clear it when space is low. Add the PDF again to read it.'); e.missing = true; throw e; }
    return docFromBlob(blob);
  }
  try {
    return await docFromUrl(meta.url, false);
  } catch (direct) {
    if (direct?.name === 'PasswordException') throw direct;
    V.proxy = true; // the site doesn't let browsers read it directly — go through Quiet's server, a slice at a time
    try {
      return await docFromUrl(meta.url, true);
    } catch (viaServer) {
      viaServer.fallback = true;
      throw viaServer;
    }
  }
}

function fail(meta, e) {
  const box = $('#pMsg');
  const buttons = [];
  if (meta.kind === 'link') buttons.push(el('a', { class: 'btn primary', href: meta.url, target: '_blank', rel: 'noopener noreferrer' }, 'Open the PDF in a new tab ↗'));
  buttons.push(el('button', { class: 'btn', onclick: closePdf }, 'Back'));
  box.replaceChildren(
    el('strong', { text: e?.missing ? 'The file is missing' : 'Couldn’t open this PDF' }),
    el('p', { class: 'muted', text: e?.missing ? e.message : e?.fallback ? `${e.message || 'The site refused'}. Some sites don’t allow PDFs to be opened inside other apps.` : (e?.message || 'It may be damaged or not a PDF.') }),
    el('div', { class: 'row' }, ...buttons));
  box.hidden = false;
}
function say(text) {
  const box = $('#pMsg');
  if (!text) { box.hidden = true; return; }
  box.replaceChildren(el('p', { class: 'muted', text }));
  box.hidden = false;
}

export function closePdf() {
  if (!R || R.hidden) return;
  savePos(true);
  closeDoc();
  R.hidden = true;
  hlBar.hidden = true;
  if ($('#reader').hidden && $('#writer').hidden) document.body.classList.remove('no-scroll');
  ctx.onChange?.();
}
function closeDoc() {
  if (!V) return;
  V.token++;
  for (const i of [...V.rendered.keys()]) unrender(i);
  try { V.doc?.destroy(); } catch {}
  V.doc = null;
  searchTok++;
}
export const isOpen = () => !!R && !R.hidden;

// ---------- layout + virtual rendering ----------
function relayout(keepAnchor) {
  if (!V?.total) return;
  const anchor = V.cur;
  const off = keepAnchor ? scrollEl.scrollTop - (V.tops[anchor] ?? 0) : 0;
  const avail = Math.max(200, Math.min(scrollEl.clientWidth - 32, 980)); // fit-width, but never wider than a comfortable page
  const fit = avail / V.sizes[0].w;
  const scale = Math.min(6, Math.max(0.1, fit * prefs().zoom));
  const rescaled = Math.abs(scale - V.scale) > 1e-6;
  V.fit = fit;
  V.scale = scale;
  let y = PAD;
  V.tops = new Array(V.total);
  for (let i = 0; i < V.total; i++) {
    V.tops[i] = y;
    const w = Math.round(V.sizes[i].w * scale);
    const h = Math.round(V.sizes[i].h * scale);
    const e = V.els[i];
    if (e._w !== w || e._h !== h) { e.style.width = w + 'px'; e.style.height = h + 'px'; e._w = w; e._h = h; }
    y += h + GAP;
  }
  pagesEl.style.height = y + PAD + 'px';
  pagesEl.style.minHeight = y + 'px';
  if (rescaled) for (const i of [...V.rendered.keys()]) unrender(i);
  if (keepAnchor) scrollEl.scrollTop = V.tops[anchor] + off;
  update();
}
let relayoutQueued = false;
function relayoutSoon() {
  if (relayoutQueued) return;
  relayoutQueued = true;
  requestAnimationFrame(() => { relayoutQueued = false; relayout(true); });
}
function setSize(i, w, h) {
  const s = V.sizes[i];
  if (Math.abs(s.w - w) < 0.5 && Math.abs(s.h - h) < 0.5) return;
  V.sizes[i] = { w, h };
  relayoutSoon();
}
async function loadSizes(tok) {
  for (let i = 1; i < V.total && V && V.token === tok; i++) {
    try {
      const p = await V.doc.getPage(i + 1);
      const v = p.getViewport({ scale: 1 });
      setSize(i, v.width, v.height);
      p.cleanup();
    } catch { return; }
    if (i % 15 === 0) await new Promise((r) => setTimeout(r, 20));
  }
}
function pageAt(y) {
  let lo = 0, hi = V.total - 1;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (V.tops[mid] <= y) lo = mid; else hi = mid - 1; }
  return lo;
}
let raf = 0;
function onScroll() {
  if (!raf) raf = requestAnimationFrame(() => { raf = 0; update(); });
  clearTimeout(posT);
  posT = setTimeout(() => savePos(false), 500);
}
let posT;
function update() {
  if (!V?.doc || R.hidden) return;
  const st = scrollEl.scrollTop;
  const vh = scrollEl.clientHeight;
  V.cur = pageAt(st + vh * 0.3);
  if (document.activeElement !== $('#pPage')) $('#pPage').value = V.cur + 1;
  $('#pProg').style.width = ((V.cur + 1) / V.total) * 100 + '%';
  let first = pageAt(Math.max(0, st - vh));
  let last = first;
  while (last < V.total - 1 && V.tops[last + 1] < st + vh * 2) last++;
  V.wanted = new Set();
  for (let i = first; i <= last; i++) V.wanted.add(i);
  for (const i of [...V.rendered.keys()]) if (i < first - 3 || i > last + 3) unrender(i);
  pump();
}
function pump() {
  const order = [...V.wanted].filter((i) => !V.rendered.has(i)).sort((a, b) => Math.abs(a - V.cur) - Math.abs(b - V.cur));
  for (const i of order) {
    if (V.active >= 2) break;
    const v = V;
    v.active++;
    renderPage(i).finally(() => { if (V === v) { v.active--; pump(); } });
  }
}
async function renderPage(i) {
  const tok = V.token;
  const entry = { scale: V.scale };
  V.rendered.set(i, entry);
  const alive = () => V && V.token === tok && V.rendered.get(i) === entry;
  try {
    const page = await V.doc.getPage(i + 1);
    if (!alive()) return;
    const v1 = page.getViewport({ scale: 1 });
    setSize(i, v1.width, v1.height);
    const vp = page.getViewport({ scale: entry.scale });
    let ratio = Math.min(window.devicePixelRatio || 1, 2);
    while (vp.width * vp.height * ratio * ratio > 1.6e7) ratio *= 0.85; // keep very large pages from eating memory
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.floor(vp.width * ratio));
    canvas.height = Math.max(1, Math.floor(vp.height * ratio));
    const holder = V.els[i];
    holder.style.setProperty('--total-scale-factor', entry.scale);
    holder.style.setProperty('--scale-factor', entry.scale);
    holder.prepend(canvas);
    entry.canvas = canvas;
    const task = page.render({ canvas, canvasContext: canvas.getContext('2d'), viewport: page.getViewport({ scale: entry.scale * ratio }), background: '#ffffff' });
    entry.task = task;
    await task.promise;
    if (!alive()) return;
    const hl = el('div', { class: 'hl-layer' });
    const tl = el('div', { class: 'textLayer' });
    holder.append(hl, tl);
    entry.hl = hl;
    entry.tlEl = tl;
    drawHighlights(i);
    const layer = new V.lib.TextLayer({ textContentSource: page.streamTextContent(), container: tl, viewport: vp });
    entry.tl = layer;
    await layer.render();
  } catch (e) {
    if (e?.name !== 'RenderingCancelledException' && alive()) console.warn('PDF page', i + 1, e);
  }
}
function unrender(i) {
  const e = V?.rendered.get(i);
  if (!e) return;
  V.rendered.delete(i);
  try { e.task?.cancel(); e.tl?.cancel(); } catch {}
  if (e.canvas) { e.canvas.width = e.canvas.height = 0; e.canvas.remove(); }
  e.hl?.remove();
  e.tlEl?.remove();
}

// ---------- navigation ----------
export function goTo(n, frac = 0) {
  if (!V?.total || !Number.isFinite(n)) return;
  const i = Math.min(Math.max(1, Math.round(n)), V.total) - 1;
  scrollEl.scrollTo({ top: Math.max(0, V.tops[i] + frac * V.sizes[i].h * V.scale - 24) });
}
function setZoom(z) {
  if (!V?.total) return;
  const nz = Math.min(4, Math.max(0.4, z));
  if (Math.abs(nz - prefs().zoom) < 1e-3) return;
  const i = V.cur;
  const frac = (scrollEl.scrollTop - V.tops[i]) / (V.sizes[i].h * V.scale);
  prefs().zoom = nz;
  ctx.save();
  $('#pZoomLbl').textContent = Math.round(nz * 100) + '%';
  relayout(false);
  scrollEl.scrollTop = V.tops[i] + frac * V.sizes[i].h * V.scale;
}
function savePos(now) {
  if (!V?.doc) return;
  const i = V.cur;
  const f = Math.max(0, Math.min(1, (scrollEl.scrollTop - V.tops[i]) / (V.sizes[i].h * V.scale)));
  V.meta.pos = { p: i, f: Math.round(f * 1000) / 1000 };
  V.meta.opened = Date.now();
  ctx.save();
}
function applyTint() {
  if (!R) return;
  const on = prefs().tint === 'theme';
  let dark = false;
  try { dark = luminance(resolveColors(ctx.state.theme).bg) < 0.35; } catch {}
  R.classList.toggle('tint-dark', on && dark);
  R.classList.toggle('tint-light', on && !dark);
  $('#pTint').classList.toggle('on', on);
}

// ---------- keep a copy on this device ----------
async function keepCopy() {
  const meta = V?.meta;
  if (!meta || meta.kind !== 'link') return;
  const btn = $('#pKeep');
  btn.disabled = true;
  btn.textContent = 'Downloading…';
  try {
    const r = await fetch(meta.url, { credentials: 'omit' });
    if (!r.ok) throw new Error('The site returned ' + r.status);
    const total = Number(r.headers.get('content-length')) || 0;
    const reader = r.body.getReader();
    const chunks = [];
    let got = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      got += value.length;
      btn.textContent = total ? `Downloading ${Math.round((got / total) * 100)}%` : `Downloading ${(got / 1048576).toFixed(0)} MB`;
    }
    await putFile(meta.id, new Blob(chunks, { type: 'application/pdf' }));
    meta.kind = 'file';
    meta.size = got;
    ctx.save();
    btn.hidden = true;
    ctx.toast('Saved on this device — it now opens offline');
  } catch (e) {
    btn.disabled = false;
    btn.textContent = 'Keep a copy';
    ctx.toast('Couldn’t keep a copy' + (e?.message ? ': ' + e.message : '') + '. This site may not allow downloads from other apps.');
  }
}

// ---------- side panel: contents · search · highlights ----------
let sideTab = 'toc';
let outline;
let searchTok = 0;
let lastQuery = '';
let results = null;
function toggleSide(tab) {
  if (!V?.doc) return;
  if (tab) sideTab = tab;
  sideEl.hidden = tab ? false : !sideEl.hidden;
  if (!sideEl.hidden) renderSide();
}
function renderSide() {
  const tabs = el('div', { class: 'pdf-tabs' },
    ...[['toc', 'Contents'], ['find', 'Search'], ['marks', 'Highlights']].map(([id, label]) => el('button', { class: id === sideTab ? 'on' : '', onclick: () => { sideTab = id; renderSide(); } }, label)));
  const body = el('div', { class: 'pdf-side-body' });
  sideEl.replaceChildren(tabs, body);
  if (sideTab === 'toc') renderToc(body);
  else if (sideTab === 'find') renderFind(body);
  else renderMarks(body);
  if (sideTab === 'find') body.querySelector('input')?.focus();
}
async function renderToc(body) {
  body.append(el('p', { class: 'muted', text: 'Loading…' }));
  const doc = V.doc;
  try { outline = await doc.getOutline(); } catch { outline = null; }
  if (V?.doc !== doc) return;
  body.replaceChildren();
  if (!outline?.length) { body.append(el('p', { class: 'muted pad', text: 'This PDF has no table of contents. Use the page box or search instead.' })); return; }
  let count = 0;
  const list = (items, depth) => el('ul', {}, ...items.filter(() => count++ < 600).map((it) => el('li', {},
    el('button', { class: 'toc-item', style: `padding-left:${8 + depth * 14}px`, onclick: async () => { const p = await pageOfDest(it.dest); if (p != null) goTo(p + 1); } }, it.title || '(untitled)'),
    it.items?.length && depth < 4 ? list(it.items, depth + 1) : null)));
  body.append(list(outline, 0));
}
async function pageOfDest(dest) {
  try {
    if (typeof dest === 'string') dest = await V.doc.getDestination(dest);
    if (!Array.isArray(dest)) return null;
    const ref = dest[0];
    return typeof ref === 'number' ? ref : await V.doc.getPageIndex(ref);
  } catch { return null; }
}
function renderFind(body) {
  const input = el('input', { type: 'search', placeholder: 'Search this PDF…', value: lastQuery, 'aria-label': 'Search in PDF' });
  const out = el('div', { class: 'find-out' });
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { lastQuery = input.value; runSearch(input.value.trim(), out); } e.stopPropagation(); });
  body.append(input, out);
  if (results && results.q === lastQuery) showResults(out);
  else out.append(el('p', { class: 'muted pad', text: 'Press Enter to search every page. Scanned PDFs without selectable text can’t be searched.' }));
}
async function runSearch(q, out) {
  const tok = ++searchTok;
  if (!q) { out.replaceChildren(); return; }
  const doc = V.doc;
  const needle = q.toLowerCase();
  const hits = [];
  results = { q, hits, done: false };
  const status = el('p', { class: 'muted pad' });
  out.replaceChildren(status);
  for (let i = 0; i < V.total; i++) {
    if (tok !== searchTok || V.doc !== doc) return;
    if (V.texts[i] === undefined) {
      try {
        const p = await doc.getPage(i + 1);
        const c = await p.getTextContent();
        V.texts[i] = c.items.map((t) => t.str).join(' ').replace(/\s+/g, ' ');
        p.cleanup();
      } catch { V.texts[i] = ''; }
    }
    const t = V.texts[i];
    const low = t.toLowerCase();
    let at = low.indexOf(needle);
    while (at !== -1 && hits.length < 400) {
      hits.push({ page: i, snip: (at > 28 ? '…' : '') + t.slice(Math.max(0, at - 28), at + needle.length + 48) });
      at = low.indexOf(needle, at + needle.length);
    }
    if (i % 8 === 0 || i === V.total - 1) {
      status.textContent = `Searching… page ${i + 1} of ${V.total} · ${hits.length} found`;
      await new Promise((r) => setTimeout(r, 0));
    }
    if (hits.length >= 400) break;
  }
  results.done = true;
  showResults(out);
}
function showResults(out) {
  const { hits, q } = results;
  out.replaceChildren(
    el('p', { class: 'muted pad', text: hits.length ? `${hits.length}${hits.length >= 400 ? '+' : ''} result${hits.length === 1 ? '' : 's'}` : `Nothing found for “${q}”.` }),
    ...hits.map((h) => el('button', { class: 'find-hit', onclick: () => goTo(h.page + 1) }, el('b', { text: 'p. ' + (h.page + 1) }), el('span', { text: h.snip }))));
}
function renderMarks(body) {
  const mine = ctx.state.highlights.filter((h) => h.pdf === V.meta.id).sort((a, b) => a.page - b.page || a.rects[0][1] - b.rects[0][1]);
  if (!mine.length) { body.append(el('p', { class: 'muted pad', text: 'Select text on a page and choose Highlight. Your highlights and notes collect here.' })); return; }
  body.append(...mine.map((h) => el('div', { class: 'mark-item' },
    el('button', { class: 'find-hit', onclick: () => goTo(h.page + 1, h.rects[0][1]) }, el('b', { text: 'p. ' + (h.page + 1) }), el('span', { text: h.text })),
    h.note ? el('p', { class: 'hl-note', text: h.note }) : null,
    el('button', { class: 'btn ghost small', onclick: () => ctx.openNote(h) }, h.note ? 'Edit note' : 'Add note'))));
}

// ---------- highlights ----------
function drawHighlights(i) {
  const e = V?.rendered.get(i);
  if (!e?.hl) return;
  e.hl.replaceChildren();
  for (const h of ctx.state.highlights) {
    if (h.pdf !== V.meta.id || h.page !== i) continue;
    for (const [x, y, w, hh] of h.rects) {
      e.hl.append(el('div', { class: 'pdf-hl' + (h.note ? ' has-note' : ''), 'data-id': h.id, style: `left:${x * 100}%;top:${y * 100}%;width:${w * 100}%;height:${hh * 100}%` }));
    }
  }
}
function redrawAllHighlights() { if (V?.doc) for (const i of V.rendered.keys()) drawHighlights(i); }
export const refreshHighlights = redrawAllHighlights;

function selectionRects() {
  const sel = getSelection();
  if (!sel || sel.isCollapsed || !V?.doc || R.hidden) return null;
  const range = sel.getRangeAt(0);
  if (!pagesEl.contains(range.commonAncestorContainer)) return null;
  const text = sel.toString().replace(/\s+/g, ' ').trim();
  if (text.length < 2) return null;
  const boxes = [...V.rendered.keys()].map((i) => ({ i, r: V.els[i].getBoundingClientRect() }));
  let page = null;
  const rects = [];
  let top = Infinity, left = 0, right = 0;
  for (const r of range.getClientRects()) {
    if (r.width < 1 || r.height < 2) continue;
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const b = boxes.find((x) => cx >= x.r.left && cx <= x.r.right && cy >= x.r.top && cy <= x.r.bottom);
    if (!b || (page !== null && b.i !== page)) continue;
    if (r.width > b.r.width * 0.99 && r.height > b.r.height * 0.4) continue; // stray full-page boxes
    page = b.i;
    rects.push([(r.left - b.r.left) / b.r.width, (r.top - b.r.top) / b.r.height, r.width / b.r.width, r.height / b.r.height]);
    top = Math.min(top, r.top); left = Math.min(left || r.left, r.left); right = Math.max(right, r.right);
  }
  if (page === null || !rects.length) return null;
  return { page, rects: rects.map((q) => q.map((n) => Math.round(n * 10000) / 10000)), text: text.slice(0, 1500), top, cx: (left + right) / 2 };
}
function onSelection() {
  if (!R || R.hidden) { if (hlBar) hlBar.hidden = true; return; }
  const s = selectionRects();
  if (!s) { hlBar.hidden = true; return; }
  hlBar.hidden = false;
  hlBar.style.left = Math.min(Math.max(120, s.cx), innerWidth - 120) + 'px';
  hlBar.style.top = Math.max(60, s.top - 8) + 'px';
}
function makeHighlight(withNote) {
  const s = selectionRects();
  if (!s) return;
  const m = V.meta;
  const h = { id: ctx.uid(), url: m.url || 'pdf:' + m.id, pdf: m.id, page: s.page, rects: s.rects, title: m.title, sname: 'PDF', text: s.text, pre: '', note: '', created: Date.now() };
  ctx.state.highlights.push(h);
  ctx.save();
  drawHighlights(s.page);
  getSelection().removeAllRanges();
  hlBar.hidden = true;
  ctx.onChange?.();
  if (sideTab === 'marks' && !sideEl.hidden) renderSide();
  if (withNote) ctx.openNote(h);
  else ctx.toast('Highlighted', 'Undo', () => { ctx.deleteHighlight(h.id); });
}
function onClick(e) {
  if (!getSelection().isCollapsed) return;
  const pg = e.target.closest?.('.pdf-page');
  if (!pg) return;
  const r = pg.getBoundingClientRect();
  const x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
  const i = Number(pg.dataset.i);
  const h = ctx.state.highlights.find((q) => q.pdf === V.meta.id && q.page === i && q.rects.some(([a, b, w, hh]) => x >= a && x <= a + w && y >= b && y <= b + hh));
  if (h) ctx.openNote(h);
}

// ---------- keyboard ----------
function onKey(e) {
  if (!R || R.hidden) return;
  if ($('dialog[open]')) return;
  const typing = e.target.matches?.('input, textarea, select');
  const mod = e.metaKey || e.ctrlKey;
  if (e.key === 'Escape') {
    e.stopPropagation();
    if (typing) { e.target.blur(); scrollEl.focus(); return; }
    if (!hlBar.hidden) { getSelection().removeAllRanges(); return; }
    if (!sideEl.hidden) { sideEl.hidden = true; return; }
    closePdf();
    return;
  }
  if (mod && e.key.toLowerCase() === 'f') { e.preventDefault(); e.stopPropagation(); toggleSide('find'); return; }
  if (typing || mod || e.altKey) return;
  const k = e.key;
  const handled = () => { e.preventDefault(); e.stopPropagation(); };
  if (k === '+' || k === '=') { handled(); setZoom(prefs().zoom * 1.2); }
  else if (k === '-') { handled(); setZoom(prefs().zoom / 1.2); }
  else if (k === '0') { handled(); setZoom(1); }
  else if (k === '/') { handled(); toggleSide('find'); }
  else if (k === 'c') { handled(); if (sideTab === 'toc' && !sideEl.hidden) sideEl.hidden = true; else toggleSide('toc'); }
  else if (k === 'g') { handled(); $('#pPage').focus(); $('#pPage').select(); }
  else if (k === 'n' || k === 'ArrowRight') { handled(); goTo(V.cur + 2); }
  else if (k === 'p' || k === 'ArrowLeft') { handled(); goTo(V.cur); }
  else e.stopPropagation(); // never let the feed's own shortcuts fire behind the book
}
