exports.handler = async function(event) {
  const token = process.env.PANDASCORE_TOKEN;
  if (!token) return { statusCode: 200, body: JSON.stringify({ error: 'no token' }) };

  const url = 'https://api.pandascore.co/csgo/matches/past?filter[videogame_title]=cs-2&filter[status]=finished&sort=-end_at&page[size]=3';

  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10000) });
  const data = await res.json();

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      httpStatus: res.status,
      count: Array.isArray(data) ? data.length : null,
      sample: Array.isArray(data) ? data.slice(0, 2).map(m => ({
        id: m.id,
        name: m.name,
        status: m.status,
        end_at: m.end_at,
        begin_at: m.begin_at,
        match_type: m.match_type,
        number_of_games: m.number_of_games,
        opponents: (m.opponents || []).map(o => ({ name: o?.opponent?.name })),
        results: m.results,
        tournament_tier: m.tournament?.tier,
        tournament_name: m.tournament?.name,
        league_name: m.league?.name,
      })) : data,
    }, null, 2),
  };
};
