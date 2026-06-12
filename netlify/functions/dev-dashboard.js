// netlify/functions/dev-dashboard.js
// Hidden dev page — exposes parse health, enrichment status, tier distribution.
// Access at /.netlify/functions/dev-dashboard
// Returns JSON — pair with a simple frontend at /#dev or view raw.

const { connectLambda, getStore } = require('@netlify/blobs');

exports.handler = async function(event, context) {
  connectLambda(event);

  let cached;
  try {
    const store = getStore('scores');
    cached = await store.get('latest', { type: 'json' });
  } catch(err) {
    return respond(500, { error: 'Failed to read blob', detail: err.message });
  }

  if (!cached?.data) {
    return respond(200, { error: 'No blob data' });
  }

  const data = cached.data;
  const blobAgeMin = cached.fetchedAt
    ? Math.round((Date.now() - cached.fetchedAt) / 60000)
    : null;

  // ── CS2 enrichment health ──────────────────────────────────────────────────
  const cs2Matches = data.cs2?.recent || [];
  const cs2ByTier = {};
  const parseIssues = [];

  for (const m of cs2Matches) {
    const tier = m.debug?.tier || 'unknown';
    cs2ByTier[tier] = (cs2ByTier[tier] || 0) + 1;

    const rd = m.redditData;
    if (rd?.found) {
      // Check parse quality
      const mapsOk    = rd.parseQuality?.mapsOk ?? true;
      const playersOk = rd.parseQuality?.playersOk ?? true;
      if (!mapsOk || !playersOk) {
        parseIssues.push({
          id: m.id,
          home: m.home,
          away: m.away,
          issue: !mapsOk ? `maps: expected ${rd.parseQuality.mapsExpected} got ${rd.parseQuality.mapsParsed}`
                         : `players: only ${rd.parseQuality.playersParsed} found`,
          postId: rd.postId,
        });
      }
    }
  }

  const cs2Enriched  = cs2Matches.filter(m => m.redditData);
  const cs2Found     = cs2Enriched.filter(m => m.redditData.found);
  const cs2NotFound  = cs2Enriched.filter(m => !m.redditData.found);
  const cs2Pending   = cs2Matches.filter(m =>
    !m.redditData &&
    m.status === 'finished' &&
    ['s','a'].includes((m.debug?.tier||'').toLowerCase())
  );

  // ── Per-sport game counts ──────────────────────────────────────────────────
  const sportCounts = {};
  for (const [key, val] of Object.entries(data)) {
    if (key.startsWith('_')) continue;
    const recent   = val?.recent?.length   ?? 0;
    const upcoming = val?.upcoming?.length ?? 0;
    if (recent > 0 || upcoming > 0) {
      sportCounts[key] = { recent, upcoming };
    }
  }

  // ── CS2 detailed enrichment list ──────────────────────────────────────────
  const cs2Detail = cs2Matches.map(m => {
    const rd = m.redditData;
    return {
      id: m.id,
      home: m.home,
      away: m.away,
      tier: m.debug?.tier || '?',
      score: m.confidence?.score,
      cls: m.confidence?.cls,
      reddit: !rd ? 'pending'
            : !rd.found ? 'not_found'
            : {
                upvotes:    rd.upvotes,
                comments:   rd.comments,
                maps:       rd.mapScores?.length ?? 0,
                players:    rd.playerRatings?.length ?? 0,
                knockout:   rd.elimination?.isKnockout ?? false,
                highlights: rd.highlights?.count ?? 0,
                aces:       rd.highlights?.aces ?? 0,
                parseOk:    (rd.parseQuality?.mapsOk ?? true) && (rd.parseQuality?.playersOk ?? true),
              },
    };
  });

  return respond(200, {
    blobAgeMin,
    enrichedAt: cached.enrichedAt
      ? new Date(cached.enrichedAt).toISOString()
      : 'never',
    sportCounts,
    cs2: {
      total:     cs2Matches.length,
      byTier:    cs2ByTier,
      enriched:  cs2Enriched.length,
      found:     cs2Found.length,
      notFound:  cs2NotFound.length,
      pending:   cs2Pending.length,
      parseIssues,
      matches:   cs2Detail,
    },
  });
};

function respond(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body, null, 2),
  };
}
