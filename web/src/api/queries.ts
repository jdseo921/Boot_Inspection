import { keepPreviousData, useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiPost } from "./client";
import type {
  DefectClass,
  Heatmap,
  InspectionDetail,
  InspectionView,
  Line,
  Meta,
  Page,
  ParetoBar,
  Product,
  ReviewOutcome,
  Summary,
  TrendPoint,
  Verdict,
} from "./types";

/** The slice every dashboard query is scoped to. */
export interface Scope {
  from: string;
  to: string;
  lineId?: number;
  productId?: number;
}

const scopeParams = (s: Scope) => ({ from: s.from, to: s.to, lineId: s.lineId, productId: s.productId });
const STATIC = { staleTime: 5 * 60_000 };

export const useMeta = () =>
  useQuery({ queryKey: ["meta"], queryFn: ({ signal }) => apiGet<Meta>("/api/v1/meta", {}, signal), ...STATIC });

export const useLines = () =>
  useQuery({ queryKey: ["lines"], queryFn: ({ signal }) => apiGet<Line[]>("/api/v1/lines", {}, signal), ...STATIC });

export const useProducts = () =>
  useQuery({
    queryKey: ["products"],
    queryFn: ({ signal }) => apiGet<Product[]>("/api/v1/products", {}, signal),
    ...STATIC,
  });

// Dashboards keep showing the previous slice while a new one loads, so the
// layout never jumps (see the charts' "refetching" state).
export const useSummary = (scope: Scope | null) =>
  useQuery({
    queryKey: ["summary", scope],
    queryFn: ({ signal }) => apiGet<Summary>("/api/v1/analytics/summary", scopeParams(scope!), signal),
    enabled: scope !== null,
    placeholderData: keepPreviousData,
  });

export const useTrend = (scope: Scope | null) =>
  useQuery({
    queryKey: ["trend", scope],
    queryFn: ({ signal }) => apiGet<TrendPoint[]>("/api/v1/analytics/yield-trend", scopeParams(scope!), signal),
    enabled: scope !== null,
    placeholderData: keepPreviousData,
  });

export const usePareto = (scope: Scope | null) =>
  useQuery({
    queryKey: ["pareto", scope],
    queryFn: ({ signal }) => apiGet<ParetoBar[]>("/api/v1/analytics/defect-pareto", scopeParams(scope!), signal),
    enabled: scope !== null,
    placeholderData: keepPreviousData,
  });

export const useHeatmap = (scope: Scope | null, productId: number | undefined, defectClass?: DefectClass) =>
  useQuery({
    queryKey: ["heatmap", scope, productId, defectClass],
    queryFn: ({ signal }) =>
      apiGet<Heatmap>(
        "/api/v1/analytics/defect-heatmap",
        { from: scope!.from, to: scope!.to, lineId: scope!.lineId, productId, defectClass },
        signal,
      ),
    enabled: scope !== null && productId !== undefined,
    placeholderData: keepPreviousData,
  });

export interface ListFilter {
  from?: string;
  to?: string;
  lineId?: number;
  productId?: number;
  verdict?: Verdict;
  status?: "pending" | "reviewed";
  serial?: string;
  sort?: "newest" | "oldest";
  limit?: number;
}

export const useInspectionPages = (filter: ListFilter, enabled = true) =>
  useInfiniteQuery({
    queryKey: ["inspections", filter],
    queryFn: ({ pageParam, signal }) =>
      apiGet<Page<InspectionView>>("/api/v1/inspections", { ...filter, cursor: pageParam }, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled,
  });

export const useInspection = (id: number | undefined) =>
  useQuery({
    queryKey: ["inspection", id],
    queryFn: ({ signal }) => apiGet<InspectionDetail>(`/api/v1/inspections/${id}`, {}, signal),
    enabled: id !== undefined,
  });

export function useReview() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, outcome, reviewer }: { id: number; outcome: ReviewOutcome; reviewer: string }) =>
      apiPost<InspectionView>(`/api/v1/inspections/${id}/review`, { outcome, reviewer }),
    onSuccess: (view) => {
      qc.setQueryData<InspectionDetail>(["inspection", view.id], (old) => (old ? { ...old, inspection: view } : old));
      // Totals and lists change after a decision.
      for (const key of ["summary", "trend", "inspections"]) {
        void qc.invalidateQueries({ queryKey: [key] });
      }
    },
  });
}
