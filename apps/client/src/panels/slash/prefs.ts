// Le scelte della persona sul menu «/»: le voci tolte e l'ordine delle
// sezioni. Sono impostazioni della macchina (`editor.slash.hidden`,
// `editor.slash.sections`); la shell le legge quando cambiano e il pannello
// le trova qui a ogni apertura, senza chiederle all'host a ogni battuta.
import type { SettingEntry } from "../../host/contract";

export const SLASH_HIDDEN_SETTING = "editor.slash.hidden";
export const SLASH_SECTIONS_SETTING = "editor.slash.sections";

export interface SlashPrefs {
  readonly hidden: readonly string[];
  readonly sections: readonly string[];
}

let prefs: SlashPrefs = { hidden: [], sections: [] };

function stringList(value: unknown): string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string") ? [...new Set(value)] : [];
}

/// Le scelte dalle impostazioni lette; una chiave assente o malformata vale
/// la lista vuota, cioè il menu di sempre.
export function applySlashSettings(entries: readonly SettingEntry[]): void {
  const values = new Map(entries.map((entry) => [entry.spec.key, entry.value]));
  prefs = { hidden: stringList(values.get(SLASH_HIDDEN_SETTING)), sections: stringList(values.get(SLASH_SECTIONS_SETTING)) };
}

/// Le scelte di adesso.
export function slashPrefs(): SlashPrefs {
  return prefs;
}

/// Le voci nascoste con una in più: la lista da scrivere.
export function withHidden(id: string): string[] {
  return [...new Set([...prefs.hidden, id])];
}

/// Toglie una voce dal menu subito, e lo scrive. Se la scrittura fallisce la
/// voce torna, a meno che nel frattempo le scelte non siano cambiate di nuovo:
/// allora vince ciò che è arrivato dopo.
export async function hideSlashEntry(id: string, write: (key: string, value: string[]) => Promise<void>): Promise<void> {
  const before = prefs;
  const after: SlashPrefs = { ...prefs, hidden: withHidden(id) };
  prefs = after;
  try {
    await write(SLASH_HIDDEN_SETTING, [...after.hidden]);
  } catch (error) {
    if (prefs === after) prefs = before;
    throw error;
  }
}
