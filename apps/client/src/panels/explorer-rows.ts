// L'esploratore: le righe di note, file e cartelle, e i loro menu.
import { dismissSidePanel, revealSidePanel } from "../ui/side-panels";
import { pickFromList, promptText } from "../ui/dialogs";
import { vaultFolders, folderContent, WITHOUT_PAGE } from "../host/query";
import { pageIcon } from "../state/page-icons";
import { type VaultFolder } from "../host/contract";
import { saveExpanded, state } from "../state/store";
import { createFolder, handToSystem, openVaultRoot } from "../state/vault";
import {
  childName,
  folderNoteIn,
  folderNoteOf,
  pageName,
  parentOf,
  EXPLORER_SORTS,
  sortContent,
} from "../rules/organizer";
import { FORMAT_ICON, formatKindOf } from "../ui/format-kind";
import { iconEl } from "../ui/icons";
import {
  closeContextMenu,
  showContextMenu,
  type ContextMenuOptions,
  type MenuItem,
} from "../ui/menu";
import { drawPageMark, pageMarkText, readPageMark } from "../ui/page-mark";
import { selectInspectorTab, visibleRect } from "../ui/views";
import { type SurfaceDropDocument, type SurfaceDropOffer } from "../editors/core/registry";
import {
  newEntries,
  canImportDrawing,
  canImportFile,
  hasKernelCommand,
  importDrawing,
  launchCommand,
  pickDrawingImport,
  allCommands,
  displayBinding,
} from "../ui/commands";
import { VAULT_EXPORT } from "../ui/vault-export";
import { openWithEntry } from "./open-with";
import { IMPORT_PREPARE } from "../ui/note-import";
import {
  canShowFile,
  copyNoteLinks,
  openDocument,
  openDocumentBeside,
  presentBookExport,
} from "../state/document-controller";
import { newNoteInActiveSpace } from "../state/new-note";
import { openCurrentInNewWindow } from "../state/document-windows";
import { contextMenuItems, hasContextMenuViews, type ContextTarget } from "../ui/context-views";
import { trashWithConfirm } from "./trash";
import { errorText } from "../host/errors";
import { t } from "../i18n/strings";
import { notify } from "../ui/notify";
import { setTooltip } from "../ui/tooltip";
import { mediaKindOfId } from "../editors/media/media-types";
import type { ResourceKind } from "../host/contract";
import {
  applyReorder,
  entry,
  fileListEl,
  legacyPages,
  newNoteEl,
  pinnedListEl,
  refreshFromKernel,
  selection,
  spaceTitleEl,
  startRename,
  toggleFolder,
  view,
  wireDrag,
  wireWarmup,
} from "./explorer";
import {
  bookmarkEntry,
  convertToFolder,
  copied,
  copyEntries,
  copyPath,
  duplicateEntry,
  folderPageAction,
  moveFolderInto,
  newNote,
  pasteEntries,
  pickedOr,
  renameFolderRow,
  searchInFolder,
  trashFolderWithConfirm,
} from "./explorer-entries";
import {
  SORT_LABELS,
  addSpace,
  chooseIcon,
  collapseAll,
  expandAll,
  setSort,
  togglePin,
} from "./explorer-spaces";
import { moveNotesInto, pickImport } from "./explorer-drag";

/// Le note Markdown che il cassetto mostra adesso, come bersagli per un
/// blocco della nota `document`: soltanto se è del vault aperto (FUB-001),
/// perché un blocco va in una nota del suo vault. Le appuntate e l'albero
/// sono due righe della stessa nota: vale quella che si vede.
export function noteOffers(document: SurfaceDropDocument): SurfaceDropOffer[] {
  if (document.vault !== undefined && document.vault !== openVaultRoot()) return [];
  const out: SurfaceDropOffer[] = [];
  const rows = [...pinnedListEl.querySelectorAll<HTMLElement>(".tree-row.note[data-path]"), ...fileListEl.querySelectorAll<HTMLElement>(".tree-row.note[data-path]")];
  for (const row of rows) {
    const id = row.dataset.path!;
    if (formatKindOf(id) !== "note" || !/\.(md|markdown)$/i.test(id)) continue;
    const rect = visibleRect(row);
    if (!rect) continue;
    out.push({
      kind: "note",
      document: { documentId: id, vault: document.vault },
      title: pageName(id),
      rect,
      hover: (on) => {
        if (on) row.dataset.dropHot = "true";
        else delete row.dataset.dropHot;
      },
    });
  }
  return out;
}

/// La riga di una nota, usata sia nell'albero sia tra le appuntate (dove il
/// drag non ha senso: l'ordine delle appuntate è l'ordine in cui si appunta).
export function noteRow(id: string, opts: { draggable: boolean }): HTMLElement {
  const row = document.createElement("div");
  row.className = "tree-row note";
  row.dataset.path = id;
  setTooltip(row, id);
  // L'icona data dall'esplora vince; altrimenti quella della pagina (`icon:`).
  // Un `fub:` che questa versione non sa disegnare vale come nessuna icona.
  const icon = [state.meta.icons[id], pageIcon(id)].find((value) => readPageMark(value) !== null) ?? null;
  const kind = formatKindOf(id);
  if (icon) {
    row.appendChild(rowIcon(icon));
    // L'icona scelta vince anche sulla miniatura.
    row.dataset.ownIcon = "";
  }
  // Un documento che non è una nota dice il suo formato: un Word, un ODT e
  // una nota non hanno la stessa icona, perché non si fanno le stesse cose.
  else if (kind && kind !== "note") row.appendChild(rowIcon(null, FORMAT_ICON[kind]));
  // Senza icona la colonna resta (dal CSS, senza un nodo in più per riga): i
  // nomi si allineano con quelli che un'icona ce l'hanno.
  else row.classList.add("no-icon");
  if (opts.draggable) row.classList.add("leaf");
  const name = document.createElement("span");
  name.className = "row-name";
  name.textContent = pageName(id);
  row.appendChild(name);

  row.addEventListener("click", () => openChosen(id));
  row.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    noteMenu(e, row, id);
  });
  wireWarmup(row, id);
  if (opts.draggable) wireDrag(row, id, "note");
  return row;
}

/// Apre il documento scelto nell'albero. Se l'albero è un cassetto sopra i
/// fogli, la scelta lo chiude subito: il documento si apre dove si vede, e il
/// fuoco va a lui e non al foglio coperto dal velo (`desktop-shell.ts`).
function openChosen(id: string): void {
  dismissSidePanel("sidebar");
  void openDocument(id, { gesture: true });
}

const FILE_ICONS: Record<ResourceKind, string> = {
  image: "🖼️",
  audio: "🎵",
  video: "🎬",
  pdf: "📕",
  other: "📎",
};

/// La riga di un file che non è una nota: c'è sul disco, quindi c'è
/// nell'albero. L'icona dice che specie di media sembra; se si apre lo decide
/// il registro delle superfici, che sa quale vista mostra quei byte. Per il
/// resto la shell lo dice, invece di tentarne la lettura come testo.
export function fileRow(id: string): HTMLElement {
  const row = document.createElement("div");
  row.className = "tree-row file leaf";
  row.dataset.path = id;
  setTooltip(row, id);
  const kind = mediaKindOfId(id);
  // Un SVG è anche un disegno, e si apre nel suo editor; un RAW è una foto.
  const format = formatKindOf(id);
  row.appendChild(format === "drawing" || format === "photo" ? rowIcon(null, FORMAT_ICON[format]) : rowIcon(FILE_ICONS[kind]));
  const name = document.createElement("span");
  name.className = "row-name";
  name.textContent = childName(id);
  row.appendChild(name);
  wireDrag(row, id, "note", false);
  // Un file di Excalidraw o di draw.io che Fub non mostra si apre
  // importandolo: la finestra lo prepara, e niente si scrive prima di
  // «Importa».
  row.addEventListener("click", () => {
    if (canShowFile(id)) openChosen(id);
    else if (!(canImportFile(id) && importDrawing({ kind: "vault", path: id }))) notify(t("explorer.no_viewer", { name: childName(id) }), "info");
  });
  row.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    fileMenu(e, row, id);
  });
  wireWarmup(row, id);
  return row;
}

/// Il tasto destro su una voce scelta insieme ad altre: il menu del gruppo,
/// che agisce su tutte, invece di quello di una voce sola. `false` se la voce
/// non è in una scelta di almeno due.
function selectionMenu(at: MouseEvent, id: string): boolean {
  const menu = selection?.menuFor(id);
  if (!menu) return false;
  const count = selection?.paths().length ?? 0;
  showContextMenu(at, menu.items, {
    header: { icon: "collection", kind: t("explorer.menu.many", { count: String(count) }) },
    searchable: menu.searchable,
  });
  return true;
}

/// Apre un contestuale con le voci della shell e, se ci sono view sulla
/// superficie `context_menu`, in coda le loro. Senza view non c'è niente da
/// aspettare e il menu compare subito, com'era. Ciò che cancella resta in
/// fondo anche dopo le voci dei plugin.
function showMenuFor(at: MouseEvent, items: MenuItem[], target: ContextTarget, options: ContextMenuOptions = {}): void {
  if (!hasContextMenuViews()) {
    showContextMenu(at, items, options);
    return;
  }
  void contextMenuItems(target).then((extra) => {
    const danger = items.findIndex((item) => item.danger);
    const head = danger < 0 ? items : items.slice(0, danger);
    const tail = danger < 0 ? [] : items.slice(danger);
    showContextMenu(at, [...head, ...extra.map((item, i) => (i === 0 ? { ...item, separator: true } : item)), ...tail], options);
  });
}

/// I gesti di «Copia ▸» di una voce dell'albero: il link, il percorso e il
/// file stesso, che l'albero incolla altrove.
function copyItems(id: string, file = t("explorer.copy.file")): MenuItem {
  return {
    label: t("explorer.copy.menu"),
    items: [
      { label: t("explorer.copy.link"), run: () => void copyNoteLinks(pickedOr(id)) },
      { label: t("explorer.copy.path"), run: () => void copyPath(id) },
      { label: file, hint: displayBinding("Mod-c"), run: () => copyEntries(pickedOr(id)) },
    ],
  };
}

/// «Sposta prima» e «Sposta dopo» fra le sorelle: soltanto con l'ordine a
/// mano, perché con un altro ordine lo spostamento non si vedrebbe.
function reorderItems(id: string): MenuItem[] {
  return state.explorerSort === "manual" ? reorderActions(id) : [];
}

/// Le voci del contestuale di una **nota**, dalla stessa strada del click
/// destro e del tasto Menu/Shift+F10: un punto solo, o le due strade
/// divergono alla prima voce aggiunta.
function noteMenu(at: MouseEvent, row: HTMLElement, id: string): void {
  if (selectionMenu(at, id)) return;
  const pinned = state.meta.pinned.includes(id);
  const reorder = reorderItems(id);
  showMenuFor(at, [
    { label: t("explorer.open_beside"), run: () => void openDocumentBeside(id, "row") },
    { label: t("explorer.open_window"), run: () => void openCurrentInNewWindow(id) },
    { separator: true, label: t("explorer.rename"), hint: "F2", run: () => renameEntry(id, row) },
    { label: t("explorer.move"), run: () => void pickMoveFolder(id) },
    { label: t("explorer.duplicate"), run: () => void duplicateEntry(id) },
    { ...copyItems(id), separator: true },
    { label: t("explorer.pin_state"), choice: "checkbox", checked: pinned, run: () => togglePin(id) },
    {
      label: t("explorer.organize"),
      items: [
        { label: t("explorer.icon"), run: () => chooseIcon(at, id) },
        { label: t("explorer.bookmark"), run: () => void bookmarkEntry({ k: "doc", doc: id }, id) },
        { label: t("explorer.to_folder"), run: () => void convertToFolder(id) },
        ...folderPageAction(id),
        ...reorder,
        { separator: true, label: t("explorer.reveal_system"), run: () => void handToSystem(id, false) },
        openWithEntry(id, { system: () => void handToSystem(id, true) }),
      ],
    },
    { separator: true, label: t("explorer.trash"), hint: displayBinding("Delete"), danger: true, run: () => void trashWithConfirm(id) },
  ], { kind: "note", id }, { header: { icon: "notes", kind: t("explorer.menu.note"), name: pageName(id) } });
}

/// Le voci del contestuale di un **allegato**: un file che non è una nota. Si
/// rinomina (l'estensione resta) e si cestina come una nota: il kernel li
/// tratta allo stesso modo, e il cestino li ripristina uguali. Uno che si
/// importa in un disegno lo offre per primo, anche quando Fub lo mostra, come
/// l'SVG o il PNG che draw.io esporta col disegno dentro.
function fileMenu(at: MouseEvent, row: HTMLElement, id: string): void {
  if (selectionMenu(at, id)) return;
  const shown = canShowFile(id);
  showMenuFor(at, [
    ...(canImportFile(id) ? [{ label: t("explorer.import_drawing"), run: () => void importDrawing({ kind: "vault", path: id }) }] : []),
    ...(shown
      ? [
          { label: t("explorer.open"), run: () => openChosen(id) },
          { label: t("explorer.open_beside"), run: () => void openDocumentBeside(id, "row") },
        ]
      : []),
    openWithEntry(id, { system: () => void handToSystem(id, true) }),
    { separator: true, label: t("explorer.rename"), hint: "F2", run: () => renameEntry(id, row) },
    { label: t("explorer.move"), run: () => void pickMoveFolder(id) },
    copyItems(id, t("explorer.copy.file_short")),
    ...(shown ? [{ separator: true, label: t("explorer.used_by"), run: () => void showUsers(id) }] : []),
    { separator: true, label: t("explorer.trash"), hint: displayBinding("Delete"), danger: true, run: () => void trashWithConfirm(id) },
  ], { kind: "file", id }, { header: { icon: "fmt-image", kind: t("explorer.menu.file"), name: childName(id) } });
}

/// «Mostra le note che lo usano»: apre il file e, accanto, il pannello dei
/// collegamenti, che elenca chi lo richiama.
async function showUsers(id: string): Promise<void> {
  await openDocument(id);
  revealSidePanel("inspector");
  if (!selectInspectorTab("backlinks")) notify(t("explorer.used_by_missing"), "info");
}

// Returns actions only when another sibling of the same kind is visible.
function reorderActions(id: string): Array<{ label: string; run: () => void }> {
  const row = entry(id);
  if (!row) return [];
  const siblings = reorderSiblings(row);
  const index = siblings.indexOf(row);
  return [
    ...(index > 0 ? [{ label: t("bookmarks.move_up"), run: () => reorderAdjacent(row, -1) }] : []),
    ...(index < siblings.length - 1 ? [{ label: t("bookmarks.move_down"), run: () => reorderAdjacent(row, 1) }] : []),
  ];
}

function reorderSiblings(row: HTMLElement): HTMLElement[] {
  const kind = row.querySelector(":scope > .tree-row.folder") ? "folder" : "note";
  return [...(row.parentElement?.children ?? [])]
    .filter((node): node is HTMLElement => node instanceof HTMLElement
      && node.getAttribute("role") === "treeitem"
      && !!node.querySelector(`:scope > .tree-row.${kind}`));
}

export function reorderAdjacent(row: HTMLElement, delta: -1 | 1): void {
  const siblings = reorderSiblings(row);
  const at = siblings.indexOf(row);
  const other = siblings[at + delta];
  const source = row.dataset.path;
  const target = other?.dataset.path;
  if (!source || !target) return;
  applyReorder(parentOf(source), childName(source), childName(target), delta < 0);
}

/// La riga di una voce che si rinomina e si cestina da qui: una nota o un
/// allegato. Una cartella ha le sue voci nel proprio contestuale.
export function entryRow(id: string): HTMLElement | null {
  const row = entry(id)?.querySelector<HTMLElement>(":scope > .tree-row");
  return row && !row.classList.contains("folder") ? row : null;
}

/// La riga di una cartella dell'albero, se `path` ne è una a schermo.
export function folderRowOf(path: string): HTMLElement | null {
  const row = entry(path)?.querySelector<HTMLElement>(":scope > .tree-row");
  return row?.classList.contains("folder") ? row : null;
}

export function treeFocused(): boolean {
  const focused = document.activeElement;
  return focused instanceof HTMLElement && fileListEl.contains(focused);
}

/// La voce su cui agiscono i comandi di rinomina e cestino: quella col fuoco,
/// se il fuoco è nell'albero, altrimenti la nota attiva. Il fuoco su una
/// cartella non ricade sulla nota attiva: agire su una voce diversa da quella
/// che si guarda è la sorpresa da evitare.
export function explorerTarget(): string | null {
  if (treeFocused()) {
    const li = (document.activeElement as HTMLElement).closest<HTMLElement>('li[role="treeitem"]');
    const path = li?.dataset.path;
    if (li && path) return entryRow(path) ? path : null;
  }
  return state.currentDoc;
}

/// Apre il campo del nome sulla riga della voce. Una strada sola per F2, per il
/// contestuale e per `shell.explorer.rename`: `false` se la riga non c'è. Il
/// contestuale passa la riga su cui si è aperto, che fra le appuntate non è
/// quella dell'albero.
export function renameEntry(id: string, row: HTMLElement | null = entryRow(id)): boolean {
  if (!row) return false;
  startRename(row, id);
  return true;
}

/// Destinazione dello spostamento senza drag (U10): le cartelle del vault in
/// una finestra (stesso limite dell'albero), più la radice e il conto di ciò
/// che resta fuori.
async function pickMoveFolder(id: string): Promise<void> {
  await pickMoveFolders([id]);
}

/// Lo stesso selettore per più note insieme (la scelta multipla dell'albero):
/// le cartelle escluse sono quelle che non portano da nessuna parte per **tutte**
/// le note (la casa comune, le note stesse), e lo spostamento va in fila — un
/// rifiuto di una non ferma le altre, e `moveNotesInto` le dice tutte.
/// `false` se non si è spostato niente perché chi sceglie ha annullato.
export async function pickMoveFolders(ids: readonly string[]): Promise<boolean> {
  if (ids.length === 0) return false;
  // Un selettore con filtro e non un menu contestuale: le cartelle di un vault
  // vero sono centinaia, e un menu senza posizione né scorrimento non le regge.
  const folders = await vaultFolders(FOLDER_PICK);
  const homes = new Set(ids.map(parentOf));
  const here = homes.size === 1 ? [...homes][0]! : null;
  const other = Math.max(0, folders.total - folders.items.length);
  const choice = await pickFromList<string>({
    title:
      ids.length === 1
        ? t("explorer.move_title", { name: childName(ids[0]!) })
        : t("explorer.move_many_title", { n: String(ids.length) }),
    placeholder: t("explorer.move_filter"),
    items: [
      // La radice (del vault) come prima destinazione: è dove il drag porta
      // trascinando sul titolo "Note".
      ...(here !== "" ? [{ label: t("explorer.root"), value: "" }] : []),
      ...folders.items
        .filter((f) => f.path !== here && !ids.some((id) => f.path === id || f.path.startsWith(`${id}/`)))
        .map((f) => ({ label: namedFolder(f.path), detail: f.path, value: f.path })),
    ],
    more: other,
  });
  if (choice === null) return false;
  const notes: string[] = [];
  for (const id of ids) {
    if (folderRowOf(id)) await moveFolderInto(id, choice);
    else notes.push(id);
  }
  await moveNotesInto(notes, choice);
  return true;
}

/// «In una cartella nuova»: la cartella nasce nella casa comune delle note
/// scelte (la radice visibile, se ne hanno più d'una), e il dialogo dice dove
/// prima che si scriva il nome. Le note ci entrano con lo stesso spostamento
/// del menu. Se la cartella non nasce, nessuna si muove: `false`, come per un
/// dialogo annullato, e la scelta torna.
export async function groupIntoNewFolder(ids: readonly string[]): Promise<boolean> {
  if (ids.length === 0) return false;
  const homes = new Set(ids.map(parentOf));
  const parent = homes.size === 1 ? [...homes][0]! : (state.activeSpace ?? "");
  const name = (await promptText({
    title: t("explorer.selection.group"),
    label: parent ? t("explorer.selection.group_where", { folder: parent }) : t("explorer.selection.group_where_root"),
  }))?.trim();
  if (!name) return false;
  const wanted = parent ? `${parent}/${name}` : name;
  let made: string;
  try {
    // Il percorso che il kernel ha creato davvero (normalizzato): le note
    // vanno lì, non nella stringa chiesta.
    made = await createFolder(wanted);
  } catch (e) {
    notify(t("explorer.new_folder_failed", { folder: wanted, reason: errorText(e) }), "guasto");
    return false;
  }
  for (const folder of [parent, made]) if (folder) state.expanded.add(folder);
  saveExpanded();
  await moveNotesInto(ids, made);
  await refreshFromKernel(true);
  return true;
}

/// Quante cartelle chiede il selettore di destinazione: più di un livello
/// dell'albero, perché qui si filtrano.
const FOLDER_PICK = { offset: 0, limit: 2000 };

/// Il contestuale della voce dell'albero a fuoco, per tastiera: apre il menu
/// della nota o della cartella sotto il `treeitem`, alla sua posizione.
export function openRowMenu(li: HTMLElement): void {
  const row = li.querySelector<HTMLElement>(":scope > .tree-row");
  const path = li.dataset.path;
  if (!row || !path) return;
  const box = row.getBoundingClientRect();
  const at = new MouseEvent("contextmenu", {
    clientX: box.left + 24,
    clientY: box.top + box.height / 2,
    bubbles: true,
    cancelable: true,
  });
  rowMenuAt(at, li);
}

/// Il contestuale della voce `li` aperto in `at`: lo chiede alla sua riga,
/// così cartella, nota e allegato aprono il menu del clic destro e non uno
/// scelto qui. L'evento non risale: l'albero non lo riceve una seconda volta.
export function rowMenuAt(at: MouseEvent, li: HTMLElement): void {
  const row = li.querySelector<HTMLElement>(":scope > .tree-row");
  if (!row || !li.dataset.path) return;
  row.dispatchEvent(new MouseEvent("contextmenu", {
    clientX: at.clientX,
    clientY: at.clientY,
    bubbles: false,
    cancelable: true,
  }));
}

/// Una cartella senza niente dentro: né sottocartelle né file, di nessuna
/// specie. I due conti arrivano dal kernel col resto della riga (§14.3), quindi
/// saperlo non costa una domanda in più.
export function empty(folder: VaultFolder): boolean {
  return folder.folders === 0 && folder.entries === 0;
}

/// La riga di una cartella: freccia per aprire/chiudere, click che apre la
/// folder note se c'è (altrimenti apre/chiude, come la freccia).
export function folderRow(folder: VaultFolder): HTMLElement {
  const row = document.createElement("div");
  row.className = "tree-row folder";
  setTooltip(row, folder.path);

  // Espansore separato dall'apertura (U09): un bottone nativo, quindi tabbabile
  // e attivabile da tastiera senza passare dall'albero. La riga resta
  // cliccabile intera: chi apre la folder note non deve centrare la freccia.
  const chevron = document.createElement("button");
  chevron.type = "button";
  chevron.className = "chevron";
  // Fuori dal giro del tab e dall'albero accessibile: da tastiera le frecce
  // aprono e chiudono il `treeitem`, e un bottone dentro una voce d'albero è un
  // interattivo annidato (e una fermata di tab per cartella).
  chevron.tabIndex = -1;
  chevron.setAttribute("aria-hidden", "true");
  // Niente freccia su una cartella vuota: lo spazio resta (l'allineamento dei
  // fratelli è lo stesso), ma non si promette un contenuto che non c'è —
  // e il bottone disabilitato resta fuori dal tab.
  if (empty(folder)) {
    chevron.disabled = true;
    chevron.setAttribute("aria-label", childName(folder.path));
  } else {
    const open = state.expanded.has(folder.path);
    chevron.textContent = open ? "▾" : "▸";
    chevron.setAttribute("aria-label", childName(folder.path));
    chevron.setAttribute("aria-expanded", String(open));
    chevron.addEventListener("click", (e) => {
      e.stopPropagation();
      toggleFolder(folder.path);
    });
  }
  row.appendChild(chevron);

  // La folder note di una cartella **non aperta** non si sa guardandoci dentro
  // — guardarci dentro è il giro che questa voce toglie. Si sa perché il
  // kernel ha già detto quali, fra i path che potrebbero esserlo, esistono.
  const folderNoteId = folderNoteIn(folder.path, state.handledExtensions, view.existing, legacyPages);
  // L'icona della cartella è quella della sua pagina, se l'esplora non gliene
  // ha data una sua.
  const pageMark = folderNoteId ? pageIcon(folderNoteId) : null;
  const chosen = [state.meta.icons[folder.path], pageMark].find((value) => readPageMark(value) !== null) ?? null;
  row.appendChild(rowIcon(chosen, "folder"));

  const name = document.createElement("span");
  name.className = "row-name";
  name.textContent = childName(folder.path);
  row.appendChild(name);
  // Quante voci dirette ha: fuori dal nome accessibile (lo dà `.row-name`), e
  // lo zero non si scrive.
  if (folder.entries > 0) {
    const count = document.createElement("span");
    count.className = "row-count";
    count.setAttribute("aria-hidden", "true");
    count.textContent = String(folder.entries);
    row.appendChild(count);
  }
  if (folderNoteId) row.classList.add("has-note");
  row.addEventListener("click", () => {
    if (folderNoteId) {
      void openDocument(folderNoteId);
      if (!state.expanded.has(folder.path) && !empty(folder)) toggleFolder(folder.path);
    } else if (!empty(folder)) {
      toggleFolder(folder.path);
    }
  });
  row.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    folderMenu(e, folder.path);
  });
  wireDrag(row, folder.path, "folder");
  return row;
}

/// L'accordo di un comando della palette, scritto come si preme.
function chordOf(id: string): string | undefined {
  return displayBinding(allCommands().find((entry) => entry.id === id)?.binding ?? null) || undefined;
}

/// «Importa ▸» in `folder`: i file, una cartella, le note di un'altra app e un
/// disegno, ognuno se il kernel lo sa fare.
function importItems(folder: string): MenuItem {
  return {
    label: t("explorer.import"),
    items: [
      { label: t("explorer.import.files"), run: () => pickImport(folder, false) },
      { label: t("explorer.import.folder"), run: () => pickImport(folder, true) },
      ...(hasKernelCommand(IMPORT_PREPARE)
        ? [{ label: t("explorer.import.notes"), run: () => void launchCommand(IMPORT_PREPARE, { folder }) }]
        : []),
      ...(canImportDrawing() ? [{ label: t("explorer.import.drawing"), run: () => void pickDrawingImport(folder) }] : []),
    ],
  };
}

/// Le voci del contestuale di una **cartella**: stesse voci del click destro e
/// del tasto Menu, un punto solo.
function folderMenu(at: MouseEvent, path: string): void {
  const reorder = reorderItems(path);
  const pasting = copied.length > 0 && copied[0]!.vault === openVaultRoot();
  showMenuFor(
    at,
    [
      { label: t("explorer.new_note_here"), hint: chordOf("shell.note.new"), run: () => void newNote(path) },
      {
        label: t("explorer.new_menu"),
        // L'elenco del «+» (S34), con la cartella dove il file nasce già scelta.
        items: newEntries(path),
      },
      importItems(path),
      { separator: true, label: t("explorer.rename"), hint: "F2", run: () => void renameFolderRow(path) },
      { label: t("explorer.move"), run: () => void pickMoveFolders([path]) },
      { label: t("explorer.search_in_folder"), run: () => searchInFolder(path) },
      { label: t("pane.export_pdf"), run: () => void exportFolderPdf(path) },
      {
        separator: true,
        label: t("explorer.organize"),
        items: [
          { label: t("explorer.icon"), run: () => chooseIcon(at, path) },
          { label: t("explorer.as_space"), run: () => addSpace(path) },
          { label: t("explorer.bookmark"), run: () => void bookmarkEntry({ k: "folder", path }, path) },
          ...reorder,
          { separator: true, label: t("explorer.copy_path"), run: () => void copyPath(path) },
          ...(hasKernelCommand(VAULT_EXPORT)
            ? [{ label: t("explorer.export_folder"), run: () => void launchCommand(VAULT_EXPORT, { folder: path }) }]
            : []),
          { label: t("explorer.reveal_system"), run: () => void handToSystem(path, false) },
        ],
      },
      { separator: true, label: t("explorer.trash"), hint: displayBinding("Delete"), danger: true, run: () => void trashFolderWithConfirm(path) },
    ],
    { kind: "folder", id: path },
    {
      header: { icon: "folder", kind: t("explorer.menu.folder"), name: childName(path) },
      // I file copiati nell'albero si incollano qui: l'unico gesto degli
      // appunti, quindi una voce in cima.
      ...(pasting ? { clipboard: [{ label: t("explorer.paste"), icon: "template", hint: displayBinding("Mod-v"), run: () => void pasteEntries(path) }] } : {}),
    },
  );
}

/// Le note di una cartella nell'ordine dell'albero, a ogni profondità: la
/// pagina della cartella per prima, poi le sottocartelle (ognuna con le sue
/// note), poi le note, come l'albero le mostra con l'ordine scelto. Si
/// chiedono tutte, anche quelle delle cartelle chiuse.
async function notesInTreeOrder(path: string): Promise<string[]> {
  const content = await folderContent(path, WITHOUT_PAGE);
  const node = sortContent({ path, ...content }, state.meta, state.explorerSort);
  const page = folderNoteOf(node, state.handledExtensions, legacyPages);
  const out: string[] = page ? [page] : [];
  for (const sub of node.folders) out.push(...(await notesInTreeOrder(sub.path)));
  for (const id of node.notes) if (id !== page) out.push(id);
  return out;
}

/// «Esporta in PDF…» su una cartella (T78): le sue note in un PDF solo, ogni
/// nota un capitolo.
async function exportFolderPdf(path: string): Promise<void> {
  try {
    await presentBookExport(await notesInTreeOrder(path), path === "" ? t("explorer.root") : childName(path));
  } catch (error) {
    notify(t("pdf_export.failed", { reason: errorText(error) }), "guasto");
  }
}

/// Il menu «Nuovo» del «+» del titolo, sotto il pulsante: i tipi che si possono
/// creare adesso, nello spazio attivo. Il fuoco parte dal «+», così Esc ci
/// torna anche dopo un clic del mouse (che su WebKit non lo dà al pulsante).
export function openNewMenu(pointer: boolean): void {
  newNoteEl.focus({ preventScroll: true });
  newNoteEl.setAttribute("aria-expanded", "true");
  showContextMenu(newNoteEl, newEntries(), {
    label: t("explorer.new_menu"),
    pointer,
    onClose: () => newNoteEl.setAttribute("aria-expanded", "false"),
  });
}

/// Apre il menu di un pulsante del titolo, o lo chiude se è già aperto. Il
/// pulsante dice «true» soltanto finché il suo menu è aperto (`onClose` lo
/// rimette a «false»): senza questa domanda il secondo clic riaprirebbe il
/// menu, e la chiusura del primo lascerebbe il pulsante a «false» col menu
/// aperto.
export function toggleButtonMenu(button: HTMLElement, open: () => void): void {
  if (button.getAttribute("aria-expanded") === "true") {
    closeContextMenu();
    button.setAttribute("aria-expanded", "false");
    return;
  }
  open();
}

/// Il contestuale del titolo del pannello e dello spazio vuoto sotto l'ultima
/// riga: crea e importa nella radice di ciò che si vede (il vault o lo spazio
/// attivo), e ordina l'albero.
export function rootMenu(at: MouseEvent): void {
  const root = state.activeSpace ?? "";
  showContextMenu(at, [
    { label: t("explorer.new_note"), hint: chordOf("shell.note.new"), run: () => void newNoteInActiveSpace() },
    { label: t("explorer.new_menu"), items: newEntries() },
    { separator: true, label: t("explorer.sort"), items: sortItems() },
    { label: t("explorer.collapse_all"), run: () => collapseAll() },
    { separator: true, ...importItems(root) },
  ], {
    header: { icon: "folder", kind: spaceTitleEl.textContent?.trim() || t("explorer.menu.folder") },
    searchable: [{ label: t("explorer.expand_all"), run: () => void expandAll() }],
  });
}

/// Gli ordini dell'albero, a scelta singola: li apre il bottone del titolo e
/// il sottomenu «Ordina» del contestuale della radice.
export function sortItems(): MenuItem[] {
  return EXPLORER_SORTS.map((mode) => ({
    label: t(SORT_LABELS[mode]),
    choice: "radio" as const,
    checked: state.explorerSort === mode,
    run: () => setSort(mode),
  }));
}

/// L'icona di una riga: quella scelta da chi scrive (un'emoji com'è, o una
/// figura del set: `page-mark.ts`), o senza una scelta — o con una figura che
/// questa versione non conosce — la figura a linea del kit (`line`).
export function rowIcon(icon: string | null, line?: string): HTMLElement {
  const span = document.createElement("span");
  span.className = "row-icon";
  if (!drawPageMark(span, icon) && line) span.append(iconEl(line) ?? "");
  span.setAttribute("aria-hidden", "true");
  return span;
}

/// Il nome di una cartella preceduto dall'icona che chi scrive le ha dato, se
/// è un'emoji: nei menu e nei titoli una figura (scelta o di ripiego) è
/// rumore, e nel testo non si scrive.
export function namedFolder(path: string, name = childName(path)): string {
  const icon = pageMarkText(state.meta.icons[path]);
  return icon ? `${icon} ${name}` : name;
}
