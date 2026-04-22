// On-demand refresh endpoint — called by the frontend refresh button
// Triggers a fresh fetch asynchronously and returns immediately
// 5-minute cooldown to prevent abuse

const { connectLambda, getStore } = require('@netlify/blobs');

const COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes

exports.handler = async function(event, context) {
  connectLambda(event);

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  const store = getStore('scores');

  try {
    // Check cooldown
    let existing = null;
    try {
      existing = await store.get('latest', { type: 'json' });
    } catch (e) { /* no blob yet */ }

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

    // Fire off the fetch without waiting — get-scores can take 10-20s with deep analysis
    // The frontend will reload from blob after a delay
    const baseUrl = process.env.URL || 'https://spoilerfreescores.com';
    fetch(
      `${baseUrl}/.netlify/functions/get-scores?sport=all&_internal=1`,
      { signal: AbortSignal.timeout(55000) }
    ).then(async res => {
      if (!res.ok) { console.error('refresh get-scores returned', res.status); return; }
      const data = await res.json();
      const fetchedAt = Date.now();
      await store.setJSON('latest', {
        data,
        fetchedAt,
        fetchedAtISO: new Date(fetchedAt).toISOString(),
      });
      console.log('refresh-scores: blob updated at', new Date(fetchedAt).toISOString());
    }).catch(err => {
      console.error('refresh-scores background fetch failed:', err.message);
    });

    // Return immediately — tell frontend to reload after a delay
    return {
      statusCode: 200,
      body: JSON.stringify({ ok: true, background: true, reloadAfterMs: 18000 }),
    };

  } catch (err) {
    console.error('refresh-scores failed:', err.message);
    return { statusCode: 500, body: JSON.stringify({ ok: false, error: err.message }) };
  }
};
