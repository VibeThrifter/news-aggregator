import { expect, test, type Page } from "@playwright/test";

/** Stemmen zoeken (Story 14.10): AI searches a missing voice, the admin approves what it finds. */

const VERVOLG = "/event/demo-vervolg";
const FARMERS = "Boeren met turbines op hun land";

function figure(page: Page) {
  return page.locator('section[aria-labelledby="figure-title"]');
}

function farmersPill(page: Page) {
  return figure(page).locator('[data-anchor^="gap:"] > button').filter({ hasText: FARMERS });
}

/** An admin code on this device; the database (mocked) says it may search. */
async function asAdmin(page: Page) {
  await page.route(/\/rest\/v1\/rpc\/access_code_role/, (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ role: "admin", can_search: true }) }),
  );
  await page.addInitScript(() => localStorage.setItem("pluriformiteit:toegang", "pf-admin-test"));
}

test.beforeEach(async ({ page }) => {
  await page.route(/wikipedia\.org/, (route) => route.fulfill({ status: 404, contentType: "application/json", body: "{}" }));
  await page.addInitScript(() => {
    if (!sessionStorage.getItem("e2e-init")) {
      localStorage.clear();
      sessionStorage.setItem("e2e-init", "1");
    }
  });
});

test("without an access code nobody can let AI search", async ({ page }) => {
  await page.goto(VERVOLG);
  await farmersPill(page).click();
  const card = page.getByRole("dialog", { name: FARMERS });
  await expect(card.getByText("Wie had het kunnen zeggen")).toBeVisible();
  await expect(card.getByRole("button", { name: /Zoek met AI/ })).toHaveCount(0);
});

test("the admin lets AI search a missing voice, approves a source, and the voice speaks in the picture", async ({ page }) => {
  await asAdmin(page);
  await page.goto(VERVOLG);
  await farmersPill(page).click();
  await page.getByRole("dialog", { name: FARMERS }).getByRole("button", { name: "Zoek met AI wie dit wél zegt" }).click();

  // The search continues in the row of that missing voice
  await expect(page.getByRole("tab", { name: /^Wat ontbreekt\?/ })).toHaveAttribute("aria-selected", "true");
  const panel = page.getByRole("region", { name: "Zoeken met AI" });
  await expect(panel.getByText("2 bronnen gevonden", { exact: false })).toBeVisible({ timeout: 15_000 });
  const trouw = panel.getByRole("listitem").filter({ hasText: "Trouw" });
  await expect(trouw).toContainText("Gerrit Hofstede, boer en verpachter");
  await trouw.getByRole("button", { name: "Voeg toe aan dit nieuws" }).click();
  await expect(trouw).toContainText("toegevoegd");

  // For every reader: Trouw is a source of this news, and the farmer speaks there
  const farmer = figure(page).locator('[data-anchor^="speaker:trouw:gevonden"]');
  await expect(farmer).toContainText("Gerrit Hofstede");
  await expect(farmer).toContainText("gevonden");
  await expect(farmersPill(page)).toContainText("wél bij Trouw");

  // The missing voice's card points to it; a tap jumps to the speaker
  await farmersPill(page).click();
  const card = page.getByRole("dialog", { name: FARMERS });
  await card.getByRole("button", { name: /Gerrit Hofstede/ }).click();
  await expect(card).toBeHidden();

  // Taken out again
  await trouw.getByRole("button", { name: "Haal weg uit dit nieuws" }).click();
  await expect(farmer).toHaveCount(0);
  await expect(farmersPill(page)).not.toContainText("wél bij");
});

test("a missing voice the reader added can be searched too, and may find nobody", async ({ page }) => {
  await asAdmin(page);
  await page.goto(VERVOLG);
  const missing = figure(page).getByRole("region", { name: "Niet aan het woord" });
  await missing.getByRole("button", { name: "Toevoegen" }).click();
  await missing.getByLabel("Wie komt niet aan het woord?").fill("Vogelwerkgroep");
  await missing.getByRole("button", { name: "Toevoegen" }).click();

  await page.getByRole("tab", { name: /^Wat ontbreekt\?/ }).click();
  const row = page.locator("li[id^='finding-own:']").filter({ hasText: "Vogelwerkgroep" });
  await row.getByRole("button", { name: "Openklappen" }).click();
  await row.getByRole("button", { name: "Zoek met AI wie dit wél zegt" }).click();
  await expect(row.getByText("Niemand gevonden die dit wél zegt.")).toBeVisible({ timeout: 15_000 });
});
