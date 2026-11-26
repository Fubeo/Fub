// Il motore della lavagna: le costanti esportate, le porte (`Canvas*Port`) e
// le opzioni del motore. Tolte da `engine.ts`, che le riesporta.
import type { Theme } from "../../theme/theme";
import type { SyntaxForm } from "../../host/contract";
import { type EditorChangeOrigin } from "../core/text-operation";
import type { PdfPagesReader } from "../core/cards/kinds/pdf";
import { type CardEditorPort, type CardKind, type CardRegistry, type CardSnapshots } from "../core/cards/contract";
import { type CardDirection } from "./a11y";
import { type CanvasAlign } from "./chrome/commands";
import { type FindNotesPort } from "./find";
import { type CardCitations } from "./card-head";
import { type RecentCommands } from "./chrome/command-search";
import { type PartsPickerPort } from "./parts-picker";
import { readInkMouse, readPen, saveInkMouse, savePen } from "./preferences";
import { type InkPenChoice } from "./ink-record";
import { type CanvasOperation } from "./operation";
import { type CanvasViewMemory } from "./view-state";
import { canvasCoreReady, openCoreNow, type CanvasCore } from "./wasm/core";

export const CANVAS_SNAP = 8;
/** I bottoni di allineamento e di distribuzione: `align` coi sei lati, `distribute` con i due assi. */
export type CanvasArrange = CanvasAlign | "distribute-x" | "distribute-y";
/** I pixel dello schermo fra i tratti scelti col Lazo e la loro cornice (T86). */
export const LASSO_FRAME_PAD = 6;
/**
 * I punti della griglia si vedono ogni tanti passi di `CANVAS_SNAP` (T95: ogni
 * 32 unità): l'aggancio resta di 8, lo sfondo non si riempie di punti.
 */
export const CANVAS_GRID_DOT_STEPS = 4;
/** Sotto questi pixel fra due punti, sullo schermo, la griglia non si disegna (T71): sotto il 50%. */
export const CANVAS_GRID_MIN_PX = 16;
export const CANVAS_MIN_SIZE = 40;
export const MAX_CANVAS_HISTORY = 100;
/** La pausa dopo l'ultimo tasto in una scheda, prima che il suo testo si registri. */
export const CARD_PAUSE_MS = 250;
/** Oltre questo numero di schede nuove, «Spargi le pagine» (T72) chiede conferma. */
export const SPREAD_CONFIRM_ABOVE = 200;
/** Quanto si aspetta dopo l'ultimo scatto della rotella prima di dire finito il gesto (A-7). */
export const WHEEL_SETTLE_MS = 150;
/** Una riga della rotella in pixel: un valore di partenza, come nella lavagna del grafo. */
const WHEEL_LINE_PX = 16;

/**
 * Il delta della rotella in pixel, qualunque unità abbia scelto il browser:
 * `deltaMode` 1 conta righe, 2 pagine, e la pagina è la misura della vista.
 */
export function wheelPixels(delta: number, deltaMode: number, page: number): number {
  if (deltaMode === 1) return delta * WHEEL_LINE_PX;
  if (deltaMode === 2) return delta * page;
  return delta;
}

/** I tasti che una scheda scelta e non attiva può prendere (`CardView.key`, T14). */
export const CARD_KEYS: ReadonlySet<string> = new Set(["PageUp", "PageDown", "Home", "End"]);

/**
 * Le frecce che con Alt vanno alla scheda più vicina (T61, M1). Alt+← e Alt+→
 * solo col fuoco su una scheda: altrove sono Indietro e Avanti dello
 * Scrittoio (`CARD_ONLY_NEAREST_KEYS`, DECISIONS.md, T56 e T61).
 */
export const NEAREST_CARD_KEYS: ReadonlyMap<string, CardDirection> = new Map([
  ["ArrowUp", "up"],
  ["ArrowDown", "down"],
  ["ArrowLeft", "left"],
  ["ArrowRight", "right"],
]);

/** Le frecce di `NEAREST_CARD_KEYS` che la lavagna senza una scheda a fuoco lascia alla shell. */
export const CARD_ONLY_NEAREST_KEYS: ReadonlySet<string> = new Set(["ArrowLeft", "ArrowRight"]);

/**
 * Quante schede nomina un passo del giro dei nomi (T61), fra un momento libero
 * del thread e l'altro. Misurato in Vitest (Node, non la WebView) sul PC di
 * sviluppo, con 2000 schede, 2000 fili e 50 gruppi: 7–9 ms per tutti i nomi
 * più 2–4 ms per la lettura (`boardReading`, una volta per documento), cioè
 * circa 1 ms ogni 250 nomi.
 */
export const LABEL_BATCH = 250;

/** Le specie in cui il doppio clic entra, come Invio (T14). */
export const DOUBLE_CLICK_ENTERS: ReadonlySet<CardKind> = new Set(["note", "document", "sheet"]);
/** Che cosa mostra una scheda di file, per il gesto di Invio e del doppio clic (T93). */
export type FileShowing = "missing" | "loading" | "unreadable" | "shown";
/** Il testo più lungo di una scheda, in byte UTF-8: oltre, il nucleo rifiuta la lavagna (`invalid`). */
export const MAX_CARD_TEXT_BYTES = 1_048_576;
/** Quanto si aspetta la misura di un'immagine portata dentro, prima di usare quella di serie. */
export const MEASURE_IMAGE_TIMEOUT_MS = 3_000;
/** Quante immagini si misurano insieme quando ne arrivano tante. */
export const MEASURE_IMAGE_PARALLEL = 4;
/**
 * Oltre questi file trascinati i riquadri tratteggiati non si calcolano: la
 * cornice del gruppo li direbbe, ma una compilazione di migliaia di schede a
 * ogni entrata non vale un'anteprima.
 */
export const MAX_DROP_GHOSTS = 1000;
/**
 * I punti al più del cammino di un `erase_along`: `MAX_ERASE_POINTS` del
 * nucleo (`crates/fub-canvas-core/src/ops/erase.rs`), quanti campioni ha un
 * tratto. Un cammino più lungo va in più operazioni.
 */
export const ERASE_ALONG_MAX_POINTS = 10_000;
/**
 * Il lavoro che la tela concede a un `erase_along`: metà di `MAX_ERASE_WORK`
 * del nucleo (50 000 000 distanze), perché la stima della tela
 * (`eraseAlongSegments`) non sa i segmenti che il nucleo trova vicini.
 */
export const ERASE_ALONG_WORK = 25_000_000;
/**
 * Le schede al più di una `move` con `contents`, quelle date più quelle dei
 * gruppi: `MAX_MOVED` del nucleo (`crates/fub-canvas-core/src/ops/adjust.rs`).
 */
export const MOVE_CONTENTS_MAX = 1_000;
export const utf8 = new TextEncoder();
export const MAX_INTERACTIVE_NODES = 2_000;
export const MAX_INTERACTIVE_EDGES = 4_000;

export interface CanvasChange {
  readonly text: string;
  readonly operation: CanvasOperation;
  readonly origin: EditorChangeOrigin;
}

export interface CanvasMediaPort {
  readonly openExternal: (target: string) => void | Promise<void>;
  readonly openViewer?: (target: string) => void | Promise<void>;
}
/** External bytes become cards only after deposit returns; no implicit file writes. */
export interface CanvasAttachmentPort {
  /** Receipts contain vault-relative paths after collision-safe, explicit deposit.
   *  `cards` sono le schede che questo gesto farà nascere coi percorsi tornati:
   *  un gesto dopo (la notifica «Fanne una copia», T32b) le ripunta per id. */
  readonly deposit: (files: readonly File[], documentId: string, cards: CanvasDepositCards) => Promise<readonly string[]>;
  /** Resolve only existing trusted vault paths/folders, never local filesystem bytes. */
  readonly resolvePaths?: (data: DataTransfer, documentId: string) => Promise<readonly string[]>;
  /** Enumerate direct files and OS folder entries once; every result passes through deposit. */
  readonly expandFiles?: (data: DataTransfer) => Promise<readonly File[]>;
}

/** Una scheda da ripuntare: mostrava `from`, mostrerà `to`. */
export interface CanvasRepoint {
  readonly from: string;
  readonly to: string;
}

/**
 * Le schede nate da un deposito dal computer (T32b). La lavagna le ricorda per
 * id, non per percorso: una scheda tolta dopo non si tocca, una spostata si
 * ripunta lo stesso, e una che mostra già un altro file resta com'è. Una
 * scheda che il vault aveva già sulla lavagna, con lo stesso file, non è di
 * questo gesto e non cambia.
 */
export interface CanvasDepositCards {
  /** Falso dopo che la lavagna è stata chiusa o è diventata di sola lettura:
   *  l'azione di una notifica rimasta a galla non fa più niente. */
  readonly live: () => boolean;
  /** Ripunta le schede del gesto in un commit solo (un Ctrl+Z torna ai file di
   *  prima) e dice quante ne ha cambiate. */
  readonly repoint: (changes: readonly CanvasRepoint[]) => number;
}

/**
 * Dove la tela apre le sue lavagne: per difetto il nucleo condiviso della
 * shell (`wasm/core.ts`). `openNow` apre subito, o dà `null` se il nucleo non
 * è carico; `ready` lo carica.
 */
export interface CanvasCorePort {
  readonly openNow: (text: string) => CanvasCore | null;
  readonly ready: () => Promise<void>;
}

export const SHARED_CORE: CanvasCorePort = { openNow: openCoreNow, ready: canvasCoreReady };

/**
 * Dove la lavagna ricorda l'interruttore «Scrivi col mouse»: `read` dà lo
 * stato con cui una lavagna che si apre comincia (spento, salvo «Ricorda se
 * scrivi col mouse» acceso); `save` ricorda una scelta fatta col pulsante.
 * Per difetto lo stato di vista di questo computer (`preferences.ts`).
 */
export interface CanvasInkMouseMemory {
  readonly read: () => Promise<boolean>;
  readonly save: (on: boolean) => void;
}

export const SHARED_INK_MOUSE: CanvasInkMouseMemory = { read: readInkMouse, save: saveInkMouse };

/**
 * Dove la lavagna ricorda la penna scelta nel menu (A19): `read` dà quella
 * con cui una lavagna che si apre comincia, `save` ricorda una scelta fatta.
 * Per difetto lo stato di vista `canvas.pen` di questo computer.
 */
export interface CanvasPenMemory {
  readonly read: () => Promise<InkPenChoice>;
  readonly save: (choice: InkPenChoice) => void;
}

export const SHARED_PEN: CanvasPenMemory = { read: readPen, save: savePen };

/**
 * Dove porta un link scritto in una scheda (N6 T57): un wikilink
 * `[[pagina#sezione^blocco]]`, o un percorso del vault che la montatura
 * riconosce come file (`a.internal-path`).
 */
export type CardLinkRef =
  | { readonly kind: "wiki"; readonly page: string; readonly heading: string | null; readonly block: string | null }
  | { readonly kind: "path"; readonly path: string };

export interface CanvasEngineOptions {
  readonly surfaceId: string;
  /** Il nucleo che apre le lavagne; i test ne passano uno che conta le chiamate. */
  readonly core?: CanvasCorePort;
  readonly formatId?: string | null;
  readonly revision?: string;
  readonly onChange: (change: CanvasChange) => void;
  readonly onSelectionChange: () => void;
  readonly onOpenWikilink?: (page: string, heading: string | null, block: string | null) => void | Promise<void>;
  readonly onOpenPath?: (path: string, from?: string) => void | Promise<void>;
  /** «Apri a lato» dal menu di una scheda di file: come `onOpenPath`, in un riquadro accanto. */
  readonly onOpenPathBeside?: (path: string, from?: string) => void | Promise<void>;
  /** «Apri a lato» di un wikilink di una scheda che non è sulla lavagna (T57), come quello di una nota. */
  readonly onOpenWikilinkBeside?: (page: string, heading: string | null, block: string | null) => void | Promise<void>;
  /**
   * Dove porta un link scritto in una scheda (T57): il file del vault a cui
   * punta, o `null` se non c'è (un link rotto). `from` è la nota in cui il link
   * è scritto, o la lavagna. La risolve la shell come per le note: la tela non
   * conosce i nomi. Assente, i link delle schede si seguono come prima, dalla
   * montatura.
   */
  readonly resolveCardLink?: (link: CardLinkRef, from?: string) => Promise<string | null>;
  /**
   * «Sposta anche il file nel cestino» (T17): il file `path` del vault nel
   * cestino, con il gesto dell'albero. `true` se il file è nel cestino,
   * `false` se è rimasto (una domanda a cui si è detto di no); un rifiuto
   * dell'host arriva come errore. Mai la conseguenza di un tasto.
   */
  readonly onTrashPath?: (path: string) => Promise<boolean>;
  /**
   * Le note per «Estrai in una nota» e «Copia il testo qui» (T70): il nome
   * libero da proporre, la nota che nasce col testo, il testo di una nota.
   * Assente: i due comandi non ci sono.
   */
  readonly notes?: CanvasNotesPort;
  /**
   * Sceglie il file del vault a cui punta una nuova card file; `null` o niente
   * se l'utente rinuncia. Assente = niente bottone «aggiungi file»: una card
   * che punta a un file inventato è un rimando rotto scritto nel documento.
   * Con `name` (il nome del file di una scheda che non c'è più, «Ritrova…») la
   * scelta mette per prima una voce con quel nome.
   */
  readonly onPickFile?: (name?: string) => string | null | void | Promise<string | null | void>;
  readonly documentId?: string;
  readonly media?: CanvasMediaPort;
  readonly attachments?: CanvasAttachmentPort;
  readonly theme?: Theme;
  /**
   * Il testo in sospeso di una scheda è cambiato: `true` se ne resta. Nessun
   * lavoro in più: chi ascolta chiede `pendingText` quando gli serve.
   */
  readonly onPendingChange?: (pending: boolean) => void;
  /**
   * Una voce della banda di stato può essere cambiata: a fine gesto, mai a
   * ogni fotogramma (`chrome/status.ts`). Chi ascolta la rilegge con
   * `statusItems`.
   */
  readonly onStatusChange?: () => void;
  /** Apre le Impostazioni su una voce (la cartella dei file trascinati, dalla banda). */
  readonly onOpenSettings?: (key: string) => void;
  /**
   * Resa markdown reale di una card testo (stesso `renderMarkdown` della
   * lettura, con `mountMarkdown` per sanitizzazione/embed). Assente = testo
   * non interattivo: nessun secondo parser né scanner locale. `forms` sono le
   * sintassi che il vault dà al Markdown delle card (`EMBEDDED_GRAMMAR`);
   * assenti finché la superficie non le ha ricevute.
   */
  readonly renderMarkdownForCard?: (
    nodeId: string,
    text: string,
    host: HTMLElement,
    forms: readonly SyntaxForm[] | undefined,
  ) => (() => void) | void;
  /**
   * «Il dito sposta le schede», letto quando il primo dito si posa: un cambio
   * vale dal tocco dopo. I test lo passano; assente, la lavagna segue le
   * Impostazioni di questo computer (`watchPreferences`).
   */
  readonly fingerMovesCard?: () => boolean;
  /**
   * Dove si ricorda «Scrivi col mouse»: letto una volta all'apertura, scritto
   * a ogni clic sul pulsante. I test lo passano; assente, lo stato di vista
   * di questo computer.
   */
  readonly inkMouseMemory?: CanvasInkMouseMemory;
  /**
   * Dove si ricorda la penna del menu: letta una volta all'apertura, scritta
   * a ogni scelta. I test lo passano; assente, lo stato di vista di questo
   * computer.
   */
  readonly penMemory?: CanvasPenMemory;
  /**
   * Dove si ricordano i comandi usati di recente in ogni lavagna, per la
   * ricerca dei comandi (T48). I test lo passano; assente, lo stato di vista
   * di questo computer.
   */
  readonly recentCommands?: RecentCommands;
  /**
   * Le schede di file e di link: chi le disegna per specie e le immagini
   * ferme. Assente (un'altra finestra, le prove vecchie): il corpo di sempre,
   * col percorso e il segnaposto.
   */
  readonly cards?: CanvasCards;
  /**
   * La misura in pixel dell'immagine `path` del vault, per la misura di
   * nascita della sua scheda (T15); `null` se non si sa. Assente, o una
   * risposta che non arriva in tempo: la misura di serie della specie.
   */
  readonly measureImage?: (path: string) => Promise<{ readonly width: number; readonly height: number } | null>;
  /**
   * Il Markdown dell'HTML degli appunti (una tabella copiata da un foglio o da
   * una pagina), come lo incolla l'editor Markdown; `null` se non ce n'è.
   * Assente: l'HTML non si legge, e le celle arrivano solo dal testo a
   * tabulazioni.
   */
  readonly clipboardMarkdown?: (data: DataTransfer) => Promise<string | null>;
  /**
   * Dove si ricorda la vista della lavagna su questo computer (T36): la
   * camera, la scelta e la pagina dei PDF, lette all'apertura e scritte con
   * un ritardo. Assente, o senza `documentId`: si inquadra tutto a ogni
   * apertura, come prima.
   */
  readonly viewMemory?: CanvasViewMemory;
  /**
   * Il sommario di una nota e la resa di una sua sezione, per il selettore
   * delle sezioni (T74). Assente: niente selettore e niente «Parti…».
   */
  readonly parts?: PartsPickerPort;
  /**
   * Chi chiede all'indice del vault quali note della lavagna contengono una
   * ricerca (T60); senza, la richiesta `documents` di `searchBoardNotes`. I
   * test ne passano una che conta le chiamate.
   */
  readonly findNotes?: FindNotesPort;
  /**
   * Il seme degli id che il nucleo dà alle schede, ai fili e ai tratti nati
   * da un'azione (`compile`, `docs/reference/canvas-code.md` § «Gli id
   * nuovi»): uno nuovo per ogni azione. Di serie un numero a caso
   * (`crypto.getRandomValues`); i test lo fissano, così l'azione della tela
   * dà la stessa lavagna della sua forma in codice.
   */
  readonly seed?: () => bigint;
  /**
   * L'id di una scheda che un gesto fa nascere e che altre operazioni della
   * stessa lista nominano (il rilascio di file, Collega nel vuoto, Ctrl+Invio
   * in una scheda): di serie `newNodeId()`. Le prove lo fissano, come `seed`.
   */
  readonly newId?: () => string;
}

/**
 * Le note che la lavagna crea e legge (T70). La shell le fa coi suoi gesti
 * (`note.create`, la lettura di un documento); la tela non conosce il vault.
 */
export interface CanvasNotesPort {
  /**
   * Il nome da proporre per una nota `name` nella cartella `folder` (`""` è la
   * radice): `name` se è libero, se no `name 1`, `name 2`… È solo una
   * proposta: se nel frattempo il nome si occupa, lo dice `create`.
   */
  freeName(folder: string, name: string): Promise<string>;
  /**
   * Crea la nota `name` nella cartella `folder` col testo `text` e torna il
   * suo percorso nel vault. Un nome già preso è un errore, mai una nota
   * sovrascritta.
   */
  create(folder: string, name: string, text: string): Promise<string>;
  /** Il testo della nota `path` com'è adesso (anche non ancora salvato). */
  read(path: string): Promise<string>;
}

/**
 * Le schede della tela: il registro dei renderer, la cache delle immagini ferme
 * e l'ascolto dei file. Una scheda il cui file manca non ha una vista: `watch`
 * avvisa quando il file torna, e la scheda si rimonta da sé (T16).
 */
export interface CanvasCards {
  readonly registry: CardRegistry;
  readonly snapshots: CardSnapshots;
  /**
   * La porta per scrivere dentro le schede (T40), che la tela passa alle
   * viste (`CardContext.editors`); assente, le schede si leggono e basta.
   */
  readonly editors?: CardEditorPort;
  /** Avvisa quando il file `path` cambia, sparisce o torna; restituisce come smettere. */
  watch(path: string, changed: () => void): () => void;
  /**
   * Le pagine di un PDF per «Spargi le pagine» (T72). Assente (senza il lettore
   * dei PDF): il comando è spento col perché.
   */
  readonly pdfPages?: PdfPagesReader;
  /**
   * Quante note citano il file di una scheda, per «↩ N» nella testata (T22):
   * l'indice, con la domanda `backlinks`. Assente, la testata non lo dice.
   */
  readonly citations?: CardCitations;
}
