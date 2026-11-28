import { state, save, uid } from './store.js';
import { renderMarkdown, wordCount } from './md.js';
import { $, $$, el, download, hydrate, icon, dayKey } from './ui.js';

const root = () => $('#writer');
let mode = 'write';
let current = null;
let saveTimer;

// ---- writing statistics ----
let prevW = 0;
let prevP = 0;
let lastType = 0;
const paraCount = (t) => t.split(/\n\s*\n/).filter((x) => x.trim()).length;
const dayStat = (o = 0) => state.writeStats[dayKey(o)] || { w: 0, p: 0, s: 0 };
function track() {
  const t = ta().value;
  const w = wordCount(t);
  const p = paraCount(t);
  const st = (state.writeStats[dayKey()] ||= { w: 0, p: 0, s: 0 });
  const dw = w - prevW;
  // Net words written today: typing adds, deleting takes away (never below zero).
  // A sudden jump up of 150+ words is a paste, not writing, so it isn't counted.
  if (dw < 0 || dw <= 150) st.w = Math.max(0, st.w + dw);
  const dp = p - prevP;
  if (dp < 0 || dp <= 10) st.p = Math.max(0, st.p + dp);
  const now = Date.now();
  if (lastType && now - lastType < 10000) st.s += (now - lastType) / 1000;
  lastType = now;
  prevW = w;
  prevP = p;
}

// ---- typewriter + sentence focus ----
const escH = (x) => x.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const TERM = /[.!?…]/;

function sentenceRange(t, p) {
  let s = p;
  while (s > 0 && t[s - 1] !== '\n' && !(/\s/.test(t[s - 1]) && /[.!?…]["')\]”’]*$/.test(t.slice(Math.max(0, s - 5), s - 1)))) s--;
  let e = p;
  while (e < t.length && t[e] !== '\n') {
    if (TERM.test(t[e])) {
      e++;
      while (e < t.length && /["')\]”’]/.test(t[e])) e++;
      if (e >= t.length || /\s/.test(t[e])) break;
      continue;
    }
    e++;
  }
  return [s, e];
}

function fit() {
  const t = ta();
  t.style.height = 'auto';
  t.style.height = t.scrollHeight + 'px';
}
function paintFocus() {
  const m = $('#wMirror');
  if (!state.writer.sf) { m.textContent = ''; return; }
  const t = ta().value;
  const [s, e] = sentenceRange(t, ta().selectionStart);
  m.innerHTML = escH(t.slice(0, s)) + '<mark>' + escH(t.slice(s, e)) + '</mark>' + escH(t.slice(e)) + '\u200b';
}
function typewrite() {
  if (!state.writer.tw) return;
  const t = ta();
  const m = $('#wMeasure');
  m.innerHTML = escH(t.value.slice(0, t.selectionStart)) + '<span id="wCaret">\u200b</span>';
  const y = $('#wCaret').offsetTop;
  const pane = $('#wEditPane');
  const target = Math.max(0, t.offsetTop + y - pane.clientHeight * 0.42);
  if (Math.abs(pane.scrollTop - target) > 6) pane.scrollTo({ top: target });
}
function refresh(withScroll = false) {
  fit();
  paintFocus();
  if (withScroll) typewrite();
}
function applyModes() {
  root().classList.toggle('typewriter', !!state.writer.tw);
  root().classList.toggle('sentence', !!state.writer.sf);
  $('#wTW').classList.toggle('on', !!state.writer.tw);
  $('#wSF').classList.toggle('on', !!state.writer.sf);
  refresh(true);
}

const ta = () => $('#wText');
const titleEl = () => $('#wTitle');

function newDraft() {
  const d = { id: uid(), title: '', body: '', updated: Date.now() };
  state.drafts.unshift(d);
  state.activeDraft = d.id;
  save();
  return d;
}

function load(id) {
  current = state.drafts.find((d) => d.id === id) || state.drafts[0] || newDraft();
  state.activeDraft = current.id;
  titleEl().value = current.title;
  ta().value = current.body;
  prevW = wordCount(current.body);
  prevP = paraCount(current.body);
  lastType = 0;
  update();
  renderList();
}

function update() {
  refresh();
  const words = wordCount(ta().value);
  $('#wCount').textContent = `${words.toLocaleString()} word${words === 1 ? '' : 's'} · ${Math.max(1, Math.round(words / 230))} min read`;
  if (mode !== 'write') $('#wPrevPane').innerHTML = previewHtml();
  const goal = state.goal || 0;
  const today = dayStat().w;
  $('#wProg').style.width = goal ? Math.min(100, (today / goal) * 100) + '%' : '0';
  $('#wGoalNote').textContent = `Today ${today.toLocaleString()}` + (goal ? (today >= goal ? ' · goal reached 🎉' : ` · ${(goal - today).toLocaleString()} to go`) : '');
}

function previewHtml() {
  const tmp = document.createElement('div');
  const t = titleEl().value.trim();
  if (t) tmp.append(el('h1', { text: t }));
  const body = document.createElement('div');
  body.innerHTML = renderMarkdown(ta().value); // renderMarkdown escapes all user HTML
  tmp.append(...body.childNodes);
  return tmp.innerHTML;
}

function scheduleSave() {
  $('#wSaved').textContent = 'Saving…';
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    current.title = titleEl().value;
    current.body = ta().value;
    current.updated = Date.now();
    save();
    $('#wSaved').textContent = 'Saved on this device';
    renderList();
  }, 400);
}

function renderList() {
  const box = $('#wList');
  box.replaceChildren(
    el('button', { class: 'btn wide primary-soft', onclick: () => { flush(); newDraft(); load(state.activeDraft); ta().focus(); } }, 'New draft'),
    ...state.drafts
      .slice()
      .sort((a, b) => b.updated - a.updated)
      .map((d) =>
        el('div', { class: 'draft' + (d.id === current?.id ? ' on' : '') },
          el('button', { class: 'draft-main', onclick: () => { flush(); load(d.id); } },
            el('strong', { text: d.title || firstLine(d.body) || 'Untitled' }),
            el('span', { text: `${wordCount(d.body)} words · ${new Date(d.updated).toLocaleDateString()}` })),
          el('button', { class: 'icon-btn', 'aria-label': 'Delete draft', html: icon('close'), onclick: () => {
            if (!confirm('Delete this draft?')) return;
            state.drafts = state.drafts.filter((x) => x.id !== d.id);
            if (!state.drafts.length) newDraft();
            save();
            load(state.drafts[0].id);
          } })
        )
      )
  );
}

const firstLine = (s) => s.trim().split('\n')[0].replace(/^#+\s*/, '').slice(0, 60);

function flush() {
  if (!current) return;
  clearTimeout(saveTimer);
  current.title = titleEl().value;
  current.body = ta().value;
  current.updated = Date.now();
  save();
}

function setMode(m) {
  mode = m;
  $$('#wMode button').forEach((b) => b.classList.toggle('on', b.dataset.mode === m));
  root().dataset.mode = m;
  $('#wEditPane').hidden = m === 'read';
  $('#wPrevPane').hidden = m === 'write';
  update();
}

// --- formatting helpers
function wrap(before, after = before, placeholder = 'text') {
  const t = ta();
  const { selectionStart: s, selectionEnd: e, value } = t;
  const sel = value.slice(s, e) || placeholder;
  t.value = value.slice(0, s) + before + sel + after + value.slice(e);
  t.focus();
  t.setSelectionRange(s + before.length, s + before.length + sel.length);
  t.dispatchEvent(new Event('input'));
}
function linePrefix(prefix) {
  const t = ta();
  const { selectionStart: s, value } = t;
  const ls = value.lastIndexOf('\n', s - 1) + 1;
  t.value = value.slice(0, ls) + prefix + value.slice(ls);
  t.focus();
  t.setSelectionRange(s + prefix.length, s + prefix.length);
  t.dispatchEvent(new Event('input'));
}

const TOOLS = [
  ['H', 'Heading', () => linePrefix('## ')],
  ['B', 'Bold (Ctrl/⌘+B)', () => wrap('**')],
  ['I', 'Italic (Ctrl/⌘+I)', () => wrap('*')],
  ['❝', 'Quote', () => linePrefix('> ')],
  ['•', 'List', () => linePrefix('- ')],
  ['</>', 'Code', () => wrap('`')],
  ['↗', 'Link (Ctrl/⌘+K)', () => wrap('[', '](https://)', 'link text')],
];

function exportHtml() {
  const cs = getComputedStyle(document.documentElement);
  const v = (n) => cs.getPropertyValue(n).trim();
  const title = (titleEl().value || 'Untitled').replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>
<style>body{margin:0;background:${v('--bg')};color:${v('--fg')};font:${v('--read-size') || '19px'}/1.7 ${v('--font-body')}}
main{max-width:680px;margin:0 auto;padding:6vh 22px 12vh}h1,h2,h3{line-height:1.2;font-weight:600}h1{font-size:2.1em}a{color:${v('--accent')}}
blockquote{margin:1.4em 0;padding-left:1em;border-left:3px solid ${v('--accent')};opacity:.85}img{max-width:100%;height:auto}
code{background:rgba(127,127,127,.15);padding:.1em .35em;border-radius:4px;font-size:.88em}pre{background:rgba(127,127,127,.12);padding:1em;overflow:auto;border-radius:8px}pre code{background:none;padding:0}hr{border:0;border-top:1px solid rgba(127,127,127,.3);margin:2em 0}</style>
</head><body><main>${previewHtml()}</main></body></html>`;
}

export function quoteIntoDraft(md) {
  let d = state.drafts.find((x) => x.id === state.activeDraft);
  if (!d) d = newDraft();
  d.body = (d.body ? d.body.replace(/\s+$/, '') + '\n\n' : '') + md + '\n\n';
  d.updated = Date.now();
  save();
  openWriter();
  ta().focus();
  ta().setSelectionRange(ta().value.length, ta().value.length);
}

export function openWriter() {
  const w = root();
  w.hidden = false;
  document.body.classList.add('no-scroll');
  if (!state.drafts.length) newDraft();
  load(state.activeDraft || state.drafts[0].id);
  setMode(mode);
  applyModes();
  (current.body ? ta() : titleEl()).focus();
}

export function initWriter() {
  hydrate(root());
  $('#wDrafts').innerHTML = icon('files');
  const gi = $('#wGoalIn');
  gi.value = state.goal || '';
  gi.oninput = () => { state.goal = Math.max(0, parseInt(gi.value, 10) || 0); save(); update(); };
  $('#wTools').replaceChildren(...TOOLS.map(([label, tip, fn]) => el('button', { type: 'button', title: tip, 'aria-label': tip, onclick: fn }, label)));

  ta().addEventListener('input', () => { track(); update(); typewrite(); scheduleSave(); });
  ta().addEventListener('keyup', (e) => { if (e.key.startsWith('Arrow') || e.key === 'Enter') typewrite(); });
  document.addEventListener('selectionchange', () => { if (document.activeElement === ta()) paintFocus(); });
  document.addEventListener('quiet-theme', () => { if (!root().hidden) refresh(); });
  window.addEventListener('resize', () => { if (!root().hidden) refresh(); });
  $('#wStats').onclick = openStats;
  $('#wTW').onclick = () => { state.writer.tw = !state.writer.tw; save(); applyModes(); };
  $('#wSF').onclick = () => { state.writer.sf = !state.writer.sf; save(); applyModes(); };
  titleEl().addEventListener('input', () => { update(); scheduleSave(); });
  titleEl().addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); ta().focus(); } });

  ta().addEventListener('keydown', (e) => {
    const mod = e.metaKey || e.ctrlKey;
    if (!mod) return;
    const k = e.key.toLowerCase();
    if (k === 'b') { e.preventDefault(); wrap('**'); }
    else if (k === 'i') { e.preventDefault(); wrap('*'); }
    else if (k === 'k') { e.preventDefault(); wrap('[', '](https://)', 'link text'); }
  });

  $('#wClose').onclick = () => { flush(); root().hidden = true; root().classList.remove('focus'); document.body.classList.remove('no-scroll'); };
  $('#wDrafts').onclick = () => { const l = $('#wList'); l.hidden = !l.hidden; };
  $('#wFocus').onclick = () => root().classList.toggle('focus');
  $$('#wMode button').forEach((b) => (b.onclick = () => setMode(b.dataset.mode)));

  const menu = $('#wExportMenu');
  $('#wExport').onclick = (e) => { e.stopPropagation(); menu.hidden = !menu.hidden; };
  document.addEventListener('click', () => (menu.hidden = true));
  menu.onclick = async (e) => {
    const x = e.target.dataset?.x;
    if (!x) return;
    const name = (titleEl().value || 'untitled').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'untitled';
    const md = (titleEl().value ? `# ${titleEl().value}\n\n` : '') + ta().value;
    if (x === 'md') download(name + '.md', md, 'text/markdown');
    if (x === 'html') download(name + '.html', exportHtml(), 'text/html');
    try {
      if (x === 'copy') await navigator.clipboard.writeText(md);
      if (x === 'copyhtml') await navigator.clipboard.writeText(previewHtml());
      if (x.startsWith('copy')) $('#wSaved').textContent = 'Copied';
    } catch { $('#wSaved').textContent = 'Copy failed'; }
  };

  document.addEventListener('keydown', (e) => {
    if (root().hidden) return;
    if (e.key === 'Escape' && root().classList.contains('focus')) root().classList.remove('focus');
  });
  window.addEventListener('beforeunload', flush);
}


// ---- stats dialog ----
const fmtMin = (sec) => (sec < 60 ? '' : sec < 3600 ? `${Math.round(sec / 60)} min` : `${Math.floor(sec / 3600)} hr ${Math.round((sec % 3600) / 60)} min`);
const longDay = (o) => new Date(Date.now() + o * 864e5).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
let statRange = 14;

function streak() {
  let n = 0;
  let o = dayStat(0).w > 0 ? 0 : -1; // today may not be written yet
  while (dayStat(o).w > 0 && n < 1000) { n++; o--; }
  return n;
}

export function openStats() {
  renderStats();
  $('#statsDlg').showModal();
}

function renderStats() {
  const box = $('#statsBody');
  const t = dayStat(0);
  const y = dayStat(-1);
  let week = 0, weekP = 0;
  for (let o = 0; o > -7; o--) { week += dayStat(o).w; weekP += dayStat(o).p; }
  const best = Math.max(0, ...Object.values(state.writeStats).map((d) => d.w));
  const goal = state.goal || 0;
  const msg = y.w > 0
    ? `Yesterday you wrote ${y.w.toLocaleString()} word${y.w === 1 ? '' : 's'} in ${y.p} paragraph${y.p === 1 ? '' : 's'}.${t.w ? ` Today: ${t.w.toLocaleString()} so far.` : ' Today is still blank — a few lines is enough.'}`
    : t.w > 0 ? `Today you've written ${t.w.toLocaleString()} word${t.w === 1 ? '' : 's'} in ${t.p} paragraph${t.p === 1 ? '' : 's'}.` : 'Write a few lines today and your numbers start here.';

  const card = (label, big, sub) => el('div', { class: 'st-card' }, el('small', { text: label }), el('strong', { text: big }), el('span', { text: sub }));
  const days = Array.from({ length: statRange }, (_, i) => -(statRange - 1 - i));
  const max = Math.max(goal, ...days.map((o) => dayStat(o).w), 1);

  const chart = el('div', { class: 'st-chart', role: 'img', 'aria-label': `Words written per day, last ${statRange} days` },
    goal ? el('div', { class: 'st-goal', style: `bottom:${(goal / max) * 100}%` }, el('em', { text: `goal ${goal}` })) : null,
    ...days.map((o) => {
      const d = dayStat(o);
      return el('div', { class: 'col' + (o === 0 ? ' t' : '') + (goal && d.w >= goal ? ' hit' : ''), title: `${longDay(o)}: ${d.w ? `${d.w.toLocaleString()} words · ${d.p} paragraphs` : 'nothing written'}` },
        el('i', { style: `height:${d.w ? Math.max(2, (d.w / max) * 100) : 0}%` }));
    }));

  const pick = el('input', { type: 'date', max: dayKey(), 'aria-label': 'Look up a day' });
  const pickOut = el('span', { class: 'muted', text: 'Pick any day to see what you wrote.' });
  pick.onchange = () => {
    const st = state.writeStats[pick.value];
    const when = new Date(pick.value + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    pickOut.textContent = st && st.w ? `${when}: ${st.w.toLocaleString()} words in ${st.p} paragraphs${fmtMin(st.s) ? ` · about ${fmtMin(st.s)} of writing` : ''}.` : `${when}: nothing written.`;
  };

  box.replaceChildren(
    el('p', { class: 'st-msg', text: msg }),
    el('div', { class: 'st-cards' },
      card('Today', t.w.toLocaleString(), `${t.p} paragraphs${fmtMin(t.s) ? ' · ' + fmtMin(t.s) : ''}`),
      card('Yesterday', y.w.toLocaleString(), `${y.p} paragraphs`),
      card('Last 7 days', week.toLocaleString(), `${weekP} paragraphs`),
      card('Streak', `${streak()} day${streak() === 1 ? '' : 's'}`, best ? `best day ${best.toLocaleString()} words` : 'write today to start')),
    el('div', { class: 'seg', style: 'margin:0 0 10px;width:max-content' },
      ...[7, 14, 30, 90].map((n) => el('button', { class: n === statRange ? 'on' : '', onclick: () => { statRange = n; renderStats(); } }, n + ' days'))),
    chart,
    el('div', { class: 'st-axis' }, el('span', { text: longDay(days[0]) }), el('span', { text: 'today' })),
    el('div', { class: 'st-pick' }, el('label', { text: 'Look up a day: ' }), pick, pickOut));
}
