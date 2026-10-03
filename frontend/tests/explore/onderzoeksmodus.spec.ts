import { expect, test, type Page } from "@playwright/test";

const EVENT = "/event/demo";

async function openDemo(page: Page) {
  await page.goto(EVENT);
  await expect(page.getByRole("heading", { level: 1, name: "Windpark Dijkerhoven splijt dorp en Den Haag" })).toBeVisible();
}

function figure(page: Page) {
  return page.locator('section[aria-labelledby="figure-title"]');
}

function balloon(page: Page, anchor: string) {
  return page.locator(`[data-anchor="${anchor}"] > button`).first();
}

test.describe("Eén beeld (demo)", () => {
  test.beforeEach(async ({ page }) => {
    // Wikipedia loads by itself: no real network calls from tests (a test can override this route)
    await page.route(/wikipedia\.org/, (route) => route.fulfill({ status: 404, contentType: "application/json", body: "{}" }));
    // Every test starts empty
    await page.addInitScript(() => {
      if (!sessionStorage.getItem("e2e-init")) {
        localStorage.clear();
        sessionStorage.setItem("e2e-init", "1");
      }
    });
  });

  test("shows who says what in one picture, the missing voices, and no game", async ({ page }) => {
    await openDemo(page);
    await expect(page.getByText("Verzonnen voorbeeld.")).toBeVisible();
    await expect(figure(page).getByText("Economische kans voor het dorp")).toBeVisible();
    await expect(figure(page).getByText("Niet aan het woord")).toBeVisible();
    await expect(figure(page).getByText("Boeren op de polder")).toBeVisible();
    // No quest left: nothing to reveal, no progress, no clues
    const text = (await page.locator("[data-explore]").innerText()).toLowerCase();
    for (const word of ["onthul", "aanwijzing", "ontdekt", "speurmodus", "volg het spoor", "onderzoek het zelf"]) {
      expect(text).not.toContain(word);
    }
  });

  test("an outlet balloon opens what it wrote and one line per question", async ({ page }) => {
    await openDemo(page);
    await balloon(page, "outlet:telegraaf").click();
    const card = page.getByRole("dialog", { name: "Over De Telegraaf" });
    await expect(card).toBeVisible();
    await expect(card.getByText(/De Telegraaf benadrukt de opbrengst/)).toBeVisible();
    await expect(card.getByText(/niet kan achterblijven/)).toHaveCount(0);
    await card.getByRole("button", { name: "Nog 1 zin" }).click();
    await expect(card.getByText(/niet kan achterblijven/)).toBeVisible();
    await expect(card.getByText("In dit nieuws")).toBeVisible();

    // A line of "In dit nieuws" opens its tab at the finding
    await card.getByRole("button", { name: /^Klopt het\?/ }).click();
    await expect(card).toBeHidden();
    await expect(page.getByRole("tab", { name: /^Klopt het\?/ })).toHaveAttribute("aria-selected", "true");
    await expect(page.locator("li[id^='finding-'] button[aria-expanded='true']").first()).toBeVisible();
  });

  test("a number on a balloon opens its row, and the row's number leads back", async ({ page }) => {
    await openDemo(page);
    const marker = figure(page).getByRole("button", { name: /^Claim zonder bewijs \d+$/ }).first();
    const label = (await marker.getAttribute("aria-label")) ?? "";
    const number = label.match(/\d+$/)?.[0];
    await marker.click();
    await expect(page.getByRole("tab", { name: /^Klopt het\?/ })).toHaveAttribute("aria-selected", "true");
    const row = page.locator("li[id^='finding-']").filter({ has: page.getByRole("button", { name: `Claim zonder bewijs ${number}: toon in het beeld` }) });
    await expect(row.getByRole("button", { expanded: true }).first()).toBeVisible();
    await expect(row.getByText("Vragen die je kunt stellen")).toBeVisible();

    await row.getByRole("button", { name: `Claim zonder bewijs ${number}: toon in het beeld` }).click();
    await expect(figure(page).getByRole("button", { name: `Claim zonder bewijs ${number}` })).toBeInViewport();
  });

  test("switches between the questions", async ({ page }) => {
    await openDemo(page);
    await page.getByRole("tab", { name: /^Wie praat\?/ }).click();
    await expect(page.getByRole("table", { name: "Wie praat bij welke bron" })).toBeVisible();
    await expect(page.getByText("● aan het woord · ○ alleen genoemd")).toBeVisible();

    await page.getByRole("tab", { name: /^Wat ontbreekt\?/ }).click();
    await expect(page.getByRole("tabpanel").getByText("Onafhankelijke geluidsdeskundigen")).toBeVisible();

    await page.getByRole("tab", { name: /^Tijdlijn/ }).click();
    await expect(page.getByRole("tabpanel").getByText("Dit nieuws")).toBeVisible();
    await expect(page.getByRole("tabpanel").getByText("Omwonenden dienen bezwaar in bij de rechtbank").first()).toBeVisible();

    // The chosen tab is remembered
    await page.reload();
    await expect(page.getByRole("tab", { name: /^Tijdlijn/ })).toHaveAttribute("aria-selected", "true");
  });

  test("shows the outlets on the left-right map", async ({ page }) => {
    await openDemo(page);
    await page.getByRole("radio", { name: "Links/rechts" }).click();
    await expect(figure(page).getByText("▼ Alternatief")).toBeVisible();
    await page.getByRole("radio", { name: "Gesprek" }).click();
    await expect(figure(page).getByText("Niet aan het woord")).toBeVisible();
  });

  test("with one Dutch outlet the picture shows who it gives the word to", async ({ page }) => {
    await openDemo(page);
    const picker = page.getByRole("group", { name: "Bronnen in het beeld" });
    for (const name of ["NU.nl", "NOS", "AD", "GeenStijl", "de Volkskrant", "De Andere Krant", "Een Blik op de NOS"]) {
      await picker.getByRole("button", { name, exact: true }).click();
    }
    await expect(figure(page).getByText("Anouk Verbeek")).toBeVisible();
    await expect(figure(page).getByText("NordVind").first()).toBeVisible();
    await page.locator('[data-anchor^="speaker:telegraaf:"] > button').filter({ hasText: "Anouk Verbeek" }).click();
    const card = page.getByRole("dialog", { name: "Over Anouk Verbeek" });
    await expect(card.getByText("Beweert, zonder bewijs")).toBeVisible();
    await expect(card.getByRole("button", { name: /Meer over Anouk Verbeek/ })).toBeVisible();
  });

  test("chooses foreign outlets for the picture and remembers it", async ({ page }) => {
    await openDemo(page);
    const picker = page.getByRole("group", { name: "Bronnen in het beeld" });
    const dw = picker.getByRole("button", { name: "Deutsche Welle", exact: true });
    await expect(dw).toHaveAttribute("aria-pressed", "false");
    await expect(page.locator('[data-anchor="outlet:dw"]')).toHaveCount(0);
    await dw.click();
    await expect(figure(page).getByRole("region", { name: "Buitenland" })).toBeVisible();
    await expect(balloon(page, "outlet:dw")).toContainText(/NordVind breidt uit naar Nederland/);
    await page.reload();
    await expect(page.locator('[data-anchor="outlet:dw"]')).toHaveCount(1);

    // A foreign article: the Dutch gist, then the article panel with the original headline
    await balloon(page, "outlet:dw").click();
    const card = page.getByRole("dialog", { name: "Over Deutsche Welle" });
    await card.getByRole("button", { name: /^NordVind breidt uit naar Nederland/ }).click();
    const sheet = page.getByRole("dialog", { name: /^Deutsche Welle/ });
    await expect(sheet.getByText("Wat staat erin?")).toBeVisible();
    await expect(sheet.getByText("German wind developer NordVind expands in the Netherlands")).toBeVisible();
  });

  test("saves a finding and finds it under Bewaard", async ({ page }) => {
    await openDemo(page);
    await page.getByRole("tab", { name: /^Klopt het\?/ }).click();
    const row = page.locator("li[id^='finding-']").first();
    await row.getByRole("button", { name: "Openklappen" }).click();
    await row.getByRole("button", { name: "Bewaar" }).click();
    await expect(page.getByText(/^Bewaard: /)).toBeVisible();
    await page.getByRole("button", { name: /^Bewaard/ }).first().click();
    await expect(page.getByRole("dialog").getByText("Bevinding").first()).toBeVisible();
  });

  test("an old link to a clue opens the finding in its tab", async ({ page }) => {
    await openDemo(page);
    await page.getByRole("tab", { name: /^Klopt het\?/ }).click();
    const id = ((await page.locator("li[id^='finding-claim']").first().getAttribute("id")) ?? "").replace("finding-", "");
    await page.goto(`${EVENT}?p=spoor:wat-klopt-niet&c=${encodeURIComponent(`wat-klopt-niet:${id}`)}`);
    await expect(page.locator(`li[id='finding-${id}'] button[aria-expanded='true']`).first()).toBeVisible();
    await expect(page).toHaveURL(/\/event\/demo$/);
  });

  test("compares two outlets", async ({ page }) => {
    await openDemo(page);
    await balloon(page, "outlet:ad").click();
    await page.getByRole("dialog", { name: "Over AD" }).getByRole("button", { name: "Vergelijk" }).click();
    const compare = page.getByRole("dialog").filter({ hasText: "Vergelijk" });
    await compare.getByRole("button", { name: "NOS", exact: true }).click();
    await expect(compare.getByText("Ze spreken elkaar tegen")).toBeVisible();
    await expect(compare.getByText("Hoeveel turbines komen er?")).toBeVisible();
  });

  test("swipes through biased sentences", async ({ page }) => {
    await page.goto(`${EVENT}?p=bias:geenstijl`);
    const sheet = page.getByRole("dialog").filter({ hasText: "Gekleurde zinnen bij GeenStijl" });
    await expect(sheet.getByText("1 / 4")).toBeVisible();
    await sheet.getByRole("button", { name: "Volgende zin" }).click();
    await expect(sheet.getByText("2 / 4")).toBeVisible();
    await expect(sheet.getByRole("button", { name: "Toon uitleg" })).toHaveCount(1);
    await sheet.getByRole("button", { name: "Toon uitleg" }).click();
    await expect(sheet.getByText("Sterkte")).toBeVisible();
  });

  test("shows Wikipedia background and where an entity is mentioned (mocked)", async ({ page }) => {
    await page.route(/wikipedia\.org/, (route) =>
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          type: "standard",
          title: "NordVind",
          description: "testbedrijf",
          extract: "NordVind is een fictief windbedrijf uit de test.",
          content_urls: { mobile: { page: "https://nl.m.wikipedia.org/wiki/NordVind" } },
        }),
      }),
    );
    await page.goto(`${EVENT}?p=entiteit:nordvind`);
    const sheet = page.getByRole("dialog").filter({ hasText: "NordVind" });
    await expect(sheet.getByText("NordVind is een fictief windbedrijf uit de test.")).toBeVisible();
    // In this news: where NordVind speaks and its interests
    await expect(sheet.getByText("In dit nieuws")).toBeVisible();
    const here = sheet.getByRole("region", { name: "Wie noemt NordVind?" });
    await expect(here.getByText(/Genoemd in 8 artikelen van 7 media/)).toBeVisible();
    await expect(sheet.getByRole("searchbox", { name: "Zoekterm voor alle artikelen" })).toHaveValue("NordVind");
  });

  test("follows the story: earlier and later episodes, and the usual one-outlet picture", async ({ page }) => {
    await openDemo(page);
    await page.getByRole("button", { name: /^Ook in 2 andere nieuwsitems over dit verhaal/ }).click();
    const panel = page.getByRole("tabpanel");
    await expect(panel.getByText("Eerder in dit verhaal")).toBeVisible();
    await expect(panel.getByText("Dezelfde mensen in ander nieuws")).toBeVisible();
    await panel.getByRole("link", { name: /Rechter legt bouw windpark Dijkerhoven stil/ }).click();

    await expect(page.getByRole("heading", { level: 1, name: "Rechter legt bouw windpark Dijkerhoven stil" })).toBeVisible();
    // One Dutch outlet: a group for NOS with the speakers it gives the word to
    await expect(figure(page).getByText("Joost Ravenhorst")).toBeVisible();
    await expect(figure(page).getByText("Anonieme bron")).toBeVisible();
    await expect(figure(page).getByText("via ANP").first()).toBeVisible();
    await expect(figure(page).getByText("Boeren met turbines op hun land")).toBeVisible();

    // Old foreign coverage carries its date
    await page.getByRole("group", { name: "Bronnen in het beeld" }).getByRole("button", { name: "Reuters", exact: true }).click();
    await expect(page.locator('[data-anchor="outlet:reuters"]')).toContainText("30 jun");
  });

  test("Wie zit erachter? shows real routes in the demo", async ({ page }) => {
    await openDemo(page);
    const block = page.locator('section[aria-labelledby="behind-title"]');
    await block.scrollIntoViewIfNeeded();
    await expect(block.getByRole("list", { name: "Routes tussen de bronnen en de partijen van dit nieuws" })).toBeVisible({ timeout: 20_000 });
  });

  test("all sources and articles open downwards in the page", async ({ page }) => {
    await openDemo(page);
    const sources = page.getByRole("region", { name: "Bronnen en artikelen" });
    const toggle = sources.getByRole("button", { name: /Alle bronnen en artikelen/ });
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(sources.getByText("Windpark levert Dijkerhoven miljoenen op")).toBeVisible();
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });

  test("has no horizontal overflow and big enough tap targets", async ({ page }, testInfo) => {
    await openDemo(page);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    if (testInfo.project.name === "desktop-chrome") return;
    const small = await page.evaluate(() =>
      Array.from(document.querySelectorAll("[data-explore] button, [data-explore] a"))
        .map((el) => ({ rect: el.getBoundingClientRect(), text: (el.textContent ?? "").slice(0, 30) }))
        .filter(({ rect }) => rect.width > 0 && rect.height > 0 && (rect.width < 32 || rect.height < 32))
        .map(({ text }) => text),
    );
    expect(small).toEqual([]);
  });
});
