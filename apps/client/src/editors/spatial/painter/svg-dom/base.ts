// Il painter SVG DOM, la base: i namespace, le famiglie vive dei caratteri,
// gli id vivi, le opzioni e la forma del painter, le soglie delle scene
// grandi e i record degli strati (`../svg-dom.ts`).

import type { Lifetime } from "../../../../ui/lifetime";
import type { Matrix } from "../../scene/matrix";
import type { Bounds } from "../../scene/geometry";
import type { Elem } from "../../scene/serialize";
import type { View } from "../../view";
import type { FontSheets } from "../../picture";
import { paintReference, reference, trim } from "../../scene/values";
import {
  REFERENCE_ATTRIBUTES,
  type ImageFrame,
  type ImageLayer,
  type LiveLayer,
  type PaintAttr,
  type PaintGroup,
  type PaintNode,
  type PaintResource,
  type PaintScene,
} from "../paint";

export const SVG = "http://www.w3.org/2000/svg";
export const XML = "http://www.w3.org/XML/1998/namespace";

/// Il DOM di una superficie: il prefisso dei suoi id vivi, e la
/// `font-family` da dare al browser per quella scritta.
export interface LiveDom {
  readonly prefix: string;
  readonly family: (value: string) => string;
}

/// La `font-family` scritta di ogni elemento a cui il painter ne ha data una
/// viva: quando i caratteri del disegno cambiano, si riscrive.
export const writtenFamilies = new WeakMap<Element, string>();

/// Dà a `el` la famiglia viva di `value`, e se ne ricorda.
export function setFamily(el: Element, value: string, dom: LiveDom): void {
  writtenFamilies.set(el, value);
  const live = dom.family(value);
  if (el.getAttribute("font-family") !== live) el.setAttribute("font-family", live);
}

/// Dà a `el`, che porta gli attributi della radice `attrs`, la famiglia di
/// un testo che nessuno la dice, se la radice non ne scrive una: come
/// nell'export, Literata.
export function setRootFamily(el: Element, attrs: readonly PaintAttr[], dom: LiveDom): void {
  if (!attrs.some(([name]) => name === "font-family")) setFamily(el, "", dom);
}

/// Le famiglie vive di `root`, di nuovo: un carattere del disegno è arrivato,
/// o non c'è più.
export function refreshFamilies(root: Element, dom: LiveDom): void {
  for (const el of root.querySelectorAll("[font-family]")) {
    const value = writtenFamilies.get(el);
    if (value === undefined) continue;
    const live = dom.family(value);
    if (el.getAttribute("font-family") !== live) el.setAttribute("font-family", live);
  }
}

/// L'id vivo della risorsa `id` sotto `prefix`: ogni carattere fuori da
/// `[A-Za-z0-9_-]` si scrive `.` + il suo codice esadecimale + `.`. Due id
/// diversi restano diversi, e `url(#…)` lo legge senza virgolette né
/// escape, in ogni browser.
export function liveId(prefix: string, id: string): string {
  let out = prefix;
  for (const char of id) out += /^[A-Za-z0-9_-]$/.test(char) ? char : `.${char.codePointAt(0)!.toString(16)}.`;
  return out;
}

/// Il valore di un attributo dipinto per il DOM di `prefix`: i riferimenti
/// alle risorse (`url(#id)`, col ripiego di `fill` e `stroke`) puntano agli
/// id vivi. `null` se il valore ha un `url(` che non si legge o che non sta
/// in un riferimento: allora l'attributo non entra, perché un `url(#…)` non
/// riscritto troverebbe un elemento della shell, o di un'altra superficie.
export function liveValue(prefix: string, name: string, value: string): string | null {
  if (!/url\(/i.test(value)) return value;
  if (!REFERENCE_ATTRIBUTES.has(name)) return null;
  if (name === "fill" || name === "stroke") {
    const used = paintReference(value);
    if (used === null) return null;
    // L'id non ha parentesi: la prima chiude il riferimento, e dopo viene
    // il ripiego, com'è scritto.
    const text = trim(value);
    return `url(#${liveId(prefix, used.id)})${text.slice(text.indexOf(")") + 1)}`;
  }
  const id = reference(value);
  return id === null ? null : `url(#${liveId(prefix, id)})`;
}

/// La camera come la legge il painter: la vista del disegno (`../view`), in
/// pixel CSS dall'angolo dell'elemento.
export type PainterView = View;

export interface PainterOptions {
  /// L'URL di un'immagine del vault, aperto nella vita che riceve: `null`
  /// se non si risolve. Senza, ogni immagine del vault è un segnaposto.
  readonly images?: (path: string, life: Lifetime) => Promise<string | null>;
  /// Dopo quanti millisecondi senza movimento gli strati immagine si
  /// ridisegnano alla vista nuova.
  readonly settleMs?: number;
  /// I caratteri del disegno per gli strati immagine, che da un `img` non li
  /// caricherebbero: quelli dell'app e del vault (`picture.ts`). Senza, uno
  /// strato immagine scrive coi caratteri del sistema.
  readonly fonts?: FontSheets;
  /// I caratteri del disegno: la `font-family` da dare al browser per quella
  /// scritta, e chi avvisa quando cambia. Senza, le sole famiglie di Fub.
  readonly families?: LiveFamilies;
}

/// La famiglia viva di ogni `font-family` di un disegno, e chi la cambia.
export interface LiveFamilies {
  readonly live: (value: string) => string;
  /// Chiama `listener` quando una famiglia viva cambia; torna chi smette.
  watch(listener: () => void): () => void;
}

/// Ciò che uno strumento mostra prima di scriverlo, sui nodi della scena
/// corrente: non cambia la scena, e la scena dopo non lo cancella.
export interface PainterDraft {
  /// Il `transform` da mostrare al posto di quello dipinto; `null` lo toglie.
  /// È il valore che l'operazione scriverà, così l'anteprima è il risultato.
  readonly transforms?: ReadonlyMap<PaintNode, string | null>;
  /// Il `d` da mostrare al posto di quello dipinto: un tracciato i cui nodi
  /// si stanno spostando. Anche questo è il valore che si scriverà. Una
  /// forma che non è un `path`, come un rettangolo, si nasconde, e al suo
  /// posto si vede un `path` coi suoi attributi.
  readonly paths?: ReadonlyMap<PaintNode, string>;
  /// I raggi degli angoli da mostrare al posto di quelli dipinti, `rx` e
  /// `ry`: un rettangolo mentre la maniglia lo arrotonda; `null` ne toglie
  /// uno. Gli altri nomi non contano.
  readonly radii?: ReadonlyMap<PaintNode, Readonly<Record<string, string | null>>>;
  /// Le forme il cui contorno si mostra come un tracciato pieno: un
  /// contorno che lo strumento Spessore sta per rendere a spessore
  /// variabile. La forma resta col suo riempimento, senza contorno, e sopra
  /// si vede un `path` con gli attributi dati, il `d` e il colore.
  readonly strokes?: ReadonlyMap<PaintNode, Readonly<Record<string, string>>>;
  /// I nodi che la gomma sta per togliere: si vedono sbiaditi.
  readonly faded?: ReadonlySet<PaintNode>;
  /// I nodi che non si vedono: un testo mentre lo si scrive sul posto, che
  /// l'editor mostra al suo posto.
  readonly hidden?: ReadonlySet<PaintNode>;
  /// Come si spostano i contenitori che si trasformano, per chiave
  /// (`PaintGroup.key`): la trasformazione della scena da dove sono a dove
  /// si mostrano. Uno strato immagine che sta tutto dentro uno di loro la
  /// segue; dentro più d'uno, segue il più esterno.
  readonly carried?: ReadonlyMap<object, Matrix>;
  /// I contenitori che la gomma sta per togliere, per chiave: uno strato
  /// immagine che sta tutto dentro uno di loro si vede sbiadito.
  readonly fadedContainers?: ReadonlySet<object>;
  /// I nodi da mostrare con un altro elemento al loro posto, che prende la
  /// loro trasformazione: un testo in area mentre la cornice ne cambia il
  /// riquadro, con le righe che andranno a capo.
  readonly replaced?: ReadonlyMap<PaintNode, Elem>;
  /// Il `d` da mostrare al posto di quello di una risorsa, per id: il
  /// tracciato di un testo mentre lo strumento Nodi ne sposta i nodi. Chi
  /// lo segue lo segue già.
  readonly tracks?: ReadonlyMap<string, string>;
  /// Il riempimento o il contorno da mostrare al posto di quello dipinto:
  /// un colore, o una sfumatura, che entra in una `defs` dell'anteprima
  /// sotto un id suo. Una sfumatura mentre la si cambia; il valore sta
  /// nello stile in linea, che vale più dei fogli di stile del disegno.
  readonly paints?: ReadonlyMap<PaintNode, Readonly<Partial<Record<"fill" | "stroke", string | Elem>>>>;
}

/// Gli attributi che un'anteprima cambia, e che toglierla riporta a com'erano
/// dipinti.
export const DRAFTED = ["transform", "d", "rx", "ry"] as const;

/// Gli attributi della geometria delle forme, che il `path` al loro posto
/// non prende.
export const SHAPE_GEOMETRY: ReadonlySet<string> = new Set(["x", "y", "width", "height", "rx", "ry", "cx", "cy", "r", "x1", "y1", "x2", "y2", "points"]);

/// Gli attributi della pittura, che il contorno pieno sopra una forma non
/// prende da lei.
export const PAINTING = /^(fill|stroke|marker)/;

/// L'opacità di un nodo sbiadito dalla gomma.
export const FADED_OPACITY = "0.25";

/// L'opacità della parte di un'immagine che il ritaglio toglie, mentre lo
/// si regola.
export const CROPPED_OPACITY = "0.3";

/// Un ritaglio che si regola: il riquadro dell'immagine (`x y width
/// height`) e la parte che ne resterà, nelle sue coordinate.
export interface CropCover {
  readonly box: Bounds;
  readonly rect: Bounds;
}

/// Quanto si attenua ciò che sta fuori dal gruppo isolato: un fattore
/// dell'opacità che il nodo ha già.
export const DIMMED_OPACITY = 0.4;

export interface ScenePainter {
  /// Disegna `scene` al posto della scena precedente.
  update(scene: PaintScene): void;
  /// Mostra `draft` sopra la scena, al posto del precedente; `null` lo
  /// toglie. Vale finché non lo si cambia, anche dopo un `update`: un gruppo
  /// si ritrova dal suo contenitore, una forma che la scena nuova non
  /// contiene più resta senza anteprima.
  setDraft(draft: PainterDraft | null): void;
  /// Attenua tutto tranne ciò che sta dentro l'ultimo dei contenitori
  /// `chain`, chiavi di gruppi della scena (`PaintGroup.key`) dal più
  /// esterno al più interno: il gruppo isolato e chi lo contiene. La carta
  /// resta com'è. `null` toglie l'attenuazione. Vale finché non la si
  /// cambia, anche dopo un `update`.
  setFocus(chain: readonly object[] | null): void;
  /// Mostra al posto di ogni immagine di `covers` l'elemento dato, senza
  /// titoli né id: il gruppo di tracciati che un ricalco sta per scrivere.
  /// L'elemento prende la trasformazione che l'immagine mostra, anche
  /// mentre un'anteprima la sposta. `null` le toglie. Valgono finché non le
  /// si cambia, anche dopo un `update` e con ogni anteprima.
  setCovers(covers: ReadonlyMap<PaintNode, Elem> | null): void;
  /// Mostra ogni immagine di `crops` col suo riquadro e il ritaglio dati:
  /// intera e attenuata, e sopra la parte che resterà. Il ritaglio che ha
  /// e la maschera non contano. `null` le riporta come sono. Valgono come
  /// le coperture.
  setCrops(crops: ReadonlyMap<PaintNode, CropCover> | null): void;
  /// Sposta la camera.
  setView(view: PainterView): void;
  /// Ridisegna subito gli strati immagine che ne hanno bisogno, senza
  /// aspettare che la camera stia ferma.
  settle(): void;
  /// La vista dei contorni: ogni tracciato un filo di un pixel, senza
  /// riempimenti né effetti, il testo pieno e le immagini velate. Il disegno
  /// non cambia.
  setOutline(on: boolean): void;
  /// Toglie tutto dal DOM e revoca ogni risorsa. Chiudere la vita di chi lo
  /// ha montato fa lo stesso.
  dispose(): void;
}

/// `elem` nel DOM di `doc`, coi figli e il testo che si vedono: i titoli,
/// le descrizioni, gli id e gli attributi di FubDraw restano fuori.
export function drawn(doc: Document, elem: Elem, dom: LiveDom): Element {
  const el = doc.createElementNS(SVG, elem.tag);
  for (const [name, value] of Object.entries(elem.attrs)) {
    if (name === "font-family") setFamily(el, value, dom);
    else if (name !== "id" && !name.startsWith("fub:")) el.setAttribute(name, value);
  }
  for (const child of elem.children ?? []) if (child.tag !== "title" && child.tag !== "desc") el.append(drawn(doc, child, dom));
  for (const run of elem.runs ?? []) el.append(typeof run === "string" ? run : drawn(doc, { tag: "tspan", attrs: run.attrs, text: run.text }, dom));
  if (elem.runs === undefined && typeof elem.text === "string") el.append(elem.text);
  return el;
}

/// Il margine di un'immagine attorno alla vista, per lato, in frazioni della
/// vista: lo spazio che una panoramica può scoprire prima del ridisegno.
export const MARGIN = 1 / 8;

export const DEFAULT_SETTLE_MS = 150;

/// Da quante forme vive una scena è grande: mentre la camera si muove, gli
/// strati la seguono con la trasformazione della radice, e si ridisegnano a
/// camera ferma. Con cinquantamila forme un passo di zoom ridisposto e
/// ridipinto costa al browser un decimo di secondo; con cinquemila, quanto un
/// fotogramma.
export const LARGE_SCENE_SHAPES = 5000;

/// Il margine che una scena grande dipinge attorno alla vista, per lato, in
/// frazioni del lato più lungo della vista: ciò che una panoramica o uno zoom
/// indietro possono scoprire prima di ridisegnare. Il resto è tagliato: il
/// primo fotogramma in cui la radice si muove costa a Chromium in proporzione
/// alla sua area sullo schermo, e con tutto il disegno dentro, duecento
/// tavole viste da vicino, un passo costava più di mezzo secondo.
export const LARGE_MARGIN = 1 / 4;

/// Fino a quale ingrandimento il primo passo di un movimento porta gli strati
/// con la radice. Oltre, come per un salto su una tavola o sulla scelta, li
/// ridisegna subito: la radice ingrandita costerebbe di più, e mostrerebbe
/// pixel sfocati.
export const LARGE_CARRY = 2;

/// Una forma o un gruppo nel DOM.
export interface NodeRecord {
  readonly paint: PaintNode;
  readonly el: SVGElement;
  /// La vita delle risorse di un'`image` del vault.
  readonly life: Lifetime | null;
  /// I figli di un gruppo.
  children: NodeRecord[];
}

export interface LiveRecord {
  readonly kind: "live";
  layer: LiveLayer;
  readonly el: SVGSVGElement;
  readonly camera: SVGGElement;
  rootAttrs: readonly PaintAttr[];
  children: NodeRecord[];
}

/// Un'immagine decodificata, pronta o in mostra.
export interface Rendered {
  readonly img: HTMLImageElement;
  readonly url: string;
  readonly frame: ImageFrame;
  /// La vista per cui è stata disegnata, e la sua posizione nell'elemento.
  readonly view: PainterView;
  readonly left: number;
  readonly top: number;
  /// Lo spostamento della scena con cui si mostra; `null` se nessuno.
  carried: Matrix | null;
}

export interface ImageRecord {
  readonly kind: "image";
  layer: ImageLayer;
  /// Il segnaposto nel DOM finché non c'è un'immagine, poi l'immagine.
  el: HTMLElement;
  shown: Rendered | null;
  /// L'immagine in decodifica, se c'è.
  pending: Rendered | null;
  /// Cresce a ogni richiesta di ridisegno: una decodifica arrivata tardi non
  /// sostituisce un'immagine più nuova.
  generation: number;
  /// Lo spostamento che l'anteprima dà allo strato; `null` se nessuno.
  carried: Matrix | null;
}

export type LayerRecord = LiveRecord | ImageRecord;

/// Le risorse vive: un `svg` senza misura con la `defs`, che porta gli
/// attributi della radice perché il contenuto delle risorse li erediti come
/// nel file.
export interface DefsRecord {
  readonly el: SVGSVGElement;
  readonly defs: SVGDefsElement;
  resources: readonly PaintResource[];
  /// L'elemento di ogni risorsa che la `defs` mostra.
  nodes: Map<PaintResource, SVGElement>;
  rootAttrs: readonly PaintAttr[];
  /// La `defs` dei simboli, dopo quella delle risorse: il contenuto di un
  /// simbolo eredita dall'istanza, non dalla radice.
  readonly symbolDefs: SVGDefsElement;
  symbols: readonly PaintGroup[];
  /// I nodi dei simboli, riconciliati come quelli di uno strato vivo.
  symbolRecords: NodeRecord[];
}

/// Monta un painter dentro `host`.
/// Il foglio della vista dei contorni, per gli `svg` dentro `scope`.
export function outlineSheet(scope: string): string {
  const all = `${scope}svg *`;
  const text = `${scope}svg text, ${scope}svg tspan, ${scope}svg textPath`;
  return `${all}{fill:none!important;stroke:#1a1a1a!important;stroke-width:1px!important;stroke-dasharray:none!important;`
    + `stroke-opacity:1!important;opacity:1!important;vector-effect:non-scaling-stroke!important;filter:none!important;`
    + `mask:none!important;mix-blend-mode:normal!important;marker:none!important}`
    + `${text}{fill:#1a1a1a!important;fill-opacity:1!important;stroke:none!important}`
    + `${scope}svg image{opacity:0.25!important}`;
}
