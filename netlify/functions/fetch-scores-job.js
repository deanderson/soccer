// Scheduled function — runs every 15 minutes
// Calls get-scores with _internal=1 to bypass cache and do a fresh fetch
// get-scores writes the result to Netlify Blobs itself

const { connectLambda, getStore } = require('@netlify/blobs');

exports.handler = async function(event, context) {
  connectLambda(event);

  try {
    const baseUrl = process.env.URL || 'https://spoilerfreescores.com';
    console.log('fetch-scores-job: fetching from', baseUrl);

    const res = await fetch(`${baseUrl}/.netlify/functions/get-scores?sport=all&_internal=1`, {
      signal: AbortSignal.timeout(55000), // Netlify function limit is 60s
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`get-scores returned ${res.status}: ${text.slice(0, 200)}`);
    }

    const data = await res.json();

    // Also write to blob here as a safety net in case get-scores blob write failed
    const store = getStore('scores');
    const fetchedAt = Date.now();
    await store.setJSON('latest', {
      data,
      fetchedAt,
      fetchedAtISO: new Date(fetchedAt).toISOString(),
    });

    console.log('fetch-scores-job: blob written at', new Date(fetchedAt).toISOString());
    return { statusCode: 200, body: JSON.stringify({ ok: true, fetchedAt }) };

  } catch (err) {
    console.error('fetch-scores-job failed:', err.message);
    return { statusCode: 500, body: JSON.stringify({ ok: false, error: err.message }) };
  }
};

// Run every 15 minutes
exports.config = {
  schedule: '*/15 * * * *',
};
