// Il blocco ```query``` di Obsidian: il recinto porta una ricerca, e la resa
// mostra le note che la soddisfano al posto del codice. La ricerca è quella
// della barra (`searchExpression`), con la stessa sintassi; il testo del
// documento resta il recinto, nessuna riga viene scritta.
import { matchingDocuments, searchExpression } from "../../../../host/query";
import { errorText } from "../../../../host/errors";
import { plural, t } from "../../../../i18n/strings";
import type { Lifetime } from "../../../../ui/lifetime";
import type { Expected } from "../../../../ui/race";

/// Quante note un blocco elenca. Le altre si contano e basta: chi ne vuole
/// di più apre la ricerca.
export const QUERY_BLOCK_LIMIT = 50;

/// I recinti `query` diventano segnaposto subito (la copia del codice non li
/// vede); i risultati arrivano dopo. Restituisce i blocchi da riempire.
export function claimQueryBlocks(container: HTMLElement): { block: HTMLElement; query: string }[] {
  const claimed: { block: HTMLElement; query: string }[] = [];
  for (const code of container.querySelectorAll<HTMLElement>("pre > code.language-query")) {
    const pre = code.parentElement!;
    if (pre.closest("[data-ui-slot]")) continue;
    const query = (code.textContent ?? "").trim();
    const block = document.createElement("div");
    block.className = "block-query";
    for (const key of ["mdFrom", "mdTo"] as const) {
      if (pre.dataset[key] !== undefined) block.dataset[key] = pre.dataset[key];
    }
    block.setAttribute("aria-busy", "true");
    pre.replaceWith(block);
    claimed.push({ block, query });
  }
  return claimed;
}

/// Riempie un blocco con le note trovate, come link che la resa sa già
/// aprire (`a.internal-path`). Un errore di sintassi o del kernel si dice
/// nel blocco, non altrove.
export async function fillQueryBlock(
  block: HTMLElement,
  query: string,
  expected: Expected,
  life: Lifetime,
): Promise<void> {
  const say = (text: string): void => {
    const line = document.createElement("p");
    line.className = "block-query-note";
    line.textContent = text;
    block.replaceChildren(line);
    block.removeAttribute("aria-busy");
  };
  if (query === "") {
    say(t("preview.query.empty"));
    return;
  }
  let found;
  try {
    found = await expected(matchingDocuments(searchExpression(query), { offset: 0, limit: QUERY_BLOCK_LIMIT }, "omit"));
  } catch (error) {
    if (!life.closed) say(t("preview.query.failed", { reason: errorText(error) }));
    return;
  }
  if (life.closed) return;
  if (found.items.length === 0) {
    say(t("preview.query.none"));
    return;
  }
  const head = document.createElement("p");
  head.className = "block-query-note";
  head.textContent = plural(found.total, "preview.query.count.one", "preview.query.count");
  const list = document.createElement("ul");
  for (const match of found.items) {
    const link = document.createElement("a");
    link.className = "internal-path";
    link.dataset.path = match.doc;
    link.href = "#";
    link.textContent = match.doc.replace(/\.md$/i, "");
    const item = document.createElement("li");
    item.append(link);
    list.append(item);
  }
  block.replaceChildren(head, list);
  if (found.total > found.items.length) {
    const more = document.createElement("p");
    more.className = "block-query-note";
    more.textContent = plural(found.total - found.items.length, "preview.query.more.one", "preview.query.more");
    block.append(more);
  }
  block.removeAttribute("aria-busy");
}
