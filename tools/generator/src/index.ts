// CLI: simulate N boards over D days and load them into PostgreSQL.
//
//   npm run generate -- --boards 1200000 --days 90 --reset
//   npm run generate -- --boards 20000 --dry-run

import { parseArgs } from "node:util";
import { load } from "./load.ts";
import { simulate, type SimulationOptions, type SimulationStats } from "./simulate.ts";

const { values } = parseArgs({
  options: {
    boards: { type: "string", default: "1200000" },
    days: { type: "string", default: "90" },
    seed: { type: "string", default: "42" },
    end: { type: "string" },
    tz: { type: "string", default: process.env.APP_TIMEZONE ?? "America/Chicago" },
    "database-url": {
      type: "string",
      default: process.env.DATABASE_URL ?? "postgres://postgres@127.0.0.1:5432/boot_inspection",
    },
    reset: { type: "boolean", default: false },
    "dry-run": { type: "boolean", default: false },
    help: { type: "boolean", default: false },
  },
});

if (values.help) {
  console.log(`Usage: npm run generate -- [options]

  --boards N        boards to simulate (default 1200000)
  --days D          length of the period in days (default 90)
  --seed S          random seed; same seed, same data (default 42)
  --end ISO         end of the period (default: now, to the minute)
  --tz ZONE         plant time zone for calendar days (default America/Chicago)
  --database-url U  PostgreSQL URL (default $DATABASE_URL)
  --reset           replace existing data
  --dry-run         simulate and print totals without touching the database`);
  process.exit(0);
}

const endMs = values.end ? Date.parse(values.end) : Math.floor(Date.now() / 60_000) * 60_000;
if (Number.isNaN(endMs)) throw new Error(`--end is not a date: ${values.end}`);

const opts: SimulationOptions = {
  boards: Number(values.boards),
  days: Number(values.days),
  seed: Number(values.seed),
  endMs,
  timeZone: values.tz,
};

const pct = (n: number, d: number) => (d === 0 ? "n/a" : `${((100 * n) / d).toFixed(2)}%`);
const fmt = (n: number) => n.toLocaleString("en-US");

function report(stats: SimulationStats): void {
  const flagged = stats.review + stats.ng;
  const reviewed = stats.confirmedDefects + stats.falseCalls;
  console.log(`period            ${stats.firstDay} .. ${stats.lastDay} (${opts.timeZone})`);
  console.log(`boards            ${fmt(stats.boards)}`);
  console.log(`  OK / REVIEW / NG ${fmt(stats.ok)} / ${fmt(stats.review)} / ${fmt(stats.ng)}`);
  console.log(`first-pass yield  ${pct(stats.ok, stats.boards)}`);
  console.log(`flagged           ${fmt(flagged)} (${pct(flagged, stats.boards)})`);
  console.log(`  confirmed       ${fmt(stats.confirmedDefects)}`);
  console.log(`  false calls     ${fmt(stats.falseCalls)} (${pct(stats.falseCalls, reviewed)} of reviewed)`);
  console.log(`  pending review  ${fmt(stats.pendingReview)}`);
  console.log(`defect regions    ${fmt(stats.defects)}`);
  console.log(`escapes (sim only, never visible to the app) ${fmt(stats.escapes)}`);
}

const log = (msg: string) => console.error(msg);

if (values["dry-run"]) {
  const t0 = performance.now();
  const gen = simulate(opts);
  let r = gen.next();
  while (!r.done) r = gen.next();
  report(r.value);
  console.log(`simulated in ${((performance.now() - t0) / 1000).toFixed(1)} s`);
} else {
  const result = await load({ ...opts, databaseUrl: values["database-url"], reset: values.reset, log });
  report(result.stats);
  const s = result.seconds;
  console.log(
    `simulate+COPY ${s.simulateAndCopy.toFixed(1)} s, rebuild rollups ${s.rollups.toFixed(1)} s, ANALYZE ${s.analyze.toFixed(1)} s`,
  );
}
