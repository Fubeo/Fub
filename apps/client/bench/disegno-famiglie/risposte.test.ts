// Le risposte del motore del banco ai comandi del Completo (`risposte.ts`).
import { describe, expect, it } from "vitest";
import { DRAWING_COMMAND_FAMILY_PREPARE, DRAWING_FAMILIES, type DrawingCommandRequest } from "../../src/host/contract";
import { RISPOSTE, rispostaDiFamiglia, type RispostaFamiglia } from "./risposte";

const richiesta = (id: string, value: unknown = null): DrawingCommandRequest => ({ revision: "3", id, selection: ["oa1a1a1a1"], value });

describe("le risposte delle famiglie del banco", () => {
  it("c'è un file per famiglia, e oggi le risposte sono lo stato del nucleo, il Rettangolo, la Selezione e i tracciati del Completo", () => {
    const file = Object.keys(import.meta.glob("./*.json")).map((nome) => nome.slice(2, -5)).sort();
    expect(file).toEqual([...DRAWING_FAMILIES].sort());
    // Il Completo legge lo stato dello strumento del motore a famiglia pronta
    // (K6 T11): senza risposta la sessione del banco si darebbe per assente.
    // Il Rettangolo del Completo risponde alla sua finestra (K6 T13, `forme.json`).
    // I tracciati (K6 T12, giro 4): Converti della sezione dei punti, e l'anteprima di
    // Sposta tracciato, coi contorni nuovi dell'ellisse della prima forma. La Selezione (K6 T15,
    // `livelli.json`): «Uguale › Colore riempimento», «Tutto nella tavola» e «Oggetti di testo».
    // Il colore (K6 T14, giro 1): l'anteprima di Satura, coi contorni della prima forma.
    // Il testo (K6 T16, giro 1): Carattere e Paragrafo, un passo senza operazioni (il banco non
    // riscrive il testo, la scena si guarda).
    expect(RISPOSTE.map((r) => r.comando)).toEqual([
      "disegno.edit.colors.saturate",
      "disegno.shape.rectangle",
      "disegno.select.same.fillColor",
      "disegno.select.same.strokeColor",
      "disegno.select.allOnArtboard",
      "disegno.select.object.textObjects",
      "disegno.strumento.stato",
      "disegno.text.setRangeStyle",
      "disegno.text.setStyle",
      "disegno.path.convertAnchors",
      "disegno.object.path.offsetPath",
    ]);
    expect(rispostaDiFamiglia(richiesta("disegno.text.setRangeStyle", { size: 40 })).ops).toBe("[]");
    expect(rispostaDiFamiglia(richiesta("disegno.object.path.offsetPath", { offset: 10 })).preview?.overlays).toHaveLength(1);
    expect(rispostaDiFamiglia(richiesta("disegno.strumento.stato", { strumento: "lasso" })).state?.cursor).toBe("arrow");
  });

  it("preparare una famiglia risponde pronta; una famiglia che non c'è è bad_args", () => {
    const esito = rispostaDiFamiglia(richiesta(DRAWING_COMMAND_FAMILY_PREPARE, { famiglia: "nucleo" }));
    expect(esito.reading).toEqual({ famiglia: "nucleo", stato: "pronta" });
    expect(esito.revision).toBe("3");
    expect(() => rispostaDiFamiglia(richiesta(DRAWING_COMMAND_FAMILY_PREPARE, { famiglia: "boh" }))).toThrow(expect.objectContaining({ kind: "bad_args" }));
  });

  it("un comando con la sua risposta la rende; senza, unserved come una riga da fare", () => {
    const risposte: RispostaFamiglia[] = [
      { comando: "disegno.edit.duplicate", esito: { ops: "[]", selection: ["oc3c3c3c3"] } },
      { comando: "disegno.effect.apply", argomenti: { effect: "stylize.roundCorners", params: { radius: 15 } }, esito: { refused: "unsupported" } },
    ];
    expect(rispostaDiFamiglia(richiesta("disegno.edit.duplicate"), risposte)).toMatchObject({ ops: "[]", selection: ["oc3c3c3c3"], refused: null });
    // Gli argomenti uguali come JSON, con le chiavi in un altro ordine.
    expect(rispostaDiFamiglia(richiesta("disegno.effect.apply", { params: { radius: 15 }, effect: "stylize.roundCorners" }), risposte).refused).toBe("unsupported");
    expect(() => rispostaDiFamiglia(richiesta("disegno.effect.apply", { effect: "stylize.roundCorners", params: { radius: 3 } }), risposte)).toThrow(expect.objectContaining({ kind: "unserved" }));
    expect(() => rispostaDiFamiglia(richiesta("disegno.edit.clear"), risposte)).toThrow(expect.objectContaining({ kind: "unserved" }));
  });
});
