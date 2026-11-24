// @vitest-environment happy-dom
// Grassetto, Corsivo e Sottolineato (menu Testo, Ctrl+Maiusc+U di VectorCraft): voci del client che
// leggono il carattere del primo testo scelto (`document.node`) e le facce della sua famiglia
// (`text.fontList`), poi mandano `text.setRangeStyle`. È la prova delle tre righe `interfaccia` di
// testo.json, in una sessione del Completo vera, e della scelta della faccia (`toggle_face`).

import { describe, expect, it, vi } from "vitest";
import { t } from "../../../strings";
import { openLifetime } from "../../../../../ui/lifetime";
import type { MotoreDelDisegno } from "../../../motore/gesti";
import type { SessioneMotore } from "../../../motore/sessione";
import { apri } from "../../index";
import { indiceDi } from "../../indice";
import indiceGenerato from "../../indice.generated.json";
import { facciaDi, passoDiStile, primoCarattere, scegliFaccia } from "../../facce-testo";

const giro = (): Promise<void> => new Promise((risolto) => setTimeout(risolto, 0));

const STILI = ["Regular", "Italic", "Bold", "Bold Italic", "SemiBold", "Narrow", "Narrow Bold", "Narrow Italic"];

describe("La faccia di Grassetto e Corsivo", () => {
  it("legge peso, corsivo e le altre parole dal nome", () => {
    expect(facciaDi("Bold Italic")).toEqual({ grassetto: true, normale: false, corsivo: true, resto: [] });
    expect(facciaDi("Narrow-Oblique")).toEqual({ grassetto: false, normale: true, corsivo: true, resto: ["narrow"] });
    expect(facciaDi("SemiBold")).toEqual({ grassetto: false, normale: false, corsivo: false, resto: [] });
  });

  it("sceglie la faccia della famiglia con le stesse altre parole, il nome più corto", () => {
    expect(scegliFaccia(STILI, true, false, "Regular")).toBe("Bold");
    expect(scegliFaccia(STILI, true, true, "Italic")).toBe("Bold Italic");
    expect(scegliFaccia(STILI, true, false, "Narrow")).toBe("Narrow Bold");
    expect(scegliFaccia(STILI, false, true, "Narrow Bold")).toBe("Narrow Italic");
    expect(scegliFaccia(["Regular", "Regular Text", "Bold"], false, false, "Bold")).toBe("Regular");
    expect(scegliFaccia(STILI, true, true, "Narrow")).toBeNull();
  });

  it("Grassetto e Corsivo invertono il loro e tengono l'altro; senza la faccia dicono perché", () => {
    const di = (stile: string) => ({ famiglia: "Inter", stile, sottolineato: false });
    expect(passoDiStile("type.bold", di("Italic"), STILI)).toEqual({ valore: { style: "Bold Italic" } });
    expect(passoDiStile("type.bold", di("Bold"), STILI)).toEqual({ valore: { style: "Regular" } });
    expect(passoDiStile("type.italic", di("Bold"), STILI)).toEqual({ valore: { style: "Bold Italic" } });
    expect(passoDiStile("type.italic", di("Regular"), ["Regular", "Bold"])).toEqual({ perche: "famiglia", famiglia: "Inter", faccia: "Italic" });
    expect(passoDiStile("type.underline", { ...di("Regular"), sottolineato: true }, [])).toEqual({ valore: { underline: false } });
  });

  it("trova il primo testo anche dentro un gruppo", () => {
    const testo = { kind: { type: "text", runs: [{ style: { font_family: "Inter", font_style: "Bold", underline: true } }] } };
    expect(primoCarattere({ kind: { type: "group", children: [{ kind: { type: "path" } }, testo] } })).toEqual({ famiglia: "Inter", stile: "Bold", sottolineato: true });
    expect(primoCarattere({ kind: { type: "path" } })).toBeNull();
  });
});

function completoVero(radice: HTMLElement | null = null) {
  const stato = { conTesto: true, stile: "Regular", sottolineato: false, stili: STILI };
  const esito = (reading: unknown = null) => ({ revision: "1", preview: null, ops: "[]", selection: ["t1"], losses: [], refused: null, frame: null, reading });
  const comando = vi.fn((passo: { readonly id: string; readonly value?: unknown }) => {
    if (passo.id === "disegno.document.node")
      return Promise.resolve(esito({ kind: { type: "text", runs: [{ style: { font_family: "Inter", font_style: stato.stile, underline: stato.sottolineato } }] } }));
    if (passo.id === "disegno.text.fontList") return Promise.resolve(esito({ family: "Inter", styles: stato.stili }));
    return Promise.resolve(esito());
  });
  const comandi = vi.fn(() =>
    Promise.resolve([
      stato.conTesto
        ? { id: "disegno.text.setRangeStyle", enabled: true, disabled_reason: null }
        : { id: "disegno.text.setRangeStyle", enabled: false, disabled_reason: "needs_text" },
    ]),
  );
  const annuncia = vi.fn();
  const sessione = { comandi, comando } as unknown as SessioneMotore;
  const motore = { adesso: () => sessione, pronta: () => Promise.resolve(sessione), assente: () => null } as unknown as MotoreDelDisegno;
  const completo = apri(
    { motore, life: openLifetime() } as never,
    {
      indice: () => Promise.resolve(indiceDi(indiceGenerato as never)),
      prepara: () => Promise.resolve("pronta"),
      moduli: { "./famiglie/testo/index.ts": () => Promise.resolve({ default: { registra: () => undefined } }) },
      tasti: { ...(radice === null ? {} : { radice }), selezione: () => ["t1"], annuncia, leggi: () => [], commit: () => true, seleziona: () => undefined } as never,
    } as never,
  );
  const voce = async (id: string) =>
    (await completo.ricerca(() => ["t1"], { strumento: vi.fn(), client: vi.fn(), riprova: vi.fn() } as never))!.find((v) => v.key === id)!;
  const mandati = () => comando.mock.calls.map(([passo]) => passo).filter((passo) => passo.id === "disegno.text.setRangeStyle");
  return { completo, comando, voce, annuncia, stato, mandati };
}

describe("Grassetto, Corsivo e Sottolineato dal menu Testo", () => {
  it("stanno nel menu Testo; Sottolineato col tasto di VectorCraft", () => {
    const voci = (indiceGenerato as unknown as { readonly voci: readonly { id: string; posto: string; chiamata: unknown; tasto?: string | null }[] }).voci;
    for (const id of ["type.bold", "type.italic", "type.underline"]) {
      const voce = voci.find((una) => una.id === id)!;
      expect(voce.posto, id).toBe("menu/testo");
      expect(voce.chiamata, id).toEqual({ client: id });
    }
    expect(voci.find((una) => una.id === "type.underline")!.tasto).toBe("Cmd+Shift+U");
  });

  it("senza un testo scelto sono spente col perché del motore", async () => {
    const { completo, comando, voce, stato } = completoVero();
    stato.conTesto = false;
    for (const id of ["type.bold", "type.italic", "type.underline"]) {
      const una = await voce(id);
      expect(una.disabled, id).toBe(true);
      expect(una.description, id).toBe(t("draw.disabled.needs_text"));
    }
    expect(comando).not.toHaveBeenCalled();
    completo.chiudi();
  });

  it("mandano la faccia della famiglia e il sottolineato inverso", async () => {
    const { completo, voce, stato, mandati } = completoVero();
    stato.stile = "Italic";
    (await voce("type.bold")).run();
    await vi.waitFor(() => expect(mandati()).toHaveLength(1));
    expect(mandati()[0]).toMatchObject({ value: { style: "Bold Italic" }, selection: ["t1"] });
    (await voce("type.italic")).run();
    await vi.waitFor(() => expect(mandati()).toHaveLength(2));
    expect(mandati()[1]).toMatchObject({ value: { style: "Regular" } });
    stato.sottolineato = true;
    (await voce("type.underline")).run();
    await vi.waitFor(() => expect(mandati()).toHaveLength(3));
    expect(mandati()[2]).toMatchObject({ value: { underline: false } });
    completo.chiudi();
  });

  it("una famiglia senza la faccia resta com'è e la voce dice perché", async () => {
    const { completo, voce, stato, mandati, annuncia } = completoVero();
    stato.stili = ["Regular", "Bold"];
    (await voce("type.italic")).run();
    await vi.waitFor(() => expect(annuncia).toHaveBeenCalledWith(t("draw.testo.facciaMancante", { famiglia: "Inter", faccia: "Italic" })));
    await giro();
    expect(mandati()).toHaveLength(0);
    completo.chiudi();
  });

  it("Ctrl+Maiusc+U sottolinea il testo scelto", async () => {
    const radice = document.createElement("div");
    document.body.append(radice);
    const { completo, mandati } = completoVero(radice);
    await giro();
    radice.dispatchEvent(new KeyboardEvent("keydown", { key: "U", code: "KeyU", ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true }));
    await vi.waitFor(() => expect(mandati()).toHaveLength(1));
    expect(mandati()[0]).toMatchObject({ value: { underline: true } });
    completo.chiudi();
    radice.remove();
  });
});
