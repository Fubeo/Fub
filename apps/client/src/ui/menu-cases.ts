// I casi tipici di ogni posto col tasto destro, per il bilancio dei menu
// (`menu-budget.test.ts`): una nota Markdown vera, il cursore in un punto, il
// menu composto come lo disegna la shell. Soltanto per i test.
import type { CommandSpec } from "../host/contract";
import type { EditorSurface } from "../editors/core/registry";
import { mountMarkdownSurface } from "../editors/text/profiles/markdown/surface";
import { mediaMenu } from "../editors/media/media-surface";
import { composeEditorMenu, type ComposedEditorMenu, type EditorMenuHost } from "../panels/editor-menu";
import type { CommandEntry } from "./commands";

export interface MenuCase {
  readonly place: string;
  /// Apre il menu del caso; `close` smonta ciò che ha montato.
  open(): { readonly menu: ComposedEditorMenu; readonly miniBar: boolean; close(): void };
}

const spec = (id: string, title: string): CommandSpec => ({
  id,
  title,
  description: "",
  keybinding: null,
  params: [],
  scope: { writes: true, reach: "session", reversible: true },
  surfaces: ["slash"],
});

const command = (id: string, title: string): CommandEntry =>
  ({ id, title, description: "", layer: "document", binding: null, declared: null, spec: null, run: null });

/// I comandi del registro e della shell che le voci delle note nominano.
const SPECS = [spec("note.extract", "Estrai in una nota"), spec("tag.rename", "Rinomina il tag")];
const COMMANDS = [
  command("shell.doc.copy_anchor_link", "Copia il link a questo punto"),
  command("shell.doc.search", "Cerca nel documento"),
  command("shell.mode.reading", "Lettura"),
  command("shell.doc.export", "Esporta…"),
];

function hostOf(surface: EditorSurface): EditorMenuHost {
  return {
    surface: () => surface,
    specs: () => SPECS,
    commands: () => COMMANDS,
    selection: () => "",
    runSlash: () => {},
    runCommand: () => {},
    focusPane: () => {},
  };
}

/// Una nota col testo `doc` nel modo `mode`, il cursore al carattere `at`
/// (testo ASCII: byte e caratteri coincidono); `selectAll` sceglie tutto.
function noteCase(place: string, doc: string, at: number, mode: "source" | "live_preview" | "reading" = "live_preview", selectAll = false): MenuCase {
  return {
    place,
    open() {
      const parent = document.createElement("div");
      document.body.append(parent);
      const surface = mountMarkdownSurface({ paneId: "bilancio", documentId: "note/bilancio.md", parent }, {
        onChange: () => {},
        onSelectionChange: () => {},
        onOpenWikilink: () => {},
        onOpenWikilinkBeside: () => {},
        onOpenPath: () => {},
        onShowFile: () => {},
        onSearchTag: () => {},
        completions: { searchNotes: async () => [], listTags: async () => [] },
      });
      surface.buffer.setDoc(doc);
      surface.setMode(mode);
      // Un solo gesto sul cursore, l'ultimo: dopo il fuoco ogni transazione
      // riscrive la selezione del DOM, e happy-dom la notifica a metà update.
      if (selectAll) surface.contextMenu!(null)?.clipboard?.run("select-all");
      else if (mode !== "reading") surface.reveal({ span: { start: at, end: at } });
      const raw = surface.contextMenu!(null);
      if (!raw) throw new Error(`nessun menu per ${place}`);
      return {
        menu: composeEditorMenu(raw, hostOf(surface)),
        miniBar: raw.miniBar === true,
        close: () => {
          surface.destroy();
          parent.remove();
        },
      };
    },
  };
}

/// Un file che non è una nota, mostrato dal visualizzatore, con un'app Craft
/// installata: «Apri con un'altra app» è il sottomenu, l'app di sistema per
/// prima e poi le app che aprono il file.
function fileCase(place: string, doc: string): MenuCase {
  return {
    place,
    open() {
      const element = document.createElement("div");
      const raw = mediaMenu({ kind: "image", element }, null, doc, {
        transport: { open: async () => Promise.reject(new Error("niente")), read_chunk: async () => new ArrayBuffer(0), close: async () => {} },
        assetUrl: (handle) => handle,
        copyText: async () => {},
        openExternal: () => {},
        openWith: {
          installed: () => true,
          editors: async () => [
            { id: "photocraft", name: "PhotoCraft", opens: ["png"], installed: true, running: true },
            { id: "lightcraft", name: "LightCraft", opens: ["png"], installed: false, running: false },
          ],
          open: async (_doc, editor) => ({ editor, how: "new_process" }),
        },
      });
      if (!raw) throw new Error(`nessun menu per ${place}`);
      const surface = { contextMenu: () => raw } as unknown as EditorSurface;
      return { menu: composeEditorMenu(raw, hostOf(surface)), miniBar: false, close: () => {} };
    },
  };
}

const NOTE = "## Formula\n\nLa media e la [[Media]] di un #esame, vedi https://it.wikipedia.org/wiki/Media qui.\n\n- uno\n- due\n- [ ] fare\n\n```python\nx = 1\n```\n\n| Nome | Voto |\n| --- | --- |\n| Ada | 10 |\n";
const at = (text: string, offset = 1): number => NOTE.indexOf(text) + offset;

export const MENU_CASES: readonly MenuCase[] = [
  noteCase("il testo", NOTE, at("La media")),
  noteCase("la selezione", "due parole\n", 2, "live_preview", true),
  noteCase("un link alla nota", NOTE, at("[[Media]]", 3), "source"),
  noteCase("un indirizzo web", NOTE, at("https://", 4), "source"),
  noteCase("un tag", NOTE, at("#esame", 2)),
  noteCase("un titolo", NOTE, at("Formula")),
  noteCase("un elenco", NOTE, at("- due", 3)),
  noteCase("un'attività", NOTE, at("fare")),
  noteCase("un blocco di codice", NOTE, at("x = 1")),
  noteCase("una tabella nel sorgente", NOTE, at("| Ada", 3), "source"),
  noteCase("la Lettura", NOTE, 0, "reading"),
  fileCase("un file con «Apri con un'altra app»", "Foto/IMG_0001.png"),
];
