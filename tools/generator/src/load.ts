// Streams simulated boards into PostgreSQL with COPY, then rebuilds the rollups.

import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import pg from "pg";
import { from as copyFrom } from "pg-copy-streams";
import { LINES, PRODUCTS, buildProfiles } from "./catalog.ts";
import type { DefectRow, InspectionRow, SimulationOptions, SimulationStats } from "./simulate.ts";
import { simulate } from "./simulate.ts";

const DAY_MS = 86_400_000;

export interface LoadOptions extends SimulationOptions {
  databaseUrl: string;
  reset: boolean;
  log: (msg: string) => void;
}

export interface LoadResult {
  stats: SimulationStats;
  seconds: { simulateAndCopy: number; rollups: number; analyze: number };
}

const iso = (ms: number) => new Date(ms).toISOString();
const nullable = (v: string | null) => (v === null ? "\\N" : v);

export function inspectionLine(r: InspectionRow): string {
  return (
    [
      r.id,
      r.externalId,
      r.serialNumber,
      r.productId,
      r.lineId,
      r.profileId,
      iso(r.inspectedAt),
      r.localDay,
      r.verdict,
      r.anomalyScore,
      r.cycleMs,
      nullable(r.reviewOutcome),
      nullable(r.reviewedBy),
      r.reviewedAt === null ? "\\N" : iso(r.reviewedAt),
    ].join("\t") + "\n"
  );
}

export function defectLine(d: DefectRow): string {
  return [d.inspectionId, d.defectClass, d.xMm, d.yMm, d.wMm, d.hMm, d.confidence].join("\t") + "\n";
}

/**
 * One simulation pass feeds the inspection COPY directly. Defect rows (one or
 * two per flagged board, so a few percent of boards) are kept as text and
 * copied afterwards, because they reference inspection ids.
 */
export async function load(opts: LoadOptions): Promise<LoadResult> {
  const client = new pg.Client({ connectionString: opts.databaseUrl });
  await client.connect();
  try {
    const { rows } = await client.query<{ n: string }>("SELECT count(*) AS n FROM inspection");
    if (Number(rows[0].n) > 0 && !opts.reset) {
      throw new Error(`inspection already has ${rows[0].n} rows; pass --reset to replace them`);
    }

    await client.query("BEGIN");
    await client.query(
      "TRUNCATE daily_defect_cells, daily_defects, daily_yield, defect, inspection, threshold_profile, product, line RESTART IDENTITY",
    );
    await insertCatalog(client, opts);

    const t0 = performance.now();
    const defectLines: string[] = [];
    let stats: SimulationStats | undefined;
    const log = opts.log;

    function* inspectionChunks(): Generator<string> {
      const gen = simulate(opts);
      let buf: string[] = [];
      let n = 0;
      for (;;) {
        const r = gen.next();
        if (r.done) {
          stats = r.value;
          break;
        }
        buf.push(inspectionLine(r.value.inspection));
        for (const d of r.value.defects) defectLines.push(defectLine(d));
        n += 1;
        if (buf.length === 5_000) {
          yield buf.join("");
          buf = [];
          if (n % 200_000 === 0) log(`  ${n.toLocaleString("en-US")} boards`);
        }
      }
      if (buf.length > 0) yield buf.join("");
    }

    await pipeline(
      Readable.from(inspectionChunks()),
      client.query(
        copyFrom(
          "COPY inspection (id, external_id, serial_number, product_id, line_id, profile_id, inspected_at, local_day, " +
            "verdict, anomaly_score, cycle_ms, review_outcome, reviewed_by, reviewed_at) FROM STDIN",
        ),
      ),
    );
    if (!stats) throw new Error("simulation did not finish");
    log(`copied ${stats.boards.toLocaleString("en-US")} inspections`);

    function* defectChunks(): Generator<string> {
      for (let i = 0; i < defectLines.length; i += 20_000) yield defectLines.slice(i, i + 20_000).join("");
    }
    await pipeline(
      Readable.from(defectChunks()),
      client.query(copyFrom("COPY defect (inspection_id, defect_class, x_mm, y_mm, w_mm, h_mm, confidence) FROM STDIN")),
    );
    log(`copied ${defectLines.length.toLocaleString("en-US")} defects`);
    await client.query(
      "SELECT setval(pg_get_serial_sequence('inspection', 'id'), (SELECT coalesce(max(id), 1) FROM inspection))",
    );
    const t1 = performance.now();

    await client.query("SELECT rebuild_rollups()");
    const t2 = performance.now();
    await client.query("COMMIT");

    await client.query("ANALYZE");
    const t3 = performance.now();

    return {
      stats,
      seconds: {
        simulateAndCopy: (t1 - t0) / 1000,
        rollups: (t2 - t1) / 1000,
        analyze: (t3 - t2) / 1000,
      },
    };
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    await client.end();
  }
}

async function insertCatalog(client: pg.Client, opts: SimulationOptions): Promise<void> {
  for (const l of LINES) {
    await client.query("INSERT INTO line (id, code, name, site) OVERRIDING SYSTEM VALUE VALUES ($1, $2, $3, $4)", [
      l.id,
      l.code,
      l.name,
      l.site,
    ]);
  }
  for (const p of PRODUCTS) {
    await client.query(
      "INSERT INTO product (id, part_number, name, board_width_mm, board_height_mm) " +
        "OVERRIDING SYSTEM VALUE VALUES ($1, $2, $3, $4, $5)",
      [p.id, p.partNumber, p.name, p.widthMm, p.heightMm],
    );
  }
  const startMs = opts.endMs - opts.days * DAY_MS;
  for (const pr of buildProfiles(opts.days)) {
    await client.query(
      "INSERT INTO threshold_profile (id, product_id, version, pixel_diff, min_defect_area_px, model_threshold, " +
        "approved_by, approved_at) OVERRIDING SYSTEM VALUE VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
      [
        pr.id,
        pr.productId,
        pr.version,
        pr.pixelDiff,
        pr.minDefectAreaPx,
        pr.modelThreshold,
        pr.approvedBy,
        new Date(startMs + pr.approvedDay * DAY_MS),
      ],
    );
  }
  for (const table of ["line", "product", "threshold_profile"]) {
    await client.query(`SELECT setval(pg_get_serial_sequence('${table}', 'id'), (SELECT max(id) FROM ${table}))`);
  }
}
