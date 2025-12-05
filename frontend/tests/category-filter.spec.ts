import { test, expect } from "@playwright/test";

test.describe("Category Filter Navigation", () => {
  const mockEvents = [
    {
      id: 1,
      slug: "politiek-event",
      title: "Kabinet presenteert nieuwe plannen",
      description: "Belangrijke politieke ontwikkeling.",
      article_count: 5,
      first_seen_at: "2025-10-01T07:00:00Z",
      last_updated_at: "2025-10-01T11:00:00Z",
      event_type: "politics",
      spectrum_distribution: { mainstream: 3, links: 1, rechts: 1 },
    },
    {
      id: 2,
      slug: "sport-event",
      title: "Ajax wint topper tegen Feyenoord",
      description: "Spannende voetbalwedstrijd.",
      article_count: 8,
      first_seen_at: "2025-10-02T14:00:00Z",
      last_updated_at: "2025-10-02T18:00:00Z",
      event_type: "sports",
      spectrum_distribution: { mainstream: 6, links: 1, rechts: 1 },
    },
    {
      id: 3,
      slug: "misdaad-event",
      title: "Politie arresteert verdachte",
      description: "Doorbraak in onderzoek.",
      article_count: 3,
      first_seen_at: "2025-10-03T09:00:00Z",
      last_updated_at: "2025-10-03T12:00:00Z",
      event_type: "crime",
      spectrum_distribution: { mainstream: 2, links: 0, rechts: 1 },
    },
  ];

  test.beforeEach(async ({ page }) => {
    // Mock Supabase API responses
    await page.route("**/rest/v1/events**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(mockEvents),
      });
    });
  });

  test("@category-filter shows category navigation bar", async ({ page }) => {
    await page.goto("/");

    // Check that category navigation is visible
    const nav = page.getByRole("navigation", { name: "Categoriefilter" });
    await expect(nav).toBeVisible();

    // Check that "Alles" tab is present and selected by default
    const allesTab = page.getByRole("tab", { name: "Alles" });
    await expect(allesTab).toBeVisible();
    await expect(allesTab).toHaveAttribute("aria-selected", "true");

    // Check that other category tabs are present
    await expect(page.getByRole("tab", { name: "Politiek" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "Sport" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "Misdaad" })).toBeVisible();
  });

  test("@category-filter shows all events when 'Alles' is selected", async ({ page }) => {
    await page.goto("/");

    // Wait for events to load
    await expect(page.getByText("Kabinet presenteert nieuwe plannen")).toBeVisible();
    await expect(page.getByText("Ajax wint topper tegen Feyenoord")).toBeVisible();
    await expect(page.getByText("Politie arresteert verdachte")).toBeVisible();
  });

  test("@category-filter filters events when category is clicked", async ({ page }) => {
    await page.goto("/");

    // Wait for events to load
    await expect(page.getByText("Kabinet presenteert nieuwe plannen")).toBeVisible();

    // Click on Sport category
    await page.getByRole("tab", { name: "Sport" }).click();

    // Check URL contains category parameter
    await expect(page).toHaveURL(/\?category=sports/);

    // Sport tab should now be selected
    await expect(page.getByRole("tab", { name: "Sport" })).toHaveAttribute("aria-selected", "true");
    await expect(page.getByRole("tab", { name: "Alles" })).toHaveAttribute("aria-selected", "false");

    // Only sports event should be visible
    await expect(page.getByText("Ajax wint topper tegen Feyenoord")).toBeVisible();
    await expect(page.getByText("Kabinet presenteert nieuwe plannen")).not.toBeVisible();
    await expect(page.getByText("Politie arresteert verdachte")).not.toBeVisible();
  });

  test("@category-filter shows category badge on event cards", async ({ page }) => {
    await page.goto("/");

    // Wait for events to load
    await expect(page.getByText("Kabinet presenteert nieuwe plannen")).toBeVisible();

    // Check that category badges are visible
    const badges = page.getByTestId("category-badge");
    await expect(badges).toHaveCount(3);

    // Check specific category labels are displayed
    await expect(page.getByTestId("category-badge").filter({ hasText: "Politiek" })).toBeVisible();
    await expect(page.getByTestId("category-badge").filter({ hasText: "Sport" })).toBeVisible();
    await expect(page.getByTestId("category-badge").filter({ hasText: "Misdaad" })).toBeVisible();
  });

  test("@category-filter updates URL when clicking different categories", async ({ page }) => {
    await page.goto("/");

    // Click Politics
    await page.getByRole("tab", { name: "Politiek" }).click();
    await expect(page).toHaveURL(/\?category=politics/);

    // Click Crime
    await page.getByRole("tab", { name: "Misdaad" }).click();
    await expect(page).toHaveURL(/\?category=crime/);

    // Click Alles (should remove category param)
    await page.getByRole("tab", { name: "Alles" }).click();
    await expect(page).not.toHaveURL(/category=/);
  });

  test("@category-filter shows empty state for category with no events", async ({ page }) => {
    await page.goto("/?category=weather");

    // Should show empty state message
    await expect(page.getByText(/Geen events in de categorie/)).toBeVisible();
    await expect(page.getByText(/Probeer een andere categorie/)).toBeVisible();
  });

  test("@category-filter keyboard navigation works", async ({ page }) => {
    await page.goto("/");

    // Focus on Alles tab
    const allesTab = page.getByRole("tab", { name: "Alles" });
    await allesTab.focus();

    // Press ArrowRight to move to next tab
    await page.keyboard.press("ArrowRight");
    await expect(page).toHaveURL(/\?category=politics/);

    // Press ArrowRight again
    await page.keyboard.press("ArrowRight");
    await expect(page).toHaveURL(/\?category=international/);

    // Press Home to go back to first tab
    await page.keyboard.press("Home");
    await expect(page).not.toHaveURL(/category=/);
  });
});
