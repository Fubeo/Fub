// I tipi del confine per il disegno sul motore
// (rispecchiati a mano dal Rust; `contract.ts` li ri-esporta).
import type {
  DrawingLossKind,
  DrawingOverlayRole,
  DrawingPhase,
  DrawingPointerKind,
  DrawingRefusal,
} from "./enums.generated";
import type { UiNode } from "./contract-ui";

// ---------------------------------------------------------------------------
// Il disegno sul motore (rispecchia `fub_abi::drawing`, K5)
// ---------------------------------------------------------------------------
//
// Il client resta lo scrittore del file: il motore del disegno tiene una copia
// che segue il testo della `DocumentSession` (`DrawingSync`), ci fa girare i
// suoi strumenti con i campioni della penna (`DrawingGesture`) e risponde con
// le operazioni di scena da applicare in un passo di annullamento
// (`DrawingOutcome.ops`). Le revisioni sono `u64` e viaggiano come stringhe.
// Le portano i sei comandi del disegno (`docs/reference/drawing-ipc.md`).

/** Il testo di un disegno, al più (`fub_scene::MAX_EDIT_BYTES`). */
export const MAX_DRAWING_TEXT_BYTES = 20 * 1024 * 1024;

/** Gli eventi di una sola richiesta di gesto, al più. */
export const MAX_GESTURE_EVENTS = 100_000;

/** Le operazioni di un esito, e gli id di una selezione, al più (`MAX_BATCH`). */
export const MAX_DRAWING_OPS = 10_000;

/** Il JSON delle operazioni di un esito, al più (`MAX_OP_BYTES`). */
export const MAX_DRAWING_OPS_BYTES = 8 * 1024 * 1024;

/** Le parti che il motore non sa modificare, elencate al più. */
export const MAX_DRAWING_LOSSES = 50_000;

/** Un colore dello stile, al più. */
export const MAX_DRAWING_COLOR_BYTES = 64;

/** Colore del tratto: `value` è il colore. */
export const DRAWING_COMMAND_STROKE_COLOR = "disegno.colore-tratto";

/** Colore del riempimento: `value` è il colore, o `null` per nessuno. */
export const DRAWING_COMMAND_FILL_COLOR = "disegno.colore-riempimento";

/** Spessore del tratto: `value` è un numero, zero o più. */
export const DRAWING_COMMAND_WIDTH = "disegno.spessore";

/** Un'opzione di uno strumento del motore: `value` è
 *  `{ strumento: id, chiave: nome, valore: JSON }`. */
export const DRAWING_COMMAND_TOOL_OPTION = "disegno.strumento.opzione";

/** Lo stato di uno strumento del motore, senza cambiare niente: `value` è
 *  `{ strumento: id }`; l'esito porta lo `state`, senza operazioni. */
export const DRAWING_COMMAND_TOOL_STATE = "disegno.strumento.stato";

/** Prepara una famiglia di comandi del motore: `value` è `{ famiglia: id }`,
 *  con l'id fra `DRAWING_FAMILIES`. */
export const DRAWING_COMMAND_FAMILY_PREPARE = "disegno.famiglia.prepara";

/** Le 26 famiglie della mappa del motore (`crates/fub-disegno/mappa.tsv`). */
export const DRAWING_FAMILIES = [
  "aspetto", "automazione", "colore", "dati", "dinamici", "effetti", "formati",
  "forme", "grafici", "immagini", "livelli", "nucleo", "pennelli", "prospettiva",
  "pulizia", "raster", "simboli", "stampa", "tavole", "testo", "tracciati",
  "trame", "trasforma", "tre-d", "vista", "web",
] as const;

/** L'id di uno strumento del motore, al più (ASCII: lettere, cifre, `_`, `-`). */
export const MAX_DRAWING_TOOL_ID_BYTES = 64;

/** Gli ingressi da tastiera di una sola richiesta di gesto, al più. */
export const MAX_DRAWING_INPUTS = 10_000;

// Che specie di parte resta com'è; la fase e la specie di un evento del
// gesto; perché un gesto non ha fatto niente (`locked` e `hidden` sono il
// livello bloccato o nascosto, come negli strumenti di oggi; `no_memory`,
// `no_preview` e `unknown_tool` vengono dagli strumenti e dai comandi del
// motore); il ruolo di un segno, che il client colora con i suoi token.
export type {
  DrawingLossKind,
  DrawingOverlayRole,
  DrawingPhase,
  DrawingPointerKind,
  DrawingRefusal,
} from "./enums.generated";

/** Lo strumento di un gesto: uno dei sei di K5, o uno del motore per id
 *  (`{ engine: { id: "pen" } }`, T4 di K6). */
export type DrawingTool =
  | "select"
  | "rect"
  | "ellipse"
  | "line"
  | "arrow"
  | "text"
  | { engine: { id: string } };

/** I modificatori di un tasto; un campo che manca vale `false`. */
export interface DrawingKeyMods {
  shift?: boolean;
  /** Option su macOS. */
  alt?: boolean;
  /** Ctrl su Windows e Linux, ⌘ su macOS. */
  cmd?: boolean;
  /** Ctrl su macOS (altrove è `cmd`). */
  ctrl?: boolean;
}

/** Un ingresso da tastiera di un gesto con uno strumento del motore: lo
 *  strumento lo vede dopo i puntatori della stessa richiesta. `active` è
 *  `[da, a)` in caratteri Unicode di `preedit`, non in unità UTF-16. */
export type DrawingInput =
  | { kind: "key"; key: string; code: string; mods?: DrawingKeyMods; pressed: boolean }
  | { kind: "text"; text: string }
  | { kind: "ime"; preedit: string; active?: [number, number] | null };

/** Un punto `[x, y]` in coordinate di scena. */
export type DrawingPoint = [number, number];

/** Un segno di uno strumento del motore, in coordinate di scena; `width` e
 *  `size` sono pixel dello schermo. I testi di `label`, `measure` e
 *  `distance` vengono dal motore. */
export type DrawingOverlay =
  | { kind: "marquee"; rect: [number, number, number, number] }
  | { kind: "path"; d: string; role: DrawingOverlayRole; width: number; dashed: boolean }
  | { kind: "line"; a: DrawingPoint; b: DrawingPoint; role: DrawingOverlayRole; dashed: boolean }
  | { kind: "anchor"; at: DrawingPoint; role: DrawingOverlayRole; filled: boolean; size: number }
  | { kind: "curve_point"; at: DrawingPoint; role: DrawingOverlayRole; filled: boolean; size: number }
  | { kind: "handle"; at: DrawingPoint; role: DrawingOverlayRole }
  | { kind: "label"; at: DrawingPoint; text: string; role: DrawingOverlayRole }
  | { kind: "measure"; at: DrawingPoint; text: string }
  | { kind: "distance"; a: DrawingPoint; b: DrawingPoint; text: string; role: DrawingOverlayRole }
  | { kind: "highlight"; quad: [DrawingPoint, DrawingPoint, DrawingPoint, DrawingPoint]; role: DrawingOverlayRole }
  | { kind: "swatch"; at: DrawingPoint; color: string; selected: boolean }
  | { kind: "grid_line"; a: DrawingPoint; b: DrawingPoint; role: DrawingOverlayRole };

/** Lo stato dello strumento del motore fra un gesto e l'altro. */
export interface DrawingToolState {
  /** Un'interazione è in corso (un trascinamento, un tracciato aperto). */
  busy: boolean;
  transforming: boolean;
  /** Lo strumento vuole il testo: le scorciatoie a un tasto non partono. */
  wants_text: boolean;
  /** Un IME sta componendo: tasti, scorciatoie e annulla aspettano. */
  composing: boolean;
  /** Il puntatore in `snake_case` (`arrow`, `pen_close`); uno sconosciuto è la freccia. */
  cursor: string;
  /** Le opzioni dello strumento, `null` se non ne ha. */
  options: unknown;
  /** I punti di ancoraggio scelti dal gesto; manca se nessuno. */
  anchors?: DrawingAnchor[];
  /** Lo strumento a cui il gesto chiede di passare (il doppio clic su un testo
   *  passa al Testo); manca se nessuno. */
  switch_tool?: string;
  /** I tasti (`Delete`, `Backspace`, `Escape`, `Enter`) che lo strumento prende
   *  prima delle scorciatoie: vanno a lui come tasti del gesto; manca se nessuno. */
  claims_keys?: string[];
}

/** Un punto di ancoraggio scelto, in coordinate di scena: torna nel `value`
 *  dei comandi sui punti (`anchors`), e vale solo se sta ancora lì. */
export interface DrawingAnchor {
  element: string;
  subpath: number;
  anchor: number;
  at: DrawingPoint;
  /** Il primo o l'ultimo punto di un sottotracciato aperto. */
  end: boolean;
}

/** Perché un comando è spento: il client lo dice con i suoi testi; `other`
 *  porta il testo del motore. */
export type DrawingDisabledReason =
  | "no_selection"
  | "needs_path"
  | "needs_text"
  | "needs_group"
  | "needs_two"
  | "needs_anchors"
  | "fub_ink"
  | "read_only"
  | "unmapped"
  | { other: { text: string } };

/** Una parte del disegno che il motore non sa modificare. */
export interface DrawingLoss {
  /** L'id dell'elemento, o il suo percorso se non ne ha uno. */
  element: string;
  kind: DrawingLossKind;
  detail: string;
}

/** Il disegno aperto nel motore. */
export interface DrawingOpen {
  instance: string;
  revision: string;
  mapped: number;
  unmapped: number;
  losses: DrawingLoss[];
}

/** Un intervallo sostituito, in unità UTF-16 sul testo LF (come `TextEdit`). */
export interface DrawingEdit {
  from: number;
  to: number;
  deleted: string;
  inserted: string;
}

/** La differenza dal testo della copia, o il testo intero. */
export type DrawingChange =
  | { kind: "edits"; value: { edits: DrawingEdit[]; length_before: number; length_after: number } }
  | { kind: "text"; value: { text: string } };

export interface DrawingSync {
  revision: string;
  change: DrawingChange;
}

export interface DrawingSynced {
  revision: string;
}

/** Un campione della penna, in coordinate di scena. */
export interface DrawingPointer {
  kind: DrawingPointerKind;
  x: number;
  y: number;
  /** Da 0 a 1; 0 al rilascio. */
  pressure: number;
  shift: boolean;
  alt: boolean;
  /** Ctrl su Windows e Linux, ⌘ su macOS. */
  cmd: boolean;
}

/**
 * La griglia magnetica: `grid` è il passo (`null` se spenta), `free` Ctrl/⌘ tenuto.
 * Gli interruttori di Visualizza per gli strumenti del motore, assenti se valgono
 * quelli di VectorCraft: `guides` le guide sensibili (accese), `points` l'aggancio
 * al punto (acceso), `glyphs` l'aggancio ai glifi (spento).
 */
export interface DrawingSnap {
  grid: number | null;
  free: boolean;
  guides?: boolean;
  points?: boolean;
  glyphs?: boolean;
}

export interface DrawingStyle {
  stroke: string;
  width: number;
  fill: string | null;
}

/** Una richiesta di gesto: gli eventi nuovi dall'ultima dello stesso gesto. */
export interface DrawingGesture {
  revision: string;
  phase: DrawingPhase;
  tool: DrawingTool;
  layer: string | null;
  selection: string[];
  zoom: number;
  snap: DrawingSnap;
  style: DrawingStyle | null;
  /** La riga del testo nuovo, solo per `text`. */
  text: string | null;
  /** La cornice che il client tiene per più oggetti scelti; `null` se non ne
   *  tiene una. Il Rust la legge anche assente (`#[serde(default)]`). */
  frame: DrawingFrame | null;
  events: DrawingPointer[];
  /** Tasti, testo e IME, solo per uno strumento del motore; può mancare. */
  inputs?: DrawingInput[];
  /** I punti scelti prima del gesto, come li ha detti lo stato dello
   *  strumento (al più 1000, come lì); solo per uno strumento del motore;
   *  può mancare. Il motore lascia quelli che non stanno più lì. */
  anchors?: DrawingAnchor[];
}

/** La cornice di trasformazione che il client tiene (`Frame` di
 *  `tools/frame.ts`): la matrice dalle sue coordinate alla scena
 *  `[a, b, c, d, e, f]`, il riquadro col contorno e quello della geometria
 *  `[x0, y0, x1, y1]` nelle sue coordinate. */
export interface DrawingFrame {
  matrix: [number, number, number, number, number, number];
  bounds: [number, number, number, number];
  geometry: [number, number, number, number];
}

/** L'anteprima del gesto: la forma nuova (un `Elem` della scena), la matrice
 *  della selezione `[a, b, c, d, e, f]`, il riquadro `[x, y, larghezza, altezza]`. */
export interface DrawingPreview {
  shape: unknown | null;
  matrix: [number, number, number, number, number, number] | null;
  marquee: [number, number, number, number] | null;
  /** I segni di uno strumento del motore, nell'ordine in cui si disegnano. */
  overlays?: DrawingOverlay[];
}

export interface DrawingOutcome {
  revision: string;
  preview: DrawingPreview | null;
  /** Il JSON di un array di operazioni di scena, per `parseWireOp`. */
  ops: string | null;
  selection: string[];
  losses: DrawingLoss[];
  refused: DrawingRefusal | null;
  /** La cornice che il client tiene per la selezione dopo, com'è diventata
   *  (la forma di `DrawingGesture.frame`); `null`: nessuna. */
  frame: DrawingFrame | null;
  /** Lo strumento del motore dopo il gesto o dopo un'opzione; `null` per gli
   *  strumenti di K5 e per i comandi. */
  state?: DrawingToolState | null;
  /** La lettura di un comando che legge e non cambia niente; `null` per gli altri. */
  reading?: unknown;
}

export interface DrawingCommandInfo {
  id: string;
  enabled: boolean;
  /** Perché è spento; `null` se è acceso. */
  disabled_reason?: DrawingDisabledReason | null;
}

export interface DrawingCommandRequest {
  revision: string;
  id: string;
  selection: string[];
  value: unknown;
  /** L'anteprima: il comando gira su una copia e le operazioni non entrano
   *  nella cronologia; chi non ne sa dare risponde `no_preview`. Può mancare
   *  (vale `false`). */
  preview?: boolean;
}

// **Da cosa parte** una scrittura intera (rispecchia `fub_abi::edit::WriteBase`).
// Tag adiacente (`kind` + `value`) come `LinkTarget`: un caso porta uno scalare
// e l'altro niente.
//
// Due casi e non una revisione opzionale, ed è la
// [0092](../../../docs/decisions/0187-autorita-e-schemi-su-disco.md): finché era
// `string | null` col default `null`, scrivere ciechi era ciò che succedeva
// **omettendo** — cioè il default, che non lo sceglie nessuno. Adesso chi copre
// una scrittura altrui lo scrive, e chi legge questa riga lo vede.
export type WriteBase =
  // «Scrivi solo se il file è ancora quello da cui sono partito»: se non
  // combacia, `PluginError` di specie `conflict` e non è stato scritto niente.
  | { kind: "descends_from"; value: string }
  // «Scrivi: questo testo non discende da un testo di prima, e se ne copre uno
  // è voluto» — nella shell è un posto solo, «vince il mio testo».
  | { kind: "dictated" };

// Un documento **reso**: l'HTML, e le parti dichiarative che la shell monta da
// sé (rispecchia `fub_kernel::RenderedDocument`).
//
// Non è una stringa sola perché un blocco custom può uscire come albero `UiNode`
// invece che come markup (§3.2): l'HTML porta un buco `data-ui-slot="N"` e la
// parte con quel numero ci va dentro, montata con lo stesso `mountTree` delle
// view. È così che il blocco di un plugin arriva a schermo senza una riga in
// questo bundle.
export interface RenderedDocument {
  html: string;
  parts: RenderedPart[];
}

export interface RenderedPart {
  slot: number;
  /// Il `custom_kind` che l'ha prodotta: serve al CSS e a chi legge un log.
  kind: string;
  node: UiNode;
}

// `EmbedContent` porta un `RenderedDocument` appiattito (`#[serde(flatten)]`):
// un embed passa dai renderer come l'anteprima.
export interface EmbedContent extends RenderedDocument {
  doc_id: string;
}

// Intervallo in byte (rispecchia fub_abi::model::Span).
export interface Span {
  start: number;
  end: number;
}
