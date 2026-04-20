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
        signal: AbortSignal.timeout(8000),
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
  // We fetch each of the past 14 days + next 7 days per league in parallel.
  async function fetchSoccerLeague(slug, leagueName) {
    // Build array of day offsets: -14 to +7
    const offsets = Array.from({ length: 22 }, (_, i) => i - 14);

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

  async function fetchAllSoccer() {
    const results = await Promise.all(
      SOCCER_LEAGUES.map(l => fetchSoccerLeague(l.slug, l.name))
    );
    return {
      recent:   results.flatMap(r => r.recent).sort((a, b) => b.ts - a.ts),
      upcoming: results.flatMap(r => r.upcoming).sort((a, b) => a.ts - b.ts),
    };
  }

  // ── CRICKET T20 ───────────────────────────────────────────────────────
  async function fetchCricket() {
    const API_KEY = process.env.CRICKET_API_KEY;
    if (!API_KEY) return { recent: [], upcoming: [] };

    async function fetchPage(offset) {
      try {
        const res = await fetch(
          `https://api.cricapi.com/v1/currentMatches?apikey=${API_KEY}&offset=${offset}`,
          { signal: AbortSignal.timeout(8000) }
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
      // Date range works here unlike soccer
      const data = await fetchESPN(
        `${BASE}/tennis/${slug}/scoreboard?dates=${espnDate(-14)}-${espnDate(7)}&limit=200`
      );

      const recent = [];
      const upcoming = [];
      const seen = new Set();

      for (const tournament of (data.events || [])) {
        const tournamentName = tournament.name || "Tournament";

        for (const grouping of (tournament.groupings || [])) {
          // Only singles
          if (!SINGLES_SLUGS.has(grouping.grouping?.slug)) continue;

          for (const comp of (grouping.competitions || [])) {
            const statusName = comp.status?.type?.name ?? "";

            // Skip retirements, walkovers, qualifying rounds
            if (SKIP_STATUSES.has(statusName)) continue;
            if (EXCLUDED_ROUNDS.has(comp.round?.id)) continue;

            const isCompleted = comp.status?.type?.completed === true;
            const date = new Date(comp.date);
            const ts = date.getTime();

            // Dedup
            const key = `${comp.id}`;
            if (seen.has(key)) continue;
            seen.add(key);

            // Get competitors — singles uses athlete, doubles uses roster
            const homeComp = comp.competitors?.find(c => c.homeAway === "home");
            const awayComp = comp.competitors?.find(c => c.homeAway === "away");

            const home = homeComp?.athlete?.displayName || homeComp?.roster?.shortDisplayName || "TBD";
            const away = awayComp?.athlete?.displayName || awayComp?.roster?.shortDisplayName || "TBD";

            // Set scores from linescores — home perspective
            const homeLS = homeComp?.linescores || [];
            const awayLS = awayComp?.linescores || [];
            const sets = homeLS.map((ls, idx) => ({
              h: ls.value ?? 0,
              a: awayLS[idx]?.value ?? 0,
              tiebreak: ls.tiebreak ?? awayLS[idx]?.tiebreak ?? null,
            }));

            const homeSets = sets.filter(s => s.h > s.a).length;
            const awaySets = sets.filter(s => s.a > s.h).length;

            const round = comp.round?.displayName || "";
            const utcDate = `${date.getUTCFullYear()}-${String(date.getUTCMonth()+1).padStart(2,'0')}-${String(date.getUTCDate()).padStart(2,'0')}`;

            const match = {
              home,
              away,
              homeSets,
              awaySets,
              sets,
              tournament: tournamentName,
              round,
              league: leagueName,
              date: date.toLocaleDateString("en-US", { weekday:"short", month:"short", day:"numeric" }),
              dateKey: utcDate,
              time: date.toLocaleTimeString("en-US", { hour:"numeric", minute:"2-digit", timeZoneName:"short" }),
              ts,
            };

            if (isCompleted && ts >= twoWeeksAgo) {
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

    return {
      recent:   [...atp.recent, ...wta.recent].sort((a, b) => b.ts - a.ts).slice(0, 50),
      upcoming: [...atp.upcoming, ...wta.upcoming].sort((a, b) => a.ts - b.ts).slice(0, 30),
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
