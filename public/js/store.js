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

function load(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? { ...fallback, ...JSON.parse(raw) } : fallback;
  } catch {
    return fallback;
  }
}

export const state = load(KEY, defaults());
state.writer = { tw: false, sf: false, ...(state.writer || {}) };
state.theme = { ...DEFAULT_THEME, ...state.theme, custom: { ...DEFAULT_THEME.custom, ...(state.theme?.custom || {}) } };
export const cache = load(CACHE_KEY, {}); // sourceId -> {items, fetched, error?}

function writeNow() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
    localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
  } catch {}
}
// Flush pending writes when the tab is closed, hidden or reloaded.
addEventListener('pagehide', writeNow);
addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') writeNow(); });

let t1, t2;
export function save() {
  clearTimeout(t1);
  t1 = setTimeout(() => {
    try {
      // Keep the read map bounded
      const keys = Object.keys(state.read);
      if (keys.length > 6000) for (const k of keys.sort((a, b) => state.read[a] - state.read[b]).slice(0, keys.length - 5000)) delete state.read[k];
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch (e) {
      console.warn('Could not save', e);
    }
  }, 150);
}
export function saveCache() {
  clearTimeout(t2);
  t2 = setTimeout(() => {
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
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
