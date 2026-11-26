// @vitest-environment happy-dom
// La famiglia «testo», giro 1 (K6 T16): le sezioni del Design `character` (Carattere) e `paragraph`
// (Paragrafo) in una sessione del Completo vera. Ci sono solo con un testo scelto; mostrano ciò che
// il pannello ha già (la famiglia, lo stile, il corpo, la spaziatura, l'allineamento); ogni cambio
// manda un comando solo al motore, dal percorso unico: `text.setRangeStyle` con quel valore, o
// `text.setStyle {justify}`.
import { describe, expect, it, vi } from "vitest";
import { openLifetime } from "../../../../../ui/lifetime";
import type { MotoreDelDisegno } from "../../../motore/gesti";
import type { SessioneMotore } from "../../../motore/sessione";
import { t } from "../../../strings";
import { apri } from "../../index";
import { indiceDi } from "../../indice";
import indiceGenerato from "../../indice.generated.json";
import type { Selezione, TestoSelezione } from "../../sezioni";
import { facciaDi, primaFamiglia, sceltaDelleFamiglie } from "../../testo-sezioni";
import famiglia from "./index";

vi.mock("../../../motore/finestre", () => ({ apriFinestra: vi.fn(() => Promise.resolve(true)) }));

const ESITO = { revision: "1", preview: null, ops: "[]", selection: ["ot1t1t1t1"], losses: [], refused: null, frame: null };

function motoreFinto() {
  const comando = vi.fn((_passo: unknown) => Promise.resolve(ESITO));
  const comandi = vi.fn(() => Promise.resolve([]));
  const sessione = { comandi, comando } as unknown as SessioneMotore;
  const motore = { adesso: () => sessione, pronta: () => Promise.resolve(sessione), assente: () => null } as unknown as MotoreDelDisegno;
  return { motore, comando };
}

const TESTO: TestoSelezione = {
  famiglia: "Inter, sans-serif",
  famiglie: [
    { valore: "Inter, sans-serif", nome: "Inter" },
    { valore: "Literata, serif", nome: "Literata" },
    { valore: "JetBrains Mono, monospace", nome: "JetBrains Mono" },
    { valore: "Noto Serif", nome: "Noto Serif" },
  ],
  corpo: { valore: 24, unita: "pt", decimali: 1, allaScena: (valore) => (valore * 4) / 3 },
  peso: 700,
  corsivo: false,
  spaziatura: 5,
  allineamento: "start",
};

/// Il Completo con l'indice vero e la famiglia `testo` spiata.
function completo() {
  const caricati: string[] = [];
  const { motore, comando } = motoreFinto();
  const c = apri(
    { motore, life: openLifetime() } as never,
    {
      indice: () => Promise.resolve(indiceDi(indiceGenerato as never)),
      prepara: () => Promise.resolve("pronta"),
      moduli: {
        "./famiglie/testo/index.ts": () => {
          caricati.push("testo");
          return import("./index");
        },
      },
      tasti: { selezione: () => ["ot1t1t1t1"], annuncia: vi.fn() } as never,
    } as never,
  );
  const sezione = (id: string) => c.sezioni.di("design").find((una) => una.id === id)!;
  const disegna = (id: string, testo: TestoSelezione = TESTO): HTMLElement => {
    const corpo = document.createElement("div");
    document.body.append(corpo);
    const sel: Selezione = { numero: 1, punti: [], testo };
    sezione(id).disegna({ corpo, sel, motore, misure: {}, colori: {}, aggiorna: () => undefined, rileggi: () => undefined, vita: openLifetime() });
    return corpo;
  };
  return { c, caricati, comando, sezione, disegna };
}

/// I comandi arrivati al motore, per id e valore.
async function arrivati(comando: ReturnType<typeof motoreFinto>["comando"], quanti: number) {
  await vi.waitFor(() => expect(comando).toHaveBeenCalledTimes(quanti));
  return comando.mock.calls.map(([passo]) => {
    const { id, value } = passo as { id: string; value: unknown };
    return [id, value];
  });
}

/// Scrive `valore` nel campo numerico che si chiama `nome`, e lo conferma con Invio.
function scriviNelCampo(corpo: HTMLElement, nome: string, valore: string): void {
  const campo = [...corpo.querySelectorAll<HTMLInputElement>("input")].find((uno) => uno.getAttribute("aria-label")?.startsWith(nome) || corpo.querySelector(`label[for="${uno.id}"]`)?.textContent === nome)!;
  campo.focus();
  campo.value = valore;
  campo.dispatchEvent(new Event("input", { bubbles: true }));
  campo.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
}

describe("la famiglia testo, giro 1", () => {
  it("il modulo porta le sue parole e non registra altro: character e paragraph le mette il Completo", () => {
    expect(famiglia.testi).toBeDefined();
    expect(typeof famiglia.registra).toBe("function");
  });

  it("character e paragraph ci sono nel Design, solo con un testo scelto, senza caricare la famiglia", async () => {
    const { c, caricati, sezione } = completo();
    await new Promise((risolto) => setTimeout(risolto, 0));
    expect(caricati).toEqual([]);
    expect(sezione("character").titolo).toBe(t("draw.carattere.titolo"));
    expect(sezione("paragraph").titolo).toBe(t("draw.paragrafo.titolo"));
    for (const id of ["character", "paragraph"]) {
      expect(sezione(id).quando!({ numero: 1, punti: [] })).toBe(false);
      expect(sezione(id).quando!({ numero: 1, punti: [], testo: TESTO })).toBe(true);
    }
    c.chiudi();
  });
});

describe("Carattere (character)", () => {
  it("mostra la famiglia, lo stile, il corpo e la spaziatura del testo scelto", () => {
    const { c, disegna } = completo();
    const corpo = disegna("character");
    const pulsante = corpo.querySelector<HTMLButtonElement>(".kit-font-button")!;
    expect(pulsante.textContent).toBe("Inter");
    expect(pulsante.getAttribute("aria-label")).toBe(`${t("draw.carattere.famiglia")}: Inter`);
    const stile = corpo.querySelector<HTMLSelectElement>(".draw-type-style select")!;
    expect(stile.selectedOptions[0]!.textContent).toBe(t("draw.properties.weight.bold"));
    const numeri = [...corpo.querySelectorAll<HTMLInputElement>(".draw-type-sizes input")].map((campo) => campo.value);
    expect(numeri).toEqual(["24", "5"]);
    c.chiudi();
  });

  it("un testo misto dice «più caratteri» e lo stile misto; il carattere di serie ha il suo nome", () => {
    const { c, disegna } = completo();
    const misto = disegna("character", { ...TESTO, famiglia: null, peso: null });
    expect(misto.querySelector(".kit-font-button")!.textContent).toBe(t("draw.carattere.misto"));
    const stile = misto.querySelector<HTMLSelectElement>(".draw-type-style select")!;
    expect(stile.value).toBe("");
    expect(stile.selectedOptions[0]!.textContent).toBe(t("draw.properties.mixed"));
    const diSerie = disegna("character", { ...TESTO, famiglia: "", famiglie: [{ valore: "", nome: "Predefinito" }, ...TESTO.famiglie] });
    expect(diSerie.querySelector(".kit-font-button")!.textContent).toBe("Predefinito");
    c.chiudi();
  });

  it("una famiglia scelta manda text.setRangeStyle col suo nome, un comando solo", async () => {
    const { c, comando, disegna } = completo();
    const corpo = disegna("character");
    corpo.querySelector<HTMLButtonElement>(".kit-font-button")!.click();
    const riga = [...document.querySelectorAll<HTMLElement>(".kit-font-popover [role='option']")].find((una) => una.textContent?.includes("Noto Serif"))!;
    riga.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    riga.click();
    expect(await arrivati(comando, 1)).toEqual([["disegno.text.setRangeStyle", { font: "Noto Serif" }]]);
    c.chiudi();
  });

  it("lo stile, il corpo e la spaziatura mandano un comando ciascuno, nelle unità del motore", async () => {
    const { c, comando, disegna } = completo();
    const corpo = disegna("character");
    const stile = corpo.querySelector<HTMLSelectElement>(".draw-type-style select")!;
    stile.value = "400i";
    stile.dispatchEvent(new Event("change", { bubbles: true }));
    expect(await arrivati(comando, 1)).toEqual([["disegno.text.setRangeStyle", { style: "Italic" }]]);
    scriviNelCampo(corpo, t("draw.carattere.corpo"), "30");
    expect((await arrivati(comando, 2))[1]).toEqual(["disegno.text.setRangeStyle", { size: 40 }]);
    scriviNelCampo(corpo, t("draw.carattere.spaziatura"), "10");
    expect((await arrivati(comando, 3))[2]).toEqual(["disegno.text.setRangeStyle", { tracking: 100 }]);
    c.chiudi();
  });

  it("le facce e le famiglie si dicono come le legge il motore", () => {
    expect(facciaDi(400, false)).toBe("Regular");
    expect(facciaDi(400, true)).toBe("Italic");
    expect(facciaDi(700, true)).toBe("Bold Italic");
    expect(facciaDi(600, false)).toBe("SemiBold");
    expect(facciaDi(100, false)).toBe("Thin");
    expect(primaFamiglia('"Noto Serif", serif')).toBe("Noto Serif");
    expect(sceltaDelleFamiglie(TESTO.famiglie)).toEqual([
      { family: "Inter", source: "system", generic: "sans-serif" },
      { family: "Literata", source: "system", generic: "serif" },
      { family: "JetBrains Mono", source: "system", generic: "monospace" },
      { family: "Noto Serif", source: "document" },
    ]);
  });
});

describe("Paragrafo (paragraph)", () => {
  it("mostra l'allineamento del testo, e uno nuovo manda text.setStyle una volta; quello di adesso niente", async () => {
    const { c, comando, disegna } = completo();
    const corpo = disegna("paragraph");
    const pulsanti = [...corpo.querySelectorAll<HTMLButtonElement>(".draw-properties-segment")];
    expect(pulsanti.map((uno) => uno.getAttribute("aria-label"))).toEqual([t("draw.paragrafo.sinistra"), t("draw.paragrafo.centro"), t("draw.paragrafo.destra")]);
    expect(pulsanti.map((uno) => uno.getAttribute("aria-pressed"))).toEqual(["true", "false", "false"]);
    pulsanti[0]!.click();
    pulsanti[1]!.click();
    expect(await arrivati(comando, 1)).toEqual([["disegno.text.setStyle", { justify: "center" }]]);
    pulsanti[2]!.click();
    expect((await arrivati(comando, 2))[1]).toEqual(["disegno.text.setStyle", { justify: "right" }]);
    c.chiudi();
  });
});
