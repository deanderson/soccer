// netlify/functions/stats.js
//
// Visitor counts for the last 30 days: /.netlify/functions/stats
// If STATS_KEY is set in Netlify env vars, require ?key=<STATS_KEY>.

const { createClient } = require('@supabase/supabase-js');

exports.handler = async function (event) {
  const key = process.env.STATS_KEY;
  if (key && event.queryStringParameters?.key !== key) {
    return { statusCode: 404, body: 'Not found' };
  }

  const since = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  const { data, error } = await supabase
    .from('daily_visitors').select('*').gte('day', since).order('day', { ascending: false });

  if (error) return { statusCode: 500, body: `stats error: ${error.message}` };

  const sum = (rows, f) => rows.reduce((n, r) => n + r[f], 0);
  const last7 = data.slice(0, 7);
  const rows = data.map(r =>
    `<tr><td>${r.day}</td><td>${r.visitors}</td><td>${r.views}</td></tr>`).join('');

  const html = `<!doctype html><meta name="viewport" content="width=device-width">
<title>SFS stats</title>
<style>body{font:15px system-ui;margin:24px;max-width:420px}td,th{padding:4px 14px;text-align:right}td:first-child,th:first-child{text-align:left}</style>
<h2>Spoiler Free Scores — visitors</h2>
<p>Today: <b>${data[0]?.day === new Date().toISOString().slice(0,10) ? data[0].visitors : 0}</b> ·
7 days: <b>${sum(last7,'visitors')}</b> visitor-days, ${sum(last7,'views')} views ·
30 days: <b>${sum(data,'visitors')}</b> visitor-days</p>
<table><tr><th>Day (UTC)</th><th>Visitors</th><th>Views</th></tr>${rows}</table>
<p style="color:#888;font-size:12px">Unique = same IP + browser within a UTC day. Bots excluded by user agent.</p>`;

  return { statusCode: 200, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }, body: html };
};
