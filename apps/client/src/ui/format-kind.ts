// Che specie di documento è un file, dall'estensione: Word, OpenDocument,
// foglio di calcolo, disegno, nota. Lo dicono l'albero, le schede, il
// lanciatore e la testata del riquadro, perché il formato cambia che cosa si
// può fare.
//
// È una scelta di resa della shell, non il registro dei formati: quale
// provider apre il file lo decide il backend. Le estensioni sono quelle che
// dichiarano i formati ufficiali (`fub-format-rich`, `fub-format-xlsx`,
// `fub-format-canvas`, `fub-format-markdown`, `fub-format-craft`); l'SVG è il
// disegno di `fub.draw`. I file delle app Craft hanno la sigla dell'app: un
// disegno di VectorCraft o un progetto di FigCraft sono disegni, un'immagine di
// PhotoCraft e l'XMP che LightCraft scrive accanto a una foto sono foto.
// Una foto RAW è una foto, con la sigla della sua estensione: «CR3», «NEF».
// Un'estensione che qui non c'è non ha una specie, e resta com'era.
import { t, type Key } from "../i18n/strings";

export type FormatKind = "word" | "odt" | "sheet" | "drawing" | "photo" | "note";

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
  vectorcraft: { kind: "drawing", tag: "VECTORCRAFT" },
  figcraft: { kind: "drawing", tag: "FIGCRAFT" },
  pcraft: { kind: "photo", tag: "PHOTOCRAFT" },
  xmp: { kind: "photo", tag: "XMP" },
  md: { kind: "note" },
  markdown: { kind: "note" },
};

/// L'icona del set (`ui/icons.ts`) di ogni specie.
export const FORMAT_ICON: Readonly<Record<FormatKind, string>> = {
  word: "format-word",
  odt: "format-odt",
  sheet: "format-sheet",
  drawing: "format-drawing",
  photo: "format-photo",
  note: "notes",
};

const FORMAT_NAME: Readonly<Record<FormatKind, Key>> = {
  word: "format.kind.word",
  odt: "format.kind.odt",
  sheet: "format.kind.sheet",
  drawing: "format.kind.drawing",
  photo: "format.kind.photo",
  note: "format.kind.note",
};

/// Le estensioni delle foto RAW, senza il punto: le stesse di
/// `RAW_EXTENSIONS` in `crates/fub-format-craft/src/contract.rs`, che un test
/// tiene allineate.
export const RAW_EXTENSIONS: readonly string[] = ["cr3", "cr2", "nef", "arw", "raf", "dng", "orf", "rw2"];

function extensionOf(id: string): string | null {
  const base = id.split("#")[0]!.split("/").pop() ?? "";
  const point = base.lastIndexOf(".");
  return point <= 0 ? null : base.slice(point + 1).toLowerCase();
}

/// Una foto RAW, dall'estensione e in qualunque maiuscola.
export function isRawPhoto(id: string): boolean {
  const extension = extensionOf(id);
  return extension !== null && RAW_EXTENSIONS.includes(extension);
}

function known(id: string): Known | null {
  const extension = extensionOf(id);
  if (extension === null) return null;
  if (RAW_EXTENSIONS.includes(extension)) return { kind: "photo", tag: extension.toUpperCase() };
  return BY_EXTENSION[extension] ?? null;
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
