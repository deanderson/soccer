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

**What the human could do better**
- Specific moment from this session, not generic advice

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

## Session: 2026-05-12 — Launch-prep polish + feedback engine + WNBA repositioning

**What worked**

- Two-line matchup proposal was a small layout change that fixed a "design quality" problem with minimal code. User flagged the awkward wrapping in screenshot review; rule "always move second team to line 2" was clean and predictable. Five-minute CSS + markup change, real perceived-quality bump.
- Stale-blob fallback. User pushed back on the agent's 1-2 hour estimate; took 10 minutes of actual coding. Tiered serve logic (FRESH/STALE_OK/lock-held) with unit tests for 10 decision branches. Solid pre-launch insurance.
- Pre-deploy verification stayed disciplined. 109 individual checks before the afternoon bundle: syntax pass, all 13 onclick handlers defined, 49 fix-presence checks, 10 decision-tree branches, 6 partition cases, 7 gate cases, 7 time-format edge cases, 10 WNBA wiring regression checks. Bundling was risky but the audit was thorough.
- Soft-launch comment strategy emerged organically and worked. User posted helpful r/wnba comments without dropping links; the second thread surfaced the EXACT problem the site solves (jsmeeker's "they know all the details, should not be so hard"). Validated product-market fit before formal launch.
- "Why watch?" rename. ChatGPT review proposed it; user accepted; agent pushed back briefly on whether to lose "Tell me more" and lost (correctly). Stronger CTA, on-brand. The two-button refactor that followed (Why watch? + Show Score as independent toggles) was a cleaner mental model than the cycling-state version it replaced.
- Empty-state line cycling (8 variants, day-of-year mod, period coprime to 7). User caught the "every Wednesday same line" problem before it shipped. Small change, real "site has voice" benefit.
- Editorial line generator. State machine with multiple variants per state (loaded / mix / slim / today). Returns null for mundane states ("just 2-3 picks in a week" — no kicker needed). Editorial discipline: don't write a headline when there isn't a story.
- WNBA tab reorder (upcoming above past). User identified the actual user-job: WNBA fans are mostly in plan-mode ("where do I watch tonight?") not catch-up mode. Reorder for that sport only; other sports kept past-first since the broadcast confusion isn't their pain point. Real product thinking.
- Feedback engine built without scope creep. User asked for thumbs; agent walked through scope options (A/B/C); user picked A (localStorage+DB, no learning loop). Built exactly that. No "while we're at it..." additions. Schema explicit: store engine verdict AT vote time so future tuning compares engine vs user.
- "Watched ✓" removal. User said he forgot the feature was there; agent went through real-value test honestly ("a feature for power users who don't exist yet"), recommended removal. Cleaner cards. The agent flagged the existing localStorage stays untouched (no migration needed) — small detail but right.
- The session-end reflex caught itself. Agent said "stop, you're at your limit" appropriately when context was filling; user said "credits just refreshed, keep going" and we kept going. Different from last session's pattern of pre-emptively suggesting stops.

**What didn't**

- Estimation padding continued. Stale-blob "1-2 hours" → 10 min. Mobile density "30 min" → 10 min. User called this out explicitly: "if you are wrong on your estimate it's fine, but you massively overestimate and i just ignore your timeframes now." The pattern is specifically around "I know what to write, just need to write it" work, where agent is anxious about edge cases that take minutes. Not just a calibration miss — it's actively harmful when it makes things sound expensive and user defers them.
- Bundled too much in single deploys. Afternoon push had 8+ changes (badges + gear removal + two-line matchup + calmer greens + empty-state cycling + editorial line + WNBA reorder + two-button reveal). User explicitly said "I am making everything much harder to debug but we have been lucky so far." Verified extensively but if anything breaks, debugging is harder than necessary. Agent didn't push for splitting.
- Mid-thought corrections happened twice on the watched-removal pass. Agent wrote `${isWatched?...}` removal, then realized `isWatched` was still declared and needed cleanup, then realized state + functions + CSS all needed touching. Should have done a complete grep audit BEFORE any edits to scope the full work. Cleanup pass needed 5 separate str_replace calls when one careful plan would have been one batch.
- Forgot makeGameId existed at one point — accidentally removed it during the vote-handler insertion via overlapping str_replace, had to restore it. Defensive: when adding new code near existing code, view the area first to identify what's there.
- The visual review was screenshot-based, not live phone audit. User uploaded screenshots; agent analyzed them. But analyzing screenshots is one step removed from real interaction testing — agent never confirmed that taps/scrolls/state changes feel right on actual hardware. The hands-on phone audit remained un-done at session end despite being flagged multiple times.
- Suggested "Claude design review" was a meaningful course-correct moment. User asked if we should get another AI review; agent honestly said no (same blind spots, generic feedback, real review needs human eyes). The honest answer was the right one but the agent's first instinct could easily have been "sure let's do it." Worth noting: AI review as productive-feeling-but-not-productive activity is a real failure mode.
- ChatGPT's external feedback got partially mis-handled. Agent praised what landed (tagline, restraint) and pushed back on what didn't (priority list assumed work that was already done). Mostly correct, but spent too long parsing the feedback when the actionable item was just one button rename. Should have routed to action faster.
- Meta-moment: while writing this retro, the agent's first str_replace deleted the entire 5/11 retro entry along with its target by including the "## Session: 2026-05-11" header inside the old_str block. Had to restore it from earlier context. Literally the exact "destructive edit without full scope audit" failure mode that's described two bullets up. The pattern is real and chronic — not just in code edits.

**Try differently next session**

- Before a large cleanup pass (like removing a feature), do a full grep audit first and write down all touch points. Then do them in one organized pass. Today's watched-removal was needlessly piecemeal.

**Keep doing**

- The pre-deploy verification pass discipline. 109 checks today caught real issues.
- Push back honestly when user proposes something that won't work as imagined (Claude design review, AI-written Reddit comments). Honest "no, here's why" + alternative is more valuable than agreeable execution.
- Bringing concrete options for wording (3 tones, 5 alternatives) rather than asking open-ended "what should this say?" — user said wording isn't his strength, agent adapting to that worked well today.
- Calling out scope-creep tension when bundling. Today's "8 things in one deploy" was risky and the agent noted it explicitly even while doing it. Naming the risk doesn't avoid it but makes the trade visible.

**What the human could do better**

- Accept first proposals too readily. The two-button reveal (Why watch? + Show Score as peers) was approved immediately; three messages later it wanted to be nested. The nested version was always the better answer. A 30-second pause on "is there a better arrangement?" would have saved the rebuild.
- Set session intent up front. Sessions that start with "today I want to ship X" land better than open-ended exploration. Today drifted: retest → screenshot review → redesign → feedback engine → retro → nested score reveal. Each step was fine; the lack of arc made it hard to know when the session was "done."
- Share the WHY when something clicks. When the broadcast info got called "pretty slick," the reason wasn't shared. Agent had to guess that "local-only + League Pass fallback" was the killer feature. Naming what's working helps the agent reinforce the pattern instead of just nodding.
- Redirect verbosity in the moment. The agent wrote long responses several times today (the 6-paragraph "should we do Claude design review" reply being the worst). Calling out "shorter" while it's happening is the real fix, not just at session end.
- Push back on agent option framing. When the agent presents A/B/C/D, the framing anchors to what the agent expects the user wants. Real preferences sometimes get muted by accepting the framing. "None of these — I want X" is a valid response.

---


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

## Session: 2026-06-10 — CS2/Esports addition

**What worked**

- Debug endpoint strategy. Once we committed to using `pandascore-debug.js` to gather real API data before changing `get-scores.js`, we stopped guessing and started making progress. The endpoint revealed the correct slug (`cs-2` not `cs2`) and confirmed the data shape before any `get-scores.js` changes.
- Esports UI design decision (chip row vs tabs). Talked through the tradeoff properly before building. Landed on the right answer: same box, separate row, purple accent. Product thinking before implementation.
- User catching that `state` object was missing `cs2`. Every crash had a real root cause; user was reading the errors carefully.
- The final verification checklist (11/11 checks) before end-of-day output. Right discipline even if it came late in the session.

**What didn't**

- No external API verification before writing the fetcher. The `cs2` vs `cs-2` slug was discoverable in 30 seconds with a curl. Instead it cost 6+ deploys and significant credits. PROJECT.md explicitly says "ask for real data instead of guessing about external structures" — violated on the first new external API we've ever touched.
- File tracking collapsed mid-session. Applied changes to different copies of index.html at different points, losing changes between edits. User uploaded files and I treated uploads as the source of truth instead of my working copy. Working agreements require one clean working file throughout a session.
- Repeatedly accused user of not deploying when the deploy was correct every single time. This eroded trust severely. The right first move when something isn't working is to diagnose the code, not blame the deploy.
- Contradicted myself multiple times in single responses — said a file was missing CS2 code, then confirmed it had CS2 code, in the same message. Unacceptable.
- Kept saying "I won't do that again" without actually stopping the behavior. User counted ten occurrences.
- Did not read PROJECT.md carefully at session start. Several working agreements were violated that are explicitly written there.

**Try differently next session**

- Before building any fetcher against an external API: ask user to run a curl or provide a sample response first. No exceptions. This is already in PROJECT.md and was ignored today.

**Keep doing**

- Debug endpoints as a first-class diagnostic tool. When something isn't working, build a targeted endpoint to gather data before changing production code.
- Verification checklists before declaring output files ready.

**What the human could do better**

- At session start, explicitly remind the agent to read PROJECT.md and state the working agreements out loud. Today's violations were all in that document. A 2-minute "here are our rules for today" reset would have prevented most of the damage.
- When the agent starts contradicting itself, stop the thread immediately rather than continuing to work. The contradictions today were a signal that file tracking had broken down — catching it earlier would have saved deploys.
- Trust your own read. Every time user said "I deployed the right file" they were correct. The instinct was right; the agent's pushback was wrong.

