import { api } from "../host/ipc";
import { settings } from "../host/query";
import { onEvent } from "../state/kernel";
import type { Lifetime } from "../ui/lifetime";
import { sanitizeUserCss } from "../ui/sanitize-css";
import { mountUserSnippets, themeProfile } from "./loader";

export const CSS_SNIPPETS_KEY = "appearance.css-snippets";
export const DEFAULT_CSS_SNIPPETS = '{"version":1,"snippets":[]}';

// Deliberately finite. A frontmatter value never becomes an arbitrary selector.
export const NOTE_CSS_CLASSES = [
  "wide", "narrow", "compact", "serif", "sans", "minimal",
] as const;
const NOTE_HOOKS = NOTE_CSS_CLASSES.map((name) => `fub-note--${name}`);
// Gli hook sono quelli del profilo in vigore: un frammento nomina le classi
// della shell che sta girando, non quelle di una shell che non è montata.
const allowedHooks = (): readonly string[] => [...themeProfile().hooks, ...NOTE_HOOKS];
const allowedNoteClasses = new Set<string>(NOTE_CSS_CLASSES);

export interface CssSnippet {
  readonly id: string;
  readonly css: string;
  readonly enabled: boolean;
  readonly [opaque: string]: unknown;
}

export interface CssSnippetDocument {
  readonly version: 1;
  readonly snippets: readonly CssSnippet[];
  readonly [opaque: string]: unknown;
}

export interface CssSnippetStatus {
  readonly id: string;
  readonly enabled: boolean;
  readonly trust: "local-user";
  readonly error?: string;
}

export function parseCssSnippets(raw: string): CssSnippetDocument {
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("CSS snippet document must be an object");
  const doc = value as Record<string, unknown>;
  if (doc.version !== 1) throw new Error("unsupported CSS snippet document version");
  if (!Array.isArray(doc.snippets) || doc.snippets.length > 32) throw new Error("invalid CSS snippet list");
  const ids = new Set<string>();
  for (const item of doc.snippets) {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error("invalid CSS snippet");
    const snippet = item as Record<string, unknown>;
    if (typeof snippet.id !== "string" || !/^[a-z0-9][a-z0-9._-]{0,63}$/.test(snippet.id) || ids.has(snippet.id)) {
      throw new Error("invalid or duplicate CSS snippet id");
    }
    if (typeof snippet.css !== "string" || typeof snippet.enabled !== "boolean") {
      throw new Error(`invalid CSS snippet ${snippet.id}`);
    }
    ids.add(snippet.id);
  }
  return doc as unknown as CssSnippetDocument;
}

/** A note's cssclasses are data. Only known aliases become namespaced DOM classes. */
export function noteCssClasses(value: unknown): string[] {
  const raw = typeof value === "string" ? value.split(/\s+/) : value;
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.filter((name): name is string =>
    typeof name === "string" && allowedNoteClasses.has(name)))].map((name) => `fub-note--${name}`);
}

export function applyNoteCssClasses(root: HTMLElement, value: unknown): void {
  for (const name of NOTE_HOOKS) root.classList.remove(name);
  root.classList.add(...noteCssClasses(value));
}

let saved = DEFAULT_CSS_SNIPPETS;
let preview: string | null = null;
let statuses: CssSnippetStatus[] = [];
let epoch = 0;

function compile(raw: string, rejectInvalid: boolean): { css: string; statuses: CssSnippetStatus[] } {
  const doc = parseCssSnippets(raw);
  const chunks: string[] = [];
  const status: CssSnippetStatus[] = [];
  for (const snippet of doc.snippets) {
    let error: string | undefined;
    if (snippet.enabled) {
      try {
        chunks.push(sanitizeUserCss(snippet.css, allowedHooks(), themeProfile().gate));
      } catch (reason) {
        error = reason instanceof Error ? reason.message : String(reason);
        if (rejectInvalid) throw new Error(`${snippet.id}: ${error}`);
      }
    }
    status.push({ id: snippet.id, enabled: snippet.enabled && !error, trust: "local-user", ...(error ? { error } : {}) });
  }
  return { css: chunks.join("\n"), statuses: status };
}

function apply(raw: string, rejectInvalid: boolean): void {
  const result = compile(raw, rejectInvalid);
  mountUserSnippets(result.css);
  statuses = result.statuses;
}

export function cssSnippetCatalog(): readonly CssSnippetStatus[] {
  return statuses;
}

/** Preview never writes settings. Cancel restores the exact saved snapshot. */
export function previewCssSnippets(raw: string): void {
  apply(raw, true);
  preview = raw;
}

export function cancelCssSnippetsPreview(): void {
  preview = null;
  try {
    apply(saved, false);
  } catch (reason) {
    // An externally edited or future-version document must not leave the
    // preview active or prevent closing settings. Keep saved bytes untouched.
    statuses = [{
      id: "(stored)", enabled: false, trust: "local-user",
      error: reason instanceof Error ? reason.message : String(reason),
    }];
    document.head.querySelector('style[data-fub="snippets"]')?.remove();
  }
}

export async function saveCssSnippets(raw: string): Promise<void> {
  compile(raw, true);
  await api.setSetting(CSS_SNIPPETS_KEY, raw);
  saved = raw;
  preview = null;
  apply(saved, false);
}

export async function disableCssSnippet(id: string): Promise<void> {
  const doc = parseCssSnippets(saved);
  if (!doc.snippets.some((snippet) => snippet.id === id)) throw new Error(`unknown CSS snippet ${id}`);
  const raw = JSON.stringify({ ...doc, snippets: doc.snippets.map((snippet) =>
    snippet.id === id ? { ...snippet, enabled: false } : snippet) });
  await api.setSetting(CSS_SNIPPETS_KEY, raw);
  saved = raw;
  preview = null;
  apply(saved, false);
}

/** Machine setting changes from another window are applied only if still current. */
export function mountCssSnippets(lifetime: Lifetime): void {
  if (lifetime.closed) return;
  const reread = async () => {
    const generation = ++epoch;
    try {
      const entry = (await settings()).find((item) => item.spec.key === CSS_SNIPPETS_KEY);
      if (lifetime.closed || generation !== epoch) return;
      saved = typeof entry?.value === "string" ? entry.value : DEFAULT_CSS_SNIPPETS;
      if (!preview) apply(saved, false);
    } catch {
      if (!lifetime.closed && generation === epoch && !preview) {
        statuses = [];
        mountUserSnippets("");
      }
    }
  };
  lifetime.add(onEvent("setting_changed", (event) => {
    if (event.key === CSS_SNIPPETS_KEY) void reread();
  }));
  lifetime.add(() => {
    epoch++;
    preview = null;
    statuses = [];
    document.head.querySelector('style[data-fub="snippets"]')?.remove();
  });
  void reread();
}

/// Che cosa è successo ai frammenti CSS di un import da Obsidian.
export interface SnippetImport {
  added: number;
  on: number;
  same: number;
  /// Per nome: i frammenti che Fub non applica (scritti per gli agganci di
  /// Obsidian, oltre il limite, accesi di là ma senza file).
  lost: string[];
}

/// L'id con cui un frammento di Obsidian entra fra quelli di Fub.
export function obsidianSnippetId(name: string): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^[^a-z0-9]+|-+$/g, "");
  return `obsidian-${slug || "frammento"}`.slice(0, 64);
}

/// I frammenti di `.obsidian/snippets/` che l'host ha letto (`settings.import_obsidian`),
/// portati fra quelli di Fub. Ognuno passa dallo stesso vaglio di un frammento
/// scritto a mano: quello che regge si accende se era acceso in Obsidian,
/// quello che nomina agganci che Fub non ha entra spento — lo si può correggere
/// dalle impostazioni — e si nomina. Un id che c'è già non si riscrive.
export async function importObsidianSnippets(payload: unknown): Promise<SnippetImport> {
  const record = payload && typeof payload === "object" ? payload as { files?: unknown; enabled?: unknown } : {};
  const files = Array.isArray(record.files)
    ? record.files.filter((f): f is { name: string; css: string } =>
      !!f && typeof f === "object" && typeof (f as { name?: unknown }).name === "string" && typeof (f as { css?: unknown }).css === "string")
    : [];
  const enabled = new Set(Array.isArray(record.enabled) ? record.enabled.filter((n): n is string => typeof n === "string") : []);
  const out: SnippetImport = { added: 0, on: 0, same: 0, lost: [] };
  for (const name of enabled) {
    if (!files.some((f) => f.name === name)) out.lost.push(name);
  }
  if (files.length === 0) return out;
  const entry = (await settings()).find((item) => item.spec.key === CSS_SNIPPETS_KEY);
  // Un documento di una versione futura o rovinato non si riscrive: lo dice
  // `parseCssSnippets`, e i frammenti restano fuori, per nome.
  const doc = parseCssSnippets(typeof entry?.value === "string" ? entry.value : DEFAULT_CSS_SNIPPETS);
  const snippets: CssSnippet[] = [...doc.snippets];
  for (const file of files) {
    const id = obsidianSnippetId(file.name);
    if (snippets.some((snippet) => snippet.id === id)) {
      out.same++;
      continue;
    }
    if (snippets.length >= 32) {
      out.lost.push(file.name);
      continue;
    }
    let fits = true;
    try {
      sanitizeUserCss(file.css, allowedHooks(), themeProfile().gate);
    } catch {
      fits = false;
      out.lost.push(file.name);
    }
    const on = fits && enabled.has(file.name);
    snippets.push({ id, css: file.css, enabled: on });
    out.added++;
    if (on) out.on++;
  }
  if (out.added > 0) await saveCssSnippets(JSON.stringify({ ...doc, snippets }));
  return out;
}
