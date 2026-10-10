// La scena come la disegna un painter: una pila di strati nell'ordine del
// documento, che si alternano fra strati vivi e strati immagine.
//
// Uno strato vivo porta gli elementi modificabili come forme e gruppi, con i
// soli attributi del sottoinsieme: un painter li crea da sé, e il testo della
// sorgente non entra mai nel documento vivo. Uno strato immagine porta il
// testo di una sequenza contigua di nodi estranei, avvolta nei tag
// d'apertura dei contenitori antenati, e si disegna come un `<img>` da blob:
// lì script e risorse esterne non partono, e l'ordine visivo resta esatto
// perché l'immagine sta fra gli strati vivi che la circondano. Una sequenza
// che non disegna niente da sola (solo `defs`, `style`, metadati, commenti, o
// dentro un livello nascosto) non diventa uno strato.
//
// Questa descrizione non sa niente del DOM: la legge il painter SVG DOM di
// `svg-dom.ts`, e potrà leggerla un painter Canvas per le scene grandi. Per
// questo è incrementale per identità: un elemento che un'operazione non tocca
// resta lo stesso oggetto nel modello del motore, la sua forma resta lo
// stesso oggetto qui, e così i gruppi e gli strati che non cambiano. Il
// painter confronta oggetti, non testo.
//
// I limiti, tutti per un file ostile più che per un disegno vero:
//
// - **Strati immagine:** al più [`MAX_IMAGE_LAYERS`]. Ognuno costa una
//   bitmap grande quanto la vista. Oltre, le sequenze più vicine si uniscono
//   con gli elementi vivi che le separano, scegliendo i tratti che ne
//   contengono meno: quegli elementi si vedono nell'immagine, nel loro
//   ordine, e un'immagine del vault fra loro vi compare come segnaposto.
// - **Riferimenti:** un `url(#…)` o un `href="#…"` di un blocco estraneo
//   verso un elemento che sta altrove (un gradiente in un `defs`, una forma
//   per `use`) porta quell'elemento nei `defs` dell'immagine, e così i fogli
//   di stile. Al più [`MAX_DEFS_CHARS`] caratteri per strato.
//
// Le risorse modificabili (formato della scena, risorse) non sono strati: la
// scena le porta a parte, in ordine di documento, ciascuna coi soli elementi
// e attributi che il formato ammette, e il painter le mette nella `defs` viva
// della superficie, dove gli oggetti vivi le trovano. Dentro un'immagine
// valgono come ogni altro elemento a cui l'immagine rimanda: il loro testo
// entra nei `defs` dell'immagine, con le sfumature che il loro contenuto
// usa. Ci entrano anche per gli elementi vivi che un'immagine unisce e per
// i contenitori che la racchiudono, che possono avere un ritaglio, una
// maschera o un filtro.
//
// I simboli modificabili (formato della scena, simboli) non sono strati
// nemmeno loro: la scena li porta a parte, come gruppi col loro contenuto
// vivo, e il painter li mette nella `defs` viva, dove le istanze, `use`
// vivi, li trovano. Un simbolo che contiene qualcosa di estraneo che si vede
// non si dipinge vivo, perché quel pezzo non entra nel documento vivo: le
// sue istanze stanno negli strati immagine, col simbolo intero nei `defs`.
//
// Le copie di una ripetizione (formato della scena, ripetizioni) sono `use`
// vivi verso l'originale, che sta fra i loro fratelli: la scena dice quali
// originali hanno copie vive, e il painter dà a quelli l'id vivo.

import type { Role } from "../scene/analysis";
import { svgAttribute, textPathTarget } from "../scene/classify";
import {
  parseFragment,
  rawOf,
  type ContainerNode,
  type DocumentModel,
  type ElementPart,
  type LeafNode,
  type OtherNode,
  type Part,
  type SceneNode,
} from "../scene/model";
import { parseGuides, parseUnits, type LengthUnit, type RulerGuide } from "../scene/rulers";
import { escapeAttribute, NamespaceScope } from "../scene/serialize";
import { SourceText } from "../scene/text";
import { href as hrefKind, length, numberList, urlIds } from "../scene/values";
import { viewMatrix } from "../view";
import {
  NS_FUB,
  NS_NONE,
  NS_SVG,
  NS_XLINK,
  NS_XML,
  parseXml,
  SVG_NS,
  valueOf,
  XmlError,
  type ElementNode,
  type XmlDocument,
} from "../scene/xml";

/// Quanti strati immagine al più.
export const MAX_IMAGE_LAYERS = 8;

/// Quanti caratteri di `defs` al più in uno strato immagine.
export const MAX_DEFS_CHARS = 8 * 1024 * 1024;

/// Un attributo dipinto: nome senza namespace e valore.
export type PaintAttr = readonly [name: string, value: string];

/// I tag che un painter crea per una forma: anche un'istanza di un simbolo
/// o una copia in una ripetizione, un `use`, che si disegna come un elemento
/// solo.
export type ShapeTag = "path" | "rect" | "ellipse" | "circle" | "line" | "polyline" | "polygon" | "text" | "image" | "use";

/// Da dove viene un'immagine modificabile.
export type ImageSource =
  /// Un data URI raster: si mostra così com'è.
  | { readonly kind: "data"; readonly url: string }
  /// Un percorso del vault, ripulito come lo legge un URL: relativo al
  /// disegno, o dalla radice del vault se comincia con `/`. Lo risolve chi
  /// monta il painter.
  | { readonly kind: "vault"; readonly path: string }
  /// Un URL remoto, che non si carica mai: al suo posto il segnaposto.
  | { readonly kind: "remote" };

/// Un pezzo di una riga di testo: un `tspan` dentro la riga, col suo stile e
/// solo testo.
export interface TextPiece {
  readonly attrs: readonly PaintAttr[];
  readonly space: string | null;
  readonly text: string;
}

/// Un pezzo di un `text`: gli spazi fra i `tspan` contano nella resa, e
/// restano dove sono. Una riga ha tutto il suo testo in `text`, e quella con
/// dei pezzi anche `parts`, il testo della riga e i pezzi in ordine. Un
/// testo su tracciato ha un `textPath` al posto delle righe (formato della
/// scena, testo): l'id del tracciato, una risorsa, e dove comincia.
export type TextRun =
  | { readonly kind: "space"; readonly text: string }
  | {
      readonly kind: "span";
      readonly attrs: readonly PaintAttr[];
      readonly space: string | null;
      readonly text: string;
      readonly parts?: readonly (string | TextPiece)[];
    }
  | {
      readonly kind: "path";
      readonly href: string;
      readonly startOffset: string | null;
      readonly text: string;
      readonly parts?: readonly (string | TextPiece)[];
    };

/// Un elemento modificabile che si disegna da solo.
export interface PaintShape {
  readonly kind: "shape";
  readonly tag: ShapeTag;
  readonly role: Role;
  readonly id: string | null;
  readonly attrs: readonly PaintAttr[];
  /// `xml:space`, se l'elemento lo scrive.
  readonly space: string | null;
  /// Le righe di un `text`.
  readonly runs?: readonly TextRun[];
  /// La sorgente di un'`image`; assente se non ha un `href`.
  readonly image?: ImageSource;
  /// L'id del simbolo di un'istanza, che il painter riscrive nel suo.
  readonly symbol?: string;
  /// L'id dell'originale di una copia, che il painter riscrive nel suo.
  readonly original?: string;
}

/// Un livello, un gruppo o un collegamento: un `g`. Un collegamento non
/// diventa un `<a>` vivo, che porterebbe la webview altrove. Un simbolo è un
/// gruppo di ruolo `symbol`, che il painter mette nella sua `defs` viva come
/// `symbol`.
export interface PaintGroup {
  readonly kind: "group";
  /// Lo stesso oggetto finché il contenitore è lo stesso nel modello: il
  /// painter ci ritrova il suo nodo anche se il gruppo è cambiato.
  readonly key: object;
  readonly role: Role;
  readonly id: string | null;
  readonly attrs: readonly PaintAttr[];
  readonly space: string | null;
  readonly children: readonly PaintNode[];
}

export type PaintNode = PaintShape | PaintGroup;

/// Uno strato di elementi vivi.
export interface LiveLayer {
  readonly kind: "live";
  readonly nodes: readonly PaintNode[];
}

/// La radice di un documento immagine: il suo nome qualificato e gli
/// attributi che restano, già scritti. Dimensioni, `viewBox`,
/// `preserveAspectRatio` e `transform` li mette la vista.
export interface ImageRoot {
  readonly name: string;
  readonly attrs: string;
  /// Lo `style` della radice, se c'è: si conserva, e gli si toglie lo sfondo
  /// quando l'immagine sta sopra altri strati.
  readonly style: string | null;
}

/// Uno strato immagine: un documento SVG inerte.
export interface ImageLayer {
  readonly kind: "image";
  /// Uguale per due strati che danno la stessa immagine.
  readonly key: string;
  /// Ciò che precede la radice: commenti e istruzioni del prologo, e il
  /// `DOCTYPE` di un documento intero.
  readonly prolog: string;
  readonly root: ImageRoot;
  /// Tutto ciò che segue il tag d'apertura della radice, chiusura compresa.
  readonly body: string;
  /// Vero se sotto l'immagine ci sono altri strati: la radice non dipinge
  /// lo sfondo.
  readonly transparent: boolean;
  /// I contenitori che racchiudono tutto lo strato, dal più esterno, con le
  /// chiavi dei loro gruppi (`PaintGroup.key`): uno strato dentro un gruppo
  /// che si sposta lo segue, e uno dentro il gruppo isolato non si attenua.
  readonly containers: readonly object[];
}

export type PaintLayer = LiveLayer | ImageLayer;

/// La pagina del disegno, in unità della scena: il `viewBox` della radice,
/// oppure larghezza e altezza assolute.
export interface Page {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/// Ciò che la radice dà agli strati vivi, e alla superficie.
export interface PaintRoot {
  /// Gli attributi di presentazione della radice che varrebbero su un `g`:
  /// gli strati vivi li ereditano come il documento.
  readonly attrs: readonly PaintAttr[];
  readonly page: Page | null;
  /// L'unità del documento: `px` se non la dice, o se non si legge.
  readonly units: LengthUnit;
  /// Le guide dei righelli; `null` se `fub:guides` è fuori grammatica, e
  /// allora la superficie non le tocca.
  readonly guides: readonly RulerGuide[] | null;
}

/// Un elemento di una risorsa viva: la risorsa, un punto di una sfumatura,
/// una primitiva di un filtro o un elemento del contenuto, coi soli
/// attributi che la superficie dipinge.
export interface PaintDef {
  readonly tag: string;
  readonly attrs: readonly PaintAttr[];
  /// `xml:space`, se l'elemento lo scrive.
  readonly space: string | null;
  /// I figli in ordine; il testo soltanto dentro `text` e `tspan`.
  readonly children: readonly (PaintDef | string)[];
}

/// Una risorsa modificabile (formato della scena, risorse): una sfumatura, un
/// motivo, un marcatore, un ritaglio, una maschera o un filtro, che gli
/// oggetti vivi usano per riferimento.
export interface PaintResource extends PaintDef {
  /// L'id del disegno, che il painter riscrive nel suo.
  readonly id: string;
}

/// Una scena da disegnare.
export interface PaintScene {
  readonly root: PaintRoot;
  readonly layers: readonly PaintLayer[];
  /// Le risorse modificabili, in ordine di documento: lo stesso oggetto
  /// finché nessuna cambia.
  readonly resources: readonly PaintResource[];
  /// I simboli modificabili che si dipingono vivi, in ordine di documento,
  /// col loro contenuto: lo stesso oggetto finché nessuno cambia.
  readonly symbols: readonly PaintGroup[];
  /// Gli id degli originali che le copie vive usano: il painter dà loro
  /// l'id vivo. Lo stesso oggetto finché non cambiano.
  readonly originals: ReadonlySet<string>;
}

/// Il documento da cui si disegna: il motore delle operazioni lo è.
export interface PaintSource {
  /// L'albero, `null` per un documento in sola lettura.
  readonly model: DocumentModel | null;
  /// L'elemento che porta `id`, o l'unità estranea che lo contiene.
  holder(id: string): ElementPart | null;
}

/// La vista in cui si disegna uno strato immagine: il rettangolo della scena
/// che copre e la sua dimensione in pixel CSS.
///
/// Con `angle` il rettangolo è girato come la vista: (`x`, `y`) è il punto
/// della scena nell'angolo in alto a sinistra dell'immagine, e `width` e
/// `height` sono le misure lungo i suoi lati. L'immagine resta allineata ai
/// pixel dello schermo, e il disegno vi entra già girato.
export interface ImageFrame {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly pixelWidth: number;
  readonly pixelHeight: number;
  /// Gradi in senso orario, come `rotate()`; assente è 0.
  readonly angle?: number;
}

// ---------------------------------------------------------------------------
// Tabelle.
// ---------------------------------------------------------------------------

/// Gli attributi senza namespace che un elemento modificabile può portare e
/// che si dipingono: `id` e `href` no, il primo resta della scena e il
/// secondo è di `ImageSource`. È la lista del formato della scena (§4),
/// ripetuta: se la classificazione ammettesse un nome nuovo, il painter non
/// lo copierebbe finché non è scritto anche qui.
export const PAINTED_ATTRIBUTES: ReadonlySet<string> = new Set([
  "fill",
  "fill-opacity",
  "stroke",
  "stroke-width",
  "stroke-opacity",
  "stroke-linecap",
  "stroke-linejoin",
  "stroke-dasharray",
  "opacity",
  "display",
  "transform",
  "font-family",
  "font-size",
  "font-weight",
  "font-style",
  "letter-spacing",
  "text-decoration",
  "text-anchor",
  "x",
  "y",
  "dy",
  "cx",
  "cy",
  "r",
  "rx",
  "ry",
  "x1",
  "y1",
  "x2",
  "y2",
  "width",
  "height",
  "points",
  "d",
  "preserveAspectRatio",
  "marker-start",
  "marker-mid",
  "marker-end",
  "clip-path",
  "mask",
  "filter",
  "style",
]);

/// Gli attributi che rimandano a una risorsa con `url(#id)` (formato della
/// scena, risorse): il painter li riscrive sugli id vivi della sua superficie.
export const REFERENCE_ATTRIBUTES: ReadonlySet<string> = new Set([
  "fill",
  "stroke",
  "marker-start",
  "marker-mid",
  "marker-end",
  "clip-path",
  "mask",
  "filter",
]);

/// Gli attributi del contenuto di una risorsa: quelli degli oggetti, senza
/// i rimandi a marcatori, ritagli, maschere e filtri, e con `clip-rule`, che
/// vale dentro un ritaglio. Il contenuto rimanda soltanto alle sfumature.
const CONTENT_ATTRIBUTES: ReadonlySet<string> = new Set([
  ...[...PAINTED_ATTRIBUTES].filter((name) => name === "fill" || name === "stroke" || !REFERENCE_ATTRIBUTES.has(name)),
  "clip-rule",
]);

/// Gli attributi di ogni primitiva di un filtro.
const PRIMITIVE = ["result", "color-interpolation-filters", "x", "y", "width", "height"];

/// Gli elementi delle risorse vive, ciascuno coi suoi attributi senza namespace
/// (formato della scena, risorse). È la grammatica del formato, ripetuta come
/// [`PAINTED_ATTRIBUTES`]: ciò che non è scritto qui non entra nel DOM. `id`
/// manca: quello di una risorsa il painter lo riscrive, quelli dei suoi figli
/// non servono.
export const DEF_ATTRIBUTES: ReadonlyMap<string, ReadonlySet<string>> = new Map<string, ReadonlySet<string>>([
  ["linearGradient", new Set(["x1", "y1", "x2", "y2", "gradientUnits", "gradientTransform", "spreadMethod"])],
  ["radialGradient", new Set(["cx", "cy", "r", "fx", "fy", "gradientUnits", "gradientTransform", "spreadMethod"])],
  ["stop", new Set(["offset", "stop-color", "stop-opacity"])],
  ["pattern", new Set(["x", "y", "width", "height", "patternUnits", "patternContentUnits", "patternTransform", "viewBox", "preserveAspectRatio"])],
  ["marker", new Set(["refX", "refY", "markerWidth", "markerHeight", "markerUnits", "orient", "viewBox", "preserveAspectRatio"])],
  ["clipPath", new Set(["clipPathUnits", "transform", "clip-rule"])],
  ["mask", new Set(["x", "y", "width", "height", "maskUnits", "maskContentUnits"])],
  ["filter", new Set(["x", "y", "width", "height", "filterUnits", "primitiveUnits", "color-interpolation-filters"])],
  ["feGaussianBlur", new Set([...PRIMITIVE, "in", "stdDeviation"])],
  ["feOffset", new Set([...PRIMITIVE, "in", "dx", "dy"])],
  ["feFlood", new Set([...PRIMITIVE, "flood-color", "flood-opacity"])],
  ["feDropShadow", new Set([...PRIMITIVE, "in", "dx", "dy", "stdDeviation", "flood-color", "flood-opacity"])],
  ["feColorMatrix", new Set([...PRIMITIVE, "in", "type", "values"])],
  ["feComposite", new Set([...PRIMITIVE, "in", "in2", "operator", "k1", "k2", "k3", "k4"])],
  ["feBlend", new Set([...PRIMITIVE, "in", "in2", "mode"])],
  ["feMorphology", new Set([...PRIMITIVE, "in", "operator", "radius"])],
  ["feMerge", new Set(PRIMITIVE)],
  ["feMergeNode", new Set(["in"])],
  ...["path", "rect", "ellipse", "circle", "line", "polyline", "polygon", "text", "tspan", "g"].map((tag) => [tag, CONTENT_ATTRIBUTES] as const),
]);

/// Le forme e i testi del contenuto di una risorsa.
const SHAPES_AND_TEXTS = ["path", "rect", "ellipse", "circle", "line", "polyline", "polygon", "text"];

/// I figli che ogni elemento di una risorsa può avere; chi non c'è non ne
/// ha. Il testo sta soltanto dentro `text` e `tspan`.
export const DEF_CHILDREN: ReadonlyMap<string, ReadonlySet<string>> = new Map<string, ReadonlySet<string>>([
  ["linearGradient", new Set(["stop"])],
  ["radialGradient", new Set(["stop"])],
  ["pattern", new Set([...SHAPES_AND_TEXTS, "g"])],
  ["marker", new Set([...SHAPES_AND_TEXTS, "g"])],
  ["mask", new Set([...SHAPES_AND_TEXTS, "g"])],
  ["g", new Set([...SHAPES_AND_TEXTS, "g"])],
  // Un ritaglio non ha gruppi.
  ["clipPath", new Set(SHAPES_AND_TEXTS)],
  ["filter", new Set(["feGaussianBlur", "feOffset", "feFlood", "feDropShadow", "feColorMatrix", "feComposite", "feBlend", "feMorphology", "feMerge"])],
  ["feMerge", new Set(["feMergeNode"])],
  ["text", new Set(["tspan"])],
  ["tspan", new Set(["tspan"])],
]);

/// I tag delle risorse, che stanno nella `defs` viva: anche un `path`, il
/// tracciato di un testo.
export const RESOURCE_TAGS: ReadonlySet<string> = new Set(["linearGradient", "radialGradient", "pattern", "marker", "clipPath", "mask", "filter", "path"]);

/// Gli attributi della radice che passano agli strati vivi, se il loro
/// valore varrebbe su un `g`: quelli che i figli ereditano, e l'opacità.
const ROOT_PRESENTATION: readonly string[] = [
  "fill",
  "fill-opacity",
  "stroke",
  "stroke-width",
  "stroke-opacity",
  "stroke-linecap",
  "stroke-linejoin",
  "stroke-dasharray",
  "opacity",
  "font-family",
  "font-size",
  "font-weight",
  "text-anchor",
];

/// Gli attributi della radice che la vista sostituisce in un'immagine.
const ROOT_VIEW: ReadonlySet<string> = new Set(["x", "y", "width", "height", "viewBox", "preserveAspectRatio", "transform", "style"]);

/// Gli elementi SVG che non disegnano niente da soli: risorse, stili,
/// metadati. Un elemento di un altro namespace non disegna mai.
export const NON_RENDERING: ReadonlySet<string> = new Set([
  "defs",
  "style",
  "script",
  "metadata",
  "title",
  "desc",
  "linearGradient",
  "radialGradient",
  "pattern",
  "clipPath",
  "mask",
  "filter",
  "marker",
  "symbol",
  "font",
  "font-face",
  "color-profile",
  "cursor",
  "view",
]);

const SHAPE_TAGS: ReadonlySet<string> = new Set<ShapeTag>(["path", "rect", "ellipse", "circle", "line", "polyline", "polygon", "text", "image", "use"]);

/// Il segnaposto di un'immagine che non si carica: un riquadro tratteggiato
/// che riempie il posto dell'immagine. Senza `viewBox` né dimensioni non ha
/// proporzioni proprie, e `preserveAspectRatio` non lo restringe.
export const IMAGE_PLACEHOLDER = `data:image/svg+xml;base64,${btoa(
  "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"100%\" height=\"100%\">"
    + "<rect width=\"100%\" height=\"100%\" fill=\"#8080801f\" stroke=\"#808080\" stroke-width=\"2\" stroke-dasharray=\"6 4\"/>"
    + "</svg>",
)}`;

// ---------------------------------------------------------------------------
// Lettura di un elemento.
// ---------------------------------------------------------------------------

/// Un elemento letto da solo, nello scope del suo contenitore.
function readElement(raw: string, scope: NamespaceScope): { doc: XmlDocument; element: ElementNode; offset: number } | null {
  const fragment = parseFragment(raw, scope);
  if (fragment === null) return null;
  const element = fragment.doc.element(fragment.id)!;
  return { doc: fragment.doc, element, offset: element.start };
}

/// Gli attributi dipinti di `element`, e il suo `xml:space`.
function paintedAttributes(element: ElementNode): { attrs: PaintAttr[]; space: string | null } {
  const attrs: PaintAttr[] = [];
  let space: string | null = null;
  for (const attr of element.attrs) {
    if (attr.ns === NS_NONE && PAINTED_ATTRIBUTES.has(attr.local)) attrs.push([attr.local, attr.value]);
    else if (attr.ns === NS_XML && attr.local === "space") space = attr.value;
  }
  return { attrs, space };
}

/// Il testo dei figli di un elemento che ha solo dati di carattere.
function characters(doc: XmlDocument, element: ElementNode): string {
  let text = "";
  for (const child of element.children) {
    const node = doc.nodes[child]!;
    if (node.kind === "text") text += node.value;
  }
  return text;
}

/// La forma di un elemento modificabile, o `null` se non disegna niente da
/// solo (`title`, `desc`).
function shapeOf(leaf: LeafNode, scope: NamespaceScope): PaintShape | null {
  const details = leaf.details!;
  const tag = details.tag;
  if (!SHAPE_TAGS.has(tag)) return null;
  const read = readElement(leaf.raw, scope);
  // L'elemento è stato letto e classificato in questo scope: rileggerlo da
  // solo non può fallire, a meno di un errore del motore.
  if (read === null) throw new Error(`elemento modificabile illeggibile: ${leaf.facts.name}`);
  const { doc, element } = read;
  const { attrs, space } = paintedAttributes(element);
  const shape: { -readonly [K in keyof PaintShape]: PaintShape[K] } = {
    kind: "shape",
    tag: tag as ShapeTag,
    role: details.role,
    id: details.id,
    attrs,
    space,
  };
  if (tag === "text") {
    const runs: TextRun[] = [];
    /// Il testo di una riga o di un tracciato, e i suoi pezzi se ne ha.
    const content = (line: ElementNode): { text: string; parts?: (string | TextPiece)[] } => {
      const parts: (string | TextPiece)[] = [];
      let pieces = false;
      for (const part of line.children) {
        const inner = doc.nodes[part]!;
        if (inner.kind === "text") parts.push(inner.value);
        else if (inner.kind === "element") {
          pieces = true;
          parts.push({ ...paintedAttributes(inner), text: characters(doc, inner) });
        }
      }
      const text = parts.map((part) => (typeof part === "string" ? part : part.text)).join("");
      return pieces ? { text, parts } : { text };
    };
    for (const child of element.children) {
      const node = doc.nodes[child]!;
      if (node.kind === "text") {
        runs.push({ kind: "space", text: node.value });
      } else if (node.kind === "element" && node.ns === NS_SVG && node.local === "tspan") {
        const span = paintedAttributes(node);
        runs.push({ kind: "span", attrs: span.attrs, space: span.space, ...content(node) });
      } else if (node.kind === "element" && node.ns === NS_SVG && node.local === "textPath") {
        // La classificazione ha già trovato il tracciato fra le risorse.
        const href = textPathTarget(node);
        if (href !== null) runs.push({ kind: "path", href, startOffset: valueOf(node, NS_NONE, "startOffset") ?? null, ...content(node) });
      }
    }
    shape.runs = runs;
  } else if (tag === "image") {
    // SVG 2: `href` prevale su `xlink:href`.
    const value = valueOf(element, NS_NONE, "href") ?? valueOf(element, NS_XLINK, "href");
    if (value !== undefined) {
      const target = hrefKind(value);
      if (target.kind === "data" && target.raster) shape.image = { kind: "data", url: value };
      else if (target.kind === "vault") shape.image = { kind: "vault", path: target.url };
      else shape.image = { kind: "remote" };
    }
  } else if (tag === "use") {
    // La classificazione ha già trovato il simbolo, o l'originale.
    if (details.role === "copy") shape.original = details.original!;
    else shape.symbol = details.symbol!;
  }
  return shape;
}

/// L'elemento `element` di una risorsa, coi soli attributi e figli di
/// [`DEF_ATTRIBUTES`] e [`DEF_CHILDREN`]: titoli, descrizioni, id dei figli,
/// attributi di altri namespace e spazi fuori dai testi restano fuori. La
/// classificazione ha già giudicato i valori.
function defOf(doc: XmlDocument, element: ElementNode): PaintDef {
  const names = DEF_ATTRIBUTES.get(element.local);
  const attrs: PaintAttr[] = [];
  let space: string | null = null;
  for (const attr of element.attrs) {
    if (attr.ns === NS_NONE && names?.has(attr.local) === true) attrs.push([attr.local, attr.value]);
    else if (attr.ns === NS_XML && attr.local === "space") space = attr.value;
  }
  const allowed = DEF_CHILDREN.get(element.local);
  const text = element.local === "text" || element.local === "tspan";
  const children: (PaintDef | string)[] = [];
  for (const child of element.children) {
    const node = doc.nodes[child]!;
    if (node.kind === "text") {
      if (text) children.push(node.value);
    } else if (node.kind === "element" && node.ns === NS_SVG && allowed?.has(node.local) === true) {
      children.push(defOf(doc, node));
    }
  }
  return { tag: element.local, attrs, space, children };
}

/// La risorsa viva di un elemento modificabile di ruolo `resource`.
function resourceOf(leaf: LeafNode, scope: NamespaceScope): PaintResource {
  const read = readElement(leaf.raw, scope);
  // Come per le forme: l'elemento è stato letto e classificato in questo
  // scope.
  if (read === null || leaf.details!.id === null) throw new Error(`risorsa modificabile illeggibile: ${leaf.facts.name}`);
  return { ...defOf(read.doc, read.element), id: leaf.details!.id };
}

/// Le risorse di `resources` che servono a disegnare `nodes` dentro i
/// contenitori `chain`, con gli attributi dipinti di ciascuno: quelle a cui
/// rimandano, e a cascata le sfumature che il loro contenuto usa.
/// Nell'ordine di `resources`.
export function resourcesFor(
  nodes: readonly PaintNode[],
  chain: readonly (readonly PaintAttr[])[],
  resources: readonly PaintResource[],
): PaintResource[] {
  if (resources.length === 0) return [];
  const pending: string[] = [];
  const scan = (attrs: readonly PaintAttr[]): void => {
    for (const [name, value] of attrs) if (REFERENCE_ATTRIBUTES.has(name)) pending.push(...urlIds(value));
  };
  const visit = (node: PaintNode | PaintDef | string): void => {
    if (typeof node === "string") return;
    scan(node.attrs);
    if ("kind" in node && node.kind === "shape") {
      // Un testo su tracciato usa il suo tracciato.
      for (const run of node.runs ?? []) if (run.kind === "path") pending.push(run.href);
      return;
    }
    for (const child of node.children) visit(child);
  };
  for (const attrs of chain) scan(attrs);
  for (const node of nodes) visit(node);
  if (pending.length === 0) return [];
  const byId = new Map<string, PaintResource>();
  for (const resource of resources) if (!byId.has(resource.id)) byId.set(resource.id, resource);
  const used = new Set<PaintResource>();
  while (pending.length > 0) {
    const resource = byId.get(pending.pop()!);
    if (resource === undefined || used.has(resource)) continue;
    used.add(resource);
    visit(resource);
  }
  return resources.filter((resource) => used.has(resource));
}

/// I simboli di `symbols` che servono a disegnare `nodes`: quelli delle loro
/// istanze, e a cascata quelli delle istanze del loro contenuto.
/// Nell'ordine di `symbols`. Le risorse del contenuto le dà
/// [`resourcesFor`], coi simboli fra i nodi.
export function symbolsFor(nodes: readonly PaintNode[], symbols: readonly PaintGroup[]): PaintGroup[] {
  if (symbols.length === 0) return [];
  const byId = new Map<string, PaintGroup>();
  for (const symbol of symbols) if (symbol.id !== null && !byId.has(symbol.id)) byId.set(symbol.id, symbol);
  const used = new Set<PaintGroup>();
  // Una catena di simboli può essere lunga quanto il file: niente ricorsione.
  const pending: PaintNode[] = [...nodes];
  while (pending.length > 0) {
    const node = pending.pop()!;
    if (node.kind === "group") {
      pending.push(...node.children);
      continue;
    }
    const symbol = node.symbol === undefined ? undefined : byId.get(node.symbol);
    if (symbol === undefined || used.has(symbol)) continue;
    used.add(symbol);
    pending.push(symbol);
  }
  return symbols.filter((symbol) => used.has(symbol));
}

/// Il tag di un contenitore, letto: attributi dipinti, `xml:space`,
/// `display="none"`.
export interface HeadInfo {
  readonly head: string;
  readonly tail: string | null;
  readonly attrs: readonly PaintAttr[];
  readonly space: string | null;
  readonly hidden: boolean;
}

function headInfoOf(container: ContainerNode, scope: NamespaceScope): HeadInfo {
  const raw = container.tail === null ? container.head : container.head + container.tail;
  const read = readElement(raw, scope);
  if (read === null) throw new Error(`contenitore illeggibile: ${container.facts.name}`);
  const { attrs, space } = paintedAttributes(read.element);
  return {
    head: container.head,
    tail: container.tail,
    attrs,
    space,
    hidden: attrs.some(([name, value]) => name === "display" && value.trim() === "none"),
  };
}

/// I riferimenti per frammento di un testo: `url(#id)`, in qualunque
/// combinazione di maiuscole, e `href="#id"`, con qualunque prefisso. Un
/// riferimento scritto con entità non si riconosce, e l'immagine resta senza
/// quella risorsa.
function referencesIn(raw: string): string[] {
  const out: string[] = [];
  for (const match of raw.matchAll(/url\(\s*["']?#([^"')\s]+)/gi)) out.push(match[1]!);
  for (const match of raw.matchAll(/href\s*=\s*["']#([^"']+)["']/g)) out.push(match[1]!);
  return out;
}

/// Vero se `raw` contiene un elemento `style`, con o senza prefisso.
function hasStyle(raw: string): boolean {
  return /<(?:[\w.-]+:)?style[\s>/]/.test(raw);
}

/// `raw` con ogni `image` che non è un data URI raster indirizzato al
/// segnaposto: in un'immagine da blob un percorso del vault non si carica, e
/// un URL remoto non si carica mai.
function withPlaceholders(raw: string, scope: NamespaceScope): string {
  if (!raw.includes("image")) return raw;
  const read = readElement(raw, scope);
  if (read === null) return raw;
  const { doc, offset } = read;
  const ranges: Array<readonly [number, number]> = [];
  for (const node of doc.nodes) {
    if (node.kind !== "element" || node.ns !== NS_SVG || node.local !== "image") continue;
    for (const attr of node.attrs) {
      if (attr.local !== "href" || (attr.ns !== NS_NONE && attr.ns !== NS_XLINK)) continue;
      const target = hrefKind(attr.value);
      if (target.kind === "data" && target.raster) continue;
      ranges.push([attr.raw[0] - offset, attr.raw[1] - offset]);
    }
  }
  if (ranges.length === 0) return raw;
  ranges.sort((a, b) => a[0] - b[0]);
  let out = "";
  let at = 0;
  for (const [from, to] of ranges) {
    out += raw.slice(at, from) + IMAGE_PLACEHOLDER;
    at = to;
  }
  return out + raw.slice(at);
}

/// Vero se un'unità estranea disegna qualcosa da sola.
function renders(node: SceneNode): boolean {
  return node.kind === "leaf" && node.facts.uri === SVG_NS && !NON_RENDERING.has(node.facts.local);
}

/// Vero se `part` è un elemento modificabile.
function editable(part: SceneNode): part is ContainerNode | LeafNode {
  return part.kind === "container" || (part.kind === "leaf" && part.details !== null);
}

/// L'elemento di `index` con lo scope `signature` e il testo `raw`, tolto
/// dall'indice.
function take<T>(index: Map<string, Map<string, T>> | null, signature: string, raw: string): T | undefined {
  const bucket = index?.get(signature);
  const item = bucket?.get(raw);
  if (item !== undefined) bucket!.delete(raw);
  return item;
}

function sameSet<T>(a: ReadonlySet<T>, b: ReadonlySet<T>): boolean {
  if (a.size !== b.size) return false;
  for (const item of a) if (!b.has(item)) return false;
  return true;
}

function shallowEqual<T>(a: readonly T[], b: readonly T[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/// Un numero per un attributo della vista.
function num(value: number): string {
  return Number.isFinite(value) ? String(value) : "0";
}

// ---------------------------------------------------------------------------
// La visita.
// ---------------------------------------------------------------------------

/// Chi visita il documento in ordine: contenitori modificabili, elementi
/// modificabili e sequenze estranee (`parts[from..to)` di `owner`, spazi
/// interni compresi). Un'istanza di un simbolo che il painter non dipinge
/// vivo sta nelle sequenze estranee, che la mostrano col suo simbolo.
interface Visitor {
  /// `index` è la posizione del nodo nella sequenza del suo contenitore.
  open(node: ContainerNode, index: number): void;
  close(node: ContainerNode): void;
  element(node: LeafNode, index: number): void;
  run(owner: ContainerNode, from: number, to: number): void;
}

function visit(container: ContainerNode, visitor: Visitor, foreign: ReadonlySet<string>): void {
  const live = (part: SceneNode): part is ContainerNode | LeafNode =>
    editable(part) && !(part.kind === "leaf" && part.details!.role === "instance" && foreign.has(part.details!.symbol!));
  const parts = container.parts;
  let i = 0;
  while (i < parts.length) {
    const part = parts[i]!;
    if (typeof part === "string") {
      i++;
      continue;
    }
    if (part.kind === "container") {
      visitor.open(part, i);
      visit(part, visitor, foreign);
      visitor.close(part);
      i++;
      continue;
    }
    if (live(part)) {
      visitor.element(part, i);
      i++;
      continue;
    }
    let last = i;
    let j = i + 1;
    for (; j < parts.length; j++) {
      const next = parts[j]!;
      if (typeof next === "string") continue;
      if (live(next)) break;
      last = j;
    }
    visitor.run(container, i, last + 1);
    i = last + 1;
  }
}

/// Gli id dei simboli di `model` che il painter non dipinge vivi: quelli il
/// cui contenuto ha qualcosa di estraneo che si vede, che nel documento
/// vivo non entra, e a cascata quelli che ne usano uno. Le loro istanze si
/// disegnano negli strati immagine, col simbolo intero.
function foreignSymbols(model: DocumentModel): ReadonlySet<string> {
  const foreign = new Set<string>();
  const usedBy = new Map<string, string[]>();
  const scan = (container: ContainerNode, symbol: string): void => {
    for (const part of container.parts) {
      if (typeof part === "string") continue;
      if (part.kind === "container") scan(part, symbol);
      else if (part.kind === "leaf" && part.details !== null) {
        if (part.details.role !== "instance") continue;
        const target = part.details.symbol!;
        const users = usedBy.get(target);
        if (users === undefined) usedBy.set(target, [symbol]);
        else users.push(symbol);
      } else if (renders(part)) {
        foreign.add(symbol);
      }
    }
  };
  for (const defs of model.root.parts) {
    if (typeof defs === "string" || defs.kind !== "container" || defs.details?.role !== "defs") continue;
    for (const symbol of defs.parts) {
      if (typeof symbol !== "string" && symbol.kind === "container" && symbol.details?.role === "symbol") scan(symbol, symbol.facts.id!);
    }
  }
  const pending = [...foreign];
  while (pending.length > 0) {
    for (const user of usedBy.get(pending.pop()!) ?? []) {
      if (foreign.has(user)) continue;
      foreign.add(user);
      pending.push(user);
    }
  }
  return foreign;
}

/// Vero se la sequenza `parts[from..to)` disegna qualcosa.
function runRenders(parts: readonly Part[], from: number, to: number): boolean {
  for (let i = from; i < to; i++) {
    const part = parts[i]!;
    if (typeof part !== "string" && renders(part)) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Il costruttore.
// ---------------------------------------------------------------------------

/// Una bozza di gruppo, mentre lo strato vivo si riempie.
interface Draft {
  readonly container: ContainerNode;
  readonly children: Array<PaintShape | Draft>;
}

interface ScopeInfo {
  readonly declarations: ContainerNode["declarations"];
  readonly parent: ScopeInfo | null;
  readonly scope: NamespaceScope;
  /// Le associazioni in vigore, come testo: due scope uguali hanno la stessa
  /// firma.
  readonly signature: string;
}

/// Costruisce le scene di un documento, una dopo l'altra, riusando ciò che
/// non è cambiato.
export class PaintBuilder {
  private shapes = new WeakMap<LeafNode, PaintShape | null>();
  private resourceOf = new WeakMap<LeafNode, PaintResource>();
  /// Lo scope e il testo da cui viene ogni forma e ogni risorsa.
  private shapeText = new WeakMap<PaintShape | PaintResource, { readonly signature: string; readonly raw: string }>();
  /// Le forme e le risorse della scena precedente per scope e testo, mentre
  /// si disegna un modello nuovo: un motore riaperto sullo stesso testo ha
  /// nodi nuovi, e le forme e le risorse restano le stesse.
  private byText: Map<string, Map<string, PaintShape>> | null = null;
  private resourcesByText: Map<string, Map<string, PaintResource>> | null = null;
  private lastModel: DocumentModel | null = null;
  private lastScene: PaintScene | null = null;
  private heads = new WeakMap<ContainerNode, HeadInfo>();
  private headRefs = new WeakMap<HeadInfo, readonly string[]>();
  private scopes = new WeakMap<ContainerNode, ScopeInfo>();
  private refs = new WeakMap<SceneNode, readonly string[]>();
  private placeholders = new WeakMap<SceneNode, string>();
  private styles = new WeakMap<LeafNode, boolean>();
  private serials = new WeakMap<object, number>();
  private serial = 0;
  private groups = new WeakMap<ContainerNode, PaintGroup[]>();
  private lives: LiveLayer[] = [];
  private images = new Map<string, ImageLayer>();
  private rootCache: { head: string; tail: string | null; prolog: readonly Part[]; root: PaintRoot; image: ImageRoot; prologText: string } | null = null;
  private foreign: ReadonlySet<string> = new Set();

  /// L'ultima scena costruita; `null` prima della prima.
  get built(): PaintScene | null {
    return this.lastScene;
  }

  /// La scena del documento di `source`, che non è in sola lettura: un
  /// documento in sola lettura si disegna con [`wholeDocumentLayer`].
  build(source: PaintSource): PaintScene {
    const model = source.model;
    if (model === null) throw new Error("documento in sola lettura: si disegna intero, con wholeDocumentLayer");
    if (model !== this.lastModel) {
      this.byText = this.textIndex();
      this.resourcesByText = this.resourceIndex();
    }
    const root = this.rootOf(model);
    this.foreign = foreignSymbols(model);
    const plan = this.plan(model);
    const run = new BuildRun(this, source, model, plan, root.image, root.prologText, this.foreign);
    visit(model.root, run, this.foreign);
    const layers = run.finish();
    this.groups = run.nextGroups;
    this.lives = run.nextLives;
    this.images = run.nextImages;
    this.byText = null;
    this.resourcesByText = null;
    this.lastModel = model;
    const previous = this.lastScene?.resources;
    const resources = previous !== undefined && shallowEqual(previous, run.resources) ? previous : run.resources;
    const before = this.lastScene?.symbols;
    const symbols = before !== undefined && shallowEqual(before, run.symbols) ? before : run.symbols;
    const earlier = this.lastScene?.originals;
    const originals = earlier !== undefined && sameSet(earlier, run.originals) ? earlier : run.originals;
    const scene = { root: root.root, layers, resources, symbols, originals };
    this.lastScene = scene;
    return scene;
  }

  /// Le forme della scena precedente per scope e testo.
  private textIndex(): Map<string, Map<string, PaintShape>> | null {
    if (this.lastScene === null) return null;
    const index = new Map<string, Map<string, PaintShape>>();
    const add = (node: PaintNode): void => {
      if (node.kind === "group") {
        for (const child of node.children) add(child);
        return;
      }
      this.index(index, node);
    };
    for (const layer of this.lastScene.layers) if (layer.kind === "live") for (const node of layer.nodes) add(node);
    for (const symbol of this.lastScene.symbols) add(symbol);
    return index;
  }

  /// Le risorse della scena precedente per scope e testo.
  private resourceIndex(): Map<string, Map<string, PaintResource>> | null {
    if (this.lastScene === null || this.lastScene.resources.length === 0) return null;
    const index = new Map<string, Map<string, PaintResource>>();
    for (const resource of this.lastScene.resources) this.index(index, resource);
    return index;
  }

  /// Mette `item` in `index`, sotto il suo scope e il suo testo.
  private index<T extends PaintShape | PaintResource>(index: Map<string, Map<string, T>>, item: T): void {
    const origin = this.shapeText.get(item);
    if (origin === undefined) return;
    let bucket = index.get(origin.signature);
    if (bucket === undefined) index.set(origin.signature, (bucket = new Map()));
    bucket.set(origin.raw, item);
  }

  // --- memorie ---------------------------------------------------------------

  /// Il numero di un oggetto, stabile finché l'oggetto vive.
  serialOf(object: object): number {
    let serial = this.serials.get(object);
    if (serial === undefined) {
      serial = ++this.serial;
      this.serials.set(object, serial);
    }
    return serial;
  }

  scopeInfo(container: ContainerNode): ScopeInfo {
    const parent = container.parent === null ? null : this.scopeInfo(container.parent);
    const cached = this.scopes.get(container);
    if (cached !== undefined && cached.declarations === container.declarations && cached.parent === parent) return cached;
    const base = parent === null ? NamespaceScope.EMPTY : parent.scope;
    const scope = container.declarations.length === 0 ? base : base.declare(container.declarations);
    const info: ScopeInfo = {
      declarations: container.declarations,
      parent,
      scope,
      signature: container.declarations.length === 0 && parent !== null ? parent.signature : JSON.stringify(scope.entries()),
    };
    this.scopes.set(container, info);
    return info;
  }

  headInfo(container: ContainerNode): HeadInfo {
    const cached = this.heads.get(container);
    if (cached !== undefined && cached.head === container.head && cached.tail === container.tail) return cached;
    const parentScope = container.parent === null ? NamespaceScope.EMPTY : this.scopeInfo(container.parent).scope;
    const info = headInfoOf(container, parentScope);
    this.heads.set(container, info);
    return info;
  }

  /// La forma di un elemento modificabile; `null` se non disegna.
  shape(leaf: LeafNode): PaintShape | null {
    let shape = this.shapes.get(leaf);
    if (shape === undefined) {
      const scope = this.scopeInfo(leaf.parent!);
      shape = this.takeByText(scope.signature, leaf.raw) ?? shapeOf(leaf, scope.scope);
      if (shape !== null && !this.shapeText.has(shape)) this.shapeText.set(shape, { signature: scope.signature, raw: leaf.raw });
      this.shapes.set(leaf, shape);
    }
    return shape;
  }

  /// La forma della scena precedente con lo stesso scope e lo stesso testo,
  /// tolta dall'indice: due elementi identici di un modello nuovo non
  /// prendono la stessa forma, così ogni forma della scena è di un elemento
  /// solo, e gli strumenti la ritrovano con `paintsOf`.
  private takeByText(signature: string, raw: string): PaintShape | undefined {
    return take(this.byText, signature, raw);
  }

  /// La risorsa viva di un elemento modificabile di ruolo `resource`.
  resource(leaf: LeafNode): PaintResource {
    let resource = this.resourceOf.get(leaf);
    if (resource === undefined) {
      const scope = this.scopeInfo(leaf.parent!);
      resource = take(this.resourcesByText, scope.signature, leaf.raw) ?? resourceOf(leaf, scope.scope);
      if (!this.shapeText.has(resource)) this.shapeText.set(resource, { signature: scope.signature, raw: leaf.raw });
      this.resourceOf.set(leaf, resource);
    }
    return resource;
  }

  /// Vero se l'ultima scena dipinge vivo `symbol`, un simbolo del suo
  /// modello: se nel suo contenuto, a cascata, niente di estraneo si vede.
  drawsLive(symbol: ContainerNode): boolean {
    return symbol.facts.id !== null && !this.foreign.has(symbol.facts.id);
  }

  /// Vero se ciò che `container` contiene non si vede: un contenitore
  /// nascosto, o una `defs`, che non disegna i suoi figli. Un blocco estraneo
  /// lì dentro non diventa uno strato.
  conceals(container: ContainerNode): boolean {
    return container.details?.role === "defs" || this.headInfo(container).hidden;
  }

  /// Ciò che l'ultima scena disegna per `node`: la sua forma, o i gruppi di
  /// un contenitore, uno per ogni strato vivo che attraversa. Vuoto per un
  /// elemento che non disegna, o che l'ultima scena non contiene.
  paintsOf(node: ElementPart): readonly PaintNode[] {
    if (node.kind === "leaf") {
      const shape = this.shapes.get(node);
      return shape === undefined || shape === null ? [] : [shape];
    }
    return this.groups.get(node) ?? [];
  }

  /// Una chiave che cambia quando cambia il testo di `node`: il numero di
  /// un'unità, che non cambia mai; per un contenitore, che cambia sotto lo
  /// stesso oggetto, il numero del suo tag e le chiavi dei figli.
  contentKey(node: SceneNode): string {
    if (node.kind !== "container") return String(this.serialOf(node));
    let key = `${this.serialOf(this.headInfo(node))}(`;
    for (const part of node.parts) if (typeof part !== "string") key += `${this.contentKey(part)} `;
    return `${key})`;
  }

  /// Il gruppo di una bozza: lo stesso oggetto della scena precedente se
  /// tag e figli sono gli stessi.
  group(draft: Draft, children: readonly PaintNode[], ordinal: number, next: WeakMap<ContainerNode, PaintGroup[]>): PaintGroup {
    const container = draft.container;
    const info = this.headInfo(container);
    const previous = this.groups.get(container)?.[ordinal];
    const group = previous !== undefined && previous.attrs === info.attrs && previous.space === info.space && shallowEqual(previous.children, children)
      ? previous
      : {
        kind: "group" as const,
        key: container,
        role: container.details!.role,
        id: container.facts.id,
        attrs: info.attrs,
        space: info.space,
        children,
      };
    let list = next.get(container);
    if (list === undefined) next.set(container, (list = []));
    list[ordinal] = group;
    return group;
  }

  live(nodes: readonly PaintNode[], ordinal: number): LiveLayer {
    const previous = this.lives[ordinal];
    return previous !== undefined && shallowEqual(previous.nodes, nodes) ? previous : { kind: "live", nodes };
  }

  image(key: string, make: () => ImageLayer): ImageLayer {
    return this.images.get(key) ?? make();
  }

  /// I riferimenti del tag d'apertura di un contenitore, memorizzati col
  /// tag: un livello o un gruppo con un ritaglio, una maschera o un filtro
  /// li dà agli strati immagine che racchiude.
  headReferences(container: ContainerNode): readonly string[] {
    const info = this.headInfo(container);
    let refs = this.headRefs.get(info);
    if (refs === undefined) {
      refs = referencesIn(container.head);
      this.headRefs.set(info, refs);
    }
    return refs;
  }

  /// I riferimenti di un nodo, memorizzati.
  referencesOf(node: SceneNode): readonly string[] {
    let refs = this.refs.get(node);
    if (refs === undefined) {
      refs = referencesIn(rawOf(node));
      // Un contenitore cambia sotto lo stesso oggetto: i suoi riferimenti non
      // si tengono.
      if (node.kind !== "container") this.refs.set(node, refs);
    }
    return refs;
  }

  /// Vero se un'unità contiene un foglio di stile, memorizzato: un blocco
  /// estraneo grande si legge una volta sola.
  hasStyle(leaf: LeafNode): boolean {
    let style = this.styles.get(leaf);
    if (style === undefined) {
      style = hasStyle(leaf.raw);
      this.styles.set(leaf, style);
    }
    return style;
  }

  /// Il testo di un nodo per un'immagine, coi segnaposto delle immagini.
  imageRaw(node: SceneNode): string {
    if (node.kind === "other") return node.raw;
    // Un contenitore cambia sotto lo stesso oggetto: non si memorizza.
    if (node.kind === "container") {
      return withPlaceholders(rawOf(node), node.parent === null ? NamespaceScope.EMPTY : this.scopeInfo(node.parent).scope);
    }
    let raw = this.placeholders.get(node);
    if (raw === undefined) {
      raw = withPlaceholders(node.raw, this.scopeInfo(node.parent!).scope);
      this.placeholders.set(node, raw);
    }
    return raw;
  }

  // --- radice e piano ---------------------------------------------------------

  private rootOf(model: DocumentModel): { root: PaintRoot; image: ImageRoot; prologText: string } {
    const node = model.root;
    const prolog = model.parts.slice(0, model.parts.indexOf(node));
    const cached = this.rootCache;
    if (cached !== null && cached.head === node.head && cached.tail === node.tail && shallowEqual(cached.prolog, prolog)) return cached;
    const read = readElement(node.tail === null ? node.head : node.head + node.tail, NamespaceScope.EMPTY);
    if (read === null) throw new Error("radice illeggibile");
    const element = read.element;
    const attrs: PaintAttr[] = [];
    for (const name of ROOT_PRESENTATION) {
      const value = valueOf(element, NS_NONE, name);
      if (value !== undefined && svgAttribute("g", name, value)) attrs.push([name, value]);
    }
    const computed = {
      head: node.head,
      tail: node.tail,
      prolog,
      root: { attrs, page: pageOf(element), units: parseUnits(valueOf(element, NS_FUB, "units") ?? "") ?? "px", guides: guidesOf(element) },
      image: imageRootOf(element),
      prologText: prologText(prolog),
    };
    this.rootCache = computed;
    return computed;
  }

  /// Quali sequenze visibili si uniscono alla successiva, perché gli strati
  /// immagine non superino [`MAX_IMAGE_LAYERS`].
  private plan(model: DocumentModel): ReadonlySet<number> {
    const survey = new Survey(this);
    visit(model.root, survey, this.foreign);
    const excess = survey.runs - MAX_IMAGE_LAYERS;
    if (excess <= 0) return new Set();
    // Si uniscono i tratti con meno elementi vivi in mezzo; a parità, i
    // primi.
    const order = survey.between.map((count, index) => [count, index] as const);
    order.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    return new Set(order.slice(0, excess).map(([, index]) => index));
  }
}

/// La pagina della radice.
function pageOf(element: ElementNode): Page | null {
  const viewBox = valueOf(element, NS_NONE, "viewBox");
  const box = viewBox === undefined ? null : numberList(viewBox);
  if (box !== null && box.length === 4 && box[2]! > 0 && box[3]! > 0) {
    return { x: box[0]!, y: box[1]!, width: box[2]!, height: box[3]! };
  }
  const width = length(valueOf(element, NS_NONE, "width") ?? "");
  const height = length(valueOf(element, NS_NONE, "height") ?? "");
  return width !== null && height !== null && width > 0 && height > 0 ? { x: 0, y: 0, width, height } : null;
}

/// Le guide della radice: nessuna se non ce ne sono.
function guidesOf(element: ElementNode): readonly RulerGuide[] | null {
  const value = valueOf(element, NS_FUB, "guides");
  return value === undefined ? [] : parseGuides(value);
}

/// La radice di un'immagine, dagli attributi della radice letta.
function imageRootOf(element: ElementNode): ImageRoot {
  let attrs = "";
  let style: string | null = null;
  for (const attr of element.attrs) {
    if (attr.ns === NS_NONE && ROOT_VIEW.has(attr.local)) {
      if (attr.local === "style") style = attr.value;
      continue;
    }
    attrs += ` ${attr.name}="${escapeAttribute(attr.value)}"`;
  }
  return { name: element.name, attrs, style };
}

/// Il prologo di un'immagine: tutto ciò che precede la radice tranne la
/// dichiarazione XML, che direbbe una codifica che il blob non ha.
function prologText(parts: readonly Part[]): string {
  let out = "";
  for (const part of parts) {
    if (typeof part === "string") out += part;
    else if (!(part.kind === "other" && /^<\?xml[\s?]/.test(part.raw))) out += rawOf(part);
  }
  return out;
}

/// La prima visita: quante sequenze visibili ci sono, e quanti elementi vivi
/// fra una e la successiva.
class Survey implements Visitor {
  runs = 0;
  readonly between: number[] = [];
  private hidden = 0;
  private count = 0;
  /// Quanti contenitori aperti dentro un simbolo, lui compreso.
  private symbol = 0;

  constructor(private readonly builder: PaintBuilder) {}

  open(node: ContainerNode): void {
    if (this.builder.conceals(node)) this.hidden++;
    if (this.symbol > 0 || node.details?.role === "symbol") this.symbol++;
  }

  close(node: ContainerNode): void {
    if (this.builder.conceals(node)) this.hidden--;
    if (this.symbol > 0) this.symbol--;
  }

  element(node: LeafNode): void {
    // Una risorsa e il contenuto di un simbolo non sono forme vive: un'immagine
    // che li unisce non toglie niente agli strati vivi.
    if (node.details!.role !== "resource" && this.symbol === 0) this.count++;
  }

  run(owner: ContainerNode, from: number, to: number): void {
    if (this.hidden > 0 || !runRenders(owner.parts, from, to)) return;
    if (this.runs > 0) this.between.push(this.count);
    this.runs++;
    this.count = 0;
  }
}

/// Un punto della sequenza di un contenitore.
interface Position {
  readonly owner: ContainerNode;
  readonly index: number;
}

/// Lo strato immagine in costruzione.
interface ImageDraft {
  readonly pieces: string[];
  readonly keys: number[];
  /// I riferimenti di ciò che porta, che vanno nei `defs`: delle unità
  /// estranee, degli elementi vivi che unisce e dei tag dei contenitori,
  /// anche di quelli che la racchiudono.
  readonly refs: Array<readonly string[]>;
  /// Il primo e l'ultimo nodo che porta, nell'ordine del documento.
  readonly start: Position;
  end: Position;
  /// Quanti dei contenitori aperti racchiudono tutto ciò che porta.
  depth: number;
}

/// La seconda visita: costruisce gli strati.
class BuildRun implements Visitor {
  readonly nextGroups = new WeakMap<ContainerNode, PaintGroup[]>();
  readonly nextLives: LiveLayer[] = [];
  readonly nextImages = new Map<string, ImageLayer>();
  /// Le risorse modificabili, in ordine di documento.
  readonly resources: PaintResource[] = [];
  /// I simboli modificabili, in ordine di documento.
  readonly symbols: PaintGroup[] = [];
  /// Gli originali delle copie vive.
  readonly originals = new Set<string>();
  /// Il simbolo che si legge e i contenitori aperti dentro di lui: il suo
  /// contenuto sta nel simbolo, e non entra negli strati vivi.
  private readonly symbolChain: Draft[] = [];
  private readonly layers: Array<PaintLayer | null> = [];
  private readonly chain: ContainerNode[] = [];
  private hidden = 0;
  private runIndex = 0;
  // Lo strato vivo in corso.
  private roots: Array<PaintShape | Draft> = [];
  private liveChain: Draft[] = [];
  private ordinals = new Map<ContainerNode, number>();
  // Lo strato immagine in corso, e quelli chiusi che aspettano i `defs`.
  private image: ImageDraft | null = null;
  private readonly closed: Array<{ readonly image: ImageDraft; readonly slot: number; readonly containers: readonly ContainerNode[] }> = [];
  /// Le unità con un foglio di stile, in tutto il documento: valgono anche
  /// per un'immagine che le precede, e anche da un livello nascosto.
  private readonly styles: LeafNode[] = [];

  constructor(
    private readonly builder: PaintBuilder,
    private readonly source: PaintSource,
    private readonly model: DocumentModel,
    private readonly merge: ReadonlySet<number>,
    private readonly root: ImageRoot,
    private readonly prolog: string,
    private readonly foreign: ReadonlySet<string>,
  ) {}

  open(node: ContainerNode, index: number): void {
    const info = this.builder.headInfo(node);
    if (this.builder.conceals(node)) this.hidden++;
    this.chain.push(node);
    if (this.symbolChain.length > 0 || node.details?.role === "symbol") {
      const draft: Draft = { container: node, children: [] };
      this.symbolChain[this.symbolChain.length - 1]?.children.push(draft);
      this.symbolChain.push(draft);
    }
    const image = this.image;
    if (image !== null) {
      image.pieces.push(node.head);
      image.keys.push(this.builder.serialOf(info));
      image.refs.push(this.builder.headReferences(node));
      image.end = { owner: node.parent!, index };
    }
  }

  close(node: ContainerNode): void {
    if (this.builder.conceals(node)) this.hidden--;
    this.chain.pop();
    const draft = this.symbolChain[this.symbolChain.length - 1];
    if (draft !== undefined && draft.container === node) {
      this.symbolChain.pop();
      // Un simbolo che non si dipinge vivo non entra nella scena, ma il suo
      // gruppo resta per chi lo cerca con `paintsOf`.
      if (this.symbolChain.length === 0) {
        const group = this.finishNode(draft) as PaintGroup;
        if (!this.foreign.has(node.facts.id!)) this.symbols.push(group);
      }
    }
    if (this.liveChain.length > this.chain.length) this.liveChain.length = this.chain.length;
    const image = this.image;
    if (image === null) return;
    if (node.tail !== null) image.pieces.push(node.tail);
    image.depth = Math.min(image.depth, this.chain.length);
  }

  element(node: LeafNode, index: number): void {
    // Una risorsa è viva anche dentro un'immagine che la unisce, e non è
    // mai una forma; così il contenuto di un simbolo, che sta nel simbolo.
    const resource = node.details!.role === "resource";
    if (resource) this.resources.push(this.builder.resource(node));
    const symbol = this.symbolChain[this.symbolChain.length - 1];
    if (symbol !== undefined) {
      const shape = this.builder.shape(node);
      if (shape !== null) symbol.children.push(shape);
      if (shape?.original !== undefined) this.originals.add(shape.original);
    }
    const image = this.image;
    if (image !== null) {
      image.pieces.push(this.builder.imageRaw(node));
      image.keys.push(this.builder.serialOf(node));
      image.refs.push(this.builder.referencesOf(node));
      image.end = { owner: node.parent!, index };
      return;
    }
    if (resource || symbol !== undefined) return;
    const shape = this.builder.shape(node);
    if (shape === null) return;
    this.liveParent().push(shape);
    if (shape.original !== undefined) this.originals.add(shape.original);
  }

  run(owner: ContainerNode, from: number, to: number): void {
    for (let i = from; i < to; i++) {
      const part = owner.parts[i]!;
      if (typeof part !== "string" && part.kind === "leaf" && this.builder.hasStyle(part)) this.styles.push(part);
    }
    const visible = this.hidden === 0 && runRenders(owner.parts, from, to);
    let image = this.image;
    if (image === null) {
      if (!visible) return;
      this.closeLive();
      image = this.image = {
        pieces: this.chain.map((c) => c.head),
        keys: this.chain.map((c) => this.builder.serialOf(this.builder.headInfo(c))),
        refs: this.chain.map((c) => this.builder.headReferences(c)),
        start: { owner, index: from },
        end: { owner, index: from },
        depth: this.chain.length,
      };
    }
    for (let i = from; i < to; i++) {
      const part = owner.parts[i]!;
      if (typeof part === "string") {
        image.pieces.push(part);
        continue;
      }
      // Una sequenza ha solo unità estranee e altri nodi.
      const unit = part as LeafNode | OtherNode;
      image.pieces.push(this.builder.imageRaw(unit));
      image.keys.push(this.builder.serialOf(unit));
      image.refs.push(this.builder.referencesOf(unit));
    }
    image.end = { owner, index: to - 1 };
    if (!visible) return;
    const index = this.runIndex++;
    if (!this.merge.has(index)) this.closeImage();
  }

  /// Chiude ciò che è aperto e restituisce gli strati. I `defs` si cercano
  /// alla fine, quando i fogli di stile del documento sono tutti noti.
  finish(): PaintLayer[] {
    this.closeImage();
    this.closeLive();
    for (const { image, slot, containers } of this.closed) this.layers[slot] = this.imageLayer(image, containers);
    return this.layers as PaintLayer[];
  }

  // --- strati vivi -------------------------------------------------------------

  /// I figli del contenitore più profondo aperto, nello strato vivo in corso:
  /// i gruppi spezzati da un'immagine ricominciano qui.
  private liveParent(): Array<PaintShape | Draft> {
    let i = 0;
    while (i < this.liveChain.length && i < this.chain.length && this.liveChain[i]!.container === this.chain[i]) i++;
    this.liveChain.length = i;
    for (; i < this.chain.length; i++) {
      const draft: Draft = { container: this.chain[i]!, children: [] };
      (i === 0 ? this.roots : this.liveChain[i - 1]!.children).push(draft);
      this.liveChain.push(draft);
    }
    return this.liveChain.length === 0 ? this.roots : this.liveChain[this.liveChain.length - 1]!.children;
  }

  private finishNode(node: PaintShape | Draft): PaintNode {
    if ("kind" in node) return node;
    const children = node.children.map((child) => this.finishNode(child));
    const ordinal = this.ordinals.get(node.container) ?? 0;
    this.ordinals.set(node.container, ordinal + 1);
    return this.builder.group(node, children, ordinal, this.nextGroups);
  }

  private closeLive(): void {
    if (this.roots.length === 0) return;
    const nodes = this.roots.map((node) => this.finishNode(node));
    const layer = this.builder.live(nodes, this.nextLives.length);
    this.nextLives.push(layer);
    this.layers.push(layer);
    this.roots = [];
    this.liveChain = [];
  }

  // --- strati immagine ---------------------------------------------------------

  private closeImage(): void {
    const image = this.image;
    if (image === null) return;
    this.image = null;
    // I contenitori ancora aperti si chiudono, dal più interno.
    for (let i = this.chain.length - 1; i >= 0; i--) {
      const tail = this.chain[i]!.tail;
      if (tail !== null) image.pieces.push(tail);
    }
    this.closed.push({ image, slot: this.layers.length, containers: this.chain.slice(0, image.depth) });
    this.layers.push(null);
  }

  private imageLayer(image: ImageDraft, containers: readonly ContainerNode[]): ImageLayer {
    const defs = this.defsFor(image);
    const key = `${this.builder.serialOf(this.root)}|${image.keys.join(",")}|${defs.map((node) => this.builder.contentKey(node)).join(",")}`;
    const layer = this.builder.image(key, () => ({
      kind: "image",
      key,
      prolog: this.prolog,
      root: this.root,
      body: `${this.defsText(defs)}${image.pieces.join("")}</${this.root.name}>`,
      transparent: true,
      containers,
    }));
    this.nextImages.set(key, layer);
    return layer;
  }

  /// Gli elementi fuori dall'immagine che le servono: i fogli di stile, gli
  /// elementi a cui rimanda e, a cascata, quelli a cui rimandano loro. Non
  /// quelli che porta già, né un contenitore che la racchiude: il suo testo
  /// la ripeterebbe.
  private defsFor(image: ImageDraft): ElementPart[] {
    const pending: string[] = [];
    for (const refs of image.refs) for (const ref of refs) pending.push(ref);
    if (pending.length === 0 && this.styles.length === 0) return [];
    let range: { start: number[]; end: number[] } | null = null;
    const out: ElementPart[] = [];
    const seen = new Set<SceneNode>();
    let size = 0;
    const take = (node: ElementPart): void => {
      if (seen.has(node)) return;
      seen.add(node);
      range ??= { start: pathAt(image.start), end: pathAt(image.end) };
      if (overlaps(pathOfPart(node), range.start, range.end)) return;
      const raw = rawOf(node);
      if (size + raw.length > MAX_DEFS_CHARS) return;
      size += raw.length;
      out.push(node);
      for (const ref of this.builder.referencesOf(node)) pending.push(ref);
    };
    for (const style of this.styles) take(style);
    while (pending.length > 0) {
      const node = this.source.holder(pending.pop()!);
      if (node !== null) take(node);
    }
    return out;
  }

  /// I `defs` di un'immagine. Ogni elemento sta nello scope del suo
  /// contenitore: se dichiara prefissi che la radice non ha, un `g` li
  /// ridichiara.
  private defsText(defs: readonly ElementPart[]): string {
    if (defs.length === 0) return "";
    const rootScope = this.builder.scopeInfo(this.model.root);
    const prefix = svgPrefix(this.root.name);
    let out = `<${prefix}defs>`;
    for (const node of defs) {
      const scope = this.builder.scopeInfo(node.parent!);
      const raw = this.builder.imageRaw(node);
      if (scope === rootScope || scope.signature === rootScope.signature) {
        out += raw;
        continue;
      }
      let declarations = "";
      for (const [name, uri] of scope.scope.entries()) {
        declarations += name === null ? ` xmlns="${escapeAttribute(uri)}"` : ` xmlns:${name}="${escapeAttribute(uri)}"`;
      }
      out += `<${prefix}g${declarations}>${raw}</${prefix}g>`;
    }
    return `${out}</${prefix}defs>`;
  }
}

/// Il percorso di una posizione: l'indice di ogni contenitore nella sequenza
/// del suo, dalla radice, e infine `index`.
function pathAt(position: Position): number[] {
  const path = [position.index];
  for (let c = position.owner; c.parent !== null; c = c.parent) path.push(c.parent.parts.indexOf(c));
  return path.reverse();
}

function pathOfPart(node: ElementPart): number[] {
  const parent = node.parent;
  return parent === null ? [] : pathAt({ owner: parent, index: parent.parts.indexOf(node) });
}

/// Vero se `prefix` è l'inizio di `path`: il nodo di `prefix` racchiude
/// quello di `path`, o è lo stesso.
function isPrefix(prefix: readonly number[], path: readonly number[]): boolean {
  if (prefix.length > path.length) return false;
  for (let i = 0; i < prefix.length; i++) if (prefix[i] !== path[i]) return false;
  return true;
}

/// L'ordine del documento: un nodo viene prima di ciò che contiene.
function compare(a: readonly number[], b: readonly number[]): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) return a[i]! - b[i]!;
  return a.length - b.length;
}

/// Vero se il nodo in `path` sta fra `start` ed `end` compresi, dentro uno
/// dei due, o li racchiude.
function overlaps(path: readonly number[], start: readonly number[], end: readonly number[]): boolean {
  if (isPrefix(path, start) || isPrefix(path, end) || isPrefix(start, path) || isPrefix(end, path)) return true;
  return compare(path, start) > 0 && compare(path, end) < 0;
}

/// Il prefisso SVG della radice, coi due punti: `""` per `svg`.
function svgPrefix(rootName: string): string {
  const colon = rootName.indexOf(":");
  return colon < 0 ? "" : rootName.slice(0, colon + 1);
}

// ---------------------------------------------------------------------------
// Documenti immagine.
// ---------------------------------------------------------------------------

/// Il documento SVG di uno strato immagine per `frame`.
///
/// Girato, la radice dello strato diventa un `svg` annidato, con la vista
/// della scena che copre il rettangolo, dentro un `svg` grande quanto
/// l'immagine che lo gira: il browser disegna le forme già girate, nitide
/// sui pixel dello schermo, invece di girare un'immagine già fatta. Lo
/// `style` della radice va anche sull'`svg` esterno, che è quello che dipinge
/// lo sfondo. Una regola di stile del file che chiede la radice come genitore
/// diretto (`:root > g`) lì non vale più.
///
/// `css`, un foglio senza marcatura, va in uno `style` primo figlio dell'`svg`
/// più esterno: i caratteri che l'immagine non caricherebbe da fuori.
export function imageDocument(layer: ImageLayer, frame: ImageFrame, css = ""): string {
  const { root } = layer;
  const own = root.style === null ? "" : root.style;
  const style = layer.transparent ? `${own}${own === "" ? "" : ";"}background:none!important` : own;
  const styled = style === "" ? "" : ` style="${escapeAttribute(style)}"`;
  const size = ` width="${num(frame.pixelWidth)}" height="${num(frame.pixelHeight)}"`;
  const angle = frame.angle ?? 0;
  if (angle === 0) {
    const colon = root.name.indexOf(":");
    const sheet = colon < 0 ? "style" : `${root.name.slice(0, colon)}:style`;
    return `${layer.prolog}<${root.name}${root.attrs}${size}`
      + ` viewBox="${num(frame.x)} ${num(frame.y)} ${num(frame.width)} ${num(frame.height)}"`
      + ` preserveAspectRatio="none"${styled}>${css === "" ? "" : `<${sheet}>${css}</${sheet}>`}${layer.body}`;
  }
  // Il riquadro della scena attorno al rettangolo girato, largo due pixel in
  // più per lato: il bordo della vista annidata non sfuma gli angoli.
  const [cos, sin] = viewMatrix({ scale: 1, angle, tx: 0, ty: 0 });
  const xs = [0, frame.width * cos, frame.height * sin, frame.width * cos + frame.height * sin];
  const ys = [0, -frame.width * sin, frame.height * cos, frame.height * cos - frame.width * sin];
  const pad = (2 * frame.width) / Math.max(1, frame.pixelWidth);
  const bx = frame.x + Math.min(...xs) - pad;
  const by = frame.y + Math.min(...ys) - pad;
  const bw = Math.max(...xs) - Math.min(...xs) + 2 * pad;
  const bh = Math.max(...ys) - Math.min(...ys) + 2 * pad;
  const box = `${num(bx)} ${num(by)} ${num(bw)} ${num(bh)}`;
  return `${layer.prolog}<svg xmlns="${SVG_NS}"${size} viewBox="0 0 ${num(frame.width)} ${num(frame.height)}"`
    + ` preserveAspectRatio="none"${styled}>${css === "" ? "" : `<style>${css}</style>`}`
    + `<g transform="rotate(${num(angle)}) translate(${num(-frame.x)} ${num(-frame.y)})">`
    + `<${root.name}${root.attrs} x="${num(bx)}" y="${num(by)}" width="${num(bw)}" height="${num(bh)}"`
    + ` viewBox="${box}"${styled}>${layer.body}</g></svg>`;
}

/// Lo strato immagine di un documento intero: un SVG estraneo prima di
/// «Modifica», o un documento in sola lettura. Il testo resta com'è, tranne
/// la dichiarazione XML e la vista della radice; `null` se non è un SVG ben
/// formato.
export function wholeDocumentLayer(text: string): ImageLayer | null {
  // Lo stesso testo dà lo stesso strato: il painter non lo ridisegna.
  if (lastWhole !== null && lastWhole.text === text) return lastWhole.layer;
  const layer = readWholeDocument(text);
  lastWhole = { text, layer };
  return layer;
}

let lastWhole: { text: string; layer: ImageLayer | null } | null = null;
let wholeSerial = 0;

function readWholeDocument(text: string): ImageLayer | null {
  let doc: XmlDocument;
  try {
    doc = parseXml(new SourceText(text), true);
  } catch (error) {
    if (error instanceof XmlError) return null;
    throw error;
  }
  const element = doc.element(doc.root);
  if (element === null || element.ns !== NS_SVG || element.local !== "svg") return null;
  const raw = text.slice(0, element.start);
  const prolog = raw.replace(/^﻿/, "").replace(/^\s*<\?xml[\s?][^]*?\?>/, "");
  const selfClosing = text.charCodeAt(element.openEnd - 2) === 0x2f;
  const body = selfClosing ? `</${element.name}>${text.slice(element.openEnd)}` : text.slice(element.openEnd);
  return {
    kind: "image",
    key: `documento|${++wholeSerial}`,
    prolog,
    root: imageRootOf(element),
    body,
    transparent: false,
    containers: [],
  };
}
