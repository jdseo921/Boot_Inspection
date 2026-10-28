import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import * as f from "./fixtures";

export const pending = [f.view(1), f.view(2, { verdict: "NG" }), f.view(3)];

export const handlers = [
  http.get("*/api/v1/meta", () => HttpResponse.json(f.meta)),
  http.get("*/api/v1/lines", () => HttpResponse.json(f.lines)),
  http.get("*/api/v1/products", () => HttpResponse.json(f.products)),
  http.get("*/api/v1/analytics/summary", () => HttpResponse.json(f.summary)),
  http.get("*/api/v1/analytics/yield-trend", () => HttpResponse.json(f.trend)),
  http.get("*/api/v1/analytics/defect-pareto", () => HttpResponse.json(f.pareto)),
  http.get("*/api/v1/analytics/defect-heatmap", () => HttpResponse.json(f.heatmap)),
  http.get("*/api/v1/inspections", ({ request }) => {
    const q = new URL(request.url).searchParams;
    if (q.get("serial")) {
      const hit = pending.filter((p) => p.serialNumber === q.get("serial"));
      return HttpResponse.json({ items: hit, nextCursor: null });
    }
    return HttpResponse.json({ items: pending, nextCursor: null });
  }),
  http.get("*/api/v1/inspections/:id", ({ params }) => {
    const v = pending.find((p) => p.id === Number(params.id));
    return v
      ? HttpResponse.json(f.detail(v))
      : HttpResponse.json({ title: "Not Found", status: 404, detail: "no inspection" }, { status: 404 });
  }),
];

export const server = setupServer(...handlers);
