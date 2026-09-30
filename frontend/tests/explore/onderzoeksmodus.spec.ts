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

  test("shows the LLM title, the demo banner and closed speech bubbles", async ({ page }) => {
    await openDemo(page);
    await expect(page.getByText("Verzonnen voorbeeld.")).toBeVisible();
    await expect(page.getByText("Begin je onderzoek")).toBeVisible();
    const closed = bubbles(page).getByRole("button", { name: /tik om te onthullen/ });
    expect(await closed.count()).toBeGreaterThanOrEqual(8);
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

  test("tapping a bubble reveals its perspective, a second tap opens the balloon", async ({ page }) => {
    await openDemo(page);
    const telegraaf = bubbles(page).getByRole("button", { name: "De Telegraaf, tik om te onthullen" });
    await telegraaf.click();
    await expect(bubbles(page).getByText("Economische kans voor het dorp")).toBeVisible();
    await expect(page.getByText("1 van 59 aanwijzingen")).toBeVisible();

    await bubbles(page).getByRole("button", { name: /^De Telegraaf: / }).click();
    const balloon = page.getByRole("dialog", { name: "Over De Telegraaf" });
    await expect(balloon).toBeVisible();
    await expect(balloon.getByText("Aanwijzingen bij De Telegraaf")).toBeVisible();
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

    // Other news: per outlet (who wrote what) or per news item
    const elsewhere = sheet.getByRole("region", { name: "Ook in ander nieuws" });
    await expect(elsewhere.getByRole("radio", { name: "Per medium" })).toHaveAttribute("aria-checked", "true");
    await elsewhere.getByRole("button", { name: /^DW/ }).click();
    await expect(elsewhere.getByText("Dutch fishermen protest NordVind offshore park")).toBeVisible();
    await expect(elsewhere.getByRole("link", { name: /in: Protest tegen windpark op zee/ })).toBeVisible();
    await elsewhere.getByRole("radio", { name: "Per nieuwsitem" }).click();
    await expect(elsewhere.getByRole("link", { name: /^Protest tegen windpark op zee/ })).toBeVisible();

    // Search all articles
    await expect(sheet.getByRole("searchbox", { name: "Zoekterm voor alle artikelen" })).toHaveValue("NordVind");
    await sheet.getByRole("button", { name: "Zoek", exact: true }).click();
    await expect(sheet.getByText(/3 artikelen met “NordVind”/)).toBeVisible();
  });

  test("follows the trail to a related event", async ({ page }) => {
    await openDemo(page);
    await page.getByRole("link", { name: /Protest tegen windpark op zee bij Den Helder/ }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Protest tegen windpark op zee bij Den Helder" })).toBeVisible();
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
    const bubble = bubbles(page).getByRole("button", { name: "AD, tik om te onthullen" });
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
