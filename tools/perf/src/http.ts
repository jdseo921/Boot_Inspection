// HTTP load test against a running Boot Inspection API on a loaded database.
//
//   npm run http -- --base-url http://127.0.0.1:8080 [--duration 20] [--connections 16]
//
// Closed loop: each connection sends its next request as soon as the last one
// completes, so the latencies are service times at that concurrency, and the
// throughput is what the API sustained, not a target rate. Every response is
// checked (status, and for ingest the number of boards actually stored); a
// wrong answer counts as an error, not as a fast response.

import { writeFileSync } from "node:fs";
import http from "node:http";
import { parseArgs } from "node:util";
import { BoardSource } from "./boards.ts";
import { machine, notice, publish, table } from "./report.ts";
import { int, ms, summarize, type Summary } from "./stats.ts";

const { values: args } = parseArgs({
  options: {
    "base-url": { type: "string", default: "http://127.0.0.1:8080" },
    duration: { type: "string", default: "20" },
    warmup: { type: "string", default: "5" },
    connections: { type: "string", default: "16" },
    "ingest-connections": { type: "string", default: "4" },
    seed: { type: "string" },
    only: { type: "string" },
    json: { type: "string" },
    markdown: { type: "string" },
  },
});

const BASE = new URL(args["base-url"]);
const DURATION_MS = Number(args.duration) * 1000;
const WARMUP_MS = Number(args.warmup) * 1000;
const CONNECTIONS = Number(args.connections);
const INGEST_CONNECTIONS = Number(args["ingest-connections"]);

const agent = new http.Agent({ keepAlive: true, maxSockets: Math.max(CONNECTIONS, INGEST_CONNECTIONS) * 6 });

interface Reply {
  status: number;
  body: string;
}

function send(method: "GET" | "POST", path: string, body?: string): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const headers: http.OutgoingHttpHeaders = body
      ? { "content-type": "application/json", "content-length": Buffer.byteLength(body), accept: "application/json" }
      : // Browsers ask for gzip, and the API compresses JSON over 2 kB.
        { accept: "application/json", "accept-encoding": "gzip" };
    const req = http.request(new URL(path, BASE), { method, agent, headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString() }));
      res.on("error", reject);
    });
    req.on("error", reject);
    req.end(body);
  });
}

async function getJson<T>(path: string): Promise<T> {
  const r = await new Promise<Reply>((resolve, reject) => {
    http
      .get(new URL(path, BASE), { agent, headers: { accept: "application/json" } }, (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString() }));
      })
      .on("error", reject);
  });
  if (r.status !== 200) throw new Error(`GET ${path}: HTTP ${r.status} ${r.body.slice(0, 200)}`);
  return JSON.parse(r.body) as T;
}

/** One unit of work. `units` is what it achieved (boards stored for ingest, else 1). */
type Step = () => Promise<{ ok: boolean; units: number }>;

interface Scenario {
  name: string;
  what: string;
  connections: number;
  unit?: string;
  step: Step;
}

interface Result {
  name: string;
  what: string;
  connections: number;
  requests: number;
  errors: number;
  perSecond: number;
  units: number;
  unitsPerSecond: number;
  unit?: string;
  latency: Summary;
  firstError?: string;
}

async function run(s: Scenario): Promise<Result> {
  let recording = false;
  let stop = false;
  const samples: number[] = [];
  let errors = 0;
  let units = 0;
  let firstError: string | undefined;

  const worker = async () => {
    while (!stop) {
      const t0 = performance.now();
      let ok = false;
      let u = 0;
      try {
        const r = await s.step();
        ok = r.ok;
        u = r.units;
      } catch (e) {
        firstError ??= String(e);
      }
      const elapsed = performance.now() - t0;
      if (!recording) continue;
      if (ok) {
        samples.push(elapsed);
        units += u;
      } else {
        errors += 1;
      }
    }
  };

  const workers = Array.from({ length: s.connections }, worker);
  await sleep(WARMUP_MS);
  recording = true;
  const t0 = performance.now();
  await sleep(DURATION_MS);
  stop = true;
  const elapsedS = (performance.now() - t0) / 1000;
  await Promise.all(workers);

  if (samples.length === 0) throw new Error(`${s.name}: no successful requests. First error: ${firstError ?? "a check failed"}`);
  const result: Result = {
    name: s.name,
    what: s.what,
    connections: s.connections,
    requests: samples.length,
    errors,
    perSecond: samples.length / elapsedS,
    units,
    unitsPerSecond: units / elapsedS,
    unit: s.unit,
    latency: summarize(samples),
    firstError,
  };
  console.error(
    `  ${s.name}: ${int(result.perSecond)} req/s, p50 ${ms(result.latency.p50)}, p95 ${ms(result.latency.p95)}` +
      (s.unit ? `, ${int(result.unitsPerSecond)} ${s.unit}/s` : "") +
      (errors ? `, ${errors} errors` : ""),
  );
  return result;
}

const sleep = (msec: number) => new Promise((r) => setTimeout(r, msec));

// ------------------------------------------------------------- scenarios

interface Meta {
  timezone: string;
  today: string;
}
interface Page {
  items: { id: number }[];
}
interface Product {
  id: number;
}
interface BatchResult {
  received: number;
  created: number;
}

const meta = await getJson<Meta>("/api/v1/meta");
const addDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const scope = `from=${addDays(meta.today, -29)}&to=${meta.today}`;
const newest = await getJson<Page>(`/api/v1/inspections?limit=1&${scope}`);
const products = await getJson<Product[]>("/api/v1/products");
if (newest.items.length === 0) throw new Error("no inspections in the last 30 days; load data first");
const maxId = newest.items[0].id;
const product = products[0].id;
const boardCount = maxId;

const seed = args.seed ? Number(args.seed) : Date.now() % 1_000_000_007;
const boards = new BoardSource(seed, Date.now(), meta.timezone);

const get =
  (path: () => string): Step =>
  async () => {
    const r = await send("GET", path());
    return { ok: r.status === 200, units: 1 };
  };

const overviewPaths = [
  `/api/v1/analytics/summary?${scope}`,
  `/api/v1/analytics/yield-trend?${scope}`,
  `/api/v1/analytics/defect-pareto?${scope}`,
  `/api/v1/analytics/defect-heatmap?productId=${product}&${scope}`,
];

const scenarios: Scenario[] = [
  {
    name: "Overview page data",
    what: "summary + yield trend + Pareto + heatmap, sent together like the page does",
    connections: CONNECTIONS,
    step: async () => {
      const rs = await Promise.all(overviewPaths.map((p) => send("GET", p)));
      return { ok: rs.every((r) => r.status === 200), units: 1 };
    },
  },
  { name: "KPI summary", what: "GET /analytics/summary, 30 days", connections: CONNECTIONS, step: get(() => overviewPaths[0]) },
  { name: "Yield trend", what: "GET /analytics/yield-trend, 30 days", connections: CONNECTIONS, step: get(() => overviewPaths[1]) },
  { name: "Defect Pareto", what: "GET /analytics/defect-pareto, 30 days", connections: CONNECTIONS, step: get(() => overviewPaths[2]) },
  { name: "Defect heatmap", what: "GET /analytics/defect-heatmap, 30 days", connections: CONNECTIONS, step: get(() => overviewPaths[3]) },
  {
    name: "Inspection list",
    what: "GET /inspections, newest 50 in 30 days",
    connections: CONNECTIONS,
    step: get(() => `/api/v1/inspections?limit=50&${scope}`),
  },
  {
    name: "Review queue",
    what: "GET /inspections?status=pending&sort=oldest, 50",
    connections: CONNECTIONS,
    step: get(() => `/api/v1/inspections?status=pending&sort=oldest&limit=50&${scope}`),
  },
  {
    name: "Board detail",
    what: "GET /inspections/{id}, random board of all",
    connections: CONNECTIONS,
    step: get(() => `/api/v1/inspections/${1 + Math.floor(Math.random() * maxId)}`),
  },
  {
    name: "Ingest, one board per request",
    what: "POST /inspections",
    connections: CONNECTIONS,
    unit: "boards",
    step: async () => {
      const r = await send("POST", "/api/v1/inspections", JSON.stringify(boards.next()));
      return { ok: r.status === 201, units: r.status === 201 ? 1 : 0 };
    },
  },
  {
    name: "Ingest, 1,000-board batches",
    what: "POST /inspections/batch",
    connections: INGEST_CONNECTIONS,
    unit: "boards",
    step: async () => {
      const batch = boards.take(1000);
      const r = await send("POST", "/api/v1/inspections/batch", JSON.stringify({ inspections: batch }));
      if (r.status !== 200) return { ok: false, units: 0 };
      const result = JSON.parse(r.body) as BatchResult;
      return { ok: result.created === batch.length, units: result.created };
    },
  },
];

// --only "review,detail" runs the scenarios whose names contain any of the words.
const wanted = args.only?.toLowerCase().split(",").map((w) => w.trim());
const selected = wanted ? scenarios.filter((s) => wanted.some((w) => s.name.toLowerCase().includes(w))) : scenarios;
console.error(`${int(boardCount)} boards loaded; ${selected.length} scenarios, ${args.warmup} s warm-up + ${args.duration} s each`);
const results: Result[] = [];
for (const s of selected) results.push(await run(s));
agent.destroy();

// ------------------------------------------------------------------ report

const markdown = [
  "## HTTP load test",
  [
    `API at ${BASE.origin} with ${int(boardCount)} boards loaded; dates ${scope.replace("&", " .. ").replace(/(from|to)=/g, "")} (${meta.timezone}).`,
    `Load generator on the same machine: ${machine()}.`,
    `Closed loop: ${args.warmup} s warm-up, then ${args.duration} s measured per row. Latency is per request ` +
      `(per page for the Overview row), from send to last byte. Errors include wrong answers.`,
  ].join("\n"),
  table(
    ["Scenario", "Request", "Concurrency", "Throughput", "p50", "p95", "p99", "Errors"],
    results.map((r) => [
      r.name,
      r.what,
      String(r.connections),
      r.unit ? `${int(r.perSecond)} req/s (${int(r.unitsPerSecond)} ${r.unit}/s)` : `${int(r.perSecond)} req/s`,
      ms(r.latency.p50),
      ms(r.latency.p95),
      ms(r.latency.p99),
      String(r.errors),
    ]),
    ["l", "l", "r", "r", "r", "r", "r", "r"],
  ),
].join("\n\n");
publish(markdown, args.markdown);

notice(
  "HTTP load test (p50 / p95 / p99, throughput)",
  results.map(
    (r) =>
      `${r.name} x${r.connections}: ${ms(r.latency.p50)} / ${ms(r.latency.p95)} / ${ms(r.latency.p99)}, ` +
      `${int(r.perSecond)} req/s` +
      (r.unit ? `, ${int(r.unitsPerSecond)} ${r.unit}/s` : "") +
      (r.errors ? `, ${r.errors} errors` : ""),
  ),
);

if (args.json) {
  writeFileSync(args.json, JSON.stringify({ machine: machine(), base: BASE.origin, scope, results }, null, 2) + "\n");
}
if (results.some((r) => r.errors > 0)) {
  console.error("some requests failed; see the Errors column");
  process.exitCode = 1;
}
