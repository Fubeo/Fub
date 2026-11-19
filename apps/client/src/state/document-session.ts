// Stato autorevole e protocollo di persistenza di un documento aperto.
//
// Un `DocumentSession` è una sola istanza per documento: possiede il testo,
// l'origine della scrittura, la coda e i due debounce. Il pannello possiede le
// superfici e osserva soltanto eventi e snapshot immutabili.
import { api as defaultApi } from "../host/ipc";
import type { DocumentSource, DraftInfo, Origin, WriteBase } from "../host/contract";
import type { SourceKind } from "../host/enums.generated";
import { Queue } from "../ui/race";
import {
  consumeOwnEcho,
  consumeUnderChange,
  failureOutcome,
  stateOf,
  writeCountingEcho,
  type Outcome,
  type SaveState,
} from "./saving";
import { rejoinDrafts, type DraftBuffer, type DraftBufferStore } from "./drafts";
import { state as shellState } from "./store";
import { renameNote, vaultArg } from "./vault";
import { lineFeeds, tryApplyOperation, type TextOperation } from "../editors/core/text-operation";
import { rebaseGridJournalText } from "./grid-journal";

const SAVE_MS = 400;
/// Quanto vale l'annuncio di una scrittura di un comando (`expectWrite`): il
/// suo evento arriva mentre il comando scrive, cioè subito. Oltre, l'annuncio
/// non zittisce più niente.
const EXPECTED_WRITE_MS = 10_000;
/** La cadenza delle bozze: al più una ogni `DRAFT_MS` mentre si scrive. */
export const DRAFT_MS = 1_000;


/// La porta con cui una superficie si sottoscrive a una sessione. Soltanto
/// dati: niente DOM, niente editor, niente cursore, selezione o history —
/// ciò che la superficie fa del dato ricevuto resta tutto suo.
export interface DocumentSurface {
  /// Identità stabile e opaca della registrazione. Due registrazioni con la
  /// stessa identità sono la stessa superficie rimontata, non due superfici.
  readonly id: string;
  /// Il dato autorevole da applicare. Sincrono: la sessione non aspetta
  /// niente da chi lo riceve.
  sync(update: DocumentSurfaceUpdate): void;
  /// La sessione si è chiusa per sempre e la superficie è già staccata: per
  /// chi vive oltre un riquadro, come una sessione live.
  closed?(): void;
  /// Il testo intero con dentro ciò che la superficie tiene ancora per sé (una
  /// scheda della lavagna prima della sua pausa); `null` se non tiene niente.
  /// Lo legge soltanto la bozza.
  pendingText?(): string | null;
  /// Registra adesso il testo tenuto per sé: diventa una modifica della
  /// sessione, come alla fine della pausa. Se la registrazione passa da un
  /// passo asincrono (la cella di un foglio, confermata dal suo provider) la
  /// superficie ne dà la promessa, e la sessione la aspetta prima di
  /// salvare, leggere il disco o chiudersi (`settled`).
  commitPending?(): void | Promise<void>;
  /// Avvisa a ogni cambio del testo tenuto per sé, con `true` se ne resta.
  /// L'avviso non chiama il nucleo; il disposer lo ferma.
  watchPending?(listener: (pending: boolean) => void): () => void;
}

/// Ciò che la sessione diffonde alle superfici: o l'operazione tipizzata
/// appena accettata (ai **pari** della sorgente), o il testo autorevole per
/// intero (una sostituzione esterna: ricarica pulita, conflitto, bozza).
export type DocumentSurfaceUpdate =
  | { kind: "operation"; text: string; operation: TextOperation }
  | { kind: "text"; text: string };

/// Una modifica dell'editor ridotta ai soli dati che la sessione valida.
export interface SurfaceEdit {
  readonly text: string;
  readonly operation: TextOperation;
}

/// Esito di una modifica portata da una superficie: accettata (e diffusa ai
/// pari), oppure respinta col testo autorevole a cui la sorgente si
/// riallinea, senza che la sessione abbia mutato nulla.
export type SurfaceChangeResult =
  | { kind: "accepted" }
  | { kind: "realigned"; text: string }
  | { kind: "untracked" };

/// Ogni porta accetta in coda il **vault** a cui rivolgersi (FUB-001). La
/// sessione lo fissa quando nasce e lo ripete a ogni chiamata: «il vault
/// corrente» dell'host cambia quando se ne apre un altro, e un salvataggio o
/// una bozza partiti dopo non devono finire in quello nuovo. Assente: l'host
/// risponde con il corrente, come prima.
///
/// Leggere non apre. Una sessione apre il suo documento sotto la sua **chiave
/// di apertura** (`open`), e la chiude quando esce per sempre: con
/// `openDocument` legge, con `writeDocument(…, open)` scrive, con
/// `documentClosed(open)` chiude. Quali documenti l'host tiene sotto la chiave
/// lo decide l'host: la sessione la passa per ogni formato. `readDocument` è
/// la lettura semplice, che non tiene niente.
export interface DocumentSessionApi {
  readDocument(id: string, vault?: string | null): Promise<DocumentSource>;
  openDocument(id: string, open: string, vault?: string | null): Promise<DocumentSource>;
  writeDocument(id: string, text: string, base: WriteBase, vault?: string | null, open?: string): Promise<string>;
  /// I byte di un file che nessun formato serve — un `.svg`, un `.txt`. Il
  /// kernel rifiuta `writeDocument` su quei file, perché non c'è un modello
  /// da riparsare, e accetta i byte con la stessa guardia: `expected` è la
  /// revisione attesa sul disco (CAS), `null` una creazione esclusiva.
  resourceWrite(
    id: string,
    bytes: Uint8Array,
    expected: string | null,
    vault?: string | null,
  ): Promise<{ readonly revision: string }>;
  saveDraft(id: string, text: string, base: string | null, vault?: string | null): Promise<void>;
  discardDraft(id: string, vault?: string | null): Promise<void>;
  /// La sessione con la chiave `open` è uscita: l'host lascia andare ciò che
  /// teneva sotto la chiave. Chiudere una chiave sconosciuta o già chiusa non
  /// costa niente.
  documentClosed(open: string, vault?: string | null): Promise<void>;
}

/// Le porte che una `DocumentSession` vede: quelle della collezione, già
/// legate al vault e alla chiave della sessione.
interface SessionPort {
  readDocument(id: string): Promise<DocumentSource>;
  writeDocument(id: string, text: string, base: WriteBase): Promise<string>;
  saveDraft(id: string, text: string, base: string | null): Promise<void>;
  discardDraft(id: string): Promise<void>;
}

/// La chiave di una bozza lasciata da una cancellazione da fuori.
function removedDraftKey(id: string, vault: string | null): string {
  return `${vault ?? ""}\u0000${id}`;
}

/// Una chiave di apertura nuova: un UUID, o 32 cifre esadecimali dove
/// `crypto.randomUUID` manca (una pagina servita in un contesto non sicuro,
/// come il client di prova su HTTP). Tutte e due stanno nella forma che l'host
/// accetta: da 1 a 64 fra lettere, cifre, `-` e `_`.
function newOpenKey(): string {
  const random = globalThis.crypto;
  if (typeof random.randomUUID === "function") return random.randomUUID();
  const bytes = random.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export interface DocumentSurfaceDescriptor {
  readonly formatId: string | null;
  readonly sourceKind: SourceKind;
  readonly revision?: string;
}

export interface DocumentSurfaceSource extends DocumentSurfaceDescriptor {
  readonly text: string;
}

export interface DocumentSessionSnapshot {
  readonly id: string;
  readonly text: string;
  readonly base: WriteBase;
  readonly dirty: boolean;
  readonly result: Outcome;
  readonly saveState: SaveState | null;
  readonly echoes: number;
  readonly suspended: boolean;
  readonly pendingDeletion: boolean;
  readonly lifecycle: "open" | "closed";
}

export type ExternalChangeResult =
  | { kind: "untracked" }
  | { kind: "echo" }
  | { kind: "warning"; cause: "altra_app" | "riscrittura" }
  /// `quiet`: la scrittura era quella che un comando aveva annunciato
  /// (`expectWrite`), e la ricarica non si dice.
  | { kind: "reloaded"; text: string; changed: boolean; quiet?: true }
  | { kind: "stale" }
  | { kind: "unavailable" };

export type ReloadResult =
  | { kind: "missing" }
  | { kind: "dirty" }
  | { kind: "reloaded"; text: string; changed: boolean }
  | { kind: "stale" }
  | { kind: "unavailable" };
type DiskReloadResult = Exclude<ReloadResult, { kind: "missing" } | { kind: "dirty" }>;

export type ConflictResolutionResult =
  | { kind: "none" }
  | { kind: "kept" }
  // `kept`: il testo dell'utente (quello che c'era alla scelta) è nella
  // Cronologia, conservato adesso o da un «Usa disco» di prima sullo stesso
  // testo. Con la rilettura mancata è ciò che dice all'utente che il testo è
  // salvo anche se il conflitto resta aperto.
  | { kind: "discarded"; reload: ReloadResult; kept: boolean }
  // Il testo dell'utente non si è potuto mettere in salvo: niente è stato
  // scartato, il conflitto resta aperto e la scelta si può ripetere.
  | { kind: "keep-failed"; error: unknown };

/// Mette in salvo il testo che «Usa disco» sta per scartare (la shell lo
/// conserva nella cronologia con `version.keep`). Una promessa rifiutata
/// ferma lo scarto.
export type KeepDiscarded = (text: string) => Promise<void>;

export type RenameResult =
  | { kind: "renamed"; from: string; to: string }
  | { kind: "already-renamed"; from: string; to: string }
  | { kind: "missing"; from: string; to: string }
  | { kind: "collision"; from: string; to: string };

export type DeletionResult =
  | { kind: "deleted"; dirty: boolean }
  | { kind: "ignored" };
/// `unsaved`: il buffer è rimasto sporco dopo il flush — il salvataggio è
/// fallito o c'è un conflitto — e la sessione **resta aperta**. Chiudere una
/// sessione così butterebbe l'unica copia del lavoro; la decisione è di chi ha
/// chiuso la linguetta, non di questa collezione.
export type CloseResult =
  | { kind: "closed"; dirty: boolean }
  | { kind: "unsaved" }
  | { kind: "active" }
  | { kind: "missing" };

/// `text` c'è quando il buffer era sporco: il lavoro non salvato, messo in
/// bozza e restituito a chi può offrire di ricreare la nota.
export type ExternalRemovalResult = { kind: "removed"; dirty: boolean; text?: string };

export type ConflictChoice = "mine" | "theirs";
export type DocumentSessionEvent =
  | { kind: "changed"; id: string }
  | { kind: "saved"; id: string }
  | { kind: "save-failed"; id: string; error: unknown; outcome: "conflitto" | "fallito" }
  | { kind: "draft-blind"; id: string }
  /// Dopo un `draft-blind`, la prima bozza che torna a scriversi: la rete
  /// sotto il testo non salvato c'è di nuovo (`id` è la nota di quella bozza).
  | { kind: "draft-restored"; id: string }
  | { kind: "deletion-changed"; id: string; pending: boolean };

type SessionListener = (event: DocumentSessionEvent) => void | Promise<void>;


type SessionHooks = {
  emit(event: DocumentSessionEvent): void | Promise<void>;
  /// Il testo della sessione è il giornale delle celle di una cartella
  /// (`text_kind` `grid_journal`): salvarlo lo mette nei byte.
  journal(): boolean;
  draftSucceeded(id: string): void;
  draftFailed(id: string): void;
};

interface SessionState {
  text: string;
  base: WriteBase;
  dirty: boolean;
  result: Outcome;
  echoes: number;
  suspended: boolean;
  pendingDeletion: boolean;
  lifecycle: "open" | "closed";
}

interface DraftWork {
  readonly id: string;
  readonly generation: number;
  readonly promise: Promise<void>;
}

interface DraftOutcome {
  readonly generation: number;
  readonly succeeded: boolean;
}

const OWNER_TOKEN = Symbol("DocumentSession owner");
type OwnerToken = typeof OWNER_TOKEN;

function copyBase(base: WriteBase): WriteBase {
  return base.kind === "dictated"
    ? { kind: "dictated" }
    : { kind: "descends_from", value: base.value };
}

class DocumentDeletedDuringRead extends Error {
  constructor(id: string) {
    super(`document ${id} was deleted while it was loading`);
    this.name = "DocumentDeletedDuringRead";
  }
}

function failDeletedRead(id: string): never {
  throw new DocumentDeletedDuringRead(id);
}

export function isDocumentDeletedDuringRead(error: unknown): boolean {
  return error instanceof DocumentDeletedDuringRead;
}

/** The per-document owner. Its constructor is guarded by the collection token. */
export class DocumentSession implements DraftBuffer {
  #id: string;
  #state: SessionState;
  /// La coda delle scritture del file e dei comandi distruttivi.
  #queue = new Queue();
  /// La coda delle bozze, separata da quella del file (#485): una bozza parte
  /// anche mentre una scrittura lenta è in volo, con la base che quella
  /// scrittura conosce, così un crash in quei secondi ha comunque il testo.
  /// Una sola scrittura o un solo scarto di bozza alla volta: l'host le riceve
  /// nell'ordine in cui sono partite, e una risposta vecchia non passa sopra a
  /// una bozza più nuova.
  #draftQueue = new Queue();
  #saveTimer: number | undefined;
  #draftTimer: number | undefined;
  #draftGeneration = 0;
  #draftWork: DraftWork | undefined;
  #draftOutcome: DraftOutcome | undefined;
  #externalGeneration = 0;
  #activityGeneration = 0;
  /// Il testo che «Usa disco» ha già messo in salvo in questo conflitto: se la
  /// rilettura è mancata e la scelta si ripete sullo stesso testo, non si
  /// conserva una seconda volta.
  #keptInConflict: string | undefined;
  readonly #api: SessionPort;
  readonly #hooks: SessionHooks;
  /// Le superfici sottoscritte, per identità di registrazione. È ownership di
  /// ciclo di vita, non un registro di famiglie: chi si toglie chiude, la
  /// chiusura della sessione chiude tutti.
  readonly #surfaces = new Map<string, DocumentSurface>();
  /// Le superfici che tengono testo non ancora registrato, per identità.
  readonly #pendingSurfaces = new Set<string>();
  /// Lo stop dell'avviso di ogni registrazione.
  readonly #pendingWatches = new Map<DocumentSurface, () => void>();

  constructor(
    token: OwnerToken,
    id: string,
    text: string,
    base: WriteBase,
    api: SessionPort,
    hooks: SessionHooks,
  ) {
    if (token !== OWNER_TOKEN) throw new Error("DocumentSession must be created by its owner");
    this.#id = id;
    this.#state = {
      text,
      base: copyBase(base),
      dirty: false,
      result: "ok",
      echoes: 0,
      suspended: false,
      pendingDeletion: false,
      lifecycle: "open",
    };
    this.#api = api;
    this.#hooks = hooks;
  }

  get dirty(): boolean {
    return this.#state.dirty;
  }

  get id(): string {
    return this.#id;
  }

  text(): string {
    return this.#state.text;
  }

  result(): Outcome {
    return this.#state.result;
  }

  saveState(): SaveState | null {
    return stateOf(this.#state);
  }

  snapshot(): DocumentSessionSnapshot {
    return {
      id: this.#id,
      text: this.#state.text,
      base: copyBase(this.#state.base),
      dirty: this.#state.dirty,
      result: this.#state.result,
      saveState: this.saveState(),
      echoes: this.#state.echoes,
      suspended: this.#state.suspended,
      pendingDeletion: this.#state.pendingDeletion,
      lifecycle: this.#state.lifecycle,
    };
  }
  activityGeneration(): number {
    return this.#activityGeneration;
  }

  retain(): void {
    if (this.#isOpen()) this.#activityGeneration++;
  }

  /**
   * The validated surface path is the only production mutation entry. This
   * helper keeps the mutation itself private while programmatic replacement
   * paths continue to use `restoreDraft`/`syncDoc` without a fake operation.
   */
  #acceptTextChange(text: string): void {
    if (!this.#isOpen() || this.#state.pendingDeletion) return;
    this.#activityGeneration++;
    this.#externalGeneration++;
    this.#draftGeneration++;
    this.#state.text = text;
    this.#state.dirty = true;
    // Persistence is armed before observers can throw. A synchronous UI
    // observer may still reject the call, but it cannot lose the edit.
    this.scheduleSave();
    this.scheduleDraft();
    this.#emit({ kind: "changed", id: this.#id });
  }

  /**
   * Una superficie porta la sua operazione tipizzata. La sessione è l'unico
   * posto che la valida: preimage e risultato si misurano sul testo
   * autorevole (sulla stessa normalizzazione di terminatori che poi applica
   * il motore). Respingere non muta niente: la sorgente riceve il testo
   * autorevole e si riallinea da sé. Accettare aggiorna una volta, programma
   * salvataggio e bozza, e diffonde l'operazione a tutti i pari **tranne la
   * sorgente** — che la sua editor ce l'ha già.
   */
  acceptSurfaceChange(surfaceId: string, edit: SurfaceEdit): SurfaceChangeResult {
    if (!this.#isOpen()) return { kind: "untracked" };
    // A pending destructive command makes every editor read-only. Keep the
    // authoritative buffer untouched even if a stale adapter callback arrives.
    if (this.#state.pendingDeletion) return { kind: "realigned", text: this.#state.text };
    // Preimage e atteso passano dallo stesso lavello: devono essere
    // normalizzati identicamente, o la validazione regge per caso.
    const expected = lineFeeds(edit.text);
    const applied = tryApplyOperation(lineFeeds(this.#state.text), edit.operation);
    if (applied.kind !== "applied" || applied.text !== expected) {
      return { kind: "realigned", text: this.#state.text };
    }
    this.#acceptTextChange(edit.text);
    this.#fanOut({ kind: "operation", text: edit.text, operation: edit.operation }, surfaceId);
    return { kind: "accepted" };
  }

  /**
   * Attacca una superficie a questa sessione. L'identità è la chiave: la
   * stessa registrazione attaccata due volte resta una sola sottoscrizione,
   * una rimontata con la stessa identità rimpiazza la precedente. Il disposer
   * è indempiente e stacca soltanto la registrazione che gli è stata data.
   */
  attachSurface(surface: DocumentSurface): () => void {
    if (!this.#isOpen()) return () => {};
    const replaced = this.#surfaces.get(surface.id);
    if (replaced && replaced !== surface) this.#unwatch(replaced);
    this.#surfaces.set(surface.id, surface);
    if (surface.watchPending && !this.#pendingWatches.has(surface)) {
      this.#pendingWatches.set(surface, surface.watchPending((pending) => this.#pendingChanged(surface, pending)));
    }
    return () => {
      if (this.#surfaces.get(surface.id) === surface) this.#surfaces.delete(surface.id);
      this.#unwatch(surface);
    };
  }

  #unwatch(surface: DocumentSurface): void {
    const stop = this.#pendingWatches.get(surface);
    this.#pendingWatches.delete(surface);
    // Una registrazione nuova con la stessa identità tiene il suo stato.
    const current = this.#surfaces.get(surface.id);
    if (current === undefined || current === surface) this.#pendingSurfaces.delete(surface.id);
    try {
      stop?.();
    } catch (error) {
      console.error(error);
    }
  }

  /**
   * Il testo tenuto da una superficie è cambiato. Nessuna chiamata al nucleo
   * né al disco: la bozza si arma con la sua cadenza e, quando parte, chiede il
   * testo intero alla superficie.
   */
  #pendingChanged(surface: DocumentSurface, pending: boolean): void {
    if (this.#surfaces.get(surface.id) !== surface) return;
    if (!pending) {
      this.#pendingSurfaces.delete(surface.id);
      return;
    }
    this.#pendingSurfaces.add(surface.id);
    if (!this.#isOpen() || this.#state.pendingDeletion) return;
    this.#draftGeneration++;
    this.scheduleDraft();
  }

  /// Se una superficie tiene testo che la sessione non ha ancora.
  hasPending(): boolean {
    return this.#isOpen() && this.#pendingSurfaces.size > 0;
  }

  /**
   * Registra il testo che le superfici tengono ancora per sé, prima di ogni
   * passo che legge o sostituisce il buffer: dopo, la sessione ha tutto ciò che
   * è stato scritto (un cambio esterno trova il buffer sporco e diventa un
   * conflitto). Una superficie che fallisce non ferma le altre.
   */
  settlePending(): void {
    void this.#commitHeld();
  }

  /**
   * `settlePending`, con la promessa delle registrazioni che passano da un
   * passo asincrono (la cella di un foglio, confermata dal suo provider), o
   * `null` se non ce ne sono. I passi che possono aspettare — salvare, leggere
   * il disco, chiudere — la aspettano: un testo confermato dopo la chiusura
   * non avrebbe più una sessione in cui entrare. Con `null` non si aspetta
   * niente, e il passo resta sincrono come prima.
   */
  settled(): Promise<void> | null {
    return this.#commitHeld();
  }

  #commitHeld(): Promise<void> | null {
    if (!this.#isOpen() || this.#pendingSurfaces.size === 0) return null;
    const waits: Promise<void>[] = [];
    for (const surface of [...this.#surfaces.values()]) {
      if (!this.#pendingSurfaces.has(surface.id)) continue;
      try {
        const done = surface.commitPending?.();
        if (done) waits.push(done.catch((error: unknown) => console.error(error)));
      } catch (error) {
        console.error(error);
      }
    }
    return waits.length ? Promise.all(waits).then(() => undefined) : null;
  }

  /**
   * `base === null` è una bozza di cui non si sa da quale versione del file sia
   * partita, mentre il file c'è: nessuna base la rende sicura da scrivere. Il
   * buffer rientra allora in conflitto, cioè fermo finché l'utente non sceglie
   * fra il suo testo e il disco — «Mantieni il mio» è l'unica via che detta.
   */
  restoreDraft(text: string, base: WriteBase | null): void {
    if (!this.#isOpen()) return;
    this.settlePending();
    this.#activityGeneration++;
    this.#externalGeneration++;
    this.#draftGeneration++;
    this.#clearSaveTimer();
    this.#clearDraftTimer();
    this.#state.text = text;
    this.#state.base = base === null ? { kind: "dictated" } : copyBase(base);
    this.#state.dirty = true;
    this.#state.result = base === null ? "conflitto" : "ok";
    this.#state.echoes = 0;
    this.#emit({ kind: "changed", id: this.#id });
    this.#fanOut({ kind: "text", text });
  }

  /// Diffonde un dato autorevole alle superfici sottoscritte, esclusa
  /// l'eventuale sorgente. Una diffusione per dato accettato: chi riceve non
  /// ri-entra nella sessione (il motore marca il cambio come remoto).
  #fanOut(update: DocumentSurfaceUpdate, except?: string): void {
    // Ogni superficie riceve il dato anche se una prima di lei ha fallito:
    // l'errore di una è suo, e le altre non devono restare indietro.
    for (const surface of [...this.#surfaces.values()]) {
      if (surface.id === except) continue;
      try {
        surface.sync(update);
      } catch (error) {
        console.error(error);
      }
    }
  }

  /**
   * Consume an external event before applying the clean/dirty policy.
   *
   * `expected`: l'evento è la scrittura che un comando lanciato da qui aveva
   * annunciato (un gesto della barra di una Base). A buffer pulito si
   * ricarica in silenzio: non è un cambio «da fuori». A buffer sporco vale la
   * regola di sempre, perché il testo non salvato va protetto comunque.
   */
  async handleExternalChange(source: Origin, expected = false): Promise<ExternalChangeResult> {
    // L'eco di una nostra scrittura non legge né sostituisce il buffer: sul
    // disco c'è ciò che abbiamo scritto. Il testo che una superficie tiene
    // ancora per sé (la cella di un foglio in cui si sta scrivendo) resta
    // suo: confermarlo qui chiuderebbe la cella a metà parola a ogni
    // salvataggio automatico, e i tasti dopo andrebbero fuori dal foglio
    // (IMP-310, IMP-414). Senza testo tenuto, l'eco segue la via di sempre.
    if (!expected && this.#pendingSurfaces.size > 0 && consumeOwnEcho(this.#state, source)) {
      return { kind: "echo" };
    }
    const held = this.settled();
    if (held) await held;
    const generation = ++this.#externalGeneration;
    if (expected && !this.#state.dirty) {
      const reload = await this.#reloadFromDisk(generation);
      return reload.kind === "reloaded" ? { ...reload, quiet: true } : reload;
    }
    const underChange = consumeUnderChange(this.#state, source);
    if (underChange === "eco") return { kind: "echo" };
    if (underChange === "altra_app" || underChange === "riscrittura") {
      return { kind: "warning", cause: underChange };
    }
    return this.#reloadFromDisk(generation);
  }

  /** Reread a clean document during event reconciliation. */
  async reloadIfClean(): Promise<ReloadResult> {
    if (!this.#isOpen()) return { kind: "missing" };
    const held = this.settled();
    if (held) await held;
    if (this.#state.dirty) return { kind: "dirty" };
    return this.#reloadFromDisk(++this.#externalGeneration);
  }
  /**
   * Reread a document after an explicit command invalidated the buffer.
   *
   * Il buffer si scarta solo quando il disco è stato letto: una lettura fallita
   * lascia testo, stato sporco ed esito com'erano, invece di spacciare per
   * salvato un testo che il disco non contiene più. Nel frattempo niente parte
   * da solo: i timer si fermano subito e si riarmano se la lettura manca.
   *
   * Un buffer sporco va prima in bozza: è la copia che il recupero ritrova
   * dopo che il disco lo ha sostituito. Se la bozza non si scrive la ricarica
   * non parte, e dà `unavailable` con testo e stato com'erano (#237 R02).
   */
  async forceReload(): Promise<ReloadResult> {
    if (!this.#isOpen()) return { kind: "missing" };
    const held = this.settled();
    if (held) await held;
    if (this.#state.dirty && !(await this.flushDraft())) {
      // `flushDraft` ha fermato la cadenza della bozza: si riarma, così il
      // buffer torna protetto appena il disco lo permette.
      if (this.#isOpen() && this.#state.dirty) this.scheduleDraft();
      return this.#isOpen() ? { kind: "unavailable" } : { kind: "missing" };
    }
    if (!this.#isOpen()) return { kind: "missing" };
    this.#activityGeneration++;
    const generation = ++this.#externalGeneration;
    this.#clearSaveTimer();
    this.#clearDraftTimer();
    const reload = await this.#reloadFromDisk(generation, () => {
      this.#draftGeneration++;
      this.#state.dirty = false;
      this.#state.result = "ok";
      this.#state.echoes = 0;
      this.#emit({ kind: "changed", id: this.#id });
      return true;
    });
    if (reload.kind === "unavailable" && this.#state.dirty) {
      this.scheduleSave();
      this.scheduleDraft();
    }
    return reload;
  }

  /**
   * «Usa disco» scarta il buffer e la bozza soltanto dopo che il disco è stato
   * letto: se la lettura manca, il conflitto resta aperto con il testo
   * dell'utente e la sua bozza, e la scelta si può ripetere.
   *
   * Con `keep` il testo dell'utente va prima in salvo: se la conservazione
   * fallisce non si scarta niente, e lo scarto vale solo per il testo
   * conservato — un tasto premuto nel frattempo rende la lettura superata e
   * lascia il conflitto aperto. Un documento a giornale (la griglia,
   * `grid_journal`) non ha un testo da conservare: lì `keep` non si chiama.
   */
  async resolveConflict(choice: ConflictChoice, keep?: KeepDiscarded): Promise<ConflictResolutionResult> {
    const held = this.settled();
    if (held) await held;
    if (!this.#isOpen() || this.#state.result !== "conflitto") return { kind: "none" };
    if (choice === "mine") {
      this.#keptInConflict = undefined;
      await this.saveKeepingMine();
      return { kind: "kept" };
    }
    let kept: string | undefined;
    if (keep && !this.#hooks.journal()) {
      kept = this.#state.text;
      // Lo stesso testo già in salvo da un «Usa disco» la cui rilettura è
      // mancata: una seconda versione uguale non serve a nessuno.
      if (this.#keptInConflict !== kept) {
        try {
          await keep(kept);
        } catch (error) {
          return { kind: "keep-failed", error };
        }
        this.#keptInConflict = kept;
      }
      if (!this.#isOpen() || this.#state.result !== "conflitto") return { kind: "none" };
    }
    const reload = await this.#reloadFromDisk(++this.#externalGeneration, () => {
      if (this.#state.result !== "conflitto") return false;
      // Si scarta soltanto il testo che è stato messo in salvo.
      if (kept !== undefined && this.#state.text !== kept) return false;
      this.discardChanges();
      return true;
    });
    if (reload.kind === "reloaded") {
      this.#keptInConflict = undefined;
      await this.discardDraft();
    }
    return { kind: "discarded", reload, kept: kept !== undefined };
  }

  /**
   * Legge il disco e lo applica come testo pulito. Senza `discard` la rilettura
   * vale solo per un buffer pulito; con `discard` il chiamante scarta il buffer
   * **dopo** la lettura riuscita e soltanto se è ancora valida, e un `false`
   * rende la lettura superata.
   */
  #reloadFromDisk(generation: number, discard?: () => boolean): Promise<DiskReloadResult> {
    const id = this.#id;
    const current = (): boolean =>
      this.#isOpen() &&
      this.#id === id &&
      this.#externalGeneration === generation &&
      (discard !== undefined || !this.#state.dirty);
    return this.#api.readDocument(id).then(
      (source) => {
        if (!current() || (discard !== undefined && !discard())) {
          return { kind: "stale" as const };
        }
        const changed = this.#applyCleanReload(source.text, source.revision);
        return { kind: "reloaded" as const, text: this.#state.text, changed };
      },
      () => (current() ? { kind: "unavailable" as const } : { kind: "stale" as const }),
    );
  }

  #applyCleanReload(text: string, revision: string): boolean {
    if (!this.#isOpen() || this.#state.dirty) return false;
    const before = this.#state.base;
    // Il giornale pulito è sempre vuoto: che il file sia cambiato lo dice la
    // revisione, e la griglia deve riaprirsi sui byte nuovi.
    const moved = this.#hooks.journal() && (before.kind !== "descends_from" || before.value !== revision);
    const changed = this.#state.text !== text || moved;
    const resultChanged = this.#state.result !== "ok";
    this.#state.base = { kind: "descends_from", value: revision };
    this.#state.result = "ok";
    if (changed) this.#state.text = text;
    if (changed) this.#draftGeneration++;
    if (changed || resultChanged) this.#emit({ kind: "changed", id: this.#id });
    // Ricarica pulita, conflitto scartato, comando esplicito: il testo è
    // stato **sostituito** dall'autorità, e tutte le superfici lo ricevono —
    // una volta, e per intero: non c'è una sorgente da escludere.
    if (changed) this.#fanOut({ kind: "text", text });
    return changed;
  }

  discardChanges(): void {
    if (!this.#isOpen()) return;
    this.settlePending();
    this.#activityGeneration++;
    this.#externalGeneration++;
    this.#draftGeneration++;
    this.#clearDraftTimer();
    this.#state.dirty = false;
    this.#state.result = "ok";
    this.#state.echoes = 0;
    this.#emit({ kind: "changed", id: this.#id });
  }
  scheduleSave(): void {
    if (!this.#isOpen() || this.#state.suspended || this.#state.pendingDeletion) return;
    if (this.#state.result === "conflitto") return;
    this.#clearSaveTimer();
    const id = this.#id;
    this.#saveTimer = globalThis.setTimeout(() => {
      this.#saveTimer = undefined;
      void this.#saveNow(id);
    }, SAVE_MS);
  }

  /**
   * Una cadenza, non un rinvio: un timer già armato resta com'è, così chi
   * scrive senza fermarsi ha una bozza al secondo invece di nessuna.
   */
  scheduleDraft(): void {
    if (!this.#isOpen() || this.#state.suspended || this.#state.pendingDeletion) return;
    if (this.#draftTimer !== undefined) return;
    const id = this.#id;
    this.#draftTimer = globalThis.setTimeout(() => {
      this.#draftTimer = undefined;
      void this.#writeDraft(id);
    }, DRAFT_MS);
  }

  async flush(): Promise<boolean> {
    const held = this.settled();
    if (held) await held;
    if (!this.#isOpen() || !this.#state.dirty) return false;
    this.#clearSaveTimer();
    const id = this.#id;
    await this.#saveNow(id);
    return this.#state.dirty;
  }

  /**
   * Scrive la bozza del buffer di adesso e dice se il buffer è al sicuro: la
   * chiusura della finestra decide su questo esito, non sulla notifica.
   */
  async flushDraft(): Promise<boolean> {
    const held = this.settled();
    if (held) await held;
    this.#clearDraftTimer();
    await this.#writeDraft(this.#id);
    return this.#bufferProtected();
  }

  /**
   * Il buffer ha una copia persistente: è pulito, oppure una bozza del testo
   * di adesso è stata scritta. Una sessione chiusa non ha più un buffer da
   * proteggere.
   */
  #bufferProtected(): boolean {
    if (!this.#isOpen() || (!this.#state.dirty && this.#pendingSurfaces.size === 0)) return true;
    const outcome = this.#draftOutcome;
    return outcome?.generation === this.#draftGeneration && outcome.succeeded;
  }

  cancelDraftTimer(): void {
    this.#clearDraftTimer();
  }

  isDeletionPending(): boolean {
    return this.#isOpen() && this.#state.pendingDeletion;
  }

  beginDeletion(): boolean {
    if (!this.#isOpen() || this.#state.pendingDeletion) return false;
    this.settlePending();
    this.#activityGeneration++;
    this.#state.pendingDeletion = true;
    this.#state.suspended = true;
    this.#clearSaveTimer();
    this.#clearDraftTimer();
    this.#emit({ kind: "deletion-changed", id: this.#id, pending: true });
    return true;
  }

  cancelDeletion(): void {
    if (!this.#isOpen() || !this.#state.pendingDeletion) return;
    this.#activityGeneration++;
    this.#state.pendingDeletion = false;
    this.#state.suspended = false;
    if (this.#state.dirty) {
      this.scheduleSave();
      this.scheduleDraft();
    }
    this.#emit({ kind: "deletion-changed", id: this.#id, pending: false });
  }

  suspend(): boolean {
    if (!this.#isOpen()) return false;
    this.settlePending();
    this.#activityGeneration++;
    this.#state.suspended = true;
    const dirty = this.#state.dirty;
    this.#clearSaveTimer();
    this.#clearDraftTimer();
    return dirty;
  }
  resume(): void {
    if (!this.#isOpen() || !this.#state.suspended || this.#state.pendingDeletion) return;
    this.#activityGeneration++;
    this.#state.suspended = false;
    if (!this.#state.dirty) return;
    this.scheduleSave();
    this.scheduleDraft();
  }

  async discardDraft(): Promise<void> {
    if (!this.#isOpen()) return;
    if (!this.#state.pendingDeletion) this.#state.suspended = false;
    this.#clearDraftTimer();
    await this.#dropDraft(this.#id);
  }

  /**
   * Close before running a destructive command, then discard its draft in the
   * same per-session queue. A failed command reopens the exact old session —
   * con le sue superfici: la chiusura qui è provvisoria, e staccarle sarebbe
   * un licenziamento che al ritorno non si ritira.
   */
  async delete(run: (id: string) => Promise<void>): Promise<boolean> {
    if (!this.#isOpen()) return false;
    this.settlePending();
    if (!this.#state.pendingDeletion) {
      if (!this.beginDeletion()) return false;
    }
    if (!this.#closeState(true)) return false;
    const closeActivity = this.#activityGeneration;
    const id = this.#id;
    try {
      await this.#queue.enqueue(() => run(id));
      await this.#dropDraft(id);
    } catch (error) {
      if (
        this.#state.lifecycle === "closed" &&
        this.#activityGeneration === closeActivity
      ) {
        this.#reopen();
      }
      throw error;
    }
    this.#detachSurfaces();
    return true;
  }

  /**
   * La bozza di una sessione già chiusa da una rimozione arrivata da fuori: il
   * testo resta per il recupero. Passa dalla coda delle bozze, dietro quelle
   * già partite, così una bozza più vecchia ancora in volo non le arriva sopra.
   */
  saveDraftAfterClose(text: string, base: string | null): Promise<void> {
    const id = this.#id;
    this.#clearDraftTimer();
    return this.#draftQueue.enqueue(() => this.#api.saveDraft(id, text, base));
  }

  /** Drop a draft after an external deletion already closed this session. */
  discardDraftAfterClose(): Promise<void> {
    this.#clearDraftTimer();
    return this.#dropDraft(this.#id);
  }

  async saveKeepingMine(): Promise<void> {
    const held = this.settled();
    if (held) await held;
    if (!this.#isOpen() || this.#state.result !== "conflitto") return;
    this.#activityGeneration++;
    this.#clearSaveTimer();
    this.#draftGeneration++;
    this.#state.base = { kind: "dictated" };
    this.#state.result = "in_corso";
    this.#emit({ kind: "changed", id: this.#id });
    await this.#saveNow(this.#id);
  }
  rename(id: string): void {
    if (!this.#isOpen() || id === this.#id) return;
    this.settlePending();
    this.#activityGeneration++;
    this.#externalGeneration++;
    this.#draftGeneration++;
    this.#clearSaveTimer();
    this.#clearDraftTimer();
    this.#id = id;
    if (!this.#state.pendingDeletion) this.#state.suspended = false;
    if (this.#state.dirty) {
      this.scheduleSave();
      this.scheduleDraft();
    }
  }

  close(force = false): boolean {
    if (!this.#isOpen()) return false;
    if (!force && this.#state.pendingDeletion) return false;
    this.settlePending();
    if (!this.#closeState(force)) return false;
    // La chiusura è definitiva: nessuna superficie deve restare sottoscritta
    // a una sessione che non esiste più.
    this.#detachSurfaces();
    return true;
  }

  #detachSurfaces(): void {
    const surfaces = [...this.#surfaces.values()];
    this.#surfaces.clear();
    this.#pendingSurfaces.clear();
    for (const surface of surfaces) this.#unwatch(surface);
    for (const surface of surfaces) {
      try {
        surface.closed?.();
      } catch (error) {
        console.error(error);
      }
    }
  }

  #closeState(force = false): boolean {
    if (!force && this.#state.pendingDeletion) return false;
    this.#activityGeneration++;
    this.#externalGeneration++;
    this.#draftGeneration++;
    this.#clearSaveTimer();
    this.#clearDraftTimer();
    this.#state.suspended = false;
    this.#state.pendingDeletion = false;
    this.#state.lifecycle = "closed";
    return true;
  }

  #reopen(): void {
    if (this.#state.lifecycle !== "closed") return;
    this.#activityGeneration++;
    this.#externalGeneration++;
    this.#draftGeneration++;
    this.#state.lifecycle = "open";
    this.#state.suspended = false;
    this.#state.pendingDeletion = false;
    if (this.#state.dirty) {
      this.scheduleSave();
      this.scheduleDraft();
    }
    this.#emit({ kind: "deletion-changed", id: this.#id, pending: false });
  }
  #isOpen(): boolean {
    return this.#state.lifecycle === "open";
  }

  /**
   * Gli eventi raccontano fatti già accaduti e non si aspettano: chi salva non
   * resta in coda dietro al ridisegno della shell. Un ascoltatore asincrono che
   * fallisce non disfa il fatto, ma non sparisce nemmeno come rifiuto orfano.
   */
  #emit(event: DocumentSessionEvent): void {
    const pending = this.#hooks.emit(event);
    if (!pending) return;
    pending.catch((error: unknown) => {
      console.error(`Fub: ascoltatore della sessione fallito su «${event.kind}»`, error);
    });
  }

  #clearSaveTimer(): void {
    if (this.#saveTimer === undefined) return;
    globalThis.clearTimeout(this.#saveTimer);
    this.#saveTimer = undefined;
  }

  #clearDraftTimer(): void {
    if (this.#draftTimer === undefined) return;
    globalThis.clearTimeout(this.#draftTimer);
    this.#draftTimer = undefined;
  }

  #saveNow(id: string): Promise<void> {
    if (!this.#isOpen() || this.#state.pendingDeletion) return Promise.resolve();
    return this.#queue.enqueue(() => this.#writeBuffer(id));
  }

  async #writeBuffer(id: string): Promise<void> {
    // Un conflitto aspetta una decisione (`saveKeepingMine` o lo scarto): né
    // l'autosave né un flush lo riprovano per conto loro.
    if (
      !this.#isOpen() ||
      this.#state.suspended ||
      this.#state.pendingDeletion ||
      this.#id !== id ||
      !this.#state.dirty ||
      this.#state.result === "conflitto"
    ) return;
    const text = this.#state.text;
    const base = copyBase(this.#state.base);
    this.#state.result = "in_corso";
    this.#emit({ kind: "changed", id });

    let produced: string;
    try {
      produced = await writeCountingEcho(this.#state, () => this.#api.writeDocument(id, text, base));
    } catch (error) {
      if (!this.#isOpen() || this.#id !== id) return;
      const outcome = failureOutcome(error);
      this.#state.result = outcome;
      this.#clearDraftTimer();
      void this.#writeDraft(this.#id);
      this.#emit({ kind: "save-failed", id: this.#id, error, outcome });
      return;
    }

    if (!this.#isOpen() || this.#id !== id) return;
    const changed = this.#state.text !== text;
    this.#state.result = "ok";
    this.#state.base = { kind: "descends_from", value: produced };
    if (this.#hooks.journal()) {
      this.#journalSaved(text, changed);
      return;
    }
    if (changed) {
      // Il testo sporco di adesso discende dalla revisione appena scritta. La
      // bozza scritta durante il salvataggio è quella giusta (non si toglie),
      // ma porta la base vecchia: la prossima della cadenza la riscrive sulla
      // nuova.
      this.#draftGeneration++;
      this.scheduleDraft();
    } else {
      this.#state.dirty = false;
      this.#afterCleanSave();
    }
    this.#emit({ kind: "saved", id: this.#id });
  }

  /**
   * Il buffer è sul disco. La bozza se ne va, a meno che una superficie tenga
   * ancora testo: allora resta, e la prossima si scrive sulla base nuova.
   */
  #afterCleanSave(): void {
    if (this.#pendingSurfaces.size === 0) {
      void this.#dropDraft(this.#id);
      return;
    }
    this.#draftGeneration++;
    this.scheduleDraft();
  }

  /// Il giornale `written` è nei byte di `#state.base`: il testo pulito è
  /// vuoto, e ciò che è cambiato durante il salvataggio si riporta sui byte
  /// nuovi. Le superfici ricevono il testo per intero, perché la griglia si
  /// riapre su quei byte.
  #journalSaved(written: string, changed: boolean): void {
    let next = "";
    if (changed) {
      try {
        next = rebaseGridJournalText(this.#state.text, written);
      } catch {
        // Un testo che non è un giornale resta com'è, sporco: l'host lo
        // rifiuterà al prossimo salvataggio, e niente si perde.
        next = this.#state.text;
      }
    }
    this.#draftGeneration++;
    this.#state.text = next;
    if (next === "") {
      this.#state.dirty = false;
      this.#afterCleanSave();
    } else {
      this.scheduleDraft();
    }
    this.#emit({ kind: "saved", id: this.#id });
    this.#fanOut({ kind: "text", text: next });
  }

  #writeDraft(id: string): Promise<void> {
    if (
      !this.#isOpen() ||
      this.#state.suspended ||
      this.#state.pendingDeletion ||
      this.#id !== id ||
      (!this.#state.dirty && this.#pendingSurfaces.size === 0)
    ) {
      return Promise.resolve();
    }
    // Più superfici col loro testo: si registra tutto prima, e la bozza è il buffer.
    if (this.#holders().length > 1) this.settlePending();
    const generation = this.#draftGeneration;
    const pending = this.#draftWork;
    if (pending?.id === id && pending.generation === generation) return pending.promise;
    if (this.#draftOutcome?.generation === generation && this.#draftOutcome.succeeded) {
      return Promise.resolve();
    }

    // La coda delle bozze, non quella del file: la bozza non aspetta una
    // scrittura in volo, e porta la base che quella scrittura conosce ancora.
    const promise = this.#draftQueue.enqueue(async () => {
      if (
        !this.#isOpen() ||
        this.#state.suspended ||
        this.#state.pendingDeletion ||
        this.#id !== id ||
        this.#draftGeneration !== generation
      ) {
        return;
      }
      const text = this.#draftText();
      if (text === null || this.#draftGeneration !== generation) {
        // Niente da proteggere oltre al file: il buffer è pulito e il testo
        // tenuto non è entrato. Il prossimo avviso riarma la bozza.
        if (text === null && this.#draftGeneration === generation) {
          this.#draftOutcome = { generation, succeeded: true };
        }
        return;
      }
      const base = this.#state.base.kind === "descends_from" ? this.#state.base.value : null;
      try {
        await this.#api.saveDraft(id, text, base);
        if (
          !this.#isOpen() ||
          this.#id !== id ||
          this.#draftGeneration !== generation
        ) {
          return;
        }
        this.#draftOutcome = { generation, succeeded: true };
        this.#hooks.draftSucceeded(id);
      } catch {
        if (
          !this.#isOpen() ||
          this.#id !== id ||
          this.#draftGeneration !== generation
        ) {
          return;
        }
        this.#draftOutcome = { generation, succeeded: false };
        this.#hooks.draftFailed(id);
      }
    });
    const work: DraftWork = { id, generation, promise };
    this.#draftWork = work;
    void promise.then(
      () => {
        if (this.#draftWork === work) this.#draftWork = undefined;
      },
      () => {
        if (this.#draftWork === work) this.#draftWork = undefined;
      },
    );
    return promise;
  }

  /**
   * Il testo della bozza: quello che una superficie tiene ancora, dentro il
   * documento intero, se ce n'è una sola; altrimenti il buffer (più schede in
   * sospeso si registrano prima che la bozza parta, e lei le trova insieme nel
   * buffer). `null` se non c'è niente da scrivere adesso.
   */
  #draftText(): string | null {
    const holders = this.#holders();
    if (holders.length === 1) {
      let text: string | null = null;
      try {
        text = holders[0]!.pendingText?.() ?? null;
      } catch (error) {
        console.error(error);
      }
      if (text !== null) return text;
      // Il nucleo non ha preso il testo tenuto: vale l'ultimo testo accettato.
      console.warn(`Fub: la bozza di «${this.#id}» tiene l'ultimo testo accettato`);
    } else if (holders.length > 1) {
      // Arrivate dopo la partenza: si registrano, e la modifica riarma la bozza.
      this.settlePending();
      return null;
    }
    return this.#state.dirty ? this.#state.text : null;
  }

  #holders(): DocumentSurface[] {
    return [...this.#surfaces.values()].filter((surface) => this.#pendingSurfaces.has(surface.id));
  }

  /// Lo scarto passa dalla coda delle bozze: arriva all'host dopo ogni bozza
  /// partita prima, e una bozza partita dopo (testo nuovo) resta.
  #dropDraft(id: string): Promise<void> {
    if (this.#id !== id) return Promise.resolve();
    return this.#draftQueue.enqueue(async () => {
      if (this.#id !== id) return;
      try {
        await this.#api.discardDraft(id);
      } catch {
        // A draft is a safety net; its cleanup is deliberately best effort.
      }
    });
  }
}

/** The sole collection and construction path for document sessions. */
export class DocumentSessionCollection implements DraftBufferStore {
  readonly #api: DocumentSessionApi;
  readonly #sessions = new Map<string, DocumentSession>();
  readonly #surfaceDescriptors = new WeakMap<DocumentSession, DocumentSurfaceDescriptor>();
  /// Le sessioni di un file che il disco ha detto **senza formato**: si
  /// salvano a byte. Solo una lettura riuscita ce le mette — il ripiego di
  /// `readForSurface` non sa che file sia, e non indovina.
  readonly #formatless = new WeakSet<DocumentSession>();
  /// Le sessioni il cui testo è un giornale di celle (`text_kind`
  /// `grid_journal`), anche loro soltanto da una lettura riuscita.
  readonly #journals = new WeakSet<DocumentSession>();
  readonly #listeners = new Set<SessionListener>();
  readonly #identityVersions = new Map<string, number>();
  /// Le scritture che un comando sta per fare su un documento, annunciate da
  /// chi lo lancia (`expectWrite`). Ognuna è un gettone con la sua scadenza:
  /// la consuma il primo evento dell'utente su quel documento.
  readonly #expectedWrites = new Map<string, { deadline: number }[]>();
  readonly #renaming = new Set<string>();
  readonly #deletions = new Map<string, Promise<DeletionResult>>();
  /// Aliases for an owner whose confirmation survives a rename. The pending
  /// bit itself remains owned by `DocumentSession`; this index only lets the
  /// original path resolve that same owner until cancellation/failure/success.
  readonly #pendingDeletionOwners = new Map<string, DocumentSession>();
  /// Counts deletion attempts so a release already waiting on the old owner
  /// can retry after a failed deletion reopens that same owner.
  readonly #deletionVersions = new Map<string, number>();
  #blindDraft = false;
  /// A pending open reserves this owner before any flush/read `await`.
  readonly #openIntents = new Map<string, number>();
  /// Le bozze scritte per un file cancellato da fuori con testo non salvato,
  /// per vault e id, col testo che tengono: «Ricrea la nota» le toglie dopo la
  /// riscrittura (`discardRemovedDraft`), aspettando che la loro scrittura sia
  /// finita, e soltanto se tengono il testo ricreato. Una sessione che si
  /// riapre sull'id toglie la voce: da lì la bozza è sua.
  readonly #removedDrafts = new Map<string, { text: string; saving: Promise<void> }>();
  /// Il vault in cui è nata ciascuna sessione (FUB-001), `null` se nessun vault
  /// era aperto. Si fissa una volta e non cambia: la sessione scrive lì anche
  /// quando l'host ha già aperto un altro vault.
  readonly #vaults = new WeakMap<DocumentSession, string | null>();
  /// La chiave di apertura di ciascuna sessione, accanto al suo vault: nasce
  /// con la sessione (o con la lettura che la crea), la segue nelle rinomine
  /// e si chiude una volta sola, in `#release`, quando la sessione esce per
  /// sempre.
  readonly #keys = new WeakMap<DocumentSession, string>();
  /// Le sessioni uscite, la cui chiave è già chiusa. Una lettura o una
  /// scrittura con la chiave che finisce dopo la richiude.
  readonly #released = new WeakSet<DocumentSession>();
  readonly #currentVault: () => string | null;

  /// `currentVault` dice qual è il vault della shell adesso. Il default è la
  /// radice aperta; una prova o una shell che ne ha un'altra idea la passa.
  constructor(
    api: DocumentSessionApi = defaultApi,
    currentVault: () => string | null = () => shellState.vaultRoot || null,
  ) {
    this.#api = api;
    this.#currentVault = currentVault;
  }

  /// Il vault della sessione di `id`, o quello corrente se non ce n'è una.
  #vaultFor(id: string): string | null {
    const session = this.#sessions.get(id) ?? this.#pendingDeletionOwners.get(id);
    return session ? (this.#vaults.get(session) ?? null) : this.#currentVault();
  }

  /// Il vault con cui parlare di `id`: quello in cui è nato il suo buffer, o il
  /// corrente se il documento non è aperto. Per chi legge o scrive attorno a un
  /// documento senza passare dalla sessione.
  vaultFor(id: string): string | undefined {
    return this.#vaultFor(id) ?? undefined;
  }

  subscribe(listener: SessionListener): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  get(id: string): DocumentSession | undefined {
    return this.#sessions.get(id);
  }

  inspect(id: string): DocumentSessionSnapshot | undefined {
    return this.#sessions.get(id)?.snapshot();
  }

  text(id: string): string | undefined {
    return this.#sessions.get(id)?.text();
  }

  isDirty(id: string): boolean {
    return this.#sessions.get(id)?.dirty === true;
  }
  /// Le bozze non arrivano più sul disco (l'ultima è fallita dopo un
  /// `draft-blind`, e nessuna è tornata a scriversi): chi si monta dopo
  /// l'evento lo rilegge qui.
  isDraftBlind(): boolean {
    return this.#blindDraft;
  }
  /** Conservative fallback if a lifecycle flush rejects before reporting failures. */
  dirtyIds(): string[] {
    const ids: string[] = [];
    for (const [id, session] of this.#sessions) if (session.dirty) ids.push(id);
    return ids;
  }
  isDeletionPending(id: string): boolean {
    const session = this.#sessions.get(id) ?? this.#pendingDeletionOwners.get(id);
    return session?.isDeletionPending() === true;
  }

  saveState(id: string): SaveState | null {
    return this.#sessions.get(id)?.saveState() ?? null;
  }
  /**
   * Reserve an opening before the panel waits for the shared save queue.
   *
   * The reservation is also kept when no session exists yet: that is the
   * window in which a panel read may still be creating the owner. The returned
   * disposer is idempotent and is called by the opening path on both success
   * and failure.
   */
  retain(id: string): () => void {
    this.#sessions.get(id)?.retain();
    this.#openIntents.set(id, (this.#openIntents.get(id) ?? 0) + 1);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const count = this.#openIntents.get(id) ?? 0;
      if (count <= 1) this.#openIntents.delete(id);
      else this.#openIntents.set(id, count - 1);
    };
  }
  async handleExternalChange(id: string, source: Origin): Promise<ExternalChangeResult> {
    // L'annuncio si consuma anche senza sessione: non resta appeso a zittire
    // il prossimo evento, quando il documento si apre. Un evento fuori lotto
    // con un salvataggio della sessione in volo è l'eco di quel salvataggio:
    // lo consuma l'eco (`consumeUnderChange`), e l'annuncio aspetta il suo.
    const session = this.#sessions.get(id);
    const echo = source.batch === null && (session?.snapshot().echoes ?? 0) > 0;
    const expected = source.actor.kind === "user" && !echo && this.#consumeExpected(id);
    if (!session) return { kind: "untracked" };
    return session.handleExternalChange(source, expected);
  }

  /**
   * Annuncia che un comando lanciato da qui sta per riscrivere `id` (un gesto
   * della barra di una Base scrive con `base.view.set`). L'evento di quella
   * scrittura arriva come un cambio dell'utente in un lotto, e senza annuncio
   * la sessione lo direbbe con «è cambiato su disco ed è stato ricaricato».
   * Con l'annuncio la sessione ricarica in silenzio. Si annuncia **prima** di
   * lanciare il comando, perché l'evento parte mentre il comando scrive,
   * prima che la sua risposta arrivi; e si ritira se il comando non scrive
   * (rifiutato, o niente da cambiare), o resterebbe a zittire un cambio vero.
   * Soltanto un evento dell'utente lo consuma: un'altra app (il watcher) e il
   * kernel avvisano sempre. L'annuncio scade dopo `EXPECTED_WRITE_MS`.
   *
   * `graceMs`: chi non sa se il comando ha scritto (un'azione di una view
   * dichiarata) non ritira subito, perché l'evento può arrivare dopo la
   * risposta: accorcia la scadenza a `graceMs` da adesso. Senza timer: la
   * scadenza la legge chi consuma l'annuncio.
   */
  expectWrite(id: string): (graceMs?: number) => void {
    const token = { deadline: Date.now() + EXPECTED_WRITE_MS };
    const tokens = this.#expectedWrites.get(id) ?? [];
    tokens.push(token);
    this.#expectedWrites.set(id, tokens);
    return (graceMs = 0) => {
      if (graceMs > 0) {
        token.deadline = Math.min(token.deadline, Date.now() + graceMs);
        return;
      }
      const left = (this.#expectedWrites.get(id) ?? []).filter((each) => each !== token);
      if (left.length) this.#expectedWrites.set(id, left);
      else this.#expectedWrites.delete(id);
    };
  }

  #consumeExpected(id: string): boolean {
    const now = Date.now();
    const live = (this.#expectedWrites.get(id) ?? []).filter((each) => each.deadline > now);
    const taken = live.shift() !== undefined;
    if (live.length) this.#expectedWrites.set(id, live);
    else this.#expectedWrites.delete(id);
    return taken;
  }
  async reloadIfClean(id: string): Promise<ReloadResult> {
    return (await this.#sessions.get(id)?.reloadIfClean()) ?? { kind: "missing" };
  }

  async read(id: string): Promise<string> {
    const pendingDeletion = this.#deletions.get(id);
    if (pendingDeletion) {
      const outcome = await pendingDeletion;
      if (outcome.kind === "deleted") return failDeletedRead(id);
      return this.read(id);
    }
    const pendingOwner = this.#pendingDeletionOwners.get(id);
    if (pendingOwner?.isDeletionPending()) return pendingOwner.text();
    const existing = this.#sessions.get(id);
    if (existing?.snapshot().lifecycle === "open") {
      existing.retain();
      return existing.text();
    }
    const version = this.#identityVersion(id);
    // Il vault della lettura è quello di quando parte: se mentre aspetta ne
    // viene aperto un altro, il testo è di prima e non deve diventare la
    // sessione di un documento omonimo del vault nuovo.
    const vault = this.#currentVault();
    // La lettura apre già sotto la chiave della sessione che forse nascerà:
    // se non nasce (un'altra sessione si è aperta nel frattempo, una
    // rinomina, un vault o un'identità cambiati, una cancellazione, una
    // lettura fallita) la chiave si chiude subito.
    const open = newOpenKey();
    let adopted = false;
    try {
      const source = await this.#api.openDocument(id, open, ...vaultArg(vault));
      const current = this.#sessions.get(id);
      if (current?.snapshot().lifecycle === "open") return current.text();
      const renamedPendingOwner = this.#pendingDeletionOwners.get(id);
      if (renamedPendingOwner?.isDeletionPending()) return renamedPendingOwner.text();
      const deletion = this.#deletions.get(id);
      if (deletion) {
        const outcome = await deletion;
        if (outcome.kind === "deleted") return failDeletedRead(id);
        return this.read(id);
      }
      if (this.#renaming.has(id) || this.#identityVersion(id) !== version) return source.text;
      if (this.#currentVault() !== vault) return source.text;
      const session = this.#create(id, source.text, {
        kind: "descends_from",
        value: source.revision,
      }, vault, open);
      adopted = this.#keys.get(session) === open;
      this.#describe(session, source);
      return session.text();
    } finally {
      if (!adopted) this.#closeKey(open, vault);
    }
  }

  async readForSurface(id: string): Promise<DocumentSurfaceSource> {
    const text = await this.read(id);
    const session = this.#sessions.get(id) ?? this.#pendingDeletionOwners.get(id);
    const known = session ? this.#surfaceDescriptors.get(session) : undefined;
    if (known) {
      const base = session?.snapshot().base;
      const revision = base?.kind === "descends_from" ? base.value : known.revision;
      return { text, ...known, revision };
    }

    let source: DocumentSource;
    try {
      // Con una sessione si legge sotto la sua chiave; senza (la lettura non
      // è diventata una sessione) è una lettura semplice.
      const vault = this.#vaultFor(id);
      source = session
        ? await this.#underKey(session, (open) => this.#api.openDocument(id, open, ...vaultArg(vault)))
        : await this.#api.readDocument(id, ...vaultArg(vault));
    } catch (error) {
      // Una bozza ripristinata può essere l'unica copia rimasta. Se il backend
      // non sa più descriverne la sorgente, la superficie testuale generica la
      // rende comunque accessibile senza attribuirle capacità Markdown finte.
      if (!session) throw error;
      const fallback: DocumentSurfaceDescriptor = {
        formatId: null,
        sourceKind: "text",
        revision: "",
      };
      this.#surfaceDescriptors.set(session, fallback);
      return { text, ...fallback };
    }

    const current = this.#sessions.get(id) ?? this.#pendingDeletionOwners.get(id);
    if (current) this.#describe(current, source);
    return {
      text,
      formatId: source.format_id,
      sourceKind: source.source_kind,
      revision: source.revision,
    };
  }


  /**
   * Una superficie si sottoscrive alla sessione **unica** del documento. Non
   * c'è sessione, non c'è sottoscrizione: il disposer è comunque restituito,
   * così chi attacca non deve sapere se il documento era già aperto. Il
   * disposer copre solo la sessione a cui ha attaccato: una sessione nata
   * dopo sotto lo stesso id non perde la sua registrazione per un disposer
   * rimasto appeso.
   */
  attachSurface(id: string, surface: DocumentSurface): () => void {
    const session = this.#sessions.get(id) ?? this.#pendingDeletionOwners.get(id);
    if (!session) return () => {};
    const dispose = session.attachSurface(surface);
    return () => {
      // L'owner può cambiare chiave con una rinomina: si deve ancora poter
      // staccare la registrazione, ma mai una sessione nuova nata sotto l'id.
      if (this.#sessions.get(session.id) === session) dispose();
    };
  }

  /** La modifica di una superficie, validata e diffusa dalla sessione. */
  acceptSurfaceChange(id: string, surfaceId: string, edit: SurfaceEdit): SurfaceChangeResult {
    const session = this.#sessions.get(id);
    if (!session) return { kind: "untracked" };
    return session.acceptSurfaceChange(surfaceId, edit);
  }
  async forceReload(id: string): Promise<ReloadResult> {
    return (await this.#sessions.get(id)?.forceReload()) ?? { kind: "missing" };
  }

  restore(id: string, text: string, base: WriteBase | null): void {
    const session =
      this.#sessions.get(id) ?? this.#create(id, text, base ?? { kind: "dictated" }, this.#currentVault());
    session.restoreDraft(text, base);
  }

  /**
   * Le bozze che hanno ancora qualcosa da dire: una bozza con lo **stesso
   * testo** del file sul disco non protegge niente, e si toglie (IMP-1801).
   *
   * Succede quando l'app si chiude mentre un salvataggio è in volo: il file ha
   * già il testo nuovo, ma la bozza porta la revisione di prima, e le sole
   * impronte (`base` diversa da `current`) la fanno sembrare un conflitto a
   * ogni apertura. Qui si confrontano i testi, che la risposta delle bozze non
   * porta: si legge il file di ogni bozza di una nota che c'è, e sono poche
   * (ciò che un crash ha lasciato). Una lettura che non riesce, un testo
   * diverso o una sessione già aperta su quel documento tengono la bozza: si
   * toglie soltanto ciò che il disco ha già, byte per byte. Uno scarto che non
   * riesce tiene la bozza fuori dal recupero di adesso, perché il disco ha lo
   * stesso testo; alla prossima apertura si riprova.
   */
  async withoutSuperseded(drafts: DraftInfo[]): Promise<DraftInfo[]> {
    const vault = this.#currentVault();
    const checked = await Promise.all(drafts.map(async (draft) => {
      if (!draft.exists || this.#sessions.has(draft.doc)) return draft;
      let disk: string;
      try {
        disk = (await this.#api.readDocument(draft.doc, ...vaultArg(vault))).text;
      } catch {
        return draft;
      }
      if (disk !== draft.text) return draft;
      // Nel frattempo il documento si è aperto, o il vault è cambiato: la
      // decisione non vale più per questa bozza.
      if (this.#sessions.has(draft.doc) || this.#currentVault() !== vault) return draft;
      try {
        await this.#api.discardDraft(draft.doc, ...vaultArg(vault));
      } catch {
        // Lo scarto è pulizia: il testo è già sul disco.
      }
      return null;
    }));
    return checked.filter((draft): draft is DraftInfo => draft !== null);
  }

  rejoin(drafts: DraftInfo[]): DraftInfo[] {
    const rejoined = rejoinDrafts(drafts, this);
    for (const draft of rejoined) this.#sessions.get(draft.doc)?.scheduleSave();
    return rejoined;
  }

  /** I documenti ancora sporchi dopo il salvataggio, con l'id che hanno adesso. */
  async flushPendingSave(): Promise<string[]> {
    return (await this.#flushOwners()).map((session) => session.id);
  }

  /**
   * Salva ogni sessione sporca e restituisce quelle rimaste sporche. Segue
   * l'owner e non la chiave: una rinomina durante l'attesa sposta la stessa
   * sessione sotto un altro id, e il suo testo resta da proteggere. Esce
   * soltanto la sessione che nessuno possiede più.
   */
  async #flushOwners(): Promise<DocumentSession[]> {
    const sessions = [...new Set(this.#sessions.values())];
    const outcomes = await Promise.all(
      sessions.map(async (session) => {
        // `flush` registra prima il testo che le superfici tengono ancora.
        if (!session.dirty && !session.hasPending()) return null;
        const dirty = await session.flush();
        return dirty && this.#owns(session) ? session : null;
      }),
    );
    return outcomes.filter((session): session is DocumentSession => session !== null);
  }

  #owns(session: DocumentSession): boolean {
    return this.#sessions.get(session.id) === session;
  }

  async flush(id: string): Promise<boolean> {
    const session = this.#sessions.get(id);
    if (!session) return false;
    const dirty = await session.flush();
    return this.#owns(session) && dirty;
  }

  async flushDraft(id: string): Promise<void> {
    const session = this.#sessions.get(id);
    if (!session?.dirty && !session?.hasPending()) return;
    await session.flushDraft();
  }

  /**
   * Prima della chiusura: salva, mette in bozza ciò che non si è salvato, e
   * restituisce i documenti il cui buffer non ha nessuna copia persistente.
   * Una lista non vuota vieta la chiusura, perché la finestra distrutta
   * porterebbe via l'unica copia di quel testo.
   */
  async flushBeforeClose(): Promise<string[]> {
    for (const session of this.#sessions.values()) session.cancelDraftTimer();
    const pending = await this.#flushOwners();
    const unprotected: string[] = [];
    for (const session of pending) {
      if (!await session.flushDraft()) unprotected.push(session.id);
    }
    return unprotected;
  }

  /// Chiude ogni sessione: un vault nuovo non eredita buffer, bozze pendenti
  /// né identità di quello vecchio. Restituisce i documenti ancora sporchi.
  closeAll(): string[] {
    const dirty: string[] = [];
    for (const [id, session] of [...this.#sessions]) {
      this.#invalidate(id);
      session.settlePending();
      if (session.dirty) dirty.push(id);
      session.close(true);
      this.#release(session);
    }
    this.#sessions.clear();
    this.#pendingDeletionOwners.clear();
    return dirty;
  }

  beginDeletion(id: string): boolean {
    const session = this.#sessions.get(id);
    if (!session) return false;
    const started = session.beginDeletion();
    if (started) this.#rememberPendingOwner(id, session);
    return started;
  }

  cancelDeletion(id: string): void {
    const session = this.#pendingDeletionOwner(id);
    if (!session) return;
    session.cancelDeletion();
    if (!session.isDeletionPending()) this.#forgetPendingOwner(session);
  }

  async delete(id: string, run: (id: string) => Promise<void>): Promise<DeletionResult> {
    const pending =
      this.#deletions.get(id) ??
      (this.#pendingDeletionOwners.get(id)
        ? this.#deletions.get(this.#pendingDeletionOwners.get(id)!.id)
        : undefined);
    if (pending) {
      await pending;
      return { kind: "ignored" };
    }

    const session = this.#pendingDeletionOwner(id) ?? this.#sessions.get(id);
    if (session) this.#rememberPendingOwner(id, session);
    const aliases = session
      ? [...this.#pendingDeletionOwners.entries()]
          .filter(([, owner]) => owner === session)
          .map(([alias]) => alias)
      : [];
    if (!aliases.includes(id)) aliases.push(id);
    if (session && !aliases.includes(session.id)) aliases.push(session.id);
    for (const alias of aliases) {
      this.#deletionVersions.set(alias, this.#deletionVersion(alias) + 1);
      this.#invalidate(alias);
    }

    let settle!: (outcome: DeletionResult) => void;
    const reservation = new Promise<DeletionResult>((resolve) => {
      settle = resolve;
    });
    for (const alias of aliases) this.#deletions.set(alias, reservation);

    let outcome: DeletionResult | undefined;
    try {
      if (!session) {
        // Il vault del gesto è quello di quando parte: `run` può durare.
        const vault = this.#currentVault();
        await run(id);
        try {
          await this.#api.discardDraft(id, ...vaultArg(vault));
        } catch {
          // Keep the same best-effort cleanup as a live session.
        }
        outcome = { kind: "deleted", dirty: false };
        return outcome;
      }

      session.settlePending();
      const dirty = session.dirty;
      const deletion = session.delete(run);
      this.#sessions.delete(session.id);
      try {
        if (!(await deletion)) {
          outcome = { kind: "ignored" };
          return outcome;
        }
        outcome = { kind: "deleted", dirty };
        return outcome;
      } catch (error) {
        if (session.snapshot().lifecycle === "open") this.#sessions.set(session.id, session);
        throw error;
      }
    } finally {
      settle(outcome ?? { kind: "ignored" });
      for (const alias of aliases) {
        if (this.#deletions.get(alias) === reservation) this.#deletions.delete(alias);
      }
      if (session) {
        this.#forgetPendingOwner(session);
        // Cancellata, o tolta da un errore che non l'ha riaperta: è uscita.
        // Riaperta da una cancellazione fallita, tiene la sua chiave.
        if (session.snapshot().lifecycle !== "open") this.#release(session);
      }
    }
  }

  handleExternalRemoval(id: string): ExternalRemovalResult {
    this.#invalidate(id);
    const session = this.#sessions.get(id) ?? this.#pendingDeletionOwners.get(id);
    if (!session) return { kind: "removed", dirty: false };
    this.#invalidate(session.id);
    session.settlePending();
    const dirty = session.dirty;
    const text = session.text();
    // La cancellazione chiesta da qui (il cestino) butta anche la bozza: è
    // il gesto dell'utente. Solo quella arrivata da fuori ne conserva il testo.
    const own = session.isDeletionPending() || this.#deletions.has(session.id) || this.#deletions.has(id);
    // La base della bozza è la revisione da cui il buffer discendeva: al
    // recupero la bozza è «orfana» (la nota c'era) e non si riscrive da sola,
    // come farebbe una bozza «nuova». Resuscitare una nota cancellata è una
    // scelta di chi legge, non del recupero.
    const snapshot = session.snapshot();
    const base = snapshot.base.kind === "descends_from" ? snapshot.base.value : null;
    session.close(true);
    if (this.#sessions.get(session.id) === session) this.#sessions.delete(session.id);
    this.#forgetPendingOwner(session);
    this.#release(session);
    if (!dirty || own) {
      void session.discardDraftAfterClose();
      return { kind: "removed", dirty };
    }
    // Il file non c'è più, il lavoro sì: resta in bozza (la ritrova il
    // recupero al prossimo avvio) e torna a chi può offrire di ricrearlo.
    const vault = this.#vaults.get(session) ?? null;
    // Dalla coda delle bozze della sessione: l'host non le mette in fila da
    // sé (#485), e una bozza della sessione ancora in volo è più vecchia.
    const saving = session.saveDraftAfterClose(text, base).catch(() => {
      this.#emit({ kind: "draft-blind", id: session.id });
    });
    this.#removedDrafts.set(removedDraftKey(session.id, vault), { text, saving });
    return { kind: "removed", dirty, text };
  }

  /**
   * Il file cancellato da fuori è tornato con il testo della sua bozza
   * («Ricrea la nota», riuscita): la bozza non ha più niente da dire, e
   * lasciata lì alla riapertura farebbe un conflitto falso, perché la sua
   * base è la revisione del file cancellato e non quella ricreata (IMP-047).
   * Si aspetta che la sua scrittura sia finita, così non arriva dopo lo
   * scarto. Si scarta soltanto la bozza che tiene `text`, il testo ricreato:
   * una sessione nel frattempo riaperta sull'id tiene la sua bozza, e una
   * rimozione più nuova (un «Ricrea» rimasto su un avviso di prima) tiene la
   * bozza col testo più nuovo.
   */
  async discardRemovedDraft(id: string, vault: string | null | undefined, text: string): Promise<void> {
    const key = removedDraftKey(id, vault ?? null);
    const entry = this.#removedDrafts.get(key);
    if (!entry) {
      // La nota si è già riaperta e la bozza è passata a lei. Se è pulita,
      // senza salvataggi in coda e mostra proprio il testo ricreato, la bozza
      // sul disco non tiene niente che lei non abbia: alla riapertura dopo
      // farebbe un conflitto falso, e si toglie.
      const reopened = this.#sessions.get(id);
      if (reopened && !reopened.dirty && !reopened.hasPending() && reopened.text() === text) {
        await this.#api.discardDraft(id, ...vaultArg(vault));
      }
      return;
    }
    if (entry.text !== text) return;
    this.#removedDrafts.delete(key);
    await entry.saving;
    // Nell'attesa la nota si è riaperta, o è sparita un'altra volta con una
    // bozza sua: quella non è la bozza di questo testo.
    if (this.#sessions.has(id) || this.#removedDrafts.has(key)) return;
    await this.#api.discardDraft(id, ...vaultArg(vault));
  }
  async release(id: string): Promise<CloseResult> {
    if ((this.#openIntents.get(id) ?? 0) > 0) return { kind: "active" };

    const pendingOwner = this.#pendingDeletionOwner(id);
    const deletingOwner = this.#pendingDeletionOwners.get(id);
    if (pendingOwner) return { kind: "active" };
    const deletionVersion = this.#deletionVersion(id);
    const pendingDeletion =
      this.#deletions.get(id) ??
      (deletingOwner ? this.#deletions.get(deletingOwner.id) : undefined);
    if (pendingDeletion) {
      const ownerId = deletingOwner?.id ?? id;
      const outcome = await pendingDeletion;
      if (outcome.kind === "deleted") return { kind: "missing" };
      // A failed deletion reopened the exact old owner. Re-run the release
      // decision against that owner instead of leaving it unwatched.
      return this.release(ownerId);
    }

    const session = this.#sessions.get(id);
    if (!session) {
      // A panel can finish its last render after its tab has gone away. Bump
      // identity even without an owner so that the in-flight read cannot
      // create an orphan session when it resolves.
      this.#invalidate(id);
      return { kind: "missing" };
    }

    // Il testo tenuto dalle superfici entra prima, anche quello che la
    // superficie conferma col suo provider: non è un'attività nuova.
    const held = session.settled();
    if (held) await held;
    const activity = session.activityGeneration();
    await session.flush();
    if (session.dirty) await session.flushDraft();

    if (session.isDeletionPending()) return { kind: "active" };
    if (this.#sessions.get(id) !== session) {
      const pending = this.#deletions.get(id) ?? this.#deletions.get(session.id);
      if (pending) {
        const outcome = await pending;
        if (outcome.kind === "deleted") return { kind: "missing" };
        return this.release(session.id);
      }
      // A rename can move this owner while it is being flushed. If no newer
      // owner replaced it, continue the same close decision under its key.
      if (session.id !== id && this.#sessions.get(session.id) === session) {
        return this.release(session.id);
      }
      return { kind: "missing" };
    }
    if ((this.#openIntents.get(id) ?? 0) > 0) return { kind: "active" };
    if (this.#deletionVersion(id) !== deletionVersion) {
      // The deletion failed after this release started; its reopen activity is
      // internal, so retry once rather than treating it as a user reopen.
      if (this.#sessions.get(id) === session && session.snapshot().lifecycle === "open") {
        return this.release(id);
      }
      return { kind: "missing" };
    }
    if (session.activityGeneration() !== activity) return { kind: "active" };
    if (session.dirty) return { kind: "unsaved" };
    return this.close(id);
  }

  /// Chiude una sessione il cui buffer non si è potuto salvare, perché chi
  /// l'ha chiusa ha scelto di scartarlo: il buffer e la sua bozza se ne vanno
  /// insieme, come se le modifiche non ci fossero mai state.
  discardUnsaved(id: string): CloseResult {
    const session = this.#sessions.get(id);
    const outcome = this.close(id);
    if (outcome.kind === "closed" && session) void session.discardDraftAfterClose();
    return outcome;
  }

  async resolveConflict(id: string, choice: ConflictChoice, keep?: KeepDiscarded): Promise<ConflictResolutionResult> {
    return (await this.#sessions.get(id)?.resolveConflict(choice, keep)) ?? { kind: "none" };
  }
  /// Se «Usa disco» su `id` ha un testo da conservare: no per i documenti a
  /// giornale (la griglia), dove il buffer non è il file.
  keepsDiscardedText(id: string): boolean {
    const session = this.#sessions.get(id);
    return session !== undefined && !this.#journals.has(session);
  }
  async renameKeepingBuffer(from: string, to: string): Promise<RenameResult> {
    const pendingAlias = this.#pendingDeletionOwners.get(from);
    const session =
      this.#sessions.get(from) ??
      (pendingAlias?.snapshot().lifecycle === "open" ? pendingAlias : undefined);
    const target = this.#sessions.get(to);
    if (target && target !== session) return { kind: "collision", from, to };
    this.#invalidate(from);
    this.#invalidate(to);
    this.#renaming.add(from);
    this.#renaming.add(to);
    session?.suspend();
    try {
      await renameNote(from, to);
    } catch (error) {
      session?.resume();
      this.#renaming.delete(from);
      this.#renaming.delete(to);
      throw error;
    }
    const outcome = this.rename(from, to);
    this.#renaming.delete(from);
    this.#renaming.delete(to);
    return outcome;
  }

  rename(from: string, to: string): RenameResult {
    this.#invalidate(from);
    this.#invalidate(to);
    if (from === to) return { kind: "already-renamed", from, to };
    const pendingAlias = this.#pendingDeletionOwners.get(from);
    const session =
      this.#sessions.get(from) ??
      (pendingAlias?.snapshot().lifecycle === "open" ? pendingAlias : undefined);
    const target = this.#sessions.get(to);
    if (!session) {
      return target ? { kind: "already-renamed", from, to } : { kind: "missing", from, to };
    }
    if (session.id === to && target === session) {
      return { kind: "already-renamed", from, to };
    }
    if (target && target !== session) {
      session.resume();
      return { kind: "collision", from, to };
    }
    session.rename(to);
    if (this.#sessions.get(from) === session) this.#sessions.delete(from);
    this.#sessions.set(to, session);
    if (session.isDeletionPending()) this.#rememberPendingOwner(from, session);
    return { kind: "renamed", from, to };
  }

  close(id: string): CloseResult {
    const session = this.#sessions.get(id) ?? this.#pendingDeletionOwners.get(id);
    if (!session) {
      this.#invalidate(id);
      return { kind: "missing" };
    }
    if (session.isDeletionPending()) return { kind: "active" };
    this.#invalidate(id);
    session.settlePending();
    const dirty = session.dirty;
    if (!session.close()) return { kind: "active" };
    if (this.#sessions.get(session.id) === session) this.#sessions.delete(session.id);
    this.#release(session);
    return { kind: "closed", dirty };
  }

  /// L'unica uscita della chiave: la sessione è uscita per sempre (chiusa,
  /// chiusa con tutte, cancellata, sparita dal disco, sostituita), e l'host
  /// lascia andare ciò che teneva sotto la sua chiave. Una volta sola; un
  /// errore dell'host non cambia la chiusura.
  #release(session: DocumentSession): void {
    if (this.#released.has(session)) return;
    this.#released.add(session);
    const open = this.#keys.get(session);
    if (open !== undefined) this.#closeKey(open, this.#vaults.get(session) ?? null);
  }

  #closeKey(open: string, vault: string | null): void {
    try {
      void this.#api.documentClosed(open, ...vaultArg(vault)).catch(() => {});
    } catch {
      // Una porta che fallisce prima di promettere non cambia la chiusura.
    }
  }

  /// Una lettura o una scrittura sotto la chiave della sessione. Se finisce
  /// quando la sessione è già uscita, l'host può aver segnato di nuovo la
  /// chiave appena chiusa: la si richiude, e per l'host chiudere due volte non
  /// costa niente.
  #underKey<T>(session: DocumentSession, call: (open: string) => Promise<T>): Promise<T> {
    const open = this.#keys.get(session);
    if (open === undefined) return Promise.reject(new Error(`document session ${session.id} has no open key`));
    const pending = call(open);
    const settled = (): void => {
      if (this.#released.has(session)) this.#closeKey(open, this.#vaults.get(session) ?? null);
    };
    void pending.then(settled, settled);
    return pending;
  }

  #identityVersion(id: string): number {
    return this.#identityVersions.get(id) ?? 0;
  }

  #deletionVersion(id: string): number {
    return this.#deletionVersions.get(id) ?? 0;
  }

  #pendingDeletionOwner(id: string): DocumentSession | undefined {
    const direct = this.#sessions.get(id);
    if (direct?.isDeletionPending()) return direct;
    const alias = this.#pendingDeletionOwners.get(id);
    return alias?.isDeletionPending() ? alias : undefined;
  }

  #rememberPendingOwner(alias: string, session: DocumentSession): void {
    this.#pendingDeletionOwners.set(alias, session);
    this.#pendingDeletionOwners.set(session.id, session);
  }

  #forgetPendingOwner(session: DocumentSession): void {
    for (const [alias, owner] of this.#pendingDeletionOwners) {
      if (owner === session) this.#pendingDeletionOwners.delete(alias);
    }
  }

  #invalidate(id: string): void {
    this.#identityVersions.set(id, this.#identityVersion(id) + 1);
  }
  #describe(session: DocumentSession, source: DocumentSource): void {
    this.#surfaceDescriptors.set(session, {
      formatId: source.format_id,
      sourceKind: source.source_kind,
      revision: source.revision,
    });
    if (source.format_id === null && source.source_kind === "text") this.#formatless.add(session);
    else this.#formatless.delete(session);
    if (source.text_kind === "grid_journal") this.#journals.add(session);
    else this.#journals.delete(session);
  }

  /// Il salvataggio di un file senza formato. `Revision::of(testo)` è
  /// `Revision::of_bytes(utf8)`, quindi la revisione da cui il buffer discende
  /// è anche l'attesa del CAS, e un file cambiato sotto risponde `conflict`
  /// come per una nota. Una base dettata non attende niente: si rilegge la
  /// revisione del disco e il CAS si fa su quella; se il file non c'è più, lo
  /// si crea — e se nel frattempo qualcuno l'ha creato, è un conflitto.
  async #writeFormatless(
    session: DocumentSession,
    id: string,
    text: string,
    base: WriteBase,
    vault: string | null,
  ): Promise<string> {
    const expected =
      base.kind === "descends_from"
        ? base.value
        : await this.#underKey(session, (open) => this.#api.openDocument(id, open, ...vaultArg(vault))).then(
            (source) => source.revision,
            () => null,
          );
    const receipt = await this.#api.resourceWrite(id, new TextEncoder().encode(text), expected, ...vaultArg(vault));
    return receipt.revision;
  }

  /// Crea la sessione legandola al `vault` in cui il documento è stato letto e
  /// alla chiave `open` con cui è stato letto; senza lettura (una bozza, un
  /// documento nuovo) la chiave nasce qui. Se c'è già una sessione aperta la
  /// chiave non serve, e chi l'ha fatta la chiude.
  #create(id: string, text: string, base: WriteBase, vault: string | null, open?: string): DocumentSession {
    const existing = this.#sessions.get(id);
    if (existing?.snapshot().lifecycle === "open") return existing;
    if (existing) {
      this.#sessions.delete(id);
      this.#release(existing);
    }
    // La sessione scrive dalla porta che il suo file accetta: il testo per un
    // formato, i byte per un file che nessun formato serve. La scelta è della
    // collezione, che sa cosa ha letto; la sessione vede una porta sola. Ogni
    // lettura e ogni scrittura passa la chiave della sessione.
    const api: SessionPort = {
      readDocument: (doc) =>
        this.#underKey(session, (key) => this.#api.openDocument(doc, key, ...vaultArg(vault))),
      writeDocument: (doc, source, writeBase) =>
        this.#formatless.has(session)
          ? this.#writeFormatless(session, doc, source, writeBase, vault)
          : this.#underKey(session, (key) => this.#api.writeDocument(doc, source, writeBase, vault, key)),
      saveDraft: (doc, source, draftBase) => this.#api.saveDraft(doc, source, draftBase, ...vaultArg(vault)),
      discardDraft: (doc) => this.#api.discardDraft(doc, ...vaultArg(vault)),
    };
    const session: DocumentSession = new DocumentSession(OWNER_TOKEN, id, text, base, api, {
      emit: (event) => this.#emit(event),
      journal: (): boolean => this.#journals.has(session),
      draftSucceeded: (doc) => {
        if (!this.#blindDraft) return;
        this.#blindDraft = false;
        this.#emit({ kind: "draft-restored", id: doc });
      },
      draftFailed: (doc) => {
        if (this.#blindDraft) return;
        this.#blindDraft = true;
        this.#emit({ kind: "draft-blind", id: doc });
      },
    });
    this.#vaults.set(session, vault);
    this.#keys.set(session, open ?? newOpenKey());
    this.#sessions.set(id, session);
    // La bozza di una rimozione di prima è adesso di questa sessione: un
    // «Ricrea» rimasto sul vecchio avviso non la deve toccare.
    this.#removedDrafts.delete(removedDraftKey(id, vault));
    return session;
  }

  #emit(event: DocumentSessionEvent): void | Promise<void> {
    const pending: Promise<void>[] = [];
    for (const listener of this.#listeners) {
      const result = listener(event);
      if (result) pending.push(result);
    }
    return pending.length === 0 ? undefined : Promise.all(pending).then(() => undefined);
  }

}

export const documentSessions = new DocumentSessionCollection();

export function flushPendingSave(): Promise<string[]> {
  return documentSessions.flushPendingSave();
}

/// Annuncia la scrittura di un comando su `id` (`expectWrite`): la ricarica
/// che ne viene, a buffer pulito, non si dice.
export function expectDocumentWrite(id: string): (graceMs?: number) => void {
  return documentSessions.expectWrite(id);
}

export function flushBeforeClose(): Promise<string[]> {
  return documentSessions.flushBeforeClose();
}

export function renameKeepingBuffer(from: string, to: string): Promise<RenameResult> {
  return documentSessions.renameKeepingBuffer(from, to);
}
