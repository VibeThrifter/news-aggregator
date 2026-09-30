import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.route(/wikipedia\.org/, (route) => route.fulfill({ status: 404, contentType: "application/json", body: "{}" }));
  await page.addInitScript(() => {
    if (!sessionStorage.getItem("e2e-init")) {
      localStorage.clear();
      sessionStorage.setItem("e2e-init", "1");
    }
  });
});

test.describe("Netwerk", () => {
  test("explores the propaganda model step by step from this news", async ({ page }) => {
    await page.goto("/event/demo/netwerk");
    await expect(page.getByText("Dit nieuws", { exact: true })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText("NOS", { exact: true }).first()).toBeVisible();
    await expect(page.getByText(/Bron: Propagandamodel/)).toBeVisible();

    // Tap a node: a compact tooltip with "Breid uit"
    const telegraaf = page.locator(".react-flow__node").filter({ hasText: /^De Telegraaf$/ });
    await telegraaf.click();
    const tip = page.getByRole("dialog", { name: "De Telegraaf" });
    await expect(tip.getByRole("button", { name: /^Breid uit · \d+$/ })).toBeVisible();

    // ▾: expand via one filter that is off by default; that filter switches on
    const flakLegend = page.getByRole("button", { name: "Flak", exact: true });
    await expect(flakLegend).toHaveAttribute("aria-pressed", "false");
    await tip.getByRole("button", { name: "Uitbreiden via één filter" }).click();
    await tip.getByRole("group", { name: "Alleen via" }).getByRole("button", { name: /^Flak · \d+$/ }).click();
    await expect(tip).toBeHidden();
    await expect(flakLegend).toHaveAttribute("aria-pressed", "true");

    // Expanding via the legend filters just grows the graph; everything stays clickable
    const nodes = page.locator(".react-flow__node");
    await expect.poll(() => nodes.count()).toBeGreaterThan(0);
    const before = await nodes.count();
    await telegraaf.click();
    await tip.getByRole("button", { name: /^Breid uit/ }).click();
    await expect.poll(() => nodes.count()).toBeGreaterThan(before);

    // Undo and redo that expansion
    const grown = await nodes.count();
    await page.getByRole("button", { name: "Ongedaan maken" }).click();
    await expect.poll(() => nodes.count()).toBeLessThan(grown);
    await page.getByRole("button", { name: "Opnieuw", exact: true }).click();
    await expect.poll(() => nodes.count()).toBe(grown);
    await expect(page.getByRole("button", { name: "Opnieuw", exact: true })).toBeDisabled();

    // Meer weten
    await telegraaf.click();
    await tip.getByRole("button", { name: "Meer weten" }).click();
    await expect(page.getByRole("dialog").filter({ hasText: /Bron: Propagandamodel/ }).first()).toBeVisible();
  });

  test("keeps the rest of an expanded node in a bundle you can open and take parties out of", async ({ page }) => {
    await page.goto("/event/demo/netwerk");
    await expect(page.getByText("Dit nieuws", { exact: true })).toBeVisible({ timeout: 20_000 });
    const nodes = page.locator(".react-flow__node");
    await nodes.filter({ hasText: /^NOS$/ }).click();
    await page.getByRole("dialog", { name: "NOS" }).getByRole("button", { name: /^Breid uit/ }).click();

    // Not every source NOS ever used: the best connected few are drawn, the rest is one bundle
    const bundle = nodes.filter({ hasText: /^\+\d+\s*Bronnen$/ });
    await expect(bundle).toHaveCount(1);
    const countOf = async () => Number((await bundle.innerText()).match(/\+(\d+)/)?.[1] ?? 0);
    const count = await countOf();
    expect(count).toBeGreaterThan(20);
    await bundle.click();
    const tip = page.getByRole("dialog", { name: `Nog ${count} via Bronnen` });
    await expect(tip.getByText("Met wie?")).toBeVisible();
    await expect(tip.getByRole("group", { name: "Soort partij" }).getByRole("button").first()).toBeVisible();
    await expect(tip.getByText(/^Hoe:/)).toBeVisible();

    // Take one out: it joins the graph and opens, the bundle shrinks; undo puts it back
    const before = await nodes.count();
    const row = tip.getByRole("listitem").first().getByRole("button").first();
    const name = (await row.locator("span.font-semibold").first().innerText()).trim();
    await row.click();
    await expect(page.getByRole("dialog", { name })).toBeVisible();
    await expect.poll(() => nodes.count()).toBe(before + 1);
    await expect.poll(countOf).toBeLessThan(count);
    await page.getByRole("button", { name: "Ongedaan maken" }).click();
    await expect.poll(() => nodes.count()).toBe(before);
    await expect.poll(countOf).toBe(count);
  });

  test("edges explain the relation in a tooltip and show their direction", async ({ page, isMobile }) => {
    await page.goto("/event/demo/netwerk");
    await expect(page.getByText("Dit nieuws", { exact: true })).toBeVisible({ timeout: 20_000 });
    await page.waitForTimeout(800); // fit animation
    await expect(page.locator('.react-flow__edge[data-id^="pmrel:"] path[marker-end]').first()).toBeAttached();

    // A point on a relation line that is not covered by a node
    const point = await page.evaluate(() => {
      for (const edge of Array.from(document.querySelectorAll<SVGGElement>('.react-flow__edge[data-id^="pmrel:"]'))) {
        const path = edge.querySelector<SVGPathElement>("path.react-flow__edge-path");
        if (!path) continue;
        // Straight lines: the middle of the bounding box is on the line (getScreenCTM ignores CSS transforms in WebKit)
        const box = path.getBoundingClientRect();
        const x = box.left + box.width / 2;
        const y = box.top + box.height / 2;
        const hit = document.elementFromPoint(x, y);
        if (hit && edge.contains(hit) && y > 200) return { x, y };
      }
      return null;
    });
    expect(point).not.toBeNull();

    if (!isMobile) {
      await page.mouse.move(point!.x, point!.y);
      await expect(page.getByRole("tooltip", { name: "Verband in het propagandamodel" })).toBeVisible();
    }
    await page.mouse.click(point!.x, point!.y);
    const tip = page.getByRole("dialog", { name: "Verband in het propagandamodel" });
    await expect(tip.getByRole("button", { name: "Meer weten" })).toBeVisible();
    await tip.getByRole("button", { name: "Meer weten" }).click();
    await expect(page.getByRole("dialog").filter({ hasText: /Verband in het propagandamodel/ }).filter({ hasText: /Bron: Propagandamodel/ })).toBeVisible();
  });

  test("filters can be switched off and the five filters sheet shows evidence", async ({ page }) => {
    await page.goto("/event/demo/netwerk");
    await expect(page.getByText("Dit nieuws", { exact: true })).toBeVisible({ timeout: 20_000 });
    const eigendom = page.getByRole("button", { name: "Eigendom" });
    await eigendom.click();
    await expect(eigendom).toHaveAttribute("aria-pressed", "false");
    await page.getByRole("button", { name: "De vijf filters in dit nieuws" }).click();
    const sheet = page.getByRole("dialog").filter({ hasText: "De filters in dit nieuws" });
    await expect(sheet.getByText("Een Blik op de NOS levert kritiek op NOS")).toBeVisible();
    await expect(sheet.getByText("In het netwerk").first()).toBeVisible();
  });

  test("event lenses show discovered things and ghosts for what is still hidden", async ({ page }) => {
    await page.goto("/event/demo/netwerk?lens=tegenspraak");
    const ghost = page.locator(".react-flow__node").filter({ hasText: /verborgen · Wat klopt er niet\?/ });
    await expect(ghost).toBeVisible({ timeout: 20_000 });
    await ghost.click();
    await page.getByRole("button", { name: "Open het spoor" }).click();
    await expect(page.getByRole("dialog").filter({ hasText: "Wat klopt er niet?" })).toBeVisible();
  });
});

test.describe("Onderzoeksbord", () => {
  test("collects cards from two events, suggests and makes connections", async ({ page }) => {
    // Save NordVind from the first event
    await page.goto("/event/demo?p=entiteit:nordvind");
    await page.getByRole("button", { name: "Bewaar in dossier" }).click();
    await expect(page.getByText(/Bewaard in je dossier/)).toBeVisible();

    // Save the NordVind authority clue from the related event
    await page.goto("/event/demo-2?p=spoor:wie-heeft-belang");
    const sheet = page.getByRole("dialog").filter({ hasText: "Wie heeft er belang bij?" });
    await sheet.getByRole("button", { name: /Wie is NordVind\?/ }).click();
    await sheet.getByRole("button", { name: "Bewaar in dossier" }).first().click();
    await expect(page.getByText(/Bewaard in je dossier/)).toBeVisible();

    await page.goto("/onderzoek");
    await expect(page.getByText("2 kaarten · 0 verbanden")).toBeVisible();
    await expect(page.getByText(/1 mogelijke verband/)).toBeVisible();

    await page.getByRole("button", { name: "Toon als lijst" }).click();
    await page.getByRole("button", { name: /^NordVind/ }).first().click();
    await page.getByRole("button", { name: /Bronkritiek|NordVind/ }).last().click();
    await page.getByRole("button", { name: "zelfde eigenaar" }).click();
    await expect(page.getByText("2 kaarten · 1 verbanden")).toBeVisible();
  });

  test("shows an empty board with recently explored events", async ({ page }) => {
    await page.goto("/event/demo");
    await expect(page.getByRole("heading", { level: 1, name: "Windpark Dijkerhoven splijt dorp en Den Haag" })).toBeVisible();
    await page.goto("/onderzoek");
    await expect(page.getByText("Je bord is nog leeg")).toBeVisible();
    await expect(page.getByRole("link", { name: /Windpark Dijkerhoven splijt dorp en Den Haag/ })).toBeVisible();
  });
});
