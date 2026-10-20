// «Importa note…»: la finestra dei comandi `import.*`, cioè dell'import a
// tappe che il core sa già fare (anteprima, commit, rollback), finora
// raggiungibile soltanto scrivendo JSON nella palette.
//
// # Le tappe
//
// 1. Si sceglie un file e la cartella del vault dove atterra, con la politica
//    dei conflitti: si salta ciò che c'è (di serie), si entra accanto con un
//    nome libero, o si sostituisce.
// 2. «Anteprima» deposita la sorgente (`import.prepare`) e aspetta il suo job:
//    la finestra mostra quante note entrerebbero, dove, e ciò che non passa.
//    Niente è scritto nel vault.
// 3. «Importa» esegue il piano (`import.commit`); l'esito dice cosa è entrato e
//    offre «Annulla l'import» (`import.rollback`), che rimette i file come
//    erano finché nessuno li ha toccati dopo.
//
// # Archivi grandi
//
// Un archivio ZIP oltre 64 MiB o 10 000 voci non passa intero: la finestra ne
// legge la directory e lo divide in parti (`zip-parts.ts`). Ogni parte è un job
// con la sua anteprima e la sua ricevuta; il piano le mostra insieme, l'import
// le esegue in ordine e l'annullamento le toglie dall'ultima. Una voce che non
// sta in nessuna parte è fra le perdite del piano.
//
// # Notion e Airtable
//
// La sorgente può essere anche un connettore: allora non c'è un file ma l'id
// di una pagina, di un database o di una base, e il connettore legge dalla
// sua API quando il job parte. Il token non passa mai dalla richiesta
// d'import (l'host la rifiuterebbe, e finirebbe nel payload del job): si salva
// una volta sulla macchina con `connector.token`, e la finestra sa soltanto
// se c'è (`connector.tokens`).
//
// Chiudere la finestra dopo l'anteprima toglie la sorgente depositata
// (`import.cancel`): un'anteprima abbandonata non resta nello spazio del
// plugin. L'id del job che si aspetta arriva tipizzato nell'esito del comando
// (`fub.transfer.queued`), e il `job_done` si riconosce da quello.
import { asPluginError, errorText } from "../host/errors";
import { api } from "../host/ipc";
import { vaultFolders } from "../host/query";
import type { CommandOutcome } from "../host/contract";
import { t } from "../i18n/strings";
import { onEvent } from "../state/kernel";
import { state } from "../state/store";
import { identifier } from "./a11y";
import { actions, openFrame } from "./dialogs";
import { openLifetime, type Lifetime } from "./lifetime";
import { buildPart, partName, planParts, readDirectory, type ZipEntry } from "./zip-parts";
import type { PaletteHost } from "./palette";

/// Il comando che apre la finestra: è quello che la palette mostra.
export const IMPORT_PREPARE = "import.prepare";

/// Quanto pesa al più una sorgente che passa intera dal confine: il tetto
/// dell'importer (`MAX_SOURCE_BYTES`).
export const MAX_IMPORT_BYTES = 64 * 1024 * 1024;

/// Quante voci ha al più un archivio che passa intero (`MAX_ENTRIES`).
export const MAX_ARCHIVE_ENTRIES = 10_000;

/// Una sorgente da depositare: un file, una parte di un archivio, un
/// connettore. I byte si leggono quando tocca a lei.
interface Piece {
  readonly name: string;
  readonly mediaType: string | null;
  read(): Promise<Uint8Array>;
  readonly extra: Record<string, unknown>;
}

/// Un archivio ZIP, dall'estensione o dal tipo.
function isZip(file: File): boolean {
  return /\.zip$/i.test(file.name) || file.type === "application/zip" || file.type === "application/x-zip-compressed";
}

/// Quante note dell'anteprima si elencano una per una.
const LISTED = 50;

const FOLDER_SUGGESTIONS = 200;

/// Un documento del piano o dell'esito, come lo manda l'importer.
export interface ImportedDoc {
  doc: string;
  outcome: { kind: "created" | "replaced" | "skipped" } | { kind: "failed"; value: string };
  entry: string | null;
}

export interface ImportNote {
  level: "info" | "warning" | "error";
  message: string;
  entry: string | null;
}

export interface ImportPlan {
  documents: ImportedDoc[];
  log: ImportNote[];
  losses: string[];
}

/// L'id del job che un comando di transfer ha accodato, dall'esito tipizzato.
export function queuedJob(outcome: CommandOutcome): string | null {
  const effect = outcome.effect;
  if (effect.kind !== "custom" || effect.ns !== "fub.transfer.queued") return null;
  const id = (effect.payload as { job_id?: unknown } | null)?.job_id;
  return typeof id === "string" ? id : null;
}

/// La sorgente come `ImportSource` serializzato. I byte si scrivono con un
/// `join`, senza passare da un array di numeri JavaScript: per un archivio da
/// decine di MiB è la differenza fra una stringa e un milione di oggetti.
export function sourceJson(name: string, mediaType: string | null, bytes: Uint8Array): string {
  return `{"name":${JSON.stringify(name)},"media_type":${JSON.stringify(mediaType)},"content":{"kind":"bytes","value":[${bytes.join(",")}]}}`;
}

/// Le sorgenti che non sono un file: l'id è anche il nome del connettore.
export type ConnectorId = "notion" | "airtable";

/// L'id di una pagina o di un database Notion, anche da un link copiato:
/// sono 32 cifre esadecimali, con o senza trattini, in fondo al path.
export function notionId(raw: string): string {
  const text = raw.trim();
  const path = text.split(/[?#]/)[0] ?? text;
  const found = path.match(/([0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12})(?!.*[0-9a-f]{32})/i);
  return found ? found[1]!.replace(/-/g, "").toLowerCase() : text;
}

/// L'id di una base Airtable, anche da un link: `app` e quattordici caratteri.
export function airtableBase(raw: string): string {
  const text = raw.trim();
  return text.match(/\bapp[A-Za-z0-9]{14}\b/)?.[0] ?? text;
}

/// I connettori che hanno un token salvato, dall'esito di `connector.tokens`.
export function savedTokens(outcome: CommandOutcome): ConnectorId[] {
  const effect = outcome.effect;
  if (effect.kind !== "custom" || effect.ns !== "fub.connector.tokens") return [];
  const saved = (effect.payload as { saved?: unknown } | null)?.saved;
  return Array.isArray(saved) ? saved.filter((id): id is ConnectorId => id === "notion" || id === "airtable") : [];
}

/// Un id di job nuovo: lettere, cifre e trattini, come vuole lo staging.
function newJobId(): string {
  return `shell-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/// Esegue un comando di transfer e aspetta il suo job. Rifiuta con l'errore
/// del job, o se il vault si chiude prima.
///
/// Gli ascolti hanno una vita propria, che finisce con la risposta: un commit
/// chiesto da una finestra che poi si chiude arriva lo stesso al suo esito.
export async function runTransfer(command: string, args: Record<string, unknown>): Promise<unknown> {
  const life = openLifetime();
  // Ci si iscrive prima di chiedere: un job veloce può finire prima che
  // l'esito del comando torni.
  const finished = new Map<string, unknown>();
  let waiting: { id: string; resolve(value: unknown): void; reject(error: unknown): void } | null = null;
  let closedVault = false;
  const settle = (id: string, result: unknown): void => {
    if (waiting === null || waiting.id !== id) {
      finished.set(id, result);
      return;
    }
    const { resolve, reject } = waiting;
    waiting = null;
    const outcome = result as { Ok?: unknown; Err?: unknown } | null;
    if (outcome && "Err" in outcome) reject(outcome.Err);
    else resolve(outcome?.Ok);
  };
  life.add(onEvent("job_done", (event) => settle(event.id, event.result)));
  life.add(
    onEvent("vault_closed", () => {
      closedVault = true;
      waiting?.reject(new Error(t("import.error.vault_closed")));
      waiting = null;
    }),
  );
  try {
    const outcome = await api.invokeCommand(command, args, "apply");
    const id = queuedJob(outcome);
    if (id === null) throw new Error(t("import.error.no_job", { command }));
    return await new Promise((resolve, reject) => {
      if (closedVault) {
        reject(new Error(t("import.error.vault_closed")));
        return;
      }
      waiting = { id, resolve, reject };
      if (finished.has(id)) settle(id, finished.get(id));
    });
  } finally {
    life.close();
  }
}

/// Il piano dal manifest che `import.prepare` restituisce.
export function planOf(manifest: unknown): ImportPlan {
  const value = (manifest ?? {}) as { preview?: { documents?: unknown; log?: unknown }; losses?: unknown };
  return {
    documents: Array.isArray(value.preview?.documents) ? (value.preview.documents as ImportedDoc[]) : [],
    log: Array.isArray(value.preview?.log) ? (value.preview.log as ImportNote[]) : [],
    losses: Array.isArray(value.losses) ? (value.losses as unknown[]).filter((line): line is string => typeof line === "string") : [],
  };
}

/// Quanti documenti per esito.
export function tally(documents: readonly ImportedDoc[]): { created: number; replaced: number; skipped: number; failed: number } {
  const count = { created: 0, replaced: 0, skipped: 0, failed: 0 };
  for (const doc of documents) count[doc.outcome.kind] += 1;
  return count;
}

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function option(label: string, value: string): HTMLOptionElement {
  const node = document.createElement("option");
  node.value = value;
  node.textContent = label;
  return node;
}

/// Una riga dell'elenco per un documento.
function docLine(doc: ImportedDoc): string {
  const outcome = doc.outcome;
  const what =
    outcome.kind === "failed"
      ? t("import.outcome.failed", { reason: outcome.value })
      : t(outcome.kind === "created" ? "import.outcome.created" : outcome.kind === "replaced" ? "import.outcome.replaced" : "import.outcome.skipped");
  return `${doc.doc} — ${what}`;
}

/// Toglie una sorgente depositata e mai importata. Un errore qui non ha
/// nessuno a cui dirlo: la finestra è già andata via, e ciò che resta lo
/// ritrova `import.status`.
function dropStaged(job: string): void {
  void Promise.resolve()
    .then(() => api.invokeCommand("import.cancel", { job }, "apply"))
    .catch(() => {});
}

/// La finestra aperta adesso: ce n'è una sola.
let current: (() => void) | null = null;

export interface NoteImportOptions {
  /// Un file già scelto (trascinato, o dal menu): si salta la scelta.
  readonly file?: File;
  /// Il selettore di file; quello del browser, se manca.
  readonly pick?: () => Promise<File | null>;
}

/// Il selettore di file del browser: un `input[type=file]` nascosto.
function browserPick(life: Lifetime): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.hidden = true;
    let answered = false;
    const answer = (file: File | null): void => {
      if (answered) return;
      answered = true;
      input.remove();
      resolve(file);
    };
    life.listen(input, "change", () => answer(input.files?.[0] ?? null));
    life.listen(input, "cancel", () => answer(null));
    document.body.append(input);
    input.click();
  });
}

/// Apre la finestra. `prefill.folder` è la cartella da cui la si è chiesta.
export function openNoteImport(prefill: Readonly<Record<string, string>>, host: PaletteHost, options: NoteImportOptions = {}): void {
  current?.();
  const life = openLifetime();
  let closed = false;
  let busy = false;
  let file: File | null = options.file ?? null;
  /// I job depositati e non ancora importati, uno per parte: chiudendo, si
  /// tolgono.
  let staged: string[] = [];
  /// I job importati, finché li si può annullare.
  let committed: string[] = [];

  const finish = (): void => {
    if (closed) return;
    closed = true;
    if (current === finish) current = null;
    const leftover = staged;
    staged = [];
    life.close();
    frame.close();
    for (const job of leftover) dropStaged(job);
  };
  current = finish;
  const frame = openFrame(t("import.title"), finish);
  frame.box.classList.add("note-import");

  const form = element("form", "palette-form note-import-form");
  form.noValidate = true;

  // --- La sorgente e dove atterra ----------------------------------------

  const fields = element("div", "note-import-fields");
  const connectors = state.commandSpecs.some((spec) => spec.id === "connector.token");
  const kindLabel = element("label", "");
  const kind = document.createElement("select");
  kind.append(option(t("import.source.file"), "file"), option("Notion", "notion"), option("Airtable", "airtable"));
  kindLabel.append(element("span", "palette-label", t("import.source")), kind);
  kindLabel.hidden = !connectors;

  const fileRow = element("div", "note-import-file");
  const choose = element("button", "", t("import.choose"));
  choose.type = "button";
  const fileName = element("span", "note-import-file-name", t("import.no_file"));
  fileName.id = identifier("note-import-file");
  choose.setAttribute("aria-describedby", fileName.id);
  fileRow.append(choose, fileName);

  const folderLabel = element("label", "");
  const folder = document.createElement("input");
  folder.type = "text";
  folder.autocomplete = "off";
  folder.spellcheck = false;
  folder.placeholder = t("import.folder.placeholder");
  folder.value = (prefill.folder ?? "").replace(/^\/+|\/+$/g, "");
  const folderList = document.createElement("datalist");
  folderList.id = identifier("note-import-folders");
  folder.setAttribute("list", folderList.id);
  folderLabel.append(element("span", "palette-label", t("import.folder")), folder, folderList);

  const conflictLabel = element("label", "");
  const conflict = document.createElement("select");
  conflict.append(
    option(t("import.conflict.skip"), "skip"),
    option(t("import.conflict.rename"), "rename"),
    option(t("import.conflict.replace"), "replace"),
  );
  conflictLabel.append(element("span", "palette-label", t("import.conflict")), conflict);
  // --- Il connettore: l'id e il token ----------------------------------------

  const remote = element("div", "note-import-remote");
  remote.hidden = true;
  const idLabel = element("label", "");
  const remoteId = document.createElement("input");
  remoteId.type = "text";
  remoteId.autocomplete = "off";
  remoteId.spellcheck = false;
  const idTitle = element("span", "palette-label");
  idLabel.append(idTitle, remoteId);
  const tablesLabel = element("label", "");
  const tables = document.createElement("input");
  tables.type = "text";
  tables.autocomplete = "off";
  tables.spellcheck = false;
  tables.placeholder = t("import.airtable.tables.placeholder");
  tablesLabel.append(element("span", "palette-label", t("import.airtable.tables")), tables);

  const tokenBox = element("fieldset", "note-import-token");
  const tokenLegend = element("legend", "palette-label", t("import.token"));
  const tokenState = element("p", "note-import-token-state");
  tokenState.setAttribute("role", "status");
  const tokenInput = document.createElement("input");
  tokenInput.type = "password";
  tokenInput.autocomplete = "off";
  tokenInput.spellcheck = false;
  tokenInput.id = identifier("note-import-token");
  const tokenInputLabel = element("label", "sr-only", t("import.token.field"));
  tokenInputLabel.htmlFor = tokenInput.id;
  const tokenRow = element("div", "note-import-token-row");
  const saveToken = element("button", "", t("import.token.save"));
  saveToken.type = "button";
  const forgetToken = element("button", "", t("import.token.forget"));
  forgetToken.type = "button";
  tokenRow.append(tokenInput, saveToken, forgetToken);
  tokenBox.append(tokenLegend, tokenState, tokenInputLabel, tokenRow);
  remote.append(idLabel, tablesLabel, tokenBox);

  fields.append(kindLabel, fileRow, remote, folderLabel, conflictLabel);

  const status = element("p", "note-import-status");
  status.setAttribute("role", "status");
  const alert = element("div", "note-import-alert");
  alert.setAttribute("role", "alert");
  const plan = element("section", "note-import-plan");
  plan.hidden = true;

  const row = actions(t("import.preview"), finish);
  const submit = row.querySelector<HTMLButtonElement>("button[type=submit]")!;
  const cancel = row.querySelector<HTMLButtonElement>("button[type=button]")!;
  const undo = element("button", "", t("import.rollback"));
  undo.type = "button";
  undo.hidden = true;
  row.insertBefore(undo, cancel);
  form.append(fields, status, alert, plan, row);
  frame.box.append(form);

  const showError = (message: string): void => {
    alert.replaceChildren(element("p", "palette-error", message));
  };
  const showFile = (): void => {
    fileName.textContent = file === null ? t("import.no_file") : t("import.file", { name: file.name, size: Math.ceil(file.size / 1024) });
  };
  showFile();

  /// I connettori con un token salvato su questa macchina.
  let saved: ConnectorId[] = [];
  const connector = (): ConnectorId | null => (kind.value === "notion" || kind.value === "airtable" ? kind.value : null);
  const showSource = (): void => {
    const which = connector();
    fileRow.hidden = which !== null;
    remote.hidden = which === null;
    if (which === null) return;
    idTitle.textContent = t(which === "notion" ? "import.notion.id" : "import.airtable.base");
    remoteId.placeholder = t(which === "notion" ? "import.notion.id.placeholder" : "import.airtable.base.placeholder");
    tablesLabel.hidden = which !== "airtable";
    const has = saved.includes(which);
    tokenState.textContent = t(has ? "import.token.saved" : "import.token.missing", { connector: which === "notion" ? "Notion" : "Airtable" });
    forgetToken.hidden = !has;
    saveToken.textContent = t(has ? "import.token.replace" : "import.token.save");
  };
  showSource();

  const refreshTokens = async (): Promise<void> => {
    try {
      saved = savedTokens(await api.invokeCommand("connector.tokens", {}, "apply"));
    } catch {
      saved = [];
    }
    if (!closed) showSource();
  };

  const storeToken = async (value: string): Promise<void> => {
    const which = connector();
    if (which === null || busy) return;
    if (value === "" && !saved.includes(which)) return;
    alert.replaceChildren();
    try {
      const outcome = await api.invokeCommand("connector.token", { connector: which, token: value }, "apply");
      // Il campo si svuota subito: il token non resta nel DOM più del
      // necessario.
      tokenInput.value = "";
      saved = savedTokens(outcome);
      if (closed) return;
      showSource();
      if (outcome.notify) status.textContent = outcome.notify;
    } catch (error) {
      if (!closed) showError(t("import.error.token", { reason: errorText(error) }));
    }
  };

  /// Il nome della sorgente e le opzioni del connettore, o un errore da dire.
  const remoteSource = (which: ConnectorId): { name: string; options: Record<string, unknown> } | string => {
    if (which === "notion") {
      const id = notionId(remoteId.value);
      if (id === "") return t("import.error.notion_id");
      return { name: `notion://${id}`, options: { page_id: id } };
    }
    const base = airtableBase(remoteId.value);
    if (base === "") return t("import.error.airtable_base");
    const wanted = tables.value
      .split(",")
      .map((name) => name.trim())
      .filter((name) => name !== "");
    return { name: `airtable://${base}`, options: wanted.length > 0 ? { base_id: base, tables: wanted } : { base_id: base } };
  };

  /// Il piano o l'esito, come elenco: i conteggi, le prime note, le perdite.
  const showPlan = (heading: string, result: ImportPlan): void => {
    plan.hidden = false;
    const count = tally(result.documents);
    const lines = element("ul", "note-import-docs");
    for (const doc of result.documents.slice(0, LISTED)) lines.append(element("li", `note-import-doc is-${doc.outcome.kind}`, docLine(doc)));
    if (result.documents.length > LISTED) lines.append(element("li", "note-import-more", t("import.more", { count: result.documents.length - LISTED })));
    const children: Node[] = [
      element("h3", "note-import-plan-title", heading),
      element("p", "note-import-tally", t("import.tally", count)),
      lines,
    ];
    const warnings = [...result.losses, ...result.log.filter((note) => note.level !== "info").map((note) => (note.entry ? `${note.entry}: ${note.message}` : note.message))];
    if (warnings.length > 0) {
      const losses = element("ul", "note-import-losses");
      for (const line of warnings) losses.append(element("li", "note-import-loss", line));
      children.push(element("h3", "note-import-plan-title", t("import.losses", { count: warnings.length })), losses);
    }
    plan.replaceChildren(...children);
  };

  const working = (on: boolean, message = ""): void => {
    busy = on;
    submit.disabled = on;
    undo.disabled = on;
    status.textContent = message;
    if (on) form.setAttribute("aria-busy", "true");
    else form.removeAttribute("aria-busy");
  };

  const preview = async (): Promise<void> => {
    const which = connector();
    if (which !== null) {
      const source = remoteSource(which);
      if (typeof source === "string") {
        showError(source);
        remoteId.focus();
        return;
      }
      if (!saved.includes(which)) {
        showError(t("import.error.no_token", { connector: which === "notion" ? "Notion" : "Airtable" }));
        tokenInput.focus();
        return;
      }
      await staging([{ name: source.name, mediaType: null, read: () => Promise.resolve(new Uint8Array()), extra: source.options }], which === "notion" ? "Notion" : "Airtable", []);
      return;
    }
    if (file === null) {
      showError(t("import.error.no_file"));
      choose.focus();
      return;
    }
    const chosen = file;
    const mediaType = chosen.type === "" ? null : chosen.type;
    if (isZip(chosen)) {
      // Un archivio si legge prima dalla directory: se non passa intero, si
      // divide in parti che passano.
      working(true, t("import.reading"));
      let entries: ZipEntry[];
      try {
        entries = await readDirectory(chosen);
      } catch (error) {
        if (!closed) {
          showError(t("import.error.failed", { reason: errorText(error) }));
          working(false);
        }
        return;
      }
      if (closed) return;
      if (chosen.size > MAX_IMPORT_BYTES || entries.length > MAX_ARCHIVE_ENTRIES) {
        const { parts, oversized } = planParts(entries);
        const losses = oversized.map((entry) => t("import.parts.oversized", { name: entry.name, size: Math.ceil(entry.size / (1024 * 1024)) }));
        if (parts.length === 0) {
          showError(t("import.error.nothing_fits", { name: chosen.name }));
          working(false);
          return;
        }
        const pieces = parts.map((part, index) => ({
          name: partName(chosen.name, t("import.parts.suffix", { index: index + 1, count: parts.length })),
          mediaType,
          read: () => buildPart(chosen, part),
          extra: {},
        }));
        await staging(pieces, t("import.parts.plan", { name: chosen.name, count: parts.length }), losses);
        return;
      }
    }
    if (chosen.size > MAX_IMPORT_BYTES) {
      showError(t("import.error.too_big", { name: chosen.name, max: MAX_IMPORT_BYTES / (1024 * 1024) }));
      return;
    }
    await staging([{ name: chosen.name, mediaType, read: async () => new Uint8Array(await chosen.arrayBuffer()), extra: {} }], chosen.name, []);
  };

  /// Deposita le sorgenti, una parte dopo l'altra, e mostra il piano di
  /// tutte. Se una parte non passa l'anteprima, si tolgono anche quelle già
  /// depositate: un piano a metà non si importa.
  const staging = async (pieces: readonly Piece[], label: string, losses: readonly string[]): Promise<void> => {
    working(true, t("import.preparing"));
    const jobs: string[] = [];
    const merged: ImportPlan = { documents: [], log: [], losses: [...losses] };
    try {
      for (const [index, piece] of pieces.entries()) {
        if (pieces.length > 1) status.textContent = t("import.parts.preparing", { index: index + 1, count: pieces.length });
        const bytes = await piece.read();
        if (closed) break;
        const job = newJobId();
        const request = { mode: "apply", folder: folder.value.trim().replace(/^\/+|\/+$/g, ""), on_conflict: conflict.value, options: piece.extra };
        jobs.push(job);
        const result = planOf(await runTransfer(IMPORT_PREPARE, { job, source_json: sourceJson(piece.name, piece.mediaType, bytes), request_json: JSON.stringify(request) }));
        merged.documents.push(...result.documents);
        merged.log.push(...result.log);
        merged.losses.push(...result.losses);
        if (closed) break;
      }
      if (closed) {
        // La finestra è andata via durante l'anteprima: le sorgenti
        // depositate non servono a nessuno.
        for (const job of jobs) dropStaged(job);
        return;
      }
      staged = jobs;
      showPlan(t("import.plan", { name: label }), merged);
      const count = tally(merged.documents);
      fields.hidden = true;
      submit.textContent = t("import.commit", { count: count.created + count.replaced });
      submit.disabled = count.created + count.replaced === 0;
      status.textContent = "";
      busy = false;
      form.removeAttribute("aria-busy");
      if (!submit.disabled) submit.focus();
      return;
    } catch (error) {
      for (const job of jobs) dropStaged(job);
      if (!closed) showError(t("import.error.failed", { reason: errorText(error) }));
    }
    if (!closed) working(false);
  };

  /// Importa le parti in ordine. Una parte che fallisce ferma le seguenti, che
  /// restano depositate: «Importa» riprende da lì, «Annulla l'import» toglie
  /// quelle già entrate.
  const commit = async (): Promise<void> => {
    if (staged.length === 0) return;
    working(true, t("import.committing"));
    const total = staged.length + committed.length;
    const merged: ImportPlan = { documents: [], log: [], losses: [] };
    try {
      while (staged.length > 0) {
        const job = staged[0]!;
        if (total > 1) status.textContent = t("import.parts.committing", { index: committed.length + 1, count: total });
        const report = await runTransfer("import.commit", { job });
        staged = staged.slice(1);
        committed = [...committed, job];
        const result = planOf({ preview: report });
        merged.documents.push(...result.documents);
        merged.log.push(...result.log);
      }
      const count = tally(merged.documents);
      host.notify(t("import.done", { count: count.created + count.replaced }), "info");
      if (closed) return;
      showPlan(t("import.done_title"), merged);
      submit.hidden = true;
      undo.hidden = false;
      cancel.textContent = t("app.close");
      working(false);
      cancel.focus();
    } catch (error) {
      const reason = errorText(error);
      const message = total > 1 && committed.length > 0 ? t("import.error.part_failed", { done: committed.length, count: total, reason }) : t("import.error.failed", { reason });
      if (closed) host.notify(message, "guasto");
      else {
        if (merged.documents.length > 0) showPlan(t("import.done_title"), merged);
        showError(message);
        undo.hidden = committed.length === 0;
        working(false);
      }
    }
  };

  /// Annulla le parti importate, dall'ultima alla prima.
  const rollback = async (): Promise<void> => {
    if (committed.length === 0 || busy) return;
    working(true, t("import.rolling_back"));
    try {
      while (committed.length > 0) {
        const job = committed[committed.length - 1]!;
        await runTransfer("import.rollback", { job });
        committed = committed.slice(0, -1);
      }
      if (closed) return;
      undo.hidden = true;
      plan.replaceChildren(element("p", "note-import-tally", t("import.rolled_back")));
      host.notify(t("import.rolled_back"), "info");
      working(false);
      cancel.focus();
    } catch (error) {
      // Un conflitto qui è la regola che protegge il lavoro fatto dopo:
      // il rollback non tocca un file cambiato da allora, e lo dice.
      const conflictNow = asPluginError(error)?.kind === "conflict";
      const message = conflictNow ? t("import.error.rollback_conflict", { reason: errorText(error) }) : t("import.error.failed", { reason: errorText(error) });
      if (closed) host.notify(message, "guasto");
      else {
        showError(message);
        working(false);
      }
    }
  };

  life.listen(choose, "click", () => {
    void (options.pick ?? (() => browserPick(life)))().then((picked) => {
      if (closed || picked === null) return;
      file = picked;
      alert.replaceChildren();
      showFile();
    });
  });
  life.listen(undo, "click", () => void rollback());
  life.listen(kind, "change", () => {
    // L'id di un connettore non vale per l'altro.
    remoteId.value = "";
    tables.value = "";
    alert.replaceChildren();
    showSource();
  });
  life.listen(saveToken, "click", () => {
    const value = tokenInput.value.trim();
    if (value === "") {
      showError(t("import.error.empty_token"));
      tokenInput.focus();
      return;
    }
    void storeToken(value);
  });
  life.listen(forgetToken, "click", () => void storeToken(""));
  life.listen(tokenInput, "keydown", (event) => {
    // Invio nel campo del token salva il token, non avvia l'anteprima.
    if (event.key !== "Enter") return;
    event.preventDefault();
    saveToken.click();
  });
  life.listen(form, "submit", (event) => {
    event.preventDefault();
    if (busy || closed) return;
    alert.replaceChildren();
    void (staged.length === 0 ? preview() : commit());
  });

  if (connectors) void refreshTokens();
  void vaultFolders({ offset: 0, limit: FOLDER_SUGGESTIONS })
    .then((folders) => {
      if (closed) return;
      for (const entry of folders.items) folderList.append(option(entry.path, entry.path));
    })
    .catch(() => {});
  (file === null ? choose : submit).focus();
}
