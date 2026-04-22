// Scheduled function — runs every 15 minutes
// Uses DEPLOY_URL to bypass Cloudflare on the custom domain

const { connectLambda } = require('@netlify/blobs');

exports.handler = async function(event, context) {
  connectLambda(event);

  const start = Date.now();

  // DEPLOY_URL is Netlify's own CDN URL (e.g. https://abc123.netlify.app)
  // This bypasses Cloudflare which blocks requests to the custom domain
  const baseUrl = process.env.DEPLOY_URL
                || process.env.NETLIFY_FUNCTION_SITE_URL
                || process.env.URL
                || 'https://spoilerfreescores.com';

  console.log('fetch-scores-job: starting at', new Date().toISOString(), 'via', baseUrl);

  try {
    const res = await fetch(
      `${baseUrl}/.netlify/functions/get-scores?sport=all&_internal=1`,
      {
        signal: AbortSignal.timeout(55000),
        headers: {
          'User-Agent': 'Netlify-Scheduled-Function/1.0',
          'X-Netlify-Internal': '1',
        }
      }
    );

    const elapsed = Date.now() - start;

    if (!res.ok) {
      const text = await res.text();
      console.error(`fetch-scores-job: get-scores returned ${res.status} after ${elapsed}ms:`, text.slice(0, 200));
      return { statusCode: 500, body: JSON.stringify({ ok: false, error: `HTTP ${res.status}` }) };
    }

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

exports.config = {
  schedule: '*/15 * * * *',
};
