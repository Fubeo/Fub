// Le risorse del disegno viste dall'editor (formato della scena, risorse): le
// sfumature, i motivi, i marcatori, i ritagli, le maschere e i filtri che
// stanno nelle `defs` della radice e che gli oggetti usano per riferimento.
//
// - **Dove stanno.** Le risorse modificabili sono figlie di una `defs` della
//   radice. Le nuove vanno nella `defs` di FubDraw, `fub-defs`, o nella prima
//   `defs` della radice che ha un id; se non ce n'è una, il comando crea
//   `fub-defs`.
// - **Di chi sono.** Una risorsa privata è di chi la usa: la copia di un
//   oggetto ha le sue, con id nuovi. Le condivise, e quelle che non sono di
//   FubDraw, restano le stesse. Toglierle quando nessuno le usa più lo fa il
//   motore.
// - **Ciò che si vede resta.** Una risorsa vive nelle coordinate di chi la
//   usa: un oggetto che ne usa una tiene la sua trasformazione invece di
//   passarla nella geometria, e un gruppo con un ritaglio, una maschera o un
//   filtro non si separa.

import { formatNumber } from "../number";
import { DEFS_ID } from "../scene/ids";
import { elementChildren, parseFragment, scopeOf, type ContainerNode, type DocumentModel, type ElementPart, type LeafNode } from "../scene/model";
import { ROOT, type Op } from "../scene/ops";
import type { Elem } from "../scene/serialize";
import { fraction, opacity, paint, paintReference, reference, urlIds } from "../scene/values";
import { NS_NONE, NS_SVG, valueOf } from "../scene/xml";
import type { NewIds } from "./edit";
import type { Inherited } from "./outline";
import { renameUrls } from "./stylesheet";

/// Le risorse modificabili di `model`, per id: i figli delle `defs` della
/// radice. Di due con lo stesso id vale la prima.
export function resourcesOf(model: DocumentModel): Map<string, LeafNode> {
  const out = new Map<string, LeafNode>();
  for (const child of elementChildren(model.root)) {
    if (child.kind !== "container" || child.details?.role !== "defs") continue;
    for (const inner of elementChildren(child)) {
      const id = inner.facts.id;
      if (inner.kind === "leaf" && inner.details?.role === "resource" && id !== null && !out.has(id)) out.set(id, inner);
    }
  }
  return out;
}

/// La `defs` dove vanno le risorse nuove: quella di FubDraw, o la prima
/// della radice che ha un id; `null` se il disegno non ne ha una.
export function resourceHome(model: DocumentModel): ContainerNode | null {
  let first: ContainerNode | null = null;
  for (const child of elementChildren(model.root)) {
    if (child.kind !== "container" || child.details?.role !== "defs" || child.facts.id === null) continue;
    if (child.facts.id === DEFS_ID) return child;
    first ??= child;
  }
  return first;
}

/// Dove un comando aggiunge risorse: l'id della `defs`, e ciò che la crea
/// se il disegno non ne ha una.
export interface Home {
  readonly parent: string;
  readonly prelude: readonly Op[];
}

/// La [`Home`] delle risorse nuove di `model`: senza una `defs` con un id,
/// `fub-defs` nasce per prima fra i figli della radice, dopo titolo e
/// descrizione e prima della carta.
export function homeOf(model: DocumentModel): Home {
  const home = resourceHome(model);
  if (home !== null) return { parent: home.facts.id!, prelude: [] };
  return { parent: DEFS_ID, prelude: [{ op: "add", parent: ROOT, pos: { first: true }, elem: { tag: "defs", attrs: { id: DEFS_ID } } }] };
}

/// Gli attributi che usano una risorsa nelle coordinate di chi li porta, e
/// che un figlio non eredita.
const EFFECTS: readonly string[] = ["clip-path", "mask", "filter"];

/// Vero se un elemento con gli attributi `attrs` ha un ritaglio, una
/// maschera o un filtro: separarlo li perderebbe, e dare la sua
/// trasformazione ai figli li sposterebbe.
export function holdsEffect(attrs: ReadonlyMap<string, string>): boolean {
  return EFFECTS.some((name) => {
    const value = attrs.get(name);
    return value !== undefined && reference(value) !== null;
  });
}

/// Vero se `node` usa una risorsa, sua o ereditata da `from`: una
/// trasformazione passata nella sua geometria lo cambierebbe a vederlo,
/// perché la risorsa resta nelle coordinate di prima.
export function usesResources(node: ElementPart, from: Inherited): boolean {
  if (node.facts.refs.length > 0) return true;
  return ["fill", "stroke"].some((name) => {
    const value = from.get(name);
    return value !== undefined && paintReference(value) !== null;
  });
}

// ---------------------------------------------------------------------------
// Il campione del pannello.
// ---------------------------------------------------------------------------

/// Un colore che è una risorsa, come lo mostra il pannello: il tipo, e per
/// una sfumatura l'immagine CSS dei suoi punti, da sinistra a destra o dal
/// centro; `null` se non si legge.
export interface PaintSample {
  readonly kind: "gradient" | "pattern";
  readonly image: string | null;
}

/// Il campione di `value`, un `fill` o uno `stroke` di `model`; `null` se non
/// usa una sfumatura o un motivo del disegno.
export function paintSample(model: DocumentModel, value: string, resources: ReadonlyMap<string, LeafNode> = resourcesOf(model)): PaintSample | null {
  const used = paintReference(value);
  const node = used === null ? undefined : resources.get(used.id);
  if (node === undefined) return null;
  switch (node.facts.local) {
    case "pattern":
      return { kind: "pattern", image: null };
    case "linearGradient":
      return { kind: "gradient", image: gradientImage(node, "linear-gradient(to right") };
    case "radialGradient":
      return { kind: "gradient", image: gradientImage(node, "radial-gradient(circle") };
    default:
      return null;
  }
}

/// I punti della sfumatura `node` come immagine CSS, dopo `head`: ogni
/// punto fra 0 e 1, mai prima del precedente, come li porta SVG.
function gradientImage(node: LeafNode, head: string): string | null {
  const fragment = parseFragment(node.raw, scopeOf(node.parent!));
  if (fragment === null) return null;
  const { doc } = fragment;
  const stops: Array<[string, number]> = [];
  let last = 0;
  for (const child of doc.element(fragment.id)!.children) {
    const element = doc.element(child);
    if (element === null || element.ns !== NS_SVG || element.local !== "stop") continue;
    const color = paint(valueOf(element, NS_NONE, "stop-color") ?? "black");
    if (color === null || color === "none") return null;
    const alpha = opacity(valueOf(element, NS_NONE, "stop-opacity") ?? "1") ?? 1;
    last = Math.max(last, Math.min(1, Math.max(0, fraction(valueOf(element, NS_NONE, "offset") ?? "0") ?? 0)));
    stops.push([`rgb(${color.join(" ")} / ${formatNumber(alpha, 3)})`, last]);
  }
  if (stops.length === 0) return null;
  // Un punto solo è un colore pieno; CSS ne vuole due.
  if (stops.length === 1) stops.push([stops[0]![0], 1]);
  return `${head}, ${stops.map(([color, at]) => `${color} ${formatNumber(at * 100, 2)}%`).join(", ")})`;
}

// ---------------------------------------------------------------------------
// Le copie.
// ---------------------------------------------------------------------------

/// Le copie delle risorse private che usano gli elementi nuovi di un
/// comando, come un duplicato: ognuna con un id nuovo, e una volta sola anche
/// se più elementi la usano. Una risorsa privata che ne usa un'altra privata
/// la porta con sé; le condivise e quelle che non sono di FubDraw restano le
/// stesse.
export class ResourceCopies {
  private readonly resources: Map<string, LeafNode>;
  /// Le risorse copiate: il loro id, e quello della copia.
  private readonly renamed = new Map<string, string>();
  private readonly adds: Op[] = [];
  private home: Home | null = null;

  constructor(
    private readonly model: DocumentModel,
    private readonly ids: NewIds,
    /// Una risorsa come la scrive un'operazione: `elemOf` di `arrange.ts`.
    private readonly elemOf: (node: ElementPart) => Elem | null,
  ) {
    this.resources = resourcesOf(model);
  }

  /// `elem`, con le sue parti, rivolto alle copie delle risorse private che
  /// usa. `null` se una di loro non si sa scrivere.
  adopt(elem: Elem): Elem | null {
    const attrs: Record<string, string> = {};
    for (const [name, value] of Object.entries(elem.attrs)) {
      if (!/url\(/i.test(value)) {
        attrs[name] = value;
        continue;
      }
      for (const id of urlIds(value)) if (!this.copy(id)) return null;
      attrs[name] = renameUrls(value, (id) => this.renamed.get(id) ?? null);
    }
    const out: { tag: string; attrs: Record<string, string>; children?: Elem[]; text?: string | null; runs?: Elem["runs"] } = { tag: elem.tag, attrs };
    if (elem.children !== undefined) {
      const children: Elem[] = [];
      for (const child of elem.children) {
        const adopted = this.adopt(child);
        if (adopted === null) return null;
        children.push(adopted);
      }
      out.children = children;
    }
    if (elem.text !== undefined) out.text = elem.text;
    if (elem.runs !== undefined) out.runs = elem.runs;
    return out;
  }

  /// Copia la risorsa `id` se è privata, dopo ciò che usa lei; falso se non
  /// si sa scrivere.
  private copy(id: string): boolean {
    if (this.renamed.has(id)) return true;
    const node = this.resources.get(id);
    if (node === undefined || node.details!.lifecycle !== "private") return true;
    const elem = this.elemOf(node);
    if (elem === null) return false;
    const fresh = this.ids.next("resource");
    this.renamed.set(id, fresh);
    const copy = this.adopt(this.withIds(elem, fresh));
    if (copy === null) return false;
    this.home ??= homeOf(this.model);
    this.adds.push({ op: "add", parent: this.home.parent, pos: { last: true }, elem: copy });
    return true;
  }

  /// `elem` con l'id `id`, e un id nuovo a ogni sua parte che ne ha uno.
  private withIds(elem: Elem, id: string | null): Elem {
    const attrs = { ...elem.attrs };
    if (id !== null) attrs.id = id;
    else if (attrs.id !== undefined) attrs.id = this.ids.next("resource");
    if (elem.children === undefined) return { ...elem, attrs };
    return { ...elem, attrs, children: elem.children.map((child) => this.withIds(child, null)) };
  }

  /// Le operazioni che aggiungono le copie, da fare prima di chi le usa;
  /// nessuna se non ce n'è.
  ops(): Op[] {
    return this.adds.length === 0 ? [] : [...this.home!.prelude, ...this.adds];
  }
}
