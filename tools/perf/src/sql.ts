// SQL benchmark: times the queries behind the dashboard and list endpoints on
// a loaded database, next to the slower way each answer could be computed.
//
//   npm run sql -- --database-url postgres://postgres@127.0.0.1:5432/boot_inspection
//
// Three comparisons, all on the same data:
//   1. dashboard queries on the daily rollups vs the same numbers from the raw tables
//   2. list queries with the V2 indexes vs without them (dropped inside a
//      transaction that is always rolled back, so the database is unchanged)
//   3. a deep page of the inspection list by keyset cursor vs by OFFSET
// Both sides of every pair must return identical rows, or the run fails.

import { writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import pg from "pg";
import { machine, notice, publish, table } from "./report.ts";
import { int, ms, summarize, times, type Summary } from "./stats.ts";

const { values: args } = parseArgs({
  options: {
    "database-url": {
      type: "string",
      default: process.env.DATABASE_URL ?? "postgres://postgres@127.0.0.1:5432/boot_inspection",
    },
    tz: { type: "string", default: process.env.APP_TIMEZONE ?? "America/Chicago" },
    runs: { type: "string", default: "25" },
    "deep-offset": { type: "string", default: "100000" },
    json: { type: "string" },
    markdown: { type: "string" },
  },
});

const RUNS = Number(args.runs);
const DEEP = Number(args["deep-offset"]);

/** Indexes added by V2__query_indexes.sql. */
const V2_INDEXES = [
  "inspection_time_id_idx",
  "inspection_line_time_idx",
  "inspection_product_time_idx",
  "inspection_pending_review_idx",
  "inspection_serial_idx",
  "defect_inspection_idx",
];

interface Query {
  text: string;
  values: unknown[];
}

interface Measured {
  label: string;
  latency: Summary;
  rows: number;
  plan: string;
}

interface Pair {
  section: "dashboard" | "tuning" | "indexes" | "paging";
  name: string;
  detail: string;
  fast: Measured;
  slow: Measured;
}

const client = new pg.Client({ connectionString: args["database-url"] });
await client.connect();

async function rows(q: Query): Promise<Record<string, unknown>[]> {
  return (await client.query(q.text, q.values)).rows;
}

/** Times a query from the client: send, plan, execute, receive every row. */
async function measure(q: Query): Promise<{ latency: Summary; result: Record<string, unknown>[] }> {
  const once = async () => {
    const t0 = performance.now();
    const r = await client.query(q.text, q.values);
    return { elapsed: performance.now() - t0, result: r.rows };
  };
  const first = await once();
  // Slow queries (whole-table scans) get fewer runs; their spread is small.
  const slow = first.elapsed > 250;
  if (!slow) {
    await once();
    await once();
  }
  const n = slow ? Math.min(RUNS, 7) : RUNS;
  const samples: number[] = [];
  let result = first.result;
  for (let i = 0; i < n; i++) {
    const r = await once();
    samples.push(r.elapsed);
    result = r.result;
  }
  return { latency: summarize(samples), result };
}

/** Short description of how the planner reaches the big tables. */
async function plan(q: Query): Promise<string> {
  const r = await client.query(`EXPLAIN (FORMAT JSON) ${q.text}`, q.values);
  const raw = r.rows[0]["QUERY PLAN"];
  const root = (typeof raw === "string" ? JSON.parse(raw) : raw)[0].Plan;
  const scans: string[] = [];
  let sorts = false;
  const walk = (node: Record<string, unknown>) => {
    const type = String(node["Node Type"]);
    const rel = node["Relation Name"] as string | undefined;
    const index = node["Index Name"] as string | undefined;
    if (type.endsWith("Sort")) sorts = true;
    if (rel && ["inspection", "defect", "daily_yield", "daily_defects", "daily_defect_cells"].includes(rel)) {
      const how = (node["Parallel Aware"] ? "Parallel " : "") + type;
      const dir = node["Scan Direction"] === "Backward" ? " backward" : "";
      const s = index ? `${how}${dir} on ${index}` : `${how} on ${rel}`;
      if (!scans.includes(s)) scans.push(s);
    }
    for (const child of (node.Plans as Record<string, unknown>[] | undefined) ?? []) walk(child);
  };
  walk(root);
  if (sorts) scans.push("sort");
  return scans.join(" + ");
}

const norm = (v: unknown): unknown =>
  v instanceof Date ? v.toISOString() : typeof v === "string" && /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : v;

type Rows = Record<string, unknown>[];

/** Rows as comparable JSON, after an optional reshaping of one side. */
function canonical(result: Rows, shape: (r: Rows) => Rows = (r) => r): string {
  return JSON.stringify(shape(result).map((r) => Object.values(r).map(norm)));
}

/** A cycle-time histogram as (bucket, count) rows without empty buckets, from either query shape. */
function histogram(result: Rows): Rows {
  const wide = result.length === 1 && "b1" in result[0];
  const pairs = wide ? Object.values(result[0]).map((n, i) => ({ k: i + 1, n })) : result.map((r) => ({ k: r.k, n: r.n }));
  return pairs.filter((r) => Number(r.n ?? 0) !== 0);
}

interface Side {
  label: string;
  q: Query;
  shape?: (r: Rows) => Rows;
}

async function pair(
  section: Pair["section"],
  name: string,
  detail: string,
  fast: Side,
  slow: Side & { inTransaction?: () => Promise<void> },
): Promise<Pair> {
  const f = await measure(fast.q);
  const fPlan = await plan(fast.q);
  let s: Awaited<ReturnType<typeof measure>>;
  let sPlan: string;
  if (slow.inTransaction) {
    await client.query("BEGIN");
    try {
      await slow.inTransaction();
      s = await measure(slow.q);
      sPlan = await plan(slow.q);
    } finally {
      await client.query("ROLLBACK");
    }
  } else {
    s = await measure(slow.q);
    sPlan = await plan(slow.q);
  }
  const same = canonical(f.result, fast.shape) === canonical(s.result, slow.shape);
  if (!same) throw new Error(`${name} (${detail}): the two queries returned different rows`);
  if (f.result.length === 0) throw new Error(`${name} (${detail}): no rows; is the database loaded?`);
  console.error(`  ${name} ${detail}: ${ms(f.latency.p50)} vs ${ms(s.latency.p50)}`);
  return {
    section,
    name,
    detail,
    fast: { label: fast.label, latency: f.latency, rows: f.result.length, plan: fPlan },
    slow: { label: slow.label, latency: s.latency, rows: s.result.length, plan: sPlan },
  };
}

// ---------------------------------------------------------------- the data

const facts = (
  await rows({
    text: `SELECT (SELECT count(*) FROM inspection) AS boards,
                  (SELECT count(*) FROM defect) AS defects,
                  (SELECT count(*) FROM inspection WHERE verdict <> 'OK' AND review_outcome IS NULL) AS pending,
                  (SELECT min(local_day)::text FROM daily_yield) AS first_day,
                  (SELECT max(local_day)::text FROM daily_yield) AS last_day,
                  (SELECT (max(local_day) - 29)::text FROM daily_yield) AS from30,
                  (SELECT (max(local_day) - 89)::text FROM daily_yield) AS from90,
                  current_setting('server_version') AS pg_version,
                  current_setting('shared_buffers') AS shared_buffers,
                  current_setting('work_mem') AS work_mem,
                  current_setting('max_parallel_workers_per_gather') AS parallel`,
    values: [],
  })
)[0] as Record<string, string>;
if (Number(facts.boards) === 0) throw new Error("inspection is empty; load data with tools/generator first");
console.error(`${int(Number(facts.boards))} boards, ${facts.first_day} .. ${facts.last_day}`);

const today = facts.last_day;

// ------------------------------------------- 1. rollups vs raw (dashboard)

// The SQL on the "rollups" side is what AnalyticsRepository sends.
const SUMS = `coalesce(sum(inspected), 0) AS inspected, coalesce(sum(ok), 0) AS ok,
  coalesce(sum(review), 0) AS review, coalesce(sum(ng), 0) AS ng,
  coalesce(sum(confirmed_defects), 0) AS confirmed_defects,
  coalesce(sum(false_calls), 0) AS false_calls, coalesce(sum(cycle_ms_sum), 0) AS cycle_ms_sum`;
const RAW_SUMS = `count(*) AS inspected, count(*) FILTER (WHERE verdict = 'OK') AS ok,
  count(*) FILTER (WHERE verdict = 'REVIEW') AS review, count(*) FILTER (WHERE verdict = 'NG') AS ng,
  count(*) FILTER (WHERE review_outcome = 'CONFIRMED_DEFECT') AS confirmed_defects,
  count(*) FILTER (WHERE review_outcome = 'FALSE_CALL') AS false_calls, coalesce(sum(cycle_ms), 0) AS cycle_ms_sum`;
const HEAT_PRODUCT = 1;
// AnalyticsRepository.cycleHistogram adds the daily arrays element by element
// (it reads the columns by position; here they are named so pg keeps them all).
const HISTOGRAM_SQL = `SELECT ${Array.from({ length: 120 }, (_, i) => `sum(cycle_hist[${i + 1}]) AS b${i + 1}`).join(", ")}
  FROM daily_yield WHERE local_day BETWEEN $1 AND $2`;
// What it sent before: one row per bucket per day, then GROUP BY.
const HISTOGRAM_UNNEST_SQL = `SELECT u.k AS k, sum(u.v) AS n FROM daily_yield
  CROSS JOIN LATERAL unnest(cycle_hist) WITH ORDINALITY AS u(v, k)
  WHERE local_day BETWEEN $1 AND $2 GROUP BY u.k ORDER BY u.k`;

const pairs: Pair[] = [];
console.error("dashboard: rollups vs raw tables");
for (const [days, from] of [
  [30, facts.from30],
  [90, facts.from90],
] as const) {
  const v = [from, today];
  const detail = `${days} days`;
  pairs.push(
    await pair(
      "dashboard",
      "KPI totals",
      detail,
      { label: "rollups", q: { text: `SELECT ${SUMS} FROM daily_yield WHERE local_day BETWEEN $1 AND $2`, values: v } },
      { label: "raw", q: { text: `SELECT ${RAW_SUMS} FROM inspection WHERE local_day BETWEEN $1 AND $2`, values: v } },
    ),
    await pair(
      "dashboard",
      "Cycle-time histogram",
      detail,
      { label: "rollups", q: { text: HISTOGRAM_SQL, values: v }, shape: histogram },
      {
        label: "raw",
        q: {
          text: `SELECT LEAST(cycle_ms / 250, 119) + 1 AS k, count(*) AS n FROM inspection
                 WHERE local_day BETWEEN $1 AND $2 GROUP BY 1 ORDER BY 1`,
          values: v,
        },
        shape: histogram,
      },
    ),
    await pair(
      "dashboard",
      "Daily yield trend",
      detail,
      {
        label: "rollups",
        q: {
          text: `SELECT local_day, ${SUMS} FROM daily_yield WHERE local_day BETWEEN $1 AND $2
                 GROUP BY local_day ORDER BY local_day`,
          values: v,
        },
      },
      {
        label: "raw",
        q: {
          text: `SELECT local_day, ${RAW_SUMS} FROM inspection WHERE local_day BETWEEN $1 AND $2
                 GROUP BY local_day ORDER BY local_day`,
          values: v,
        },
      },
    ),
    await pair(
      "dashboard",
      "Defect Pareto",
      detail,
      {
        label: "rollups",
        q: {
          text: `SELECT defect_class, sum(n) AS n FROM daily_defects WHERE local_day BETWEEN $1 AND $2
                 GROUP BY defect_class ORDER BY defect_class`,
          values: v,
        },
      },
      {
        label: "raw",
        q: {
          text: `SELECT d.defect_class, count(*) AS n FROM defect d JOIN inspection i ON i.id = d.inspection_id
                 WHERE i.local_day BETWEEN $1 AND $2 GROUP BY d.defect_class ORDER BY d.defect_class`,
          values: v,
        },
      },
    ),
    await pair(
      "dashboard",
      "Defect heatmap (one product)",
      detail,
      {
        label: "rollups",
        q: {
          text: `SELECT cx, cy, sum(n) AS n FROM daily_defect_cells
                 WHERE local_day BETWEEN $1 AND $2 AND product_id = $3 GROUP BY cx, cy ORDER BY cy, cx`,
          values: [...v, HEAT_PRODUCT],
        },
      },
      {
        label: "raw",
        q: {
          text: `SELECT defect_cell(d.x_mm + d.w_mm / 2, p.board_width_mm, 24) AS cx,
                        defect_cell(d.y_mm + d.h_mm / 2, p.board_height_mm, 16) AS cy, count(*) AS n
                 FROM defect d JOIN inspection i ON i.id = d.inspection_id JOIN product p ON p.id = i.product_id
                 WHERE i.local_day BETWEEN $1 AND $2 AND i.product_id = $3
                 GROUP BY 1, 2 ORDER BY 2, 1`,
          values: [...v, HEAT_PRODUCT],
        },
      },
    ),
  );
}

console.error("tuning: histogram query, element-wise sums vs unnest");
for (const [days, from] of [
  [30, facts.from30],
  [90, facts.from90],
] as const) {
  pairs.push(
    await pair(
      "tuning",
      "Cycle-time histogram",
      `${days} days`,
      { label: "element-wise sums", q: { text: HISTOGRAM_SQL, values: [from, today] }, shape: histogram },
      { label: "unnest + GROUP BY", q: { text: HISTOGRAM_UNNEST_SQL, values: [from, today] }, shape: histogram },
    ),
  );
}

// --------------------------------------- 2. list queries, with vs without V2

// SELECT_VIEW and the filters below are what InspectionRepository.find builds.
const SELECT_VIEW = `SELECT i.id, i.external_id, i.serial_number, i.line_id, l.code AS line_code,
       i.product_id, p.part_number, tp.version AS profile_version,
       i.inspected_at, i.local_day, i.verdict, i.anomaly_score, i.cycle_ms,
       i.review_outcome, i.reviewed_by, i.reviewed_at,
       (SELECT count(*) FROM defect d WHERE d.inspection_id = i.id) AS defect_count
FROM inspection i
JOIN line l ON l.id = i.line_id
JOIN product p ON p.id = i.product_id
JOIN threshold_profile tp ON tp.id = i.profile_id`;
const NEWEST = " ORDER BY i.inspected_at DESC, i.id DESC LIMIT 50";
const OLDEST = " ORDER BY i.inspected_at, i.id LIMIT 50";

const bounds = async (from: string) =>
  (
    await rows({
      text: `SELECT (($1::date)::timestamp AT TIME ZONE $3)::text AS f, (($2::date + 1)::timestamp AT TIME ZONE $3)::text AS t`,
      values: [from, today, args.tz],
    })
  )[0] as { f: string; t: string };
const b30 = await bounds(facts.from30);
const b90 = await bounds(facts.from90);
const probe = (
  await rows({
    text: `SELECT (SELECT serial_number FROM inspection WHERE id = (SELECT max(id) / 2 FROM inspection)) AS serial,
                  (SELECT id FROM inspection WHERE verdict = 'NG' AND id > (SELECT max(id) / 2 FROM inspection)
                   ORDER BY id LIMIT 1) AS flagged_id`,
    values: [],
  })
)[0] as { serial: string; flagged_id: string };

const dropV2 = async () => {
  await client.query(`DROP INDEX ${V2_INDEXES.join(", ")}`);
};
const range30 = " WHERE true AND i.inspected_at >= $1 AND i.inspected_at < $2";
const listCases: { name: string; detail: string; q: Query }[] = [
  { name: "Inspection list, newest 50", detail: "30 days", q: { text: SELECT_VIEW + range30 + NEWEST, values: [b30.f, b30.t] } },
  {
    name: "Inspection list, one line",
    detail: "30 days",
    q: { text: SELECT_VIEW + range30 + " AND i.line_id = $3" + NEWEST, values: [b30.f, b30.t, 2] },
  },
  {
    name: "Review queue, oldest 50 pending",
    detail: "30 days",
    q: {
      text: SELECT_VIEW + range30 + " AND i.verdict <> 'OK' AND i.review_outcome IS NULL" + OLDEST,
      values: [b30.f, b30.t],
    },
  },
  {
    name: "Serial-number search",
    detail: "all data",
    q: { text: SELECT_VIEW + " WHERE true AND i.serial_number = $1" + NEWEST, values: [probe.serial] },
  },
  {
    name: "Defect boxes of one board",
    detail: "detail page",
    q: {
      text: `SELECT id, defect_class, x_mm, y_mm, w_mm, h_mm, confidence FROM defect WHERE inspection_id = $1 ORDER BY id`,
      values: [probe.flagged_id],
    },
  },
];
console.error("list queries: with vs without V2 indexes");
for (const c of listCases) {
  pairs.push(
    await pair("indexes", c.name, c.detail, { label: "with V2", q: c.q }, { label: "without V2", q: c.q, inTransaction: dropV2 }),
  );
}

// ------------------------------------------------ 3. keyset vs OFFSET paging

console.error("deep page: keyset vs OFFSET");
const cursor = (
  await rows({
    text: `SELECT inspected_at::text AS ts, id FROM inspection WHERE inspected_at >= $1 AND inspected_at < $2
           ORDER BY inspected_at DESC, id DESC OFFSET $3 LIMIT 1`,
    values: [b90.f, b90.t, DEEP - 1],
  })
)[0] as { ts: string; id: string };
const range90 = " WHERE true AND i.inspected_at >= $1 AND i.inspected_at < $2";
const page = DEEP / 50 + 1;
pairs.push(
  await pair(
    "paging",
    `Inspection list, page ${int(page)}`,
    `rows ${int(DEEP + 1)}-${int(DEEP + 50)}, 90 days`,
    {
      label: "keyset cursor",
      q: {
        text: SELECT_VIEW + range90 + " AND (i.inspected_at, i.id) < ($3::timestamptz, $4::bigint)" + NEWEST,
        values: [b90.f, b90.t, cursor.ts, cursor.id],
      },
    },
    { label: "OFFSET", q: { text: SELECT_VIEW + range90 + NEWEST + ` OFFSET ${DEEP}`, values: [b90.f, b90.t] } },
  ),
);

// ----------------------------------------------------------------- storage

const storage = (await rows({
  text: `SELECT c.relname AS name, c.relkind AS kind, pg_relation_size(c.oid) AS bytes,
                CASE WHEN c.relkind = 'r' THEN pg_total_relation_size(c.oid) END AS total_bytes
         FROM pg_class c
         WHERE c.relname = ANY($1)
         ORDER BY c.relkind DESC, pg_relation_size(c.oid) DESC`,
  values: [
    [
      "inspection",
      "defect",
      "daily_yield",
      "daily_defects",
      "daily_defect_cells",
      "inspection_time_id_idx",
      "inspection_pending_review_idx",
    ],
  ],
})) as { name: string; kind: string; bytes: string; total_bytes: string | null }[];
const counts = (
  await rows({
    text: `SELECT (SELECT count(*) FROM daily_yield) AS daily_yield, (SELECT count(*) FROM daily_defects) AS daily_defects,
                  (SELECT count(*) FROM daily_defect_cells) AS daily_defect_cells,
                  (SELECT count(*) FROM inspection WHERE verdict <> 'OK' AND review_outcome IS NULL) AS inspection_pending_review_idx,
                  (SELECT count(*) FROM inspection) AS inspection, (SELECT count(*) FROM inspection) AS inspection_time_id_idx,
                  (SELECT count(*) FROM defect) AS defect`,
    values: [],
  })
)[0] as Record<string, string>;

await client.end();

// ------------------------------------------------------------------ report

const mb = (b: number) => (b >= 2 ** 20 ? `${(b / 2 ** 20).toFixed(1)} MB` : `${Math.round(b / 1024)} kB`);
const bySection = (s: Pair["section"]) => pairs.filter((p) => p.section === s);

const header = [
  `Data: ${int(Number(facts.boards))} boards and ${int(Number(facts.defects))} defect boxes over ` +
    `${facts.first_day} .. ${facts.last_day} (${args.tz}); ${int(Number(facts.pending))} boards awaiting review.`,
  `Machine: ${machine()}. PostgreSQL ${facts.pg_version}, shared_buffers ${facts.shared_buffers}, ` +
    `work_mem ${facts.work_mem}, up to ${facts.parallel} parallel workers per query.`,
  `Each query: warm-up runs, then ${RUNS} timed runs (7 when one run takes over 250 ms), measured at the client ` +
    `from send to last row. Median (p50) shown; p95 in the JSON. Both sides of every row return identical results.`,
].join("\n");

const dash = bySection("dashboard");
const overview = (days: string, side: "fast" | "slow") =>
  dash.filter((p) => p.detail === days).reduce((s, p) => s + p[side].latency.p50, 0);
const dashTable = table(
  ["Query", "Range", "Rollups", "Raw tables", "Faster"],
  [
    ...dash.map((p) => [p.name, p.detail, ms(p.fast.latency.p50), ms(p.slow.latency.p50), times(p.slow.latency.p50, p.fast.latency.p50)]),
    ...["30 days", "90 days"].map((d) => [
      "**All five (Overview page)**",
      d,
      `**${ms(overview(d, "fast"))}**`,
      `**${ms(overview(d, "slow"))}**`,
      `**${times(overview(d, "slow"), overview(d, "fast"))}**`,
    ]),
  ],
  ["l", "l", "r", "r", "r"],
);

const tuning = bySection("tuning");
const tuningTable = table(
  ["Query", "Range", "Element-wise sums (now)", "unnest + GROUP BY (before)", "Faster"],
  tuning.map((p) => [p.name, p.detail, ms(p.fast.latency.p50), ms(p.slow.latency.p50), times(p.slow.latency.p50, p.fast.latency.p50)]),
  ["l", "l", "r", "r", "r"],
);

const idx = bySection("indexes");
const idxTable = table(
  ["Query", "Scope", "With V2 indexes", "Plan", "Without", "Plan", "Faster"],
  idx.map((p) => [
    p.name,
    p.detail,
    ms(p.fast.latency.p50),
    p.fast.plan,
    ms(p.slow.latency.p50),
    p.slow.plan,
    times(p.slow.latency.p50, p.fast.latency.p50),
  ]),
  ["l", "l", "r", "l", "r", "l", "r"],
);

const deep = bySection("paging");
const pageTable = table(
  ["Query", "Rows", "Keyset cursor", "OFFSET", "Faster"],
  deep.map((p) => [p.name, p.detail, ms(p.fast.latency.p50), ms(p.slow.latency.p50), times(p.slow.latency.p50, p.fast.latency.p50)]),
  ["l", "l", "r", "r", "r"],
);

const storageTable = table(
  ["Relation", "Rows", "Size"],
  storage.map((r) => [
    r.kind === "i" ? `${r.name} (index)` : r.name,
    int(Number(counts[r.name] ?? 0)),
    r.total_bytes ? `${mb(Number(r.bytes))} (${mb(Number(r.total_bytes))} with indexes)` : mb(Number(r.bytes)),
  ]),
  ["l", "r", "r"],
);

const markdown = [
  "## SQL benchmark",
  header,
  "### Dashboard queries: daily rollups vs raw tables",
  dashTable,
  "### Tuning: summing the cycle-time histograms",
  tuningTable,
  "### List queries: with vs without the V2 indexes",
  idxTable,
  "### Deep pages: keyset cursor vs OFFSET",
  pageTable,
  "### Storage",
  storageTable,
].join("\n\n");
publish(markdown, args.markdown);
// The whole report as one annotation too, so it can be read through the API.
notice("SQL benchmark, full report (markdown)", [markdown]);

const line = (p: Pair) => `${p.name} (${p.detail}): ${ms(p.fast.latency.p50)} vs ${ms(p.slow.latency.p50)}, ${times(p.slow.latency.p50, p.fast.latency.p50)}`;
notice("SQL: rollups vs raw tables (p50)", [
  ...dash.map(line),
  `Overview, 30 days: ${ms(overview("30 days", "fast"))} vs ${ms(overview("30 days", "slow"))}`,
  `Overview, 90 days: ${ms(overview("90 days", "fast"))} vs ${ms(overview("90 days", "slow"))}`,
]);
notice("SQL: with vs without V2 indexes (p50)", [
  ...idx.map(line),
  ...deep.map((p) => `keyset vs OFFSET, ${line(p)}`),
  ...tuning.map((p) => `histogram, element-wise sums vs unnest, ${line(p)}`),
]);

if (args.json) {
  writeFileSync(args.json, JSON.stringify({ facts, machine: machine(), runs: RUNS, pairs, storage, counts }, null, 2) + "\n");
}
