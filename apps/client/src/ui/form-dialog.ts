// Due forme della `.modale` di `dialogs.ts`: una domanda con più campi, come
// le proprietà di un disegno, e l'elenco dei tasti di un editor. Stanno in un
// modulo loro perché le chiama soltanto chi arriva quando serve, l'editor del
// disegno: il loro codice arriva con lui, e non pesa sulla shell.

import { t } from "../i18n/strings";
import { identifier } from "./a11y";
import { displayBinding, keyName, modifierName, parseChords } from "./commands";
import { actions, openFrame } from "./dialogs";

export interface FormField {
  /// La chiave del valore nella risposta.
  readonly id: string;
  readonly label: string;
  readonly value: string;
  /// `number` è un campo numerico; `multiline` un testo su più righe, dove
  /// Invio va a capo; `color` un codice di colore, `#rrggbb` o `#rgb`, con
  /// accanto il selettore del sistema che lo scrive.
  readonly kind: "text" | "multiline" | "number" | "color";
  /// Il minimo e il massimo di un numero.
  readonly min?: number;
  readonly max?: number;
  /// Un numero che non può essere zero, come una scala.
  readonly nonZero?: boolean;
  /// Un campo che si legge e non si cambia: un lato che misura zero non ha
  /// una misura da cambiare.
  readonly disabled?: boolean;
  /// Un testo che non si lascia vuoto, né fatto di soli spazi.
  readonly required?: boolean;
  /// La lunghezza massima di un testo.
  readonly maxLength?: number;
}

export interface FormOptions {
  readonly title: string;
  /// Una frase sopra i campi, che la finestra annuncia come sua descrizione.
  readonly message?: string;
  readonly fields: readonly FormField[];
  readonly okLabel?: string;
}

let messageCount = 0;

/// Più campi in una domanda: `null` se l'utente ha annullato, i valori per
/// `id` se ha confermato. Un numero che non si legge, o fuori dai limiti, non
/// conferma: il campo lo dice nella lingua del browser, e il fuoco ci va.
/// Senza campi è una domanda sì o no, col fuoco sulla conferma.
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
    if (options.message !== undefined) {
      const message = document.createElement("p");
      message.id = `form-dialog-message-${++messageCount}`;
      message.textContent = options.message;
      frame.overlay.setAttribute("aria-describedby", message.id);
      form.append(message);
    }
    const controls: Array<readonly [FormField, HTMLInputElement | HTMLTextAreaElement]> = [];
    for (const field of options.fields) {
      const label = document.createElement("label");
      const name = document.createElement("span");
      name.className = "palette-label";
      name.textContent = field.label;
      let control: HTMLInputElement | HTMLTextAreaElement;
      let picker: HTMLInputElement | null = null;
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
          if (field.max !== undefined) input.max = String(field.max);
          if (field.nonZero === true) input.addEventListener("input", () => explainZero(input));
        } else if (field.kind === "color") {
          input.type = "text";
          input.required = true;
          input.pattern = COLOR_PATTERN;
          input.spellcheck = false;
          input.autocomplete = "off";
          picker = colorPicker(input, field.value);
        } else {
          input.type = "text";
        }
        control = input;
      }
      if (field.kind === "text" || field.kind === "multiline") {
        control.required = field.required === true;
        if (field.maxLength !== undefined) control.maxLength = field.maxLength;
        if (field.required === true) control.addEventListener("input", () => explainBlank(control));
      }
      control.name = field.id;
      control.value = field.value;
      control.disabled = field.disabled === true;
      if (picker === null) {
        label.append(name, control);
      } else {
        picker.disabled = control.disabled;
        const row = document.createElement("span");
        row.className = "palette-color-row";
        row.append(control, picker);
        // Che cosa si scrive, sotto il campo e detto con lui.
        const help = document.createElement("span");
        help.className = "palette-help";
        help.id = `form-dialog-help-${++messageCount}`;
        help.textContent = t("form.color.hint");
        control.setAttribute("aria-describedby", help.id);
        label.append(name, row, help);
      }
      form.append(label);
      controls.push([field, control]);
    }
    const row = actions(options.okLabel ?? t("app.ok"), () => settle(null));
    form.append(row);
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      for (const [field, control] of controls) {
        if (field.kind === "color") explainColor(control);
        else if (field.required === true) explainBlank(control);
        else if (field.nonZero === true) explainZero(control);
      }
      if (!form.checkValidity()) {
        form.reportValidity();
        return;
      }
      settle(Object.fromEntries(controls.map(([field, control]) => [field.id, control.value])));
    });
    frame.box.append(form);
    const first = controls.find(([, control]) => !control.disabled)?.[1];
    if (first === undefined) row.querySelector<HTMLButtonElement>("button.primary")?.focus();
    else first.focus();
    if (first instanceof HTMLInputElement) first.select();
  });
}

/// Un codice di colore come lo accetta un campo `color`: tre o sei cifre
/// esadecimali, col `#` o senza.
const COLOR_PATTERN = "#?(?:[0-9a-fA-F]{3}){1,2}";
const COLOR_CODE = new RegExp(`^${COLOR_PATTERN}$`);

/// Il codice `#rrggbb` minuscolo di `value`, se è un codice che il campo
/// accetta.
function sixDigits(value: string): string | null {
  const text = value.trim();
  if (!COLOR_CODE.test(text)) return null;
  const hex = text.replace("#", "").toLowerCase();
  return `#${hex.length === 3 ? [...hex].map((digit) => digit + digit).join("") : hex}`;
}

/// Il selettore del sistema accanto al campo `input`: l'uno scrive
/// nell'altro. Il campo resta la via principale, perché il selettore si usa
/// male da tastiera e con uno screen reader in più di un sistema.
function colorPicker(input: HTMLInputElement, value: string): HTMLInputElement {
  const picker = document.createElement("input");
  picker.type = "color";
  picker.className = "palette-color";
  picker.value = sixDigits(value) ?? "#000000";
  picker.setAttribute("aria-label", t("form.color.picker"));
  picker.addEventListener("input", () => {
    input.value = picker.value;
    explainColor(input);
  });
  input.addEventListener("input", () => {
    explainColor(input);
    const code = sixDigits(input.value);
    if (code !== null) picker.value = code;
  });
  return picker;
}

/// Un codice che non va si spiega con la frase del campo, non con quella
/// generica del browser. Si rifà a ogni battuta e prima di confermare, così
/// non resta indietro rispetto al valore.
function explainColor(control: HTMLInputElement | HTMLTextAreaElement): void {
  control.setCustomValidity(control.validity.patternMismatch ? t("form.color.invalid") : "");
}

/// Un testo che non si lascia vuoto non è nemmeno fatto di soli spazi, che
/// il browser lascerebbe passare. Come per il colore, si rifà a ogni battuta:
/// un errore rimasto fermerebbe l'invio prima di arrivare qui.
function explainBlank(control: HTMLInputElement | HTMLTextAreaElement): void {
  control.setCustomValidity(control.value !== "" && control.value.trim() === "" ? t("form.blank") : "");
}

/// Uno zero dove non va: il browser non ha un vincolo che lo dica. Come il
/// testo vuoto, si rifà a ogni battuta e prima di confermare.
function explainZero(control: HTMLInputElement | HTMLTextAreaElement): void {
  control.setCustomValidity(control.value !== "" && Number(control.value) === 0 ? t("form.nonzero") : "");
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
    kbd.textContent = modifierName(one) ?? (parseChords(one) === null ? keyName(one) : displayBinding(one));
    return kbd;
  });
}

/// I gruppi che l'elenco dei tasti tiene da parte, e la frase che dice
/// perché: si aggiungono in fondo con «Mostra tutto».
export interface MoreKeys {
  readonly groups: readonly KeyGroup[];
  readonly note: string;
}

/// Un gruppo di tasti come tabella, con le righe intestate dai tasti.
function keysTable(group: KeyGroup): HTMLTableElement {
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
  return table;
}

/// Ciò che l'elenco dei tasti può avere in più: una ricerca fra le righe, e
/// in cima, chiuso, ciò che è cambiato rispetto a prima.
export interface KeysExtras {
  /// Il nome del campo di ricerca, e la frase quando niente corrisponde.
  readonly search?: { readonly label: string; readonly empty: string };
  readonly changed?: KeyGroup;
}

/// Le parole di una ricerca, in minuscolo e senza accenti.
const searchable = (text: string): string =>
  text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

/// L'elenco dei tasti, una tabella per gruppo. Si chiude con Esc o con
/// «Chiudi», e il fuoco torna dov'era, come da ogni modale. Con `more`,
/// l'interruttore «Mostra tutto» aggiunge in fondo la sua frase e i suoi
/// gruppi, e premuto di nuovo li toglie. Con `extras.search` un campo in cima
/// tiene soltanto le righe che hanno tutte le parole scritte, nei tasti o
/// nell'azione, anche fra quelle tenute da parte; con `extras.changed`, sopra
/// l'elenco, ciò che è cambiato.
export function showKeys(title: string, groups: readonly KeyGroup[], more?: MoreKeys, extras: KeysExtras = {}): Promise<void> {
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
    list.append(...groups.map(keysTable));
    const row = document.createElement("div");
    row.className = "palette-actions";
    if (more !== undefined && more.groups.length > 0) {
      const extra = document.createElement("div");
      extra.className = "keys-more";
      extra.id = identifier("keys-more");
      extra.hidden = true;
      const note = document.createElement("p");
      note.className = "keys-note";
      note.textContent = more.note;
      extra.append(note, ...more.groups.map(keysTable));
      list.append(extra);
      const toggle = document.createElement("button");
      toggle.type = "button";
      toggle.className = "keys-show-all";
      toggle.textContent = t("keys.show_all");
      toggle.setAttribute("aria-pressed", "false");
      toggle.setAttribute("aria-controls", extra.id);
      toggle.addEventListener("click", () => {
        extra.hidden = !extra.hidden;
        toggle.setAttribute("aria-pressed", String(!extra.hidden));
        // Ciò che si aggiunge sta in fondo all'elenco: lo si porta a vista.
        if (!extra.hidden) extra.scrollIntoView?.({ block: "nearest" });
      });
      row.append(toggle);
    }
    const close = document.createElement("button");
    close.type = "button";
    close.className = "primary";
    close.textContent = t("app.close");
    close.addEventListener("click", settle);
    row.append(close);
    const top: HTMLElement[] = [];
    if (extras.changed !== undefined) {
      const changed = document.createElement("details");
      changed.className = "keys-changed";
      const summary = document.createElement("summary");
      summary.textContent = extras.changed.title;
      changed.append(summary, keysTable(extras.changed));
      top.push(changed);
    }
    let search: HTMLInputElement | null = null;
    if (extras.search !== undefined) {
      const field = document.createElement("label");
      field.className = "keys-search";
      const name = document.createElement("span");
      name.textContent = extras.search.label;
      search = document.createElement("input");
      search.type = "search";
      search.autocomplete = "off";
      search.spellcheck = false;
      list.id = identifier("keys-list");
      search.setAttribute("aria-controls", list.id);
      field.append(name, search);
      const empty = document.createElement("p");
      empty.className = "keys-empty";
      empty.setAttribute("role", "status");
      const extra = list.querySelector<HTMLElement>(".keys-more");
      const toggle = row.querySelector<HTMLButtonElement>(".keys-show-all");
      // Le righe con il testo in cui si cerca: i tasti come si vedono, e
      // l'azione.
      const rows = [...list.querySelectorAll("tr")].map((tr) => ({ tr, text: searchable(tr.textContent ?? "") }));
      const filter = (): void => {
        const words = searchable(search!.value).split(/\s+/).filter((word) => word !== "");
        let found = 0;
        for (const one of rows) {
          const shown = words.every((word) => one.text.includes(word));
          one.tr.hidden = !shown;
          if (shown) found += 1;
        }
        for (const table of list.querySelectorAll("table")) table.hidden = [...table.querySelectorAll("tr")].every((tr) => tr.hidden);
        // Cercando, si cerca anche fra i tasti tenuti da parte.
        if (extra !== null && toggle !== null) extra.hidden = words.length === 0 ? toggle.getAttribute("aria-pressed") !== "true" : false;
        empty.textContent = words.length > 0 && found === 0 ? extras.search!.empty : "";
      };
      search.addEventListener("input", filter);
      top.push(field, empty);
    }
    frame.box.append(...top, list, row);
    (search ?? close).focus();
  });
}
