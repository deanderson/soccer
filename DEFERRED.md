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

### WNBA broadcast display (READY TO BUILD next session)
The "where to watch" feature that's central to the WNBA-first positioning.
Scoping done May 11. Data source verified via real ESPN responses.

**Data source: ESPN's scoreboard `geoBroadcasts` field** (no scraping needed).
Confirmed structure from May 11 + May 17 sample fetches:

```js
geoBroadcasts: [
  { type: { shortName: 'TV' | 'Streaming' },
    market: { type: 'National' | 'Home' | 'Away' },
    media: { shortName: 'NBC' | 'ESPN' | 'Peacock' | ... },
    region: 'us' }
]
```

Also: `broadcast` field (string) is populated only for nationally televised
games — useful as a quick "is this on national TV" check.

**Tiered display logic for US fans:**
- National TV (NBC, ABC, CBS, ESPN, ION, NBA TV, NBCSN):
  → "📺 Tonight on [network], [time]"
- National streaming only (Peacock, Disney+, Amazon, ESPN+):
  → "💻 Tonight on [service] (subscription)"
- Local market only (3 of 4 typical games):
  → "📍 Local broadcast only. Out of market? Watch on WNBA League Pass."

**Failure mode:** if no geoBroadcasts for a game (rare, but possible),
show "Broadcast TBD" with link to WNBA.com schedule.

**Implementation steps:**
1. Update `fetchWNBAWithTimeline()` to capture `geoBroadcasts` and `broadcast`
   fields in the game object.
2. Add `getBroadcastInfo(game)` helper that returns `{ network, type, label }`
   from the geoBroadcasts array, prioritizing National > Home/Away.
3. Update the frontend card render to show the broadcast info.
4. Update `watch-providers.js` to add WNBA mappings:
   - 'WNBA League Pass' as the fallback for local-only games
   - Per-network deep links for nationally televised games
5. Country-aware later — UK fans get Sky, Canada gets TSN/Sportsnet, etc.

**Scope budget:** 3-4 hours one focused session.

**Out of scope for v1:** International country mappings, WNBA.com scraping
fallback, push notifications when a Must Watch game is about to start.

### Private voting on game ratings
Thumbs up/down on each game's verdict. Data goes to user only (private),
not displayed to other users.

**Phase 1: simple binary vote.** Two buttons per card ("Was this rated
correctly?" yes/no). localStorage prevents double-voting per browser.
Sent to a new Netlify function, written to a new Supabase `votes` table.

**Phase 2 (later):** Predefined "why?" options on thumbs-down ("Closer
than rated", "More boring than rated", "Wrong category"). Quick clicks,
no free-text.

**Phase 3 (much later):** Open text feedback. Only after community trust
established.

**Strategic angle:** A reddit post that says "I built this and I'm
tracking whether the curation is right" is a stronger framing than just
shipping. Voting transforms it from "a thing I made" to "a thing I'm
refining with help."

### Look-and-feel: visual identity + logomark
Open-ended design work. Today's UI pass focused on functional polish.
Next pass:
- A small logomark (eye icon? something tied to "spoiler-free" identity)
- Typography hook beyond just the Bebas Neue header
- Distinctive visual element so the site is recognizable in screenshots

Scope carefully or it expands. Time-box at one session.

### Light mode toggle
Audit every color, define parallel light palette, add toggle, persist
preference. Not "duplicate with white background" — real design
decisions (Must Watch green on white? red border still reads urgent?).
3-4 hours minimum.

### Stale-blob fallback (spike protection)
Before any r/wnba marketing push, harden the fallback path. Current state:
20-min freshness window, falls through to live ESPN fetch on miss. Bad
if cron fails during traffic spike.

Tiered fallback:
- Blob <30 min: serve fresh
- Blob 30 min – 4 hours: serve with "stale, refreshing" indicator,
  trigger background refresh
- Blob >4 hours or missing: live fetch

Plus circuit breaker: if live fetch fires >5 times/minute, throttle.

Also: curl test concurrent requests before posting:
```bash
seq 100 | xargs -n1 -P20 -I{} curl -s -o /dev/null -w "%{http_code} %{time_total}\n" https://spoilerfreescores.com/.netlify/functions/get-scores
```

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
- **WNBA**: Finals, conference finals, playoff games
- **NHL**: Stanley Cup Final, conference finals, playoff games
- **Football**: Champions League final, FA Cup final, World Cup knockout
- **Cricket**: World Cup final, IPL final, T20 World Cup knockouts
- **Tennis**: Grand Slam finals, possibly semifinals

UX: separate visual treatment from regular Must Watch. Trophy emoji 🏆,
special label like "The Final" or "Championship", no "was it close"
commentary. Watch button still applies.

Implementation: detection per sport (round=F for darts, playoff flag
from API for NFL/NBA/WNBA, etc.). Probably an `isMarquee` flag on games
that overrides normal tiering in display.

### Threshold tuning pass (after 1 week of DB data)
Use the `games` table to look at `confidence_score` distribution by
`confidence_class` per sport. See if our class boundaries match the
actual score distribution.

Special focus on WNBA — thresholds were scaled from NBA's. Real
distributions may differ significantly once real games archive.

### Marquee + favorites bonus
Two-tier signal in confidence engine:
- Universal star bonus: top-N global rankings (PDC top 16, ATP top 20,
  WTA top 20, NBA all-stars, WNBA all-stars). Adds points for marquee
  names.
- Personal favorites bonus: user-designated favorite teams/players.
  Adds bigger points just for them.
Needs static lookup tables, user preferences (localStorage v1,
account-backed v2), confidence engine refactor to take userContext,
settings UI.

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

Test fixtures to save:
- `2025_PDC_World_Darts_Championship?action=raw` — multi-session days
- `2024_Grand_Slam_of_Darts?action=raw` — group + knockout format

### Engine version column
Add `engine_version` to `games` table when we make a real threshold
tuning pass. Lets us compare old vs new scoring on historical data.

### "Best games of the week" historical view
Now that the DB collects history, build a query that surfaces highest
confidence-score games from the past 7 days across sports. Could power
a "Hall of Fame" tab.

### Darts night summary commentary variation
Currently the same commentary line repeats across nights. Add 2-3
variants per tier so scrolling multiple nights doesn't feel repetitive.

### Top Picks one-pick copy variations
"That's the session worth watching" / "That's the one worth watching today"
could use a few variants. Polish.

### Visual cue for "strong" vs "single" Must Watch
Currently both "2+ Must Watch matches" and "1 Must Watch match" sessions
show as Must Watch tier with different hint text. Consider a sub-badge
or color variation.

### Reconsider "Late drama" suppression in insights
Currently suppressed because it might hint at when drama happened. But
it doesn't reveal direction (who won). Re-evaluate after watching how
users engage with insight reveals.

## Process improvements

### TESTING.md committed
Drop TESTING.md in repo root. We use it after deploys but it's not in
version control yet.

### PROJECT.md and DEFERRED.md committed and maintained
This file + the project context document. Paste at start of each session
where relevant.

## Closed (kept for reference)

### May 8
- ✅ Database archive pipeline
- ✅ Country-aware caching for IPL/PSL watch providers
- ✅ Tennis archive fix (synthesized id)
- ✅ Spoiler-Free Mode toggle removed
- ✅ Darts night-summary view (main grid + Top Picks)
- ✅ Top Picks per-sport window (Recent / All for darts)
- ✅ World Matchplay parser (2025 test data, ready for July)
- ✅ Format-aware darts confidence scoring (uses firstTo per round)
- ✅ Session-grouping for multi-session days

### May 11
- ✅ Insights reveal feature (3-state cycle hidden → insights → score → hidden;
  spoiler-safe phrases; sport-aware thresholds; replaces old score-only reveal)
- ✅ WNBA support end-to-end (fetcher, scoring, archive, tabs, panels)
- ✅ Tab reorder: Football, Cricket, WNBA first
- ✅ Header redesigned smaller; new tagline
- ✅ "ALL GAMES" heading matches "TOP PICKS" style
- ✅ Compact Skip cards (37% shorter, muted text, no date subtitle)
- ✅ WNBA broadcast feature scoped (data source verified)
