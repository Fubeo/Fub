// Le librerie di simboli del vault per i disegni, dalla parte della shell:
// legge l'impostazione della cartella, elenca i file che ci stanno, ne legge
// il testo e dice quando qualcosa cambia. Che cosa è una libreria lo decide
// il disegno (`editors/spatial/tools/symbol-libraries.ts`).

import { api } from "../host/ipc";
import { settings, vaultEntries } from "../host/query";
import type { LibraryChange, LibraryFile, SymbolLibraryPort } from "../editors/spatial/tools/symbol-libraries";
import { onEvent } from "./kernel";

/// Il bundle che dichiara le impostazioni dei disegni.
const DRAW_SETTINGS = "fub.draw";

/// Quanti file chiede ogni pagina dell'anagrafe.
const PAGE = 500;

/// I file che stanno direttamente in `folder`, tutti, a pagine.
async function folderFiles(folder: string): Promise<LibraryFile[]> {
  const found: LibraryFile[] = [];
  for (let offset = 0; ;) {
    const page = await vaultEntries({ offset, limit: PAGE }, undefined, { path: folder, descendants: false });
    for (const entry of page.items) found.push({ path: entry.id, size: entry.size, mtime: entry.mtime });
    offset += page.items.length;
    if (page.items.length === 0 || offset >= page.total) break;
  }
  return found;
}

export const drawingSymbols: SymbolLibraryPort = {
  setting: async (key) => (await settings(DRAW_SETTINGS)).find((entry) => entry.spec.key === key)?.value,
  files: folderFiles,
  read: async (path) => (await api.readDocument(path)).text,
  watch: (changed: (change: LibraryChange) => void) => {
    const stops = [
      onEvent("document_changed", (e) => changed({ path: e.id })),
      onEvent("document_removed", (e) => changed({ path: e.id })),
      onEvent("document_renamed", (e) => {
        changed({ path: e.from });
        changed({ path: e.to });
      }),
      onEvent("entry_changed", (e) => changed({ path: e.id })),
      onEvent("entry_removed", (e) => changed({ path: e.id })),
      onEvent("entry_renamed", (e) => {
        changed({ path: e.from });
        changed({ path: e.to });
      }),
      onEvent("setting_changed", (e) => changed({ setting: e.key })),
      onEvent("vault_opened", () => changed(null)),
      onEvent("overflow", () => changed(null)),
    ];
    return () => {
      for (const stop of stops) stop();
    };
  },
};
