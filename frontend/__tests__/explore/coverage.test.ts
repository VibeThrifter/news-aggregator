import { coverageByOutlet, nameAliases } from "@/lib/explore/coverage";
import type { EntityArticleGroup } from "@/lib/types";

const article = (id: number, source: string, date: string) => ({
  id,
  title: `Artikel ${id}`,
  url: `https://example.org/${id}`,
  source_name: source,
  published_at: date,
});

describe("wie schreef erover", () => {
  it("groups the articles by outlet: most articles first, newest first, each with its news item", () => {
    const groups: EntityArticleGroup[] = [
      {
        event_id: 1,
        event_slug: "een",
        event_title: "Eerste nieuws",
        event_last_updated_at: null,
        mention_count: 3,
        articles: [article(11, "NOS", "2026-09-01"), article(12, "De Telegraaf", "2026-09-02")],
      },
      {
        event_id: 2,
        event_slug: "twee",
        event_title: "Tweede nieuws",
        event_last_updated_at: null,
        mention_count: 2,
        articles: [article(21, "NOS", "2026-09-10"), article(11, "NOS", "2026-09-01")],
      },
    ];
    const outlets = coverageByOutlet(groups);
    expect(outlets.map((outlet) => [outlet.name, outlet.count])).toEqual([
      ["NOS", 2],
      ["De Telegraaf", 1],
    ]);
    expect(outlets[0].articles.map((item) => item.id)).toEqual([21, 11]);
    expect(outlets[0].articles[0]).toMatchObject({ event_id: 2, event_slug: "twee", event_title: "Tweede nieuws" });
    // An article in two news items counts once (with the first one)
    expect(outlets[0].articles[1]).toMatchObject({ event_id: 1, event_title: "Eerste nieuws" });
    expect(coverageByOutlet([])).toEqual([]);
  });

  it("finds a propaganda-model name among the news entities by its variants", () => {
    expect(nameAliases("AD (Algemeen Dagblad)")).toEqual(["ad-algemeen-dagblad", "algemeen-dagblad", "ad"]);
    expect(nameAliases("NOS")).toEqual(["nos"]);
  });
});
