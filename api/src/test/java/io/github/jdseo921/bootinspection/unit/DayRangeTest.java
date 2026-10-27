package io.github.jdseo921.bootinspection.unit;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import io.github.jdseo921.bootinspection.common.ApiException;
import io.github.jdseo921.bootinspection.common.DayRange;
import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.ZoneOffset;
import org.junit.jupiter.api.Test;

class DayRangeTest {

    private static final ZoneId CHICAGO = ZoneId.of("America/Chicago");
    // 02:00 UTC on 21 Oct is still 20 Oct in Chicago.
    private static final Clock CLOCK = Clock.fixed(Instant.parse("2026-10-21T02:00:00Z"), ZoneOffset.UTC);

    @Test
    void defaultsToThirtyDaysEndingTodayAtThePlant() {
        DayRange r = DayRange.of(null, null, CLOCK, CHICAGO);
        assertThat(r.to()).isEqualTo(LocalDate.of(2026, 10, 20));
        assertThat(r.from()).isEqualTo(LocalDate.of(2026, 9, 21));
    }

    @Test
    void convertsDaysToInstantsInThePlantZone() {
        DayRange r = DayRange.of(LocalDate.of(2026, 10, 31), LocalDate.of(2026, 11, 1), CLOCK, CHICAGO);
        assertThat(r.startInstant(CHICAGO).toInstant()).isEqualTo(Instant.parse("2026-10-31T05:00:00Z")); // CDT
        assertThat(r.endInstant(CHICAGO).toInstant()).isEqualTo(Instant.parse("2026-11-02T06:00:00Z")); // CST
    }

    @Test
    void rejectsReversedAndOverlongRanges() {
        assertThatThrownBy(() -> DayRange.of(LocalDate.of(2026, 10, 2), LocalDate.of(2026, 10, 1), CLOCK, CHICAGO))
                .isInstanceOf(ApiException.class);
        assertThatThrownBy(() -> DayRange.of(LocalDate.of(2025, 1, 1), LocalDate.of(2026, 10, 1), CLOCK, CHICAGO))
                .isInstanceOf(ApiException.class);
        assertThat(DayRange.of(LocalDate.of(2025, 10, 21), LocalDate.of(2026, 10, 21), CLOCK, CHICAGO).from())
                .isEqualTo(LocalDate.of(2025, 10, 21)); // exactly 366 days is allowed
    }
}
