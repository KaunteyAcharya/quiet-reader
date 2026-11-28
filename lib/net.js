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
    if (/application\/pdf/i.test(res.headers.get('content-type') || '')) {
      res.body?.cancel().catch(() => {});
      throw httpError(415, 'This link is a PDF — Quiet opens it in the PDF viewer');
    }
    const text = await readCapped(res, maxBytes);
    return { text, url: current.href, contentType: res.headers.get('content-type') || '' };
  }
  throw httpError(502, 'Too many redirects');
}

// Fetch one slice of a (PDF) file so a big book never has to pass through the server in one piece.
// Returns { buf, start, end, total }. Works whether or not the origin supports Range requests.
export async function fetchRange(inputUrl, start, end, { maxBytes = 3_500_000, timeout = 9000 } = {}) {
  if (end - start + 1 > maxBytes) end = start + maxBytes - 1;
  let current = new URL(normalizeUrl(inputUrl));
  for (let hop = 0; hop < 5; hop++) {
    await assertPublic(current.hostname);
    let res;
    try {
      res = await fetch(current, {
        redirect: 'manual',
        signal: AbortSignal.timeout(timeout),
        headers: { 'user-agent': UA, accept: 'application/pdf,*/*;q=0.5', range: `bytes=${start}-${end}` },
      });
    } catch (e) {
      throw httpError(502, e.name === 'TimeoutError' ? 'Site took too long to respond' : 'Could not reach site');
    }
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      current = new URL(res.headers.get('location'), current);
      if (!['http:', 'https:'].includes(current.protocol)) throw httpError(400, 'Bad redirect');
      continue;
    }
    if (res.status === 416) throw httpError(416, 'Past the end of the file');
    if (!res.ok) throw httpError(res.status === 404 ? 404 : 502, `Site returned ${res.status}`);
    const reader = res.body.getReader();
    const chunks = [];
    let got = 0;
    let skip = 0; // bytes to drop when the origin ignored our Range and sent the whole file
    const partial = res.status === 206;
    let total = null;
    if (partial) {
      const m = /bytes\s+(\d+)-(\d+)\/(\d+|\*)/i.exec(res.headers.get('content-range') || '');
      if (m) { start = Number(m[1]); total = m[3] === '*' ? null : Number(m[3]); }
    } else {
      total = Number(res.headers.get('content-length')) || null;
      if (start > maxBytes * 4) { await reader.cancel(); throw httpError(413, 'This server does not support partial downloads and the file is too large'); }
      skip = start;
    }
    const want = end - start + 1 + skip;
    while (got < want) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      got += value.length;
    }
    await reader.cancel().catch(() => {});
    let buf = Buffer.concat(chunks).subarray(skip, want);
    if (!partial && total === null) {
      if (got >= want) throw httpError(413, 'This server does not report the file size');
      total = got;
    }
    if (start === 0 && !buf.subarray(0, 1024).includes('%PDF')) throw httpError(415, 'That link is not a PDF');
    return { buf, start, end: start + buf.length - 1, total };
  }
  throw httpError(502, 'Too many redirects');
}
