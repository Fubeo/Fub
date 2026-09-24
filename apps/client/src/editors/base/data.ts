// `.base` uses the generic query and command registries. The definition is
// source text; notes and their indexed properties remain the authoritative data.
import { EVERY_DOCUMENT, type DocumentMatch, type Excerpts, type IndexQuery, type IndexResult, type InvokeMode, type Paged, type PropertySelect, type QueryExpr, type UiNode } from "../../host/contract";
import type { Theme } from "../../theme/theme";
import type { DocumentUpdate } from "../text/engine";
import type { SurfaceMode, SurfaceMountContext } from "../core/registry";

export const BASE_OWNER = "fub.shell.base";
export const BASE_PROFILE = "base";
export const BASE_FORMAT = "base";
export const BASE_FAMILY = "structured" as const;
export const BASE_QUERY_NS = "fub.base";
export const BASE_RENDERER_NS = "fub:base";
export const BASE_MAP_ATTRIBUTION_FALLBACK = "Offline coordinates";
export const BASE_STATE_KEY = "base.active-view";
/** YAML is not a network grant. Only an explicit gesture plus a host-owned
 * exact-host allowlist may turn a tile template into a browser resource URL. */
export function allowedBaseTileUrl(template: string, kind: "raster" | "vector", allowedHosts: readonly string[], z: number, x: number, y: number): string | null {
  if (!allowedHosts.length || !["{z}", "{x}", "{y}"].every((part) => template.includes(part))) return null;
  if (![z, x, y].every((n) => Number.isSafeInteger(n) && n >= 0) || z > 3 || x >= 2 ** z || y >= 2 ** z) return null;
  try {
    const url = new URL(template.replace(/\{z\}/g, String(z)).replace(/\{x\}/g, String(x)).replace(/\{y\}/g, String(y)));
    if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443") || /[{}]/.test(url.href)) return null;
    if (!allowedHosts.some((host) => host.toLowerCase() === url.hostname.toLowerCase())) return null;
    // Vector tiles here are SVG imagery, not executable HTML or PBF bytes.
    if (kind === "vector" && !url.pathname.toLowerCase().endsWith(".svg")) return null;
    return url.href;
  } catch { return null; }
}

export interface BaseSurfaceDeps {
  readonly queryIndex: (query: IndexQuery) => Promise<IndexResult>;
  readonly invokeCommand: (command: string, args?: Record<string, unknown>, mode?: InvokeMode) => Promise<{ notify?: string | null }>;
  readonly viewState: <T>(key: string) => Promise<T | null>;
  readonly setViewState: (key: string, value: unknown) => Promise<void>;
}

export type BaseViewKind = "table" | "cards" | "list" | "kanban" | "map";
export type BaseCellValue =
  | { kind: "empty" }
  | { kind: "number" | "date" | "duration"; value: number }
  | { kind: "text" | "error"; value: string }
  | { kind: "bool"; value: boolean }
  | { kind: "list"; value: BaseCellValue[] }
  | { kind: "object"; value: Record<string, BaseCellValue> }
  | { kind: "file"; value: { path: string; label: string | null } }
  | { kind: "link"; value: { target: string; label: string | null } };
export type BaseExpected = { kind: "absent" } | { kind: "value"; value: unknown };
export interface BaseRow {
  readonly doc: string;
  readonly values: Record<string, BaseCellValue>;
  readonly properties: Record<string, unknown>;
}
export interface BaseMapConfig {
  readonly lat_key: string;
  readonly lon_key: string;
  readonly label_key: string | null;
  readonly color_key: string | null;
  readonly provider: {
    readonly kind: "offline" | "raster" | "vector";
    readonly url_template: string | null;
    readonly attribution: string | null;
    readonly network: boolean;
  } | null;
}
export interface BasePlan {
  readonly view: string;
  readonly viewType: BaseViewKind;
  readonly columns: string[];
  readonly columnLabels: Record<string, string>;
  readonly requiredProps: string[];
  readonly allProperties: boolean;
  readonly group: string | null;
  readonly limit: number | null;
  readonly map: BaseMapConfig | null;
  readonly createDefaults: Record<string, unknown>;
}
export interface BaseDerived { readonly rows: BaseRow[]; readonly summaries: Record<string, BaseCellValue> }
export interface BaseMutation {
  readonly doc: string;
  readonly key: string;
  readonly command: "note.property.set" | "note.property.remove";
  readonly args: Record<string, unknown>;
}

function object(raw: unknown, label: string): Record<string, unknown> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error(`base: ${label} malformato`);
  return raw as Record<string, unknown>;
}
function strings(raw: unknown, label: string): string[] {
  if (!Array.isArray(raw) || raw.some((value) => typeof value !== "string")) throw new Error(`base: ${label} malformato`);
  return raw;
}
async function baseQuery(deps: BaseSurfaceDeps, query: unknown): Promise<Record<string, unknown>> {
  const response = await deps.queryIndex({ kind: "custom", ns: BASE_QUERY_NS, query });
  if (response.kind !== "custom") throw new Error("base: risposta fuori tema");
  return object(response.value, "risposta");
}
export async function parseBaseViews(deps: BaseSurfaceDeps, source: string): Promise<string[]> {
  return strings((await baseQuery(deps, { version: 1, op: "parse", source })).views, "viste");
}
export async function planBaseView(deps: BaseSurfaceDeps, source: string, view: string | null): Promise<BasePlan> {
  const raw = await baseQuery(deps, { version: 1, op: "plan", source, view });
  if (typeof raw.view !== "string") throw new Error("base: piano senza vista");
  if (!["table", "cards", "list", "kanban", "map"].includes(String(raw.view_type))) throw new Error("base: tipo vista sconosciuto");
  const columns = strings(raw.columns, "colonne");
  const requiredProps = strings(raw.required_props, "dipendenze");
  const columnLabels = object(raw.column_labels, "etichette");
  if (Object.values(columnLabels).some((label) => typeof label !== "string")) throw new Error("base: etichette malformate");
  const createDefaults = object(raw.create_defaults, "proprietà iniziali");
  if (typeof raw.all_properties !== "boolean") throw new Error("base: selezione proprietà malformata");
  const optionalKey = (key: string): string | null => {
    const value = raw[key];
    if (value === null) return null;
    if (typeof value !== "string") throw new Error(`base: ${key} malformato`);
    return value;
  };
  const limit = raw.limit;
  if (limit !== null && (!Number.isSafeInteger(limit) || (limit as number) <= 0)) throw new Error("base: limite malformato");
  let map: BaseMapConfig | null = null;
  if (raw.map !== null) {
    const m = object(raw.map, "mappa");
    if (typeof m.lat_key !== "string" || typeof m.lon_key !== "string") throw new Error("base: coordinate mancanti");
    let provider: BaseMapConfig["provider"] = null;
    if (m.provider !== null) {
      const p = object(m.provider, "provider mappa");
      if (p.kind !== "offline" && p.kind !== "raster" && p.kind !== "vector") throw new Error("base: provider mappa sconosciuto");
      if (typeof p.network !== "boolean") throw new Error("base: permesso rete mappa mancante");
      for (const key of ["url_template", "attribution"]) if (p[key] !== null && typeof p[key] !== "string") throw new Error(`base: ${key} malformato`);
      provider = { kind: p.kind, url_template: p.url_template as string | null, attribution: p.attribution as string | null, network: p.network };
    }
    for (const key of ["label_key", "color_key"]) if (m[key] !== null && typeof m[key] !== "string") throw new Error(`base: ${key} malformato`);
    map = { lat_key: m.lat_key, lon_key: m.lon_key, label_key: m.label_key as string | null, color_key: m.color_key as string | null, provider };
  }
  if (raw.view_type === "map" && !map) throw new Error("base: vista mappa senza coordinate");
  return { view: raw.view, viewType: raw.view_type as BaseViewKind, columns, columnLabels: columnLabels as Record<string, string>, requiredProps, allProperties: raw.all_properties, group: optionalKey("group"), limit: limit as number | null, map, createDefaults };
}
export interface BaseSelection {
  readonly matching: QueryExpr;
  readonly sort?: { key: string; descending: boolean } | null;
  readonly select: PropertySelect;
  readonly page?: { offset: number; limit: number } | null;
  readonly excerpts?: Excerpts;
}
export async function matchingRows(deps: BaseSurfaceDeps, selection: BaseSelection): Promise<Paged<DocumentMatch>> {
  const response = await deps.queryIndex({ kind: "documents", matching: selection.matching, sort: selection.sort ?? null, select: selection.select, page: selection.page ?? null, excerpts: selection.excerpts });
  if (response.kind !== "documents") throw new Error("base: risposta documenti fuori tema");
  const page = response.value;
  if (!Number.isSafeInteger(page.total) || !Number.isSafeInteger(page.offset) || !Array.isArray(page.items) || page.offset !== (selection.page?.offset ?? 0)) throw new Error("base: pagina malformata");
  return page;
}
export interface BaseRowInput { readonly doc: string; readonly properties?: { key: string; value: unknown }[] }
export interface BaseFetchWindow { readonly offset: number; readonly limit: number }
// The generic custom query accepts a complete derivation payload, not a
// continuation cursor. Refuse a vault larger than the safe in-memory budget
// rather than silently returning its first N rows as the complete answer.
const MAX_DERIVE_ROWS = 20_000;
export async function fetchAllDocuments(deps: BaseSurfaceDeps, matching: QueryExpr = EVERY_DOCUMENT, select: PropertySelect = { kind: "all" }, window: BaseFetchWindow = { offset: 0, limit: 256 }, signal?: AbortSignal): Promise<{ rows: BaseRowInput[]; total: number }> {
  if (!Number.isSafeInteger(window.offset) || window.offset < 0 || !Number.isSafeInteger(window.limit) || window.limit < 1) throw new RangeError("base: pagina non valida");
  const rows: BaseRowInput[] = [];
  let offset = window.offset;
  let total = 0;
  do {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    const page = await matchingRows(deps, { matching, select, page: { offset, limit: window.limit }, excerpts: "omit" });
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    total = page.total;
    if (total - window.offset > MAX_DERIVE_ROWS) throw new Error(`base: ${total} documenti superano il budget di ${MAX_DERIVE_ROWS}; nessun risultato parziale`);
    if (page.items.length === 0 && offset < total) throw new Error("base: pagina vuota prima della fine");
    for (const item of page.items) {
      if (typeof item.doc !== "string" || (item.properties !== undefined && (!Array.isArray(item.properties) || item.properties.some((p) => typeof p.key !== "string")))) throw new Error("base: documento malformato");
      rows.push({ doc: item.doc, properties: item.properties });
    }
    offset += page.items.length;
    if (offset > total) throw new Error("base: pagina oltre il totale");
  } while (offset < total);
  return { rows, total };
}

function isCell(value: unknown): value is BaseCellValue {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  switch (v.kind) {
    case "empty": return true;
    case "number": case "date": case "duration": return typeof v.value === "number" && Number.isFinite(v.value);
    case "bool": return typeof v.value === "boolean";
    case "text": case "error": return typeof v.value === "string";
    case "list": return Array.isArray(v.value) && v.value.every(isCell);
    case "object": return !!v.value && typeof v.value === "object" && !Array.isArray(v.value) && Object.values(v.value).every(isCell);
    case "file": case "link": {
      if (!v.value || typeof v.value !== "object") return false;
      const target = v.value as Record<string, unknown>;
      return typeof target[v.kind === "file" ? "path" : "target"] === "string" && (target.label === null || typeof target.label === "string");
    }
    default: return false;
  }
}
export async function deriveBaseRows(deps: BaseSurfaceDeps, source: string, view: string | null, rows: BaseRowInput[], nowMs = Date.now(), container: string | null = null): Promise<BaseDerived> {
  const raw = await baseQuery(deps, { version: 1, op: "derive", source, view, now_ms: nowMs, container, rows: rows.map((row) => ({ doc: row.doc, props: Object.fromEntries((row.properties ?? []).map((property) => [property.key, property.value])) })) });
  if (!Array.isArray(raw.rows)) throw new Error("base: righe malformate");
  const properties = new Map(rows.map((row) => [row.doc, Object.fromEntries((row.properties ?? []).map((entry) => [entry.key, entry.value]))]));
  const derived = raw.rows.map((item): BaseRow => {
    const record = object(item, "riga");
    if (typeof record.doc !== "string" || !properties.has(record.doc)) throw new Error("base: documento derivato sconosciuto");
    const values = object(record.values, "valori");
    for (const [key, value] of Object.entries(values)) if (!isCell(value)) throw new Error(`base: cella malformata ${key}`);
    return { doc: record.doc, values: values as Record<string, BaseCellValue>, properties: properties.get(record.doc)! };
  });
  const summaries = object(raw.summaries, "riepiloghi");
  for (const [key, value] of Object.entries(summaries)) if (!isCell(value)) throw new Error(`base: riepilogo malformato ${key}`);
  return { rows: derived, summaries: summaries as Record<string, BaseCellValue> };
}
function sameJson(left: unknown, right: unknown): boolean {
  const canonical = (value: unknown) => JSON.stringify(value, (_key, current: unknown) =>
    current && typeof current === "object" && !Array.isArray(current)
      ? Object.fromEntries(Object.entries(current).sort(([a], [b]) => a.localeCompare(b)))
      : current);
  return canonical(left) === canonical(right);
}

export async function prepareBaseMutations(deps: BaseSurfaceDeps, source: string, view: string | null, edits: { doc: string; key: string; expected: BaseExpected; value?: string | null }[]): Promise<BaseMutation[]> {
  const raw = await baseQuery(deps, { version: 1, op: "mutate", source, view, edits });
  if (!Array.isArray(raw.mutations) || raw.mutations.length !== edits.length) throw new Error("base: mutazioni malformate");
  return raw.mutations.map((item, index) => {
    const mutation = object(item, "mutazione");
    const args = object(mutation.args, "argomenti mutazione");
    const edit = edits[index];
    let actual: BaseExpected;
    if (!edit) throw new Error("base: mutazione senza richiesta");
    try { actual = JSON.parse(args.expected as string) as BaseExpected; }
    catch { throw new Error("base: expected command malformato"); }
    const command = edit.value == null ? "note.property.remove" : "note.property.set";
    if (mutation.doc !== edit.doc || mutation.key !== edit.key || args.doc !== edit.doc || args.key !== edit.key || actual.kind !== edit.expected.kind || (actual.kind === "value" && edit.expected.kind === "value" && !sameJson(actual.value, edit.expected.value)) || mutation.command !== command || (edit.value == null ? Object.prototype.hasOwnProperty.call(args, "value") : args.value !== edit.value)) throw new Error("base: mutazione diversa dalla richiesta");
    return { doc: edit.doc, key: edit.key, command, args };
  });
}
export function expectedProperty(row: BaseRow, key: string): BaseExpected {
  return Object.prototype.hasOwnProperty.call(row.properties, key) ? { kind: "value", value: row.properties[key] } : { kind: "absent" };
}
export function baseRowsToCsv(rows: BaseRow[], columns: string[]): string {
  const escape = (value: string): string => /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
  return `${[columns.map(escape).join(","), ...rows.map((row) => columns.map((key) => escape(cellText(row.values[key]))).join(","))].join("\r\n")}\r\n`;
}
export function cellText(value: BaseCellValue | undefined): string {
  if (!value || value.kind === "empty") return "";
  switch (value.kind) {
    case "number": case "duration": return String(value.value);
    case "date": return new Date(value.value).toISOString().slice(0, 10);
    case "text": case "error": return value.value;
    case "bool": return value.value ? "true" : "false";
    case "list": return value.value.map(cellText).join(", ");
    case "object": return JSON.stringify(value.value);
    case "file": return value.value.label ?? value.value.path;
    case "link": return value.value.label ?? value.value.target;
  }
}
export interface BaseEmbed { readonly source?: string; readonly base?: string; readonly view: string | null; readonly container: string | null }
export function parseBaseEmbed(node: UiNode): BaseEmbed | null {
  if (node.node !== "custom" || node.ns !== BASE_RENDERER_NS) return null;
  const payload = object(node.payload, "embed");
  if (typeof payload.source === "string") return { source: payload.source, view: typeof payload.view === "string" ? payload.view : null, container: typeof payload.container === "string" ? payload.container : null };
  if (typeof payload.base === "string") return { base: payload.base, view: typeof payload.view === "string" ? payload.view : null, container: typeof payload.container === "string" ? payload.container : null };
  return null;
}
export function baseSurfaceModes(): SurfaceMode[] { return [{ id: "base", label: () => "Base", presentation: "surface", contextMode: "source" }]; }
function stateKey(doc: string): string { return `${BASE_STATE_KEY}:${doc}`; }
export async function persistBaseView(deps: BaseSurfaceDeps, doc: string, view: string): Promise<void> { await deps.setViewState(stateKey(doc), view); }
export async function restoreBaseView(deps: BaseSurfaceDeps, doc: string): Promise<string | null> {
  const value = await deps.viewState<unknown>(stateKey(doc));
  if (value === null) return null;
  if (typeof value !== "string") throw new Error("base: vista salvata malformata");
  return value;
}
export type { SurfaceMode, SurfaceMountContext, DocumentUpdate, Theme };
