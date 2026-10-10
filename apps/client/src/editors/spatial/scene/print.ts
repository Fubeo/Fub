// La pagina di stampa di un PDF: la carta, i margini, l'abbondanza, i segni di
// taglio e di registro, e dove va il disegno. L'host fa lo stesso conto in
// `fub-scene` quando scrive il PDF, e la finestra «Esporta» lo fa qui per
// l'anteprima della pagina e per dire la misura: i vettori di
// `__fixtures__/scene-export/print.json` li provano tutti e due.
//
// Le misure di chi chiede sono in millimetri, quelle della pagina in punti
// PDF, con l'origine in alto a sinistra come nel disegno. La rifilatura è il
// rettangolo che si taglia: la tavola, la selezione o il disegno, a 0,75 punti
// per pixel per la scala. L'abbondanza lo allarga per lato con ciò che il
// disegno ha oltre il bordo, e i segni stanno fuori dall'abbondanza.

/// Punti per millimetro: 72 per pollice, 25,4 millimetri per pollice.
export const PT_PER_MM = 72 / 25.4;
/// Punti per pixel CSS: 72 per pollice contro 96.
export const PT_PER_PX = 0.75;

/// I formati di carta che hanno un nome, in millimetri, col lato corto prima.
export const PAPERS = [
  ["a2", [420, 594]],
  ["a3", [297, 420]],
  ["a4", [210, 297]],
  ["a5", [148, 210]],
  ["a6", [105, 148]],
  ["letter", [215.9, 279.4]],
  ["legal", [215.9, 355.6]],
  ["tabloid", [279.4, 431.8]],
] as const satisfies readonly (readonly [string, readonly [number, number]])[];

export type PaperName = (typeof PAPERS)[number][0];

/// Il lato più corto e il più lungo di una carta su richiesta, in millimetri.
export const PAPER_MIN_MM = 10;
export const PAPER_MAX_MM = 5000;
/// Il margine più largo, e quello di serie con una carta col suo formato.
export const MARGIN_MAX_MM = 100;
export const MARGIN_DEFAULT_MM = 10;
/// L'abbondanza più larga, in millimetri.
export const BLEED_MAX_MM = 25;
/// Quanto un segno sta lontano dal bordo dell'abbondanza, quanto è lungo, e
/// il raggio del cerchio di un segno di registro, in millimetri.
export const MARK_GAP_MM = 3;
export const MARK_LENGTH_MM = 5;
export const REGISTRATION_RADIUS_MM = 1.75;
/// Lo spessore delle linee dei segni, in punti.
export const MARK_WEIGHT_PT = 0.25;

export type Orientation = "auto" | "portrait" | "landscape";
export type PrintFit = "shrink" | "page";

export interface PrintMarks {
  readonly crop: boolean;
  readonly registration: boolean;
}

/// Come si stampa, in millimetri: `paper` è `null` per la carta su misura o i
/// due lati, il corto prima.
export interface PrintSetup {
  readonly paper: readonly [number, number] | null;
  readonly orientation: Orientation;
  readonly margin: number;
  readonly fit: PrintFit;
  readonly bleed: number;
  readonly marks: PrintMarks;
}

/// La pagina di sempre: la carta su misura, senza abbondanza né segni.
export const PLAIN_SETUP: PrintSetup = {
  paper: null,
  orientation: "auto",
  margin: MARGIN_DEFAULT_MM,
  fit: "shrink",
  bleed: 0,
  marks: { crop: false, registration: false },
};

/// Il formato col nome `name`, in millimetri.
export function paperNamed(name: string): readonly [number, number] | null {
  return PAPERS.find(([known]) => known === name)?.[1] ?? null;
}

/// Lo spazio dei segni oltre l'abbondanza, per lato, in millimetri.
export function markBand(setup: PrintSetup): number {
  return setup.marks.crop || setup.marks.registration ? MARK_GAP_MM + MARK_LENGTH_MM : 0;
}

/// Ciò che margini, abbondanza e segni prendono per lato su una carta col suo
/// formato, in millimetri.
export function takenBySetup(setup: PrintSetup): number {
  return setup.margin + setup.bleed + markBand(setup);
}

/// Vero se la carta lascia posto al disegno.
export function hasRoom(setup: PrintSetup): boolean {
  return setup.paper === null || setup.paper[0] - 2 * takenBySetup(setup) > 0;
}

/// La pagina: tutto in punti, con l'origine in alto a sinistra.
export interface PrintSheet {
  readonly width: number;
  readonly height: number;
  /// La rifilatura: angolo in alto a sinistra, larghezza e altezza.
  readonly trim: readonly [number, number, number, number];
  /// L'abbondanza per lato.
  readonly bleed: number;
  /// Quanto è ingrandito il disegno: 1 vuol dire 0,75 punti per pixel.
  readonly scale: number;
  /// Vero se la carta col suo formato è girata in orizzontale.
  readonly landscape: boolean;
}

/// La pagina per un disegno di `width` × `height` pixel CSS con le scelte
/// `setup`, che lasciano posto al disegno ([`hasRoom`]).
export function printLayout(width: number, height: number, setup: PrintSetup): PrintSheet {
  const bleed = Math.max(setup.bleed, 0) * PT_PER_MM;
  const natural = [width * PT_PER_PX, height * PT_PER_PX] as const;
  if (setup.paper === null) {
    const edge = bleed + markBand(setup) * PT_PER_MM;
    return {
      width: natural[0] + 2 * edge,
      height: natural[1] + 2 * edge,
      trim: [edge, edge, natural[0], natural[1]],
      bleed,
      scale: 1,
      landscape: false,
    };
  }
  const [short, long] = setup.paper;
  const landscape = setup.orientation === "auto" ? width > height : setup.orientation === "landscape";
  const paperW = (landscape ? long : short) * PT_PER_MM;
  const paperH = (landscape ? short : long) * PT_PER_MM;
  const taken = 2 * takenBySetup(setup) * PT_PER_MM;
  const fits = Math.min((paperW - taken) / natural[0], (paperH - taken) / natural[1]);
  const scale = setup.fit === "shrink" ? Math.min(fits, 1) : fits;
  const trimW = natural[0] * scale;
  const trimH = natural[1] * scale;
  return {
    width: paperW,
    height: paperH,
    trim: [(paperW - trimW) / 2, (paperH - trimH) / 2, trimW, trimH],
    bleed,
    scale,
    landscape,
  };
}

/// I segni di una pagina, in punti: le linee da un capo all'altro e i cerchi
/// col centro e il raggio.
export interface MarkShapes {
  readonly lines: (readonly [number, number, number, number])[];
  readonly circles: (readonly [number, number, number])[];
}

/// I segni `marks` intorno alla rifilatura di `sheet`: due di taglio per
/// angolo, sul prolungamento dei lati, in alto a sinistra, in alto a destra,
/// in basso a destra e in basso a sinistra, prima l'orizzontale; e un cerchio
/// con una croce a metà di ogni lato, in alto, a destra, in basso e a
/// sinistra.
export function markShapes(sheet: PrintSheet, marks: PrintMarks): MarkShapes {
  const [x, y, w, h] = sheet.trim;
  const right = x + w;
  const bottom = y + h;
  const near = sheet.bleed + MARK_GAP_MM * PT_PER_MM;
  const far = near + MARK_LENGTH_MM * PT_PER_MM;
  const shapes: MarkShapes = { lines: [], circles: [] };
  if (marks.crop) {
    for (const [cx, cy, sx, sy] of [[x, y, -1, -1], [right, y, 1, -1], [right, bottom, 1, 1], [x, bottom, -1, 1]] as const) {
      shapes.lines.push([cx + sx * near, cy, cx + sx * far, cy]);
      shapes.lines.push([cx, cy + sy * near, cx, cy + sy * far]);
    }
  }
  if (marks.registration) {
    const middle = (near + far) / 2;
    const half = MARK_LENGTH_MM * PT_PER_MM / 2;
    const radius = REGISTRATION_RADIUS_MM * PT_PER_MM;
    for (const [cx, cy] of [[x + w / 2, y - middle], [right + middle, y + h / 2], [x + w / 2, bottom + middle], [x - middle, y + h / 2]] as const) {
      shapes.circles.push([cx, cy, radius]);
      shapes.lines.push([cx - half, cy, cx + half, cy]);
      shapes.lines.push([cx, cy - half, cx, cy + half]);
    }
  }
  return shapes;
}
