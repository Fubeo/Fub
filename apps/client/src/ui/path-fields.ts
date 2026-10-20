// I parametri di un comando che sono cartelle **fuori** dal vault.
//
// La spec del comando li dichiara testo — un path assoluto è testo, e il
// contratto non ha una specie «cartella del disco» — ma scriverli a mano è il
// modo più facile di sbagliarli. La shell li conosce per nome e mette accanto
// al campo un «Scegli…» che chiede la cartella al sistema; il valore resta nel
// campo, si può correggere, e arriva al comando di sempre (decisione D11: niente
// porta nuova, il dialogo passa il path al comando esistente).
import { pickFolder, pickNewFolder } from "../host/dialog";
import { errorText } from "../host/errors";
import { t } from "../i18n/strings";
import { notify } from "./notify";

/// `existing`: una cartella che c'è già (lo snapshot da ripristinare).
/// `new`: il nome di una cartella che il comando creerà (dove scrivere la copia).
type PathKind = "existing" | "new";

const PATH_PARAMS: Readonly<Record<string, Readonly<Record<string, PathKind>>>> = {
  "vault.snapshot.create": { target: "new" },
  "vault.snapshot.apply": { source: "existing", backup: "new" },
  "mount.add": { target: "existing" },
  "vault.export": { target: "new" },
};

/// Il nome proposto per una cartella nuova: dice cos'è e quando, così due
/// snapshot dello stesso giorno non si chiamano uguale per caso.
function suggestedName(command: string, param: string, now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}.${pad(now.getMinutes())}`;
  if (command === "vault.export") return t("path_field.export_name", { stamp });
  return t(param === "backup" ? "path_field.backup_name" : "path_field.snapshot_name", { stamp });
}

/// Il campo di un parametro, col suo «Scegli…» se è una cartella del disco;
/// altrimenti il campo così com'è. `title` è il nome del parametro, che il
/// dialogo di sistema mostra come titolo.
export function withPathPicker(
  command: string,
  param: string,
  title: string,
  field: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement,
): HTMLElement {
  const kind = PATH_PARAMS[command]?.[param];
  if (!kind || !(field instanceof HTMLInputElement)) return field;
  const row = document.createElement("span");
  row.className = "palette-path";
  const browse = document.createElement("button");
  browse.type = "button";
  browse.textContent = t("path_field.browse");
  browse.setAttribute("aria-label", t("path_field.browse_named", { title }));
  browse.addEventListener("click", () => {
    const asked = kind === "new" ? pickNewFolder(title, suggestedName(command, param)) : pickFolder(title);
    void asked.then((path) => {
      // Annullato: il campo resta com'era, anche se ci si era già scritto.
      if (path === null || !field.isConnected) return;
      field.value = path;
      field.dispatchEvent(new Event("input", { bubbles: true }));
      field.focus();
    }, (error: unknown) => notify(errorText(error), "guasto"));
  });
  row.append(field, browse);
  return row;
}
