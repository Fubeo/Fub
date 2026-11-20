// `.base` uses the generic query and command registries. The definition is
// source text; notes and their indexed properties remain the authoritative data.
import { EVERY_DOCUMENT, type DocumentMatch, type Excerpts, type IndexQuery, type IndexResult, type InvokeMode, type LinkTarget, type Paged, type PropertySelect, type QueryExpr, type UiNode } from "../../host/contract";
import type { Theme } from "../../theme/theme";
import type { DocumentUpdate } from "../core/text-operation";
import type { SurfaceMode, SurfaceMountContext } from "../core/registry";
import { parseFilter, type FilterDef } from "./filter";
import { parseOrder, parseSort, propertyName, readOnlyColumn, type SortEntry } from "./sort";
// Il registro dei tipi del vault (`properties.types`) si legge come lo legge
// la testata delle note: una regola sola per tipi, opzioni e gruppi.
import { declaredType, OPTION_GROUPS, optionsOf, type PropertyOption, type PropertyTypes } from "../text/profiles/markdown/page/properties/kind";

import { BASE_QUERY_NS, BASE_RENDERER_NS } from "./ids";

export { BASE_FAMILY, BASE_FORMAT, BASE_OWNER, BASE_PROFILE, BASE_QUERY_NS, BASE_RENDERER_NS } from "./ids";
export const BASE_STATE_KEY = "base.active-view";
/// La chiave di macchina con gli host da cui la vista Mappa può scaricare
/// tessere (`fub-host`, `map_tiles::MAP_TILE_HOSTS`). Vuota di serie.
export const MAP_TILE_HOSTS_KEY = "map.tile-hosts";

/// L'indirizzo di una tessera dal modello del `.base`, se ha la forma che
/// l'host accetta (`https`, porta 443, niente credenziali, query o frammento;
/// un fornitore vettoriale dà SVG). Non guarda gli host ammessi: per quello
/// c'è `allowedBaseTileUrl`.
export function baseTileUrl(template: string, kind: "raster" | "vector", z: number, x: number, y: number): URL | null {
  if (!["{z}", "{x}", "{y}"].every((part) => template.includes(part))) return null;
  if (![z, x, y].every((n) => Number.isSafeInteger(n) && n >= 0) || z > 3 || x >= 2 ** z || y >= 2 ** z) return null;
  try {
    const url = new URL(template.replace(/\{z\}/g, String(z)).replace(/\{x\}/g, String(x)).replace(/\{y\}/g, String(y)));
    if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443") || url.search || url.hash || /[{}]/.test(url.href)) return null;
    // Vector tiles here are SVG imagery, not executable HTML or PBF bytes.
    if (kind === "vector" && !url.pathname.toLowerCase().endsWith(".svg")) return null;
    return url;
  } catch { return null; }
}

/** YAML is not a network grant. Only an explicit gesture plus a host-owned
 * exact-host allowlist may turn a tile template into a tile request. The
 * authority is the host (`Host::map_tile`): this check only avoids asking for
 * what it would refuse. */
export function allowedBaseTileUrl(template: string, kind: "raster" | "vector", allowedHosts: readonly string[], z: number, x: number, y: number): string | null {
  if (!allowedHosts.length) return null;
  const url = baseTileUrl(template, kind, z, x, y);
  if (!url || !allowedHosts.some((host) => host.trim().toLowerCase() === url.hostname.toLowerCase())) return null;
  return url.href;
}

export interface BaseSurfaceDeps {
  readonly queryIndex: (query: IndexQuery) => Promise<IndexResult>;
  readonly invokeCommand: (command: string, args?: Record<string, unknown>, mode?: InvokeMode) => Promise<{ notify?: string | null; effect?: unknown; undo?: { readonly label: string } | null }>;
  readonly viewState: <T>(key: string) => Promise<T | null>;
  readonly setViewState: (key: string, value: unknown) => Promise<void>;
}

/// Le scritture dei documenti aperti, come le vede una Base: la coda di
/// salvataggio e l'annuncio di una scrittura di un comando
/// (`DocumentSessionCollection.expectWrite`, `state/document-session.ts`).
export interface BaseDocumentWrites {
  /// Svuota la coda di salvataggio; torna i documenti rimasti non salvati.
  flush(): Promise<readonly string[]>;
  /// Annuncia che un comando sta per riscrivere `doc`; torna chi ritira
  /// l'annuncio se il comando non scrive.
  expect(doc: string): () => void;
}

export type BaseViewKind = "table" | "cards" | "list" | "kanban" | "map" | "calendar" | "timeline";
/// I tipi di vista che la superficie disegna: un altro tipo si legge come
/// sconosciuto.
const DRAWN_VIEW_KINDS: readonly string[] = ["table", "cards", "list", "kanban", "map", "calendar", "timeline"];
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
  /// Il giorno della nota in una vista di calendario (`2026-11-14`: il giorno
  /// civile della proprietà data, che l'ora non sposta), `null` se la nota non
  /// ha la data; assente nelle altre viste. Lo dice `derive`.
  readonly day?: string | null;
  /// L'intervallo della nota in una vista di linea del tempo: i giorni civili
  /// d'inizio e di fine (`null` se la nota non ha la data) e se la fine viene
  /// prima dell'inizio; assente nelle altre viste. Lo dice `derive`.
  readonly span?: { readonly start: string | null; readonly end: string | null; readonly inverted: boolean };
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
  /// La mappa come il piano la dà, chiavi in più comprese: chi la riscrive
  /// cambia solo ciò che deve.
  readonly raw?: Readonly<Record<string, unknown>>;
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
  /// Il filtro della vista, come lo legge il modello (`"all"` se non c'è).
  readonly filters: FilterDef;
  /// L'ordinamento scritto nella vista, nell'ordine del file.
  readonly sort: SortEntry[];
  /// Le colonne scritte nella vista (`order`); vuota se il modello le deduce.
  readonly order: string[];
  /// I riepiloghi scritti nella vista, nell'ordine del file, ognuno col nome
  /// con cui `derive` ne dà il valore.
  readonly summaries: BaseSummaryDef[];
  /// Le proprietà del calendario (`date`) e della linea del tempo (`start`,
  /// `end`), scritte sotto `fub:`; `null` se la vista non le ha.
  readonly dateKey: string | null;
  readonly startKey: string | null;
  readonly endKey: string | null;
  /// Le Relazioni che i riepiloghi (`rollup`) leggono, e le proprietà delle
  /// note legate che chiedono (T35a): la superficie risolve quei link e manda
  /// le note legate a `derive`. Vuote se la vista non ne ha.
  readonly relations: string[];
  readonly linkedProps: string[];
}
/// Gli aggregati di un riepilogo (`AggregateKind` di `fub-format-base`).
export type BaseAggregate =
  | "count" | "count_filled" | "count_empty" | "count_unique"
  | "sum" | "average" | "min" | "max" | "earliest" | "latest" | "checked" | "unchecked";
const AGGREGATES: readonly BaseAggregate[] = ["count", "count_filled", "count_empty", "count_unique", "sum", "average", "min", "max", "earliest", "latest", "checked", "unchecked"];
/// Un riepilogo della vista come lo legge il modello (`SummaryDef`), e
/// `label`, la chiave del suo valore nei riepiloghi di `derive`.
export interface BaseSummaryDef {
  readonly key: string;
  readonly aggregate: BaseAggregate;
  readonly expression: string | null;
  readonly name: string | null;
  readonly label: string;
}
/// Quanti riepiloghi una vista porta al massimo (`MAX_SUMMARIES` del modello).
const MAX_SUMMARIES = 32;
/// I riepiloghi del piano, controllati. Un piano che non li dice (un host di
/// prima) non ne ha.
export function parseSummaries(raw: unknown): BaseSummaryDef[] {
  if (raw === null || raw === undefined) return [];
  if (!Array.isArray(raw) || raw.length > MAX_SUMMARIES) throw new Error("base: riepiloghi malformati");
  return raw.map((entry) => {
    const each = object(entry, "riepilogo");
    const optional = (value: unknown): string | null => {
      if (value === null || value === undefined) return null;
      if (typeof value !== "string") throw new Error("base: riepilogo malformato");
      return value;
    };
    if (typeof each.key !== "string" || each.key === "" || typeof each.label !== "string" || !AGGREGATES.includes(each.aggregate as BaseAggregate)) throw new Error("base: riepilogo malformato");
    return { key: each.key, aggregate: each.aggregate as BaseAggregate, expression: optional(each.expression), name: optional(each.name), label: each.label };
  });
}
/// Il valore da scrivere per `summaries`, nella forma del modello: senza
/// `label`, che il file non ha, e senza i campi vuoti; `null` toglie la
/// chiave invece di lasciare un `summaries: []` che nessuno ha scritto.
export function summariesValue(summaries: readonly BaseSummaryDef[]): Record<string, string>[] | null {
  if (summaries.length === 0) return null;
  return summaries.map((summary) => {
    const out: Record<string, string> = {};
    if (summary.name !== null) out.name = summary.name;
    out.key = summary.key;
    out.aggregate = summary.aggregate;
    if (summary.expression !== null) out.expression = summary.expression;
    return out;
  });
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
  return (await listBaseViews(deps, source)).names;
}
/// Le viste del file: i nomi e, nello stesso ordine, il tipo di ognuna
/// (`null` quando il core non lo dice), per le figure delle linguette.
export interface BaseViewList { readonly names: string[]; readonly types: (string | null)[] }
export async function listBaseViews(deps: BaseSurfaceDeps, source: string): Promise<BaseViewList> {
  const raw = await baseQuery(deps, { version: 1, op: "parse", source });
  const names = strings(raw.views, "viste");
  const types = Array.isArray(raw.types) && raw.types.length === names.length
    ? raw.types.map((type) => typeof type === "string" ? type : null)
    : names.map(() => null);
  return { names, types };
}
export async function planBaseView(deps: BaseSurfaceDeps, source: string, view: string | null): Promise<BasePlan> {
  const raw = await baseQuery(deps, { version: 1, op: "plan", source, view });
  if (typeof raw.view !== "string") throw new Error("base: piano senza vista");
  if (!DRAWN_VIEW_KINDS.includes(String(raw.view_type))) throw new Error("base: tipo vista sconosciuto");
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
    map = { lat_key: m.lat_key, lon_key: m.lon_key, label_key: m.label_key as string | null, color_key: m.color_key as string | null, provider, raw: { ...m } };
  }
  if (raw.view_type === "map" && !map) throw new Error("base: vista mappa senza coordinate");
  return {
    view: raw.view, viewType: raw.view_type as BaseViewKind, columns, columnLabels: columnLabels as Record<string, string>, requiredProps,
    allProperties: raw.all_properties, group: optionalKey("group"), limit: limit as number | null, map, createDefaults,
    filters: parseFilter(raw.filters), sort: parseSort(raw.sort), order: parseOrder(raw.order), summaries: parseSummaries(raw.summaries),
    // Un host che non le dice (prima di T16) vale come una vista senza.
    dateKey: raw.date_key === undefined ? null : optionalKey("date_key"),
    startKey: raw.start_key === undefined ? null : optionalKey("start_key"),
    endKey: raw.end_key === undefined ? null : optionalKey("end_key"),
    // Un host che non le dice (prima di T35a) vale come una vista senza.
    relations: raw.relations === undefined ? [] : strings(raw.relations, "relazioni"),
    linkedProps: raw.linked_props === undefined ? [] : strings(raw.linked_props, "proprietà legate"),
  };
}

/// Una nota legata come la vuole `derive`: la pagina del link com'è scritta
/// nella Relazione (`Dune` per `[[Dune]]`), il documento a cui il vault la
/// risolve e le proprietà che il piano chiede. `folder` è la cartella delle
/// righe da cui si è risolta (`""` la radice): lo stesso `[[Indice]]` in due
/// cartelle può portare a due note, e `derive` dà a ogni riga quella della sua.
export interface BaseLinkedNote {
  readonly target: string;
  readonly folder: string;
  readonly doc: string;
  readonly props: Record<string, unknown>;
}

/// Quante pagine di link si risolvono insieme: le domande partono a gruppi,
/// non una alla volta né tutte insieme.
const RESOLVE_BATCH = 16;

/// I link di un valore di Relazione indicizzato (`PropertyValue`): un link
/// solo o un elenco; ogni voce che non è un link non lega niente.
function relationTargets(value: unknown): LinkTarget[] {
  if (!value || typeof value !== "object") return [];
  const { kind, value: inner } = value as { kind?: unknown; value?: unknown };
  if (kind === "link") return isLinkTarget(inner) ? [inner] : [];
  if (kind !== "list" || !Array.isArray(inner)) return [];
  return inner.flatMap((item: unknown) => {
    if (!item || typeof item !== "object") return [];
    const scalar = item as { kind?: unknown; value?: unknown };
    return scalar.kind === "link" && isLinkTarget(scalar.value) ? [scalar.value] : [];
  });
}

function isLinkTarget(value: unknown): value is LinkTarget {
  if (!value || typeof value !== "object") return false;
  const target = value as { kind?: unknown; value?: unknown };
  if (target.kind === "wiki") return !!target.value && typeof target.value === "object" && typeof (target.value as { page?: unknown }).page === "string";
  return target.kind === "path" && typeof target.value === "string";
}

/// La pagina con cui `derive` cerca la nota legata: quella del link, senza
/// titolo né blocco (`rollup` legge la nota), o il percorso.
function linkedKey(target: LinkTarget): string | null {
  if (target.kind === "wiki") return target.value.page.trim() || null;
  return target.kind === "path" ? target.value : null;
}

/// La cartella di un documento, come la legge `derive` (`""` la radice).
function folderOf(doc: string): string {
  const slash = doc.lastIndexOf("/");
  return slash < 0 ? "" : doc.slice(0, slash);
}

/// Le note legate dalle Relazioni del piano nelle righe `rows`. Un link si
/// risolve dal punto di vista della riga che lo scrive, con le regole del
/// vault (`resolve`): lo stesso `[[Indice]]` o `./nota.md` in due cartelle può
/// portare a due note. Le domande si raggruppano per (cartella della riga,
/// pagina), che dà la stessa risposta, e le note trovate si leggono in una
/// domanda sola, con le proprietà che il piano chiede. Un link rotto non si
/// manda. Niente da fare se la vista non ha riepiloghi di Relazione.
export async function linkedNotes(deps: BaseSurfaceDeps, plan: Pick<BasePlan, "relations" | "linkedProps">, rows: readonly BaseRowInput[], signal?: AbortSignal): Promise<BaseLinkedNote[]> {
  if (plan.relations.length === 0) return [];
  const pages = new Map<string, { key: string; folder: string; target: LinkTarget; from: string }>();
  for (const row of rows) {
    const folder = folderOf(row.doc);
    for (const property of row.properties ?? []) {
      if (!plan.relations.includes(property.key)) continue;
      for (const target of relationTargets(property.value)) {
        const key = linkedKey(target);
        if (key === null) continue;
        const group = JSON.stringify([folder, key]);
        if (!pages.has(group)) pages.set(group, { key, folder, target: target.kind === "wiki" ? { kind: "wiki", value: { page: target.value.page } } : target, from: row.doc });
      }
    }
  }
  if (pages.size > MAX_DERIVE_ROWS) throw new Error(`base: ${pages.size} note legate superano il budget di ${MAX_DERIVE_ROWS}; nessun risultato parziale`);
  const resolved: { target: string; folder: string; doc: string }[] = [];
  const entries = [...pages.values()];
  for (let at = 0; at < entries.length; at += RESOLVE_BATCH) {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    // Nell'ordine delle righe, non in quello delle risposte.
    const answers = await Promise.all(entries.slice(at, at + RESOLVE_BATCH).map(async ({ key, folder, target, from }) => {
      const answer = await deps.queryIndex({ kind: "resolve", target, from });
      if (answer.kind !== "resolved") throw new Error("base: risoluzione fuori tema");
      return answer.value ? { target: key, folder, doc: answer.value.doc } : null;
    }));
    for (const answer of answers) if (answer) resolved.push(answer);
  }
  if (resolved.length === 0) return [];
  const docs = [...new Set(resolved.map((entry) => entry.doc))];
  const found = await fetchAllDocuments(deps, { any: [{ all: [{ negated: false, predicate: { kind: "docs", docs } }] }] }, { kind: "keys", keys: plan.linkedProps }, { offset: 0, limit: 256 }, signal);
  const props = new Map(found.rows.map((row) => [row.doc, Object.fromEntries((row.properties ?? []).map((entry) => [entry.key, entry.value]))]));
  return resolved.map(({ target, folder, doc }) => ({ target, folder, doc, props: props.get(doc) ?? {} }));
}

/// Le chiavi di una vista che i gesti della barra, del menu della colonna e
/// di «+» riscrivono.
export type BaseViewKey = "filters" | "sort" | "order" | "group" | "summaries" | "map" | "date" | "start" | "end";
/// I comandi di T15a che scrivono un `.base` (`fub-features/src/base.rs`).
export const BASE_VIEW_SET = "base.view.set";
export const BASE_VIEW_ADD = "base.view.add";
export const BASE_VIEW_REMOVE = "base.view.remove";
/// I tipi di vista che «+» crea: quelli che la Base disegna.
export const NEW_VIEW_KINDS: readonly BaseViewKind[] = ["table", "cards", "list", "kanban", "map", "calendar", "timeline"];

/// Scrive la chiave `key` della vista `view` del file `doc` con
/// `base.view.set`: `value` è il valore JSON, `null` toglie la chiave. Con
/// `base` il comando scrive solo se il file è ancora quella revisione, e
/// altrimenti risponde con un conflitto.
export async function setBaseViewKey(deps: Pick<BaseSurfaceDeps, "invokeCommand">, doc: string, view: string, key: BaseViewKey, value: unknown, base: string | null): Promise<BaseViewWrite> {
  const args: Record<string, unknown> = { doc, view, key };
  if (value !== null && value !== undefined) args.value = JSON.stringify(value);
  return baseViewCommand(deps, BASE_VIEW_SET, args, base);
}
/// Aggiunge in fondo al file la vista `name` del tipo `type` con
/// `base.view.add`; le altre chiavi si scrivono dopo, con `setBaseViewKey`.
export async function addBaseView(deps: Pick<BaseSurfaceDeps, "invokeCommand">, doc: string, name: string, type: BaseViewKind, base: string | null): Promise<BaseViewWrite> {
  return baseViewCommand(deps, BASE_VIEW_ADD, { doc, name, type }, base);
}
/// Toglie la vista `view` con tutte le sue chiavi, con `base.view.remove`.
export async function removeBaseView(deps: Pick<BaseSurfaceDeps, "invokeCommand">, doc: string, view: string, base: string | null): Promise<BaseViewWrite> {
  return baseViewCommand(deps, BASE_VIEW_REMOVE, { doc, view }, base);
}
/// Un comando che scrive il `.base`, con la revisione se c'è: torna la
/// revisione scritta, la frase e l'annulla.
async function baseViewCommand(deps: Pick<BaseSurfaceDeps, "invokeCommand">, command: string, args: Record<string, unknown>, base: string | null): Promise<BaseViewWrite> {
  if (base !== null) args.base = base;
  const outcome = await deps.invokeCommand(command, args);
  const effect = outcome?.effect as { kind?: unknown; ns?: unknown; payload?: unknown } | undefined;
  const revision = effect?.kind === "custom" && effect.ns === "fub.base" ? (effect.payload as { revision?: unknown } | null)?.revision : undefined;
  const undo = outcome?.undo;
  return {
    revision: typeof revision === "string" ? revision : null,
    notify: typeof outcome?.notify === "string" && outcome.notify !== "" ? outcome.notify : null,
    undo: undo && typeof undo.label === "string" ? { label: undo.label } : null,
  };
}

/// L'esito di `base.view.set`: la revisione scritta (`null` se il file non è
/// cambiato, o se l'host non la dice), la frase da dire e, se il kernel sa
/// disfarlo, la frase accanto ad «Annulla».
export interface BaseViewWrite {
  readonly revision: string | null;
  readonly notify: string | null;
  readonly undo: { readonly label: string } | null;
}

/// Le righe che un gesto ha scritto: il pezzo del testo nuovo che non c'era,
/// fra le righe uguali in testa e in coda, e quante righe di prima ha preso il
/// suo posto. È ciò che «Nel file .base» mostra.
export interface BaseWritten {
  /// Le righe di prima che non ci sono più.
  readonly removed: string[];
  /// Le righe nuove.
  readonly added: string[];
  /// Il numero (da 1) della prima riga cambiata nel testo nuovo.
  readonly line: number;
}
export function writtenLines(before: string, after: string): BaseWritten | null {
  if (before === after) return null;
  const old = before.split(/\r?\n/), now = after.split(/\r?\n/);
  let head = 0;
  while (head < old.length && head < now.length && old[head] === now[head]) head++;
  let tail = 0;
  while (tail < old.length - head && tail < now.length - head && old[old.length - 1 - tail] === now[now.length - 1 - tail]) tail++;
  return { removed: old.slice(head, old.length - tail), added: now.slice(head, now.length - tail), line: head + 1 };
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
/// Tutte le note che `matching` trova, a partire da `window.offset`. La prima
/// domanda chiede `window.limit` righe e dice quante sono in tutto; se ce ne
/// sono altre, la seconda le chiede tutte insieme. Ogni domanda costa
/// all'indice un giro di tutto il vault (filtro e ordine), quindi due domande
/// e non una ogni 256 righe; e la prima resta piccola, perché un vault oltre il
/// budget si rifiuta senza trasferirlo. Se intanto il vault cresce, si chiede
/// ancora ciò che manca.
export async function fetchAllDocuments(deps: BaseSurfaceDeps, matching: QueryExpr = EVERY_DOCUMENT, select: PropertySelect = { kind: "all" }, window: BaseFetchWindow = { offset: 0, limit: 256 }, signal?: AbortSignal): Promise<{ rows: BaseRowInput[]; total: number }> {
  if (!Number.isSafeInteger(window.offset) || window.offset < 0 || !Number.isSafeInteger(window.limit) || window.limit < 1) throw new RangeError("base: pagina non valida");
  const rows: BaseRowInput[] = [];
  let offset = window.offset;
  let total = 0;
  let limit = window.limit;
  do {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    const page = await matchingRows(deps, { matching, select, page: { offset, limit }, excerpts: "omit" });
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
    // Il resto in una domanda sola (un host può darne meno: si richiede).
    limit = Math.max(window.limit, total - offset);
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
/// `needed`: le proprietà che `derive` legge (`required_props` del piano), o
/// `null` se le legge tutte (`all_properties`, la ricerca della vista). Le righe
/// arrivano con tutte le proprietà delle note, perché la barra propone quelle
/// che le note hanno; a `derive` vanno solo quelle che il piano chiede, così la
/// domanda resta piccola come prima, entro `MAX_BASE_QUERY_BYTES` del core.
/// Ogni riga derivata tiene comunque tutte le proprietà lette della sua nota.
export async function deriveBaseRows(deps: BaseSurfaceDeps, source: string, view: string | null, rows: BaseRowInput[], nowMs = Date.now(), container: string | null = null, linked: readonly BaseLinkedNote[] = [], needed: readonly string[] | null = null): Promise<BaseDerived> {
  const wanted = needed === null ? null : new Set(needed);
  const props = (row: BaseRowInput) => Object.fromEntries((row.properties ?? []).filter((property) => wanted === null || wanted.has(property.key)).map((property) => [property.key, property.value]));
  const raw = await baseQuery(deps, { version: 1, op: "derive", source, view, now_ms: nowMs, container, rows: rows.map((row) => ({ doc: row.doc, props: props(row) })), ...(linked.length > 0 ? { linked } : {}) });
  if (!Array.isArray(raw.rows)) throw new Error("base: righe malformate");
  const properties = new Map(rows.map((row) => [row.doc, Object.fromEntries((row.properties ?? []).map((entry) => [entry.key, entry.value]))]));
  const derived = raw.rows.map((item): BaseRow => {
    const record = object(item, "riga");
    if (typeof record.doc !== "string" || !properties.has(record.doc)) throw new Error("base: documento derivato sconosciuto");
    const values = object(record.values, "valori");
    for (const [key, value] of Object.entries(values)) if (!isCell(value)) throw new Error(`base: cella malformata ${key}`);
    const row: BaseRow = { doc: record.doc, values: values as Record<string, BaseCellValue>, properties: properties.get(record.doc)! };
    if (record.time === undefined) return row;
    const time = object(record.time, "tempo");
    const civil = (value: unknown): value is string | null => value === null || (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value));
    if (time.start !== undefined || time.end !== undefined) {
      if (!civil(time.start) || !civil(time.end) || typeof time.inverted !== "boolean") throw new Error("base: intervallo malformato");
      return { ...row, span: { start: time.start, end: time.end, inverted: time.inverted } };
    }
    if (time.day === undefined) return row;
    if (!civil(time.day)) throw new Error("base: giorno malformato");
    return { ...row, day: time.day };
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
  // Una colonna che non è una proprietà (`file.*`, `container.*`, una formula)
  // non si scrive: si dice prima di chiedere al core, e la cella non ci arriva.
  if (edits.some((edit) => readOnlyColumn(edit.key))) throw new Error("base: colonna in sola lettura");
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
    // Il comando scrive la proprietà (`prop.stato` → `stato`), non la chiave
    // di colonna: una risposta che ripete `prop.stato` scriverebbe una riga
    // `prop.stato:` nel frontmatter, e qui si ferma.
    if (mutation.doc !== edit.doc || mutation.key !== edit.key || args.doc !== edit.doc || args.key !== propertyName(edit.key) || actual.kind !== edit.expected.kind || (actual.kind === "value" && edit.expected.kind === "value" && !sameJson(actual.value, edit.expected.value)) || mutation.command !== command || (edit.value == null ? Object.prototype.hasOwnProperty.call(args, "value") : args.value !== edit.value)) throw new Error("base: mutazione diversa dalla richiesta");
    return { doc: edit.doc, key: edit.key, command, args };
  });
}
/// Lo stato letto della proprietà che la chiave di colonna scrive (`prop.stato`
/// è `stato`): il comando lo confronta col file, e se la nota è cambiata non
/// scrive niente.
export function expectedProperty(row: BaseRow, key: string): BaseExpected {
  const name = propertyName(key);
  return Object.prototype.hasOwnProperty.call(row.properties, name) ? { kind: "value", value: row.properties[name] } : { kind: "absent" };
}
/// Due letture della stessa proprietà dicono lo stesso valore: la cella in
/// modifica sa così se la nota sotto è cambiata da quando si è cominciato a
/// scrivere (IMP-137).
export function sameExpected(left: BaseExpected, right: BaseExpected): boolean {
  if (left.kind !== right.kind) return false;
  return left.kind === "absent" || (right.kind === "value" && sameJson(left.value, right.value));
}
export function baseRowsToCsv(rows: BaseRow[], columns: string[]): string {
  const escape = (value: string): string => /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
  return `${[columns.map(escape).join(","), ...rows.map((row) => columns.map((key) => escape(cellText(row.values[key]))).join(","))].join("\r\n")}\r\n`;
}
/// Una corsia della Bacheca su una Selezione o su uno Stato (T9): il valore e
/// l'opzione del registro che gli dà colore e gruppo, o `null` se il valore è
/// fuori dalle opzioni (un'opzione rinominata, un valore scritto a mano).
export interface ChoiceLane {
  readonly name: string;
  readonly option: PropertyOption | null;
}

/// Le corsie di una Bacheca raggruppata per `key`, se il registro dei tipi la
/// dichiara Selezione o Stato: prima tutte le opzioni, anche vuote, nel loro
/// ordine (lo Stato nei tre gruppi, Da fare, In corso, Fatto); poi i valori
/// `present` fuori dalle opzioni, nell'ordine in cui compaiono. Due opzioni
/// con lo stesso nome sono una, la prima, come nel core. `null` per ogni
/// altro tipo: le corsie restano quelle dei valori.
export function choiceLanes(types: PropertyTypes, key: string, present: readonly string[]): { readonly kind: "select" | "status"; readonly lanes: ChoiceLane[] } | null {
  const kind = declaredType(types, key);
  if (kind !== "select" && kind !== "status") return null;
  const seen = new Set<string>();
  const options = optionsOf(types, key).filter((option) => !seen.has(option.name) && seen.add(option.name));
  const ordered = kind === "status" ? OPTION_GROUPS.flatMap((group) => options.filter((option) => option.group === group)) : options;
  const outside = [...new Set(present)].filter((name) => !seen.has(name));
  return { kind, lanes: [...ordered.map((option) => ({ name: option.name, option })), ...outside.map((name) => ({ name, option: null }))] };
}

/// Le righe divise per il valore di `key`, nell'ordine in cui il primo di ogni
/// gruppo compare: l'ordinamento della vista resta quello dentro ogni gruppo.
/// L'ordine dei gruppi: quello delle righe, o per nome nei due versi.
export type BaseGroupOrder = "rows" | "asc" | "desc";

const GROUP_NAMES = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

/// Le righe per gruppo. Per nome, i numeri contano come numeri e il gruppo
/// senza valore resta in fondo nei due versi.
export function groupBaseRows(rows: readonly BaseRow[], key: string, order: BaseGroupOrder = "rows"): { name: string; rows: BaseRow[] }[] {
  const groups = new Map<string, BaseRow[]>();
  for (const row of rows) {
    const name = cellText(row.values[key]);
    const members = groups.get(name);
    if (members) members.push(row);
    else groups.set(name, [row]);
  }
  const out = [...groups].map(([name, members]) => ({ name, rows: members }));
  if (order === "rows") return out;
  const sign = order === "asc" ? 1 : -1;
  return out.sort((a, b) => (a.name === "") !== (b.name === "") ? (a.name === "" ? 1 : -1) : sign * GROUP_NAMES.compare(a.name, b.name));
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
export function baseSurfaceModes(): SurfaceMode[] { return [{ id: "base", label: () => "Base", presentation: "surface", contextMode: "live_preview", looks: ["tema"] }]; }
function stateKey(doc: string): string { return `${BASE_STATE_KEY}:${doc}`; }
export async function persistBaseView(deps: BaseSurfaceDeps, doc: string, view: string): Promise<void> { await deps.setViewState(stateKey(doc), view); }
export async function restoreBaseView(deps: BaseSurfaceDeps, doc: string): Promise<string | null> {
  const value = await deps.viewState<unknown>(stateKey(doc));
  if (value === null) return null;
  if (typeof value !== "string") throw new Error("base: vista salvata malformata");
  return value;
}
export type { SurfaceMode, SurfaceMountContext, DocumentUpdate, Theme };
