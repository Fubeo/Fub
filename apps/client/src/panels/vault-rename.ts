// Il nome di un vault nella scheda dei vault conosciuti, e il modo di cambiarlo.
//
// Il nome è del registro di macchina (`set_vault_look`), non della cartella:
// rinominare qui non sposta niente sul disco, e un nome vuoto torna a essere
// quello della cartella. L'icona resta quella che era: l'aspetto si scrive
// intero, e chi rinomina non la sceglie.
import type { KnownVault } from "../host/contract";
import { t } from "../i18n/strings";

/// L'etichetta col nome e il pulsante «Rinomina»: il pulsante mette al posto
/// dell'etichetta un campo, e solo Invio salva. Uscire dal campo lascia
/// com'era, ed è anche ciò che succede con Esc: nella modale delle
/// impostazioni Esc la chiude prima che il campo lo veda, e il fuoco che se ne
/// va non deve scrivere un nome a metà. `save` riceve il nome già ripulito,
/// `""` per la cartella.
export function vaultNameEditor(
  vault: KnownVault,
  folder: string,
  id: string,
  save: (name: string) => void,
): { label: HTMLElement; rename: HTMLButtonElement } {
  const label = document.createElement("div");
  label.className = "setting-label";
  label.textContent = `${vault.icon ?? ""} ${vault.name || folder}`.trim();

  const rename = document.createElement("button");
  rename.type = "button";
  rename.className = "link-button";
  rename.textContent = t("settings.vault.rename");
  rename.addEventListener("click", () => {
    const field = document.createElement("span");
    const name = document.createElement("label");
    name.className = "sr-only";
    name.htmlFor = id;
    name.textContent = t("settings.vault.name");
    const input = document.createElement("input");
    input.type = "text";
    input.id = id;
    input.className = "setting-input";
    input.value = vault.name || folder;
    input.placeholder = folder;
    input.maxLength = 120;
    field.append(name, input);
    let done = false;
    const finish = (keep: boolean) => {
      if (done) return;
      done = true;
      field.replaceWith(label);
      rename.hidden = false;
      if (!keep) {
        rename.focus();
        return;
      }
      const next = input.value.trim();
      const chosen = next === folder ? "" : next;
      if (chosen !== vault.name) save(chosen);
      else rename.focus();
    };
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        finish(true);
      } else if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        finish(false);
      }
    });
    input.addEventListener("blur", () => finish(false));
    label.replaceWith(field);
    rename.hidden = true;
    input.focus();
    input.select();
  });
  return { label, rename };
}
