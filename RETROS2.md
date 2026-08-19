
---

## Session: 2026-08-18 — NFL scoring fix, World Cup removal, NCAA Football build, rugby research

**What we did**

- Fixed a real live NFL scoring bug: no sport-specific mustWatch/watchable
  thresholds (was silently using generic 60/38 defaults NFL's own scoring
  block can barely reach), and a universal margin-≥3 "blowout" bar that
  mislabeled a 3-point NFL loss as a blowout — caught via a live
  screenshot, fixed with real thresholds calibrated against actual Nov
  2025 game data
- Added NFL broadcast network display on upcoming games (reused WNBA's
  existing pattern) and a Cris Collinsworth Sunday Night Football warning
  badge, placed outside the spoiler-gated area since announcer ID isn't a
  score spoiler
- Added NFL rushing/passing/individual-standout/sacks insight tags, all
  thresholds calibrated against real sampled game data, not guessed
- Built and then explicitly removed a "missed field goal" insight —
  correctly identified as too spoilery, fully stripped rather than left
  half-wired
- Fully removed World Cup — tab, panel, CSS, scoring branch, backend
  fetcher, archive job key — rather than leaving dead references
- Built season-aware tab ordering (out-of-season sports sink to the end)
  — first attempt had a real bug (sorted within group instead of
  globally, so in-season NFL still landed behind zero-count Softball/
  Darts), caught via live screenshot, fixed to season-status-first
- Built NCAA Football (FBS+FCS) from scratch: researched real division
  data availability (found D2/D3 unreliable, scoped them out), found the
  right ESPN group IDs, calibrated scoring against a real 45-game
  Saturday, added rank display on cards, wired rushing/passing/leaders
  enrichment, fixed an enrichment-cap sizing/prioritization issue before
  shipping (not after)
- Extensive sports-landscape research: current/next darts tournaments,
  reviewed Golf/F1/MMA/Rugby as candidate additions against the site's
  actual fit criterion
- Researched rugby as a candidate sport: found league IDs (Premiership,
  Top 14, URC, Rugby Championship), discovered a real data-availability
  gap (club competitions have zero ESPN stats coverage vs. rich
  international-rugby coverage), tabled with findings preserved in
  DEFERRED.md rather than losing the research

**What worked**

- Curl-before-code discipline held up across NFL calibration, NCAAF
  feasibility research, and rugby stats discovery — every threshold in
  tonight's scoring code is checked against real pulled data, not guessed
- Caught the archive-job missing-SPORT_KEYS-entry issue in pre-deploy
  review, not after — would've been a silent, hard-to-notice data loss
- Verified logic locally before shipping in multiple places (Collinsworth
  detection tested against 4 real broadcast scenarios, boxscore parsing
  tested against real Colts/Falcons data) rather than trusting untested
  code
- When a fabricated, unstated filter crept into a recommendation ("big in
  the US" for the sports-landscape review), it got called out and
  corrected immediately and cleanly rather than defended
- Rugby research got tabled cleanly with real findings preserved, instead
  of either abandoning the thread or forcing a half-verified build

**What didn't**

- Two real live bugs shipped before being caught by the user's own
  screenshots rather than caught pre-deploy: the NFL blowout
  mislabeling, and the season-tab-sort ordering bug. Both were fixable
  fast once seen, but both were classification-logic mistakes that a
  closer self-review before declaring "done" might have caught.
- A split deploy (backend changes pushed without the matching frontend
  changes) left the World Cup tab visibly showing on the live site with
  stale data for a period — should have been flagged as a blast-radius
  risk before that specific push, not after.
- File uploads broke repeatedly and unpredictably through a large chunk
  of the session — not something either of us could fix, but it cost
  real time and forced several rounds of "try again" before landing on
  paste-as-text as the reliable workaround.
- This sandbox got rate-limited by ESPN's own Akamai WAF partway through,
  from cumulative curl volume across the session — blocked live
  end-to-end verification of the NCAAF pipeline before deploy. Worked
  around it by verifying everything possible earlier in the session
  before the block hit, and being upfront about the one thing that
  couldn't be confirmed until the user checked production directly.

**Session ended cleanly** — all planned deploys shipped and confirmed live
via user screenshots, rugby explicitly tabled (not abandoned) with
research preserved in DEFERRED.md for a clean pickup next time.
