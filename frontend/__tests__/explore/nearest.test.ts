import { nearestPerspective, words } from "@/lib/explore/nearest";

const perspectives = [
  {
    index: 0,
    label: "Vissers in het nauw",
    text: "Het park bedreigt het inkomen van vissers. Vissers zijn de dupe. Vissers laten van zich horen. Protest tegen windpark op zee",
  },
  { index: 1, label: "Natuurwinst op zee", text: "Rustgebieden tussen turbines zijn goed voor de natuur. Natuurorganisaties zien juist kansen. Windpark op zee: vissers tegen" },
];

describe("the perspective an outlet leans to", () => {
  it("reduces headlines to meaningful word stems", () => {
    expect(words("Vissers protesteren bij Den Helder")).toEqual(["visser", "protest", "helder"]);
    // singular and plural end up the same
    expect(words("Natuurorganisaties zien kansen")).toEqual(words("natuurorganisatie zien kans"));
  });

  it("picks the perspective whose own words the headline shares", () => {
    expect(nearestPerspective(["Vissers protesteren bij Den Helder"], perspectives)?.label).toBe("Vissers in het nauw");
    expect(nearestPerspective(["Vissers tegen de windmolenmaffia"], perspectives)?.label).toBe("Vissers in het nauw");
    expect(nearestPerspective(["Rustgebieden goed voor natuur"], perspectives)?.label).toBe("Natuurwinst op zee");
  });

  it("gives no estimate without a clear winner or shared words", () => {
    expect(nearestPerspective(["Windpark op zee"], perspectives)).toBeNull(); // words both use
    expect(nearestPerspective(["German developer expands"], perspectives)).toBeNull();
    expect(nearestPerspective(["Vissers"], [])).toBeNull();
  });
});
