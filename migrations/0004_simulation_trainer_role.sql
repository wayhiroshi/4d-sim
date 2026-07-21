ALTER TABLE simulation_members ADD COLUMN trainer_member_id TEXT;
ALTER TABLE simulation_members ADD COLUMN trainer_bonus_role TEXT
  CHECK (trainer_bonus_role IN ('PT', 'ST_SOLO', 'ST_WITH_PT'));
