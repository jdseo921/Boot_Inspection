import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

interface Props {
  title: string;
  /** Rendered instead of the chart when the reader asks for the table. */
  table?: ReactNode;
  /** True while a new slice loads; the previous chart stays, dimmed. */
  refetching?: boolean;
  actions?: ReactNode;
  className?: string;
  children: ReactNode;
}

/** A chart with its title and a table-view twin, so no value is hover-only. */
export function Panel({ title, table, refetching, actions, className, children }: Props) {
  const { t } = useTranslation();
  const [asTable, setAsTable] = useState(false);
  return (
    <section className={`panel ${className ?? ""}`} aria-busy={refetching || undefined}>
      <header className="panel-head">
        <h2>{title}</h2>
        <div className="panel-actions">
          {actions}
          {table && (
            <button type="button" className="link-button" onClick={() => setAsTable((v) => !v)}>
              {asTable ? t("chart.showChart") : t("chart.showTable")}
            </button>
          )}
        </div>
      </header>
      <div className={refetching ? "panel-body is-refetching" : "panel-body"}>
        {asTable && table ? table : children}
      </div>
    </section>
  );
}
