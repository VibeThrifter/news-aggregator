import { test, expect } from "@playwright/test";

test("@event-detail renders event insights and article list", async ({ page }) => {
  await page.route("**/api/v1/events/mock-event", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        data: {
          id: 101,
          slug: "mock-event",
          title: "Mock event detail",
          description: "Detailpagina voor Playwright scenario.",
          article_count: 3,
          first_seen_at: "2025-10-01T07:00:00Z",
          last_updated_at: "2025-10-01T11:00:00Z",
          spectrum_distribution: {
            mainstream: 2,
            links: 1,
          },
          articles: [
            {
              id: 1,
              title: "Artikel A",
              url: "https://example.com/a",
              source: "NOS",
              spectrum: "mainstream",
              published_at: "2025-10-01T07:30:00Z",
            },
            {
              id: 2,
              title: "Artikel B",
              url: "https://example.com/b",
              source: "NU.nl",
              spectrum: "links",
              published_at: "2025-10-01T08:00:00Z",
            },
          ],
          insights_status: "voltooid",
          insights_generated_at: "2025-10-01T11:05:00Z",
          llm_provider: "Mistral",
        },
        meta: {
          llm_provider: "Mistral",
          insights_status: "voltooid",
        },
      }),
    });
  });

  await page.route("**/api/v1/insights/mock-event", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        data: {
          query: "mock",
          generated_at: "2025-10-01T11:05:00Z",
          llm_provider: "Mistral",
          timeline: [
            { time: "07:15", event: "Eerste melding" },
            { time: "08:45", event: "Nieuwe ontwikkeling" },
          ],
          clusters: [
            {
              angle: "Politieke respons",
              summary: "Analyse van reacties uit de Tweede Kamer.",
              sources: [
                { title: "NOS", url: "https://nos.nl", spectrum: "mainstream" },
                { title: "De Correspondent", url: "https://decorrespondent.nl", spectrum: "links" },
              ],
            },
          ],
          fallacies: [
            {
              type: "Stroman",
              claim: "Tegenstander beweert iets niet gezegd.",
              explanation: "Artikel citeert een verkeerd standpunt zonder context.",
              sources: [{ title: "Voorbeeldbron", url: "https://voorbeeld.nl", spectrum: "alternatief" }],
            },
          ],
          contradictions: [
            {
              topic: "Aantal aanwezigen",
              claim_A: "Bron A noemt 10.000 demonstranten.",
              claim_B: "Bron B spreekt over 3.000 personen.",
              status: "open",
              source_A: { title: "Bron A", url: "https://bron-a.example" },
              source_B: { title: "Bron B", url: "https://bron-b.example" },
            },
          ],
        },
      }),
    });
  });

  await page.goto("/event/mock-event");

  await expect(page.getByRole("heading", { name: "Mock event detail" })).toBeVisible();
  await expect(page.getByText("Politieke respons")).toBeVisible();
  await expect(page.getByText("Stroman")).toBeVisible();
  await expect(page.getByText("Aantal aanwezigen")).toBeVisible();
  await expect(page.getByRole("link", { name: "Download CSV" })).toHaveAttribute(
    "href",
    expect.stringContaining("/api/v1/exports/events/101"),
  );
  await expect(page.getByRole("link", { name: "Artikel A" })).toBeVisible();
  await expect(page.getByText("Eerste melding")).toBeVisible();
});
