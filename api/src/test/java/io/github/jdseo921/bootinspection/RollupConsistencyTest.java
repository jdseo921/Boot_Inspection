package io.github.jdseo921.bootinspection;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Random;
import java.util.Set;
import java.util.TreeSet;
import org.junit.jupiter.api.Test;

/**
 * The API keeps the daily rollups up to date incrementally (one upsert per
 * ingest batch and per review). This test drives a random mix of batches,
 * retries and reviews through the API, then recomputes the rollups from the
 * raw tables with rebuild_rollups() and requires an exact match.
 */
class RollupConsistencyTest extends ApiTestSupport {

    private static final String[] LINES = {"SMT-1", "SMT-2", "SMT-3"};
    private static final String[] CLASSES = {"open", "short", "mousebite", "spur", "copper", "pin_hole"};

    @Test
    void incrementalRollupsMatchAFullRebuild() {
        Random rnd = new Random(20261028L);
        Instant start = Instant.parse("2026-10-01T00:00:00Z");
        List<Board> sent = new ArrayList<>();

        for (int batch = 0; batch < 12; batch++) {
            List<Board> boards = new ArrayList<>();
            int size = 20 + rnd.nextInt(60);
            for (int i = 0; i < size; i++) {
                Instant at = start.plusSeconds(rnd.nextInt(10 * 24 * 3600)); // spans DST-free days and midnights
                boolean partA = rnd.nextBoolean();
                double width = partA ? 160 : 120;
                double height = partA ? 100 : 80;
                Board b;
                double roll = rnd.nextDouble();
                if (roll < 0.85) {
                    b = Board.ok(at);
                } else {
                    int n = 1 + rnd.nextInt(3);
                    DefectSpec[] defects = new DefectSpec[n];
                    for (int k = 0; k < n; k++) {
                        defects[k] = new DefectSpec(CLASSES[rnd.nextInt(CLASSES.length)],
                                Math.floor(rnd.nextDouble() * (width - 3)), Math.floor(rnd.nextDouble() * (height - 3)),
                                1 + rnd.nextInt(2), 1 + rnd.nextInt(2), 0.5 + rnd.nextDouble() / 2);
                    }
                    b = Board.flagged(at, roll < 0.95 ? "REVIEW" : "NG", defects);
                }
                b = b.withLine(LINES[rnd.nextInt(LINES.length)])
                        .withPart(partA ? PART_A : PART_B)
                        .withCycle(8_000 + rnd.nextInt(8_000));
                if (rnd.nextInt(40) == 0) {
                    b = b.withCycle(31_000); // lands in the open-ended last bucket
                }
                boards.add(b);
            }
            // Re-send a few boards from earlier batches, as a station would after a timeout.
            Set<Integer> picks = new TreeSet<>();
            while (!sent.isEmpty() && picks.size() < Math.min(3, sent.size())) {
                picks.add(rnd.nextInt(sent.size()));
            }
            for (int p : picks) {
                boards.add(sent.get(p));
            }
            sent.addAll(boards.subList(0, size));
            Response res = post("/api/v1/inspections/batch", batchJson(boards));
            assertThat(res.status()).as(res.body()).isEqualTo(200);
        }

        List<Long> flagged = jdbc.sql("SELECT id FROM inspection WHERE verdict <> 'OK' ORDER BY id")
                .query(Long.class)
                .list();
        assertThat(flagged).isNotEmpty();
        for (int i = 0; i < flagged.size(); i++) {
            if (i % 3 == 2) {
                continue; // leave some in the review queue
            }
            String outcome = i % 2 == 0 ? "CONFIRMED_DEFECT" : "FALSE_CALL";
            Response r = post("/api/v1/inspections/" + flagged.get(i) + "/review",
                    "{\"outcome\":\"" + outcome + "\",\"reviewer\":\"op.test\"}");
            assertThat(r.status()).isEqualTo(200);
        }

        List<String> yieldBefore = rows("daily_yield");
        List<String> defectsBefore = rows("daily_defects");
        List<String> cellsBefore = rows("daily_defect_cells");

        jdbc.sql("SELECT rebuild_rollups()").query().listOfRows();

        assertThat(yieldBefore).isNotEmpty();
        assertThat(defectsBefore).isNotEmpty();
        assertThat(yieldBefore).isEqualTo(rows("daily_yield"));
        assertThat(defectsBefore).isEqualTo(rows("daily_defects"));
        assertThat(cellsBefore).isEqualTo(rows("daily_defect_cells"));
        long boards = jdbc.sql("SELECT count(*) FROM inspection").query(Long.class).single();
        assertThat(jdbc.sql("SELECT sum(inspected) FROM daily_yield").query(Long.class).single()).isEqualTo(boards);
    }

    /** Every row of a rollup table as JSON text, in a fixed order, so tables compare by value. */
    private List<String> rows(String table) {
        return jdbc.sql("SELECT to_jsonb(t)::text FROM " + table + " t ORDER BY 1").query(String.class).list();
    }
}
