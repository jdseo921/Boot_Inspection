package io.github.jdseo921.bootinspection;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.Test;

class IngestApiTest extends ApiTestSupport {

    private static final Instant T0 = Instant.parse("2026-10-20T15:00:00Z");

    @Test
    void storesABoardAndItsDefects() {
        Board b = Board.flagged(T0, "NG", defect("short", 40, 30), defect("open", 100, 60));
        Response r = post("/api/v1/inspections", json(b));

        assertThat(r.status()).isEqualTo(201);
        assertThat((Boolean) r.read("$.created")).isTrue();
        long id = ((Number) r.read("$.id")).longValue();

        Response detail = get("/api/v1/inspections/" + id);
        assertThat(detail.status()).isEqualTo(200);
        assertThat((String) detail.read("$.inspection.verdict")).isEqualTo("NG");
        assertThat((String) detail.read("$.inspection.lineCode")).isEqualTo("SMT-1");
        assertThat((Integer) detail.read("$.inspection.defectCount")).isEqualTo(2);
        assertThat((List<?>) detail.read("$.defects")).hasSize(2);
        assertThat((String) detail.read("$.defects[0].defectClass")).isEqualTo("short");
        assertThat(((Number) detail.read("$.product.boardWidthMm")).doubleValue()).isEqualTo(160.0);
        assertThat((Integer) detail.read("$.profile.version")).isEqualTo(1);
    }

    @Test
    void retryingTheSameExternalIdIsANoOp() {
        Board b = Board.ok(T0);
        Response first = post("/api/v1/inspections", json(b));
        Response again = post("/api/v1/inspections", json(b));

        assertThat(first.status()).isEqualTo(201);
        assertThat(again.status()).isEqualTo(200);
        assertThat((Boolean) again.read("$.created")).isFalse();
        assertThat(((Number) again.read("$.id")).longValue()).isEqualTo(((Number) first.read("$.id")).longValue());
        assertThat(jdbc.sql("SELECT count(*) FROM inspection").query(Long.class).single()).isEqualTo(1L);
        assertThat(jdbc.sql("SELECT sum(inspected) FROM daily_yield").query(Long.class).single()).isEqualTo(1L);
    }

    @Test
    void batchReportsCreatedAndDuplicates() {
        Board known = Board.ok(T0);
        ingest(known);
        List<Board> batch = List.of(known, Board.ok(T0.plusSeconds(12)), Board.flagged(T0.plusSeconds(24), "REVIEW",
                defect("spur", 10, 10)));

        Response r = post("/api/v1/inspections/batch", batchJson(batch));

        assertThat(r.status()).isEqualTo(200);
        assertThat((Integer) r.read("$.received")).isEqualTo(3);
        assertThat((Integer) r.read("$.created")).isEqualTo(2);
        assertThat((Integer) r.read("$.duplicates")).isEqualTo(1);
        assertThat((Boolean) r.read("$.results[0].created")).isFalse();
        assertThat(jdbc.sql("SELECT count(*) FROM inspection").query(Long.class).single()).isEqualTo(3L);
        assertThat(jdbc.sql("SELECT count(*) FROM defect").query(Long.class).single()).isEqualTo(1L);
    }

    @Test
    void batchIsAllOrNothing() {
        List<Board> batch = List.of(Board.ok(T0), Board.ok(T0.plusSeconds(12)).withLine("SMT-9"));

        Response r = post("/api/v1/inspections/batch", batchJson(batch));

        assertThat(r.status()).isEqualTo(422);
        assertThat((String) r.read("$.detail")).contains("inspections[1]").contains("SMT-9");
        assertThat(jdbc.sql("SELECT count(*) FROM inspection").query(Long.class).single()).isZero();
    }

    @Test
    void assignsTheCalendarDayAtThePlantNotInUtc() {
        // 03:30 UTC on 1 Nov 2026 is 22:30 on 31 Oct in Chicago.
        long id = ingest(Board.ok(Instant.parse("2026-11-01T03:30:00Z")));

        Response detail = get("/api/v1/inspections/" + id);
        assertThat((String) detail.read("$.inspection.localDay")).isEqualTo("2026-10-31");
    }

    @Test
    void rejectsMalformedInputWithProblemDetails() {
        Response missing = post("/api/v1/inspections", "{\"serialNumber\":\"X\"}");
        assertThat(missing.status()).isEqualTo(400);
        assertThat((String) missing.read("$.title")).isNotBlank();

        Response badScore = post("/api/v1/inspections", json(Board.ok(T0)).replace("0.12", "1.7"));
        assertThat(badScore.status()).isEqualTo(400);

        Response notJson = post("/api/v1/inspections", "not json");
        assertThat(notJson.status()).isEqualTo(400);
    }

    @Test
    void rejectsBoardsThatDoNotFitTheCatalog() {
        assertThat(post("/api/v1/inspections", json(Board.ok(T0).withPart("PCB-9999"))).status()).isEqualTo(422);
        assertThat(post("/api/v1/inspections", json(Board.ok(T0).withPart(PART_B).withProfile(2))).status())
                .isEqualTo(422);
    }

    @Test
    void verdictAndFlaggedRegionsMustAgree() {
        Board okWithDefect = new Board(UUID.randomUUID(), "SN-1", "SMT-1", PART_A, 1, T0, "OK", 0.1,
                11_000, List.of(defect("spur", 1, 1)));
        Board ngWithout = Board.flagged(T0, "NG");

        assertThat(post("/api/v1/inspections", json(okWithDefect)).status()).isEqualTo(422);
        assertThat(post("/api/v1/inspections", json(ngWithout)).status()).isEqualTo(422);
    }

    @Test
    void rejectsADefectBoxOutsideTheBoard() {
        // PCB-1001 is 160 mm wide; a 1 mm box at x = 159.5 sticks out.
        Response r = post("/api/v1/inspections", json(Board.flagged(T0, "REVIEW", defect("copper", 159.5, 10))));
        assertThat(r.status()).isEqualTo(422);
        assertThat((String) r.read("$.detail")).contains("outside");
    }

    @Test
    void rejectsDuplicateIdsInsideOneBatch() {
        Board b = Board.ok(T0);
        Response r = post("/api/v1/inspections/batch", batchJson(List.of(b, b)));
        assertThat(r.status()).isEqualTo(422);
        assertThat((String) r.read("$.detail")).contains("twice");
    }

    @Test
    void capsBatchesAtOneThousand() {
        List<Board> boards = new ArrayList<>();
        for (int i = 0; i < 1001; i++) {
            boards.add(Board.ok(T0.plusSeconds(i)));
        }
        assertThat(post("/api/v1/inspections/batch", batchJson(boards)).status()).isEqualTo(400);
        assertThat(post("/api/v1/inspections/batch", batchJson(boards.subList(0, 1000))).status()).isEqualTo(200);
        assertThat(jdbc.sql("SELECT count(*) FROM inspection").query(Long.class).single()).isEqualTo(1000L);
    }
}
