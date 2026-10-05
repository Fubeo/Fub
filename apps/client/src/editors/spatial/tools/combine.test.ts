// Le operazioni booleane sul documento: la forma più in basso diventa il
// tracciato del risultato, con il suo id, il suo stile e il suo posto, le
// altre se ne vanno, e un annulla riporta tutto al byte.

import { describe, expect, it } from "vitest";
import { doc, HEAD } from "../scene/test-support";
import type { BooleanKind } from "./boolean";
import { combineOps, type Combined, type Refused } from "./combine";
import { gesture, NewIds } from "./edit";
import { LAYER, open, type Opened } from "./test-support";

const ids = (opened: Opened): NewIds => new NewIds((id) => opened.engine.holder(id) !== null);

const STYLE = 'fill="#ff0000" stroke="#000000" stroke-width="2"';
const INKSCAPE = "http://www.inkscape.org/namespaces/inkscape";

/// L'operazione `kind` su `keys`, o su tutti gli oggetti del disegno.
function combined(opened: Opened, kind: BooleanKind, keys?: readonly string[]): Combined | Refused {
  const units = keys === undefined ? opened.index.units : keys.map((key) => opened.index.get(key)!);
  return combineOps(opened.engine.model!, units, kind, ids(opened));
}

/// Scrive `change`, verifica che un annulla riporti il testo di prima, e
/// torna il testo di dopo.
function written(opened: Opened, change: Combined | Refused): string {
  if ("reason" in change) throw new Error(`rifiutata: ${change.reason}`);
  const before = opened.engine.text;
  const outcome = opened.engine.apply(gesture(change.ops)!);
  if (outcome.outcome !== "applied") throw new Error(`rifiutato: ${outcome.detail}`);
  const after = opened.engine.text;
  expect(opened.engine.undo(outcome.undo).outcome).toBe("applied");
  expect(opened.engine.text).toBe(before);
  expect(opened.engine.apply(gesture(change.ops)!).outcome).toBe("applied");
  return after;
}

/// L'operazione su `body`, nel livello, scritta: il testo di dopo e il
/// comando.
function run(body: string, kind: BooleanKind, keys?: readonly string[]): { text: string; change: Combined } {
  const opened = open(doc(`${LAYER}${body}</g>`));
  const change = combined(opened, kind, keys);
  return { text: written(opened, change), change: change as Combined };
}

describe("le operazioni booleane sul documento", () => {
  const PAIR = `\n<rect id="a" x="0" y="0" width="10" height="10" ${STYLE}/>\n<rect id="b" x="5" y="5" width="10" height="10" fill="#0000ff"/>\n<rect id="c" x="50" y="50" width="1" height="1"/>\n`;

  it("l'unione fa della forma più in basso il tracciato del risultato, e le altre se ne vanno", () => {
    const { text, change } = run(PAIR, "union", ["a", "b"]);
    expect(text).toContain(
      `${LAYER}\n<path id="a" d="M0 0 L10 0 L10 5 L15 5 L15 15 L5 15 L5 10 L0 10 Z" ${STYLE}/>\n<rect id="c" x="50" y="50" width="1" height="1"/>\n</g>`,
    );
    expect(change).toMatchObject({ keys: ["a"], pieces: 1 });
  });

  it("la differenza, l'intersezione e l'esclusione", () => {
    expect(run(PAIR, "difference", ["a", "b"]).text).toContain(`<path id="a" d="M0 0 L10 0 L10 5 L5 5 L5 10 L0 10 Z" ${STYLE}/>`);
    expect(run(PAIR, "intersection", ["a", "b"]).text).toContain(`<path id="a" d="M10 10 L5 10 L5 5 L10 5 Z" ${STYLE}/>`);
    expect(run(PAIR, "exclusion", ["a", "b"]).text).toContain(
      `<path id="a" d="M0 0 L10 0 L10 5 L5 5 L5 10 L0 10 Z M10 10 L10 5 L15 5 L15 15 L5 15 L5 10 Z" ${STYLE}/>`,
    );
  });

  it("la divisione: il primo pezzo prende il posto della forma, gli altri le stanno sopra col suo stile", () => {
    const opened = open(
      `${HEAD}\n  ${LAYER}\n    <circle id="a" cx="10" cy="10" r="10" ${STYLE}><title>Torta</title></circle>\n    <line id="b" x1="-5" y1="10" x2="25" y2="10" stroke="#000000"/>\n  </g>\n</svg>\n`,
    );
    const change = combined(opened, "division") as Combined;
    const text = written(opened, change);
    const piece = change.keys[1]!;
    expect(change).toMatchObject({ keys: ["a", piece], pieces: 2 });
    expect(text).toBe(
      `${HEAD}\n  ${LAYER}\n    <path id="a" d="M20 10 A10 10 0 0 1 10 20 A10 10 0 0 1 0 10 Z" ${STYLE}>\n      <title>Torta</title>\n    </path>\n    <path id="${piece}" d="M20 10 L0 10 A10 10 0 0 1 10 0 A10 10 0 0 1 20 10 Z" ${STYLE}/>\n  </g>\n</svg>\n`,
    );
  });

  it("i pezzi stanno ciascuno sopra il precedente, nell'ordine dei nodi da cui cominciano, e ognuno è scelto", () => {
    const opened = open(
      doc(`${LAYER}<path id="a" d="M0 0 L30 0 L30 10 L0 10 Z" ${STYLE}/><line id="b" x1="10" y1="-5" x2="10" y2="15"/><line id="c" x1="20" y1="-5" x2="20" y2="15"/></g>`),
    );
    const change = combined(opened, "division") as Combined;
    const [, second, third] = change.keys;
    expect(change).toMatchObject({ keys: ["a", second, third], pieces: 3 });
    // Il pezzo di mezzo non ha nodi della forma: viene dopo.
    expect(written(opened, change)).toContain(
      `${LAYER}<path id="a" d="M0 0 L10 0 L10 10 L0 10 Z" ${STYLE}/>\n<path id="${second}" d="M30 0 L30 10 L20 10 L20 0 Z" ${STYLE}/>\n<path id="${third}" d="M10 0 L20 0 L20 10 L10 10 Z" ${STYLE}/></g>`,
    );
  });

  it("mette i pezzi accanto alla forma più in basso, anche se le altre stanno su un altro livello", () => {
    const opened = open(doc(`${LAYER}<rect id="a" x="0" y="0" width="20" height="10"/></g><g id="l2" fub:layer="Livello 2"><line id="b" x1="10" y1="-5" x2="10" y2="15"/></g>`));
    const change = combined(opened, "division") as Combined;
    expect(written(opened, change)).toContain(
      `${LAYER}\n<path id="a" d="M0 0 L10 0 L10 10 L0 10 Z"/>\n<path id="${change.keys[1]}" d="M20 0 L20 10 L10 10 L10 0 Z"/></g><g id="l2" fub:layer="Livello 2"></g>`,
    );
  });

  it("porta le altre forme nelle coordinate della più in basso, con le loro trasformazioni e quelle dei livelli", () => {
    const opened = open(
      doc(`${LAYER}<rect id="a" x="0" y="0" width="10" height="10" transform="translate(10 0)"/></g><g id="l2" fub:layer="Livello 2" transform="translate(0 5)"><rect id="b" x="15" y="0" width="10" height="10"/></g>`),
    );
    const text = written(opened, combined(opened, "union"));
    expect(text).toContain('<path id="a" d="M0 0 L10 0 L10 5 L15 5 L15 15 L5 15 L5 10 L0 10 Z" transform="translate(10 0)"/></g><g id="l2" fub:layer="Livello 2" transform="translate(0 5)"></g>');
  });

  it("cambia di un tracciato solo `d`, e a un tratto toglie l'inchiostro", () => {
    const opened = open(
      doc(`${LAYER}<path id="s" fub:tool="pen" d="M0 0 L10 0 L10 10 Z" fill="#000000" fub:ink="1 s100 cxypt 0,0,128,0 25,-3,2,8"/><circle id="c" cx="10" cy="10" r="3"/></g>`),
    );
    const change = combined(opened, "union") as Combined;
    expect(change.ops[0]).toEqual({
      op: "set",
      id: "s",
      attrs: { "fub:tool": null, "fub:ink": null, d: "M0 0 L10 0 L10 7 A3 3 0 0 1 13 10 A3 3 0 0 1 10 13 A3 3 0 0 1 7 10 A3 3 0 0 1 7.88 7.88 Z" },
    });
    expect(written(opened, change)).toContain(
      `${LAYER}<path id="s" d="M0 0 L10 0 L10 7 A3 3 0 0 1 13 10 A3 3 0 0 1 10 13 A3 3 0 0 1 7 10 A3 3 0 0 1 7.88 7.88 Z" fill="#000000"/></g>`,
    );
  });

  it("riempie ogni forma con nonzero, come la dipinge il painter, anche da un altro livello", () => {
    const twice = "M0 0 L20 0 L20 20 L0 20 Z M10 10 L30 10 L30 30 L10 30 Z";
    const opened = open(doc(`${LAYER}<path id="a" d="${twice}"/></g><g id="l2" fub:layer="Livello 2" transform="translate(100 0)"><path id="b" d="${twice}"/></g>`));
    const outline = (x: number): string => `M${x} 0 L${x + 20} 0 L${x + 20} 10 L${x + 30} 10 L${x + 30} 30 L${x + 10} 30 L${x + 10} 20 L${x} 20 Z`;
    expect(written(opened, combined(opened, "union"))).toContain(`<path id="a" d="${outline(0)} ${outline(100)}"/>`);
  });

  it("riscrive com'era una curva che passa intera nel risultato", () => {
    const { text } = run(`<path id="a" d="M0 0 A10 10 0 0 1 20 0 Z"/><rect id="b" x="5" y="0" width="10" height="5"/>`, "union");
    expect(text).toContain(`<path id="a" d="M0 0 A10 10 0 0 1 20 0 L15 0 L15 5 L5 5 L5 0 Z"/>`);
  });

  it("lascia com'è un tracciato che l'unione con sé stesso non cambia", () => {
    const opened = open(doc(`${LAYER}<path id="p" d="M0 0 L10 0 L10 10 Z"/></g>`));
    expect(combined(opened, "union")).toEqual({ ops: [], keys: ["p"], pieces: 1 });
  });

  it("dà un id alle forme che non ne hanno", () => {
    const opened = open(doc(`${LAYER}<rect x="0" y="0" width="10" height="10"/><rect x="5" y="5" width="10" height="10"/></g>`));
    const change = combined(opened, "union") as Combined;
    const text = written(opened, change);
    expect(text).toMatch(new RegExp(`${LAYER}\\s*<path id="${change.keys[0]}" d="M0 0 L10 0 L10 5 L15 5 L15 15 L5 15 L5 10 L0 10 Z"/></g>`));
    expect(opened.reindex().units.map((unit) => unit.key)).toEqual(change.keys);
  });

  it("tiene della forma più in basso il titolo e gli attributi di altri programmi; i pezzi nuovi solo lo stile", () => {
    const source = doc(
      `${LAYER}<rect id="a" inkscape:label="Porta" x="0" y="0" width="10" height="10" ${STYLE} opacity="0.5"><title>Porta</title></rect><line id="b" x1="5" y1="-5" x2="5" y2="15"/></g>`,
    ).replace("<svg ", `<svg xmlns:inkscape="${INKSCAPE}" `);
    const opened = open(source);
    const change = combined(opened, "division") as Combined;
    const text = written(opened, change);
    expect(text).toContain(`<path id="a" d="M0 0 L5 0 L5 10 L0 10 Z" ${STYLE} opacity="0.5" inkscape:label="Porta">\n  <title>Porta</title>\n</path>`);
    expect(text).toContain(`<path id="${change.keys[1]}" d="M10 0 L10 10 L5 10 L5 0 Z" ${STYLE} opacity="0.5"/>`);
  });
});

describe("le operazioni booleane che non si fanno", () => {
  it("chiedono forme: gruppi, collegamenti, testi e immagini no", () => {
    const opened = open(
      doc(`${LAYER}<rect id="a" x="0" y="0" width="10" height="10"/><g id="g"><rect x="0" y="0" width="1" height="1"/></g><text id="t" x="0" y="20"><tspan x="0" dy="0">Ciao</tspan></text></g>`),
    );
    expect(combined(opened, "union")).toEqual({ reason: "not_shapes", count: 2 });
  });

  it("chiedono due forme, o una per l'unione", () => {
    const opened = open(doc(`${LAYER}<rect id="a" x="0" y="0" width="10" height="10"/></g>`));
    for (const kind of ["difference", "intersection", "exclusion", "division"] as const) expect(combined(opened, kind)).toEqual({ reason: "few" });
    expect(combined(opened, "union")).toMatchObject({ keys: ["a"], pieces: 1 });
  });

  it("non cambiano niente se il risultato è vuoto, o se la divisione non divide", () => {
    const opened = open(doc(`${LAYER}<rect id="a" x="0" y="0" width="10" height="10"/><rect id="b" x="20" y="0" width="10" height="10"/></g>`));
    expect(combined(opened, "intersection")).toEqual({ reason: "empty" });
    expect(combined(opened, "division")).toEqual({ reason: "whole" });
    const covered = open(doc(`${LAYER}<rect id="a" x="0" y="0" width="10" height="10"/><rect id="b" x="-5" y="-5" width="20" height="20"/></g>`));
    expect(combined(covered, "difference")).toEqual({ reason: "empty" });
  });

  it("non riscrivono una forma con un prefisso dichiarato su sé stessa", () => {
    const opened = open(
      doc(`${LAYER}<rect xmlns:inkscape="${INKSCAPE}" id="a" inkscape:label="Porta" x="0" y="0" width="10" height="10"/><rect id="b" x="5" y="5" width="10" height="10"/></g>`),
    );
    expect(combined(opened, "union")).toEqual({ reason: "foreign" });
  });

  it("non risolvono una forma più in basso schiacciata in un punto, né numeri troppo grandi", () => {
    const flat = open(doc(`${LAYER}<rect id="a" x="0" y="0" width="10" height="10" transform="scale(0)"/><rect id="b" x="5" y="0" width="10" height="10"/></g>`));
    expect(combined(flat, "union")).toEqual({ reason: "failed" });
    // Il risultato uscirebbe dai numeri del formato.
    const beyond = open(doc(`${LAYER}<rect id="a" x="0" y="0" width="20" height="20" transform="scale(0.0000000001)"/><rect id="b" x="0" y="0" width="1e30" height="1e30"/></g>`));
    expect(combined(beyond, "union")).toEqual({ reason: "failed" });
    // Il calcolo stesso non regge.
    const huge = open(
      doc(`${LAYER.replace(">", ' transform="scale(1e-38)">')}<rect id="a" x="0" y="0" width="20" height="20" transform="scale(1e-38)"/></g><g id="l2" fub:layer="Livello 2" transform="scale(1e38)"><rect id="b" x="0" y="0" width="3e38" height="3e38" transform="scale(1e38)"/></g>`),
    );
    expect(combined(huge, "union")).toEqual({ reason: "failed" });
  });
});
