// Gli appunti dei disegni, incollare: il trasloco delle risorse, dei
// campioni, degli stili, delle punte e dei simboli nella `defs` del disegno,
// e gli elementi che il piano aggiunge (`../clipboard.ts`).

import {
  classifyChild,
  firstTitle,
  resourceIndex,
  resourceKind,
  styleIndex,
  styleOf,
  swatchOf,
  type Resolve,
  type ResourceKind,
  type StyleFacts,
  type SwatchFacts,
} from "../../scene/classify";
import type { DocumentModel } from "../../scene/model";
import type { Op } from "../../scene/ops";
import { MAX_RESOURCES } from "../../scene/read";
import { isSvg, NS_FUB, NS_NONE, valueOf, type NodeId, type XmlDocument } from "../../scene/xml";
import { t } from "../../strings";
import type { NewIds } from "../edit";
import { cleanName, nameKey } from "../naming";
import { resourcesOf } from "../resources";
import { arrivingStyleName, styleNameProblem, type NamedStyle } from "../styles";
import { freshSwatchName, swatchNameProblem } from "../swatches";
import { documentSymbols, freeSymbolName, readOrigin, resourceTexts } from "../symbols";
import { markerTip } from "../tips";
import { CHUNK_BYTES, holdersById, referencesOf, subtree } from "./base";
import { compact, jsonBytes, type Lift, type PasteTarget, styleText, symbolKey, withoutId } from "./read";

/// Il trasloco delle risorse di `doc` nel disegno `model`, per i figli della
/// radice `tops`; i nomi nuovi vanno in `names` e `renamed`. Una risorsa
/// privata ha sempre una copia, con id nuovi; una condivisa, o che non è di
/// FubDraw, resta quella del disegno se ha lo stesso id, lo stesso testo e
/// usa le stesse. Un campione resta quello del disegno con lo stesso id, o
/// diventa il campione del disegno, o uno che arriva prima, con lo stesso
/// nome, senza maiuscole, e lo stesso colore; se arriva, con un nome già
/// preso o che si legge come un colore, prende il primo nome libero. Uno
/// stile allo stesso modo, col suo tipo e il suo aspetto al posto del
/// colore: quello del disegno non porta niente con sé. Ciò che nessuno usa
/// resta fuori. Niente trasloco se l'SVG ha fogli di stile,
/// che possono rimandare alle risorse, o se il disegno supererebbe il
/// limite delle risorse, o senza `allowed`: allora resta tutto com'era.
export function liftOf(
  doc: XmlDocument,
  tops: readonly NodeId[],
  allowed: boolean,
  model: DocumentModel,
  ids: NewIds,
  names: Map<string, string>,
  renamed: Map<NodeId, string>,
  refill: PasteTarget["refill"],
): Lift {
  const resources = resourcesOf(model);
  const symbols = documentSymbols(model);
  const symbolById = new Map(symbols.map((symbol) => [symbol.id, symbol]));
  const byId = holdersById(doc);
  // Un riferimento a un id che l'SVG non ha va alla risorsa o al simbolo del
  // disegno che lo porta, se c'è.
  const outside: Resolve = (id) => {
    if (byId.has(id)) return null;
    const node = resources.get(id);
    if (node !== undefined) return resourceKind(node.facts.local);
    return symbolById.has(id) ? "symbol" : null;
  };
  const styled = (id: string): boolean => resources.get(id)?.details?.style !== undefined;
  const none: Lift = { defs: new Set(), moved: [], decided: new Set(), named: new Map(), colors: new Map(), titled: new Map(), symbols: new Map(), styled, resolve: outside, written: outside };
  const defs = new Set(tops.filter((top) => classifyChild(doc, top, "root", 1)?.[1] === "defs"));
  if (!allowed || defs.size === 0 || doc.nodes.some((node) => node.kind === "element" && isSvg(node, "style"))) return none;
  const index = resourceIndex(doc);
  const decided = new Set<NodeId>();
  for (const top of defs) for (const at of subtree(doc, top)) decided.add(at);
  const refsIn = (id: NodeId): string[] => [...subtree(doc, id)].flatMap((at) => referencesOf(doc, doc.element(at)!));
  // Il figlio di una `defs` che porta l'elemento `holder`.
  const movedOf = (holder: NodeId): NodeId | null => {
    for (let at = holder; ; ) {
      const parent = doc.nodes[at]!.parent;
      if (parent === null) return null;
      if (defs.has(parent)) return at;
      at = parent;
    }
  };
  // Gli stili del disegno, e poi quelli che arrivano con l'id che avranno.
  const styleKinds = styleIndex(doc);
  const styles: NamedStyle[] = [];
  for (const [id, node] of resources) {
    const style = node.details?.style;
    if (style !== undefined) styles.push({ id, name: style.name, kind: style.kind });
  }
  const textOf = (at: NodeId | undefined): string | undefined => {
    const element = at === undefined ? null : doc.element(at);
    return element === null ? undefined : doc.source.text.slice(element.start, element.end);
  };
  /// Lo stile del disegno che è lo stile `child` dell'SVG: quello con lo
  /// stesso id e lo stesso tipo, o uno del suo tipo con lo stesso nome,
  /// senza maiuscole, e lo stesso aspetto; `null` se arriva.
  const styleThere = (child: NodeId): string | null => {
    const element = doc.element(child)!;
    const id = valueOf(element, NS_NONE, "id") ?? "";
    const kind = byId.get(id) === child ? styleKinds.get(id) : undefined;
    if (kind === undefined) return null;
    if (resources.get(id)?.details?.style?.kind === kind) return id;
    const key = nameKey(valueOf(element, NS_FUB, "name") ?? "");
    let text: string | null = null;
    for (const other of styles) {
      if (other.kind !== kind || nameKey(other.name) !== key) continue;
      text ??= styleText(textOf(child)!, (ref) => textOf(byId.get(ref)));
      if (styleText(resources.get(other.id)!.raw, (ref) => resources.get(ref)?.raw) === text) return other.id;
    }
    return null;
  };
  // Le chiavi senza id dei simboli del disegno, lette quando ne arriva uno
  // col loro nome.
  const modelText = resourceTexts(model);
  const keys = new Map<string, string>();
  const keyThere = (id: string): string => {
    const known = keys.get(id);
    if (known !== undefined) return known;
    const key = symbolKey(id, modelText);
    keys.set(id, key);
    return key;
  };
  // Il testo di una risorsa dell'SVG, figlia di una `defs` della radice.
  const sourceText = (id: string): string | undefined => {
    const holder = byId.get(id);
    return holder !== undefined && movedOf(holder) === holder ? textOf(holder) : undefined;
  };
  // I simboli del disegno per origine: il primo copiato da ogni simbolo di
  // una libreria.
  const origins = new Map<string, string>();
  for (const symbol of symbols) {
    const origin = readOrigin(symbol.source);
    const key = origin === null ? null : `${origin.path}#${origin.id}`;
    if (key !== null && !origins.has(key)) origins.set(key, symbol.id);
  }
  /// Il simbolo del disegno che è il simbolo `child` dell'SVG: quello copiato
  /// dallo stesso simbolo della stessa libreria, anche se una delle due
  /// copie è cambiata, perché un simbolo di una libreria entra una volta
  /// sola; se no uno col suo stesso nome che gli è uguale, a parte gli id,
  /// con ciò che usa, prima quello col suo id. `null` se arriva.
  const symbolThere = (child: NodeId): string | null => {
    const element = doc.element(child)!;
    const id = valueOf(element, NS_NONE, "id") ?? "";
    if (byId.get(id) !== child || index.get(id) !== "symbol" || id === refill?.from) return null;
    const origin = readOrigin(valueOf(element, NS_FUB, "source") ?? null);
    const same = origin === null ? undefined : origins.get(`${origin.path}#${origin.id}`);
    if (same !== undefined) return same;
    const name = firstTitle(doc, element) ?? "";
    const named = symbols.filter((symbol) => symbol.name === name).sort((a, b) => Number(b.id === id) - Number(a.id === id));
    if (named.length === 0) return null;
    const key = symbolKey(id, sourceText);
    return named.find((symbol) => keyThere(symbol.id) === key)?.id ?? null;
  };
  // Gli stili e i simboli che restano quelli del disegno, con l'id dell'SVG.
  const keptStyles = new Map<string, string>();
  const keptSymbols = new Map<string, string>();
  const moved: NodeId[] = [];
  const seen = new Set<NodeId>();
  // In profondità e senza ricorsione: una catena di rimandi può essere
  // lunga quanto il file.
  const visit = (refs: readonly string[]): void => {
    const stack: Array<{ readonly refs: readonly string[]; at: number; readonly child: NodeId | null }> = [{ refs, at: 0, child: null }];
    while (stack.length > 0) {
      const frame = stack[stack.length - 1]!;
      if (frame.at === frame.refs.length) {
        stack.pop();
        if (frame.child !== null) moved.push(frame.child);
        continue;
      }
      const holder = byId.get(frame.refs[frame.at++]!);
      const child = holder === undefined ? null : movedOf(holder);
      if (child === null || seen.has(child)) continue;
      seen.add(child);
      // Uno stile che il disegno ha già non entra, e nemmeno ciò che usa.
      const there = styleThere(child);
      if (there !== null) {
        keptStyles.set(valueOf(doc.element(child)!, NS_NONE, "id")!, there);
        continue;
      }
      const symbol = symbolThere(child);
      if (symbol !== null) {
        keptSymbols.set(valueOf(doc.element(child)!, NS_NONE, "id")!, symbol);
        continue;
      }
      stack.push({ refs: refsIn(child), at: 0, child });
    }
  };
  for (const top of tops) if (!defs.has(top)) visit(refsIn(top));

  // I campioni del disegno, e poi quelli che arrivano con l'id che avranno.
  const swatches: Array<{ readonly id: string; readonly name: string; readonly color: string }> = [];
  for (const [id, node] of resources) {
    const swatch = node.details?.swatch;
    if (swatch !== undefined) swatches.push({ id, ...swatch });
  }
  const named = new Map<NodeId, string>();
  const colors = new Map<string, string>();
  // I nomi dei simboli, e poi quelli che arrivano; i simboli che arrivano,
  // con l'id che avranno.
  const symbolNames = new Set(symbols.map((symbol) => nameKey(symbol.name)));
  const arrived = new Map<string, string>();
  const titled = new Map<NodeId, string>();
  // Le punte del disegno, per il loro testo senza id; si leggono quando ne
  // arriva una.
  let tips: Map<string, string> | null = null;
  const tipOf = (text: string): string | undefined => {
    if (tips === null) {
      tips = new Map();
      for (const [id, node] of resources) {
        if (node.kind !== "leaf" || markerTip(node) === null) continue;
        const key = withoutId(node.raw);
        if (!tips.has(key)) tips.set(key, id);
      }
    }
    return tips.get(withoutId(text));
  };

  // Gli id, prima ciò che si usa e poi chi lo usa.
  const local = new Map<string, string>();
  const fresh = new Map<NodeId, string>();
  const kinds = new Map<string, ResourceKind>();
  const out: NodeId[] = [];
  let copies = 0;
  for (const child of moved) {
    const element = doc.element(child)!;
    const id = valueOf(element, NS_NONE, "id") ?? "";
    const kind = byId.get(id) === child ? index.get(id) : undefined;
    let arriving: SwatchFacts | null = null;
    const style = byId.get(id) === child && styleKinds.has(id) ? styleOf(doc, element) : null;
    if (style !== null) copies++;
    if (kind !== undefined) {
      kinds.set(id, kind);
      const there = resources.get(id);
      const swatch = valueOf(element, NS_FUB, "role") === "swatch" ? swatchOf(doc, element) : null;
      if (swatch !== null) {
        const key = nameKey(swatch.name);
        const own = there?.details?.swatch;
        const kept = own !== undefined ? { id, ...own } : swatches.find((other) => other.color === swatch.color && nameKey(other.name) === key);
        if (kept !== undefined) {
          local.set(id, kept.id);
          colors.set(kept.id, kept.color);
          continue;
        }
        arriving = swatch;
      }
      // Una punta della raccolta è quella del disegno che le somiglia, col
      // campione che usa già col nome che avrà: i campioni arrivano prima.
      if (element.local === "marker" && valueOf(element, NS_FUB, "role") === "shared" && valueOf(element, NS_FUB, "marker") !== undefined) {
        const text = doc.source.text.slice(element.start, element.end);
        const kept = tipOf(text.replace(/url\(#([^)\s]+)\)/g, (whole, ref: string) => (local.has(ref) ? `url(#${local.get(ref)!})` : whole)));
        if (kept !== undefined) {
          local.set(id, kept);
          continue;
        }
      }
      const same =
        there !== undefined &&
        valueOf(element, NS_FUB, "role") !== "private" &&
        there.facts.local === element.local &&
        compact(there.raw) === compact(doc.source.text.slice(element.start, element.end)) &&
        refsIn(child).every((ref) => local.get(ref) === ref || movedOf(byId.get(ref) ?? child) === child);
      if (same) {
        local.set(id, id);
        continue;
      }
      copies++;
    }
    out.push(child);
    // Il contenuto di un simbolo sono oggetti, coi loro id; quello che si
    // riempie tiene il suo.
    const symbol = kind === "symbol";
    const refilled = symbol && id === refill?.from;
    for (const at of subtree(doc, child)) {
      const value = valueOf(doc.element(at)!, NS_NONE, "id") ?? "";
      if (value === "") continue;
      const next = refilled && at === child ? refill!.into.facts.id! : ids.next(symbol && at !== child ? "object" : "resource");
      fresh.set(at, next);
      if (!local.has(value)) local.set(value, next);
    }
    if (symbol) arrived.set(id, fresh.get(child)!);
    if (symbol && !refilled) {
      const title = element.children.find((at) => {
        const node = doc.element(at);
        return node !== null && isSvg(node, "title");
      });
      const name = firstTitle(doc, element);
      if (title !== undefined && name !== null && cleanName(name) !== "") {
        const free = symbolNames.has(nameKey(name)) ? freeSymbolName(symbolNames, name) : name;
        if (free !== name) titled.set(title, free);
        symbolNames.add(nameKey(free));
      }
    }
    if (arriving !== null) {
      const clean = cleanName(arriving.name);
      const name = swatchNameProblem(swatches, clean) === null ? arriving.name : freshSwatchName(swatches, clean === "" ? t("draw.colors.form.default") : clean);
      if (name !== arriving.name) named.set(child, name);
      swatches.push({ id: fresh.get(child)!, name, color: arriving.color });
    }
    if (style !== null) {
      const name = arrivingStyle(styles, style);
      if (name !== style.name) named.set(child, name);
      styles.push({ id: fresh.get(child)!, name, kind: style.kind });
    }
  }
  if (resources.size + symbols.length + copies > MAX_RESOURCES) return none;
  for (const [from, to] of keptStyles) local.set(from, to);
  for (const [from, to] of keptSymbols) {
    local.set(from, to);
    kinds.set(from, "symbol");
    arrived.set(from, to);
  }
  for (const [from, to] of local) if (!names.has(from)) names.set(from, to);
  for (const [at, to] of fresh) renamed.set(at, to);
  const written = new Map<string, ResourceKind>();
  for (const [id, kind] of kinds) written.set(names.get(id)!, kind);
  return {
    defs,
    moved: out,
    decided,
    named,
    colors,
    titled,
    symbols: arrived,
    styled,
    resolve: (id) => kinds.get(id) ?? outside(id),
    written: (id) => written.get(id) ?? outside(id),
  };
}

/// Il nome di uno stile `style` che arriva fra gli stili `styles`: il suo se
/// è libero nel suo tipo, se no il primo libero.
export function arrivingStyle(styles: readonly NamedStyle[], style: StyleFacts): string {
  const clean = cleanName(style.name);
  if (styleNameProblem(styles, style.kind, clean) === null) return style.name;
  return arrivingStyleName(styles, style.kind, clean === "" ? t(style.kind === "text" ? "draw.styles.text" : "draw.styles.graphic") : clean);
}

/// Gli `add` di un incolla: testi fratelli uniti in sequenze, finché il loro
/// JSON sta in [`CHUNK_BYTES`].
export class Adds {
  private parent: string | null = null;
  private texts: string[] = [];
  private bytes = 0;
  private gap = "";

  constructor(private readonly ops: Op[]) {}

  push(parent: string, gap: string, text: string, bytes: number): void {
    if (this.parent !== parent || this.bytes + bytes > CHUNK_BYTES) this.flush();
    this.parent = parent;
    this.gap = gap;
    this.texts.push(text);
    this.bytes += bytes + jsonBytes(gap);
  }

  /// Un'operazione dopo gli `add` fin qui.
  then(op: Op): void {
    this.flush();
    this.ops.push(op);
  }

  flush(): void {
    if (this.parent !== null && this.texts.length > 0) {
      this.ops.push({ op: "add", parent: this.parent, pos: { last: true }, raw: this.texts.join(this.gap) });
    }
    this.parent = null;
    this.texts = [];
    this.bytes = 0;
  }
}
