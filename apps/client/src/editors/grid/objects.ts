// Gli oggetti di un foglio nella griglia: grafici, grafici sparkline,
// immagini e forme (`fub_abi::GridObject`).
//
// Un grafico arriva disegnato in SVG dal provider, e si mostra come immagine:
// un SVG in un `<img>` non esegue niente e non legge niente della pagina.
// Un'immagine arriva in base64 con la sua impronta, una volta sola: la shell
// la tiene qui e dice all'host quali ha già (`known_media`). Una forma arriva
// come aspetto, e la disegna la shell.
import type { GridObject, GridShape } from "../../host/contract";
import { MAX_GRID_KNOWN_MEDIA } from "../../host/contract";
import { t } from "../../i18n/strings";

const SVG = "http://www.w3.org/2000/svg";
/// I byte che le immagini tenute occupano, al più: oltre, le più vecchie si
/// lasciano, e una finestra dopo le riporta.
const MEDIA_CACHE_BYTES = 64 * 1024 * 1024;
/// Da punti a pixel a 96 dpi.
const POINT = 96 / 72;

/// Le immagini lette, per impronta, come indirizzi `data:` pronti.
export class GridMediaCache {
  readonly #urls = new Map<string, string>();
  #bytes = 0;

  /// Tiene i byte che gli oggetti portano. Dice se ne ha presi di nuovi.
  remember(objects: readonly GridObject[]): boolean {
    let added = false;
    for (const object of objects) {
      const media = object.media;
      if (!media || media.data === null || this.#urls.has(media.key)) continue;
      // Il tipo è uno di `GRID_MEDIA_TYPES`, e i byte sono base64: la
      // finestra l'ha controllato.
      const url = `data:${media.mime};base64,${media.data}`;
      this.#urls.set(media.key, url);
      this.#bytes += url.length;
      added = true;
    }
    for (const [key, url] of this.#urls) {
      if (this.#bytes <= MEDIA_CACHE_BYTES) break;
      this.#urls.delete(key);
      this.#bytes -= url.length;
    }
    return added;
  }

  url(key: string): string | null {
    return this.#urls.get(key) ?? null;
  }

  /// Le chiavi da dire all'host: le ultime prese, entro il limite.
  known(): string[] {
    const keys = [...this.#urls.keys()];
    return keys.slice(Math.max(0, keys.length - MAX_GRID_KNOWN_MEDIA));
  }

  /// Un oggetto mostra un'immagine che nessuna finestra ha ancora portato.
  missing(objects: readonly GridObject[]): boolean {
    return objects.some((object) => object.media !== null && object.media.data === null && !this.#urls.has(object.media.key));
  }

  clear(): void {
    this.#urls.clear();
    this.#bytes = 0;
  }
}

/// Il nome di un oggetto per chi non lo vede: il tipo, e il testo
/// alternativo o quello della forma.
export function objectLabel(object: GridObject): string {
  const text = object.alt || (object.shape && object.shape.kind !== "icon" && object.shape.kind !== "ink" ? object.shape.text : "");
  const kind = t(`grid.object.kind.${object.kind}`);
  const name = text.trim().split(/\s+/u).join(" ").slice(0, 80);
  return name ? t("grid.object.named", { kind, name }) : kind;
}

/// Il contenuto di un oggetto, a misura `width`×`height` in pixel dello
/// schermo; `scale` porta i pixel del file a quelli dello schermo.
export function drawObject(
  object: GridObject,
  width: number,
  height: number,
  scale: number,
  media: GridMediaCache,
  font: string,
): HTMLElement | SVGElement {
  if (object.missing !== null) return placeholder(t(object.missing === "too_large" ? "grid.object.too_large" : "grid.object.unsupported"));
  if (object.svg !== null) {
    return image(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(object.svg)}`);
  }
  if (object.media) {
    const url = media.url(object.media.key);
    return url ? image(url) : placeholder("");
  }
  if (object.shape) return drawShape(object.shape, width, height, scale, font);
  return placeholder("");
}

function image(src: string): HTMLElement {
  const element = document.createElement("img");
  element.className = "grid-object-image";
  element.alt = "";
  element.draggable = false;
  element.decoding = "async";
  element.src = src;
  return element;
}

function placeholder(text: string): HTMLElement {
  const element = document.createElement("div");
  element.className = "grid-object-missing";
  element.textContent = text;
  return element;
}

function svgElement<K extends keyof SVGElementTagNameMap>(name: K, attributes: Record<string, string | number>): SVGElementTagNameMap[K] {
  const element = document.createElementNS(SVG, name);
  for (const [attribute, value] of Object.entries(attributes)) element.setAttribute(attribute, String(value));
  return element;
}

/// I punti di un tratto a mano libera (`x,y;x,y;…`, in pixel del file), a
/// misura dello schermo; quelli che non si leggono si saltano.
function inkPoints(text: string, scale: number): string {
  const out: string[] = [];
  for (const pair of text.split(";").slice(0, 10_000)) {
    const [x, y] = pair.split(",").map(Number);
    if (Number.isFinite(x) && Number.isFinite(y)) out.push(`${(x * scale).toFixed(1)},${(y * scale).toFixed(1)}`);
  }
  return out.join(" ");
}

/// Una forma: la figura in SVG, e sopra il suo testo.
function drawShape(shape: GridShape, width: number, height: number, scale: number, font: string): HTMLElement {
  const box = document.createElement("div");
  box.className = `grid-object-shape ${shape.kind.replace(/_/gu, "-")}`;
  const stroke = Math.max(1, Math.round(scale));
  const paint = {
    fill: shape.fill ?? "none",
    stroke: shape.line ?? "none",
    "stroke-width": stroke,
    "vector-effect": "non-scaling-stroke",
  };
  const figure = svgElement("svg", {
    width: Math.max(width, 1),
    height: Math.max(height, 1),
    viewBox: `0 0 ${Math.max(width, 1)} ${Math.max(height, 1)}`,
    "aria-hidden": "true",
    focusable: "false",
  });
  figure.setAttribute("class", "grid-object-figure");
  const inset = stroke / 2;
  const w = Math.max(width - stroke, 0);
  const h = Math.max(height - stroke, 0);
  switch (shape.kind) {
    case "rectangle":
    case "text_box":
      figure.append(svgElement("rect", { x: inset, y: inset, width: w, height: h, ...paint }));
      break;
    case "icon":
      figure.append(svgElement("rect", { x: inset, y: inset, width: w, height: h, rx: Math.min(w, h) / 6, ...paint, stroke: shape.line ?? shape.text_color }));
      break;
    case "rounded_rectangle":
      // Il raggio di serie di Excel: un sesto del lato più corto.
      figure.append(svgElement("rect", { x: inset, y: inset, width: w, height: h, rx: Math.min(w, h) / 6, ...paint }));
      break;
    case "ellipse":
      figure.append(svgElement("ellipse", { cx: width / 2, cy: height / 2, rx: w / 2, ry: h / 2, ...paint }));
      break;
    case "triangle":
      figure.append(svgElement("polygon", { points: `${width / 2},${inset} ${width - inset},${height - inset} ${inset},${height - inset}`, ...paint }));
      break;
    case "line":
    case "arrow": {
      const line = shape.line ?? shape.fill ?? shape.text_color;
      figure.append(svgElement("line", { x1: 0, y1: 0, x2: width, y2: height, stroke: line, "stroke-width": stroke }));
      if (shape.kind === "arrow") {
        const angle = Math.atan2(height, width);
        const head = 8 * Math.max(scale, 0.5);
        const spread = Math.PI / 7;
        const point = (theta: number) => `${(width - head * Math.cos(theta)).toFixed(1)},${(height - head * Math.sin(theta)).toFixed(1)}`;
        figure.append(svgElement("polygon", { points: `${width},${height} ${point(angle - spread)} ${point(angle + spread)}`, fill: line }));
      }
      break;
    }
    case "ink":
      figure.append(svgElement("polyline", {
        points: inkPoints(shape.text, scale),
        fill: "none",
        stroke: shape.line ?? shape.text_color,
        "stroke-width": Math.max(stroke, 2),
        "stroke-linecap": "round",
        "stroke-linejoin": "round",
      }));
      break;
  }
  box.append(figure);
  const text = shape.kind === "ink" ? "" : shape.text;
  if (text) {
    const label = document.createElement("div");
    label.className = "grid-object-text";
    label.textContent = text;
    label.dir = shape.right_to_left ? "rtl" : "ltr";
    label.style.color = shape.text_color;
    label.style.fontFamily = shape.font ? `"${shape.font.replace(/["\\]/gu, "")}", ${font}` : font;
    label.style.fontSize = `${(shape.font_size * POINT * scale).toFixed(2)}px`;
    label.style.fontWeight = shape.bold ? "700" : "400";
    label.style.fontStyle = shape.italic ? "italic" : "normal";
    label.style.textAlign = shape.align;
    label.style.justifyContent = shape.anchor === "top" ? "flex-start" : shape.anchor === "bottom" ? "flex-end" : "center";
    label.style.padding = `${(3.6 * POINT * scale).toFixed(1)}px ${(7.2 * POINT * scale).toFixed(1)}px`;
    box.append(label);
  }
  return box;
}
