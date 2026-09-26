import type { Theme } from "../../theme/theme";
import type { SyntaxForm } from "../../host/contract";
import { t, onLanguage } from "../../i18n/strings";
import { tryApplyOperation, type EditorChangeOrigin, type TextOperation } from "../core/text-operation";
import {
  applyCanvasPatches,
  commitCanvasPatches,
  inverseCanvasPatches,
  isCanvasOperation,
  newNodeId,
  removeEdgePatch,
  removeNodePatch,
  upsertEdgePatch,
  upsertNodePatch,
  type CanvasOperation,
  type CanvasPatch,
} from "./operation";
import { parseCanvas, type CanvasDocument, type CanvasEdge, type CanvasNode } from "./model";
import { canvasNodeAt } from "./source-edit";
import { byteToCharIndex } from "../../rules/offsets";

export const CANVAS_SNAP = 8;
export const CANVAS_MIN_SIZE = 40;
export const MAX_CANVAS_HISTORY = 100;
const MAX_INTERACTIVE_NODES = 2_000;
const MAX_INTERACTIVE_EDGES = 4_000;

export interface CanvasChange {
  readonly text: string;
  readonly operation: CanvasOperation;
  readonly origin: EditorChangeOrigin;
}

export interface CanvasMediaPort {
  readonly openExternal: (target: string) => void | Promise<void>;
  readonly openViewer?: (target: string) => void | Promise<void>;
}
/** External bytes become cards only after deposit returns; no implicit file writes. */
export interface CanvasAttachmentPort {
  /** Receipts contain vault-relative paths after collision-safe, explicit deposit. */
  readonly deposit: (files: readonly File[], documentId: string) => Promise<readonly string[]>;
  /** Resolve only existing trusted vault paths/folders, never local filesystem bytes. */
  readonly resolvePaths?: (data: DataTransfer, documentId: string) => Promise<readonly string[]>;
  /** Enumerate direct files and OS folder entries once; every result passes through deposit. */
  readonly expandFiles?: (data: DataTransfer) => Promise<readonly File[]>;
}

export interface CanvasEngineOptions {
  readonly surfaceId: string;
  readonly formatId?: string | null;
  readonly revision?: string;
  readonly onChange: (change: CanvasChange) => void;
  readonly onSelectionChange: () => void;
  readonly onOpenWikilink?: (page: string, heading: string | null, block: string | null) => void | Promise<void>;
  readonly onOpenPath?: (path: string, from?: string) => void | Promise<void>;
  readonly onCreateNote?: (initialText: string) => string | void | Promise<string | void>;
  /**
   * Sceglie il file del vault a cui punta una nuova card file; `null` o niente
   * se l'utente rinuncia. Assente = niente bottone «aggiungi file»: una card
   * che punta a un file inventato è un rimando rotto scritto nel documento.
   */
  readonly onPickFile?: () => string | null | void | Promise<string | null | void>;
  readonly documentId?: string;
  readonly media?: CanvasMediaPort;
  readonly attachments?: CanvasAttachmentPort;
  readonly theme?: Theme;
  /**
   * Resa markdown reale di una card testo (stesso `renderMarkdown` della
   * lettura, con `mountMarkdown` per sanitizzazione/embed). Assente = testo
   * non interattivo: nessun secondo parser né scanner locale. `forms` sono le
   * sintassi che il vault dà al Markdown delle card (`EMBEDDED_GRAMMAR`);
   * assenti finché la superficie non le ha ricevute.
   */
  readonly renderMarkdownForCard?: (
    nodeId: string,
    text: string,
    host: HTMLElement,
    forms: readonly SyntaxForm[] | undefined,
  ) => (() => void) | void;
}

interface Viewport {
  x: number;
  y: number;
  zoom: number;
}

function clampZoom(zoom: number): number {
  return Math.min(4, Math.max(0.1, zoom));
}

function snap(value: number): number {
  return Math.round(value / CANVAS_SNAP) * CANVAS_SNAP;
}

const PRESET_FILL: Record<string, string> = {
  "1": "color-mix(in srgb, var(--danger) 18%, transparent)",
  "2": "color-mix(in srgb, var(--warning) 22%, transparent)",
  "3": "color-mix(in srgb, yellow 22%, transparent)",
  "4": "color-mix(in srgb, var(--success) 18%, transparent)",
  "5": "color-mix(in srgb, var(--info) 20%, transparent)",
  "6": "color-mix(in srgb, var(--accent) 18%, transparent)",
};
const CANVAS_COLOR = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

function nodeFill(color: string | undefined): string {
  if (!color) return "var(--doc-bg)";
  return PRESET_FILL[color] ?? color;
}

/** Un path relativo alla radice del vault, senza risalite né caratteri di controllo. */
function isVaultPath(path: unknown): path is string {
  return typeof path === "string" && path.length > 0 && path.length <= 8192
    && !path.startsWith("/") && !path.includes("\\") && !path.split("/").includes("..")
    && !/[\u0000-\u001f]/u.test(path);
}

function externalUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
  } catch {
    return null;
  }
}

export class CanvasEngine {
  readonly #root: HTMLElement;
  readonly #toolbar: HTMLElement;
  readonly #viewport: HTMLElement;
  readonly #stage: HTMLElement;
  readonly #edgeLayer: SVGSVGElement;
  readonly #options: CanvasEngineOptions;
  #forms: readonly SyntaxForm[] | undefined;
  readonly #stopLanguage: () => void;
  readonly #abort = new AbortController();
  #doc: CanvasDocument | null = null;
  #source = "";
  #epoch = 0;
  #selection: string[] = [];
  #edgeSelection: string[] = [];
  #camera: Viewport = { x: 0, y: 0, zoom: 1 };
  #readOnly = false;
  #undo: CanvasPatch[][] = [];
  #redo: CanvasPatch[][] = [];
  #markdownTeardowns = new Map<string, () => void>();
  #destroyed = false;
  #intakeError = "";
  #drag: { pointerId: number; startX: number; startY: number; origin: Map<string, { x: number; y: number }>; moved: boolean } | null = null;
  #resize: { pointerId: number; id: string; startX: number; startY: number; width: number; height: number } | null = null;
  #pan: { pointerId: number; startX: number; startY: number; camX: number; camY: number } | null = null;
  #connect: { pointerId: number; from: string; edgeId?: string; endpoint?: "from" | "to" } | null = null;
  #finishEditing: ((save: boolean) => void) | null = null;

  constructor(parent: HTMLElement, options: CanvasEngineOptions) {
    this.#options = options;
    this.#root = document.createElement("div");
    this.#root.className = "canvas-surface";
    this.#toolbar = document.createElement("div");
    this.#toolbar.className = "canvas-toolbar";
    this.#toolbar.setAttribute("role", "toolbar");
    this.#toolbar.setAttribute("aria-label", t("canvas.surface"));
    this.#viewport = document.createElement("div");
    this.#viewport.className = "canvas-viewport";
    this.#viewport.tabIndex = 0;
    this.#viewport.setAttribute("role", "application");
    this.#viewport.setAttribute("aria-label", t("canvas.surface"));
    this.#stage = document.createElement("div");
    this.#stage.className = "canvas-stage";
    this.#edgeLayer = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    this.#edgeLayer.classList.add("canvas-edges");
    this.#edgeLayer.setAttribute("aria-hidden", "true");
    this.#viewport.append(this.#edgeLayer, this.#stage);
    this.#root.append(this.#toolbar, this.#viewport);
    parent.replaceChildren(this.#root);
    this.#stopLanguage = onLanguage(() => {
      this.#viewport.setAttribute("aria-label", t("canvas.surface"));
      this.#toolbar.setAttribute("aria-label", t("canvas.surface"));
      this.#drawToolbar();
    });
    const signal = this.#abort.signal;
    this.#viewport.addEventListener("pointerdown", (event) => this.#pointerDown(event), { signal });
    this.#viewport.addEventListener("pointermove", (event) => this.#pointerMove(event), { signal });
    this.#viewport.addEventListener("pointerup", (event) => this.#pointerUp(event), { signal });
    this.#viewport.addEventListener("pointercancel", () => this.#cancelGestures(), { signal });
    this.#viewport.addEventListener("wheel", (event) => this.#wheel(event), { signal, passive: false });
    this.#viewport.addEventListener("keydown", (event) => this.#keydown(event), { signal });
    this.#viewport.addEventListener("dblclick", (event) => this.#dblclick(event), { signal });
    this.#viewport.addEventListener("dragover", (event) => {
      if (!this.#readOnly && !this.#isSceneOversized() && event.dataTransfer
        && (this.#options.attachments || event.dataTransfer.types.includes("text/plain"))) event.preventDefault();
    }, { signal });
    this.#viewport.addEventListener("drop", (event) => {
      void this.#intake(event).catch((error: unknown) => this.#showIntakeError(error));
    }, { signal });
    this.#viewport.addEventListener("paste", (event) => {
      void this.#intake(event).catch((error: unknown) => this.#showIntakeError(error));
    }, { signal });
    this.#drawToolbar();
  }

  setDoc(source: string): void {
    if (this.#destroyed) return;
    const document = parseCanvas(source);
    this.#epoch++;
    this.#finishEditing?.(true);
    this.#cancelGestures();
    this.#source = source;
    this.#doc = document;
    this.#intakeError = "";
    this.#selection = [];
    this.#edgeSelection = [];
    this.#undo = [];
    this.#redo = [];
    this.#fitCamera(false);
    this.#render();
  }

  syncDoc(update: { readonly text: string; readonly operation: TextOperation | null } | string): void {
    if (this.#destroyed) return;
    this.#finishEditing?.(true);
    this.#cancelGestures();
    const source = typeof update === "string" ? update : update.text;
    const parsed = parseCanvas(source);
    this.#epoch++;
    this.#intakeError = "";
    const operation = typeof update === "string" ? null : update.operation;
    const verified = operation ? tryApplyOperation(this.#source, operation) : null;
    const patched = operation && isCanvasOperation(operation) && this.#doc
      && verified?.kind === "applied" && verified.text === source
      && applyCanvasPatches(this.#doc, operation.patches)
      && JSON.stringify(this.#doc) === JSON.stringify(parsed);
    this.#source = source;
    if (!patched) this.#doc = parsed;
    this.#pruneSelection();
    this.#render();
  }

  getDoc(): string {
    return this.#source;
  }

  focus(): void {
    if (!this.#destroyed) this.#viewport.focus();
  }

  /**
   * Brings into view the card whose source holds `byteOffset` (UTF-8 bytes,
   * the currency of the model's spans): selects it and frames it. `false`
   * when the offset is outside every card, or the scene is too large to draw.
   */
  revealSource(byteOffset: number): boolean {
    if (this.#destroyed || !this.#doc || this.#isSceneOversized()) return false;
    const index = canvasNodeAt(this.#source, byteToCharIndex(this.#source, byteOffset));
    const node = index === null ? undefined : this.#doc.nodes[index];
    if (!node) return false;
    this.#finishEditing?.(true);
    this.#cancelGestures();
    this.#selection = [node.id];
    this.#edgeSelection = [];
    this.#fitCamera(false, [node]);
    this.#render();
    this.#viewport.focus();
    this.#options.onSelectionChange();
    return true;
  }

  setReadOnly(readOnly: boolean): void {
    this.#finishEditing?.(true);
    this.#cancelGestures();
    this.#readOnly = readOnly;
    this.#root.dataset.readOnly = String(readOnly);
    this.#render();
  }

  setTheme(theme: Theme): void {
    this.#root.dataset.theme = theme;
  }

  /**
   * Le sintassi del Markdown delle card, com'è montato in questo vault. Una
   * card in modifica tiene il suo editor: la resa nuova arriva col disegno
   * successivo.
   */
  setSyntaxForms(forms: readonly SyntaxForm[]): void {
    this.#forms = forms;
    if (!this.#finishEditing) this.#render();
  }

  undo(): boolean {
    this.#finishEditing?.(true);
    const patches = this.#undo.pop();
    if (!patches || !this.#doc) return false;
    const inverse = inverseCanvasPatches(patches);
    if (!this.#commitLocal(inverse, "undo", false)) {
      this.#undo.push(patches);
      return false;
    }
    this.#redo.push(patches);
    return true;
  }

  redo(): boolean {
    this.#finishEditing?.(true);
    const patches = this.#redo.pop();
    if (!patches || !this.#doc) return false;
    if (!this.#commitLocal(patches, "redo", false)) {
      this.#redo.push(patches);
      return false;
    }
    this.#undo.push(patches);
    return true;
  }

  destroy(): void {
    if (this.#destroyed) return;
    this.#finishEditing?.(true);
    this.#destroyed = true;
    for (const teardown of this.#markdownTeardowns.values()) teardown();
    this.#markdownTeardowns.clear();
    this.#stopLanguage();
    this.#abort.abort();
    this.#root.remove();
  }

  #isSceneOversized(): boolean {
    return !!this.#doc && (this.#doc.nodes.length > MAX_INTERACTIVE_NODES
      || this.#doc.edges.length > MAX_INTERACTIVE_EDGES);
  }

  #commitLocal(patches: readonly CanvasPatch[], origin: EditorChangeOrigin, recordHistory: boolean, render = true): boolean {
    if (this.#destroyed || !this.#doc || this.#readOnly || this.#isSceneOversized() || !patches.length) return false;
    const beforeSource = this.#source;
    const committed = commitCanvasPatches(this.#doc, beforeSource, patches);
    if (!committed) return false;
    this.#source = committed.source;
    if (recordHistory) {
      this.#undo.push([...patches]);
      if (this.#undo.length > MAX_CANVAS_HISTORY) this.#undo.shift();
      this.#redo = [];
    }
    this.#pruneSelection();
    if (render) this.#render();
    this.#options.onChange({ text: committed.source, operation: committed.operation, origin });
    return true;
  }

  #commit(patches: readonly CanvasPatch[], origin: EditorChangeOrigin): boolean {
    return this.#commitLocal(patches, origin, true);
  }

  #pruneSelection(): void {
    if (!this.#doc) {
      this.#selection = [];
      this.#edgeSelection = [];
      return;
    }
    const nodes = new Set(this.#doc.nodes.map((n) => n.id));
    const edges = new Set(this.#doc.edges.map((e) => e.id));
    this.#selection = this.#selection.filter((id) => nodes.has(id));
    this.#edgeSelection = this.#edgeSelection.filter((id) => edges.has(id));
  }

  /**
   * The selected cards as text: a card's text, a file's path, a link's URL, a
   * group's label. The last one picked is the primary.
   */
  selectedText(): { primary: string; secondary: string[] } | null {
    const nodes = this.#selectedNodes();
    const last = nodes[nodes.length - 1];
    if (this.#destroyed || !last) return null;
    return { primary: nodeText(last), secondary: nodes.slice(0, -1).map(nodeText) };
  }

  #selectedNodes(): CanvasNode[] {
    if (!this.#doc) return [];
    const byId = new Map(this.#doc.nodes.map((n) => [n.id, n]));
    return this.#selection.map((id) => byId.get(id)!).filter(Boolean);
  }

  // --- camera ---------------------------------------------------------------

  #applyCamera(): void {
    // Camera transforms are immediate for both motion preferences.
    this.#stage.style.transform = `translate(${this.#camera.x}px, ${this.#camera.y}px) scale(${this.#camera.zoom})`;
    this.#edgeLayer.style.transform = `translate(${this.#camera.x}px, ${this.#camera.y}px) scale(${this.#camera.zoom})`;
  }

  #screenToWorld(clientX: number, clientY: number): { x: number; y: number } {
    const rect = this.#viewport.getBoundingClientRect();
    return {
      x: (clientX - rect.left - this.#camera.x) / this.#camera.zoom,
      y: (clientY - rect.top - this.#camera.y) / this.#camera.zoom,
    };
  }

  #fitCamera(announce = true, nodes = this.#doc?.nodes ?? []): void {
    if (!nodes.length) {
      this.#camera = { x: 24, y: 24, zoom: 1 };
      if (announce) this.#applyCamera();
      return;
    }
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const node of nodes) {
      minX = Math.min(minX, node.x);
      minY = Math.min(minY, node.y);
      maxX = Math.max(maxX, node.x + node.width);
      maxY = Math.max(maxY, node.y + node.height);
    }
    const width = Math.max(1, maxX - minX);
    const height = Math.max(1, maxY - minY);
    const rect = this.#viewport.getBoundingClientRect();
    const viewW = Math.max(1, rect.width || 800);
    const viewH = Math.max(1, rect.height || 600);
    const zoom = clampZoom(Math.min(viewW / (width + 160), viewH / (height + 160), 1));
    this.#camera = {
      zoom,
      x: (viewW - width * zoom) / 2 - minX * zoom,
      y: (viewH - height * zoom) / 2 - minY * zoom,
    };
    if (announce) this.#applyCamera();
  }

  #zoomAt(clientX: number, clientY: number, factor: number): void {
    const before = this.#screenToWorld(clientX, clientY);
    this.#camera.zoom = clampZoom(this.#camera.zoom * factor);
    const rect = this.#viewport.getBoundingClientRect();
    this.#camera.x = clientX - rect.left - before.x * this.#camera.zoom;
    this.#camera.y = clientY - rect.top - before.y * this.#camera.zoom;
    this.#applyCamera();
  }

  // --- toolbar ----------------------------------------------------------------

  #drawToolbar(): void {
    const bar = this.#toolbar;
    bar.replaceChildren();
    const mk = (action: string, label: string, run: () => void, disabled = false, mutates = true): HTMLButtonElement => {
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.canvasAction = action;
      button.textContent = label;
      button.disabled = disabled || (mutates && (this.#readOnly || this.#isSceneOversized()));
      button.addEventListener("click", (e) => {
        e.preventDefault();
        run();
        this.#viewport.focus();
      });
      bar.append(button);
      return button;
    };
    mk("add-text", t("canvas.add_text"), () => this.#addNode("text"));
    if (this.#options.onPickFile) {
      mk("add-file", t("canvas.add_file"), () => {
        void this.#addFileNode().catch((error: unknown) => this.#showIntakeError(error));
      });
    }
    mk("add-link", t("canvas.add_link"), () => this.#addNode("link"));
    mk("add-group", t("canvas.add_group"), () => this.#addNode("group"));
    const hasSelection = this.#selection.length > 0 || this.#edgeSelection.length > 0;
    mk("duplicate", t("canvas.duplicate"), () => this.#duplicateSelection(), !hasSelection);
    mk("delete", t("canvas.delete"), () => this.#deleteSelection(), !hasSelection);
    mk("bring-front", t("canvas.bring_front"), () => this.#reorderSelection("front"), this.#selection.length === 0);
    mk("send-back", t("canvas.send_back"), () => this.#reorderSelection("back"), this.#selection.length === 0);
    mk("fit", t("canvas.fit"), () => {
      this.#fitCamera();
      this.#render();
    }, false, false);
    mk("fit-selection", t("canvas.fit_selection"), () => this.#fitCamera(true, this.#selectedNodes()), this.#selection.length === 0, false);
    const layoutLabels = {
      left: t("canvas.align_left"),
      center: t("canvas.align_center"),
      right: t("canvas.align_right"),
      top: t("canvas.align_top"),
      middle: t("canvas.align_middle"),
      bottom: t("canvas.align_bottom"),
      "distribute-x": t("canvas.distribute_x"),
      "distribute-y": t("canvas.distribute_y"),
    } as const;
    for (const axis of ["left", "center", "right", "top", "middle", "bottom", "distribute-x", "distribute-y"] as const) {
      mk(axis, layoutLabels[axis], () => this.#layoutSelection(axis), this.#selection.length < (axis.startsWith("distribute") ? 3 : 2));
    }
    if (!this.#isSceneOversized() && this.#doc?.edges.length && this.#doc.edges.length <= MAX_INTERACTIVE_EDGES) {
      const picker = document.createElement("select");
      picker.dataset.canvasField = "select-edge";
      picker.setAttribute("aria-label", t("canvas.select_edge"));
      const empty = document.createElement("option");
      empty.value = "";
      empty.textContent = t("canvas.select_edge");
      picker.append(empty);
      for (const edge of this.#doc.edges) {
        const option = document.createElement("option");
        option.value = edge.id;
        option.textContent = edge.label || edge.id;
        picker.append(option);
      }
      picker.value = this.#edgeSelection[0] ?? "";
      picker.addEventListener("change", () => {
        this.#edgeSelection = picker.value ? [picker.value] : [];
        this.#selection = [];
        this.#options.onSelectionChange();
        this.#displaySelection();
        this.#toolbar.querySelector<HTMLInputElement>('[data-canvas-field="edge-label"]')?.focus();
      });
      bar.append(picker);
    }
    const colorEditor = (field: "node-color" | "edge-color", label: string, hexLabel: string, current: string | undefined, update: (value: string | undefined) => void): void => {
      const select = document.createElement("select");
      select.dataset.canvasField = field;
      select.setAttribute("aria-label", label);
      for (const value of ["", "1", "2", "3", "4", "5", "6", "custom"]) {
        const option = document.createElement("option");
        option.value = value;
        option.textContent = value || t("canvas.default");
        select.append(option);
      }
      select.value = current && !PRESET_FILL[current] ? "custom" : current ?? "";
      const hex = document.createElement("input");
      hex.type = "text";
      hex.dataset.canvasField = `${field}-hex`;
      hex.placeholder = "#rrggbb";
      hex.setAttribute("aria-label", hexLabel);
      hex.value = current?.startsWith("#") ? current : "";
      hex.disabled = this.#readOnly;
      hex.hidden = select.value !== "custom";
      select.disabled = this.#readOnly;
      select.addEventListener("change", () => {
        hex.hidden = select.value !== "custom";
        if (select.value !== "custom") update(select.value || undefined);
      });
      hex.addEventListener("change", () => {
        if (CANVAS_COLOR.test(hex.value)) update(hex.value);
        else hex.value = current?.startsWith("#") ? current : "";
      });
      bar.append(select, hex);
    };
    if (!this.#isSceneOversized() && this.#selection.length) colorEditor("node-color", t("canvas.node_color"), t("canvas.node_color_hex"), this.#selectedNodes()[0]?.color, (color) => {
      const patches = this.#selectedNodes().map((node) => {
        const next = { ...node };
        if (color === undefined) delete next.color;
        else next.color = color;
        return upsertNodePatch(this.#doc!, next);
      }).filter((patch): patch is NonNullable<typeof patch> => patch !== null);
      this.#commit(patches, "input");
    });
    if (!this.#isSceneOversized() && this.#edgeSelection.length === 1) this.#drawEdgeInspector(bar, colorEditor);
    mk("zoom-in", t("canvas.zoom_in"), () => {
      const rect = this.#viewport.getBoundingClientRect();
      this.#zoomAt(rect.left + rect.width / 2, rect.top + rect.height / 2, 1.2);
    }, false, false);
    mk("zoom-out", t("canvas.zoom_out"), () => {
      const rect = this.#viewport.getBoundingClientRect();
      this.#zoomAt(rect.left + rect.width / 2, rect.top + rect.height / 2, 1 / 1.2);
    }, false, false);
    if (this.#intakeError) {
      const error = document.createElement("output");
      error.setAttribute("role", "alert");
      error.className = "canvas-intake-error";
      error.textContent = this.#intakeError;
      bar.append(error);
    }
  }

  #showIntakeError(error: unknown): void {
    if (this.#destroyed) return;
    this.#intakeError = (error instanceof Error ? error.message : String(error)).slice(0, 300);
    this.#drawToolbar();
  }

  #layoutSelection(axis: "left" | "center" | "right" | "top" | "middle" | "bottom" | "distribute-x" | "distribute-y"): void {
    const nodes = this.#selectedNodes();
    if (this.#readOnly || !this.#doc || nodes.length < (axis.startsWith("distribute") ? 3 : 2)) return;
    const horizontal = axis === "distribute-x";
    const ordered = axis.startsWith("distribute")
      ? [...nodes].sort((a, b) => (horizontal ? a.x + a.width / 2 - b.x - b.width / 2 : a.y + a.height / 2 - b.y - b.height / 2))
      : nodes;
    const minX = Math.min(...nodes.map((node) => node.x));
    const maxX = Math.max(...nodes.map((node) => node.x + node.width));
    const minY = Math.min(...nodes.map((node) => node.y));
    const maxY = Math.max(...nodes.map((node) => node.y + node.height));
    const first = ordered[0];
    const last = ordered[ordered.length - 1];
    const start = horizontal ? first.x + first.width / 2 : first.y + first.height / 2;
    const end = horizontal ? last.x + last.width / 2 : last.y + last.height / 2;
    const patches: CanvasPatch[] = [];
    ordered.forEach((node, index) => {
      const target = { ...node };
      switch (axis) {
        case "left": target.x = snap(minX); break;
        case "center": target.x = snap((minX + maxX - node.width) / 2); break;
        case "right": target.x = snap(maxX - node.width); break;
        case "top": target.y = snap(minY); break;
        case "middle": target.y = snap((minY + maxY - node.height) / 2); break;
        case "bottom": target.y = snap(maxY - node.height); break;
        case "distribute-x":
          if (index && index < ordered.length - 1) target.x = snap(start + (end - start) * index / (ordered.length - 1) - node.width / 2);
          break;
        case "distribute-y":
          if (index && index < ordered.length - 1) target.y = snap(start + (end - start) * index / (ordered.length - 1) - node.height / 2);
          break;
      }
      const patch = upsertNodePatch(this.#doc!, target);
      if (patch) patches.push(patch);
    });
    this.#commit(patches, "input");
  }

  #drawEdgeInspector(bar: HTMLElement, colorEditor: (
    field: "node-color" | "edge-color", label: string, hexLabel: string, current: string | undefined, update: (value: string | undefined) => void
  ) => void): void {
    const id = this.#edgeSelection[0];
    const edge = this.#doc?.edges.find((entry) => entry.id === id);
    if (!edge) return;
    const change = (values: Partial<CanvasEdge>): void => {
      const current = this.#doc?.edges.find((entry) => entry.id === id);
      if (!current || !this.#doc) return;
      const next = { ...current, ...values };
      for (const [key, value] of Object.entries(values)) {
        if (value === undefined) delete next[key];
      }
      const patch = upsertEdgePatch(this.#doc, next);
      if (patch) this.#commit([patch], "input");
    };
    const label = document.createElement("input");
    label.type = "text";
    label.value = edge.label ?? "";
    label.maxLength = 65_536;
    label.disabled = this.#readOnly;
    label.dataset.canvasField = "edge-label";
    label.setAttribute("aria-label", t("canvas.edge_label"));
    label.addEventListener("change", () => change({ label: label.value }));
    bar.append(label);
    for (const field of ["fromNode", "toNode"] as const) {
      const select = document.createElement("select");
      select.dataset.canvasField = `edge-${field}`;
      select.setAttribute("aria-label", t(field === "fromNode" ? "canvas.edge_from_node" : "canvas.edge_to_node"));
      select.disabled = this.#readOnly;
      for (const node of this.#doc!.nodes) {
        const option = document.createElement("option");
        option.value = node.id;
        option.textContent = nodeTitle(node);
        select.append(option);
      }
      select.value = edge[field];
      select.addEventListener("change", () => change({ [field]: select.value } as Partial<CanvasEdge>));
      bar.append(select);
    }
    for (const field of ["fromSide", "toSide", "fromEnd", "toEnd"] as const) {
      const select = document.createElement("select");
      select.dataset.canvasField = `edge-${field}`;
      const fieldLabels = {
        fromSide: "canvas.edge_from_side",
        toSide: "canvas.edge_to_side",
        fromEnd: "canvas.edge_from_end",
        toEnd: "canvas.edge_to_end",
      } as const;
      select.setAttribute("aria-label", t(fieldLabels[field]));
      select.disabled = this.#readOnly;
      const values = field.endsWith("Side") ? ["", "top", "right", "bottom", "left"] : ["", "none", "arrow"];
      for (const value of values) {
        const option = document.createElement("option");
        option.value = value;
        option.textContent = value || t("canvas.default");
        select.append(option);
      }
      select.value = edge[field] ?? "";
      select.addEventListener("change", () => change({ [field]: select.value || undefined } as Partial<CanvasEdge>));
      bar.append(select);
    }
    colorEditor("edge-color", t("canvas.edge_color"), t("canvas.edge_color_hex"), edge.color, (color) => change({ color }));
  }

  async #intake(event: DragEvent | ClipboardEvent): Promise<void> {
    if (event.target instanceof Element && event.target.closest("input,textarea,[contenteditable=true]")) return;
    const drop = event.type === "drop" && "dataTransfer" in event;
    const data = drop ? event.dataTransfer : "clipboardData" in event ? event.clipboardData : null;
    const port = this.#options.attachments;
    const documentId = this.#options.documentId;
    if (!data || this.#readOnly || !this.#doc || this.#destroyed || this.#isSceneOversized()) return;
    if (!port && data.files.length) return;
    const text = data.getData("text/plain");
    if (!port && !text) return;
    this.#intakeError = "";
    this.#drawToolbar();
    event.preventDefault();
    const before = this.#source;
    const epoch = this.#epoch;
    const files = [...new Set(port?.expandFiles ? await port.expandFiles(data) : [...data.files])];
    if (files.length && (!port || !documentId)) return;
    // External bytes pass the explicit deposit. Internal folder paths resolve
    // only via the host port; never trust a raw DataTransfer path.
    const paths = files.length ? await port!.deposit(files, documentId!)
      : port?.resolvePaths && documentId ? await port.resolvePaths(data, documentId) : [];
    if (this.#destroyed || this.#readOnly || this.#source !== before || this.#epoch !== epoch || !this.#doc) return;
    const unique = [...new Set(paths)].filter(isVaultPath);
    if ((!unique.length && !text) || (paths.length > 0 && !unique.length)) return;
    const point = drop ? this.#screenToWorld(event.clientX, event.clientY)
      : this.#screenToWorld(this.#viewport.getBoundingClientRect().left + this.#viewport.clientWidth / 2,
        this.#viewport.getBoundingClientRect().top + this.#viewport.clientHeight / 2);
    const existing = drop ? this.#nodeAt(document.elementFromPoint?.(event.clientX, event.clientY) ?? null) : null;
    const file = this.#doc.nodes.find((node) => node.id === existing && node.type === "file");
    const patches: CanvasPatch[] = [];
    if (file && unique.length) {
      const patch = upsertNodePatch(this.#doc, { ...file, file: unique.shift()!, subpath: undefined });
      if (patch) patches.push(patch);
    }
    unique.forEach((path, index) => {
      const node: CanvasNode = {
        id: newNodeId("n"), type: "file", file: path,
        x: snap(point.x + index * 32), y: snap(point.y + index * 32),
        width: 320, height: 160,
      };
      const patch = upsertNodePatch(this.#doc!, node);
      if (patch) patches.push(patch);
    });
    if (!paths.length && text) {
      const url = externalUrl(text.trim());
      const node: CanvasNode = {
        id: newNodeId("n"), type: url ? "link" : "text",
        x: snap(point.x), y: snap(point.y), width: 320, height: 160,
        ...(url ? { url } : { text }),
      };
      const patch = upsertNodePatch(this.#doc, node);
      if (patch) patches.push(patch);
    }
    this.#commit(patches, "input");
  }

  async #convertTextToNote(node: CanvasNode): Promise<void> {
    if (this.#readOnly || this.#destroyed || !this.#doc || node.type !== "text") return;
    const create = this.#options.onCreateNote;
    if (!create) return;
    const source = this.#source;
    const epoch = this.#epoch;
    const path = await create(node.text ?? "");
    const current = this.#doc?.nodes.find((entry) => entry.id === node.id);
    if (!path || !current || this.#destroyed || this.#readOnly || source !== this.#source || this.#epoch !== epoch
      || JSON.stringify(current) !== JSON.stringify(node)) return;
    const next: CanvasNode = { ...current, type: "file", file: path };
    delete next.text;
    const patch = upsertNodePatch(this.#doc!, next);
    if (patch) this.#commit([patch], "input");
  }

  async #addFileNode(): Promise<void> {
    const pick = this.#options.onPickFile;
    if (!pick || this.#readOnly || this.#destroyed || !this.#doc) return;
    const source = this.#source;
    const epoch = this.#epoch;
    const path = await pick();
    if (!isVaultPath(path) || this.#destroyed || this.#readOnly || source !== this.#source
      || this.#epoch !== epoch) return;
    this.#addNode("file", path);
  }

  /** Una card nuova al centro della vista; una card file vuole il suo `file`. */
  #addNode(type: CanvasNode["type"], file?: string): void {
    if (!this.#doc || this.#readOnly || (type === "file" && !file)) return;
    const rect = this.#viewport.getBoundingClientRect();
    const center = this.#screenToWorld(
      rect.left + (rect.width || 800) / 2,
      rect.top + (rect.height || 600) / 2,
    );
    const node: CanvasNode = {
      id: newNodeId("n"),
      type,
      x: snap(center.x - 160),
      y: snap(center.y - 80),
      width: type === "group" ? 480 : 320,
      height: type === "group" ? 320 : type === "link" ? 120 : 160,
      ...(type === "text" ? { text: "" } : {}),
      ...(type === "file" ? { file } : {}),
      ...(type === "link" ? { url: "https://" } : {}),
      ...(type === "group" ? { label: "" } : {}),
    };
    const patch = upsertNodePatch(this.#doc, node);
    if (patch && this.#commit([patch], "input")) {
      this.#selection = [node.id];
      this.#edgeSelection = [];
      this.#options.onSelectionChange();
    }
  }

  #duplicateSelection(): void {
    if (!this.#doc || this.#readOnly) return;
    const nodes = this.#selectedNodes();
    if (!nodes.length) return;
    const idMap = new Map<string, string>();
    for (const node of nodes) idMap.set(node.id, newNodeId("n"));
    const patches: CanvasPatch[] = [];
    for (const node of nodes) {
      const copy: CanvasNode = JSON.parse(JSON.stringify(node)) as CanvasNode;
      copy.id = idMap.get(node.id)!;
      copy.x = snap(node.x + 32);
      copy.y = snap(node.y + 32);
      const patch = upsertNodePatch(this.#doc, copy);
      if (patch) patches.push(patch);
    }
    if (patches.length && this.#commit(patches, "input")) {
      this.#selection = [...idMap.values()];
      this.#edgeSelection = [];
      this.#options.onSelectionChange();
    }
  }

  #deleteSelection(): void {
    if (!this.#doc || this.#readOnly) return;
    const patches: CanvasPatch[] = [];
    const selected = new Set(this.#selection);
    const edges = new Set(this.#edgeSelection);
    for (const edge of this.#doc.edges) {
      if (selected.has(edge.fromNode) || selected.has(edge.toNode)) edges.add(edge.id);
    }
    for (const id of edges) {
      const patch = removeEdgePatch(this.#doc, id);
      if (patch) patches.push(patch);
    }
    for (const id of selected) {
      const patch = removeNodePatch(this.#doc, id);
      if (patch) patches.push(patch);
    }
    if (patches.length && this.#commit(patches, "input")) {
      this.#selection = [];
      this.#edgeSelection = [];
      this.#options.onSelectionChange();
    }
  }

  #reorderSelection(where: "front" | "back"): void {
    if (!this.#doc || this.#readOnly || !this.#selection.length) return;
    const ids = this.#doc.nodes.map((n) => n.id);
    const selected = new Set(this.#selection);
    const rest = ids.filter((id) => !selected.has(id));
    const after = where === "front" ? [...rest, ...this.#selection] : [...this.#selection, ...rest];
    if (JSON.stringify(ids) === JSON.stringify(after)) return;
    this.#commit([{ kind: "reorder", before: ids, after }], "input");
  }

  // --- pointer ------------------------------------------------------------------

  #nodeAt(target: EventTarget | null): string | null {
    const el = target instanceof Element ? target.closest<HTMLElement>(".canvas-node") : null;
    return el?.dataset.node ?? null;
  }

  #edgeAt(target: EventTarget | null): string | null {
    const el = target instanceof Element ? target.closest<SVGElement>(".canvas-edge-hit") : null;
    return el?.dataset.edge ?? null;
  }
  #displaySelection(): void {
    for (const el of this.#stage.querySelectorAll<HTMLElement>(".canvas-node")) {
      el.classList.toggle("selected", this.#selection.includes(el.dataset.node ?? ""));
    }
    if (this.#doc && !this.#isSceneOversized()) this.#drawEdges();
    this.#drawToolbar();
  }

  #pointerDown(event: PointerEvent): void {
    if (event.button === 1 || event.ctrlKey || event.metaKey || event.altKey) {
      this.#pan = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, camX: this.#camera.x, camY: this.#camera.y };
      this.#viewport.setPointerCapture?.(event.pointerId);
      event.preventDefault();
      return;
    }
    if (event.button !== 0) return;
    const target = event.target;
    const resizeHandle = target instanceof Element ? target.closest<HTMLElement>("[data-resize]") : null;
    if (resizeHandle) {
      const id = resizeHandle.dataset.resize!;
      const node = this.#doc?.nodes.find((n) => n.id === id);
      if (!node || this.#readOnly) return;
      this.#resize = { pointerId: event.pointerId, id, startX: event.clientX, startY: event.clientY, width: node.width, height: node.height };
      this.#viewport.setPointerCapture?.(event.pointerId);
      event.preventDefault();
      return;
    }
    const endpoint = target instanceof Element ? target.closest<SVGElement>("[data-reconnect]") : null;
    if (endpoint && !this.#readOnly) {
      const edge = this.#doc?.edges.find((entry) => entry.id === endpoint.dataset.reconnect);
      if (!edge) return;
      const side = endpoint.dataset.endpoint === "from" ? "from" : "to";
      this.#connect = { pointerId: event.pointerId, from: edge.fromNode, edgeId: edge.id, endpoint: side };
      this.#viewport.setPointerCapture?.(event.pointerId);
      event.preventDefault();
      return;
    }
    const connectHandle = target instanceof Element ? target.closest<HTMLElement>("[data-connect]") : null;
    if (connectHandle) {
      if (this.#readOnly) return;
      this.#connect = { pointerId: event.pointerId, from: connectHandle.dataset.connect! };
      this.#viewport.setPointerCapture?.(event.pointerId);
      event.preventDefault();
      return;
    }
    const nodeId = this.#nodeAt(target);
    if (nodeId) {
      const additive = event.shiftKey;
      if (additive) {
        this.#selection = this.#selection.includes(nodeId)
          ? this.#selection.filter((id) => id !== nodeId)
          : [...this.#selection, nodeId];
        this.#edgeSelection = [];
        this.#options.onSelectionChange();
        this.#displaySelection();
      } else if (!this.#selection.includes(nodeId)) {
        this.#selection = [nodeId];
        this.#edgeSelection = [];
        this.#options.onSelectionChange();
        this.#displaySelection();
      }
      if (this.#readOnly || !this.#doc || !(target instanceof Element && target.closest(".canvas-node-handle"))) return;
      const origin = new Map<string, { x: number; y: number }>();
      for (const id of this.#selection) {
        const node = this.#doc.nodes.find((n) => n.id === id);
        if (node) origin.set(id, { x: node.x, y: node.y });
      }
      // A group carries every card fully inside it. Containment is geometric,
      // not a second persisted parent relation that would conflict with Canvas.
      for (const group of this.#doc.nodes.filter((node) => origin.has(node.id) && node.type === "group")) {
        for (const child of this.#doc.nodes) {
          if (child.id !== group.id && child.x >= group.x && child.y >= group.y
            && child.x + child.width <= group.x + group.width
            && child.y + child.height <= group.y + group.height) {
            origin.set(child.id, { x: child.x, y: child.y });
          }
        }
      }
      this.#drag = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, origin, moved: false };
      this.#viewport.setPointerCapture?.(event.pointerId);
      event.preventDefault();
      return;
    }
    const edgeId = this.#edgeAt(target);
    if (edgeId) {
      this.#edgeSelection = [edgeId];
      this.#selection = [];
      this.#options.onSelectionChange();
      this.#displaySelection();
      return;
    }
    if (!event.shiftKey) {
      this.#selection = [];
      this.#edgeSelection = [];
      this.#options.onSelectionChange();
      this.#displaySelection();
    }
    this.#pan = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, camX: this.#camera.x, camY: this.#camera.y };
    this.#viewport.setPointerCapture?.(event.pointerId);
  }

  #pointerMove(event: PointerEvent): void {
    if (this.#pan && event.pointerId === this.#pan.pointerId) {
      this.#camera.x = this.#pan.camX + (event.clientX - this.#pan.startX);
      this.#camera.y = this.#pan.camY + (event.clientY - this.#pan.startY);
      this.#applyCamera();
      return;
    }
    if (this.#resize && event.pointerId === this.#resize.pointerId && this.#doc) {
      const node = this.#doc.nodes.find((n) => n.id === this.#resize!.id);
      if (!node) return;
      const dx = (event.clientX - this.#resize.startX) / this.#camera.zoom;
      const dy = (event.clientY - this.#resize.startY) / this.#camera.zoom;
      node.width = Math.max(CANVAS_MIN_SIZE, snap(this.#resize.width + dx));
      node.height = Math.max(CANVAS_MIN_SIZE, snap(this.#resize.height + dy));
      this.#renderLive();
      return;
    }
    if (this.#drag && event.pointerId === this.#drag.pointerId && this.#doc) {
      const dx = (event.clientX - this.#drag.startX) / this.#camera.zoom;
      const dy = (event.clientY - this.#drag.startY) / this.#camera.zoom;
      if (Math.abs(event.clientX - this.#drag.startX) + Math.abs(event.clientY - this.#drag.startY) > 3) {
        this.#drag.moved = true;
      }
      for (const [id, origin] of this.#drag.origin) {
        const node = this.#doc.nodes.find((n) => n.id === id);
        if (node) {
          node.x = snap(origin.x + dx);
          node.y = snap(origin.y + dy);
        }
      }
      this.#renderLive();
    }
  }

  #pointerUp(event: PointerEvent): void {
    if (this.#pan && event.pointerId === this.#pan.pointerId) {
      this.#pan = null;
      return;
    }
    if (this.#resize && event.pointerId === this.#resize.pointerId && this.#doc) {
      this.#resize = null;
      this.#commitFromSource("input");
      return;
    }
    if (this.#drag && event.pointerId === this.#drag.pointerId) {
      const drag = this.#drag;
      this.#drag = null;
      if (drag.moved) this.#commitFromSource("input");
      return;
    }
    if (this.#connect && event.pointerId === this.#connect.pointerId) {
      const connect = this.#connect;
      this.#connect = null;
      const hit = document.elementFromPoint(event.clientX, event.clientY);
      const target = this.#nodeAt(hit);
      if (target && this.#doc && !this.#readOnly) {
        const existing = this.#doc.edges.find((edge) => edge.id === connect.edgeId);
        const edge: CanvasEdge | null = existing
          ? { ...existing, [connect.endpoint === "from" ? "fromNode" : "toNode"]: target }
          : target !== connect.from ? {
            id: newNodeId("e"), fromNode: connect.from, toNode: target, toEnd: "arrow",
          } : null;
        if (edge) {
          const patch = upsertEdgePatch(this.#doc, edge);
          if (patch) this.#commit([patch], "input");
        }
      }
      this.#render();
    }
  }

  #cancelGestures(): void {
    const active = this.#drag !== null || this.#resize !== null;
    this.#drag = null;
    this.#resize = null;
    this.#pan = null;
    this.#connect = null;
    if (active && this.#doc) {
      this.#doc = parseCanvas(this.#source);
      this.#render();
    }
  }

  #commitFromSource(origin: EditorChangeOrigin): void {
    if (!this.#doc) return;
    // Ricostruisce le patch confrontando live vs sorgente: preimmagini vere,
    // mai snap del live come before.
    const before = parseCanvas(this.#source);
    const patches: CanvasPatch[] = [];
    const beforeNodes = new Map(before.nodes.map((n) => [n.id, n]));
    const liveNodes = new Map(this.#doc.nodes.map((n) => [n.id, n]));
    for (const [id, live] of liveNodes) {
      const prev = beforeNodes.get(id);
      if (!prev || JSON.stringify(prev) !== JSON.stringify(live)) {
        patches.push({
          kind: "upsert-node",
          before: prev ? JSON.parse(JSON.stringify(prev)) as CanvasNode : null,
          after: JSON.parse(JSON.stringify(live)) as CanvasNode,
        });
      }
    }
    for (const [id, prev] of beforeNodes) {
      if (!liveNodes.has(id)) {
        patches.push({
          kind: "remove-node",
          before: JSON.parse(JSON.stringify(prev)) as CanvasNode,
          at: before.nodes.findIndex((node) => node.id === id),
          after: null,
        });
      }
    }
    const beforeOrder = before.nodes.map((n) => n.id);
    const liveOrder = this.#doc.nodes.map((n) => n.id);
    if (JSON.stringify(beforeOrder) !== JSON.stringify(liveOrder)
      && JSON.stringify([...liveOrder].sort()) === JSON.stringify([...beforeOrder].sort())) {
      patches.push({ kind: "reorder", before: beforeOrder, after: liveOrder });
    }
    this.#doc = before;
    if (patches.length) this.#commit(patches, origin);
    else this.#render();
  }

  #wheel(event: WheelEvent): void {
    event.preventDefault();
    if (event.ctrlKey || event.metaKey) {
      this.#zoomAt(event.clientX, event.clientY, event.deltaY < 0 ? 1.1 : 1 / 1.1);
    } else {
      this.#camera.x -= event.deltaX;
      this.#camera.y -= event.deltaY;
      this.#applyCamera();
    }
  }

  #dblclick(event: MouseEvent): void {
    if (this.#readOnly || this.#nodeAt(event.target)) return;
    this.#addNode("text");
  }

  #keydown(event: KeyboardEvent): void {
    if (!this.#doc || event.defaultPrevented || this.#isSceneOversized()) return;
    const modifier = event.ctrlKey || event.metaKey;
    if (modifier && event.key.toLowerCase() === "z") {
      event.preventDefault();
      if (event.shiftKey) this.redo();
      else this.undo();
      return;
    }
    if (modifier && event.key.toLowerCase() === "y") {
      event.preventDefault();
      this.redo();
      return;
    }
    if (modifier && event.key.toLowerCase() === "a") {
      event.preventDefault();
      this.#selection = this.#doc.nodes.map((n) => n.id);
      this.#edgeSelection = [];
      this.#options.onSelectionChange();
      this.#render();
      return;
    }
    if (modifier && event.key.toLowerCase() === "d") {
      event.preventDefault();
      this.#duplicateSelection();
      return;
    }
    if (modifier && (event.key === "+" || event.key === "=")) {
      event.preventDefault();
      const rect = this.#viewport.getBoundingClientRect();
      this.#zoomAt(rect.left + rect.width / 2, rect.top + rect.height / 2, 1.2);
      return;
    }
    if (modifier && event.key === "-") {
      event.preventDefault();
      const rect = this.#viewport.getBoundingClientRect();
      this.#zoomAt(rect.left + rect.width / 2, rect.top + rect.height / 2, 1 / 1.2);
      return;
    }
    if (modifier && event.key === "0") {
      event.preventDefault();
      this.#fitCamera();
      this.#render();
      return;
    }
    const focus = this.#selection[0] ? this.#doc.nodes.find((n) => n.id === this.#selection[0]) : undefined;
    switch (event.key) {
      case "Delete":
      case "Backspace": {
        if ((event.target as HTMLElement)?.tagName === "TEXTAREA"
          || (event.target as HTMLElement)?.tagName === "INPUT") return;
        event.preventDefault();
        this.#deleteSelection();
        break;
      }
      case "ArrowUp":
      case "ArrowDown":
      case "ArrowLeft":
      case "ArrowRight": {
        if ((event.target as HTMLElement)?.tagName === "TEXTAREA"
          || (event.target as HTMLElement)?.tagName === "INPUT") return;
        event.preventDefault();
        const step = event.shiftKey ? CANVAS_SNAP * 4 : CANVAS_SNAP;
        const dx = event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0;
        const dy = event.key === "ArrowUp" ? -step : event.key === "ArrowDown" ? step : 0;
        if (focus && !this.#readOnly) {
          const patches: CanvasPatch[] = [];
          for (const id of this.#selection) {
            const node = this.#doc.nodes.find((n) => n.id === id);
            if (node) {
              const patch = upsertNodePatch(this.#doc, { ...node, x: node.x + dx, y: node.y + dy });
              if (patch) patches.push(patch);
            }
          }
          this.#commit(patches, "input");
        } else if (focus) {
          const index = this.#doc.nodes.indexOf(focus);
          const next = this.#doc.nodes[index + (event.key === "ArrowDown" || event.key === "ArrowRight" ? 1 : -1)];
          if (next) {
            this.#selection = [next.id];
            this.#options.onSelectionChange();
            this.#render();
          }
        } else if (this.#doc.nodes.length) {
          this.#selection = [this.#doc.nodes[0].id];
          this.#options.onSelectionChange();
          this.#render();
        }
        break;
      }
      case "Enter": {
        if (focus && (event.target === this.#viewport || (event.target as HTMLElement)?.classList.contains("canvas-node"))) {
          event.preventDefault();
          this.#beginCardEdit(focus);
        }
        break;
      }
    }
  }

  // --- render -------------------------------------------------------------------

  #renderLive(): void {
    // Drag/resize updates moved nodes and connected edges without replacing cards.
    const moved = this.#drag?.origin.keys() ?? this.#selection.values();
    for (const id of moved) {
      const node = this.#doc?.nodes.find((n) => n.id === id);
      const el = this.#stage.querySelector<HTMLElement>(`[data-node="${CSS.escape(id)}"]`);
      if (node && el) {
        el.style.transform = `translate(${node.x}px, ${node.y}px)`;
        el.style.width = `${node.width}px`;
        el.style.height = `${node.height}px`;
      }
    }
    this.#drawEdges();
  }

  #render(): void {
    if (!this.#doc) return;
    for (const teardown of this.#markdownTeardowns.values()) teardown();
    this.#markdownTeardowns.clear();
    this.#applyCamera();
    this.#drawToolbar();
    this.#stage.replaceChildren();
    this.#viewport.dataset.canvasNodes = String(this.#doc.nodes.length);
    this.#viewport.dataset.canvasEdges = String(this.#doc.edges.length);
    if (this.#isSceneOversized()) {
      this.#edgeLayer.replaceChildren();
      const fallback = document.createElement("p");
      fallback.className = "canvas-large-fallback";
      fallback.textContent = t("canvas.too_large");
      this.#stage.append(fallback);
      this.#viewport.dataset.canvasProtocol = "source-fallback";
      return;
    }
    this.#drawEdges();
    // Z-order = ordine array: primo sotto, ultimo sopra (come da spec).
    for (const node of this.#doc.nodes) {
      this.#stage.append(this.#nodeEl(node));
    }
    this.#viewport.dataset.canvasProtocol = "source";
  }

  #drawEdges(): void {
    if (!this.#doc) return;
    const byId = new Map(this.#doc.nodes.map((n) => [n.id, n]));
    this.#edgeLayer.replaceChildren();
    const worldW = this.#worldSize();
    this.#edgeLayer.setAttribute("viewBox", `0 0 ${worldW.w} ${worldW.h}`);
    this.#edgeLayer.style.width = `${worldW.w}px`;
    this.#edgeLayer.style.height = `${worldW.h}px`;
    for (const edge of this.#doc.edges) {
      const from = byId.get(edge.fromNode);
      const to = byId.get(edge.toNode);
      if (!from || !to) continue;
      const a = edgePoint(from, edge.fromSide ?? "right", true);
      const b = edgePoint(to, edge.toSide ?? "left", false);
      const selected = this.#edgeSelection.includes(edge.id);
      const group = document.createElementNS("http://www.w3.org/2000/svg", "g");
      group.classList.add("canvas-edge");
      const hit = document.createElementNS("http://www.w3.org/2000/svg", "path");
      hit.classList.add("canvas-edge-hit");
      hit.dataset.edge = edge.id;
      const line = document.createElementNS("http://www.w3.org/2000/svg", "path");
      line.classList.add("canvas-edge-line");
      line.dataset.edge = edge.id;
      if (selected) line.classList.add("selected");
      const d = `M ${a.x} ${a.y} C ${a.x + (b.x - a.x) / 2} ${a.y}, ${b.x - (b.x - a.x) / 2} ${b.y}, ${b.x} ${b.y}`;
      hit.setAttribute("d", d);
      line.setAttribute("d", d);
      if (edge.color) line.setAttribute("stroke", PRESET_FILL[edge.color] ?? edge.color);
      group.append(hit, line);
      for (const [endpoint, point, end] of [
        ["from", a, edge.fromEnd], ["to", b, edge.toEnd],
      ] as const) {
        if (end !== "arrow") continue;
        const angle = Math.atan2(b.y - a.y, b.x - a.x) + (endpoint === "from" ? Math.PI : 0);
        const dx = Math.cos(angle) * 10;
        const dy = Math.sin(angle) * 10;
        const marker = document.createElementNS("http://www.w3.org/2000/svg", "path");
        marker.setAttribute("d", `M ${point.x} ${point.y} L ${point.x - dx - dy / 2} ${point.y - dy + dx / 2} L ${point.x - dx + dy / 2} ${point.y - dy - dx / 2} Z`);
        marker.classList.add("canvas-edge-arrow");
        group.append(marker);
      }
      if (edge.label) {
        const label = document.createElementNS("http://www.w3.org/2000/svg", "text");
        label.setAttribute("x", String((a.x + b.x) / 2));
        label.setAttribute("y", String((a.y + b.y) / 2 - 6));
        label.classList.add("canvas-edge-label");
        label.textContent = edge.label;
        group.append(label);
      }
      if (selected && !this.#readOnly) {
        for (const [endpoint, point] of [["from", a], ["to", b]] as const) {
          const handle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
          handle.classList.add("canvas-edge-reconnect");
          handle.dataset.reconnect = edge.id;
          handle.dataset.endpoint = endpoint;
          handle.setAttribute("cx", String(point.x));
          handle.setAttribute("cy", String(point.y));
          handle.setAttribute("r", "8");
          handle.setAttribute("fill", "var(--accent)");
          handle.setAttribute("stroke", "var(--doc-bg)");
          handle.style.cursor = "grab";
          handle.style.pointerEvents = "all";
          group.append(handle);
        }
      }
      this.#edgeLayer.append(group);
    }
  }

  #worldSize(): { w: number; h: number } {
    let w = 2000;
    let h = 2000;
    for (const node of this.#doc?.nodes ?? []) {
      w = Math.max(w, node.x + node.width + 400);
      h = Math.max(h, node.y + node.height + 400);
    }
    return { w, h };
  }

  #nodeEl(node: CanvasNode): HTMLElement {
    const el = document.createElement("article");
    el.className = `canvas-node canvas-node-${node.type}`;
    el.dataset.node = node.id;
    el.style.transform = `translate(${node.x}px, ${node.y}px)`;
    el.style.width = `${node.width}px`;
    el.style.height = `${node.height}px`;
    el.style.background = nodeFill(node.color);
    if (node.type === "group" && node.backgroundStyle) el.dataset.backgroundStyle = node.backgroundStyle;
    el.tabIndex = 0;
    el.setAttribute("role", "group");
    el.setAttribute("aria-label", `${node.type} ${node.id}`);
    if (this.#selection.includes(node.id)) el.classList.add("selected");
    const header = document.createElement("div");
    header.className = "canvas-node-handle";
    header.dataset.drag = node.id;
    const title = document.createElement("span");
    title.className = "canvas-node-title";
    title.textContent = nodeTitle(node);
    const connect = document.createElement("button");
    connect.type = "button";
    connect.className = "canvas-connect";
    connect.dataset.connect = node.id;
    connect.setAttribute("aria-label", t("canvas.connect", { id: node.id }));
    connect.textContent = "→";
    connect.addEventListener("click", (e) => e.stopPropagation());
    header.append(title, connect);
    el.append(header);
    el.append(this.#cardBody(node));
    if (!this.#readOnly) {
      const resize = document.createElement("div");
      resize.className = "canvas-resize";
      resize.dataset.resize = node.id;
      resize.setAttribute("aria-hidden", "true");
      el.append(resize);
    }
    el.addEventListener("focus", () => {
      if (!this.#selection.includes(node.id)) {
        this.#selection = [node.id];
        this.#edgeSelection = [];
        this.#options.onSelectionChange();
        this.#displaySelection();
      }
    });
    el.addEventListener("dblclick", (e) => {
      e.stopPropagation();
      this.#beginCardEdit(node);
    });
    return el;
  }
  #cardBody(node: CanvasNode): HTMLElement {
    const body = document.createElement("div");
    body.className = "canvas-card-body";
    switch (node.type) {
      case "text": {
        const text = node.text ?? "";
        const render = this.#options.renderMarkdownForCard;
        if (render) {
          const host = document.createElement("div");
          host.className = "canvas-markdown";
          const key = `${node.id}`;
          this.#markdownTeardowns.get(key)?.();
          this.#markdownTeardowns.delete(key);
          const teardown = render(node.id, text, host, this.#forms);
          if (typeof teardown === "function") this.#markdownTeardowns.set(key, teardown);
          body.append(host);
        } else {
          // Senza hook: testo non interattivo. Nessuno scanner locale: un
          // secondo parser linkificherebbe codice che il markdown esclude.
          body.textContent = text;
          if (!text) {
            body.classList.add("canvas-empty");
            body.textContent = t("canvas.empty_text");
          }
        }
        if (this.#options.onCreateNote && !this.#readOnly) {
          const convert = document.createElement("button");
          convert.type = "button";
          convert.className = "canvas-convert-note";
          convert.textContent = t("canvas.convert_note");
          convert.addEventListener("click", (event) => {
            event.stopPropagation();
            void this.#convertTextToNote(node).catch((error: unknown) => this.#showIntakeError(error));
          });
          body.append(convert);
        }
        break;
      }
      case "file": {
        const path = node.file ?? "";
        const extension = path.split(".").pop()?.toLowerCase();
        const kind = extension && ["png", "jpg", "jpeg", "gif", "webp", "svg", "avif"].includes(extension) ? "image"
          : extension && ["mp3", "wav", "ogg", "m4a", "flac"].includes(extension) ? "audio"
            : extension && ["mp4", "webm", "mov", "mkv"].includes(extension) ? "video"
              : extension === "pdf" ? "pdf" : "file";
        body.dataset.mediaKind = kind;
        if (kind !== "file") {
          const placeholder = document.createElement("span");
          placeholder.className = "canvas-media-placeholder";
          placeholder.textContent = `${kind.toUpperCase()} · ${path}`;
          body.append(placeholder);
        }
        const link = document.createElement("button");
        link.type = "button";
        link.className = "canvas-file-link internal-path";
        link.textContent = node.subpath ? `${path}${node.subpath}` : path;
        link.addEventListener("click", (e) => {
          e.stopPropagation();
          void this.#options.onOpenPath?.(`/${path.replace(/^\/+/, "")}${node.subpath ?? ""}`, this.#options.documentId);
        });
        body.append(link);
        break;
      }
      case "link": {
        // Anteprima inerte: mai iframe, mai fetch. Apertura via viewer isolato
        // o esterno attraverso la porta media iniettata.
        const url = node.url ?? "";
        const preview = document.createElement("span");
        preview.className = "canvas-url-text";
        preview.textContent = url;
        const open = document.createElement("button");
        open.type = "button";
        const media = this.#options.media;
        const destination = externalUrl(url);
        open.className = "canvas-open-url";
        open.textContent = t("canvas.open_url");
        open.disabled = destination === null || !media;
        open.addEventListener("click", (e) => {
          e.stopPropagation();
          if (!destination) return;
          if (media?.openViewer) void media.openViewer(destination);
          else if (media) void media.openExternal(destination);
        });
        body.append(preview, open);
        break;
      }
      case "group": {
        const label = document.createElement("div");
        label.className = "canvas-group-label";
        label.textContent = node.label || t("canvas.ungrouped");
        body.append(label);
        if (node.background) {
          const bg = document.createElement("span");
          bg.className = "canvas-group-bg";
          bg.textContent = node.background;
          body.append(bg);
        }
        break;
      }
    }
    return body;
  }

  #beginCardEdit(node: CanvasNode): void {
    if (this.#readOnly || !this.#doc) return;
    if (this.#finishEditing) {
      this.#finishEditing(true);
      this.#render();
    }
    const body = this.#stage.querySelector<HTMLElement>(`[data-node="${CSS.escape(node.id)}"] .canvas-card-body`);
    if (!body) return;
    const field = node.type === "text" ? "text" : node.type === "group" ? "label" : node.type === "link" ? "url" : "file";
    const initial = node[field];
    const input = node.type === "text" ? document.createElement("textarea") : document.createElement("input");
    input.className = node.type === "text" ? "canvas-text-editor" : "canvas-field-editor";
    input.value = initial ?? "";
    input.setAttribute("aria-label", t("canvas.edit_text", { id: node.id }));
    const lifetime = new AbortController();
    let finished = false;
    const applyValue = (value: string | undefined): void => {
      const current = this.#doc?.nodes.find((candidate) => candidate.id === node.id);
      if (!current || !this.#doc) return;
      const next = { ...current };
      if (value === undefined) delete next[field];
      else next[field] = value;
      const patch = upsertNodePatch(this.#doc, next);
      if (patch && this.#commitLocal([patch], "input", false, false)) this.#redo = [];
    };
    const finish = (save: boolean): void => {
      if (finished) return;
      finished = true;
      this.#finishEditing = null;
      lifetime.abort();
      if (!save) {
        applyValue(initial);
      } else {
        const current = this.#doc?.nodes.find((candidate) => candidate.id === node.id);
        if (current && this.#doc) {
          const before = { ...current };
          if (initial === undefined) delete before[field];
          else before[field] = initial;
          const inverse = upsertNodePatch(this.#doc, before);
          if (inverse) {
            this.#undo.push(inverseCanvasPatches([inverse]));
            if (this.#undo.length > MAX_CANVAS_HISTORY) this.#undo.shift();
          }
        }
      }
      input.disabled = true;
    };
    this.#finishEditing = finish;
    // L'input entra subito nella sessione condivisa, non soltanto al blur.
    // Il DOM del campo resta vivo; la history Canvas raggruppa l'intera edit.
    input.addEventListener("input", () => applyValue(input.value), { signal: lifetime.signal });
    input.addEventListener("keydown", (event) => {
      if (!(event instanceof KeyboardEvent)) return;
      event.stopPropagation();
      if (event.key === "Escape" || (event.key === "Enter" && (node.type !== "text" || event.ctrlKey || event.metaKey))) {
        event.preventDefault();
        finish(event.key !== "Escape");
        this.#render();
        this.#viewport.focus();
      }
    }, { signal: lifetime.signal });
    input.addEventListener("blur", () => {
      finish(true);
      this.#render();
    }, { signal: lifetime.signal });
    body.replaceChildren(input);
    input.focus();
    if (node.type === "text") input.setSelectionRange(input.value.length, input.value.length);
    else input.select();
  }
}

function nodeTitle(node: CanvasNode): string {
  switch (node.type) {
    case "text":
      return (node.text ?? "").split("\n", 1)[0]?.slice(0, 48) || node.id;
    case "file":
      return node.file ?? node.id;
    case "link":
      return node.url ?? node.id;
    case "group":
      return node.label || node.id;
  }
}

function edgePoint(
  node: CanvasNode,
  side: "top" | "right" | "bottom" | "left",
  _from: boolean,
): { x: number; y: number } {
  switch (side) {
    case "top":
      return { x: node.x + node.width / 2, y: node.y };
    case "bottom":
      return { x: node.x + node.width / 2, y: node.y + node.height };
    case "left":
      return { x: node.x, y: node.y + node.height / 2 };
    case "right":
      return { x: node.x + node.width, y: node.y + node.height / 2 };
  }
}

function nodeText(node: CanvasNode): string {
  switch (node.type) {
    case "text": return node.text ?? "";
    case "file": return node.subpath ? `${node.file ?? ""}${node.subpath}` : node.file ?? "";
    case "link": return node.url ?? "";
    default: return node.label ?? "";
  }
}
