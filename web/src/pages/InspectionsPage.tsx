import { useMemo, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { Link, useSearchParams } from "react-router";
import { useInspectionPages, type ListFilter } from "../api/queries";
import type { Verdict } from "../api/types";
import { OutcomeBadge, VerdictBadge } from "../components/Badges";
import { FilterBar } from "../components/FilterBar";
import { Empty, ErrorState, Loading } from "../components/States";
import { useLocale } from "../i18n";
import { count, dateTime, decimal, seconds } from "../lib/format";
import { useScope } from "../lib/scope";

const VERDICTS: Verdict[] = ["OK", "REVIEW", "NG"];

export function InspectionsPage() {
  const { t } = useTranslation();
  const locale = useLocale();
  const state = useScope();
  const [params, setParams] = useSearchParams();
  const verdict = VERDICTS.find((v) => v === params.get("verdict"));
  const status = ((s) => (s === "pending" || s === "reviewed" ? s : undefined))(params.get("status"));
  const serial = params.get("serial") ?? "";
  const [serialDraft, setSerialDraft] = useState(serial);

  const filter = useMemo<ListFilter>(() => {
    if (serial) return { serial, limit: 50 };
    const s = state.scope;
    return {
      from: s?.from,
      to: s?.to,
      lineId: s?.lineId,
      productId: s?.productId,
      verdict,
      status,
      limit: 50,
    };
  }, [serial, state.scope, verdict, status]);
  const pages = useInspectionPages(filter, serial !== "" || state.scope !== null);
  const items = pages.data?.pages.flatMap((p) => p.items) ?? [];

  const setParam = (key: string, value: string | undefined) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (value) next.set(key, value);
        else next.delete(key);
        return next;
      },
      { replace: true },
    );

  const onSearch = (e: FormEvent) => {
    e.preventDefault();
    setParam("serial", serialDraft.trim() || undefined);
  };

  return (
    <>
      <FilterBar state={state} />
      <div className="page-head">
        <h1>{t("boards.title")}</h1>
        <p className="page-intro">{t("boards.intro")}</p>
      </div>

      <div className="filter-bar filter-bar-secondary">
        <label className="select">
          <span>{t("filter.verdict")}</span>
          <select value={verdict ?? ""} onChange={(e) => setParam("verdict", e.target.value || undefined)}>
            <option value="">{t("filter.allVerdicts")}</option>
            {VERDICTS.map((v) => (
              <option key={v} value={v}>
                {t(`verdict.${v}`)}
              </option>
            ))}
          </select>
        </label>
        <label className="select">
          <span>{t("filter.status")}</span>
          <select value={status ?? ""} onChange={(e) => setParam("status", e.target.value || undefined)}>
            <option value="">{t("filter.anyStatus")}</option>
            <option value="pending">{t("filter.pending")}</option>
            <option value="reviewed">{t("filter.reviewed")}</option>
          </select>
        </label>
        <form className="search" role="search" onSubmit={onSearch}>
          <label className="sr-only" htmlFor="serial">
            {t("filter.serial")}
          </label>
          <input
            id="serial"
            type="search"
            value={serialDraft}
            placeholder={t("filter.serialPlaceholder")}
            onChange={(e) => setSerialDraft(e.target.value)}
          />
          <button type="submit" className="button button-quiet">
            {t("filter.search")}
          </button>
          {serial && (
            <button
              type="button"
              className="link-button"
              onClick={() => {
                setSerialDraft("");
                setParam("serial", undefined);
              }}
            >
              {t("filter.clear")}
            </button>
          )}
        </form>
      </div>

      {pages.isError && <ErrorState error={pages.error} onRetry={() => void pages.refetch()} />}
      {pages.isPending && !pages.isError && <Loading />}
      {pages.isSuccess && items.length === 0 && <Empty>{t("boards.none")}</Empty>}

      {items.length > 0 && (
        <>
          <div className="table-wrap">
            <table className="data-table boards">
              <thead>
                <tr>
                  <th scope="col">{t("boards.serial")}</th>
                  <th scope="col">{t("boards.time")}</th>
                  <th scope="col">{t("boards.line")}</th>
                  <th scope="col">{t("boards.part")}</th>
                  <th scope="col">{t("boards.verdict")}</th>
                  <th scope="col" className="num">
                    {t("boards.score")}
                  </th>
                  <th scope="col" className="num">
                    {t("boards.cycle")}
                  </th>
                  <th scope="col" className="num">
                    {t("boards.regions")}
                  </th>
                  <th scope="col">{t("boards.review")}</th>
                </tr>
              </thead>
              <tbody>
                {items.map((it) => (
                  <tr key={it.id}>
                    <td>
                      <Link to={`/inspections/${it.id}`}>{it.serialNumber}</Link>
                    </td>
                    <td>{dateTime(it.inspectedAt, locale, state.timezone)}</td>
                    <td>{it.lineCode}</td>
                    <td>{it.partNumber}</td>
                    <td>
                      <VerdictBadge verdict={it.verdict} />
                    </td>
                    <td className="num">{decimal(it.anomalyScore, locale, 3)}</td>
                    <td className="num">{seconds(it.cycleMs, locale)}</td>
                    <td className="num">{it.defectCount}</td>
                    <td>{it.verdict !== "OK" && <OutcomeBadge outcome={it.reviewOutcome} />}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="list-foot">
            <span className="muted">{t("boards.shown", { n: count(items.length, locale) })}</span>
            {pages.hasNextPage && (
              <button
                type="button"
                className="button button-quiet"
                disabled={pages.isFetchingNextPage}
                onClick={() => void pages.fetchNextPage()}
              >
                {t("boards.loadMore")}
              </button>
            )}
          </div>
        </>
      )}
    </>
  );
}
