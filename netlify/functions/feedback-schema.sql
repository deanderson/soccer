-- Feedback votes on individual game recommendations.
-- Anonymous (no user id), used for manual tuning of the categorization engine.
-- Each row captures both the user's reaction AND what the engine said at
-- vote-time, so we can compare engine assessment vs user reception.

CREATE TABLE IF NOT EXISTS recommendation_feedback (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Identifies the game being voted on. game_id is "home|away|date" string
  -- matching the frontend's makeGameId(), so we can group votes per game.
  game_id           TEXT NOT NULL,
  sport             TEXT NOT NULL,
  league            TEXT,
  home_team         TEXT,
  away_team         TEXT,
  game_date         TEXT,

  -- What the engine said at the time of the vote. Stored so future tuning
  -- can ask "of all games we called Must Watch with score 70+, what fraction
  -- got thumbs-down?".
  engine_category   TEXT,
  engine_score      INTEGER,
  was_top_pick      BOOLEAN DEFAULT FALSE,
  was_best_pick     BOOLEAN DEFAULT FALSE,

  -- The vote itself.
  vote              TEXT NOT NULL CHECK (vote IN ('up', 'down')),

  -- Reason for downvote (null for upvotes). Constrained list — keep this
  -- in sync with the dropdown in index.html.
  down_reason       TEXT CHECK (
    down_reason IN ('boring', 'defensive', 'didnt_watch', 'overhyped', 'other')
    OR down_reason IS NULL
  ),

  voted_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Hash of the voter's IP, not the IP itself. Lets us spot single-IP spam
  -- without actually storing IPs (privacy). SHA256 hex.
  ip_hash           TEXT
);

CREATE INDEX IF NOT EXISTS idx_recommendation_feedback_voted_at
  ON recommendation_feedback(voted_at DESC);

CREATE INDEX IF NOT EXISTS idx_recommendation_feedback_game
  ON recommendation_feedback(game_id);

CREATE INDEX IF NOT EXISTS idx_recommendation_feedback_engine_category
  ON recommendation_feedback(engine_category);
