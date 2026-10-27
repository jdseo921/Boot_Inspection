package io.github.jdseo921.bootinspection.inspection;

import io.github.jdseo921.bootinspection.common.DefectClass;
import jakarta.validation.constraints.DecimalMax;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Positive;
import jakarta.validation.constraints.PositiveOrZero;

/** One flagged region, as a bounding box in board coordinates (origin top-left). */
public record DefectIn(
        @NotNull DefectClass defectClass,
        @NotNull @PositiveOrZero Double xMm,
        @NotNull @PositiveOrZero Double yMm,
        @NotNull @Positive Double wMm,
        @NotNull @Positive Double hMm,
        @NotNull @PositiveOrZero @DecimalMax("1.0") Double confidence) {}
