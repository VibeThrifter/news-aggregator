import fs from "fs";
import path from "path";

import { actorKeys, fnv1a, lcg, normalizeUrl, slugify, urlFingerprint, urlHost } from "@/lib/explore/normalize";

describe("slugify", () => {
  const vectorsPath = path.resolve(__dirname, "../../../backend/tests/fixtures/entity_keys.json");
  const vectors: { input: string; expected: string }[] = JSON.parse(fs.readFileSync(vectorsPath, "utf8")).slugify;

  it("has shared vectors with the backend", () => {
    expect(vectors.length).toBeGreaterThanOrEqual(20);
  });

  it.each(vectors.map((vector) => [vector.input, vector.expected]))("slugify(%j) === %j (same as backend)", (input, expected) => {
    expect(slugify(input)).toBe(expected);
  });

  it("handles null and undefined", () => {
    expect(slugify(null)).toBe("");
    expect(slugify(undefined)).toBe("");
  });
});

describe("normalizeUrl", () => {
  it("ignores scheme, www, trailing slash, hash and tracking params", () => {
    const a = normalizeUrl("https://www.nu.nl/binnenland/123456/titel.html/?utm_source=x&fbclid=y#top");
    const b = normalizeUrl("http://nu.nl/binnenland/123456/titel.html");
    expect(a).toBe(b);
    expect(a).toBe("nu.nl/binnenland/123456/titel.html");
  });

  it("drops m./amp. subdomains and /amp suffix and sorts remaining params", () => {
    expect(normalizeUrl("https://m.ad.nl/artikel/abc/amp?b=2&a=1")).toBe("ad.nl/artikel/abc?a=1&b=2");
  });

  it("returns empty string for empty input and tolerates garbage", () => {
    expect(normalizeUrl("")).toBe("");
    expect(normalizeUrl(null)).toBe("");
    expect(normalizeUrl("nos.nl/artikel/1/")).toBe("nos.nl/artikel/1");
  });

  it("extracts the host", () => {
    expect(urlHost("https://www.telegraaf.nl/nieuws/1/x")).toBe("telegraaf.nl");
    expect(urlHost("")).toBe("");
  });
});

describe("urlFingerprint", () => {
  it("uses the longest digit run for news ids", () => {
    expect(urlFingerprint("https://nos.nl/artikel/2601101-windpark")).toBe("nos.nl#2601101");
    expect(urlFingerprint("https://nos.nl/l/2601101")).toBe("nos.nl#2601101");
  });

  it("falls back to the last path segment", () => {
    expect(urlFingerprint("https://example.com/a/some-slug/")).toBe("example.com#some-slug");
  });
});

describe("actorKeys", () => {
  it("strips role prefixes", () => {
    expect(actorKeys("Minister Hugo de Jonge").slug).toBe("hugo-de-jonge");
    expect(actorKeys("prof. dr. Sanne de Wit").slug).toBe("sanne-de-wit");
    expect(actorKeys("Oud-premier Mark Rutte").display).toBe("Mark Rutte");
  });

  it("keeps an acronym from a parenthetical as alias", () => {
    const keys = actorKeys("Rijksinstituut voor Volksgezondheid en Milieu (RIVM)");
    expect(keys.slug).toBe("rijksinstituut-voor-volksgezondheid-en-milieu");
    expect(keys.aliases).toContain("rivm");
  });

  it("adds the surname alias for persons only", () => {
    expect(actorKeys("Mark Rutte", { person: true }).aliases).toEqual(expect.arrayContaining(["mark-rutte", "rutte"]));
    expect(actorKeys("Raad van State").aliases).toEqual(["raad-van-state"]);
  });
});

describe("hashing and randomness", () => {
  it("fnv1a is stable and short", () => {
    expect(fnv1a("abc")).toBe(fnv1a("abc"));
    expect(fnv1a("abc")).not.toBe(fnv1a("abd"));
    expect(fnv1a("")).toMatch(/^[0-9a-z]+$/);
  });

  it("lcg is deterministic per seed", () => {
    const a = lcg(42);
    const b = lcg(42);
    const values = [a(), a(), a()];
    expect([b(), b(), b()]).toEqual(values);
    values.forEach((value) => {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    });
  });
});
