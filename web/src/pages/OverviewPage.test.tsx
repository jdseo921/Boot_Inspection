import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { server } from "../test/server";
import { renderAt } from "../test/render";

describe("Overview", () => {
  it("leads with first-pass yield and the supporting numbers", async () => {
    renderAt("/");
    expect(await screen.findByText("94.5%")).toBeInTheDocument();
    expect(screen.getByText("396,113 boards inspected")).toBeInTheDocument();
    expect(screen.getByText("57.1%")).toBeInTheDocument(); // false-call rate
    expect(screen.getByText("12,000 of 21,000 reviewed flags were good boards")).toBeInTheDocument();
    expect(screen.getAllByText("982")).toHaveLength(2); // the KPI and the queue badge in the nav
    expect(screen.getByRole("link", { name: "Open the queue" })).toHaveAttribute("href", "/review?days=30&product=1");
    expect(screen.getByText("10.6 s median, 14.5 s 95th pct.")).toBeInTheDocument();
  });

  it("asks the API for the last 30 plant days by default and follows the period buttons", async () => {
    const seen: string[] = [];
    server.events.on("request:start", ({ request }) => {
      const url = new URL(request.url);
      if (url.pathname.endsWith("/analytics/summary")) seen.push(url.search);
    });
    renderAt("/");
    await screen.findByText("94.5%");
    expect(seen[0]).toContain("from=2026-09-28");
    expect(seen[0]).toContain("to=2026-10-27");

    await userEvent.click(screen.getByRole("radio", { name: "Last 7 days" }));
    await screen.findByRole("radio", { name: "Last 7 days", checked: true });
    expect(seen.some((s) => s.includes("from=2026-10-21"))).toBe(true);
    server.events.removeAllListeners();
  });

  it("offers a table instead of the chart", async () => {
    renderAt("/");
    const panel = (await screen.findByRole("heading", { name: "Flagged regions by defect class" })).closest("section")!;
    await userEvent.click(within(panel).getByRole("button", { name: "Show table" }));
    const table = within(panel).getByRole("table");
    expect(within(table).getByText("Spur")).toBeInTheDocument();
    expect(within(table).getByText("80.0%")).toBeInTheDocument(); // running share after short
  });

  it("switches the whole screen to Korean", async () => {
    renderAt("/");
    await screen.findByText("94.5%");
    await userEvent.click(screen.getByRole("button", { name: "한국어" }));
    expect(await screen.findByText("직행률")).toBeInTheDocument();
    expect(screen.getByText("과검률")).toBeInTheDocument();
    expect(document.documentElement.lang).toBe("ko");
  });

  it("says so when the period has no boards", async () => {
    server.use(
      http.get("*/api/v1/analytics/summary", () =>
        HttpResponse.json({ inspected: 0, firstPassYield: null, pendingReview: 0 }),
      ),
    );
    renderAt("/");
    expect(await screen.findByText("No boards were inspected in this period.")).toBeInTheDocument();
  });

  it("explains an unreachable API and lets the reader retry", async () => {
    server.use(http.get("*/api/v1/analytics/summary", () => HttpResponse.error()));
    renderAt("/");
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't load this");
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });
});
