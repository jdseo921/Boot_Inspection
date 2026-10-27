package io.github.jdseo921.bootinspection.common;

/**
 * Bucket and grid sizes baked into the rollup tables. They must match
 * V3__daily_rollups.sql, which fills those tables.
 */
public final class RollupGrid {

    private RollupGrid() {}

    /** Width of one cycle-time histogram bucket. */
    public static final int CYCLE_BUCKET_MS = 250;

    /** Number of buckets; the last one is open-ended (at least 29,750 ms). */
    public static final int CYCLE_BUCKETS = 120;

    /** Defect heatmap columns across the board width. */
    public static final int HEAT_COLS = 24;

    /** Defect heatmap rows down the board height. */
    public static final int HEAT_ROWS = 16;
}
