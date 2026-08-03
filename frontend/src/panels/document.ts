// I riquadri dell'area principale: gli editor, i buffer, le tab, la modalità di
// ciascuno, e il contesto di sessione che ne esce.
//
// # Le due verità, e perché sono due
//
// Questo modulo ne tiene due, e tenerle separate è la decisione centrale del
// §1.2. La prima è **il layout** — quali riquadri ci sono e cosa tiene aperto
// ognuno — e non sta qui: sta in `state/layout.ts`, perché è ciò che si ricorda
// fra un avvio e l'altro. La seconda è **il buffer**, che è la verità del
// documento aperto finché è sporco (docs/architecture/data-model.md, "Fonte di
// verità"), e sta qui.
//
// E il buffer è **per documento, non per riquadro**. È la domanda che il §1.2
// lasciava scoperta e che si scopre solo arrivandoci: una nota aperta in due
// riquadri, se ognuno tenesse il suo testo, sarebbero due note — si scrive di
// qua, si salva di là, e il salvataggio più recente copre l'altro senza che
// niente lo dica. La risposta è che **una nota aperta due volte è un buffer**, e
// da lì scendono tre cose che questo file presidia:
//
//   - il testo lo tiene la mappa dei buffer, e gli editor sono superfici sopra
//     di lui: chi scrive aggiorna il buffer, e gli altri editor sullo stesso
//     documento ricevono la modifica minima (`Editor.syncDoc`);
//   - il debounce del salvataggio è del **documento**, non del riquadro: due
//     riquadri che scrivono sulla stessa nota non fanno due salvataggi in corsa;
//   - la pila di undo resta di ciascun editor (0045): le due pile non si
//     fondono, ed è per questo che la sincronizzazione non passa dalla history.
//
// Il buffer vive finché qualche riquadro tiene aperto quel documento; chiudendo
// l'ultima tab si mette in salvo ciò che c'era di sporco e poi si dimentica.
//
// # Cosa resta di prima
//
// La superficie pubblica di questo modulo è quasi la stessa: `openDocument`,
// `isOpen`, `closeDocument`, `flushPendingSave` sono le stesse domande di
// quando il riquadro era uno — «apri», «è aperto», «chiudi», «metti in salvo» —
// e le risposte adesso sono «nel riquadro col fuoco», «in un riquadro
// qualunque», «in tutti», «tutti i buffer». Non è pigrizia nel non rinominarle:
// i cinque clienti (esploratore, ricerca, cestino, intent, view) fanno davvero
// quella domanda lì, e obbligarli a nominare un riquadro vorrebbe dire far
// sapere a tutti cos'è un riquadro per non guadagnare niente.
import { createEditor, type Editor } from "../editor/editor";
import type { Tema } from "../theme/theme";
import { api } from "../host/ipc";
import { riferimentoRisolto, tagDelVault, vociDelVault } from "../host/query";
import type { PaneMode, ViewContext } from "../host/contract";
import { onEvent } from "../state/kernel";
import { emit, on, state } from "../state/store";
import {
  apriIn,
  attivaTab,
  chiudiPane,
  chiudiTab,
  dividi,
  docAttivo,
  fuocoSu,
  impostaModalita,
  layout,
  pane,
  paneAttivo,
  paneConDoc,
  panes,
  rinomina,
  togliDappertutto,
  type LayoutNode,
} from "../state/layout";
import { createNote } from "../state/vault";
import { $ } from "../ui/dom";
import { registerShellCommand } from "../ui/commands";
import { notify } from "../ui/notify";
import { clearPreview, updatePreview } from "./preview";
import { errorText } from "../host/errors";
import { t } from "../i18n/strings";

export interface DocumentDeps {
  /// Click su un `#tag` nella live preview. Iniettato invece che importato:
  /// il pannello della ricerca apre i documenti, e questo li possiede — se si
  /// importassero a vicenda sarebbe un ciclo.
  searchTag(tag: string): void;
}

/// Un riquadro **a schermo**: la sua parte di DOM, il suo editor, e quale
/// documento l'editor sta effettivamente mostrando.
///
/// `mostrato` non è ridondante con lo stato del layout: è ciò che c'è *adesso*
/// nell'editor, e serve a sapere quando caricare — senza, ogni giro di disegno
/// riscriverebbe il documento nell'editor e porterebbe via cursore e
/// cronologia.
interface Riquadro {
  id: string;
  root: HTMLElement;
  tabsEl: HTMLElement;
  editorEl: HTMLElement;
  previewEl: HTMLElement;
  editor: Editor;
  mostrato: string | null;
}

/// Il testo di un documento aperto, con lo stato del suo salvataggio.
///
/// Uno per documento, non uno per riquadro: vedi la nota in testa al file.
interface Buffer {
  text: string;
  /// Ha modifiche non ancora scritte su disco? Finché è sporco, questo testo è
  /// la verità del documento: non va MAI sovrascritto da un reload.
  dirty: boolean;
  timer?: number;
}

const riquadri = new Map<string, Riquadro>();
const buffers = new Map<string, Buffer>();

let panesEl: HTMLElement;
let deps: DocumentDeps;
let tema: Tema | null = null;

/// La firma dell'albero disegnato adesso. Ricostruire la struttura del DOM a
/// ogni segnale sarebbe corretto e sbagliato: sposta i nodi degli editor, che
/// per CodeMirror vuol dire perdere il fuoco a ogni click su una tab.
let firmaAlbero = "";

/// Pubblicazione del contesto: la selezione si muove a ogni tasto, il kernel
/// non deve saperlo a ogni tasto.
let contextTimer: number | undefined;

// --- montaggio --------------------------------------------------------------

/// Costruisce l'area principale e attacca i riquadri agli eventi che li
/// riguardano.
export function mountDocument(d: DocumentDeps): void {
  deps = d;
  panesEl = $("#panes");

  for (const b of document.querySelectorAll<HTMLElement>("#mode-switch button")) {
    b.addEventListener("click", () => void setMode(b.dataset.mode as PaneMode));
  }

  // Il layout è cambiato — qualcuno ha diviso, chiuso, cambiato tab — e il DOM
  // lo insegue. Il verso passa dal bus e non da una chiamata perché chi muta il
  // layout è anche il pannello delle impostazioni, la palette, un comando: tutti
  // punti che non devono conoscere questo modulo.
  // Un disegno che va storto si **dice**, e non alla console: dei riquadri che
  // non si ridisegnano l'utente si accorge comunque — sono metà della finestra —
  // e non avere dove leggerne la causa è l'esito buttato via del §20.3. Il
  // centro notifiche è la superficie che il §20.4 chiedeva e che dal §10.3 c'è.
  // La coda intanto si riprende al giro dopo (`coda.then(disegna, disegna)`).
  on("layout", () => {
    void sincronizza().catch((e) => {
      notify(t("panes.redraw_failed", { reason: errorText(e) }), "guasto");
    });
  });

  onEvent("document_changed", (e, origin) => {
    // La nota è cambiata (anche da fuori: watcher, altra app). Riguarda ogni
    // riquadro che la sta mostrando, non «il» riquadro.
    if (paneConDoc(e.id).length === 0) return;
    void reloadIfClean(e.id, origin.actor.kind === "watcher");
    void ridisegnaLettura(e.id);
  });

  onEvent("document_removed", (e) => {
    if (paneConDoc(e.id).length === 0) return;
    // La nota aperta è sparita da fuori (watcher, altra app). Col buffer
    // sporco il buffer vince — è la verità del documento aperto, e il primo
    // salvataggio la ricrea: qui la resurrezione è voluta. Col buffer pulito
    // no: gli editor resterebbero su un contenuto fantasma che il primo
    // autosave resusciterebbe alle spalle dell'utente.
    if (buffers.get(e.id)?.dirty) {
      console.warn(`Fub: ${e.id} cancellato su disco col buffer sporco: il buffer vince.`);
      return;
    }
    dimentica(e.id);
    togliDappertutto(e.id);
  });

  onEvent("document_renamed", (e) => {
    // L'identità è il path (0043): le tab che lo mostravano seguono, in tutti i
    // riquadri. Il buffer segue anche lui, o il salvataggio successivo
    // scriverebbe col nome vecchio.
    const buf = buffers.get(e.from);
    if (buf) {
      buffers.delete(e.from);
      buffers.set(e.to, buf);
    }
    rinomina(e.from, e.to);
  });

  onEvent("overflow", () => {
    // Eventi persi (coda troncata): ciò che deriviamo dagli eventi va
    // riconciliato da zero, non aggiornato.
    for (const id of documentiAperti()) {
      void reloadIfClean(id);
      void ridisegnaLettura(id);
    }
  });

  registraComandi();
}

/// I documenti aperti in un riquadro qualunque, senza ripetizioni.
function documentiAperti(): string[] {
  return [...new Set(panes().flatMap((id) => pane(id)?.docs ?? []))];
}

// --- i comandi dei riquadri (§18.2) -----------------------------------------
//
// Dividere, chiudere un riquadro, chiudere una tab sono **comandi** e non solo
// gesti del mouse, per la ragione della 0077: un gesto che vive solo in un
// listener è un gesto che non compare in nessun elenco e che nessuno può
// riconfigurare. Passano dalla stessa porta del click, così il cablaggio sta in
// un punto solo.

function registraComandi(): void {
  // Le due modalità come comandi (§18.2): erano due bottoni nel commutatore,
  // cioè raggiungibili col mouse e con nient'altro. Passano dalla stessa porta
  // del click (`setMode`), che è dove sta il cablaggio — classe attiva, resa
  // inline, superficie di lettura, contesto pubblicato — e non da una seconda
  // via che deve restare d'accordo con la prima.
  //
  // La terza modalità («sorgente») non è qui, e non è una dimenticanza: chi
  // passa da Lettura a Modifica lo fa cento volte al giorno, chi guarda il
  // sorgente nudo lo fa per capire cosa ha scritto un plugin. Dichiarare tre
  // comandi perché le modalità sono tre vorrebbe dire tre scorciatoie da
  // trovare per un caso che non le chiede.
  registerShellCommand({
    id: "shell.mode.reading",
    title: "commands.mode.reading",
    description: "commands.mode.reading.desc",
    keybinding: "Mod-e",
    run: () => void setMode("reading"),
  });
  registerShellCommand({
    id: "shell.mode.live",
    title: "commands.mode.live",
    description: "commands.mode.live.desc",
    keybinding: "Mod-Shift-l",
    run: () => void setMode("live_preview"),
  });
  registerShellCommand({
    id: "shell.pane.split.right",
    title: "commands.pane.split.right",
    description: "commands.pane.split.right.desc",
    keybinding: "Mod-\\",
    run: () => dividiRiquadro("row"),
  });
  registerShellCommand({
    id: "shell.pane.split.down",
    title: "commands.pane.split.down",
    description: "commands.pane.split.down.desc",
    keybinding: "Mod-Shift-\\",
    run: () => dividiRiquadro("col"),
  });
  registerShellCommand({
    id: "shell.pane.close",
    title: "commands.pane.close",
    description: "commands.pane.close.desc",
    keybinding: "Mod-Shift-w",
    run: () => void chiudiRiquadroCorrente(),
  });
  registerShellCommand({
    id: "shell.tab.close",
    title: "commands.tab.close",
    description: "commands.tab.close.desc",
    keybinding: "Mod-w",
    run: () => void chiudiTabCorrente(),
  });
}

/// Divide il riquadro col fuoco e ci porta dentro **lo stesso documento**.
///
/// È ciò che serve nove volte su dieci — la stessa nota di lato, in Lettura,
/// mentre si scrive — ed è anche il primo cliente vero della regola del buffer
/// unico: le due superfici mostrano lo stesso testo perché *è* lo stesso testo.
/// Un riquadro nuovo e vuoto lo si ottiene chiudendo la tab, che è un gesto in
/// meno di quello che servirebbe per il contrario.
function dividiRiquadro(dir: "row" | "col"): void {
  const daDividere = layout.focus;
  const corrente = docAttivo(daDividere);
  const nuovo = dividi(daDividere, dir);
  if (nuovo && corrente) apriIn(nuovo, corrente);
}

async function chiudiRiquadroCorrente(): Promise<void> {
  const id = layout.focus;
  const suoi = pane(id)?.docs ?? [];
  if (!chiudiPane(id)) return;
  // Il riquadro non c'è più: i suoi documenti possono essere rimasti senza
  // nessuno che li guardi, e allora il buffer va messo in salvo e dimenticato.
  for (const doc of suoi) await congedaSeNessunoLoGuarda(doc);
}

async function chiudiTabCorrente(): Promise<void> {
  const p = paneAttivo();
  const doc = docAttivo();
  if (p.active < 0) return;
  chiudiTab(layout.focus, p.active);
  if (doc) await congedaSeNessunoLoGuarda(doc);
}

/// Un documento che nessun riquadro mostra più: si salva se era sporco, e poi si
/// lascia andare. Salvare **prima** di dimenticare è il punto — chiudere una tab
/// non è annullare ciò che si era scritto, e il debounce poteva avere ancora
/// qualcosa in coda.
async function congedaSeNessunoLoGuarda(doc: string): Promise<void> {
  if (paneConDoc(doc).length > 0) return;
  await flushDoc(doc);
  dimentica(doc);
}

function dimentica(doc: string): void {
  const buf = buffers.get(doc);
  if (buf?.timer !== undefined) window.clearTimeout(buf.timer);
  buffers.delete(doc);
}

// --- disegnare i riquadri ---------------------------------------------------

/// I disegni in coda, uno dopo l'altro.
///
/// Serve perché ci si arriva da due strade che partono insieme: chi muta il
/// layout fa scattare il segnale, e chi lo ha mutato aspetta anche il proprio
/// `sincronizza()`. Senza coda le due si sovrappongono, e la seconda torna
/// **prima** che la prima abbia finito di caricare l'editor — cioè si
/// pubblicherebbe il contesto di un buffer che non c'è ancora. Accodare invece
/// di saltare il secondo giro: chi aspetta deve aspettare il disegno che
/// comprende la sua mutazione, non uno qualunque.
let coda: Promise<void> = Promise.resolve();

/// Porta il DOM in accordo col layout: la struttura, le tab, i documenti
/// caricati, la modalità, il fuoco.
///
/// È l'unico punto che disegna, ed è il motivo per cui tutto il resto di questo
/// file può limitarsi a mutare il layout e non pensarci più — la stessa forma
/// con cui `ui/panel-host.ts` ha tolto ai pannelli il «quando ridisegnarsi».
export function sincronizza(): Promise<void> {
  coda = coda.then(disegna, disegna);
  return coda;
}

async function disegna(): Promise<void> {
  costruisciStruttura();
  const attivo = docAttivo();
  for (const id of panes()) {
    const r = riquadri.get(id);
    const p = pane(id);
    if (!r || !p) continue;
    disegnaTab(r, p.docs, p.active);
    r.root.dataset.mode = p.mode;
    r.root.classList.toggle("focus", id === layout.focus);
    await mostra(r, docAttivo(id));
  }
  aggiornaCommutatore();
  if (state.currentDoc !== attivo) {
    state.currentDoc = attivo;
    emit("active-doc", attivo);
  }
}

/// Ricostruisce l'albero di contenitori, ma **solo se è cambiato**.
///
/// I nodi dei riquadri si riusano e si riappendono: un editor CodeMirror
/// ricostruito a ogni click perderebbe cronologia, cursore e fuoco, e la
/// perdita si vedrebbe solo usando l'app — che è il modo più caro per accorgersi
/// di una cosa.
function costruisciStruttura(): void {
  const firma = JSON.stringify(layout.tree);
  if (firma === firmaAlbero) return;
  firmaAlbero = firma;
  const vivi = new Set(panes());
  for (const [id, r] of riquadri) {
    if (!vivi.has(id)) {
      r.root.remove();
      riquadri.delete(id);
    }
  }
  panesEl.replaceChildren(nodo(layout.tree));
}

function nodo(n: LayoutNode): HTMLElement {
  if (n.k === "leaf") return riquadro(n.pane).root;
  const el = document.createElement("div");
  el.className = `pane-split ${n.dir}`;
  el.append(...n.children.map(nodo));
  return el;
}

/// Il riquadro con questo id, creandolo se è nuovo.
function riquadro(id: string): Riquadro {
  const gia = riquadri.get(id);
  if (gia) return gia;

  const root = document.createElement("section");
  root.className = "pane";
  root.dataset.pane = id;
  // Ogni riquadro è una regione con un nome: senza, un lettore di schermo
  // annuncia N sezioni identiche e non c'è modo di sapere in quale si è
  // finiti. Il nome è il numero, che è l'unica cosa che li distingua finché
  // non hanno un titolo — e col documento aperto lo aggiorna `disegnaTab`.
  root.setAttribute("role", "region");

  const tabsEl = document.createElement("div");
  tabsEl.className = "pane-tabs";
  tabsEl.setAttribute("role", "tablist");

  const editorEl = document.createElement("div");
  editorEl.className = "pane-editor";

  const previewEl = document.createElement("div");
  previewEl.className = "pane-preview markdown-preview";
  previewEl.tabIndex = 0;

  root.append(tabsEl, editorEl, previewEl);
  // Toccare un riquadro gli dà il fuoco. `mousedown` e non `click` perché il
  // fuoco deve essere già di questo riquadro quando l'editor riceve l'evento:
  // altrimenti il contesto pubblicato subito dopo sarebbe quello di prima.
  root.addEventListener("mousedown", () => fuocoSu(id));
  root.addEventListener("focusin", () => fuocoSu(id));

  const editor = createEditor(editorEl, {
    onChange: (text) => scritto(id, text),
    onSelectionChange: () => {
      // Solo il riquadro col fuoco pubblica: il contesto di sessione è «cosa
      // sta guardando l'utente adesso», e con N riquadri la risposta resta una
      // — è la ragione per cui il kernel non tiene una mappa di riquadri.
      if (layout.focus === id) scheduleContext();
    },
    onOpenWikilink: (page) => void openWikilink(page),
    onSearchTag: (tag) => deps.searchTag(tag),
    // Le sorgenti dei completamenti sono l'IPC, ammorbidite: prima che un
    // vault sia aperto rispondono vuoto, non con un errore in console.
    completions: {
      // Dal canale dati (§14.4): l'autocompletamento vuole i nomi di **tutte**
      // le note, quindi qui la lista resta intera — cambia la porta, non la
      // domanda. Il §21 la cambierà anche di forma.
      listNotes: () =>
        vociDelVault("document")
          .then((page) => page.items.map((e) => e.id))
          .catch(() => []),
      listTags: () => tagDelVault().catch(() => []),
    },
  });
  // Un riquadro nato dopo il tema deve nascere nella luce giusta, non
  // correggersi al primo cambio (§12.4).
  if (tema) editor.setTheme(tema);

  const r: Riquadro = { id, root, tabsEl, editorEl, previewEl, editor, mostrato: null };
  riquadri.set(id, r);
  return r;
}

/// Disegna la striscia delle tab di un riquadro.
function disegnaTab(r: Riquadro, docs: string[], active: number): void {
  r.tabsEl.replaceChildren(
    ...docs.map((doc, i) => {
      const tab = document.createElement("button");
      tab.className = "tab" + (i === active ? " active" : "");
      tab.setAttribute("role", "tab");
      tab.setAttribute("aria-selected", String(i === active));
      tab.title = doc;

      const nome = document.createElement("span");
      nome.className = "tab-name";
      nome.textContent = titolo(doc);
      // Il pallino del non salvato: è l'unica cosa che dica, guardando una tab
      // che non è quella davanti, che lì dentro c'è del lavoro in coda.
      if (buffers.get(doc)?.dirty) tab.classList.add("dirty");

      const chiudi = document.createElement("span");
      chiudi.className = "tab-close";
      chiudi.textContent = "×";
      chiudi.title = t("app.close");
      chiudi.addEventListener("mousedown", (e) => {
        // `stopPropagation` o il click attiverebbe la tab che si sta chiudendo,
        // caricando un documento un istante prima di toglierlo.
        e.stopPropagation();
        e.preventDefault();
        chiudiTab(r.id, i);
        void congedaSeNessunoLoGuarda(doc);
      });

      tab.append(nome, chiudi);
      tab.addEventListener("click", () => attivaTab(r.id, i));
      return tab;
    }),
  );
  r.tabsEl.hidden = docs.length === 0;
  const aperto = active >= 0 ? titolo(docs[active]) : null;
  r.root.setAttribute(
    "aria-label",
    aperto ? t("pane.named", { name: aperto }) : t("pane.empty"),
  );
}

/// Il nome di una nota come si legge su una tab: l'ultimo pezzo del path, senza
/// estensione. Il path intero resta nel `title`, perché due note omonime in due
/// cartelle sono il caso in cui la tab da sola non basta.
function titolo(doc: string): string {
  const base = doc.split("/").pop() ?? doc;
  const punto = base.lastIndexOf(".");
  return punto > 0 ? base.slice(0, punto) : base;
}

/// Mette nell'editor di un riquadro il documento che gli tocca, se non c'è già.
async function mostra(r: Riquadro, doc: string | null): Promise<void> {
  if (r.mostrato === doc) return;
  r.mostrato = doc;
  if (!doc) {
    r.editor.setDoc("");
    clearPreview(r.previewEl);
    return;
  }
  r.editor.setDoc(await leggiBuffer(doc));
  await ridisegnaLettura(doc);
}

/// Il testo di un documento: dal buffer se qualcuno lo tiene già aperto, dal
/// disco altrimenti.
///
/// È qui che la regola del buffer unico si vede: aprire in un secondo riquadro
/// una nota con modifiche non salvate mostra **quelle modifiche**, non il file
/// su disco. L'alternativa — rileggere sempre dal disco — darebbe due riquadri
/// che mostrano due testi diversi dello stesso documento, che è esattamente ciò
/// che questa decisione esiste per non avere.
async function leggiBuffer(doc: string): Promise<string> {
  const gia = buffers.get(doc);
  if (gia) return gia.text;
  const text = await api.readDocument(doc);
  buffers.set(doc, { text, dirty: false });
  return text;
}

/// Ridisegna la superficie di lettura di ogni riquadro che mostra questo
/// documento **ed è in Lettura**.
async function ridisegnaLettura(doc: string): Promise<void> {
  await Promise.all(
    paneConDoc(doc).map(async (id) => {
      const r = riquadri.get(id);
      if (!r || pane(id)?.mode !== "reading" || docAttivo(id) !== doc) return;
      await updatePreview(r.previewEl, doc);
    }),
  );
}

/// Il commutatore in testata riflette il riquadro col **fuoco**: è di lui che si
/// sta parlando, ed è di lui che si cambia la modalità.
function aggiornaCommutatore(): void {
  const mode = paneAttivo().mode;
  for (const b of document.querySelectorAll<HTMLElement>("#mode-switch button")) {
    const scelta = b.dataset.mode === mode;
    b.classList.toggle("active", scelta);
    // Quale modalità è accesa lo diceva solo lo sfondo. `aria-pressed` lo dice
    // a chi non lo vede — ed è l'informazione che serve *prima* di premere, non
    // dopo: senza, i tre pulsanti sono tre comandi indistinguibili.
    b.setAttribute("aria-pressed", String(scelta));
  }
}

// --- aprire e chiudere ------------------------------------------------------

/// Apre un documento nel riquadro col fuoco.
export async function openDocument(id: string): Promise<void> {
  // Cambio documento: prima si mette in salvo ciò che è appeso al debounce, così
  // nessuna modifica resta indietro. Tutti i buffer e non solo quello che si sta
  // lasciando: costa zero quando sono puliti, ed è la regola già scritta per le
  // azioni di view.
  await flushPendingSave();
  apriIn(layout.focus, id);
  await sincronizza();
  // Il contesto si pubblica DOPO aver caricato il buffer: prima, lo span della
  // selezione sarebbe quello del documento precedente.
  await publishContext();
  focusEditor();
}

/// Chiude il documento aperto **in ogni riquadro**, senza salvarlo: lo si usa
/// quando il documento non c'è più (cancellato qui o da fuori), cioè quando
/// salvarlo lo resusciterebbe.
///
/// Senza argomento chiude quello attivo, che è la forma con cui la chiamava chi
/// aveva un riquadro solo.
export function closeDocument(id: string | null = state.currentDoc): void {
  if (!id) return;
  dimentica(id);
  togliDappertutto(id);
  // Il kernel svuota già il documento del contesto in `remove_document`: qui
  // si ripubblica per allineare i due stati **e** per farsi dire quali view
  // ridisegnare, che è cosa che il kernel non fa da sé.
  void publishContext();
}

/// Il documento è aperto in **qualche** riquadro?
export function isOpen(id: string): boolean {
  return paneConDoc(id).length > 0;
}

/// Risolve un wikilink e lo apre; se non risolve, crea la nota che manca col
/// nome scritto nel link (come in Obsidian). Il backlink c'è già prima ancora
/// che l'utente abbia scritto la prima riga — è il grafo a ricucirlo.
///
/// `heading` e `block` sono il **punto** che il link nomina, quando lo nomina.
/// Fino alla [0049](../../../docs/decisions/0049-una-posizione-dentro-un-documento.md)
/// arrivavano fin qui e si fermavano: la risposta di `resolve` sapeva dire
/// *quale documento* e non *dove dentro*, quindi `[[Nota#^blocco]]` apriva la
/// nota in cima e niente lo diceva. Adesso la posizione torna dal kernel e la
/// si porta a schermo con lo stesso `revealByteOffset` dell'outline — byte
/// UTF-8 → posizione editor, come per ogni altro span del modello.
export async function openWikilink(
  page: string,
  heading?: string,
  block?: string,
): Promise<void> {
  if (!page) return; // [[#Sezione]]: link interno alla nota, per ora nulla
  const target = await riferimentoRisolto({
    kind: "wiki",
    value: { page, heading: heading ?? null, block: block ?? null },
  });
  if (target) {
    await openDocument(target.doc);
    // Il punto può non esserci — un heading rinominato, un `^abc` cancellato —
    // e allora resta la nota aperta in cima: è il degrado dichiarato di
    // `ResolvedRef.at`, non un caso da nascondere.
    if (target.at) revealByteOffset(target.at.span.start);
    return;
  }
  const creata = await createNote(page);
  if (creata) await openDocument(creata);
}

// --- salvataggio ------------------------------------------------------------
//
// Del **documento**, non del riquadro: due riquadri sulla stessa nota hanno un
// debounce solo, o due salvataggi in corsa scriverebbero due volte lo stesso
// testo e la seconda scrittura arriverebbe dopo un evento che dice che il file
// è cambiato.

/// Qualcuno ha scritto in un riquadro: il buffer è la nuova verità, gli altri
/// editor sullo stesso documento la ricevono, e il salvataggio si mette in coda.
function scritto(paneId: string, text: string): void {
  const doc = docAttivo(paneId);
  if (!doc) return;
  const buf = buffers.get(doc) ?? { text, dirty: false };
  buf.text = text;
  buf.dirty = true;
  buffers.set(doc, buf);
  for (const altro of paneConDoc(doc)) {
    if (altro === paneId) continue;
    const r = riquadri.get(altro);
    if (r && r.mostrato === doc) r.editor.syncDoc(text);
  }
  // Il pallino del non salvato compare adesso, su ogni tab che mostra questa
  // nota. Ridisegnare le tab a ogni battuta costa poco — sono N pulsanti — e
  // l'alternativa sarebbe un secondo posto che sa quando un buffer si sporca.
  for (const id of paneConDoc(doc)) {
    const r = riquadri.get(id);
    const p = pane(id);
    if (r && p) disegnaTab(r, p.docs, p.active);
  }
  scheduleSave(doc);
}

function scheduleSave(doc: string): void {
  const buf = buffers.get(doc);
  if (!buf) return;
  window.clearTimeout(buf.timer);
  buf.timer = window.setTimeout(() => void saveDoc(doc), 400);
}

/// Salva subito **ogni** buffer che ha un salvataggio in attesa.
///
/// Da chiamare prima di ogni operazione che riscrive file (rename, ripristino di
/// una versione): la riscrittura del kernel finirebbe altrimenti sotto una copia
/// più vecchia. Con N riquadri il «buffer corrente» non basta più — l'operazione
/// può riguardare una nota aperta in un riquadro che non ha il fuoco.
export async function flushPendingSave(): Promise<void> {
  await Promise.all([...buffers.keys()].map(flushDoc));
}

async function flushDoc(doc: string): Promise<void> {
  const buf = buffers.get(doc);
  if (!buf?.dirty) return;
  window.clearTimeout(buf.timer);
  await saveDoc(doc);
}

/// Disinnesca un salvataggio in attesa senza eseguirlo, e dice se ce n'era uno.
///
/// Serve a chi sta per **chiedere conferma** di una cancellazione: senza,
/// l'autosave scatterebbe durante la domanda e farebbe risorgere la nota
/// subito dopo. Chi lo chiama deve rimettere in coda con `resumeSave()` se
/// l'utente ci ripensa.
export function suspendSave(id: string): boolean {
  const buf = buffers.get(id);
  if (!buf?.dirty) return false;
  window.clearTimeout(buf.timer);
  sospeso = id;
  return true;
}

let sospeso: string | null = null;

export function resumeSave(): void {
  if (sospeso) scheduleSave(sospeso);
  sospeso = null;
}

async function saveDoc(doc: string): Promise<void> {
  const buf = buffers.get(doc);
  if (!buf) return;
  const text = buf.text;
  await api.writeDocument(doc, text);
  // Pulito solo se nel frattempo non è arrivato altro input: `dirty` è stato
  // rimesso a true da `scritto` se l'utente ha continuato a scrivere.
  if (buf.text === text) buf.dirty = false;
  for (const id of paneConDoc(doc)) {
    const r = riquadri.get(id);
    const p = pane(id);
    if (r && p) disegnaTab(r, p.docs, p.active);
  }
  // Il sorgente sul disco è ora quello del buffer: la selezione torna
  // posizionabile, e il kernel — che l'aveva lasciata cadere alla scrittura —
  // deve risaperlo. È l'altra metà della regola dello span.
  await publishContext();
  await ridisegnaLettura(doc);
}

/// Ricarica un documento dal disco, ma solo se non ha modifiche non salvate.
///
/// L'origine (decisione 0012) distingue i due casi che prima erano un avviso
/// solo, e sono molto diversi: se ha scritto un'ALTRA APP il lavoro che il
/// buffer sta per coprire non è nostro e non lo possiamo rifare, mentre una
/// riscrittura del kernel o di un plugin la si riottiene rifacendo
/// l'operazione.
async function reloadIfClean(id: string, daFuori = false): Promise<void> {
  const buf = buffers.get(id);
  if (buf?.dirty) {
    console.warn(
      `Fub: ${daFuori ? t("document.overwritten", { doc: id }) : t("document.changed_on_disk", { doc: id })}`,
    );
    return;
  }
  const source = await api.readDocument(id);
  const attuale = buffers.get(id);
  // Evita il reset del cursore quando l'evento è l'eco del nostro salvataggio.
  if (!attuale || attuale.dirty || attuale.text === source) return;
  attuale.text = source;
  for (const paneId of paneConDoc(id)) {
    const r = riquadri.get(paneId);
    // `syncDoc` e non `setDoc`: il documento è lo stesso, è cambiato il testo
    // sotto — e chi lo sta guardando non deve perdere il punto in cui era.
    if (r && r.mostrato === id) r.editor.syncDoc(source);
  }
}

/// Rilegge dal disco il documento attivo (usato dopo un ripristino di versione,
/// che riscrive il file sotto al buffer).
export async function reloadCurrent(): Promise<void> {
  const doc = state.currentDoc;
  if (!doc) return;
  const buf = buffers.get(doc);
  if (buf) buf.dirty = false;
  await reloadIfClean(doc);
  await ridisegnaLettura(doc);
}

// --- contesto di sessione (decisione 0007) ----------------------------------
//
// La shell è l'unica a sapere quale riquadro ha il focus, che nota mostra, cosa
// c'è selezionato e in che modalità; il kernel lo custodisce e lo serve alle
// view via `HostApi::active_context`. Qui si decide solo *quando* pubblicarlo:
// **chi** ridisegnare lo dice il kernel, che conosce le `follows` di ogni view.
//
// Con N riquadri niente cambia di là dal confine, e questa è metà della
// decisione 0078: `ViewContext` porta un `pane` **dal primo giorno**, e il
// kernel custodisce «il contesto del riquadro col fuoco, e nient'altro». La
// domanda a cui risponde — cosa sta guardando l'utente adesso — è una sola per
// definizione, quanti che siano i riquadri.

/// Il contesto del riquadro col fuoco così com'è adesso.
///
/// Lo `span` della selezione c'è solo a buffer pulito: a buffer sporco gli
/// offset dell'editor sono di un testo che il kernel non ha, e uno span
/// mentitore farebbe tagliare i byte sbagliati a chiunque lo usi. Il testo
/// invece è sempre quello vero — ed è ciò che serve a contare le parole
/// selezionate o a mandarle a un comando.
function paneContext(): ViewContext {
  const p = paneAttivo();
  const doc = docAttivo();
  const r = riquadri.get(layout.focus);
  const sel = r?.editor.selection();
  const inEditing = doc !== null && p.mode !== "reading" && sel !== undefined;
  const dirty = doc ? (buffers.get(doc)?.dirty ?? false) : false;
  return {
    pane: layout.focus,
    doc,
    selection:
      inEditing && sel
        ? { span: dirty ? null : { start: sel.start, end: sel.end }, text: sel.text }
        : null,
    mode: p.mode,
  };
}

/// Pubblica il contesto e annuncia **quali** view il kernel ha dichiarato
/// invecchiate. Chi le ridisegna è l'host dei pannelli (`ui/panel-host.ts`): il
/// verso passa dal bus e non da una chiamata, perché la catena che le monta
/// dipende già da questo modulo.
export async function publishContext(): Promise<void> {
  window.clearTimeout(contextTimer);
  try {
    emit("stale-views", await api.setActiveContext(paneContext()));
  } catch (e) {
    // Un vault non ancora aperto non ha un workspace: il contesto non ha dove
    // andare, e non è un errore da mostrare.
    console.debug(`Fub: contesto non pubblicato: ${errorText(e)}`);
  }
}

/// Il cursore si muove a ogni tasto; il kernel non deve saperlo a ogni tasto.
function scheduleContext(): void {
  window.clearTimeout(contextTimer);
  contextTimer = window.setTimeout(() => void publishContext(), 150);
}

/// Cambia la modalità del riquadro col fuoco (FEATURES 4.1) e la pubblica.
///
/// In lettura l'editor lascia il posto al documento **reso**: è la stessa cosa
/// che l'anteprima mostrava di lato, ma non è più un pannello sempre acceso
/// accanto all'editor — le tre modalità sono esclusive, e due superfici sullo
/// stesso documento sono due verità da tenere allineate.
///
/// Che sia **del riquadro** e non della finestra è la parte nuova, ed è ciò che
/// rende utile la divisione: la nota di lato in Lettura mentre si scrive è la
/// disposizione per cui si divide, e con una modalità globale non esisterebbe.
export async function setMode(next: PaneMode): Promise<void> {
  const doc = docAttivo();
  // Il documento reso lo produce il kernel dal **sorgente salvato**: entrare in
  // lettura con del testo appeso al debounce mostrerebbe la nota di un minuto
  // fa. Si salva prima, e la lettura è sempre di ciò che si è scritto.
  if (next === "reading" && doc) await flushDoc(doc);
  impostaModalita(layout.focus, next);
  const r = riquadri.get(layout.focus);
  if (r) {
    // Sorgente = la stessa configurazione senza la resa inline.
    r.editor.setLivePreview(next === "live_preview");
    if (next === "reading") {
      if (doc) await updatePreview(r.previewEl, doc);
    } else {
      r.editor.focus();
    }
  }
  await publishContext();
}

/// Porta la vista su un offset in byte UTF-8 del documento attivo.
export function revealByteOffset(byteOffset: number): void {
  riquadri.get(layout.focus)?.editor.revealByteOffset(byteOffset);
}

export function focusEditor(): void {
  riquadri.get(layout.focus)?.editor.focus();
}

/// Porta gli editor nell'altra luce (§12.4).
///
/// Passa da qui e non da `theme/theme.ts` perché gli editor sono di questo
/// modulo: il modulo del tema non li conosce, e non deve — sa solo che
/// *qualcuno* vuole essere avvisato. La luce si ricorda anche per i riquadri che
/// non esistono ancora: uno nato dopo il cambio deve nascere già nella luce
/// giusta, non correggersi al prossimo.
export function setEditorTheme(t: Tema): void {
  tema = t;
  for (const r of riquadri.values()) r.editor.setTheme(t);
}
