package io.github.jdseo921.bootinspection.analytics;

import io.github.jdseo921.bootinspection.common.DayRange;
import io.github.jdseo921.bootinspection.common.DefectClass;
import io.github.jdseo921.bootinspection.common.RollupGrid;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.LocalDate;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;

/**
 * Reads only the daily rollup tables, never the raw inspection table, so the
 * cost of a dashboard query depends on days x lines x products, not on how
 * many boards were inspected.
 */
@Repository
public class AnalyticsRepository {

    /** Raw sums for a period, before ratios are worked out. */
    public record Totals(
            long inspected, long ok, long review, long ng, long confirmedDefects, long falseCalls, long cycleMsSum) {}

    public record DayTotals(LocalDate day, Totals totals) {}

    private final JdbcClient jdbc;

    public AnalyticsRepository(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    private static final String SUMS = """
            coalesce(sum(inspected), 0) AS inspected, coalesce(sum(ok), 0) AS ok,
            coalesce(sum(review), 0) AS review, coalesce(sum(ng), 0) AS ng,
            coalesce(sum(confirmed_defects), 0) AS confirmed_defects,
            coalesce(sum(false_calls), 0) AS false_calls, coalesce(sum(cycle_ms_sum), 0) AS cycle_ms_sum
            """;

    public Totals totals(DayRange range, Integer lineId, Integer productId) {
        Where w = where(range, lineId, productId, null);
        return jdbc.sql("SELECT " + SUMS + " FROM daily_yield" + w.sql)
                .params(w.params)
                .query((rs, n) -> totals(rs))
                .single();
    }

    public long[] cycleHistogram(DayRange range, Integer lineId, Integer productId) {
        Where w = where(range, lineId, productId, null);
        long[] counts = new long[RollupGrid.CYCLE_BUCKETS];
        jdbc.sql("SELECT u.k AS k, sum(u.v) AS n FROM daily_yield"
                        + " CROSS JOIN LATERAL unnest(cycle_hist) WITH ORDINALITY AS u(v, k)"
                        + w.sql + " GROUP BY u.k")
                .params(w.params)
                .query((ResultSet rs) -> {
                    counts[rs.getInt("k") - 1] = rs.getLong("n");
                });
        return counts;
    }

    public List<DayTotals> byDay(DayRange range, Integer lineId, Integer productId) {
        Where w = where(range, lineId, productId, null);
        return jdbc.sql("SELECT local_day, " + SUMS + " FROM daily_yield" + w.sql
                        + " GROUP BY local_day ORDER BY local_day")
                .params(w.params)
                .query((rs, n) -> new DayTotals(rs.getObject("local_day", LocalDate.class), totals(rs)))
                .list();
    }

    public Map<DefectClass, Long> defectCounts(DayRange range, Integer lineId, Integer productId) {
        Where w = where(range, lineId, productId, null);
        Map<DefectClass, Long> counts = new HashMap<>();
        jdbc.sql("SELECT defect_class, sum(n) AS n FROM daily_defects" + w.sql + " GROUP BY defect_class")
                .params(w.params)
                .query((ResultSet rs) -> {
                    counts.put(DefectClass.fromWire(rs.getString("defect_class")), rs.getLong("n"));
                });
        return counts;
    }

    public List<Heatmap.Cell> heatCells(DayRange range, Integer lineId, int productId, DefectClass defectClass) {
        Where w = where(range, lineId, productId, defectClass);
        return jdbc.sql("SELECT cx, cy, sum(n) AS n FROM daily_defect_cells" + w.sql
                        + " GROUP BY cx, cy ORDER BY cy, cx")
                .params(w.params)
                .query((rs, n) -> new Heatmap.Cell(rs.getInt("cx"), rs.getInt("cy"), rs.getLong("n")))
                .list();
    }

    private static Totals totals(ResultSet rs) throws SQLException {
        return new Totals(
                rs.getLong("inspected"),
                rs.getLong("ok"),
                rs.getLong("review"),
                rs.getLong("ng"),
                rs.getLong("confirmed_defects"),
                rs.getLong("false_calls"),
                rs.getLong("cycle_ms_sum"));
    }

    private record Where(String sql, Map<String, Object> params) {}

    private static Where where(DayRange range, Integer lineId, Integer productId, DefectClass defectClass) {
        StringBuilder sql = new StringBuilder(" WHERE local_day BETWEEN :from AND :to");
        Map<String, Object> params = new HashMap<>();
        params.put("from", range.from());
        params.put("to", range.to());
        if (lineId != null) {
            sql.append(" AND line_id = :lineId");
            params.put("lineId", lineId);
        }
        if (productId != null) {
            sql.append(" AND product_id = :productId");
            params.put("productId", productId);
        }
        if (defectClass != null) {
            sql.append(" AND defect_class = CAST(:defectClass AS defect_class)");
            params.put("defectClass", defectClass.wire());
        }
        return new Where(sql.toString(), params);
    }
}
