// La voce «Imposta angoli» del Disegno completo (K6 T12, giro angoli; `addon.pathtools.cornerSet`): dall'indice
// manda `disegno.addon.pathtools.cornerSet`, ha la sua finestra col raggio (da 0 a 1000000 punti), e il
// raggio è il campo che la finestra manda al motore. «Rimuovi angoli» non c'è ancora nell'indice: la sua
// ricetta riscritta non si applica nella scena del client (vedi la mappa, `addon.pathtools.cornerRemove`).
import { describe, expect, it } from "vitest";
import { indiceDi, type VoceIndice } from "./indice";
import indiceGenerato from "./indice.generated.json";
import schemaTracciati from "./famiglie/tracciati/schema.generated.json";

interface CampoSchema {
  readonly nome: string;
  readonly tipo: string;
  readonly minimo?: number;
  readonly massimo?: number;
}

describe("Imposta angoli (addon.pathtools.cornerSet)", () => {
  const indice = indiceDi(indiceGenerato as never);
  const voce: VoceIndice | undefined = indice.voci.find((v) => v.id === "addon.pathtools.cornerSet");

  it("la voce manda disegno.addon.pathtools.cornerSet, con finestra, nel posto Design", () => {
    expect(voce).toBeDefined();
    expect(voce!.chiamata).toEqual({ comando: "disegno.addon.pathtools.cornerSet" });
    expect(voce!.finestra).toBe(true);
    expect(voce!.famiglia).toBe("tracciati");
    expect(voce!.posto).toBe("ispettore/design");
  });

  it("la finestra chiede il raggio, numero da 0 a 1000000 punti, come il motore", () => {
    const finestra = (schemaTracciati as { finestre: { id: string; campi: CampoSchema[] }[] }).finestre.find(
      (f) => f.id === "addon.pathtools.cornerSet",
    );
    expect(finestra).toBeDefined();
    const raggio = finestra!.campi.find((c) => c.nome === "radius");
    expect(raggio).toMatchObject({ tipo: "numero", minimo: 0, massimo: 1000000 });
  });

  it("«Rimuovi angoli» non è ancora nell'indice: la sua riga è da fare", () => {
    expect(indice.voci.some((v) => v.id === "addon.pathtools.cornerRemove")).toBe(false);
  });
});
