// Scheduled function — runs every 15 minutes
// Fetches all sports data and stores in Netlify Blobs
// Also callable on-demand via refresh-scores.js

const { connectLambda, getStore } = require('@netlify/blobs');

exports.handler = async function(event, context) {
  connectLambda(event);
  const store = getStore('scores');

  // Reuse all the fetch logic from get-scores.js
  // by requiring it as a shared module — but since we can't easily
  // share code between functions without a build step, we inline the fetch here.
  // The actual data fetching is done by calling get-scores internally.

  try {
    // Call our own get-scores function to do the heavy lifting
    const baseUrl = process.env.URL || 'https://spoilerfreescores.com';
    const res = await fetch(`${baseUrl}/.netlify/functions/get-scores?sport=all&_internal=1`, {
      signal: AbortSignal.timeout(25000),
    });

    if (!res.ok) throw new Error(`get-scores returned ${res.status}`);
    const data = await res.json();

    // Store with timestamp
    const payload = {
      data,
      fetchedAt: Date.now(),
      fetchedAtISO: new Date().toISOString(),
    };

    await store.setJSON('latest', payload);
    console.log('Scores cached at', payload.fetchedAtISO);

    return { statusCode: 200, body: JSON.stringify({ ok: true, fetchedAt: payload.fetchedAtISO }) };
  } catch (err) {
    console.error('fetch-scores-job failed:', err.message);
    return { statusCode: 500, body: JSON.stringify({ ok: false, error: err.message }) };
  }
};

// Run every 15 minutes
exports.config = {
  schedule: '*/15 * * * *',
};
