# spoilerfreescores.com — Project Context

> Paste this at the start of any Claude session that touches this codebase.
> Update after major changes.

## What this is

A sports score site that hides scores behind reveal buttons so users can
catch up on games they missed without spoilers. Curates "what's actually
worth watching" using a confidence engine that scores games on closeness,
drama, and comeback signals.

Mission: "Too many games. Find the good ones."

## Tech stack

- **Frontend**: single `index.html` with vanilla JS, served from Netlify
- **Backend**: Netlify serverless functions (Node)
- **Caching**: Netlify Blobs (15-min refresh cycle)
- **Archive**: Supabase Postgres, hourly upsert
- **Domain**: spoilerfreescores.com

## Architecture (today)

```
ESPN/Wiki/Cricbuzz APIs
        ↓
fetch-scores-job (cron */15)  →  Netlify Blob
                                       ↓
User browser ← get-scores ← Netlify Blob
                                       ↓
                          archive-scores-job (cron 0 *)
                                       ↓
                                 Supabase `games` table
```

## Current sports

Football, Cricket (T20), Darts, NBA, NFL, MLB, NHL, Tennis. Tennis was
recently added; archive job has a synthesized id for tennis games (no
native id from the source).

## Confidence engine

`get-scores.js` adds a `confidence` object to each game:
- `score` (0-100)
- `cls` ('scorefest' | 'watchworthy' | 'watchable' | 'defensive' | 'blowout')
- `factors` (array of contributing signals)

Frontend filters games by `cls`:
- 'scorefest', 'watchworthy' = Must Watch
- 'watchable' = Worth Watching
- 'defensive', 'blowout' = Skip

Top Picks: Must Watch only by default, Watchable backfill in Recent/Week.

## Key files

- `index.html` — frontend, all rendering, includes Top Picks + per-sport views
- `netlify/functions/get-scores.js` — main API: aggregates all sports, runs
  confidence engine, attaches watch providers, returns to client
- `netlify/functions/fetch-scores-job.js` — cron, calls get-scores, writes blob
- `netlify/functions/archive-scores-job.js` — cron, reads blob, writes Supabase
- `netlify/functions/refresh-scores.js` — on-demand refresh button (CURRENTLY BUGGY)
- `netlify/functions/darts-fetcher.js` — Wikipedia scraping for PDC tournaments
- `netlify/functions/watch-providers.js` — per-league watch URLs by country

## Database schema

Single `games` table:
- `id` (text, primary key — synthesized for tennis)
- `sport` (text)
- `league`, `home`, `away`, `home_score`, `away_score`, `match_ts`, `status`
- `confidence_score`, `confidence_class`, `confidence_factors` (jsonb)
- `drama_hints` (text[])
- `timeline_cat` (text)
- `raw_data` (jsonb — full original game object for forensics)
- `first_seen_at`, `updated_at` (timestamptz, default now())

Upserts on conflict by id. `first_seen_at` preserved on conflict;
`updated_at` set fresh on every upsert.

## Behavior to know

- **Top Picks toggle is per-sport.** Darts uses Recent / All; other sports use
  Today / Recent / This Week.
- **Darts is structurally different.** Main grid + Top Picks both show
  *night summaries* (no individual matches, no player names) so bracket
  progression doesn't leak. Other sports show individual games.
- **Country detection.** `get-scores.js` reads CF-IPCountry header to
  pick provider URLs (Willow for IPL in US, Sky for IPL in UK, etc.).
- **Blob is country-neutral**, watch attachment happens per-request.

## Working agreements

- **Blast radius declarations** before claiming changes done. State what's
  touched, what's verified, what failure modes exist.
- **TESTING.md smoke test** after deploys touching shared code.
- **Fail-fast OK for new features.** Verify-first for shared code refactors.
- **Site success is "nice to have"; user education is #1.** This is a
  hobby project for learning to work with AI agents.

## What's deployed vs local

Maintain this in DEPLOYED.md or check Netlify dashboard. Sometimes local
files contain unshipped changes.
