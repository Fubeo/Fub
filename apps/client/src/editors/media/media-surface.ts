// La superficie media: una EditorSurface vera per immagini/audio/video/PDF.
//
// Si monta dal registro (famiglia `viewer`, vedi integrazione a Main): il
// documento che arriva qui e' l'id di un allegato, non testo. Legge il
// descrittore e i byte dalla porta, monta la view giusta, rilascia tutto al
// teardown (handle chiuso, blob revocati, listener staccati). La sorgente
// binaria non passa dal buffer di testo; la modalita' slide spetta al reso.
import type { EditorSurface, SurfaceMode, SurfaceMountContext, SurfacePoint, SurfaceStatusItem } from "../core/registry";
import type { SurfaceMenu, SurfaceMenuItem } from "../core/editor-menu";
import { pngOf } from "../core/png";
import { clipboardSupports, writeClipboardData } from "../../platform/clipboard";
import { notify } from "../../ui/notify";
import type { Lifetime } from "../../ui/lifetime";
import { openLifetime } from "../../ui/lifetime";
import { onLanguage, t, type Key } from "../../i18n/strings";
import { MEDIA_MAX_INLINE_BYTES, mediaKindOfId, type MediaKind, type ResourceDescriptor } from "./media-types";
import { openResourcePort, readAllResource, type ResourcePort, type ResourceTransport } from "./resource-port";
import { decodeImage, mountImageView, type ImageView } from "./image-view";
import { ZOOM_STEP } from "./zoom-view";
import { mountAudioView, mountVideoView } from "./player-view";
import { mountPdfView, pdfIdWithoutFragment, pdfPageFromFragment, pdfWhereText, type PdfEngineLoader, type PdfView } from "./pdf-view";
import { openWithChoices, shellOpenWith, type OpenWithHost } from "../../state/external-editors";

export interface MediaSurfaceDeps {
  transport: ResourceTransport;
  /// L'URL `fub-asset:` con cui audio e video oltre il tetto si leggono in
  /// streaming: la forma dipende dalla piattaforma e la sa l'host.
  assetUrl: (handle: string) => string;
  pdfLoader?: PdfEngineLoader;
  /// L'app predefinita del sistema: «Apri con un'altra app» c'è solo con lei.
  openExternal?: (id: string) => void | Promise<void>;
  /// Le app Craft di «Apri con» (N7): con almeno una installata la voce
  /// diventa un sottomenu. Senza, quelle della shell principale.
  openWith?: OpenWithHost;
  copyText?: (text: string) => Promise<void>;
  /// «Annota» sul PDF: crea o apre le sue annotazioni. `available` dice se il
  /// kernel ha il comando, cioè se il vault serve le annotazioni.
  annotate?: { available(): boolean; run(pdf: string): Promise<void> };
  /// I dati di LightCraft sotto una foto (N7): mostra in fondo a `root` la
  /// riga dell'XMP accanto a `doc`, finché `life` è vivo. Senza, la foto è
  /// sola; con, la riga arriva dopo la foto, che non la aspetta.
  photoData?: { show(root: HTMLElement, doc: string, life: Lifetime): void };
  /// Le annotazioni del PDF mostrato (`X.pdf.fubann` accanto a `X.pdf`), che
  /// il visore disegna sopra le pagine in sola lettura. Senza, o con
  /// `available()` falso (il vault non serve le annotazioni), il visore
  /// mostra solo il PDF.
  annotations?: PdfAnnotationsPort;
}

/// Come il visore legge le annotazioni di un PDF: con le porte di lettura
/// dell'host e gli eventi dei documenti che la shell ha già.
export interface PdfAnnotationsPort {
  /// Vero se il vault serve le annotazioni (la feature `draw`).
  available(): boolean;
  /// Il testo intero di `id`, BOM compreso; `null` se il file non c'è.
  read(id: string): Promise<string | null>;
  /// `changed` quando `id` si salva, nasce, sparisce o cambia nome; mai per
  /// tasto. Restituisce lo smontaggio.
  watch(id: string, changed: () => void): () => void;
}

type AnnotationsModule = typeof import("./pdf-annotations");

/// Il codice che disegna le annotazioni: si scarica la prima volta che un
/// PDF ne ha, e una volta.
let annotationsModule: Promise<AnnotationsModule> | null = null;
function loadAnnotations(): Promise<AnnotationsModule> {
  annotationsModule ??= import("./pdf-annotations").catch((error: unknown) => {
    annotationsModule = null;
    throw error;
  });
  return annotationsModule;
}

/// L'impronta dei byte del PDF, come la scrive `fub:digest`. `digest` copia
/// i byte subito: pdf.js se li può tenere dopo.
async function pdfDigest(bytes: Uint8Array): Promise<string> {
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes as BufferSource));
  let hex = "";
  for (const byte of hash) hex += byte.toString(16).padStart(2, "0");
  return `sha256:${hex}`;
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
  /// La pagina chiesta dall'apertura (un link a `x.pdf#page=3`) o da un link
  /// seguito mentre i byte si leggono ancora: il visore parte da lì.
  let wantedPage: number | null = context.page ?? null;

  function message(key: Key): void {
    if (!active) return;
    status.textContent = t(key);
  }
  life.add(onLanguage(() => message("viewer.unavailable")));
  // La banda di stato: «Pagina N di M» del PDF, finché una pagina si mostra.
  const statusListeners = new Set<() => void>();
  const statusChanged = (): void => {
    for (const listener of [...statusListeners]) listener();
  };
  life.add(onLanguage(statusChanged));

  async function load(): Promise<void> {
    const bareId = pdfIdWithoutFragment(context.documentId);
    const kind: MediaKind = mediaKindOfId(bareId);
    const expected = profileForKind(kind);
    if (profile !== expected && profile !== "bytes-read-only") {
      message("viewer.unavailable");
      return;
    }
    // Le annotazioni accanto al PDF si cercano subito, insieme ai byte del
    // PDF: quando il PDF è letto la risposta di solito c'è già.
    const marks = kind === "pdf" ? watchAnnotations(bareId) : null;
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
        // Con le annotazioni l'impronta si prende prima che pdf.js abbia i
        // byte, e il codice del disegno parte insieme al PDF.
        let digest: Promise<string> | null = null;
        if (marks !== null && typeof (await marks.text.then((text) => text, () => null)) === "string") {
          if (!active) return;
          digest = pdfDigest(bytes);
          digest.catch(() => {});
          void loadAnnotations().catch(() => {});
        }
        if (!active) return;
        mounted = await mountBytes(descriptor, bytes, life, deps, root, context.documentId, wantedPage, statusChanged);
        if (marks !== null && mounted?.pdf) followAnnotations(mounted.pdf, marks, digest);
        // La prima pagina può arrivare prima della view: la banda la rilegge.
        statusChanged();
      }
      status.remove();
      showPhotoData();
    } catch (error) {
      if (!active) return;
      status.textContent = error instanceof Error ? error.message : t("viewer.unavailable");
      // Una foto che la vista non sa mostrare (un TIFF, un HEIC) ha la sua
      // frase, e sotto i dati del suo XMP.
      showPhotoData();
    } finally {
      if (pendingPort === port) pendingPort = null;
      await port?.close().catch(() => {});
    }
  }

  /// Le annotazioni di `pdf` mentre il visore è aperto: l'ultima lettura del
  /// `.fubann` e chi la ridisegna quando il file cambia.
  interface Marks {
    readonly port: PdfAnnotationsPort;
    readonly pdf: string;
    readonly id: string;
    /// L'ultima lettura chiesta: un salvataggio ne chiede una nuova.
    text: Promise<string | null>;
    /// Chi la porta sulle pagine, quando il visore c'è.
    redraw: (() => void) | null;
  }

  /// Comincia a leggere le annotazioni di `pdf` e a seguirne i salvataggi;
  /// `null` se il vault non le serve.
  function watchAnnotations(pdf: string): Marks | null {
    const port = deps.annotations;
    if (!port?.available()) return null;
    const id = `${pdf}.fubann`;
    const read = (): Promise<string | null> => {
      const text = port.read(id);
      text.catch(() => {});
      return text;
    };
    const marks: Marks = { port, pdf, id, text: read(), redraw: null };
    life.add(port.watch(id, () => {
      if (!active) return;
      marks.text = read();
      marks.redraw?.();
    }));
    return marks;
  }

  /// Porta le annotazioni sulle pagine di `view`, e ce le riporta a ogni
  /// salvataggio: vale l'ultima lettura chiesta, e una più vecchia arrivata
  /// dopo non la copre.
  function followAnnotations(view: PdfView, marks: Marks, digest: Promise<string> | null): void {
    let run = 0;
    let facts: Promise<{ digest: string; pages: number }> | null = null;
    // L'impronta e le pagine del PDF mostrato, chieste una volta e solo se le
    // annotazioni dicono di quale versione sono. Senza l'impronta presa
    // all'apertura (il `.fubann` è nato dopo) il PDF si rilegge.
    const pdfFacts = (): Promise<{ digest: string; pages: number }> => {
      facts ??= (async () => {
        const hash = await (digest ?? readAllResource(deps.transport, marks.pdf).then((read) => pdfDigest(read.bytes)));
        const pages = await view.pageCount();
        if (pages === null) throw new Error("PDF without pages");
        return { digest: hash, pages };
      })();
      facts.catch(() => {
        facts = null;
      });
      return facts;
    };
    const refresh = async (): Promise<void> => {
      const token = ++run;
      const stale = (): boolean => !active || token !== run;
      const unreadable = (): void => view.setAnnotations(null, t("media.pdf.annotations_unreadable"));
      let text: string | null;
      try {
        text = await marks.text;
      } catch {
        if (!stale()) unreadable();
        return;
      }
      if (stale()) return;
      if (text === null) {
        view.setAnnotations(null, null);
        return;
      }
      let module: AnnotationsModule;
      try {
        module = await loadAnnotations();
      } catch {
        if (!stale()) unreadable();
        return;
      }
      if (stale()) return;
      const read = module.readPdfAnnotations(text, marks.id, marks.pdf);
      switch (read.kind) {
        case "foreign":
          view.setAnnotations(null, t("media.pdf.annotations_foreign"));
          return;
        case "unreadable":
          unreadable();
          return;
        case "elsewhere":
          view.setAnnotations(null, null);
          return;
        case "drawn":
          break;
      }
      let line: string | null = null;
      if (module.needsPdfFacts(read.root)) {
        try {
          const pdf = await pdfFacts();
          if (stale()) return;
          if (module.annotationsChanged(read.root, pdf)) {
            line = t("pdf.changed");
            if (read.root.pages !== null && read.root.pages !== pdf.pages) {
              line += ` ${t("pdf.changed.pages", { before: read.root.pages, after: pdf.pages })}`;
            }
          }
        } catch {
          // Senza l'impronta non si sa se il PDF è cambiato: le annotazioni
          // si disegnano lo stesso, senza riga.
          if (stale()) return;
        }
      }
      view.setAnnotations(read.layers, line);
    };
    marks.redraw = () => void refresh();
    life.add(() => {
      marks.redraw = null;
      run++;
    });
    void refresh();
  }

  // La riga dei dati di LightCraft, dopo la foto o dopo la frase che dice
  // perché non si vede: soltanto per una foto, e una volta.
  let photoShown = false;
  function showPhotoData(): void {
    if (photoShown || !active || profile !== "media-image" || !deps.photoData) return;
    photoShown = true;
    deps.photoData.show(root, pdfIdWithoutFragment(context.documentId), life);
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
    showPage(page: number) {
      if (!active || !Number.isSafeInteger(page) || page < 1) return;
      if (mounted?.pdf) void mounted.pdf.goToPage(page).catch(() => {});
      else if (!mounted) wantedPage = page;
    },
    contextMenu: (at) => mediaMenu(mounted, at, pdfIdWithoutFragment(context.documentId), deps),
    // Un PDF dice nella banda la pagina che si legge; le altre specie niente.
    status: {
      counts: false,
      items: (): readonly SurfaceStatusItem[] => {
        const where = active ? mounted?.pdf?.where() : null;
        return where ? [{ id: "page", text: pdfWhereText(where) }] : [];
      },
      subscribe(listener) {
        statusListeners.add(listener);
        return () => statusListeners.delete(listener);
      },
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
  wantedPage: number | null = null,
  onPage?: () => void,
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
      const page = wantedPage ?? pdfPageFromFragment(documentId);
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
          onPage,
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
export type Mounted = {
  readonly kind: MediaKind;
  readonly element: HTMLElement;
  readonly image?: ImageView;
  readonly pdf?: PdfView;
} | null;

/// Il menu del tasto destro sul file mostrato. Sul lettore di audio e video
/// resta quello del sistema, che ha già velocità e ripetizione. Esportato per
/// i casi del bilancio dei menu (`ui/menu-cases.ts`).
export function mediaMenu(mounted: Mounted, at: SurfacePoint | null, id: string, deps: MediaSurfaceDeps): SurfaceMenu | null {
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
  if (deps.openExternal) tail.push(openWithItem(id, deps.openExternal, deps.openWith ?? shellOpenWith));
  tail.push("shell.explorer.reveal");
  return { target: { kind: mounted.kind === "pdf" ? "page" : "media", ref: id }, context, note: { kind: "file", id }, tail };
}

/// «Apri con un'altra app» sul file mostrato: la voce dell'app di sistema, o
/// con un'app Craft installata il sottomenu che la mette per prima, come
/// nell'albero (`panels/open-with.ts`). Le voci si chiedono all'host quando
/// il sottomenu si apre.
export function openWithItem(id: string, openExternal: (id: string) => void | Promise<void>, host: OpenWithHost): SurfaceMenuItem {
  const system = (): void => void Promise.resolve(openExternal(id)).catch(() => {});
  const item = { id: "media.open_external", label: t("media.open_external") };
  if (!host.installed()) return { ...item, run: system };
  return {
    ...item,
    load: async () => (await openWithChoices(id, system, host)).map((choice): SurfaceMenuItem => ({
      id: `media.open_with.${choice.id}`,
      label: choice.label,
      ...(choice.note === undefined ? {} : { description: choice.note }),
      ...(choice.disabled ? { enabled: false } : {}),
      run: choice.run,
    })),
  };
}
