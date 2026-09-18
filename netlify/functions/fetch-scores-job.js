// Scheduled function — runs every 15 minutes (schedule in netlify.toml).
//
// Calls get-scores in-process instead of over HTTP. The old version fetched
// https://spoilerfreescores.com/.netlify/functions/get-scores, which goes
// through Cloudflare — Cloudflare bot-challenged it (403) or timed out (502)
// on roughly half of runs, and only the scheduler's retry kept data fresh.
//
// get-scores writes the 'latest' blob itself on internal calls, so there's
// nothing left for this job to do but invoke it and log the result.

const getScores = require('./get-scores');

exports.handler = async function (event, context) {
  const start = Date.now();
  console.log('fetch-scores-job: starting at', new Date(start).toISOString());

  try {
    // Pass the real event through so connectLambda() inside get-scores
    // still gets the Blobs context; only override the query params.
    const res = await getScores.handler(
      { ...event, httpMethod: 'GET', queryStringParameters: { sport: 'all', _internal: '1' } },
      context
    );

    const elapsed = Date.now() - start;
    console.log(`fetch-scores-job: get-scores returned ${res.statusCode} after ${elapsed}ms`);

    if (res.statusCode !== 200) {
      console.error('fetch-scores-job: error body:', String(res.body).slice(0, 300));
      return { statusCode: 500, body: JSON.stringify({ ok: false, status: res.statusCode }) };
    }
    return { statusCode: 200, body: JSON.stringify({ ok: true, elapsed }) };

  } catch (err) {
    console.error('fetch-scores-job: exception after', Date.now() - start, 'ms:', err.message);
    return { statusCode: 500, body: JSON.stringify({ ok: false, error: err.message }) };
  }
};
