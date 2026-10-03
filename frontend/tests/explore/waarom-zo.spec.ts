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
  test("Wie zit erachter? shows the most specific routes of the news, or honestly none", async ({ page }) => {
    await page.goto("/event/demo");
    const block = page.locator('section[aria-labelledby="behind-title"]');
    await block.scrollIntoViewIfNeeded();
    const routes = block.getByRole("list", { name: "Routes tussen de bronnen en de partijen van dit nieuws" });
    const none = block.getByText(/^Geen verband binnen twee stappen|^Geen partij uit dit nieuws/);
    await expect(routes.or(none)).toBeVisible({ timeout: 20_000 });
    if (await routes.isVisible()) {
      await routes.getByRole("button", { name: /^Bronnen van / }).first().click();
      await expect(page.getByRole("dialog").filter({ hasText: /Bron: Propagandamodel/ }).first()).toBeVisible();
    }
  });

  test("the network lists which outlets are linked to the news, also those that did not bring it", async ({ page }) => {
    await page.goto("/event/demo/netwerk?p=filters");
    const sheet = page.getByRole("dialog").filter({ hasText: "De filters in dit nieuws" });
    await expect(sheet.getByText("Media verbonden met dit nieuws")).toBeVisible({ timeout: 20_000 });
    const outlets = sheet.getByRole("region", { name: "Media verbonden met dit nieuws" }).getByRole("button", { expanded: false });
    const none = sheet.getByText(/^Geen raakvlakken binnen twee stappen/);
    await expect(outlets.first().or(none)).toBeVisible();
    if (await outlets.count()) {
      await outlets.first().click();
      await expect(sheet.getByRole("list", { name: /^Routes van / })).toBeVisible();
    }
  });

  test("Wie zit erachter? in an outlet balloon opens the network focused on that outlet", async ({ page }) => {
    await page.goto("/event/demo");
    await page.locator('[data-anchor="outlet:nu-nl"] > button').first().click();
    const balloon = page.getByRole("dialog", { name: "Over NU.nl" });
    await balloon.getByRole("link", { name: "Wie zit erachter?" }).click();
    await expect(page).toHaveURL(/\/event\/demo\/netwerk\?focus=pm%3A7|\/event\/demo\/netwerk\?focus=pm:7/);
    await expect(page.getByText("Dit nieuws", { exact: true })).toBeVisible({ timeout: 20_000 });
  });
});
