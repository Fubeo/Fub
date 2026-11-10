// Il foglio in modo compatto, dentro una scheda della lavagna (N6 T42).
//
// La griglia è quella di un riquadro (`engine.ts`, che qui non si cambia):
// stessa sessione, stesso giornale, stesse celle. In una scheda si cambiano
// soltanto valori e formule; righe, colonne, unioni e formati restano
// dell'editor intero (T45). Il modo compatto lo ottiene da fuori:
//
// - `compactGridHost` mostra alla griglia un catalogo di comandi ridotto a
//   quelli che scrivono valori o leggono soltanto: senza `home.columnWidth`
//   il bordo delle intestazioni non si tira, senza `home.bold` Ctrl+G non fa
//   niente, e così via; un comando fuori dall'elenco l'host non lo dà;
// - `guardCompactKeys` prende Invio sulla cella scelta (la apre, come F2) e
//   spegne Ctrl+PagSu e Ctrl+PagGiù, che cambierebbero foglio: la scheda
//   scrive solo il foglio attivo;
// - `editCellIn` apre una cella della griglia montata, come il doppio clic.
//
// Il nastro, le linguette e le finestre non si montano: lo decide
// `mountGrid` (`editors/core/bootstrap.ts`) con `SurfaceMountContext.compact`.

import type { GridCommandOutcome, GridBytesSession, GridCommandState } from "../../host/contract";
import type { Lifetime } from "../../ui/lifetime";
import type { GridEditMode, GridHost } from "./engine";
import type { GridPosition } from "./model";

/// I comandi del catalogo che la scheda serve: quelli che scrivono valori e
/// formule (le battute che diventano comandi, l'incolla, il riempimento,
/// annulla e ripeti) e quelli che soltanto leggono (le funzioni per il
/// completamento, il valore di una cella). Tutti gli altri restano
/// dell'editor intero.
export const COMPACT_COMMANDS: ReadonlySet<string> = new Set([
  "range.setValues",
  "fub.pasteFrom",
  "edit.undo",
  "edit.redo",
  "edit.autoFill",
  "edit.fillDown",
  "edit.fillRight",
  "formulas.autoSum",
  "formulas.functions",
  "formulas.recentlyUsed",
  "formulas.nameManager",
  "formulas.evaluate",
  "cell.get",
]);

const served = (commands: readonly GridCommandState[]): GridCommandState[] =>
  commands.filter((command) => COMPACT_COMMANDS.has(command.id));

/// L'host della griglia visto da una scheda: ogni catalogo che arriva alla
/// griglia (all'apertura, dopo un comando, a richiesta) perde i comandi di
/// struttura e di formato, e un comando fuori dall'elenco non parte.
export function compactGridHost(host: GridHost): GridHost {
  return {
    listGridSurfaces: () => host.listGridSurfaces(),
    openGridBytes: async (surface, doc, journal, base): Promise<GridBytesSession> => {
      const session = await host.openGridBytes(surface, doc, journal, base);
      return { ...session, commands: served(session.commands) };
    },
    gridBytesWindow: (surface, instance, request) => host.gridBytesWindow(surface, instance, request),
    applyGridBytes: (surface, instance, request) => host.applyGridBytes(surface, instance, request),
    gridBytesCommands: async (surface, instance, selection) => served(await host.gridBytesCommands(surface, instance, selection)),
    gridBytesCommand: async (surface, instance, request): Promise<GridCommandOutcome> => {
      if (!COMPACT_COMMANDS.has(request.command.id)) {
        throw new Error(`grid card: command ${request.command.id} is not served in a card`);
      }
      const outcome = await host.gridBytesCommand(surface, instance, request);
      return { ...outcome, commands: served(outcome.commands) };
    },
    closeGridBytes: (surface, instance) => host.closeGridBytes(surface, instance),
  };
}

/// I tasti della griglia in una scheda, presi prima della griglia (in
/// cattura su `root`, il contenitore della superficie). `editMode` dice se una
/// cella è aperta.
export function guardCompactKeys(root: HTMLElement, editMode: () => GridEditMode, life: Lifetime): void {
  life.listen(root, "keydown", (event: KeyboardEvent) => {
    if (event.defaultPrevented) return;
    const target = event.target instanceof Element ? event.target : null;
    const viewport = target?.closest<HTMLElement>(".grid-viewport") ?? null;
    if (!viewport || !root.contains(viewport)) return;
    // Dentro la cella aperta (e nel testo di un oggetto) i tasti sono suoi.
    if (target!.closest(".grid-cell-editor, .grid-object-text-editor")) return;
    const modifier = event.ctrlKey || event.metaKey;
    if (modifier && (event.key === "PageDown" || event.key === "PageUp")) {
      event.preventDefault();
      return;
    }
    // Invio sulla cella scelta la apre, come F2 (e come nei fogli in rete):
    // quando è aperta, Invio conferma e scende, ed è della cella.
    if (event.key === "Enter" && !modifier && !event.altKey && !event.shiftKey && editMode() === "ready") {
      event.preventDefault();
      viewport.dispatchEvent(new KeyboardEvent("keydown", { key: "F2", code: "F2", bubbles: true, cancelable: true }));
    }
  }, { capture: true });
}

/// Apre la cella `position` della griglia montata in `root`, come un doppio
/// clic su di lei: la griglia la sceglie e ci mette il cursore. `false` se la
/// cella non è disegnata (fuori dalla vista della griglia).
export function editCellIn(root: HTMLElement, position: GridPosition): boolean {
  const cell = root.querySelector<HTMLElement>(
    `.grid-viewport .grid-cell[data-row="${position.row}"][data-column="${position.column}"]`,
  );
  if (!cell) return false;
  const box = cell.getBoundingClientRect();
  cell.dispatchEvent(new MouseEvent("dblclick", {
    bubbles: true,
    cancelable: true,
    clientX: box.left + box.width / 2,
    clientY: box.top + box.height / 2,
  }));
  return true;
}
