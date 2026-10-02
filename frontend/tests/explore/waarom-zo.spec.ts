import { expect, test } from "@playwright/test";

// Epic 13 "Waarom zo?": routes between the outlets and the parties of the (fictional) demo news

test.beforeEach(async ({ page }) => {
  await page.route(/wikipedia\.org/, (route) => route.fulfill({ status: 404, contentType: "application/json", body: "{}" }));
  await page.addInitScript(() => {
    if (!sessionStorage.getItem("e2e-init")) {
      localStorage.clear();
      sessionStorage.setItem("e2e-init", "1");
    }
  });
});

test.describe("Waarom zo?", () => {
  test("the outlet balloon shows its routes to the parties of the news, or honestly none", async ({ page }) => {
    await page.goto("/event/demo?p=bronnen");
    const sheet = page.getByRole("dialog").filter({ hasText: "Bronnen en artikelen" });
    await sheet.getByRole("button", { name: "NU.nl", exact: true }).click();
    const balloon = page.getByRole("dialog", { name: "Over NU.nl" });
    await expect(balloon.getByText("Waarom zo? Verbanden met dit nieuws")).toBeVisible({ timeout: 20_000 });
    const routes = balloon.getByRole("list", { name: "Verbanden van NU.nl met dit nieuws" });
    const none = balloon.getByText(/^Geen route binnen twee stappen tussen NU.nl/);
    await expect(routes.or(none)).toBeVisible();
    if (await routes.isVisible()) {
      // Each step can be opened for its sources
      await routes.getByRole("button", { name: /^Bronnen van / }).first().click();
      await expect(page.getByRole("dialog").filter({ hasText: /Bron: Propagandamodel/ }).first()).toBeVisible();
    }
  });

  test("the network lists which outlets are linked to the news, also those that did not bring it", async ({ page }) => {
    await page.goto("/event/demo/netwerk?p=filters");
    const sheet = page.getByRole("dialog").filter({ hasText: "De filters in dit nieuws" });
    await expect(sheet.getByText("Raakvlakken met dit nieuws")).toBeVisible({ timeout: 20_000 });
    const outlets = sheet.getByRole("region", { name: "Raakvlakken met dit nieuws" }).getByRole("button", { expanded: false });
    const none = sheet.getByText(/^Geen raakvlakken binnen twee stappen/);
    await expect(outlets.first().or(none)).toBeVisible();
    if (await outlets.count()) {
      await outlets.first().click();
      await expect(sheet.getByRole("list", { name: /^Routes van / })).toBeVisible();
    }
  });

  test("Toon in netwerk opens the network focused on the outlet with its routes", async ({ page }) => {
    await page.goto("/event/demo?p=bronnen");
    const sheet = page.getByRole("dialog").filter({ hasText: "Bronnen en artikelen" });
    await sheet.getByRole("button", { name: "NU.nl", exact: true }).click();
    const balloon = page.getByRole("dialog", { name: "Over NU.nl" });
    await balloon.getByRole("link", { name: "Toon in netwerk" }).click();
    await expect(page).toHaveURL(/\/event\/demo\/netwerk\?focus=pm%3A7|\/event\/demo\/netwerk\?focus=pm:7/);
    await expect(page.getByText("Dit nieuws", { exact: true })).toBeVisible({ timeout: 20_000 });
  });
});
