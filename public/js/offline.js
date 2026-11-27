// Offline copies of saved articles, kept in Cache Storage (never leaves this browser).
const NAME = 'quiet-articles';
const usable = () => 'caches' in self;
const keyUrl = (u) => new URL('/api/article?url=' + encodeURIComponent(u), location.origin).href;
export const have = new Set();

export async function init() {
  if (!usable()) return;
  try {
    const c = await caches.open(NAME);
    for (const r of await c.keys()) have.add(new URL(r.url).searchParams.get('url'));
  } catch {}
}

export async function keep(url) {
  if (!usable() || have.has(url)) return;
  try {
    const r = await fetch(keyUrl(url));
    if (!r.ok) return;
    await (await caches.open(NAME)).put(keyUrl(url), r);
    have.add(url);
  } catch {}
}

export async function read(url) {
  if (!usable()) return null;
  try {
    const r = await caches.match(keyUrl(url));
    return r ? await r.json() : null;
  } catch {
    return null;
  }
}

// Make the offline set match the saved list: fetch what's missing, forget what was unsaved.
let busy = false;
export async function sync(links) {
  if (!usable() || busy) return false;
  busy = true;
  let changed = false;
  try {
    const want = new Set(links);
    const c = await caches.open(NAME);
    for (const u of [...have]) if (!want.has(u)) { await c.delete(keyUrl(u)); have.delete(u); changed = true; }
    let n = 0;
    for (const u of want) {
      if (have.has(u)) continue;
      if (n++ >= 10 || !navigator.onLine) break;
      await keep(u);
      changed = changed || have.has(u);
    }
  } finally {
    busy = false;
  }
  return changed;
}
