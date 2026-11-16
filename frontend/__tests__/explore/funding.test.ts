import { fundingLabel, fundingOf, MAX_FUNDERS } from "@/lib/explore/funding";
import type { PmNeighborhood, PmRelation } from "@/lib/types";

function rel(id: number, source: number, target: number, type: string, extra: Partial<PmRelation> = {}): PmRelation {
  return { id, source_id: source, target_id: target, relation_type: type, source_count: 1, ...extra };
}

function hood(relations: PmRelation[]): PmNeighborhood {
  return {
    center: { id: 1, name: "Rathenau Instituut", type: "denktank", degree: relations.length },
    entities: [
      { id: 2, name: "Ministerie van VWS", type: "overheidsinstelling", degree: 10 },
      { id: 3, name: "Ministerie van OCW", type: "overheidsinstelling", degree: 10 },
      { id: 4, name: "Testfonds", type: "stichting", degree: 2 },
      { id: 5, name: "Testkrant", type: "mediaorganisatie", degree: 2 },
    ],
    relations,
    total: relations.length,
    truncated: false,
  };
}

describe("Wie betaalt from the propaganda model", () => {
  it("takes funding relations into the authority, newest first, with the register's amounts", () => {
    const lines = fundingOf(
      hood([
        rel(10, 2, 1, "financiering", { functie: "Subsidie volgens Rijksfinanciën: 2021 € 224.000", active_from: "2021", active_until: "2021" }),
        rel(11, 3, 1, "financiering", { functie: "Subsidie volgens Rijksfinanciën: 2024 € 50.000", active_from: "2024" }),
        rel(12, 4, 1, "donor", { active_from: "2019", active_until: "2022" }),
        rel(13, 1, 5, "financiering"), // the authority funds someone else: not "Wie betaalt"
        rel(14, 5, 1, "bron_van"), // contact, not money
      ]),
      1,
    );
    expect(lines.map((line) => line.relationId)).toEqual([11, 12, 10]);
    expect(fundingLabel(lines[0])).toBe("Ministerie van OCW: Subsidie volgens Rijksfinanciën: 2024 € 50.000");
    expect(fundingLabel(lines[1])).toBe("Testfonds financiert (2019–2022)");
  });

  it("is empty without a neighbourhood and caps the number of funders", () => {
    expect(fundingOf(null, 1)).toEqual([]);
    const many = Array.from({ length: 8 }, (_, i) => rel(20 + i, 2, 1, "financiering", { active_from: String(2010 + i) }));
    expect(fundingOf(hood(many), 1)).toHaveLength(MAX_FUNDERS);
  });
});
