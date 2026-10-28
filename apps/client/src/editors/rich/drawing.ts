// I disegni nei documenti: Inserisci › Disegno, la disposizione e la modifica
// sul posto.
//
// Un disegno è un atomo `drawing` della proiezione: l'SVG di FubDraw e il suo
// PNG di ripiego, che disegna il client (`spatial/tools/png.ts`), come lo
// vogliono Word (`asvg:svgBlip` col PNG) e OpenDocument (`draw:frame` con le
// due immagini). Nasce in linea: una tavola bianca di 12 × 8 cm, o la copia di
// un SVG del vault (una copia, non un collegamento).
//
// Doppio clic o Invio su un disegno montano l'editor dei disegni sopra
// l'oggetto, in un pezzo che si carica allora (`drawing-editor.ts`). «Fine» o
// Esc scrivono il disegno cambiato, SVG e PNG nuovi, in una transazione: un
// passo di Annulla del documento. «Apri grande» lo allarga alla finestra. Un
// disegno tenuto e cambiato perde il suo `k` e si riscrive.
//
// Niente si perde in silenzio: se l'oggetto è cambiato mentre lo si
// modificava (un Annulla, un altro riquadro), o se il documento non accetta
// la modifica (si registrano le revisioni), il disegno entra come disegno
// nuovo accanto, e si dice; se nemmeno quello entra, l'editor resta aperto.

import type { Node as PmNode } from "prosemirror-model";
import { closeHistory } from "prosemirror-history";
import { NodeSelection, type Command, type EditorState } from "prosemirror-state";
import { rasterize } from "../spatial/tools/png";
import { t } from "../../i18n/strings";
import { textButton } from "../../kit/button";
import { openLifetime, type Lifetime } from "../../ui/lifetime";
import type { RichEngine } from "./engine";
import type { PlaceWrap, Place } from "./projection";
import { richSchema } from "./schema";

/// La tavola di un disegno nuovo: 12 × 8 cm in pixel CSS.
export const NEW_DRAWING_PX = { w: 454, h: 302 } as const;
/// Punti tipografici per pixel CSS.
const PT = 3 / 4;
/// L'editor non sta in meno di così, anche sopra un disegno piccolo.
const EDITOR_MIN_PX = { w: 720, h: 480 } as const;
/// Un PNG trasparente di un pixel: il ripiego quando il browser non disegna.
const BLANK_PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGBgAAAABQABpfZFQAAAAABJRU5ErkJggg==";

/// L'editor montato sopra un disegno.
export interface RichDrawingEditor {
  /// Il testo del disegno di adesso.
  text(): string;
  focus(): void;
  fit(): void;
}

export interface RichDrawingOptions {
  /// Un'immagine del vault scelta da chi scrive (la scelta di Inserisci ›
  /// Immagine): un disegno si copia soltanto da un SVG.
  readonly pick?: () => Promise<Blob | "unreadable" | null>;
  /// Il PNG di ripiego di un SVG, in base64; `null` se non si disegna. Di
  /// serie lo fa il browser, a doppia densità.
  readonly rasterize?: (svg: string) => Promise<string | null>;
  /// Monta l'editor: di serie il pezzo `drawing-editor.ts`, caricato allora.
  readonly openEditor?: (host: HTMLElement, svg: string, life: Lifetime) => Promise<RichDrawingEditor>;
  /// Dice una cosa a chi scrive.
  readonly notify?: (text: string, tone?: "info" | "guasto") => void;
}

/// Il documento nuovo dell'editor dei disegni, alla misura di una tavola nel
/// documento: radice, titolo, carta e «Livello 1».
export function blankDrawingSvg(): string {
  const { w, h } = NEW_DRAWING_PX;
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:fub="https://fubeo.github.io/ns/scene/1" fub:version="1" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">`,
    "  <title></title>",
    `  <rect id="fub-paper" fub:role="paper" x="0" y="0" width="${w}" height="${h}" fill="#ffffff"/>`,
    '  <g id="livello-1" fub:layer="Livello 1">',
    "  </g>",
    "</svg>",
    "",
  ].join("\n");
}

/// Punti per unità delle misure di un SVG.
const UNITS: Readonly<Record<string, number>> = { "": PT, px: PT, pt: 1, pc: 12, in: 72, cm: 72 / 2.54, mm: 72 / 25.4 };

function length(value: string | null): number | null {
  const match = value?.trim().match(/^([0-9]*\.?[0-9]+(?:e[+-]?[0-9]+)?)\s*([a-z]*)$/i);
  if (!match) return null;
  const unit = UNITS[match[2]!.toLowerCase()];
  const number = Number(match[1]);
  return unit === undefined || !(number > 0) ? null : number * unit;
}

/// La misura in punti di un documento SVG: `width` e `height` della radice,
/// o la sua `viewBox` in pixel. `null` se non è un SVG o non ha misura.
export function drawingSize(svg: string): { w: number; h: number } | null {
  let root: Element | null;
  try {
    root = new DOMParser().parseFromString(svg, "image/svg+xml").documentElement;
  } catch {
    return null;
  }
  if (!root || root.localName !== "svg" || root.namespaceURI !== "http://www.w3.org/2000/svg") return null;
  const box = root.getAttribute("viewBox")?.trim().split(/[\s,]+/).map(Number);
  const boxed = box && box.length === 4 && box[2]! > 0 && box[3]! > 0 ? { w: box[2]! * PT, h: box[3]! * PT } : null;
  const w = length(root.getAttribute("width")) ?? boxed?.w ?? null;
  const h = length(root.getAttribute("height")) ?? boxed?.h ?? null;
  if (w === null || h === null) return null;
  return { w: Math.round(w * 100) / 100, h: Math.round(h * 100) / 100 };
}

/// Un disegno nuovo, in linea dove sta il cursore.
export function insertDrawing(svg: string, data: string, w: number, h: number): Command {
  return (state, dispatch) => {
    if (!state.selection.$from.parent.inlineContent) return false;
    if (dispatch) dispatch(state.tr.replaceSelectionWith(richSchema.nodes.atom.create({ kind: "drawing", svg, data, w, h }), false).scrollIntoView());
    return true;
  };
}

/// Il disegno in `pos` con un SVG e un PNG nuovi: un oggetto nuovo, che tiene
/// il suo nome e il suo posto.
export function replaceDrawing(pos: number, svg: string, data: string, w: number, h: number): Command {
  return (state, dispatch) => {
    const node = state.doc.nodeAt(pos);
    if (node?.type !== richSchema.nodes.atom || node.attrs.kind !== "drawing") return false;
    // Un passo suo, anche subito dopo l'inserimento.
    if (dispatch) dispatch(closeHistory(state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, k: null, svg, data, w, h })));
    return true;
  };
}

/// Gli oggetti che si dispongono: le immagini, i disegni e gli inchiostri.
const PLACED: ReadonlySet<string> = new Set(["image", "drawing", "ink"]);

/// L'oggetto scelto, se è uno che si dispone.
export function selectedObject(state: EditorState): { pos: number; node: PmNode } | null {
  const selection = state.selection;
  if (!(selection instanceof NodeSelection)) return null;
  const node = selection.node;
  return node.type === richSchema.nodes.atom && PLACED.has(node.attrs.kind as string) ? { pos: selection.from, node } : null;
}

/// La disposizione dell'oggetto scelto: `inline`, o come il testo gli gira
/// attorno. `null` senza un oggetto scelto.
export function selectedWrap(state: EditorState): PlaceWrap | "inline" | null {
  const object = selectedObject(state);
  if (!object) return null;
  return (object.node.attrs.float as Place | null)?.wrap ?? "inline";
}

/// Cambia la disposizione dell'oggetto scelto. Fuori dal testo parte da dove
/// sta il paragrafo; tornando in linea perde il suo posto.
export function placeObject(wrap: PlaceWrap | "inline"): Command {
  return (state, dispatch) => {
    const object = selectedObject(state);
    if (!object) return false;
    const before = object.node.attrs.float as Place | null;
    if ((before?.wrap ?? "inline") === wrap) return false;
    const float: Place | null = wrap === "inline" ? null : { wrap, x: before?.x ?? 0, y: before?.y ?? 0 };
    if (dispatch) {
      const tr = state.tr.setNodeMarkup(object.pos, undefined, { ...object.node.attrs, float });
      dispatch(tr.setSelection(NodeSelection.create(tr.doc, object.pos)));
    }
    return true;
  };
}

/// Il PNG di ripiego, in base64, dal browser.
async function browserPng(svg: string): Promise<string | null> {
  const blob = await rasterize(svg);
  if (!blob) return null;
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

/// Un disegno aperto nell'editor.
interface Session {
  /// L'oggetto aperto, per ritrovarlo: un nodo di ProseMirror resta lo stesso
  /// finché nessuno lo cambia.
  readonly node: PmNode;
  readonly host: HTMLElement;
  readonly life: Lifetime;
  editor: RichDrawingEditor | null;
}

export class RichDrawing {
  readonly #engine: RichEngine;
  readonly #options: RichDrawingOptions;
  readonly #life: Lifetime = openLifetime();
  readonly #listeners = new Set<() => void>();
  #session: Session | null = null;
  #destroyed = false;

  constructor(engine: RichEngine, options: RichDrawingOptions = {}) {
    this.#engine = engine;
    this.#options = options;
    const desk = engine.contentElement().parentElement;
    if (desk) {
      // In cattura: Invio su un disegno scelto lo apre, prima che il testo lo
      // sostituisca con un a capo.
      this.#life.listen(desk, "keydown", (event) => this.#key(event), { capture: true });
      this.#life.listen(desk, "dblclick", (event) => this.#doubleClick(event));
    }
  }

  /// Un disegno è aperto nell'editor.
  get editing(): boolean {
    return this.#session !== null;
  }

  /// L'editor è allargato alla finestra.
  get large(): boolean {
    return this.#session?.host.classList.contains("rich-drawing-large") === true;
  }

  onChange(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  #changed(): void {
    for (const listener of [...this.#listeners]) listener();
  }

  #notify(key: Parameters<typeof t>[0], tone: "info" | "guasto" = "info"): void {
    this.#options.notify?.(t(key), tone);
  }

  async #png(svg: string): Promise<string> {
    const draw = this.#options.rasterize ?? browserPng;
    return (await draw(svg).catch(() => null)) ?? BLANK_PNG;
  }

  /// Inserisci › Disegno › Nuovo: una tavola bianca, che si apre subito.
  async insertNew(): Promise<boolean> {
    if (!this.#engine.editable()) return false;
    const svg = blankDrawingSvg();
    const data = await this.#png(svg);
    if (this.#destroyed) return false;
    const { w, h } = NEW_DRAWING_PX;
    if (!this.#engine.apply(insertDrawing(svg, data, w * PT, h * PT))) return false;
    const pos = this.#engine.read((state) => state.selection.from - 1);
    return this.edit(pos);
  }

  /// Inserisci › Disegno › Dal vault: la copia di un SVG, alla sua misura
  /// entro la colonna del testo.
  async insertFromVault(): Promise<boolean> {
    const pick = this.#options.pick;
    if (!pick || !this.#engine.editable()) return false;
    let picked: Blob | "unreadable" | null;
    try {
      picked = await pick();
    } catch {
      picked = "unreadable";
    }
    if (picked === null || this.#destroyed) return false;
    const svg = picked === "unreadable" ? null : await picked.text().catch(() => null);
    const size = svg === null ? null : drawingSize(svg);
    if (svg === null || size === null) {
      this.#notify("rich.drawing.unreadable", "guasto");
      return false;
    }
    const data = await this.#png(svg);
    if (this.#destroyed) return false;
    // Come un'immagine: non più larga della colonna del testo di Word.
    const scale = Math.min(1, 468 / size.w);
    return this.#engine.apply(insertDrawing(svg, data, size.w * scale, size.h * scale));
  }

  /// Apre il disegno in `pos` nell'editor, sopra l'oggetto.
  async edit(pos: number): Promise<boolean> {
    if (this.#destroyed || !this.#engine.editable()) return false;
    const node = this.#engine.read((state) => state.doc.nodeAt(pos));
    const svg = node?.type === richSchema.nodes.atom && node.attrs.kind === "drawing" ? (node.attrs.svg as string | null) : null;
    if (!node || svg === null) return false;
    await this.finish();
    const desk = this.#engine.contentElement().parentElement;
    if (!desk || this.#destroyed) return false;
    const life = openLifetime();
    const host = document.createElement("div");
    host.className = "rich-drawing-editor";
    host.setAttribute("role", "dialog");
    host.setAttribute("aria-label", t("rich.drawing.editing"));
    const bar = document.createElement("div");
    bar.className = "rich-drawing-bar";
    const title = document.createElement("span");
    title.className = "rich-drawing-title";
    title.textContent = t("rich.drawing.editing");
    const large = textButton({ label: t("rich.drawing.large"), onPress: () => this.toggleLarge(), lifetime: life });
    large.classList.add("rich-drawing-grow");
    const done = textButton({ label: t("rich.drawing.done"), kind: "primary", onPress: () => void this.finish(), lifetime: life });
    bar.append(title, large, done);
    const stage = document.createElement("div");
    stage.className = "rich-drawing-stage";
    host.append(bar, stage);
    this.#place(host, pos);
    desk.append(host);
    life.add(() => host.remove());
    life.listen(host, "keydown", (event) => {
      // Esc chiude il disegno quando l'editor non l'ha usato per sé (una
      // scelta, uno strumento a metà).
      if (event.key === "Escape" && !event.defaultPrevented) {
        event.preventDefault();
        void this.finish();
      }
    });
    const session: Session = { node, host, life, editor: null };
    this.#session = session;
    this.#changed();
    try {
      const open = this.#options.openEditor ?? (async (into, text, owner) => (await import("./drawing-editor")).openDrawingEditor(into, text, owner));
      const editor = await open(stage, svg, life);
      if (this.#session !== session) return false;
      session.editor = editor;
      editor.focus();
      return true;
    } catch {
      if (this.#session === session) {
        this.#session = null;
        life.close();
        this.#changed();
      }
      this.#notify("rich.drawing.unopenable", "guasto");
      return false;
    }
  }

  /// L'editor sopra l'oggetto in `pos`, alla sua misura o almeno a quella
  /// dove l'editor sta.
  #place(host: HTMLElement, pos: number): void {
    const atom = this.#engine.elementAt(pos);
    const desk = this.#engine.contentElement().parentElement;
    if (!atom || !desk) return;
    const zoom = this.#engine.zoom();
    const box = atom.getBoundingClientRect();
    const frame = desk.getBoundingClientRect();
    host.style.left = `${Math.max(0, (box.left - frame.left) / zoom)}px`;
    host.style.top = `${Math.max(0, (box.top - frame.top) / zoom)}px`;
    host.style.width = `${Math.max(EDITOR_MIN_PX.w, box.width / zoom)}px`;
    host.style.height = `${Math.max(EDITOR_MIN_PX.h, box.height / zoom)}px`;
  }

  /// «Apri grande» e ritorno: l'editor alla finestra, o sopra l'oggetto.
  toggleLarge(): void {
    const session = this.#session;
    if (!session) return;
    const grown = session.host.classList.toggle("rich-drawing-large");
    const grow = session.host.querySelector<HTMLElement>(".rich-drawing-grow");
    if (grow) grow.lastChild!.textContent = t(grown ? "rich.drawing.small" : "rich.drawing.large");
    session.editor?.fit();
    this.#changed();
  }

  /// «Fine»: il disegno cambiato entra nel documento, in un passo, e
  /// l'editor si chiude. Senza cambiamenti si chiude e basta.
  async finish(): Promise<void> {
    const session = this.#session;
    if (!session) return;
    const before = session.node.attrs.svg as string;
    const text = session.editor?.text() ?? before;
    if (text === before) return this.#close(session);
    const size = drawingSize(text) ?? { w: session.node.attrs.w as number, h: session.node.attrs.h as number };
    const data = await this.#png(text);
    if (this.#session !== session) return;
    if (this.#write(session, text, data, size)) this.#close(session);
  }

  #write(session: Session, svg: string, data: string, size: { w: number; h: number }): boolean {
    const pos = this.#find(session.node);
    if (pos !== null && this.#engine.allows(replaceDrawing(pos, svg, data, size.w, size.h))) {
      return this.#engine.apply(replaceDrawing(pos, svg, data, size.w, size.h));
    }
    // L'oggetto non c'è più, o non si cambia: il disegno entra nuovo, accanto
    // a dov'era o dove sta il cursore.
    const at = pos === null ? null : pos + session.node.nodeSize;
    const insert: Command =
      at === null
        ? insertDrawing(svg, data, size.w, size.h)
        : (state, dispatch) => {
            if (dispatch) dispatch(state.tr.insert(at, richSchema.nodes.atom.create({ kind: "drawing", svg, data, w: size.w, h: size.h })).scrollIntoView());
            return true;
          };
    if (this.#engine.allows(insert) && this.#engine.apply(insert)) {
      this.#notify("rich.drawing.copied");
      return true;
    }
    this.#notify("rich.drawing.refused", "guasto");
    return false;
  }

  /// Dove sta l'oggetto aperto, se c'è ancora così com'era.
  #find(node: PmNode): number | null {
    return this.#engine.read((state) => {
      let found: number | null = null;
      state.doc.descendants((child, pos) => {
        if (found !== null) return false;
        if (child === node) found = pos;
        return child.isBlock;
      });
      return found;
    });
  }

  #close(session: Session): void {
    if (this.#session !== session) return;
    this.#session = null;
    session.life.close();
    this.#changed();
  }

  #key(event: KeyboardEvent): void {
    if (event.key !== "Enter" || event.shiftKey || event.altKey || event.ctrlKey || event.metaKey || this.#session) return;
    const pos = this.#engine.read((state) => {
      const object = selectedObject(state);
      return object?.node.attrs.kind === "drawing" && object.node.attrs.svg !== null ? object.pos : null;
    });
    if (pos === null || !this.#engine.editable()) return;
    event.preventDefault();
    event.stopPropagation();
    void this.edit(pos);
  }

  #doubleClick(event: MouseEvent): void {
    const target = event.target instanceof Element ? event.target.closest(".rich-atom-drawing") : null;
    if (!target || this.#session) return;
    const pos = this.#engine.read((state) => {
      const object = selectedObject(state);
      return object?.node.attrs.kind === "drawing" ? object.pos : null;
    });
    if (pos === null) return;
    event.preventDefault();
    void this.edit(pos);
  }

  /// Smonta: un disegno aperto e cambiato entra nel documento col PNG di
  /// prima (il nuovo si farebbe dopo, a documento chiuso), perché non si
  /// perda.
  destroy(): void {
    if (this.#destroyed) return;
    const session = this.#session;
    if (session) {
      const before = session.node.attrs.svg as string;
      const text = session.editor?.text() ?? before;
      if (text !== before) {
        const size = drawingSize(text) ?? { w: session.node.attrs.w as number, h: session.node.attrs.h as number };
        this.#write(session, text, (session.node.attrs.data as string | null) ?? BLANK_PNG, size);
      }
      this.#session = null;
      session.life.close();
    }
    this.#destroyed = true;
    this.#life.close();
    this.#listeners.clear();
  }
}

