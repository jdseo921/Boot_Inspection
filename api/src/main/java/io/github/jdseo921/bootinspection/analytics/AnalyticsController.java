package io.github.jdseo921.bootinspection.analytics;

import io.github.jdseo921.bootinspection.common.AppProperties;
import io.github.jdseo921.bootinspection.common.DayRange;
import io.github.jdseo921.bootinspection.common.DefectClass;
import java.time.Clock;
import java.time.LocalDate;
import java.util.List;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * Dashboard queries. {@code from} and {@code to} are inclusive plant calendar
 * days; without them the last 30 days up to today are used.
 */
@RestController
@RequestMapping("/api/v1/analytics")
public class AnalyticsController {

    private final AnalyticsService service;
    private final AppProperties app;
    private final Clock clock;

    public AnalyticsController(AnalyticsService service, AppProperties app, Clock clock) {
        this.service = service;
        this.app = app;
        this.clock = clock;
    }

    @GetMapping("/summary")
    public Summary summary(
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate from,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate to,
            @RequestParam(required = false) Integer lineId,
            @RequestParam(required = false) Integer productId) {
        return service.summary(range(from, to), lineId, productId);
    }

    @GetMapping("/yield-trend")
    public List<TrendPoint> yieldTrend(
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate from,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate to,
            @RequestParam(required = false) Integer lineId,
            @RequestParam(required = false) Integer productId) {
        return service.trend(range(from, to), lineId, productId);
    }

    @GetMapping("/defect-pareto")
    public List<ParetoBar> defectPareto(
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate from,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate to,
            @RequestParam(required = false) Integer lineId,
            @RequestParam(required = false) Integer productId) {
        return service.pareto(range(from, to), lineId, productId);
    }

    /** Per board type, because the grid is laid over that board's outline. */
    @GetMapping("/defect-heatmap")
    public Heatmap defectHeatmap(
            @RequestParam int productId,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate from,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate to,
            @RequestParam(required = false) Integer lineId,
            @RequestParam(required = false) DefectClass defectClass) {
        return service.heatmap(range(from, to), lineId, productId, defectClass);
    }

    private DayRange range(LocalDate from, LocalDate to) {
        return DayRange.of(from, to, clock, app.zone());
    }
}
