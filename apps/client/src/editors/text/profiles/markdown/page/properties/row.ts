// Una riga delle proprietà della testata (T8): la figura del tipo e il nome,
// che aprono il menu della proprietà, poi il valore, che apre l'editor del
// suo tipo. In sola lettura e in Lettura la riga si guarda soltanto.
import type { Lifetime } from "../../../../../../ui/lifetime";
import type { PropertyEntry } from "../../properties";
import { liveStrings } from "../../strings";
import { emptyValue, KIND_ICONS, linkName, rowKind, type RowKind } from "./kind";
import { openEditor, toggleCheckbox } from "./editors";
import { openPropertyMenu } from "./menu";
import { chipElement, figure, longDate, personElement, typeName, type PropertyRowHost } from "./values";

export type { PropertyRowHost, WriteOutcome } from "./values";
export { entryStamp } from "./values";

/// Ciò che il valore mostra, secondo il tipo.
function fillValue(value: HTMLElement, entry: PropertyEntry, kind: RowKind): string {
  if (emptyValue(entry) && kind.kind !== "checkbox") {
    value.dataset.empty = "true";
    value.textContent = liveStrings.t("page.properties.empty");
    return value.textContent;
  }
  switch (kind.kind) {
    case "checkbox": {
      const on = /^true$/i.test(entry.value.trim());
      const box = document.createElement("span");
      box.className = "cm-fub-prop-check";
      box.dataset.checked = String(on);
      box.setAttribute("aria-hidden", "true");
      const text = document.createElement("span");
      text.textContent = liveStrings.t(on ? "page.properties.yes" : "page.properties.no");
      value.replaceChildren(box, text);
      return text.textContent;
    }
    case "date":
    case "date_time": {
      const text = document.createElement("span");
      text.textContent = longDate(entry.value);
      value.replaceChildren(...[figure(KIND_ICONS[kind.kind])].filter((node): node is SVGElement => node !== null), text);
      return text.textContent;
    }
    case "list":
    case "tags": {
      const items = entry.items ?? [entry.value];
      value.replaceChildren(...items.map((item) => chipElement(item, kind.kind as "list" | "tags")));
      return items.join(", ");
    }
    case "people": {
      const items = entry.items ?? [];
      value.replaceChildren(...items.map(personElement));
      return items.map(linkName).join(", ");
    }
    default:
      value.textContent = entry.value;
      return entry.value;
  }
}

/// Una riga: la figura del tipo e il nome, il valore. Il nome lungo si taglia
/// e si legge intero al passaggio; il valore va a capo.
export function propertyRow(entry: PropertyEntry, host: PropertyRowHost, life: Lifetime, featured: boolean | null = null): HTMLElement {
  const kind = rowKind(entry, host.types);
  const row = document.createElement("div");
  row.className = "cm-fub-page-prop";
  row.dataset.key = entry.key;
  row.dataset.kind = kind.kind;
  const type = typeName(kind.declared ?? kind.kind);
  const key = document.createElement(host.editable ? "button" : "span");
  key.className = "cm-fub-page-prop-key";
  key.title = entry.key;
  const name = document.createElement("span");
  name.className = "cm-fub-page-prop-name";
  name.textContent = entry.key;
  key.replaceChildren(...[figure(KIND_ICONS[kind.kind])].filter((node): node is SVGElement => node !== null), name);
  const value = document.createElement(host.editable ? "button" : "span");
  value.className = "cm-fub-page-prop-value";
  const shown = fillValue(value, entry, kind);
  if (kind.mismatch) {
    row.dataset.mismatch = kind.mismatch;
    const mark = document.createElement("span");
    mark.className = "cm-fub-prop-mismatch";
    mark.textContent = liveStrings.t("page.properties.mismatch", { type: typeName(kind.mismatch).toLocaleLowerCase() });
    value.append(mark);
  }
  if (key instanceof HTMLButtonElement && value instanceof HTMLButtonElement) {
    key.type = "button";
    key.setAttribute("aria-haspopup", "menu");
    key.setAttribute("aria-label", liveStrings.t("page.properties.key", { key: entry.key, type }));
    life.listen(key, "click", () => openPropertyMenu(entry, kind, key, host, life, featured));
    value.type = "button";
    value.dataset.pageNav = "";
    if (kind.kind === "checkbox") {
      value.setAttribute("role", "checkbox");
      value.setAttribute("aria-checked", String(/^true$/i.test(entry.value.trim())));
      value.setAttribute("aria-label", entry.key);
    } else {
      value.setAttribute("aria-haspopup", kind.kind === "text" || kind.kind === "number" || kind.kind === "url" ? "false" : "dialog");
      value.setAttribute("aria-label", liveStrings.t("page.properties.edit", { key: entry.key, value: shown }));
    }
    life.listen(value, "click", () => {
      if (!entry.simple) {
        host.open(entry.from);
        return;
      }
      if (kind.kind === "checkbox") toggleCheckbox(entry, host);
      else openEditor(entry, kind, value, host, life);
    });
    // Il menu della proprietà anche dal valore, da tastiera.
    life.listen(value, "keydown", (event) => {
      if (event.key === "ContextMenu" || (event.key === "F10" && event.shiftKey)) {
        event.preventDefault();
        openPropertyMenu(entry, kind, key, host, life, featured);
      }
    });
  }
  row.append(key, value);
  return row;
}
