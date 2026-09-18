-- Visitor counter. One row per page load from a real browser.
-- No raw IPs: visitor_hash = sha256(salt|ip|user-agent|UTC day), so the same
-- person counts once per day and can't be tracked across days.

CREATE TABLE IF NOT EXISTS page_views (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  viewed_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  day           DATE NOT NULL DEFAULT (NOW() AT TIME ZONE 'utc')::date,
  visitor_hash  TEXT NOT NULL,
  sport         TEXT,
  country       TEXT
);

CREATE INDEX IF NOT EXISTS idx_page_views_day ON page_views(day DESC);

-- Service-role key (used by the functions) bypasses RLS; nothing else gets in.
ALTER TABLE page_views ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE VIEW daily_visitors WITH (security_invoker = on) AS
SELECT day,
       COUNT(DISTINCT visitor_hash) AS visitors,
       COUNT(*)                     AS views
FROM page_views
GROUP BY day;
