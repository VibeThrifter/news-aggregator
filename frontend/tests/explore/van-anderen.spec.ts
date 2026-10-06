import { expect, test, type Page } from "@playwright/test";

/**
 * Van anderen (Stories 14.14 and 14.15): a fallacy, a contradiction, an error and a source of your
 * own; sharing what you added and taking over what others shared (simulated on the demo events).
 */

async function open(page: Page, path: string) {
  await page.goto(path);
  await expect(page.getByRole("heading", { level: 1, name: /Dijkerhoven/ })).toBeVisible();
}

function figure(page: Page) {
  return page.locator('section[aria-labelledby="figure-title"]');
}

/** "Van anderen" under the current tab, opened */
async function others(page: Page, tab: RegExp) {
  await page.getByRole("tab", { name: tab }).click();
  const section = page.getByRole("region", { name: "Van anderen" });
  const toggle = section.getByRole("button", { name: /^Van anderen/ });
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await toggle.click();
  return section;
}

/** The "＋" of a kind in the current tab */
function add(page: Page, label: string) {
  return page.getByRole("tabpanel").getByRole("button", { name: label, exact: true }).first();
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

test("what others shared is not in your picture until you take it over", async ({ page }) => {
  await open(page, "/event/demo");
  const missing = figure(page).getByRole("region", { name: "Niet aan het woord" });
  await expect(missing.getByText("Jongeren uit het dorp")).toHaveCount(0);

  const list = await others(page, /^Wat ontbreekt\?/);
  const row = list.locator("li").filter({ hasText: "Jongeren uit het dorp" });
  await expect(row).toContainText("5 lezers");
  await row.getByRole("button", { name: "Neem over" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Overgenomen:" })).toBeVisible();
  await expect(row.getByRole("button", { name: "Overgenomen" })).toBeVisible();
  await expect(row).toContainText("6 lezers");

  // Now in your picture and your list, marked as taken over
  await expect(missing.locator('[data-anchor^="gap:own:"]')).toContainText("overgenomen van een andere lezer");
  await expect(page.locator("li[id^='finding-own:']").filter({ hasText: "Jongeren uit het dorp" })).toBeVisible();
  await page.reload();
  await expect(figure(page).getByRole("region", { name: "Niet aan het woord" }).getByText("Jongeren uit het dorp")).toBeVisible();
});

test("takes over an error: next to the claim it corrects, in the picture and in the list", async ({ page }) => {
  await open(page, "/event/demo");
  const list = await others(page, /^Klopt het\?/);
  const row = list.locator("li").filter({ hasText: "omgevingsfonds is" });
  await row.getByRole("button", { name: "Neem over" }).click();

  const copy = page.locator("li[id^='finding-own:']").filter({ hasText: "omgevingsfonds is" });
  await expect(copy).toContainText("overgenomen van een andere lezer");
  // The claim of the analysis says someone thinks it is wrong, its balloon has the number
  await expect(page.locator('li[id="finding-claim:kfkq1g"]')).toContainText("fout volgens jou");
  await expect(page.locator('[data-anchor="outlet:telegraaf"]').getByRole("button", { name: /^Fout volgens jou \d+$/ })).toBeVisible();
});

test("searches, filters and orders what others shared, and reports what is abuse", async ({ page }) => {
  await open(page, "/event/demo");
  const list = await others(page, /^Klopt het\?/);
  await expect(list.locator("li")).toHaveCount(5);
  await list.getByRole("button", { name: "Drogreden", exact: true }).click();
  await expect(list.locator("li")).toHaveCount(2);
  await list.getByRole("button", { name: "Alles", exact: true }).click();
  await list.getByRole("searchbox", { name: "Zoek in wat anderen deelden" }).fill("windlobby");
  await expect(list.locator("li")).toHaveCount(1);
  await expect(list.locator("li")).toContainText("Op de man spelen");
  await list.getByRole("searchbox").fill("");
  await list.getByRole("radio", { name: "Nieuwste" }).click();
  await expect(list.locator("li").first()).toContainText("ruim binnen de normen");

  // Reported: gone for you
  const row = list.locator("li").filter({ hasText: "windlobby" });
  await row.getByRole("button", { name: /windlobby/ }).click();
  await row.getByRole("button", { name: "Meld" }).click();
  await row.getByRole("button", { name: "Spam of reclame" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Gemeld" })).toBeVisible();
  await expect(list.locator("li").filter({ hasText: "windlobby" })).toHaveCount(0);
});

test("shares what you added, without your name, and takes it back", async ({ page }) => {
  await open(page, "/event/demo-vervolg");
  await page.getByRole("tab", { name: /^Wat ontbreekt\?/ }).click();
  await add(page, "Ontbrekende stem").click();
  const form = page.getByRole("form", { name: "Ontbrekende stem toevoegen" });
  await form.getByLabel("Wie komt niet aan het woord?").fill("Ouders van de basisschool");
  await form.getByRole("button", { name: "Toevoegen" }).click();

  const row = page.locator("li[id^='finding-own:']").filter({ hasText: "Ouders van de basisschool" });
  await row.getByRole("button", { name: "Deel" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Gedeeld, zonder je naam" })).toBeVisible();
  await expect(row).toContainText("gedeeld");
  // Yours is not offered back to you in "Van anderen"
  const list = page.getByRole("region", { name: "Van anderen" });
  await list.getByRole("button", { name: /^Van anderen/ }).click();
  await expect(list.locator("li").filter({ hasText: "Ouders van de basisschool" })).toHaveCount(0);

  await row.getByRole("button", { name: "Niet meer delen" }).click();
  await expect(row).not.toContainText("gedeeld");
  await expect(row.getByRole("button", { name: "Deel" })).toBeVisible();
});

test("adds a fallacy and a contradiction, and says an analysis claim is wrong", async ({ page }) => {
  await open(page, "/event/demo-vervolg");
  await page.getByRole("tab", { name: /^Klopt het\?/ }).click();

  await add(page, "Drogreden").click();
  const fallacy = page.getByRole("form", { name: "Drogreden toevoegen" });
  await expect(fallacy.getByRole("button", { name: "Toevoegen" })).toBeDisabled();
  await fallacy.getByRole("radio", { name: "Stroman" }).click();
  await fallacy.getByLabel("Welke redenering?").fill("Tegenstanders zouden tegen alle vooruitgang zijn");
  await fallacy.getByRole("radio", { name: /Anouk Verbeek/ }).click();
  await fallacy.getByRole("button", { name: "Toevoegen" }).click();
  const fallacyRow = page.locator("li[id^='finding-own:']").filter({ hasText: "tegen alle vooruitgang" });
  await expect(fallacyRow).toContainText("Stroman");
  await expect(figure(page).locator('[data-anchor="speaker:nos:anouk-verbeek"]').getByRole("button", { name: /^Drogreden van jou \d+$/ })).toBeVisible();

  await add(page, "Tegenspraak").click();
  const contradiction = page.getByRole("form", { name: "Tegenspraak toevoegen" });
  await contradiction.getByLabel("Waarover spreken ze elkaar tegen?").fill("Of de bouw al mocht beginnen");
  await contradiction.getByRole("radiogroup", { name: "Wie zegt het één?" }).getByRole("radio", { name: /NordVind/ }).click();
  await contradiction.getByRole("radiogroup", { name: "Wie zegt het andere?" }).getByRole("radio", { name: /Joost Ravenhorst/ }).click();
  await contradiction.getByRole("button", { name: "Toevoegen" }).click();
  await expect(page.locator("li[id^='finding-own:']").filter({ hasText: "mocht beginnen" })).toContainText("Joost Ravenhorst");
  // A line between the two in the picture, with its number
  await expect(figure(page).locator('[data-anchor^="contradiction:own:"]').getByRole("button", { name: /^Tegenspraak van jou \d+$/ })).toBeVisible();

  // "Klopt niet" on a claim of the analysis: an error about it
  const claim = page.locator('li[id="finding-claim:s4w911"]');
  await claim.getByRole("button", { name: "Openklappen" }).click();
  await claim.getByRole("button", { name: "Klopt niet" }).click();
  const error = page.getByRole("form", { name: "Fout toevoegen" });
  await expect(error).toContainText("twee miljoen");
  await error.getByLabel("Wat is er fout?").fill("De twee miljoen komt uit een persbericht van NordVind zelf");
  await error.getByRole("button", { name: "Toevoegen" }).click();
  await expect(claim).toContainText("fout volgens jou");
  await expect(figure(page).locator('[data-anchor="speaker:nos:nordvind"]').getByRole("button", { name: /^Fout volgens jou \d+$/ })).toBeVisible();
});

test("adds a source: a balloon of its own in the picture, with what you wrote", async ({ page }) => {
  await open(page, "/event/demo-vervolg");
  await page.getByRole("group", { name: "Bronnen in het beeld" }).getByRole("button", { name: "Bron", exact: true }).click();
  const form = page.getByRole("form", { name: "Bron toevoegen" });
  await form.getByLabel("Link").fill("trouw.nl/nieuws/boeren-dijkerhoven");
  await form.getByLabel("Wat brengt deze bron?").fill("Boeren in de polder vertellen wat de bouwstop voor hen betekent");
  await form.getByRole("button", { name: "Toevoegen" }).click();

  const group = figure(page).getByRole("region", { name: "Trouw" });
  await expect(group).toContainText("Boeren in de polder vertellen");
  await expect(group).toContainText("door jou toegevoegd");
  await expect(page.getByRole("group", { name: "Bronnen in het beeld" }).getByRole("button", { name: /^Trouw/ })).toHaveAttribute("aria-pressed", "true");

  // You can add who speaks there
  await group.getByRole("button", { name: "Spreker" }).click();
  const speaker = group.getByRole("form", { name: "Spreker toevoegen" });
  await speaker.getByLabel("Naam").fill("Gerrit Hofstede");
  await speaker.getByRole("button", { name: "Toevoegen" }).click();
  await expect(group.locator('[data-anchor^="speaker:trouw:own:"]')).toContainText("Gerrit Hofstede");

  await page.getByRole("tab", { name: /^Wie praat\?/ }).click();
  await expect(page.getByRole("region", { name: "Wie praat bij Trouw" })).toContainText("trouw.nl");
});
