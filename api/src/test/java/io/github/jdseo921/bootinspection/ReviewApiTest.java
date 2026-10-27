package io.github.jdseo921.bootinspection;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import org.junit.jupiter.api.Test;

class ReviewApiTest extends ApiTestSupport {

    private static final Instant T0 = Instant.parse("2026-10-20T15:00:00Z");
    private static final String SUMMARY = "/api/v1/analytics/summary?from=2026-10-20&to=2026-10-20";

    @Test
    void recordsTheDecisionAndUpdatesTheRollups() {
        long id = ingest(Board.flagged(T0, "REVIEW", defect("spur", 10, 10)));
        assertThat((Integer) get(SUMMARY).read("$.pendingReview")).isEqualTo(1);

        Response r = post("/api/v1/inspections/" + id + "/review",
                "{\"outcome\":\"FALSE_CALL\",\"reviewer\":\"op.kim\"}");

        assertThat(r.status()).isEqualTo(200);
        assertThat((String) r.read("$.reviewOutcome")).isEqualTo("FALSE_CALL");
        assertThat((String) r.read("$.reviewedBy")).isEqualTo("op.kim");
        assertThat((String) r.read("$.reviewedAt")).isNotBlank();
        Response summary = get(SUMMARY);
        assertThat((Integer) summary.read("$.pendingReview")).isZero();
        assertThat((Integer) summary.read("$.falseCalls")).isEqualTo(1);
    }

    @Test
    void aBoardIsReviewedOnlyOnce() {
        long id = ingest(Board.flagged(T0, "NG", defect("short", 10, 10)));
        String body = "{\"outcome\":\"CONFIRMED_DEFECT\",\"reviewer\":\"op.kim\"}";

        assertThat(post("/api/v1/inspections/" + id + "/review", body).status()).isEqualTo(200);
        Response second = post("/api/v1/inspections/" + id + "/review",
                "{\"outcome\":\"FALSE_CALL\",\"reviewer\":\"op.lee\"}");

        assertThat(second.status()).isEqualTo(409);
        assertThat((String) second.read("$.detail")).contains("CONFIRMED_DEFECT").contains("op.kim");
        assertThat((Integer) get(SUMMARY).read("$.confirmedDefects")).isEqualTo(1);
    }

    @Test
    void passedBoardsCannotBeReviewed() {
        long id = ingest(Board.ok(T0));
        Response r = post("/api/v1/inspections/" + id + "/review",
                "{\"outcome\":\"FALSE_CALL\",\"reviewer\":\"op.kim\"}");
        assertThat(r.status()).isEqualTo(409);
    }

    @Test
    void unknownBoardIs404AndBadBodyIs400() {
        assertThat(post("/api/v1/inspections/999/review", "{\"outcome\":\"FALSE_CALL\",\"reviewer\":\"op.kim\"}")
                        .status())
                .isEqualTo(404);
        long id = ingest(Board.flagged(T0, "NG", defect("short", 10, 10)));
        assertThat(post("/api/v1/inspections/" + id + "/review", "{\"outcome\":\"MAYBE\",\"reviewer\":\"op.kim\"}")
                        .status())
                .isEqualTo(400);
        assertThat(post("/api/v1/inspections/" + id + "/review", "{\"outcome\":\"FALSE_CALL\",\"reviewer\":\" \"}")
                        .status())
                .isEqualTo(400);
    }

    @Test
    void concurrentReviewersCannotBothWin() throws Exception {
        long id = ingest(Board.flagged(T0, "REVIEW", defect("copper", 50, 50)));
        int reviewers = 8;
        CountDownLatch start = new CountDownLatch(1);
        ExecutorService pool = Executors.newFixedThreadPool(reviewers);
        try {
            List<Future<Integer>> results = new ArrayList<>();
            for (int i = 0; i < reviewers; i++) {
                String body = "{\"outcome\":\"" + (i % 2 == 0 ? "FALSE_CALL" : "CONFIRMED_DEFECT")
                        + "\",\"reviewer\":\"op." + i + "\"}";
                results.add(pool.submit(() -> {
                    start.await();
                    return post("/api/v1/inspections/" + id + "/review", body).status();
                }));
            }
            start.countDown();
            List<Integer> statuses = new ArrayList<>();
            for (Future<Integer> f : results) {
                statuses.add(f.get());
            }
            assertThat(statuses).containsOnly(200, 409);
            assertThat(statuses.stream().filter(s -> s == 200).count()).isEqualTo(1);
        } finally {
            pool.shutdownNow();
        }
        Response summary = get(SUMMARY);
        int decided = (Integer) summary.read("$.confirmedDefects") + (Integer) summary.read("$.falseCalls");
        assertThat(decided).isEqualTo(1);
        assertThat((Integer) summary.read("$.pendingReview")).isZero();
    }
}
