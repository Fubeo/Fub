// Il contratto delle schede della lavagna: la forma che la tela e i renderer
// di ogni specie (nota, foglio, PDF, immagine, pagina web, file) condividono.
//
// Una scheda di file mostra il contenuto del suo file. Può essere *viva*
// (il renderer ha aperto il file e ci si può entrare, scorrere, scegliere) o
// *ferma* (mostra l'ultima immagine che ha avuto, o il suo contenuto inerte,
// senza nessuna risorsa aperta). Quali schede sono vive lo decide
// `liveCardIds`, e `updateLiveCards` le cambia di modo a fine gesto.
//
// La specie viene dall'estensione del file, come fa la shell in
// `ui/format-kind.ts`: il client non sa il provider di un file senza
// chiederlo. Un renderer legge e non scrive mai il file della sua scheda.
//
// Qui niente DOM vivo: solo tipi e funzioni pure, così la tela e i test le
// usano senza montare niente. La pagina di riferimento è
// `docs/reference/canvas-cards.md`.

import { formatKindOf } from "../../ui/format-kind";
import type { SyntaxForm } from "../../host/contract";
import type { SaveState } from "../../state/saving";
import type { Lifetime } from "../../ui/lifetime";
import { mediaKindOfId } from "../media/media-types";
import type { CanvasNode } from "./model";
import type { CanvasParts } from "./parts";

/// Viva: il renderer ha aperto il file. Ferma: nessuna risorsa aperta.
export type CardMode = "live" | "snapshot";

/// La specie di una scheda, che sceglie il renderer.
export type CardKind = "note" | "document" | "sheet" | "pdf" | "image" | "web" | "craft" | "file";

/// La specie di una scheda dalla sua forma: `null` per testo e gruppi, che
/// la tela disegna da sé.
///
/// Per un file conta l'estensione del percorso, in minuscolo, senza
/// `subpath`: un punto nel nome di una cartella o dopo il `#` non conta.
/// L'SVG è un'immagine ferma, anche se `formatKindOf` lo dice disegno.
/// `craft` non ha ancora un'estensione che ci porti (arriva con T18).
export function cardKindOf(node: CanvasNode): CardKind | null {
  switch (node.type) {
    case "text":
    case "group":
      return null;
    case "link":
      return "web";
    case "file":
      return fileKindOf(typeof node.file === "string" ? node.file : "");
  }
}

function fileKindOf(file: string): CardKind {
  const path = withoutSubpath(file);
  const extension = extensionOf(path);
  if (extension === null) return "file";
  if (extension === "md" || extension === "markdown") return "note";
  switch (formatKindOf(path)) {
    case "word":
    case "odt":
      return "document";
    case "sheet":
      return "sheet";
    default:
      break;
  }
  switch (mediaKindOfId(path)) {
    case "pdf":
      return "pdf";
    case "image":
      return "image";
    default:
      return "file";
  }
}

/// Il percorso senza `#…`: `Nota.md#1.2 Titolo` → `Nota.md`.
function withoutSubpath(file: string): string {
  const hash = file.indexOf("#");
  return hash < 0 ? file : file.slice(0, hash);
}

/// L'estensione dell'ultimo segmento, in minuscolo; `null` se non c'è (un
/// nome senza punto, o un nome nascosto come `.md`).
function extensionOf(path: string): string | null {
  const base = path.split("/").pop() ?? "";
  const point = base.lastIndexOf(".");
  if (point <= 0 || point === base.length - 1) return null;
  return base.slice(point + 1).toLowerCase();
}

/// Una misura in unità della lavagna.
export interface CardSize {
  readonly width: number;
  readonly height: number;
}

/// Un rettangolo in unità della lavagna.
export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/// Un'immagine ferma e il suo peso in memoria, che la cache conta.
export interface CardSnapshot {
  readonly bitmap: ImageBitmap | HTMLCanvasElement;
  readonly bytes: number;
  /// La misura in punti PDF della pagina che l'immagine mostra, come si vede
  /// (con la sua rotazione): la scheda PDF la scrive, così da ferma ritrova
  /// l'ancora della pagina (`pageBox`, T19). Assente per le altre immagini.
  readonly pageSize?: CardSize;
  /// La proporzione (larghezza su altezza) del contenuto che l'immagine
  /// mostra, come la dà il file (l'immagine, la sua zona): la scheda
  /// d'immagine la scrive, così da ferma `contentAspect` dà lo stesso numero
  /// che da viva (T39). Assente, vale la proporzione dell'immagine ferma.
  readonly aspect?: number;
}

/// La pagina che una scheda mostra (il PDF, T19): il suo numero (da 1), la sua
/// misura in punti PDF come si vede (`size`) e il rettangolo dove la scheda la
/// disegna (`rect`), in unità della lavagna dall'angolo in alto a sinistra
/// della scheda. L'inchiostro con l'ancora `page` si disegna mappando la
/// pagina su `rect` (`docs/reference/canvas-ink.md`).
export interface CardPageBox {
  readonly page: number;
  readonly size: CardSize;
  readonly rect: Rect;
}

/// Una cella che una scheda di foglio mostra (T37, T38): il nome del foglio
/// com'è nel file, l'indirizzo in notazione A1, il rettangolo della cella in
/// unità della lavagna dall'angolo in alto a sinistra della scheda (di
/// un'unione, tutta l'unione dalla sua cella in alto a sinistra, anche la
/// parte scorsa via) e quante unità della lavagna fa un pixel del foglio al
/// 100% (`zoom`). L'inchiostro con l'ancora `cell` si disegna portando
/// l'angolo della cella su `rect.x, rect.y` (`docs/reference/canvas-ink.md`).
export interface CardCellBox {
  readonly sheet: string;
  readonly cell: string;
  readonly rect: Rect;
  readonly zoom: number;
}

/// Le immagini ferme di un file, per parte. La parte dice che cosa è e a che
/// larghezza, arrotondata a 32 px, ed è sempre fatta da `snapshotPart`:
/// `whole@640` per l'immagine intera, `page-3@640` per una pagina.
export interface CardSnapshots {
  get(path: string, part: string): CardSnapshot | undefined;
  put(path: string, part: string, snapshot: CardSnapshot): void;
  /// Dimentica tutte le parti del file (cambiato, spostato, tolto).
  forget(path: string): void;
}

/// Il passo a cui si arrotonda la larghezza di un'immagine ferma.
export const SNAPSHOT_WIDTH_STEP = 32;

/// La parte di un'immagine ferma: `snapshotPart("page-3", 650)` → `page-3@640`.
///
/// La larghezza si arrotonda al multiplo di 32 più vicino, mai sotto 32, così
/// una scheda che cambia misura di poco ritrova la stessa immagine. Il
/// prefisso non è vuoto e non contiene `@`, che separa la larghezza.
export function snapshotPart(prefix: string, width: number): string {
  if (prefix === "" || prefix.includes("@")) {
    throw new RangeError(`snapshot part prefix ${JSON.stringify(prefix)} is not valid`);
  }
  if (!Number.isFinite(width)) {
    throw new RangeError(`snapshot part width ${width} is not finite`);
  }
  const steps = Math.max(1, Math.round(width / SNAPSHOT_WIDTH_STEP));
  return `${prefix}@${steps * SNAPSHOT_WIDTH_STEP}`;
}

/// Ciò che la tela dà a una scheda montata.
export interface CardContext {
  /// Il file, dal vault, senza `subpath`.
  readonly path: string;
  /// `#page=3`, `#Titolo`…, o `null`.
  readonly subpath: string | null;
  /// La lavagna che contiene la scheda.
  readonly documentId: string;
  /// Si chiude con `destroy`: ascolti, osservatori e timer passano da qui.
  readonly lifetime: Lifetime;
  readonly snapshots: CardSnapshots;
  /// La misura della scheda, in unità della lavagna.
  size(): CardSize;
  zoom(): number;
  /// Il file non c'è: la tela mostra la scheda «File mancante»: il nome del file con «Ritrova…» e «Togli dalla lavagna» (T16).
  missing(): void;
  /// La pagina (da 1) che la scheda mostrava l'ultima volta, ricordata su
  /// questo computer (il PDF, T36); `null` o assente se non se ne ricorda una.
  /// Una pagina oltre la fine del file vale la prima.
  readonly initialPage?: number | null;
  /// La scheda mostra un'altra pagina (da 1): la tela la ricorda. Assente,
  /// non si ricorda niente.
  pageChanged?(page: number): void;
  /// Ciò che `pageBox()` dà è cambiato: un'immagine di pagina è arrivata, o
  /// è andata via. La tela ridisegna l'inchiostro della scheda (T19): anche
  /// quello che segue il contenuto, perché con la pagina cambia
  /// `contentAspect()` (T39).
  pageShown?(): void;
  /// Ciò che `contentAspect()` dà è cambiato: l'immagine è arrivata, il file
  /// è cambiato, o non si vede più niente. La tela ridisegna l'inchiostro
  /// della scheda, che segue il contenuto (T39).
  contentShown?(): void;
  /// Ciò che `cellAt()` e `cellRect()` danno è cambiato: il foglio è scorso,
  /// ha cambiato misura o contenuto, o non si vede più. La tela ridisegna
  /// l'inchiostro di cella della scheda subito, nello stesso fotogramma delle
  /// celle (T38): la scheda lo chiama dopo averle disegnate.
  cellsShown?(): void;
  /// Le parti dell'estratto (`fub:parts`, `docs/reference/canvas-parts.md`),
  /// già lette e provate col file e il `subpath` (`cardParts` di `parts.ts`);
  /// `null` o assente: la scheda mostra ciò che dice il `subpath`.
  readonly parts?: CanvasParts | null;
  /// La porta per scrivere dentro la scheda (T40); assente, la scheda si legge
  /// e basta (T41).
  readonly editors?: CardEditorPort;
  /// La scheda scrive nel suo file (`writing` con la barra dell'editor), o ha
  /// smesso (`null`): la tela segna `data-card-editing` e mette la barra
  /// nella riga delle opzioni (T41). Una scheda che smette da sé (la porta
  /// dice no, la nota è di sola lettura) lo dice qui.
  writing?(writing: CardWriting | null): void;
  /// A che punto è ciò che si scrive (T41, T96), per la riga del titolo: lo
  /// stato del salvataggio della sessione, o la sola lettura (`reason` dice
  /// perché); `null`, niente da dire.
  editState?(state: CardEditorState | null, reason?: string): void;
  /// I gesti di una scheda-estratto (T75) per l'avviso «Sezione non
  /// trovata»; assente (in sola lettura), l'avviso non ha pulsanti.
  readonly excerpt?: CardExcerptActions;
}

/// Che cosa fa la tela per una scheda-estratto che ha perso una sezione (T75).
export interface CardExcerptActions {
  /// «Scegli di nuovo…»: riapre il selettore delle sezioni (T74); assente
  /// senza il selettore.
  chooseAgain?(): void;
  /// «Mostra tutta la nota»: toglie `fub:parts` e il `subpath`, in un commit.
  showWhole(): void;
}

/// Una scheda che scrive (T41): la barra di formato dell'editor, se ne ha una,
/// e il contesto di ciò che si scrive (T42), se l'editor ne dà uno.
export interface CardWriting {
  readonly toolbar: HTMLElement | null;
  /// Dove si scrive adesso, come dati: la tela lo mostra dove dice il
  /// prototipo T27 (la riga delle opzioni). La scheda richiama `writing` a
  /// ogni cambio.
  readonly context?: CardEditorContext | null;
}

/// Il contesto di ciò che si scrive in una scheda (T42): la cella attiva di un
/// foglio (`B3`) e il suo contenuto com'è scritto (la formula, o il valore).
/// Sono dati, non DOM: chi ospita la scheda decide dove e come mostrarli.
export interface CardEditorContext {
  readonly cell: string;
  readonly formula: string;
}

/// Una scheda montata da un renderer.
export interface CardView {
  /// Passa da viva a ferma o al contrario; la tela la chiama solo se cambia.
  setMode(mode: CardMode): void;
  /// La scheda ha cambiato misura (a fine gesto).
  resize?(): void;
  /// Entra nella scheda; `false` se non c'è niente in cui entrare.
  enter?(): boolean;
  leave?(): void;
  /// `true` se il tasto è della scheda e la tela non deve usarlo.
  key?(event: KeyboardEvent): boolean;
  /// La pagina mostrata, da 1 (il PDF).
  page?(): number;
  /// La pagina che si vede adesso e dove sta nella scheda (T19); `null` se
  /// nessuna pagina si vede. Da viva e da ferma: l'immagine ferma è quella di
  /// una pagina. La tela lo chiede quando disegna l'inchiostro.
  pageBox?(): CardPageBox | null;
  /// La proporzione (larghezza su altezza) del contenuto che la scheda mostra
  /// adesso (T39): l'immagine, la sua zona se ne ha una (T78), la pagina del
  /// PDF. Il contenuto sta intero nella scheda, al centro; l'inchiostro
  /// `scale` lo segue (`inkFit` con `aspect`). `null` se non si sa, o se non
  /// si vede niente.
  contentAspect?(): number | null;
  /// La cella sotto `point` (in unità della lavagna dall'angolo della
  /// scheda), come si vede adesso (T38); sopra celle unite quella in alto a
  /// sinistra dell'unione. `null` sopra le intestazioni, fuori dalla griglia
  /// o se la scheda non mostra celle. Solo le schede di foglio.
  cellAt?(point: { readonly x: number; readonly y: number }): CardCellBox | null;
  /// Dove sta adesso la cella `cell` (A1) del foglio `sheet` (T38); `null`
  /// se non si vede: un altro foglio, scorsa via, una riga o una colonna
  /// nascosta, la scheda senza celle. Da viva e da ferma: ferma, l'ultima
  /// vista della scheda viva.
  cellRect?(sheet: string, cell: string): CardCellBox | null;
  /// Entra in scrittura (T41, T42): l'editor vero del file prende il corpo. Il
  /// montaggio arriva dopo, e la scheda lo dice con `context.writing`; `false`
  /// se qui non si scrive (un documento Word, nessuna porta, una scheda ferma).
  /// `leave()` esce anche dalla scrittura. `from` è l'elemento sotto il gesto
  /// che ha chiesto di scrivere (il doppio clic), se c'è: una scheda di
  /// foglio apre la cella che c'era lì (T42).
  edit?(from?: EventTarget | null): boolean;
  destroy(): void;
}

/// Come si apre l'editor dentro una scheda (T40).
export interface CardEditorOptions {
  /// La scheda è piccola: l'editor senza le sue barre, dove la superficie lo
  /// sa fare. Il segno resta sul contenitore (`data-card-editor`).
  readonly compact: boolean;
  /// Chi apre vuole solo leggere: l'editor si monta in sola lettura.
  readonly readOnly: boolean;
  /// La vita della scheda: chiusa lei, l'editor si smonta da sé, anche se
  /// `open` sta ancora aspettando.
  readonly lifetime: Lifetime;
  /// Il titolo a cui la vista scorre appena montato l'editor (`Nota#Titolo`,
  /// T41): si scrive la nota intera, vista da lì. Assente o `null`: l'inizio.
  readonly heading?: string | null;
}

/// A che punto è ciò che si scrive nella scheda (T96): lo stato del
/// salvataggio della sessione, lo stesso che la testata di un riquadro dice
/// della stessa nota (salvato, si salva, non salvato, salvataggio fallito,
/// cambiato su disco), o `readonly`: non scrivibile adesso (la scheda, la
/// finestra che si chiude, una cancellazione in sospeso, il prestito a
/// un'app, la sessione chiusa).
export type CardEditorState = SaveState | "readonly";

/// L'editor vero di un file, montato dentro una scheda sulla stessa sessione
/// di un riquadro: bozze, conflitti e salvataggio sono quelli della sessione,
/// l'annulla è suo.
export interface CardEditor {
  focus(): void;
  /// Esce dalla scrittura: il testo che l'editor tiene ancora diventa una
  /// modifica della sessione e si salva adesso. L'editor resta montato.
  leave(): Promise<void>;
  state(): CardEditorState;
  /// Avvisa a ogni cambio di `state()`; restituisce come smettere.
  onState(listener: (state: CardEditorState) => void): () => void;
  /// Perché `state()` è `readonly`, con le parole di un riquadro (T96);
  /// `null` se si scrive, o se la sola lettura l'ha chiesta la scheda.
  readOnlyWhy?(): string | null;
  /// La sessione si è chiusa sotto l'editor (il file tolto, T96): la scheda
  /// torna alla resa del file, che dice se manca.
  closed?(): boolean;
  /// La barra di formato dell'editor, senza Annulla e Ripeti (sulla lavagna
  /// stanno in cima), da mettere nella riga delle opzioni (T41); `null` se
  /// l'editor non ne ha. La barra vive quanto l'editor.
  toolbar?(): HTMLElement | null;
  /// Il contesto di ciò che si scrive (T42: la cella attiva e la sua formula),
  /// o `null` se l'editor non ne ha.
  context?(): CardEditorContext | null;
  /// Avvisa quando `context()` cambia; restituisce come smettere.
  onContext?(listener: (context: CardEditorContext | null) => void): () => void;
  /// Stacca l'editor dalla sessione e lo smonta, una volta sola.
  destroy(): void;
}

/// Come si apre l'editor delle note sopra il testo di una scheda di testo
/// (T43): un testo che sta nel `.canvas`, non in un file.
export interface CardTextOptions {
  /// Ogni cambio fatto nell'editor, col testo intero di dopo. Chi apre ne fa
  /// ciò che vuole (la tela: il testo in attesa e il commit dopo la pausa).
  onText(text: string): void;
  /// L'editor si monta in sola lettura.
  readonly readOnly: boolean;
  /// La vita del campo: chiusa lei, l'editor si smonta da sé, anche se
  /// `openText` sta ancora aspettando.
  readonly lifetime: Lifetime;
  /// Il documento che tiene il testo (la lavagna): i link relativi partono
  /// dalla sua cartella. Non è la sessione dell'editor: il testo non ne ha una.
  readonly documentId: string;
  /// Le sintassi del Markdown con cui la tela rende le schede di testo.
  readonly forms?: readonly SyntaxForm[];
}

/// L'editor delle note montato sopra il testo di una scheda di testo (T43):
/// in Live, col suo annulla, senza sessione né file.
export interface CardTextEditor {
  /// Il fuoco nell'editor, col cursore a `at` (in unità UTF-16 del testo;
  /// assente: alla fine).
  focus(at?: number): void;
  /// Il testo che l'editor tiene adesso.
  text(): string;
  /// Smonta l'editor, una volta sola. Ciò che c'era di scritto è già arrivato
  /// a `onText`.
  destroy(): void;
}

/// La porta con cui una scheda scrive nel suo file. La tela non conosce gli
/// editor: la porta, data dalla shell, li sceglie e li monta.
export interface CardEditorPort {
  /// L'editor del file `path` montato in `host`; `null` se il file non ha un
  /// editor o la sua sessione non si apre: la scheda resta in lettura.
  open(path: string, host: HTMLElement, options: CardEditorOptions): Promise<CardEditor | null>;
  /// L'editor delle note in Live montato in `host` sopra `text`, un testo che
  /// non è un file (la scheda di testo, T43). `null` se l'editor non si monta,
  /// o non terrebbe il testo così com'è byte per byte: allora la tela resta al
  /// suo campo di testo semplice. Assente: sempre il campo semplice.
  openText?(host: HTMLElement, text: string, options: CardTextOptions): Promise<CardTextEditor | null>;
}

/// Le schede di una tela con la porta per scriverci dentro, accanto al
/// registro dei renderer: la forma che `surface.ts` passa alla tela.
export interface CardEditing {
  readonly editors: CardEditorPort;
}

/// Chi sa mostrare una o più specie.
export interface CardRenderer {
  readonly kinds: readonly CardKind[];
  mount(node: CanvasNode, host: HTMLElement, mode: CardMode, context: CardContext): CardView;
}

export interface CardRegistry {
  /// Il renderer della specie, o `null`: allora la scheda è una scheda di file.
  rendererFor(kind: CardKind): CardRenderer | null;
}

/// Il registro per specie. Due renderer per la stessa specie sono un errore
/// detto subito, non al primo uso.
export function createCardRegistry(renderers: readonly CardRenderer[]): CardRegistry {
  const byKind = new Map<CardKind, CardRenderer>();
  for (const renderer of renderers) {
    for (const kind of renderer.kinds) {
      const known = byKind.get(kind);
      if (known !== undefined && known !== renderer) {
        throw new Error(`card kind ${kind} has two renderers`);
      }
      byKind.set(kind, renderer);
    }
  }
  return { rendererFor: (kind) => byKind.get(kind) ?? null };
}

/// Lo zoom da cui in su una scheda può essere viva (valore di partenza).
export const LIVE_ZOOM_MIN = 0.35;
/// Di quanto si allarga la vista per lato, in frazione della sua misura
/// (valore di partenza).
export const LIVE_MARGIN = 0.5;
/// Il massimo di schede vive insieme (valore di partenza).
export const MAX_LIVE_CARDS = 40;

/// Le schede che devono essere vive: dentro la vista allargata di metà per
/// lato, dallo zoom 0,35 in su, al più `limit`, le più vicine al centro.
///
/// «Dentro» vuol dire che il rettangolo della scheda tocca la vista allargata
/// (anche solo sul bordo). Contano solo le schede con una specie. La distanza
/// è quella fra il centro della vista e il punto più vicino della scheda: una
/// scheda che copre il centro è a distanza zero. A pari distanza vince
/// l'ordine del file.
export function liveCardIds(
  nodes: readonly CanvasNode[],
  view: Rect,
  zoom: number,
  limit: number = MAX_LIVE_CARDS,
): Set<string> {
  const live = new Set<string>();
  if (!(zoom >= LIVE_ZOOM_MIN)) return live;
  if (!(view.width > 0) || !(view.height > 0)) return live;
  const most = Math.floor(limit);
  if (!(most > 0)) return live;

  const left = view.x - view.width * LIVE_MARGIN;
  const top = view.y - view.height * LIVE_MARGIN;
  const right = view.x + view.width * (1 + LIVE_MARGIN);
  const bottom = view.y + view.height * (1 + LIVE_MARGIN);
  const centerX = view.x + view.width / 2;
  const centerY = view.y + view.height / 2;

  const inside: { readonly id: string; readonly distance: number; readonly order: number }[] = [];
  nodes.forEach((node, order) => {
    if (cardKindOf(node) === null) return;
    const nodeRight = node.x + node.width;
    const nodeBottom = node.y + node.height;
    if (node.x > right || nodeRight < left || node.y > bottom || nodeBottom < top) return;
    const dx = Math.max(node.x - centerX, 0, centerX - nodeRight);
    const dy = Math.max(node.y - centerY, 0, centerY - nodeBottom);
    inside.push({ id: node.id, distance: dx * dx + dy * dy, order });
  });

  if (inside.length > most) {
    inside.sort((a, b) => a.distance - b.distance || a.order - b.order);
    inside.length = most;
  }
  for (const card of inside) live.add(card.id);
  return live;
}

/// La forma del lavoro rimandato della penna (`PenQuiet` di N4): un lavoro
/// per chiave, eseguito quando la penna è su.
export interface CardQuiet {
  defer(key: string, work: () => void): void;
}

/// La chiave del lavoro rimandato che cambia modo alle schede.
export const CARD_QUIET_KEY = "cards";

/// Mette ogni scheda nel modo voluto, nel lavoro rimandato «cards».
///
/// Tutto avviene dentro il lavoro: lì si leggono le schede montate in quel
/// momento, si chiama `setMode` solo dove il modo cambia e si aggiorna
/// `current`. `wanted` si copia subito, perché è la decisione di adesso. Una
/// scheda non più montata esce da `current`. Se un `setMode` lancia, le altre
/// schede cambiano lo stesso, quella resta col modo di prima e l'errore esce
/// alla fine.
export function updateLiveCards(
  cards: ReadonlyMap<string, CardView>,
  wanted: ReadonlySet<string>,
  current: Map<string, CardMode>,
  quiet: CardQuiet,
): void {
  const want = new Set(wanted);
  quiet.defer(CARD_QUIET_KEY, () => {
    let failure: { readonly error: unknown } | null = null;
    for (const id of [...current.keys()]) {
      if (!cards.has(id)) current.delete(id);
    }
    for (const [id, card] of cards) {
      const mode: CardMode = want.has(id) ? "live" : "snapshot";
      if (current.get(id) === mode) continue;
      try {
        card.setMode(mode);
        current.set(id, mode);
      } catch (error) {
        failure ??= { error };
      }
    }
    if (failure !== null) throw failure.error;
  });
}
