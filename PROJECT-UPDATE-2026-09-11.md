# PROJECT.md update — session 2026-09-11

NCAAF cross-division duplicates + silent archive failure.

---

## Shipped this session

### 1. FBS/FCS cross-division dedup (`get-scores.js`, `fetchNCAAF`)

**Problem.** ESPN's `groups` filter matches *either* team, so `groups=80` returns
every game with an FBS team and `groups=81` every game with an FCS team. Every
FBS-vs-FCS game came back from both feeds. Verified by curl: on 9/5/26, 38 of 68
FBS events were also in the FCS feed.

**Symptoms.**
- Both College Football Top Picks slots held the same game (Charlotte vs The
  Citadel, one card FBS, one FCS).
- All Sports spent 2 of 8 slots on the same game.
- Tab count inflated: 182 shown vs 133 real.
- Duplicated games burned two of the 25 enrichment slots each — worst for close
  games, since enrichment is closest-first.

**Fix.** Dedup by ESPN event id immediately after the two division fetches,
before enrichment and confidence scoring. FBS owns cross-division games: the
watchworthy case is an FCS upset, users look for it under the FBS team, and it
gets scored by one calibration instead of two.

Rejected `conferenceId` classification — needs a maintained FBS conference list
and misreports transitional programs (NDSU and Sacramento State already carry
FBS conference IDs in this feed).

**Verified.** Real `normalizeEvents` / `fetchNCAAFDivision` / `fetchNCAAF`
extracted into a Node harness against live ESPN:

| | before | after |
|---|---|---|
| recent games | 182 | 133 |
| duplicate ids (recent + upcoming) | 82 | 0 |
| Charlotte vs Citadel | 2 cards (FBS + FCS) | 1 card (FBS) |

Confirmed live post-deploy: 133 games (92 FBS / 41 FCS), no duplicate ids, both
College Football Top Picks now distinct games.

### 2. Archive row dedup (`archive-scores-job.js`, `blobToRows`)

**Problem.** A batch containing the same `id` twice is rejected whole by Postgres
(`ON CONFLICT DO UPDATE command cannot affect row a second time`) — all 100 rows
lost, including unrelated sports sharing the batch. The NCAAF duplicates tripped
this on every hourly run.

Simulated against the live blob: batches 3 and 4 failed, dropping **all 92 FBS,
all 90 FCS, all 10 NFL**, plus 7 MLB and 1 cricket. The 97 NCAAF rows that did
exist came from runs where batch boundaries happened to fall cleanly.

**Blast radius beyond NCAAF.** NFL had archived nothing since 9/7 — neither
regular-season game (9/9 NE@SEA, 9/10 SF@LAR) was in Supabase, and the Sunday
slate would have been lost the same way.

**Fix.** Dedup rows by `id` before batching, first-occurrence-wins (which gives
FBS ownership even independently of the `get-scores.js` fix), with a
`console.warn` when duplicates are dropped so a future duplicate source is
visible instead of silent.

Both patches independently reduce row loss to zero; shipped together so source
and defense are both in place.

---

## Known gaps / follow-ups

- **NCAAF week 1 (8/27–9/1) is permanently missing from the archive.** The blob
  window is `now - 9d`, so those games aged out before any successful write.
  Decide: backfill from ESPN, or accept the gap. Matters because the deferred
  ranking-bonus calibration is waiting on this season's data.
- **The archive job returns HTTP 200 even when batches fail** (`ok:false` in the
  body, detail only in function logs). That's why this went unnoticed ~2 weeks.
  Suggested: return 500 on failure, and/or surface last archive result in
  `dev-dashboard`.
- **Dead code in `get-scores.js` lines ~296–404.** `fetchNCAAF` is declared twice
  in the handler; the later declaration wins, so the first one plus
  `NCAA_API_BASE`, `ncaaFootballWeek`, `fetchNCAADivisionESPN` and
  `fetchNCAADivisionProxy` never execute. Confirmed live (no D2/D3 on the site).
  Trap for future edits — editing the dead copy changes nothing. Delete in a
  follow-up.

---

## Decisions recorded

### Ranking bonus: no change yet

Question raised: no ranked teams in College Football Must Watch — raise the
bonus? Checked against the live window instead of adjusting:

- One ranked game *is* Must Watch (#9 Ole Miss vs #24 Louisville, score 75) —
  the only ranked-vs-ranked matchup in the window. The +15 both-ranked bonus is
  working.
- Of 25 games with a ranked team: 18 blowouts, 3 defensive, 3 watchable, 1 must
  watch. Early-season ranked teams are playing FCS/G5 opponents.
- Only near-miss is SMU @ Florida State (42 vs the 45 must-watch threshold).
  Tuning on a single game is exactly what "curl before code" exists to prevent.

Revisit once conference play starts (late Sept/Oct) and the archive has several
clean weeks, then test whether *close* ranked games land lower than they should.

Alternative that doesn't touch scoring: a **Ranked** filter chip alongside
FBS/FCS. Ranks already render on cards; frontend-only change.

### Current thresholds (unchanged)

NCAAF must-watch 45, watchable 20. Margin buckets: ≤3 → +30, ≤7 → +18, ≤14 → +8,
≥28 → −35. Total ≥65 → +18, ≤30 → −8. College OT → +30. Both ranked → +15, one
ranked → +6.

---

## Verification pattern worth reusing

Extracting the real functions into a Node harness and running old vs patched
against live data (rather than checking that the code "looks right") is what
produced the 182 → 133 and the per-batch loss table. Same pattern caught the
archive failure: simulating `blobToRows` + batching showed exactly which sports
each failed batch took down.

Note for the harness only: ESPN 403s a bare `Mozilla/5.0` UA from the sandbox;
a curl UA works. Production is unaffected.
