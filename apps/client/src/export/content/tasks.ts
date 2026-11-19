// I compiti fatti (E28, T74; il prototipo «Compiti fatti: Mostra, Togli»,
// passo 29).
//
// Mostrati, escono come nella Lettura: la casella spuntata e il testo
// barrato. Tolti, la voce non c'è, coi compiti che teneva dentro: un compito
// fatto si porta via i suoi passi, come quando si piega. Un compito annullato
// (`[-]`) o in corso (`[/]`) non è fatto, e resta.

import type { ContentChanges } from "./changes";

/// Le voci dei compiti fatti: la casella della resa è spuntata.
export function doneTasks(root: ParentNode): HTMLLIElement[] {
  return [...root.querySelectorAll<HTMLLIElement>("li.task")].filter((item) => {
    const box = item.querySelector<HTMLInputElement>(":scope > input[type='checkbox']");
    return box !== null && (box.checked || box.hasAttribute("checked"));
  });
}

/// Toglie i compiti fatti dalla resa, se la scelta lo vuole. Torna quanti ne
/// ha tolti.
export function applyTasks(page: HTMLElement, keepDone: boolean, changes: ContentChanges): number {
  if (keepDone) return 0;
  const done = doneTasks(page);
  for (const item of done) changes.hide(item);
  return done.length;
}
