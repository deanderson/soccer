# Post-Deploy Smoke Test

Run after any deploy that touches `index.html`, `get-scores.js`,
`archive-scores-job.js`, or `watch-providers.js`.

Target time: 60-90 seconds.

The point of this checklist is not to be exhaustive — it's to catch the
regression patterns we've actually seen, where a fix to one sport silently
breaks another.

---

## 1. Per-sport tab smoke (30 sec)

Click each sport tab in turn:

- [ ] Football
- [ ] Cricket
- [ ] Darts
- [ ] NBA
- [ ] WNBA
- [ ] NFL
- [ ] NCAA Football (new 2026-08-18 — expect empty/sparse until ~Aug 23-25,
      that's correct, not a bug, until FBS/FCS season actually starts)
- [ ] MLB
- [ ] NHL
- [ ] Tennis
- [ ] Softball
- [ ] CS2

For each tab, confirm:
- Top Picks bar renders (or shows the empty-state message)
- Main grid shows games or "no games" message
- No visible JS error or broken layout

- [ ] **World Cup tab is gone entirely** (removed 2026-08-18) — if it's
      still showing in the nav, that's a stale frontend deploy; the
      backend/frontend fell out of sync once already this way, push all
      three files together to fix.

## 2. Console health (10 sec)

Open browser console (F12 / Cmd+Opt+I). Look for red errors:
- [ ] No `FOOTBALL_TIER1 is not defined` errors
- [ ] No `Cannot read property 'X' of undefined`
- [ ] No 500s from `/.netlify/functions/get-scores`

## 3. Watch button rendering (15 sec)

On a tab with provider mappings (Darts always; Cricket if IPL or PSL games):

- [ ] Top Picks: watch button visible on Must Watch picks
- [ ] Top Picks: watch button visible on Watchable backfill picks
- [ ] Main grid: watch button visible on Must Watch cards only
- [ ] Main grid: NO watch button on Watchable/defensive/blowout cards
- [ ] Click one — opens correct provider in new tab
- [ ] NFL and NCAA Football correctly show NO watch button (intentional —
      replays aren't a site goal for either, no `watch-providers.js` entry)

## 4. Score reveal (10 sec)

Pick one game on any sport tab:
- [ ] Tap reveal button → score appears
- [ ] No JS error in console

## 5. Top Picks window switching (10 sec)

On any sport tab with games:
- [ ] Today / Recent / Week toggles work
- [ ] If Today is empty: "No standout games today, check Recent" message shows
- [ ] Recent shows at least 2 picks (when data permits)
- [ ] Week shows at least 3 picks (when data permits)

## 6. NFL-specific checks (new 2026-08-18, run once per season worth of testing)

- [ ] A close NFL game (margin ≤7) shows as "Watchable" or better, NOT
      "Blowout" — this was a real live bug (generic margin threshold of 3
      mislabeled close football games as blowouts). If a close game shows
      Blowout again, the sport-specific thresholds in the classification
      block regressed.
- [ ] Upcoming NFL games show a broadcast network line (📺 icon)
- [ ] Once real Sunday Night Football games exist (regular season only —
      won't trigger during preseason): confirm the "🚨 Caution: Cris
      Collinsworth" badge shows on NBC Sunday-evening games, and does NOT
      show on Sunday afternoon (CBS/FOX) or Monday Night Football games
- [ ] A finished NFL game with a big rushing/passing day shows the
      corresponding insight tag ("Big rushing game", "Huge game on the
      ground", etc.) outside the spoiler-gated reveal area is NOT expected
      here — these DO live inside "Why watch?", only the Collinsworth
      badge and broadcast info are exempt from the spoiler gate

## 7. NCAA Football-specific checks (new 2026-08-18, run once games exist)

- [ ] Category + Division (FBS/FCS/All) filter both work independently
- [ ] Ranked teams show `#N` prefix on team names, on both past and
      upcoming cards
- [ ] A game with both teams ranked shows a "ranked matchup" style insight
- [ ] No Division II/III games appear anywhere (intentionally excluded —
      if they show up, something changed upstream in ESPN's grouping)

## 8. Season-aware tab ordering (new 2026-08-18)

- [ ] Any sport currently showing 0 games (recent + upcoming both empty)
      should visually sink to the end of its section in the tab bar —
      check this whenever a sport is between seasons
- [ ] In-season sports should NOT be pushed behind out-of-season ones
      regardless of which "group" (identity/major) they're historically
      assigned to — this was a real live bug (NFL stuck behind
      zero-count Softball/Darts) before the sort was fixed to be
      season-status-first rather than group-first

## 9. Database health (after archive job hour, optional)

In Supabase SQL Editor:

```sql
SELECT
  COUNT(*) FILTER (WHERE updated_at > NOW() - INTERVAL '2 hours') AS recent_writes,
  COUNT(DISTINCT sport) FILTER (WHERE updated_at > NOW() - INTERVAL '2 hours') AS sports_active
FROM games;
```

- [ ] `recent_writes` ≥ 200 (varies seasonally)
- [ ] `sports_active` ≥ 6 (all in-season sports represented)
- [ ] If a new sport was added this deploy, confirm it appears in
      `sports_active` — a missing `archive-scores-job.js` `SPORT_KEYS`
      entry means the sport displays fine live but silently never reaches
      the archive table. Happened once with NCAAF, caught pre-deploy —
      check this explicitly for any future new sport too.

---

## When to skip this checklist

- CSS-only changes (color, padding, font)
- Copy/text changes that don't touch logic
- README/markdown changes

## When to extend this checklist

If a deploy touches an entirely new area (new sport fetcher, new database
table, new auth flow), this checklist is incomplete. Add coverage for the
new area before declaring done.
