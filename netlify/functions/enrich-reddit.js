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

  // Find matches that need enrichment:
  // - finished (not upcoming)
  // - missing redditData
  const toEnrich = matches.filter(m =>
    m.status === 'finished' &&
    !m.redditData
  );

  if (toEnrich.length === 0) {
    return respond(200, { message: 'All CS2 matches already enriched', total: matches.length });
  }

  console.log(`enrich-reddit: ${toEnrich.length} matches to enrich`);

  const results = [];

  for (const match of toEnrich) {
    // Build search query: "TeamA TeamB match thread"
    // Keep it tight — subreddit restriction handles false positives
    const query = `${match.home} ${match.away} match thread`;

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

  // Find best match — prefer CS2_PostMatchThreads author (the bot)
  // Fall back to highest-scored post with "Post-Match" in title
  const botPost = posts.find(p => p.author === 'CS2_PostMatchThreads');
  const fallback = posts.find(p =>
    p.title?.toLowerCase().includes('post-match') ||
    p.link_flair_text?.toLowerCase().includes('post-match')
  );
  const post = botPost || fallback || posts[0];

  if (!post) {
    return { found: false, checkedAt: Date.now() };
  }

  // Verify it's actually about this match by checking both team names appear in title
  const titleLower = (post.title || '').toLowerCase();
  const homeLower = match.home.toLowerCase();
  const awayLower = match.away.toLowerCase();
  if (!titleLower.includes(homeLower) && !titleLower.includes(awayLower)) {
    return { found: false, checkedAt: Date.now() };
  }

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
