// La scheda sui collegamenti: sostando su un `[[wikilink]]` (in Live) o su un
// collegamento interno (in Lettura) si vede che cosa c'è dall'altra parte,
// senza lasciare il punto in cui si sta leggendo.
//
// # Da dove viene ciò che si mostra
//
// Dal canale dati, come gli embed: `resolve` dice quale documento è (o che non
// c'è), `render_embed` ne rende il ritaglio — la nota intera, o la sezione o il
// blocco nominati — e passa dall'unico varco dell'HTML. Niente sessioni, niente
// buffer, niente scritture: guardare non cambia niente.
//
// # Che cosa si può fare dalla scheda
//
// Aprire, aprire di fianco, aprire in una linguetta: gli stessi tre gesti del
// lanciatore (`openNote`). Un collegamento che non trova la nota offre invece
// «Crea», e la nota nasce nello spazio attivo.
//
// # Tastiera
//
// La scheda si apre anche col fuoco, ma solo se è arrivato dalla tastiera
// (`kit/hover-card`): in Lettura i collegamenti sono fermate del Tab. In Live il
// collegamento è testo dell'editor e non prende il fuoco: lì Alt+Invio lo apre
// (`open-link.ts`) e Maiusc+Alt+Invio, col cursore nel collegamento, apre la
// scheda col fuoco sulla prima azione. Esc riporta il fuoco nel testo.
import { errorText } from "../../../host/errors";
import { renderEmbed, resolvedReference } from "../../../host/query";
import type { LinkTarget } from "../../../host/contract";
import { t } from "../../../i18n/strings";
import { pageName } from "../../../rules/mirrored";
import { attachHoverCard } from "../../../kit/hover-card";
import { activeDoc } from "../../../state/layout";
import { state } from "../../../state/store";
import { createNote } from "../../../state/vault";
import type { Lifetime } from "../../../ui/lifetime";
import { notify } from "../../../ui/notify";
import { setSanitizedHtml } from "../../../ui/sanitize";
import { openNote } from "../launcher/actions";
import type { OpenWay } from "../launcher/model";
import { byId } from "../frame/dom";

/// I collegamenti che hanno una scheda: il wikilink della Live, e i collegamenti
/// interni della Lettura (wikilink e percorsi del vault).
export const LINK_SELECTOR = ".cm-fub-wikilink[data-wikilink-page], a.wikilink[data-wikilink-page], a.internal-path[data-path]";

/// Quanta nota si mostra: oltre, la scheda scorre.
const CARD_HEIGHT = "min(280px, 50vh)";

/// Che cosa dice un collegamento: la sua destinazione per il canale dati, e il
/// punto della nota (titolo, blocco) se ne nomina uno.
export interface LinkRef {
  readonly target: LinkTarget;
  readonly heading: string | null;
  readonly block: string | null;
}

export function linkOf(el: HTMLElement): LinkRef | null {
  const page = el.dataset.wikilinkPage;
  if (page !== undefined) {
    if (page.trim() === "") return null;
    const heading = el.dataset.wikilinkHeading ?? null;
    const block = el.dataset.wikilinkBlock ?? null;
    return { target: { kind: "wiki", value: { page, heading, block } }, heading, block };
  }
  const path = el.dataset.path;
  if (path) return { target: { kind: "path", value: path }, heading: null, block: null };
  return null;
}

export function mountLinkCards(lifetime: Lifetime): void {
  const panes = byId("panes");
  if (!panes) return;
  const card = attachHoverCard({
    delegate: { root: panes, selector: LINK_SELECTOR },
    lifetime,
    placement: "bottom",
    align: "start",
    label: (target) => t("link_card.label", { page: nameOf(target) }),
    load: async (target, signal) => {
      const link = linkOf(target);
      if (!link) return null;
      const resolved = await resolvedReference(link.target, activeDoc() ?? undefined);
      if (signal.aborted) return null;
      if (!resolved) return missing(link);
      const content = await renderEmbed(resolved.doc, link.heading, link.block);
      if (signal.aborted) return null;
      return found(resolved.doc, content.html);
    },
  });
  lifetime.listen(panes, "keydown", (event) => {
    if (event.key !== "Enter" || !event.altKey || !event.shiftKey || event.ctrlKey || event.metaKey) return;
    if (event.isComposing || event.defaultPrevented) return;
    const target = linkAtCaret(panes);
    if (!target) return;
    event.preventDefault();
    card.show(target, { focus: true });
  });
}

/// Il collegamento della Live in cui sta il cursore, se c'è: la selezione del
/// documento è quella dell'editor che ha il fuoco.
export function linkAtCaret(root: HTMLElement): HTMLElement | null {
  const selection = root.ownerDocument.getSelection();
  const node = selection?.focusNode;
  const start = node instanceof Element ? node : node?.parentElement;
  if (!start || !root.contains(start) || !start.closest(".cm-content")) return null;
  const link = start.closest(LINK_SELECTOR);
  return link instanceof HTMLElement && linkOf(link) ? link : null;
}

/// Il nome con cui un collegamento nomina la sua nota, per l'etichetta della scheda.
function nameOf(el: HTMLElement): string {
  return pageName(el.dataset.wikilinkPage ?? el.dataset.path ?? el.textContent ?? "");
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function action(label: string, run: () => void | Promise<void>, primary = false): HTMLButtonElement {
  const button = el("button", primary ? "link-card-action link-card-primary" : "link-card-action", label);
  button.type = "button";
  button.addEventListener("click", () => {
    void Promise.resolve(run()).catch((error: unknown) =>
      notify(t("preview.open_failed", { page: label, reason: errorText(error) }), "guasto"));
  });
  return button;
}

function head(title: string, where: string): HTMLElement {
  const header = el("header", "link-card-head");
  header.append(el("span", "link-card-title", title));
  if (where !== "") header.append(el("span", "link-card-where", where));
  return header;
}

function folderOf(doc: string): string {
  return doc.split("/").filter(Boolean).slice(0, -1).join(" › ");
}

function found(doc: string, html: string): HTMLElement {
  const card = el("div", "link-card");
  const body = el("div", "link-card-body markdown-rendered");
  body.style.maxHeight = CARD_HEIGHT;
  setSanitizedHtml(body, html);
  // Un collegamento dentro la scheda non si segue: è uno sguardo, e un secondo
  // livello di schede non ci sta. Senza `href` non è più una fermata del Tab né
  // un bersaglio di clic (e il corpo, non essendo inerte, resta scorrevole).
  for (const link of body.querySelectorAll("a")) {
    link.removeAttribute("href");
    link.tabIndex = -1;
  }
  const way = (how: OpenWay) => () => openNote(doc, how);
  card.append(
    head(pageName(doc), folderOf(doc)),
    body,
    actionsOf(
      action(t("link_card.open"), way("here"), true),
      action(t("link_card.split"), way("split")),
      action(t("link_card.tab"), way("tab")),
    ),
  );
  return card;
}

function missing(link: LinkRef): HTMLElement {
  const name = link.target.kind === "wiki" ? link.target.value.page : link.target.kind === "path" ? link.target.value : "";
  const card = el("div", "link-card");
  card.append(
    head(pageName(name), ""),
    el("p", "link-card-note", t("link_card.missing")),
    actionsOf(action(t("link_card.create"), async () => {
      const doc = await createNote(pageName(name), state.activeSpace ?? undefined);
      if (doc) await openNote(doc, "here");
    }, true)),
  );
  return card;
}

function actionsOf(...buttons: HTMLButtonElement[]): HTMLElement {
  const row = el("footer", "link-card-actions");
  row.append(...buttons);
  return row;
}
