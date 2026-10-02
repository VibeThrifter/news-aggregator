import { expect, test, type Page } from "@playwright/test";

const EVENT = "/event/demo";

async function openDemo(page: Page) {
  await page.goto(EVENT);
  await expect(page.getByRole("heading", { level: 1, name: "Windpark Dijkerhoven splijt dorp en Den Haag" })).toBeVisible();
}

function bubbles(page: Page) {
  return page.locator('section[aria-labelledby="bubbles-title"]');
}

test.describe("Onderzoeksmodus (demo)", () => {
  test.beforeEach(async ({ page }) => {
    // Wikipedia loads by itself: no real network calls from tests (a test can override this route)
    await page.route(/wikipedia\.org/, (route) => route.fulfill({ status: 404, contentType: "application/json", body: "{}" }));
    // Every test starts with an empty investigation
    await page.addInitScript(() => {
      if (!sessionStorage.getItem("e2e-init")) {
        localStorage.clear();
        sessionStorage.setItem("e2e-init", "1");
      }
    });
  });

  test("shows the LLM title, the demo banner and every outlet's perspective right away", async ({ page }) => {
    await openDemo(page);
    await expect(page.getByText("Verzonnen voorbeeld.")).toBeVisible();
    await expect(page.getByText("Begin je onderzoek")).toBeVisible();
    // No typing dots to tap away: each bubble says what the outlet says, under its perspective
    const withPerspective = bubbles(page).getByRole("button", { name: /^[^,]+: / });
    expect(await withPerspective.count()).toBeGreaterThanOrEqual(8);
    await expect(bubbles(page).getByText("Economische kans voor het dorp")).toBeVisible();
    await expect(bubbles(page).getByRole("button", { name: /tik om te onthullen/ })).toHaveCount(0);
  });

  test("switches lenses", async ({ page }) => {
    await openDemo(page);
    const spectrum = page.getByRole("radio", { name: "Spectrum" });
    await spectrum.click();
    await expect(spectrum).toHaveAttribute("aria-checked", "true");
    await expect(bubbles(page).getByText("Alternatief").first()).toBeVisible();
    await page.getByRole("radio", { name: "Tegenspraak" }).click();
    await expect(bubbles(page).getByRole("button", { name: /Tegenspraak/ }).first()).toBeVisible();
  });

  test("one tap on a bubble opens its balloon and counts the perspective as found", async ({ page }) => {
    await openDemo(page);
    await bubbles(page).getByRole("button", { name: /^De Telegraaf: / }).click();
    await expect(page.getByText(/^1 van \d+ aanwijzingen$/)).toBeVisible();
    const balloon = page.getByRole("dialog", { name: "Over De Telegraaf" });
    await expect(balloon).toBeVisible();
    await expect(balloon.getByText("Aanwijzingen bij De Telegraaf")).toBeVisible();
    // What it wrote: one sentence of the analysis, the rest on request
    await expect(balloon.getByText(/De Telegraaf benadrukt de opbrengst/)).toBeVisible();
    await expect(balloon.getByText(/niet kan achterblijven/)).toHaveCount(0);
    await balloon.getByRole("button", { name: "Nog 1 zin" }).click();
    await expect(balloon.getByText(/niet kan achterblijven/)).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(balloon).toBeHidden();
  });

  test("flips clue cards in a spoor, keeps progress after reload, back button closes the sheet", async ({ page }) => {
    await openDemo(page);
    await page.getByRole("button", { name: /Wat klopt er niet\?/ }).click();
    const sheet = page.getByRole("dialog").filter({ hasText: "Wat klopt er niet?" });
    await expect(sheet.getByText("0 van 9 ontdekt")).toBeVisible();

    await sheet.getByRole("button", { name: /Tegenspraak, AD vs NOS, NU\.nl/ }).click();
    await expect(sheet.getByText("Hoeveel turbines komen er?")).toBeVisible();
    await expect(sheet.getByText("1 van 9 ontdekt")).toBeVisible();

    await page.reload();
    await expect(page.getByRole("dialog").getByText("Hoeveel turbines komen er?")).toBeVisible();

    await page.goBack();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page).toHaveURL(/\/event\/demo$/);
  });

  test("pins a revealed card into the dossier", async ({ page }) => {
    await openDemo(page);
    await page.getByRole("button", { name: /Wie heeft er belang bij\?/ }).click();
    const sheet = page.getByRole("dialog").filter({ hasText: "Wie heeft er belang bij?" });
    await sheet.getByRole("button", { name: /Wie is Nationale Adviesraad Windenergie\?/ }).click();
    await sheet.getByRole("button", { name: "Bewaar in dossier" }).first().click();
    await expect(page.getByText(/Bewaard in je dossier/)).toBeVisible();
    await page.goBack();
    await page.getByRole("button", { name: /Dossier/ }).click();
    await expect(page.getByRole("dialog").getByText("Nationale Adviesraad Windenergie")).toBeVisible();
  });

  test("compares two outlets", async ({ page }) => {
    await page.goto(`${EVENT}?p=bronnen`);
    const sheet = page.getByRole("dialog").filter({ hasText: "Bronnen en artikelen" });
    await sheet.getByRole("button", { name: "AD", exact: true }).click();
    await page.getByRole("dialog", { name: "Over AD" }).getByRole("button", { name: "Vergelijk" }).click();
    await expect(page.getByText("AD staat klaar. Kies nog een bron om mee te vergelijken.")).toBeVisible();
    await sheet.getByRole("button", { name: "NOS", exact: true }).click();
    await page.getByRole("dialog", { name: "Over NOS" }).getByRole("button", { name: "Vergelijk" }).click();
    const compare = page.getByRole("dialog").filter({ hasText: "Bronvergelijker" });
    await expect(compare.getByText("Ze spreken elkaar tegen")).toBeVisible();
    await expect(compare.getByText("Hoeveel turbines komen er?")).toBeVisible();
  });

  test("swipes through biased sentences", async ({ page }) => {
    await page.goto(`${EVENT}?p=bias:geenstijl`);
    const sheet = page.getByRole("dialog").filter({ hasText: "Gekleurde zinnen bij GeenStijl" });
    await expect(sheet.getByText("1 / 4")).toBeVisible();
    await sheet.getByRole("button", { name: "Volgende zin" }).click();
    await expect(sheet.getByText("2 / 4")).toBeVisible();
    // The previous card animates out; wait until only the new one is left
    await expect(sheet.getByRole("button", { name: "Toon uitleg" })).toHaveCount(1);
    await sheet.getByRole("button", { name: "Toon uitleg" }).click();
    await expect(sheet.getByText("Sterkte")).toBeVisible();
  });

  test("scrubs through time with the keyboard and reveals the story timeline", async ({ page }) => {
    await page.goto(`${EVENT}?p=spoor:hoe-liep-het`);
    const sheet = page.getByRole("dialog").filter({ hasText: "Hoe liep het?" });
    const slider = sheet.getByRole("slider", { name: "Tijd" });
    await slider.focus();
    await page.keyboard.press("End");
    await expect(sheet.getByText(/13 van 13 artikelen verschenen/)).toBeVisible();
    await expect(sheet.getByText("Omwonenden dienen bezwaar in bij de rechtbank").first()).toBeVisible();
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

    // Who mentions NordVind in this news, and what each outlet wrote about it
    const here = sheet.getByRole("region", { name: "Wie noemt NordVind?" });
    await expect(here.getByText(/Genoemd in 8 artikelen van 7 media/)).toBeVisible();
    const telegraaf = here.getByRole("button", { name: /^De Telegraaf/ });
    await telegraaf.click();
    await expect(telegraaf).toHaveAttribute("aria-expanded", "true");
    await expect(here.getByText("Wethouder Verbeek kiest voor de toekomst")).toBeVisible();

    // Search all articles
    await expect(sheet.getByRole("searchbox", { name: "Zoekterm voor alle artikelen" })).toHaveValue("NordVind");
    await sheet.getByRole("button", { name: "Zoek", exact: true }).click();
    await expect(sheet.getByText(/2 artikelen met “NordVind”/)).toBeVisible();
  });

  test("chooses which Dutch and foreign outlets are in the map", async ({ page }) => {
    await openDemo(page);
    const picker = page.getByRole("group", { name: "Bronnen in de kaart" });
    const dw = picker.getByRole("button", { name: "Deutsche Welle", exact: true });
    await expect(dw).toHaveAttribute("aria-pressed", "false");
    await expect(bubbles(page).getByRole("button", { name: /^Deutsche Welle[,:] / })).toHaveCount(0);
    await dw.click();
    await expect(dw).toHaveAttribute("aria-pressed", "true");
    await expect(bubbles(page).getByRole("button", { name: /^Deutsche Welle[,:] / }).first()).toBeVisible();

    // A Dutch outlet can be left out
    await picker.getByRole("button", { name: "NOS", exact: true }).click();
    await expect(bubbles(page).getByRole("button", { name: /^NOS, / })).toHaveCount(0);

    // No separate page for foreign outlets any more; the choice is remembered
    await expect(page.getByRole("button", { name: /buitenlandse bron/ })).toHaveCount(0);
    await page.reload();
    await expect(page.getByRole("group", { name: "Bronnen in de kaart" }).getByRole("button", { name: "Deutsche Welle", exact: true })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(bubbles(page).getByRole("button", { name: /^NOS, / })).toHaveCount(0);
  });

  test("an outlet the analysis did not classify goes with the perspective its headline leans to", async ({ page }) => {
    await openDemo(page);
    const picker = page.getByRole("group", { name: "Bronnen in de kaart" });
    // VRT NWS ("Nederlands windpark van NordVind ook in Vlaanderen omstreden") leans to a perspective: estimated
    await picker.getByRole("button", { name: "VRT NWS", exact: true }).click();
    const vrt = bubbles(page).getByRole("button", { name: "VRT NWS, geschatte invalshoek" });
    await expect(vrt).toContainText("geschatte invalshoek");
    await vrt.click();
    const balloon = page.getByRole("dialog", { name: "Over VRT NWS" });
    await expect(balloon.getByText(/Geschatte invalshoek/)).toContainText("Economische kans voor het dorp");
    await expect(balloon.getByText("Wat schreef VRT NWS?")).toBeVisible();
    // A foreign outlet: what its article reports in Dutch (backend digest), no guesses of the summary,
    // no foreign "aanwijzing"
    await expect(balloon.getByText(/^Ook in Vlaanderen stuit NordVind op verzet/)).toBeVisible();
    await expect(balloon.getByText(/De Vlaamse VRT meldt/)).toHaveCount(0);
    await expect(balloon.getByText("Aanwijzingen bij VRT NWS")).toHaveCount(0);
    await page.keyboard.press("Escape");

    // An English headline has no clear lean: honestly "nog niet ingedeeld"
    await picker.getByRole("button", { name: "Deutsche Welle", exact: true }).click();
    const dw = bubbles(page).getByRole("button", { name: "Deutsche Welle, nog niet ingedeeld" });
    await expect(dw).toBeVisible();
    await expect(bubbles(page).getByText("Nog niet ingedeeld", { exact: true })).toBeVisible();
    // ... and its balloon says what it wrote, in Dutch, without explanations or clues
    await dw.click();
    const dwBalloon = page.getByRole("dialog", { name: "Over Deutsche Welle" });
    const gist = dwBalloon.getByRole("button", { name: /^NordVind breidt uit naar Nederland/ });
    await expect(gist).toBeVisible();
    await expect(dwBalloon.getByText(/invalshoek ingedeeld|Hieronder staat|Aanwijzingen bij|alleen de kop/)).toHaveCount(0);

    // Tap the article: a bigger panel with the gist and the original headline
    await gist.click();
    const sheet = page.getByRole("dialog", { name: /^Deutsche Welle/ });
    await expect(sheet.getByText("Wat staat erin?")).toBeVisible();
    await expect(sheet.getByText(/Dijkerhoven het eerste Nederlandse project/)).toBeVisible();
    await expect(sheet.getByText("In eigen woorden samengevat door de analyse.")).toBeVisible();
    await expect(sheet.getByText("German wind developer NordVind expands in the Netherlands")).toBeVisible();
    await page.goBack();
    await expect(sheet).toBeHidden();
  });

  test("has no horizontal overflow and big enough tap targets", async ({ page }, testInfo) => {
    await openDemo(page);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    if (testInfo.project.name === "desktop-chrome") return;
    const small = await page.evaluate(() =>
      Array.from(document.querySelectorAll('[data-explore] button, [data-explore] a'))
        .map((el) => el.getBoundingClientRect())
        .filter((rect) => rect.width > 0 && rect.height > 0 && (rect.width < 32 || rect.height < 32)).length,
    );
    expect(small).toBe(0);
  });

  test("drags a bubble into the dossier", async ({ page, browserName }, testInfo) => {
    test.skip(browserName === "webkit", "CDP touch events are Chromium-only; covered by pixel-7");
    await openDemo(page);
    const bubble = bubbles(page).getByRole("button", { name: /^AD: / });
    // To the middle of the screen: the fixed dossier dock covers the bottom edge
    await bubble.evaluate((element) => element.scrollIntoView({ block: "center" }));
    const from = await bubble.boundingBox();
    const dock = await page.locator('[data-dropzone="dossier"]').boundingBox();
    if (!from || !dock) throw new Error("missing boxes");
    const start = { x: from.x + from.width / 2, y: from.y + from.height / 2 };
    const end = { x: dock.x + dock.width / 2, y: dock.y + dock.height / 2 };

    if (testInfo.project.name === "pixel-7") {
      const cdp = await page.context().newCDPSession(page);
      const touch = (type: "touchStart" | "touchMove" | "touchEnd", point?: { x: number; y: number }) =>
        cdp.send("Input.dispatchTouchEvent", { type, touchPoints: point ? [{ x: point.x, y: point.y }] : [] });
      await touch("touchStart", start);
      await page.waitForTimeout(400); // long-press activation (250 ms)
      for (let i = 1; i <= 12; i += 1) {
        await touch("touchMove", { x: start.x + ((end.x - start.x) * i) / 12, y: start.y + ((end.y - start.y) * i) / 12 });
        await page.waitForTimeout(16);
      }
      await touch("touchEnd");
    } else {
      await page.mouse.move(start.x, start.y);
      await page.mouse.down();
      for (let i = 1; i <= 12; i += 1) {
        await page.mouse.move(start.x + ((end.x - start.x) * i) / 12, start.y + ((end.y - start.y) * i) / 12);
      }
      await page.mouse.up();
    }
    await expect(page.getByText("Bewaard in je dossier: AD")).toBeVisible();
    await expect(page.locator('[data-dropzone="dossier"]')).toContainText("1");
  });
});
