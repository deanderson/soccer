# Jentzen Ramirez Channel Analytics — Deployment Notes

## What's in this folder

```
jr-analytics-x7k2p9/
  ├── index.html      ← The dashboard (open in a browser to preview locally)
  ├── robots.txt      ← Tells search engines to skip this folder
  └── README.md       ← This file (don't upload it)
```

## How to deploy

1. Upload the **entire `jr-analytics-x7k2p9/` folder** to your site's web root.
   - Final URL will be: `https://spoilerfreescores.com/jr-analytics-x7k2p9/`
   - The folder name itself is the "hidden" part — keep it private.
2. Don't link to it from your navigation, homepage, or sitemap.
3. Share the direct URL with whoever needs access.

## Privacy posture

This setup gives you **"unlisted, not private"** — the same level of privacy as an unlisted YouTube video:
- ✅ Not indexed by Google (noindex meta tag + robots.txt)
- ✅ Not in your site nav
- ✅ Random URL slug that can't be guessed
- ❌ Anyone with the URL can view it
- ❌ Not protected by a password

If you need actual privacy (login required), see the "Adding a password" section below.

## To update the data later

The dashboard is point-in-time — it shows view counts as of when you pulled the data. To refresh:

1. Re-run `fetch_youtube.py` (the script I sent earlier) to get fresh `channel_data.json`
2. Send it back to me and I'll regenerate the dashboard
3. Replace `index.html` in the folder with the new one

If you want this self-service, just ask — I can give you a single script that does fetch → regenerate dashboard in one step.

## Adding a password (optional, recommended)

The methods depend on where your site is hosted:

### If you're on Netlify
Add a file called `_headers` next to `index.html`:
```
/jr-analytics-x7k2p9/*
  Basic-Auth: username:password
```

### If you're on Cloudflare Pages
Use Cloudflare Access (free for up to 50 users) — set up at dash.cloudflare.com → Zero Trust → Access → Applications.

### If you're on a traditional host (cPanel, shared hosting)
Use `.htaccess`. Create a file named `.htaccess` in the folder with:
```
AuthType Basic
AuthName "Analytics"
AuthUserFile /full/path/to/.htpasswd
Require valid-user
```
Then create `.htpasswd` with `htpasswd -c .htpasswd yourusername`.

### Lightweight option (any host)
Add a JS prompt at the top of `index.html`. Not real security, but blocks casual visitors. I can add this if you want — just ask.

## Notes

- The dashboard loads Chart.js and Google Fonts from CDNs. If your site has a strict Content Security Policy, you may need to allow `cdn.jsdelivr.net` and `fonts.googleapis.com` / `fonts.gstatic.com`.
- All channel data is embedded directly in the HTML — no API calls happen when the page loads. Visiting it doesn't ping YouTube or use any quota.
- The page is ~133 KB total. Loads instantly.
