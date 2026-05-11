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
