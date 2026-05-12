# Deferred Work

> Things filed for later. Update as you complete or add items.

## Bugs (real, low-priority)

- **TIME DISPLAY IS UTC (pre-launch blocker).** Upcoming game times show
  as "11:00 PM UTC" etc. — actively hostile UX. A Pacific Time WNBA fan
  has to do math to figure out a game time. Single biggest UX issue
  before any audience push. Likely fix: ensure `toLocaleTimeString` is
  called WITHOUT a timezone arg so it uses user's local zone, OR display
  user-local time with small UTC tooltip. Audit all time displays
  (upcoming cards definitely, possibly others). ~15-30 min fix.

- **"Watch on WNBA League Pass" button shows on every WNBA Must Watch
  card, but League Pass doesn't have nationally televised games.** For
  a national-TV WNBA game, the button is misleading — the game isn't
  on League Pass, it's on NBC/ESPN/etc. Fix: check `g.broadcast` field
  (populated only for national games). If non-empty, suppress the
  League Pass button OR change its label to "Where to watch" pointing
  at the broadcast info.

- **Refresh button broken.** Cooldown logic measures blob age, not user
  action age. With 15-min cron and 5-min cooldown, the cooldown almost
  always fires. Even when 429 returns, frontend doesn't reload from blob.
  User sees no change. Fix: separate user-action cooldown from blob age.
  Always fetch on user click if last user click >60s ago. Workaround for
  now: hard-refresh page.

## Pre-launch redesign — make it feel less like a developer tool

Filed May 11. Discussed at length. The site looks like a database query
result, not a curated product. A first-time visitor doesn't get a "this
is for me" moment.

**The core problem in one sentence:** The site shows you database query
results when it should show you an editor's pick.

**Tier A — small changes, big impact (1 session):**

1. **Show top 2 Skip games of the day, collapse rest behind "+ N more
   skippable games."** Variant of the full-collapse idea the user prefers.
   Honest, gradient curation, never empty section.
   - Show all if ≤3 Skip games on a date
   - If ≥4, show top 2 (by confidence_score within Skip tier) + collapsed pill
   - Per-date collapse, in-memory state only
   - Centralize logic across 4 render sites (football, standard, cricket, tennis)
   - 45-60 min build

2. **Pre-expand insights on Top Picks cards.** Showcase the differentiator
   on first scroll instead of hiding it behind a click. Don't pre-expand
   on All Games — that's browse mode. The mockup screenshot shows just
   the matchup/verdict/buttons; insights should be visible by default.
   - Top Picks render only
   - User can still click to hide (cycle continues to work)
   - ~20 min build

3. **Reconsider/strengthen tagline.** Current "Find the games worth
   watching, without spoilers" describes; doesn't sell. Options:
   - "We watched the boring games so you don't have to."
   - "Curated. Spoiler-free. Daily."
   - "Hand-picked sports. No spoilers."
   - "Good games only."
   Pick one with editorial voice. Test feel after change.

4. ✅ DONE: "Trust the verdict" → "Nothing notable." (better empty-state copy)

**Tier B — meaningful, medium work (1-2 sessions):**

5. **Tighten Top Pick card vertical density on mobile.** Currently a
   "Best Pick" pick takes ~250px on mobile. Goal: both picks fit above
   the fold on a normal iPhone. Approach:
   - Move BEST PICK badge inline with matchup/league instead of own row
   - Tighter internal padding
   - Smaller Must Watch pill or merge with badge
   - Save ~50-70px per card
   - DO NOT compress sport tabs (horizontal scroll on mobile = bad UX,
     user explicitly vetoed this)

6. **Editorial copy line above Top Picks.** A single sentence per day.
   "Big WNBA Saturday — three Must Watch games on national TV." Updates
   from data with a template, OR once-per-day Haiku call. Adds the voice
   the site lacks.

7. **Empty-state voice.** When no Must Watch games today, lean in:
   "Nothing must-watch in WNBA today — save the night for something else."
   Editorial confidence, not "site is empty."

8. **Small visual identity / logomark.** Even an emoji-derived one (eye 👁
   tied to insight metaphor). Anchors the site as a product not a tool.

**Tier C — bigger swings (multiple sessions, post-launch likely):**

9. **Full home view restructure.** Top Picks IS the home view; All Games
   is intentional scroll-past. User explicitly said this is the right
   model. Currently mostly works structurally (Top Picks comes first);
   gap is mobile vertical density (Tier B item 5).

10. **Cross-sport "Highlights of the past N days" view.** Solves the
    empty-tab problem (slow days look broken) AND the "did I miss anything"
    path. New tab or new view.

11. **Mobile audit pass.** Reddit traffic is mostly mobile. Worth a
    dedicated session reviewing the site on a phone, fixing whatever's
    awkward. Today's work was mostly desktop screenshots.

12. **Onboarding for first-time visitors.** A small dismissable "How
    this works" element. Currently zero onboarding.

13. **Analytics.** Plausible/Fathom/Netlify analytics. Without baseline
    data, can't measure if launch worked.

## Features filed

### WNBA broadcasts v2 (follow-ups)
v1 shipped May 11 — see Closed section below. Open follow-ups:

- **Country-aware broadcasts.** Currently all users see US data only.
  UK fans should see Sky, Canada should see TSN/Sportsnet, etc. The
  ESPN geoBroadcasts response has `region` field (currently always
  'us' in our fetches) — investigate whether region-specific endpoints
  exist or if WNBA.com scraping is needed for international.
- **Time-of-day formatting.** Currently shows just "📺 NBC" — could
  be richer like "📺 Tonight on NBC, 1:30pm ET" for the current day,
  or "📺 Sat 1:30pm on NBC" for future days. Requires kickoff-time
  formatting that's aware of "today vs later this week."
- **Past-game broadcast info.** "It was on NBC" might add context
  even after the game is over. Not in v1 scope but small extension.
- **Watch-button deep links for upcoming games.** Currently broadcast
  info is read-only text. Could become a tappable link to peacocktv.com
  or wherever for actionable "go watch now." Each network needs its own
  deep-link mapping; not trivial.

### Replay watch-provider entries for NBA/NFL/MLB/NHL
WNBA League Pass added May 11. Other US majors deserve similar treatment
but each has thornier licensing:
- NBA League Pass: local-market blackouts on live, replays usually fine
- NFL Game Pass: international-only in US, NFL+ for domestic
- MLB.tv: team blackouts even on replays
- NHL.tv / ESPN+: depends on country

Each needs its own per-country mapping like cricket's IPL/PSL setup.
Filed for a focused "replay providers" session — not casual additions.

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

### Haiku "second opinion" experiment (nice-to-have, low priority)
Filed May 11. Concept: run the rule-based engine normally, then pass the
Skip-tier games to Claude Haiku with the question "did the algorithm
miss anything worth watching?" Useful for surfacing nuance the engine
doesn't capture (marquee/championship games, comeback stories, player
milestones, drama not in the factor list).

**Cost estimate:** ~$5-10/month at ~200 new games/day, with prompt caching.

**Shadow-mode-first plan (required before any user-facing change):**
1. Add `haiku_review` jsonb column to `games` table (verdict + reason + timestamp).
2. After archive write, for each Skip-tier game pass to Haiku.
3. Log Haiku's opinion in the column. Do NOT change the user-facing tier.
4. Run for one week minimum.
5. Sample 20 of Haiku's "this was actually worth watching" picks. Watch
   highlights or read recaps. Calibrate: real signal or noise?
6. Only if signal rate is meaningful (say >50% of flagged-skips are
   actually decent), promote to a user-facing "AI also recommends"
   section. Otherwise, kill the experiment.

**Disagreement rate target:** 2-5% of Skips flagged. >10% is noise.

**Reasons it's not a priority:**
- Not a killer feature for the r/wnba push. Broadcasts, voting, and
  visual identity matter more.
- Real-data threshold tuning (also filed) might solve the same problem
  (sports under-tiering) without needing an LLM in the loop.
- Adds inference latency to the archive job; needs careful design so
  it doesn't block the cron.

### Notable-events enrichment (post-launch feature, needs paid stats source)
Filed May 11. The real value here is records, milestones, "first since
1987" type discoveries — things users can't easily figure out themselves.
Streak counts and "first meeting this season" type facts are easy but
low-value: fans of a team usually already know that stuff.

**Key insight from scoping conversation:** The cheap versions of this
feature (Haiku enrichment, or deriving from our own archive) produce
mostly low-value signal (streaks, season-bests). The high-value signal
(broken records, career milestones, historical context) requires a real
sports-stats data source we don't have.

**The actual question:** is this worth $20-50/month for a stats API
(SportRadar, Sportradar, sports-reference.com paid tier, etc.)?
Answer at current user volume: no. Answer if r/wnba lands and the
site has real users: probably yes.

**Decision rule:** revisit AFTER any of:
- r/wnba post lands and engagement is real
- Site has >100 weekly users
- Multiple user requests for this kind of context

**UI shape (decided in scoping):**
- Small star/icon at top of card flagging "something notable here"
  (spoiler-safe; just a flag, no specifics)
- New insight tag inside the reveal area with the actual text
  ("⭐ Stewart broke the franchise single-game scoring record")
- Tag distinguishable from rule-based insights so users can see
  the source difference

**Paths (in order of fit):**

*Path A — Paid stats API (the real answer).* SportRadar, sports-reference
paid tier, or equivalent. Real career stats, real record databases, real
verifiability. Cost: $20-50/month. Real maintenance: API client per
source, caching layer. Multi-session build. The right answer when ROI
justifies the spend.

*Path B — Haiku enrichment with strict spoiler prompt.* Cheap (~$5-15/month)
but unreliable for the exact signal you want (records/milestones). Risks:
training-cutoff (misses recent records), hallucination (claims old records
that don't exist). NOT a good fit because the value proposition is
verifiability, which Haiku can't provide.

*Path C — Derive from our own archive.* Free but limited to season-level
facts (streaks, season-highs since we started archiving). Low value
because users can figure most of this out themselves.

**Recommendation:** Don't build any version until ROI justifies Path A.
The cheap versions (B and C) ship a feature that pretends to be the
valuable thing without being it — bad for the site's trust positioning.

**Strategic value when built right:** Strong differentiator for the
women's sports audience specifically. Women's basketball fans often
have to dig for individual narrative context because mainstream
coverage doesn't surface it. "This site told me Stewart broke a
40-year-old franchise record without spoiling whether they won" is
quotable and shareable.

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

**May 11 baseline observations (3 days of data — too early to tune,
but the pattern is filed for revisit):**

Healthy distributions (~14-19% Must Watch):
- Darts: 10 watchworthy / 31 blowout (~17%)
- NHL: 5 watchworthy / 13 blowout (~19%)
- Cricket: 7 watchworthy / 22 blowout (~14%)
- WNBA: 2 watchworthy / 11 blowout (~12%, only 16 games)

Concerning — too strict:
- **Football: 1 watchworthy from 130 games (<1%).** The `Very low scoring`
  penalty (−12) plus large-margin penalty is killing too many otherwise
  watchable games. Even 1-1 draws and 2-1 thrillers should clear the bar.
  The "1 goal margin" bonus (+16) isn't overcoming the low-total penalty.
  Hypothesis: low-scoring should not be a penalty in football — it's the
  norm. Should only deduct for *very* low (0-0, 1-0) OR remove the penalty
  and let lead changes / drama hints drive the score up instead.

- **MLB: 4 watchworthy / 104 blowouts from 178 games (2%).** Baseball's
  4-2 games can be tense but our scoring requires both high totals AND
  close margins. Hypothesis: similar to football — low totals shouldn't
  be penalized in MLB. Pitcher's duels are a real thing.

- **Tennis: 0 watchworthy from 135 games.** Most striking. Should not be
  possible — 5-set Grand Slam matches exist. Either the `5-set epic` /
  `Tiebreak + close sets` factors aren't firing, or the watchworthy
  threshold is set unreachably high for tennis. Investigate first as
  likely a scoring bug not a tuning issue.

- **NBA: 1 watchworthy / 20 blowout (3%).** Concerning but only ~30 games.
  Playoffs have produced many blowouts this year. Wait for more data
  before tuning.

**General pattern:** sports with high natural variance (darts, cricket,
NHL) look calibrated. Sports where low scores are normal (football, MLB)
are under-tiering because of low-scoring penalties. Tennis is anomalous.

**Specifically for WNBA:** thresholds were scaled from NBA's. With only 16
games, can't tune yet. Sister concern to NBA's strict distribution.

**When to revisit:** ~1 week of clean data minimum (May 18+). Tennis
investigation can happen sooner since "0 watchworthy" suggests a bug
not a calibration issue.

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
- ✅ "× hide" affordance inside insights — dismiss without revealing score
- ✅ Spoiler-precision audit on insight phrases — removed margin-revealing
  phrases ("Decided by a possession", "Decided by a field goal", etc.)
  in favor of texture-based phrases ("Down to the wire", "Close finish")
- ✅ Tab grouping by site positioning — Football/Cricket/WNBA/Darts
  (identity sports) · NBA/NFL/MLB/NHL/Tennis (major sports), with a
  subtle dot divider. Group flags on each sport definition.
- ✅ WNBA broadcasts v1 — National TV / National streaming / Local-only
  League Pass fallback. Backend extracts geoBroadcasts only for sports
  in BROADCAST_SPORTS set (avoid payload bloat). Shows on upcoming game
  cards only.
- ✅ WNBA League Pass replay link added to watch-providers.js so Must
  Watch WNBA cards show "🎬 Watch on WNBA League Pass" (consistent with
  Darts/IPL/PSL Must Watch cards).
- ✅ Real bug fixed: `fetchWNBAWithTimeline`, `fetchNBAWithTimeline`, and
  `fetchNHLWithTimeline` only fetched past 14 days, never future. Three
  sports had never shown upcoming games. Added parallel fetch for
  `dates=${espnDate(1)}-${espnDate(4)}`.
