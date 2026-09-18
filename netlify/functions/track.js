// netlify/functions/track.js
//
// Visitor counter. index.html POSTs here once per page load.
// Skips bots, stores a daily-rotating hash instead of the IP.
// View the numbers at /.netlify/functions/stats

const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');

const BOT_UA = /bot|crawl|spider|slurp|preview|monitor|uptime|headless|lighthouse|curl|wget|python|axios|node-fetch|go-http/i;
const VALID_SPORTS = new Set(['all','football','cricket','wnba','darts','tennis','nhl','nba','mlb','nfl','ncaaf','softball','cs2']);

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: '' };

  const ua = event.headers?.['user-agent'] || '';
  if (!ua || BOT_UA.test(ua)) return { statusCode: 204, body: '' };

  const ip = (event.headers?.['x-nf-client-connection-ip']
           || event.headers?.['x-forwarded-for']?.split(',')[0]
           || '').trim();
  const day = new Date().toISOString().slice(0, 10);
  const salt = process.env.VISITOR_SALT || '';
  const visitor_hash = crypto.createHash('sha256')
    .update(`${salt}|${ip}|${ua}|${day}`).digest('hex').slice(0, 16);

  let sport = null;
  try { sport = JSON.parse(event.body || '{}').sport; } catch { /* ignore */ }
  if (!VALID_SPORTS.has(sport)) sport = null;

  const country = (event.headers?.['x-country'] || event.headers?.['x-nf-country'] || '').toUpperCase() || null;

  try {
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
    const { error } = await supabase.from('page_views').insert({ day, visitor_hash, sport, country });
    if (error) console.error('track: insert failed:', error.message);
  } catch (err) {
    console.error('track: exception:', err.message);
  }
  // Always 204 — the page never waits on or cares about this.
  return { statusCode: 204, body: '' };
};
