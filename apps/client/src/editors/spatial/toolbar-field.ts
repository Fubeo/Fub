// Il campo degli strumenti della colonna, nelle Impostazioni.
//
// L'impostazione `draw.toolbar` è un elenco di nomi, e un elenco il pannello
// sa soltanto mostrarlo: quali strumenti ci sono e come si chiamano lo sa il
// disegno, che ha anche le loro stringhe. Il pannello carica questo modulo
// con un `import()` quando la riga c'è, e scrive ciò che il campo sceglie per
// la sua strada, che dice l'esito vicino alla riga.

import type { SettingEntry } from "../../host/contract";
import { t } from "./strings";
import { TOOLS } from "./tools/registry";

/// Chi riceve una scelta: l'elenco intero da scrivere, e lo strumento
/// cambiato col suo stato, per dire che cosa si è provato se la scrittura
/// non riesce.
export type ToolbarWrite = (value: string[], part: string, checked: boolean) => void;

/// Il campo degli strumenti della colonna (`draw.toolbar`): una casella per
/// strumento del disegno, nell'ordine della barra; gli scelti si scrivono
/// nel loro ordine, e un nome sconosciuto resta in fondo. L'ordine diverso
/// si sceglie nell'editor, da «Personalizza la barra…», e qui si conserva.
export function toolbarField(entry: SettingEntry, id: string, write: ToolbarWrite): HTMLElement {
  const value = Array.isArray(entry.value) ? entry.value : [];
  const known = new Set<string>(TOOLS.map((tool) => tool.id));
  const unknown = value.filter((name) => !known.has(name));
  const root = document.createElement("div");
  root.className = "setting-features";
  root.id = id;
  root.setAttribute("role", "group");
  root.setAttribute("aria-labelledby", `${id}-label`);
  const group = document.createElement("fieldset");
  group.className = "setting-features-group";
  for (const tool of TOOLS.filter((candidate) => candidate.spaces.vector !== undefined)) {
    const name = t(tool.label);
    const item = document.createElement("label");
    item.className = "setting-feature";
    const box = document.createElement("input");
    box.type = "checkbox";
    box.id = `${id}-${tool.id}`;
    box.checked = value.includes(tool.id);
    box.addEventListener("change", () => {
      const kept = value.filter((name) => known.has(name) && name !== tool.id);
      write([...(box.checked ? [...kept, tool.id] : kept), ...unknown], name, box.checked);
    });
    item.append(box, document.createTextNode(name));
    group.append(item);
  }
  root.append(group);
  return root;
}

/// Gli strumenti di `value` nel loro ordine; vuoto, «di serie».
export function describeToolbar(value: readonly string[]): string {
  if (value.length === 0) return t("draw.toolbar.default");
  return value.map((name) => {
    const tool = TOOLS.find((each) => each.id === name);
    return tool === undefined ? name : t(tool.label);
  }).join(", ");
}
