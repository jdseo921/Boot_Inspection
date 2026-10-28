# Boot Inspection

[![CI](https://github.com/jdseo921/Boot_Inspection/actions/workflows/ci.yml/badge.svg)](https://github.com/jdseo921/Boot_Inspection/actions/workflows/ci.yml)
[![Performance](https://github.com/jdseo921/Boot_Inspection/actions/workflows/perf.yml/badge.svg)](https://github.com/jdseo921/Boot_Inspection/actions/workflows/perf.yml)

Inspection-analytics web app for automated optical inspection (AOI) on PCB
assembly lines. AOI stations post every board they inspect; operators work
through the boards the machine flagged and record whether each flag was a
real defect or a false call; engineers watch first-pass yield, false calls
and where defects land on each board type.

**Stack:** Spring Boot 4.1 (Java 21) · PostgreSQL 16 · React 19 + TypeScript ·
Docker · GitHub Actions · Playwright. Interface in English and Korean.

![Overview: yield KPIs, daily trends, defect heatmap and Pareto over 1.2 million boards](docs/screenshots/overview.png)

## Measured

On 1.2 million simulated boards (90 days, 3 lines, 4 board types), on a
4-vCPU GitHub Actions runner that also runs PostgreSQL and the load
generator. The speed numbers come from the [Performance workflow](.github/workflows/perf.yml),
the rest from the CI build and end-to-end job;
[docs/PERFORMANCE.md](docs/PERFORMANCE.md) has the full tables and method.

| | Result |
|---|---|
| Overview page data (KPIs, trend, Pareto, heatmap), 16 clients at once | **58 ms** median, **111 ms** p95 |
| Same numbers in SQL: daily rollups vs raw tables, 30 days | **7.4 ms** vs 422 ms (**57x**) |
| Ingest, 1,000-board batches / one board per request | **34,000** / 730 boards per second |
| Rollups after ingesting about 800,000 more boards under load | equal to the raw tables, to the board |
| Board list, review queue, serial search (SQL), with vs without indexes | **0.7 to 1.3 ms** vs 62 to 323 ms |
| Page 2,001 of the board list: keyset cursor vs `OFFSET` | **1.2 ms** vs 291 ms |
| KPI summary throughput after rewriting its histogram query | **2.8 to 3.9x** higher |
| First-load CSS after loading the Korean font only when needed | 72.4 kB to **4.4 kB** gzipped |
| Docker image / ready after `docker run` | 305 MB / 3 to 4 s |
| Accessibility, all five screens (axe, WCAG 2.1 AA) | **0** violations |

Shared CI runners vary by 20 to 70% between runs; these are from the slower
of two runs of the same code.

## What it does

| Who | Screen | What they get |
|---|---|---|
| AOI station | `POST /api/v1/inspections`, `/batch` | One board or up to 1,000 per call. Retries are safe: a board already stored (same `externalId`) is skipped, not duplicated. |
| Operator | **Review queue** | Flagged boards oldest first, the board drawn with its flagged regions, and a decision in one key: **D** confirms a defect, **F** marks a false call, **J/K** move. Two operators deciding the same board at once: one wins, the other is told. |
| Engineer | **Overview** | First-pass yield, false-call rate, final yield, boards waiting, cycle-time median and 95th percentile; daily trends; defects by class; where regions land on the board. Every chart has a table view. |
| Engineer | **Boards**, **Defects** | Every board with filters and serial search, each board's detail with its regions; a heatmap per board type and defect class. |

| Review queue | Defect map |
|---|---|
| ![Review queue with the selected board and its flagged region](docs/screenshots/review.png) | ![Defect heatmap per board type](docs/screenshots/defects.png) |

The Korean interface uses the floor terms (직행률, 과검, 판정 대기);
[screenshot](docs/screenshots/overview-ko.png).

## How it works

```mermaid
flowchart LR
    stations["AOI stations"] -- "POST boards<br/>(1 or 1,000 per call)" --> api
    browser["Browser<br/>React + TypeScript"] -- "/api/v1/..." --> api
    subgraph app ["One container: Spring Boot 4.1 (serves the React build too)"]
        api["REST API<br/>JdbcClient, validation,<br/>ProblemDetail errors"]
    end
    api -- "same transaction" --> raw[("inspection<br/>defect")]
    api -- "same transaction" --> roll[("daily_yield<br/>daily_defects<br/>daily_defect_cells")]
    api -. "dashboard reads only" .-> roll
    api -. "lists and detail" .-> raw
```

- **Daily rollups, kept exact.** Each ingest batch and each review decision
  updates three rollup tables in the same transaction as the raw rows, so the
  dashboard reads a few thousand rollup rows instead of scanning millions of
  boards. A test replays ingest and reviews and checks the rollups equal a
  full rebuild; the Performance workflow checks it again after ingesting
  about a million more boards under load.
- **Idempotent ingest.** The whole batch is one `INSERT … SELECT FROM unnest(…)
  ON CONFLICT (external_id) DO NOTHING RETURNING …`; the response says which
  boards were new.
- **Race-safe review.** The decision is a conditional `UPDATE … WHERE
  review_outcome IS NULL`; the second of two simultaneous decisions matches
  nothing and gets `409 Conflict` (an 8-thread test proves exactly one wins).
- **Keyset pagination** on `(inspected_at, id)` with an opaque cursor, so page
  2,000 costs the same as page 1.
- **A partial index for the review queue** (`WHERE verdict <> 'OK' AND
  review_outcome IS NULL`): it holds only the boards waiting, under 1,000
  entries, instead of all 1.2 million.
- **Plant time.** Calendar days follow the plant's time zone (`APP_TIMEZONE`),
  not the server's or the browser's.
- **Realistic data.** A seeded generator simulates three lines with lots,
  changeovers, shifts, a threshold-profile change mid-period and excursions,
  using the six defect classes of the public DeepPCB benchmark.

## Run it

**With Docker** (app and PostgreSQL):

```bash
docker compose up --build            # http://localhost:8080
# in another terminal, once the app is up: 300,000 boards over 30 days
npm ci --prefix tools/generator
DATABASE_URL=postgres://postgres:postgres@localhost:5432/boot_inspection \
  npm run generate --prefix tools/generator -- --boards 300000 --days 30
```

**For development** (Java 21, Node 22, PostgreSQL 16 on `localhost:5432`
with user and password `postgres`, and databases `boot_inspection` and
`boot_inspection_test`):

```bash
(cd api && ./gradlew bootRun)        # API on :8080, creates the schema
(cd web && npm ci && npm run dev)    # UI on :5173, proxies /api to :8080
```

**Tests:**

```bash
(cd api && ./gradlew test)                                  # 43 integration and unit tests, real PostgreSQL
(cd web && npm test)                                        # 28 component tests (Vitest, MSW)
(cd web && E2E_BASE_URL=http://localhost:8080 npm run e2e)  # 15 Playwright tests against a running app with data
(cd tools/generator && npm test)                            # 11 tests
(cd tools/perf && npm test)                                 # 8 tests
```

**Benchmarks** against a loaded database and a running app:

```bash
(cd tools/perf && npm ci && npm run sql && npm run http)
```

## Continuous integration

Every push runs:

- **API**: build, 43 tests against PostgreSQL 16, line coverage (98.7%), compiler warnings as annotations.
- **Front end**: type check, lint, 28 tests, production build.
- **Tools**: type check and tests for the generator and the benchmarks.
- **Docker image and end-to-end tests**: builds the image, starts it with a
  1 GB memory limit next to PostgreSQL, loads 300,000 boards, and runs 15
  Playwright tests in desktop and phone viewports: the review flow from the
  keyboard, a board posted through the API showing up in search and totals,
  deep links, the Korean switch, and an [axe](https://github.com/dequelabs/axe-core)
  scan of every screen with no WCAG 2.1 AA violations.

The **Performance** workflow runs on changes to the benchmarks or by hand.

## Deploy

[docs/DEPLOY_AWS.md](docs/DEPLOY_AWS.md): Amazon ECS Express Mode (Fargate
behind HTTPS) with Amazon RDS for PostgreSQL, step by step with the AWS CLI,
including teardown.

## Repository layout

| Path | What |
|---|---|
| `api/` | Spring Boot REST API, Flyway migrations, tests against PostgreSQL |
| `web/` | React + TypeScript front end, component tests, Playwright end-to-end tests |
| `tools/generator/` | Seeded generator of realistic AOI data, loaded with `COPY` |
| `tools/perf/` | SQL benchmark and HTTP load test |
| `db/check_rollups.sql` | Checks incremental rollups against a full rebuild on a loaded database |
| `docs/openapi.yaml` | API contract |
| `docs/PERFORMANCE.md` | Benchmark method and results |
| `docs/DEPLOY_AWS.md` | Deploying to AWS |
| `Dockerfile`, `compose.yaml` | Image (front end bundled into the jar) and local stack |

All data is simulated by `tools/generator`; no real production data is used.
