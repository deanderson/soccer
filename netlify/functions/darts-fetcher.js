// netlify/functions/darts-fetcher.js
// Fetches darts data from Wikipedia and returns games in the canonical shape
// used by spoilerfreescores.com.
//
// Each game looks like:
//   { id, home, away, h, a, league, date, dateKey, time, ts, status, dramaHints, debug }
// Where:
//   home/away = player names
//   h/a       = legs won (e.g. 6/4, 6/5)
//   league    = e.g. "Premier League Darts"
//   debug     = { round: 'QF'|'SF'|'F', avg1, avg2, tournament, night, nineDart }
//
// Adding a new tournament: append an entry to TOURNAMENTS with its Wikipedia
// page name, dates, and a `format` that maps to a parser. Currently only
// 'premier-league-night' is supported. Knockout/group formats can be added later.

const https = require('https');

// -------------------- tournament config --------------------

const TOURNAMENTS = [
  {
    wikiPage: '2026_Premier_League_Darts',
    league:   'Premier League Darts',
    format:   'premier-league-night',
    startDate:'2026-02-05',
    endDate:  '2026-05-28',
    // Each Premier League night has its own date. We map night number -> date
    // so we can give each match a real ts. If absent or off, falls back to
    // start-of-tournament date.
    nightDates: {
      1:  '2026-02-05',  2:  '2026-02-12',  3:  '2026-02-19',  4:  '2026-02-26',
      5:  '2026-03-05',  6:  '2026-03-12',  7:  '2026-03-19',  8:  '2026-03-26',
      9:  '2026-04-02',  10: '2026-04-09',  11: '2026-04-16',  12: '2026-04-23',
      13: '2026-04-30',  14: '2026-05-07',  15: '2026-05-14',  16: '2026-05-21',
      17: '2026-05-28',  // play-offs
    },
  },
  // Future:
  // { wikiPage: '2026_World_Matchplay', league: 'World Matchplay', format: 'knockout', ... }
];

// -------------------- fetch --------------------

function fetchWikitext(pageTitle) {
  const url = `https://en.wikipedia.org/w/api.php?action=parse&page=${encodeURIComponent(pageTitle)}&format=json&prop=wikitext&redirects=1`;
  return new Promise((resolve, reject) => {
    const opts = {
      headers: { 'User-Agent': 'SpoilerFreeScores/1.0 (https://spoilerfreescores.com)' },
    };
    const req = https.get(url, opts, (res) => {
      let data = '';
      res.on('data', (c) => data += c);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.error) return reject(new Error(json.error.info));
          resolve(json.parse?.wikitext?.['*'] || '');
        } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.setTimeout(8000, () => { req.destroy(new Error('Wiki fetch timeout')); });
  });
}

// -------------------- parsing helpers --------------------

function parsePDCFlag(cellText) {
  if (!cellText) return { name: 'TBD', avg: null };
  const m = cellText.match(/\{\{PDCFlag\|([^|}]+)(?:\|avg=([\d.]+))?/i);
  if (m) return { name: m[1].trim(), avg: m[2] ? parseFloat(m[2]) : null };
  return {
    name: cellText.replace(/\{\{[^}]*\}\}/g, '').replace(/[\[\]']/g, '').trim() || 'TBD',
    avg: null,
  };
}

function parseScoreText(str) {
  if (str == null || str === '') return null;
  const clean = String(str).replace(/[^\d]/g, '');
  return clean === '' ? null : parseInt(clean, 10);
}

// Split wikitext by "===DATE – Night N===" headers under "==League stage=="
function splitNights(wikitext) {
  const leagueStart = wikitext.search(/==\s*League stage\s*==/);
  const searchText = leagueStart > -1 ? wikitext.slice(leagueStart) : wikitext;
  const offset = leagueStart > -1 ? leagueStart : 0;

  const nights = [];
  const headerRe = /===\s*\d+\s+\w+\s*[\u2013\-]\s*Night\s+(\d+)\s*===/g;
  const marks = [];
  let m;
  while ((m = headerRe.exec(searchText)) !== null) {
    marks.push({ night: parseInt(m[1], 10), start: m.index + offset });
  }

  for (let i = 0; i < marks.length; i++) {
    const start = marks[i].start;
    const end = i + 1 < marks.length ? marks[i + 1].start : wikitext.length;
    nights.push({ night: marks[i].night, text: wikitext.slice(start, end) });
  }
  return nights;
}

// Parse 8-team bracket: RD1 = QF, RD2 = SF, RD3 = F
function parseBracket(nightText) {
  const matches = [];
  const rounds = { RD1: 'QF', RD2: 'SF', RD3: 'F' };

  for (const [rd, label] of Object.entries(rounds)) {
    const slots = {};
    const teamRe  = new RegExp(`\\|\\s*${rd}-team(\\d+)\\s*=\\s*([^\\n]*)`,  'g');
    const scoreRe = new RegExp(`\\|\\s*${rd}-score(\\d+)\\s*=\\s*([^\\n|]*)`, 'g');

    let t;
    while ((t = teamRe.exec(nightText)) !== null) {
      const slot = parseInt(t[1], 10);
      slots[slot] = slots[slot] || {};
      slots[slot].team = t[2].trim();
    }
    let s;
    while ((s = scoreRe.exec(nightText)) !== null) {
      const slot = parseInt(s[1], 10);
      slots[slot] = slots[slot] || {};
      slots[slot].score = s[2].trim();
    }

    const slotNums = Object.keys(slots).map(Number).sort((a, b) => a - b);
    for (let i = 0; i < slotNums.length; i += 2) {
      const a = slots[slotNums[i]];
      const b = slots[slotNums[i + 1]];
      if (!a || !b) continue;
      const p1 = parsePDCFlag(a.team);
      const p2 = parsePDCFlag(b.team);
      matches.push({
        round: label,
        slotIdx: i / 2,
        p1: p1.name, p2: p2.name,
        avg1: p1.avg, avg2: p2.avg,
        s1: parseScoreText(a.score),
        s2: parseScoreText(b.score),
      });
    }
  }
  return matches;
}

function parseNightStats(nightText) {
  const stats = {};

  const avgM = nightText.match(/Night's Total Average:?\s*'*\s*([\d.]+)/i);
  stats.avg = avgM ? parseFloat(avgM[1]) : null;

  const hcM = nightText.match(/Highest Checkout:?[^\n]*?'''\s*(\d+)\s*'''/i);
  stats.highestCheckout = hcM ? parseInt(hcM[1], 10) : null;

  const m180 = nightText.match(/Most 180s:?[^\n]*?'''\s*(\d+)\s*'''/i);
  stats.most180s = m180 ? parseInt(m180[1], 10) : null;

  const t180 = nightText.match(/Night's 180s:?\s*'*\s*(\d+)/i);
  stats.total180s = t180 ? parseInt(t180[1], 10) : null;

  const ndM = nightText.match(/Nine-Dart Finish:?\s*([^\n|}]+)/i);
  stats.nineDart = !!(ndM && ndM[1].trim().length > 2);

  return stats;
}

// -------------------- shape conversion --------------------

// Given a parsed match + tournament config + night number, build a canonical game object.
function buildGame(match, tournament, night, nightStats, slotIdx) {
  const dateStr = tournament.nightDates?.[night] || tournament.startDate;
  const date = new Date(dateStr + 'T20:00:00Z'); // PL nights tip ~8pm UK

  const utcDate = `${date.getUTCFullYear()}-${String(date.getUTCMonth()+1).padStart(2,'0')}-${String(date.getUTCDate()).padStart(2,'0')}`;
  const played = match.s1 != null && match.s2 != null;

  const dramaHints = [];
  // Per-match drama signals get inferred. We only mark a 9-darter for matches
  // where we have evidence — for now we fall back to the night flag, knowing
  // it'll lift every match on a 9-darter night equally. Imperfect but honest.
  if (nightStats?.nineDart) dramaHints.push('9-darter on night');

  return {
    id:     `darts-pl-${tournament.wikiPage}-n${night}-${match.round.toLowerCase()}-${slotIdx}`,
    home:   match.p1,
    away:   match.p2,
    h:      match.s1 ?? 0,
    a:      match.s2 ?? 0,
    date:   date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }),
    dateKey: utcDate,
    time:   date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }),
    league: tournament.league,
    status: played ? 'final' : 'upcoming',
    ts:     date.getTime(),
    dramaHints,
    debug: {
      round:      match.round,
      night,
      avg1:       match.avg1,
      avg2:       match.avg2,
      tournament: tournament.wikiPage,
      nineDart:   !!nightStats?.nineDart,
      nightAvg:   nightStats?.avg ?? null,
    },
  };
}

// -------------------- per-format parsers --------------------

async function fetchPremierLeagueNight(tournament) {
  const wikitext = await fetchWikitext(tournament.wikiPage);
  const nights = splitNights(wikitext);

  const recent = [];
  const upcoming = [];

  for (const n of nights) {
    const stats = parseNightStats(n.text);
    const matches = parseBracket(n.text);
    matches.forEach((m, idx) => {
      const game = buildGame(m, tournament, n.night, stats, idx);
      if (game.status === 'final') recent.push(game);
      else if (game.status === 'upcoming' && game.ts >= Date.now() - 86400000) upcoming.push(game);
    });
  }

  recent.sort((a, b) => a.ts - b.ts);
  upcoming.sort((a, b) => a.ts - b.ts);
  return { recent, upcoming };
}

// -------------------- main entry point --------------------

async function fetchDarts() {
  const now = Date.now();
  const allRecent = [];
  const allUpcoming = [];

  // Filter to tournaments active or recently ended (within 14 days of endDate)
  const ACTIVE_WINDOW_MS = 14 * 86400000;
  const activeTournaments = TOURNAMENTS.filter(t => {
    const end = new Date(t.endDate).getTime();
    const start = new Date(t.startDate).getTime();
    return now >= start - 7 * 86400000 && now <= end + ACTIVE_WINDOW_MS;
  });

  if (activeTournaments.length === 0) {
    return { recent: [], upcoming: [] };
  }

  const results = await Promise.allSettled(activeTournaments.map(t => {
    if (t.format === 'premier-league-night') return fetchPremierLeagueNight(t);
    // Future formats:
    // if (t.format === 'knockout') return fetchKnockout(t);
    return Promise.resolve({ recent: [], upcoming: [] });
  }));

  for (const r of results) {
    if (r.status === 'fulfilled') {
      allRecent.push(...r.value.recent);
      allUpcoming.push(...r.value.upcoming);
    } else {
      console.error('darts fetch failed:', r.reason?.message);
    }
  }

  // Trim recent to last ~15 days (matches other sports' 14-day window with
  // a small buffer so we don't lose matches by hours due to UTC rounding)
  const cutoff = now - 15 * 86400000;
  const recent = allRecent
    .filter(g => g.ts >= cutoff)
    .sort((a, b) => a.ts - b.ts);

  const upcoming = allUpcoming
    .filter(g => g.ts >= now - 86400000)
    .sort((a, b) => a.ts - b.ts)
    .slice(0, 20);

  return { recent, upcoming };
}

module.exports = { fetchDarts };
