// Reader mode: fetch an article, extract the readable part, and sanitise it.
import { parseHTML } from 'linkedom';
import { Readability } from '@mozilla/readability';
import { fetchText, httpError } from './net.js';

const DROP = 'script, style, iframe, object, embed, form, input, button, link, meta, noscript, svg, canvas, audio, video, dialog';

export function sanitize(html, base) {
  const { document } = parseHTML(`<div id="root">${html}</div>`);
  const root = document.getElementById('root');
  root.querySelectorAll(DROP).forEach((n) => n.remove());
  for (const el of root.querySelectorAll('*')) {
    for (const attr of [...el.attributes]) {
      const name = attr.name.toLowerCase();
      if (name.startsWith('on') || name === 'style' || name === 'srcdoc') el.removeAttribute(attr.name);
    }
  }
  const abs = (v) => {
    try {
      const u = new URL(v, base);
      return /^https?:$/.test(u.protocol) ? u.href : null;
    } catch {
      return null;
    }
  };
  for (const a of root.querySelectorAll('a[href]')) {
    const h = abs(a.getAttribute('href'));
    if (h) {
      a.setAttribute('href', h);
      a.setAttribute('target', '_blank');
      a.setAttribute('rel', 'noopener noreferrer nofollow');
    } else a.removeAttribute('href');
  }
  for (const img of root.querySelectorAll('img')) {
    const src = abs(img.getAttribute('src') || img.getAttribute('data-src') || '');
    if (!src) { img.remove(); continue; }
    img.setAttribute('src', src);
    img.setAttribute('loading', 'lazy');
    img.setAttribute('referrerpolicy', 'no-referrer');
    img.removeAttribute('srcset');
    img.removeAttribute('sizes');
  }
  return root.innerHTML;
}

export async function readArticle(url) {
  const r = await fetchText(url, { maxBytes: 4_000_000 });
  const { document } = parseHTML(r.text);
  const art = new Readability(document, { keepClasses: false }).parse();
  if (!art || !art.content) throw httpError(422, "Couldn't extract this page for reading. Open the original instead.");
  const words = (art.textContent || '').trim().split(/\s+/).length;
  return {
    url: r.url,
    title: art.title || '',
    byline: art.byline || '',
    siteName: art.siteName || new URL(r.url).hostname.replace(/^www\./, ''),
    excerpt: art.excerpt || '',
    minutes: Math.max(1, Math.round(words / 230)),
    content: sanitize(art.content, r.url),
  };
}
