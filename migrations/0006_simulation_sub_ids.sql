ALTER TABLE simulation_members ADD COLUMN master_member_id TEXT;

ALTER TABLE simulation_members ADD COLUMN id_kind TEXT NOT NULL DEFAULT 'master'
  CHECK (id_kind IN ('master', 'sub'));

CREATE INDEX IF NOT EXISTS idx_simulation_members_master
  ON simulation_members (workspace_id, master_member_id, period);
