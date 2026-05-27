// ESPN Unofficial API — no API key required (all sports except cricket)
// ESPN Unofficial API — no API key required (all sports including cricket)

const { connectLambda, getStore } = require('@netlify/blobs');
const { fetchDarts } = require('./darts-fetcher');
const { lookupProvider } = require('./watch-providers');

exports.handler = async function (event, context) {
  connectLambda(event);

  // If called internally by the scheduler, skip blob and do live fetch
  const isInternal = event.queryStringParameters?._internal === '1';
  const sportParam = event.queryStringParameters?.sport || 'all';

  // Detect user country from Netlify edge headers (no third-party API).
  // Header is lowercase per Netlify Functions v2 norms; check both for safety.
  const userCountry = (event.headers?.['x-country']
                    || event.headers?.['X-Country']
                    || event.headers?.['x-nf-country']
                    || '').toUpperCase() || null;

  // Tiered blob serving with spike protection.
  //
  // Three tiers based on blob age:
  //   <30 min:           serve fresh (normal happy path)
  //   30 min – 4 hours:  serve stale silently (cron probably caught up;
  //                      serve what we have to keep the site alive)
  //   >4 hours, missing: live fetch (last resort; expensive)
  //
  // Plus a live-fetch lock: before doing the expensive live fetch, write
  // a tiny lock blob. If another concurrent request sees a fresh lock
  // (set <60s ago), it serves stale instead of starting its own fetch.
  // This prevents 200 simultaneous users from triggering 200 ESPN
  // fetches during a traffic spike when the blob is stale.
  //
  // The lock is advisory — there's a small race window where two
  // instances both miss the lock and both write it. Acceptable: worst
  // case we get 2-3 concurrent live fetches instead of 200.
  const FRESH_MS = 30 * 60 * 1000;
  const STALE_OK_MS = 4 * 60 * 60 * 1000;
  const LOCK_TTL_MS = 60 * 1000;

  if (!isInternal) {
    try {
      const store = getStore('scores');
      const cached = await store.get('latest', { type: 'json' });
      const ageMs = cached?.fetchedAt ? Date.now() - cached.fetchedAt : Infinity;
      const haveCache = !!cached?.data;
      const isFresh = haveCache && ageMs < FRESH_MS;
      const isStaleButUsable = haveCache && ageMs < STALE_OK_MS;

      if (isFresh) {
        // Happy path: fresh blob, serve it
        return serveCached(cached, false);
      }

      // Not fresh — need a live fetch OR fall back to stale. Check lock.
      let lockHeld = false;
      try {
        const lock = await store.get('live-fetch-lock', { type: 'json' });
        const lockAge = lock?.startedAt ? Date.now() - lock.startedAt : Infinity;
        lockHeld = lockAge < LOCK_TTL_MS;
      } catch (e) { /* lock read failure — treat as not held */ }

      if (lockHeld) {
        // Another instance is fetching. Serve whatever we have.
        if (isStaleButUsable) return serveCached(cached, true);
        // No usable cache and someone else is fetching — return 503-ish
        return {
          statusCode: 503,
          headers: { 'Content-Type': 'application/json', 'Retry-After': '15' },
          body: JSON.stringify({ error: 'Scores refreshing, try again in a few seconds' }),
        };
      }

      // We can fetch. Take the lock first so others serve stale.
      try {
        await store.setJSON('live-fetch-lock', { startedAt: Date.now() });
      } catch (e) { /* lock write failure — proceed anyway */ }

      // If we have stale-but-usable cache, serve it now and let the
      // cron / next live fetch catch up later. The cost of making the
      // user wait 10-15s for a live fetch is worse than serving
      // 1-hour-old data once.
      if (isStaleButUsable) {
        return serveCached(cached, true);
      }

      // No usable cache. Fall through to live fetch below.
    } catch (err) {
      console.log('Blob read failed, falling back to live fetch:', err.message);
    }
  }

  // Helper: serve the cached blob (fresh or stale).
  function serveCached(cached, stale) {
    const subsetBody = sportParam !== 'all' && sportParam !== undefined
      ? buildSportSubset(cached.data, sportParam)
      : cached.data;
    const personalized = attachWatchToBody(subsetBody, userCountry);
    const body = { ...personalized, _meta: { userCountry, fetchedAt: cached.fetchedAt, stale } };
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=60',
        'X-Cache': stale ? 'HIT-STALE' : 'HIT',
        'X-Fetched-At': new Date(cached.fetchedAt).toISOString(),
      },
      body: JSON.stringify(body),
    };
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

  async function fetchESPN(url, timeoutMs = 8000) {
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": "Mozilla/5.0" },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      console.error("ESPN fetch error:", url, err.message);
      return { events: [] };
    }
  }

  // Lighter timeout for summary/timeline endpoints — fail fast if ESPN is struggling
  async function fetchESPNSummary(url) {
    return fetchESPN(url, 5000);
  }

  const FINAL_STATUSES = new Set([
    "STATUS_FINAL", "STATUS_FULL_TIME", "STATUS_FT",
    "STATUS_ENDED", "STATUS_COMPLETED",
  ]);
  const UPCOMING_STATUSES = new Set([
    "STATUS_SCHEDULED", "STATUS_PREGAME",
  ]);

  // Sports where broadcast data is shown in the UI. We only capture
  // geoBroadcasts for these to avoid bloating the blob with unused data
  // for sports like NHL/MLB where we don't surface broadcast info.
  // To add a sport, list its league name here and update the frontend.
  const BROADCAST_SPORTS = new Set(['WNBA']);

  function normalizeEvents(data, leagueName) {
    const wantsBroadcast = BROADCAST_SPORTS.has(leagueName);
    return (data.events || []).map(ev => {
      const comp   = ev.competitions?.[0];
      const home   = comp?.competitors?.find(c => c.homeAway === "home");
      const away   = comp?.competitors?.find(c => c.homeAway === "away");
      const status = ev.status?.type?.name ?? "";
      const date   = new Date(ev.date);
      // US sports primarily play in ET, so we anchor both the grouping key
      // and the display date to ET. Otherwise late-night ET games (which are
      // already past midnight UTC) get bucketed to the next calendar day,
      // showing a "Tue May 13" game on the "Wed May 14" page.
      const etFormatter = new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/New_York',
        year: 'numeric', month: '2-digit', day: '2-digit',
      });
      const etParts = etFormatter.formatToParts(date).reduce((acc, p) => {
        if (p.type !== 'literal') acc[p.type] = p.value;
        return acc;
      }, {});
      const dateKey = `${etParts.year}-${etParts.month}-${etParts.day}`;
      const displayDate = date.toLocaleDateString("en-US", {
        timeZone: 'America/New_York',
        weekday: "short", month: "short", day: "numeric",
      });
      // Broadcast data — only attached for sports in BROADCAST_SPORTS.
      // ESPN provides:
      //  - broadcast (string): populated only for nationally televised
      //    games (e.g., "NBC/Peacock"). Empty otherwise.
      //  - geoBroadcasts (array): structured list with type (TV/Streaming),
      //    market (National/Home/Away), media (network name), region.
      // Frontend decides how to display; we pass through verbatim.
      const broadcast     = wantsBroadcast ? (comp?.broadcast || ev.broadcast || '') : undefined;
      const geoBroadcasts = wantsBroadcast && Array.isArray(comp?.geoBroadcasts) ? comp.geoBroadcasts : undefined;
      const out = {
        id:     ev.id ?? null,
        home:   home?.team?.displayName ?? "TBD",
        away:   away?.team?.displayName ?? "TBD",
        h:      parseInt(home?.score ?? "0", 10),
        a:      parseInt(away?.score ?? "0", 10),
        date:   displayDate,
        dateKey: dateKey,
        time:   date.toLocaleTimeString("en-US", { hour:"numeric", minute:"2-digit", timeZoneName:"short" }),
        league: leagueName,
        status: FINAL_STATUSES.has(status)    ? "final"
              : UPCOMING_STATUSES.has(status) ? "upcoming"
              : "other",
        ts: date.getTime(),
        period: ev.status?.period ?? null,
      };
      if (broadcast     !== undefined) out.broadcast     = broadcast;
      if (geoBroadcasts !== undefined) out.geoBroadcasts = geoBroadcasts;
      // MLB: pass through inning-by-inning linescores for drama analysis
      if (leagueName === 'MLB') {
        out.homeLinescores = (home?.linescores || []).map(l => parseInt(l.value ?? 0, 10));
        out.awayLinescores = (away?.linescores || []).map(l => parseInt(l.value ?? 0, 10));
      }
      return out;
    });
  }

  const BASE = "https://site.api.espn.com/apis/site/v2/sports";
  const now  = Date.now();
  const twoWeeksAgo = now - 9 * 86400000;

  async function fetchSport(scoreboardUrl, leagueName, upcomingCap = 50) {
    // Fetch recent (past 14 days) and upcoming (next 4 days) separately to avoid ESPN timeout
    const [recentData, upcomingData] = await Promise.all([
      fetchESPN(`${scoreboardUrl}?dates=${espnDate(-14)}-${espnDate(0)}&limit=200`),
      fetchESPN(`${scoreboardUrl}?dates=${espnDate(1)}-${espnDate(4)}&limit=100`),
    ]);

    const recentEvents  = normalizeEvents(recentData,   leagueName);
    const upcomingEvents = normalizeEvents(upcomingData, leagueName);

    const recent14 = recentEvents
      .filter(g => g.status === "final" && g.ts >= twoWeeksAgo)
      .sort((a, b) => a.ts - b.ts);

    const upcoming = upcomingEvents
      .filter(g => g.status === "upcoming" && g.ts >= now)
      .sort((a, b) => a.ts - b.ts)
      .slice(0, upcomingCap);

    if (recent14.length < MIN) {
      const fallback = await fetchESPN(
        `${scoreboardUrl}?dates=${espnDate(-60)}-${espnDate(-15)}&limit=100`
      );
      const fallbackRecent = normalizeEvents(fallback, leagueName)
        .filter(g => g.status === "final")
        .sort((a, b) => a.ts - b.ts)
        .slice(-MIN);
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
  const SOCCER_TIMELINE_CAP = { 1: 999, 2: 999, 3: 999 }; // all games

  // ESPN soccer scoreboard only accepts a single date (not a range).
  // Fetch 9 days back + 4 ahead = 13 requests per league (down from 15)
  // ── SOCCER DETAILS PARSING ────────────────────────────────────────────
  // Parses the `details` array from the ESPN scoreboard (no extra API call)
  // to extract red cards, late goals, own goals, penalty shootouts, and
  // penalty kick goals. Returns a signals object or null if no details.
  function parseSoccerDetails(details, h, a) {
    if (!Array.isArray(details) || details.length === 0) return null;

    let redCards = 0;
    let lateGoal = false;       // goal after 80'
    let ninetyGoal = false;     // goal after 90' (injury time winner)
    let ownGoal = false;
    let penaltyShootout = false;
    let penaltyGoal = false;

    for (const det of details) {
      const mins = (det.clock?.value ?? 0) / 60;
      if (det.redCard)    redCards++;
      if (det.ownGoal)    ownGoal = true;
      if (det.shootout)   penaltyShootout = true;
      if (det.scoringPlay) {
        if (det.penaltyKick && !det.shootout) penaltyGoal = true;
        if (mins >= 80) lateGoal = true;
        if (mins >= 90) ninetyGoal = true;
      }
    }

    return { redCards, lateGoal, ninetyGoal, ownGoal, penaltyShootout, penaltyGoal };
  }

  async function fetchSoccerLeague(slug, leagueName) {
    const offsets = Array.from({ length: 13 }, (_, i) => i - 9);

    const dayResults = await Promise.all(
      offsets.map(offset =>
        fetchESPN(
          `${BASE}/soccer/${slug}/scoreboard?dates=${espnDate(offset)}&limit=100`
        )
      )
    );

    // Build a details signals map keyed by event id BEFORE normalizing
    const detailsSignals = new Map();
    for (const data of dayResults) {
      for (const ev of (data.events || [])) {
        const comp = ev.competitions?.[0];
        if (!comp?.details?.length) continue;
        const home = comp.competitors?.find(c => c.homeAway === 'home');
        const away = comp.competitors?.find(c => c.homeAway === 'away');
        const h = parseInt(home?.score ?? '0', 10);
        const a = parseInt(away?.score ?? '0', 10);
        const signals = parseSoccerDetails(comp.details, h, a);
        if (signals && ev.id) detailsSignals.set(ev.id, signals);
      }
    }

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
      .sort((a, b) => b.ts - a.ts)
      .map(g => {
        const sig = detailsSignals.get(g.id);
        if (!sig) return g;
        const out = { ...g };
        if (sig.redCards > 0)       out.redCards = sig.redCards;
        if (sig.lateGoal)           out.lateGoal = true;
        if (sig.ninetyGoal)         out.ninetyGoal = true;
        if (sig.ownGoal)            out.ownGoal = true;
        if (sig.penaltyShootout)    out.penaltyShootout = true;
        if (sig.penaltyGoal)        out.penaltyGoal = true;
        return out;
      }); // newest first

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

  function categorizeSoccerByTimeline(keyEvents, h, a) {
    const goals = keyEvents.filter(e =>
      e.type?.type === "goal" ||
      e.type?.id === "goal" ||
      (typeof e.type?.text === "string" && e.type.text.toLowerCase().includes("goal")) ||
      (typeof e.text === "string" && e.text.toLowerCase().includes("goal"))
    );

    if (goals.length === 0) return null;

    const diff  = Math.abs(h - a);
    const total = h + a;

    // Red cards — count sendings off. We only credit them as a bonus signal
    // later if the game is otherwise close (diff <= 2), since a red card in
    // a 5-0 blowout doesn't make it more watchable.
    const redCards = keyEvents.filter(e => {
      const type = (e.type?.text || '').toLowerCase();
      const text = (e.text || '').toLowerCase();
      return type === 'red card' || type.includes('red card') || text.includes('red card');
    }).length;

    // Late goal detection — only meaningful late goals (changed or decided the result)
    const lateGoals = goals.filter(g => {
      const min = parseMinute(g.clock?.displayValue);
      return min !== null && min >= 80;
    });

    // A late goal "matters" if it was an equalizer or winner — not a consolation in a blowout
    // We detect this by checking if the score was level or 1-apart AFTER the late goal
    // Simple proxy: if the final margin is <=1 AND there was a late goal, it was decisive
    // Also fires for dramatic late goals in high-scoring games (80+ min goal in 4-3 type)
    const hasLateDrama = lateGoals.length > 0 && (
      diff <= 1 ||                          // late goal decided or equalized
      (diff === 2 && total >= 5)            // late goal in an already-high-scoring game
    );

    // Score progression — try multiple text formats
    const scoreProgression = [];
    for (const g of goals) {
      const minute = parseMinute(g.clock?.displayValue);
      if (minute === null) continue;

      // Try various ESPN goal text formats:
      // "Goal! Arsenal 2, Chelsea 1."
      // "Goal scored. Arsenal 2 - Chelsea 1"
      // Just extract two numbers that look like a scoreline
      const text = g.text || g.shortText || '';
      let s1 = null, s2 = null;

      const m1 = text.match(/(\d+)[,\s\-]+(\d+)/);
      if (m1) {
        s1 = parseInt(m1[1], 10);
        s2 = parseInt(m1[2], 10);
      }

      if (s1 !== null && s2 !== null && (s1 + s2) <= total) {
        scoreProgression.push({ minute, s1, s2 });
      }
    }

    // Comeback detection from score progression
    let maxDeficit = 0;
    let hadComeback = false;
    if (scoreProgression.length >= 2) {
      for (const { s1, s2 } of scoreProgression) {
        const deficit = Math.abs(s1 - s2);
        if (deficit > maxDeficit) maxDeficit = deficit;
      }
      if (maxDeficit >= 2 && diff <= 1) hadComeback = true;
    }

    // Lead changes
    let leadChanges = 0;
    let prevLeader = null;
    for (const { s1, s2 } of scoreProgression) {
      const leader = s1 > s2 ? "home" : s2 > s1 ? "away" : "draw";
      if (prevLeader !== null && leader !== "draw" && leader !== prevLeader && prevLeader !== "draw") leadChanges++;
      prevLeader = leader;
    }

    // Build hints
    const hints = [];
    if (hadComeback)         hints.push('comeback');
    if (hasLateDrama)        hints.push('late drama');
    if (leadChanges >= 2)    hints.push('back-and-forth');

    // Always return a result for enriched games — even if just late drama
    if (total >= 6)                                        return { cat: 'scorefest',   hints, redCards };
    if (hadComeback)                                       return { cat: 'watchworthy', hints, redCards };
    if (leadChanges >= 2)                                  return { cat: 'watchworthy', hints, redCards };
    if (hasLateDrama && diff <= 2)                         return { cat: 'watchworthy', hints, redCards };
    if (total >= 4 && diff <= 1)                           return { cat: 'watchworthy', hints, redCards };
    if (diff >= 3 && !hasLateDrama && leadChanges === 0)   return { cat: 'blowout',     hints, redCards };
    if (total <= 1)                                        return { cat: 'defensive',   hints, redCards };
    if (diff <= 1)                                         return { cat: 'watchable',   hints, redCards };

    return { cat: null, hints, redCards };
  }

  async function enrichSoccerWithTimeline(games, slug, cap) {
    // Hard pre-filter: never fetch summary data for 3+ goal margins
    // A 3+ goal gap is always Skip regardless of timeline — saves API calls
    const candidates = games
      .filter(g => g.id && Math.abs(g.h - g.a) < 3)
      .slice(0, cap);

    if (candidates.length === 0) return games;

    const summaries = await Promise.all(
      candidates.map(g =>
        fetchESPNSummary(
          `https://site.web.api.espn.com/apis/site/v2/sports/soccer/${slug}/summary?event=${g.id}&region=us&lang=en&contentorigin=espn`
        ).catch(() => null)
      )
    );

    const overrides = new Map();
    for (let i = 0; i < candidates.length; i++) {
      const summary = summaries[i];
      if (!summary?.keyEvents) continue;
      const result = categorizeSoccerByTimeline(summary.keyEvents, candidates[i].h, candidates[i].a);
      if (result) overrides.set(candidates[i].id, result); // store even if cat is null — hints still useful
    }

    if (overrides.size === 0) return games;

    return games.map(g => {
      if (!g.id || !overrides.has(g.id)) return g;
      const r = overrides.get(g.id);
      const enriched = { ...g, dramaHints: r.hints || [] };
      if (r.cat) enriched.timelineCat = r.cat;
      if (typeof r.redCards === 'number' && r.redCards > 0) enriched.redCards = r.redCards;
      return enriched;
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
        'Pakistan Super League', 'Big Bash League',
        'Vitality Blast', 'Vitality Blast Men', 'The Hundred', 'The Hundred Men\'s Competition',
        'Major League Cricket', 'MLC',
        'ICC Women\'s T20 World Cup', 'Women\'s T20 World Cup',
        'SA20', 'International League T20', 'ILT20',
        'Caribbean Premier League', 'CPL',
        'Lanka Premier League', 'LPL',
        'T20 Blast',
      ]);

      const BLOCKED_KEYWORDS = [
        'women', 'qualifier', 'emerging', 'rising stars',
        'in nepal', 'in cyprus', 'in greece', 'in portugal',
        'central american', 'prime minister cup', 'national t20 cup',
        'ranji', 'sheffield shield', 'county', 'unofficial',
      ];

      function isAllowedSeries(name) {
        const lower = (name || '').toLowerCase();
        // Allowlist takes priority — known top-tier T20 competitions
        if (T20_SERIES_NAMES.has(name)) return true;
        // Block domestic, qualifier, and low-tier tournaments
        if (BLOCKED_KEYWORDS.some(k => lower.includes(k))) return false;
        // Default block — only show explicitly allowlisted series
        return false;
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
            const wicketsMatch = resultText.match(/won by (\d+) (?:wkts?|wickets?)/i);
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

      // Timeline enrichment — only last 5 days to avoid ESPN 502s on older events
      const fiveDaysAgo = now - 7 * 86400000;
      const candidates = recentSorted.filter(g =>
        g.id && g.ts >= fiveDaysAgo && g.resultMargin !== null && (
          (g.resultType === 'wickets' && g.resultMargin <= 3) ||
          (g.resultType === 'runs'    && g.resultMargin <= 20) ||
          g.maxInnings >= 180
        )
      ).slice(0, 10);

      if (candidates.length > 0) {
        // Batch requests in groups of 5 to avoid ESPN rate limiting
        const summaries = [];
        for (let i = 0; i < candidates.length; i += 5) {
          const batch = candidates.slice(i, i + 5);
          const results = await Promise.all(
            batch.map(g => fetchCricketSummary(g.id, '23694').catch(() => null))
          );
          summaries.push(...results);
          if (i + 5 < candidates.length) await new Promise(r => setTimeout(r, 300));
        }
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
      return await fetchESPNSummary(
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

    // Fetch ATP + WTA rankings and build athleteId → rank maps.
    // ESPN athlete ID is embedded in the player card href:
    // "https://www.espn.com/tennis/player/_/id/2383/daniil-medvedev" → 2383
    async function fetchRankings(slug) {
      try {
        const data = await fetchESPN(`${BASE}/tennis/${slug}/rankings?limit=25`);
        const ranks = data?.rankings?.[0]?.ranks || [];
        const map = new Map();
        for (const entry of ranks) {
          const links = entry.athlete?.links || [];
          const href = links.find(l => l.rel?.includes('athlete'))?.href || '';
          const idMatch = href.match(/\/id\/(\d+)\//);
          if (idMatch) map.set(idMatch[1], entry.current);
        }
        return map;
      } catch { return new Map(); }
    }

    // Extract ESPN athlete ID from player card href
    function athleteId(competitor) {
      const links = competitor?.athlete?.links || [];
      const href = links.find(l => l.rel?.includes('athlete'))?.href || '';
      const m = href.match(/\/id\/(\d+)\//);
      return m ? m[1] : null;
    }

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

            // Player names and IDs (IDs stripped after rank annotation)
            const home = p1?.athlete?.displayName || p1?.roster?.shortDisplayName || "TBD";
            const away = p2?.athlete?.displayName || p2?.roster?.shortDisplayName || "TBD";
            const _homeId = athleteId(p1);
            const _awayId = athleteId(p2);

            const match = {
              home, away, homeSets, awaySets, sets,
              tournament: tournamentName, round, league: leagueName,
              date: date.toLocaleDateString("en-US", { weekday:"short", month:"short", day:"numeric" }),
              dateKey: utcDate,
              time: date.toLocaleTimeString("en-US", { hour:"numeric", minute:"2-digit", timeZoneName:"short" }),
              ts, _homeId, _awayId,
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

    const [atpRanks, wtaRanks, atp, wta] = await Promise.all([
      fetchRankings('atp'),
      fetchRankings('wta'),
      fetchTennisLeague('atp', 'ATP'),
      fetchTennisLeague('wta', 'WTA'),
    ]);

    // Annotate matches with player ranks now that ranking maps are available
    function annotateRanks(matches, rankMap) {
      return matches.map(m => {
        const hr = rankMap.get(m._homeId) ?? null;
        const ar = rankMap.get(m._awayId) ?? null;
        const { _homeId, _awayId, ...rest } = m;
        return { ...rest, homeRank: hr, awayRank: ar };
      });
    }
    atp.recent   = annotateRanks(atp.recent,   atpRanks);
    atp.upcoming = annotateRanks(atp.upcoming,  atpRanks);
    wta.recent   = annotateRanks(wta.recent,    wtaRanks);
    wta.upcoming = annotateRanks(wta.upcoming,  wtaRanks);

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
    // Fetch recent (past 14 days) and upcoming (next 4 days) separately.
    const [recentData, upcomingData] = await Promise.all([
      fetchESPN(`${BASE}/hockey/nhl/scoreboard?dates=${espnDate(-14)}-${espnDate(0)}&limit=200`),
      fetchESPN(`${BASE}/hockey/nhl/scoreboard?dates=${espnDate(1)}-${espnDate(4)}&limit=100`),
    ]);
    const recentEvents   = normalizeEvents(recentData,   "NHL");
    const upcomingEvents = normalizeEvents(upcomingData, "NHL");

    const recent   = recentEvents.filter(g => g.status === "final" && g.ts >= twoWeeksAgo).sort((a, b) => b.ts - a.ts);
    const upcoming = upcomingEvents.filter(g => g.status === "upcoming" && g.ts >= now).sort((a, b) => a.ts - b.ts).slice(0, 50);

    // Hard pre-filter: 3+ goal margin = Skip, no need for expensive timeline fetch
    const candidates = recent.filter(g => g.id && Math.abs(g.h - g.a) < 3).slice(0, 30);

    if (candidates.length === 0) return { recent, upcoming };

    const summaries = await Promise.all(
      candidates.map(g =>
        fetchESPNSummary(
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

  // ── WNBA TIMELINE ENRICHMENT ──────────────────────────────────────────
  // Mirrors NBA logic with thresholds scaled for WNBA scoring environment:
  // typical WNBA total ~160 vs NBA ~220 (ratio ~0.73). Margins use the same
  // rough proportional scaling. These thresholds are initial estimates and
  // should be tuned after collecting a week of real games.
  function categorizeWNBAByTimeline(summary, h, a) {
    const diff  = Math.abs(h - a);
    const total = h + a;

    const teams = summary.boxscore?.teams || [];
    let leadChanges = 0, largestLead = 0;
    for (const team of teams) {
      for (const stat of (team.statistics || [])) {
        if (stat.name === 'leadChanges') leadChanges = Math.max(leadChanges, parseInt(stat.displayValue) || 0);
        if (stat.name === 'largestLead') largestLead = Math.max(largestLead, parseInt(stat.displayValue) || 0);
      }
    }

    // Foul trouble: count players at 5 PF (managed minutes) and 6 PF (fouled out).
    // 5+ PF disrupts lineups even when coach keeps them in; foul-outs remove a player entirely.
    // Star performance: detect 30+, 40+ pt games and 20+ pt bench scorers.
    let fouledOut = 0, fiveFouls = 0;
    let topScorer = null;  // { name, pts }
    let benchStandout = null;  // { name, pts } — non-starter with 20+
    for (const teamBlock of (summary.boxscore?.players || [])) {
      const statsBlock = (teamBlock.statistics || [])[0];
      if (!statsBlock) continue;
      const pfIdx  = (statsBlock.keys || []).indexOf('fouls');
      const ptsIdx = (statsBlock.keys || []).indexOf('points');
      for (const ath of (statsBlock.athletes || [])) {
        if (ath.didNotPlay) continue;
        const s = ath.stats || [];
        if (!s.length) continue;
        if (pfIdx >= 0) {
          const pf = parseInt(s[pfIdx], 10) || 0;
          if (pf >= 6) fouledOut++;
          else if (pf === 5) fiveFouls++;
        }
        if (ptsIdx >= 0) {
          const pts = parseInt(s[ptsIdx], 10) || 0;
          const name = ath.athlete?.displayName || '';
          if (!topScorer || pts > topScorer.pts) topScorer = { name, pts };
          if (!ath.starter && pts >= 20 && (!benchStandout || pts > benchStandout.pts)) {
            benchStandout = { name, pts };
          }
        }
      }
    }

    // WNBA also plays 4 quarters then OT, so period > 4 means OT happened.
    const hasOT = (summary.header?.competitions?.[0]?.status?.period ?? 4) > 4;

    // Comeback: was down 8+ but won or kept it close (≤5 in WNBA vs ≤7 NBA)
    const hadComeback = largestLead >= 8 && diff <= 5;

    // Score Fest: 170+ total and close (≤5 margin)
    if (total >= 170 && diff <= 5) return { cat: 'scorefest', leadChanges, largestLead, hasOT, hadComeback, fouledOut, fiveFouls, topScorer, benchStandout };

    if (hasOT) return { cat: 'watchworthy', leadChanges, largestLead, hasOT, hadComeback, fouledOut, fiveFouls, topScorer, benchStandout };
    if (hadComeback) return { cat: 'watchworthy', leadChanges, largestLead, hasOT, hadComeback, fouledOut, fiveFouls, topScorer, benchStandout };
    if (leadChanges >= 8 && diff <= 5) return { cat: 'watchworthy', leadChanges, largestLead, hasOT, hadComeback, fouledOut, fiveFouls, topScorer, benchStandout };

    return { cat: null, leadChanges, largestLead, hasOT, hadComeback, fouledOut, fiveFouls, topScorer, benchStandout };
  }


  async function fetchNBAWithTimeline() {
    // Fetch recent (past 14 days) and upcoming (next 4 days) separately.
    // The recent fetch feeds timeline enrichment; the upcoming fetch surfaces
    // scheduled games for the "Coming Up This Week" section.
    const [recentData, upcomingData] = await Promise.all([
      fetchESPN(`${BASE}/basketball/nba/scoreboard?dates=${espnDate(-14)}-${espnDate(0)}&limit=200`),
      fetchESPN(`${BASE}/basketball/nba/scoreboard?dates=${espnDate(1)}-${espnDate(4)}&limit=100`),
    ]);
    const recentEvents   = normalizeEvents(recentData,   "NBA");
    const upcomingEvents = normalizeEvents(upcomingData, "NBA");

    const recent   = recentEvents.filter(g => g.status === "final" && g.ts >= twoWeeksAgo).sort((a, b) => b.ts - a.ts);
    const upcoming = upcomingEvents.filter(g => g.status === "upcoming" && g.ts >= now).sort((a, b) => a.ts - b.ts).slice(0, 50);

    // Analyze all games except clear blowouts — skip diff>=20
    const candidates = recent.filter(g => g.id && Math.abs(g.h - g.a) < 20).slice(0, 30);

    if (candidates.length === 0) return { recent, upcoming };

    const summaries = await Promise.all(
      candidates.map(g =>
        fetchESPNSummary(
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

  async function fetchWNBAWithTimeline() {
    // Fetch recent (past 14 days) and upcoming (next 4 days) separately.
    // The recent fetch feeds timeline enrichment; the upcoming fetch surfaces
    // scheduled games with broadcast info for the "Coming Up This Week"
    // section. Both go through normalizeEvents which extracts geoBroadcasts.
    const [recentData, upcomingData] = await Promise.all([
      fetchESPN(`${BASE}/basketball/wnba/scoreboard?dates=${espnDate(-14)}-${espnDate(0)}&limit=200`),
      fetchESPN(`${BASE}/basketball/wnba/scoreboard?dates=${espnDate(1)}-${espnDate(4)}&limit=100`),
    ]);
    const recentEvents   = normalizeEvents(recentData,   "WNBA");
    const upcomingEvents = normalizeEvents(upcomingData, "WNBA");

    const recent   = recentEvents.filter(g => g.status === "final" && g.ts >= twoWeeksAgo).sort((a, b) => b.ts - a.ts);
    const upcoming = upcomingEvents.filter(g => g.status === "upcoming" && g.ts >= now).sort((a, b) => a.ts - b.ts).slice(0, 50);

    // Skip clear blowouts in timeline enrichment. WNBA blowout threshold scaled
    // from NBA's 20: roughly 15. Saves API calls on games that won't tier up.
    const candidates = recent.filter(g => g.id && Math.abs(g.h - g.a) < 15).slice(0, 30);

    if (candidates.length === 0) return { recent, upcoming };

    const summaries = await Promise.all(
      candidates.map(g =>
        fetchESPNSummary(
          `https://site.web.api.espn.com/apis/site/v2/sports/basketball/wnba/summary?event=${g.id}&region=us&lang=en&contentorigin=espn`
        ).catch(() => null)
      )
    );

    const enrichedRecent = recent.map(g => {
      if (!g.id) return g;
      const idx = candidates.findIndex(c => c.id === g.id);
      if (idx === -1 || !summaries[idx]) return g;
      const result = categorizeWNBAByTimeline(summaries[idx], g.h, g.a);
      const hints = [];
      if (result.hadComeback) hints.push('comeback');
      if (result.hasOT)       hints.push('overtime');
      if (result.leadChanges >= 8) hints.push('back-and-forth');
      return {
        ...g,
        timelineCat: result.cat || undefined,
        dramaHints: hints,
        topScorer: result.topScorer || undefined,
        benchStandout: result.benchStandout || undefined,
        debug: {
          leadChanges: result.leadChanges,
          largestLead: result.largestLead,
          hasOT: result.hasOT,
          hadComeback: result.hadComeback,
          fouledOut: result.fouledOut,
          fiveFouls: result.fiveFouls,
          topScorer: result.topScorer ? `${result.topScorer.name} ${result.topScorer.pts}pt` : null,
          benchStandout: result.benchStandout ? `${result.benchStandout.name} ${result.benchStandout.pts}pt off bench` : null,
        }
      };
    });

    return { recent: enrichedRecent, upcoming };
  }

  // One score drives everything: category, ranking, Top Picks order.
  // Thresholds vary by sport — see per-sport mustWatch/watchable constants below (~line 1405).
  const SCORE_MUST_WATCH = 60; // ≥60 = Must Watch, 38-59 = Watchable, <38 = Skip
  const SCORE_WATCHABLE  = 38;

  function computeConfidence(g, sport) {
    const factors = [];
    let score = 0;

    const h = g.h ?? 0, a = g.a ?? 0;
    const diff  = Math.abs(h - a);
    const total = h + a;

    // Helper — dramaHints from any sport
    const hints = g.dramaHints || [];
    const hasComeback    = hints.some(h => h.toLowerCase().includes('comeback'));
    const hasLateDrama   = hints.some(h => h.toLowerCase().includes('late') || h.toLowerCase().includes('drama'));
    const hasBackForth   = hints.some(h => h.toLowerCase().includes('back') || h.toLowerCase().includes('lead'));
    const hasOT          = hints.some(h => h.toLowerCase().includes('overtime') || h.toLowerCase().includes('ot'));
    const hasLastOver    = hints.some(h => h.toLowerCase().includes('over'));
    const hasCloseChase  = hints.some(h => h.toLowerCase().includes('chase'));
    const hasHighScoring = hints.some(h => h.toLowerCase().includes('scoring'));

    if (sport === 'football') {
      if      (total >= 7) { factors.push({ label: `${total} goals`, points: 25 }); score += 25; }
      else if (total >= 5) { factors.push({ label: `${total} goals`, points: 18 }); score += 18; }
      else if (total >= 3) { factors.push({ label: `${total} goals`, points: 12 }); score += 12; }
      else if (total <= 1) { factors.push({ label: 'Very low scoring', points: -12 }); score -= 12; }
      if      (diff === 0) { factors.push({ label: 'Draw', points: 13 }); score += 13; }
      else if (diff === 1) { factors.push({ label: '1 goal margin', points: 16 }); score += 16; }
      else if (diff === 2) { factors.push({ label: '2 goal margin', points: 5  }); score += 5;  }
      else                 { factors.push({ label: 'Large margin', points: -40 }); score -= 40; }
      if (hasComeback)  { factors.push({ label: '⚡ Comeback', points: 25 }); score += 25; }
      if (hasLateDrama && !g.lateGoal) { factors.push({ label: '⚡ Late drama', points: 18 }); score += 18; }
      if (hasBackForth) { factors.push({ label: '⚡ Back & forth', points: 18 }); score += 18; }

      // Red cards — from scoreboard details (all games) or summary keyEvents
      const reds = g.redCards || 0;
      if (reds > 0) {
        const pts = reds >= 2 ? 12 : 6;
        factors.push({ label: reds >= 2 ? `${reds} red cards` : 'Red card', points: pts });
        score += pts;
      }

      // Late goal (80'+) in a close game — huge drama signal
      if (g.lateGoal && diff <= 2) {
        const pts = g.ninetyGoal ? 18 : 12;
        factors.push({ label: g.ninetyGoal ? '⚡ 90th min goal' : '⚡ Late goal', points: pts });
        score += pts;
      }

      // Penalty shootout — maximum drama, game was tied after 90'
      if (g.penaltyShootout) {
        factors.push({ label: '⚡ Penalty shootout', points: 40 });
        score += 40;
      }

      const leagueTier = { 'Champions League': 1, 'Premier League': 1, 'La Liga': 2, 'Bundesliga': 2, 'Serie A': 2 };
      const tier = leagueTier[g.league];
      if      (tier === 1) { factors.push({ label: g.league, points: 6 }); score += 6; }
      else if (tier === 2) { factors.push({ label: g.league, points: 3 }); score += 3; }

    } else if (sport === 'nhl') {
      if      (total >= 8) { factors.push({ label: `${total} goals`, points: 25 }); score += 25; }
      else if (total >= 6) { factors.push({ label: `${total} goals`, points: 15 }); score += 15; }
      else if (total >= 4) { factors.push({ label: `${total} goals`, points: 8  }); score += 8;  }
      else if (total <= 2) { factors.push({ label: 'Low scoring', points: -10 }); score -= 10; }
      if      (diff === 0) { factors.push({ label: 'Tied/OT', points: 20 }); score += 20; }
      else if (diff === 1) { factors.push({ label: '1 goal margin', points: 25 }); score += 25; }
      else if (diff === 2) { factors.push({ label: '2 goal margin', points: 10 }); score += 10; }
      else                 { factors.push({ label: 'Large margin', points: -40 }); score -= 40; }
      if (hasOT) {
        const otPeriods = Math.max(1, (g.period ?? 4) - 3);
        const otPts = otPeriods >= 2 ? 35 : 25;
        const otLabel = otPeriods >= 2 ? '⚡ Exciting overtime' : '⚡ Overtime';
        factors.push({ label: otLabel, points: otPts }); score += otPts;
      }
      if (hasComeback)  { factors.push({ label: '⚡ Comeback', points: 22 }); score += 22; }
      if (hasBackForth) { factors.push({ label: '⚡ Back & forth', points: 18 }); score += 18; }
      if (hasLateDrama) { factors.push({ label: '⚡ Late drama', points: 18 }); score += 18; }
      const lc = g.debug?.leadChanges ?? 0;
      if (lc >= 2 && !hasBackForth) { factors.push({ label: `${lc} lead changes`, points: 12 }); score += 12; }

    } else if (sport === 'nba') {
      if      (total >= 230) { factors.push({ label: `${total} pts`, points: 15 }); score += 15; }
      else if (total >= 210) { factors.push({ label: `${total} pts`, points: 8  }); score += 8;  }
      if      (diff <= 5)  { factors.push({ label: `${diff} pt margin`, points: 25 }); score += 25; }
      else if (diff <= 10) { factors.push({ label: `${diff} pt margin`, points: 15 }); score += 15; }
      else if (diff >= 20) { factors.push({ label: 'Blowout margin', points: -40 }); score -= 40; }
      else if (diff >= 12) { factors.push({ label: 'Large margin', points: -10 }); score -= 10; }
      if (hasOT || (g.period ?? 4) > 4) {
        const otPeriods = Math.max(1, (g.period ?? 5) - 4);
        const otPts = otPeriods >= 2 ? 30 : 20;
        const otLabel = otPeriods >= 2 ? '⚡ Exciting overtime' : '⚡ Overtime';
        factors.push({ label: otLabel, points: otPts }); score += otPts;
      }
      if (hasComeback) { factors.push({ label: '⚡ Comeback', points: 20 }); score += 20; }
      const lc = g.debug?.leadChanges ?? 0;
      if      (lc >= 15) { factors.push({ label: `${lc} lead changes`, points: 25 }); score += 25; }
      else if (lc >= 8)  { factors.push({ label: `${lc} lead changes`, points: 12 }); score += 12; }

    } else if (sport === 'wnba') {
      // WNBA scoring profile: typical total ~160 (vs NBA ~220), margins
      // proportionally tighter. Thresholds scaled ~0.73x from NBA's.
      // Initial v1 estimates — to be tuned after 1-2 weeks of real games.
      if      (total >= 170) { factors.push({ label: `${total} pts`, points: 15 }); score += 15; }
      else if (total >= 155) { factors.push({ label: `${total} pts`, points: 8  }); score += 8;  }
      if      (diff <= 3)  { factors.push({ label: `${diff} pt margin`, points: 25 }); score += 25; }
      else if (diff <= 7)  { factors.push({ label: `${diff} pt margin`, points: 15 }); score += 15; }
      else if (diff >= 15) { factors.push({ label: 'Blowout margin', points: -40 }); score -= 40; }
      else if (diff >= 9)  { factors.push({ label: 'Large margin', points: -10 }); score -= 10; }
      if (hasOT || (g.period ?? 4) > 4) {
        const otPeriods = Math.max(1, (g.period ?? 5) - 4);
        const otPts = otPeriods >= 2 ? 30 : 20;
        const otLabel = otPeriods >= 2 ? '⚡ Exciting overtime' : '⚡ Overtime';
        factors.push({ label: otLabel, points: otPts }); score += otPts;
      }
      if (hasComeback) { factors.push({ label: '⚡ Comeback', points: 20 }); score += 20; }
      const lc = g.debug?.leadChanges ?? 0;
      if      (lc >= 12) { factors.push({ label: `${lc} lead changes`, points: 25 }); score += 25; }
      else if (lc >= 6)  { factors.push({ label: `${lc} lead changes`, points: 12 }); score += 12; }

      // Foul trouble penalty. 6 PF (fouled out) costs -5, 5 PF (managed minutes) -3.
      // Folded into a single "Foul trouble" line for spoiler safety — no player names,
      // no per-team breakdown. v1 weights from N=14 sample; tune after host review.
      const fouledOut = g.debug?.fouledOut ?? 0;
      const fiveFouls = g.debug?.fiveFouls ?? 0;
      const foulPenalty = fouledOut * 5 + fiveFouls * 3;
      if (foulPenalty > 0) {
        factors.push({ label: 'Foul trouble', points: -foulPenalty });
        score -= foulPenalty;
      }

      // Star performance: 30+ pt game is notable, 40+ is exceptional.
      // Use spoiler-safe phrasing — no player names in the factor label,
      // since names would reveal which team had the standout.
      const topPts = g.topScorer?.pts ?? 0;
      if (topPts >= 40) {
        factors.push({ label: '⭐ Standout 40+ pt game', points: 15 });
        score += 15;
      } else if (topPts >= 30) {
        factors.push({ label: '⭐ Standout 30+ pt game', points: 8 });
        score += 8;
      }
      // Bench scorer 20+ — uncommon and a great storyline.
      const benchPts = g.benchStandout?.pts ?? 0;
      if (benchPts >= 20) {
        factors.push({ label: '⭐ Bench scorer 20+', points: 8 });
        score += 8;
      }

    } else if (sport === 'tennis') {
      const sets = (g.homeSets ?? 0) + (g.awaySets ?? 0);
      if      (sets >= 5) { factors.push({ label: '5-set epic', points: 50 }); score += 50; }
      else if (sets >= 3) { factors.push({ label: '3-set match', points: 25 }); score += 25; }
      else                { factors.push({ label: 'Straight sets', points: -10 }); score -= 10; }

      const hasTiebreak = (g.sets || []).some(s => s.h === 7 || s.a === 7);
      const closeSets = (g.sets || []).filter(s => Math.abs(s.h - s.a) <= 2).length;

      // Cap stacking — tiebreak + close sets together give +20 not +35
      if (hasTiebreak && closeSets >= 2) {
        factors.push({ label: 'Tiebreak + close sets', points: 20 }); score += 20;
      } else if (hasTiebreak) {
        factors.push({ label: 'Tiebreak(s)', points: 15 }); score += 15;
      } else if (closeSets >= 2) {
        factors.push({ label: `${closeSets} close sets`, points: 12 }); score += 12;
      }

      const hasBagel = (g.sets || []).some(s => s.h === 0 || s.a === 0);
      if (hasBagel) { factors.push({ label: 'Bagel set', points: -15 }); score -= 15; }

      // Player rank bonus — top 20 ATP/WTA players add star power.
      // Bonus = 10.5 - rank*0.5: rank 1 → +10, rank 10 → +5.5, rank 20 → +0.5
      // Both players' bonuses stack — Sinner vs Alcaraz adds ~+19.5.
      const calcRankBonus = r => (!r || r > 20) ? 0 : parseFloat((10.5 - r * 0.5).toFixed(1));
      const hrBonus = calcRankBonus(g.homeRank);
      const arBonus = calcRankBonus(g.awayRank);
      const totalRankBonus = Math.round((hrBonus + arBonus) * 10) / 10;
      if (totalRankBonus > 0) {
        const label = (g.homeRank && g.homeRank <= 20 && g.awayRank && g.awayRank <= 20)
          ? `#${g.homeRank} vs #${g.awayRank}`
          : (g.homeRank && g.homeRank <= 20) ? `#${g.homeRank} ranked` : `#${g.awayRank} ranked`;
        factors.push({ label, points: totalRankBonus });
        score += totalRankBonus;
      }

    } else if (sport === 'cricket') {
      if (g.maxInnings >= 200) { factors.push({ label: `${g.maxInnings} run innings`, points: 25 }); score += 25; }
      if (g.resultType === 'wickets') {
        if      (g.resultMargin <= 2) { factors.push({ label: `Won by ${g.resultMargin} wkts`, points: 45 }); score += 45; }
        else if (g.resultMargin <= 4) { factors.push({ label: `Won by ${g.resultMargin} wkts`, points: 35 }); score += 35; }
        else if (g.resultMargin <= 6) { factors.push({ label: `Won by ${g.resultMargin} wkts`, points: 20 }); score += 20; }
        else if (g.resultMargin >= 8) { factors.push({ label: `Comfortable win`, points: -20 }); score -= 20; }
      } else if (g.resultType === 'runs') {
        if      (g.resultMargin <= 10) { factors.push({ label: `Won by ${g.resultMargin} runs`, points: 40 }); score += 40; }
        else if (g.resultMargin <= 20) { factors.push({ label: `Won by ${g.resultMargin} runs`, points: 25 }); score += 25; }
        else if (g.resultMargin <= 35) { factors.push({ label: `Won by ${g.resultMargin} runs`, points: 10 }); score += 10; }
        else                           { factors.push({ label: 'Large margin', points: -20 }); score -= 20; }
      }
      if (hasLastOver)    { factors.push({ label: '⚡ Last over finish', points: 20 }); score += 20; }
      if (hasCloseChase)  { factors.push({ label: '⚡ Close chase', points: 15 }); score += 15; }
      if (hasHighScoring) { factors.push({ label: '⚡ High scoring', points: 12 }); score += 12; }

    } else if (sport === 'mlb') {
      if      (total >= 12) { factors.push({ label: `${total} runs`, points: 25 }); score += 25; }
      else if (total >= 8)  { factors.push({ label: `${total} runs`, points: 12 }); score += 12; }
      else if (total <= 3)  { factors.push({ label: 'Low scoring', points: -15 }); score -= 15; }
      if      (diff === 0 || diff === 1) { factors.push({ label: `${diff === 0 ? 'Tie' : '1 run margin'}`, points: 35 }); score += 35; }
      else if (diff === 2)               { factors.push({ label: '2 run margin', points: 18 }); score += 18; }
      else if (diff >= 5)                { factors.push({ label: 'Large margin', points: -40 }); score -= 40; }
      if (g.period > 9) { factors.push({ label: `Extra innings (${g.period})`, points: 20 }); score += 20; }

      // Linescore-derived drama signals
      const lc = g.debug?.leadChanges ?? 0;
      if      (lc >= 4) { factors.push({ label: `${lc} lead changes`, points: 20 }); score += 20; }
      else if (lc >= 2) { factors.push({ label: `${lc} lead changes`, points: 10 }); score += 10; }
      if (g.debug?.hadComeback)  { factors.push({ label: '⚡ Comeback', points: 18 }); score += 18; }
      if (g.debug?.walkOff)      { factors.push({ label: '⚡ Walk-off', points: 15 }); score += 15; }

    } else if (sport === 'nfl') {
      if      (diff <= 3)  { factors.push({ label: `${diff} pt margin`, points: 30 }); score += 30; }
      else if (diff <= 7)  { factors.push({ label: `${diff} pt margin`, points: 20 }); score += 20; }
      else if (diff >= 17) { factors.push({ label: 'Blowout', points: -40 }); score -= 40; }
      if      (total >= 50) { factors.push({ label: `${total} pts`, points: 20 }); score += 20; }
      else if (total <= 20) { factors.push({ label: 'Low scoring', points: -10 }); score -= 10; }

    } else if (sport === 'darts') {
      // Darts has variable formats: Premier League is best-of-11 (first to 6),
      // World Matchplay R1 is first-to-10, finals can go to 18+, etc. Score
      // margins must be evaluated relative to the format. We use g.debug.firstTo
      // when present (set by the parser); fall back to inferring from total legs.
      const winner = Math.max(h, a);
      const loser  = Math.min(h, a);
      const margin = Math.abs(h - a);
      const firstTo = g.debug?.firstTo || Math.max(winner, 6);

      // Define non-overlapping margin bands:
      //   decider:  match went to the brink (loser was one leg from winning, or tiebreaker fired)
      //   close:    margin within ~15% of firstTo (e.g. 1-2 in PL, 2-3 in Matchplay R1)
      //   medium:   margin between close and blowout
      //   blowout:  margin >= 50% of firstTo (e.g. 3+ in PL, 5+ in Matchplay R1)
      const closeMargin   = Math.max(2, Math.round(firstTo * 0.15));
      const blowoutMargin = Math.max(3, Math.round(firstTo * 0.5));
      const wentToDecider = (loser === firstTo - 1) || (winner > firstTo);
      const wasClose      = !wentToDecider && margin <= closeMargin;
      const wasBlowout    = margin >= blowoutMargin;
      const wasMedium     = !wentToDecider && !wasClose && !wasBlowout;
      const wasWhitewash  = loser === 0;

      if (wentToDecider) {
        factors.push({ label: 'Deciding leg', points: 35 }); score += 35;
      } else if (wasClose) {
        factors.push({ label: 'Close match',  points: 25 }); score += 25;
      } else if (wasMedium) {
        factors.push({ label: 'Competitive',  points: 8  }); score += 8;
      } else if (wasBlowout) {
        factors.push({ label: 'Lopsided',     points: -25 }); score -= 25;
      }
      if (wasWhitewash) { factors.push({ label: 'Whitewash', points: -15 }); score -= 15; }

      const av1 = g.debug?.avg1, av2 = g.debug?.avg2;
      if (av1 != null && av2 != null) {
        if (av1 >= 100 && av2 >= 100)      { factors.push({ label: 'Both 100+ avg',    points: 20 }); score += 20; }
        else if (av1 >= 100 || av2 >= 100) { factors.push({ label: 'One 100+ avg',     points: 8  }); score += 8;  }
        if (av1 < 90 && av2 < 90)          { factors.push({ label: 'Both sub-90 avg',  points: -10 }); score -= 10; }
      }

      const round = g.debug?.round;
      if (round === 'QF') { factors.push({ label: 'Quarter-final', points: 5  }); score += 5;  }
      if (round === 'SF') { factors.push({ label: 'Semi-final',    points: 8  }); score += 8;  }
      if (round === 'F')  { factors.push({ label: 'Final',         points: 12 }); score += 12; }

      if (g.debug?.nineDart) { factors.push({ label: '⚡ 9-darter on night', points: 8 }); score += 8; }
    }

        // Recency bonus (small)
    const daysAgo = (Date.now() - (g.ts ?? 0)) / 86400000;
    if      (daysAgo <= 1) { factors.push({ label: 'Today', points: 5 }); score += 5; }
    else if (daysAgo <= 3) { factors.push({ label: 'Last 3 days', points: 3 }); score += 3; }

    const finalScore = Math.max(0, Math.min(100, Math.round(score)));

    // Sport-specific thresholds — different sports have different score ranges
    const mustWatch = sport === 'football' ? 55
                    : sport === 'nhl'      ? 48
                    : sport === 'nba'      ? 65
                    : sport === 'wnba'     ? 65
                    : sport === 'cricket'  ? 43
                    : sport === 'mlb'      ? 50
                    : sport === 'tennis'   ? 58
                    : sport === 'darts'    ? 50
                    : 60;
    const watchable = sport === 'football' ? 33
                    : sport === 'nhl'      ? 30
                    : sport === 'nba'      ? 28
                    : sport === 'wnba'     ? 28
                    : sport === 'cricket'  ? 22
                    : sport === 'mlb'      ? 28
                    : sport === 'tennis'   ? 35
                    : sport === 'darts'    ? 25
                    : 38;

    // Derive category from score
    let cls;
    if (finalScore >= mustWatch) {
      cls = 'watchworthy';
    } else if (finalScore >= watchable) {
      cls = 'watchable';
    } else {
      const isLargeMargin = (g.h != null && g.a != null && Math.abs(g.h - g.a) >= 3) ||
                            (g.resultType === 'wickets' && g.resultMargin >= 7) ||
                            (g.resultType === 'runs' && g.resultMargin >= 40);
      cls = isLargeMargin ? 'blowout' : 'defensive';
    }

    return { score: finalScore, factors, cls };
  }

  // Attach confidence + derived category to all games
  // ── MLB LINESCORE ENRICHMENT ──────────────────────────────────────────
  // Derives drama signals from inning-by-inning scores.
  // Called after normalizeEvents, before attachConfidence.
  function enrichMLB(games) {
    return games.map(g => {
      const hl = g.homeLinescores || [];
      const al = g.awayLinescores || [];
      if (!hl.length && !al.length) return g;

      // Build cumulative score per inning
      let hCum = 0, aCum = 0;
      let leadChanges = 0;
      let maxDeficit = 0;       // max deficit the winning team overcame
      let prevLead = 0;         // positive = home leading, negative = away leading
      const winner = g.h > g.a ? 'home' : 'away';

      const innings = Math.max(hl.length, al.length);
      for (let i = 0; i < innings; i++) {
        hCum += hl[i] ?? 0;
        aCum += al[i] ?? 0;
        const lead = hCum - aCum;
        // Lead change: sign flipped (excluding ties as non-changes)
        if (prevLead !== 0 && lead !== 0 && Math.sign(lead) !== Math.sign(prevLead)) {
          leadChanges++;
        }
        // Track max deficit for the eventual winner
        if (winner === 'home' && lead < 0) maxDeficit = Math.max(maxDeficit, -lead);
        if (winner === 'away' && lead > 0) maxDeficit = Math.max(maxDeficit, lead);
        if (lead !== 0) prevLead = lead;
      }

      const hadComeback = maxDeficit >= 3;

      // Walk-off: home team scores in the final inning to win
      // Home team wins and scored in their last at-bat
      const lastHomeInning = hl[hl.length - 1] ?? 0;
      const walkOff = g.h > g.a && lastHomeInning > 0 && hl.length >= 9;

      return {
        ...g,
        debug: {
          ...(g.debug || {}),
          leadChanges,
          maxDeficit,
          hadComeback,
          walkOff,
        },
      };
    });
  }

  function attachConfidence(games, sport) {
    return games.map(g => {
      const confidence = computeConfidence(g, sport);
      return { ...g, confidence };
    });
  }

  // Attach a `watch` field { name, url } to games good enough to recommend
  // (watchworthy, scorefest, or watchable) where we have a provider mapping
  // for the given country. Lower-quality classes (defensive, blowout) get no
  // button — those aren't recommendations.
  //
  // The frontend decides whether to actually render the button. Currently:
  // - Top Picks bar: renders button on every pick (Must Watch + Watchable)
  // - Main game grid: renders only on Must Watch (avoids visual noise)
  // The backend just needs to make sure `g.watch` is present whenever the
  // frontend MIGHT want it.
  function attachWatchToGames(games, country) {
    const SHOW_WATCH = new Set(['watchworthy', 'scorefest', 'watchable']);
    return games.map(g => {
      // Strip any pre-existing watch field (defensive — shouldn't be there
      // for country-aware leagues, but a stale one would survive otherwise).
      const { watch: _drop, ...rest } = g;
      if (!SHOW_WATCH.has(g.confidence?.cls)) return rest;
      const provider = lookupProvider(g.league, country);
      return provider ? { ...rest, watch: provider } : rest;
    });
  }

  // Walk the response body and attach watch to each sport's recent games.
  // Used both on cache-serve (so the shared blob stays country-neutral) and
  // after a live fetch.
  function attachWatchToBody(data, country) {
    const out = {};
    for (const [key, val] of Object.entries(data)) {
      if (val && Array.isArray(val.recent)) {
        out[key] = { ...val, recent: attachWatchToGames(val.recent, country) };
      } else {
        out[key] = val;
      }
    }
    return out;
  }

  // Route to the appropriate fetcher. These attach confidence only — the
  // watch field is added per-request later because country-aware providers
  // can't be baked into a shared blob.
  const SPORT_FETCHERS = {
    football: async () => { const r = await fetchAllSoccer();        return { soccer:  { ...r, recent: attachConfidence(r.recent,  'football') } }; },
    nhl:      async () => { const r = await fetchNHLWithTimeline();   return { nhl:     { ...r, recent: attachConfidence(r.recent,  'nhl')      } }; },
    mlb:      async () => { const r = await fetchSport(`${BASE}/baseball/mlb/scoreboard`, "MLB", 15); const enriched = enrichMLB(r.recent); return { mlb: { ...r, recent: attachConfidence(enriched, 'mlb') } }; },
    nba:      async () => { const r = await fetchNBAWithTimeline();   return { nba:     { ...r, recent: attachConfidence(r.recent,  'nba')      } }; },
    wnba:     async () => { const r = await fetchWNBAWithTimeline();  return { wnba:    { ...r, recent: attachConfidence(r.recent,  'wnba')     } }; },
    nfl:      async () => { const r = await fetchSport(`${BASE}/football/nfl/scoreboard`, "NFL");     return { nfl: { ...r, recent: attachConfidence(r.recent, 'nfl') } }; },
    cricket:  async () => { const r = await fetchCricket();           return { cricket: { ...r, recent: attachConfidence(r.recent,  'cricket')  } }; },
    tennis:   async () => { const r = await fetchTennis();            return { tennis:  { ...r, recent: attachConfidence(r.recent,  'tennis')   } }; },
    darts:    async () => { const r = await fetchDarts();             return { darts:   { ...r, recent: attachConfidence(r.recent,  'darts')    } }; },
  };

  let body;
  let fetchedAt = Date.now();

  if (sportParam === 'all' || !SPORT_FETCHERS[sportParam]) {
    const [soccer, nhl, mlb, nba, wnba, nfl, cricket, tennis, darts] = await Promise.all([
      fetchAllSoccer(),
      fetchNHLWithTimeline(),
      fetchSport(`${BASE}/baseball/mlb/scoreboard`,   "MLB", 15),
      fetchNBAWithTimeline(),
      fetchWNBAWithTimeline(),
      fetchSport(`${BASE}/football/nfl/scoreboard`,   "NFL"),
      fetchCricket(),
      fetchTennis(),
      fetchDarts(),
    ]);
    body = {
      soccer:  { ...soccer,  recent: attachConfidence(soccer.recent,  'football') },
      nhl:     { ...nhl,     recent: attachConfidence(nhl.recent,     'nhl')      },
      mlb:     { ...mlb,     recent: attachConfidence(enrichMLB(mlb.recent),     'mlb')      },
      nba:     { ...nba,     recent: attachConfidence(nba.recent,     'nba')      },
      wnba:    { ...wnba,    recent: attachConfidence(wnba.recent,    'wnba')     },
      nfl:     { ...nfl,     recent: attachConfidence(nfl.recent,     'nfl')      },
      cricket: { ...cricket, recent: attachConfidence(cricket.recent, 'cricket')  },
      tennis:  { ...tennis,  recent: attachConfidence(tennis.recent,  'tennis')   },
      darts:   { ...darts,   recent: attachConfidence(darts.recent,   'darts')    },
    };

    // Save full fetch to blob for future requests — note we save BEFORE
    // attaching watch, so the blob stays country-neutral and can be served
    // to users in any region with their own watch links applied per-request.
    fetchedAt = Date.now();
    try {
      const store = getStore('scores');
      await store.setJSON('latest', { data: body, fetchedAt, fetchedAtISO: new Date(fetchedAt).toISOString() });
      console.log('get-scores: blob written at', new Date(fetchedAt).toISOString());
    } catch (err) {
      console.error('Failed to save to blob:', err.message);
    }
  } else {
    body = await SPORT_FETCHERS[sportParam]();
  }

  // Final pass — attach watch links for the user's country. Skipped on
  // internal scheduler calls so the blob we just wrote stays country-neutral.
  const finalBody = isInternal ? body : attachWatchToBody(body, userCountry);

  return {
    statusCode: 200,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "public, max-age=60",
      "X-Cache": "MISS",
      "X-Fetched-At": new Date(fetchedAt || Date.now()).toISOString(),
    },
    body: JSON.stringify({ ...finalBody, _meta: { userCountry, fetchedAt } }),
  };
};
