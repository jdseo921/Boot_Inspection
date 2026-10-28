import { QueryClient } from "@tanstack/react-query";
import type { RouteObject } from "react-router";
import { Layout, NotFound } from "./Layout";
import { DefectsPage } from "./pages/DefectsPage";
import { InspectionDetailPage } from "./pages/InspectionDetailPage";
import { InspectionsPage } from "./pages/InspectionsPage";
import { OverviewPage } from "./pages/OverviewPage";
import { ReviewPage } from "./pages/ReviewPage";

/** Keep in step with SpaController.java, which serves index.html for these paths. */
export const routes: RouteObject[] = [
  {
    path: "/",
    element: <Layout />,
    children: [
      { index: true, element: <OverviewPage /> },
      { path: "review", element: <ReviewPage /> },
      { path: "inspections", element: <InspectionsPage /> },
      { path: "inspections/:id", element: <InspectionDetailPage /> },
      { path: "defects", element: <DefectsPage /> },
      { path: "*", element: <NotFound /> },
    ],
  },
];

export function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: 1, refetchOnWindowFocus: false, staleTime: 30_000 },
    },
  });
}
