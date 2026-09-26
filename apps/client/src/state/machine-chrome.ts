// Le preferenze della cornice sono impostazioni della macchina (`chrome.*`).
//
// Pannelli affiancati e icone nascoste dalla rail stavano in `localStorage`,
// per la stessa ragione giusta dello stato di vista (non viaggiano col vault) e
// con gli stessi due difetti: morivano col profilo della webview, e nessuno
// fuori dalla webview li conosceva. L'ordine della rail era scritto due volte,
// là e in `chrome.rail.order`, e la copia locale non vinceva mai.
//
// Le chiavi vecchie si leggono **una volta**: diventano l'impostazione se
// questa è ancora al default, e si cancellano solo dopo che la scrittura è
// riuscita. Un'impostazione già scelta vince, e la chiave vecchia se ne va.
import { api } from "../host/ipc";
import type { SettingEntry, SettingValue } from "../host/contract";

/// Scrive un'impostazione della cornice. Rifiuta con l'errore di chi la
/// possiede, mai in modo sincrono: una preferenza che non si ricorda resta
/// valida per la sessione, e chi chiama decide come dirlo.
export function writeChrome(key: string, value: SettingValue): Promise<void> {
  try {
    return api.setSetting(key, value);
  } catch (error) {
    return Promise.reject(error);
  }
}

function legacyRaw(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function forgetLegacy(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    // Una webview senza storage non ha niente da dimenticare.
  }
}

/// Adotta il valore di una chiave `localStorage` di prima nell'impostazione
/// `entry`. Torna il valore da usare adesso se la chiave vecchia vale ancora
/// (l'impostazione era al default), `null` altrimenti. Se la scrittura fallisce
/// il valore vale per la sessione e la chiave vecchia resta, per riprovare.
export async function adoptLegacyChrome<T extends SettingValue>(
  legacyKey: string,
  entry: SettingEntry | undefined,
  parse: (raw: string) => T | null,
): Promise<T | null> {
  const raw = legacyRaw(legacyKey);
  // Un host che non dichiara l'impostazione non ha dove metterla: la chiave
  // vecchia resta com'è.
  if (raw === null || !entry) return null;
  let value: T | null;
  try {
    value = parse(raw);
  } catch {
    value = null;
  }
  if (value === null || entry.source !== "default") {
    forgetLegacy(legacyKey);
    return null;
  }
  try {
    await writeChrome(entry.spec.key, value);
    forgetLegacy(legacyKey);
  } catch {
    // Resta per la prossima apertura.
  }
  return value;
}
