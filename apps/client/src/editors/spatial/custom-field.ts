// Il campo delle parti del livello Personalizzato, nelle Impostazioni.
//
// L'impostazione `draw.custom` è un elenco di nomi, e un elenco il pannello sa
// soltanto mostrarlo: quali parti ci sono, come si chiamano e da quale livello
// vengono lo sa il disegno, che ha anche le loro stringhe. Il pannello carica
// questo modulo con un `import()` quando la riga c'è, e scrive ciò che il
// campo sceglie per la sua strada, che dice l'esito vicino alla riga.

import type { SettingEntry } from "../../host/contract";
import { t, type DrawKey } from "./strings";
import { FEATURES, isFeature, type Preset } from "./tools/registry";

const LEVELS: readonly { readonly level: Preset; readonly label: DrawKey }[] = [
  { level: "essential", label: "draw.level.essential" },
  { level: "standard", label: "draw.level.standard" },
  { level: "expert", label: "draw.level.expert" },
];

/// Chi riceve una scelta: l'elenco intero da scrivere, e la parte cambiata
/// col suo stato, per dire che cosa si è provato se la scrittura non riesce.
export type CustomWrite = (value: string[], part: string, checked: boolean) => void;

/// Il campo: una casella per parte, nei gruppi dei livelli da cui vengono e
/// nel loro ordine. L'elenco che scrive ha le parti in quell'ordine, e dopo i
/// nomi che questo editor non conosce, di una versione più nuova, com'erano.
export function customField(entry: SettingEntry, id: string, write: CustomWrite): HTMLElement {
  const value = Array.isArray(entry.value) ? entry.value : [];
  const chosen = new Set(value);
  const unknown = value.filter((name) => !isFeature(name));
  const root = document.createElement("div");
  root.className = "setting-features";
  root.id = id;
  root.setAttribute("role", "group");
  root.setAttribute("aria-labelledby", `${id}-label`);
  for (const { level, label } of LEVELS) {
    const group = document.createElement("fieldset");
    group.className = "setting-features-group";
    const legend = document.createElement("legend");
    legend.className = "setting-features-level";
    legend.textContent = t(label);
    group.append(legend);
    for (const feature of FEATURES.filter((candidate) => candidate.level === level)) {
      const name = t(feature.label);
      const item = document.createElement("label");
      item.className = "setting-feature";
      const box = document.createElement("input");
      box.type = "checkbox";
      box.id = `${id}-${feature.id}`;
      box.checked = chosen.has(feature.id);
      box.addEventListener("change", () => {
        const next = FEATURES.filter((other) => (other.id === feature.id ? box.checked : chosen.has(other.id))).map((other) => other.id);
        write([...next, ...unknown], name, box.checked);
      });
      item.append(box, document.createTextNode(name));
      group.append(item);
    }
    root.append(group);
  }
  return root;
}

/// Le parti di `value` come le dice il campo, nel suo ordine: per il
/// predefinito accanto a «Azzera». Un nome che l'editor non conosce resta
/// com'è scritto.
export function describeCustom(value: readonly string[]): string {
  const known = FEATURES.filter((feature) => value.includes(feature.id)).map((feature) => t(feature.label));
  return [...known, ...value.filter((name) => !isFeature(name))].join(", ");
}
