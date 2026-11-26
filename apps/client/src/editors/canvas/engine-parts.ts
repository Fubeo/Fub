// Il motore della lavagna: i tipi interni dei gesti e delle schede, le
// costanti del tocco e dello zoom, gli aiuti dei tasti. Tolti da `engine.ts`.

import { type Key } from "../../i18n/strings";
import { type SurfaceMenuItem } from "../core/editor-menu";
import { EraseSweep, type Spot } from "../../ink/tools/sweep";
import { type Lifetime } from "../../ui/lifetime";
import { StrokeBox } from "./anchor";
import { type CardSize, type CardTextEditor, type CardView, type Rect } from "../core/cards/contract";
import { type CardDetail } from "./lod";
import { InkEraseSource, inkKey, type CutPiece, type ErasableInk, type InkEraserMode } from "./ink-erase";
import { type CanvasCommandArgs } from "./chrome/commands";
import { type FindMark } from "./find";
import { type CropEditor } from "./crop";
import { type ZoomLimits } from "./touch";
import { type ScaleLimits } from "../../spatial/camera";
import { type InkLayerRef, type InkLayerState } from "./ink-record";
import { type CanvasPatch } from "./operation";
import { type CanvasDocument, type CanvasNode } from "./model";
import { type EdgeSide } from "./edges";
import { type CanvasCheckReport, type CanvasInkLayer } from "./wasm/core";

export type CardField = "text" | "label" | "url" | "file";

/** Il campo aperto su una scheda. */
export interface CardEditor {
  readonly id: string;
  readonly field: CardField;
  /**
   * Il campo semplice: c'è sempre, ed è dove si scrive finché l'editor delle
   * note non lo sostituisce (la scheda di testo, T43), o se non si monta.
   */
  readonly input: HTMLInputElement | HTMLTextAreaElement;
  /** Dove si scrive adesso: il campo semplice, o il contenitore dell'editor delle note. */
  place: HTMLElement;
  /** L'editor delle note in Live sopra il testo della scheda (T43), quando c'è. */
  live: CardTextEditor | null;
  readonly article: HTMLElement;
  readonly lifetime: AbortController;
  /** Una composizione dell'IME o un tasto morto in corso: la pausa aspetta la sua fine. */
  composing: boolean;
  /** Invio in una scheda di testo: l'a capo che arriva si registra subito. */
  recordOnInput: boolean;
  /**
   * La scheda è nata adesso per essere scritta (lo strumento Testo,
   * Ctrl+Invio): il passo d'annulla che l'ha messa. Lasciata vuota se ne va
   * con lui (T44). `null` per una scheda che c'era già.
   */
  readonly born: CanvasStep | null;
  /** La misura a cui la scheda di testo è cresciuta mentre ci si scrive (T44); `null` finché non cresce. */
  grown: { readonly width: number; readonly height: number } | null;
  /**
   * Il punto della finestra del doppio clic che ha aperto la scheda di testo:
   * l'editor delle note ci mette il cursore, come ogni editor di testo
   * (IMP-3808). `null` senza un punto (Invio, una scheda nuova).
   */
  readonly point: { readonly x: number; readonly y: number } | null;
}

/** L'ultimo incolla scritto: il testo, il punto sulla griglia e quante volte di fila lì. */
export interface LastPaste {
  readonly raw: string;
  readonly x: number;
  readonly y: number;
  readonly count: number;
}

/**
 * Una scelta della finestra di «Incolla codice» (LIC T25): la lista così come
 * si scrive, il riassunto in parole (`""` se non cambia niente o non si può)
 * e il controllo del nucleo che lo dice.
 */
export interface PasteChoice {
  readonly id: "paste" | "update" | "copies";
  readonly ops: readonly unknown[];
  readonly said: string;
  readonly report: CanvasCheckReport;
}

/**
 * Un passo d'annulla (o di ripeti). Due vie per farlo: se il testo è ancora
 * quello che il passo ha lasciato (`version`), si rimette il tratto `removed`
 * al posto di `inserted`, byte per byte, e il testo torna alla sua versione di
 * prima (`restores`); se no si passano `patches` al nucleo, che le fonde con
 * ciò che è cambiato da un'altra parte.
 */
export interface CanvasStep {
  /** Le toppe che fanno questo passo sul modello di adesso. */
  readonly patches: CanvasPatch[];
  /** Le toppe che disfano questo passo: valgono sul testo che il passo rimette. */
  readonly back: CanvasPatch[];
  /** Dove comincia il tratto, in unità UTF-16. */
  readonly start: number;
  /** Il tratto del testo di adesso che il passo toglie. */
  readonly inserted: string;
  /** Il tratto che il passo rimette al suo posto. */
  readonly removed: string;
  /** La versione del testo che il passo ha lasciato: se è ancora quella, la via è il tratto. */
  readonly version: number;
  /** La versione del testo che il passo rimette. */
  readonly restores: number;
}

/**
 * Un tratto spezzato al limite dei campioni (`split`) che continua nel pezzo
 * dopo: il passo che tiene i pezzi già scritti e il testo di prima del primo
 * pezzo. Il pezzo dopo si fonde in quel passo (A4).
 */
export interface InkChain {
  readonly step: CanvasStep;
  readonly before: string;
}

/**
 * Una passata della gomma: il tratto dell'adattatore che la fa, il registro
 * di ciò che ha preso e i tratti disegnati che può prendere, fissati quando
 * comincia. Con `"piece"` (T22) anche il cammino fatto, in coordinate della
 * lavagna, e il taglio di adesso di ogni tratto toccato, per chiave.
 */
/**
 * Il trascinamento delle schede in corso: le schede scelte (`ids`), ognuna
 * col suo posto di partenza in `origin` insieme a ciò che i gruppi scelti
 * portano, e lo spostamento di adesso (`dx`, `dy`, in unità intere della
 * lavagna), lo stesso per tutte: al rilascio è una `move` (T24).
 */
export interface CardDrag {
  readonly pointerId: number;
  startX: number;
  startY: number;
  readonly ids: readonly string[];
  readonly origin: Map<string, { x: number; y: number }>;
  moved: boolean;
  /** Lo spostamento di adesso, in unità intere: la scheda segue il puntatore 1:1. */
  dx: number;
  dy: number;
  /**
   * Dove andrà lasciandola (#411 C-05): la guida che vince o la griglia di
   * `canvas.snap_step`. Uguale a `dx`/`dy` con Alt o con l'aggancio spento.
   */
  aimDx: number;
  aimDy: number;
}

/**
 * I riquadri tratteggiati di un trascinamento di file (T24): quanti file,
 * il punto agganciato in cui il nucleo li ha disposti, le schede e il gruppo
 * oltre i dodici, in coordinate della lavagna.
 */
export interface DropGhost {
  readonly count: number;
  readonly x: number;
  readonly y: number;
  readonly cards: readonly Rect[];
  readonly group: Rect | null;
}

export interface InkErase {
  readonly id: number;
  readonly sweep: EraseSweep<ErasableInk>;
  readonly source: InkEraseSource;
  readonly mode: InkEraserMode;
  readonly path: Spot[];
  readonly cuts: Map<string, InkErasing>;
  /** Il raggio della gomma in unità della lavagna, allo zoom dell'ultimo passo: `erase_along` lo scrive. */
  radius: number;
}

/** Un tratto che la gomma «Solo il pezzo» sta tagliando. */
export interface InkErasing {
  readonly unit: ErasableInk;
  readonly pieces: readonly CutPiece[];
  /** Il contorno dei pezzi, per l'anteprima. */
  readonly preview: string;
}

// --- a chi appartiene il tratto (T69) ---
/**
 * Il tratto della punta in corso e l'ancora che avrebbe se finisse adesso: il
 * riquadro cresce coi punti che la vista vede (`pointermove`, dopo la scia),
 * il bordo tratteggiato e il testo dell'etichetta cambiano solo quando cambia
 * l'ancora.
 */
/**
 * Lo spostamento col Lazo (T86): le schede scelte e i tratti scelti insieme,
 * di `dx`, `dy` unità della lavagna. Le schede si muovono nel modello in mano
 * come in `#drag`; i tratti si vedono spostati sullo strato del lazo, sopra
 * gli originali attenuati, e al rilascio vanno nel file in un commit solo.
 */
export interface StrokeDrag {
  readonly pointerId: number;
  readonly startX: number;
  readonly startY: number;
  /** Le schede che si spostano, con la posizione di partenza. */
  readonly origin: Map<string, { x: number; y: number }>;
  /** I tratti scelti, come erano alla partenza. */
  readonly units: readonly ErasableInk[];
  /** Dove sta la vista sullo schermo, letto alla partenza. */
  readonly view: DOMRect;
  moved: boolean;
  dx: number;
  dy: number;
  /** L'ultimo punto del puntatore, per rifare la scheda quando cambia Alt. */
  clientX: number;
  clientY: number;
  /** La scheda che prenderà i tratti, `null` se restano liberi; `undefined` prima del primo giro. */
  holder: string | null | undefined;
}

/** Lo strato del lazo sullo stage (T86): i tratti scelti, la loro cornice, il giro in corso. */
export interface LassoLayer {
  readonly svg: SVGSVGElement;
  readonly chosen: SVGGElement;
  readonly frame: SVGRectElement;
  readonly path: SVGPathElement;
}

/** Lo strato del rettangolo sullo stage (N6 T20b): un solo riquadro, in coordinate della lavagna. */
export interface MarqueeLayer {
  readonly svg: SVGSVGElement;
  readonly box: SVGRectElement;
}

/**
 * Un trascinamento nel vuoto con la Selezione (N6 T20b): il rettangolo tra il
 * punto di partenza e quello di adesso, in coordinate della lavagna. `base` è la
 * scelta com'era all'inizio, da cui Maiusc aggiunge e Esc torna.
 */
export interface MarqueeGesture {
  readonly pointerId: number;
  readonly startX: number;
  readonly startY: number;
  readonly from: { x: number; y: number };
  to: { x: number; y: number };
  readonly additive: boolean;
  /** Il puntatore è andato oltre la soglia: è un rettangolo, non un clic. */
  moved: boolean;
  readonly base: { readonly nodes: readonly string[]; readonly edges: readonly string[]; readonly strokes: ReadonlySet<string> };
}

/** I tratti di `units` per livello, nell'ordine in cui arrivano. */
export function strokesByLayer(units: readonly ErasableInk[]): { readonly layer: InkLayerRef; readonly ids: string[] }[] {
  const groups = new Map<string, { readonly layer: InkLayerRef; readonly ids: string[] }>();
  for (const unit of units) {
    const key = unit.node === null ? "board" : `node\u0000${unit.node}`;
    let group = groups.get(key);
    if (!group) {
      group = { layer: unit.layer, ids: [] };
      groups.set(key, group);
    }
    group.ids.push(unit.id);
  }
  return [...groups.values()];
}

/**
 * Le chiavi dei tratti scelti dopo le toppe `patches`: un tratto tolto da un
 * livello e aggiunto a un altro (`move_strokes` con `to`) resta scelto dove è
 * andato, col suo id nuovo se l'ha cambiato.
 */
export function keysAfter(chosen: ReadonlySet<string>, patches: readonly CanvasPatch[]): Set<string> {
  const keys = new Set(chosen);
  let carried = 0;
  for (const patch of patches) {
    if (patch.kind !== "ink") continue;
    if (patch.before && !patch.after && keys.delete(inkKey(patch.layer, patch.before.id))) carried += 1;
    else if (!patch.before && patch.after && carried > 0) {
      keys.add(inkKey(patch.layer, patch.after.id));
      carried -= 1;
    }
  }
  return keys;
}

/** Un seme per gli id nuovi del nucleo: 64 bit a caso. */
export function randomSeed(): bigint {
  const word = new BigUint64Array(1);
  crypto.getRandomValues(word);
  return word[0]!;
}

export interface InkTarget {
  readonly pointerId: number;
  readonly box: StrokeBox;
  /** Lo spessore del tratto in unità della lavagna: il pennello che la scia usa. */
  readonly size: number;
  /** Dove sta la vista sullo schermo, letto all'inizio del tratto: nessuna lettura del layout mentre si scrive. */
  readonly view: DOMRect;
  readonly label: HTMLElement;
  /** Il contenitore dei quattro lati del bordo, sullo stage. */
  readonly frames: HTMLElement;
  /** L'id della scheda mostrata, `null` se il tratto è libero; `undefined` prima del primo giro. */
  holder: string | null | undefined;
}

/**
 * L'etichetta e i lati del bordo, nati al primo tratto e tenuti per i tratti
 * dopo (nascosti a penna su): un tratto che comincia non crea nodi e non
 * chiede il layout. La misura dell'etichetta arriva da un `ResizeObserver`,
 * dopo il layout che il browser fa comunque: mai una lettura forzata.
 */
export interface InkMarks {
  readonly label: HTMLElement;
  /**
   * Il bordo tratteggiato attorno alla scheda: quattro lati sottili in un
   * contenitore sullo stage, non il contorno della scheda. Mostrarlo o
   * toglierlo ridipinge solo i lati: il contorno ridipingerebbe tutta la
   * scheda (una tabella di diecimila celle in S8) due volte per tratto. Il
   * contenitore resta sullo stage: un tratto non vi aggiunge né toglie nodi.
   */
  readonly frames: HTMLElement;
  /** La misura dell'etichetta e lo stacco dalla punta; zero finché non è misurata. */
  width: number;
  height: number;
  gap: number;
}

/** I quattro lati del bordo tratteggiato della scheda sotto la penna. */
export const INK_FRAME_SIDES = ["top", "right", "bottom", "left"] as const;

/** Il punto dove comincia il tratto che sta per nascere: l'ultimo appoggio, poi l'ultimo movimento visto. */
export interface InkPoint {
  pointerId: number;
  clientX: number;
  clientY: number;
}

/** Il tasto che fa scrivere il mouse finché è giù (regola 1). */
export function isInkKey(event: KeyboardEvent): boolean {
  return event.key.toLowerCase() === "d";
}

/** I comandi della vista che cambiano lo zoom: valgono anche fuori dalla vista (IMP-040). */
export const VIEW_ZOOM_COMMANDS: ReadonlySet<string> = new Set(["canvas.zoom_in", "canvas.zoom_out", "canvas.zoom_reset", "canvas.fit"]);

/** I comandi della storia: valgono anche col fuoco su un pulsante fuori dalla vista (IMP-6300). */
export const HISTORY_COMMANDS: ReadonlySet<string> = new Set(["canvas.undo", "canvas.redo"]);

/** Il tasto Menu o Maiusc+F10: il menu del tasto destro dalla tastiera (IMP-6301). */
export function isMenuKey(event: KeyboardEvent): boolean {
  if (event.ctrlKey || event.metaKey || event.altKey) return false;
  return (event.key === "ContextMenu" && !event.shiftKey) || (event.key === "F10" && event.shiftKey);
}

/** I campi senza testo: Ctrl+Z lì non ha niente da annullare, e va alla lavagna. */
const NO_TEXT_INPUTS: ReadonlySet<string> = new Set(["button", "checkbox", "color", "radio", "range", "reset", "submit"]);

/** Un campo che ha il suo annulla (il testo che si scrive): Ctrl+Z resta a lui. */
export function keepsItsUndo(target: EventTarget | null): boolean {
  if (target instanceof HTMLInputElement) return !NO_TEXT_INPUTS.has(target.type);
  return isTextTarget(target);
}

/** Un campo dove i tasti scrivono. */
export function isTextTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.tagName === "TEXTAREA" || target.tagName === "INPUT" || target.isContentEditable;
}

/** Gli stati dei livelli d'inchiostro, per il modello e i livelli del nucleo da cui vengono. */
export interface InkStates {
  readonly doc: CanvasDocument;
  readonly layers: readonly CanvasInkLayer[];
  readonly states: readonly InkLayerState[];
}

/** Il testo del campo non ancora registrato: la scheda com'era, il campo, il testo. */
export interface PendingText {
  card: CanvasNode;
  readonly field: CardField;
  text: string;
  /** La misura a cui la scheda di testo è cresciuta col testo (T44): va nello stesso commit. */
  size?: { readonly width: number; readonly height: number };
}

/**
 * Una voce del menu del tasto destro dal comando `id` del catalogo: `args`
 * dice su che cosa, `refocus` rimette il fuoco sulla tela dopo il gesto.
 */
/** Il ritaglio aperto su una scheda d'immagine (T78). */
export interface CropSession {
  readonly node: string;
  /** Il file della scheda quando si è aperto: se cambia, il ritaglio si chiude. */
  readonly path: string;
  editor: CropEditor | null;
  /** L'altezza che la scheda mostra intanto; `null` finché l'immagine non ha misure. */
  height: number | null;
}

export type MenuEntryMaker = (id: string, args?: CanvasCommandArgs, refocus?: boolean, extra?: Partial<SurfaceMenuItem>) => SurfaceMenuItem;

/**
 * «Colore ›» col colore di adesso segnato (`undefined` quello di serie, `null`
 * nessuno: colori diversi), le voci come scelte esclusive (T47).
 */
export type ColorMenuMaker = (current: string | null | undefined, args?: CanvasCommandArgs) => SurfaceMenuItem;

/**
 * Una scheda sulla scena, tenuta per id da una resa all'altra: l'elemento, il
 * corpo e ciò che lo tiene vivo (il Markdown montato, la vista del renderer).
 */
export interface CardEntry {
  readonly id: string;
  readonly article: HTMLElement;
  readonly title: HTMLElement;
  readonly connect: HTMLButtonElement;
  /** La scheda com'è nel documento di adesso. */
  node: CanvasNode;
  type: CanvasNode["type"];
  body: HTMLElement;
  /** La chiave del corpo (`cardBodyKey`): se cambia, il corpo si rifà; `null`, da rifare. */
  bodyKey: string | null;
  /** Le quattro maniglie agli angoli (T66); `null` in sola lettura. */
  resize: readonly HTMLElement[] | null;
  /** Lo smontaggio del Markdown di una scheda di testo. */
  teardown: (() => void) | null;
  /**
   * La vista del renderer e la sua vita; `null` col corpo di sempre. Col file
   * mancante la vita tiene l'ascolto del file e i gesti, al posto della vista.
   */
  view: CardView | null;
  viewLife: Lifetime | null;
  /** La misura che la vista conosce: quella del montaggio o dell'ultimo `resize()`. */
  viewSize: CardSize | null;
  /** Il titolo grande da lontano (T54): sempre nel nodo, lo mostra il CSS. */
  readonly far: HTMLElement;
  /** Il `data-card-detail` che la scheda ha adesso (`applyCardDetails`); `null` da vicino. */
  detail: CardDetail | null;
  /** Il segno della ricerca che la scheda ha adesso (`applyFindMarks`, T60); `null` senza ricerca. */
  find: FindMark;
  /**
   * Il file della scheda non c'è: la chiave della vista (`cardBodyKey`) con cui
   * il renderer l'ha detto. `null` se il file c'è, o non si sa.
   */
  missingFor: string | null;
  /** Il nome per il lettore di schermo scritto adesso su `article` (T61); `null` se non ancora. */
  label: string | null;
  /**
   * La scheda e il giro della lingua con cui la testata ha scritto i suoi nomi (il
   * titolo, quello da lontano, quello di →); `null` se non ancora. Uguali, la resa
   * non li ricalcola.
   */
  titled: { readonly node: CanvasNode; readonly round: number } | null;
}

export interface Viewport {
  x: number;
  y: number;
  zoom: number;
}

/** Un punto della scia di uno spostamento, in px del client, col suo tempo in ms (T53). */
export interface PanSample {
  readonly t: number;
  readonly x: number;
  readonly y: number;
}

/** Dove sta il puntatore di un trascinamento, e i tasti tenuti: ciò che serve per rifare il passo (T53). */
export type PointerAt = Pick<PointerEvent, "pointerId" | "clientX" | "clientY" | "shiftKey" | "altKey">;

/** Sotto il dito fanno come col mouse: i controlli sempre, le maniglie se la lavagna si cambia. */
export const FINGER_CONTROLS = "button, a, input, textarea, select, [contenteditable]:not([contenteditable='false'])";
/**
 * Fino a questa larghezza della finestra, in px, la colonna degli strumenti
 * sta sotto la lavagna; e così in un riquadro largo fino a `NARROW_PANE`,
 * anche in una finestra larga (gli stessi valori del disegno).
 */
export const NARROW_WIDTH = 700;
export const NARROW_PANE = 480;

/**
 * I nomi di «Apri a lato per questo» (T45), per il punto: accanto, o «qui»
 * nella finestra stretta, dove si apre nello stesso riquadro.
 */
export const BESIDE_HERE_NAMES = {
  beside: {
    cell: "canvas.open_beside.cell",
    section: "canvas.open_beside.section",
    page: "canvas.open_beside.page",
    none: "canvas.open_beside_here",
  },
  here: {
    cell: "canvas.open_here.cell",
    section: "canvas.open_here.section",
    page: "canvas.open_here.page",
    none: "canvas.open_here_this",
  },
} as const satisfies Record<"beside" | "here", Record<"cell" | "section" | "page" | "none", Key>>;
/** Il filo con cui nasce una scheda lasciata nel vuoto (T67): da `from`, dal lato `fromSide` se c'è. */
export interface CardLink {
  readonly from: string;
  readonly fromSide?: EdgeSide;
}

/**
 * Il filo che si sta tirando (T67): da `from`, partito dal punto `fromSide`
 * (senza: il lato lo sceglie `edges.ts` al rilascio), o l'estremità
 * `endpoint` del filo `edgeId` che si riattacca. `back`: il filo di
 * «Collega…», finito il quale la colonna torna alla Selezione. `moved` dice
 * se il puntatore si è mosso: un clic fermo su un punto non fa una scheda.
 */
export interface ConnectGesture {
  readonly pointerId: number;
  readonly from: string;
  readonly fromSide?: EdgeSide;
  readonly edgeId?: string;
  readonly endpoint?: "from" | "to";
  readonly back?: boolean;
  readonly startX: number;
  readonly startY: number;
  moved: boolean;
}

export const FINGER_HANDLES = ".canvas-node-handle, [data-resize], [data-resize-frame], [data-reconnect], [data-connect], .canvas-port";

/**
 * I gesti del dito (T63). Il tocco lungo apre il menu radiale (o, sopra una
 * scheda, il suo menu) dopo tanti ms con il dito fermo entro `TAP_SLOP_PX`.
 */
export const LONG_PRESS_MS = 500;
/** Due dita che toccano e si alzano entro tanti ms dal primo appoggio annullano, tre ripetono. */
export const FINGERS_TAP_MS = 250;
/** Il secondo tocco di un doppio tocco: entro tanti ms dal primo rilascio, e tanti px dal primo. */
export const DOUBLE_TAP_MS = 300;
export const DOUBLE_TAP_PX = 24;
/**
 * Il menu contestuale che il sistema manda dietro al tasto laterale della
 * penna o al tocco lungo non apre il menu della lavagna: per tanti ms dopo il
 * rilascio si ferma (come `ECHO_MS` del menu radiale).
 */
export const MENU_ECHO_MS = 500;

/** I limiti dello zoom, dal 5% al 400% (T53): la rotella, i tasti, i pulsanti e il pizzico. */
export const ZOOM_LIMITS: ZoomLimits = { min: 0.05, max: 4 };

export function clampZoom(zoom: number): number {
  return Math.min(ZOOM_LIMITS.max, Math.max(ZOOM_LIMITS.min, zoom));
}

// --- muoversi (T53) ---------------------------------------------------------

/** Il passo di + e −, lo stesso del disegno (`ZOOM_STEP` dei disegni, 1,25). */
export const CANVAS_ZOOM_STEP = 1.25;

/**
 * «Mostra tutto» non ingrandisce oltre il 100%, e lascia attorno alle schede
 * un margine di `FIT_MARGIN` unità della lavagna per lato, come prima.
 */
export const FIT_LIMITS: ScaleLimits = { min: ZOOM_LIMITS.min, max: 1 };
export const FIT_MARGIN = 80;

/** A meno di tanti px dal bordo della vista, un trascinamento la fa scorrere. */
export const EDGE_SCROLL_ZONE = 40;

/** La velocità dello scorrimento al bordo, in px dello schermo al ms, sul bordo e fuori. */
export const EDGE_SCROLL_MAX = 1.2;

/** L'inerzia parte solo da un dito che va almeno a tanto, in px al ms. */
export const INERTIA_MIN_SPEED = 0.05;

/**
 * Quanto resta il lampo di una scheda raggiunta da un link (T57): l'animazione
 * del CSS dura un po' meno; col movimento ridotto l'anello resta fermo per tutto.
 */
export const CARD_FLASH_MS = 1000;

/** La velocità del dito si misura sugli ultimi ms del gesto. */
export const INERTIA_WINDOW_MS = 100;

/** Il passo più lungo di un fotogramma, in ms: dopo una pausa del browser la vista non salta. */
export const MAX_FRAME_MS = 64;
