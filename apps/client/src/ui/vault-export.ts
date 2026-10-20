// «Esporta…»: la finestra di `vault.export`, il comando dell'host che porta il
// vault intero, o una sua cartella, in una cartella nuova del disco.
//
// Il comando non cambia: stessi parametri, stesso esito. Cambia chi chiede
// gli argomenti (`registerCommandForm`): il formato fra quelli che i provider
// registrano, la cartella del vault con i suggerimenti, le opzioni del formato
// come interruttori invece di JSON scritto a mano, e la destinazione col
// dialogo di sistema. Prima di partire si salva ciò che è ancora in coda:
// l'host esporta ciò che è sul disco.
//
// # Ciò che non è passato
//
// L'esito resta nella finestra: quanti file, dove, e gli avvisi dell'exporter
// uno per riga (un allegato che non c'è, una nota che il formato non sa
// scrivere). Una notifica che sparisce non è il posto per un elenco di
// perdite.
import { errorText } from "../host/errors";
import { api } from "../host/ipc";
import { vaultFolders } from "../host/query";
import type { CommandOutcome, ParamSpec } from "../host/contract";
import { t, type Key } from "../i18n/strings";
import { state } from "../state/store";
import { identifier } from "./a11y";
import { actions, openFrame } from "./dialogs";
import type { PaletteHost } from "./palette";
import { withPathPicker } from "./path-fields";

/// L'id del comando dell'host.
export const VAULT_EXPORT = "vault.export";

/// Quante cartelle si suggeriscono.
const FOLDER_SUGGESTIONS = 200;

/// Le opzioni che un formato capisce, come interruttori: l'id dell'opzione e
/// il suo valore se non la si tocca. Un formato che non è qui non ne ha.
const FORMAT_OPTIONS: Readonly<Record<string, readonly { key: string; label: Key; initial: boolean }[]>> = {
  "markdown.files": [
    { key: "frontmatter", label: "export.option.frontmatter", initial: true },
    { key: "attachments", label: "export.option.attachments", initial: true },
  ],
  "markdown.single": [{ key: "frontmatter", label: "export.option.frontmatter", initial: true }],
};

/// Un avviso del rapporto, come lo manda l'host.
interface ExportNote {
  level: "info" | "warning" | "error";
  message: string;
  entry: string | null;
}

/// Il rapporto nell'esito del comando, se c'è.
export function exportReport(outcome: CommandOutcome): { target: string; artifacts: number; log: ExportNote[] } | null {
  const effect = outcome.effect;
  if (effect.kind !== "custom" || effect.ns !== "fub.vault.exported") return null;
  const payload = effect.payload as { target?: unknown; artifacts?: unknown; log?: unknown };
  if (typeof payload.target !== "string" || typeof payload.artifacts !== "number") return null;
  const log = Array.isArray(payload.log) ? (payload.log as ExportNote[]) : [];
  return { target: payload.target, artifacts: payload.artifacts, log };
}

/// Una voce di un elenco: `new Option` non c'è in ogni DOM.
function option(label: string, value: string): HTMLOptionElement {
  const node = document.createElement("option");
  node.value = value;
  node.textContent = label;
  return node;
}

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/// La finestra aperta adesso: ce n'è una sola.
let current: (() => void) | null = null;

/// Apre la finestra. `prefill.folder` è la cartella da cui la si è chiesta.
export function openVaultExport(prefill: Readonly<Record<string, string>>, host: PaletteHost): void {
  current?.();
  const spec = state.commandSpecs.find((candidate) => candidate.id === VAULT_EXPORT);
  if (!spec) return;
  const param = (name: string): ParamSpec | undefined => spec.params.find((candidate) => candidate.name === name);
  const formats = param("format")?.kind;
  const choices = formats?.kind === "choice" ? formats.value : [];

  let closed = false;
  let busy = false;
  const finish = (): void => {
    if (closed) return;
    closed = true;
    if (current === finish) current = null;
    frame.close();
  };
  current = finish;
  const frame = openFrame(t("export.title"), finish);
  frame.box.classList.add("vault-export");

  const form = element("form", "palette-form vault-export-form");
  form.noValidate = true;

  const formatLabel = element("label", "");
  const format = document.createElement("select");
  for (const choice of choices) format.append(option(choice.title, choice.value));
  if (choices.some((choice) => choice.value === "markdown.files")) format.value = "markdown.files";
  formatLabel.append(element("span", "palette-label", t("export.format")), format);

  const folderLabel = element("label", "");
  const folder = document.createElement("input");
  folder.type = "text";
  folder.autocomplete = "off";
  folder.spellcheck = false;
  folder.placeholder = t("export.folder.placeholder");
  folder.value = (prefill.folder ?? "").replace(/^\/+|\/+$/g, "");
  const folderList = document.createElement("datalist");
  folderList.id = identifier("vault-export-folders");
  folder.setAttribute("list", folderList.id);
  folderLabel.append(element("span", "palette-label", t("export.folder")), folder, folderList);

  const options = element("fieldset", "vault-export-options");
  options.append(element("legend", "palette-label", t("export.options")));
  const switches = new Map<string, HTMLInputElement>();
  const showOptions = (): void => {
    const own = FORMAT_OPTIONS[format.value] ?? [];
    switches.clear();
    options.replaceChildren(element("legend", "palette-label", t("export.options")));
    for (const option of own) {
      const label = element("label", "vault-export-option");
      const box = document.createElement("input");
      box.type = "checkbox";
      box.checked = option.initial;
      switches.set(option.key, box);
      label.append(box, document.createTextNode(` ${t(option.label)}`));
      options.append(label);
    }
    options.hidden = own.length === 0;
  };
  format.addEventListener("change", showOptions);
  showOptions();

  const targetTitle = param("target")?.title ?? t("export.target");
  const targetLabel = element("label", "");
  const target = document.createElement("input");
  target.type = "text";
  target.autocomplete = "off";
  target.spellcheck = false;
  targetLabel.append(element("span", "palette-label", t("export.target")), withPathPicker(VAULT_EXPORT, "target", targetTitle, target));

  const alert = element("div", "vault-export-alert");
  alert.setAttribute("role", "alert");
  const result = element("section", "vault-export-result");
  result.setAttribute("role", "status");
  result.hidden = true;

  const row = actions(t("export.run"), finish);
  const submit = row.querySelector<HTMLButtonElement>("button[type=submit]")!;
  const cancel = row.querySelector<HTMLButtonElement>("button[type=button]")!;
  form.append(formatLabel, folderLabel, options, targetLabel, alert, result, row);
  frame.box.append(form);

  const showError = (message: string): void => {
    alert.replaceChildren(element("p", "palette-error", message));
  };

  /// L'esito al posto del modulo: dove, quanti, e ogni avviso.
  const showResult = (outcome: CommandOutcome): void => {
    const report = exportReport(outcome);
    for (const field of [formatLabel, folderLabel, options, targetLabel]) field.hidden = true;
    submit.hidden = true;
    cancel.textContent = t("app.close");
    result.hidden = false;
    result.replaceChildren(element("p", "vault-export-summary", outcome.notify ?? ""));
    const notes = report?.log.filter((note) => note.level !== "info") ?? [];
    const infos = report?.log.filter((note) => note.level === "info") ?? [];
    if (notes.length > 0 || infos.length > 0) {
      const heading = element("h3", "vault-export-notes-title", t("export.notes", { count: notes.length }));
      const list = element("ul", "vault-export-notes");
      for (const note of [...notes, ...infos]) {
        const item = element("li", `vault-export-note is-${note.level}`);
        item.textContent = note.entry ? `${note.entry}: ${note.message}` : note.message;
        list.append(item);
      }
      result.append(heading, list);
    }
    cancel.focus();
  };

  const run = async (): Promise<void> => {
    if (busy || closed) return;
    alert.replaceChildren();
    if (target.value.trim() === "") {
      showError(t("export.error.target"));
      target.focus();
      return;
    }
    busy = true;
    submit.disabled = true;
    form.setAttribute("aria-busy", "true");
    try {
      const unsaved = await host.flushPendingSave();
      if (unsaved.length > 0) {
        showError(t("export.error.unsaved", { docs: unsaved.join(", ") }));
        return;
      }
      const chosen: Record<string, boolean> = {};
      for (const [key, box] of switches) chosen[key] = box.checked;
      const args: Record<string, unknown> = {
        format: format.value,
        folder: folder.value.trim(),
        target: target.value.trim(),
      };
      if (switches.size > 0) args.options_json = JSON.stringify(chosen);
      const outcome = await api.invokeCommand(VAULT_EXPORT, args, "apply");
      if (closed) {
        if (outcome.notify) host.notify(outcome.notify, "info");
        return;
      }
      showResult(outcome);
    } catch (error) {
      const message = t("export.error.failed", { reason: errorText(error) });
      if (closed) host.notify(message, "guasto");
      else showError(message);
    } finally {
      busy = false;
      submit.disabled = false;
      form.removeAttribute("aria-busy");
    }
  };
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    void run();
  });

  void vaultFolders({ offset: 0, limit: FOLDER_SUGGESTIONS })
    .then((folders) => {
      if (closed) return;
      for (const entry of folders.items) folderList.append(option(entry.path, entry.path));
    })
    .catch(() => {});
  (choices.length > 1 ? format : target).focus();
}
