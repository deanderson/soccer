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
- [ ] NFL
- [ ] MLB
- [ ] NHL
- [ ] Tennis

For each tab, confirm:
- Top Picks bar renders (or shows the empty-state message)
- Main grid shows games or "no games" message
- No visible JS error or broken layout

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

## 6. Database health (after archive job hour, optional)

In Supabase SQL Editor:

```sql
SELECT
  COUNT(*) FILTER (WHERE updated_at > NOW() - INTERVAL '2 hours') AS recent_writes,
  COUNT(DISTINCT sport) FILTER (WHERE updated_at > NOW() - INTERVAL '2 hours') AS sports_active
FROM games;
```

- [ ] `recent_writes` ≥ 200 (varies seasonally)
- [ ] `sports_active` ≥ 6 (all in-season sports represented)

---

## When to skip this checklist

- CSS-only changes (color, padding, font)
- Copy/text changes that don't touch logic
- README/markdown changes

## When to extend this checklist

If a deploy touches an entirely new area (new sport fetcher, new database
table, new auth flow), this checklist is incomplete. Add coverage for the
new area before declaring done.
