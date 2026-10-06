// Gli attributi del pannello dell'Esperto: le righe di un oggetto, i valori
// come li scrive il file, le operazioni che il motore accetta così come sono,
// e le regole dell'id.

import { describe, expect, it } from "vitest";
import { doc } from "../scene/test-support";
import { gesture, NewIds } from "./edit";
import {
  attributeOps,
  canonicalValue,
  cites,
  EDIT_LIMIT,
  idProblem,
  initialValue,
  MAX_ID_LENGTH,
  renameOps,
  subjectOf,
  type Subject,
} from "./attributes";
import { nodeOf } from "./arrange";
import { arrowPath } from "./shapes";
import { LAYER, open, type Opened } from "./test-support";

const INK = "1 s100 cxypt 12050,3020,128,0 25,-3,2,8 31,-5,0,8";
const BRUSH = "pf1 size=4 thinning=0.5 smoothing=0.5 streamline=0.5 taperStart=0 taperEnd=0 capStart=1 capEnd=1 sim=0";
const INKSCAPE = "http://www.inkscape.org/namespaces/inkscape";

const ids = (opened: Opened): NewIds => new NewIds((id) => opened.engine.holder(id) !== null);

/// Il primo oggetto del primo livello.
function first(opened: Opened): Subject {
  return subjectOf(nodeOf(opened.engine.model!, { path: [0, 0] }))!;
}

/// Applica `ops` in un gesto e torna il testo; un annulla deve riportare
/// quello di prima.
function applied(opened: Opened, ops: Parameters<typeof gesture>[0]): string {
  const before = opened.engine.text;
  const outcome = opened.engine.apply(gesture(ops)!);
  if (outcome.outcome !== "applied") throw new Error(`rifiutato: ${outcome.detail}`);
  const after = opened.engine.text;
  expect(opened.engine.undo(outcome.undo).outcome).toBe("applied");
  expect(opened.engine.text, "l'annulla").toBe(before);
  expect(opened.engine.apply(gesture(ops)!).outcome).toBe("applied");
  return after;
}

describe("le righe", () => {
  it("sono gli attributi scritti, nell'ordine canonico, senza id e senza dichiarazioni", () => {
    const opened = open(doc(`${LAYER}<rect xmlns:inkscape="${INKSCAPE}" inkscape:label="Sole" fill="red" id="oaaaaaaaa" height="10" x="1" width="2mm" y="2"/></g>`));
    const subject = first(opened);
    expect(subject).toMatchObject({ tag: "rect", role: "rect", id: "oaaaaaaaa", path: [0, 0], arrow: null });
    expect(subject.rows.map(({ key, value, note }) => [key, value, note])).toEqual([
      ["x", "1", null],
      ["y", "2", null],
      ["width", "2mm", null],
      ["height", "10", null],
      ["fill", "red", null],
      ["inkscape:label", "Sole", "namespace"],
    ]);
    expect(subject.addable).toEqual([
      "rx",
      "ry",
      "fill-opacity",
      "stroke",
      "stroke-width",
      "stroke-opacity",
      "stroke-linecap",
      "stroke-linejoin",
      "stroke-dasharray",
      "opacity",
      "display",
      "transform",
    ]);
  });

  it("si leggono soltanto dove il valore ha un padrone: l'inchiostro, FubDraw, i comandi", () => {
    const stroke = `<path id="oaaaaaaaa" fub:tool="pen" fub:brush="${BRUSH}" d="M0 0 Z" fill="#000000" fub:ink="${INK}"/>`;
    const subject = first(open(doc(`${LAYER}${stroke}</g>`)));
    expect(subject.role).toBe("stroke");
    expect(subject.rows.map(({ key, note }) => [key, note])).toEqual([
      ["fub:tool", "fubdraw"],
      ["fub:brush", "fubdraw"],
      ["d", "ink"],
      ["fill", null],
      ["fub:ink", "fubdraw"],
    ]);
    // Un tratto è tutto riempimento.
    expect(subject.addable).toEqual(["fill-opacity", "opacity", "display", "transform"]);

    const link = first(open(doc(`${LAYER}<a id="oaaaaaaaa" href="Note.md"><rect id="obbbbbbbb" width="1" height="1"/></a></g>`)));
    expect(link.rows).toEqual([{ key: "href", value: "Note.md", note: "link", field: { kind: "line" } }]);
    expect(link.addable).toContain("font-family");
    expect(link.addable).not.toContain("x");

    const image = first(open(doc(`${LAYER}<image id="oaaaaaaaa" width="4" height="4" xlink:href="foto.png"/></g>`)));
    expect(image.rows[image.rows.length - 1]).toMatchObject({ key: "xlink:href", note: "image" });
    expect(image.addable).toEqual(["x", "y", "opacity", "display", "preserveAspectRatio", "transform"]);
  });

  it("una freccia e un poligono regolare hanno il d dalla loro geometria; la freccia, niente riempimento", () => {
    const arrow = `<path id="oaaaaaaaa" fub:shape="arrow" fub:geom="0 0 100 0" d="${arrowPath(0, 0, 100, 0, 2)}" fill="none" stroke="#000000" stroke-width="2"/>`;
    const subject = first(open(doc(`${LAYER}${arrow}</g>`)));
    expect(subject.arrow).toEqual([0, 0, 100, 0]);
    expect(subject.rows.find((row) => row.key === "d")!.note).toBe("arrow");
    expect(subject.addable).not.toContain("fill-opacity");
    // Una freccia con una geometria che non si legge è un tracciato.
    const plain = first(open(doc(`${LAYER}${arrow.replace("0 0 100 0", "0 0 100")}</g>`)));
    expect(plain).toMatchObject({ role: "path", arrow: null });
    // Il `d` di un poligono regolare viene dai suoi parametri.
    const square = first(open(doc(`${LAYER}<path id="oaaaaaaaa" fub:shape="polygon" fub:geom="0 0 10 4 0 0" d="M-7.07 7.07 L-7.07 -7.07 L7.07 -7.07 L7.07 7.07 Z"/></g>`)));
    expect(square.role).toBe("ngon");
    expect(square.rows.find((row) => row.key === "d")!.note).toBe("shape");
    expect(square.addable).toContain("fill");
    expect(plain.rows.find((row) => row.key === "d")!.note).toBeNull();
  });

  it("le parole chiave e i caratteri si scelgono, e un carattere letto resta fra le scelte", () => {
    const opened = open(doc(`${LAYER}<text id="oaaaaaaaa" x="0" y="10" font-family="Georgia" font-weight="bold" text-anchor="end"><tspan x="0" dy="0">Ciao</tspan></text></g>`));
    const fields = Object.fromEntries(first(opened).rows.map((row) => [row.key, row.field]));
    expect(fields["font-family"]).toEqual({ kind: "choice", options: ["Inter, sans-serif", "Literata, serif", "JetBrains Mono, monospace", "Georgia"] });
    expect(fields["font-weight"]).toEqual({ kind: "choice", options: ["normal", "bold", "100", "200", "300", "400", "500", "600", "700", "800", "900"] });
    expect(fields["text-anchor"]).toEqual({ kind: "choice", options: ["start", "middle", "end"] });
    expect(fields.x).toEqual({ kind: "line" });
  });

  it("d e points si scrivono su più righe, e un valore enorme si legge soltanto", () => {
    const long = `M0 0${" L1 1".repeat(EDIT_LIMIT / 5)}`;
    const path = first(open(doc(`${LAYER}<path id="oaaaaaaaa" d="M0 0 L1 1"/></g>`)));
    expect(path.rows[0]).toMatchObject({ key: "d", note: null, field: { kind: "area" } });
    const huge = first(open(doc(`${LAYER}<path id="oaaaaaaaa" d="${long}"/></g>`)));
    expect(huge.rows[0]).toMatchObject({ key: "d", note: "long" });
  });

  it("un oggetto che non cambia si rilegge una volta sola", () => {
    const opened = open(doc(`${LAYER}<rect id="oaaaaaaaa" width="1" height="1"/><rect id="obbbbbbbb" width="1" height="1"/></g>`));
    const before = first(opened);
    expect(first(opened)).toBe(before);
    applied(opened, attributeOps(subjectOf(nodeOf(opened.engine.model!, { path: [0, 1] }))!, "fill", "#ff0000", ids(opened)).ops);
    expect(first(opened), "l'altro rettangolo").toBe(before);
    applied(opened, attributeOps(before, "fill", "#ff0000", ids(opened)).ops);
    const rows = first(opened).rows;
    expect(rows[rows.length - 1]).toMatchObject({ key: "fill", value: "#ff0000" });
  });
});

describe("i valori", () => {
  const cases: ReadonlyArray<readonly [key: string, input: string, out: string | null | { problem: string }]> = [
    ["fill", "0072B2", "#0072b2"],
    ["fill", "#abc", "#aabbcc"],
    ["fill", "red", "#ff0000"],
    ["stroke", " none ", "none"],
    ["fill", "RED", { problem: "paint" }],
    ["fill", "url(#g)", { problem: "paint" }],
    ["x", "1in", "96"],
    ["x", "-1.234", "-1.23"],
    ["x", "10%", { problem: "length" }],
    ["width", "-1", { problem: "size" }],
    ["width", "1e38in", { problem: "size" }],
    ["opacity", "0.12345", "0.1235"],
    ["opacity", "2", { problem: "opacity" }],
    ["stroke-dasharray", "4,2  1mm", "4 2 3.78"],
    ["stroke-dasharray", "none", "none"],
    ["stroke-dasharray", "4,,2", { problem: "dashes" }],
    ["stroke-linecap", "round", "round"],
    ["stroke-linecap", "Round", { problem: "keyword" }],
    ["font-family", "Literata, serif", "Literata, serif"],
    ["font-family", "Comic Sans MS", { problem: "family" }],
    ["transform", "translate(10 20)", "matrix(1 0 0 1 10 20)"],
    ["transform", "rotate(0)", null],
    ["transform", "skewQ(1)", { problem: "transform" }],
    ["points", "0,0 10 0 10,10", "0,0 10,0 10,10"],
    ["points", "1 2 3", { problem: "points" }],
    ["d", "m0 0 l10 10z", "M0 0 L10 10 Z"],
    ["d", "M0", { problem: "path" }],
    ["preserveAspectRatio", "xMidYMid \t slice", "xMidYMid slice"],
    ["preserveAspectRatio", "middle", { problem: "aspect" }],
    ["fill", "", { problem: "empty" }],
    ["fill", "  ", { problem: "empty" }],
  ];

  it.each(cases)("%s = %j", (key, input, out) => {
    const tag = key === "points" ? "polygon" : key === "d" ? "path" : key === "preserveAspectRatio" ? "image" : "rect";
    expect(canonicalValue(tag, key, input)).toEqual(out !== null && typeof out === "object" ? out : { value: out });
  });

  it("un attributo nuovo parte dal valore iniziale di SVG", () => {
    expect(
      ["fill", "stroke", "stroke-width", "opacity", "display", "stroke-linecap", "stroke-linejoin", "font-weight", "text-anchor", "font-size", "rx", "transform"].map(initialValue),
    ).toEqual(["#000000", "none", "1", "1", "inline", "butt", "miter", "normal", "start", "16", "0", ""]);
  });
});

describe("le operazioni", () => {
  it("un oggetto senza id ne riceve uno, nello stesso gesto", () => {
    const opened = open(doc(`${LAYER}<rect width="10" height="10"/></g>`));
    const change = attributeOps(first(opened), "fill", "#0072b2", ids(opened));
    expect(change.ops).toEqual([
      { op: "ident", path: [0, 0], tag: "rect", id: change.id },
      { op: "set", id: change.id, attrs: { fill: "#0072b2" } },
    ]);
    expect(applied(opened, change.ops)).toContain(`<rect id="${change.id}" width="10" height="10" fill="#0072b2"/>`);
  });

  it("una freccia a cui cambia lo spessore ridisegna la punta, anche quando lo si toglie", () => {
    const arrow = `<path id="oaaaaaaaa" fub:shape="arrow" fub:geom="0 0 100 0" d="${arrowPath(0, 0, 100, 0, 2)}" fill="none" stroke="#000000" stroke-width="2"/>`;
    const opened = open(doc(`${LAYER}${arrow}</g>`));
    const wider = attributeOps(first(opened), "stroke-width", "6", ids(opened));
    expect(wider.ops).toEqual([{ op: "set", id: "oaaaaaaaa", attrs: { "stroke-width": "6", d: arrowPath(0, 0, 100, 0, 6) } }]);
    applied(opened, wider.ops);
    const gone = attributeOps(first(opened), "stroke-width", null, ids(opened));
    expect(gone.ops).toEqual([{ op: "set", id: "oaaaaaaaa", attrs: { "stroke-width": null, d: arrowPath(0, 0, 100, 0, 1) } }]);
    applied(opened, gone.ops);
  });

  it("un id si cambia togliendo il vecchio, e l'annulla lo rimette com'era", () => {
    const opened = open(doc(`${LAYER}<rect id='rect12' width="10" height="10"/></g>`));
    const ops = renameOps(first(opened), "sole");
    expect(ops).toEqual([
      { op: "ident", path: [0, 0], tag: "rect", id: null },
      { op: "ident", path: [0, 0], tag: "rect", id: "sole" },
    ]);
    expect(applied(opened, ops)).toContain('<rect id="sole" width="10" height="10"/>');

    const bare = open(doc(`${LAYER}<rect width="10" height="10"/></g>`));
    expect(renameOps(first(bare), "sole")).toEqual([{ op: "ident", path: [0, 0], tag: "rect", id: "sole" }]);
  });
});

describe("l'id", () => {
  const opened = open(doc(`${LAYER}<rect id="oaaaaaaaa" width="1" height="1"/><rect id="obbbbbbbb" width="1" height="1"/></g>`));
  const subject = first(opened);
  const taken = (id: string): boolean => opened.engine.holder(id) !== null;
  const never = (): boolean => false;

  it.each([
    ["", "empty"],
    ["a".repeat(MAX_ID_LENGTH + 1), "long"],
    ["1sole", "form"],
    ["un sole", "form"],
    ["sole:1", "form"],
    ["-sole", "form"],
    ["fub-paper", "reserved"],
    ["FUB-sole", "reserved"],
    ["obbbbbbbb", "taken"],
  ])("%j è %s", (next, problem) => {
    expect(idProblem(subject, next, taken, never)).toBe(problem);
  });

  it.each(["sole", "_sole", "città.1", "Été-2", "a".repeat(MAX_ID_LENGTH), "oaaaaaaaa"])("%j va bene", (next) => {
    expect(idProblem(subject, next, taken, never)).toBeNull();
  });

  it("un id citato da una parte estranea non si cambia", () => {
    expect(idProblem(subject, "sole", taken, (id) => id === "oaaaaaaaa")).toBe("cited");
    expect(idProblem(subject, "oaaaaaaaa", taken, () => true), "lo stesso id").toBeNull();
  });

  it.each([
    ['<use href="#oaaaaaaaa"/>', true],
    ["<use xlink:href='#oaaaaaaaa'/>", true],
    ['<rect fill="url(#oaaaaaaaa)"/>', true],
    ["<style>#oaaaaaaaa{fill:red}</style>", true],
    ['<use href="#oaaaaaaaab"/>', false],
    ['<use href="#oaaaaaaaa-2"/>', false],
    ['<use href="#oaaaaaaa"/>', false],
    ["oaaaaaaaa", false],
  ])("%s cita oaaaaaaaa: %s", (text, expected) => {
    expect(cites(text, "oaaaaaaaa")).toBe(expected);
  });
});
