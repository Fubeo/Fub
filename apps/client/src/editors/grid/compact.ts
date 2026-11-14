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
// - `activeCellSource` dà la cella attiva e la sua formula come dati
//   (`SurfaceActiveCellSource`): nella scheda la barra della formula della
//   griglia non si vede, e la tela li mostra nella riga delle opzioni;
// - `editCellIn` apre una cella della griglia montata, come il doppio clic.
//
// Il nastro, le linguette, le finestre e la tavolozza non si montano: lo
// decide `mountGrid` (`editors/core/bootstrap.ts`) con
// `SurfaceMountContext.compact`.

import type { GridCommandOutcome, GridBytesSession, GridCommandState } from "../../host/contract";
import type { SurfaceActiveCell, SurfaceActiveCellSource } from "../core/registry";
import type { Lifetime } from "../../ui/lifetime";
import type { GridEditMode, GridEngine, GridHost } from "./engine";
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

/// Apre la cella `position` della griglia montata in `root` con i gesti di
/// chi la usa, i soli che la griglia offre per farlo: un clic al centro la
/// sceglie, il doppio clic ci mette il cursore. `false` se la cella non è
/// disegnata (fuori dalla vista della griglia).
///
/// Il punto del gesto è nelle misure della griglia, non dello schermo: la
/// griglia confronta il punto con le sue misure (i bordi delle intestazioni,
/// il bordo della selezione) senza contare lo zoom della lavagna, che la
/// scala. Con lo zoom a 100% i due punti coincidono.
export function editCellIn(root: HTMLElement, position: GridPosition): boolean {
  const viewport = root.querySelector<HTMLElement>(".grid-viewport");
  const cell = viewport?.querySelector<HTMLElement>(
    `.grid-cell[data-row="${position.row}"][data-column="${position.column}"]`,
  ) ?? null;
  if (!viewport || !cell) return false;
  const frame = viewport.getBoundingClientRect();
  const box = cell.getBoundingClientRect();
  const scaleX = viewport.offsetWidth > 0 && frame.width > 0 ? frame.width / viewport.offsetWidth : 1;
  const scaleY = viewport.offsetHeight > 0 && frame.height > 0 ? frame.height / viewport.offsetHeight : 1;
  const at = {
    bubbles: true,
    cancelable: true,
    button: 0,
    clientX: frame.left + (box.left - frame.left + box.width / 2) / scaleX,
    clientY: frame.top + (box.top - frame.top + box.height / 2) / scaleY,
  };
  cell.dispatchEvent(new PointerEvent("pointerdown", { ...at, pointerId: 1, isPrimary: true }));
  cell.dispatchEvent(new PointerEvent("pointerup", { ...at, pointerId: 1, isPrimary: true }));
  cell.dispatchEvent(new MouseEvent("dblclick", { ...at, detail: 2 }));
  return true;
}

/// La cella attiva vista da fuori, più `changed`, che chi monta la griglia
/// chiama da ogni richiamo del motore che la può cambiare.
export interface GridActiveCellSource extends SurfaceActiveCellSource {
  changed(): void;
}

/// La cella attiva della griglia `engine`, montata in `root`, come dati. Il
/// nome viene dal motore (`selectionRefs`). Il contenuto com'è scritto è
/// quello che il motore mette nella sua barra della formula (l'input della
/// cella attiva, nella lingua; mentre si scrive una cella resta quello di
/// prima, come nel riquadro): il motore non lo dà altrimenti, e qui lo si
/// rilegge soltanto quando il motore dice che qualcosa è cambiato, mai con
/// un osservatore del DOM. Chi ascolta è avvisato una volta per giro, dopo
/// i richiami del motore: a quel punto la barra è già aggiornata.
export function activeCellSource(
  engine: Pick<GridEngine, "book" | "selectionRefs">,
  root: HTMLElement,
  life: Lifetime,
): GridActiveCellSource {
  const listeners = new Set<() => void>();
  let queued = false;
  life.add(() => listeners.clear());
  return {
    read(): SurfaceActiveCell | null {
      if (life.closed || engine.book() === null) return null;
      return { name: engine.selectionRefs().active, formula: formulaBarText(root) };
    },
    subscribe(listener) {
      if (life.closed) return () => {};
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    changed() {
      if (queued || life.closed || listeners.size === 0) return;
      queued = true;
      queueMicrotask(() => {
        queued = false;
        if (life.closed) return;
        for (const listener of [...listeners]) {
          try {
            listener();
          } catch (error) {
            console.error(error);
          }
        }
      });
    },
  };
}

/// Il testo della barra della formula della griglia in `root`, riga per riga.
function formulaBarText(root: HTMLElement): string {
  const field = root.querySelector(".grid-formula-bar .grid-formula-editor");
  if (!field) return "";
  const lines = field.querySelectorAll(".cm-line");
  return lines.length > 0 ? Array.from(lines, (line) => line.textContent ?? "").join("\n") : (field.textContent ?? "");
}
