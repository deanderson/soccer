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
        status: res.status,
        count: isArray ? data.length : null,
        firstItem: isArray && data[0] ? {
          id: data[0].id,
          status: data[0].status,
          name: data[0].name,
          videogame: data[0].videogame?.name,
          videogame_title: data[0].videogame_title,
          end_at: data[0].end_at,
          opponents: (data[0].opponents||[]).map(o=>o?.opponent?.name),
        } : data,
      };
    } catch(err) {
      return { label, error: err.message };
    }
  }

  const results = await Promise.all([
    pandaFetch('past_no_filter',     'https://api.pandascore.co/csgo/matches/past?sort=-end_at&page[size]=3'),
    pandaFetch('past_cs2_filter',    'https://api.pandascore.co/csgo/matches/past?filter[videogame_title]=cs2&sort=-end_at&page[size]=3'),
    pandaFetch('past_csgo_filter',   'https://api.pandascore.co/csgo/matches/past?filter[videogame_title]=csgo&sort=-end_at&page[size]=3'),
    pandaFetch('videogame_titles',   'https://api.pandascore.co/videogame-titles?filter[videogame_id]=3&page[size]=10'),
  ]);

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tokenSnippet, results }, null, 2),
  };
};
