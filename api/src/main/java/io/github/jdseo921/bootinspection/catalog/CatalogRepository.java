package io.github.jdseo921.bootinspection.catalog;

import java.time.OffsetDateTime;
import java.util.List;
import java.util.Map;
import java.util.function.Function;
import java.util.stream.Collectors;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;

/** Lines, board types and threshold profiles: small tables read whole. */
@Repository
public class CatalogRepository {

    public record Line(int id, String code, String name, String site) {}

    public record Product(int id, String partNumber, String name, double boardWidthMm, double boardHeightMm) {}

    public record Profile(
            int id,
            int productId,
            int version,
            int pixelDiff,
            int minDefectAreaPx,
            double modelThreshold,
            String approvedBy,
            OffsetDateTime approvedAt) {}

    /** Everything an ingest batch needs to resolve codes to ids, read once per batch. */
    public record Snapshot(Map<String, Line> linesByCode, Map<String, Product> productsByPart, List<Profile> profiles) {

        public Profile profile(int productId, int version) {
            for (Profile p : profiles) {
                if (p.productId() == productId && p.version() == version) {
                    return p;
                }
            }
            return null;
        }
    }

    private final JdbcClient jdbc;

    public CatalogRepository(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    public List<Line> lines() {
        return jdbc.sql("SELECT id, code, name, site FROM line ORDER BY code")
                .query((rs, n) -> new Line(rs.getInt("id"), rs.getString("code"), rs.getString("name"), rs.getString("site")))
                .list();
    }

    public List<Product> products() {
        return jdbc.sql("SELECT id, part_number, name, board_width_mm, board_height_mm FROM product ORDER BY part_number")
                .query((rs, n) -> new Product(
                        rs.getInt("id"),
                        rs.getString("part_number"),
                        rs.getString("name"),
                        rs.getDouble("board_width_mm"),
                        rs.getDouble("board_height_mm")))
                .list();
    }

    public List<Profile> profiles() {
        return jdbc.sql("""
                        SELECT id, product_id, version, pixel_diff, min_defect_area_px, model_threshold,
                               approved_by, approved_at
                        FROM threshold_profile
                        ORDER BY product_id, version
                        """)
                .query((rs, n) -> new Profile(
                        rs.getInt("id"),
                        rs.getInt("product_id"),
                        rs.getInt("version"),
                        rs.getInt("pixel_diff"),
                        rs.getInt("min_defect_area_px"),
                        rs.getDouble("model_threshold"),
                        rs.getString("approved_by"),
                        rs.getObject("approved_at", OffsetDateTime.class)))
                .list();
    }

    public Snapshot snapshot() {
        return new Snapshot(
                lines().stream().collect(Collectors.toMap(Line::code, Function.identity())),
                products().stream().collect(Collectors.toMap(Product::partNumber, Function.identity())),
                profiles());
    }
}
