// I colori del documento e le operazioni dei campioni: chi mostra un colore,
// dove lo si riscrive, e operazioni che il motore accetta così come sono e
// che un annulla disfa al byte.

import { describe, expect, it } from "vitest";
import { doc } from "../scene/test-support";
import { gesture } from "./edit";
import { NAME_MAX } from "./naming";
import { documentColors, freshSwatchName, swatchNameProblem, USED_MAX, type DocumentSwatch } from "./swatches";
import { LAYER, open, type Opened } from "./test-support";

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

  it("dopo ogni operazione contano come in un disegno appena aperto, anche ciò che si eredita", () => {
    const opened = open(SOURCE);
    const seen = [documentColors(opened.engine.model!)];
    const steps: Array<Parameters<typeof gesture>[0]> = [
      [{ op: "set", id: "og", attrs: { fill: "#0072b2" } }],
      [{ op: "set", id: "og", attrs: { fill: null, stroke: "#d55e00" } }],
      [{ op: "set", id: "l1", attrs: { fill: "#009e73" } }],
      [{ op: "set", id: "oa", attrs: { fill: null } }],
    ];
    for (const ops of steps) {
      applied(opened, ops);
      const colors = documentColors(opened.engine.model!);
      expect(colors).toEqual(documentColors(open(opened.engine.text).engine.model!));
      seen.push(colors);
    }
    // Ogni passo cambia ciò che si conta.
    for (let k = 1; k < seen.length; k++) expect(seen[k]).not.toEqual(seen[k - 1]);
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
