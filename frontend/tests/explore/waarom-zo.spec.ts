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
  test("Wie zit erachter? shows only places in the outlets and their money, and no sentence when there is none", async ({ page }) => {
    await page.goto("/event/demo");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible({ timeout: 20_000 });
    // Scroll through the page step by step, so the block loads once it comes into view
    for (let i = 0; i < 40; i += 1) {
      const bottom = await page.evaluate(() => {
        window.scrollBy(0, 500);
        return window.innerHeight + window.scrollY >= document.body.scrollHeight - 2;
      });
      await page.waitForTimeout(100);
      if (bottom) break;
    }
    // RIVM and the PBL are sources of the NOS and the Volkskrant: contact, not who is behind them (Story 14.25)
    await expect(page.locator('section[aria-labelledby="behind-title"]')).toHaveCount(0, { timeout: 20_000 });
    await expect(page.getByText(/^Geen verband binnen twee stappen|^Geen partij uit dit nieuws/)).toHaveCount(0);
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
