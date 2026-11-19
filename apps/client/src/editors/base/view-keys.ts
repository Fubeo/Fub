// La proprietà che regge una Bacheca (le corsie, `group`) e un Calendario (la
// data, `date` nel blocco `fub:`): quale proporre quando la vista non la dice
// ancora, e la scelta nella testa della vista, che la scrive nel file `.base`
// come la scriverebbe la mano (IMP-3809, IMP-3810).
import { t } from "../../i18n/strings";
import type { BaseRow } from "./data";
import { propertyValues } from "./filter";

/// Quante corsie al più ha una proprietà «con pochi valori».
export const FEW_LANES = 12;

/// Il testo di un valore per le corsie: le voci di una lista unite, come la
/// Bacheca le mostra; `null` se il valore non è testo (una data, un numero,
/// una casella) o è vuoto.
function laneText(raw: unknown): string | null {
  const values = propertyValues(raw);
  if (values.length === 0 || values.some((each) => each.kind !== "other")) return null;
  return values.map((each) => String(each.value)).join(", ");
}

/// Le corsie di una Bacheca che non le dice: fra le proprietà `keys` (nel
/// loro ordine), la prima di testo o di lista con pochi valori nelle righe
/// della vista (al più `FEW_LANES`, e almeno due note in una corsia); se
/// nessuna ne ha pochi, quella che ne ha meno. Mai una data, un numero o una
/// casella: una proprietà con anche un solo valore di quelle specie non conta.
export function defaultLaneKey(keys: readonly string[], rows: readonly BaseRow[]): string | null {
  let fewest: { key: string; count: number } | null = null;
  for (const key of keys) {
    const distinct = new Set<string>();
    let valued = 0;
    let text = true;
    for (const row of rows) {
      const raw = row.properties[key];
      if (raw === undefined || raw === null || propertyValues(raw).length === 0) continue;
      const shown = laneText(raw);
      if (shown === null) { text = false; break; }
      valued++;
      distinct.add(shown);
    }
    if (!text || valued === 0) continue;
    if (distinct.size <= FEW_LANES && distinct.size < valued) return key;
    if (fewest === null || distinct.size < fewest.count) fewest = { key, count: distinct.size };
  }
  return fewest?.key ?? null;
}

/// Quante righe della vista hanno una data nella proprietà `key`.
export function datedRows(key: string, rows: readonly BaseRow[]): number {
  let count = 0;
  for (const row of rows) if (propertyValues(row.properties[key]).some((each) => each.kind === "date")) count++;
  return count;
}

/// Le proprietà data `keys` dalla più presente nelle righe della vista alla
/// meno; a pari numero, nell'ordine di `keys`.
export function byDatedRows(keys: readonly string[], rows: readonly BaseRow[]): string[] {
  const counts = new Map(keys.map((key) => [key, datedRows(key, rows)]));
  return [...keys].sort((left, right) => counts.get(right)! - counts.get(left)!);
}

/// La data di un Calendario che non la dice: la proprietà data presente nel
/// maggior numero di note della vista.
export function defaultDateKey(keys: readonly string[], rows: readonly BaseRow[]): string | null {
  return byDatedRows(keys, rows)[0] ?? null;
}

/// Il numero dell'ultima scelta montata: l'etichetta la nomina per id.
let pickers = 0;

/// La scelta della proprietà nella testa della vista: l'etichetta visibile
/// («Corsie per», «Data») e il menu delle proprietà, con quella di adesso.
/// `choose` riceve la chiave scelta; spento (`disabled`) la mostra soltanto.
export function viewKeyPicker(input: {
  readonly className: string;
  readonly label: string;
  readonly choices: readonly string[];
  readonly current: string | null;
  readonly labelOf: (key: string) => string;
  readonly same: (left: string, right: string) => boolean;
  readonly disabled: boolean;
  readonly choose: (key: string) => void;
}): HTMLElement {
  const box = document.createElement("div");
  box.className = `base-view-key ${input.className}`;
  const select = document.createElement("select");
  select.className = "base-view-key-select";
  select.id = `base-view-key-${++pickers}`;
  const label = document.createElement("label");
  label.className = "base-view-key-label";
  label.htmlFor = select.id;
  label.textContent = input.label;
  const choices = [...input.choices];
  const current = input.current;
  if (current !== null && !choices.some((key) => input.same(key, current))) choices.unshift(current);
  if (current === null) {
    const prompt = document.createElement("option");
    prompt.value = "";
    prompt.textContent = t("base.view_key.choose");
    prompt.disabled = true;
    prompt.selected = true;
    select.append(prompt);
  }
  for (const key of choices) {
    const option = document.createElement("option");
    option.value = key;
    option.textContent = input.labelOf(key);
    option.selected = current !== null && input.same(key, current);
    select.append(option);
  }
  select.disabled = input.disabled || choices.length === 0;
  select.addEventListener("change", () => {
    const key = select.value;
    if (key && !(current !== null && input.same(key, current))) input.choose(key);
  });
  box.append(label, select);
  return box;
}
