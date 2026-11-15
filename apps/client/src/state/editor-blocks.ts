// I blocchi come preferenza (`editor.blocks`, della macchina, accesa di
// serie): accesi, Scrittura è come Notion; spenti, come un editor di testo.
// L'autorità è il file delle impostazioni; qui resta soltanto l'ultimo valore
// letto, perché una superficie nuova si monti già nello stato giusto e il
// menu «…» del riquadro sappia dire la scelta senza aspettare una lettura.
import { api } from "../host/ipc";
import type { SettingEntry } from "../host/contract";

export const EDITOR_BLOCKS_KEY = "editor.blocks";

let known = true;

/// L'ultimo valore letto: acceso finché nessuno ha letto il contrario.
export function blocksPreferred(): boolean {
  return known;
}

/// Il valore di `editor.blocks` in un elenco di impostazioni appena letto, che
/// diventa l'ultimo noto. Un valore che non è un booleano spento vale acceso,
/// come il predefinito.
export function rememberBlocks(entries: readonly SettingEntry[]): boolean {
  known = entries.find((entry) => entry.spec.key === EDITOR_BLOCKS_KEY)?.value !== false;
  return known;
}

/// Scrive la preferenza. Il valore ricordato cambia soltanto se la scrittura
/// riesce: una scrittura fallita lascia quello di prima, e l'errore torna a
/// chi l'ha chiesta. Le superfici montate lo sanno da `setting_changed`.
export async function setBlocksPreference(on: boolean): Promise<void> {
  await api.setSetting(EDITOR_BLOCKS_KEY, on);
  known = on;
}
