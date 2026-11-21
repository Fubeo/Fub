// L'ingresso del Completo (piano K6, T5): `apri` chiede l'indice e prepara il
// nucleo, e basta; un indice che non arriva non ferma niente; la vita chiusa
// butta gli esiti in volo.
import { afterEach, describe, expect, it, vi } from "vitest";
import { openLifetime, type Lifetime } from "../../../ui/lifetime";
import type { EsitoPrepara } from "./carica";
import { apri, NUCLEO } from "./index";
import { indiceDi } from "./indice";

const lifetimes: Lifetime[] = [];
afterEach(() => {
  for (const life of lifetimes.splice(0)) life.close();
});

function vita(): Lifetime {
  const life = openLifetime();
  lifetimes.push(life);
  return life;
}

describe("apri", () => {
  it("chiede l'indice e prepara il nucleo, nient'altro", async () => {
    const indice = vi.fn(() => Promise.resolve(indiceDi({ voci: [] })));
    const prepara = vi.fn((_f: string) => Promise.resolve<EsitoPrepara>("pronta"));
    const completo = apri({ motore: null, life: vita() }, { indice, prepara });
    expect(indice).toHaveBeenCalledTimes(1);
    expect(await completo.carica.famiglia(NUCLEO)).toEqual({ kind: "pronta" });
    expect(prepara.mock.calls).toEqual([[NUCLEO]]);
  });

  it("un indice che non arriva non ferma il nucleo, e si richiede", async () => {
    const indice = vi.fn()
      .mockRejectedValueOnce(new Error("chunk"))
      .mockResolvedValue(indiceDi({ voci: [] }));
    const completo = apri({ motore: null, life: vita() }, { indice, prepara: () => Promise.resolve("pronta") });
    expect(await completo.carica.famiglia(NUCLEO)).toEqual({ kind: "pronta" });
    await expect(completo.indice()).resolves.toBeDefined();
  });

  it("la vita chiusa chiude il Completo: il nucleo in volo si butta", async () => {
    let risolvi!: (e: EsitoPrepara) => void;
    const life = vita();
    const completo = apri({ motore: null, life }, {
      indice: () => Promise.resolve(indiceDi({ voci: [] })),
      prepara: () => new Promise((ok) => (risolvi = ok)),
    });
    const nucleo = completo.carica.famiglia(NUCLEO);
    life.close();
    risolvi("pronta");
    expect(await nucleo).toEqual({ kind: "assente" });
    expect(completo.carica.stato(NUCLEO).kind).not.toBe("pronta");
  });

  it("col motore senza sessione il nucleo è in errore «motore»", async () => {
    const completo = apri({ motore: null, life: vita() }, { indice: () => Promise.resolve(indiceDi({ voci: [] })) });
    expect(await completo.carica.famiglia(NUCLEO)).toEqual({ kind: "errore", perche: "motore" });
  });
});
