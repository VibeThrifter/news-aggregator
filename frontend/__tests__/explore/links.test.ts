import { linkHost, outletsLinking, sharedLinks } from "@/lib/explore/links";
import type { ExploreArticle } from "@/lib/explore/types";

function article(id: number, outletKey: string, links: string[]): ExploreArticle {
  return {
    id,
    title: `Artikel ${id}`,
    url: `https://${outletKey}.nl/${id}`,
    urlKey: `${outletKey}.nl/${id}`,
    fingerprint: `${outletKey}.nl/${id}`,
    outletKey,
    outletName: outletKey,
    publishedAt: null,
    isInternational: false,
    sourceCountry: "NL",
    digest: null,
    foundVoice: null,
    copy: null,
    links,
  };
}

const BRIEF = "https://www.rijksoverheid.nl/documenten/kamerstukken/2026/11/15/brief";
const POST = "https://x.com/PvanHouwelingen/status/21";

describe("sharedLinks", () => {
  it("keeps pages that more than one outlet links to, the most outlets first", () => {
    const links = sharedLinks([
      article(1, "nos", [BRIEF]),
      article(2, "nieuwrechts", [POST, BRIEF]),
      article(3, "ninefornews", [POST]),
      article(4, "dds", [POST, "https://www.maurice.nl/peiling"]),
    ]);
    expect(links.map((link) => [link.host, link.outletKeys])).toEqual([
      ["x.com", ["nieuwrechts", "ninefornews", "dds"]],
      ["rijksoverheid.nl", ["nos", "nieuwrechts"]],
    ]);
  });

  it("counts two articles of one outlet once", () => {
    expect(sharedLinks([article(1, "nos", [BRIEF]), article(2, "nos", [BRIEF])])).toEqual([]);
  });

  it("works for articles without links", () => {
    expect(sharedLinks([{ ...article(1, "nos", []), links: undefined }])).toEqual([]);
  });
});

describe("linkHost", () => {
  it("drops www", () => {
    expect(linkHost(BRIEF)).toBe("rijksoverheid.nl");
  });
});

describe("outletsLinking", () => {
  it("names each outlet once, in the order of its first article", () => {
    const articles = [article(1, "nos", [BRIEF]), article(2, "dds", [POST]), article(3, "nieuwrechts", [BRIEF]), article(4, "nos", [BRIEF])];
    expect(outletsLinking(articles, BRIEF)).toEqual(["nos", "nieuwrechts"]);
    expect(outletsLinking(articles, "https://elders.nl/")).toEqual([]);
  });
});
