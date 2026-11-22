// L'ingresso del Completo (piano K6, T5): `apri` chiede l'indice e prepara il
// nucleo, e basta; un indice che non arriva non ferma niente; la vita chiusa
// butta gli esiti in volo.
import { afterEach, describe, expect, it, vi } from "vitest";
import { openLifetime, type Lifetime } from "../../../ui/lifetime";
import type { EsitoPrepara } from "./carica";
import { apri, NUCLEO } from "./index";
import { creaIndice, indiceDi } from "./indice";

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
    // L'indice si carica una volta sola (memorizzato): il montaggio dei tasti e il
    // Completo lo chiedono entrambi, e il caricatore lo porta una volta.
    const caricaIndice = vi.fn(() => Promise.resolve({ voci: [] }));
    const indice = creaIndice(caricaIndice);
    const prepara = vi.fn((_f: string) => Promise.resolve<EsitoPrepara>("pronta"));
    const completo = apri({ motore: null, life: vita() }, { indice, prepara });
    expect(caricaIndice).toHaveBeenCalledTimes(1);
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

/// Le azioni di un editor finto per le voci del menu e della ricerca.
function azioniFinte(riprova = vi.fn()) {
  return { strumento: vi.fn(), riprova };
}

describe("menu e ricerca del Completo (K6 T9a)", () => {
  it("il menu dice che l'indice non si è caricato, e «Riprova» lo chiede di nuovo", async () => {
    const completo = apri({ motore: null, life: vita() }, {
      indice: () => Promise.reject(new Error("chunk")),
      prepara: () => Promise.resolve("pronta"),
    });
    const riprova = vi.fn();
    const menu = await completo.menu(() => [], azioniFinte(riprova));
    expect(menu[0]).toMatchObject({ label: "Il catalogo dei comandi non si è caricato.", disabled: true });
    menu[1]?.run?.();
    expect(riprova).toHaveBeenCalledTimes(1);
  });

  it("la ricerca che non ha l'indice risponde null, perché chi la mostra dica «Riprova»", async () => {
    const completo = apri({ motore: null, life: vita() }, {
      indice: () => Promise.reject(new Error("chunk")),
      prepara: () => Promise.resolve("pronta"),
    });
    expect(await completo.ricerca(() => [], azioniFinte())).toBeNull();
  });

  it("la prima ricerca carica l'indice, e nessuna famiglia", async () => {
    const famiglia = vi.fn(() => Promise.resolve({ registra: () => undefined }));
    const prepara = vi.fn((_f: string) => Promise.resolve<EsitoPrepara>("pronta"));
    const completo = apri({ motore: null, life: vita() }, {
      indice: () => Promise.resolve(indiceDi({ voci: [{ fonte: "motore", id: "a", chiamata: { comando: "disegno.a" }, etichetta: { it: "Voce a", en: "Item a" }, posto: "menu/oggetto", famiglia: "forme", tasto: null, effetto: "cambia", finestra: false }] })),
      prepara,
      moduli: { "./famiglie/forme/index.ts": famiglia },
    });
    const prima = prepara.mock.calls.length;
    const righe = await completo.ricerca(() => [], azioniFinte());
    expect(righe?.map((riga) => riga.label)).toEqual(["Voce a"]);
    expect(prepara.mock.calls.length).toBe(prima);
    expect(famiglia).not.toHaveBeenCalled();
  });

  it("col motore spento le voci del motore sono spente, e lo dicono", async () => {
    const completo = apri({ motore: null, life: vita() }, {
      indice: () => Promise.resolve(indiceDi({ voci: [{ fonte: "motore", id: "a", chiamata: { comando: "disegno.a" }, etichetta: { it: "Voce a", en: "Item a" }, posto: "menu/oggetto", famiglia: "forme", tasto: "Ctrl+J", effetto: "cambia", finestra: false }] })),
      prepara: () => Promise.resolve("pronta"),
    });
    const menu = await completo.menu(() => [], azioniFinte());
    const oggetto = menu.find((item) => item.label === "Oggetto");
    const voci = typeof oggetto?.items === "object" ? oggetto.items : [];
    expect(voci[0]).toMatchObject({ label: "Voce a", hint: "Ctrl+J", disabled: true, description: "Motore del disegno spento." });
  });
});
