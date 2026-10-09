// Il lettore dei file di Excalidraw (`.excalidraw`, JSON): dagli elementi al
// diagramma da importare (`diagram.ts`), con le note di ciò che non entra.
//
// - **Le forme** restano forme: il rettangolo col suo angolo tondo, l'ellisse,
//   il rombo della raccolta. Il riempimento pieno resta pieno; il tratteggio
//   a mano (`hachure`, `cross-hatch`) diventa una campitura a righe, del
//   colore del riempimento e col passo che Excalidraw gli dà.
// - **Il testo dentro una forma** ne diventa l'etichetta, e quello su una
//   freccia l'etichetta del connettore; un testo a sé resta a punto, o in area
//   se in Excalidraw ha una larghezza fissa.
// - **Le frecce** agganciate, dritte o a gomito diventano connettori, coi capi
//   sugli stessi oggetti; una freccia libera con più punti resta una linea
//   con le punte, uguale.
// - **Il tratto a mano libera** diventa un tratto della Penna, con la
//   pressione se il file la ha e coi parametri del pennello di Excalidraw.
// - **I gruppi** restano gruppi, e le cornici (`frame`) diventano tavole.
// - **Il tratto «a mano»** di Excalidraw (`roughness`) e i caratteri a mano
//   non ci sono: le linee sono pulite e i testi in Inter, e una nota lo dice.

import { MAX_ELBOW_POINTS, type Anchor, type ConnectorKind } from "../scene/connectors";
import type { Segment } from "../scene/geometry";
import type { Point } from "../scene/matrix";
import type { Dash } from "../tools/outline";
import { TEXT_FAMILY } from "../tools/text";
import type { TipShape } from "../tools/tips";
import { fitCubic, orthogonal, runningLengths, sampled, smoothSegments } from "./curves";
import { boxOf, hexColor, Notes, type Board, type Content, type Diagram, type End, type Fill, type Flip, type Form, type Hook, type Look, type Node, type Spin, type Type } from "./diagram";

/// Il carattere a larghezza fissa di FubDraw.
const MONO = "JetBrains Mono, monospace";

/// Quanto il connettore curvo può scostarsi dalla freccia disegnata prima
/// che il rapporto lo dica: 4 unità, o il 3% della sua lunghezza se è di più.
const ROUTE_TOLERANCE = 4;
const ROUTE_SHARE = 0.03;

/// Una freccia più corta di così non porta le punte.
const SHORT_ARROW = 4;

/// Il margine fra un contenitore e il suo testo (`BOUND_TEXT_PADDING`).
const BOUND_PAD = 5;

/// La larghezza a cui va a capo il testo di `container`
/// (`getMaxContainerWidth`): quella del rettangolo, del rombo o del
/// rettangolo nell'ellisse, meno il margine.
function maxWidthIn(container: Element): number {
  const width = Math.abs(container.width);
  const inner = container.type === "ellipse" ? Math.round((width / 2) * Math.SQRT2) : container.type === "diamond" ? Math.round(width / 2) : width;
  return Math.max(1, inner - 2 * BOUND_PAD);
}

/// Un elemento di Excalidraw, coi campi che si leggono.
interface Element {
  readonly id: string;
  readonly type: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly angle?: number;
  readonly strokeColor?: string;
  readonly backgroundColor?: string;
  readonly fillStyle?: string;
  readonly strokeWidth?: number;
  readonly strokeStyle?: string;
  readonly roughness?: number;
  readonly opacity?: number;
  readonly groupIds?: readonly string[];
  readonly roundness?: { readonly type: number; readonly value?: number } | null;
  readonly strokeSharpness?: string;
  readonly isDeleted?: boolean;
  readonly locked?: boolean;
  readonly link?: string | null;
  readonly boundElements?: readonly { readonly id: string; readonly type: string }[] | null;
  readonly text?: string;
  readonly originalText?: string;
  readonly fontSize?: number;
  readonly fontFamily?: number;
  readonly textAlign?: string;
  readonly verticalAlign?: string;
  readonly containerId?: string | null;
  readonly lineHeight?: number;
  readonly autoResize?: boolean;
  readonly points?: readonly (readonly [number, number])[];
  readonly pressures?: readonly number[];
  readonly simulatePressure?: boolean;
  readonly startBinding?: Binding | null;
  readonly endBinding?: Binding | null;
  readonly startArrowhead?: string | null;
  readonly endArrowhead?: string | null;
  readonly elbowed?: boolean;
  readonly polygon?: boolean;
  readonly fileId?: string | null;
  readonly scale?: readonly [number, number];
  readonly crop?: { readonly x: number; readonly y: number; readonly width: number; readonly height: number; readonly naturalWidth: number; readonly naturalHeight: number } | null;
  readonly name?: string | null;
}

interface Binding {
  readonly elementId: string;
  readonly fixedPoint?: readonly [number, number] | null;
}

/// Un file incorporato in una scena di Excalidraw.
interface FileEntry {
  readonly mimeType?: string;
  readonly dataURL?: string;
}

/// Perché un file non è una scena di Excalidraw.
export class NotExcalidraw extends Error {}

/// Il raggio di un angolo tondo di Excalidraw sul lato più corto `side`
/// (`getCornerRadius`): un quarto del lato, e per l'angolo «adattivo» al più
/// 32 unità, o il valore scritto.
function cornerOf(element: Element, side: number): number {
  const roundness = element.roundness;
  if (roundness === undefined || roundness === null) return element.strokeSharpness === "round" ? side * 0.25 : 0;
  if (roundness.type === 3) {
    const fixed = roundness.value ?? 32;
    return side <= fixed / 0.25 ? side * 0.25 : fixed;
  }
  return side * 0.25;
}

/// Vero se l'elemento lineare è arrotondato.
const rounded = (element: Element): boolean => (element.roundness !== undefined && element.roundness !== null) || element.strokeSharpness === "round";

/// Lo spessore del tratto, 1 se manca.
const widthOf = (element: Element): number => (element.strokeWidth !== undefined && element.strokeWidth > 0 ? element.strokeWidth : 1);

/// Il tratteggio del menu che somiglia a quello di Excalidraw.
const dashOf = (element: Element): Dash => (element.strokeStyle === "dashed" ? "dashed" : element.strokeStyle === "dotted" ? "dotted" : "solid");

/// L'opacità, da 0 a 1.
const opacityOf = (element: Element): number => Math.min(1, Math.max(0, (element.opacity ?? 100) / 100));

/// Il colore del tratto; quello di partenza se non si legge.
const strokeColor = (element: Element): string => hexColor(element.strokeColor) ?? "#1e1e1e";

/// La rotazione di un elemento, attorno al centro del suo riquadro.
function spinOf(element: Element): Spin | null {
  const angle = ((element.angle ?? 0) * 180) / Math.PI;
  if (Math.abs(angle) < 1e-9) return null;
  return { angle, centre: [element.x + element.width / 2, element.y + element.height / 2] };
}

/// Il riempimento di una forma chiusa.
function fillOf(element: Element, notes: Notes): Fill | null {
  const color = element.backgroundColor === "transparent" ? null : hexColor(element.backgroundColor);
  if (color === null) return null;
  const width = widthOf(element);
  // `generateRoughOptions`: righe spesse metà del tratto, a quattro tratti
  // l'una dall'altra.
  switch (element.fillStyle) {
    case "hachure":
      return { kind: "hatch", hatch: "lines", color, background: null, spacing: width * 4, width: width / 2 };
    case "cross-hatch":
      return { kind: "hatch", hatch: "cross", color, background: null, spacing: width * 4, width: width / 2 };
    case "zigzag":
    case "zigzag-line":
    case "dashed":
    case "dots":
      notes.add("fill", element.fillStyle);
      return { kind: "hatch", hatch: "lines", color, background: null, spacing: width * 4, width: width / 2 };
    default:
      return { kind: "color", color };
  }
}

/// L'aspetto di una forma o di una linea.
function lookOf(element: Element, notes: Notes, filled: boolean): Look {
  const transparent = element.strokeColor === "transparent";
  return {
    stroke: transparent ? null : { color: strokeColor(element), width: widthOf(element), dash: dashOf(element) },
    fill: filled ? fillOf(element, notes) : null,
    opacity: opacityOf(element),
  };
}

/// La punta di un capo, e la nota se FubDraw la disegna diversa.
function tipOf(head: string | null | undefined, notes: Notes): End | null {
  if (head === null || head === undefined) return null;
  const tip = (shape: TipShape): End => ({ shape, size: "medium" });
  switch (head) {
    case "arrow":
      return tip("vee");
    case "triangle":
      return tip("triangle");
    case "dot":
    case "circle":
      return tip("circle");
    case "bar":
      return tip("bar");
    case "diamond":
      return tip("diamond");
    case "triangle_outline":
    case "circle_outline":
    case "diamond_outline":
      notes.add("tip", head);
      return tip(head === "triangle_outline" ? "triangle" : head === "circle_outline" ? "circle" : "diamond");
    default:
      notes.add("tip", head);
      return null;
  }
}

/// La famiglia di FubDraw per una di Excalidraw: Cascadia e Comic Shanns
/// sono a larghezza fissa; le altre, a mano o no, diventano Inter.
function familyOf(family: number | undefined, notes: Notes): string {
  if (family === 3 || family === 8) return MONO;
  if (family === undefined || family === 1 || family === 5) notes.add("hand-font", family === 5 ? "Excalifont" : "Virgil");
  return TEXT_FAMILY;
}

/// Quanto sta la linea di base della prima riga sotto la cima del riquadro,
/// in volte il corpo, oltre a mezza riga: metà di ascendente più
/// discendente, nelle metriche di ogni carattere (`getVerticalOffset`).
const BASELINE: Readonly<Record<number, number>> = { 1: 0.256, 2: 0.27, 3: 0.3955, 5: 0.256, 6: 0.329, 7: 0.3515, 8: 0.25, 9: 0.3467, 10: 0.367 };

/// Il testo di un elemento di testo: il carattere, l'allineamento,
/// l'interlinea e una riga del file per paragrafo.
function contentOf(element: Element, raw: string, notes: Notes): Content {
  const type: Type = {
    family: familyOf(element.fontFamily, notes),
    size: element.fontSize !== undefined && element.fontSize > 0 ? element.fontSize : 20,
    color: strokeColor(element),
    bold: false,
    italic: false,
    underline: false,
    strike: false,
  };
  const align = element.textAlign === "center" ? "middle" : element.textAlign === "right" ? "end" : "start";
  const paragraphs = raw.split(/\r\n|\r|\n/).map((line) => (line === "" ? [] : [{ text: line, type: null }]));
  return { type, align, leading: element.lineHeight ?? 1.25, paragraphs };
}

/// Il lato di un aggancio fisso (`fixedPoint`, in frazioni del riquadro):
/// il lato verso cui il punto sta di più.
function anchorOf(binding: Binding): Anchor {
  const point = binding.fixedPoint;
  if (point === undefined || point === null) return "auto";
  const [dx, dy] = [point[0] - 0.5, point[1] - 0.5];
  if (Math.abs(dx) < 1e-9 && Math.abs(dy) < 1e-9) return "auto";
  return Math.abs(dx) >= Math.abs(dy) ? (dx > 0 ? "right" : "left") : dy > 0 ? "bottom" : "top";
}

/// Legge `text`, il JSON di un file di Excalidraw. Lancia [`NotExcalidraw`]
/// se non lo è.
export function readExcalidraw(text: string): Diagram {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new NotExcalidraw("non è JSON");
  }
  if (typeof data !== "object" || data === null) throw new NotExcalidraw("non è una scena");
  const scene = data as { type?: unknown; elements?: unknown; appState?: { viewBackgroundColor?: string }; files?: Record<string, FileEntry> };
  if ((scene.type !== "excalidraw" && scene.type !== "excalidraw/clipboard") || !Array.isArray(scene.elements)) throw new NotExcalidraw("non è una scena di Excalidraw");
  const elements = (scene.elements as Element[]).filter((element) => typeof element === "object" && element !== null && element.isDeleted !== true && typeof element.type === "string");
  return new Reader(elements, scene.files ?? {}, hexColor(scene.appState?.viewBackgroundColor)).read();
}

/// Un gruppo aperto mentre si leggono gli elementi in ordine.
interface Open {
  readonly id: string;
  readonly children: Node[];
}

class Reader {
  private readonly notes = new Notes();
  private readonly byId = new Map<string, Element>();
  /// Il testo dentro ogni contenitore, per id del contenitore.
  private readonly inside = new Map<string, Element>();
  private readonly boards: Board[] = [];

  constructor(
    private readonly elements: readonly Element[],
    private readonly files: Readonly<Record<string, FileEntry>>,
    private readonly background: string | null,
  ) {
    for (const element of elements) this.byId.set(element.id, element);
    for (const element of elements) {
      const container = element.type === "text" && element.containerId ? this.byId.get(element.containerId) : undefined;
      if (container !== undefined) this.inside.set(container.id, element);
    }
  }

  read(): Diagram {
    // I gruppi si aprono e si chiudono mentre si scorre l'ordine del file:
    // un elemento sta nei gruppi dal più esterno al più interno.
    const top: Node[] = [];
    const stack: Open[] = [];
    let rough = 0;
    for (const element of this.elements) {
      if (element.type === "text" && element.containerId && this.byId.has(element.containerId) && this.inside.get(element.containerId) === element) continue;
      if ((element.roughness ?? 0) > 0 && element.type !== "text" && element.type !== "freedraw" && element.type !== "image") rough++;
      const node = this.node(element);
      if (node === null) continue;
      const path = [...(element.groupIds ?? [])].reverse();
      let common = 0;
      while (common < stack.length && common < path.length && stack[common]!.id === path[common]) common++;
      while (stack.length > common) this.close(stack, top);
      for (const id of path.slice(common)) stack.push({ id, children: [] });
      (stack[stack.length - 1]?.children ?? top).push(node);
    }
    while (stack.length > 0) this.close(stack, top);
    if (rough > 0) this.notes.add("rough", "", rough);
    return {
      source: "excalidraw",
      background: this.background === "#ffffff" ? null : this.background,
      layers: [{ name: "", hidden: false, locked: false, nodes: top }],
      boards: this.boards,
      notes: this.notes.list(),
    };
  }

  /// Chiude il gruppo in cima alla pila, nel suo genitore.
  private close(stack: Open[], top: Node[]): void {
    const open = stack.pop()!;
    const parent = stack[stack.length - 1]?.children ?? top;
    if (open.children.length === 0) return;
    parent.push({ type: "group", key: `group:${open.id}`, locked: false, spin: null, name: "", children: open.children });
  }

  /// Il nodo di un elemento; `null` se non diventa niente.
  private node(element: Element): Node | null {
    // Il collegamento di un contenuto incorporato è il contenuto, che ha la
    // sua nota.
    const embed = element.type === "embeddable" || element.type === "iframe";
    if (!embed && element.link !== undefined && element.link !== null && element.link !== "") this.notes.add("link", element.link);
    const base = { key: element.id, locked: element.locked === true, spin: spinOf(element) };
    switch (element.type) {
      case "rectangle": {
        const corner = cornerOf(element, Math.min(Math.abs(element.width), Math.abs(element.height)));
        return this.shape(element, base, { kind: "rect", corner });
      }
      case "ellipse":
        return this.shape(element, base, { kind: "ellipse" });
      case "diamond":
        return this.shape(element, base, { kind: "library", id: "basic-diamond" });
      case "text":
        return this.text(element, base);
      case "arrow":
        return this.arrow(element, base);
      case "line":
        return this.line(element, base);
      case "freedraw":
        return this.freedraw(element, base);
      case "image":
        return this.image(element, base);
      case "frame":
      case "magicframe":
        this.boards.push({ name: element.name ?? "", box: this.normal(boxOf(element.x, element.y, element.width, element.height)) });
        return null;
      case "embeddable":
      case "iframe":
        this.notes.add("embed", element.link ?? "");
        return null;
      default:
        this.notes.add("unknown", element.type);
        return null;
    }
  }

  /// Un riquadro con la larghezza e l'altezza positive.
  private normal(box: { readonly min: Point; readonly max: Point }): { readonly min: Point; readonly max: Point } {
    return { min: [Math.min(box.min[0], box.max[0]), Math.min(box.min[1], box.max[1])], max: [Math.max(box.min[0], box.max[0]), Math.max(box.min[1], box.max[1])] };
  }

  /// Una forma, col testo legato a lei. Al centro è la sua etichetta; in
  /// alto o in basso, come il titolo di un riquadro, è un testo a sé dove lo
  /// mette Excalidraw, in un gruppo con la forma: si spostano insieme, e i
  /// connettori si agganciano al gruppo.
  private shape(element: Element, base: { key: string; locked: boolean; spin: Spin | null }, form: Form): Node {
    const box = this.normal(boxOf(element.x, element.y, element.width, element.height));
    const look = lookOf(element, this.notes, true);
    const text = this.inside.get(element.id);
    if (text === undefined || text.verticalAlign === undefined || text.verticalAlign === "middle") {
      const label = text === undefined ? null : contentOf(text, text.originalText ?? text.text ?? "", this.notes);
      return { ...base, type: "shape", form, box, look, label };
    }
    const shape: Node = { ...base, key: "", type: "shape", form, box, look, label: null };
    const title = this.text(text, { key: "", locked: base.locked, spin: spinOf(text) }, maxWidthIn(element));
    return { ...base, spin: null, type: "group", name: "", children: title === null ? [shape] : [shape, title] };
  }

  /// Un testo a sé: a punto, o in area se ha una larghezza fissa. Il testo
  /// di un contenitore va a capo a `wrap`, la larghezza che gli dà lui.
  private text(element: Element, base: { key: string; locked: boolean; spin: Spin | null }, wrap: number | null = null): Node | null {
    const area = wrap !== null || element.autoResize === false;
    const content = contentOf(element, area ? (element.originalText ?? element.text ?? "") : (element.text ?? element.originalText ?? ""), this.notes);
    const size = content.type.size;
    const line = content.leading * size;
    const x = content.align === "middle" ? element.x + element.width / 2 : content.align === "end" ? element.x + element.width : element.x;
    const y = element.y + line / 2 + (BASELINE[element.fontFamily ?? 1] ?? 0.275) * size;
    return { ...base, type: "text", at: [x, y], width: wrap ?? (area ? element.width : null), frame: null, content, opacity: opacityOf(element) };
  }

  /// I punti di un elemento lineare, nella tela.
  private points(element: Element): Point[] {
    return (element.points ?? []).map(([px, py]): Point => [element.x + px, element.y + py]);
  }

  /// Un capo di una freccia.
  private hook(binding: Binding | null | undefined, at: Point): Hook {
    if (binding === null || binding === undefined || !this.byId.has(binding.elementId)) return { at };
    return { node: binding.elementId, anchor: anchorOf(binding), at };
  }

  /// Una freccia: un connettore se è agganciata, dritta, a gomito o ha
  /// un'etichetta; altrimenti una linea con le punte, punto per punto.
  private arrow(element: Element, base: { key: string; locked: boolean; spin: Spin | null }): Node | null {
    const points = this.points(element);
    if (points.length < 2) return null;
    const look = lookOf(element, this.notes, false);
    // Excalidraw rimpicciolisce le punte con la freccia: su una freccia di un
    // clic non si vedono, e resta un punto.
    const lengths = runningLengths(points);
    const short = lengths[lengths.length - 1]! < SHORT_ARROW;
    const start = short ? null : tipOf(element.startArrowhead, this.notes);
    const end = short ? null : tipOf(element.endArrowhead, this.notes);
    const text = this.inside.get(element.id);
    const bound = (element.startBinding ?? null) !== null || (element.endBinding ?? null) !== null;
    const elbow = element.elbowed === true;
    if (!bound && !elbow && text === undefined && points.length > 2) {
      return { ...base, type: "path", points, smooth: rounded(element), closed: false, look, start, end };
    }
    // Una freccia girata ha i capi girati: il connettore li prende dove
    // stanno nella tela.
    const turn = (p: Point): Point => {
      const spin = base.spin;
      if (spin === null) return p;
      const a = (spin.angle * Math.PI) / 180;
      const [x, y] = [p[0] - spin.centre[0], p[1] - spin.centre[1]];
      return [spin.centre[0] + x * Math.cos(a) - y * Math.sin(a), spin.centre[1] + x * Math.sin(a) + y * Math.cos(a)];
    };
    const drawn = points.map(turn).filter((p, i, all) => i === 0 || p[0] !== all[i - 1]![0] || p[1] !== all[i - 1]![1]);
    if (drawn.length < 2) drawn.push([drawn[0]![0] + 1, drawn[0]![1]]);
    const { kind, route, t } = this.route(element, drawn, elbow);
    const labels = text === undefined ? [] : [{ content: contentOf(text, text.originalText ?? text.text ?? "", this.notes), t }];
    return {
      ...base,
      spin: null,
      type: "line",
      kind,
      from: this.hook(element.startBinding, drawn[0]!),
      to: this.hook(element.endBinding, drawn[drawn.length - 1]!),
      look,
      start,
      end,
      labels,
      route,
    };
  }

  /// Il connettore che somiglia di più al percorso `drawn` di una freccia, e
  /// dove ci sta l'etichetta: dove la mette Excalidraw, sul punto di mezzo o
  /// a metà del tratto di mezzo, come frazione della lunghezza.
  private route(element: Element, drawn: readonly Point[], elbow: boolean): { readonly kind: ConnectorKind; readonly route: readonly Point[]; readonly t: number } {
    const smooth = rounded(element) && !elbow;
    const { points: samples, ends } = sampled(smooth ? smoothSegments(drawn, false) : drawn.map((to, i): Segment => ({ kind: i === 0 ? "move" : "line", to })));
    const lengths = runningLengths(samples);
    const total = lengths[lengths.length - 1]!;
    const middle = drawn.length % 2 === 1 ? ends[(drawn.length - 1) / 2 - 1]! : Math.round(((ends[drawn.length / 2 - 2] ?? 0) + ends[drawn.length / 2 - 1]!) / 2);
    const t = total > 0 ? lengths[middle]! / total : 0.5;
    if (drawn.length === 2) return { kind: "straight", route: drawn, t };
    if ((elbow || !smooth) && drawn.length <= MAX_ELBOW_POINTS && orthogonal(drawn, 1)) return { kind: "elbow", route: drawn, t };
    // Una cubica sola: il connettore curvo di FubDraw. Una linea spezzata, o
    // con più curve di quante una cubica ne tiene, cambia aspetto, e il
    // rapporto lo dice.
    const fitted = fitCubic(samples);
    if (!smooth || fitted.error > Math.max(ROUTE_TOLERANCE, total * ROUTE_SHARE)) this.notes.add("route");
    return { kind: "curved", route: fitted.points, t };
  }

  /// Una linea: chiusa e riempita se è un poligono, liscia se è arrotondata.
  private line(element: Element, base: { key: string; locked: boolean; spin: Spin | null }): Node | null {
    const points = this.points(element);
    if (points.length < 2) return null;
    const [first, last] = [points[0]!, points[points.length - 1]!];
    const closed = points.length > 2 && (element.polygon === true || (Math.abs(first[0] - last[0]) < 1e-6 && Math.abs(first[1] - last[1]) < 1e-6));
    if (closed && element.polygon === true && (Math.abs(first[0] - last[0]) > 1e-6 || Math.abs(first[1] - last[1]) > 1e-6)) points.push(first);
    return {
      ...base,
      type: "path",
      points,
      smooth: rounded(element),
      closed,
      look: lookOf(element, this.notes, closed),
      start: tipOf(element.startArrowhead, this.notes),
      end: tipOf(element.endArrowhead, this.notes),
    };
  }

  /// Un tratto a mano libera, con la pressione vera se Excalidraw non la
  /// simula, e il pennello di `getFreeDrawSvgPath`.
  private freedraw(element: Element, base: { key: string; locked: boolean; spin: Spin | null }): Node | null {
    const points = element.points ?? [];
    if (points.length === 0) return null;
    const pressures = element.pressures ?? [];
    const real = element.simulatePressure === false && pressures.length === points.length;
    const samples = points.map(([px, py], i) => (real ? { x: element.x + px, y: element.y + py, p: Math.min(1, Math.max(0, pressures[i]!)) } : { x: element.x + px, y: element.y + py }));
    return {
      ...base,
      type: "ink",
      samples,
      size: widthOf(element) * 4.25,
      thinning: 0.6,
      simulate: !real,
      color: strokeColor(element),
      opacity: opacityOf(element),
    };
  }

  /// Un'immagine incorporata, col suo ritaglio.
  private image(element: Element, base: { key: string; locked: boolean; spin: Spin | null }): Node | null {
    const file = element.fileId ? this.files[element.fileId] : undefined;
    const href = file?.dataURL;
    if (href === undefined || !href.startsWith("data:image/")) {
      this.notes.add("image", file?.mimeType ?? "");
      return null;
    }
    const shown = this.normal(boxOf(element.x, element.y, element.width, element.height));
    // Excalidraw ribalta l'immagine nel suo riquadro, ritaglio compreso.
    const [fx, fy] = element.scale ?? [1, 1];
    const flip: Flip | null = fx < 0 || fy < 0 ? { x: fx < 0, y: fy < 0, centre: [(shown.min[0] + shown.max[0]) / 2, (shown.min[1] + shown.max[1]) / 2] } : null;
    const crop = element.crop ?? null;
    if (crop === null || crop.naturalWidth <= 0 || crop.naturalHeight <= 0 || crop.width <= 0 || crop.height <= 0) {
      return { ...base, type: "image", href, box: shown, opacity: opacityOf(element), crop: null, flip };
    }
    // Il riquadro di Excalidraw è la parte che si vede: l'immagine intera ci
    // sta attorno, alla stessa scala, e il ritaglio è quella parte.
    const [sx, sy] = [(shown.max[0] - shown.min[0]) / crop.width, (shown.max[1] - shown.min[1]) / crop.height];
    const full = boxOf(shown.min[0] - crop.x * sx, shown.min[1] - crop.y * sy, crop.naturalWidth * sx, crop.naturalHeight * sy);
    return {
      ...base,
      type: "image",
      href,
      box: full,
      opacity: opacityOf(element),
      crop: { min: [crop.x / crop.naturalWidth, crop.y / crop.naturalHeight], max: [(crop.x + crop.width) / crop.naturalWidth, (crop.y + crop.height) / crop.naturalHeight] },
      flip,
    };
  }
}
