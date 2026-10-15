// Le maschere (livello Esperto): il ritaglio di un oggetto con un altro, la
// maschera d'opacità, e il rilascio di entrambi (formato della scena,
// risorse). Ogni comando diventa un `batch` solo, che un annulla disfa
// intero.
//
// - **Chi ritaglia.** L'oggetto più alto fra quelli scelti ritaglia gli
//   altri: questi entrano in un gruppo nuovo, come li metterebbe «Raggruppa»,
//   e la forma lascia il disegno per diventare il contenuto di una risorsa
//   privata, un `clipPath` o una `mask`, a cui il gruppo rimanda. La
//   risorsa vive nelle coordinate del gruppo: la forma ci entra con la
//   trasformazione che la lascia dov'era.
// - **Ciò che il contenuto porta.** Il contenuto non ha id, così copiare,
//   duplicare e rilasciare non ne urtano mai. Lo stile che la forma
//   ereditava dai suoi contenitori, e che non scrive da sé, lo scrive il
//   contenuto: la risorsa non eredita niente da chi la usa, e rilasciarla
//   rende lo stesso aspetto; un ritaglio scrive anche il nero che SVG dà a
//   chi non ha riempimento. Un ritaglio ignora il colore: i motivi diventano
//   il loro ripiego e le punte se ne vanno, perché renderebbero la risorsa
//   estranea. In una maschera d'opacità i motivi, le punte e ogni ritaglio,
//   maschera o filtro cambierebbero ciò che la maschera fa, e non si
//   accettano.
// - **I contenitori che il contenuto lascia.** Gli antenati della forma che
//   il gruppo nuovo non ha restano dov'erano, senza di lei: la loro opacità
//   la porta il contenuto di una maschera d'opacità (un ritaglio guarda solo
//   la geometria), e un ritaglio, una maschera, un filtro o `display: none`
//   che avevano non si possono portare, e la maschera non si crea. Gli altri
//   oggetti entrano nel gruppo come con «Raggruppa»: prendono ciò che il
//   gruppo nuovo dà, e un contenitore che resta vuoto resta.
// - **La regione di una maschera d'opacità** è il posto dove il contenuto
//   può disegnare, nello spazio del gruppo, per eccesso: fuori da ciò che
//   disegna la luminanza è zero comunque, e una regione più grande non costa
//   niente, mentre una più piccola taglierebbe il contorno e il testo.
// - **Rilasciare** riporta il contenuto fra gli oggetti, subito sopra chi
//   lo usava: prima quello della maschera, poi quello del ritaglio. Ogni
//   pezzo ha id nuovi e la trasformazione di chi lo usava, con quella
//   dell'unità della risorsa (il riquadro di chi la usa, per
//   `objectBoundingBox`) e la sua. Un pezzo di ritaglio senza riempimento
//   non ne ha: SVG lo riempirebbe di nero, e un tracciato di ritaglio
//   rilasciato non ha colore. Un gruppo che dopo non ha più niente di suo
//   si separa, come con «Separa». Con `objectBoundingBox` il riquadro deve
//   essere esatto: se dipende da un testo o da parti di un altro programma
//   il rilascio non si fa. I pezzi tengono lo stile che avevano nella
//   risorsa, non quello dei contenitori in cui entrano.
// - **Un disegno con un foglio di stile.** Le regole scelgono per id, per
//   posizione e per antenato: la forma che entra in una risorsa, o il pezzo
//   che ne esce, cambia posto e potrebbe cambiare aspetto. `keepCarried` di
//   `styled.ts` confronta con la cascata ogni copia col suo originale, le
//   scrive sopra ciò che le manca, o il comando non si fa.

import { formatNumber } from "../number";
import { BoundsBuilder, type Bounds } from "../scene/geometry";
import { apply, compose, IDENTITY, invert, type Matrix } from "../scene/matrix";
import { elementChildren, type ContainerNode, type DocumentModel, type ElementPart, type LeafNode } from "../scene/model";
import type { AddOp, Op } from "../scene/ops";
import type { Elem, Piece, Run } from "../scene/serialize";
import { length as svgLength, letterSpacing, number as svgNumber, opacity as svgOpacity, paintReference, reference, transform as parseTransform, trim, urlIds } from "../scene/values";
import { SVG_NS } from "../scene/xml";
import { elemOf, fubAttributes, INHERITED, isGroup, nodeOf, plainAttributes, Plan, renamed, unwrapIn, wrapIn, type Arranged } from "./arrange";
import { transformValue, type NewIds } from "./edit";
import { geometryBox, type Unit } from "./hit";
import { homeOf, paintCode, ResourceCopies, resourcesOf, usersOf } from "./resources";
import { keepCarried, refused, type Carried } from "./styled";

/// Perché una maschera non si crea: meno di due oggetti; quello più in alto
/// non è una forma o un testo (un'immagine, un gruppo, un collegamento, un
/// testo su tracciato); è una linea, che non ha area; porta ciò che una
/// maschera non contiene (un ritaglio, una maschera, un filtro, un motivo,
/// le punte per una maschera d'opacità, parti estranee); il livello del più
/// alto schiaccia il piano; un contenitore da cui la forma esce ha un
/// ritaglio, una maschera, un filtro o è nascosto; lo stile del disegno
/// farebbe vedere la forma diversa dentro la risorsa.
export type MaskRefusal = "few" | "top" | "line" | "content" | "plane" | "container" | "style";

/// Perché un rilascio non si fa: il riquadro di `objectBoundingBox` dipende
/// da un testo o da parti estranee e non si sa calcolare esatto; lo stile del
/// disegno farebbe vedere diversi i pezzi.
export type ReleaseRefusal = "box" | "style";

/// I ruoli che ritagliano: le forme, anche quelle di FubDraw, e il testo.
const CLIPPING: ReadonlySet<string> = new Set(["path", "rect", "ellipse", "circle", "polygon", "polyline", "arrow", "ngon", "star", "width", "stroke", "text"]);

/// I tag che una maschera d'opacità contiene: le forme, il testo e i gruppi
/// che li contengono; titolo, descrizione e righe di testo ci stanno dentro.
const MASKED: ReadonlySet<string> = new Set(["path", "rect", "ellipse", "circle", "line", "polyline", "polygon", "text", "tspan", "title", "desc", "g"]);

/// Gli attributi che mettono in gioco un'altra risorsa nelle coordinate di
/// chi li porta.
const EFFECTS: readonly string[] = ["clip-path", "mask", "filter"];

/// Quanti `g` si annidano al più nel contenuto di una maschera.
const MAX_DEPTH = 32;

const MARKERS: readonly string[] = ["marker-start", "marker-mid", "marker-end"];

const PAINTS = ["fill", "stroke"] as const;

/// I decimali dell'opacità che il contenuto porta, come li scrive il formato.
const OPACITY_PLACES = 4;

/// Un numero della geometria come lo scrive il file.
const place = (value: number): string => formatNumber(value, 2);

// ---------------------------------------------------------------------------
// Il contenuto.
// ---------------------------------------------------------------------------

/// Vero se `kind` di una risorsa è una sfumatura (un campione è una sfumatura).
const isGradient = (resource: LeafNode | undefined): boolean => resource !== undefined && (resource.facts.local === "linearGradient" || resource.facts.local === "radialGradient");

/// `elem` e ciò che contiene, a ogni livello, compresi i pezzi di una riga.
function everywhere(elem: Elem, visit: (each: Elem) => void): void {
  visit(elem);
  for (const child of elem.children ?? []) everywhere(child, visit);
}

/// Gli attributi di `elem` e dei pezzi delle sue righe.
function attrsIn(elem: Elem): Array<Readonly<Record<string, string>>> {
  const out = [elem.attrs];
  for (const run of elem.runs ?? []) if (typeof run !== "string") out.push(run.attrs);
  return out;
}

/// Il motivo per cui `elem`, il contenuto di una maschera d'opacità, non
/// c'è: "top" se contiene un'immagine, un collegamento, un testo su
/// tracciato o altro che una maschera non ha; "content" se porta punte,
/// motivi, ritagli, maschere o filtri, o annida troppi gruppi. `null` se va.
export function maskProblem(elem: Elem, resources: ReadonlyMap<string, LeafNode>): MaskRefusal | null {
  let problem: MaskRefusal | null = null;
  const note = (found: MaskRefusal): void => {
    if (problem !== "top") problem = found;
  };
  const walk = (each: Elem, depth: number): void => {
    if (!MASKED.has(each.tag)) {
      note("top");
      return;
    }
    if (each.tag === "g" && depth > MAX_DEPTH) note("content");
    for (const attrs of attrsIn(each)) {
      for (const name of EFFECTS) if (attrs[name] !== undefined && trim(attrs[name]!) !== "none") note("content");
      for (const name of MARKERS) if (attrs[name] !== undefined && trim(attrs[name]!) !== "none") note("content");
      for (const name of PAINTS) {
        const value = attrs[name];
        if (value === undefined || urlIds(value).length === 0) continue;
        const used = paintReference(value);
        if (used === null || !isGradient(resources.get(used.id))) note("content");
      }
    }
    for (const child of each.children ?? []) walk(child, depth + 1);
  };
  walk(elem, 1);
  return problem;
}

/// Vero se `elem` ha un testo su tracciato.
export function onPath(elem: Elem): boolean {
  let found = false;
  everywhere(elem, (each) => {
    if (each.tag === "textPath") found = true;
  });
  return found;
}

/// Lo stile che `node` eredita dai suoi contenitori, fino alla radice: per
/// ogni attributo di [`INHERITED`], il valore del contenitore più vicino che
/// lo scrive.
export function inheritedStyle(node: ElementPart): Map<string, string> {
  const out = new Map<string, string>();
  for (let at = node.parent; at !== null; at = at.parent) {
    const own = plainAttributes(at);
    for (const name of INHERITED) {
      const value = own.get(name);
      if (value !== undefined && !out.has(name) && trim(value) !== "inherit") out.set(name, value);
    }
  }
  return out;
}

/// `attrs` senza id e, per un ritaglio, senza punte; i colori che rimandano
/// a una risorsa che un ritaglio non contiene diventano il loro ripiego.
function cleanAttrs(attrs: Readonly<Record<string, string>>, clip: boolean, resources: ReadonlyMap<string, LeafNode>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(attrs)) {
    if (name === "id" || (clip && MARKERS.includes(name))) continue;
    if (clip && (name === "fill" || name === "stroke") && urlIds(value).length > 0) {
      const used = paintReference(value);
      out[name] = used !== null && isGradient(resources.get(used.id)) ? value : used?.fallback == null ? "none" : paintCode(used.fallback);
      continue;
    }
    out[name] = value;
  }
  return out;
}

/// `elem` come contenuto di una risorsa: senza id da cima a fondo, e per un
/// ritaglio pulito come [`cleanAttrs`].
export function contentOf(elem: Elem, clip: boolean, resources: ReadonlyMap<string, LeafNode>): Elem {
  const out: { tag: string; attrs: Record<string, string>; children?: Elem[]; text?: string | null; runs?: readonly Run[] } = { tag: elem.tag, attrs: cleanAttrs(elem.attrs, clip, resources) };
  if (elem.children !== undefined) out.children = elem.children.map((child) => contentOf(child, clip, resources));
  if (elem.text !== undefined) out.text = elem.text;
  if (elem.runs !== undefined) {
    out.runs = elem.runs.map((run): Run => (typeof run === "string" ? run : ({ text: run.text, attrs: cleanAttrs(run.attrs, clip, resources) } satisfies Piece)));
  }
  return out;
}

/// La forma `top` come contenuto della risorsa per un gruppo nello spazio di
/// `into`: con lo stile che ereditava, e la trasformazione che la tiene
/// dov'era. `fade` è l'opacità dei contenitori da cui esce, che la risorsa
/// non ha: il contenuto la porta con la sua.
function placed(top: Unit, into: Unit, elem: Elem, inherited: ReadonlyMap<string, string>, clip: boolean, resources: ReadonlyMap<string, LeafNode>, fade: number): Elem {
  const content = contentOf(elem, clip, resources);
  const attrs = content.attrs as Record<string, string>;
  delete attrs.transform;
  for (const [name, value] of inherited) {
    const own = attrs[name];
    if (own !== undefined && trim(own) !== "inherit") continue;
    attrs[name] = clip ? cleanAttrs({ [name]: value }, true, resources)[name]! : value;
  }
  for (const name of INHERITED) if (attrs[name] !== undefined && trim(attrs[name]!) === "inherit") delete attrs[name];
  // Senza riempimento la forma era nera, come vuole SVG: il ritaglio lo
  // scrive, perché un pezzo di ritaglio senza riempimento si rilascia senza.
  if (clip && attrs.fill === undefined) attrs.fill = "#000000";
  if (fade !== 1) attrs.opacity = formatNumber((svgOpacity(attrs.opacity ?? "1") ?? 1) * fade, OPACITY_PLACES);
  const value = transformValue(compose(invert(into.parent)!, top.matrix));
  if (value !== null) attrs.transform = value;
  return content;
}

/// I contenitori di `node` che il gruppo nuovo, che sta nel livello di
/// `beside`, non ha fra i suoi antenati: dal più vicino.
function containersBetween(node: ElementPart, beside: ElementPart): ContainerNode[] {
  const shared = new Set<ElementPart>();
  for (let at = beside.parent; at !== null; at = at.parent) shared.add(at);
  const out: ContainerNode[] = [];
  for (let at = node.parent; at !== null && !shared.has(at); at = at.parent) out.push(at);
  return out;
}

// ---------------------------------------------------------------------------
// La regione di una maschera d'opacità.
// ---------------------------------------------------------------------------

/// Lo stile di un elemento del contenuto che conta per quanto sporge: il
/// contorno e il testo, che passano dai gruppi ai figli.
interface Look {
  readonly stroke: boolean;
  readonly width: number;
  readonly join: string;
  readonly cap: string;
  readonly limit: number;
  readonly size: number;
  readonly spacing: number;
  readonly anchor: string;
}

/// Lo stile iniziale di SVG.
const LOOK: Look = { stroke: false, width: 1, join: "miter", cap: "butt", limit: 4, size: 16, spacing: 0, anchor: "start" };

const JOINS: readonly string[] = ["miter", "round", "bevel", "miter-clip", "arcs"];
const CAPS: readonly string[] = ["butt", "round", "square"];
const ANCHORS: readonly string[] = ["start", "middle", "end"];

/// Le forme, che hanno la loro geometria.
const SHAPES: ReadonlySet<string> = new Set(["path", "rect", "ellipse", "circle", "line", "polyline", "polygon"]);

/// Quanto sale sopra la linea di base e quanto scende sotto un carattere, in
/// corpi, e quanto è largo al più: tutti i caratteri che si usano stanno
/// dentro.
const RISE_EM = 1;
const DROP_EM = 0.35;
const ADVANCE_EM = 1;

/// Lo stile di `attrs` sopra quello `inherited` che il genitore passa. Un
/// valore che non si legge lo ignora il browser, e vale quello ereditato.
function lookOf(inherited: Look, attrs: Readonly<Record<string, string>>): Look {
  const given = (name: string): string | undefined => {
    const value = attrs[name];
    return value === undefined || trim(value) === "inherit" ? undefined : trim(value);
  };
  const stroke = given("stroke");
  const join = given("stroke-linejoin");
  const cap = given("stroke-linecap");
  const anchor = given("text-anchor");
  const width = given("stroke-width");
  const limit = given("stroke-miterlimit");
  const size = given("font-size");
  const spacing = given("letter-spacing");
  const w = width === undefined ? null : svgLength(width);
  const l = limit === undefined ? null : svgNumber(limit);
  const z = size === undefined ? null : svgLength(size);
  const sp = spacing === undefined ? null : letterSpacing(spacing);
  return {
    stroke: stroke === undefined ? inherited.stroke : stroke !== "none",
    width: w !== null && w >= 0 ? w : inherited.width,
    join: join !== undefined && JOINS.includes(join) ? join : inherited.join,
    cap: cap !== undefined && CAPS.includes(cap) ? cap : inherited.cap,
    limit: l !== null && l >= 1 ? l : inherited.limit,
    size: z !== null && z > 0 ? z : inherited.size,
    spacing: sp ?? inherited.spacing,
    anchor: anchor !== undefined && ANCHORS.includes(anchor) ? anchor : inherited.anchor,
  };
}

/// Di quanto il contorno esce dalla geometria di `tag`, nello spazio della
/// forma: metà larghezza, per le punte delle giunzioni a spigolo fino a
/// `miterlimit` volte (un rettangolo ha angoli retti, e l'ellisse niente
/// spigoli) e per i capi squadrati fino a √2 volte.
function outline(tag: string, look: Look): number {
  if (!look.stroke) return 0;
  let factor = look.cap === "square" ? Math.SQRT2 : 1;
  if (look.join !== "round" && look.join !== "bevel") {
    factor = Math.max(factor, tag === "rect" ? Math.SQRT2 : tag === "ellipse" || tag === "circle" || tag === "line" ? 1 : look.limit);
  }
  return (look.width / 2) * factor;
}

/// Il numero con cui `attrs` scrive `name`, o 0.
function coord(attrs: Readonly<Record<string, string>>, name: string): number {
  const value = attrs[name];
  return value === undefined ? 0 : (svgLength(value.trim().split(/[\s,]+/)[0]!) ?? 0);
}

/// I rettangoli, nello spazio del testo, dove `elem` disegna al più, con
/// quanto il contorno ne esce: ogni riga è larga al più un corpo per
/// carattere più la spaziatura delle lettere, sale di un corpo e scende di
/// 0,35 sotto la linea di base. Un testo in area ha anche il suo riquadro.
function textBoxes(elem: Elem, own: Look): Array<readonly [number, number, number, number, number]> {
  const out: Array<readonly [number, number, number, number, number]> = [];
  const x = coord(elem.attrs, "x");
  let y = coord(elem.attrs, "y");
  let top: number | null = null;
  let bottom = 0;
  let spread = outline("text", own);
  for (const line of elem.children ?? []) {
    if (line.tag !== "tspan") continue;
    const here = lookOf(own, line.attrs);
    if (line.attrs.y !== undefined) y = coord(line.attrs, "y");
    y += coord(line.attrs, "dy");
    const lineX = line.attrs.x === undefined ? x : coord(line.attrs, "x");
    const parts: Array<readonly [string, Look, number]> =
      line.runs === undefined
        ? [[line.text ?? "", here, 0]]
        : line.runs.map((run): readonly [string, Look, number] => (typeof run === "string" ? [run, here, 0] : [run.text, lookOf(here, run.attrs), Math.abs(coord(run.attrs, "dy"))]));
    let width = 0;
    let rise = RISE_EM * here.size;
    let drop = DROP_EM * here.size;
    let grow = outline("text", here);
    for (const [text, look, shift] of parts) {
      width += [...text].length * (ADVANCE_EM * look.size + Math.max(0, look.spacing));
      rise = Math.max(rise, RISE_EM * look.size + shift);
      drop = Math.max(drop, DROP_EM * look.size + shift);
      grow = Math.max(grow, outline("text", look));
    }
    spread = Math.max(spread, grow);
    top ??= y - rise;
    bottom = y + drop;
    if (width === 0) continue;
    const start = here.anchor === "middle" ? lineX - width / 2 : here.anchor === "end" ? lineX - width : lineX;
    out.push([start, y - rise, start + width, y + drop, grow]);
  }
  const wrap = elem.attrs["fub:wrap"] === undefined ? null : svgLength(elem.attrs["fub:wrap"]);
  if (wrap !== null && wrap > 0 && top !== null) {
    const start = own.anchor === "middle" ? x - wrap / 2 : own.anchor === "end" ? x - wrap : x;
    out.push([start, top, start + wrap, bottom, spread]);
  }
  return out;
}

/// Aggiunge a `out` il rettangolo `box`, nello spazio di una forma, portato
/// da `m` e allargato di `spread`: nello spazio della forma il contorno esce
/// al più di tanto in ogni direzione, e dopo `m` di tanto per la lunghezza
/// della riga della matrice su ogni asse.
function include(out: BoundsBuilder, m: Matrix, box: Bounds, spread: number): void {
  const moved = new BoundsBuilder();
  for (const corner of [box.min, [box.max[0], box.min[1]], box.max, [box.min[0], box.max[1]]] as const) moved.include(apply(m, corner));
  const seen = moved.finish();
  if (seen === null) return;
  const ex = spread * Math.hypot(m[0], m[2]);
  const ey = spread * Math.hypot(m[1], m[3]);
  out.include([seen.min[0] - ex, seen.min[1] - ey]);
  out.include([seen.max[0] + ex, seen.max[1] + ey]);
}

/// Dove il contenuto `root` può disegnare, nello spazio in cui sta, per
/// eccesso: i riquadri delle forme col contorno più largo che le giunzioni e
/// i capi possono fare, e quelli dei testi come [`textBoxes`]. `null` se non
/// c'è niente.
function reach(root: Elem): Bounds | null {
  const out = new BoundsBuilder();
  const stack: Array<{ readonly elem: Elem; readonly outer: Matrix; readonly look: Look }> = [{ elem: root, outer: IDENTITY, look: LOOK }];
  while (stack.length > 0) {
    const { elem, outer, look: inherited } = stack.pop()!;
    const m = compose(outer, elem.attrs.transform === undefined ? IDENTITY : (parseTransform(elem.attrs.transform) ?? IDENTITY));
    const look = lookOf(inherited, elem.attrs);
    if (elem.tag === "g") {
      const children = elem.children ?? [];
      for (let k = children.length - 1; k >= 0; k--) stack.push({ elem: children[k]!, outer: m, look });
    } else if (elem.tag === "text") {
      for (const [x0, y0, x1, y1, spread] of textBoxes(elem, look)) include(out, m, { min: [x0, y0], max: [x1, y1] }, spread);
    } else if (SHAPES.has(elem.tag)) {
      const box = geometryBox(elem);
      if (box !== null) include(out, m, box, outline(elem.tag, look));
    }
  }
  return out.finish();
}

/// La regione di una maschera d'opacità attorno a `seen`, in centesimi,
/// arrotondata in fuori: la posizione e la misura; `null` se non è finita.
function regionOf(seen: Bounds): [number, number, number, number] | null {
  const x0 = Math.floor(seen.min[0] * 100 + 1e-6);
  const y0 = Math.floor(seen.min[1] * 100 + 1e-6);
  const x1 = Math.ceil(seen.max[0] * 100 - 1e-6);
  const y1 = Math.ceil(seen.max[1] * 100 - 1e-6);
  if (![x0, y0, x1, y1].every(Number.isFinite)) return null;
  return [x0, y0, Math.max(1, x1 - x0), Math.max(1, y1 - y0)];
}

// ---------------------------------------------------------------------------
// Creare una maschera.
// ---------------------------------------------------------------------------

/// Il comando che ritaglia con l'oggetto più alto di `units`: la risorsa con
/// la sua forma, un gruppo nuovo con gli altri che vi rimanda con `attr`, e
/// la forma che se ne va.
function maskOps(
  model: DocumentModel,
  units: readonly Unit[],
  ids: NewIds,
  attr: "clip-path" | "mask",
): Arranged | MaskRefusal {
  if (units.length < 2) return "few";
  const top = units[units.length - 1]!;
  const others = units.slice(0, -1);
  const into = others[others.length - 1]!;
  const clip = attr === "clip-path";
  const node = nodeOf(model, top);
  if (top.role === "line") return "line";
  const group = !clip && isGroup(top);
  if (!CLIPPING.has(top.role) && !group) return "top";
  const elem = elemOf(node);
  if (elem === null || onPath(elem)) return "top";
  const resources = resourcesOf(model);
  const inherited = inheritedStyle(node);
  if (!clip) {
    const problem = maskProblem(elem, resources);
    if (problem !== null) return problem;
    // Un motivo che la forma eredita cambierebbe la maschera come uno suo.
    for (const name of PAINTS) {
      const value = inherited.get(name);
      const used = value === undefined || urlIds(value).length === 0 ? null : paintReference(value);
      if (value !== undefined && urlIds(value).length > 0 && (used === null || !isGradient(resources.get(used.id)))) return "content";
    }
  }
  const own = plainAttributes(node);
  if (EFFECTS.some((name) => own.has(name) && trim(own.get(name)!) !== "none")) return "content";
  if (node.details?.stroke?.redrawable === false) return "content";
  if (invert(into.parent) === null) return "plane";
  // Gli antenati da cui la forma esce: ciò che facevano a lei non lo farebbero
  // più. L'opacità la porta il contenuto di una maschera.
  const between = containersBetween(node, nodeOf(model, into));
  let fade = 1;
  for (const container of between) {
    const held = plainAttributes(container);
    if (EFFECTS.some((name) => held.has(name) && trim(held.get(name)!) !== "none") || trim(held.get("display") ?? "") === "none") return "container";
    const opacity = svgOpacity(held.get("opacity") ?? "1");
    if (!clip && opacity !== null) fade *= opacity;
  }
  const plan = new Plan(model, ids);
  const home = homeOf(model);
  const id = ids.next("resource");
  const content = placed(top, into, elem, inherited, clip, resources, fade);
  // La risorsa prima di chi la usa; la forma se ne va dopo che il gruppo ha
  // preso il suo posto.
  const made: AddOp = { op: "add", parent: home.parent, pos: { last: true }, elem: { tag: clip ? "clipPath" : "mask", attrs: { id, "fub:role": "private" }, children: [content] } };
  plan.ops.push(...home.prelude, made);
  const wrapper = wrapIn(plan, others, "g", { [attr]: `url(#${id})` });
  if (wrapper === null) return "plane";
  plan.ops.push({ op: "remove", target: plan.idOf(node) });
  const arranged = plan.finish([wrapper]);
  // Con un foglio di stile il contenuto potrebbe vedersi diverso dalla forma:
  // si confronta, e si scrive ciò che manca.
  const kept = keepCarried(model, arranged.ops, [{ from: node, down: [], into: made, inside: [0], mode: clip ? "clip" : "mask", fades: between }]);
  if (refused(kept)) return "style";
  if (clip) return { ...arranged, ops: kept.ops };
  // La regione di una maschera d'opacità si misura sul contenuto com'è
  // finito: dove disegna, nello spazio del gruppo, arrotondata in fuori.
  const index = arranged.ops.indexOf(made);
  const resource = kept.ops[index] as AddOp;
  const seen = reach(resource.elem.children![0]!);
  const region = seen === null ? null : regionOf(seen);
  if (region === null) return "top";
  const [x, y, width, height] = region;
  const sized: AddOp = { ...resource, elem: { ...resource.elem, attrs: { ...resource.elem.attrs, x: place(x / 100), y: place(y / 100), width: place(width / 100), height: place(height / 100), maskUnits: "userSpaceOnUse" } } };
  return { ...arranged, ops: kept.ops.map((op, k) => (k === index ? sized : op)) };
}

/// «Crea maschera di ritaglio»: il più alto di `units` (in ordine di
/// documento) ritaglia gli altri, che entrano in un gruppo nuovo. Il
/// ritaglio è una forma o un testo che non segue un tracciato, senza ritaglio,
/// maschera o filtro suoi.
export function clipMaskOps(model: DocumentModel, units: readonly Unit[], ids: NewIds): Arranged | MaskRefusal {
  return maskOps(model, units, ids, "clip-path");
}

/// «Crea maschera d'opacità»: il più alto di `units` diventa la maschera
/// degli altri, che entrano in un gruppo nuovo. È una forma, un testo che non
/// segue un tracciato, o un gruppo di forme e testi.
export function opacityMaskOps(model: DocumentModel, units: readonly Unit[], ids: NewIds): Arranged | MaskRefusal {
  return maskOps(model, units, ids, "mask");
}

// ---------------------------------------------------------------------------
// Rilasciare.
// ---------------------------------------------------------------------------

/// Ciò che `unit` usa e si rilascia: il suo `clip-path` o la sua `mask`, una
/// risorsa modificabile.
interface Source {
  /// L'attributo di `unit` che rimanda alla risorsa.
  readonly attr: "clip-path" | "mask";
  readonly resource: LeafNode;
  /// I pezzi del contenuto, senza titolo e descrizione.
  readonly pieces: readonly Elem[];
  /// Il posto di ogni pezzo fra i figli della risorsa.
  readonly places: readonly number[];
  /// Dalle coordinate del contenuto a quelle di `unit`: la trasformazione
  /// della risorsa e le sue unità.
  readonly matrix: Matrix;
}

/// Le parti di un altro programma che non disegnano niente, e non hanno un
/// riquadro.
const NOT_DRAWN: ReadonlySet<string> = new Set(["title", "desc", "metadata", "style", "script", "defs"]);

/// Vero se `elem`, un oggetto, ha un riquadro che si calcola esatto: le
/// forme e le immagini hanno quello della loro geometria; un testo ha lettere
/// di cui si può solo stimare l'ingombro.
function measurable(elem: Elem): boolean {
  return elem.tag === "image" || SHAPES.has(elem.tag);
}

/// Il riquadro della geometria di `node` nelle sue coordinate, senza contorno
/// e senza ritagli: quello che dà le unità a `objectBoundingBox`. Un
/// contenitore ha quello di ciò che contiene, con le trasformazioni dei
/// figli; ciò che è nascosto non conta. `"inexact"` se dipende da un testo o
/// da parti di un altro programma, che si possono solo stimare; `null` se non
/// c'è niente.
function objectBox(node: ElementPart): Bounds | "inexact" | null {
  if (node.kind === "leaf") {
    if (node.details === null) return "inexact";
    const elem = elemOf(node);
    if (elem === null || !measurable(elem)) return "inexact";
    return geometryBox(elem);
  }
  const out = new BoundsBuilder();
  for (const child of elementChildren(node)) {
    if (child.details === null) {
      if (child.facts.uri === SVG_NS && NOT_DRAWN.has(child.facts.local)) continue;
      if (trim(plainAttributes(child).get("display") ?? "") === "none") continue;
      return "inexact";
    }
    if (child.details.role === "title" || child.details.role === "desc" || child.details.hidden === true) continue;
    const box = objectBox(child);
    if (box === "inexact") return box;
    if (box === null) continue;
    const written = plainAttributes(child).get("transform");
    const m = written === undefined ? IDENTITY : (parseTransform(written) ?? IDENTITY);
    for (const corner of [box.min, [box.max[0], box.min[1]], box.max, [box.min[0], box.max[1]]] as const) out.include(apply(m, corner));
  }
  return out.finish();
}

/// Le risorse che `unit` usa e si rilasciano, la maschera prima del
/// ritaglio. Una risorsa nelle unità del riquadro di `unit` si rilascia se
/// il riquadro ha un'area; se il riquadro non si sa calcolare esatto, `unit`
/// è `blocked` e non si rilascia.
function sourcesOf(model: DocumentModel, unit: Unit, resources: ReadonlyMap<string, LeafNode>): { readonly found: Source[]; readonly blocked: boolean } {
  const node = nodeOf(model, unit);
  const found: Source[] = [];
  if ((node.kind === "leaf" ? node.refs : node.facts.refs).length === 0) return { found, blocked: false };
  const own = plainAttributes(node);
  let blocked = false;
  for (const attr of ["mask", "clip-path"] as const) {
    const written = own.get(attr);
    const id = written === undefined ? null : reference(written);
    const resource = id === null ? undefined : resources.get(id);
    if (resource === undefined || resource.facts.local !== (attr === "mask" ? "mask" : "clipPath")) continue;
    const elem = elemOf(resource);
    if (elem === null) continue;
    const clip = attr === "clip-path";
    let matrix = IDENTITY;
    if (clip && elem.attrs.transform !== undefined) {
      const parsed = parseTransform(elem.attrs.transform);
      if (parsed === null) continue;
      matrix = parsed;
    }
    if (trim(elem.attrs[clip ? "clipPathUnits" : "maskContentUnits"] ?? "") === "objectBoundingBox") {
      const box = objectBox(node);
      if (box === "inexact") {
        blocked = true;
        continue;
      }
      if (box === null) continue;
      const w = box.max[0] - box.min[0];
      const h = box.max[1] - box.min[1];
      if (!(w > 0 && h > 0)) continue;
      // Le unità si applicano prima della trasformazione della risorsa.
      matrix = compose(matrix, [w, 0, 0, h, box.min[0], box.min[1]]);
    }
    const children = elem.children ?? [];
    const places = children.map((_, k) => k).filter((k) => children[k]!.tag !== "title" && children[k]!.tag !== "desc");
    found.push({ attr, resource, pieces: places.map((k) => children[k]!), places, matrix });
  }
  return { found, blocked };
}

/// Vero se `unit` ha un ritaglio o una maschera modificabile da rilasciare,
/// anche se poi il riquadro non si sa calcolare: [`releaseRefusal`] dice
/// perché.
export function releasable(model: DocumentModel, unit: Unit): boolean {
  const node = nodeOf(model, unit);
  // Chi non rimanda a niente non ha niente da rilasciare: la maggior parte
  // degli oggetti, senza leggere le risorse.
  if ((node.kind === "leaf" ? node.refs : node.facts.refs).length === 0) return false;
  const { found, blocked } = sourcesOf(model, unit, resourcesOf(model));
  return found.length > 0 || blocked;
}

/// `elem` senza `clip-rule`, che un oggetto non ha.
function withoutClipRule(elem: Elem): Elem {
  const attrs = { ...elem.attrs };
  delete attrs["clip-rule"];
  const out: { tag: string; attrs: Record<string, string>; children?: Elem[]; text?: string | null; runs?: readonly Run[] } = { tag: elem.tag, attrs };
  if (elem.children !== undefined) out.children = elem.children.map(withoutClipRule);
  if (elem.text !== undefined) out.text = elem.text;
  if (elem.runs !== undefined) {
    out.runs = elem.runs.map((run): Run => {
      if (typeof run === "string") return run;
      const piece = { ...run.attrs };
      delete piece["clip-rule"];
      return { text: run.text, attrs: piece };
    });
  }
  return out;
}

/// Il valore iniziale degli attributi che si ereditano, dove SVG ne ha uno
/// che il formato scrive.
const INITIAL_STYLE: ReadonlyMap<string, string> = new Map([
  ["fill", "#000000"],
  ["fill-opacity", "1"],
  ["stroke", "none"],
  ["stroke-width", "1"],
  ["stroke-opacity", "1"],
  ["stroke-linecap", "butt"],
  ["stroke-linejoin", "miter"],
  ["stroke-dasharray", "none"],
  ["font-size", "16"],
  ["font-weight", "normal"],
  ["font-style", "normal"],
  ["letter-spacing", "0"],
  ["text-anchor", "start"],
]);

/// Gli attributi ereditati che contano solo per il testo.
const TEXTUAL: ReadonlySet<string> = new Set(["font-family", "font-size", "font-weight", "font-style", "letter-spacing", "text-anchor"]);

/// Vero se `elem` contiene del testo.
function hasText(elem: Elem): boolean {
  let found = false;
  everywhere(elem, (each) => {
    if (each.tag === "text" || each.tag === "tspan") found = true;
  });
  return found;
}

/// Gli attributi che `attrs`, un pezzo, eredita: dentro la risorsa dai suoi
/// antenati (`there`), fuori da quelli dell'unità (`here`). Il pezzo ha lo
/// stile che aveva dentro: se fuori erediterebbe un altro valore lo scrive,
/// con quello che aveva o con l'iniziale. Falso se manca un valore che non
/// si sa scrivere (la famiglia dei caratteri).
function keptStyle(attrs: Record<string, string>, elem: Elem, here: ReadonlyMap<string, string>, there: ReadonlyMap<string, string>, clip: boolean): boolean {
  const texty = hasText(elem);
  for (const name of INHERITED) {
    const own = attrs[name];
    if (own !== undefined && trim(own) !== "inherit") continue;
    if (clip && name === "fill") continue;
    if (!texty && TEXTUAL.has(name)) continue;
    const want = there.get(name) ?? INITIAL_STYLE.get(name);
    const got = here.get(name) ?? INITIAL_STYLE.get(name);
    if (want === got) {
      delete attrs[name];
      continue;
    }
    if (want === undefined) return false;
    attrs[name] = want;
  }
  return true;
}

/// Un pezzo di `source` come oggetto sotto il genitore di `unit`: la
/// trasformazione di `unit` e della risorsa, lo stile che aveva dentro la
/// risorsa (`here` è quello che i contenitori di `unit` darebbero, `there`
/// quello che dava la risorsa), e per un ritaglio il riempimento che non ha.
/// `null` se lo stile non si sa riscrivere.
function released(unit: Unit, source: Source, piece: Elem, here: ReadonlyMap<string, string>, there: ReadonlyMap<string, string>): Elem | null {
  const clip = source.attr === "clip-path";
  const elem = clip ? withoutClipRule(piece) : piece;
  const attrs = { ...elem.attrs };
  if (!keptStyle(attrs, elem, here, there, clip)) return null;
  const own = attrs.transform === undefined ? IDENTITY : (parseTransform(attrs.transform) ?? IDENTITY);
  const value = transformValue(compose(unit.transform, compose(source.matrix, own)));
  if (value === null) delete attrs.transform;
  else attrs.transform = value;
  if (clip && (attrs.fill === undefined || trim(attrs.fill) === "inherit")) attrs.fill = "none";
  return { ...elem, attrs };
}

/// Vero se `node`, un gruppo che perde `lost`, non ha più niente di suo:
/// nessun attributo fuori da `id`, `transform` e `lost`, nessun titolo o
/// descrizione.
function bare(node: ElementPart, lost: ReadonlySet<string>): boolean {
  if (![...plainAttributes(node).keys()].every((name) => name === "id" || name === "transform" || lost.has(name))) return false;
  if (fubAttributes(node).size > 0) return false;
  return !elementChildren(node as ContainerNode).some((child) => child.facts.uri === SVG_NS && (child.facts.local === "title" || child.facts.local === "desc"));
}

/// Il lavoro di rilascio di un'unità.
interface Work {
  readonly unit: Unit;
  readonly adds: Op[];
  readonly pieces: string[];
  readonly lost: readonly ("clip-path" | "mask")[];
  readonly dissolves: boolean;
  readonly carried: Carried[];
  freed: string[];
}

/// Il rilascio di `units`, o perché non si fa: vedi [`releaseOps`].
function release(model: DocumentModel, units: readonly Unit[], ids: NewIds): Arranged | ReleaseRefusal | null {
  const resources = resourcesOf(model);
  const users = usersOf(model);
  const copies = new ResourceCopies(model, ids, elemOf);
  const plan = new Plan(model, ids);
  const works = new Map<Unit, Work>();
  // Dall'ultima unità alla prima: i pezzi che si aggiungono dopo un'unità non
  // spostano il percorso di quelle che la precedono.
  for (const unit of [...units].reverse()) {
    const { found: sources, blocked } = sourcesOf(model, unit, resources);
    if (blocked) return "box";
    if (sources.length === 0) continue;
    const node = nodeOf(model, unit);
    const parent = plan.parentOf(node);
    let after = plan.idOf(node);
    const adds: Op[] = [];
    const pieces: string[] = [];
    const carried: Carried[] = [];
    // Lo stile che i contenitori di `unit` darebbero ai pezzi.
    const here = inheritedStyle(node);
    let complete = true;
    for (const source of sources) {
      // Una risorsa privata e soltanto di `unit` passa ai pezzi com'è; se è
      // di altri, i pezzi hanno le copie delle risorse private che usa.
      const own = source.resource.details?.lifecycle === "private" && users.get(source.resource.facts.id!) === 1;
      const there = inheritedStyle(source.resource);
      for (let k = 0; k < source.pieces.length && complete; k++) {
        const made = released(unit, source, source.pieces[k]!, here, there);
        if (made === null) return "style";
        const object = renamed(made, ids);
        const adopted = own ? object : copies.adopt(object);
        if (adopted === null) {
          complete = false;
          break;
        }
        const add: Op = { op: "add", parent, pos: { after }, elem: adopted };
        adds.push(add);
        carried.push({ from: source.resource, down: [source.places[k]!], into: add, inside: [], mode: source.attr === "clip-path" ? "from-clip" : "from-mask" });
        after = adopted.attrs.id!;
        pieces.push(after);
      }
      if (!complete) break;
    }
    if (!complete) continue;
    const lost = sources.map((source) => source.attr);
    works.set(unit, { unit, adds, pieces, lost, dissolves: isGroup(unit) && bare(node, new Set(lost)), carried, freed: [] });
  }
  if (works.size === 0) return null;
  // Le copie delle risorse prima di chi le usa.
  plan.ops.push(...copies.ops());
  for (const work of works.values()) {
    plan.ops.push(...work.adds);
    // `unwrapIn` porta fuori i figli dall'ultimo al primo: la selezione li vuole nell'ordine del disegno.
    if (work.dissolves) work.freed = unwrapIn(plan, [work.unit], () => true).freed.reverse();
    else plan.ops.push({ op: "set", id: plan.idOf(nodeOf(model, work.unit)), attrs: Object.fromEntries(work.lost.map((name) => [name, null])) });
  }
  const keys: string[] = [];
  for (const unit of units) {
    const work = works.get(unit);
    if (work === undefined) {
      keys.push(plan.keyOf(nodeOf(model, unit), unit.key));
      continue;
    }
    keys.push(...work.pieces, ...(work.dissolves ? work.freed : [plan.keyOf(nodeOf(model, unit), unit.key)]));
  }
  const arranged = plan.finish(keys);
  // Con un foglio di stile i pezzi potrebbero vedersi diversi da come erano
  // nella risorsa: si confronta, e si scrive ciò che manca.
  const kept = keepCarried(model, arranged.ops, [...works.values()].flatMap((work) => work.carried));
  if (refused(kept)) return "style";
  return { ...arranged, ops: kept.ops };
}

/// «Rilascia»: per ogni unità di `units` con un ritaglio o una maschera
/// modificabile, il contenuto torna a essere oggetti subito sopra l'unità,
/// quello della maschera sotto quello del ritaglio, e l'unità perde i suoi
/// attributi. Un gruppo che non ha più niente di suo si separa. La
/// selezione dopo sono i pezzi e l'unità, o i suoi figli se si separa. `null`
/// se nessuna unità ha niente da rilasciare, o se qualcuna non si può: vedi
/// [`releaseRefusal`].
export function releaseOps(model: DocumentModel, units: readonly Unit[], ids: NewIds): Arranged | null {
  const made = release(model, units, ids);
  return typeof made === "string" ? null : made;
}

/// Perché `releaseOps` torna `null` se le unità hanno un ritaglio o una
/// maschera: il riquadro di una risorsa in `objectBoundingBox` dipende da un
/// testo o da parti estranee (`box`), o lo stile del disegno farebbe vedere i
/// pezzi diversi (`style`). `null` se il rilascio si fa o non c'è niente.
export function releaseRefusal(model: DocumentModel, units: readonly Unit[], ids: NewIds): ReleaseRefusal | null {
  const made = release(model, units, ids);
  return typeof made === "string" ? made : null;
}
