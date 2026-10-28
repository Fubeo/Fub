// I campi dei riquadri del documento, vestiti come quelli del kit: la barra
// (`panels.ts`) e il pannello di destra (`side.ts`) li scrivono allo stesso
// modo. Il campo di testo e i pulsanti sono del kit (`textField`,
// `textButton`); qui stanno quelli che il kit non ha.
import { identifier } from "../../ui/a11y";

/// Una scelta o un'area di testo vestite come i campi del kit, con la loro
/// `label[for]` sopra.
export function labelled<T extends HTMLSelectElement | HTMLTextAreaElement>(into: HTMLElement, control: T, label: string): T {
  control.id = identifier("rich-field");
  control.classList.add("kit-field-input");
  const field = document.createElement("div");
  field.className = control instanceof HTMLTextAreaElement ? "kit-field rich-strip-panel-area" : "kit-field";
  const caption = document.createElement("label");
  caption.className = "kit-field-label";
  caption.htmlFor = control.id;
  caption.textContent = label;
  const box = document.createElement("div");
  box.className = "kit-field-box";
  box.append(control);
  field.append(caption, box);
  into.append(field);
  return control;
}

export function choice(values: readonly (readonly [string, string])[]): HTMLSelectElement {
  const control = document.createElement("select");
  for (const [value, label] of values) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    control.append(option);
  }
  return control;
}

/// Una casella con il suo nome accanto.
export function check(into: HTMLElement, label: string): HTMLInputElement {
  const row = document.createElement("label");
  row.className = "rich-strip-panel-check";
  const box = document.createElement("input");
  box.type = "checkbox";
  row.append(box, label);
  into.append(row);
  return box;
}

/// Una riga di testo del riquadro: uno stato, un avviso, una spiegazione.
export function remark(into: HTMLElement, role?: "status" | "alert"): HTMLParagraphElement {
  const line = document.createElement("p");
  line.className = "rich-strip-panel-note";
  if (role) line.setAttribute("role", role);
  into.append(line);
  return line;
}
