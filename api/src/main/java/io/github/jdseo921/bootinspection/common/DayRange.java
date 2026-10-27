package io.github.jdseo921.bootinspection.common;

import java.time.Clock;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.time.temporal.ChronoUnit;

/**
 * An inclusive range of plant calendar days.
 *
 * @param from first day, inclusive
 * @param to last day, inclusive
 */
public record DayRange(LocalDate from, LocalDate to) {

    public static final int MAX_DAYS = 366;
    public static final int DEFAULT_DAYS = 30;

    /**
     * Fills in missing ends: no {@code to} means today at the plant, no
     * {@code from} means {@value #DEFAULT_DAYS} days ending at {@code to}.
     */
    public static DayRange of(LocalDate from, LocalDate to, Clock clock, ZoneId zone) {
        LocalDate end = to != null ? to : LocalDate.now(clock.withZone(zone));
        LocalDate start = from != null ? from : end.minusDays(DEFAULT_DAYS - 1);
        if (start.isAfter(end)) {
            throw ApiException.badRequest("from (" + start + ") is after to (" + end + ")");
        }
        if (ChronoUnit.DAYS.between(start, end) + 1 > MAX_DAYS) {
            throw ApiException.badRequest("date range is longer than " + MAX_DAYS + " days");
        }
        return new DayRange(start, end);
    }

    /** Start of {@code from} at the plant, as an instant. */
    public OffsetDateTime startInstant(ZoneId zone) {
        return from.atStartOfDay(zone).toOffsetDateTime().withOffsetSameInstant(ZoneOffset.UTC);
    }

    /** Start of the day after {@code to} at the plant (exclusive end). */
    public OffsetDateTime endInstant(ZoneId zone) {
        return to.plusDays(1).atStartOfDay(zone).toOffsetDateTime().withOffsetSameInstant(ZoneOffset.UTC);
    }
}
