// La scelta del carattere del kit: un campo di ricerca sopra una lista di
// famiglie, ognuna scritta nel suo carattere, divisa per provenienza (i
// recenti, il documento, il vault, il sistema). Il pulsante `fontButton` la
// apre in un popover, come il pozzo del colore apre il suo selettore.
//
// - **La ricerca** filtra mentre si scrive, senza badare a maiuscole e
//   accenti; le frecce muovono la riga attiva senza lasciare il campo, Invio
//   sceglie.
// - **L'anteprima** è il nome della famiglia nel suo carattere, con il
//   generico di ripiego: una famiglia che non c'è si legge comunque.
// - **I gruppi** sono righe che si vedono e non si scelgono.
//
// Il kit non ha testo suo: i nomi dei gruppi e della ricerca arrivano in
// `text`.

import { identifier } from "../ui/a11y";
import type { Lifetime } from "../ui/lifetime";
import { textField } from "./field";
import { createList } from "./list";
import { openPopover, type PopoverHandle } from "./popover";

export type FontSource = "recent" | "document" | "vault" | "system";
export const FONT_SOURCES: readonly FontSource[] = ["recent", "document", "vault", "system"];

export interface FontChoice {
  readonly family: string;
  readonly source: FontSource;
  /// Il generico di ripiego dell'anteprima: `serif`, `sans-serif`,
  /// `monospace`. Di serie `sans-serif`.
  readonly generic?: string;
  /// Una riga in più: «non si trova nel vault».
  readonly note?: string;
}

export interface FontPickerText {
  readonly search: string;
  readonly empty: string;
  readonly groups: Readonly<Record<FontSource, string>>;
}

export interface FontPickerOptions {
  value: string | null;
  fonts: readonly FontChoice[];
  text: FontPickerText;
  onChange: (family: string) => void;
  lifetime: Lifetime;
}

export interface FontPicker {
  readonly element: HTMLElement;
  readonly input: HTMLInputElement;
  setValue(family: string | null): void;
  setFonts(fonts: readonly FontChoice[]): void;
  focus(): void;
}

type Row = { readonly kind: "group"; readonly source: FontSource } | { readonly kind: "font"; readonly font: FontChoice };

/// Il testo per la ricerca: minuscolo e senza accenti.
export function fold(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

/// La famiglia come la scrive una regola CSS, col ripiego.
export function familyStack(font: Pick<FontChoice, "family" | "generic">): string {
  return `"${font.family.replace(/["\\]/g, "\\$&")}", ${font.generic ?? "sans-serif"}`;
}

/// Le righe da mostrare: i gruppi nell'ordine di `FONT_SOURCES`, ognuno con
/// le famiglie che passano la ricerca, una volta per gruppo.
export function fontRows(fonts: readonly FontChoice[], query: string): Row[] {
  const wanted = fold(query.trim());
  const rows: Row[] = [];
  for (const source of FONT_SOURCES) {
    const seen = new Set<string>();
    const matching = fonts.filter((font) => {
      if (font.source !== source || seen.has(fold(font.family))) return false;
      seen.add(fold(font.family));
      return wanted === "" || fold(font.family).includes(wanted);
    });
    if (matching.length === 0) continue;
    rows.push({ kind: "group", source });
    for (const font of matching) rows.push({ kind: "font", font });
  }
  return rows;
}

export function createFontPicker(options: FontPickerOptions): FontPicker {
  const { text, lifetime } = options;
  let fonts = options.fonts;
  let value = options.value;

  const element = document.createElement("div");
  element.className = "kit-font";
  const search = textField({ label: text.search, labelHidden: true, placeholder: text.search, icon: "search", lifetime });
  const list = document.createElement("div");
  list.className = "kit-font-list";
  list.id = identifier("kit-font-list");
  list.setAttribute("aria-label", text.search);
  const empty = document.createElement("div");
  empty.className = "kit-font-empty";
  empty.textContent = text.empty;
  empty.hidden = true;
  element.append(search.element, list, empty);
  search.input.setAttribute("role", "combobox");
  search.input.setAttribute("aria-controls", list.id);
  search.input.setAttribute("aria-expanded", "true");
  search.input.setAttribute("aria-autocomplete", "list");

  const keyOf = (row: Row): string => (row.kind === "group" ? `group:${row.source}` : `${row.font.source}:${row.font.family}`);
  const handle = createList<Row>({
    container: list,
    role: "listbox",
    items: [],
    key: keyOf,
    owner: search.input,
    focus: "activedescendant",
    disabled: (row) => row.kind === "group",
    selected: (row) => row.kind === "font" && value !== null && fold(row.font.family) === fold(value),
    render: (row, el) => {
      if (row.kind === "group") {
        el.className += " kit-font-group";
        el.textContent = text.groups[row.source];
        return;
      }
      el.className += " kit-font-item";
      const name = document.createElement("span");
      name.className = "kit-font-name";
      name.textContent = row.font.family;
      name.style.fontFamily = familyStack(row.font);
      el.append(name);
      if (row.font.note) {
        const note = document.createElement("span");
        note.className = "kit-font-note";
        note.textContent = row.font.note;
        el.append(note);
      }
    },
    onActivate: (row) => {
      if (row.kind !== "font") return;
      value = row.font.family;
      refresh();
      options.onChange(row.font.family);
    },
    lifetime,
  });

  const refresh = (): void => {
    const rows = fontRows(fonts, search.value());
    handle.setItems(rows);
    empty.hidden = rows.length > 0;
    const chosen = rows.find((row) => row.kind === "font" && value !== null && fold(row.font.family) === fold(value));
    if (chosen && search.value() === "") handle.setActive(keyOf(chosen));
  };
  lifetime.listen(search.input, "input", () => {
    refresh();
    const first = fontRows(fonts, search.value()).find((row) => row.kind === "font");
    handle.setActive(first ? keyOf(first) : null);
  });
  refresh();

  return {
    element,
    input: search.input,
    setValue(family) {
      value = family;
      refresh();
    },
    setFonts(next) {
      fonts = next;
      refresh();
    },
    focus: () => search.focus(),
  };
}

export interface FontButtonOptions extends Omit<FontPickerOptions, "lifetime"> {
  /// Il nome del pulsante: «Carattere».
  label: string;
  /// Che cosa dice una selezione mista.
  mixedText: string;
  lifetime: Lifetime;
  /// La scelta si apre o si chiude: chi scrive altrove sa che il fuoco va
  /// e torna.
  onOpenChange?: (open: boolean) => void;
}

export interface FontButton {
  readonly element: HTMLButtonElement;
  setValue(family: string | null): void;
  setFonts(fonts: readonly FontChoice[]): void;
  open(): void;
  close(): void;
}

/// Il pulsante del carattere: dice la famiglia, nel suo carattere, e apre la
/// scelta.
export function fontButton(options: FontButtonOptions): FontButton {
  const { lifetime } = options;
  let value = options.value;
  let fonts = options.fonts;
  let popover: PopoverHandle | null = null;
  let picker: FontPicker | null = null;

  const element = document.createElement("button");
  element.type = "button";
  element.className = "kit-font-button";
  element.setAttribute("aria-haspopup", "dialog");
  element.setAttribute("aria-expanded", "false");
  const name = document.createElement("span");
  name.className = "kit-font-name";
  element.append(name);

  const paint = (): void => {
    const shown = value ?? options.mixedText;
    name.textContent = shown;
    const font = fonts.find((each) => value !== null && fold(each.family) === fold(value));
    name.style.fontFamily = value === null ? "" : familyStack(font ?? { family: value });
    element.setAttribute("aria-label", `${options.label}: ${shown}`);
    element.title = `${options.label}: ${shown}`;
  };

  const close = (): void => popover?.close();
  const open = (): void => {
    if (popover && !popover.closed) return;
    picker = createFontPicker({
      ...options,
      value,
      fonts,
      lifetime,
      onChange: (family) => {
        value = family;
        paint();
        options.onChange(family);
        close();
      },
    });
    element.setAttribute("aria-expanded", "true");
    options.onOpenChange?.(true);
    popover = openPopover({
      anchor: element,
      content: picker.element,
      label: options.label,
      className: "kit-font-popover",
      lifetime,
      onClose: () => {
        element.setAttribute("aria-expanded", "false");
        picker = null;
        popover = null;
        options.onOpenChange?.(false);
      },
    });
    picker.focus();
  };
  lifetime.listen(element, "click", () => (popover && !popover.closed ? close() : open()));
  paint();

  return {
    element,
    setValue(family) {
      value = family;
      paint();
      picker?.setValue(family);
    },
    setFonts(next) {
      fonts = next;
      paint();
      picker?.setFonts(next);
    },
    open,
    close,
  };
}
