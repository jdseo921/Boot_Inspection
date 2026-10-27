package io.github.jdseo921.bootinspection.analytics;

import io.github.jdseo921.bootinspection.common.DefectClass;

/**
 * @param share this class's share of all flagged regions in the period
 * @param cumulativeShare running total of shares, largest class first
 */
public record ParetoBar(DefectClass defectClass, long count, double share, double cumulativeShare) {}
