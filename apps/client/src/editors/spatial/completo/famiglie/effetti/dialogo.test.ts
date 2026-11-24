// @vitest-environment happy-dom
// «Effetto…» (`effect.dialog` di VectorCraft): scegliere dal menu un effetto che la pila del
// primo oggetto scelto ha già chiede prima se modificarlo o aggiungerne un altro. «Modifica» apre
// la sua finestra coi valori che ha e OK manda `effect.setParams` al suo posto; «Aggiungi nuovo»
// apre la finestra coi valori di serie e OK manda `effect.apply`. Un effetto che non c'è ancora
// apre la finestra subito. È la prova della riga `interfaccia` effect.dialog di effetti.json.

import { afterEach, describe, expect, it, vi } from "vitest";
import { t } from "../../../strings";
import { openLifetime } from "../../../../../ui/lifetime";
import type { MotoreDelDisegno } from "../../../motore/gesti";
import type { SessioneMotore } from "../../../motore/sessione";
import { apri } from "../../index";
import { indiceDi } from "../../indice";
import indiceGenerato from "../../indice.generated.json";

const domanda = vi.hoisted(() => ({ risposta: true, chiamate: [] as unknown[][] }));
vi.mock("../../../../../platform/confirm", () => ({
  confirm: (...argomenti: unknown[]) => {
    domanda.chiamate.push(argomenti);
    return Promise.resolve(domanda.risposta);
  },
}));

const IRRUVIDISCI = { id: "distort.roughen", params: { size: 9, detail: 10 }, visible: true };

function completoVero(applicati: readonly unknown[]) {
  const esito = { revision: "1", preview: null, ops: "[]", selection: ["k1"], losses: [], refused: null, frame: null };
  const pila = { applied: [{ effects: applicati, items: [] }] };
  const comando = vi.fn((passo: { readonly id: string; readonly value?: unknown }) =>
    Promise.resolve(passo.id === "disegno.effect.list" ? { ...esito, ops: null, reading: pila } : esito),
  );
  const sessione = { comandi: vi.fn(() => Promise.resolve([])), comando } as unknown as SessioneMotore;
  const motore = { adesso: () => sessione, pronta: () => Promise.resolve(sessione), assente: () => null } as unknown as MotoreDelDisegno;
  const completo = apri(
    { motore, life: openLifetime() } as never,
    {
      indice: () => Promise.resolve(indiceDi(indiceGenerato as never)),
      prepara: () => Promise.resolve("pronta"),
      moduli: { "./famiglie/effetti/index.ts": () => Promise.resolve({ default: { registra: () => undefined } }) },
      tasti: { selezione: () => ["k1"], annuncia: vi.fn(), leggi: () => [], commit: () => true, seleziona: () => undefined } as never,
    } as never,
  );
  const voce = async (id: string) =>
    (await completo.ricerca(() => ["k1"], { strumento: vi.fn(), client: vi.fn(), riprova: vi.fn() } as never))!.find((v) => v.key === id)!;
  const ok = async (): Promise<void> => {
    const pulsante = await vi.waitFor(() => {
      const trovato = document.querySelector<HTMLButtonElement>('.draw-effect-dialog [data-action="ok"]');
      expect(trovato?.disabled).toBe(false);
      return trovato!;
    });
    pulsante.click();
  };
  const mandati = () => comando.mock.calls.map(([passo]) => passo).filter((passo) => passo.id !== "disegno.effect.list");
  return { completo, voce, ok, mandati };
}

afterEach(() => {
  domanda.chiamate = [];
  document.body.replaceChildren();
});

describe("Effetto… con un effetto già applicato (effect.dialog)", () => {
  it("«Modifica» apre la finestra coi suoi valori e OK cambia quello che c'è", async () => {
    domanda.risposta = true;
    const { completo, voce, ok, mandati } = completoVero([IRRUVIDISCI]);
    (await voce("distort.roughen")).run();
    await vi.waitFor(() => expect(domanda.chiamate).toHaveLength(1));
    expect(domanda.chiamate[0]![1]).toMatchObject({ title: t("draw.effectExists.title"), okLabel: t("draw.effectExists.edit"), cancelLabel: t("draw.effectExists.addNew") });
    await ok();
    await vi.waitFor(() => expect(mandati().some((passo) => passo.id === "disegno.effect.setParams")).toBe(true));
    const cambio = mandati().find((passo) => passo.id === "disegno.effect.setParams" && !(passo as { preview?: boolean }).preview)!;
    expect(cambio.value).toMatchObject({ index: 0, item: null });
    expect(mandati().some((passo) => passo.id === "disegno.effect.apply")).toBe(false);
    completo.chiudi();
  });

  it("«Aggiungi nuovo» apre la finestra coi valori di serie e OK ne aggiunge un altro", async () => {
    domanda.risposta = false;
    const { completo, voce, ok, mandati } = completoVero([IRRUVIDISCI]);
    (await voce("distort.roughen")).run();
    await vi.waitFor(() => expect(domanda.chiamate).toHaveLength(1));
    await ok();
    await vi.waitFor(() => expect(mandati().some((passo) => passo.id === "disegno.effect.apply")).toBe(true));
    expect(mandati().some((passo) => passo.id === "disegno.effect.setParams")).toBe(false);
    completo.chiudi();
  });

  it("un effetto che la pila non ha apre la finestra senza domanda", async () => {
    const { completo, voce, ok, mandati } = completoVero([]);
    (await voce("distort.roughen")).run();
    await ok();
    await vi.waitFor(() => expect(mandati().some((passo) => passo.id === "disegno.effect.apply")).toBe(true));
    expect(domanda.chiamate).toHaveLength(0);
    completo.chiudi();
  });
});
