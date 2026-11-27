import { loadSource } from '../lib/feed.js';

export default async function handler(req, res) {
  try {
    const kind = req.query.kind === 'page' ? 'page' : 'feed';
    const data = await loadSource(req.query.url, kind);
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
    res.status(200).json(data);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.status ? e.message : 'Something went wrong' });
  }
}
