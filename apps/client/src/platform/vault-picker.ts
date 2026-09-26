// Dove la shell attiva prende la cartella di un vault.
//
// Il desktop la chiede al selettore di cartelle del sistema. Mobile non ha
// cartelle libere: lo spazio privato lo risolve il backend, una cartella
// condivisa chiede un permesso del sistema operativo, e la scelta fra i due la
// fa il pannello dello spazio della shell mobile. La shell comune chiede qui, e
// non sa quale dei due selettori sta usando.
import { pickFolder } from "../host/dialog";
import type { Teardown } from "../ui/lifetime";

/// `null` = nessuna cartella scelta con questo gesto: lo stato resta com'è.
export type VaultPicker = (title?: string) => Promise<string | null>;

let declared: VaultPicker | null = null;

/** Dichiara il selettore della shell attiva; il teardown lo ritira. */
export function declareVaultPicker(picker: VaultPicker): Teardown {
  declared = picker;
  return () => {
    if (declared === picker) declared = null;
  };
}

/** Chiede la cartella di un vault al selettore della shell attiva. */
export function pickVaultLocation(title?: string): Promise<string | null> {
  return (declared ?? pickFolder)(title);
}
