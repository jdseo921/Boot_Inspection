package io.github.jdseo921.bootinspection.inspection;

import io.github.jdseo921.bootinspection.common.Verdict;
import java.time.OffsetDateTime;

/**
 * Filters for the inspection list. Null means "any".
 *
 * @param fromTs inclusive start instant
 * @param toTs exclusive end instant
 * @param status {@code pending} = flagged and not yet reviewed (the review
 *     queue), {@code reviewed} = has an operator decision
 */
public record InspectionFilter(
        OffsetDateTime fromTs,
        OffsetDateTime toTs,
        Integer lineId,
        Integer productId,
        Verdict verdict,
        ReviewStatus status,
        String serialNumber,
        Cursor after,
        int limit) {

    public enum ReviewStatus {
        PENDING,
        REVIEWED
    }
}
