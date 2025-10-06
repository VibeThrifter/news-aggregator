import { test, expect } from "@playwright/test";

test("@event-feed renders mocked event feed", async ({ page }) => {
  await page.route("**/api/v1/events", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        data: [
          {
            id: 101,
            slug: "mock-event",
            title: "Mock event met CSV-acties",
            description: "Geautomatiseerde testdata uit Playwright.",
            article_count: 4,
            first_seen_at: "2025-10-01T07:00:00Z",
            last_updated_at: "2025-10-01T11:00:00Z",
            spectrum_distribution: {
              mainstream: 2,
              links: 1,
              rechts: 1,
            },
          },
        ],
        meta: {
          last_updated_at: "2025-10-01T11:05:00Z",
          llm_provider: "Mistral",
          total_events: 1,
        },
      }),
    });
  });

  await page.goto("/");

  await expect(page.getByRole("heading", { name: "Mock event met CSV-acties" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Bekijk event" })).toHaveAttribute("href", "/event/mock-event");
  await expect(page.getByRole("link", { name: "Download CSV" })).toHaveAttribute(
    "href",
    expect.stringContaining("/api/v1/exports/events/101"),
  );
  await expect(page.getByText("Mistral")).toBeVisible();
});
