package io.github.jdseo921.bootinspection.analytics;

import io.github.jdseo921.bootinspection.common.RollupGrid;

/**
 * Cycle-time percentiles from the fixed-width histogram stored in the
 * rollups. Summing histograms across days, lines and products is exact, which
 * averaging per-day percentiles would not be; the price is a resolution of
 * one bucket ({@value RollupGrid#CYCLE_BUCKET_MS} ms), narrowed by linear
 * interpolation inside the bucket.
 */
public final class CycleHistogram {

    private CycleHistogram() {}

    /**
     * @param counts boards per bucket; bucket {@code b} covers
     *     [{@code b * width}, {@code (b + 1) * width}) ms, and the last bucket
     *     everything above its lower edge
     * @param q quantile in (0, 1]
     * @return the estimated quantile in ms, or null when there are no boards
     */
    public static Integer percentile(long[] counts, double q) {
        if (q <= 0 || q > 1) {
            throw new IllegalArgumentException("q must be in (0, 1]: " + q);
        }
        long total = 0;
        for (long c : counts) {
            total += c;
        }
        if (total == 0) {
            return null;
        }
        double rank = q * total;
        long before = 0;
        int width = RollupGrid.CYCLE_BUCKET_MS;
        for (int b = 0; b < counts.length; b++) {
            long c = counts[b];
            if (c > 0 && before + c >= rank) {
                if (b == counts.length - 1) {
                    return b * width; // open-ended: report the lower edge
                }
                double within = (rank - before) / c;
                return (int) Math.round(b * width + within * width);
            }
            before += c;
        }
        return (counts.length - 1) * width;
    }
}
