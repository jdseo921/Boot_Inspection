package io.github.jdseo921.bootinspection.inspection;

import io.github.jdseo921.bootinspection.catalog.CatalogRepository;
import io.github.jdseo921.bootinspection.common.ApiException;
import io.github.jdseo921.bootinspection.common.AppProperties;
import io.github.jdseo921.bootinspection.common.ReviewOutcome;
import io.github.jdseo921.bootinspection.common.Verdict;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class InspectionService {

    /** Slack for float rounding when checking a box against the board outline. */
    private static final double OUTLINE_TOLERANCE_MM = 0.01;

    private final InspectionRepository inspections;
    private final CatalogRepository catalog;
    private final AppProperties app;

    public InspectionService(InspectionRepository inspections, CatalogRepository catalog, AppProperties app) {
        this.inspections = inspections;
        this.catalog = catalog;
        this.app = app;
    }

    /**
     * Stores a batch in one transaction: new boards, their defects, and the
     * rollup update all commit together or not at all. Boards whose externalId
     * is already stored are reported as duplicates and left untouched.
     */
    @Transactional
    public BatchResult ingest(List<InspectionIn> batch) {
        CatalogRepository.Snapshot snap = catalog.snapshot();
        Set<UUID> seen = new HashSet<>();
        List<InspectionRepository.NewInspection> rows = new ArrayList<>(batch.size());
        for (int i = 0; i < batch.size(); i++) {
            InspectionIn in = batch.get(i);
            if (!seen.add(in.externalId())) {
                throw ApiException.unprocessable("inspections[" + i + "]: externalId " + in.externalId()
                        + " appears twice in this batch");
            }
            rows.add(resolve(in, i, snap));
        }

        Map<UUID, Long> created = inspections.insertNew(rows, app.zone());
        inspections.insertDefects(rows, created);
        inspections.addToRollups(created.values());

        List<UUID> existing = new ArrayList<>();
        for (InspectionRepository.NewInspection row : rows) {
            if (!created.containsKey(row.externalId())) {
                existing.add(row.externalId());
            }
        }
        Map<UUID, Long> existingIds = inspections.idsByExternalId(existing);

        List<IngestResult> results = new ArrayList<>(rows.size());
        for (InspectionRepository.NewInspection row : rows) {
            Long id = created.get(row.externalId());
            if (id != null) {
                results.add(new IngestResult(id, row.externalId(), true));
            } else {
                results.add(new IngestResult(existingIds.get(row.externalId()), row.externalId(), false));
            }
        }
        return new BatchResult(rows.size(), created.size(), rows.size() - created.size(), results);
    }

    private InspectionRepository.NewInspection resolve(InspectionIn in, int index, CatalogRepository.Snapshot snap) {
        String at = "inspections[" + index + "]";
        CatalogRepository.Line line = snap.linesByCode().get(in.lineCode());
        if (line == null) {
            throw ApiException.unprocessable(at + ": unknown lineCode " + in.lineCode());
        }
        CatalogRepository.Product product = snap.productsByPart().get(in.partNumber());
        if (product == null) {
            throw ApiException.unprocessable(at + ": unknown partNumber " + in.partNumber());
        }
        CatalogRepository.Profile profile = snap.profile(product.id(), in.profileVersion());
        if (profile == null) {
            throw ApiException.unprocessable(
                    at + ": " + in.partNumber() + " has no threshold profile version " + in.profileVersion());
        }
        if (in.verdict() == Verdict.OK && !in.defects().isEmpty()) {
            throw ApiException.unprocessable(at + ": an OK board cannot have flagged regions");
        }
        if (in.verdict() != Verdict.OK && in.defects().isEmpty()) {
            throw ApiException.unprocessable(at + ": a " + in.verdict() + " board needs at least one flagged region");
        }
        for (int k = 0; k < in.defects().size(); k++) {
            DefectIn d = in.defects().get(k);
            if (d.xMm() + d.wMm() > product.boardWidthMm() + OUTLINE_TOLERANCE_MM
                    || d.yMm() + d.hMm() > product.boardHeightMm() + OUTLINE_TOLERANCE_MM) {
                throw ApiException.unprocessable(at + ".defects[" + k + "]: box lies outside the "
                        + product.boardWidthMm() + " x " + product.boardHeightMm() + " mm board");
            }
        }
        return new InspectionRepository.NewInspection(
                in.externalId(),
                in.serialNumber(),
                product.id(),
                line.id(),
                profile.id(),
                in.inspectedAt(),
                in.verdict(),
                in.anomalyScore(),
                in.cycleMs(),
                in.defects());
    }

    @Transactional(readOnly = true)
    public PageView<InspectionView> list(InspectionFilter filter) {
        InspectionFilter probe = new InspectionFilter(
                filter.fromTs(),
                filter.toTs(),
                filter.lineId(),
                filter.productId(),
                filter.verdict(),
                filter.status(),
                filter.serialNumber(),
                filter.after(),
                filter.limit() + 1);
        List<InspectionView> rows = inspections.find(probe);
        if (rows.size() <= filter.limit()) {
            return new PageView<>(rows, null);
        }
        List<InspectionView> page = rows.subList(0, filter.limit());
        InspectionView last = page.get(page.size() - 1);
        return new PageView<>(List.copyOf(page), new Cursor(last.inspectedAt(), last.id()).encode());
    }

    @Transactional(readOnly = true)
    public InspectionDetail detail(long id) {
        InspectionView view = inspections.findView(id).orElseThrow(() -> notFound(id));
        InspectionRepository.Refs refs = inspections.refs(id).orElseThrow(() -> notFound(id));
        CatalogRepository.Product product = catalog.products().stream()
                .filter(p -> p.id() == refs.productId())
                .findFirst()
                .orElseThrow();
        CatalogRepository.Line line = catalog.lines().stream()
                .filter(l -> l.id() == refs.lineId())
                .findFirst()
                .orElseThrow();
        CatalogRepository.Profile profile = catalog.profiles().stream()
                .filter(p -> p.id() == refs.profileId())
                .findFirst()
                .orElseThrow();
        return new InspectionDetail(view, product, line, profile, inspections.defects(id));
    }

    /**
     * Records an operator's decision on a flagged board and moves it out of the
     * review queue in the rollups, in one transaction.
     */
    @Transactional
    public InspectionView review(long id, ReviewOutcome outcome, String reviewer) {
        if (!inspections.recordReview(id, outcome, reviewer.strip())) {
            InspectionView current = inspections.findView(id).orElseThrow(() -> notFound(id));
            if (current.verdict() == Verdict.OK) {
                throw ApiException.conflict("inspection " + id + " passed AOI; there is nothing to review");
            }
            throw ApiException.conflict("inspection " + id + " was already reviewed as " + current.reviewOutcome()
                    + " by " + current.reviewedBy());
        }
        return inspections.findView(id).orElseThrow(() -> notFound(id));
    }

    private static ApiException notFound(long id) {
        return ApiException.notFound("no inspection with id " + id);
    }
}
