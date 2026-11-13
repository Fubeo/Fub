// La classificazione della scena, le forme: le voci che la lettura produce,
// i tag, i tipi delle risorse, le forme dei fatti di stili, campioni e motivi
// e il modo di risolvere un id (`../classify.ts`).

import type { Role, Stroke } from "../analysis";
import type { ConnectorEnd, ConnectorGeom, LabelPlace } from "../connectors";
import type { Repeat } from "../repeat";
import type { Polygonal } from "../parametric";
import type { VarWidth } from "../varwidth";
import type { Span } from "../text";

/// Quanti contenitori modificabili si annidano al massimo sotto la radice: un
/// `g` o un `a` più profondo è estraneo, con tutto ciò che contiene.
export const MAX_DEPTH = 128;

/// I tag d'apertura e di chiusura di un contenitore. `close` è `null` quando
/// il contenitore è autochiuso (`<g/>`): allora `open` è l'elemento intero.
export interface Tags {
  readonly open: Span;
  readonly close: Span | null;
}

/// Il nome e lo stato di un livello (§3).
export interface Layer {
  readonly name: string;
  /// `fub:locked="true"`.
  readonly locked: boolean;
  /// `display="none"`.
  readonly hidden: boolean;
}

/// La radice `svg`: è il documento, e non si classifica.
export interface RootItem extends Span {
  readonly kind: "root";
  readonly tags: Tags;
}

/// Un connettore letto: il percorso di `fub:geom` e i due capi, `null` per
/// un capo libero o scritto fuori dalla grammatica.
export interface ConnectorFacts {
  readonly geom: ConnectorGeom;
  readonly from: ConnectorEnd | null;
  readonly to: ConnectorEnd | null;
}

/// Un elemento modificabile.
export interface ElementItem extends Span {
  readonly kind: "element";
  /// Gli indici dei figli elemento dalla radice: è il modo in cui le
  /// operazioni della superficie indicano il loro bersaglio. La radice è
  /// `[]`.
  readonly path: readonly number[];
  readonly tag: string;
  readonly role: Role;
  readonly id: string | null;
  /// Il rientro della riga su cui l'elemento comincia.
  readonly indent: string;
  /// I tag di livelli, gruppi e collegamenti.
  readonly tags?: Tags;
  readonly layer?: Layer;
  /// `fub:locked="true"` su un livello, un gruppo, un collegamento o una
  /// forma (§3): non si sceglie sul foglio, e ciò che contiene non cambia.
  /// Su un livello ripete `layer`.
  readonly locked?: true;
  /// `display="none"` su un livello, un gruppo, un collegamento o una forma:
  /// non si vede. Su un livello ripete `layer`.
  readonly hidden?: true;
  readonly stroke?: Stroke;
  /// `x1 y1 x2 y2` di una freccia.
  readonly arrow?: readonly [number, number, number, number];
  /// Il percorso e gli agganci di un connettore (formato della scena,
  /// connettori).
  readonly connector?: ConnectorFacts;
  /// La geometria di un poligono regolare o di una stella: `fub:geom` letto.
  readonly polygonal?: Polygonal;
  /// La geometria di un contorno a spessore variabile: `fub:geom` letto.
  readonly varwidth?: VarWidth;
  /// Il testo del primo `title` figlio di un livello o di un oggetto, coi
  /// riferimenti risolti e gli spazi com'erano: il nome che qualcuno gli ha
  /// dato.
  readonly title?: string;
  /// Il testo di un `title` o di un `desc`, coi riferimenti risolti e gli
  /// spazi com'erano: è ciò che l'operazione `meta` sostituisce.
  readonly text?: string;
  /// Le righe di un `text`, una per `tspan`, coi pezzi, o il testo del suo
  /// tracciato: è il testo che l'operazione `text` sostituisce.
  readonly lines?: readonly string[];
  /// La larghezza di un testo in area, `fub:wrap` letto (formato della
  /// scena, testo).
  readonly wrap?: number;
  /// Per ogni riga di un testo in area, se continua una parola della riga
  /// prima: `fub:join="word"`, dopo la prima riga. C'è soltanto se una riga
  /// la continua; il paragrafo unisce le altre con uno spazio.
  readonly glued?: readonly boolean[];
  /// L'id del tracciato che un testo segue (formato della scena, testo).
  readonly textPath?: string;
  /// Il connettore di cui un testo è l'etichetta, e dove sta: `fub:along`
  /// letto (formato della scena, connettori).
  readonly along?: LabelPlace;
  /// La forma di cui un testo è l'etichetta: `fub:inside` letto, l'id
  /// (formato della scena, etichette). Se la forma va bene lo dice chi
  /// conosce il resto del documento.
  readonly inside?: string;
  /// Come vive una risorsa, da `fub:role` (formato della scena, risorse).
  readonly lifecycle?: Lifecycle;
  /// Il nome e il colore di un campione del documento.
  readonly swatch?: SwatchFacts;
  /// Il nome di un motivo del documento.
  readonly motif?: MotifFacts;
  /// Il nome e il tipo di uno stile del documento.
  readonly style?: StyleFacts;
  /// Lo stile che un oggetto segue: `fub:style`, com'è scritto, anche se non
  /// porta a uno stile (formato della scena, stili).
  readonly follows?: string;
  /// Il rettangolo di una tavola, `x y w h` del suo `viewBox` (formato della
  /// scena, tavole).
  readonly box?: readonly [number, number, number, number];
  /// La tavola di una carta: `fub:board`, com'è scritto.
  readonly board?: string;
  /// Il simbolo di un'istanza: l'id a cui rimanda (formato della scena,
  /// simboli).
  readonly symbol?: string;
  /// Da dove viene un simbolo copiato da una libreria: `fub:source`, com'è
  /// scritto.
  readonly source?: string;
  /// La ripetizione di un gruppo: `fub:repeat` letto (formato della scena,
  /// ripetizioni).
  readonly repeat?: Repeat;
  /// L'originale di una copia: l'id del fratello a cui rimanda.
  readonly original?: string;
}

/// Una sequenza contigua di nodi estranei (§8).
export interface ForeignItem extends Span {
  readonly kind: "foreign";
  /// Il percorso del contenitore; `null` per il prologo e l'epilogo del
  /// documento, fuori dalla radice.
  readonly parentPath: readonly number[] | null;
  /// Gli indici `[da, a)` dei figli elemento del contenitore che il blocco
  /// comprende. Un blocco senza elementi ha `da = a`, l'indice del primo
  /// elemento che lo segue; nel documento la radice è l'elemento 0.
  readonly elements: readonly [number, number];
  readonly indent: string;
}

/// Una voce della scena, in ordine di documento.
export type Item = RootItem | ElementItem | ForeignItem;

/// I tag di §4.
export type Tag =
  | "title"
  | "desc"
  | "g"
  | "a"
  | "path"
  | "rect"
  | "ellipse"
  | "circle"
  | "line"
  | "polyline"
  | "polygon"
  | "text"
  | "tspan"
  | "textPath"
  | "image"
  | "defs"
  | "view"
  | "symbol"
  | "use"
  | ResourceTag;

/// I tag delle risorse (formato della scena, risorse).
export type ResourceTag = "linearGradient" | "radialGradient" | "pattern" | "marker" | "clipPath" | "mask" | "filter";

export const RESOURCE_TAGS: ReadonlySet<string> = new Set<ResourceTag>([
  "linearGradient",
  "radialGradient",
  "pattern",
  "marker",
  "clipPath",
  "mask",
  "filter",
]);

/// Vero se `tag` è il tag di una risorsa dovunque stia: un `path` lo è
/// soltanto in una `defs` della radice.
export function isResourceTag(tag: string): boolean {
  return RESOURCE_TAGS.has(tag);
}

/// Che cosa è una risorsa per chi la usa (formato della scena, risorse): `fill`
/// e `stroke` usano sfumature e motivi, `marker-*` i marcatori, `clip-path`,
/// `mask` e `filter` ritagli, maschere e filtri, un `textPath` un tracciato
/// (formato della scena, testo), e un `use` un simbolo (formato della scena,
/// simboli). Un `use` figlio di una ripetizione usa anche un originale, suo
/// fratello, che non è una risorsa e vale soltanto per i fratelli (formato
/// della scena, ripetizioni).
export type ResourceKind = "gradient" | "pattern" | "marker" | "clip" | "mask" | "filter" | "path" | "symbol" | "original";

/// Il tipo di una risorsa dal suo tag.
export function resourceKind(tag: string): ResourceKind | null {
  switch (tag) {
    case "path":
      return "path";
    case "linearGradient":
    case "radialGradient":
      return "gradient";
    case "pattern":
      return "pattern";
    case "marker":
      return "marker";
    case "clipPath":
      return "clip";
    case "mask":
      return "mask";
    case "filter":
      return "filter";
    case "symbol":
      return "symbol";
    default:
      return null;
  }
}

/// Come vive una risorsa, da `fub:role` (formato della scena, risorse):
/// `private` è di un oggetto e duplicarlo la copia, `shared` è di chi usa la
/// stessa cosa; tutte e due se ne vanno col loro ultimo riferimento. `swatch`
/// è un campione del documento, un colore o un motivo con un nome: resta
/// anche senza riferimenti, e duplicare chi lo usa lo condivide. Senza, la
/// risorsa resta. `style` è uno stile del documento: resta anche senza chi
/// lo segue, e le risorse private che usa sono sue.
export type Lifecycle = "private" | "shared" | "swatch" | "style";

/// Uno stile del documento (formato della scena, stili): il suo nome, com'è
/// scritto, e il tipo, di testo o grafico.
export interface StyleFacts {
  readonly name: string;
  readonly kind: "text" | "graphic";
}

/// I punti di uno stile grafico: una spezzata aperta nel riquadro 100 × 100.
export const STYLE_GRAPHIC_POINTS = "0,0 100,0 100,100";

/// Un campione del documento (formato della scena, risorse): il suo nome,
/// com'è scritto, e il colore, `#rrggbb` minuscolo.
export interface SwatchFacts {
  readonly name: string;
  readonly color: string;
}

/// Un motivo del documento (formato della scena, risorse): il suo nome,
/// com'è scritto.
export interface MotifFacts {
  readonly name: string;
}

/// Il tipo della risorsa modificabile che porta `id`, o `null` se nessuna
/// risorsa modificabile lo porta.
export type Resolve = (id: string) => ResourceKind | null;

/// Un documento senza risorse.
export const NO_RESOURCES: Resolve = () => null;

/// Dove sta un elemento: figlio della radice, di una `defs` della radice, o
/// di un altro contenitore modificabile.
export type Place = "root" | "defs" | "inside";
