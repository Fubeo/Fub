// La sidebar delle note: l'albero, le appuntate, la striscia degli spazi, le
// icone, il trascinamento e la rinomina in posto.
//
// È il pannello più grosso perché è quello con più *gesti*, non con più logica:
// la logica dell'alberatura (cosa è una cartella, cosa è una folder note, che
// ordine hanno i fratelli) sta in `rules/organizer.ts`, ed è pura e provata; il
// dato sta nel sidecar (`state/organization.ts`). Qui c'è il DOM.
import { cartelleDelVault, contenutoDiCartella, documentiEsistenti } from "../host/query";
import { Corsa } from "../ui/corsa";
import type { VaultFolder } from "../host/contract";
import { onEvent } from "../state/kernel";
import {
  loadOrganization,
  setIcon,
  setOrder,
  setPinned,
  setSpace,
} from "../state/organization";
import { on, saveActiveSpace, saveExpanded, state } from "../state/store";
import { createNote, refreshDocuments } from "../state/vault";
import {
  FINESTRA_DEL_LIVELLO,
  childName,
  folderNoteCandidates,
  folderNoteIn,
  folderNoteOf,
  orderedNames,
  pageName,
  parentOf,
  sortContent,
  type FolderContent,
} from "../rules/organizer";
import { $ } from "../ui/dom";
import { attivabile } from "../ui/a11y";
import { pickIcon, showContextMenu } from "../ui/menu";
import { refreshOn, registerPanel } from "../ui/panel-host";
import {
  flushPendingSave,
  focusEditor,
  openDocument,
  rinominaTenendoFermoIlBuffer,
} from "./document";
import { trashWithConfirm } from "./trash";
import { errorText } from "../host/errors";
import { nameFault, normalizedName, type NameFault } from "../rules/mirrored";
import { onLingua, t, type Chiave } from "../i18n/strings";
import { notify } from "../ui/notify";

const fileListEl = $("#file-list");
const filesTitleEl = $("#files-title");
const spaceStripEl = $("#space-strip");
const spaceTitleEl = $("#space-title");
const pinnedTitleEl = $("#pinned-title");
const pinnedListEl = $("#pinned-list");

/// Il drag in corso nella sidebar, se c'è.
let drag: { path: string; kind: "note" | "folder"; parent: string } | null = null;

/// Ciò che serve a disegnare l'albero, come il kernel l'ha risposto (§14.3,
/// §14.4).
///
/// **Solo le cartelle visibili**: la radice (o lo spazio attivo) e ognuna di
/// quelle aperte. Prima qui c'era l'elenco di tutte le note del vault e
/// l'albero se lo costruiva la shell; adesso un vault da diecimila note ne
/// trasferisce quante ne sono a schermo.
interface Vista {
  /// Il contenuto di ogni cartella visibile, non ordinato: l'ordine dipende
  /// dall'organizzazione, che cambia senza che il kernel c'entri.
  cartelle: Map<string, FolderContent>;
  /// I documenti «attesi» che esistono davvero: le folder note possibili delle
  /// cartelle disegnate, e le note appuntate. Una domanda sola per entrambe —
  /// sono la stessa domanda, «quali di questi path ci sono».
  esistenti: Set<string>;
}

let vista: Vista = { cartelle: new Map(), esistenti: new Set() };
/// L'impronta dell'ultima vista disegnata: gli eventi del kernel arrivano a
/// ogni salvataggio con una risposta quasi sempre identica, e ricostruire
/// l'albero distrugge gli `<li>` sotto il mouse.
let ultimaFirma = "";

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
  // ripristino) si richiede sempre: il segnale dice *quando*, non *cosa*.
  on("documents", () => void refreshFromKernel(true));
  // L'organizzazione cambiata ridisegna la stessa vista senza richiederla:
  // icone, pin e ordine non passano dal kernel.
  on("organization", renderFileList);
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
  // 200 backlink che costa 201 giri di domande e una che ne costa uno.
  // Nessun `visible`: l'albero si tiene aggiornato anche mentre la sidebar
  // mostra la ricerca o il cestino, perché alimenta anche ciò che si vede
  // altrove (le appuntate, la striscia degli spazi).
  registerPanel({
    id: "shell:explorer",
    title: "Note",
    placement: "left_sidebar",
    refresh: refreshOn("index_updated", "batch_ended"),
    render: () => refreshFromKernel(),
  });
}

/// Chiede al kernel ciò che serve a disegnare, e ridisegna se è cambiato.
///
/// Le domande sono **per cartella** (§14.3, §14.4): una coppia per ogni
/// cartella visibile — le sue sottocartelle e le sue note — più una che chiede
/// quali fra le folder note possibili e le appuntate esistono davvero. Un
/// livello alla volta, in parallelo: aprire una cartella non costa il vault, e
/// aprirne una in fondo non costa più che aprirne una in cima.
///
/// Ricostruire la lista distrugge gli `<li>`: un click a cavallo del rebuild
/// (mousedown sul vecchio nodo, mouseup su quello nuovo) non produce nessun
/// `click` e all'utente sembra servire un doppio click. Gli eventi del kernel
/// arrivano a ogni salvataggio con una risposta quasi sempre identica: qui si
/// ricostruisce solo se è cambiata davvero, o se a chiederlo è un gesto
/// dell'utente (`forza`), che una risposta identica ce l'ha per costruzione.
/// I giri di questo pannello, di cui conta solo l'ultimo.
///
/// La firma qui sotto **sembra** questa cosa e non lo è: `ultimaFirma` toglie i
/// ridisegni identici, cioè risponde a «è cambiato qualcosa?». Non risponde a
/// «sono ancora io?», ed è la domanda che mancava — due giri partiti insieme
/// hanno quasi sempre firme *diverse* (una sottocartella aperta nel frattempo,
/// una nota salvata), quindi il vecchio passava il controllo e vinceva perché
/// arrivava dopo. Un dedup non è mai un ordinamento (decisione 0134).
const corsa = new Corsa();

async function refreshFromKernel(forza = false): Promise<void> {
  await corsa.ultimo(async (atteso) => {
    const cartelle = await atteso(caricaVisibili());
    const attesi = [
      ...[...cartelle.values()].flatMap((c) =>
        c.folders.flatMap((f) => folderNoteCandidates(f.path, state.handledExtensions)),
      ),
      ...state.meta.pinned,
    ];
    const nuova: Vista = { cartelle, esistenti: await atteso(documentiEsistenti(attesi)) };
    const firma = impronta(nuova);
    if (!forza && firma === ultimaFirma) return;
    ultimaFirma = firma;
    vista = nuova;
    renderFileList();
  });
}

/// Il contenuto delle sole cartelle **visibili**: la radice dello spazio
/// attivo, e ricorsivamente quelle aperte.
///
/// Un livello per volta, e le cartelle di un livello insieme: sono domande
/// indipendenti, e farle in fila vorrebbe dire pagare la latenza dell'IPC una
/// volta per cartella aperta.
async function caricaVisibili(): Promise<Map<string, FolderContent>> {
  const out = new Map<string, FolderContent>();
  let livello = [state.activeSpace ?? ""];
  while (livello.length > 0) {
    const contenuti = await Promise.all(
      livello.map((path) => contenutoDiCartella(path, FINESTRA_DEL_LIVELLO)),
    );
    const prossimo: string[] = [];
    contenuti.forEach((contenuto, i) => {
      const path = livello[i]!;
      out.set(path, { path, ...contenuto });
      for (const sub of contenuto.folders) {
        if (state.expanded.has(sub.path)) prossimo.push(sub.path);
      }
    });
    livello = prossimo;
  }
  return out;
}

/// Cosa il kernel ha risposto, in una stringa: due viste con la stessa impronta
/// disegnano lo stesso albero.
function impronta(v: Vista): string {
  const cartelle = [...v.cartelle.entries()].map(
    ([path, c]) =>
      `${path}[${c.folders.map((f) => `${f.path}:${f.folders}:${f.entries}`).join(",")}][${c.notes.join(",")}]`,
  );
  return `${cartelle.join(";")}|${[...v.esistenti].sort().join(",")}`;
}

/// Il contenuto di una cartella nell'ordine in cui si vede, se è caricata.
function figli(path: string): FolderContent | null {
  const content = vista.cartelle.get(path);
  return content ? sortContent(content, state.meta) : null;
}

function renderFileList(): void {
  // Uno spazio rimosso (o la cui cartella non esiste più) non può restare
  // selezionato: si torna a casa senza dire niente.
  if (state.activeSpace !== null && !state.meta.spaces.includes(state.activeSpace)) {
    state.activeSpace = null;
    saveActiveSpace();
  }
  renderSpaceStrip();
  renderSpaceTitle();
  renderPinned();
  // Chi stava navigando da tastiera non deve perdere il posto: aprire una
  // cartella ridisegna **tutto** l'albero, e senza questa riga il fuoco
  // tornerebbe in cima al documento a ogni freccia destra — cioè la
  // navigazione da tastiera si romperebbe proprio nel momento in cui la si sta
  // usando.
  const attiva = document.activeElement;
  const daRimettere =
    attiva instanceof HTMLElement && fileListEl.contains(attiva) ? attiva.dataset.path : undefined;

  fileListEl.innerHTML = "";
  renderChildren(state.activeSpace ?? "", fileListEl);

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
///
/// **Un ascoltatore solo sul contenitore vede anche i tasti che non sono suoi**,
/// ed è il prezzo di quella scelta: la rinomina in posto mette un campo di testo
/// *dentro* una voce dell'albero (`startRename`), quindi ogni battuta là dentro
/// risaliva fin qui. Invio confermava la rinomina **e** faceva il `click` sulla
/// riga, cioè riapriva il path vecchio — che dopo la rinomina non esiste più:
/// una tab fantasma, e il salvataggio successivo che **ricrea il file appena
/// rinominato**. Le frecce erano lo stesso difetto in tono minore: il `preventDefault`
/// impediva di muovere il cursore nel nome che si stava scrivendo. La regola sta
/// qui e non nel campo — chi mette un input dentro l'albero non deve saperlo —
/// ed è la stessa che vale per ogni contenitore che ascolta la tastiera dei
/// propri figli: **i tasti di un campo sono del campo**.
function frecceNellAlbero(): void {
  fileListEl.addEventListener("keydown", (e) => {
    const target = e.target;
    if (!(target instanceof HTMLElement)) return;
    if (target.closest("input, textarea, select, [contenteditable]")) return;
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
///
/// Si disegna da ciò che è **caricato**: una cartella aperta il cui contenuto
/// non è ancora arrivato non disegna figli, e li disegnerà il ridisegno che
/// segue il caricamento.
function renderChildren(path: string, ul: HTMLElement): void {
  const node = figli(path);
  if (!node) return;
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
    // `aria-expanded` solo su ciò che ha qualcosa da aprire: una cartella vuota
    // è una foglia, e annunciarla «compressa» prometterebbe un contenuto che
    // non c'è. Che una cartella possa essere vuota è nuovo (§14.3): prima una
    // cartella nasceva dal path di una nota, quindi ne aveva sempre almeno una.
    if (!vuota(sub)) li.setAttribute("aria-expanded", String(aperta));
    if (aperta) {
      const nested = document.createElement("ul");
      nested.className = "tree-children";
      nested.setAttribute("role", "group");
      renderChildren(sub.path, nested);
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
  // Ciò che la finestra ha lasciato fuori **si dice**. Un livello troncato in
  // silenzio è peggio di un livello lento: chi guarda conclude che la cartella
  // contiene ciò che vede, e cerca altrove una nota che c'è. La riga non è
  // attivabile perché non c'è ancora un gesto che la apra — «mostra le altre»
  // è la casella residua di questa voce — e dirlo senza saperlo fare è più
  // onesto che non dirlo.
  const altre = node.altreCartelle + node.altreNote;
  if (altre > 0) ul.appendChild(rigaTroncata(altre));
}

/// La riga che dice quante voci di questo livello non sono disegnate.
function rigaTroncata(quante: number): HTMLElement {
  const li = document.createElement("li");
  li.className = "row troncata";
  li.setAttribute("role", "none");
  li.textContent = t("explorer.altre_voci", { n: quante });
  return li;
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

/// Una cartella senza niente dentro: né sottocartelle né file, di nessuna
/// specie. I due conti arrivano dal kernel col resto della riga (§14.3), quindi
/// saperlo non costa una domanda in più.
function vuota(folder: VaultFolder): boolean {
  return folder.folders === 0 && folder.entries === 0;
}

/// La riga di una cartella: freccia per aprire/chiudere, click che apre la
/// folder note se c'è (altrimenti apre/chiude, come la freccia).
function folderRow(folder: VaultFolder): HTMLElement {
  const row = document.createElement("div");
  row.className = "row folder";
  row.title = folder.path;

  const chevron = document.createElement("span");
  chevron.className = "chevron";
  // Niente freccia su una cartella vuota: lo spazio resta (l'allineamento dei
  // fratelli è lo stesso), ma non si promette un contenuto che non c'è.
  if (!vuota(folder)) {
    chevron.textContent = state.expanded.has(folder.path) ? "▾" : "▸";
    chevron.addEventListener("click", (e) => {
      e.stopPropagation();
      toggleFolder(folder.path);
    });
  }
  row.appendChild(chevron);
  row.appendChild(rowIcon(state.meta.icons[folder.path] ?? "📁"));

  const name = document.createElement("span");
  name.className = "row-name";
  name.textContent = childName(folder.path);
  row.appendChild(name);

  // La folder note di una cartella **non aperta** non si sa guardandoci dentro
  // — guardarci dentro è il giro che questa voce toglie. Si sa perché il
  // kernel ha già detto quali, fra i path che potrebbero esserlo, esistono.
  const fnote = folderNoteIn(folder.path, state.handledExtensions, vista.esistenti);
  if (fnote) row.classList.add("has-note");
  row.addEventListener("click", () => {
    if (fnote) {
      void openDocument(fnote);
      if (!state.expanded.has(folder.path) && !vuota(folder)) toggleFolder(folder.path);
    } else if (!vuota(folder)) {
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

/// Apre o chiude una cartella. Aprirne una **chiede il suo contenuto**
/// (§14.4): non c'era in memoria, perché in memoria c'è ciò che si vede.
function toggleFolder(path: string): void {
  if (!state.expanded.delete(path)) state.expanded.add(path);
  saveExpanded();
  void refreshFromKernel(true);
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

/// Le appuntate che esistono ancora.
///
/// Quali esistano lo dice il kernel — sono nella stessa domanda delle folder
/// note (§14.4) — e non un elenco del vault da cui pescarle: un'appuntata è un
/// path scritto nel sidecar, e verificarne cinque non è una ragione per
/// chiedere diecimila righe.
function renderPinned(): void {
  const pinned = state.meta.pinned.filter((id) => vista.esistenti.has(id));
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
  add.addEventListener("click", (e) => void pickNewSpace(e));
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

/// Cambiare spazio cambia la **radice** dell'albero, quindi cambia quali
/// cartelle sono visibili: si richiede, non si ridisegna soltanto.
function selectSpace(path: string | null): void {
  state.activeSpace = path;
  saveActiveSpace();
  void refreshFromKernel(true);
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
///
/// Le cartelle le elenca il kernel (§14.3), a ogni profondità: prima si
/// ricavavano dai path delle note, quindi una cartella vuota non compariva —
/// ed è esattamente quella che si vuole poter eleggere a spazio prima di
/// riempirla.
async function pickNewSpace(at: MouseEvent): Promise<void> {
  // Un menu contestuale con una voce per cartella del vault non è un menu: la
  // finestra è la stessa dell'albero, e le altre si dicono invece di sparire.
  const tutte = await cartelleDelVault(FINESTRA_DEL_LIVELLO);
  const candidate = tutte.items.filter((f) => !state.meta.spaces.includes(f.path));
  if (candidate.length === 0) {
    showContextMenu(at, [{ label: t("explorer.no_folders"), run: () => {} }]);
    return;
  }
  const altre = Math.max(0, tutte.total - tutte.items.length);
  showContextMenu(at, [
    ...candidate.map((f) => ({
      label: `${state.meta.icons[f.path] ?? "📁"} ${f.path}`,
      run: () => addSpace(f.path),
    })),
    ...(altre > 0 ? [{ label: t("explorer.altre_cartelle", { n: altre }), run: () => {} }] : []),
  ]);
}

/// Il nome dello spazio nel titolo apre la sua folder note, se esiste.
///
/// Lo spazio attivo è la **radice** dell'albero disegnato, quindi il suo
/// contenuto è già in mano: non serve chiederlo di nuovo.
function openSpaceNote(): void {
  if (state.activeSpace === null) return;
  const node = figli(state.activeSpace);
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
    renderFileList();
  };
  const conferma = async () => {
    if (chiuso) return;
    chiuso = true;
    const nuovo = input.value.trim();
    if (!nuovo || nuovo === pageName(id)) {
      renderFileList();
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

/// La frase per ciascun guasto di un nome: la mappa è un `Record` **esaustivo**,
/// quindi un'etichetta nuova in `NameFault` non compila finché non ha la sua
/// chiave di catalogo. Un `` `name_fault.${tag}` `` composto a mano avrebbe
/// compilato sempre, e la chiave mancante sarebbe comparsa a schermo.
const MOTIVO: Record<NameFault, Chiave> = {
  empty: "name_fault.empty",
  traversal: "name_fault.traversal",
  machine: "name_fault.machine",
  control: "name_fault.control",
  reserved: "name_fault.reserved",
  device: "name_fault.device",
  "trailing-dot": "name_fault.trailing_dot",
  hidden: "name_fault.hidden",
  "too-long": "name_fault.too_long",
};

async function renameDoc(from: string, newPageName: string): Promise<void> {
  const slash = from.lastIndexOf("/");
  const dir = slash === -1 ? "" : from.slice(0, slash + 1);
  const dot = from.lastIndexOf(".");
  const ext = dot > slash ? from.slice(dot) : "";
  const to = normalizedName(`${dir}${newPageName}${ext}`);

  // Il no arriva **prima** del giro IPC (§15.5), e con la stessa regola che il
  // kernel applicherebbe (`rules/mirrored.ts`, legata alla gemella Rust dalla
  // fixture del §6.2). Non è un doppione per comodità: la destinazione di un
  // rename è un nome che *nasce*, e chiederlo al kernel vorrebbe dire un giro
  // IPC, un `PluginError` da leggere e — soprattutto — il campo di testo già
  // chiuso, cioè il nome da ridigitare.
  //
  // `normalizedName` qui sopra non serve più a *giudicare* — dalla 0068 se la
  // calcola `nameFault` — ma a **mandare**: è la forma che verrebbe scritta sul
  // disco (NFC, senza spazi ai bordi dei segmenti), ed è quella che il kernel
  // deve ricevere perché il nome che l'utente rivede sia quello che c'è.
  const guasto = nameFault(to, "new");
  if (guasto !== null) {
    notify(t("explorer.bad_name", { nome: newPageName, motivo: t(MOTIVO[guasto]) }), "info");
    renderFileList();
    return;
  }

  // Il rename riscrive i wikilink entranti, cioè file di terzi — e fra questi
  // può esserci il documento aperto. Il buffer va messo in salvo prima, o la
  // riscrittura del kernel finirebbe sotto una copia più vecchia.
  if (await nonInSalvo()) {
    renderFileList();
    return;
  }
  try {
    await rinominaTenendoFermoIlBuffer(from, to);
  } catch (e) {
    notify(t("explorer.rename_failed", { doc: from, to, reason: errorText(e) }), "guasto");
    renderFileList();
  }
  // `currentDoc` lo aggiorna l'evento `document_renamed`: l'identità è il path,
  // e chi la migra è un solo punto.
}

/// **Il testo non salvato esce prima**, e se non ce la fa l'operazione non parte.
///
/// Vale per i gesti che **spostano un file**: il kernel, muovendo, riscrive
/// anche i wikilink entranti di file di terzi, e un buffer rimasto sporco li
/// ricoprirebbe col testo di prima al salvataggio successivo. Guarda ogni
/// documento appeso e non solo quello mosso, perché quelli riscritti dal kernel
/// sono gli **altri**: chi ha una battuta non salvata in una nota che cita
/// questa è precisamente chi ci rimette.
///
/// Chi legge un documento — aprirne un altro, un'azione di view — continua a
/// chiamare `flushPendingSave` e a proseguire: lì il testo non salvato resta nel
/// suo buffer, che è sporco, e il tentativo dopo riparte da lì.
async function nonInSalvo(): Promise<boolean> {
  const appesi = await flushPendingSave();
  if (appesi.length === 0) return false;
  notify(t("document.unsaved_blocks", { doc: appesi.join(", ") }), "guasto");
  return true;
}

/// `p/X.md` → `p/X/X.md`: la nota diventa la folder note di una cartella nuova
/// col suo nome. I wikilink entranti li riscrive il rename del kernel; icona e
/// pin migrano sull'evento `document_renamed`, come per ogni rename.
///
/// L'estensione non si sceglie: è quella che la nota ha già (`childName`). Prima
/// era `.md` cablata, che avrebbe cambiato formato a una nota per il solo fatto
/// di spostarla in una cartella.
async function convertToFolder(id: string): Promise<void> {
  // Sposta un file esattamente come la rinomina — è una rinomina — e prima non
  // metteva in salvo niente affatto (difetto 0206).
  if (await nonInSalvo()) return;
  const stem = pageName(id);
  const dir = parentOf(id);
  const folderPath = dir ? `${dir}/${stem}` : stem;
  try {
    await rinominaTenendoFermoIlBuffer(id, `${folderPath}/${childName(id)}`);
  } catch (e) {
    notify(t("explorer.to_folder_failed", { doc: id, reason: errorText(e) }), "guasto");
    return;
  }
  state.expanded.add(folderPath);
  saveExpanded();
  void refreshFromKernel(true);
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
///
/// La cartella è quella dei due fratelli che si stanno riordinando, quindi è a
/// schermo, quindi è caricata: `figli` la trova senza chiedere niente.
function applyReorder(parent: string, dragged: string, target: string, before: boolean): void {
  const node = figli(parent);
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
    await rinominaTenendoFermoIlBuffer(id, to);
  } catch (e) {
    notify(
      t("explorer.move_failed", {
        doc: id,
        folder: folderPath || t("explorer.root"),
        reason: errorText(e),
      }),
      "guasto",
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
