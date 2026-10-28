// Markdown tables for docs/PERFORMANCE.md and the GitHub job summary, plus
// workflow-command notices so the headline numbers show on the run page.

import { appendFileSync, writeFileSync } from "node:fs";
import { cpus, totalmem } from "node:os";

export function table(header: string[], rows: string[][], align?: ("l" | "r")[]): string {
  const sep = header.map((_, i) => ((align?.[i] ?? "l") === "r" ? "---:" : "---"));
  const line = (cells: string[]) => `| ${cells.join(" | ")} |`;
  return [line(header), line(sep), ...rows.map(line)].join("\n");
}

export function machine(): string {
  const cpu = cpus();
  const model = cpu[0]?.model.replace(/\s+/g, " ").trim() ?? "unknown CPU";
  const gb = (totalmem() / 2 ** 30).toFixed(0);
  return `${cpu.length} vCPU (${model}), ${gb} GB RAM, Node ${process.versions.node}`;
}

/** Writes the report to --markdown, and to the job summary when run in GitHub Actions. */
export function publish(markdown: string, path: string | undefined): void {
  console.log(markdown);
  if (path) writeFileSync(path, markdown + "\n");
  const summary = process.env.GITHUB_STEP_SUMMARY;
  if (summary) appendFileSync(summary, markdown + "\n\n");
}

/**
 * A notice annotation (GitHub Actions only). The text is kept short and
 * line-based so it reads well both on the run page and through the API.
 */
export function notice(title: string, lines: string[]): void {
  if (!process.env.GITHUB_ACTIONS) return;
  const esc = (s: string) => s.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
  const props = (s: string) => esc(s).replace(/:/g, "%3A").replace(/,/g, "%2C");
  console.log(`::notice title=${props(title)}::${esc(lines.join("\n"))}`);
}
