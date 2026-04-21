// On-demand refresh endpoint
// Called by the frontend "Refresh now" button
// Has a 5-minute cooldown enforced by checking the blob timestamp

const { connectLambda, getStore } = require('@netlify/blobs');

const COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes

exports.handler = async function(event, context) {
  connectLambda(event);

  // Only allow POST
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  const store = getStore('scores');

  try {
    // Check cooldown — read current blob timestamp
    let existing = null;
    try {
      existing = await store.get('latest', { type: 'json' });
    } catch (e) { /* no blob yet, that's fine */ }

    if (existing?.fetchedAt) {
      const age = Date.now() - existing.fetchedAt;
      if (age < COOLDOWN_MS) {
        const remainingSecs = Math.ceil((COOLDOWN_MS - age) / 1000);
        return {
          statusCode: 429,
          body: JSON.stringify({
            ok: false,
            message: `Please wait ${remainingSecs}s before refreshing again`,
            fetchedAt: existing.fetchedAt,
          }),
        };
      }
    }

    // Trigger a fresh fetch via the job function
    const baseUrl = process.env.URL || 'https://spoilerfreescores.com';
    const res = await fetch(`${baseUrl}/.netlify/functions/fetch-scores-job`, {
      method: 'POST',
      signal: AbortSignal.timeout(28000),
    });

    if (!res.ok) throw new Error(`fetch-scores-job returned ${res.status}`);
    const result = await res.json();

    return {
      statusCode: 200,
      body: JSON.stringify({ ok: true, fetchedAt: result.fetchedAt }),
    };
  } catch (err) {
    console.error('refresh-scores failed:', err.message);
    return { statusCode: 500, body: JSON.stringify({ ok: false, error: err.message }) };
  }
};
