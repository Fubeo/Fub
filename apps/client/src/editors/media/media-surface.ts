// La superficie media: una EditorSurface vera per immagini/audio/video/PDF.
//
// Si monta dal registro (famiglia `viewer`, vedi integrazione a Main): il
// documento che arriva qui e' l'id di un allegato, non testo. Legge il
// descrittore e i byte dalla porta, monta la view giusta, rilascia tutto al
// teardown (handle chiuso, blob revocati, listener staccati). La sorgente
// binaria non passa dal buffer di testo; la modalita' slide spetta al reso.
import type { EditorSurface, SurfaceMode, SurfaceMountContext, SurfacePoint } from "../core/registry";
import type { SurfaceMenu, SurfaceMenuItem } from "../core/editor-menu";
import { pngOf } from "../core/png";
import { clipboardSupports, writeClipboardData } from "../../platform/clipboard";
import { notify } from "../../ui/notify";
import type { Lifetime } from "../../ui/lifetime";
import { openLifetime } from "../../ui/lifetime";
import { onLanguage, t, type Key } from "../../i18n/strings";
import { MEDIA_MAX_INLINE_BYTES, mediaKindOfId, type MediaKind, type ResourceDescriptor } from "./media-types";
import { openResourcePort, type ResourcePort, type ResourceTransport } from "./resource-port";
import { decodeImage, mountImageView, type ImageView } from "./image-view";
import { ZOOM_STEP } from "./zoom-view";
import { mountAudioView, mountVideoView } from "./player-view";
import { mountPdfView, pdfIdWithoutFragment, pdfPageFromFragment, type PdfEngineLoader, type PdfView } from "./pdf-view";

export interface MediaSurfaceDeps {
  transport: ResourceTransport;
  /// L'URL `fub-asset:` con cui audio e video oltre il tetto si leggono in
  /// streaming: la forma dipende dalla piattaforma e la sa l'host.
  assetUrl: (handle: string) => string;
  pdfLoader?: PdfEngineLoader;
  openExternal?: (id: string) => void | Promise<void>;
  copyText?: (text: string) => Promise<void>;
  /// «Annota» sul PDF: crea o apre le sue annotazioni. `available` dice se il
  /// kernel ha il comando, cioè se il vault serve le annotazioni.
  annotate?: { available(): boolean; run(pdf: string): Promise<void> };
}

const MEDIA_MODES: SurfaceMode[] = [
  { id: "view", label: () => t("mode.reading"), presentation: "surface", contextMode: "reading", looks: ["file"] },
];

/** La view per una specie: kind -> profilo montato. `other` e' il fallback. */
export function profileForKind(kind: MediaKind): string {
  switch (kind) {
    case "image":
      return "media-image";
    case "audio":
      return "media-audio";
    case "video":
      return "media-video";
    case "pdf":
      return "media-pdf";
    default:
      return "bytes-read-only";
  }
}

/**
 * Monta la superficie media dentro `context.parent`. Legge descrittore e byte
 * dalla porta; in errore mostra specie, dimensione quando nota, e ragione —
 * mai un riquadro vuoto e mai un viewer del browser.
 */
export function mountMediaSurface(
  profile: string,
  context: SurfaceMountContext,
  deps: MediaSurfaceDeps,
): EditorSurface {
  const life = openLifetime();
  const root = document.createElement("div");
  root.className = `document-surface document-surface-viewer media-surface media-${profile}`;
  root.tabIndex = 0;
  root.setAttribute("role", "document");
  context.parent.replaceChildren(root);

  const status = document.createElement("p");
  status.setAttribute("role", "status");
  root.append(status);
  let active = true;
  let pendingPort: ResourcePort | null = null;
  // La view montata, per il menu del tasto destro.
  let mounted: Mounted = null;

  function message(key: Key): void {
    if (!active) return;
    status.textContent = t(key);
  }
  life.add(onLanguage(() => message("viewer.unavailable")));

  async function load(): Promise<void> {
    const bareId = pdfIdWithoutFragment(context.documentId);
    const kind: MediaKind = mediaKindOfId(bareId);
    const expected = profileForKind(kind);
    if (profile !== expected && profile !== "bytes-read-only") {
      message("viewer.unavailable");
      return;
    }
    let port: ResourcePort | null = null;
    try {
      status.textContent = t("viewer.unavailable");
      port = await openResourcePort(deps.transport, bareId);
      pendingPort = port;
      if (!active) return;
      const descriptor = port.descriptor;
      if ((kind === "audio" || kind === "video") && descriptor.len > MEDIA_MAX_INLINE_BYTES) {
        const view = kind === "audio"
          ? mountAudioView(descriptor, deps.assetUrl(descriptor.handle), life, deps.openExternal ? () => deps.openExternal!(descriptor.id) : undefined)
          : mountVideoView(descriptor, deps.assetUrl(descriptor.handle), life, deps.openExternal ? () => deps.openExternal!(descriptor.id) : undefined);
        root.append(view.element);
        mounted = { kind, element: view.element };
        const streamPort = port;
        life.add(() => void streamPort.close().catch(() => {}));
        pendingPort = null;
        port = null;
      } else {
        const bytes = await port.readAll();
        if (!active) return;
        mounted = await mountBytes(descriptor, bytes, life, deps, root, context.documentId);
      }
      status.remove();
    } catch (error) {
      if (!active) return;
      status.textContent = error instanceof Error ? error.message : t("viewer.unavailable");
    } finally {
      if (pendingPort === port) pendingPort = null;
      await port?.close().catch(() => {});
    }
  }

  void load().catch(() => {});

  return {
    family: "viewer",
    profile,
    surfaceId: context.paneId,
    modes: MEDIA_MODES,
    setMode(next: string) {
      if (next !== "view") throw new Error(`unknown media mode ${next}`);
      root.dataset.mode = next;
    },
    focus() {
      root.focus();
    },
    contextMenu: (at) => mediaMenu(mounted, at, pdfIdWithoutFragment(context.documentId), deps),
    setTheme(theme) {
      root.dataset.theme = theme;
    },
    destroy() {
      if (!active) return;
      active = false;
      void pendingPort?.close().catch(() => {});
      life.close();
      root.remove();
    },
  };
}

async function mountBytes(
  descriptor: ResourceDescriptor,
  bytes: Uint8Array,
  life: Lifetime,
  deps: MediaSurfaceDeps,
  root: HTMLElement,
  documentId: string,
): Promise<Mounted> {
  const kind: MediaKind = mediaKindOfId(descriptor.id);
  const openExternal = deps.openExternal ? () => deps.openExternal!(descriptor.id) : undefined;
  switch (kind) {
    case "image": {
      const image = decodeImage(descriptor, bytes);
      const view = mountImageView(image, descriptor.id, life);
      root.append(view.element);
      return { kind, element: view.element, image: view };
    }
    case "audio": {
      const view = mountAudioView(descriptor, bytes, life, openExternal);
      root.append(view.element);
      return { kind, element: view.element };
    }
    case "video": {
      const view = mountVideoView(descriptor, bytes, life, openExternal);
      root.append(view.element);
      return { kind, element: view.element };
    }
    case "pdf": {
      const page = pdfPageFromFragment(documentId);
      const view = mountPdfView(
        descriptor,
        bytes,
        {
          loader: deps.pdfLoader,
          initialPage: page,
          onOpenExternal: openExternal,
          onCopyLink:
            deps.copyText == null
              ? undefined
              : (n: number) => deps.copyText!(`${pdfIdWithoutFragment(documentId)}#page=${n}`),
          onAnnotate: deps.annotate?.available() ? () => deps.annotate!.run(pdfIdWithoutFragment(documentId)) : undefined,
        },
        life,
      );
      root.append(view.element);
      return { kind, element: view.element, pdf: view };
    }
    default: {
      const box = document.createElement("div");
      box.className = "media-error";
      box.setAttribute("role", "alert");
      const title = document.createElement("p");
      title.textContent = `${descriptor.id} (${descriptor.mime})`;
      const reason = document.createElement("p");
      reason.textContent = t("viewer.unavailable");
      box.append(title, reason);
      root.append(box);
      return null;
    }
  }
}

/// Ciò che la superficie ha montato: la specie e, per immagini e PDF, la view
/// con cui il menu agisce.
type Mounted = {
  readonly kind: MediaKind;
  readonly element: HTMLElement;
  readonly image?: ImageView;
  readonly pdf?: PdfView;
} | null;

/// Il menu del tasto destro sul file mostrato. Sul lettore di audio e video
/// resta quello del sistema, che ha già velocità e ripetizione.
function mediaMenu(mounted: Mounted, at: SurfacePoint | null, id: string, deps: MediaSurfaceDeps): SurfaceMenu | null {
  if (!mounted) return null;
  const under = at ? document.elementFromPoint(at.x, at.y) : null;
  if (under instanceof HTMLMediaElement) return null;
  const copy = (text: string): void => {
    if (!deps.copyText) return;
    void deps.copyText(text).then(() => notify(t("editor_menu.copied"), "info"), () => notify(t("editor_menu.copy_failed"), "guasto"));
  };
  const context: SurfaceMenuItem[] = [];
  if (mounted.image) {
    const zoom = mounted.image.zoom;
    context.push(
      {
        id: "media.image.copy",
        label: t("preview.image.copy"),
        enabled: clipboardSupports("image/png"),
        run: () => {
          // La promessa dei byte entra subito negli appunti, dentro il gesto.
          const png = pngOf(zoom.image);
          png.catch(() => undefined);
          void writeClipboardData({ "image/png": png }).then(
            () => notify(t("preview.image.copied"), "info"),
            () => notify(t("preview.image.copy_failed"), "guasto"),
          );
        },
      },
      {
        id: "media.zoom",
        label: t("zoom.toolbar"),
        items: [
          { id: "media.zoom.fit", label: t("zoom.fit_hint"), run: () => zoom.fit() },
          { id: "media.zoom.actual", label: t("zoom.actual"), run: () => zoom.actual() },
          { id: "media.zoom.in", label: t("zoom.in"), run: () => zoom.zoom(ZOOM_STEP) },
          { id: "media.zoom.out", label: t("zoom.out"), run: () => zoom.zoom(1 / ZOOM_STEP) },
          { id: "media.zoom.rotate", label: t("zoom.rotate"), run: () => zoom.rotate() },
        ],
      },
    );
  }
  const pdf = mounted.pdf;
  if (pdf && deps.copyText) {
    const chosen = window.getSelection();
    const text = chosen && !chosen.isCollapsed && mounted.element.contains(chosen.anchorNode) ? chosen.toString().trim() : "";
    if (text) {
      context.push(
        { id: "media.pdf.copy", label: t("editor_menu.copy"), run: () => copy(text) },
        { id: "media.pdf.quote", label: t("media_menu.pdf.quote"), run: () => copy(`${text}\n\n[[${id}#page=${pdf.page()}]]`) },
      );
    }
    context.push({ id: "media.pdf.copy_link", label: t("media.pdf.copy_link"), run: () => copy(`${id}#page=${pdf.page()}`) });
  }
  if (pdf && deps.annotate?.available()) {
    context.push({ id: "media.pdf.annotate", label: t("media.pdf.annotate"), run: () => void deps.annotate!.run(id).catch(() => {}) });
  }
  if (deps.copyText) context.push({ id: "media.copy_embed", label: t("media_menu.copy_embed"), run: () => copy(`![[${id}]]`) });
  const tail: (SurfaceMenuItem | string)[] = [];
  if (deps.openExternal) {
    tail.push({ id: "media.open_external", label: t("media.open_external"), run: () => void Promise.resolve(deps.openExternal!(id)).catch(() => {}) });
  }
  tail.push("shell.explorer.reveal");
  return { target: { kind: mounted.kind === "pdf" ? "page" : "media", ref: id }, context, note: { kind: "file", id }, tail };
}
