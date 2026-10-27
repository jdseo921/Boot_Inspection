package io.github.jdseo921.bootinspection.common;

import java.time.ZoneId;
import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * @param timezone the plant's IANA time zone; inspection timestamps are
 *     assigned to calendar days in this zone
 */
@ConfigurationProperties(prefix = "app")
public record AppProperties(String timezone) {

    public AppProperties {
        if (timezone == null || timezone.isBlank()) {
            timezone = "America/Chicago";
        }
        ZoneId.of(timezone); // fail at startup on a bad zone, not on the first request
    }

    public ZoneId zone() {
        return ZoneId.of(timezone);
    }
}
