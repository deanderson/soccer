# Session Retros

> End each meaningful session with 5-10 minutes reflecting on the
> collaboration itself, not just the work. Capture specific moments,
> not vague impressions. Honest critique on both sides — if everything
> reads positive, it's performative.

---

## Template (copy for each session)

### Session: [date] — [topic]

**What worked**
- Specific moment 1
- Specific moment 2

**What didn't**
- Specific moment 1 (with what should have happened instead)
- Specific moment 2

**Try differently next session**
- One thing only

**Keep doing**
- One thing only

---

## Session: 2026-05-08 — Darts night-summary view + Matchplay parser + scoring rebalance

**What worked**

- Catching the bracket-progression spoiler problem ("I see Littler 3x and I know he won the night"). That insight reframed the entire darts feature from match-level to session-level. Sharper product thinking than what was being proposed.
- The aged-out blob hypothesis. Diagnosed the database mystery faster than I did. Filed under "human's read sometimes better than agent's."
- The "no Must Watch sessions in the whole tournament?" sniff test. Caught a real bug (format-blind scoring engine) that would have shipped looking healthy because the UI rendered correctly with bad data.
- Time-estimate pushback that was data-grounded ("aren't you almost done with the str_replace already?"). Right essentially every time.
- The educational reframing partway through ("Remember the number one goal is my education"). Reset the conversation from product-strategy mode to learning mode.
- Bringing problems instead of solutions on the WNBA-first reframe and the "show top sessions during tournaments" insight. Both produced better designs than the agent's first proposals would have.

**What didn't**

- Accepted the "date filter won't impact us" answer too quickly when adding the Matchplay test config. Should have demanded the trace; instead got bitten when Matchplay returned zero matches because of the per-game cutoff filter that I missed despite the explicit pre-flight question.
- Today's deploy count (~7-8 deploys) was higher than ideal. Pivot from esports → darts mid-session made the morning deploy redundant in retrospect, but spur-of-the-moment pivots are hard to plan for.

**Try differently next session**

- Spend 30 seconds at session start writing what I want to accomplish, even if it changes mid-session. Captures intent without forcing rigidity.

**Keep doing**

- Bring problems, not solutions. The site got better today specifically when this happened.
- Push back on time estimates. They're consistently 2-3x reality.
- Treat agent feedback as data, not truth. Take what lands, push back on what doesn't, give reasoning for both.

---

## Session: 2026-05-11 — Insights reveal + WNBA support + UI polish + broadcasts v1

**What worked**

- Session-start intent capture ("new feature reveal insights, add WNBA, that's enough"). Defined scope upfront. Both shipped, scope stayed close to what was set initially. Real scope expansion happened LATER when user explicitly opened the door (broadcasts, tab grouping) — different from creep.
- Pre-deploy verification passes throughout the session. Caught at least three real bugs that would have required follow-up pushes: insight helper was sport-blind (WNBA cases produced empty phrases), mobile Skip card padding was inconsistent, fetchWNBAWithTimeline never fetched upcoming games (turned out to also affect NBA + NHL — three sports silently missing upcoming for a long time).
- The data-verification pause for broadcasts. Could have started building immediately. Instead asked for real ESPN responses for two different dates. Confirmed national vs local broadcast distinction, locked in "no scraping needed." When the time came to build, scope was clear and implementation took maybe an hour total.
- "Hold on, that's a spoiler" catch on the insight phrases. User noticed "Decided by a possession" implies a 1-2pt margin which is itself a spoiler. The principle ("describe texture, not precision") generalized to fixing 6 other phrases in the same pass. Sharp QA brain catching the kind of thing the implementer was too close to see.
- Pushback on time estimates continues to work. User said "5 minutes not 30" on quick CSS wins; agent withdrew padding immediately. Three CSS changes in 5-10 minutes.
- Tab order conversation. User pushed back on "in-season first" as principled middle ground (rightly — most sports are in season most of the year). Better positioning landed: Football, Cricket, WNBA first.
- Building the tab-mockup HTML for user to evaluate locally instead of trying to describe Options A/B/C/D in words. User immediately picked B, explained why, and the implementation took 15 minutes from there.
- Discipline on watch-provider scope. Almost added NBA League Pass alongside WNBA's. Caught the mission creep, reverted, filed NBA/NFL/MLB/NHL for a focused replay-providers session. The user even acknowledged: "good call to only do wnba."
- DB analysis at the end. With 3 days of data we already see a real pattern: low-scoring sports (football, MLB) under-tier severely, tennis has zero watchworthy (likely a bug), and the high-variance sports (darts, cricket, NHL) look calibrated. The user named the right call: "we are too strict in some but we can wait for more data." Filed observations without rushing to tune.

**What didn't**

- Repeatedly suggested stopping the session despite user explicit signal that he was enjoying the work and would stop when his wife was free. Paternalistic energy management; user called it out directly. After feedback, behavior corrected — but it took being called out.
- Pre-emptively defended scope by inflating time estimates (especially around "look-and-feel review" which the user reasonably called out as 5-min work not 30-min). The estimation-padding habit shows up specifically around design work where I'm less confident.
- The morning insights deploy attempt — wrote code, user "pushed" but had wrong folder open. User course-corrected. Could have been caught with a "verify the deploy went out" step earlier in the diagnosis.
- The `fetchWNBAWithTimeline` upcoming-fetch bug. Original WNBA fetcher code I wrote was modeled on `fetchNBAWithTimeline`, which had the same bug. Copy-pasted the bug. The bug was only discoverable through the broadcast feature requiring upcoming games. Would have shipped indefinitely otherwise. Lesson: when modeling on existing code, audit the original first instead of trusting it.

**Try differently next session**

- Audit other fetchers (cricket/tennis/darts) for the same upcoming-fetch pattern. The fact that three sports had this bug for who-knows-how-long is a process smell — pre-deploy checks should include "do upcoming games actually appear in test data?"

**Keep doing**

- Pre-deploy verification passes when the user wants to minimize deploys. Today's caught at least 3 real bugs across the session.
- Ask for real data (paste me the JSON, paste me the wikitext) before building against external structures. Saved time on broadcasts.
- Mockup HTML for design decisions rather than describing options in words. User can react to pixels faster than to descriptions.
- Trust user's session-length signals. Don't suggest stopping.

---

