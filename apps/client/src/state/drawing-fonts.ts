// I caratteri del vault per i disegni, dalla parte della shell: elenca gli
// allegati, ne legge i byte, porta all'host le domande sui caratteri e dice
// quando un allegato cambia. Una sola porta per l'app: i disegni aperti e
// quelli che una nota mostra ne condividono le facce (`fonts/vault.ts`).

import { api } from "../host/ipc";
import { vaultEntries } from "../host/query";
import { openResourcePort, type ResourceTransport } from "../editors/media/resource-port";
import type { VaultFontFile, VaultFontPort } from "../editors/spatial/fonts/vault";
import { onEvent } from "./kernel";

/// Lo spazio dell'indice dove l'host risponde alle domande dei disegni.
const DRAW_QUERIES = "fub.draw";

/// Quanti allegati chiede ogni pagina dell'anagrafe.
const PAGE = 500;

/// I byte dei file del vault, per chi li legge interi.
const transport: ResourceTransport = {
  open: (id, vault) => api.resourceOpen(id, vault ?? null),
  read_chunk: api.resourceReadChunk,
  close: api.resourceClose,
};

/// Gli allegati del vault, fra cui i caratteri dei disegni: l'anagrafe letta
/// a pagine, tutta, nell'ordine in cui la dà.
async function drawingFontFiles(): Promise<VaultFontFile[]> {
  const found: VaultFontFile[] = [];
  for (let offset = 0; ;) {
    const page = await vaultEntries({ offset, limit: PAGE }, "asset");
    for (const entry of page.items) found.push({ id: entry.id, size: entry.size, mtime: entry.mtime });
    offset += page.items.length;
    if (page.items.length === 0 || offset >= page.total) break;
  }
  return found;
}

export const drawingFonts: VaultFontPort = {
  files: drawingFontFiles,
  read: async (id, limit) => {
    const port = await openResourcePort(transport, id);
    try {
      return port.descriptor.len > limit ? null : await port.readAll();
    } finally {
      await port.close();
    }
  },
  ask: async (query) => {
    const answer = await api.queryIndex({ kind: "custom", ns: DRAW_QUERIES, query });
    if (answer.kind !== "custom") throw new Error(`${DRAW_QUERIES} answered a ${answer.kind} result`);
    return answer.value;
  },
  watch: (changed) => {
    const stops = [
      onEvent("entry_changed", (e) => changed(e.id)),
      onEvent("entry_removed", (e) => changed(e.id)),
      onEvent("entry_renamed", (e) => {
        changed(e.from);
        changed(e.to);
      }),
      onEvent("vault_opened", () => changed(null)),
      onEvent("overflow", () => changed(null)),
    ];
    return () => {
      for (const stop of stops) stop();
    };
  },
};
