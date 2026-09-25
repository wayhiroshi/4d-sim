CREATE TABLE strategy_plans (
  id TEXT NOT NULL,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  name TEXT NOT NULL,
  revision_id TEXT NOT NULL,
  archived INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0, 1)),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (workspace_id, id)
);
CREATE TABLE strategy_revisions (
  id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  plan_id TEXT NOT NULL,
  name TEXT NOT NULL,
  engine_version TEXT NOT NULL,
  plan_version TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (workspace_id, id),
  FOREIGN KEY (workspace_id, plan_id) REFERENCES strategy_plans(workspace_id, id)
);
CREATE TABLE strategy_revision_chunks (
  workspace_id TEXT NOT NULL,
  revision_id TEXT NOT NULL,
  ordinal INTEGER NOT NULL,
  payload TEXT NOT NULL,
  PRIMARY KEY (workspace_id, revision_id, ordinal),
  FOREIGN KEY (workspace_id, revision_id) REFERENCES strategy_revisions(workspace_id, id)
);
CREATE TRIGGER strategy_revision_immutable BEFORE UPDATE ON strategy_revisions
BEGIN SELECT RAISE(ABORT, 'Strategy revisions are immutable'); END;
CREATE TRIGGER strategy_chunk_immutable BEFORE UPDATE ON strategy_revision_chunks
BEGIN SELECT RAISE(ABORT, 'Strategy revision chunks are immutable'); END;
CREATE TABLE strategy_overlays (
  workspace_id TEXT PRIMARY KEY REFERENCES workspaces(id),
  revision_id TEXT NOT NULL,
  objective TEXT NOT NULL,
  band TEXT NOT NULL,
  applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (workspace_id, revision_id) REFERENCES strategy_revisions(workspace_id, id)
);
CREATE TABLE strategy_legacy_archive (
  workspace_id TEXT NOT NULL,
  legacy_id TEXT NOT NULL,
  name TEXT NOT NULL,
  scenarios_json TEXT NOT NULL,
  results_json TEXT NOT NULL,
  base_period TEXT NOT NULL,
  root_member_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (workspace_id, legacy_id)
);
INSERT INTO strategy_legacy_archive (workspace_id, legacy_id, name, scenarios_json, results_json, base_period, root_member_id, created_at, updated_at)
SELECT workspace_id, id, name, scenarios_json, results_json, base_period, root_member_id, created_at, updated_at FROM saved_forecasts;
CREATE INDEX strategy_plans_recency ON strategy_plans(workspace_id, archived, updated_at DESC);
