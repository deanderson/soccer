// ESPN Unofficial API — no API key required (all sports except cricket)
// ESPN Unofficial API — no API key required (all sports including cricket)

const { connectLambda, getStore } = require('@netlify/blobs');

exports.handler = async function (event, context) {
  connectLambda(event);

  // If called internally by the scheduler, skip blob and do live fetch
  const isInternal = event.queryStringParameters?._internal === '1';
  const sportParam = event.queryStringParameters?.sport || 'all';

  // For user-facing requests, try to serve from blob first
  if (!isInternal) {
    try {
      const store = getStore('scores');
      const cached = await store.get('latest', { type: 'json' });
      if (cached?.data && cached?.fetchedAt) {
        const ageMs = Date.now() - cached.fetchedAt;
        // Serve from cache if less than 20 minutes old (gives buffer for 15min schedule)
        if (ageMs < 20 * 60 * 1000) {
          // If sport-specific request, return just that sport's data
          const body = sportParam !== 'all' && sportParam !== undefined
            ? buildSportSubset(cached.data, sportParam)
            : cached.data;
          return {
            statusCode: 200,
            headers: {
              'Content-Type': 'application/json',
              'Cache-Control': 'public, max-age=60',
              'X-Cache': 'HIT',
              'X-Fetched-At': new Date(cached.fetchedAt).toISOString(),
            },
            body: JSON.stringify(body),
          };
        }
      }
    } catch (err) {
      console.log('Blob read failed, falling back to live fetch:', err.message);
    }
  }

  // Helper to extract one sport's data from the full blob
  function buildSportSubset(data, sport) {
    const apiKey = sport === 'football' ? 'soccer' : sport;
    if (data[apiKey]) return { [apiKey]: data[apiKey] };
    return data;
  }

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
  const twoWeeksAgo = now - 9 * 86400000;

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
    { slug: "uefa.champions", name: "Champions League", tier: 1 },
    { slug: "eng.1",          name: "Premier League",   tier: 1 },
    { slug: "esp.1",          name: "La Liga",          tier: 2 },
    { slug: "ger.1",          name: "Bundesliga",       tier: 2 },
    { slug: "ita.1",          name: "Serie A",          tier: 2 },
    { slug: "fra.1",          name: "Ligue 1",          tier: 3 },
    { slug: "uefa.europa",    name: "Europa League",    tier: 3 },
    { slug: "usa.1",          name: "MLS",              tier: 3 },
  ];
  const SOCCER_TIMELINE_CAP = { 1: 7, 2: 5, 3: 2 };

  // ESPN soccer scoreboard only accepts a single date (not a range).
  // Fetch 9 days back + 4 ahead = 13 requests per league (down from 15)
  async function fetchSoccerLeague(slug, leagueName) {
    const offsets = Array.from({ length: 13 }, (_, i) => i - 9);

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

    const scoreProgression = [];
    for (const g of goals) {
      const minute = parseMinute(g.clock?.displayValue);
      if (minute === null) continue;
      const m = g.text?.match(/Goal!\s+.+?\s+(\d+),\s+.+?\s+(\d+)\./);
      if (!m) continue;
      scoreProgression.push({
        minute,
        s1: parseInt(m[1], 10),
        s2: parseInt(m[2], 10),
        team: g.team?.displayName,
      });
    }

    if (scoreProgression.length === 0) return null;

    const diff  = Math.abs(h - a);
    const total = h + a;

    // Late drama: final goal after 80'
    const lateGoals = scoreProgression.filter(g => g.minute >= 80);
    let hasLateDrama = false;
    if (lateGoals.length > 0) {
      const lastScore = scoreProgression[scoreProgression.length - 1];
      const lastLate  = lateGoals[lateGoals.length - 1];
      if (lastLate === lastScore) hasLateDrama = true;
    }

    // Comeback: down 2+ and ended level or 1 apart
    let maxDeficit = 0;
    let hadComeback = false;
    for (const { s1, s2 } of scoreProgression) {
      const deficit = Math.abs(s1 - s2);
      if (deficit > maxDeficit) maxDeficit = deficit;
    }
    if (maxDeficit >= 2 && diff <= 1) hadComeback = true;

    // Lead changes
    let leadChanges = 0;
    let prevLeader = null;
    for (const { s1, s2 } of scoreProgression) {
      const leader = s1 > s2 ? "home" : s2 > s1 ? "away" : "draw";
      if (prevLeader !== null && leader !== "draw" && leader !== prevLeader && prevLeader !== "draw") leadChanges++;
      prevLeader = leader;
    }

    // Build drama hint for display
    const hints = [];
    if (hadComeback)         hints.push('comeback');
    if (hasLateDrama)        hints.push('late drama');
    if (leadChanges >= 2)    hints.push('back-and-forth');

    // Drama-first categorization — timeline IS the primary signal
    if (total >= 6)                                        return { cat: 'scorefest',   hints };
    if (hadComeback)                                       return { cat: 'watchworthy', hints };
    if (leadChanges >= 2)                                  return { cat: 'watchworthy', hints };
    if (hasLateDrama && diff <= 1)                         return { cat: 'watchworthy', hints };
    if (hasLateDrama && diff <= 2)                         return { cat: 'watchworthy', hints }; // 2-0 with late goal still interesting
    if (total >= 4 && diff <= 1)                           return { cat: 'watchworthy', hints }; // 3-2, 2-1 with high scoring
    if (diff >= 3 && !hasLateDrama && leadChanges === 0)   return { cat: 'blowout',     hints }; // no drama at all
    if (total <= 1)                                        return { cat: 'defensive',   hints }; // 0-0 or 1-0 with no late goal
    if (diff <= 1)                                         return { cat: 'watchable',   hints };

    return null; // fall back to score heuristics
  }

  async function enrichSoccerWithTimeline(games, slug, cap) {
    // Expanded candidates: include any game that could have timeline drama
    // Not just margin <= 2 — a 4-1 with late goals is still interesting
    const candidates = games
      .filter(g => g.id)
      .slice(0, cap);

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
      const result = categorizeSoccerByTimeline(summary.keyEvents, candidates[i].h, candidates[i].a);
      if (result) overrides.set(candidates[i].id, result);
    }

    if (overrides.size === 0) return games;

    return games.map(g => {
      if (!g.id || !overrides.has(g.id)) return g;
      const r = overrides.get(g.id);
      return { ...g, timelineCat: r.cat, dramaHints: r.hints };
    });
  }

  async function fetchAllSoccer() {
    const results = await Promise.all(
      SOCCER_LEAGUES.map(l => fetchSoccerLeague(l.slug, l.name))
    );

    // Timeline enrichment — tiered caps by league importance
    // Tier 1 (UCL, PL): 7 each = 14 requests
    // Tier 2 (La Liga, Bundesliga, Serie A): 5 each = 15 requests
    // Tier 3 (Ligue 1, Europa, MLS): 2 each = 6 requests
    // Total: 35 timeline requests, all parallel
    const enriched = await Promise.all(
      SOCCER_LEAGUES.map((l, i) => {
        const cap = SOCCER_TIMELINE_CAP[l.tier] ?? 2;
        return enrichSoccerWithTimeline(results[i].recent, l.slug, cap);
      })
    );

    const enrichedById = new Map();
    for (const leagueGames of enriched) {
      for (const g of leagueGames) {
        if (g.id) enrichedById.set(g.id, g);
      }
    }

    let allRecent = results.flatMap(r => r.recent).sort((a, b) => b.ts - a.ts);
    allRecent = allRecent.map(g => g.id && enrichedById.has(g.id) ? enrichedById.get(g.id) : g);

    return {
      recent:   allRecent,
      upcoming: results.flatMap(r => r.upcoming).sort((a, b) => a.ts - b.ts),
    };
  }

  // ── CRICKET T20 (ESPN) ────────────────────────────────────────────────
  // ESPN scoreboard header gives ALL active series in one call — no API key needed

  async function fetchCricket() {
    try {
      // ESPN scoreboard/header gives all active T20 series per date
      // Fetch today + past 10 days to build recent history
      const offsets = Array.from({ length: 11 }, (_, i) => -i); // 0, -1, -2 ... -10

      const T20_SERIES_NAMES = new Set(['IPL', 'PSL', 'BBL', 'T20 World Cup', 'T20I',
        'Men\'s T20 World Cup', 'ICC Men\'s T20 World Cup', 'Indian Premier League',
        'Pakistan Super League', 'Big Bash League']);

      const BLOCKED_KEYWORDS = [
        'women', 'qualifier', 'emerging', 'rising stars',
        'in nepal', 'in cyprus', 'in greece', 'in portugal',
        'central american', 'prime minister cup', 'national t20 cup',
        'ranji', 'sheffield shield', 'county', 'unofficial',
      ];

      function isAllowedSeries(name) {
        const lower = (name || '').toLowerCase();
        return !BLOCKED_KEYWORDS.some(k => lower.includes(k));
      }

      // Fetch header for each date in parallel
      const dateResults = await Promise.all(
        offsets.map(offset => {
          const d = new Date(now + offset * 86400000);
          const ymd = d.toISOString().slice(0, 10).replace(/-/g, '');
          return fetchESPN(
            `https://site.api.espn.com/apis/personalized/v2/scoreboard/header?sport=cricket&region=us&lang=en&dates=${ymd}`
          ).catch(() => null);
        })
      );

      const seenIds = new Set();
      const recent = [], upcoming = [];

      for (const data of dateResults) {
        if (!data) continue;
        const leagues = data?.sports?.[0]?.leagues || [];

        for (const league of leagues) {
          const leagueName = league.shortName || league.name || '';
          if (!isAllowedSeries(leagueName)) continue;

          for (const ev of (league.events || [])) {
            const classCard = ev.class?.generalClassCard || '';
            const eventType = ev.eventType || '';
            const isT20 = classCard.toLowerCase().includes('t20') ||
                          eventType === 'T20' ||
                          classCard === 'Twenty20';
            if (!isT20) continue;
            if (classCard.toLowerCase().includes('women')) continue;
            if (leagueName.toLowerCase().includes('women')) continue;

            const competitors = ev.competitors || [];
            if (competitors.length < 2) continue;

            const home = competitors.find(c => c.homeAway === 'home') || competitors[0];
            const away = competitors.find(c => c.homeAway === 'away') || competitors[1];
            if (seenIds.has(ev.id)) continue;
            seenIds.add(ev.id);

            const date = new Date(ev.date);
            const dateStr = date.toLocaleDateString("en-US", { weekday:"short", month:"short", day:"numeric" });
            const timeStr = date.toLocaleTimeString("en-US", { hour:"numeric", minute:"2-digit", timeZoneName:"short" });

            const fullStatus = ev.fullStatus?.type;
            const isFinished = fullStatus?.state === 'post';
            const isPre      = fullStatus?.state === 'pre';
            const isLive     = fullStatus?.state === 'in';

            const resultText = ev.fullStatus?.longSummary || ev.fullStatus?.summary || '';
            let resultMargin = null, resultType = null;
            const runsMatch    = resultText.match(/won by (\d+) runs?/i);
            const wicketsMatch = resultText.match(/won by (\d+) wkts?/i);
            if (runsMatch)    { resultMargin = parseInt(runsMatch[1]);    resultType = 'runs';    }
            if (wicketsMatch) { resultMargin = parseInt(wicketsMatch[1]); resultType = 'wickets'; }

            const scoreNums = [home.score, away.score]
              .map(s => parseInt((s || '').split('/')[0]))
              .filter(n => !isNaN(n) && n > 0);
            const maxInnings = Math.max(0, ...scoreNums);

            const game = {
              id: ev.id,
              home: home.displayName || home.name || 'Home',
              away: away.displayName || away.name || 'Away',
              league: leagueName,
              dateStr, timeStr,
              ts: date.getTime(),
              status: resultText || fullStatus?.shortDetail || '',
              resultMargin, resultType, maxInnings,
            };

            if (isFinished) {
              recent.push(game);
            } else if (isPre || isLive) {
              upcoming.push({ ...game, time: timeStr });
            }
          }
        }
      }

      const recentSorted = recent
        .sort((a, b) => b.ts - a.ts)
        .slice(0, 25);

      // Timeline enrichment for interesting games
      const candidates = recentSorted.filter(g =>
        g.id && g.resultMargin !== null && (
          (g.resultType === 'wickets' && g.resultMargin <= 3) ||
          (g.resultType === 'runs'    && g.resultMargin <= 20) ||
          g.maxInnings >= 180
        )
      ).slice(0, 5);

      if (candidates.length > 0) {
        const summaries = await Promise.all(
          candidates.map(g => fetchCricketSummary(g.id, '23694').catch(() => null))
        );
        const overrides = new Map();
        for (let i = 0; i < candidates.length; i++) {
          if (!summaries[i]) continue;
          const result = categorizeCricketByTimeline(
            summaries[i].notes, summaries[i].rosters,
            candidates[i].resultMargin, candidates[i].resultType, candidates[i].maxInnings
          );
          if (result) overrides.set(candidates[i].id, result);
        }
        return {
          recent: recentSorted.map(g => {
            if (!g.id || !overrides.has(g.id)) return g;
            const r = overrides.get(g.id);
            return { ...g, timelineCat: r.cat, dramaHints: r.factors || [], debug: { factors: r.factors } };
          }),
          upcoming: upcoming.sort((a, b) => a.ts - b.ts).slice(0, 20),
        };
      }

      return {
        recent:   recentSorted,
        upcoming: upcoming.sort((a, b) => a.ts - b.ts).slice(0, 20),
      };
    } catch (err) {
      console.error('fetchCricket failed:', err.message);
      return { recent: [], upcoming: [] };
    }
  }


  function parseCricketNotes(notes) {
    // Extract key match facts from ESPN cricket notes array
    const result = {
      powerplayHome: null,    // runs in powerplay (batting team 2)
      powerplayAway: null,    // runs in powerplay (batting team 1)
      inningsBreakScore: null,// score at end of first innings
      chaseAtDrinks: null,    // score at drinks in chase
      wicketsInLastOver: 0,
      lastOverRuns: null,
    };

    for (const note of (notes || [])) {
      const t = note.text || '';
      const sec = note.section;

      // Powerplay note: "Powerplay: Overs 0.1 - 6.0 (Mandatory - 71 runs, 0 wicket)"
      const pwMatch = t.match(/Powerplay.*?(\d+)\s*runs?,\s*(\d+)\s*wicket/i);
      if (pwMatch) {
        const val = { runs: parseInt(pwMatch[1]), wickets: parseInt(pwMatch[2]) };
        if (sec === '1') result.powerplayAway = val;
        if (sec === '2') result.powerplayHome = val;
      }

      // Innings break: "Innings Break: New Zealand - 215/7 in 20.0 overs"
      const ibMatch = t.match(/Innings Break.*?(\d+)\/(\d+)\s+in\s+([\d.]+)\s+overs/i);
      if (ibMatch) {
        result.inningsBreakScore = {
          runs: parseInt(ibMatch[1]),
          wickets: parseInt(ibMatch[2]),
          overs: parseFloat(ibMatch[3]),
        };
      }

      // Drinks in chase (section 2): "Drinks: India - 77/4 in 10.0 overs"
      const drinksMatch = t.match(/Drinks:.*?(\d+)\/(\d+)\s+in\s+([\d.]+)\s+overs/i);
      if (drinksMatch && sec === '2') {
        result.chaseAtDrinks = {
          runs: parseInt(drinksMatch[1]),
          wickets: parseInt(drinksMatch[2]),
          overs: parseFloat(drinksMatch[3]),
        };
      }
    }

    return result;
  }

  function categorizeCricketByTimeline(notes, rosters, resultMargin, resultType, maxInnings) {
    const facts = parseCricketNotes(notes);
    const factors = [];

    // Super over would show in notes — look for it
    const hasSuper = (notes || []).some(n => /super over/i.test(n.text));
    if (hasSuper) return { cat: 'scorefest', factors: ['Super Over'] };

    // Last-over finish: won by wickets with very few balls to spare
    // Approximation: if won by wickets and result text mentions last over
    const lastOverWin = resultType === 'wickets' && resultMargin <= 2;

    // Wicket cluster in chase: 4+ wickets in powerplay
    const chaseCollapse = facts.powerplayHome && facts.powerplayHome.wickets >= 3;

    // High scoring: both innings 180+
    const highScoring = facts.inningsBreakScore && facts.inningsBreakScore.runs >= 180 && maxInnings >= 180;

    // Close chase: at drinks (10 overs) batting team within 10 runs of required
    let closeChase = false;
    if (facts.chaseAtDrinks && facts.inningsBreakScore) {
      const target = facts.inningsBreakScore.runs + 1;
      const overs = facts.chaseAtDrinks.overs;
      const runsScored = facts.chaseAtDrinks.runs;
      // Required rate at drinks vs actual rate
      const requiredRemaining = target - runsScored;
      const oversRemaining = 20 - overs;
      const requiredRate = requiredRemaining / oversRemaining;
      const actualRate = runsScored / overs;
      // If required rate is between 8-12 (tense but achievable) it's a close chase
      if (requiredRate >= 8 && requiredRate <= 13) closeChase = true;
    }

    if (highScoring && (resultMargin <= 10 || resultType === 'wickets')) {
      return { cat: 'scorefest', hints: ['High scoring', 'Close finish'], factors: ['High scoring', 'Close finish'] };
    }
    if (lastOverWin) {
      return { cat: 'watchworthy', hints: ['Last-over finish'], factors: ['Last-over finish'] };
    }
    if (closeChase && resultType === 'wickets' && resultMargin <= 4) {
      return { cat: 'watchworthy', hints: ['Close chase'], factors: ['Close chase'] };
    }
    if (chaseCollapse && resultType === 'runs' && resultMargin <= 20) {
      return { cat: 'watchworthy', hints: ['Collapse'], factors: ['Collapse under pressure'] };
    }
    if (highScoring) {
      return { cat: 'scorefest', hints: ['High scoring'], factors: ['High scoring'] };
    }

    return null;
  }

  async function fetchCricketSummary(espnId, leagueSlug) {
    try {
      return await fetchESPN(
        `https://site.web.api.espn.com/apis/site/v2/sports/cricket/${leagueSlug}/summary?event=${espnId}&region=us&lang=en&contentorigin=espn`
      );
    } catch (e) { return null; }
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

  // ── NHL TIMELINE ENRICHMENT ───────────────────────────────────────────
  function categorizeNHLByTimeline(plays, h, a) {
    const diff  = Math.abs(h - a);
    const total = h + a;

    // Only look at goal plays
    const goals = plays.filter(p =>
      p.type?.text?.toLowerCase().includes('goal') ||
      p.type?.id === '505' // ESPN goal type ID
    );

    if (goals.length === 0) return null;

    // Track score progression
    const scoreProgression = [];
    for (const g of goals) {
      const period = g.period?.number ?? 0;
      const clock  = g.clock?.displayValue ?? '';
      // Convert clock to elapsed minutes (NHL clock counts down)
      const [mins, secs] = clock.split(':').map(Number);
      const periodStart = (period - 1) * 20;
      const elapsed = isNaN(mins) ? periodStart : periodStart + (20 - mins - (secs > 0 ? 0 : 0));
      const homeScore = g.homeScore ?? g.score?.home ?? null;
      const awayScore = g.awayScore ?? g.score?.away ?? null;
      if (homeScore !== null) {
        scoreProgression.push({ elapsed, period, h: homeScore, a: awayScore, team: g.team?.displayName });
      }
    }

    if (scoreProgression.length === 0) return null;

    // Late drama: goal in last 5 min of regulation (period 3, <5 min remaining) or OT
    const lateGoals = scoreProgression.filter(g => g.period >= 3);
    const lastGoal  = scoreProgression[scoreProgression.length - 1];
    const hasOT     = scoreProgression.some(g => g.period > 3);
    const hasLateDrama = hasOT || (lateGoals.length > 0 && lastGoal === lateGoals[lateGoals.length - 1]);

    // Comeback: team was 2+ down and came back to win or tie
    let maxDeficit = 0;
    for (const { h: hs, a: as } of scoreProgression) {
      maxDeficit = Math.max(maxDeficit, Math.abs(hs - as));
    }
    const hadComeback = maxDeficit >= 2 && diff <= 1;

    // Lead changes
    let leadChanges = 0, prevLeader = null;
    for (const { h: hs, a: as } of scoreProgression) {
      const leader = hs > as ? 'home' : as > hs ? 'away' : 'draw';
      if (prevLeader && leader !== 'draw' && leader !== prevLeader && prevLeader !== 'draw') leadChanges++;
      prevLeader = leader;
    }

    if (total >= 8) return { cat: 'scorefest',   hints: [] };
    if (hadComeback) return { cat: 'watchworthy', hints: ['comeback'] };
    if (leadChanges >= 2) return { cat: 'watchworthy', hints: ['back-and-forth'] };
    if (hasLateDrama && diff <= 1) return { cat: 'watchworthy', hints: ['late drama'] };
    if (hasOT) return { cat: 'watchworthy', hints: ['overtime'] };
    return null;
  }

  async function fetchNHLWithTimeline() {
    const data = await fetchESPN(`${BASE}/hockey/nhl/scoreboard?dates=${espnDate(-14)}-${espnDate(7)}&limit=500`);
    const events = normalizeEvents(data, "NHL");

    const recent = events.filter(g => g.status === "final" && g.ts >= twoWeeksAgo).sort((a, b) => b.ts - a.ts);
    const upcoming = events.filter(g => g.status === "upcoming" && g.ts >= now).sort((a, b) => a.ts - b.ts).slice(0, 50);

    // Expand to all recent games — timeline is primary signal now
    const candidates = recent.filter(g => g.id).slice(0, 7);

    if (candidates.length === 0) return { recent, upcoming };

    const summaries = await Promise.all(
      candidates.map(g =>
        fetchESPN(
          `https://site.web.api.espn.com/apis/site/v2/sports/hockey/nhl/summary?event=${g.id}&region=us&lang=en&contentorigin=espn`
        ).catch(() => null)
      )
    );

    const overrides = new Map();
    for (let i = 0; i < candidates.length; i++) {
      const summary = summaries[i];
      if (!summary) continue;
      const plays = summary.plays || summary.playByPlay || [];
      const result = categorizeNHLByTimeline(plays, candidates[i].h, candidates[i].a);
      if (result) overrides.set(candidates[i].id, result);
    }

    const enrichedRecent = recent.map(g =>
      g.id && overrides.has(g.id)
        ? { ...g, timelineCat: overrides.get(g.id).cat, dramaHints: overrides.get(g.id).hints }
        : g
    );

    return { recent: enrichedRecent, upcoming };
  }

  // ── NBA TIMELINE ENRICHMENT ───────────────────────────────────────────
  function categorizeNBAByTimeline(summary, h, a) {
    const diff  = Math.abs(h - a);
    const total = h + a;

    // ESPN NBA summary has boxscore with team stats including leadChanges and largestLead
    const teams = summary.boxscore?.teams || [];
    const homeTeam = teams.find(t => t.homeAway === 'home') || teams[0];
    const awayTeam = teams.find(t => t.homeAway === 'away') || teams[1];

    // Extract lead changes and largest lead from team stats
    let leadChanges = 0, largestLead = 0;
    for (const team of teams) {
      for (const stat of (team.statistics || [])) {
        if (stat.name === 'leadChanges') leadChanges = Math.max(leadChanges, parseInt(stat.displayValue) || 0);
        if (stat.name === 'largestLead') largestLead = Math.max(largestLead, parseInt(stat.displayValue) || 0);
      }
    }

    // Check for OT from header
    const hasOT = (summary.header?.competitions?.[0]?.status?.period ?? 4) > 4;

    // Q4 scoring from line scores — check if trailing team won or closed the gap in Q4
    const homeLinescore = homeTeam?.statistics?.find(s => s.name === 'points')?.splits?.categories?.[0]?.stats || [];
    const awayLinescore = awayTeam?.statistics?.find(s => s.name === 'points')?.splits?.categories?.[0]?.stats || [];

    // Comeback: was down big (largestLead ≥ 10) but won or kept it close
    const hadComeback = largestLead >= 10 && diff <= 7;

    // Score Fest: 220+ and close
    if (total >= 220 && diff <= 7) return { cat: 'scorefest', leadChanges, largestLead, hasOT, hadComeback };

    // Worth watching conditions
    if (hasOT) return { cat: 'watchworthy', leadChanges, largestLead, hasOT, hadComeback };
    if (hadComeback) return { cat: 'watchworthy', leadChanges, largestLead, hasOT, hadComeback };
    if (leadChanges >= 10 && diff <= 7) return { cat: 'watchworthy', leadChanges, largestLead, hasOT, hadComeback };

    return { cat: null, leadChanges, largestLead, hasOT, hadComeback };
  }

  async function fetchNBAWithTimeline() {
    const data = await fetchESPN(`${BASE}/basketball/nba/scoreboard?dates=${espnDate(-14)}-${espnDate(7)}&limit=500`);
    const events = normalizeEvents(data, "NBA");

    const recent = events.filter(g => g.status === "final" && g.ts >= twoWeeksAgo).sort((a, b) => b.ts - a.ts);
    const upcoming = events.filter(g => g.status === "upcoming" && g.ts >= now).sort((a, b) => a.ts - b.ts).slice(0, 50);

    // Enrich close games — cap at 7
    const candidates = recent.filter(g => g.id && Math.abs(g.h - g.a) <= 10).slice(0, 7);

    if (candidates.length === 0) return { recent, upcoming };

    const summaries = await Promise.all(
      candidates.map(g =>
        fetchESPN(
          `https://site.web.api.espn.com/apis/site/v2/sports/basketball/nba/summary?event=${g.id}&region=us&lang=en&contentorigin=espn`
        ).catch(() => null)
      )
    );

    const enrichedRecent = recent.map(g => {
      if (!g.id) return g;
      const idx = candidates.findIndex(c => c.id === g.id);
      if (idx === -1 || !summaries[idx]) return g;
      const result = categorizeNBAByTimeline(summaries[idx], g.h, g.a);
      const hints = [];
      if (result.hadComeback) hints.push('comeback');
      if (result.hasOT)       hints.push('overtime');
      if (result.leadChanges >= 10) hints.push('back-and-forth');
      return {
        ...g,
        timelineCat: result.cat || undefined,
        dramaHints: hints,
        debug: {
          leadChanges: result.leadChanges,
          largestLead: result.largestLead,
          hasOT: result.hasOT,
          hadComeback: result.hadComeback,
        }
      };
    });

    return { recent: enrichedRecent, upcoming };
  }

  // ── CONFIDENCE SCORING ────────────────────────────────────────────────
  // Returns { score: 0-100, factors: [{label, points}] }
  function computeConfidence(g, sport) {
    const factors = [];
    let score = 0;

    const h = g.h ?? 0, a = g.a ?? 0;
    const diff  = Math.abs(h - a);
    const total = h + a;

    if (sport === 'football') {
      // Goals
      if (total >= 7)      { factors.push({ label: `${total} total goals`, points: 30 }); score += 30; }
      else if (total >= 5) { factors.push({ label: `${total} total goals`, points: 20 }); score += 20; }
      else if (total >= 3) { factors.push({ label: `${total} total goals`, points: 10 }); score += 10; }

      // Margin
      if (diff === 0)      { factors.push({ label: 'Draw', points: 15 }); score += 15; }
      else if (diff === 1) { factors.push({ label: '1 goal margin', points: 12 }); score += 12; }
      else if (diff === 2) { factors.push({ label: '2 goal margin', points: 5 }); score += 5; }

      // Timeline factors
      if (g.timelineCat) {
        if (g.debug?.hasLateDrama)  { factors.push({ label: 'Late drama (80\'+)', points: 20 }); score += 20; }
        if (g.debug?.hadComeback)   { factors.push({ label: 'Comeback from 2+ down', points: 20 }); score += 20; }
        if (g.debug?.leadChanges >= 2) { factors.push({ label: `${g.debug.leadChanges} lead changes`, points: 15 }); score += 15; }
      }

      // League tier
      const leagueTier = { 'Champions League': 1, 'Premier League': 1, 'La Liga': 2, 'Bundesliga': 2, 'Serie A': 2 };
      const tier = leagueTier[g.league];
      if (tier === 1)      { factors.push({ label: `Tier 1 league (${g.league})`, points: 8 }); score += 8; }
      else if (tier === 2) { factors.push({ label: `Tier 2 league (${g.league})`, points: 4 }); score += 4; }

    } else if (sport === 'nhl') {
      if (total >= 8)      { factors.push({ label: `${total} goals`, points: 25 }); score += 25; }
      else if (total >= 6) { factors.push({ label: `${total} goals`, points: 15 }); score += 15; }
      if (diff <= 1)       { factors.push({ label: '1 goal margin', points: 15 }); score += 15; }
      if (g.debug?.hasOT)        { factors.push({ label: 'Overtime/Shootout', points: 25 }); score += 25; }
      if (g.debug?.hadComeback)  { factors.push({ label: 'Comeback from 2+ down', points: 20 }); score += 20; }
      if ((g.debug?.leadChanges ?? 0) >= 2) { factors.push({ label: `${g.debug.leadChanges} lead changes`, points: 15 }); score += 15; }

    } else if (sport === 'nba') {
      if (total >= 230)    { factors.push({ label: `${total} combined points`, points: 20 }); score += 20; }
      else if (total >= 210) { factors.push({ label: `${total} combined points`, points: 10 }); score += 10; }
      if (diff <= 5)       { factors.push({ label: `${diff} point margin`, points: 20 }); score += 20; }
      else if (diff <= 10) { factors.push({ label: `${diff} point margin`, points: 10 }); score += 10; }
      if (g.debug?.hasOT)        { factors.push({ label: 'Overtime', points: 20 }); score += 20; }
      if (g.debug?.hadComeback)  { factors.push({ label: `Comeback (down ${g.debug?.largestLead})`, points: 20 }); score += 20; }
      const lc = g.debug?.leadChanges ?? 0;
      if (lc >= 15)        { factors.push({ label: `${lc} lead changes`, points: 20 }); score += 20; }
      else if (lc >= 8)    { factors.push({ label: `${lc} lead changes`, points: 12 }); score += 12; }

    } else if (sport === 'tennis') {
      const sets = g.homeSets + g.awaySets;
      if (sets >= 5)       { factors.push({ label: '5-set epic', points: 40 }); score += 40; }
      else if (sets >= 3)  { factors.push({ label: '3-set match', points: 25 }); score += 25; }
      if (g.sets?.some(s => s.h === 7 || s.a === 7)) { factors.push({ label: 'Tiebreak(s)', points: 20 }); score += 20; }
      const closeSets = (g.sets || []).filter(s => Math.abs(s.h - s.a) <= 2).length;
      if (closeSets >= 2)  { factors.push({ label: `${closeSets} close sets`, points: 15 }); score += 15; }

    } else if (sport === 'cricket') {
      if (g.maxInnings >= 200)   { factors.push({ label: `${g.maxInnings} run innings`, points: 20 }); score += 20; }
      if (g.resultType === 'wickets' && g.resultMargin <= 2) { factors.push({ label: `Won by ${g.resultMargin} wickets`, points: 35 }); score += 35; }
      else if (g.resultType === 'runs' && g.resultMargin <= 10) { factors.push({ label: `Won by ${g.resultMargin} runs`, points: 30 }); score += 30; }
      else if (g.resultType === 'wickets' && g.resultMargin <= 5) { factors.push({ label: `Won by ${g.resultMargin} wickets`, points: 20 }); score += 20; }
    }

    // Recency bonus
    const daysAgo = (Date.now() - g.ts) / 86400000;
    if (daysAgo <= 1)      { factors.push({ label: 'Today', points: 5 }); score += 5; }
    else if (daysAgo <= 3) { factors.push({ label: 'Last 3 days', points: 3 }); score += 3; }

    return { score: Math.min(score, 100), factors };
  }


  // Attach confidence scores to all games in a result
  function withConfidence(result, sport) {
    const apiKey = { football:'soccer' }[sport] || sport;
    const data = result[apiKey] || result[sport];
    if (!data) return result;
    return {
      ...result,
      [apiKey]: { ...data, recent: attachConfidence(data.recent || [], sport) }
    };
  }

  function attachConfidence(games, sport) {
    return games.map(g => ({ ...g, confidence: computeConfidence(g, sport) }));
  }

  // Route to the appropriate fetcher
  const SPORT_FETCHERS = {
    football: async () => withConfidence({ soccer: await fetchAllSoccer() }, 'football'),
    nhl:      async () => withConfidence({ nhl:    await fetchNHLWithTimeline() }, 'nhl'),
    mlb:      async () => withConfidence({ mlb:    await fetchSport(`${BASE}/baseball/mlb/scoreboard`, "MLB", 15) }, 'mlb'),
    nba:      async () => withConfidence({ nba:    await fetchNBAWithTimeline() }, 'nba'),
    nfl:      async () => withConfidence({ nfl:    await fetchSport(`${BASE}/football/nfl/scoreboard`, "NFL") }, 'nfl'),
    cricket:  async () => withConfidence({ cricket: await fetchCricket() }, 'cricket'),
    tennis:   async () => withConfidence({ tennis:  await fetchTennis() }, 'tennis'),
  };

  let body;

  if (sportParam === 'all' || !SPORT_FETCHERS[sportParam]) {
    const [soccer, nhl, mlb, nba, nfl, cricket, tennis] = await Promise.all([
      fetchAllSoccer(),
      fetchNHLWithTimeline(),
      fetchSport(`${BASE}/baseball/mlb/scoreboard`,   "MLB", 15),
      fetchNBAWithTimeline(),
      fetchSport(`${BASE}/football/nfl/scoreboard`,   "NFL"),
      fetchCricket(),
      fetchTennis(),
    ]);
    body = {
      soccer:  { ...soccer,  recent: attachConfidence(soccer.recent,  'football') },
      nhl:     { ...nhl,     recent: attachConfidence(nhl.recent,     'nhl')      },
      mlb:     { ...mlb,     recent: attachConfidence(mlb.recent,     'mlb')      },
      nba:     { ...nba,     recent: attachConfidence(nba.recent,     'nba')      },
      nfl:     { ...nfl,     recent: attachConfidence(nfl.recent,     'nfl')      },
      cricket: { ...cricket, recent: attachConfidence(cricket.recent, 'cricket')  },
      tennis:  { ...tennis,  recent: attachConfidence(tennis.recent,  'tennis')   },
    };

    // Save full fetch to blob for future requests
    try {
      const store = getStore('scores');
      await store.setJSON('latest', { data: body, fetchedAt: Date.now(), fetchedAtISO: new Date().toISOString() });
    } catch (err) {
      console.error('Failed to save to blob:', err.message);
    }
  } else {
    body = await SPORT_FETCHERS[sportParam]();
  }

  return {
    statusCode: 200,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "public, max-age=60",
      "X-Cache": "MISS",
    },
    body: JSON.stringify(body),
  };
};
