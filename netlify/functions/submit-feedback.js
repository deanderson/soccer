// netlify/functions/submit-feedback.js
//
// Accepts thumbs up/down votes on game recommendations and writes them to
// Supabase. Used for manual tuning of the categorization engine — by
// comparing engine output (what we said) with user reaction (what they said),
// we can spot systematic over- and under-calls.
//
// Design notes:
// - Anonymous: no user id, no auth. Just a vote + engine context at vote time.
// - IP-hashed (not stored raw) so we can detect spam without retaining IPs.
// - Strict input validation: every field has an allow-list or type check.
// - Rate limiting per IP via Netlify Blobs (60 votes/hour per IP). Spam
//   prevention; legitimate users won't hit this.
// - Returns 200 always when accepting (even on duplicate-vote attempts from
//   the same device — frontend prevents that, but defensive). Returns 400
//   for malformed input, 429 for rate limit, 500 for upstream failure.

const { createClient } = require('@supabase/supabase-js');
const { connectLambda, getStore } = require('@netlify/blobs');
const crypto = require('crypto');

const VALID_VOTES = new Set(['up', 'down']);
const VALID_DOWN_REASONS = new Set(['boring', 'defensive', 'didnt_watch', 'overhyped', 'other']);
const VALID_CATEGORIES = new Set(['scorefest', 'watchworthy', 'watchable', 'defensive', 'blowout']);

// Rate limit settings. Conservative — a real user voting on a few games per
// session shouldn't come close. Spam attempts will get throttled fast.
const RATE_LIMIT_PER_HOUR = 60;
const RATE_WINDOW_MS = 60 * 60 * 1000;

function hashIP(ip) {
  if (!ip) return null;
  return crypto.createHash('sha256').update(ip).digest('hex').substring(0, 16);
}

// Pull the caller's IP from forwarded headers. Netlify sets these on
// production; on local dev they may be missing (we tolerate that).
function getCallerIP(event) {
  const fwd = event.headers?.['x-forwarded-for'] || event.headers?.['X-Forwarded-For'];
  if (fwd) return fwd.split(',')[0].trim();
  return event.headers?.['client-ip'] || null;
}

// Per-IP rate limit using a Blob keyed by ip_hash. Stores {count, windowStart}.
// Returns true if allowed, false if over the limit.
async function checkRateLimit(ipHash) {
  if (!ipHash) return true;  // No IP available — let it through (rare)

  const store = getStore('feedback-rate-limit');
  const key = `ip-${ipHash}`;
  const now = Date.now();

  let state;
  try {
    state = await store.get(key, { type: 'json' });
  } catch {
    state = null;
  }

  // No record or window expired → start fresh
  if (!state || (now - state.windowStart) > RATE_WINDOW_MS) {
    await store.setJSON(key, { count: 1, windowStart: now });
    return true;
  }

  if (state.count >= RATE_LIMIT_PER_HOUR) {
    return false;
  }

  await store.setJSON(key, { count: state.count + 1, windowStart: state.windowStart });
  return true;
}

// Validate the request body. Returns { valid: bool, row: object|null, error: string|null }.
function validateAndBuildRow(body, ipHash) {
  if (!body || typeof body !== 'object') {
    return { valid: false, error: 'invalid body' };
  }

  const {
    gameId, sport, league, home, away, gameDate,
    engineCategory, engineScore,
    wasTopPick, wasBestPick,
    vote, downReason,
  } = body;

  // Required fields
  if (typeof gameId !== 'string' || gameId.length === 0 || gameId.length > 300) {
    return { valid: false, error: 'invalid gameId' };
  }
  if (typeof sport !== 'string' || sport.length === 0 || sport.length > 30) {
    return { valid: false, error: 'invalid sport' };
  }
  if (!VALID_VOTES.has(vote)) {
    return { valid: false, error: 'invalid vote' };
  }

  // Down reason rules: required for downvotes, must be null/absent for upvotes
  let normalizedReason = null;
  if (vote === 'down') {
    if (downReason && !VALID_DOWN_REASONS.has(downReason)) {
      return { valid: false, error: 'invalid down_reason' };
    }
    normalizedReason = downReason || null;  // allow null for "didn't pick a reason"
  } else {
    if (downReason) {
      return { valid: false, error: 'upvotes cannot have a reason' };
    }
  }

  // Optional fields — sanitize but don't reject
  const safeStr = (s, max = 200) => {
    if (typeof s !== 'string') return null;
    return s.length > max ? s.substring(0, max) : s;
  };
  const safeCategory = VALID_CATEGORIES.has(engineCategory) ? engineCategory : null;
  const safeScore = Number.isFinite(engineScore) ? Math.round(engineScore) : null;

  return {
    valid: true,
    row: {
      game_id: gameId,
      sport: safeStr(sport, 30),
      league: safeStr(league, 50),
      home_team: safeStr(home, 100),
      away_team: safeStr(away, 100),
      game_date: safeStr(gameDate, 50),
      engine_category: safeCategory,
      engine_score: safeScore,
      was_top_pick: !!wasTopPick,
      was_best_pick: !!wasBestPick,
      vote,
      down_reason: normalizedReason,
      ip_hash: ipHash,
    },
  };
}

exports.handler = async function (event) {
  connectLambda(event);

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  // Validate env early
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseKey) {
    console.error('submit-feedback: missing Supabase env vars');
    return { statusCode: 500, body: JSON.stringify({ ok: false, error: 'server misconfigured' }) };
  }

  // Parse body
  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return { statusCode: 400, body: JSON.stringify({ ok: false, error: 'invalid JSON' }) };
  }

  // Rate limit by IP hash
  const ip = getCallerIP(event);
  const ipHash = hashIP(ip);
  const allowed = await checkRateLimit(ipHash);
  if (!allowed) {
    return {
      statusCode: 429,
      body: JSON.stringify({ ok: false, error: 'rate limited — try again later' }),
    };
  }

  // Validate + build row
  const { valid, row, error } = validateAndBuildRow(body, ipHash);
  if (!valid) {
    return { statusCode: 400, body: JSON.stringify({ ok: false, error }) };
  }

  // Insert
  const supabase = createClient(supabaseUrl, supabaseKey, {
    auth: { persistSession: false },
  });

  try {
    const { error: dbErr } = await supabase
      .from('recommendation_feedback')
      .insert(row);

    if (dbErr) {
      console.error('submit-feedback: insert failed:', dbErr.message);
      return { statusCode: 500, body: JSON.stringify({ ok: false, error: 'storage failed' }) };
    }
  } catch (err) {
    console.error('submit-feedback: unexpected error:', err.message);
    return { statusCode: 500, body: JSON.stringify({ ok: false, error: 'unexpected error' }) };
  }

  return { statusCode: 200, body: JSON.stringify({ ok: true }) };
};
