// Che cosa succede quando una riga del lanciatore viene scelta, e che cosa fanno
// le azioni di una riga (Tab).
//
// Due esiti soli: si resta nel lanciatore, in un altro modo (un'etichetta porta
// alle sue note, una persona o un blocco hanno il loro gesto), oppure il
// lanciatore si chiude e parte un gesto che esiste già (aprire, dividere,
// rivelare un punto, avviare un comando, copiare un link). Nessuna primitiva
// nuova: qui si scelgono e si mettono in fila quelle della shell.
import { copyNoteLinks, focusEditor, openDocument, reveal } from "../../../state/document-controller";
import { closePane, layout, split } from "../../../state/layout";
import { setPinned } from "../../../state/organization";
import { paletteHost } from "../../../state/palette-host";
import { createPerson } from "../../../state/people";
import { rememberSearch } from "../../../state/recent";
import { searchFor } from "../../../state/search-port";
import { state } from "../../../state/store";
import { createNote } from "../../../state/vault";
import { notesByName } from "../../../host/query";
import { t } from "../../../i18n/strings";
import { pageName } from "../../../rules/mirrored";
import { allCommands, displayBinding } from "../../../ui/commands";
import { notify } from "../../../ui/notify";
import { rememberCommand, startCommand } from "../../../ui/palette";
import type { OpenWay, Reading } from "./model";
import type { ActionId, Row } from "./sources";

export type Step =
  /// Si resta aperti, con un'altra domanda.
  | { kind: "go"; mode: Reading["mode"]; text: string }
  /// Il lanciatore si chiude, poi questo parte.
  | { kind: "run"; run: () => void | Promise<void> }
  /// Non succede niente: la riga spiega, non apre (le voci d'aiuto).
  | { kind: "none" };

/// Il comando del kernel che rinomina o sposta una nota (il suo modulo chiede
/// il nuovo percorso, col vecchio già scritto).
export const RENAME_COMMAND = "note.rename";
/// Il comando della shell comune che mostra il pannello Cerca e porta il
/// fuoco nel suo campo.
export const SEARCH_PANEL_COMMAND = "shell.panel.search";
/// Invio come si scrive sui tasti (`↵`), dentro un accordo.
export const withEnter = (chord: string): string => displayBinding(chord).replace("Enter", "↵");

/// Apre una nota dove il gesto chiede.
///
/// La divisione è quella del vecchio selettore: un riquadro accanto a quello
/// col fuoco, richiuso se l'apertura fallisce.
export async function openNote(doc: string, way: OpenWay): Promise<void> {
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
    case "group":
    case "help":
      return { kind: "none" };
    case "note":
      return {
        kind: "run",
        run: async () => {
          // Una nota trovata nel testo conclude una ricerca, e quella si ricorda.
          if (row.hit === "text" && asked.mode === "all" && asked.text.trim() !== "") rememberSearch(asked.text);
          await openNote(row.doc, way);
          if (row.at !== null) await reveal(row.doc, point(row.at));
        },
      };
    case "command":
      return {
        kind: "run",
        run: () => {
          // Un comando di shell si fa e basta, e si ricorda qui; uno del kernel
          // prosegue col modulo e col piano della palette, che lo ricorda lei
          // quando riesce.
          if (row.entry.run && !row.entry.unavailable) rememberCommand(row.entry.id);
          startCommand(row.entry, paletteHost);
        },
      };
    case "heading":
      return { kind: "run", run: () => reveal(row.doc, point(row.at)) };
    case "tag":
      return { kind: "go", mode: "all", text: `tag:#${row.name}` };
    case "line":
      return { kind: "run", run: () => reveal(row.doc, point(row.at)) };
    case "person":
      return { kind: "run", run: () => openNote(row.doc, way) };
    case "create-person":
      return {
        kind: "run",
        run: async () => {
          const doc = await createPerson(row.name);
          if (!doc) return;
          await openNote(doc, way);
          focusEditor();
        },
      };
    case "block":
      // Un blocco è un'azione dell'editor: la shell la esegue sulla superficie
      // col fuoco, come la barra di formato.
      return { kind: "run", run: () => startCommand(row.entry, paletteHost) };
    case "action":
      return { kind: "run", run: () => runAction(row.action, row.doc) };
  }
}

/// Le azioni di una nota (Tab): aprire qui o a lato, rinominare o spostare,
/// copiare il link, appuntare. La sbirciata non c'è ancora: quando ci sarà, ha
/// la sua azione.
export function actionRows(doc: string): Row[] {
  const pinned = state.meta.pinned.includes(doc);
  const rename = allCommands().find((entry) => entry.id === RENAME_COMMAND)?.binding ?? null;
  const row = (action: ActionId, title: string, keys: string | null): Row => ({
    kind: "action",
    key: `a:${action}`,
    action,
    doc,
    title,
    keys,
  });
  return [
    row("open", t("launcher.action.open"), "↵"),
    row("split", t("launcher.action.split"), withEnter("Mod-Enter")),
    row("rename", t("launcher.action.rename"), rename === null ? null : displayBinding(rename)),
    row("copy-link", t("launcher.action.copy_link"), null),
    row("pin", pinned ? t("launcher.action.unpin") : t("launcher.action.pin"), null),
  ];
}

/// Esegue un'azione su una nota, senza che sia aperta.
export async function runAction(action: ActionId, doc: string): Promise<void> {
  switch (action) {
    case "open":
      await openNote(doc, "here");
      return;
    case "split":
      await openNote(doc, "split");
      return;
    case "rename": {
      const entry = allCommands().find((each) => each.id === RENAME_COMMAND);
      if (!entry) {
        notify(t("launcher.action.unavailable"), "info");
        return;
      }
      startCommand(entry, paletteHost, { doc });
      return;
    }
    case "copy-link":
      await copyNoteLinks([doc]);
      return;
    case "pin":
      await setPinned(doc, !state.meta.pinned.includes(doc));
      return;
  }
}

/// Maiusc-Invio su una ricerca senza risultati: crea la nota col nome scritto,
/// nella cartella attiva. Un nome già preso apre la nota che c'è, e lo dice.
export async function createNamed(name: string): Promise<void> {
  const taken = (await notesByName(name)).find((doc) => pageName(doc).toLowerCase() === name.toLowerCase());
  if (taken) {
    await openNote(taken, "here");
    notify(t("launcher.create.taken", { name }), "info");
    return;
  }
  // Come `shell.note.new`: la nota nasce nello spazio attivo.
  const doc = await createNote(name, state.activeSpace ?? undefined);
  if (!doc) return;
  await openNote(doc, "here");
  focusEditor();
}
