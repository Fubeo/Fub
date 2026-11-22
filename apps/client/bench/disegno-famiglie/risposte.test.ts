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
    // I campioni (K6 T14, giro 2): Risorse › Campioni e il campione dato alla selezione, un passo
    // senza operazioni (il banco non riscrive i campioni, la scena si guarda).
    // L'aspetto (K6 T15): la trasparenza (giro 2), il contorno e il punto scelto della sfumatura
    // (giro 5), che il banco non scrive (`aspetto.json`). La sfumatura (K6 T15, giro 5): un passo
    // senza operazioni in `colore.json`.
    // Il testo (K6 T16, giro 1): Carattere e Paragrafo, un passo senza operazioni (il banco non
    // riscrive il testo, la scena si guarda).
    // La forma composta (K6 T13, `forme.json`): Alt e Meno davanti sulle due forme di `?elabora=1`,
    // con le operazioni del motore vero (il gruppo, i suoi membri con l'id e la ricetta).
    // L'elaborazione dei tracciati (K6 T12, giro 5): Unione e Meno davanti sulle due forme di
    // `?elabora=1`, coi tracciati scritti a mano (archi al posto delle curve del motore).
    expect(RISPOSTE.map((r) => r.comando)).toEqual([
      "disegno.transparency.set",
      "disegno.stroke.set",
      "disegno.gradient.selectStop",
      "disegno.edit.colors.saturate",
      "disegno.swatch.new",
      "disegno.swatch.edit",
      "disegno.swatch.delete",
      "disegno.swatch.addUsedColors",
      "disegno.paint.setFill",
      "disegno.paint.setStroke",
      "disegno.paint.editGradient",
      "disegno.paint.setGradientGeom",
      "disegno.paint.lastGradient",
      "disegno.shape.rectangle",
      "disegno.object.compoundShape.make",
      "disegno.select.same.fillColor",
      "disegno.select.same.strokeColor",
      "disegno.select.allOnArtboard",
      "disegno.select.object.textObjects",
      "disegno.strumento.stato",
      "disegno.text.setRangeStyle",
      "disegno.text.setStyle",
      "disegno.path.convertAnchors",
      "disegno.object.path.offsetPath",
      "disegno.object.pathfinder.unite",
      "disegno.object.pathfinder.minusFront",
    ]);
    // Unione e Meno davanti (K6 T12, giro 5): le due forme sovrapposte di `?elabora=1` tolte, e il
    // tracciato al posto di quella davanti, in un passo solo.
    const unione = JSON.parse(rispostaDiFamiglia(richiesta("disegno.object.pathfinder.unite")).ops ?? "[]");
    expect(unione).toHaveLength(1);
    expect(unione[0].op).toBe("batch");
    expect(unione[0].ops.map((op: { op: string }) => op.op)).toEqual(["remove", "remove", "add"]);
    const composta = JSON.parse(rispostaDiFamiglia(richiesta("disegno.object.compoundShape.make", { mode: "subtract" })).ops ?? "[]");
    expect(composta[0].ops.map((op: { op: string }) => op.op)).toEqual(["remove", "remove", "add", "add"]);
    expect(rispostaDiFamiglia(richiesta("disegno.text.setRangeStyle", { size: 40 })).ops).toBe("[]");
    expect(rispostaDiFamiglia(richiesta("disegno.swatch.new", { name: "Verde", color: "#009e73" })).refused).toBeNull();
    expect(rispostaDiFamiglia(richiesta("disegno.object.path.offsetPath", { offset: 10 })).preview?.overlays).toHaveLength(1);
    expect(rispostaDiFamiglia(richiesta("disegno.gradient.selectStop", { index: 2 })).reading).toEqual({ index: 0 });
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
