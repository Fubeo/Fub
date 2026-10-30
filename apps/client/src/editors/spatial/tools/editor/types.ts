// L'editor del disegno: i tipi dei gesti e dello stato, che più pezzi di
// createDrawEditor condividono.

import type { InkBrush } from "../../../../ink/brush";
import type { InkSample } from "../../../../ink/sample";
import type { InkPointerType } from "../../../../ink/input/pointer";
import type { StrokePreview } from "../../../../ink/tools/stroke";
import type { EraseSweep } from "../../../../ink/tools/sweep";
import type { Bounds } from "../../scene/geometry";
import type { Matrix, Point } from "../../scene/matrix";
import type { ElementPart } from "../../scene/model";
import type { Tool } from "../../scene/analysis";
import type { DrawKey } from "../../strings";
import { NewIds, type Destination } from "../edit";
import type { Board, Rect } from "../boards";
import type { SelectionFacts } from "../fields";
import type { GradientChange, GradientHandles, GradientPlace, GradientStop, GradientView, Painted, PaintChannel, PlaceGrip } from "../gradients";
import { ConnectorPreview, type EndInput, type LineEnd } from "../connectors";
import type { Ruler, RulerEdge } from "../ruler";
import type { Anchor } from "../../scene/connectors";
import type { Frame, Grip, ResizeGrip } from "../frame";
import { SceneIndex, type TextLook, type Unit } from "../hit";
import type { StrokeCut } from "../erase-precise";
import type { LibraryShape } from "../shape-library";
import type { ImageSight, ShapeSight } from "../eyedropper";
import type { CornerGrip } from "../reshape";
import type { ShapeTool } from "../shapes";
import type { Recognized } from "../recognize";
import type { Crop, CropHandle } from "../crop";
import type { Rich } from "../rich";

/// Un'istanza da cui si è entrati nel suo simbolo isolato: la chiave e il
/// posto con cui ritrovarla, come il contenitore isolato.
export interface Entered {
  readonly key: string;
  readonly path: readonly number[];
}

/// Ciò che il pannello legge dagli oggetti scelti: i fatti della selezione e
/// le sfumature dei suoi riempimenti e contorni. Si leggono la prima volta
/// che servono, e restano finché non cambiano scena, scelta, livello,
/// lucchetto delle proporzioni o cornice tenuta (`syncProperties`): con
/// centinaia di oggetti scelti, aprire una sezione o cambiare un colore
/// recente non li rilegge.
export interface PanelReading {
  facts?: SelectionFacts;
  channels?: Partial<Record<PaintChannel, GradientView>>;
}

/// Il colore e lo spessore con cui disegna uno strumento.
export interface DrawStyle {
  /// `#rrggbb`.
  color: string;
  width: number;
  /// Il campione da cui viene il colore, che gli oggetti nuovi usano.
  swatch: string | null;
}

/// Un gesto in corso, dalla pipeline della penna.
export type Gesture =
  | InkGesture
  | ShapeGesture
  | ConnectorGesture
  | SelectGesture
  | LassoGesture
  | EraseGesture
  | TextGesture
  | GuideGesture
  | BoardGesture
  | DropperGesture
  | GradientGesture
  | CropGesture
  | NoteGesture
  | SymmetryGesture
  | RulerGesture
  | RefusedGesture;

export interface GestureBase {
  /// Il tratto della pipeline: cambia quando un gesto lungo continua in un
  /// tratto nuovo al limite dei campioni.
  stroke: number;
  readonly pointer: InkPointerType;
}

export interface InkGesture extends GestureBase {
  readonly kind: "ink";
  readonly tool: Tool;
  readonly color: string;
  readonly brush: InkBrush;
  /// Quanto copre, scelto da chi disegna: moltiplica quella della penna.
  readonly opacity: number;
  readonly to: Destination;
  readonly ids: NewIds;
  /// I campioni nella scena e nelle coordinate del livello.
  readonly scene: InkSample[];
  readonly local: InkSample[];
  predicted: readonly InkSample[];
  /// L'anteprima di `local`, che a ogni movimento rifà soltanto la coda.
  readonly preview: StrokePreview;
  /// Quando è cominciato, sull'orologio di `performance.now()`.
  readonly began: number;
  /// Il tratto può diventare una forma tenendolo fermo alla fine: è a
  /// penna, viene dal puntatore e non continua uno chiuso al limite.
  readonly holds: boolean;
  /// Dove il puntatore si è fermato, nella scena: i campioni dopo non se ne
  /// sono allontanati.
  still: Point | null;
  /// La forma che il tratto è diventato; `null` finché è inchiostro.
  held: Held | null;
  /// Le trasformazioni delle copie in simmetria, nella scena, prese quando
  /// il tratto è cominciato; nessuna senza simmetria.
  readonly copies: readonly Matrix[];
  /// Maiusc è stato premuto durante il tratto: resta dritto fino al rilascio.
  straight: boolean;
  /// Il bordo del righello che il tratto segue, nella scena; `null` se è
  /// cominciato lontano dal righello, o il righello non c'è (P13).
  readonly ruler: RulerEdge | null;
}

/// Il righello preso e tirato (P13).
export interface RulerGesture extends GestureBase {
  readonly kind: "ruler";
  /// Dov'è sceso il puntatore, in pixel del foglio.
  readonly from: Point;
  /// Lo scarto, nella scena, fra il centro del righello e il punto preso.
  readonly offset: Point;
  /// Dov'era il righello prima del gesto, per quando lo si annulla.
  readonly before: Ruler;
  /// Il puntatore si è mosso oltre la soglia del trascinamento.
  moved: boolean;
}

/// Il centro della simmetria della penna, preso e tirato.
export interface SymmetryGesture extends GestureBase {
  readonly kind: "symmetry";
  /// Dov'è sceso il puntatore, in pixel del foglio.
  readonly from: Point;
  /// Lo scarto, nella scena, fra il centro e il punto preso: il centro non
  /// salta sotto il puntatore.
  readonly offset: Point;
  /// Dov'era il centro prima del gesto, per quando lo si annulla.
  readonly before: Point;
  /// Il puntatore si è mosso oltre la soglia del trascinamento.
  moved: boolean;
  /// Il centro della pagina o della tavola a cui il centro si è
  /// agganciato; `null` se non si è agganciato.
  snapped: Point | null;
}

/// Un tratto a penna diventato forma, tenuto fermo alla fine: la forma
/// riconosciuta, nelle coordinate del livello; dove il puntatore si era
/// fermato e dov'è, nella scena; e se si è mosso abbastanza da regolarla.
interface Held {
  readonly shape: Recognized;
  readonly from: Point;
  end: Point;
  moved: boolean;
}

export interface ShapeGesture extends GestureBase {
  readonly kind: "shape";
  readonly tool: ShapeTool;
  readonly color: string;
  readonly width: number;
  readonly to: Destination;
  readonly ids: NewIds;
  from: Point | null;
  end: Point | null;
}

/// Una forma delle raccolte tirata dal pannello al foglio: il puntatore che
/// la porta, se è sul foglio, e dove andrebbe, nella scena; `box` è `null`
/// fuori dal foglio, o dove il livello non riceve.
export interface ShapeDrag {
  readonly shape: LibraryShape;
  readonly pointerId: number;
  readonly pointer: InkPointerType;
  over: boolean;
  box: Bounds | null;
}

/// L'oggetto a cui si aggancerebbe un capo del Connettore: l'oggetto, il
/// punto d'aggancio, e i suoi cinque punti nella scena, da mostrare.
export interface Hook {
  readonly unit: Unit;
  readonly anchor: Anchor;
  readonly points: ReadonlyMap<Exclude<Anchor, "auto">, Point>;
}

/// Un gesto dello strumento Connettore. Trascinato da un oggetto, o dal
/// foglio, tira un connettore fin dove si rilascia: sopra un oggetto vi si
/// aggancia, sul foglio il capo resta libero. Preso il capo di un connettore
/// scelto, lo riaggancia. Un tocco sceglie ciò che tocca.
export interface ConnectorGesture extends GestureBase {
  readonly kind: "connector";
  readonly ids: NewIds;
  /// Dov'è sceso il puntatore e dov'è adesso, nella scena.
  from: Point | null;
  end: Point | null;
  /// Il capo preso, e l'altro com'è adesso; `null` per un connettore nuovo.
  grab: { readonly end: LineEnd; readonly other: EndInput } | null;
  /// L'oggetto da cui parte un connettore nuovo.
  start: Hook | null;
  /// L'oggetto sotto il puntatore, a cui il capo si aggancerebbe.
  hook: Hook | null;
  /// Oltre la soglia del trascinamento.
  dragging: boolean;
}

export interface SelectGesture extends GestureBase {
  readonly kind: "select";
  from: Point | null;
  end: Point | null;
  /// `pending` finché un tocco su un oggetto, o su una maniglia della
  /// cornice o degli angoli, non diventa trascinamento.
  mode: "pending" | "move" | "marquee" | "resize" | "rotate" | "corner";
  units: readonly Unit[];
  /// Per il riquadro: la selezione di partenza, che Maiusc conserva.
  base: readonly string[];
  /// Maiusc su un oggetto già scelto: un tocco lo toglie dalla selezione.
  release: string | null;
  /// L'angolo della geometria scelta che la griglia aggancia: il più vicino
  /// al punto preso.
  source: Point | null;
  /// L'oggetto sotto il primo punto, per il doppio tocco.
  hit: string | null;
  /// La maniglia della cornice presa, con la cornice di allora.
  grip: { readonly grip: Grip; readonly frame: Frame } | null;
  /// La maniglia degli angoli presa.
  corner: CornerDrag | null;
  /// La trasformazione della scena che la cornice mostra, e i gradi della
  /// rotazione.
  matrix: Matrix | null;
  angle: number;
  /// I connettori che seguono gli oggetti presi, per l'anteprima; `null`
  /// finché il gesto non li sposta.
  lines: ConnectorPreview | null;
}

/// La maniglia degli angoli presa: l'oggetto, la sua maniglia, dove la si è
/// presa nelle coordinate dell'oggetto, e il raggio mentre la si tira.
export interface CornerDrag {
  readonly unit: Unit;
  readonly grip: CornerGrip;
  readonly from: Point;
  radius: number;
}

/// Un gesto del Lazo: i punti che segue, nella scena, e la selezione di
/// partenza, che Maiusc allarga e Alt riduce.
export interface LassoGesture extends GestureBase {
  readonly kind: "lasso";
  readonly points: Point[];
  readonly base: readonly string[];
  readonly mode: "replace" | "add" | "remove";
  /// Oltre la soglia del trascinamento: prima, è un tocco.
  dragging: boolean;
}

export interface EraseGesture extends GestureBase {
  readonly kind: "erase";
  /// Il cammino della gomma e ciò che ha segnato (`ink/tools/sweep`).
  readonly sweep: EraseSweep<Unit>;
  /// Il cammino nella scena, per la gomma precisa.
  readonly path: Point[];
  /// Il raggio nella scena, dal primo punto.
  radius: number | null;
  /// Con la gomma precisa, il taglio di ogni oggetto segnato, per chiave:
  /// `"whole"` se si cancella intero.
  readonly cuts: Map<string, StrokeCut | "whole">;
}

/// Un tocco dello strumento Testo: dove si alza il puntatore si scrive.
interface TextGesture extends GestureBase {
  readonly kind: "text";
  from: Point | null;
}

/// Un testo che si sta scrivendo nel campo sopra il foglio.
export interface Typing {
  /// La chiave del testo che si cambia; `null` per uno nuovo.
  readonly key: string | null;
  /// Il testo del campo all'apertura: se non cambia, non si scrive niente.
  readonly before: Rich;
  /// Il testo com'è scritto nel file, con cui si confronta quello nuovo;
  /// `null` per uno nuovo, o per uno che un'operazione non sa riscrivere
  /// intero, che cambia soltanto le righe.
  readonly file: Rich | null;
  /// Come si vede il testo che si cambia; `null` per uno nuovo, che ha il
  /// colore e la dimensione dello strumento.
  readonly look: TextLook | null;
  /// La larghezza del riquadro di un testo in area nuovo, che ci va a capo;
  /// `null` per gli altri.
  readonly wrap: number | null;
  /// Il punto d'ancoraggio, nelle coordinate del testo.
  readonly at: Point;
  /// Dalle coordinate del testo a quelle della scena.
  readonly matrix: Matrix;
  /// L'etichetta di una forma che si scrive; `null` per gli altri testi.
  readonly label: TypingLabel | null;
}

/// Un'etichetta che si scrive: il mezzo delle sue righe resta al centro della
/// forma mentre le righe cambiano, come resterà nel file.
export interface TypingLabel {
  /// Dove sta il mezzo delle righe, nelle coordinate del testo.
  readonly middle: number;
  /// La chiave di ciò che torna scelto dopo: la forma, o il suo gruppo.
  readonly select: string;
  /// La chiave della forma che riceve un'etichetta nuova; `null` per
  /// un'etichetta che c'è.
  readonly shape: string | null;
}

/// Un tocco con lo strumento Nota: dove, nella scena.
interface NoteGesture extends GestureBase {
  readonly kind: "note";
  at: Point | null;
}

/// Un gesto che non scrive: il documento non si modifica, o nessun livello
/// lo riceve.
export interface RefusedGesture extends GestureBase {
  readonly kind: "refused";
}

/// Un gesto su una guida del documento: una nuova, tirata da un righello, o
/// una che c'è, presa sul foglio con lo strumento Selezione.
export interface GuideGesture extends GestureBase {
  readonly kind: "guide";
  /// `x` per una guida verticale, che sta su un valore di x; `y` per una
  /// orizzontale.
  readonly axis: "x" | "y";
  /// Il posto della guida presa fra quelle del documento; `null` per una
  /// nuova.
  readonly index: number | null;
  /// Dov'è sceso il puntatore, in pixel del foglio.
  readonly from: Point;
  /// Lo scarto, nella scena, fra la guida e il punto preso: la guida non
  /// salta sotto il puntatore.
  readonly offset: number;
  /// Dove sta la guida adesso, nella scena.
  at: number;
  /// Il puntatore è sopra un righello o fuori dal foglio: rilasciata lì, una
  /// guida nuova non entra e una che c'era se ne va.
  away: boolean;
  /// Il puntatore si è mosso oltre la soglia del trascinamento: un tocco
  /// fermo non sposta niente.
  moved: boolean;
}

/// Ciò che lo strumento Tavola sceglie: una tavola, o la pagina di un
/// disegno che non ne ha (`board` è `null`), col suo rettangolo.
export interface Sheet {
  readonly board: Board | null;
  readonly rect: Rect;
}

/// Un gesto dello strumento Tavola. Il primo punto decide che cosa fa il
/// trascinamento: su una maniglia della tavola scelta, o della pagina, ne
/// cambia la misura; dentro una tavola la sposta, con ciò che ci sta sopra;
/// altrove, o con Maiusc, disegna una tavola nuova. Un tocco sceglie la
/// tavola sotto, o la pagina di un disegno che non ne ha, e fuori lascia.
export interface BoardGesture extends GestureBase {
  readonly kind: "board";
  /// Dov'è sceso il puntatore e dov'è adesso, nella scena.
  from: Point | null;
  end: Point | null;
  /// `pending` finché il tocco non diventa trascinamento; poi ciò che
  /// `plan` aveva deciso.
  mode: "pending" | "move" | "resize" | "draw";
  plan: "move" | "resize" | "draw";
  /// La tavola, o la pagina, sotto il primo punto.
  sheet: Sheet | null;
  /// La maniglia presa.
  grip: ResizeGrip | null;
  /// Gli oggetti che la tavola presa porta con sé.
  carried: readonly Unit[];
  /// L'angolo della tavola presa che la griglia aggancia: il più vicino al
  /// punto preso.
  source: Point | null;
  /// Il rettangolo di adesso: della tavola spostata o tirata, o di quella
  /// che si disegna.
  rect: Rect | null;
}

/// Il colore di un pixel che il contagocce vede: il colore; `clear` dove
/// l'immagine non si vede, trasparente o fuori da ciò che il riquadro
/// mostra; `reading` mentre la si apre; o perché non si legge.
export type PixelSeen = { readonly color: string } | "clear" | "reading" | DrawKey;

/// Ciò che il contagocce vede in un punto: una forma; il pixel di
/// un'immagine; un blocco estraneo, che non si legge.
export type Dropped =
  | { readonly kind: "shape"; readonly sight: ShapeSight }
  | { readonly kind: "image"; readonly sight: ImageSight; readonly pixel: Exclude<PixelSeen, "clear"> }
  | { readonly kind: "foreign" };

/// Il contagocce sopra un punto della scena, senza premere: dove, con quale
/// puntatore, se è il cursore della tastiera, e ciò che vede nella scena
/// `index`.
export interface DropperHover {
  readonly index: SceneIndex;
  readonly at: Point;
  readonly pointer: InkPointerType;
  readonly keyboard: boolean;
  readonly seen: Dropped | null;
}

/// Un gesto del contagocce: prende dove si rilascia, e finché si preme
/// l'anteprima segue il puntatore.
export interface DropperGesture extends GestureBase {
  readonly kind: "dropper";
  at: Point | null;
  seen: Dropped | null;
}

/// Le sfumature che lo strumento Sfumatura mostra e cambia: il colore a cui
/// vanno, le parti scelte che lo mostrano, e una sfumatura per gruppo di
/// parti che la mostrano uguale e nello stesso posto.
export interface GradientRead {
  readonly target: PaintChannel;
  readonly painted: readonly Painted[];
  readonly groups: readonly GradientHandles[];
}

/// Ciò che il primo punto di un gesto della Sfumatura prende: un capo, il
/// centro, un raggio o il fuoco della sfumatura `group`; un suo punto; la
/// sua linea, in `t`; o il foglio, dove si traccia una sfumatura nuova, con
/// l'oggetto sotto, se c'è.
export type GradientGrab =
  | { readonly kind: "grip"; readonly group: number; readonly grip: PlaceGrip }
  | { readonly kind: "stop"; readonly group: number; readonly index: number }
  | { readonly kind: "line"; readonly group: number; readonly t: number }
  | { readonly kind: "sheet"; readonly hit: Unit | null };

/// Ciò che il primo punto di un gesto della Sfumatura prende su una
/// sfumatura che c'è.
export type GradientSpot = Exclude<GradientGrab, { readonly kind: "sheet" }>;

/// Un gesto dello strumento Sfumatura. Trascinato sul foglio traccia una
/// sfumatura per tutte le parti scelte; su un capo o sul centro sposta,
/// gira o allunga la sua; sulla linea la sposta; su un punto lo porta lungo
/// la linea, e lontano da lei lo toglie. Un tocco sceglie un capo o un
/// punto, sulla linea dice dove si è, e due ci aggiungono un punto;
/// altrove sceglie l'oggetto sotto.
export interface GradientGesture extends GestureBase {
  readonly kind: "gradient";
  /// Dov'è sceso il puntatore e dov'è adesso, nella scena.
  from: Point | null;
  end: Point | null;
  /// Le sfumature di quando è sceso, e ciò che ha preso.
  read: GradientRead | null;
  grab: GradientGrab | null;
  /// Oltre la soglia del trascinamento.
  dragging: boolean;
  /// Il cambio che il trascinamento scriverebbe, e le parti a cui va:
  /// `null` tutte quelle scelte.
  change: GradientChange | null;
  only: ReadonlySet<ElementPart> | null;
  /// Dove sta la sfumatura che si traccia o si sposta.
  place: GradientPlace | null;
  /// I punti come li lascia il trascinamento di un punto, e dove sta
  /// adesso quello che si muove; `null` se, lontano dalla linea, si toglie.
  stops: readonly GradientStop[] | null;
  stop: number | null;
  /// Il punto staccato dalla linea, dov'è e com'è.
  torn: { readonly at: Point; readonly stop: GradientStop } | null;
  /// Il punto che le guide agganciano, per mostrarle.
  snapped: Point | null;
}

/// Un gesto sul ritaglio di un'immagine: un segno o un lato lo tira,
/// dentro l'immagine la si sposta sotto, fuori un tocco lo applica.
export interface CropGesture extends GestureBase {
  readonly kind: "crop";
  /// Dov'è sceso il puntatore e dov'è adesso, nella scena.
  from: Point | null;
  end: Point | null;
  /// Ciò che il primo punto ha preso, e il ritaglio di allora.
  grab: CropHandle | "slide" | "outside" | null;
  start: Crop | null;
  /// Dal puntatore al segno preso, nelle coordinate dell'immagine.
  offset: Point;
  /// Oltre la soglia del trascinamento.
  dragging: boolean;
}
