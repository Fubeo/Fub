// I campi delle finestre dei fogli: testo, numero, password, area di testo,
// elenco, scelta fra pochi, casella, una nota, un gruppo con il suo titolo e
// un controllo che la finestra disegna da sé.
//
// Sono controlli nativi, ognuno col suo nome in una `label[for]` (o in una
// `legend` per un gruppo di scelte): chi legge lo schermo lo trova anche quando
// uno scorrimento lo nasconde. Caselle e scelte rispondono anche a Invio, come
// i pulsanti, perché nel banco di accessibilità Invio e Spazio danno un clic
// ciascuno.
//
// Un campo scrive il suo valore in `values[key]` e lo dice con `onChange`. Un
// numero che non si legge resta il testo scritto: lo rifiuta `checkNumbers`
// con il nome del campo, non un `NaN` che il provider non capirebbe.
import { resolvedLanguage } from "../../../i18n/strings";
import { identifier } from "../../../ui/a11y";
import type { Lifetime } from "../../../ui/lifetime";
import { t } from "./strings";

/// I valori di una finestra, per chiave.
export type Values = Record<string, unknown>;

export interface Choice {
  readonly value: string;
  readonly label: string;
}

interface Named {
  readonly key: string;
  readonly label: string;
  readonly disabled?: boolean;
}

export type FieldSpec =
  | (Named & { readonly kind: "text" | "password"; readonly placeholder?: string })
  | (Named & { readonly kind: "area"; readonly rows?: number })
  | (Named & { readonly kind: "number"; readonly min?: number; readonly max?: number; readonly step?: number })
  | (Named & { readonly kind: "select"; readonly options: readonly Choice[]; readonly size?: number })
  | (Named & { readonly kind: "radio"; readonly options: readonly Choice[] })
  | (Named & { readonly kind: "check" })
  /// Un controllo che la finestra disegna da sé (la tavolozza dei colori):
  /// riceve i valori e dice i cambiamenti come gli altri.
  | (Named & {
      readonly kind: "custom";
      readonly render: (values: Values, onChange: (key: string) => void, life: Lifetime) => HTMLElement;
    })
  | { readonly kind: "note"; readonly text: string }
  | { readonly kind: "section"; readonly label: string; readonly fields: readonly FieldSpec[] };

/// I campi con un valore, anche quelli dentro i gruppi.
export function namedFields(specs: readonly FieldSpec[]): readonly Extract<FieldSpec, Named>[] {
  return specs.flatMap((spec) => (spec.kind === "section" ? namedFields(spec.fields) : spec.kind === "note" ? [] : [spec]));
}

/// Un numero da un campo: il numero, o il testo com'era quando non si legge.
/// Accetta la virgola decimale.
export function readNumber(text: string): number | string {
  const trimmed = text.trim();
  if (trimmed === "") return "";
  const value = Number(trimmed.replace(",", "."));
  return Number.isFinite(value) ? value : text;
}

/// La prima ragione per cui un numero non va, o `null`.
export function checkNumbers(specs: readonly FieldSpec[], values: Values): string | null {
  for (const spec of namedFields(specs)) {
    if (spec.kind !== "number" || spec.disabled) continue;
    const value = values[spec.key];
    const label = spec.label.replace(/:$/, "");
    if (typeof value !== "number") return t("grid.dialog.error.number", { label });
    if ((spec.min !== undefined && value < spec.min) || (spec.max !== undefined && value > spec.max)) {
      return t("grid.dialog.error.between", { label, min: spec.min ?? "", max: spec.max ?? "" });
    }
  }
  return null;
}

/// La ragione di un campo lasciato vuoto.
export function required(label: string): string {
  return t("grid.dialog.error.required", { label: label.replace(/:$/, "") });
}

function text(value: unknown): string {
  return value === undefined || value === null ? "" : String(value);
}

/// Invio su una casella o una scelta la preme, come Spazio.
function pressOnEnter(input: HTMLInputElement, life: Lifetime): void {
  life.listen(input, "keydown", (event) => {
    if (event.key !== "Enter" || event.repeat || event.isComposing) return;
    event.preventDefault();
    input.click();
  });
}

function labelFor(control: HTMLElement, label: string): HTMLLabelElement {
  const element = document.createElement("label");
  element.className = "grid-dialog-label";
  element.htmlFor = control.id;
  element.textContent = label;
  return element;
}

/// Disegna i campi in `container`, che svuota prima. `onChange` arriva dopo
/// che `values` è già cambiato.
export function renderFields(
  container: HTMLElement,
  specs: readonly FieldSpec[],
  values: Values,
  onChange: (key: string) => void,
  life: Lifetime,
): void {
  container.replaceChildren(...specs.map((spec) => field(spec, values, onChange, life)));
}

function field(spec: FieldSpec, values: Values, onChange: (key: string) => void, life: Lifetime): HTMLElement {
  if (spec.kind === "note") {
    const note = document.createElement("p");
    note.className = "grid-dialog-note";
    note.textContent = spec.text;
    return note;
  }
  if (spec.kind === "section") {
    const section = document.createElement("fieldset");
    section.className = "grid-dialog-section";
    const legend = document.createElement("legend");
    legend.className = "grid-dialog-legend";
    legend.textContent = spec.label;
    section.append(legend, ...spec.fields.map((each) => field(each, values, onChange, life)));
    return section;
  }
  if (spec.kind === "radio") {
    const group = document.createElement("fieldset");
    group.className = "grid-dialog-choices";
    group.dataset.key = spec.key;
    const legend = document.createElement("legend");
    legend.className = "grid-dialog-legend";
    legend.textContent = spec.label;
    group.append(legend);
    const name = identifier("grid-dialog-radio");
    for (const option of spec.options) {
      const row = document.createElement("div");
      row.className = "grid-dialog-choice";
      const input = document.createElement("input");
      input.type = "radio";
      input.name = name;
      input.id = identifier("grid-dialog-field");
      input.value = option.value;
      input.checked = text(values[spec.key]) === option.value;
      input.disabled = spec.disabled === true;
      input.dataset.key = spec.key;
      pressOnEnter(input, life);
      life.listen(input, "change", () => {
        if (!input.checked) return;
        values[spec.key] = option.value;
        onChange(spec.key);
      });
      row.append(input, labelFor(input, option.label));
      group.append(row);
    }
    return group;
  }
  if (spec.kind === "custom") return spec.render(values, onChange, life);
  if (spec.kind === "check") {
    const row = document.createElement("div");
    row.className = "grid-dialog-check";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.id = identifier("grid-dialog-field");
    input.checked = values[spec.key] === true;
    input.disabled = spec.disabled === true;
    input.dataset.key = spec.key;
    pressOnEnter(input, life);
    life.listen(input, "change", () => {
      values[spec.key] = input.checked;
      onChange(spec.key);
    });
    row.append(input, labelFor(input, spec.label));
    return row;
  }

  const row = document.createElement("div");
  row.className = "grid-dialog-field";
  let control: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
  if (spec.kind === "select") {
    const select = document.createElement("select");
    select.className = "grid-dialog-select";
    if (spec.size) select.size = spec.size;
    const current = text(values[spec.key]);
    for (const option of spec.options) {
      const element = document.createElement("option");
      element.value = option.value;
      element.textContent = option.label;
      element.selected = option.value === current;
      select.append(element);
    }
    life.listen(select, "change", () => {
      values[spec.key] = select.value;
      onChange(spec.key);
    });
    control = select;
  } else if (spec.kind === "area") {
    const area = document.createElement("textarea");
    area.className = "grid-dialog-area";
    area.rows = spec.rows ?? 4;
    area.value = text(values[spec.key]);
    life.listen(area, "input", () => {
      values[spec.key] = area.value;
      onChange(spec.key);
    });
    control = area;
  } else {
    const input = document.createElement("input");
    input.className = "grid-dialog-input";
    input.autocomplete = "off";
    input.spellcheck = false;
    if (spec.kind === "number") {
      // Un campo di testo e non `type="number"`: la virgola decimale e il
      // testo sbagliato restano come li si è scritti, e li giudica la finestra.
      input.type = "text";
      input.inputMode = "decimal";
      input.classList.add("grid-dialog-number");
      const start = values[spec.key];
      input.value = typeof start === "number" ? String(start).replace(".", decimalMark()) : text(start);
      life.listen(input, "input", () => {
        values[spec.key] = readNumber(input.value);
        onChange(spec.key);
      });
      // Come in Excel, il numero di partenza è già scelto: si riscrive subito.
      life.listen(input, "focus", () => input.select(), { once: true });
    } else {
      input.type = spec.kind;
      if (spec.placeholder) input.placeholder = spec.placeholder;
      input.value = text(values[spec.key]);
      life.listen(input, "input", () => {
        values[spec.key] = input.value;
        onChange(spec.key);
      });
    }
    control = input;
  }
  control.id = identifier("grid-dialog-field");
  control.disabled = spec.disabled === true;
  control.dataset.key = spec.key;
  row.append(labelFor(control, spec.label), control);
  return row;
}

/// Il separatore decimale della lingua dell'interfaccia.
export function decimalMark(): string {
  return (1.5).toLocaleString(resolvedLanguage()).includes(",") ? "," : ".";
}

/// Il controllo di un campo, per dargli il fuoco.
export function controlOf(container: HTMLElement, key: string): HTMLElement | null {
  for (const element of container.querySelectorAll<HTMLElement>("[data-key]")) {
    if (element.dataset.key !== key || element instanceof HTMLFieldSetElement) continue;
    if (element instanceof HTMLInputElement && element.type === "radio" && !element.checked) continue;
    return element;
  }
  return null;
}
