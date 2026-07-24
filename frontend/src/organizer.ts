// L'organizzazione del vault come la vede la sidebar: dai DocId piatti del
// kernel (path tipo `Progetti/Alpha.md`) all'albero di cartelle e note, con
// l'ordinamento scelto a mano nel sidecar (`WorkspaceMeta`). Solo logica: il
// DOM sta in main.ts, e il kernel non sa nulla di tutto questo.
import type { WorkspaceMeta } from "./api";

export interface FolderNode {
  /// L'ultimo segmento del path ("" per la radice del vault).
  name: string;
  /// Path relativo al vault, senza slash finale ("" per la radice).
  path: string;
  folders: FolderNode[];
  /// DocId completi delle note dirette (folder note inclusa: la nasconde chi disegna).
  notes: string[];
}

const collator = new Intl.Collator("it", { sensitivity: "base", numeric: true });

/// L'ultimo segmento di un path: `Progetti/Alpha.md` → `Alpha.md`.
export function childName(path: string): string {
  return path.split("/").pop() ?? path;
}

/// La cartella che contiene `path` ("" se sta nella radice).
export function parentOf(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash === -1 ? "" : path.slice(0, slash);
}

/// L'albero della sidebar, radicato in `rootPath` ("" = tutto il vault; una
/// cartella = quello spazio, e il resto del vault non esiste). Le cartelle
/// nascono dai path delle note, non dal filesystem — una cartella senza note
/// (dirette o discendenti) non c'è.
export function buildTree(docs: string[], meta: WorkspaceMeta, rootPath = ""): FolderNode {
  const prefix = rootPath ? `${rootPath}/` : "";
  const root: FolderNode = {
    name: rootPath ? childName(rootPath) : "",
    path: rootPath,
    folders: [],
    notes: [],
  };
  const byPath = new Map<string, FolderNode>([[rootPath, root]]);

  for (const id of docs) {
    if (prefix && !id.startsWith(prefix)) continue;
    const segs = id.slice(prefix.length).split("/");
    let dir = root;
    for (const seg of segs.slice(0, -1)) {
      const dirPath = dir.path ? `${dir.path}/${seg}` : seg;
      let next = byPath.get(dirPath);
      if (!next) {
        next = { name: seg, path: dirPath, folders: [], notes: [] };
        byPath.set(dirPath, next);
        dir.folders.push(next);
      }
      dir = next;
    }
    dir.notes.push(id);
  }
  sortNode(root, meta);
  return root;
}

/// Tutte le cartelle dell'albero (radice esclusa), in ordine di visita: è la
/// lista dei candidati a diventare uno spazio.
export function allFolders(root: FolderNode): FolderNode[] {
  const out: FolderNode[] = [];
  const visita = (node: FolderNode) => {
    for (const sub of node.folders) {
      out.push(sub);
      visita(sub);
    }
  };
  visita(root);
  return out;
}

/// Il nodo di una cartella dentro l'albero, o null se non esiste (più).
export function findFolder(root: FolderNode, path: string): FolderNode | null {
  if (root.path === path) return root;
  for (const sub of root.folders) {
    if (path === sub.path || path.startsWith(`${sub.path}/`)) {
      return findFolder(sub, path);
    }
  }
  return null;
}

/// La folder note di una cartella: `X/X.md`, o in mancanza `X/index.md`.
/// Cliccare la cartella apre questa nota, e la lista dei figli non la mostra.
export function folderNoteOf(folder: FolderNode): string | null {
  if (!folder.path) return null;
  const byLower = new Map(folder.notes.map((n) => [n.toLowerCase(), n]));
  return (
    byLower.get(`${folder.path}/${folder.name}.md`.toLowerCase()) ??
    byLower.get(`${folder.path}/index.md`.toLowerCase()) ??
    null
  );
}

/// I nomi dei figli di una cartella nell'ordine in cui la sidebar li mostra
/// (cartelle prima, poi note): è la lista da riscrivere in `meta.order` quando
/// un drag & drop sposta qualcosa.
export function orderedNames(folder: FolderNode): string[] {
  return [...folder.folders.map((f) => f.name), ...folder.notes.map(childName)];
}

function sortNode(node: FolderNode, meta: WorkspaceMeta) {
  const custom = meta.order[node.path] ?? [];
  node.folders.sort((a, b) => compareNames(a.name, b.name, custom));
  node.notes.sort((a, b) => compareNames(childName(a), childName(b), custom));
  for (const sub of node.folders) sortNode(sub, meta);
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
