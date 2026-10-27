package io.github.jdseo921.bootinspection.unit;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import io.github.jdseo921.bootinspection.analytics.CycleHistogram;
import io.github.jdseo921.bootinspection.common.RollupGrid;
import org.junit.jupiter.api.Test;

class CycleHistogramTest {

    private static long[] empty() {
        return new long[RollupGrid.CYCLE_BUCKETS];
    }

    @Test
    void noBoardsMeansNoPercentile() {
        assertThat(CycleHistogram.percentile(empty(), 0.5)).isNull();
    }

    @Test
    void interpolatesInsideTheBucket() {
        long[] h = empty();
        h[40] = 10; // [10,000, 10,250) ms
        assertThat(CycleHistogram.percentile(h, 0.5)).isEqualTo(10_125);
        assertThat(CycleHistogram.percentile(h, 1.0)).isEqualTo(10_250);
        assertThat(CycleHistogram.percentile(h, 0.1)).isEqualTo(10_025);
    }

    @Test
    void walksAcrossBuckets() {
        long[] h = empty();
        h[36] = 50; // 9,000 ms
        h[48] = 50; // 12,000 ms
        assertThat(CycleHistogram.percentile(h, 0.5)).isEqualTo(9_250); // top of the lower bucket
        assertThat(CycleHistogram.percentile(h, 0.95)).isEqualTo(12_225);
    }

    @Test
    void theLastBucketIsOpenEnded() {
        long[] h = empty();
        h[RollupGrid.CYCLE_BUCKETS - 1] = 3;
        assertThat(CycleHistogram.percentile(h, 0.5)).isEqualTo(29_750);
    }

    @Test
    void rejectsQuantilesOutsideZeroToOne() {
        assertThatThrownBy(() -> CycleHistogram.percentile(empty(), 0)).isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> CycleHistogram.percentile(empty(), 1.01)).isInstanceOf(IllegalArgumentException.class);
    }
}
