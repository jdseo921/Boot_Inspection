import { useTranslation } from "react-i18next";
import type { ReviewOutcome, Verdict } from "../api/types";

// Status colour never carries meaning alone: every badge has an icon and a word.

const Icon = ({ kind }: { kind: "check" | "eye" | "cross" | "clock" }) => (
  <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" className="badge-icon">
    {kind === "check" && <path d="M3.5 8.5l3 3 6-7" />}
    {kind === "cross" && <path d="M4 4l8 8M12 4l-8 8" />}
    {kind === "eye" && (
      <>
        <path d="M1.5 8s2.5-4.5 6.5-4.5S14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8z" />
        <circle cx="8" cy="8" r="1.8" />
      </>
    )}
    {kind === "clock" && (
      <>
        <circle cx="8" cy="8" r="6" />
        <path d="M8 4.5V8l2.5 1.5" />
      </>
    )}
  </svg>
);

export function VerdictBadge({ verdict }: { verdict: Verdict }) {
  const { t } = useTranslation();
  const kind = verdict === "OK" ? "check" : verdict === "NG" ? "cross" : "eye";
  return (
    <span className={`badge badge-${verdict.toLowerCase()}`}>
      <Icon kind={kind} />
      {t(`verdict.${verdict}`)}
    </span>
  );
}

export function OutcomeBadge({ outcome }: { outcome: ReviewOutcome | null }) {
  const { t } = useTranslation();
  if (outcome === null) {
    return (
      <span className="badge badge-pending">
        <Icon kind="clock" />
        {t("outcome.pending")}
      </span>
    );
  }
  return (
    <span className={outcome === "CONFIRMED_DEFECT" ? "badge badge-ng" : "badge badge-ok"}>
      <Icon kind={outcome === "CONFIRMED_DEFECT" ? "cross" : "check"} />
      {t(`outcome.${outcome}`)}
    </span>
  );
}
