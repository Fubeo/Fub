// La lightbox: un'immagine della nota o un diagramma a tutta finestra, con lo
// zoom della `ZoomView`.
//
// È una `.modale` come le altre — fuoco intrappolato, Escape chiude, il fuoco
// torna dove era — e ne esiste una sola: aprirne un'altra chiude la prima. Il
// contenuto ha **un lease suo**, preso nella vita della lightbox: la resa da
// cui la si apre può ridisegnarsi o smontarsi (una battuta in Live, un cambio
// di tema) mentre questa resta aperta, e il suo URL non deve morire con lei.

import { t } from "../i18n/strings";
import { mountZoomView, type Backdrop, type Size } from "../editors/media/zoom-view";
import { trapFocus } from "./a11y";
import { openLifetime, type Lifetime } from "./lifetime";
import { enterSurface, exitSurface } from "./motion";
import { attachTooltip } from "./tooltip";

export interface LightboxOptions {
  /// Procura l'URL del contenuto nella vita della lightbox; `null` se non si
  /// può più aprire (il file è sparito).
  readonly source: (life: Lifetime) => Promise<string | null> | string | null;
  /// Il nome accessibile del contenuto: il testo alternativo, la descrizione.
  readonly label: string;
  /// La riga in alto: il nome del file, il tipo di diagramma.
  readonly caption?: string;
  readonly size?: Size | null;
  readonly backdrop?: Backdrop | null;
  /// Il fondo sotto un contenuto che lo presuppone: un diagramma senza carta
  /// ha i colori misurati su quello della nota.
  readonly background?: string;
  /// Un disegno vettoriale: si adatta alla finestra anche ingrandendo.
  readonly vector?: boolean;
}

export interface Lightbox {
  readonly element: HTMLElement;
  close(): void;
}

let current: Lightbox | null = null;

/// Una copia dell'SVG in un blob della lightbox, revocato alla chiusura.
export function svgSource(svg: string): (life: Lifetime) => string {
  return (life) => {
    const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
    life.add(() => URL.revokeObjectURL(url));
    return url;
  };
}

/// Il movimento oltre il quale un clic sul fondo è un trascinamento.
const CLICK_SLOP = 4;

export function openLightbox(options: LightboxOptions): Lightbox {
  current?.close();
  const life = openLifetime();
  const overlay = document.createElement("div");
  overlay.className = "modale lightbox";
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("aria-label", options.label || t("lightbox.title"));
  overlay.tabIndex = -1;

  const header = document.createElement("div");
  header.className = "lightbox-header";
  const caption = document.createElement("span");
  caption.className = "lightbox-caption";
  caption.textContent = options.caption ?? options.label;
  const closeButton = document.createElement("button");
  closeButton.type = "button";
  closeButton.className = "lightbox-close";
  closeButton.textContent = "×";
  closeButton.setAttribute("aria-label", t("lightbox.close"));
  header.append(caption, closeButton);

  const body = document.createElement("div");
  body.className = "lightbox-body";
  overlay.append(header, body);

  let closed = false;
  const handle: Lightbox = {
    element: overlay,
    close() {
      if (closed) return;
      closed = true;
      if (current === handle) current = null;
      life.close();
    },
  };
  current = handle;

  document.body.append(overlay);
  enterSurface(overlay, { viewTransition: false });
  life.add(() => exitSurface(overlay, () => overlay.remove(), { viewTransition: false }));
  life.add(trapFocus(overlay, () => handle.close()));
  life.add(attachTooltip(closeButton, t("lightbox.close")));
  life.listen(closeButton, "click", () => handle.close());
  closeButton.focus();

  function failed(): void {
    const message = document.createElement("p");
    message.className = "lightbox-error";
    message.setAttribute("role", "alert");
    message.textContent = t("markdown.image_missing", { name: options.label || options.caption || "" });
    body.replaceChildren(message);
  }

  void Promise.resolve()
    .then(() => options.source(life))
    .then((url) => {
      if (life.closed) return;
      if (!url) {
        failed();
        return;
      }
      const view = mountZoomView(url, {
        label: options.label || t("lightbox.title"),
        size: options.size ?? null,
        backdrop: options.backdrop ?? null,
        vector: options.vector ?? false,
        onError: failed,
      }, life);
      if (options.background) view.image.style.backgroundColor = options.background;
      body.replaceChildren(view.element);
      // Un clic sul fondo — non sull'immagine, e senza trascinare — chiude.
      let down: { x: number; y: number } | null = null;
      life.listen(view.stage, "pointerdown", (event) => {
        down = event.target === view.stage ? { x: event.clientX, y: event.clientY } : null;
      });
      life.listen(view.stage, "pointerup", (event) => {
        const start = down;
        down = null;
        if (start && Math.hypot(event.clientX - start.x, event.clientY - start.y) < CLICK_SLOP) handle.close();
      });
      view.stage.focus();
    })
    .catch(() => {
      if (!life.closed) failed();
    });

  return handle;
}

/// La lightbox aperta, se c'è: la chiude chi smonta la shell, e i banchi.
export function closeLightbox(): void {
  current?.close();
}
