// Il gestore del documento: le porte delle schede e della lavagna, la
// sbirciata delle note, i clic sui link, gli aiuti del vault.
import { pickFromList } from "../ui/dialogs";
import { type CanvasCardPorts } from "../editors/core/bootstrap";
import type { CanvasNotesPort } from "../editors/canvas/engine";
import { UI_CRAFT } from "../editors/core/component-surfaces";
import { components } from "./components";
import { type EditorSurface } from "../editors/core/registry";
import { pageName } from "../rules/organizer";
import { folderForNote } from "../rules/mirrored";
import { mediaKindOfId, mimeOfId } from "../editors/media/media-types";
import { type ResourceTransport } from "../editors/media/resource-port";
import { vaultImageSource } from "../editors/text/profiles/markdown/media";
import { blockIds, type BlockOption } from "../editors/text/profiles/markdown/completions";
import { DEFAULT_ATTACHMENT_FOLDER, relativeUrl, type AttachmentDeposit } from "../editors/media/attachment-target";
import { formatKindOf } from "../ui/format-kind";
import { mountMarkdown, type MarkdownMountOptions } from "../editors/text/profiles/markdown/mount";
import { openWebPage } from "../ui/web-viewer";
import { linkCardView, requestLinkCard } from "./link-cards";
import { isNoteDoc } from "./note-cards";
import { createNotePeek, LINK_CLICK_KEY, linkClickOf, type LinkClick, type NotePeek, type PeekTarget } from "./note-peek";
import { api } from "../host/ipc";
import { WITHOUT_PAGE, documentOutline, matchingDocuments, renderEmbed, resolvedReference, searchExpression, settings, vaultEntries } from "../host/query";
import { type DocumentSource, type VaultEntry } from "../host/contract";
import { onEvent } from "./kernel";
import { on, state } from "./store";
import { syntaxForms } from "../host/query";
import type { CardEditorHub } from "../editors/core/cards/editor-port";
import { lazyCardEditorHub } from "./card-writes";
import { createFormatBar, type GroupId } from "../panels/format-bar";
import { documentSessions } from "./document-session";
import { activeDoc, layout } from "./layout";
import { createNote, folderOfNote, handToSystem, openVaultRoot, vaultArg } from "./vault";
import { confirm } from "../platform/confirm";
import { showComponent } from "../ui/commands";
import { notify } from "../ui/notify";
import { slashContextDoc } from "./slash";
import { errorText, isErrorKind } from "../host/errors";
import { craftServed, previewOf, renderPreview, watchCraftPreviews } from "./craft-previews";
import { openWithEntry } from "../panels/open-with";
import { showContextMenu } from "../ui/menu";
import { t } from "../i18n/strings";
import { type Lifetime } from "../ui/lifetime";
import { panes, deps, view, surfaceRegistry } from "./document-controller-state";
import { openDocument, openDocumentBeside, isOpen, openWikilink, linkedPdfPage, openFigure } from "./document-controller-open";
import { theme, scheduleContext, reveal } from "./document-controller-modes";
import { keepOrDiscardUnsaved, heldReadOnly, heldWhy } from "./document-controller-save";

// --- montaggio --------------------------------------------------------------
/// Le note della lavagna (T70): «Estrai in una nota» e «Copia il testo qui».
/// Si crea con `note.create` e si legge come le altre note; gli errori
/// arrivano alla tela come frasi.
export const canvasNotes: CanvasNotesPort = {
  freeName: canvasFreeName,
  create: async (folder, name, text) => {
    try {
      return await createCanvasNote(folder, name, text);
    } catch (error) {
      throw new Error(errorText(error));
    }
  },
  read: async (path) => {
    try {
      return documentSessions.text(path) ?? (await api.readDocument(path)).text;
    } catch (error) {
      throw new Error(errorText(error));
    }
  },
};

async function createCanvasNote(folder: string, name: string, text: string): Promise<string> {
  // Creazione, lettura e scrittura sono un gesto solo: stanno tutte nel vault
  // in cui il gesto è partito, anche se `createNote` aspetta e ne viene aperto
  // un altro (FUB-001). La cartella `""` è la radice: `createNote` non ci
  // mette quella delle note nuove.
  const vault = openVaultRoot();
  const doc = await createNote(name, folder);
  if (!doc) throw new Error("note.create did not return a created document");
  if (text === "") return doc;
  const source = await api.readDocument(doc, vault);
  await api.writeDocument(doc, text, { kind: "descends_from", value: source.revision }, vault);
  return doc;
}

/// Il nome da proporre per una nota `name` in `folder` (T70): `name`, o il
/// primo `name 1`, `name 2`… che nessun documento della cartella usa (senza
/// guardare l'estensione né le maiuscole). Solo una proposta, come quella del
/// kernel per «Senza titolo»: se il nome si occupa prima di crearla,
/// `note.create` lo rifiuta invece di sovrascrivere.
export async function canvasFreeName(folder: string, name: string): Promise<string> {
  const entries = await vaultEntries(WITHOUT_PAGE, "document", { path: folder, descendants: false });
  const taken = new Set(entries.items.map((entry) => {
    const base = entry.id.slice(entry.id.lastIndexOf("/") + 1);
    const dot = base.lastIndexOf(".");
    return (dot > 0 ? base.slice(0, dot) : base).toLocaleLowerCase();
  }));
  if (!taken.has(name.toLocaleLowerCase())) return name;
  for (let n = 1; ; n += 1) {
    const candidate = `${name} ${n}`;
    if (!taken.has(candidate.toLocaleLowerCase())) return candidate;
  }
}

/// Quanti file del vault propone la scelta di una card file: gli altri si
/// contano in fondo all'elenco, e il path resta scrivibile nella card.
const CANVAS_FILE_CHOICES = 500;

/// Il file a cui punta una nuova card file del canvas: uno che c'è, scelto
/// dall'utente, non un segnaposto. Con `name` (il file di una scheda che non
/// c'è più, «Ritrova…») gli omonimi vanno per primi, e si chiede tutto il
/// vault: un omonimo oltre il tetto della lista non si troverebbe.
export async function pickCanvasFile(name?: string): Promise<string | null> {
  const page = await vaultEntries(name === undefined ? { offset: 0, limit: CANVAS_FILE_CHOICES } : WITHOUT_PAGE);
  const entries = name === undefined ? page.items : namesakesFirst(page.items, name).slice(0, CANVAS_FILE_CHOICES);
  return pickFromList<string>({
    title: t("canvas.pick_file"),
    placeholder: t("canvas.pick_file_filter"),
    items: entries.map((entry) => ({ label: pageName(entry.id), detail: entry.id, value: entry.id })),
    more: Math.max(0, page.total - entries.length),
  });
}

/// Le voci che hanno lo stesso nome (senza cartelle, senza distinguere le
/// maiuscole) in testa, nell'ordine che avevano; il resto dopo, com'era.
function namesakesFirst<T extends { readonly id: string }>(entries: readonly T[], name: string): T[] {
  const wanted = name.toLocaleLowerCase();
  const same = (entry: T): boolean => (entry.id.split("/").pop() ?? entry.id).toLocaleLowerCase() === wanted;
  return [...entries.filter(same), ...entries.filter((entry) => !same(entry))];
}

/// Il documento a cui porta un collegamento del disegno `from`: uno che c'è,
/// scelto dall'utente fra i file del vault, come il file di una card. Il
/// disegno stesso non c'è; quello a cui porta adesso il collegamento `current`,
/// se si trova, è già scelto, e c'è anche oltre le voci elencate.
export async function pickDrawingLink(from: string, current: string | null): Promise<string | null> {
  const [page, now] = await Promise.all([
    vaultEntries({ offset: 0, limit: CANVAS_FILE_CHOICES }),
    current === null ? null : resolvedReference({ kind: "path", value: current }, from).catch(() => null),
  ]);
  const ids = page.items.map((entry) => entry.id).filter((id) => id !== from);
  const known = now?.doc ?? null;
  if (known !== null && known !== from && !ids.includes(known)) ids.unshift(known);
  return pickFromList<string>({
    title: t(current === null ? "vector.link.pick" : "vector.link.change"),
    placeholder: t("vector.link.filter"),
    items: ids.map((id) => ({ label: pageName(id), detail: id, value: id })),
    more: Math.max(0, page.total - page.offset - page.items.length),
    current: known ?? undefined,
  });
}

/// I byte dei file del vault, per chi li legge interi.
export const mediaTransport: ResourceTransport = {
  open: (id, vault) => api.resourceOpen(id, vault ?? null),
  read_chunk: api.resourceReadChunk,
  close: api.resourceClose,
};

/// La montatura sicura del Markdown dentro una lavagna, la stessa per le
/// schede di testo e per le schede di nota: i link si aprono col gesto e si
/// risolvono da `documentId`.
export function canvasMarkdownMount(documentId: string): MarkdownMountOptions {
  return {
    documentId,
    openWikilink: (page, heading, block) => openWikilink(page, heading, block, undefined, { gesture: true }),
    openFigure,
    openPath: async (path, from) => {
      const target = await resolvedReference({ kind: "path", value: path }, from ?? documentId);
      if (!target) throw new Error(t("preview.target_missing"));
      await openDocument(target.doc, { gesture: true });
      if (target.at) await reveal(target.doc, { span: target.at.span });
    },
    searchTag: (tag) => deps.searchTag(tag),
  };
}

/// Gli eventi del kernel che cambiano ciò che una scheda mostra del suo file:
/// i `document_*` per un file che un formato serve (una nota, un foglio), gli
/// `entry_*` per gli altri (un'immagine, un PDF).
function watchCardFile(path: string, changed: () => void): () => void {
  const mine = (id: string): void => {
    if (id === path) changed();
  };
  const moved = (from: string, to: string): void => {
    if (from === path || to === path) changed();
  };
  const stops = [
    onEvent("document_changed", (e) => mine(e.id)),
    onEvent("entry_changed", (e) => mine(e.id)),
    onEvent("document_removed", (e) => mine(e.id)),
    onEvent("entry_removed", (e) => mine(e.id)),
    onEvent("document_renamed", (e) => moved(e.from, e.to)),
    onEvent("entry_renamed", (e) => moved(e.from, e.to)),
  ];
  return () => {
    for (const stop of stops) stop();
  };
}

/// La sbirciata della finestra (E11, T20): una sola, sopra il riquadro col
/// fuoco, con l'editor della nota montato dalla porta delle schede. Nasce al
/// primo uso.
export let notePeek: NotePeek | null = null;
/// La sbirciata se ne va senza domande, con la shell che si smonta.
export function dismissNotePeek(): void {
  notePeek?.dismiss({ quiet: true });
  notePeek = null;
}
function notePeekPort(): NotePeek {
  notePeek ??= createNotePeek({
    // Dalla nota che contiene il link (una sbirciata dentro una sbirciata,
    // una scheda della lavagna), non dal riquadro col fuoco.
    resolve: async ({ link, from }) => {
      const found = await resolvedReference(
        link.kind === "wiki"
          ? { kind: "wiki", value: { page: link.page, heading: link.heading, block: link.block } }
          : { kind: "path", value: link.path },
        from ?? activeDoc() ?? undefined,
      );
      if (!found) return { kind: "missing" };
      return isNoteDoc(found.doc) ? { kind: "note", doc: found.doc } : { kind: "other", doc: found.doc };
    },
    editors: cardEditors,
    host: () => {
      const pane = panes.get(layout.focus);
      return pane ? view.peekHost(pane) : null;
    },
    // Il riquadro prende la nota col cursore dove stava nella sbirciata.
    openHere: async (doc, at) => {
      await openDocument(doc, { gesture: true });
      if (at) await reveal(doc, { span: at });
    },
    openBeside: async (doc, at) => {
      await openDocumentBeside(doc, "row");
      if (at) await reveal(doc, { span: at });
    },
    // Un PDF, un foglio: la sbirciata è per le note, il resto si apre a lato.
    openOther: async (doc, target) => {
      const page = linkedPdfPage(doc, target.link.kind === "wiki" ? target.link.heading : null);
      await openDocumentBeside(doc, "row", page === null ? {} : { page });
    },
    // Il bersaglio com'è scritto, come `openWikilink`; la cartella delle note
    // nuove (`files.new-note-folder` con `./`) è quella della nota del link.
    create: async (page, from) => createNote(page, from ? await folderOfNote(from) : undefined),
    onMoved: (listener) => onEvent("document_renamed", (event) => listener(event.from, event.to)),
    // La barra di formato e il contesto seguono chi ha la scrittura.
    ownerChanged: () => {
      const pane = panes.get(layout.focus);
      if (pane) view.drawToolbar(pane);
      scheduleContext();
    },
    failed: (message) => notify(message, "guasto"),
  });
  return notePeek;
}

/// La superficie della sbirciata sopra il riquadro `paneId` se ha lei la
/// scrittura (il fuoco ci è entrato e non è tornato al testo del riquadro), o
/// `null`. La barra di formato, il menu del testo e i comandi del documento
/// agiscono su di lei.
export function peekSurfaceIn(paneId: string): EditorSurface | null {
  const pane = panes.get(paneId);
  if (!pane || !notePeek?.isIn(view.peekHost(pane))) return null;
  return notePeek.surface();
}

/// La superficie su cui agiscono i comandi dell'editor del riquadro col fuoco,
/// col documento che mostra: la sbirciata se ha lei la scrittura, se no il
/// riquadro.
export function commandTarget(): { doc: string; surface: EditorSurface } | null {
  const peek = peekSurfaceIn(layout.focus);
  const peekDoc = peek ? notePeek?.shown()?.doc : null;
  if (peek && peekDoc) return { doc: peekDoc, surface: peek };
  const r = panes.get(layout.focus);
  if (r?.shown?.k !== "doc" || !r.surface) return null;
  return { doc: r.shown.doc, surface: r.surface };
}

/// Il clic che apre un link: `editor.link-click`, letto all'avvio e a ogni
/// cambio. Finché non è letto vale quello di serie.
export let linkClick: LinkClick = "apri";
export function watchLinkClick(lifetime: Lifetime): void {
  let asked = 0;
  const read = (): void => {
    const mine = ++asked;
    void settings().then((entries) => {
      if (mine !== asked || lifetime.closed) return;
      linkClick = linkClickOf(entries.find((entry) => entry.spec.key === LINK_CLICK_KEY)?.value);
    }, () => {});
  };
  read();
  lifetime.add(onEvent("setting_changed", (event) => {
    if (event.key === LINK_CLICK_KEY) read();
  }));
  lifetime.add(onEvent("vault_opened", read));
  lifetime.add(() => {
    asked++;
    linkClick = "apri";
  });
}

/// Alt col clic, Alt-Invio o «Sbircia» su un link a una nota: la sbirciata.
export function peekLink(target: PeekTarget): Promise<void> {
  return notePeekPort().open(target);
}

/// Alt-Invio su una nota trovata con Ctrl O: la sbirciata del documento, già
/// risolto (il nome del vault è il suo percorso).
export function peekDocument(doc: string): Promise<void> {
  return peekLink({ link: { kind: "path", path: `/${doc}` }, from: null });
}

/// La sbirciata, per chi la chiude o la guarda (i banchi, i comandi).
export function notePeekState(): ReturnType<NotePeek["shown"]> {
  return notePeek?.shown() ?? null;
}

/// I gruppi della barra di formato di una scheda (T41): tutti tranne la
/// cronologia, perché sulla lavagna Annulla e Ripeti stanno in cima e,
/// mentre si scrive, valgono per il testo.
const CARD_TOOLBAR_GROUPS: readonly GroupId[] = ["block", "inline", "links", "lists", "blocks", "table", "other"];

/// La barra di formato di una scheda che scrive: la stessa dei riquadri, per
/// la superficie della scheda, ridisegnata quando cambiano i comandi.
function cardToolbar(surface: EditorSurface, life: Lifetime): HTMLElement {
  const bar = createFormatBar({
    surface: () => surface,
    writing: () => true,
    focusPane: () => {},
    runCommand: (id) => deps.runCommand(id),
    only: CARD_TOOLBAR_GROUPS,
  });
  bar.update(state.commandSpecs);
  life.add(on("commands", () => bar.update(state.commandSpecs)));
  life.add(() => bar.destroy());
  return bar.element;
}

/// La porta per scrivere dentro le schede (N6 T40): le stesse sessioni e lo
/// stesso registro delle superfici dei riquadri di questa finestra, e la
/// stessa sola lettura (`heldReadOnly`). Nasce al primo uso, e il suo modulo
/// arriva allora con un `import()`: serve solo a una lavagna, che arriva anche
/// lei così, e non pesa sull'avvio di nessuna finestra (`lazyCardEditorHub`).
export const cardEditors: CardEditorHub = lazyCardEditorHub(async () => {
  const { createCardEditorPort } = await import("../editors/core/cards/editor-port");
  return () => createCardEditorPort({
    sessions: documentSessions,
    surfaces: () => surfaceRegistry ?? null,
    held: heldReadOnly,
    heldWhy,
    shownInPane: isOpen,
    theme: () => theme,
    forms: syntaxForms,
    toolbar: cardToolbar,
    conflict: (box, path) => view.drawCardConflict(box, path),
    notices: (box, path, drawn) => view.drawCardNotices(box, path, drawn),
    // Una scheda chiusa sopra un salvataggio fallito: la domanda di un
    // riquadro, e «Tieni» riapre la nota nel riquadro col fuoco (T102).
    unsaved: (path) => keepOrDiscardUnsaved(path, layout.focus),
  });
}, {
  sessions: () => documentSessions,
  shownInPane: isOpen,
  unsaved: (path) => keepOrDiscardUnsaved(path, layout.focus),
});

/// Le porte delle schede della lavagna (N6 T12). Le immagini e i PDF si
/// leggono dalla `transport` dei media (`mediaTransport`), i fogli con le
/// chiamate di `gridHost`: le passa la registrazione della lavagna.
export const canvasCards: CanvasCardPorts = {
  editors: cardEditors,
  note: {
    show: async (path, heading, host, life) => {
      const content = await renderEmbed(path, heading, null);
      if (life.closed) return;
      // Chiusa la vita, la resa resta, ferma: la scheda ferma la mostra.
      life.add(mountMarkdown(host, content.html, { ...canvasMarkdownMount(path), keepOnTeardown: true }));
    },
  },
  sheet: {
    // La sessione aperta del documento, se c'è (A-9): la scheda mostra ciò
    // che il foglio mostra, anche non salvato. Sennò il giornale vuoto sui
    // byte del disco.
    source: async (path) => {
      const vault = openVaultRoot();
      let read: DocumentSource;
      try {
        read = await api.readDocument(path, ...vaultArg(vault));
      } catch (error) {
        if (isErrorKind(error, "not_found")) return null;
        throw error;
      }
      const session = openVaultRoot() === vault ? documentSessions.inspect(path) : undefined;
      if (session?.lifecycle === "open" && session.base.kind === "descends_from") {
        return { journal: session.text, base: session.base.value, format: read.format_id };
      }
      return { journal: "", base: read.revision, format: read.format_id };
    },
  },
  web: {
    view: linkCardView,
    request: requestLinkCard,
    watch: (changed) => on("link-cards", changed),
    // Il consenso, la barra e gli errori sono del visore della finestra.
    open: async (url) => {
      await openWebPage(url);
    },
  },
  craft: {
    served: craftServed,
    // La riga spenta che serve il file: l'id per «Accendi…» e il nome per la
    // ragione, come nel riquadro «solo come file».
    offComponent: () => {
      const row = components()?.offRowFor(UI_CRAFT);
      return row ? { id: row.id, name: row.nome } : null;
    },
    // «Accendi…» apre la riga nella pagina Componenti (K5 T24); senza
    // impostazioni montate dà falso.
    showComponent,
    // Il componente acceso o spento cambia i comandi che il kernel elenca.
    onServed: (changed) => on("commands", changed),
    preview: (path) => previewOf(path, "large"),
    watchPreviews: watchCraftPreviews,
    render: (path) => renderPreview(path, "large"),
    openWith: (path, anchor) => void openCardWith(path, anchor),
  },
  open: (path, subpath) => {
    const page = linkedPdfPage(path, subpath?.replace(/^#/, ""));
    void openDocument(path, page === null ? { gesture: true } : { gesture: true, page })
      .then(() => landOnSheetCell(path, subpath))
      .catch((error: unknown) => {
        notify(errorText(error), "guasto");
      });
  },
  watch: watchCardFile,
};

/// La prima cella che la parte di un foglio nomina col suo foglio
/// (`#Budget!C7`, `#'Conti 2025'!A1:E7`); `null` per un nome, una tabella,
/// un foglio intero o una cella senza foglio.
export function sheetCellOf(subpath: string | null | undefined): { readonly sheet: string; readonly cell: string } | null {
  const text = subpath?.replace(/^#/, "").trim() ?? "";
  const match = /^(?:'((?:[^']|'')+)'|([^!'"\s][^!]*?))\s*!\s*\$?([A-Za-z]{1,3})\$?([1-9]\d{0,6})(?::\$?[A-Za-z]{1,3}\$?[1-9]\d{0,6})?$/.exec(text);
  if (!match) return null;
  const sheet = match[1] !== undefined ? match[1].replaceAll("''", "'") : match[2]!.trim();
  return { sheet, cell: `${match[3]!.toUpperCase()}${match[4]!}` };
}

/// Porta il foglio appena aperto (T53: il clic su un valore nel testo, «Apri»
/// di una scheda di foglio) sulla cella che la parte nomina, senza scrivere
/// niente. Se la cartella non è ancora mostrata, lo fa alla prima cella
/// attiva che la superficie annuncia; una superficie che non lo sa fare
/// resta dov'è.
function landOnSheetCell(path: string, subpath: string | null): void {
  const target = formatKindOf(path) === "sheet" ? sheetCellOf(subpath) : null;
  if (target === null) return;
  const shown = panes.get(layout.focus);
  if (shown?.shown?.k !== "doc" || shown.shown.doc !== path) return;
  const source = shown.surface?.activeCell;
  if (!source?.select) return;
  if (source.select(target.sheet, target.cell)) return;
  const stop = source.subscribe(() => {
    if (source.read() === null) return;
    stop();
    source.select?.(target.sheet, target.cell);
  });
}

/// «Apri con…» da una scheda della lavagna (T18): il menu delle app di N7
/// sotto il pulsante, come il sottomenu dell'albero. Senza app Craft
/// installate non c'è niente da scegliere, e il file va all'app del sistema.
async function openCardWith(path: string, anchor: HTMLElement): Promise<void> {
  const entry = openWithEntry(path, { system: () => void handToSystem(path, true) });
  const items = entry.items;
  if (items === undefined) {
    entry.run?.();
    return;
  }
  try {
    const choices = typeof items === "function" ? await items() : items;
    if (!anchor.isConnected) return;
    showContextMenu(anchor, choices, { label: entry.label });
  } catch (error) {
    notify(errorText(error), "guasto");
  }
}

/// Un'immagine del vault che un disegno mostra per nome. Gli SVG non si
/// propongono: nel vault sono disegni, e a un disegno si porta un
/// collegamento.
function drawingImageChoice(id: string): boolean {
  return mediaKindOfId(id) === "image" && mimeOfId(id) !== "image/svg+xml";
}

/// Le immagini del vault, dalla più recente: l'anagrafe degli allegati letta a
/// pagine, tutta, perché l'elenco dica quante ne lascia fuori.
async function drawingImageEntries(): Promise<VaultEntry[]> {
  const found: VaultEntry[] = [];
  for (let offset = 0; ;) {
    const page = await vaultEntries({ offset, limit: CANVAS_FILE_CHOICES }, "asset");
    for (const entry of page.items) if (drawingImageChoice(entry.id)) found.push(entry);
    offset += page.items.length;
    if (page.items.length === 0 || offset >= page.total) break;
  }
  return found.sort((a, b) => b.mtime - a.mtime || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/// L'immagine del vault da mettere in un disegno: una che c'è, scelta con la
/// sua miniatura fra le immagini del vault, le più recenti prima.
export async function pickDrawingImage(): Promise<string | null> {
  const images = await drawingImageEntries();
  if (images.length === 0) {
    notify(t("vector.image.none"));
    return null;
  }
  const shown = images.slice(0, CANVAS_FILE_CHOICES);
  return pickFromList<string>({
    title: t("vector.image.pick"),
    placeholder: t("vector.image.filter"),
    items: shown.map((entry) => ({ label: pageName(entry.id), detail: entry.id, value: entry.id, thumbnail: vaultImageSource(entry.id) })),
    more: images.length - shown.length,
  });
}

/// L'immagine a cui porta l'`href` `path` del disegno `from`: il documento,
/// se c'è ed è un'immagine.
export async function drawingImageId(path: string, from: string): Promise<string | null> {
  const id = (await resolvedReference({ kind: "path", value: path }, from).catch(() => null))?.doc ?? null;
  return id !== null && mediaKindOfId(id) === "image" ? id : null;
}

export async function attachmentDeposit(doc: string): Promise<AttachmentDeposit> {
  // Il vault del documento che riceve gli allegati, preso prima di aspettare.
  const vault = openVaultRoot();
  const configured = (await settings()).find((entry) => entry.spec.key === "files.attachment-folder")?.value;
  const folder = typeof configured === "string" ? configured : DEFAULT_ATTACHMENT_FOLDER;
  return {
    folder,
    fromDocument: doc,
    write: (id, bytes, options) => api.resourceWrite(id, bytes, null, vault, options),
  };
}

/// Le cartelle che `files.excluded-folders` tiene fuori dal vault: indice e albero.
export async function excludedFolders(): Promise<readonly string[]> {
  const value = (await settings()).find((entry) => entry.spec.key === "files.excluded-folders")?.value;
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

/// Un'immagine remota di `doc` scaricata fra i suoi allegati, dopo il «sì»
/// dell'utente: la chiede l'host, che accetta soltanto `https` e il sito che
/// la domanda nomina, e il link che torna è relativo alla nota (L04). La
/// webview non la chiede mai alla rete.
export async function importRemoteImage(url: string, doc: string): Promise<string | null> {
  let site: string;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password) throw new Error(url);
    site = parsed.hostname;
  } catch {
    throw new Error(t("markdown.image_remote_not_https", { url }));
  }
  const vault = openVaultRoot();
  const deposit = await attachmentDeposit(doc);
  const folder = folderForNote(deposit.folder, doc);
  if (folder === "") throw new Error(t("markdown.image_remote_root"));
  const yes = await confirm(t("markdown.image_remote_confirm", { site, url }), {
    title: t("markdown.image_remote_title"),
    okLabel: t("markdown.image_remote_load"),
  });
  if (!yes) return null;
  const receipt = await api.viewerSave(url, "", [site], folder, vault);
  return relativeUrl(doc, receipt.id);
}

/** File/folder entries are expanded before the first asynchronous deposit. */
export async function droppedFiles(data: DataTransfer): Promise<readonly File[]> {
  const entries = Array.from(data.items, (item) => item.kind === "file" ? item.webkitGetAsEntry?.() : null)
    .filter((entry): entry is FileSystemEntry => entry !== null && entry !== undefined);
  if (!entries.length) return Array.from(data.files);
  const files: File[] = [];
  async function visit(entry: FileSystemEntry): Promise<void> {
    if (entry.isFile) {
      files.push(await new Promise<File>((resolve, reject) => (entry as FileSystemFileEntry).file(resolve, reject)));
      return;
    }
    const reader = (entry as FileSystemDirectoryEntry).createReader();
    for (;;) {
      const children = await new Promise<FileSystemEntry[]>((resolve, reject) => reader.readEntries(resolve, reject));
      if (!children.length) break;
      for (const child of children) await visit(child);
    }
  }
  for (const entry of entries) await visit(entry);
  return files;
}

/// I titoli della nota che un link nomina, risolta dalla nota corrente come la
/// risolverebbe il link; `page` vuota è la nota stessa.
export async function noteHeadings(page: string): Promise<{ text: string; level: number }[]> {
  const from = slashContextDoc();
  const doc = page.trim() === ""
    ? from
    : (await resolvedReference({ kind: "wiki", value: { page, heading: null, block: null } }, from ?? undefined))?.doc;
  if (!doc) return [];
  return (await documentOutline(doc)).map(({ text, level }) => ({ text, level }));
}

/// I blocchi con un id della nota che `page` nomina: dal testo della sessione
/// aperta, che ha anche gli id non ancora salvati, o dal file.
export async function noteBlocks(page: string): Promise<BlockOption[]> {
  const from = slashContextDoc();
  const doc = page.trim() === ""
    ? from
    : (await resolvedReference({ kind: "wiki", value: { page, heading: null, block: null } }, from ?? undefined))?.doc;
  if (!doc || !doc.toLowerCase().endsWith(".md")) return [];
  return blockIds(documentSessions.text(doc) ?? (await api.readDocument(doc)).text);
}

/// I titoli del vault che contengono `text`: le note che la ricerca trova per
/// quelle parole, e di ciascuna i titoli che le contengono davvero. Una finestra
/// di note, non il vault intero: si chiede a ogni battuta.
const HEADING_NOTES = 20;
export async function vaultHeadings(text: string): Promise<{ doc: string; text: string; level: number }[]> {
  const wanted = text.trim().toLocaleLowerCase();
  if (wanted === "") return [];
  const found = await matchingDocuments(searchExpression(text), { offset: 0, limit: HEADING_NOTES }, "omit");
  const outlines = await Promise.all(found.items.map(async ({ doc }) =>
    (await documentOutline(doc).catch(() => []))
      .filter((heading) => heading.text.toLocaleLowerCase().includes(wanted))
      .map(({ text: title, level }) => ({ doc, text: title, level }))));
  return outlines.flat();
}
