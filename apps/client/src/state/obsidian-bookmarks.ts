// I segnalibri di Obsidian (`.obsidian/bookmarks.json`), portati nei segnalibri
// di Fub.
//
// Li legge l'host (`settings.import_obsidian`) e li consegna così come sono
// nell'esito: la forma dei segnalibri di Fub è della shell, e la traduzione
// vive qui, accanto allo store. Ogni voce di Obsidian ha una gemella — nota,
// heading, blocco, cartella, ricerca, pagina web, gruppo — tranne quelle che
// Fub non sa dire (il grafo di Obsidian, una specie nuova): quelle tornano per
// nome, mai in silenzio. Un gruppo dentro un gruppo diventa un gruppo suo,
// perché i gruppi di Fub non si annidano. Una voce che c'è già non si
// raddoppia, e un gruppo con lo stesso nome si riusa.
import {
  addBookmark,
  addGroup,
  listBookmarks,
  listGroups,
  loadBookmarks,
  setBookmarkGroup,
  type BookmarkTarget,
} from "./bookmarks";
import { asRecord } from "./guard";

/// Una voce tradotta: il titolo, dove porta e il gruppo che la contiene.
export interface ImportedBookmark {
  title: string;
  target: BookmarkTarget;
  group: string | null;
}

/// La traduzione: le voci che Fub sa dire e, per nome, quelle che no.
export interface BookmarkTranslation {
  entries: ImportedBookmark[];
  lost: string[];
}

/// Che cosa è successo allo store.
export interface BookmarkImport {
  added: number;
  same: number;
  lost: string[];
  /// Vero se lo store non accetta scritture (versione futura o rovinato).
  refused: boolean;
}

function text(v: unknown): string | null {
  return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
}

/// L'ultimo segmento di un path, senza `.md`.
function baseName(path: string): string {
  const last = path.split("/").filter(Boolean).pop() ?? path;
  return last.replace(/\.md$/i, "");
}

/// `#Titolo`, `#Capitolo#Sezione` o `#^blocco`: il punto della nota. Di un
/// heading annidato conta l'ultimo, come in un wikilink.
function anchor(subpath: string | null): { heading?: string; block?: string } {
  if (!subpath) return {};
  const last = subpath.split("#").filter((part) => part.trim() !== "").pop();
  if (!last) return {};
  if (last.startsWith("^")) return last.length > 1 ? { block: last.slice(1) } : {};
  return { heading: last.trim() };
}

function translateItem(item: unknown, group: string | null, out: BookmarkTranslation): void {
  const o = asRecord(item);
  const kind = o && typeof o.type === "string" ? o.type : "?";
  if (!o) {
    out.lost.push(kind);
    return;
  }
  const title = text(o.title);
  if (kind === "group") {
    const name = title ?? group;
    for (const child of Array.isArray(o.items) ? o.items : []) translateItem(child, name, out);
    return;
  }
  if (kind === "file") {
    const path = text(o.path);
    if (!path) return void out.lost.push(kind);
    const at = anchor(text(o.subpath));
    const point = at.heading ?? at.block;
    out.entries.push({
      title: title ?? (point ? `${baseName(path)} › ${point}` : baseName(path)),
      target: { k: "doc", doc: path, ...at },
      group,
    });
    return;
  }
  if (kind === "folder") {
    const path = typeof o.path === "string" ? o.path.replace(/\/+$/, "") : null;
    if (path === null) return void out.lost.push(kind);
    out.entries.push({ title: title ?? (baseName(path) || "/"), target: { k: "folder", path }, group });
    return;
  }
  if (kind === "search") {
    const query = text(o.query);
    if (!query) return void out.lost.push(kind);
    out.entries.push({ title: title ?? query, target: { k: "search", query }, group });
    return;
  }
  if (kind === "url") {
    const url = text(o.url);
    if (!url || !/^https?:\/\//i.test(url)) return void out.lost.push(kind);
    out.entries.push({ title: title ?? url, target: { k: "web", url }, group });
    return;
  }
  out.lost.push(title ? `${kind} «${title}»` : kind);
}

/// Dalle voci di `bookmarks.json` alle voci di Fub. Pura: non tocca lo store.
export function translateObsidianBookmarks(items: unknown): BookmarkTranslation {
  const out: BookmarkTranslation = { entries: [], lost: [] };
  if (!Array.isArray(items)) return out;
  for (const item of items) translateItem(item, null, out);
  return out;
}

function sameTarget(a: BookmarkTarget, b: BookmarkTarget): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/// Traduce e scrive nello store del vault aperto.
export async function importObsidianBookmarks(items: unknown): Promise<BookmarkImport> {
  const { entries, lost } = translateObsidianBookmarks(items);
  const load = await loadBookmarks();
  if (load.kind === "future" || load.kind === "corrupt") {
    return { added: 0, same: 0, lost, refused: entries.length > 0 };
  }
  const existing = listBookmarks();
  let added = 0;
  let same = 0;
  let refused = false;
  for (const entry of entries) {
    if (existing.some((b) => sameTarget(b.target, entry.target))) {
      same++;
      continue;
    }
    const made = addBookmark(entry.title, entry.target);
    if (!made) {
      refused = true;
      continue;
    }
    existing.push(made);
    added++;
    if (entry.group === null) continue;
    const group = listGroups().find((g) => g.title === entry.group) ?? addGroup(entry.group);
    if (group) setBookmarkGroup(made.id, group.id);
  }
  return { added, same, lost, refused };
}
