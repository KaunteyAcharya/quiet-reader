import { state, cache, save, saveCache, replaceAll, wipe, hash, saveLink, unsave, uid, onExternalChange } from './store.js';
import { PRESETS, FONTS, applyTheme, resolveColors, fontStack, loadAllFonts, contrast, fixContrast } from './themes.js';
import * as offline from './offline.js';
import { showKeys, startTour } from './tour.js';
import { $, $$, el, icon, hydrate, ago, dayLabel, hue, download } from './ui.js';
import { initWriter, openWriter, quoteIntoDraft } from './writer.js';

const PAGE = 30;
const view = { filter: 'all', source: null, folder: null, limit: PAGE };
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
const slim = (it) => ({ id: it.id, title: it.title, link: it.link, date: it.date, author: it.author, summary: (it.summary || '').slice(0, 220), image: it.image, mins: it.mins || null });

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
    if (view.folder && s.folder !== view.folder) continue;
    const c = cache[s.id];
    if (!c) continue;
    for (const it of c.items) {
      const key = keyOf(s.id, it.id);
      out.push({ ...it, key, sid: s.id, sname: s.title, ts: it.date ? Date.parse(it.date) : state.seen[key] || c.fetched });
    }
  }
  out.sort((a, b) => b.ts - a.ts);
  if (view.filter === 'today') return out.filter((it) => !state.read[it.key] && it.ts > Date.now() - 36 * 36e5);
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
const srcHue = (s) => s.hue ?? hue(s.title || new URL(s.url).hostname);
const HUES = [8, 28, 48, 100, 160, 200, 250, 295, 335];

function renderRail() {
  const totalUnread = state.sources.reduce((n, s) => n + unreadCount(s.id), 0);
  const savedN = Object.keys(state.saved).length;
  const todayN = todayCount();
  const navItem = (id, label, ic, count) =>
    el('button', { class: 'nav-item' + (view.filter === id && !view.source && !view.folder ? ' on' : ''), onclick: () => setView(id, null) },
      el('span', { html: icon(ic) }), el('span', { class: 'grow', text: label }), count ? el('span', { class: 'count', text: count }) : null);
  $('#nav').replaceChildren(
    navItem('today', 'Today', 'inbox', todayN || ''),
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
  const byName = (a, b) => (a.title || a.url).localeCompare(b.title || b.url);
  const row = (s) => {
    const n = unreadCount(s.id);
    const err = cache[s.id]?.error;
    const name = s.title || new URL(s.url).hostname;
    return el('div', { class: 'src' + (view.source === s.id ? ' on' : '') },
      el('button', { class: 'src-main', title: err ? 'Problem: ' + err : s.url, onclick: () => setView('all', s.id) },
        el('span', { class: 'avatar', style: `--h:${srcHue(s)}`, text: name[0].toUpperCase() }),
        el('span', { class: 'grow ellipsis', text: name }),
        err ? el('span', { class: 'warn', title: err, text: '!' }) : n ? el('span', { class: 'count', text: n }) : null),
      el('button', { class: 'icon-btn tiny src-x', 'aria-label': 'Edit ' + name, title: 'Rename, folder, colour', html: icon('gear'), onclick: () => editSource(s) }));
  };
  const folders = [...new Set(state.sources.map((s) => s.folder).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const nodes = state.sources.filter((s) => !s.folder).sort(byName).map(row);
  for (const f of folders) {
    const inF = state.sources.filter((s) => s.folder === f).sort(byName);
    const unread = inF.reduce((n, s) => n + unreadCount(s.id), 0);
    const folded = !!state.folded[f];
    nodes.push(
      el('div', { class: 'folder' + (view.folder === f && !view.source ? ' on' : '') },
        el('button', { class: 'fold', 'aria-label': (folded ? 'Expand ' : 'Collapse ') + f, 'aria-expanded': String(!folded), onclick: () => { state.folded[f] = !folded || undefined; if (!state.folded[f]) delete state.folded[f]; save(); renderRail(); } }, folded ? '▸' : '▾'),
        el('button', { class: 'folder-main', onclick: () => setView('all', null, f) }, el('span', { class: 'grow ellipsis', text: f }), unread ? el('span', { class: 'count', text: unread }) : null)),
      ...(folded ? [] : inF.map((s) => { const r = row(s); r.classList.add('in-folder'); return r; })));
  }
  box.replaceChildren(...nodes);
}

function todayCount() {
  const cut = Date.now() - 36 * 36e5;
  let n = 0;
  for (const s of state.sources) for (const it of cache[s.id]?.items || []) {
    const key = keyOf(s.id, it.id);
    const ts = it.date ? Date.parse(it.date) : state.seen[key] || 0;
    if (ts > cut && !state.read[key]) n++;
  }
  return n;
}

let editing = null;
let editHue;
function editSource(s) {
  editing = s;
  editHue = s.hue;
  $('#srcName').value = s.title || '';
  $('#srcFolder').value = s.folder || '';
  $('#folderList').replaceChildren(...[...new Set(state.sources.map((x) => x.folder).filter(Boolean))].map((f) => el('option', { value: f })));
  paintHues();
  $('#srcDlg').showModal();
}
function paintHues() {
  const auto = hue(editing.title || new URL(editing.url).hostname);
  $('#srcColors').replaceChildren(
    ...[undefined, ...HUES].map((h) => el('button', { type: 'button', class: 'hue' + (editHue === h ? ' on' : ''), 'aria-label': h === undefined ? 'Automatic colour' : 'Colour ' + h, title: h === undefined ? 'Automatic' : '', style: `--h:${h ?? auto}`, onclick: () => { editHue = h; paintHues(); } }, h === undefined ? 'A' : '')));
}
$('#srcSave').onclick = () => {
  if (!editing) return;
  const name = $('#srcName').value.trim();
  if (name) editing.title = name;
  const f = $('#srcFolder').value.trim();
  if (f) editing.folder = f; else delete editing.folder;
  if (editHue === undefined) delete editing.hue; else editing.hue = editHue;
  save();
  $('#srcDlg').close();
  renderRail();
  renderFeed();
};
$('#srcDel').onclick = () => {
  const s = editing;
  if (!s || !confirm(`Remove "${s.title || s.url}" from your reading list?`)) return;
  state.sources = state.sources.filter((x) => x.id !== s.id);
  delete cache[s.id];
  if (view.source === s.id) view.source = null;
  saveCache();
  save();
  $('#srcDlg').close();
  renderRail();
  renderFeed();
};

function setView(filter, source, folder = null) {
  view.filter = filter;
  view.source = source;
  view.folder = folder;
  kbIdx = -1;
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
    el('p', { class: 'muted or', text: 'Or start with one of these' }),
    el('div', { class: 'chips' }, ...STARTERS.map(([n, u]) => el('button', { class: 'chip', onclick: () => { openAdd(); $('#addUrl').value = u; $('#addForm').requestSubmit(); } }, n))));
}

function renderFeed() {
  const feed = $('#feed');
  const src = view.source && srcById(view.source);
  $('#viewTitle').textContent = src ? src.title || new URL(src.url).hostname : view.folder ? view.folder : { today: 'Today', all: 'Everything', unread: 'Unread', saved: 'Saved for later', highlights: 'Highlights & notes' }[view.filter];
  if (view.filter === 'highlights') return renderHighlights();
  const items = allItems();
  const un = items.filter((i) => !state.read[i.key]).length;
  const last = Math.max(0, ...state.sources.map((s) => cache[s.id]?.fetched || 0));
  $('#viewSub').textContent = state.sources.length ? `${un} unread · ${last ? 'updated ' + ago(last) : 'not yet fetched'}` : '';
  $('#markAllBtn').hidden = view.filter === 'saved' || !un;
  kbIdx = -1;

  if (!state.sources.length && view.filter !== 'saved') return feed.replaceChildren(welcome());
  if (!items.length && refreshing && !['saved', 'today'].includes(view.filter)) {
    return feed.replaceChildren(...Array.from({ length: 6 }, () => el('div', { class: 'card sk', 'aria-hidden': 'true' }, el('div', { class: 'skeleton' }, el('i', { style: 'width:30%;height:.7em' }), el('i', { style: 'width:80%;height:1.3em' }), el('i', { style: 'width:95%' })))));
  }
  if (!items.length) {
    const msg = view.filter === 'today' ? 'Nothing new in the last day and a half. Enjoy the quiet.' :  view.filter === 'unread' ? "You're all caught up. Nothing new to read." : view.filter === 'saved' ? 'Nothing saved yet. Tap the bookmark on anything you want to come back to.' : refreshing ? 'Fetching your sources…' : 'No articles yet.';
    return feed.replaceChildren(el('p', { class: 'empty', text: msg }));
  }

  visible = view.filter === 'today' ? items.slice(0, view.limit).sort((a, b) => (a.sname || '').localeCompare(b.sname || '') || b.ts - a.ts) : items.slice(0, view.limit);
  const nodes = [];
  if (view.filter === 'all' && !view.source && !view.folder) { const st = statBlock(); if (st) nodes.push(st); }
  let lastDay = '';
  let lastSrc = '';
  for (const it of visible) {
    if (view.filter === 'today') {
      if (it.sid !== lastSrc) {
        const s = srcById(it.sid);
        const n = visible.filter((v) => v.sid === it.sid).length;
        nodes.push(el('h2', { class: 'day digest-h' }, el('span', { class: 'avatar', style: `--h:${s ? srcHue(s) : 0}` , text: (it.sname || '?')[0].toUpperCase() }), el('span', { text: `${it.sname} · ${n}` })));
        lastSrc = it.sid;
      }
      nodes.push(card(it));
      continue;
    }
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
  const src = srcById(it.sid);
  const sname = it.sname || src?.title || '';
  const h = src ? srcHue(src) : hue(sname || 'x');
  const pos = state.pos[it.link];
  const resuming = pos && pos.r > 0.03 && pos.r < 0.96;
  const rest = [it.author, it.date || view.filter === 'saved' ? ago(it.ts) : null, it.mins ? it.mins + ' min read' : null].filter(Boolean).join(' · ');
  return el('article', { class: 'card' + (isRead ? ' read' : ''), 'data-key': it.key, style: `--h:${h}` },
    el('div', { class: 'card-main' },
      el('div', { class: 'meta' }, !isRead ? el('i', { class: 'unread-dot' }) : null, sname ? el('span', { class: 'sname', text: sname }) : null, rest ? el('span', { text: (sname ? '· ' : '') + rest }) : null,
        offline.have.has(it.link) && state.saved[it.key] ? el('span', { class: 'offline-tag', title: 'Saved on this device — readable without a connection', text: 'offline ✓' }) : null),
      el('h3', {}, el('a', { href: it.link, onclick: (e) => { if (e.metaKey || e.ctrlKey || e.shiftKey) return; e.preventDefault(); openReader(it); } }, it.title)),
      it.summary ? el('p', { class: 'summary', text: it.summary }) : null,
      resuming ? el('div', { class: 'resume', title: 'Opens where you stopped' }, el('i', { style: `width:${Math.round(pos.r * 100)}%` }), el('span', { text: `${Math.round(pos.r * 100)}% read · continue` })) : null),
    it.image ? el('img', { class: 'thumb', src: it.image, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer', onerror: (e) => e.target.remove() }) : null,
    el('div', { class: 'card-actions' },
      it.sid === '_saved' ? el('button', { class: 'btn ghost small', title: 'Get new posts from this site', onclick: () => followSite(it.link) }, '+ Follow site') : null,
      el('button', { class: 'icon-btn tiny' + (saved ? ' on' : ''), title: saved ? 'Unsave (s)' : 'Save for later (s)', 'aria-label': 'Save', html: icon('mark', saved), onclick: () => toggleSave(it) }),
      el('button', { class: 'icon-btn tiny', title: (isRead ? 'Mark unread' : 'Mark read') + ' (m)', 'aria-label': 'Toggle read', html: icon('dot', !isRead), onclick: () => toggleRead(it) })));
}

function followSite(url) {
  openAdd();
  $('#addUrl').value = url;
  $('#addForm').requestSubmit();
}

function toggleSave(it) {
  if (state.saved[it.key]) delete state.saved[it.key];
  else state.saved[it.key] = { ...it, sname: it.sname || srcById(it.sid)?.title, savedAt: Date.now() };
  save();
  renderRail();
  renderFeed();
  syncReaderSave();
  syncOffline();
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
let r2Item = null;
let r2Token = 0;

// Fetch an article and render it into `body`. `current()` says whether the result is still wanted.
function articleData(link) {
  return api('/api/article', { url: link }).catch(async (e) => {
    const c = await offline.read(link);
    if (c) return { ...c, offline: true };
    throw e;
  });
}

function fillArticle(body, it, current, onDone) {
  body.replaceChildren(
    el('p', { class: 'r-meta', text: it.sname || srcById(it.sid)?.title || '' }),
    el('h1', { text: it.title }),
    el('div', { class: 'skeleton' }, el('i'), el('i'), el('i'), el('i')));
  return articleData(it.link)
    .then((a) => {
      if (!current()) return;
      const content = el('div', { class: 'prose' });
      content.innerHTML = a.content; // sanitised server-side (scripts, iframes, handlers stripped) + CSP
      queueMicrotask(() => applyHighlights(content, state.highlights.filter((h) => h.url === it.link)));
      body.replaceChildren(
        el('p', { class: 'r-meta', text: [a.siteName, a.byline, `${a.minutes} min read`, a.offline ? 'offline copy' : ''].filter(Boolean).join(' · ') }),
        el('h1', { text: a.title || it.title }),
        content,
        el('p', { class: 'r-end' }, el('a', { href: it.link, target: '_blank', rel: 'noopener noreferrer' }, 'Read the original on ' + new URL(a.url).hostname + ' ↗')));
      onDone?.();
    })
    .catch((e) => {
      if (!current()) return;
      body.replaceChildren(
        el('p', { class: 'r-meta', text: it.sname || '' }),
        el('h1', { text: it.title }),
        el('p', { class: 'muted', text: e.message }),
        el('p', {}, el('a', { class: 'btn primary', href: it.link, target: '_blank', rel: 'noopener noreferrer' }, 'Open the original ↗')));
    });
}

function openReader(it) {
  closeSplit();
  rItem = it;
  rIdx = visible.findIndex((v) => v.key === it.key);
  if (!state.read[it.key]) { state.read[it.key] = Date.now(); save(); renderRail(); renderFeed(); }
  $('#reader').hidden = false;
  document.body.classList.add('no-scroll');
  $('#rOpen').href = it.link;
  syncReaderSave();
  $('#rPrev').disabled = rIdx <= 0;
  $('#rNext').disabled = rIdx < 0 || rIdx >= visible.length - 1;
  const token = ++rToken;
  $('#rScroll').scrollTop = 0;
  fillArticle($('#rBody'), it, () => token === rToken, () => restorePos(it));
}

function closeReader() {
  if (rItem) { // refresh just this card (resume bar, read state) without moving the page
    const old = $$('#feed .card').find((c) => c.dataset.key === rItem.key);
    if (old) { const fresh = card(visible.find((v) => v.key === rItem.key) || rItem); if (old.classList.contains('kb')) fresh.classList.add('kb'); old.replaceWith(fresh); }
  }
  closeSplit();
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

// ----- split view: links inside an article open beside it, inside Quiet -----
function openSplit(link, title) {
  let u;
  try { u = new URL(link); } catch { return; }
  if (!/^https?:$/.test(u.protocol)) return;
  u.hash = '';
  const host = u.hostname.replace(/^www\./, '');
  r2Item = { key: '_saved|' + u.href, link: u.href, title: title || host, sname: host, sid: '_saved' };
  const token = ++r2Token;
  $('#rPane2').hidden = false;
  $('#rSplit').classList.add('has2');
  $('#r2Host').textContent = host;
  $('#r2Open').href = u.href;
  syncPane2Save();
  $('#rScroll2').scrollTop = 0;
  fillArticle($('#rBody2'), r2Item, () => token === r2Token);
}
function closeSplit() {
  r2Token++;
  r2Item = null;
  $('#rPane2').hidden = true;
  $('#rSplit').classList.remove('has2');
}
function syncPane2Save() {
  if (!r2Item) return;
  const on = !!state.saved[r2Item.key];
  $('#r2Save').innerHTML = icon('mark', on);
  $('#r2Save').classList.toggle('on', on);
}
function onArticleLink(e) {
  const a = e.target.closest?.('a[href]');
  if (!a || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
  if (a.closest('.r-end') || a.classList.contains('btn')) return; // "read the original" really leaves
  const href = a.href;
  if (!/^https?:/i.test(href)) return;
  e.preventDefault();
  const here = e.currentTarget === $('#rBody') ? rItem : r2Item;
  if (here && href.split('#')[0] === here.link.split('#')[0]) return; // in-page anchor
  openSplit(href, a.textContent.replace(/\s+/g, ' ').trim().slice(0, 120));
}
$('#rBody').addEventListener('click', onArticleLink);
$('#rBody2').addEventListener('click', onArticleLink);
$('#r2Close').onclick = closeSplit;
$('#r2Back').onclick = closeSplit;
$('#r2Save').onclick = () => {
  if (!r2Item) return;
  if (state.saved[r2Item.key]) unsave(r2Item.key);
  else saveLink(r2Item.link, r2Item.title === r2Item.sname ? '' : r2Item.title);
  syncPane2Save();
  renderRail();
  if (view.filter === 'saved') renderFeed();
  syncOffline();
};
$('#r2Follow').onclick = () => r2Item && followSite(r2Item.link);

$('#rBack').onclick = closeReader;
$('#rPrev').onclick = () => step(-1);
$('#rNext').onclick = () => step(1);
$('#rSave').onclick = () => rItem && toggleSave(rItem);
$('#rLook').onclick = openTheme;
$('#rScroll').addEventListener('scroll', (e) => {
  const s = e.target;
  const r = s.scrollHeight - s.clientHeight > 0 ? s.scrollTop / (s.scrollHeight - s.clientHeight) : 0;
  $('#readProgress').style.transform = `scaleX(${r})`;
  clearTimeout(posT);
  const link = rItem?.link;
  posT = setTimeout(() => { if (link && !restoring) savePos(link, r); }, 500);
}, { passive: true });

// ----- remember where you stopped -----
let posT;
let restoring = false;
function savePos(link, r) {
  if (r < 0.03 && !state.pos[link]) return;
  if (r >= 0.96) delete state.pos[link];
  else state.pos[link] = { r: Math.round(r * 1000) / 1000, t: Date.now() };
  const keys = Object.keys(state.pos);
  if (keys.length > 150) for (const k of keys.sort((a, b) => state.pos[a].t - state.pos[b].t).slice(0, keys.length - 150)) delete state.pos[k];
  save();
}
function restorePos(it) {
  const p = state.pos[it.link];
  if (!p || p.r < 0.03 || p.r >= 0.96) return;
  const sc = $('#rScroll');
  const go = () => { sc.scrollTop = p.r * Math.max(0, sc.scrollHeight - sc.clientHeight); };
  restoring = true;
  requestAnimationFrame(go);
  setTimeout(() => { if (rItem === it) go(); restoring = false; }, 450); // images may have shifted the height
  toast(`Back where you stopped (${Math.round(p.r * 100)}%)`, 'Start over', () => { delete state.pos[it.link]; save(); sc.scrollTo({ top: 0 }); renderFeed(); });
}

// ----- keyboard -----
let kbIdx = -1;
function kbMove(d) {
  if (!visible.length) return;
  kbIdx = Math.min(visible.length - 1, Math.max(0, kbIdx + d));
  $$('#feed .card.kb').forEach((c) => c.classList.remove('kb'));
  const c = $$('#feed .card').find((x) => x.dataset.key === visible[kbIdx].key);
  c?.classList.add('kb');
  c?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}
document.addEventListener('keydown', (e) => {
  if (e.target.matches('input, textarea, select, [contenteditable]') || e.metaKey || e.ctrlKey || e.altKey) return;
  if ($('dialog[open]')) return;
  if (!$('#reader').hidden && $('#writer').hidden) {
    if (e.key === 'Escape') { if (r2Item) closeSplit(); else closeReader(); }
    if (e.key === 'j') step(1);
    if (e.key === 'k') step(-1);
    if (e.key === 's' && rItem) toggleSave(rItem);
    if (e.key === '?') showKeys();
    return;
  }
  if (!$('#writer').hidden) return;
  const it = visible[kbIdx];
  switch (e.key) {
    case 'j': kbMove(1); break;
    case 'k': kbMove(-1); break;
    case 'Enter': case 'o': if (it && !e.target.closest?.('a,button')) openReader(it); break;
    case 's': if (it) { toggleSave(it); } break;
    case 'm': if (it) { toggleRead(it); } break;
    case 'a': e.preventDefault(); openAdd(); break;
    case 'w': e.preventDefault(); openWriter(); break;
    case 't': e.preventDefault(); openTheme(); break;
    case 'd': setView('today', null); break;
    case '/': e.preventDefault(); openPalette(); break;
    case '?': showKeys(); break;
    default: return;
  }
  if (['s', 'm'].includes(e.key) && it) { const k = it.key; queueMicrotask(() => { kbIdx = visible.findIndex((v) => v.key === k); kbMove(0); }); }
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
        r.detected ? el('p', { class: 'found-note' }, 'Found the posts at ', el('b', { text: new URL(r.detected.at).pathname === '/' ? r.detected.label : new URL(r.detected.at).pathname }), ' — not the page you pasted.') : null,
        r.alternatives?.length ? el('div', { class: 'alts' }, 'Not right? Try:', ...r.alternatives.map((x) => el('button', { type: 'button', class: 'chip', onclick: () => { $('#addUrl').value = x.url; $('#addForm').requestSubmit(); } }, `${x.title} (${x.count})`))) : null,
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

function contrastRow(c, t) {
  const grade = (r) => (r >= 7 ? 'Excellent (AAA)' : r >= 4.5 ? 'Good (AA)' : r >= 3 ? 'Weak' : 'Hard to read');
  const tr = contrast(c.fg, c.bg);
  const ar = contrast(c.accent, c.bg);
  const fix = (key, target) => () => {
    t.custom = { ...c, [key]: fixContrast(c[key], c.bg, target) };
    t.preset = 'custom';
    applyTheme(t);
    save();
    renderTheme();
  };
  const line = (label, r, key, target) => el('div', { class: 'contrast-line ' + (r >= target ? 'ok' : 'bad') },
    el('span', { text: `${label}: ${r.toFixed(1)}:1 — ${grade(r)}` }),
    r < target ? el('button', { class: 'btn small', onclick: fix(key, target) }, 'Fix it') : null);
  return el('div', { class: 'contrast' }, line('Text', tr, 'fg', 4.5), line('Links & accent', ar, 'accent', 3));
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
    contrastRow(c, t),
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

// ---------- offline copies of saved articles ----------
let offT;
function syncOffline() {
  clearTimeout(offT);
  offT = setTimeout(async () => {
    const changed = await offline.sync(Object.values(state.saved).map((i) => i.link));
    if (changed && view.filter === 'saved' && $('#reader').hidden) renderFeed();
  }, 400);
}
addEventListener('online', syncOffline);
addEventListener('offline', () => toast('You’re offline — saved articles and cached feeds still work.'));

// ---------- capture: save any link ----------
function quickSave(url, title = '') {
  try {
    const { key, existed } = saveLink(url, title);
    renderRail();
    if (view.filter === 'saved') renderFeed();
    toast(existed ? 'Already in Saved' : 'Saved for later', existed ? null : 'Undo', () => { unsave(key); renderRail(); renderFeed(); });
    enrichSaved();
    syncOffline();
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
  const bm = el('a', { class: 'btn bm', onclick: (e) => e.preventDefault(), draggable: 'true' }, '◉ Quiet');
  bm.setAttribute('href', code);
  $('#captureBox').replaceChildren(
    el('div', {}, el('strong', { text: 'Bookmarklet' }), el('p', { class: 'muted small-t', text: 'Drag this button to your bookmarks bar, then click it on any page to save the link or follow the site. Chrome shows a plain globe for bookmarklets — for a proper icon use the extension below.' }), bm),
    el('div', {}, el('strong', { text: 'Browser extension' }), el('p', { class: 'muted small-t', text: 'Recommended: a real Quiet icon in your toolbar, works on every site. Load the extension/ folder unpacked in Chrome/Edge/Brave, then set your Quiet address. Shortcut: Alt+Shift+S.' })),
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
    { t: 'Today’s digest', f: () => setView('today', null) },
    { t: 'Show unread', f: () => setView('unread', null) },
    { t: 'Keyboard shortcuts', f: showKeys },
    { t: 'Take the tour', f: runTour },
    ...[...new Set(state.sources.map((x) => x.folder).filter(Boolean))].map((f) => ({ t: 'Folder: ' + f, hint: 'folder', f: () => setView('all', null, f) })),
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
function paneFor(node) {
  if ($('#rBody').contains(node)) return { body: $('#rBody'), item: rItem };
  if (!$('#rPane2').hidden && $('#rBody2').contains(node)) return { body: $('#rBody2'), item: r2Item };
  return null;
}
function selectionInReader() {
  const sel = getSelection();
  if (!sel || sel.isCollapsed || $('#reader').hidden || $('#writer').hidden === false) return null;
  const text = sel.toString().replace(/\s+/g, ' ').trim();
  const pane = paneFor(sel.anchorNode);
  if (text.length < 3 || !pane || paneFor(sel.focusNode)?.body !== pane.body) return null;
  return { text, sel, pane, rect: sel.getRangeAt(0).getBoundingClientRect() };
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
  const it = s?.pane.item;
  if (!a || !s || !it) return;
  if (a === 'quote') {
    bar.hidden = true;
    const quote = s.text.split(/\n+/).map((l) => '> ' + l).join('\n>\n');
    return quoteIntoDraft(`${quote}\n>\n> — [${it.title.replace(/[\[\]]/g, '')}](${it.link})`);
  }
  if (s.text.length > 1500) return toast('Select a shorter passage to highlight');
  const content = $('.prose', s.pane.body);
  const { norm, map } = buildNorm(content);
  const range = s.sel.getRangeAt(0);
  const si = map.findIndex((m) => m.n && m.n === range.startContainer && m.i >= range.startOffset);
  const h = { id: uid(), url: it.link, title: it.title, sname: it.sname || srcById(it.sid)?.title || new URL(it.link).hostname, text: s.text, pre: si > 0 ? norm.slice(Math.max(0, si - 24), si) : '', note: '', created: Date.now() };
  state.highlights.push(h);
  save();
  applyHighlights(content, [h]);
  s.sel.removeAllRanges();
  bar.hidden = true;
  renderRail();
  if (a === 'note') openNote(h);
  else toast('Highlighted', 'Undo', () => deleteHighlight(h.id));
});
function onMarkClick(e) {
  if (e.target.closest?.('a')) return;
  const m = e.target.closest?.('mark.hl');
  if (!m || !getSelection().isCollapsed) return;
  const h = state.highlights.find((x) => x.id === m.dataset.id);
  if (h) openNote(h);
}
$('#rBody').addEventListener('click', onMarkClick);
$('#rBody2').addEventListener('click', onMarkClick);

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

function writeLine() {
  const y = state.writeStats?.[dayKey(-1)];
  return y?.w ? ` You also wrote ${y.w.toLocaleString()} words yesterday.` : '';
}

function statBlock() {
  const days = [-6, -5, -4, -3, -2, -1, 0].map((o) => ({ o, sec: state.readTime[dayKey(o)] || 0, label: new Date(Date.now() + o * 864e5).toLocaleDateString(undefined, { weekday: 'narrow' }) }));
  if (!days.some((d) => d.sec > 0)) return null;
  const y = days[5].sec;
  const t = days[6].sec;
  const max = Math.max(...days.map((d) => d.sec), 1);
  return el('div', { class: 'stat' },
    el('div', {},
      el('strong', { text: y > 0 ? `Yesterday you read for ${fmtDur(y)}.` : 'You took yesterday off.' }),
      el('p', { text: (t > 30 ? `Today so far: ${fmtDur(t)}.` : 'Nothing read yet today.') + writeLine() })),
    el('div', { class: 'bars', 'aria-label': 'Reading time, last 7 days' },
      ...days.map((d) => el('div', { class: d.o === 0 ? 't' : '', title: `${d.o === 0 ? 'Today' : dayLabel(Date.now() + d.o * 864e5)}: ${d.sec ? fmtDur(d.sec) : 'none'}` }, el('i', { style: `height:${Math.max(3, Math.round((d.sec / max) * 28))}px` }), d.label))));
}

// ---------- stay in sync with other Quiet windows ----------
onExternalChange(() => {
  applyTheme(state.theme);
  renderRail();
  if ($('#reader').hidden && $('#writer').hidden) renderFeed();
});

// ---------- offline / install ----------
if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('/sw.js').catch(() => {});
enrichSaved();

offline.init().then(() => { syncOffline(); renderFeed(); });

// ---------- first-run tour ----------
function runTour() {
  if (document.body.classList.contains('rail-open')) document.body.classList.remove('rail-open');
  startTour([
    { sel: '#addBtn', title: 'Add a site', text: 'Paste any address — a blog, newsletter, GitHub repo or company page. Quiet finds the feed (or the page where posts live).' },
    { sel: '#nav', title: 'Today & your lists', text: 'Today is a calm digest of what’s new. Unread, Saved and Highlights keep the rest in order — no algorithm, newest first.' },
    { sel: '#themeBtn', title: 'Make it yours', text: 'Colours, fonts, width and line spacing. Quiet remembers them everywhere.' },
    { sel: '#writeBtn', title: 'Write here too', text: 'A distraction-free editor with typewriter and sentence focus, plus daily word stats.' },
    { sel: null, title: 'Keyboard friendly', text: 'Press ? any time for shortcuts. j / k moves, Enter opens, s saves, Ctrl/⌘ K finds anything.' },
  ], () => { state.toured = true; save(); });
}
$('#tourBtn').onclick = () => { $('#keysDlg').close(); setTimeout(runTour, 50); };
if (!state.toured && (!navigator.webdriver || location.search.includes('tour'))) setTimeout(() => { if (!$('dialog[open]') && $('#reader').hidden) runTour(); }, 900);
