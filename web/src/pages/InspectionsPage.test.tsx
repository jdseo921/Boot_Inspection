import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { renderAt } from "../test/render";

describe("Boards", () => {
  it("lists boards with their verdict and review state", async () => {
    renderAt("/inspections");
    expect(await screen.findByRole("link", { name: "PCB-1001-261027-L1-00001" })).toHaveAttribute(
      "href",
      "/inspections/1",
    );
    expect(screen.getAllByText("Waiting")).toHaveLength(3);
    expect(screen.getByText("3 shown")).toBeInTheDocument();
  });

  it("finds a board by serial number", async () => {
    const { router } = renderAt("/inspections");
    await screen.findByText("3 shown");
    await userEvent.type(screen.getByRole("searchbox"), "PCB-1001-261027-L1-00002");
    await userEvent.click(screen.getByRole("button", { name: "Find" }));
    expect(await screen.findByText("1 shown")).toBeInTheDocument();
    expect(router.state.location.search).toContain("serial=PCB-1001-261027-L1-00002");
  });

  it("shows a board's regions on the detail page", async () => {
    renderAt("/inspections/2");
    expect(await screen.findByRole("heading", { name: "PCB-1001-261027-L1-00002" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /PCB-1001-261027-L1-00002/ })).toBeInTheDocument();
    expect(screen.getByText("Short")).toBeInTheDocument();
    expect(screen.getByText("64.2, 37.5")).toBeInTheDocument();
    expect(screen.getByText("v2: model threshold 0.68, pixel diff 32, min area 16 px")).toBeInTheDocument();
  });

  it("says when a board does not exist", async () => {
    renderAt("/inspections/999");
    expect(await screen.findByText("There is no board with that id.")).toBeInTheDocument();
  });

  it("has a not-found page for unknown addresses", async () => {
    renderAt("/nowhere");
    expect(await screen.findByText("Page not found")).toBeInTheDocument();
  });
});
