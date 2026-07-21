PRAGMA foreign_keys = ON;

CREATE TABLE workspaces (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE members (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  display_name TEXT NOT NULL,
  parent_member_id TEXT REFERENCES members(id),
  introducer_member_id TEXT REFERENCES members(id),
  master_member_id TEXT REFERENCES members(id),
  trainer_member_id TEXT REFERENCES members(id),
  id_kind TEXT NOT NULL CHECK (id_kind IN ('master', 'sub')),
  course TEXT NOT NULL CHECK (course IN ('A', 'B', 'F', 'G', 'I')),
  title TEXT NOT NULL DEFAULT 'NONE' CHECK (title IN ('NONE', 'LD', 'LL', 'DR', 'SD', 'TD', 'TRD')),
  trainer_credential TEXT NOT NULL DEFAULT 'NONE' CHECK (trainer_credential IN ('NONE', 'PT', 'ST')),
  sponsor_license INTEGER NOT NULL DEFAULT 0 CHECK (sponsor_license IN (0, 1)),
  joined_period TEXT NOT NULL,
  ended_period TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (workspace_id, id)
);

CREATE INDEX idx_members_workspace_parent ON members(workspace_id, parent_member_id);
CREATE INDEX idx_members_workspace_introducer ON members(workspace_id, introducer_member_id);

CREATE TABLE purchases (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  member_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  period TEXT NOT NULL,
  product_code TEXT,
  kind TEXT NOT NULL CHECK (kind IN ('initial', 'repeat', 'additional')),
  status TEXT NOT NULL CHECK (status IN ('planned', 'confirmed')),
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  price INTEGER NOT NULL CHECK (price >= 0),
  pv INTEGER NOT NULL CHECK (pv >= 0),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_purchases_workspace_period ON purchases(workspace_id, period);
CREATE INDEX idx_purchases_member_period ON purchases(member_id, period);

CREATE TABLE prospects (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  age_band TEXT NOT NULL DEFAULT '',
  introducer_member_id TEXT REFERENCES members(id),
  temperature INTEGER NOT NULL CHECK (temperature BETWEEN 1 AND 5),
  interest_tags TEXT NOT NULL DEFAULT '[]',
  first_contact_date TEXT,
  product_experience INTEGER NOT NULL DEFAULT 0 CHECK (product_experience IN (0, 1)),
  briefing_attended INTEGER NOT NULL DEFAULT 0 CHECK (briefing_attended IN (0, 1)),
  registration_status TEXT NOT NULL CHECK (registration_status IN ('lead', 'following', 'ready', 'registered', 'paused')),
  next_action_date TEXT,
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_prospects_workspace_next_action ON prospects(workspace_id, next_action_date);

CREATE TABLE activities (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  prospect_id TEXT REFERENCES prospects(id) ON DELETE CASCADE,
  member_id TEXT REFERENCES members(id) ON DELETE CASCADE,
  activity_type TEXT NOT NULL CHECK (activity_type IN ('contact', 'experience', 'briefing', 'followup', 'registration', 'memo')),
  occurred_at TEXT NOT NULL,
  next_action_date TEXT,
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (prospect_id IS NOT NULL OR member_id IS NOT NULL)
);

CREATE INDEX idx_activities_workspace_occurred ON activities(workspace_id, occurred_at DESC);

CREATE TABLE goals (
  workspace_id TEXT PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
  target_title TEXT NOT NULL CHECK (target_title IN ('LD', 'LL', 'DR', 'SD', 'TD', 'TRD')),
  target_period TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE tax_profiles (
  workspace_id TEXT PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
  invoice_registered INTEGER NOT NULL DEFAULT 0 CHECK (invoice_registered IN (0, 1)),
  withholding_rate REAL NOT NULL DEFAULT 0 CHECK (withholding_rate BETWEEN 0 AND 1),
  transfer_fee INTEGER NOT NULL DEFAULT 0 CHECK (transfer_fee >= 0),
  offsets INTEGER NOT NULL DEFAULT 0 CHECK (offsets >= 0),
  prior_carryover INTEGER NOT NULL DEFAULT 0 CHECK (prior_carryover >= 0),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE import_runs (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('members', 'purchases', 'prospects')),
  row_count INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO workspaces (id, name) VALUES ('demo', '個人ワークスペース');

INSERT INTO members (
  id, workspace_id, display_name, parent_member_id, introducer_member_id, master_member_id,
  trainer_member_id, id_kind, course, title, trainer_credential, sponsor_license, joined_period
) VALUES
  ('root', 'demo', 'あなた', NULL, NULL, NULL, NULL, 'master', 'A', 'NONE', 'NONE', 0, '2026-06'),
  ('partner', 'demo', 'パートナー', 'root', 'root', NULL, NULL, 'master', 'G', 'NONE', 'NONE', 0, '2026-06'),
  ('member-a', 'demo', '山田さん', 'partner', 'root', NULL, NULL, 'master', 'A', 'NONE', 'NONE', 0, '2026-07');

INSERT INTO purchases (id, workspace_id, member_id, period, product_code, kind, status, quantity, price, pv) VALUES
  ('purchase-root-2026-07', 'demo', 'root', '2026-07', '005510', 'repeat', 'confirmed', 1, 9950, 5330),
  ('purchase-partner-2026-07', 'demo', 'partner', '2026-07', '005520', 'repeat', 'confirmed', 1, 19900, 10670),
  ('purchase-member-a-2026-07', 'demo', 'member-a', '2026-07', '005510', 'repeat', 'confirmed', 1, 9950, 5330);

INSERT INTO prospects (
  id, workspace_id, name, age_band, introducer_member_id, temperature, interest_tags,
  first_contact_date, product_experience, briefing_attended, registration_status, next_action_date, notes
) VALUES
  ('prospect-1', 'demo', '佐藤さん', '40代', 'root', 4, '["美容","健康維持"]', '2026-07-10', 1, 0, 'following', '2026-07-20', '体験後の感想を確認する'),
  ('prospect-2', 'demo', '田中さん', '50代', 'root', 3, '["食生活"]', '2026-07-15', 0, 0, 'lead', '2026-07-25', '説明会の日程候補を確認');

INSERT INTO goals (workspace_id, target_title, target_period) VALUES ('demo', 'LD', '2026-09');
INSERT INTO tax_profiles (workspace_id, invoice_registered, withholding_rate, transfer_fee, offsets, prior_carryover)
VALUES ('demo', 0, 0, 560, 0, 0);
