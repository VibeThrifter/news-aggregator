import { expect, test } from "@playwright/test";

/** Epic 12 "Wie is dit?": tappable names, network & research in the entity panel, the actor page. */

test.beforeEach(async ({ page }) => {
  // No real network calls to Wikipedia from tests
  await page.route(/wikipedia\.org/, (route) => route.fulfill({ status: 404, contentType: "application/json", body: "{}" }));
  await page.addInitScript(() => {
    if (!sessionStorage.getItem("e2e-init")) {
      localStorage.clear();
      sessionStorage.setItem("e2e-init", "1");
    }
  });
});

test.describe("Wie is dit?", () => {
  test("a name in the teaser opens its research and leads to the actor page with the network", async ({ page }) => {
    await page.goto("/event/demo");
    await expect(page.getByRole("heading", { level: 1, name: "Windpark Dijkerhoven splijt dorp en Den Haag" })).toBeVisible();

    const teaser = page.locator('section[aria-labelledby="teaser-title"]');
    await teaser.getByRole("button", { name: "Anouk Verbeek" }).click();

    const sheet = page.getByRole("dialog").filter({ hasText: "Netwerk & onderzoek" });
    await expect(sheet.getByText("Uitgezocht", { exact: true })).toBeVisible();
    await expect(sheet.getByText("3 verbanden gevonden · 2 automatisch toegevoegd · 1 wacht op controle.")).toBeVisible();

    await sheet.getByRole("link", { name: /Bekijk netwerk/ }).click();
    await expect(page).toHaveURL(/\/actor\/anouk-verbeek\?k=person&n=Anouk\+Verbeek&demo=1$/);
    await expect(page.getByRole("heading", { level: 1, name: "Anouk Verbeek" })).toBeVisible();
    await expect(page.getByText("Verzonnen voorbeeld.")).toBeVisible();

    // The ego-network on a canvas, with the labels of the news pipeline
    const canvas = page.getByTestId("actor-network-canvas");
    await expect(canvas.locator(".react-flow__node").filter({ hasText: "Gemeente Dijkerhoven" })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText("automatisch toegevoegd").first()).toBeVisible();

    // Sources of a relation: one is not reviewed yet
    await page.getByRole("button", { name: "Bronnen van het verband met Dijkerhoven Vooruit" }).click();
    const details = page.getByRole("dialog").filter({ hasText: "Verband in het propagandamodel" });
    await expect(details.getByText("nog niet gecontroleerd")).toBeVisible();
    await page.goBack();
    await expect(details).toBeHidden();

    // Who appears in the same news, and the research status
    await expect(page.getByRole("link", { name: /NordVind/ }).first()).toBeVisible();
    await expect(page.locator('[data-research-status="klaar"]')).toBeVisible();
  });

  test("a private resident is never researched", async ({ page }) => {
    await page.goto("/event/demo?p=samenvatting");
    const summary = page.getByRole("dialog").filter({ hasText: "Het hele verhaal" });
    await summary.getByRole("button", { name: "Henk de Boer" }).click();
    const sheet = page.getByRole("dialog").filter({ hasText: "Netwerk & onderzoek" });
    await expect(sheet.getByText("Wordt niet uitgezocht", { exact: true })).toBeVisible();
    await expect(sheet.getByText("Privépersoon — wordt niet uitgezocht.")).toBeVisible();
  });

  test("shows the research status of an organisation that is being researched", async ({ page }) => {
    await page.goto("/event/demo?p=entiteit:nordvind");
    const sheet = page.getByRole("dialog").filter({ hasText: "Netwerk & onderzoek" });
    await expect(sheet.getByText("Wordt nu uitgezocht")).toBeVisible();
    await expect(sheet.getByRole("link", { name: /Bekijk profiel/ })).toBeVisible();
  });

  test("a real propaganda-model entity shows its full network on the actor page", async ({ page }) => {
    await page.goto("/actor/nos?k=org&n=NOS&demo=1");
    await expect(page.getByRole("heading", { level: 1, name: "NOS" })).toBeVisible();
    const nodes = page.getByTestId("actor-network-canvas").locator(".react-flow__node");
    await expect.poll(() => nodes.count(), { timeout: 20_000 }).toBeGreaterThan(5);
    await expect(page.getByText(/Verbanden van NOS/)).toBeVisible();

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
