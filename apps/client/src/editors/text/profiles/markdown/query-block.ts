// Il blocco ```query``` di Obsidian: il recinto porta una ricerca, e la resa
// mostra le note che la soddisfano al posto del codice. La ricerca è quella
// della barra (`searchExpression`), con la stessa sintassi; il testo del
// documento resta il recinto, nessuna riga viene scritta.
//
// Il blocco ```tasks``` del plugin Tasks: le sue righe diventano la stessa
// ricerca (`tasks-query.ts`), e la resa mostra i compiti che rispondono, con
// la spunta che scrive nella nota d'origine.
import { matchingDocuments, searchExpression } from "../../../../host/query";
import { errorText } from "../../../../host/errors";
import { api } from "../../../../host/ipc";
import { plural, t } from "../../../../i18n/strings";
import { pageName, taskChecked } from "../../../../rules/mirrored";
import { openVaultRoot, vaultArg } from "../../../../state/store";
import type { Lifetime } from "../../../../ui/lifetime";
import { Race, type Expected } from "../../../../ui/race";
import { liveStrings } from "./strings";
import {
  DUE_MARK,
  dueIsNear,
  localDay,
  taskDue,
  taskMatches,
  tasksOf,
  translateTasksQuery,
  type FoundTask,
  type TaskDue,
} from "./tasks-query";

/// Quante note un blocco elenca. Le altre si contano e basta: chi ne vuole
/// di più apre la ricerca.
export const QUERY_BLOCK_LIMIT = 50;

/// I recinti `query` e `tasks` diventano segnaposto subito (la copia del codice
/// non li vede); i risultati arrivano dopo. Restituisce i blocchi da riempire:
/// quelli di `tasks` portano anche la classe `block-tasks`.
export function claimQueryBlocks(container: HTMLElement): { block: HTMLElement; query: string }[] {
  const claimed: { block: HTMLElement; query: string }[] = [];
  for (const code of container.querySelectorAll<HTMLElement>("pre > code.language-query, pre > code.language-tasks")) {
    const pre = code.parentElement!;
    if (pre.closest("[data-ui-slot]")) continue;
    const tasks = code.classList.contains("language-tasks");
    const query = (code.textContent ?? "").trim();
    const block = document.createElement("div");
    block.className = tasks ? "block-query block-tasks" : "block-query";
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
  if (block.classList.contains("block-tasks")) return fillTasksBlock(block, query, expected, life);
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

/// La vista del provider dei compiti (`fub-features/src/tasks.rs`,
/// `TASKS_VIEW`): c'è quando il componente «Compiti» è acceso.
const TASKS_VIEW = "tasks";
/// Il comando che spunta un compito nella nota d'origine, con la revisione.
const TASK_TOGGLE = "note.task.toggle";
/// Quante note un recinto ```tasks``` legge al più.
export const TASKS_BLOCK_NOTES = 50;
/// Quanti compiti un recinto ```tasks``` elenca al più.
export const TASKS_BLOCK_LIMIT = 100;

/// Un'attesa il cui errore è già un valore: il cancello del giro resta l'unico
/// punto in cui una risposta scaduta si butta (`ui/race.ts`).
type Settled<T> = { ok: true; value: T } | { ok: false; error: unknown };
function settle<T>(promise: Promise<T>): Promise<Settled<T>> {
  return promise.then(
    (value) => ({ ok: true as const, value }),
    (error: unknown) => ({ ok: false as const, error }),
  );
}

/// Un compito da elencare, con la sua nota.
interface ListedTask {
  doc: string;
  task: FoundTask;
}

/// La pastiglia della scadenza, per la Lettura e per il recinto.
function duePill(text: string, due: TaskDue, done: boolean, today: string): HTMLElement {
  const pill = document.createElement("span");
  pill.className = !done && due.day !== null && dueIsNear(due.day, today) ? "task-due task-due-near" : "task-due";
  pill.textContent = text;
  return pill;
}

/// In Lettura la scadenza di un compito è una pastiglia, come nella Live:
/// arancio quando è vicina. Il testo resta quello del file.
export function markTaskDues(container: HTMLElement, today: string = localDay()): void {
  for (const item of container.querySelectorAll<HTMLElement>("li.task")) {
    if (item.closest("[data-ui-slot]")) continue;
    // Il testo del compito, non dei compiti annidati: l'ultimo `📅` vince.
    const walker = document.createTreeWalker(item, NodeFilter.SHOW_TEXT);
    let last: Text | null = null;
    let marked = false;
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const parent = node.parentElement;
      if (!parent || parent.closest("li") !== item) continue;
      if (parent.closest(".task-due")) marked = true;
      if (parent.closest("code, pre, a, .task-due")) continue;
      if ((node.nodeValue ?? "").includes(DUE_MARK)) last = node as Text;
    }
    if (!last || marked) continue;
    const due = taskDue(last.data);
    if (!due) continue;
    const done = item.querySelector<HTMLInputElement>(":scope > input[type=checkbox]")?.checked === true;
    const pill = last.splitText(due.from);
    pill.splitText(due.to - due.from);
    pill.replaceWith(duePill(pill.data, due, done, today));
  }
}

/// Riempie un recinto ```tasks```: le righe del plugin diventano la ricerca, la
/// ricerca sceglie le note, e di ogni nota si tengono i compiti che rispondono.
/// La spunta passa da `note.task.toggle`, che scrive nella nota d'origine con
/// la sua revisione; poi il recinto si rilegge.
async function fillTasksBlock(block: HTMLElement, source: string, expected: Expected, life: Lifetime): Promise<void> {
  const vault = vaultArg(openVaultRoot());
  const race = new Race();
  life.add(() => race.cancel());
  const finish = (children: HTMLElement[]): void => {
    block.replaceChildren(...children);
    block.removeAttribute("aria-busy");
  };
  const line = (text: string, extra?: string): HTMLElement => {
    const el = document.createElement("p");
    el.className = extra ? `block-query-note ${extra}` : "block-query-note";
    el.textContent = text;
    return el;
  };
  const say = (text: string): void => finish([line(text)]);

  const toggle = async (listed: ListedTask, input: HTMLInputElement): Promise<void> => {
    input.disabled = true;
    // Una scrittura arriva fino in fondo: non passa dal cancello del giro.
    // Prima si rilegge la nota: se in quel posto non c'è più lo stesso
    // compito, non si spunta niente.
    const outcome = await settle((async () => {
      const now = await api.readDocument(listed.doc, ...vault);
      const same = tasksOf(now.text).find((task) => task.byte === listed.task.byte);
      if (!same || same.symbol !== listed.task.symbol || same.text !== listed.task.text) return "changed" as const;
      await api.invokeCommand(TASK_TOGGLE, { doc: listed.doc, at: [listed.task.byte] }, "apply", ...vault);
      return "done" as const;
    })());
    if (life.closed) return;
    const notice = !outcome.ok
      ? liveStrings.t("tasks.block.toggle_failed", { reason: errorText(outcome.error) })
      : outcome.value === "changed" ? liveStrings.t("tasks.block.changed") : null;
    block.setAttribute("aria-busy", "true");
    await race.last((gate) => draw(gate, notice));
  };

  const draw = async (gate: Expected, notice: string | null): Promise<void> => {
    const views = await gate(settle(api.listViews(...vault)));
    if (life.closed) return;
    if (!views.ok) return say(liveStrings.t("tasks.block.failed", { reason: errorText(views.error) }));
    if (!views.value.some((view) => view.id === TASKS_VIEW)) return say(liveStrings.t("tasks.block.missing"));
    if (source === "") return say(liveStrings.t("tasks.block.empty"));
    const today = localDay();
    const query = translateTasksQuery(source, today);
    let expression;
    try {
      expression = searchExpression(query.search);
    } catch (error) {
      return say(liveStrings.t("tasks.block.failed", { reason: errorText(error) }));
    }
    const found = await gate(settle(matchingDocuments(expression, { offset: 0, limit: TASKS_BLOCK_NOTES }, "omit")));
    if (life.closed) return;
    if (!found.ok) return say(liveStrings.t("tasks.block.failed", { reason: errorText(found.error) }));
    const sources = await gate(Promise.all(found.value.items.map((match) =>
      settle(api.readDocument(match.doc, ...vault)).then((read) => ({ doc: match.doc, read })))));
    if (life.closed) return;

    const listed: ListedTask[] = [];
    let unread = 0;
    for (const { doc, read } of sources) {
      if (!read.ok) {
        unread += 1;
        continue;
      }
      for (const task of tasksOf(read.value.text)) {
        if (taskMatches(task, query.filter)) listed.push({ doc, task });
      }
    }
    // Prima chi ha una scadenza, la più vicina in testa; poi per nota e posto.
    listed.sort((a, b) => {
      const da = a.task.due?.day ?? "￿";
      const db = b.task.due?.day ?? "￿";
      if (da !== db) return da < db ? -1 : 1;
      if (a.doc !== b.doc) return a.doc < b.doc ? -1 : 1;
      return a.task.at - b.task.at;
    });

    const children: HTMLElement[] = [];
    for (const skipped of query.skipped) {
      children.push(line(liveStrings.t("tasks.block.skipped", { line: skipped.line, text: skipped.text }), "tasks-skipped"));
    }
    if (notice) {
      const said = line(notice, "tasks-notice");
      said.setAttribute("role", "status");
      children.push(said);
    }
    if (unread > 0) {
      children.push(line(liveStrings.plural(unread, "tasks.block.unread.one", "tasks.block.unread"), "tasks-notice"));
    }
    if (listed.length === 0) {
      children.push(line(liveStrings.t("tasks.block.none")));
      return finish(children);
    }
    children.push(line(liveStrings.plural(listed.length, "tasks.block.count.one", "tasks.block.count")));
    const list = document.createElement("ul");
    list.className = "tasks-list";
    for (const each of listed.slice(0, TASKS_BLOCK_LIMIT)) list.append(taskItem(each, today, toggle));
    children.push(list);
    if (listed.length > TASKS_BLOCK_LIMIT || found.value.total > found.value.items.length) {
      children.push(line(liveStrings.t("tasks.block.more", { shown: Math.min(listed.length, TASKS_BLOCK_LIMIT) })));
    }
    finish(children);
  };

  await draw(expected, null);
}

/// Una riga del recinto: la casella, il testo con la pastiglia della scadenza e
/// la nota d'origine, che la resa sa già aprire (`a.internal-path`).
function taskItem(
  listed: ListedTask,
  today: string,
  toggle: (listed: ListedTask, input: HTMLInputElement) => Promise<void>,
): HTMLElement {
  const { doc, task } = listed;
  const done = taskChecked(task.symbol);
  const item = document.createElement("li");
  item.className = done ? "tasks-item tasks-done" : "tasks-item";
  const box = document.createElement("input");
  box.type = "checkbox";
  box.className = "tasks-check";
  box.checked = done;
  box.setAttribute("aria-label", liveStrings.t(done ? "tasks.block.uncheck" : "tasks.block.check", { text: task.text }));
  box.addEventListener("change", () => void toggle(listed, box));
  // Invio spunta come Spazio: la casella è un comando.
  box.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" || box.disabled) return;
    event.preventDefault();
    box.click();
  });
  const text = document.createElement("span");
  text.className = "tasks-text";
  if (task.due) {
    const before = task.text.slice(0, task.due.from).trimEnd();
    const after = task.text.slice(task.due.to).trimStart();
    text.append(before, " ", duePill(task.text.slice(task.due.from, task.due.to), task.due, done, today));
    if (after) text.append(" ", after);
  } else {
    text.textContent = task.text;
  }
  const link = document.createElement("a");
  link.className = "internal-path tasks-note";
  link.dataset.path = doc;
  link.href = "#";
  link.textContent = pageName(doc);
  item.append(box, text, link);
  return item;
}
