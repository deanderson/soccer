exports.handler = async function(event) {
  const token = process.env.PANDASCORE_TOKEN;
  if (!token) return { statusCode: 200, body: JSON.stringify({ error: 'no token' }) };

  const tokenSnippet = token.slice(0, 4) + '...' + token.slice(-4);

  async function pandaFetch(label, url) {
    try {
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(10000),
      });
      const data = await res.json();
      const isArray = Array.isArray(data);
      return {
        label, url,
        httpStatus: res.status,
        count: isArray ? data.length : null,
        statuses: isArray ? [...new Set(data.map(m => m.status))] : null,
        sample: isArray ? data.slice(0, 2).map(m => ({
          id: m.id,
          name: m.name,
          status: m.status,
          end_at: m.end_at,
          videogame_title_slug: m.videogame_title?.slug,
        })) : data,
      };
    } catch(err) {
      return { label, error: err.message };
    }
  }

  const results = await Promise.all([
    pandaFetch('past_cs-2_filter',    'https://api.pandascore.co/csgo/matches/past?filter[videogame_title]=cs-2&sort=-end_at&page[size]=10'),
    pandaFetch('past_no_filter',      'https://api.pandascore.co/csgo/matches/past?sort=-end_at&page[size]=10'),
    pandaFetch('past_finished_only',  'https://api.pandascore.co/csgo/matches/past?filter[videogame_title]=cs-2&filter[status]=finished&sort=-end_at&page[size]=10'),
  ]);

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tokenSnippet, results }, null, 2),
  };
};
