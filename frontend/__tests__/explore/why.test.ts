import { findPaths } from "@/lib/explore/pm-paths";
import { eventActorAliases, eventOutletSeeds, followedOutletIds, matchActorIds, soleOutlets } from "@/lib/explore/pm-seeds";
import type { ExploreInput } from "@/lib/explore/types";
import { hasEnded, labelSourceId, mechanismKey, pmRelationLabel, pmRelationReverseLabel, relationWords } from "@/lib/explore/labels";
import {
  behindParties,
  behindRoute,
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

  it("knows the one outlet that names a party (Story 14.25)", () => {
    const input = {
      entities: [{ kind: "person", aliases: ["erik-mouthaan"], outlet_counts: { "RTL Nieuws": 2 } }],
      insight: { authority_analysis: [{ authority: "CPB" }] },
    } as unknown as Pick<ExploreInput, "entities" | "insight">;
    const named = eventActorAliases(input);
    expect(named[0].outlets).toEqual([88]);
    expect(named[1].outlets).toBeUndefined();

    const actors = [
      ...named,
      // Named by RTL Nieuws and by the NOS: the news is about him
      { aliases: ["jan-jansen"], kind: "person" as const, outlets: [88] },
      { aliases: ["jan-jansen"], kind: "person" as const, outlets: [11] },
      // Named by an outlet that is not in the model
      { aliases: ["nordvind"], kind: "org" as const, outlets: [null] },
    ];
    const matches: PmMatch[] = [
      { alias: "erik-mouthaan", entity_id: 403, name: "Erik Mouthaan", type: "persoon" },
      { alias: "jan-jansen", entity_id: 50, name: "Jan Jansen", type: "persoon" },
      { alias: "cpb", entity_id: 60, name: "CPB", type: "overheidsinstelling" },
      { alias: "nordvind", entity_id: 30, name: "NordVind", type: "bedrijf" },
    ];
    expect(soleOutlets(actors, matches)).toEqual(new Map([[403, 88]]));
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

  it("shows no contact: a source, an expert, a programme's expert (Story 14.25)", () => {
    // RIVM is a source of the NOS, the PBL and its director explain at the NOS: every outlet has that
    expect(behindParties(newsPaths, [11, 4, 7])).toEqual([]);
    expect(behindParties(null, [11])).toEqual([]);
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
    rel(1075, 53, 400, "woordvoerder_van", { active_from: "2015", certainty_label: "onderbouwd" }),
    rel(1076, 400, 12, "personeel", { active_from: "2006", active_until: "2015", certainty_label: "onderbouwd" }),
    rel(252, 55, 3, "censuur", { mechanism: "Publieke aanval", filter: "flak", filters: ["flak"] }),
    rel(127, 55, 9, "alliantie", { mechanism: "Politicus als bron", filter: "sourcing", filters: ["sourcing"], source_count: 0 }),
  ];
  const paths = findPaths(people, links, [3, 9, 12], [53, 55], { at, maxHops: 2, limit: 3 });
  const nameOf = (id: number) => people.find((entity) => entity.id === id)?.name ?? String(id);
  const argument = (id: number, claim: string, quote: string | null = null): PmArgument => ({ id, stance: "supporting", status: "geverifieerd", claim, sources: [{ title: "bron", quote }] });

  it("leaves out a link without any source and puts people who belong to both ends first", () => {
    const parties = behindParties(paths, [3, 9, 12]);
    // "PVV werkt samen met De Telegraaf" has no source, "PVV valt het AD aan" is pressure from outside: no line
    expect(parties.map((party) => nameOf(party.partyId))).toEqual(["VVD"]);
    expect(parties[0].lines.map((line) => [line.tier, line.lead.map((step) => nameOf(step.to)), line.last.map((step) => nameOf(step.to))])).toEqual(
      expect.arrayContaining([
        [0, ["Kamran Ullah"], ["De Telegraaf"]],
        [0, ["Kees Berghuis"], ["RTL Nieuws"]],
      ]),
    );
    expect(parties[0].lines).toHaveLength(2);
  });

  it("drops money whose evidence is about advertising in general, not about this outlet", () => {
    const shop: PmEntity = { id: 60, name: "Supermarkt A", type: "bedrijf", degree: 8 };
    const ads = rel(260, 60, 3, "adverteerder", { filter: "advertentie", filters: ["advertentie"] });
    const found = behindParties(findPaths([...people, shop], [...links, ads], [3, 9, 12], [53, 60], { at, maxHops: 2, limit: 3 }), [3, 9, 12]);
    const named = (id: number) => (id === 60 ? "Supermarkt A" : nameOf(id));
    expect(found.map((party) => named(party.partyId))).toContain("Supermarkt A");
    const general = new Map<number, PmArgument[]>([[260, [argument(1, "Supermarkt A is de grootste adverteerder in Nederlandse kranten.")]]]);
    expect(specificParties(found, (id) => general.get(id), named).map((party) => named(party.partyId))).toEqual(["VVD"]);
    // A claim that names the AD carries the link (also in a quote or a source title)
    const aboutAd = new Map<number, PmArgument[]>([[260, [argument(2, "Supermarkt A kocht in 2025 de meeste advertentieruimte in het AD.")]]]);
    expect(specificParties(found, (id) => aboutAd.get(id), named).map((party) => named(party.partyId))).toContain("Supermarkt A");
    // Facts about how parties are built need no such check: the people lines stay without looked-up arguments
    expect(specificParties(found, () => [], named).map((party) => named(party.partyId))).toEqual(["VVD"]);
  });

  it("shows no contact: the Kamer's word through the ANP, the NOS lobbying the Kamer", () => {
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
    expect(behindParties(findPaths(parties, ties, [11, 1], [107], { at, maxHops: 2, limit: 3 }), [11, 1])).toEqual([]);
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

// Story 14.25, the owner's examples of 2026-10-14: who is behind an outlet is a place in it or its
// money, not who once was a source of it or supplied an expert
describe("Wie zit erachter? posities, geen contact (Story 14.25)", () => {
  const entity = (id: number, name: string, type: string, degree = 5): PmEntity => ({ id, name, type, degree });
  const all = [
    entity(3, "AD (Algemeen Dagblad)", "mediaorganisatie", 16),
    entity(4, "de Volkskrant", "mediaorganisatie", 36),
    entity(5, "Trouw", "mediaorganisatie", 15),
    entity(9, "De Telegraaf", "mediaorganisatie", 25),
    entity(11, "NOS", "omroep", 112),
    entity(88, "RTL Nieuws", "omroep", 13),
    entity(10, "NRC", "mediaorganisatie", 33),
    entity(1, "DPG Media", "mediaorganisatie", 71),
    entity(12, "ANP", "persbureau", 58),
    entity(53, "VVD", "partij", 120),
    entity(55, "PVV", "partij", 60),
    entity(107, "Tweede Kamer", "overheidsinstelling", 160),
    entity(2, "Ministerie van Financiën", "overheidsinstelling", 40),
    entity(300, "Clingendael Instituut", "denktank", 40),
    entity(301, "Wiardi Beckman Stichting", "denktank", 12),
    entity(302, "PCM Uitgevers", "bedrijf", 6),
    entity(303, "LINDA.", "mediaorganisatie", 3),
    entity(398, "Kamran Ullah", "persoon"),
    entity(401, "Kati Piri", "persoon", 12),
    entity(402, "Paulien Cornelisse", "persoon", 3),
    entity(403, "Erik Mouthaan", "persoon", 2),
    entity(404, "Yvonne Zonderop", "persoon"),
    entity(405, "Kamerlid A", "persoon"),
    entity(406, "Minister B", "persoon"),
  ];
  const ties: PmRelation[] = [
    // Contact: a source, an expert, a copy of the ANP
    rel(127, 55, 9, "alliantie", { mechanism: "Politicus als bron", filters: ["sourcing"] }),
    rel(5926, 401, 301, "personeel", { mechanism: "Draaideurconstructie", active_from: "2011", active_until: "2011" }),
    rel(9001, 301, 4, "beinvloeding", { mechanism: "Expert framing", filters: ["sourcing"] }),
    rel(1984, 300, 107, "adviseur", { mechanism: "Denktank → politiek" }),
    rel(237, 300, 3, "beinvloeding", { mechanism: "Expert framing", filters: ["sourcing"] }),
    rel(9002, 107, 12, "bron_van", { mechanism: "Persbureau brongebondenheid", filters: ["sourcing"] }),
    rel(9003, 12, 3, "beinvloeding", { mechanism: "Pakketjournalistiek", filters: ["sourcing"] }),
    // Places and money
    rel(1878, 398, 53, "bestuurder", { active_from: "2006", active_until: "2010" }),
    rel(1007, 398, 9, "personeel", { active_from: "2023-06-01" }),
    rel(9004, 1, 303, "eigendom", { active_from: "2026-02-01" }),
    rel(9005, 1, 5, "eigendom", { active_from: "2009" }),
    rel(9006, 302, 10, "eigendom", { active_from: "1995", active_until: "2009" }),
    rel(9007, 302, 5, "eigendom", { active_from: "1965", active_until: "2009" }),
    rel(9008, 402, 10, "personeel"),
    rel(9009, 402, 4, "personeel", { active_from: "2018", active_until: "2026" }),
    rel(9010, 88, 403, "dienstverband"),
    rel(9011, 404, 300, "bestuurder"),
    rel(9012, 404, 11, "adviseur"),
    rel(9013, 405, 107, "ambt", { functie: "Tweede Kamerlid" }),
    rel(9014, 405, 11, "personeel"),
    rel(9015, 406, 2, "ambt", { functie: "Minister van Financiën" }),
    rel(9016, 406, 4, "personeel", { active_until: "2019" }),
  ];
  const outlets = [3, 4, 5, 9, 11, 88];
  const lines = (parties: number[], sole?: (id: number) => number | undefined) =>
    behindParties(findPaths(all, ties, outlets, parties, { at, maxHops: 2, limit: 3 }), outlets, undefined, sole).flatMap((party) =>
      party.lines.map((line) => [...line.lead, ...line.last].map((step) => step.relation.id)),
    );

  it("shows no contact: the owner's examples", () => {
    // "PVV is bron voor De Telegraaf": one interview in 2017
    expect(lines([55])).toEqual([]);
    // Kati Piri worked at the WBS in 2011, the Volkskrant once wrote about a WBS project
    expect(lines([401])).toEqual([]);
    // The Kamer is advised by Clingendael and the AD quotes it; the Kamer is a source of the ANP;
    // a Kamerlid who works at the NOS is one of 150 seats
    expect(lines([107])).toEqual([]);
  });

  it("shows a person with a place in the outlet who belongs to the party, and the owner", () => {
    // Kamran Ullah: once a VVD board member, now at De Telegraaf
    expect(lines([53])).toEqual([[1878, 1007]]);
    // LINDA. and Trouw both belong to DPG Media
    expect(lines([303])).toEqual([[9004, 9005]]);
    // A minister who worked at the Volkskrant: one of the two ties still runs
    expect(lines([2])).toEqual([[9015, 9016]]);
    // Clingendael through its board member who advises the NOS, not through the AD quoting it
    expect(lines([300])).toEqual([[9011, 9012]]);
  });

  it("leaves out history on both sides, newsroom colleagues and the outlet's own reporter", () => {
    // NRC and Trouw had the same owner until 2009; Cornelisse wrote for the NRC and the Volkskrant
    expect(lines([10])).toEqual([]);
    // Erik Mouthaan brings the news of RTL Nieuws: only RTL names him
    expect(lines([403], (id) => (id === 403 ? 88 : undefined))).toEqual([]);
    // When another outlet names him too, the news is about him
    expect(lines([403])).toEqual([[9010]]);
    // An advertiser pays the outlet; the outlet advertising somewhere else is not who is behind it
    const ad = (source: number, target: number) => behindRoute({ nodes: [9, 60], relations: [1] }, new Map([[1, rel(1, source, target, "adverteerder")]]), typeLookup(all));
    expect(ad(60, 9)).toBe(true);
    expect(ad(9, 60)).toBe(false);
  });

  it("shows the weakest tie of a line first, else the place in the outlet", () => {
    const paths = findPaths(all, ties, outlets, [53], { at, maxHops: 2, limit: 3 });
    expect(behindParties(paths, outlets)[0].lines[0].explain).toEqual([1007, 1878]);
    // The VVD board seat rests on less: it comes first and the line counts as that weak
    const ranked = behindParties(paths, outlets, (id) => (id === 1878 ? 3 : 1));
    expect(ranked[0].lines[0].explain).toEqual([1878, 1007]);
    expect(ranked[0].lines[0].rank).toBe(3);
    expect(lineRelationIds(ranked)).toEqual([1878, 1007]);
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
