// L'organizzazione del vault come la vede la sidebar: **un livello per volta**,
// con l'ordinamento scelto a mano nel sidecar (`Organization`). Solo logica: il
// DOM sta in `panels/explorer.ts`.
//
// L'albero non si costruisce più qui (§14.3, §14.4). Prima `buildTree` prendeva
// l'intero elenco delle note e ne ricavava cartelle e gerarchia: era l'unico
// posto in cui una cartella esistesse, quindi una cartella vuota non c'era e una
// rimasta vuota spariva da sola. Adesso le cartelle le tiene il kernel e si
// chiedono per livello (`contenutoDiCartella`); qui resta ciò che il kernel non
// sa — in che **ordine** l'utente vuole vedere i fratelli, e qual è la nota che
// una cartella apre.
import type { Organization, VaultFolder } from "../host/contract";
// Le regole che hanno una gemella Rust stanno in un file solo, e da lì le
// riprende chiunque: qui servono il nome pagina e la chiave di risoluzione.
import { childName, pageName, resolutionKey } from "./mirrored";

export { childName, pageName };

/// Cosa c'è **direttamente** dentro una cartella: ciò che disegna un livello.
export interface FolderContent {
  /// Path relativo al vault, senza slash finale ("" per la radice).
  path: string;
  /// Le sottocartelle dirette, col conto di cosa contengono.
  folders: VaultFolder[];
  /// DocId completi delle note dirette (folder note inclusa: la nasconde chi
  /// disegna).
  notes: string[];
  /// Quante ne ha lasciate fuori la finestra (§2.9): un livello troncato **si
  /// dice**, e per dirlo bisogna portarselo fin qui. Zero è il caso normale.
  otherFolders: number;
  otherNote: number;
}

/// Quante voci di un livello l'albero chiede e disegna (§2.9).
///
/// Duecento, e il numero è **il costo di un ridisegno**, non una stima di
/// quanto sia grande una cartella. L'albero si ricostruisce intero a ogni
/// cambiamento (`renderFileList`), e ogni voce costa tre elementi e sette
/// ascoltatori: senza un tetto, il prezzo di un salvataggio in una cartella da
/// tremila note sono novemila elementi creati e buttati — cioè il §24.1 («vault
/// enormi») rotto dalla UI prima che il kernel se ne accorga.
///
/// **La finestra non è virtualizzazione.** Virtualizzare vuol dire disegnare
/// ciò che si vede, e *cosa si vede* è una domanda di layout; questa è la metà
/// che sta prima del layout — quanto attraversa il ponte e quanti elementi
/// nascono — ed è la metà che si conta (`ridisegno.test.ts`). Ciò che resta
/// fuori si dice, non si tace: `altreNote`/`altreCartelle`.
export const LEVEL_PAGE = { offset: 0, limit: 200 };

const collator = new Intl.Collator("it", { sensitivity: "base", numeric: true });

/// La cartella che contiene `path` ("" se sta nella radice).
export function parentOf(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash === -1 ? "" : path.slice(0, slash);
}

/// Lo stesso contenuto, nell'ordine in cui la sidebar lo mostra: prima chi
/// compare nell'ordine scelto a mano, poi gli altri in alfabetico.
export function sortContent(content: FolderContent, meta: Organization): FolderContent {
  const custom = meta.order[content.path] ?? [];
  return {
    path: content.path,
    folders: [...content.folders].sort((a, b) =>
      compareNames(childName(a.path), childName(b.path), custom),
    ),
    notes: [...content.notes].sort((a, b) => compareNames(childName(a), childName(b), custom)),
    otherFolders: content.otherFolders,
    otherNote: content.otherNote,
  };
}

/// La folder note di una cartella: `X/X.<ext>`, o in mancanza `X/index.<ext>`.
/// Cliccare la cartella apre questa nota, e la lista dei figli non la mostra.
///
/// `exts` sono le estensioni che i provider registrati gestiscono
/// (`VaultInfo.extensions`): quale sia l'estensione di una nota lo sanno i
/// `FormatDescriptor` del backend, non la UI. Cablare `.md` qui sarebbe vero solo
/// finché markdown è l'unico formato, cioè finché il progetto non fa ciò per cui
/// esiste.
export function folderNoteOf(content: FolderContent, exts: string[]): string | null {
  // `resolutionKey` e non `toLowerCase()`: è la chiave con cui il kernel decide
  // che due nomi sono lo stesso nome, e su un vault sincronizzato con macOS
  // (nomi file in NFD) il solo minuscolo non farebbe incontrare `Città/Città.md`
  // con sé stessa.
  const byKey = new Map(content.notes.map((n) => [resolutionKey(n), n]));
  // Prima il nome della cartella, poi `index`: l'omonima vince, come in make.md.
  for (const candidate of folderNoteCandidates(content.path, exts)) {
    const hit = byKey.get(resolutionKey(candidate));
    if (hit) return hit;
  }
  return null;
}

/// I path che **potrebbero** essere la folder note di una cartella, in ordine di
/// preferenza: prima l'omonima, poi `index`, e per ciascuna le estensioni
/// registrate nell'ordine in cui il backend le dichiara.
///
/// Esiste perché la stessa regola serve a due domande diverse: «qual è la
/// folder note di questa cartella, che ho in mano?» ([`folderNoteOf`]) e «quali
/// di queste cartelle, che non ho aperto, ne hanno una?» — la seconda si fa
/// chiedendo al kernel quali di questi path esistono, in una domanda sola,
/// invece di caricare il contenuto di ogni cartella per guardarci dentro.
export function folderNoteCandidates(path: string, exts: string[]): string[] {
  if (!path) return [];
  const out: string[] = [];
  for (const stem of [childName(path), "index"]) {
    for (const ext of exts) out.push(`${path}/${stem}.${ext}`);
  }
  return out;
}

/// La folder note di una cartella, fra i documenti che si sa esistere.
export function folderNoteIn(
  path: string,
  exts: string[],
  existing: ReadonlySet<string>,
): string | null {
  return folderNoteCandidates(path, exts).find((c) => existing.has(c)) ?? null;
}

/// I nomi dei figli di una cartella nell'ordine in cui la sidebar li mostra
/// (cartelle prima, poi note): è la lista da riscrivere in `meta.order` quando
/// un drag & drop sposta qualcosa.
export function orderedNames(content: FolderContent): string[] {
  return [
    ...content.folders.map((f) => childName(f.path)),
    ...content.notes.map((n) => childName(n)),
  ];
}

/// Prima chi compare nell'ordine scelto a mano, nella sua posizione; poi gli
/// altri, in alfabetico. Così una lista d'ordine parziale (o invecchiata) non
/// fa mai sparire nessuno.
function compareNames(a: string, b: string, custom: string[]): number {
  const pa = custom.indexOf(a);
  const pb = custom.indexOf(b);
  if (pa !== -1 && pb !== -1) return pa - pb;
  if (pa !== -1) return -1;
  if (pb !== -1) return 1;
  return collator.compare(a, b);
}
