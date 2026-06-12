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

  // ?reset=1 clears existing redditData so matches can be re-enriched.
  // Useful after fixing the enrichment logic without waiting for blob rotation.
  const forceReset = event.queryStringParameters?.reset === '1';
  if (forceReset) {
    matches.forEach(m => { delete m.redditData; });
    console.log('enrich-reddit: reset mode — cleared existing redditData');
  }

  // Find matches that need enrichment:
  // - finished (not upcoming)
  // - S or A tier only — lower tiers rarely have r/GlobalOffensive post-match threads
  // - missing redditData
  const toEnrich = matches.filter(m =>
    m.status === 'finished' &&
    !m.redditData &&
    ['s', 'a'].includes((m.debug?.tier || '').toLowerCase())
  );

  if (toEnrich.length === 0) {
    return respond(200, { message: 'All CS2 matches already enriched', total: matches.length });
  }

  // Cap per-run to avoid Netlify's 26s scheduled function timeout.
  // 20 matches × ~800ms each = ~16s, safely under the limit.
  // Remaining matches get picked up on the next daily run.
  const MAX_PER_RUN = 20;
  const batch = toEnrich.slice(0, MAX_PER_RUN);
  const deferred = toEnrich.length - batch.length;

  console.log(`enrich-reddit: ${toEnrich.length} to enrich, processing ${batch.length}${deferred > 0 ? `, deferring ${deferred}` : ''}`);

  const results = [];

  for (const match of batch) {
    // Arctic Shift title search — post titles follow:
    //   "TeamA vs TeamB / Tournament / Post-Match Discussion"
    // Team names in titles are often abbreviated (BetBoom→BB, Team Falcons→Falcons)
    // so we search home team (stripped of common prefixes) + league name for specificity.
    // Strip common org suffixes so "G2 Esports" → "G2", "paiN Gaming" → "paiN"
    const homeName = match.home
      .replace(/^Team /i, '')
      .replace(/\s+Esports?/i, '')
      .replace(/\s+Gaming/i, '')
      .replace(/\s+Clan/i, '')
      .trim();
    // Use first 3 words of league + extract year for specificity
    // "IEM Cologne Major 2026" → "IEM Cologne Major" + year appended
    const leagueParts = (match.league || '').split(' ');
    const yearMatch = (match.league || '').match(/(20\d\d)/);
    const leagueName = leagueParts.slice(0, 3).join(' ');
    const year = yearMatch ? yearMatch[1] : '';
    const query = leagueName
      ? `${homeName} ${leagueName}${year && !leagueName.includes(year) ? ' '+year : ''}`
      : homeName;

    let redditData;
    try {
      redditData = await searchReddit(query, match);
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

  return respond(200, {
    enriched: results.length,
    deferred,
    results,
  });
};

// ── Arctic Shift search + parse ──────────────────────────────────────────────

async function searchReddit(query, match) {
  const url = new URL(ARCTIC_SHIFT_BASE);
  url.searchParams.set('subreddit', SUBREDDIT);
  url.searchParams.set('title', query);
  url.searchParams.set('limit', '5');

  const res = await fetch(url.toString(), {
    headers: { 'User-Agent': 'spoilerfreescores/1.0' },
    signal: AbortSignal.timeout(8000),
  });

  if (!res.ok) {
    throw new Error(`Arctic Shift returned ${res.status}`);
  }

  const json = await res.json();
  const posts = json.data || [];

  if (posts.length === 0) {
    return { found: false, checkedAt: Date.now() };
  }

  // Require either the official bot account or a post-match flair/title.
  // Never fall back to posts[0] blindly — news articles and discussion posts
  // will match the query but aren't post-match threads.
  const botPost = posts.find(p => p.author === 'CS2_PostMatchThreads');
  const fallback = posts.find(p =>
    p.title?.toLowerCase().includes('post-match') ||
    p.link_flair_text?.toLowerCase().includes('post-match')
  );
  const post = botPost || fallback || null;
  if (!post) return { found: false, checkedAt: Date.now() };

  if (!post) {
    return { found: false, checkedAt: Date.now() };
  }

  // Verify it's actually about this match — check normalized home team name in title.
  // Post titles abbreviate team names (BetBoom→BB, Team Falcons→Falcons) so we
  // strip common prefixes and check a short token rather than the full name.
  const titleLower = (post.title || '').toLowerCase();
  // Normalize team name to a reliable search token.
  // "The MongolZ" → "the mongolz" (two words — "the" alone is too generic)
  // "Team Falcons" → "falcons", "G2 Esports" → "g2"
  const _homeNorm = match.home
    .replace(/^Team /i, '')
    .replace(/\s+Esports?/i, '')
    .replace(/\s+Gaming/i, '')
    .trim();
  const _homeWords = _homeNorm.toLowerCase().split(/\s+/);
  const homeToken = (_homeWords[0] === 'the' && _homeWords.length > 1)
    ? _homeWords[0] + ' ' + _homeWords[1]   // "the mongolz"
    : _homeWords[0];                          // "falcons", "big", "nrg"
  if (!titleLower.includes(homeToken)) {
    return { found: false, checkedAt: Date.now() };
  }

  const body = post.selftext || '';

  const mapScores     = parseMapScores(body);
  const playerRatings = parsePlayerRatings(body);
  const elimination   = parseElimination(body);
  const highlightStats = parseHighlights(body);

  // Parse quality flags — helps detect format changes on the dev dashboard
  const expectedMaps    = body.match(/## Map \d+:/g)?.length ?? 0;
  const parseQuality = {
    mapsExpected:  expectedMaps,
    mapsParsed:    mapScores.length,
    playersParsed: playerRatings.length,
    mapsOk:        expectedMaps === 0 || mapScores.length === expectedMaps,
    playersOk:     playerRatings.length >= 6,   // at least 6 = both teams partial
  };

  return {
    found: true,
    postId: post.id,
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
// Detects "**TeamA advances to Stage 3.**" and "**TeamB is eliminated.**"
// Present on knockout/advancement matches, absent on round-robin — that
// distinction itself is a signal (elimination match = higher stakes).
function parseElimination(body) {
  const advances  = [];
  const eliminated = [];
  const matches = body.matchAll(/\*\*([^*]+)\*\*/g);
  for (const m of matches) {
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
// Highlights follow format: ##### [M1R4 | playerName - description](url)
// Not always present — treat absence as unknown, not zero.
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
    multiKills: highlights.filter(h => h.isMulti).length,
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

  // Dedupe by name — post repeats each player for overall + each map.
  // First occurrence = overall match rating (aggregate).
  // Track peak map rating separately — a 2.01 on one map is meaningful
  // even if the player's overall is 1.3.
  const byName = new Map();
  for (const p of players) {
    if (!byName.has(p.name)) {
      // First occurrence = overall rating
      byName.set(p.name, { ...p, peakRating: p.rating });
    } else {
      // Subsequent occurrences = per-map ratings, track the peak
      const existing = byName.get(p.name);
      if (p.rating > existing.peakRating) {
        existing.peakRating = p.rating;
      }
    }
  }
  return Array.from(byName.values());
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
