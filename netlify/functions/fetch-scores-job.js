// Scheduled function — runs every 15 minutes

const { connectLambda, getStore } = require('@netlify/blobs');

exports.handler = async function(event, context) {
  connectLambda(event);

  const start = Date.now();
  console.log('fetch-scores-job: starting at', new Date().toISOString());

  try {
    // Use the Netlify site URL — try multiple env vars
    const siteUrl = process.env.URL || 'https://spoilerfreescores.com';
    console.log('fetch-scores-job: using URL', siteUrl);

    const res = await fetch(
      `${siteUrl}/.netlify/functions/get-scores?sport=all&_internal=1`,
      {
        signal: AbortSignal.timeout(55000),
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; Netlify-Function/1.0)',
        }
      }
    );

    const elapsed = Date.now() - start;
    console.log(`fetch-scores-job: response ${res.status} after ${elapsed}ms`);

    if (!res.ok) {
      const text = await res.text();
      console.error('fetch-scores-job: error body:', text.slice(0, 300));
      return { statusCode: 500, body: JSON.stringify({ ok: false, status: res.status }) };
    }

    const data = await res.json();

    // Write to blob ourselves as safety net
    const store = getStore('scores');
    const fetchedAt = Date.now();
    await store.setJSON('latest', { data, fetchedAt, fetchedAtISO: new Date(fetchedAt).toISOString() });
    console.log('fetch-scores-job: blob written at', new Date(fetchedAt).toISOString());

    return { statusCode: 200, body: JSON.stringify({ ok: true, elapsed }) };

  } catch (err) {
    const elapsed = Date.now() - start;
    console.error('fetch-scores-job: exception after', elapsed, 'ms:', err.message);
    return { statusCode: 500, body: JSON.stringify({ ok: false, error: err.message }) };
  }
};

exports.config = {
  schedule: '*/15 * * * *',
};
