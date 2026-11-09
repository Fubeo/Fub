// Le superfici del disegno e delle annotazioni caricate quando servono. Il
// codice dell'editor e della scena è grande quanto la shell, e chi non apre un
// disegno non deve scaricarlo: la shell monta subito questo involucro, che ha gli stessi modi e
// lo stesso contratto, e la superficie vera arriva con un `import()`.
//
// Finché non arriva l'involucro tiene ciò che la shell gli dice — il testo, la
// modalità, la sola lettura, il fuoco, un rimando — e lo consegna alla
// superficie appena montata, nello stesso ordine in cui la shell l'avrebbe
// detto a lei. Se il caricamento fallisce il riquadro lo dice, e il testo resta
// della sessione: «Apri come sorgente» lo mostra comunque.

import { errorText } from "../../host/errors";
import { t } from "../../i18n/strings";
import { notify } from "../../ui/notify";
import type { EditorSelections, EditorSurface, SelectedText, SurfaceLocation, SurfaceMountContext } from "../core/registry";
import type { SurfaceExport, SurfaceMode } from "../core/registry";
import { PDF_EXPORTS, PDF_MODES, PDF_PROFILE, VECTOR_EXPORTS, VECTOR_MODES, VECTOR_PROFILE } from "./modes";
import type { PdfSurfaceOptions } from "./pdf/surface";
import type { VectorSurfaceOptions } from "./surface";
import type { EditorChange } from "../core/text-operation";
import type { DrawingImagePort } from "../canvas/surface";
import type { VaultFontPort } from "./fonts/vault";
import type { PdfPorts } from "./pdf/surface";

type SurfaceModule = typeof import("./surface");
type PdfSurfaceModule = typeof import("./pdf/surface");

/// Il nome con cui la shell chiama il documento negli avvisi: il file senza
/// estensione.
function docTitle(id: string): string {
  const base = id.split("/").pop() || id;
  const point = base.lastIndexOf(".");
  return point > 0 ? base.slice(0, point) : base;
}

/// Ciò che la shell dà a un disegno o alle annotazioni di un PDF.
export interface DrawingSurfaceCallbacks {
  readonly onChange: (paneId: string, change: EditorChange) => void;
  readonly onSelectionChange: (paneId: string) => void;
  readonly onOpenPath?: (path: string, from?: string) => void | Promise<void>;
  /** The vault document a drawing's link goes to, chosen by the user: `from` is the drawing, `current` the `href` of the link being changed. */
  readonly onPickDrawingLink?: (from: string, current: string | null) => Promise<string | null>;
  /** The vault images of drawing `from`, resolved by the shell. */
  readonly drawingImages?: DrawingImagePort;
  /** The vault's font files, listed and read by the shell, that a drawing's text can use. */
  readonly drawingFonts?: VaultFontPort;
  /** Where annotations read their PDF: without it the pages are blank. */
  readonly pdf?: PdfPorts;
  /** Runs a shell command, like the export window a drawing's «Export» opens. */
  readonly shellCommand?: (id: string) => void;
}

/// La superficie di un disegno (`vector`) o delle annotazioni di un PDF
/// (`pdf`) della famiglia `canvas`. La registra la shell da sé, senza la
/// lavagna: i disegni sono un componente (`fub.draw`), la lavagna un altro.
export function mountDrawingSurface(
  profile: string,
  context: SurfaceMountContext,
  callbacks: DrawingSurfaceCallbacks,
): EditorSurface {
  if (profile === VECTOR_PROFILE) {
    // I collegamenti di un disegno sono percorsi relativi al disegno: la shell
    // li risolve da lì, come quelli di una nota.
    const openPath = callbacks.onOpenPath;
    const pickLink = callbacks.onPickDrawingLink;
    const shellCommand = callbacks.shellCommand;
    const images = callbacks.drawingImages;
    const pickImage = images?.pick;
    return mountVectorSurfaceLazily(context, {
      onChange: (change) => callbacks.onChange(context.paneId, change),
      onSelectionChange: () => callbacks.onSelectionChange(context.paneId),
      onOpenPath: openPath === undefined ? undefined : async (path) => {
        await openPath(path, context.documentId);
      },
      onPickLink: pickLink === undefined ? undefined : (current) => pickLink(context.documentId, current),
      // Le immagini, come i collegamenti, si risolvono dal disegno.
      images: images === undefined ? undefined : {
        url: (path, life) => images.url(path, context.documentId, life),
        read: (path, limit) => images.read(path, context.documentId, limit),
        pick: pickImage === undefined ? undefined : () => pickImage(context.documentId),
      },
      vaultFonts: callbacks.drawingFonts,
      // «Esporta» apre la finestra dello Scrittoio.
      onExport: shellCommand === undefined ? undefined : () => shellCommand("shell.doc.export"),
    });
  }
  if (profile === PDF_PROFILE) {
    return mountPdfSurfaceLazily(context, {
      onChange: (change) => callbacks.onChange(context.paneId, change),
      onSelectionChange: () => callbacks.onSelectionChange(context.paneId),
      pdf: callbacks.pdf,
    });
  }
  throw new Error(`drawing surface profile ${profile} is not registered`);
}

export function mountVectorSurfaceLazily(
  context: SurfaceMountContext,
  options: VectorSurfaceOptions,
  load: () => Promise<SurfaceModule> = () => import("./surface"),
): EditorSurface {
  return lazily(context, VECTOR_PROFILE, VECTOR_MODES, VECTOR_EXPORTS, async () => {
    const module = await load();
    return () => module.mountVectorSurface(context, options);
  });
}

export function mountPdfSurfaceLazily(
  context: SurfaceMountContext,
  options: PdfSurfaceOptions,
  load: () => Promise<PdfSurfaceModule> = () => import("./pdf/surface"),
): EditorSurface {
  return lazily(context, PDF_PROFILE, PDF_MODES, PDF_EXPORTS, async () => {
    const module = await load();
    return () => module.mountPdfSurface(context, options);
  });
}

/// L'involucro di una superficie del profilo `profile`: `load` dà la
/// funzione che la monta. I modi e gli export sono quelli del profilo, e ci
/// sono già prima che la superficie arrivi.
function lazily(
  context: SurfaceMountContext,
  profile: string,
  modes: readonly SurfaceMode[],
  exports: readonly SurfaceExport[],
  load: () => Promise<() => EditorSurface>,
): EditorSurface {
  const pending = document.createElement("div");
  pending.className = "vector-pending";
  // Raggiungibile col fuoco come il resto del riquadro, anche prima.
  pending.tabIndex = -1;
  pending.setAttribute("aria-busy", "true");
  const notice = document.createElement("div");
  notice.className = "vector-notice";
  notice.hidden = true;
  const noticeText = document.createElement("p");
  noticeText.className = "vector-notice-text";
  notice.append(noticeText);
  pending.append(notice);
  context.parent.append(pending);

  let surface: EditorSurface | null = null;
  let destroyed = false;
  let text: string | null = null;
  let mode = "draw";
  let readOnly = false;
  let reveal: SurfaceLocation | null = null;
  /// Chi segue le schede dell'ispettore: le tiene l'involucro, e passano alla
  /// superficie quando arriva.
  const panelListeners = new Set<() => void>();
  const panelReveals = new Set<(id: string) => void>();
  /// Chi segue la banda di stato, allo stesso modo.
  const statusListeners = new Set<() => void>();
  let stopPanels: (() => void) | null = null;

  const settle = (mount: () => EditorSurface): void => {
    if (destroyed) return;
    const focused = pending.contains(document.activeElement);
    pending.remove();
    const mounted = mount();
    surface = mounted;
    const unsubscribeList = mounted.panels?.subscribe(() => {
      for (const listener of [...panelListeners]) listener();
    });
    const offShow = mounted.panels?.onShow((id) => {
      for (const listener of [...panelReveals]) listener(id);
    });
    const unsubscribeStatus = mounted.status?.subscribe(() => {
      for (const listener of [...statusListeners]) listener();
    });
    stopPanels = () => {
      unsubscribeList?.();
      offShow?.();
      unsubscribeStatus?.();
    };
    if (text !== null) mounted.buffer?.setDoc(text);
    if (mode !== "draw") mounted.setMode(mode);
    if (readOnly) mounted.setReadOnly?.(true);
    if (focused) mounted.focus?.();
    for (const listener of [...panelListeners]) listener();
    for (const listener of [...statusListeners]) listener();
    if (reveal !== null && !mounted.reveal?.(reveal)) {
      // La shell ha già avuto il suo sì: il no lo dice la superficie, con le
      // stesse parole.
      notify(t("document.reveal_unavailable", { doc: docTitle(context.documentId) }), "info");
    }
    reveal = null;
  };

  const fail = (error: unknown): void => {
    if (destroyed) return;
    pending.removeAttribute("aria-busy");
    noticeText.textContent = t("vector.unavailable", { reason: errorText(error), command: t("commands.doc.source.open") });
    notice.hidden = false;
    notify(errorText(error), "guasto");
  };

  void load().then(settle).catch(fail);

  return {
    family: "canvas",
    profile,
    surfaceId: context.paneId,
    modes,
    defaultMode: "draw",
    exports,
    // La finestra «Esporta» della superficie, quando c'è: prima che arrivi
    // non si apre, e «Esporta…» offre la scelta fra gli export.
    exportWindow: {
      available: () => surface?.exportWindow?.available() ?? false,
      open: () => surface?.exportWindow?.open() ?? Promise.resolve(null),
    },
    setMode(next) {
      if (surface !== null) return surface.setMode(next);
      if (!modes.some((known) => known.id === next)) throw new RangeError(`surface mode ${next} is not supported`);
      mode = next;
    },
    buffer: {
      setDoc: (next) => {
        if (surface !== null) return surface.buffer?.setDoc(next);
        text = next;
      },
      syncDoc: (update) => {
        if (surface !== null) return surface.buffer?.syncDoc(update);
        text = typeof update === "string" ? update : update.text;
      },
      getDoc: () => surface?.buffer?.getDoc() ?? text ?? "",
    },
    focus: () => {
      if (surface !== null) surface.focus?.();
      else pending.focus({ preventScroll: true });
    },
    reveal: (location) => {
      if (surface !== null) return surface.reveal?.(location) ?? false;
      reveal = location;
      return true;
    },
    // Le schede della superficie, quando c'è: nessuna prima.
    panels: {
      list: () => surface?.panels?.list() ?? [],
      subscribe(listener) {
        panelListeners.add(listener);
        return () => panelListeners.delete(listener);
      },
      onShow(listener) {
        panelReveals.add(listener);
        return () => panelReveals.delete(listener);
      },
      get covers() {
        return surface?.panels?.covers;
      },
    },
    // La banda di stato della superficie, quando c'è: prima, niente.
    status: {
      get counts() {
        return surface?.status?.counts ?? false;
      },
      items: () => surface?.status?.items() ?? [],
      subscribe(listener) {
        statusListeners.add(listener);
        return () => statusListeners.delete(listener);
      },
    },
    selections: (): EditorSelections | undefined => surface?.selections?.(),
    selectedText: (): SelectedText | null => surface?.selectedText?.() ?? null,
    setReadOnly: (next) => {
      if (surface !== null) surface.setReadOnly?.(next);
      else readOnly = next;
    },
    destroy: () => {
      if (destroyed) return;
      destroyed = true;
      stopPanels?.();
      stopPanels = null;
      panelListeners.clear();
      panelReveals.clear();
      statusListeners.clear();
      surface?.destroy();
      surface = null;
      pending.remove();
    },
  };
}
