// @vitest-environment happy-dom
// Semplifica automaticamente (riga `ui.simplifyAuto`) e Smussa automaticamente (riga `ui.smoothAuto`): due
// voci del menu e della ricerca che mandano il comando del motore con `{auto: true}` e la selezione, una
// volta sola, senza finestra. Il motore è finto: si guarda che cosa parte e che cosa si dice.
import { describe, expect, it, vi } from "vitest";
import { openLifetime } from "../../../ui/lifetime";
import type { MotoreDelDisegno } from "../motore/gesti";
import type { SessioneMotore } from "../motore/sessione";
import { apriFinestra } from "../motore/finestre";
import { apri } from "./index";
import { indiceDi } from "./indice";
import indiceGenerato from "./indice.generated.json";

vi.mock("../motore/finestre", () => ({ apriFinestra: vi.fn(() => Promise.resolve(true)) }));

/// Un esito del motore: le operazioni (JSON), o un rifiuto.
function esito(opzioni: { readonly ops?: string; readonly refused?: string | null; readonly selection?: readonly string[] }) {
  return {
    revision: "1",
    preview: null,
    ops: opzioni.ops ?? "[]",
    selection: [...(opzioni.selection ?? ["k1"])],
    losses: [],
    refused: opzioni.refused ?? null,
    frame: null,
  };
}

/// Il motore con la sessione che risponde `risposta`, e `comandi` che dice se il comando è acceso.
function motoreFinto(risposta: () => ReturnType<typeof esito>, acceso = true) {
  const comando = vi.fn((_passo: unknown) => Promise.resolve(risposta()));
  const comandi = vi.fn(() =>
    Promise.resolve([
      { id: "disegno.object.path.simplify", enabled: acceso, disabled_reason: acceso ? null : "no_selection" },
      { id: "disegno.object.path.smooth", enabled: acceso, disabled_reason: acceso ? null : "no_selection" },
    ]),
  );
  const sessione = { comandi, comando } as unknown as SessioneMotore;
  const motore = { adesso: () => sessione, pronta: () => Promise.resolve(sessione), assente: () => null } as unknown as MotoreDelDisegno;
  return { motore, comando };
}

/// Il Completo con l'indice vero, la famiglia `tracciati` vera e gli annunci spiati.
function completo(motore: MotoreDelDisegno, selezione: () => string[], commit = vi.fn(() => true)) {
  const annuncia = vi.fn();
  const c = apri(
    { motore, life: openLifetime() } as never,
    {
      indice: () => Promise.resolve(indiceDi(indiceGenerato as never)),
      prepara: () => Promise.resolve("pronta"),
      moduli: { "./famiglie/tracciati/index.ts": () => import("./famiglie/tracciati/index") },
      tasti: { selezione, annuncia, commit, seleziona: vi.fn(), leggi: () => [{ op: "set", id: "k1", attrs: { d: "M0 0" } }] } as never,
    } as never,
  );
  return { c, annuncia, commit };
}

/// La voce della ricerca con questa etichetta.
async function voce(c: ReturnType<typeof completo>["c"], selezione: () => string[], etichetta: string) {
  const azioni = { strumento: vi.fn(), client: vi.fn(), riprova: vi.fn() };
  const voci = await c.ricerca(selezione, azioni);
  const trovata = voci?.find((una) => una.label === etichetta);
  expect(trovata, etichetta).toBeDefined();
  return trovata!;
}

describe("Semplifica automaticamente (riga ui.simplifyAuto)", () => {
  it("un tracciato: il comando parte con {auto: true} e la selezione, una volta sola, senza finestra", async () => {
    vi.mocked(apriFinestra).mockClear();
    const { motore, comando } = motoreFinto(() => esito({ ops: '[{"op":"set","id":"k1","attrs":{"d":"M0 0 L10 10"}}]' }));
    const { c, commit } = completo(motore, () => ["k1"]);
    (await voce(c, () => ["k1"], "Semplifica automaticamente")).run();
    await vi.waitFor(() => expect(comando).toHaveBeenCalledTimes(1));
    expect(comando).toHaveBeenCalledWith(expect.objectContaining({ id: "disegno.object.path.simplify", value: { auto: true }, selection: ["k1"], preview: false }));
    expect(vi.mocked(apriFinestra)).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(commit).toHaveBeenCalledTimes(1));
    c.chiudi();
  });

  it("più oggetti: tutta la selezione va al comando, che sceglie il livello per la somma", async () => {
    const { motore, comando } = motoreFinto(() => esito({ selection: ["k1", "k2"] }), true);
    const { c } = completo(motore, () => ["k1", "k2"]);
    (await voce(c, () => ["k1", "k2"], "Semplifica automaticamente")).run();
    await vi.waitFor(() => expect(comando).toHaveBeenCalledTimes(1));
    expect(comando).toHaveBeenCalledWith(expect.objectContaining({ selection: ["k1", "k2"], value: { auto: true } }));
    c.chiudi();
  });

  it("niente scelto: la voce è spenta e dice «Scegli un oggetto.»; non parte nessun comando", async () => {
    const { motore, comando } = motoreFinto(() => esito({}), false);
    const { c } = completo(motore, () => []);
    const trovata = await voce(c, () => [], "Semplifica automaticamente");
    expect(trovata.disabled).toBe(true);
    expect(trovata.description).toBe("Scegli un oggetto.");
    trovata.run();
    await Promise.resolve();
    expect(comando).not.toHaveBeenCalled();
    c.chiudi();
  });

  it("nessun cambiamento (il tracciato è già semplice): il motore dà un rifiuto vuoto, e si dice che non è cambiato niente", async () => {
    const { motore } = motoreFinto(() => esito({ refused: "empty" }));
    const { c, annuncia, commit } = completo(motore, () => ["k1"]);
    (await voce(c, () => ["k1"], "Semplifica automaticamente")).run();
    await vi.waitFor(() => expect(annuncia).toHaveBeenCalled());
    expect(commit).not.toHaveBeenCalled();
    c.chiudi();
  });

  it("motore assente: nessun comando parte", async () => {
    const comando = vi.fn();
    const motore = { adesso: () => null, pronta: () => Promise.resolve(null), assente: () => ({ kind: "fermo" }) } as unknown as MotoreDelDisegno;
    const { c } = completo(motore, () => ["k1"]);
    (await voce(c, () => ["k1"], "Semplifica automaticamente")).run();
    await Promise.resolve();
    expect(comando).not.toHaveBeenCalled();
    c.chiudi();
  });
});

describe("Smussa automaticamente (riga ui.smoothAuto)", () => {
  it("un tracciato: il comando di Smussa parte con {auto: true}, una volta sola, senza finestra", async () => {
    vi.mocked(apriFinestra).mockClear();
    const { motore, comando } = motoreFinto(() => esito({ ops: '[{"op":"set","id":"k1","attrs":{"d":"M0 0 C5 5 9 9 10 10"}}]' }));
    const { c, commit } = completo(motore, () => ["k1"]);
    (await voce(c, () => ["k1"], "Smussa automaticamente")).run();
    await vi.waitFor(() => expect(comando).toHaveBeenCalledTimes(1));
    expect(comando).toHaveBeenCalledWith(expect.objectContaining({ id: "disegno.object.path.smooth", value: { auto: true }, selection: ["k1"] }));
    expect(vi.mocked(apriFinestra)).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(commit).toHaveBeenCalledTimes(1));
    c.chiudi();
  });

  it("niente scelto: la voce è spenta e dice perché", async () => {
    const { motore } = motoreFinto(() => esito({}), false);
    const { c } = completo(motore, () => []);
    const trovata = await voce(c, () => [], "Smussa automaticamente");
    expect(trovata.disabled).toBe(true);
    expect(trovata.description).toBe("Scegli un oggetto.");
    c.chiudi();
  });
});
