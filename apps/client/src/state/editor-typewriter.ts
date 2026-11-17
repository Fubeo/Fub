// La macchina da scrivere come preferenza (`editor.typewriter`, della
// macchina, spenta di serie): la riga del cursore resta a metà del foglio
// (`editors/text/typewriter.ts`). L'autorità è il file delle impostazioni;
// qui resta soltanto l'ultimo valore che un editor ha letto, perché il menu
// «…» del riquadro sappia dire la scelta senza aspettare una lettura. Ogni
// editor montato rilegge la chiave all'apertura e a ogni `setting_changed`.
import { api } from "../host/ipc";

export const EDITOR_TYPEWRITER_KEY = "editor.typewriter";

let known = false;

/// L'ultimo valore letto: spenta finché nessuno ha letto il contrario.
export function typewriterPreferred(): boolean {
  return known;
}

/// Lo scrive il motore del testo dopo ogni lettura delle impostazioni.
export function rememberTypewriter(on: boolean): void {
  known = on;
}

/// Scrive la preferenza. Il valore ricordato cambia soltanto se la scrittura
/// riesce; gli editor montati lo sanno da `setting_changed`.
export async function setTypewriterPreference(on: boolean): Promise<void> {
  await api.setSetting(EDITOR_TYPEWRITER_KEY, on);
  known = on;
}
