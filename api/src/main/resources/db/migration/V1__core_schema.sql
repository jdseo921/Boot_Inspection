-- Core schema: what an automated optical inspection (AOI) line reports.
-- One row in `inspection` per board pass through the AOI machine; one row in
-- `defect` per region the machine flagged on that board.
--
-- Deliberately no secondary indexes here: V2 adds them, so their effect on
-- query time can be measured on the same data (see docs/PERFORMANCE.md).

CREATE TYPE verdict AS ENUM ('OK', 'REVIEW', 'NG');

-- What the operator decided after looking at a flagged (REVIEW or NG) board.
-- FALSE_CALL = the machine flagged a good board.
CREATE TYPE review_outcome AS ENUM ('CONFIRMED_DEFECT', 'FALSE_CALL');

-- The six defect classes of the public DeepPCB benchmark.
CREATE TYPE defect_class AS ENUM ('open', 'short', 'mousebite', 'spur', 'copper', 'pin_hole');

CREATE TABLE line (
    id    smallint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    code  text NOT NULL UNIQUE,
    name  text NOT NULL,
    site  text NOT NULL
);

CREATE TABLE product (
    id               smallint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    part_number      text NOT NULL UNIQUE,
    name             text NOT NULL,
    board_width_mm   real NOT NULL CHECK (board_width_mm > 0),
    board_height_mm  real NOT NULL CHECK (board_height_mm > 0)
);

-- An engineer-approved, versioned set of inspection thresholds for a product.
CREATE TABLE threshold_profile (
    id                  integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    product_id          smallint NOT NULL REFERENCES product (id),
    version             integer NOT NULL CHECK (version > 0),
    pixel_diff          smallint NOT NULL CHECK (pixel_diff BETWEEN 1 AND 255),
    min_defect_area_px  smallint NOT NULL CHECK (min_defect_area_px > 0),
    model_threshold     real NOT NULL CHECK (model_threshold > 0 AND model_threshold < 1),
    approved_by         text NOT NULL,
    approved_at         timestamptz NOT NULL,
    UNIQUE (product_id, version)
);

CREATE TABLE inspection (
    id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    -- Supplied by the AOI station; makes ingest retries idempotent.
    external_id     uuid NOT NULL UNIQUE,
    serial_number   text NOT NULL,
    product_id      smallint NOT NULL REFERENCES product (id),
    line_id         smallint NOT NULL REFERENCES line (id),
    profile_id      integer NOT NULL REFERENCES threshold_profile (id),
    inspected_at    timestamptz NOT NULL,
    -- Calendar day at the plant (APP_TIMEZONE), used by the daily rollups.
    local_day       date NOT NULL,
    verdict         verdict NOT NULL,
    anomaly_score   real NOT NULL CHECK (anomaly_score >= 0 AND anomaly_score <= 1),
    cycle_ms        integer NOT NULL CHECK (cycle_ms > 0),
    review_outcome  review_outcome,
    reviewed_by     text,
    reviewed_at     timestamptz,
    CONSTRAINT review_only_flagged CHECK (review_outcome IS NULL OR verdict <> 'OK'),
    CONSTRAINT review_fields_together CHECK (
        (review_outcome IS NULL AND reviewed_by IS NULL AND reviewed_at IS NULL)
        OR (review_outcome IS NOT NULL AND reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL)
    )
);

CREATE TABLE defect (
    id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    inspection_id  bigint NOT NULL REFERENCES inspection (id) ON DELETE CASCADE,
    defect_class   defect_class NOT NULL,
    -- Bounding box in board coordinates, origin at the board's top-left corner.
    x_mm           real NOT NULL CHECK (x_mm >= 0),
    y_mm           real NOT NULL CHECK (y_mm >= 0),
    w_mm           real NOT NULL CHECK (w_mm > 0),
    h_mm           real NOT NULL CHECK (h_mm > 0),
    confidence     real NOT NULL CHECK (confidence >= 0 AND confidence <= 1)
);
