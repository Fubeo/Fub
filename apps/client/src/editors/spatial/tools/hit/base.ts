// Le misure e i tipi che tutto l'indice degli oggetti condivide: i limiti, le
// parti di un'unità e lo stile ereditato (vedi `../hit.ts`).

import type { Bounds, Segment } from "../../scene/geometry";
import type { Vertex } from "../../scene/markers";
import type { Matrix, Point } from "../../scene/matrix";
import type { ContainerNode, ElementPart, LeafNode } from "../../scene/model";
import type { PaintNode, PaintScene } from "../../painter/paint";
import { Region, type SceneCache, type Solid } from "../clips";

/// L'errore massimo dell'appiattimento, in unità della scena.
export const FLATNESS = 0.05;

/// Il limite di pezzi per una curva: oltre, una curva enorme costerebbe più
/// di quanto il puntatore possa distinguere.
export const MAX_STEPS = 256;

/// Da quanti oggetti la gomma li cerca nell'albero dei loro riquadri: sotto,
/// guardarli a uno a uno costa meno che costruirlo.
export const TREE_FROM = 256;

/// Quante forme al più tocca un oggetto attraverso le istanze dei simboli:
/// oltre, un'istanza si tocca nel riquadro del suo simbolo. Cento istanze di
/// un simbolo con cento istanze sarebbero diecimila forme.
export const MAX_INSTANCE_PARTS = 4096;

/// Quanti simboli uno dentro l'altro si attraversano: più dentro, un'istanza
/// non si tocca. Una catena così lunga non è un disegno.
export const MAX_SYMBOL_DEPTH = 64;

/// Un livello del documento, per chi deve scegliere dove scrivere.
export interface LayerInfo {
  readonly id: string | null;
  readonly path: readonly number[];
  /// Il nome scritto in `fub:layer`.
  readonly name: string;
  readonly locked: boolean;
  readonly hidden: boolean;
  /// Dalle coordinate del livello a quelle della scena.
  readonly matrix: Matrix;
}

/// Come si vede un testo, per chi lo modifica sul posto: nelle coordinate
/// dell'oggetto, con lo stile che eredita.
export interface TextLook {
  /// Il punto della linea di base della prima riga dove la riga comincia,
  /// sta al centro o finisce, secondo `anchor`.
  readonly x: number;
  readonly y: number;
  /// Il corpo, e il passo fra una riga e l'altra.
  readonly size: number;
  readonly leading: number;
  readonly anchor: "start" | "middle" | "end";
  /// `font-family`, `font-weight` e `fill` come li eredita; `null` se nessuno
  /// li scrive.
  readonly family: string | null;
  readonly weight: string | null;
  readonly color: string | null;
  /// La larghezza del riquadro di un testo in area, che ci va a capo
  /// dentro; `null` per gli altri.
  readonly wrap: number | null;
  /// La direzione del tracciato, lunga 1, dove comincia un testo su
  /// tracciato, che `x` e `y` sono quel punto; `null` per gli altri.
  readonly along: Point | null;
}

/// Un pezzo di un oggetto che si disegna da solo: una forma. Ha la
/// geometria e il modo di dipingersi di [`Solid`]: `matrix` porta le sue
/// coordinate nella scena, `radius` è metà del contorno nelle sue unità.
export interface Part extends Solid {
  /// L'elemento che la disegna.
  readonly leaf: LeafNode;
  /// Dalle coordinate della forma a quelle dell'oggetto.
  readonly frameMatrix: Matrix;
  readonly cache: ShapeCache | null;
  /// Per un marcatore, come la punta di una linea, la forma che lo usa;
  /// `null` per una forma. Un marcatore si tocca e sta nei riquadri col
  /// contorno, ma non è geometria della forma: si vede come il suo contorno.
  readonly host: Part | null;
  /// I ritagli e le maschere che la tagliano, quelli di chi la contiene
  /// compresi; `null` se nessuno, e allora si vede tutta.
  readonly regions: readonly Region[] | null;
  /// Per una forma del contenuto di un simbolo, l'istanza dell'oggetto
  /// attraverso cui si vede, e per una dell'originale di una copia la copia;
  /// `null` per le altre.
  readonly via: Via | null;
}

/// L'istanza di un simbolo attraverso cui si tocca una forma del suo
/// contenuto, o la copia attraverso cui si tocca l'originale: la più esterna
/// nell'oggetto, con la matrice dalle sue coordinate a quelle della scena.
export interface Via {
  readonly leaf: LeafNode;
  readonly matrix: Matrix;
}

/// Il contenuto di un simbolo, misurato una volta: quante forme dà, a
/// cascata, e il riquadro della sua geometria nelle sue coordinate.
export interface SymbolInfo {
  readonly parts: number;
  readonly box: Bounds | null;
  /// I simboli che il contenuto usa, a cascata, col gruppo che li dipingeva
  /// quando si è misurato: se uno cambia, si misura di nuovo.
  readonly uses: ReadonlyMap<ContainerNode, PaintNode | undefined>;
  /// Per un simbolo che non si dipinge vivo, la scena in cui si è misurato:
  /// il suo gruppo non segue ciò che ha di estraneo. `null` per uno vivo.
  readonly scene: PaintScene | null;
}

/// Ciò che si vede di un oggetto in un punto: la forma, la sua geometria e
/// la matrice dalle sue coordinate a quelle della scena, e se lì si vede il
/// suo contorno o il suo riempimento.
export interface Sampled {
  readonly leaf: LeafNode;
  readonly segments: readonly Segment[];
  readonly matrix: Matrix;
  readonly on: "fill" | "stroke";
}

/// Ciò che di una forma non cambia finché non cambia la forma: i segmenti, e
/// il riquadro nella scena dell'ultima matrice.
export interface ShapeCache extends SceneCache {
  segments: readonly Segment[] | null;
  local: Bounds | null | undefined;
  /// I vertici, dove vanno i marcatori.
  vertices?: readonly Vertex[];
}

/// Lo stile che un contenitore trasmette ai figli, per quanto serve a
/// toccarli e a modificarne il testo.
export interface Style {
  readonly fill: boolean;
  readonly stroke: boolean;
  readonly strokeWidth: number;
  readonly fontSize: number;
  /// `letter-spacing`, in unità utente.
  readonly spacing: number;
  readonly anchor: string;
  readonly family: string | null;
  readonly weight: string | null;
  readonly color: string | null;
}

export const INITIAL: Style = { fill: true, stroke: false, strokeWidth: 1, fontSize: 16, spacing: 0, anchor: "start", family: null, weight: null, color: null };

/// L'elemento che porta un id nel documento indicizzato, o il blocco
/// estraneo che lo contiene: ciò a cui rimanda un `use` estraneo.
export type Holder = (id: string) => ElementPart | null;
