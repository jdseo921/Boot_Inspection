package io.github.jdseo921.bootinspection.analytics;

import java.util.List;

/**
 * Where flagged regions fall on one board type, on a cols x rows grid over
 * the board outline. Only non-empty cells are listed.
 */
public record Heatmap(
        int productId,
        String partNumber,
        double boardWidthMm,
        double boardHeightMm,
        int cols,
        int rows,
        long total,
        long max,
        List<Cell> cells) {

    public record Cell(int cx, int cy, long count) {}
}
