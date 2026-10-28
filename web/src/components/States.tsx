import { useTranslation } from "react-i18next";
import { ApiError } from "../api/client";

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const { t } = useTranslation();
  const detail =
    error instanceof ApiError && error.detail ? error.detail : error instanceof TypeError ? t("error.offline") : null;
  return (
    <div className="state state-error" role="alert">
      <p className="state-title">{t("error.title")}</p>
      {detail && <p>{detail}</p>}
      {onRetry && (
        <button type="button" className="button" onClick={onRetry}>
          {t("error.retry")}
        </button>
      )}
    </div>
  );
}

export function Empty({ children }: { children: string }) {
  return <p className="state">{children}</p>;
}

export function Loading() {
  return <div className="state state-loading" aria-busy="true" />;
}
