CREATE TABLE IF NOT EXISTS simulation_members (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  parent_member_id TEXT NOT NULL,
  introducer_member_id TEXT NOT NULL,
  course TEXT NOT NULL CHECK (course IN ('A', 'B', 'F', 'G', 'I')),
  period TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_simulation_members_workspace_period
  ON simulation_members (workspace_id, period, created_at);
