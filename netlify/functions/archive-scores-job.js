// netlify/functions/archive-scores-job.js
//
// Scheduled function — runs hourly. Reads the latest scores blob and upserts
// each game into the Supabase `games` table for long-term archival.
//
// Design notes:
// - Decoupled from the user-facing path. Failures here can't affect the site.
// - Reads the blob directly (not via HTTP) — faster and no self-call weirdness.
// - Idempotent upserts: same game seen 100 times = 1 row, updated each pass.
// - Batches of 100 rows per upsert call. Supabase handles bigger but 100 is
//   a sweet spot between roundtrip count and per-call payload size.
// - Per-batch error handling: one bad batch doesn't poison the rest.

const { connectLambda, getStore } = require('@netlify/blobs');
const { createClient } = require('@supabase/supabase-js');

// ---- Sport key → API key mapping ----------------------------------------
// The blob stores football data under `soccer` for historical reasons.
// Everything else uses its sport name directly.
const SPORT_KEYS = {
  football: 'soccer',
  nhl:      'nhl',
  mlb:      'mlb',
  nba:      'nba',
  wnba:     'wnba',
  nfl:      'nfl',
  cricket:  'cricket',
  tennis:   'tennis',
  darts:    'darts',
};

// Convert one game object from the blob into a row for the `games` table.
// Returns null if the game can't be archived (missing id, etc.) — caller skips.
function gameToRow(game, sport, league) {
  if (!game) return null;

  // Match timestamp — every fetcher writes `ts` in unix milliseconds.
  // If a game has no ts, we can't archive it sensibly.
  if (!Number.isFinite(game.ts)) return null;

  // Tennis games don't have an `id` field — they're identified in the frontend
  // by player+tournament+round+ts. Synthesize a stable id from those so we can
  // upsert idempotently. Sports that already have an id (everything else) use
  // theirs unchanged.
  let id = game.id;
  if (!id) {
    const parts = [
      sport,
      (game.tournament || game.league || 'tour').replace(/\s+/g, '_'),
      (game.home || 'h').replace(/\s+/g, '_'),
      (game.away || 'a').replace(/\s+/g, '_'),
      game.ts,
    ];
    id = parts.join('-');
  }

  // Numeric scores when present, null otherwise. Tennis stores set scores in
  // game.sets[] (in raw_data); cricket stores result strings in game.status.
  const homeScore = Number.isFinite(game.h) ? game.h
                  : Number.isFinite(game.homeSets) ? game.homeSets
                  : null;
  const awayScore = Number.isFinite(game.a) ? game.a
                  : Number.isFinite(game.awaySets) ? game.awaySets
                  : null;

  return {
    id,
    sport,
    league:             game.league || league || 'unknown',
    home:               game.home || 'unknown',
    away:               game.away || 'unknown',
    home_score:         homeScore,
    away_score:         awayScore,
    match_ts:           game.ts,
    status:             game.status || null,
    confidence_score:   game.confidence?.score ?? null,
    confidence_class:   game.confidence?.cls   ?? null,
    confidence_factors: game.confidence?.factors ?? null,
    drama_hints:        Array.isArray(game.dramaHints) ? game.dramaHints : null,
    timeline_cat:       game.timelineCat || null,
    raw_data:           game,           // full original object for forensics
    updated_at:         new Date().toISOString(),
  };
}

// Build the full row list from the blob payload.
function blobToRows(blobData) {
  const rows = [];
  for (const [sport, apiKey] of Object.entries(SPORT_KEYS)) {
    const sportData = blobData?.[apiKey];
    const recent = sportData?.recent || [];
    for (const game of recent) {
      const row = gameToRow(game, sport, sportData?.league);
      if (row) rows.push(row);
    }
  }
  return rows;
}

// Upsert rows in batches. Returns { written, failed, errors }.
async function upsertBatches(supabase, rows, batchSize = 100) {
  let written = 0;
  let failed  = 0;
  const errors = [];

  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);
    try {
      const { error } = await supabase
        .from('games')
        .upsert(batch, {
          onConflict:        'id',
          // Don't reset first_seen_at on conflict — keep the original archive
          // timestamp. updated_at gets set fresh on every write (above).
          ignoreDuplicates:  false,
        });
      if (error) {
        failed += batch.length;
        errors.push(error.message);
      } else {
        written += batch.length;
      }
    } catch (err) {
      failed += batch.length;
      errors.push(err.message);
    }
  }

  return { written, failed, errors };
}

exports.handler = async function (event, context) {
  connectLambda(event);

  const start = Date.now();
  console.log('archive-scores-job: starting at', new Date().toISOString());

  // ---- Step 1: validate environment ------------------------------------
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseKey) {
    console.error('archive-scores-job: missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
    return { statusCode: 500, body: JSON.stringify({ ok: false, error: 'missing env' }) };
  }

  // ---- Step 2: read the latest blob ------------------------------------
  let blobData;
  try {
    const store = getStore('scores');
    const cached = await store.get('latest', { type: 'json' });
    if (!cached?.data) {
      console.warn('archive-scores-job: no blob data yet, skipping');
      return { statusCode: 200, body: JSON.stringify({ ok: true, skipped: 'no blob' }) };
    }
    blobData = cached.data;
    console.log('archive-scores-job: blob fetchedAt', cached.fetchedAtISO || cached.fetchedAt);
  } catch (err) {
    console.error('archive-scores-job: blob read failed:', err.message);
    return { statusCode: 500, body: JSON.stringify({ ok: false, error: err.message }) };
  }

  // ---- Step 3: build rows from blob ------------------------------------
  const rows = blobToRows(blobData);
  console.log(`archive-scores-job: built ${rows.length} rows from blob`);
  if (rows.length === 0) {
    return { statusCode: 200, body: JSON.stringify({ ok: true, written: 0 }) };
  }

  // ---- Step 4: upsert to Supabase --------------------------------------
  const supabase = createClient(supabaseUrl, supabaseKey, {
    auth: { persistSession: false },
  });

  const { written, failed, errors } = await upsertBatches(supabase, rows);
  const elapsed = Date.now() - start;

  if (failed > 0) {
    console.error(`archive-scores-job: completed with errors — written=${written} failed=${failed} elapsed=${elapsed}ms`);
    console.error('errors:', errors.slice(0, 5));   // first 5 only, in case of cascade
  } else {
    console.log(`archive-scores-job: success — written=${written} elapsed=${elapsed}ms`);
  }

  return {
    statusCode: 200,
    body: JSON.stringify({ ok: failed === 0, written, failed, elapsed }),
  };
};

exports.config = {
  schedule: '0 * * * *',   // top of every hour
};
