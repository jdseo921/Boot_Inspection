package io.github.jdseo921.bootinspection.inspection;

import io.github.jdseo921.bootinspection.common.ReviewOutcome;
import io.github.jdseo921.bootinspection.common.Verdict;
import java.time.Instant;
import java.time.LocalDate;
import java.util.UUID;

/** One board in the inspection list and the review queue. */
public record InspectionView(
        long id,
        UUID externalId,
        String serialNumber,
        int lineId,
        String lineCode,
        int productId,
        String partNumber,
        int profileVersion,
        Instant inspectedAt,
        LocalDate localDay,
        Verdict verdict,
        double anomalyScore,
        int cycleMs,
        ReviewOutcome reviewOutcome,
        String reviewedBy,
        Instant reviewedAt,
        int defectCount) {}
