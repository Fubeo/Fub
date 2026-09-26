// La superficie media: una EditorSurface vera per immagini/audio/video/PDF.
//
// Si monta dal registro (famiglia `viewer`, vedi integrazione a Main): il
// documento che arriva qui e' l'id di un allegato, non testo. Legge il
// descrittore e i byte dalla porta, monta la view giusta, rilascia tutto al
// teardown (handle chiuso, blob revocati, listener staccati). La sorgente
// binaria non passa dal buffer di testo; la modalita' slide spetta al reso.
import type { EditorSurface, SurfaceMode, SurfaceMountContext } from "../core/registry";
import type { Lifetime } from "../../ui/lifetime";
import { openLifetime } from "../../ui/lifetime";
import { onLanguage, t, type Key } from "../../i18n/strings";
import { assetUrl, MEDIA_MAX_INLINE_BYTES, mediaKindOfId, type MediaKind, type ResourceDescriptor } from "./media-types";
import { openResourcePort, type ResourcePort, type ResourceTransport } from "./resource-port";
import { decodeImage, mountImageView } from "./image-view";
import { mountAudioView, mountVideoView } from "./player-view";
import { mountPdfView, pdfIdWithoutFragment, pdfPageFromFragment, type PdfEngineLoader } from "./pdf-view";

export interface MediaSurfaceDeps {
  transport: ResourceTransport;
  pdfLoader?: PdfEngineLoader;
  openExternal?: (id: string) => void | Promise<void>;
  copyText?: (text: string) => Promise<void>;
}

const MEDIA_MODES: SurfaceMode[] = [
  { id: "view", label: () => t("mode.reading"), presentation: "surface", contextMode: "reading" },
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
          ? mountAudioView(descriptor, assetUrl(descriptor.handle), life, deps.openExternal ? () => deps.openExternal!(descriptor.id) : undefined)
          : mountVideoView(descriptor, assetUrl(descriptor.handle), life, deps.openExternal ? () => deps.openExternal!(descriptor.id) : undefined);
        root.append(view.element);
        const streamPort = port;
        life.add(() => void streamPort.close().catch(() => {}));
        pendingPort = null;
        port = null;
      } else {
        const bytes = await port.readAll();
        if (!active) return;
        await mountBytes(descriptor, bytes, life, deps, root, context.documentId);
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
): Promise<void> {
  const kind: MediaKind = mediaKindOfId(descriptor.id);
  const openExternal = deps.openExternal ? () => deps.openExternal!(descriptor.id) : undefined;
  switch (kind) {
    case "image": {
      const image = decodeImage(descriptor, bytes);
      const view = mountImageView(image, descriptor.id, life);
      root.append(view.element);
      return;
    }
    case "audio": {
      const view = mountAudioView(descriptor, bytes, life, openExternal);
      root.append(view.element);
      return;
    }
    case "video": {
      const view = mountVideoView(descriptor, bytes, life, openExternal);
      root.append(view.element);
      return;
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
        },
        life,
      );
      root.append(view.element);
      return;
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
    }
  }
}

