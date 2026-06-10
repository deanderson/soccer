// netlify/functions/reddit-hltv-debug.js
// Tests whether we can find HLTV match URLs via Reddit r/GlobalOffensive search
// Hit /.netlify/functions/reddit-hltv-debug to test

exports.handler = async function(event) {
  // Test with BIG vs B8 IEM Cologne 2026 — known match
  const home = event.queryStringParameters?.home || 'BIG';
  const away = event.queryStringParameters?.away || 'B8';
  const league = event.queryStringParameters?.league || 'IEM';

  const query = `${home} ${away} ${league} match thread`;
  const url = `https://www.reddit.com/r/GlobalOffensive/search.json?q=${encodeURIComponent(query)}&restrict_sr=1&sort=new&limit=5`;

  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'spoilerfreescores/1.0 (spoiler-free sports replay finder)',
      },
      signal: AbortSignal.timeout(8000),
    });

    if (!res.ok) {
      return {
        statusCode: 200,
        body: JSON.stringify({ error: `Reddit returned ${res.status}`, query, url }),
      };
    }

    const data = await res.json();
    const posts = data?.data?.children || [];

    const results = posts.map(p => {
      const d = p.data;
      // Extract HLTV URLs from selftext and title
      const text = `${d.title} ${d.selftext}`;
      const hltvMatches = text.match(/hltv\.org\/matches\/(\d+)\/[\w-]+/g) || [];
      return {
        title: d.title,
        score: d.score,
        url: `https://reddit.com${d.permalink}`,
        hltvUrls: hltvMatches.map(m => `https://www.${m}`),
        created: new Date(d.created_utc * 1000).toISOString(),
      };
    });

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, resultCount: results.length, results }, null, 2),
    };

  } catch(err) {
    return { statusCode: 200, body: JSON.stringify({ error: err.message, query }) };
  }
};
