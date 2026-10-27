package io.github.jdseo921.bootinspection.inspection;

import io.github.jdseo921.bootinspection.common.ReviewOutcome;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

public record ReviewIn(@NotNull ReviewOutcome outcome, @NotBlank @Size(max = 64) String reviewer) {}
