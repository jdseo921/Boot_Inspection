import { AxeBuilder } from "@axe-core/playwright";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

// These run against the real API and database (see playwright.config.ts).
// They only assume what the generator always produces: 30 days of boards
// ending now, with flagged boards still waiting for review.

interface Summary {
  inspected: number;
  pendingReview: number;
}
interface Board {
  id: number;
  serialNumber: string;
  verdict: "OK" | "REVIEW" | "NG";
  reviewOutcome: string | null;
  reviewedBy: string | null;
  defectCount: number;
}
interface Page_<T> {
  items: T[];
}

async function getJson<T>(request: APIRequestContext, path: string): Promise<T> {
  const r = await request.get(path);
  expect(r.status(), `GET ${path}`).toBe(200);
  return (await r.json()) as T;
}

/** True once any loaded stylesheet declares the Korean webfont. */
function koreanFontLoaded(page: Page): Promise<boolean> {
  return page.evaluate(() =>
    [...document.styleSheets].some((sheet) => {
      try {
        return [...sheet.cssRules].some(
          (r) => r instanceof CSSFontFaceRule && r.style.getPropertyValue("font-family").includes("IBM Plex Sans KR"),
        );
      } catch {
        return false;
      }
    }),
  );
}

test.describe("overview", () => {
  test("shows the KPIs and all four charts without sideways scrolling @phone", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator(".kpi-hero .kpi-value")).toHaveText(/\d+(\.\d+)?\s?%/);
    for (const name of [
      "First-pass yield by day",
      "False-call rate by day",
      "Flagged regions by defect class",
      /Flagged regions on PCB-\d+/,
    ]) {
      await expect(page.getByRole("heading", { level: 2, name })).toBeVisible();
    }
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test("a chart can be read as a table, one row per day", async ({ page }) => {
    await page.goto("/");
    const panel = page.locator("section.panel", {
      has: page.getByRole("heading", { name: "First-pass yield by day" }),
    });
    await panel.getByRole("button", { name: "Show table" }).click();
    await expect(panel.locator("tbody tr").first()).toBeVisible();
    expect(await panel.locator("tbody tr").count()).toBeGreaterThanOrEqual(25);
  });
});

test.describe("review queue", () => {
  test("J and K move through the queue", async ({ page }) => {
    await page.goto("/review");
    const items = page.locator(".queue-item");
    await expect(items.nth(1)).toBeVisible();
    await expect(items.nth(0)).toHaveAttribute("aria-current", "true");
    await page.keyboard.press("j");
    await expect(items.nth(1)).toHaveAttribute("aria-current", "true");
    await page.keyboard.press("k");
    await expect(items.nth(0)).toHaveAttribute("aria-current", "true");
  });

  test("a decision is stored with the reviewer's name and the board leaves the queue", async ({ page, request }) => {
    await page.goto("/review");
    const current = page.locator(".queue-item.is-current .queue-serial");
    await expect(current).toBeVisible();
    const serial = (await current.textContent())!.trim();

    await page.getByLabel("Your name").fill("e2e.reviewer");
    await page.getByLabel("Your name").blur();
    await page.keyboard.press("d");

    await expect(page.locator(".decision .toast")).toHaveText(`${serial}: Defect confirmed`);
    await expect(current).not.toHaveText(serial);
    const found = await getJson<Page_<Board>>(request, `/api/v1/inspections?serial=${encodeURIComponent(serial)}`);
    const board = found.items.find((b) => b.serialNumber === serial);
    expect(board).toMatchObject({ reviewOutcome: "CONFIRMED_DEFECT", reviewedBy: "e2e.reviewer" });
  });
});

test.describe("boards", () => {
  test("an NG board's detail page lists and draws every flagged region", async ({ page }) => {
    await page.goto("/inspections?verdict=NG");
    const row = page.locator("table.boards tbody tr").first();
    await expect(row).toBeVisible();
    const serial = (await row.getByRole("link").textContent())!.trim();
    const regions = Number(await row.locator("td").nth(7).textContent());
    expect(regions).toBeGreaterThan(0);

    await row.getByRole("link").click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(serial);
    await expect(page.locator("table.regions tbody tr")).toHaveCount(regions);
    await expect(page.locator("g.defect")).toHaveCount(regions);
  });

  test("a board posted to the API is counted and can be found by serial", async ({ page, request }) => {
    const before = await getJson<Summary>(request, "/api/v1/analytics/summary");
    const serial = `E2E-${Date.now()}`;
    const posted = await request.post("/api/v1/inspections", {
      data: {
        externalId: crypto.randomUUID(),
        serialNumber: serial,
        lineCode: "SMT-2",
        partNumber: "PCB-2040",
        profileVersion: 2,
        inspectedAt: new Date().toISOString(),
        verdict: "NG",
        anomalyScore: 0.91,
        cycleMs: 8400,
        defects: [{ defectClass: "short", xMm: 40, yMm: 30, wMm: 1.2, hMm: 0.8, confidence: 0.93 }],
      },
    });
    expect(posted.status()).toBe(201);

    const after = await getJson<Summary>(request, "/api/v1/analytics/summary");
    expect(after.inspected).toBe(before.inspected + 1);
    expect(after.pendingReview).toBe(before.pendingReview + 1);

    await page.goto("/inspections");
    await page.getByLabel("Serial number").fill(serial);
    await page.getByRole("button", { name: "Find" }).click();
    await page.getByRole("link", { name: serial }).click();
    await expect(page.locator("table.regions tbody tr")).toHaveCount(1);
  });

  test("every screen loads straight from its URL @phone", async ({ page, request }) => {
    const newest = await getJson<Page_<Board>>(request, "/api/v1/inspections?limit=1");
    const board = newest.items[0];
    expect((await page.goto(`/inspections/${board.id}`))?.status()).toBe(200);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(board.serialNumber);
    for (const path of ["/review", "/inspections", "/defects"]) {
      expect((await page.goto(path))?.status(), path).toBe(200);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    }
  });
});

test("Korean: the interface switches, and the Korean font loads only then", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("link", { name: "Overview" })).toBeVisible();
  expect(await koreanFontLoaded(page)).toBe(false);

  await page.getByRole("button", { name: "한국어" }).click();
  await expect(page.getByRole("link", { name: "개요" })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "ko");
  await expect.poll(() => koreanFontLoaded(page)).toBe(true);

  await page.reload();
  await expect(page.getByRole("link", { name: "개요" })).toBeVisible();
});

test.describe("accessibility (axe, WCAG 2.1 A and AA)", () => {
  const tags = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

  for (const path of ["/", "/review", "/inspections", "/defects"]) {
    test(`no violations on ${path}`, async ({ page }) => {
      await page.goto(path);
      await page.waitForLoadState("networkidle");
      const results = await new AxeBuilder({ page }).withTags(tags).analyze();
      expect(results.violations.map((v) => `${v.id} (${v.nodes.length}): ${v.help}`)).toEqual([]);
    });
  }

  test("no violations on a board's detail page", async ({ page, request }) => {
    const flagged = await getJson<Page_<Board>>(request, "/api/v1/inspections?verdict=NG&limit=1");
    await page.goto(`/inspections/${flagged.items[0].id}`);
    await page.waitForLoadState("networkidle");
    const results = await new AxeBuilder({ page }).withTags(tags).analyze();
    expect(results.violations.map((v) => `${v.id} (${v.nodes.length}): ${v.help}`)).toEqual([]);
  });
});
