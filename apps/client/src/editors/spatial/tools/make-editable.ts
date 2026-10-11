// «Rendi modificabile»: le parti estranee di un disegno diventano oggetti del
// formato, se si può senza che cambi niente di ciò che si vede. È un comando
// esplicito dell'Esperto, su un blocco, sugli oggetti scelti o su tutto il
// disegno; fuori dal comando niente si normalizza.
//
// - **Che cosa traduce:** l'attributo `style` in attributi di presentazione;
//   le regole dei fogli `<style>` che scelgono un elemento, coi valori che vi
//   danno; i colori di CSS (`rgb()`, `hsl()`, `hwb()`, `transparent`,
//   `currentColor`, le forme con la trasparenza) in `#rrggbb` con l'opacità a
//   parte; le misure relative (`em`, `rem`, le percentuali della finestra) in
//   numeri; `data-name` e `aria-label` nel titolo, che è il nome
//   dell'oggetto; le righe di un testo scritte con la `y`, come le scrivono
//   Inkscape e Illustrator, in righe con il `dy`, e il testo fuori dalle
//   righe in una riga. Gli attributi che non disegnano niente e che il formato non
//   ammette, come `data-*` e `class`, se ne vanno.
// - **Le risorse vanno al loro posto:** una sfumatura che rimanda con `href`
//   a un'altra, come le scrive Inkscape, prende gli attributi e gli `stop`
//   che ne ereditava, coi valori calcolati; quella a cui rimandava se ne va,
//   se nessun altro la usa e non è un campione. Una risorsa fuori dalla
//   `defs` delle risorse, come le scrive Illustrator alla radice o dentro un
//   livello, va in fondo a quella `defs`; se nessuna `defs` ha un id, la
//   prima prende quello di FubDraw, e se non ce n'è nessuna se ne crea una
//   dopo il titolo. Un oggetto che la usa e resta com'era si toglie e si
//   rimette dopo di lei, perché la trovi.
// - **Un `svg` annidato diventa un gruppo, tutto insieme:** la sua finestra
//   (posizione, misura, `viewBox` e `preserveAspectRatio`) diventa la
//   matrice del gruppo, e un tratto in percentuale che arriva da fuori vi si
//   scrive in numeri. Se ciò che contiene può uscire dalla finestra, il
//   gruppo prende un ritaglio privato grande come la finestra, nella `defs`
//   delle risorse; con `overflow: visible` niente ritaglio. Un `svg` con una
//   trasformazione sua, che i browser non disegnano tutti allo stesso modo,
//   o con un ritaglio, una maschera o un filtro che sul gruppo non darebbero
//   lo stesso disegno, resta com'era. Le risorse nella sua `defs`, come le
//   scrive Figma, vanno nella `defs` delle risorse, e la `defs` rimasta
//   vuota se ne va.
// - **Un `use` diventa un'istanza di un simbolo, coi suoi compagni:** un
//   `symbol` estraneo della `defs`, come quelli di Illustrator e delle
//   raccolte di icone, diventa un simbolo del formato col suo id e col nome
//   nel titolo; la finestra di ogni `use` (posizione, misura, `viewBox`)
//   diventa la matrice dell'istanza, e se il contenuto può uscirne l'istanza
//   prende un ritaglio privato. Una forma, un testo o un gruppo che dei `use`
//   clonano, come i cloni di Inkscape, va in un simbolo nuovo col suo nome,
//   anche se è già modificabile, e al suo posto resta un'istanza. Il
//   contenuto porta ciò che dichiara; un valore che riceve uguale in ogni
//   posto in cui si vede, come il colore di `currentColor`, vi si scrive.
//   Si prova in ogni posto: se un `use` dà qualcosa che un'istanza non
//   porta, o altro rimanda al disegno, il disegno e i suoi `use` restano
//   com'erano. Le copie di una ripetizione non si toccano.
// - **Come lo vede un browser, prima e dopo:** lo stile di prima si calcola
//   con la cascata di CSS e tutti i fogli (`cascade.ts`). Dopo, un elemento
//   reso modificabile si guarda due volte: coi fogli che restano, come lo
//   vedono un browser e l'esportazione, e senza, come lo disegna la
//   superficie, che sugli oggetti vivi non applica fogli e dalla radice
//   prende solo alcuni attributi. Con dei fogli si riguarda anche ogni altro
//   elemento, perché un foglio sceglie anche per posizione. Il confronto è
//   quello di `editable-look.ts`, con le equivalenze di resa.
// - **Le unità sono atomiche:** un'unità estranea diventa modificabile, con
//   i figli che possono se è un gruppo, oppure resta byte per byte, col
//   perché. Un figlio di un gruppo che non può resta estraneo dentro il
//   gruppo diventato modificabile, com'era.
// - **I fogli si puliscono:** una regola che dopo non sceglie più niente se
//   ne va, se prima sceglieva qualcosa o se il comando è su tutto il
//   disegno; un foglio vuoto se ne va con la `defs` che lo conteneva, se
//   resta vuota. Una regola che sceglierebbe ancora un elemento reso
//   modificabile lo lascia estraneo, perché vincerebbe sugli attributi che
//   vi si cambiano. Le regole dentro una condizione, come `@media`, restano,
//   e un elemento il cui stile dipende da loro resta estraneo.
// - **Alla fine si prova:** le operazioni si applicano a un motore di prova;
//   il testo che ne esce si riclassifica e si riconfronta. Ciò che non torna
//   resta estraneo, e si riprova senza. Le operazioni sono un passo solo
//   d'annulla: ogni unità si toglie e si rimette riscritta nel punto esatto
//   da cui è partita, con gli spazi attorno com'erano. Un documento non
//   ancora adottato si adotta nello stesso passo.

import { lineText, resourceFault, resourceIndex, resourceKind, svgAttribute, tagOf, type Resolve, type ResourceTag, type Tag } from "../scene/classify";
import { reindent, SceneEngine } from "../scene/engine";
import { createId, DEFS_ID, type RandomBytes } from "../scene/ids";
import { transform as svgTransform, paint as formatPaint, hrefId, reference, urlIds } from "../scene/values";
import { BoundsBuilder } from "../scene/geometry";
import { apply, compose, IDENTITY, type Matrix } from "../scene/matrix";
import { elementChildren, lastBreak, rawOf, scopeOf, tagName, type ContainerNode, type DocumentModel, type ElementPart } from "../scene/model";
import { ROOT, type Op, type RestoreOp, type Target } from "../scene/ops";
import { canonicalOrder, escapeAttribute, escapeText, formatTransform, type OutAttr } from "../scene/serialize";
import { SourceText } from "../scene/text";
import {
  FUB_NS, isSpace, NS_NONE, NS_SVG, NS_XLINK, parseXml, SVG_NS, XLINK_NS, XML_URI, type Attr, type ElementNode, type NodeId, type XmlDocument,
} from "../scene/xml";
import { formatNumber } from "../number";
import { Cascade, INHERITED, inherits, longhands, plainValue, PRESENTATION, readOpacity, renders, same, type CascadeNode, type Context, type Value, type Window as SvgWindow } from "./cascade";
import { Matcher, readDeclarations, readSheet, readSheets, type Rule, type Sheet, type StyleAttr } from "./selectors";
import { formatHex } from "./css-color";
import { resourceHome } from "./resources";
import { BLANK_LINE } from "./text";
import { cleanName, nameKey } from "./naming";
import { documentSymbols, freeSymbolName } from "./symbols";
import { ambiguousSpace, difference, lengthOf, paintOf, segmentsOf, shapeFacts, type Difference, type ShapeFacts } from "./editable-look";

/// Su che cosa lavora il comando: tutto il disegno, o le unità estranee che
/// stanno ai percorsi dati (gli indici dei figli elemento dalla radice), o
/// che li contengono.
export type EditableScope = { readonly kind: "all" } | { readonly kind: "units"; readonly paths: readonly (readonly number[])[] };

/// Le traduzioni che il comando conta, per dirle.
export type Translation = "style" | "sheet" | "color" | "unit" | "data" | "text" | "resource" | "svg" | "use";

/// Perché una parte resta estranea.
export type Reason =
  /// Un elemento che il formato non ha, come `switch` o `foreignObject`.
  | { readonly kind: "element"; readonly tag: string }
  /// Un `use` che non è un'istanza di un simbolo.
  | { readonly kind: "use" }
  /// Un elemento che il formato non ammette dove sta, come una sfumatura
  /// fuori dalla `defs` della radice.
  | { readonly kind: "place"; readonly tag: string }
  /// Un attributo che il formato non ammette e che non si può togliere.
  | { readonly kind: "attribute"; readonly name: string }
  /// Un attributo che il formato vuole e che manca, come una coordinata di
  /// una sfumatura in `userSpaceOnUse`, che SVG prende dalla finestra.
  | { readonly kind: "missing"; readonly name: string }
  /// Un valore di stile che il formato non sa scrivere.
  | { readonly kind: "property"; readonly name: string; readonly value: string }
  /// Uno stile che dipende da dove si guarda il disegno, come `@media`.
  | { readonly kind: "condition"; readonly text: string }
  /// Uno stile da un selettore che non si sa leggere, come `:hover`.
  | { readonly kind: "selector"; readonly text: string }
  /// Una regola che resta e sceglierebbe ancora la parte.
  | { readonly kind: "shared"; readonly text: string }
  /// Un foglio che sceglie per posizione: cambierebbe l'aspetto di un vicino.
  | { readonly kind: "structure" }
  /// Un foglio importato, che qui non si legge.
  | { readonly kind: "import" }
  /// Una misura relativa che non si sa calcolare, come `ex`.
  | { readonly kind: "unit"; readonly value: string }
  /// Un rimando a una risorsa che il formato non conosce.
  | { readonly kind: "resource"; readonly id: string }
  /// Un `use` mostra la parte anche altrove.
  | { readonly kind: "copy" }
  /// La parte è legata a un'altra che resta: un simbolo e i `use` che lo
  /// mostrano, o un disegno e i suoi cloni, diventano modificabili tutti
  /// insieme. `id` è quello del simbolo o del disegno.
  | { readonly kind: "linked"; readonly id: string }
  /// La parte sta in un livello o in un gruppo bloccato.
  | { readonly kind: "locked" }
  /// Un testo con righe che il formato non ha.
  | { readonly kind: "text" }
  /// Un figlio che il formato non ammette lì.
  | { readonly kind: "child"; readonly tag: string }
  | { readonly kind: "unknown" };

/// Una parte che resta estranea: dove sta dopo il comando, il tag, il nome
/// se ne ha uno, e il perché.
export interface Leftover {
  readonly path: readonly number[];
  readonly tag: string;
  readonly name: string | null;
  readonly reason: Reason;
}

/// Ciò che il comando farebbe.
export interface EditablePlan {
  /// Le operazioni, da applicare in un `batch`: vuote se non c'è niente da
  /// fare.
  readonly ops: readonly Op[];
  /// Quante unità estranee diventano modificabili.
  readonly converted: number;
  /// Quanti elementi hanno avuto ogni traduzione.
  readonly translations: ReadonlyMap<Translation, number>;
  /// Ciò che resta estraneo e si vede, col perché.
  readonly leftovers: readonly Leftover[];
  /// Quante regole dei fogli se ne vanno.
  readonly rules: number;
  /// Quanti fogli se ne vanno.
  readonly sheets: number;
  /// Quante parti estranee non si vedono e restano come sono: metadati,
  /// impostazioni di altri programmi, fogli.
  readonly invisible: number;
  /// Il testo di dopo; `null` se non c'è niente da fare.
  readonly after: string | null;
}

const XHTML_NS = "http://www.w3.org/1999/xhtml";

/// Gli elementi SVG estranei che da soli non disegnano niente: restano come
/// sono e non si contano fra ciò che resta.
const INVISIBLE: ReadonlySet<string> = new Set(["metadata", "script", "style", "title", "desc", "defs", "view", "symbol"]);

/// Gli attributi che non disegnano niente e che il formato non ammette.
const JUNK: ReadonlySet<string> = new Set([
  "focusable", "enable-background", "version", "baseProfile", "tabindex", "role", "contentScriptType", "contentStyleType",
  "zoomAndPan", "externalResourcesRequired",
]);

/// Gli attributi che decidono se l'elemento si disegna: restano, e
/// l'elemento con loro.
const CONDITIONAL: ReadonlySet<string> = new Set(["systemLanguage", "requiredFeatures", "requiredExtensions", "requiredFonts", "requiredFormats"]);

/// Gli attributi che possono rimandare a una risorsa.
const REFERENCES: ReadonlySet<string> = new Set(["fill", "stroke", "marker-start", "marker-mid", "marker-end", "clip-path", "mask", "filter"]);

/// Le risorse del formato.
const RESOURCES: ReadonlySet<string> = new Set(["linearGradient", "radialGradient", "pattern", "marker", "clipPath", "mask", "filter"]);

/// La geometria che può essere una misura relativa, e su quali tag.
const GEOMETRY: ReadonlyMap<string, ReadonlySet<string>> = new Map([
  ["x", new Set(["rect", "image", "text", "tspan"])],
  ["y", new Set(["rect", "image", "text"])],
  ["dy", new Set(["tspan"])],
  ["width", new Set(["rect", "image"])],
  ["height", new Set(["rect", "image"])],
  ["cx", new Set(["circle", "ellipse"])],
  ["cy", new Set(["circle", "ellipse"])],
  ["r", new Set(["circle"])],
  ["rx", new Set(["rect", "ellipse"])],
  ["ry", new Set(["rect", "ellipse"])],
  ["x1", new Set(["line"])],
  ["y1", new Set(["line"])],
  ["x2", new Set(["line"])],
  ["y2", new Set(["line"])],
]);

/// Gli attributi che una sfumatura prende da quella a cui rimanda con
/// `href`, se non li ha: questi da ogni sfumatura…
const GRADIENT_SHARED: readonly string[] = ["gradientUnits", "gradientTransform", "spreadMethod"];

/// …e questi soltanto da una dello stesso tipo.
const GRADIENT_OWN: Readonly<Record<string, readonly string[]>> = {
  linearGradient: ["x1", "y1", "x2", "y2"],
  radialGradient: ["cx", "cy", "r", "fx", "fy", "fr"],
};

const INKSCAPE_NS = "http://www.inkscape.org/namespaces/inkscape";

/// I contenitori del formato: i figli di uno che lo diventa si classificano
/// uno per uno.
const CONTAINERS: ReadonlySet<string> = new Set(["g", "a"]);

/// Le proprietà ereditate che un gruppo può portare ai figli.
const GROUP_INHERITED: readonly string[] = [
  "fill", "stroke", "stroke-width", "stroke-linecap", "stroke-linejoin", "stroke-dasharray", "font-family", "font-size", "font-weight",
  "font-style", "text-anchor", "letter-spacing",
];

/// Gli attributi della radice che la superficie porta sugli oggetti vivi, se
/// varrebbero su un `g`: gli stessi del pittore.
export const LIVE_ROOT: readonly string[] = [
  "fill", "fill-opacity", "stroke", "stroke-width", "stroke-opacity", "stroke-linecap", "stroke-linejoin", "stroke-dasharray", "opacity",
  "font-family", "font-size", "font-weight", "text-anchor",
];

/// I servizi di caratteri: i soli fogli importati che non toccano lo stile
/// degli elementi.
const FONT_SERVICES = /^(?:https?:)?\/\/(?:fonts\.googleapis\.com|fonts\.bunny\.net|use\.typekit\.net|fonts\.cdnfonts\.com|api\.fontshare\.com)\//i;

/// Ciò che un `use` può clonare per diventare un'istanza di un simbolo
/// nuovo.
const CLONEABLE: ReadonlySet<string> = new Set(["g", "path", "rect", "circle", "ellipse", "line", "polyline", "polygon", "text", "image"]);

/// Gli attributi di un `use` che restano sull'istanza; gli altri se ne
/// vanno.
const INSTANCE_KEPT: ReadonlySet<string> = new Set(["id", "href", "transform", "opacity", "display", "style", "clip-path", "mask", "filter"]);

/// Le proprietà di un `use` che valgono per lui: ogni altra o la riceve il
/// contenuto del simbolo, e si prova in ogni posto, o non disegna niente.
const INSTANCE_OWN: ReadonlySet<string> = new Set(["display", "opacity", "clip-path", "mask", "filter", "mix-blend-mode", "isolation"]);

/// Le proprietà che dipingono con un colore, anche quello di `currentColor`.
const PAINTS: ReadonlySet<string> = new Set(["fill", "stroke", "stop-color", "flood-color", "lighting-color"]);

/// Il contesto con cui si scrive il contenuto di un simbolo: per alcune
/// proprietà ereditate un valore che nessun disegno usa, così che ciò che il
/// contenuto dichiara da sé si veda diverso e si scriva, e ciò che eredita
/// resti ereditato. Le altre prendono il valore iniziale.
const PROBE: Readonly<Record<string, string>> = {
  color: "#010203",
  fill: "#0a0b0c",
  "fill-opacity": "0.37",
  stroke: "#101112",
  "stroke-opacity": "0.43",
  "stroke-width": "1.37",
  "stroke-linecap": "square",
  "stroke-linejoin": "bevel",
  "stroke-dashoffset": "0.9",
  "font-family": "fub-probe",
  "font-size": "13.7px",
  "font-style": "italic",
  "font-weight": "300",
  "letter-spacing": "0.7px",
  "text-anchor": "middle",
};

/// Per le proprietà che hanno pochi valori, quelli che può prendere la
/// sonda, in ordine: il primo che il contenuto non dichiara.
const PROBE_CHOICES: Readonly<Record<string, readonly string[]>> = {
  "stroke-linecap": ["square", "round", "butt"],
  "stroke-linejoin": ["bevel", "round", "miter"],
  "font-style": ["italic", "oblique", "normal"],
  "font-weight": ["300", "100", "900", "500"],
  "text-anchor": ["middle", "end", "start"],
};

const PROBES = new Map<string, Value | null>();

/// Il valore di PROBE per `p`; `null` se non ne ha uno.
const probe: Context = (p) => {
  let out = PROBES.get(p);
  if (out === undefined) {
    const text = PROBE[p];
    out = text === undefined ? null : plainValue(p, text);
    PROBES.set(p, out);
  }
  return out;
};

/// Quante volte si riprova al più, togliendo ogni volta ciò che non torna.
const MAX_ROUNDS = 48;

/// Le cifre dei numeri calcolati.
const PLACES = 4;

const num = (n: number): string => formatNumber(n, PLACES);

const NO_SHEET: Sheet = { rules: [], selectors: [], deep: false, imports: [] };

// ---------------------------------------------------------------------------
// L'albero.
// ---------------------------------------------------------------------------

/// Un elemento come lo vedono la cascata e i selettori.
class El implements CascadeNode {
  parent: El | null = null;
  children: El[] = [];
  /// Il pezzo del modello di cui è la cima: un contenitore o un'unità.
  part: ElementPart | null = null;
  /// L'unità che lo contiene, lui compreso; `null` in un contenitore.
  unit: El | null = null;
  /// Vero se sta in un'unità estranea.
  foreign = false;
  /// L'elemento di prima da cui viene; `null` per uno nuovo.
  origin: El | null = null;

  constructor(
    readonly uri: string,
    /// Il nome, locale e com'è scritto: cambiano soltanto quando un `svg`
    /// dentro il disegno diventa un gruppo.
    public local: string,
    public name: string,
    public attrs: StyleAttr[],
    readonly text: boolean,
    /// L'elemento letto; `null` per uno nuovo.
    readonly element: ElementNode | null,
    /// Il foglio, per un `style` che ne porta uno.
    readonly sheet: string | null,
    readonly serial: number,
  ) {}

  attr(local: string): string | null {
    return this.attrs.find((attr) => attr.uri === "" && attr.local === local)?.value ?? null;
  }

  /// Scrive l'attributo `local` senza namespace, al suo posto se c'è già;
  /// `null` lo toglie.
  set(local: string, value: string | null): void {
    const at = this.attrs.findIndex((attr) => attr.uri === "" && attr.local === local);
    if (value === null) {
      if (at >= 0) this.attrs.splice(at, 1);
    } else if (at >= 0) this.attrs[at] = { uri: "", local, value };
    else this.attrs.push({ uri: "", local, value });
  }

  /// Vero se è l'elemento SVG `local`.
  is(local: string): boolean {
    return this.uri === SVG_NS && this.local === local;
  }
}

/// Gli attributi di `element` come li vedono i selettori, senza le
/// dichiarazioni di namespace.
function styleAttrs(element: ElementNode): Attr[] {
  return element.attrs.filter((attr) => attr.name !== "xmlns" && !attr.name.startsWith("xmlns:"));
}

/// L'albero degli elementi di `doc`.
function treeOf(doc: XmlDocument, serial: () => number): El {
  const build = (element: ElementNode): El => {
    const uri = doc.namespaces[element.ns]!;
    const attrs = styleAttrs(element).map((attr) => ({ uri: doc.namespaces[attr.ns]!, local: attr.local, value: attr.value }));
    let text = false;
    let css = "";
    for (const child of element.children) {
      const node = doc.nodes[child]!;
      if (node.kind === "text" || node.kind === "cdata") {
        text = true;
        css += node.value;
      } else if (node.kind === "entity-ref") {
        text = true;
        css += doc.plainEntity(node.name) ?? "";
      }
    }
    const type = attrs.find((attr) => attr.uri === "" && attr.local === "type")?.value.trim().toLowerCase() ?? "";
    const sheet = element.local === "style" && (uri === SVG_NS || uri === XHTML_NS) && (type === "" || type === "text/css") ? css : null;
    return new El(uri, element.local, element.name, attrs, text, element, sheet, serial());
  };
  const top = doc.element(doc.root)!;
  const root = build(top);
  const stack: Array<[ElementNode, El]> = [[top, root]];
  while (stack.length > 0) {
    const [element, node] = stack.pop()!;
    for (const child of element.children) {
      const inner = doc.element(child);
      if (inner === null) continue;
      const built = build(inner);
      built.parent = node;
      node.children.push(built);
      stack.push([inner, built]);
    }
  }
  return root;
}

/// Gli elementi di `root` in ordine di documento, lui compreso.
function walk(root: El): El[] {
  const out: El[] = [];
  const stack = [root];
  while (stack.length > 0) {
    const node = stack.pop()!;
    out.push(node);
    for (let k = node.children.length - 1; k >= 0; k--) stack.push(node.children[k]!);
  }
  return out;
}

/// Lega gli elementi di `root` ai pezzi di `model`; falso se non si
/// corrispondono.
function annotate(root: El, model: DocumentModel): boolean {
  const stack: Array<[ElementPart, El]> = [[model.root, root]];
  while (stack.length > 0) {
    const [part, node] = stack.pop()!;
    if (part.facts.local !== node.local || part.facts.uri !== node.uri) return false;
    node.part = part;
    if (part.kind === "container") {
      const children = elementChildren(part);
      if (children.length !== node.children.length) return false;
      children.forEach((child, at) => stack.push([child, node.children[at]!]));
    } else {
      for (const inner of walk(node)) {
        inner.unit = node;
        inner.foreign = part.details === null;
      }
    }
  }
  return true;
}

/// Una copia di `root`: ogni elemento ricorda `origin(originale)`.
function cloneTree(root: El, serial: () => number, origin: (node: El) => El | null): [El, Map<El, El>] {
  const copies = new Map<El, El>();
  const copy = (node: El, parent: El | null): El => {
    const made = new El(node.uri, node.local, node.name, [...node.attrs], node.text, node.element, node.sheet, serial());
    made.parent = parent;
    made.part = node.part;
    made.foreign = node.foreign;
    made.origin = origin(node);
    copies.set(node, made);
    return made;
  };
  const top = copy(root, null);
  const stack: Array<[El, El]> = [[root, top]];
  while (stack.length > 0) {
    const [from, to] = stack.pop()!;
    for (const child of from.children) {
      const made = copy(child, to);
      to.children.push(made);
      stack.push([child, made]);
    }
  }
  for (const [node, made] of copies) made.unit = node.unit === null ? null : copies.get(node.unit)!;
  return [top, copies];
}

/// L'albero di `root` come lo vede la superficie: dalla radice soltanto gli
/// attributi che il pittore porta sugli oggetti vivi.
function liveTree(root: El, serial: () => number, origin: (node: El) => El | null): [El, Map<El, El>] {
  const [live, of] = cloneTree(root, serial, origin);
  live.attrs = live.attrs.filter((attr) => attr.uri === "" && LIVE_ROOT.includes(attr.local) && svgAttribute("g", attr.local, attr.value));
  return [live, of];
}

/// Il percorso di `node`: gli indici dei figli elemento dalla radice.
function pathOf(node: El): number[] {
  const out: number[] = [];
  for (let at: El = node; at.parent !== null; at = at.parent) out.push(at.parent.children.indexOf(at));
  return out.reverse();
}

/// Il prefisso del nome di `node`, con i due punti: vuoto senza prefisso.
function prefixOf(node: El): string {
  return node.name.slice(0, node.name.length - node.local.length);
}

/// Vero se `node` è una sfumatura.
function isGradient(node: El): boolean {
  return node.is("linearGradient") || node.is("radialGradient");
}

/// Vero se `node` sta in una `defs` della radice che il formato legge.
function inRootDefs(node: El): boolean {
  const parent = node.parent;
  return parent !== null && parent.is("defs") && parent.parent !== null && parent.parent.parent === null && parent.part?.kind === "container";
}

/// L'`href` di `node`: quello senza namespace, se c'è, come lo legge SVG 2.
function hrefOf(node: El): StyleAttr | null {
  return node.attrs.find((attr) => attr.uri === "" && attr.local === "href") ?? node.attrs.find((attr) => attr.uri === XLINK_NS && attr.local === "href") ?? null;
}

/// Gli id a cui rimanda `node` coi suoi attributi, come li conta il motore:
/// ogni `url(#id)`, e l'`href` locale di un elemento SVG che non è un
/// collegamento.
function refsOf(node: El): string[] {
  const out: string[] = [];
  for (const attr of node.attrs) {
    if (attr.uri !== "" && attr.uri !== XLINK_NS) continue;
    if (attr.local !== "href") out.push(...urlIds(attr.value));
    else if (node.uri === SVG_NS && node.local !== "a") {
      const id = hrefId(attr.value);
      if (id !== null) out.push(id);
    }
  }
  return out;
}

/// Il rientro della riga su cui comincia ciò che sta in `at` di `text`, se
/// la comincia; `null` se prima, sulla stessa riga, c'è altro.
function lineIndent(text: string, at: number): string | null {
  let k = at;
  while (k > 0 && (text[k - 1] === " " || text[k - 1] === "\t")) k--;
  return k === 0 || text[k - 1] === "\n" || text[k - 1] === "\r" ? text.slice(k, at) : null;
}

/// Vero se `node` è un elemento che da solo non disegna niente.
function invisible(node: El): boolean {
  return node.uri !== SVG_NS || INVISIBLE.has(node.local);
}

/// Vero se `inner` sta dentro `outer`, o è lui.
function within(inner: El, outer: El): boolean {
  for (let at: El | null = inner; at !== null; at = at.parent) if (at === outer) return true;
  return false;
}

/// Le proprietà dichiarate negli attributi `style` di un albero.
function inlineSet(root: El): Set<string> {
  const out = new Set<string>();
  for (const node of walk(root)) {
    const style = node.attr("style");
    if (style === null) continue;
    for (const declaration of readDeclarations(style)) for (const p of longhands(declaration.property)) out.add(p);
  }
  return out;
}

/// Vero se `style` dichiara qualcosa.
function declares(style: string | null): boolean {
  return style !== null && readDeclarations(style).length > 0;
}

/// I nomi degli attributi senza namespace di un albero.
function attributeNames(root: El): Set<string> {
  const out = new Set<string>();
  for (const node of walk(root)) for (const attr of node.attrs) if (attr.uri === "") out.add(attr.local);
  return out;
}

/// Il nome di `node` per dirlo: il titolo, poi i nomi degli altri
/// programmi, poi l'id.
function nameOf(doc: XmlDocument, node: El): string | null {
  const title = node.children.find((child) => child.is("title"));
  if (title?.element !== null && title?.element !== undefined) {
    const text = characterDataOf(doc, title.element);
    if (text !== null) return text;
  }
  for (const [uri, local] of [["", "data-name"], ["", "aria-label"], ["http://www.inkscape.org/namespaces/inkscape", "label"], ["", "id"]]) {
    const value = node.attrs.find((attr) => attr.uri === uri && attr.local === local)?.value.trim();
    if (value !== undefined && value !== "") return value;
  }
  return null;
}

/// Il testo di un elemento, se ha soltanto testo.
function characterDataOf(doc: XmlDocument, element: ElementNode): string | null {
  let out = "";
  for (const child of element.children) {
    const node = doc.nodes[child]!;
    if (node.kind !== "text") return null;
    out += node.value;
  }
  const text = out.trim().replace(/\s+/g, " ");
  return text === "" ? null : text;
}

// ---------------------------------------------------------------------------
// I fogli.
// ---------------------------------------------------------------------------

/// Una frase di primo livello di un foglio, una regola o una at-rule, coi
/// suoi limiti nel testo del foglio e le regole lette che ne vengono.
interface Statement {
  readonly start: number;
  readonly end: number;
  readonly at: boolean;
  readonly rules: readonly Rule[];
}

/// Un foglio del disegno.
interface SheetOf {
  readonly el: El;
  readonly id: string;
  readonly css: string;
  /// Le frasi, se si sanno separare e corrispondono alle regole lette.
  readonly statements: readonly Statement[] | null;
  /// Dove sta il testo del foglio nel documento, per riscriverlo: per ogni
  /// indice del foglio, e per la fine, quello nel documento. `null` se non
  /// si sa riscrivere (entità, più pezzi).
  readonly raw: readonly number[] | null;
}

/// Le frasi di primo livello di `css`, coi loro limiti; `null` se non si
/// leggono.
function statementsOf(css: string): Array<{ start: number; end: number; at: boolean }> | null {
  const out: Array<{ start: number; end: number; at: boolean }> = [];
  const n = css.length;
  let i = 0;
  const comment = (): boolean => {
    if (css[i] !== "/" || css[i + 1] !== "*") return false;
    const end = css.indexOf("*/", i + 2);
    i = end < 0 ? n : end + 2;
    return true;
  };
  while (i < n) {
    if (/\s/.test(css[i]!)) i++;
    else if (comment()) continue;
    else if (css.startsWith("<!--", i)) i += 4;
    else if (css.startsWith("-->", i)) i += 3;
    else {
      const start = i;
      const at = css[i] === "@";
      let depth = 0;
      let done = false;
      while (i < n && !done) {
        if (comment()) continue;
        const c = css[i]!;
        if (c === '"' || c === "'") {
          i++;
          while (i < n && css[i] !== c) {
            if (css[i] === "\n") return null;
            i += css[i] === "\\" ? 2 : 1;
          }
          i++;
          continue;
        }
        if (c === "\\") {
          i += 2;
          continue;
        }
        if (c === "{") depth++;
        else if (c === "}") {
          depth--;
          if (depth < 0) return null;
          if (depth === 0) done = true;
        } else if (c === ";" && depth === 0 && at) done = true;
        i++;
      }
      if (depth !== 0) return null;
      out.push({ start, end: Math.min(i, n), at });
    }
  }
  return out;
}

/// Gli indici nel documento di ogni carattere di `value`, il testo letto di
/// un nodo il cui testo grezzo comincia in `start`: uguali salvo i
/// terminatori di riga, che il lettore riduce a `\n`. `null` se non si
/// corrispondono.
function rawMap(source: string, start: number, end: number, value: string): number[] | null {
  const map: number[] = [];
  let r = start;
  for (let v = 0; v < value.length; v++) {
    if (source[r] === "\r") {
      if (value[v] !== "\n") return null;
      map.push(r);
      r += source[r + 1] === "\n" ? 2 : 1;
      continue;
    }
    if (source[r] !== value[v]) return null;
    map.push(r++);
  }
  if (r !== end) return null;
  map.push(r);
  return map;
}

/// I fogli di `root`, letti insieme come li legge un browser.
function readAllSheets(doc: XmlDocument, root: El): { sheets: SheetOf[]; sheet: Sheet } {
  const els = walk(root).filter((node) => node.sheet !== null);
  const sheet = readSheets(els.map((el, at) => ({ id: String(at), css: el.sheet! })));
  const source = doc.source.text;
  const sheets = els.map((el, at): SheetOf => {
    const id = String(at);
    const css = el.sheet!;
    const own = sheet.rules.filter((rule) => rule.id.startsWith(`${id}:`));
    const found = statementsOf(css);
    let statements: Statement[] | null = null;
    if (found !== null) {
      statements = [];
      let next = 0;
      for (const each of found) {
        const count = readSheet(css.slice(each.start, each.end)).rules.length;
        statements.push({ ...each, rules: own.slice(next, next + count) });
        next += count;
      }
      if (next !== own.length || statements.some((statement) => !statement.at && statement.rules.length === 0)) statements = null;
    }
    // Il testo si riscrive se è un pezzo solo, testo o CDATA, senza entità.
    let raw: number[] | null = null;
    const children = el.element!.children.map((child) => doc.nodes[child]!);
    if (children.length === 1) {
      const node = children[0]!;
      if (node.kind === "text") raw = rawMap(source, node.start, node.end, node.value);
      else if (node.kind === "cdata") raw = rawMap(source, node.start + 9, node.end - 3, node.value);
    }
    return { el, id, css, statements, raw };
  });
  return { sheets, sheet };
}

/// Vero se le regole di `a` e di `b` sono le stesse, nello stesso ordine.
function sameRules(a: readonly Rule[], b: readonly Rule[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((rule, at) => {
    const other = b[at]!;
    return rule.text === other.text && rule.condition === other.condition && rule.at === other.at && rule.layer === other.layer
      && rule.specificity === other.specificity && JSON.stringify(rule.declarations) === JSON.stringify(other.declarations);
  });
}

/// `css` senza le frasi `statements`.
function removeRanges(css: string, statements: readonly Statement[]): string {
  let out = "";
  let at = 0;
  for (const statement of [...statements].sort((a, b) => a.start - b.start)) {
    out += css.slice(at, statement.start);
    at = statement.end;
  }
  return out + css.slice(at);
}

/// Vero se `css` non ha più niente oltre a spazi e commenti.
function blankCss(css: string): boolean {
  return css.replace(/\/\*[\s\S]*?(?:\*\/|$)/g, "").replace(/<!--|-->/g, "").trim() === "";
}

// ---------------------------------------------------------------------------
// Il testo.
// ---------------------------------------------------------------------------

/// Una modifica del testo: da dove a dove, e che cosa ci va.
type Edit = readonly [from: number, to: number, text: string];

/// `text` fra `start` e `end` con le modifiche `edits`.
function applyEdits(text: string, start: number, end: number, edits: readonly Edit[]): string | null {
  const sorted = [...edits].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let out = "";
  let at = start;
  for (const [from, to, inserted] of sorted) {
    if (from < at || to > end) return null;
    out += text.slice(at, from) + inserted;
    at = to;
  }
  return out + text.slice(at, end);
}

/// Dove sta un attributo nel tag: dallo spazio che lo precede alla
/// virgoletta che lo chiude, e dove comincia il nome.
function attributeSpan(text: string, attr: Attr): { readonly from: number; readonly name: number; readonly to: number } {
  // Dalla virgoletta d'apertura indietro: spazi, `=`, spazi, il nome.
  let at = attr.raw[0] - 2;
  while (isSpace(text.charCodeAt(at))) at--;
  at--;
  while (isSpace(text.charCodeAt(at))) at--;
  const name = at - attr.name.length + 1;
  let from = name;
  while (isSpace(text.charCodeAt(from - 1))) from--;
  return { from, name, to: attr.raw[1] + 1 };
}

/// `value` fra virgolette `quote`.
function escapeIn(value: string, quote: string): string {
  const escaped = escapeAttribute(value);
  return quote === '"' ? escaped : escaped.replace(/&quot;/g, '"').replace(/'/g, "&apos;");
}

/// Le modifiche che tolgono le frasi `drop` dal foglio `sheet`: una frase
/// che sta da sola sulle sue righe se ne va con le righe.
function withoutStatements(sheet: SheetOf, drop: readonly Statement[]): Edit[] {
  const css = sheet.css;
  const raw = sheet.raw!;
  const edits: Edit[] = [];
  for (const statement of drop) {
    let from = statement.start;
    let to = statement.end;
    let lineStart = from;
    while (lineStart > 0 && (css[lineStart - 1] === " " || css[lineStart - 1] === "\t")) lineStart--;
    let lineEnd = to;
    while (lineEnd < css.length && (css[lineEnd] === " " || css[lineEnd] === "\t")) lineEnd++;
    if ((lineStart === 0 || css[lineStart - 1] === "\n") && (lineEnd === css.length || css[lineEnd] === "\n")) {
      from = lineStart;
      to = lineEnd < css.length ? lineEnd + 1 : lineEnd;
    } else to = lineEnd;
    edits.push([raw[from]!, raw[to]!, ""]);
  }
  return edits;
}

// ---------------------------------------------------------------------------
// Il perché.
// ---------------------------------------------------------------------------

/// Perché `element`, una parte di dopo in `place`, è estranea: il primo
/// attributo o figlio che il formato non ammette, come lo giudica il
/// classificatore.
function explain(doc: XmlDocument, element: ElementNode, place: "root" | "defs" | "inside", resolve: Resolve): Reason {
  const tag = tagOf(element);
  if (tag === null) return { kind: "element", tag: element.name };
  if (tag === "use") return { kind: "use" };
  if (tag === "tspan" || tag === "textPath" || tag === "view" || tag === "defs" || tag === "symbol") return { kind: "place", tag };
  if (RESOURCES.has(tag)) return place === "defs" ? resourceFault(doc, element, tag as ResourceTag, resolve) ?? { kind: "unknown" } : { kind: "place", tag };
  if (place === "defs" && tag !== "title" && tag !== "desc" && tag !== "path" && tag !== "text" && tag !== "polyline") return { kind: "place", tag };
  for (const attr of element.attrs) {
    if (attr.ns === NS_SVG) return { kind: "attribute", name: attr.name };
    if (attr.ns === NS_XLINK) {
      if (attr.local === "href" && (tag === "a" || tag === "image") && svgAttribute(tag, "href", attr.value)) continue;
      return { kind: "attribute", name: attr.name };
    }
    if (attr.ns !== NS_NONE) continue;
    const local = attr.local;
    const url = /url\(/i.test(attr.value);
    if ((REFERENCES.has(local) || !url) && svgAttribute(tag, local, attr.value, resolve)) continue;
    const id = REFERENCES.has(local) ? referenceIn(attr.value) : null;
    if (id !== null && resolve(id) === null) return { kind: "resource", id };
    return PRESENTATION.has(local) ? { kind: "property", name: local, value: attr.value } : { kind: "attribute", name: local };
  }
  if (tag === "title" || tag === "desc") return { kind: "child", tag: firstChildName(doc, element) };
  if (CONTAINERS.has(tag)) return { kind: "unknown" };
  for (const child of element.children) {
    const node = doc.nodes[child]!;
    if (node.kind === "text" && node.blank) continue;
    if (node.kind === "text" || node.kind === "cdata" || node.kind === "entity-ref") return tag === "text" ? { kind: "text" } : { kind: "child", tag: "#text" };
    if (node.kind !== "element") return { kind: "child", tag: node.kind === "comment" ? "#comment" : `#${node.kind}` };
    const inner = tagOf(node);
    if (tag === "text" && (inner === "tspan" || inner === "textPath")) return { kind: "text" };
    if (inner === "title" || inner === "desc") {
      if (characterDataOf(doc, node) === null && node.children.length > 0) return { kind: "child", tag: node.name };
      continue;
    }
    return { kind: "child", tag: node.name };
  }
  return tag === "text" ? { kind: "text" } : { kind: "unknown" };
}

/// Il nome del primo figlio di `element` che non è testo.
function firstChildName(doc: XmlDocument, element: ElementNode): string {
  for (const child of element.children) {
    const node = doc.nodes[child]!;
    if (node.kind === "element") return node.name;
    if (node.kind !== "text") return node.kind === "comment" ? "#comment" : `#${node.kind}`;
  }
  return "#text";
}

/// L'id di un `url(#id)` dentro `value`, anche col colore di riserva.
function referenceIn(value: string): string | null {
  const match = /url\(\s*(["']?)#([^"')]+)\1\s*\)/i.exec(value);
  return match === null ? null : match[2]!.trim();
}

/// Il perché di una differenza.
function reasonOf(found: Difference): Reason {
  if (found.doubt !== null) return found.doubt.kind === "condition" ? { kind: "condition", text: found.doubt.text } : { kind: "selector", text: found.doubt.text };
  return { kind: "property", name: found.property, value: found.value.split("|")[0]! };
}

/// Vero se una dichiarazione di `rule` può cambiare come si vede `node`: una
/// proprietà che vi si disegna, o che eredita chi sta dentro. Senza
/// `custom`, le proprietà personalizzate (`--nome`) non contano: da sole non
/// disegnano niente.
function relevant(rule: Rule, node: El, custom = true): boolean {
  return rule.declarations.some((declaration) => (custom || !declaration.property.startsWith("--")) && longhands(declaration.property).some((p) => renders(node, p) || (inherits(p) && node.children.length > 0)));
}

/// I nomi delle proprietà personalizzate che `text` usa con `var()`.
function variablesIn(text: string, into: Set<string>): void {
  for (const match of text.matchAll(/var\(\s*(--[^\s,)]+)/g)) into.add(match[1]!);
}

/// Le operazioni di `op`, coi `batch` sciolti.
function flatten(op: Op): Op[] {
  return op.op === "batch" ? op.ops.flatMap(flatten) : [op];
}

// ---------------------------------------------------------------------------
// Il piano.
// ---------------------------------------------------------------------------

/// Un tentativo che non è andato: ciò che si toglie per il prossimo.
class Retry {
  constructor(
    readonly excluded: ReadonlyMap<El, Reason>,
    readonly keepSheets: boolean,
  ) {}
}

/// Ciò che produce un tentativo riuscito.
interface Outcome {
  readonly ops: Op[];
  readonly after: string;
  readonly converted: number;
  readonly translations: ReadonlyMap<Translation, ReadonlySet<El>>;
  readonly rules: number;
  readonly sheets: number;
  /// Le unità che se ne vanno.
  readonly dropped: ReadonlySet<El>;
  /// Ogni elemento di prima nell'albero di dopo.
  readonly yOf: ReadonlyMap<El, El>;
}

/// Un disegno che dei `use` mostrano altrove, coi `use`: diventano un
/// simbolo del formato e le sue istanze tutti insieme, o restano come sono.
interface Cluster {
  /// Il bersaglio: un `symbol` estraneo, o la forma, il gruppo, il testo o
  /// l'immagine che i `use` clonano.
  readonly target: El;
  /// `symbol` per un simbolo che resta al suo posto; `clone` per ciò che va
  /// in un simbolo nuovo e lascia al suo posto un'istanza.
  readonly kind: "symbol" | "clone";
  /// I `use` che lo mostrano, in ordine di documento.
  readonly uses: readonly El[];
}

/// Il simbolo nuovo di un clone nel tentativo in corso: l'id, il nome, il
/// simbolo e l'istanza che prende il posto del bersaglio nell'albero di
/// dopo.
interface Made {
  readonly cluster: Cluster;
  readonly id: string;
  readonly name: string | null;
  readonly symbol: El;
  readonly instance: El;
}

/// Il piano di «Rendi modificabile» per il documento `text` su `scope`; gli
/// id delle risorse nuove vengono da `random`.
export function planEditable(text: string, scope: EditableScope, random?: RandomBytes): EditablePlan {
  return new Planner(text, scope, random).plan();
}

const EMPTY: EditablePlan = { ops: [], converted: 0, translations: new Map(), leftovers: [], rules: 0, sheets: 0, invisible: 0, after: null };

class Planner {
  private serials = 0;
  readonly serial = (): number => this.serials++;
  readonly doc: XmlDocument;
  private readonly engine: SceneEngine;
  root!: El;
  /// Gli elementi di prima in ordine di documento, e il loro posto.
  private all: El[] = [];
  private order = new Map<El, number>();
  private sheets: SheetOf[] = [];
  private sheetB!: Sheet;
  B!: Cascade;
  inlineB = new Set<string>();
  /// Le proprietà da confrontare oltre a quelle che il confronto guarda
  /// sempre: quelle dichiarate e i nomi degli attributi.
  props = new Set<string>();
  resolve: Resolve = () => null;
  private readonly matcher = new Matcher();
  /// Le unità su cui si lavora, e quelle estranee che non si vedono.
  private candidates: El[] = [];
  private invisibleUnits: El[] = [];
  /// Ciò che si è escluso, col perché: unità o pezzi di un gruppo.
  private readonly excluded = new Map<El, Reason>();
  private readonly facts = new Map<El, ShapeFacts>();
  /// Il primo elemento di prima con ogni id.
  private readonly byId = new Map<string, El>();
  /// Chi rimanda a ogni id, e se lo fa con `href`.
  private readonly users = new Map<string, Array<{ readonly node: El; readonly href: boolean }>>();
  /// Le risorse estranee fuori da una `defs` della radice, che vanno nella
  /// `defs` delle risorse se diventano modificabili: unità, o pezzi di un
  /// gruppo che lo diventa.
  readonly movable = new Set<El>();
  /// La `defs` delle risorse: quella di FubDraw, la prima della radice con
  /// un id o, se nessuna ne ha uno, la prima della radice, che prende quello
  /// di FubDraw; `null` se il disegno non ne ha una.
  private home: El | null = null;
  /// Le risorse che crea il tentativo in corso, per id.
  private readonly created = new Map<string, El>();
  /// I disegni che dei `use` mostrano, coi `use`; il gruppo di ogni
  /// bersaglio e di ogni `use`, e quello di ogni elemento di un bersaglio.
  private readonly clusters: Cluster[] = [];
  readonly clusterOf = new Map<El, Cluster>();
  readonly holderOf = new Map<El, Cluster>();
  /// Le unità estranee dentro un gruppo modificabile che dei `use` clonano:
  /// il gruppo diventa un'unità sola con loro, che va nel simbolo o resta.
  private readonly absorbed = new Map<El, El[]>();
  /// I gruppi che il tentativo in corso prova, e i simboli nuovi dei cloni.
  active = new Set<Cluster>();
  made = new Map<Cluster, Made>();
  private readonly writers = new Map<Cluster, Context>();
  private readonly probes = new Map<Cluster, Context>();

  constructor(
    readonly text: string,
    private readonly scope: EditableScope,
    private readonly random?: RandomBytes,
  ) {
    this.doc = parseXml(new SourceText(text), false);
    this.engine = SceneEngine.open(text);
  }

  plan(): EditablePlan {
    const model = this.engine.model;
    if (model === null) return EMPTY;
    this.root = treeOf(this.doc, this.serial);
    if (!annotate(this.root, model)) return EMPTY;
    this.all = walk(this.root);
    this.order = new Map(this.all.map((node, at) => [node, at]));
    for (const node of this.all) {
      const id = node.attr("id");
      if (id !== null && id !== "" && !this.byId.has(id)) this.byId.set(id, node);
      const refer = (id: string, href: boolean): void => {
        let list = this.users.get(id);
        if (list === undefined) this.users.set(id, (list = []));
        list.push({ node, href });
      };
      for (const attr of node.attrs) {
        if (attr.uri !== "" && attr.uri !== XLINK_NS) continue;
        if (attr.local !== "href") for (const ref of urlIds(attr.value)) refer(ref, false);
        else if (node.uri === SVG_NS && node.local !== "a") {
          const ref = hrefId(attr.value);
          if (ref !== null) refer(ref, true);
        }
      }
      if (node.local === "style") for (const ref of urlIds(node.sheet ?? "")) refer(ref, false);
    }
    const home = resourceHome(model);
    this.home = home === null ? null : this.all.find((node) => node.part === home) ?? null;
    // Una `defs` senza id, come quella di Illustrator: le risorse vanno lì,
    // invece che in una seconda.
    if (this.home === null && !this.byId.has(DEFS_ID)) {
      this.home = this.root.children.find((node) => node.is("defs") && node.part?.kind === "container" && node.part.details?.role === "defs") ?? null;
    }
    const read = readAllSheets(this.doc, this.root);
    this.sheets = read.sheets;
    this.sheetB = read.sheet;
    this.inlineB = inlineSet(this.root);
    this.B = new Cascade(this.sheetB, this.root, (node) => `t${(node as El).serial}`, this.inlineB);
    this.props = new Set([...this.B.declared, ...attributeNames(this.root)]);
    const index = resourceIndex(this.doc);
    this.resolve = (id) => index.get(id) ?? null;
    this.collect();
    this.propagate();
    if (this.candidates.length === 0 && (this.scope.kind !== "all" || this.sheets.length === 0)) return { ...EMPTY, invisible: this.invisibleUnits.length };

    let keepSheets = false;
    let outcome: Outcome | null = null;
    for (let round = 0; round < MAX_ROUNDS && outcome === null; round++) {
      const tried = this.attempt(keepSheets);
      if (!(tried instanceof Retry)) {
        outcome = tried;
        break;
      }
      let progress = tried.keepSheets && !keepSheets;
      keepSheets ||= tried.keepSheets;
      for (const [node, reason] of tried.excluded) {
        if (this.excluded.has(node)) continue;
        this.excluded.set(node, reason);
        progress = true;
      }
      if (this.propagate()) progress = true;
      if (!progress) break;
    }
    // Un simbolo che resta estraneo non si vede da sé, come prima.
    const symbols = this.clusters.filter((cluster) => cluster.kind === "symbol" && this.candidates.includes(cluster.target));
    if (outcome === null) {
      for (const unit of this.candidates) if (!this.excluded.has(unit)) this.excluded.set(unit, { kind: "unknown" });
      return { ...EMPTY, leftovers: this.leftovers(null), invisible: this.invisibleUnits.length + symbols.length };
    }
    const invisible = this.invisibleUnits.filter((unit) => ![...outcome!.dropped].some((gone) => within(unit, gone))).length
      + symbols.filter((cluster) => this.isExcluded(cluster.target)).length;
    if (outcome.ops.length === 0) return { ...EMPTY, leftovers: this.leftovers(outcome), invisible };
    const translations = new Map<Translation, number>();
    for (const [kind, set] of outcome.translations) if (set.size > 0) translations.set(kind, set.size);
    return {
      ops: outcome.ops,
      converted: outcome.converted,
      translations,
      leftovers: this.leftovers(outcome),
      rules: outcome.rules,
      sheets: outcome.sheets,
      invisible,
      after: outcome.after,
    };
  }

  /// Le unità su cui lavorare, quelle che non si vedono, e quelle escluse
  /// prima di cominciare.
  private collect(): void {
    this.findClusters();
    for (const cluster of this.clusters) this.probing(cluster);
    // Ciò che dei `use` clonano entra con loro, anche se è già modificabile.
    const units = this.all.filter((node) => node.unit === node && (node.foreign || this.clusterOf.get(node)?.target === node));
    let chosen: El[];
    if (this.scope.kind === "all") chosen = units;
    else {
      const set = new Set<El>();
      const wanted = (unit: El): boolean => unit.foreign || this.clusterOf.get(unit)?.target === unit;
      for (const path of this.scope.paths) {
        let at: El | undefined = this.root;
        for (const index of path) at = at?.children[index];
        if (at === undefined) continue;
        if (at.unit !== null && wanted(at.unit)) set.add(at.unit);
        // Un contenitore scelto porta le unità estranee che contiene.
        else if (at.unit === null) for (const inner of walk(at)) if (inner.unit === inner && wanted(inner)) set.add(inner);
      }
      // Una risorsa a cui rimanda ciò che si sceglie diventa modificabile
      // con lui, e così quelle a cui rimanda lei; un simbolo o un disegno
      // clonato, con tutti i `use` che lo mostrano.
      const queue = [...set];
      const take = (unit: El): void => {
        if (set.has(unit)) return;
        set.add(unit);
        queue.push(unit);
      };
      while (queue.length > 0) {
        const unit = queue.pop()!;
        for (const id of this.referencesIn(unit)) {
          const target = this.byId.get(id);
          if (target === undefined || target.unit !== target || !target.foreign || target.uri !== SVG_NS || !RESOURCES.has(target.local)) continue;
          take(target);
        }
        for (const node of walk(unit)) {
          const cluster = this.clusterOf.get(node);
          if (cluster !== undefined) for (const member of [cluster.target, ...cluster.uses]) take(member.unit!);
        }
      }
      chosen = units.filter((unit) => set.has(unit));
    }
    // Gli id che un `use` mostra altrove.
    const shown = new Set<string>();
    for (const node of this.all) {
      if (!node.is("use")) continue;
      const href = node.attr("href") ?? node.attrs.find((attr) => attr.local === "href" && attr.uri !== "")?.value ?? null;
      if (href !== null && href.trim().startsWith("#")) shown.add(href.trim().slice(1));
    }
    // Un foglio importato, o un foglio con una condizione, non si legge.
    const imported = this.sheetB.imports.some((url) => !FONT_SERVICES.test(url))
      || this.doc.top.some((id) => {
        const node = this.doc.nodes[id]!;
        return node.kind === "pi" && this.text.startsWith("<?xml-stylesheet", node.start);
      });
    const conditioned = this.sheets.find((sheet) => {
      const media = sheet.el.attr("media")?.trim().toLowerCase() ?? "";
      return media !== "" && media !== "all";
    });
    for (const unit of chosen) {
      if (invisible(unit) && this.clusterOf.get(unit)?.target !== unit) {
        this.invisibleUnits.push(unit);
        continue;
      }
      this.candidates.push(unit);
      if (imported) this.excluded.set(unit, { kind: "import" });
      else if (conditioned !== undefined) this.excluded.set(unit, { kind: "condition", text: `media="${conditioned.el.attr("media")!.trim()}"` });
      else if (this.lockedAbove(unit)) this.excluded.set(unit, { kind: "locked" });
      else if (walk(unit).some((node) => node.attr("id") !== null && shown.has(node.attr("id")!) && this.clusterOf.get(node)?.target !== node)) this.excluded.set(unit, { kind: "copy" });
    }
    // Le risorse fuori posto, con un id: unità, pezzi di un gruppo che
    // diventa modificabile, o risorse di una `defs` dentro un'unità.
    const candidates = new Set(this.candidates);
    for (const node of this.all) {
      if (node.uri !== SVG_NS || !RESOURCES.has(node.local) || (node.attr("id") ?? "") === "" || inRootDefs(node) || node.unit === null) continue;
      if (candidates.has(node.unit) && (node.unit === node || this.subunit(node) === node || tucked(node))) this.movable.add(node);
    }
  }

  /// Gli id a cui rimanda `root`, con quelli che gli danno le regole dei
  /// fogli che lo scelgono.
  private referencesIn(root: El): Set<string> {
    const out = new Set<string>();
    for (const node of walk(root)) {
      for (const id of refsOf(node)) out.add(id);
      for (const rule of this.sheetB.rules) {
        if (this.matcher.selects(rule.selector, node) === false) continue;
        for (const declaration of rule.declarations) for (const id of urlIds(declaration.value)) out.add(id);
      }
    }
    return out;
  }

  /// I disegni che dei `use` mostrano altrove, coi `use`: un `symbol`
  /// estraneo di una `defs` della radice, come quelli di Illustrator e delle
  /// raccolte di icone, o una forma, un gruppo, un testo o un'immagine fuori
  /// dalle `defs`, come i cloni di Inkscape. Un gruppo già modificabile
  /// diventa un'unità sola con ciò che contiene: va tutto nel simbolo, o
  /// resta tutto. Niente gruppo, e i `use` restano estranei, per un `use`
  /// che non sta fra gruppi e collegamenti, che non è estraneo, come le
  /// copie di una ripetizione, o che ha due `href`; per un bersaglio che
  /// contiene `use`, fogli o risorse, che è bloccato o sta in un gruppo
  /// bloccato, o il cui id, o quello di ciò che contiene se va in un simbolo
  /// nuovo, è nominato da altro o portato da due elementi.
  private findClusters(): void {
    const count = new Map<string, number>();
    for (const node of this.all) {
      const id = node.attr("id");
      if (id !== null && id !== "") count.set(id, (count.get(id) ?? 0) + 1);
    }
    // Chi nomina ogni id, con qualunque attributo: `#id`, `url(#id)`, un
    // capo di un connettore; e i fogli.
    const named = new Map<string, Set<El>>();
    const name = (id: string, node: El): void => {
      let set = named.get(id);
      if (set === undefined) named.set(id, (set = new Set()));
      set.add(node);
    };
    for (const node of this.all) {
      for (const attr of node.attrs) {
        for (const match of attr.value.matchAll(/#([^\s"'(),;#]+)/g)) name(match[1]!, node);
        if (attr.uri === FUB_NS && (attr.local === "from" || attr.local === "to" || attr.local === "along")) name(attr.value.trim().split(/\s+/)[0]!, node);
      }
      if (node.sheet !== null) for (const id of urlIds(node.sheet)) name(id, node);
    }
    // Vero se `node` si disegna dove sta: fra gruppi e collegamenti, fino
    // alla radice.
    const placed = (node: El): boolean => {
      for (let at = node.parent; at !== null && at.parent !== null; at = at.parent) if (at.uri !== SVG_NS || !CONTAINERS.has(at.local)) return false;
      return true;
    };
    for (const [id, users] of this.users) {
      const target = this.byId.get(id);
      if (target === undefined || count.get(id) !== 1) continue;
      const part = target.part;
      const group = target.unit === null && part !== null && part.kind === "container" && part.details?.role === "group" && part.details.locked !== true && !this.lockedAbove(target);
      if (target.unit === null && !group) continue;
      const uses = [...new Set(users.filter((user) => user.href && user.node.is("use")).map((user) => user.node))];
      if (uses.length === 0) continue;
      const symbol = target.is("symbol") && target.unit === target && target.foreign && inRootDefs(target);
      const clone = target.uri === SVG_NS && CLONEABLE.has(target.local) && placed(target);
      if (!symbol && !clone) continue;
      const own = new Set(uses);
      if ([...(named.get(id) ?? [])].some((node) => !own.has(node))) continue;
      const single = (use: El): boolean => use.attrs.filter((attr) => attr.local === "href" && (attr.uri === "" || attr.uri === XLINK_NS)).length === 1;
      if (!uses.every((use) => use.unit !== null && use.foreign && placed(use) && single(use))) continue;
      const inside = walk(target);
      if (inside.some((node) => node.is("use") || node.is("style") || (node !== target && node.uri === SVG_NS && (node.local === "defs" || RESOURCES.has(node.local))))) continue;
      if (clone && inside.some((node) => node !== target && named.has(node.attr("id") ?? ""))) continue;
      const cluster: Cluster = { target, kind: symbol ? "symbol" : "clone", uses: uses.sort((a, b) => this.order.get(a)! - this.order.get(b)!) };
      this.clusters.push(cluster);
      for (const member of [target, ...uses]) this.clusterOf.set(member, cluster);
      for (const node of inside) this.holderOf.set(node, cluster);
      if (group) {
        this.absorbed.set(target, inside.filter((node) => node.unit === node && node.foreign));
        for (const node of inside) node.unit = target;
      }
    }
  }

  /// Un disegno e i `use` che lo mostrano diventano modificabili tutti
  /// insieme: se una parte resta, o qualcosa di ciò che il disegno
  /// contiene, restano tutte. Vero se ha escluso qualcosa.
  private propagate(): boolean {
    let changed = false;
    for (let again = true; again; ) {
      again = false;
      for (const cluster of this.clusters) {
        const members = [cluster.target, ...cluster.uses];
        const failed = members.some((member) => this.isExcluded(member)) || walk(cluster.target).some((node) => this.excluded.has(node));
        if (!failed) continue;
        const id = cluster.target.attr("id")!;
        for (const member of members) {
          if (this.isExcluded(member)) continue;
          const reason: Reason = member === cluster.target && cluster.kind === "clone" ? { kind: "copy" } : { kind: "linked", id };
          this.excluded.set(this.subunit(member), reason);
          changed = again = true;
        }
      }
    }
    return changed;
  }

  /// Il contesto con cui si scrive il contenuto di `cluster` nella cascata
  /// di prima: i valori di PROBE, che ciò che il contenuto dichiara da sé
  /// batte. Ma dove tutti i posti in cui il contenuto si vede gli danno lo
  /// stesso valore, e un `use` lo cambia, quel valore: va scritto sul
  /// contenuto, perché un'istanza non lo può dare. Il colore, sempre, se è
  /// lo stesso dappertutto: `currentColor` diventa quel colore.
  writing(cluster: Cluster): Context {
    let out = this.writers.get(cluster);
    if (out === undefined) {
      const memo = new Map<string, Value | null>();
      out = (p) => {
        let value = memo.get(p);
        if (value === undefined) {
          value = this.baked(cluster, p) ?? this.probing(cluster)(p);
          memo.set(p, value);
        }
        return value;
      };
      this.writers.set(cluster, out);
    }
    return out;
  }

  /// La sonda di `cluster`: i valori di PROBE, ma dove la proprietà ha pochi
  /// valori uno che nessun elemento del contenuto dichiara, perché ciò che
  /// dichiara si veda diverso dalla sonda e si scriva. Si sceglie prima di
  /// dare i contesti, perché leggere il contenuto non passi dalla sonda.
  probing(cluster: Cluster): Context {
    let out = this.probes.get(cluster);
    if (out === undefined) {
      const chosen = new Map<string, Value>();
      for (const [p, choices] of Object.entries(PROBE_CHOICES)) {
        const taken = new Set(walk(cluster.target).map((node) => this.B.value(node, p)).filter((each) => each.own).map((each) => each.key));
        const choice = choices.map((each) => plainValue(p, each)).find((each) => !taken.has(each.key));
        if (choice !== undefined) chosen.set(p, choice);
      }
      out = (p) => chosen.get(p) ?? probe(p);
      this.probes.set(cluster, out);
    }
    return out;
  }

  /// Il valore di `p` che va scritto sul contenuto di `cluster` (vedi
  /// `writing`); `null` se nessuno.
  private baked(cluster: Cluster, p: string): Value | null {
    if (!INHERITED.has(p)) return null;
    let common: Value | null = null;
    let changed = p === "color";
    for (const place of this.placesOf(cluster)) {
      const value = this.B.value(place, p);
      if (value.doubt !== null || (common !== null && common.key !== value.key)) return null;
      common = value;
      if (place.is("use") && this.B.value(place.parent!, p).key !== value.key) changed = true;
    }
    return changed ? common : null;
  }

  /// Gli elementi da cui il contenuto di `cluster` riceve ciò che eredita:
  /// i `use`, e per un clone il genitore del disegno.
  private placesOf(cluster: Cluster): El[] {
    return cluster.kind === "clone" ? [cluster.target.parent!, ...cluster.uses] : [...cluster.uses];
  }

  /// Vero se un posto in cui si vede il contenuto di `cluster` gli dà un
  /// tratteggio: `pathLength` allora conta.
  dashedSomewhere(cluster: Cluster): boolean {
    return this.placesOf(cluster).some((place) => {
      const dashes = this.B.value(place, "stroke-dasharray");
      return dashes.doubt !== null || (dashes.key !== "none" && dashes.key !== "initial");
    });
  }

  /// Il nome che porta `target`: il suo `title`, o, con `inkscape`,
  /// `inkscape:label`, o `data-name` o `aria-label`; `null` se nessuno.
  private labelOf(target: El, inkscape: boolean): string | null {
    const title = target.children.find((child) => child.is("title"))?.element ?? null;
    let base = title === null ? null : characterDataOf(this.doc, title);
    const names: ReadonlyArray<readonly [string, string]> = inkscape ? [[INKSCAPE_NS, "label"], ["", "data-name"], ["", "aria-label"]] : [["", "data-name"], ["", "aria-label"]];
    for (const [uri, local] of names) base ??= target.attrs.find((attr) => attr.uri === uri && attr.local === local)?.value ?? null;
    return base === null || cleanName(base) === "" ? null : base;
  }

  /// Il nome del simbolo nuovo che contiene `target`: il suo, se ne ha uno,
  /// diverso da quelli degli altri simboli, che si aggiunge a `taken`;
  /// `null` se non ne ha.
  private symbolName(target: El, taken: Set<string>): string | null {
    const base = this.labelOf(target, true);
    if (base === null) return null;
    const name = freeSymbolName(taken, base);
    taken.add(nameKey(name));
    return name;
  }

  /// L'elemento di prima con l'id `id`.
  element(id: string): El | undefined {
    return this.byId.get(id);
  }

  /// Vero se `unit` sta in un contenitore bloccato.
  private lockedAbove(unit: El): boolean {
    for (let at = unit.parent; at !== null; at = at.parent) {
      const part = at.part;
      if (part !== null && part.kind === "container" && part.details?.locked === true) return true;
    }
    return false;
  }

  /// Il pezzo che resta estraneo quando `node`, in un'unità che diventa
  /// modificabile, non può: l'elemento più in alto sopra di lui, o lui, che
  /// sta direttamente in un gruppo dell'unità; altrimenti l'unità. Un `svg`
  /// dentro il disegno è un pezzo solo: diventa un gruppo con tutto ciò che
  /// contiene, o resta com'è.
  subunit(node: El): El {
    const unit = node.unit!;
    let at = node;
    for (let up = node; up !== unit; up = up.parent!) if (up.is("svg")) at = up;
    while (at !== unit && !(at.parent !== null && CONTAINERS.has(at.parent.local) && at.parent.uri === SVG_NS)) at = at.parent!;
    // Un pezzo sta in un gruppo che a sua volta diventa modificabile.
    for (let up = at.parent; up !== null && up !== unit.parent; up = up.parent) if (!CONTAINERS.has(up.local) || up.uri !== SVG_NS) return unit;
    return at;
  }

  /// Il tipo della risorsa modificabile `id`, contando anche le risorse
  /// che il comando sta rendendo modificabili, nella `defs` della radice o
  /// fuori, da portarvi, e quelle che crea: se poi una non lo diventa, la
  /// prova sul testo di dopo lo dice.
  readonly hopeful: Resolve = (id) => {
    const known = this.resolve(id);
    if (known !== null) return known;
    const made = this.created.get(id);
    if (made !== undefined) return resourceKind(made.local);
    const node = this.byId.get(id);
    if (node === undefined || node.uri !== SVG_NS || this.isExcluded(node)) return null;
    const placed = node.unit === node && inRootDefs(node) && this.candidates.includes(node);
    return placed || this.movable.has(node) ? resourceKind(node.local) : null;
  };

  /// Una risorsa nuova del tentativo in corso: il suo id.
  create(node: El): string {
    const id = createId("resource", (taken) => this.byId.has(taken) || this.created.has(taken), this.random);
    this.created.set(id, node);
    return id;
  }

  /// Vero se `node` è escluso, lui o un antenato nella sua unità.
  isExcluded(node: El): boolean {
    for (let at: El | null = node; at !== null; at = at === node.unit ? null : at.parent) if (this.excluded.has(at)) return true;
    return false;
  }

  /// I fatti della forma di `node`, per il confronto.
  shape(node: El): ShapeFacts {
    let out = this.facts.get(node);
    if (out === undefined) {
      const texts: string[] = [];
      if ((node.local === "text" || node.local === "tspan") && node.element !== null) {
        const stack = [...node.element.children].reverse();
        while (stack.length > 0) {
          const inner = this.doc.nodes[stack.pop()!]!;
          if (inner.kind === "text" || inner.kind === "cdata") texts.push(inner.value);
          else if (inner.kind === "element") stack.push(...[...inner.children].reverse());
        }
      }
      const wraps = ["inline-size", "shape-inside"].some((p) => {
        const value = this.B.value(node, p);
        return value.doubt !== null || !["initial", "auto", "none", "0", "0px"].includes(value.key);
      });
      out = {
        ...shapeFacts(node.local, (name) => node.attr(name)),
        ambiguousSpace: node.local === "text" || node.local === "tspan" ? ambiguousSpace(texts) : null,
        wraps,
        viewport: this.B.viewport(node),
      };
      this.facts.set(node, out);
    }
    return out;
  }

  /// Le sfumature che servono soltanto da modello, con `href`, ad altre che
  /// diventano modificabili: se ne vanno, perché quelle prendono da loro ciò
  /// che serve. Restano un campione e una risorsa di FubDraw, una che un
  /// livello o un gruppo bloccato protegge e, in un disegno di Inkscape, una
  /// che l'autore tiene fra le sue sfumature: Inkscape segna con
  /// `inkscape:collect="always"` quelle che getta da sé.
  private templates(): Set<El> {
    const inkscape = this.all.some((node) => node.uri === INKSCAPE_NS || node.attrs.some((attr) => attr.uri === INKSCAPE_NS));
    const flattened = new Set<El>();
    for (const node of this.all) {
      if (!isGradient(node) || hrefOf(node) === null || node.unit === null || this.isExcluded(node)) continue;
      if ((node.unit === node && inRootDefs(node) && this.candidates.includes(node)) || this.movable.has(node)) flattened.add(node);
    }
    const out = new Set<El>();
    for (let changed = flattened.size > 0; changed; ) {
      changed = false;
      for (const node of this.all) {
        if (out.has(node) || !isGradient(node) || node.unit !== node || this.excluded.has(node) || this.lockedAbove(node)) continue;
        if (node.attrs.some((attr) => (attr.uri === INKSCAPE_NS && attr.local === "swatch") || (attr.uri === FUB_NS && attr.local === "role"))) continue;
        if (inkscape && !node.attrs.some((attr) => attr.uri === INKSCAPE_NS && attr.local === "collect" && attr.value.trim() === "always")) continue;
        const users = this.users.get(node.attr("id") ?? "") ?? [];
        if (users.length === 0 || !users.every((user) => user.href && (flattened.has(user.node) || out.has(user.node)))) continue;
        out.add(node);
        changed = true;
      }
    }
    return out;
  }

  // -------------------------------------------------------------------------
  // Un tentativo.
  // -------------------------------------------------------------------------

  private attempt(keepSheets: boolean): Outcome | Retry {
    this.created.clear();
    const templates = this.templates();
    const units = this.candidates.filter((unit) => !this.excluded.has(unit) && !templates.has(unit));
    // I gruppi dei `use` che il tentativo prova: quelli che ha tutti. Il
    // contenuto dei loro disegni si scrive col contesto di prova.
    const unitSet = new Set(units);
    this.active = new Set(this.clusters.filter((cluster) => [cluster.target, ...cluster.uses].every((member) => !this.isExcluded(member) && unitSet.has(member.unit!))));
    for (const cluster of this.clusters) this.B.setContext(cluster.target, this.active.has(cluster) ? this.writing(cluster) : null);
    // L'albero di dopo, e come lo vede la superficie.
    const [X, xOf] = cloneTree(this.root, this.serial, (node) => node);
    // Le risorse fuori posto vanno nella `defs` delle risorse, in coda a
    // quelle che ha e nell'ordine in cui stavano, prima di guardare come le
    // vede la superficie: lì ereditano da lei.
    const moving = [...this.movable].filter((node) => !this.isExcluded(node) && !templates.has(node)).sort((a, b) => this.order.get(a)! - this.order.get(b)!);
    let homeX: El | null = null;
    const homeOf = (): El => {
      if (homeX !== null) return homeX;
      if (this.home !== null) {
        homeX = xOf.get(this.home)!;
        if (homeX.attr("id") === null) homeX.attrs = [{ uri: "", local: "id", value: DEFS_ID }, ...homeX.attrs];
        return homeX;
      }
      const made = new El(SVG_NS, "defs", `${prefixOf(X)}defs`, [{ uri: "", local: "id", value: DEFS_ID }], false, null, null, this.serial());
      made.parent = X;
      let at = 0;
      while (at < X.children.length && (X.children[at]!.is("title") || X.children[at]!.is("desc"))) at++;
      X.children.splice(at, 0, made);
      return (homeX = made);
    };
    if (moving.length > 0) {
      const home = homeOf();
      for (const node of moving) {
        const x = xOf.get(node)!;
        x.parent!.children.splice(x.parent!.children.indexOf(x), 1);
        x.parent = home;
        home.children.push(x);
      }
    }
    // Ciò che dei `use` clonano va in un simbolo nuovo, in coda alla `defs`
    // delle risorse, col nome che porta; al suo posto, un'istanza.
    this.made = new Map();
    const taken = new Set(documentSymbols(this.engine.model!).map((symbol) => nameKey(symbol.name)));
    for (const cluster of this.active) {
      const label = cluster.kind === "symbol" ? this.labelOf(cluster.target, false) : null;
      if (label !== null) taken.add(nameKey(cleanName(label)));
    }
    const clones = [...this.active].filter((cluster) => cluster.kind === "clone").sort((a, b) => this.order.get(a.target)! - this.order.get(b.target)!);
    for (const cluster of clones) {
      const target = cluster.target;
      const tx = xOf.get(target)!;
      const prefix = prefixOf(target);
      const symbol = new El(SVG_NS, "symbol", `${prefix}symbol`, [], false, null, null, this.serial());
      const id = this.create(symbol);
      symbol.attrs = [{ uri: "", local: "id", value: id }, { uri: "", local: "overflow", value: "visible" }];
      const name = this.symbolName(target, taken);
      if (name !== null) {
        const title = new El(SVG_NS, "title", `${prefix}title`, [], true, null, null, this.serial());
        title.parent = symbol;
        symbol.children.push(title);
      }
      const instance = new El(SVG_NS, "use", `${prefix}use`, [{ uri: "", local: "href", value: `#${id}` }], false, null, null, this.serial());
      const parent = tx.parent!;
      parent.children[parent.children.indexOf(tx)] = instance;
      instance.parent = parent;
      instance.unit = tx.unit === tx ? instance : tx.unit;
      tx.parent = symbol;
      symbol.children.push(tx);
      const home = homeOf();
      symbol.parent = home;
      home.children.push(symbol);
      this.made.set(cluster, { cluster, id, name, symbol, instance });
    }
    const [live, liveOf] = liveTree(X, this.serial, (node) => node.origin);
    const L = new Cascade(NO_SHEET, live, (node) => identity(node as El), this.inlineB);
    for (const cluster of this.active) L.setContext(liveOf.get(xOf.get(cluster.target)!)!, this.probing(cluster));
    const writer = new Writer(this, xOf, liveOf, L);
    const failed = new Map<El, Reason>();
    for (const unit of units) writer.unit(unit, failed);
    if (failed.size > 0) return new Retry(failed, false);
    writer.addTitles();
    // I ritagli nuovi vanno nella `defs` delle risorse, in coda a ciò che ha
    // e prima delle risorse che vi arrivano.
    const clips = writer.clips;
    if (clips.length > 0) {
      const home = homeOf();
      home.children.splice(home.children.length - moving.length - this.made.size, 0, ...clips.map((clip) => clip.el));
      for (const clip of clips) clip.el.parent = home;
    }
    const arriving = moving.length > 0 || clips.length > 0 || this.made.size > 0;
    const converted = writer.converted;
    const convertedSet = new Set(converted);
    const elements = new Set(writer.elements);

    // Le regole che dopo non servono più: scelgono soltanto ciò che diventa
    // modificabile, che ha già i suoi valori scritti, o niente che disegni.
    // Una regola che non sceglie niente se ne va solo dal disegno intero.
    const xAll = walk(X);
    const drop = new Map<SheetOf, Statement[]>();
    if (!keepSheets) {
      const useless = (rule: Rule): boolean => {
        let mine = false;
        for (const node of xAll) {
          const selects = this.matcher.selects(rule.selector, node);
          if (selects === false) continue;
          if (selects === null) return false;
          if (node.origin !== null && elements.has(node.origin)) mine = true;
          else if (relevant(rule, node, false)) return false;
        }
        // Una regola che sceglieva ciò che ora è modificabile è sua.
        return mine || this.scope.kind === "all" || writer.elements.some((node) => this.matcher.selects(rule.selector, node) !== false);
      };
      for (const sheet of this.sheets) {
        if (sheet.statements === null || !this.sheetEditable(sheet, convertedSet)) continue;
        const dead = sheet.statements.filter((statement) => !statement.at && statement.rules.every(useless));
        if (dead.length === 0) continue;
        // Senza il testo da riscrivere, il foglio se ne va tutto o resta.
        if (sheet.raw === null && !(dead.length === sheet.statements.length && blankCss(removeRanges(sheet.css, dead)))) continue;
        drop.set(sheet, dead);
      }
      // Una proprietà personalizzata resta finché un valore che resta la usa:
      // una regola che la dichiara torna nel suo foglio.
      const used = new Set<string>();
      for (const node of xAll) variablesIn(node.attr("style") ?? "", used);
      for (const sheet of this.sheets) {
        const dead = drop.get(sheet) ?? [];
        for (const statement of sheet.statements ?? []) {
          if (dead.includes(statement)) continue;
          for (const rule of statement.rules) for (const declaration of rule.declarations) variablesIn(declaration.value, used);
        }
      }
      for (let changed = true; changed; ) {
        changed = false;
        for (const [sheet, dead] of drop) {
          const back = dead.filter((statement) => statement.rules.some((rule) => rule.declarations.some((declaration) => used.has(declaration.property))));
          if (back.length === 0) continue;
          changed = true;
          for (const statement of back) for (const rule of statement.rules) for (const declaration of rule.declarations) variablesIn(declaration.value, used);
          const rest = dead.filter((statement) => !back.includes(statement));
          if (rest.length === 0 || (sheet.raw === null && !(rest.length === sheet.statements!.length && blankCss(removeRanges(sheet.css, rest))))) drop.delete(sheet);
          else drop.set(sheet, rest);
        }
      }
    }
    const droppedRules = new Set<Rule>();
    for (const statements of drop.values()) for (const statement of statements) for (const rule of statement.rules) droppedRules.add(rule);
    const rulesA = this.sheetB.rules.filter((rule) => !droppedRules.has(rule));

    // Una regola che resta non sceglie niente di ciò che diventa modificabile.
    const shared = new Map<El, Reason>();
    for (const rule of rulesA) {
      for (const node of writer.elements) {
        const piece = this.subunit(node);
        if (shared.has(piece)) continue;
        const x = xOf.get(node)!;
        const selects = this.matcher.selects(rule.selector, x);
        if (selects === false || !relevant(rule, x)) continue;
        shared.set(piece, selects === null ? { kind: "selector", text: rule.text } : { kind: "shared", text: rule.text });
      }
    }
    if (shared.size > 0) return new Retry(shared, false);

    // Le modifiche delle unità, e le unità che se ne vanno.
    const text = this.text;
    const edits = new Map<El, Edit[]>();
    const editsOf = (unit: El): Edit[] => {
      let list = edits.get(unit);
      if (list === undefined) edits.set(unit, (list = []));
      return list;
    };
    // Una risorsa che va nella `defs` delle risorse si scrive a parte; il
    // gruppo da cui viene la perde con gli spazi che la precedono.
    const movingSet = new Set(moving);
    const movedRaws = new Map<El, string>();
    for (const node of moving) {
      const element = node.element!;
      const raw = applyEdits(text, element.start, element.end, writer.edits(node));
      if (raw === null) return this.exclude(node);
      movedRaws.set(node, raw);
      writer.count("resource", node);
      if (node.unit === node) continue;
      const holder = node.parent!.element!;
      let from = element.start;
      while (from > holder.openEnd && isSpace(text.charCodeAt(from - 1))) from--;
      editsOf(node.unit!).push([from, element.end, ""]);
    }
    // Ciò che va in un simbolo nuovo si scrive a parte; al suo posto resta
    // l'istanza.
    const cloned = new Map<El, Made>();
    const clonedRaws = new Map<Made, string>();
    for (const made of this.made.values()) {
      const target = made.cluster.target;
      const element = target.element!;
      const raw = applyEdits(text, element.start, element.end, writer.edits(target, movingSet));
      if (raw === null) return this.exclude(target);
      cloned.set(target, made);
      clonedRaws.set(made, raw);
    }
    const instanceText = (made: Made): string => `<${made.instance.name} href="#${made.id}"/>`;
    const apart = new Set<El>([...moving, ...cloned.keys()]);
    for (const unit of converted) {
      if (movingSet.has(unit)) continue;
      const own = cloned.get(unit);
      if (own !== undefined) {
        editsOf(unit).push([unit.element!.start, unit.element!.end, instanceText(own)]);
        continue;
      }
      editsOf(unit).push(...writer.edits(unit, apart));
      for (const node of walk(unit)) {
        const made = node === unit ? undefined : cloned.get(node);
        if (made !== undefined) editsOf(unit).push([node.element!.start, node.element!.end, instanceText(made)]);
      }
    }
    const dropped = new Set<El>(templates);
    /// Gli elementi che se ne vanno da dentro un'unità che resta.
    const removedInside = new Set<El>();
    let sheetsDropped = 0;
    for (const [sheet, statements] of drop) {
      const el = sheet.el;
      const holder = el.unit!;
      const empty = statements.length === sheet.statements!.length && blankCss(removeRanges(sheet.css, statements));
      if (!empty) {
        editsOf(holder).push(...withoutStatements(sheet, statements));
        continue;
      }
      sheetsDropped++;
      if (holder === el) {
        dropped.add(el);
        continue;
      }
      // L'unità che conteneva soltanto il foglio se ne va con lui.
      const alone = holder.element!.children.every((child) => {
        const node = this.doc.nodes[child]!;
        return node === el.element || (node.kind === "text" && node.blank);
      });
      if (alone && !convertedSet.has(holder)) {
        dropped.add(holder);
        continue;
      }
      const element = el.element!;
      let from = element.start;
      while (isSpace(text.charCodeAt(from - 1)) && from > holder.element!.openEnd) from--;
      editsOf(holder).push([from, element.end, ""]);
      removedInside.add(el);
    }
    // Una `defs` dentro un'unità che resta vuota se ne va: il formato non ne
    // ha fuori dalla radice. Con lei vanno le modifiche di ciò che conteneva.
    for (const unit of converted) {
      for (const defs of walk(unit)) {
        if (defs === unit || !defs.is("defs") || this.isExcluded(defs) || !defs.children.every((child) => movingSet.has(child) || removedInside.has(child))) continue;
        const element = defs.element!;
        const other = element.children.some((child) => {
          const node = this.doc.nodes[child]!;
          return node.kind !== "element" && !(node.kind === "text" && node.blank);
        });
        if (other) continue;
        const holder = defs.parent!.element!;
        let from = element.start;
        while (from > holder.openEnd && isSpace(text.charCodeAt(from - 1))) from--;
        edits.set(unit, [...editsOf(unit).filter((edit) => edit[1] <= element.start || edit[0] >= element.end), [from, element.end, ""]]);
        removedInside.add(defs);
      }
    }
    // Una `defs` della radice che resta vuota se ne va, se nessuno la cita.
    for (const defs of this.root.children) {
      if (!defs.is("defs") || defs.part?.kind !== "container" || defs.children.length === 0 || (defs === this.home && arriving)) continue;
      if (!defs.children.every((child) => dropped.has(child))) continue;
      const other = defs.element!.children.some((child) => {
        const node = this.doc.nodes[child]!;
        return node.kind !== "element" && !(node.kind === "text" && node.blank);
      });
      const id = defs.attr("id");
      if (other || (id !== null && this.all.some((node) => node.attrs.some((attr) => attr.value.includes(`#${id}`))))) continue;
      for (const child of defs.children) dropped.delete(child);
      dropped.add(defs);
    }
    if (edits.size === 0 && dropped.size === 0 && moving.length === 0) {
      return { ops: [], after: text, converted: 0, translations: new Map(), rules: 0, sheets: 0, dropped, yOf: new Map() };
    }
    const renamed = new Map<El, string>();
    for (const node of writer.windows.keys()) if (node.unit === node) renamed.set(node, xOf.get(node)!.name);
    for (const [target, made] of cloned) if (target.unit === target) renamed.set(target, made.instance.name);
    const sequence = this.sequence({ edits, moving, movedRaws, clips, made: [...this.made.values()], clonedRaws, renamed, dropped, removedInside, drop, templates, convertedSet, xOf });
    if (sequence instanceof Retry) return sequence;
    const { ops, blame } = sequence;
    const engine = SceneEngine.open(text);
    const applied = engine.apply({ op: "batch", ops });
    const first = moving[0] ?? [...edits.keys()].sort((a, b) => this.order.get(a)! - this.order.get(b)!)[0] ?? units[0]!;
    if (applied.outcome !== "applied") {
      const culprit = blame[applied.index ?? 0];
      return culprit === undefined ? this.exclude(first) : culprit === null ? new Retry(new Map(), true) : this.exclude(culprit);
    }
    const after = applied.text;

    // Il documento di dopo, letto da capo e affiancato a quello previsto.
    const yDoc = parseXml(new SourceText(after), false);
    const Y = treeOf(yDoc, this.serial);
    if (engine.model === null || !annotate(Y, engine.model)) return this.exclude(first);
    const yOf = new Map<El, El>();
    const yOfX = new Map<El, El>();
    const tOf = new Map<El, El | null>();
    // Ciò che se ne va, senza le risorse che ne escono per la `defs` delle
    // risorse.
    const gone = new Set<El>();
    for (const stack = [...dropped, ...removedInside]; stack.length > 0; ) {
      const node = stack.pop()!;
      if (movingSet.has(node)) continue;
      gone.add(xOf.get(node)!);
      stack.push(...node.children);
    }
    const stack: Array<[El, El]> = [[X, Y]];
    while (stack.length > 0) {
      const [x, y] = stack.pop()!;
      if (x.local !== y.local || x.uri !== y.uri) return this.exclude(first);
      tOf.set(y, x.origin);
      yOfX.set(x, y);
      if (x.origin !== null) yOf.set(x.origin, y);
      const xs = x.children.filter((child) => !gone.has(child));
      if (xs.length !== y.children.length) return this.exclude(first);
      xs.forEach((child, at) => stack.push([child, y.children[at]!]));
    }

    // Ciò che è diventato modificabile lo è davvero.
    const yIndex = resourceIndex(yDoc);
    const yResolve: Resolve = (id) => yIndex.get(id) ?? null;
    const unclassified = new Map<El, Reason>();
    for (const node of writer.elements) {
      const y = yOf.get(node)!;
      if (!y.foreign || y.unit !== y) continue;
      const parent = y.parent!;
      const place = parent.parent === null ? "root" : parent.is("defs") && parent.parent.parent === null ? "defs" : "inside";
      unclassified.set(this.subunit(node), explain(yDoc, y.element!, place, yResolve));
    }
    // Anche i simboli nuovi e le istanze al posto dei disegni clonati.
    for (const made of this.made.values()) {
      for (const x of [made.symbol, made.instance]) {
        const y = yOfX.get(x)!;
        if (!y.foreign) continue;
        const parent = y.parent!;
        const place = parent.parent === null ? "root" : parent.is("defs") && parent.parent.parent === null ? "defs" : "inside";
        unclassified.set(this.subunit(made.cluster.target), explain(yDoc, y.element!, place, yResolve));
      }
    }
    if (unclassified.size > 0) return new Retry(unclassified, false);

    // Lo stile di dopo è quello di prima: coi fogli che restano per tutti, e
    // senza per ciò che è diventato modificabile.
    const yStyles = walk(Y).filter((node) => node.sheet !== null);
    const reread = readSheets(yStyles.map((node) => ({ id: this.sheets.find((sheet) => sheet.el === tOf.get(node))?.id ?? "?", css: node.sheet! })));
    if (!sameRules(reread.rules, rulesA)) return keepSheets ? this.exclude(first) : new Retry(new Map(), true);
    const sheetA: Sheet = { rules: rulesA, selectors: rulesA.map((rule) => rule.selector), deep: this.sheetB.deep, imports: this.sheetB.imports };
    const yIdentity = (node: El): string => {
      const origin = tOf.get(node);
      return origin === null || origin === undefined ? `n${node.serial}` : `t${origin.serial}`;
    };
    const inlineY = inlineSet(Y);
    const A = new Cascade(sheetA, Y, (node) => yIdentity(node as El), inlineY);
    const [yLive, yLiveOf] = liveTree(Y, this.serial, (node) => node);
    const L2 = new Cascade(NO_SHEET, yLive, (node) => yIdentity((node as El).origin!), inlineY);
    const props = new Set([...this.props, ...attributeNames(Y)]);
    const mismatched = new Map<El, Reason>();
    for (const node of writer.elements) {
      // Il contenuto di un simbolo si prova dopo, in ogni posto.
      const holder = this.holderOf.get(node);
      if (holder !== undefined && this.active.has(holder)) continue;
      const piece = this.subunit(node);
      if (mismatched.has(piece)) continue;
      const y = yOf.get(node)!;
      const facts = (): ShapeFacts => this.shape(node);
      const skip = writer.windows.get(node) ?? writer.instances.get(node);
      let found = difference({ cascade: this.B, node }, { cascade: A, node: y }, props, facts, skip)
        ?? difference({ cascade: this.B, node }, { cascade: L2, node: yLiveOf.get(y)! }, props, facts, skip);
      // Un'istanza sta dove il `use` metteva il disegno.
      const placement = writer.placements.get(node);
      if (found === null && placement !== undefined) {
        const now = A.own(y);
        if (now.m === null || !same(now.m, placement)) found = { property: "transform", value: now.text, doubt: null };
      }
      if (found !== null) mismatched.set(piece, reasonOf(found));
    }
    if (mismatched.size > 0) return new Retry(mismatched, false);
    // Un foglio sceglie anche per posizione e per ciò che sta attorno: ciò
    // che resta com'era deve vedersi com'era.
    if (this.sheetB.rules.length > 0) {
      const related = new Map<El, Reason>();
      for (const node of this.all) {
        if (elements.has(node)) continue;
        const y = yOf.get(node);
        if (y === undefined) continue;
        if (difference({ cascade: this.B, node }, { cascade: A, node: y }, props, () => this.shape(node)) === null) continue;
        if (!keepSheets && droppedRules.size > 0) return new Retry(new Map(), true);
        for (const near of this.neighbours(node, writer)) related.set(near, { kind: "structure" });
      }
      if (related.size > 0) return new Retry(related, false);
    }

    const places = this.verifyPlaces({ writer, yOf, yOfX, yLiveOf, A, L2, props });
    if (places !== null) return places;

    let rules = 0;
    for (const statements of drop.values()) rules += statements.reduce((sum, statement) => sum + statement.rules.length, 0);
    // Un disegno clonato già modificabile non conta fra ciò che lo diventa;
    // le unità estranee che conteneva sì.
    const count = converted.reduce((sum, unit) => sum + (unit.foreign ? 1 : this.absorbed.get(unit)?.length ?? 0), 0);
    return { ops, after, converted: count, translations: writer.translations, rules, sheets: sheetsDropped, dropped, yOf };
  }

  /// Il contenuto di ogni simbolo si vede uguale in ogni posto in cui si
  /// vede: dove stava il disegno clonato e in ogni `use`, coi valori che vi
  /// riceve prima e dopo. I posti che danno gli stessi valori si provano una
  /// volta sola. Una proprietà che non torna è del `use` che la dichiara, se
  /// la dichiara, altrimenti del disegno.
  private verifyPlaces(input: {
    readonly writer: Writer;
    readonly yOf: ReadonlyMap<El, El>;
    readonly yOfX: ReadonlyMap<El, El>;
    readonly yLiveOf: ReadonlyMap<El, El>;
    readonly A: Cascade;
    readonly L2: Cascade;
    readonly props: ReadonlySet<string>;
  }): Retry | null {
    const { writer, yOf, yOfX, yLiveOf, A, L2, props } = input;
    const B = this.B;
    const converted = new Set(writer.elements);
    const keys = [...INHERITED, ...[...props].filter((p) => p.startsWith("--"))];
    const failed = new Map<El, Reason>();
    for (const cluster of this.active) {
      const target = cluster.target;
      const yTarget = yOf.get(target)!;
      const yLiveTarget = yLiveOf.get(yTarget)!;
      // Un `symbol` non si disegna: si disegna ciò che contiene.
      const content = walk(target).filter((node) => converted.has(node) && (node !== target || cluster.kind === "clone"));
      const places: Array<{ readonly use: El | null; readonly b: Context | null; readonly a: Context; readonly l: Context }> = [];
      if (cluster.kind === "clone") {
        const instance = yOfX.get(this.made.get(cluster)!.instance)!;
        const live = yLiveOf.get(instance)!;
        places.push({ use: null, b: null, a: (p) => A.value(instance, p), l: (p) => L2.value(live, p) });
      }
      for (const use of cluster.uses) {
        const y = yOf.get(use)!;
        const live = yLiveOf.get(y)!;
        places.push({ use, b: (p) => B.value(use, p), a: (p) => A.value(y, p), l: (p) => L2.value(live, p) });
      }
      const seen = new Set<string>();
      for (const place of places) {
        B.setContext(target, place.b);
        A.setContext(yTarget, place.a);
        L2.setContext(yLiveTarget, place.l);
        const key = keys.map((p) => `${B.received(target, p).key}|${A.received(yTarget, p).key}|${L2.received(yLiveTarget, p).key}`).join(";");
        if (seen.has(key)) continue;
        seen.add(key);
        let found: Difference | null = null;
        let at: El | null = null;
        for (const node of content) {
          const y = yOf.get(node)!;
          const facts = (): ShapeFacts => this.shape(node);
          const skip = writer.windows.get(node);
          found = difference({ cascade: B, node }, { cascade: A, node: y }, props, facts, skip)
            ?? difference({ cascade: B, node }, { cascade: L2, node: yLiveOf.get(y)! }, props, facts, skip);
          if (found !== null) {
            at = node;
            break;
          }
        }
        if (found === null || at === null) continue;
        // La colpa è del `use` che dà la proprietà, o il colore che il
        // contenuto prende con `currentColor`: un'istanza non li porta.
        const use = place.use;
        const gives = (p: string): boolean => use !== null && inherits(p) && B.value(use, p).own;
        if (gives(found.property)) failed.set(this.subunit(use!), reasonOf(found));
        else if (gives("color") && PAINTS.has(found.property) && B.value(at, found.property).key === B.value(use!, "color").key) {
          const color = B.value(use!, "color");
          failed.set(this.subunit(use!), { kind: "property", name: "color", value: color.text ?? color.key });
        } else failed.set(this.subunit(target), reasonOf(found));
        break;
      }
      B.setContext(target, null);
      A.setContext(yTarget, null);
      L2.setContext(yLiveTarget, null);
    }
    return failed.size > 0 ? new Retry(failed, false) : null;
  }

  /// Vero se il comando può riscrivere il foglio `sheet`: sta da solo nella
  /// sua unità, o in una che non si vede, o in una che diventa modificabile.
  /// Un'unità estranea che si vede e resta, resta byte per byte.
  private sheetEditable(sheet: SheetOf, converted: ReadonlySet<El>): boolean {
    const holder = sheet.el.unit;
    return holder !== null && (holder === sheet.el || invisible(holder) || converted.has(holder));
  }

  /// I pezzi resi modificabili che un foglio può guardare per scegliere
  /// `node`: i suoi antenati, ciò che contiene, i suoi fratelli e quelli dei
  /// suoi antenati, con ciò che contengono.
  private neighbours(node: El, writer: Writer): El[] {
    const pieces = new Set(writer.elements.map((each) => this.subunit(each)));
    const out = new Set<El>();
    const consider = (each: El): void => {
      for (const inner of walk(each)) if (pieces.has(inner)) out.add(inner);
    };
    for (let at: El | null = node; at !== null; at = at.parent) {
      if (pieces.has(at)) out.add(at);
      for (const sibling of at.parent?.children ?? []) if (sibling !== at) consider(sibling);
    }
    consider(node);
    // Un selettore che guarda lontano, come `:has()`: tutto ciò che cambia.
    if (out.size === 0) for (const piece of pieces) out.add(piece);
    return [...out];
  }

  /// Un tentativo finito male per un motivo che non dipende dal disegno:
  /// la parte resta estranea, e si riprova senza. Una risorsa che cambia
  /// posto resta da sola, un `svg` dentro il disegno col suo pezzo; ogni
  /// altra cosa con la sua unità.
  private exclude(node: El): Retry {
    const part = this.movable.has(node) || node.unit === null ? node : node.is("svg") || this.clusterOf.has(node) ? this.subunit(node) : node.unit;
    return new Retry(new Map([[part, { kind: "unknown" }]]), false);
  }

  /// Le operazioni del comando, per un `batch` solo, e per ognuna la parte
  /// da lasciare estranea se il motore la rifiuta: `null` per un foglio,
  /// che allora resta tutto.
  ///
  /// - Prima la `defs` delle risorse, se deve nascere o aprirsi: `<defs/>`
  ///   diventa `<defs>…</defs>`; in coda vi entrano i ritagli nuovi.
  /// - Poi se ne va ciò che non torna: fogli, modelli, risorse che cambiano
  ///   posto; e si tolgono, dall'ultima, le unità da riscrivere.
  /// - Poi si rimettono, ognuna nel punto esatto da cui è partita, con gli
  ///   spazi attorno com'erano; le risorse che cambiano posto vanno in coda
  ///   alla `defs` delle risorse. Una risorsa entra prima di chi la usa,
  ///   perché il motore non accetta una risorsa a cui qualcosa rimanda già:
  ///   chi la usa e resta com'è si toglie e si rimette uguale.
  /// - Alla fine se ne vanno i modelli già modificabili, quando nessuno
  ///   rimanda più a loro.
  ///
  /// Il percorso di un elemento senza id si conta nel momento in cui
  /// l'operazione lo usa.
  private sequence(input: {
    readonly edits: ReadonlyMap<El, Edit[]>;
    readonly moving: readonly El[];
    readonly movedRaws: ReadonlyMap<El, string>;
    readonly clips: Writer["clips"];
    /// I simboli nuovi di ciò che dei `use` clonano, col testo riscritto di
    /// ciò che ognuno contiene.
    readonly made: readonly Made[];
    readonly clonedRaws: ReadonlyMap<Made, string>;
    /// Le unità che cambiano nome: `svg` che diventano gruppi, disegni
    /// clonati che diventano istanze.
    readonly renamed: ReadonlyMap<El, string>;
    readonly dropped: ReadonlySet<El>;
    readonly removedInside: ReadonlySet<El>;
    readonly drop: ReadonlyMap<SheetOf, Statement[]>;
    readonly templates: ReadonlySet<El>;
    readonly convertedSet: ReadonlySet<El>;
    readonly xOf: ReadonlyMap<El, El>;
  }): { readonly ops: Op[]; readonly blame: (El | null)[] } | Retry {
    const { edits, moving, movedRaws, clips, made, clonedRaws, renamed, dropped, removedInside, drop, templates, convertedSet, xOf } = input;
    const text = this.text;
    const movingSet = new Set(moving);
    // Un simbolo nuovo è un elemento dell'albero di dopo: si mette in fila
    // subito dopo il disegno che contiene.
    const madeOf = new Map(made.map((each) => [each.symbol, each]));
    const rank = (node: El): number => {
      const each = madeOf.get(node);
      return each === undefined ? this.order.get(node)! : this.order.get(each.cluster.target)! + 0.5;
    };
    const rewritten = [...edits.keys()].sort((a, b) => this.order.get(a)! - this.order.get(b)!);
    const raws = new Map<El, string>();
    for (const unit of rewritten) {
      const element = unit.element!;
      const part = unit.part!;
      // Un gruppo modificabile clonato se ne va tutto, e torna istanza.
      if (part.kind === "leaf" ? text.slice(element.start, element.end) !== part.raw : this.clusterOf.get(unit)?.target !== unit) return this.exclude(unit);
      const raw = applyEdits(text, element.start, element.end, edits.get(unit)!);
      if (raw === null) return this.exclude(unit);
      raws.set(unit, raw);
    }
    const first = moving[0] ?? rewritten[0] ?? null;
    const ops: Op[] = [];
    const blame: (El | null)[] = [];
    const push = (op: Op, culprit: El | null): void => {
      ops.push(op);
      blame.push(culprit);
    };
    const paths = new Paths();
    const settled = new Paths();
    const remove = (node: El, culprit: El | null): void => {
      push({ op: "remove", target: node.part!.facts.id ?? { path: paths.path(node), tag: tagName(node.part!) } }, culprit);
      paths.remove(node);
    };
    if (this.engine.status === "foreign") push({ op: "adopt" }, first);

    // La `defs` delle risorse, aperta.
    let homeId = DEFS_ID;
    let homeNode = this.home;
    let inner = "";
    if (moving.length > 0 || clips.length > 0 || made.length > 0) {
      const herald = moving[0] ?? clips[0]?.node ?? made[0]!.cluster.target;
      const unit = this.indentUnit();
      const home = this.home;
      if (home === null) {
        let at = 0;
        while (at < this.root.children.length && (this.root.children[at]!.is("title") || this.root.children[at]!.is("desc"))) at++;
        const anchor = at > 0 ? this.root.children[at - 1]! : null;
        const name = `${prefixOf(this.root)}defs`;
        inner = unit + unit;
        const after: Target | null = anchor === null ? null : anchor.part!.facts.id ?? { path: paths.path(anchor), tag: tagName(anchor.part!) };
        push({ op: "add", slot: { parent: ROOT, after, skip: 0, lead: "" }, gap: `\n${unit}`, raw: `<${name} id="${DEFS_ID}">\n${unit}</${name}>` }, herald);
        const placeholder = new El(SVG_NS, "defs", name, [], false, null, null, this.serial());
        paths.insert(this.root, at, placeholder);
        settled.insert(this.root, at, placeholder);
        homeNode = placeholder;
      } else {
        const named = home.attr("id");
        const target: Target = named ?? { path: paths.path(home), tag: tagName(home.part!) };
        homeId = named ?? DEFS_ID;
        const part = home.part as ContainerNode;
        const element = home.element!;
        const own = lineIndent(text, element.start) ?? "";
        inner = (home.children.length > 0 ? lineIndent(text, home.children[0]!.element!.start) : null) ?? own + unit;
        if (part.tail === null || part.parts.every((piece) => typeof piece === "string" && lastBreak(piece) < 0)) {
          // `<defs id="…"/>` si apre: si toglie e si rimette aperta.
          const probe = SceneEngine.open(text).apply({ op: "batch", ops: [...ops, { op: "remove", target }] });
          const raw = text.slice(element.start, element.end);
          const back = probe.outcome === "applied" ? flatten(probe.inverse).find((op): op is RestoreOp => op.op === "add" && "slot" in op && op.raw === raw) : undefined;
          if (back === undefined) return this.exclude(herald);
          let open: string;
          if (element.closeStart === null) {
            let slash = element.openEnd - 2;
            while (isSpace(text.charCodeAt(slash - 1))) slash--;
            open = `${text.slice(element.start, slash)}>\n${own}</${element.name}>`;
          } else open = `${text.slice(element.start, element.openEnd)}\n${own}${text.slice(element.closeStart, element.end)}`;
          push({ op: "remove", target }, herald);
          push({ ...back, raw: open }, herald);
        }
        if (named === null) push({ op: "ident", path: paths.path(home), tag: tagName(part), id: DEFS_ID }, herald);
      }
      for (const clip of clips) {
        const elem = { tag: "clipPath", attrs: { id: clip.id, "fub:role": "private" }, children: [{ tag: "rect", attrs: clip.rect }] };
        push({ op: "add", parent: homeId, pos: { last: true }, elem }, clip.node);
        paths.insert(homeNode!, paths.children(homeNode!).length, clip.el);
      }
    }

    // Ciò che se ne va per sempre: prima ciò che non è modificabile, che
    // nessuno usa come risorsa; i modelli già modificabili alla fine.
    const tops = [...dropped].filter((node) => ![...dropped].some((other) => other !== node && within(node, other)));
    const late = (node: El): boolean => walk(node).some((each) => templates.has(each) && !each.foreign);
    const byLast = (a: El, b: El): number => this.order.get(b)! - this.order.get(a)!;
    const early = [...tops.filter((node) => !late(node)), ...moving.filter((node) => node.unit === node)].sort(byLast);
    const culpritOf = (node: El): El | null => (templates.has(node) || movingSet.has(node) ? node : null);
    for (const node of early) {
      remove(node, culpritOf(node));
      settled.remove(node);
    }

    // Chi porta una risorsa che entra, e chi la usa.
    const provider = new Map<string, El>();
    for (const unit of rewritten) {
      const id = unit.attr("id");
      const symbol = unit.is("symbol") && this.clusterOf.get(unit)?.target === unit;
      if (id !== null && convertedSet.has(unit) && inRootDefs(unit) && unit.uri === SVG_NS && (RESOURCES.has(unit.local) || symbol)) provider.set(id, unit);
    }
    for (const node of moving) provider.set(node.attr("id")!, node);
    for (const each of made) provider.set(each.id, each.symbol);
    const gone = new Set<El>();
    for (const node of dropped) for (const each of walk(node)) gone.add(each);
    const touched = new Set<El>([...rewritten, ...moving]);
    const temporary = new Set<El>();
    if (provider.size > 0) {
      for (const node of this.all) {
        const part = node.part;
        if (node.unit !== node || part === null || part.kind !== "leaf" || touched.has(node) || gone.has(node)) continue;
        if (part.refs.some((id) => provider.has(id))) temporary.add(node);
      }
    }
    const css = new Map<El, string>();
    for (const sheet of this.sheets) {
      if (removedInside.has(sheet.el) || gone.has(sheet.el)) continue;
      const statements = drop.get(sheet);
      css.set(sheet.el, statements === undefined ? sheet.css : removeRanges(sheet.css, statements));
    }
    // Al posto di un disegno clonato che era un'unità torna la sua istanza.
    const placeOf = new Map(made.filter((each) => each.cluster.target.unit === each.cluster.target).map((each) => [each.cluster.target, each.instance]));
    const clonedBy = new Map([...placeOf.keys()].map((target) => [target.attr("id")!, target]));
    const refsAfter = (node: El): Set<string> => {
      const out = new Set<string>();
      for (const each of walk(madeOf.has(node) ? node : placeOf.get(node) ?? xOf.get(node)!)) {
        for (const id of refsOf(each)) out.add(id);
        if (each.origin !== null) for (const id of urlIds(css.get(each.origin) ?? "")) out.add(id);
      }
      return out;
    };
    const nodes = [...rewritten, ...temporary, ...moving, ...made.map((each) => each.symbol)];
    const waits = new Map<El, El[]>();
    for (const node of nodes) {
      const refs = temporary.has(node) ? new Set(node.part!.kind === "leaf" ? node.part!.refs : []) : refsAfter(node);
      waits.set(node, [...refs].map((id) => provider.get(id)).filter((each): each is El => each !== undefined && each !== node));
    }
    const culprit = (node: El): El => (temporary.has(node) ? waits.get(node)![0] ?? node : madeOf.get(node)?.cluster.target ?? node);
    // Prima ciò che torna nella `defs` delle risorse, poi le risorse che
    // vi arrivano, poi i simboli nuovi, poi il resto, ognuno nell'ordine del
    // documento; ma una risorsa sempre prima di chi la usa.
    const group = (node: El): number => {
      if (movingSet.has(node)) return 1;
      if (madeOf.has(node)) return 2;
      return provider.get(node.attr("id") ?? "") === node || (this.home !== null && node.parent === this.home) ? 0 : 3;
    };
    const pending = [...nodes].sort((a, b) => group(a) - group(b) || rank(a) - rank(b));
    const sequence: El[] = [];
    const placed = new Set<El>();
    while (pending.length > 0) {
      const ready = pending.findIndex((node) => waits.get(node)!.every((each) => placed.has(each)));
      const [node] = pending.splice(Math.max(ready, 0), 1);
      sequence.push(node!);
      placed.add(node!);
    }
    const order = sequence.filter((node) => !movingSet.has(node) && !madeOf.has(node));
    for (const node of [...order].reverse()) remove(node, culprit(node));

    // I punti da cui partono: l'inversa di ciò che li toglie.
    const restores = new Map<El, RestoreOp>();
    if (order.length > 0) {
      const probe = SceneEngine.open(text).apply({ op: "batch", ops });
      if (probe.outcome !== "applied") {
        const blamed = blame[probe.index ?? 0];
        return blamed === null ? new Retry(new Map(), true) : this.exclude(blamed ?? first ?? order[0]!);
      }
      const inverse = flatten(probe.inverse).filter((op): op is RestoreOp => op.op === "add" && "slot" in op);
      let at = 0;
      for (const node of order) {
        const raw = rawOf(node.part!);
        while (at < inverse.length && inverse[at]!.raw !== raw) at++;
        if (at === inverse.length) return this.exclude(culprit(node));
        restores.set(node, { ...inverse[at]!, raw: raws.get(node) ?? raw });
        at++;
      }
    }
    let previous: Target | null = clips.length > 0 ? clips[clips.length - 1]!.id : null;
    for (const node of sequence) {
      const each = madeOf.get(node);
      if (!movingSet.has(node) && each === undefined) {
        // Il fratello che precede il punto può essere già tornato con un
        // altro nome.
        let restore = restores.get(node)!;
        const after = restore.slot.after;
        if (after !== null && typeof after !== "string") {
          const sibling = paths.children(node.parent!)[after.path[after.path.length - 1]!];
          const name = sibling === undefined ? undefined : renamed.get(sibling);
          if (name !== undefined) restore = { ...restore, slot: { ...restore.slot, after: { ...after, tag: name } } };
        } else if (after !== null) {
          // Il fratello era un disegno clonato: il suo id è andato nel
          // simbolo, e al suo posto c'è l'istanza.
          const sibling = clonedBy.get(after);
          if (sibling !== undefined) restore = { ...restore, slot: { ...restore.slot, after: { path: paths.path(sibling), tag: renamed.get(sibling)! } } };
        }
        push(restore, culprit(node));
        paths.restore(node);
        continue;
      }
      if (previous === null && this.home !== null) {
        // In coda a ciò che la `defs` ha già.
        const list = paths.children(this.home);
        const last = list[list.length - 1];
        if (last !== undefined) previous = last.part!.facts.id ?? { path: paths.path(last), tag: tagName(last.part!) };
      }
      const raw = each === undefined ? this.reindented(node, movedRaws.get(node)!, inner) : this.symbolRaw(each, clonedRaws.get(each)!, inner);
      push({ op: "add", slot: { parent: homeId, after: previous, skip: 0, lead: "" }, gap: `\n${inner}`, raw }, culprit(node));
      previous = each === undefined ? node.attr("id")! : each.id;
    }
    for (const node of tops.filter(late).sort(byLast)) {
      push({ op: "remove", target: node.part!.facts.id ?? { path: settled.path(node), tag: tagName(node.part!) } }, culpritOf(node));
      settled.remove(node);
    }
    return { ops, blame };
  }

  /// Il rientro di un livello nel file: quello dei figli della radice, se
  /// stanno su righe loro; due spazi altrimenti.
  private indentUnit(): string {
    for (const child of this.root.children) {
      const indent = lineIndent(this.text, child.element!.start);
      if (indent !== null && indent !== "") return indent;
    }
    return "  ";
  }

  /// Il testo del simbolo nuovo `made`, che contiene `raw`, il disegno
  /// clonato riscritto, per una `defs` coi figli rientrati di `inner`: il
  /// nome nel suo `title`, e il disegno rientrato di un livello in più.
  private symbolRaw(made: Made, raw: string, inner: string): string {
    const target = made.cluster.target;
    const prefix = prefixOf(target);
    const step = inner + this.indentUnit();
    const title = made.name === null ? "" : `\n${step}<${prefix}title>${escapeText(made.name)}</${prefix}title>`;
    const from = lineIndent(this.text, target.element!.start);
    const container = target.unit!.part?.parent ?? null;
    const body = from === null || container === null ? raw : reindent(raw, scopeOf(container), "inside", 3, from, step, this.hopeful);
    return `<${prefix}symbol id="${made.id}" overflow="visible">${title}\n${step}${body}\n${inner}</${prefix}symbol>`;
  }

  /// Il testo `raw` di una risorsa che va nella `defs` delle risorse, col
  /// rientro `to` dei suoi nuovi fratelli al posto del suo, come lo sposta il
  /// motore: lì è una risorsa modificabile.
  private reindented(node: El, raw: string, to: string): string {
    const from = lineIndent(this.text, node.element!.start);
    const container = node.unit!.part?.parent ?? null;
    return from === null || container === null ? raw : reindent(raw, scopeOf(container), "defs", 2, from, to, this.hopeful);
  }

  /// Ciò che resta estraneo, col perché, dove sta dopo: i pezzi dentro una
  /// parte che resta tutta non si ripetono.
  private leftovers(outcome: Outcome | null): Leftover[] {
    const out: Leftover[] = [];
    const sorted = [...this.excluded].sort((a, b) => this.order.get(a[0])! - this.order.get(b[0])!);
    for (const [node, reason] of sorted) {
      if (sorted.some(([other]) => other !== node && within(node, other))) continue;
      // Un simbolo che resta per i suoi `use` non si vede da sé.
      if (invisible(node) && reason.kind === "linked") continue;
      // Un disegno clonato già modificabile resta modificabile: restano
      // estranee le unità che conteneva, ognuna col perché che ha dentro.
      const pieces: Array<[El, Reason]> = node.foreign
        ? [[node, reason]]
        : (this.absorbed.get(node) ?? []).map((unit) => [unit, sorted.find(([other]) => within(other, unit))?.[1] ?? reason]);
      for (const [piece, why] of pieces) {
        const y = outcome?.yOf.get(piece);
        out.push({ path: pathOf(y ?? piece), tag: piece.uri === SVG_NS ? piece.local : piece.name, name: nameOf(this.doc, piece), reason: why });
      }
    }
    return out;
  }
}

/// I figli elemento di ogni elemento mentre le operazioni del comando li
/// tolgono e li aggiungono: il percorso di un elemento senza id si conta
/// qui, nel momento in cui l'operazione lo usa.
class Paths {
  private readonly lists = new Map<El, El[]>();

  children(node: El): El[] {
    let list = this.lists.get(node);
    if (list === undefined) this.lists.set(node, (list = [...node.children]));
    return list;
  }

  insert(parent: El, at: number, node: El): void {
    this.children(parent).splice(at, 0, node);
  }

  /// Rimette `node` fra i fratelli, nell'ordine di prima.
  restore(node: El): void {
    const list = this.children(node.parent!);
    const siblings = node.parent!.children;
    let at = list.length;
    for (let k = siblings.indexOf(node) + 1; k < siblings.length; k++) {
      const index = list.indexOf(siblings[k]!);
      if (index >= 0) {
        at = index;
        break;
      }
    }
    list.splice(at, 0, node);
  }

  remove(node: El): void {
    const list = this.children(node.parent!);
    const at = list.indexOf(node);
    if (at >= 0) list.splice(at, 1);
  }

  path(node: El): number[] {
    const out: number[] = [];
    for (let at = node; at.parent !== null; at = at.parent) out.push(this.children(at.parent).indexOf(at));
    return out.reverse();
  }
}

/// Chi è un elemento dell'albero della superficie: lo stesso di prima.
function identity(node: El): string {
  return node.origin === null ? `n${node.serial}` : `t${node.origin.serial}`;
}

// ---------------------------------------------------------------------------
// La riscrittura.
// ---------------------------------------------------------------------------

/// Riscrive le unità sull'albero di dopo: toglie ciò che non serve e scrive
/// ciò che manca perché lo stile senza fogli sia quello di prima.
class Writer {
  /// Le unità riscritte.
  readonly converted: El[] = [];
  /// Gli elementi di prima resi modificabili, in ordine di documento.
  readonly elements: El[] = [];
  readonly translations = new Map<Translation, Set<El>>([
    ["style", new Set()], ["sheet", new Set()], ["color", new Set()], ["unit", new Set()], ["data", new Set()], ["text", new Set()], ["resource", new Set()],
    ["svg", new Set()], ["use", new Set()],
  ]);
  /// Il titolo nuovo di un elemento.
  private readonly titles = new Map<El, string>();
  /// La riga nuova di un testo che non ne aveva: dove comincia e dove finisce
  /// ciò che contiene, e il tag d'apertura.
  private readonly wraps = new Map<El, { readonly from: number; readonly to: number; readonly open: string; readonly close: string }>();
  /// Le righe vuote, che ricevono uno spazio che non va a capo.
  private readonly blanks = new Set<El>();
  /// Gli `stop` che una sfumatura prende da quella a cui rimandava, con i
  /// loro attributi.
  private readonly stops = new Map<El, { readonly from: El; readonly attrs: readonly StyleAttr[] }[]>();
  /// Gli `svg` dentro il disegno che diventano gruppi, con le proprietà che
  /// il confronto non guarda più: la finestra, diventata la trasformazione
  /// del gruppo, e il ritaglio nuovo.
  readonly windows = new Map<El, ReadonlySet<string>>();
  /// I ritagli nuovi, uno per finestra da cui ciò che contiene può uscire:
  /// di chi, l'id, l'elemento dell'albero di dopo e il rettangolo.
  readonly clips: { readonly node: El; readonly id: string; readonly el: El; readonly rect: Readonly<Record<string, string>> }[] = [];
  /// I `use` che diventano istanze, con le proprietà che il confronto non
  /// guarda: quelle che riceve il contenuto del simbolo, che si provano a
  /// parte in ogni posto, la posizione, diventata la trasformazione
  /// dell'istanza, e il ritaglio nuovo.
  readonly instances = new Map<El, ReadonlySet<string>>();
  /// La trasformazione che ogni istanza deve avere.
  readonly placements = new Map<El, Matrix>();
  private readonly B: Cascade;

  constructor(
    private readonly planner: Planner,
    private readonly xOf: ReadonlyMap<El, El>,
    private readonly liveOf: ReadonlyMap<El, El>,
    private readonly L: Cascade,
  ) {
    this.B = planner.B;
  }

  count(kind: Translation, node: El): void {
    this.translations.get(kind)!.add(node);
  }

  /// Toglie da `node` l'attributo `local` del namespace `uri`, nell'albero di
  /// dopo e in quello della superficie.
  private unset(node: El, uri: string, local: string): void {
    const x = this.xOf.get(node)!;
    const live = this.liveOf.get(x)!;
    const keep = (attr: StyleAttr): boolean => attr.uri !== uri || attr.local !== local;
    x.attrs = x.attrs.filter(keep);
    live.attrs = live.attrs.filter(keep);
    this.L.forget(live);
  }

  /// Scrive `value` per `name` su `node`, nell'albero di dopo e in quello
  /// della superficie.
  private write(node: El, name: string, value: string | null): void {
    const x = this.xOf.get(node)!;
    const live = this.liveOf.get(x)!;
    x.set(name, value);
    live.set(name, value);
    this.L.forget(live);
  }

  /// Riscrive `unit`; ciò che non si sa riscrivere va in `failed`.
  unit(unit: El, failed: Map<El, Reason>): void {
    const start = failed.size;
    const elements: El[] = [];
    const stack = [unit];
    while (stack.length > 0) {
      const node = stack.pop()!;
      if (node !== unit && (invisible(node) || this.planner.isExcluded(node))) {
        // Le risorse di una `defs` dentro l'unità vanno in quella delle
        // risorse: si riscrivono anche loro.
        if (node.is("defs")) for (let k = node.children.length - 1; k >= 0; k--) if (this.planner.movable.has(node.children[k]!)) stack.push(node.children[k]!);
        continue;
      }
      elements.push(node);
      for (let k = node.children.length - 1; k >= 0; k--) stack.push(node.children[k]!);
    }
    for (const node of elements) {
      const piece = this.planner.subunit(node);
      if (failed.has(piece)) continue;
      const reason = this.element(node);
      if (reason !== null) failed.set(piece, reason);
    }
    if (failed.size > start) return;
    this.converted.push(unit);
    this.elements.push(...elements);
  }

  /// Riscrive un elemento; il perché, se non si sa.
  private element(node: El): Reason | null {
    const tag = tagFor(node);
    // Ciò che decide se l'elemento si disegna resta, e l'elemento con lui.
    for (const attr of node.attrs) {
      if (attr.uri === "" && (CONDITIONAL.has(attr.local) || /^on[a-z]/i.test(attr.local))) return { kind: "attribute", name: attr.local };
    }
    const nested = node.is("svg") && node.parent !== null;
    if (nested) {
      const reason = this.nested(node);
      if (reason !== null) return reason;
    }
    const cluster = this.planner.clusterOf.get(node);
    const active = cluster !== undefined && this.planner.active.has(cluster) ? cluster : null;
    const symbol = active !== null && active.kind === "symbol" && active.target === node;
    if (symbol) {
      const reason = this.symbol(node);
      if (reason !== null) return reason;
    }
    const holder = this.planner.holderOf.get(node);
    const held = holder !== undefined && this.planner.active.has(holder) ? holder : null;
    // Un clone si fonde con ciò che gli sta sotto; nel simbolo, con ciò che
    // sta sotto l'istanza, attraverso la sua finestra: non si sa se è lo
    // stesso.
    if (held !== null && held.kind === "clone") {
      const blend = this.B.value(node, "mix-blend-mode");
      if (blend.doubt !== null || (blend.key !== "normal" && blend.key !== "initial")) return { kind: "property", name: "mix-blend-mode", value: blend.text ?? blend.key };
    }
    if (node.is("text")) {
      const reason = this.lines(node);
      if (reason !== null) return reason;
    }
    if (isGradient(node)) {
      const reason = this.flatten(node);
      if (reason !== null) return reason;
    }
    if (declares(node.attr("style"))) this.count("style", node);
    if (node.attr("class") !== null) this.count("sheet", node);
    // Ciò che non disegna niente, o che il formato non sa scrivere così, se
    // ne va: lo stile di prima si riscrive dopo, dove serve.
    let title: string | null = null;
    const titled = node.children.some((child) => child.is("title"));
    for (const attr of node.attrs) {
      if (attr.uri !== "") continue;
      const name = attr.local;
      let gone = name === "style" || name === "class" || JUNK.has(name);
      if (name.startsWith("data-") || (name.startsWith("aria-") && !(name === "aria-hidden" && node.local === "image"))) {
        gone = true;
        this.count("data", node);
        if ((name === "data-name" || name === "aria-label") && !titled && title === null && attr.value.trim() !== "") title = attr.value.trim().replace(/\s+/g, " ");
      }
      if (name === "pathLength") {
        if (dashed(this.B, node) || (held !== null && this.planner.dashedSomewhere(held))) return { kind: "attribute", name };
        gone = true;
      }
      if (!gone && tag !== null && PRESENTATION.has(name) && !this.allowed(tag, name, attr.value, node)) gone = true;
      if (gone) this.write(node, name, null);
    }
    if (title !== null) this.titles.set(node, title);
    if (symbol) {
      this.finishSymbol(node);
      return null;
    }
    const instance = active !== null && active.target !== node;
    if (instance) {
      const reason = this.instance(node, active);
      if (reason !== null) return reason;
    }
    // La geometria in misure relative.
    for (const [name, tags] of GEOMETRY) {
      const value = node.attr(name);
      if (value === null || !tags.has(node.local) || (tag !== null && svgAttribute(tag, name, value))) continue;
      const px = this.relativeLength(node, name, value);
      if (px === null) return { kind: "unit", value };
      this.write(node, name, num(px));
      this.count("unit", node);
    }
    // Ciò che manca, finché lo stile senza fogli è quello di prima.
    const x = this.xOf.get(node)!;
    const live = this.liveOf.get(x)!;
    const facts = (): ShapeFacts => this.planner.shape(node);
    const tried = new Set<string>();
    for (;;) {
      const found = difference({ cascade: this.B, node }, { cascade: this.L, node: live }, this.planner.props, facts, this.windows.get(node) ?? this.instances.get(node));
      if (found === null) break;
      if (found.doubt !== null) return reasonOf(found);
      const writes = this.valueFor(node, found.property);
      if (!(writes instanceof Map)) return writes;
      const key = `${found.property}:${[...writes].map(([name, value]) => `${name}=${value}`).join(";")}`;
      if (tried.has(key) || [...writes].every(([name, value]) => x.attr(name) === value)) return reasonOf(found);
      tried.add(key);
      for (const [name, value] of writes) this.write(node, name, value);
    }
    // Un gruppo tiene ciò che portava ai figli.
    if (CONTAINERS.has(node.local) || nested) this.inherited(node);
    else if (!instance) this.intent(node);
    return null;
  }

  /// Un `svg` dentro il disegno diventa un gruppo. La sua finestra (`x`,
  /// `y`, `width`, `height`, `viewBox` e `preserveAspectRatio`) diventa la
  /// trasformazione del gruppo, che scrive il confronto; il ritaglio della
  /// finestra, se ciò che contiene può uscirne, un `clipPath` nuovo nella
  /// `defs` delle risorse. Le percentuali di ciò che contiene si misurano
  /// sulla finestra e diventano numeri. Resta com'è un `svg` con una sua
  /// trasformazione, che i browser non applicano tutti, o con un ritaglio,
  /// una maschera o un filtro che nel gruppo cambierebbero.
  private nested(node: El): Reason | null {
    const B = this.B;
    const outer = B.viewport(node);
    for (const p of ["x", "y", "width", "height"]) {
      const value = B.value(node, p);
      if (value.doubt !== null) return reasonOf({ property: p, value: value.text ?? value.key, doubt: value.doubt });
    }
    const window = B.window(node);
    if (window === null) {
      for (const p of ["x", "y", "width", "height"]) {
        const text = B.value(node, p).text;
        if (text !== null && !/^\s*(?:auto|initial|unset|revert)\s*$/i.test(text) && lengthOf(p, text, outer) === null) return { kind: "unit", value: text.trim() };
      }
      // Una finestra vuota non mostra niente.
      const empty = ["width", "height"].find((p) => (lengthOf(p, B.value(node, p).text ?? "100%", outer) ?? 1) <= 0);
      return { kind: "attribute", name: empty ?? "viewBox" };
    }
    const own = B.own(node);
    if (own.m === null || !same(own.m, window.m)) return own.css || own.m === null ? { kind: "property", name: "transform", value: own.text } : { kind: "attribute", name: "transform" };
    const clipped = this.overflow(node);
    if (typeof clipped !== "boolean") return clipped;
    // Un ritaglio, una maschera o un filtro dell'`svg` si misurano nelle sue
    // coordinate: valgono uguali nel gruppo solo se la finestra non sposta
    // niente. Un filtro, poi, viene prima del ritaglio della finestra in un
    // gruppo e dopo in un `svg`.
    const moves = !same(window.m, IDENTITY);
    const clip = clipped && !this.contained(node, window);
    for (const p of ["clip-path", "mask", "filter"]) {
      const value = B.value(node, p);
      if (value.doubt !== null) return reasonOf({ property: p, value: value.text ?? value.key, doubt: value.doubt });
      if (value.key === "none" || value.key === "initial") continue;
      if (moves || (clip && p !== "mask")) return { kind: "property", name: p, value: value.text ?? value.key };
    }
    // Uno spessore o un tratteggio in percentuale, ereditato da fuori, si
    // misura dentro sulla finestra: si scrive in numeri sul gruppo.
    const inner = window.inner;
    if (outer === null || outer[0] !== inner[0] || outer[1] !== inner[1]) {
      for (const p of ["stroke-width", "stroke-dasharray", "stroke-dashoffset"]) {
        const value = B.value(node, p);
        if (value.own || value.doubt !== null || value.text === null || !value.text.includes("%")) continue;
        const lengths = value.text.trim().split(/[\s,]+/).filter((part) => part !== "").map((part) => lengthOf(p, part, inner));
        if (lengths.length === 0 || lengths.some((n) => n === null)) return { kind: "unit", value: value.text.trim() };
        this.write(node, p, lengths.map((n) => num(n!)).join(" "));
        this.count("unit", node);
      }
    }
    // Il gruppo, senza la finestra.
    const x = this.xOf.get(node)!;
    const live = this.liveOf.get(x)!;
    for (const each of [x, live]) {
      each.local = "g";
      each.name = `${prefixOf(node)}g`;
    }
    for (const name of ["x", "y", "width", "height", "viewBox", "preserveAspectRatio", "overflow", "clip"]) this.write(node, name, null);
    const skip = new Set(["x", "y", "width", "height"]);
    if (clip) {
      this.write(node, "clip-path", `url(#${this.clipFor(node, window)})`);
      skip.add("clip-path");
    }
    this.windows.set(node, skip);
    this.count("svg", node);
    return null;
  }

  /// Vero se la finestra di `node`, un `svg` dentro il disegno o un
  /// `symbol`, ritaglia ciò che contiene: `overflow` vale `hidden` per tutti
  /// e due, se nessuno lo cambia. Il perché, se non si sa dire.
  private overflow(node: El): boolean | Reason {
    const B = this.B;
    for (const p of ["overflow-x", "overflow-y", "clip"]) {
      const written = B.written(node, p);
      if (written.doubt !== null) return reasonOf({ property: p, value: written.text ?? "", doubt: written.doubt });
      if (written.text !== null && !(p === "clip" && /^\s*(?:auto|initial|unset)\s*$/i.test(written.text))) return { kind: "property", name: p, value: written.text.trim() };
    }
    const overflow = B.written(node, "overflow");
    if (overflow.doubt !== null) return reasonOf({ property: "overflow", value: overflow.text ?? "", doubt: overflow.doubt });
    const words = (overflow.text ?? "hidden").trim().toLowerCase().split(/\s+/);
    if (words.length > 2 || (words.length === 2 && words[0] !== words[1])) return { kind: "property", name: "overflow", value: overflow.text!.trim() };
    switch (words[0]) {
      case "hidden":
      case "scroll":
      case "clip":
      case "revert":
        return true;
      case "visible":
      case "auto":
      case "initial":
      case "unset":
        return false;
      default:
        return { kind: "property", name: "overflow", value: overflow.text!.trim() };
    }
  }

  /// Un ritaglio nuovo di `node`, la finestra `window` nelle coordinate di
  /// ciò che contiene, nella `defs` delle risorse: il suo id.
  private clipFor(node: El, window: SvgWindow): string {
    const [a, , , d, e, f] = window.m;
    const rect = { x: num((window.x - e) / a), y: num((window.y - f) / d), width: num(window.width / a), height: num(window.height / d) };
    const prefix = prefixOf(node);
    const made = new El(SVG_NS, "clipPath", `${prefix}clipPath`, [], false, null, null, this.planner.serial());
    const id = this.planner.create(made);
    made.attrs = [{ uri: "", local: "id", value: id }, { uri: FUB_NS, local: "role", value: "private" }];
    const shape = new El(SVG_NS, "rect", `${prefix}rect`, Object.entries(rect).map(([local, value]) => ({ uri: "", local, value })), false, null, null, this.planner.serial());
    shape.parent = made;
    made.children.push(shape);
    this.clips.push({ node, id, el: made, rect });
    return id;
  }

  /// Un `symbol` estraneo diventa un simbolo del formato, che non ha né
  /// finestra né presentazione sua: la finestra va in ogni istanza, ciò che
  /// il contenuto eredita scende su di lui, e lo scrive il confronto. Resta
  /// com'è, coi suoi `use`, un simbolo spostato da `x`, `y`, `refX` o
  /// `refY`, trasformato, con un effetto suo, o di cui non si sa dire se
  /// ritaglia.
  private symbol(node: El): Reason | null {
    const B = this.B;
    for (const name of ["refX", "refY"]) if (node.attr(name) !== null) return { kind: "attribute", name };
    for (const p of ["x", "y"]) {
      const value = B.value(node, p);
      if (value.doubt !== null) return reasonOf({ property: p, value: value.text ?? value.key, doubt: value.doubt });
      const text = value.text;
      if (text !== null && !/^\s*(?:auto|initial|unset|revert)\s*$/i.test(text) && lengthOf(p, text, null) !== 0) return { kind: "attribute", name: p };
    }
    const own = B.own(node);
    if (own.m === null || !same(own.m, IDENTITY)) return own.css || own.m === null ? { kind: "property", name: "transform", value: own.text } : { kind: "attribute", name: "transform" };
    for (const p of ["opacity", "clip-path", "mask", "filter", "mix-blend-mode", "isolation", "display"]) {
      const value = B.value(node, p);
      if (value.doubt !== null) return reasonOf({ property: p, value: value.text ?? value.key, doubt: value.doubt });
      let plain: boolean;
      if (p === "opacity") plain = value.text === null || readOpacity(value.text) === 1;
      else if (p === "display") plain = value.key !== "none";
      else if (p === "isolation") plain = value.key !== "isolate";
      else plain = value.key === "none" || value.key === "normal" || value.key === "initial";
      if (!plain) return { kind: "property", name: p, value: value.text ?? value.key };
    }
    const clipped = this.overflow(node);
    return typeof clipped === "boolean" ? null : clipped;
  }

  /// Il simbolo, senza ciò che il formato non gli lascia: restano l'id e
  /// `overflow="visible"`, perché il ritaglio della finestra, dove serve, lo
  /// porta l'istanza.
  private finishSymbol(node: El): void {
    for (const attr of node.attrs) {
      if (attr.uri === XLINK_NS) this.unset(node, XLINK_NS, attr.local);
      else if (attr.uri === "" && attr.local !== "id") this.write(node, attr.local, null);
    }
    this.write(node, "overflow", "visible");
  }

  /// Un `use` del gruppo `cluster` diventa un'istanza del simbolo. Dove lo
  /// mette, e per un `symbol` la finestra (`x`, `y`, `width` e `height` del
  /// `use`, `viewBox` e `preserveAspectRatio` del simbolo), va nella
  /// trasformazione; ciò che il contenuto eredita se ne va dall'istanza, e
  /// si prova in ogni posto; il `use` di un clone mostra il simbolo nuovo.
  /// Il ritaglio della finestra, se il contenuto può uscirne, è un
  /// `clipPath` nuovo dell'istanza. Resta com'è, coi compagni, un `use` con
  /// un ritaglio, una maschera o un filtro che la finestra sposterebbe, o
  /// che il ritaglio nuovo cambierebbe.
  private instance(node: El, cluster: Cluster): Reason | null {
    const B = this.B;
    const target = cluster.target;
    for (const p of cluster.kind === "symbol" ? ["x", "y", "width", "height"] : ["x", "y"]) {
      const value = B.value(node, p);
      if (value.doubt !== null) return reasonOf({ property: p, value: value.text ?? value.key, doubt: value.doubt });
      const text = value.text;
      if (text !== null && !/^\s*(?:auto|initial|unset|revert)\s*$/i.test(text) && lengthOf(p, text, B.viewport(node)) === null) return { kind: "unit", value: text.trim() };
    }
    let window: SvgWindow | null = null;
    let shift: Matrix;
    let clip = false;
    if (cluster.kind === "symbol") {
      window = B.useWindow(node, target);
      if (window === null) {
        // Un `use` che non mostra niente.
        const empty = ["width", "height"].find((p) => (lengthOf(p, B.value(node, p).text ?? "", B.viewport(node)) ?? 1) <= 0);
        return empty === undefined ? { kind: "unknown" } : { kind: "attribute", name: empty };
      }
      shift = window.m;
      const clipped = this.overflow(target);
      if (typeof clipped !== "boolean") return { kind: "linked", id: target.attr("id")! };
      if (clipped) {
        // Fin dove arriva il contenuto dipende da ciò che riceve qui, come
        // lo spessore dei contorni.
        B.setContext(target, (p) => B.value(node, p));
        clip = !this.contained(target, window);
        B.setContext(target, this.planner.writing(cluster));
      }
    } else {
      const offset = B.useOffset(node);
      if (offset === null) return { kind: "unknown" };
      shift = [1, 0, 0, 1, offset[0], offset[1]];
    }
    const own = B.own(node);
    if (own.m === null) return { kind: "property", name: "transform", value: own.text };
    const moves = !same(shift, IDENTITY);
    for (const p of ["clip-path", "mask", "filter"]) {
      const value = B.value(node, p);
      if (value.doubt !== null) return reasonOf({ property: p, value: value.text ?? value.key, doubt: value.doubt });
      if (value.key === "none" || value.key === "initial") continue;
      if (moves || (clip && p !== "mask")) return { kind: "property", name: p, value: value.text ?? value.key };
    }
    // L'istanza, con ciò che il formato le lascia.
    const m = compose(own.m, shift);
    const written = node.attr("transform");
    const parsed = written === null ? null : svgTransform(written);
    const keep = written !== null && parsed !== null && !own.css && same(parsed, m);
    for (const attr of node.attrs) {
      if (attr.uri === XLINK_NS && attr.local !== "href") this.unset(node, XLINK_NS, attr.local);
      else if (attr.uri === "" && !INSTANCE_KEPT.has(attr.local)) this.write(node, attr.local, null);
    }
    this.write(node, "transform", keep ? written : same(m, IDENTITY) ? null : formatTransform(m));
    if (cluster.kind === "clone") {
      const href = node.attrs.find((attr) => attr.local === "href" && (attr.uri === "" || attr.uri === XLINK_NS))!;
      this.retarget(node, href.uri, `#${this.planner.made.get(cluster)!.id}`);
    }
    const skip = new Set([...INHERITED, ...PRESENTATION, ...this.planner.props, "x", "y", "width", "height", "transform"].filter((p) => !INSTANCE_OWN.has(p)));
    if (clip) {
      this.write(node, "clip-path", `url(#${this.clipFor(node, window!)})`);
      skip.add("clip-path");
    }
    this.instances.set(node, skip);
    this.placements.set(node, m);
    this.count("use", node);
    return null;
  }

  /// Fa rimandare a `value` l'`href` del namespace `uri` di `node`,
  /// nell'albero di dopo e in quello della superficie.
  private retarget(node: El, uri: string, value: string): void {
    const x = this.xOf.get(node)!;
    const live = this.liveOf.get(x)!;
    for (const each of [x, live]) each.attrs = each.attrs.map((attr) => (attr.uri === uri && attr.local === "href" ? { ...attr, value } : attr));
    this.L.forget(live);
  }

  /// Vero se tutto ciò che disegna `svg` sta di sicuro nella sua finestra,
  /// coi contorni: il ritaglio allora non serve. Un testo, un marcatore, un
  /// filtro o ciò che non si sa misurare può uscirne.
  private contained(svg: El, window: SvgWindow): boolean {
    const B = this.B;
    const [a, , , d, e, f] = window.m;
    const min = [(window.x - e) / a, (window.y - f) / d];
    const max = [(window.x + window.width - e) / a, (window.y + window.height - f) / d];
    const bounds = new BoundsBuilder();
    const matrices = new Map<El, Matrix>([[svg, IDENTITY]]);
    const stack = [...svg.children];
    while (stack.length > 0) {
      const node = stack.pop()!;
      if (invisible(node)) continue;
      const display = B.value(node, "display");
      if (display.doubt === null && display.key === "none") continue;
      const filter = B.value(node, "filter");
      if (filter.doubt !== null || (filter.key !== "none" && filter.key !== "initial")) return false;
      const own = B.own(node).m;
      if (own === null) return false;
      const m = compose(matrices.get(node.parent!)!, own);
      matrices.set(node, m);
      if (CONTAINERS.has(node.local) || node.is("svg")) {
        stack.push(...node.children);
        continue;
      }
      const box = this.extent(node);
      if (box === null) return false;
      if (box === "empty") continue;
      const reach = this.reach(node);
      if (reach === null) return false;
      for (const [px, py] of [[box.min[0], box.min[1]], [box.max[0], box.min[1]], [box.max[0], box.max[1]], [box.min[0], box.max[1]]] as const) {
        for (const [dx, dy] of [[-reach, -reach], [reach, -reach], [reach, reach], [-reach, reach]] as const) bounds.include(apply(m, [px + dx, py + dy]));
      }
    }
    const out = bounds.finish();
    if (out === null) return true;
    const slack = 1e-6 * Math.max(max[0]! - min[0]!, max[1]! - min[1]!);
    return out.min[0] >= min[0]! - slack && out.min[1] >= min[1]! - slack && out.max[0] <= max[0]! + slack && out.max[1] <= max[1]! + slack;
  }

  /// Il riquadro della geometria di una forma nelle sue coordinate;
  /// `"empty"` per una che non disegna niente, `null` se non si sa.
  private extent(node: El): { readonly min: readonly [number, number]; readonly max: readonly [number, number] } | "empty" | null {
    const B = this.B;
    const viewport = B.viewport(node);
    const css = (p: string, fallback: string): number | null => {
      const value = B.value(node, p);
      if (value.doubt !== null) return null;
      return lengthOf(p, value.text === null || value.key === "initial" ? fallback : value.text, viewport);
    };
    const attr = (name: string): number | null => lengthOf(name, node.attr(name) ?? "0", viewport);
    switch (node.local) {
      case "rect":
      case "image": {
        const [x, y, w, h] = [css("x", "0"), css("y", "0"), css("width", "0"), css("height", "0")];
        if (x === null || y === null || w === null || h === null) return null;
        return w <= 0 || h <= 0 ? "empty" : { min: [x, y], max: [x + w, y + h] };
      }
      case "circle":
      case "ellipse": {
        const [cx, cy] = [css("cx", "0"), css("cy", "0")];
        const rx = css(node.local === "circle" ? "r" : "rx", "0");
        const ry = css(node.local === "circle" ? "r" : "ry", "0");
        if (cx === null || cy === null || rx === null || ry === null) return null;
        return rx <= 0 || ry <= 0 ? "empty" : { min: [cx - rx, cy - ry], max: [cx + rx, cy + ry] };
      }
      case "line": {
        const [x1, y1, x2, y2] = [attr("x1"), attr("y1"), attr("x2"), attr("y2")];
        if (x1 === null || y1 === null || x2 === null || y2 === null) return null;
        return { min: [Math.min(x1, x2), Math.min(y1, y2)], max: [Math.max(x1, x2), Math.max(y1, y2)] };
      }
      case "path":
      case "polyline":
      case "polygon": {
        const segments = segmentsOf(node.local, (name) => node.attr(name));
        if (segments === null) return null;
        const builder = new BoundsBuilder();
        builder.path(segments, IDENTITY);
        const out = builder.finish();
        return out === null ? "empty" : out;
      }
      default:
        return null;
    }
  }

  /// Quanto il contorno di una forma esce dalla sua geometria, al più;
  /// `null` se non si sa, o se un marcatore vi disegna.
  private reach(node: El): number | null {
    const B = this.B;
    for (const p of ["marker-start", "marker-mid", "marker-end", "vector-effect"]) {
      const value = B.value(node, p);
      if (value.doubt !== null || (value.key !== "none" && value.key !== "initial")) return null;
    }
    const stroke = B.value(node, "stroke");
    if (stroke.doubt === null && stroke.key === "none") return 0;
    const width = B.value(node, "stroke-width");
    const thickness = width.doubt === null ? lengthOf("stroke-width", width.text ?? "1", B.viewport(node)) : null;
    if (thickness === null) return null;
    let factor = B.value(node, "stroke-linecap").key === "square" ? Math.SQRT2 : 1;
    const join = B.value(node, "stroke-linejoin").key;
    if (join !== "round" && join !== "bevel") {
      // Uno spigolo esce di metà della sua lunghezza, finché non supera il
      // limite; oltre, il giunto si smussa.
      const limit = Number(B.value(node, "stroke-miterlimit").key);
      const miters = this.planner.shape(node).miters;
      if (!Number.isFinite(limit) || miters === null) return null;
      if (join === "miter") {
        for (const ratio of miters) if (ratio <= limit) factor = Math.max(factor, ratio);
      } else if (miters.length > 0) factor = Math.max(factor, limit);
    }
    return (Math.max(thickness, 0) / 2) * factor;
  }

  /// Una sfumatura che rimanda con `href` a un'altra, come le scrivono
  /// Inkscape e Illustrator, prende da quella, e da quelle a cui rimanda a
  /// sua volta, ciò che non ha: gli attributi, come SVG li eredita, e gli
  /// `stop` se non ne ha, coi valori che vi si vedono. Il rimando se ne va.
  private flatten(node: El): Reason | null {
    const own = hrefOf(node);
    if (own === null) return null;
    // Il perché si dice col rimando di `node`, anche se la catena si rompe
    // più in là: l'anello dopo ha il suo.
    const ownId = hrefId(own.value);
    const broken: Reason = ownId === null ? { kind: "attribute", name: own.uri === XLINK_NS ? "xlink:href" : "href" } : { kind: "resource", id: ownId };
    const chain: El[] = [];
    const seen = new Set<El>([node]);
    for (let at = node; ; ) {
      const link = hrefOf(at);
      if (link === null) break;
      const id = hrefId(link.value);
      const next = id === null ? undefined : this.planner.element(id);
      if (next === undefined || seen.has(next) || !isGradient(next)) return broken;
      seen.add(next);
      chain.push(next);
      at = next;
    }
    for (const name of [...(GRADIENT_OWN[node.local] ?? []), ...GRADIENT_SHARED]) {
      if (node.attr(name) !== null) continue;
      const shared = GRADIENT_SHARED.includes(name);
      const value = chain.find((template) => (shared || template.local === node.local) && template.attr(name) !== null)?.attr(name);
      if (value !== undefined && value !== null) this.write(node, name, value);
    }
    this.unset(node, "", "href");
    this.unset(node, XLINK_NS, "href");
    if (!node.children.some((child) => child.is("stop"))) {
      const source = chain.find((template) => template.children.some((child) => child.is("stop")));
      const made: { from: El; attrs: StyleAttr[] }[] = [];
      for (const stop of source?.children.filter((child) => child.is("stop")) ?? []) {
        const attrs: StyleAttr[] = [];
        const offset = stop.attr("offset");
        if (offset !== null) attrs.push({ uri: "", local: "offset", value: offset });
        const color = this.valueFor(stop, "stop-color", node);
        if (!(color instanceof Map)) return color;
        for (const [name, value] of color) if (value !== null && !(name === "stop-color" && value === "#000000")) attrs.push({ uri: "", local: name, value });
        made.push({ from: stop, attrs });
      }
      if (made.length > 0) {
        const x = this.xOf.get(node)!;
        for (const { attrs } of made) {
          const copy = new El(SVG_NS, "stop", `${prefixOf(node)}stop`, attrs, false, null, null, this.planner.serial());
          copy.parent = x;
          copy.unit = x.unit;
          copy.foreign = x.foreign;
          x.children.push(copy);
        }
        this.stops.set(node, made);
      }
    }
    this.count("resource", node);
    return null;
  }

  /// Le righe di un testo come le scrive il formato: ogni `tspan` figlio
  /// con la sua `x` e il suo `dy`, quanto scende dalla riga prima, al posto
  /// della `y` che scrivono Inkscape e Illustrator; il testo fuori dalle
  /// righe in una riga sola. Una riga vuota SVG non la sposta, e chi la segue
  /// si misura dall'ultima che si vede: riceve uno spazio che non va a capo,
  /// come le righe vuote di FubDraw, e il `dy` che la mette dove l'autore
  /// l'aveva messa. Un testo che non si sa leggere così resta com'è, e lo
  /// dice la classificazione.
  private lines(node: El): Reason | null {
    const doc = this.planner.doc;
    const element = node.element!;
    const svg = (id: NodeId, ...locals: string[]): boolean => {
      const inner = doc.element(id);
      return inner !== null && inner.ns === NS_SVG && locals.includes(inner.local);
    };
    const kids = element.children;
    const content = kids.filter((id) => {
      const inner = doc.nodes[id]!;
      return !(inner.kind === "text" && inner.blank) && !svg(id, "title", "desc");
    });
    if (content.length === 0 || content.some((id) => svg(id, "textPath"))) return null;
    const byElement = new Map(node.children.map((child) => [child.element!, child]));
    const at = (target: El, name: string): number | null | undefined => {
      const value = target.attr(name);
      return value === null ? undefined : this.relativeLength(target, name, value);
    };
    const tx = at(node, "x");
    const ty = at(node, "y");
    // Una posizione per ogni carattere non fa righe.
    if (["x", "y", "dx", "dy", "rotate"].some((name) => /\S[\s,]+\S/.test(node.attr(name) ?? ""))) return { kind: "text" };
    if (tx === null || ty === null) return null;
    const x = this.xOf.get(node)!;
    const positioned = (id: NodeId): boolean => svg(id, "tspan") && ["x", "y", "dx", "dy"].some((name) => byElement.get(doc.element(id)!)!.attr(name) !== null);
    if (!content.some(positioned)) {
      // Il testo senza righe diventa una riga sola, coi suoi pezzi.
      const first = kids.indexOf(content[0]!);
      const last = kids.indexOf(content[content.length - 1]!);
      if (kids.slice(first, last + 1).some((id) => svg(id, "title", "desc"))) return { kind: "text" };
      if (content.some((id) => doc.nodes[id]!.kind !== "text" && doc.nodes[id]!.kind !== "element")) return null;
      const prefix = element.name.slice(0, element.name.length - element.local.length);
      const line = new El(SVG_NS, "tspan", `${prefix}tspan`, [{ uri: "", local: "x", value: num(tx ?? 0) }, { uri: "", local: "dy", value: "0" }], true, null, null, this.planner.serial());
      line.parent = x;
      line.unit = x.unit;
      line.foreign = x.foreign;
      const inside = new Set(kids.slice(first, last + 1).map((id) => doc.element(id)).filter((inner) => inner !== null));
      const before = kids.slice(0, first).filter((id) => doc.element(id) !== null).length;
      line.children = x.children.filter((child) => child.origin !== null && inside.has(child.origin.element!));
      for (const child of line.children) child.parent = line;
      x.children = x.children.filter((child) => !line.children.includes(child));
      x.children.splice(before, 0, line);
      // Gli spazi in testa e in coda, che SVG toglie, restano fuori dalla
      // riga; con `xml:space="preserve"` si vedono, e restano dentro.
      let from = doc.nodes[content[0]!]!.start;
      let to = doc.nodes[content[content.length - 1]!]!.end;
      if (!preserved(node) && ["normal", "initial"].includes(this.B.value(node, "white-space").key)) {
        const source = this.planner.text;
        if (doc.nodes[content[0]!]!.kind === "text") while (isSpace(source.charCodeAt(from))) from++;
        if (doc.nodes[content[content.length - 1]!]!.kind === "text") while (isSpace(source.charCodeAt(to - 1))) to--;
      }
      this.wraps.set(node, { from, to, open: `<${line.name} x="${num(tx ?? 0)}" dy="0">`, close: `</${line.name}>` });
      this.count("text", node);
      return null;
    }
    if (!content.every((id) => svg(id, "tspan"))) return { kind: "text" };
    // Dove il browser mette la riga che si vede, e dove la metterà dopo.
    let shown = ty ?? 0;
    let written = ty ?? 0;
    let changed = false;
    const decorated = this.B.value(node, "text-decoration").key !== "none";
    for (const [k, id] of content.entries()) {
      const line = byElement.get(doc.element(id)!)!;
      const lx = at(line, "x");
      const ly = at(line, "y");
      const ldy = at(line, "dy");
      const ldx = at(line, "dx");
      if (lx === null || ly === null || ldy === null || ldx === null || (ldx !== undefined && ldx !== 0)) return { kind: "text" };
      const characters = lineText(doc, id);
      const empty = characters === "";
      if (!empty && characters.trim() === "") return { kind: "text" };
      if (lx === undefined && k > 0 && !empty) return { kind: "text" };
      const y = (ly ?? shown) + (ldy ?? 0);
      if (!empty) shown = y;
      else if (decorated || this.B.value(line, "text-decoration").key !== "none") return { kind: "text" };
      const dy = num(y - written);
      written += Number(dy);
      if (ly !== undefined || ldy === undefined || ldy !== Number(dy)) {
        this.write(line, "y", null);
        this.write(line, "dy", dy);
        changed = true;
      }
      if (ldx !== undefined) this.write(line, "dx", null);
      if (lx === undefined) this.write(line, "x", num(tx ?? 0));
      if (empty) this.blanks.add(line);
      changed ||= ldx !== undefined || lx === undefined || empty;
    }
    if (changed) this.count("text", node);
    return null;
  }

  /// Le estremità e gli angoli di un contorno che ora non si vedono, su una
  /// forma chiusa o senza spigoli, restano come li ha scelti l'autore: si
  /// vedranno se la forma cambia.
  private intent(node: El): void {
    if (this.B.value(node, "stroke").key === "none") return;
    const live = this.liveOf.get(this.xOf.get(node)!)!;
    for (const [p, initial] of [["stroke-linecap", "butt"], ["stroke-linejoin", "miter"]] as const) {
      const value = this.B.value(node, p);
      if (!(value.own || this.fromSymbol(node, p)) || value.doubt !== null || value.key === initial || value.key === "initial") continue;
      const now = this.L.value(live, p);
      if (now.key === value.key) continue;
      const writes = this.valueFor(node, p);
      if (writes instanceof Map) for (const [name, written] of writes) this.write(node, name, written);
    }
  }

  /// Su un gruppo, le proprietà ereditate dichiarate su di lui che la
  /// superficie non vedrebbe: si scrivono lì, perché i figli le ereditino
  /// come prima e il gruppo le porti ancora.
  private inherited(node: El): void {
    const live = this.liveOf.get(this.xOf.get(node)!)!;
    for (const p of GROUP_INHERITED) {
      const value = this.B.value(node, p);
      if (!(value.own || this.fromSymbol(node, p)) || value.doubt !== null || value.key === this.L.value(live, p).key) continue;
      if (!walk(node).some((inner) => inner !== node && renders(inner, p))) continue;
      const writes = this.valueFor(node, p);
      if (writes instanceof Map) for (const [name, written] of writes) this.write(node, name, written);
    }
  }

  /// Vero se `node` riceve `p` da un `symbol` che diventa del formato, che
  /// lo dichiarava: ora lo deve portare il contenuto, come se fosse suo.
  private fromSymbol(node: El, p: string): boolean {
    for (let at = node.parent; at !== null; at = at.parent) {
      if (at.is("symbol")) return this.planner.clusterOf.get(at)?.target === at && this.B.value(at, p).own;
      if (this.B.value(at, p).own) return false;
    }
    return false;
  }

  /// Vero se `value` per `name` vale sull'elemento `node` di tag `tag`.
  private allowed(tag: Tag, name: string, value: string, node: El): boolean {
    if (name === "clip-rule") return insideClip(node) && /^\s*(?:nonzero|evenodd)\s*$/.test(value);
    return svgAttribute(tag, name, value, this.planner.hopeful);
  }

  /// Una lunghezza di `name` su `node` in pixel; `null` se non si sa.
  private relativeLength(node: El, name: string, value: string): number | null {
    const absolute = lengthOf(name, value, this.B.viewport(node));
    if (absolute !== null) return absolute;
    const match = /^\s*([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)(em|rem)\s*$/i.exec(value);
    if (match === null) return null;
    const size = this.B.value(match[2]!.toLowerCase() === "em" ? node : this.planner.root, "font-size").number;
    return size === null ? null : Number(match[1]) * size;
  }

  /// Gli attributi che scrivono su `node` il valore di prima di `p`; il
  /// perché, se il formato non lo sa scrivere.
  private valueFor(node: El, p: string, counted = node): Map<string, string | null> | Reason {
    const B = this.B;
    const value = B.value(node, p);
    const tag = tagFor(node);
    const out = new Map<string, string | null>();
    const shown = (v: typeof value): string => (v.text ?? v.key).split("|")[0]!;
    const refuse = (): Reason => ({ kind: "property", name: p, value: shown(value) });
    const live = this.liveOf.get(this.xOf.get(node)!)!;
    // Le percentuali di ciò che un `svg` che diventa un gruppo porta a chi
    // contiene si misurano sulla sua finestra.
    const base = this.windows.has(node) ? this.B.window(node)?.inner ?? null : this.B.viewport(node);
    switch (p) {
      case "fill":
      case "fill-opacity":
      case "stroke":
      case "stroke-opacity":
      case "stop-color":
      case "stop-opacity":
      case "flood-color":
      case "flood-opacity": {
        const base = p.startsWith("fill") ? "fill" : p.startsWith("stroke") ? "stroke" : p.startsWith("stop") ? "stop-color" : "flood-color";
        const alphaName = base === "fill" ? "fill-opacity" : base === "stroke" ? "stroke-opacity" : base === "stop-color" ? "stop-opacity" : "flood-opacity";
        const color = B.value(node, base);
        const alpha = B.value(node, alphaName);
        const parsed = color.text === null ? null : paintOf(color.text);
        const a = alpha.text === null ? null : readOpacity(alpha.text);
        if (parsed === null || color.doubt !== null) return { kind: "property", name: base, value: shown(color) };
        if (a === null || alpha.doubt !== null) return { kind: "property", name: alphaName, value: shown(alpha) };
        let total = a;
        if (parsed.kind === "none") {
          if (base === "stop-color" || base === "flood-color") return refuse();
          out.set(base, "none");
          break;
        }
        if (parsed.kind === "url") {
          if (this.planner.hopeful(parsed.id) === null) return { kind: "resource", id: parsed.id };
          out.set(base, `url(#${parsed.id})`);
        } else {
          // Il colore resta com'è scritto, se il formato lo sa scrivere così.
          const written = color.text!.trim();
          if (parsed.color.a === 1 && formatPaint(written) !== null) out.set(base, written);
          else {
            out.set(base, formatHex(parsed.color));
            this.count("color", counted);
          }
          total = parsed.color.a * a;
        }
        // Un colore del tutto trasparente non dipinge: è `none`.
        if (total <= 0.5 / 255 && base !== "stop-color" && base !== "flood-color") {
          out.set(base, "none");
          out.set(alphaName, null);
          break;
        }
        // L'opacità che l'elemento riceve già non si scrive, se non è sua:
        // nel contenuto di un simbolo è quella di prova.
        const inherited = readOpacity(this.L.received(live, alphaName).text ?? "1") ?? 1;
        out.set(alphaName, Math.abs(total - inherited) < 5e-5 && (Math.abs(total - 1) < 5e-5 || !alpha.own) ? null : num(total));
        break;
      }
      case "stroke-width":
      case "font-size":
      case "x":
      case "y":
      case "width":
      case "height":
      case "cx":
      case "cy":
      case "r":
      case "rx":
      case "ry": {
        const px = lengthOf(p, value.text, base);
        if (px === null) return { kind: "unit", value: shown(value) };
        if (value.text !== null && /%/.test(value.text)) this.count("unit", counted);
        out.set(p, num(px));
        break;
      }
      case "letter-spacing": {
        if (value.key === "normal") out.set(p, "0");
        else {
          const px = lengthOf(p, value.text, base);
          if (px === null) return { kind: "unit", value: shown(value) };
          out.set(p, num(px));
        }
        break;
      }
      case "stroke-dasharray": {
        if (value.text === null) return refuse();
        const text = value.text.trim().toLowerCase();
        if (text === "none") out.set(p, "none");
        else {
          const lengths = text.split(/[\s,]+/).filter((part) => part !== "").map((part) => lengthOf(p, part, base));
          if (lengths.length === 0 || lengths.some((n) => n === null || n < 0)) return { kind: "unit", value: value.text };
          out.set(p, lengths.every((n) => n === 0) ? "none" : lengths.map((n) => num(n!)).join(" "));
        }
        break;
      }
      case "stroke-linecap":
      case "stroke-linejoin":
      case "font-style":
      case "text-anchor":
      case "text-decoration":
        out.set(p, value.key);
        break;
      case "font-weight": {
        // Il peso resta com'è scritto, se il formato lo sa scrivere così.
        const written = value.text?.trim().toLowerCase() ?? null;
        if (written !== null && tag !== null && svgAttribute(tag, p, written)) out.set(p, written);
        else if (value.number !== null && value.number % 100 === 0 && value.number >= 100 && value.number <= 900) out.set(p, String(value.number));
        else return refuse();
        break;
      }
      case "font-family":
        if (value.text === null) return refuse();
        out.set(p, value.text.trim());
        break;
      case "opacity": {
        const n = value.text === null ? null : readOpacity(value.text);
        if (n === null) return refuse();
        out.set(p, Math.abs(n - 1) < 5e-5 ? null : num(n));
        break;
      }
      case "display":
        out.set(p, value.key === "none" ? "none" : null);
        break;
      case "transform": {
        const own = B.own(node);
        if (own.m === null) return { kind: "property", name: p, value: own.text };
        const written = node.attr("transform");
        const parsed = written === null ? null : svgTransform(written);
        if (written !== null && parsed !== null && !own.css && same(parsed, own.m)) out.set(p, written);
        else out.set(p, same(own.m, [1, 0, 0, 1, 0, 0]) ? null : formatTransform(own.m));
        break;
      }
      case "clip-path":
      case "mask":
      case "filter":
      case "marker-start":
      case "marker-mid":
      case "marker-end": {
        if (value.text === null) return refuse();
        if (value.key === "none" || value.key === "initial") out.set(p, inherits(p) ? "none" : null);
        else {
          const id = reference(value.text);
          if (id === null) return refuse();
          if (this.planner.hopeful(id) === null) return { kind: "resource", id };
          out.set(p, `url(#${id})`);
        }
        break;
      }
      case "mix-blend-mode":
      case "isolation": {
        const blend = B.value(node, "mix-blend-mode");
        const isolation = B.value(node, "isolation");
        if (blend.doubt !== null || isolation.doubt !== null) return refuse();
        const parts: string[] = [];
        if (blend.key !== "normal" && blend.key !== "initial") parts.push(`mix-blend-mode:${blend.key}`);
        if (isolation.key === "isolate") parts.push("isolation:isolate");
        out.set("style", parts.length === 0 ? null : parts.join(";"));
        break;
      }
      default:
        return refuse();
    }
    // Ogni valore deve valere per il formato.
    if (tag !== null) {
      for (const [name, written] of out) {
        if (written === null || this.allowed(tag, name, written, node)) continue;
        const id = REFERENCES.has(name) ? referenceIn(written) : null;
        return id !== null ? { kind: "resource", id } : { kind: "property", name: p, value: shown(value) };
      }
    }
    return out;
  }

  /// Mette nell'albero di dopo i titoli nuovi, primi figli del loro
  /// elemento.
  addTitles(): void {
    for (const node of this.titles.keys()) {
      const x = this.xOf.get(node)!;
      const made = new El(SVG_NS, "title", "title", [], true, null, null, this.planner.serial());
      made.parent = x;
      made.unit = x.unit;
      made.foreign = x.foreign;
      x.children.unshift(made);
    }
  }

  /// Le modifiche del testo che riscrivono `top` come l'albero di dopo,
  /// senza ciò che sta in `skip`.
  edits(top: El, skip: ReadonlySet<El> = new Set()): Edit[] {
    const text = this.planner.text;
    const inside = new Set(this.elements);
    const out: Edit[] = [];
    const nodes: El[] = [];
    const stack = [top];
    while (stack.length > 0) {
      const node = stack.pop()!;
      if (node !== top && skip.has(node)) continue;
      nodes.push(node);
      for (let k = node.children.length - 1; k >= 0; k--) stack.push(node.children[k]!);
    }
    for (const node of nodes) {
      if (!inside.has(node)) continue;
      const element = node.element!;
      const x = this.xOf.get(node)!;
      const attrs = styleAttrs(element);
      const spans = element.attrs.map((attr) => attributeSpan(text, attr));
      const spanOf = new Map(element.attrs.map((attr, at) => [attr, spans[at]!]));
      const kept: Array<OutAttr & { readonly end: number }> = [];
      for (const [k, attr] of attrs.entries()) {
        const was = node.attrs[k]!;
        const now = x.attrs.find((each) => each.uri === was.uri && each.local === was.local);
        const span = spanOf.get(attr)!;
        if (now === undefined) {
          out.push([span.from, span.to, ""]);
          continue;
        }
        if (now.value !== was.value) out.push([attr.raw[0], attr.raw[1], escapeIn(now.value, text[attr.raw[0] - 1]!)]);
        kept.push({ name: attr.name, uri: was.uri, local: was.local, text: "", end: span.to });
      }
      const added = x.attrs.filter((each) => !node.attrs.some((was) => was.uri === each.uri && was.local === each.local));
      const nameEnd = element.start + 1 + element.name.length;
      // Un `svg` che diventa un gruppo cambia nome, e perde i namespace che
      // dichiara uguali a quelli che ha già attorno.
      const name = this.windows.has(node) ? x.name : element.name;
      if (name !== element.name) {
        out.push([element.start + 1, nameEnd, name]);
        if (element.closeStart !== null) out.push([element.closeStart + 2, element.closeStart + 2 + element.name.length, name]);
        for (const attr of element.attrs) {
          if ((attr.name === "xmlns" || attr.name.startsWith("xmlns:")) && declaredAbove(node, attr.name) === attr.value) {
            const span = spanOf.get(attr)!;
            out.push([span.from, span.to, ""]);
          }
        }
      }
      const last = spans.length === 0 ? nameEnd : spans[spans.length - 1]!.to;
      if (added.length > 0) {
        // Ogni attributo nuovo va dopo l'ultimo, nel testo, di quelli che
        // restano e che lo precedono nell'ordine canonico; quelli che restano
        // non si spostano.
        const gap = (span: { from: number; name: number }): string => text.slice(span.from, span.name);
        const separator = spans.length > 1 && gap(spans[1]!).includes("\n") ? gap(spans[1]!) : spans.length > 0 && gap(spans[0]!).includes("\n") ? gap(spans[0]!) : " ";
        const fresh = added.map((each) => ({ name: each.local, uri: "", local: each.local, text: escapeAttribute(each.value), end: -1 }));
        const inserts = new Map<number, string>();
        let point = nameEnd;
        for (const each of canonicalOrder([...kept, ...fresh]) as Array<OutAttr & { readonly end: number }>) {
          if (each.end >= 0) point = Math.max(point, each.end);
          else inserts.set(point, `${inserts.get(point) ?? ""}${separator}${each.name}="${each.text}"`);
        }
        for (const [at, inserted] of inserts) out.push([at, at, inserted]);
      }
      // Ciò che entra nell'elemento: il titolo in testa, lo spazio di una
      // riga vuota, gli `stop` presi da un'altra sfumatura in fondo. Un
      // elemento vuoto, `<path …/>`, si apre: `<path …>…</path>`.
      const title = this.titles.get(node);
      const titled = title === undefined ? "" : `<title>${escapeText(title)}</title>`;
      const blank = this.blanks.has(node) ? BLANK_LINE : "";
      const stops = this.stops.get(node);
      const own = lineIndent(text, element.start);
      const tail = stops === undefined ? "" : this.stopLines(node, stops, own);
      if (element.closeStart === null) {
        if (titled !== "" || blank !== "" || tail !== "") {
          let slash = element.openEnd - 2;
          while (slash > last && isSpace(text.charCodeAt(slash - 1))) slash--;
          const close = tail !== "" && own !== null ? `\n${own}` : "";
          out.push([slash, element.openEnd, `>${titled}${blank}${tail}${close}</${name}>`]);
        }
      } else {
        if (titled !== "") {
          let k = element.openEnd;
          while (k < element.closeStart && isSpace(text.charCodeAt(k))) k++;
          const lead = text.slice(element.openEnd, k);
          out.push([element.openEnd, element.openEnd, `${lead.includes("\n") ? lead : ""}${titled}`]);
        }
        if (blank !== "") out.push([element.openEnd, element.openEnd, blank]);
        if (tail !== "") {
          let at = element.closeStart;
          while (at > element.openEnd && isSpace(text.charCodeAt(at - 1))) at--;
          out.push([at, at, tail]);
        }
      }
      const wrap = this.wraps.get(node);
      if (wrap !== undefined) out.push([wrap.from, wrap.from, wrap.open], [wrap.to, wrap.to, wrap.close]);
    }
    return out;
  }

  /// Gli `stop` presi da un'altra sfumatura, scritti per stare in fondo a
  /// `node`: ognuno su una riga se `node` comincia la sua, rientro `own`,
  /// rientrati rispetto a lui come lo erano rispetto alla loro.
  private stopLines(node: El, stops: readonly { readonly from: El; readonly attrs: readonly StyleAttr[] }[], own: string | null): string {
    const text = this.planner.text;
    let step = "  ";
    const source = stops[0]!.from;
    const outer = lineIndent(text, source.parent!.element!.start);
    const inner = lineIndent(text, source.element!.start);
    if (outer !== null && inner !== null && inner.startsWith(outer) && inner.length > outer.length) step = inner.slice(outer.length);
    const name = `${prefixOf(node)}stop`;
    return stops.map(({ attrs }) => {
      const ordered = canonicalOrder(attrs.map((attr) => ({ name: attr.local, uri: "", local: attr.local, text: escapeAttribute(attr.value) })));
      const stop = `<${name}${ordered.map((attr) => ` ${attr.name}="${attr.text}"`).join("")}/>`;
      return own === null ? stop : `\n${own}${step}${stop}`;
    }).join("");
  }
}

/// Vero se `node` sta in una `defs` dentro la sua unità, fra gruppi e `svg`
/// che ne diventano: la `defs` se ne va, e lui va in quella delle risorse.
function tucked(node: El): boolean {
  const defs = node.parent;
  if (defs === null || !defs.is("defs") || defs === node.unit) return false;
  for (let at = defs.parent; at !== null; at = at.parent) {
    if (at.uri !== SVG_NS || !(CONTAINERS.has(at.local) || at.local === "svg")) return false;
    if (at === node.unit) return true;
  }
  return false;
}

/// Il valore della dichiarazione di namespace `name` più vicina sopra
/// `node`; `null` se nessuno la dichiara.
function declaredAbove(node: El, name: string): string | null {
  for (let at = node.parent; at !== null; at = at.parent) {
    const found = at.element?.attrs.find((attr) => attr.name === name);
    if (found !== undefined) return found.value;
  }
  return null;
}

/// Il tag del formato che `node` avrà dopo: un `svg` dentro il disegno
/// diventa un gruppo.
function tagFor(node: El): Tag | null {
  return node.is("svg") && node.parent !== null ? "g" : tagOf(node.element!);
}

/// Vero se per `node` vale `xml:space="preserve"`, suo o di un antenato.
function preserved(node: El): boolean {
  for (let at: El | null = node; at !== null; at = at.parent) {
    const space = at.attrs.find((attr) => attr.uri === XML_URI && attr.local === "space")?.value;
    if (space !== undefined) return space === "preserve";
  }
  return false;
}

/// Vero se `node` sta in un `clipPath`, dove conta `clip-rule`.
function insideClip(node: El): boolean {
  for (let at = node.parent; at !== null; at = at.parent) if (at.is("clipPath")) return true;
  return false;
}

/// Vero se `node` ha un tratteggio che si vede: `pathLength` lo scala.
function dashed(B: Cascade, node: El): boolean {
  const stroke = B.value(node, "stroke");
  const dashes = B.value(node, "stroke-dasharray");
  return stroke.key !== "none" && dashes.key !== "none" && dashes.key !== "initial";
}
