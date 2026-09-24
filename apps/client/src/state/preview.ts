// Anteprima read-only con lifecycle deterministico (P06/F16,
// shell.preview.show/hide): hover 350 ms, modificatore Ctrl/Cmd = subito,
// Ctrl/Cmd+Invio = sticky, Esc/mouseleave/blur/close = teardown. Legge dal
// canale dati (`renderEmbed` = ritaglio con àncora, come gli embed), mai dal
// buffer live: nessuna sessione, nessun dirty toccato, nessuna scrittura.
// Sanitizzata con `setSanitizedHtml` (unico varco HTML) + link navigabili via
// `wireContent` esistente (stessi handler della lettura: wikilink/anchor/tag
// aprono, non eseguono). Una sola scheda per owner: la risposta di una riga
// vecchia non riempie la scheda nuova (Race per owner). Upgrade a sticky:
// la scheda resta finché Invio/Escape/click-fuori; downgrade mai implicito.
import { renderEmbed } from "../host/query";
import { setSanitizedHtml } from "../ui/sanitize";
import { errorText } from "../host/errors";
import { t } from "../i18n/strings";
import { state } from "../state/store";
import { activeDoc } from "../state/layout";
import { Race } from "../ui/race";
import { notify } from "../ui/notify";

const HOVER_MS = 350;

interface PreviewOwner {
  alive: boolean;
  race: Race;
  el: HTMLElement | null;
  timer: number | undefined;
  for: string | null;
  sticky: boolean;
}

let owner: PreviewOwner | null = null;

function ensureOwner(): PreviewOwner {
  if (!owner) {
    owner = { alive: true, race: new Race(), el: null, timer: undefined, for: null, sticky: false };
  }
  owner.alive = true;
  return owner;
}

function mountEl(box: HTMLElement): HTMLElement {
  const current = ensureOwner();
  if (!current.el) {
    const el = document.createElement("div");
    // La resa è quella della Lettura: stesse classi, stessi stili.
    el.className = "doc-preview markdown-rendered";
    el.setAttribute("role", "document");
    el.tabIndex = 0;
    el.dataset.preview = "true";
    box.appendChild(el);
    current.el = el;
  }
  if (current.el.parentElement !== box) box.appendChild(current.el);
  return current.el;
}

/// Mostra l’anteprima del documento corrente (shell.preview.show):
/// `sticky` da Ctrl+Invio resta, altrimenti hover. Read-only: nessun
/// editor montato, nessun `DocumentSurface`, nessuna sottoscrizione.
export async function showPreviewForCurrent(sticky: boolean): Promise<void> {
  const doc = activeDoc() ?? state.currentDoc;
  if (!doc) {
    notify(t("docsearch.no_doc"), "guasto");
    return;
  }
  const panes = document.getElementById("panes");
  if (!panes) return;
  const el = mountEl(panes);
  const current = ensureOwner();
  current.for = doc;
  current.sticky = sticky;
  el.textContent = doc;
  const shown = await current.race.last((expected) =>
    expected(
      renderEmbed(doc, null, null)
        .then((content) => ({ content }))
        .catch((error: unknown) => ({ error: errorText(error) })),
    ),
  );
  if (!current.alive || !shown || current.for !== doc || current.el !== el) return;
  if ("error" in shown) {
    notify(t("preview.embed_failed", { reason: shown.error }), "guasto");
    hidePreview();
    return;
  }
  setSanitizedHtml(el, shown.content.html);
}

/// Programma l’anteprima sopra una riga (hover quick-switcher/ricerca):
/// 350 ms senza modificatore, subito con Ctrl/Cmd.
export function schedulePreview(doc: string, box: HTMLElement, immediate: boolean): void {
  const current = ensureOwner();
  if (current.for === doc && current.el) return;
  if (current.timer !== undefined) window.clearTimeout(current.timer);
  current.timer = window.setTimeout(
    () => void showPreviewIn(doc, box, false),
    immediate ? 0 : HOVER_MS,
  );
}

/// Keyboard equivalent of hover: the preview stays until explicit dismissal.
export async function showStickyPreview(doc: string, box: HTMLElement): Promise<void> {
  await showPreviewIn(doc, box, true);
  if (owner?.for === doc && owner.el?.parentElement === box) owner.el.focus();
}

async function showPreviewIn(doc: string, box: HTMLElement, sticky: boolean): Promise<void> {
  const el = mountEl(box);
  const current = ensureOwner();
  current.for = doc;
  current.sticky = sticky;
  el.setAttribute("aria-label", doc);
  const shown = await current.race.last((expected) =>
    expected(
      renderEmbed(doc, null, null)
        .then((content) => ({ content }))
        .catch((error: unknown) => ({ error: errorText(error) })),
    ),
  );
  if (!current.alive || !shown || current.for !== doc || current.el !== el) return;
  if ("error" in shown) {
    el.textContent = t("search.unavailable");
    el.title = shown.error;
    return;
  }
  setSanitizedHtml(el, shown.content.html);
}

/// Annulla un hover programmato senza chiudere una sticky.
export function cancelScheduledPreview(): void {
  if (!owner) return;
  if (owner.timer !== undefined) window.clearTimeout(owner.timer);
  owner.timer = undefined;
  if (owner.sticky) return;
  hidePreview();
}

/// Chiude e smonta la scheda (shell.preview.hide, Esc, cambio vault):
/// timer cancellato, corsa invalidata, nodo rimosso, owner morto. Nessun
/// listener/timer orfano: tutto vive nell’owner e muore qui.
export function hidePreview(): void {
  if (!owner) return;
  owner.alive = false;
  owner.race.cancel();
  if (owner.timer !== undefined) window.clearTimeout(owner.timer);
  owner.timer = undefined;
  owner.for = null;
  owner.sticky = false;
  owner.el?.remove();
  owner.el = null;
  owner = null;
}

/// Solo per i banchi: chi è mostrato e se è sticky.
export function previewStateForTest(): { doc: string | null; sticky: boolean } {
  return { doc: owner?.for ?? null, sticky: owner?.sticky ?? false };
}
