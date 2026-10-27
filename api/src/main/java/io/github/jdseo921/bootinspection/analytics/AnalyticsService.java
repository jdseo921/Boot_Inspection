package io.github.jdseo921.bootinspection.analytics;

import io.github.jdseo921.bootinspection.catalog.CatalogRepository;
import io.github.jdseo921.bootinspection.common.ApiException;
import io.github.jdseo921.bootinspection.common.DayRange;
import io.github.jdseo921.bootinspection.common.DefectClass;
import io.github.jdseo921.bootinspection.common.RollupGrid;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class AnalyticsService {

    private final AnalyticsRepository rollups;
    private final CatalogRepository catalog;

    public AnalyticsService(AnalyticsRepository rollups, CatalogRepository catalog) {
        this.rollups = rollups;
        this.catalog = catalog;
    }

    @Transactional(readOnly = true)
    public Summary summary(DayRange range, Integer lineId, Integer productId) {
        AnalyticsRepository.Totals t = rollups.totals(range, lineId, productId);
        long[] hist = rollups.cycleHistogram(range, lineId, productId);
        long flagged = t.review() + t.ng();
        long reviewed = t.confirmedDefects() + t.falseCalls();
        long decided = t.ok() + reviewed;
        return new Summary(
                range.from(),
                range.to(),
                t.inspected(),
                t.ok(),
                t.review(),
                t.ng(),
                t.confirmedDefects(),
                t.falseCalls(),
                flagged - reviewed,
                ratio(t.ok(), t.inspected()),
                ratio(t.ok() + t.falseCalls(), decided),
                ratio(t.falseCalls(), reviewed),
                t.inspected() == 0 ? null : (double) t.cycleMsSum() / t.inspected(),
                CycleHistogram.percentile(hist, 0.50),
                CycleHistogram.percentile(hist, 0.95));
    }

    @Transactional(readOnly = true)
    public List<TrendPoint> trend(DayRange range, Integer lineId, Integer productId) {
        List<TrendPoint> points = new ArrayList<>();
        for (AnalyticsRepository.DayTotals d : rollups.byDay(range, lineId, productId)) {
            AnalyticsRepository.Totals t = d.totals();
            points.add(new TrendPoint(
                    d.day(),
                    t.inspected(),
                    t.ok(),
                    t.review(),
                    t.ng(),
                    t.confirmedDefects(),
                    t.falseCalls(),
                    ratio(t.ok(), t.inspected()),
                    ratio(t.falseCalls(), t.confirmedDefects() + t.falseCalls())));
        }
        return points;
    }

    @Transactional(readOnly = true)
    public List<ParetoBar> pareto(DayRange range, Integer lineId, Integer productId) {
        Map<DefectClass, Long> counts = rollups.defectCounts(range, lineId, productId);
        long total = counts.values().stream().mapToLong(Long::longValue).sum();
        List<Map.Entry<DefectClass, Long>> sorted = new ArrayList<>(counts.entrySet());
        // Largest first; ties in a fixed order so the chart does not reshuffle.
        sorted.sort(Map.Entry.<DefectClass, Long>comparingByValue(Comparator.reverseOrder())
                .thenComparing(Map.Entry.<DefectClass, Long>comparingByKey()));
        List<ParetoBar> bars = new ArrayList<>();
        long running = 0;
        for (Map.Entry<DefectClass, Long> e : sorted) {
            running += e.getValue();
            bars.add(new ParetoBar(e.getKey(), e.getValue(), (double) e.getValue() / total, (double) running / total));
        }
        return bars;
    }

    @Transactional(readOnly = true)
    public Heatmap heatmap(DayRange range, Integer lineId, int productId, DefectClass defectClass) {
        CatalogRepository.Product product = catalog.products().stream()
                .filter(p -> p.id() == productId)
                .findFirst()
                .orElseThrow(() -> ApiException.notFound("no product with id " + productId));
        List<Heatmap.Cell> cells = rollups.heatCells(range, lineId, productId, defectClass);
        long total = 0;
        long max = 0;
        for (Heatmap.Cell c : cells) {
            total += c.count();
            max = Math.max(max, c.count());
        }
        return new Heatmap(
                product.id(),
                product.partNumber(),
                product.boardWidthMm(),
                product.boardHeightMm(),
                RollupGrid.HEAT_COLS,
                RollupGrid.HEAT_ROWS,
                total,
                max,
                cells);
    }

    private static Double ratio(long numerator, long denominator) {
        return denominator == 0 ? null : (double) numerator / denominator;
    }
}
