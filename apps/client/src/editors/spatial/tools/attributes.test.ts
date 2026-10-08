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
  heldNamer,
  idProblem,
  initialValue,
  MAX_ID_LENGTH,
  renameOps,
  subjectOf,
  type Subject,
} from "./attributes";
import { nodeOf } from "./arrange";
import { followConnectors } from "./connectors";
import { followLabels } from "./labels";
import { estimate } from "./measure";
import type { Op } from "../scene/ops";
import { arrowPath } from "./shapes";
import { LAYER, open, type Opened } from "./test-support";
import { attrOf } from "./tip-support";

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

  it("un gruppo che un'operazione cambia sul posto si rilegge", () => {
    const opened = open(doc(`${LAYER}<g id="ogroup000"><rect id="oaaaaaaaa" width="1" height="1"/></g></g>`));
    const before = first(opened);
    expect(before.rows.some((row) => row.key === "fill")).toBe(false);
    applied(opened, attributeOps(before, "fill", "#ff0000", ids(opened)).ops);
    expect(first(opened).rows.find((row) => row.key === "fill")).toMatchObject({ value: "#ff0000" });
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
    ["font-style", "italic", "italic"],
    ["font-style", "Italic", { problem: "keyword" }],
    ["letter-spacing", " normal ", "normal"],
    ["letter-spacing", "-0.555", "-0.56"],
    ["letter-spacing", "1pt", "1.33"],
    ["letter-spacing", "10%", { problem: "spacing" }],
    ["letter-spacing", "0.1em", { problem: "spacing" }],
    ["text-decoration", "line-through   underline", "line-through underline"],
    ["text-decoration", "none", "none"],
    ["text-decoration", "underline underline", { problem: "decoration" }],
    ["text-decoration", "blink", { problem: "decoration" }],
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
    const tag = key === "points" ? "polygon" : key === "d" ? "path" : key === "preserveAspectRatio" ? "image" : key === "text-decoration" ? "text" : "rect";
    expect(canonicalValue(tag, key, input)).toEqual(out !== null && typeof out === "object" ? out : { value: out });
  });

  it("un attributo nuovo parte dal valore iniziale di SVG", () => {
    expect(
      ["fill", "stroke", "stroke-width", "opacity", "display", "stroke-linecap", "stroke-linejoin", "font-weight", "font-style", "letter-spacing", "text-decoration", "text-anchor", "font-size", "rx", "transform"].map(initialValue),
    ).toEqual(["#000000", "none", "1", "1", "inline", "butt", "miter", "normal", "normal", "normal", "none", "start", "16", "0", ""]);
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
    const ops = renameOps(first(opened), "sole", opened.engine.model);
    expect(ops).toEqual([
      { op: "ident", path: [0, 0], tag: "rect", id: null },
      { op: "ident", path: [0, 0], tag: "rect", id: "sole" },
    ]);
    expect(applied(opened, ops)).toContain('<rect id="sole" width="10" height="10"/>');

    const bare = open(doc(`${LAYER}<rect width="10" height="10"/></g>`));
    expect(renameOps(first(bare), "sole", bare.engine.model)).toEqual([{ op: "ident", path: [0, 0], tag: "rect", id: "sole" }]);
  });
});

describe("rinominare chi è nominato", () => {
  const A = '<rect id="r" x="100" y="100" width="200" height="120" fill="#e69f00"/>';
  const B = '<rect id="b" x="500" y="400" width="200" height="120" fill="#009e73"/>';
  /// L'etichetta di `r`, come la scrive l'editor.
  const LABEL = '<text id="t" fub:inside="r" fub:wrap="188" x="0" y="0" font-size="16" text-anchor="middle" transform="matrix(1 0 0 1 0 0)"><tspan x="0" dy="0">Processo</tspan></text>';
  /// Il connettore da `r` a `b`, con una geometria vecchia, e la sua etichetta.
  const LINE = (from = "r auto"): string =>
    `<path id="c" fub:shape="connector" fub:geom="elbow 0 0 10 10" fub:from="${from}" fub:to="b auto" d="M0 0 L10 10" fill="none" stroke="#000000" stroke-width="2"/>`;
  const ALONG = (on = "c"): string =>
    `<text id="k" fub:along="${on} 0.5 12" x="0" y="0" font-size="14" text-anchor="middle"><tspan x="0" dy="0">sì</tspan></text>`;

  /// Come lo installa l'editor: le etichette, poi i connettori, in un seguito.
  function sheet(body: string, after = ""): Opened {
    const opened = open(doc(`${LAYER}${body}</g>${after}`));
    const find = (id: string) => opened.engine.holder(id);
    opened.engine.follow = (model, touched, op) => {
      const ops = [followLabels(model, touched, find, estimate, op), followConnectors(model, touched, find, estimate, op)].filter((each): each is Op => each !== null);
      return ops.length === 0 ? null : ops.length === 1 ? ops[0]! : { op: "batch", ops };
    };
    return opened;
  }

  /// L'oggetto di id `id`, com'è per il pannello.
  const subjectOfId = (opened: Opened, id: string): Subject => subjectOf(opened.engine.holder(id)!)!;

  /// Rinomina `id` in `next` come l'editor, in un passo; il testo di prima e di dopo.
  function rename(opened: Opened, id: string, next: string): { readonly before: string; readonly after: string; readonly ops: Op[] } {
    const before = opened.engine.text;
    const ops = renameOps(subjectOfId(opened, id), next, opened.engine.model);
    const outcome = opened.engine.apply(gesture(ops)!);
    if (outcome.outcome !== "applied") throw new Error(`rifiutato: ${outcome.detail}`);
    const after = opened.engine.text;
    // Un annulla solo riporta tutto com'era, e rifare com'è dopo.
    const back = opened.engine.undo(outcome.undo);
    if (back.outcome !== "applied") throw new Error(`annulla rifiutato: ${back.detail}`);
    expect(opened.engine.text, "l'annulla").toBe(before);
    const again = opened.engine.undo(back.undo);
    if (again.outcome !== "applied") throw new Error(`rifai rifiutato: ${again.detail}`);
    expect(opened.engine.text, "il rifai").toBe(after);
    return { before, after, ops };
  }

  const scene = (name: string): string => `<g id="g">${A.replace('id="r"', `id="${name}"`)}${LABEL.replace('fub:inside="r"', `fub:inside="${name}"`)}</g>${B}${LINE(`${name} auto`)}${ALONG()}`;

  it("l'etichetta di una forma e i capi e le etichette di un connettore ricevono l'id nuovo, in un passo", () => {
    const opened = sheet(scene("r"));
    const { ops, after } = rename(opened, "r", "casa");
    expect(ops.slice(0, 2)).toEqual([
      { op: "ident", path: [0, 0, 0], tag: "rect", id: null },
      { op: "ident", path: [0, 0, 0], tag: "rect", id: "casa" },
    ]);
    // La forma, l'etichetta e il connettore: un solo `set` ciascuno.
    expect(ops.slice(2)).toEqual([
      { op: "set", id: "t", attrs: { "fub:inside": "casa" } },
      { op: "set", id: "c", attrs: { "fub:from": "casa auto" } },
    ]);
    expect(after).toContain('<rect id="casa"');
    expect(after).not.toMatch(/fub:(inside|from)="r[ "]/);
  });

  it("il capo `to` e il punto d'aggancio, l'etichetta del connettore con `t` e distanza", () => {
    const opened = sheet(`${A}<rect id="b" x="500" y="400" width="200" height="120"/><path id="c" fub:shape="connector" fub:geom="elbow 0 0 10 10" fub:from="r right" fub:to="b auto" d="M0 0 L10 10" fill="none" stroke="#000000" stroke-width="2"/>${ALONG()}`);
    expect(rename(opened, "c", "linea").ops.slice(2)).toEqual([{ op: "set", id: "k", attrs: { "fub:along": "linea 0.5 12" } }]);
    const target = sheet(`${A}<rect id="b" x="500" y="400" width="200" height="120"/><path id="c" fub:shape="connector" fub:geom="elbow 0 0 10 10" fub:from="r right" fub:to="b auto" d="M0 0 L10 10" fill="none" stroke="#000000" stroke-width="2"/>`);
    expect(rename(target, "b", "fine").ops.slice(2)).toEqual([{ op: "set", id: "c", attrs: { "fub:to": "fine auto" } }]);
    // Un connettore agganciato a due capi della stessa forma ha un `set` solo.
    const both = sheet(`${A}<path id="c" fub:shape="connector" fub:geom="elbow 0 0 10 10" fub:from="r right" fub:to="r left" d="M0 0 L10 10" fill="none" stroke="#000000" stroke-width="2"/>`);
    expect(rename(both, "r", "anello").ops.slice(2)).toEqual([{ op: "set", id: "c", attrs: { "fub:from": "anello right", "fub:to": "anello left" } }]);
  });

  it("dopo il cambio l'etichetta e il connettore seguono ancora la forma, come prima", () => {
    // La stessa scena senza il cambio fa da controllo: spostata la forma allo
    // stesso modo, etichetta, connettore e sua etichetta finiscono uguali.
    const renamed = sheet(scene("r"));
    rename(renamed, "r", "casa");
    const control = sheet(scene("r"));
    const move = (id: string): Op => ({ op: "set", id, attrs: { transform: "matrix(1 0 0 1 60 -40)" } });
    expect(renamed.engine.apply(move("casa")).outcome).toBe("applied");
    expect(control.engine.apply(move("r")).outcome).toBe("applied");
    expect(attrOf(renamed, "t", "fub:inside")).toBe("casa");
    expect(attrOf(renamed, "c", "fub:from")).toBe("casa auto");
    expect(attrOf(renamed, "t", "transform")).toBe(attrOf(control, "t", "transform"));
    expect(attrOf(renamed, "c", "fub:geom")).toBe(attrOf(control, "c", "fub:geom"));
    expect(attrOf(renamed, "c", "d")).toBe(attrOf(control, "c", "d"));
    expect(attrOf(renamed, "k", "transform")).toBe(attrOf(control, "k", "transform"));
    // Il connettore si è davvero mosso con la forma.
    expect(attrOf(renamed, "c", "fub:geom")).not.toBe(attrOf(sheet(scene("r")), "c", "fub:geom"));
  });

  it("una forma senza id nuovo da dare, o senza chi la nomina, non scrive altro", () => {
    const bare = sheet(`<rect x="100" y="100" width="20" height="20"/>${LABEL}`);
    expect(renameOps(first(bare), "casa", bare.engine.model)).toEqual([{ op: "ident", path: [0, 0], tag: "rect", id: "casa" }]);
    const alone = sheet(`${A}<rect id="o" x="0" y="0" width="5" height="5"/>${LABEL.replace('fub:inside="r"', 'fub:inside="o"')}`);
    expect(rename(alone, "r", "casa").ops).toHaveLength(2);
    // Senza il documento, soltanto l'id.
    const scenic = sheet(scene("r"));
    expect(renameOps(subjectOfId(scenic, "r"), "casa", null)).toHaveLength(2);
  });

  it("chi sta in un livello bloccato ferma il cambio, che lo staccherebbe; chi non ha un id resta com'è", () => {
    const locked = sheet(`${A}${B}`, `<g id="l2" fub:layer="Due" fub:locked="true">${LINE()}${ALONG()}</g>`);
    const model = locked.engine.model!;
    expect(heldNamer(model, "r")).toBe(true);
    expect(heldNamer(model, "b")).toBe(true);
    const free = sheet(scene("r"));
    expect(heldNamer(free.engine.model!, "r")).toBe(false);
    const never = (): boolean => false;
    expect(idProblem(subjectOfId(locked, "r"), "casa", never, never, (id) => heldNamer(model, id))).toBe("held");
    // Anche chiesta lo stesso, il motore non la scrive: niente cambia.
    const before = locked.engine.text;
    expect(locked.engine.apply(gesture(renameOps(subjectOfId(locked, "r"), "casa", model))!).outcome).not.toBe("applied");
    expect(locked.engine.text).toBe(before);
    const unnamed = sheet(`${A}${B}<path fub:shape="connector" fub:geom="elbow 0 0 10 10" fub:from="r auto" fub:to="b auto" d="M0 0 L10 10" fill="none" stroke="#000000" stroke-width="2"/>`);
    expect(rename(unnamed, "r", "casa").ops).toHaveLength(2);
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
    expect(idProblem(subject, next, taken, never, never)).toBe(problem);
  });

  it.each(["sole", "_sole", "città.1", "Été-2", "a".repeat(MAX_ID_LENGTH), "oaaaaaaaa"])("%j va bene", (next) => {
    expect(idProblem(subject, next, taken, never, never)).toBeNull();
  });

  it("un id citato da una parte estranea non si cambia", () => {
    expect(idProblem(subject, "sole", taken, (id) => id === "oaaaaaaaa", never)).toBe("cited");
    expect(idProblem(subject, "oaaaaaaaa", taken, () => true, never), "lo stesso id").toBeNull();
  });

  it("un id che un oggetto bloccato nomina non si cambia", () => {
    expect(idProblem(subject, "sole", taken, never, (id) => id === "oaaaaaaaa")).toBe("held");
    expect(idProblem(subject, "oaaaaaaaa", taken, never, () => true), "lo stesso id").toBeNull();
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
