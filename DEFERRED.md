---

## Status as of 2026-08-18 — Rugby tabled pending club-competition data gap

**Rugby — tabled, resume here next time:**

League IDs found (via ESPN's rugby schedule dropdown, `espn.com/rugby` → Fixtures & Results):
- Gallagher Premiership: `267979`
- French Top 14: `270559`
- United Rugby Championship: `270557`
- The Rugby Championship (international): `244293`

**Key finding — real blocker, not a guess:** ESPN's rich per-match stats (tries,
conversionGoals, penaltyGoals, dropGoalsConverted, yellowCards, redCards,
tryBonusPoints, etc.) are populated for Tier 1 international rugby (Rugby
Championship, presumably Six Nations) but come back completely empty
(`statistics: []`) for the club competitions — verified across both
`scoreboard` and `summary?event=` endpoints, 20 team-appearances checked
across URC and Top 14, two different dates each, zero stats in every case.
This is backwards from what we want: the club competitions (Premiership/Top
14/URC) are the ones with real weekly volume ("lots of games to pick from"
— the actual target use case), but they're the ones missing the deep stats.
Premiership specifically wasn't tested yet, but given how consistent the
pattern was across the other two, don't expect it to differ.

What IS reliably present everywhere, including club comps: final score,
margin, team names, date/status. Same data shape as darts/tennis today.

**Decision when we resume:** build margin/closeness-based scoring only for
club rugby (no tries/cards insights) — same shape as darts/tennis, not the
richer NFL/NCAAF model. Rugby Championship alone could still get the richer
treatment if ever added separately, but it's too thin on volume (4-team
round robin, ~12 matches/season) to be worth a standalone tab.

Real calibration data gathered so far (thin samples, more needed before
finalizing thresholds):
- Rugby Championship, 12 matches: margins 2-37 (median ~8), totals mostly
  41-65 with one 97-point outlier, tries 1-9/team, yellow cards in >50% of
  matches, zero reds in sample.
- Club comps: score/margin only confirmed available, no try/card data to
  sample.

**Sports landscape review (same session):** Golf ruled out (hard to pick a
single match to watch). F1 ruled out (too low volume, ~1 race/2 weeks).
MMA ruled out (matches too short for the "worth the investment" premise).
Rugby tabled per above, not ruled out — real potential once club-comp
scoring is scoped down to margin-only.

---

## Status as of 2026-07-13 — Instagram autopost setup in progress

**Instagram setup (mid-session, continue next chat):**
- Instagram Professional account created: `spoilerfreescores` (Sports/Creator)
- Facebook Page created: "Spoilerfreescores" (Sports category)
- Next step: Link Instagram account to Facebook Page
  - On Facebook Page → left sidebar → Linked accounts → connect spoilerfreescores Instagram
- Then: Create Facebook Developer app at developers.facebook.com
  - Add Instagram Graph API product
  - Get short-lived access token
  - Test with curl before writing any code
- Then: Build image generator (Netlify function, Canvas, 1080x1080 PNG)
- Then: Build posting function (daily cron, top 3 Must Watch games, carousel)

**Instagram post design spec (agreed):**
- Top 3 Must Watch games of the day across all sports
- Instagram carousel (one slide per game, 1080x1080)
- NO scores shown (core brand principle)
- Each slide: sport + league, team matchup, insight tags, Must Watch rating, "spoilerfreescores.com"
- Daily automated post

**Pending deploy (ready in outputs):**
- index.html — "Went the full 3 maps/5 maps" suppressed from insights

**CS2 state:**
- 102 matches loaded (full IEM Cologne Major, 14-day window)
- 12 matches enriched with Reddit data (last 3 days)
- enrich-reddit: 3-day filter, 20s time budget, runAgain flag
- YouTube search button on all CS2 cards

**Scoring changes shipped this session:**
- "Close game after big lead" / "Close game after huge lead" (replaces comeback/rally)
- Historic records: NHL triple OT, NBA 270+ pts, MLB 13+ innings
- ESPN headline enrichment (enrichHeadlines function, games ≥70)
- Penalty shootout suppressed from insights
- "Went the full 3 maps" suppressed (pending deploy)
