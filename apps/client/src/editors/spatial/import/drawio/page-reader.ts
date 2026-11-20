// Chi legge una pagina di draw.io: dalle celle ai nodi del diagramma, coi
// gruppi, i livelli, i contenitori, le corsie e le note (vedi `../drawio.ts`).

import { MAX_ELBOW_POINTS, type Anchor, type ConnectorKind } from "../../scene/connectors";
import type { Bounds, Segment } from "../../scene/geometry";
import type { Point } from "../../scene/matrix";
import { CHAR_EM } from "../../tools/measure";
import { fitCubic, orthogonal, runningLengths, sampled } from "../curves";
import {
  boxOf,
  Notes,
  type Content,
  type Fill,
  type Form,
  type Hook,
  type ImageNode,
  type Layer,
  type LineNode,
  type Look,
  type Node,
  type Rule,
  type Run,
  type ShapeNode,
  type Spin,
  type TextNode,
  type Type,
} from "../diagram";
import { htmlParagraphs } from "../html";
import { labelBlocks, layoutBlocks, type Align, type Border, type Extent, type VAlign } from "../tables";
import { type Cell, cellsOf, type Ends, type Geometry, ON_LINE } from "./cells";
import { attr, num, type Page } from "./file";
import { type BaseOf, FROM_LANE, hookBox, INHERITED, nameIn, type Placed, rowName } from "./nodes";
import {
  along,
  centreOf,
  curvedThrough,
  elbowThrough,
  entityRoute,
  exitTowards,
  orthogonalRim,
  type Perimeter,
  perimeterPoint,
  rimOf,
  sequenceRoute,
  sideToSide,
  transposed,
  turned,
} from "./routes";
import {
  anchorOf,
  directed,
  ELLIPSES,
  imageHref,
  LIBRARY,
  ORTHOGONAL,
  outlineOf,
  RECTS,
  SIMPLE_ELBOWS,
  tipOf,
} from "./shapes";
import { colorOf, dashOf, familyOf, on, onPaper, type Style } from "./style";
import { balanced, blankEnds, htmlText, pointText, shrunk } from "./text";

/// Quanto un percorso curvo può scostarsi da quello del file prima che il
/// rapporto lo dica, come per Excalidraw.
const ROUTE_TOLERANCE = 4;
const ROUTE_SHARE = 0.03;

/// L'interlinea dei testi di draw.io (`mxConstants.LINE_HEIGHT`).
const LEADING = 1.2;

/// Il lettore di una pagina.
export class PageReader {
  private readonly cells: Cell[];
  private readonly byId = new Map<string, Cell>();
  private readonly children = new Map<string, Cell[]>();
  private readonly boxes = new Map<string, Bounds | null>();
  /// Gli archi di cui si sta stimando la linea, contro i giri.
  private readonly walking = new Set<string>();
  /// Le celle a cui si aggancia un arco.
  private readonly hooked = new Set<string>();
  /// Vero se la pagina getta l'ombra di tutto ciò che disegna, testi
  /// compresi: l'ombra del pannello «Diagramma» di draw.io.
  private readonly shadows: boolean;

  constructor(
    page: Page,
    private readonly prefix: string,
    private readonly notes: Notes,
  ) {
    this.cells = cellsOf(page);
    this.shadows = attr(page.model, "shadow") === "1";
    for (const cell of this.cells) if (!this.byId.has(cell.id)) this.byId.set(cell.id, cell);
    // I colori «inherit» prendono quelli del genitore, e i colori «swimlane»
    // il riempimento della corsia che contiene la cella, o la cella stessa:
    // per un arco, quella dell'oggetto a cui arriva.
    const resolved = new Set<string>();
    const resolve = (cell: Cell, depth: number): void => {
      if (resolved.has(cell.id) || depth > 64) return;
      resolved.add(cell.id);
      const style = cell.style as Map<string, string>;
      const parent = cell.parent === null ? undefined : this.byId.get(cell.parent);
      for (const key of INHERITED) {
        if (style.get(key) !== "inherit") continue;
        if (parent !== undefined && parent.vertex) resolve(parent, depth + 1);
        const value = parent !== undefined && parent.vertex ? parent.style.get(key) : undefined;
        if (value === undefined || value === "inherit") style.delete(key);
        else style.set(key, value);
      }
      if (!FROM_LANE.some((key) => style.get(key) === "swimlane")) return;
      let lane = cell.edge && cell.target !== null ? this.byId.get(cell.target) : cell;
      for (let steps = 0; lane !== undefined && lane.style.get("shape") !== "swimlane" && steps < 64; steps++) lane = lane.parent === null ? undefined : this.byId.get(lane.parent);
      if (lane !== undefined && lane !== cell) resolve(lane, depth + 1);
      const fill = lane?.style.get("fillColor");
      for (const key of FROM_LANE) {
        if (style.get(key) !== "swimlane") continue;
        if (fill === undefined || fill === "swimlane" || fill === "inherit") style.set(key, key === "strokeColor" || key === "fontColor" ? "#000000" : "#ffffff");
        else style.set(key, fill);
      }
    };
    for (const cell of this.cells) resolve(cell, 0);
    for (const cell of this.cells) {
      if (cell.edge && cell.source !== null) this.hooked.add(cell.source);
      if (cell.edge && cell.target !== null) this.hooked.add(cell.target);
    }
    for (const cell of this.cells) {
      if (cell.parent === null || cell.parent === cell.id) continue;
      const list = this.children.get(cell.parent);
      if (list === undefined) this.children.set(cell.parent, [cell]);
      else list.push(cell);
    }
  }

  read(): { readonly layers: Layer[] } {
    const roots = this.cells.filter((cell) => cell.parent === null || !this.byId.has(cell.parent));
    const layers: Layer[] = [];
    for (const root of roots) {
      // Una radice coi livelli, come la scrive draw.io; o celle senza
      // livello, che vanno nel primo.
      const below = this.children.get(root.id) ?? [];
      if (!root.vertex && !root.edge && below.length > 0 && below.every((cell) => !cell.vertex && !cell.edge)) {
        for (const layer of below) {
          layers.push({
            name: layer.value.trim(),
            hidden: !layer.visible,
            locked: on(layer.style, "locked"),
            nodes: this.nodesIn(layer.id, null),
          });
        }
      } else if (root.vertex || root.edge) {
        const nodes = this.cell(root, null);
        if (layers.length === 0) layers.push({ name: "", hidden: false, locked: false, nodes: [] });
        (layers[0]!.nodes as Node[]).push(...nodes);
      }
    }
    return { layers };
  }

  /// La chiave di una cella nel diagramma: l'id, col numero della pagina se
  /// le pagine sono più d'una.
  private key(id: string): string {
    return this.prefix + id;
  }

  /// I nodi delle celle figlie di `parent`, nell'ordine.
  private nodesIn(parent: string, box: Bounds | null): Node[] {
    return (this.children.get(parent) ?? []).flatMap((cell) => this.cell(cell, box));
  }

  /// Il riquadro di una forma nella tela; `null` se non ne ha uno.
  private boxOfCell(cell: Cell): Bounds | null {
    if (this.boxes.has(cell.id)) return this.boxes.get(cell.id)!;
    this.boxes.set(cell.id, null);
    const g = cell.geometry;
    let out: Bounds | null = null;
    if (g !== null && cell.vertex) {
      const parent = cell.parent === null ? undefined : this.byId.get(cell.parent);
      const parentBox = parent !== undefined && parent.vertex ? this.boxOfCell(parent) : null;
      if (parent !== undefined && parent.edge && g.relative) {
        // L'etichetta di un arco, che un altro arco può agganciare: attorno
        // al suo punto sulla linea.
        const at = this.labelPoint(parent, g);
        out = at === null ? null : boxOf(at[0] - g.width / 2, at[1] - g.height / 2, g.width, g.height);
      } else if (parentBox !== null && g.relative) {
        const [pw, ph] = [parentBox.max[0] - parentBox.min[0], parentBox.max[1] - parentBox.min[1]];
        out = boxOf(parentBox.min[0] + g.x * pw, parentBox.min[1] + g.y * ph, g.width, g.height);
      } else {
        const [ox, oy] = parentBox === null ? this.origin(cell) : parentBox.min;
        out = boxOf(ox + g.x, oy + g.y, g.width, g.height);
      }
    }
    this.boxes.set(cell.id, out);
    return out;
  }

  /// L'origine delle coordinate dei figli del genitore di `cell`: l'angolo
  /// della forma genitore, o l'origine della tela.
  private origin(cell: Cell): Point {
    const parent = cell.parent === null ? undefined : this.byId.get(cell.parent);
    if (parent === undefined || !parent.vertex) return [0, 0];
    return this.boxOfCell(parent)?.min ?? [0, 0];
  }

  /// I nodi di una cella e di ciò che contiene.
  private cell(cell: Cell, parentBox: Bounds | null): Node[] {
    if (!cell.visible) return [];
    if (cell.edge) {
      this.cellNotes(cell);
      return this.edge(cell);
    }
    if (!cell.vertex) return this.nodesIn(cell.id, parentBox);
    this.cellNotes(cell);
    const box = this.boxOfCell(cell);
    if (box === null) {
      // Senza riquadro la forma non ha dove stare, ma ciò che contiene ha la
      // sua posizione: entra, e la forma si dice.
      this.notes.add("placeless");
      return cell.collapsed ? [] : this.nodesIn(cell.id, parentBox);
    }
    let own = this.own(cell, box);
    // Una cella che non si vede, come la riga di una tabella, tiene il suo
    // riquadro per gli archi che vi si agganciano.
    if (this.hooked.has(cell.id) && !own.some((node) => node.type === "shape")) own = [hookBox(box, nameIn(own)), ...own];
    const inner = cell.collapsed ? [] : this.nodesIn(cell.id, box).concat(this.tableLines(cell, box));
    const nodes = [...own, ...inner];
    if (nodes.length === 0) return [];
    if (nodes.length === 1 && inner.length === 0) return [{ ...nodes[0]!, key: this.key(cell.id) } as Node];
    // Una cella che non disegna niente e ne tiene una sola, come la riga di
    // una tabella con una cella, non fa un gruppo di un oggetto.
    if (nodes.length === 1 && own.length === 0) return nodes;
    // Gli archi toccano il contorno della forma, non il testo accanto né ciò
    // che contiene: se ne ha una, ci si aggancia a lei.
    const outline = nodes.findIndex((node) => node.type === "shape");
    if (outline >= 0 && outline < own.length) {
      // Un contorno senza etichetta dentro prende il nome dal testo della
      // cella, perché un connettore dica a che cosa è agganciato.
      const shape = nodes[outline] as ShapeNode;
      const name = this.hooked.has(cell.id) && shape.label === null && (shape.name ?? "") === "" ? nameIn(own) || rowName(inner) : "";
      const hooked: Node = name === "" ? { ...shape, key: this.key(cell.id) } : { ...shape, key: this.key(cell.id), name };
      const children = nodes.map((node, i) => (i === outline ? hooked : node));
      return [{ type: "group", key: "", locked: on(cell.style, "locked"), spin: null, name: "", children }];
    }
    return [{ type: "group", key: this.key(cell.id), locked: on(cell.style, "locked"), spin: null, name: "", children: nodes }];
  }

  /// Vero se una cella con lo stile `style` getta un'ombra: dal suo disegno
  /// (`shadow`) o dal suo testo (`textShadow`).
  private shadowed(style: Style, key: "shadow" | "textShadow"): boolean {
    return this.shadows || on(style, key);
  }

  /// L'aspetto di una cella: il contorno, il riempimento, l'opacità e
  /// l'ombra, se disegna qualcosa che la getti.
  private look(style: Style, filled: boolean): Look {
    const strokeColor = colorOf(style, "strokeColor", "#000000");
    const width = num(style.get("strokeWidth"), 1);
    const stroke = strokeColor === null || width <= 0 ? null : { color: onPaper(strokeColor, num(style.get("strokeOpacity"), 100) / 100), width, dash: dashOf(style) };
    let fill: Fill | null = null;
    if (filled) {
      const color = colorOf(style, "fillColor", "#ffffff");
      if (color !== null) fill = { kind: "color", color: onPaper(color, num(style.get("fillOpacity"), 100) / 100) };
    }
    const opacity = Math.min(1, Math.max(0, num(style.get("opacity"), 100) / 100));
    return (stroke !== null || fill !== null) && this.shadowed(style, "shadow") ? { stroke, fill, opacity, shadow: true } : { stroke, fill, opacity };
  }

  /// Le note di una cella, una volta per cella: il tratto a mano, la
  /// sfumatura e il collegamento.
  private cellNotes(cell: Cell): void {
    const style = cell.style;
    if (on(style, "sketch") || on(style, "comic")) this.notes.add("rough");
    const gradient = style.get("gradientColor");
    if (cell.vertex && gradient !== undefined && gradient !== "none" && gradient !== "" && colorOf(style, "fillColor", "#ffffff") !== null) this.notes.add("fill", "gradient");
    if (cell.link !== null) this.notes.add("link", cell.link);
  }

  /// Il carattere del testo di una cella; le note vanno in `notes`.
  private typeOf(style: Style, edge: boolean, notes = this.notes): Type | null {
    const color = colorOf(style, "fontColor", "#000000");
    if (color === null) return null;
    const bits = num(style.get("fontStyle"), 0);
    return {
      family: familyOf(style.get("fontFamily") ?? "Helvetica", notes),
      size: Math.max(1, num(style.get("fontSize"), edge ? 11 : 12)),
      color: onPaper(color, num(style.get("textOpacity"), 100) / 100),
      bold: (bits & 1) !== 0,
      italic: (bits & 2) !== 0,
      underline: (bits & 4) !== 0,
      strike: (bits & 8) !== 0,
    };
  }

  /// Il testo di una cella: `null` se non ne ha uno che si legge.
  private contentOf(cell: Cell, edge: boolean): Content | null {
    const type = this.typeOf(cell.style, edge);
    if (type === null) return null;
    const raw = this.filled(cell, cell.value);
    if (raw.trim() === "") return null;
    const align = cell.style.get("align") === "left" ? "start" : cell.style.get("align") === "right" ? "end" : "middle";
    let paragraphs: Run[][];
    let rules: Rule[] = [];
    if (on(cell.style, "html")) {
      ({ paragraphs, rules } = htmlParagraphs(htmlText(raw), type, (name) => familyOf(name, this.notes), this.notes));
    } else {
      paragraphs = raw.split(/\r\n|\r|\n/).map((line) => (line === "" ? [] : [{ text: line, type: null }]));
    }
    if (paragraphs.every((runs) => runs.every((run) => run.text.trim() === ""))) return null;
    const content: Content = rules.length === 0 ? { type, align, leading: LEADING, paragraphs } : { type, align, leading: LEADING, paragraphs, rules };
    return this.shadowed(cell.style, "textShadow") ? { ...content, shadow: true } : content;
  }

  /// `raw` coi segnaposto `%nome%` presi dagli attributi della cella e dei
  /// suoi genitori; quelli che non si trovano restano, e la nota in `notes`
  /// lo dice.
  private filled(cell: Cell, raw: string, notes = this.notes): string {
    if (!on(cell.style, "placeholders") && cell.fields.get("placeholders") !== "1") return raw;
    return raw.replace(/%([A-Za-z_][\w.-]*)%/g, (whole, name: string) => {
      for (let at: Cell | undefined = cell; at !== undefined; at = at.parent === null ? undefined : this.byId.get(at.parent)) {
        const value = at.fields.get(name);
        if (value !== undefined) return value;
      }
      notes.add("placeholder", whole);
      return whole;
    });
  }

  /// Il riquadro del testo di una cella in `box`, coi margini e la
  /// posizione del testo dentro o fuori dalla forma.
  private placed(style: Style, box: Bounds): Placed {
    const [w, h] = [box.max[0] - box.min[0], box.max[1] - box.min[1]];
    let [x, y] = box.min;
    const position = style.get("labelPosition");
    const vertical = style.get("verticalLabelPosition");
    if (position === "left") x -= w;
    else if (position === "right") x += w;
    if (vertical === "top") y -= h;
    else if (vertical === "bottom") y += h;
    const spacing = num(style.get("spacing"), 2);
    const left = spacing + num(style.get("spacingLeft"), 0);
    const right = spacing + num(style.get("spacingRight"), 0);
    const top = spacing + num(style.get("spacingTop"), 0);
    const bottom = spacing + num(style.get("spacingBottom"), 0);
    const labelWidth = num(style.get("labelWidth"), NaN);
    const width = Number.isFinite(labelWidth) ? labelWidth : w;
    const dx = Number.isFinite(labelWidth) ? (w - labelWidth) / 2 : 0;
    return {
      box: { min: [x + dx + left, y + top], max: [x + dx + Math.max(left, width - right), y + Math.max(top, h - bottom)] },
      vertical: style.get("horizontal") === "0",
    };
  }

  /// Vero se il testo di una cella sta in mezzo alla forma, dove FubDraw
  /// mette l'etichetta.
  private centred(style: Style): boolean {
    const position = style.get("labelPosition") ?? "center";
    const vertical = style.get("verticalLabelPosition") ?? "middle";
    return position === "center" && vertical === "middle" && (style.get("verticalAlign") ?? "middle") === "middle" && !Number.isFinite(num(style.get("labelWidth"), NaN));
  }

  /// Il testo `content` di una cella in `box`, girato di `rotation` gradi
  /// attorno al centro della cella `centre`.
  private textNode(whole: Content, style: Style, box: Bounds, rotation: number, centre: Point, locked: boolean): TextNode {
    const placed = this.placed(style, box);
    // Le righe vuote in cima e in fondo, che FubDraw non tiene, restano nel
    // posto del testo.
    const [lead, trail] = blankEnds(whole);
    const line = whole.leading * whole.type.size;
    const content: Content =
      lead + trail === 0 || lead + trail >= whole.paragraphs.length
        ? whole
        : { ...whole, paragraphs: whole.paragraphs.slice(lead, whole.paragraphs.length - trail), ...(whole.rules === undefined ? {} : { rules: whole.rules.map((rule) => ({ ...rule, paragraph: rule.paragraph - lead })) }) };
    const inner = content === whole ? placed.box : shrunk(placed.box, placed.vertical ? 0 : 1, lead * line, trail * line);
    const middle = turned(centreOf(inner), rotation, centre);
    const [w, h] = placed.vertical ? [inner.max[1] - inner.min[1], inner.max[0] - inner.min[0]] : [inner.max[0] - inner.min[0], inner.max[1] - inner.min[1]];
    // Il testo si scrive diritto attorno al centro del suo riquadro, che la
    // rotazione della cella sposta, e poi gira.
    const [left, top] = [middle[0] - w / 2, middle[1] - h / 2];
    // Le righe orizzontali vanno da un lato all'altro del riquadro: il testo
    // ci va a capo.
    const wrap = style.get("whiteSpace") === "wrap" || content.rules !== undefined;
    const x = content.align === "start" ? left : content.align === "end" ? left + w : left + w / 2;
    const align = style.get("verticalAlign") === "top" ? "top" : style.get("verticalAlign") === "bottom" ? "bottom" : "middle";
    const angle = rotation + (placed.vertical ? -90 : 0);
    return {
      type: "text",
      key: "",
      locked,
      spin: Math.abs(angle % 360) < 1e-9 ? null : { angle, centre: middle },
      at: [x, top + content.type.size],
      width: wrap ? Math.max(1, w) : null,
      frame: { top, bottom: top + h, align },
      content,
      opacity: Math.min(1, Math.max(0, num(style.get("opacity"), 100) / 100)),
    };
  }

  /// Una forma col suo testo: l'etichetta se sta in mezzo, se no un testo a
  /// sé accanto alla forma.
  private shaped(cell: Cell, box: Bounds, form: Form, filled = true, labelled = true): Node[] {
    const style = cell.style;
    const rotation = num(style.get("rotation"), 0);
    const centre = centreOf(box);
    const locked = on(style, "locked");
    if (labelled) {
      const table = this.tabled(cell, box);
      if (table !== null) return [...this.shaped(cell, box, form, filled, false), ...table];
    }
    const content = labelled ? this.contentOf(cell, false) : null;
    const look = this.look(style, filled);
    let shapeBox = box;
    let angle = rotation;
    let inside = content !== null && content.rules === undefined && this.centred(style) && balanced(style, content);
    // Un testo in verticale dentro un rettangolo o un'ellisse: la forma gira
    // col testo, ed è la stessa.
    if (inside && style.get("horizontal") === "0") {
      if (form.kind === "rect" || form.kind === "ellipse") {
        const [w, h] = [box.max[0] - box.min[0], box.max[1] - box.min[1]];
        shapeBox = { min: [centre[0] - h / 2, centre[1] - w / 2], max: [centre[0] + h / 2, centre[1] + w / 2] };
        angle = rotation - 90;
      } else {
        inside = false;
      }
    }
    const spin: Spin | null = Math.abs(angle % 360) < 1e-9 ? null : { angle, centre };
    const shape: ShapeNode = { type: "shape", key: "", locked, spin, form, box: shapeBox, look, label: inside ? content : null };
    if (content === null || inside) return [shape];
    return [shape, this.textNode(content, style, box, rotation, centre, locked)];
  }

  /// L'etichetta di una cella che ha una tabella HTML: la griglia delle
  /// celle e il testo attorno, come li mette il browser in draw.io; `null`
  /// se non ne ha una, o se la cella è girata.
  private tabled(cell: Cell, box: Bounds): Node[] | null {
    const style = cell.style;
    if (!on(style, "html") || style.get("horizontal") === "0" || Math.abs(num(style.get("rotation"), 0) % 360) > 1e-9) return null;
    // Si guarda prima senza contare le note: se non c'è una tabella, il
    // testo lo legge `contentOf`, e le note si contano una volta sola.
    const quiet = new Notes();
    const probe = this.typeOf(style, false, quiet) === null ? null : this.filled(cell, cell.value, quiet);
    const blocks = probe === null || !/<table/i.test(probe) ? null : labelBlocks(htmlText(probe));
    if (blocks === null) return null;
    const type = this.typeOf(style, false)!;
    this.filled(cell, cell.value);
    const fill = style.get("overflow") === "fill";
    const placed = this.placed(style, box).box;
    const [w, h] = [placed.max[0] - placed.min[0], placed.max[1] - placed.min[1]];
    const align: Align = style.get("align") === "left" ? "start" : style.get("align") === "right" ? "end" : "middle";
    const valign: VAlign = style.get("verticalAlign") === "top" ? "top" : style.get("verticalAlign") === "bottom" ? "bottom" : "middle";
    const typeFor = (header: boolean): Type => (header ? { ...type, bold: true } : type);
    const scratch = new Notes();
    const extent = (html: string, header: boolean): Extent => {
      const base = typeFor(header);
      const { paragraphs } = htmlParagraphs(html, base, (name) => familyOf(name, scratch), scratch);
      const written = paragraphs.some((runs) => runs.some((run) => run.text.trim() !== ""));
      if (!written) return { width: 0, height: 0 };
      const width = Math.max(0, ...paragraphs.map((runs) => runs.reduce((sum, run) => sum + [...run.text].length * CHAR_EM * (run.type?.size ?? base.size), 0)));
      return { width, height: paragraphs.length * LEADING * base.size };
    };
    const room = { box: placed, width: fill || style.get("whiteSpace") === "wrap" ? w : null, height: fill ? h : null, align, valign };
    const locked = on(style, "locked");
    const opacity = Math.min(1, Math.max(0, num(style.get("opacity"), 100) / 100));
    // La tabella è dell'etichetta, e getta l'ombra del testo.
    const shadow = this.shadowed(style, "textShadow");
    const rect = (bounds: Bounds, fillColor: string | null, border: Border | null): ShapeNode | null =>
      fillColor === null && border === null
        ? null
        : {
            type: "shape",
            key: "",
            locked,
            spin: null,
            form: { kind: "rect", corner: 0 },
            box: bounds,
            look: { stroke: border === null ? null : { color: border.color, width: border.width, dash: "solid" }, fill: fillColor === null ? null : { kind: "color", color: fillColor }, opacity, ...(shadow ? { shadow } : {}) },
            label: null,
          };
    // Un pezzo di HTML scritto in area nel riquadro `bounds`.
    const text = (html: string, bounds: Bounds, header: boolean, textAlign: Align, frameAlign: VAlign): TextNode | null => {
      const base = typeFor(header);
      const { paragraphs, rules } = htmlParagraphs(html, base, (name) => familyOf(name, this.notes), this.notes);
      if (paragraphs.every((runs) => runs.every((run) => run.text.trim() === ""))) return null;
      const content: Content = { type: base, align: textAlign, leading: LEADING, paragraphs, ...(rules.length === 0 ? {} : { rules }), ...(shadow ? { shadow } : {}) };
      const width = Math.max(1, bounds.max[0] - bounds.min[0]);
      const x = textAlign === "start" ? bounds.min[0] : textAlign === "end" ? bounds.max[0] : (bounds.min[0] + bounds.max[0]) / 2;
      return { type: "text", key: "", locked, spin: null, at: [x, bounds.min[1] + base.size], width, frame: { top: bounds.min[1], bottom: bounds.max[1], align: frameAlign }, content, opacity };
    };
    const out: Node[] = [];
    for (const block of layoutBlocks(blocks, room, extent)) {
      if (block.kind === "html") {
        const node = text(block.html, block.box, false, align, "top");
        if (node !== null) out.push(node);
        continue;
      }
      const frame = rect(block.box, block.fill, block.border);
      if (frame !== null) out.push(frame);
      for (const each of block.cells) {
        const back = rect(each.box, each.fill, each.border);
        if (back !== null) out.push(back);
        const node = text(each.html, each.inner, each.header, each.align, each.valign);
        if (node !== null) out.push(node);
      }
    }
    return out;
  }

  /// Il testo di una cella senza forma.
  private bare(cell: Cell, box: Bounds): Node[] {
    const table = this.tabled(cell, box);
    if (table !== null) return table;
    const content = this.contentOf(cell, false);
    if (content === null) return [];
    return [this.textNode(content, cell.style, box, num(cell.style.get("rotation"), 0), centreOf(box), on(cell.style, "locked"))];
  }

  /// Ciò che una forma disegna da sé, senza ciò che contiene.
  private own(cell: Cell, box: Bounds): Node[] {
    const style = cell.style;
    const shape = style.get("shape") ?? "";
    const [w, h] = [box.max[0] - box.min[0], box.max[1] - box.min[1]];
    const direction = style.get("direction") ?? "east";
    const flipX = on(style, "flipH");
    const flipY = on(style, "flipV");
    const invisible = colorOf(style, "fillColor", "#ffffff") === null && colorOf(style, "strokeColor", "#000000") === null;
    switch (shape) {
      case "swimlane":
      case "table":
        return this.swimlane(cell, box);
      case "tableRow":
        // Una riga di tabella non disegna niente: le righe sono della tabella.
        return this.bare(cell, box);
      case "partialRectangle":
        return this.partial(cell, box);
      case "mxgraph.ios7ui.horLines":
        // Il fondo coi soli lati in alto e in basso, come un archivio dei
        // diagrammi di flusso dei dati.
        return this.partial({ ...cell, style: new Map([...style, ["top", "1"], ["bottom", "1"], ["left", "0"], ["right", "0"]]) }, box);
      case "line":
        return this.line(cell, box);
      case "image":
        return this.image(cell, box);
      case "umlLifeline":
        return this.lifeline(cell, box);
      case "umlActor":
        return this.stickman(cell, box);
      case "singleArrow":
      case "doubleArrow": {
        const double = shape === "doubleArrow";
        const id = direction === "north" ? (double ? "arrow-up-down" : "arrow-up") : direction === "south" ? (double ? "arrow-up-down" : "arrow-down") : direction === "west" ? (double ? "arrow-left-right" : "arrow-left") : double ? "arrow-left-right" : "arrow-right";
        return this.shaped(cell, box, { kind: "library", id });
      }
    }
    const outline = outlineOf(shape, style, direction === "north" || direction === "south" ? h : w, direction === "north" || direction === "south" ? w : h);
    const library = LIBRARY[shape];
    if (invisible && (RECTS.has(shape) || ELLIPSES.has(shape) || outline !== null || library !== undefined)) {
      const icon = RECTS.has(shape) && style.get("image") !== undefined ? this.icon(style, box) : null;
      return icon === null ? this.bare(cell, box) : [icon, ...this.bare(cell, box)];
    }
    if (RECTS.has(shape)) {
      const shaped = this.shaped(cell, box, { kind: "rect", corner: this.corner(style, w, h) });
      const icon = style.get("image") === undefined ? null : this.icon(style, box);
      if (icon === null) return shaped;
      return [shaped[0]!, icon, ...shaped.slice(1)];
    }
    if (ELLIPSES.has(shape)) {
      if (shape === "doubleEllipse") this.notes.add("stencil", shape);
      return this.shaped(cell, box, { kind: "ellipse" });
    }
    if (outline !== null) return this.shaped(cell, box, { kind: "outline", segments: directed(outline, direction, flipX, flipY) });
    if (library !== undefined) {
      if (direction === "east" || library === "basic-diamond") return this.shaped(cell, box, { kind: "library", id: library });
      // Una forma della raccolta girata: la forma gira, il testo no.
      const angle = direction === "south" ? 90 : direction === "north" ? -90 : 180;
      const centre = centreOf(box);
      const turnedBox: Bounds = angle === 180 ? box : { min: [centre[0] - h / 2, centre[1] - w / 2], max: [centre[0] + h / 2, centre[1] + w / 2] };
      const [form] = this.shaped({ ...cell, style: new Map([...style, ["rotation", String(num(style.get("rotation"), 0) + angle)]]) }, turnedBox, { kind: "library", id: library }, true, false);
      const content = this.contentOf(cell, false);
      return content === null ? [form!] : [form!, this.textNode(content, style, box, num(style.get("rotation"), 0), centre, on(style, "locked"))];
    }
    // Una forma che FubDraw non ha: un rettangolo dei suoi colori, o
    // tratteggiato in grigio se non ne ha.
    this.notes.add("stencil", shape);
    if (invisible) {
      const placeholder = new Map(style);
      placeholder.set("strokeColor", "#999999");
      placeholder.set("dashed", "1");
      placeholder.delete("dashPattern");
      return this.shaped({ ...cell, style: placeholder }, box, { kind: "rect", corner: 0 });
    }
    return this.shaped(cell, box, { kind: "rect", corner: 0 });
  }

  /// L'immagine `image` di un rettangolo (`mxLabel`): `imageWidth` ×
  /// `imageHeight`, nel lato e all'altezza che dicono `imageAlign` e
  /// `imageVerticalAlign`; `null` se sta fuori dal file.
  private icon(style: Style, box: Bounds): Node | null {
    const href = imageHref(style.get("image") ?? "");
    if (!href.startsWith("data:image/")) {
      this.notes.add("image", href.length > 80 ? `${href.slice(0, 79)}…` : href);
      return null;
    }
    const [w, h] = [box.max[0] - box.min[0], box.max[1] - box.min[1]];
    const [iw, ih] = [num(style.get("imageWidth"), 24), num(style.get("imageHeight"), 24)];
    const spacing = num(style.get("spacing"), 2) + 5;
    const align = style.get("imageAlign") ?? "left";
    const valign = style.get("imageVerticalAlign") ?? "middle";
    const x = align === "center" ? box.min[0] + (w - iw) / 2 : align === "right" ? box.max[0] - iw - spacing : box.min[0] + spacing;
    const y = valign === "top" ? box.min[1] + spacing : valign === "bottom" ? box.max[1] - ih - spacing : box.min[1] + (h - ih) / 2;
    const image: ImageNode = { type: "image", key: "", locked: on(style, "locked"), spin: null, href, box: boxOf(x, y, iw, ih), opacity: Math.min(1, Math.max(0, num(style.get("opacity"), 100) / 100)), crop: null, flip: null };
    return this.shadowed(style, "shadow") ? { ...image, shadow: true } : image;
  }

  /// L'angolo tondo di un rettangolo di draw.io (`arcSize`): una parte del
  /// lato più corto, o assoluto.
  private corner(style: Style, w: number, h: number): number {
    if (!on(style, "rounded")) return 0;
    if (on(style, "absoluteArcSize")) return Math.min(w / 2, h / 2, num(style.get("arcSize"), 20) / 2);
    return (Math.min(w, h) * num(style.get("arcSize"), 15)) / 100;
  }

  /// Una corsia o una tabella: il riquadro intero, la testata col titolo e,
  /// in una tabella, le righe fra righe e colonne.
  private swimlane(cell: Cell, box: Bounds): Node[] {
    const style = cell.style;
    const size = Math.max(0, num(style.get("startSize"), 40));
    const horizontal = style.get("horizontal") !== "0";
    const [w, h] = [box.max[0] - box.min[0], box.max[1] - box.min[1]];
    const corner = this.corner(style, w, h);
    const body = new Map(style);
    body.set("fillColor", style.get("swimlaneFillColor") ?? "none");
    const whole = this.shaped({ ...cell, style: body }, box, { kind: "rect", corner }, true, false);
    if (size <= 0) {
      const content = this.contentOf(cell, false);
      const top = new Map(style);
      top.set("verticalAlign", "top");
      return content === null ? whole : [...whole, this.textNode(content, top, box, num(style.get("rotation"), 0), centreOf(box), on(style, "locked"))];
    }
    const header: Bounds = horizontal ? { min: box.min, max: [box.max[0], Math.min(box.max[1], box.min[1] + size)] } : { min: box.min, max: [Math.min(box.max[0], box.min[0] + size), box.max[1]] };
    const head = new Map(style);
    if (style.get("swimlaneLine") === "0") head.set("strokeColor", "none");
    head.delete("labelPosition");
    head.delete("verticalLabelPosition");
    return [...whole, ...this.shaped({ ...cell, style: head }, header, { kind: "rect", corner: Math.min(corner, size / 2) })];
  }

  /// Le righe fra le righe e le colonne di una tabella (`rowLines`,
  /// `columnLines`), sotto la testata.
  private tableLines(cell: Cell, box: Bounds): Node[] {
    if (cell.style.get("shape") !== "table") return [];
    const rows = (this.children.get(cell.id) ?? []).filter((row) => row.vertex && row.visible);
    const look = this.look(cell.style, false);
    if (look.stroke === null || rows.length === 0) return [];
    const out: Node[] = [];
    const line = (a: Point, b: Point): Node => ({ type: "path", key: "", locked: false, spin: null, points: [a, b], smooth: false, closed: false, look, start: null, end: null });
    if (cell.style.get("rowLines") !== "0") {
      for (const row of rows.slice(1)) {
        const rowBox = this.boxOfCell(row);
        if (rowBox !== null) out.push(line([box.min[0], rowBox.min[1]], [box.max[0], rowBox.min[1]]));
      }
    }
    if (cell.style.get("columnLines") !== "0") {
      const first = rows[0]!;
      const top = this.boxOfCell(first)?.min[1] ?? box.min[1];
      for (const column of (this.children.get(first.id) ?? []).filter((each) => each.vertex && each.visible).slice(1)) {
        const columnBox = this.boxOfCell(column);
        if (columnBox !== null) out.push(line([columnBox.min[0], top], [columnBox.min[0], box.max[1]]));
      }
    }
    return out;
  }

  /// Un rettangolo coi soli lati scritti (`partialRectangle`): il fondo
  /// senza contorno, e i lati come linee.
  private partial(cell: Cell, box: Bounds): Node[] {
    const style = cell.style;
    const sides = (["top", "right", "bottom", "left"] as const).map((side) => style.get(side) !== "0");
    const noStroke = new Map(style);
    noStroke.set("strokeColor", "none");
    const filled = colorOf(style, "fillColor", "#ffffff") !== null;
    const nodes: Node[] = filled ? this.shaped({ ...cell, style: noStroke }, box, { kind: "rect", corner: 0 }) : this.bare(cell, box);
    const look = this.look(style, false);
    if (look.stroke === null || !sides.some(Boolean)) return nodes;
    const corners: Point[] = [box.min, [box.max[0], box.min[1]], box.max, [box.min[0], box.max[1]]];
    // I lati scritti, uniti dove si toccano, in giro dall'alto.
    const start = sides.every(Boolean) ? 0 : sides.findIndex((side, i) => side && !sides[(i + 3) % 4]);
    let run: Point[] = [];
    const runs: Point[][] = [];
    for (let k = 0; k < 4; k++) {
      const i = (start + k) % 4;
      if (sides[i]) {
        if (run.length === 0) run.push(corners[i]!);
        run.push(corners[(i + 1) % 4]!);
      } else if (run.length > 0) {
        runs.push(run);
        run = [];
      }
    }
    if (run.length > 0) runs.push(run);
    for (const points of runs) {
      const closed = points.length === 5;
      nodes.push({ type: "path", key: "", locked: false, spin: null, points, smooth: false, closed, look: { ...look, fill: null }, start: null, end: null });
    }
    return nodes;
  }

  /// Una linea (`shape=line`): orizzontale a metà del riquadro, verticale se
  /// va a nord o a sud.
  private line(cell: Cell, box: Bounds): Node[] {
    const style = cell.style;
    const [cx, cy] = centreOf(box);
    const direction = style.get("direction") ?? "east";
    const points: Point[] = direction === "north" || direction === "south" ? [[cx, box.min[1]], [cx, box.max[1]]] : [[box.min[0], cy], [box.max[0], cy]];
    const rotation = num(style.get("rotation"), 0);
    const spin = Math.abs(rotation % 360) < 1e-9 ? null : { angle: rotation, centre: [cx, cy] as Point };
    const path: Node = { type: "path", key: "", locked: on(style, "locked"), spin, points, smooth: false, closed: false, look: this.look(style, false), start: null, end: null };
    return [path, ...this.bare(cell, box)];
  }

  /// Un'immagine, con la sua didascalia.
  private image(cell: Cell, box: Bounds): Node[] {
    const style = cell.style;
    const href = imageHref(style.get("image") ?? "");
    const nodes: Node[] = [];
    if (href.startsWith("data:image/")) {
      const centre = centreOf(box);
      const rotation = num(style.get("rotation"), 0);
      const flipX = on(style, "flipH") || on(style, "imageFlipH");
      const flipY = on(style, "flipV") || on(style, "imageFlipV");
      nodes.push({
        type: "image",
        key: "",
        locked: on(style, "locked"),
        spin: Math.abs(rotation % 360) < 1e-9 ? null : { angle: rotation, centre },
        href,
        box,
        opacity: Math.min(1, Math.max(0, num(style.get("opacity"), 100) / 100)),
        crop: null,
        flip: flipX || flipY ? { x: flipX, y: flipY, centre } : null,
        ...(this.shadowed(style, "shadow") ? { shadow: true } : {}),
      });
    } else {
      this.notes.add("image", href.length > 80 ? `${href.slice(0, 79)}…` : href);
    }
    return [...nodes, ...this.bare(cell, box)];
  }

  /// Una linea della vita di UML: la testata col nome e la linea
  /// tratteggiata che scende.
  private lifeline(cell: Cell, box: Bounds): Node[] {
    const style = cell.style;
    const size = Math.min(box.max[1] - box.min[1], Math.max(0, num(style.get("size"), 40)));
    if (style.get("participant") !== undefined) this.notes.add("stencil", style.get("participant")!);
    const header: Bounds = { min: box.min, max: [box.max[0], box.min[1] + size] };
    const head = new Map(style);
    head.set("verticalAlign", "middle");
    const nodes = this.shaped({ ...cell, style: head }, header, { kind: "rect", corner: 0 });
    const look = this.look(style, false);
    const cx = (box.min[0] + box.max[0]) / 2;
    nodes.push({
      type: "path",
      key: "",
      locked: false,
      spin: null,
      points: [[cx, box.min[1] + size], [cx, box.max[1]]],
      smooth: false,
      closed: false,
      look: { ...look, stroke: look.stroke === null ? null : { ...look.stroke, dash: style.get("lifelineDashed") === "0" ? "solid" : "dashed" } },
      start: null,
      end: null,
    });
    // Gli archi prendono la linea di vita intera, non la sola testata.
    return this.hooked.has(cell.id) ? [hookBox(box, nameIn(nodes)), ...nodes] : nodes;
  }

  /// L'omino di UML: la testa, il corpo, le braccia e le gambe.
  private stickman(cell: Cell, box: Bounds): Node[] {
    const style = cell.style;
    const [x, y] = box.min;
    const [w, h] = [box.max[0] - x, box.max[1] - y];
    const look = this.look(style, false);
    const head = this.shaped({ ...cell, style }, boxOf(x + w / 4, y, w / 2, h / 4), { kind: "ellipse" }, true, false);
    const path = (points: Point[]): Node => ({ type: "path", key: "", locked: false, spin: null, points, smooth: false, closed: false, look, start: null, end: null });
    const label = this.bare(cell, box);
    // Gli archi prendono il riquadro dell'omino, come in draw.io, non la
    // sua testa.
    return [
      ...(this.hooked.has(cell.id) ? [hookBox(box, nameIn(label))] : []),
      ...head,
      path([[x + w / 2, y + h / 4], [x + w / 2, y + (2 * h) / 3]]),
      path([[x, y + h / 3], [x + w, y + h / 3]]),
      path([[x, y + h], [x + w / 2, y + (2 * h) / 3], [x + w, y + h]]),
      ...label,
    ];
  }

  // -- Gli archi ---------------------------------------------------------------

  /// Il capo di un arco sulla cella `id`: la forma, il suo riquadro e il
  /// punto del file; `null` se non c'è o non è una forma.
  private terminal(id: string | null): { readonly cell: Cell; readonly box: Bounds } | null {
    if (id === null) return null;
    const cell = this.byId.get(id);
    if (cell === undefined || !cell.vertex) return null;
    const box = this.boxOfCell(cell);
    return box === null ? null : { cell, box };
  }

  /// I capi di un arco: le forme agganciate, i punti fissi sul loro bordo,
  /// i punti di passaggio e dove il file mette i capi, sul punto fisso, al
  /// centro della forma o dove dice la geometria; `null` se non ha due capi.
  private endsOf(cell: Cell): Ends | null {
    const style = cell.style;
    const g = cell.geometry;
    const origin = this.origin(cell);
    const local = (p: Point): Point => [origin[0] + p[0], origin[1] + p[1]];
    const via = (g?.points ?? []).map(local);
    const source = this.terminal(cell.source);
    const target = this.terminal(cell.target);
    const loose = (end: "source" | "target"): Point | null => {
      const p = end === "source" ? g?.source : g?.target;
      return p !== undefined && p !== null ? local(p) : this.middleOf(end === "source" ? cell.source : cell.target);
    };
    // Un punto fisso, spostato di `Dx` e `Dy`, e portato sul contorno se
    // `Perimeter` non lo vieta.
    const fixed = (end: { readonly cell: Cell; readonly box: Bounds } | null, side: "exit" | "entry"): Point | null => {
      const [x, y] = [style.get(`${side}X`), style.get(`${side}Y`)];
      if (end === null || x === undefined || y === undefined) return null;
      const [w, h] = [end.box.max[0] - end.box.min[0], end.box.max[1] - end.box.min[1]];
      const at: Point = [end.box.min[0] + num(x, 0.5) * w + num(style.get(`${side}Dx`), 0), end.box.min[1] + num(y, 0.5) * h + num(style.get(`${side}Dy`), 0)];
      return style.get(`${side}Perimeter`) === "0" ? at : perimeterPoint(end.box, this.perimeterOf(end.cell), at);
    };
    const startFixed = fixed(source, "exit");
    const endFixed = fixed(target, "entry");
    const startAt = startFixed ?? (source !== null ? centreOf(source.box) : loose("source"));
    const endAt = endFixed ?? (target !== null ? centreOf(target.box) : loose("target"));
    if (startAt === null || endAt === null) return null;
    return { source, target, via, startFixed, endFixed, startAt, endAt };
  }

  /// La linea di un arco, a stima: dal bordo della prima forma, per i punti
  /// di passaggio, al bordo dell'ultima; `null` se non ha due capi, o se
  /// l'arco si aggancia, per altri archi, a sé stesso.
  private pathOf(cell: Cell): Point[] | null {
    if (this.walking.has(cell.id)) return null;
    this.walking.add(cell.id);
    try {
      const ends = this.endsOf(cell);
      if (ends === null) return null;
      const points = [ends.startAt, ...ends.via, ends.endAt];
      if (ends.startFixed === null && ends.source !== null) points[0] = rimOf(ends.source.box, this.perimeterOf(ends.source.cell), points[1]!);
      if (ends.endFixed === null && ends.target !== null) points[points.length - 1] = rimOf(ends.target.box, this.perimeterOf(ends.target.cell), points[points.length - 2]!);
      return points;
    } finally {
      this.walking.delete(cell.id);
    }
  }

  /// Il punto di mezzo di un arco, a stima: per un capo agganciato a un
  /// altro arco.
  private middleOf(id: string | null): Point | null {
    const cell = id === null ? undefined : this.byId.get(id);
    if (cell === undefined || !cell.edge) return null;
    const path = this.pathOf(cell);
    return path === null ? null : along(path, 0.5).at;
  }

  /// Il punto di un'etichetta di geometria `g` sull'arco `edge`, come lo
  /// mette draw.io: a `(x + 1) / 2` della lunghezza, a `y` dalla linea, di
  /// lato, e spostato di `offset`.
  private labelPoint(edge: Cell, g: Geometry): Point | null {
    const path = this.pathOf(edge);
    if (path === null) return null;
    const { at, direction } = along(path, Math.min(1, Math.max(0, (g.x + 1) / 2)));
    const offset = g.offset ?? [0, 0];
    return [at[0] - direction[1] * g.y + offset[0], at[1] + direction[0] * g.y + offset[1]];
  }

  /// Un arco: un connettore, o una linea con le punte se è libero e ha più
  /// punti; `null` se non ha due capi.
  private edge(cell: Cell): Node[] {
    const style = cell.style;
    const geometry = this.endsOf(cell);
    if (geometry === null) {
      this.notes.add("placeless");
      return [];
    }
    const { source, target, via, startFixed, endFixed, startAt, endAt } = geometry;
    const look = this.look(style, false);
    // Un arco senza tratto non si vede, con le sue punte: restano le
    // etichette, testi a sé.
    if (look.stroke === null) return this.looseLabels(cell);
    const shape = style.get("shape");
    if (shape !== undefined && shape !== "connector") this.notes.add("stencil", shape);
    const start = tipOf(style.get("startArrow") ?? "none", style.get("startFill") !== "0", num(style.get("startSize"), 6), this.notes);
    const end = tipOf(style.get("endArrow") ?? "none", style.get("endFill") !== "0", num(style.get("endSize"), 6), this.notes);
    const labels = this.edgeLabels(cell);
    const base: BaseOf = { key: this.key(cell.id), locked: on(style, "locked"), spin: null };
    const edgeStyle = style.get("edgeStyle") ?? "none";
    const curved = on(style, "curved");
    const elbow = ORTHOGONAL.has(edgeStyle);
    // Un arco libero con più punti, né a gomito né curvo, resta una linea.
    if (source === null && target === null && via.length > 0 && !elbow && !curved && labels.length === 0) {
      return [{ ...base, type: "path", points: [startAt, ...via, endAt], smooth: false, closed: false, look, start, end }];
    }
    // Il percorso delle relazioni fra entità esce di lato e rientra di lato.
    const entity = edgeStyle === "entityRelationEdgeStyle" && !curved && via.length === 0 && source !== null && target !== null && startFixed === null && endFixed === null ? entityRoute(source.box, target.box, num(style.get("segment"), 30)) : null;
    const side = (left: boolean): Anchor => (left ? "left" : "right");
    const from: Hook = source === null ? { at: startAt } : { node: this.key(source.cell.id), anchor: entity !== null ? side(entity.sourceLeft) : anchorOf(style.get("exitX"), style.get("exitY")), at: startAt };
    const to: Hook = target === null ? { at: endAt } : { node: this.key(target.cell.id), anchor: entity !== null ? side(entity.targetLeft) : anchorOf(style.get("entryX"), style.get("entryY")), at: endAt };
    let kind: ConnectorKind = elbow ? (curved ? "curved" : "elbow") : curved && via.length > 0 ? "curved" : "straight";
    let route: readonly Point[] | null = entity?.points ?? null;
    if (SIMPLE_ELBOWS.has(edgeStyle) && !curved) {
      const points = this.simpleElbow(edgeStyle, style, geometry);
      if (points.length <= MAX_ELBOW_POINTS) route = points;
    } else if (edgeStyle === "sequenceEdgeStyle" && via.length <= 1) {
      // Un messaggio di un diagramma di sequenza: dritto e orizzontale,
      // all'altezza del suo punto di passaggio o del capo libero.
      kind = "straight";
      route = sequenceRoute(source?.box ?? null, target?.box ?? null, startAt, endAt, via[0] ?? null);
    } else if (via.length > 0) {
      const ends = this.ends(source, target, startFixed ?? (source === null ? startAt : null), endFixed ?? (target === null ? endAt : null), via, elbow && !curved);
      if (elbow && !curved) {
        const points = elbowThrough(ends.start, via, ends.end, ends.firstVertical, ends.lastVertical);
        if (points.length <= MAX_ELBOW_POINTS) route = points;
        else this.notes.add("route");
      } else {
        const drawn = [ends.start, ...via, ends.end];
        if (!curved && drawn.length <= MAX_ELBOW_POINTS && orthogonal(drawn, 1)) {
          kind = "elbow";
          route = drawn;
        } else {
          const { points: samples } = sampled(curved ? curvedThrough(drawn) : drawn.map((to, i): Segment => ({ kind: i === 0 ? "move" : "line", to })));
          const fitted = fitCubic(samples);
          const lengths = runningLengths(samples);
          if (!curved || fitted.error > Math.max(ROUTE_TOLERANCE, lengths[lengths.length - 1]! * ROUTE_SHARE)) this.notes.add("route");
          kind = "curved";
          route = fitted.points;
        }
      }
    }
    const node: LineNode = { ...base, type: "line", kind, from, to, look, start, end, labels, route };
    return [node];
  }

  /// Le etichette di un arco come testi a sé, ciascuna dove la mette
  /// draw.io.
  private looseLabels(cell: Cell): Node[] {
    const out: Node[] = [];
    const opacity = Math.min(1, Math.max(0, num(cell.style.get("opacity"), 100) / 100));
    const add = (content: Content | null, g: Geometry | null): void => {
      const at = content === null ? null : this.labelPoint(cell, g !== null && g.relative ? g : ON_LINE);
      if (content !== null && at !== null) out.push(pointText(content, at, opacity));
    };
    add(this.contentOf(cell, true), cell.geometry);
    for (const child of this.children.get(cell.id) ?? []) {
      if (child.visible && child.vertex) add(this.contentOf(child, true), child.geometry);
    }
    return out;
  }

  /// Il percorso di un arco dei gomiti semplici di draw.io, come lo fa
  /// draw.io: col primo punto di passaggio soltanto, e i capi sul contorno
  /// delle forme, dritti verso la curva quando possono.
  private simpleElbow(edgeStyle: string, style: Style, ends: Ends): Point[] {
    const { source, target, via, startFixed, endFixed, startAt, endAt } = ends;
    const pt = via[0] ?? null;
    // `elbowEdgeStyle` sceglie il verso guardando le due forme.
    let vertical = false;
    let horizontal = false;
    if (edgeStyle === "elbowEdgeStyle" && source !== null && target !== null) {
      const [a, b] = [source.box, target.box];
      if (pt !== null) {
        vertical = pt[1] < Math.min(a.min[1], b.min[1]) || pt[1] > Math.max(a.max[1], b.max[1]);
        horizontal = pt[0] < Math.min(a.min[0], b.min[0]) || pt[0] > Math.max(a.max[0], b.max[0]);
      } else {
        vertical = Math.max(a.min[0], b.min[0]) === Math.min(a.max[0], b.max[0]);
        if (!vertical) horizontal = Math.max(a.min[1], b.min[1]) === Math.min(a.max[1], b.max[1]);
      }
    }
    const down = edgeStyle === "topToBottomEdgeStyle" || (edgeStyle === "elbowEdgeStyle" && !horizontal && (vertical || style.get("elbow") === "vertical"));
    const startFree = startFixed ?? (source === null ? startAt : null);
    const endFree = endFixed ?? (target === null ? endAt : null);
    const s: Bounds = startFree !== null ? { min: startFree, max: startFree } : source!.box;
    const t: Bounds = endFree !== null ? { min: endFree, max: endFree } : target!.box;
    const swap = (p: Point): Point => [p[1], p[0]];
    const middle = down ? sideToSide(transposed(s), transposed(t), pt === null ? null : swap(pt)).map(swap) : sideToSide(s, t, pt);
    const end = endFree ?? orthogonalRim(t, this.perimeterOf(target!.cell), middle[middle.length - 1] ?? startFree ?? centreOf(s));
    const start = startFree ?? orthogonalRim(s, this.perimeterOf(source!.cell), middle[0] ?? end);
    return elbowThrough(start, middle, end, null, null);
  }

  /// Il contorno di `cell` per i capi degli archi.
  private perimeterOf(cell: Cell): Perimeter {
    const perimeter = cell.style.get("perimeter") ?? "";
    const shape = cell.style.get("shape") ?? "";
    if (perimeter.startsWith("ellipse") || (perimeter === "" && ELLIPSES.has(shape))) return "ellipse";
    if (perimeter.startsWith("rhombus") || (perimeter === "" && shape === "rhombus")) return "rhombus";
    return "rect";
  }

  /// I punti in cui un arco con dei punti di passaggio esce dalla prima
  /// forma ed entra nell'ultima: il punto fisso, o il bordo verso il punto
  /// di passaggio vicino; per un gomito, dritto verso di lui.
  private ends(
    sourceEnd: { readonly cell: Cell; readonly box: Bounds } | null,
    targetEnd: { readonly cell: Cell; readonly box: Bounds } | null,
    startFixed: Point | null,
    endFixed: Point | null,
    via: readonly Point[],
    elbow: boolean,
  ): { readonly start: Point; readonly end: Point; readonly firstVertical: boolean | null; readonly lastVertical: boolean | null } {
    const first = via[0]!;
    const last = via[via.length - 1]!;
    const [source, target] = [sourceEnd?.box ?? null, targetEnd?.box ?? null];
    const side = (box: Bounds | null, p: Point): boolean | null => {
      if (box === null) return null;
      return Math.abs(p[1] - box.min[1]) < 0.5 || Math.abs(p[1] - box.max[1]) < 0.5;
    };
    let start: Point;
    let firstVertical: boolean | null = null;
    if (startFixed !== null) {
      start = startFixed;
      firstVertical = side(source, start);
    } else if (source !== null && elbow) {
      const exit = exitTowards(source, first);
      start = exit.at;
      firstVertical = exit.vertical;
    } else {
      start = sourceEnd === null ? first : rimOf(sourceEnd.box, this.perimeterOf(sourceEnd.cell), first);
    }
    let end: Point;
    let lastVertical: boolean | null = null;
    if (endFixed !== null) {
      end = endFixed;
      lastVertical = side(target, end);
    } else if (target !== null && elbow) {
      const entry = exitTowards(target, last);
      end = entry.at;
      lastVertical = entry.vertical;
    } else {
      end = targetEnd === null ? last : rimOf(targetEnd.box, this.perimeterOf(targetEnd.cell), last);
    }
    return { start, end, firstVertical, lastVertical };
  }

  /// Le etichette di un arco: il suo testo, e quello delle celle figlie,
  /// ciascuna dove sta lungo la linea.
  private edgeLabels(cell: Cell): { readonly content: Content; readonly t: number }[] {
    const out: { content: Content; t: number }[] = [];
    const t = (g: Geometry | null): number => Math.min(1, Math.max(0, ((g?.x ?? 0) + 1) / 2));
    const own = this.contentOf(cell, true);
    if (own !== null) out.push({ content: own, t: t(cell.geometry?.relative === false ? null : cell.geometry) });
    for (const child of this.children.get(cell.id) ?? []) {
      if (!child.visible || !child.vertex) continue;
      const content = this.contentOf(child, true);
      if (content !== null) out.push({ content, t: child.geometry?.relative ? t(child.geometry) : 0.5 });
    }
    return out;
  }
}
