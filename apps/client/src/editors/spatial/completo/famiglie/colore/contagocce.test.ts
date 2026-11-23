// Il Contagocce nella colonna del Completo (K6 T14, giro 6): lo strumento `eyedropper` è fatto
// nell'indice generato (famiglia `colore`), sta nella casella «colore» con la sua icona del
// prototipo e il nome corto nelle due lingue. Il suo clic non apre una finestra: copia l'aspetto
// dell'oggetto cliccato sulla selezione, e il motore lo dice (`draw.reason.*` se rifiuta).

import { describe, expect, it } from "vitest";
import { DRAW_ICONS } from "../../../icons";
import { COLONNA_EN, COLONNA_IT } from "../../../strings/completo";
import { COMANDO_DEL_CLIC, iconaMotore, layoutCompleto, MOTORE_PRONTO } from "../../colonna";
import { toolsFor } from "../../../tools/registry";
import indiceGenerato from "../../indice.generated.json";

interface VoceGenerata {
  readonly id: string;
  readonly famiglia: string;
  readonly chiamata: { readonly strumento?: string };
}

const VOCI = (indiceGenerato as { readonly voci: readonly VoceGenerata[] }).voci;

describe("il Contagocce nella colonna", () => {
  it("è fatto nell'indice generato, della famiglia colore, e il suo id è pronto nella colonna", () => {
    const voce = VOCI.find((one) => one.chiamata.strumento === "eyedropper");
    expect(voce?.famiglia).toBe("colore");
    expect(MOTORE_PRONTO.has("eyedropper")).toBe(true);
  });

  it("ha il nome corto nelle due lingue e l'icona del prototipo", () => {
    expect(COLONNA_IT["draw.engine.name.eyedropper"]).toBe("Contagocce");
    expect(COLONNA_EN["draw.engine.name.eyedropper"]).toBe("Eyedropper");
    expect(iconaMotore("eyedropper")).toBe("draw-eyedropper");
    expect(DRAW_ICONS["draw-eyedropper"]).toBeDefined();
  });

  it("sta nel gruppo «colore», nella sua casella con la Misura, come in VectorCraft", () => {
    const gruppo = layoutCompleto(toolsFor("full", "vector"), MOTORE_PRONTO).find((g) => g.id === "color");
    const casella = gruppo?.caselle.find((c) => c.includes("motore:eyedropper")) ?? [];
    expect(casella).toEqual(["motore:eyedropper", "motore:measure"]);
  });

  it("il suo clic non apre una finestra: il gesto copia l'aspetto sulla selezione", () => {
    expect(COMANDO_DEL_CLIC["eyedropper"]).toBeUndefined();
  });
});
