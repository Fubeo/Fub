// Il percorso di un comando del motore (K6 T9b): un comando senza parametri
// gira subito con la famiglia pronta, aspetta una famiglia che arriva, dice un
// errore, e con parametri apre la finestra di T6. Motore, famiglia e cronologia
// sono finti: nessun DOM.
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DrawingOutcome } from "../../../host/contract";
import { openLifetime, type Lifetime } from "../../../ui/lifetime";
import type { Op } from "../scene/ops";
import { apriFinestra } from "../motore/finestre";
import type { Caricatore, StatoFamiglia } from "./carica";
import { applicaEsito, etichettaDi, eseguiVoce, type DipendenzeComando, type OpzioniFinestraComando } from "./esegui";
import type { VoceIndice } from "./indice";
import { t } from "../strings";

// La finestra vera è di T6 (`motore/finestre.test.ts`): qui si guarda solo
// come il percorso la chiama.
vi.mock("../motore/finestre", () => ({ apriFinestra: vi.fn(() => Promise.resolve(true)) }));

const lifetimes: Lifetime[] = [];
afterEach(() => {
  for (const life of lifetimes.splice(0)) life.close();
  vi.clearAllMocks();
});
function vita(): Lifetime {
  const life = openLifetime();
  lifetimes.push(life);
  return life;
}

/// Un comando del motore, come lo dà l'indice.
function voce(overrides: Partial<VoceIndice> = {}): VoceIndice {
  return {
    fonte: "motore",
    id: "shape.round",
    chiamata: { comando: "shape.round" },
    etichetta: { it: "Angoli arrotondati", en: "Round corners" },
    posto: "menu/oggetto",
    famiglia: "forme",
    tasto: "Cmd+Alt+L",
    effetto: "cambia",
    finestra: false,
    ...overrides,
  };
}

/// L'esito di un comando che ha fatto una modifica, con le sue operazioni.
function esito(overrides: Partial<DrawingOutcome> = {}): DrawingOutcome {
  return {
    revision: "1",
    preview: null,
    ops: "[]",
    selection: ["n1"],
    losses: [],
    refused: null,
    frame: null,
    ...overrides,
  } as DrawingOutcome;
}

const OPS: Op[] = [{ op: "meta", title: "x" } as unknown as Op];

/// Un caricatore finto: la famiglia è `stato`, e `famiglia()` risolve con `esito`.
function caricatoreFinto(stato: StatoFamiglia, dopo: StatoFamiglia = stato) {
  let corrente = stato;
  const famiglia = vi.fn((_id: string): Promise<StatoFamiglia> => {
    corrente = dopo;
    return Promise.resolve(dopo);
  });
  return {
    famiglia,
    // «Riprova» di un errore: rifà l'attesa, come `famiglia`.
    riprova: vi.fn((_id: string): Promise<StatoFamiglia> => {
      corrente = dopo;
      return Promise.resolve(dopo);
    }),
    stato: vi.fn((_id: string) => corrente),
  } as unknown as Caricatore & { famiglia: typeof famiglia };
}

/// Le dipendenze finte, con un motore che risponde `risposta`.
function dipendenze(over: Partial<DipendenzeComando> & { risposta?: DrawingOutcome | null } = {}) {
  const sessione = {
    comando: vi.fn(() => Promise.resolve(over.risposta === undefined ? esito() : over.risposta)),
  };
  const motore = { pronta: vi.fn(() => Promise.resolve(sessione)) };
  const azioni = {
    leggi: vi.fn((_ops: string | null): readonly Op[] | null => OPS),
    commit: vi.fn((_ops: readonly Op[], _nome: string) => true),
    seleziona: vi.fn((_ids: readonly string[]) => undefined),
    annuncia: vi.fn((_testo: string) => undefined),
  };
  const d: DipendenzeComando = {
    motore: over.motore === undefined ? (motore as unknown as DipendenzeComando["motore"]) : over.motore,
    carica: over.carica ?? caricatoreFinto({ kind: "pronta" }),
    vita: over.vita ?? vita(),
    selezione: () => ["n1", "n2"],
    anteprima: vi.fn(),
    finestra: over.finestra ?? (() => Promise.resolve(null)),
    ...azioni,
    ...(over.leggi === undefined ? {} : { leggi: over.leggi }),
    ...(over.commit === undefined ? {} : { commit: over.commit }),
  };
  return { d, sessione, motore, azioni };
}

/// Lascia girare le promesse in attesa.
const tick = () => new Promise<void>((r) => setTimeout(r, 0));

describe("eseguiVoce, senza finestra", () => {
  it("gira subito con la famiglia pronta: il motore riceve id e selezione, e la modifica va alla cronologia", async () => {
    const { d, sessione, azioni } = dipendenze();
    eseguiVoce(voce(), d);
    await tick();
    expect(sessione.comando).toHaveBeenCalledWith({ id: "shape.round", selection: ["n1", "n2"], value: {}, preview: false });
    expect(azioni.commit).toHaveBeenCalledWith(OPS, etichettaDi(voce()));
    expect(azioni.seleziona).toHaveBeenCalledWith(["n1"]);
    expect(azioni.annuncia).toHaveBeenCalledWith(expect.stringContaining(etichettaDi(voce())));
  });

  it("il valore fisso di un effetto arriva al motore", async () => {
    const { d, sessione } = dipendenze();
    eseguiVoce(voce({ chiamata: { comando: "effect.blur", valore: { radius: 3 } } }), d);
    await tick();
    expect(sessione.comando).toHaveBeenCalledWith(expect.objectContaining({ id: "effect.blur", value: { radius: 3 } }));
  });

  it("aspetta una famiglia che arriva: lo dice, e gira quando è pronta", async () => {
    const carica = caricatoreFinto({ kind: "in-arrivo", giro: 1 }, { kind: "pronta" });
    const { d, sessione, azioni } = dipendenze({ carica });
    eseguiVoce(voce(), d);
    expect(azioni.annuncia).toHaveBeenCalledWith(t("draw.completo.key.waiting"));
    expect(sessione.comando).not.toHaveBeenCalled();
    await tick();
    expect(sessione.comando).toHaveBeenCalledTimes(1);
  });

  it("una famiglia in errore non fa girare il comando, e lo dice", async () => {
    const carica = caricatoreFinto({ kind: "errore", perche: "no-memory" });
    const { d, sessione, azioni } = dipendenze({ carica });
    eseguiVoce(voce(), d);
    await tick();
    expect(sessione.comando).not.toHaveBeenCalled();
    expect(azioni.annuncia).toHaveBeenLastCalledWith(t("draw.window.failed"));
  });

  it("chiuso il disegno mentre la famiglia arriva, il comando non parte", async () => {
    let arriva: (s: StatoFamiglia) => void = () => undefined;
    const carica = {
      famiglia: vi.fn(() => new Promise<StatoFamiglia>((r) => (arriva = r))),
      stato: vi.fn(() => ({ kind: "in-arrivo", giro: 1 }) as StatoFamiglia),
    } as unknown as Caricatore;
    const life = vita();
    const { d, sessione } = dipendenze({ carica, vita: life });
    eseguiVoce(voce(), d);
    life.close();
    arriva({ kind: "pronta" });
    await tick();
    expect(sessione.comando).not.toHaveBeenCalled();
  });

  it("senza motore il comando non parte e lo dice", async () => {
    const { d, azioni } = dipendenze({ motore: null });
    eseguiVoce(voce(), d);
    await tick();
    expect(azioni.commit).not.toHaveBeenCalled();
    expect(azioni.annuncia).toHaveBeenLastCalledWith(t("draw.window.unanswered"));
  });

  it("un rifiuto del motore non cambia il disegno: la selezione e il perché", async () => {
    const { d, azioni } = dipendenze({ risposta: esito({ refused: "locked", selection: ["n9"] }) });
    eseguiVoce(voce(), d);
    await tick();
    expect(azioni.commit).not.toHaveBeenCalled();
    expect(azioni.seleziona).toHaveBeenCalledWith(["n9"]);
    expect(azioni.annuncia).toHaveBeenLastCalledWith(t("draw.rejected", { reason: t("draw.reason.locked") }));
    expect(azioni.annuncia).not.toHaveBeenCalledWith(t("draw.window.refused"));
  });

  it("ogni rifiuto dice il suo motivo, come per i colori; «niente da cambiare» non è un errore", async () => {
    for (const [refused, motivo] of [
      ["unmapped", "draw.reason.foreign"],
      ["too_large", "draw.reason.limit"],
      ["stale", "draw.reason.invalid"],
    ] as const) {
      const { d, azioni } = dipendenze({ risposta: esito({ refused }) });
      eseguiVoce(voce(), d);
      await tick();
      expect(azioni.annuncia).toHaveBeenLastCalledWith(t("draw.rejected", { reason: t(motivo) }));
    }
    const { d, azioni } = dipendenze({ risposta: esito({ refused: "empty" }) });
    eseguiVoce(voce(), d);
    await tick();
    expect(azioni.commit).not.toHaveBeenCalled();
    expect(azioni.annuncia).toHaveBeenLastCalledWith(t("draw.completo.key.unchanged", { command: etichettaDi(voce()) }));
  });

  it("le operazioni che non valgono non si applicano, e lo si dice", async () => {
    const { d, azioni } = dipendenze({ leggi: () => null });
    eseguiVoce(voce(), d);
    await tick();
    expect(azioni.commit).not.toHaveBeenCalled();
    expect(azioni.seleziona).not.toHaveBeenCalled();
    expect(azioni.annuncia).toHaveBeenLastCalledWith(t("draw.completo.key.failed"));
  });

  it("una cronologia che rifiuta la modifica lo dice, e la selezione non cambia", async () => {
    const { d, azioni } = dipendenze({ commit: () => false });
    eseguiVoce(voce(), d);
    await tick();
    expect(azioni.seleziona).not.toHaveBeenCalled();
    expect(azioni.annuncia).toHaveBeenLastCalledWith(t("draw.completo.key.failed"));
  });

  it("uno strumento o un pezzo del client non parte da qui", async () => {
    const { d, sessione } = dipendenze();
    eseguiVoce(voce({ fonte: "strumento", chiamata: { strumento: "pen" } }), d);
    eseguiVoce(voce({ fonte: "interfaccia", chiamata: { client: "panel.open" } }), d);
    await tick();
    expect(sessione.comando).not.toHaveBeenCalled();
  });
});

describe("eseguiVoce, con finestra", () => {
  const schema = (): OpzioniFinestraComando => ({
    modulo: { campi: [{ nome: "radius", tipo: "numero", min: 0, max: 100 }] },
    campi: { radius: "Raggio" },
  });

  it("una voce con parametri apre la finestra di T6, e la sua mandata gira una volta sola", async () => {
    const { d, sessione, azioni } = dipendenze({ finestra: () => Promise.resolve(schema()) });
    eseguiVoce(voce({ finestra: true }), d);
    await tick();
    expect(apriFinestra).toHaveBeenCalledTimes(1);
    const [modulo, , esegui, opzioni] = vi.mocked(apriFinestra).mock.calls[0]!;
    expect(modulo).toEqual(schema().modulo);
    expect(opzioni).toMatchObject({ id: "shape.round", titolo: etichettaDi(voce()), campi: { radius: "Raggio" } });
    // OK: il motore riceve i valori della finestra, e il risultato va alla cronologia.
    const risposta = await esegui({ radius: 12 }, false);
    expect(sessione.comando).toHaveBeenCalledWith(expect.objectContaining({ value: { radius: 12 }, preview: false }));
    expect(azioni.commit).toHaveBeenCalledWith(OPS, etichettaDi(voce()));
    expect(risposta).toEqual({ anteprima: null, rifiuto: null });
  });

  it("«Riprova» della finestra rifà l'attesa della famiglia, con la stessa famiglia del comando", async () => {
    const carica = caricatoreFinto({ kind: "pronta" });
    const { d } = dipendenze({ finestra: () => Promise.resolve(schema()), carica });
    eseguiVoce(voce({ finestra: true }), d);
    await tick();
    const riprova = vi.mocked(apriFinestra).mock.calls[0]![3].riprova;
    expect(riprova).toBeDefined();
    await riprova!();
    expect(carica.riprova).toHaveBeenCalledWith(voce().famiglia);
  });

  it("l'anteprima della finestra non va alla cronologia, e ridà l'anteprima", async () => {
    const anteprima = { shape: null } as unknown as NonNullable<DrawingOutcome["preview"]>;
    const { d, sessione, azioni } = dipendenze({
      finestra: () => Promise.resolve(schema()),
      risposta: esito({ preview: anteprima }),
    });
    eseguiVoce(voce({ finestra: true }), d);
    await tick();
    const esegui = vi.mocked(apriFinestra).mock.calls[0]![2];
    const risposta = await esegui({ radius: 4 }, true);
    expect(sessione.comando).toHaveBeenCalledWith(expect.objectContaining({ preview: true }));
    expect(azioni.commit).not.toHaveBeenCalled();
    expect(risposta).toEqual({ anteprima, rifiuto: null });
  });

  it("una voce con finestra che la famiglia non ha dice che non c'è, e non apre niente", async () => {
    const { d, azioni } = dipendenze({ finestra: () => Promise.resolve(null) });
    eseguiVoce(voce({ finestra: true }), d);
    await tick();
    expect(apriFinestra).not.toHaveBeenCalled();
    expect(azioni.annuncia).toHaveBeenCalledWith(t("draw.completo.key.nowindow"));
  });

  it("chiuso il disegno mentre la finestra si prepara, non si apre", async () => {
    const life = vita();
    life.close();
    const { d } = dipendenze({ finestra: () => Promise.resolve(schema()), vita: life });
    eseguiVoce(voce({ finestra: true }), d);
    await tick();
    expect(apriFinestra).not.toHaveBeenCalled();
  });
});

describe("applicaEsito", () => {
  it("un esito con operazioni va alla cronologia in un passo, poi la selezione", () => {
    const azioni = { leggi: vi.fn(() => OPS), commit: vi.fn(() => true), seleziona: vi.fn(), annuncia: vi.fn() };
    applicaEsito(esito({ ops: "[1]", selection: ["a"] }), "Etichetta", azioni);
    expect(azioni.leggi).toHaveBeenCalledWith("[1]");
    expect(azioni.commit).toHaveBeenCalledWith(OPS, "Etichetta");
    expect(azioni.seleziona).toHaveBeenCalledWith(["a"]);
    expect(azioni.annuncia).toHaveBeenCalledWith(expect.stringContaining("Etichetta"));
  });

  it("un esito senza operazioni (una lettura) non tocca la cronologia", () => {
    const azioni = { leggi: vi.fn(() => []), commit: vi.fn(() => true), seleziona: vi.fn(), annuncia: vi.fn() };
    applicaEsito(esito({ ops: null }), "Lettura", azioni);
    expect(azioni.commit).not.toHaveBeenCalled();
    expect(azioni.seleziona).toHaveBeenCalled();
  });
});
