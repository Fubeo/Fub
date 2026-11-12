// Ciò che l'albero disegna, come il kernel l'ha risposto, e la sua impronta.
//
// L'impronta serve a due domande. «È cambiato qualcosa?», per non ridisegnare
// un albero identico (`refreshFromKernel`). E «è cambiato qualcosa **fuori**
// da questa cartella?», per aprirne o chiuderne una toccando soltanto il suo
// sottoalbero: se fuori tutto è com'era, le righe di fuori restano quelle che
// sono, col fuoco, il trascinamento e il puntatore che ci stanno sopra.
import type { ExplorerSort, FolderContent } from "../rules/organizer";

/// Ciò che serve a disegnare l'albero (§14.3, §14.4).
///
/// **Solo le cartelle visibili**: la radice (o lo spazio attivo) e ognuna di
/// quelle aperte. Prima qui c'era l'elenco di tutte le note del vault e
/// l'albero se lo costruiva la shell; adesso un vault da diecimila note ne
/// trasferisce quante ne sono a schermo.
export interface View {
  /// Il contenuto di ogni cartella visibile, non ordinato: l'ordine dipende
  /// dall'organizzazione, che cambia senza che il kernel c'entri.
  folders: Map<string, FolderContent>;
  /// I documenti «attesi» che esistono davvero: le folder note possibili delle
  /// cartelle disegnate, e le note appuntate. Una domanda sola per entrambe —
  /// sono la stessa domanda, «quali di questi path ci sono».
  existing: Set<string>;
  /// Quante voci ha ciò che si vede (il vault o lo spazio attivo), a ogni
  /// profondità: il numero accanto a «Tutte le note». `null` se la domanda è
  /// fallita: allora il numero non si scrive, e l'albero si disegna lo stesso.
  total: number | null;
}

/// Il sottoalbero da lasciare fuori dall'impronta.
export interface Outside {
  /// La cartella: lei resta dentro (la sua riga sta nel livello di sopra),
  /// il suo contenuto e quello delle sue sottocartelle no.
  readonly folder: string;
  /// Le note appuntate: la loro esistenza conta anche sotto la cartella,
  /// perché si vedono fra le appuntate.
  readonly pinned: readonly string[];
}

/// Vero se `path` sta dentro `folder` (non è lei).
function under(path: string, folder: string): boolean {
  return path.startsWith(`${folder}/`);
}

/// Una voce di `existing` che dipende soltanto dal contenuto di `folder`: le
/// folder note possibili delle sue sottocartelle, due livelli sotto. Quella
/// della cartella stessa (un livello sotto) la chiede il livello di sopra.
function insideOnly(id: string, outside: Outside): boolean {
  return under(id, outside.folder) && id.slice(outside.folder.length + 1).includes("/") && !outside.pinned.includes(id);
}

/// Cosa il kernel ha risposto, in una stringa: due viste con la stessa impronta
/// disegnano lo stesso albero. Con `outside`, il contenuto di quella cartella
/// non entra: due viste con la stessa impronta disegnano lo stesso albero
/// **fuori** da lei.
export function signatureOf(v: View, sort: ExplorerSort, outside?: Outside): string {
  const shown = [...v.folders.entries()].filter(
    ([path]) => outside === undefined || (path !== outside.folder && !under(path, outside.folder)),
  );
  const folders = shown.map(
    ([path, c]) =>
      `${path}[${c.folders.map((f) => `${f.path}:${f.folders}:${f.entries}`).join(",")}][${c.notes.join(",")}][${c.files.join(",")}][${c.otherFolders}+${c.otherNote}]`,
  );
  // La data entra nell'impronta solo se è lei a decidere l'ordine: altrimenti
  // ogni salvataggio ridisegnerebbe l'albero per niente.
  const dated = sort.startsWith("modified") ? shown.map(([, c]) => JSON.stringify(c.mtimes ?? {})).join(";") : "";
  const existing = [...v.existing].filter((id) => outside === undefined || !insideOnly(id, outside));
  return `${folders.join(";")}|${existing.sort().join(",")}|${sort}|${dated}|${v.total}`;
}

/// Vero se da `before` a `after` è cambiato soltanto il contenuto di
/// `outside.folder`: aprirla o chiuderla non tocca nient'altro.
export function changedOnlyInside(before: View, after: View, sort: ExplorerSort, outside: Outside): boolean {
  return signatureOf(before, sort, outside) === signatureOf(after, sort, outside);
}
