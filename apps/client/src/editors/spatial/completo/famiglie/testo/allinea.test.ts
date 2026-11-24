// @vitest-environment happy-dom
// Allinea a sinistra, al centro, a destra (menu Testo, Ctrl+Maiusc+L, C, R di VectorCraft): voci del
// client che mandano il comando della sezione Paragrafo, `text.setStyle {justify}`, sui testi scelti.
// Accese e spente come quel comando del motore. È la prova delle tre righe `interfaccia` di
// testo.json, in una sessione del Completo vera.

import { describe, expect, it, vi } from "vitest";
import { t } from "../../../strings";
import { openLifetime } from "../../../../../ui/lifetime";
import type { MotoreDelDisegno } from "../../../motore/gesti";
import type { SessioneMotore } from "../../../motore/sessione";
import { apri } from "../../index";
import { indiceDi } from "../../indice";
import indiceGenerato from "../../indice.generated.json";

const giro = (): Promise<void> => new Promise((risolto) => setTimeout(risolto, 0));

const VOCI = [
  ["type.alignLeft", "left", "KeyL"],
  ["type.alignCenter", "center", "KeyC"],
  ["type.alignRight", "right", "KeyR"],
] as const;

function completoVero(radice: HTMLElement | null = null) {
  /// Se il motore dice acceso `text.setStyle` (c'è un testo scelto).
  const conTesto = { valore: true };
  const esito = { revision: "1", preview: null, ops: "[]", selection: ["t1"], losses: [], refused: null, frame: null };
  const comando = vi.fn((_passo: { readonly id: string; readonly value?: unknown }) => Promise.resolve(esito));
  const comandi = vi.fn(() =>
    Promise.resolve([
      conTesto.valore
        ? { id: "disegno.text.setStyle", enabled: true, disabled_reason: null }
        : { id: "disegno.text.setStyle", enabled: false, disabled_reason: "needs_text" },
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
  return { completo, comando, voce, annuncia, conTesto };
}

describe("Allinea il testo dal menu Testo", () => {
  it("stanno nel menu Testo coi tasti di VectorCraft", () => {
    const voci = (indiceGenerato as unknown as { readonly voci: readonly { id: string; posto: string; chiamata: unknown; tasto?: string }[] }).voci;
    const tasti = { "type.alignLeft": "Cmd+Shift+L", "type.alignCenter": "Cmd+Shift+C", "type.alignRight": "Cmd+Shift+R" } as const;
    for (const [id] of VOCI) {
      const voce = voci.find((una) => una.id === id)!;
      expect(voce.posto, id).toBe("menu/testo");
      expect(voce.chiamata, id).toEqual({ client: id });
      expect(voce.tasto, id).toBe(tasti[id]);
    }
  });

  it("senza un testo scelto sono spente col perché del motore", async () => {
    const { completo, comando, voce, conTesto } = completoVero();
    conTesto.valore = false;
    for (const [id] of VOCI) {
      const una = await voce(id);
      expect(una.disabled, id).toBe(true);
      expect(una.description, id).toBe(t("draw.disabled.needs_text"));
    }
    expect(comando).not.toHaveBeenCalled();
    completo.chiudi();
  });

  it("con un testo scelto mandano text.setStyle con il loro allineamento", async () => {
    const { completo, comando, voce } = completoVero();
    for (const [id, justify] of VOCI) {
      const una = await voce(id);
      expect(una.disabled, id).toBe(false);
      const prima = comando.mock.calls.length;
      una.run();
      await vi.waitFor(() => expect(comando.mock.calls.length).toBe(prima + 1));
      expect(comando.mock.calls.at(-1)![0], id).toMatchObject({ id: "disegno.text.setStyle", value: { justify } });
    }
    completo.chiudi();
  });
});

describe("Allinea il testo dai tasti (Ctrl+Maiusc+L, C, R)", () => {
  const premi = (radice: HTMLElement, code: string) =>
    radice.dispatchEvent(new KeyboardEvent("keydown", { key: code.slice(3), code, ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true }));

  it("con un testo scelto mandano il comando; senza dicono perché e non mandano niente", async () => {
    const radice = document.createElement("div");
    document.body.append(radice);
    const { completo, comando, annuncia, conTesto } = completoVero(radice);
    await giro();
    for (const [id, justify, code] of VOCI) {
      const prima = comando.mock.calls.length;
      premi(radice, code);
      await vi.waitFor(() => expect(comando.mock.calls.length, id).toBe(prima + 1));
      expect(comando.mock.calls.at(-1)![0], id).toMatchObject({ id: "disegno.text.setStyle", value: { justify } });
    }
    conTesto.valore = false;
    const prima = comando.mock.calls.length;
    premi(radice, "KeyL");
    await vi.waitFor(() => expect(annuncia).toHaveBeenCalledWith(t("draw.disabled.needs_text")));
    await giro();
    expect(comando.mock.calls.length).toBe(prima);
    completo.chiudi();
    radice.remove();
  });
});
