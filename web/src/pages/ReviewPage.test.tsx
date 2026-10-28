import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { pending, server } from "../test/server";
import { renderAt } from "../test/render";

function recordReviews() {
  const calls: { id: string; body: unknown }[] = [];
  server.use(
    http.post("*/api/v1/inspections/:id/review", async ({ params, request }) => {
      const body = (await request.json()) as { outcome: string; reviewer: string };
      calls.push({ id: String(params.id), body });
      const v = pending.find((p) => p.id === Number(params.id))!;
      return HttpResponse.json({
        ...v,
        reviewOutcome: body.outcome,
        reviewedBy: body.reviewer,
        reviewedAt: "2026-10-27T20:00:00Z",
      });
    }),
  );
  return calls;
}

describe("Review queue", () => {
  it("asks for the oldest flagged boards first", async () => {
    let query = "";
    server.events.on("request:start", ({ request }) => {
      const url = new URL(request.url);
      if (url.pathname === "/api/v1/inspections") query = url.search;
    });
    renderAt("/review");
    await screen.findByRole("button", { name: /PCB-1001-261027-L1-00001/ });
    expect(query).toContain("status=pending");
    expect(query).toContain("sort=oldest");
    server.events.removeAllListeners();
  });

  it("needs a reviewer name before recording a decision", async () => {
    const calls = recordReviews();
    renderAt("/review");
    await screen.findByText("Flagged regions");
    await userEvent.keyboard("d");
    expect(await screen.findByText("Enter your name before recording a decision.")).toBeInTheDocument();
    expect(calls).toHaveLength(0);
  });

  it("records a decision from the keyboard and moves to the next board", async () => {
    const calls = recordReviews();
    renderAt("/review");
    await screen.findByText("Flagged regions");
    await userEvent.type(screen.getByLabelText("Your name"), "op.kim");
    (document.activeElement as HTMLElement).blur();

    await userEvent.keyboard("f");

    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]).toEqual({ id: "1", body: { outcome: "FALSE_CALL", reviewer: "op.kim" } });
    expect(await screen.findByText("PCB-1001-261027-L1-00001: False call")).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /PCB-1001-261027-L1-00002/ })).toHaveAttribute("aria-current", "true"),
    );
    expect(localStorage.getItem("boot-inspection.reviewer")).toBe("op.kim");
  });

  it("moves through the queue with J and K", async () => {
    renderAt("/review");
    const first = await screen.findByRole("button", { name: /PCB-1001-261027-L1-00001/ });
    await waitFor(() => expect(first).toHaveAttribute("aria-current", "true"));
    await userEvent.keyboard("j");
    expect(screen.getByRole("button", { name: /PCB-1001-261027-L1-00002/ })).toHaveAttribute("aria-current", "true");
    await userEvent.keyboard("k");
    expect(first).toHaveAttribute("aria-current", "true");
  });

  it("tells the operator when someone else got there first", async () => {
    server.use(
      http.post("*/api/v1/inspections/:id/review", () =>
        HttpResponse.json({ title: "Conflict", status: 409, detail: "already reviewed" }, { status: 409 }),
      ),
    );
    localStorage.setItem("boot-inspection.reviewer", "op.lee");
    renderAt("/review");
    await screen.findByText("Flagged regions");
    await userEvent.click(screen.getByRole("button", { name: /Confirm defect/ }));
    expect(await screen.findByText("Someone else already decided this board.")).toBeInTheDocument();
  });

  it("shows an empty queue as done, not as an error", async () => {
    server.use(http.get("*/api/v1/inspections", () => HttpResponse.json({ items: [], nextCursor: null })));
    renderAt("/review");
    expect(await screen.findByText(/The queue is empty/)).toBeInTheDocument();
  });
});
