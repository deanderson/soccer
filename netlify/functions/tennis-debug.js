exports.handler = async function (event, context) {
  async function fetchESPN(url) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(8000) });
      const json = await res.json();
      return { url, status: res.status, count: json.events?.length ?? 0, firstItem: json.events?.[0] ?? null, error: null };
    } catch (err) {
      return { url, error: err.message };
    }
  }

  const BASE = "https://site.api.espn.com/apis/site/v2/sports/tennis";
  const dates = `${new Date(Date.now()-14*86400000).toISOString().slice(0,10).replace(/-/g,'')}-${new Date(Date.now()+7*86400000).toISOString().slice(0,10).replace(/-/g,'')}`;

  const [atp, wta, atpsl, wtasl] = await Promise.all([
    fetchESPN(`${BASE}/atp/scoreboard?dates=${dates}&limit=100`),
    fetchESPN(`${BASE}/wta/scoreboard?dates=${dates}&limit=100`),
    fetchESPN(`${BASE}/atp-singles/scoreboard?dates=${dates}&limit=100`),
    fetchESPN(`${BASE}/wta-singles/scoreboard?dates=${dates}&limit=100`),
  ]);

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ dates, atp, wta, atpsl, wtasl }, null, 2),
  };
};
