// Gli appunti dei disegni, la riscrittura: le modifiche a un testo e il
// `Rewriter`, che riscrive un elemento con gli id nuovi, gli stili ereditati
// e i namespace che gli servono (`../clipboard.ts`).

import type { Resolve } from "../../scene/classify";
import { attributesOf, canonicalOrder, escapeAttribute, escapeText, writeOpenTag, type OutAttr } from "../../scene/serialize";
import { href as hrefKind, paintReference } from "../../scene/values";
import {
  FUB_NS,
  isSvg,
  NS_FUB,
  NS_NONE,
  NS_SVG,
  NS_XLINK,
  NS_XML,
  XMLNS_URI,
  type Attr,
  type ElementNode,
  type EntityRefNode,
  type NodeId,
  type XmlDocument,
} from "../../scene/xml";
import { isLinkName, relinked } from "../connector-copies";
import { paintCode } from "../resources";
import { renameUrls, restyle } from "../stylesheet";
import { ANIMATIONS, ENTITY, IDREFS, sheetText, TIMING, Unresolved } from "./base";

// ---------------------------------------------------------------------------
// Riscrittura.
// ---------------------------------------------------------------------------

/// Le modifiche a un testo: intervalli sostituiti, tenuti in ordine. Due
/// inserimenti nello stesso punto restano nell'ordine in cui arrivano.
export class Edits {
  private readonly list: Array<{ readonly from: number; readonly to: number; readonly text: string; readonly order: number }> = [];
  private sorted = true;

  add(from: number, to: number, text: string): void {
    const last = this.list[this.list.length - 1];
    if (last !== undefined && from < last.from) this.sorted = false;
    this.list.push({ from, to, text, order: this.list.length });
  }

  /// Il testo di `source` fra `from` e `to`, con le modifiche che vi
  /// cominciano.
  apply(source: string, from: number, to: number): string {
    if (!this.sorted) {
      this.list.sort((a, b) => a.from - b.from || a.order - b.order);
      this.sorted = true;
    }
    let lo = 0;
    let hi = this.list.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (this.list[mid]!.from < from) lo = mid + 1;
      else hi = mid;
    }
    let out = "";
    let at = from;
    for (let i = lo; i < this.list.length; i++) {
      const edit = this.list[i]!;
      if (edit.from >= to) break;
      out += source.slice(at, edit.from) + edit.text;
      at = edit.to;
    }
    return out + source.slice(at, to);
  }
}

/// Il valore come va scritto fra le virgolette che aveva: con gli escape, e
/// l'apostrofo fra apici.
export function quoted(value: string, single: boolean): string {
  const text = escapeAttribute(value);
  return single ? text.replace(/'/g, "&apos;") : text;
}

/// Il testo a LF.
export function lf(text: string): string {
  return text.indexOf("\r") < 0 ? text : text.replace(/\r\n?/g, "\n");
}

/// Dove finisce il nome nel tag d'apertura di `element`.
export function nameEnd(element: ElementNode): number {
  return element.start + 1 + element.name.length;
}

/// Nessun attributo da togliere.
export const KEPT: ReadonlySet<number> = new Set();

/// Ciò che cambia nel testo di un SVG che si copia o si incolla.
export interface Rules {
  /// L'id nuovo a cui va un riferimento; `null` se resta.
  readonly rename: (id: string) => string | null;
  /// Vero nell'incolla: `fub:from`, `fub:to`, `fub:along` e `fub:inside`
  /// seguono gli id nuovi, e si tolgono se ciò che nominano non entra. Nella copia gli id
  /// restano, e con loro i riferimenti.
  readonly relink: boolean;
  /// L'id nuovo di un elemento.
  readonly ids: ReadonlyMap<NodeId, string>;
  /// Il nome nuovo di un campione, per elemento.
  readonly named: ReadonlyMap<NodeId, string>;
  /// Il colore dei campioni del disegno a cui va un riferimento, per id: il
  /// ripiego di chi li usa.
  readonly colors: ReadonlyMap<string, string>;
  /// Vero se il disegno che riceve ha lo stile `id`: nell'incolla, chi segue
  /// uno stile che non entra e che il disegno non ha lascia `fub:style`.
  readonly styled: (id: string) => boolean;
  /// I fogli di stile: l'id del gruppo che li chiude, `null` per rinominare
  /// soltanto, `undefined` se restano come sono.
  readonly sheets: string | null | undefined;
  /// Il nuovo `href` di un'immagine o di un collegamento del vault; `null`
  /// lo lascia.
  readonly href: (value: string) => string | null;
  /// Quali id saranno risorse del disegno: con gli id del testo letto, e con
  /// quelli del testo riscritto.
  readonly resolve: Resolve;
  readonly written: Resolve;
}

/// Il tag d'apertura di un elemento che va in un altro posto.
export interface Head {
  /// Gli attributi senza namespace da scrivere, `null` per toglierli.
  readonly set: ReadonlyMap<string, string | null>;
  /// Per un elemento estraneo, la trasformazione da comporre davanti alla
  /// sua: il suo testo non si riscrive.
  readonly before: string | null;
  /// Vero se il tag si riscrive nella forma canonica: un elemento
  /// modificabile che cambia, come lo cambierebbe un `set`.
  readonly canonical: boolean;
  /// Toglie `fub:layer`: un livello che diventa un gruppo.
  readonly unlayer: boolean;
  readonly declarations: ReadonlyArray<readonly [string | null, string]>;
  /// L'id da dare all'elemento, se non ne ha.
  readonly id: string | null;
  /// Un primo figlio da aggiungere, già scritto, col rientro della riga
  /// dell'elemento: il titolo di un livello che diventa un gruppo.
  readonly child: string | null;
}

/// Le modifiche al testo di un SVG letto: le regole di [`Rules`] per i
/// discendenti, quelle di [`Head`] per un elemento che cambia posto.
export class Rewriter {
  readonly edits = new Edits();
  private readonly text: string;
  /// Gli id da dare agli elementi modificabili che non ne hanno.
  readonly fresh = new Map<NodeId, string>();
  /// I prefissi usati da ciò che si è riscritto dopo l'ultimo `clear`:
  /// `null` per il namespace predefinito di un elemento.
  readonly used = new Set<string | null>();
  /// I primi figli aggiunti da `head`, per elemento: la divisione di un
  /// contenitore troppo grande li porta per primi.
  readonly added = new Map<NodeId, string>();

  constructor(
    readonly doc: XmlDocument,
    readonly rules: Rules,
  ) {
    this.text = doc.source.text;
  }

  /// L'id di `id` dopo la riscrittura, nuovo o dato a chi non ne aveva;
  /// `null` se resta senza.
  idOf(id: NodeId): string | null {
    return this.rules.ids.get(id) ?? this.fresh.get(id) ?? null;
  }

  /// Il testo fra `from` e `to` con le modifiche, a LF.
  slice(from: number, to: number): string {
    return lf(this.edits.apply(this.text, from, to));
  }

  /// Riscrive il sottoalbero di `id`; il suo tag d'apertura solo se non lo
  /// decide `head`.
  body(id: NodeId, head: boolean): void {
    const stack: NodeId[] = [id];
    while (stack.length > 0) {
      const at = stack.pop()!;
      const element = this.doc.element(at)!;
      this.uses(element);
      if (at !== id || !head) {
        // L'id prima degli attributi tolti, che cominciano dov'è finito il nome.
        const fresh = this.fresh.get(at);
        if (fresh !== undefined) this.edits.add(nameEnd(element), nameEnd(element), ` id="${fresh}"`);
        for (const [index, text] of this.values(at)) {
          const attr = element.attrs[index]!;
          this.edits.add(attr.raw[0], attr.raw[1], text);
        }
        for (const index of this.dropped(element)) this.drop(element, element.attrs[index]!);
      }
      if (this.rules.sheets !== undefined && isSvg(element, "style")) this.sheet(element);
      for (let i = element.children.length - 1; i >= 0; i--) {
        const child = element.children[i]!;
        const node = this.doc.nodes[child]!;
        if (node.kind === "element") stack.push(child);
        else if (node.kind === "entity-ref") this.entity(node);
      }
    }
  }

  /// Il tag d'apertura di `id` come lo chiede `head`.
  head(id: NodeId, head: Head, indent: string): void {
    const element = this.doc.element(id)!;
    const values = this.values(id);
    const dropped = this.dropped(element);
    const selfClosing = element.closeStart === null;
    const child = head.child === null ? "" : `\n${indent}  ${head.child}`;
    if (head.canonical) {
      const attrs: OutAttr[] = [];
      attributesOf(this.doc, element).forEach((attr, index) => {
        if (head.unlayer && attr.uri === FUB_NS && attr.local === "layer") return;
        if (dropped.has(index)) return;
        if (attr.uri === "" && head.set.has(attr.local)) return;
        attrs.push({ ...attr, text: values.get(index) ?? attr.text });
      });
      for (const [name, value] of head.set) if (value !== null) attrs.push({ name, uri: "", local: name, text: escapeAttribute(value) });
      if (head.id !== null) attrs.push({ name: "id", uri: "", local: "id", text: head.id });
      for (const [prefix, uri] of head.declarations) {
        attrs.push({ name: prefix === null ? "xmlns" : `xmlns:${prefix}`, uri: XMLNS_URI, local: prefix ?? "xmlns", text: escapeAttribute(uri) });
      }
      const out = { name: element.name, group: false, attrs: canonicalOrder(attrs), children: [], text: null };
      if (selfClosing && child !== "") {
        this.edits.add(element.start, element.end, `${writeOpenTag(out, false)}${child}\n${indent}</${element.name}>`);
      } else {
        this.edits.add(element.start, element.openEnd, writeOpenTag(out, selfClosing));
        if (child !== "") {
          this.edits.add(element.openEnd, element.openEnd, child);
          this.added.set(id, head.child!);
        }
      }
      return;
    }
    let lead = "";
    for (const [prefix, uri] of head.declarations) lead += prefix === null ? ` xmlns="${escapeAttribute(uri)}"` : ` xmlns:${prefix}="${escapeAttribute(uri)}"`;
    if (head.id !== null) lead += ` id="${head.id}"`;
    if (lead !== "") this.edits.add(nameEnd(element), nameEnd(element), lead);
    const set = new Map(head.set);
    let before = head.before;
    element.attrs.forEach((attr, index) => {
      if (dropped.has(index)) {
        this.drop(element, attr);
        return;
      }
      const single = this.text.charCodeAt(attr.raw[0] - 1) === 0x27;
      let text = values.get(index) ?? null;
      if (attr.ns === NS_NONE && set.has(attr.local)) {
        const value = set.get(attr.local)!;
        set.delete(attr.local);
        if (value !== null) text = quoted(value, single);
      }
      if (attr.ns === NS_NONE && attr.local === "transform" && before !== null) {
        text = `${before} ${text ?? this.text.slice(attr.raw[0], attr.raw[1])}`;
        before = null;
      }
      if (text !== null) this.edits.add(attr.raw[0], attr.raw[1], text);
    });
    if (before !== null) set.set("transform", before);
    let tail = "";
    for (const [name, value] of set) if (value !== null) tail += ` ${name}="${escapeAttribute(value)}"`;
    const last = element.attrs[element.attrs.length - 1];
    const at = last === undefined ? nameEnd(element) : last.raw[1] + 1;
    if (tail !== "") this.edits.add(at, at, tail);
    if (child !== "") throw new Error("un primo figlio si aggiunge solo nella forma canonica");
  }

  /// I valori riscritti degli attributi di `element`, già scritti fra le
  /// loro virgolette, per indice; quelli che restano non ci sono.
  values(id: NodeId): Map<number, string> {
    const out = new Map<number, string>();
    const element = this.doc.element(id)!;
    const dropped = this.dropped(element);
    element.attrs.forEach((attr, index) => {
      if (dropped.has(index)) return;
      const declaration = attr.name === "xmlns" || attr.name.startsWith("xmlns:");
      const next = declaration ? attr.value : this.value(id, element, attr);
      if (next === attr.value && !ENTITY.test(this.text.slice(attr.raw[0], attr.raw[1]))) return;
      out.set(index, quoted(next, this.text.charCodeAt(attr.raw[0] - 1) === 0x27));
    });
    return out;
  }

  /// Gli indici degli attributi di `element` che si tolgono: `fub:from`,
  /// `fub:to`, `fub:along` e `fub:inside` che nominano ciò che non entra, e
  /// `fub:style` di uno stile che non entra e che il disegno non ha.
  private dropped(element: ElementNode): ReadonlySet<number> {
    if (!this.rules.relink) return KEPT;
    let out: Set<number> | null = null;
    element.attrs.forEach((attr, index) => {
      if (attr.ns !== NS_FUB) return;
      if (isLinkName(attr.local) ? relinked(attr.local, attr.value, this.rules.rename) === null : attr.local === "style" && this.rules.rename(attr.value) === null && !this.rules.styled(attr.value)) {
        (out ??= new Set()).add(index);
      }
    });
    return out ?? KEPT;
  }

  /// Toglie l'attributo `attr` di `element`, con gli spazi che lo precedono.
  private drop(element: ElementNode, attr: Attr): void {
    let from = this.text.lastIndexOf(attr.name, attr.raw[0]);
    while (from > element.start && /[ \t\r\n]/.test(this.text[from - 1]!)) from--;
    this.edits.add(from, attr.raw[1] + 1, "");
  }

  /// Il valore nuovo di un attributo.
  private value(id: NodeId, element: ElementNode, attr: Attr): string {
    const { rename } = this.rules;
    if (attr.ns === NS_NONE && attr.local === "id") return this.rules.ids.get(id) ?? attr.value;
    if (attr.ns === NS_FUB && attr.local === "name") return this.rules.named.get(id) ?? attr.value;
    if (this.rules.relink && attr.ns === NS_FUB && isLinkName(attr.local)) return relinked(attr.local, attr.value, rename) ?? attr.value;
    if (attr.ns === NS_FUB && attr.local === "style") return rename(attr.value) ?? attr.value;
    let next = /url\(/i.test(attr.value) ? renameUrls(attr.value, rename) : attr.value;
    if (attr.ns === NS_NONE && (attr.local === "fill" || attr.local === "stroke")) next = this.fallback(next);
    const fragment = /^#(.+)$/.exec(next);
    if (fragment !== null && (attr.local === "href" || (attr.ns !== NS_NONE && attr.ns !== NS_XML))) {
      next = `#${rename(fragment[1]!) ?? fragment[1]!}`;
    } else if (attr.ns === NS_NONE && IDREFS.has(attr.local)) {
      next = next.replace(/\S+/g, (token) => rename(token) ?? token);
    } else if (attr.ns === NS_NONE && (attr.local === "begin" || attr.local === "end") && element.ns === NS_SVG && ANIMATIONS.has(element.local)) {
      next = next.replace(TIMING, (whole: string, lead: string, space: string, name: string) => {
        const to = rename(name.replace(/\\(.)/g, "$1"));
        return to === null ? whole : `${lead}${space}${to}.`;
      });
    } else if (attr.local === "href" && (attr.ns === NS_NONE || attr.ns === NS_XLINK) && (isSvg(element, "image") || isSvg(element, "a")) && hrefKind(next).kind === "vault") {
      next = this.rules.href(next) ?? next;
    }
    return next;
  }

  /// Un colore che rimanda a un campione del disegno, col colore del
  /// campione come ripiego se ne scrive un altro.
  private fallback(value: string): string {
    const used = paintReference(value);
    if (used === null || used.fallback === null) return value;
    const color = this.rules.colors.get(used.id);
    return color === undefined || paintCode(used.fallback) === color ? value : `url(#${used.id}) ${color}`;
  }

  /// I prefissi dei nomi di `element` e dei suoi attributi.
  private uses(element: ElementNode): void {
    const colon = element.name.indexOf(":");
    this.used.add(colon < 0 ? null : element.name.slice(0, colon));
    for (const attr of element.attrs) {
      const c = attr.name.indexOf(":");
      if (c < 0) continue;
      const prefix = attr.name.slice(0, c);
      if (prefix !== "xmlns" && prefix !== "xml") this.used.add(prefix);
    }
  }

  /// Un foglio di stile: i riferimenti e, se va chiuso in un gruppo, i
  /// selettori. Un foglio con dentro altro che testo resta com'è.
  private sheet(element: ElementNode): void {
    if (element.closeStart === null) return;
    const read = sheetText(this.doc, element);
    if (read === null) return;
    const [css, cdata] = read;
    const next = restyle(css, { rename: this.rules.rename, scope: this.rules.sheets! });
    if (next === css) return;
    const body = cdata ? `<![CDATA[${next.replace(/]]>/g, "]]]]><![CDATA[>")}]]>` : escapeText(next);
    this.edits.add(element.openEnd, element.closeStart, body);
  }

  /// Un riferimento a un'entità, sostituito dal suo testo.
  private entity(node: EntityRefNode): void {
    const text = this.doc.plainEntity(node.name);
    if (text === null) throw new Unresolved(node.name);
    this.edits.add(node.start, node.end, escapeText(text));
  }
}
