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
//   avevano.
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
import { elementChildren, writtenOf, type ContainerNode, type DocumentModel, type ElementPart, type LeafNode } from "../scene/model";
import type { Elem } from "../scene/serialize";
import { paint, paintReference, type Paint, type Rgb } from "../scene/values";
import { NS_SVG, SVG_NS } from "../scene/xml";
import { t } from "../strings";
import { elemOf, plainAttributes, Plan, readHead, type Arranged } from "./arrange";
import type { NewIds } from "./edit";
import type { SceneIndex, Unit } from "./hit";
import { FILLED, INKED, OUTLINED, paintText } from "./look";
import { cleanName, NAME_MAX, nameKey } from "./naming";
import { customColor } from "./palette";
import { homeOf, resourcesOf } from "./resources";
import { richOf, visibleSpans, type Rich } from "./rich";
import { allUnits } from "./selecting";

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

/// Ciò che il disegno scrive e mostra, in ordine di documento.
class Walk {
  readonly sites: Site[] = [];
  readonly uses: Use[] = [];
  readonly swatches: Array<Omit<DocumentSwatch, "uses">> = [];
  private elements = 0;

  constructor(readonly model: DocumentModel) {
    const root = model.root;
    // La radice non si cambia: ciò che scrive resta.
    this.children(root, this.written(root, null, (name) => attrsOf(root).get(name), false, true, UNWRITTEN), false);
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
      const fixed = locked || details.locked === true;
      const paints = this.written(child, null, (name) => attrsOf(child).get(name), !fixed, true, from);
      if (child.kind === "container") this.children(child, paints, fixed);
      else this.object(child, details.role, paints, !fixed);
    }
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
      if (elem !== null) this.content(node, elem.children ?? [], [], from, paints!);
    }
  }

  /// Le parti `children` della risorsa `node`, dal percorso `path`.
  private content(node: LeafNode, children: readonly Elem[], path: readonly number[], from: Paints, paints: boolean): void {
    children.forEach((child, index) => {
      if (child.tag === "title" || child.tag === "desc") return;
      const part = [...path, index];
      const inner = this.written(node, part, (name) => child.attrs[name], true, paints, from);
      if (child.tag === "g") {
        this.content(node, child.children ?? [], part, inner, paints);
        return;
      }
      if (!paints) return;
      const element = this.elements++;
      if (child.tag === "text") this.text(element, node, part, cachedRich(child), inner, true, false);
      if (CONTENT_FILLED.has(child.tag)) this.show(element, node, part, "fill", inner, true, false);
      if (CONTENT_OUTLINED.has(child.tag)) this.show(element, node, part, "stroke", inner, true, false);
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
  const walk = new Walk(model);
  const shown = new Map<string, Set<number>>();
  for (const use of walk.uses) {
    let elements = shown.get(use.value);
    if (elements === undefined) shown.set(use.value, (elements = new Set()));
    elements.add(use.element);
  }
  const swatches = walk.swatches.map((swatch) => ({ ...swatch, uses: shown.get(`url(#${swatch.id})`)?.size ?? 0 }));
  // Nell'ordine del documento, poi dal più usato: `sort` tiene l'ordine a
  // parità.
  const used = [...shown].filter(([value]) => value.startsWith("#")).map(([color, elements]) => ({ color, uses: elements.size }));
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

/// Gli oggetti che si scelgono e che mostrano `value`, un colore `#rrggbb` o
/// un campione `url(#id)`: a ogni profondità, in ordine di documento.
export function unitsShowing(model: DocumentModel, index: SceneIndex, value: string): Unit[] {
  const showing = new Set<ElementPart>();
  for (const use of new Walk(model).uses) if (use.object && use.value === value) showing.add(use.node);
  return allUnits(index).filter((unit) => showing.has(unit.node));
}

/// Il valore che usa il campione `swatch`, col suo colore come ripiego.
export function swatchPaint(swatch: { readonly id: string; readonly color: string }): string {
  return `url(#${swatch.id}) ${swatch.color}`;
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

/// Gli attributi da scrivere, elemento per elemento e parte per parte: un
/// `set` ciascuno.
class Writes {
  private readonly targets = new Map<ElementPart, Map<string, { readonly part: readonly number[] | null; readonly attrs: Record<string, string> }>>();

  write(node: ElementPart, part: readonly number[] | null, name: Channel, value: string): void {
    let parts = this.targets.get(node);
    if (parts === undefined) this.targets.set(node, (parts = new Map()));
    const key = part === null ? "" : part.join(".");
    let target = parts.get(key);
    if (target === undefined) parts.set(key, (target = { part, attrs: {} }));
    target.attrs[name] = value;
  }

  /// I `set`, dopo ciò che `plan` ha già.
  into(plan: Plan): void {
    for (const [node, parts] of this.targets) {
      for (const { part, attrs } of parts.values()) {
        if (part === null) plan.ops.push({ op: "set", id: plan.idOf(node, node.details?.role === "layer" ? "layer" : "object"), attrs });
        else plan.ops.push({ op: "set", id: node.facts.id!, part, attrs });
      }
    }
  }
}

/// Le operazioni di `plan`, con le chiavi di `units` dopo.
function finish(plan: Plan, units: readonly Unit[], kept: number): SwatchChange {
  return { ...plan.finish(units.map((unit) => plan.keyOf(unit.node, unit.key))), kept };
}

/// Il colore `#rrggbb` di un ripiego; `null` per `none`.
function hexOf(value: Paint): string | null {
  return value === "none" ? null : `#${value.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
}

/// Un campione nuovo: una sfumatura con un punto solo, nello spazio d'uso,
/// così che colori anche una linea orizzontale, che non ha altezza.
function swatchElem(id: string, name: string, color: string): Elem {
  return {
    tag: "linearGradient",
    attrs: { id, "fub:role": "swatch", "fub:name": name, gradientUnits: "userSpaceOnUse" },
    children: [{ tag: "stop", attrs: { "stop-color": color } }],
  };
}

/// Fa usare il campione `id` a chi usa `color` scritto: negli attributi che
/// lo scrivono e, dove nessuno lo scrive o lo scrive la radice,
/// sull'elemento che lo mostra. Torna quanti elementi lo tengono scritto.
function linkTo(plan: Plan, walk: Walk, id: string, color: string): number {
  const value = swatchPaint({ id, color });
  const writes = new Writes();
  for (const site of walk.sites) {
    if (site.free && site.paints && paintText(site.value) === color) writes.write(site.node, site.part, site.name, value);
  }
  const kept = new Set<number>();
  for (const use of walk.uses) {
    if (use.value !== color) continue;
    const source = use.source;
    if (source !== null && source !== "piece" && source.free) continue;
    const unwritten = source === null || (source !== "piece" && source.node === walk.model.root);
    if (unwritten && use.free) writes.write(use.node, use.part, use.name, value);
    else kept.add(use.element);
  }
  writes.into(plan);
  return kept.size;
}

/// Le operazioni che fanno il campione `name`, già pulito, del colore
/// `color`, `#rrggbb` minuscolo: nasce in fondo alle risorse e, se `link`,
/// chi usa `color` scritto passa a lui. `id` è il suo.
export function newSwatchOps(model: DocumentModel, color: string, name: string, link: boolean, units: readonly Unit[], ids: NewIds): SwatchChange & { readonly id: string } {
  const plan = new Plan(model, ids);
  const id = ids.next("resource");
  const home = homeOf(model);
  plan.ops.push(...home.prelude, { op: "add", parent: home.parent, pos: { last: true }, elem: swatchElem(id, name, color) });
  const kept = link ? linkTo(plan, new Walk(model), id, color) : 0;
  return { ...finish(plan, units, kept), id };
}

/// Le operazioni che fanno usare il campione `id` a chi usa il suo colore
/// scritto.
export function linkSwatchOps(model: DocumentModel, id: string, units: readonly Unit[], ids: NewIds): SwatchChange {
  const walk = new Walk(model);
  const swatch = walk.swatches.find((each) => each.id === id);
  const plan = new Plan(model, ids);
  return finish(plan, units, swatch === undefined ? 0 : linkTo(plan, walk, id, swatch.color));
}

/// Le operazioni che danno al campione `id` il colore `color`, `#rrggbb`
/// minuscolo: il suo punto e il ripiego di chi lo usa, in un passo. Chi non
/// si riscrive cambia colore col campione, e tiene il ripiego, che si vede
/// soltanto dove il campione non si legge.
export function recolorSwatchOps(model: DocumentModel, id: string, color: string, units: readonly Unit[], ids: NewIds): Arranged {
  const walk = new Walk(model);
  const swatch = walk.swatches.find((each) => each.id === id);
  const plan = new Plan(model, ids);
  if (swatch === undefined) return finish(plan, units, 0);
  if (swatch.color !== color) plan.ops.push({ op: "set", id, part: swatch.stop, attrs: { "stop-color": color } });
  const writes = new Writes();
  for (const site of walk.sites) {
    const used = paintReference(site.value);
    if (used?.id !== id || !site.free || (used.fallback !== null && hexOf(used.fallback) === color)) continue;
    writes.write(site.node, site.part, site.name, swatchPaint({ id, color }));
  }
  writes.into(plan);
  return finish(plan, units, 0);
}

/// Le operazioni che danno al campione `id` il nome `name`, già pulito e
/// libero; nessuna se è lo stesso.
export function renameSwatchOps(model: DocumentModel, id: string, name: string, units: readonly Unit[], ids: NewIds): SwatchChange {
  const plan = new Plan(model, ids);
  const swatch = resourcesOf(model).get(id)?.details?.swatch;
  if (swatch !== undefined && swatch.name !== name) plan.ops.push({ op: "set", id, attrs: { "fub:name": name } });
  return finish(plan, units, 0);
}

/// Le operazioni che tolgono il campione `id`: chi lo usa torna al suo
/// colore, scritto, e il campione se ne va. Se lo usa ancora qualcuno che
/// non si riscrive, resta come risorsa condivisa e senza nome, e `kept`
/// dice quanti sono.
export function removeSwatchOps(model: DocumentModel, id: string, units: readonly Unit[], ids: NewIds): SwatchChange {
  const walk = new Walk(model);
  const swatch = walk.swatches.find((each) => each.id === id);
  const plan = new Plan(model, ids);
  if (swatch === undefined) return finish(plan, units, 0);
  const writes = new Writes();
  // Chi lo usa, e se tutto ciò che in lui lo usa si riscrive.
  const owners = new Map<ElementPart, boolean>();
  for (const site of walk.sites) {
    if (paintReference(site.value)?.id !== id) continue;
    owners.set(site.node, (owners.get(site.node) ?? true) && site.free);
    if (site.free) writes.write(site.node, site.part, site.name, swatch.color);
  }
  writes.into(plan);
  const kept = referrers(model, id).filter((node) => owners.get(node) !== true).length;
  plan.ops.push(kept === 0 ? { op: "remove", target: id } : { op: "set", id, attrs: { "fub:role": "shared", "fub:name": null } });
  return finish(plan, units, kept);
}

/// Gli elementi che rimandano a `id`: un contenitore coi suoi attributi,
/// un'unità con tutto ciò che contiene, fogli di stile compresi.
function referrers(model: DocumentModel, id: string): ElementPart[] {
  const out: ElementPart[] = [];
  const visit = (node: ElementPart): void => {
    if (node.kind === "leaf") {
      if (node.refs.includes(id)) out.push(node);
      return;
    }
    if (node.facts.refs.includes(id)) out.push(node);
    for (const child of elementChildren(node)) visit(child);
  };
  visit(model.root);
  return out;
}
