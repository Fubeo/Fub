// L'inchiostro asciutto della lavagna: i tratti finiti, disegnati dove vivono.
//
// Un tratto ancorato a una scheda si disegna **dentro** l'elemento della
// scheda (`paintCard`), in un SVG `canvas-ink-card` largo e alto
// quanto lei. Dentro c'è un SVG annidato per ogni misura di riferimento, e il
// modo della scheda (`ink-fit.ts`) dice come segue la misura di adesso: con
// `scale` (immagini e PDF) l'annidato è largo quanto la scheda, col `viewBox`
// della misura di riferimento e `xMidYMid meet`, e il browser scala i percorsi
// senza deformarli; con `fixed` è largo `W` e alto `H`, senza scala, e ciò che
// esce dalla scheda si vede. I percorsi restano nelle unità in cui sono
// scritti. Così, quando la lavagna sposta o ridimensiona una scheda cambiando
// solo posizione e misura dell'elemento (`#renderLive`), l'inchiostro la segue
// senza ridisegnare niente. L'inchiostro libero si disegna sullo stage (`paintBoard`), dopo le
// schede, in coordinate della lavagna, come gli archi.
//
// Il colore è un valore del file e va come attributo `fill` (mai una
// variabile del tema); quanto copre la penna (l'evidenziatore) va in
// `fill-opacity`, così la gomma che attenua (`opacity`) si somma. Ciò che si ridisegna si riconcilia: un tratto uguale
// tiene il suo `<path>` e non si riscrive.
//
// `InkPathCache` tiene i percorsi già calcolati per id, inchiostro e pennello,
// e a ogni giro lascia andare quelli che non si disegnano più.

import type { InkFitMode } from "./ink-fit";

const SVG_NS = "http://www.w3.org/2000/svg";

/// Il `preserveAspectRatio` del modo `scale`: lo stesso fattore nei due sensi,
/// il minore, centrato. È la formula di `inkFit` detta al browser.
export const INK_SCALE_ASPECT = "xMidYMid meet";

/// L'opacità di un tratto preso dalla gomma: la stessa di `FADED_OPACITY` di
/// `editors/spatial/painter/svg-dom.ts`, come attributo del percorso.
export const INK_FADED_OPACITY = "0.25";

/// La misura di una scheda nelle unità in cui il tratto è scritto.
export interface InkRef {
  readonly width: number;
  readonly height: number;
}

/// Un tratto finito, pronto da disegnare.
export interface DryStroke {
  /// Unico nel suo livello.
  readonly id: string;
  /// Il percorso SVG del contorno, nelle unità della misura di riferimento
  /// (della lavagna se il tratto è libero).
  readonly path: string;
  /// Il colore del file.
  readonly fill: string;
  /// Quanto copre la penna, sotto 1 (l'evidenziatore 0,5): va in
  /// `fill-opacity`, senza `multiply` (A22); manca se copre tutto.
  readonly opacity?: number;
  /// La misura della scheda quando il tratto è stato scritto; `null` per
  /// l'inchiostro libero.
  readonly ref: InkRef | null;
  /// Preso dalla gomma e non ancora cancellato: si vede attenuato.
  readonly faded?: boolean;
  /// Tagliato dalla gomma «Solo il pezzo» e non ancora scritto: il contorno
  /// dei pezzi che restano, pieno sopra il tratto attenuato (vuoto se non ne
  /// resta nessuno).
  readonly cut?: string;
}

/// Disegna i tratti `strokes` dentro l'elemento della scheda `host`, nell'ordine
/// (il primo sotto), nel modo `mode` della scheda (`inkFitMode`). Una lista
/// vuota toglie l'inchiostro della scheda.
export function paintCard(host: HTMLElement, strokes: readonly DryStroke[], mode: InkFitMode): void {
  const svg = ownLayer(host, "canvas-ink-card", strokes.length > 0);
  if (!svg) return;
  setAttr(svg, "width", "100%");
  setAttr(svg, "height", "100%");
  // I tratti consecutivi con la stessa misura vanno nello stesso SVG annidato: con
  // un tratto solo per misura l'ordine dei tratti è quello della lista.
  const runs: DryStroke[][] = [];
  for (const stroke of strokes) {
    const last = runs[runs.length - 1];
    if (last && sameRef(last[0]!.ref, stroke.ref)) last.push(stroke);
    else runs.push([stroke]);
  }
  for (let i = 0; i < runs.length; i++) {
    const run = runs[i]!;
    const nested = childAt(svg, i, "svg");
    const ref = run[0]!.ref;
    // Senza misura (un tratto libero dato a una scheda) le unità sono i pixel
    // della scheda, in tutti e due i modi.
    const fixed = ref !== null && mode === "fixed" ? ref : null;
    const scaled = ref !== null && mode === "scale" ? ref : null;
    setAttr(nested, "width", fixed ? String(fixed.width) : "100%");
    setAttr(nested, "height", fixed ? String(fixed.height) : "100%");
    setAttr(nested, "viewBox", scaled ? `0 0 ${scaled.width} ${scaled.height}` : null);
    setAttr(nested, "preserveAspectRatio", scaled ? INK_SCALE_ASPECT : null);
    paintPaths(nested, run);
  }
  trim(svg, runs.length);
}

/// Disegna l'inchiostro libero sullo stage, dopo le schede, in coordinate della
/// lavagna. Una lista vuota lo toglie.
export function paintBoard(stage: HTMLElement, strokes: readonly DryStroke[]): void {
  const svg = ownLayer(stage, "canvas-ink-board", strokes.length > 0);
  if (!svg) return;
  // Dopo le schede: sopra di loro anche se lo stage ne ha aggiunte.
  if (stage.lastElementChild !== svg) stage.append(svg);
  paintPaths(svg, strokes);
}

/// Attenua (`faded`) o rimette il percorso già disegnato del tratto `id`:
/// dentro la scheda `owner` con `"card"` (`paintCard`), sullo stage `owner`
/// con `"board"` (`paintBoard`). Tocca un attributo solo, senza ridisegnare
/// il resto. `false` se il percorso non c'è.
export function fadeInkStroke(owner: HTMLElement, where: "card" | "board", id: string, faded: boolean): boolean {
  const path = strokePath(owner, where, id);
  if (!path) return false;
  setAttr(path, "opacity", faded ? INK_FADED_OPACITY : null);
  return true;
}

/// Mostra il taglio della gomma «Solo il pezzo» sul percorso già disegnato
/// del tratto `id` (dove `fadeInkStroke`): il tratto attenuato e, subito dopo,
/// un `<path data-ink-cut>` pieno col contorno `cut` dei pezzi che restano;
/// `null` toglie il taglio e rimette il tratto. Senza ridisegnare il resto.
/// `false` se il percorso non c'è.
export function cutInkStroke(owner: HTMLElement, where: "card" | "board", id: string, cut: string | null): boolean {
  const path = strokePath(owner, where, id);
  if (!path) return false;
  setAttr(path, "opacity", cut === null ? null : INK_FADED_OPACITY);
  let overlay = path.nextElementSibling;
  if (overlay && !(overlay.localName === "path" && overlay.hasAttribute("data-ink-cut"))) overlay = null;
  if (cut === null || cut === "") {
    overlay?.remove();
    return true;
  }
  if (!overlay) {
    overlay = document.createElementNS(SVG_NS, "path");
    path.after(overlay);
  }
  setAttr(overlay, "data-ink-cut", id);
  setAttr(overlay, "d", cut);
  setAttr(overlay, "fill", path.getAttribute("fill"));
  setAttr(overlay, "fill-opacity", path.getAttribute("fill-opacity"));
  return true;
}

/// Il percorso disegnato del tratto `id` nel livello di `owner`.
function strokePath(owner: HTMLElement, where: "card" | "board", id: string): Element | null {
  const layer = where === "card" ? "canvas-ink-card" : "canvas-ink-board";
  for (const child of owner.children) {
    if (child.localName === "svg" && child.classList.contains(layer)) {
      return child.querySelector(`path[data-ink-stroke="${CSS.escape(id)}"]`);
    }
  }
  return null;
}

/// Il livello d'inchiostro figlio di `parent` con la classe `className`:
/// creato se serve e `wanted`, tolto se c'è e non serve.
function ownLayer(parent: HTMLElement, className: string, wanted: boolean): SVGSVGElement | null {
  let svg: SVGSVGElement | null = null;
  for (const child of parent.children) {
    if (child.localName === "svg" && child.namespaceURI === SVG_NS && child.classList.contains(className)) {
      svg = child as SVGSVGElement;
      break;
    }
  }
  if (!wanted) {
    svg?.remove();
    return null;
  }
  if (!svg) {
    svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("class", className);
    svg.setAttribute("aria-hidden", "true");
    parent.append(svg);
  }
  return svg;
}

/// Un `<path>` per tratto, nell'ordine, riusando quelli che ci sono; dopo un
/// tratto tagliato, il `<path data-ink-cut>` dei suoi pezzi.
function paintPaths(parent: SVGElement, strokes: readonly DryStroke[]): void {
  let n = 0;
  for (const stroke of strokes) {
    const path = childAt(parent, n++, "path");
    setAttr(path, "data-ink-cut", null);
    setAttr(path, "data-ink-stroke", stroke.id);
    setAttr(path, "d", stroke.path);
    setAttr(path, "fill", stroke.fill);
    const covers = fillOpacity(stroke);
    setAttr(path, "fill-opacity", covers);
    setAttr(path, "opacity", stroke.faded || stroke.cut !== undefined ? INK_FADED_OPACITY : null);
    if (!stroke.cut) continue;
    const overlay = childAt(parent, n++, "path");
    setAttr(overlay, "data-ink-stroke", null);
    setAttr(overlay, "data-ink-cut", stroke.id);
    setAttr(overlay, "d", stroke.cut);
    setAttr(overlay, "fill", stroke.fill);
    setAttr(overlay, "fill-opacity", covers);
    setAttr(overlay, "opacity", null);
  }
  trim(parent, n);
}

/// Il `fill-opacity` del tratto `stroke`: `null` se copre tutto.
function fillOpacity(stroke: DryStroke): string | null {
  const opacity = stroke.opacity;
  return opacity !== undefined && Number.isFinite(opacity) && opacity >= 0 && opacity < 1 ? String(opacity) : null;
}

/// Il figlio `index` di `parent` se è un `<name>` SVG, altrimenti uno nuovo al
/// suo posto.
function childAt(parent: Element, index: number, name: "svg" | "path"): SVGElement {
  const existing = parent.children[index];
  if (existing && existing.localName === name && existing.namespaceURI === SVG_NS) return existing as SVGElement;
  const fresh = document.createElementNS(SVG_NS, name);
  if (existing) existing.replaceWith(fresh);
  else parent.append(fresh);
  return fresh;
}

/// Toglie i figli di `parent` dal numero `keep` in poi.
function trim(parent: Element, keep: number): void {
  while (parent.children.length > keep) parent.lastElementChild!.remove();
}

/// Scrive un attributo solo se cambia; `null` lo toglie.
function setAttr(element: Element, name: string, value: string | null): void {
  if (value === null) {
    if (element.hasAttribute(name)) element.removeAttribute(name);
  } else if (element.getAttribute(name) !== value) {
    element.setAttribute(name, value);
  }
}

function sameRef(a: InkRef | null, b: InkRef | null): boolean {
  return a === b || (a !== null && b !== null && a.width === b.width && a.height === b.height);
}

/// Un percorso calcolato, con ciò da cui viene.
interface CachedPath {
  readonly ink: string;
  readonly brush: string;
  readonly path: string;
  used: boolean;
}

/// I percorsi già calcolati, per id del tratto, inchiostro (la stringa dei
/// punti) e pennello. Gli id sono unici nel livello e non nella lavagna: sotto
/// lo stesso id stanno quante varianti servono. Il confronto è fra stringhe
/// (di solito le stesse, quindi immediato): niente hash a ogni giro.
export class InkPathCache {
  readonly #entries = new Map<string, CachedPath[]>();

  /// Il percorso del tratto `id` con inchiostro `ink` e pennello `brush`:
  /// quello già calcolato, o quello che dà `compute`, che si tiene.
  path(id: string, ink: string, brush: string, compute: () => string): string {
    let variants = this.#entries.get(id);
    const found = variants?.find((each) => each.ink === ink && each.brush === brush);
    if (found) {
      found.used = true;
      return found.path;
    }
    const path = compute();
    if (!variants) {
      variants = [];
      this.#entries.set(id, variants);
    }
    variants.push({ ink, brush, path, used: true });
    return path;
  }

  /// La fine di un giro di disegno: lascia andare i percorsi che il giro non
  /// ha chiesto.
  sweep(): void {
    for (const [id, variants] of this.#entries) {
      const kept = variants.filter((each) => each.used);
      if (kept.length === 0) {
        this.#entries.delete(id);
        continue;
      }
      for (const each of kept) each.used = false;
      if (kept.length !== variants.length) this.#entries.set(id, kept);
    }
  }

  /// Quanti percorsi tiene.
  get size(): number {
    let count = 0;
    for (const variants of this.#entries.values()) count += variants.length;
    return count;
  }

  clear(): void {
    this.#entries.clear();
  }
}
