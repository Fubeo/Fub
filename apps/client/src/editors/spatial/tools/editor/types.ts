// L'editor del disegno: i tipi dei gesti e dello stato, che più pezzi di
// createDrawEditor condividono.

import type { Pf1Brush } from "../../../../ink/brush";
import type { InkSample } from "../../../../ink/sample";
import type { InkPointerType } from "../../../../ink/dom/pen-input";
import type { Bounds } from "../../scene/geometry";
import type { Matrix, Point } from "../../scene/matrix";
import type { ElementPart, LeafNode } from "../../scene/model";
import type { Tool } from "../../scene/analysis";
import type { Elem } from "../../scene/serialize";
import type { DrawKey } from "../../strings";
import type { PaintNode } from "../../painter/paint";
import { NewIds, type Destination } from "../edit";
import type { Board, Rect } from "../boards";
import type { SelectionFacts } from "../fields";
import type { GradientChange, GradientHandles, GradientPlace, GradientStop, GradientView, Painted, PaintChannel, PlaceGrip } from "../gradients";
import { ConnectorPreview, type EndInput, type LineEnd } from "../connectors";
import type { Anchor } from "../../scene/connectors";
import type { Frame, Grip, ResizeGrip } from "../frame";
import { SpineMeasure, type WidthShape } from "../profile";
import type { WidthTarget } from "../width";
import type { Spot } from "../cut";
import type { EndTips } from "../endtips";
import type { HandleRef, NodeKey, NodeKind, Subpath } from "../nodes";
import type { DraftNode } from "../curvature";
import type { Nodable } from "../nodable";
import { SceneIndex, type TextLook, type Unit } from "../hit";
import type { SymbolRef } from "../symbols-panel";
import type { LibraryShape } from "../shape-library";
import type { ImageSight, ShapeSight } from "../eyedropper";
import type { CornerGrip } from "../reshape";
import type { ShapeTool } from "../shapes";
import type { Recognized } from "../recognize";
import type { Crop, CropHandle } from "../crop";
import type { Traced } from "../trace";
import type { TraceSource } from "../trace-ops";
import type { Tracer } from "../trace-runner";
import type { Rich } from "../rich";
import type { Side } from "../wrap";

/// Un ricalco aperto nella barra di «Ricalca immagine».
export interface Tracing {
  /// L'immagine, ciò che se ne legge, e il documento in cui la si legge: se
  /// cambiano, la barra si chiude.
  readonly key: string;
  readonly source: TraceSource;
  readonly loaded: number;
  /// Chi ricalca, e il rettangolo dove vanno i pixel; `null` finché
  /// l'immagine si legge.
  ready: { readonly tracer: Tracer; readonly target: Bounds } | null;
  /// Il numero dell'ultimo tipo scelto e di quello di cui sono arrivate
  /// le impostazioni, dell'ultimo ricalco chiesto e di quello arrivato.
  presets: number;
  settled: number;
  asked: number;
  answered: number;
  /// L'ultimo ricalco arrivato, col gruppo dell'anteprima.
  shown: { readonly traced: Traced; readonly group: Elem } | null;
  /// «Applica» aspetta l'ultimo ricalco.
  applying: boolean;
  failed: boolean;
}

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
  | NodesGesture
  | BuilderGesture
  | CutGesture
  | WidthGesture
  | BezierGesture
  | EraseGesture
  | TextGesture
  | GuideGesture
  | BoardGesture
  | DropperGesture
  | GradientGesture
  | CropGesture
  | NoteGesture
  | SymmetryGesture
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
  readonly brush: Pf1Brush;
  readonly to: Destination;
  readonly ids: NewIds;
  /// I campioni nella scena e nelle coordinate del livello.
  readonly scene: InkSample[];
  readonly local: InkSample[];
  predicted: readonly InkSample[];
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

/// L'anteprima di un simbolo del pannello: la versione da cui viene, l'URL
/// che arriva, e quello arrivato.
export interface SymbolPictureEntry {
  readonly version: string;
  readonly url: Promise<string | null>;
  ready: string | null;
}

/// Un simbolo tirato dal pannello al foglio: chi è, il riquadro della sua
/// istanza attorno all'origine, l'anteprima che il foglio mostra mentre lo
/// si tira, il puntatore che lo porta, se è sul foglio, e dove andrebbe,
/// nella scena; `box` è `null` fuori dal foglio, o dove il livello non
/// riceve.
export interface SymbolDrag {
  readonly ref: SymbolRef;
  readonly frame: Bounds;
  readonly picture: string | null;
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
  /// Il riquadro del testo in area di cui si tira la cornice.
  area: AreaDrag | null;
  /// La trasformazione della scena che la cornice mostra, e i gradi della
  /// rotazione.
  matrix: Matrix | null;
  angle: number;
  /// I connettori che seguono gli oggetti presi, per l'anteprima; `null`
  /// finché il gesto non li sposta.
  lines: ConnectorPreview | null;
}

/// La cornice di un testo in area presa da un lato o da un angolo: cambia
/// la larghezza del riquadro, non il corpo, e il bordo opposto resta fermo
/// (livello Esperto).
export interface AreaDrag {
  readonly unit: Unit;
  readonly fixed: Side;
  /// Il bordo tirato e la larghezza di partenza, nelle coordinate del testo.
  readonly edge: number;
  readonly width: number;
  /// La larghezza di adesso, il testo che la mostra e la sua cornice nelle
  /// coordinate del testo.
  now: number;
  elem: Elem | null;
  box: Bounds | null;
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

/// Un gesto del Costruttore di forme. Cominciato su una regione, senza
/// Maiusc, prende le regioni che attraversa, da unire o, con Alt, da
/// togliere; un tocco ne prende una. Altrimenti sceglie gli oggetti come la
/// Selezione: un tocco quello sotto, un riquadro quelli dentro.
export interface BuilderGesture extends GestureBase {
  readonly kind: "builder";
  /// Dove è sceso il puntatore e dov'è adesso, nella scena.
  from: Point | null;
  end: Point | null;
  /// Che cosa fa il gesto, deciso dal primo punto.
  mode: "regions" | "objects" | null;
  /// Maiusc al primo punto: il tocco e il riquadro aggiungono alla
  /// selezione, e il tocco su un oggetto scelto lo toglie.
  additive: boolean;
  /// Le regioni attraversate, nell'ordine: la prima dà lo stile all'unione.
  readonly crossed: number[];
  /// La scia del puntatore sulle regioni, nella scena.
  readonly trail: Point[];
  /// La selezione di partenza, che un gesto annullato ripristina.
  readonly base: readonly string[];
  /// Oltre la soglia del trascinamento: prima, è un tocco.
  dragging: boolean;
}

/// Un gesto delle Forbici: un tocco taglia il contorno sotto, un
/// trascinamento è il Coltello, che taglia lungo la sua scia, o con Alt
/// dritto dal primo punto all'ultimo.
export interface CutGesture extends GestureBase {
  readonly kind: "cut";
  /// Dove è sceso il puntatore e dov'è adesso, nella scena.
  from: Point | null;
  end: Point | null;
  /// La scia del Coltello, nella scena.
  readonly trail: Point[];
  /// Oltre la soglia del trascinamento: prima, è un tocco.
  dragging: boolean;
}

/// Dove tagliano le Forbici: la forma, il punto del suo tracciato, il nodo
/// se ci cade, e dove si vede nella scena.
export interface CutSpot {
  readonly unit: Unit;
  readonly leaf: LeafNode;
  readonly nodable: Nodable;
  /// Dalle coordinate della forma a quelle della scena.
  readonly matrix: Matrix;
  readonly spot: Spot;
  readonly node: NodeKey | null;
  readonly at: Point;
}

/// Che cosa prende lo Spessore: il lato `side` del punto `index` del
/// profilo, per allargarlo o stringerlo; il punto `index` in mezzo alla
/// linea, per spostarlo; o la linea alla frazione `u` della lunghezza, dove
/// un trascinamento aggiunge un punto e lo allarga dal lato `side`. Il lato
/// 1 è a destra di chi percorre la linea, -1 a sinistra; 0 per chi preme
/// sulla linea, o sui lati di un punto largo zero, che tira la parte verso
/// cui parte il trascinamento.
export type WidthGrab =
  | { readonly kind: "side"; readonly index: number; readonly side: WidthSide }
  | { readonly kind: "point"; readonly index: number }
  | { readonly kind: "line"; readonly u: number; readonly side: WidthSide };

/// Un lato della linea, o nessuno ancora.
export type WidthSide = 1 | -1 | 0;

/// Una linea dello Spessore nella scena: la forma, la sua linea a spessore
/// variabile, com'è o come la diventa il suo contorno, misurata.
export interface WidthLine {
  readonly unit: Unit;
  readonly leaf: LeafNode;
  readonly target: WidthTarget;
  readonly measure: SpineMeasure;
  /// Dalle coordinate della forma a quelle della scena, e ritorno.
  readonly matrix: Matrix;
  readonly inverse: Matrix;
}

/// Dove lavora lo Spessore: una linea, e ciò che prende.
export interface WidthSpot extends WidthLine {
  readonly grab: WidthGrab;
}

/// Un gesto dello Spessore: un tocco sceglie un punto del profilo; un
/// trascinamento allarga o stringe un lato, e senza Alt l'altro dello
/// stesso tanto, o sposta un punto in mezzo lungo la linea.
export interface WidthGesture extends GestureBase {
  readonly kind: "width";
  /// Dove è sceso il puntatore e dov'è adesso, nella scena.
  from: Point | null;
  end: Point | null;
  /// Ciò che prende, trovato dove è sceso, o perché non prende niente.
  spot: WidthSpot | DrawKey | null;
  /// La linea come la lascia il trascinamento, e il suo punto che cambia.
  shape: WidthShape | null;
  index: number;
  /// Il lato che il trascinamento tira, deciso quando parte.
  side: WidthSide;
  /// Oltre la soglia del trascinamento: prima, è un tocco.
  dragging: boolean;
}

/// I nodi scelti, per forma: la chiave è il percorso della forma nel
/// modello, coi numeri separati da un punto.
export type NodePick = ReadonlyMap<string, ReadonlySet<NodeKey>>;

/// Che cosa ha preso il primo punto di un gesto dei nodi: un nodo, una
/// maniglia o un punto di un segmento della forma `shape`, il vuoto per un
/// riquadro, o niente da trascinare. `origin` è dov'era il punto preso,
/// nella scena. Un nodo preso con Maiusc fra quelli scelti si toglie con un
/// tocco (`toggle`); senza Maiusc, un tocco lascia scelti soltanto i nodi
/// `alone`. Preso con Alt, trascinarlo ne tira fuori le maniglie (`pull`).
/// Una maniglia presa con Alt si sposta da sola (`alone`), e il suo nodo
/// diventa uno spigolo; una che sta su una linea, toccata, vale come il
/// punto `segment` della linea.
export type NodeGrab =
  | {
    readonly kind: "node";
    readonly shape: string;
    readonly key: NodeKey;
    readonly origin: Point;
    readonly toggle: boolean;
    readonly alone: readonly NodeKey[] | null;
    readonly pull: boolean;
  }
  | {
    readonly kind: "handle";
    readonly shape: string;
    readonly handle: HandleRef;
    readonly origin: Point;
    readonly alone: boolean;
    readonly segment: { readonly sub: number; readonly link: number; readonly t: number } | null;
  }
  | { readonly kind: "segment"; readonly shape: string; readonly sub: number; readonly link: number; readonly t: number }
  /// Un riquadro sceglie i nodi di tutte le forme che prende; con Maiusc
  /// aggiunge a quelli scelti.
  | { readonly kind: "marquee"; readonly additive: boolean }
  | { readonly kind: "none" };

/// Un gesto dello strumento Nodi.
export interface NodesGesture extends GestureBase {
  readonly kind: "nodes";
  from: Point | null;
  end: Point | null;
  grab: NodeGrab | null;
  /// Oltre la soglia del trascinamento.
  dragging: boolean;
  /// I nodi scelti, le forme che si modificavano e la selezione di prima,
  /// che un gesto annullato ripristina; per il riquadro, ciò che Maiusc
  /// conserva. Se le forme cambiano, un tocco dice le nuove prima dei nodi
  /// scelti.
  readonly nodes: NodePick;
  readonly shapes: readonly (readonly number[])[];
  readonly selection: readonly string[];
  /// I nodi di ogni forma come li lascia il trascinamento, da scrivere
  /// quando si alza.
  draft: ReadonlyMap<string, readonly Subpath[]> | null;
  /// Il lato del nodo di cui si tirano le maniglie, deciso dal verso in cui
  /// il trascinamento comincia.
  side: "in" | "out" | null;
  /// La forma `shape` del trascinamento di una maniglia, o delle maniglie
  /// tirate da un nodo, come la lascia: i nodi scelti e i tipi dati, e dove
  /// è finito ogni nodo se se ne sono aggiunti.
  reshaped: Reshaped | null;
  /// Perché la forma toccata non ha nodi, o perché il trascinamento non fa
  /// niente.
  missed: DrawKey | null;
}

/// Una forma come la lascia un trascinamento che le cambia i nodi o i tipi
/// (vedi [`NodesGesture`]).
interface Reshaped {
  readonly shape: string;
  readonly chosen: ReadonlySet<NodeKey>;
  readonly kinds: ReadonlyMap<NodeKey, NodeKind>;
  readonly moved: ReadonlyMap<NodeKey, NodeKey> | null;
}

/// Ciò che la Curvatura prende di un tracciato scelto: un nodo, o il punto
/// di un segmento dove ne posa uno nuovo, e dove sta nella scena.
export interface CurveGrab {
  readonly edit: Editing;
  readonly node: NodeKey | null;
  readonly segment: { readonly sub: number; readonly link: number; readonly t: number } | null;
  readonly origin: Point;
}

/// Un tracciato come lo lascia un trascinamento della Curvatura: i nodi, il
/// nodo spostato, i tipi, e dove sono finiti i nodi se se n'è posato uno.
export interface CurveDraft {
  readonly subs: readonly Subpath[];
  readonly key: NodeKey;
  readonly kinds: ReadonlyMap<NodeKey, NodeKind>;
  readonly moved: ReadonlyMap<NodeKey, NodeKey> | null;
}

/// Un gesto della penna di Bézier: aggiunge un nodo, chiude il tracciato sul
/// primo nodo, o prende l'ultimo, che un tocco conclude e un trascinamento
/// ne cambia la maniglia d'uscita. Con la Curvatura il trascinamento sposta
/// il punto che prende, anche uno in mezzo (`point`), che un tocco fa
/// passare da liscio a spigolo e ritorno.
export interface BezierGesture extends GestureBase {
  readonly kind: "bezier";
  readonly to: Destination;
  /// La Curvatura, quando il gesto è cominciato.
  readonly curve: boolean;
  /// `path`: la Curvatura su un tracciato che c'è già ([`CurveGrab`]).
  mode: "add" | "close" | "last" | "point" | "path" | null;
  path: CurveGrab | null;
  /// Il tracciato preso come lo lascia il trascinamento.
  reshaped: CurveDraft | null;
  /// Il nodo del tracciato che il gesto prende; -1 per uno nuovo.
  index: number;
  /// Dove è sceso il puntatore e dov'è adesso, nella scena.
  from: Point | null;
  end: Point | null;
  /// Il nodo che il gesto mette o prende.
  at: Point | null;
  /// Oltre la soglia del trascinamento.
  dragging: boolean;
}

export interface EraseGesture extends GestureBase {
  readonly kind: "erase";
  last: Point | null;
  readonly marked: Map<string, Unit>;
}

/// Un tocco dello strumento Testo: dove si alza il puntatore si scrive. Un
/// trascinamento disegna il riquadro di un testo in area.
interface TextGesture extends GestureBase {
  readonly kind: "text";
  from: Point | null;
  end: Point | null;
  dragging: boolean;
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

/// Un passo della penna di Bézier: i nodi di prima, o di dopo per un passo
/// annullato, e che cosa ha fatto a quale nodo, per dirlo.
interface DraftStep {
  readonly nodes: readonly DraftNode[];
  readonly label: DrawKey;
  readonly index: number;
}

/// Il tracciato della penna di Bézier, finché non si conclude.
export interface Drafting {
  nodes: readonly DraftNode[];
  readonly done: DraftStep[];
  readonly undone: DraftStep[];
  /// Il livello dell'ultimo gesto, per l'anteprima fra un gesto e l'altro.
  to: Destination;
}

/// Una forma di cui lo strumento Nodi modifica i nodi, dentro un oggetto
/// scelto o l'oggetto stesso.
export interface Editing {
  readonly unit: Unit;
  /// L'elemento, il suo percorso nel modello, e il percorso come chiave.
  readonly leaf: LeafNode;
  readonly path: readonly number[];
  readonly key: string;
  /// Ciò che i nodi modificano, e i nodi.
  readonly nodable: Nodable;
  readonly subs: readonly Subpath[];
  /// Dalle coordinate del tracciato a quelle della scena, e ritorno.
  readonly matrix: Matrix;
  readonly inverse: Matrix;
  /// Ciò che il painter disegna per lui.
  readonly paints: readonly PaintNode[];
}

/// Una modifica dei nodi della forma `edit`: i nodi nuovi, quelli scelti
/// dopo e i tipi dati. `moved` porta i nodi che restano dove sono finiti,
/// se la modifica ne ha aggiunti o tolti; `changed` dice quanti nodi o
/// segmenti ha cambiato.
export interface NodeChange {
  readonly edit: Editing;
  readonly subs: readonly Subpath[];
  readonly selected: Iterable<NodeKey>;
  readonly kinds: ReadonlyMap<NodeKey, NodeKind>;
  readonly moved?: ReadonlyMap<NodeKey, NodeKey>;
  readonly changed?: number;
  /// Le punte dei capi della forma dopo, se la modifica porta in lei i capi
  /// di un'altra; se no le dicono i nodi.
  readonly tips?: EndTips;
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

/// I comandi dei nodi di Maiusc e una lettera, quelli di Inkscape.
export type NodeCommand = NodeKind | "line" | "curve" | "break" | "join";
