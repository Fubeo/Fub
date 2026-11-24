import { describe, expect, it } from "vitest";
import { TOOLS, type ToolSpec } from "../tools/registry";
import { CASELLE, COMANDO_DEL_CLIC, GRUPPI_COLONNA, layoutCompleto, TIPO_DEL_GRAFICO, type GruppoColonna } from "./colonna";

// Ogni casella del prototipo ha gli strumenti del motore del loro posto
// `colonna/<gruppo>` nella mappa: la tabella non si inventa.
// La mappa si legge col suo testo grezzo (il repo, non il client).
const MAPPA = Object.values(import.meta.glob("../../../../../../crates/fub-disegno/mappa.tsv", { query: "?raw", import: "default", eager: true }) as Record<string, string>)[0]!;
const RIGHE: string[][] = MAPPA.split("\n").filter((riga: string) => riga !== "" && !riga.startsWith("#")).slice(1).map((riga: string) => riga.split("\t"));
const POSTO = new Map<string, string>(RIGHE.filter((colonne: string[]) => colonne[0] === "strumento").map((colonne: string[]) => [colonne[1]!, colonne[8]!]));
const POSTI: Readonly<Record<GruppoColonna, readonly string[]>> = {
  pick: ["colonna/scegli"],
  draw: ["colonna/disegna"],
  shape: ["colonna/forme", "colonna/testo"],
  modify: ["colonna/trasforma", "colonna/oggetti", "colonna/misura"],
  color: ["colonna/colore", "colonna/misura"],
  view: ["colonna/vista"],
};

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
    expect(pick.caselle[0]).toEqual(["motore:selection", "select"]);
    const draw = layout.find((gruppo) => gruppo.id === "draw")!;
    expect(draw.caselle[0]).toContain("motore:pen");
    expect(tutti(layout)).not.toContain("motore:lasso");
  });

  it("col motore presente ci sono solo i suoi strumenti pronti, nessuno di Fub", () => {
    const layout = layoutCompleto(VECTOR, new Set(["selection", "pen"]), true);
    expect(tutti(layout).sort()).toEqual(["motore:pen", "motore:selection"]);
    const extra: ToolSpec = { ...VECTOR[0]!, id: "note" as ToolSpec["id"] };
    expect(tutti(layoutCompleto([...VECTOR, extra], new Set(), true))).toEqual([]);
  });

  it("uno strumento offerto che il prototipo non nomina va in fondo al suo gruppo", () => {
    const solo = VECTOR.filter((spec) => spec.id !== "rect");
    const extra: ToolSpec = { ...VECTOR.find((spec) => spec.id === "rect")!, id: "note" as ToolSpec["id"], group: "shape" };
    const layout = layoutCompleto([...solo, extra]);
    const forme = layout.find((gruppo) => gruppo.id === "shape")!;
    expect(forme.caselle[forme.caselle.length - 1]).toEqual(["note"]);
  });

  it("una colonna senza strumenti è vuota", () => {
    expect(layoutCompleto([])).toEqual([]);
  });

  // Gli strumenti che il prototipo mette in una casella di un gruppo diverso
  // dal posto della mappa. La mappa vince sul gruppo: così lo dice la
  // colonna «posto». Ogni voce dice perché (la scheda di ogni strumento).
  const SCOSTAMENTI: Readonly<Record<string, string>> = {
    "width:width": "la mappa lo mette in disegna: il prototipo lo tiene con le deformazioni",
    "width:warp": "la mappa lo mette in disegna: il prototipo lo tiene con le deformazioni",
    "width:twirl": "la mappa lo mette in disegna: il prototipo lo tiene con le deformazioni",
    "width:pucker": "la mappa lo mette in disegna: il prototipo lo tiene con le deformazioni",
    "width:bloat": "la mappa lo mette in disegna: il prototipo lo tiene con le deformazioni",
    "width:scallop": "la mappa lo mette in disegna: il prototipo lo tiene con le deformazioni",
    "width:crystallize": "la mappa lo mette in disegna: il prototipo lo tiene con le deformazioni",
    "width:wrinkle": "la mappa lo mette in disegna: il prototipo lo tiene con le deformazioni",
    "shapeBuilder:shapeBuilder": "la mappa lo mette in forme: il prototipo lo tiene con le trasformazioni",
    "shapeBuilder:livePaintBucket": "la mappa lo mette in colore: il prototipo lo tiene col generatore",
    "shapeBuilder:livePaintSelection": "la mappa lo mette in colore: il prototipo lo tiene col generatore",
    "hand:printTiling": "la mappa lo mette in misura: il prototipo lo tiene con la vista",
  };
  it("ogni strumento del motore di una casella ha una riga della mappa col posto colonna/", () => {
    const errori: string[] = [];
    const usati = new Set<string>();
    for (const casella of CASELLE) {
      for (const strumento of casella.strumenti) {
        if (!strumento.startsWith("motore:")) continue;
        const id = strumento.slice("motore:".length);
        const posto = POSTO.get(id);
        if (posto === undefined || !posto.startsWith("colonna/")) errori.push(`${casella.id}: «${id}» non è nella mappa con un posto colonna/`);
        else if (!POSTI[casella.gruppo].includes(posto) && !(`${casella.id}:${id}` in SCOSTAMENTI)) errori.push(`${casella.id}: «${id}» è in «${posto}», non in ${casella.gruppo}`);
        if (`${casella.id}:${id}` in SCOSTAMENTI) usati.add(`${casella.id}:${id}`);
      }
    }
    expect(errori).toEqual([]);
    // Uno scostamento che non serve più si toglie.
    expect([...Object.keys(SCOSTAMENTI)].filter((chiave) => !usati.has(chiave))).toEqual([]);
  });
});

describe("gli strumenti dei grafici", () => {
  it("stanno nel riquadro delle forme composte, dopo i simboli, uno per tipo", () => {
    const riquadro = CASELLE.find((c) => c.id === "shapeBuilder");
    const strumenti = Object.keys(TIPO_DEL_GRAFICO).map((s) => `motore:${s}`);
    expect(strumenti).toHaveLength(9);
    expect(riquadro?.strumenti.slice(-9)).toEqual(strumenti);
  });

  it("il clic crea un grafico del tipo dello strumento, dal punto del clic", () => {
    for (const [strumento, tipo] of Object.entries(TIPO_DEL_GRAFICO)) {
      expect(COMANDO_DEL_CLIC[strumento]).toEqual({ comando: "graph.create", x: "x", y: "y", fissi: { type: tipo } });
    }
  });
});
