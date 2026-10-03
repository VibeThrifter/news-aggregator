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
  test("asks one question per node instead of unfolding everything", async ({ page }) => {
    await page.goto("/event/demo/netwerk");
    await expect(page.getByText("Dit nieuws", { exact: true })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText("NOS", { exact: true }).first()).toBeVisible();
    await expect(page.getByText(/Bron: Propagandamodel/)).toBeVisible();

    // Tap a node: a compact tooltip with questions (no "Breid uit" that unfolds everything)
    const telegraaf = page.locator(".react-flow__node").filter({ hasText: /^De Telegraaf$/ });
    await telegraaf.click();
    const tip = page.getByRole("dialog", { name: "De Telegraaf" });
    // Two questions per filter, side by side: who has influence on it, and on whom it has influence
    const questions = tip.getByRole("table", { name: "Vragen" });
    await expect(questions.getByRole("button", { name: /^Wie heeft invloed op De Telegraaf via / }).first()).toBeVisible();
    await expect(questions.getByRole("button", { name: /^Op wie heeft De Telegraaf invloed via / }).first()).toBeVisible();
    await expect(tip.getByRole("button", { name: /^Breid uit/ })).toHaveCount(0);

    // A question along a filter that is off by default: that filter switches on, a few parties join
    const flakLegend = page.getByRole("button", { name: "Flak", exact: true });
    await expect(flakLegend).toHaveAttribute("aria-pressed", "false");
    const nodes = page.locator(".react-flow__node");
    await expect.poll(() => nodes.count()).toBeGreaterThan(0);
    const before = await nodes.count();
    await questions.getByRole("button", { name: /^Wie heeft invloed op De Telegraaf via Flak\? \d+$/ }).click();
    await expect(tip).toBeHidden();
    await expect(flakLegend).toHaveAttribute("aria-pressed", "true");
    await expect.poll(() => nodes.count()).toBeGreaterThan(before);
    // At most three parties per question, plus one more node (the last party, or a bundle for the rest),
    // plus parties that link two drawn nodes (in the demo: Mediahuis, owner of De Telegraaf and GeenStijl)
    expect((await nodes.count()) - before).toBeLessThanOrEqual(5);

    // Undo and redo that question
    const grown = await nodes.count();
    await page.getByRole("button", { name: "Ongedaan maken" }).click();
    await expect.poll(() => nodes.count()).toBe(before);
    await page.getByRole("button", { name: "Opnieuw", exact: true }).click();
    await expect.poll(() => nodes.count()).toBe(grown);
    await expect(page.getByRole("button", { name: "Opnieuw", exact: true })).toBeDisabled();

    // Asked questions are ticked off (tap the name: a neighbour's label may overlap the circle)
    await telegraaf.getByText("De Telegraaf", { exact: true }).click();
    await expect(questions.getByRole("button", { name: /^Wie heeft invloed op De Telegraaf via Flak\? \d+$/ })).toBeDisabled();

    // Meer weten
    await tip.getByRole("button", { name: "Meer weten" }).click();
    await expect(page.getByRole("dialog").filter({ hasText: /Bron: Propagandamodel/ }).first()).toBeVisible();
  });

  test("keeps the rest of an asked question in a bundle you can open and take parties out of", async ({ page }) => {
    await page.goto("/event/demo/netwerk");
    await expect(page.getByText("Dit nieuws", { exact: true })).toBeVisible({ timeout: 20_000 });
    const nodes = page.locator(".react-flow__node");
    await nodes.filter({ hasText: /^NOS$/ }).click();
    await page.getByRole("dialog", { name: "NOS" }).getByRole("button", { name: /^Wie heeft invloed op NOS via Bronnen\? \d+$/ }).click();
    // The answers come in see-through: keep them all
    await page.getByRole("group", { name: "Nieuw in het netwerk" }).getByRole("button", { name: "Houd alle" }).click();
    await expect(page.locator('.react-flow__node:has([data-pending="true"])')).toHaveCount(0);

    // Not every source NOS ever used: the three most specific are drawn, the rest is one bundle
    const bundle = nodes.filter({ hasText: /^\+\d+\s*Bronnen$/ });
    await expect(bundle).toHaveCount(1);
    const countOf = async () => Number((await bundle.innerText()).match(/\+(\d+)/)?.[1] ?? 0);
    const count = await countOf();
    expect(count).toBeGreaterThan(20);
    await bundle.click();
    const tip = page.getByRole("dialog", { name: `Nog ${count} via Bronnen · invloed op NOS` });
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

  test("shows what a question adds see-through: tap what stays, the rest goes", async ({ page }) => {
    await page.goto("/event/demo/netwerk");
    await expect(page.getByText("Dit nieuws", { exact: true })).toBeVisible({ timeout: 20_000 });
    const nodes = page.locator(".react-flow__node");
    const ghosts = page.locator('.react-flow__node:has([data-pending="true"])');
    const ghostBundle = ghosts.filter({ hasText: /^\+\d+/ });
    const bar = page.getByRole("group", { name: "Nieuw in het netwerk" });
    await expect(page.getByText("Laden…", { exact: true })).toBeHidden();
    await expect(bar).toBeHidden();
    const before = await nodes.count();
    const askNos = async () => {
      await nodes.filter({ hasText: /^NOS$/ }).click();
      const question = page.getByRole("dialog", { name: "NOS" }).getByRole("button", { name: /^Wie heeft invloed op NOS via Bronnen\? \d+$/ });
      await expect(question).toBeEnabled();
      await question.click();
    };

    // The three most specific sources and the bundle with the rest come in see-through
    await askNos();
    await expect.poll(() => ghosts.count()).toBeGreaterThanOrEqual(2);
    await expect(ghostBundle).toHaveCount(1);
    await expect(bar.getByRole("button", { name: "Alles weg" })).toBeVisible();

    // Tap one: it stays and opens; the rest (the bundle too) stays see-through
    const party = ghosts.filter({ hasNotText: /^\+\d+/ }).first();
    const name = (await party.locator("span").last().innerText()).trim();
    await party.click();
    await expect(page.getByRole("dialog", { name })).toBeVisible();
    const kept = nodes.filter({ hasText: name });
    await expect(kept.locator('[data-pending="true"]')).toHaveCount(0);
    await expect(ghostBundle).toHaveCount(1);

    // Rest weg: everything you did not tap goes, the bundle too
    await bar.getByRole("button", { name: "Rest weg" }).click();
    await expect(ghosts).toHaveCount(0);
    await expect(bar).toBeHidden();
    await expect(kept).toHaveCount(1);
    await expect(nodes.filter({ hasText: /^\+\d+/ })).toHaveCount(0);
    expect(await nodes.count()).toBe(before + 1);

    // Undo brings them back see-through
    await page.getByRole("button", { name: "Ongedaan maken" }).click();
    await expect.poll(() => ghosts.count()).toBeGreaterThan(0);
    await page.getByRole("button", { name: "Opnieuw", exact: true }).click();
    await expect(ghosts).toHaveCount(0);

    // Asking again brings back what went, see-through; keep nothing and the picture stays as it was
    await askNos();
    await expect(ghostBundle).toHaveCount(1);
    await bar.getByRole("button", { name: "Alles weg" }).click();
    await expect(ghosts).toHaveCount(0);
    await expect.poll(() => nodes.count()).toBe(before + 1);

    // A question of which you keep nothing is withdrawn: the picture is as before, and you can ask it again
    const telegraaf = nodes.filter({ hasText: /^De Telegraaf$/ });
    await telegraaf.getByText("De Telegraaf", { exact: true }).click();
    const tip = page.getByRole("dialog", { name: "De Telegraaf" });
    await tip.getByRole("button", { name: /^Wie heeft invloed op De Telegraaf via Flak\? \d+$/ }).click();
    await expect.poll(() => ghosts.count()).toBeGreaterThan(0);
    await bar.getByRole("button", { name: "Alles weg" }).click();
    await expect.poll(() => nodes.count()).toBe(before + 1);
    await expect(page.getByRole("button", { name: "Flak", exact: true })).toHaveAttribute("aria-pressed", "false");
    await telegraaf.getByText("De Telegraaf", { exact: true }).click();
    await expect(tip.getByRole("button", { name: /^Wie heeft invloed op De Telegraaf via Flak\? \d+$/ })).toBeEnabled();
  });

  test("asks who has influence on a party, and on whom it has influence, as different questions", async ({ page }) => {
    await page.goto("/event/demo/netwerk");
    await expect(page.getByText("Dit nieuws", { exact: true })).toBeVisible({ timeout: 20_000 });
    const nodes = page.locator(".react-flow__node");
    const dpg = nodes.filter({ hasText: /DPG Media$/ }); // initials before the name
    await expect(dpg).toHaveCount(1);
    await dpg.getByText("DPG Media", { exact: true }).click();
    const tip = page.getByRole("dialog", { name: "DPG Media" });
    const ownersQuestion = tip.getByRole("button", { name: /^Wie heeft invloed op DPG Media via Eigendom\? \d+$/ });
    const titlesQuestion = tip.getByRole("button", { name: /^Op wie heeft DPG Media invloed via Eigendom\? \d+$/ });
    // Its owners and its titles are different answers; only others pay DPG Media (advertisers)
    const owners = Number((await ownersQuestion.innerText()).trim());
    const titles = Number((await titlesQuestion.innerText()).trim());
    expect(titles).toBeGreaterThan(owners);
    await expect(tip.getByRole("button", { name: /^Wie heeft invloed op DPG Media via Advertenties\? \d+$/ })).toBeVisible();
    await expect(tip.getByRole("button", { name: /^Op wie heeft DPG Media invloed via Advertenties\?/ })).toHaveCount(0);

    // What DPG Media owns: three titles see-through and a bundle the line runs to (from DPG Media)
    await titlesQuestion.click();
    const ghosts = page.locator('.react-flow__node:has([data-pending="true"])');
    await expect.poll(() => ghosts.count()).toBeGreaterThanOrEqual(2);
    const bundle = ghosts.filter({ hasText: /^\+\d+\s*Eigendom$/ });
    await expect(bundle).toHaveCount(1);
    await bundle.click();
    await expect(page.getByRole("dialog", { name: /^Nog \d+ via Eigendom · invloed van DPG Media$/ })).toBeVisible();

    // The other question stays open, the asked one is ticked off
    await page.keyboard.press("Escape");
    await page.getByRole("group", { name: "Nieuw in het netwerk" }).getByRole("button", { name: "Houd alle" }).click();
    await dpg.getByText("DPG Media", { exact: true }).click();
    await expect(titlesQuestion).toBeDisabled();
    await expect(ownersQuestion).toBeEnabled();
  });

  test("draws every person and organisation of the news, also those not in the model", async ({ page }) => {
    await page.goto("/event/demo/netwerk");
    await expect(page.getByText("Dit nieuws", { exact: true })).toBeVisible({ timeout: 20_000 });
    const nodes = page.locator(".react-flow__node");
    // In the model (Anouk Verbeek was found by "Wie is dit?" research) and not in the model
    await expect(nodes.filter({ hasText: /Anouk Verbeek$/ })).toHaveCount(1);
    await expect(nodes.filter({ hasText: /NordVind$/ })).toHaveCount(1);
    await expect(nodes.filter({ hasText: /Stichting Stille Polder$/ })).toHaveCount(1);
    // A private resident is never drawn
    await expect(nodes.filter({ hasText: /Henk de Boer$/ })).toHaveCount(0);

    await nodes.filter({ hasText: /NordVind$/ }).click();
    const tip = page.getByRole("dialog", { name: "NordVind" });
    await expect(tip.getByText(/niet in het propagandamodel · wordt nu uitgezocht/)).toBeVisible();
    await expect(tip.getByRole("group")).toHaveCount(0); // no questions: it is not in the model
    await tip.getByRole("button", { name: "Meer weten" }).click();
    await expect(page.getByRole("dialog").filter({ hasText: "Netwerk & onderzoek" }).getByText("Wordt nu uitgezocht")).toBeVisible();
  });

  test("finds routes between two parties instead of drawing everything around one", async ({ page }) => {
    await page.goto("/event/demo/netwerk");
    await expect(page.getByText("Dit nieuws", { exact: true })).toBeVisible({ timeout: 20_000 });
    const nodes = page.locator(".react-flow__node");
    await expect.poll(() => nodes.count()).toBeGreaterThan(1);

    // Zoek verband met …: only the other party and what lies between them join the graph
    const before = await nodes.count();
    await nodes.filter({ hasText: /^NOS$/ }).click();
    const tip = page.getByRole("dialog", { name: "NOS" });
    await tip.getByRole("button", { name: "Zoek verband met…" }).click();
    // A party that is not in the starting view (DPG Media already is: it links the news' outlets)
    const target = nodes.filter({ hasText: /BlackRock$/ });
    await expect(target).toHaveCount(0);
    await tip.getByRole("textbox", { name: /^Verband tussen NOS en/ }).fill("BlackRock");
    await tip.getByRole("button", { name: /BlackRock/ }).first().click();
    await expect(tip).toBeHidden();
    // Propaganda-model nodes show initials before the name
    await expect(target).toHaveCount(1);
    const grown = await nodes.count();
    expect(grown).toBeGreaterThan(before);
    expect(grown - before).toBeLessThanOrEqual(1 + 3 * 2); // the party + at most two stations on each of three routes

    // One step to undo
    await page.getByRole("button", { name: "Ongedaan maken" }).click();
    await expect.poll(() => nodes.count()).toBe(before);
    await expect(target).toHaveCount(0);

    // Verbind met beeld: routes to what is on screen, or an honest "no route"
    await nodes.filter({ hasText: /^GeenStijl$/ }).click();
    const geenstijl = page.getByRole("dialog", { name: "GeenStijl" });
    await geenstijl.getByRole("button", { name: "Verbind met beeld" }).click();
    await expect
      .poll(async () => (await geenstijl.isHidden()) || (await geenstijl.getByText(/^Geen verband binnen drie stappen/).isVisible()))
      .toBe(true);
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

  test("the network is the propaganda model only, and focus=outlet: works", async ({ page }) => {
    await page.goto("/event/demo/netwerk?focus=outlet:nu-nl");
    await expect(page.getByText("Dit nieuws", { exact: true })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole("radio", { name: "Actoren" })).toHaveCount(0);
    await expect(page.getByText(/verborgen/)).toHaveCount(0);
  });
});

test.describe("Bewaard", () => {
  test("collects items, suggests and makes connections", async ({ page }) => {
    // Save NordVind (entity) from the demo
    await page.goto("/event/demo?p=entiteit:nordvind");
    await page.getByRole("dialog").getByRole("button", { name: "Bewaar", exact: true }).last().click();
    await expect(page.getByText(/^Bewaard: /)).toBeVisible();

    // Save a claim about NordVind's outlet from the list
    await page.goto("/event/demo");
    await page.getByRole("tab", { name: /^Klopt het\?/ }).click();
    const row = page.locator("li[id^='finding-']").filter({ hasText: "miljoenen" }).first();
    await row.getByRole("button", { name: "Openklappen" }).click();
    await row.getByRole("button", { name: "Bewaar" }).click();
    await expect(page.getByText(/^Bewaard: /)).toBeVisible();
    await page.waitForLoadState("networkidle");

    await page.goto("/onderzoek");
    await expect(page.getByText("2 bewaard · 0 verbanden")).toBeVisible();
    await page.getByRole("button", { name: "Toon als lijst" }).click();
    await expect(page.getByText("Claim zonder bewijs").first()).toBeVisible();
  });

  test("shows an empty board with recently explored events", async ({ page }) => {
    await page.goto("/event/demo");
    await expect(page.getByRole("heading", { level: 1, name: "Windpark Dijkerhoven splijt dorp en Den Haag" })).toBeVisible();
    await page.goto("/onderzoek");
    await expect(page.getByText("Nog niets bewaard")).toBeVisible();
    await expect(page.getByRole("link", { name: /Windpark Dijkerhoven splijt dorp en Den Haag/ })).toBeVisible();
  });
});
