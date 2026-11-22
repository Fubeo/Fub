// La famiglia «forme» lato client (piano K6, T13): gli strumenti di forma nella colonna
// del Completo. Ogni strumento «fatto» dell'indice generato ha il suo nome corto nelle due
// lingue, nel catalogo della colonna (così c'è prima che la famiglia arrivi), la sua icona
// del catalogo e la sua casella nel gruppo «forme» (la casella di Rettangolo). Rettangolo
// ed Ellisse esistono anche nel Semplice: nella tendina portano «(Completo)».

import { describe, expect, it } from "vitest";
import { DRAW_ICONS } from "../../../icons";
import { ICONE_MOTORE, iconaMotore, layoutCompleto, MOTORE_PRONTO } from "../../colonna";
import indiceGenerato from "../../indice.generated.json";
import { COLONNA_EN, COLONNA_IT } from "../../../strings/completo";

interface VoceGenerata {
  readonly famiglia: string;
  readonly chiamata: { readonly strumento?: string };
}

const VOCI = (indiceGenerato as { readonly voci: readonly VoceGenerata[] }).voci;
const STRUMENTI_FORME = VOCI.filter((voce) => voce.famiglia === "forme" && voce.chiamata.strumento !== undefined).map((voce) => voce.chiamata.strumento!);
const FORME_PRONTO: ReadonlySet<string> = new Set(STRUMENTI_FORME);

describe("la famiglia forme nella colonna", () => {
  it("ha dieci strumenti fatti: le otto forme e le due griglie (T13 giro 7); senza il riflesso (aspetta T27)", () => {
    expect([...STRUMENTI_FORME].sort()).toEqual(["arc", "ellipse", "lineSegment", "polarGrid", "polygon", "rectangle", "rectangularGrid", "roundedRectangle", "spiral", "star"]);
  });

  it("ogni strumento fatto ha il nome corto nelle due lingue nel catalogo della colonna, l'icona e un posto nel motore", () => {
    for (const id of STRUMENTI_FORME) {
      const chiave = `draw.engine.name.${id}`;
      expect(COLONNA_IT, id).toHaveProperty([chiave]);
      expect(COLONNA_EN, id).toHaveProperty([chiave]);
      expect(COLONNA_IT[chiave as keyof typeof COLONNA_IT].trim(), id).not.toBe("");
      expect(COLONNA_EN[chiave as keyof typeof COLONNA_EN].trim(), id).not.toBe("");
      expect(MOTORE_PRONTO.has(id), id).toBe(true);
      expect(DRAW_ICONS[iconaMotore(id)], id).toBeDefined();
      expect(Object.prototype.hasOwnProperty.call(ICONE_MOTORE, id), id).toBe(true);
    }
  });

  it("Rettangolo ed Ellisse portano «(Completo)», come Selezione, Mano e Zoom", () => {
    expect(COLONNA_IT["draw.engine.name.rectangle"]).toBe("Rettangolo (Completo)");
    expect(COLONNA_IT["draw.engine.name.ellipse"]).toBe("Ellisse (Completo)");
    expect(COLONNA_EN["draw.engine.name.rectangle"]).toBe("Rectangle (Full)");
  });

  it("nella colonna le forme stanno nella casella di Rettangolo, nel gruppo «forme»", () => {
    const gruppoShape = layoutCompleto([], FORME_PRONTO).find((gruppo) => gruppo.id === "shape");
    const caselle = gruppoShape?.caselle ?? [];
    const strumentiDiRettangolo = caselle.find((casella) => casella.includes("motore:rectangle")) ?? [];
    expect(strumentiDiRettangolo).toEqual(expect.arrayContaining(["motore:rectangle", "motore:roundedRectangle", "motore:ellipse", "motore:polygon", "motore:star", "motore:lineSegment", "motore:arc", "motore:spiral"]));
    // Le due griglie stanno nella stessa casella, come nel prototipo (T13 giro 7).
    expect(strumentiDiRettangolo).toEqual(expect.arrayContaining(["motore:rectangularGrid", "motore:polarGrid"]));
  });

  it("le due griglie hanno il nome corto nelle due lingue e un'icona del catalogo, e il loro id va al motore", () => {
    for (const id of ["rectangularGrid", "polarGrid"]) {
      expect(COLONNA_IT[`draw.engine.name.${id}` as keyof typeof COLONNA_IT].trim(), id).not.toBe("");
      expect(COLONNA_EN[`draw.engine.name.${id}` as keyof typeof COLONNA_EN].trim(), id).not.toBe("");
      expect(DRAW_ICONS[iconaMotore(id)], id).toBeDefined();
      expect(ICONE_MOTORE[id], id).toBeDefined();
      expect(MOTORE_PRONTO.has(id), id).toBe(true);
    }
    expect(COLONNA_IT["draw.engine.name.rectangularGrid"]).toBe("Griglia rettangolare");
    expect(COLONNA_IT["draw.engine.name.polarGrid"]).toBe("Griglia polare");
  });

  it("le griglie compaiono nella colonna quando sono fatte", () => {
    const tutti = layoutCompleto([], MOTORE_PRONTO).flatMap((gruppo) => gruppo.caselle.flat());
    expect(tutti).toContain("motore:rectangularGrid");
    expect(tutti).toContain("motore:polarGrid");
  });
});
