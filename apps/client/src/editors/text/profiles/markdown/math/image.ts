// «Copia come immagine» di una formula (T65, E27): il PNG della formula come la
// disegna KaTeX nella nota. KaTeX scrive HTML e caratteri suoi, non un'immagine:
// la formula si disegna fuori dallo schermo e poi si ridipinge su una tela,
// pezzo per pezzo, con le stesse misure: il testo coi caratteri di KaTeX già
// caricati dalla pagina, le linee delle frazioni dai bordi, le radici e le
// frecce dai loro SVG. Niente `foreignObject`, che in alcuni motori sporca la
// tela e non si potrebbe più copiare.
//
// Si carica al primo «Copia come immagine», in un pezzo suo.
import { loadKatex, readOptions } from "../math";

/// I colori e la misura della formula nella nota.
export interface FormulaLook {
  readonly color: string;
  readonly background: string;
  readonly fontSize: string;
}

/// Quanto bordo resta intorno alla formula, in pixel CSS.
const PADDING = 6;
/// La densità del PNG: il doppio, perché resti nitido su uno schermo fitto.
const SCALE = 2;

type Box = { left: number; top: number; right: number; bottom: number };

function grow(box: Box | null, rect: DOMRect): Box | null {
  if (rect.width === 0 && rect.height === 0) return box;
  if (!box) return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom };
  return {
    left: Math.min(box.left, rect.left),
    top: Math.min(box.top, rect.top),
    right: Math.max(box.right, rect.right),
    bottom: Math.max(box.bottom, rect.bottom),
  };
}

function transparent(color: string): boolean {
  return color === "" || color === "transparent" || /rgba\([^)]*,\s*0\)$/.test(color);
}

/// Il contenitore più vicino che taglia ciò che esce (le frecce e le radici
/// di KaTeX sono SVG lunghi tagliati dal loro contenitore).
function clipOf(element: Element, root: Element): DOMRect | null {
  for (let up = element.parentElement; up && up !== root.parentElement; up = up.parentElement) {
    const style = getComputedStyle(up);
    if (style.overflow === "hidden" || style.overflowX === "hidden") return up.getBoundingClientRect();
  }
  return null;
}

/// Un SVG di KaTeX come immagine a sé: coi colori scritti, che fuori dalla
/// pagina non arrivano dal CSS.
async function svgImage(svg: SVGSVGElement, color: string, width: number, height: number): Promise<HTMLImageElement> {
  const copy = svg.cloneNode(true) as SVGSVGElement;
  copy.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  copy.setAttribute("width", String(width));
  copy.setAttribute("height", String(height));
  copy.setAttribute("fill", color);
  copy.setAttribute("stroke", color);
  for (const path of copy.querySelectorAll("path")) if (!path.hasAttribute("stroke")) path.setAttribute("stroke", "none");
  const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(copy)], { type: "image/svg+xml" }));
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    return image;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/// Ridipinge la formula disegnata in `root` (la `.katex-html` di KaTeX) su una
/// tela.
async function paint(root: Element, look: FormulaLook): Promise<HTMLCanvasElement> {
  let box: Box | null = grow(null, root.getBoundingClientRect());
  const texts: { node: Text; rect: DOMRect }[] = [];
  const elements: Element[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node instanceof Text) {
      if (!node.data.replace(/[\s​]/g, "")) continue;
      const range = document.createRange();
      range.selectNodeContents(node);
      const rect = range.getBoundingClientRect();
      box = grow(box, rect);
      texts.push({ node, rect });
    } else if (node instanceof Element) {
      elements.push(node);
      if (node.localName !== "svg") box = grow(box, node.getBoundingClientRect());
    }
  }
  if (!box) throw new Error("formula senza misura");
  const width = box.right - box.left + PADDING * 2;
  const height = box.bottom - box.top + PADDING * 2;
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(width * SCALE);
  canvas.height = Math.ceil(height * SCALE);
  const context = canvas.getContext("2d");
  if (!context || canvas.width === 0 || canvas.height === 0) throw new Error("tela non disponibile");
  context.scale(SCALE, SCALE);
  context.fillStyle = look.background;
  context.fillRect(0, 0, width, height);
  context.translate(PADDING - box.left, PADDING - box.top);
  // Gli sfondi, i bordi (le linee delle frazioni) e gli SVG, nell'ordine
  // dell'albero; poi il testo, sopra.
  for (const element of elements) {
    if (element.closest("svg") !== null && element.localName !== "svg") continue;
    const style = getComputedStyle(element);
    if (style.display === "none" || style.visibility === "hidden") continue;
    const rect = element.getBoundingClientRect();
    if (!transparent(style.backgroundColor)) {
      context.fillStyle = style.backgroundColor;
      context.fillRect(rect.left, rect.top, rect.width, rect.height);
    }
    const sides = [
      ["Top", rect.left, rect.top, rect.width, 0],
      ["Bottom", rect.left, rect.bottom, rect.width, 0],
      ["Left", rect.left, rect.top, 0, rect.height],
      ["Right", rect.right, rect.top, 0, rect.height],
    ] as const;
    for (const [side, x, y, w, h] of sides) {
      const size = parseFloat(style.getPropertyValue(`border-${side.toLowerCase()}-width`));
      const kind = style.getPropertyValue(`border-${side.toLowerCase()}-style`);
      if (!(size > 0) || kind === "none" || kind === "hidden") continue;
      context.fillStyle = style.getPropertyValue(`border-${side.toLowerCase()}-color`) || style.color;
      const dx = side === "Right" ? -size : 0;
      const dy = side === "Bottom" ? -size : 0;
      context.fillRect(x + dx, y + dy, w || size, h || size);
    }
    if (element instanceof SVGSVGElement && rect.width > 0 && rect.height > 0) {
      const image = await svgImage(element, style.color || look.color, rect.width, rect.height);
      const clip = clipOf(element, root);
      context.save();
      if (clip) {
        context.beginPath();
        context.rect(clip.left, clip.top, clip.width, clip.height);
        context.clip();
      }
      context.drawImage(image, rect.left, rect.top, rect.width, rect.height);
      context.restore();
    }
  }
  for (const { node, rect } of texts) {
    const parent = node.parentElement;
    if (!parent) continue;
    const style = getComputedStyle(parent);
    if (style.visibility === "hidden") continue;
    context.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
    context.fillStyle = style.color || look.color;
    context.textBaseline = "alphabetic";
    const metrics = context.measureText(node.data);
    const ascent = Number.isFinite(metrics.fontBoundingBoxAscent) ? metrics.fontBoundingBoxAscent : rect.height * 0.8;
    context.fillText(node.data, rect.left, rect.top + ascent);
  }
  return canvas;
}

/// Il PNG di una formula, coi colori e la misura della nota.
export async function formulaPng(tex: string, display: boolean, look: FormulaLook): Promise<Blob> {
  const library = await loadKatex();
  const host = document.createElement("div");
  host.setAttribute("aria-hidden", "true");
  // Fuori dallo schermo, ma disegnata: le misure servono vere.
  host.style.position = "fixed";
  host.style.left = "-100000px";
  host.style.top = "0";
  host.style.pointerEvents = "none";
  host.style.whiteSpace = "nowrap";
  host.style.color = look.color;
  host.style.fontSize = look.fontSize;
  library.render(tex, host, { ...readOptions(display, tex), output: "html" });
  document.body.append(host);
  try {
    host.getBoundingClientRect();
    await document.fonts.ready;
    const root = host.querySelector(".katex-html") ?? host;
    const canvas = await paint(root, look);
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("PNG non prodotto"))), "image/png");
    });
  } finally {
    host.remove();
  }
}

/// I colori e la misura della formula dove sta: il colore del testo, il primo
/// fondo pieno risalendo la pagina, la misura del carattere.
export function lookOf(element: Element): FormulaLook {
  const style = getComputedStyle(element);
  let background = "#ffffff";
  for (let up: Element | null = element; up; up = up.parentElement) {
    const color = getComputedStyle(up).backgroundColor;
    if (!transparent(color)) {
      background = color;
      break;
    }
  }
  return { color: style.color || "#000000", background, fontSize: style.fontSize || "16px" };
}
