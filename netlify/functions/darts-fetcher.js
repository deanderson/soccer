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
  // TEST CONFIG: 2025 Matchplay is finished; included to validate the
  // multi-session knockout parser against complete historical data.
  // Once verified, replace with 2026 Matchplay (July) before deploying for
  // live use.
  {
    wikiPage: '2025_World_Matchplay',
    league:   'World Matchplay',
    format:   'knockout-multi-session',
    startDate:'2025-07-19',
    endDate:  '2025-07-27',
    year:     2025,
    forceActive: true,  // bypass the date-window filter for testing
  },
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
  const trimmed = cellText.trim();

  // Reject anything that looks like a stray bracket field (pipes mid-string,
  // "RD2-..." markers, etc.) — these only appear when the slot is upcoming
  // and our row scan ran into placeholder gunk.
  if (/RD\d-(team|score|seed)/.test(trimmed)) return { name: 'TBD', avg: null };
  if (trimmed.startsWith('|')) return { name: 'TBD', avg: null };

  // Standard form: {{PDCFlag|Name}} or {{PDCFlag|Name|avg=X.XX}}
  const m = trimmed.match(/\{\{PDCFlag\|([^|}]+)(?:\|avg=([\d.]*))?/i);
  if (m) {
    const name = m[1].trim();
    const avg = m[2] && m[2].length ? parseFloat(m[2]) : null;
    return { name: name || 'TBD', avg };
  }

  // Flag-only template ({{flagicon|WAL}}) is a placeholder during the live
  // night — treat as TBD rather than showing "WAL" as a player name.
  if (/^\{\{flagicon\|/i.test(trimmed)) return { name: 'TBD', avg: null };

  // Final fallback: strip residual markup and use what's left, or TBD.
  const cleaned = trimmed.replace(/\{\{[^}]*\}\}/g, '').replace(/[\[\]']/g, '').trim();
  return { name: cleaned || 'TBD', avg: null };
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
    // Use [^\S\n]* (whitespace excluding newline) after = so the regex stops
    // at end of line and doesn't bleed into the next field on empty rows.
    const teamRe  = new RegExp(`\\|[^\\S\\n]*${rd}-team(\\d+)[^\\S\\n]*=[^\\S\\n]*([^\\n]*)`,  'g');
    const scoreRe = new RegExp(`\\|[^\\S\\n]*${rd}-score(\\d+)[^\\S\\n]*=[^\\S\\n]*([^\\n|]*)`, 'g');

    let t;
    while ((t = teamRe.exec(nightText)) !== null) {
      const slot = parseInt(t[1], 10);
      const raw = t[2].trim();
      slots[slot] = slots[slot] || {};
      slots[slot].team = raw;
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

// -------------------- knockout multi-session parser --------------------
//
// World Matchplay-style tournaments: knockout bracket spread across a week+,
// with one or two sessions per day. The wiki page has a "Schedule" section
// containing one subsection per date, each holding a table of matches:
//   Match # | Round | Player1Avg | Score | Player2Avg | Break checkpoints...
//
// We don't extract player names — those are in a separate bracket section
// and we deliberately don't show them (they'd reveal who advanced). We use
// the schedule data alone since it has everything we need for night/session
// summaries: scores, averages, round, date.
//
// Session detection: a single date with >4 matches probably means
// afternoon + evening sessions. We split a date's matches into sessions
// based on match-count threshold rather than try to parse times (which
// aren't reliably present in wikitext).

function parseScoreCell(text) {
  if (!text) return null;
  // Strip wikitext bold/italic markers — wins are wrapped in '''N'''.
  const cleaned = String(text).replace(/'{2,}/g, '');
  // Score formats: "10 – 3", "10-3", "13 - 11" (en-dash, hyphen, ASCII dash)
  const m = cleaned.match(/(\d+)\s*[\u2013\u2014\-]\s*(\d+)/);
  if (!m) return null;
  return { s1: parseInt(m[1], 10), s2: parseInt(m[2], 10) };
}

function parseAvgCell(text) {
  const m = text.match(/(\d+\.\d+)/);
  return m ? parseFloat(m[1]) : null;
}

// Map round labels we might see to canonical short labels.
function normalizeRound(label) {
  const t = String(label).trim().toUpperCase();
  if (t === 'F' || t === 'FINAL')                       return 'F';
  if (t === 'SF' || t === 'SEMI' || t === 'SEMIFINAL')  return 'SF';
  if (t === 'QF' || t === 'QUARTER')                    return 'QF';
  if (/^\d+$/.test(t))                                   return `R${t}`;
  return t;
}

// Parse the Schedule section into match rows. Returns an array of:
//   { matchNum, round, avg1, score, avg2, dateStr, year }
//
// Wiki structure (real):
//   - Date headings: {{hidden begin|...title=Saturday, 19 July}} ... {{hidden end}}
//   - Tables with cells like {{PDCFlag|Name|avg=104.44|b=1}} containing pipes
//   - Round column uses rowspan=4|1 — round value only on first match in group
function parseSchedule(wikitext, year) {
  const out = [];

  // The Schedule section ends at the next ==Header== of equal level.
  const start = wikitext.search(/==\s*Schedule\s*==/i);
  if (start < 0) {
    // Some pages don't have an explicit Schedule heading — schedule sits
    // directly under another heading. Fall back to scanning whole wikitext.
    console.log(`[matchplay parser] no '==Schedule==' heading; scanning whole wikitext`);
  }
  const sectionText = start >= 0 ? wikitext.slice(start) : wikitext;

  // Find each date "block" via {{hidden begin|...title=Saturday, 19 July}}
  // ... {{hidden end}} or {{hiddenend}}.
  const blockRe = /\{\{hidden begin\|[^}]*title\s*=\s*([A-Za-z]+,\s*\d{1,2}\s+[A-Za-z]+)\s*\}\}([\s\S]*?)\{\{hidden\s*end\}\}/gi;
  const blocks = [];
  let bm;
  while ((bm = blockRe.exec(sectionText)) !== null) {
    blocks.push({ dateStr: bm[1].trim(), body: bm[2] });
  }
  console.log(`[matchplay parser] found ${blocks.length} date blocks`);

  for (const { dateStr, body } of blocks) {
    const beforeCount = out.length;

    // Split into rows on `|-` (the row separator in wikitext tables).
    // The first chunk is table header / before first row — skip it.
    const rows = body.split(/\n\s*\|-\s*[^\n]*\n/);

    // Track the current "active" round value because of rowspan.
    let currentRound = null;

    for (const row of rows) {
      // Each row text may contain multiple cells separated by `||` OR newline-pipe.
      // But because PDCFlag templates contain `|`, a naive split on `||` works
      // only because PDCFlag uses single `|` inside `{{...}}` and `||` is
      // outside. Same for `rowspan=N|N` — single pipe inside an attribute.
      //
      // Strategy: find `||` separators that are NOT inside `{{...}}`.
      // Simpler version: replace `{{...}}` with placeholders, split, restore.

      const placeholders = [];
      const masked = row.replace(/\{\{[^{}]*(?:\{\{[^{}]*\}\}[^{}]*)*\}\}/g, (match) => {
        placeholders.push(match);
        return `\x00P${placeholders.length - 1}\x00`;
      });

      // Now split on `||` safely.
      const rawCells = masked.split(/\s*\|\|\s*/);
      // Restore templates and trim leading `|` from first cell.
      const cells = rawCells.map(c =>
        c.replace(/\x00P(\d+)\x00/g, (_, i) => placeholders[parseInt(i, 10)])
         .replace(/^\|\s*/, '')
         .trim()
      );

      if (cells.length < 4) continue;
      const matchNumRaw = cells[0];
      const matchNum = parseInt(matchNumRaw, 10);
      if (!Number.isFinite(matchNum)) continue;

      // Round handling. Possible cell shapes:
      //   "rowspan=4|1"      — first row of a rowspan group
      //   "rowspan=4|QF"     — same, named round
      //   "1"                — bare round value, no rowspan
      //   "QF"               — bare named round
      // If the cell starts with rowspan, capture the round and remember it.
      // If it's bare, just use it. Otherwise, this row is INSIDE a rowspan
      // group, so the round cell is missing — use the remembered round.
      let round = null;
      const roundCell = cells[1] || '';
      const rowspanMatch = roundCell.match(/^rowspan\s*=\s*\d+\s*\|\s*(.+)$/i);
      if (rowspanMatch) {
        round = normalizeRound(rowspanMatch[1]);
        currentRound = round;
      } else if (/^[A-Za-z0-9]+$/.test(roundCell.trim())) {
        round = normalizeRound(roundCell);
        currentRound = round;
      } else {
        // No round cell here — must be a continuation row inside a rowspan.
        // The cells shift left by 1 (no round cell present).
        round = currentRound;
      }

      // Determine cell offsets based on whether round cell is present.
      // With round:    [matchNum, round, p1, score, p2, ...]
      // Without round: [matchNum, p1, score, p2, ...]
      const hasRoundCell = cells[1] !== undefined && (rowspanMatch || /^[A-Za-z0-9]+$/.test(roundCell.trim()));
      const p1Idx    = hasRoundCell ? 2 : 1;
      const scoreIdx = hasRoundCell ? 3 : 2;
      const p2Idx    = hasRoundCell ? 4 : 3;

      const p1Cell = cells[p1Idx]    || '';
      const scCell = cells[scoreIdx] || '';
      const p2Cell = cells[p2Idx]    || '';

      const score = parseScoreCell(scCell);
      if (!score) continue;

      out.push({
        matchNum,
        round:    round || 'R?',
        avg1:     parseAvgFromPDCFlag(p1Cell),
        avg2:     parseAvgFromPDCFlag(p2Cell),
        s1: score.s1, s2: score.s2,
        dateStr, year,
      });
    }

    const added = out.length - beforeCount;
    console.log(`[matchplay parser] ${dateStr}: parsed ${added} matches`);
  }

  return out;
}

// Extract avg from {{PDCFlag|Name|avg=104.44|b=1}} or similar.
function parseAvgFromPDCFlag(cellText) {
  if (!cellText) return null;
  const m = cellText.match(/avg\s*=\s*(\d+\.\d+)/i);
  return m ? parseFloat(m[1]) : null;
}

// Group matches into sessions. With ≤4 matches on a date it's a single
// session; with >4 we infer afternoon/evening split at match 4 (the
// standard PDC schedule pattern for Matchplay).
function groupIntoSessions(matches) {
  const byDate = {};
  for (const m of matches) {
    if (!byDate[m.dateStr]) byDate[m.dateStr] = [];
    byDate[m.dateStr].push(m);
  }

  const sessions = [];
  for (const [dateStr, dayMatches] of Object.entries(byDate)) {
    dayMatches.sort((a, b) => a.matchNum - b.matchNum);
    if (dayMatches.length <= 4) {
      sessions.push({ dateStr, label: dateStr, matches: dayMatches });
    } else {
      // Split: first 4 = afternoon, rest = evening
      sessions.push({
        dateStr,
        label: `${dateStr} (Afternoon)`,
        matches: dayMatches.slice(0, 4),
      });
      sessions.push({
        dateStr,
        label: `${dateStr} (Evening)`,
        matches: dayMatches.slice(4),
      });
    }
  }
  return sessions;
}

// Parse "Saturday, 19 July" + year into a UTC Date at session-typical hour.
function parseSessionDate(dateStr, year, isEvening) {
  const m = dateStr.match(/(\d{1,2})\s+([A-Za-z]+)/);
  if (!m) return null;
  const day = parseInt(m[1], 10);
  const months = { January:0, February:1, March:2, April:3, May:4, June:5,
                   July:6, August:7, September:8, October:9, November:10, December:11 };
  const monthIdx = months[m[2]];
  if (monthIdx == null) return null;
  // Afternoon sessions ~13:00 UK = 12:00 UTC. Evening ~19:00 UK = 18:00 UTC.
  const hour = isEvening ? 18 : 12;
  return new Date(Date.UTC(year, monthIdx, day, hour, 0, 0));
}

// Convert a session's matches into game objects in the canonical shape.
// Player names are blanked deliberately — the night-summary view never
// shows them, and exposing them would defeat the spoiler-protection goal.
function sessionToGames(session, tournament) {
  const isEvening = /Evening/.test(session.label);
  const dt = parseSessionDate(session.dateStr, tournament.year, isEvening) || new Date(tournament.startDate);
  const utcDate = `${dt.getUTCFullYear()}-${String(dt.getUTCMonth()+1).padStart(2,'0')}-${String(dt.getUTCDate()).padStart(2,'0')}`;

  // Average across the session — used by the night-summary commentary
  // engine to detect "high-scoring throughout" days.
  const avgs = session.matches.flatMap(m => [m.avg1, m.avg2]).filter(v => v != null);
  const sessionAvg = avgs.length ? avgs.reduce((a,b)=>a+b,0) / avgs.length : null;

  // Note: we don't have nine-darter data from the schedule alone. That info
  // lives in the page's narrative and isn't reliably extractable. We omit it
  // for Matchplay; the summary will still tier the session correctly based
  // on score margins and round.
  return session.matches.map((m, idx) => ({
    id: `darts-mp-${tournament.wikiPage}-${session.label.replace(/\s+/g,'_')}-${m.matchNum}`,
    home: '',                         // intentionally blank
    away: '',                         // intentionally blank
    h: m.s1,
    a: m.s2,
    date: dt.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }),
    dateKey: utcDate,
    time: '',
    league: tournament.league,
    status: 'final',
    ts: dt.getTime() + idx,           // small offset preserves match order within session
    dramaHints: [],
    debug: {
      round:      m.round,
      session:    session.label,
      avg1:       m.avg1,
      avg2:       m.avg2,
      tournament: tournament.wikiPage,
      sessionAvg,
      // Reused by summarizeNight as "nightAvg" — same meaning, different unit.
      nightAvg:   sessionAvg,
      nineDart:   false,
    },
  }));
}

async function fetchKnockoutMultiSession(tournament) {
  const wikitext = await fetchWikitext(tournament.wikiPage);
  const matches  = parseSchedule(wikitext, tournament.year);
  const sessions = groupIntoSessions(matches);

  const recent = [];
  for (const s of sessions) {
    recent.push(...sessionToGames(s, tournament));
  }
  recent.sort((a, b) => a.ts - b.ts);
  return { recent, upcoming: [] };
}

// -------------------- main entry point --------------------

async function fetchDarts() {
  const now = Date.now();
  const allRecent = [];
  const allUpcoming = [];

  // Filter to tournaments active or recently ended (within 14 days of endDate).
  // `forceActive: true` bypasses the date filter for testing against complete
  // historical wiki pages.
  const ACTIVE_WINDOW_MS = 14 * 86400000;
  const activeTournaments = TOURNAMENTS.filter(t => {
    if (t.forceActive) return true;
    const end = new Date(t.endDate).getTime();
    const start = new Date(t.startDate).getTime();
    return now >= start - 7 * 86400000 && now <= end + ACTIVE_WINDOW_MS;
  });

  if (activeTournaments.length === 0) {
    return { recent: [], upcoming: [] };
  }

  const results = await Promise.allSettled(activeTournaments.map(async t => {
    let result;
    if (t.format === 'premier-league-night')        result = await fetchPremierLeagueNight(t);
    else if (t.format === 'knockout-multi-session') result = await fetchKnockoutMultiSession(t);
    else                                            result = { recent: [], upcoming: [] };
    // Mark forceActive games so the recency cutoff below skips them. This lets
    // historical test data (e.g. last year's Matchplay) flow through for parser
    // validation without bumping the global cutoff.
    if (t.forceActive) {
      result.recent.forEach(g => { g._bypassCutoff = true; });
    }
    return result;
  }));

  for (const r of results) {
    if (r.status === 'fulfilled') {
      allRecent.push(...r.value.recent);
      allUpcoming.push(...r.value.upcoming);
    } else {
      console.error('darts fetch failed:', r.reason?.message);
    }
  }

  // Trim recent to last ~21 days (darts has fewer events than other sports;
  // a wider window keeps two-three Premier League nights visible). Games tagged
  // with _bypassCutoff (test/historical fixtures) are kept regardless.
  const cutoff = now - 21 * 86400000;
  const recent = allRecent
    .filter(g => g._bypassCutoff || g.ts >= cutoff)
    .map(g => { delete g._bypassCutoff; return g; })
    .sort((a, b) => a.ts - b.ts);

  const upcoming = allUpcoming
    .filter(g => g.ts >= now - 86400000)
    .sort((a, b) => a.ts - b.ts)
    .slice(0, 20);

  return { recent, upcoming };
}

module.exports = { fetchDarts };
