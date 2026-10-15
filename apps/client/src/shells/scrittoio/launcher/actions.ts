// Che cosa succede quando una riga del lanciatore viene scelta.
//
// Due esiti soli: si resta nel lanciatore, in un altro modo (un'etichetta
// porta alle sue note, una ricerca recente torna nel campo), oppure il
// lanciatore si chiude e parte un gesto che esiste già (aprire, dividere,
// rivelare un punto, avviare un comando). Nessuna primitiva nuova: qui si
// scelgono e si mettono in fila quelle della shell.
import { api } from "../../../host/ipc";
import { focusEditor, openDocument, reveal } from "../../../state/document-controller";
import { openCurrentInNewWindow } from "../../../state/document-windows";
import { closePane, layout, split } from "../../../state/layout";
import { paletteHost } from "../../../state/palette-host";
import { rememberSearch } from "../../../state/recent";
import { searchFor } from "../../../state/search-port";
import { state } from "../../../state/store";
import { createNote } from "../../../state/vault";
import { allCommands } from "../../../ui/commands";
import { rememberCommand, startCommand } from "../../../ui/palette";
import type { OpenWay, Reading } from "./model";
import { TEMPLATE_COMMAND, type Row } from "./sources";

export type Step =
  /// Si resta aperti, con un'altra domanda.
  | { kind: "go"; mode: Reading["mode"]; text: string }
  /// Il lanciatore si chiude, poi questo parte.
  | { kind: "run"; run: () => void | Promise<void> };

/// Apre una nota dove il gesto chiede.
///
/// Una linguetta nuova è ciò che ogni apertura già fa (`openIn` aggiunge la
/// scheda, o si sposta su quella che c'è): Maiusc-Invio e Invio qui coincidono.
/// La divisione è quella del vecchio selettore: un riquadro accanto a quello
/// col fuoco, richiuso se l'apertura fallisce.
export async function openNote(doc: string, way: OpenWay): Promise<void> {
  if (way === "window") {
    await openCurrentInNewWindow(doc);
    return;
  }
  if (way === "split") {
    const added = split(layout.focus, "row");
    if (added) {
      try {
        await openDocument(doc);
      } catch (error) {
        closePane(added);
        throw error;
      }
      return;
    }
  }
  await openDocument(doc);
}

const point = (at: number) => ({ span: { start: at, end: at } });

/// Il comando della shell comune che mostra il pannello Cerca e porta il
/// fuoco nel suo campo.
export const SEARCH_PANEL_COMMAND = "shell.panel.search";

/// Il gesto che porta una domanda nel pannello Cerca, o `null` se non c'è
/// niente da portare o nessuno a cui portarlo.
///
/// Le due metà esistono già: la porta della ricerca (`state/search-port.ts`)
/// mette la domanda nella casella e la fa partire come se l'avesse scritta
/// l'utente, il comando apre il pannello (anche quando è un cassetto) e ci
/// porta il fuoco. Una domanda vuota non si porta: svuoterebbe quella che il
/// pannello tiene.
export function toSearchPanel(text: string): (() => void | Promise<void>) | null {
  const query = text.trim();
  if (query === "" || !state.vaultRoot) return null;
  const show = allCommands().find((entry) => entry.id === SEARCH_PANEL_COMMAND)?.run;
  if (!show) return null;
  return () => {
    searchFor(query);
    return show();
  };
}

/// Il passo che una riga comanda. `asked` è ciò che si stava chiedendo: una
/// ricerca conclusa aprendo un risultato è una ricerca da ricordare.
export function step(row: Row, way: OpenWay, asked: Reading): Step {
  switch (row.kind) {
    case "note":
      return {
        kind: "run",
        run: async () => {
          if (asked.mode === "search") rememberSearch(asked.text);
          await openNote(row.doc, way);
          if (row.at !== null && way !== "window") await reveal(row.doc, point(row.at));
        },
      };
    case "query":
      return { kind: "go", mode: "search", text: row.query };
    case "create":
      return {
        kind: "run",
        run: async () => {
          // Come `shell.note.new`: la nota nasce nello spazio attivo.
          const doc = await createNote(row.name, state.activeSpace ?? undefined);
          if (!doc) return;
          await openNote(doc, way);
          focusEditor();
        },
      };
    case "command":
      return {
        kind: "run",
        run: () => {
          // Un comando di shell si fa e basta, e si ricorda qui; uno del kernel
          // prosegue col modulo e col piano della palette, che lo ricorda lei
          // quando riesce.
          if (row.entry.run) rememberCommand(row.entry.id);
          startCommand(row.entry, paletteHost);
        },
      };
    case "heading":
      return { kind: "run", run: () => reveal(row.doc, point(row.at)) };
    case "tag":
      return { kind: "go", mode: "search", text: `tag:#${row.name}` };
    case "line":
      return { kind: "run", run: () => reveal(row.doc, point(row.at)) };
    case "template":
      return {
        kind: "run",
        run: async () => {
          const outcome = await api.invokeCommand(TEMPLATE_COMMAND, { template: row.doc });
          if (outcome.notify) paletteHost.notify(outcome.notify, outcome.partial ? "guasto" : "info");
          await paletteHost.onEffect(outcome.effect);
        },
      };
  }
}
