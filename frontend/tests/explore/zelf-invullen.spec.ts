import { expect, test, type Page } from "@playwright/test";

/** Zelf invullen: your own doubts, speakers, missing voices, questions, remarks and moments. */

async function open(page: Page, path: string, title: RegExp | string) {
  await page.goto(path);
  await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();
}

function figure(page: Page) {
  return page.locator('section[aria-labelledby="figure-title"]');
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

test("adds a missing voice in the picture: numbered, marked as yours, in Wat ontbreekt? and still there after a reload", async ({ page }) => {
  await open(page, "/event/demo", "Windpark Dijkerhoven splijt dorp en Den Haag");
  const missing = figure(page).getByRole("region", { name: "Niet aan het woord" });
  await missing.getByRole("button", { name: "Toevoegen" }).click();
  const form = missing.getByRole("form", { name: "Ontbrekende stem toevoegen" });
  await form.getByLabel("Wie komt niet aan het woord?").fill("Jongeren uit het dorp");
  await form.getByLabel(/Waarom doet dat ertoe\?/).fill("Zij wonen er straks het langst naast");
  await form.getByRole("button", { name: "Toevoegen" }).click();
  await expect(form).toHaveCount(0);

  const pill = missing.locator('[data-anchor^="gap:own:"] > button');
  await expect(pill).toContainText("Jongeren uit het dorp");
  await expect(pill).toContainText("door jou toegevoegd");

  // The popover: what you wrote, and change or remove it
  await pill.click();
  const card = page.getByRole("dialog", { name: "Jongeren uit het dorp" });
  await expect(card.getByText("Zij wonen er straks het langst naast")).toBeVisible();
  await expect(card.getByRole("button", { name: "Pas aan" })).toBeVisible();
  await page.keyboard.press("Escape");

  // In the tab, after what the analysis found, with the same (outlined) number
  await page.getByRole("tab", { name: /^Wat ontbreekt\?/ }).click();
  const row = page.locator("li[id^='finding-own:']").filter({ hasText: "Jongeren uit het dorp" });
  await expect(row.getByRole("button", { name: /^Ontbrekende stem van jou \d+: toon in het beeld$/ })).toBeVisible();

  await page.reload();
  await expect(figure(page).getByRole("region", { name: "Niet aan het woord" }).getByText("Jongeren uit het dorp")).toBeVisible();
});

test("doubts what a speaker says from their balloon: the doubt hangs on them, with a source", async ({ page }) => {
  await open(page, "/event/demo-vervolg", /Dijkerhoven/);
  const speaker = figure(page).locator('[data-anchor="speaker:nos:joost-ravenhorst"]');
  await speaker.locator("> button").click();
  await page.getByRole("dialog", { name: "Over Joost Ravenhorst" }).getByRole("button", { name: "Twijfel", exact: true }).click();

  // The tab opens with the form, the speaker already chosen
  await expect(page.getByRole("tab", { name: /^Klopt het\?/ })).toHaveAttribute("aria-selected", "true");
  const form = page.getByRole("form", { name: "Twijfel toevoegen" });
  await expect(form.getByRole("radio", { name: /Joost Ravenhorst/ })).toHaveAttribute("aria-checked", "true");
  await form.getByLabel("Wat wordt er beweerd?").fill("Het park betaalt zichzelf binnen zes jaar terug");
  await form.getByLabel(/Waarom twijfel je\?/).fill("Andere parken deden er twaalf jaar over");
  await form.getByLabel(/Bron/).fill("cbs.nl/windenergie");
  await form.getByRole("button", { name: "Toevoegen" }).click();

  const row = page.locator("li[id^='finding-own:']").filter({ hasText: "zes jaar" });
  await expect(row).toContainText("Joost Ravenhorst");
  await expect(row).toContainText("door jou toegevoegd");

  // Its number is on the speaker's balloon; a tap opens the row
  const marker = speaker.getByRole("button", { name: /^Twijfel van jou \d+$/ });
  await expect(marker).toBeVisible();
  await page.getByRole("tab", { name: /^Wie praat\?/ }).click();
  await marker.click();
  await expect(page.getByRole("tab", { name: /^Klopt het\?/ })).toHaveAttribute("aria-selected", "true");
  await expect(row.getByRole("link", { name: /Bron: cbs\.nl/ })).toHaveAttribute("href", "https://cbs.nl/windenergie");
});

test("changes and removes an entry of your own, with undo, and saves it", async ({ page }) => {
  await open(page, "/event/demo-vervolg", /Dijkerhoven/);
  await page.getByRole("tab", { name: /^Wat ontbreekt\?/ }).click();
  await page.getByRole("button", { name: "Vraag", exact: true }).click();
  const form = page.getByRole("form", { name: "Vraag toevoegen" });
  await form.getByLabel("Welke vraag is niet gesteld?").fill("Wie betaalt de netaansluiting?");
  await form.getByRole("radio", { name: /Anouk Verbeek/ }).click();
  await form.getByRole("button", { name: "Toevoegen" }).click();

  // The new row opens by itself, with what you can do with it
  const row = page.locator("li[id^='finding-own:']").filter({ hasText: "netaansluiting" });
  await expect(row).toContainText("Anouk Verbeek");
  await expect(row.getByRole("button", { name: "Dichtklappen" })).toBeVisible();
  await row.getByRole("button", { name: "Pas aan" }).click();
  const edit = page.getByRole("form", { name: "Vraag aanpassen" });
  await edit.getByLabel("Welke vraag is niet gesteld?").fill("Wie betaalt de netaansluiting van het park?");
  await edit.getByRole("button", { name: "Opslaan" }).click();
  await expect(row).toContainText("van het park?");

  // Save it: on the board as yours
  await row.getByRole("button", { name: "Bewaar" }).click();
  await expect(page.getByText(/^Bewaard: /)).toBeVisible();

  await row.getByRole("button", { name: "Verwijder" }).click();
  await expect(page.locator("li[id^='finding-own:']").filter({ hasText: "netaansluiting" })).toHaveCount(0);
  await page.getByRole("status").filter({ hasText: "Verwijderd:" }).getByRole("button", { name: "Ongedaan maken" }).click();
  await expect(page.locator("li[id^='finding-own:']").filter({ hasText: "netaansluiting" })).toHaveCount(1);

  await page.waitForLoadState("networkidle");
  await page.goto("/onderzoek");
  await page.getByRole("button", { name: "Toon als lijst" }).click();
  await expect(page.getByText("Vraag · jij")).toBeVisible();
});

test("adds a speaker to an outlet in the picture and a moment to the timeline", async ({ page }) => {
  await open(page, "/event/demo-vervolg", /Dijkerhoven/);
  const nos = figure(page).getByRole("region", { name: "NOS" });
  await nos.getByRole("button", { name: "Spreker" }).click();
  const form = nos.getByRole("form", { name: "Spreker toevoegen" });
  // One Dutch outlet: nothing to choose
  await expect(form.getByRole("radiogroup")).toHaveCount(0);
  await form.getByLabel("Naam").fill("Marieke Brand");
  await form.getByLabel(/Rol of organisatie/).fill("ecoloog");
  await form.getByLabel(/Wat zegt hij of zij\?/).fill("De vogeltrek is niet onderzocht");
  await form.getByRole("button", { name: "Toevoegen" }).click();
  const added = nos.locator('[data-anchor^="speaker:nos:own:"]');
  await expect(added).toContainText("Marieke Brand");
  await expect(added).toContainText("De vogeltrek is niet onderzocht");
  await expect(added).toContainText("door jou toegevoegd");

  await page.getByRole("tab", { name: /^Tijdlijn/ }).click();
  await page.getByRole("button", { name: "Moment", exact: true }).click();
  const moment = page.getByRole("form", { name: "Moment toevoegen" });
  await moment.getByLabel("Wanneer?").fill("2026-09-01");
  await moment.getByLabel("Wat gebeurde er?").fill("Provincie geeft vergunning voor de netaansluiting");
  await moment.getByRole("button", { name: "Toevoegen" }).click();
  await expect(page.locator("li[id^='finding-own:']").filter({ hasText: "Provincie geeft vergunning" })).toContainText(/1 sep\.? 2026/); // WebKit writes "sep."
});
