import { DEFAULT_THEME } from './themes.js';

const KEY = 'quiet:v1';
const CACHE_KEY = 'quiet:cache:v1';

const defaults = () => ({
  sources: [], // {id, url, kind:'feed'|'page', title, site, added}
  read: {}, // key -> timestamp
  saved: {}, // key -> item snapshot
  seen: {}, // key -> first-seen ts (for undated items)
  theme: structuredClone(DEFAULT_THEME),
  drafts: [], // {id, title, body, updated}
  activeDraft: null,
  highlights: [], // {id,url,title,sname,text,pre,note,created}
  readTime: {}, // 'YYYY-MM-DD' -> seconds of active reading
  writer: { tw: false, sf: false },
  goal: 0,
});

function parse(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}
function normalize(st) {
  st.writer = { tw: false, sf: false, ...(st.writer || {}) };
  st.theme = { ...DEFAULT_THEME, ...st.theme, custom: { ...DEFAULT_THEME.custom, ...(st.theme?.custom || {}) } };
  return st;
}

export const state = normalize({ ...defaults(), ...(parse(KEY) || {}) });
export const cache = parse(CACHE_KEY) || {}; // sourceId -> {items, fetched, error?}

// Only a tab that actually changed something may write; otherwise a stale tab
// (or a closing popup) could overwrite newer data saved in another window.
let dirty = false;
let dirtyCache = false;
function writeNow() {
  try {
    if (dirty) localStorage.setItem(KEY, JSON.stringify(state));
    if (dirtyCache) localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
    dirty = dirtyCache = false;
  } catch {}
}
addEventListener('pagehide', writeNow);
addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') writeNow(); });

// Pull the latest saved data from storage (another tab/window changed it).
export function reloadFromStorage() {
  const j = parse(KEY);
  if (!j) return false;
  for (const k of Object.keys(state)) delete state[k];
  Object.assign(state, normalize({ ...defaults(), ...j }));
  const c = parse(CACHE_KEY);
  if (c) {
    for (const k of Object.keys(cache)) delete cache[k];
    Object.assign(cache, c);
  }
  dirty = dirtyCache = false;
  return true;
}
// Call back when another tab/window writes Quiet's data.
export function onExternalChange(fn) {
  addEventListener('storage', (e) => {
    if (e.key !== KEY && e.key !== CACHE_KEY) return;
    if (dirty) writeNow(); // don't lose our own pending change; last writer wins
    if (reloadFromStorage()) fn();
  });
}

let t1, t2;
export function save() {
  dirty = true;
  clearTimeout(t1);
  t1 = setTimeout(() => {
    try {
      // Keep the read map bounded
      const keys = Object.keys(state.read);
      if (keys.length > 6000) for (const k of keys.sort((a, b) => state.read[a] - state.read[b]).slice(0, keys.length - 5000)) delete state.read[k];
      localStorage.setItem(KEY, JSON.stringify(state));
      dirty = false;
    } catch (e) {
      console.warn('Could not save', e);
    }
  }, 150);
}
export function saveCache() {
  dirtyCache = true;
  clearTimeout(t2);
  t2 = setTimeout(() => {
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
      dirtyCache = false;
    } catch {
      // cache is disposable; drop it if storage is full
      try { localStorage.removeItem(CACHE_KEY); } catch {}
    }
  }, 300);
}

export function replaceAll(next) {
  for (const k of Object.keys(state)) delete state[k];
  Object.assign(state, defaults(), next);
  state.theme = { ...DEFAULT_THEME, ...state.theme };
  for (const k of Object.keys(cache)) delete cache[k];
  save();
  saveCache();
}

export function wipe() {
  localStorage.removeItem(KEY);
  localStorage.removeItem(CACHE_KEY);
}

export const hash = (s) => {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return Math.abs(h).toString(36);
};
export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

// Save any URL (not tied to a feed) into the Saved list. Returns {key, existed}.
export function saveLink(url, title = '') {
  const u = new URL(url);
  if (!/^https?:$/.test(u.protocol)) throw new Error('Only web links can be saved');
  u.hash = '';
  const link = u.href;
  const key = '_saved|' + link;
  const existed = !!state.saved[key];
  if (!existed) {
    state.saved[key] = {
      id: link, title: (title || '').trim() || link, link, date: null, author: null, summary: '', image: null,
      sid: '_saved', sname: u.hostname.replace(/^www\./, ''), savedAt: Date.now(), pending: !(title || '').trim(),
    };
    save();
  }
  return { key, existed };
}
export function unsave(key) {
  delete state.saved[key];
  save();
}

// Follow a site: add a discovered feed/page as a source. `found` is the /api/discover result.
export function addSource(found, title = '') {
  const id = 's_' + hash(found.feedUrl);
  if (state.sources.some((x) => x.id === id)) return { id, existed: true };
  state.sources.push({ id, url: found.feedUrl, kind: found.kind, title: (title || found.title || '').trim(), site: found.site, added: Date.now() });
  const now = Date.now();
  found.items.forEach((it, idx) => {
    if (!it.date) state.seen[id + '|' + it.id] = now - idx;
  });
  cache[id] = {
    items: found.items.slice(0, 50).map((it) => ({ id: it.id, title: it.title, link: it.link, date: it.date, author: it.author, summary: (it.summary || '').slice(0, 220), image: it.image })),
    fetched: now,
  };
  save();
  saveCache();
  return { id, existed: false };
}
