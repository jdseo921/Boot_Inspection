import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { InspectionDetail } from "../api/types";
import { useLocale } from "../i18n";
import { dateTime, decimal, percent, seconds } from "../lib/format";
import { OutcomeBadge, VerdictBadge } from "./Badges";
import { Board } from "./Board";
import { DefectOverlay } from "./DefectOverlay";

/** One board as the AOI machine saw it: outline, flagged regions, settings. */
export function BoardInspection({ detail, timezone }: { detail: InspectionDetail; timezone?: string }) {
  const { t } = useTranslation();
  const locale = useLocale();
  const [selected, setSelected] = useState<number | null>(null);
  const { inspection: i, product, line, profile, defects } = detail;

  return (
    <div className="inspection">
      <div className="inspection-board">
        <Board
          widthMm={product.boardWidthMm}
          heightMm={product.boardHeightMm}
          partNumber={product.partNumber}
          label={`${i.serialNumber}: ${t("detail.regions")} ${defects.length}`}
        >
          <DefectOverlay defects={defects} selected={selected} onSelect={setSelected} />
        </Board>
      </div>

      <dl className="facts">
        <div>
          <dt>{t("detail.serial")}</dt>
          <dd className="mono-ish">{i.serialNumber}</dd>
        </div>
        <div>
          <dt>{t("detail.part")}</dt>
          <dd>
            {product.partNumber} {product.name}
          </dd>
        </div>
        <div>
          <dt>{t("detail.line")}</dt>
          <dd>{line.code}</dd>
        </div>
        <div>
          <dt>{t("detail.inspected")}</dt>
          <dd>{dateTime(i.inspectedAt, locale, timezone)}</dd>
        </div>
        <div>
          <dt>{t("detail.verdict")}</dt>
          <dd>
            <VerdictBadge verdict={i.verdict} />
          </dd>
        </div>
        <div>
          <dt>{t("detail.score")}</dt>
          <dd>{decimal(i.anomalyScore, locale, 3)}</dd>
        </div>
        <div>
          <dt>{t("detail.cycle")}</dt>
          <dd>{seconds(i.cycleMs, locale, 2)}</dd>
        </div>
        {i.verdict !== "OK" && (
          <div>
            <dt>{t("detail.review")}</dt>
            <dd>
              <OutcomeBadge outcome={i.reviewOutcome} />
              {i.reviewOutcome && i.reviewedBy && i.reviewedAt && (
                <span className="muted">
                  {" "}
                  {i.reviewedBy}, {dateTime(i.reviewedAt, locale, timezone)}
                </span>
              )}
            </dd>
          </div>
        )}
        <div className="facts-wide">
          <dt>{t("detail.profile")}</dt>
          <dd>
            {t("detail.profileValue", {
              version: profile.version,
              threshold: decimal(profile.modelThreshold, locale, 2),
              pixelDiff: profile.pixelDiff,
              minArea: profile.minDefectAreaPx,
            })}
          </dd>
        </div>
      </dl>

      {defects.length === 0 ? (
        <p className="muted">{t("detail.noRegions")}</p>
      ) : (
        <table className="data-table regions">
          <caption>{t("detail.regions")}</caption>
          <thead>
            <tr>
              <th scope="col">{t("detail.region")}</th>
              <th scope="col">{t("detail.cls")}</th>
              <th scope="col" className="num">
                {t("detail.position")}
              </th>
              <th scope="col" className="num">
                {t("detail.size")}
              </th>
              <th scope="col" className="num">
                {t("detail.confidence")}
              </th>
            </tr>
          </thead>
          <tbody>
            {defects.map((d, k) => (
              <tr
                key={d.id}
                className={selected === k ? "is-selected" : undefined}
                onPointerEnter={() => setSelected(k)}
                onPointerLeave={() => setSelected(null)}
              >
                <td>{k + 1}</td>
                <td>{t(`defectClass.${d.defectClass}`)}</td>
                <td className="num">
                  {decimal(d.xMm, locale, 1)}, {decimal(d.yMm, locale, 1)}
                </td>
                <td className="num">
                  {decimal(d.wMm, locale, 1)} × {decimal(d.hMm, locale, 1)}
                </td>
                <td className="num">{percent(d.confidence, locale, 0)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
