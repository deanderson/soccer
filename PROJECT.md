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

### Darts scoring is format-aware
The darts engine reads `g.debug.firstTo` to compute relative margin bands
(close / medium / blowout). This lets a 10-8 World Matchplay R1 match
register as "close" while a 6-4 Premier League match also reads correctly
in its own format. Premier League sets firstTo=6 for all matches; Matchplay
uses a per-round table (R1=10, R2=11, QF=16, SF=17, F=18). Other tournaments
will need their own firstTo values when added.

## Key files

- `index.html` — frontend, all rendering, includes Top Picks + per-sport views
- `netlify/functions/get-scores.js` — main API: aggregates all sports, runs
  confidence engine, attaches watch providers, returns to client
- `netlify/functions/fetch-scores-job.js` — cron, calls get-scores, writes blob
- `netlify/functions/archive-scores-job.js` — cron, reads blob, writes Supabase
- `netlify/functions/refresh-scores.js` — on-demand refresh button (CURRENTLY BUGGY)
- `netlify/functions/darts-fetcher.js` — Wikipedia scraping for PDC tournaments
- `netlify/functions/watch-providers.js` — per-league watch URLs by country

## Database schema (Supabase `games` table)

| column | type | nullable | default |
|---|---|---|---|
| id | text | NO | — |
| sport | text | NO | — |
| league | text | NO | — |
| home, away | text | NO | — |
| home_score, away_score | integer | YES | — |
| match_ts | bigint | NO | — |
| status | text | YES | — |
| confidence_score | integer | YES | — |
| confidence_class | text | YES | — |
| confidence_factors | jsonb | YES | — |
| drama_hints | text[] | YES | — |
| timeline_cat | text | YES | — |
| raw_data | jsonb | YES | — |
| first_seen_at | timestamptz | YES | now() |
| updated_at | timestamptz | YES | now() |

Upserts on conflict by id. `first_seen_at` preserved on conflict;
`updated_at` set fresh on every upsert. No engine_version column yet —
filed for when we do real threshold tuning.

## Behavior to know

### Darts is structurally different

The site treats darts as session-level units, not match-level:

- **Main grid**: shows session-summary cards (date + verdict + commentary).
  Individual matches and player names hidden — bracket progression is a
  spoiler the score-reveal can't hide.
- **Top Picks**: same — session cards, never individual matches.
- **Tab badge**: counts sessions, not matches.

For Premier League Darts, "session" = "night" (one per Thursday).
For Matchplay etc., "session" = afternoon or evening session within a day.
Multi-session days split based on match count: >4 matches on a date →
infer afternoon (first 4) + evening (rest).

The session label lives at `g.debug.session`. Renderer falls back to
`g.date` when session is absent (Premier League games).

### Top Picks toggle is per-sport

Darts uses `Recent / All` (3-day / 14-day windows).
Other sports use `Today / Recent / This Week` (1 / 7 / 10 days).
State is tracked per-sport in `tpWindowBySport` so switching tabs preserves
each sport's chosen window.

### Country detection

`get-scores.js` reads CF-IPCountry header to pick provider URLs (Willow for
IPL in US, Sky for IPL in UK, etc.). The blob is country-neutral; watch
attachment happens per-request inside get-scores.

## Working agreements

- **Blast radius declarations** before claiming changes done. State what's
  touched, what's verified, what failure modes exist.
- **TESTING.md smoke test** after deploys touching shared code.
- **Fail-fast OK for new features.** Verify-first for shared code refactors.
- **Site success is "nice to have"; user education is #1.** This is a
  hobby project for learning to work with AI agents.
- **Bring problems, not solutions** when possible. Lets us explore the
  solution space together rather than locking into a first idea.
- **Ask the user for data instead of guessing about external structures.**
  When parsing APIs, scraping pages, or working against real data, the
  cost of "paste me the wikitext" is much lower than burning a deploy
  cycle on a guess.
- **Deploys cost ~$0.01 each.** Bundle small things together when possible.
  Don't avoid shipping when something's worth shipping.

## Estimation calibration

I tend to overshoot time estimates on simple changes (you'll often be
right that "this is 5 minutes"). I'm closer to accurate on iterative
work where each cycle reveals new info (scoring engine tuning, parser
work). Default to trusting your "5 min" intuition for single changes;
trust my estimate but cut by 30-40% for multi-cycle work.

## What's deployed vs local

Maintain a DEPLOYED.md or check Netlify dashboard. Sometimes local files
contain unshipped changes. Today (May 8) we shipped: night-summary view,
Top Picks per-sport windows, Matchplay parser, format-aware darts scoring.

