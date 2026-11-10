// Il motore delle operazioni oltre i vettori di `vectors.test.ts`: la forma
// della rete, i rifiuti uno per uno, i limiti, l'undo che non è esatto, i
// rientri di un `move`, `adopt`, `page` e `anchor` nei casi di bordo, gli id
// dei gruppi di pagina, i riferimenti alle risorse e la loro raccolta, il
// testo in area e su tracciato, le tavole con le loro carte. I testi attesi
// sono scritti a mano, e i `§` sono le sezioni di
// `docs/reference/scene-operations.md`.

import { describe, expect, it } from "vitest";
import { tryApplyOperation } from "../../core/text-operation";
import { mergeUndo, SceneEngine } from "./engine";
import { MAX_BATCH, MAX_NESTING, MAX_OP_BYTES, MAX_VALUE_BYTES, parseWireOp, type Op, type Reason } from "./ops";
import { MAX_EDIT_BYTES, MAX_ELEMENTS, readScene } from "./read";
import type { Elem } from "./serialize";
import {
  apply,
  applied,
  BASE,
  E1,
  END,
  END_G,
  L1,
  L1_LOCKED,
  L2,
  L2_LOCKED,
  lf,
  PAPER,
  R2,
  R3,
  R4,
  R4_ELEM,
  rejects,
  ROOT,
  TITLE,
  TWO_LAYERS,
} from "./engine/test-support";

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
      { op: "anchor", previous: { digest: null, pages: null } },
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
