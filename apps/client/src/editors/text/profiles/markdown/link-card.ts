// Il segnalibro web (K8): un paragrafo fatto soltanto di un indirizzo web, fuori
// dal cursore, si vede come una scheda con titolo, descrizione e icona della
// pagina. Il file resta l'URL nudo, che ogni altro programma mostra come un
// link. La scheda la fa `fub.linkcard` e **soltanto su richiesta**: aprire una
// nota legge la cache e basta, e la scheda che non c'è offre «Mostra
// l'anteprima». Le schede le tiene `state/link-cards.ts`; qui c'è la resa.
//
// La scheda della nota (E11, T20) sta accanto: un paragrafo fatto soltanto di
// un wikilink, fuori dal cursore, si vede come la nota a cui porta, con icona,
// titolo, descrizione, data e copertina presi dalle sue proprietà
// (`state/note-cards.ts`, con `query_index`). Il file resta il wikilink; col
// cursore dentro torna il link, come per la pagina web.

import { StateEffect } from "@codemirror/state";
import { EditorView, WidgetType } from "@codemirror/view";
import { rovingToolbar } from "../../../../kit/toolbar-keys";
import { wikilink } from "../../../../rules/syntax";
import { drawPageMark } from "../../../../ui/page-mark";
import { openLifetime, type Lifetime } from "../../../../ui/lifetime";
import { isAllowedLink } from "../../../../ui/sanitize";
import { followWikilink, renderedLinkGesture, type WikilinkFollow } from "./link-gesture";
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

/// La scheda di una nota del vault, dalle sue proprietà.
export interface NoteCard {
  /// Il documento a cui il link porta.
  readonly doc: string;
  readonly title: string;
  /// Il valore di `icon:` (un'emoji, una figura `fub:`), o vuoto.
  readonly icon: string;
  readonly description: string;
  /// La data da mostrare, già detta a parole, o vuota.
  readonly date: string;
  /// La copertina (`cover:`): un colore CSS si mostra com'è, ogni altro valore
  /// come la striscia di copertina del tema; vuota, nessuna copertina.
  readonly cover: string;
  /// Quante note la citano (i suoi collegamenti entranti).
  readonly links: number;
}

/// Che cosa si sa della nota a cui porta un wikilink.
export type NoteCardView =
  | { readonly kind: "card"; readonly card: NoteCard }
  /// La domanda è partita: intanto il link resta link.
  | { readonly kind: "loading" }
  /// Il link non porta a nessuna nota: resta link (e Alt col clic offre di crearla).
  | { readonly kind: "missing" };

/// Le schede come le legge la shell.
export interface LinkCardSource {
  /// Ciò che si sa di `url`; la prima domanda guarda la cache.
  view(url: string): LinkCardView;
  /// «Mostra l'anteprima»: scarica la pagina, se il permesso lo consente.
  request(url: string): void;
  /// Ciò che si sa della nota `page` (il bersaglio del wikilink com'è
  /// scritto, senza sezione né blocco) scritta nella nota `from`: lo stesso
  /// nome porta a note diverse da cartelle diverse. Assente: un wikilink da
  /// solo resta link.
  note?(page: string, from?: string): NoteCardView;
  /// L'editor ha nel testo la scheda di `page`: finché la tiene, un cambio
  /// dell'indice la richiede. Torna come lasciarla.
  holdNote?(page: string, from?: string): () => void;
  /// Avvisa quando una scheda cambia (di pagina web o di nota); torna lo smontaggio.
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

/// Il wikilink di un paragrafo che non dice nient'altro, o `null`: un embed
/// (`![[…]]`), un link a un punto della nota stessa (`[[#Sezione]]`) o più
/// di un link non sono una scheda.
export function bareWikilink(source: string): { page: string; heading: string | null; block: string | null; alias: string | null } | null {
  if (source.length > MAX_URL + 8) return null;
  const trimmed = source.trim();
  if (trimmed.includes("\n")) return null;
  const found = wikilink(trimmed);
  const only = found[0];
  if (found.length !== 1 || !only || only.embed || only.from !== 0 || only.to !== trimmed.length || only.page === "") return null;
  return { page: only.page, heading: only.heading, block: only.block, alias: only.alias };
}

/// Un colore CSS scritto per intero (`#abc`, `#aabbcc`, `rgb(…)`, `hsl(…)`,
/// `oklch(…)`): soltanto questi la copertina mette nello stile.
export function coverColor(cover: string): string | null {
  const value = cover.trim();
  if (/^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(value)) return value;
  if (/^(?:rgb|rgba|hsl|hsla|oklch)\(\s*[0-9.,%\s/deg-]+\)$/i.test(value)) return value;
  return null;
}

/// La scheda di una nota al posto del paragrafo del suo wikilink (E11).
export class NoteCardWidget extends WidgetType {
  constructor(
    readonly page: string,
    readonly heading: string | null,
    readonly block: string | null,
    readonly alias: string | null,
    readonly card: NoteCard,
  ) { super(); }
  eq(other: NoteCardWidget): boolean {
    return other.page === this.page && other.heading === this.heading && other.block === this.block
      && other.alias === this.alias && JSON.stringify(other.card) === JSON.stringify(this.card);
  }
  get estimatedHeight(): number { return 84; }
  toDOM(): HTMLElement {
    const { card } = this;
    const root = document.createElement("div");
    root.className = "cm-fub-note-card";
    root.contentEditable = "false";
    root.dataset.wikilinkPage = this.page;
    if (this.heading) root.dataset.wikilinkHeading = this.heading;
    if (this.block) root.dataset.wikilinkBlock = this.block;
    const title = this.alias || card.title;
    root.setAttribute("role", "group");
    root.setAttribute("aria-label", liveStrings.t("notecard.label", { title }));
    const main = document.createElement("button");
    main.type = "button";
    main.className = "cm-fub-note-card-main";
    main.title = liveStrings.t("notecard.hint");
    const body = document.createElement("span");
    body.className = "cm-fub-note-card-body";
    const head = span("cm-fub-note-card-title", "");
    if (card.icon) {
      const mark = document.createElement("span");
      mark.className = "cm-fub-note-card-icon";
      mark.setAttribute("aria-hidden", "true");
      if (drawPageMark(mark, card.icon)) head.append(mark);
    }
    head.append(document.createTextNode(title));
    body.append(head);
    if (card.description) body.append(span("cm-fub-note-card-desc", card.description));
    const meta = [
      card.date,
      card.links > 0 ? liveStrings.t(card.links === 1 ? "notecard.links_one" : "notecard.links", { count: String(card.links) }) : "",
    ].filter((part) => part !== "").join(" · ");
    if (meta) body.append(span("cm-fub-note-card-meta", meta));
    main.append(body);
    if (card.cover) {
      const cover = document.createElement("span");
      cover.className = "cm-fub-note-card-cover";
      cover.setAttribute("aria-hidden", "true");
      const color = coverColor(card.cover);
      if (color) cover.style.background = color;
      main.append(cover);
    }
    root.append(main);
    return root;
  }
  ignoreEvent(event: Event): boolean { return event instanceof KeyboardEvent; }
}

/// I gesti della scheda della nota, con la regola di ciò che è reso
/// (`link-gesture.ts`): Alt col clic la sbircia, ogni altro clic è il clic che
/// apre e fa ciò che dice `editor.link-click`. Il `mousedown` non arriva
/// all'editor, così il cursore non entra nel paragrafo e la scheda non torna
/// link sotto il dito; ci si entra con le frecce.
export function noteCardGestures(follow: WikilinkFollow) {
  const hit = (event: Event): HTMLElement | null => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target?.closest(".cm-fub-note-card-main")) return null;
    return target.closest<HTMLElement>(".cm-fub-note-card");
  };
  return EditorView.domEventHandlers({
    mousedown(event) {
      if (event.button !== 0 || !hit(event)) return false;
      event.preventDefault();
      return true;
    },
    click(event) {
      const root = hit(event);
      if (!root) return false;
      event.preventDefault();
      void followWikilink(follow, root.dataset.wikilinkPage ?? "", root.dataset.wikilinkHeading ?? null, root.dataset.wikilinkBlock ?? null, renderedLinkGesture(event));
      return true;
    },
  });
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

/// La vita della barra di ogni scelta montata: si chiude quando la scelta esce.
const choiceLives = new WeakMap<HTMLElement, Lifetime>();

/// La scelta sotto un indirizzo incollato su una riga vuota (T25): «Link», la
/// scelta di partenza, «Scheda», che scrive l'indirizzo da solo sulla riga, e,
/// per un sito dell'elenco chiuso (`web-embed.ts`, T37), «Incorpora», che lo
/// scrive come pagina incorporata. È una barra degli strumenti
/// (`kit/toolbar-keys`): un solo punto di tabulazione, e le frecce fra le
/// voci. Quello che sceglie Invio, Spazio, Esc o Tab lo decide `paste.ts`, che
/// sa che cosa scrivere.
export class AddressChoiceWidget extends WidgetType {
  constructor(readonly url: string, readonly embeddable = false) { super(); }
  eq(other: AddressChoiceWidget): boolean { return other.url === this.url && other.embeddable === this.embeddable; }
  get estimatedHeight(): number { return 32; }
  toDOM(): HTMLElement {
    const root = document.createElement("div");
    root.className = "cm-fub-address-choice";
    root.contentEditable = "false";
    root.dataset.url = this.url;
    root.setAttribute("role", "toolbar");
    root.setAttribute("aria-label", liveStrings.t("paste.address.label"));
    const link = choiceControl("link", liveStrings.t("paste.address.link"), liveStrings.t("paste.address.link.title"), true);
    const card = choiceControl("card", liveStrings.t("paste.address.card"), liveStrings.t("paste.address.card.title"), false);
    const controls = this.embeddable
      ? [link, card, choiceControl("embed", liveStrings.t("paste.address.embed"), liveStrings.t("paste.address.embed.title"), false)]
      : [link, card];
    root.append(...controls);
    const life = openLifetime();
    rovingToolbar(root, { controls: () => controls }, life).refresh(link);
    choiceLives.set(root, life);
    return root;
  }
  destroy(dom: HTMLElement): void {
    choiceLives.get(dom)?.close();
    choiceLives.delete(dom);
  }
  // Le battute e il clic arrivano all'editor (`paste.ts` le gestisce); il resto
  // del puntatore resta alla scelta.
  ignoreEvent(event: Event): boolean {
    return !(event instanceof KeyboardEvent || event.type === "click" || event.type === "mousedown");
  }
}

function choiceControl(kind: "link" | "card" | "embed", label: string, title: string, pressed: boolean): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.tabIndex = -1;
  button.className = `cm-fub-address-choice-${kind}`;
  button.dataset.choice = kind;
  button.setAttribute("aria-pressed", String(pressed));
  button.title = title;
  button.textContent = label;
  return button;
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
