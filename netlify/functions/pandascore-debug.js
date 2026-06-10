// netlify/functions/pandascore-debug.js
// Temporary debug endpoint — hit /.netlify/functions/pandascore-debug
// to see exactly what PandaScore returns for CS2 matches.
// Delete after CS2 is confirmed working.

exports.handler = async function(event) {
  const token = process.env.PANDASCORE_TOKEN;

  // Step 1: token check
  if (!token) {
    return { statusCode: 200, body: JSON.stringify({ step: 'token_check', error: 'PANDASCORE_TOKEN not set' }) };
  }

  const tokenSnippet = token.slice(0, 4) + '...' + token.slice(-4);

  const url = 'https://api.pandascore.co/csgo/matches/past?filter[videogame_title]=cs2&sort=-end_at&page[size]=5';

  let res, text, parsed;
  try {
    res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(10000),
    });
    text = await res.text();
  } catch(err) {
    return { statusCode: 200, body: JSON.stringify({
      step: 'fetch',
      error: err.message,
      tokenSnippet,
      url,
    })};
  }

  try { parsed = JSON.parse(text); } catch { parsed = text; }

  const isArray = Array.isArray(parsed);
  const count = isArray ? parsed.length : null;

  // Sample first match — just the fields our parser uses
  const firstMatch = isArray && parsed[0] ? {
    id: parsed[0].id,
    status: parsed[0].status,
    match_type: parsed[0].match_type,
    number_of_games: parsed[0].number_of_games,
    end_at: parsed[0].end_at,
    begin_at: parsed[0].begin_at,
    opponents: (parsed[0].opponents || []).map(o => o?.opponent?.name),
    results: parsed[0].results,
    tournament_tier: parsed[0].tournament?.tier,
    tournament_name: parsed[0].tournament?.name,
    league_name: parsed[0].league?.name,
    videogame_title: parsed[0].videogame_title,
  } : parsed;

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      tokenSnippet,
      url,
      pandaHttpStatus: res.status,
      isArray,
      matchCount: count,
      firstMatch,
      // If not an array, show the raw response to catch error messages
      rawIfNotArray: !isArray ? text.slice(0, 500) : undefined,
    }, null, 2),
  };
};
