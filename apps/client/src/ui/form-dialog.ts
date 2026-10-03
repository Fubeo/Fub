// Due forme della `.modale` di `dialogs.ts`: una domanda con più campi, come
// le proprietà di un disegno, e l'elenco dei tasti di un editor. Stanno in un
// modulo loro perché le chiama soltanto chi arriva quando serve, l'editor del
// disegno: il loro codice arriva con lui, e non pesa sulla shell.

import { t } from "../i18n/strings";
import { displayBinding, keyName, parseChords } from "./commands";
import { actions, openFrame } from "./dialogs";

export interface FormField {
  /// La chiave del valore nella risposta.
  readonly id: string;
  readonly label: string;
  readonly value: string;
  /// `number` è un campo numerico; `multiline` un testo su più righe, dove
  /// Invio va a capo.
  readonly kind: "text" | "multiline" | "number";
  /// Il minimo di un numero.
  readonly min?: number;
  /// Un campo che si legge e non si cambia: un lato che misura zero non ha
  /// una misura da cambiare.
  readonly disabled?: boolean;
}

export interface FormOptions {
  readonly title: string;
  readonly fields: readonly FormField[];
  readonly okLabel?: string;
}

/// Più campi in una domanda: `null` se l'utente ha annullato, i valori per
/// `id` se ha confermato. Un numero che non si legge, o sotto il minimo, non
/// conferma: il campo lo dice nella lingua del browser, e il fuoco ci va.
export function promptForm(options: FormOptions): Promise<Readonly<Record<string, string>> | null> {
  return new Promise((resolve) => {
    let settled = false;
    const settle = (value: Record<string, string> | null): void => {
      if (settled) return;
      settled = true;
      frame.close();
      resolve(value);
    };
    const frame = openFrame(options.title, () => settle(null));
    const form = document.createElement("form");
    form.className = "palette-form";
    const controls: Array<readonly [FormField, HTMLInputElement | HTMLTextAreaElement]> = [];
    for (const field of options.fields) {
      const label = document.createElement("label");
      const name = document.createElement("span");
      name.className = "palette-label";
      name.textContent = field.label;
      let control: HTMLInputElement | HTMLTextAreaElement;
      if (field.kind === "multiline") {
        control = document.createElement("textarea");
        control.rows = 4;
      } else {
        const input = document.createElement("input");
        if (field.kind === "number") {
          input.type = "number";
          input.inputMode = "decimal";
          input.step = "any";
          input.required = true;
          if (field.min !== undefined) input.min = String(field.min);
        } else {
          input.type = "text";
        }
        control = input;
      }
      control.name = field.id;
      control.value = field.value;
      control.disabled = field.disabled === true;
      label.append(name, control);
      form.append(label);
      controls.push([field, control]);
    }
    form.append(actions(options.okLabel ?? t("app.ok"), () => settle(null)));
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      if (!form.checkValidity()) {
        form.reportValidity();
        return;
      }
      settle(Object.fromEntries(controls.map(([field, control]) => [field.id, control.value])));
    });
    frame.box.append(form);
    const first = controls.find(([, control]) => !control.disabled)?.[1];
    first?.focus();
    if (first instanceof HTMLInputElement) first.select();
  });
}

/// Un gruppo dell'elenco dei tasti: il titolo, e per ogni riga i tasti, nella
/// forma delle scorciatoie della shell (`Mod-z`, `Shift-ArrowLeft`), e che
/// cosa fanno. Più tasti per la stessa cosa si separano con uno spazio.
export interface KeyGroup {
  readonly title: string;
  readonly rows: readonly (readonly [keys: string, action: string])[];
}

/// I tasti come si premono su questa piattaforma: `Mod-z` diventa `Ctrl+Z`, o
/// `⌘Z` su macOS; un tasto da solo ha il suo nome, `Escape` è `Esc`.
function keysOf(binding: string): HTMLElement[] {
  return binding.split(" ").map((one) => {
    const kbd = document.createElement("kbd");
    kbd.textContent = parseChords(one) === null ? keyName(one) : displayBinding(one);
    return kbd;
  });
}

/// L'elenco dei tasti, una tabella per gruppo. Si chiude con Esc o con
/// «Chiudi», e il fuoco torna dov'era, come da ogni modale.
export function showKeys(title: string, groups: readonly KeyGroup[]): Promise<void> {
  return new Promise((resolve) => {
    let settled = false;
    const settle = (): void => {
      if (settled) return;
      settled = true;
      frame.close();
      resolve();
    };
    const frame = openFrame(title, settle);
    const list = document.createElement("div");
    list.className = "keys-list";
    // Lungo su uno schermo piccolo: scorre, e col fuoco scorre da tastiera.
    list.tabIndex = 0;
    list.setAttribute("role", "region");
    list.setAttribute("aria-label", title);
    for (const group of groups) {
      const table = document.createElement("table");
      table.className = "keys-table";
      const caption = document.createElement("caption");
      caption.textContent = group.title;
      const body = document.createElement("tbody");
      for (const [keys, action] of group.rows) {
        const row = document.createElement("tr");
        const head = document.createElement("th");
        head.scope = "row";
        const parts = keysOf(keys);
        parts.forEach((kbd, index) => {
          if (index > 0) head.append(` ${t("keys.or")} `);
          head.append(kbd);
        });
        const cell = document.createElement("td");
        cell.textContent = action;
        row.append(head, cell);
        body.append(row);
      }
      table.append(caption, body);
      list.append(table);
    }
    const row = document.createElement("div");
    row.className = "palette-actions";
    const close = document.createElement("button");
    close.type = "button";
    close.className = "primary";
    close.textContent = t("app.close");
    close.addEventListener("click", settle);
    row.append(close);
    frame.box.append(list, row);
    close.focus();
  });
}
