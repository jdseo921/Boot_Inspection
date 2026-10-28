import { useCallback, useMemo } from "react";
import { useSearchParams } from "react-router";
import { useMeta, type Scope } from "../api/queries";
import { addDays } from "./format";

export const DAY_PRESETS = [7, 30, 90] as const;
export type DayPreset = (typeof DAY_PRESETS)[number];

export interface ScopeState {
  /** Null until the plant's date is known. */
  scope: Scope | null;
  days: DayPreset;
  lineId?: number;
  productId?: number;
  timezone?: string;
  update: (patch: { days?: DayPreset; lineId?: number | null; productId?: number | null }) => void;
}

const toId = (v: string | null): number | undefined => {
  const n = v === null ? NaN : Number(v);
  return Number.isInteger(n) && n > 0 ? n : undefined;
};

/**
 * The dashboard slice lives in the URL (?days=30&line=2&product=1) so a view
 * can be bookmarked or sent to a colleague. Date presets count back from the
 * plant's today, which the server provides.
 */
export function useScope(): ScopeState {
  const [params, setParams] = useSearchParams();
  const meta = useMeta();

  const rawDays = Number(params.get("days"));
  const days: DayPreset = (DAY_PRESETS as readonly number[]).includes(rawDays) ? (rawDays as DayPreset) : 30;
  const lineId = toId(params.get("line"));
  const productId = toId(params.get("product"));
  const today = meta.data?.today;

  const scope = useMemo<Scope | null>(
    () => (today ? { from: addDays(today, -(days - 1)), to: today, lineId, productId } : null),
    [today, days, lineId, productId],
  );

  const update = useCallback<ScopeState["update"]>(
    (patch) => {
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (patch.days !== undefined) next.set("days", String(patch.days));
          if (patch.lineId !== undefined) {
            if (patch.lineId === null) next.delete("line");
            else next.set("line", String(patch.lineId));
          }
          if (patch.productId !== undefined) {
            if (patch.productId === null) next.delete("product");
            else next.set("product", String(patch.productId));
          }
          return next;
        },
        { replace: true },
      );
    },
    [setParams],
  );

  return { scope, days, lineId, productId, timezone: meta.data?.timezone, update };
}
