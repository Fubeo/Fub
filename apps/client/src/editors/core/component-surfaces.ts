// Gli editor legati a un componente (K2), descritti senza il loro codice:
// proprietario, famiglia, profili e formati, e le estensioni dei file che
// aprono. La shell li legge all'avvio per registrare in modo pigro e per
// riconoscere un file di un componente spento; il codice dell'editor arriva con
// un `import()` soltanto quando il componente è acceso e un file lo chiede.
//
// I valori sono quelli che le superfici dichiaravano accanto al loro codice
// (`editors/canvas/surface.ts`, `editors/spatial/modes.ts`,
// `editors/rich/surface.ts`), che ora li prendono da qui.

/// I pezzi di interfaccia del client che una riga di `components_map` carica
/// (il campo `ui`). `editors/text` è del nucleo: c'è sempre.
export const UI_TEXT = "editors/text";
export const UI_CANVAS = "editors/canvas";
export const UI_MEDIA = "editors/media";
export const UI_RICH = "editors/rich";
export const UI_GRID = "editors/grid";
export const UI_SPATIAL = "editors/spatial";

export const CANVAS_OWNER = "fub.shell.canvas";
export const CANVAS_FAMILY = "canvas" as const;
export const CANVAS_PROFILE = "canvas";
export const CANVAS_SOURCE_PROFILE = "source";
export const CANVAS_FORMAT = "canvas";
export const SVG_FORMAT = "svg";
export const FUBANN_FORMAT = "fubann";

/// I profili dei disegni di FubDraw nella famiglia `canvas`.
export const VECTOR_PROFILE = "vector";
export const PDF_PROFILE = "pdf";

export const RICH_OWNER = "fub.shell.rich";
export const RICH_FAMILY = "rich";
export const RICH_PROFILE = "document";
/// I formati che la superficie dei documenti apre, con il loro profilo. Se un
/// documento si scrive lo dice la sua proiezione (`readonly`), non il formato.
export const RICH_FORMATS: Readonly<Record<string, string>> = {
  docx: RICH_PROFILE,
  odt: RICH_PROFILE,
  rtf: RICH_PROFILE,
  doc: RICH_PROFILE,
};

export const GRID_OWNER = "fub.shell.grid";
export const GRID_FAMILY = "grid";
export const GRID_PROFILE = "workbook";
export const GRID_FORMAT = "xlsx";

export const VIEWER_OWNER = "fub.shell.viewer";
/// Il profilo PDF del visore: l'unico pezzo di `editors/media` che un
/// componente spegne (pdf.js e il suo worker). Immagini, audio e video sono
/// del nucleo.
export const MEDIA_PDF_PROFILE = "media-pdf";

/// Le estensioni dei file che ciascun pezzo apre, come le dichiarano i formati
/// dell'host (`fub-format-*`) e la tabella dei media della shell. Un SVG non
/// c'è: senza i disegni lo scrive il testo, accanto alla sua anteprima.
const FILES: ReadonlyArray<readonly [extension: string, uis: readonly string[]]> = [
  ["canvas", [UI_CANVAS]],
  ["pdf", [UI_MEDIA]],
  // Le annotazioni di un PDF sono un disegno sopra le pagine del PDF: servono
  // tutti e due.
  ["fubann", [UI_SPATIAL, UI_MEDIA]],
  ["docx", [UI_RICH]],
  ["odt", [UI_RICH]],
  ["rtf", [UI_RICH]],
  ["doc", [UI_RICH]],
  ["dot", [UI_RICH]],
  ["xlsx", [UI_GRID]],
  ["xlsm", [UI_GRID]],
  ["xltx", [UI_GRID]],
  ["xltm", [UI_GRID]],
];
const BY_EXTENSION = new Map(FILES);

/// I pezzi di interfaccia che servono a mostrare il file `id` nel suo editor:
/// vuoto per un file del nucleo. Il frammento di un PDF (`#page=3`) non conta.
export function uisForFile(id: string): readonly string[] {
  const path = id.split("#")[0] ?? id;
  const base = path.slice(path.lastIndexOf("/") + 1);
  const point = base.lastIndexOf(".");
  if (point <= 0) return [];
  return BY_EXTENSION.get(base.slice(point + 1).toLowerCase()) ?? [];
}

/// Le estensioni delle note: il testo è del nucleo, e le apre sempre.
const NOTE_EXTENSIONS: readonly string[] = ["md"];

/// Un editor e le estensioni dei file che apre, per chi deve dire che cosa si
/// apre dentro Fub (il riquadro della pagina «Componenti»).
export interface EditorFiles {
  readonly ui: string;
  readonly extensions: readonly string[];
}

/// Le note, poi ogni pezzo che si può spegnere con le estensioni che apre da
/// solo, nell'ordine della tabella. Le annotazioni di un PDF non hanno un
/// editor loro: chiedono il disegno e il PDF insieme, e non fanno riga.
export function editorFiles(): readonly EditorFiles[] {
  const byUi = new Map<string, string[]>();
  for (const [extension, uis] of FILES) {
    if (uis.length !== 1) continue;
    const ui = uis[0]!;
    const list = byUi.get(ui) ?? [];
    list.push(extension);
    byUi.set(ui, list);
  }
  return [
    { ui: UI_TEXT, extensions: NOTE_EXTENSIONS },
    ...[...byUi].map(([ui, extensions]) => ({ ui, extensions })),
  ];
}
