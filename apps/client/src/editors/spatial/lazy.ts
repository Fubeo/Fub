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

type SurfaceModule = typeof import("./surface");
type PdfSurfaceModule = typeof import("./pdf/surface");

/// Il nome con cui la shell chiama il documento negli avvisi: il file senza
/// estensione.
function docTitle(id: string): string {
  const base = id.split("/").pop() || id;
  const point = base.lastIndexOf(".");
  return point > 0 ? base.slice(0, point) : base;
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

  const settle = (mount: () => EditorSurface): void => {
    if (destroyed) return;
    const focused = pending.contains(document.activeElement);
    pending.remove();
    const mounted = mount();
    surface = mounted;
    if (text !== null) mounted.buffer?.setDoc(text);
    if (mode !== "draw") mounted.setMode(mode);
    if (readOnly) mounted.setReadOnly?.(true);
    if (focused) mounted.focus?.();
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
    selections: (): EditorSelections | undefined => surface?.selections?.(),
    selectedText: (): SelectedText | null => surface?.selectedText?.() ?? null,
    setReadOnly: (next) => {
      if (surface !== null) surface.setReadOnly?.(next);
      else readOnly = next;
    },
    destroy: () => {
      if (destroyed) return;
      destroyed = true;
      surface?.destroy();
      surface = null;
      pending.remove();
    },
  };
}
