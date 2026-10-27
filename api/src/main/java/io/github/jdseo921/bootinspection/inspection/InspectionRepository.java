package io.github.jdseo921.bootinspection.inspection;

import io.github.jdseo921.bootinspection.common.DefectClass;
import io.github.jdseo921.bootinspection.common.PgArrays;
import io.github.jdseo921.bootinspection.common.ReviewOutcome;
import io.github.jdseo921.bootinspection.common.Verdict;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.Collection;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.function.Function;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;

@Repository
public class InspectionRepository {

    /** A row ready to insert, with codes already resolved to ids. */
    public record NewInspection(
            UUID externalId,
            String serialNumber,
            int productId,
            int lineId,
            int profileId,
            Instant inspectedAt,
            Verdict verdict,
            double anomalyScore,
            int cycleMs,
            List<DefectIn> defects) {}

    private static final String SELECT_VIEW = """
            SELECT i.id, i.external_id, i.serial_number, i.line_id, l.code AS line_code,
                   i.product_id, p.part_number, tp.version AS profile_version,
                   i.inspected_at, i.local_day, i.verdict, i.anomaly_score, i.cycle_ms,
                   i.review_outcome, i.reviewed_by, i.reviewed_at,
                   (SELECT count(*) FROM defect d WHERE d.inspection_id = i.id) AS defect_count
            FROM inspection i
            JOIN line l ON l.id = i.line_id
            JOIN product p ON p.id = i.product_id
            JOIN threshold_profile tp ON tp.id = i.profile_id
            """;

    private final JdbcClient jdbc;

    public InspectionRepository(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    /**
     * Inserts the rows whose externalId is new, in one statement, and returns
     * externalId to id for the rows actually inserted. Rows already stored are
     * skipped untouched (idempotent retries).
     */
    public Map<UUID, Long> insertNew(List<NewInspection> rows, ZoneId plantZone) {
        if (rows.isEmpty()) {
            return Map.of();
        }
        record Inserted(UUID externalId, long id) {}
        List<Inserted> inserted = jdbc.sql("""
                        INSERT INTO inspection (external_id, serial_number, product_id, line_id, profile_id,
                                                inspected_at, local_day, verdict, anomaly_score, cycle_ms)
                        SELECT r.external_id, r.serial_number, r.product_id, r.line_id, r.profile_id,
                               r.inspected_at, (r.inspected_at AT TIME ZONE :zone)::date,
                               CAST(r.verdict AS verdict), r.anomaly_score, r.cycle_ms
                        FROM unnest(CAST(:externalIds AS uuid[]), CAST(:serials AS text[]),
                                    CAST(:productIds AS smallint[]), CAST(:lineIds AS smallint[]),
                                    CAST(:profileIds AS integer[]), CAST(:inspectedAts AS timestamptz[]),
                                    CAST(:verdicts AS text[]), CAST(:scores AS real[]), CAST(:cycles AS integer[]))
                             AS r(external_id, serial_number, product_id, line_id, profile_id,
                                  inspected_at, verdict, anomaly_score, cycle_ms)
                        ON CONFLICT (external_id) DO NOTHING
                        RETURNING id, external_id
                        """)
                .param("zone", plantZone.getId())
                .param("externalIds", PgArrays.text(map(rows, NewInspection::externalId)))
                .param("serials", PgArrays.text(map(rows, NewInspection::serialNumber)))
                .param("productIds", PgArrays.text(map(rows, NewInspection::productId)))
                .param("lineIds", PgArrays.text(map(rows, NewInspection::lineId)))
                .param("profileIds", PgArrays.text(map(rows, NewInspection::profileId)))
                .param("inspectedAts", PgArrays.text(map(rows, NewInspection::inspectedAt)))
                .param("verdicts", PgArrays.text(map(rows, r -> r.verdict().name())))
                .param("scores", PgArrays.text(map(rows, NewInspection::anomalyScore)))
                .param("cycles", PgArrays.text(map(rows, NewInspection::cycleMs)))
                .query((rs, n) -> new Inserted(rs.getObject("external_id", UUID.class), rs.getLong("id")))
                .list();
        Map<UUID, Long> created = new HashMap<>();
        for (Inserted row : inserted) {
            created.put(row.externalId(), row.id());
        }
        return created;
    }

    public void insertDefects(List<NewInspection> rows, Map<UUID, Long> ids) {
        List<Long> inspectionIds = new ArrayList<>();
        List<String> classes = new ArrayList<>();
        List<Double> xs = new ArrayList<>();
        List<Double> ys = new ArrayList<>();
        List<Double> ws = new ArrayList<>();
        List<Double> hs = new ArrayList<>();
        List<Double> confidences = new ArrayList<>();
        for (NewInspection row : rows) {
            Long id = ids.get(row.externalId());
            if (id == null) {
                continue;
            }
            for (DefectIn d : row.defects()) {
                inspectionIds.add(id);
                classes.add(d.defectClass().wire());
                xs.add(d.xMm());
                ys.add(d.yMm());
                ws.add(d.wMm());
                hs.add(d.hMm());
                confidences.add(d.confidence());
            }
        }
        if (inspectionIds.isEmpty()) {
            return;
        }
        jdbc.sql("""
                        INSERT INTO defect (inspection_id, defect_class, x_mm, y_mm, w_mm, h_mm, confidence)
                        SELECT d.inspection_id, CAST(d.defect_class AS defect_class),
                               d.x_mm, d.y_mm, d.w_mm, d.h_mm, d.confidence
                        FROM unnest(CAST(:ids AS bigint[]), CAST(:classes AS text[]), CAST(:xs AS real[]),
                                    CAST(:ys AS real[]), CAST(:ws AS real[]), CAST(:hs AS real[]),
                                    CAST(:confidences AS real[]))
                             AS d(inspection_id, defect_class, x_mm, y_mm, w_mm, h_mm, confidence)
                        """)
                .param("ids", PgArrays.text(inspectionIds))
                .param("classes", PgArrays.text(classes))
                .param("xs", PgArrays.text(xs))
                .param("ys", PgArrays.text(ys))
                .param("ws", PgArrays.text(ws))
                .param("hs", PgArrays.text(hs))
                .param("confidences", PgArrays.text(confidences))
                .update();
    }

    /** Adds just-inserted boards to the daily rollups; same transaction as the insert. */
    public void addToRollups(Collection<Long> inspectionIds) {
        if (inspectionIds.isEmpty()) {
            return;
        }
        jdbc.sql("SELECT rollup_add_inspections(CAST(:ids AS bigint[]))")
                .param("ids", PgArrays.text(inspectionIds))
                .query()
                .listOfRows();
    }

    public Map<UUID, Long> idsByExternalId(Collection<UUID> externalIds) {
        Map<UUID, Long> found = new HashMap<>();
        if (externalIds.isEmpty()) {
            return found;
        }
        jdbc.sql("SELECT id, external_id FROM inspection WHERE external_id = ANY(CAST(:ids AS uuid[]))")
                .param("ids", PgArrays.text(externalIds))
                .query((ResultSet rs) -> {
                    found.put(rs.getObject("external_id", UUID.class), rs.getLong("id"));
                });
        return found;
    }

    public List<InspectionView> find(InspectionFilter f) {
        StringBuilder sql = new StringBuilder(SELECT_VIEW).append(" WHERE true");
        Map<String, Object> params = new HashMap<>();
        if (f.fromTs() != null) {
            sql.append(" AND i.inspected_at >= :fromTs");
            params.put("fromTs", f.fromTs());
        }
        if (f.toTs() != null) {
            sql.append(" AND i.inspected_at < :toTs");
            params.put("toTs", f.toTs());
        }
        if (f.lineId() != null) {
            sql.append(" AND i.line_id = :lineId");
            params.put("lineId", f.lineId());
        }
        if (f.productId() != null) {
            sql.append(" AND i.product_id = :productId");
            params.put("productId", f.productId());
        }
        if (f.verdict() != null) {
            sql.append(" AND i.verdict = CAST(:verdict AS verdict)");
            params.put("verdict", f.verdict().name());
        }
        if (f.status() == InspectionFilter.ReviewStatus.PENDING) {
            // Written exactly as the partial index inspection_pending_review_idx.
            sql.append(" AND i.verdict <> 'OK' AND i.review_outcome IS NULL");
        } else if (f.status() == InspectionFilter.ReviewStatus.REVIEWED) {
            sql.append(" AND i.review_outcome IS NOT NULL");
        }
        if (f.serialNumber() != null) {
            sql.append(" AND i.serial_number = :serial");
            params.put("serial", f.serialNumber());
        }
        if (f.after() != null) {
            sql.append(f.oldestFirst()
                    ? " AND (i.inspected_at, i.id) > (:afterTs, :afterId)"
                    : " AND (i.inspected_at, i.id) < (:afterTs, :afterId)");
            params.put("afterTs", OffsetDateTime.ofInstant(f.after().inspectedAt(), ZoneOffset.UTC));
            params.put("afterId", f.after().id());
        }
        sql.append(f.oldestFirst()
                ? " ORDER BY i.inspected_at, i.id LIMIT :limit"
                : " ORDER BY i.inspected_at DESC, i.id DESC LIMIT :limit");
        params.put("limit", f.limit());
        return jdbc.sql(sql.toString()).params(params).query(InspectionRepository::view).list();
    }

    public Optional<InspectionView> findView(long id) {
        return jdbc.sql(SELECT_VIEW + " WHERE i.id = :id").param("id", id).query(InspectionRepository::view).optional();
    }

    /** Product, line and profile ids of a board, for the detail page. */
    public record Refs(int productId, int lineId, int profileId) {}

    public Optional<Refs> refs(long id) {
        return jdbc.sql("SELECT product_id, line_id, profile_id FROM inspection WHERE id = :id")
                .param("id", id)
                .query((rs, n) -> new Refs(rs.getInt("product_id"), rs.getInt("line_id"), rs.getInt("profile_id")))
                .optional();
    }

    public List<DefectView> defects(long inspectionId) {
        return jdbc.sql("""
                        SELECT id, defect_class, x_mm, y_mm, w_mm, h_mm, confidence
                        FROM defect WHERE inspection_id = :id ORDER BY id
                        """)
                .param("id", inspectionId)
                .query((rs, n) -> new DefectView(
                        rs.getLong("id"),
                        DefectClass.fromWire(rs.getString("defect_class")),
                        rs.getDouble("x_mm"),
                        rs.getDouble("y_mm"),
                        rs.getDouble("w_mm"),
                        rs.getDouble("h_mm"),
                        rs.getDouble("confidence")))
                .list();
    }

    /**
     * Records the decision only if the board is flagged and still undecided.
     * Two operators submitting at once: the second UPDATE waits for the first,
     * re-checks the WHERE clause and matches nothing.
     *
     * @return true if this call recorded the decision
     */
    public boolean recordReview(long id, ReviewOutcome outcome, String reviewer) {
        int updated = jdbc.sql("""
                        UPDATE inspection
                        SET review_outcome = CAST(:outcome AS review_outcome), reviewed_by = :reviewer, reviewed_at = now()
                        WHERE id = :id AND verdict <> 'OK' AND review_outcome IS NULL
                        """)
                .param("outcome", outcome.name())
                .param("reviewer", reviewer)
                .param("id", id)
                .update();
        if (updated == 1) {
            jdbc.sql("SELECT rollup_add_review(:id, CAST(:outcome AS review_outcome))")
                    .param("id", id)
                    .param("outcome", outcome.name())
                    .query()
                    .listOfRows();
        }
        return updated == 1;
    }

    private static <T, R> List<R> map(List<T> rows, Function<T, R> f) {
        List<R> out = new ArrayList<>(rows.size());
        for (T row : rows) {
            out.add(f.apply(row));
        }
        return out;
    }

    private static InspectionView view(ResultSet rs, int rowNum) throws SQLException {
        String outcome = rs.getString("review_outcome");
        OffsetDateTime reviewedAt = rs.getObject("reviewed_at", OffsetDateTime.class);
        return new InspectionView(
                rs.getLong("id"),
                rs.getObject("external_id", UUID.class),
                rs.getString("serial_number"),
                rs.getInt("line_id"),
                rs.getString("line_code"),
                rs.getInt("product_id"),
                rs.getString("part_number"),
                rs.getInt("profile_version"),
                rs.getObject("inspected_at", OffsetDateTime.class).toInstant(),
                rs.getObject("local_day", LocalDate.class),
                Verdict.valueOf(rs.getString("verdict")),
                rs.getDouble("anomaly_score"),
                rs.getInt("cycle_ms"),
                outcome == null ? null : ReviewOutcome.valueOf(outcome),
                rs.getString("reviewed_by"),
                reviewedAt == null ? null : reviewedAt.toInstant(),
                rs.getInt("defect_count"));
    }
}
