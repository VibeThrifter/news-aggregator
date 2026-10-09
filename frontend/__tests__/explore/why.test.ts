import { findPaths } from "@/lib/explore/pm-paths";
import { eventActorAliases, eventOutletSeeds, followedOutletIds, matchActorIds } from "@/lib/explore/pm-seeds";
import type { ExploreInput } from "@/lib/explore/types";
import { hasEnded, labelSourceId, mechanismKey, pmRelationLabel, pmRelationReverseLabel, relationWords } from "@/lib/explore/labels";
import {
  behindParties,
  evidenceNames,
  governanceFilter,
  governanceRoutes,
  lineRelationIds,
  massTie,
  meaningfulRoute,
  readableRoute,
  specificParties,
  textNames,
  touchpoints,
  typeLookup,
  whoIsWho,
} from "@/lib/explore/why";
import type { PmArgument, PmEntity, PmMatch, PmRelation } from "@/lib/types";

// NU.nl and AD (both DPG), the NOS, the ANP as a hub, and NordVind that is in the news
const entities: PmEntity[] = [
  { id: 1, name: "NU.nl", type: "mediaorganisatie", degree: 3 },
  { id: 2, name: "AD", type: "mediaorganisatie", degree: 2 },
  { id: 3, name: "NOS", type: "omroep", degree: 1 },
  { id: 10, name: "DPG Media", type: "bedrijf", degree: 5 },
  { id: 11, name: "Sanoma", type: "bedrijf", degree: 2 },
  { id: 20, name: "ANP", type: "persbureau", degree: 60 },
  { id: 30, name: "NordVind", type: "bedrijf", degree: 3 },
];
const rel = (id: number, source_id: number, target_id: number, relation_type: string, extra: Partial<PmRelation> = {}): PmRelation => ({
  id,
  source_id,
  target_id,
  relation_type,
  source_count: 1,
  ...extra,
});
const relations: PmRelation[] = [
  rel(100, 10, 1, "eigendom", { certainty_label: "onderbouwd" }),
  rel(101, 10, 2, "eigendom"),
  rel(102, 30, 10, "adverteerder"),
  rel(103, 20, 1, "beinvloeding", { mechanism: "Pakketjournalistiek", filter: "sourcing" }),
  rel(104, 20, 2, "beinvloeding", { mechanism: "Pakketjournalistiek", filter: "sourcing" }),
  rel(105, 20, 3, "beinvloeding", { mechanism: "Pakketjournalistiek", filter: "sourcing" }),
  rel(106, 30, 20, "bron_van", { filter: "sourcing" }),
];
const at = "2026-10-01";

describe("the parties of a news item in the model", () => {
  it("takes the Dutch outlets with a model id, once each", () => {
    const input = {
      outlets: [
        { key: "nos", isInternational: false, profile: { pmEntityId: 11 } },
        { key: "bbc", isInternational: true, profile: { pmEntityId: 999 } },
        { key: "nieuwrechts", isInternational: false, profile: {} },
        { key: "nos-2", isInternational: false, profile: { pmEntityId: 11 } },
      ],
    } as unknown as Pick<ExploreInput, "outlets">;
    expect(eventOutletSeeds(input)).toEqual([{ id: 11, outletKey: "nos" }]);
    const followed = followedOutletIds();
    expect(followed).toEqual(expect.arrayContaining([11, 7, 3, 9]));
    expect(new Set(followed).size).toBe(followed.length);
  });

  it("matches people only to persons, organisations never to persons, authorities to anything", () => {
    const input = {
      entities: [
        { kind: "person", aliases: ["jan-jansen"] },
        { kind: "org", aliases: ["nordvind"] },
        { kind: "place", aliases: ["dijkerhoven"] },
      ],
      insight: { authority_analysis: [{ authority: "Centraal Planbureau (CPB)" }] },
    } as unknown as Pick<ExploreInput, "entities" | "insight">;
    const actors = eventActorAliases(input);
    expect(actors.map((actor) => actor.kind)).toEqual(["person", "org", null]);
    expect(actors[2].aliases).toEqual(expect.arrayContaining(["cpb", "centraal-planbureau"]));

    const matches: PmMatch[] = [
      { alias: "jan-jansen", entity_id: 50, name: "Jan Jansen", type: "persoon" },
      { alias: "jan-jansen", entity_id: 51, name: "Jan Jansen BV", type: "bedrijf" },
      { alias: "nordvind", entity_id: 30, name: "NordVind", type: "bedrijf" },
      { alias: "nordvind", entity_id: 52, name: "Nordvind", type: "persoon" },
      { alias: "cpb", entity_id: 60, name: "CPB (Centraal Planbureau)", type: "overheidsinstelling" },
    ];
    expect(matchActorIds(actors, matches)).toEqual([50, 30, 60]);
    // Outlets are never a party of their own news
    expect(matchActorIds(actors, matches, new Set([30]))).toEqual([50, 60]);
  });
});

describe("Waarom zo?", () => {
  const paths = findPaths(entities, relations, [1, 2, 3], [30], { at, maxHops: 2, limit: 2 });

  it("lists every followed outlet with a link to the news, the ones that brought it first", () => {
    const list = touchpoints(paths, [3]);
    expect(list.map((item) => [item.outletId, item.covered, item.routes.length])).toEqual([
      [3, true, 1],
      [1, false, 2],
      [2, false, 2],
    ]);
    expect(touchpoints(undefined, [3])).toEqual([]);
  });
});

// The news of the screenshot (2026-10-05): NOS, de Volkskrant and NU.nl, with RIVM and the PBL in it
const news: PmEntity[] = [
  { id: 11, name: "NOS", type: "omroep", degree: 9 },
  { id: 4, name: "de Volkskrant", type: "mediaorganisatie", degree: 9 },
  { id: 7, name: "NU.nl", type: "mediaorganisatie", degree: 9 },
  { id: 8, name: "RTL Nederland", type: "omroep", degree: 9 },
  { id: 1, name: "DPG Media", type: "mediaorganisatie", degree: 30 },
  { id: 82, name: "RIVM", type: "overheidsinstelling", degree: 12 },
  { id: 865, name: "Planbureau voor de Leefomgeving (PBL)", type: "overheidsinstelling", degree: 4 },
  { id: 900, name: "Marko Hekkert", type: "persoon", degree: 2 },
  { id: 901, name: "Nieuwsuur", type: "mediaorganisatie", degree: 3 },
  { id: 53, name: "VVD", type: "partij", degree: 40 },
  { id: 954, name: "Eelco Heinen", type: "persoon", degree: 2 },
];
const source = (id: number, from: number, to: number, mechanism: string, extra: Partial<PmRelation> = {}) =>
  rel(id, from, to, "beinvloeding", { mechanism, filter: "sourcing", ...extra });
const newsRelations: PmRelation[] = [
  source(143, 82, 11, "Bron afhankelijkheid", { certainty_label: "onzeker" }),
  source(220, 82, 4, "Bron afhankelijkheid"),
  source(144, 82, 8, "Bron afhankelijkheid"),
  source(432, 4, 8, "Intermedia-agendering"),
  source(1564, 865, 11, "Expert framing"),
  rel(1565, 900, 865, "personeel", { mechanism: "Denktank levert expert", filter: "sourcing" }),
  source(1803, 900, 11, "Expert legitimatie"),
  rel(1011, 11, 901, "mediaplatform", { mechanism: "Omroepsignatuur", filter: "ideologie" }),
  source(1579, 82, 901, "Expert framing"),
  source(145, 82, 1, "Bron afhankelijkheid"),
  rel(249, 1, 7, "beinvloeding", { mechanism: "Zelfcensuur", filter: "flak" }),
  rel(2282, 53, 954, "lidmaatschap", { mechanism: "Partijbinding", filter: "ideologie" }),
];
const name = (id: number) => news.find((entity) => entity.id === id)?.name;

describe("Wie zit erachter?", () => {
  const newsPaths = findPaths(news, newsRelations, [11, 4, 7], [82, 865], { at, maxHops: 2, limit: 3 });
  const byId = new Map(newsRelations.map((relation) => [relation.id, relation]));
  const route = (nodes: number[]) => newsPaths.routes.find((item) => item.nodes.join() === nodes.join());

  it("drops routes along which no influence reaches the outlet", () => {
    // De Volkskrant sets the agenda of RTL, RIVM is a source of RTL: nothing about the Volkskrant
    expect(meaningfulRoute(route([4, 8, 82])!, byId)).toBe(false);
    // Two kinds of influence on DPG Media without a tie of belonging to NU.nl
    expect(meaningfulRoute(route([7, 1, 82])!, byId)).toBe(false);
    // A programme of the NOS, a researcher of the PBL: stations that belong to one end
    expect(meaningfulRoute(route([11, 901, 82])!, byId)).toBe(true);
    expect(meaningfulRoute(route([11, 900, 865])!, byId)).toBe(true);
    expect(meaningfulRoute(route([11, 82])!, byId)).toBe(true);
    expect(meaningfulRoute({ nodes: [11, 82], relations: [999] }, byId)).toBe(false);
  });

  it("groups per party what reaches the outlets, read from the party", () => {
    const parties = behindParties(newsPaths, [11, 4, 7]);
    expect(parties.map((party) => [name(party.partyId), party.outletIds.map(name)])).toEqual([
      ["RIVM", ["NOS", "de Volkskrant"]],
      ["Planbureau voor de Leefomgeving (PBL)", ["NOS"]],
    ]);
    const words = parties.map((party) =>
      party.lines.map((line) =>
        [...line.lead, line.last[0]].map((step) => (step.forward ? pmRelationLabel(step.relation.relation_type, step.relation.mechanism) : pmRelationReverseLabel(step.relation.relation_type, step.relation.mechanism))).join(" › ") +
        ` › ${line.last.map((step) => name(step.to)).join(" + ")}`,
      ),
    );
    expect(words).toEqual([
      ["is vaste bron voor › NOS + de Volkskrant", "levert experts en analyses aan › verschijnt bij › NOS"],
      ["levert experts en analyses aan › NOS", "heeft als medewerker › treedt op als deskundige bij › NOS"],
    ]);
    // The step that carries the influence explains more than the tie of belonging
    expect(parties[1].lines[1].explain).toEqual([1803, 1565]);
    expect(parties[0].lines[0].explain).toEqual([143, 220]);
    expect(behindParties(null, [11])).toEqual([]);
    expect(behindParties(newsPaths, [])).toEqual([]);
  });

  it("splits and orders the lines by how well the model supports them", () => {
    // RIVM → NOS rests on a source, RIVM → de Volkskrant is disputed, RIVM → Nieuwsuur has nothing
    const ranks: Record<number, number> = { 143: 1, 220: 3, 1579: 5, 1564: 1, 1803: 1 };
    const parties = behindParties(newsPaths, [11, 4, 7], (id) => ranks[id]);
    expect(parties.map((party) => [name(party.partyId), party.lines.map((line) => [line.rank, line.last.map((step) => name(step.to)).join(" + ")])])).toEqual([
      [
        "RIVM",
        [
          [1, "NOS"],
          [3, "de Volkskrant"],
          [5, "NOS"],
        ],
      ],
      [
        "Planbureau voor de Leefomgeving (PBL)",
        [
          [1, "NOS"],
          [1, "NOS"],
        ],
      ],
    ]);
    // the expert line counts its influence (Hekkert at the NOS), not the tie of belonging
    expect(parties[1].lines[1].lead.map((step) => step.relation.id)).toEqual([1565]);
    // a party whose links are all weak comes after a better supported one
    const weakRivm = behindParties(newsPaths, [11, 4, 7], (id) => (id === 143 || id === 220 || id === 1579 ? 4 : ranks[id]));
    expect(weakRivm.map((party) => name(party.partyId))).toEqual(["Planbureau voor de Leefomgeving (PBL)", "RIVM"]);
    // unknown support (no arguments looked up) keeps lines together, as before
    expect(behindParties(newsPaths, [11, 4, 7], () => undefined)[0].lines[0].last).toHaveLength(2);
    expect(lineRelationIds(parties)).toEqual([143, 220, 1579, 1011, 1564, 1803, 1565]);
  });

  it("reads a route with the influence, arrows where it has a direction", () => {
    const typeOf = typeLookup(news);
    const direct = readableRoute(route([11, 82])!, byId, typeOf);
    expect(direct.map((step) => [name(step.from), step.flow, name(step.to)])).toEqual([["RIVM", "down", "NOS"]]);
    const expert = readableRoute(route([11, 900, 865])!, byId, typeOf);
    expect(expert.map((step) => [name(step.from), step.flow, name(step.to)])).toEqual([
      ["Planbureau voor de Leefomgeving (PBL)", "both", "Marko Hekkert"],
      ["Marko Hekkert", "down", "NOS"],
    ]);
    expect(readableRoute({ nodes: [11, 82], relations: [999] }, byId, typeOf)).toEqual([]);
  });
});

describe("Hoe hangen ze samen? (Epic 15)", () => {
  const entity = (id: number, name: string, type: string, degree: number): PmEntity => ({ id, name, type, degree });
  const entities = [
    entity(1, "Eelco Heinen", "persoon", 10),
    entity(2, "Ministerie van Financiën", "overheidsinstelling", 40),
    entity(3, "Belastingdienst", "overheidsinstelling", 12),
    entity(4, "Kamerlid A", "persoon", 4),
    entity(5, "Kamerlid B", "persoon", 4),
    entity(6, "Tweede Kamer", "overheidsinstelling", 160),
    entity(7, "DPG Media", "bedrijf", 30),
    entity(8, "AD", "mediaorganisatie", 20),
  ];
  const relations = [
    rel(1, 1, 2, "ambt", { functie: "Minister van Financiën", filter: "formele_macht", filters: ["formele_macht"] }),
    rel(2, 2, 3, "zeggenschap", { filter: "formele_macht", filters: ["formele_macht"] }),
    rel(3, 4, 6, "ambt", { functie: "Kamerlid", filter: "formele_macht", filters: ["formele_macht"] }),
    rel(4, 5, 6, "ambt", { functie: "Kamerlid, fractievoorzitter", filter: "formele_macht", filters: ["formele_macht"] }),
    rel(5, 7, 8, "eigendom", { filter: "eigendom", filters: ["eigendom"] }),
  ];
  const route = (from: number, to: number, nodes: number[], ids: number[]) => ({ from, to, rank: 1, hops: ids.length, nodes, relations: ids, historic: false, shared_with: [] });
  const paths = {
    entities,
    relations,
    routes: [
      route(1, 3, [1, 2, 3], [1, 2]),
      route(3, 1, [3, 2, 1], [2, 1]), // the same pair the other way round
      route(4, 5, [4, 6, 5], [3, 4]), // colleagues through the Kamer
      route(7, 8, [7, 8], [5]), // no decision-making in it
    ],
  };

  it("keeps a route through an office and a hierarchy, once per pair", () => {
    const routes = governanceRoutes(paths);
    expect(routes).toHaveLength(1);
    expect(routes[0].steps.map((step) => [step.from, step.to])).toEqual([[1, 2], [2, 3]]);
    expect(pmRelationLabel("ambt", null, routes[0].steps[0].relation.functie)).toBe("is minister van Financiën bij");
    expect(governanceFilter(routes[0].steps[0].relation)).toBe("formele_macht");
  });

  it("leaves out colleagues through a hub and routes without decision-making", () => {
    const keys = governanceRoutes(paths).map((item) => item.key);
    expect(keys.some((key) => key.startsWith("4-5"))).toBe(false);
    expect(keys.some((key) => key.startsWith("7-8"))).toBe(false);
    // two different offices at the same big station do tell something
    const minister = { ...paths, relations: [...relations.slice(0, 3), rel(4, 5, 6, "ambt", { functie: "Voorzitter", filters: ["formele_macht"] }), relations[4]] };
    expect(governanceRoutes(minister).some((item) => item.key.startsWith("4-5"))).toBe(true);
  });
});

// Story 14.23, the owner's examples of 2026-10-08: a Telegraaf/AD news item with the VVD and the PVV in it
describe("Wat ertoe doet (Story 14.23)", () => {
  const people: PmEntity[] = [
    { id: 3, name: "AD (Algemeen Dagblad)", type: "mediaorganisatie", degree: 40 },
    { id: 9, name: "De Telegraaf", type: "mediaorganisatie", degree: 50 },
    { id: 12, name: "RTL Nieuws", type: "mediaorganisatie", degree: 30 },
    { id: 53, name: "VVD", type: "partij", degree: 120 },
    { id: 55, name: "PVV", type: "partij", degree: 60 },
    { id: 398, name: "Kamran Ullah", type: "persoon", degree: 6 },
    { id: 400, name: "Kees Berghuis", type: "persoon", degree: 5 },
  ];
  const links: PmRelation[] = [
    rel(1878, 398, 53, "bestuurder", { active_from: "2006", active_until: "2010", certainty_label: "aannemelijk" }),
    rel(1007, 398, 9, "personeel", { active_from: "2023-06-01", certainty_label: "aannemelijk" }),
    rel(1075, 53, 400, "woordvoerder_van", { active_until: "2017", certainty_label: "onderbouwd" }),
    rel(1076, 400, 12, "personeel", { active_until: "2015", certainty_label: "onderbouwd" }),
    rel(252, 55, 3, "censuur", { mechanism: "Publieke aanval", filter: "flak", filters: ["flak"] }),
    rel(127, 55, 9, "alliantie", { mechanism: "Politicus als bron", filter: "sourcing", filters: ["sourcing"], source_count: 0 }),
  ];
  const paths = findPaths(people, links, [3, 9, 12], [53, 55], { at, maxHops: 2, limit: 3 });
  const nameOf = (id: number) => people.find((entity) => entity.id === id)?.name ?? String(id);
  const argument = (id: number, claim: string, quote: string | null = null): PmArgument => ({ id, stance: "supporting", status: "geverifieerd", claim, sources: [{ title: "bron", quote }] });

  it("leaves out a link without any source and puts people who belong to both ends first", () => {
    const parties = behindParties(paths, [3, 9, 12]);
    // "PVV werkt samen met De Telegraaf" has no source: no line
    expect(parties.flatMap((party) => party.lines.flatMap((line) => [...line.lead, ...line.last].map((step) => step.relation.id)))).not.toContain(127);
    expect(parties.map((party) => nameOf(party.partyId))).toEqual(["VVD", "PVV"]);
    expect(parties[0].lines.map((line) => [line.tier, line.lead.map((step) => nameOf(step.to)), line.last.map((step) => nameOf(step.to))])).toEqual([
      [0, ["Kamran Ullah"], ["De Telegraaf"]],
      [0, ["Kees Berghuis"], ["RTL Nieuws"]],
    ]);
    expect(parties[1].lines[0].tier).toBe(4);
  });

  it("drops a link whose evidence is about the press in general, not about this outlet", () => {
    const parties = behindParties(paths, [3, 9, 12]);
    const general = new Map<number, PmArgument[]>([
      [252, [argument(2189, "De PVV valt de pers publiekelijk aan: Wilders noemde journalisten 'tuig van de richel'.", "Journalisten zijn - uitzonderingen daargelaten - gewoon tuig van de richel.")]],
    ]);
    const kept = specificParties(parties, (id) => general.get(id) ?? (id === 252 ? [] : undefined), nameOf);
    expect(kept.map((party) => nameOf(party.partyId))).toEqual(["VVD"]);
    // A claim that names the AD carries the link (also in a quote or a source title)
    const aboutAd = new Map<number, PmArgument[]>([[252, [argument(1, "Wilders viel het AD aan om een peiling.")]]]);
    expect(specificParties(parties, (id) => aboutAd.get(id), nameOf).map((party) => nameOf(party.partyId))).toEqual(["VVD", "PVV"]);
    // Ties of belonging need no such check: the people lines stay without looked-up arguments
    expect(specificParties(parties, () => undefined, nameOf)).toHaveLength(2);
  });

  it("leaves out the outlet's own influence on a party (the NOS lobbies the Kamer)", () => {
    const parties: PmEntity[] = [
      { id: 11, name: "NOS", type: "omroep", degree: 120 },
      { id: 107, name: "Tweede Kamer", type: "overheidsinstelling", degree: 30 },
      { id: 20, name: "ANP", type: "persbureau", degree: 60 },
      { id: 1, name: "AD", type: "mediaorganisatie", degree: 40 },
    ];
    const ties = [
      rel(1, 11, 107, "lobbyt", { filter: "belangen", filters: ["belangen"] }),
      rel(2, 107, 20, "bron_van", { mechanism: "Persbureau brongebondenheid", filter: "sourcing", filters: ["sourcing"] }),
      rel(3, 20, 1, "beinvloeding", { mechanism: "Pakketjournalistiek", filter: "sourcing", filters: ["sourcing"] }),
    ];
    const found = behindParties(findPaths(parties, ties, [11, 1], [107], { at, maxHops: 2, limit: 3 }), [11, 1]);
    // The Kamer's word reaches the AD through the ANP; the NOS lobbying the Kamer is no line
    expect(found.flatMap((party) => party.lines.map((line) => [...line.lead, ...line.last].map((step) => step.relation.id)))).toEqual([[2, 3]]);
  });

  it("names outlets the way a text does", () => {
    expect(textNames("Het AD schreef dat …", "AD (Algemeen Dagblad)")).toBe(true);
    expect(textNames("in het Algemeen Dagblad", "AD (Algemeen Dagblad)")).toBe(true);
    expect(textNames("een advertentie, ad hoc", "AD (Algemeen Dagblad)")).toBe(false);
    expect(textNames("de Telegraaf-hoofdredacteur", "De Telegraaf")).toBe(true);
    expect(textNames("op nu.nl stond", "NU.nl")).toBe(true);
    expect(textNames("RTL meldde", "RTL Nederland")).toBe(true);
    expect(textNames("Nederland", "RTL Nederland")).toBe(false);
    expect(textNames("in de Volkskrant", "de Volkskrant")).toBe(true);
    expect(evidenceNames([argument(1, "x", "De NOS citeerde het RIVM")], "NOS")).toBe(true);
    expect(evidenceNames([{ ...argument(1, "De NOS citeerde het RIVM"), stance: "contradicting" }], "NOS")).toBe(false);
  });

  it("reads ended ties in the past tense and pressure by what happened", () => {
    expect(pmRelationLabel("bestuurder")).toBe("is bestuurder bij");
    expect(pmRelationReverseLabel("bestuurder")).toBe("heeft als bestuurder");
    expect(pmRelationReverseLabel("bestuurder", null, null, "2010")).toBe("had als bestuurder");
    expect(pmRelationLabel("personeel", "Draaideurconstructie", null, "2015")).toBe("werkte voor");
    expect(pmRelationLabel("personeel", "Draaideurconstructie", null, "2099")).toBe("werkt voor");
    expect(pmRelationLabel("ambt", null, "Minister van Financiën", "2024-07-02")).toBe("was minister van Financiën bij");
    expect(pmRelationLabel("censuur", "Publieke aanval")).toBe("valt publiekelijk aan");
    expect(pmRelationReverseLabel("censuur", "Publieke aanval")).toBe("wordt publiekelijk aangevallen door");
    expect(pmRelationLabel("censuur", "Iets onbekends")).toBe("censureert");
    expect(pmRelationLabel("alliantie", "Politicus als bron")).toBe("is bron voor");
    // A tie whose type says it exactly keeps its own words
    expect(pmRelationLabel("eigendom", "Eigendomsconcentratie")).toBe("is eigenaar van");
    expect(pmRelationLabel("personeel", "Expert legitimatie")).toBe("werkt voor");
    expect(hasEnded("2010", new Date("2026-10-08"))).toBe(true);
    expect(hasEnded("2027", new Date("2026-10-08"))).toBe(false);
    expect(hasEnded(null)).toBe(false);
  });

  it("leaves out how two big parties hang together through one of their many members or lobbyists", () => {
    const entity = (id: number, name: string, type: string, degree: number): PmEntity => ({ id, name, type, degree });
    const body = [
      entity(6, "Tweede Kamer", "overheidsinstelling", 160),
      entity(7, "Eerste Kamer", "overheidsinstelling", 80),
      entity(53, "VVD", "partij", 120),
      entity(60, "Progressief Nederland (PRO)", "partij", 90),
      entity(70, "CIDI", "lobbygroep", 12),
      entity(71, "Marjolein Moorman", "persoon", 4),
      entity(72, "Saskia Kluit", "persoon", 3),
      entity(1, "Eelco Heinen", "persoon", 10),
      entity(2, "Ministerie van Financiën", "overheidsinstelling", 40),
    ];
    const ties = [
      rel(10, 70, 6, "lobbyt", { filter: "belangen", filters: ["belangen"] }),
      rel(11, 70, 53, "lobbyt", { filter: "belangen", filters: ["belangen"] }),
      rel(12, 6, 71, "lidmaatschap", { filter: "formele_macht", filters: ["formele_macht"] }),
      rel(13, 71, 60, "lidmaatschap", { filter: "werving", filters: ["werving"] }),
      rel(14, 7, 72, "lidmaatschap", { filter: "formele_macht", filters: ["formele_macht"] }),
      rel(15, 72, 60, "lidmaatschap", { filter: "werving", filters: ["werving"] }),
      rel(16, 1, 2, "ambt", { functie: "Minister van Financiën", filter: "formele_macht", filters: ["formele_macht"] }),
      rel(17, 1, 53, "lidmaatschap", { filter: "werving", filters: ["werving"] }),
    ];
    const route = (nodes: number[], ids: number[]) => ({ from: nodes[0], to: nodes[nodes.length - 1], rank: 1, hops: ids.length, nodes, relations: ids, historic: false, shared_with: [] });
    const found = governanceRoutes({
      entities: body,
      relations: ties,
      routes: [route([6, 70, 53], [10, 11]), route([7, 72, 60], [14, 15]), route([6, 71, 60], [12, 13]), route([2, 1, 53], [16, 17])],
    });
    // CIDI, Kluit and Moorman are one of many on both sides; the minister of the VVD at Financiën is one of one
    expect(found.map((item) => item.steps.map((step) => step.relation.id).sort((a, b) => a - b))).toEqual([[16, 17]]);
    // Also when the Kamer has few links in the model yet (degrees do not decide it)
    const small = body.map((item) => ({ ...item, degree: 3 }));
    expect(governanceRoutes({ entities: small, relations: ties, routes: [route([6, 71, 60], [12, 13]), route([6, 70, 53], [10, 11])] })).toEqual([]);
    // Who someone is: the news says it already; a lobby or an office of one does tell
    const direct = governanceRoutes({
      entities: body,
      relations: ties,
      routes: [route([1, 53], [17]), route([71, 6], [12]), route([70, 53], [11]), route([1, 2], [16])],
    });
    expect(direct.map((item) => item.steps.map((step) => step.relation.id))).toEqual([[11], [16]]);
    expect(whoIsWho({ relation_type: "lobbyt" })).toBe(false);
    expect(massTie({ relation_type: "ambt", functie: "Tweede Kamerlid" })).toBe(true);
    expect(massTie({ relation_type: "ambt", functie: "Minister van Financiën" })).toBe(false);
  });
});

describe("reading relations", () => {
  it("says what an influence is by its mechanism", () => {
    expect(mechanismKey("Intermedia-agendering")).toBe("intermedia_agendering");
    expect(mechanismKey("Commerciële afhankelijkheid")).toBe("commerciele_afhankelijkheid");
    expect(pmRelationLabel("beinvloeding", "Bron afhankelijkheid")).toBe("is vaste bron voor");
    expect(pmRelationReverseLabel("beinvloeding", "Bron afhankelijkheid")).toBe("leunt als bron op");
    expect(pmRelationLabel("beinvloeding", "Intermedia-agendering")).toBe("zet de agenda van");
    expect(pmRelationLabel("beinvloeding", "Iets nieuws")).toBe("beïnvloedt via iets nieuws");
    expect(pmRelationLabel("beinvloeding")).toBe("beïnvloedt");
    expect(pmRelationLabel("eigendom", "Eigendomsconcentratie")).toBe("is eigenaar van");
  });

  it("reads memberships and jobs from the person, however the model stores them", () => {
    const typeOf = typeLookup(news);
    const party = byIdOf(2282);
    expect(labelSourceId(party, typeOf)).toBe(954);
    expect(relationWords(party, 954, typeOf)).toBe("is lid van");
    expect(relationWords(party, 53, typeOf)).toBe("heeft als lid");
    const job = rel(1, 900, 865, "personeel");
    expect(relationWords(job, 900, typeOf)).toBe("werkt voor");
    const network = rel(2, 50, 51, "lidmaatschap");
    expect(labelSourceId(network, (id) => (id === 50 ? "elite_netwerk" : "bedrijf"))).toBe(51);
    // Not an affiliation: always from the source
    expect(labelSourceId(byIdOf(143), typeOf)).toBe(82);
  });

  it("reads an office from the register (Epic 15)", () => {
    expect(pmRelationLabel("ambt", null, "Secretaris-generaal")).toBe("is secretaris-generaal bij");
    expect(pmRelationReverseLabel("ambt", null, "Secretaris-generaal")).toBe("heeft als secretaris-generaal");
    expect(pmRelationLabel("ambt", null, "Kamerlid, fractievoorzitter")).toBe("is Kamerlid, fractievoorzitter bij");
    expect(pmRelationLabel("ambt", null, "Europarlementariër (Renew)")).toBe("is Europarlementariër (Renew) bij");
    expect(pmRelationLabel("ambt")).toBe("heeft een ambt bij");
    expect(pmRelationLabel("zeggenschap")).toBe("heeft zeggenschap over");
    expect(pmRelationReverseLabel("geschenk")).toBe("kreeg een geschenk van");
    const office = { ...rel(3, 900, 865, "ambt"), functie: "Directeur-generaal" };
    expect(relationWords(office, 900, typeLookup(news))).toBe("is directeur-generaal bij");
    expect(relationWords(office, 865, typeLookup(news))).toBe("heeft als directeur-generaal");
  });
});

function byIdOf(id: number): PmRelation {
  return newsRelations.find((relation) => relation.id === id) as PmRelation;
}
