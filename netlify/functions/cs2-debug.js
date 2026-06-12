// netlify/functions/cs2-debug.js
// Shows CS2 matches from the blob with their redditData enrichment status.
// Hit /.netlify/functions/cs2-debug to inspect what enrich-reddit stored.

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

  if (!cached?.data?.cs2?.recent) {
    return respond(200, { message: 'No CS2 data in blob' });
  }

  const matches = cached.data.cs2.recent;

  const summary = matches.map(m => ({
    id: m.id,
    home: m.home,
    away: m.away,
    date: m.date,
    tier: m.debug?.tier,
    score: m.confidence?.score,
    cls: m.confidence?.cls,
    reddit: m.redditData ? {
      found: m.redditData.found,
      upvotes: m.redditData.upvotes,
      comments: m.redditData.comments,
      mapsFound: m.redditData.mapScores?.length ?? 0,
      mapScores: m.redditData.mapScores,
      playersFound: m.redditData.playerRatings?.length ?? 0,
      checkedAt: m.redditData.checkedAt
        ? new Date(m.redditData.checkedAt).toISOString()
        : null,
      error: m.redditData.error || null,
    } : 'not enriched yet',
  }));

  const enriched = summary.filter(m => m.reddit !== 'not enriched yet');
  const found    = enriched.filter(m => m.reddit.found);

  return respond(200, {
    total: matches.length,
    enriched: enriched.length,
    found: found.length,
    blobAge: cached.fetchedAt
      ? Math.round((Date.now() - cached.fetchedAt) / 60000) + ' min ago'
      : 'unknown',
    enrichedAt: cached.enrichedAt
      ? new Date(cached.enrichedAt).toISOString()
      : 'never',
    matches: summary,
  });
};

function respond(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body, null, 2),
  };
}
