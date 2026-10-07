// Il motore delle operazioni oltre i vettori di `vectors.test.ts`: la forma
// della rete, i rifiuti uno per uno, i limiti, l'undo che non è esatto, i
// rientri di un `move`, `adopt` e `page` nei casi di bordo, i riferimenti
// alle risorse e la loro raccolta, il testo in area e su tracciato. I testi
// attesi sono scritti a mano, e i `§` sono le sezioni di
// `docs/reference/scene-operations.md`.

import { describe, expect, it } from "vitest";
import { tryApplyOperation } from "../../core/text-operation";
import { parseBrush } from "../ink/brush";
import { decodeInk, inkToQuantized } from "../ink/codec";
import { pf1 } from "../ink/pf1";
import { mergeUndo, SceneEngine, type Applied, type Outcome } from "./engine";
import { MAX_BATCH, MAX_NESTING, MAX_OP_BYTES, MAX_VALUE_BYTES, parseWireOp, type Op, type Reason } from "./ops";
import { MAX_EDIT_BYTES, MAX_ELEMENTS, MAX_RESOURCES, readScene } from "./read";
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

  it("accetta un add con raw, e rifiuta raw sulle altre operazioni", () => {
    const op = { op: "batch", ops: [{ op: "add", parent: "l3f8a0c2d", pos: { last: true }, raw: '<rect style="fill:red"/>' }] };
    expect(parseWireOp(op)).toEqual({ op });
    expect(parseWireOp({ op: "remove", target: "o1a2b3c4d", raw: "<rect/>" })).toMatchObject({ reason: "invalid-elem" });
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
  const WITH_TEXT = lf(ROOT, PAPER, L1, '    <text id="o5e6f7g8h" x="10" y="20">', '      <tspan x="10" dy="0">a</tspan>', "    </text>", END_G, END);

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
    ["un a capo in un pezzo", WITH_TEXT, { op: "text", id: "o5e6f7g8h", lines: [["a", { text: "b\nc", attrs: { fill: "#000000" } }]] }, "invalid-elem"],
    ["un pezzo senza attributi", WITH_TEXT, { op: "text", id: "o5e6f7g8h", lines: [[{ text: "b" }]] }, "invalid-elem"],
    ["un valore di un pezzo che non è una stringa", WITH_TEXT, { op: "text", id: "o5e6f7g8h", lines: [[{ text: "b", attrs: { "font-size": 3 } }]] }, "invalid-elem"],
    ["una parte di riga che non è testo né pezzo", WITH_TEXT, { op: "text", id: "o5e6f7g8h", lines: [[3]] }, "invalid-elem"],
    ["un pezzo con un valore fuori dal formato", WITH_TEXT, { op: "text", id: "o5e6f7g8h", lines: [[{ text: "b", attrs: { "font-style": "slanted" } }]] }, "invalid-elem"],
    ["un pezzo con un attributo della riga", WITH_TEXT, { op: "text", id: "o5e6f7g8h", lines: [[{ text: "b", attrs: { dy: "4" } }]] }, "invalid-elem"],
    ["pezzi e testo nella stessa riga di un add", BASE, add("l3f8a0c2d", { tag: "text", attrs: { id: "o0a1b2c3d" }, children: [{ tag: "tspan", attrs: {}, text: "a", runs: ["b"] }] }), "invalid-elem"],
    ["pezzi fuori da una riga", BASE, add("l3f8a0c2d", { tag: "text", attrs: { id: "o0a1b2c3d" }, runs: ["b"] } as Elem), "invalid-elem"],
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

describe("i gruppi e le forme bloccati", () => {
  const LOCKED_GROUP = '    <g id="o6f7g8h9i" fub:locked="true">';
  const INNER = '      <rect id="o4d5e6f7g" x="10" y="20" width="30" height="40"/>';
  const IN_GROUP = lf(ROOT, PAPER, L1, LOCKED_GROUP, INNER, "    </g>", R2, END_G, END);
  const move = (id: string, parent: string): Op => ({ op: "move", target: id, parent, pos: { last: true } });

  const cases: [string, Op][] = [
    ["un figlio non si cambia", { op: "set", id: "o4d5e6f7g", attrs: { fill: "#000000" } }],
    ["un figlio non esce", move("o4d5e6f7g", "l3f8a0c2d")],
    ["un altro oggetto non entra", move("o2b3c4d5e", "o6f7g8h9i")],
    ["un figlio non si toglie", { op: "remove", target: "o4d5e6f7g" }],
  ];
  for (const [name, op] of cases) {
    it(name, () => rejects(IN_GROUP, op, "locked"));
  }

  it("un gruppo dentro un gruppo bloccato è fermo anche lui, coi suoi figli", () => {
    const deep = lf(ROOT, PAPER, L1, LOCKED_GROUP, '      <g id="o7g8h9i0j">', '        <rect id="o4d5e6f7g" x="10" y="20" width="30" height="40"/>', "      </g>", "    </g>", END_G, END);
    rejects(deep, { op: "set", id: "o7g8h9i0j", attrs: { opacity: "0.5" } }, "locked");
    rejects(deep, { op: "set", id: "o4d5e6f7g", attrs: { opacity: "0.5" } }, "locked");
  });

  it("il gruppo stesso si sposta, si toglie e si sblocca", () => {
    const engine = SceneEngine.open(IN_GROUP);
    apply(engine, { op: "set", id: "o6f7g8h9i", attrs: { transform: "translate(5 5)" } });
    apply(engine, { op: "move", target: "o6f7g8h9i", parent: "l3f8a0c2d", pos: { last: true } });
    const out = apply(engine, { op: "set", id: "o6f7g8h9i", attrs: { "fub:locked": null } });
    expect(out.touched).toEqual(["o6f7g8h9i", "o4d5e6f7g"]);
    apply(engine, { op: "set", id: "o4d5e6f7g", attrs: { fill: "#000000" } });
    apply(SceneEngine.open(IN_GROUP), { op: "remove", target: "o6f7g8h9i" });
  });

  it("una forma bloccata si cambia ancora, e la scena lo dice", () => {
    const engine = SceneEngine.open(lf(ROOT, PAPER, L1, '    <rect id="o2b3c4d5e" x="500" y="100" width="200" height="120" fill="#e69f00" fub:locked="true" display="none"/>', END_G, END));
    const item = engine.scene().find((entry) => entry.kind === "element" && entry.id === "o2b3c4d5e");
    expect(item).toMatchObject({ locked: true, hidden: true });
    apply(engine, { op: "set", id: "o2b3c4d5e", attrs: { "fub:locked": null, display: null } });
    const after = engine.scene().find((entry) => entry.kind === "element" && entry.id === "o2b3c4d5e");
    expect(after).not.toHaveProperty("locked");
    expect(after).not.toHaveProperty("hidden");
  });

  it("un valore diverso da true non blocca", () => {
    const engine = SceneEngine.open(lf(ROOT, PAPER, L1, '    <g id="o6f7g8h9i" fub:locked="yes">', INNER, "    </g>", END_G, END));
    apply(engine, { op: "set", id: "o4d5e6f7g", attrs: { fill: "#000000" } });
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

  it("annulla una fila di undo con un cambiamento solo, gli stessi byte di uno per volta", () => {
    const engine = SceneEngine.open(BASE);
    const steps = [
      apply(engine, { op: "set", id: "o1a2b3c4d", attrs: { fill: "#000000" } }),
      apply(engine, { op: "remove", target: "o2b3c4d5e" }),
      apply(engine, { op: "add", parent: "l3f8a0c2d", pos: { first: true }, elem: R4_ELEM }),
    ];
    const end = engine.normalized;
    const back = engine.undoAll(steps.map((step) => step.undo).reverse());
    expect(back.rejected).toBeNull();
    expect(back.text).toBe(BASE);
    expect(tryApplyOperation(end, back.operation)).toEqual({ kind: "applied", text: BASE });
    expect(back.touched).toEqual(["o4d5e6f7g", "o2b3c4d5e", "o1a2b3c4d"]);
    expect(engine.scene()).toEqual(readScene(BASE).items);
    // Gli undo della fila la ripetono, ed esatti: i byte tornano quelli di
    // prima, e un passo per volta va come la fila.
    const again = engine.undoAll(back.undos.slice().reverse());
    expect(again.text).toBe(end);
    expect(applied(engine.undo(again.undos[2]!)).text).toBe(steps[1]!.text);
  });

  it("ferma la fila al primo undo rifiutato e tiene quelli prima", () => {
    const engine = SceneEngine.open(BASE);
    const added = apply(engine, { op: "add", parent: "l3f8a0c2d", pos: { last: true }, elem: R4_ELEM });
    const black = apply(engine, { op: "set", id: "o1a2b3c4d", attrs: { fill: "#000000" } });
    const grey = apply(engine, { op: "set", id: "o3c4d5e6f", attrs: { fill: "#111111" } });
    // Da fuori il rettangolo aggiunto se ne va: il suo undo non vale più.
    apply(engine, { op: "remove", target: "o4d5e6f7g" });
    const before = engine.normalized;
    const run = engine.undoAll([grey.undo, black.undo, added.undo]);
    expect(run.undos).toHaveLength(2);
    expect(run.rejected).toMatchObject({ outcome: "rejected", reason: "missing-target" });
    expect(run.text).toBe(BASE);
    expect(tryApplyOperation(before, run.operation)).toEqual({ kind: "applied", text: BASE });
    expect(engine.undoAll([])).toMatchObject({ undos: [], rejected: null, text: BASE, operation: { edits: [] } });
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

describe("add con raw", () => {
  const RAW = '<g style="fill:#e69f00">\n      <!-- un commento -->\n      <rect width="10" height="10"/>\n    </g>';

  it("scrive l'elemento estraneo così com'è, e l'inversa lo toglie col percorso", () => {
    const engine = SceneEngine.open(BASE);
    const out = apply(engine, { op: "add", parent: "l3f8a0c2d", pos: { after: "o1a2b3c4d" }, raw: RAW });
    expect(out.text).toBe(lf(ROOT, TITLE, PAPER, L1, E1, `    ${RAW}`, R2, R3, END_G, END));
    expect(out.inverse).toEqual({ op: "remove", target: { path: [2, 1], tag: "g" } });
    expect(engine.scene().some((item) => item.kind === "foreign")).toBe(true);
    apply(engine, out.inverse);
    expect(engine.text).toBe(BASE);
  });

  it("con un id lo toglie per id, e un add ripetuto è un doppione", () => {
    const engine = SceneEngine.open(BASE);
    const raw = '<use id="u1" href="#o1a2b3c4d" x="10"/>';
    const out = apply(engine, { op: "add", parent: "l3f8a0c2d", pos: { last: true }, raw });
    expect(out.inverse).toEqual({ op: "remove", target: "u1" });
    expect(out.touched).toContain("u1");
    const again = applied(engine.apply({ op: "add", parent: "l3f8a0c2d", pos: { last: true }, raw }));
    expect(again.duplicate).toBe(true);
    expect(again.text).toBe(out.text);
  });

  it("i ritorni a capo diventano quelli del documento", () => {
    const source = [ROOT, TITLE, PAPER, L1, E1, END_G, END, ""].join("\r\n");
    const engine = SceneEngine.open(source);
    const out = apply(engine, { op: "add", parent: "l3f8a0c2d", pos: { last: true }, raw: '<g style="x">\n<rect/>\r</g>' });
    expect(out.text).toBe([ROOT, TITLE, PAPER, L1, E1, '    <g style="x">', "<rect/>", "</g>", END_G, END, ""].join("\r\n"));
  });

  it("uno script entra inerte, con S005", () => {
    const engine = SceneEngine.open(BASE);
    const out = apply(engine, { op: "add", parent: "#root", pos: { last: true }, raw: "<script>alert(1)</script>" });
    expect(readScene(out.text).diagnostics.map((d) => d.code)).toContain("S005");
  });

  it("una sequenza entra con gli spazi fra gli elementi, e l'inversa la toglie dall'ultimo al primo", () => {
    const engine = SceneEngine.open(BASE);
    const raw = `${R4.trim()}\n    <g style="x"><!-- nota --><rect/></g>`;
    const out = apply(engine, { op: "add", parent: "l3f8a0c2d", pos: { last: true }, raw });
    expect(out.text).toBe(lf(ROOT, TITLE, PAPER, L1, E1, R2, R3, R4, '    <g style="x"><!-- nota --><rect/></g>', END_G, END));
    expect(out.inverse).toEqual({ op: "batch", ops: [{ op: "remove", target: { path: [2, 4], tag: "g" } }, { op: "remove", target: "o4d5e6f7g" }] });
    expect(engine.scene().some((item) => item.kind === "element" && item.id === "o4d5e6f7g")).toBe(true);
    apply(engine, out.inverse);
    expect(engine.text).toBe(BASE);
  });

  it("in un genitore vuoto la sequenza va su righe sue", () => {
    const engine = SceneEngine.open(lf(ROOT, TITLE, PAPER, '  <g id="l3f8a0c2d" fub:layer="Livello 1"/>', END));
    const out = apply(engine, { op: "add", parent: "l3f8a0c2d", pos: { last: true }, raw: `${R4.trim()}\n    <rect style="x"/>` });
    expect(out.text).toBe(lf(ROOT, TITLE, PAPER, L1, R4, '    <rect style="x"/>', END_G, END));
  });

  it("un elemento del formato tiene i suoi byte, e il contorno dei tratti si ricalcola", () => {
    const engine = SceneEngine.open(BASE);
    const d = pf1(inkToQuantized(decodeInk(INK)), parseBrush(BRUSH));
    const group = '<g id="o5e6f7g8h"  opacity=\'0.5\'>\n      <!-- c -->\n      <foo xmlns="urn:x"/>\n      <rect id="o6f7g8h9i" x="1" y="1" width="2" height="2"/>\n    </g>';
    const stale = `<path id="o7k2m9x4q" fub:tool="pen" fub:brush="${BRUSH}" d="M0 0 Z" fill="#000000" fub:ink="${INK}"/>`;
    const bare = `<path id="o8m3n0y5r" fub:tool="highlighter" fub:brush="${BRUSH}" fill="#000000" fub:ink="${INK}"></path>`;
    const raw = `${group}\n    ${stale}\n    ${bare}`;
    const out = apply(engine, { op: "add", parent: "l3f8a0c2d", pos: { first: true }, raw });
    const strokes = [stale.replace('d="M0 0 Z"', `d="${d}"`), bare.replace('"></path>', `" d="${d}"></path>`)];
    expect(out.text).toBe(lf(ROOT, TITLE, PAPER, L1, `    ${group}`, ...strokes.map((s) => `    ${s}`), E1, R2, R3, END_G, END));
    expect(out.inverse).toEqual({ op: "batch", ops: ["o8m3n0y5r", "o7k2m9x4q", "o5e6f7g8h"].map((target) => ({ op: "remove", target })) });
    expect(out.touched).toEqual(expect.arrayContaining(["o5e6f7g8h", "o6f7g8h9i", "o7k2m9x4q", "o8m3n0y5r"]));
  });

  it("rifiuta una forma sbagliata, un elemento del formato che elem non ammetterebbe, gli id presi e i genitori bloccati", () => {
    const add = (raw: unknown, parent = "l3f8a0c2d"): unknown => ({ op: "add", parent, pos: { last: true }, raw });
    rejects(BASE, { ...(add("<rect style='x'/>") as object), elem: R4_ELEM }, "invalid-elem");
    const malformed = ["<rect style='x'>", "<rect style='x'/>testo<rect style='y'/>", " <rect style='x'/>", "<rect style='x'/> ", "<!-- c --><rect style='x'/>", "<rect style='x'/><!-- c --><rect style='y'/>", "<rect style='x'/><?pi?><rect style='y'/>", "testo", 7, ""];
    for (const raw of malformed) rejects(BASE, add(raw), "invalid-elem");
    for (const raw of [
      '<rect width="10" height="10"/>',
      '<rect id="z" width="10" height="10"/>',
      '<g id="l1b2c3d4e" fub:layer="Dentro"/>',
      '<rect id="o9z8y7x6w" fub:role="paper" width="10" height="10"/>',
      '<g id="o9z8y7x6w"><rect width="1" height="1"/></g>',
      `<path id="o9z8y7x6w" fub:tool="pen" fub:brush="${BRUSH}" fub:ink="1 s100 cxypt"/>`,
    ]) {
      rejects(BASE, add(raw), "invalid-elem");
    }
    rejects(BASE, add("<title>Nome</title>", "#root"), "invalid-elem");
    rejects(BASE, add(`<rect id="o9z8y7x6w" width="1" height="1" font-family="${"x".repeat(MAX_VALUE_BYTES + 1)}"/>`), "limit");
    rejects(BASE, add('<g style="x"><rect id="o2b3c4d5e"/></g>'), "duplicate-id");
    rejects(BASE, add('<g style="x"><rect id="z"/><rect id="z"/></g>'), "duplicate-id");
    rejects(BASE, add(`${R4.trim()}<rect style="x" id="o4d5e6f7g"/>`), "duplicate-id");
    rejects(lf(ROOT, TITLE, PAPER, L1_LOCKED, E1, END_G, END), add("<rect style='x'/>"), "locked");
    rejects(BASE, add("<rect style='x'/>", "o1a2b3c4d"), "missing-parent");
  });

  it("un estraneo porta valori oltre il limite di elem", () => {
    const engine = SceneEngine.open(BASE);
    const raw = `<rect style="x" data-n="${"x".repeat(MAX_VALUE_BYTES + 1)}"/>`;
    expect(apply(engine, { op: "add", parent: "l3f8a0c2d", pos: { last: true }, raw }).text).toContain(raw);
  });

  it(`l'inversa di una sequenza lunga si applica anche oltre ${MAX_BATCH} operazioni`, () => {
    const engine = SceneEngine.open(BASE);
    const ids = Array.from({ length: MAX_BATCH + 1 }, (_, i) => `o${i.toString(36).padStart(8, "0")}`);
    const raw = ids.map((id) => `<rect id="${id}" x="0" y="0" width="1" height="1"/>`).join("\n    ");
    const added = applied(engine.apply({ op: "add", parent: "l3f8a0c2d", pos: { last: true }, raw }));
    // Un'altra modifica in mezzo: l'annulla non è più esatto, e passa
    // dall'inversa.
    applied(engine.apply({ op: "set", id: "o1a2b3c4d", attrs: { fill: "#000000" } }));
    applied(engine.undo(added.undo));
    expect(engine.text).toBe(BASE.replace('fill="none"', 'fill="#000000"'));
    // Ciò che arriva resta nel limite.
    rejects(BASE, added.undo.inverse, "limit");
  });
});

describe("i nomi", () => {
  it("il nome di un oggetto segue il suo primo `title`, anche quando il tag del contenitore si riscrive", () => {
    const engine = SceneEngine.open(BASE);
    const named = (id: string): string | undefined => {
      const item = engine.scene().find((entry) => entry.kind === "element" && entry.id === id);
      return item?.kind === "element" ? item.title : undefined;
    };
    apply(engine, { op: "add", parent: "l3f8a0c2d", pos: { first: true }, elem: { tag: "title", attrs: {}, text: "Sfondo" } });
    expect(named("l3f8a0c2d")).toBe("Sfondo");
    // Il tag d'apertura si riscrive senza rileggere i figli: il nome resta.
    apply(engine, { op: "set", id: "l3f8a0c2d", attrs: { "fub:layer": "Primo" } });
    expect(named("l3f8a0c2d")).toBe("Sfondo");
    apply(engine, {
      op: "add",
      parent: "l3f8a0c2d",
      pos: { last: true },
      elem: { tag: "g", attrs: { id: "o9g8f7e6d" }, children: [{ tag: "title", attrs: {}, text: "Casa" }, { ...R4_ELEM, children: [{ tag: "title", attrs: {}, text: "Tetto" }] }] },
    });
    expect(named("o9g8f7e6d")).toBe("Casa");
    expect(named("o4d5e6f7g")).toBe("Tetto");
    apply(engine, { op: "set", id: "o9g8f7e6d", attrs: { opacity: "0.5" } });
    expect(named("o9g8f7e6d")).toBe("Casa");
    apply(engine, { op: "remove", target: { path: [2, 0], tag: "title" } });
    expect(named("l3f8a0c2d")).toBeUndefined();
    expect(named("o1a2b3c4d")).toBeUndefined();
  });
});

describe("le risorse", () => {
  const DEFS = '  <defs id="fub-defs">';
  const END_DEFS = "  </defs>";
  /// Una sfumatura nella `defs`, col suo ciclo di vita.
  const gradient = (id: string, role: string | null): string[] => [
    `    <linearGradient id="${id}"${role === null ? "" : ` fub:role="${role}"`} x1="0" y1="0" x2="1" y2="0">`,
    '      <stop offset="0" stop-color="#0072b2"/>',
    '      <stop offset="1" stop-color="#56b4e9"/>',
    "    </linearGradient>",
  ];
  /// Un rettangolo nel livello che usa `ref` per il riempimento.
  const user = (id: string, ref: string): string => `    <rect id="${id}" x="500" y="100" width="200" height="120" fill="url(#${ref}) #0072b2"/>`;
  const G = "r1a2b3c4d";
  const PRIVATE = lf(ROOT, TITLE, DEFS, ...gradient(G, "private"), END_DEFS, PAPER, L1, user("o2b3c4d5e", G), R3, END_G, END);
  const PLAIN = lf(ROOT, TITLE, PAPER, L1, R2, R3, END_G, END);

  it("una risorsa condivisa resta finché qualcuno la usa, poi se ne va con la defs", () => {
    const source = lf(ROOT, TITLE, DEFS, ...gradient(G, "shared"), END_DEFS, PAPER, L1, user("o2b3c4d5e", G), user("o3c4d5e6f", G), END_G, END);
    const engine = SceneEngine.open(source);
    const first = apply(engine, { op: "remove", target: "o2b3c4d5e" });
    expect(first.forward).toEqual({ op: "remove", target: "o2b3c4d5e" });
    expect(first.text).toBe(lf(ROOT, TITLE, DEFS, ...gradient(G, "shared"), END_DEFS, PAPER, L1, user("o3c4d5e6f", G), END_G, END));
    const second = apply(engine, { op: "remove", target: "o3c4d5e6f" });
    expect(second.text).toBe(lf(ROOT, TITLE, PAPER, L1, END_G, END));
    expect(second.forward).toEqual({
      op: "batch",
      ops: [{ op: "remove", target: "o3c4d5e6f" }, { op: "remove", target: G }, { op: "remove", target: "fub-defs" }],
    });
    expect([...second.touched].sort()).toEqual(["fub-defs", "o3c4d5e6f", G].sort());
    expect(applied(engine.undo(second.undo)).text).toBe(first.text);
  });

  it("la raccolta tocca solo ciò che l'operazione lascia solo", () => {
    // Una sfumatura privata che nessuno usava resta anche se l'operazione la
    // cambia.
    const source = lf(ROOT, TITLE, DEFS, ...gradient(G, "private"), END_DEFS, PAPER, L1, R2, END_G, END);
    const engine = SceneEngine.open(source);
    const out = apply(engine, { op: "set", id: G, attrs: { x2: "0.5" } });
    expect(out.text).toBe(source.replace('x2="1"', 'x2="0.5"'));
    expect(out.forward).toEqual({ op: "set", id: G, attrs: { x2: "0.5" } });
  });

  it("un riferimento da un elemento estraneo o da un foglio di stile tiene la risorsa", () => {
    const foreign = '    <path style="fill:url(#r1a2b3c4d)" d="M0 0h10v10z"/>';
    const withForeign = lf(ROOT, TITLE, DEFS, ...gradient(G, "private"), END_DEFS, PAPER, L1, user("o2b3c4d5e", G), foreign, END_G, END);
    const engine = SceneEngine.open(withForeign);
    const out = apply(engine, { op: "remove", target: "o2b3c4d5e" });
    expect(out.text).toBe(lf(ROOT, TITLE, DEFS, ...gradient(G, "private"), END_DEFS, PAPER, L1, foreign, END_G, END));
    rejects(out.text, { op: "remove", target: G }, "in-use");

    const sheet = "  <style>.sole { fill: url(#r1a2b3c4d) }</style>";
    const withSheet = lf(ROOT, TITLE, DEFS, ...gradient(G, "private"), END_DEFS, sheet, PAPER, L1, user("o2b3c4d5e", G), END_G, END);
    expect(apply(SceneEngine.open(withSheet), { op: "remove", target: "o2b3c4d5e" }).text).toContain(`<linearGradient id="${G}"`);
  });

  it("chi usa e la risorsa si tolgono insieme, in un batch", () => {
    const engine = SceneEngine.open(PRIVATE);
    const out = apply(engine, { op: "batch", label: "Via", ops: [{ op: "remove", target: "o2b3c4d5e" }, { op: "remove", target: G }] });
    expect(out.text).toBe(lf(ROOT, TITLE, PAPER, L1, R3, END_G, END));
    // La raccolta toglie la `defs` rimasta vuota, nello stesso batch.
    expect(out.forward).toEqual({
      op: "batch",
      label: "Via",
      ops: [{ op: "remove", target: "o2b3c4d5e" }, { op: "remove", target: G }, { op: "remove", target: "fub-defs" }],
    });
    expect(out.inverse).toMatchObject({ op: "batch", label: "Via" });
    expect(applied(SceneEngine.open(out.text).apply(out.inverse)).text).toBe(PRIVATE);
  });

  it("una defs non si toglie se qualcosa fuori usa le sue risorse", () => {
    rejects(PRIVATE, { op: "remove", target: "fub-defs" }, "in-use");
    // Un motivo che usa una sfumatura della stessa defs non la trattiene.
    const pattern = [
      '    <pattern id="r2b3c4d5e" x="0" y="0" width="40" height="40" patternUnits="userSpaceOnUse">',
      `      <rect x="0" y="0" width="20" height="20" fill="url(#${G}) #0072b2"/>`,
      "    </pattern>",
    ];
    const source = lf(ROOT, TITLE, DEFS, ...gradient(G, null), ...pattern, END_DEFS, PAPER, L1, R2, END_G, END);
    expect(apply(SceneEngine.open(source), { op: "remove", target: "fub-defs" }).text).toBe(lf(ROOT, TITLE, PAPER, L1, R2, END_G, END));
  });

  it("ident non toglie l'id a una risorsa usata; a una che non lo è sì, e diventa estranea", () => {
    rejects(PRIVATE, { op: "ident", path: [1, 0], tag: "linearGradient", id: null }, "in-use");
    const unused = lf(ROOT, TITLE, DEFS, ...gradient(G, "private"), END_DEFS, PAPER, L1, R2, END_G, END);
    const engine = SceneEngine.open(unused);
    const out = apply(engine, { op: "ident", path: [1, 0], tag: "linearGradient", id: null });
    expect(out.text).toBe(unused.replace(` id="${G}"`, ""));
    expect(engine.scene().some((item) => item.kind === "foreign")).toBe(true);
  });

  it("una risorsa si sposta solo fra le defs della radice; chi la usa si sposta e resta modificabile", () => {
    const other = ['  <defs id="defs2">', "  </defs>"];
    const source = lf(ROOT, TITLE, DEFS, ...gradient(G, "private"), END_DEFS, ...other, PAPER, L1, user("o2b3c4d5e", G), END_G, L2, R3, END_G, END);
    rejects(source, { op: "move", target: G, parent: "l3f8a0c2d", pos: { last: true } }, "invalid-elem");
    const engine = SceneEngine.open(source);
    const moved = apply(engine, { op: "move", target: G, parent: "defs2", pos: { last: true } });
    // La `defs` di FubDraw rimasta vuota se ne va con lo spostamento.
    expect(moved.text).toBe(lf(ROOT, TITLE, '  <defs id="defs2">', ...gradient(G, "private"), "  </defs>", PAPER, L1, user("o2b3c4d5e", G), END_G, L2, R3, END_G, END));
    const user2 = apply(engine, { op: "move", target: "o2b3c4d5e", parent: "l9k8j7h6g", pos: { last: true } });
    expect(user2.text).toBe(lf(ROOT, TITLE, '  <defs id="defs2">', ...gradient(G, "private"), "  </defs>", PAPER, L1, END_G, L2, R3, user("o2b3c4d5e", G), END_G, END));
    expect(engine.scene().every((item) => item.kind !== "foreign")).toBe(true);
  });

  it("set su una risorsa la lascia modificabile", () => {
    const engine = SceneEngine.open(PRIVATE);
    expect(apply(engine, { op: "set", id: G, attrs: { "fub:role": "shared" } }).text).toBe(PRIVATE.replace('fub:role="private"', 'fub:role="shared"'));
    rejects(PRIVATE, { op: "set", id: G, attrs: { href: "#altro" } }, "invalid-elem");
    rejects(PRIVATE, { op: "set", id: G, attrs: { spreadMethod: "sideways" } }, "invalid-elem");
  });

  it("set su chi usa un ritaglio e un filtro lo lascia modificabile", () => {
    const C = "r2b3c4d5e";
    const F = "r3c4d5e6f";
    const clip = [`    <clipPath id="${C}" fub:role="private">`, '      <circle cx="600" cy="160" r="50"/>', "    </clipPath>"];
    const blur = [`    <filter id="${F}" fub:role="shared">`, '      <feGaussianBlur stdDeviation="4"/>', "    </filter>"];
    const rect = (attrs: string): string => `    <rect id="o2b3c4d5e" x="500" y="100" width="200" height="120" fill="#e69f00"${attrs}/>`;
    const source = lf(ROOT, TITLE, DEFS, ...clip, ...blur, END_DEFS, PAPER, L1, rect(` clip-path="url(#${C})" filter="url(#${F})"`), END_G, END);
    const engine = SceneEngine.open(source);
    expect(apply(engine, { op: "set", id: "o2b3c4d5e", attrs: { opacity: "0.5", transform: "rotate(10 600 160)" } }).text).toBe(
      lf(ROOT, TITLE, DEFS, ...clip, ...blur, END_DEFS, PAPER, L1, rect(` clip-path="url(#${C})" filter="url(#${F})" opacity="0.5" transform="rotate(10 600 160)"`), END_G, END),
    );
    // Il ritaglio e il filtro che nessuno usa più se ne vanno, e la defs con loro.
    const cleared = apply(engine, { op: "set", id: "o2b3c4d5e", attrs: { "clip-path": null, filter: null } });
    expect(cleared.text).toBe(lf(ROOT, TITLE, PAPER, L1, rect(' opacity="0.5" transform="rotate(10 600 160)"'), END_G, END));
    expect(engine.scene().every((item) => item.kind !== "foreign")).toBe(true);
  });

  it("in un batch la risorsa viene prima di chi la usa", () => {
    const elem: Elem = { tag: "linearGradient", attrs: { id: G, x1: "0", y1: "0", x2: "1", y2: "0" } };
    const add: Op = { op: "add", parent: "#root", pos: { first: true }, elem: { tag: "defs", attrs: { id: "fub-defs" }, children: [elem] } };
    const use: Op = { op: "set", id: "o2b3c4d5e", attrs: { fill: `url(#${G}) #0072b2` } };
    expect(SceneEngine.open(PLAIN).apply({ op: "batch", ops: [use, add] })).toMatchObject({ outcome: "rejected", reason: "invalid-elem", index: 0 });
    expect(apply(SceneEngine.open(PLAIN), { op: "batch", ops: [add, use] }).text).toContain(`fill="url(#${G}) #0072b2"`);
  });

  it("gli id delle risorse e del loro contenuto", () => {
    const add = (elem: Elem): Op => ({ op: "add", parent: "#root", pos: { first: true }, elem });
    const defs = (...children: Elem[]): Elem => ({ tag: "defs", attrs: { id: "fub-defs" }, children });
    const stop: Elem = { tag: "stop", attrs: { offset: "0", "stop-color": "#0072b2" } };
    rejects(PLAIN, add({ tag: "defs", attrs: { id: "defs2" } }), "invalid-elem");
    rejects(PLAIN, add(defs({ tag: "linearGradient", attrs: { x2: "1" }, children: [stop] })), "invalid-elem");
    rejects(PLAIN, add(defs({ tag: "linearGradient", attrs: { id: "o1a2b3c4d" }, children: [stop] })), "invalid-elem");
    rejects(PLAIN, add(defs({ tag: "linearGradient", attrs: { id: G }, children: [{ ...stop, attrs: { ...stop.attrs, id: "o1a2b3c4d" } }] })), "invalid-elem");
    const named = apply(SceneEngine.open(PLAIN), add(defs({ tag: "linearGradient", attrs: { id: G }, children: [{ ...stop, attrs: { ...stop.attrs, id: "r0a0b0c0d" } }] })));
    expect(named.text).toContain('<stop id="r0a0b0c0d" offset="0" stop-color="#0072b2"/>');
    // Il contenuto di un motivo è senza id, anche un gruppo.
    const pattern: Elem = {
      tag: "pattern",
      attrs: { id: G, x: "0", y: "0", width: "40", height: "40", patternUnits: "userSpaceOnUse" },
      children: [{ tag: "g", attrs: {}, children: [{ tag: "rect", attrs: { width: "20", height: "20", fill: "#0072b2" } }] }],
    };
    expect(apply(SceneEngine.open(PLAIN), add(defs(pattern))).text).toContain("      <g>\n        <rect width=\"20\" height=\"20\" fill=\"#0072b2\"/>\n      </g>");
  });

  it("first sotto la radice: una defs va prima della carta, il resto dopo le defs e la carta in testa", () => {
    const layer: Op = { op: "add", parent: "#root", pos: { first: true }, elem: { tag: "g", attrs: { id: "l0a1b2c3d", "fub:layer": "Sfondo" } } };
    const engine = SceneEngine.open(PRIVATE);
    expect(apply(engine, layer).text).toBe(
      lf(ROOT, TITLE, DEFS, ...gradient(G, "private"), END_DEFS, PAPER, '  <g id="l0a1b2c3d" fub:layer="Sfondo">', "  </g>", L1, user("o2b3c4d5e", G), R3, END_G, END),
    );
    // Una defs in fondo, come la scrive Figma, non sta in testa.
    const figma = lf(ROOT, L1, R2, END_G, '  <defs id="defs1">', ...gradient(G, null), "  </defs>", END);
    expect(apply(SceneEngine.open(figma), layer).text).toBe(
      lf(ROOT, '  <g id="l0a1b2c3d" fub:layer="Sfondo">', "  </g>", L1, R2, END_G, '  <defs id="defs1">', ...gradient(G, null), "  </defs>", END),
    );
    const defs: Op = { op: "add", parent: "#root", pos: { first: true }, elem: { tag: "defs", attrs: { id: "fub-defs" } } };
    expect(apply(SceneEngine.open(lf(ROOT, PAPER, L1, R2, END_G, END)), defs).text).toBe(lf(ROOT, '  <defs id="fub-defs"/>', PAPER, L1, R2, END_G, END));
  });

  it("una risorsa privata raccolta da una defs che non è di FubDraw lascia la defs", () => {
    const source = lf(ROOT, '  <defs id="defs2">', ...gradient(G, "private"), "  </defs>", PAPER, L1, user("o2b3c4d5e", G), END_G, END);
    const out = apply(SceneEngine.open(source), { op: "set", id: "o2b3c4d5e", attrs: { fill: "#e69f00" } });
    expect(out.text).toBe(lf(ROOT, '  <defs id="defs2">', "  </defs>", PAPER, L1, R2, END_G, END));
  });

  it("l'undo della raccolta che non è esatto rimette risorse e riferimenti", () => {
    const engine = SceneEngine.open(PRIVATE);
    const out = apply(engine, { op: "set", id: "o2b3c4d5e", attrs: { fill: "#e69f00" } });
    apply(engine, { op: "set", id: "o3c4d5e6f", attrs: { fill: "#111111" } });
    const undone = applied(engine.undo(out.undo));
    expect(undone.text).toBe(PRIVATE.replace('fill="#009e73"', 'fill="#111111"'));
    expect(engine.scene()).toEqual(readScene(undone.text).items);
    // Il ripeti, dopo un altro cambiamento, raccoglie di nuovo.
    apply(engine, { op: "set", id: "o3c4d5e6f", attrs: { fill: "#009e73" } });
    expect(applied(engine.undo(undone.undo)).text).toBe(lf(ROOT, TITLE, PAPER, L1, R2, R3, END_G, END));
  });

  it("due set di cui il secondo raccoglie non si fondono", () => {
    const engine = SceneEngine.open(PRIVATE);
    const first = apply(engine, { op: "set", id: "o2b3c4d5e", attrs: { fill: `url(#${G}) #000000` } });
    const second = apply(engine, { op: "set", id: "o2b3c4d5e", attrs: { fill: "#e69f00" } });
    expect(mergeUndo(first.undo, second.undo)).toBeNull();
  });

  it("un documento non riceve risorse oltre il limite, ma si modifica", () => {
    const many = (count: number): string => {
      const lines: string[] = [];
      for (let i = 0; i < count; i++) lines.push(`    <linearGradient id="r${i.toString(36).padStart(8, "0")}"/>`);
      return lf(ROOT, DEFS, ...lines, END_DEFS, PAPER, L1, R2, END_G, END);
    };
    const one: Op = { op: "add", parent: "fub-defs", pos: { last: true }, elem: { tag: "linearGradient", attrs: { id: "rzzzzzzzz" } } };
    rejects(many(MAX_RESOURCES), one, "limit");
    const full = SceneEngine.open(many(MAX_RESOURCES + 1));
    expect(full.apply({ op: "set", id: "o2b3c4d5e", attrs: { fill: "#000000" } }).outcome).toBe("applied");
    expect(full.apply(one)).toMatchObject({ outcome: "rejected", reason: "limit" });
    expect(SceneEngine.open(many(MAX_RESOURCES - 1)).apply(one).outcome).toBe("applied");
  });
});

describe("il testo in area e su tracciato", () => {
  const DEFS = '  <defs id="fub-defs">';
  const END_DEFS = "  </defs>";
  const P = "r1a2b3c4d";
  const CURVE = `    <path id="${P}" fub:role="private" d="M100 400 C250 250 450 250 600 400"/>`;
  const along = (content: string): string[] => [
    '    <text id="o5e6f7g8h" fill="#000000" font-size="32" text-anchor="middle">',
    `      <textPath startOffset="50%" href="#${P}">${content}</textPath>`,
    "    </text>",
  ];
  const ALONG = lf(ROOT, TITLE, DEFS, CURVE, END_DEFS, PAPER, L1, ...along("Il testo segue"), R3, END_G, END);
  const area = (...lines: string[]): string[] => [
    '    <text id="o5e6f7g8h" fub:wrap="320" x="100" y="200" font-size="32">',
    ...lines.map((line) => `      ${line}`),
    "    </text>",
  ];
  const AREA = lf(
    ROOT,
    TITLE,
    PAPER,
    L1,
    ...area('<tspan x="100" dy="0">Il testo in area va a</tspan>', '<tspan fub:join="space" x="100" dy="40">capo da solo.</tspan>'),
    END_G,
    END,
  );

  it("text su un testo su tracciato cambia il contenuto del textPath, coi pezzi, e l'undo lo rimette", () => {
    const engine = SceneEngine.open(ALONG);
    const out = apply(engine, { op: "text", id: "o5e6f7g8h", lines: [["Il testo ", { text: "segue", attrs: { "font-weight": "bold" } }, " la linea"]] });
    expect(out.text).toBe(lf(ROOT, TITLE, DEFS, CURVE, END_DEFS, PAPER, L1, ...along('Il testo <tspan font-weight="bold">segue</tspan> la linea'), R3, END_G, END));
    expect(out.inverse).toEqual({ op: "text", id: "o5e6f7g8h", lines: ["Il testo segue"] });
    const back = applied(engine.apply(out.inverse));
    expect(back.text).toBe(ALONG);
    expect(back.inverse).toEqual({
      op: "text",
      id: "o5e6f7g8h",
      lines: [["Il testo ", { text: "segue", attrs: { "font-weight": "bold" } }, " la linea"]],
    });
  });

  it("un testo su tracciato ha una riga sola, e non va a capo", () => {
    rejects(ALONG, { op: "text", id: "o5e6f7g8h", lines: ["Uno", "Due"] }, "invalid-elem");
    rejects(ALONG, { op: "text", id: "o5e6f7g8h", lines: [] }, "invalid-elem");
    rejects(ALONG, { op: "text", id: "o5e6f7g8h", lines: ["Uno"], joins: [null] }, "invalid-elem");
  });

  it("joins scrive fub:join riga per riga, e l'inversa rimette quelli di prima", () => {
    const engine = SceneEngine.open(AREA);
    const out = apply(engine, { op: "text", id: "o5e6f7g8h", lines: ["Il testo in area", "va a capo da", "solo."], joins: [null, "space", "space"] });
    expect(out.text).toBe(
      lf(
        ROOT,
        TITLE,
        PAPER,
        L1,
        ...area(
          '<tspan x="100" dy="0">Il testo in area</tspan>',
          '<tspan fub:join="space" x="100" dy="40">va a capo da</tspan>',
          '<tspan fub:join="space" x="100" dy="40">solo.</tspan>',
        ),
        END_G,
        END,
      ),
    );
    expect(out.inverse).toEqual({ op: "text", id: "o5e6f7g8h", lines: ["Il testo in area va a", "capo da solo."], joins: [null, "space"] });
    expect(applied(engine.apply(out.inverse)).text).toBe(AREA);
    // Un a capo dentro una parola, e un paragrafo nuovo.
    const word = apply(SceneEngine.open(AREA), { op: "text", id: "o5e6f7g8h", lines: ["Il testo in area va a", "ca", "po."], joins: [null, "space", "word"] });
    expect(word.text).toContain('<tspan fub:join="word" x="100" dy="40">po.</tspan>');
    const split = apply(SceneEngine.open(AREA), { op: "text", id: "o5e6f7g8h", lines: ["Il testo in area va a", "capo da solo."], joins: [null, null] });
    expect(split.text).toContain('<tspan x="100" dy="40">capo da solo.</tspan>');
  });

  it("senza joins le righe tengono il loro fub:join, e una riga nuova comincia un paragrafo", () => {
    const out = apply(SceneEngine.open(AREA), { op: "text", id: "o5e6f7g8h", lines: ["Il testo in area va a", "capo da solo.", "Fine."] });
    expect(out.text).toBe(
      lf(
        ROOT,
        TITLE,
        PAPER,
        L1,
        ...area(
          '<tspan x="100" dy="0">Il testo in area va a</tspan>',
          '<tspan fub:join="space" x="100" dy="40">capo da solo.</tspan>',
          '<tspan x="100" dy="40">Fine.</tspan>',
        ),
        END_G,
        END,
      ),
    );
    expect(out.inverse).toEqual({ op: "text", id: "o5e6f7g8h", lines: ["Il testo in area va a", "capo da solo."], joins: [null, "space"] });
  });

  it("senza joins l'inversa rimette il fub:join di una riga che se ne va", () => {
    const engine = SceneEngine.open(AREA);
    const out = apply(engine, { op: "text", id: "o5e6f7g8h", lines: ["Il testo in area va a capo da solo."] });
    expect(out.inverse).toEqual({ op: "text", id: "o5e6f7g8h", lines: ["Il testo in area va a", "capo da solo."], joins: [null, "space"] });
    expect(apply(engine, out.inverse).text).toBe(AREA);
    // Un testo senza fub:join ha l'inversa senza joins.
    const plain = SceneEngine.open(AREA.replace(/ fub:join="space"/g, ""));
    expect(apply(plain, { op: "text", id: "o5e6f7g8h", lines: ["Uno"] }).inverse).not.toHaveProperty("joins");
  });

  it("joins vuole una voce per riga, un testo o null", () => {
    rejects(AREA, { op: "text", id: "o5e6f7g8h", lines: ["Uno", "Due"], joins: [null] }, "invalid-elem");
    rejects(AREA, { op: "text", id: "o5e6f7g8h", lines: ["Uno"], joins: "space" }, "invalid-elem");
    rejects(AREA, { op: "text", id: "o5e6f7g8h", lines: ["Uno", "Due"], joins: [null, 1] }, "invalid-elem");
    rejects(AREA, { op: "text", id: "o5e6f7g8h", lines: ["Uno", "Due"], joins: [null, "a\u0001"] }, "invalid-elem");
  });

  it("il tracciato di un testo è una risorsa: lo trattiene, e se ne va con lui", () => {
    rejects(ALONG, { op: "remove", target: P }, "in-use");
    rejects(ALONG, { op: "ident", path: [1, 0], tag: "path", id: null }, "in-use");
    const engine = SceneEngine.open(ALONG);
    const out = apply(engine, { op: "remove", target: "o5e6f7g8h" });
    expect(out.text).toBe(lf(ROOT, TITLE, PAPER, L1, R3, END_G, END));
    expect(out.forward).toEqual({
      op: "batch",
      ops: [{ op: "remove", target: "o5e6f7g8h" }, { op: "remove", target: P }, { op: "remove", target: "fub-defs" }],
    });
    expect(applied(engine.undo(out.undo)).text).toBe(ALONG);
  });

  it("set sul tracciato ne cambia la forma; un attributo fuori dal formato lo renderebbe estraneo", () => {
    const engine = SceneEngine.open(ALONG);
    expect(apply(engine, { op: "set", id: P, attrs: { d: "M600 400 C450 250 250 250 100 400" } }).text).toBe(
      ALONG.replace("M100 400 C250 250 450 250 600 400", "M600 400 C450 250 250 250 100 400"),
    );
    rejects(ALONG, { op: "set", id: P, attrs: { transform: "rotate(10)" } }, "invalid-elem");
    rejects(ALONG, { op: "set", id: P, attrs: { d: "M100 Q" } }, "invalid-elem");
  });

  it("add porta il tracciato nella defs e il testo che lo segue, coi pezzi", () => {
    const PLAIN = lf(ROOT, TITLE, PAPER, L1, R3, END_G, END);
    const defs: Op = {
      op: "add",
      parent: "#root",
      pos: { first: true },
      elem: { tag: "defs", attrs: { id: "fub-defs" }, children: [{ tag: "path", attrs: { id: P, "fub:role": "private", d: "M100 400 C250 250 450 250 600 400" } }] },
    };
    const text: Op = {
      op: "add",
      parent: "l3f8a0c2d",
      pos: { first: true },
      elem: {
        tag: "text",
        attrs: { id: "o5e6f7g8h", fill: "#000000", "font-size": "32", "text-anchor": "middle" },
        children: [{ tag: "textPath", attrs: { href: `#${P}`, startOffset: "50%" }, runs: ["Il testo segue"] }],
      },
    };
    const out = apply(SceneEngine.open(PLAIN), { op: "batch", ops: [defs, text] });
    expect(out.text).toBe(ALONG);
    // Con raw, allo stesso modo: il testo resta com'è scritto.
    const raw: Op = { op: "add", parent: "#root", pos: { first: true }, raw: `<defs id="fub-defs">\n${CURVE}\n${END_DEFS}` };
    expect(apply(SceneEngine.open(PLAIN), { op: "batch", ops: [raw, text] }).text).toBe(ALONG);
    // Un tracciato fra gli oggetti vuole un id da oggetto; nella defs, da risorsa.
    rejects(PLAIN, { ...defs, elem: { tag: "defs", attrs: { id: "fub-defs" }, children: [{ tag: "path", attrs: { id: "o1a2b3c4d", d: "M0 0 L10 10" } }] } }, "invalid-elem");
    rejects(PLAIN, { op: "add", parent: "l3f8a0c2d", pos: { last: true }, elem: { tag: "path", attrs: { id: P, d: "M0 0 L10 10" } } }, "invalid-elem");
    // Un textPath fuori da un testo, o con dei figli, non si scrive.
    rejects(PLAIN, { op: "add", parent: "l3f8a0c2d", pos: { last: true }, elem: { tag: "textPath", attrs: { href: `#${P}` }, text: "No" } }, "invalid-elem");
    // Un testo che segue un tracciato che non c'è è estraneo.
    rejects(PLAIN, text, "invalid-elem");
  });
});
