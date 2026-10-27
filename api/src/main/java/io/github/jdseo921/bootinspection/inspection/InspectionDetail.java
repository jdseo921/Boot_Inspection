package io.github.jdseo921.bootinspection.inspection;

import io.github.jdseo921.bootinspection.catalog.CatalogRepository;
import java.util.List;

/** Everything the detail page draws: the board, its outline, its profile and the flagged regions. */
public record InspectionDetail(
        InspectionView inspection,
        CatalogRepository.Product product,
        CatalogRepository.Line line,
        CatalogRepository.Profile profile,
        List<DefectView> defects) {}
