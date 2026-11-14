// Il blocco ```query``` di Obsidian: il recinto porta una ricerca, e la resa
// mostra le note che la soddisfano al posto del codice. La ricerca è quella
// della barra (`searchExpression`), con la stessa sintassi; il testo del
// documento resta il recinto, nessuna riga viene scritta.
//
// Il blocco ```tasks``` del plugin Tasks non si legge qui: lo dichiara e lo
// disegna il componente dei compiti (`fub-features/src/tasks.rs`, la vista
// `tasks_query`), e la resa gli presta soltanto il posto. Senza il componente
// il recinto non è dichiarato e resta codice.
//
// Qui sta anche la pastiglia della scadenza dei compiti in Lettura.
import { matchingDocuments, searchExpression } from "../../../../host/query";
import { errorText } from "../../../../host/errors";
import { plural, t } from "../../../../i18n/strings";
import { embedView } from "../../../../ui/embedded-views";
import type { Lifetime } from "../../../../ui/lifetime";
import type { Expected } from "../../../../ui/race";
import { liveStrings } from "./strings";
import { dueLook, localDay, projectedDue, readingProjection } from "./task-due";

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

// ---------------------------------------------------------------------------
// Il recinto ```tasks```
// ---------------------------------------------------------------------------

/// La vista del componente dei compiti che disegna un recinto
/// (`fub_features::TASKS_QUERY_VIEW`), e il suo parametro.
export const TASKS_QUERY_VIEW = "tasks_query";

/// Presta il posto ai recinti ```tasks``` **dichiarati**: la vista del
/// componente ci si monta con le righe del recinto, e se ne va con `life`. Un
/// recinto non dichiarato (componente spento) resta codice.
export function embedTasksBlocks(container: HTMLElement, life: Lifetime): void {
  for (const code of container.querySelectorAll<HTMLElement>("pre[data-declared-fence] > code.language-tasks")) {
    const pre = code.parentElement!;
    if (pre.closest("[data-ui-slot]")) continue;
    const block = document.createElement("div");
    block.className = "block-query block-tasks";
    for (const key of ["mdFrom", "mdTo"] as const) {
      if (pre.dataset[key] !== undefined) block.dataset[key] = pre.dataset[key];
    }
    const waiting = document.createElement("p");
    waiting.className = "block-query-note";
    waiting.textContent = liveStrings.t("tasks.block.loading");
    block.append(waiting);
    pre.replaceWith(block);
    // Spento il componente, il recinto torna codice; riacceso, torna vista.
    embedView(TASKS_QUERY_VIEW, block, { query: code.textContent ?? "" }, life, {
      lost: () => block.replaceWith(pre),
      found: () => pre.replaceWith(block),
    });
  }
}

// ---------------------------------------------------------------------------
// La pastiglia della scadenza
// ---------------------------------------------------------------------------

/// Allarga `range` finché nessun elemento resta a metà: un bordo che cade
/// dentro un `<a>` o un `<code>` che il tratto non contiene tutto si sposta
/// prima (o dopo) l'elemento. Estrarre un tratto a metà di un elemento lo
/// spezza in due copie — un `<a href>` vuoto da una parte e il suo doppione
/// dall'altra —; così la pastiglia prende l'elemento intero, come nella Live
/// (`wholePill`), oppure sta tutta dentro quello che la contiene.
///
/// Gli span di posizione della resa (`<span data-md-from data-md-to>`, senza
/// classe) non sono elementi da prendere interi: portano un pezzo di testo e
/// il tratto di sorgente da cui viene. Uno che corrisponde al sorgente un
/// carattere per carattere si divide in due al bordo, ognuno col suo tratto;
/// uno che non corrisponde (un'entità, una barra protettiva) si prende intero.
function wholeElements(range: Range): void {
  if (range.startContainer !== range.endContainer) {
    const [endNode, endOffset] = splitPosition(range.endContainer, range.endOffset);
    range.setEnd(endNode, endOffset);
    const [startNode, startOffset] = splitPosition(range.startContainer, range.startOffset);
    range.setStart(startNode, startOffset);
  }
  const common = range.commonAncestorContainer;
  const outermost = (node: Node): Node | null => {
    if (node === common) return null;
    let found: Node | null = null;
    for (let at: Node | null = node.parentNode; at && at !== common; at = at.parentNode) found = at;
    return found;
  };
  const startElement = outermost(range.startContainer);
  const endElement = outermost(range.endContainer);
  if (startElement) range.setStartBefore(startElement);
  if (endElement) range.setEndAfter(endElement);
}

/// Un bordo dentro il testo di uno span di posizione fedele al sorgente: lo
/// span si divide lì, e il bordo diventa il punto fra le due metà. Altrimenti
/// il bordo resta dov'è.
function splitPosition(node: Node, offset: number): [Node, number] {
  const span = node.parentElement;
  const parent = span?.parentNode;
  if (!(node instanceof Text) || !span || !parent || span.tagName !== "SPAN" || span.className !== "" || span.childNodes.length !== 1) return [node, offset];
  const from = Number(span.dataset.mdFrom);
  const to = Number(span.dataset.mdTo);
  if (!Number.isInteger(from) || !Number.isInteger(to) || to - from !== node.length) return [node, offset];
  const index = [...parent.childNodes].indexOf(span);
  if (offset <= 0) return [parent, index];
  if (offset >= node.length) return [parent, index + 1];
  const after = span.cloneNode(false) as HTMLElement;
  after.append(node.splitText(offset));
  span.dataset.mdTo = String(from + offset);
  after.dataset.mdFrom = String(from + offset);
  span.after(after);
  return [parent, index + 1];
}

/// In Lettura la scadenza di un compito è una pastiglia, come nella Live:
/// arancio quando è vicina, segnata quando la data non si legge. Il testo
/// resta quello del file: la pastiglia lo avvolge.
export function markTaskDues(container: HTMLElement, today: string = localDay()): void {
  for (const item of container.querySelectorAll<HTMLElement>("li.task")) {
    if (item.closest("[data-ui-slot]")) continue;
    // Già segnata: una resa che si ripassa non avvolge due volte.
    if ([...item.querySelectorAll(".task-due")].some((pill) => pill.closest("li") === item)) continue;
    const { projection, nodes } = readingProjection(item);
    const due = projectedDue(projection);
    if (!due) continue;
    const done = item.querySelector<HTMLInputElement>(":scope > input[type=checkbox], :scope > p > input[type=checkbox]")?.checked === true;
    const look = dueLook(due, done, today);
    const locate = (offset: number): [Text, number] => {
      let found = nodes[0]!;
      for (const each of nodes) if (each.start <= offset) found = each;
      return [found.node, offset - found.start];
    };
    const range = document.createRange();
    range.setStart(...locate(due.source[0]));
    const [endNode, endOffset] = locate(due.source[1] - 1);
    range.setEnd(endNode, endOffset + 1);
    wholeElements(range);
    const pill = document.createElement("span");
    pill.className = look === "plain" ? "task-due" : `task-due task-due-${look}`;
    if (look === "bad") pill.title = liveStrings.t("tasks.due.unreadable");
    pill.append(range.extractContents());
    range.insertNode(pill);
  }
}
