// I colori del documento (livello Standard): i campioni, colori con un nome
// che gli oggetti usano per riferimento, e i colori che il disegno usa; e le
// operazioni che fanno un campione, lo cambiano, lo rinominano e lo
// tolgono, ciascuna in un passo che si annulla (formato della scena,
// risorse).
//
// - **Un campione è una risorsa:** una sfumatura con un punto solo, un nome
//   e `fub:role="swatch"`, che ogni lettore di SVG mostra. Chi lo usa scrive
//   `url(#id) #rrggbb`, col colore del campione come ripiego.
// - **Un colore lo usa chi lo mostra**, come lo legge il pannello delle
//   proprietà (`look.ts`): il riempimento delle forme e dei testi, il
//   contorno, il colore di un tratto a penna, anche ereditati da un gruppo o
//   da un livello, o il nero di SVG dove nessuno scrive un riempimento. Un
//   testo conta una volta per colore, anche se lo scrivono più parole.
//   Contano anche le forme dei motivi e dei marcatori, che dipingono chi li
//   usa; non i punti delle sfumature, che sono colori della sfumatura, né il
//   contenuto dei ritagli e delle maschere, dove un colore non si vede come
//   colore.
// - **Si cambia dove il colore è scritto:** l'attributo dell'oggetto, o del
//   gruppo o del livello da cui lo eredita. Dove nessuno lo scrive, o lo
//   scrive la radice, che le operazioni non cambiano, si scrive
//   sull'oggetto. Un oggetto bloccato, o in un gruppo o in un livello
//   bloccato, resta com'è, e così un elemento estraneo e un foglio di stile:
//   cambiano colore col campione che usano, ma tengono il ripiego che
//   avevano. Anche una campitura resta com'è: i suoi colori li dice
//   `fub:pattern`, e si cambiano nella sua sezione.
// - **Le righe e le parole di un testo** non usano campioni, perché il
//   formato non dà loro riferimenti: un testo usa un campione intero, e le
//   parole che scrivono un colore loro lo tengono.
// - **Eliminare un campione** riporta chi lo usa al suo colore, scritto,
//   così che niente cambi a vederlo, e lo toglie; se lo usa ancora qualcuno
//   che non si riscrive, il campione resta come risorsa condivisa e senza
//   nome, che se ne va col suo ultimo uso.
// - **Mille oggetti** si leggono una volta sola: ciò che un nodo scrive si
//   rilegge soltanto quando cambia.

import { Context, WHITE, type Role } from "../scene/analysis";
import { elementChildren, readHead, writtenOf, type ContainerNode, type DocumentModel, type ElementPart, type LeafNode } from "../scene/model";
import type { Elem } from "../scene/serialize";
import { paint, type Paint, type Rgb } from "../scene/values";
import { NS_SVG, SVG_NS } from "../scene/xml";
import { t } from "../strings";
import { elemOf, plainAttributes, type Arranged } from "./arrange";
import { hatchOf } from "./hatches";
import { FILLED, INKED, OUTLINED, paintText } from "./look";
import { cleanName, NAME_MAX, nameKey } from "./naming";
import { customColor } from "./palette";
import { richOf, visibleSpans, type Rich } from "./rich";

/// Un campione del documento, come lo mostra il pannello.
export interface DocumentSwatch {
  readonly id: string;
  /// Il nome, con gli spazi raccolti da [`cleanName`].
  readonly name: string;
  /// `#rrggbb` minuscolo.
  readonly color: string;
  /// Il percorso del suo `stop`, per un `set` con `part`.
  readonly stop: readonly number[];
  /// Quanti elementi lo mostrano.
  readonly uses: number;
}

/// Un colore che il disegno usa scritto, e non per campione.
export interface UsedColor {
  /// `#rrggbb` minuscolo.
  readonly color: string;
  /// Quanti elementi lo mostrano.
  readonly uses: number;
}

/// I colori del documento.
export interface DocumentColors {
  /// Nell'ordine del documento.
  readonly swatches: readonly DocumentSwatch[];
  /// Dal più usato, e a parità nell'ordine del documento; al più
  /// [`USED_MAX`].
  readonly used: readonly UsedColor[];
  /// Quanti colori usati restano fuori da `used`.
  readonly hidden: number;
}

/// I colori usati che si mostrano al più: quelli di un disegno, non di una
/// fotografia ricalcata.
export const USED_MAX = 48;

/// Un comando dei colori pronto: le operazioni, e le chiavi della selezione
/// dopo, che resta la stessa.
export interface SwatchChange extends Arranged {
  /// Quanti elementi tengono il colore scritto, o il campione: bloccati,
  /// parole di un testo, elementi che un'operazione non riscrive.
  readonly kept: number;
}

type Channel = "fill" | "stroke";

const CHANNELS: readonly Channel[] = ["fill", "stroke"];

/// Il valore di SVG dove nessuno ne scrive uno.
const INITIAL: Readonly<Record<Channel, string>> = { fill: "#000000", stroke: "none" };

/// I figli della radice che non sono disegno.
const NOT_DRAWN: ReadonlySet<Role> = new Set(["title", "desc", "paper", "board", "resource"]);

/// Le risorse che hanno forme dentro: vero se dipingono chi le usa, come un
/// motivo o un marcatore, falso se il colore non si vede, come in un
/// ritaglio o in una maschera.
const CONTENT: ReadonlyMap<string, boolean> = new Map([
  ["pattern", true],
  ["marker", true],
  ["clipPath", false],
  ["mask", false],
]);

/// Ciò che mostrano le forme dentro una risorsa, come fra gli oggetti.
const CONTENT_FILLED: ReadonlySet<string> = new Set(["path", "rect", "ellipse", "circle", "polyline", "polygon"]);
const CONTENT_OUTLINED: ReadonlySet<string> = new Set(["path", "rect", "ellipse", "circle", "line", "polyline", "polygon"]);

/// Un attributo `fill` o `stroke` scritto.
interface Site {
  /// L'elemento che lo porta, o la risorsa che ne contiene la parte.
  readonly node: ElementPart;
  /// La parte della risorsa, per un `set` con `part`; `null` per
  /// l'elemento stesso.
  readonly part: readonly number[] | null;
  readonly name: Channel;
  readonly value: string;
  /// Vero se un'operazione lo può cambiare.
  readonly free: boolean;
  /// Falso nel contenuto di un ritaglio o di una maschera.
  readonly paints: boolean;
}

/// Un elemento che mostra un colore, e da dove lo prende.
interface Use {
  /// Lo stesso numero per gli usi dello stesso elemento.
  readonly element: number;
  readonly node: ElementPart;
  readonly part: readonly number[] | null;
  readonly name: Channel;
  /// Come lo legge il pannello: `#rrggbb`, o `url(#id)` per una risorsa.
  readonly value: string;
  /// L'attributo che lo scrive, suo o di chi lo contiene; `"piece"` se lo
  /// scrive una riga o una parola di un testo; `null` se nessuno, ed è il
  /// valore di SVG.
  readonly source: Site | "piece" | null;
  /// Vero se un'operazione può scrivere sull'elemento.
  readonly free: boolean;
  /// Vero per un oggetto del disegno, falso per una forma di un motivo o
  /// di un marcatore.
  readonly object: boolean;
}

/// Chi scrive ciò che un elemento eredita.
type Paints = Readonly<Record<Channel, Site | null>>;

const UNWRITTEN: Paints = { fill: null, stroke: null };

// ---------------------------------------------------------------------------
// Leggere.
// ---------------------------------------------------------------------------

const heads = new WeakMap<ElementPart, { readonly written: string; readonly attrs: ReadonlyMap<string, string> }>();

/// Gli attributi senza namespace di `node`, letti una volta finché non
/// cambiano.
function attrsOf(node: ElementPart): ReadonlyMap<string, string> {
  const known = heads.get(node);
  const written = writtenOf(node);
  if (known !== undefined && known.written === written) return known.attrs;
  const attrs = plainAttributes(node);
  heads.set(node, { written, attrs });
  return attrs;
}

const elems = new WeakMap<LeafNode, Elem | null>();

/// L'unità `node` come la scrive un'operazione, letta una volta: un'unità
/// che cambia è un nodo nuovo.
function cachedElem(node: LeafNode): Elem | null {
  let elem = elems.get(node);
  if (elem === undefined) {
    elem = elemOf(node);
    elems.set(node, elem);
  }
  return elem;
}

const riches = new WeakMap<Elem, Rich>();

/// Il testo `elem` con le righe e le parole, senza ciò che eredita.
function cachedRich(elem: Elem): Rich {
  let rich = riches.get(elem);
  if (rich === undefined) {
    rich = richOf(elem, {});
    riches.set(elem, rich);
  }
  return rich;
}

/// Il percorso dello `stop` del campione `node`; `null` se non si legge.
function stopOf(node: LeafNode): number[] | null {
  const read = readHead(node);
  if (read === null) return null;
  const { doc, element } = read;
  const inner = element.children.filter((child) => doc.element(child) !== null);
  const at = inner.findIndex((child) => {
    const stop = doc.element(child)!;
    return stop.ns === NS_SVG && stop.local === "stop";
  });
  return at < 0 ? null : [at];
}

/// Il campione `node`, una risorsa di una `defs` della radice, se si legge
/// come campione.
function swatchIn(node: ElementPart): Omit<DocumentSwatch, "uses"> | null {
  const id = node.facts.id;
  const swatch = node.details?.role === "resource" ? node.details.swatch : undefined;
  if (node.kind !== "leaf" || id === null || swatch === undefined) return null;
  const stop = stopOf(node);
  return stop === null ? null : { id, name: cleanName(swatch.name), color: swatch.color, stop };
}

/// Le `defs` della radice, dove stanno le risorse.
function rootDefs(model: DocumentModel): ContainerNode[] {
  return elementChildren(model.root).filter((child): child is ContainerNode => child.kind === "container" && child.details?.role === "defs");
}

/// I colori che un oggetto mostra, uno per colore, coi colori ereditati con
/// cui si sono letti: finché lui e loro restano, si contano senza rileggerlo.
const shownBy = new WeakMap<LeafNode, { readonly fill: string | undefined; readonly stroke: string | undefined; readonly values: readonly string[] }>();

/// I valori di `uses` da `start` in poi, uno per valore, nell'ordine.
function valuesFrom(uses: readonly Use[], start: number): string[] {
  const out: string[] = [];
  for (let k = start; k < uses.length; k++) {
    const value = uses[k]!.value;
    if (!out.includes(value)) out.push(value);
  }
  return out;
}

/// Ciò che il disegno scrive e mostra, in ordine di documento.
class Walk {
  readonly sites: Site[] = [];
  readonly uses: Use[] = [];
  readonly swatches: Array<Omit<DocumentSwatch, "uses">> = [];
  /// Con `counting`, i colori che mostra ogni elemento, uno per colore e in
  /// ordine di documento, al posto di `sites` e `uses` degli oggetti: ciò che
  /// serve a contarli. `null` altrimenti.
  readonly shown: Array<readonly string[]> | null;
  private elements = 0;

  constructor(
    readonly model: DocumentModel,
    counting = false,
  ) {
    this.shown = counting ? [] : null;
    const root = model.root;
    // La radice non si cambia: ciò che scrive resta.
    const attrs = attrsOf(root);
    this.children(root, this.written(root, null, (name) => attrs.get(name), false, true, UNWRITTEN), false);
  }

  /// I figli di `container`, che ereditano `from`; `locked` se lui o chi lo
  /// contiene è bloccato.
  private children(container: ContainerNode, from: Paints, locked: boolean): void {
    for (const child of elementChildren(container)) {
      const details = child.details;
      if (details === null) continue;
      if (details.role === "defs") {
        if (child.kind === "container" && container === this.model.root) this.resources(child, from);
        continue;
      }
      if (NOT_DRAWN.has(details.role)) continue;
      if (this.shown !== null && child.kind === "leaf") {
        this.count(child, details.role, from);
        continue;
      }
      const fixed = locked || details.locked === true;
      const attrs = attrsOf(child);
      const paints = this.written(child, null, (name) => attrs.get(name), !fixed, true, from);
      if (child.kind === "container") this.children(child, paints, fixed);
      else this.object(child, details.role, paints, !fixed);
    }
  }

  /// Conta i colori che l'oggetto `node` mostra, ereditando `from`.
  private count(node: LeafNode, role: Role, from: Paints): void {
    const fill = from.fill?.value;
    const stroke = from.stroke?.value;
    let known = shownBy.get(node);
    if (known !== undefined && known.fill === fill && known.stroke === stroke) {
      this.elements++;
    } else {
      const sites = this.sites.length;
      const uses = this.uses.length;
      const attrs = attrsOf(node);
      this.object(node, role, this.written(node, null, (name) => attrs.get(name), true, true, from), true);
      known = { fill, stroke, values: valuesFrom(this.uses, uses) };
      shownBy.set(node, known);
      this.sites.length = sites;
      this.uses.length = uses;
    }
    this.shown!.push(known.values);
  }

  private object(node: LeafNode, role: Role, paints: Paints, free: boolean): void {
    const element = this.elements++;
    if (role === "text") {
      const elem = cachedElem(node);
      this.text(element, node, null, elem === null ? null : cachedRich(elem), paints, free, true);
      return;
    }
    if (FILLED.has(role) || INKED.has(role)) this.show(element, node, null, "fill", paints, free, true);
    if (OUTLINED.has(role)) this.show(element, node, null, "stroke", paints, free, true);
  }

  /// Le risorse di una `defs` della radice: i campioni, e il contenuto dei
  /// motivi, dei marcatori, dei ritagli e delle maschere, che eredita dalla
  /// radice.
  private resources(defs: ContainerNode, from: Paints): void {
    for (const node of elementChildren(defs)) {
      if (node.kind !== "leaf" || node.details?.role !== "resource" || node.facts.id === null) continue;
      if (node.details.swatch !== undefined) {
        const swatch = swatchIn(node);
        if (swatch !== null) this.swatches.push(swatch);
        continue;
      }
      const paints = node.facts.uri === SVG_NS ? CONTENT.get(node.facts.local) : undefined;
      const elem = paints === undefined ? null : cachedElem(node);
      if (elem !== null) this.content(node, elem.children ?? [], [], from, paints!, hatchOf(node) === null);
    }
  }

  /// Le parti `children` della risorsa `node`, dal percorso `path`; `free`
  /// se un'operazione le può cambiare.
  private content(node: LeafNode, children: readonly Elem[], path: readonly number[], from: Paints, paints: boolean, free: boolean): void {
    children.forEach((child, index) => {
      if (child.tag === "title" || child.tag === "desc") return;
      const part = [...path, index];
      const inner = this.written(node, part, (name) => child.attrs[name], free, paints, from);
      if (child.tag === "g") {
        this.content(node, child.children ?? [], part, inner, paints, free);
        return;
      }
      if (!paints) return;
      const element = this.elements++;
      const start = this.uses.length;
      if (child.tag === "text") this.text(element, node, part, cachedRich(child), inner, free, false);
      if (CONTENT_FILLED.has(child.tag)) this.show(element, node, part, "fill", inner, free, false);
      if (CONTENT_OUTLINED.has(child.tag)) this.show(element, node, part, "stroke", inner, free, false);
      this.shown?.push(valuesFrom(this.uses, start));
    });
  }

  /// Un testo: i colori delle sue lettere, quello del testo dove una riga o
  /// una parola non ne scrive uno suo.
  private text(element: number, node: ElementPart, part: readonly number[] | null, rich: Rich | null, paints: Paints, free: boolean, object: boolean): void {
    const spans = rich === null ? [] : visibleSpans(rich);
    let whole = spans.length === 0;
    const pieces = new Set<string>();
    for (const { line, span } of spans) {
      const written = span.attrs?.fill ?? line.attrs.fill;
      if (written === undefined) whole = true;
      else pieces.add(paintText(written));
    }
    if (whole) this.show(element, node, part, "fill", paints, free, object);
    for (const value of pieces) {
      if (value !== "none") this.uses.push({ element, node, part, name: "fill", value, source: "piece", free, object });
    }
  }

  /// L'elemento mostra in `name` ciò che gli passa `paints`.
  private show(element: number, node: ElementPart, part: readonly number[] | null, name: Channel, paints: Paints, free: boolean, object: boolean): void {
    const site = paints[name];
    const value = paintText(site?.value ?? INITIAL[name]);
    if (value !== "none") this.uses.push({ element, node, part, name, value, source: site, free, object });
  }

  /// I colori che l'elemento scrive, letti da `read`, e ciò che passa a chi
  /// contiene.
  private written(node: ElementPart, part: readonly number[] | null, read: (name: string) => string | undefined, free: boolean, paints: boolean, from: Paints): Paints {
    let out: Record<Channel, Site | null> | null = null;
    for (const name of CHANNELS) {
      const value = read(name);
      if (value === undefined) continue;
      const site: Site = { node, part, name, value, free, paints };
      this.sites.push(site);
      out ??= { ...from };
      out[name] = site;
    }
    return out ?? from;
  }
}

/// I colori di `model`: i campioni, e i colori che il disegno usa scritti.
export function documentColors(model: DocumentModel): DocumentColors {
  const walk = new Walk(model, true);
  // Quanti elementi mostrano ogni colore.
  const shown = new Map<string, number>();
  for (const values of walk.shown!) {
    for (const value of values) shown.set(value, (shown.get(value) ?? 0) + 1);
  }
  const swatches = walk.swatches.map((swatch) => ({ ...swatch, uses: shown.get(`url(#${swatch.id})`) ?? 0 }));
  // Nell'ordine del documento, poi dal più usato: `sort` tiene l'ordine a
  // parità.
  const used = [...shown].filter(([value]) => value.startsWith("#")).map(([color, uses]) => ({ color, uses }));
  used.sort((a, b) => b.uses - a.uses);
  return { swatches, used: used.slice(0, USED_MAX), hidden: Math.max(0, used.length - USED_MAX) };
}

/// I campioni di `model` senza contare chi li usa, gli stessi e nello
/// stesso ordine di [`documentColors`]: per il campo di un colore, che li
/// scrive per nome.
export function documentSwatches(model: DocumentModel): Array<Omit<DocumentSwatch, "uses">> {
  const out: Array<Omit<DocumentSwatch, "uses">> = [];
  for (const defs of rootDefs(model)) {
    for (const node of elementChildren(defs)) {
      const swatch = swatchIn(node);
      if (swatch !== null) out.push(swatch);
    }
  }
  return out;
}

/// Il colore della prima carta del disegno sul bianco della superficie,
/// `#rrggbb`, come lo legge la verifica del contrasto: col riempimento che
/// eredita dalla radice e la sua opacità, il bianco se non c'è o non si
/// vede; `null` se non si sa, come sotto un filtro.
export function paperColor(model: DocumentModel): string | null {
  // Il colore dei campioni, come lo legge la verifica: il primo id vale.
  const swatches = new Map<string, Rgb>();
  for (const defs of rootDefs(model)) {
    for (const node of elementChildren(defs)) {
      const id = node.facts.id;
      const swatch = node.details?.role === "resource" ? node.details.swatch : undefined;
      const color = swatch === undefined ? null : paint(swatch.color);
      if (id !== null && color !== null && color !== "none" && !swatches.has(id)) swatches.set(id, color);
    }
  }
  const root = model.root;
  const context = Context.rootOf((name) => attrsOf(root).get(name), swatches);
  for (const child of elementChildren(root)) {
    if (child.details?.role !== "paper") continue;
    const color = context.childOf((name) => attrsOf(child).get(name)).paperColor();
    return color === null ? null : hexOf(color);
  }
  return hexOf(WHITE);
}

// ---------------------------------------------------------------------------
// I nomi.
// ---------------------------------------------------------------------------

/// Un campione col suo nome, per i nomi: basta l'id e il nome.
type Named = Pick<DocumentSwatch, "id" | "name">;

/// Il problema del nome `name`, già pulito da [`cleanName`], per un
/// campione: vuoto; un colore, che il campo del colore leggerebbe come
/// tale, un codice `#` o «nessuno», e che dopo un cambio di colore direbbe
/// il falso; o di un altro campione. `except` è il campione che si
/// rinomina.
export function swatchNameProblem(swatches: readonly Named[], name: string, except: string | null = null): "empty" | "color" | "taken" | null {
  if (name === "") return "empty";
  const key = nameKey(name);
  if (key === "none" || key === t("draw.properties.none").toLocaleLowerCase() || (name.startsWith("#") && customColor(name) !== null)) return "color";
  return swatches.some((swatch) => swatch.id !== except && nameKey(swatch.name) === key) ? "taken" : null;
}

/// Il primo nome libero da `base`, che non è vuoto: lui, poi `base 2`,
/// `base 3` e così via, entro [`NAME_MAX`] caratteri.
export function freshSwatchName(swatches: readonly Named[], base: string): string {
  const clean = cleanName(base);
  if (swatchNameProblem(swatches, clean) === null) return clean;
  const chars = Array.from(clean);
  for (let n = 2; ; n++) {
    const suffix = ` ${n}`;
    const room = NAME_MAX - suffix.length;
    const name = `${chars.length <= room ? clean : chars.slice(0, room).join("").trimEnd()}${suffix}`;
    if (swatchNameProblem(swatches, name) === null) return name;
  }
}

// ---------------------------------------------------------------------------
// Scrivere.
// ---------------------------------------------------------------------------

/// Il colore `#rrggbb` di un ripiego; `null` per `none`.
function hexOf(value: Paint): string | null {
  return value === "none" ? null : `#${value.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
}
