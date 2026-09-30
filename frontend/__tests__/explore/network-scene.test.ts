import { buildExploration } from "@/lib/explore/exploration";
import { DEMO_EVENT } from "@/lib/explore/fixtures/demo-event";
import { eventLensScene } from "@/lib/explore/network-scene";

const exploration = buildExploration(JSON.parse(JSON.stringify(DEMO_EVENT)));

describe("event lens scenes", () => {
  it("hides findings behind ghosts until clues are revealed", () => {
    const scene = eventLensScene(exploration.graph, exploration.clues, new Set(), "tegenspraak");
    expect(scene.nodes.some((node) => node.kind === "contradiction")).toBe(false);
    const ghost = scene.nodes.find((node) => node.kind === "ghost" && node.ghost?.spoor === "wat-klopt-niet");
    expect(ghost?.ghost?.count).toBeGreaterThan(0);

    const all = new Set(exploration.clues.map((clue) => clue.id));
    const revealed = eventLensScene(exploration.graph, exploration.clues, all, "tegenspraak");
    expect(revealed.nodes.filter((node) => node.kind === "contradiction")).toHaveLength(2);
    expect(revealed.nodes.some((node) => node.kind === "ghost")).toBe(false);
    expect(revealed.edges.some((edge) => edge.kind === "contradicts")).toBe(true);
  });

  it("shows entities and outlets in the actors lens and related events in their lens", () => {
    const actors = eventLensScene(exploration.graph, exploration.clues, new Set(), "actoren");
    expect(actors.nodes.some((node) => node.kind === "entity" && node.label === "NordVind")).toBe(true);
    expect(actors.nodes.some((node) => node.id === "outlet:dw")).toBe(false);

    const related = eventLensScene(exploration.graph, exploration.clues, new Set(), "gerelateerd", { revealAll: true });
    expect(related.nodes.some((node) => node.kind === "related")).toBe(true);
    expect(related.edges.every((edge) => related.nodes.some((node) => node.id === edge.source))).toBe(true);
  });

  it("frames lens only shows frames after discovery", () => {
    const hidden = eventLensScene(exploration.graph, exploration.clues, new Set(), "frames");
    expect(hidden.nodes.some((node) => node.kind === "frame")).toBe(false);
    const frameClue = exploration.clues.find((clue) => clue.type === "frame")!;
    const shown = eventLensScene(exploration.graph, exploration.clues, new Set([frameClue.id]), "frames");
    expect(shown.nodes.some((node) => node.kind === "frame")).toBe(true);
  });
});
