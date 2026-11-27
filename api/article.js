import { readArticle } from '../lib/article.js';

export default async function handler(req, res) {
  try {
    const data = await readArticle(req.query.url);
    res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400');
    res.status(200).json(data);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.status ? e.message : 'Something went wrong' });
  }
}
