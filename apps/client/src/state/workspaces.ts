// I workspace nominati versionati (P06/F22): save/load/update/rename/delete
// di assetti reali della shell — albero riquadri, tab con pin/stack,
// cronologia avanti/indietro, link fra riquadri, modi, expanded, spazio
// attivo — con fallback esplicito per riferimenti mancanti e plugin
// disabilitati. Il layout anonimo «com'era la finestra» resta in
// `state/layout.ts` (chiave `layout`, macchina); i workspace nominati sono
// un’altra cosa: hanno un nome, una versione, e si scelgono.
//
// Persistenza versionata nello stato di vista (chiave `workspaces`, per
// vault su questa macchina): envelope `{v, workspaces}` + ignoto preservato.
// L'envelope incomprensibile è sola lettura; gli elementi danneggiati invece
// vanno in `quarantine` senza nascondere i workspace e i riquadri sani.
// Ogni tab ripristinata si verifica contro i documenti esistenti e le view
// dichiarate. Nessuna rete, nessun lock tenuto.
import type { Layout, PaneHistory, Tab } from "./layout";
import { HISTORY_LIMIT, parseLayout, renameInLayout } from "./layout";
import { existingDocuments } from "../host/query";
import { readState, writeState, state } from "./store";
import { asRecord } from "./guard";
import { parseShellGeometry, type ShellGeometry } from "./shell-geometry";

/// Versione dello schema scritto da questa shell.
export const WORKSPACES_VERSION = 1;
/// Chiave dello stato di vista. Il vault lo mette lo store da sé.
export const WORKSPACES_KEY = "workspaces";

export interface WorkspaceEntry {
  id: string;
  name: string;
  layout: Layout;
  expanded: string[];
  activeSpace: string | null;
  geometry?: ShellGeometry;
  updated: number;
  [k: string]: unknown;
}

export interface WorkspaceStoreV1 {
  v: 1;
  workspaces: WorkspaceEntry[];
  // Invalid entries and fields stay available for repair and survive writes.
  quarantine?: unknown[];
  [k: string]: unknown;
}

export type WorkspaceLoad =
  | { kind: "ok"; store: WorkspaceListSnapshot }
  | { kind: "empty" }
  | { kind: "corrupt"; raw: unknown }
  | { kind: "future"; version: number; raw: unknown };

export interface WorkspaceListSnapshot {
  workspaces: Array<Pick<WorkspaceEntry, "id" | "name" | "expanded" | "activeSpace" | "updated"> & { tabs: number; panes: number }>;
}

export interface WorkspaceApplyReport {
  id: string;
  name: string;
  /// Tab documento scartate perché il doc non esiste più.
  missingDocs: string[];
  /// Tab view tenute ma senza provider dichiarato (fallback per id).
  undeclaredViews: string[];
  /// Cronologia potata per gli stessi motivi.
  prunedHistory: number;
  panes: number;
  tabs: number;
}

function cloneLayout(l: Layout): Layout {
  return JSON.parse(JSON.stringify(l)) as Layout;
}

function cleanName(v: unknown): string | null {
  return typeof v === "string" && v.trim() !== "" ? v.trim().slice(0, 80) : null;
}

function cleanId(v: unknown): string | null {
  return typeof v === "string" && v.trim() !== "" ? v : null;
}
// A malformed tab, history item or split does not cost the other panes.
// Probe each piece with the canonical layout parser rather than maintaining
// another tab grammar here; retain rejected source fragments for repair.
function salvageLayout(raw: unknown, workspace: string, rejected: unknown[]): Layout | null {
  const original = asRecord(raw);
  const rawPanes = asRecord(original?.panes);
  if (!rawPanes) return null;
  const panes: Layout["panes"] = {};
  for (const [paneId, value] of Object.entries(rawPanes)) {
    const source = asRecord(value);
    const tabs = Array.isArray(source?.tabs) ? source.tabs : Array.isArray(source?.docs) ? source.docs : null;
    if (!tabs) {
      rejected.push({ workspace, pane: paneId, invalid: value });
      continue;
    }
    const probe = (tab: unknown): Tab | null => {
      const parsed = parseLayout({
        tree: { k: "leaf", pane: paneId },
        panes: { [paneId]: { tabs: [tab], active: 0, modes: source?.modes, mode: source?.mode } },
        focus: paneId,
      });
      return parsed?.panes[paneId]?.tabs[0] ?? null;
    };
    const good: Tab[] = [];
    let active = -1;
    for (const [index, tab] of tabs.entries()) {
      const valid = probe(tab);
      if (!valid) rejected.push({ workspace, pane: paneId, tab });
      else {
        if (index === source?.active) active = good.length;
        good.push(valid);
      }
    }
    let history: PaneHistory | undefined;
    const sourceHistory = asRecord(source?.history);
    if (source?.history !== undefined) {
      if (!sourceHistory || !Array.isArray(sourceHistory.past) || !Array.isArray(sourceHistory.future)) {
        rejected.push({ workspace, pane: paneId, history: source?.history });
      } else {
        const past: Tab[] = [];
        const future: Tab[] = [];
        for (const [where, out] of [["past", past], ["future", future]] as const) {
          for (const item of sourceHistory[where] as unknown[]) {
            const valid = probe(item);
            if (valid) out.push(valid);
            else rejected.push({ workspace, pane: paneId, history: { [where]: item } });
          }
        }
        history = { past: past.slice(-HISTORY_LIMIT), future: future.slice(-HISTORY_LIMIT) };
      }
    }
    const candidate = {
      tabs: good,
      active: good.length === 0 ? -1 : active >= 0 ? active : 0,
      modes: source?.modes,
      mode: source?.mode,
      ...(history ? { history } : {}),
      ...(source?.link !== undefined ? { link: source.link } : {}),
    };
    let parsed = parseLayout({ tree: { k: "leaf", pane: paneId }, panes: { [paneId]: candidate }, focus: paneId });
    if (!parsed && source?.link !== undefined) {
      rejected.push({ workspace, pane: paneId, link: source.link });
      delete candidate.link;
      parsed = parseLayout({ tree: { k: "leaf", pane: paneId }, panes: { [paneId]: candidate }, focus: paneId });
    }
    if (parsed) panes[paneId] = parsed.panes[paneId]!;
    else rejected.push({ workspace, pane: paneId, invalid: value });
  }
  const seen = new Set<string>();
  const prune = (value: unknown): Layout["tree"] | null => {
    const node = asRecord(value);
    if (node?.k === "leaf" && typeof node.pane === "string" && panes[node.pane] && !seen.has(node.pane)) {
      seen.add(node.pane);
      return { k: "leaf", pane: node.pane };
    }
    if (node?.k === "split" && (node.dir === "row" || node.dir === "col") && Array.isArray(node.children)) {
      const children = node.children.map(prune).filter((child): child is Layout["tree"] => child !== null);
      if (children.length > 1) return { k: "split", dir: node.dir, children };
      if (children.length === 1) return children[0]!;
    }
    rejected.push({ workspace, tree: value });
    return null;
  };
  const tree = prune(original?.tree);
  const remaining = Object.keys(panes).filter((id) => !seen.has(id));
  if (tree && remaining.length) rejected.push({ workspace, tree: original?.tree });
  const children: Layout["tree"][] = [
    ...(tree ? [tree] : []),
    ...remaining.map((pane): Layout["tree"] => ({ k: "leaf", pane })),
  ];
  const recovered: Layout["tree"] | null = children.length > 1
    ? { k: "split", dir: "row", children }
    : children[0] ?? null;
  if (!recovered) return null;
  const ids = [...seen, ...remaining];
  const validPanes = Object.fromEntries(ids.map((id) => [id, panes[id]!]));
  const focus = typeof original?.focus === "string" && ids.includes(original.focus) ? original.focus : ids[0]!;
  if (focus !== original?.focus) rejected.push({ workspace, focus: original?.focus });
  return parseLayout({ tree: recovered, panes: validPanes, focus });
}


function parseEntry(v: unknown): { entry: WorkspaceEntry; rejected: unknown[] } | null {
  const o = asRecord(v);
  if (!o) return null;
  const id = cleanId(o.id);
  const name = typeof o.name === "string" && o.name.trim() !== "" ? o.name : null;
  if (!id || !name) return null;
  const rejected: unknown[] = [];
  const layout = parseLayout(o.layout) ?? salvageLayout(o.layout, id, rejected);
  if (!layout) return null;
  const expanded = Array.isArray(o.expanded)
    ? o.expanded.filter((e): e is string => typeof e === "string")
    : [];
  if (!Array.isArray(o.expanded) || expanded.length !== o.expanded.length)
    rejected.push({ workspace: id, expanded: o.expanded });
  const activeSpace = o.activeSpace === null || o.activeSpace === undefined
    ? null
    : typeof o.activeSpace === "string" ? o.activeSpace : null;
  if (o.activeSpace !== null && o.activeSpace !== undefined && typeof o.activeSpace !== "string")
    rejected.push({ workspace: id, activeSpace: o.activeSpace });
  const updated = typeof o.updated === "number" && Number.isFinite(o.updated) ? o.updated : Date.now();
  if (updated !== o.updated) rejected.push({ workspace: id, updated: o.updated });
  const { geometry, rejected: badGeometry } = o.geometry === undefined
    ? { geometry: undefined, rejected: {} }
    : parseShellGeometry(o.geometry);
  if (Object.keys(badGeometry).length) rejected.push({ workspace: id, geometry: badGeometry });
  const { id: _i, name: _n, layout: _l, expanded: _e, activeSpace: _a, updated: _u, geometry: _g, ...rest } = o;
  return {
    entry: {
      ...rest, id, name, layout: cloneLayout(layout), expanded: [...expanded],
      activeSpace: activeSpace === "" ? null : activeSpace, updated,
      ...(geometry ? { geometry } : {}),
    },
    rejected,
  };
}


/// Da JSON allo store versionato, o `null`. Mantiene l’ignoto per-chiave
/// (`...rest`) per migrazioni future: ciò che non si capisce si conserva,
// non si riscrive né si butta.
export function parseWorkspaceStore(v: unknown): WorkspaceStoreV1 | null {
  const o = asRecord(v);
  if (!o || o.v !== 1 || !Array.isArray(o.workspaces)) return null;
  const workspaces: WorkspaceEntry[] = [];
  const quarantine: unknown[] = Array.isArray(o.quarantine) ? [...o.quarantine]
    : o.quarantine === undefined ? [] : [{ quarantine: o.quarantine }];
  const seen = new Set<string>();
  for (const e of o.workspaces) {
    const parsed = parseEntry(e);
    if (!parsed || seen.has(parsed.entry.id)) {
      quarantine.push(e);
      continue;
    }
    seen.add(parsed.entry.id);
    workspaces.push(parsed.entry);
    quarantine.push(...parsed.rejected);
  }
  const { v: _v, workspaces: _w, quarantine: _q, ...rest } = o;
  return { ...rest, v: 1, workspaces, ...(quarantine.length ? { quarantine } : {}) };
}

let memory: WorkspaceStoreV1 = { v: 1, workspaces: [] };
let status: WorkspaceLoad["kind"] = "empty";
let futureVersion = 0;
let rawFuture: unknown = null;
let rawCorrupt: unknown = null;
let loadedVault = "";
let loadGeneration = 0;
/// Le rinomine arrivate mentre lo store si stava rileggendo: la lettura in volo
/// porta gli id di prima, e la lettura che vince le applica appena arriva.
let loadsInFlight = 0;
let renamedDuringLoad: Array<readonly [string, string]> = [];

function snapshotList(): WorkspaceListSnapshot {
  return {
    workspaces: memory.workspaces.map((w) => ({
      id: w.id,
      name: w.name,
      expanded: [...w.expanded],
      activeSpace: w.activeSpace,
      updated: w.updated,
      tabs: Object.values(w.layout.panes).reduce((n, p) => n + p.tabs.length, 0),
      panes: Object.keys(w.layout.panes).length,
    })),
  };
}

function persist(): void {
  if (status === "future" || status === "corrupt") return;
  loadGeneration++;
  if (memory.workspaces.length === 0 && !memory.quarantine?.length) {
    writeState(WORKSPACES_KEY, null);
    status = "empty";
    return;
  }
  writeState(WORKSPACES_KEY, memory);
  status = "ok";
}

function makeId(prefix: string): string {
  const rand = typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID().slice(0, 8)
    : Math.floor(Math.random() * 0xffffff).toString(36);
  return `${prefix}-${Date.now().toString(36)}-${rand}`;
}

export async function loadWorkspaces(): Promise<WorkspaceLoad> {
  const vault = state.vaultRoot;
  const generation = ++loadGeneration;
  if (vault !== loadedVault) {
    loadedVault = vault;
    memory = { v: 1, workspaces: [] };
    status = "empty";
    renamedDuringLoad = [];
  }
  loadsInFlight++;
  let saved: unknown;
  try {
    saved = await readState<unknown>(WORKSPACES_KEY);
  } finally {
    loadsInFlight--;
  }
  const renamed = renamedDuringLoad;
  if (loadsInFlight === 0) renamedDuringLoad = [];
  if (generation !== loadGeneration || vault !== state.vaultRoot) return workspaceLoadSnapshot();
  if (saved === null || saved === undefined) {
    memory = { v: 1, workspaces: [] };
    status = "empty";
    return { kind: "empty" };
  }
  const obj = asRecord(saved);
  if (obj && typeof obj.v === "number" && obj.v > WORKSPACES_VERSION) {
    memory = { v: 1, workspaces: [] };
    status = "future";
    futureVersion = obj.v;
    rawFuture = saved;
    return { kind: "future", version: obj.v, raw: saved };
  }
  const parsed = parseWorkspaceStore(saved);
  if (!parsed) {
    memory = { v: 1, workspaces: [] };
    status = "corrupt";
    rawCorrupt = saved;
    return { kind: "corrupt", raw: saved };
  }
  memory = parsed;
  status = "ok";
  let touched = false;
  for (const [from, to] of renamed) touched = renameInMemory(from, to) || touched;
  if (touched) persist();
  return { kind: "ok", store: snapshotList() };
}

function renameInMemory(from: string, to: string): boolean {
  let touched = false;
  for (const workspace of memory.workspaces) touched = renameInLayout(from, to, workspace.layout) || touched;
  return touched;
}

/// Una nota rinominata segue anche nei workspace salvati, con la regola del
/// layout vivo: schede e cronologia che la nominavano nominano il nuovo id.
/// Senza, ripristinare il workspace scarterebbe la scheda come mancante mentre
/// la nota c'è (ADR 0188: una rinomina aggiorna chi tiene stato per documento).
/// Una scrittura sola per tutti i workspace toccati; `updated` resta quello
/// dell'utente, perché l'assetto non l'ha cambiato lui.
export function renameInWorkspaces(from: string, to: string): boolean {
  if (loadsInFlight > 0) renamedDuringLoad.push([from, to]);
  if (status !== "ok") return false;
  const touched = renameInMemory(from, to);
  if (touched) persist();
  return touched;
}
export function workspaceLoadSnapshot(): WorkspaceLoad {
  if (status === "future") return { kind: "future", version: futureVersion, raw: rawFuture };
  if (status === "corrupt") return { kind: "corrupt", raw: rawCorrupt };
  if (status === "empty") return { kind: "empty" };
  return { kind: "ok", store: snapshotList() };
}

export function workspaceStatus(): WorkspaceLoad["kind"] {
  return status;
}

export function futureWorkspaceForTest(): { version: number; raw: unknown } {
  return { version: futureVersion, raw: rawFuture };
}

export function setWorkspacesForTest(store: WorkspaceStoreV1): void {
  memory = parseWorkspaceStore(store) ?? { v: 1, workspaces: [] };
  status = memory.workspaces.length === 0 && !memory.quarantine?.length ? "empty" : "ok";
}

export function getWorkspace(id: string): WorkspaceEntry | null {
  const found = memory.workspaces.find((w) => w.id === id);
  return found
    ? { ...found, layout: cloneLayout(found.layout), expanded: [...found.expanded],
        ...(found.geometry ? { geometry: structuredClone(found.geometry) } : {}) }
    : null;
}

/// Salva l’assetto corrente con un nome (F22): il layout reale, non un
/// riassunto. Nomi duplicati: l’ultimo vince sull’id più vecchio con lo
/// stesso nome? No — i nomi possono ripetersi, gli id no: la scelta avviene
/// per nome+data, mai per sovrascrittura silenziosa.
export function saveWorkspace(
  name: string,
  layout: Layout,
  expanded: string[],
  activeSpace: string | null,
  geometry?: ShellGeometry,
): WorkspaceEntry | null {
  if (status === "future" || status === "corrupt") return null;
  const clean = cleanName(name);
  if (!clean) return null;
  const entry: WorkspaceEntry = {
    id: makeId("w"),
    name: clean,
    layout: cloneLayout(layout),
    expanded: [...expanded],
    activeSpace,
    updated: Date.now(),
    ...(geometry ? { geometry: structuredClone(geometry) } : {}),
  };
  memory.workspaces.push(entry);
  persist();
  return { ...entry, layout: cloneLayout(entry.layout), expanded: [...entry.expanded] };
}

/// Aggiorna i dati di un workspace esistente con l’assetto corrente.
export function updateWorkspace(
  id: string,
  layout: Layout,
  expanded: string[],
  activeSpace: string | null,
  geometry?: ShellGeometry,
): WorkspaceEntry | null {
  if (status === "future" || status === "corrupt") return null;
  let touched = false;
  memory.workspaces = memory.workspaces.map((w) => {
    if (w.id !== id) return w;
    touched = true;
    return { ...w, layout: cloneLayout(layout), expanded: [...expanded], activeSpace,
      ...(geometry ? { geometry: structuredClone(geometry) } : {}), updated: Date.now() };
  });
  if (!touched) return null;
  persist();
  return getWorkspace(id);
}

export function renameWorkspace(id: string, name: string): boolean {
  if (status === "future" || status === "corrupt") return false;
  const clean = cleanName(name);
  if (!clean) return false;
  let touched = false;
  memory.workspaces = memory.workspaces.map((w) => {
    if (w.id !== id) return w;
    touched = true;
    return { ...w, name: clean, updated: Date.now() };
  });
  if (touched) persist();
  return touched;
}

export function deleteWorkspace(id: string): boolean {
  if (status === "future" || status === "corrupt") return false;
  if (!memory.workspaces.some((w) => w.id === id)) return false;
  memory.workspaces = memory.workspaces.filter((w) => w.id !== id);
  persist();
  return true;
}

/// Applica un workspace al layout live con fallback esplicito: i doc che
/// non esistono più escono dalle tab (e dalla history), le view senza
/// provider restano come fallback per id (brutte, non bugiarde). Il layout
/// corrente non si tocca finché il report non è pronto: chi chiama decide
/// se applicare o mostrare prima il conto. `declareView` dice quali view
/// sono montabili adesso; assente = nessuna è dichiarata.
export async function applyWorkspace(
  id: string,
  _live: Layout,
  declareView?: (view: string) => boolean,
): Promise<{ layout: Layout; geometry?: ShellGeometry; report: WorkspaceApplyReport } | null> {
  const entry = getWorkspace(id);
  if (!entry) return null;
  const docs = new Set<string>();
  for (const pane of Object.values(entry.layout.panes)) {
    for (const tab of pane.tabs) {
      if (tab.k === "doc") docs.add(tab.doc);
    }
    for (const past of pane.history?.past ?? []) {
      if (past.k === "doc") docs.add(past.doc);
    }
    for (const future of pane.history?.future ?? []) {
      if (future.k === "doc") docs.add(future.doc);
    }
  }
  const existing = docs.size > 0 ? await existingDocuments([...docs]) : new Set<string>();
  const missingDocs: string[] = [];
  const undeclaredViews: string[] = [];
  let prunedHistory = 0;
  const keepTab = (t: Tab): Tab | null => {
    if (t.k === "doc") {
      if (!existing.has(t.doc)) {
        missingDocs.push(t.doc);
        return null;
      }
      return t;
    }
    if (declareView && !declareView(t.view) && !undeclaredViews.includes(t.view)) {
      undeclaredViews.push(t.view);
    }
    return t;
  };
  const layout: Layout = cloneLayout(entry.layout);
  let tabs = 0;
  for (const pane of Object.values(layout.panes)) {
    const previous = pane.tabs;
    const kept: Tab[] = [];
    let activeIndex = -1;
    for (const [index, tab] of previous.entries()) {
      const next = keepTab(tab);
      if (next) {
        if (index === pane.active) activeIndex = kept.length;
        kept.push(next);
      }
    }
    pane.tabs = kept;
    pane.active = kept.length === 0 ? -1 : activeIndex >= 0 ? activeIndex : 0;
    if (pane.history) {
      const past: Tab[] = [];
      for (const t of pane.history.past) {
        const next = keepTab(t);
        if (next) past.push(next);
        else prunedHistory += 1;
      }
      const future: Tab[] = [];
      for (const t of pane.history.future) {
        const next = keepTab(t);
        if (next) future.push(next);
        else prunedHistory += 1;
      }
      pane.history = { past, future } as PaneHistory;
    }
    tabs += kept.length;
  }
  // A saved workspace replaces the live layout only after every reference has
  // been checked; callers keep the live layout unchanged on failure.
  return {
    layout,
    ...(entry.geometry ? { geometry: entry.geometry } : {}),
    report: {
      id: entry.id,
      name: entry.name,
      missingDocs: [...new Set(missingDocs)],
      undeclaredViews,
      prunedHistory,
      panes: Object.keys(layout.panes).length,
      tabs,
    },
  };
}
