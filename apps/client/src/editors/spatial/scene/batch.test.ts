// Una `batch` di molti `set` su unità diverse si applica in un passaggio solo
// (`SceneEngine.leafRun`), e deve dare ciò che darebbe un'operazione dopo
// l'altra: lo stesso testo, le stesse inverse, gli stessi id toccati, lo
// stesso errore, e un documento intatto se una si rifiuta.
//
// Il riferimento è il motore stesso, che applica le stesse operazioni una per
// volta, ciascuna per conto suo; un solo caso ha il testo scritto a mano.

import { describe, expect, it } from "vitest";
import { tryApplyOperation } from "../../core/text-operation";
import { SceneEngine, type Applied, type Outcome, type Rejected } from "./engine";
import { buildDocument, buildFragment, parseFragment, parseFragments, type ContainerNode, type ElementPart } from "./model";
import type { BatchOp, Op } from "./ops";
import { NamespaceScope } from "./serialize";
import { normalizeEol, SourceText } from "./text";
import { FUB_NS, parseXml, SVG_NS } from "./xml";

const NS = 'xmlns="http://www.w3.org/2000/svg" xmlns:fub="https://fubeo.github.io/ns/scene/1"';
const ROOT = `<svg ${NS} fub:version="1" viewBox="0 0 1600 1000" width="1600" height="1000">`;
const PAPER = '  <rect id="fub-paper" fub:role="paper" x="0" y="0" width="1600" height="1000" fill="#ffffff"/>';
const G = "r1a2b3c4d";

/// L'id dell'`i`-esimo rettangolo.
const idOf = (i: number): string => `o${i.toString(36).padStart(8, "0")}`;
const rect = (i: number, indent = "    "): string => `${indent}<rect id="${idOf(i)}" x="${i}" y="1" width="4" height="4" fill="#e69f00"/>`;

/// Un documento con `count` rettangoli in un livello, a capo con `eol` e
/// rientrati di `indent` (due volte).
function document(count: number, eol = "\n", indent = "  "): string {
  const lines = [ROOT, PAPER, `${indent}<g id="l3f8a0c2d" fub:layer="Livello 1">`];
  for (let i = 0; i < count; i++) lines.push(rect(i, indent + indent));
  lines.push(`${indent}</g>`, "</svg>", "");
  return lines.join(eol);
}

function applied(outcome: Outcome): Applied {
  if (outcome.outcome !== "applied") throw new Error(`rifiutata: ${outcome.reason} (${outcome.detail})`);
  return outcome;
}

function rejected(outcome: Outcome): Rejected {
  if (outcome.outcome !== "rejected") throw new Error("applicata");
  return outcome;
}

const set = (id: string, attrs: Record<string, string | null>): Op => ({ op: "set", id, attrs });

/// Il testo cambia ogni rettangolo in un modo, a giro: un colore, uno
/// spostamento, un attributo tolto, uno nuovo, due insieme.
function change(id: string, i: number): Op {
  switch (i % 5) {
    case 0:
      return set(id, { fill: `#${(0x100000 + i * 37).toString(16)}` });
    case 1:
      return set(id, { transform: `translate(${i} ${i + 1})` });
    case 2:
      return set(id, { fill: null });
    case 3:
      return set(id, { "fub:name": `Nome ${i} è così` });
    default:
      return set(id, { stroke: "#0072b2", "stroke-width": `${i % 7}` });
  }
}

/// `ops` applicate una per volta, ciascuna per conto suo: le inverse in
/// ordine di applicazione, gli id toccati senza ripetizioni, e il testo di
/// dopo. Si ferma al primo rifiuto, che restituisce con la sua posizione.
function oneByOne(source: string, ops: readonly Op[], follow?: SceneEngine["follow"]): {
  readonly text: string;
  readonly inverses: Op[];
  readonly touched: string[];
  readonly refusal: { readonly at: number; readonly outcome: Rejected } | null;
} {
  const engine = SceneEngine.open(source);
  engine.follow = follow ?? null;
  const inverses: Op[] = [];
  const touched = new Set<string>();
  for (let at = 0; at < ops.length; at++) {
    const outcome = engine.apply(ops[at]!);
    if (outcome.outcome === "rejected") return { text: engine.text, inverses, touched: [...touched], refusal: { at, outcome } };
    inverses.push(outcome.inverse);
    for (const id of outcome.touched) touched.add(id);
  }
  return { text: engine.text, inverses, touched: [...touched], refusal: null };
}

/// Applica `ops` in una `batch` e controlla che dia ciò che danno una per
/// volta: testo, inversa e id toccati; che la modifica sul testo porti da
/// prima a dopo; e che si annulli, esattamente e con l'inversa.
function sameAsOneByOne(source: string, ops: readonly Op[]): Applied {
  const reference = oneByOne(source, ops);
  expect(reference.refusal).toBeNull();
  const engine = SceneEngine.open(source);
  const out = applied(engine.apply({ op: "batch", ops: [...ops] }));
  expect(out.text).toBe(reference.text);
  expect(out.inverse).toEqual({ op: "batch", ops: [...reference.inverses].reverse() });
  expect(new Set(out.touched)).toEqual(new Set(reference.touched));
  expect(out.touched).toEqual(reference.touched);
  expect(out.forward).toEqual({ op: "batch", ops });
  expect(tryApplyOperation(normalizeEol(source), out.operation)).toEqual({ kind: "applied", text: normalizeEol(out.text) });
  expect(engine.scene()).toEqual(SceneEngine.open(out.text).scene());

  // L'undo esatto riporta il testo di prima, byte per byte; l'inversa, che
  // riscrive le unità in forma canonica, dà ciò che danno le loro inverse
  // applicate una alla volta.
  const exact = applied(engine.undo(out.undo));
  expect(exact.text).toBe(source);
  const other = SceneEngine.open(out.text);
  expect(applied(other.apply(out.inverse)).text).toBe(oneByOne(reference.text, [...reference.inverses].reverse()).text);
  return out;
}

describe("una batch di molti set", () => {
  it("scrive ciò che scrive un set dopo l'altro, a mano", () => {
    const source = document(3);
    const out = applied(
      SceneEngine.open(source).apply({
        op: "batch",
        ops: [set(idOf(0), { fill: "#000000" }), set(idOf(1), { "fub:name": "Due" }), set(idOf(2), { fill: null, stroke: "#ffffff" })],
      }),
    );
    expect(out.text).toBe(
      [
        ROOT,
        PAPER,
        '  <g id="l3f8a0c2d" fub:layer="Livello 1">',
        `    <rect id="${idOf(0)}" x="0" y="1" width="4" height="4" fill="#000000"/>`,
        `    <rect id="${idOf(1)}" fub:name="Due" x="1" y="1" width="4" height="4" fill="#e69f00"/>`,
        `    <rect id="${idOf(2)}" x="2" y="1" width="4" height="4" stroke="#ffffff"/>`,
        "  </g>",
        "</svg>",
        "",
      ].join("\n"),
    );
    expect(out.inverse).toEqual({
      op: "batch",
      ops: [set(idOf(2), { fill: "#e69f00", stroke: null }), set(idOf(1), { "fub:name": null }), set(idOf(0), { fill: "#e69f00" })],
    });
    expect(out.touched).toEqual([idOf(0), idOf(1), idOf(2)]);
  });

  it.each([
    ["LF, rientro di due spazi", "\n", "  "],
    ["CRLF", "\r\n", "  "],
    ["tabulazioni", "\n", "\t"],
    ["CR", "\r", "  "],
  ])("dà lo stesso di uno alla volta: %s", (_name, eol, indent) => {
    const source = document(40, eol, indent);
    const ops = Array.from({ length: 40 }, (_, i) => change(idOf(i), i));
    sameAsOneByOne(source, ops);
  });

  it("dà lo stesso con un ordine qualunque, e con id ripetuti", () => {
    const source = document(30);
    const order = Array.from({ length: 30 }, (_, i) => (i * 7) % 30);
    const ops = [...order.map((i) => change(idOf(i), i)), set(idOf(3), { fill: "#111111" }), set(idOf(3), { fill: "#222222" }), change(idOf(9), 4)];
    sameAsOneByOne(source, ops);
  });

  it("dà lo stesso oltre il tratto più lungo che si applica insieme", () => {
    const source = document(700);
    const ops = Array.from({ length: 700 }, (_, i) => change(idOf(i), i));
    const out = sameAsOneByOne(source, ops);
    expect(out.touched).toHaveLength(700);
  });

  it("dà lo stesso con unità in più contenitori, anche con namespace propri", () => {
    const inner = (i: number): string => `      <rect id="${idOf(i)}" zz:tag="${i}" x="${i}" y="1" width="4" height="4"/>`;
    const source = [
      ROOT,
      PAPER,
      '  <g id="l3f8a0c2d" fub:layer="Livello 1">',
      rect(0),
      rect(1),
      '    <g id="g1aaaaaaa" xmlns:zz="urn:zz" transform="translate(5 5)">',
      inner(10),
      inner(11),
      inner(12),
      "    </g>",
      rect(2),
      "  </g>",
      '  <g id="l9k8j7h6g" fub:layer="Livello 2">',
      rect(3),
      rect(4),
      "  </g>",
      "</svg>",
      "",
    ].join("\n");
    const ops = [0, 10, 3, 1, 11, 4, 12, 2].map((i) => (i >= 10 ? set(idOf(i), { "zz:tag": "nuovo", fill: "#abcdef" }) : change(idOf(i), i + 1)));
    sameAsOneByOne(source, ops);
  });

  it("dà lo stesso quando una non comincia una riga, o sta fra altre operazioni", () => {
    const source = [
      ROOT,
      PAPER,
      '  <g id="l3f8a0c2d" fub:layer="Livello 1">',
      rect(0),
      `    ${rect(1, "")}${rect(2, "")}`,
      `    ${rect(3, "")} <text id="${idOf(8)}" x="1" y="2">`,
      '      <tspan x="1" dy="0">a</tspan>',
      `    </text> <text id="${idOf(9)}" x="1" y="9">`,
      '      <tspan x="1" dy="0">b</tspan>',
      `    </text>${rect(6, "")}\t${rect(7, "")}`,
      `    <rect id="${idOf(4)}"`,
      '          x="4" y="1"',
      '          width="4" height="4"/>',
      rect(5),
      "  </g>",
      "</svg>",
      "",
    ].join("\n");
    const ops = [
      change(idOf(0), 1),
      change(idOf(1), 2),
      change(idOf(2), 3),
      set("l3f8a0c2d", { "fub:name": "Livello" }),
      change(idOf(3), 4),
      set(idOf(8), { fill: "#123456" }),
      set(idOf(9), { fill: "#654321" }),
      change(idOf(6), 5),
      change(idOf(7), 3),
      change(idOf(4), 5),
      change(idOf(5), 6),
    ];
    sameAsOneByOne(source, ops);
  });

  it("dà lo stesso se una unità cambia la lettura di quelle dopo: una risorsa nel mezzo", () => {
    const gradient = [
      '  <defs id="fub-defs">',
      `    <linearGradient id="${G}" fub:role="shared" x1="0" y1="0" x2="1" y2="0">`,
      '      <stop offset="0" stop-color="#0072b2"/>',
      '      <stop offset="1" stop-color="#56b4e9"/>',
      "    </linearGradient>",
      "  </defs>",
    ];
    const user = (i: number): string => `    <rect id="${idOf(i)}" x="${i}" y="1" width="4" height="4" fill="url(#${G}) #0072b2"/>`;
    const source = [ROOT, ...gradient, PAPER, '  <g id="l3f8a0c2d" fub:layer="Livello 1">', user(0), user(1), user(2), "  </g>", "</svg>", ""].join("\n");
    const ops = [set(idOf(0), { fill: "#000000" }), set(G, { x2: "0.5" }), set(idOf(1), { fill: `url(#${G}) #ffffff` }), set(idOf(2), { opacity: "0.5" })];
    sameAsOneByOne(source, ops);
  });

  it("dà lo stesso con una risorsa che è un'unità, nel mezzo di quelle che la usano", () => {
    const curve = `    <path id="${G}" fub:role="private" d="M100 400 C250 250 450 250 600 400"/>`;
    const text = (i: number): string => `    <text id="${idOf(i)}" fill="#000000" font-size="32"><textPath startOffset="50%" href="#${G}">Testo ${i}</textPath></text>`;
    const source = [ROOT, '  <defs id="fub-defs">', curve, "  </defs>", PAPER, '  <g id="l3f8a0c2d" fub:layer="Livello 1">', rect(0), text(1), rect(2), text(3), "  </g>", "</svg>", ""].join("\n");
    sameAsOneByOne(source, [change(idOf(0), 0), change(idOf(1), 1), set(G, { d: "M0 0 L10 10" }), change(idOf(2), 2), set(idOf(3), { fill: "#ffffff" })]);
    // Una risorsa che smette di esserlo prima di chi la cita: come uno alla volta, rifiutata o no.
    const ops = [change(idOf(0), 0), set(G, { "fub:role": null }), set(idOf(1), { fill: "#ffffff" }), set(idOf(3), { fill: "#ffffff" })];
    const reference = oneByOne(source, ops);
    const out = SceneEngine.open(source).apply({ op: "batch", ops });
    if (reference.refusal === null) expect(applied(out).text).toBe(reference.text);
    else expect(out).toEqual({ ...reference.refusal.outcome, index: reference.refusal.at });
  });

  it("cambia anche il tratto, la carta e le tavole come uno alla volta", () => {
    const source = [
      ROOT,
      '  <rect id="fub-paper" fub:role="paper" fub:board="b1a2b3c4d" x="0" y="0" width="1600" height="1000" fill="#ffffff"/>',
      '  <view id="b1a2b3c4d" fub:role="board" viewBox="0 0 1600 1000">',
      "    <title>Tavola 1</title>",
      "  </view>",
      '  <g id="l3f8a0c2d" fub:layer="Livello 1">',
      rect(0),
      rect(1),
      "  </g>",
      "</svg>",
      "",
    ].join("\n");
    const ops = [set("fub-paper", { x: "0", width: "1600" }), change(idOf(0), 3), change(idOf(1), 4)];
    sameAsOneByOne(source, ops);
  });
});

describe("una batch di molti set rifiutata", () => {
  /// Applica `ops` in una `batch` su `source`, e controlla che sia rifiutata
  /// come lo è la prima di loro che uno alla volta lo sarebbe, nello stesso
  /// modo e alla stessa posizione, e che il documento resti com'era e si
  /// possa ancora modificare.
  function refusedLikeOneByOne(source: string, ops: readonly Op[], next: readonly Op[] = [change(idOf(0), 0), change(idOf(1), 1)]): Rejected {
    const reference = oneByOne(source, ops);
    expect(reference.refusal).not.toBeNull();
    const engine = SceneEngine.open(source);
    const before = { text: engine.text, scene: engine.scene() };
    const out = rejected(engine.apply({ op: "batch", ops: [...ops] }));
    expect(out).toEqual({ ...reference.refusal!.outcome, index: reference.refusal!.at });
    expect(engine.text).toBe(before.text);
    expect(engine.scene()).toEqual(before.scene);
    // L'albero è intatto: l'operazione dopo si applica come su un documento nuovo.
    if (next.length > 0) expect(applied(engine.apply({ op: "batch", ops: [...next] })).text).toBe(oneByOne(source, next).text);
    return out;
  }

  const source = document(12);
  const fine = (i: number): Op => change(idOf(i), i);
  // Si riscrive in un testo che il formato non ammette, ma lo si vede solo dopo.
  const unreadable = (i: number): Op => set(idOf(i), { fill: 'a"b&c<d' });

  it("per un bersaglio che non c'è, a metà", () => {
    const out = refusedLikeOneByOne(source, [fine(0), fine(1), fine(2), set("o9z9z9z9z", { fill: "#000000" }), fine(4), fine(5)]);
    expect(out.reason).toBe("missing-target");
    expect(out.index).toBe(3);
  });

  it("per un attributo che non si scrive, a metà", () => {
    const out = refusedLikeOneByOne(source, [fine(0), fine(1), set(idOf(2), { id: "o9z9z9z9z" }), fine(3), fine(4)]);
    expect(out.reason).toBe("invalid-elem");
    expect(out.index).toBe(2);
  });

  it("per un valore che non si ammette, in fondo", () => {
    refusedLikeOneByOne(source, [fine(0), fine(1), fine(2), fine(3), set(idOf(4), { fill: "a\u0001b" })]);
  });

  it("per un elemento che riscritto non è più modificabile, anche con altri errori dopo", () => {
    // Il difetto di `unreadable` si vede alla fine del passaggio: l'errore
    // che si dà è però il suo, che viene prima, non quello dell'operazione dopo.
    const out = refusedLikeOneByOne(source, [fine(0), fine(1), unreadable(2), fine(3), set("o9z9z9z9z", { fill: "#000000" }), set(idOf(5), { id: "o8z8z8z8z" })]);
    expect(out.index).toBe(2);
    expect(out.reason).toBe("invalid-elem");
  });

  it("per una carta o un elemento bloccato nel mezzo", () => {
    const locked = document(6).replace('fub:layer="Livello 1"', 'fub:layer="Livello 1" fub:locked="true"');
    const out = refusedLikeOneByOne(locked, [fine(0), fine(1), fine(2)], []);
    expect(out.reason).toBe("locked");
    expect(out.index).toBe(0);
    const paper = refusedLikeOneByOne(source, [fine(0), set("fub-paper", { fill: "#000000" }), fine(2)]);
    expect(paper.index).toBe(1);
  });

  it("dentro un'altra batch, con la posizione di ogni livello", () => {
    const out = refusedLikeOneByOne(source, [fine(0), { op: "batch", ops: [fine(1), fine(2), set("o9z9z9z9z", { fill: "#000000" })] }, fine(3)]);
    expect(out.index).toBe(1);
  });
});

describe("il seguito di una batch di molti set", () => {
  const follow = (count: number): NonNullable<SceneEngine["follow"]> =>
    (_model, touched) => {
      const ids = [...touched].filter((id) => id.startsWith("o")).slice(0, count);
      return ids.length === 0 ? null : { op: "batch", ops: ids.map((id) => set(id, { "fub:name": `segue ${ids.length}` })) };
    };

  it("si applica come un'operazione dopo l'altra, e si annulla insieme alla richiesta", () => {
    const source = document(50);
    const request: Op = { op: "batch", ops: Array.from({ length: 20 }, (_, i) => change(idOf(i), i)) };
    const engine = SceneEngine.open(source);
    engine.follow = follow(20);
    const out = applied(engine.apply(request));

    // Uno alla volta: la richiesta con il suo seguito, poi tutto il resto.
    const reference = SceneEngine.open(source);
    reference.follow = null;
    const first = applied(reference.apply(request));
    const followed = follow(20)(reference.model!, new Set(first.touched), request)!;
    applied(reference.apply(followed));
    expect(out.text).toBe(reference.text);
    expect(out.forward).toEqual({ op: "batch", ops: [...(request as BatchOp).ops, ...(followed as BatchOp).ops] });

    const undone = applied(engine.undo(out.undo));
    expect(undone.text).toBe(source);
  });

  it("non lascia niente se il seguito si rifiuta", () => {
    const source = document(10);
    const engine = SceneEngine.open(source);
    engine.follow = () => ({ op: "batch", ops: [set(idOf(8), { "fub:name": "a" }), set(idOf(9), { "fub:name": "b" }), set("o9z9z9z9z", { "fub:name": "c" })] });
    const out = applied(engine.apply({ op: "batch", ops: [change(idOf(0), 0), change(idOf(1), 1)] }));
    expect(out.text).toBe(oneByOne(source, [change(idOf(0), 0), change(idOf(1), 1)]).text);
  });
});

// Più frammenti letti insieme (`parseFragments`) danno i nodi che darebbe ogni
// frammento da solo (`parseFragment`), qualunque sia il lotto in cui cadono; e
// se i frammenti non si dividono come sono stati dati, `null`.
describe("parseFragments", () => {
  const scope = NamespaceScope.EMPTY.declare([
    [null, SVG_NS],
    ["fub", FUB_NS],
  ]);
  const parent: ContainerNode = (() => {
    const model = buildDocument(parseXml(new SourceText(document(1)), false));
    return model.root.parts.find((part): part is ContainerNode => typeof part !== "string" && part.kind === "container")!;
  })();

  /// Ciò che di un nodo non dipende da dove è stato letto.
  const summary = (node: ElementPart) =>
    node.kind === "leaf"
      ? { kind: node.kind, raw: node.raw, facts: node.facts, details: node.details, problems: node.problems, ids: node.ids, refs: node.refs, elements: node.elements, openLength: node.openLength }
      : { kind: node.kind, head: node.head, tail: node.tail, facts: node.facts, details: node.details, parts: node.parts.length };

  /// Frammenti di forme, lunghezze e contenuti diversi, con figli e senza.
  function raws(count: number, long = 0): string[] {
    const out: string[] = [];
    for (let i = 0; i < count; i++) {
      switch (i % 4) {
        case 0:
          out.push(rect(i, ""));
          break;
        case 1:
          out.push(`<text id="${idOf(i)}" x="${i}" y="2" fub:name="Così ${i}">Ciao <tspan fill="#0072b2">${"x".repeat(long)}</tspan> a tutti</text>`);
          break;
        case 2:
          out.push(`<path id="${idOf(i)}" d="M ${i} 0 L 4 4 Z" fill="none" stroke="#000"/>`);
          break;
        default:
          out.push(`<rect id="${idOf(i)}" x="1"\n   y="2" width="3" height="4"></rect>`);
      }
    }
    return out;
  }

  const same = (list: readonly string[]): void => {
    const together = parseFragments(list, scope);
    expect(together).not.toBeNull();
    expect(together!.length).toBe(list.length);
    list.forEach((raw, i) => {
      const alone = parseFragment(raw, scope)!;
      expect(summary(buildFragment(together![i]!, parent))).toEqual(summary(buildFragment(alone, parent)));
    });
  };

  it("dà gli stessi nodi di un frammento alla volta, a lotti", () => {
    same([]);
    same(raws(1));
    same(raws(2));
    same(raws(16));
    same(raws(17));
    same(raws(70));
  });

  it("li dà uguali anche oltre il tetto dei caratteri di un lotto", () => {
    same(raws(9, 5000));
    same(raws(5, 40_000));
  });

  it("dà null se un frammento da solo non è un elemento", () => {
    for (const bad of ["<rect", "<rect/><rect/>", " <rect/>", "<rect/> ", "testo", "<!-- c --><rect/>", "<a></b>", "</fub-fragment><rect/><fub-fragment>"]) {
      expect(parseFragment(bad, scope)).toBeNull();
      expect(parseFragments([rect(1, ""), bad, rect(2, "")], scope)).toBeNull();
      expect(parseFragments([bad], scope)).toBeNull();
    }
  });

  it("dà null se letti insieme si dividono in altro modo, anche se il testo è ben formato", () => {
    expect(parseFragments(["<g>", "</g>"], scope)).toBeNull();
    expect(parseFragments(["<g><rect/>", "<rect/></g>"], scope)).toBeNull();
    expect(parseFragments(["<rect/><rect/>", ""], scope)).toBeNull();
    // Uno vuoto non lascia traccia nel testo letto, ma è un frammento in meno.
    expect(parseFragments([rect(1, ""), ""], scope)).toBeNull();
    expect(parseFragments(["", rect(1, "")], scope)).toBeNull();
    expect(parseFragments([rect(1, ""), "", rect(2, "")], scope)).toBeNull();
    // Un frammento in due: dentro un lotto lungo.
    const list = raws(40);
    list.splice(20, 1, list[20]!.slice(0, 10), list[20]!.slice(10));
    expect(parseFragments(list, scope)).toBeNull();
  });
});
