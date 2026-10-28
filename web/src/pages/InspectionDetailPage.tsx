import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams } from "react-router";
import { ApiError } from "../api/client";
import { useInspection, useMeta, useReview } from "../api/queries";
import type { ReviewOutcome } from "../api/types";
import { BoardInspection } from "../components/BoardInspection";
import { Empty, ErrorState, Loading } from "../components/States";

export function InspectionDetailPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { id } = useParams();
  const numericId = id && /^\d+$/.test(id) ? Number(id) : undefined;
  const detail = useInspection(numericId);
  const meta = useMeta();
  const review = useReview();
  const [reviewer, setReviewer] = useState(() => {
    try {
      return localStorage.getItem("boot-inspection.reviewer") ?? "";
    } catch {
      return "";
    }
  });
  const [message, setMessage] = useState<string | null>(null);

  const decide = (outcome: ReviewOutcome) => {
    if (numericId === undefined) return;
    if (!reviewer.trim()) {
      setMessage(t("review.needName"));
      return;
    }
    review.mutate(
      { id: numericId, outcome, reviewer: reviewer.trim() },
      {
        onSuccess: () => setMessage(null),
        onError: (err) =>
          setMessage(err instanceof ApiError && err.status === 409 ? t("review.conflict") : err.message),
      },
    );
  };

  const notFound = numericId === undefined || (detail.error instanceof ApiError && detail.error.status === 404);

  return (
    <>
      <div className="page-head">
        <button type="button" className="link-button" onClick={() => navigate(-1)}>
          {t("detail.back")}
        </button>
        <h1>{detail.data?.inspection.serialNumber ?? t("boards.title")}</h1>
      </div>
      {notFound && <Empty>{t("detail.notFound")}</Empty>}
      {!notFound && detail.isError && <ErrorState error={detail.error} onRetry={() => void detail.refetch()} />}
      {!notFound && detail.isPending && <Loading />}
      {detail.data && (
        <section className="panel">
          <BoardInspection detail={detail.data} timezone={meta.data?.timezone} />
          {detail.data.inspection.verdict !== "OK" && detail.data.inspection.reviewOutcome === null && (
            <div className="decision">
              <label className="field">
                <span>{t("review.reviewer")}</span>
                <input value={reviewer} maxLength={64} onChange={(e) => setReviewer(e.target.value)} />
              </label>
              <div className="decision-buttons">
                <button
                  type="button"
                  className="button button-defect"
                  disabled={review.isPending}
                  onClick={() => decide("CONFIRMED_DEFECT")}
                >
                  {t("review.confirm")}
                </button>
                <button
                  type="button"
                  className="button button-pass"
                  disabled={review.isPending}
                  onClick={() => decide("FALSE_CALL")}
                >
                  {t("review.falseCall")}
                </button>
              </div>
              <p className="toast" role="status">
                {message}
              </p>
            </div>
          )}
        </section>
      )}
    </>
  );
}
