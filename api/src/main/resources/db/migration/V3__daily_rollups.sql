-- Daily rollups behind the dashboard charts.
--
-- The API keeps these in step with `inspection` and `defect` inside the same
-- transaction as each ingest batch and each review decision, so the charts
-- read a few thousand rollup rows instead of scanning millions of raw rows.
-- Two paths write them: rollup_add_inspections() adds a just-inserted batch
-- (the ingest path), and rebuild_rollups() recomputes everything from the raw
-- tables. The test suite proves the two agree.
--
-- Constants shared with the API (keep in sync with RollupGrid.java):
--   cycle-time histogram: 120 buckets of 250 ms, the last one open-ended (>= 29,750 ms)
--   defect heatmap grid:  24 columns x 16 rows over the board outline

CREATE TABLE daily_yield (
    local_day          date     NOT NULL,
    line_id            smallint NOT NULL REFERENCES line (id),
    product_id         smallint NOT NULL REFERENCES product (id),
    inspected          integer  NOT NULL CHECK (inspected >= 0),
    ok                 integer  NOT NULL CHECK (ok >= 0),
    review             integer  NOT NULL CHECK (review >= 0),
    ng                 integer  NOT NULL CHECK (ng >= 0),
    confirmed_defects  integer  NOT NULL CHECK (confirmed_defects >= 0),
    false_calls        integer  NOT NULL CHECK (false_calls >= 0),
    cycle_ms_sum       bigint   NOT NULL CHECK (cycle_ms_sum >= 0),
    cycle_hist         integer[] NOT NULL CHECK (cardinality(cycle_hist) = 120),
    PRIMARY KEY (local_day, line_id, product_id),
    CHECK (ok + review + ng = inspected),
    CHECK (confirmed_defects + false_calls <= review + ng)
);

CREATE TABLE daily_defects (
    local_day     date         NOT NULL,
    line_id       smallint     NOT NULL REFERENCES line (id),
    product_id    smallint     NOT NULL REFERENCES product (id),
    defect_class  defect_class NOT NULL,
    n             integer      NOT NULL CHECK (n > 0),
    PRIMARY KEY (local_day, line_id, product_id, defect_class)
);

CREATE TABLE daily_defect_cells (
    local_day     date         NOT NULL,
    product_id    smallint     NOT NULL REFERENCES product (id),
    line_id       smallint     NOT NULL REFERENCES line (id),
    defect_class  defect_class NOT NULL,
    cx            smallint     NOT NULL CHECK (cx BETWEEN 0 AND 23),
    cy            smallint     NOT NULL CHECK (cy BETWEEN 0 AND 15),
    n             integer      NOT NULL CHECK (n > 0),
    PRIMARY KEY (local_day, product_id, line_id, defect_class, cx, cy)
);

-- Heatmap cell of a defect box: the cell holding the box's centre, clamped to
-- the grid so a box touching the board edge still lands in the last cell.
CREATE FUNCTION defect_cell(center_mm double precision, board_mm double precision, cells integer)
RETURNS smallint
LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE
AS $$
    SELECT LEAST(cells - 1, GREATEST(0, floor(center_mm / board_mm * cells)))::smallint
$$;

CREATE FUNCTION rebuild_rollups() RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
    TRUNCATE daily_yield, daily_defects, daily_defect_cells;

    INSERT INTO daily_yield (local_day, line_id, product_id, inspected, ok, review, ng,
                             confirmed_defects, false_calls, cycle_ms_sum, cycle_hist)
    WITH totals AS (
        SELECT local_day, line_id, product_id,
               count(*)                                              AS inspected,
               count(*) FILTER (WHERE verdict = 'OK')                AS ok,
               count(*) FILTER (WHERE verdict = 'REVIEW')            AS review,
               count(*) FILTER (WHERE verdict = 'NG')                AS ng,
               count(*) FILTER (WHERE review_outcome = 'CONFIRMED_DEFECT') AS confirmed_defects,
               count(*) FILTER (WHERE review_outcome = 'FALSE_CALL') AS false_calls,
               sum(cycle_ms)                                         AS cycle_ms_sum
        FROM inspection
        GROUP BY local_day, line_id, product_id
    ), buckets AS (
        SELECT local_day, line_id, product_id, LEAST(cycle_ms / 250, 119) AS bucket, count(*) AS n
        FROM inspection
        GROUP BY local_day, line_id, product_id, LEAST(cycle_ms / 250, 119)
    ), hist AS (
        SELECT t.local_day, t.line_id, t.product_id,
               array_agg(COALESCE(b.n, 0)::integer ORDER BY g) AS cycle_hist
        FROM totals t
        CROSS JOIN generate_series(0, 119) AS g
        LEFT JOIN buckets b
               ON b.local_day = t.local_day AND b.line_id = t.line_id
              AND b.product_id = t.product_id AND b.bucket = g
        GROUP BY t.local_day, t.line_id, t.product_id
    )
    SELECT t.local_day, t.line_id, t.product_id, t.inspected, t.ok, t.review, t.ng,
           t.confirmed_defects, t.false_calls, t.cycle_ms_sum, h.cycle_hist
    FROM totals t
    JOIN hist h USING (local_day, line_id, product_id);

    INSERT INTO daily_defects (local_day, line_id, product_id, defect_class, n)
    SELECT i.local_day, i.line_id, i.product_id, d.defect_class, count(*)
    FROM defect d
    JOIN inspection i ON i.id = d.inspection_id
    GROUP BY i.local_day, i.line_id, i.product_id, d.defect_class;

    INSERT INTO daily_defect_cells (local_day, product_id, line_id, defect_class, cx, cy, n)
    SELECT i.local_day, i.product_id, i.line_id, d.defect_class,
           defect_cell(d.x_mm + d.w_mm / 2, p.board_width_mm, 24),
           defect_cell(d.y_mm + d.h_mm / 2, p.board_height_mm, 16),
           count(*)
    FROM defect d
    JOIN inspection i ON i.id = d.inspection_id
    JOIN product p ON p.id = i.product_id
    GROUP BY 1, 2, 3, 4, 5, 6;
END;
$$;

-- Add a batch of newly inserted inspections (and their defects) to the
-- rollups. Call it once per batch, in the same transaction as the inserts.
-- The expressions match rebuild_rollups() exactly. Rows are upserted in key
-- order so concurrent batches lock rollup rows in the same order.
CREATE FUNCTION rollup_add_inspections(ids bigint[]) RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
    INSERT INTO daily_yield AS dy (local_day, line_id, product_id, inspected, ok, review, ng,
                                   confirmed_defects, false_calls, cycle_ms_sum, cycle_hist)
    WITH sel AS (
        SELECT i.* FROM unnest(ids) AS s(id) JOIN inspection i USING (id)
    ), totals AS (
        SELECT local_day, line_id, product_id,
               count(*)                                              AS inspected,
               count(*) FILTER (WHERE verdict = 'OK')                AS ok,
               count(*) FILTER (WHERE verdict = 'REVIEW')            AS review,
               count(*) FILTER (WHERE verdict = 'NG')                AS ng,
               count(*) FILTER (WHERE review_outcome = 'CONFIRMED_DEFECT') AS confirmed_defects,
               count(*) FILTER (WHERE review_outcome = 'FALSE_CALL') AS false_calls,
               sum(cycle_ms)                                         AS cycle_ms_sum
        FROM sel
        GROUP BY local_day, line_id, product_id
    ), buckets AS (
        SELECT local_day, line_id, product_id, LEAST(cycle_ms / 250, 119) AS bucket, count(*) AS n
        FROM sel
        GROUP BY local_day, line_id, product_id, LEAST(cycle_ms / 250, 119)
    ), hist AS (
        SELECT t.local_day, t.line_id, t.product_id,
               array_agg(COALESCE(b.n, 0)::integer ORDER BY g) AS cycle_hist
        FROM totals t
        CROSS JOIN generate_series(0, 119) AS g
        LEFT JOIN buckets b
               ON b.local_day = t.local_day AND b.line_id = t.line_id
              AND b.product_id = t.product_id AND b.bucket = g
        GROUP BY t.local_day, t.line_id, t.product_id
    )
    SELECT t.local_day, t.line_id, t.product_id, t.inspected, t.ok, t.review, t.ng,
           t.confirmed_defects, t.false_calls, t.cycle_ms_sum, h.cycle_hist
    FROM totals t
    JOIN hist h USING (local_day, line_id, product_id)
    ORDER BY t.local_day, t.line_id, t.product_id
    ON CONFLICT (local_day, line_id, product_id) DO UPDATE SET
        inspected         = dy.inspected + EXCLUDED.inspected,
        ok                = dy.ok + EXCLUDED.ok,
        review            = dy.review + EXCLUDED.review,
        ng                = dy.ng + EXCLUDED.ng,
        confirmed_defects = dy.confirmed_defects + EXCLUDED.confirmed_defects,
        false_calls       = dy.false_calls + EXCLUDED.false_calls,
        cycle_ms_sum      = dy.cycle_ms_sum + EXCLUDED.cycle_ms_sum,
        cycle_hist        = (SELECT array_agg(a + b ORDER BY k)
                             FROM unnest(dy.cycle_hist, EXCLUDED.cycle_hist) WITH ORDINALITY AS u(a, b, k));

    INSERT INTO daily_defects AS dd (local_day, line_id, product_id, defect_class, n)
    SELECT i.local_day, i.line_id, i.product_id, d.defect_class, count(*)
    FROM unnest(ids) AS s(id)
    JOIN inspection i USING (id)
    JOIN defect d ON d.inspection_id = i.id
    GROUP BY i.local_day, i.line_id, i.product_id, d.defect_class
    ORDER BY 1, 2, 3, 4
    ON CONFLICT (local_day, line_id, product_id, defect_class) DO UPDATE SET n = dd.n + EXCLUDED.n;

    INSERT INTO daily_defect_cells AS dc (local_day, product_id, line_id, defect_class, cx, cy, n)
    SELECT i.local_day, i.product_id, i.line_id, d.defect_class,
           defect_cell(d.x_mm + d.w_mm / 2, p.board_width_mm, 24),
           defect_cell(d.y_mm + d.h_mm / 2, p.board_height_mm, 16),
           count(*)
    FROM unnest(ids) AS s(id)
    JOIN inspection i USING (id)
    JOIN defect d ON d.inspection_id = i.id
    JOIN product p ON p.id = i.product_id
    GROUP BY 1, 2, 3, 4, 5, 6
    ORDER BY 1, 2, 3, 4, 5, 6
    ON CONFLICT (local_day, product_id, line_id, defect_class, cx, cy) DO UPDATE SET n = dc.n + EXCLUDED.n;
END;
$$;

-- Move one board from "pending review" to its outcome in the rollup.
-- Call it in the same transaction as the UPDATE that records the decision.
CREATE FUNCTION rollup_add_review(inspection_id bigint, outcome review_outcome) RETURNS void
LANGUAGE sql
AS $$
    UPDATE daily_yield dy
    SET confirmed_defects = dy.confirmed_defects + (outcome = 'CONFIRMED_DEFECT')::integer,
        false_calls       = dy.false_calls + (outcome = 'FALSE_CALL')::integer
    FROM inspection i
    WHERE i.id = rollup_add_review.inspection_id
      AND dy.local_day = i.local_day AND dy.line_id = i.line_id AND dy.product_id = i.product_id;
$$;
