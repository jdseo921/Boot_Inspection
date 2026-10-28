import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ApiError } from "../api/client";
import { useInspection, useInspectionPages, useReview, useSummary } from "../api/queries";
import type { InspectionView, ReviewOutcome } from "../api/types";
import { VerdictBadge } from "../components/Badges";
import { FilterBar } from "../components/FilterBar";
import { BoardInspection } from "../components/BoardInspection";
import { Empty, ErrorState, Loading } from "../components/States";
import { useLocale } from "../i18n";
import { count, dateTime } from "../lib/format";
import { useScope } from "../lib/scope";

const REVIEWER_KEY = "boot-inspection.reviewer";

function savedReviewer(): string {
  try {
    return localStorage.getItem(REVIEWER_KEY) ?? "";
  } catch {
    return "";
  }
}

/**
 * The operator's screen: flagged boards oldest first on the left, the
 * selected board with its regions on the right, and a decision that moves
 * straight on to the next board. Works from the keyboard alone.
 */
export function ReviewPage() {
  const { t } = useTranslation();
  const locale = useLocale();
  const state = useScope();
  const scope = state.scope;
  const filter = useMemo(
    () =>
      scope
        ? {
            from: scope.from,
            to: scope.to,
            lineId: scope.lineId,
            productId: scope.productId,
            status: "pending" as const,
            sort: "oldest" as const,
            limit: 50,
          }
        : {},
    [scope],
  );
  const pages = useInspectionPages(filter, scope !== null);
  const summary = useSummary(scope);
  const items = useMemo(() => pages.data?.pages.flatMap((p) => p.items) ?? [], [pages.data]);

  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [reviewer, setReviewer] = useState(savedReviewer);
  const [message, setMessage] = useState<string | null>(null);
  const review = useReview();

  // With nothing picked, or the picked board gone after a refetch, the
  // first board in the queue is the current one.
  const index = items.findIndex((i) => i.id === selectedId);
  const current: InspectionView | undefined = index >= 0 ? items[index] : items[0];
  const detail = useInspection(current?.id);

  const move = useCallback(
    (step: number) => {
      if (items.length === 0) return;
      const i = Math.max(0, Math.min(items.length - 1, (index < 0 ? 0 : index) + step));
      setSelectedId(items[i].id);
      document.getElementById(`queue-${items[i].id}`)?.scrollIntoView?.({ block: "nearest" });
    },
    [items, index],
  );

  const decide = useCallback(
    (outcome: ReviewOutcome) => {
      if (!current || review.isPending) return;
      const name = reviewer.trim();
      if (!name) {
        setMessage(t("review.needName"));
        document.getElementById("reviewer")?.focus();
        return;
      }
      const at = index < 0 ? 0 : index;
      const next = items[at + 1] ?? items[at - 1];
      review.mutate(
        { id: current.id, outcome, reviewer: name },
        {
          onSuccess: (view) => {
            setMessage(t("review.decided", { serial: view.serialNumber, outcome: t(`outcome.${outcome}`) }));
            setSelectedId(next ? next.id : null);
          },
          onError: (err) => {
            setMessage(err instanceof ApiError && err.status === 409 ? t("review.conflict") : err.message);
            void pages.refetch();
          },
        },
      );
    },
    [current, review, reviewer, index, items, t, pages],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && ["INPUT", "SELECT", "TEXTAREA"].includes(target.tagName)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const key = e.key.toLowerCase();
      if (key === "j" || e.key === "ArrowDown") {
        e.preventDefault();
        move(1);
      } else if (key === "k" || e.key === "ArrowUp") {
        e.preventDefault();
        move(-1);
      } else if (key === "d") {
        decide("CONFIRMED_DEFECT");
      } else if (key === "f") {
        decide("FALSE_CALL");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [move, decide]);

  const saveReviewer = (v: string) => {
    setReviewer(v);
    try {
      localStorage.setItem(REVIEWER_KEY, v);
    } catch {
      // remembered for this visit only
    }
  };

  return (
    <>
      <FilterBar state={state} />
      <div className="page-head">
        <h1>{t("review.title")}</h1>
        {summary.data && (
          <p className="page-count">{t("review.count", { n: count(summary.data.pendingReview, locale) })}</p>
        )}
        <p className="page-intro">{t("review.intro")}</p>
      </div>

      {pages.isError && <ErrorState error={pages.error} onRetry={() => void pages.refetch()} />}
      {pages.isPending && !pages.isError && <Loading />}
      {pages.isSuccess && items.length === 0 && <Empty>{t("review.empty")}</Empty>}

      {items.length > 0 && (
        <div className="review-layout">
          <nav className="queue" aria-label={t("review.title")}>
            <ol>
              {items.map((it) => (
                <li key={it.id}>
                  <button
                    id={`queue-${it.id}`}
                    type="button"
                    className={it.id === current?.id ? "queue-item is-current" : "queue-item"}
                    aria-current={it.id === current?.id ? "true" : undefined}
                    onClick={() => setSelectedId(it.id)}
                  >
                    <span className="queue-serial">{it.serialNumber}</span>
                    <span className="queue-meta">
                      {it.lineCode} {dateTime(it.inspectedAt, locale, state.timezone)}
                    </span>
                    <VerdictBadge verdict={it.verdict} />
                  </button>
                </li>
              ))}
            </ol>
            {pages.hasNextPage && (
              <button
                type="button"
                className="button button-quiet"
                disabled={pages.isFetchingNextPage}
                onClick={() => void pages.fetchNextPage()}
              >
                {t("review.loadMore")}
              </button>
            )}
          </nav>

          <section className="review-main" aria-live="polite">
            {detail.data ? (
              <BoardInspection detail={detail.data} timezone={state.timezone} />
            ) : detail.isError ? (
              <ErrorState error={detail.error} onRetry={() => void detail.refetch()} />
            ) : (
              <Loading />
            )}

            <div className="decision">
              <div className="field">
                <label htmlFor="reviewer">{t("review.reviewer")}</label>
                <input
                  id="reviewer"
                  value={reviewer}
                  maxLength={64}
                  autoComplete="name"
                  onChange={(e) => saveReviewer(e.target.value)}
                  aria-describedby="reviewer-hint"
                />
                <small id="reviewer-hint">{t("review.reviewerHint")}</small>
              </div>
              <div className="decision-buttons">
                <button
                  type="button"
                  className="button button-defect"
                  disabled={!current || review.isPending}
                  onClick={() => decide("CONFIRMED_DEFECT")}
                >
                  {t("review.confirm")} <kbd>D</kbd>
                </button>
                <button
                  type="button"
                  className="button button-pass"
                  disabled={!current || review.isPending}
                  onClick={() => decide("FALSE_CALL")}
                >
                  {t("review.falseCall")} <kbd>F</kbd>
                </button>
              </div>
              <p className="hint">{t("review.keys")}</p>
              <p className="toast" role="status">
                {message}
              </p>
            </div>
          </section>
        </div>
      )}
    </>
  );
}
