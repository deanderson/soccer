// netlify/functions/enrich-reddit.js
// Daily cron at 5pm ET (21:00 UTC) — enriches CS2 matches in the blob
// with Reddit post-match thread data from Arctic Shift (free, no auth).
//
// Per match, stores:
//   redditData: {
//     found: bool,
//     upvotes: number,
//     comments: number,
//     mapScores: [{ map, winner, loser }],       // e.g. { map:'Dust2', winner:13, loser:8 }
//     playerRatings: [{ name, team, rating }],   // overall rating per player
//     checkedAt: timestamp,
//   }
//
// Matches already having redditData are skipped (enriched once, stored permanently).
// Matches without a Reddit thread get redditData: { found: false, checkedAt }
// so we don't retry them on future runs.

const { connectLambda, getStore } = require('@netlify/blobs');

const ARCTIC_SHIFT_BASE = 'https://arctic-shift.photon-reddit.com/api/posts/search';
const SUBREDDIT = 'GlobalOffensive';

exports.handler = async function (event, context) {
  connectLambda(event);

  const store = getStore('scores');

  // Read current blob
  let cached;
  try {
    cached = await store.get('latest', { type: 'json' });
  } catch (err) {
    return respond(500, { error: 'Failed to read blob', detail: err.message });
  }

  if (!cached?.data?.cs2?.recent) {
    return respond(200, { message: 'No CS2 data in blob, nothing to enrich' });
  }

  const matches = cached.data.cs2.recent;

  // ?reset=1 clears existing redditData so all matches get re-enriched
  const isReset = event.queryStringParameters?.reset === '1';
  if (isReset) {
    matches.forEach(m => { delete m.redditData; });
    console.log('enrich-reddit: reset=1, cleared all redditData');
  }

  // Only enrich matches from last 3 days — older matches are stable and
  // the daily cron keeps recent ones current. Full backfill via reset=1
  // if needed but time-boxed per run.
  const threeDaysAgo = Date.now() - 3 * 24 * 60 * 60 * 1000;

  const toEnrich = matches.filter(m =>
    m.status === 'finished' &&
    !m.redditData &&
    (m.ts || 0) >= threeDaysAgo
  );

  if (toEnrich.length === 0) {
    return respond(200, { message: 'All recent CS2 matches enriched', total: matches.length });
  }

  // Time-budgeted loop — keep enriching until 20s elapsed (safe under 26s limit)
  // Failsafe: never process more than 30 matches per run regardless of time
  const TIME_BUDGET_MS = 20000;
  const MAX_PER_RUN = 30;
  const startTime = Date.now();

  console.log(`enrich-reddit: ${toEnrich.length} recent matches pending`);

  const results = [];

  for (const match of toEnrich) {
    if (results.length >= MAX_PER_RUN) break;
    if (Date.now() - startTime > TIME_BUDGET_MS) {
      console.log(`enrich-reddit: time budget reached after ${results.length} matches`);
      break;
    }
    // Build search query using normalized team names
    // Posts use "TeamA vs TeamB / IEM..." format, not "match thread"
    // Some teams are abbreviated in titles (BetBoom Team → BB, etc.)
    const homeNorm = normalizeTeamName(match.home);
    const awayNorm = normalizeTeamName(match.away);
    const query = `${homeNorm} ${awayNorm}`;

    let redditData;
    try {
      redditData = await searchReddit(query, match, homeNorm, awayNorm);
    } catch (err) {
      console.warn(`enrich-reddit: search failed for ${match.id}:`, err.message);
      redditData = { found: false, checkedAt: Date.now(), error: err.message };
    }

    match.redditData = redditData;
    results.push({ id: match.id, home: match.home, away: match.away, found: redditData.found });

    // Small delay between requests to be polite to Arctic Shift
    await sleep(300);
  }

  // Write enriched blob back
  try {
    await store.setJSON('latest', {
      data: cached.data,
      fetchedAt: cached.fetchedAt,
      fetchedAtISO: cached.fetchedAtISO,
      enrichedAt: Date.now(),
    });
    console.log('enrich-reddit: blob written with Reddit data');
  } catch (err) {
    return respond(500, { error: 'Failed to write enriched blob', detail: err.message });
  }

  const elapsed = Date.now() - startTime;
  const stillPending = toEnrich.length - results.length;

  return respond(200, {
    enriched: results.length,
    deferred: stillPending,
    runAgain: stillPending > 0,
    elapsedMs: elapsed,
    hint: stillPending > 0 ? 'Hit enrich-reddit (no reset) to continue' : undefined,
    results,
  });
};

// ── Arctic Shift search + parse ──────────────────────────────────────────────

function normalizeTeamName(name) {
  const abbrevs = {
    'betboom team': 'BB', 'betboom': 'BB',
    'natus vincere': 'Natus Vincere',
    'fut esports': 'FUT',
    'team falcons': 'Falcons',
    'team spirit': 'Spirit',
    'team vitality': 'Vitality',
  };
  return abbrevs[name.toLowerCase()] || name.replace(/\s+(esports|gaming|team)$/i, '').trim();
}

async function searchReddit(query, match, homeNorm, awayNorm) {
  // Strategy: search broadly by tournament/league name, then score candidates
  // by how well they match our teams. This avoids brittle exact-name matching.

  // Build candidate queries from most to least specific
  const queries = [
    // Try normalized team names first
    `${homeNorm} ${awayNorm}`,
    // Try just home team with tournament context
    `${homeNorm} ${match.league || ''}`.trim(),
    // Try just away team with tournament context
    `${awayNorm} ${match.league || ''}`.trim(),
    // Broad tournament search (for bot posts)
    match.league || query,
  ].filter((q, i, arr) => q && arr.indexOf(q) === i); // dedupe

  let bestPost = null;
  let bestScore = 0;

  for (const q of queries) {
    const url = new URL(ARCTIC_SHIFT_BASE);
    url.searchParams.set('subreddit', SUBREDDIT);
    url.searchParams.set('title', q);
    url.searchParams.set('limit', '10');

    let posts = [];
    try {
      const res = await fetch(url.toString(), {
        headers: { 'User-Agent': 'spoilerfreescores/1.0' },
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) continue;
      const json = await res.json();
      posts = json.data || [];
    } catch (e) { continue; }

    // Score each post by how well it matches our match
    for (const post of posts) {
      const title = (post.title || '').toLowerCase();
      const isBot = post.author === 'CS2_PostMatchThreads';
      const isPostMatch = title.includes('post-match') || title.includes('post match');
      if (!isPostMatch && !isBot) continue;

      let score = 0;

      // Strong signals
      if (isBot) score += 10;
      if (isPostMatch) score += 5;

      // Team name matching — check all variants
      const homeVariants = [homeNorm, match.home, match.home.replace(/\s+(esports|gaming|team)$/i,'')].map(s => s.toLowerCase());
      const awayVariants = [awayNorm, match.away, match.away.replace(/\s+(esports|gaming|team)$/i,'')].map(s => s.toLowerCase());

      const homeMatch = homeVariants.some(v => v && title.includes(v));
      const awayMatch = awayVariants.some(v => v && title.includes(v));

      if (homeMatch) score += 8;
      if (awayMatch) score += 8;
      if (homeMatch && awayMatch) score += 5; // both teams = very confident

      // Must have at least one team or be very clearly a post-match thread
      if (!homeMatch && !awayMatch) continue;

      if (score > bestScore) {
        bestScore = score;
        bestPost = post;
      }
    }

    // If we found a confident match (both teams), stop searching
    if (bestScore >= 26) break;
  }

  if (!bestPost) {
    return { found: false, checkedAt: Date.now() };
  }

  const post = bestPost;

  const body = post.selftext || '';

  // Extract HLTV match URL — always in the post header as the series score link
  const hltvMatch = body.match(/https:\/\/www\.hltv\.org\/matches\/(\d+)\/[\w-]+/);
  const hltvUrl = hltvMatch ? hltvMatch[0] : null;

  const mapScores     = parseMapScores(body);
  const playerRatings = parsePlayerRatings(body);
  const elimination   = parseElimination(body);
  const highlightStats = parseHighlights(body);

  // Parse quality flags — helps detect format changes on the dev dashboard
  const expectedMaps = (body.match(/## Map \d+:/g) || []).length;
  const parseQuality = {
    mapsExpected:  expectedMaps,
    mapsParsed:    mapScores.length,
    playersParsed: playerRatings.length,
    mapsOk:        expectedMaps === 0 || mapScores.length === expectedMaps,
    playersOk:     playerRatings.length >= 6,
  };

  return {
    found: true,
    postId: post.id,
    hltvUrl,
    upvotes: post.ups || post.score || 0,
    upvoteRatio: post.upvote_ratio || null,
    comments: post.num_comments || 0,
    mapScores,
    playerRatings,
    elimination,
    highlights: highlightStats,
    parseQuality,
    checkedAt: Date.now(),
  };
}

// ── Parser: elimination / advancement ───────────────────────────────────────
function parseElimination(body) {
  const advances  = [];
  const eliminated = [];
  for (const m of body.matchAll(/\*\*([^*]+)\*\*/g)) {
    const text = m[1].trim();
    if (/advances?|qualif/i.test(text)) advances.push(text);
    if (/eliminat/i.test(text))          eliminated.push(text);
  }
  return {
    isKnockout:  advances.length > 0 || eliminated.length > 0,
    advances,
    eliminated,
  };
}

// ── Parser: highlights ────────────────────────────────────────────────────────
function parseHighlights(body) {
  const highlights = [];
  const pattern = /M(\d+)R(\d+)\s*\|\s*(\w+)\s*-\s*([^\]]+)/g;
  let m;
  while ((m = pattern.exec(body)) !== null) {
    const desc = m[4].trim().toLowerCase();
    highlights.push({
      map:    parseInt(m[1], 10),
      round:  parseInt(m[2], 10),
      player: m[3],
      desc:   m[4].trim(),
      isAce:     desc.includes('ace'),
      isClutch:  desc.includes('clutch'),
      isMulti:   /[4-5]\s*kill/i.test(desc),
    });
  }
  return {
    present:  highlights.length > 0,
    count:    highlights.length,
    aces:     highlights.filter(h => h.isAce).length,
    clutches: highlights.filter(h => h.isClutch).length,
    items:    highlights,
  };
}

// ── Parser: map scores ────────────────────────────────────────────────────────
// Matches lines like:  **Dust2:** 13-8   or   **Overpass:** 6-13
// Also handles:        Ancient: 13-7
function parseMapScores(body) {
  const mapScores = [];
  // Pattern: optional ** around map name, colon, space, score like 13-7
  const mapPattern = /\*{0,2}([A-Za-z0-9]+)\*{0,2}:?\*{0,2}\s+(\d+)-(\d+)/g;
  // Known CS2 map names to filter noise
  const CS2_MAPS = new Set([
    'ancient', 'anubis', 'dust2', 'inferno', 'mirage',
    'nuke', 'overpass', 'train', 'vertigo', 'cache', 'cobblestone'
  ]);

  let match;
  while ((match = mapPattern.exec(body)) !== null) {
    const mapName = match[1].toLowerCase();
    if (!CS2_MAPS.has(mapName)) continue;

    const score1 = parseInt(match[2], 10);
    const score2 = parseInt(match[3], 10);

    // Scores should be valid CS map scores (max ~16 regular, up to ~35 OT)
    if (score1 > 35 || score2 > 35) continue;
    if (score1 < 0 || score2 < 0) continue;

    const winner = Math.max(score1, score2);
    const loser  = Math.min(score1, score2);
    const margin = winner - loser;

    // Was it close? (OT = either side hit 12-12, then played on)
    const wentOT = winner > 13 || (score1 === 13 && score2 === 12) || (score2 === 13 && score1 === 12);
    const isClose = margin <= 3;

    mapScores.push({
      map: match[1],   // preserve original capitalisation
      score1,
      score2,
      winner,
      loser,
      margin,
      wentOT,
      isClose,
    });
  }

  return mapScores;
}

// ── Parser: player ratings ────────────────────────────────────────────────────
// The post-match bot formats ratings as a markdown table with columns:
//   Team | K-D | ADR | Swing | Rating
// Player rows look like:  [🇩🇰](#lang-dk) [blameF](...) | 49-38 | 81.8 | +2.84% | 1.31
//
// We extract: playerName, rating (the last column)
function parsePlayerRatings(body) {
  const players = [];

  // Pattern: markdown link [name](url) followed by | kd | adr | swing | rating
  // rating is a decimal like 1.31
  const playerPattern = /\[([^\]]+)\]\(https:\/\/www\.hltv\.org\/player\/\d+\/[^\)]+\)\s*\|\s*([\d]+-[\d]+)\s*\|\s*([\d.]+)\s*\|\s*[+\-][\d.]+%\s*\|\s*([\d.]+)/g;

  let match;
  while ((match = playerPattern.exec(body)) !== null) {
    const name   = match[1];
    const kd     = match[2];
    const adr    = parseFloat(match[3]);
    const rating = parseFloat(match[4]);

    if (isNaN(rating) || rating < 0.1 || rating > 4.0) continue;

    players.push({ name, kd, adr, rating });
  }

  return players;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function respond(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body, null, 2),
  };
}
