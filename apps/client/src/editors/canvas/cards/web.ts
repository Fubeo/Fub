// La scheda di pagina web della lavagna (N6 T8): l'indirizzo e il dominio,
// sempre; titolo, sito, descrizione e icona della pagina soltanto quando
// qualcuno li ha chiesti con «Mostra l'anteprima».
//
// La scheda non va mai in rete da sé: niente iframe, niente `fetch`, niente
// immagini remote. Ciò che sa di una pagina lo legge dalla porta, che ha la
// stessa forma della sorgente delle schede di link delle note
// (`LinkCardSource`, in `editors/text/profiles/markdown/link-card.ts`):
// `view` legge la cache, `request` chiede di scaricare la pagina (con il
// permesso di rete dell'host), `watch` avvisa quando una scheda cambia. I tipi
// sono copiati qui per struttura, perché la tela non importa moduli di
// `editors/text/` (che si tirano dietro CodeMirror). Aprire la pagina passa
// dal visore di oggi (`media.openViewer`), anche quello dato dalla porta.
//
// Viva, la scheda ascolta la porta e si può usare; ferma, non ascolta niente
// ed è inerte: mostra l'ultimo stato che ha avuto. Un'anteprima fallita non è
// un errore da mostrare in rosso: restano indirizzo e dominio, e si può
// chiedere di nuovo.

import { t, onLanguage } from "../../../i18n/strings";
import { isAllowedLink } from "../../../ui/sanitize";
import type { CanvasNode } from "../model";
import type { CardContext, CardMode, CardRenderer, CardView } from "../cards";

/// La scheda di una pagina, come la consegna `fub.linkcard` (la forma di
/// `LinkCard` delle note).
export interface WebCard {
  readonly url: string;
  readonly title: string;
  readonly description: string;
  readonly site: string;
  /// Un `data:` URL di un'immagine raster, o vuota.
  readonly icon: string;
}

/// Che cosa si sa della scheda di un indirizzo (la forma di `LinkCardView`).
export type WebCardView =
  | { readonly kind: "card"; readonly card: WebCard }
  /// La cache non ce l'ha: si offre di scaricarla.
  | { readonly kind: "bare" }
  | { readonly kind: "loading" }
  | { readonly kind: "failed"; readonly reason: string };

/// Ciò che la scheda chiede a chi la monta: la forma di `LinkCardSource` e
/// l'apertura della pagina.
export interface WebCardPort {
  /// Ciò che si sa di `url`; legge la cache, non scarica.
  view(url: string): WebCardView;
  /// «Mostra l'anteprima»: scarica la pagina, se il permesso lo consente.
  request(url: string): void;
  /// Avvisa quando una scheda cambia; torna lo smontaggio.
  watch(changed: () => void): () => void;
  /// Apre la pagina nel visore (`media.openViewer`).
  open(url: string): void | Promise<void>;
}

export function webCardRenderer(port: WebCardPort): CardRenderer {
  return {
    kinds: ["web"],
    mount: (node, host, mode, context) => mountWebCard(node, host, mode, context, port),
  };
}

/// Un indirizzo che la scheda sa aprire: `http` o `https`, con un dominio, e
/// ammesso come link da `ui/sanitize.ts`. `null` per tutto il resto.
export function webCardAddress(value: string): { readonly href: string; readonly domain: string } | null {
  const text = value.trim();
  if (text === "" || !isAllowedLink(text)) return null;
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (url.hostname === "") return null;
  return { href: url.href, domain: url.hostname };
}

/// L'icona si mostra soltanto se è un'immagine raster inline: un indirizzo
/// remoto farebbe partire una richiesta, e un SVG non entra nella pagina.
/// La stessa regola di `safeIcon` delle schede di link delle note.
export function webCardIcon(icon: string): string | null {
  return /^data:image\/(?:png|jpeg|gif|webp|x-icon);base64,[A-Za-z0-9+/]+=*$/.test(icon) ? icon : null;
}

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const created = document.createElement(tag);
  created.className = className;
  if (text !== undefined) created.textContent = text;
  return created;
}

function mountWebCard(
  node: CanvasNode,
  host: HTMLElement,
  initialMode: CardMode,
  context: CardContext,
  port: WebCardPort,
): CardView {
  const { lifetime } = context;
  const text = typeof node.url === "string" ? node.url : "";
  const address = webCardAddress(text);

  const root = element("div", "canvas-card-web");
  root.dataset.cardKind = "web";
  host.append(root);

  let mode: CardMode = initialMode;
  let destroyed = false;
  let unwatch: (() => void) | null = null;

  const state = (): WebCardView => (address === null ? { kind: "bare" } : port.view(address.href));

  const render = (): void => {
    if (destroyed) return;
    const view = state();
    root.replaceChildren();
    root.dataset.cardState = address === null ? "invalid" : view.kind;
    root.inert = mode === "snapshot";
    root.removeAttribute("title");

    if (address !== null && view.kind === "card") {
      const { card } = view;
      root.append(element("div", "canvas-card-web-title", card.title || address.href));
      if (card.description) root.append(element("div", "canvas-card-web-description", card.description));
    }

    root.append(element("span", "canvas-url-text", text));
    if (address === null) return;

    const domain = element("span", "canvas-card-web-domain");
    if (view.kind === "card") {
      const icon = webCardIcon(view.card.icon);
      if (icon !== null) {
        const image = element("img", "canvas-card-web-icon");
        image.src = icon;
        image.alt = "";
        image.width = 16;
        image.height = 16;
        domain.append(image);
      }
      const site = view.card.site.trim();
      if (site !== "" && site !== address.domain) domain.append(element("span", "canvas-card-web-site", site));
    }
    domain.append(element("span", "canvas-card-web-host", address.domain));
    root.append(domain);

    const actions = element("div", "canvas-card-web-actions");
    const open = element("button", "canvas-open-url", t("canvas.open_url"));
    open.type = "button";
    actions.append(open);

    if (view.kind !== "card") {
      // Il guasto non si dice in rosso: resta in un suggerimento, per chi
      // vuole sapere perché l'anteprima non c'è.
      if (view.kind === "failed" && view.reason) root.title = view.reason;
      const loading = view.kind === "loading";
      const preview = element("button", "canvas-card-web-preview", t(loading ? "canvas.card.loading" : "canvas.card.show_preview"));
      preview.type = "button";
      preview.disabled = loading;
      actions.append(preview);
    }
    root.append(actions);
  };

  // Un ascolto solo, sulla radice: i pulsanti si rifanno a ogni stato e non
  // lasciano ascoltatori dietro di sé.
  lifetime.listen(root, "click", (event) => {
    const target = event.target instanceof Element ? event.target.closest("button") : null;
    if (target === null || !root.contains(target)) return;
    event.stopPropagation();
    if (destroyed || mode !== "live" || address === null || target.disabled) return;
    if (target.classList.contains("canvas-open-url")) {
      void port.open(address.href);
    } else if (target.classList.contains("canvas-card-web-preview")) {
      // Un clic solo, una richiesta sola: il pulsante si spegne subito,
      // anche prima che la porta dica «in corso».
      target.disabled = true;
      port.request(address.href);
    }
  });

  const watch = (): void => {
    if (unwatch !== null || address === null) return;
    const stop = port.watch(() => {
      // Una porta che avvisa dopo lo smontaggio non tocca più niente.
      if (!destroyed && mode === "live") render();
    });
    unwatch = stop;
  };
  const stopWatching = (): void => {
    const stop = unwatch;
    unwatch = null;
    stop?.();
  };
  lifetime.add(onLanguage(render));

  const destroy = (): void => {
    if (destroyed) return;
    destroyed = true;
    stopWatching();
    root.remove();
  };
  // La vita della scheda chiude tutto anche se la tela non passa da `destroy`.
  lifetime.add(destroy);

  if (mode === "live") watch();
  render();

  return {
    setMode(next) {
      if (destroyed || next === mode) return;
      mode = next;
      if (mode === "live") watch();
      else stopWatching();
      render();
    },
    enter: () => false,
    destroy,
  };
}
