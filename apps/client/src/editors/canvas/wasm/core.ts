// Il caricatore del nucleo della lavagna in WebAssembly: il modulo di
// `crates/fub-canvas-wasm`, che il plugin `build/canvas-wasm.mjs` compila dai
// sorgenti di adesso. Il patto con il modulo (le funzioni, chi alloca e chi
// libera, gli errori) è nella pagina `docs/reference/canvas-operations.md`
// § «WebAssembly»; non è un contratto pubblico, e le due parti cambiano
// insieme.
//
// - Il modulo si compila una volta e resta (A6); ogni lavagna aperta è un
//   handle della stessa istanza.
// - Ogni ingresso sta in memoria chiesta a `fub_alloc` e liberata con
//   `fub_free` subito dopo la chiamata, anche quando fallisce. Il risultato si
//   copia subito, e le viste della memoria si rifanno a ogni chiamata, perché
//   la memoria può crescere (e il `buffer` di prima diventa vuoto).
// - Una trappola (un difetto del nucleo, o la memoria che finisce) lascia
//   l'istanza inservibile: ogni lavagna aperta su di lei risponde `trap`, e il
//   prossimo `openCore` fa un'istanza nuova, da cui il chiamante riapre la
//   lavagna dal suo testo. Un handle dell'istanza morta non arriva mai a
//   quella nuova, dove lo stesso numero sarebbe un'altra lavagna.
// - Un testo con un surrogato spaiato non arriva al nucleo: `TextEncoder` lo
//   cambierebbe in U+FFFD senza dirlo, e il tratto di un commit non
//   tornerebbe più col testo della sessione. È un errore `utf8`, come i byte
//   che il nucleo non legge.

import { loadCanvasWasm } from "virtual:fub-canvas-wasm";
import type { CanvasDocument } from "../model";
import type { CanvasPatch } from "../operation";

/** I codici d'errore del modulo, più `trap` (l'istanza è morta) e `load` (il modulo non si carica). */
export type CanvasCoreErrorCode =
  | "handle"
  | "utf8"
  | "limit"
  | "request"
  | "source"
  | "stale"
  | "invalid"
  | "rejected"
  | "unstable"
  | "op"
  | "internal"
  | "trap"
  | "load";

const MODULE_CODES: ReadonlySet<string> = new Set([
  "handle", "utf8", "limit", "request", "source", "stale", "invalid", "rejected", "unstable", "op", "internal",
]);

/**
 * Un rifiuto del nucleo. `message` è la frase inglese del nucleo, per chi
 * indaga e non per l'utente; `details` porta gli altri campi dell'errore
 * (per `op`: `kind`, `index` e, se c'è, `id`).
 */
export class CanvasCoreError extends Error {
  readonly code: CanvasCoreErrorCode;
  readonly details: Readonly<Record<string, unknown>>;

  constructor(code: CanvasCoreErrorCode, message: string, details: Record<string, unknown> = {}, cause?: unknown) {
    super(message);
    this.name = "CanvasCoreError";
    // `cause` a mano: le opzioni di `Error` sono di ES2022, e la shell punta a ES2021.
    if (cause !== undefined) Object.defineProperty(this, "cause", { value: cause, configurable: true, writable: true });
    this.code = code;
    this.details = details;
  }
}

/** Il tratto cambiato da un commit, in unità UTF-16 del sorgente di prima. */
export interface CanvasSourceEdit {
  readonly start: number;
  readonly end: number;
  readonly text: string;
}

export interface CanvasCommitted {
  /** `prima.slice(0, start) + text + prima.slice(end)` è il sorgente nuovo. */
  readonly edit: CanvasSourceEdit;
  /** Le toppe dell'annulla, da dare a un altro `commit`. */
  readonly inverse: CanvasPatch[];
}

/** Un'operazione d'intento (`docs/reference/canvas-operations.md`), come JSON. */
export interface CanvasIntentOp {
  readonly op: string;
  readonly [field: string]: unknown;
}

export interface CanvasCompiled {
  readonly patches: CanvasPatch[];
  readonly created: string[];
}

/** Una lavagna aperta nel nucleo. */
export interface CanvasCore {
  /** Il modello, con le chiavi nell'ordine in cui si scrivono; un oggetto nuovo a ogni chiamata. */
  model(): CanvasDocument;
  /** Riapre la lavagna da un testo nuovo; con un errore resta com'era. */
  reset(text: string): CanvasDocument;
  /** Le toppe, tutte o nessuna. */
  commit(patches: readonly CanvasPatch[]): CanvasCommitted;
  /** Il sorgente che darebbe `commit` con le stesse toppe, o lo stesso errore; la lavagna non cambia. */
  preview(patches: readonly CanvasPatch[]): string;
  /** Compila le operazioni d'intento sul modello, senza cambiarlo. */
  compile(ops: readonly CanvasIntentOp[], seed?: number | bigint | string): CanvasCompiled;
  /** L'indice della scheda il cui oggetto contiene il byte `byte` (UTF-8, BOM compreso), o `null`. */
  nodeAt(byte: number): number | null;
  /** Chiude la lavagna. Si può chiamare più volte; dopo, ogni altra chiamata è un errore `handle`. */
  close(): void;
  readonly closed: boolean;
}

/** Le funzioni del modulo, come le vede JavaScript: ogni `usize` e `u32` arriva come `i32`. */
interface CoreExports {
  readonly memory: WebAssembly.Memory;
  fub_alloc(len: number): number;
  fub_free(ptr: number, len: number): void;
  canvas_open(ptr: number, len: number): number;
  canvas_reset(handle: number, ptr: number, len: number): number;
  canvas_commit(handle: number, ptr: number, len: number): number;
  canvas_preview(handle: number, ptr: number, len: number): number;
  canvas_compile(handle: number, ptr: number, len: number): number;
  canvas_model(handle: number): number;
  canvas_node_at(handle: number, byte: number): number;
  canvas_close(handle: number): number;
  result_ptr(): number;
  result_len(): number;
}

const FUNCTIONS = [
  "fub_alloc", "fub_free", "canvas_open", "canvas_reset", "canvas_commit", "canvas_preview",
  "canvas_compile", "canvas_model", "canvas_node_at", "canvas_close", "result_ptr", "result_len",
] as const;

export interface CanvasCoreRuntimeOptions {
  /** I byte del modulo. */
  readonly load: () => Promise<BufferSource>;
  /** Fa un'istanza del modulo compilato (per difetto `WebAssembly.instantiate` senza import). */
  readonly instantiate?: (module: WebAssembly.Module) => Promise<WebAssembly.Exports>;
}

export interface CanvasCoreRuntime {
  /** Apre una lavagna dal suo testo; carica il modulo la prima volta, e dopo una trappola fa un'istanza nuova. */
  openCore(text: string): Promise<CanvasCore>;
  /** I byte della memoria dell'istanza viva, `null` se non ce n'è una. */
  memoryBytes(): number | null;
}

const encoder = new TextEncoder();
// `ignoreBOM`: il BOM del sorgente è del sorgente, e il decoder per difetto lo toglierebbe.
const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

/** L'indice UTF-16 del primo surrogato spaiato, -1 se il testo è ben formato. */
export function unpairedSurrogateAt(text: string): number {
  const wellFormed = (text as string & { isWellFormed?: () => boolean }).isWellFormed;
  if (typeof wellFormed === "function" && wellFormed.call(text)) return -1;
  for (let i = 0; i < text.length; i++) {
    const unit = text.charCodeAt(i);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = text.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        i++;
        continue;
      }
      return i;
    }
    if (unit >= 0xdc00 && unit <= 0xdfff) return i;
  }
  return -1;
}

/** Il testo come UTF-8 esatto, o un errore `utf8`. */
function encodeText(text: string): Uint8Array {
  const at = unpairedSurrogateAt(text);
  if (at !== -1) throw new CanvasCoreError("utf8", `the text has an unpaired surrogate at UTF-16 index ${at}`, { index: at });
  return encoder.encode(text);
}

/**
 * Una richiesta JSON come UTF-8. `JSON.stringify` scrive un surrogato
 * spaiato come `\udXXX`, che il nucleo rifiuta: niente U+FFFD neanche qui.
 */
function encodeJson(value: unknown): Uint8Array {
  return encoder.encode(JSON.stringify(value));
}

function asExports(exports: WebAssembly.Exports): CoreExports {
  if (!(exports.memory instanceof WebAssembly.Memory)) throw new Error("the module does not export its memory");
  for (const name of FUNCTIONS) {
    if (typeof exports[name] !== "function") throw new Error(`the module does not export ${name}`);
  }
  return exports as unknown as CoreExports;
}

class Instance {
  dead = false;
  constructor(readonly exports: CoreExports) {}
}

/** Il risultato di una chiamata: l'esito numerico e i byte del risultato, copiati. */
interface Answer {
  readonly status: number;
  readonly bytes: Uint8Array;
}

export function createCanvasCoreRuntime(options: CanvasCoreRuntimeOptions): CanvasCoreRuntime {
  let compiled: Promise<WebAssembly.Module> | null = null;
  let pending: Promise<Instance> | null = null;
  let live: Instance | null = null;

  const instantiate = options.instantiate ?? (async (module: WebAssembly.Module) => (await WebAssembly.instantiate(module, {})).exports);

  function kill(instance: Instance): void {
    instance.dead = true;
    if (live === instance) live = null;
  }

  function instance(): Promise<Instance> {
    if (live) return Promise.resolve(live);
    if (!pending) {
      const attempt = (async () => {
        if (!compiled) {
          const module = options.load().then((bytes) => WebAssembly.compile(bytes));
          compiled = module;
          // Un caricamento fallito si riprova alla prossima apertura.
          module.catch(() => {
            if (compiled === module) compiled = null;
          });
        }
        let exports: CoreExports;
        try {
          exports = asExports(await instantiate(await compiled));
        } catch (error) {
          throw new CanvasCoreError("load", `the canvas core does not load: ${String(error)}`, {}, error);
        }
        const made = new Instance(exports);
        live = made;
        return made;
      })();
      pending = attempt;
      attempt.then(
        () => {
          if (pending === attempt) pending = null;
        },
        () => {
          if (pending === attempt) pending = null;
        },
      );
    }
    return pending;
  }

  /**
   * Una chiamata con l'ingresso in memoria del modulo. L'ingresso si libera
   * sempre; un'eccezione del modulo è una trappola e uccide l'istanza.
   */
  function invoke(target: Instance, input: Uint8Array | null, run: (ptr: number, len: number) => number): Answer {
    if (target.dead) throw lost();
    const x = target.exports;
    const len = input?.length ?? 0;
    let ptr = 0;
    try {
      if (input && len > 0) {
        ptr = x.fub_alloc(len) >>> 0;
        if (ptr === 0) throw new CanvasCoreError("limit", `the ${len}-byte input exceeds the module's input limit or its memory`);
        new Uint8Array(x.memory.buffer, ptr, len).set(input);
      }
      const status = run(ptr, len);
      const at = x.result_ptr() >>> 0;
      const size = x.result_len() >>> 0;
      return { status, bytes: new Uint8Array(x.memory.buffer, at, size).slice() };
    } catch (error) {
      if (error instanceof CanvasCoreError) throw error;
      kill(target);
      throw new CanvasCoreError("trap", `the canvas core trapped: ${String(error)}`, {}, error);
    } finally {
      if (ptr !== 0 && !target.dead) {
        try {
          x.fub_free(ptr, len);
        } catch {
          kill(target);
        }
      }
    }
  }

  return {
    async openCore(text: string): Promise<CanvasCore> {
      const source = encodeText(text);
      const target = await instance();
      const answer = invoke(target, source, (ptr, len) => target.exports.canvas_open(ptr, len));
      const handle = answer.status >>> 0;
      if (handle === 0) throw failure(answer.bytes);
      const opened = parseJson(answer.bytes) as { handle: number; canvas: CanvasDocument };
      return new Core(target, handle, opened.canvas, invoke);
    },
    memoryBytes(): number | null {
      return live ? live.exports.memory.buffer.byteLength : null;
    },
  };
}

function lost(): CanvasCoreError {
  return new CanvasCoreError("trap", "the canvas core trapped earlier: open the canvas again from its text");
}

function parseJson(bytes: Uint8Array): unknown {
  try {
    return JSON.parse(decoder.decode(bytes));
  } catch (error) {
    throw new CanvasCoreError("internal", `the canvas core answered with unreadable JSON: ${String(error)}`, {}, error);
  }
}

/** L'errore nel risultato di una chiamata fallita. */
function failure(bytes: Uint8Array): CanvasCoreError {
  const parsed = parseJson(bytes) as { error?: { code?: unknown; message?: unknown; [field: string]: unknown } };
  const error = parsed.error;
  if (!error || typeof error.code !== "string" || !MODULE_CODES.has(error.code)) {
    return new CanvasCoreError("internal", `the canvas core answered with an unknown error: ${decoder.decode(bytes)}`);
  }
  const { code, message, ...details } = error;
  return new CanvasCoreError(code as CanvasCoreErrorCode, typeof message === "string" ? message : code, details);
}

/** Lo stato `0 | -1` di una chiamata: il risultato se riesce. */
function settled(answer: Answer): Uint8Array {
  if (answer.status === 0) return answer.bytes;
  if (answer.status === -1) throw failure(answer.bytes);
  throw new CanvasCoreError("internal", `the canvas core answered with status ${answer.status}`);
}

type Invoke = (target: Instance, input: Uint8Array | null, run: (ptr: number, len: number) => number) => Answer;

class Core implements CanvasCore {
  readonly #target: Instance;
  readonly #handle: number;
  readonly #invoke: Invoke;
  #closed = false;
  /** Il modello della risposta di apertura, consegnato al primo `model()` se niente l'ha cambiato. */
  #fresh: CanvasDocument | null;

  constructor(target: Instance, handle: number, canvas: CanvasDocument, invoke: Invoke) {
    this.#target = target;
    this.#handle = handle;
    this.#fresh = canvas;
    this.#invoke = invoke;
  }

  get closed(): boolean {
    return this.#closed;
  }

  model(): CanvasDocument {
    this.#live();
    const fresh = this.#fresh;
    if (fresh) {
      this.#fresh = null;
      return fresh;
    }
    return (this.#json(null, () => this.#target.exports.canvas_model(this.#handle)) as { canvas: CanvasDocument }).canvas;
  }

  reset(text: string): CanvasDocument {
    this.#live();
    const source = encodeText(text);
    this.#fresh = null;
    return (this.#json(source, (ptr, len) => this.#target.exports.canvas_reset(this.#handle, ptr, len)) as { canvas: CanvasDocument }).canvas;
  }

  commit(patches: readonly CanvasPatch[]): CanvasCommitted {
    this.#live();
    const request = encodeJson(patches);
    this.#fresh = null;
    return this.#json(request, (ptr, len) => this.#target.exports.canvas_commit(this.#handle, ptr, len)) as CanvasCommitted;
  }

  preview(patches: readonly CanvasPatch[]): string {
    this.#live();
    const request = encodeJson(patches);
    const bytes = settled(this.#invoke(this.#target, request, (ptr, len) => this.#target.exports.canvas_preview(this.#handle, ptr, len)));
    return decoder.decode(bytes);
  }

  compile(ops: readonly CanvasIntentOp[], seed?: number | bigint | string): CanvasCompiled {
    this.#live();
    const request: { ops: readonly CanvasIntentOp[]; seed?: number | string } = { ops };
    if (seed !== undefined) {
      if (typeof seed === "number" && !Number.isSafeInteger(seed)) {
        // Un numero oltre 2⁵³ non è più quello scritto: il seme esatto va come stringa.
        throw new CanvasCoreError("request", `the seed ${seed} is not a safe integer: pass it as a bigint or a string`);
      }
      request.seed = typeof seed === "bigint" ? seed.toString() : seed;
    }
    return this.#json(encodeJson(request), (ptr, len) => this.#target.exports.canvas_compile(this.#handle, ptr, len)) as CanvasCompiled;
  }

  nodeAt(byte: number): number | null {
    this.#live();
    if (!Number.isInteger(byte) || byte < 0) throw new CanvasCoreError("request", `the byte offset ${byte} is not a non-negative integer`);
    // Il nucleo conta in `u32`: oltre, il byte è comunque fuori da ogni scheda.
    if (byte > 0xffff_ffff) return null;
    const answer = this.#invoke(this.#target, null, () => this.#target.exports.canvas_node_at(this.#handle, byte));
    if (answer.status === -1) return null;
    if (answer.status === -2) throw failure(answer.bytes);
    if (answer.status < 0) throw new CanvasCoreError("internal", `the canvas core answered with status ${answer.status}`);
    return answer.status;
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#fresh = null;
    // Un'istanza morta ha già perso le sue lavagne.
    if (this.#target.dead) return;
    settled(this.#invoke(this.#target, null, () => this.#target.exports.canvas_close(this.#handle)));
  }

  /** Lancia se la lavagna è chiusa o la sua istanza è morta. */
  #live(): void {
    if (this.#closed) throw new CanvasCoreError("handle", "the canvas is closed");
    if (this.#target.dead) throw lost();
  }

  #json(input: Uint8Array | null, run: (ptr: number, len: number) => number): unknown {
    return parseJson(settled(this.#invoke(this.#target, input, run)));
  }
}

const runtime = createCanvasCoreRuntime({ load: loadCanvasWasm });

/** Apre una lavagna nel nucleo condiviso dalla shell. */
export const openCore: (text: string) => Promise<CanvasCore> = (text) => runtime.openCore(text);

/** I byte della memoria del nucleo condiviso, `null` prima che si carichi o dopo una trappola. */
export const canvasCoreMemoryBytes: () => number | null = () => runtime.memoryBytes();
