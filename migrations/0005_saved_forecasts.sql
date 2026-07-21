CREATE TABLE IF NOT EXISTS saved_forecasts (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  base_period TEXT NOT NULL,
  root_member_id TEXT NOT NULL,
  scenarios_json TEXT NOT NULL,
  results_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_saved_forecasts_workspace_updated
  ON saved_forecasts (workspace_id, updated_at DESC);
