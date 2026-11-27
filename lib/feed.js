// Feed parsing + discovery. Works with RSS, Atom, RDF and JSON Feed, and falls back to
// "page watching" for sites that publish no feed at all.
import { XMLParser } from 'fast-xml-parser';
import { parseHTML } from 'linkedom';
import { fetchText, httpError, normalizeUrl } from './net.js';

const xml = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_', textNodeName: '#text' });

const arr = (v) => (Array.isArray(v) ? v : v == null ? [] : [v]);
const txt = (v) => {
  if (v == null) return '';
  if (typeof v === 'object') return txt(v['#text'] ?? '');
  return String(v);
};

export function stripHtml(html, max = 240) {
  const s = String(html || '')
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Math.min(+n, 0x10ffff)))
    .replace(/&#39;|&apos;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
  return s.length > max ? s.slice(0, max - 1).trimEnd() + '…' : s;
}

function iso(d) {
  if (!d) return null;
  const t = new Date(txt(d)).getTime();
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

function resolve(href, base) {
  if (!href) return null;
  try {
    return new URL(href, base).href;
  } catch {
    return null;
  }
}

function firstImage(html, base) {
  const m = /<img[^>]+src=["']([^"']+)["']/i.exec(html || '');
  return m ? resolve(m[1], base) : null;
}

export function looksLikeFeed(text) {
  const head = text.slice(0, 1500).trimStart();
  return /<(rss|feed|rdf:RDF)[\s>]/i.test(head) || /^\{[\s\S]*jsonfeed\.org/i.test(head);
}

export function parseFeed(text, feedUrl) {
  const head = text.trimStart();
  if (head.startsWith('{')) return parseJsonFeed(JSON.parse(head), feedUrl);
  const doc = xml.parse(text);
  if (doc.rss || doc['rdf:RDF']) return parseRss(doc.rss?.channel ?? doc['rdf:RDF'], doc['rdf:RDF'], feedUrl);
  if (doc.feed) return parseAtom(doc.feed, feedUrl);
  throw httpError(422, 'Not a recognised feed');
}

function parseRss(channel, rdf, feedUrl) {
  channel = arr(channel)[0] || {};
  const site = resolve(txt(arr(channel.link).find((l) => typeof l === 'string') ?? channel.link), feedUrl);
  const rawItems = arr(channel.item ?? rdf?.item);
  const items = rawItems.slice(0, 60).map((it) => {
    const link = resolve(txt(it.link) || txt(it.guid), site || feedUrl);
    const html = txt(it['content:encoded']) || txt(it.description);
    const img = it.enclosure?.['@_type']?.startsWith?.('image') ? it.enclosure['@_url'] : null;
    return {
      id: txt(it.guid) || link,
      title: stripHtml(txt(it.title), 300) || 'Untitled',
      link,
      date: iso(it.pubDate ?? it['dc:date'] ?? it.updated),
      author: stripHtml(txt(it['dc:creator'] ?? it.author), 80) || null,
      summary: stripHtml(txt(it.description) || html),
      image: resolve(txt(it['media:thumbnail']?.['@_url'] ?? it['media:content']?.['@_url'] ?? img), link) || firstImage(html, link),
    };
  });
  return { kind: 'feed', title: stripHtml(txt(channel.title), 120), site, items: items.filter((i) => i.link) };
}

function parseAtom(feed, feedUrl) {
  const pick = (links, rel) => {
    const l = arr(links).find((x) => (x['@_rel'] || 'alternate') === rel);
    return l?.['@_href'];
  };
  const site = resolve(pick(feed.link, 'alternate') || '', feedUrl);
  const items = arr(feed.entry).slice(0, 60).map((e) => {
    const link = resolve(pick(e.link, 'alternate') || '', site || feedUrl);
    const html = txt(e.content) || txt(e.summary);
    return {
      id: txt(e.id) || link,
      title: stripHtml(txt(e.title), 300) || 'Untitled',
      link,
      date: iso(e.published ?? e.updated),
      author: stripHtml(txt(arr(e.author)[0]?.name), 80) || null,
      summary: stripHtml(txt(e.summary) || html),
      image: resolve(e['media:thumbnail']?.['@_url'] || '', link) || firstImage(html, link),
    };
  });
  return { kind: 'feed', title: stripHtml(txt(feed.title), 120), site, items: items.filter((i) => i.link) };
}

function parseJsonFeed(j, feedUrl) {
  const site = j.home_page_url || feedUrl;
  const items = arr(j.items).slice(0, 60).map((it) => ({
    id: String(it.id || it.url),
    title: stripHtml(it.title || '', 300) || 'Untitled',
    link: resolve(it.url || it.external_url || '', site),
    date: iso(it.date_published || it.date_modified),
    author: it.authors?.[0]?.name || null,
    summary: stripHtml(it.summary || it.content_html || it.content_text || ''),
    image: it.image ? resolve(it.image, site) : null,
  }));
  return { kind: 'feed', title: stripHtml(j.title || '', 120), site, items: items.filter((i) => i.link) };
}

// ---- Discovery -----------------------------------------------------------

const COMMON_PATHS = ['feed', 'feed/', 'rss', 'rss.xml', 'rss.html', 'feed.xml', 'atom.xml', 'index.xml', 'feed.json', 'rss/', 'blog/feed', 'blog/rss.xml', 'blog/atom.xml'];

function guessCandidates(pageUrl) {
  const u = new URL(pageUrl);
  const out = [];
  const host = u.hostname.replace(/^www\./, '');
  const parts = u.pathname.split('/').filter(Boolean);

  if (host === 'github.com' && parts.length >= 2) out.push(`https://github.com/${parts[0]}/${parts[1]}/releases.atom`);
  if (host === 'github.com' && parts.length === 1) out.push(`https://github.com/${parts[0]}.atom`);
  if (host === 'medium.com' && parts[0]) out.push(`https://medium.com/feed/${parts[0]}`);
  if (host === 'reddit.com' && parts.length) out.push(u.origin + u.pathname.replace(/\/$/, '') + '/.rss');
  if (host === 'youtube.com' || host === 'm.youtube.com') {
    const id = u.searchParams.get('channel_id') || (parts[0] === 'channel' ? parts[1] : null);
    if (id) out.push(`https://www.youtube.com/feeds/videos.xml?channel_id=${id}`);
  }

  // Site root, and also the current directory (handles user.github.io/project/ style sites)
  const dir = u.origin + u.pathname.replace(/[^/]*$/, '');
  const bases = new Set([dir.endsWith('/') ? dir : dir + '/', u.origin + '/']);
  for (const b of bases) for (const p of COMMON_PATHS) out.push(b + p);
  return [...new Set(out)];
}

async function tryFeed(url) {
  const r = await fetchText(url, { timeout: 6000, maxBytes: 2_000_000 });
  if (!looksLikeFeed(r.text)) throw new Error('not a feed');
  const f = parseFeed(r.text, r.url);
  if (!f.items.length && !f.title) throw new Error('empty');
  return { ...f, feedUrl: r.url };
}

// Pick the first successful candidate in priority order, running them in parallel.
async function firstValid(urls) {
  const attempts = urls.map((u) => tryFeed(u).then((v) => v, () => null));
  for (const a of attempts) {
    const v = await a;
    if (v) return v;
  }
  return null;
}

export function scrapePage(html, pageUrl) {
  const { document } = parseHTML(html);
  const pageTitle = stripHtml(document.querySelector('title')?.textContent || '', 120);
  const root = document.querySelector('main') || document.body;
  const host = new URL(pageUrl).hostname;
  const seen = new Set();
  const items = [];
  for (const a of root.querySelectorAll('a[href]')) {
    if (a.closest('nav, header, footer, aside')) continue;
    const link = resolve(a.getAttribute('href'), pageUrl);
    if (!link) continue;
    let lu;
    try { lu = new URL(link); } catch { continue; }
    if (lu.hostname !== host || !/^https?:$/.test(lu.protocol)) continue;
    lu.hash = '';
    const clean = lu.href;
    if (clean === pageUrl || clean === new URL(pageUrl).origin + '/') continue;
    if (/\.(png|jpe?g|gif|svg|webp|pdf|zip|css|js|ico|mp4|mp3)$/i.test(lu.pathname)) continue;
    const title = a.textContent.replace(/\s+/g, ' ').trim();
    if (title.length < 12 || title.length > 200) continue;
    if (seen.has(clean)) continue;
    seen.add(clean);
    const t = a.closest('li, article, tr, p')?.querySelector('time[datetime]')?.getAttribute('datetime');
    items.push({ id: clean, title, link: clean, date: iso(t), author: null, summary: '', image: null });
    if (items.length >= 40) break;
  }
  return { kind: 'page', title: pageTitle, site: pageUrl, items };
}

export async function discover(input) {
  const url = normalizeUrl(input);
  const r = await fetchText(url);

  if (looksLikeFeed(r.text)) return { ...parseFeed(r.text, r.url), feedUrl: r.url };

  const { document } = parseHTML(r.text);
  const candidates = [];
  for (const l of document.querySelectorAll('link[rel~="alternate"][href]')) {
    const type = (l.getAttribute('type') || '').toLowerCase();
    if (/rss|atom|feed\+json|application\/json/.test(type) || /\.(xml|rss|atom)$/.test(l.getAttribute('href'))) {
      const href = resolve(l.getAttribute('href'), r.url);
      if (href) candidates.push(href);
    }
  }
  candidates.push(...guessCandidates(r.url));

  const found = await firstValid([...new Set(candidates)].slice(0, 30));
  if (found) return found;

  const here = new URL(r.url);
  if (here.pathname.replace(/\/+$/, '') !== '') {
    // Looks like a single article: watch the site's front page instead.
    try {
      const root = await fetchText(here.origin + '/');
      const rootFeed = looksLikeFeed(root.text) ? null : scrapePage(root.text, root.url);
      if (rootFeed && rootFeed.items.length >= 3) return { ...rootFeed, feedUrl: root.url };
    } catch {}
  }
  const page = scrapePage(r.text, r.url);
  if (page.items.length >= 3) return { ...page, feedUrl: r.url };
  throw httpError(422, "Couldn't find a feed or a list of articles on that page. Try the blog's index page.");
}

// Re-fetch an already-known source.
export async function loadSource(url, kind) {
  const r = await fetchText(url);
  if (kind === 'page') return { ...scrapePage(r.text, r.url), feedUrl: url };
  if (!looksLikeFeed(r.text)) throw httpError(422, 'Source is no longer a feed');
  return { ...parseFeed(r.text, r.url), feedUrl: url };
}
