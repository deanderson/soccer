// netlify/functions/apify-hltv-debug.js
// Tests the Apify HLTV actor against a known match (BIG vs B8, IEM Cologne)
// Hit /.netlify/functions/apify-hltv-debug to see what comes back

exports.handler = async function(event) {
  const token = process.env.APIFY_TOKEN;
  if (!token) return { statusCode: 200, body: JSON.stringify({ error: 'APIFY_TOKEN not set' }) };

  try {
    // Start the actor run
    const runRes = await fetch(
      'https://api.apify.com/v2/acts/paco_nassa~hltv-org-live-and-upcoming-matches/runs?token=' + token,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          // Filter to recent results only, looking for BIG vs B8
          startUrls: [{ url: 'https://www.hltv.org/results' }],
          maxItems: 20,
        }),
        signal: AbortSignal.timeout(30000),
      }
    );

    const runData = await runRes.json();
    const runId = runData?.data?.id;

    if (!runId) {
      return {
        statusCode: 200,
        body: JSON.stringify({ error: 'Failed to start actor run', runData }),
      };
    }

    // Wait for completion (poll up to 25 seconds)
    let results = null;
    for (let i = 0; i < 5; i++) {
      await new Promise(r => setTimeout(r, 5000));
      const statusRes = await fetch(
        `https://api.apify.com/v2/actor-runs/${runId}?token=${token}`
      );
      const statusData = await statusRes.json();
      const status = statusData?.data?.status;

      if (status === 'SUCCEEDED') {
        const datasetId = statusData?.data?.defaultDatasetId;
        const dataRes = await fetch(
          `https://api.apify.com/v2/datasets/${datasetId}/items?token=${token}&limit=20`
        );
        results = await dataRes.json();
        break;
      }
      if (status === 'FAILED' || status === 'ABORTED') {
        return { statusCode: 200, body: JSON.stringify({ error: 'Actor run failed', status }) };
      }
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        runId,
        resultCount: Array.isArray(results) ? results.length : null,
        sample: Array.isArray(results) ? results.slice(0, 3) : results,
      }, null, 2),
    };

  } catch (err) {
    return { statusCode: 200, body: JSON.stringify({ error: err.message }) };
  }
};
