import { state, cache, save, saveCache, replaceAll, wipe, hash, saveLink, unsave, uid } from './store.js';
import { PRESETS, FONTS, applyTheme, resolveColors, fontStack, loadAllFonts } from './themes.js';
import { $, $$, el, icon, hydrate, ago, dayLabel, hue, download } from './ui.js';
import { initWriter, openWriter, quoteIntoDraft } from './writer.js';

const PAGE = 30;
const view = { filter: 'all', source: null, limit: PAGE };
let visible = [];
let refreshing = false;

const STARTERS = [
  ['Paul Graham', 'paulgraham.com'],
  ['Simon Willison', 'simonwillison.net'],
  ['Dan Luu', 'danluu.com'],
  ['Julia Evans', 'jvns.ca'],
  ['Wait But Why', 'waitbutwhy.com'],
  ['Next.js releases (GitHub)', 'github.com/vercel/next.js'],
];

// ---------- API ----------
async function api(path, params) {
  const u = new URL(path, location.origin);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  const r = await fetch(u);
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || 'Request failed');
  return j;
}

// ---------- data ----------
const srcById = (id) => state.sources.find((s) => s.id === id);
const keyOf = (sid, itemId) => sid + '|' + itemId;
const slim = (it) => ({ id: it.id, title: it.title, link: it.link, date: it.date, author: it.author, summary: (it.summary || '').slice(0, 220), image: it.image });

function ingest(sid, items) {
  const now = Date.now();
  items.forEach((it, idx) => {
    const k = keyOf(sid, it.id);
    if (!it.date && !state.seen[k]) state.seen[k] = now - idx;
  });
  cache[sid] = { items: items.slice(0, 50).map(slim), fetched: now };
}

function allItems() {
  if (view.filter === 'saved') {
    return Object.entries(state.saved)
      .map(([key, it]) => ({ ...it, key, ts: it.savedAt || 0 }))
      .filter((it) => !view.source || it.sid === view.source)
      .sort((a, b) => b.ts - a.ts);
  }
  const out = [];
  for (const s of state.sources) {
    if (view.source && s.id !== view.source) continue;
    const c = cache[s.id];
    if (!c) continue;
    for (const it of c.items) {
      const key = keyOf(s.id, it.id);
      out.push({ ...it, key, sid: s.id, sname: s.title, ts: it.date ? Date.parse(it.date) : state.seen[key] || c.fetched });
    }
  }
  out.sort((a, b) => b.ts - a.ts);
  return view.filter === 'unread' ? out.filter((it) => !state.read[it.key]) : out;
}

const unreadCount = (sid) => (cache[sid]?.items || []).filter((it) => !state.read[keyOf(sid, it.id)]).length;

// ---------- refresh ----------
async function refreshOne(sid) {
  const s = srcById(sid);
  if (!s) return;
  try {
    const r = await api('/api/feed', { url: s.url, kind: s.kind });
    ingest(sid, r.items);
    if (!s.title && r.title) s.title = r.title;
  } catch (e) {
    cache[sid] = { items: cache[sid]?.items || [], fetched: cache[sid]?.fetched || 0, error: e.message };
  }
  renderRail();
  renderFeed();
}

async function refreshAll(force = false) {
  if (refreshing) return;
  const stale = state.sources.filter((s) => force || !cache[s.id] || Date.now() - cache[s.id].fetched > 10 * 60e3).map((s) => s.id);
  if (!stale.length) return;
  refreshing = true;
  $('#refreshBtn').classList.add('spin');
  const q = [...stale];
  await Promise.all(Array.from({ length: 4 }, async () => { while (q.length) await refreshOne(q.shift()); }));
  refreshing = false;
  $('#refreshBtn').classList.remove('spin');
  save();
  saveCache();
  renderFeed();
}

// ---------- render: rail ----------
function renderRail() {
  const totalUnread = state.sources.reduce((n, s) => n + unreadCount(s.id), 0);
  const savedN = Object.keys(state.saved).length;
  const navItem = (id, label, ic, count) =>
    el('button', { class: 'nav-item' + (view.filter === id && !view.source ? ' on' : ''), onclick: () => setView(id, null) },
      el('span', { html: icon(ic) }), el('span', { class: 'grow', text: label }), count ? el('span', { class: 'count', text: count }) : null);
  $('#nav').replaceChildren(
    navItem('all', 'Everything', 'inbox'),
    navItem('unread', 'Unread', 'dot', totalUnread || ''),
    navItem('saved', 'Saved', 'mark', savedN || ''),
    navItem('highlights', 'Highlights', 'pen', state.highlights.length || '')
  );

  const box = $('#sources');
  if (!state.sources.length) {
    box.replaceChildren(el('p', { class: 'muted pad', text: 'Nothing here yet. Add the first site you actually want to read.' }));
    return;
  }
  box.replaceChildren(
    ...state.sources
      .slice()
      .sort((a, b) => (a.title || a.url).localeCompare(b.title || b.url))
      .map((s) => {
        const n = unreadCount(s.id);
        const err = cache[s.id]?.error;
        const name = s.title || new URL(s.url).hostname;
        return el('div', { class: 'src' + (view.source === s.id ? ' on' : '') },
          el('button', { class: 'src-main', title: err ? 'Problem: ' + err : s.url, onclick: () => setView(view.filter === 'saved' ? 'saved' : 'all', s.id) },
            el('span', { class: 'avatar', style: `--h:${hue(name)}`, text: name[0].toUpperCase() }),
            el('span', { class: 'grow ellipsis', text: name }),
            err ? el('span', { class: 'warn', title: err, text: '!' }) : n ? el('span', { class: 'count', text: n }) : null),
          el('button', { class: 'icon-btn tiny src-x', 'aria-label': 'Rename or remove ' + name, html: icon('gear'), onclick: () => editSource(s) }));
      })
  );
}

function editSource(s) {
  const name = prompt('Rename this source (leave empty to remove it):', s.title || '');
  if (name === null) return;
  if (name.trim()) {
    s.title = name.trim();
  } else if (confirm(`Remove "${s.title || s.url}" from your reading list?`)) {
    state.sources = state.sources.filter((x) => x.id !== s.id);
    delete cache[s.id];
    if (view.source === s.id) view.source = null;
    saveCache();
  }
  save();
  renderRail();
  renderFeed();
}

function setView(filter, source) {
  view.filter = filter;
  view.source = source;
  view.limit = PAGE;
  document.body.classList.remove('rail-open');
  renderRail();
  renderFeed();
  $('#main').scrollTo?.({ top: 0 });
  window.scrollTo({ top: 0 });
}

// ---------- render: feed ----------
function welcome() {
  return el('div', { class: 'welcome' },
    el('h2', { text: 'A reading list that belongs to you.' }),
    el('p', { text: 'No recommendations. No endless scroll. Just the writers, publications and companies you choose, in the order they published.' }),
    el('div', { class: 'row', style: 'justify-content:center;gap:10px' },
      el('button', { class: 'btn primary', onclick: openAdd }, 'Add your first site'),
      el('button', { class: 'btn', onclick: () => $('#impFile').click() }, 'Import from another reader')),
    el('p', { class: 'muted', text: 'Or start with one of these:' }),
    el('div', { class: 'chips' }, ...STARTERS.map(([n, u]) => el('button', { class: 'chip', onclick: () => { openAdd(); $('#addUrl').value = u; $('#addForm').requestSubmit(); } }, n))));
}

function renderFeed() {
  const feed = $('#feed');
  const src = view.source && srcById(view.source);
  $('#viewTitle').textContent = src ? src.title || new URL(src.url).hostname : { all: 'Everything', unread: 'Unread', saved: 'Saved for later', highlights: 'Highlights & notes' }[view.filter];
  if (view.filter === 'highlights') return renderHighlights();
  const items = allItems();
  const un = items.filter((i) => !state.read[i.key]).length;
  const last = Math.max(0, ...state.sources.map((s) => cache[s.id]?.fetched || 0));
  $('#viewSub').textContent = state.sources.length ? `${un} unread · ${last ? 'updated ' + ago(last) : 'not yet fetched'}` : '';
  $('#markAllBtn').hidden = view.filter === 'saved' || !un;

  if (!state.sources.length && view.filter !== 'saved') return feed.replaceChildren(welcome());
  if (!items.length) {
    const msg = view.filter === 'unread' ? "You're all caught up. Nothing new to read." : view.filter === 'saved' ? 'Nothing saved yet. Tap the bookmark on anything you want to come back to.' : refreshing ? 'Fetching your sources…' : 'No articles yet.';
    return feed.replaceChildren(el('p', { class: 'empty', text: msg }));
  }

  visible = items.slice(0, view.limit);
  const nodes = [];
  if (view.filter === 'all' && !view.source) { const st = statBlock(); if (st) nodes.push(st); }
  let lastDay = '';
  for (const it of visible) {
    const label = view.filter === 'saved' ? '' : dayLabel(it.ts);
    if (label && label !== lastDay) {
      nodes.push(el('h2', { class: 'day', text: label }));
      lastDay = label;
    }
    nodes.push(card(it));
  }
  if (items.length > view.limit) {
    nodes.push(el('button', { class: 'btn wide more', onclick: () => { view.limit += PAGE; renderFeed(); } }, `Show ${Math.min(PAGE, items.length - view.limit)} older`));
  } else {
    nodes.push(el('p', { class: 'end', text: view.filter === 'unread' ? "That's everything new." : "That's everything. Nothing more is coming unless you ask for it." }));
  }
  feed.replaceChildren(...nodes);
}

function card(it) {
  const isRead = !!state.read[it.key];
  const saved = !!state.saved[it.key];
  const meta = [it.sname || srcById(it.sid)?.title, it.author, it.date || view.filter === 'saved' ? ago(it.ts) : null].filter(Boolean).join(' · ');
  return el('article', { class: 'card' + (isRead ? ' read' : '') },
    el('div', { class: 'card-main' },
      el('div', { class: 'meta' }, !isRead ? el('i', { class: 'unread-dot' }) : null, meta),
      el('h3', {}, el('a', { href: it.link, onclick: (e) => { if (e.metaKey || e.ctrlKey || e.shiftKey) return; e.preventDefault(); openReader(it); } }, it.title)),
      it.summary ? el('p', { class: 'summary', text: it.summary }) : null),
    it.image ? el('img', { class: 'thumb', src: it.image, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer', onerror: (e) => e.target.remove() }) : null,
    el('div', { class: 'card-actions' },
      el('button', { class: 'icon-btn tiny' + (saved ? ' on' : ''), title: saved ? 'Unsave' : 'Save for later', 'aria-label': 'Save', html: icon('mark', saved), onclick: () => toggleSave(it) }),
      el('button', { class: 'icon-btn tiny', title: isRead ? 'Mark unread' : 'Mark read', 'aria-label': 'Toggle read', html: icon('dot', !isRead), onclick: () => toggleRead(it) })));
}

function toggleSave(it) {
  if (state.saved[it.key]) delete state.saved[it.key];
  else state.saved[it.key] = { ...it, sname: it.sname || srcById(it.sid)?.title, savedAt: Date.now() };
  save();
  renderRail();
  renderFeed();
  syncReaderSave();
}
function toggleRead(it) {
  if (state.read[it.key]) delete state.read[it.key];
  else state.read[it.key] = Date.now();
  save();
  renderRail();
  renderFeed();
}
$('#markAllBtn').onclick = () => {
  for (const it of allItems()) state.read[it.key] = state.read[it.key] || Date.now();
  save();
  renderRail();
  renderFeed();
};

// ---------- reader ----------
let rIdx = -1;
let rItem = null;
let rToken = 0;

function openReader(it) {
  rItem = it;
  rIdx = visible.findIndex((v) => v.key === it.key);
  if (!state.read[it.key]) { state.read[it.key] = Date.now(); save(); renderRail(); renderFeed(); }
  const r = $('#reader');
  r.hidden = false;
  document.body.classList.add('no-scroll');
  $('#rOpen').href = it.link;
  syncReaderSave();
  $('#rPrev').disabled = rIdx <= 0;
  $('#rNext').disabled = rIdx < 0 || rIdx >= visible.length - 1;
  const body = $('#rBody');
  const token = ++rToken;
  body.replaceChildren(
    el('p', { class: 'r-meta', text: (it.sname || srcById(it.sid)?.title || '') }),
    el('h1', { text: it.title }),
    el('div', { class: 'skeleton' }, el('i'), el('i'), el('i'), el('i')));
  $('#rScroll').scrollTop = 0;
  api('/api/article', { url: it.link })
    .then((a) => {
      if (token !== rToken) return;
      const content = el('div', { class: 'prose' });
      content.innerHTML = a.content; // sanitised server-side (scripts, iframes, handlers stripped) + CSP
      queueMicrotask(() => applyHighlights(content, state.highlights.filter((h) => h.url === it.link)));
      body.replaceChildren(
        el('p', { class: 'r-meta', text: [a.siteName, a.byline, `${a.minutes} min read`].filter(Boolean).join(' · ') }),
        el('h1', { text: a.title || it.title }),
        content,
        el('p', { class: 'r-end' }, el('a', { href: it.link, target: '_blank', rel: 'noopener noreferrer' }, 'Read the original on ' + new URL(a.url).hostname + ' ↗')));
    })
    .catch((e) => {
      if (token !== rToken) return;
      body.replaceChildren(
        el('p', { class: 'r-meta', text: it.sname || '' }),
        el('h1', { text: it.title }),
        el('p', { class: 'muted', text: e.message }),
        el('p', {}, el('a', { class: 'btn primary', href: it.link, target: '_blank', rel: 'noopener noreferrer' }, 'Open the original ↗')));
    });
}

function closeReader() {
  $('#reader').hidden = true;
  rToken++;
  if ($('#writer').hidden) document.body.classList.remove('no-scroll');
}
function step(d) {
  const next = visible[rIdx + d];
  if (next) openReader(next);
}
function syncReaderSave() {
  if (!rItem) return;
  const on = !!state.saved[rItem.key];
  $('#rSave').innerHTML = icon('mark', on);
  $('#rSave').classList.toggle('on', on);
}

$('#rBack').onclick = closeReader;
$('#rPrev').onclick = () => step(-1);
$('#rNext').onclick = () => step(1);
$('#rSave').onclick = () => rItem && toggleSave(rItem);
$('#rLook').onclick = openTheme;
$('#rScroll').addEventListener('scroll', (e) => {
  const s = e.target;
  $('#readProgress').style.transform = `scaleX(${s.scrollHeight - s.clientHeight > 0 ? s.scrollTop / (s.scrollHeight - s.clientHeight) : 0})`;
}, { passive: true });

document.addEventListener('keydown', (e) => {
  if (e.target.matches('input, textarea, select') || e.metaKey || e.ctrlKey) return;
  if (!$('#reader').hidden && $('#writer').hidden) {
    if (e.key === 'Escape') closeReader();
    if (e.key === 'j') step(1);
    if (e.key === 'k') step(-1);
  }
});

// ---------- add source ----------
let found = null;
function openAdd() {
  $('#addResult').replaceChildren();
  $('#addUrl').value = '';
  found = null;
  $('#addStarters').replaceChildren(
    el('p', { class: 'muted small-t', text: 'Try:' }),
    el('div', { class: 'chips' }, ...STARTERS.map(([n, u]) => el('button', { type: 'button', class: 'chip', onclick: () => { $('#addUrl').value = u; $('#addForm').requestSubmit(); } }, n))));
  document.body.classList.remove('rail-open');
  $('#addDlg').showModal();
  $('#addUrl').focus();
}

$('#addForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const url = $('#addUrl').value.trim();
  if (!url) return;
  const box = $('#addResult');
  $('#addFind').disabled = true;
  box.replaceChildren(el('p', { class: 'muted', text: 'Looking for a feed…' }));
  try {
    const r = await api('/api/discover', { url });
    found = r;
    const dupe = state.sources.find((s) => s.url === r.feedUrl);
    const name = el('input', { id: 'addName', value: r.title || new URL(r.feedUrl).hostname, 'aria-label': 'Name' });
    box.replaceChildren(
      el('div', { class: 'found' },
        el('div', { class: 'found-head' },
          el('span', { class: 'badge', text: r.kind === 'feed' ? 'Feed found' : 'Watching page' }),
          name),
        r.kind === 'page' ? el('p', { class: 'muted small-t', text: 'This site has no feed, so Quiet will watch the page and show new links as they appear.' }) : null,
        el('ul', { class: 'preview' }, ...r.items.slice(0, 5).map((i) => el('li', { text: i.title }))),
        el('button', { class: 'btn primary wide', disabled: !!dupe, onclick: () => addFound(name.value.trim()) }, dupe ? 'Already in your list' : `Add to my list (${r.items.length} articles)`)));
  } catch (err) {
    box.replaceChildren(el('p', { class: 'error', text: err.message }));
  } finally {
    $('#addFind').disabled = false;
  }
});

function addFound(title) {
  if (!found) return;
  const s = { id: 's_' + hash(found.feedUrl), url: found.feedUrl, kind: found.kind, title: title || found.title, site: found.site, added: Date.now() };
  if (srcById(s.id)) return;
  state.sources.push(s);
  ingest(s.id, found.items);
  save();
  saveCache();
  $('#addDlg').close();
  setView('all', s.id);
}

// ---------- theme ----------
function openTheme() {
  loadAllFonts();
  renderTheme();
  $('#themeDlg').showModal();
}

function renderTheme() {
  const t = state.theme;
  const upd = (patch) => { Object.assign(t, patch); applyTheme(t); save(); renderTheme(); };
  const c = resolveColors(t);
  const slider = (label, key, min, max, step, fmt) => {
    const out = el('output', { text: fmt(t[key]) });
    return el('label', { class: 'slider' }, el('span', { text: label }), el('input', { type: 'range', min, max, step, value: t[key], oninput: (e) => { t[key] = +e.target.value; out.textContent = fmt(t[key]); applyTheme(t); save(); } }), out);
  };
  const color = (label, key) => el('label', { class: 'color' }, el('input', { type: 'color', value: c[key], oninput: (e) => {
    t.custom = { ...c, [key]: e.target.value };
    t.preset = 'custom';
    applyTheme(t);
    save();
    $$('#themeBody .swatch').forEach((x) => x.classList.toggle('on', x.dataset.id === 'custom'));
  } }), el('span', { text: label }));

  $('#themeBody').replaceChildren(
    el('div', { class: 'swatches' },
      ...PRESETS.map((p) => el('button', { class: 'swatch' + (t.preset === p.id ? ' on' : ''), 'data-id': p.id, style: `--sb:${p.bg};--sf:${p.fg};--sa:${p.accent}`, onclick: () => upd({ preset: p.id, custom: { bg: p.bg, fg: p.fg, accent: p.accent } }) },
        el('i'), el('span', { text: p.name })))),
    el('div', { class: 'colors' }, color('Background', 'bg'), color('Text', 'fg'), color('Accent', 'accent')),
    el('h4', { class: 'sec', text: 'Reading font' }),
    el('div', { class: 'fonts' }, ...Object.entries(FONTS).map(([id, f]) => el('button', { class: 'font' + (t.font === id ? ' on' : ''), style: `font-family:${fontStack(id, t)}`, onclick: () => upd({ font: id }) }, f.name))),
    el('form', { class: 'custom-font', onsubmit: (e) => { e.preventDefault(); const v = e.target.elements.cf.value.trim(); if (v) upd({ font: 'custom', customFont: v }); } },
      el('input', { type: 'text', name: 'cf', placeholder: 'Any Google Font, e.g. Vollkorn', value: t.customFont || '', 'aria-label': 'Custom Google Font name' }),
      el('button', { class: 'btn small' + (t.font === 'custom' ? ' primary' : ''), type: 'submit' }, 'Use')),
    el('label', { class: 'slider' }, el('span', { text: 'Headings' }),
      el('select', { onchange: (e) => upd({ headFont: e.target.value }) },
        el('option', { value: 'auto', selected: t.headFont === 'auto' || !t.headFont }, 'Fraunces (default)'),
        el('option', { value: 'same', selected: t.headFont === 'same' }, 'Same as reading font'),
        ...Object.entries(FONTS).map(([id, f]) => el('option', { value: id, selected: t.headFont === id }, f.name)),
        t.customFont ? el('option', { value: 'custom', selected: t.headFont === 'custom' }, t.customFont + ' (custom)') : null),
      el('span')),
    slider('Text size', 'size', 14, 34, 1, (v) => v + 'px'),
    slider('Width', 'width', 480, 960, 20, (v) => v + 'px'),
    slider('Line spacing', 'lh', 1.3, 2.1, 0.05, (v) => v.toFixed(2)),
    slider('List & menus', 'uiScale', 0.85, 1.35, 0.05, (v) => Math.round(v * 100) + '%'),
    el('div', { class: 'sample prose' },
      el('h3', { text: 'The shape of a good sentence' }),
      el('p', { text: 'Reading should feel like a quiet room. Pick the colours, the typeface and the width that make long things easy to finish — then keep them everywhere.' })));
}

// ---------- settings / import / export ----------
const xmlEsc = (s) => String(s).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));

$('#expOpml').onclick = () => {
  const body = state.sources.map((s) => `    <outline type="rss" text="${xmlEsc(s.title || s.url)}" title="${xmlEsc(s.title || s.url)}" xmlUrl="${xmlEsc(s.url)}" htmlUrl="${xmlEsc(s.site || s.url)}"/>`).join('\n');
  download('quiet-sources.opml', `<?xml version="1.0" encoding="UTF-8"?>\n<opml version="2.0"><head><title>Quiet sources</title></head>\n  <body>\n${body}\n  </body></opml>\n`, 'text/x-opml');
};
$('#expJson').onclick = () => download('quiet-backup.json', JSON.stringify(state, null, 2), 'application/json');
$('#wipe').onclick = () => {
  if (!confirm('Erase all sources, saved items, drafts and settings from this browser? This cannot be undone.')) return;
  wipe();
  location.reload();
};
$('#impFile').onchange = (e) => {
  const f = e.target.files[0];
  e.target.value = '';
  if (f) importFile(f);
};
async function importFile(f) {
  const msg = $('#settingsMsg');
  try {
    const text = await f.text();
    if (text.trimStart().startsWith('{')) {
      const j = JSON.parse(text);
      if (!Array.isArray(j.sources)) throw new Error('Not a Quiet backup');
      if (!confirm('Replace everything in this browser with the backup?')) return;
      replaceAll(j);
      location.reload();
      return;
    }
    const doc = new DOMParser().parseFromString(text, 'text/xml');
    let n = 0;
    for (const o of doc.querySelectorAll('outline[xmlUrl]')) {
      const url = o.getAttribute('xmlUrl');
      if (!/^https?:\/\//i.test(url)) continue;
      const id = 's_' + hash(url);
      if (srcById(id)) continue;
      state.sources.push({ id, url, kind: 'feed', title: o.getAttribute('title') || o.getAttribute('text') || '', site: o.getAttribute('htmlUrl') || url, added: Date.now() });
      n++;
    }
    save();
    msg.textContent = `Imported ${n} source${n === 1 ? '' : 's'}.`;
    toast(`Imported ${n} source${n === 1 ? '' : 's'} — fetching…`);
    renderRail();
    renderFeed();
    refreshAll();
  } catch (err) {
    msg.textContent = 'Could not import: ' + err.message;
    toast('Could not import: ' + err.message);
  }
}

// ---------- wire up ----------
$('#addBtn').onclick = openAdd;
$('#refreshBtn').onclick = () => refreshAll(true);
$('#themeBtn').onclick = openTheme;
$('#settingsBtn').onclick = () => { $('#settingsMsg').textContent = ''; renderCapture(); $('#settingsDlg').showModal(); };
$('#writeBtn').onclick = () => { document.body.classList.remove('rail-open'); openWriter(); };
$('#menuBtn').onclick = () => document.body.classList.toggle('rail-open');
$('#scrim').onclick = () => document.body.classList.remove('rail-open');
for (const d of $$('dialog')) d.addEventListener('click', (e) => { if (e.target === d) d.close(); });

applyTheme(state.theme);
hydrate();
$('#addBtn').innerHTML = icon('plus');
$('#refreshBtn').innerHTML = icon('refresh');
$('#menuBtn').innerHTML = icon('menu');
$('#rPrev').innerHTML = icon('up');
$('#rNext').innerHTML = icon('down');
$('#rLook').innerHTML = icon('palette');
$('#rOpen').innerHTML = icon('external');
initWriter();
renderRail();
renderFeed();
refreshAll();


// ---------- toast ----------
let toastT;
function toast(msg, action, fn) {
  const t = $('#toast');
  t.replaceChildren(el('span', { text: msg }), action ? el('button', { onclick: () => { fn(); t.hidden = true; } }, action) : null);
  t.hidden = false;
  clearTimeout(toastT);
  toastT = setTimeout(() => (t.hidden = true), action ? 6000 : 3500);
}

// ---------- capture: save any link ----------
function quickSave(url, title = '') {
  try {
    const { key, existed } = saveLink(url, title);
    renderRail();
    if (view.filter === 'saved') renderFeed();
    toast(existed ? 'Already in Saved' : 'Saved for later', existed ? null : 'Undo', () => { unsave(key); renderRail(); renderFeed(); });
    enrichSaved();
    return true;
  } catch {
    return false;
  }
}

// Fill in titles for links saved without one (e.g. from share sheets).
async function enrichSaved() {
  const pending = Object.entries(state.saved).filter(([, it]) => it.pending).slice(0, 5);
  for (const [key, it] of pending) {
    try {
      const a = await api('/api/article', { url: it.link });
      const cur = state.saved[key];
      if (cur) { cur.title = a.title || cur.title; cur.summary = (a.excerpt || '').slice(0, 220); cur.sname = a.siteName || cur.sname; cur.pending = false; }
    } catch {
      if (state.saved[key]) state.saved[key].pending = false;
    }
  }
  if (pending.length) { save(); renderFeed(); }
}

const looksLikeUrl = (s) => /^https?:\/\/\S+$/i.test(s.trim());

// Paste a link anywhere (outside an input) to save it.
document.addEventListener('paste', (e) => {
  if (e.target.closest?.('input, textarea, [contenteditable]')) return;
  const t = (e.clipboardData?.getData('text') || '').trim();
  if (looksLikeUrl(t)) { e.preventDefault(); quickSave(t); }
});

function renderCapture() {
  const origin = location.origin;
  const code = `javascript:(()=>{window.open('${origin}/save.html?u='+encodeURIComponent(location.href)+'&t='+encodeURIComponent(document.title),'quiet','width=420,height=240')})()`;
  const bm = el('a', { class: 'btn bm', onclick: (e) => e.preventDefault(), draggable: 'true' }, '＋ Save to Quiet');
  bm.setAttribute('href', code);
  $('#captureBox').replaceChildren(
    el('div', {}, el('strong', { text: 'Bookmarklet' }), el('p', { class: 'muted small-t', text: 'Drag this button to your bookmarks bar. Click it on any page — Twitter, Reddit, news sites — to save the link.' }), bm),
    el('div', {}, el('strong', { text: 'Browser extension' }), el('p', { class: 'muted small-t', text: 'Works on sites that block bookmarklets. In the project’s extension/ folder: load it unpacked in Chrome/Edge/Brave, then set your Quiet address. Shortcut: Alt+Shift+S.' })),
    el('div', {}, el('strong', { text: 'Phone share sheet' }), el('p', { class: 'muted small-t', text: 'Install Quiet (Add to Home Screen) and it appears as a share target on Android: Share → Quiet. On iPhone, use the Shortcuts app with “Open URL” → ' + origin + '/save.html?u=[Shortcut Input].' })),
    el('div', {}, el('strong', { text: 'Paste' }), el('p', { class: 'muted small-t', text: 'With Quiet open, paste any link (Ctrl/⌘+V) or press Ctrl/⌘+K and paste it there.' })));
}

// ---------- drag & drop OPML ----------
let dragDepth = 0;
window.addEventListener('dragenter', (e) => { if (e.dataTransfer?.types?.includes('Files')) { dragDepth++; $('#dropHint').hidden = false; } });
window.addEventListener('dragleave', () => { dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) $('#dropHint').hidden = true; });
window.addEventListener('dragover', (e) => { if (e.dataTransfer?.types?.includes('Files')) e.preventDefault(); });
window.addEventListener('drop', (e) => {
  dragDepth = 0;
  $('#dropHint').hidden = true;
  const f = e.dataTransfer?.files?.[0];
  if (f) { e.preventDefault(); importFile(f); }
});

// ---------- command palette (Ctrl/⌘+K) ----------
let palItems = [];
let palSel = 0;
function commands() {
  const c = [
    { t: 'Add a site', f: openAdd },
    { t: 'Write something', f: openWriter },
    { t: 'Look: themes & fonts', f: openTheme },
    { t: 'Refresh everything', f: () => refreshAll(true) },
    { t: 'Show everything', f: () => setView('all', null) },
    { t: 'Show unread', f: () => setView('unread', null) },
    { t: 'Show saved', f: () => setView('saved', null) },
    { t: 'Import feeds (OPML)…', f: () => $('#impFile').click() },
    { t: 'Save from anywhere (bookmarklet, extension)', f: () => $('#settingsBtn').click() },
    ...PRESETS.map((p) => ({ t: 'Theme: ' + p.name, f: () => { state.theme.preset = p.id; state.theme.custom = { bg: p.bg, fg: p.fg, accent: p.accent }; applyTheme(state.theme); save(); } })),
    ...state.sources.map((s) => ({ t: 'Go to ' + (s.title || s.url), hint: 'source', f: () => setView('all', s.id) })),
  ];
  return c;
}
function palRender() {
  const q = $('#palIn').value.trim();
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  palItems = looksLikeUrl(q) ? [{ t: 'Save this link for later', hint: q.slice(0, 40), f: () => quickSave(q) }, { t: 'Add as a source (find its feed)', f: () => { openAdd(); $('#addUrl').value = q; $('#addForm').requestSubmit(); } }] : commands().filter((c) => words.every((w) => c.t.toLowerCase().includes(w))).slice(0, 12);
  palSel = Math.min(palSel, Math.max(0, palItems.length - 1));
  $('#palList').replaceChildren(...palItems.map((c, i) => el('li', { class: i === palSel ? 'on' : '', role: 'option', onclick: () => palRun(i) }, el('span', { text: c.t }), c.hint ? el('small', { text: c.hint }) : null)));
}
function palRun(i) {
  const c = palItems[i];
  if (!c) return;
  $('#palDlg').close();
  setTimeout(c.f, 0);
}
function openPalette() {
  $('#palIn').value = '';
  palSel = 0;
  palRender();
  if (!$('#palDlg').open) $('#palDlg').showModal();
  $('#palIn').focus();
}
$('#palIn').addEventListener('input', () => { palSel = 0; palRender(); });
$('#palIn').addEventListener('keydown', (e) => {
  if (e.key === 'ArrowDown') { e.preventDefault(); palSel = Math.min(palItems.length - 1, palSel + 1); palRender(); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); palSel = Math.max(0, palSel - 1); palRender(); }
  else if (e.key === 'Enter') { e.preventDefault(); palRun(palSel); }
});
document.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k' && e.target.id !== 'wText') { e.preventDefault(); openPalette(); }
});

// ---------- highlights & notes ----------
const proseEl = () => $('#rBody .prose');

function buildNorm(root) {
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const blockOf = (n) => n.parentElement?.closest('p,li,h1,h2,h3,h4,blockquote,pre,figcaption,td,th,div');
  let norm = '';
  const map = [];
  let prev = null;
  let n;
  while ((n = w.nextNode())) {
    const blk = blockOf(n);
    if (prev && blk !== prev && norm && !norm.endsWith(' ')) { norm += ' '; map.push({ n: null, i: 0 }); }
    prev = blk;
    const t = n.nodeValue;
    for (let i = 0; i < t.length; i++) {
      if (/\s/.test(t[i])) {
        if (!norm || norm.endsWith(' ')) continue;
        norm += ' ';
      } else norm += t[i];
      map.push({ n, i });
    }
  }
  return { norm, map };
}

function applyHighlights(root, list) {
  if (!root) return;
  for (const h of list) {
    const { norm, map } = buildNorm(root);
    let idx = -1;
    for (let from = 0; ; ) {
      const f = norm.indexOf(h.text, from);
      if (f < 0) break;
      if (idx < 0) idx = f;
      if (h.pre && norm.slice(Math.max(0, f - h.pre.length), f) === h.pre) { idx = f; break; }
      from = f + 1;
    }
    if (idx < 0) continue;
    const spans = new Map();
    for (let k = idx; k < idx + h.text.length; k++) {
      const m = map[k];
      if (!m?.n) continue;
      const cur = spans.get(m.n) || { a: m.i, b: m.i + 1 };
      cur.b = Math.max(cur.b, m.i + 1);
      spans.set(m.n, cur);
    }
    for (const [node, { a, b }] of spans) {
      try {
        const r = document.createRange();
        r.setStart(node, a);
        r.setEnd(node, b);
        const mk = document.createElement('mark');
        mk.className = 'hl' + (h.note ? ' has-note' : '');
        mk.dataset.id = h.id;
        r.surroundContents(mk);
      } catch {}
    }
  }
}

function restyleMarks(h) {
  $$(`mark.hl[data-id="${h.id}"]`).forEach((m) => m.classList.toggle('has-note', !!h.note));
}
function unwrapMarks(id) {
  for (const m of $$(`mark.hl[data-id="${id}"]`)) {
    const p = m.parentNode;
    m.replaceWith(...m.childNodes);
    p.normalize();
  }
}
function deleteHighlight(id) {
  state.highlights = state.highlights.filter((h) => h.id !== id);
  unwrapMarks(id);
  save();
  renderRail();
  if (view.filter === 'highlights') renderFeed();
}

const bar = $('#selBar');
function selectionInReader() {
  const sel = getSelection();
  if (!sel || sel.isCollapsed || $('#reader').hidden || $('#writer').hidden === false) return null;
  const text = sel.toString().replace(/\s+/g, ' ').trim();
  if (text.length < 3 || !$('#rBody').contains(sel.anchorNode) || !$('#rBody').contains(sel.focusNode)) return null;
  return { text, sel, rect: sel.getRangeAt(0).getBoundingClientRect() };
}
document.addEventListener('selectionchange', () => {
  const s = selectionInReader();
  if (!s) { bar.hidden = true; return; }
  bar.hidden = false;
  bar.style.left = Math.min(Math.max(130, s.rect.left + s.rect.width / 2), innerWidth - 130) + 'px';
  bar.style.top = Math.max(56, s.rect.top - 8) + 'px';
});
bar.addEventListener('mousedown', (e) => e.preventDefault());
bar.addEventListener('click', (e) => {
  const a = e.target.dataset?.a;
  const s = selectionInReader();
  if (!a || !s || !rItem) return;
  if (a === 'quote') {
    bar.hidden = true;
    const quote = s.text.split(/\n+/).map((l) => '> ' + l).join('\n>\n');
    return quoteIntoDraft(`${quote}\n>\n> — [${rItem.title.replace(/[\[\]]/g, '')}](${rItem.link})`);
  }
  if (s.text.length > 1500) return toast('Select a shorter passage to highlight');
  const content = proseEl();
  const { norm, map } = buildNorm(content);
  const range = s.sel.getRangeAt(0);
  const si = map.findIndex((m) => m.n && m.n === range.startContainer && m.i >= range.startOffset);
  const h = { id: uid(), url: rItem.link, title: rItem.title, sname: rItem.sname || srcById(rItem.sid)?.title || new URL(rItem.link).hostname, text: s.text, pre: si > 0 ? norm.slice(Math.max(0, si - 24), si) : '', note: '', created: Date.now() };
  state.highlights.push(h);
  save();
  applyHighlights(content, [h]);
  s.sel.removeAllRanges();
  bar.hidden = true;
  renderRail();
  if (a === 'note') openNote(h);
  else toast('Highlighted', 'Undo', () => deleteHighlight(h.id));
});
$('#rBody').addEventListener('click', (e) => {
  const m = e.target.closest?.('mark.hl');
  if (!m || !getSelection().isCollapsed) return;
  const h = state.highlights.find((x) => x.id === m.dataset.id);
  if (h) openNote(h);
});

let noteFor = null;
function openNote(h) {
  noteFor = h;
  $('#noteQuote').textContent = h.text;
  $('#noteText').value = h.note || '';
  $('#noteDlg').showModal();
  $('#noteText').focus();
}
$('#noteSave').onclick = () => {
  if (!noteFor) return;
  noteFor.note = $('#noteText').value.trim();
  save();
  restyleMarks(noteFor);
  $('#noteDlg').close();
  if (view.filter === 'highlights') renderFeed();
};
$('#noteDel').onclick = () => { if (noteFor) deleteHighlight(noteFor.id); $('#noteDlg').close(); };

function renderHighlights() {
  const feed = $('#feed');
  const hs = state.highlights.slice().sort((a, b) => b.created - a.created);
  $('#viewSub').textContent = `${hs.length} highlight${hs.length === 1 ? '' : 's'} · ${hs.filter((h) => h.note).length} with notes`;
  $('#markAllBtn').hidden = true;
  if (!hs.length) return feed.replaceChildren(el('p', { class: 'empty', text: 'Select any text while reading to highlight it or add a note. It all collects here.' }));
  const groups = new Map();
  for (const h of hs) groups.set(h.url, [...(groups.get(h.url) || []), h]);
  const nodes = [el('div', { class: 'row hl-tools' }, el('button', { class: 'btn small', onclick: exportHighlights }, 'Export as Markdown'))];
  for (const [url, list] of groups) {
    nodes.push(el('section', { class: 'hl-group' },
      el('h3', {}, el('a', { href: url, onclick: (e) => { e.preventDefault(); openReader({ key: '_hl|' + url, link: url, title: list[0].title, sname: list[0].sname }); } }, list[0].title)),
      el('p', { class: 'meta', text: list[0].sname }),
      ...list.map((h) => el('div', { class: 'hl-item' },
        el('blockquote', { text: h.text }),
        h.note ? el('p', { class: 'hl-note', text: h.note }) : null,
        el('div', { class: 'row' },
          el('button', { class: 'btn ghost small', onclick: () => openNote(h) }, h.note ? 'Edit note' : 'Add note'),
          el('button', { class: 'btn ghost small', onclick: () => quoteIntoDraft(`> ${h.text}\n>\n> — [${h.title.replace(/[\[\]]/g, '')}](${h.url})${h.note ? '\n\n' + h.note : ''}`) }, 'Send to draft'),
          el('button', { class: 'btn ghost small', onclick: () => deleteHighlight(h.id) }, 'Delete'))))));
  }
  feed.replaceChildren(...nodes);
}
function exportHighlights() {
  let md = '# My highlights\n';
  const groups = new Map();
  for (const h of state.highlights.slice().sort((a, b) => a.created - b.created)) groups.set(h.url, [...(groups.get(h.url) || []), h]);
  for (const [url, list] of groups) {
    md += `\n## [${list[0].title.replace(/[\[\]]/g, '')}](${url})\n`;
    for (const h of list) md += `\n> ${h.text}\n${h.note ? '\n' + h.note + '\n' : ''}`;
  }
  download('quiet-highlights.md', md, 'text/markdown');
}

// ---------- reading time ----------
function dayKey(offset = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return d.toLocaleDateString('en-CA');
}
export function fmtDur(sec) {
  if (sec < 30) return 'under a minute';
  const m = Math.round(sec / 60);
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return [h ? `${h} hr${h > 1 ? 's' : ''}` : '', mm ? `${mm} min${mm > 1 ? 's' : ''}` : ''].filter(Boolean).join(' ');
}
let lastAct = Date.now();
let ticks = 0;
for (const ev of ['scroll', 'mousemove', 'keydown', 'touchstart', 'wheel', 'click']) document.addEventListener(ev, () => (lastAct = Date.now()), { passive: true, capture: true });
setInterval(() => {
  if ($('#reader').hidden || document.hidden || Date.now() - lastAct > 60000) return;
  const k = dayKey();
  state.readTime[k] = (state.readTime[k] || 0) + 1;
  if (++ticks % 15 === 0) {
    for (const old of Object.keys(state.readTime)) if (old < dayKey(-120)) delete state.readTime[old];
    save();
  }
}, 1000);
document.addEventListener('visibilitychange', () => { if (document.hidden) save(); });

function statBlock() {
  const days = [-6, -5, -4, -3, -2, -1, 0].map((o) => ({ o, sec: state.readTime[dayKey(o)] || 0, label: new Date(Date.now() + o * 864e5).toLocaleDateString(undefined, { weekday: 'narrow' }) }));
  if (!days.some((d) => d.sec > 0)) return null;
  const y = days[5].sec;
  const t = days[6].sec;
  const max = Math.max(...days.map((d) => d.sec), 1);
  return el('div', { class: 'stat' },
    el('div', {},
      el('strong', { text: y > 0 ? `Yesterday you read for ${fmtDur(y)}.` : 'You took yesterday off.' }),
      el('p', { text: t > 30 ? `Today so far: ${fmtDur(t)}.` : 'Nothing read yet today.' })),
    el('div', { class: 'bars', 'aria-label': 'Reading time, last 7 days' },
      ...days.map((d) => el('div', { class: d.o === 0 ? 't' : '', title: `${d.o === 0 ? 'Today' : dayLabel(Date.now() + d.o * 864e5)}: ${d.sec ? fmtDur(d.sec) : 'none'}` }, el('i', { style: `height:${Math.max(3, Math.round((d.sec / max) * 28))}px` }), d.label))));
}

// ---------- offline / install ----------
if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('/sw.js').catch(() => {});
enrichSaved();
