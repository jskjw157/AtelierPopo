BEGIN;
-- Stat modification time is not generation time. Derived windows live in the
-- ingestion provenance; never invent an exact timestamp to satisfy NOT NULL.
ALTER TABLE searchad_report_ingestions ALTER COLUMN report_created_at DROP NOT NULL;
COMMIT;
