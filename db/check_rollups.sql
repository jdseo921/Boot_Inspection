-- Checks that the incremental rollup path (rollup_add_inspections and
-- rollup_add_review, used by the API) gives exactly the same rollups as a
-- full rebuild_rollups(). Runs inside a transaction and rolls back, so it is
-- safe on a loaded database:
--
--   psql -v ON_ERROR_STOP=1 -d boot_inspection -f db/check_rollups.sql

\set ON_ERROR_STOP on
BEGIN;

-- 1. Expected: full recompute.
SELECT rebuild_rollups();
CREATE TEMP TABLE exp_yield ON COMMIT DROP AS SELECT * FROM daily_yield;
CREATE TEMP TABLE exp_defects ON COMMIT DROP AS SELECT * FROM daily_defects;
CREATE TEMP TABLE exp_cells ON COMMIT DROP AS SELECT * FROM daily_defect_cells;

-- 2. Incremental: replay every inspection in ingest-sized batches of 1,000,
--    leaving 500 flagged boards unreviewed and reviewing them afterwards
--    through rollup_add_review, the way the API does.
CREATE TEMP TABLE held ON COMMIT DROP AS
    SELECT id, review_outcome, reviewed_by, reviewed_at
    FROM inspection WHERE review_outcome IS NOT NULL ORDER BY id DESC LIMIT 500;
UPDATE inspection i SET review_outcome = NULL, reviewed_by = NULL, reviewed_at = NULL FROM held h WHERE i.id = h.id;

TRUNCATE daily_yield, daily_defects, daily_defect_cells;
DO $$
DECLARE
    lo bigint := (SELECT min(id) FROM inspection);
    hi bigint := (SELECT max(id) FROM inspection);
BEGIN
    WHILE lo <= hi LOOP
        PERFORM rollup_add_inspections(ARRAY(SELECT id FROM inspection WHERE id >= lo AND id < lo + 1000));
        lo := lo + 1000;
    END LOOP;
END $$;

UPDATE inspection i SET review_outcome = h.review_outcome, reviewed_by = h.reviewed_by, reviewed_at = h.reviewed_at
FROM held h WHERE i.id = h.id;
SELECT count(*) AS reviews_replayed FROM held h, LATERAL rollup_add_review(h.id, h.review_outcome) r;

-- 3. Compare both ways; every count must be 0.
SELECT
    (SELECT count(*) FROM (SELECT * FROM exp_yield EXCEPT ALL SELECT * FROM daily_yield) d)
  + (SELECT count(*) FROM (SELECT * FROM daily_yield EXCEPT ALL SELECT * FROM exp_yield) d) AS yield_diff,
    (SELECT count(*) FROM (SELECT * FROM exp_defects EXCEPT ALL SELECT * FROM daily_defects) d)
  + (SELECT count(*) FROM (SELECT * FROM daily_defects EXCEPT ALL SELECT * FROM exp_defects) d) AS defect_diff,
    (SELECT count(*) FROM (SELECT * FROM exp_cells EXCEPT ALL SELECT * FROM daily_defect_cells) d)
  + (SELECT count(*) FROM (SELECT * FROM daily_defect_cells EXCEPT ALL SELECT * FROM exp_cells) d) AS cell_diff,
    (SELECT count(*) FROM daily_yield) AS yield_rows,
    (SELECT sum(inspected) FROM daily_yield) AS boards;

ROLLBACK;
