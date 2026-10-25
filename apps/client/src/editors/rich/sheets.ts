// I fogli di Pagina e di Lettura.
//
// Ogni interruzione di pagina e ogni fine di sezione che comincia a pagina
// nuova apre un foglio, con la sua intestazione, il suo piè e i numeri che ne
// seguono. Sono della vista: il documento non cambia. La scrivania disegna le
// sagome dietro il testo (`.rich-sheets`, che la pelle dipinge); dove un
// foglio finisce il testo lascia uno spazio, un widget alto quanto serve
// perché il testo del foglio dopo cominci sotto il suo margine. In Scrittura
// la carta non c'è: lo spazio non si vede e l'interruzione resta una riga con
// il suo nome (`structure.css`).
//
// I fogli sono quanti le interruzioni: un foglio il cui testo non sta nella
// sua pagina si allunga, non si spezza. Una sezione che comincia su una pagina
// pari o dispari apre un foglio come una che comincia alla pagina dopo, senza
// il foglio bianco che Word mette per arrivarci.

import type { Node as PmNode } from "prosemirror-model";
import { Plugin, PluginKey, type EditorState } from "prosemirror-state";
import { Decoration, DecorationSet, type EditorView } from "prosemirror-view";
import { t } from "../../i18n/strings";
import { sectionName } from "./breaks";
import { DEFAULT_PAGE, runningOnSheet } from "./page";
import type { Page, RunningText } from "./projection";

/// Una sezione del documento: la pagina, l'intestazione e il piè che porta
/// il suo segno di fine (`pos`), o il documento per l'ultima (`null`).
export interface SheetSection {
  readonly pos: number | null;
  readonly page: Page | null;
  readonly header: RunningText | null;
  readonly footer: RunningText | null;
}

/// Un foglio: la sezione dove comincia, la sua pagina e l'intestazione e il
/// piè che mostra, che una sezione senza i suoi prende dalla sezione prima.
export interface Sheet {
  readonly section: number;
  readonly page: Page;
  readonly header: RunningText | null;
  readonly footer: RunningText | null;
}

/// Dove un foglio finisce: il nodo che lo chiude (un salto pagina o il segno
/// di fine di una sezione) e la posizione dove comincia il foglio dopo.
export interface SheetCut {
  readonly node: number;
  readonly size: number;
  readonly at: number;
  /// Il segno di fine sta fra i blocchi; il salto pagina dentro un paragrafo.
  readonly block: boolean;
  readonly name: string;
}

export interface SheetPlan {
  readonly sections: readonly SheetSection[];
  readonly sheets: readonly Sheet[];
  readonly cuts: readonly SheetCut[];
}

const PAGE_BREAK = "\u000c";

/// I fogli di un documento. Contano le interruzioni del primo livello: un
/// salto pagina in una tabella non apre un foglio, come in Word.
export function sheetPlan(doc: PmNode): SheetPlan {
  const sections: SheetSection[] = [];
  doc.forEach((node, pos) => {
    if (node.type.name === "section") sections.push(sectionOf(node.attrs, pos));
  });
  sections.push(sectionOf(doc.attrs, null));
  const header: (RunningText | null)[] = [];
  const footer: (RunningText | null)[] = [];
  for (const [i, section] of sections.entries()) {
    header.push(section.header ?? (i > 0 ? header[i - 1]! : null));
    footer.push(section.footer ?? (i > 0 ? footer[i - 1]! : null));
  }
  const sheets: Sheet[] = [];
  const cuts: SheetCut[] = [];
  const open = (k: number) => sheets.push({ section: k, page: sections[k]!.page ?? DEFAULT_PAGE, header: header[k]!, footer: footer[k]! });
  let section = 0;
  open(0);
  doc.forEach((node, pos) => {
    if (node.type.name === "section") {
      section += 1;
      const next = sections[section]!.page;
      // Senza una pagina (un formato che non ne ha) e con una sezione che
      // continua sullo stesso foglio la fine resta una riga.
      const start = next?.start ?? "next_page";
      if (!next || start === "continuous" || start === "next_column") return;
      cuts.push({ node: pos, size: node.nodeSize, at: pos + node.nodeSize, block: true, name: sectionName(next) });
      open(section);
      return;
    }
    if (!node.isTextblock) return;
    node.forEach((child, offset) => {
      if (child.type.name !== "brk" || child.attrs.ch !== PAGE_BREAK) return;
      const at = pos + 1 + offset;
      cuts.push({ node: at, size: child.nodeSize, at: at + child.nodeSize, block: false, name: t("rich.break.page") });
      open(section);
    });
  });
  return { sections, sheets, cuts };
}

function sectionOf(attrs: Record<string, unknown>, pos: number | null): SheetSection {
  return {
    pos,
    page: attrs.page as Page | null,
    header: attrs.header as RunningText | null,
    footer: attrs.footer as RunningText | null,
  };
}

/// Il foglio dove sta la posizione `pos`.
export function sheetAt(plan: SheetPlan, pos: number): number {
  let sheet = 0;
  while (sheet < plan.cuts.length && plan.cuts[sheet]!.at <= pos) sheet += 1;
  return sheet;
}

/// Lo spazio fra due fogli, in px.
export const SHEET_GAP = 24;
/// Il margine della scrivania attorno ai fogli, per lato, in px
/// (`.rich-page` in `structure.css`).
export const DESK_INSET = 24;
/// Un punto in px: 1/72 di pollice, a 96 px per pollice.
export const PX_PER_PT = 4 / 3;

/// Dove sta un foglio sulla scrivania, in px dall'alto.
export interface SheetBox {
  readonly top: number;
  readonly height: number;
}

export interface SheetLayout {
  readonly boxes: readonly SheetBox[];
  /// L'altezza di ogni spazio, perché il testo del foglio dopo cominci sotto
  /// il suo margine.
  readonly gaps: readonly number[];
  /// L'altezza di tutta la scrivania.
  readonly height: number;
}

/// I fogli sulla scrivania. `natural` dice dove comincia ogni spazio e `end`
/// dove finisce il testo, in px dall'alto, come se gli spazi non fossero alti
/// niente. Ogni foglio è alto almeno la sua pagina, e di più se il suo testo
/// con il margine di sotto non ci sta; il testo del foglio dopo comincia al
/// suo margine di sopra.
export function sheetLayout(sheets: readonly Sheet[], natural: readonly number[], end: number): SheetLayout {
  const boxes: SheetBox[] = [];
  const gaps: number[] = [];
  let top = 0;
  let shift = 0;
  for (const [i, sheet] of sheets.entries()) {
    const page = sheet.page;
    const last = i === sheets.length - 1;
    const y = (last ? end : natural[i]!) + shift;
    const height = Math.max(page.h * PX_PER_PT, y - top + page.bottom * PX_PER_PT);
    boxes.push({ top, height });
    if (last) break;
    const next = top + height + SHEET_GAP;
    const gap = Math.max(0, next + sheets[i + 1]!.page.top * PX_PER_PT - y);
    gaps.push(gap);
    shift += gap;
    top = next;
  }
  const lastBox = boxes[boxes.length - 1]!;
  return { boxes, gaps, height: lastBox.top + lastBox.height };
}

/// La scala della carta perché il foglio stia nella vista: largo quanto la
/// vista, o intero. `view` e `sheet` in px, `inset` il margine della vista per
/// lato. Mai meno di un decimo, mai più del doppio.
export function fitScale(fit: "width" | "page", view: { readonly width: number; readonly height: number }, sheet: { readonly width: number; readonly height: number }, inset: number): number {
  // Una vista non ancora misurata non cambia niente.
  if (!(view.width > 0 && view.height > 0)) return 1;
  const across = (view.width - 2 * inset) / sheet.width;
  const scale = fit === "width" ? across : Math.min(across, (view.height - 2 * inset) / sheet.height);
  return Math.min(2, Math.max(0.1, scale));
}

/// Dove apre l'intestazione o il piè di un foglio: il margine di sopra o di
/// sotto.
export interface RunningZone {
  readonly sheet: number;
  readonly kind: "header" | "footer";
}

/// La distanza dell'intestazione dal bordo del foglio, e del piè dal bordo di
/// sotto, in pt: quella di Word (1,27 cm), o metà del margine se è stretto.
export function runningInset(margin: number): number {
  return Math.min(36, margin / 2);
}

/// Disegna e misura i fogli di una scrivania. La misura si fa una volta per
/// fotogramma, dopo un cambio del documento o della sua misura, e soltanto se
/// la carta si vede: legge dove cominciano gli spazi, poi scrive le altezze,
/// e scrive soltanto ciò che cambia di almeno mezzo px, così la misura che
/// segue la propria scrittura si ferma.
export class SheetDesk {
  readonly #desk: HTMLElement;
  readonly #layer: HTMLElement;
  #view: EditorView | null = null;
  #plan: SheetPlan | null = null;
  #frame = 0;
  #observer: ResizeObserver | null = null;
  #layout: SheetLayout | null = null;
  #scale = 1;
  #drawn: string[] = [];
  #drawnPlan: SheetPlan | null = null;
  #drawnLayout = "";

  constructor(desk: HTMLElement, layer: HTMLElement) {
    this.#desk = desk;
    this.#layer = layer;
  }

  /// Il piano dello stato di adesso, quando la vista lo dà.
  bind(view: EditorView, plan: SheetPlan): void {
    this.#view = view;
    const changed = plan !== this.#plan;
    this.#plan = plan;
    if (!this.#observer && typeof ResizeObserver !== "undefined") {
      this.#observer = new ResizeObserver(() => this.schedule());
      this.#observer.observe(view.dom);
    }
    // Il testo si muove soltanto se cambia il documento; il resto lo dice
    // la misura della vista.
    if (changed) this.schedule();
  }

  get plan(): SheetPlan | null {
    return this.#plan;
  }

  /// La carta si vede: in Pagina e in Lettura, non in Scrittura.
  visible(): boolean {
    return this.#layer.isConnected && getComputedStyle(this.#layer).display !== "none";
  }

  schedule(): void {
    if (this.#frame !== 0 || typeof requestAnimationFrame === "undefined") return;
    this.#frame = requestAnimationFrame(() => {
      this.#frame = 0;
      this.measure();
    });
  }

  /// Misura e ridisegna subito; `false` se la carta non si vede.
  measure(): boolean {
    const view = this.#view;
    const plan = this.#plan;
    if (!view || !plan || !this.visible()) return false;
    const desk = this.#desk.getBoundingClientRect();
    const width = plan.sheets[0]!.page.w * PX_PER_PT;
    // Lo zoom scala la scrivania: le misure lette tornano in px della carta.
    const scale = desk.width > 0 ? desk.width / width : 0;
    if (scale <= 0) return false;
    const gaps = [...view.dom.querySelectorAll<HTMLElement>(".rich-sheet-gap")];
    if (gaps.length !== plan.cuts.length) return false;
    const heights = gaps.map((gap) => Number.parseFloat(gap.style.height) || 0);
    let before = 0;
    const natural = gaps.map((gap, i) => {
      const y = (gap.getBoundingClientRect().top - desk.top) / scale - before;
      before += heights[i]!;
      return y;
    });
    const lastChild = view.dom.lastElementChild;
    const bottom = lastChild ? (lastChild.getBoundingClientRect().bottom - desk.top) / scale : 0;
    const layout = sheetLayout(plan.sheets, natural, bottom - before);
    for (const [i, gap] of gaps.entries()) {
      if (Math.abs(heights[i]! - layout.gaps[i]!) > 0.5) gap.style.height = `${layout.gaps[i]}px`;
    }
    const signature = JSON.stringify(layout);
    this.#layout = layout;
    this.#scale = scale;
    if (plan === this.#drawnPlan && signature === this.#drawnLayout) return true;
    this.#drawnPlan = plan;
    this.#drawnLayout = signature;
    this.#draw(plan, layout, width);
    return true;
  }

  #draw(plan: SheetPlan, layout: SheetLayout, width: number): void {
    const total = plan.sheets.length;
    const drawn: string[] = [];
    const children = [...this.#layer.children] as HTMLElement[];
    const sheets = children.filter((child) => child.classList.contains("rich-sheet"));
    for (const child of children) if (!child.classList.contains("rich-sheet")) child.remove();
    for (const sheet of sheets.slice(total)) sheet.remove();
    for (const [i, sheet] of plan.sheets.entries()) {
      const box = layout.boxes[i]!;
      const w = sheet.page.w * PX_PER_PT;
      const head = sheet.header ? runningOnSheet(sheet.header, i + 1, total) : "";
      const foot = sheet.footer ? runningOnSheet(sheet.footer, i + 1, total) : "";
      const key = JSON.stringify([box.top, box.height, w, head, foot, sheet.page.top, sheet.page.bottom, sheet.page.left, sheet.page.right]);
      drawn.push(key);
      let element = sheets[i];
      if (!element) {
        element = document.createElement("div");
        element.className = "rich-sheet";
        this.#layer.append(element);
      } else if (this.#drawn[i] === key) continue;
      element.style.cssText = `inset: auto; top: ${box.top}px; left: ${(width - w) / 2}px; width: ${w}px; height: ${box.height}px`;
      element.replaceChildren(
        ...[
          running("rich-sheet-head", head, `top: ${runningInset(sheet.page.top)}pt`, sheet.page),
          running("rich-sheet-foot", foot, `bottom: ${runningInset(sheet.page.bottom)}pt`, sheet.page),
        ].filter((part): part is HTMLElement => part !== null),
      );
    }
    // Il nome di un'interruzione sta nello spazio fra i due fogli.
    for (const [i, cut] of plan.cuts.entries()) {
      const name = document.createElement("div");
      name.className = "rich-sheet-name";
      name.textContent = cut.name;
      name.style.top = `${layout.boxes[i + 1]!.top - SHEET_GAP / 2}px`;
      this.#layer.append(name);
    }
    this.#drawn = drawn;
    this.#desk.style.setProperty("--desk-h", `${layout.height}px`);
  }

  /// Il margine dove cade un punto dello schermo: l'intestazione o il piè di
  /// un foglio, se la carta si vede.
  zoneAt(clientX: number, clientY: number): RunningZone | null {
    const plan = this.#plan;
    const layout = this.#layout;
    if (!plan || !layout || !this.visible()) return null;
    const desk = this.#desk.getBoundingClientRect();
    const width = plan.sheets[0]!.page.w * PX_PER_PT;
    const x = (clientX - desk.left) / this.#scale;
    const y = (clientY - desk.top) / this.#scale;
    for (const [i, box] of layout.boxes.entries()) {
      const page = plan.sheets[i]!.page;
      const left = (width - page.w * PX_PER_PT) / 2;
      if (y < box.top || y > box.top + box.height || x < left || x > left + page.w * PX_PER_PT) continue;
      if (y - box.top < page.top * PX_PER_PT) return { sheet: i, kind: "header" };
      if (box.top + box.height - y < page.bottom * PX_PER_PT) return { sheet: i, kind: "footer" };
      return null;
    }
    return null;
  }

  /// L'ultima altezza misurata dello spazio `i`.
  gap(i: number): number {
    return this.#layout?.gaps[i] ?? 0;
  }

  /// Dove sta un foglio, in px della scrivania, se è già misurato.
  box(sheet: number): { readonly top: number; readonly height: number; readonly left: number } | null {
    const plan = this.#plan;
    const box = this.#layout?.boxes[sheet];
    if (!plan || !box) return null;
    const width = plan.sheets[0]!.page.w * PX_PER_PT;
    return { ...box, left: (width - plan.sheets[sheet]!.page.w * PX_PER_PT) / 2 };
  }

  destroy(): void {
    if (this.#frame !== 0) cancelAnimationFrame(this.#frame);
    this.#frame = 0;
    this.#observer?.disconnect();
    this.#observer = null;
    this.#view = null;
  }
}

/// L'intestazione o il piè disegnati sul foglio, in grigio: il testo con i
/// numeri veri. `null` se il foglio non ne ha.
function running(className: string, text: string, edge: string, page: Page): HTMLElement | null {
  if (text === "") return null;
  const element = document.createElement("div");
  element.className = className;
  element.textContent = text;
  element.style.cssText = `${edge}; left: ${page.left}pt; right: ${page.right}pt`;
  return element;
}

const sheetKey = new PluginKey<{ readonly plan: SheetPlan; readonly decorations: DecorationSet }>("fub-rich-sheets");

function decorate(doc: PmNode, plan: SheetPlan, gap: (i: number) => number): DecorationSet {
  if (plan.cuts.length === 0) return DecorationSet.empty;
  const out: Decoration[] = [];
  for (const [i, cut] of plan.cuts.entries()) {
    out.push(Decoration.node(cut.node, cut.node + cut.size, { class: "rich-cut" }));
    out.push(
      Decoration.widget(
        cut.at,
        () => {
          const element = document.createElement(cut.block ? "div" : "span");
          element.className = "rich-sheet-gap";
          element.setAttribute("aria-hidden", "true");
          element.contentEditable = "false";
          const height = gap(i);
          if (height > 0) element.style.height = `${height}px`;
          return element;
        },
        { side: -1, key: `sheet-gap-${i}-${cut.block ? "b" : "i"}`, ignoreSelection: true },
      ),
    );
  }
  return DecorationSet.create(doc, out);
}

/// Il piano dei fogli dello stato, se lo stato ha il plugin.
export function sheetPlanOf(state: EditorState): SheetPlan | null {
  return sheetKey.getState(state)?.plan ?? null;
}

/// Il plugin dei fogli di una scrivania: tiene il piano, mette gli spazi e i
/// segni dei tagli, e dopo ogni aggiornamento chiede la misura. Un doppio clic
/// nel margine di un foglio apre la sua intestazione o il suo piè.
export function sheetsPlugin(desk: SheetDesk, open: (zone: RunningZone) => boolean): Plugin {
  // Uno spazio rifatto prende l'ultima altezza misurata, perché il testo non
  // salti in attesa della misura.
  const gap = (i: number) => desk.gap(i);
  return new Plugin({
    key: sheetKey,
    state: {
      init: (_config, state) => {
        const plan = sheetPlan(state.doc);
        return { plan, decorations: decorate(state.doc, plan, gap) };
      },
      apply: (tr, value) => {
        if (!tr.docChanged) return value;
        const plan = sheetPlan(tr.doc);
        return { plan, decorations: decorate(tr.doc, plan, gap) };
      },
    },
    props: {
      decorations: (state) => sheetKey.getState(state)?.decorations ?? DecorationSet.empty,
      handleDoubleClick: (_view, _pos, event) => {
        const zone = desk.zoneAt(event.clientX, event.clientY);
        if (!zone || !open(zone)) return false;
        event.preventDefault();
        return true;
      },
    },
    view: (view) => {
      desk.bind(view, sheetKey.getState(view.state)!.plan);
      return {
        update: (next) => desk.bind(next, sheetKey.getState(next.state)!.plan),
      };
    },
  });
}
