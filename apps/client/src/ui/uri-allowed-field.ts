// Il campo di `uri.allowed`, nelle Impostazioni: una casella per ogni azione
// `fub://` che scrive. Quali sono e come si chiamano lo sanno i collegamenti
// in arrivo (`incoming-links.ts`), non il pannello, che carica questo modulo
// quando la riga c'è.
import type { SettingEntry } from "../host/contract";
import { t, type Key } from "../i18n/strings";
import { ALWAYS_ASK, WRITING_ACTIONS, type WritingAction } from "./incoming-links";

const LABELS: Readonly<Record<WritingAction, Key>> = {
  new: "incoming.allow.new",
  daily: "incoming.allow.daily",
  unique: "incoming.allow.unique",
};

/// Una casella per azione, nel loro ordine; i nomi che questa shell non
/// conosce, di una versione più nuova, restano in coda com'erano. Un'azione
/// che chiede sempre (`capture`, scritta da una versione vecchia) non ha
/// casella e al primo cambio esce dal valore.
export function uriAllowedField(
  entry: SettingEntry,
  id: string,
  write: (value: string[], part: string, checked: boolean) => void,
): HTMLElement {
  const value = Array.isArray(entry.value) ? entry.value : [];
  const chosen = new Set(value);
  const unknown = value.filter((name) => !(WRITING_ACTIONS as readonly string[]).includes(name) && !ALWAYS_ASK.includes(name));
  const root = document.createElement("div");
  root.className = "setting-features";
  root.id = id;
  root.setAttribute("role", "group");
  root.setAttribute("aria-labelledby", `${id}-label`);
  for (const action of WRITING_ACTIONS) {
    const name = t(LABELS[action]);
    const item = document.createElement("label");
    item.className = "setting-feature";
    const box = document.createElement("input");
    box.type = "checkbox";
    box.id = `${id}-${action}`;
    box.checked = chosen.has(action);
    box.addEventListener("change", () => {
      const next = WRITING_ACTIONS.filter((other) => (other === action ? box.checked : chosen.has(other)));
      write([...next, ...unknown], name, box.checked);
    });
    item.append(box, document.createTextNode(name));
    root.append(item);
  }
  return root;
}

/// Le azioni di `value` come le dice il campo.
export function describeUriAllowed(value: readonly string[]): string {
  return value
    .filter((name) => !ALWAYS_ASK.includes(name))
    .map((name) => ((WRITING_ACTIONS as readonly string[]).includes(name) ? t(LABELS[name as WritingAction]) : name))
    .join(", ");
}
