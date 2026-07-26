// Gli intenti che la shell sa eseguire: navigare, rivelare, cercare.
//
// Arrivano da due parti — un `ViewUpdate` di una view e un `CommandEffect` di
// un comando — e sono gli stessi perché sono intenti della **shell**, non di
// chi li manda. Una copia per sorgente sarebbe una copia da tenere allineata:
// il giorno che la si dimentica, un comando naviga e una view no.
import type { CommandEffect, ViewUpdate } from "../host/contract";
import { isOpen, openDocument, revealByteOffset } from "../panels/document";
import { searchFor } from "../panels/search";

/// I due tipi veri del confine, meno il caso che qui non c'entra: `replace`
/// riguarda la view che lo ha mandato, e lo gestisce chi la monta. Scritto come
/// unione dei tipi rispecchiati e non a mano, così un caso nuovo in Rust arriva
/// fin qui.
export type ShellIntent = Exclude<ViewUpdate, { kind: "replace" }> | CommandEffect;

export async function applyIntent(intent: ShellIntent): Promise<void> {
  switch (intent.kind) {
    case "navigate":
      await openDocument("doc" in intent ? intent.doc : intent.doc_id);
      break;
    case "reveal": {
      // Apri il documento se non è quello aperto, poi porta la vista
      // sull'intervallo (lo scroll converte byte UTF-8 → posizione editor).
      const doc = "doc" in intent ? intent.doc : intent.doc_id;
      if (!isOpen(doc)) await openDocument(doc);
      revealByteOffset(intent.span.start);
      break;
    }
    case "run_search":
      searchFor(intent.query);
      break;
    case "custom":
      // Intento con namespace che questa shell non prevede: da contratto
      // non fa nulla (degrado garbato) — chi lo emette conta su una shell
      // che lo capisce, non su questa.
      console.info(`FubMD: intento custom ignorato (ns: ${intent.ns}).`);
      break;
    case "plan":
      // Un piano arrivato fuori dal giro dell'anteprima: non si applica da
      // sé, e la palette lo ha già mostrato quando l'ha chiesto.
      break;
    case "none":
    case "done":
      break;
  }
}
