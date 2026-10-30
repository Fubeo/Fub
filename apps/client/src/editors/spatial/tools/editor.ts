// L'editor del disegno: una barra e il foglio. Tiene insieme ciò che i
// pacchetti precedenti hanno costruito — il motore delle operazioni, il
// painter e lo strato sopra, la pipeline della penna, la camera condivisa — e
// ci mette sopra gli strumenti.
//
// Sta in pezzi, uno per responsabilità, sotto `editor/`: ognuno è una
// funzione `installX(ctx)` che lavora su un contesto comune
// (`editor/context.ts`). Un pezzo prende dal contesto ciò che hanno dato i
// pezzi montati prima di lui, e ci mette ciò che dà agli altri, dichiarato
// nella sua interfaccia `XContext`. Lo stato che più pezzi cambiano si legge
// e si scrive sul contesto, come `ctx.camera` e `ctx.selection`; le
// funzioni e le costanti restano nomi semplici. I pezzi si montano
// nell'ordine qui sotto, e una funzione di un pezzo che viene dopo si chiama
// dal contesto, quando il montaggio è finito.
//
// Le regole:
//
// - **Il livello filtra.** La barra e i tasti sono quelli del livello
//   (`registry.ts`), che cambia dal vivo: ciò che sale compare, ciò che scende
//   sparisce, e il documento resta com'è. L'Essenziale è una barra sola,
//   senza pannelli.
// - **Ogni segno il suo inchiostro.** La penna e le forme condividono colore
//   e spessore; l'evidenziatore ha i suoi, giallo e largo, e li ritrova quando
//   lo si riprende, e con Maiusc tira un tratto dritto. La copertura di un PDF
//   ha il suo colore, il nero. Dal livello Standard un colore si sceglie anche
//   a piacere, e resta come campione in più accanto alla tavolozza.
// - **Un gesto, un'operazione.** Ogni strumento lavora sull'anteprima finché
//   il puntatore è giù e scrive una volta sola quando si alza: il tratto
//   sullo strato sopra, la forma su un livello di anteprima con gli stessi
//   attributi che scriverà, lo spostamento e la gomma come bozza del painter
//   sui nodi della scena. Un gesto annullato non scrive niente.
// - **Una pipeline per tutti.** Ogni strumento riceve i punti dalla stessa
//   pipeline della penna, così il palmo non seleziona e non cancella, e due
//   dita muovono la vista con qualunque strumento.
// - **Lo stesso dato.** Selezione e gomma toccano gli oggetti con l'indice di
//   `hit.ts`, costruito sugli stessi nodi che il painter disegna.
// - **Annunci.** Una regione live dice creazione, eliminazione, selezione,
//   cambio di strumento e ciò che non si è potuto fare.
// - **Tutto da tastiera.** Ogni strumento ha la sua lettera, e funziona anche
//   senza puntatore: le frecce muovono un cursore sul foglio e Spazio preme e
//   rilascia, coi gesti della stessa pipeline. Con una selezione le frecce la
//   spostano, con Ctrl o ⌘ la ridimensionano, Tab passa all'oggetto dopo e
//   Invio apre le proprietà con i numeri; senza selezione Tab esce dal
//   foglio, che non trattiene mai il fuoco. «?» elenca i tasti.
// - **L'albero degli oggetti** è il disegno come elenco (`objects.ts`), con la
//   stessa selezione del foglio; i nomi vengono da `describe.ts`.
// - **Moto ridotto per costruzione.** La camera non si anima mai: ogni
//   inquadratura è immediata, quindi non c'è moto da ridurre.
// - **Disporre.** Dal livello Standard, con una selezione, una barra in cima
//   al foglio duplica, raggruppa e separa, cambia l'ordine e allinea
//   (`arrange.ts`); Alt+F10 ci porta il fuoco, Esc lo riporta al foglio.
//   Ogni comando è un passo di annulla, e la selezione segue ciò che ha
//   fatto: le copie, il gruppo, i figli.
// - **Livelli.** Dal livello Standard si disegna nel livello corrente, che un
//   pulsante della barra mostra e un menu sceglie, crea e cambia
//   (`layers.ts`); scegliere oggetti di un livello solo lo rende corrente. Un
//   livello corrente bloccato o nascosto non riceve niente, e lo si dice.
//   Sotto lo Standard il disegno va nel livello più alto che si vede e non è
//   bloccato.
// - **Griglia e pagina.** Dal livello Standard il pulsante «Pagina e griglia»
//   mostra la griglia, ne accende l'aggancio e ne sceglie il passo
//   (`grid.ts`), e adatta la pagina al disegno. La griglia aiuta la vista e
//   non entra nel file. Con l'aggancio vanno sulla griglia le forme, gli
//   spostamenti, le copie, le immagini incollate e il cursore. Ctrl o ⌘,
//   tenuto durante un gesto del puntatore, lo sospende.
// - **Righelli e guide.** Dal livello Standard i righelli stanno sui bordi
//   del foglio, nell'unità del documento (`fub:units`), e segnano la pagina,
//   la selezione e il puntatore (`rulers.ts`). Da un righello si tira una
//   guida, che entra nel file (`fub:guides`): con lo strumento Selezione la
//   si sposta, riportata su un righello se ne va, e ciò che si muove ci si
//   aggancia. «Guide…» le scrive coi numeri (`guide-dialog.ts`). L'unità
//   vale per i righelli, i campi, le misure e gli annunci; il disegno resta
//   in unità della scena.
// - **Immagini incollate.** Un'immagine incollata o trascinata sul foglio
//   entra nel file come data URI (`images.ts`): il disegno resta un file
//   solo. Oltre il peso massimo l'editor propone di ridurla.
// - **Immagini del vault.** Dal livello Standard Ctrl+I, o «Immagine dal
//   vault…», mette nel disegno un'immagine del vault che sceglie chi monta
//   l'editor: entra per riferimento, col percorso relativo al disegno, dove
//   entrerebbe incollata. Il foglio la mostra con l'URL che chi monta
//   l'editor apre (`images`).
// - **Testo.** Dal livello Standard lo strumento Testo scrive dove si tocca,
//   in un campo sopra il foglio, col carattere, il corpo, il colore e la
//   trasformazione del testo, così ciò che si scrive sta dove resterà
//   (`text.ts`). Lo stesso campo cambia un testo che c'è: col tocco dello
//   strumento, col doppio tocco della selezione, o con F2. Il testo si scrive
//   quando il campo si chiude, in un passo di annulla solo.
// - **Nodi.** Dal livello Esperto lo strumento Nodi modifica un tracciato
//   dell'oggetto scelto (`nodes.ts`): si trascinano un nodo coi suoi
//   compagni scelti, una maniglia o un punto di un segmento, e un riquadro
//   sceglie più nodi. Una barra in cima al foglio, al posto di quella della
//   selezione, aggiunge, elimina, cambia tipo, spezza e unisce, coi tasti di
//   Inkscape; Tab passa di nodo in nodo e le frecce spostano quelli scelti.
//   Ogni modifica riscrive il `d` intero, in un passo di annulla.
// - **Collegamenti.** Dal livello Standard Ctrl+K collega gli oggetti scelti
//   a una nota del vault, che sceglie chi monta l'editor, o porta a un'altra
//   nota il collegamento scelto; Ctrl+Maiusc+K lo toglie (`arrange.ts`). A
//   ogni livello un segno sull'angolo di ogni collegamento ne apre la nota,
//   con lo strumento Selezione o quando il disegno non si scrive, e Alt+Invio
//   apre quella del collegamento scelto.
// - **Selezione avanzata.** Dal livello Standard il Lazo (`q`) sceglie ciò
//   che racchiude per intero; Ctrl o ⌘ col clic sceglie dentro i gruppi, e
//   il doppio clic su un gruppo lo isola: il resto si attenua e non si
//   sceglie, una barra in fondo al foglio dice dove si è ed Esc esce, un
//   gruppo alla volta. Isolare non cambia il file. Un menu, anche col tasto
//   destro, sceglie i simili, inverte la selezione, blocca e nasconde gli
//   oggetti uno per uno, e li sblocca e li mostra tutti (`selecting.ts`).
//
// La superficie che lo monta nella shell gli passa il motore del
// documento e riceve ogni modifica con `onChange`; una sincronizzazione da
// un'altra superficie arriva con `setEngine`, e annulla e ripeti restano.
//
// Le annotazioni di un PDF montano lo stesso editor col profilo `pdf` e un
// **foglio** (`DrawSheet`): una pagina alla volta, col PDF sotto, e solo i
// gruppi di quella pagina si disegnano e si toccano. Il foglio dice dove
// nasce un oggetto — nel gruppo della pagina, che nasce col primo — e che
// cosa ogni gesto aggiunge in coda: il legame col PDF. La pagina non si
// allarga. Il profilo ha i suoi strumenti, la nota e la copertura comprese, e
// nessuno dei comandi dei livelli; Invio aggiunge al cursore ciò che lo
// strumento disegna, o cambia la nota scelta, e PagSu e PagGiù cambiano
// pagina.

import type { Lifetime } from "../../../ui/lifetime";
import type { TextOperation } from "../../core/text-operation";
import type { FontNotes, VaultFontPort } from "../fonts/vault";
import type { TouchPolicy } from "../../../ink/input/roles";
import type { SavedPen } from "../../../ink/pens";
import type { ContainerNode, DocumentModel } from "../scene/model";
import type { SceneEngine } from "../scene/engine";
import { ROOT, type Op } from "../scene/ops";
import { IDENTITY, type Matrix } from "../scene/matrix";
import type { SceneOverlay } from "../painter/overlay";
import type { Camera } from "../../../spatial/camera";
import type { View } from "../view";
import type { DrawKey } from "../strings";
import type { Page } from "../painter/paint";
import { NewIds, type Destination } from "./edit";
import type { SectionId } from "./properties";
import type { Grid } from "./grid";
import { SceneIndex } from "./hit";
import type { Suggested } from "./suggestions";
import { exportBox, type ExportScene } from "./export-plan";
import type { ImageCodec } from "./images";
import { RECENT_COLORS } from "./palette";
import type { Feature, Level, ToolId, ToolProfile, Workspace } from "./registry";
import { checkedGrid } from "./editor/helpers";
import type { EditorContext } from "./editor/context";
import type { DrawChrome } from "./editor/chrome/hosts";
import { installState } from "./editor/state";
import { installBare } from "./editor/chrome/bare";
import { installOutline } from "./editor/chrome/outline";
import { installCommandSearch } from "./editor/chrome/command-search";
import { installStatus, type DrawStatus } from "./editor/chrome/status";
import { installToolbar } from "./editor/toolbar";
import { installBars } from "./editor/bars";
import { installStage } from "./editor/stage";
import { installView } from "./editor/view";
import { installMarks } from "./editor/marks";
import { installTree } from "./editor/tree";
import { installPanel } from "./editor/panel";
import { installStyling } from "./editor/styling";
import { installControls } from "./editor/controls";
import { installOperations } from "./editor/operations";
import { installTooling } from "./editor/tooling";
import { installGuideDrag } from "./editor/guide-drag";
import { installPenSymmetry } from "./editor/pen-symmetry";
import { installBoardTool } from "./editor/board-tool";
import { installDropperTool } from "./editor/dropper-tool";
import { installNib } from "./editor/nib";
import { installReplay, type ReplaySpeed } from "./editor/replay";
import { installRuler } from "./editor/ruler-ink";
import { installGradientTool } from "./editor/gradient-tool";
import { installGradientGesture } from "./editor/gradient-gesture";
import { installInkGestures } from "./editor/ink-gestures";
import { installInserts } from "./editor/inserts";
import { installShapesConnector } from "./editor/shapes-connector";
import { installCurvatureTool } from "./editor/curvature-tool";
import { installTextTool } from "./editor/text-tool";
import type { DrawCommand } from "./editor/chrome/commands";
import { installCommands } from "./editor/chrome/commands";
import { installNavigator } from "./editor/chrome/navigator";
import { installWorkspace } from "./editor/chrome/workspace";
import { installHandZoom } from "./editor/hand-zoom";
import { installInput } from "./editor/input";
import { installArranging } from "./editor/arranging";
import { installSelectionCommands } from "./editor/selection-commands";
import { installImageCommands } from "./editor/image-commands";
import { installLayersGrid } from "./editor/layers-grid";
import { installKeys } from "./editor/keys";
import { installClipboardCommands } from "./editor/clipboard-commands";
import { installVaultImages } from "./editor/vault-images";
import { installLife } from "./editor/life";
import { installTextProof, type DrawProof } from "./editor/text-proof";
export { DRAW_SCALE_LIMITS } from "./editor/constants";

/// Una modifica del testo fatta da questa superficie, nella forma di
/// `EditorChange` (operazioni sulla scena, §6).
export interface DrawChange {
  /// Il testo grezzo di dopo, coi terminatori del file.
  readonly text: string;
  /// Le modifiche sul testo a LF di prima.
  readonly operation: TextOperation;
  readonly origin: "input" | "undo" | "redo";
  /// L'operazione applicata, per chi la rimanda altrove (la sessione live).
  /// Annulla e ripeti possono darne una forma che vale solo nel motore; un
  /// salto nella cronologia, che ne rifà più d'una insieme, non ne ha una
  /// sola: `null`, e chi la rimanda manda il testo.
  readonly op: Op | null;
}

/// Il foglio dell'editor per chi ci disegna sopra da fuori: la sessione live
/// ci mostra l'inchiostro del tablet e, quando segue, ne muove la camera.
export interface DrawStage {
  readonly overlay: SceneOverlay;
  /// La trasformazione del livello `id` (`#root` per la radice), o `null`
  /// se nel disegno non c'è.
  layerMatrix(id: string): Matrix | null;
  readonly camera: View;
  /// Mette la camera `camera`, con la vista diritta: chi la manda guarda
  /// il disegno senza girarlo.
  setCamera(camera: Camera): void;
  /// La misura del foglio in pixel CSS.
  readonly width: number;
  readonly height: number;
}

/// I collegamenti del disegno verso il vault, da chi monta l'editor: chi
/// sceglie la nota e chi la apre. Senza, l'editor non crea collegamenti e non
/// li apre, ma li nomina nell'albero e li toglie.
export interface DrawLinks {
  /// Chiede la nota a cui portare un collegamento; `current` è l'`href` di
  /// quello che si cambia, `null` per uno nuovo. Torna l'`href` da scrivere,
  /// relativo al disegno, o `null` se chi disegna rinuncia.
  choose(current: string | null): Promise<string | null>;
  /// Apre la nota a cui porta `href`, com'è scritto nel disegno. Se non ci
  /// riesce, lo dice chi la apre.
  open(href: string): void;
}

/// Le immagini del vault, da chi monta l'editor: chi le apre, chi ne legge i
/// byte e chi ne sceglie una da inserire. Senza, ogni immagine del vault è un
/// segnaposto e l'editor non ne inserisce.
export interface DrawImages {
  /// L'URL dell'immagine `href`, com'è scritto nel disegno, aperto nella vita
  /// che riceve; `null` se non si risolve.
  url(href: string, life: Lifetime): Promise<string | null>;
  /// I byte dell'immagine `href`; `null` se non si risolve.
  read(href: string): Promise<Blob | null>;
  /// Chiede l'immagine del vault da inserire; torna l'`href` da scrivere,
  /// relativo al disegno, o `null` se chi disegna rinuncia. Senza, l'editor
  /// non ne inserisce.
  choose?(): Promise<string | null>;
}

/// Dove sta il disegno nel vault, per gli `href` che passano da un disegno
/// all'altro con gli appunti. Senza, un `href` incollato resta come era
/// scritto.
export interface DrawPlace {
  /// Il documento del vault a cui porta `href`, com'è scritto nel disegno;
  /// `null` se non porta a un documento del vault.
  locate(href: string): string | null;
  /// L'`href` con cui il disegno porta al documento `doc` del vault.
  refer(doc: string): string;
}

/// Il foglio di un profilo che annota una pagina alla volta su un fondo che
/// non è del documento: la pagina di un PDF.
export interface DrawSheet {
  /// La pagina di adesso, nelle coordinate della scena.
  page(): Page;
  /// I gruppi della pagina di adesso: si disegnano e si toccano solo loro.
  scope(model: DocumentModel): readonly ContainerNode[];
  /// Dove nasce un oggetto, con ciò che va fatto prima nello stesso `batch`;
  /// `null` se non si può scrivere. `index` ha per livelli i gruppi della
  /// pagina; `taken` dice se un id è già nel documento.
  destination(model: DocumentModel, index: SceneIndex, ids: NewIds, taken: (id: string) => boolean): Destination | null;
  /// La vista è cambiata: la camera e la misura del foglio, in pixel CSS.
  view?(camera: View, width: number, height: number): void;
  /// Le operazioni che ogni gesto che scrive porta in coda, nello stesso
  /// `batch`: il legame col PDF, la prima volta.
  extra(model: DocumentModel): readonly Op[];
  /// Cambia pagina di `delta`, con PagSu e PagGiù.
  turn(delta: number): void;
  /// Il nome del foglio per chi non lo vede: la pagina e il documento.
  label(): string;
  /// Il fondo, dentro la carta: occupa tutta la pagina.
  readonly background: HTMLElement;
  /// I controlli del profilo, nella testata dopo gli strumenti: i tasti
  /// scritti nei loro campi non sono comandi dell'editor.
  readonly controls: HTMLElement | null;
}

export interface DrawEditorOptions {
  /// Il livello degli strumenti (default `essential`); cambia con
  /// `setLevel`.
  readonly level?: Level;
  /// Le parti del livello Personalizzato, per nome (default quelle
  /// dell'Essenziale): un nome che l'editor non conosce non conta.
  readonly custom?: readonly string[];
  /// Lo spazio di lavoro: se c'è, sceglie lui il livello e le parti; cambia
  /// con `setWorkspace`.
  readonly workspace?: Workspace;
  /// Gli strumenti della colonna, in ordine (default vuoto: quelli di serie).
  readonly toolbar?: readonly ToolId[];
  /// Chi disegna ha scelto un altro spazio dal menu ≡.
  readonly onWorkspace?: (workspace: Workspace) => void;
  /// Chi disegna ha salvato la colonna da «Personalizza la barra…»: vuota è
  /// quella di serie.
  readonly onToolbar?: (toolbar: readonly ToolId[]) => void;
  /// Il profilo, che sceglie gli strumenti (default `vector`).
  readonly profile?: ToolProfile;
  /// Il foglio delle annotazioni; senza, il documento è un disegno.
  readonly sheet?: DrawSheet;
  readonly images?: DrawImages;
  /// I caratteri del vault: chi li elenca e li legge. Senza, e nel foglio
  /// delle annotazioni, i testi scrivono con le sole famiglie di Fub.
  readonly vaultFonts?: VaultFontPort;
  /// Il correttore per il testo che si scrive. Senza, il testo non si
  /// controlla.
  readonly proof?: DrawProof;
  /// Ciò che il disegno dice dei suoi caratteri è cambiato: quelli che non
  /// carica, e perché.
  onFontNotes?(notes: FontNotes): void;
  /// Che cosa fa un dito quando nessuna penna è vicina (default `auto`).
  readonly touch?: TouchPolicy;
  /// Chi legge e ricodifica le immagini incollate: quello del browser, se
  /// non è dato; `null` le rifiuta.
  readonly imageCodec?: ImageCodec | null;
  /// La griglia di partenza (default spenta, col passo di 20 unità).
  readonly grid?: Grid;
  /// Chi disegna ha cambiato la griglia, dal menu o coi tasti.
  readonly onGridChange?: (grid: Grid) => void;
  /// I colori scelti di recente, `#rrggbb`, dal più recente (default
  /// nessuno).
  readonly colors?: readonly string[];
  /// Chi disegna ha scelto un colore: i colori recenti di adesso, dal più
  /// recente.
  readonly onColorsChange?: (colors: readonly string[]) => void;
  /// Le penne salvate (`draw.pens`, default nessuna).
  readonly pens?: readonly SavedPen[];
  /// Chi disegna ha salvato o tolto una penna: le penne salvate di adesso.
  readonly onPensChange?: (pens: readonly SavedPen[]) => void;
  readonly links?: DrawLinks;
  readonly place?: DrawPlace;
  readonly onChange?: (change: DrawChange) => void;
  /// La selezione è cambiata: altri oggetti, o gli stessi con chiavi nuove.
  readonly onSelectionChange?: () => void;
  /// I suggerimenti brevi: se si mostrano, e quelli già visti. Senza, o
  /// `null` finché chi monta l'editor non li ha letti, non se ne mostra
  /// nessuno: senza memoria tornerebbero a ogni disegno.
  readonly suggestions?: Suggested | null;
  /// Chi disegna ha spento o riacceso i suggerimenti dalla loro casella.
  readonly onSuggestionsSwitch?: (on: boolean) => void;
  /// Un suggerimento è stato mostrato, o non serve più: quelli di adesso.
  readonly onSuggestedChange?: (seen: readonly string[]) => void;
  /// «Esporta» nella barra in alto e nel menu del disegno: chi monta
  /// l'editor apre la sua finestra, già sulla selezione se `what` lo
  /// chiede («Esporta la selezione» dell'ispettore). Senza, il pulsante non
  /// c'è.
  readonly onExport?: (what?: "selection") => void;
  /// Dove stanno barra, colonna, foglio e pannelli (default
  /// `inlineChrome()`: tutto dentro l'editor).
  readonly chrome?: DrawChrome;
}

/// Ciò che la finestra «Esporta» chiede al disegno.
export interface DrawExport {
  /// La selezione nomina anche gli id che `naming` darebbe.
  readonly scene: ExportScene;
  /// Dà un id agli oggetti scelti che non ne hanno; `null` se ce l'hanno
  /// tutti, o se il disegno non si può scrivere.
  readonly naming: Op | null;
  /// Quanti oggetti riceverebbero un id.
  readonly named: number;
}

export interface DrawEditor {
  readonly element: HTMLElement;
  readonly engine: SceneEngine;
  readonly level: Level;
  /// Le parti che il livello di adesso offre.
  readonly features: ReadonlySet<Feature>;
  readonly tool: ToolId;
  /// Il colore e lo spessore dello strumento di adesso.
  readonly color: string;
  readonly width: number;
  /// Le chiavi degli oggetti selezionati in ordine di documento: l'id, o
  /// `@` e il percorso per un oggetto che non ne ha.
  readonly selection: readonly string[];
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly stage: DrawStage;
  /// Il documento ricostruito dal testo autorevole (operazioni sulla scena,
  /// §7): la cronologia resta, la selezione tiene gli oggetti che ci sono
  /// ancora. Il motore ha un modello: un documento in sola lettura non si
  /// monta nell'editor.
  setEngine(engine: SceneEngine): void;
  /// Un altro documento al posto di questo, come `setDoc` delle superfici:
  /// cronologia e selezione si azzerano, e il foglio si inquadra.
  load(engine: SceneEngine): void;
  /// Toglie o ridà la scrittura, per chi monta l'editor: la barra si spegne
  /// e i gesti non scrivono, ma il disegno si guarda.
  setReadOnly(readOnly: boolean): void;
  /// Sceglie l'oggetto il cui testo contiene il byte `offset` del file, e lo
  /// porta in vista; una tavola, sezione del disegno, la inquadra. `false`
  /// se nessun oggetto e nessuna tavola lo contiene.
  reveal(offset: number): boolean;
  /// «Modifica» su un SVG estraneo: l'operazione `adopt`, un passo
  /// di annulla. `false` se il documento non è estraneo o la scrittura è
  /// tolta.
  adopt(): boolean;
  /// Un altro livello, dal vivo, e le parti del Personalizzato (default
  /// quelle di prima): la barra e i tasti cambiano, il documento e la
  /// cronologia restano. Uno strumento che il livello non ha più torna alla
  /// penna, o al primo che c'è, e un colore personalizzato al nero.
  setLevel(level: Level, custom?: readonly string[]): void;
  /// Un altro spazio di lavoro, dal vivo, e con `toolbar` un'altra colonna.
  setWorkspace(workspace: Workspace, toolbar?: readonly ToolId[]): void;
  setTool(id: ToolId): void;
  /// Il colore dello strumento di adesso: uno della tavolozza o, dal livello
  /// Standard, uno a piacere, come lo legge `customColor`.
  setColor(color: string): void;
  setWidth(width: number): void;
  /// Riproduce il disegno coi tempi dei campioni (P12); il file non cambia.
  replay(speed: ReplaySpeed): void;
  /// La griglia: se si vede, se aggancia, e il passo.
  readonly grid: Grid;
  /// Un'altra griglia, da chi monta l'editor: non si annuncia e non torna a
  /// `onGridChange`. Un passo fuori dai limiti lascia quello di prima.
  setGrid(grid: Grid): void;
  /// Altri colori recenti, da chi monta l'editor: non tornano a
  /// `onColorsChange`.
  setRecentColors(colors: readonly string[]): void;
  /// Altre penne salvate, da chi monta l'editor: non tornano a
  /// `onPensChange`.
  setSavedPens(pens: readonly SavedPen[]): void;
  /// Ciò che chi monta l'editor ricorda dei suggerimenti, letto o cambiato
  /// altrove: non torna a `onSuggestedChange`, se non con quelli visti qui
  /// che gli mancavano.
  setSuggestions(suggested: Suggested | null): void;
  select(keys: readonly string[]): void;
  deleteSelection(): void;
  undo(): void;
  redo(): void;
  /// Inquadra la pagina e tutto ciò che ne esce.
  fit(): void;
  /// Il foglio ha cambiato pagina, o la sua misura: la scelta si azzera e
  /// la pagina si inquadra.
  showSheet(): void;
  /// Applica `op` come un gesto, un passo di annulla col nome `label`: i
  /// comandi di chi monta l'editor, come la conferma della versione del PDF.
  /// `false` se non si è potuto.
  perform(label: DrawKey, op: Op): boolean;
  /// Ciò che la finestra «Esporta» chiede al disegno: gli oggetti scelti,
  /// per id, col riquadro che li contiene, e le tavole nel loro ordine.
  exportScene(): DrawExport;
  /// Le voci della banda di stato: zoom, puntatore, misure, oggetti.
  readonly status: DrawStatus;
  /// Il catalogo dei comandi di adesso: ciò che il disegno sa fare, col
  /// posto, il tasto e se si può.
  commands(): readonly DrawCommand[];
  focus(): void;
  dispose(): void;
}

/// Monta l'editor dentro `host`.
export function createDrawEditor(host: HTMLElement, initial: SceneEngine, owner: Lifetime, options: DrawEditorOptions = {}): DrawEditor {
  // I pezzi si montano nell'ordine del codice di prima: ognuno trova nel
  // contesto ciò che i precedenti hanno dato.
  const ctx = { host, initial, owner, options } as EditorContext;
  installState(ctx);
  installStatus(ctx);
  installBare(ctx);
  installOutline(ctx);
  installCommands(ctx);
  installCommandSearch(ctx);
  installToolbar(ctx);
  installBars(ctx);
  installStage(ctx);
  installView(ctx);
  installMarks(ctx);
  installTree(ctx);
  installPanel(ctx);
  installStyling(ctx);
  installControls(ctx);
  installOperations(ctx);
  installTooling(ctx);
  installGuideDrag(ctx);
  installPenSymmetry(ctx);
  installBoardTool(ctx);
  installDropperTool(ctx);
  installNib(ctx);
  installReplay(ctx);
  installRuler(ctx);
  installGradientTool(ctx);
  installGradientGesture(ctx);
  installInkGestures(ctx);
  installInserts(ctx);
  installShapesConnector(ctx);
  installCurvatureTool(ctx);
  installTextTool(ctx);
  installTextProof(ctx);
  installInput(ctx);
  installHandZoom(ctx);
  installNavigator(ctx);
  installWorkspace(ctx);
  installArranging(ctx);
  installSelectionCommands(ctx);
  installImageCommands(ctx);
  installLayersGrid(ctx);
  installKeys(ctx);
  installClipboardCommands(ctx);
  installVaultImages(ctx);
  installLife(ctx);
  const {
    has, following, styles, style, history, root, surface, labelSurface, suggestions, panel, cursorMark, boardsNow, editable, newIds, showGrid,
    showGuideLines, fit, selectedUnits, showHandles, closeDescriptions, showPanel, syncProperties, refresh, commit, undo, redo, deleteSelection, select,
    reveal, adopt, setReadOnly, setLevel, setTool, setColor, setWidth, cancelGesture, setSymmetry, undoable, redoable,
    finishText, visibleBoundsOf, closeCrop, dispose
  } = ctx;
  const stage: DrawStage = {
    get overlay() {
      return ctx.overlay;
    },
    layerMatrix: (id) => (id === ROOT ? IDENTITY : (ctx.currentIndex().layers.find((layer) => layer.id === id)?.matrix ?? null)),
    get camera() {
      return ctx.camera;
    },
    setCamera(next) {
      if (ctx.disposed) return;
      ctx.placed = true;
      ctx.setCamera({ scale: next.scale, angle: 0, tx: next.tx, ty: next.ty });
    },
    get width() {
      return ctx.surface.clientWidth;
    },
    get height() {
      return ctx.surface.clientHeight;
    },
  };
  return {
    element: root,
    status: ctx.status,
    commands: () => ctx.commands(),
    get engine() {
      return ctx.engine;
    },
    get level() {
      return ctx.level;
    },
    get features() {
      return ctx.features;
    },
    get tool() {
      return ctx.tool;
    },
    get color() {
      return style().color;
    },
    get width() {
      return style().width;
    },
    get selection() {
      return ctx.selection;
    },
    get canUndo() {
      return undoable();
    },
    get canRedo() {
      return redoable();
    },
    stage,
    get grid() {
      return ctx.grid;
    },
    setGrid(next) {
      if (ctx.disposed) return;
      ctx.grid = checkedGrid(next, ctx.grid);
      if (ctx.grid.penId !== undefined && ctx.grid.penId !== "highlighter") ctx.penId = ctx.grid.penId;
      suggestions.relabel();
      showGrid();
      showGuideLines();
      showHandles();
      panel.setClosed(ctx.grid.closed as readonly SectionId[]);
      // Nell'ispettore il pannello sta nella sua scheda: aperto o chiuso lo
      // dice chi la tiene.
      if (ctx.chrome.reveal === undefined && ctx.grid.panel !== null && has("properties") && ctx.grid.panel === panel.element.hidden) showPanel(ctx.grid.panel, false, false);
      syncProperties();
    },
    setSuggestions(suggested) {
      if (!ctx.disposed) suggestions.remember(suggested);
    },
    setRecentColors(colors) {
      if (ctx.disposed) return;
      ctx.recentColors = colors.slice(0, RECENT_COLORS);
      syncProperties();
    },
    setSavedPens(pens) {
      if (ctx.disposed) return;
      ctx.savedPens = pens;
      ctx.syncPenOptions();
    },
    setEngine(next) {
      if (ctx.disposed) return;
      if (next.model === null) throw new Error("documento in sola lettura: non si monta nell'editor");
      // Chi sposta o cancella guarda oggetti che il testo nuovo può non
      // avere più: il gesto si annulla. Tratto e forma si scrivono alla fine,
      // sul livello che c'è allora.
      if (ctx.current !== null && (ctx.current.kind === "select" || ctx.current.kind === "erase" || ctx.current.kind === "board")) cancelGesture();
      ctx.engine = following(next);
      refresh();
    },
    load(next) {
      if (ctx.disposed) return;
      if (next.model === null) throw new Error("documento in sola lettura: non si monta nell'editor");
      cancelGesture();
      // Il testo in corso era del documento di prima.
      finishText(false);
      ctx.engine = following(next);
      ctx.loads++;
      closeDescriptions();
      closeCrop();
      history.clear();
      ctx.selection = [];
      ctx.chosen = null;
      ctx.boardChosen = null;
      ctx.isolation = null;
      ctx.cursor = null;
      cursorMark.hidden = true;
      // I campioni erano del documento di prima: il colore resta, da solo.
      for (const each of Object.values(styles)) each.swatch = null;
      refresh();
      ctx.placed = false;
      fit();
      // Il centro della simmetria era del disegno di prima: torna al suo
      // posto in questo, inquadrato.
      setSymmetry({ ...ctx.symmetry, center: null });
    },
    setReadOnly,
    reveal,
    adopt,
    setLevel,
    setWorkspace: (workspace, toolbar) => ctx.setWorkspace(workspace, toolbar),
    setTool,
    setColor: (color) => setColor(color),
    setWidth,
    replay: (speed) => ctx.replay(speed),
    select,
    deleteSelection,
    undo,
    redo,
    fit,
    showSheet() {
      if (ctx.disposed) return;
      // L'altra pagina ha le sue coordinate: la selezione, il gruppo isolato
      // e il cursore erano di quella di prima.
      cancelGesture();
      ctx.selection = [];
      ctx.isolation = null;
      ctx.cursor = null;
      cursorMark.hidden = true;
      refresh();
      labelSurface();
      ctx.placed = false;
      fit();
    },
    perform(label, op) {
      if (ctx.disposed || !editable()) return false;
      cancelGesture();
      return commit(label, op) !== null;
    },
    exportScene() {
      const units = ctx.engine.model === null ? [] : selectedUnits();
      const bounds = visibleBoundsOf(units);
      // La richiesta trova gli oggetti per id: chi non ne ha uno lo riceve,
      // se il disegno si può scrivere.
      const fresh = editable() ? newIds() : null;
      const naming: Op[] = [];
      const ids: string[] = [];
      for (const unit of units) {
        if (unit.id !== null) {
          ids.push(unit.id);
        } else if (fresh !== null) {
          const id = fresh.next("object");
          naming.push({ op: "ident", path: [...unit.path], tag: unit.tag, id });
          ids.push(id);
        }
      }
      return {
        scene: {
          selection:
            units.length === 0
              ? null
              : { count: units.length, ids, box: bounds === null ? null : exportBox(bounds.min, bounds.max) },
          boards: boardsNow().map((board) => ({ id: board.id, name: board.name })),
        },
        naming: naming.length === 0 ? null : { op: "batch", ops: naming },
        named: naming.length,
      };
    },
    focus() {
      surface.focus({ preventScroll: true });
    },
    dispose,
  };
}
