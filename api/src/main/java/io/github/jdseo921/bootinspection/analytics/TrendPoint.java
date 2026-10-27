package io.github.jdseo921.bootinspection.analytics;

import java.time.LocalDate;

public record TrendPoint(
        LocalDate day,
        long inspected,
        long ok,
        long review,
        long ng,
        long confirmedDefects,
        long falseCalls,
        Double firstPassYield,
        Double falseCallRate) {}
