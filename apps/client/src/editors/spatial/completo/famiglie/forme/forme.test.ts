// La famiglia «forme» lato client (piano K6, T13, giro 1): gli strumenti di forma
// nella colonna del Completo. Ogni strumento «fatto» dell'indice generato ha il
// suo nome corto nelle due lingue, la sua icona del catalogo e la sua casella nel
// gruppo «forme» (la casella di Rettangolo). Rettangolo ed Ellisse esistono anche
// nel Semplice: nella tendina portano «(Completo)».

import { describe, expect, it } from "vitest";
import { DRAW_ICONS } from "../../../icons";
import { ICONE_MOTORE, iconaMotore, layoutCompleto, MOTORE_PRONTO } from "../../colonna";
import indiceGenerato from "../../indice.generated.json";
import { TESTI } from "./testi";

interface VoceGenerata {
  readonly famiglia: string;
  readonly chiamata: { readonly strumento?: string };
}

const VOCI = (indiceGenerato as { readonly voci: readonly VoceGenerata[] }).voci;
const STRUMENTI_FORME = VOCI.filter((voce) => voce.famiglia === "forme" && voce.chiamata.strumento !== undefined).map((voce) => voce.chiamata.strumento!);
const FORME_PRONTO: ReadonlySet<string> = new Set(STRUMENTI_FORME);

describe("la famiglia forme nella colonna", () => {
  it("ha otto strumenti fatti: senza le griglie e il riflesso (aspettano T27)", () => {
    expect([...STRUMENTI_FORME].sort()).toEqual(["arc", "ellipse", "lineSegment", "polygon", "rectangle", "roundedRectangle", "spiral", "star"]);
  });

  it("ogni strumento fatto ha il nome corto nelle due lingue, l'icona del catalogo e un posto nel motore", () => {
    for (const id of STRUMENTI_FORME) {
      const nome = TESTI[`strumento:${id}`];
      expect(nome, id).toBeDefined();
      expect(nome!.it.trim(), id).not.toBe("");
      expect(nome!.en.trim(), id).not.toBe("");
      expect(MOTORE_PRONTO.has(id), id).toBe(true);
      expect(DRAW_ICONS[iconaMotore(id)], id).toBeDefined();
      expect(Object.prototype.hasOwnProperty.call(ICONE_MOTORE, id), id).toBe(true);
    }
  });

  it("Rettangolo ed Ellisse portano «(Completo)», come Selezione, Mano e Zoom", () => {
    expect(TESTI["strumento:rectangle"]!.it).toBe("Rettangolo (Completo)");
    expect(TESTI["strumento:ellipse"]!.it).toBe("Ellisse (Completo)");
    expect(TESTI["strumento:rectangle"]!.en).toBe("Rectangle (Full)");
  });

  it("nella colonna le forme stanno nella casella di Rettangolo, nel gruppo «forme»", () => {
    const gruppoShape = layoutCompleto([], FORME_PRONTO).find((gruppo) => gruppo.id === "shape");
    const caselle = gruppoShape?.caselle ?? [];
    const strumentiDiRettangolo = caselle.find((casella) => casella.includes("motore:rectangle")) ?? [];
    expect(strumentiDiRettangolo).toEqual(expect.arrayContaining(["motore:rectangle", "motore:roundedRectangle", "motore:ellipse", "motore:polygon", "motore:star", "motore:lineSegment", "motore:arc", "motore:spiral"]));
    expect(strumentiDiRettangolo).not.toContain("motore:rectangularGrid");
  });

  it("le griglie, ancora da fare, non compaiono nella colonna", () => {
    const tutti = layoutCompleto([], MOTORE_PRONTO).flatMap((gruppo) => gruppo.caselle.flat());
    expect(tutti).not.toContain("motore:rectangularGrid");
    expect(tutti).not.toContain("motore:polarGrid");
  });
});
