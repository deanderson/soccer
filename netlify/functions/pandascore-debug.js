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
        tiers: isArray ? [...new Set(data.map(m => m.tournament?.tier))] : null,
        sample: isArray ? data.slice(0, 2).map(m => ({
          id: m.id,
          name: m.name,
          status: m.status,
          end_at: m.end_at,
          begin_at: m.begin_at,
          match_type: m.match_type,
          number_of_games: m.number_of_games,
          opponents: (m.opponents || []).map(o => o?.opponent?.name),
          results: m.results,
          tournament_tier: m.tournament?.tier,
          league_name: m.league?.name,
        })) : data,
      };
    } catch(err) {
      return { label, error: err.message };
    }
  }

  // Mirror the exact URL get-scores.js uses, plus a few variants for diagnosis
  const results = await Promise.all([
    pandaFetch('exact_get_scores_url',
      'https://api.pandascore.co/csgo/matches/past?filter[videogame_title]=cs-2&filter[status]=finished&sort=-begin_at&page[size]=50'),
    pandaFetch('upcoming_exact_url',
      'https://api.pandascore.co/csgo/matches/upcoming?filter[videogame_title]=cs-2&sort=begin_at&page[size]=20'),
  ]);

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tokenSnippet, results }, null, 2),
  };
};
