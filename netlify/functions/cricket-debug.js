exports.handler = async function (event, context) {
  const API_KEY = process.env.CRICKET_API_KEY;
  if (!API_KEY) return { statusCode: 500, body: JSON.stringify({ error: "CRICKET_API_KEY not set" }) };

  const base = "https://api.cricapi.com/v1";

  async function fetchC(url) {
    try {
      const res = await fetch(url);
      const json = await res.json();
      return {
        status: res.status,
        apiStatus: json.status,
        error: json.status === "failure" ? json.reason : null,
        count: json.data?.length ?? 0,
        firstItem: json.data?.[0] ?? null,
      };
    } catch (err) {
      return { error: err.message };
    }
  }

  const [matches, current, series] = await Promise.all([
    fetchC(`${base}/matches?apikey=${API_KEY}&offset=0`),
    fetchC(`${base}/currentMatches?apikey=${API_KEY}&offset=0`),
    fetchC(`${base}/series?apikey=${API_KEY}&offset=0`),
  ]);

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ debug: true, matches, current, series }, null, 2),
  };
};
