import { fetchRange } from '../lib/net.js';

// Streams a PDF to the viewer one slice at a time (HTTP Range), for links whose site doesn't allow
// the browser to read them directly. Slices are small so this fits a free serverless function.
export default async function handler(req, res) {
  try {
    const m = /bytes=(\d+)-(\d*)/i.exec(req.headers.range || '');
    const start = m ? Number(m[1]) : 0;
    const end = m && m[2] ? Number(m[2]) : start + 1_048_575;
    const r = await fetchRange(req.query.url, start, end);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Content-Range', `bytes ${r.start}-${r.end}/${r.total}`);
    res.setHeader('Content-Length', r.buf.length);
    res.setHeader('Cache-Control', 'private, max-age=600');
    res.status(206).send(r.buf);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.status ? e.message : 'Something went wrong' });
  }
}
