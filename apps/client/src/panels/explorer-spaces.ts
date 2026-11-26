// L'esploratore: le note fissate, gli spazi, l'ordinamento e il comprimere o espandere tutto.
import { vaultFolders } from "../host/query";
import { setIcon, setPinned, setSpace } from "../state/organization";
import { saveActiveSpace, saveExpanded, saveExplorerSort, state } from "../state/store";
import { LEVEL_PAGE, childName, folderNoteOf, type ExplorerSort } from "../rules/organizer";
import { iconEl } from "../ui/icons";
import { pickIcon, showContextMenu } from "../ui/menu";
import { drawPageMark } from "../ui/page-mark";
import { openDocument } from "../state/document-controller";
import { plural, t } from "../i18n/strings";
import { setTooltip } from "../ui/tooltip";
import {
  allCountEl,
  allTitleEl,
  children,
  filter,
  legacyPages,
  pinnedListEl,
  pinnedTitleEl,
  refreshFromKernel,
  spaceStripEl,
  spaceTitleEl,
  types,
  view,
} from "./explorer";
import { namedFolder, noteRow, rowIcon } from "./explorer-rows";

// --- appuntate, icone, spazi ------------------------------------------------

/// Le appuntate che esistono ancora.
///
/// Quali esistano lo dice il kernel — sono nella stessa domanda delle folder
/// note (§14.4) — e non un elenco del vault da cui pescarle: un'appuntata è un
/// path scritto nel sidecar, e verificarne cinque non è una ragione per
/// chiedere diecimila righe.
export function renderPinned(): void {
  const pinned = state.meta.pinned.filter((id) => view.existing.has(id));
  // U08: la sezione Appuntate si vede soltanto se contiene elementi.
  // Col filtro aperto l'elenco filtrato sta al posto di albero e appuntate.
  const hidePinned = pinned.length === 0 || filter?.active() === true;
  pinnedTitleEl.hidden = hidePinned;
  pinnedListEl.hidden = hidePinned;
  types?.render();
  pinnedListEl.innerHTML = "";
  for (const id of pinned) {
    const li = document.createElement("li");
    const row = noteRow(id, { draggable: false });
    // Fra le appuntate la colonna dell'icona la tiene la puntina: dice perché
    // la riga sta lì. L'icona della nota resta nella sua riga dell'albero.
    row.querySelector(":scope > .row-icon")?.remove();
    row.classList.remove("no-icon");
    const pin = rowIcon(null, "pin");
    pin.classList.add("row-pin");
    row.prepend(pin);
    if (id === state.currentDoc) row.setAttribute("aria-current", "true");
    li.appendChild(row);
    pinnedListEl.appendChild(li);
  }
}

/// «Tutte le note» e il conto di ciò che si vede, sopra l'albero. Col filtro
/// aperto l'elenco filtrato prende il posto dell'albero, e il titolo va con
/// lui; senza un vault (o prima della prima risposta) non c'è niente da
/// contare. Zero voci: il titolo resta, il numero no.
export function renderAllTitle(): void {
  const loaded = state.vaultRoot !== "" && view.folders.has(state.activeSpace ?? "");
  allTitleEl.hidden = !loaded || filter?.active() === true;
  const total = view.total ?? 0;
  allCountEl.hidden = total === 0;
  allCountEl.textContent = total === 0 ? "" : String(total);
}

export function togglePin(id: string): void {
  void setPinned(id, !state.meta.pinned.includes(id));
}

export function chooseIcon(at: MouseEvent, path: string): void {
  pickIcon(at, (icon) => {
    void setIcon(path, icon ?? null);
  }, { current: state.meta.icons[path] ?? null });
}

// Uno spazio è una cartella registrata nella striscia di icone in cima alla
// sidebar (stile make.md): selezionarlo radica l'albero lì, e il resto del
// vault non esiste. La prima icona è "home", cioè il vault intero.

export function renderSpaceStrip(): void {
  spaceStripEl.innerHTML = "";
  // U07: striscia col nome, non solo emoji — lo spazio attivo si legge, gli
  // altri hanno nome accessibile + tooltip col percorso completo. Overflow con
  // scroll locale del contenitore (mai hit-area ridotta sotto misura).
  spaceStripEl.setAttribute("role", "toolbar");
  spaceStripEl.setAttribute("aria-label", t("explorer.notes"));

  // Gli spazi stanno in un pozzetto: l'acceso mostra anche il nome, gli altri
  // soltanto la figura (il nome resta la loro etichetta). «+» sta fuori.
  const well = document.createElement("span");
  well.className = "space-well";
  const chipName = (text: string): HTMLElement => {
    const name = document.createElement("span");
    name.className = "space-chip-name";
    name.setAttribute("aria-hidden", "true");
    name.textContent = text;
    return name;
  };

  const home = document.createElement("button");
  home.className = "space-chip";
  home.setAttribute("aria-pressed", String(state.activeSpace === null));
  home.append(iconEl("home") ?? "", chipName(t("explorer.whole_vault.short")));
  home.setAttribute("aria-label", t("explorer.whole_vault"));
  setTooltip(home, t("explorer.whole_vault"));
  home.addEventListener("click", () => selectSpace(null));
  well.appendChild(home);

  for (const path of state.meta.spaces) {
    const chip = document.createElement("button");
    chip.className = "space-chip";
    chip.setAttribute("aria-pressed", String(state.activeSpace === path));
    const icon = document.createElement("span");
    icon.className = "space-chip-icon";
    if (!drawPageMark(icon, state.meta.icons[path])) icon.append(iconEl("folder") ?? "");
    chip.append(icon, chipName(childName(path)));
    // Nome annunciato (V15): l'emoji scelta e il nome dello spazio, non solo
    // il simbolo.
    chip.setAttribute("aria-label", namedFolder(path));
    setTooltip(chip, path);
    chip.addEventListener("click", () => selectSpace(path));
    chip.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      showContextMenu(e, [
        { label: t("explorer.icon"), run: () => chooseIcon(e, path) },
        { label: t("explorer.not_a_space"), run: () => removeSpace(path) },
      ]);
    });
    well.appendChild(chip);
  }
  spaceStripEl.appendChild(well);

  const add = document.createElement("button");
  add.className = "space-chip add";
  // «+» non è uno degli spazi: apre il gesto che ne crea uno. Senza
  // `aria-pressed` non entra nel gruppo di quelli che si escludono a vicenda —
  // che è ciò che è, e ciò che va detto.
  add.textContent = "+";
  add.setAttribute("aria-label", t("explorer.new_space"));
  setTooltip(add, t("explorer.new_space"));
  add.addEventListener("click", (e) => void pickNewSpace(e));
  spaceStripEl.appendChild(add);
}

/// Il titolo del pannello: il nome dello spazio attivo (cliccarlo apre la sua
/// folder note), o "Note" a casa.
export function renderSpaceTitle(): void {
  spaceTitleEl.textContent =
    state.activeSpace === null
      ? t("explorer.notes")
      : namedFolder(state.activeSpace);
  spaceTitleEl.classList.toggle("clickable", state.activeSpace !== null);
}

/// Cambiare spazio cambia la **radice** dell'albero, quindi cambia quali
/// cartelle sono visibili: si richiede, non si ridisegna soltanto.
function selectSpace(path: string | null): void {
  state.activeSpace = path;
  saveActiveSpace();
  void refreshFromKernel(true);
}

/// Registra una cartella come spazio (se già non lo è) e la seleziona.
export function addSpace(path: string): void {
  if (!state.meta.spaces.includes(path)) void setSpace(path, true);
  selectSpace(path);
}

/// Toglie lo spazio dalla striscia. La cartella e le note restano dove sono:
/// uno spazio è solo un punto di vista, non un contenitore.
function removeSpace(path: string): void {
  if (!state.meta.spaces.includes(path)) return;
  if (state.activeSpace === path) state.activeSpace = null;
  saveActiveSpace();
  void setSpace(path, false);
}

/// Il "+" della striscia: un menu con le cartelle del vault non ancora spazi.
///
/// Le cartelle le elenca il kernel (§14.3), a ogni profondità: prima si
/// ricavavano dai path delle note, quindi una cartella vuota non compariva —
/// ed è esattamente quella che si vuole poter eleggere a spazio prima di
/// riempirla.
async function pickNewSpace(at: MouseEvent): Promise<void> {
  // Un menu contestuale con una voce per cartella del vault non è un menu: la
  // finestra è la stessa dell'albero, e le altre si dicono invece di sparire.
  const folders = await vaultFolders(LEVEL_PAGE);
  const candidate = folders.items.filter((f) => !state.meta.spaces.includes(f.path));
  if (candidate.length === 0) {
    showContextMenu(at, [{ label: t("explorer.no_folders"), run: () => {} }]);
    return;
  }
  const other = Math.max(0, folders.total - folders.items.length);
  showContextMenu(at, [
    ...candidate.map((f) => ({
      label: namedFolder(f.path, f.path),
      run: () => addSpace(f.path),
    })),
    ...(other > 0 ? [{ label: plural(other, "explorer.altre_cartelle.one", "explorer.altre_cartelle"), run: () => {} }] : []),
  ]);
}

/// Il nome dello spazio nel titolo apre la sua folder note, se esiste.
///
/// Lo spazio attivo è la **radice** dell'albero disegnato, quindi il suo
/// contenuto è già in mano: non serve chiederlo di nuovo.
export function openSpaceNote(): void {
  if (state.activeSpace === null) return;
  const node = children(state.activeSpace);
  const folderNoteId = node && folderNoteOf(node, state.handledExtensions, legacyPages);
  if (folderNoteId) void openDocument(folderNoteId);
}

// --- crea, rinomina, converti -----------------------------------------------

/// Crea una nota e la apre.

export const SORT_LABELS = {
  manual: "explorer.sort.manual",
  "name-asc": "explorer.sort.name-asc",
  "name-desc": "explorer.sort.name-desc",
  "modified-new": "explorer.sort.modified-new",
  "modified-old": "explorer.sort.modified-old",
} as const satisfies Record<ExplorerSort, string>;

/// Cambia l'ordine dell'albero e lo ridisegna: l'impronta lo include.
export function setSort(mode: ExplorerSort): void {
  if (state.explorerSort === mode) return;
  state.explorerSort = mode;
  saveExplorerSort();
  void refreshFromKernel(true);
}

/// Chiude ogni cartella aperta.
export function collapseAll(): void {
  if (state.expanded.size === 0) return;
  state.expanded.clear();
  saveExpanded();
  void refreshFromKernel(true);
}

/// Apre ogni cartella che l'albero conosce. Un livello si carica quando si
/// apre, quindi un livello nuovo porta le sue sottocartelle e ci si ferma
/// quando non ne arrivano più; il tetto difende da vault enormi.
export async function expandAll(): Promise<void> {
  for (let round = 0; round < EXPAND_ROUNDS; round += 1) {
    let added = false;
    for (const content of view.folders.values()) {
      for (const sub of content.folders) {
        if (!state.expanded.has(sub.path)) {
          state.expanded.add(sub.path);
          added = true;
        }
      }
    }
    if (!added) break;
    saveExpanded();
    await refreshFromKernel(true);
  }
}

/// Quanti livelli di profondità `expandAll` scende al massimo.
const EXPAND_ROUNDS = 12;
