// Il percorso di un comando del motore (K6 T9b): un comando senza parametri
// gira subito con la famiglia pronta, aspetta una famiglia che arriva, dice un
// errore, e con parametri apre la finestra di T6. Motore, famiglia e cronologia
// sono finti: nessun DOM.
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DrawingOutcome } from "../../../host/contract";
import type { ArgomentiRifiutati } from "../motore/sessione";
import { openLifetime, type Lifetime } from "../../../ui/lifetime";
import type { Op } from "../scene/ops";
import { apriFinestra } from "../motore/finestre";
import type { Caricatore, StatoFamiglia } from "./carica";
import { applicaEsito, conValori, etichettaDi, eseguiVoce, type DipendenzeComando, type OpzioniFinestraComando } from "./esegui";
import type { VoceIndice } from "./indice";
import indiceGenerato from "./indice.generated.json";
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
function dipendenze(over: Partial<DipendenzeComando> & { risposta?: DrawingOutcome | ArgomentiRifiutati | null } = {}) {
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
    ...(over.appunti === undefined ? {} : { appunti: over.appunti }),
    ...(over.diFub === undefined ? {} : { diFub: over.diFub }),
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
    expect(azioni.annuncia).toHaveBeenLastCalledWith(t("draw.reason.lockedSelection"));
    expect(azioni.annuncia).not.toHaveBeenCalledWith(t("draw.window.refused"));
  });

  it("argomenti rifiutati (`bad_args`): si dice la frase del motore, il disegno non cambia e il comando dopo va", async () => {
    const frase = "Scegli due o più campioni da unire.";
    const { d, sessione, azioni } = dipendenze({ risposta: { kind: "argomenti", message: frase } });
    eseguiVoce(voce(), d);
    await tick();
    expect(azioni.annuncia).toHaveBeenLastCalledWith(frase);
    expect(azioni.commit).not.toHaveBeenCalled();
    expect(azioni.seleziona).not.toHaveBeenCalled();
    sessione.comando.mockResolvedValueOnce(esito());
    eseguiVoce(voce(), d);
    await tick();
    expect(azioni.commit).toHaveBeenCalledWith(OPS, etichettaDi(voce()));
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

  it("un effetto (stylize.roundCorners) manda i valori della finestra nei suoi params, accanto all'effetto", async () => {
    const { d, sessione } = dipendenze({ finestra: () => Promise.resolve(schema()) });
    const effetto = voce({
      fonte: "effetto",
      id: "stylize.roundCorners",
      famiglia: "effetti",
      chiamata: { comando: "disegno.effect.apply", valore: { effect: "stylize.roundCorners" } },
      finestra: true,
    });
    eseguiVoce(effetto, d);
    await tick();
    const [, , esegui] = vi.mocked(apriFinestra).mock.calls[0]!;
    await esegui({ radius: 15 }, true);
    expect(sessione.comando).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: "disegno.effect.apply", value: { effect: "stylize.roundCorners", params: { radius: 15 } }, preview: true }),
    );
    expect(conValori({ fonte: "motore" }, { x: 1 }, { radius: 2 })).toEqual({ x: 1, radius: 2 });
    expect(conValori({ fonte: "effetto" }, { effect: "e", params: { a: 1 } }, { b: 2 })).toEqual({ effect: "e", params: { a: 1, b: 2 } });
  });

  it("un effetto andato con OK è l'ultimo effetto; l'anteprima no", async () => {
    const { d } = dipendenze({ finestra: () => Promise.resolve(schema()) });
    const effettoApplicato = vi.fn();
    const effetto = voce({
      fonte: "effetto",
      id: "stylize.roundCorners",
      famiglia: "effetti",
      chiamata: { comando: "disegno.effect.apply", valore: { effect: "stylize.roundCorners" } },
      finestra: true,
    });
    eseguiVoce(effetto, { ...d, effettoApplicato });
    await tick();
    const [, , esegui] = vi.mocked(apriFinestra).mock.calls[0]!;
    await esegui({ radius: 15 }, true);
    expect(effettoApplicato).not.toHaveBeenCalled();
    await esegui({ radius: 15 }, false);
    expect(effettoApplicato).toHaveBeenCalledWith(effetto, { radius: 15 });
  });

  it("un oggetto bloccato nella selezione dice di sbloccarlo o toglierlo, anche per un allineamento", async () => {
    const { d, azioni } = dipendenze({ risposta: { ...esito(), refused: "locked", ops: null } });
    eseguiVoce(voce({ id: "object.align", famiglia: "trasforma", chiamata: { comando: "disegno.object.align", valore: { horizontal: "left" } } }), d);
    await tick();
    expect(azioni.annuncia).toHaveBeenCalledWith(t("draw.reason.lockedSelection"));
    expect(azioni.annuncia).not.toHaveBeenCalledWith(expect.stringContaining(t("draw.reason.locked")));
  });

  it("il clic di una forma: il punto è il valore fisso del comando, OK manda una volta sola e senza selezione", async () => {
    const { d, sessione, azioni } = dipendenze({ finestra: () => Promise.resolve(schema()) });
    // La voce come la fa il Completo al clic: il punto nel valore fisso (T13, giro 2).
    const derivata = voce({ id: "shape.rectangle", famiglia: "forme", chiamata: { comando: "disegno.shape.rectangle", valore: { x: 40, y: 50 } }, finestra: true });
    eseguiVoce(derivata, { ...d, selezione: () => [] });
    await tick();
    const [, , esegui] = vi.mocked(apriFinestra).mock.calls[0]!;
    await esegui({ width: 80, height: 40 }, false);
    expect(sessione.comando).toHaveBeenCalledWith(
      expect.objectContaining({ id: "disegno.shape.rectangle", selection: [], value: { x: 40, y: 50, width: 80, height: 40 }, preview: false }),
    );
    expect(azioni.commit).toHaveBeenCalledTimes(1);
  });

  it("Media manda i punti scelti quando la finestra si apre; senza punti, i tracciati interi", async () => {
    const punto = { element: "o1", subpath: 0, anchor: 2, at: [160, 80] as [number, number], end: true };
    let punti: (typeof punto)[] = [punto];
    const { d, sessione } = dipendenze({ finestra: () => Promise.resolve(schema()) });
    const media = voce({ id: "path.average", famiglia: "tracciati", chiamata: { comando: "disegno.path.average" }, finestra: true });
    eseguiVoce(media, { ...d, punti: () => punti });
    await tick();
    // Cambiano dopo l'apertura: valgono quelli di quando si è aperta.
    punti = [];
    const [, , esegui] = vi.mocked(apriFinestra).mock.calls[0]!;
    await esegui({ axis: "vertical" }, false);
    expect(sessione.comando).toHaveBeenLastCalledWith(expect.objectContaining({ value: { anchors: [punto], axis: "vertical" } }));
    // Senza punti scelti: niente `anchors`, il motore prende i tracciati scelti.
    eseguiVoce(media, { ...d, punti: () => [] });
    await tick();
    const [, , ancora] = vi.mocked(apriFinestra).mock.calls[1]!;
    await ancora({ axis: "both" }, false);
    expect(sessione.comando).toHaveBeenLastCalledWith(expect.objectContaining({ value: { axis: "both" } }));
    // Un altro comando con finestra non riceve i punti.
    eseguiVoce(voce({ finestra: true }), { ...d, punti: () => [punto] });
    await tick();
    const [, , altro] = vi.mocked(apriFinestra).mock.calls[2]!;
    await altro({ radius: 3 }, false);
    expect(sessione.comando).toHaveBeenLastCalledWith(expect.objectContaining({ value: { radius: 3 } }));
  });

  it("Sposta sul livello corrente manda il livello corrente del disegno; senza, niente", async () => {
    const { d, sessione } = dipendenze();
    const sposta = voce({ id: "object.arrange.sendToCurrentLayer", famiglia: "nucleo", chiamata: { comando: "disegno.object.arrange.sendToCurrentLayer" } });
    eseguiVoce(sposta, { ...d, livello: () => "l1a2b3c4d" });
    await tick();
    expect(sessione.comando).toHaveBeenLastCalledWith(expect.objectContaining({ id: "disegno.object.arrange.sendToCurrentLayer", value: { layer: "l1a2b3c4d" } }));
    // Un livello senza id, o nessun livello: il ponte usa il più alto libero.
    eseguiVoce(sposta, { ...d, livello: () => null });
    await tick();
    expect(sessione.comando).toHaveBeenLastCalledWith(expect.objectContaining({ value: {} }));
    // Un altro comando non riceve il livello.
    eseguiVoce(voce({ id: "object.arrange.sendToBack", famiglia: "nucleo", chiamata: { comando: "disegno.object.arrange.sendToBack" } }), { ...d, livello: () => "l1a2b3c4d" });
    await tick();
    expect(sessione.comando).toHaveBeenLastCalledWith(expect.objectContaining({ value: {} }));
  });

  it("Annulla della finestra del clic non manda niente al motore", async () => {
    const { d, sessione, azioni } = dipendenze({ finestra: () => Promise.resolve(schema()) });
    eseguiVoce(voce({ id: "shape.rectangle", famiglia: "forme", chiamata: { comando: "disegno.shape.rectangle", valore: { x: 40, y: 50 } }, finestra: true }), d);
    await tick();
    // Annulla non chiama `esegui`: il motore non riceve nulla e la cronologia non cambia.
    expect(apriFinestra).toHaveBeenCalledTimes(1);
    expect(sessione.comando).not.toHaveBeenCalled();
    expect(azioni.commit).not.toHaveBeenCalled();
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

  it("argomenti rifiutati alla mandata della finestra: la frase torna alla finestra, niente alla cronologia", async () => {
    const { d, azioni } = dipendenze({
      finestra: () => Promise.resolve(schema()),
      risposta: { kind: "argomenti", message: "Il raggio è troppo grande." },
    });
    eseguiVoce(voce({ finestra: true }), d);
    await tick();
    const esegui = vi.mocked(apriFinestra).mock.calls[0]![2];
    expect(await esegui({ radius: 400 }, false)).toEqual({ anteprima: null, rifiuto: null, argomenti: "Il raggio è troppo grande." });
    expect(azioni.commit).not.toHaveBeenCalled();
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

  it("le perdite dell'esito si dicono con la frase del motore, non in silenzio (K6 T14)", () => {
    const azioni = { leggi: vi.fn(() => OPS), commit: vi.fn(() => true), seleziona: vi.fn(), annuncia: vi.fn() };
    const losses = [
      { element: "Tramonto", kind: "unsupported", detail: "«Tramonto» è una sfumatura." },
      { element: "Oceano", kind: "unsupported", detail: "«Oceano» è una sfumatura." },
    ] as DrawingOutcome["losses"];
    expect(applicaEsito(esito({ ops: "[1]", losses }), "Campioni predefiniti", azioni)).toBe(true);
    expect(azioni.commit).toHaveBeenCalledWith(OPS, "Campioni predefiniti");
    const detto = azioni.annuncia.mock.calls[0]?.[0] as string;
    expect(detto).toContain("Campioni predefiniti");
    expect(detto).toContain("«Tramonto» è una sfumatura. «Oceano» è una sfumatura.");
    expect(detto).not.toContain("{losses}");
  });
});

describe("eseguiVoce, con gli appunti del Completo (K6 T11)", () => {
  /// Gli appunti finti: ogni azione registra la sua chiamata.
  function appuntiFinti() {
    return {
      copia: vi.fn((_tipo: "copy" | "cut") => Promise.resolve()),
      incolla: vi.fn((_lettura: unknown) => Promise.resolve()),
      incollaDaMenu: vi.fn(() => Promise.resolve()),
      cancellaCronologia: vi.fn(() => Promise.resolve()),
    };
  }

  it("copia, taglia, incolla e cancella cronologia vanno agli appunti, non al motore", () => {
    const appunti = appuntiFinti();
    const { d, sessione } = dipendenze({ appunti });
    eseguiVoce(voce({ id: "edit.copy", chiamata: { comando: "disegno.edit.copy", valore: {} } }), d);
    eseguiVoce(voce({ id: "edit.cut", chiamata: { comando: "disegno.edit.cut", valore: {} } }), d);
    eseguiVoce(voce({ id: "edit.paste", chiamata: { comando: "disegno.edit.paste", valore: {} } }), d);
    eseguiVoce(voce({ id: "edit.clearHistory", chiamata: { comando: "disegno.edit.clearHistory", valore: {} } }), d);
    expect(appunti.copia).toHaveBeenNthCalledWith(1, "copy");
    expect(appunti.copia).toHaveBeenNthCalledWith(2, "cut");
    expect(appunti.incollaDaMenu).toHaveBeenCalledOnce();
    expect(appunti.cancellaCronologia).toHaveBeenCalledOnce();
    expect(sessione.comando).not.toHaveBeenCalled();
  });

  it("le varianti d'incolla vanno agli appunti col loro comando e il nome della loro voce", () => {
    const appunti = appuntiFinti();
    const { d } = dipendenze({ appunti });
    const davanti = voce({ id: "edit.pasteInFront", chiamata: { comando: "disegno.edit.pasteInFront", valore: {} }, etichetta: { it: "Incolla davanti", en: "Paste in Front" } });
    const senzaFormato = voce({ id: "edit.pasteWithoutFormatting", chiamata: { comando: "disegno.edit.pasteWithoutFormatting", valore: {} } });
    eseguiVoce(davanti, d);
    eseguiVoce(senzaFormato, d);
    expect(appunti.incollaDaMenu).toHaveBeenNthCalledWith(1, { comando: "edit.pasteInFront", etichetta: etichettaDi(davanti) });
    expect(appunti.incollaDaMenu).toHaveBeenNthCalledWith(2, { comando: "edit.pasteWithoutFormatting", etichetta: etichettaDi(senzaFormato) });
  });

  it("senza appunti (motore assente) i comandi di appunti seguono il percorso di sempre", async () => {
    const { d, sessione } = dipendenze();
    eseguiVoce(voce({ id: "edit.copy", chiamata: { comando: "disegno.edit.copy", valore: {} } }), d);
    await tick();
    expect(sessione.comando).toHaveBeenCalledOnce();
  });
});

describe("eseguiVoce, coi comandi che Fub fa da sé (K6 T11, oggetti)", () => {
  it("un comando che Fub fa non va al motore", async () => {
    const diFub = vi.fn((id: string) => id === "disegno.object.unlockAll");
    const { d, sessione } = dipendenze({ diFub });
    eseguiVoce(voce({ id: "object.unlockAll", chiamata: { comando: "disegno.object.unlockAll", valore: {} } }), d);
    await tick();
    expect(diFub).toHaveBeenCalledWith("disegno.object.unlockAll");
    expect(sessione.comando).not.toHaveBeenCalled();
  });

  it("gli altri comandi vanno al motore come sempre", async () => {
    const diFub = vi.fn(() => false);
    const { d, sessione } = dipendenze({ diFub });
    eseguiVoce(voce({ id: "object.lock", chiamata: { comando: "disegno.object.lock", valore: {} } }), d);
    await tick();
    expect(diFub).toHaveBeenCalledWith("disegno.object.lock");
    expect(sessione.comando).toHaveBeenCalledOnce();
  });
});

describe("eseguiVoce, ≡ › Selezione › Riseleziona (K6 T15, giro 2)", () => {
  it("manda al motore disegno.select.reselect con la selezione che c'è, senza cambiare il documento", async () => {
    // Solo selezione: nessuna operazione, quindi niente cronologia.
    const { d, sessione, azioni } = dipendenze({ risposta: esito({ ops: null, selection: ["n1", "n2"] }), leggi: () => [] });
    eseguiVoce(voce({ id: "select.reselect", famiglia: "nucleo", chiamata: { comando: "disegno.select.reselect", valore: {} } }), d);
    await tick();
    expect(sessione.comando).toHaveBeenCalledWith({ id: "disegno.select.reselect", selection: ["n1", "n2"], value: {}, preview: false });
    expect(azioni.commit).not.toHaveBeenCalled();
    expect(azioni.seleziona).toHaveBeenCalledWith(["n1", "n2"]);
  });
});

describe("eseguiVoce, Crea maschera di opacità (K6 T15, giro maschere)", () => {
  it("manda al motore disegno.transparency.makeOpacityMask con clip e invert, e la maschera va alla cronologia", async () => {
    const { d, sessione, azioni } = dipendenze();
    eseguiVoce(voce({ id: "transparency.makeOpacityMask", famiglia: "aspetto", chiamata: { comando: "disegno.transparency.makeOpacityMask", valore: { clip: true, invert: false } } }), d);
    await tick();
    expect(sessione.comando).toHaveBeenCalledWith({
      id: "disegno.transparency.makeOpacityMask",
      selection: ["n1", "n2"],
      value: { clip: true, invert: false },
      preview: false,
    });
    expect(azioni.commit).toHaveBeenCalledOnce();
  });
});

describe("eseguiVoce, coi comandi del testo (K6 T16, testo base)", () => {
  const T16 = ["type.changeCase", "type.createOutlines", "type.convertToAreaType", "type.convertToPointType", "edit.findReplace", "edit.findNext", "text.editRange"];
  const dellIndice = (id: string): VoceIndice => (indiceGenerato.voci as readonly VoceIndice[]).find((una) => una.fonte === "motore" && una.id === id)!;

  it("le sette righe del testo sono nell'indice vero, col prefisso del Disegno", () => {
    for (const id of T16) {
      const una = dellIndice(id);
      expect(una, id).toBeDefined();
      expect(una.chiamata).toMatchObject({ comando: `disegno.${id}` });
      expect(una.famiglia).toBe("testo");
    }
    expect(dellIndice("edit.findReplace").finestra).toBe(true);
  });

  it("Crea contorni e Converti in testo in area arrivano al motore col loro id, sulla selezione", async () => {
    for (const id of ["type.createOutlines", "type.convertToAreaType"]) {
      const { d, sessione } = dipendenze();
      eseguiVoce(dellIndice(id), d);
      await tick();
      expect(sessione.comando).toHaveBeenCalledWith({ id: `disegno.${id}`, selection: ["n1", "n2"], value: {}, preview: false });
    }
  });
});

describe("eseguiVoce, Riduci ad aspetto di base (K6 T15, aspetto)", () => {
  it("manda al motore disegno.appearance.reduceToBasic con la selezione, e il passo va alla cronologia", async () => {
    const { d, sessione, azioni } = dipendenze();
    eseguiVoce(voce({ id: "appearance.reduceToBasic", famiglia: "aspetto", chiamata: { comando: "disegno.appearance.reduceToBasic", valore: {} } }), d);
    await tick();
    expect(sessione.comando).toHaveBeenCalledWith({ id: "disegno.appearance.reduceToBasic", selection: ["n1", "n2"], value: {}, preview: false });
    expect(azioni.commit).toHaveBeenCalledOnce();
  });
});

describe("eseguiVoce, Aggiungi riempimento e Aggiungi contorno (K6 T15, aggiungi aspetto)", () => {
  it.each([
    ["appearance.addFill", "Aggiungi riempimento"],
    ["appearance.addStroke", "Aggiungi contorno"],
  ])("%s manda al motore disegno.%s con la selezione, e il passo va alla cronologia", async (id, etichetta) => {
    const { d, sessione, azioni } = dipendenze();
    eseguiVoce(voce({ id, famiglia: "aspetto", etichetta: { it: etichetta, en: id }, chiamata: { comando: `disegno.${id}`, valore: {} } }), d);
    await tick();
    expect(sessione.comando).toHaveBeenCalledWith({ id: `disegno.${id}`, selection: ["n1", "n2"], value: {}, preview: false });
    expect(azioni.commit).toHaveBeenCalledOnce();
  });
});

describe("eseguiVoce, Seleziona testo di punto e in area (K6 T15, seleziona tipo)", () => {
  it.each([
    ["select.object.pointText", "Oggetti testo per punti"],
    ["select.object.areaText", "Oggetti testo in area"],
  ])("%s manda al motore disegno.%s e sceglie: nessun passo nella cronologia", async (id, etichetta) => {
    // Solo una scelta: nessuna operazione, quindi nessun passo, e la scelta del motore va alla selezione.
    const { d, sessione, azioni } = dipendenze({ risposta: esito({ ops: null, selection: ["n1"] }), leggi: () => [] });
    eseguiVoce(voce({ id, famiglia: "livelli", etichetta: { it: etichetta, en: id }, chiamata: { comando: `disegno.${id}`, valore: {} } }), d);
    await tick();
    expect(sessione.comando).toHaveBeenCalledWith({ id: `disegno.${id}`, selection: ["n1", "n2"], value: {}, preview: false });
    expect(azioni.commit).not.toHaveBeenCalled();
    expect(azioni.seleziona).toHaveBeenCalledWith(["n1"]);
  });
});

describe("eseguiVoce, Seleziona testo per font e Opzioni modifica globale (K6 T15, giro 7)", () => {
  it("select.font manda al motore disegno.select.font col carattere, e sceglie: nessun passo nella cronologia", async () => {
    // Solo una scelta di testi: nessuna operazione, quindi nessun passo, e la scelta va alla selezione.
    const { d, sessione, azioni } = dipendenze({ risposta: esito({ ops: null, selection: ["n1"] }), leggi: () => [] });
    eseguiVoce(voce({ id: "select.font", famiglia: "livelli", etichetta: { it: "Seleziona testo per font", en: "Select Text by Font" }, chiamata: { comando: "disegno.select.font", valore: { family: "Inter" } } }), d);
    await tick();
    expect(sessione.comando).toHaveBeenCalledWith({ id: "disegno.select.font", selection: ["n1", "n2"], value: { family: "Inter" }, preview: false });
    expect(azioni.commit).not.toHaveBeenCalled();
    expect(azioni.seleziona).toHaveBeenCalledWith(["n1"]);
  });

  it("select.globalEditOptions manda al motore le sue opzioni, e la lettura non va alla cronologia", async () => {
    // Le opzioni cambiano la sessione del motore e rispondono con una lettura: nessuna operazione.
    const { d, sessione, azioni } = dipendenze({ risposta: esito({ ops: null, selection: ["n1", "n2"], reading: { count: 4 } }), leggi: () => [] });
    eseguiVoce(voce({ id: "select.globalEditOptions", famiglia: "livelli", etichetta: { it: "Opzioni modifica globale", en: "Global Edit Options" }, chiamata: { comando: "disegno.select.globalEditOptions", valore: { size: true } } }), d);
    await tick();
    expect(sessione.comando).toHaveBeenCalledWith({ id: "disegno.select.globalEditOptions", selection: ["n1", "n2"], value: { size: true }, preview: false });
    expect(azioni.commit).not.toHaveBeenCalled();
  });
});
