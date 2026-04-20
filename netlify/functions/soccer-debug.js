// soccer-debug.js
// Deploy to netlify/functions/ and hit /.netlify/functions/soccer-debug
// Shows the full summary payload for a recent Premier League game
// so we can see what goal timeline data is available.

exports.handler = async function (event, context) {

  async function fetchESPN(url) {
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": "Mozilla/5.0" },
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      return { error: err.message, url };
    }
  }

  function espnDate(daysOffset) {
    const d = new Date(Date.now() + daysOffset * 86400000);
    return d.toISOString().slice(0, 10).replace(/-/g, "");
  }

  // Step 1: grab the last 3 days of Premier League games to find a finished one
  const league = event.queryStringParameters?.league || "eng.1";
  const leagueName = league;

  let gameId = event.queryStringParameters?.gameId || null;
  let scoreboard = null;

  if (!gameId) {
    // Find a recently finished game
    for (let offset = 0; offset >= -7; offset--) {
      const date = espnDate(offset);
      const data = await fetchESPN(
        `https://site.api.espn.com/apis/site/v2/sports/soccer/${league}/scoreboard?dates=${date}&limit=10`
      );
      const finished = (data.events || []).find(
        ev => ev.status?.type?.completed === true
      );
      if (finished) {
        gameId = finished.id;
        scoreboard = {
          id: finished.id,
          name: finished.name,
          date: finished.date,
          status: finished.status?.type?.name,
          home: finished.competitions?.[0]?.competitors?.find(c => c.homeAway === "home")?.team?.displayName,
          away: finished.competitions?.[0]?.competitors?.find(c => c.homeAway === "away")?.team?.displayName,
          homeScore: finished.competitions?.[0]?.competitors?.find(c => c.homeAway === "home")?.score,
          awayScore: finished.competitions?.[0]?.competitors?.find(c => c.homeAway === "away")?.score,
        };
        break;
      }
    }
  }

  if (!gameId) {
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "No finished game found in last 7 days", league }),
    };
  }

  // Step 2: fetch the full summary for that game
  const summary = await fetchESPN(
    `https://site.web.api.espn.com/apis/site/v2/sports/soccer/${league}/summary?event=${gameId}&region=us&lang=en&contentorigin=espn`
  );

  // Step 3: extract just the bits we care about — don't dump the whole thing
  const comp = summary?.header?.competitions?.[0];

  // Key events (goals, cards, etc.)
  const keyEvents = (summary?.keyEvents || []).map(ev => ({
    clock: ev.clock?.displayValue,
    type: ev.type?.text,
    text: ev.text,
    team: ev.team?.displayName,
    athlete: ev.athletes?.[0]?.athlete?.displayName,
    isPenalty: ev.type?.text?.toLowerCase().includes("penalty"),
    isOwnGoal: ev.type?.text?.toLowerCase().includes("own goal"),
  }));

  // Scoring plays specifically
  const scoringPlays = (summary?.scoringPlays || []).map(sp => ({
    clock: sp.clock?.displayValue,
    type: sp.type?.text,
    team: sp.team?.displayName,
    athlete: sp.athletes?.[0]?.athlete?.displayName,
    homeScore: sp.homeScore,
    awayScore: sp.awayScore,
    isPenalty: sp.type?.text?.toLowerCase().includes("penalty"),
    isOwnGoal: sp.type?.text?.toLowerCase().includes("own goal"),
  }));

  // Plays (full play-by-play) — just first 5 and last 5 to check structure
  const allPlays = summary?.plays || [];
  const playsPreview = [
    ...allPlays.slice(0, 5),
    ...allPlays.slice(-5),
  ].map(p => ({
    clock: p.clock?.displayValue,
    period: p.period?.number,
    type: p.type?.text,
    text: p.text,
    scoringPlay: p.scoringPlay,
    homeScore: p.homeScore,
    awayScore: p.awayScore,
  }));

  // Top-level keys in summary so we know what's available
  const summaryTopLevelKeys = Object.keys(summary || {});

  // Header info
  const headerInfo = {
    id: comp?.id,
    date: comp?.date,
    attendance: comp?.attendance,
    venue: comp?.venue?.fullName,
    status: comp?.status?.type?.name,
    home: comp?.competitors?.find(c => c.homeAway === "home")?.team?.displayName,
    away: comp?.competitors?.find(c => c.homeAway === "away")?.team?.displayName,
    homeScore: comp?.competitors?.find(c => c.homeAway === "home")?.score,
    awayScore: comp?.competitors?.find(c => c.homeAway === "away")?.score,
  };

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      debug: true,
      league,
      gameId,
      scoreboard,
      summaryTopLevelKeys,
      headerInfo,
      keyEventsCount: keyEvents.length,
      keyEvents,
      scoringPlaysCount: scoringPlays.length,
      scoringPlays,
      totalPlays: allPlays.length,
      playsPreview,
      // Raw first keyEvent so we can see every field
      rawFirstKeyEvent: summary?.keyEvents?.[0] || null,
      rawFirstScoringPlay: summary?.scoringPlays?.[0] || null,
    }, null, 2),
  };
};
