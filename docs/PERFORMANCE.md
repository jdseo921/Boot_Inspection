# Performance

How fast Boot Inspection answers on a realistic amount of data, how that was
measured, and what changed because of it. Every number here comes from the
[Performance workflow](../.github/workflows/perf.yml), which anyone can run
again from the Actions tab; the tables below are copied from its run
[40642510266](https://github.com/jdseo921/Boot_Inspection/actions/runs/40642510266)
on commit `841cdc3`.

## Headline

On 1.2 million boards, with 16 clients hitting the API at once:

- **Dashboard.** All data behind the Overview page (KPIs, daily trend, Pareto,
  heatmap) comes back in **58 ms median, 111 ms at the 95th percentile**. The
  SQL behind it takes **7.4 ms** on the daily rollups against **422 ms** for
  the same numbers from the raw tables (**57x**), 15 ms against 685 ms over
  90 days.
- **Ingest.** **34,000 boards per second** in 1,000-board batches (117 ms per
  batch at the median), **730 per second** one board per request. After the
  load test had added about 800,000 boards, the rollups still matched the raw
  tables exactly.
- **Lists.** The newest 50 boards, the review queue and serial search take
  **0.7 to 1.3 ms** in SQL with the indexes from `V2__query_indexes.sql`,
  against 62 to 323 ms without them. Page 2,001 of the board list takes
  **1.2 ms** with the keyset cursor the API uses, against **291 ms** with
  `OFFSET`.
- **Tuning found by measuring.** The first run showed the KPI summary as the
  slowest endpoint. Rewriting its histogram query made that query 2.9 to 4.8x
  faster and the endpoint's throughput **2.8 to 3.9x higher** (below).

Shared CI machines vary: two runs of the same code a few minutes apart
differed by 20 to 70% in absolute numbers, while the ratios between the two
sides of each comparison held (see [Run-to-run variation](#run-to-run-variation)).
The headline uses the slower run.

## Setup

- **Data:** `tools/generator`, seed 42: 1,200,000 boards over 90 days on 3 SMT
  lines and 4 board types, 84,346 flagged regions, 880 boards waiting for
  review. The SQL benchmark runs on exactly this; the HTTP test then adds
  boards as it ingests.
- **Machine:** one GitHub-hosted `ubuntu-24.04` runner, 4 vCPU (AMD EPYC
  7763), 16 GB RAM, shared by PostgreSQL, the API and the load generator.
- **PostgreSQL 16.15** in Docker with `shared_buffers=1GB`,
  `effective_cache_size=4GB`, `work_mem=16MB`, otherwise defaults, after
  `VACUUM (ANALYZE)`.
- **API:** the production jar (`./gradlew bootJar`) on Java 21 with default
  JVM settings, virtual threads on, a HikariCP pool of 10 connections.

## Method

**SQL benchmark** (`tools/perf/src/sql.ts`). Each query is the SQL the API
sends (copied from the repositories, with an `ORDER BY` or column names added
where needed to compare results), timed at the client from send to last row: a few warm-up runs, then 25 timed runs (7 for queries over 250 ms),
median reported. Each row of the tables compares two ways to get the same
answer, and the run fails if the two ever return different rows, so a
speed-up can never come from answering a different question. The "without
indexes" side drops the six `V2` indexes inside a transaction that is always
rolled back, so the database is never changed.

**HTTP load test** (`tools/perf/src/http.ts`). Closed loop: each of 16
connections (4 for batch ingest) sends its next request as soon as the last
one finishes, for 5 s of warm-up and then 20 s measured per scenario.
Latency is per request, from send to last byte, with `Accept-Encoding: gzip`
as a browser sends. Every response is checked: status code, and for ingest
the number of boards the API says it stored, so a wrong answer counts as an
error, not a fast response. The ingest scenarios post boards from the same
simulation the generator uses (verdict mix, one or two regions on flagged
boards), seeded differently so every board is new. Closed-loop latencies are
service times at that concurrency; they do not include queueing that an
open-loop arrival rate would add.

## SQL results

### Dashboard queries: daily rollups vs raw tables

| Query | Range | Rollups | Raw tables | Faster |
| --- | --- | ---: | ---: | ---: |
| KPI totals | 30 days | 0.53 ms | 68 ms | 127x |
| Cycle-time histogram | 30 days | 2.3 ms | 79 ms | 34x |
| Daily yield trend | 30 days | 0.61 ms | 82 ms | 134x |
| Defect Pareto | 30 days | 0.72 ms | 91 ms | 127x |
| Defect heatmap (one product) | 30 days | 3.2 ms | 102 ms | 32x |
| KPI totals | 90 days | 0.51 ms | 103 ms | 201x |
| Cycle-time histogram | 90 days | 3.6 ms | 135 ms | 38x |
| Daily yield trend | 90 days | 0.94 ms | 144 ms | 153x |
| Defect Pareto | 90 days | 1.1 ms | 125 ms | 109x |
| Defect heatmap (one product) | 90 days | 9.1 ms | 179 ms | 20x |
| **All five (Overview page)** | 30 days | **7.4 ms** | **422 ms** | **57x** |
| **All five (Overview page)** | 90 days | **15 ms** | **685 ms** | **45x** |

### Tuning: summing the cycle-time histograms

| Query | Range | Element-wise sums (now) | unnest + GROUP BY (before) | Faster |
| --- | --- | ---: | ---: | ---: |
| Cycle-time histogram | 30 days | 2.0 ms | 5.9 ms | 2.9x |
| Cycle-time histogram | 90 days | 3.5 ms | 17 ms | 4.8x |

### List queries: with vs without the V2 indexes

| Query | Scope | With V2 indexes | Plan | Without | Plan | Faster |
| --- | --- | ---: | --- | ---: | --- | ---: |
| Inspection list, newest 50 | 30 days | 1.2 ms | Index Scan backward on inspection_time_id_idx + Index Only Scan on defect_inspection_idx | 323 ms | Parallel Seq Scan on inspection + Seq Scan on defect + sort | 268x |
| Inspection list, one line | 30 days | 1.1 ms | Index Scan backward on inspection_time_id_idx + Index Only Scan on defect_inspection_idx | 275 ms | Parallel Seq Scan on inspection + Seq Scan on defect + sort | 242x |
| Review queue, oldest 50 pending | 30 days | 1.3 ms | Index Scan on inspection_pending_review_idx + Index Only Scan on defect_inspection_idx | 245 ms | Parallel Seq Scan on inspection + Seq Scan on defect + sort | 192x |
| Serial-number search | all data | 0.71 ms | Index Scan on inspection_serial_idx + Index Only Scan on defect_inspection_idx + sort | 62 ms | Parallel Seq Scan on inspection + Seq Scan on defect + sort | 87x |
| Defect boxes of one board | detail page | 0.31 ms | Index Scan on defect_inspection_idx + sort | 3.8 ms | Seq Scan on defect + sort | 12x |

### Deep pages: keyset cursor vs OFFSET

| Query | Rows | Keyset cursor | OFFSET | Faster |
| --- | --- | ---: | ---: | ---: |
| Inspection list, page 2,001 | rows 100,001-100,050, 90 days | 1.2 ms | 291 ms | 244x |

### Storage

| Relation | Rows | Size |
| --- | ---: | ---: |
| inspection | 1,200,000 | 144.5 MB (498.3 MB with indexes) |
| defect | 84,346 | 5.6 MB (9.1 MB with indexes) |
| daily_defect_cells | 73,338 | 3.7 MB (6.5 MB with indexes) |
| daily_yield | 732 | 424 kB (496 kB with indexes) |
| daily_defects | 4,332 | 192 kB (424 kB with indexes) |
| inspection_time_id_idx (index) | 1,200,000 | 36.1 MB |
| inspection_pending_review_idx (index) | 880 | 48 kB |

How to read the plans: with the indexes, every list query walks an index in
the order it returns rows and stops after 50; without them PostgreSQL scans
all 1.2 million boards in parallel and sorts. The review-queue index is
partial, so it holds only the 880 boards waiting (48 kB) instead of every
board (the full time index is 36 MB).

## HTTP results

| Scenario | Request | Concurrency | Throughput | p50 | p95 | p99 | Errors |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Overview page data | summary + yield trend + Pareto + heatmap, sent together like the page does | 16 | 248 req/s | 58 ms | 111 ms | 155 ms | 0 |
| KPI summary | GET /analytics/summary, 30 days | 16 | 1,322 req/s | 12 ms | 17 ms | 20 ms | 0 |
| Yield trend | GET /analytics/yield-trend, 30 days | 16 | 3,047 req/s | 5.1 ms | 8.1 ms | 9.9 ms | 0 |
| Defect Pareto | GET /analytics/defect-pareto, 30 days | 16 | 2,698 req/s | 5.8 ms | 8.9 ms | 11 ms | 0 |
| Defect heatmap | GET /analytics/defect-heatmap, 30 days | 16 | 652 req/s | 24 ms | 34 ms | 38 ms | 0 |
| Inspection list | GET /inspections, newest 50 in 30 days | 16 | 1,375 req/s | 11 ms | 17 ms | 21 ms | 0 |
| Review queue | GET /inspections?status=pending&sort=oldest, 50 | 16 | 1,879 req/s | 8.2 ms | 13 ms | 16 ms | 0 |
| Board detail | GET /inspections/{id}, random board of all | 16 | 2,107 req/s | 7.5 ms | 10 ms | 12 ms | 0 |
| Ingest, one board per request | POST /inspections | 16 | 730 req/s (730 boards/s) | 20 ms | 34 ms | 47 ms | 0 |
| Ingest, 1,000-board batches | POST /inspections/batch | 4 | 34 req/s (33,996 boards/s) | 117 ms | 133 ms | 143 ms | 0 |

The Overview row is one page view: the four requests the page sends at once,
timed until the last one finishes.

## The histogram rewrite

The first Performance run ([40640505443](https://github.com/jdseo921/Boot_Inspection/actions/runs/40640505443))
put `GET /analytics/summary` at 465 requests per second, well below the other
dashboard endpoints. Its cycle-time percentiles come from 120-bucket
histograms stored per day, line and board type, and the query added them up
with `unnest(cycle_hist) WITH ORDINALITY` and `GROUP BY` — one row per bucket
per rollup row, about 30,000 rows for 30 days, grouped back into 120.

It now adds the arrays position by position in a single pass:
`SELECT sum(cycle_hist[1]), …, sum(cycle_hist[120]) FROM daily_yield WHERE …`.
The SQL benchmark times both on every run and checks they return the same
buckets:

| | 30 days | 90 days |
| --- | ---: | ---: |
| unnest + GROUP BY (before) | 5.9 ms | 17 ms |
| element-wise sums (now) | 2.0 ms | 3.5 ms |
| faster | 2.9x | 4.8x |

| `GET /analytics/summary`, 16 clients | Throughput | p50 |
| --- | ---: | ---: |
| Before (run 40640505443) | 465 req/s | 34 ms |
| After, run 40641650113 | 1,822 req/s | 8.7 ms |
| After, run 40642510266 | 1,322 req/s | 12 ms |

The "before" run used the `ubuntu-latest` label and the two "after" runs the
pinned `ubuntu-24.04`, so the HTTP comparison is indicative; the SQL
comparison above is from one run on one machine.

## Run-to-run variation

The same code (commits `75d8130` and `841cdc3` differ only in how results are
reported) on two runs of the pinned runner:

| Scenario | Run 40641650113 | Run 40642510266 |
| --- | ---: | ---: |
| Overview page data, p50 / p95 | 34 / 63 ms | 58 / 111 ms |
| KPI summary throughput | 1,822 req/s | 1,322 req/s |
| Inspection list, p50 | 7.4 ms | 11 ms |
| Ingest, 1,000-board batches | 44,200 boards/s | 33,996 boards/s |
| Ingest, one board per request | 1,117 boards/s | 730 boards/s |
| SQL: Overview queries on rollups, 30 days | 5.8 ms | 7.4 ms |
| SQL: same from raw tables | 345 ms | 422 ms |

The ratios hold steady even when absolute times move: the Overview queries
are 57 to 59x faster on the rollups than on the raw tables over 30 days, and
the three list queries 190 to 360x faster with the indexes than without.

## Other measurements

| What | Result | Where |
| --- | --- | --- |
| Loading 1.2 million boards | 43.9 s: simulate and `COPY` 37.3 s (about 32,000 boards/s), rebuild rollups 5.1 s, `ANALYZE` 0.5 s | 2 vCPU development container |
| First-load stylesheet | 72.4 kB to **4.4 kB** gzipped after loading the Korean webfont only when Korean is on screen | `npm run build` |
| JavaScript bundle | 139 kB gzipped | `npm run build` |
| Docker image | 305 MB; serving 3.1 to 4.2 s after `docker run` in two runs (Spring Boot started in 2.5 to 3.5 s), schema created by Flyway on an empty database | CI, Docker job |
| Accessibility | 0 axe violations (WCAG 2.1 A and AA) on all five screens, after darkening the muted text from 3.2:1 to 4.9:1 contrast | CI, Playwright |

## Run it yourself

On GitHub: **Actions → Performance → Run workflow** (you can change the
number of boards and the seconds per scenario).

Locally, with PostgreSQL loaded by the generator and the API running:

```bash
cd tools/perf && npm ci
npm run sql  -- --database-url postgres://postgres:postgres@localhost:5432/boot_inspection
npm run http -- --base-url http://localhost:8080 --duration 20 --connections 16
```

Both print Markdown tables like the ones above; `--json` saves the raw
samples' summaries, including p95 and p99 for the SQL queries.
