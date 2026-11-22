// I comandi di livello del Completo (K6 T15, giro 4): la porta legge i numeri dei livelli con
// `document.inspect`, manda occhio, lucchetto, nome, livello nuovo ed elimina con gli `ids` del
// motore, e dice all'editor che cosa scrivere. Quando il motore non può farlo (spento, famiglia che
// non arriva, livello senza id che il motore conosca) l'editor lo fa da sé. Motore e famiglie finti.
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DrawingCommandRequest, DrawingOutcome } from "../../../host/contract";
import { openLifetime, type Lifetime } from "../../../ui/lifetime";
import type { Op } from "../scene/ops";
import type { StatoFamiglia } from "./carica";
import { creaPortaLivelli, type DipendenzePorta } from "./livelli-porta";

const lifetimes: Lifetime[] = [];
afterEach(() => {
  for (const life of lifetimes.splice(0)) life.close();
});
function vita(): Lifetime {
  const life = openLifetime();
  lifetimes.push(life);
  return life;
}

function esito(overrides: Partial<DrawingOutcome> = {}): DrawingOutcome {
  return { revision: "1", preview: null, ops: "[]", selection: [], losses: [], refused: null, frame: null, ...overrides } as DrawingOutcome;
}

/// La lettura del motore: due livelli di Fub (col loro id della scena come nome) e il livello
/// implicito degli elementi fuori dai livelli.
const LETTURA = {
  layers: [
    { id: 7, name: "l2", kind: "Layer", visible: true, locked: false, children: [] },
    { id: 4, name: "l1", kind: "Layer", visible: true, locked: true, children: [{ id: 5, name: "r", kind: "Rectangle" }] },
    { id: 2, name: "Layer 1", kind: "Layer", visible: true, locked: false, children: [] },
  ],
};

const SET: Op[] = [{ op: "set", id: "l1", attrs: { display: "none" } }];

type Comando = Omit<DrawingCommandRequest, "revision">;

/// Il motore finto: `inspect` dà `LETTURA`, gli altri comandi `risposta`.
function prepara(over: { risposta?: DrawingOutcome | null; famiglia?: StatoFamiglia; assente?: boolean; sessione?: boolean; leggi?: DipendenzePorta["leggi"] } = {}) {
  const chiamate: Comando[] = [];
  const sessione = {
    comando: vi.fn((richiesta: Comando) => {
      chiamate.push(richiesta);
      if (richiesta.id === "disegno.document.inspect") return Promise.resolve(esito({ ops: null, reading: LETTURA }));
      return Promise.resolve(over.risposta === undefined ? esito({ ops: JSON.stringify(SET) }) : over.risposta);
    }),
  };
  const motore = {
    assente: () => (over.assente === true ? { kind: "spento" } : null),
    pronta: vi.fn(() => Promise.resolve(over.sessione === false ? null : sessione)),
  };
  const famiglie: string[] = [];
  const dipendenze: DipendenzePorta = {
    motore: motore as unknown as DipendenzePorta["motore"],
    carica: {
      famiglia: (id: string) => {
        famiglie.push(id);
        return Promise.resolve(over.famiglia ?? { kind: "pronta" });
      },
    },
    vita: vita(),
    leggi: over.leggi ?? ((ops) => (ops === null ? [] : (JSON.parse(ops) as Op[]))),
  };
  return { porta: creaPortaLivelli(dipendenze), chiamate, famiglie };
}

describe("creaPortaLivelli", () => {
  it("l'occhio: legge i numeri, manda setProps con l'id del motore del livello, e dà le operazioni", async () => {
    const { porta, chiamate, famiglie } = prepara();
    const fatto = await porta.comando({ kind: "proprieta", livello: "l1", visibile: false });
    expect(fatto).toEqual({ kind: "fatto", ops: SET });
    expect(famiglie.sort()).toEqual(["livelli", "nucleo"]);
    expect(chiamate.map((c) => c.id)).toEqual(["disegno.document.inspect", "disegno.layer.setProps"]);
    expect(chiamate[1]).toMatchObject({ selection: [], value: { ids: [4], visible: false }, preview: false });
    expect(chiamate[1]!.value).not.toHaveProperty("name");
  });

  it("il nome e il lucchetto vanno nello stesso comando, ciascuno solo se c'è", async () => {
    const { porta, chiamate } = prepara();
    await porta.comando({ kind: "proprieta", livello: "l2", nome: "Sfondo" });
    await porta.comando({ kind: "proprieta", livello: "l2", bloccato: true });
    expect(chiamate[1]!.value).toEqual({ ids: [7], name: "Sfondo" });
    expect(chiamate[3]!.value).toEqual({ ids: [7], locked: true });
  });

  it("il livello nuovo non legge i numeri, e porta il nome che l'editor ha scelto", async () => {
    const { porta, chiamate } = prepara();
    await porta.comando({ kind: "nuovo", nome: "Livello 3" });
    expect(chiamate).toHaveLength(1);
    expect(chiamate[0]).toMatchObject({ id: "disegno.layer.new", value: { name: "Livello 3", visible: true, locked: false } });
  });

  it("elimina col numero del livello", async () => {
    const { porta, chiamate } = prepara();
    await porta.comando({ kind: "elimina", livello: "l2" });
    expect(chiamate[1]).toMatchObject({ id: "disegno.layer.delete", value: { ids: [7] } });
  });

  it("un livello bloccato rifiutato dal motore ha la sua frase, non quella della selezione", async () => {
    const { porta } = prepara({ risposta: esito({ refused: "locked", ops: null }) });
    expect(await porta.comando({ kind: "proprieta", livello: "l1", nome: "X" })).toEqual({ kind: "rifiuto", motivo: "draw.livelli.bloccato" });
  });

  it("un rifiuto vuoto non ha niente da dire; uno di un'altra parte ha il suo perché", async () => {
    expect(await prepara({ risposta: esito({ refused: "empty", ops: null }) }).porta.comando({ kind: "elimina", livello: "l2" })).toEqual({ kind: "rifiuto", motivo: null });
    expect(await prepara({ risposta: esito({ refused: "unmapped", ops: null }) }).porta.comando({ kind: "elimina", livello: "l2" })).toEqual({
      kind: "rifiuto",
      motivo: "draw.reason.foreign",
    });
  });

  it("un livello che il motore non conosce per id lo fa l'editor, senza mandare il comando", async () => {
    const { porta, chiamate } = prepara();
    expect(await porta.comando({ kind: "proprieta", livello: "", visibile: false })).toEqual({ kind: "nativo" });
    expect(await porta.comando({ kind: "elimina", livello: "l9" })).toEqual({ kind: "nativo" });
    expect(chiamate.map((c) => c.id)).toEqual(["disegno.document.inspect", "disegno.document.inspect"]);
  });

  it("motore spento, famiglia che non arriva o sessione che non si apre: lo fa l'editor", async () => {
    const richiesta = { kind: "proprieta", livello: "l1", visibile: false } as const;
    const spento = prepara({ assente: true });
    expect(await spento.porta.comando(richiesta)).toEqual({ kind: "nativo" });
    expect(spento.chiamate).toEqual([]);
    const senzaFamiglia = prepara({ famiglia: { kind: "errore", perche: "motore" } });
    expect(await senzaFamiglia.porta.comando(richiesta)).toEqual({ kind: "nativo" });
    expect(senzaFamiglia.chiamate).toEqual([]);
    expect(await prepara({ sessione: false }).porta.comando(richiesta)).toEqual({ kind: "nativo" });
    expect(await prepara({ risposta: null }).porta.comando(richiesta)).toEqual({ kind: "nativo" });
  });

  it("operazioni che non si leggono: il comando è fallito, e niente si scrive", async () => {
    const { porta } = prepara({ leggi: () => null });
    expect(await porta.comando({ kind: "proprieta", livello: "l1", visibile: false })).toEqual({ kind: "fallito" });
  });
});
