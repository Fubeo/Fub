// Il painter SVG DOM, gli elementi: gli attributi dipinti, le forme, le
// risorse e le immagini del vault che il painter e le miniature creano, e
// gli aiuti che riconciliano i figli (`../svg-dom.ts`).

import { openLifetime, type Lifetime } from "../../../../ui/lifetime";
import type { Elem } from "../../scene/serialize";
import { blendStyle } from "../../scene/values";
import {
  DEF_ATTRIBUTES,
  DEF_CHILDREN,
  IMAGE_PLACEHOLDER,
  PAINTED_ATTRIBUTES,
  RESOURCE_TAGS,
  type PaintAttr,
  type PaintDef,
  type PaintNode,
  type PaintResource,
  type PaintShape,
} from "../paint";
import { type LiveDom, liveId, liveValue, type PainterOptions, setFamily, SVG, writtenFamilies, XML } from "./base";

/// Vero se lo strato racchiuso da `containers` sta dentro l'ultimo dei
/// contenitori `chain`: `chain` comincia come `containers`.
export function inside(containers: readonly object[], chain: readonly object[]): boolean {
  return chain.length <= containers.length && chain.every((key, i) => containers[i] === key);
}

/// L'opacità che un attributo `opacity` dipinge: un numero o una
/// percentuale, fra 0 e 1; 1 se manca o non si legge.
// --- forme -------------------------------------------------------------------

/// Gli attributi dipinti `attrs` su `el`, al posto di `previous`, coi
/// riferimenti alle risorse sugli id vivi di `dom` e le famiglie vive.
export function setPainted(el: SVGElement, attrs: readonly PaintAttr[], previous: readonly PaintAttr[], dom: LiveDom): void {
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
export function setBlend(el: SVGElement, value: string | null): void {
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
export function setSymbol(el: SVGElement, id: string, dom: LiveDom): void {
  el.setAttribute("id", liveId(dom.prefix, id));
  el.setAttribute("overflow", "visible");
}

export function setCommon(el: SVGElement, id: string | null, space: string | null): void {
  if (id === null) el.removeAttribute("data-scene-id");
  else el.setAttribute("data-scene-id", id);
  if (space === null) el.removeAttributeNS(XML, "space");
  else el.setAttributeNS(XML, "xml:space", space);
}

/// Le copie che l'anteprima di un ritaglio fa di un'immagine, per ogni
/// immagine: l'URL che arriva dopo, perché il vault lo risolve a parte, va
/// anche a loro.
export const copiesOf = new WeakMap<Element, Set<Element>>();

/// Scrive l'URL di `el` e quello delle sue copie.
export function setHref(el: Element, url: string): void {
  el.setAttribute("href", url);
  for (const copy of copiesOf.get(el) ?? []) copy.setAttribute("href", url);
}

export function showVaultImage(el: SVGElement, path: string, resolve: PainterOptions["images"], imageLife: Lifetime): void {
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
export function shapeElement(
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
  // Un'istanza rimanda al simbolo vivo, una copia all'originale, come un
  // `url(#…)`.
  const target = shape.symbol ?? shape.original;
  if (target !== undefined) el.setAttribute("href", `#${liveId(dom.prefix, target)}`);
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
export function defElement(def: PaintDef, parent: string | null, dom: LiveDom): SVGElement | null {
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
export function paintDefOf(elem: Elem): PaintDef {
  return { tag: elem.tag, attrs: Object.entries(elem.attrs), space: null, children: (elem.children ?? []).map(paintDefOf) };
}

/// L'elemento vivo di `resource`, con l'id vivo sotto il prefisso di `dom`.
export function resourceElement(resource: PaintResource, dom: LiveDom): SVGElement | null {
  const el = defElement(resource, null, dom);
  el?.setAttribute("id", liveId(dom.prefix, resource.id));
  return el;
}

// --- miniature ----------------------------------------------------------------

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

export function opacityOf(value: string | undefined): number {
  if (value === undefined) return 1;
  const text = value.trim();
  const number = text.endsWith("%") ? Number(text.slice(0, -1)) / 100 : Number(text);
  return text === "" || text === "%" || !Number.isFinite(number) ? 1 : Math.min(1, Math.max(0, number));
}

export function push<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const list = map.get(key);
  if (list === undefined) map.set(key, [value]);
  else list.push(value);
}

/// Mette i figli di `parent` nell'ordine di `children`, spostando solo
/// quelli fuori posto. `children` contiene tutti i figli che restano.
export function place(parent: Element, children: readonly Element[]): void {
  let cursor = parent.firstChild;
  for (const child of children) {
    if (child === cursor) {
      cursor = cursor.nextSibling;
      continue;
    }
    parent.insertBefore(child, cursor);
  }
}
