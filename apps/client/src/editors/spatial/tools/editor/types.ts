// L'editor del disegno: i tipi dei gesti e dello stato, che più pezzi di
// createDrawEditor condividono.

import type { InkBrush } from "../../../../ink/brush";
import type { InkSample } from "../../../../ink/sample";
import type { InkPointerType } from "../../../../ink/input/pointer";
import type { StrokePreview } from "../../../../ink/tools/stroke";
import type { EraseSweep } from "../../../../ink/tools/sweep";
import type { Matrix, Point } from "../../scene/matrix";
import type { Tool } from "../../scene/analysis";
import { NewIds, type Destination } from "../edit";
import type { Board, Rect } from "../boards";
import type { SelectionFacts } from "../fields";
import type { GradientView, PaintChannel } from "../gradients";
import { ConnectorPreview } from "../connectors";
import type { Ruler, RulerEdge } from "../ruler";
import type { Frame, Grip } from "../frame";
import type { Unit } from "../hit";
import type { StrokeCut } from "../erase-precise";
import type { ShapeTool } from "../shapes";
import type { Recognized } from "../recognize";

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
}

/// Un gesto in corso, dalla pipeline della penna.
export type Gesture =
  | InkGesture
  | ShapeGesture
  | SelectGesture
  | EraseGesture
  | NoteGesture
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

export interface SelectGesture extends GestureBase {
  readonly kind: "select";
  from: Point | null;
  end: Point | null;
  /// `pending` finché un tocco su un oggetto, o su una maniglia della
  /// cornice, non diventa trascinamento.
  mode: "pending" | "move" | "marquee" | "resize" | "rotate";
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
  /// La trasformazione della scena che la cornice mostra, e i gradi della
  /// rotazione.
  matrix: Matrix | null;
  angle: number;
  /// I connettori che seguono gli oggetti presi, per l'anteprima; `null`
  /// finché il gesto non li sposta.
  lines: ConnectorPreview | null;
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

/// Ciò che lo strumento Tavola sceglie: una tavola, o la pagina di un
/// disegno che non ne ha (`board` è `null`), col suo rettangolo.
export interface Sheet {
  readonly board: Board | null;
  readonly rect: Rect;
}
