import { describe, expect, it } from "vitest";
import { TOOLS, type ToolSpec } from "../tools/registry";
import { CASELLE, GRUPPI_COLONNA, layoutCompleto } from "./colonna";

const VECTOR: readonly ToolSpec[] = TOOLS.filter((spec) => spec.spaces.vector !== undefined);
const tutti = (layout: ReturnType<typeof layoutCompleto>): string[] => layout.flatMap((gruppo) => gruppo.caselle.flat());

describe("la colonna del Disegno completo", () => {
  it("ha sei gruppi e le quattordici caselle del prototipo, senza il cassetto", () => {
    expect(GRUPPI_COLONNA).toEqual(["pick", "draw", "shape", "modify", "color", "view"]);
    expect(CASELLE).toHaveLength(14);
    expect(new Set(CASELLE.map((casella) => casella.id)).size).toBe(14);
  });

  it("mostra gli strumenti di Fub, ognuno una volta sola, e nessuno del motore finché non è pronto", () => {
    const layout = layoutCompleto(VECTOR);
    const mostrati = tutti(layout);
    expect(new Set(mostrati).size).toBe(mostrati.length);
    expect(mostrati.some((id) => id.startsWith("motore:"))).toBe(false);
    for (const spec of VECTOR) expect(mostrati, spec.id).toContain(spec.id);
  });

  it("i gruppi senza caselle non ci sono e restano nell'ordine del prototipo", () => {
    const ids = layoutCompleto(VECTOR).map((gruppo) => gruppo.id);
    expect(ids).toEqual(["pick", "draw", "shape", "view"]);
  });

  it("uno strumento del motore entra solo con la sua riga pronta, nella sua casella", () => {
    const layout = layoutCompleto(VECTOR, new Set(["selection", "pen"]));
    const pick = layout.find((gruppo) => gruppo.id === "pick")!;
    expect(pick.caselle[0]).toEqual(["select", "motore:selection"]);
    const draw = layout.find((gruppo) => gruppo.id === "draw")!;
    expect(draw.caselle[0]).toContain("motore:pen");
    expect(tutti(layout)).not.toContain("motore:lasso");
  });

  it("uno strumento offerto che il prototipo non nomina va in fondo al suo gruppo", () => {
    const solo = VECTOR.filter((spec) => spec.id !== "rect");
    const extra: ToolSpec = { ...VECTOR.find((spec) => spec.id === "rect")!, id: "note" as ToolSpec["id"], group: "shape" };
    const layout = layoutCompleto([...solo, extra]);
    const forme = layout.find((gruppo) => gruppo.id === "shape")!;
    expect(forme.caselle.at(-1)).toEqual(["note"]);
  });

  it("una colonna senza strumenti è vuota", () => {
    expect(layoutCompleto([])).toEqual([]);
  });
});
