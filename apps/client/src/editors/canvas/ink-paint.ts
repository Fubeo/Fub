// L'inchiostro asciutto della lavagna: i tratti finiti, disegnati dove vivono.
//
// Un tratto ancorato a una scheda si disegna **dentro** l'elemento della
// scheda (`paintCard`), in un SVG `canvas-ink-card` largo e alto
// quanto lei. Dentro c'è un SVG annidato per ogni misura di riferimento, e il
// modo della scheda (`ink-fit.ts`) dice come segue la misura di adesso: con
// `scale` (immagini e PDF) l'annidato è largo quanto la scheda, col `viewBox`
// della misura di riferimento e `xMidYMid meet`, e il browser scala i percorsi
// senza deformarli. Se la scheda dice la proporzione del suo contenuto
// (`contentAspect`, T39), il `viewBox` è il riquadro del contenuto nella
// misura di riferimento (`contentBox`): `xMidYMid meet` lo porta sul
// riquadro del contenuto della scheda di adesso, ed è `inkFit` con
// `aspect`. Con `fixed` l'annidato è largo `W` e alto `H`, senza scala, e ciò che
// esce dalla scheda si vede. I percorsi restano nelle unità in cui sono
// scritti. Così, quando la lavagna sposta o ridimensiona una scheda cambiando
// solo posizione e misura dell'elemento (`#renderLive`), l'inchiostro la segue
// senza ridisegnare niente. L'inchiostro di una pagina di PDF (T19) si
// disegna solo quando la scheda mostra quella pagina, sul rettangolo dove la
// mostra, e la tela lo ridisegna quando la pagina cambia o la scheda cambia
// misura. L'inchiostro libero si disegna sullo stage (`paintBoard`), dopo le
// schede, in coordinate della lavagna, come gli archi.
//
// Il colore è un valore del file e va come attributo `fill` (mai una
// variabile del tema); quanto copre la penna (l'evidenziatore) va in
// `fill-opacity`, così la gomma che attenua (`opacity`) si somma. Ciò che si ridisegna si riconcilia: un tratto uguale
// tiene il suo `<path>` e non si riscrive.
//
// `InkPathCache` tiene i percorsi già calcolati per id, inchiostro e pennello,
// e a ogni giro lascia andare quelli che non si disegnano più.

import type { CardPageBox } from "./cards";
import { contentBox, validAspect, type InkFitMode } from "./ink-fit";

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
  /// La misura della scheda quando il tratto è stato scritto (della pagina,
  /// in punti PDF, con `page`); `null` per l'inchiostro libero.
  readonly ref: InkRef | null;
  /// La pagina dell'ancora `page` (T19): il tratto si disegna solo quando la
  /// scheda mostra quella pagina. Manca con le altre ancore.
  readonly page?: number;
  /// Preso dalla gomma e non ancora cancellato: si vede attenuato.
  readonly faded?: boolean;
  /// Tagliato dalla gomma «Solo il pezzo» e non ancora scritto: il contorno
  /// dei pezzi che restano, pieno sopra il tratto attenuato (vuoto se non ne
  /// resta nessuno).
  readonly cut?: string;
}

/// Il `preserveAspectRatio` dell'inchiostro di pagina (T19): lo stesso
/// fattore nei due sensi, il minore, dall'angolo in alto a sinistra della
/// pagina. È `pageFit` di `ink-record.ts` detto al browser.
export const INK_PAGE_ASPECT = "xMinYMin meet";

/// Disegna i tratti `strokes` dentro l'elemento della scheda `host`, nell'ordine
/// (il primo sotto), nel modo `mode` della scheda (`inkFitMode`). Una lista
/// vuota toglie l'inchiostro della scheda.
///
/// Un tratto con l'ancora di pagina (`page`, T19) si disegna solo se `page`
/// dice che la scheda mostra quella pagina: la pagina scritta va sul
/// rettangolo `page.rect` (`INK_PAGE_ASPECT`), dentro un SVG che taglia alla
/// scheda, così un tratto che esce dalla pagina si vede fino al bordo della
/// scheda e non oltre. Gli altri tratti di pagina non hanno un percorso.
///
/// `aspect` è la proporzione del contenuto che la scheda mostra adesso
/// (`contentAspect`, T39): con `scale` l'inchiostro segue il contenuto
/// (`inkFit` con `aspect`); `null`, o una proporzione che non vale, segue
/// tutta la scheda.
export function paintCard(
  host: HTMLElement,
  strokes: readonly DryStroke[],
  mode: InkFitMode,
  page: CardPageBox | null = null,
  aspect: number | null = null,
): void {
  const shown = strokes.filter((stroke) => stroke.page === undefined || (page !== null && stroke.page === page.page));
  const svg = ownLayer(host, "canvas-ink-card", shown.length > 0);
  if (!svg) return;
  setAttr(svg, "width", "100%");
  setAttr(svg, "height", "100%");
  // I tratti consecutivi con la stessa misura vanno nello stesso SVG annidato: con
  // un tratto solo per misura l'ordine dei tratti è quello della lista.
  const runs: DryStroke[][] = [];
  for (const stroke of shown) {
    const last = runs[runs.length - 1];
    if (last && sameRef(last[0]!.ref, stroke.ref) && last[0]!.page === stroke.page) last.push(stroke);
    else runs.push([stroke]);
  }
  for (let i = 0; i < runs.length; i++) {
    const run = runs[i]!;
    const nested = childAt(svg, i, "svg");
    const ref = run[0]!.ref;
    if (run[0]!.page !== undefined && page !== null && ref !== null) {
      paintPageRun(nested, run, ref, page);
      continue;
    }
    setAttr(nested, "data-ink-page", null);
    clip(nested, false);
    // Senza misura (un tratto libero dato a una scheda) le unità sono i pixel
    // della scheda, in tutti e due i modi.
    const fixed = ref !== null && mode === "fixed" ? ref : null;
    const scaled = ref !== null && mode === "scale" ? ref : null;
    setAttr(nested, "width", fixed ? String(fixed.width) : "100%");
    setAttr(nested, "height", fixed ? String(fixed.height) : "100%");
    setAttr(nested, "viewBox", scaled ? scaleViewBox(scaled, aspect) : null);
    setAttr(nested, "preserveAspectRatio", scaled ? INK_SCALE_ASPECT : null);
    paintPaths(nested, run);
  }
  trim(svg, runs.length);
}

/// I tratti `run` della pagina `page`: `nested` è largo e alto quanto la
/// scheda e la taglia (lo stile della pelle lascia uscire gli SVG annidati,
/// qui si chiude dallo stile in linea); dentro, un SVG sul rettangolo della
/// pagina, con la misura scritta `ref` come `viewBox`, che non taglia.
function paintPageRun(nested: SVGElement, run: readonly DryStroke[], ref: InkRef, page: CardPageBox): void {
  setAttr(nested, "data-ink-page", String(page.page));
  setAttr(nested, "width", "100%");
  setAttr(nested, "height", "100%");
  setAttr(nested, "viewBox", null);
  setAttr(nested, "preserveAspectRatio", null);
  clip(nested, true);
  const inner = childAt(nested, 0, "svg");
  setAttr(inner, "x", String(page.rect.x));
  setAttr(inner, "y", String(page.rect.y));
  setAttr(inner, "width", String(page.rect.width));
  setAttr(inner, "height", String(page.rect.height));
  setAttr(inner, "viewBox", `0 0 ${ref.width} ${ref.height}`);
  setAttr(inner, "preserveAspectRatio", INK_PAGE_ASPECT);
  setAttr(inner, "overflow", "visible");
  paintPaths(inner, run);
  trim(nested, 1);
}

/// Il `viewBox` di un SVG annidato `scale` con la misura scritta `ref`: tutta
/// la misura, o col contenuto di proporzione `aspect` il suo riquadro
/// (`contentBox`), che `xMidYMid meet` porta sul riquadro del contenuto
/// della scheda di adesso.
function scaleViewBox(ref: InkRef, aspect: number | null): string {
  const box = validAspect(aspect) ? contentBox(ref, aspect) : null;
  if (box === null || !(box.width > 0 && box.height > 0)) return `0 0 ${ref.width} ${ref.height}`;
  return `${box.x} ${box.y} ${box.width} ${box.height}`;
}

/// Taglia (`true`) o lascia uscire ciò che l'SVG annidato `nested` disegna.
function clip(nested: SVGElement, on: boolean): void {
  if (on) {
    if (nested.style.getPropertyValue("overflow") !== "hidden") nested.style.setProperty("overflow", "hidden");
  } else if (nested.style.getPropertyValue("overflow") !== "") {
    nested.style.removeProperty("overflow");
  }
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

/// Come `fadeInkStroke` per tutti i tratti `ids` di un livello, in una
/// passata sola sui suoi percorsi: i tratti scelti col lazo (T86) possono
/// essere migliaia. Dà quanti percorsi ha toccato.
export function fadeInkStrokes(owner: HTMLElement, where: "card" | "board", ids: ReadonlySet<string>, faded: boolean): number {
  const layer = where === "card" ? "canvas-ink-card" : "canvas-ink-board";
  let touched = 0;
  for (const child of owner.children) {
    if (child.localName !== "svg" || !child.classList.contains(layer)) continue;
    for (const path of child.querySelectorAll("path[data-ink-stroke]")) {
      if (!ids.has(path.getAttribute("data-ink-stroke") ?? "")) continue;
      setAttr(path, "opacity", faded ? INK_FADED_OPACITY : null);
      touched += 1;
    }
    break;
  }
  return touched;
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
