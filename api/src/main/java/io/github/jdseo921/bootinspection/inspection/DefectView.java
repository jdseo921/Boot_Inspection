package io.github.jdseo921.bootinspection.inspection;

import io.github.jdseo921.bootinspection.common.DefectClass;

public record DefectView(
        long id, DefectClass defectClass, double xMm, double yMm, double wMm, double hMm, double confidence) {}
