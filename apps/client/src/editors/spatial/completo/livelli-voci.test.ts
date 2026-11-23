// @vitest-environment happy-dom
// Le sei voci che il giro K6 «organizzazione dei livelli» ha portato a «fatto» (`layer.hideOthers`,
// `layer.lockOthers`, `object.hide.above`, `object.hide.otherLayers`, `object.lock.above`,
// `object.lock.otherLayers`), provate dal client con l'host finto: dove compaiono, che cosa mandano al
// motore, quando sono spente, che cosa dicono quando il motore rifiuta, se annullano in un passo, e se
// un doppio clic manda una sola chiamata. Le risposte del motore sono le uscite attese dei casi Rust
// (`crates/fub-disegno/tests/famiglie/livelli.json` e `nucleo.json`): il client non decide niente, quindi
// qui si prova ciò che manda e ciò che dice con quelle risposte.
//
// Tabella voce → posto → test: in fondo al file, nel commento «Tabella».
import { describe, expect, it, vi } from "vitest";
import type { DrawingCommandInfo, DrawingOutcome } from "../../../host/contract";
import { openLifetime } from "../../../ui/lifetime";
import type { MenuItem } from "../../../ui/menu";
import type { Op } from "../scene/ops";
import { t } from "../strings";
import type { MotoreDelDisegno } from "../motore/gesti";
import type { SessioneMotore } from "../motore/sessione";
import { apri } from "./index";
import { indiceDi, type VoceIndice } from "./indice";
import indiceGenerato from "./indice.generated.json";
import { nomeVoce, percorsoPosto, testoPerche } from "./comandi";
import { etichettaDi } from "./esegui";

/// Le sei voci e le loro attese dal posto dell'indice.
const VOCI = [
  { id: "layer.hideOthers", posto: "ispettore/livelli", famiglia: "livelli", etichetta: "Nascondi altri" },
  { id: "layer.lockOthers", posto: "ispettore/livelli", famiglia: "livelli", etichetta: "Blocca altri" },
  { id: "object.hide.above", posto: "menu/oggetto/nascondi", famiglia: "nucleo", etichetta: "Tutta la grafica soprastante" },
  { id: "object.hide.otherLayers", posto: "menu/oggetto/nascondi", famiglia: "nucleo", etichetta: "Altri livelli" },
  { id: "object.lock.above", posto: "menu/oggetto/blocca", famiglia: "nucleo", etichetta: "Tutta la grafica soprastante" },
  { id: "object.lock.otherLayers", posto: "menu/oggetto/blocca", famiglia: "nucleo", etichetta: "Altri livelli" },
] as const;

/// Un oggetto dentro un livello, nei file della carta con tre livelli (`livelli/tre-livelli.svg`).
const DENTRO = "ob2b2b2b2";
/// Un oggetto fuori da ogni livello (`livelli/estraneo.svg`: il rettangolo `r1`).
const FUORI = "r1";

/// Le operazioni che il motore dà per ogni voce con `DENTRO` (i casi Rust).
const OPS: Record<string, string> = {
  "layer.hideOthers": JSON.stringify([
    { op: "batch", ops: [{ op: "set", id: "l1a2b3c4d", attrs: { display: "none" } }, { op: "set", id: "l3c3c3c3c", attrs: { display: "none" } }] },
  ]),
  "layer.lockOthers": JSON.stringify([
    { op: "batch", ops: [{ op: "set", id: "l1a2b3c4d", attrs: { "fub:locked": "true" } }, { op: "set", id: "l3c3c3c3c", attrs: { "fub:locked": "true" } }] },
  ]),
  "object.hide.otherLayers": JSON.stringify([
    { op: "batch", ops: [{ op: "set", id: "l1a2b3c4d", attrs: { display: "none" } }, { op: "set", id: "l3c3c3c3c", attrs: { display: "none" } }] },
  ]),
  "object.lock.otherLayers": JSON.stringify([
    { op: "batch", ops: [{ op: "set", id: "l1a2b3c4d", attrs: { "fub:locked": "true" } }, { op: "set", id: "l3c3c3c3c", attrs: { "fub:locked": "true" } }] },
  ]),
  // «Tutta la grafica soprastante» sullo stesso livello (`livelli/sovrapposti-un-livello.svg`, `oa1`).
  "object.hide.above": JSON.stringify([{ op: "set", id: "ob2b2b2b2", attrs: { display: "none" } }]),
  "object.lock.above": JSON.stringify([{ op: "set", id: "ob2b2b2b2", attrs: { "fub:locked": "true" } }]),
};

/// La selezione per le operazioni: su `tre-livelli` gli `ob2`, su `sovrapposti` gli `oa1` (la voce
/// `above` lo vuole lì, come nei suoi casi Rust).
const SELEZIONE_PER: Record<string, readonly string[]> = {
  "object.hide.above": ["oa1a1a1a1"],
  "object.lock.above": ["oa1a1a1a1"],
};

const voceDi = (id: string): VoceIndice => {
  const voce = (indiceGenerato as { voci: VoceIndice[] }).voci.find((v) => v.id === id);
  if (voce === undefined) throw new Error(`manca ${id} nell'indice`);
  return voce;
};

/// Il motore finto: la sessione, con la risposta del comando (per id e selezione) e lo stato dei comandi.
function motoreCon(
  risposta: (id: string, selezione: readonly string[]) => DrawingOutcome | null,
  comandi: DrawingCommandInfo[] = [],
): { motore: MotoreDelDisegno; comando: ReturnType<typeof vi.fn> } {
  const comando = vi.fn((richiesta: { id: string; selection: string[] }) => {
    if (richiesta.id === "disegno.famiglia.prepara") return Promise.resolve(esito([]));
    return Promise.resolve(risposta(richiesta.id.replace(/^disegno\./u, ""), richiesta.selection));
  });
  const sessione = { comando, comandi: vi.fn(() => Promise.resolve(comandi)) } as unknown as SessioneMotore;
  const motore = { adesso: () => sessione, pronta: () => Promise.resolve(sessione), assente: () => null } as unknown as MotoreDelDisegno;
  return { motore, comando };
}

function esito(selection: readonly string[], patch: Partial<DrawingOutcome> = {}): DrawingOutcome {
  return { revision: "1", preview: null, ops: "[]", selection: [...selection], losses: [], refused: null, frame: null, ...patch };
}

const AZIONI = { strumento: vi.fn(), client: vi.fn(), riprova: vi.fn() };

/// Il Completo con la selezione `sel`, i tasti spiati e il motore dato.
function completo(motore: MotoreDelDisegno | null, sel: readonly string[]) {
  const commit = vi.fn((_ops: readonly Op[], _nome: string) => true);
  const annuncia = vi.fn();
  const seleziona = vi.fn();
  const c = apri(
    { motore, life: openLifetime() } as never,
    {
      indice: () => Promise.resolve(indiceDi(indiceGenerato as never)),
      prepara: () => Promise.resolve("pronta"),
      moduli: {
        "./famiglie/livelli/index.ts": () => import("./famiglie/livelli/index"),
        "./famiglie/nucleo/index.ts": () => import("./famiglie/nucleo/index"),
      },
      tasti: {
        radice: document.createElement("div"),
        selezione: () => sel,
        anteprima: vi.fn(),
        stato: () => ({ vuoleTesto: false, componendo: false }),
        leggi: (ops: string | null) => (ops === null ? null : (JSON.parse(ops) as Op[])),
        commit,
        seleziona,
        annuncia,
      },
    } as never,
  );
  return { c, commit, annuncia, seleziona };
}

/// La riga della ricerca Ctrl+/ di una voce, con il suo percorso.
async function rigaDi(c: ReturnType<typeof completo>["c"], id: string, sel: readonly string[]) {
  const righe = await c.ricerca(() => sel, AZIONI);
  // La famiglia della voce si carica alla prima richiesta: un giro di attesa, come al clic vero.
  await new Promise((ok) => setTimeout(ok, 10));
  return righe?.find((r) => r.key === id);
}

/// I figli di una voce del menu, se sono una lista (i sottomenu del menu ≡ lo sono).
function figli(voce: MenuItem): readonly MenuItem[] {
  return Array.isArray(voce.items) ? voce.items : [];
}

/// Le etichette delle voci dentro il sottomenu `percorso` (`["Oggetto", "Blocca"]`), o `[]` se non c'è.
function vociSotto(voci: readonly MenuItem[], percorso: readonly string[]): string[] {
  let livello: readonly MenuItem[] = voci;
  for (const passo of percorso) {
    const trovato = livello.find((voce) => voce.label === passo && figli(voce).length > 0);
    if (trovato === undefined) return [];
    livello = figli(trovato);
  }
  return livello.map((voce) => voce.label);
}

/// La voce `etichetta` dentro il sottomenu `percorso`: due voci hanno la stessa etichetta.
function trovaSotto(voci: readonly MenuItem[], percorso: readonly string[], etichetta: string): MenuItem | undefined {
  let livello: readonly MenuItem[] = voci;
  for (const passo of percorso) {
    const trovato = livello.find((voce) => voce.label === passo && figli(voce).length > 0);
    livello = trovato === undefined ? [] : figli(trovato);
  }
  return livello.find((voce) => voce.label === etichetta);
}

/// Il sottomenu del menu ≡ di ogni voce di oggetto, come l'etichetta del suo posto.
const SOTTOMENU: Record<string, readonly string[]> = {
  "object.hide.above": ["Oggetto", "Nascondi"],
  "object.hide.otherLayers": ["Oggetto", "Nascondi"],
  "object.lock.above": ["Oggetto", "Blocca"],
  "object.lock.otherLayers": ["Oggetto", "Blocca"],
};

/// Il percorso di una voce del menu ≡, con le etichette dei sottomenu.
function etichetteDelMenu(voci: readonly MenuItem[], etichetta: string, prima: readonly string[] = []): string[] | null {
  for (const voce of voci) {
    if (voce.label === etichetta) return [...prima];
    if (figli(voce).length > 0) {
      const dentro = etichetteDelMenu(figli(voce), etichetta, [...prima, voce.label]);
      if (dentro !== null) return dentro;
    }
  }
  return null;
}

describe("le voci di livello e di oggetto del giro K6 «organizzazione dei livelli»", () => {
  for (const { id, posto, famiglia, etichetta } of VOCI) {
    describe(id, () => {
      it(`è nell'indice con il comando disegno.${id}, nel posto ${posto}, famiglia ${famiglia}, etichetta «${etichetta}»`, () => {
        const voce = voceDi(id);
        expect(voce.chiamata).toEqual({ comando: `disegno.${id}` });
        expect(voce.posto).toBe(posto);
        expect(voce.famiglia).toBe(famiglia);
        expect(voce.etichetta.it).toBe(etichetta);
        expect(voce.finestra).toBe(false);
      });

      it("la ricerca Ctrl+/ la trova nel suo percorso, e sceglierla manda il comando con la selezione, senza valori", async () => {
        const sel = SELEZIONE_PER[id] ?? [DENTRO];
        const { motore, comando } = motoreCon((cmd, s) => esito(s, cmd === id ? { ops: OPS[id] ?? "[]" } : {}));
        const { c } = completo(motore, sel);
        const riga = await rigaDi(c, id, sel);
        expect(riga, `la ricerca trova ${id}`).toBeDefined();
        expect(riga!.path).toBe(percorsoPosto(posto));
        riga!.run();
        await vi.waitFor(() => expect(comando).toHaveBeenCalledWith(expect.objectContaining({ id: `disegno.${id}` })));
        const richiesta = comando.mock.calls.find(([r]) => r.id === `disegno.${id}`)![0];
        expect(richiesta.selection).toEqual([...sel]);
        // Nessun parametro: il valore è il fisso della voce, vuoto.
        expect(richiesta.value).toEqual({});
        c.chiudi();
      });

      it("annulla in un passo: l'esito con operazioni va in un solo commit, col nome della voce", async () => {
        const sel = SELEZIONE_PER[id] ?? [DENTRO];
        const { motore } = motoreCon((cmd, s) => esito(s, cmd === id ? { ops: OPS[id] } : {}));
        const { c, commit } = completo(motore, sel);
        const riga = await rigaDi(c, id, sel);
        riga!.run();
        await vi.waitFor(() => expect(commit).toHaveBeenCalledTimes(1));
        const [ops, nome] = commit.mock.calls[0]! as unknown as [Op[], string];
        expect(ops.length).toBeGreaterThan(0);
        expect(nome).toBe(etichettaDi(voceDi(id)));
        c.chiudi();
      });

      it("con un rifiuto del motore (oggetto fuori dai livelli) dice la frase e non scrive", async () => {
        const { motore } = motoreCon((cmd, s) => esito(s, cmd === id ? { refused: "empty", ops: null } : {}));
        const { c, commit, annuncia } = completo(motore, [FUORI]);
        const riga = await rigaDi(c, id, [FUORI]);
        riga!.run();
        const frase = t("draw.completo.key.unchanged", { command: etichettaDi(voceDi(id)) });
        await vi.waitFor(() => expect(annuncia).toHaveBeenCalledWith(frase));
        expect(commit).not.toHaveBeenCalled();
        c.chiudi();
      });

      it("spenta col perché quando il motore dice che il comando non vale per la selezione", async () => {
        const { motore } = motoreCon(
          (_cmd, s) => esito(s),
          [{ id: `disegno.${id}`, enabled: false, disabled_reason: "no_selection" }],
        );
        const { c } = completo(motore, []);
        const righe = await c.menu(() => [], AZIONI);
        const voce = SOTTOMENU[id] === undefined ? undefined : trovaSotto(righe, SOTTOMENU[id], nomeVoce(voceDi(id)));
        if (voce === undefined) {
          // Le voci dei livelli non stanno nel menu ≡ (il loro posto è l'ispettore): lo dice la ricerca.
          const riga = await rigaDi(c, id, []);
          expect(riga!.disabled).toBe(true);
          expect(riga!.description).toBe(testoPerche("no_selection"));
        } else {
          expect(voce.disabled).toBe(true);
          expect(voce.description).toBe(testoPerche("no_selection"));
        }
        c.chiudi();
      });

      it("un doppio clic veloce manda una sola chiamata al motore", async () => {
        const sel = SELEZIONE_PER[id] ?? [DENTRO];
        const { motore, comando } = motoreCon((cmd, s) => esito(s, cmd === id ? { ops: OPS[id] } : {}));
        const { c } = completo(motore, sel);
        const riga = await rigaDi(c, id, sel);
        riga!.run();
        riga!.run();
        await vi.waitFor(() => expect(comando.mock.calls.some(([r]) => r.id === `disegno.${id}`)).toBe(true));
        await new Promise((ok) => setTimeout(ok, 20));
        expect(comando.mock.calls.filter(([r]) => r.id === `disegno.${id}`)).toHaveLength(1);
        c.chiudi();
      });
    });
  }
});

describe("i posti nel menu ≡ e nella ricerca", () => {
  it("le voci di oggetto stanno nel menu ≡, sotto Oggetto, nel sottomenu del loro posto", async () => {
    const { motore } = motoreCon((_cmd, s) => esito(s));
    const { c } = completo(motore, [DENTRO]);
    const righe = await c.menu(() => [DENTRO], AZIONI);
    // Due voci hanno la stessa etichetta («Altri livelli»), una per sottomenu: si guarda il sottomenu.
    const nascondi = vociSotto(righe, ["Oggetto", "Nascondi"]);
    const blocca = vociSotto(righe, ["Oggetto", "Blocca"]);
    expect(nascondi).toEqual(expect.arrayContaining([nomeVoce(voceDi("object.hide.above")), nomeVoce(voceDi("object.hide.otherLayers"))]));
    expect(blocca).toEqual(expect.arrayContaining([nomeVoce(voceDi("object.lock.above")), nomeVoce(voceDi("object.lock.otherLayers"))]));
    c.chiudi();
  });

  it("le voci di livello («ispettore/livelli») non stanno nel menu ≡: le trova solo la ricerca Ctrl+/", async () => {
    // Il loro posto è l'ispettore, e il menu ≡ mostra solo i posti `menu/…`: nessun pannello le disegna.
    const { motore } = motoreCon((_cmd, s) => esito(s));
    const { c } = completo(motore, [DENTRO]);
    const righe = await c.menu(() => [DENTRO], AZIONI);
    expect(etichetteDelMenu(righe, nomeVoce(voceDi("layer.hideOthers")))).toBeNull();
    expect(etichetteDelMenu(righe, nomeVoce(voceDi("layer.lockOthers")))).toBeNull();
    const riga = await rigaDi(c, "layer.hideOthers", [DENTRO]);
    expect(riga!.path).toBe("Ispettore › Livelli");
    c.chiudi();
  });
});

describe("gli scenari della carta, dei livelli e del motore", () => {
  it("carta e tre livelli: Nascondi altri con un oggetto dentro tiene il suo livello e nasconde gli altri in un passo", async () => {
    const { motore } = motoreCon((cmd, s) => esito(s, cmd === "layer.hideOthers" ? { ops: OPS["layer.hideOthers"] } : {}));
    const { c, commit } = completo(motore, [DENTRO]);
    const riga = await rigaDi(c, "layer.hideOthers", [DENTRO]);
    riga!.run();
    await vi.waitFor(() => expect(commit).toHaveBeenCalledTimes(1));
    const ops = JSON.stringify(commit.mock.calls[0]![0]);
    expect(ops).toContain("l1a2b3c4d");
    expect(ops).toContain("l3c3c3c3c");
    expect(ops).not.toContain("l2b2b2b2b");
    c.chiudi();
  });

  it("disegno senza livelli: Nascondi altri dice la frase e non scrive", async () => {
    const { motore } = motoreCon((cmd, s) => esito(s, cmd === "layer.hideOthers" ? { refused: "empty", ops: null } : {}));
    const { c, commit, annuncia } = completo(motore, [DENTRO]);
    const riga = await rigaDi(c, "layer.hideOthers", [DENTRO]);
    riga!.run();
    await vi.waitFor(() => expect(annuncia).toHaveBeenCalledWith(t("draw.completo.key.unchanged", { command: etichettaDi(voceDi("layer.hideOthers")) })));
    expect(commit).not.toHaveBeenCalled();
    c.chiudi();
  });

  it("un oggetto fuori dai livelli: Tutta la grafica soprastante lo dice e non scrive", async () => {
    const { motore } = motoreCon((cmd, s) => esito(s, cmd === "object.hide.above" ? { refused: "empty", ops: null } : {}));
    const { c, commit, annuncia } = completo(motore, [FUORI]);
    const riga = await rigaDi(c, "object.hide.above", [FUORI]);
    riga!.run();
    await vi.waitFor(() => expect(annuncia).toHaveBeenCalledWith(t("draw.completo.key.unchanged", { command: etichettaDi(voceDi("object.hide.above")) })));
    expect(commit).not.toHaveBeenCalled();
    c.chiudi();
  });

  it("un solo livello: Altri livelli non ha altri livelli da toccare e dice la frase senza scrivere", async () => {
    const { motore } = motoreCon((cmd, s) => esito(s, cmd === "object.hide.otherLayers" ? { refused: "empty", ops: null } : {}));
    const { c, commit, annuncia } = completo(motore, ["oa1a1a1a1"]);
    const riga = await rigaDi(c, "object.hide.otherLayers", ["oa1a1a1a1"]);
    riga!.run();
    await vi.waitFor(() => expect(annuncia).toHaveBeenCalledWith(t("draw.completo.key.unchanged", { command: etichettaDi(voceDi("object.hide.otherLayers")) })));
    expect(commit).not.toHaveBeenCalled();
    c.chiudi();
  });

  it("motore assente: nessun comando parte e il Completo lo dice", async () => {
    const { c, commit, annuncia } = completo(null, [DENTRO]);
    const riga = await rigaDi(c, "layer.lockOthers", [DENTRO]);
    riga!.run();
    await new Promise((ok) => setTimeout(ok, 20));
    expect(commit).not.toHaveBeenCalled();
    expect(annuncia).toHaveBeenCalled();
    c.chiudi();
  });
});

/*
 * Tabella voce → posto → test (questo file):
 *
 * | voce                      | posto                  | dove compare                 | comando e argomenti              | spenta col perché | rifiuto → frase | annulla in un passo | doppio clic |
 * |---------------------------|------------------------|------------------------------|----------------------------------|-------------------|-----------------|---------------------|-------------|
 * | layer.hideOthers          | ispettore/livelli      | Ctrl+/ (non nel menu ≡)      | disegno.id, selezione, nessun valore | sì             | sì              | sì                  | sì          |
 * | layer.lockOthers          | ispettore/livelli      | Ctrl+/ (non nel menu ≡)      | disegno.id, selezione, nessun valore | sì             | sì              | sì                  | sì          |
 * | object.hide.above         | menu/oggetto/nascondi  | menu ≡ › Oggetto › Nascondi, Ctrl+/ | disegno.id, selezione, nessun valore | sì        | sì              | sì                  | sì          |
 * | object.hide.otherLayers   | menu/oggetto/nascondi  | menu ≡ › Oggetto › Nascondi, Ctrl+/ | disegno.id, selezione, nessun valore | sì        | sì              | sì                  | sì          |
 * | object.lock.above         | menu/oggetto/blocca    | menu ≡ › Oggetto › Blocca, Ctrl+/   | disegno.id, selezione, nessun valore | sì        | sì              | sì                  | sì          |
 * | object.lock.otherLayers   | menu/oggetto/blocca    | menu ≡ › Oggetto › Blocca, Ctrl+/   | disegno.id, selezione, nessun valore | sì        | sì              | sì                  | sì          |
 *
 * Scenari: carta e tre livelli, disegno senza livelli, oggetto fuori dai livelli, un solo livello, motore
 * assente. Il rifiuto del motore è la frase `draw.completo.key.unchanged` (nessuna scelta, `empty`).
 */
