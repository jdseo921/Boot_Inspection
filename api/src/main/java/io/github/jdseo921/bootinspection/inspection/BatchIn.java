package io.github.jdseo921.bootinspection.inspection;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.util.List;

public record BatchIn(@NotEmpty @Size(max = BatchIn.MAX_BATCH) List<@Valid @NotNull InspectionIn> inspections) {

    public static final int MAX_BATCH = 1000;
}
