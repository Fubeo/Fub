// La resa delle Basi incorporate in una nota (`fub:base`), registrata
// all'avvio senza la Base: la superficie, la barra e i dati (`surface.ts`)
// arrivano col primo blocco da disegnare, in un pezzo del bundle tutto loro,
// come la superficie di un `.base` aperto (`editors/core/bootstrap.ts`).

import { errorText } from "../../host/errors";
import { openVaultRoot } from "../../state/vault";
import { registerCustomRenderer } from "../../ui/custom";
import type { BaseDocumentWrites } from "./data";
import { BASE_RENDERER_NS } from "./ids";

/// Un payload che la resa sa disegnare: il sorgente di un blocco o il path di
/// un file `.base`. Il resto lo controlla `parseBaseEmbed` quando la Base c'è.
export function acceptsBaseEmbed(payload: unknown): boolean {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return false;
  const fields = payload as Record<string, unknown>;
  return typeof fields.source === "string" || typeof fields.base === "string";
}

/** Native fenced and file-backed Base embeds use the same surface and data ports. */
export function registerBaseRenderer(onOpenDocument: (doc: string) => void | Promise<void>, documentWrites?: BaseDocumentWrites): void {
  registerCustomRenderer(BASE_RENDERER_NS, (host, payload, _onAction, context) => {
    // Il vault in cui la base è stata incorporata: le sue domande lo nominano
    // anche se, nel frattempo, ne è stato aperto un altro (FUB-001). Si legge
    // adesso, non quando il modulo arriva.
    const vault = openVaultRoot();
    let disposed = false;
    let unmount: (() => void) | undefined;
    void import("./surface").then(({ mountBaseEmbed }) => {
      // Smontata prima che il modulo arrivasse: non si monta più.
      if (disposed) return;
      unmount = mountBaseEmbed(host, payload, context, vault, onOpenDocument, documentWrites);
    }, (error: unknown) => {
      if (disposed) return;
      host.textContent = errorText(error);
    });
    return () => { disposed = true; unmount?.(); };
  }, acceptsBaseEmbed);
}
