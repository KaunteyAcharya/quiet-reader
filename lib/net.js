// Safe outbound fetching for a public proxy: blocks private/internal addresses (SSRF),
// caps response size, limits redirects, enforces a timeout.
import dns from 'node:dns/promises';
import net from 'node:net';

const UA = 'Mozilla/5.0 (compatible; QuietReader/1.0; personal feed reader)';

export function isPrivateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return (
      a === 0 || a === 10 || a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127) ||
      a >= 224
    );
  }
  if (net.isIPv6(ip)) {
    const l = ip.toLowerCase();
    if (l === '::' || l === '::1') return true;
    if (l.startsWith('::ffff:')) {
      const v4 = l.slice(7);
      return net.isIPv4(v4) ? isPrivateIp(v4) : true;
    }
    return /^f[cd]/.test(l) || /^fe[89ab]/.test(l);
  }
  return true;
}

async function assertPublic(hostname) {
  // LOCAL TESTING ONLY. Never set this in production.
  if (process.env.ALLOW_PRIVATE_FETCH === '1') return;
  const host = hostname.replace(/^\[|\]$/g, '');
  if (net.isIP(host)) {
    if (isPrivateIp(host)) throw httpError(400, 'Address not allowed');
    return;
  }
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.internal')) {
    throw httpError(400, 'Address not allowed');
  }
  let addrs;
  try {
    addrs = await dns.lookup(host, { all: true });
  } catch {
    throw httpError(502, 'Could not resolve host');
  }
  if (!addrs.length || addrs.some((a) => isPrivateIp(a.address))) {
    throw httpError(400, 'Address not allowed');
  }
}

export function httpError(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}

export function normalizeUrl(input) {
  let s = String(input || '').trim();
  if (!s) throw httpError(400, 'Missing URL');
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) s = 'https://' + s;
  let u;
  try {
    u = new URL(s);
  } catch {
    throw httpError(400, 'Invalid URL');
  }
  if (!['http:', 'https:'].includes(u.protocol)) throw httpError(400, 'Only http(s) URLs are allowed');
  if (u.username || u.password) throw httpError(400, 'Credentials in URLs are not allowed');
  return u.href;
}

async function readCapped(res, max) {
  const reader = res.body.getReader();
  const chunks = [];
  let n = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    n += value.length;
    if (n > max) {
      await reader.cancel();
      break;
    }
    chunks.push(value);
  }
  return new TextDecoder('utf-8').decode(Buffer.concat(chunks));
}

export async function fetchText(inputUrl, { maxBytes = 3_000_000, timeout = 9000 } = {}) {
  let current = new URL(normalizeUrl(inputUrl));
  for (let hop = 0; hop < 5; hop++) {
    await assertPublic(current.hostname);
    let res;
    try {
      res = await fetch(current, {
        redirect: 'manual',
        signal: AbortSignal.timeout(timeout),
        headers: {
          'user-agent': UA,
          accept: 'application/rss+xml, application/atom+xml, application/feed+json, application/xml;q=0.9, text/html;q=0.8, */*;q=0.5',
        },
      });
    } catch (e) {
      throw httpError(502, e.name === 'TimeoutError' ? 'Site took too long to respond' : 'Could not reach site');
    }
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      current = new URL(res.headers.get('location'), current);
      if (!['http:', 'https:'].includes(current.protocol)) throw httpError(400, 'Bad redirect');
      continue;
    }
    if (!res.ok) throw httpError(res.status === 404 ? 404 : 502, `Site returned ${res.status}`);
    const text = await readCapped(res, maxBytes);
    return { text, url: current.href, contentType: res.headers.get('content-type') || '' };
  }
  throw httpError(502, 'Too many redirects');
}
