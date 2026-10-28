import { useTranslation } from "react-i18next";
import { useLines, useProducts } from "../api/queries";
import { DAY_PRESETS, type ScopeState } from "../lib/scope";

/**
 * One row above everything it scopes: period first, then line and board
 * type. Every panel below re-renders against the same slice.
 */
export function FilterBar({ state, showProduct = true }: { state: ScopeState; showProduct?: boolean }) {
  const { t } = useTranslation();
  const lines = useLines();
  const products = useProducts();
  return (
    <div className="filter-bar" role="group" aria-label={t("filter.range")}>
      <div className="segmented" role="radiogroup" aria-label={t("filter.range")}>
        {DAY_PRESETS.map((d) => (
          <button
            key={d}
            type="button"
            role="radio"
            aria-checked={state.days === d}
            className={state.days === d ? "is-on" : undefined}
            onClick={() => state.update({ days: d })}
          >
            {t("filter.days", { count: d })}
          </button>
        ))}
      </div>
      <label className="select">
        <span>{t("filter.line")}</span>
        <select
          value={state.lineId ?? ""}
          onChange={(e) => state.update({ lineId: e.target.value ? Number(e.target.value) : null })}
        >
          <option value="">{t("filter.allLines")}</option>
          {lines.data?.map((l) => (
            <option key={l.id} value={l.id}>
              {l.code}
            </option>
          ))}
        </select>
      </label>
      {showProduct && (
        <label className="select">
          <span>{t("filter.product")}</span>
          <select
            value={state.productId ?? ""}
            onChange={(e) => state.update({ productId: e.target.value ? Number(e.target.value) : null })}
          >
            <option value="">{t("filter.allProducts")}</option>
            {products.data?.map((p) => (
              <option key={p.id} value={p.id}>
                {p.partNumber} {p.name}
              </option>
            ))}
          </select>
        </label>
      )}
    </div>
  );
}
