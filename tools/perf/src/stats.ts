// Latency summaries. Percentiles use the nearest-rank method on the raw
// samples, so p95 of 20 samples is the 19th fastest, not an interpolation.

export interface Summary {
  n: number;
  min: number;
  p50: number;
  p95: number;
  p99: number;
  max: number;
  mean: number;
}

export function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) throw new Error("no samples");
  if (p <= 0) return sorted[0];
  if (p >= 100) return sorted[sorted.length - 1];
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[rank - 1];
}

export function summarize(samples: readonly number[]): Summary {
  const sorted = [...samples].sort((a, b) => a - b);
  const sum = sorted.reduce((s, x) => s + x, 0);
  return {
    n: sorted.length,
    min: sorted[0],
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    p99: percentile(sorted, 99),
    max: sorted[sorted.length - 1],
    mean: sum / sorted.length,
  };
}

/** Milliseconds for a table cell: 0.42 ms, 3.1 ms, 48 ms, 1,234 ms. */
export function ms(x: number): string {
  if (x < 1) return `${x.toFixed(2)} ms`;
  if (x < 10) return `${x.toFixed(1)} ms`;
  return `${Math.round(x).toLocaleString("en-US")} ms`;
}

/** "1,234" */
export function int(x: number): string {
  return Math.round(x).toLocaleString("en-US");
}

/** How many times faster `fast` is than `slow`: "37x", "2.4x". */
export function times(slow: number, fast: number): string {
  const r = slow / fast;
  return r >= 10 ? `${Math.round(r).toLocaleString("en-US")}x` : `${r.toFixed(1)}x`;
}
