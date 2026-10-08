// Il connettore nelle proprietà (livello Standard): che cosa ne legge il
// pannello, e le operazioni che ne cambiano il tipo, gli agganci, l'etichetta
// e il verso (formato della scena, connettori). Senza DOM: la sezione che le
// mostra è `connector-panel.ts`, e l'editor le applica in un passo che si
// annulla.
//
// - **Contano i connettori scelti.** Un gruppo che ne contiene non conta: il
//   pannello parla degli oggetti che si sono scelti. Un connettore bloccato,
//   o dentro un livello o un gruppo bloccato, si legge e non cambia; il
//   pannello dice quanti sono.
// - **Il tipo e gli agganci riscrivono il percorso.** Il motore dei connettori
//   (`connectors.ts`) lo calcola con il tipo o gli agganci nuovi, e qui si
//   scrive insieme a `fub:geom`: un capo libero resta dov'è. Si cambia l'aggancio
//   soltanto di un capo che sta su un oggetto che vale; un capo libero, o
//   agganciato a ciò che non c'è più, si ignora.
// - **Un'etichetta è un testo con `fub:along`.** Vuoto toglie quelle del
//   connettore; un testo cambia le righe della prima, o ne fa una nuova subito
//   dopo il connettore, a metà e sopra la linea, con lo stile di un testo
//   nuovo e il colore della linea. Dove sta, a calcolarlo è il seguito del
//   motore, nello stesso passo, e così il `transform`.
// - **Invertire scambia i due capi.** `fub:from` e `fub:to`, i punti del
//   percorso nell'ordine contrario e il posto delle etichette: da `t` a
//   `1 − t`, con la stessa distanza, perché la parte positiva di una linea
//   non dipende dal suo verso. Le punte restano come sono scritte: una punta
//   di fine resta di fine, e va al capo nuovo, così la freccia si rivolge
//   dall'altra parte.

import type { ConnectorFacts } from "../scene/classify";
import { connectorAttrs, writeConnectorEnd, writeLabelPlace, type Anchor, type ConnectorEnd, type ConnectorKind } from "../scene/connectors";
import { elementChildren, type ContainerNode, type DocumentModel, type ElementPart } from "../scene/model";
import type { Op } from "../scene/ops";
import type { Elem } from "../scene/serialize";
import { fubAttributes, Plan } from "./arrange";
import { connectorRoute, labelPlace, targetOf } from "./connectors";
import type { NewIds } from "./edit";
import { paintedParts } from "./gradients";
import type { Unit } from "./hit";
import type { Measure } from "./measure";
import { DEFAULT_COLOR } from "./palette";
import { editableText, textElem, textLines, TEXT_SIZE, type TextStyle } from "./text";

/// Dove sta un capo, come lo dice il pannello: uno dei punti d'aggancio, o
/// `free` se il capo non è agganciato, o lo è a ciò che non vale più.
export type AnchorChoice = Anchor | "free";

/// I connettori scelti, come li mostra il pannello. Ogni valore è quello che
/// hanno in comune; `null` se sono diversi.
export interface ConnectorView {
  /// Quanti connettori ci sono fra gli oggetti scelti.
  readonly count: number;
  readonly kind: ConnectorKind | null;
  readonly from: AnchorChoice | null;
  readonly to: AnchorChoice | null;
  /// Il testo della prima etichetta di ogni connettore, in ordine di
  /// documento; vuoto se non ne ha.
  readonly label: string | null;
  /// Quanti dei connettori non si possono cambiare, perché bloccati.
  readonly locked: number;
}

/// Un cambio dei connettori scelti: il tipo, l'aggancio di un capo, il testo
/// dell'etichetta (vuoto la toglie), o il verso.
export type ConnectorChange =
  | { readonly kind: ConnectorKind }
  | { readonly end: "from" | "to"; readonly anchor: Anchor }
  | { readonly label: string }
  | { readonly invert: true };

/// Il cambio pronto: le operazioni, le chiavi della selezione dopo, e quanti
/// connettori cambiano davvero.
export interface ConnectorChanged {
  readonly ops: readonly Op[];
  readonly keys: readonly string[];
  readonly reached: number;
}

// ---------------------------------------------------------------------------
// Leggere.
// ---------------------------------------------------------------------------

/// Un connettore scelto, con ciò che serve a leggerlo e a cambiarlo.
interface Line {
  readonly unit: Unit;
  readonly node: ElementPart;
  readonly facts: ConnectorFacts;
  /// Vero se non si può cambiare: bloccato lui, o ciò che lo contiene.
  readonly locked: boolean;
}

/// Vero se un contenitore bloccato contiene `node`: il motore non vi scrive.
function lockedAbove(node: ElementPart): boolean {
  for (let at = node.parent; at !== null; at = at.parent) if (at.details?.locked === true) return true;
  return false;
}

/// I connettori fra `units`, in ordine di scelta. I figli di un contenitore
/// si elencano una volta sola: mille oggetti di un livello non lo scorrono
/// mille volte.
function connectorsOf(model: DocumentModel, units: readonly Unit[]): Line[] {
  const children = new Map<ElementPart, ElementPart[]>();
  const out: Line[] = [];
  for (const unit of units) {
    if (unit.role !== "connector") continue;
    let node: ElementPart = model.root;
    for (const at of unit.path) {
      let list = children.get(node);
      if (list === undefined) {
        list = elementChildren(node as ContainerNode);
        children.set(node, list);
      }
      node = list[at]!;
    }
    const facts = node.details?.connector;
    if (facts === undefined) continue;
    out.push({ unit, node, facts, locked: node.details!.locked === true || lockedAbove(node) });
  }
  return out;
}

/// Le etichette dei connettori di id `ids`, per connettore, in ordine di
/// documento. Il disegno si scorre una volta sola, e soltanto se c'è un id da
/// cercare.
function labelsOf(model: DocumentModel, ids: ReadonlySet<string>): Map<string, ElementPart[]> {
  const out = new Map<string, ElementPart[]>();
  if (ids.size === 0) return out;
  const walk = (container: ContainerNode): void => {
    for (const child of elementChildren(container)) {
      const details = child.details;
      if (details === null) continue;
      if (details.along !== undefined) {
        if (!ids.has(details.along.id)) continue;
        const list = out.get(details.along.id);
        if (list === undefined) out.set(details.along.id, [child]);
        else list.push(child);
      } else if (details.connector === undefined && child.kind === "container" && (details.role === "layer" || details.role === "group" || details.role === "link")) {
        walk(child);
      }
    }
  };
  walk(model.root);
  return out;
}

/// L'aggancio che `end` dà a `line`, se l'oggetto vale; altrimenti il capo
/// è libero.
function attached(line: Line, end: ConnectorEnd | null, find: (id: string) => ElementPart | null): ConnectorEnd | null {
  return end !== null && targetOf(line.node, end.id, find) !== null ? end : null;
}

/// Il valore che hanno tutti, o `null` se differiscono.
function shared<T>(values: readonly T[]): T | null {
  const first = values[0]!;
  return values.every((value) => value === first) ? first : null;
}

/// Il testo di un'etichetta, con le righe a capo e senza le righe vuote che
/// SVG non mostra in testa e in coda.
const textOf = (label: ElementPart): string => editableText(label.details?.lines ?? []);

/// I connettori fra gli oggetti scelti `units`, come li mostra il pannello;
/// `null` se non ce n'è nessuno. `find` dà l'elemento di un id, per dire se
/// l'oggetto di un capo vale.
export function connectorView(model: DocumentModel, units: readonly Unit[], find: (id: string) => ElementPart | null): ConnectorView | null {
  const lines = connectorsOf(model, units);
  if (lines.length === 0) return null;
  const ids = new Set<string>();
  for (const line of lines) if (line.node.facts.id !== null) ids.add(line.node.facts.id);
  const labels = labelsOf(model, ids);
  const choice = (line: Line, end: ConnectorEnd | null): AnchorChoice => attached(line, end, find)?.anchor ?? "free";
  return {
    count: lines.length,
    kind: shared(lines.map((line) => line.facts.geom.kind)),
    from: shared(lines.map((line) => choice(line, line.facts.from))),
    to: shared(lines.map((line) => choice(line, line.facts.to))),
    label: shared(lines.map((line) => {
      const first = labels.get(line.node.facts.id ?? "")?.[0];
      return first === undefined ? "" : textOf(first);
    })),
    locked: lines.filter((line) => line.locked).length,
  };
}

// ---------------------------------------------------------------------------
// Cambiare.
// ---------------------------------------------------------------------------

/// L'elemento di un'etichetta nuova del connettore `of`: le righe `lines`
/// ancorate a metà, nell'origine, che il seguito del motore porta al suo
/// posto lungo la linea.
function labelElem(id: string, of: string, lines: readonly string[], style: TextStyle): Elem {
  const elem = textElem(id, [0, 0], lines, style);
  return { ...elem, attrs: { ...elem.attrs, "text-anchor": "middle", "fub:along": writeLabelPlace(labelPlace(of)) } };
}

/// Le operazioni che danno `change` ai connettori fra `units`, in un `batch`
/// solo: prima gli `ident` di ciò che non ha id, poi il resto. Un connettore
/// che non cambia, o che non si può cambiare, resta com'è. `text` è lo stile
/// di un'etichetta nuova, di cui il colore è quello della linea quando è un
/// colore pieno.
export function connectorOps(
  model: DocumentModel,
  units: readonly Unit[],
  change: ConnectorChange,
  find: (id: string) => ElementPart | null,
  measure: Measure,
  ids: NewIds,
  text: TextStyle = { color: DEFAULT_COLOR, size: TEXT_SIZE },
): ConnectorChanged {
  const lines = connectorsOf(model, units).filter((line) => !line.locked);
  const plan = new Plan(model, ids);
  // Le chiavi nuove delle linee che il comando ha nominato.
  const keyed = new Map<string, string>();
  const lineId = (line: Line): string => {
    const known = line.node.facts.id;
    if (known !== null) return known;
    const id = plan.idOf(line.node);
    keyed.set(line.unit.key, id);
    return id;
  };
  let reached = 0;

  const labels = labelsOf(model, new Set(lines.flatMap((line) => (line.node.facts.id === null ? [] : [line.node.facts.id]))));
  const labelsFor = (line: Line): ElementPart[] => labels.get(line.node.facts.id ?? "") ?? [];
  // Un'etichetta si scrive se non è bloccata.
  const writable = (label: ElementPart): boolean => label.details!.locked !== true && !lockedAbove(label);

  if ("label" in change) {
    const rows = textLines(change.label);
    // Il colore delle linee che avranno un'etichetta nuova: quello pieno del
    // loro contorno.
    const colors = new Map<ElementPart, string>();
    const fresh = rows.length === 0 ? [] : lines.filter((line) => labelsFor(line).length === 0);
    if (fresh.length > 0) for (const part of paintedParts(model, fresh.map((line) => line.unit), "stroke")) if (part.solid !== null) colors.set(part.node, part.solid);
    for (const line of lines) {
      const existing = labelsFor(line);
      const label = existing[0];
      if (rows.length === 0) {
        const removable = existing.filter(writable);
        for (const each of removable) plan.ops.push({ op: "remove", target: plan.idOf(each) });
        if (removable.length > 0) reached++;
      } else if (label !== undefined) {
        const now = label.details?.lines ?? [];
        if (!writable(label) || (now.length === rows.length && now.every((row, at) => row === rows[at]))) continue;
        plan.ops.push({ op: "text", id: plan.idOf(label), lines: rows });
        reached++;
      } else {
        const of = lineId(line);
        const elem = labelElem(ids.next("object"), of, rows, { color: colors.get(line.node) ?? text.color, size: text.size });
        plan.ops.push({ op: "add", parent: plan.parentOf(line.node), pos: { after: of }, elem });
        reached++;
      }
    }
  } else {
    for (const line of lines) {
      const attrs = attrsFor(line, change, find, measure);
      if (attrs === null) continue;
      plan.ops.push({ op: "set", id: lineId(line), attrs });
      reached++;
      if (!("invert" in change)) continue;
      // Le etichette passano dall'altra parte della linea, alla stessa
      // distanza.
      for (const label of labelsFor(line)) {
        const place = label.details!.along!;
        if (place.t === 0.5 || !writable(label)) continue;
        plan.ops.push({ op: "set", id: plan.idOf(label), attrs: { "fub:along": writeLabelPlace({ id: place.id, t: 1 - place.t, offset: place.offset }) } });
      }
    }
  }

  if (reached === 0) return { ops: [], keys: units.map((unit) => unit.key), reached };
  const arranged = plan.finish(units.map((unit) => keyed.get(unit.key) ?? unit.key));
  return { ops: arranged.ops, keys: arranged.keys, reached };
}

/// Gli attributi che danno `change` a `line`; `null` se il connettore resta
/// com'è.
function attrsFor(line: Line, change: ConnectorChange, find: (id: string) => ElementPart | null, measure: Measure): Record<string, string | null> | null {
  const { facts, node } = line;
  if ("kind" in change) {
    if (facts.geom.kind === change.kind) return null;
    const route = connectorRoute(node, change.kind, facts.from, facts.to, find, measure);
    return route === null ? null : { ...route };
  }
  if ("end" in change) {
    const current = change.end === "from" ? facts.from : facts.to;
    if (current === null || current.anchor === change.anchor || attached(line, current, find) === null) return null;
    const next: ConnectorEnd = { id: current.id, anchor: change.anchor };
    const route = connectorRoute(node, facts.geom.kind, change.end === "from" ? next : facts.from, change.end === "to" ? next : facts.to, find, measure);
    return { [`fub:${change.end}`]: writeConnectorEnd(next), ...(route ?? {}) };
  }
  if ("invert" in change) {
    const written = connectorAttrs({ kind: facts.geom.kind, points: [...facts.geom.points].reverse() });
    // I capi si scambiano come sono scritti, anche quello che non si legge.
    const own = fubAttributes(node);
    const from = own.get("from") ?? null;
    const to = own.get("to") ?? null;
    const attrs: Record<string, string | null> = { ...written };
    if (to !== from) {
      attrs["fub:from"] = to;
      attrs["fub:to"] = from;
    }
    return attrs;
  }
  return null;
}
