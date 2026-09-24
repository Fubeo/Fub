// I segnalibri eterogenei (P06/F20): file, cartelle, ricerche, viste (grafo
// incluso), heading, blocchi, pagine web e gruppi, più il salvataggio di più
// tab. Le note appuntate restano nel sidecar del kernel; i vault preferiti e
// recenti restano nel registro di macchina: queste tre memorie non si
// mescolano, perché rispondono a tre domande diverse.
//
// Persistenza versionata nello stato di vista della shell (chiave
// `bookmarks`, per vault su questa macchina, come `history` e `palette`):
// envelope `{v, bookmarks, groups}` + ignoto preservato. Severa come
// `parseLayout`: un valore che non regge la forma vale come assente, futuro
// (`v > 1`) = sola lettura con fallback esplicito, mai riscrittura
// automatica. Nessuna rete, nessun provider chiamato, nessun lock tenuto.
import type { Tab } from "./layout";
import { readState, writeState, state } from "./store";
import { asRecord } from "./guard";

/// Versione dello schema scritto da questa shell.
export const BOOKMARKS_VERSION = 1;
/// Chiave dello stato di vista. Il vault lo mette lo store da sé.
export const BOOKMARKS_KEY = "bookmarks";

/// Dove porta un segnalibro. Riusa identità esistenti: DocId per i doc,
/// path senza slash finale per le cartelle, id di `ViewSpec` per le viste,
/// span in byte per heading/blocco (come `openWikilink`), query così come è
/// stata scritta per le ricerche, URL per le pagine web, `Tab[]` per il
/// salvataggio di più tab.
export type BookmarkTarget =
  | { k: "doc"; doc: string; heading?: string | null; block?: string | null }
  | { k: "folder"; path: string }
  | { k: "search"; query: string }
  | { k: "view"; view: string; params?: unknown }
  | { k: "web"; url: string }
  | { k: "tabs"; tabs: Tab[]; label?: string | null }
  | { k: "workspace"; workspace: string };

export interface Bookmark {
  id: string;
  title: string;
  target: BookmarkTarget;
  created: number;
  [k: string]: unknown;
}

export interface BookmarkGroup {
  id: string;
  title: string;
  bookmarkIds: string[];
  [k: string]: unknown;
}

export interface BookmarkStoreV1 {
  v: 1;
  bookmarks: Bookmark[];
  groups: BookmarkGroup[];
  quarantine?: { bookmarks: unknown[]; groups: unknown[] };
  [k: string]: unknown;
}

export type BookmarkLoad =
  | { kind: "ok"; store: BookmarkStoreV1 }
  | { kind: "empty" }
  | { kind: "corrupt"; raw: unknown }
  | { kind: "future"; version: number; raw: unknown };

let memory: BookmarkStoreV1 = { v: 1, bookmarks: [], groups: [] };
let status: BookmarkLoad["kind"] = "empty";
let rawFuture: unknown = null;
let futureVersion = 0;
let rawCorrupt: unknown = null;
let loadedVault = "";
let loadGeneration = 0;

function cleanString(v: unknown): string | null {
  return typeof v === "string" && v.trim() !== "" ? v : null;
}

/// Da JSON a target, o `null`. Severa: un doc vuoto, una tab rotta o una
/// specie sconosciuta valgono come voce rovinata, non come «apri niente».
/// Le viste restano opache (`params` qualunque): la validità la decide chi
/// le monta, che conosce le `ViewSpec` dichiarate.
export function parseBookmarkTarget(v: unknown): BookmarkTarget | null {
  const o = asRecord(v);
  if (!o) return null;
  if (o.k === "doc") {
    const doc = cleanString(o.doc);
    if (!doc) return null;
    const heading = o.heading === undefined || o.heading === null
      ? undefined
      : typeof o.heading === "string"
        ? o.heading
        : null;
    if (heading === null) return null;
    const block = o.block === undefined || o.block === null
      ? undefined
      : typeof o.block === "string"
        ? o.block
        : null;
    if (block === null) return null;
    return { k: "doc", doc, ...(heading ? { heading } : {}), ...(block ? { block } : {}) };
  }
  if (o.k === "folder") {
    const path = typeof o.path === "string" ? o.path : null;
    if (path === null) return null;
    return { k: "folder", path };
  }
  if (o.k === "search") {
    const query = cleanString(o.query);
    if (!query) return null;
    return { k: "search", query };
  }
  if (o.k === "view") {
    const view = cleanString(o.view);
    if (!view) return null;
    return { k: "view", view, ...(o.params === undefined ? {} : { params: o.params }) };
  }
  if (o.k === "web") {
    const url = cleanString(o.url);
    if (!url || !/^https?:\/\//i.test(url)) return null;
    return { k: "web", url };
  }
  if (o.k === "workspace") {
    const workspace = cleanString(o.workspace);
    return workspace ? { k: "workspace", workspace } : null;
  }
  if (o.k === "tabs") {
    if (!Array.isArray(o.tabs) || o.tabs.length === 0) return null;
    const tabs: Tab[] = [];
    for (const t of o.tabs) {
      const tab = parseTabRef(t);
      if (!tab) return null;
      tabs.push(tab);
    }
    const label = o.label === undefined || o.label === null
      ? undefined
      : typeof o.label === "string" && o.label.trim() !== ""
        ? o.label.trim()
        : null;
    if (label === null) return null;
    return { k: "tabs", tabs, ...(label ? { label } : {}) };
  }
  return null;
}

function parseTabRef(v: unknown): Tab | null {
  if (typeof v === "string") return v ? { k: "doc", doc: v } : null;
  const o = asRecord(v);
  if (!o) return null;
  const pinned = o.pinned === undefined || o.pinned === false
    ? {}
    : o.pinned === true
      ? { pinned: true as const }
      : null;
  if (!pinned) return null;
  const stack = o.stack === undefined
    ? {}
    : typeof o.stack === "string" && o.stack.trim() !== ""
      ? { stack: o.stack.trim() }
      : null;
  if (!stack) return null;
  if (o.k === "doc") {
    return typeof o.doc === "string" && o.doc ? { k: "doc", doc: o.doc, ...pinned, ...stack } : null;
  }
  if (o.k === "view") {
    return typeof o.view === "string" && o.view ? { k: "view", view: o.view, ...pinned, ...stack } : null;
  }
  return null;
}

function parseBookmark(v: unknown): Bookmark | null {
  const o = asRecord(v);
  if (!o) return null;
  const id = cleanString(o.id);
  const title = cleanString(o.title);
  const target = parseBookmarkTarget(o.target);
  if (!id || !title || !target) return null;
  const created = typeof o.created === "number" && Number.isFinite(o.created) ? o.created : Date.now();
  const { id: _i, title: _t, target: _g, created: _c, ...rest } = o;
  return { ...rest, id, title, target: { ...(o.target as Record<string, unknown>), ...target }, created };
}

function parseGroup(v: unknown): BookmarkGroup | null {
  const o = asRecord(v);
  if (!o) return null;
  const id = cleanString(o.id);
  const title = cleanString(o.title);
  if (!id || !title) return null;
  if (!Array.isArray(o.bookmarkIds)) return null;
  const ids = o.bookmarkIds.filter((e): e is string => typeof e === "string" && e !== "");
  if (ids.length !== o.bookmarkIds.length) return null;
  const { id: _i, title: _t, bookmarkIds: _b, ...rest } = o;
  return { id, title, bookmarkIds: ids, ...rest };
}

/// Da JSON allo store versionato, o `null`. `v > 1` non è un errore di
/// forma: è un futuro che questa shell non capisce, e va detto (`future`),
/// non migrato in silenzio.
export function parseBookmarkStore(v: unknown): BookmarkStoreV1 | null {
  const o = asRecord(v);
  if (!o) return null;
  if (o.v !== 1) return null;
  if (!Array.isArray(o.bookmarks) || !Array.isArray(o.groups)) return null;
  const bookmarks: Bookmark[] = [];
  const quarantine = {
    bookmarks: [] as unknown[],
    groups: [] as unknown[],
  };
  const old = asRecord(o.quarantine);
  if (Array.isArray(old?.bookmarks)) quarantine.bookmarks.push(...old.bookmarks);
  if (Array.isArray(old?.groups)) quarantine.groups.push(...old.groups);
  const bookmarkIds = new Set<string>();
  for (const b of o.bookmarks) {
    const parsed = parseBookmark(b);
    if (parsed && !bookmarkIds.has(parsed.id)) {
      bookmarkIds.add(parsed.id);
      bookmarks.push(parsed);
    } else quarantine.bookmarks.push(b);
  }
  const groups: BookmarkGroup[] = [];
  const groupIds = new Set<string>();
  for (const g of o.groups) {
    const parsed = parseGroup(g);
    if (parsed && !groupIds.has(parsed.id)) {
      groupIds.add(parsed.id);
      groups.push(parsed);
    } else quarantine.groups.push(g);
  }
  const { v: _v, bookmarks: _b, groups: _g, quarantine: _q, ...rest } = o;
  return { ...rest, v: 1, bookmarks, groups,
    ...(quarantine.bookmarks.length || quarantine.groups.length ? { quarantine } : {}) };
}

/// Rilegge dal disco senza mai riscrivere: assente = `empty`, futuro =
/// `future` (sola lettura), rotto = `corrupt`. La riscrittura automatica di
/// un futuro/corroto con un vuoto sarebbe la perdita che questo modulo
/// esiste per non fare.
export async function loadBookmarks(): Promise<BookmarkLoad> {
  const vault = state.vaultRoot;
  const generation = ++loadGeneration;
  if (vault !== loadedVault) {
    loadedVault = vault;
    memory = { v: 1, bookmarks: [], groups: [] };
    status = "empty";
  }
  const saved = await readState<unknown>(BOOKMARKS_KEY);
  if (generation !== loadGeneration || vault !== state.vaultRoot) return bookmarkLoadSnapshot();
  if (saved === null || saved === undefined) {
    memory = { v: 1, bookmarks: [], groups: [] };
    status = "empty";
    return { kind: "empty" };
  }
  const obj = asRecord(saved);
  if (obj && typeof obj.v === "number" && obj.v > BOOKMARKS_VERSION) {
    memory = { v: 1, bookmarks: [], groups: [] };
    status = "future";
    rawFuture = saved;
    futureVersion = obj.v;
    return { kind: "future", version: obj.v, raw: saved };
  }
  const parsed = parseBookmarkStore(saved);
  if (!parsed) {
    memory = { v: 1, bookmarks: [], groups: [] };
    status = "corrupt";
    rawCorrupt = saved;
    return { kind: "corrupt", raw: saved };
  }
  memory = parsed;
  status = "ok";
  return { kind: "ok", store: snapshot() };
}
export function bookmarkLoadSnapshot(): BookmarkLoad {
  if (status === "future") return { kind: "future", version: futureVersion, raw: rawFuture };
  if (status === "corrupt") return { kind: "corrupt", raw: rawCorrupt };
  if (status === "empty") return { kind: "empty" };
  return { kind: "ok", store: snapshot() };
}

function snapshot(): BookmarkStoreV1 {
  return {
    ...memory,
    bookmarks: memory.bookmarks.map((b) => ({ ...b, target: cloneTarget(b.target) })),
    groups: memory.groups.map((g) => ({ ...g, bookmarkIds: [...g.bookmarkIds] })),
  };
}

function cloneTarget(t: BookmarkTarget): BookmarkTarget {
  if (t.k === "tabs") return { ...t, tabs: t.tabs.map((tab) => ({ ...tab })) };
  return { ...t } as BookmarkTarget;
}

function persist(): void {
  if (status === "future" || status === "corrupt") return;
  loadGeneration++;
  const empty = memory.bookmarks.length === 0 && memory.groups.length === 0
    && !memory.quarantine?.bookmarks.length && !memory.quarantine?.groups.length;
  writeState(BOOKMARKS_KEY, empty ? null : memory);
  if (empty) status = "empty";
  else status = "ok";
}

function makeId(prefix: string): string {
  const rand = typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID().slice(0, 8)
    : Math.floor(Math.random() * 0xffffff).toString(36);
  return `${prefix}-${Date.now().toString(36)}-${rand}`;
}

/// Lo stato dell'ultimo `loadBookmarks`, per chi disegna senza rileggere.
export function bookmarkStatus(): BookmarkLoad["kind"] {
  return status;
}

export function listBookmarks(): Bookmark[] {
  return snapshot().bookmarks;
}

export function listGroups(): BookmarkGroup[] {
  return snapshot().groups;
}

export function addBookmark(title: string, target: BookmarkTarget): Bookmark | null {
  if (status === "future" || status === "corrupt") return null;
  const clean = title.trim();
  if (!clean) return null;
  const bookmark: Bookmark = { id: makeId("b"), title: clean, target: cloneTarget(target), created: Date.now() };
  memory.bookmarks.push(bookmark);
  persist();
  return bookmark;
}

/// Salva le tab aperte come un segnalibro solo (F20): il gruppo resta dove
/// sta, le sessioni restano uniche — qui si ricordano identità, non testi.
export function saveTabsAsBookmark(title: string, tabs: Tab[]): Bookmark | null {
  const clean = tabs.filter((t) =>
    (t.k === "doc" && t.doc) || (t.k === "view" && t.view),
  );
  if (clean.length === 0) return null;
  return addBookmark(title, { k: "tabs", tabs: clean.map((t) => ({ ...t })) });
}

export function removeBookmark(id: string): boolean {
  if (status === "future" || status === "corrupt") return false;
  if (!memory.bookmarks.some((b) => b.id === id)) return false;
  memory.bookmarks = memory.bookmarks.filter((b) => b.id !== id);
  memory.groups = memory.groups.map((g) => ({ ...g, bookmarkIds: g.bookmarkIds.filter((b) => b !== id) }));
  persist();
  return true;
}

export function renameBookmark(id: string, title: string): boolean {
  if (status === "future" || status === "corrupt") return false;
  const clean = title.trim();
  if (!clean) return false;
  let touched = false;
  memory.bookmarks = memory.bookmarks.map((b) => {
    if (b.id !== id) return b;
    touched = true;
    return { ...b, title: clean };
  });
  if (touched) persist();
  return touched;
}

/// Riordina un segnalibro dentro l'elenco: lo toglie da dove sta e lo
/// rimette a `to`. Come `moveTab`: oltre il ricalcolo non cambia niente.
export function moveBookmark(id: string, to: number): boolean {
  const from = memory.bookmarks.findIndex((b) => b.id === id);
  if (from < 0 || to < 0 || to >= memory.bookmarks.length || from === to) return false;
  if (status === "future" || status === "corrupt") return false;
  const list = [...memory.bookmarks];
  const [item] = list.splice(from, 1);
  list.splice(to, 0, item!);
  memory.bookmarks = list;
  persist();
  return true;
}

export function addGroup(title: string): BookmarkGroup | null {
  if (status === "future" || status === "corrupt") return null;
  const clean = title.trim();
  if (!clean) return null;
  const group: BookmarkGroup = { id: makeId("g"), title: clean, bookmarkIds: [] };
  memory.groups = [...memory.groups, group];
  persist();
  return group;
}

export function removeGroup(id: string): boolean {
  if (status === "future" || status === "corrupt") return false;
  if (!memory.groups.some((g) => g.id === id)) return false;
  memory.groups = memory.groups.filter((g) => g.id !== id);
  persist();
  return true;
}

export function renameGroup(id: string, title: string): boolean {
  if (status === "future" || status === "corrupt") return false;
  const clean = title.trim();
  if (!clean) return false;
  let touched = false;
  memory.groups = memory.groups.map((g) => {
    if (g.id !== id) return g;
    touched = true;
    return { ...g, title: clean };
  });
  if (touched) persist();
  return touched;
}

export function setBookmarkGroup(bookmarkId: string, groupId: string | null): boolean {
  if (status === "future" || status === "corrupt") return false;
  if (!memory.bookmarks.some((b) => b.id === bookmarkId)) return false;
  if (groupId !== null && !memory.groups.some((g) => g.id === groupId)) return false;
  memory.groups = memory.groups.map((g) => {
    if (groupId !== null && g.id === groupId) {
      return g.bookmarkIds.includes(bookmarkId)
        ? g
        : { ...g, bookmarkIds: [...g.bookmarkIds, bookmarkId] };
    }
    return g.bookmarkIds.includes(bookmarkId)
      ? { ...g, bookmarkIds: g.bookmarkIds.filter((b) => b !== bookmarkId) }
      : g;
  });
  persist();
  return true;
}

/// Solo per i banchi: rilegge la memoria senza toccare il disco.
export function setBookmarksForTest(store: BookmarkStoreV1): void {
  memory = parseBookmarkStore(store) ?? { v: 1, bookmarks: [], groups: [] };
  status = memory.bookmarks.length === 0 && memory.groups.length === 0
    && !memory.quarantine?.bookmarks.length && !memory.quarantine?.groups.length ? "empty" : "ok";
}

export function futureRawForTest(): { version: number; raw: unknown } {
  return { version: futureVersion, raw: rawFuture };
}
