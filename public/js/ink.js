// Ink: draw, circle and comment on any article — with a pen, finger or mouse.
// Shapes are anchored to the paragraph they were drawn near, so they follow the text when the
// window, font size or theme changes. Everything is stored locally with the rest of your data.
import { el } from './ui.js';

const NS = 'http://www.w3.org/2000/svg';
export const COLORS = {
  fg: 'var(--fg)', grey: '#9fa8b2', lviolet: '#e085f4', violet: '#ae3ec9',
  blue: '#4465e9', lblue: '#4ba1f2', yellow: '#f1ac4b', orange: '#e16919',
  green: '#099268', lgreen: '#4cb05e', lred: '#f87777', red: '#e03131',
};
const GRID = ['fg', 'grey', 'lviolet', 'violet', 'blue', 'lblue', 'yellow', 'orange', 'green', 'lgreen', 'lred', 'red'];
const SIZES = { S: 2.5, M: 4.5, L: 8, XL: 12 };
const NOTE_W = 210;

const svgIcon = (d) => `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
export const ICONS = {
  read: svgIcon('<path d="M8 11V5.5a1.5 1.5 0 0 1 3 0V10m0-1.5V4a1.5 1.5 0 0 1 3 0v6m0-3a1.5 1.5 0 0 1 3 0v5.5c0 4-2 7-6 7-3 0-4.5-1.5-6-4l-1.5-2.7a1.4 1.4 0 0 1 2.4-1.4L8 14"/>'),
  pen: svgIcon('<path d="M4 20l1-4L16.5 4.5a2.1 2.1 0 0 1 3 3L8 19z"/><path d="M14.5 6.5l3 3"/>'),
  marker: svgIcon('<path d="M9 14l5.5-9.5 4 2.3L13 16z"/><path d="M9 14l-1.5 4.5L12 17"/><path d="M4 21h8" opacity=".5"/>'),
  circle: svgIcon('<ellipse cx="12" cy="12" rx="9" ry="6.5"/>'),
  note: svgIcon('<path d="M5 4h14v10l-5 6H5z"/><path d="M14 20v-6h5"/>'),
  eraser: svgIcon('<path d="M8 20h11"/><path d="M5 15l9-9a2 2 0 0 1 2.8 0l2.2 2.2a2 2 0 0 1 0 2.8L12 20H8z"/><path d="M9 11l5 5"/>'),
  undo: svgIcon('<path d="M9 8H15a4 4 0 0 1 0 8H8"/><path d="M12 4.5L8.5 8 12 11.5"/>'),
  redo: svgIcon('<path d="M15 8H9a4 4 0 0 0 0 8h7"/><path d="M12 4.5L15.5 8 12 11.5"/>'),
  close: svgIcon('<path d="M6 6l12 12M18 6L6 18"/>'),
  trash: svgIcon('<path d="M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13"/>'),
};
const TOOLS = [
  ['read', 'Read — scroll & select text (V)', 'v'],
  ['pen', 'Pen — circle anything and it snaps to a neat shape (P)', 'p'],
  ['hl', 'Highlighter (H)', 'h'],
  ['ell', 'Circle — drag across anything (O)', 'o'],
  ['note', 'Comment — click to type a note (N)', 'n'],
  ['eraser', 'Eraser (E)', 'e'],
];
const TOOL_ICON = { read: 'read', pen: 'pen', hl: 'marker', ell: 'circle', note: 'note', eraser: 'eraser' };

// ---------- geometry ----------
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
function bbox(pts) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of pts) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  return { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 };
}
function simplify(pts, eps) {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    let max = 0, idx = -1;
    const [ax, ay] = pts[a], [bx, by] = pts[b];
    const len = Math.hypot(bx - ax, by - ay) || 1;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs((by - ay) * pts[i][0] - (bx - ax) * pts[i][1] + bx * ay - by * ax) / len;
      if (d > max) { max = d; idx = i; }
    }
    if (max > eps && idx > 0) { keep[idx] = 1; stack.push([a, idx], [idx, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}
function pathD(pts) {
  if (pts.length < 2) return `M${pts[0][0]} ${pts[0][1]}h.01`;
  let d = `M${pts[0][0]} ${pts[0][1]}`;
  for (let i = 1; i < pts.length - 1; i++) d += `Q${pts[i][0]} ${pts[i][1]} ${(pts[i][0] + pts[i + 1][0]) / 2} ${(pts[i][1] + pts[i + 1][1]) / 2}`;
  const l = pts[pts.length - 1];
  return d + `L${l[0]} ${l[1]}`;
}
// Did this stroke go round something and come back to where it started?
export function detectLoop(pts) {
  if (pts.length < 10) return null;
  const b = bbox(pts);
  if (b.w < 26 || b.h < 12) return null;
  let len = 0;
  for (let i = 1; i < pts.length; i++) len += dist(pts[i - 1], pts[i]);
  if (len < 1.3 * (b.w + b.h)) return null;
  // closed = the pen finished near where it started — or crossed back over its own beginning (overshoot)
  const lim = Math.max(24, 0.4 * Math.min(b.w, b.h) + 0.12 * Math.max(b.w, b.h));
  const head = pts.slice(0, Math.ceil(pts.length * 0.35));
  const tail = pts.slice(Math.floor(pts.length * 0.65));
  const last = pts[pts.length - 1];
  const closeD = Math.min(...head.map((p) => dist(p, last)), ...tail.map((p) => dist(p, pts[0])));
  if (closeD > lim) return null;
  let sweep = 0;
  let prev = Math.atan2(pts[0][1] - b.cy, pts[0][0] - b.cx);
  for (let i = 1; i < pts.length; i++) {
    const a = Math.atan2(pts[i][1] - b.cy, pts[i][0] - b.cx);
    let d = a - prev;
    if (d > Math.PI) d -= 2 * Math.PI;
    if (d < -Math.PI) d += 2 * Math.PI;
    sweep += d;
    prev = a;
  }
  if (Math.abs(sweep) < 1.6 * Math.PI) return null;
  return { cx: b.cx, cy: b.cy, rx: b.w / 2 + 8, ry: b.h / 2 + 6 };
}
const segDist = (p, a, b) => {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const t = dx || dy ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy))) : 0;
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
};

const S = (name, attrs = {}) => {
  const n = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  return n;
};
const uid = () => Math.random().toString(36).slice(2, 10);

export function createInk({ scroll, body, state, save, toast }) {
  state.ink ||= {};
  state.inkStyle ||= { c: 'orange', s: 'M' };

  const svg = S('svg', { class: 'ink-svg', 'aria-hidden': 'true' });
  const notesEl = el('div', { class: 'ink-notes' });
  scroll.append(svg, notesEl);
  const reader = scroll.closest('#reader') || document.body;

  let link = null;
  let meta = {};
  let shapes = [];
  let undo = [];
  let redo = [];
  let on = false;
  let tool = 'pen';
  let L = null;
  let seenPen = false;
  let lastPen = 0;
  let cur = null;

  const penOnly = () => (state.inkPenOnly ?? seenPen);
  const colorOf = (id) => COLORS[id] || COLORS.orange;
  const hlWidth = () => SIZES[state.inkStyle.s] * 3 + 8;

  // ---------- layout / anchoring ----------
  const blocks = () => [...body.children].flatMap((c) => (c.classList.contains('prose') ? [...c.children] : [c]));
  function layout() {
    const sr = scroll.getBoundingClientRect();
    const br = body.getBoundingClientRect();
    L = { bl: br.left - sr.left + scroll.scrollLeft, bw: br.width || 1, tops: blocks().map((b) => b.getBoundingClientRect().top - sr.top + scroll.scrollTop), sr };
    svg.style.width = scroll.clientWidth + 'px';
    svg.style.height = body.offsetTop + body.offsetHeight + 80 + 'px';
  }
  const fromEvent = (e) => { const r = scroll.getBoundingClientRect(); return [e.clientX - r.left + scroll.scrollLeft, e.clientY - r.top + scroll.scrollTop]; };
  const topOf = (b) => (b >= 0 && L.tops[b] !== undefined ? L.tops[b] : 0);
  function anchorAt(y) {
    let b = -1;
    for (let i = 0; i < L.tops.length; i++) if (L.tops[i] <= y && (b < 0 || L.tops[i] >= L.tops[b])) b = i;
    return b;
  }
  const toRel = (pts, b) => pts.map(([x, y]) => [Math.round(((x - L.bl) / L.bw) * 10000) / 10000, Math.round((y - topOf(b)) * 10) / 10]);
  const toAbs = (s) => s.p.map(([fx, dy]) => [L.bl + fx * L.bw, topOf(s.b) + dy]);
  const ellAbs = (s) => ({ cx: L.bl + s.fx * L.bw, cy: topOf(s.b) + s.dy, rx: s.rx * L.bw, ry: s.ry });

  // ---------- rendering ----------
  function drawShape(s) {
    const col = colorOf(s.c);
    let node;
    if (s.t === 'pen' || s.t === 'hl') {
      node = S('path', { d: pathD(toAbs(s)), fill: 'none', stroke: col, 'stroke-width': s.w, 'stroke-linecap': s.t === 'hl' ? 'butt' : 'round', 'stroke-linejoin': 'round' });
      if (s.t === 'hl') node.setAttribute('opacity', '.4');
    } else if (s.t === 'ell') {
      const e = ellAbs(s);
      node = S('ellipse', { cx: e.cx, cy: e.cy, rx: e.rx, ry: e.ry, fill: 'none', stroke: col, 'stroke-width': s.w, 'stroke-linejoin': 'round' });
    }
    if (node) { node.dataset.id = s.id; svg.append(node); }
  }
  function leader(note) {
    const t = shapes.find((x) => x.id === note.ref && x.t === 'ell');
    if (!t) return;
    const e = ellAbs(t);
    const nx = L.bl + note.fx * L.bw;
    const ny = topOf(note.b) + note.dy;
    const tx = nx < e.cx ? nx + NOTE_W : nx;
    const ty = ny + 16;
    const a = Math.atan2(ty - e.cy, tx - e.cx);
    const sx = e.cx + e.rx * Math.cos(a);
    const sy = e.cy + e.ry * Math.sin(a);
    svg.append(S('path', { d: `M${sx} ${sy}Q${(sx + tx) / 2} ${sy} ${tx} ${ty}`, fill: 'none', stroke: colorOf(note.c), 'stroke-width': 1.6, 'stroke-dasharray': '4 4', 'stroke-linecap': 'round', opacity: '.8' }));
  }
  function render() {
    if (!link || !scroll.clientWidth) return;
    layout();
    svg.replaceChildren();
    for (const s of shapes) if (s.t !== 'note') drawShape(s);
    for (const s of shapes) if (s.t === 'note') leader(s);
    syncNotes();
  }
  let raf;
  const rerender = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(render); };

  function syncNotes() {
    const have = new Map([...notesEl.children].map((n) => [n.dataset.id, n]));
    for (const s of shapes.filter((x) => x.t === 'note')) {
      let n = have.get(s.id);
      if (!n) n = buildNote(s);
      have.delete(s.id);
      n.style.left = L.bl + s.fx * L.bw + 'px';
      n.style.top = topOf(s.b) + s.dy + 'px';
      n.style.setProperty('--c', colorOf(s.c));
      if (!n.isConnected) notesEl.append(n);
    }
    for (const n of have.values()) n.remove();
  }
  function buildNote(s) {
    const ta = el('textarea', { rows: 1, placeholder: 'Add a comment…', 'aria-label': 'Comment', spellcheck: 'true' });
    ta.value = s.text || '';
    const fit = () => { ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 'px'; };
    let t;
    ta.addEventListener('input', () => { s.text = ta.value; fit(); clearTimeout(t); t = setTimeout(persist, 400); });
    ta.addEventListener('blur', () => {
      if (ta.value.trim()) { persist(); return; }
      shapes = shapes.filter((x) => x.id !== s.id); // an empty comment isn't worth keeping
      persist();
      rerender();
    });
    ta.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); ta.blur(); } });
    const grip = el('div', { class: 'grip', title: 'Drag to move' }, el('span'));
    const x = el('button', { class: 'x', 'aria-label': 'Delete comment', title: 'Delete comment', onclick: () => commit({ del: [s] }) }, '×');
    const n = el('div', { class: 'ink-note', 'data-id': s.id }, grip, ta, x);
    requestAnimationFrame(fit);
    // drag by the grip
    grip.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      grip.setPointerCapture(e.pointerId);
      const sx = e.clientX, sy = e.clientY, ox = parseFloat(n.style.left), oy = parseFloat(n.style.top);
      const mv = (m) => { n.style.left = ox + m.clientX - sx + 'px'; n.style.top = oy + m.clientY - sy + 'px'; };
      const up = () => {
        grip.removeEventListener('pointermove', mv);
        grip.removeEventListener('pointerup', up);
        layout();
        const ax = parseFloat(n.style.left), ay = parseFloat(n.style.top);
        s.b = anchorAt(ay);
        s.fx = Math.round(((ax - L.bl) / L.bw) * 10000) / 10000;
        s.dy = Math.round((ay - topOf(s.b)) * 10) / 10;
        persist();
        render();
      };
      grip.addEventListener('pointermove', mv);
      grip.addEventListener('pointerup', up);
    });
    return n;
  }

  // ---------- history + persistence ----------
  function persist() {
    if (!link) return;
    const keep = shapes.filter((s) => s.t !== 'note' || (s.text || '').trim() || document.activeElement?.closest?.(`[data-id="${s.id}"]`));
    if (keep.length) state.ink[link] = { shapes: keep, t: Date.now(), title: meta.title, sname: meta.sname };
    else delete state.ink[link];
    const keys = Object.keys(state.ink);
    if (keys.length > 80) for (const k of keys.sort((a, b) => state.ink[a].t - state.ink[b].t).slice(0, keys.length - 80)) delete state.ink[k];
    save();
    refreshBar();
  }
  function commit(op) {
    const ids = new Set((op.del || []).map((s) => s.id));
    shapes = shapes.filter((s) => !ids.has(s.id)).concat(op.add || []);
    undo.push(op);
    if (undo.length > 100) undo.shift();
    redo = [];
    persist();
    render();
  }
  function applyInverse(op, from, to) {
    const addIds = new Set((op.add || []).map((s) => s.id));
    shapes = shapes.filter((s) => !addIds.has(s.id)).concat(op.del || []);
    to.push(op);
    persist();
    render();
  }
  const doUndo = () => { const op = undo.pop(); if (op) applyInverse(op, undo, redo); };
  const doRedo = () => {
    const op = redo.pop();
    if (!op) return;
    const delIds = new Set((op.del || []).map((s) => s.id));
    shapes = shapes.filter((s) => !delIds.has(s.id)).concat(op.add || []);
    undo.push(op);
    persist();
    render();
  };

  // ---------- creating shapes ----------
  const base = () => ({ id: uid(), c: state.inkStyle.c, w: SIZES[state.inkStyle.s] });
  function makeEllipse(cx, cy, rx, ry) {
    const b = anchorAt(cy - ry);
    return { ...base(), t: 'ell', b, fx: Math.round(((cx - L.bl) / L.bw) * 10000) / 10000, dy: Math.round((cy - topOf(b)) * 10) / 10, rx: Math.round((rx / L.bw) * 10000) / 10000, ry: Math.round(ry) };
  }
  function makeNoteNear(ell) {
    const e = ellAbs(ell);
    const room = scroll.clientWidth - 8;
    let x = Math.max(e.cx + e.rx + 16, L.bl + L.bw - 16); // prefer the margin so the comment doesn't cover the text
    let y = e.cy - 18;
    if (x + NOTE_W > room) { x = Math.max(8, Math.min(e.cx - e.rx, room - NOTE_W)); y = e.cy + e.ry + 12; }
    const b = anchorAt(y);
    return { ...base(), t: 'note', b, fx: Math.round(((x - L.bl) / L.bw) * 10000) / 10000, dy: Math.round((y - topOf(b)) * 10) / 10, text: '', ref: ell.id };
  }
  function focusNote(id) {
    requestAnimationFrame(() => notesEl.querySelector(`[data-id="${id}"] textarea`)?.focus({ preventScroll: false }));
  }
  function finishStroke(c) {
    let pts = c.pts;
    if (c.tool === 'hl') {
      const b = bbox(pts);
      if (b.w > 30 && b.h < 22) { const y = pts.reduce((a, p) => a + p[1], 0) / pts.length; pts = [[b.x0, y], [b.x1, y]]; } // a tidy marker line
    } else {
      const loop = detectLoop(pts);
      if (loop) {
        const ell = makeEllipse(loop.cx, loop.cy, loop.rx, loop.ry);
        const note = makeNoteNear(ell);
        commit({ add: [ell, note] });
        focusNote(note.id);
        return;
      }
    }
    pts = simplify(pts, 1.1);
    const b = anchorAt(pts[0][1]);
    commit({ add: [{ ...base(), t: c.tool, w: c.tool === 'hl' ? hlWidth() : SIZES[state.inkStyle.s], b, p: toRel(pts, b) }] });
  }

  // ---------- eraser ----------
  function hits(s, p, r) {
    if (s.t === 'pen' || s.t === 'hl') {
      const a = toAbs(s);
      const rr = r + s.w / 2;
      if (a.length === 1) return dist(a[0], p) < rr;
      for (let i = 1; i < a.length; i++) if (segDist(p, a[i - 1], a[i]) < rr) return true;
      return false;
    }
    if (s.t === 'ell') {
      const e = ellAbs(s);
      const k = Math.hypot((p[0] - e.cx) / (e.rx + r), (p[1] - e.cy) / (e.ry + r));
      const inner = Math.hypot((p[0] - e.cx) / Math.max(1, e.rx - r), (p[1] - e.cy) / Math.max(1, e.ry - r));
      return k <= 1 && inner >= 1;
    }
    return false;
  }
  function eraseAt(p, c) {
    for (const s of shapes.slice()) {
      if (s.t === 'note' || c.gone.has(s.id) || !hits(s, p, 10)) continue;
      c.gone.set(s.id, s);
      shapes = shapes.filter((x) => x.id !== s.id);
      if (s.t === 'ell') for (const n of shapes.filter((x) => x.ref === s.id)) { c.gone.set(n.id, n); shapes = shapes.filter((x) => x.id !== n.id); }
      c.dirty = true;
    }
    if (c.dirty) { c.dirty = false; render(); }
  }

  // ---------- pointer handling ----------
  function onDown(e) {
    if (!on || tool === 'read' || !link) return;
    if (e.pointerType === 'pen') { seenPen = true; lastPen = Date.now(); }
    if (e.pointerType === 'touch' && (penOnly() || Date.now() - lastPen < 700)) {
      svg.setPointerCapture(e.pointerId);
      cur = { tool: 'scroll', x: e.clientX, y: e.clientY };
      return;
    }
    if (e.button !== 0 && !(e.buttons & 32)) return;
    e.preventDefault();
    if (document.activeElement?.matches?.('textarea')) document.activeElement.blur();
    layout();
    try { svg.setPointerCapture(e.pointerId); } catch {}
    const t = e.buttons & 32 || e.button === 5 ? 'eraser' : tool;
    const p = fromEvent(e);
    if (t === 'note') {
      const b = anchorAt(p[1]);
      const n = { ...base(), t: 'note', b, fx: Math.round(((p[0] - L.bl) / L.bw) * 10000) / 10000, dy: Math.round((p[1] - topOf(b)) * 10) / 10, text: '' };
      commit({ add: [n] });
      focusNote(n.id);
      cur = null;
      return;
    }
    cur = { tool: t, pts: [p], start: p, gone: new Map() };
    if (t === 'eraser') { eraseAt(p, cur); return; }
    cur.el = S(t === 'ell' ? 'ellipse' : 'path', { fill: 'none', stroke: colorOf(state.inkStyle.c), 'stroke-width': t === 'hl' ? hlWidth() : SIZES[state.inkStyle.s], 'stroke-linecap': t === 'hl' ? 'butt' : 'round', 'stroke-linejoin': 'round' });
    if (t === 'hl') cur.el.setAttribute('opacity', '.4');
    svg.append(cur.el);
    paintLive();
  }
  function paintLive() {
    if (!cur?.el) return;
    if (cur.tool === 'ell') {
      const [a, b] = [cur.start, cur.pts[cur.pts.length - 1]];
      cur.el.setAttribute('cx', (a[0] + b[0]) / 2);
      cur.el.setAttribute('cy', (a[1] + b[1]) / 2);
      cur.el.setAttribute('rx', Math.abs(b[0] - a[0]) / 2);
      cur.el.setAttribute('ry', Math.abs(b[1] - a[1]) / 2);
    } else cur.el.setAttribute('d', pathD(cur.pts));
  }
  function onMove(e) {
    if (!cur) return;
    if (cur.tool === 'scroll') {
      scroll.scrollTop -= e.clientY - cur.y;
      scroll.scrollLeft -= e.clientX - cur.x;
      cur.x = e.clientX; cur.y = e.clientY;
      return;
    }
    const evs = e.getCoalescedEvents?.() || [e];
    for (const ev of evs.length ? evs : [e]) {
      const p = fromEvent(ev);
      if (cur.tool === 'eraser') { eraseAt(p, cur); continue; }
      if (cur.tool === 'ell') cur.pts = [cur.start, p];
      else if (dist(p, cur.pts[cur.pts.length - 1]) > 0.8) cur.pts.push(p);
    }
    paintLive();
  }
  function onUp() {
    const c = cur;
    cur = null;
    if (!c || c.tool === 'scroll') return;
    c.el?.remove();
    if (c.tool === 'eraser') { if (c.gone.size) { undo.push({ del: [...c.gone.values()] }); redo = []; persist(); render(); } return; }
    if (c.tool === 'ell') {
      const b = bbox([c.start, c.pts[c.pts.length - 1]]);
      if (b.w < 14 || b.h < 10) return;
      const ell = makeEllipse(b.cx, b.cy, b.w / 2, b.h / 2);
      const note = makeNoteNear(ell);
      commit({ add: [ell, note] });
      focusNote(note.id);
      return;
    }
    finishStroke(c);
  }
  svg.addEventListener('pointerdown', onDown);
  svg.addEventListener('pointermove', onMove);
  svg.addEventListener('pointerup', onUp);
  svg.addEventListener('pointercancel', () => { cur?.el?.remove(); cur = null; });
  svg.addEventListener('contextmenu', (e) => on && e.preventDefault());

  // Pen touches the page without ink mode on → start drawing straight away (tablet mode).
  scroll.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'pen' || on || !link || e.target.closest('a,button,textarea,.ink-note')) return;
    seenPen = true;
    enter(state.inkStyle.tool || 'pen');
    onDown(e);
  }, true);

  // ---------- toolbar ----------
  const bar = el('div', { class: 'ink-bar', role: 'toolbar', 'aria-label': 'Drawing tools', hidden: true });
  const panel = el('div', { class: 'ink-style', hidden: true });
  reader.append(bar, panel);
  const toolBtns = {};
  for (const [id, label] of TOOLS) {
    const b = el('button', { class: 'ink-btn', title: label, 'aria-label': label, 'aria-pressed': 'false', onclick: () => setTool(id) });
    b.innerHTML = ICONS[TOOL_ICON[id]];
    toolBtns[id] = b;
  }
  const mk = (icon, title, fn, cls = '') => { const b = el('button', { class: 'ink-btn ' + cls, title, 'aria-label': title, onclick: fn }); b.innerHTML = icon; return b; };
  const undoB = mk(ICONS.undo, 'Undo (Ctrl/⌘ Z)', () => doUndo());
  const redoB = mk(ICONS.redo, 'Redo (Ctrl/⌘ Shift Z)', () => doRedo());
  const doneB = mk(ICONS.close, 'Done (Esc)', () => exit(), 'done');
  bar.append(...Object.values(toolBtns), el('i', { class: 'sep' }), undoB, redoB, el('i', { class: 'sep' }), doneB);

  function buildPanel() {
    const st = state.inkStyle;
    panel.replaceChildren(
      el('div', { class: 'ink-colors' }, ...GRID.map((id) => el('button', { class: 'ink-dot' + (st.c === id ? ' on' : ''), style: `--c:${COLORS[id]}`, title: id, 'aria-label': 'Colour ' + id, onclick: () => { st.c = id; save(); buildPanel(); } }))),
      el('div', { class: 'ink-sizes' }, ...Object.keys(SIZES).map((k) => el('button', { class: st.s === k ? 'on' : '', onclick: () => { st.s = k; save(); buildPanel(); } }, k))),
      el('label', { class: 'ink-opt', title: 'Fingers scroll, only the pen draws — best on a tablet' },
        el('input', { type: 'checkbox', checked: penOnly(), onchange: (e) => { state.inkPenOnly = e.target.checked; save(); } }), el('span', { text: 'Only the pen draws' })),
      el('button', { class: 'ink-clear', onclick: () => { if (shapes.length && confirm('Remove all drawings and comments on this article?')) commit({ del: shapes.slice() }); } }, 'Clear this article'));
  }
  function refreshBar() {
    undoB.disabled = !undo.length;
    redoB.disabled = !redo.length;
    for (const [id, b] of Object.entries(toolBtns)) { b.classList.toggle('on', on && id === tool); b.setAttribute('aria-pressed', String(on && id === tool)); }
    panel.hidden = !on || !['pen', 'hl', 'ell', 'note'].includes(tool);
    reader.classList.toggle('ink-on', on && tool !== 'read');
    reader.dataset.inkTool = on ? tool : '';
    $btn?.classList.toggle('on', on);
  }
  function setTool(t) {
    tool = t;
    if (['pen', 'hl', 'ell', 'note'].includes(t)) state.inkStyle.tool = t;
    cur = null;
    if (!panel.hidden || t !== 'read') buildPanel();
    refreshBar();
  }
  function enter(t = 'pen') {
    if (!link) return;
    on = true;
    bar.hidden = false;
    document.querySelector('#rPane2')?.setAttribute('hidden', '');
    document.querySelector('#rSplit')?.classList.remove('has2');
    layout();
    setTool(t);
    render();
  }
  function exit() {
    on = false;
    cur = null;
    bar.hidden = true;
    panel.hidden = true;
    reader.classList.remove('ink-on');
    reader.dataset.inkTool = '';
    $btn?.classList.remove('on');
    if (document.activeElement?.matches?.('.ink-note textarea')) document.activeElement.blur();
  }

  // ---------- keys ----------
  document.addEventListener('keydown', (e) => {
    if (!on || reader.hidden) return;
    const typing = e.target.matches?.('input, textarea, select');
    if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); if (typing) e.target.blur(); else exit(); return; }
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z' && !typing) { e.preventDefault(); e.stopPropagation(); e.shiftKey ? doRedo() : doUndo(); return; }
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'y' && !typing) { e.preventDefault(); doRedo(); return; }
    if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
    const t = TOOLS.find((x) => x[2] === e.key.toLowerCase());
    if (t) { e.preventDefault(); e.stopPropagation(); setTool(t[0]); }
  }, true);

  // ---------- keep in step with the page ----------
  const ro = new ResizeObserver(() => rerender());
  ro.observe(body);
  ro.observe(scroll);
  document.addEventListener('quiet-theme', rerender);

  const $btn = document.querySelector('#rInk');
  if ($btn) { $btn.innerHTML = ICONS.pen; $btn.onclick = () => (on ? exit() : enter(state.inkStyle.tool || 'pen')); }

  return {
    isOn: () => on,
    toggle: () => (on ? exit() : enter(state.inkStyle.tool || 'pen')),
    exit,
    load(url, m = {}) {
      link = url;
      meta = m;
      shapes = structuredClone(state.ink[url]?.shapes || []);
      undo = [];
      redo = [];
      render();
      refreshBar();
    },
    unload() {
      exit();
      link = null;
      shapes = [];
      svg.replaceChildren();
      notesEl.replaceChildren();
    },
    count: (url) => state.ink[url]?.shapes?.length || 0,
  };
}
