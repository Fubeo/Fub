// Il Costruttore di forme sul documento: le regioni delle forme scelte si
// uniscono, si tolgono e si separano, ogni forma che le copriva le perde, e
// un annulla riporta tutto al byte.

import { describe, expect, it } from "vitest";
import { doc, HEAD } from "../scene/test-support";
import { builderOf, buildOps, type Builder, type BuildRefused, type BuiltOps } from "./builder";
import { gesture, NewIds } from "./edit";
import { LAYER, open, type Opened } from "./test-support";

const ids = (opened: Opened): NewIds => new NewIds((id) => opened.engine.holder(id) !== null);

const RED = 'fill="#ff0000" stroke="#000000" stroke-width="2"';
const BLUE = 'fill="#0000ff"';
const INKSCAPE = "http://www.inkscape.org/namespaces/inkscape";

/// Il Costruttore su `keys`, o su tutti gli oggetti del disegno.
function builder(opened: Opened, keys?: readonly string[]): Builder {
  const units = keys === undefined ? opened.index.units : keys.map((key) => opened.index.get(key)!);
  return builderOf(opened.engine.model!, units) as Builder;
}

/// Le forme che coprono ogni regione di `found`.
const covers = (found: Builder): number[][] => found.regions.regions.map((region) => [...region.cover]);

/// Unisce, o con `erase` toglie, le regioni `chosen`.
function built(opened: Opened, chosen: readonly number[], erase = false, keys?: readonly string[]): BuiltOps | BuildRefused {
  return buildOps(opened.engine.model!, builder(opened, keys), chosen, erase, ids(opened));
}

/// Scrive `change`, verifica che un annulla riporti il testo di prima, e
/// torna il testo di dopo.
function written(opened: Opened, change: BuiltOps | BuildRefused): string {
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

const PAIR = `<rect id="a" x="0" y="0" width="10" height="10" ${RED}/><rect id="b" x="5" y="5" width="10" height="10" ${BLUE}/>`;

describe("le regioni delle forme scelte", () => {
  it("due rettangoli fanno tre regioni, da sinistra, con le forme che le coprono", () => {
    const opened = open(doc(`${LAYER}${PAIR}</g>`));
    expect(covers(builder(opened))).toEqual([[0], [0, 1], [1]]);
  });

  it("una linea taglia soltanto, e una forma chiusa senza riempimento racchiude", () => {
    const opened = open(
      doc(`${LAYER}<rect id="a" x="0" y="0" width="10" height="10"/><line id="b" x1="-5" y1="5" x2="15" y2="5" stroke="#000000"/><circle id="c" cx="20" cy="5" r="4" fill="none" stroke="#000000"/></g>`),
    );
    const found = builder(opened);
    expect(found.cuts).toEqual([false, true, false]);
    expect(covers(found)).toEqual([[0], [0], [2]]);
  });

  it("i gruppi, i testi e le immagini scelti restano fuori", () => {
    const opened = open(doc(`${LAYER}${PAIR}<g id="g"><rect x="0" y="0" width="1" height="1"/></g><text id="t" x="0" y="20"><tspan x="0" dy="0">Ciao</tspan></text></g>`));
    const found = builder(opened);
    expect(found.shapes.map((unit) => unit.key)).toEqual(["a", "b"]);
    expect(found.selected.map((unit) => unit.key)).toEqual(["a", "b", "g", "t"]);
  });
});

describe("unire, separare e togliere", () => {
  it("unire due regioni che fanno una forma intera la lascia com'è, e l'altra le perde", () => {
    const opened = open(doc(`${LAYER}${PAIR}</g>`));
    const change = built(opened, [0, 1]) as BuiltOps;
    expect(written(opened, change)).toBe(doc(`${LAYER}<rect id="a" x="0" y="0" width="10" height="10" ${RED}/>\n<path id="b" d="M10 10 L10 5 L15 5 L15 15 L5 15 L5 10 Z" ${BLUE}/></g>`));
    expect(change).toMatchObject({ keys: ["a", "b"], removed: 0 });
  });

  it("separare una regione la fa una forma nuova, con lo stile della forma più in alto, subito sopra", () => {
    const opened = open(doc(`${LAYER}${PAIR}</g>`));
    const change = built(opened, [1]) as BuiltOps;
    const piece = change.keys[2]!;
    expect(change.keys).toEqual(["a", "b", piece]);
    expect(written(opened, change)).toBe(
      doc(
        `${LAYER}\n<path id="a" d="M0 0 L10 0 L10 5 L5 5 L5 10 L0 10 Z" ${RED}/>\n<path id="b" d="M10 10 L10 5 L15 5 L15 15 L5 15 L5 10 Z" ${BLUE}/>\n<path id="${piece}" d="M10 10 L5 10 L5 5 L10 5 Z" ${BLUE}/></g>`,
      ),
    );
  });

  it("l'unione prende lo stile della prima regione; la forma che finisce tutta lì diventa l'unione, e le altre se ne vanno", () => {
    const opened = open(doc(`${LAYER}${PAIR}</g>`));
    const change = built(opened, [2, 1, 0]) as BuiltOps;
    expect(change).toMatchObject({ keys: ["b"], removed: 1 });
    expect(written(opened, change)).toBe(doc(`${LAYER}\n<path id="b" d="M0 0 L10 0 L10 5 L15 5 L15 15 L5 15 L5 10 L0 10 Z" ${BLUE}/></g>`));
  });

  it("togliere fa perdere le regioni alle forme che le coprono, e basta", () => {
    const opened = open(doc(`${LAYER}${PAIR}</g>`));
    const change = built(opened, [1], true) as BuiltOps;
    expect(change.keys).toEqual(["a", "b"]);
    expect(written(opened, change)).toBe(
      doc(`${LAYER}\n<path id="a" d="M0 0 L10 0 L10 5 L5 5 L5 10 L0 10 Z" ${RED}/>\n<path id="b" d="M10 10 L10 5 L15 5 L15 15 L5 15 L5 10 Z" ${BLUE}/></g>`),
    );
    // Togliere tutte le regioni di una forma la toglie.
    const all = built(open(doc(`${LAYER}${PAIR}</g>`)), [0, 1], true) as BuiltOps;
    expect(all).toMatchObject({ keys: ["b"], removed: 1 });
  });

  it("una linea divide una forma in due, e resta com'è", () => {
    const opened = open(
      doc(`${LAYER}<circle id="a" cx="10" cy="10" r="10" ${RED}><title>Torta</title></circle><line id="b" x1="-5" y1="10" x2="25" y2="10" stroke="#000000"/></g>`),
    );
    const change = built(opened, [0]) as BuiltOps;
    const piece = change.keys[1]!;
    expect(change.keys).toEqual(["a", piece, "b"]);
    expect(written(opened, change)).toBe(
      doc(
        `${LAYER}\n<path id="a" d="M20 10 A10 10 0 0 1 10 20 A10 10 0 0 1 0 10 Z" ${RED}>\n  <title>Torta</title>\n</path>\n<path id="${piece}" d="M20 10 L0 10 A10 10 0 0 1 10 0 A10 10 0 0 1 20 10 Z" ${RED}/><line id="b" x1="-5" y1="10" x2="25" y2="10" stroke="#000000"/></g>`,
      ),
    );
  });

  it("le curve restano curve", () => {
    const opened = open(doc(`${LAYER}<circle id="a" cx="10" cy="10" r="6" ${RED}/><rect id="b" x="0" y="0" width="10" height="10" ${BLUE}/></g>`));
    const change = built(opened, [1]) as BuiltOps;
    expect(written(opened, change)).toContain(`<path id="${change.keys[2]}" d="M4 10 A6 6 0 0 1 10 4 L10 10 Z" ${BLUE}/>`);
  });

  it("scrive ogni forma nelle sue coordinate, con le trasformazioni sue e dei livelli", () => {
    const opened = open(
      doc(`${LAYER}<rect id="a" x="0" y="0" width="10" height="10" transform="translate(10 0)"/></g><g id="l2" fub:layer="Livello 2" transform="translate(0 5)"><rect id="b" x="15" y="0" width="10" height="10"/></g>`),
    );
    const change = built(opened, [1]) as BuiltOps;
    const piece = change.keys[2]!;
    expect(written(opened, change)).toBe(
      doc(
        `${LAYER}\n<path id="a" d="M0 0 L10 0 L10 5 L5 5 L5 10 L0 10 Z" transform="translate(10 0)"/></g><g id="l2" fub:layer="Livello 2" transform="translate(0 5)">\n<path id="b" d="M20 5 L20 0 L25 0 L25 10 L15 10 L15 5 Z"/>\n<path id="${piece}" d="M20 5 L15 5 L15 0 L20 0 Z"/></g>`,
      ),
    );
  });

  it("dà un id alle forme che non ne hanno, perché restino scelte", () => {
    const opened = open(doc(`${LAYER}<rect x="0" y="0" width="10" height="10"/><rect x="5" y="5" width="10" height="10"/></g>`));
    const change = built(opened, [1], true) as BuiltOps;
    written(opened, change);
    expect(opened.reindex().units.map((unit) => unit.key)).toEqual(change.keys);
  });

  it("tiene della forma gli attributi di altri programmi; il pezzo nuovo prende solo lo stile", () => {
    const source = doc(`${LAYER}<rect id="a" inkscape:label="Porta" x="0" y="0" width="10" height="10" ${RED} opacity="0.5"/><line id="b" x1="5" y1="-5" x2="5" y2="15"/></g>`).replace(
      "<svg ",
      `<svg xmlns:inkscape="${INKSCAPE}" `,
    );
    const opened = open(source);
    const change = built(opened, [1]) as BuiltOps;
    const text = written(opened, change);
    expect(text).toContain(`<path id="a" d="M0 0 L5 0 L5 10 L0 10 Z" ${RED} opacity="0.5" inkscape:label="Porta"/>`);
    expect(text).toContain(`<path id="${change.keys[1]}" d="M10 0 L10 10 L5 10 L5 0 Z" ${RED} opacity="0.5"/>`);
  });
});

describe("le operazioni che non si fanno", () => {
  it("separare una forma sola, tutta intera, non cambia niente", () => {
    const opened = open(doc(`${LAYER}<rect id="a" x="0" y="0" width="10" height="10"/></g>`));
    expect(built(opened, [0])).toEqual({ reason: "whole" });
  });

  it("non riscrivono una forma con un prefisso dichiarato su sé stessa", () => {
    const opened = open(
      doc(`${LAYER}<rect xmlns:inkscape="${INKSCAPE}" id="a" inkscape:label="Porta" x="0" y="0" width="10" height="10"/><rect id="b" x="5" y="5" width="10" height="10"/></g>`),
    );
    expect(built(opened, [1], true)).toEqual({ reason: "foreign" });
  });

  it("non si fanno su una forma più in basso schiacciata in un punto", () => {
    const opened = open(doc(`${LAYER}<rect id="a" x="0" y="0" width="10" height="10" transform="scale(0)"/><rect id="b" x="5" y="0" width="10" height="10"/></g>`));
    expect(builderOf(opened.engine.model!, opened.index.units)).toBeNull();
  });

  it("rinunciano alle regioni di forme troppe o troppo complesse, prima di calcolarle", () => {
    // Trecento cerchi grandi fanno più di centomila pezzi di spezzata.
    const circles = Array.from({ length: 300 }, (_, i) => `<circle id="c${i}" cx="${(i % 20) * 7}" cy="${Math.floor(i / 20) * 7}" r="60" ${BLUE}/>`).join("");
    const opened = open(doc(`${LAYER}${circles}</g>`));
    expect(builderOf(opened.engine.model!, opened.index.units)).toBe("complex");
    expect(builderOf(opened.engine.model!, opened.index.units.slice(0, 20))).not.toBe("complex");
  });
});

describe("il documento indentato", () => {
  it("due regioni che si toccano in un punto fanno una forma di due anelli, e quella in mezzo resta alle due forme", () => {
    const opened = open(`${HEAD}\n  ${LAYER}\n    ${PAIR}\n  </g>\n</svg>\n`);
    const change = built(opened, [0, 2]) as BuiltOps;
    const piece = change.keys[1]!;
    expect(change.keys).toEqual(["a", piece, "b"]);
    expect(written(opened, change)).toBe(
      `${HEAD}\n  ${LAYER}\n    <path id="a" d="M10 10 L5 10 L5 5 L10 5 Z" ${RED}/>\n    <path id="${piece}" d="M0 0 L10 0 L10 5 L5 5 L5 10 L0 10 Z M10 10 L10 5 L15 5 L15 15 L5 15 L5 10 Z" ${RED}/>\n    <path id="b" d="M10 10 L5 10 L5 5 L10 5 Z" ${BLUE}/>\n  </g>\n</svg>\n`,
    );
  });
});
