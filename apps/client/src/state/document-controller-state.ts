// Il gestore del documento (`document-controller.ts`): lo stato di modulo che
// i suoi pezzi leggono (riquadri, dipendenze, vista, registro delle superfici).

import { type DocumentSurfaceRegistry, type EditorSurface, type SourceView } from "../editors/core/registry";
import { type Theme } from "../theme/theme";
import type { CardNotices } from "../editors/core/cards/editor-port";
import { type LayoutNode, type Tab } from "./layout";

export interface DocumentDeps {
  /// Click su un `#tag` nella vivi preview. Iniettato invece che importato:
  /// il pannello della ricerca apre i documenti, e questo li possiede — se si
  /// importassero a vicenda sarebbe un ciclo.
  searchTag(tag: string): void;
  /// Esegue un comando come la tastiera e la palette: per i pulsanti della
  /// barra di formattazione che non sono azioni dell'editor.
  runCommand(id: string): void;
  /// Apre le impostazioni sul gruppo della riga `key`: la scheda di un file
  /// Craft ci rimanda per il consenso e il peso massimo.
  openSettings?(key: string): void;
}

/// I tre elementi di un riquadro che il controller tiene. Glieli dà la vista
/// quando il riquadro nasce, e restano della vista: il controller ci monta
/// dentro, non li ricrea e non li toglie dalla pagina.
export interface PaneElements {
  /// La radice del riquadro. Il controller ci scrive `data-mode` — la modalità
  /// della superficie montata —, ci applica le classi che la nota dichiara in
  /// `cssclasses` e le dà il fuoco quando il riquadro resta senza linguette.
  root: HTMLElement;
  /// Dove si monta la superficie del documento. Il controller lo svuota quando
  /// la superficie se ne va, e ci ascolta trascinamenti, rilasci e incolla.
  editorEl: HTMLElement;
  /// Dove si monta una view dichiarata che il riquadro ospita (§3.3).
  viewEl: HTMLElement;
}

/// Ciò che il controller chiede a chi disegna la cornice dei riquadri.
///
/// È la sola strada dal controller alla vista. Ogni chiamata arriva nel punto
/// in cui prima c'era il disegno, in sincrono, e nessuna restituisce una
/// promessa: la vista non fa aspettare la sequenza. Il verso opposto è libero —
/// la vista importa dal controller ciò che i suoi gesti chiedono
/// (`synchronize`, `releaseTab`, `closeTabAt`, `setMode`, …) e legge lo stato
/// di un riquadro da `paneOf`, senza scriverlo.
export interface PaneView {
  /// La vista trova il suo posto nella pagina. Una volta per montaggio, dopo
  /// il registro delle superfici e prima dell'iscrizione agli eventi di
  /// sessione; se il posto non c'è lancia, e il montaggio si ferma lì.
  attach(): void;
  /// La cornice di un riquadro nuovo, non ancora nella pagina. Una volta per
  /// id, da `renderPane`, finché `removePane` non la dimentica.
  createPane(id: string): PaneElements;
  /// Scioglie ciò che la cornice possiede oltre ai nodi — ascoltatori,
  /// iscrizioni, barre — senza toglierla dalla pagina.
  releaseFrame(pane: Pane): void;
  /// Toglie la radice dalla pagina e dimentica la cornice. Non scioglie ciò
  /// che scioglie `releaseFrame`: chi vuole le due cose le chiama in fila.
  removePane(pane: Pane): void;
  /// Dispone l'albero dei riquadri nella pagina. La radice di ogni foglia si
  /// chiede a `renderPane(id).root`, che crea il riquadro se è nuovo. Arriva
  /// soltanto quando la struttura è cambiata, dopo che i riquadri usciti
  /// dall'albero sono stati smontati.
  layoutTree(tree: LayoutNode): void;
  /// La striscia delle linguette di un riquadro, e il nome del riquadro.
  drawTabs(pane: Pane, tabs: Tab[], active: number): void;
  /// Il riquadro ha, o non ha, il fuoco del layout.
  drawFocus(pane: Pane, focused: boolean): void;
  /// Il riquadro mostra una view dichiarata al posto dell'editor, o l'editor.
  /// Arriva a ogni giro di disegno, prima che la superficie sia montata.
  drawViewSurface(pane: Pane, shown: boolean): void;
  /// La barra del riquadro: percorso, cronologia e modalità della superficie
  /// montata adesso (`pane.surface`, `selectedMode(pane)`).
  drawToolbar(pane: Pane): void;
  /// Il banner del conflitto per il documento attivo del riquadro, o niente.
  drawConflict(pane: Pane, doc: string | null): void;
  /// Lo stesso banner dentro una scheda della lavagna che scrive nel
  /// documento (N6 T41): in `box`, o `box` vuoto e nascosto.
  drawCardConflict(box: HTMLElement, doc: string): void;
  /// Gli avvisi del documento dentro una scheda della lavagna che ci scrive
  /// (N6 T96), quelli di un riquadro, in `box`; `drawn` dopo ogni disegno.
  drawCardNotices(box: HTMLElement, doc: () => string, drawn: () => void): CardNotices;
  /// Lo stato del salvataggio del documento col fuoco. Senza un posto dove
  /// scriverlo non fa niente.
  drawSave(): void;
  /// Porta il fuoco della tastiera sulla linguetta a quell'indice.
  focusTab(pane: Pane, index: number): void;
  /// La linguetta col fuoco della tastiera, se il fuoco è su una linguetta: è
  /// quella su cui agiscono i comandi di tab.
  focusedTab(): { pane: string; index: number } | null;
  /// Dove si monta il registratore del riquadro.
  recorderHost(pane: Pane): HTMLElement;
  /// Il riquadro «solo come file» di un file il cui componente è spento (K2):
  /// disegna `file` dentro `host`, che sta già nel riquadro. Arriva di nuovo a
  /// ogni cambio (la dimensione letta, «Accendi …» in corso, un rifiuto).
  drawFileOnly(pane: Pane, host: HTMLElement, file: FileOnly): void;
  /// Il foglio del riquadro, sopra la cui destra si apre la sbirciata (T20).
  peekHost(pane: Pane): HTMLElement;
}

/// Ciò che il riquadro «solo come file» mostra e i suoi due gesti.
export interface FileOnly {
  readonly doc: string;
  /// Il nome del file, con l'estensione.
  readonly name: string;
  /// La dimensione già scritta per chi legge, o `null` finché non si sa.
  readonly size: string | null;
  /// Il nome del componente spento, già nella lingua del vault; `null` se la
  /// mappa non ne nomina uno da accendere.
  readonly component: string | null;
  /// «Accendi …» è in corso.
  readonly busy: boolean;
  /// Un rifiuto o un errore dell'ultimo «Accendi …», da leggere nel riquadro.
  readonly problem: string | null;
  switchOn(): void;
  openOutside(): void;
}

/// Un riquadro **a schermo**: la sua parte di DOM, il suo editor, e quale
/// documento l'editor sta effettivamente mostrando.
///
/// `mostrato` non è ridondante con lo stato del layout: è ciò che c'è *adesso*
/// nell'editor, e serve a sapere quando caricare — senza, ogni giro di disegno
/// riscriverebbe il documento nell'editor e porterebbe via cursore e
/// cronologia.
export interface Pane {
  id: string;
  root: HTMLElement;
  editorEl: HTMLElement;
  /// Dove finisce una view dichiarata che questo riquadro sta ospitando (§3.3).
  /// Vuoto quasi sempre: è la seconda superficie di un riquadro, accanto
  /// all'editor, e come lui c'è anche quando non si vede.
  viewEl: HTMLElement;
  disposeAttachments: (() => void) | null;
  disposeRecorder: (() => void) | null;
  disposeSlides: (() => void) | null;
  disposePrint: (() => void) | null;
  noteClassGeneration: number;
  surface: EditorSurface | null;
  /// Cosa c'è **adesso** in questo riquadro. Una linguetta e non un path: dalla §3.3
  /// può essere una view, e sapere quale evita di rimontarla a ogni giro.
  shown: Tab | null;
  loadGeneration: number;
  /// Il disposer della registrazione di questo riquadro alla sessione del
  /// documento mostrato. Null finché il documento mostrato non c'è.
  disposeSurface: (() => void) | null;
  /// La vista sorgente che la superficie del documento mostrato dichiara
  /// (ADR 0203), risolta quando il documento si è letto: è ciò che «Apri come
  /// sorgente» apre, e ciò contro cui si controlla una scelta già fatta.
  /// Null senza documento, prima della lettura, o se non ce n'è una.
  sourceView: SourceView | null;
  /// Il documento mostrato si è montato dai byte (un'immagine, un PDF, un
  /// RAW), e non dal suo testo. Quando l'elenco dei comandi cambia, un
  /// riquadro il cui documento ha cambiato legame coi byte si rimonta.
  bytes: boolean;
  /// Le superfici delle schede aperte ma non attive, dalla meno recente:
  /// nascoste, non smontate (`parkSurface`). Tornare su una di quelle la
  /// rimostra invece di ricostruire l'editor.
  parked: ParkedSurface[];
  /// Una rinomina che rimonta la superficie mostrata (`followRenameInPanes`)
  /// mentre aveva il fuoco: il nome nuovo e il cursore in byte, se la
  /// superficie lo diceva. Il montaggio nuovo li riprende
  /// (`restoreRenameCaret`); il giro di disegno lo dimentica comunque.
  renameCaret: { readonly doc: string; readonly at: number | null } | null;
}

/// La superficie di una scheda che il riquadro tiene da parte mentre ne
/// mostra un'altra: una nota (Markdown o testo semplice) o una superficie che
/// lo dichiara (`EditorSurface.parking`, il foglio di Excel).
///
/// Ricostruire l'editor a ogni cambio di scheda costava il montaggio di un
/// `EditorView` nuovo, il testo rimesso da capo e, per una nota lunga, il
/// parser rifatto per tutto il documento: la parte più grande del cambio
/// scheda. Una superficie tenuta da parte è **staccata dalla sessione**
/// (`detachSurface`, che prima registra ciò che teneva in sospeso) e sta
/// dentro un contenitore suo, nascosto, che non si sposta mai:
/// nascosto e non tolto dal documento perché è così che il motore del browser
/// conserva lo scorrimento. Al ritorno si riattacca alla sessione e, se il
/// testo nel frattempo è cambiato (un altro riquadro, il disco), lo riceve
/// con `syncDoc`, come ogni aggiornamento venuto da fuori: cursore, scorrimento
/// e cronologia locale restano quelli della scheda.
///
/// Ogni superficie ha il suo contenitore perché la superficie scrive sul suo
/// genitore (la modalità, le interruzioni di riga) e ci ascolta eventi (copia,
/// tasti): due superfici nello stesso genitore si pesterebbero. Il contenitore
/// a riposo non porta la classe `pane-editor`, così chi cerca «la superficie
/// del riquadro» (i fogli, il CSS, le prove) trova soltanto quella attiva.
///
/// Le regole, oltre a quelle del testo:
/// - il file che cambia revisione mentre la superficie è da parte (un
///   salvataggio, un'altra app) arriva al ritorno con `syncDoc` anche se il
///   testo della sessione è lo stesso: il foglio riapre la sua sessione
///   dell'host sui byte nuovi, come quando è in vista (`base`);
/// - una modifica che una superficie da parte finisce di scrivere dopo lo
///   stacco (la conferma di una formula) va al suo documento, che la
///   superficie nomina (`written`);
/// - componenti accesi o spenti, un vault chiuso o cambiato, un riquadro
///   chiuso, una scheda chiusa smontano la superficie da parte
///   (`dropParked`, `pruneParked`), e con lei la sessione dell'host;
/// - le superfici da parte di un riquadro pesano al più `MAX_PARKED`.
export interface ParkedSurface {
  readonly tab: Extract<Tab, { k: "doc" }>;
  readonly surface: EditorSurface;
  readonly host: HTMLElement;
  readonly sourceView: SourceView | null;
  /// Quanto pesa fra le superfici da parte del riquadro (`parkingWeight`).
  readonly weight: number;
  /// La revisione dei byte da cui il testo della sessione discendeva quando
  /// la superficie è andata da parte.
  readonly base: string | null;
  /// Il tema che la superficie ha ricevuto per ultimo: al ritorno si rimette
  /// soltanto se nel frattempo è cambiato.
  theme: Theme | null;
  /// Il documento si è salvato mentre era da parte: una lettura resa va
  /// ridisegnata al ritorno (`redrawReading`).
  redraw: boolean;
}

/// Quanto pesano al più le superfici che un riquadro tiene da parte. Una nota
/// di 5.000 righe con il suo albero sintattico pesa qualche MB e conta uno;
/// un foglio tiene anche la sua cartella aperta nell'host e conta di più
/// (`EditorSurface.parking`). Oltre, la meno recente si smonta, e tornarci la
/// ricostruisce come prima.
export const MAX_PARKED = 4;

/// La classe del contenitore di una superficie a riposo (vedi `ParkedSurface`).
export const PARKED_HOST = "pane-editor-riposo";

export const panes = new Map<string, Pane>();
export let sessionEventsStop: (() => void) | undefined;
export let deps: DocumentDeps;
/// La vista arriva al montaggio. Prima c'è questa, che non disegna: lo stato
/// del salvataggio non ha dove scriversi — capita a un recupero di bozze
/// chiesto mentre la shell sta ancora nascendo, e lo disegna il primo giro di
/// `render` — e nessuna linguetta ha il fuoco. Il resto riguarda riquadri che
/// senza una vista non esistono: chi ci arriva ha saltato il montaggio.
export let view: PaneView = {
  attach: unmounted,
  createPane: unmounted,
  releaseFrame: unmounted,
  removePane: unmounted,
  layoutTree: unmounted,
  drawTabs: unmounted,
  drawFocus: unmounted,
  drawViewSurface: unmounted,
  drawToolbar: unmounted,
  drawConflict: unmounted,
  drawCardConflict: (box) => {
    box.replaceChildren();
    box.hidden = true;
  },
  drawCardNotices: (box) => {
    box.replaceChildren();
    box.hidden = true;
    return { redraw: () => {}, dispose: () => {} };
  },
  drawSave: () => {},
  focusTab: unmounted,
  focusedTab: () => null,
  recorderHost: unmounted,
  drawFileOnly: unmounted,
  peekHost: unmounted,
};
export let surfaceRegistry: DocumentSurfaceRegistry;

/// Il montaggio (`mountDocumentController`) dà al gestore le sue dipendenze e
/// la vista dei riquadri: lo stato si assegna soltanto qui.
export function bindController(d: DocumentDeps, v: PaneView): void {
  deps = d;
  view = v;
}

/// Il registro delle superfici, creato dal montaggio.
export function setSurfaceRegistry(registry: DocumentSurfaceRegistry): void {
  surfaceRegistry = registry;
}

/// Chi smette di ascoltare gli eventi delle sessioni, dato dal montaggio.
export function setSessionEventsStop(stop: (() => void) | undefined): void {
  sessionEventsStop = stop;
}

function unmounted(): never {
  throw new Error("The pane view is not mounted");
}

/// Il riquadro a schermo con questo id, per chi lo disegna: lo si legge, non
/// lo si scrive.
export function paneOf(id: string): Pane | undefined {
  return panes.get(id);
}
