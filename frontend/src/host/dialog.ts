// Le superfici che l'app chiede al **sistema operativo**, non al kernel: una
// conferma modale, il selettore di cartella. Non passano dall'IPC di Fub —
// le disegna la piattaforma — e sono l'altra metà della cucitura.
//
// Prima questa metà non esisteva: `main.ts` importava `@tauri-apps/plugin-dialog`
// direttamente, e bastava quella riga perché la shell smettesse di essere
// portabile (§1.3). Sostituire questo modulo — con `window.confirm` in un PWA,
// con un foglio nativo su mobile, con un finto negli e2e della shell (§17.2) —
// è ora un lavoro di un file solo.
import { confirm as tauriConfirm, open as tauriOpen } from "@tauri-apps/plugin-dialog";

/// Cosa si sta per fare, e quanto è grave. `danger` è ciò che il sistema usa
/// per l'icona di avviso: distruttivo (svuotare il cestino) contro reversibile
/// (spostarci una nota, che si ripristina).
export interface ConfirmOptions {
  title: string;
  okLabel: string;
  cancelLabel?: string;
  danger?: boolean;
}

/// Una domanda sì/no all'utente. `true` = ha detto di sì.
export function confirm(message: string, opts: ConfirmOptions): Promise<boolean> {
  return tauriConfirm(message, {
    title: opts.title,
    kind: opts.danger ? "warning" : "info",
    okLabel: opts.okLabel,
    cancelLabel: opts.cancelLabel ?? "Annulla",
  });
}

/// Il selettore di cartella del sistema: `null` se l'utente ha annullato.
///
/// Il tipo di ritorno del plugin è più largo (una scelta multipla dà un array):
/// qui si stringe a ciò che l'unico chiamante chiede — una cartella sola — così
/// il resto della shell non deve conoscere le forme del plugin.
export async function pickFolder(): Promise<string | null> {
  const scelta = await tauriOpen({ directory: true, multiple: false });
  return typeof scelta === "string" ? scelta : null;
}
