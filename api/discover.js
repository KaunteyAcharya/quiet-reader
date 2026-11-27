import { discover } from '../lib/feed.js';

export default async function handler(req, res) {
  try {
    const data = await discover(req.query.url);
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
    res.status(200).json(data);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.status ? e.message : 'Something went wrong' });
  }
}
