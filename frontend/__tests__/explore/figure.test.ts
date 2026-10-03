import { chronology, storyThread } from "@/lib/explore/chronology";
import { buildExploration } from "@/lib/explore/exploration";
import { buildFigure, numberFindings } from "@/lib/explore/figure";
import { DEMO_EVENT, DEMO_EVENTS } from "@/lib/explore/fixtures/demo-event";
import { isOutletShown } from "@/lib/explore/layout/bubbles";
import type { RawExploration } from "@/lib/explore/input";
import { outletIndex, speakerIndex } from "@/lib/explore/lens-index";
import type { EventRelation } from "@/lib/types";

function clone(raw: RawExploration): RawExploration {
  return JSON.parse(JSON.stringify(raw));
}

/** The demo reduced to one Dutch outlet: what almost every real event looks like */
function oneOutlet(): RawExploration {
  const raw = clone(DEMO_EVENT);
  const keep = raw.articles.filter((article) => article.source_name === "De Telegraaf" || article.is_international);
  raw.articles = keep;
  return raw;
}

describe("speakers in the demo", () => {
  const exploration = buildExploration(DEMO_EVENT);
  const { speakers } = exploration;

  it("puts an outlet's own claim on the outlet and a quoted person's claim on the person", () => {
    const own = speakers.ownClaims.get("telegraaf") ?? [];
    const ownClaim = exploration.findingById.get(own[0]);
    expect(ownClaim?.body.type === "claim" && ownClaim.body.claim.claim).toContain("miljoenen");
    const verbeek = speakers.speakers.find((speaker) => speaker.name === "Anouk Verbeek");
    expect(verbeek?.outletKey).toBe("telegraaf");
    expect(verbeek?.role).toBe("wethouder");
    expect(verbeek?.claimIds).toHaveLength(1);
    expect(speakers.claimAnchor.get(verbeek!.claimIds[0])).toEqual({ kind: "speaker", id: verbeek!.id });
  });

  it("merges authorities with their role and interests and never lists an outlet as a speaker", () => {
    const nordvind = speakers.speakers.find((speaker) => speaker.name === "NordVind");
    expect(nordvind?.role).toBe("bedrijf");
    expect(nordvind?.interest).toBe(true);
    const outletNames = new Set(exploration.input.outlets.map((outlet) => outlet.name));
    expect(speakers.speakers.some((speaker) => outletNames.has(speaker.name))).toBe(false);
  });
});

describe("figure", () => {
  const exploration = buildExploration(DEMO_EVENT);

  it("groups by perspective with three or more Dutch outlets, and always shows the missing voices", () => {
    const figure = buildFigure(exploration, (outlet) => isOutletShown(outlet));
    expect(figure.mode).toBe("perInvalshoek");
    expect(figure.groups.filter((group) => group.kind === "perspective")).toHaveLength(3);
    const missing = figure.groups.find((group) => group.kind === "missing");
    expect(missing?.ghosts.map((ghost) => ghost.label)).toContain("Boeren op de polder");
    expect(figure.groups.some((group) => group.kind === "foreign")).toBe(false);
    // Speakers are avatars there, so their claim markers move to the outlet balloon
    const telegraaf = figure.markers.get("outlet:telegraaf") ?? [];
    expect(telegraaf.map((marker) => marker.type)).toEqual(expect.arrayContaining(["claim"]));
    expect(telegraaf.length).toBeGreaterThan((numberFindings(exploration).markers.get("outlet:telegraaf") ?? []).length);
  });

  it("draws one group per outlet with its speakers when there are at most two Dutch outlets", () => {
    const single = buildExploration(oneOutlet());
    const figure = buildFigure(single, (outlet) => isOutletShown(outlet));
    expect(figure.mode).toBe("perBron");
    const group = figure.groups.find((item) => item.kind === "outlet");
    expect(group?.label).toBe("De Telegraaf");
    expect(group?.meta?.tone).toBe("geruststellend");
    expect(group?.speakers.map((speaker) => speaker.name)).toContain("Anouk Verbeek");
    expect(group?.outlets[0].textKind).toBe("stance");
  });

  it("adds foreign outlets with their Dutch gist only when chosen", () => {
    const shown = (outlet: { key: string; isInternational: boolean }) => isOutletShown(outlet, { added: ["dw"], removed: [] });
    const figure = buildFigure(exploration, shown);
    const foreign = figure.groups.find((group) => group.kind === "foreign");
    expect(foreign?.outlets.map((outlet) => outlet.outletKey)).toEqual(["dw"]);
    expect(foreign?.outlets[0].textKind).toBe("digest");
  });

  it("numbers markers once per event, independent of the outlets shown", () => {
    const all = buildFigure(exploration, () => true).numbers;
    const few = buildFigure(exploration, (outlet) => outlet.key === "nos").numbers;
    expect(Array.from(few.entries())).toEqual(Array.from(all.entries()));
    const values = Array.from(all.values());
    expect(new Set(values).size).toBe(values.length);
    expect(Math.min(...values)).toBe(1);
  });

  it("draws contradiction lines only between outlets in the picture", () => {
    expect(buildFigure(exploration, () => true).contradictions.length).toBeGreaterThan(0);
    expect(buildFigure(exploration, (outlet) => outlet.key === "nos").contradictions).toHaveLength(0);
  });
});

describe("in dit nieuws", () => {
  const exploration = buildExploration(DEMO_EVENT);

  it("gives one line per tab with content for an outlet", () => {
    const lines = outletIndex(exploration, "telegraaf");
    const tabs = lines.map((line) => line.tab);
    expect(tabs).toEqual(expect.arrayContaining(["klopt", "stemmen", "gebracht"]));
    expect(lines.find((line) => line.tab === "klopt")?.text).toMatch(/claim/);
    expect(lines.every((line) => line.text.length > 0)).toBe(true);
  });

  it("lists a speaker's claims and role", () => {
    const nordvind = exploration.speakers.speakers.find((speaker) => speaker.name === "NordVind")!;
    expect(speakerIndex(exploration, nordvind).map((line) => line.tab)).toContain("stemmen");
  });
});

describe("chronology and story thread", () => {
  const relation = (id: number, firstSeen: string, reasons: EventRelation["reasons"]): EventRelation => ({
    related_event_id: id,
    score: 0.5,
    reasons,
    related_title: `**Titel ${id}**`,
    related_first_seen_at: firstSeen,
  });
  const person = (name: string) => ({ type: "entity" as const, key: `person:${name}`, name, kind: "person" as const });
  const place = (name: string) => ({ type: "entity" as const, key: `place:${name}`, name, kind: "place" as const });

  it("splits relations into the same story (earlier, alongside, later) and other news per person", () => {
    const raw = clone(DEMO_EVENT);
    raw.relations = [
      relation(1, "2026-09-20T10:00:00Z", [person("Anouk Verbeek"), place("Dijkerhoven")]),
      relation(2, "2026-09-28T12:00:00Z", [person("Anouk Verbeek"), person("Henk de Boer")]),
      relation(3, "2026-10-05T10:00:00Z", [person("Anouk Verbeek"), place("Dijkerhoven")]),
      relation(4, "2026-03-01T10:00:00Z", [person("Anouk Verbeek")]),
      relation(5, "2026-09-28T12:00:00Z", [{ type: "category", value: "politics" }, { type: "topic", similarity: 0.9 }]),
    ];
    const thread = storyThread(buildExploration(raw).input);
    expect(thread.earlier.map((item) => item.eventId)).toEqual([1]);
    expect(thread.alongside.map((item) => item.eventId)).toEqual([2]);
    expect(thread.later.map((item) => item.eventId)).toEqual([3]);
    expect(thread.people).toEqual([expect.objectContaining({ name: "Anouk Verbeek", episodes: [expect.objectContaining({ eventId: 4 })] })]);
    expect(thread.earlier[0].title).toBe("Titel 1");
  });

  it("puts publications and moments on one axis, history apart", () => {
    const { history, rows } = chronology(buildExploration(DEMO_EVENT).input);
    expect(history.length).toBeGreaterThan(0);
    expect(rows.some((row) => row.kind === "publication")).toBe(true);
    expect(rows.some((row) => row.kind === "moment")).toBe(true);
    const times = rows.map((row) => row.t);
    expect([...times].sort((a, b) => a - b)).toEqual(times);
  });
});

describe("the demo story", () => {
  it("links its four news items into one story with other news per person", () => {
    const thread = storyThread(buildExploration(DEMO_EVENT).input);
    expect(thread.earlier.map((item) => item.eventId)).toEqual([-2]);
    expect(thread.later.map((item) => item.eventId)).toEqual([-3]);
    expect(thread.people.map((person) => person.name)).toEqual(["Anouk Verbeek"]);
    const later = storyThread(buildExploration(DEMO_EVENTS["demo-vervolg"]).input);
    expect(later.earlier.map((item) => item.eventId)).toEqual([-2, -1]);
  });

  it("shows the usual case in the later episode: one Dutch outlet with speakers, via, anonymous and old foreign coverage", () => {
    const exploration = buildExploration(DEMO_EVENTS["demo-vervolg"]);
    const figure = buildFigure(exploration, (outlet) => isOutletShown(outlet, { added: ["reuters", "dw"], removed: [] }));
    expect(figure.mode).toBe("perBron");
    const nos = figure.groups.find((group) => group.kind === "outlet");
    const names = nos?.speakers.map((speaker) => speaker.name) ?? [];
    expect(names).toEqual(expect.arrayContaining(["Joost Ravenhorst", "NordVind", "Anonieme bron", "Anouk Verbeek", "RIVM", "Ipsos I&O"]));
    expect(nos?.speakers.find((speaker) => speaker.name === "NordVind")?.via).toBe("ANP");
    expect(nos?.speakers.find((speaker) => speaker.name === "RIVM")?.interest).toBe(false);
    const foreign = figure.groups.find((group) => group.kind === "foreign");
    expect(foreign?.outlets.find((outlet) => outlet.outletKey === "reuters")?.offDate).toBeTruthy();
    expect(foreign?.outlets.find((outlet) => outlet.outletKey === "dw")?.offDate).toBeNull();
  });

  it("has more speakers in the main demo: anonymous, via ANP, a resident and the planning agency", () => {
    const { speakers } = buildExploration(DEMO_EVENT);
    const names = speakers.speakers.map((speaker) => speaker.name);
    expect(names).toEqual(expect.arrayContaining(["Anonieme bron", "Henk de Boer", "Marieke Brand", "RIVM", "Planbureau voor de Leefomgeving"]));
    expect(speakers.via.get("nu-nl")).toContain("ANP");
  });
});
