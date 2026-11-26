// Gli strumenti di trasformazione nella colonna del Completo (piano K6, T13, giro 5):
// Ruota, Rifletti, Scala, Inclina, Rimodella e Trasformazione libera stanno nella casella «modificare» (`rotate`, nel gruppo
// `modify`), con il nome corto nelle due lingue, un'icona del catalogo e il clic che apre la
// finestra del loro comando sulla selezione. Ogni strumento «fatto» dell'indice generato è
// qui, e ogni clic punta a una finestra della famiglia `trasforma`.

import { describe, expect, it } from "vitest";
import { DRAW_ICONS } from "../../../icons";
import { COLONNA_EN, COLONNA_IT } from "../../../strings/completo";
import { COMANDO_DEL_CLIC, iconaMotore, layoutCompleto, MOTORE_PRONTO } from "../../colonna";
import { toolsFor } from "../../../tools/registry";
import indiceGenerato from "../../indice.generated.json";

interface VoceGenerata {
  readonly id: string;
  readonly famiglia: string;
  readonly finestra: boolean;
  readonly chiamata: { readonly strumento?: string; readonly comando?: string; readonly valore?: unknown };
}

const VOCI = (indiceGenerato as { readonly voci: readonly VoceGenerata[] }).voci;
const STRUMENTI_TRASFORMA = ["rotate", "reflect", "scale", "shear", "reshape", "freeTransform", "puppetWarp"];
const CLIC_TRASFORMA: readonly [string, string][] = [
  ["rotate", "object.rotate"],
  ["reflect", "object.reflect"],
  ["scale", "object.scale"],
  ["shear", "object.shear"],
];

describe("gli strumenti di trasformazione nella colonna", () => {
  it("sono fatti nell'indice generato: Ruota, Rifletti, Scala, Inclina, Rimodella, Trasformazione libera e Marionetta, della famiglia trasforma", () => {
    const fatti = VOCI.filter((voce) => voce.famiglia === "trasforma" && voce.chiamata.strumento !== undefined).map((voce) => voce.chiamata.strumento);
    expect(fatti.sort()).toEqual([...STRUMENTI_TRASFORMA].sort());
    for (const id of STRUMENTI_TRASFORMA) expect(MOTORE_PRONTO.has(id), id).toBe(true);
  });

  it("ogni strumento ha il nome corto nelle due lingue e un'icona del catalogo", () => {
    for (const id of STRUMENTI_TRASFORMA) {
      const chiave = `draw.engine.name.${id}`;
      expect(COLONNA_IT[chiave as keyof typeof COLONNA_IT].trim(), id).not.toBe("");
      expect(COLONNA_EN[chiave as keyof typeof COLONNA_EN].trim(), id).not.toBe("");
      expect(DRAW_ICONS[iconaMotore(id)], id).toBeDefined();
    }
    expect(COLONNA_IT["draw.engine.name.rotate"]).toBe("Ruota");
    expect(COLONNA_IT["draw.engine.name.reflect"]).toBe("Rifletti");
    expect(COLONNA_IT["draw.engine.name.scale"]).toBe("Scala");
    expect(COLONNA_IT["draw.engine.name.shear"]).toBe("Inclina");
  });

  it("Rimodella ha la sua curva tirata, non l'icona di «Tutti gli strumenti»", () => {
    expect(iconaMotore("reshape")).toBe("draw-reshape");
    expect(COLONNA_IT["draw.engine.name.reshape"]).toBe("Rimodella");
    expect(DRAW_ICONS["draw-reshape"]).not.toEqual(DRAW_ICONS["draw-all-tools"]);
  });

  it("Inclina ha il suo parallelogramma, non l'icona di «Tutti gli strumenti»", () => {
    expect(iconaMotore("shear")).toBe("draw-shear");
    expect(iconaMotore("shear")).not.toBe("draw-all-tools");
    expect(DRAW_ICONS["draw-shear"]).toBeDefined();
    expect(DRAW_ICONS[iconaMotore("shear")]).not.toEqual(DRAW_ICONS["draw-all-tools"]);
  });

  it("stanno nel gruppo «modificare», nella casella della Ruota, con la Marionetta in fondo", () => {
    const gruppo = layoutCompleto(toolsFor("full", "vector"), MOTORE_PRONTO).find((g) => g.id === "modify");
    const casella = gruppo?.caselle.find((c) => c.includes("motore:rotate")) ?? [];
    expect(casella).toEqual(["motore:rotate", "motore:reflect", "motore:scale", "motore:shear", "motore:reshape", "motore:freeTransform", "motore:puppetWarp"]);
  });

  it("Altera marionetta ha la sua icona, non quella di «Tutti gli strumenti»", () => {
    expect(iconaMotore("puppetWarp")).toBe("draw-puppet-warp");
    expect(COLONNA_IT["draw.engine.name.puppetWarp"]).toBe("Altera marionetta");
    expect(DRAW_ICONS["draw-puppet-warp"]).not.toEqual(DRAW_ICONS["draw-all-tools"]);
  });
});

describe("il clic di una trasformazione apre la sua finestra sulla selezione", () => {
  it("ogni strumento ha il comando `object.*` con finestra, della famiglia trasforma, senza punto", () => {
    for (const [strumento, comando] of CLIC_TRASFORMA) {
      const clic = COMANDO_DEL_CLIC[strumento];
      expect(clic, strumento).toEqual({ comando, sullaSelezione: true });
      const voce = VOCI.find((one) => one.id === comando);
      expect(voce, comando).toBeDefined();
      expect(voce!.finestra, comando).toBe(true);
      expect(voce!.famiglia, comando).toBe("trasforma");
    }
  });
});
