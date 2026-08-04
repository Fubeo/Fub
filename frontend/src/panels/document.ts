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
import { noteDalNome, riferimentoRisolto, tagDelVault } from "../host/query";
import type { PaneMode, ViewContext } from "../host/contract";
import { onEvent } from "../state/kernel";
import { noteRecentiEsistenti } from "../state/recenti";
import { emit, on, state } from "../state/store";
import { cambioSotto, esitoDelFallimento, statoDi, type Esito } from "../state/salvataggio";
import { CHIAVE_CASO, casoDi, daRecuperare } from "../state/bozze";
import { bozzeNonSalvate } from "../host/query";
import type { DraftInfo } from "../host/contract";
import {
  apriIn,
  attivaTab,
  chiudiPane,
  chiudiTab,
  dividi,
  docAttivo,
  documenti,
  fuocoSu,
  impostaModalita,
  layout,
  pane,
  paneAttivo,
  paneConDoc,
  panes,
  rinomina,
  stessaTab,
  tabAttiva,
  togliDappertutto,
  type LayoutNode,
  type Tab,
} from "../state/layout";
import { createNote } from "../state/vault";
import { $ } from "../ui/dom";
import { registerShellCommand } from "../ui/commands";
import { notify } from "../ui/notify";
import { clearPreview, updatePreview } from "./preview";
import { montaVistaInRiquadro, smontaVistaDalRiquadro, viewPrincipale } from "../ui/views";
import { errorText } from "../host/errors";
import { onLingua, t } from "../i18n/strings";

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
  /// Dove finisce una view dichiarata che questo riquadro sta ospitando (§3.3).
  /// Vuoto quasi sempre: è la terza superficie di un riquadro, accanto
  /// all'editor e alla lettura, e come loro c'è anche quando non si vede.
  vistaEl: HTMLElement;
  editor: Editor;
  /// Cosa c'è **adesso** in questo riquadro. Una tab e non un path: dalla §3.3
  /// può essere una view, e sapere quale evita di rimontarla a ogni giro.
  mostrato: Tab | null;
}

/// Il testo di un documento aperto, con lo stato del suo salvataggio.
///
/// Uno per documento, non uno per riquadro: vedi la nota in testa al file.
interface Buffer {
  text: string;
  /// Ha modifiche non ancora scritte su disco? Finché è sporco, questo testo è
  /// la verità del documento: non va MAI sovrascritto da un reload.
  dirty: boolean;
  /// Com'è andata **l'ultima scrittura tentata** (§20.4). È un fatto diverso da
  /// `dirty`, e per questo è un campo suo: `dirty` dice se c'è qualcosa da
  /// scrivere, questo dice se ciò che si è provato a scrivere è arrivato. Un
  /// buffer può essere pulito e l'ultima scrittura essere fallita — è il caso in
  /// cui prima di oggi la shell non diceva niente — e può essere sporco mentre
  /// una scrittura è in volo.
  esito: Esito;
  /// Quanti `document_changed` **nostri** stiamo ancora aspettando.
  ///
  /// Ogni scrittura che va a buon fine torna indietro come evento: il documento
  /// è cambiato su disco, ed è cambiato perché l'abbiamo cambiato noi. Il kernel
  /// non ci dà modo di riconoscerlo — l'evento non porta una revisione, e
  /// l'origine di una scrittura della shell è `user`, la stessa di un comando
  /// che l'utente lancia — quindi lo si riconosce contando: una scrittura
  /// riuscita mette un eco in attesa, il primo evento non-watcher su quel
  /// documento lo consuma.
  ///
  /// Il modo in cui questo conto può sbagliare è uno solo ed è **limitato**: se
  /// un eco non arrivasse (coda troncata), il contatore resterebbe alto e si
  /// mangerebbe un avviso vero **di origine kernel o plugin** — mai uno della
  /// watcher, che è il caso grave, perché quello non lo consuma mai. Torna a
  /// zero a ogni caricamento del documento.
  echi: number;
  /// **Da cosa questo testo si è discostato** (§18.1): la revisione che il file
  /// aveva quando il buffer l'ha preso in mano, o che l'ultimo salvataggio ha
  /// prodotto.
  ///
  /// È ciò che rende il salvataggio una scrittura *guardata* invece che una
  /// sovrascrittura: viaggia in `writeDocument`, e se il file non è più quello
  /// il kernel risponde `conflict` senza toccare niente. Prima di questa voce
  /// il salvataggio dell'editor copriva una scrittura altrui che il watcher non
  /// aveva visto, e nessuna delle due metà del sistema se ne accorgeva.
  ///
  /// Non si calcola di qua e non si potrebbe: la deriva il kernel dallo stesso
  /// testo che ci consegna. `null` è «non lo so» — una bozza recuperata da una
  /// sessione che non la sapeva, o un buffer che ha appena scelto di
  /// sovrascrivere comunque — e vuol dire scrittura cieca, come prima.
  base: string | null;
  /// Il debounce della **bozza** (§15.2), separato da quello del salvataggio
  /// perché ha un ritmo suo: vedi `scheduleDraft`.
  draftTimer?: number;
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
    avvisaSeIlBufferCopre(e.id, origin.actor.kind === "watcher");
    void reloadIfClean(e.id);
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
      notify(t("document.deleted_dirty", { doc: e.id }), "guasto");
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

  // Il testo dello stato di salvataggio non passa da `applicaStringhe` — non ha
  // un `data-i18n`, perché lo scrive chi conosce lo stato — quindi si rifà da sé
  // al cambio di lingua, come fanno i due pulsanti della barra.
  onLingua(disegnaSalvataggio);

  registraComandi();
}

/// I documenti aperti in un riquadro qualunque, senza ripetizioni.
function documentiAperti(): string[] {
  const p = panes().flatMap((id) => {
    const stato = pane(id);
    return stato ? documenti(stato) : [];
  });
  return [...new Set(p)];
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
    run: () => void setMode("reading"),
  });
  registerShellCommand({
    id: "shell.mode.live",
    title: "commands.mode.live",
    description: "commands.mode.live.desc",
    run: () => void setMode("live_preview"),
  });
  registerShellCommand({
    id: "shell.pane.split.right",
    title: "commands.pane.split.right",
    description: "commands.pane.split.right.desc",
    run: () => dividiRiquadro("row"),
  });
  registerShellCommand({
    id: "shell.pane.split.down",
    title: "commands.pane.split.down",
    description: "commands.pane.split.down.desc",
    run: () => dividiRiquadro("col"),
  });
  registerShellCommand({
    id: "shell.pane.close",
    title: "commands.pane.close",
    description: "commands.pane.close.desc",
    run: () => void chiudiRiquadroCorrente(),
  });
  registerShellCommand({
    id: "shell.tab.close",
    title: "commands.tab.close",
    description: "commands.tab.close.desc",
    run: () => void chiudiTabCorrente(),
  });
  // Le due vie d'uscita da un conflitto (§18.1), e sono comandi e non un
  // dialogo per la ragione della 0088: la decisione è dell'utente, e un modale
  // che scatta durante un autosave con debounce la chiede in un momento che
  // l'utente non ha scelto. Il buffer sporco resta lì e aspetta, come una bozza
  // recuperata — e chi ha deciso lo dice quando ha deciso.
  registerShellCommand({
    id: "shell.doc.conflict.mine",
    title: "commands.doc.conflict.mine",
    description: "commands.doc.conflict.mine.desc",
    run: () => void risolviTenendoIlMio(),
  });
  registerShellCommand({
    id: "shell.doc.conflict.theirs",
    title: "commands.doc.conflict.theirs",
    description: "commands.doc.conflict.theirs.desc",
    run: () => void risolviScartandoIlMio(),
  });
}

/// «Vince il mio testo»: si riscrive **senza base**, cioè alla cieca e
/// apposta.
///
/// Azzerare la base e non rileggerla è la differenza fra decidere e indovinare:
/// rileggere la revisione di adesso e riprovare con quella sarebbe la
/// sovrascrittura silenziosa di prima con un giro in più, e la guardia non
/// guarderebbe niente. Qui la sovrascrittura c'è, ed è ciò che l'utente ha
/// chiesto — dopo che gli è stato detto cosa stava coprendo.
async function risolviTenendoIlMio(): Promise<void> {
  const doc = docAttivo();
  const buf = doc ? buffers.get(doc) : undefined;
  if (!doc || buf?.esito !== "conflitto") {
    notify(t("document.conflict_none"), "info");
    return;
  }
  buf.base = null;
  buf.esito = "in_corso";
  window.clearTimeout(buf.timer);
  await saveDoc(doc);
}

/// «Vince il testo sul disco»: si butta il buffer e si ricarica.
///
/// È l'unico gesto di questa voce che **perde** qualcosa, e per questo è l'unico
/// che non si può innescare da solo: sta nella palette, dove per arrivarci
/// bisogna averlo scritto — la stessa regola per cui `shell.history.clear` non
/// ha un accordo.
async function risolviScartandoIlMio(): Promise<void> {
  const doc = docAttivo();
  const buf = doc ? buffers.get(doc) : undefined;
  if (!doc || buf?.esito !== "conflitto") {
    notify(t("document.conflict_none"), "info");
    return;
  }
  window.clearTimeout(buf.timer);
  buf.dirty = false;
  buf.esito = "ok";
  // La bozza se ne va con lui: teneva *questo* testo, ed è appena stato
  // scartato da chi l'aveva scritto. Lasciarla vorrebbe dire riproporlo al
  // prossimo avvio come se fosse andato perso.
  await dropDraft(doc);
  await reloadIfClean(doc);
  await ridisegnaLettura(doc);
  disegnaSalvataggio();
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
  const stato = pane(id);
  const suoi = stato ? documenti(stato) : [];
  if (!chiudiPane(id)) return;
  // Il riquadro non c'è più: i suoi documenti possono essere rimasti senza
  // nessuno che li guardi, e allora il buffer va messo in salvo e dimenticato.
  for (const doc of suoi) await congedaSeNessunoLoGuarda(doc);
}

async function chiudiTabCorrente(): Promise<void> {
  const p = paneAttivo();
  const tab = tabAttiva();
  if (p.active < 0) return;
  chiudiTab(layout.focus, p.active);
  await congeda(layout.focus, tab);
}

/// Una tab è stata chiusa: si lascia andare ciò che teneva in vita.
///
/// Le due specie di tab hanno due cose diverse da rilasciare, e nessuna delle
/// due si raccoglie da sé: un documento ha un buffer che va **salvato** prima di
/// dimenticarlo, una view ha un pannello registrato e un albero montato. Che
/// stiano nella stessa funzione è ciò che tiene chi chiude una tab dal doversi
/// ricordare quale delle due aveva sotto le dita.
async function congeda(paneId: string, tab: Tab | null): Promise<void> {
  if (!tab) return;
  if (tab.k === "doc") await congedaSeNessunoLoGuarda(tab.doc);
  else smontaVistaDalRiquadro(tab.view, paneId);
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
    disegnaTab(r, p.tabs, p.active);
    r.root.dataset.mode = p.mode;
    r.root.classList.toggle("focus", id === layout.focus);
    await mostra(r, tabAttiva(id));
  }
  aggiornaCommutatore();
  disegnaSalvataggio();
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

  // La terza superficie del riquadro (§3.3). Non è `declared-view` come nella
  // sidebar e non deve esserlo: là una view è un pannello con un titolo che si
  // apre e si chiude, qui **è** il contenuto del riquadro, e il titolo è già
  // sulla tab.
  const vistaEl = document.createElement("div");
  vistaEl.className = "pane-view";

  root.append(tabsEl, editorEl, previewEl, vistaEl);
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
      // **La quarta superficie che cerca** (§21.5), e la prima che violava la
      // regola: chiedeva `vociDelVault("document")`, cioè l'elenco intero, e
      // filtrava CodeMirror. Adesso passa dalla porta di tutte le altre —
      // `noteDalNome`, che è `IndexQuery::Documents` con i campi sul nome e il
      // prefisso della §21.2 (0082, 0083).
      //
      // A prefisso vuoto — `[[` appena scritto — si propongono le **recenti**,
      // come nel quick switcher: una domanda al kernel per una query vuota
      // sarebbe l'elenco intero rientrato dalla porta nuova, e un popup vuoto
      // sarebbe un autocompletamento che non parte finché non si indovina la
      // prima lettera. La decisione è la stessa delle due superfici perché la
      // domanda è la stessa; è qui e non in `editor/completions.ts` perché
      // quel modulo non conosce né il vault né la memoria corta.
      cercaNote: (prefisso: string) =>
        (prefisso.trim() ? noteDalNome(prefisso) : noteRecentiEsistenti()).catch(() => []),
      listTags: () => tagDelVault().catch(() => []),
    },
  });
  // Un riquadro nato dopo il tema deve nascere nella luce giusta, non
  // correggersi al primo cambio (§12.4).
  if (tema) editor.setTheme(tema);

  const r: Riquadro = { id, root, tabsEl, editorEl, previewEl, vistaEl, editor, mostrato: null };
  riquadri.set(id, r);
  return r;
}

/// Disegna la striscia delle tab di un riquadro.
function disegnaTab(r: Riquadro, tabs: Tab[], active: number): void {
  r.tabsEl.replaceChildren(
    ...tabs.map((t0, i) => {
      const tab = document.createElement("button");
      tab.className = "tab" + (i === active ? " active" : "");
      tab.setAttribute("role", "tab");
      tab.setAttribute("aria-selected", String(i === active));
      // Il `title` di una tab di documento è il **path intero**, perché due note
      // omonime in cartelle diverse sono il caso in cui il nome non basta. Una
      // view non ha un path: il suo titolo è già tutto ciò che c'è da sapere.
      tab.title = t0.k === "doc" ? t0.doc : nomeTab(t0);

      const nome = document.createElement("span");
      nome.className = "tab-name";
      nome.textContent = nomeTab(t0);
      // Il pallino del non salvato: è l'unica cosa che dica, guardando una tab
      // che non è quella davanti, che lì dentro c'è del lavoro in coda. Una view
      // non ha un buffer, quindi non si sporca.
      if (t0.k === "doc" && buffers.get(t0.doc)?.dirty) tab.classList.add("dirty");
      if (t0.k === "view") tab.classList.add("tab-view");

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
        void congeda(r.id, t0);
      });

      tab.append(nome, chiudi);
      tab.addEventListener("click", () => attivaTab(r.id, i));
      return tab;
    }),
  );
  r.tabsEl.hidden = tabs.length === 0;
  const aperta = active >= 0 ? nomeTab(tabs[active]) : null;
  r.root.setAttribute(
    "aria-label",
    aperta ? t("pane.named", { name: aperta }) : t("pane.empty"),
  );
}

/// Come si chiama una tab.
///
/// Per un documento è il nome della nota; per una view è il **titolo che la view
/// dichiara**, già risolto nella lingua dell'utente dal kernel (0040). Se quella
/// view non è (più) dichiarata — un bundle spento fra due avvii, con la tab
/// rimasta nel file della macchina — resta il suo id: è brutto e non mente, che
/// è l'ordine giusto delle due cose.
function nomeTab(tab: Tab): string {
  return tab.k === "doc" ? titolo(tab.doc) : (viewPrincipale(tab.view)?.title ?? tab.view);
}

/// Il nome di una nota come si legge su una tab: l'ultimo pezzo del path, senza
/// estensione. Il path intero resta nel `title`, perché due note omonime in due
/// cartelle sono il caso in cui la tab da sola non basta.
function titolo(doc: string): string {
  const base = doc.split("/").pop() ?? doc;
  const punto = base.lastIndexOf(".");
  return punto > 0 ? base.slice(0, punto) : base;
}

/// Mette in un riquadro ciò che la sua tab attiva dice, se non c'è già.
///
/// Le due specie di tab accendono due superfici diverse dello stesso riquadro, e
/// il ramo che le distingue sta **qui e basta**: da `disegna` in giù nessuno sa
/// che esistano due specie, e chi cambia tab non deve dire quale.
async function mostra(r: Riquadro, tab: Tab | null): Promise<void> {
  const cambiata = !r.mostrato || !tab || !stessaTab(r.mostrato, tab);
  // Una view che se ne va porta con sé il suo pannello: senza, resterebbe
  // registrata a ridisegnarsi dentro un elemento che nessuno guarda.
  if (cambiata && r.mostrato?.k === "view") smontaVistaDalRiquadro(r.mostrato.view, r.id);
  r.mostrato = tab;
  r.root.classList.toggle("con-vista", tab?.k === "view");

  if (tab?.k === "view") {
    // **Non condizionata a `cambiata`**, ed è voluto: `montaVistaInRiquadro` è
    // idempotente, e chiamarla a ogni giro è ciò che rimette in piedi le view
    // dei riquadri quando `mountDeclaredViews` azzera tutto per un vault nuovo.
    // Con un editor questo giro costerebbe cursore e cronologia; con una view
    // dichiarata costa un `render_view`, che è la stessa cosa che il pannello
    // farebbe da sé al primo evento.
    r.editor.setDoc("");
    clearPreview(r.previewEl);
    await montaVistaInRiquadro(tab.view, r.id, r.vistaEl);
    return;
  }
  if (!cambiata) return;
  if (!tab) {
    r.editor.setDoc("");
    clearPreview(r.previewEl);
    return;
  }
  r.editor.setDoc(await leggiBuffer(tab.doc));
  await ridisegnaLettura(tab.doc);
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
  const { text, revision } = await api.readDocument(doc);
  buffers.set(doc, { text, dirty: false, esito: "ok", echi: 0, base: revision });
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

/// **Ritrova ciò che era rimasto non salvato** (§15.2), all'apertura del vault.
///
/// Il recupero è un buffer **precaricato e sporco**, e non un file riscritto:
/// è la scelta che tiene la decisione all'utente. Il disco resta com'è finché
/// qualcuno non salva, e la nota recuperata si comporta esattamente come una
/// che si stava scrivendo — pallino sulla tab, «Non salvato» nella barra di
/// stato, e i gesti di sempre per tenerla o buttarla. Non serve una superficie
/// nuova per una cosa che la shell sa già disegnare.
///
/// Che sia un buffer e non un dialogo modale ha anche una conseguenza che vale
/// più dell'economia di codice: chi apre il vault e vuole solo leggere qualcosa
/// non viene fermato da una domanda. Il testo c'è, lo trova quando apre quella
/// nota, e nel frattempo la notifica gli dice che c'è.
///
/// Le bozze **superate** — il disco contiene già quel testo, cioè il caso
/// normale dopo una chiusura ordinata — non arrivano fin qui: le toglie
/// `daRecuperare`.
export async function recuperaBozze(): Promise<number> {
  let bozze: DraftInfo[];
  try {
    bozze = daRecuperare(await bozzeNonSalvate());
  } catch {
    // Un recupero che non parte non deve impedire di aprire il vault: è una
    // rete di sicurezza, e una rete che blocca la porta è peggio di nessuna
    // rete. Ciò che non si è letto lo dice il rapporto diagnostico.
    return 0;
  }
  for (const b of bozze) {
    // Solo se nessuno tiene già quel buffer: chi ha già aperto quella nota in
    // questa sessione ha un testo più recente di ciò che stava sul disco.
    if (buffers.has(b.doc)) continue;
    // `b.base` è la revisione da cui quel testo si era discostato, e da questa
    // voce non è più `null` per forza: chi ha scritto la bozza la sapeva
    // (§18.1). Una bozza vecchia, scritta da una sessione che non la sapeva,
    // entra con `null` e riparte cieca — che è ciò che era prima per tutti.
    buffers.set(b.doc, { text: b.text, dirty: true, esito: "ok", echi: 0, base: b.base });
    notify(`${b.doc}: ${t(CHIAVE_CASO[casoDi(b)])}`, "info");
  }
  return bozze.length;
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
  const buf = buffers.get(doc) ?? { text, dirty: false, esito: "ok" as Esito, echi: 0, base: null };
  buf.text = text;
  buf.dirty = true;
  buffers.set(doc, buf);
  for (const altro of paneConDoc(doc)) {
    if (altro === paneId) continue;
    const r = riquadri.get(altro);
    if (r && r.mostrato?.k === "doc" && r.mostrato.doc === doc) r.editor.syncDoc(text);
  }
  // Il pallino del non salvato compare adesso, su ogni tab che mostra questa
  // nota. Ridisegnare le tab a ogni battuta costa poco — sono N pulsanti — e
  // l'alternativa sarebbe un secondo posto che sa quando un buffer si sporca.
  for (const id of paneConDoc(doc)) {
    const r = riquadri.get(id);
    const p = pane(id);
    if (r && p) disegnaTab(r, p.tabs, p.active);
  }
  disegnaSalvataggio();
  scheduleSave(doc);
  scheduleDraft(doc);
}

// --- il buffer di crash (§15.2) ---------------------------------------------
//
// Perché serve, dato che l'autosave scatta dopo 400 ms: perché i 400 ms non sono
// il caso interessante. I casi sono tre, e nessuno dei tre lo copre l'autosave —
// il salvataggio che **fallisce** (disco pieno, file in sola lettura, share di
// rete caduta: il buffer resta sporco a tempo indeterminato, ed è la ragione per
// cui `salvataggio.ts` tiene «fallito» come stato a sé), la nota che non è
// **mai** stata salvata, e la finestra fra l'ultima battuta e la scrittura.
//
// Il debounce è più **lungo** di quello del salvataggio, non più corto, e la
// ragione è che i due non fanno la stessa cosa: il salvataggio è la strada
// normale e va veloce, la bozza è la rete sotto e deve costare poco. Quando il
// salvataggio riesce, la bozza si butta — il disco è di nuovo la verità.
const DRAFT_MS = 1_000;

function scheduleDraft(doc: string): void {
  const buf = buffers.get(doc);
  if (!buf) return;
  window.clearTimeout(buf.draftTimer);
  buf.draftTimer = window.setTimeout(() => void writeDraft(doc), DRAFT_MS);
}

/// Mette la bozza sul disco. Non racconta il proprio fallimento all'utente, ed è
/// una scelta: è una rete di sicurezza che gira di fianco al lavoro vero, e un
/// avviso per ogni bozza non scritta insegnerebbe a ignorare gli avvisi — che è
/// il difetto che `cambioSotto` esiste per non avere. Chi vuole saperlo lo trova
/// nel rapporto diagnostico.
async function writeDraft(doc: string): Promise<void> {
  const buf = buffers.get(doc);
  if (!buf?.dirty) return;
  try {
    // La base c'è davvero, da questa voce: la 0088 aveva dovuto lasciarla a
    // `null` perché la shell non aveva modo di dire da cosa il buffer si fosse
    // discostato — e ricalcolarla di qua sarebbe stata una seconda
    // implementazione dell'impronta, cioè una seconda verità. Adesso la porta
    // il documento quando lo si apre.
    await api.saveDraft(doc, buf.text, buf.base);
  } catch {
    // Volutamente muto: vedi sopra.
  }
}

/// La bozza non serve più: il disco è tornato a essere la verità.
async function dropDraft(doc: string): Promise<void> {
  const buf = buffers.get(doc);
  if (buf) window.clearTimeout(buf.draftTimer);
  try {
    await api.discardDraft(doc);
  } catch {
    // Muto per la ragione di `writeDraft`.
  }
}

/// Lo stato del salvataggio **del documento che si sta guardando**, nella barra
/// di stato.
///
/// Lì e non sulla tab, perché la tab ha già il pallino del non salvato e ha
/// spazio per una parola sola: il pallino dice *quale* nota ha qualcosa da
/// scrivere, questa riga dice *cosa le è successo*. E lì e non in un pannello,
/// perché è l'unica superficie della shell che c'è sempre e che non chiede di
/// essere aperta.
///
/// Se la shell non ha quell'elemento — un test, un host che monta un pezzo solo
/// — non succede niente: come per `notify`, il fatto non dipende dal suo disegno.
function disegnaSalvataggio(): void {
  const el = document.getElementById("save-state");
  if (!el) return;
  const doc = docAttivo();
  const stato = doc ? statoDi(buffers.get(doc)) : null;
  if (!stato) {
    el.textContent = "";
    delete el.dataset.stato;
    return;
  }
  el.dataset.stato = stato;
  el.textContent = t(CHIAVE_STATO[stato]);
}

const CHIAVE_STATO = {
  salvato: "save.saved",
  in_corso: "save.saving",
  non_salvato: "save.unsaved",
  fallito: "save.failed",
  conflitto: "save.conflitto",
} as const;

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

/// Scrive il buffer su disco, e **dice com'è andata** (§20.4).
///
/// Prima di questa voce la scrittura era una riga sola senza `catch`, invocata
/// da un `setTimeout`: un vault in sola lettura, un disco pieno, un file tenuto
/// da un'altra app rifiutavano la scrittura, la promise veniva rigettata in un
/// contesto senza gestore, e nella finestra non cambiava niente. Si continuava a
/// scrivere per un'ora dentro una nota che nessuno stava scrivendo su disco.
///
/// Adesso il fallimento ha due destinazioni, e servono tutte e due: un avviso,
/// che interrompe una volta, e lo **stato** accanto al documento, che resta.
/// L'avviso da solo lo si perde girandosi dall'altra parte; lo stato da solo non
/// si guarda finché non si ha già il sospetto.
///
/// Non rilancia, e non è una svista: il chiamante è un `setTimeout` che non ha
/// dove prenderlo. Chi ha bisogno di sapere se il disco ha ricevuto il testo —
/// `flushDoc`, cioè chi sta per far riscrivere quel file al kernel — legge
/// l'esito dal buffer, che è il posto dove adesso l'esito c'è.
async function saveDoc(doc: string): Promise<void> {
  const buf = buffers.get(doc);
  if (!buf) return;
  const text = buf.text;
  buf.esito = "in_corso";
  disegnaSalvataggio();
  let prodotta: string;
  try {
    // La base viaggia con la scrittura: se il file non è più quello da cui
    // questo buffer è partito, il kernel risponde `conflict` e **non scrive
    // niente** (§18.1).
    prodotta = await api.writeDocument(doc, text, buf.base);
  } catch (e) {
    // Un conflitto non è un disco pieno, ed è la ragione per cui questo ramo è
    // suo (0041 ha reso la specie interrogabile proprio per poterlo fare). Il
    // secondo si riprova — e la battuta dopo ci riprova da sola. Il primo no:
    // riprovare è la sovrascrittura che la guardia ha appena impedito, e ciò
    // che manca non è un tentativo ma una decisione, che è dell'utente.
    if (esitoDelFallimento(e) === "conflitto") {
      buf.esito = "conflitto";
      notify(t("document.save_conflict", { doc }), "guasto");
      // Come per il fallimento: il testo è solo in RAM finché la decisione non
      // è presa, e la rete si stende adesso invece che al debounce.
      window.clearTimeout(buf.draftTimer);
      void writeDraft(doc);
      disegnaSalvataggio();
      return;
    }
    buf.esito = "fallito";
    notify(t("document.save_failed", { doc, reason: errorText(e) }), "guasto");
    // **Qui la bozza conta più che altrove**, ed è il caso per cui esiste: il
    // disco ha appena rifiutato questo testo, quindi l'unica copia è in RAM.
    // Non si aspetta il debounce — si scrive adesso.
    window.clearTimeout(buf.draftTimer);
    void writeDraft(doc);
    // Il buffer resta sporco: è la verità del documento, e il tentativo
    // successivo — la battuta dopo, o il flush di una rinomina — riparte da qui.
    disegnaSalvataggio();
    return;
  }
  buf.esito = "ok";
  // Il disco adesso è questo testo: la scrittura dopo riparte da qui. È ciò che
  // rende la guardia una catena invece di un controllo alla prima battuta —
  // senza, il secondo salvataggio nominerebbe una base ormai vecchia e
  // fallirebbe contro sé stesso.
  buf.base = prodotta;
  // La scrittura è arrivata sul disco: il `document_changed` che ne segue è
  // nostro, e chi lo riceve non deve raccontarlo come se fosse di qualcun altro.
  buf.echi += 1;
  // Pulito solo se nel frattempo non è arrivato altro input: `dirty` è stato
  // rimesso a true da `scritto` se l'utente ha continuato a scrivere.
  if (buf.text === text) {
    buf.dirty = false;
    // Il testo è sul disco: la rete si può togliere. Solo se il buffer è
    // davvero pulito — chi ha continuato a battere durante la scrittura ha una
    // bozza che vale ancora.
    void dropDraft(doc);
  }
  disegnaSalvataggio();
  for (const id of paneConDoc(doc)) {
    const r = riquadri.get(id);
    const p = pane(id);
    if (r && p) disegnaTab(r, p.tabs, p.active);
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
/// Qualcuno ha riscritto il file **sotto un buffer sporco**: dirlo, se c'è
/// davvero qualcuno.
///
/// Due casi e due toni, ed è la ragione per cui la 0012 distingue l'origine: se
/// ha scritto un'ALTRA APP il lavoro che il buffer sta per coprire non è nostro
/// e non lo possiamo rifare — è un guasto; una riscrittura del kernel o di un
/// plugin la si riottiene rifacendo l'operazione, e informa. Fino al §20.4 la
/// diagnosi era giusta, completa, e andava in un posto che non ha lettori.
///
/// **E c'è un terzo caso, che non è nessuno dei due**: l'eco del nostro
/// salvataggio. Scrivere `issues.md` e continuare a battere durante i 400 ms del
/// debounce produce, ogni volta, un `document_changed` di origine `user` su un
/// buffer tornato sporco — cioè la frase «il file è cambiato sotto di te» detta
/// del file che contiene esattamente ciò che abbiamo appena scritto noi. È
/// sempre stata emessa; finché finiva in `console` nessuno l'ha vista, e il
/// §20.4 l'ha portata sullo schermo tre volte di fila. Un avviso che compare
/// quando non è successo niente non è un avviso in più: è ciò che insegna a
/// ignorare gli altri tredici.
function avvisaSeIlBufferCopre(id: string, daFuori: boolean): void {
  const buf = buffers.get(id);
  switch (cambioSotto(buf, daFuori)) {
    case "muto":
      return;
    case "eco":
      // Consumato: la scrittura successiva ne metterà un altro.
      buf!.echi -= 1;
      return;
    case "altra_app":
      notify(t("document.overwritten", { doc: id }), "guasto");
      return;
    case "riscrittura":
      notify(t("document.changed_on_disk", { doc: id }), "info");
  }
}

/// Ricarica un documento dal disco, ma solo se non ha modifiche non salvate.
///
/// Non dice niente: chi è arrivato da un evento sa l'origine e ha già parlato
/// (`avvisaSeIlBufferCopre`), e chi è arrivato da una riconciliazione — un
/// `overflow`, un ripristino di versione — non sa **chi** abbia scritto e non ha
/// niente da raccontare. Prima l'avviso stava qui, e quelle due strade lo
/// facevano partire senza un'origine da cui dedurne il tono.
async function reloadIfClean(id: string): Promise<void> {
  const buf = buffers.get(id);
  if (buf?.dirty) return;
  const { text: source, revision } = await api.readDocument(id);
  const attuale = buffers.get(id);
  if (!attuale || attuale.dirty) return;
  // La base segue il testo, e si aggiorna **prima** dell'uscita anticipata: un
  // buffer pulito il cui testo coincide già col disco non ha niente da
  // ricaricare, ma può benissimo non sapere da cosa discende — ed è il caso di
  // chi ha appena scelto di sovrascrivere comunque.
  attuale.base = revision;
  // Evita il reset del cursore quando l'evento è l'eco del nostro salvataggio.
  if (attuale.text === source) return;
  attuale.text = source;
  for (const paneId of paneConDoc(id)) {
    const r = riquadri.get(paneId);
    // `syncDoc` e non `setDoc`: il documento è lo stesso, è cambiato il testo
    // sotto — e chi lo sta guardando non deve perdere il punto in cui era.
    if (r && r.mostrato?.k === "doc" && r.mostrato.doc === id) r.editor.syncDoc(source);
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
