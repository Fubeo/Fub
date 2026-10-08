// I colori del documento e le operazioni dei campioni: chi mostra un colore,
// dove lo si riscrive, e operazioni che il motore accetta così come sono e
// che un annulla disfa al byte.

import { describe, expect, it } from "vitest";
import { parsePath } from "../scene/geometry";
import { doc, HEAD } from "../scene/test-support";
import { gesture, NewIds } from "./edit";
import { NAME_MAX } from "./naming";
import { widthAttrs } from "./profile";
import { swatchPaint } from "./resources";
import { arrowPath } from "./shapes";
import {
  documentColors,
  freshSwatchName,
  linkSwatchOps,
  newSwatchOps,
  recolorSwatchOps,
  removeSwatchOps,
  renameSwatchOps,
  swatchNameProblem,
  unitsShowing,
  USED_MAX,
  type DocumentSwatch,
} from "./swatches";
import { LAYER, open, type Opened } from "./test-support";

const ids = (opened: Opened): NewIds => new NewIds((id) => opened.engine.holder(id) !== null);

const SWATCH = (id: string, name: string, color: string): string =>
  `<linearGradient id="${id}" fub:role="swatch" fub:name="${name}" gradientUnits="userSpaceOnUse"><stop stop-color="${color}"/></linearGradient>`;
const RECT = (id: string, extra = ""): string => `<rect id="${id}" x="0" y="0" width="10" height="10"${extra}/>`;
const TEXT = (id: string, extra: string, inner: string): string => `<text id="${id}" x="10" y="40"${extra}><tspan x="10" dy="0">${inner}</tspan></text>`;
const LOCKED = '<g id="l2" fub:layer="Bloccato" fub:locked="true">';
const PAPER = '<rect id="fub-paper" fub:role="paper" x="0" y="0" width="100" height="100" fill="#d55e00"/>';

const PATTERN =
  '<pattern id="rp" width="10" height="10" patternUnits="userSpaceOnUse"><rect width="5" height="5" fill="#d55e00"/>' +
  '<g fill="#d55e00"><circle cx="7" cy="7" r="2"/></g></pattern>';
const CLIP = '<clipPath id="rc"><rect width="5" height="5" fill="#d55e00"/></clipPath>';
const GRADIENT = '<linearGradient id="rg"><stop offset="0" stop-color="#d55e00"/><stop offset="1" stop-color="#ffffff"/></linearGradient>';

/// Un disegno che usa il vermiglio in ogni modo: scritto, ereditato da un
/// gruppo, come contorno, in un testo, in un motivo, in un ritaglio, in una
/// sfumatura, sulla carta e in un livello bloccato.
const SOURCE = doc(
  `<defs id="fub-defs">${SWATCH("rs", "Blu", "#0072b2")}${PATTERN}${CLIP}${GRADIENT}</defs>${PAPER}${LAYER}` +
    `${RECT("oa", ' fill="#d55e00"')}${RECT("ob", ' fill="url(#rs) #0072b2"')}` +
    `<g id="og" fill="#d55e00">${RECT("oc")}${RECT("od", ' fill="#0072b2"')}</g>` +
    `${RECT("oe")}<line id="ol" x1="0" y1="0" x2="10" y2="0" stroke="#d55e00"/>` +
    `${TEXT("ot", ' fill="#d55e00"', 'Ciao <tspan fill="#0072b2">mondo</tspan>')}` +
    `${RECT("ou", ' fill="url(#rp)"')}${RECT("ov", ' clip-path="url(#rc)"')}${RECT("ow", ' fill="url(#rg)"')}</g>` +
    `${LOCKED}${RECT("ox", ' fill="#d55e00"')}</g>`,
);

/// Applica `ops` in un passo, verifica che un annulla torni al byte e che un
/// rifai torni al dopo, e lascia il motore al dopo.
function applied(opened: Opened, ops: Parameters<typeof gesture>[0]): string {
  const before = opened.engine.text;
  const outcome = opened.engine.apply(gesture(ops)!);
  if (outcome.outcome !== "applied") throw new Error(`rifiutato: ${outcome.detail}`);
  const after = opened.engine.text;
  expect(opened.engine.undo(outcome.undo).outcome).toBe("applied");
  expect(opened.engine.text).toBe(before);
  expect(opened.engine.apply(gesture(ops)!).outcome).toBe("applied");
  expect(opened.engine.text).toBe(after);
  expect(opened.engine.scene().every((item) => item.kind !== "foreign")).toBe(true);
  return after;
}

/// Le operazioni `set` di `ops`.
const sets = (ops: readonly { readonly op: string }[]): unknown[] => ops.filter((op) => op.op === "set");

const swatchElem = (id: string, name: string, color: string): unknown => ({
  tag: "linearGradient",
  attrs: { id, "fub:role": "swatch", "fub:name": name, gradientUnits: "userSpaceOnUse" },
  children: [{ tag: "stop", attrs: { "stop-color": color } }],
});

describe("i colori del documento", () => {
  it("contano chi mostra un colore: scritto, ereditato, nero di SVG, nei motivi; non la carta, i ritagli e le sfumature", () => {
    const colors = documentColors(open(SOURCE).engine.model!);
    expect(colors.swatches).toEqual([{ id: "rs", name: "Blu", color: "#0072b2", stop: [0], uses: 1 }]);
    // Il vermiglio: le due forme del motivo, «oa», «oc» dal gruppo, il
    // contorno di «ol», il testo e l'oggetto bloccato. Il blu di «od» e della
    // parola; il nero di SVG di «oe» e di «ov», a parità nell'ordine del
    // documento.
    expect(colors.used).toEqual([
      { color: "#d55e00", uses: 7 },
      { color: "#0072b2", uses: 2 },
      { color: "#000000", uses: 2 },
    ]);
    expect(colors.hidden).toBe(0);
  });

  it("un testo conta una volta per colore, anche con più parole dello stesso", () => {
    const source = doc(`${LAYER}${TEXT("ot", "", 'Uno <tspan fill="#d55e00">due</tspan> tre <tspan fill="#d55e00">quattro</tspan>')}${TEXT("ou", ' fill="#d55e00"', " ")}</g>`);
    // «ot» è nero dove le parole non scrivono un colore; «ou» non ha lettere,
    // e mostra il suo.
    expect(documentColors(open(source).engine.model!).used).toEqual([
      { color: "#d55e00", uses: 2 },
      { color: "#000000", uses: 1 },
    ]);
    const all = doc(`${LAYER}${TEXT("ot", ' fill="#0072b2"', '<tspan fill="#d55e00">Tutto</tspan>')}</g>`);
    expect(documentColors(open(all).engine.model!).used).toEqual([{ color: "#d55e00", uses: 1 }]);
  });

  it("si fermano a USED_MAX, dal più usato, e dicono quanti restano fuori", () => {
    const hex = (n: number): string => `#${n.toString(16).padStart(6, "0")}`;
    const rects = Array.from({ length: USED_MAX + 2 }, (_, i) => RECT(`o${i}`, ` fill="${hex(i + 1)}"`)).join("");
    const colors = documentColors(open(doc(`${LAYER}${rects}${RECT("oz", ` fill="${hex(USED_MAX + 2)}"`)}</g>`)).engine.model!);
    expect(colors.used).toHaveLength(USED_MAX);
    expect(colors.used[0]).toEqual({ color: hex(USED_MAX + 2), uses: 2 });
    expect(colors.used[1]).toEqual({ color: hex(1), uses: 1 });
    expect(colors.hidden).toBe(2);
  });

  it("si rileggono dopo un'operazione su un gruppo, che cambia sul posto", () => {
    const opened = open(SOURCE);
    applied(opened, [{ op: "set", id: "og", attrs: { fill: "#0072b2" } }]);
    expect(documentColors(opened.engine.model!).used).toEqual([
      { color: "#d55e00", uses: 6 },
      { color: "#0072b2", uses: 3 },
      { color: "#000000", uses: 2 },
    ]);
  });

  it("gli oggetti che mostrano un colore si scelgono a ogni profondità", () => {
    const { engine, index } = open(SOURCE);
    const keys = (value: string): string[] => unitsShowing(engine.model!, index, value).map((unit) => unit.key);
    // Non la carta, non il motivo, non l'oggetto bloccato.
    expect(keys("#d55e00")).toEqual(["oa", "oc", "ol", "ot"]);
    expect(keys("#0072b2")).toEqual(["od", "ot"]);
    expect(keys("url(#rs)")).toEqual(["ob"]);
    expect(keys("#cc79a7")).toEqual([]);
  });
});

describe("rendere campione un colore", () => {
  it("chi scrive il colore passa al campione: oggetti, gruppi, contorni, testi, le forme di un motivo", () => {
    const opened = open(SOURCE);
    const made = newSwatchOps(opened.engine.model!, "#d55e00", "Vermiglio", true, [], ids(opened));
    const paint = swatchPaint({ id: made.id, color: "#d55e00" });
    expect(made.id).toMatch(/^r[a-z0-9]{8}$/);
    expect(made.ops).toEqual([
      { op: "add", parent: "fub-defs", pos: { last: true }, elem: swatchElem(made.id, "Vermiglio", "#d55e00") },
      { op: "set", id: "rp", part: [0], attrs: { fill: paint } },
      { op: "set", id: "rp", part: [1], attrs: { fill: paint } },
      { op: "set", id: "oa", attrs: { fill: paint } },
      { op: "set", id: "og", attrs: { fill: paint } },
      { op: "set", id: "ol", attrs: { stroke: paint } },
      { op: "set", id: "ot", attrs: { fill: paint } },
    ]);
    // L'oggetto del livello bloccato tiene il colore scritto.
    expect(made.kept).toBe(1);
    const after = applied(opened, made.ops);
    expect(after).toContain(PAPER);
    expect(after).toContain(CLIP);
    expect(after).toContain(GRADIENT);
    const colors = documentColors(opened.engine.model!);
    expect(colors.swatches.map((swatch) => [swatch.name, swatch.color, swatch.uses])).toEqual([
      ["Blu", "#0072b2", 1],
      ["Vermiglio", "#d55e00", 6],
    ]);
    expect(colors.used).toEqual([
      { color: "#0072b2", uses: 2 },
      { color: "#000000", uses: 2 },
      { color: "#d55e00", uses: 1 },
    ]);
  });

  it("dove nessuno scrive il colore, o lo scrive la radice, lo scrive sull'oggetto", () => {
    const opened = open(SOURCE);
    const black = newSwatchOps(opened.engine.model!, "#000000", "Nero", true, [], ids(opened));
    const paint = swatchPaint({ id: black.id, color: "#000000" });
    expect(black.ops.slice(1)).toEqual([
      { op: "set", id: "oe", attrs: { fill: paint } },
      { op: "set", id: "ov", attrs: { fill: paint } },
    ]);
    applied(opened, black.ops);

    const root = HEAD.replace(" viewBox", ' fill="#d55e00" viewBox');
    const inherited = open(`${root}${LAYER}<g id="og">${RECT("oa")}</g>${TEXT("ot", "", "Ciao")}<rect x="0" y="0" width="5" height="5"/></g></svg>`);
    const made = newSwatchOps(inherited.engine.model!, "#d55e00", "Vermiglio", true, [], ids(inherited));
    const red = swatchPaint({ id: made.id, color: "#d55e00" });
    // L'oggetto senza id ne riceve uno; senza defs il campione le crea,
    // prima di tutto.
    const [unnamed, defs, add, ...rest] = made.ops as Array<{ readonly op: string; readonly id?: string }>;
    expect(unnamed).toMatchObject({ op: "ident", path: [0, 2], tag: "rect" });
    expect(defs).toEqual({ op: "add", parent: "#root", pos: { first: true }, elem: { tag: "defs", attrs: { id: "fub-defs" } } });
    expect(add).toEqual({ op: "add", parent: "fub-defs", pos: { last: true }, elem: swatchElem(made.id, "Vermiglio", "#d55e00") });
    expect(rest).toEqual([
      { op: "set", id: "oa", attrs: { fill: red } },
      { op: "set", id: "ot", attrs: { fill: red } },
      { op: "set", id: unnamed!.id, attrs: { fill: red } },
    ]);
    expect(made.kept).toBe(0);
    const after = applied(inherited, made.ops);
    expect(after.startsWith(root)).toBe(true);
  });

  it("le parole di un testo tengono il loro colore, e il testo intero passa al campione", () => {
    const opened = open(doc(`${LAYER}${TEXT("ot", ' fill="#d55e00"', 'Ciao <tspan fill="#d55e00">mondo</tspan>')}</g>`));
    const made = newSwatchOps(opened.engine.model!, "#d55e00", "Vermiglio", true, [], ids(opened));
    expect(sets(made.ops)).toEqual([{ op: "set", id: "ot", attrs: { fill: swatchPaint({ id: made.id, color: "#d55e00" }) } }]);
    expect(made.kept).toBe(1);
    applied(opened, made.ops);
  });

  it("un campione nuovo senza legarlo non tocca chi usa il colore", () => {
    const opened = open(SOURCE);
    const made = newSwatchOps(opened.engine.model!, "#cc79a7", "Porpora", false, [opened.index.get("oa")!], ids(opened));
    expect(made.ops).toEqual([{ op: "add", parent: "fub-defs", pos: { last: true }, elem: swatchElem(made.id, "Porpora", "#cc79a7") }]);
    expect(made.keys).toEqual(["oa"]);
    applied(opened, made.ops);
    expect(documentColors(opened.engine.model!).swatches.map((swatch) => [swatch.name, swatch.uses])).toEqual([
      ["Blu", 1],
      ["Porpora", 0],
    ]);
  });

  it("chi usa il colore di un campione che c'è passa a lui", () => {
    const opened = open(SOURCE);
    const linked = linkSwatchOps(opened.engine.model!, "rs", [], ids(opened));
    expect(linked.ops).toEqual([{ op: "set", id: "od", attrs: { fill: "url(#rs) #0072b2" } }]);
    // La parola blu del testo.
    expect(linked.kept).toBe(1);
    applied(opened, linked.ops);
    expect(documentColors(opened.engine.model!).swatches[0]!.uses).toBe(2);
    expect(linkSwatchOps(opened.engine.model!, "rx", [], ids(opened)).ops).toEqual([]);
  });

  it("ogni oggetto usa il campione: tratti a penna, linee a spessore variabile, frecce, stelle", () => {
    const brush = "pf1 size=4 thinning=0.5 smoothing=0.5 streamline=0.5 taperStart=0 taperEnd=0 capStart=1 capEnd=1 sim=0";
    const ink = "1 s100 cxypt 12050,3020,128,0 25,-3,2,8 31,-5,0,8";
    const width = widthAttrs({ cap: "butt", join: "miter", profile: [[0, 4, 4], [1, 0, 0]], spine: parsePath("M0 0 L100 0")! })!;
    const opened = open(
      doc(
        `${LAYER}<path id="op" fub:tool="pen" fub:brush="${brush}" d="M0 0 L10 10 Z" fill="#d55e00" fub:ink="${ink}"/>` +
          `<path id="ow" fub:shape="width" fub:geom="${width.geom}" d="${width.d}" fill="#d55e00"/>` +
          `<path id="oa" fub:shape="arrow" fub:geom="0 0 100 0" d="${arrowPath(0, 0, 100, 0, 2)}" fill="none" stroke="#d55e00" stroke-width="2"/>` +
          '<path id="os" fub:shape="star" fub:geom="0 0 10 3 0.5 0 0" d="M0 -10 L4.33 -2.5 L8.66 5 L0 5 L-8.66 5 L-4.33 -2.5 Z" fill="#d55e00" stroke="#d55e00"/></g>',
      ),
    );
    expect(documentColors(opened.engine.model!).used).toEqual([{ color: "#d55e00", uses: 4 }]);
    const made = newSwatchOps(opened.engine.model!, "#d55e00", "Vermiglio", true, [], ids(opened));
    const paint = swatchPaint({ id: made.id, color: "#d55e00" });
    expect(sets(made.ops)).toEqual([
      { op: "set", id: "op", attrs: { fill: paint } },
      { op: "set", id: "ow", attrs: { fill: paint } },
      { op: "set", id: "oa", attrs: { stroke: paint } },
      { op: "set", id: "os", attrs: { fill: paint, stroke: paint } },
    ]);
    applied(opened, made.ops);
    expect(documentColors(opened.engine.model!).swatches[0]!.uses).toBe(4);
  });
});

describe("cambiare un campione", () => {
  const USERS = doc(
    `<defs id="fub-defs">${SWATCH("rs", "Blu", "#0072b2")}` +
      '<pattern id="rp" width="10" height="10" patternUnits="userSpaceOnUse"><rect width="5" height="5" fill="url(#rs) #0072b2"/></pattern></defs>' +
      `${LAYER}${RECT("oa", ' fill="url(#rs) #0072b2"')}${RECT("ob", ' fill="url(#rs)" stroke="url(#rs) none"')}${RECT("oc", ' fill="url(#rp)"')}</g>` +
      `${LOCKED}${RECT("ox", ' fill="url(#rs) #0072b2"')}</g>`,
  );

  it("il colore: il punto e il ripiego di chi lo usa, in un passo; chi è bloccato tiene il ripiego", () => {
    const opened = open(USERS);
    const changed = recolorSwatchOps(opened.engine.model!, "rs", "#cc79a7", [], ids(opened));
    const paint = "url(#rs) #cc79a7";
    expect(changed.ops).toEqual([
      { op: "set", id: "rs", part: [0], attrs: { "stop-color": "#cc79a7" } },
      { op: "set", id: "rp", part: [0], attrs: { fill: paint } },
      { op: "set", id: "oa", attrs: { fill: paint } },
      { op: "set", id: "ob", attrs: { fill: paint, stroke: paint } },
    ]);
    const after = applied(opened, changed.ops);
    expect(after).toContain(RECT("ox", ' fill="url(#rs) #0072b2"'));
    const colors = documentColors(opened.engine.model!);
    // La forma del motivo, «oa», «ob» una volta, e l'oggetto bloccato.
    expect(colors.swatches).toEqual([{ id: "rs", name: "Blu", color: "#cc79a7", stop: [0], uses: 4 }]);
    // Lo stesso colore non cambia niente.
    expect(recolorSwatchOps(opened.engine.model!, "rs", "#cc79a7", [], ids(opened)).ops).toEqual([]);
  });

  it("il nome, se cambia", () => {
    const opened = open(USERS);
    const renamed = renameSwatchOps(opened.engine.model!, "rs", "Blu scuro", [], ids(opened));
    expect(renamed.ops).toEqual([{ op: "set", id: "rs", attrs: { "fub:name": "Blu scuro" } }]);
    applied(opened, renamed.ops);
    expect(documentColors(opened.engine.model!).swatches[0]!.name).toBe("Blu scuro");
    expect(renameSwatchOps(opened.engine.model!, "rs", "Blu scuro", [], ids(opened)).ops).toEqual([]);
    expect(renameSwatchOps(opened.engine.model!, "rp", "Motivo", [], ids(opened)).ops).toEqual([]);
  });
});

describe("eliminare un campione", () => {
  it("chi lo usa torna al suo colore, scritto, e il campione se ne va", () => {
    const opened = open(SOURCE);
    const removed = removeSwatchOps(opened.engine.model!, "rs", [opened.index.get("ob")!], ids(opened));
    expect(removed.ops).toEqual([
      { op: "set", id: "ob", attrs: { fill: "#0072b2" } },
      { op: "remove", target: "rs" },
    ]);
    expect(removed.kept).toBe(0);
    expect(removed.keys).toEqual(["ob"]);
    const after = applied(opened, removed.ops);
    expect(after).not.toContain('"rs"');
    expect(after).not.toContain("#rs");
    expect(documentColors(opened.engine.model!).swatches).toEqual([]);
  });

  it("se lo usa ancora chi non si riscrive, resta come risorsa condivisa e senza nome", () => {
    const source = doc(
      `<defs id="fub-defs">${SWATCH("rs", "Blu", "#0072b2")}` +
        '<pattern id="rp" width="10" height="10" patternUnits="userSpaceOnUse"><rect width="5" height="5" fill="url(#rs) #0072b2"/></pattern></defs>' +
        `${LAYER}${RECT("oa", ' fill="url(#rs) #0072b2"')}</g>${LOCKED}${RECT("ox", ' fill="url(#rs) #0072b2"')}</g>`,
    );
    const opened = open(source);
    const removed = removeSwatchOps(opened.engine.model!, "rs", [], ids(opened));
    expect(removed.ops).toEqual([
      { op: "set", id: "rp", part: [0], attrs: { fill: "#0072b2" } },
      { op: "set", id: "oa", attrs: { fill: "#0072b2" } },
      { op: "set", id: "rs", attrs: { "fub:role": "shared", "fub:name": null } },
    ]);
    expect(removed.kept).toBe(1);
    const after = applied(opened, removed.ops);
    expect(after).toContain('<linearGradient id="rs" fub:role="shared" gradientUnits="userSpaceOnUse">');
    expect(documentColors(opened.engine.model!).swatches).toEqual([]);
    expect(removeSwatchOps(opened.engine.model!, "rs", [], ids(opened)).ops).toEqual([]);
  });

  it("anche un elemento di un altro programma che lo usa lo tiene", () => {
    const opened = open(doc(`<defs id="fub-defs">${SWATCH("rs", "Blu", "#0072b2")}</defs>${LAYER}<switch><rect width="5" height="5" fill="url(#rs) #0072b2"/></switch></g>`));
    expect(documentColors(opened.engine.model!).swatches[0]!.uses).toBe(0);
    const removed = removeSwatchOps(opened.engine.model!, "rs", [], ids(opened));
    expect(removed.ops).toEqual([{ op: "set", id: "rs", attrs: { "fub:role": "shared", "fub:name": null } }]);
    expect(removed.kept).toBe(1);
    const outcome = opened.engine.apply(gesture(removed.ops)!);
    expect(outcome.outcome).toBe("applied");
  });
});

describe("i nomi dei campioni", () => {
  const swatch = (id: string, name: string): DocumentSwatch => ({ id, name, color: "#000000", stop: [0], uses: 0 });
  const SWATCHES = [swatch("ra", "Blu"), swatch("rb", "Blu 2")];

  it("un nome è vuoto, o di un altro campione anche con le maiuscole diverse", () => {
    expect(swatchNameProblem(SWATCHES, "")).toBe("empty");
    expect(swatchNameProblem(SWATCHES, "BLU")).toBe("taken");
    expect(swatchNameProblem(SWATCHES, "blu", "ra")).toBeNull();
    expect(swatchNameProblem(SWATCHES, "Azzurro")).toBeNull();
  });

  it("un nome non è un colore che il campo leggerebbe come tale: un codice, o «nessuno»", () => {
    for (const name of ["#0072b2", "#FFF", "none", "None", "Nessuno"]) expect(swatchNameProblem(SWATCHES, name)).toBe("color");
    // Il nome di un colore sì: nel campo vale prima il campione, che è del
    // disegno; e un cancelletto che non fa un colore anche.
    for (const name of ["red", "Rosso", "#1", "#blu", "Nessuno 2"]) expect(swatchNameProblem(SWATCHES, name)).toBeNull();
  });

  it("il primo nome libero, entro la lunghezza di un nome", () => {
    expect(freshSwatchName(SWATCHES, "Rosso")).toBe("Rosso");
    expect(freshSwatchName(SWATCHES, "  blu ")).toBe("blu 3");
    const long = "a".repeat(NAME_MAX);
    const fresh = freshSwatchName([swatch("ra", long)], long);
    expect(fresh).toBe(`${"a".repeat(NAME_MAX - 2)} 2`);
  });
});
