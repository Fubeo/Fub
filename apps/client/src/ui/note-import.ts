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
import { identifier } from "./a11y";
import { actions, openFrame } from "./dialogs";
import { openLifetime, type Lifetime } from "./lifetime";
import type { PaletteHost } from "./palette";

/// Il comando che apre la finestra: è quello che la palette mostra.
export const IMPORT_PREPARE = "import.prepare";

/// Quanto pesa al più una sorgente che passa intera dal confine: il tetto
/// dell'importer (`MAX_SOURCE_BYTES`).
export const MAX_IMPORT_BYTES = 64 * 1024 * 1024;

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
  /// Il job depositato e non ancora importato: chiudendo, si toglie.
  let staged: string | null = null;
  /// Il job importato, finché lo si può annullare.
  let committed: string | null = null;

  const finish = (): void => {
    if (closed) return;
    closed = true;
    if (current === finish) current = null;
    const leftover = staged;
    staged = null;
    life.close();
    frame.close();
    if (leftover !== null) {
      dropStaged(leftover);
    }
  };
  current = finish;
  const frame = openFrame(t("import.title"), finish);
  frame.box.classList.add("note-import");

  const form = element("form", "palette-form note-import-form");
  form.noValidate = true;

  // --- La sorgente e dove atterra ----------------------------------------

  const fields = element("div", "note-import-fields");
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
  fields.append(fileRow, folderLabel, conflictLabel);

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
    if (file === null) {
      showError(t("import.error.no_file"));
      choose.focus();
      return;
    }
    if (file.size > MAX_IMPORT_BYTES) {
      showError(t("import.error.too_big", { name: file.name, max: MAX_IMPORT_BYTES / (1024 * 1024) }));
      return;
    }
    working(true, t("import.reading"));
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (closed) return;
      const job = newJobId();
      const request = { mode: "apply", folder: folder.value.trim().replace(/^\/+|\/+$/g, ""), on_conflict: conflict.value, options: {} };
      status.textContent = t("import.preparing");
      const manifest = await runTransfer(
        IMPORT_PREPARE,
        { job, source_json: sourceJson(file.name, file.type === "" ? null : file.type, bytes), request_json: JSON.stringify(request) },
      );
      if (closed) {
        // La finestra è andata via durante l'anteprima: la sorgente
        // depositata non serve a nessuno.
        dropStaged(job);
        return;
      }
      staged = job;
      const result = planOf(manifest);
      showPlan(t("import.plan", { name: file.name }), result);
      const count = tally(result.documents);
      fields.hidden = true;
      submit.textContent = t("import.commit", { count: count.created + count.replaced });
      submit.disabled = count.created + count.replaced === 0;
      status.textContent = "";
      busy = false;
      form.removeAttribute("aria-busy");
      if (!submit.disabled) submit.focus();
      return;
    } catch (error) {
      if (!closed) showError(t("import.error.failed", { reason: errorText(error) }));
    }
    if (!closed) working(false);
  };

  const commit = async (): Promise<void> => {
    if (staged === null) return;
    const job = staged;
    working(true, t("import.committing"));
    try {
      const report = await runTransfer("import.commit", { job });
      staged = null;
      committed = job;
      if (closed) {
        host.notify(t("import.done", { count: tally(planOf({ preview: report }).documents).created }), "info");
        return;
      }
      const result = planOf({ preview: report });
      const count = tally(result.documents);
      showPlan(t("import.done_title"), result);
      submit.hidden = true;
      undo.hidden = false;
      cancel.textContent = t("app.close");
      host.notify(t("import.done", { count: count.created + count.replaced }), "info");
      working(false);
      cancel.focus();
    } catch (error) {
      if (closed) host.notify(t("import.error.failed", { reason: errorText(error) }), "guasto");
      else {
        showError(t("import.error.failed", { reason: errorText(error) }));
        working(false);
      }
    }
  };

  const rollback = async (): Promise<void> => {
    if (committed === null || busy) return;
    const job = committed;
    working(true, t("import.rolling_back"));
    try {
      await runTransfer("import.rollback", { job });
      committed = null;
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
  life.listen(form, "submit", (event) => {
    event.preventDefault();
    if (busy || closed) return;
    alert.replaceChildren();
    void (staged === null ? preview() : commit());
  });

  void vaultFolders({ offset: 0, limit: FOLDER_SUGGESTIONS })
    .then((folders) => {
      if (closed) return;
      for (const entry of folders.items) folderList.append(option(entry.path, entry.path));
    })
    .catch(() => {});
  (file === null ? choose : submit).focus();
}
