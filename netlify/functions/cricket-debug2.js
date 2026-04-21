// Debug endpoint — shows raw cricapi response
exports.handler = async function(event, context) {
  const API_KEY = process.env.CRICKET_API_KEY;
  if (!API_KEY) {
    return { statusCode: 200, body: JSON.stringify({ error: 'No CRICKET_API_KEY env var set' }) };
  }

  try {
    const res = await fetch(
      `https://api.cricapi.com/v1/currentMatches?apikey=${API_KEY}&offset=0`,
      { signal: AbortSignal.timeout(5000) }
    );
    const json = await res.json();
    const matches = json.data || [];

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        status: json.status,
        total: matches.length,
        matchTypes: [...new Set(matches.map(m => m.matchType))],
        sample: matches.slice(0, 3).map(m => ({
          name: m.name,
          matchType: m.matchType,
          matchEnded: m.matchEnded,
          status: m.status,
        }))
      })
    };
  } catch(err) {
    return { statusCode: 200, body: JSON.stringify({ error: err.message }) };
  }
};
