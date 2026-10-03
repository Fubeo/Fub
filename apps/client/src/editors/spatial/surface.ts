// La superficie del disegno: il profilo `vector` della famiglia `canvas`
// (ADR 0203). Monta l'editor degli strumenti su un file .svg di FubDraw e lo
// tiene allineato alla `DocumentSession` come ogni superficie col buffer: un
// gesto esce come `{ text, operation, origin }`, e un testo che arriva da
// fuori ricostruisce la scena senza perdere annulla e ripeti.
//
// Due modalità, Disegno (`draw`, col ruolo `live_preview`) e Lettura (`read`,
// `reading`). In Lettura il documento intero è un `<img>` da un blob, e niente
// del file entra nel DOM vivo.
//
// In Disegno il documento può non essere modificabile, e la modalità del
// riquadro non cambia per questo (`docs/product/drawing.md`):
// - un SVG estraneo è l'immagine inerte del documento intero, con «Modifica»,
//   che applica `adopt` nell'editor: l'editor c'è già, nascosto, così
//   l'adozione è un passo di annulla, e annullarla riporta all'immagine;
// - un documento in sola lettura (un DOCTYPE, una versione futura, un file
//   troppo grande) è l'immagine inerte del documento intero, col motivo;
// - un file che non si legge come scena è il motivo e basta: il testo lo
//   mostra «Apri come sorgente».

import { onLanguage, resolvedLanguage, t, type Key } from "../../i18n/strings";
import { openLifetime, type Lifetime } from "../../ui/lifetime";
import type { EditorRange, EditorSelections, EditorSurface, SelectedText, SurfaceMountContext } from "../core/registry";
import type { EditorChange } from "../core/text-operation";
import { imageInfo, svgSize } from "../media/image-view";
import { mountZoomView, type ZoomView } from "../media/zoom-view";
import { VECTOR_MODES, VECTOR_PROFILE } from "./modes";
import type { ElementItem } from "./scene/classify";
import { SceneEngine } from "./scene/engine";
import { MAX_EDIT_BYTES, MAX_ELEMENTS, ReadError, type ReadOnly } from "./scene/read";
import { createDrawEditor, type DrawEditor } from "./tools/editor";

type VectorMode = "draw" | "read";

export interface VectorSurfaceOptions {
  onChange(change: EditorChange): void;
  onSelectionChange(): void;
}

/// Come si apre un testo: una scena da modificare (anche estranea), un
/// documento da guardare soltanto, o un file che non è una scena.
export type Opened =
  | { readonly kind: "scene"; readonly engine: SceneEngine }
  | { readonly kind: "inert"; readonly engine: SceneEngine }
  | { readonly kind: "unreadable"; readonly error: ReadError };

export function open(text: string): Opened {
  try {
    const engine = SceneEngine.open(text);
    return engine.model === null ? { kind: "inert", engine } : { kind: "scene", engine };
  } catch (error) {
    if (error instanceof ReadError) return { kind: "unreadable", error };
    throw error;
  }
}

const READ_ONLY: Readonly<Record<ReadOnly, Key>> = {
  doctype: "vector.read_only.doctype",
  encoding: "vector.read_only.encoding",
  "invalid-version": "vector.read_only.invalid_version",
  "future-version": "vector.read_only.future_version",
  "duplicate-id": "vector.read_only.duplicate_id",
  "too-large": "vector.read_only.too_large",
  "too-many-elements": "vector.read_only.too_many_elements",
};

/// Perché il documento si guarda soltanto, a parole: il primo motivo, che la
/// scena elenca in un ordine fisso.
export function readOnlyText(reason: ReadOnly): string {
  const numbers = new Intl.NumberFormat(resolvedLanguage());
  if (reason === "too-large") return t(READ_ONLY[reason], { limit: `${numbers.format(MAX_EDIT_BYTES / (1024 * 1024))} MiB` });
  if (reason === "too-many-elements") return t(READ_ONLY[reason], { limit: numbers.format(MAX_ELEMENTS) });
  return t(READ_ONLY[reason]);
}

export function unreadableText(error: ReadError): string {
  const reason = error.kind === "malformed"
    ? t("vector.unreadable.malformed", { offset: new Intl.NumberFormat(resolvedLanguage()).format(error.offset) })
    : t("vector.unreadable.not_svg");
  return t("vector.unreadable", { reason, command: t("commands.doc.source.open") });
}

/// La chiave con cui l'editor sceglie un oggetto: l'id, o `@` e il percorso.
export function keyOf(item: ElementItem): string {
  return item.id ?? `@${item.path.join(".")}`;
}

export function fileName(id: string): string {
  return id.split("/").pop() || id;
}

export function mountVectorSurface(context: SurfaceMountContext, options: VectorSurfaceOptions): EditorSurface {
  const life = openLifetime();
  const root = document.createElement("div");
  root.className = "vector-surface";
  const notice = document.createElement("div");
  notice.className = "vector-notice";
  // Cortese: dice com'è il documento appena aperto, non è un allarme.
  notice.setAttribute("role", "status");
  const noticeText = document.createElement("p");
  noticeText.className = "vector-notice-text";
  const adoptButton = document.createElement("button");
  adoptButton.type = "button";
  adoptButton.className = "primary vector-notice-action";
  notice.append(noticeText, adoptButton);
  const drawHost = document.createElement("div");
  drawHost.className = "vector-draw";
  const readHost = document.createElement("div");
  readHost.className = "vector-read";
  root.append(notice, drawHost, readHost);
  context.parent.append(root);

  let mode: VectorMode = "draw";
  let readOnly = false;
  /// Il testo grezzo del documento, coi terminatori del file.
  let text = "";
  let opened: Opened | null = null;
  let editor: DrawEditor | null = null;
  let editorLife: Lifetime | null = null;
  let view: ZoomView | null = null;
  let shownUrl: string | null = null;
  /// Il testo che l'immagine mostra: non si ridisegna uguale.
  let shownText: string | null = null;
  /// I byte del testo, per le selezioni: si ricavano una volta per testo.
  let encoded: { readonly text: string; readonly bytes: Uint8Array } | null = null;

  // --- L'editor -------------------------------------------------------------

  const mountEditor = (engine: SceneEngine): DrawEditor => {
    const owner = openLifetime();
    const mounted = createDrawEditor(drawHost, engine, owner, {
      onChange: (change) => {
        text = change.text;
        opened = { kind: "scene", engine: mounted.engine };
        options.onChange(change);
        paint();
      },
      onSelectionChange: () => options.onSelectionChange(),
    });
    mounted.setReadOnly(readOnly);
    editorLife = owner;
    editor = mounted;
    return mounted;
  };

  const unmountEditor = (): void => {
    const had = editor !== null && editor.selection.length > 0;
    editorLife?.close();
    editorLife = null;
    editor = null;
    if (had) options.onSelectionChange();
  };

  /// Mostra `next`: in un editor che c'è già la scena si ricostruisce, e con
  /// `fresh` il documento è un altro e la cronologia riparte.
  const show = (next: Opened, fresh: boolean): void => {
    opened = next;
    if (next.kind === "scene") {
      if (editor === null) mountEditor(next.engine);
      else if (fresh) editor.load(next.engine);
      else editor.setEngine(next.engine);
    } else {
      unmountEditor();
    }
    paint();
  };

  // --- L'immagine -----------------------------------------------------------

  /// Il nome del disegno: il titolo del documento, figlio della radice, o il
  /// nome del file.
  const drawingName = (): string => {
    const engine = opened !== null && opened.kind !== "unreadable" ? opened.engine : null;
    for (const item of engine?.scene() ?? []) {
      if (item.kind === "element" && item.role === "title" && item.path.length === 1 && item.text?.trim()) return item.text.trim();
    }
    return fileName(context.documentId);
  };

  const showImage = (): void => {
    const label = t("vector.read.label", { name: drawingName() });
    if (shownText === text && view !== null) {
      view.stage.setAttribute("aria-label", label);
      view.image.alt = label;
      return;
    }
    const blob = new Blob([text], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);
    const size = svgSize(text);
    const info = imageInfo({ format: "SVG", blob }, size?.width ?? null, size?.height ?? null);
    const previous = shownUrl;
    shownUrl = url;
    shownText = text;
    if (view === null) {
      // La carta è bianca anche dove il disegno non ne ha una.
      view = mountZoomView(url, { label, size, backdrop: "light", vector: true, info }, life);
      readHost.append(view.element);
    } else {
      view.replace(url, size);
      view.info(info);
      view.stage.setAttribute("aria-label", label);
      view.image.alt = label;
    }
    if (previous !== null) URL.revokeObjectURL(previous);
  };

  // --- Lo stato a vista -----------------------------------------------------

  /// Il fuoco nella parte che si vede: il foglio, «Modifica», o l'immagine.
  const focusShown = (): void => {
    if (!drawHost.hidden && editor !== null) editor.focus();
    else if (!notice.hidden && !adoptButton.hidden) adoptButton.focus();
    else if (!readHost.hidden && view !== null) view.stage.focus({ preventScroll: true });
  };

  /// Porta la superficie a modalità, documento e scrittura di adesso.
  const paint = (): void => {
    root.dataset.mode = mode;
    const state = opened;
    const foreign = state?.kind === "scene" && state.engine.status === "foreign";
    let message: string | null = null;
    let canAdopt = false;
    if (state?.kind === "unreadable") {
      message = unreadableText(state.error);
    } else if (mode === "draw" && state?.kind === "inert") {
      message = t("vector.read_only", { reason: readOnlyText(state.engine.readOnly[0]!), command: t("commands.doc.source.open") });
    } else if (mode === "draw" && foreign) {
      message = t("vector.foreign");
      canAdopt = !readOnly;
    }
    // Chi annulla l'adozione dal foglio non resta col fuoco su un nodo
    // nascosto: passa a «Modifica».
    const hadFocus = drawHost.contains(document.activeElement);
    if (noticeText.textContent !== (message ?? "")) noticeText.textContent = message ?? "";
    notice.hidden = message === null;
    adoptButton.textContent = t("vector.foreign.edit");
    adoptButton.hidden = !canAdopt;
    drawHost.hidden = !(mode === "draw" && state?.kind === "scene" && !foreign);
    const image = state !== null && state.kind !== "unreadable" && (mode === "read" || state.kind === "inert" || foreign);
    readHost.hidden = !image;
    if (image) showImage();
    if (hadFocus && drawHost.hidden) focusShown();
  };

  life.listen(adoptButton, "click", () => {
    if (editor?.adopt()) editor.focus();
  });
  life.add(onLanguage(paint));

  // --- Le selezioni ---------------------------------------------------------

  /// Gli elementi degli oggetti scelti, in ordine di documento.
  const selectedItems = (): ElementItem[] => {
    if (drawHost.hidden || editor === null || editor.selection.length === 0) return [];
    const keys = new Set(editor.selection);
    return editor.engine.scene().filter((item): item is ElementItem => item.kind === "element" && keys.has(keyOf(item)));
  };

  const rangeOf = (item: ElementItem): EditorRange => {
    if (encoded === null || encoded.text !== text) encoded = { text, bytes: new TextEncoder().encode(text) };
    const [start, end] = item.bytes;
    return { start, end, text: new TextDecoder().decode(encoded.bytes.subarray(start, end)) };
  };

  life.add(() => {
    unmountEditor();
    if (shownUrl !== null) URL.revokeObjectURL(shownUrl);
    shownUrl = null;
    root.remove();
  });

  paint();

  return {
    family: "canvas",
    profile: VECTOR_PROFILE,
    surfaceId: context.paneId,
    modes: VECTOR_MODES,
    defaultMode: "draw",
    setMode(next) {
      if (next !== "draw" && next !== "read") throw new RangeError(`surface mode ${next} is not supported`);
      if (next === mode) return;
      mode = next;
      paint();
      options.onSelectionChange();
    },
    buffer: {
      setDoc: (next) => {
        text = next;
        show(open(next), true);
      },
      syncDoc: (update) => {
        const next = typeof update === "string" ? update : update.text;
        if (next === text) return;
        text = next;
        show(open(next), false);
      },
      getDoc: () => text,
    },
    focus: focusShown,
    reveal: ({ span }) => !drawHost.hidden && editor !== null && editor.reveal(span.start),
    selections: (): EditorSelections | undefined => {
      const items = selectedItems();
      if (items.length === 0) return undefined;
      const [first, ...rest] = items.map(rangeOf);
      return { primary: first!, secondary: rest };
    },
    selectedText: (): SelectedText | null => {
      const items = selectedItems();
      if (items.length === 0) return null;
      const [first, ...rest] = items.map((item) => rangeOf(item).text);
      return { primary: first!, secondary: rest };
    },
    setReadOnly: (next) => {
      readOnly = next;
      editor?.setReadOnly(next);
      paint();
    },
    destroy: () => life.close(),
  };
}
