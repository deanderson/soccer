# Deferred Work

> Things filed for later. Update as you complete or add items.

## Bugs (real, low-priority)

- **Refresh button broken.** Cooldown logic measures blob age, not user
  action age. With 15-min cron and 5-min cooldown, the cooldown almost
  always fires. Even when 429 returns, frontend doesn't reload from blob.
  User sees no change. Fix: separate user-action cooldown from blob age.
  Always fetch on user click if last user click >60s ago. Workaround for
  now: hard-refresh page.

## Features filed

### Threshold tuning pass (after 1 week of DB data)
Use the `games` table to look at `confidence_score` distribution by
`confidence_class` per sport. See if our class boundaries match the
actual score distribution. Adjust thresholds if needed. Wait until
~7 days of clean data minimum.

### Marquee + favorites bonus
Two-tier signal in confidence engine:
- Universal star bonus: top-N global rankings (PDC top 16, ATP top 20,
  WTA top 20, NBA all-stars). Adds points for marquee names.
- Personal favorites bonus: user-designated favorite teams/players.
  Adds bigger points just for them.
Implementation later — needs static lookup tables, user preferences
(localStorage v1, account-backed v2), confidence engine refactor to
take userContext, settings UI.

### Darts: more tournament parsers
Currently: Premier League Darts (live), 2025 Matchplay (test config).
Next waves:
- World Matchplay (July) — convert test config to live
- World Championship (Dec/Jan) — multi-session, 128 players
- Grand Slam of Darts (Nov) — group stage + knockout
- UK Open (March) — multi-day knockout
- Masters / Players Championship Finals — single-day knockout
- World Cup of Darts (June) — team event
- World Series Finals — invitational
Each parser is its own session of work; don't try to do all in one push.
Build each from prior year's wiki page for testing.

### Engine version column
Add `engine_version` to `games` table when we make a real threshold
tuning pass. Lets us compare old vs new scoring on historical data.
Skipped initially via YAGNI; consider adding before first tuning.

### "Best games of the week" historical view
Now that the DB collects history, build a query that surfaces highest
confidence-score games from the past 7 days across sports. Could power
a "Hall of Fame" tab.

### Darts night summary commentary variation
Currently the same commentary line ("Worth your time — at least one match
delivered") repeats across nights. Add 2-3 variants per tier so scrolling
multiple nights doesn't feel repetitive.

### Top Picks one-pick copy variations
"That's the session worth watching" / "That's the one worth watching today"
could use a few variants. Filed under polish.

## Process improvements

### TESTING.md committed
Drop the TESTING.md file in repo root. We use it after deploys but it's
not in version control yet.

### PROJECT.md and DEFERRED.md committed and maintained
This file + the project context document. Paste at start of each session
where relevant.

## Closed (kept for reference)

- ✅ Database archive pipeline (May 8)
- ✅ Country-aware caching for IPL/PSL watch providers (May 8)
- ✅ Tennis archive fix (synthesized id) (May 8)
- ✅ Spoiler-Free Mode toggle removed (May 8)
- ✅ Darts night-summary view (May 8)
- ✅ Top Picks per-sport window (Recent / All for darts) (May 8)
- ✅ World Matchplay parser (May 8 — test config; verify with live data)
