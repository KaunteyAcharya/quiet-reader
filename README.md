# Quiet

A reader for only what you choose. No algorithm, no infinite scroll.

Add any blog, newsletter, Substack, WordPress site, GitHub repo (releases), or plain website. Quiet finds the feed; if there is none, it watches the page for new links. Articles open in a clean reader with themes you control, and there is a markdown writing studio built in.

## Run locally
```
npm install
npm run dev     # http://localhost:3000
npm test
```

## Deploy free (about 3 minutes)
1. Push this folder to a GitHub repo.
2. Go to vercel.com, **Add New → Project**, import the repo, click **Deploy**. No settings needed.
3. Done. Free Hobby plan: personal, non-commercial use.

Alternative: Cloudflare Pages + Functions also has a free tier (the `api/` handlers need a small adapter).

## How it works
- `public/` static app (vanilla JS). All your data (sources, read state, saved, drafts, theme) is stored in your browser.
- `api/` three serverless functions: `discover` (find feed), `feed` (fetch and normalise), `article` (reader mode). Needed because browsers block cross-site fetching (CORS).
- Security: server blocks private/internal addresses (SSRF), caps size/time/redirects, sanitises article HTML, strict CSP.

## Limits
- No cross-device sync yet (use Data → backup/OPML). Next step: free Supabase or Cloudflare KV login.
- Some sites block server fetches or are paywalled; those open the original instead.
- Never set `ALLOW_PRIVATE_FETCH` in production (tests only).
