package io.github.jdseo921.bootinspection;

import com.jayway.jsonpath.DocumentContext;
import com.jayway.jsonpath.JsonPath;
import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import java.util.stream.Collectors;
import org.junit.jupiter.api.BeforeEach;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.test.context.ActiveProfiles;

/**
 * Base for end-to-end tests: the real application on a random port, a real
 * PostgreSQL database migrated by Flyway, and plain HTTP calls. Every test
 * starts from an empty database with the same small catalog.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@ActiveProfiles("test")
public abstract class ApiTestSupport {

    /** 160 x 100 mm board. */
    protected static final String PART_A = "PCB-1001";
    /** 120 x 80 mm board. */
    protected static final String PART_B = "PCB-2040";

    protected static final HttpClient HTTP =
            HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5)).build();

    @Value("${local.server.port}")
    protected int port;

    @Autowired
    protected JdbcClient jdbc;

    public record Response(int status, String body) {

        public DocumentContext json() {
            return JsonPath.parse(body);
        }

        public <T> T read(String path) {
            return JsonPath.read(body, path);
        }
    }

    @BeforeEach
    void resetDatabase() {
        jdbc.sql("TRUNCATE daily_defect_cells, daily_defects, daily_yield, defect, inspection, threshold_profile,"
                        + " product, line RESTART IDENTITY")
                .update();
        jdbc.sql("INSERT INTO line (code, name, site) VALUES ('SMT-1', 'SMT Line 1', 'Plant 1'),"
                        + " ('SMT-2', 'SMT Line 2', 'Plant 1'), ('SMT-3', 'SMT Line 3', 'Plant 1')")
                .update();
        jdbc.sql("INSERT INTO product (part_number, name, board_width_mm, board_height_mm) VALUES"
                        + " ('PCB-1001', 'Motor controller', 160, 100), ('PCB-2040', 'Battery monitor', 120, 80)")
                .update();
        jdbc.sql("INSERT INTO threshold_profile (product_id, version, pixel_diff, min_defect_area_px,"
                        + " model_threshold, approved_by, approved_at) VALUES"
                        + " (1, 1, 28, 12, 0.62, 'eng.park', '2026-01-05T09:00:00Z'),"
                        + " (1, 2, 32, 16, 0.68, 'eng.park', '2026-06-01T09:00:00Z'),"
                        + " (2, 1, 28, 12, 0.62, 'eng.park', '2026-01-05T09:00:00Z')")
                .update();
    }

    protected Response get(String path) {
        return send(HttpRequest.newBuilder(uri(path)).GET().build());
    }

    protected Response post(String path, String json) {
        return send(HttpRequest.newBuilder(uri(path))
                .header("Content-Type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString(json))
                .build());
    }

    private URI uri(String path) {
        return URI.create("http://localhost:" + port + path);
    }

    private static Response send(HttpRequest request) {
        try {
            HttpResponse<String> r = HTTP.send(request, HttpResponse.BodyHandlers.ofString());
            return new Response(r.statusCode(), r.body());
        } catch (IOException e) {
            throw new IllegalStateException(e);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException(e);
        }
    }

    /** Builds the JSON for one board; see {@link Board}. */
    protected static String json(Board b) {
        String defects = b.defects.stream()
                .map(d -> """
                        {"defectClass":"%s","xMm":%s,"yMm":%s,"wMm":%s,"hMm":%s,"confidence":%s}"""
                        .formatted(d.cls, d.x, d.y, d.w, d.h, d.confidence))
                .collect(Collectors.joining(","));
        return """
                {"externalId":"%s","serialNumber":"%s","lineCode":"%s","partNumber":"%s","profileVersion":%d,
                 "inspectedAt":"%s","verdict":"%s","anomalyScore":%s,"cycleMs":%d,"defects":[%s]}"""
                .formatted(b.externalId, b.serial, b.lineCode, b.partNumber, b.profileVersion, b.inspectedAt,
                        b.verdict, b.score, b.cycleMs, defects);
    }

    protected static String batchJson(List<Board> boards) {
        return "{\"inspections\":[" + boards.stream().map(ApiTestSupport::json).collect(Collectors.joining(","))
                + "]}";
    }

    public record DefectSpec(String cls, double x, double y, double w, double h, double confidence) {}

    /** A test board with sensible defaults; copy-and-change with the with* methods. */
    public record Board(
            UUID externalId,
            String serial,
            String lineCode,
            String partNumber,
            int profileVersion,
            Instant inspectedAt,
            String verdict,
            double score,
            int cycleMs,
            List<DefectSpec> defects) {

        public static Board ok(Instant at) {
            return new Board(UUID.randomUUID(), "SN-" + at.toEpochMilli(), "SMT-1", PART_A, 1, at, "OK", 0.12,
                    11_000, List.of());
        }

        public static Board flagged(Instant at, String verdict, DefectSpec... defects) {
            return new Board(UUID.randomUUID(), "SN-" + at.toEpochMilli(), "SMT-1", PART_A, 1, at, verdict, 0.8,
                    11_000, List.of(defects));
        }

        public Board withLine(String code) {
            return new Board(externalId, serial, code, partNumber, profileVersion, inspectedAt, verdict, score,
                    cycleMs, defects);
        }

        public Board withPart(String part) {
            return new Board(externalId, serial, lineCode, part, profileVersion, inspectedAt, verdict, score,
                    cycleMs, defects);
        }

        public Board withProfile(int version) {
            return new Board(externalId, serial, lineCode, partNumber, version, inspectedAt, verdict, score,
                    cycleMs, defects);
        }

        public Board withCycle(int ms) {
            return new Board(externalId, serial, lineCode, partNumber, profileVersion, inspectedAt, verdict, score,
                    ms, defects);
        }

        public Board withSerial(String s) {
            return new Board(externalId, s, lineCode, partNumber, profileVersion, inspectedAt, verdict, score,
                    cycleMs, defects);
        }
    }

    protected static DefectSpec defect(String cls, double x, double y) {
        return new DefectSpec(cls, x, y, 1.0, 1.0, 0.9);
    }

    /** Ingests one board and returns its id. */
    protected long ingest(Board b) {
        Response r = post("/api/v1/inspections", json(b));
        if (r.status() != 201) {
            throw new AssertionError("ingest failed: " + r.status() + " " + r.body());
        }
        return ((Number) r.read("$.id")).longValue();
    }
}
