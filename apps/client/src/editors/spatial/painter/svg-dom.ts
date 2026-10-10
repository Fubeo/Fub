// Il painter SVG DOM: disegna una `PaintScene` dentro un elemento della
// shell, uno strato sopra l'altro nell'ordine del documento.
//
// - **Strati vivi:** un elemento `svg` grande quanto la vista, con un `g`
//   che porta la camera. Le forme si creano con `createElementNS` e i soli
//   attributi dipinti: nessun testo della sorgente diventa DOM, nessun `id`
//   del disegno entra nel documento della shell (resta in `data-scene-id`),
//   un collegamento è un `g`. Fra un aggiornamento e l'altro si
//   riconciliano per identità: una forma che la scena ripete è lo stesso
//   nodo DOM.
// - **Risorse vive:** le sfumature, i motivi, i marcatori, i ritagli, le
//   maschere e i filtri modificabili stanno in una `defs` dentro un `svg`
//   senza misura, prima degli strati, finché la scena ne ha. Si creano come
//   le forme, elemento per elemento, coi soli elementi e attributi del
//   formato. Il loro id è quello del disegno dopo il prefisso del painter
//   ([`liveId`]), e così ogni `url(#…)` degli oggetti vivi e del contenuto
//   delle risorse: due superfici nella stessa pagina non si rubano le
//   risorse, e un riferimento non trova mai un elemento della shell. Una
//   risorsa che la scena ripete è lo stesso nodo; una che cambia si rifà, e
//   il browser ridisegna chi la usa.
// - **Simboli vivi:** stanno in una seconda `defs` dello stesso `svg`, come
//   `symbol` con l'id vivo e `overflow="visible"`, e il loro contenuto si
//   crea e si riconcilia come quello di uno strato vivo. Un'istanza è un
//   `use` vivo verso l'id vivo del suo simbolo: il browser la disegna col
//   contenuto, e un'anteprima sul contenuto si vede in ogni istanza.
// - **Strati immagine:** un `<img>` da blob, disegnato per il rettangolo della
//   vista più un margine. Mentre la camera si muove l'immagine segue con una
//   trasformazione CSS; quando si ferma si ridisegna alla nuova scala e al
//   nuovo angolo, e la nuova immagine prende il posto della vecchia solo dopo
//   la decodifica, senza lampi. Ogni URL di blob si revoca quando l'immagine
//   lascia il DOM. Con la vista girata l'immagine resta allineata ai pixel
//   dello schermo, e il disegno vi entra già girato.
// - **Immagini del vault:** un'`image` viva con un percorso del vault chiede
//   l'URL a chi monta il painter, con una vita sua che si chiude quando
//   l'elemento esce dalla scena. Un'immagine che non si risolve, e ogni URL
//   remoto, mostrano il segnaposto.
// - **Anteprima degli strumenti:** mentre si trascina una selezione o si
//   passa la gomma, `setDraft` cambia il `transform` dei nodi vivi o li
//   sbiadisce, e cambia il `d` di un tracciato i cui nodi si spostano, senza
//   ricrearli e senza toccare la scena; l'operazione scritta
//   alla fine porta la scena nuova. Un testo che si scrive sul posto si
//   nasconde allo stesso modo. Una sfumatura che si cambia si mostra da una
//   `defs` dell'anteprima, a cui l'oggetto punta nello stile in linea. Uno
//   strato immagine che sta tutto dentro un gruppo che si sposta segue il
//   gruppo con una trasformazione CSS, e dopo l'operazione resta dove l'ha
//   portato finché la sua immagine nuova non è pronta.
// - **Isolamento:** con un gruppo isolato, `setFocus` attenua tutto ciò che
//   gli sta fuori, carta esclusa, con l'opacità degli elementi; il disegno
//   non cambia. Con un simbolo isolato resta com'è l'istanza da cui lo si
//   modifica, e le altre si attenuano.
//
// - **Miniature:** `paintMiniature` disegna alcuni nodi della scena in un
//   `svg` a sé, con gli stessi elementi e gli stessi attributi, dentro gli
//   stili di chi li contiene, e con le risorse e i simboli che usano, sotto
//   un prefisso suo: l'albero degli oggetti le mostra accanto ai nomi.
//
// Tutto ciò che il painter apre (timer, osservatori, lease) appartiene alla
// sua vita, e la vita di chi lo monta la chiude.

import { openLifetime, type Lifetime } from "../../../ui/lifetime";
import { compose, invert, type Matrix } from "../scene/matrix";
import type { Bounds } from "../scene/geometry";
import type { Elem } from "../scene/serialize";
import { toScene, viewMatrix, viewTransform, type View } from "../view";
import type { FontSheets } from "../picture";
import { blendStyle, paintReference, reference, trim } from "../scene/values";
import { fubLiveFamily } from "../fonts/faces";
import { layerText, namesVault } from "../fonts/vault";
import {
  DEF_ATTRIBUTES,
  DEF_CHILDREN,
  IMAGE_PLACEHOLDER,
  imageDocument,
  PAINTED_ATTRIBUTES,
  REFERENCE_ATTRIBUTES,
  RESOURCE_TAGS,
  type ImageFrame,
  type ImageLayer,
  type LiveLayer,
  type PaintAttr,
  type PaintDef,
  type PaintGroup,
  type PaintNode,
  type PaintResource,
  type PaintScene,
  type PaintShape,
} from "./paint";

const SVG = "http://www.w3.org/2000/svg";
const XML = "http://www.w3.org/XML/1998/namespace";

/// Quante superfici e quante miniature si sono disegnate: ognuna ha il suo
/// prefisso per gli id delle risorse.
let surfaces = 0;
let miniatures = 0;

/// Il DOM di una superficie: il prefisso dei suoi id vivi, e la
/// `font-family` da dare al browser per quella scritta.
interface LiveDom {
  readonly prefix: string;
  readonly family: (value: string) => string;
}

/// La `font-family` scritta di ogni elemento a cui il painter ne ha data una
/// viva: quando i caratteri del disegno cambiano, si riscrive.
const writtenFamilies = new WeakMap<Element, string>();

/// Dà a `el` la famiglia viva di `value`, e se ne ricorda.
function setFamily(el: Element, value: string, dom: LiveDom): void {
  writtenFamilies.set(el, value);
  const live = dom.family(value);
  if (el.getAttribute("font-family") !== live) el.setAttribute("font-family", live);
}

/// Dà a `el`, che porta gli attributi della radice `attrs`, la famiglia di
/// un testo che nessuno la dice, se la radice non ne scrive una: come
/// nell'export, Literata.
function setRootFamily(el: Element, attrs: readonly PaintAttr[], dom: LiveDom): void {
  if (!attrs.some(([name]) => name === "font-family")) setFamily(el, "", dom);
}

/// Le famiglie vive di `root`, di nuovo: un carattere del disegno è arrivato,
/// o non c'è più.
function refreshFamilies(root: Element, dom: LiveDom): void {
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
function liveValue(prefix: string, name: string, value: string): string | null {
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
const DRAFTED = ["transform", "d", "rx", "ry"] as const;

/// Gli attributi della geometria delle forme, che il `path` al loro posto
/// non prende.
const SHAPE_GEOMETRY: ReadonlySet<string> = new Set(["x", "y", "width", "height", "rx", "ry", "cx", "cy", "r", "x1", "y1", "x2", "y2", "points"]);

/// Gli attributi della pittura, che il contorno pieno sopra una forma non
/// prende da lei.
const PAINTING = /^(fill|stroke|marker)/;

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
  /// Toglie tutto dal DOM e revoca ogni risorsa. Chiudere la vita di chi lo
  /// ha montato fa lo stesso.
  dispose(): void;
}

/// `elem` nel DOM di `doc`, coi figli e il testo che si vedono: i titoli,
/// le descrizioni, gli id e gli attributi di FubDraw restano fuori.
function drawn(doc: Document, elem: Elem, dom: LiveDom): Element {
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
const MARGIN = 1 / 8;

const DEFAULT_SETTLE_MS = 150;

/// Una forma o un gruppo nel DOM.
interface NodeRecord {
  readonly paint: PaintNode;
  readonly el: SVGElement;
  /// La vita delle risorse di un'`image` del vault.
  readonly life: Lifetime | null;
  /// I figli di un gruppo.
  children: NodeRecord[];
}

interface LiveRecord {
  readonly kind: "live";
  layer: LiveLayer;
  readonly el: SVGSVGElement;
  readonly camera: SVGGElement;
  rootAttrs: readonly PaintAttr[];
  children: NodeRecord[];
}

/// Un'immagine decodificata, pronta o in mostra.
interface Rendered {
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

interface ImageRecord {
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

type LayerRecord = LiveRecord | ImageRecord;

/// Le risorse vive: un `svg` senza misura con la `defs`, che porta gli
/// attributi della radice perché il contenuto delle risorse li erediti come
/// nel file.
interface DefsRecord {
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
export function createSvgPainter(host: HTMLElement, owner: Lifetime, options: PainterOptions = {}): ScenePainter {
  const life = openLifetime();
  const settleMs = options.settleMs ?? DEFAULT_SETTLE_MS;
  const prefix = `fubdraw${++surfaces}-`;
  const dom: LiveDom = { prefix, family: options.families?.live ?? fubLiveFamily };
  const root = document.createElement("div");
  root.className = "spatial-painter";
  // La scena si legge dalla sua struttura accessibile, non dal disegno.
  root.setAttribute("aria-hidden", "true");
  host.append(root);

  let view: PainterView = { scale: 1, angle: 0, tx: 0, ty: 0 };
  let width = host.clientWidth;
  let height = host.clientHeight;
  let layers: LayerRecord[] = [];
  let defs: DefsRecord | null = null;
  let disposed = false;

  let settleTimer: ReturnType<typeof setTimeout> | null = null;
  const clearSettle = (): void => {
    if (settleTimer !== null) clearTimeout(settleTimer);
    settleTimer = null;
  };
  life.add(clearSettle);
  if (options.families !== undefined) {
    life.add(options.families.watch(() => {
      refreshFamilies(root, dom);
      // Gli strati immagine coi testi nelle famiglie del vault si ridisegnano
      // col foglio nuovo.
      for (const record of layers) if (record.kind === "image" && namesVault(record.layer)) render(record);
    }));
  }

  // --- forme ------------------------------------------------------------------

  const createShape = (shape: PaintShape): NodeRecord => {
    const { el, life: imageLife } = shapeElement(shape, shape.id, dom, options.images, null);
    return { paint: shape, el, life: imageLife, children: [] };
  };

  const createGroup = (group: PaintGroup): NodeRecord => {
    const el = document.createElementNS(SVG, group.role === "symbol" ? "symbol" : "g");
    setPainted(el, group.attrs, [], dom);
    setCommon(el, group.id, group.space);
    if (group.role === "symbol") setSymbol(el, group.id!, dom);
    const record: NodeRecord = { paint: group, el, life: null, children: [] };
    record.children = reconcile(el, [], group.children);
    return record;
  };

  const updateGroup = (record: NodeRecord, group: PaintGroup): NodeRecord => {
    const previous = record.paint as PaintGroup;
    setPainted(record.el, group.attrs, previous.attrs, dom);
    if (group.id !== previous.id || group.space !== previous.space) setCommon(record.el, group.id, group.space);
    if (group.role === "symbol" && group.id !== previous.id) setSymbol(record.el, group.id!, dom);
    const children = reconcile(record.el, record.children, group.children);
    return { paint: group, el: record.el, life: null, children };
  };

  const disposeNode = (record: NodeRecord): void => {
    record.life?.close();
    for (const child of record.children) disposeNode(child);
  };

  /// Porta i figli di `parent` da `previous` a `next`, riusando ciò che
  /// resta: prima gli oggetti identici, poi i gruppi dello stesso
  /// contenitore.
  function reconcile(parent: SVGElement, previous: readonly NodeRecord[], next: readonly PaintNode[]): NodeRecord[] {
    const byPaint = new Map<PaintNode, NodeRecord[]>();
    const byKey = new Map<object, NodeRecord[]>();
    for (const record of previous) {
      push(byPaint, record.paint, record);
      if (record.paint.kind === "group") push(byKey, record.paint.key, record);
    }
    const used = new Set<NodeRecord>();
    const take = (pool: Map<object, NodeRecord[]>, key: object): NodeRecord | undefined => {
      const list = pool.get(key);
      while (list !== undefined && list.length > 0) {
        const record = list.shift()!;
        if (!used.has(record)) return record;
      }
      return undefined;
    };
    const out: Array<NodeRecord | null> = next.map((node) => {
      const same = take(byPaint, node);
      if (same !== undefined) {
        used.add(same);
        return same;
      }
      return null;
    });
    for (let i = 0; i < next.length; i++) {
      if (out[i] !== null) continue;
      const node = next[i]!;
      if (node.kind === "group") {
        const similar = take(byKey, node.key);
        if (similar !== undefined) {
          used.add(similar);
          out[i] = updateGroup(similar, node);
          continue;
        }
        out[i] = createGroup(node);
      } else {
        out[i] = createShape(node);
      }
    }
    for (const record of previous) {
      if (used.has(record)) continue;
      record.el.remove();
      disposeNode(record);
    }
    const records = out as NodeRecord[];
    place(parent, records.map((record) => record.el));
    return records;
  }

  // --- anteprima degli strumenti -------------------------------------------------

  let draft: PainterDraft | null = null;
  /// Le immagini coperte da un ricalco, che si mostrano con l'anteprima.
  let covers: ReadonlyMap<PaintNode, Elem> | null = null;
  /// Le immagini che si ritagliano.
  let crops: ReadonlyMap<PaintNode, CropCover> | null = null;
  /// I nodi che mostrano l'anteprima, da riportare alla scena.
  let drafted: NodeRecord[] = [];
  /// I `path` e i gruppi che l'anteprima mostra al posto delle forme.
  let standIns: Element[] = [];
  /// Le risorse a cui l'anteprima ha cambiato il `d`, con quello di prima.
  let retraced: Array<readonly [Element, string | null]> = [];
  /// I pezzi di un testo col loro colore a cui l'anteprima ha dato quello
  /// del testo, con l'attributo.
  let repainted: Array<readonly [Element, "fill" | "stroke"]> = [];
  /// La `defs` delle sfumature e dei ritagli dell'anteprima, finché ne
  /// mostra.
  let draftDefs: SVGSVGElement | null = null;
  let draftIds = 0;

  /// Mette `elem` nella `defs` dell'anteprima, con un id nuovo; `null` se
  /// non è una risorsa che il painter dipinge.
  const draftResource = (elem: Elem): SVGElement | null => {
    const el = defElement(paintDefOf(elem), null, dom);
    return el === null ? null : draftDef(el);
  };

  /// Mette la risorsa `el` nella `defs` dell'anteprima, con un id nuovo.
  const draftDef = (el: SVGElement): SVGElement => {
    el.setAttribute("id", `${prefix}draft-${++draftIds}`);
    if (draftDefs === null) {
      draftDefs = document.createElementNS(SVG, "svg");
      draftDefs.setAttribute("class", "spatial-layer spatial-defs");
      draftDefs.append(document.createElementNS(SVG, "defs"));
      root.append(draftDefs);
    }
    draftDefs.firstElementChild!.append(el);
    return el;
  };
  /// I nodi del DOM per nodo della scena, e quelli dei gruppi per
  /// contenitore: ricostruiti solo quando servono.
  let byPaint: { readonly paints: Map<PaintNode, NodeRecord[]>; readonly keys: Map<object, NodeRecord[]> } | null = null;

  const indexRecords = (): NonNullable<typeof byPaint> => {
    if (byPaint !== null) return byPaint;
    const index = { paints: new Map<PaintNode, NodeRecord[]>(), keys: new Map<object, NodeRecord[]>() };
    const add = (record: NodeRecord): void => {
      push(index.paints, record.paint, record);
      if (record.paint.kind === "group") push(index.keys, record.paint.key, record);
      for (const child of record.children) add(child);
    };
    for (const layer of layers) if (layer.kind === "live") for (const record of layer.children) add(record);
    // Il contenuto dei simboli: un'anteprima lì si vede in ogni istanza.
    for (const record of defs?.symbolRecords ?? []) add(record);
    byPaint = index;
    return index;
  };

  /// I nodi del DOM di `paint`. Un gruppo si ritrova anche dal suo
  /// contenitore: un figlio cambiato da un'altra superficie fa un gruppo
  /// nuovo, e l'anteprima non deve sparire a metà di un trascinamento.
  const recordsOf = (paint: PaintNode): readonly NodeRecord[] => {
    const index = indexRecords();
    const same = index.paints.get(paint);
    if (same !== undefined) return same;
    return paint.kind === "group" ? index.keys.get(paint.key) ?? [] : [];
  };

  /// Riporta un nodo a ciò che la sua scena dipinge, attenuato se sta fuori
  /// dal gruppo isolato.
  const restore = (record: NodeRecord): void => {
    for (const name of DRAFTED) {
      const painted = record.paint.attrs.find(([key]) => key === name);
      if (painted === undefined) record.el.removeAttribute(name);
      else if (record.el.getAttribute(name) !== painted[1]) record.el.setAttribute(name, painted[1]);
    }
    const dim = dimmed.get(record.el);
    if (dim === undefined) record.el.style.removeProperty("opacity");
    else record.el.style.setProperty("opacity", dim);
    record.el.style.removeProperty("visibility");
    record.el.style.removeProperty("stroke");
    record.el.style.removeProperty("fill");
  };

  /// Gli strati immagine che l'anteprima sposta, e quelli che sbiadisce.
  let carriedImages: ImageRecord[] = [];
  let fadedImages: ImageRecord[] = [];
  /// Gli strati immagine che un'anteprima appena tolta spostava: restano
  /// dove sono finché non si sa se la scena cambia. Se la scena nuova li
  /// ridisegna, l'immagine vecchia resta spostata finché la nuova non è
  /// pronta, così niente torna indietro per un attimo; altrimenti tornano al
  /// loro posto subito dopo.
  const frozen = new Set<ImageRecord>();
  let releasing = false;

  /// Mostra lo strato `record` spostato di `matrix`, anche l'immagine in
  /// decodifica.
  const carry = (record: ImageRecord, matrix: Matrix | null): void => {
    record.carried = matrix;
    if (record.pending !== null) record.pending.carried = matrix;
    if (record.shown !== null) {
      record.shown.carried = matrix;
      position(record.shown);
    }
  };

  const releaseFrozen = (): void => {
    releasing = false;
    if (disposed) return;
    for (const record of frozen) carry(record, null);
    frozen.clear();
  };

  const clearDraft = (): void => {
    for (const record of drafted) {
      restore(record);
      copiesOf.delete(record.el);
    }
    drafted = [];
    for (const stand of standIns) stand.remove();
    standIns = [];
    for (const [el, d] of retraced) {
      if (d === null) el.removeAttribute("d");
      else el.setAttribute("d", d);
    }
    retraced = [];
    for (const [el, name] of repainted) (el as SVGElement).style.removeProperty(name);
    repainted = [];
    draftDefs?.remove();
    draftDefs = null;
    for (const record of carriedImages) {
      record.carried = null;
      frozen.add(record);
    }
    carriedImages = [];
    if (frozen.size > 0 && !releasing) {
      releasing = true;
      queueMicrotask(releaseFrozen);
    }
    for (const record of fadedImages) {
      const dim = dimmed.get(record.el);
      if (dim === undefined) record.el.style.removeProperty("opacity");
      else record.el.style.setProperty("opacity", dim);
    }
    fadedImages = [];
  };

  const applyDraft = (): void => {
    if (draft === null && covers === null && crops === null) return;
    const touched = new Set<NodeRecord>();
    for (const [paint, transform] of draft?.transforms ?? []) {
      for (const record of recordsOf(paint)) {
        if (transform === null) record.el.removeAttribute("transform");
        else record.el.setAttribute("transform", transform);
        touched.add(record);
      }
    }
    for (const [paint, d] of draft?.paths ?? []) {
      for (const record of recordsOf(paint)) {
        touched.add(record);
        if (record.el.localName === "path") {
          record.el.setAttribute("d", d);
          continue;
        }
        const stand = record.el.ownerDocument.createElementNS(SVG, "path");
        for (const { name, value } of [...record.el.attributes]) if (name !== "id" && !name.startsWith("data-") && !SHAPE_GEOMETRY.has(name)) stand.setAttribute(name, value);
        stand.setAttribute("d", d);
        record.el.after(stand);
        record.el.style.setProperty("visibility", "hidden");
        standIns.push(stand);
      }
    }
    for (const [paint, radii] of draft?.radii ?? []) {
      for (const record of recordsOf(paint)) {
        for (const name of ["rx", "ry"]) {
          const value = radii[name];
          if (value === undefined) continue;
          if (value === null) record.el.removeAttribute(name);
          else record.el.setAttribute(name, value);
        }
        touched.add(record);
      }
    }
    for (const [paint, attrs] of draft?.strokes ?? []) {
      for (const record of recordsOf(paint)) {
        touched.add(record);
        const stand = record.el.ownerDocument.createElementNS(SVG, "path");
        for (const { name, value } of [...record.el.attributes]) {
          if (name !== "id" && !name.startsWith("data-") && !SHAPE_GEOMETRY.has(name) && !PAINTING.test(name)) stand.setAttribute(name, value);
        }
        // La pittura nello stile in linea, che vale più dei fogli di stile
        // del disegno.
        for (const [name, value] of Object.entries(attrs)) {
          if (name === "d") stand.setAttribute(name, value);
          else stand.style.setProperty(name, value);
        }
        stand.style.setProperty("stroke", "none");
        record.el.style.setProperty("stroke", "none");
        record.el.after(stand);
        standIns.push(stand);
      }
    }
    for (const paint of draft?.faded ?? []) {
      for (const record of recordsOf(paint)) {
        record.el.style.setProperty("opacity", FADED_OPACITY);
        touched.add(record);
      }
    }
    for (const paint of draft?.hidden ?? []) {
      for (const record of recordsOf(paint)) {
        record.el.style.setProperty("visibility", "hidden");
        touched.add(record);
      }
    }
    for (const [paint, channels] of draft?.paints ?? []) {
      const records = recordsOf(paint);
      if (records.length === 0) continue;
      for (const name of ["fill", "stroke"] as const) {
        const value = channels[name];
        if (value === undefined) continue;
        const shown = typeof value === "string" ? value : draftResource(value)?.id;
        if (shown === undefined) continue;
        const css = typeof value === "string" ? shown : `url(#${shown})`;
        for (const record of records) {
          record.el.style.setProperty(name, css);
          touched.add(record);
          // I pezzi di un testo col loro colore prendono quello del testo,
          // come quando il cambio si scrive.
          if (record.el.localName !== "text") continue;
          for (const piece of record.el.querySelectorAll<SVGElement>(`[${name}]`)) {
            piece.style.setProperty(name, css);
            repainted.push([piece, name]);
          }
        }
      }
    }
    for (const [paint, elem] of [...(covers ?? []), ...(draft?.replaced ?? [])]) {
      for (const record of recordsOf(paint)) {
        const stand = drawn(record.el.ownerDocument, elem, dom);
        const transform = record.el.getAttribute("transform");
        if (transform === null) stand.removeAttribute("transform");
        else stand.setAttribute("transform", transform);
        record.el.after(stand);
        record.el.style.setProperty("visibility", "hidden");
        standIns.push(stand);
        touched.add(record);
      }
    }
    for (const [paint, crop] of crops ?? []) {
      for (const record of recordsOf(paint)) {
        if (record.el.localName !== "image") continue;
        const [whole, kept] = croppedStands(record.el, crop);
        record.el.after(whole, kept);
        record.el.style.setProperty("visibility", "hidden");
        standIns.push(whole, kept);
        touched.add(record);
      }
    }
    drafted = [...touched];
    if (draft === null) return;
    for (const [id, d] of draft.tracks ?? []) {
      const resource = defs?.resources.find((each) => each.id === id);
      const el = resource === undefined ? undefined : defs!.nodes.get(resource);
      if (el?.localName !== "path") continue;
      retraced.push([el, el.getAttribute("d")]);
      el.setAttribute("d", d);
    }
    const { carried, fadedContainers } = draft;
    if (carried === undefined && fadedContainers === undefined) return;
    for (const record of layers) {
      if (record.kind !== "image") continue;
      const containers = record.layer.containers;
      const key = carried === undefined ? undefined : containers.find((container) => carried.has(container));
      if (key !== undefined) {
        frozen.delete(record);
        carry(record, carried!.get(key)!);
        carriedImages.push(record);
      }
      if (fadedContainers !== undefined && containers.some((container) => fadedContainers.has(container))) {
        record.el.style.setProperty("opacity", FADED_OPACITY);
        fadedImages.push(record);
      }
    }
  };

  const setDraft = (next: PainterDraft | null): void => {
    if (disposed) return;
    clearDraft();
    draft = next;
    applyDraft();
  };

  const setCovers = (next: ReadonlyMap<PaintNode, Elem> | null): void => {
    if (disposed) return;
    clearDraft();
    covers = next;
    applyDraft();
  };

  /// L'immagine `el` come la mostra il ritaglio `crop`: una copia intera,
  /// in un gruppo attenuato, e una copia ritagliata sopra, con un
  /// `clipPath` nella `defs` dell'anteprima. Le copie hanno l'URL che
  /// l'immagine mostra già, e nessun id della scena; se l'URL arriva dopo,
  /// lo prendono quando arriva.
  const croppedStands = (el: SVGElement, crop: CropCover): readonly [Element, Element] => {
    const { box, rect } = crop;
    const copies = new Set<Element>();
    copiesOf.set(el, copies);
    const copy = (): SVGElement => {
      const image = el.cloneNode(false) as SVGElement;
      copies.add(image);
      image.removeAttribute("data-scene-id");
      image.removeAttribute("clip-path");
      image.removeAttribute("mask");
      image.style.removeProperty("visibility");
      image.setAttribute("x", String(box.min[0]));
      image.setAttribute("y", String(box.min[1]));
      image.setAttribute("width", String(box.max[0] - box.min[0]));
      image.setAttribute("height", String(box.max[1] - box.min[1]));
      return image;
    };
    const whole = document.createElementNS(SVG, "g");
    whole.style.setProperty("opacity", CROPPED_OPACITY);
    whole.append(copy());
    const kept = copy();
    const clip = document.createElementNS(SVG, "clipPath");
    const shape = document.createElementNS(SVG, "rect");
    shape.setAttribute("x", String(rect.min[0]));
    shape.setAttribute("y", String(rect.min[1]));
    shape.setAttribute("width", String(rect.max[0] - rect.min[0]));
    shape.setAttribute("height", String(rect.max[1] - rect.min[1]));
    clip.append(shape);
    draftDef(clip);
    kept.setAttribute("clip-path", `url(#${clip.id})`);
    return [whole, kept];
  };

  const setCrops = (next: ReadonlyMap<PaintNode, CropCover> | null): void => {
    if (disposed) return;
    clearDraft();
    crops = next;
    applyDraft();
  };

  // --- isolamento ---------------------------------------------------------------

  let focus: readonly object[] | null = null;
  /// Gli elementi attenuati, con l'opacità che mostrano.
  const dimmed = new Map<HTMLElement | SVGElement, string>();

  /// Attenua `el`, che dipinge l'opacità `painted`: CSS vince
  /// sull'attributo, quindi il fattore si moltiplica qui.
  const dim = (el: HTMLElement | SVGElement, painted: string | undefined): void => {
    const value = String(Math.round(opacityOf(painted) * DIMMED_OPACITY * 1000) / 1000);
    el.style.setProperty("opacity", value);
    dimmed.set(el, value);
  };

  const clearFocus = (): void => {
    for (const el of dimmed.keys()) el.style.removeProperty("opacity");
    dimmed.clear();
  };

  const applyFocus = (): void => {
    const chain = focus;
    if (chain === null) return;
    const visit = (records: readonly NodeRecord[], depth: number): void => {
      for (const record of records) {
        const paint = record.paint;
        if (paint.kind === "group" && paint.key === chain[depth]) {
          if (depth + 1 < chain.length) visit(record.children, depth + 1);
        } else if (paint === chain[depth] && depth === chain.length - 1) {
          // L'istanza da cui si modifica il simbolo isolato.
        } else if (paint.role !== "paper") {
          dim(record.el, paint.attrs.find(([name]) => name === "opacity")?.[1]);
        }
      }
    };
    for (const layer of layers) {
      if (layer.kind === "live") visit(layer.children, 0);
      else if (!inside(layer.layer.containers, chain)) dim(layer.el, undefined);
    }
  };

  const setFocus = (chain: readonly object[] | null): void => {
    if (disposed) return;
    clearFocus();
    focus = chain === null || chain.length === 0 ? null : [...chain];
    applyFocus();
  };

  // --- strati vivi ------------------------------------------------------------

  const cameraTransform = (): string => viewTransform(view);

  const createLive = (layer: LiveLayer, rootAttrs: readonly PaintAttr[]): LiveRecord => {
    const el = document.createElementNS(SVG, "svg");
    el.setAttribute("class", "spatial-layer");
    const camera = document.createElementNS(SVG, "g");
    camera.setAttribute("transform", cameraTransform());
    setPainted(camera, rootAttrs, [], dom);
    setRootFamily(camera, rootAttrs, dom);
    el.append(camera);
    const record: LiveRecord = { kind: "live", layer, el, camera, rootAttrs, children: [] };
    record.children = reconcile(camera, [], layer.nodes);
    return record;
  };

  const updateLive = (record: LiveRecord, layer: LiveLayer, rootAttrs: readonly PaintAttr[]): void => {
    if (rootAttrs !== record.rootAttrs) {
      // Il trasforma della camera non è fra gli attributi della radice.
      setPainted(record.camera, rootAttrs, record.rootAttrs, dom);
      setRootFamily(record.camera, rootAttrs, dom);
      record.rootAttrs = rootAttrs;
    }
    if (layer === record.layer) return;
    record.children = reconcile(record.camera, record.children, layer.nodes);
    record.layer = layer;
  };

  const disposeLive = (record: LiveRecord): void => {
    for (const child of record.children) disposeNode(child);
  };

  const disposeDefs = (record: DefsRecord): void => {
    record.el.remove();
    for (const child of record.symbolRecords) disposeNode(child);
  };

  // --- risorse ---------------------------------------------------------------

  /// Porta la `defs` viva a `resources` e a `symbols`: una risorsa che
  /// resta è lo stesso nodo, una nuova o cambiata si crea, e i simboli si
  /// riconciliano come uno strato vivo. Senza risorse né simboli la `defs`
  /// esce.
  const updateDefs = (resources: readonly PaintResource[], symbols: readonly PaintGroup[], rootAttrs: readonly PaintAttr[]): void => {
    if (resources.length === 0 && symbols.length === 0) {
      if (defs !== null) disposeDefs(defs);
      defs = null;
      return;
    }
    if (defs === null) {
      const el = document.createElementNS(SVG, "svg");
      el.setAttribute("class", "spatial-layer spatial-defs");
      const element = document.createElementNS(SVG, "defs");
      const symbolDefs = document.createElementNS(SVG, "defs");
      el.append(element, symbolDefs);
      defs = { el, defs: element, resources: [], nodes: new Map(), rootAttrs: [], symbolDefs, symbols: [], symbolRecords: [] };
      setRootFamily(element, [], dom);
    }
    if (symbols !== defs.symbols) {
      defs.symbolRecords = reconcile(defs.symbolDefs, defs.symbolRecords, symbols);
      defs.symbols = symbols;
    }
    if (rootAttrs !== defs.rootAttrs) {
      setPainted(defs.defs, rootAttrs, defs.rootAttrs, dom);
      setRootFamily(defs.defs, rootAttrs, dom);
      defs.rootAttrs = rootAttrs;
    }
    if (resources === defs.resources) return;
    const kept = new Set(resources);
    // Prima escono le risorse che non ci sono più: l'id di una che cambia
    // passa alla nuova, e non deve trovare la vecchia.
    for (const [resource, el] of defs.nodes) if (!kept.has(resource)) el.remove();
    const nodes = new Map<PaintResource, SVGElement>();
    for (const resource of resources) {
      const el = defs.nodes.get(resource) ?? nodes.get(resource) ?? resourceElement(resource, dom);
      if (el !== null) nodes.set(resource, el);
    }
    place(defs.defs, [...nodes.values()]);
    defs.nodes = nodes;
    defs.resources = resources;
  };

  // --- strati immagine ----------------------------------------------------------

  /// Il rettangolo che un'immagine copre per la vista corrente.
  const frameNow = (): { frame: ImageFrame; left: number; top: number } | null => {
    if (width <= 0 || height <= 0 || !(view.scale > 0)) return null;
    const left = -Math.round(width * MARGIN);
    const top = -Math.round(height * MARGIN);
    const pixelWidth = width - 2 * left;
    const pixelHeight = height - 2 * top;
    if (view.angle !== 0) {
      // Girata, l'immagine copre lo stesso rettangolo dello schermo, e il
      // suo angolo in alto a sinistra è un punto della scena.
      const [x, y] = toScene(view, [left, top]);
      const frame = { x, y, width: pixelWidth / view.scale, height: pixelHeight / view.scale, pixelWidth, pixelHeight, angle: view.angle };
      return { left, top, frame };
    }
    return {
      left,
      top,
      frame: {
        x: (left - view.tx) / view.scale,
        y: (top - view.ty) / view.scale,
        width: pixelWidth / view.scale,
        height: pixelHeight / view.scale,
        pixelWidth,
        pixelHeight,
      },
    };
  };

  /// Vero se l'immagine mostrata va ridisegnata per la vista corrente: la
  /// scala è cambiata, o la vista ha consumato più di metà del margine.
  const stale = (record: ImageRecord): boolean => {
    const shown = record.pending ?? record.shown;
    if (shown === null) return true;
    if (shown.view.scale !== view.scale || shown.view.angle !== view.angle) return true;
    const dx = view.tx - shown.view.tx;
    const dy = view.ty - shown.view.ty;
    const slackX = -shown.left / 2;
    const slackY = -shown.top / 2;
    return Math.abs(dx) > slackX || Math.abs(dy) > slackY
      || shown.frame.pixelWidth !== width - 2 * shown.left || shown.frame.pixelHeight !== height - 2 * shown.top;
  };

  /// Mette `rendered` dove sta per la vista corrente: la sua posizione per
  /// la vista con cui è stata disegnata, portata a quella di adesso, e
  /// spostata come la scena se l'anteprima la sposta.
  const position = (rendered: Rendered): void => {
    if (view.angle !== 0 || rendered.view.angle !== 0) {
      turned(rendered);
      return;
    }
    const k = view.scale / rendered.view.scale;
    const m = rendered.carried;
    if (m === null) {
      const x = rendered.left * k + view.tx - rendered.view.tx * k;
      const y = rendered.top * k + view.ty - rendered.view.ty * k;
      rendered.img.style.transform = k === 1 ? `translate(${x}px, ${y}px)` : `matrix(${k}, 0, 0, ${k}, ${x}, ${y})`;
      return;
    }
    // Il pixel `p` dell'immagine mostra il punto (p + left - t₀) / s₀ della
    // scena, che va in `m` e poi sullo schermo con la vista di adesso.
    const [a, b, c, d, e, f] = m;
    const u = rendered.left - rendered.view.tx;
    const v = rendered.top - rendered.view.ty;
    const x = k * (a * u + c * v) + view.scale * e + view.tx;
    const y = k * (b * u + d * v) + view.scale * f + view.ty;
    rendered.img.style.transform = `matrix(${k * a}, ${k * b}, ${k * c}, ${k * d}, ${x}, ${y})`;
  };

  /// `position` quando una delle due viste è girata: il pixel `p`
  /// dell'immagine è il punto `p + (left, top)` dello schermo della vista con
  /// cui è stata disegnata; da lì torna nella scena, segue lo spostamento
  /// dell'anteprima e va sullo schermo con la vista di adesso.
  const turned = (rendered: Rendered): void => {
    if (rendered.carried === null && rendered.view.scale === view.scale && rendered.view.angle === view.angle) {
      // Allo stesso angolo e alla stessa scala la vista si è solo spostata:
      // l'immagine resta sui pixel interi, senza il rumore dei conti.
      const x = rendered.left + view.tx - rendered.view.tx;
      const y = rendered.top + view.ty - rendered.view.ty;
      rendered.img.style.transform = `translate(${x}px, ${y}px)`;
      return;
    }
    const back = invert(viewMatrix(rendered.view));
    if (back === null) return;
    const shown = compose(back, [1, 0, 0, 1, rendered.left, rendered.top]);
    const moved = rendered.carried === null ? shown : compose(rendered.carried, shown);
    const [a, b, c, d, e, f] = compose(viewMatrix(view), moved);
    rendered.img.style.transform = `matrix(${a}, ${b}, ${c}, ${d}, ${e}, ${f})`;
  };

  const revoke = (rendered: Rendered | null): void => {
    if (rendered !== null) URL.revokeObjectURL(rendered.url);
  };

  /// Il foglio dei caratteri che lo strato di `record` nomina, se sono già
  /// letti. Altrimenti lo strato si disegna subito coi caratteri del sistema,
  /// e di nuovo quando arrivano, se nel frattempo non è cambiato.
  const fontsOf = (record: ImageRecord, generation: number): string => {
    const fonts = options.fonts;
    if (fonts === undefined) return "";
    const named = layerText(record.layer);
    const css = fonts.now(named);
    if (css !== null) return css;
    void fonts.load(named).then(() => {
      if (!disposed && record.generation === generation && fonts.now(named) !== null) render(record);
    });
    return "";
  };

  const render = (record: ImageRecord): void => {
    const target = frameNow();
    if (target === null) return;
    const generation = ++record.generation;
    revoke(record.pending);
    record.pending = null;
    const blob = new Blob([imageDocument(record.layer, target.frame, fontsOf(record, generation))], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);
    const img = document.createElement("img");
    img.className = "spatial-image";
    img.alt = "";
    img.setAttribute("aria-hidden", "true");
    img.decoding = "async";
    img.draggable = false;
    img.width = target.frame.pixelWidth;
    img.height = target.frame.pixelHeight;
    img.style.width = `${target.frame.pixelWidth}px`;
    img.style.height = `${target.frame.pixelHeight}px`;
    const rendered: Rendered = { img, url, frame: target.frame, view, left: target.left, top: target.top, carried: record.carried };
    record.pending = rendered;
    img.src = url;
    const swap = (): void => {
      if (disposed || record.generation !== generation || record.pending !== rendered) return;
      record.pending = null;
      position(rendered);
      record.el.replaceWith(img);
      revoke(record.shown);
      record.shown = rendered;
      swapped(record, img);
    };
    const failed = (): void => {
      if (disposed || record.generation !== generation || record.pending !== rendered) return;
      // Un documento che il browser non disegna: lo strato resta vuoto, e
      // l'immagine precedente non resta a mentire.
      record.pending = null;
      revoke(rendered);
      const empty = emptySlot();
      record.el.replaceWith(empty);
      revoke(record.shown);
      record.shown = null;
      swapped(record, empty);
    };
    if (typeof img.decode === "function") img.decode().then(swap, failed);
    else swap();
  };

  /// Mette `el` al posto dell'elemento di `record`, attenuato e sbiadito
  /// come lui.
  const swapped = (record: ImageRecord, el: HTMLElement): void => {
    const dim = dimmed.get(record.el);
    if (dim !== undefined) {
      dimmed.delete(record.el);
      el.style.setProperty("opacity", dim);
      dimmed.set(el, dim);
    }
    if (fadedImages.includes(record)) el.style.setProperty("opacity", FADED_OPACITY);
    record.el = el;
  };

  const emptySlot = (): HTMLElement => {
    const slot = document.createElement("span");
    slot.className = "spatial-image-slot";
    return slot;
  };

  const createImage = (layer: ImageLayer): ImageRecord => {
    const record: ImageRecord = { kind: "image", layer, el: emptySlot(), shown: null, pending: null, generation: 0, carried: null };
    render(record);
    return record;
  };

  const updateImage = (record: ImageRecord, layer: ImageLayer): void => {
    if (layer.key === record.layer.key) {
      record.layer = layer;
      return;
    }
    record.layer = layer;
    render(record);
  };

  const disposeImage = (record: ImageRecord): void => {
    record.generation++;
    revoke(record.pending);
    revoke(record.shown);
    record.pending = null;
    record.shown = null;
  };

  // --- strati -------------------------------------------------------------------

  const disposeLayer = (record: LayerRecord): void => {
    record.el.remove();
    if (record.kind === "live") disposeLive(record);
    else disposeImage(record);
  };

  const update = (scene: PaintScene): void => {
    if (disposed) return;
    // L'anteprima e l'attenuazione escono prima della riconciliazione, che
    // confronta il DOM con la scena di prima, e rientrano sui nodi nuovi.
    clearDraft();
    clearFocus();
    byPaint = null;
    const generations = new Map<ImageRecord, number>();
    for (const record of frozen) generations.set(record, record.generation);
    const rootAttrs = scene.root.attrs;
    updateDefs(scene.resources, scene.symbols, rootAttrs);
    const lives = layers.filter((r): r is LiveRecord => r.kind === "live");
    const images = layers.filter((r): r is ImageRecord => r.kind === "image");
    const used = new Set<LayerRecord>();
    // Prima le corrispondenze esatte: uno strato vivo identico, un'immagine
    // con la stessa chiave.
    const out: Array<LayerRecord | null> = scene.layers.map((layer) => {
      const match = layer.kind === "live"
        ? lives.find((r) => r.layer === layer && !used.has(r))
        : images.find((r) => r.layer.key === layer.key && !used.has(r));
      if (match !== undefined) used.add(match);
      return match ?? null;
    });
    // Poi, nell'ordine, gli strati dello stesso tipo che restano: un vivo si
    // riconcilia, un'immagine si ridisegna nel posto della vecchia.
    for (let i = 0; i < scene.layers.length; i++) {
      const layer = scene.layers[i]!;
      const current = out[i];
      if (current !== null && current !== undefined) {
        if (current.kind === "live" && layer.kind === "live") updateLive(current, layer, rootAttrs);
        else if (current.kind === "image" && layer.kind === "image") current.layer = layer;
        continue;
      }
      if (layer.kind === "live") {
        const reuse = lives.find((r) => !used.has(r));
        if (reuse !== undefined) {
          used.add(reuse);
          updateLive(reuse, layer, rootAttrs);
          out[i] = reuse;
        } else {
          out[i] = createLive(layer, rootAttrs);
        }
      } else {
        const reuse = images.find((r) => !used.has(r));
        if (reuse !== undefined) {
          used.add(reuse);
          updateImage(reuse, layer);
          out[i] = reuse;
        } else {
          out[i] = createImage(layer);
        }
      }
    }
    for (const record of layers) if (!used.has(record)) disposeLayer(record);
    layers = out as LayerRecord[];
    // Le risorse prima degli strati, come nel file.
    place(root, [...(defs === null ? [] : [defs.el]), ...layers.map((record) => record.el)]);
    applyFocus();
    applyDraft();
    // Uno strato che la scena ridisegna tiene spostata l'immagine vecchia
    // finché la nuova non la sostituisce; gli altri tornano al loro posto.
    for (const [record, generation] of generations) {
      if (frozen.delete(record) && record.generation === generation) carry(record, null);
    }
  };

  // --- vista ----------------------------------------------------------------------

  const settle = (): void => {
    clearSettle();
    if (disposed) return;
    for (const record of layers) if (record.kind === "image" && stale(record)) render(record);
  };

  const setView = (next: PainterView): void => {
    if (disposed) return;
    if (next.scale === view.scale && next.angle === view.angle && next.tx === view.tx && next.ty === view.ty) return;
    view = { scale: next.scale, angle: next.angle, tx: next.tx, ty: next.ty };
    const transform = cameraTransform();
    for (const record of layers) {
      if (record.kind === "live") record.camera.setAttribute("transform", transform);
      else if (record.shown !== null) position(record.shown);
    }
    clearSettle();
    settleTimer = setTimeout(settle, settleMs);
  };

  if (typeof ResizeObserver !== "undefined") {
    const resizeObserver = new ResizeObserver(() => {
      const nextWidth = host.clientWidth;
      const nextHeight = host.clientHeight;
      if (nextWidth === width && nextHeight === height) return;
      width = nextWidth;
      height = nextHeight;
      settle();
    });
    resizeObserver.observe(host);
    life.add(() => resizeObserver.disconnect());
  }

  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    draft = null;
    covers = null;
    crops = null;
    drafted = [];
    carriedImages = [];
    fadedImages = [];
    frozen.clear();
    focus = null;
    dimmed.clear();
    byPaint = null;
    for (const record of layers) disposeLayer(record);
    layers = [];
    if (defs !== null) disposeDefs(defs);
    defs = null;
    root.remove();
    life.close();
  };
  owner.add(dispose);

  return { update, setDraft, setFocus, setCovers, setCrops, setView, settle, dispose };
}

/// Vero se lo strato racchiuso da `containers` sta dentro l'ultimo dei
/// contenitori `chain`: `chain` comincia come `containers`.
function inside(containers: readonly object[], chain: readonly object[]): boolean {
  return chain.length <= containers.length && chain.every((key, i) => containers[i] === key);
}

/// L'opacità che un attributo `opacity` dipinge: un numero o una
/// percentuale, fra 0 e 1; 1 se manca o non si legge.
// --- forme -------------------------------------------------------------------

/// Gli attributi dipinti `attrs` su `el`, al posto di `previous`, coi
/// riferimenti alle risorse sugli id vivi di `dom` e le famiglie vive.
function setPainted(el: SVGElement, attrs: readonly PaintAttr[], previous: readonly PaintAttr[], dom: LiveDom): void {
  if (attrs === previous) return;
  const next = new Set<string>();
  for (const [name, value] of attrs) {
    // La scena porta solo nomi dipinti; il controllo resta qui perché è il
    // DOM a non doverne ricevere altri.
    if (!PAINTED_ATTRIBUTES.has(name)) continue;
    if (name === "style") {
      next.add(name);
      setBlend(el, value);
      continue;
    }
    if (name === "font-family") {
      next.add(name);
      setFamily(el, value, dom);
      continue;
    }
    const live = liveValue(dom.prefix, name, value);
    if (live === null) continue;
    next.add(name);
    if (el.getAttribute(name) !== live) el.setAttribute(name, live);
  }
  for (const [name] of previous) {
    if (next.has(name)) continue;
    if (name === "style") setBlend(el, null);
    else el.removeAttribute(name);
    if (name === "font-family") writtenFamilies.delete(el);
  }
}

/// La fusione e l'isolamento dello `style` del formato, `null` per nessuno,
/// come proprietà dello stile in linea di `el`: il painter vi mette anche
/// l'attenuazione e ciò che nasconde, e l'attributo intero li cancellerebbe.
function setBlend(el: SVGElement, value: string | null): void {
  const style = value === null ? null : blendStyle(value, true);
  const blend = style?.blend ?? null;
  const isolate = style?.isolate ?? null;
  if (blend === null) el.style.removeProperty("mix-blend-mode");
  else el.style.setProperty("mix-blend-mode", blend);
  if (isolate === null) el.style.removeProperty("isolation");
  else el.style.setProperty("isolation", isolate ? "isolate" : "auto");
}

/// L'id vivo del simbolo `id` su `el`, e il suo `overflow`: il formato lo
/// chiede, e il contenuto si vede anche fuori dal riquadro dell'istanza.
function setSymbol(el: SVGElement, id: string, dom: LiveDom): void {
  el.setAttribute("id", liveId(dom.prefix, id));
  el.setAttribute("overflow", "visible");
}

function setCommon(el: SVGElement, id: string | null, space: string | null): void {
  if (id === null) el.removeAttribute("data-scene-id");
  else el.setAttribute("data-scene-id", id);
  if (space === null) el.removeAttributeNS(XML, "space");
  else el.setAttributeNS(XML, "xml:space", space);
}

/// Le copie che l'anteprima di un ritaglio fa di un'immagine, per ogni
/// immagine: l'URL che arriva dopo, perché il vault lo risolve a parte, va
/// anche a loro.
const copiesOf = new WeakMap<Element, Set<Element>>();

/// Scrive l'URL di `el` e quello delle sue copie.
function setHref(el: Element, url: string): void {
  el.setAttribute("href", url);
  for (const copy of copiesOf.get(el) ?? []) copy.setAttribute("href", url);
}

function showVaultImage(el: SVGElement, path: string, resolve: PainterOptions["images"], imageLife: Lifetime): void {
  if (resolve === undefined) {
    el.setAttribute("href", IMAGE_PLACEHOLDER);
    return;
  }
  resolve(path, imageLife).then(
    (url) => {
      if (imageLife.closed) return;
      setHref(el, url ?? IMAGE_PLACEHOLDER);
    },
    () => {
      if (!imageLife.closed) setHref(el, IMAGE_PLACEHOLDER);
    },
  );
}

/// L'elemento di `shape`, con `id` in `data-scene-id`: le righe di un testo,
/// l'URL di un'immagine, i riferimenti alle risorse e le famiglie di `dom`.
/// Un'immagine del vault lo chiede a `resolve` nella vita `life`, o in una
/// sua se è `null`; la vita che torna è quella.
function shapeElement(
  shape: PaintShape,
  id: string | null,
  dom: LiveDom,
  resolve: PainterOptions["images"],
  life: Lifetime | null,
): { readonly el: SVGElement; readonly life: Lifetime | null } {
  const el = document.createElementNS(SVG, shape.tag);
  setPainted(el, shape.attrs, [], dom);
  setCommon(el, id, shape.space);
  let imageLife: Lifetime | null = null;
  if (shape.runs !== undefined) {
    for (const run of shape.runs) {
      if (run.kind === "space") {
        el.append(document.createTextNode(run.text));
        continue;
      }
      // Un tracciato rimanda alla sua risorsa viva, come un `url(#…)`.
      const span = document.createElementNS(SVG, run.kind === "path" ? "textPath" : "tspan");
      if (run.kind === "path") {
        span.setAttribute("href", `#${liveId(dom.prefix, run.href)}`);
        if (run.startOffset !== null) span.setAttribute("startOffset", run.startOffset);
      } else {
        setPainted(span, run.attrs, [], dom);
        if (run.space !== null) span.setAttributeNS(XML, "xml:space", run.space);
      }
      if (run.parts === undefined) span.textContent = run.text;
      for (const part of run.parts ?? []) {
        if (typeof part === "string") {
          span.append(document.createTextNode(part));
          continue;
        }
        const piece = document.createElementNS(SVG, "tspan");
        setPainted(piece, part.attrs, [], dom);
        if (part.space !== null) piece.setAttributeNS(XML, "xml:space", part.space);
        piece.textContent = part.text;
        span.append(piece);
      }
      el.append(span);
    }
  }
  // Un'istanza rimanda al simbolo vivo, come un `url(#…)`.
  if (shape.symbol !== undefined) el.setAttribute("href", `#${liveId(dom.prefix, shape.symbol)}`);
  const image = shape.image;
  if (image !== undefined) {
    if (image.kind === "data") {
      el.setAttribute("href", image.url);
    } else if (image.kind === "remote") {
      el.setAttribute("href", IMAGE_PLACEHOLDER);
    } else {
      imageLife = life ?? openLifetime();
      showVaultImage(el, image.path, resolve, imageLife);
    }
  }
  return { el, life: imageLife };
}

// --- risorse -------------------------------------------------------------------

/// L'elemento vivo di `def`, figlio di un elemento `parent` (`null` per una
/// risorsa nella `defs`), coi soli elementi e attributi del formato
/// ([`DEF_ATTRIBUTES`], [`DEF_CHILDREN`]), i riferimenti e le famiglie di
/// `dom`.
/// `null` se `def` lì non può stare. Gli id dei figli non entrano.
function defElement(def: PaintDef, parent: string | null, dom: LiveDom): SVGElement | null {
  const allowed = parent === null ? RESOURCE_TAGS : DEF_CHILDREN.get(parent);
  const names = DEF_ATTRIBUTES.get(def.tag);
  if (allowed?.has(def.tag) !== true || names === undefined) return null;
  const el = document.createElementNS(SVG, def.tag);
  for (const [name, value] of def.attrs) {
    if (!names.has(name)) continue;
    if (name === "font-family") {
      setFamily(el, value, dom);
      continue;
    }
    const live = liveValue(dom.prefix, name, value);
    if (live !== null) el.setAttribute(name, live);
  }
  if (def.space !== null) el.setAttributeNS(XML, "xml:space", def.space);
  const text = def.tag === "text" || def.tag === "tspan";
  for (const child of def.children) {
    if (typeof child === "string") {
      if (text) el.append(document.createTextNode(child));
      continue;
    }
    const node = defElement(child, def.tag, dom);
    if (node !== null) el.append(node);
  }
  return el;
}

/// `elem` come una risorsa viva da dipingere.
function paintDefOf(elem: Elem): PaintDef {
  return { tag: elem.tag, attrs: Object.entries(elem.attrs), space: null, children: (elem.children ?? []).map(paintDefOf) };
}

/// L'elemento vivo di `resource`, con l'id vivo sotto il prefisso di `dom`.
function resourceElement(resource: PaintResource, dom: LiveDom): SVGElement | null {
  const el = defElement(resource, null, dom);
  el?.setAttribute("id", liveId(dom.prefix, resource.id));
  return el;
}

// --- miniature ----------------------------------------------------------------

/// Gli attributi che nascondono: una miniatura mostra anche ciò che il
/// disegno nasconde.
const HIDING: ReadonlySet<string> = new Set(["display", "visibility"]);

/// Il riquadro che una miniatura inquadra, in unità della scena.
export interface MiniatureBox {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/// Il margine di una miniatura attorno al suo riquadro, in frazioni del lato
/// più lungo.
const MINIATURE_MARGIN = 0.06;

/// Una miniatura dei nodi `nodes`: un `svg` che inquadra `box`, con dentro un
/// `g` per ogni contenitore di `chain`, dal più esterno, che porta i suoi
/// attributi dipinti. Né i nodi né chi li contiene sono nascosti; ciò che è
/// nascosto dentro di loro sì. Nessun `data-scene-id`: la miniatura non è
/// la scena. Le immagini del vault le chiede a `resolve` nella vita `life`.
/// Le risorse `resources`, quelle che i nodi usano ([`resourcesFor`]),
/// stanno in una `defs` dentro il primo `g`, che porta gli attributi della
/// radice, con un prefisso della miniatura; con loro i simboli `symbols`,
/// quelli delle istanze ([`symbolsFor`]). Le famiglie vive sono quelle di
/// `family`: di partenza, le sole famiglie di Fub.
export function paintMiniature(
  nodes: readonly PaintNode[],
  chain: readonly (readonly PaintAttr[])[],
  box: MiniatureBox,
  life: Lifetime,
  resolve?: PainterOptions["images"],
  resources: readonly PaintResource[] = [],
  family: (value: string) => string = fubLiveFamily,
  symbols: readonly PaintGroup[] = [],
): SVGSVGElement {
  const visible = (attrs: readonly PaintAttr[]): readonly PaintAttr[] => attrs.filter(([name]) => !HIDING.has(name));
  const dom: LiveDom = { prefix: `fubthumb${++miniatures}-`, family };
  const svg = document.createElementNS(SVG, "svg");
  const pad = Math.max(box.width, box.height) * MINIATURE_MARGIN || 1;
  svg.setAttribute("viewBox", `${box.x - pad} ${box.y - pad} ${box.width + 2 * pad} ${box.height + 2 * pad}`);
  svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
  svg.setAttribute("focusable", "false");
  setFamily(svg, "", dom);
  let parent: SVGElement = svg;
  const defs = resources.length === 0 && symbols.length === 0 ? null : document.createElementNS(SVG, "defs");
  for (const resource of resources) {
    const el = resourceElement(resource, dom);
    if (el !== null) defs!.append(el);
  }
  for (const attrs of chain) {
    const g = document.createElementNS(SVG, "g");
    setPainted(g, visible(attrs), [], dom);
    parent.append(g);
    // Il contenuto delle risorse eredita dalla radice, non da chi le usa.
    if (parent === svg && defs !== null) g.append(defs);
    parent = g;
  }
  if (parent === svg && defs !== null) svg.append(defs);
  const copy = (node: PaintNode, top: boolean): SVGElement => {
    if (node.kind === "shape") {
      const { el } = shapeElement(node, null, dom, resolve, life);
      if (top) for (const name of HIDING) el.removeAttribute(name);
      return el;
    }
    const el = document.createElementNS(SVG, node.role === "symbol" ? "symbol" : "g");
    setPainted(el, top ? visible(node.attrs) : node.attrs, [], dom);
    setCommon(el, null, node.space);
    if (node.role === "symbol") setSymbol(el, node.id!, dom);
    for (const child of node.children) el.append(copy(child, false));
    return el;
  };
  for (const symbol of symbols) defs!.append(copy(symbol, false));
  for (const node of nodes) parent.append(copy(node, true));
  return svg;
}

/// La miniatura `svg` come immagine ferma: un `img` solo al posto di tante
/// forme vive. Le immagini del vault non ci sono, perché un'immagine non ne
/// carica altre. L'URL si revoca quando si chiude `life`.
export function miniaturePicture(svg: SVGSVGElement, life: Lifetime): HTMLImageElement {
  const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(svg)], { type: "image/svg+xml" }));
  life.add(() => URL.revokeObjectURL(url));
  const img = document.createElement("img");
  img.alt = "";
  img.decoding = "async";
  img.src = url;
  return img;
}

/// Quante forme ha `nodes`, contando fino a `limit`: oltre, `limit + 1`.
export function shapeCount(nodes: readonly PaintNode[], limit: number): number {
  let count = 0;
  const visit = (list: readonly PaintNode[]): void => {
    for (const node of list) {
      if (count > limit) return;
      if (node.kind === "shape") count++;
      else visit(node.children);
    }
  };
  visit(nodes);
  return Math.min(count, limit + 1);
}

function opacityOf(value: string | undefined): number {
  if (value === undefined) return 1;
  const text = value.trim();
  const number = text.endsWith("%") ? Number(text.slice(0, -1)) / 100 : Number(text);
  return text === "" || text === "%" || !Number.isFinite(number) ? 1 : Math.min(1, Math.max(0, number));
}

function push<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const list = map.get(key);
  if (list === undefined) map.set(key, [value]);
  else list.push(value);
}

/// Mette i figli di `parent` nell'ordine di `children`, spostando solo
/// quelli fuori posto. `children` contiene tutti i figli che restano.
function place(parent: Element, children: readonly Element[]): void {
  let cursor = parent.firstChild;
  for (const child of children) {
    if (child === cursor) {
      cursor = cursor.nextSibling;
      continue;
    }
    parent.insertBefore(child, cursor);
  }
}
