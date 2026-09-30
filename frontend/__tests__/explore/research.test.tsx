import { render, screen } from "@testing-library/react";

import { ResearchStatusCard } from "@/components/explore/entity/ResearchStatus";
import { MiniEgoNetwork } from "@/components/explore/network/MiniEgoNetwork";
import { actorScene } from "@/lib/explore/actor-graph";
import { egoLayout } from "@/lib/explore/ego-layout";
import { DEMO_RESEARCH, demoCooccurrence } from "@/lib/explore/fixtures/demo-research";
import { bestMatch, compatibleMatches, mergeNeighborhoods } from "@/lib/explore/pm-graph";
import {
  actorHref,
  foundSummary,
  markRequested,
  researchCopy,
  researchTarget,
  resetRequested,
  resolveActorParams,
  skipReasonText,
  wasRequested,
} from "@/lib/explore/research";
import type { EntityResearch, PmNeighborhood, PmRelation } from "@/lib/types";

const row = (status: string, extra: Partial<EntityResearch> = {}): EntityResearch => ({
  entity_key: "person:x",
  name: "Jan Jansen",
  kind: "person",
  status,
  ...extra,
});

describe("research status copy", () => {
  it("has Dutch copy for every status and polls only while queued or running", () => {
    const statuses = ["nieuw", "niet_nodig", "overgeslagen", "wachtrij", "bezig", "klaar", "niets_gevonden", "twijfel", "fout"];
    const titles = statuses.map((status) => researchCopy(row(status)).title);
    expect(new Set(titles).size).toBe(statuses.length);
    expect(statuses.filter((status) => researchCopy(row(status)).polling)).toEqual(["nieuw", "wachtrij", "bezig"]);
    expect(researchCopy(row("wachtrij")).body).toContain("Jan Jansen");
  });

  it("explains why a name is skipped", () => {
    expect(researchCopy(row("overgeslagen", { status_reason: "prive" })).body).toBe("Privépersoon — wordt niet uitgezocht.");
    expect(skipReasonText(null, "prive")).toBe("Privépersoon — wordt niet uitgezocht.");
    expect(skipReasonText("buitenland")).toMatch(/Buitenlandse naam/);
    expect(skipReasonText("iets_onbekends")).toBe("Deze naam wordt niet uitgezocht.");
    expect(skipReasonText("Alleen genoemd als ooggetuige.")).toBe("Alleen genoemd als ooggetuige.");
  });

  it("summarises what was found", () => {
    expect(foundSummary({ relations: 3, auto_approved: 2, pending: 1 })).toBe("3 verbanden gevonden · 2 automatisch toegevoegd · 1 wacht op controle");
    expect(foundSummary({ relations: 1 })).toBe("1 verband gevonden");
    expect(researchCopy(row("klaar", { found: { relations: 0 } })).body).toBe("Geen verbanden gevonden.");
  });

  it("renders the status card", () => {
    render(<ResearchStatusCard row={DEMO_RESEARCH.find((item) => item.entity_key === "person:henk-de-boer") ?? null} name="Henk de Boer" />);
    expect(screen.getByRole("status")).toHaveTextContent("Privépersoon — wordt niet uitgezocht.");
    render(<ResearchStatusCard row={null} name="Piet" requesting />);
    expect(screen.getByText("Aanvragen…")).toBeInTheDocument();
  });
});

describe("research keys and actor pages", () => {
  it("uses the entity key for people and organisations only", () => {
    expect(researchTarget({ entity: { entity_key: "person:anouk-verbeek", kind: "person" }, panelKey: "anouk-verbeek", name: "Anouk Verbeek" })).toEqual({
      key: "person:anouk-verbeek",
      kind: "person",
    });
    expect(researchTarget({ entity: { entity_key: "place:dijkerhoven", kind: "place" }, panelKey: "dijkerhoven", name: "Dijkerhoven" })).toBeNull();
    expect(researchTarget({ entity: { entity_key: "group:boeren", kind: "group" }, panelKey: "boeren", name: "Boeren" })).toBeNull();
    expect(researchTarget({ panelKey: "org:nordvind", name: "NordVind" })).toEqual({ key: "org:nordvind", kind: "org" });
    expect(researchTarget({ panelKey: "rivm", name: "RIVM" })).toEqual({ key: "actor:rivm", kind: "unknown" });
    expect(researchTarget({ panelKey: "de-jonge", name: "Minister De Jonge", kindHint: "person" })).toEqual({ key: "person:jonge", kind: "person" });
  });

  it("builds and resolves actor links", () => {
    expect(actorHref("anouk-verbeek", { kind: "person", name: "Anouk Verbeek", demo: true })).toBe("/actor/anouk-verbeek?k=person&n=Anouk+Verbeek&demo=1");
    expect(actorHref("pm-11")).toBe("/actor/pm-11");

    const person = resolveActorParams("anouk-verbeek", { k: "person", n: "Anouk Verbeek" });
    expect(person).toMatchObject({ slug: "anouk-verbeek", pmId: null, kind: "person", name: "Anouk Verbeek", researchKeys: ["person:anouk-verbeek"] });
    expect(person.aliases).toEqual(["anouk-verbeek", "verbeek"]);

    const pm = resolveActorParams("pm-11", { n: "NOS" });
    expect(pm).toMatchObject({ pmId: 11, name: "NOS", aliases: ["nos"], researchKeys: [] });

    const bare = resolveActorParams("de-telegraaf");
    expect(bare.slug).toBe("de-telegraaf");
    expect(bare.name).toBe("De Telegraaf");
    expect(bare.researchKeys).toEqual(["person:de-telegraaf", "org:de-telegraaf", "actor:de-telegraaf"]);
  });

  it("remembers requests once per session", () => {
    resetRequested();
    expect(wasRequested("person:x")).toBe(false);
    markRequested("person:x");
    expect(wasRequested("person:x")).toBe(true);
    resetRequested();
  });

  it("picks the best compatible propaganda-model match", () => {
    const matches = [
      { alias: "verbeek", entity_id: 5, name: "Jan Verbeek", type: "persoon", degree: 9 },
      { alias: "anouk-verbeek", entity_id: 7, name: "Anouk Verbeek", type: "persoon", degree: 2 },
      { alias: "anouk-verbeek", entity_id: 8, name: "Verbeek BV", type: "bedrijf", degree: 30 },
    ];
    expect(compatibleMatches(matches, "person").map((match) => match.entity_id)).toEqual([5, 7]);
    expect(bestMatch(compatibleMatches(matches, "person"), ["anouk-verbeek", "verbeek"])?.entity_id).toBe(7);
    expect(bestMatch([matches[0], { ...matches[1], alias: "anouk" }], ["anouk-verbeek", "verbeek", "anouk"])?.entity_id).toBe(5);
    expect(bestMatch([], ["x"])).toBeNull();
  });

  it("lists who appears in the same demo news, never private persons", () => {
    const rows = demoCooccurrence(["anouk-verbeek"]);
    const names = rows.map((item) => item.name);
    expect(names).toEqual(expect.arrayContaining(["NordVind", "Nationale Adviesraad Windenergie", "Stichting Stille Polder"]));
    expect(names).not.toContain("Anouk Verbeek");
    expect(names).not.toContain("Henk de Boer");
    expect(demoCooccurrence(["nordvind"]).find((item) => item.name === "Anouk Verbeek")?.last_event_slug).toBe("demo");
  });
});

const rel = (id: number, source: number, target: number, type: string, filter: string, extra: Partial<PmRelation> = {}): PmRelation => ({
  id,
  source_id: source,
  target_id: target,
  relation_type: type,
  filter,
  source_count: 1,
  ...extra,
});

const hood: PmNeighborhood = {
  center: { id: 1, name: "DPG Media", type: "mediaorganisatie", degree: 12 },
  entities: Array.from({ length: 12 }, (_, i) => ({ id: 10 + i, name: `Buur ${String.fromCharCode(65 + i)}`, type: i % 2 ? "persoon" : "bedrijf", degree: i })),
  relations: [
    ...Array.from({ length: 12 }, (_, i) => rel(100 + i, i % 3 ? 1 : 10 + i, i % 3 ? 10 + i : 1, i % 2 ? "personeel" : "eigendom", i % 2 ? "sourcing" : "eigendom")),
    // A second, less informative relation with neighbour 10: only one line per neighbour
    rel(200, 1, 10, "lidmaatschap", "ideologie", { auto_approved: true }),
  ],
  total: 13,
  truncated: false,
};

describe("mini ego-network", () => {
  it("is deterministic and shows at most ten neighbours", () => {
    const a = egoLayout(hood);
    const shuffled = { ...hood, entities: [...hood.entities].reverse(), relations: [...hood.relations].reverse() };
    expect(egoLayout(shuffled)).toEqual(a);
    expect(a.nodes).toHaveLength(10);
    expect(a.hidden).toBe(2);
    expect(new Set(a.nodes.map((node) => node.id)).size).toBe(10);
    // Most informative relation types first; starts at the top of the circle
    expect(a.nodes[0].relation.relation_type).toBe("eigendom");
    expect(a.nodes[0].x).toBe(a.size / 2);
    expect(a.nodes.find((node) => node.id === 10)?.relation.id).toBe(100);
  });

  it("renders an SVG with an accessible list of relations", () => {
    render(<MiniEgoNetwork hood={hood} />);
    expect(screen.getByRole("img", { name: /Netwerk van DPG Media: 10 van 13 verbanden/ })).toBeInTheDocument();
    const list = screen.getByRole("list", { name: "Verbanden van DPG Media" });
    expect(list.querySelectorAll("a")).toHaveLength(10);
    expect(list.querySelector("a")?.getAttribute("href")).toMatch(/^\/actor\/pm-\d+/);
    expect(screen.getByText(/De 10 belangrijkste van 13 verbanden/)).toBeInTheDocument();
  });
});

describe("actor page network scene", () => {
  it("draws the actor, its neighbours and what expanded nodes add, with a cap", () => {
    const merged = mergeNeighborhoods([hood]);
    const scene = actorScene(merged, 1, new Set([1]));
    expect(scene.nodes.find((node) => node.isCenter)?.label).toBe("DPG Media");
    expect(scene.nodes).toHaveLength(13);
    expect(scene.edges.every((edge) => edge.source.startsWith("pm:") && edge.target.startsWith("pm:"))).toBe(true);
    expect(scene.edges.find((edge) => edge.relationId === 200)?.autoApproved).toBe(true);

    const capped = actorScene(merged, 1, new Set([1]), { maxNodes: 5 });
    expect(capped.nodes).toHaveLength(5);
    expect(capped.hidden).toBe(8);
    // Most connected neighbours first
    expect(capped.nodes.filter((node) => !node.isCenter).map((node) => node.pmId)).toEqual([21, 20, 19, 18]);

    const hiddenEigendom = actorScene(merged, 1, new Set([1]), { hiddenFilters: new Set(["eigendom"]) });
    expect(hiddenEigendom.edges.some((edge) => edge.filter === "eigendom")).toBe(false);
    expect(actorScene(merged, 999, new Set())).toEqual({ nodes: [], edges: [], hidden: 0 });
  });
});
