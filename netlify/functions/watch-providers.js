// netlify/functions/watch-providers.js
// Maps (league, country) -> streaming provider for the "Watch Now" button.
// Affiliate-ready: provider entries can later carry affiliate params that
// resolveProviderUrl() will append to the base URL.

// ---- provider registry ----
// Each key is a league name (matches what get-scores.js puts on game.league).
// Each league has per-country entries plus a DEFAULT.
// `affiliateParams: null` for v1 — fill in later without touching call sites.
const PROVIDERS = {
  // ----- DARTS -----
  'Premier League Darts': {
    DEFAULT: { name: 'PDC TV', baseUrl: 'https://www.pdc.tv', affiliateParams: null },
  },

  // ----- CRICKET -----
  // IPL has clearly different rights per region. Sources (May 2026): Sky for
  // UK/Ireland (4-yr deal through 2027), Willow for US/Canada, JioHotstar for
  // India, Kayo/Foxtel for Australia, YuppTV in 70+ smaller markets globally.
  // No DEFAULT — better to hide the button than send a UK user to Willow.
  'IPL': {
    US: { name: 'Willow TV',  baseUrl: 'https://www.willow.tv',         affiliateParams: null },
    CA: { name: 'Willow TV',  baseUrl: 'https://www.willow.tv',         affiliateParams: null },
    GB: { name: 'Sky Sports', baseUrl: 'https://www.skysports.com/cricket', affiliateParams: null },
    IE: { name: 'Sky Sports', baseUrl: 'https://www.skysports.com/cricket', affiliateParams: null },
    IN: { name: 'JioHotstar', baseUrl: 'https://www.hotstar.com',       affiliateParams: null },
    AU: { name: 'Kayo Sports',baseUrl: 'https://kayosports.com.au',     affiliateParams: null },
    NZ: { name: 'Sky Sport',  baseUrl: 'https://www.skysport.co.nz',    affiliateParams: null },
    ZA: { name: 'SuperSport', baseUrl: 'https://supersport.com',        affiliateParams: null },
    // Intentionally no DEFAULT — leagues like IPL have geo-locked rights, so
    // sending an unsupported-country user to a random provider is worse than
    // showing no button.
  },

  // Future: PSL (Willow US, FanCode IN), bilaterals usually unbroadcast.
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
