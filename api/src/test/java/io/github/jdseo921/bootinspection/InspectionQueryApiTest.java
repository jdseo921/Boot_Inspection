package io.github.jdseo921.bootinspection;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Instant;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import org.junit.jupiter.api.Test;

class InspectionQueryApiTest extends ApiTestSupport {

    private static final Instant T0 = Instant.parse("2026-10-20T15:00:00Z");

    @Test
    void pagesNewestFirstWithoutGapsOrRepeats() {
        List<Board> boards = new ArrayList<>();
        for (int i = 0; i < 25; i++) {
            // Pairs share a timestamp, so the id tie-breaker in the cursor matters.
            boards.add(Board.ok(T0.plusSeconds((i / 2) * 15L)));
        }
        assertThat(post("/api/v1/inspections/batch", batchJson(boards)).status()).isEqualTo(200);

        List<Long> seen = new ArrayList<>();
        String cursor = null;
        int pages = 0;
        do {
            Response page = get("/api/v1/inspections?limit=10" + (cursor == null ? "" : "&cursor=" + cursor));
            assertThat(page.status()).isEqualTo(200);
            List<Number> ids = page.read("$.items[*].id");
            ids.forEach(n -> seen.add(n.longValue()));
            cursor = page.read("$.nextCursor");
            pages++;
        } while (cursor != null);

        assertThat(pages).isEqualTo(3);
        assertThat(seen).hasSize(25).doesNotHaveDuplicates();
        Set<Long> all = new HashSet<>(jdbc.sql("SELECT id FROM inspection").query(Long.class).list());
        assertThat(new HashSet<>(seen)).isEqualTo(all);

        List<String> times = get("/api/v1/inspections?limit=25").read("$.items[*].inspectedAt");
        List<String> sorted = new ArrayList<>(times);
        sorted.sort((a, b) -> Instant.parse(b).compareTo(Instant.parse(a)));
        assertThat(times).isEqualTo(sorted);
    }

    @Test
    void filtersByLineVerdictAndReviewQueue() {
        ingest(Board.ok(T0));
        ingest(Board.ok(T0.plusSeconds(15)).withLine("SMT-2"));
        long pending = ingest(Board.flagged(T0.plusSeconds(30), "REVIEW", defect("spur", 5, 5)).withLine("SMT-2"));
        long reviewed = ingest(Board.flagged(T0.plusSeconds(45), "NG", defect("short", 5, 5)));
        post("/api/v1/inspections/" + reviewed + "/review", "{\"outcome\":\"CONFIRMED_DEFECT\",\"reviewer\":\"op.kim\"}");

        List<Number> line2 = get("/api/v1/inspections?lineId=2").read("$.items[*].id");
        assertThat(line2).hasSize(2);

        List<Number> ng = get("/api/v1/inspections?verdict=NG").read("$.items[*].id");
        assertThat(ng).extracting(Number::longValue).containsExactly(reviewed);

        List<Number> queue = get("/api/v1/inspections?status=pending").read("$.items[*].id");
        assertThat(queue).extracting(Number::longValue).containsExactly(pending);

        List<Number> done = get("/api/v1/inspections?status=reviewed").read("$.items[*].id");
        assertThat(done).extracting(Number::longValue).containsExactly(reviewed);
    }

    @Test
    void filtersByPlantCalendarDays() {
        // 2026-10-20 local (Chicago) runs from 05:00 UTC on the 20th to 05:00 UTC on the 21st.
        ingest(Board.ok(Instant.parse("2026-10-20T04:59:00Z"))); // still the 19th locally
        long in = ingest(Board.ok(Instant.parse("2026-10-20T05:00:00Z")));
        long late = ingest(Board.ok(Instant.parse("2026-10-21T04:59:00Z")));
        ingest(Board.ok(Instant.parse("2026-10-21T05:00:00Z"))); // the 21st locally

        List<Number> ids = get("/api/v1/inspections?from=2026-10-20&to=2026-10-20").read("$.items[*].id");
        assertThat(ids).extracting(Number::longValue).containsExactlyInAnyOrder(in, late);
    }

    @Test
    void findsABoardBySerialNumber() {
        ingest(Board.ok(T0).withSerial("PCB-1001-261020-L1-00042"));
        ingest(Board.ok(T0.plusSeconds(15)).withSerial("PCB-1001-261020-L1-00043"));

        List<String> found = get("/api/v1/inspections?serial=PCB-1001-261020-L1-00042").read("$.items[*].serialNumber");
        assertThat(found).containsExactly("PCB-1001-261020-L1-00042");
    }

    @Test
    void rejectsBadParameters() {
        assertThat(get("/api/v1/inspections?cursor=not-a-cursor").status()).isEqualTo(400);
        assertThat(get("/api/v1/inspections?limit=0").status()).isEqualTo(400);
        assertThat(get("/api/v1/inspections?limit=201").status()).isEqualTo(400);
        assertThat(get("/api/v1/inspections?status=maybe").status()).isEqualTo(400);
        assertThat(get("/api/v1/inspections?verdict=GOOD").status()).isEqualTo(400);
        assertThat(get("/api/v1/inspections?from=2026-10-21&to=2026-10-20").status()).isEqualTo(400);
        assertThat(get("/api/v1/inspections/12345").status()).isEqualTo(404);
    }

    @Test
    void listsTheCatalog() {
        List<String> lines = get("/api/v1/lines").read("$[*].code");
        assertThat(lines).containsExactly("SMT-1", "SMT-2", "SMT-3");
        List<String> parts = get("/api/v1/products").read("$[*].partNumber");
        assertThat(parts).containsExactly(PART_A, PART_B);
        List<Number> versions = get("/api/v1/profiles").read("$[*].version");
        assertThat(versions).hasSize(3);
    }

    @Test
    void reportsHealth() {
        Response r = get("/actuator/health");
        assertThat(r.status()).isEqualTo(200);
        assertThat((String) r.read("$.status")).isEqualTo("UP");
    }
}
