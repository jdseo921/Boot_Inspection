package io.github.jdseo921.bootinspection.unit;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import io.github.jdseo921.bootinspection.common.ApiException;
import io.github.jdseo921.bootinspection.inspection.Cursor;
import java.time.Instant;
import org.junit.jupiter.api.Test;

class CursorTest {

    @Test
    void roundTripsWithMicrosecondPrecision() {
        Cursor c = new Cursor(Instant.parse("2026-10-20T15:00:00.123456Z"), 987_654_321L);
        String token = c.encode();
        assertThat(token).matches("[A-Za-z0-9_-]+");
        assertThat(Cursor.decode(token)).isEqualTo(c);
    }

    @Test
    void garbageIsABadRequest() {
        assertThatThrownBy(() -> Cursor.decode("not-a-cursor")).isInstanceOf(ApiException.class);
        assertThatThrownBy(() -> Cursor.decode("!!!")).isInstanceOf(ApiException.class);
        assertThatThrownBy(() -> Cursor.decode("")).isInstanceOf(ApiException.class);
    }
}
