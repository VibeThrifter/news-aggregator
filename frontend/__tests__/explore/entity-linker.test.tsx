import { fireEvent, render, screen } from "@testing-library/react";

import { EntityLinksContext } from "@/components/explore/entity/EntityLinks";
import { EntityText } from "@/components/explore/entity/EntityText";
import { DEMO_EVENT } from "@/lib/explore/fixtures/demo-event";
import { buildEntityLinks, hasEntityLinks, personSurname, segmentText, type EntityLink } from "@/lib/explore/entity-linker";
import { buildExploreInput } from "@/lib/explore/input";
import type { EventEntity } from "@/lib/types";

const entity = (key: string, name: string, kind: EventEntity["kind"], aliases: string[], salience = 0.1): EventEntity => ({
  entity_key: key,
  name,
  kind,
  aliases,
  mention_count: 1,
  article_count: 1,
  outlet_counts: {},
  salience,
});

const links = (segments: ReturnType<typeof segmentText>) =>
  segments.filter((segment) => segment.type === "link").map((segment) => (segment.type === "link" ? [segment.text, segment.link.key] : null));

describe("entity linker", () => {
  const input = buildExploreInput(DEMO_EVENT);
  const targets = buildEntityLinks({
    outlets: input.outlets,
    entities: input.entities,
    authorities: (input.insight?.authority_analysis ?? []).map((authority) => authority.authority),
  });

  it("builds targets for outlets, people, organisations and authorities, not places", () => {
    const texts = targets.map((target) => target.text);
    expect(texts).toEqual(expect.arrayContaining(["NOS", "Anouk Verbeek", "NordVind", "Stichting Stille Polder", "Henk de Boer"]));
    expect(texts).not.toContain("Dijkerhoven");
    expect(texts).not.toContain("Duitsland");
    expect(targets.find((target) => target.text === "NOS")?.kind).toBe("outlet");
    // Places can be switched on (the summary sheet keeps linking them)
    expect(buildEntityLinks({ outlets: [], entities: input.entities }, { kinds: "all" }).map((target) => target.text)).toContain("Dijkerhoven");
  });

  it("links a person's surname on its own, with the full name for the panel", () => {
    const segments = segmentText("Verbeek zegt dat De Boer ongelijk heeft.", targets);
    expect(links(segments)).toEqual([
      ["Verbeek", "anouk-verbeek"],
      ["De Boer", "henk-de-boer"],
    ]);
    const verbeek = segments.find((segment) => segment.type === "link");
    expect(verbeek?.type === "link" && verbeek.link.name).toBe("Anouk Verbeek");
    expect(personSurname("Henk de Boer")).toBe("de Boer");
    expect(personSurname("Madonna")).toBeNull();
  });

  it("only links a surname when it is unique within the event", () => {
    const twoJansens = buildEntityLinks({
      outlets: [],
      entities: [entity("person:piet-jansen", "Piet Jansen", "person", ["piet-jansen"]), entity("person:els-jansen", "Els Jansen", "person", ["els-jansen"])],
    });
    expect(twoJansens.map((target) => target.text)).toEqual(["Piet Jansen", "Els Jansen"]);
    expect(links(segmentText("Jansen reageerde niet.", twoJansens))).toEqual([]);
  });

  it("links only the first occurrence per text block and never inside words", () => {
    const segments = segmentText("Anouk Verbeek en NordVind. Later zegt Anouk Verbeek iets over NordVindpark en Verbeekstraat.", targets);
    expect(links(segments)).toEqual([
      ["Anouk Verbeek", "anouk-verbeek"],
      ["NordVind", "nordvind"],
    ]);
    // A shared set links a name once across several blocks
    const used = new Set<string>();
    expect(links(segmentText("NordVind bouwt.", targets, used))).toHaveLength(1);
    expect(links(segmentText("NordVind bouwt.", targets, used))).toHaveLength(0);
  });

  it("prefers the longest name", () => {
    const custom = buildEntityLinks({
      outlets: [{ key: "telegraaf", name: "De Telegraaf", profile: { aliases: ["Telegraaf"] } }],
      entities: [entity("org:adviesraad", "Adviesraad", "org", ["adviesraad"]), entity("org:nationale-adviesraad", "Nationale Adviesraad", "org", ["nationale-adviesraad"])],
    });
    expect(links(segmentText("De Telegraaf citeert de Nationale Adviesraad.", custom))).toEqual([
      ["De Telegraaf", "telegraaf"],
      ["Nationale Adviesraad", "nationale-adviesraad"],
    ]);
    expect(hasEntityLinks("Niets bekends hier.", custom)).toBe(false);
  });
});

describe("EntityText", () => {
  const targets: EntityLink[] = buildEntityLinks({
    outlets: [],
    entities: [entity("person:anouk-verbeek", "Anouk Verbeek", "person", ["anouk-verbeek", "verbeek"])],
  });

  it("renders names as buttons that open the entity panel", () => {
    const openEntity = jest.fn();
    render(
      <EntityLinksContext.Provider value={{ links: targets, openEntity }}>
        <p>
          <EntityText text="Wethouder Anouk Verbeek zegt ja. Verbeek herhaalt het." />
        </p>
      </EntityLinksContext.Provider>,
    );
    const buttons = screen.getAllByRole("button");
    expect(buttons).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Anouk Verbeek" }));
    expect(openEntity).toHaveBeenCalledWith("anouk-verbeek", "Anouk Verbeek");
    expect(screen.getByText(/Verbeek herhaalt het/)).toBeInTheDocument();
  });

  it("stays plain text outside the explore shell", () => {
    render(<EntityText text="Anouk Verbeek zegt ja." />);
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByText("Anouk Verbeek zegt ja.")).toBeInTheDocument();
  });

  it("does not let a tap reach a tappable parent", () => {
    const openEntity = jest.fn();
    const parent = jest.fn();
    render(
      <EntityLinksContext.Provider value={{ links: targets, openEntity }}>
        <div onClick={parent}>
          <EntityText text="Anouk Verbeek" />
        </div>
      </EntityLinksContext.Provider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Anouk Verbeek" }));
    expect(openEntity).toHaveBeenCalled();
    expect(parent).not.toHaveBeenCalled();
  });
});
