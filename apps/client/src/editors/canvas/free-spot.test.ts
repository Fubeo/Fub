import { describe, expect, it } from "vitest";
import { FREE_SPOT_GAP, FREE_SPOT_RINGS, FREE_SPOT_STEP, nearFreeSpot, type SpotBox, type SpotObstacle } from "./free-spot";

const BOX: SpotBox = { x: 0, y: 0, width: 320, height: 160 };

function overlaps(a: SpotBox, b: SpotBox): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

describe("il posto libero più vicino (IMP-042)", () => {
  it("sulla lavagna vuota, o col posto libero, resta il posto voluto", () => {
    expect(nearFreeSpot([], BOX)).toEqual(BOX);
    expect(nearFreeSpot([{ type: "text", x: 1000, y: 1000, width: 100, height: 100 }], BOX)).toEqual(BOX);
  });

  it("con una scheda al centro sceglie il posto più vicino che non la tocca, con lo spazio intorno", () => {
    const card: SpotObstacle = { type: "text", x: 0, y: 0, width: 320, height: 160 };
    const spot = nearFreeSpot([card], BOX);
    expect(overlaps(spot, card)).toBe(false);
    expect(spot.width).toBe(320);
    expect(spot.height).toBe(160);
    // Sopra o sotto è più vicino che di lato: la scheda è più larga che alta.
    expect(spot.x).toBe(0);
    expect(Math.abs(spot.y)).toBe(160 + FREE_SPOT_GAP + (FREE_SPOT_STEP - ((160 + FREE_SPOT_GAP) % FREE_SPOT_STEP)) % FREE_SPOT_STEP);
    // Il posto resta sulla griglia di 8.
    expect(Math.abs(spot.x % 8)).toBe(0);
    expect(Math.abs(spot.y % 8)).toBe(0);
  });

  it("un gruppo non è un ostacolo: la scheda ci nasce dentro", () => {
    const group: SpotObstacle = { type: "group", x: -400, y: -400, width: 1200, height: 1200 };
    expect(nearFreeSpot([group], BOX)).toEqual(BOX);
  });

  it("senza posto nei giri provati resta il posto voluto", () => {
    const reach = FREE_SPOT_STEP * (FREE_SPOT_RINGS + 2) + 1000;
    const wall: SpotObstacle = { type: "file", x: -reach, y: -reach, width: 2 * reach, height: 2 * reach };
    expect(nearFreeSpot([wall], BOX)).toEqual(BOX);
  });

  it("fra molte schede trova un buco vicino senza toccarne nessuna", () => {
    const nodes: SpotObstacle[] = [];
    for (let i = -2; i <= 2; i++) for (let j = -2; j <= 2; j++) {
      if (i === 2 && j === 0) continue;
      nodes.push({ type: "text", x: i * 400, y: j * 240, width: 360, height: 200 });
    }
    const spot = nearFreeSpot(nodes, BOX);
    for (const node of nodes) expect(overlaps(spot, node)).toBe(false);
  });
});
