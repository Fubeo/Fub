// Il segnalibro web (K8): un paragrafo fatto soltanto di un indirizzo web, fuori
// dal cursore, si vede come una scheda con titolo, descrizione e icona della
// pagina. Il file resta l'URL nudo, che ogni altro programma mostra come un
// link. La scheda la fa `fub.linkcard` e **soltanto su richiesta**: aprire una
// nota legge la cache e basta, e la scheda che non c'è offre «Mostra
// l'anteprima». Le schede le tiene `state/link-cards.ts`; qui c'è la resa.

import { StateEffect } from "@codemirror/state";
import { EditorView, WidgetType } from "@codemirror/view";
import { isAllowedLink } from "../../../../ui/sanitize";
import { liveStrings } from "./strings";

/// La scheda di una pagina, come la consegna `fub.linkcard`.
export interface LinkCard {
  readonly url: string;
  readonly title: string;
  readonly description: string;
  readonly site: string;
  /// Un `data:` URL di un'immagine raster, o vuota.
  readonly icon: string;
}

/// Che cosa si sa della scheda di un indirizzo.
export type LinkCardView =
  | { readonly kind: "card"; readonly card: LinkCard }
  /// La cache non ce l'ha: si offre di scaricarla.
  | { readonly kind: "bare" }
  | { readonly kind: "loading" }
  | { readonly kind: "failed"; readonly reason: string };

/// Le schede come le legge la shell.
export interface LinkCardSource {
  /// Ciò che si sa di `url`; la prima domanda guarda la cache.
  view(url: string): LinkCardView;
  /// «Mostra l'anteprima»: scarica la pagina, se il permesso lo consente.
  request(url: string): void;
  /// Avvisa quando una scheda cambia; torna lo smontaggio.
  watch(changed: () => void): () => void;
}

/// Le schede sono cambiate: le schede si ridisegnano.
export const linkCardsChanged = StateEffect.define<null>();

const MAX_URL = 2048;
const BARE_URL = /^\s*<?(https?:\/\/[^\s<>]+?)>?\s*$/;

/// L'indirizzo di un paragrafo che non dice nient'altro, o `null`.
export function bareUrl(source: string): string | null {
  if (source.length > MAX_URL + 8) return null;
  const found = BARE_URL.exec(source);
  const url = found?.[1];
  if (!url || url.length > MAX_URL || !/^https?:\/\/[^/?#]/.test(url) || !isAllowedLink(url)) return null;
  return url;
}

/// L'icona si mostra soltanto se è un'immagine raster inline: la scheda non
/// scarica niente e non dà un SVG al motore della pagina.
export function safeIcon(icon: string): string | null {
  return /^data:image\/(?:png|jpeg|gif|webp|x-icon);base64,[A-Za-z0-9+/]+=*$/.test(icon) ? icon : null;
}

function span(className: string, text: string): HTMLElement {
  const element = document.createElement("span");
  element.className = className;
  element.textContent = text;
  return element;
}

/// La scheda al posto del paragrafo.
export class LinkCardWidget extends WidgetType {
  constructor(readonly url: string, readonly state: LinkCardView) { super(); }
  eq(other: LinkCardWidget): boolean {
    return other.url === this.url && JSON.stringify(other.state) === JSON.stringify(this.state);
  }
  get estimatedHeight(): number { return this.state.kind === "card" ? 84 : 44; }
  toDOM(): HTMLElement {
    const root = document.createElement("div");
    root.className = "cm-fub-link-card";
    root.contentEditable = "false";
    root.dataset.state = this.state.kind;
    root.dataset.url = this.url;
    root.setAttribute("role", "group");
    const link = document.createElement("a");
    link.className = "cm-fub-link-card-main";
    link.href = this.url;
    link.rel = "noopener noreferrer";
    link.target = "_blank";
    const text = document.createElement("span");
    text.className = "cm-fub-link-card-text";
    link.append(text);
    root.append(link);
    if (this.state.kind === "card") {
      const { card } = this.state;
      const title = card.title || card.url;
      root.setAttribute("aria-label", liveStrings.t("linkcard.label", { title }));
      text.append(span("cm-fub-link-card-title", title));
      if (card.description) text.append(span("cm-fub-link-card-desc", card.description));
      const site = span("cm-fub-link-card-site", card.site || this.url);
      const icon = safeIcon(card.icon);
      if (icon) {
        const image = document.createElement("img");
        image.className = "cm-fub-link-card-icon";
        image.src = icon;
        image.alt = "";
        image.width = 16;
        image.height = 16;
        site.prepend(image);
      }
      text.append(site);
      return root;
    }
    root.setAttribute("aria-label", liveStrings.t("linkcard.label", { title: this.url }));
    text.append(span("cm-fub-link-card-url", this.url));
    if (this.state.kind === "failed") text.append(span("cm-fub-link-card-note", this.state.reason));
    const fetch = document.createElement("button");
    fetch.type = "button";
    fetch.className = "cm-fub-link-card-fetch";
    fetch.disabled = this.state.kind === "loading";
    fetch.textContent = liveStrings.t(
      this.state.kind === "loading" ? "linkcard.loading" : this.state.kind === "failed" ? "linkcard.retry" : "linkcard.fetch",
    );
    root.append(fetch);
    return root;
  }
  ignoreEvent(event: Event): boolean { return event instanceof KeyboardEvent; }
}

/// I gesti della scheda: il clic apre la pagina, il pulsante la chiede. Il
/// `mousedown` non arriva all'editor, così il cursore non entra nel paragrafo
/// e la scheda non torna indirizzo sotto il dito; ci si entra con le frecce.
export function linkCardGestures(source: LinkCardSource) {
  const part = (event: Event): { root: HTMLElement; fetch: boolean } | null => {
    const target = event.target instanceof Element ? event.target : null;
    const root = target?.closest<HTMLElement>(".cm-fub-link-card");
    if (!root || !target?.closest(".cm-fub-link-card-main, .cm-fub-link-card-fetch")) return null;
    return { root, fetch: Boolean(target.closest(".cm-fub-link-card-fetch")) };
  };
  return EditorView.domEventHandlers({
    mousedown(event) {
      if (event.button !== 0 || !part(event)) return false;
      event.preventDefault();
      return true;
    },
    click(event) {
      const hit = part(event);
      if (!hit) return false;
      event.preventDefault();
      const url = hit.root.dataset.url ?? "";
      if (hit.fetch) source.request(url);
      else if (isAllowedLink(url)) window.open(url, "_blank", "noopener,noreferrer");
      return true;
    },
  });
}
