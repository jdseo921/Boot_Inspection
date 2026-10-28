import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { useHeatmap, usePareto, useProducts, useSummary, useTrend } from "../api/queries";
import type { ParetoBar, TrendPoint } from "../api/types";
import { BoardHeatmap } from "../charts/BoardHeatmap";
import { LineChart, type LinePoint } from "../charts/LineChart";
import { ParetoChart } from "../charts/ParetoChart";
import { FilterBar } from "../components/FilterBar";
import { Panel } from "../components/Panel";
import { Empty, ErrorState, Loading } from "../components/States";
import { useLocale } from "../i18n";
import { count, percent, seconds, shortDay } from "../lib/format";
import { useScope } from "../lib/scope";

export function OverviewPage() {
  const { t } = useTranslation();
  const locale = useLocale();
  const state = useScope();
  const summary = useSummary(state.scope);
  const trend = useTrend(state.scope);
  const pareto = usePareto(state.scope);
  const products = useProducts();
  const heatProduct = state.productId ?? products.data?.[0]?.id;
  const heatmap = useHeatmap(state.scope, heatProduct);

  const s = summary.data;
  const linkParams = new URLSearchParams();
  linkParams.set("days", String(state.days));
  if (state.lineId) linkParams.set("line", String(state.lineId));
  if (heatProduct) linkParams.set("product", String(heatProduct));

  return (
    <>
      <FilterBar state={state} />

      {summary.isError && <ErrorState error={summary.error} onRetry={() => void summary.refetch()} />}
      {!s && !summary.isError && <Loading />}
      {s && s.inspected === 0 && <Empty>{t("chart.noData")}</Empty>}

      {s && s.inspected > 0 && (
        <>
          <section className={summary.isPlaceholderData ? "kpis is-refetching" : "kpis"} aria-label={t("kpi.fpy")}>
            <div className="kpi kpi-hero">
              <h2 className="kpi-label">{t("kpi.fpy")}</h2>
              <p className="kpi-value">{percent(s.firstPassYield, locale)}</p>
              <p className="kpi-note">{t("kpi.boards", { n: count(s.inspected, locale) })}</p>
            </div>
            <div className="kpi">
              <h2 className="kpi-label">{t("kpi.falseCallRate")}</h2>
              <p className="kpi-value">{percent(s.falseCallRate, locale)}</p>
              <p className="kpi-note">
                {t("kpi.falseCallHelp", {
                  falseCalls: count(s.falseCalls, locale),
                  reviewed: count(s.falseCalls + s.confirmedDefects, locale),
                })}
              </p>
            </div>
            <div className="kpi">
              <h2 className="kpi-label">{t("kpi.finalYield")}</h2>
              <p className="kpi-value">{percent(s.finalYield, locale, 2)}</p>
              <p className="kpi-note">{t("kpi.finalYieldHelp")}</p>
            </div>
            <div className="kpi">
              <h2 className="kpi-label">{t("kpi.pending")}</h2>
              <p className="kpi-value">{count(s.pendingReview, locale)}</p>
              <p className="kpi-note">
                <Link to={`/review?${linkParams.toString()}`}>{t("kpi.pendingLink")}</Link>
              </p>
            </div>
            <div className="kpi">
              <h2 className="kpi-label">{t("kpi.cycle")}</h2>
              <p className="kpi-value">{seconds(s.p50CycleMs, locale)}</p>
              <p className="kpi-note">
                {t("kpi.cycleValue", { p50: seconds(s.p50CycleMs, locale), p95: seconds(s.p95CycleMs, locale) })}
              </p>
            </div>
          </section>

          <div className="grid-overview">
            <div className="stack">
              <Panel
                title={t("chart.fpyTitle")}
                refetching={trend.isPlaceholderData}
                table={trend.data && <TrendTable rows={trend.data} pick="firstPassYield" />}
              >
                {trend.data ? (
                  <LineChart
                    label={t("chart.fpyTitle")}
                    points={toPoints(trend.data, "firstPassYield", (p) =>
                      t("kpi.boards", { n: count(p.inspected, locale) }),
                    )}
                    formatY={(v) => percent(v, locale)}
                    formatX={(d) => shortDay(d, locale)}
                  />
                ) : (
                  <Loading />
                )}
              </Panel>

              <Panel
                title={t("chart.falseCallTitle")}
                refetching={trend.isPlaceholderData}
                table={trend.data && <TrendTable rows={trend.data} pick="falseCallRate" />}
              >
                {trend.data ? (
                  <LineChart
                    label={t("chart.falseCallTitle")}
                    points={toPoints(trend.data, "falseCallRate")}
                    formatY={(v) => percent(v, locale)}
                    formatX={(d) => shortDay(d, locale)}
                  />
                ) : (
                  <Loading />
                )}
              </Panel>
            </div>
            <div className="stack">
              <Panel
                className="panel-heat"
                title={t("chart.heatTitle", { part: heatmap.data?.partNumber ?? "" })}
                refetching={heatmap.isPlaceholderData}
                actions={<Link to={`/defects?${linkParams.toString()}`}>{t("chart.openDefects")}</Link>}
              >
                {heatmap.data ? (
                  heatmap.data.total === 0 ? (
                    <Empty>{t("chart.heatEmpty")}</Empty>
                  ) : (
                    <BoardHeatmap
                      heatmap={heatmap.data}
                      label={t("chart.heatTitle", { part: heatmap.data.partNumber })}
                      scaleLabel={t("chart.heatScale")}
                      formatCount={(n) => count(n, locale)}
                      describeCell={(x0, x1, y0, y1) => t("chart.cellRange", { x0, x1, y0, y1 })}
                    />
                  )
                ) : (
                  <Loading />
                )}
              </Panel>

              <Panel
                title={t("chart.paretoTitle")}
                refetching={pareto.isPlaceholderData}
                table={pareto.data && <ParetoTable bars={pareto.data} />}
              >
                {pareto.data ? (
                  <ParetoChart
                    bars={pareto.data}
                    className={(c) => t(`defectClass.${c}`)}
                    formatCount={(n) => count(n, locale)}
                    formatShare={(x) => percent(x, locale)}
                    cumulativeLabel={t("chart.cumulative")}
                  />
                ) : (
                  <Loading />
                )}
              </Panel>
            </div>
          </div>
        </>
      )}
    </>
  );
}

function toPoints(
  rows: TrendPoint[],
  key: "firstPassYield" | "falseCallRate",
  note?: (p: TrendPoint) => string,
): LinePoint[] {
  return rows.map((p) => ({ x: p.day, y: p[key], note: note?.(p) }));
}

function TrendTable({ rows, pick }: { rows: TrendPoint[]; pick: "firstPassYield" | "falseCallRate" }) {
  const { t } = useTranslation();
  const locale = useLocale();
  return (
    <div className="table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            <th scope="col">{t("chart.day")}</th>
            <th scope="col" className="num">
              {t("chart.boards")}
            </th>
            <th scope="col" className="num">
              {t("chart.value")}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.day}>
              <td>{shortDay(r.day, locale)}</td>
              <td className="num">{count(r.inspected, locale)}</td>
              <td className="num">{percent(r[pick], locale, 2)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ParetoTable({ bars }: { bars: ParetoBar[] }) {
  const { t } = useTranslation();
  const locale = useLocale();
  return (
    <table className="data-table">
      <thead>
        <tr>
          <th scope="col">{t("defects.byClass")}</th>
          <th scope="col" className="num">
            {t("chart.count")}
          </th>
          <th scope="col" className="num">
            {t("chart.share")}
          </th>
          <th scope="col" className="num">
            {t("chart.cumulative")}
          </th>
        </tr>
      </thead>
      <tbody>
        {bars.map((b) => (
          <tr key={b.defectClass}>
            <td>{t(`defectClass.${b.defectClass}`)}</td>
            <td className="num">{count(b.count, locale)}</td>
            <td className="num">{percent(b.share, locale)}</td>
            <td className="num">{percent(b.cumulativeShare, locale)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
