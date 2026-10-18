// La modalità dei riquadri nuovi, letta dalle impostazioni.
//
// Sta qui e non nella shell che compone perché chi carica un layout — ogni
// shell, e l'apertura di un vault (`vault-session.ts`) — fa la stessa domanda.
import { settings } from "../host/query";

/// La modalità scelta per i riquadri nuovi (`editor.default-mode`), o niente
/// se non si riesce a leggerla: allora vale il default del layout.
export async function preferredPaneMode(): Promise<string | undefined> {
  try {
    const value = (await settings()).find((entry) => entry.spec.key === "editor.default-mode")?.value;
    return typeof value === "string" && value !== "" ? value : undefined;
  } catch {
    return undefined;
  }
}
