package io.github.jdseo921.bootinspection.web;

import io.github.jdseo921.bootinspection.common.AppProperties;
import io.github.jdseo921.bootinspection.common.DayRange;
import java.time.Clock;
import java.time.LocalDate;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

/** What the front end needs to compute date presets the way the server does. */
@RestController
public class MetaController {

    public record Meta(String timezone, LocalDate today, int defaultDays, int maxDays) {}

    private final AppProperties app;
    private final Clock clock;

    public MetaController(AppProperties app, Clock clock) {
        this.app = app;
        this.clock = clock;
    }

    @GetMapping("/api/v1/meta")
    public Meta meta() {
        return new Meta(app.timezone(), LocalDate.now(clock.withZone(app.zone())), DayRange.DEFAULT_DAYS,
                DayRange.MAX_DAYS);
    }
}
