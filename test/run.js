import assert from 'node:assert/strict';
import http from 'node:http';

process.env.ALLOW_PRIVATE_FETCH = '1'; // fixtures live on localhost; never set in production
const { parseFeed, discover, scrapePage } = await import('../lib/feed.js');
const { sanitize, readArticle } = await import('../lib/article.js');
const { isPrivateIp, normalizeUrl } = await import('../lib/net.js');

const rss = `<?xml version="1.0"?><rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:dc="http://purl.org/dc/elements/1.1/"><channel><title>PG</title><link>http://x.test/</link>
<item><title>Hello &amp; welcome</title><link>/a</link><guid>a1</guid><pubDate>Tue, 03 Nov 2026 10:00:00 GMT</pubDate><dc:creator>Paul</dc:creator><description>&lt;p&gt;Short &lt;b&gt;text&lt;/b&gt;&lt;/p&gt;</description><content:encoded><![CDATA[<img src="/i.png"><p>Full</p>]]></content:encoded></item></channel></rss>`;
const atom = `<feed xmlns="http://www.w3.org/2005/Atom"><title>Rel</title><link href="https://g.test/r" rel="alternate"/><entry><title>v1.0</title><link href="https://g.test/r/v1" rel="alternate"/><id>tag:1</id><updated>2026-11-01T00:00:00Z</updated><content type="html">&lt;p&gt;notes&lt;/p&gt;</content></entry></feed>`;
const jsonf = JSON.stringify({ version: 'https://jsonfeed.org/version/1.1', title: 'J', home_page_url: 'https://j.test/', items: [{ id: '1', url: 'https://j.test/1', title: 'One', date_published: '2026-11-02T00:00:00Z' }] });

let n = 0;
const t = (name, fn) => Promise.resolve(fn()).then(() => console.log('ok  ', ++n, name));

await t('rss parse', () => {
  const f = parseFeed(rss, 'http://x.test/feed');
  assert.equal(f.items[0].title, 'Hello & welcome');
  assert.equal(f.items[0].link, 'http://x.test/a');
  assert.equal(f.items[0].author, 'Paul');
  assert.equal(f.items[0].summary, 'Short text');
  assert.equal(f.items[0].image, 'http://x.test/i.png');
  assert.ok(f.items[0].date.startsWith('2026-11-03'));
});
await t('atom parse', () => {
  const f = parseFeed(atom, 'https://g.test/r.atom');
  assert.equal(f.items[0].link, 'https://g.test/r/v1');
  assert.equal(f.items[0].summary, 'notes');
});
await t('json feed parse', () => assert.equal(parseFeed(jsonf, 'https://j.test/feed.json').items[0].title, 'One'));
await t('ssrf ip rules', () => {
  for (const ip of ['127.0.0.1', '10.1.2.3', '192.168.0.1', '169.254.169.254', '172.20.0.1', '::1', 'fd00::1', '::ffff:10.0.0.1']) assert.ok(isPrivateIp(ip), ip);
  for (const ip of ['8.8.8.8', '1.1.1.1', '2606:4700::1111']) assert.ok(!isPrivateIp(ip), ip);
});
await t('url normalisation', () => {
  assert.equal(normalizeUrl('paulgraham.com'), 'https://paulgraham.com/');
  assert.throws(() => normalizeUrl('file:///etc/passwd'));
  assert.throws(() => normalizeUrl('https://u:p@x.com'));
});
await t('sanitiser strips scripts/handlers/js links', () => {
  const out = sanitize('<p onclick="x()">hi<script>alert(1)</script><iframe src="//e"></iframe><a href="javascript:alert(1)">b</a><a href="/ok">c</a><img src="/p.png" onerror="x()"></p>', 'https://s.test/post');
  assert.ok(!/script|onclick|onerror|iframe|javascript:/i.test(out), out);
  assert.ok(out.includes('https://s.test/ok') && out.includes('https://s.test/p.png'));
});
await t('page-watch scraper', () => {
  const html = `<html><title>Essays</title><body><nav><a href="/about-us-page-long">About us page long</a></nav><main><ul>
  <li><a href="/a-long-essay-title">A long essay title one</a></li><li><a href="/b-long-essay-title">Another long essay title</a></li><li><a href="/c-long-essay-title">Third long essay title</a></li>
  <li><a href="https://other.test/x">An external long link here</a></li></ul></main></body></html>`;
  const r = scrapePage(html, 'https://s.test/articles');
  assert.equal(r.items.length, 3);
});

// End-to-end against a local fixture site (discovery via <link>, via guessed path, and page-watch fallback)
const art = '<html><head><title>Post</title></head><body><article><h1>Post</h1><p>' + 'Words here. '.repeat(120) + '</p><script>evil()</script></article></body></html>';
const srv = http.createServer((q, r) => {
  const send = (type, body) => (r.setHeader('content-type', type), r.end(body));
  if (q.url === '/a/') return send('text/html', '<html><head><link rel="alternate" type="application/rss+xml" href="/custom.xml"></head><body>hi</body></html>');
  if (q.url === '/custom.xml') return send('application/rss+xml', rss);
  if (q.url === '/b/') return send('text/html', '<html><body>no link tag</body></html>');
  if (q.url === '/b/atom.xml') return send('application/atom+xml', atom);
  if (q.url === '/c/') return send('text/html', `<html><title>Plain</title><body><main><a href="/c/one-long-title-x">One long title here</a><a href="/c/two-long-title-x">Two long title here</a><a href="/c/three-long-title-x">Three long title here</a></main></body></html>`);
  if (q.url === '/') return send('text/html', `<html><title>Home</title><body><main><a href="/x/one-long-title-x">One long title here</a><a href="/x/two-long-title-x">Two long title here</a><a href="/x/three-long-title-x">Three long title here</a></main></body></html>`);
  if (q.url === '/x/article') return send('text/html', '<html><title>An article</title><body><main><p>Just text, no index.</p></main></body></html>');
  if (q.url === '/post') return send('text/html', art);
  if (q.url === '/redir') { r.statusCode = 302; r.setHeader('location', '/post'); return r.end(); }
  r.statusCode = 404; r.end('nf');
}).listen(0);
const base = `http://127.0.0.1:${srv.address().port}`;
try {
  await t('discover via <link rel=alternate>', async () => { const d = await discover(base + '/a/'); assert.equal(d.kind, 'feed'); assert.equal(d.feedUrl, base + '/custom.xml'); });
  await t('discover via guessed path', async () => { const d = await discover(base + '/b/'); assert.equal(d.feedUrl, base + '/b/atom.xml'); });
  await t('discover falls back to page-watch', async () => { const d = await discover(base + '/c/'); assert.equal(d.kind, 'page'); assert.equal(d.items.length, 3); });
  await t('article page falls back to watching the site front page', async () => { const d = await discover(base + '/x/article'); assert.equal(d.kind, 'page'); assert.equal(d.feedUrl, base + '/'); assert.equal(d.items.length, 3); });
  await t('article extraction + redirect', async () => { const a = await readArticle(base + '/redir'); assert.ok(a.content.includes('Words here') && !a.content.includes('evil')); assert.ok(a.minutes >= 1); });
  await t('private hosts blocked when protection on', async () => {
    delete process.env.ALLOW_PRIVATE_FETCH;
    await assert.rejects(discover(base + '/a/'), /not allowed/);
    await assert.rejects(discover('http://169.254.169.254/latest/meta-data'), /not allowed/);
    await assert.rejects(discover('http://localhost:1/'), /not allowed/);
  });
} finally {
  srv.close();
}
console.log(`\nAll ${n} checks passed.`);
