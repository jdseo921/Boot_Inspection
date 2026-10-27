-- Secondary indexes for the API's raw-table queries.
-- Kept separate from V1 so docs/PERFORMANCE.md can measure each query with and
-- without them on the same data.

-- Inspection list (newest first, keyset pagination on (inspected_at, id)).
CREATE INDEX inspection_time_id_idx ON inspection (inspected_at, id);

-- Same list filtered by line or product.
CREATE INDEX inspection_line_time_idx ON inspection (line_id, inspected_at, id);
CREATE INDEX inspection_product_time_idx ON inspection (product_id, inspected_at, id);

-- Review queue: flagged boards nobody has decided on yet. Partial, so it stays
-- small no matter how many boards have passed.
CREATE INDEX inspection_pending_review_idx ON inspection (inspected_at, id)
    WHERE verdict <> 'OK' AND review_outcome IS NULL;

-- Look up a board by serial number from the search box.
CREATE INDEX inspection_serial_idx ON inspection (serial_number);

-- Defects of one inspection (detail page) and the FK's ON DELETE CASCADE.
CREATE INDEX defect_inspection_idx ON defect (inspection_id);
