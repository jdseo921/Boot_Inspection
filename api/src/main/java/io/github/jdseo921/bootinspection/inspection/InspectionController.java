package io.github.jdseo921.bootinspection.inspection;

import io.github.jdseo921.bootinspection.common.ApiException;
import io.github.jdseo921.bootinspection.common.AppProperties;
import io.github.jdseo921.bootinspection.common.DayRange;
import io.github.jdseo921.bootinspection.common.Verdict;
import jakarta.validation.Valid;
import java.net.URI;
import java.time.Clock;
import java.time.LocalDate;
import java.util.List;
import java.util.Locale;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/inspections")
public class InspectionController {

    static final int DEFAULT_PAGE = 50;
    static final int MAX_PAGE = 200;

    private final InspectionService service;
    private final AppProperties app;
    private final Clock clock;

    public InspectionController(InspectionService service, AppProperties app, Clock clock) {
        this.service = service;
        this.app = app;
        this.clock = clock;
    }

    /** One board. 201 when stored now, 200 when this externalId was already stored. */
    @PostMapping
    public ResponseEntity<IngestResult> ingestOne(@Valid @RequestBody InspectionIn body) {
        IngestResult result = service.ingest(List.of(body)).results().get(0);
        if (result.created()) {
            return ResponseEntity.created(URI.create("/api/v1/inspections/" + result.id())).body(result);
        }
        return ResponseEntity.ok(result);
    }

    /** Up to 1,000 boards in one transaction. */
    @PostMapping("/batch")
    public BatchResult ingestBatch(@Valid @RequestBody BatchIn body) {
        return service.ingest(body.inspections());
    }

    /**
     * Newest first, keyset-paginated. With {@code serial} set, the date range
     * is ignored so a board can be found whenever it was inspected.
     */
    @GetMapping
    public PageView<InspectionView> list(
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate from,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate to,
            @RequestParam(required = false) Integer lineId,
            @RequestParam(required = false) Integer productId,
            @RequestParam(required = false) Verdict verdict,
            @RequestParam(required = false) String status,
            @RequestParam(required = false) String serial,
            @RequestParam(required = false) String cursor,
            @RequestParam(required = false) Integer limit) {
        int size = limit == null ? DEFAULT_PAGE : limit;
        if (size < 1 || size > MAX_PAGE) {
            throw ApiException.badRequest("limit must be between 1 and " + MAX_PAGE);
        }
        String serialNumber = serial == null || serial.isBlank() ? null : serial.strip();
        DayRange range = serialNumber != null || (from == null && to == null)
                ? null
                : DayRange.of(from, to, clock, app.zone());
        InspectionFilter filter = new InspectionFilter(
                range == null ? null : range.startInstant(app.zone()),
                range == null ? null : range.endInstant(app.zone()),
                lineId,
                productId,
                verdict,
                parseStatus(status),
                serialNumber,
                cursor == null || cursor.isBlank() ? null : Cursor.decode(cursor),
                size);
        return service.list(filter);
    }

    @GetMapping("/{id}")
    public InspectionDetail detail(@PathVariable long id) {
        return service.detail(id);
    }

    @PostMapping("/{id}/review")
    public InspectionView review(@PathVariable long id, @Valid @RequestBody ReviewIn body) {
        return service.review(id, body.outcome(), body.reviewer());
    }

    private static InspectionFilter.ReviewStatus parseStatus(String status) {
        if (status == null || status.isBlank()) {
            return null;
        }
        return switch (status.strip().toLowerCase(Locale.ROOT)) {
            case "pending" -> InspectionFilter.ReviewStatus.PENDING;
            case "reviewed" -> InspectionFilter.ReviewStatus.REVIEWED;
            default -> throw ApiException.badRequest("status must be pending or reviewed");
        };
    }
}
