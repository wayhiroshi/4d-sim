ALTER TABLE members ADD COLUMN open_studio_attendances INTEGER NOT NULL DEFAULT 0
  CHECK (open_studio_attendances >= 0);

ALTER TABLE members ADD COLUMN pre_trainer_course_completed INTEGER NOT NULL DEFAULT 0
  CHECK (pre_trainer_course_completed IN (0, 1));

ALTER TABLE members ADD COLUMN pre_trainer_kit_purchased INTEGER NOT NULL DEFAULT 0
  CHECK (pre_trainer_kit_purchased IN (0, 1));

ALTER TABLE members ADD COLUMN start_trainer_course_completed INTEGER NOT NULL DEFAULT 0
  CHECK (start_trainer_course_completed IN (0, 1));

ALTER TABLE members ADD COLUMN start_trainer_kit_purchased INTEGER NOT NULL DEFAULT 0
  CHECK (start_trainer_kit_purchased IN (0, 1));
