// @vitest-environment happy-dom
// «Applica ultimo effetto» e «Ultimo effetto…» (menu Effetto): voci del client, come in
// VectorCraft. Spente col perché finché non c'è un effetto applicato dal menu; poi la prima lo
// rifà sugli oggetti scelti adesso, la seconda lo rilancia (con la sua finestra, se ne ha una).
// È la prova delle due righe `interfaccia` di effetti.json, in una sessione del Completo vera.

import { describe, expect, it, vi } from "vitest";
import { t } from "../../../strings";
import { openLifetime } from "../../../../../ui/lifetime";
import type { MotoreDelDisegno } from "../../../motore/gesti";
import type { SessioneMotore } from "../../../motore/sessione";
import { apri } from "../../index";
import { indiceDi } from "../../indice";
import indiceGenerato from "../../indice.generated.json";

const giro = (): Promise<void> => new Promise((risolto) => setTimeout(risolto, 0));

function completoVero(rifiuto: string | null = null, pila: unknown = null, radice: HTMLElement | null = null) {
  const esito = { revision: "1", preview: null, ops: rifiuto === null ? "[]" : null, selection: ["k1"], losses: [], refused: rifiuto, frame: null };
  const comando = vi.fn((passo: { readonly id: string; readonly value?: unknown }) =>
    Promise.resolve(passo.id === "disegno.effect.list" ? { ...esito, ops: null, reading: pila } : esito),
  );
  const annuncia = vi.fn();
  const sessione = { comandi: vi.fn(() => Promise.resolve([])), comando } as unknown as SessioneMotore;
  const motore = { adesso: () => sessione, pronta: () => Promise.resolve(sessione), assente: () => null } as unknown as MotoreDelDisegno;
  const completo = apri(
    { motore, life: openLifetime() } as never,
    {
      indice: () => Promise.resolve(indiceDi(indiceGenerato as never)),
      prepara: () => Promise.resolve("pronta"),
      moduli: { "./famiglie/effetti/index.ts": () => Promise.resolve({ default: { registra: () => undefined } }) },
      tasti: { ...(radice === null ? {} : { radice }), selezione: () => ["k1"], annuncia, leggi: () => [], commit: () => true, seleziona: () => undefined } as never,
    } as never,
  );
  const voce = async (id: string) =>
    (await completo.ricerca(() => ["k1"], { strumento: vi.fn(), client: vi.fn(), riprova: vi.fn() } as never))!.find((v) => v.key === id)!;
  return { completo, comando, voce, annuncia };
}

describe("Applica ultimo effetto e Ultimo effetto", () => {
  it("stanno nel menu Effetto, come voci del client", () => {
    const voci = (indiceGenerato as unknown as { readonly voci: readonly { id: string; posto: string; chiamata: unknown }[] }).voci;
    for (const id of ["effect.applyLast", "effect.last"]) {
      const voce = voci.find((una) => una.id === id)!;
      expect(voce.posto, id).toBe("menu/effetto");
      expect(voce.chiamata, id).toEqual({ client: id });
    }
  });

  it("sono spente col perché finché non c'è un effetto, poi lo rifanno", async () => {
    const { completo, comando, voce } = completoVero();
    for (const id of ["effect.applyLast", "effect.last"]) {
      const prima = await voce(id);
      expect(prima.disabled, id).toBe(true);
      expect(prima.description, id).toBe(t("draw.disabled.no_last_effect"));
      prima.run();
    }
    await giro();
    expect(comando).not.toHaveBeenCalled();

    // Inverti colori (un effetto senza finestra) dal menu: è l'ultimo effetto.
    (await voce("addon.color.invert")).run();
    await vi.waitFor(() => expect(comando).toHaveBeenCalledTimes(1));
    expect(comando.mock.calls[0]![0]).toMatchObject({ id: "disegno.effect.apply", value: { effect: "addon.color.invert" } });
    await vi.waitFor(async () => expect((await voce("effect.applyLast")).disabled).toBe(false));

    (await voce("effect.applyLast")).run();
    await vi.waitFor(() => expect(comando).toHaveBeenCalledTimes(2));
    expect(comando.mock.calls[1]![0]).toMatchObject({ id: "disegno.effect.apply", value: { effect: "addon.color.invert" } });

    (await voce("effect.last")).run();
    await vi.waitFor(() => expect(comando).toHaveBeenCalledTimes(3));
    expect(comando.mock.calls[2]![0]).toMatchObject({ id: "disegno.effect.apply", value: { effect: "addon.color.invert" } });
    completo.chiudi();
  });

  it("un effetto rifiutato non si ricorda", async () => {
    const { completo, comando, voce } = completoVero("empty");
    (await voce("addon.color.invert")).run();
    await vi.waitFor(() => expect(comando).toHaveBeenCalledTimes(1));
    await giro();
    expect((await voce("effect.applyLast")).disabled).toBe(true);
    completo.chiudi();
  });
});

describe("Predefinito illuminazione 3D dal menu", () => {
  it("senza un effetto 3D negli oggetti scelti lo dice e non manda niente", async () => {
    const { completo, comando, voce, annuncia } = completoVero(null, { applied: [{ effects: [{ id: "distort.roughen", params: {}, visible: true }], items: [] }] });
    (await voce("effect.lightingPreset")).run();
    await vi.waitFor(() => expect(annuncia).toHaveBeenCalledWith(t("draw.lightingPreset.none")));
    expect(comando.mock.calls.map(([passo]) => passo.id)).toEqual(["disegno.effect.list"]);
    completo.chiudi();
  });
});

describe("Applica ultimo effetto dal suo tasto (Ctrl+Maiusc+E)", () => {
  it("spenta non fa niente; dopo un effetto lo rifà", async () => {
    const radice = document.createElement("div");
    document.body.append(radice);
    const { completo, comando, voce } = completoVero(null, null, radice);
    const premi = () => radice.dispatchEvent(new KeyboardEvent("keydown", { key: "E", code: "KeyE", ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true }));
    await giro();
    premi();
    await giro();
    expect(comando).not.toHaveBeenCalled();
    (await voce("addon.color.invert")).run();
    await vi.waitFor(() => expect(comando).toHaveBeenCalledTimes(1));
    premi();
    await vi.waitFor(() => expect(comando).toHaveBeenCalledTimes(2));
    expect(comando.mock.calls[1]![0]).toMatchObject({ id: "disegno.effect.apply", value: { effect: "addon.color.invert" } });
    completo.chiudi();
    radice.remove();
  });
});
