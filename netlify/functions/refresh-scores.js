// On-demand refresh endpoint — called by the frontend refresh button
// Fetches fresh data directly and writes to blob
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

    // Call get-scores with _internal=1 to bypass blob read and do live fetch
    const baseUrl = process.env.URL || 'https://spoilerfreescores.com';
    const res = await fetch(
      `${baseUrl}/.netlify/functions/get-scores?sport=all&_internal=1`,
      { signal: AbortSignal.timeout(25000) }
    );

    if (!res.ok) throw new Error(`get-scores returned ${res.status}`);
    const data = await res.json();

    // Write to blob ourselves
    const fetchedAt = Date.now();
    await store.setJSON('latest', {
      data,
      fetchedAt,
      fetchedAtISO: new Date(fetchedAt).toISOString(),
    });

    return {
      statusCode: 200,
      body: JSON.stringify({ ok: true, fetchedAt }),
    };
  } catch (err) {
    console.error('refresh-scores failed:', err.message);
    return { statusCode: 500, body: JSON.stringify({ ok: false, error: err.message }) };
  }
};
