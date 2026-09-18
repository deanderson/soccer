// netlify/functions/track.js
//
// Visitor tracking. index.html POSTs here:
//   { event: 'load', sport, firstSeen, visits }  — once per page load
//   { event: 'tab',  sport }                     — each time a sport tab is clicked
// Skips bots, never stores the IP. visitor_hash rotates daily (salt|ip|ua|day).
// "Returning" comes from the browser's own first-visit date (localStorage),
// not from a persistent ID, so we can't follow anyone across days.
// View the numbers at /.netlify/functions/stats

const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');

const BOT_UA = /bot|crawl|spider|slurp|preview|monitor|uptime|headless|lighthouse|curl|wget|python|axios|node-fetch|go-http/i;
const VALID_SPORTS = new Set(['all','football','cricket','wnba','darts','tennis','nhl','nba','mlb','nfl','ncaaf','softball','cs2']);
const VALID_EVENTS = new Set(['load', 'tab']);

// Netlify passes geo as base64 JSON in x-nf-geo; fall back to country-only headers.
function readGeo(h) {
  try {
    const g = JSON.parse(Buffer.from(h['x-nf-geo'] || '', 'base64').toString('utf8'));
    return {
      country: g.country?.code || null,
      region:  g.subdivision?.name || g.subdivision?.code || null,
      city:    g.city || null,
    };
  } catch {
    const c = (h['x-country'] || h['x-nf-country'] || '').toUpperCase() || null;
    return { country: c, region: null, city: null };
  }
}

const clip = (s, n) => (typeof s === 'string' ? s.slice(0, n) : null);

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: '' };

  const h = event.headers || {};
  const ua = h['user-agent'] || '';
  if (!ua || BOT_UA.test(ua)) return { statusCode: 204, body: '' };

  let body = {};
  try { body = JSON.parse(event.body || '{}'); } catch { /* ignore */ }

  const ev = VALID_EVENTS.has(body.event) ? body.event : 'load';
  const sport = VALID_SPORTS.has(body.sport) ? body.sport : null;
  const firstSeen = /^\d{4}-\d{2}-\d{2}$/.test(body.firstSeen) ? body.firstSeen : null;
  const visits = Number.isInteger(body.visits) && body.visits > 0 ? Math.min(body.visits, 100000) : null;

  const ip = (h['x-nf-client-connection-ip'] || h['x-forwarded-for']?.split(',')[0] || '').trim();
  const day = new Date().toISOString().slice(0, 10);
  const visitor_hash = crypto.createHash('sha256')
    .update(`${process.env.VISITOR_SALT || ''}|${ip}|${ua}|${day}`).digest('hex').slice(0, 16);

  const geo = readGeo(h);
  const device = /mobile|iphone|android/i.test(ua) ? 'mobile' : 'desktop';

  const row = {
    day, visitor_hash, event: ev, sport, device,
    country: clip(geo.country, 8), region: clip(geo.region, 64), city: clip(geo.city, 64),
    first_seen: ev === 'load' ? firstSeen : null,
    visit_number: ev === 'load' ? visits : null,
  };

  try {
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
    const { error } = await supabase.from('page_views').insert(row);
    if (error) console.error('track: insert failed:', error.message);
  } catch (err) {
    console.error('track: exception:', err.message);
  }
  return { statusCode: 204, body: '' };
};
