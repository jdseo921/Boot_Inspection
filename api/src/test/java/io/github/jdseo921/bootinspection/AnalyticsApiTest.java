package io.github.jdseo921.bootinspection;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.within;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

class AnalyticsApiTest extends ApiTestSupport {

    private static final Instant DAY1 = Instant.parse("2026-10-20T15:00:00Z");
    private static final Instant DAY2 = Instant.parse("2026-10-21T15:00:00Z");
    private static final String RANGE = "from=2026-10-20&to=2026-10-21";

    /**
     * Day 1: 7 OK, 2 REVIEW, 1 NG on SMT-1. Day 2: 4 OK and 1 NG on SMT-2.
     * Cycle times 10,000 ms + 100 ms x board index. Reviews: one false call,
     * two confirmed; one board left pending.
     */
    @BeforeEach
    void seed() {
        List<Board> boards = new ArrayList<>();
        for (int i = 0; i < 7; i++) {
            boards.add(Board.ok(DAY1.plusSeconds(i * 20L)).withCycle(10_000 + 100 * i));
        }
        boards.add(Board.flagged(DAY1.plusSeconds(200), "REVIEW", defect("spur", 79.5, 49.5))
                .withCycle(10_700));
        boards.add(Board.flagged(DAY1.plusSeconds(220), "REVIEW", defect("spur", 0, 0), defect("short", 79.5, 49.5))
                .withCycle(10_800));
        boards.add(Board.flagged(DAY1.plusSeconds(240), "NG", defect("short", 79.5, 49.5)).withCycle(10_900));
        for (int i = 0; i < 4; i++) {
            boards.add(Board.ok(DAY2.plusSeconds(i * 20L)).withLine("SMT-2").withCycle(11_000 + 100 * i));
        }
        boards.add(Board.flagged(DAY2.plusSeconds(100), "NG", defect("open", 150, 90)).withLine("SMT-2")
                .withCycle(11_400));
        assertThat(post("/api/v1/inspections/batch", batchJson(boards)).status()).isEqualTo(200);

        review(8, "FALSE_CALL");
        review(10, "CONFIRMED_DEFECT");
        review(15, "CONFIRMED_DEFECT");
    }

    private void review(long id, String outcome) {
        Response r = post("/api/v1/inspections/" + id + "/review",
                "{\"outcome\":\"" + outcome + "\",\"reviewer\":\"op.kim\"}");
        assertThat(r.status()).isEqualTo(200);
    }

    @Test
    void summaryAddsUpTheRollups() {
        Response r = get("/api/v1/analytics/summary?" + RANGE);
        assertThat(r.status()).isEqualTo(200);
        Map<String, Object> s = r.read("$");

        assertThat(s).containsEntry("inspected", 15).containsEntry("ok", 11).containsEntry("review", 2)
                .containsEntry("ng", 2).containsEntry("confirmedDefects", 2).containsEntry("falseCalls", 1)
                .containsEntry("pendingReview", 1);
        assertThat(((Number) s.get("firstPassYield")).doubleValue()).isCloseTo(11.0 / 15, within(1e-9));
        // Good boards with a final answer: 11 passed + 1 cleared, out of 11 + 1 + 2 decided.
        assertThat(((Number) s.get("finalYield")).doubleValue()).isCloseTo(12.0 / 14, within(1e-9));
        assertThat(((Number) s.get("falseCallRate")).doubleValue()).isCloseTo(1.0 / 3, within(1e-9));
        double meanCycle = (10_000 * 7 + 100 * 21 + 10_700 + 10_800 + 10_900 + 11_000 * 4 + 100 * 6 + 11_400) / 15.0;
        assertThat(((Number) s.get("meanCycleMs")).doubleValue()).isCloseTo(meanCycle, within(1e-6));
        // 15 boards in 250 ms buckets: the median (rank 7.5) falls in [10,500, 10,750).
        int p50 = (Integer) s.get("p50CycleMs");
        assertThat(p50).isBetween(10_500, 10_750);
        int p95 = (Integer) s.get("p95CycleMs");
        assertThat(p95).isBetween(11_250, 11_500);
    }

    @Test
    void summaryFiltersByLine() {
        Map<String, Object> s = get("/api/v1/analytics/summary?" + RANGE + "&lineId=2").read("$");
        assertThat(s).containsEntry("inspected", 5).containsEntry("ng", 1).containsEntry("confirmedDefects", 1);
    }

    @Test
    void emptyPeriodHasNoRatios() {
        Map<String, Object> s = get("/api/v1/analytics/summary?from=2025-01-01&to=2025-01-31").read("$");
        assertThat(s).containsEntry("inspected", 0);
        assertThat(s.get("firstPassYield")).isNull();
        assertThat(s.get("p50CycleMs")).isNull();
    }

    @Test
    void trendHasOnePointPerDay() {
        Response r = get("/api/v1/analytics/yield-trend?" + RANGE);
        List<String> days = r.read("$[*].day");
        assertThat(days).containsExactly("2026-10-20", "2026-10-21");
        assertThat(((Number) r.read("$[0].firstPassYield")).doubleValue()).isCloseTo(0.7, within(1e-9));
        assertThat(((Number) r.read("$[1].firstPassYield")).doubleValue()).isCloseTo(0.8, within(1e-9));
    }

    @Test
    void paretoIsLargestFirstWithRunningShare() {
        Response r = get("/api/v1/analytics/defect-pareto?" + RANGE);
        // short x2, spur x2, open x1: ties broken by class order (short before spur).
        List<String> classes = r.read("$[*].defectClass");
        assertThat(classes).containsExactly("short", "spur", "open");
        assertThat(((Number) r.read("$[0].share")).doubleValue()).isCloseTo(0.4, within(1e-9));
        assertThat(((Number) r.read("$[2].cumulativeShare")).doubleValue()).isCloseTo(1.0, within(1e-9));
    }

    @Test
    void heatmapPutsEachBoxInTheCellOfItsCentre() {
        Response r = get("/api/v1/analytics/defect-heatmap?productId=1&" + RANGE);
        assertThat(r.status()).isEqualTo(200);
        assertThat((Integer) r.read("$.cols")).isEqualTo(24);
        assertThat((Integer) r.read("$.rows")).isEqualTo(16);
        assertThat((Integer) r.read("$.total")).isEqualTo(5);
        // Boxes at (79.5, 49.5) + 1 mm: centre (80, 50) on a 160 x 100 board -> cell (12, 8).
        List<Number> centre = r.read("$.cells[?(@.cx == 12 && @.cy == 8)].count");
        assertThat(centre).extracting(Number::intValue).containsExactly(3);
        // Box at the origin -> cell (0, 0). Box at (150, 90): centre (150.5, 90.5) -> cell (22, 14).
        List<Number> corner = r.read("$.cells[?(@.cx == 0 && @.cy == 0)].count");
        assertThat(corner).extracting(Number::intValue).containsExactly(1);
        List<Number> far = r.read("$.cells[?(@.cx == 22 && @.cy == 14)].count");
        assertThat(far).extracting(Number::intValue).containsExactly(1);

        Response shortsOnly = get("/api/v1/analytics/defect-heatmap?productId=1&defectClass=short&" + RANGE);
        assertThat((Integer) shortsOnly.read("$.total")).isEqualTo(2);
    }

    @Test
    void rejectsBadRanges() {
        assertThat(get("/api/v1/analytics/summary?from=2026-10-22&to=2026-10-21").status()).isEqualTo(400);
        assertThat(get("/api/v1/analytics/summary?from=2024-01-01&to=2026-10-21").status()).isEqualTo(400);
        assertThat(get("/api/v1/analytics/defect-heatmap?productId=99&" + RANGE).status()).isEqualTo(404);
        assertThat(get("/api/v1/analytics/defect-heatmap?" + RANGE).status()).isEqualTo(400);
        assertThat(get("/api/v1/analytics/defect-heatmap?productId=1&defectClass=dust&" + RANGE).status())
                .isEqualTo(400);
    }
}
