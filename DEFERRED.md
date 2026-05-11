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

### Finals/championship tier (cross-sport)
Some matches transcend the "is it close?" question — finals, championship
games, deciders. Users watch them because of what they ARE, not because
of confidence-engine score. A 13-18 Matchplay final blowout is still THE
final. A Super Bowl blowout still gets watched.

Apply to:
- **Darts**: Tournament finals (F round). Maybe semifinals too.
- **NFL**: Super Bowl, conference championships, playoff games
- **MLB**: World Series, LCS games, wild card
- **NBA**: Finals, conference finals, playoff games
- **NHL**: Stanley Cup Final, conference finals, playoff games
- **Football**: Champions League final, FA Cup final, World Cup knockout
- **Cricket**: World Cup final, IPL final, T20 World Cup knockouts
- **Tennis**: Grand Slam finals, possibly semifinals

UX shape: separate visual treatment from regular Must Watch. Maybe a
trophy emoji 🏆, special label like "The Final" or "Championship", no
"was it close" commentary. Watch button still applies.

Implementation: detection logic per sport (round=F for darts, playoff
flag from API for NFL, etc.). Probably a `isMarquee` flag on games
that overrides normal tiering in display.

Distinct from but adjacent to the marquee/favorites bonus — that
boosts confidence scoring for star players. This is a separate
override at the rendering layer.

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

Test fixtures to save:
- `2025_PDC_World_Darts_Championship?action=raw` — multi-session days
- `2024_Grand_Slam_of_Darts?action=raw` — group + knockout format

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

### Visual cue for "strong" vs "single" Must Watch
Currently both "2+ Must Watch matches" and "1 Must Watch match" sessions
show as Must Watch tier with different hint text. The hint is easy to
miss when scrolling. Consider a sub-badge or color variation to make
the difference visible at a glance.

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
- ✅ Darts night-summary view, main grid (May 8)
- ✅ Darts night-summary view, Top Picks (May 8)
- ✅ Top Picks per-sport window (Recent / All for darts) (May 8)
- ✅ World Matchplay parser (May 8 — using 2025 test data, ready for July)
- ✅ Format-aware darts confidence scoring (May 8 — uses firstTo per round)
- ✅ Session-grouping for multi-session days (May 8 — Sun 20 splits afternoon/evening)

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
