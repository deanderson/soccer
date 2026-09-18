// netlify/functions/stats.js
//
// Visitor dashboard for the last 30 days: /.netlify/functions/stats
// If STATS_KEY is set in Netlify env vars, require ?key=<STATS_KEY>.

const { createClient } = require('@supabase/supabase-js');

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function table(title, head, rows) {
  if (!rows.length) return `<h3>${title}</h3><p class="m">No data yet.</p>`;
  return `<h3>${title}</h3><table><tr>${head.map(h => `<th>${h}</th>`).join('')}</tr>${
    rows.map(r => `<tr>${r.map(c => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</table>`;
}

// Count distinct visitors per key, sorted desc.
function tally(rows, keyFn, limit = 15) {
  const m = new Map();
  for (const r of rows) {
    const k = keyFn(r);
    if (!k) continue;
    if (!m.has(k)) m.set(k, new Set());
    m.get(k).add(`${r.day}|${r.visitor_hash}`);
  }
  return [...m].map(([k, s]) => [k, s.size]).sort((a, b) => b[1] - a[1]).slice(0, limit);
}

exports.handler = async function (event) {
  const key = process.env.STATS_KEY;
  if (key && event.queryStringParameters?.key !== key) return { statusCode: 404, body: 'Not found' };

  const since = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  const { data: rows, error } = await supabase
    .from('page_views')
    .select('day,visitor_hash,event,sport,country,region,city,device,first_seen,visit_number')
    .gte('day', since).limit(50000);
  if (error) return { statusCode: 500, body: `stats error: ${error.message}` };

  const loads = rows.filter(r => r.event === 'load');
  const vid = r => `${r.day}|${r.visitor_hash}`;

  // Per visitor-day: returning if any load that day had first_seen before that day.
  const byVisitor = new Map();
  for (const r of rows) {
    const v = byVisitor.get(vid(r)) || { day: r.day, returning: false, engaged: false };
    if (r.event === 'load' && r.first_seen && r.first_seen < r.day) v.returning = true;
    if (r.event === 'tab') v.engaged = true;
    byVisitor.set(vid(r), v);
  }
  const visitors = [...byVisitor.values()];

  // Daily table
  const days = [...new Set(visitors.map(v => v.day))].sort().reverse();
  const daily = days.map(d => {
    const vs = visitors.filter(v => v.day === d);
    return [d, vs.length, vs.filter(v => !v.returning).length, vs.filter(v => v.returning).length,
            vs.filter(v => v.engaged).length, loads.filter(r => r.day === d).length];
  });

  const total = visitors.length;
  const ret = visitors.filter(v => v.returning).length;
  const eng = visitors.filter(v => v.engaged).length;
  const pct = n => total ? `${Math.round(100 * n / total)}%` : '–';

  const html = `<!doctype html><meta name="viewport" content="width=device-width">
<title>SFS stats</title>
<style>body{font:15px system-ui;margin:24px;max-width:640px}table{border-collapse:collapse;margin-bottom:8px}
td,th{padding:4px 12px;text-align:right}td:first-child,th:first-child{text-align:left}
tr:nth-child(even){background:#8881}.m{color:#888;font-size:12px}h3{margin:24px 0 6px}</style>
<h2>Spoiler Free Scores — last 30 days</h2>
<p><b>${total}</b> visitor-days · <b>${pct(ret)}</b> returning · <b>${pct(eng)}</b> engaged (clicked a sport tab)</p>
${table('By day (UTC)', ['Day', 'Visitors', 'New', 'Returning', 'Engaged', 'Views'], daily)}
${table('Sports viewed', ['Sport', 'Visitors'], tally(rows, r => r.sport))}
${table('Landing tab', ['Sport', 'Visitors'], tally(loads, r => r.sport))}
${table('Country', ['Country', 'Visitors'], tally(rows, r => r.country))}
${table('City', ['City', 'Visitors'], tally(rows, r => r.city && [r.city, r.region, r.country].filter(Boolean).join(', ')))}
${table('Device', ['Device', 'Visitors'], tally(rows, r => r.device))}
<p class="m">A visitor = same IP + browser within a UTC day. Returning = that browser first visited on an earlier day.
Bots excluded by user agent. Visit with ?notrack once to exclude yourself.</p>`;

  return { statusCode: 200, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }, body: html };
};
