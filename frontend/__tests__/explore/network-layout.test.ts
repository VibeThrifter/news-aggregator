import { layoutNetwork, nodeRadius, type NetNode } from "@/lib/explore/layout/network";

const star = (n: number): { nodes: NetNode[]; edges: { source: string; target: string }[] } => ({
  nodes: [{ id: "c", pin: { x: 0, y: 0 }, weight: 9 }, ...Array.from({ length: n }, (_, i) => ({ id: `n${i}`, weight: 1 }))],
  edges: Array.from({ length: n }, (_, i) => ({ source: "c", target: `n${i}` })),
});

describe("network layout", () => {
  it("is deterministic and keeps pinned nodes in place", () => {
    const { nodes, edges } = star(12);
    const a = layoutNetwork(nodes, edges, { seed: 5 });
    const b = layoutNetwork(nodes, edges, { seed: 5 });
    expect(Array.from(a.entries())).toEqual(Array.from(b.entries()));
    expect(a.get("c")).toEqual({ x: 0, y: 0 });
  });

  it("separates nodes (no heavy overlap)", () => {
    const { nodes, edges } = star(30);
    const positions = layoutNetwork(nodes, edges, { seed: 3 });
    const points = Array.from(positions.values());
    let tooClose = 0;
    for (let i = 0; i < points.length; i += 1) {
      for (let j = i + 1; j < points.length; j += 1) {
        if (Math.hypot(points[i].x - points[j].x, points[i].y - points[j].y) < nodeRadius(1)) tooClose += 1;
      }
    }
    expect(tooClose).toBe(0);
  });

  it("places expanded nodes near their parent and can keep previous positions", () => {
    const { nodes, edges } = star(6);
    const first = layoutNetwork(nodes, edges, { seed: 2 });
    const grown = [...nodes, { id: "x1", parent: "n0" }, { id: "x2", parent: "n0" }];
    const second = layoutNetwork(grown, [...edges, { source: "n0", target: "x1" }, { source: "n0", target: "x2" }], {
      seed: 2,
      previous: first,
      keepPrevious: true,
    });
    expect(second.get("n3")).toEqual(first.get("n3"));
    const parent = second.get("n0")!;
    const child = second.get("x1")!;
    expect(Math.hypot(parent.x - child.x, parent.y - child.y)).toBeLessThan(260);
  });

  it("ignores edges to unknown nodes and handles anchors", () => {
    const positions = layoutNetwork(
      [{ id: "a", anchor: { x: 300, y: 0, strength: 0.5 } }, { id: "b" }],
      [{ source: "a", target: "zzz" }],
      { seed: 1 },
    );
    expect(positions.get("a")!.x).toBeGreaterThan(100);
  });
});
