import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, NavLink, Outlet, createBrowserRouter, useLocation, type RouteObject } from "react-router";
import { RouterProvider } from "react-router/dom";
import { useMeta, useSummary } from "./api/queries";
import { LANGUAGES, setLanguage } from "./i18n";
import { useScope } from "./lib/scope";
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

export function App({ queryClient }: { queryClient?: QueryClient }) {
  const [client] = useState(() => queryClient ?? makeQueryClient());
  const [router] = useState(() => createBrowserRouter(routes));
  return (
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
}

export function Layout() {
  const { t, i18n } = useTranslation();
  const { search } = useLocation();
  const meta = useMeta();
  // Keep the period and line when moving between screens.
  const keep = new URLSearchParams(search);
  const carry = new URLSearchParams();
  for (const k of ["days", "line", "product"]) {
    const v = keep.get(k);
    if (v) carry.set(k, v);
  }
  const q = carry.toString() ? `?${carry.toString()}` : "";

  return (
    <div className="shell">
      <a className="skip" href="#main">
        {t("app.skip")}
      </a>
      <header className="topbar">
        <Link to={`/${q}`} className="wordmark" aria-label={t("app.name")}>
          <svg viewBox="0 0 32 32" width="26" height="26" aria-hidden="true">
            <rect x="2" y="5" width="28" height="22" rx="3" className="wordmark-board" />
            <rect x="5" y="8" width="22" height="16" rx="1.5" className="wordmark-silk" />
            <path d="M15 13h-3v3M20 19h3v-3" className="wordmark-bracket" />
          </svg>
          <span>{t("app.name")}</span>
        </Link>
        <nav className="nav" aria-label="Main">
          <NavLink to={`/${q}`} end>
            {t("app.nav.overview")}
          </NavLink>
          <NavLink to={`/review${q}`}>
            {t("app.nav.review")}
            <PendingCount />
          </NavLink>
          <NavLink to={`/inspections${q}`}>{t("app.nav.inspections")}</NavLink>
          <NavLink to={`/defects${q}`}>{t("app.nav.defects")}</NavLink>
        </nav>
        <div className="lang" role="group" aria-label={t("app.language")}>
          {LANGUAGES.map((l) => (
            <button
              key={l.code}
              type="button"
              lang={l.code}
              aria-pressed={i18n.language === l.code}
              className={i18n.language === l.code ? "is-on" : undefined}
              onClick={() => setLanguage(l.code)}
            >
              {l.label}
            </button>
          ))}
        </div>
      </header>
      <main id="main" className="main">
        <Outlet />
      </main>
      <footer className="footer">{meta.data && <span>{t("app.plantTime", { zone: meta.data.timezone })}</span>}</footer>
    </div>
  );
}

function PendingCount() {
  const { scope } = useScope();
  const summary = useSummary(scope);
  const n = summary.data?.pendingReview;
  return n ? <span className="nav-count">{n > 999 ? "999+" : n}</span> : null;
}

function NotFound() {
  const { t } = useTranslation();
  return (
    <div className="state">
      <p className="state-title">{t("error.notFound")}</p>
      <Link to="/">{t("error.home")}</Link>
    </div>
  );
}
