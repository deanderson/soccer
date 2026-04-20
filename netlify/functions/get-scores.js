// ESPN Unofficial API — no API key required (all sports except cricket)
// Cricket: CricketData.org API (api.cricapi.com) — requires CRICKET_API_KEY env var

exports.handler = async function (event, context) {

  const MIN = 8;

  function espnDate(daysOffset) {
    const d = new Date(Date.now() + daysOffset * 86400000);
    return d.toISOString().slice(0, 10).replace(/-/g, "");
  }

  async function fetchESPN(url) {
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": "Mozilla/5.0" },
        signal: AbortSignal.timeout(4000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      console.error("ESPN fetch error:", url, err.message);
      return { events: [] };
    }
  }

  const FINAL_STATUSES = new Set([
    "STATUS_FINAL", "STATUS_FULL_TIME", "STATUS_FT",
    "STATUS_ENDED", "STATUS_COMPLETED",
  ]);
  const UPCOMING_STATUSES = new Set([
    "STATUS_SCHEDULED", "STATUS_PREGAME",
  ]);

  function normalizeEvents(data, leagueName) {
    return (data.events || []).map(ev => {
      const comp   = ev.competitions?.[0];
      const home   = comp?.competitors?.find(c => c.homeAway === "home");
      const away   = comp?.competitors?.find(c => c.homeAway === "away");
      const status = ev.status?.type?.name ?? "";
      const date   = new Date(ev.date);
      // Use UTC date as the grouping key so all leagues bucket consistently
      const utcDate = `${date.getUTCFullYear()}-${String(date.getUTCMonth()+1).padStart(2,'0')}-${String(date.getUTCDate()).padStart(2,'0')}`;
      return {
        id:     ev.id ?? null,
        home:   home?.team?.displayName ?? "TBD",
        away:   away?.team?.displayName ?? "TBD",
        h:      parseInt(home?.score ?? "0", 10),
        a:      parseInt(away?.score ?? "0", 10),
        date:   date.toLocaleDateString("en-US", { weekday:"short", month:"short", day:"numeric" }),
        dateKey: utcDate,
        time:   date.toLocaleTimeString("en-US", { hour:"numeric", minute:"2-digit", timeZoneName:"short" }),
        league: leagueName,
        status: FINAL_STATUSES.has(status)    ? "final"
              : UPCOMING_STATUSES.has(status) ? "upcoming"
              : "other",
        ts: date.getTime(),
      };
    });
  }

  const BASE = "https://site.api.espn.com/apis/site/v2/sports";
  const now  = Date.now();
  const twoWeeksAgo = now - 14 * 86400000;

  async function fetchSport(scoreboardUrl, leagueName, upcomingCap = 50) {
    const data = await fetchESPN(
      `${scoreboardUrl}?dates=${espnDate(-14)}-${espnDate(7)}&limit=500`
    );
    const events = normalizeEvents(data, leagueName);

    const recent14 = events
      .filter(g => g.status === "final" && g.ts >= twoWeeksAgo)
      .sort((a, b) => a.ts - b.ts);

    const upcoming = events
      .filter(g => g.status === "upcoming" && g.ts >= now)
      .sort((a, b) => a.ts - b.ts)
      .slice(0, upcomingCap);

    if (recent14.length < MIN) {
      const fallback = await fetchESPN(
        `${scoreboardUrl}?dates=${espnDate(-180)}-${espnDate(0)}&limit=500`
      );
      const fallbackRecent = normalizeEvents(fallback, leagueName)
        .filter(g => g.status === "final")
        .sort((a, b) => a.ts - b.ts)
        .slice(-MIN);
      // Merge: use fallback only for the older portion, keep any real 14-day games too
      const merged = [...fallbackRecent, ...recent14];
      const seen = new Set();
      const deduped = merged.filter(g => {
        const key = `${g.home}|${g.away}|${g.ts}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      }).sort((a, b) => a.ts - b.ts);
      return { recent: deduped, upcoming };
    }

    return { recent: recent14, upcoming };
  }

  // ── SOCCER LEAGUES ────────────────────────────────────────────────────
  const SOCCER_LEAGUES = [
    { slug: "eng.1",          name: "Premier League"   },
    { slug: "esp.1",          name: "La Liga"          },
    { slug: "ger.1",          name: "Bundesliga"       },
    { slug: "ita.1",          name: "Serie A"          },
    { slug: "fra.1",          name: "Ligue 1"          },
    { slug: "uefa.champions", name: "Champions League" },
    { slug: "uefa.europa",    name: "Europa League"    },
    { slug: "usa.1",          name: "MLS"              },
  ];

  // ESPN soccer scoreboard only accepts a single date (not a range).
  // We fetch each of the past 10 days + next 5 days per league in parallel.
  async function fetchSoccerLeague(slug, leagueName) {
    // Build array of day offsets: -10 to +4 (15 days total, down from 22)
    const offsets = Array.from({ length: 15 }, (_, i) => i - 10);

    const dayResults = await Promise.all(
      offsets.map(offset =>
        fetchESPN(
          `${BASE}/soccer/${slug}/scoreboard?dates=${espnDate(offset)}&limit=100`
        )
      )
    );

    // Flatten all events, deduplicate by event id
    const seen = new Set();
    const allEvents = [];
    for (const data of dayResults) {
      for (const ev of normalizeEvents(data, leagueName)) {
        // Use home+away+ts as dedup key since normalizeEvents doesn't carry id
        const key = `${ev.home}|${ev.away}|${ev.ts}`;
        if (!seen.has(key)) {
          seen.add(key);
          allEvents.push(ev);
        }
      }
    }

    const recent = allEvents
      .filter(g => g.status === "final" && g.ts >= twoWeeksAgo)
      .sort((a, b) => b.ts - a.ts); // newest first

    const upcoming = allEvents
      .filter(g => g.status === "upcoming" && g.ts >= now)
      .sort((a, b) => a.ts - b.ts)
      .slice(0, 10);

    // Fallback: if no recent games (e.g. off-season), grab last few finished ones
    if (recent.length === 0) {
      const fallbackOffsets = Array.from({ length: 8 }, (_, i) => -(i + 15)); // days -15 to -22
      const fallbackResults = await Promise.all(
        fallbackOffsets.map(offset =>
          fetchESPN(
            `${BASE}/soccer/${slug}/scoreboard?dates=${espnDate(offset)}&limit=100`
          )
        )
      );
      const fallbackEvents = [];
      for (const data of fallbackResults) {
        for (const ev of normalizeEvents(data, leagueName)) {
          const key = `${ev.home}|${ev.away}|${ev.ts}`;
          if (!seen.has(key)) {
            seen.add(key);
            fallbackEvents.push(ev);
          }
        }
      }
      const fallbackRecent = fallbackEvents
        .filter(g => g.status === "final")
        .sort((a, b) => b.ts - a.ts)
        .slice(0, MIN);
      return { recent: fallbackRecent, upcoming };
    }

    return { recent, upcoming };
  }

  // ── SOCCER TIMELINE ENRICHMENT ────────────────────────────────────────
  // Parse a goal clock string like "90'+3'" into a numeric minute
  function parseMinute(clockStr) {
    if (!clockStr) return null;
    const m = clockStr.match(/^(\d+)(?:'?\+(\d+))?/);
    if (!m) return null;
    return parseInt(m[1], 10) + (m[2] ? parseInt(m[2], 10) : 0);
  }

  // Given keyEvents from the summary endpoint, derive timeline-based category override
  // Returns a category string like "watchworthy", "scorefest", etc. or null to keep existing
  function categorizeSoccerByTimeline(keyEvents, h, a) {
    const goals = keyEvents.filter(e =>
      e.type?.type === "goal" ||
      (typeof e.type?.text === "string" && e.type.text.toLowerCase().includes("goal"))
    );

    if (goals.length === 0) return null;

    // Parse each goal into { minute, homeScore, awayScore, team }
    const timeline = [];
    for (const g of goals) {
      const minute = parseMinute(g.clock?.displayValue);
      if (minute === null) continue;
      // Extract score from text e.g. "Aston Villa 3, Sunderland 3"
      const scoreMatch = g.text?.match(/(\d+),\s*\w[\w\s]* (\d+)/);
      if (!scoreMatch) continue;
      timeline.push({
        minute,
        team: g.team?.displayName,
        // We can't reliably know which score is home vs away from text alone
        // but we have the final h/a and can track direction
      });
    }

    // Simpler approach: reconstruct score progression from keyEvent texts
    const scoreProgression = [];
    for (const g of goals) {
      const minute = parseMinute(g.clock?.displayValue);
      if (minute === null) continue;
      // Text format: "Goal! Team A N, Team B M. ..."
      const m = g.text?.match(/Goal!\s+.+?\s+(\d+),\s+.+?\s+(\d+)\./);
      if (!m) continue;
      scoreProgression.push({
        minute,
        s1: parseInt(m[1], 10), // score for team named first in event title (home)
        s2: parseInt(m[2], 10),
        team: g.team?.displayName,
      });
    }

    if (scoreProgression.length === 0) return null;

    const lastGoalMinute = Math.max(...scoreProgression.map(g => g.minute));
    const finalH = h, finalA = a;
    const diff = Math.abs(finalH - finalA);
    const total = finalH + finalA;

    // Late drama: decisive goal (changed the result) after 80'
    const lateGoals = scoreProgression.filter(g => g.minute >= 80);
    let hasLateDrama = false;
    if (lateGoals.length > 0) {
      // Check if any late goal was the winner or equaliser
      const lastScore = scoreProgression[scoreProgression.length - 1];
      const lastLate  = lateGoals[lateGoals.length - 1];
      if (lastLate === lastScore) hasLateDrama = true; // final goal was late
    }

    // Comeback: team was losing by 2+ and came back to draw or win
    let maxDeficit = 0;
    let hadComeback = false;
    for (let i = 0; i < scoreProgression.length; i++) {
      const { s1, s2 } = scoreProgression[i];
      const deficit = Math.abs(s1 - s2);
      if (deficit > maxDeficit) maxDeficit = deficit;
    }
    // If at any point someone was 2 down and the final diff is ≤ 1, it's a comeback
    if (maxDeficit >= 2 && diff <= 1) hadComeback = true;

    // Lead changes: count times the leading team changed
    let leadChanges = 0;
    let prevLeader = null;
    for (const { s1, s2 } of scoreProgression) {
      const leader = s1 > s2 ? "home" : s2 > s1 ? "away" : "draw";
      if (prevLeader !== null && leader !== "draw" && leader !== prevLeader && prevLeader !== "draw") {
        leadChanges++;
      }
      prevLeader = leader;
    }

    // Now decide category override
    if (total >= 6) return "scorefest";

    // Comeback from 2+ down that ended level or 1-apart
    if (hadComeback && maxDeficit >= 2 && diff <= 1) return "watchworthy";

    // Lead changes — game went back and forth
    if (leadChanges >= 2) return "watchworthy";

    // Late drama (final goal after 80') on a close game
    if (hasLateDrama && diff <= 1) return "watchworthy";

    return null;
  }

  async function enrichSoccerWithTimeline(games, slug) {
    // Only enrich the most recent close games — cap at 5 per league to keep load times fast
    const candidates = games
      .filter(g => g.id && Math.abs(g.h - g.a) <= 2)
      .slice(0, 5);

    if (candidates.length === 0) return games;

    const summaries = await Promise.all(
      candidates.map(g =>
        fetchESPN(
          `https://site.web.api.espn.com/apis/site/v2/sports/soccer/${slug}/summary?event=${g.id}&region=us&lang=en&contentorigin=espn`
        ).catch(() => null)
      )
    );

    const overrides = new Map();
    for (let i = 0; i < candidates.length; i++) {
      const summary = summaries[i];
      if (!summary?.keyEvents) continue;
      const override = categorizeSoccerByTimeline(summary.keyEvents, candidates[i].h, candidates[i].a);
      if (override) overrides.set(candidates[i].id, override);
    }

    if (overrides.size === 0) return games;

    return games.map(g => {
      if (!g.id || !overrides.has(g.id)) return g;
      return { ...g, timelineCat: overrides.get(g.id) };
    });
  }

  async function fetchAllSoccer() {
    const results = await Promise.all(
      SOCCER_LEAGUES.map(l => fetchSoccerLeague(l.slug, l.name))
    );

    // Merge all recent games first
    let allRecent = results.flatMap(r => r.recent).sort((a, b) => b.ts - a.ts);
    const allUpcoming = results.flatMap(r => r.upcoming).sort((a, b) => a.ts - b.ts);

    // Enrich with timeline data per league (in parallel across leagues)
    const enriched = await Promise.all(
      SOCCER_LEAGUES.map((l, i) => {
        const leagueGames = results[i].recent;
        return enrichSoccerWithTimeline(leagueGames, l.slug);
      })
    );

    // Rebuild allRecent with enriched data
    const enrichedById = new Map();
    for (const leagueGames of enriched) {
      for (const g of leagueGames) {
        if (g.id) enrichedById.set(g.id, g);
      }
    }
    allRecent = allRecent.map(g => g.id && enrichedById.has(g.id) ? enrichedById.get(g.id) : g);

    return { recent: allRecent, upcoming: allUpcoming };
  }

  // ── CRICKET T20 ───────────────────────────────────────────────────────
  async function fetchCricket() {
    const API_KEY = process.env.CRICKET_API_KEY;
    if (!API_KEY) return { recent: [], upcoming: [] };

    async function fetchPage(offset) {
      try {
        const res = await fetch(
          `https://api.cricapi.com/v1/currentMatches?apikey=${API_KEY}&offset=${offset}`,
          { signal: AbortSignal.timeout(4000) }
        );
        const json = await res.json();
        return json.status === "success" ? (json.data || []) : [];
      } catch (err) {
        console.error("Cricket fetch error:", err.message);
        return [];
      }
    }

    // Fetch two pages to get enough matches
    const [page0, page25] = await Promise.all([
      fetchPage(0),
      fetchPage(25),
    ]);
    const all = [...page0, ...page25];

    // Filter T20 only
    const t20 = all.filter(m => m.matchType === "t20");

    const recent = [];
    const upcoming = [];

    t20.forEach(m => {
      const date = new Date(m.dateTimeGMT);
      const dateStr = date.toLocaleDateString("en-US", { weekday:"short", month:"short", day:"numeric" });
      const timeStr = date.toLocaleTimeString("en-US", { hour:"numeric", minute:"2-digit", timeZoneName:"short" });

      // Extract league name from match name
      const leagueMatch = m.name.match(/,\s*(.+)$/);
      const league = leagueMatch ? leagueMatch[1].trim() : "T20";

      // Parse teams from name (before the comma)
      const teams = m.teams || [];
      const home = teams[0] || "TBD";
      const away = teams[1] || "TBD";

      // Parse scores for Score Fest detection
      const scores = m.score || [];
      const maxInnings = Math.max(0, ...scores.map(s => s.r ?? 0));

      // Parse result from status string
      // e.g. "Gujarat Titans won by 5 wkts" or "India won by 47 runs"
      let resultMargin = null;
      let resultType   = null; // "runs" or "wickets"

      const runsMatch    = m.status?.match(/won by (\d+) runs?/i);
      const wicketsMatch = m.status?.match(/won by (\d+) wkts?/i);

      if (runsMatch)    { resultMargin = parseInt(runsMatch[1]);    resultType = "runs";    }
      if (wicketsMatch) { resultMargin = parseInt(wicketsMatch[1]); resultType = "wickets"; }

      if (m.matchEnded) {
        recent.push({
          home, away, league, dateStr, timeStr,
          ts: date.getTime(),
          status: m.status,
          resultMargin, resultType, maxInnings,
        });
      } else if (!m.matchEnded && date.getTime() >= now) {
        upcoming.push({
          home, away, league, dateStr, timeStr,
          ts: date.getTime(),
        });
      }
    });

    return {
      recent:   recent.sort((a, b) => b.ts - a.ts).slice(0, 20),
      upcoming: upcoming.sort((a, b) => a.ts - b.ts).slice(0, 20),
    };
  }

  // ── TENNIS ────────────────────────────────────────────────────────────
  async function fetchTennis() {
    const TENNIS_LEAGUES = [
      { slug: "atp", name: "ATP" },
      { slug: "wta", name: "WTA" },
    ];

    // Rounds to exclude — qualifying rounds are noise
    const EXCLUDED_ROUNDS = new Set(["11", "12", "13", "14"]); // qualifying rounds
    // Only singles competitions
    const SINGLES_SLUGS = new Set(["mens-singles", "womens-singles"]);
    // Statuses to skip
    const SKIP_STATUSES = new Set(["STATUS_RETIRED", "STATUS_WALKOVER", "STATUS_ABANDONED"]);

    async function fetchTennisLeague(slug, leagueName) {
      // ESPN tennis scoreboard returns tournaments with nested groupings/competitions
      const data = await fetchESPN(
        `${BASE}/tennis/${slug}/scoreboard?dates=${espnDate(-21)}-${espnDate(7)}&limit=200`
      );

      const recent = [];
      const upcoming = [];
      const seen = new Set();
      const threeWeeksAgo = now - 21 * 86400000;

      for (const tournament of (data.events || [])) {
        const tournamentName = tournament.name || "Tournament";

        for (const grouping of (tournament.groupings || [])) {
          if (!SINGLES_SLUGS.has(grouping.grouping?.slug)) continue;

          for (const comp of (grouping.competitions || [])) {
            const statusName = comp.status?.type?.name ?? "";

            if (SKIP_STATUSES.has(statusName)) continue;
            if (EXCLUDED_ROUNDS.has(comp.round?.id)) continue;

            const isCompleted = comp.status?.type?.completed === true;
            const date = new Date(comp.startDate || comp.date);
            const ts = date.getTime();

            const key = `${comp.id}`;
            if (seen.has(key)) continue;
            seen.add(key);

            // order 1 = first listed player, order 2 = second
            const competitors = comp.competitors || [];
            const p1 = competitors.find(c => c.order === 1) || competitors[0];
            const p2 = competitors.find(c => c.order === 2) || competitors[1];

            if (!p1 || !p2) continue;

            // Try linescores first
            const p1LS = p1?.linescores || [];
            const p2LS = p2?.linescores || [];
            let sets = p1LS.map((ls, idx) => ({
              h: ls.value ?? 0,
              a: p2LS[idx]?.value ?? 0,
              tiebreak: ls.tiebreak ?? p2LS[idx]?.tiebreak ?? null,
            }));

            // Fallback: parse from notes text e.g. "Player bt Player 6-2 7-5"
            if (sets.length === 0 && comp.notes?.[0]?.text) {
              const noteText = comp.notes[0].text;
              const setMatches = [...noteText.matchAll(/(\d+)-(\d+)(?:\s*\([\d-]+\))?/g)];
              if (setMatches.length > 0) {
                // Winner is named first, p1 may or may not be the winner
                const p1Won = p1?.winner === true;
                sets = setMatches.map(m => {
                  const s1 = parseInt(m[1]), s2 = parseInt(m[2]);
                  // If p1 won, winner scores are s1; otherwise s2
                  return p1Won
                    ? { h: s1, a: s2, tiebreak: null }
                    : { h: s2, a: s1, tiebreak: null };
                });
              }
            }

            const homeSets = sets.filter(s => s.h > s.a).length;
            const awaySets = sets.filter(s => s.a > s.h).length;

            const round = comp.round?.displayName || "";
            const utcDate = `${date.getUTCFullYear()}-${String(date.getUTCMonth()+1).padStart(2,'0')}-${String(date.getUTCDate()).padStart(2,'0')}`;

            // Player names
            const home = p1?.athlete?.displayName || p1?.roster?.shortDisplayName || "TBD";
            const away = p2?.athlete?.displayName || p2?.roster?.shortDisplayName || "TBD";

            const match = {
              home, away, homeSets, awaySets, sets,
              tournament: tournamentName, round, league: leagueName,
              date: date.toLocaleDateString("en-US", { weekday:"short", month:"short", day:"numeric" }),
              dateKey: utcDate,
              time: date.toLocaleTimeString("en-US", { hour:"numeric", minute:"2-digit", timeZoneName:"short" }),
              ts,
            };

            if (isCompleted && ts >= threeWeeksAgo) {
              recent.push(match);
            } else if (!isCompleted && ts >= now) {
              upcoming.push(match);
            }
          }
        }
      }

      return {
        recent:   recent.sort((a, b) => b.ts - a.ts),
        upcoming: upcoming.sort((a, b) => a.ts - b.ts).slice(0, 20),
      };
    }

    const [atp, wta] = await Promise.all(
      TENNIS_LEAGUES.map(l => fetchTennisLeague(l.slug, l.name))
    );

    // Dedup across leagues — Madrid Open and other combined events appear in both ATP and WTA feeds
    function dedupMatches(matches) {
      const seen = new Set();
      return matches.filter(m => {
        const key = `${m.home}|${m.away}|${m.ts}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    }

    return {
      recent:   dedupMatches([...atp.recent, ...wta.recent].sort((a, b) => b.ts - a.ts)).slice(0, 50),
      upcoming: dedupMatches([...atp.upcoming, ...wta.upcoming].sort((a, b) => a.ts - b.ts)).slice(0, 30),
    };
  }

  // ── FETCH ALL ─────────────────────────────────────────────────────────
  const [soccer, nhl, mlb, nba, nfl, cricket, tennis] = await Promise.all([
    fetchAllSoccer(),
    fetchSport(`${BASE}/hockey/nhl/scoreboard`,     "NHL"),
    fetchSport(`${BASE}/baseball/mlb/scoreboard`,   "MLB", 15),
    fetchSport(`${BASE}/basketball/nba/scoreboard`, "NBA"),
    fetchSport(`${BASE}/football/nfl/scoreboard`,   "NFL"),
    fetchCricket(),
    fetchTennis(),
  ]);

  return {
    statusCode: 200,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "public, max-age=300",
    },
    body: JSON.stringify({ soccer, nhl, mlb, nba, nfl, cricket, tennis }),
  };
};
