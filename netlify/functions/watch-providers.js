// netlify/functions/watch-providers.js
// Maps (league, country) -> streaming provider for the "Watch Now" button.
// Affiliate-ready: provider entries can later carry affiliate params that
// resolveProviderUrl() will append to the base URL.

// ---- provider registry ----
// Each key is a league name (matches what get-scores.js puts on game.league).
// Each league has per-country entries plus a DEFAULT.
// `affiliateParams: null` for v1 — fill in later without touching call sites.
const PROVIDERS = {
  // ----- DARTS (v1 scope) -----
  'Premier League Darts': {
    DEFAULT: { name: 'PDC TV', baseUrl: 'https://www.pdc.tv', affiliateParams: null },
  },
  // Future:
  // 'Premier League': { US: {...}, GB: {...}, DEFAULT: {...} },
  // 'Champions League': { ... },
  // etc.
};

// Build the final URL. If affiliateParams is set later, append as query string.
function buildUrl(provider) {
  if (!provider) return null;
  if (!provider.affiliateParams) return provider.baseUrl;
  const qs = Object.entries(provider.affiliateParams)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');
  const sep = provider.baseUrl.includes('?') ? '&' : '?';
  return `${provider.baseUrl}${sep}${qs}`;
}

// Look up provider for a (league, country) pair. Falls back to DEFAULT.
// Returns null if no mapping exists for this league at all (button hidden).
function lookupProvider(league, country) {
  const leagueMap = PROVIDERS[league];
  if (!leagueMap) return null;
  const entry = leagueMap[country] || leagueMap.DEFAULT || null;
  if (!entry) return null;
  return { name: entry.name, url: buildUrl(entry) };
}

module.exports = { lookupProvider };
