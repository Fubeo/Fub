// Il corpus delle prove dell'impaginatore: note misurate a mano, come scatole.
// Lo usano solo i test (`rules.test.ts`, `breaks.test.ts`).
//
// Le misure vengono dal prototipo dell'esportazione (`PLAN-ui/editor.html`,
// tema «Fub»), su un A4 coi margini «Normali» (25 mm sopra e sotto, 22 ai
// lati), arrotondate al decimo di pixel:
// - altezza utile: 297 − 50 = 247 mm = 933,5 px; larghezza 166 mm = 627,4 px;
// - testo: 11 pt = 14,7 px con interlinea 1,5 → righe di 22 px, e 9,7 px
//   (0,66 em) fra un blocco e il successivo;
// - Titolo 1: 30,4 px su una riga (1,12), 13,2 px sotto; Titolo 2: 25,8 px,
//   22 px sopra (1,5 em); Titolo 3: 22 px, 18 px sopra;
// - codice: 12,5 px con interlinea 1,5 → righe di 18,8 px; i 10 px del
//   riquadro sopra e sotto stanno nella prima e nell'ultima riga;
// - tabella: intestazione 32 px, righe di 29 px;
// - una figura a tutta larghezza (16:9) con la didascalia: 352,9 + 22 px;
// - una formula in blocco: 58 px; un riquadro di tre righe: 96 px.

import type { Box, CodeBox, HeadingBox, MarginNote, ParagraphBox, TableBox } from "./model";

export const MM = 96 / 25.4;

/// L'altezza utile di un A4 coi margini «Normali».
export const A4_BODY = round(247 * MM);

export const LINE = 22;
export const GAP = 9.7;
export const CODE_LINE = 18.8;
export const ROW = 29;
export const TABLE_HEADER = 32;

let serial = 0;

function id(prefix: string): string {
  serial += 1;
  return `${prefix}-${serial}`;
}

export function round(value: number): number {
  return Math.round(value * 10) / 10;
}

export function h1(text = "titolo"): HeadingBox {
  return { kind: "heading", id: id(text), level: 1, height: 30.4 };
}

export function h2(text = "sezione"): HeadingBox {
  return { kind: "heading", id: id(text), level: 2, height: 25.8, gap: 22 };
}

export function h3(text = "paragrafo-titolo"): HeadingBox {
  return { kind: "heading", id: id(text), level: 3, height: 22, gap: 18 };
}

/// Un paragrafo di `lines` righe.
export function para(lines: number, notes?: MarginNote[]): ParagraphBox {
  return { kind: "paragraph", id: id("p"), lines: Array.from({ length: lines }, () => LINE), gap: GAP, ...(notes ? { notes } : {}) };
}

/// Un blocco di codice di `lines` righe, col riquadro nella prima e
/// nell'ultima.
export function code(lines: number): CodeBox {
  const heights = Array.from({ length: lines }, () => CODE_LINE);
  heights[0] += 10;
  heights[lines - 1] += 10;
  return { kind: "code", id: id("codice"), lines: heights, gap: GAP };
}

export function table(rows: number, rowHeight = ROW): TableBox {
  return { kind: "table", id: id("tabella"), header: TABLE_HEADER, rows: Array.from({ length: rows }, () => rowHeight), gap: GAP };
}

export function figure(height = round(352.9 + 22)): Box {
  return { kind: "block", id: id("figura"), height, gap: GAP };
}

export function formula(): Box {
  return { kind: "block", id: id("formula"), height: 58, gap: GAP };
}

export function callout(): Box {
  return { kind: "block", id: id("riquadro"), height: 96, gap: GAP };
}

export function separator(): Box {
  return { kind: "separator", id: id("separatore"), height: 1, gap: 20 };
}

export function manualBreak(): Box {
  return { kind: "break", id: id("pagina"), reason: "mano" };
}

/// Una nota vera, lunga circa tre pagine: titoli, paragrafi, una tabella
/// lunga, codice, una figura, una formula, un riquadro, due commenti.
export function report(): Box[] {
  return [
    h1("relazione"),
    para(4),
    para(7, [{ id: "c1", height: 54, at: 2 * LINE }]),
    h2("contesto"),
    para(9),
    para(6),
    figure(),
    para(3),
    h2("dati"),
    para(5),
    table(24),
    para(2),
    h3("metodo"),
    para(8, [{ id: "c2", height: 72 }]),
    code(26),
    formula(),
    para(4),
    callout(),
    h2("conclusioni"),
    para(10),
    para(6),
    para(5),
  ];
}
