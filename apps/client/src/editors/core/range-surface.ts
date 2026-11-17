// La superficie su un tratto di una `DocumentSession`: una sezione o un blocco
// di una nota, che una trasclusione viva modifica dove sta (E14).
//
// Il buffer, la revisione, il salvataggio e la bozza restano della sessione:
// la superficie vi si sottoscrive come un riquadro (`DocumentSurface`) e le
// porta le sue modifiche come operazioni tipizzate sul documento intero
// (`acceptSurfaceChange`). Cursore, selezione e annulla sono della vista
// locale (un `TextEngine` col solo testo del tratto), che riceve le modifiche
// degli altri come sincronizzazioni, mai come battute sue.
//
// Il tratto si ritrova così:
// - una modifica di un'altra superficie (o una sostituzione: ricarica,
//   conflitto, bozza) sposta il vecchio inizio con la sua mappa di posizione,
//   poi l'àncora si rilegge sul testo nuovo vicino a quell'inizio: l'estensione
//   è sempre quella dell'àncora;
// - una modifica della superficie stessa allarga o stringe soltanto il
//   tratto, senza rileggerlo: ciò che la persona scrive non sparisce dalla
//   vista sotto il cursore, anche se, per esempio, è un titolo nuovo;
// - se l'àncora sparisce per mano di un altro (titolo rinominato, blocco
//   cancellato) la superficie si ferma sull'ultimo testo, in sola lettura
//   (`lost`); se la toglie la superficie stessa resta scrivibile
//   (`unanchored`), così la persona può rimetterla o annullare.
//
// Il tratto vive nel testo in `\n` (gli offset delle operazioni); i
// terminatori del file restano quelli che erano, anche dove la superficie
// scrive.
import type {
  DocumentSurface,
  DocumentSurfaceUpdate,
  SurfaceChangeResult,
  SurfaceEdit,
} from "../../state/document-session";
import {
  lineFeeds,
  operationFromText,
  rebaseStaleChange,
  tryApplyOperation,
  type DocumentUpdate,
  type TextEdit,
  type TextOperation,
} from "./text-operation";
import { resolveSectionAnchor, type SectionAnchor, type TextSpan } from "./section-anchor";

/// La parte di una `DocumentSession` che una superficie su un tratto usa.
export interface RangeSessionPort {
  text(): string;
  attachSurface(surface: DocumentSurface): () => void;
  acceptSurfaceChange(surfaceId: string, edit: SurfaceEdit): SurfaceChangeResult;
}

/// La vista locale del tratto: riceve soltanto dati. `sync` è una modifica che
/// non è sua (fuori dal suo annulla), `setReadOnly` la ferma o la riapre.
export interface RangeSurfaceView {
  sync(update: DocumentUpdate): void;
  setReadOnly?(readOnly: boolean): void;
}

/// - `live`: l'àncora è nel tratto e si scrive;
/// - `unanchored`: la superficie stessa ha tolto l'àncora; si scrive ancora,
///   e il tratto segue soltanto la mappa di posizione finché l'àncora torna;
/// - `lost`: un altro ha tolto l'àncora o cancellato il tratto; sola lettura
///   sull'ultimo testo, staccata dalla sessione;
/// - `closed`: la sessione si è chiusa (o la superficie è stata distrutta).
export type RangeStatus = "live" | "unanchored" | "lost" | "closed";

/// Esito di una modifica della vista: entrata nella sessione, o rifiutata con
/// la vista riallineata al testo del tratto (che non è cambiato per lei).
export type RangeWriteResult = { kind: "accepted" } | { kind: "realigned" } | { kind: "refused" };

export interface RangeSurfaceOptions {
  /// L'identità della registrazione nella sessione: unica fra le superfici
  /// del documento (un riquadro usa il suo id).
  readonly id: string;
  readonly anchor: SectionAnchor;
}

type StatusListener = (status: RangeStatus) => void;

/// Dove va una posizione attraverso un'operazione. `after`: un inserimento
/// proprio lì la spinge dopo di sé (l'inizio di un tratto); altrimenti resta
/// prima (la fine). Dentro un tratto cancellato va al bordo della modifica.
function mapPosition(pos: number, operation: TextOperation, after: boolean): number {
  let delta = 0;
  for (const edit of operation.edits) {
    if (edit.to < pos || (edit.to === pos && (edit.from < pos || after))) {
      delta += edit.inserted.length - edit.deleted.length;
      continue;
    }
    if (edit.from >= pos) break;
    // `pos` cade dentro la parte tolta.
    return edit.from + delta + (after ? edit.inserted.length : 0);
  }
  return pos + delta;
}

/// L'operazione `operation` (sul testo `\n` di `raw`) applicata a `raw` coi
/// suoi terminatori: le righe intorno restano come sono, e il testo nuovo va
/// a capo come il file (CRLF se il file usa soltanto CRLF).
function spliceRaw(raw: string, operation: TextOperation): string | null {
  if (raw.indexOf("\r") < 0) {
    const applied = tryApplyOperation(raw, operation);
    return applied.kind === "applied" ? applied.text : null;
  }
  const crlf = raw.includes("\r\n") && !/(^|[^\r])\n/.test(raw);
  // L'offset in `raw` di ogni offset del testo in `\n`.
  const rawAt: number[] = [];
  for (let index = 0; index < raw.length; index++) {
    rawAt.push(index);
    if (raw[index] === "\r" && raw[index + 1] === "\n") index++;
  }
  rawAt.push(raw.length);
  if (rawAt.length - 1 !== operation.beforeLength) return null;
  const chunks: string[] = [];
  let cursor = 0;
  for (const edit of operation.edits) {
    const from = rawAt[edit.from]!;
    const to = rawAt[edit.to]!;
    if (lineFeeds(raw.slice(from, to)) !== edit.deleted) return null;
    chunks.push(raw.slice(cursor, from), crlf ? edit.inserted.replace(/\n/g, "\r\n") : edit.inserted);
    cursor = to;
  }
  chunks.push(raw.slice(cursor));
  return chunks.join("");
}

/// Le modifiche di `operation` che cadono nel tratto `[from, to]`, nelle
/// coordinate del tratto; `null` se una lo scavalca.
function sliceOperation(operation: TextOperation, from: number, to: number, boundary: boolean): TextOperation | null {
  const edits: TextEdit[] = [];
  let delta = 0;
  for (const edit of operation.edits) {
    const touches = edit.from === edit.to && (edit.from === from || edit.from === to);
    if (touches && !boundary) continue;
    if (edit.to <= from && !(touches && edit.from === from)) continue;
    if (edit.from >= to && !(touches && edit.from === to)) continue;
    if (edit.from < from || edit.to > to) return null;
    edits.push({ ...edit, from: edit.from - from, to: edit.to - from });
    delta += edit.inserted.length - edit.deleted.length;
  }
  return { beforeLength: to - from, afterLength: to - from + delta, edits };
}

export class RangeSurface {
  readonly id: string;
  readonly anchor: SectionAnchor;
  readonly #port: RangeSessionPort;
  /// Il testo della sessione in `\n`, com'era all'ultimo dato ricevuto.
  #full: string;
  #from: number;
  #to: number;
  #status: RangeStatus;
  /// L'ultimo testo del tratto, quello che resta quando la superficie si ferma.
  #frozen: string | null = null;
  #view: RangeSurfaceView | null = null;
  #detach: (() => void) | null;
  readonly #listeners = new Set<StatusListener>();

  /// Apre la superficie sul tratto che l'àncora nomina adesso; `null` se
  /// l'àncora non c'è.
  static open(port: RangeSessionPort, options: RangeSurfaceOptions): RangeSurface | null {
    const full = lineFeeds(port.text());
    const span = resolveSectionAnchor(full, options.anchor);
    return span ? new RangeSurface(port, options, full, span) : null;
  }

  private constructor(port: RangeSessionPort, options: RangeSurfaceOptions, full: string, span: TextSpan) {
    this.id = options.id;
    this.anchor = options.anchor;
    this.#port = port;
    this.#full = full;
    this.#from = span.from;
    this.#to = span.to;
    this.#status = "live";
    this.#detach = port.attachSurface({
      id: this.id,
      sync: (update) => this.#received(update),
      closed: () => this.#stop("closed"),
    });
  }

  status(): RangeStatus {
    return this.#status;
  }

  get readOnly(): boolean {
    return this.#status === "lost" || this.#status === "closed";
  }

  /// Il testo del tratto, in `\n`: quello da dare alla vista quando nasce.
  text(): string {
    return this.#frozen ?? this.#full.slice(this.#from, this.#to);
  }

  /// Il tratto nel testo della sessione in `\n`; `null` quando è fermo.
  span(): TextSpan | null {
    return this.#frozen === null ? { from: this.#from, to: this.#to } : null;
  }

  /// Collega la vista locale: riceve subito il testo del tratto se è rimasta
  /// indietro e la sola lettura. Una vista per volta; il disposer la stacca.
  connect(view: RangeSurfaceView): () => void {
    this.#view = view;
    view.sync({ text: this.text(), operation: null });
    view.setReadOnly?.(this.readOnly);
    return () => {
      if (this.#view === view) this.#view = null;
    };
  }

  /// Avvisa a ogni cambio di stato. Il disposer smette.
  watchStatus(listener: StatusListener): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  /// Una modifica della vista (una battuta, o il suo annulla), in coordinate
  /// del tratto. Entra nella sessione come quella di un riquadro.
  write(change: SurfaceEdit): RangeWriteResult {
    if (this.readOnly) {
      this.#push({ text: this.text(), operation: null });
      return { kind: "refused" };
    }
    const slice = this.#full.slice(this.#from, this.#to);
    let operation = change.operation;
    const applied = tryApplyOperation(slice, operation);
    if (applied.kind !== "applied" || applied.text !== lineFeeds(change.text)) {
      // La vista è rimasta indietro: la sua modifica si ribasa sul tratto, e
      // la vista riceve soltanto ciò che le mancava.
      const rebased = rebaseStaleChange(slice, change);
      if (!rebased) {
        this.#push({ text: slice, operation: null });
        return { kind: "realigned" };
      }
      operation = rebased.operation;
      this.#push({ text: lineFeeds(rebased.text), operation: rebased.catchUp });
    }
    const delta = operation.afterLength - operation.beforeLength;
    const whole: TextOperation = {
      beforeLength: this.#full.length,
      afterLength: this.#full.length + delta,
      edits: operation.edits.map((edit) => ({ ...edit, from: edit.from + this.#from, to: edit.to + this.#from })),
    };
    const nextFull = tryApplyOperation(this.#full, whole);
    const raw = this.#port.text();
    const nextRaw = lineFeeds(raw) === this.#full ? spliceRaw(raw, whole) : null;
    if (nextFull.kind !== "applied" || nextRaw === null || lineFeeds(nextRaw) !== nextFull.text) {
      this.#received({ kind: "text", text: raw });
      return { kind: "realigned" };
    }
    // Lo stato si aggiorna prima di chiamare la sessione: un dato che arriva
    // durante la chiamata parte già dal tratto nuovo.
    const before = { full: this.#full, to: this.#to };
    this.#full = nextFull.text;
    this.#to += delta;
    const outcome = this.#port.acceptSurfaceChange(this.id, { text: nextRaw, operation: whole });
    if (outcome.kind === "accepted") {
      this.#checkAnchor();
      return { kind: "accepted" };
    }
    // Niente è entrato nella sessione, quindi niente le è tornato indietro.
    this.#full = before.full;
    this.#to = before.to;
    if (outcome.kind === "untracked") {
      this.#stop("closed");
      return { kind: "refused" };
    }
    this.#received({ kind: "text", text: outcome.text });
    return { kind: "realigned" };
  }

  /// Si stacca dalla sessione e dalla vista. Idempotente.
  destroy(): void {
    this.#stop("closed");
    this.#listeners.clear();
    this.#view = null;
  }

  /// Un dato della sessione: una modifica di un'altra superficie o una
  /// sostituzione del testo intero.
  #received(update: DocumentSurfaceUpdate): void {
    if (this.readOnly) return;
    const full = lineFeeds(update.text);
    const replayed = update.kind === "operation" ? tryApplyOperation(this.#full, update.operation) : null;
    const exact = update.kind === "operation" && replayed?.kind === "applied" && replayed.text === full;
    // Una sostituzione non dice cosa è cambiato: il rattoppo unico che la
    // descrive copre tutto ciò che sta fra la prima e l'ultima differenza.
    const operation = exact ? update.operation : operationFromText(this.#full, full);
    const before = { full: this.#full, from: this.#from, to: this.#to };
    // Il tratto mappato, senza ciò che altri hanno scritto proprio ai bordi…
    const from = mapPosition(this.#from, operation, true);
    const to = Math.max(from, mapPosition(this.#to, operation, false));
    // …e la finestra in cui l'àncora deve ritrovarsi, con quello: un titolo
    // uguale altrove nella nota è un'altra sezione, non questa.
    const windowFrom = mapPosition(this.#from, operation, false);
    const windowTo = mapPosition(this.#to, operation, true);
    const found = resolveSectionAnchor(full, this.anchor, windowFrom);
    // Una modifica vera che toglie tutto il tratto lo cancella, anche se
    // l'àncora uguale che c'era dopo scivola al suo posto.
    const erased = exact && this.#to > this.#from && operation.edits.some((edit) => edit.from <= this.#from && edit.to >= this.#to);
    const span = !erased && found && found.from >= windowFrom && found.from <= windowTo ? found : null;
    if (span) {
      this.#full = full;
      this.#from = span.from;
      this.#to = span.to;
      this.#setStatus("live");
    } else if (this.#status === "unanchored" && (to > from || before.to === before.from)) {
      this.#full = full;
      this.#from = from;
      this.#to = to;
    } else {
      // L'àncora (o il tratto intero) l'ha tolta un altro: la superficie si
      // ferma sull'ultimo testo che ha mostrato.
      this.#frozen = before.full.slice(before.from, before.to);
      this.#stop("lost");
      return;
    }
    const oldSlice = before.full.slice(before.from, before.to);
    const newSlice = this.#full.slice(this.#from, this.#to);
    if (oldSlice === newSlice) return;
    this.#push({ text: newSlice, operation: this.#sliceUpdate(operation, before.from, before.to, oldSlice, newSlice) });
  }

  /// L'operazione da dare alla vista: le modifiche cadute nel tratto, se da
  /// sole portano dal vecchio al nuovo testo; altrimenti un rattoppo unico.
  #sliceUpdate(operation: TextOperation, from: number, to: number, oldSlice: string, newSlice: string): TextOperation {
    for (const boundary of [true, false]) {
      const local = sliceOperation(operation, from, to, boundary);
      if (!local) break;
      const applied = tryApplyOperation(oldSlice, local);
      if (applied.kind === "applied" && applied.text === newSlice) return local;
    }
    return operationFromText(oldSlice, newSlice);
  }

  /// Dopo una modifica della superficie: l'àncora è ancora nel tratto?
  #checkAnchor(): void {
    const span = resolveSectionAnchor(this.#full, this.anchor, this.#from);
    const inside = span !== null && span.from >= this.#from && span.from <= this.#to;
    this.#setStatus(inside ? "live" : "unanchored");
  }

  #push(update: DocumentUpdate): void {
    try {
      this.#view?.sync(update);
    } catch (error) {
      console.error(error);
    }
  }

  #stop(status: "lost" | "closed"): void {
    if (this.#frozen === null) this.#frozen = this.#full.slice(this.#from, this.#to);
    const detach = this.#detach;
    this.#detach = null;
    try {
      detach?.();
    } catch (error) {
      console.error(error);
    }
    // Già ferma: «perduta» resta tale anche quando poi la sessione chiude.
    if (this.#status === "lost" || this.#status === "closed") return;
    this.#setStatus(status);
    try {
      this.#view?.setReadOnly?.(true);
    } catch (error) {
      console.error(error);
    }
  }

  #setStatus(status: RangeStatus): void {
    if (this.#status === status) return;
    this.#status = status;
    for (const listener of [...this.#listeners]) {
      try {
        listener(status);
      } catch (error) {
        console.error(error);
      }
    }
  }
}
