// Che specie di documento è un file, dall'estensione: Word, OpenDocument,
// foglio di calcolo, disegno, nota. Lo dicono l'albero, le schede, il
// lanciatore e la testata del riquadro, perché il formato cambia che cosa si
// può fare.
//
// È una scelta di resa della shell, non il registro dei formati: quale
// provider apre il file lo decide il backend. Le estensioni sono quelle che
// dichiarano i formati ufficiali (`fub-format-rich`, `fub-format-xlsx`,
// `fub-format-canvas`, `fub-format-markdown`); l'SVG è il disegno di
// `fub.draw`. Un'estensione che qui non c'è non ha una specie, e resta com'era.
import { t, type Key } from "../i18n/strings";

export type FormatKind = "word" | "odt" | "sheet" | "drawing" | "note";

interface Known {
  readonly kind: FormatKind;
  /// L'etichetta accanto al percorso; nessuna per la nota, che è la casa.
  readonly tag?: string;
}

const BY_EXTENSION: Readonly<Record<string, Known>> = {
  docx: { kind: "word", tag: "WORD" },
  doc: { kind: "word", tag: "WORD 97" },
  dot: { kind: "word", tag: "WORD 97" },
  rtf: { kind: "word", tag: "RTF" },
  odt: { kind: "odt", tag: "ODT" },
  xlsx: { kind: "sheet", tag: "EXCEL" },
  xlsm: { kind: "sheet", tag: "EXCEL" },
  xltx: { kind: "sheet", tag: "EXCEL" },
  xltm: { kind: "sheet", tag: "EXCEL" },
  canvas: { kind: "drawing" },
  svg: { kind: "drawing", tag: "SVG" },
  md: { kind: "note" },
  markdown: { kind: "note" },
};

/// L'icona del set (`ui/icons.ts`) di ogni specie.
export const FORMAT_ICON: Readonly<Record<FormatKind, string>> = {
  word: "format-word",
  odt: "format-odt",
  sheet: "format-sheet",
  drawing: "format-drawing",
  note: "notes",
};

const FORMAT_NAME: Readonly<Record<FormatKind, Key>> = {
  word: "format.kind.word",
  odt: "format.kind.odt",
  sheet: "format.kind.sheet",
  drawing: "format.kind.drawing",
  note: "format.kind.note",
};

function known(id: string): Known | null {
  const base = id.split("#")[0]!.split("/").pop() ?? "";
  const point = base.lastIndexOf(".");
  if (point <= 0) return null;
  return BY_EXTENSION[base.slice(point + 1).toLowerCase()] ?? null;
}

export function formatKindOf(id: string): FormatKind | null {
  return known(id)?.kind ?? null;
}

/// «WORD», «ODT», «EXCEL»: `null` per una nota o un file senza specie.
export function formatTagOf(id: string): string | null {
  return known(id)?.tag ?? null;
}

/// Il nome della specie, per il lettore di schermo: «Documento di Word».
export function formatNameOf(kind: FormatKind): string {
  return t(FORMAT_NAME[kind]);
}
