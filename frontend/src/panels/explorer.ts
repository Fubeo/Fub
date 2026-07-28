// La sidebar delle note: l'albero, le appuntate, la striscia degli spazi, le
// icone, il trascinamento e la rinomina in posto.
//
// È il pannello più grosso perché è quello con più *gesti*, non con più logica:
// la logica dell'alberatura (cosa è una cartella, cosa è una folder note, che
// ordine hanno i fratelli) sta in `rules/organizer.ts`, ed è pura e provata; il
// dato sta nel sidecar (`state/organization.ts`). Qui c'è il DOM.
import { vociDelVault } from "../host/query";
import { onEvent } from "../state/kernel";
import {
  loadOrganization,
  setIcon,
  setOrder,
  setPinned,
  setSpace,
} from "../state/organization";
import { on, saveActiveSpace, saveExpanded, state } from "../state/store";
import { createNote, refreshDocuments, renameNote } from "../state/vault";
import {
  allFolders,
  buildTree,
  childName,
  findFolder,
  folderNoteOf,
  orderedNames,
  pageName,
  parentOf,
  type FolderNode,
} from "../rules/organizer";
import { $ } from "../ui/dom";
import { attivabile } from "../ui/a11y";
import { pickIcon, showContextMenu } from "../ui/menu";
import { refreshOn, registerPanel } from "../ui/panel-host";
import { focusEditor, flushPendingSave, openDocument } from "./document";
import { trashWithConfirm } from "./trash";
import { errorText } from "../host/errors";
import { onLingua, t } from "../i18n/strings";

const fileListEl = $("#file-list");
const filesTitleEl = $("#files-title");
const spaceStripEl = $("#space-strip");
const spaceTitleEl = $("#space-title");
const pinnedTitleEl = $("#pinned-title");
const pinnedListEl = $("#pinned-list");

/// Il drag in corso nella sidebar, se c'è.
let drag: { path: string; kind: "note" | "folder"; parent: string } | null = null;

export function mountExplorer(): void {
  $("#new-note").addEventListener("click", () => void newNote());
  spaceTitleEl.addEventListener("click", openSpaceNote);
  frecceNellAlbero();
  wireRootDropTarget();
  // Il titolo del pannello è **di qui** e non del testo fermo di `index.html`:
  // a casa dice «Note», dentro uno spazio dice il nome dello spazio. Un
  // `data-i18n` sopra glielo riscriverebbe a «Note» a ogni cambio di lingua,
  // cioè proprio quando l'utente non ha cambiato spazio.
  onLingua(renderSpaceTitle);
  renderSpaceTitle();

  // Una lista chiesta esplicitamente (apertura del vault, creazione, rinomina,
  // ripristino) si disegna sempre.
  on("documents", renderFileList);
  // L'organizzazione cambiata ridisegna la stessa lista: icone, pin e ordine
  // non passano dal kernel.
  on("organization", () => renderFileList(state.knownDocs));
  on("active-doc", markActive);

  // Una rinomina non è solo una lista invecchiata: l'organizzazione (icona,
  // pin, ordine) è indicizzata per path, e va riletta prima del ridisegno.
  //
  // **Traslocarla non è più affare di questa shell** (§11.3): la fa il kernel
  // dentro l'operazione che sposta l'identità, quindi vale anche per le
  // rinomine che questa finestra non ha innescato. Qui resta la rilettura —
  // e resta un'iscrizione diretta, non una riga nel `refresh` del pannello,
  // perché il router consegna gli ascoltatori generici prima dei tipizzati e un
  // ridisegno innescato dal registro partirebbe con l'organizzazione vecchia.
  onEvent("document_renamed", () => {
    void (async () => {
      await loadOrganization();
      await refreshFromKernel();
    })();
  });

  // Dentro un lotto (decisione 0011) `index_updated` NON arriva: arriva
  // `batch_ended`, una volta sola. È tutta la differenza fra una rinomina con
  // 200 backlink che costa 201 giri di `list_documents` e una che ne costa uno.
  // Nessun `visible`: l'albero si tiene aggiornato anche mentre la sidebar
  // mostra la ricerca o il cestino, perché alimenta anche ciò che si vede
  // altrove (le appuntate, la striscia degli spazi).
  registerPanel({
    id: "shell:explorer",
    title: "Note",
    placement: "left_sidebar",
    refresh: refreshOn("index_updated", "batch_ended"),
    render: refreshFromKernel,
  });
}

/// La lista dopo un evento del kernel.
///
/// Ricostruire la lista distrugge gli `<li>`: un click a cavallo del rebuild
/// (mousedown sul vecchio nodo, mouseup su quello nuovo) non produce nessun
/// `click` e all'utente sembra servire un doppio click. Gli eventi del kernel
/// arrivano a ogni salvataggio con una lista quasi sempre identica: qui si
/// ricostruisce solo se è cambiata davvero.
async function refreshFromKernel(): Promise<void> {
  // Dall'anagrafe (§14.1, §14.2) e non da `list_documents`: era l'ultimo dato
  // che questa shell chiedeva **fuori** da `IndexQuery` (§14.4), cioè l'unico
  // che un provider non avrebbe saputo chiedere. Un giro solo: la specie la
  // sceglie la domanda, non un secondo filtro qui.
  //
  // `document` e non tutte le specie: cosa succeda cliccando un allegato — e
  // quindi se abbia senso disegnarlo in questo albero — è del §14.3/§14.4, che
  // danno alla cartella un modello e alla lista un canale per-cartella. Qui è
  // cambiato **da dove arriva** l'elenco, non cosa contiene.
  const docs = (await vociDelVault("document")).items.map((e) => e.id);
  const uguale =
    docs.length === state.knownDocs.length && docs.every((d, i) => d === state.knownDocs[i]);
  if (!uguale) renderFileList(docs);
}

function renderFileList(docs: string[]): void {
  state.knownDocs = docs;
  // Uno spazio rimosso (o la cui cartella non esiste più) non può restare
  // selezionato: si torna a casa senza dire niente.
  if (state.activeSpace !== null && !state.meta.spaces.includes(state.activeSpace)) {
    state.activeSpace = null;
    saveActiveSpace();
  }
  renderSpaceStrip();
  renderSpaceTitle();
  renderPinned(docs);
  // Chi stava navigando da tastiera non deve perdere il posto: aprire una
  // cartella ridisegna **tutto** l'albero, e senza questa riga il fuoco
  // tornerebbe in cima al documento a ogni freccia destra — cioè la
  // navigazione da tastiera si romperebbe proprio nel momento in cui la si sta
  // usando.
  const attiva = document.activeElement;
  const daRimettere =
    attiva instanceof HTMLElement && fileListEl.contains(attiva) ? attiva.dataset.path : undefined;

  fileListEl.innerHTML = "";
  renderChildren(buildTree(docs, state.meta, state.activeSpace ?? ""), fileListEl);

  roving(daRimettere);
  if (daRimettere !== undefined) voce(daRimettere)?.focus();
}

/// Le voci dell'albero, nell'ordine in cui si vedono.
///
/// «Che si vedono» è gratis: una cartella chiusa non disegna i propri figli
/// (`renderChildren`), quindi ciò che è nel DOM è esattamente ciò che è a
/// schermo. Se un giorno l'albero disegnasse tutto e nascondesse col CSS,
/// questa funzione diventerebbe il posto da cui filtrare — ed è il motivo per
/// cui è una funzione e non una `querySelectorAll` ripetuta tre volte.
function vociAlbero(): HTMLElement[] {
  return Array.from(fileListEl.querySelectorAll<HTMLElement>('li[role="treeitem"]'));
}

function voce(path: string): HTMLElement | undefined {
  return vociAlbero().find((v) => v.dataset.path === path);
}

/// Accende il `tabindex` di **una** voce sola: quella che il tab troverà
/// entrando nell'albero.
///
/// L'ordine di preferenza è quello che serve a chi arriva: dove si era, poi la
/// nota aperta, poi la prima. Senza il secondo caso, entrare nell'albero
/// riporterebbe sempre in cima anche quando si sta lavorando su una nota in
/// fondo.
function roving(preferita?: string): void {
  const voci = vociAlbero();
  if (voci.length === 0) return;
  const scelta =
    (preferita !== undefined ? voci.find((v) => v.dataset.path === preferita) : undefined) ??
    voci.find((v) => v.dataset.path === state.currentDoc) ??
    voci[0]!;
  for (const v of voci) v.tabIndex = v === scelta ? 0 : -1;
}

/// Le frecce dentro l'albero (§12.4).
///
/// Sono i tasti di un elenco di file, e sono quelli che chiunque prova per
/// primo: su e giù per scorrere, destra per aprire, sinistra per chiudere o per
/// risalire, Invio per aprire la nota. L'ascoltatore è **uno**, sul contenitore
/// — le voci si ridisegnano a ogni giro, e un ascoltatore per riga sarebbe un
/// ascoltatore in più a ogni ridisegno su elementi già buttati via.
function frecceNellAlbero(): void {
  fileListEl.addEventListener("keydown", (e) => {
    const target = e.target;
    if (!(target instanceof HTMLElement)) return;
    const corrente = target.closest<HTMLElement>('li[role="treeitem"]');
    if (!corrente) return;

    const voci = vociAlbero();
    const i = voci.indexOf(corrente);
    const espansa = corrente.getAttribute("aria-expanded");
    const path = corrente.dataset.path;

    const vai = (n: HTMLElement | undefined) => {
      if (!n) return;
      for (const v of voci) v.tabIndex = v === n ? 0 : -1;
      n.focus();
    };

    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        vai(voci[i + 1]);
        return;
      case "ArrowUp":
        e.preventDefault();
        vai(voci[i - 1]);
        return;
      case "Home":
        e.preventDefault();
        vai(voci[0]);
        return;
      case "End":
        e.preventDefault();
        vai(voci[voci.length - 1]);
        return;
      case "ArrowRight":
        e.preventDefault();
        // Chiusa: si apre. Aperta: si scende dentro. È la stessa freccia con
        // due significati, e sono l'uno la continuazione dell'altro.
        if (espansa === "false" && path !== undefined) toggleFolder(path);
        else if (espansa === "true") vai(voci[i + 1]);
        return;
      case "ArrowLeft": {
        e.preventDefault();
        if (espansa === "true" && path !== undefined) {
          toggleFolder(path);
          return;
        }
        // Altrimenti si risale al genitore, che è il `treeitem` che contiene
        // questo — non il precedente nell'elenco, che sarebbe un fratello.
        vai(corrente.parentElement?.closest<HTMLElement>('li[role="treeitem"]') ?? undefined);
        return;
      }
      case "Enter":
      case " ":
        e.preventDefault();
        corrente.querySelector<HTMLElement>(":scope > .row")?.click();
        return;
      default:
    }
  });
}

/// I figli di una cartella, ricorsivamente: prima le sottocartelle (col loro
/// sottoalbero, se aperte), poi le note. La folder note non compare tra i
/// figli: è la cartella stessa, e la apre il click sulla sua riga.
function renderChildren(node: FolderNode, ul: HTMLElement): void {
  for (const sub of node.folders) {
    const li = document.createElement("li");
    const riga = folderRow(sub);
    li.appendChild(riga);
    const aperta = state.expanded.has(sub.path);
    // Il ruolo sta sul `<li>` e non sulla riga, perché il `<li>` è ciò che
    // contiene anche il sottoalbero: un `treeitem` che non contiene il proprio
    // gruppo è un albero che, letto, risulta piatto. Il **nome** viene invece
    // dalla riga, o sarebbe la cartella più tutte le note che ci stanno dentro.
    voceAlbero(li, riga, sub.path);
    li.setAttribute("aria-expanded", String(aperta));
    if (aperta) {
      const nested = document.createElement("ul");
      nested.className = "tree-children";
      nested.setAttribute("role", "group");
      renderChildren(sub, nested);
      li.appendChild(nested);
    }
    ul.appendChild(li);
  }
  const fnote = folderNoteOf(node, state.handledExtensions);
  for (const id of node.notes) {
    if (id === fnote) continue;
    const li = document.createElement("li");
    const riga = noteRow(id, { draggable: true });
    li.appendChild(riga);
    voceAlbero(li, riga, id);
    // Una nota non si espande: dichiarare `aria-expanded` su una foglia
    // annuncia «compressa» a chi non ha niente da aprire.
    if (id === state.currentDoc) li.setAttribute("aria-selected", "true");
    ul.appendChild(li);
  }
}

/// Fa di un `<li>` una voce d'albero: il ruolo, il nome preso dalla riga, e il
/// posto nel giro del tab.
///
/// `tabIndex = -1` per tutti, e poi `roving()` ne accende **uno**: è la
/// convenzione dei widget ad albero, e la ragione è pratica. Un vault con
/// duecento note darebbe duecento fermate del tab fra la ricerca e l'editor;
/// con una sola, il tab entra nell'albero e le frecce ci si muovono dentro —
/// che è come si muove chiunque abbia mai usato un elenco di file.
function voceAlbero(li: HTMLElement, riga: HTMLElement, path: string): void {
  const nome = riga.querySelector<HTMLElement>(".row-name");
  if (nome) {
    if (!nome.id) nome.id = `voce-${++contatoreVoci}`;
    li.setAttribute("aria-labelledby", nome.id);
  }
  li.setAttribute("role", "treeitem");
  li.dataset.path = path;
  li.tabIndex = -1;
}

let contatoreVoci = 0;

/// La riga di una nota, usata sia nell'albero sia tra le appuntate (dove il
/// drag non ha senso: l'ordine delle appuntate è l'ordine in cui si appunta).
function noteRow(id: string, opts: { draggable: boolean }): HTMLElement {
  const row = document.createElement("div");
  row.className = "row note" + (id === state.currentDoc ? " active" : "");
  row.title = id;
  const icon = state.meta.icons[id];
  if (icon) row.appendChild(rowIcon(icon));
  const name = document.createElement("span");
  name.className = "row-name";
  name.textContent = pageName(id);
  row.appendChild(name);

  row.addEventListener("click", () => void openDocument(id));
  row.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    const appuntata = state.meta.pinned.includes(id);
    showContextMenu(e, [
      { label: t("explorer.rename"), run: () => startRename(row, id) },
      { label: t("explorer.icon"), run: () => scegliIcona(e, id) },
      {
        label: appuntata ? t("explorer.unpin") : t("explorer.pin"),
        run: () => togglePin(id),
      },
      { label: t("explorer.to_folder"), run: () => void convertToFolder(id) },
      { label: t("explorer.delete"), danger: true, run: () => void trashWithConfirm(id) },
    ]);
  });
  if (opts.draggable) wireDrag(row, id, "note");
  return row;
}

/// La riga di una cartella: freccia per aprire/chiudere, click che apre la
/// folder note se c'è (altrimenti apre/chiude, come la freccia).
function folderRow(folder: FolderNode): HTMLElement {
  const row = document.createElement("div");
  row.className = "row folder";
  row.title = folder.path;

  const chevron = document.createElement("span");
  chevron.className = "chevron";
  chevron.textContent = state.expanded.has(folder.path) ? "▾" : "▸";
  chevron.addEventListener("click", (e) => {
    e.stopPropagation();
    toggleFolder(folder.path);
  });
  row.appendChild(chevron);
  row.appendChild(rowIcon(state.meta.icons[folder.path] ?? "📁"));

  const name = document.createElement("span");
  name.className = "row-name";
  name.textContent = folder.name;
  row.appendChild(name);

  const fnote = folderNoteOf(folder, state.handledExtensions);
  if (fnote) row.classList.add("has-note");
  row.addEventListener("click", () => {
    if (fnote) {
      void openDocument(fnote);
      if (!state.expanded.has(folder.path)) toggleFolder(folder.path);
    } else {
      toggleFolder(folder.path);
    }
  });
  row.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    showContextMenu(e, [
      { label: t("explorer.icon"), run: () => scegliIcona(e, folder.path) },
      { label: t("explorer.as_space"), run: () => addSpace(folder.path) },
    ]);
  });
  wireDrag(row, folder.path, "folder");
  return row;
}

function rowIcon(icon: string): HTMLElement {
  const span = document.createElement("span");
  span.className = "row-icon";
  span.textContent = icon;
  return span;
}

function toggleFolder(path: string): void {
  if (!state.expanded.delete(path)) state.expanded.add(path);
  saveExpanded();
  renderFileList(state.knownDocs);
}

function markActive(): void {
  document
    .querySelectorAll<HTMLElement>("#files-panel .row.note")
    .forEach((row) => row.classList.toggle("active", row.title === state.currentDoc));
  // Qual è la nota aperta è uno **stato**, e va detto anche a chi non vede lo
  // sfondo cambiare. Sta qui e non in `renderChildren` perché cambiare nota non
  // ridisegna l'albero: se stesse solo di là, l'annuncio resterebbe sulla nota
  // di prima fino al primo ridisegno per un'altra ragione.
  for (const li of vociAlbero()) {
    if (li.dataset.path === state.currentDoc) li.setAttribute("aria-selected", "true");
    else li.removeAttribute("aria-selected");
  }
}

// --- appuntate, icone, spazi ------------------------------------------------

function renderPinned(docs: string[]): void {
  const presenti = new Set(docs);
  const pinned = state.meta.pinned.filter((id) => presenti.has(id));
  pinnedTitleEl.hidden = pinned.length === 0;
  pinnedListEl.hidden = pinned.length === 0;
  pinnedListEl.innerHTML = "";
  for (const id of pinned) {
    const li = document.createElement("li");
    const riga = noteRow(id, { draggable: false });
    // Le appuntate sono una lista piatta e non un albero: qui il bersaglio del
    // tab è la riga stessa, che è anche ciò che si clicca. Sono poche per
    // costruzione — le appunta l'utente — quindi non serve il `roving` che
    // l'albero usa per non diventare duecento fermate.
    attivabile(riga);
    li.appendChild(riga);
    pinnedListEl.appendChild(li);
  }
}

function togglePin(id: string): void {
  void setPinned(id, !state.meta.pinned.includes(id));
}

function scegliIcona(at: MouseEvent, path: string): void {
  pickIcon(at, (icon) => {
    void setIcon(path, icon ?? null);
  });
}

// Uno spazio è una cartella registrata nella striscia di icone in cima alla
// sidebar (stile make.md): selezionarlo radica l'albero lì, e il resto del
// vault non esiste. La prima icona è "home", cioè il vault intero.

function renderSpaceStrip(): void {
  spaceStripEl.innerHTML = "";

  const home = document.createElement("button");
  home.className = "space-chip" + (state.activeSpace === null ? " active" : "");
  home.textContent = "🏠";
  home.title = t("explorer.whole_vault");
  home.addEventListener("click", () => selectSpace(null));
  spaceStripEl.appendChild(home);

  for (const path of state.meta.spaces) {
    const chip = document.createElement("button");
    chip.className = "space-chip" + (state.activeSpace === path ? " active" : "");
    chip.textContent = state.meta.icons[path] ?? "🗂️";
    chip.title = childName(path);
    chip.addEventListener("click", () => selectSpace(path));
    chip.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      showContextMenu(e, [
        { label: t("explorer.icon"), run: () => scegliIcona(e, path) },
        { label: t("explorer.not_a_space"), run: () => removeSpace(path) },
      ]);
    });
    spaceStripEl.appendChild(chip);
  }

  const add = document.createElement("button");
  add.className = "space-chip add";
  add.textContent = "+";
  add.title = t("explorer.new_space");
  add.addEventListener("click", (e) => pickNewSpace(e));
  spaceStripEl.appendChild(add);
}

/// Il titolo del pannello: il nome dello spazio attivo (cliccarlo apre la sua
/// folder note), o "Note" a casa.
function renderSpaceTitle(): void {
  spaceTitleEl.textContent =
    state.activeSpace === null
      ? t("explorer.notes")
      : `${state.meta.icons[state.activeSpace] ?? "🗂️"} ${childName(state.activeSpace)}`;
  spaceTitleEl.classList.toggle("clickable", state.activeSpace !== null);
}

function selectSpace(path: string | null): void {
  state.activeSpace = path;
  saveActiveSpace();
  renderFileList(state.knownDocs);
}

/// Registra una cartella come spazio (se già non lo è) e la seleziona.
function addSpace(path: string): void {
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
function pickNewSpace(at: MouseEvent): void {
  const candidate = allFolders(buildTree(state.knownDocs, state.meta)).filter(
    (f) => !state.meta.spaces.includes(f.path),
  );
  if (candidate.length === 0) {
    showContextMenu(at, [{ label: t("explorer.no_folders"), run: () => {} }]);
    return;
  }
  showContextMenu(
    at,
    candidate.map((f) => ({
      label: `${state.meta.icons[f.path] ?? "📁"} ${f.path}`,
      run: () => addSpace(f.path),
    })),
  );
}

/// Il nome dello spazio nel titolo apre la sua folder note, se esiste.
function openSpaceNote(): void {
  if (state.activeSpace === null) return;
  const node = findFolder(buildTree(state.knownDocs, state.meta), state.activeSpace);
  const fnote = node && folderNoteOf(node, state.handledExtensions);
  if (fnote) void openDocument(fnote);
}

// --- crea, rinomina, converti -----------------------------------------------

/// Crea una nota e la apre.
async function newNote(): Promise<void> {
  const creata = await createNote();
  if (creata) await openDocument(creata);
  focusEditor();
}

/// Rinomina in posto: la riga della lista diventa un campo di testo.
///
/// Si rinomina il **nome pagina**, non il path: cartella ed estensione restano
/// quelle di prima, perché è ciò che l'utente si aspetta scrivendo sopra un
/// titolo. Spostare una nota altrove è un'altra operazione.
function startRename(li: HTMLElement, id: string): void {
  const input = document.createElement("input");
  input.value = pageName(id);
  li.textContent = "";
  li.appendChild(input);
  input.focus();
  input.select();

  let chiuso = false;
  const annulla = () => {
    if (chiuso) return;
    chiuso = true;
    renderFileList(state.knownDocs);
  };
  const conferma = async () => {
    if (chiuso) return;
    chiuso = true;
    const nuovo = input.value.trim();
    if (!nuovo || nuovo === pageName(id)) {
      renderFileList(state.knownDocs);
      return;
    }
    await renameDoc(id, nuovo);
  };

  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") void conferma();
    else if (e.key === "Escape") annulla();
  });
  input.addEventListener("blur", annulla);
}

async function renameDoc(from: string, newPageName: string): Promise<void> {
  const slash = from.lastIndexOf("/");
  const dir = slash === -1 ? "" : from.slice(0, slash + 1);
  const dot = from.lastIndexOf(".");
  const ext = dot > slash ? from.slice(dot) : "";
  const to = `${dir}${newPageName}${ext}`;

  // Il rename riscrive i wikilink entranti, cioè file di terzi — e fra questi
  // può esserci il documento aperto. Il buffer va messo in salvo prima, o la
  // riscrittura del kernel finirebbe sotto una copia più vecchia.
  await flushPendingSave();
  try {
    await renameNote(from, to);
  } catch (e) {
    console.error(`FubMD: ${t("explorer.rename_failed", { doc: from, to, reason: errorText(e) })}`);
    renderFileList(state.knownDocs);
  }
  // `currentDoc` lo aggiorna l'evento `document_renamed`: l'identità è il path,
  // e chi la migra è un solo punto.
}

/// `p/X.md` → `p/X/X.md`: la nota diventa la folder note di una cartella nuova
/// col suo nome. I wikilink entranti li riscrive il rename del kernel; icona e
/// pin migrano sull'evento `document_renamed`, come per ogni rename.
///
/// L'estensione non si sceglie: è quella che la nota ha già (`childName`). Prima
/// era `.md` cablata, che avrebbe cambiato formato a una nota per il solo fatto
/// di spostarla in una cartella.
async function convertToFolder(id: string): Promise<void> {
  const stem = pageName(id);
  const dir = parentOf(id);
  const folderPath = dir ? `${dir}/${stem}` : stem;
  try {
    await renameNote(id, `${folderPath}/${childName(id)}`);
  } catch (e) {
    console.error(`FubMD: ${t("explorer.to_folder_failed", { doc: id, reason: errorText(e) })}`);
    return;
  }
  state.expanded.add(folderPath);
  saveExpanded();
  renderFileList(state.knownDocs);
}

// --- drag & drop ------------------------------------------------------------
//
// Due gesti: riordinare tra fratelli dello stesso tipo (l'ordine finisce in
// `meta.order`, per cartella) e trascinare una nota SU una cartella per
// spostarcela dentro (che è un rename: il kernel sposta il file e riscrive i
// wikilink). Le cartelle non si spostano: sarebbero N rename, un'operazione
// che merita di più di un gesto ambiguo.

function wireDrag(row: HTMLElement, path: string, kind: "note" | "folder"): void {
  row.draggable = true;
  row.addEventListener("dragstart", (e) => {
    drag = { path, kind, parent: parentOf(path) };
    e.dataTransfer!.effectAllowed = "move";
    e.dataTransfer!.setData("text/plain", path);
  });
  row.addEventListener("dragend", () => {
    drag = null;
    clearDropMarks();
  });
  row.addEventListener("dragover", (e) => {
    const gesto = dropGesture(row, path, kind, e);
    if (!gesto) return;
    e.preventDefault();
    clearDropMarks();
    row.classList.add(`drop-${gesto}`);
  });
  row.addEventListener("dragleave", () => {
    row.classList.remove("drop-before", "drop-after", "drop-into");
  });
  row.addEventListener("drop", async (e) => {
    const gesto = dropGesture(row, path, kind, e);
    clearDropMarks();
    if (!gesto || !drag) return;
    e.preventDefault();
    if (gesto === "into") await moveIntoFolder(drag.path, path);
    else applyReorder(drag.parent, childName(drag.path), childName(path), gesto === "before");
    drag = null;
  });
}

/// Che gesto sarebbe lasciar cadere qui? `before`/`after` = riordino tra
/// fratelli dello stesso tipo; `into` = nota dentro una cartella (di un'altra
/// cartella); null = niente da fare.
function dropGesture(
  row: HTMLElement,
  path: string,
  kind: "note" | "folder",
  e: DragEvent,
): "before" | "after" | "into" | null {
  if (!drag || drag.path === path) return null;
  const fratelli = drag.kind === kind && drag.parent === parentOf(path);
  const dentro = kind === "folder" && drag.kind === "note" && drag.parent !== path;
  // `offsetY` sarebbe relativo all'elemento più interno sotto il cursore (uno
  // span, magari): la frazione va calcolata sulla riga intera.
  const box = row.getBoundingClientRect();
  const y = (e.clientY - box.top) / box.height;
  if (dentro && (!fratelli || (y > 0.3 && y < 0.7))) return "into";
  if (fratelli) return y < 0.5 ? "before" : "after";
  return null;
}

function clearDropMarks(): void {
  document
    .querySelectorAll(".drop-before, .drop-after, .drop-into")
    .forEach((el) => el.classList.remove("drop-before", "drop-after", "drop-into"));
}

/// Riscrive l'ordine scelto a mano di una cartella: la lista completa dei nomi
/// nell'ordine visibile, col trascinato nella posizione nuova.
function applyReorder(parent: string, dragged: string, target: string, before: boolean): void {
  const node = findFolder(buildTree(state.knownDocs, state.meta), parent);
  if (!node) return;
  const names = orderedNames(node).filter((n) => n !== dragged);
  const at = names.indexOf(target);
  if (at === -1) return;
  names.splice(before ? at : at + 1, 0, dragged);
  void setOrder(parent, names);
}

async function moveIntoFolder(id: string, folderPath: string): Promise<void> {
  const to = folderPath ? `${folderPath}/${childName(id)}` : childName(id);
  if (to === id) return;
  try {
    await renameNote(id, to);
  } catch (e) {
    console.error(
      `FubMD: ${t("explorer.move_failed", {
        doc: id,
        folder: folderPath || t("explorer.root"),
        reason: errorText(e),
      })}`,
    );
    return;
  }
  if (folderPath) state.expanded.add(folderPath);
  saveExpanded();
  await refreshDocuments();
}

/// Il titolo "Note" accoglie le note trascinate fuori da ogni cartella: è la
/// radice (del vault, o dello spazio attivo).
function wireRootDropTarget(): void {
  filesTitleEl.addEventListener("dragover", (e) => {
    const radice = state.activeSpace ?? "";
    if (drag?.kind === "note" && drag.parent !== radice) {
      e.preventDefault();
      filesTitleEl.classList.add("drop-into");
    }
  });
  filesTitleEl.addEventListener("dragleave", () => filesTitleEl.classList.remove("drop-into"));
  filesTitleEl.addEventListener("drop", async (e) => {
    filesTitleEl.classList.remove("drop-into");
    if (drag?.kind !== "note") return;
    e.preventDefault();
    await moveIntoFolder(drag.path, state.activeSpace ?? "");
    drag = null;
  });
}
