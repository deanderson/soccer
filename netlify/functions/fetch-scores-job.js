// Scheduled function — runs every 15 minutes
// Triggers get-scores?_internal=1 which does the live fetch and writes to blob itself

const { connectLambda } = require('@netlify/blobs');

exports.handler = async function(event, context) {
  connectLambda(event);

  const start = Date.now();
  const baseUrl = process.env.URL || 'https://spoilerfreescores.com';
  console.log('fetch-scores-job: starting at', new Date().toISOString());

  try {
    const res = await fetch(
      `${baseUrl}/.netlify/functions/get-scores?sport=all&_internal=1`,
      { signal: AbortSignal.timeout(55000) }
    );

    const elapsed = Date.now() - start;

    if (!res.ok) {
      const text = await res.text();
      console.error(`fetch-scores-job: get-scores returned ${res.status} after ${elapsed}ms:`, text.slice(0, 200));
      return { statusCode: 500, body: JSON.stringify({ ok: false, error: `HTTP ${res.status}` }) };
    }

    // get-scores writes blob itself — just confirm it completed
    const xCache = res.headers.get('X-Cache') || 'unknown';
    const xFetchedAt = res.headers.get('X-Fetched-At') || 'unknown';
    console.log(`fetch-scores-job: completed in ${elapsed}ms, X-Cache=${xCache}, fetchedAt=${xFetchedAt}`);

    return {
      statusCode: 200,
      body: JSON.stringify({ ok: true, elapsed, fetchedAt: xFetchedAt }),
    };

  } catch (err) {
    const elapsed = Date.now() - start;
    console.error(`fetch-scores-job: failed after ${elapsed}ms:`, err.message);
    return { statusCode: 500, body: JSON.stringify({ ok: false, error: err.message, elapsed }) };
  }
};

// Run every 15 minutes
exports.config = {
  schedule: '*/15 * * * *',
};
