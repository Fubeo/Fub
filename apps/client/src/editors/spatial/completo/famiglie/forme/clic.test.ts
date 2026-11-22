// Il clic di una forma apre la finestra delle misure del suo comando (T13, giro 2).
// Lo schema (`schema.generated.json`) e l'indice vengono dal banco: qui si guarda
// che i dati reggano il percorso (il punto fuori dai campi, le parole, i minimi e i
// valori di partenza). Il percorso in sé è in `completo/esegui.test.ts`.

import { describe, expect, it } from "vitest";
import { COMANDO_DEL_CLIC } from "../../colonna";
import indiceGenerato from "../../indice.generated.json";
import schemaForme from "./schema.generated.json";
import { TESTI } from "./testi";

interface CampoSchema {
  readonly nome: string;
  readonly minimo?: number;
  readonly predefinito?: unknown;
}

const FINESTRE = (schemaForme as { readonly finestre: readonly { readonly id: string; readonly campi: readonly CampoSchema[] }[] }).finestre;
const VOCI = (indiceGenerato as { readonly voci: readonly { readonly id: string; readonly finestra: boolean; readonly famiglia: string }[] }).voci;

function finestra(id: string): { readonly id: string; readonly campi: readonly CampoSchema[] } {
  const trovata = FINESTRE.find((one) => one.id === id);
  if (trovata === undefined) throw new Error(`manca la finestra ${id}`);
  return trovata;
}

// Gli strumenti di forma (giro 2): hanno il punto del clic. Le trasformazioni (giro 5)
// stanno in `famiglie/trasforma/clic.test.ts`.
const FORME: ReadonlySet<string> = new Set(["rectangle", "ellipse", "polygon", "star", "lineSegment", "arc", "spiral"]);

describe("il clic di una forma apre la finestra del suo comando", () => {
  it("ogni forma del clic ha un comando con finestra, della famiglia forme", () => {
    for (const [strumento, { comando: forma }] of Object.entries(COMANDO_DEL_CLIC)) {
      if (!FORME.has(strumento)) continue;
      const voce = VOCI.find((one) => one.id === forma);
      expect(voce, strumento).toBeDefined();
      expect(voce!.finestra, strumento).toBe(true);
      expect(voce!.famiglia, strumento).toBe("forme");
    }
  });

  it("il punto del clic è nello schema, e il Completo non lo chiede: il resto ha una parola", () => {
    for (const [strumento, { comando: forma, x, y }] of Object.entries(COMANDO_DEL_CLIC)) {
      if (!FORME.has(strumento) || x === undefined || y === undefined) continue;
      const nomi = finestra(forma).campi.map((campo) => campo.nome);
      expect(nomi, strumento).toContain(x);
      expect(nomi, strumento).toContain(y);
      for (const campo of finestra(forma).campi) {
        if (campo.nome === x || campo.nome === y) continue;
        expect(TESTI[`campo:${campo.nome}`], `${forma}.${campo.nome}`).toBeDefined();
      }
    }
  });

  it("le larghezze e le altezze hanno il minimo che la finestra fa rispettare", () => {
    const rettangolo = finestra("shape.rectangle");
    expect(rettangolo.campi.find((campo) => campo.nome === "width")?.minimo).toBe(0.01);
    expect(rettangolo.campi.find((campo) => campo.nome === "height")?.minimo).toBe(0.01);
  });

  it("i valori di partenza vengono dal motore: sides=6 e decay=80", () => {
    expect(finestra("shape.polygon").campi.find((campo) => campo.nome === "sides")?.predefinito).toBe(6);
    expect(finestra("shape.spiral").campi.find((campo) => campo.nome === "decay")?.predefinito).toBe(80);
  });

  it("il Rettangolo arrotondato non ha un clic: la sua finestra non porta il raggio d'angolo", () => {
    expect(COMANDO_DEL_CLIC.roundedRectangle).toBeUndefined();
  });
});
