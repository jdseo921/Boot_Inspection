package io.github.jdseo921.bootinspection.analytics;

import java.time.LocalDate;

/**
 * Headline numbers for a period. Ratios are null when their denominator is 0.
 *
 * @param firstPassYield boards that passed AOI without being flagged / boards inspected
 * @param finalYield good boards (passed, or flagged but cleared as a false
 *     call) / boards with a final answer; pending boards are left out
 * @param falseCallRate false calls / flagged boards an operator has reviewed
 * @param pendingReview flagged boards nobody has decided on yet
 */
public record Summary(
        LocalDate from,
        LocalDate to,
        long inspected,
        long ok,
        long review,
        long ng,
        long confirmedDefects,
        long falseCalls,
        long pendingReview,
        Double firstPassYield,
        Double finalYield,
        Double falseCallRate,
        Double meanCycleMs,
        Integer p50CycleMs,
        Integer p95CycleMs) {}
