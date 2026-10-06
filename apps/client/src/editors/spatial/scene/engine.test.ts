// Il motore delle operazioni oltre i vettori di `vectors.test.ts`: la forma
// della rete, i rifiuti uno per uno, i limiti, l'undo che non è esatto, i
// rientri di un `move`, `adopt` e `page` nei casi di bordo. I testi attesi
// sono scritti a mano, e i `§` sono le sezioni di
// `docs/reference/scene-operations.md`.

import { describe, expect, it } from "vitest";
import { tryApplyOperation } from "../../core/text-operation";
import { parseBrush } from "../ink/brush";
import { decodeInk, inkToQuantized } from "../ink/codec";
import { pf1 } from "../ink/pf1";
import { mergeUndo, SceneEngine, type Applied, type Outcome } from "./engine";
import { MAX_BATCH, MAX_NESTING, MAX_OP_BYTES, MAX_VALUE_BYTES, parseWireOp, type Op, type Reason } from "./ops";
import { MAX_EDIT_BYTES, MAX_ELEMENTS, readScene } from "./read";
import type { Elem } from "./serialize";
import { normalizeEol } from "./text";

const NS = 'xmlns="http://www.w3.org/2000/svg" xmlns:fub="https://fubeo.github.io/ns/scene/1"';
const FUB_NS = "https://fubeo.github.io/ns/scene/1";
const ROOT = `<svg ${NS} fub:version="1" viewBox="0 0 1600 1000" width="1600" height="1000">`;
const TITLE = "  <title>Prova</title>";
const PAPER = '  <rect id="fub-paper" fub:role="paper" x="0" y="0" width="1600" height="1000" fill="#ffffff"/>';
const L1 = '  <g id="l3f8a0c2d" fub:layer="Livello 1">';
const L1_LOCKED = '  <g id="l3f8a0c2d" fub:layer="Livello 1" fub:locked="true">';
const L2 = '  <g id="l9k8j7h6g" fub:layer="Livello 2">';
const L2_LOCKED = '  <g id="l9k8j7h6g" fub:layer="Livello 2" fub:locked="true">';
const END_G = "  </g>";
const END = "</svg>";
const E1 = '    <ellipse id="o1a2b3c4d" cx="300" cy="200" rx="120" ry="60" fill="none" stroke="#0072b2" stroke-width="4"/>';
const R2 = '    <rect id="o2b3c4d5e" x="500" y="100" width="200" height="120" fill="#e69f00"/>';
const R3 = '    <rect id="o3c4d5e6f" x="800" y="100" width="200" height="120" fill="#009e73"/>';
const R4 = '    <rect id="o4d5e6f7g" x="10" y="20" width="30" height="40"/>';
const R4_ELEM: Elem = { tag: "rect", attrs: { id: "o4d5e6f7g", x: "10", y: "20", width: "30", height: "40" } };

const INK = "1 s100 cxypt 12050,3020,128,0 25,-3,2,8 31,-5,0,8";
const BRUSH = "pf1 size=4 thinning=0.5 smoothing=0.5 streamline=0.5 taperStart=0 taperEnd=0 capStart=1 capEnd=1 sim=0";

const lf = (...lines: string[]): string => `${lines.join("\n")}\n`;
const BASE = lf(ROOT, TITLE, PAPER, L1, E1, R2, R3, END_G, END);
const TWO_LAYERS = lf(ROOT, TITLE, PAPER, L1, E1, R2, END_G, L2, R3, END_G, END);

function applied(outcome: Outcome): Applied {
  if (outcome.outcome !== "applied") throw new Error(`rifiutata: ${outcome.reason} (${outcome.detail})`);
  return outcome;
}

/// Applica `op` e controlla le invarianti di §6 sul risultato.
function apply(engine: SceneEngine, op: Op): Applied {
  const before = engine.normalized;
  const out = applied(engine.apply(op));
  expect(tryApplyOperation(before, out.operation)).toEqual({ kind: "applied", text: normalizeEol(out.text) });
  expect(engine.scene()).toEqual(readScene(out.text).items);
  return out;
}

function rejects(source: string, op: unknown, reason: Reason): void {
  const engine = SceneEngine.open(source);
  const outcome = engine.apply(op as Op);
  expect(outcome, JSON.stringify(op).slice(0, 200)).toMatchObject({ outcome: "rejected", reason });
  expect(engine.text).toBe(source);
  expect(engine.scene()).toEqual(readScene(source).items);
}

describe("parseWireOp", () => {
  it("accetta le forme pubbliche così come sono", () => {
    const op = { op: "batch", ops: [{ op: "remove", target: "o1a2b3c4d" }, { op: "page", viewBox: "0 0 10 10" }] };
    expect(parseWireOp(op)).toEqual({ op });
  });

  it("rifiuta le forme che scrive solo il motore, anche dentro un batch", () => {
    const slot = { parent: "l3f8a0c2d", after: null, skip: 0, lead: "" };
    const engineOnly = [
      { op: "add", slot, gap: "\n    ", raw: "<rect/>" },
      { op: "move", target: "o1a2b3c4d", slot, gap: "\n    " },
      { op: "page", viewBox: "0 0 10 10", previous: { root: {}, paper: null } },
    ];
    for (const op of engineOnly) {
      expect(parseWireOp(op)).toMatchObject({ reason: "invalid-elem" });
      expect(parseWireOp({ op: "batch", ops: [{ op: "batch", ops: [op] }] })).toMatchObject({ reason: "invalid-elem" });
    }
  });

  it("rifiuta ciò che non è un'operazione", () => {
    for (const value of [null, 3, [], {}, { op: "drop" }, { op: "batch" }, { op: "batch", ops: [null] }]) {
      expect(parseWireOp(value)).toMatchObject({ reason: "invalid-elem" });
    }
  });

  it("conta le operazioni dei batch annidati", () => {
    const remove = { op: "remove", target: "o1a2b3c4d" };
    const exactly = { op: "batch", ops: [{ op: "batch", ops: Array(MAX_BATCH - 1).fill(remove) }, remove] };
    expect(parseWireOp(exactly)).toEqual({ op: exactly });
    const over = { op: "batch", ops: [{ op: "batch", ops: Array(MAX_BATCH).fill(remove) }, remove] };
    expect(parseWireOp(over)).toMatchObject({ reason: "limit" });
  });

  it("rifiuta un'operazione oltre 8 MiB di JSON", () => {
    const big = { op: "set", id: "o1a2b3c4d", attrs: { "fub:note": "é".repeat(MAX_OP_BYTES / 2) } };
    expect(parseWireOp(big)).toMatchObject({ reason: "limit" });
  });
});

describe("un documento in sola lettura", () => {
  it("rifiuta ogni operazione e si legge lo stesso", () => {
    const source = lf(ROOT.replace('fub:version="1"', 'fub:version="2"'), TITLE, PAPER, L1, E1, END_G, END);
    const engine = SceneEngine.open(source);
    expect(engine.readOnly).toEqual(["future-version"]);
    expect(engine.status).toBeNull();
    expect(engine.apply({ op: "remove", target: "o1a2b3c4d" })).toMatchObject({ outcome: "rejected", reason: "read-only" });
    expect(engine.apply({ op: "adopt" })).toMatchObject({ outcome: "rejected", reason: "read-only" });
    expect(engine.scene()).toEqual(readScene(source).items);
  });
});

describe("i rifiuti lasciano la scena com'era", () => {
  const LAST = { last: true };
  const add = (parent: string, elem: unknown, pos: unknown = LAST): unknown => ({ op: "add", parent, pos, elem });
  const move = (target: string, parent: string, pos: unknown = LAST): unknown => ({ op: "move", target, parent, pos });
  const set = (id: string, attrs: Record<string, unknown>): unknown => ({ op: "set", id, attrs });
  const rect = (id: string): Elem => ({ ...R4_ELEM, attrs: { ...R4_ELEM.attrs, id } });
  const group = (id: string, ...children: Elem[]): Elem => ({ tag: "g", attrs: { id }, children });
  const WITH_GROUP = lf(ROOT, PAPER, L1, '    <g id="o6f7g8h9i">', "    </g>", END_G, END);
  const WITH_GROUP_AND_L2 = lf(ROOT, PAPER, L1, '    <g id="o6f7g8h9i">', "    </g>", END_G, L2, END_G, END);
  const FOREIGN = lf('<svg xmlns="http://www.w3.org/2000/svg">', '  <rect x="1" y="1" width="2" height="2"/>', END);

  const cases: ReadonlyArray<[string, string, unknown, Reason]> = [
    ["operazione sconosciuta", BASE, { op: "drop" }, "invalid-elem"],
    ["id assente", BASE, { op: "remove", target: "o0z0z0z0z" }, "missing-target"],
    ["la radice non è un bersaglio", BASE, { op: "remove", target: { path: [], tag: "svg" } }, "missing-target"],
    ["un percorso vale solo senza id", BASE, { op: "remove", target: { path: [3, 0], tag: "ellipse" } }, "missing-target"],
    ["un percorso col tag sbagliato", BASE, { op: "ident", path: [3, 0], tag: "rect", id: "o0a1b2c3d" }, "missing-target"],
    ["ident su un elemento che ha già un id", BASE, { op: "ident", path: [3, 0], tag: "ellipse", id: "o0a1b2c3d" }, "missing-target"],
    ["genitore assente", BASE, add("o0z0z0z0z", R4_ELEM), "missing-parent"],
    ["genitore che non contiene", BASE, add("o2b3c4d5e", R4_ELEM), "missing-parent"],
    ["after che non è un figlio", BASE, add("l3f8a0c2d", R4_ELEM, { after: "fub-paper" }), "missing-anchor"],
    ["after è l'elemento spostato", BASE, move("o1a2b3c4d", "l3f8a0c2d", { after: "o1a2b3c4d" }), "missing-anchor"],
    ["posizione assente", BASE, add("l3f8a0c2d", R4_ELEM, {}), "invalid-elem"],
    ["id non valido", BASE, add("l3f8a0c2d", rect("x1")), "invalid-elem"],
    ["id da livello su un oggetto", BASE, add("l3f8a0c2d", rect("l0a1b2c3d")), "invalid-elem"],
    ["oggetto senza id", BASE, add("l3f8a0c2d", { tag: "rect", attrs: { width: "1", height: "1" } }), "invalid-elem"],
    ["tag fuori dal formato", BASE, add("l3f8a0c2d", { tag: "script", attrs: { id: "o0a1b2c3d" } }), "invalid-elem"],
    ["livello dentro un livello", BASE, add("l3f8a0c2d", { tag: "g", attrs: { id: "l0a1b2c3d", "fub:layer": "X" } }), "invalid-elem"],
    ["una seconda carta", BASE, add("l3f8a0c2d", { tag: "rect", attrs: { id: "o0a1b2c3d", "fub:role": "paper" } }), "invalid-elem"],
    ["titolo della radice con add", BASE, add("#root", { tag: "title", attrs: {}, text: "X" }), "invalid-elem"],
    ["id ripetuto nello stesso elemento", BASE, add("l3f8a0c2d", group("o0a1b2c3d", group("o0a1b2c3d"))), "duplicate-id"],
    ["id di un figlio già nel documento", BASE, add("l3f8a0c2d", group("o0a1b2c3d", group("o2b3c4d5e"))), "duplicate-id"],
    ["l'id cambia solo con ident", BASE, set("o2b3c4d5e", { id: "o0a1b2c3d" }), "invalid-elem"],
    ["prefisso non dichiarato", BASE, set("o2b3c4d5e", { "inkscape:label": "X" }), "invalid-elem"],
    ["valore non stringa", BASE, set("o2b3c4d5e", { fill: 3 }), "invalid-elem"],
    ["carattere non XML", BASE, set("o2b3c4d5e", { fill: "\u0001" }), "invalid-elem"],
    ["valore troppo lungo", BASE, set("o2b3c4d5e", { "fub:note": "x".repeat(MAX_VALUE_BYTES + 1) }), "limit"],
    ["text su un rettangolo", BASE, { op: "text", id: "o2b3c4d5e", lines: ["X"] }, "invalid-elem"],
    ["un livello non va in un gruppo", WITH_GROUP_AND_L2, move("l9k8j7h6g", "o6f7g8h9i"), "invalid-elem"],
    ["un gruppo non diventa un livello", WITH_GROUP, set("o6f7g8h9i", { "fub:layer": "X" }), "invalid-elem"],
    ["viewBox con tre numeri", BASE, { op: "page", viewBox: "0 0 10" }, "invalid-elem"],
    ["viewBox con larghezza zero", BASE, { op: "page", viewBox: "0 0 0 10" }, "invalid-elem"],
    ["viewBox che non è un numero", BASE, { op: "page", viewBox: "0 0 a 10" }, "invalid-elem"],
    ["adopt su un documento di FubDraw", BASE, { op: "adopt" }, "invalid-elem"],
    ["adopt annullato su un documento estraneo", FOREIGN, { op: "adopt", undo: true }, "invalid-elem"],
    ["add in un livello bloccato", lf(ROOT, PAPER, L1_LOCKED, E1, END_G, END), add("l3f8a0c2d", R4_ELEM), "locked"],
    ["move fuori da un livello bloccato", TWO_LAYERS.replace(L1, L1_LOCKED), move("o2b3c4d5e", "l9k8j7h6g"), "locked"],
    ["move dentro un livello bloccato", TWO_LAYERS.replace(L2, L2_LOCKED), move("o2b3c4d5e", "l9k8j7h6g"), "locked"],
    ["remove in un livello bloccato", TWO_LAYERS.replace(L2, L2_LOCKED), { op: "remove", target: "o3c4d5e6f" }, "locked"],
    ["remove della carta", BASE, { op: "remove", target: "fub-paper" }, "locked"],
    ["un documento estraneo si modifica dopo «Modifica»", FOREIGN, { op: "remove", target: { path: [0], tag: "rect" } }, "foreign"],
  ];
  for (const [name, source, op, reason] of cases) {
    it(name, () => rejects(source, op, reason));
  }
});

describe("i livelli bloccati", () => {
  it("si sbloccano: il livello stesso si cambia", () => {
    const engine = SceneEngine.open(lf(ROOT, TITLE, PAPER, L1_LOCKED, E1, R2, R3, END_G, END));
    const out = apply(engine, { op: "set", id: "l3f8a0c2d", attrs: { "fub:locked": null } });
    expect(out.text).toBe(BASE);
    expect(out.touched).toEqual(["l3f8a0c2d", "o1a2b3c4d", "o2b3c4d5e", "o3c4d5e6f"]);
  });
});

describe("i limiti", () => {
  /// Gruppi annidati, ciascuno dentro il precedente, a partire da `first`.
  function nested(count: number, first = 0): Elem {
    let elem: Elem = { tag: "g", attrs: { id: `o${String(first + count - 1).padStart(8, "0")}` } };
    for (let i = count - 2; i >= 0; i--) elem = { tag: "g", attrs: { id: `o${String(first + i).padStart(8, "0")}` }, children: [elem] };
    return elem;
  }

  it(`l'annidamento si ferma a ${MAX_NESTING} livelli, il livello compreso`, () => {
    const engine = SceneEngine.open(BASE);
    apply(engine, { op: "add", parent: "l3f8a0c2d", pos: { last: true }, elem: nested(MAX_NESTING - 1) });
    const deepest = `o${String(MAX_NESTING - 2).padStart(8, "0")}`;
    // Un elemento che non contiene si mette anche in fondo.
    apply(engine, { op: "add", parent: deepest, pos: { last: true }, elem: R4_ELEM });
    const text = engine.text;
    const deeper: Op = { op: "add", parent: deepest, pos: { last: true }, elem: { tag: "g", attrs: { id: "o0a1b2c3d" } } };
    expect(engine.apply(deeper)).toMatchObject({
      outcome: "rejected",
      reason: "limit",
      detail: expect.stringContaining("annidamento"),
    });
    expect(engine.text).toBe(text);
  });

  it("un move non porta un gruppo oltre il limite", () => {
    const engine = SceneEngine.open(BASE);
    apply(engine, { op: "add", parent: "l3f8a0c2d", pos: { last: true }, elem: nested(MAX_NESTING - 1) });
    apply(engine, { op: "add", parent: "l3f8a0c2d", pos: { last: true }, elem: nested(2, 100) });
    const text = engine.text;
    const deepest = `o${String(MAX_NESTING - 2).padStart(8, "0")}`;
    expect(engine.apply({ op: "move", target: "o00000100", parent: deepest, pos: { last: true } })).toMatchObject({
      outcome: "rejected",
      reason: "limit",
      detail: expect.stringContaining("annidamento"),
    });
    expect(engine.text).toBe(text);
  });

  it(`il documento non supera ${MAX_ELEMENTS} elementi`, () => {
    const engine = SceneEngine.open(BASE);
    const children: Elem[] = [];
    for (let i = 0; i < MAX_ELEMENTS; i++) {
      children.push({ tag: "rect", attrs: { id: `o${i.toString(36).padStart(8, "0")}`, width: "1", height: "1" } });
    }
    const elem: Elem = { tag: "g", attrs: { id: "o0a1b2c3d" }, children };
    const outcome = engine.apply({ op: "add", parent: "l3f8a0c2d", pos: { last: true }, elem });
    expect(outcome).toMatchObject({ outcome: "rejected", reason: "limit", detail: expect.stringContaining("elementi") });
    expect(engine.text).toBe(BASE);
  });

  it(`il documento non supera ${MAX_EDIT_BYTES} byte`, () => {
    const engine = SceneEngine.open(BASE);
    const href = `data:image/png;base64,${"A".repeat(7 * 1024 * 1024 - 100)}`;
    const image = (id: string): Op => ({
      op: "add",
      parent: "l3f8a0c2d",
      pos: { last: true },
      elem: { tag: "image", attrs: { id, x: "0", y: "0", width: "10", height: "10", href } },
    });
    // Due immagini stanno nel limite, la terza no.
    const two = applied(engine.apply({ op: "batch", ops: [image("o0a1b2c3d"), image("o1b2c3d4e")] }));
    const outcome = engine.apply(image("o2c3d4e5f"));
    expect(outcome).toMatchObject({ outcome: "rejected", reason: "limit", detail: expect.stringContaining("byte") });
    expect(engine.text).toBe(two.text);
    expect(applied(engine.undo(two.undo)).text).toBe(BASE);
  });

  it(`un batch non supera ${MAX_BATCH} operazioni`, () => {
    const set: Op = { op: "set", id: "o2b3c4d5e", attrs: { fill: "#000000" } };
    rejects(BASE, { op: "batch", ops: [{ op: "batch", ops: Array(MAX_BATCH).fill(set) }, set] }, "limit");
  });
});

describe("l'undo", () => {
  const R3_GREY = '    <rect id="o3c4d5e6f" x="800" y="100" width="200" height="120" fill="#111111"/>';

  it("dopo un'altra operazione passa dall'inversa", () => {
    const engine = SceneEngine.open(BASE);
    const first = apply(engine, { op: "set", id: "o1a2b3c4d", attrs: { fill: "#000000" } });
    const second = apply(engine, { op: "set", id: "o3c4d5e6f", attrs: { fill: "#111111" } });
    expect(applied(engine.undo(first.undo)).text).toBe(lf(ROOT, TITLE, PAPER, L1, E1, R2, R3_GREY, END_G, END));
    expect(applied(engine.undo(second.undo)).text).toBe(BASE);
  });

  it("si rifiuta se il bersaglio non c'è più", () => {
    const engine = SceneEngine.open(BASE);
    const added = apply(engine, { op: "add", parent: "l3f8a0c2d", pos: { last: true }, elem: R4_ELEM });
    apply(engine, { op: "remove", target: "o4d5e6f7g" });
    expect(engine.undo(added.undo)).toMatchObject({ outcome: "rejected", reason: "missing-target" });
  });

  it("si rifiuta se il punto da cui un elemento è partito non c'è più", () => {
    const engine = SceneEngine.open(BASE);
    const removed = apply(engine, { op: "remove", target: "o2b3c4d5e" });
    apply(engine, { op: "remove", target: "o1a2b3c4d" });
    expect(engine.undo(removed.undo)).toMatchObject({ outcome: "rejected", reason: "missing-anchor" });
  });

  it("resta esatto dopo un rifiuto, che non cambia la scena", () => {
    const engine = SceneEngine.open(BASE);
    const out = apply(engine, { op: "remove", target: "o2b3c4d5e" });
    expect(engine.apply({ op: "remove", target: "o0z0z0z0z" }).outcome).toBe("rejected");
    const undone = applied(engine.undo(out.undo));
    expect(undone.text).toBe(BASE);
    // L'undo esatto rimette lo stesso nodo: un nuovo undo è di nuovo esatto.
    expect(applied(engine.undo(undone.undo)).text).toBe(out.text);
  });

  it("di un altro motore passa dall'inversa", () => {
    const one = SceneEngine.open(BASE);
    const out = apply(one, { op: "remove", target: "o2b3c4d5e" });
    const other = SceneEngine.open(out.text);
    expect(applied(other.undo(out.undo)).text).toBe(BASE);
  });

  it("annulla un batch rifiutato senza lasciare traccia", () => {
    const engine = SceneEngine.open(BASE);
    const outcome = engine.apply({
      op: "batch",
      ops: [
        { op: "add", parent: "l3f8a0c2d", pos: { last: true }, elem: R4_ELEM },
        { op: "move", target: "o4d5e6f7g", parent: "l3f8a0c2d", pos: { first: true } },
        { op: "set", id: "o4d5e6f7g", attrs: { fill: "#000000" } },
        { op: "remove", target: "o0z0z0z0z" },
      ],
    });
    expect(outcome).toMatchObject({ outcome: "rejected", reason: "missing-target", index: 3 });
    expect(engine.text).toBe(BASE);
    // L'id del rettangolo tolto col rifiuto è di nuovo libero.
    expect(apply(engine, { op: "add", parent: "l3f8a0c2d", pos: { last: true }, elem: R4_ELEM }).text).toBe(
      lf(ROOT, TITLE, PAPER, L1, E1, R2, R3, R4, END_G, END),
    );
  });

  it("riporta l'indice esterno di un batch annidato", () => {
    const nested: Op = {
      op: "batch",
      ops: [{ op: "set", id: "o1a2b3c4d", attrs: { fill: "#000000" } }, { op: "batch", ops: [{ op: "remove", target: "o0z0z0z0z" }] }],
    };
    rejects(BASE, nested, "missing-target");
    expect(SceneEngine.open(BASE).apply(nested)).toMatchObject({ index: 1 });
  });
});

describe("la fusione di due undo", () => {
  const E1_BLACK = '    <ellipse id="o1a2b3c4d" cx="300" cy="200" rx="120" ry="60" fill="#000000" stroke="#0072b2" stroke-width="4"/>';
  const R3_GREY = '    <rect id="o3c4d5e6f" x="800" y="100" width="200" height="120" fill="#111111"/>';
  const fill = (id: string, value: string): Op => ({ op: "set", id, attrs: { fill: value } });

  it("due set sulle stesse chiavi diventano un passo solo, esatto", () => {
    const engine = SceneEngine.open(BASE);
    const first = apply(engine, fill("o1a2b3c4d", "#111111"));
    const second = apply(engine, fill("o1a2b3c4d", "#000000"));
    const merged = mergeUndo(first.undo, second.undo)!;
    expect(merged.inverse).toEqual(first.undo.inverse);
    expect(merged.forward).toEqual(second.undo.forward);
    const undone = applied(engine.undo(merged));
    expect(undone.text).toBe(BASE);
    expect(applied(engine.undo(undone.undo)).text).toBe(lf(ROOT, TITLE, PAPER, L1, E1_BLACK, R2, R3, END_G, END));
  });

  it("vale per due batch con gli stessi set nello stesso ordine", () => {
    const engine = SceneEngine.open(BASE);
    const both = (value: string): Op => ({ op: "batch", ops: [fill("o1a2b3c4d", value), fill("o3c4d5e6f", value)] });
    const first = apply(engine, both("#222222"));
    const second = apply(engine, both("#111111"));
    const merged = mergeUndo(first.undo, second.undo)!;
    expect(applied(engine.undo(merged)).text).toBe(BASE);
  });

  it("dopo un cambiamento altrui passa dall'inversa della prima", () => {
    const engine = SceneEngine.open(BASE);
    const first = apply(engine, fill("o1a2b3c4d", "#222222"));
    const second = apply(engine, fill("o1a2b3c4d", "#000000"));
    const merged = mergeUndo(first.undo, second.undo)!;
    apply(engine, fill("o3c4d5e6f", "#111111"));
    expect(applied(engine.undo(merged)).text).toBe(lf(ROOT, TITLE, PAPER, L1, E1, R2, R3_GREY, END_G, END));
  });

  it("non fonde chiavi o elementi diversi", () => {
    const engine = SceneEngine.open(BASE);
    const first = apply(engine, fill("o1a2b3c4d", "#222222"));
    const stroke = apply(engine, { op: "set", id: "o1a2b3c4d", attrs: { stroke: "#000000" } });
    expect(mergeUndo(first.undo, stroke.undo)).toBeNull();
    const other = apply(engine, fill("o3c4d5e6f", "#111111"));
    expect(mergeUndo(stroke.undo, other.undo)).toBeNull();
    const both = apply(engine, { op: "set", id: "o3c4d5e6f", attrs: { fill: "#000000", stroke: "#000000" } });
    expect(mergeUndo(other.undo, both.undo)).toBeNull();
  });

  it("non fonde operazioni che non sono una subito dopo l'altra", () => {
    const engine = SceneEngine.open(BASE);
    const first = apply(engine, fill("o1a2b3c4d", "#222222"));
    apply(engine, fill("o3c4d5e6f", "#111111"));
    const second = apply(engine, fill("o1a2b3c4d", "#000000"));
    expect(mergeUndo(first.undo, second.undo)).toBeNull();
    // Né operazioni di due motori diversi.
    const other = SceneEngine.open(BASE);
    expect(mergeUndo(apply(other, fill("o1a2b3c4d", "#222222")).undo, second.undo)).toBeNull();
  });
});

describe("i rientri di un move", () => {
  const GROUP = '    <g id="o6f7g8h9i">';
  const TEXT = [
    '      <text id="o9i0j1k2l" x="720" y="460" font-size="32">',
    '        <tspan x="720" dy="0">Uno</tspan>',
    '        <tspan x="720" dy="40">Due</tspan>',
    "      </text>",
  ];

  it("un testo che esce da un gruppo perde un rientro", () => {
    const engine = SceneEngine.open(lf(ROOT, PAPER, L1, GROUP, ...TEXT, "    </g>", END_G, END));
    const out = apply(engine, { op: "move", target: "o9i0j1k2l", parent: "l3f8a0c2d", pos: { last: true } });
    expect(out.text).toBe(lf(ROOT, PAPER, L1, GROUP, "    </g>", ...TEXT.map((line) => line.slice(2)), END_G, END));
  });

  it("un rientro irregolare resta com'è scritto", () => {
    const odd = [TEXT[0]!, '  <tspan x="720" dy="0">Uno</tspan>', TEXT[3]!];
    const engine = SceneEngine.open(lf(ROOT, PAPER, L1, GROUP, ...odd, "    </g>", END_G, END));
    const out = apply(engine, { op: "move", target: "o9i0j1k2l", parent: "l3f8a0c2d", pos: { last: true } });
    expect(out.text).toBe(lf(ROOT, PAPER, L1, GROUP, "    </g>", `    ${odd[0]!.trimStart()}`, ...odd.slice(1), END_G, END));
  });

  it("il testo di un tspan non si tocca", () => {
    const spaced = [TEXT[0]!, '        <tspan x="720" dy="0">a\n        b</tspan>', TEXT[3]!];
    const engine = SceneEngine.open(lf(ROOT, PAPER, L1, GROUP, ...spaced, "    </g>", END_G, END));
    const out = apply(engine, { op: "move", target: "o9i0j1k2l", parent: "l3f8a0c2d", pos: { last: true } });
    const moved = [TEXT[0]!.slice(2), '      <tspan x="720" dy="0">a\n        b</tspan>', TEXT[3]!.slice(2)];
    expect(out.text).toBe(lf(ROOT, PAPER, L1, GROUP, "    </g>", ...moved, END_G, END));
  });
});

describe("adopt", () => {
  const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">';
  const RECT = '  <rect x="1" y="1" width="2" height="2"/>';

  it("usa il primo prefisso libero se fub è già preso", () => {
    const source = lf('<svg xmlns="http://www.w3.org/2000/svg" xmlns:fub="urn:altro" viewBox="0 0 10 10">', RECT, END);
    const engine = SceneEngine.open(source);
    const out = apply(engine, { op: "adopt" });
    const root = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:fub="urn:altro" xmlns:fub1="${FUB_NS}" fub1:version="1" viewBox="0 0 10 10">`;
    expect(out.text).toBe(lf(root, RECT, END));
    expect(readScene(out.text).status).toBe("fubdraw");
    expect(applied(SceneEngine.open(out.text).apply(out.inverse)).text).toBe(source);
  });

  it("annullato, tiene la dichiarazione se un livello la usa", () => {
    const engine = SceneEngine.open(lf(SVG, RECT, END));
    apply(engine, { op: "adopt" });
    const layer: Elem = { tag: "g", attrs: { id: "l1a2b3c4d", "fub:layer": "Nuovo" } };
    apply(engine, { op: "add", parent: "#root", pos: { last: true }, elem: layer });
    const out = apply(engine, { op: "adopt", undo: true });
    const root = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:fub="${FUB_NS}" viewBox="0 0 10 10">`;
    expect(out.text).toBe(lf(root, RECT, '  <g id="l1a2b3c4d" fub:layer="Nuovo">', "  </g>", END));
    expect(engine.status).toBe("foreign");
    expect(engine.apply({ op: "set", id: "l1a2b3c4d", attrs: { "fub:layer": "X" } })).toMatchObject({ reason: "foreign" });
  });

  it("su una radice senza dichiarazioni va subito dopo il nome", () => {
    const source = lf("<svg viewBox='0 0 10 10'>", END);
    // Senza namespace SVG non è una scena: niente da adottare.
    expect(() => SceneEngine.open(source)).toThrow();
  });
});

describe("page", () => {
  it("su una radice senza width e height li aggiunge, e l'inversa li toglie", () => {
    const root = `<svg ${NS} fub:version="1" viewBox="0 0 1600 1000">`;
    const source = lf(root, PAPER, L1, END_G, END);
    const engine = SceneEngine.open(source);
    const out = apply(engine, { op: "page", viewBox: "-10 -20 800 600" });
    expect(out.text).toBe(
      lf(
        `<svg ${NS} fub:version="1" viewBox="-10 -20 800 600" width="800" height="600">`,
        '  <rect id="fub-paper" fub:role="paper" x="-10" y="-20" width="800" height="600" fill="#ffffff"/>',
        L1,
        END_G,
        END,
      ),
    );
    expect(applied(SceneEngine.open(out.text).apply(out.inverse)).text).toBe(source);
  });

  it("senza carta cambia solo la radice", () => {
    const engine = SceneEngine.open(lf(ROOT, L1, END_G, END));
    const out = apply(engine, { op: "page", viewBox: "0 0 800 600" });
    expect(out.text).toBe(lf(`<svg ${NS} fub:version="1" viewBox="0 0 800 600" width="800" height="600">`, L1, END_G, END));
    expect(out.inverse).toEqual({
      op: "page",
      viewBox: "0 0 1600 1000",
      previous: { root: { viewBox: "0 0 1600 1000", width: "1600", height: "1000" }, paper: null },
    });
  });
});

describe("set sulla radice", () => {
  const guides = (value: string | null): Op => ({ op: "set", id: "#root", attrs: { "fub:guides": value } });

  it("due spostamenti di una guida diventano un passo solo, esatto, e non toccano id", () => {
    const engine = SceneEngine.open(BASE);
    const first = apply(engine, guides("x 100"));
    const second = apply(engine, guides("x 110"));
    expect(first.touched).toEqual([]);
    expect(second.text).toBe(BASE.replace('height="1000">', 'height="1000" fub:guides="x 110">'));
    const merged = mergeUndo(first.undo, second.undo)!;
    expect(applied(engine.undo(merged)).text).toBe(BASE);
  });

  it("rifiuta dichiarazioni, altri attributi e valori fuori grammatica", () => {
    for (const attrs of [
      { "xmlns:fub": FUB_NS },
      { "fub:version": "2" },
      { "fub:layer": "A" },
      { width: "10" },
      { "fub:units": "pc" },
      { "fub:units": 3 },
      { "fub:guides": "x 1\u0001" },
      { "fub:guides": "x 1", "altro:guides": "x 2" },
    ]) {
      rejects(BASE, { op: "set", id: "#root", attrs }, "invalid-elem");
    }
  });

  it("su un documento estraneo aspetta «Modifica»", () => {
    rejects(lf(`<svg ${NS} viewBox="0 0 10 10">`, END), guides("x 1"), "foreign");
  });

  it("le guide che non si leggono restano com'erano, finché non si riscrivono", () => {
    const source = BASE.replace('height="1000">', 'height="1000" fub:guides="x 1;">');
    const engine = SceneEngine.open(source);
    const out = apply(engine, { op: "set", id: "#root", attrs: { "fub:units": "mm" } });
    expect(out.text).toBe(BASE.replace('height="1000">', 'height="1000" fub:units="mm" fub:guides="x 1;">'));
    expect(apply(engine, guides("y 2")).inverse).toEqual(guides("x 1;"));
  });
});

describe("meta", () => {
  it("mette la descrizione dopo il titolo, e null li toglie", () => {
    const engine = SceneEngine.open(BASE);
    const out = apply(engine, { op: "meta", desc: "Una prova" });
    expect(out.text).toBe(lf(ROOT, TITLE, "  <desc>Una prova</desc>", PAPER, L1, E1, R2, R3, END_G, END));
    expect(out.inverse).toEqual({ op: "meta", desc: null });
    const both = apply(engine, { op: "meta", title: null, desc: null });
    expect(both.text).toBe(lf(ROOT, PAPER, L1, E1, R2, R3, END_G, END));
    expect(applied(engine.apply(both.inverse)).text).toBe(out.text);
  });

  it("un titolo vuoto resta un titolo, autochiuso come ogni elemento senza testo", () => {
    const engine = SceneEngine.open(BASE);
    expect(apply(engine, { op: "meta", title: "" }).text).toBe(lf(ROOT, "  <title/>", PAPER, L1, E1, R2, R3, END_G, END));
  });
});

describe("ident", () => {
  const BARE = '    <rect x="10" y="10" width="50" height="50"/>';

  it("toglie l'id, e l'inversa lo rimette", () => {
    const source = lf(ROOT, PAPER, L1, '    <rect id="o0a1b2c3d" x="10" y="10" width="50" height="50"/>', END_G, END);
    const engine = SceneEngine.open(source);
    const out = apply(engine, { op: "ident", path: [1, 0], tag: "rect", id: null });
    expect(out.text).toBe(lf(ROOT, PAPER, L1, BARE, END_G, END));
    expect(out.inverse).toEqual({ op: "ident", path: [1, 0], tag: "rect", id: "o0a1b2c3d" });
    expect(applied(engine.apply(out.inverse)).text).toBe(source);
  });

  it("non riusa un id del documento", () => {
    rejects(lf(ROOT, PAPER, L1, BARE, R2, END_G, END), { op: "ident", path: [1, 0], tag: "rect", id: "o2b3c4d5e" }, "duplicate-id");
  });

  it("cambia un id togliendolo e dandone un altro, e l'undo rimette quello di prima com'era", () => {
    const source = lf(ROOT, PAPER, L1, "    <rect id='path1234' x=\"10\" y=\"10\" width=\"50\" height=\"50\"/>", END_G, END);
    const engine = SceneEngine.open(source);
    const rename: Op = {
      op: "batch",
      ops: [
        { op: "ident", path: [1, 0], tag: "rect", id: null },
        { op: "ident", path: [1, 0], tag: "rect", id: "Sole_1" },
      ],
    };
    const out = apply(engine, rename);
    expect(out.text).toBe(lf(ROOT, PAPER, L1, '    <rect id="Sole_1" x="10" y="10" width="50" height="50"/>', END_G, END));
    expect([...out.touched].sort()).toEqual(["Sole_1", "path1234"]);
    expect(applied(engine.apply(out.inverse)).text, "l'undo").toBe(lf(ROOT, PAPER, L1, BARE.replace("<rect", '<rect id="path1234"'), END_G, END));
  });

  it("dà ogni id che il formato ammette, e rifiuta quello vuoto, non XML o troppo lungo", () => {
    const source = lf(ROOT, PAPER, L1, BARE, END_G, END);
    const engine = SceneEngine.open(source);
    expect(apply(engine, { op: "ident", path: [1, 0], tag: "rect", id: "un sole & più" }).text).toContain('<rect id="un sole &amp; più"');
    rejects(source, { op: "ident", path: [1, 0], tag: "rect", id: "" }, "invalid-elem");
    rejects(source, { op: "ident", path: [1, 0], tag: "rect", id: "a\u0001" }, "invalid-elem");
    rejects(source, { op: "ident", path: [1, 0], tag: "rect", id: "a".repeat(MAX_VALUE_BYTES + 1) }, "limit");
  });

  it("scrive l'id nel tag così com'è, senza riordinare il resto", () => {
    const engine = SceneEngine.open(lf(ROOT, PAPER, L1, "    <rect height='50'   width='50'/>", END_G, END));
    const out = apply(engine, { op: "ident", path: [1, 0], tag: "rect", id: "o0a1b2c3d" });
    expect(out.text).toBe(lf(ROOT, PAPER, L1, "    <rect id=\"o0a1b2c3d\" height='50'   width='50'/>", END_G, END));
  });
});

describe("i tratti", () => {
  const STROKE = `    <path id="o7k2m9x4q" fub:tool="pen" fub:brush="${BRUSH}" d="M0 0 Z" fill="#000000" fub:ink="${INK}"/>`;

  it("un set del pennello ridisegna il contorno", () => {
    const engine = SceneEngine.open(lf(ROOT, PAPER, L1, STROKE, END_G, END));
    const brush = BRUSH.replace("size=4", "size=8");
    const out = apply(engine, { op: "set", id: "o7k2m9x4q", attrs: { "fub:brush": brush } });
    const d = pf1(inkToQuantized(decodeInk(INK)), parseBrush(brush));
    const redrawn = `    <path id="o7k2m9x4q" fub:tool="pen" fub:brush="${brush}" d="${d}" fill="#000000" fub:ink="${INK}"/>`;
    expect(out.text).toBe(lf(ROOT, PAPER, L1, redrawn, END_G, END));
    // L'inversa rimette il pennello e il `d` di prima, scritto a mano.
    expect(out.inverse).toEqual({ op: "set", id: "o7k2m9x4q", attrs: { "fub:brush": BRUSH, d: "M0 0 Z" } });
  });

  it("un d scritto a mano su un tratto si ricalcola", () => {
    const engine = SceneEngine.open(lf(ROOT, PAPER, L1, STROKE, END_G, END));
    const out = apply(engine, { op: "set", id: "o7k2m9x4q", attrs: { d: "M1 1 Z" } });
    expect(out.text).toContain(` d="${pf1(inkToQuantized(decodeInk(INK)), parseBrush(BRUSH))}"`);
  });

  it("un inchiostro non conforme si rifiuta", () => {
    const broken: Op = { op: "set", id: "o7k2m9x4q", attrs: { "fub:ink": "1 s100 cxypt 1,2" } };
    rejects(lf(ROOT, PAPER, L1, STROKE, END_G, END), broken, "invalid-elem");
  });
});

describe("i terminatori", () => {
  it("le righe nuove usano il terminatore prevalente, anche \\r", () => {
    const source = [ROOT, TITLE, PAPER, L1, E1, END_G, END, ""].join("\r");
    const engine = SceneEngine.open(source);
    const out = apply(engine, { op: "add", parent: "l3f8a0c2d", pos: { last: true }, elem: R4_ELEM });
    expect(out.text).toBe([ROOT, TITLE, PAPER, L1, E1, R4, END_G, END, ""].join("\r"));
  });

  it("un set su un gruppo autochiuso in un file CRLF apre il gruppo con CRLF", () => {
    const source = [ROOT, PAPER, L1, '    <g id="o6f7g8h9i"/>', END_G, END, ""].join("\r\n");
    const engine = SceneEngine.open(source);
    const out = apply(engine, { op: "set", id: "o6f7g8h9i", attrs: { opacity: "0.5" } });
    expect(out.text).toBe([ROOT, PAPER, L1, '    <g id="o6f7g8h9i" opacity="0.5">', "    </g>", END_G, END, ""].join("\r\n"));
  });
});
