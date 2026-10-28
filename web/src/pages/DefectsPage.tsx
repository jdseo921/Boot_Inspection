import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router";
import { useHeatmap, usePareto, useProducts } from "../api/queries";
import { DEFECT_CLASSES, type DefectClass, type Heatmap } from "../api/types";
import { BoardHeatmap } from "../charts/BoardHeatmap";
import { ParetoChart } from "../charts/ParetoChart";
import { FilterBar } from "../components/FilterBar";
import { Panel } from "../components/Panel";
import { Empty, ErrorState, Loading } from "../components/States";
import { useLocale } from "../i18n";
import { count, decimal, percent } from "../lib/format";
import { useScope } from "../lib/scope";
import { ParetoTable } from "./OverviewPage";

export function DefectsPage() {
  const { t } = useTranslation();
  const locale = useLocale();
  const state = useScope();
  const [params, setParams] = useSearchParams();
  const products = useProducts();
  const productId = state.productId ?? products.data?.[0]?.id;
  const cls = DEFECT_CLASSES.find((c) => c === params.get("class"));
  const heatmap = useHeatmap(state.scope, productId, cls);
  const productScope = state.scope && productId ? { ...state.scope, productId } : null;
  const pareto = usePareto(productScope);

  const setClass = (c: DefectClass | undefined) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (c) next.set("class", c);
        else next.delete("class");
        return next;
      },
      { replace: true },
    );

  return (
    <>
      <FilterBar state={state} showProduct={false} />
      <div className="page-head">
        <h1>{t("defects.title")}</h1>
        <p className="page-intro">{t("defects.intro")}</p>
      </div>

      <div className="tabs" role="tablist" aria-label={t("filter.product")}>
        {products.data?.map((p) => (
          <button
            key={p.id}
            type="button"
            role="tab"
            aria-selected={p.id === productId}
            className={p.id === productId ? "tab is-on" : "tab"}
            onClick={() => state.update({ productId: p.id })}
          >
            <span>{p.partNumber}</span>
            <small>{p.name}</small>
          </button>
        ))}
      </div>

      <div className="chips" role="radiogroup" aria-label={t("defects.byClass")}>
        <button
          type="button"
          role="radio"
          aria-checked={!cls}
          className={!cls ? "chip is-on" : "chip"}
          onClick={() => setClass(undefined)}
        >
          {t("chart.heatAllClasses")}
        </button>
        {DEFECT_CLASSES.map((c) => (
          <button
            key={c}
            type="button"
            role="radio"
            aria-checked={cls === c}
            className={cls === c ? "chip is-on" : "chip"}
            onClick={() => setClass(c)}
          >
            {t(`defectClass.${c}`)}
          </button>
        ))}
      </div>

      <div className="grid-defects">
        <Panel
          className="panel-heat-large"
          title={t("chart.heatTitle", { part: heatmap.data?.partNumber ?? "" })}
          refetching={heatmap.isPlaceholderData}
          table={heatmap.data && <HeatTable heatmap={heatmap.data} />}
        >
          {heatmap.isError ? (
            <ErrorState error={heatmap.error} onRetry={() => void heatmap.refetch()} />
          ) : heatmap.data ? (
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
    </>
  );
}

/** The busiest cells first: the heatmap's table-view twin. */
function HeatTable({ heatmap: h }: { heatmap: Heatmap }) {
  const { t } = useTranslation();
  const locale = useLocale();
  const cw = h.boardWidthMm / h.cols;
  const ch = h.boardHeightMm / h.rows;
  const rows = [...h.cells].sort((a, b) => b.count - a.count).slice(0, 20);
  return (
    <table className="data-table">
      <thead>
        <tr>
          <th scope="col">{t("chart.cell")}</th>
          <th scope="col" className="num">
            {t("chart.count")}
          </th>
          <th scope="col" className="num">
            {t("chart.share")}
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((c) => (
          <tr key={`${c.cx}-${c.cy}`}>
            <td>
              {t("chart.cellRange", {
                x0: decimal(c.cx * cw, locale, 1),
                x1: decimal((c.cx + 1) * cw, locale, 1),
                y0: decimal(c.cy * ch, locale, 1),
                y1: decimal((c.cy + 1) * ch, locale, 1),
              })}
            </td>
            <td className="num">{count(c.count, locale)}</td>
            <td className="num">{percent(c.count / h.total, locale)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
