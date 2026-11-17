// Il riduttore dell'inchiostro in TypeScript e in WebAssembly, fianco a fianco.
//
// Il modulo non si costruisce da sé: dalla radice del repo
//
//   cargo build --manifest-path tools/ink-wasm-banco/Cargo.toml --release --target wasm32-unknown-unknown
//
// che lo scrive in
// `tools/ink-wasm-banco/target/wasm32-unknown-unknown/release/ink_wasm_banco.wasm`
// (o dove dice la variabile `FUB_INK_WASM`). Se il file manca il banco si
// salta e lo dice. È soltanto una misura (piano N3, T17): la shell non carica
// questo modulo, e la decisione 0204 resta com'è.
//
// Si lancia con `npm run bench:ink`, insieme a `pipeline.bench.ts`, di cui
// rifà gli scenari del riduttore con gli stessi dati. Gli altri due gruppi di
// quel banco (l'adattatore del browser e l'anteprima) non hanno una copia
// Rust in `crates/fub-ink`, e quindi niente da confrontare.
//
// Per ogni scenario stampa due colonne, TypeScript e WebAssembly, in
// nanosecondi per evento (la mediana dei giri), più due righe che separano i
// costi del WebAssembly:
//
// - «WebAssembly» è il percorso che avrebbe la shell: un evento, una
//   chiamata; i campioni si copiano nella memoria del modulo e gli effetti si
//   ricopiano fuori a ogni evento;
// - «tratto in una chiamata» è il riduttore da solo: il tratto è già nella
//   memoria del modulo, e una chiamata lo fa tutto;
// - «solo copie» è il confine da solo: gli stessi campioni dentro e fuori a
//   ogni evento, senza riduttore.
//
// La prima chiamata (compilare e istanziare il modulo, poi il primo tratto a
// freddo) si conta a parte, una volta sola, e così il riscaldamento dopo, che
// aspetta la compilazione ottimizzata del motore. Come `pipeline.bench.ts`, non
// asserisce tempi: soltanto che il lavoro c'è stato e che le due copie danno
// lo stesso numero di effetti.

import { describe, expect, it } from "vitest";
import { pointerSample, type InkPointerType, type PointerSample } from "./input/pointer";
import { Session } from "./input/session";
import type { StabilizerConfig } from "./input/stabilizer";

/// Il poco di Node che serve per leggere il modulo. `tsconfig.json` dichiara i
/// soli tipi di Vite (vedi `boundary.test.ts`), e Vite non sa servire un
/// `.wasm` a Vitest senza toccare la configurazione: il file si legge con
/// `process.getBuiltinModule` (Node 22.3 e dopo), tipato qui a mano.
interface NodeFs {
  existsSync(path: URL): boolean;
  readFileSync(path: URL): Uint8Array<ArrayBuffer>;
}
interface NodeProcess {
  readonly env: Record<string, string | undefined>;
  getBuiltinModule(id: "node:fs"): NodeFs;
  cwd(): string;
}
const node = (globalThis as unknown as { process: NodeProcess }).process;
const fs = node.getBuiltinModule("node:fs");
const override = node.env.FUB_INK_WASM;
const WASM = override
  ? new URL(override, `file://${node.cwd()}/`)
  : new URL("../../../../tools/ink-wasm-banco/target/wasm32-unknown-unknown/release/ink_wasm_banco.wasm", import.meta.url);

/// I `f64` di un campione nel buffer d'ingresso (`FIELDS` di `src/lib.rs`).
const FIELDS = 15;
/// Il conto di un evento su una maniglia sconosciuta o un ingresso corto.
const UNKNOWN = 0xffff_ffff;

interface InkExports {
  readonly memory: WebAssembly.Memory;
  ink_input(samples: number): number;
  ink_output(): number;
  ink_output_len(): number;
  ink_session_new(amount: number, pulledString: number, catchUp: number, catchUpOnEnd: number): number;
  ink_session_free(handle: number): void;
  ink_pointer_down(handle: number): number;
  ink_pointer_move(handle: number, coalesced: number, predicted: number): number;
  ink_pointer_up(handle: number): number;
  ink_run_flow(handle: number, moves: number, coalesced: number, predicted: number): number;
  ink_echo(samples: number): number;
}

/// Misura `fn` come `measure` di `pipeline.bench.ts`: tre giri per scaldare,
/// poi giri per un secondo e mezzo almeno (e cinque in ogni caso). Restituisce
/// mediana e minimo in nanosecondi per evento, e quanti giri.
function time(events: number, fn: () => number): { median: number; min: number; runs: number; work: number } {
  for (let i = 0; i < 3; i++) fn();
  const runs: number[] = [];
  let work = 0;
  const end = performance.now() + 1_500;
  while (performance.now() < end || runs.length < 5) {
    const start = performance.now();
    work += fn();
    runs.push(performance.now() - start);
  }
  runs.sort((a, b) => a - b);
  const nanos = (ms: number): number => Math.round((ms * 1e6) / events);
  return { median: nanos(runs[runs.length >> 1]!), min: nanos(runs[0]!), runs: runs.length, work };
}

/// Il campione in `at`, come in `pipeline.bench.ts`.
function sampleAt(kind: InkPointerType, at: number): PointerSample {
  const phase = at * 0.01;
  return pointerSample({
    pointerId: 1,
    pointerType: kind,
    x: 400 + 300 * Math.cos(phase),
    y: 300 + 200 * Math.sin(phase),
    timeStamp: at * 4,
    pressure: kind === "pen" ? 0.2 + 0.6 * (Math.sin(phase) * 0.5 + 0.5) : 0.5,
  });
}

interface Move {
  readonly coalesced: PointerSample[];
  readonly event: PointerSample;
  readonly predicted: PointerSample[];
}

interface Flow {
  readonly down: PointerSample;
  readonly moves: readonly Move[];
  readonly up: PointerSample;
  readonly coalesced: number;
  readonly predicted: number;
}

/// Un tratto di `events` eventi, come in `pipeline.bench.ts`.
function flow(kind: InkPointerType, events: number, coalesced: number, predicted: number): Flow {
  const moves: Move[] = [];
  for (let i = 1; i < events; i++) {
    moves.push({
      coalesced: Array.from({ length: coalesced }, (_, k) => sampleAt(kind, i - 1 + (k + 1) / (coalesced + 1))),
      event: sampleAt(kind, i),
      predicted: Array.from({ length: predicted }, (_, k) => sampleAt(kind, i + k + 1)),
    });
  }
  return { down: sampleAt(kind, 0), moves, up: sampleAt(kind, events), coalesced, predicted };
}

function runTs(session: Session, stroke: Flow): number {
  let effects = session.pointerDown(stroke.down).length;
  for (const move of stroke.moves) effects += session.pointerMove(move.coalesced, move.event, move.predicted).length;
  return effects + session.pointerUp(stroke.up).length;
}

const KIND: Record<InkPointerType, number> = { mouse: 0, pen: 1, touch: 2 };

/// Scrive `s` in `view` dal numero `at`, nell'ordine di `decode` di `src/lib.rs`.
function put(view: Float64Array, at: number, s: PointerSample): void {
  view[at] = s.pointerId;
  view[at + 1] = KIND[s.pointerType];
  view[at + 2] = s.x;
  view[at + 3] = s.y;
  view[at + 4] = s.pressure;
  view[at + 5] = s.tiltX ?? NaN;
  view[at + 6] = s.tiltY ?? NaN;
  view[at + 7] = s.altitudeAngle ?? NaN;
  view[at + 8] = s.azimuthAngle ?? NaN;
  view[at + 9] = s.twist;
  view[at + 10] = s.buttons;
  view[at + 11] = s.button;
  view[at + 12] = s.timeStamp;
  view[at + 13] = s.turn;
  view[at + 14] = s.scale;
}

/// La memoria del modulo vista come `f64`, per copiare dentro e fuori senza
/// creare una vista a ogni evento (che costa più della copia). Un indirizzo
/// vale fino alla chiamata dopo, che può far crescere la memoria: allora il
/// vecchio `ArrayBuffer` si stacca e la vista si rifà.
class Boundary {
  private heap = new Float64Array(0);

  constructor(readonly ink: InkExports) {}

  private memory(): Float64Array {
    if (this.heap.buffer !== this.ink.memory.buffer) this.heap = new Float64Array(this.ink.memory.buffer);
    return this.heap;
  }

  /// Copia nel modulo i campioni di un evento.
  copyIn(samples: readonly PointerSample[]): void {
    const at = this.ink.ink_input(samples.length) >>> 3;
    const heap = this.memory();
    for (let i = 0; i < samples.length; i++) put(heap, at + i * FIELDS, samples[i]!);
  }

  /// Copia nel modulo un movimento: i coalescenti, l'evento, i predetti.
  copyMove(move: Move): void {
    const n = move.coalesced.length + 1 + move.predicted.length;
    let at = this.ink.ink_input(n) >>> 3;
    const heap = this.memory();
    for (const s of move.coalesced) {
      put(heap, at, s);
      at += FIELDS;
    }
    put(heap, at, move.event);
    at += FIELDS;
    for (const s of move.predicted) {
      put(heap, at, s);
      at += FIELDS;
    }
  }

  /// Ricopia fuori gli effetti dell'ultimo evento, come farebbe un adattatore
  /// che li consegna al resto della shell.
  copyOut(): Float64Array {
    const len = this.ink.ink_output_len();
    const from = this.ink.ink_output() >>> 3;
    const heap = this.memory();
    const out = new Float64Array(len);
    for (let i = 0; i < len; i++) out[i] = heap[from + i]!;
    return out;
  }
}

function checked(n: number): number {
  if (n === UNKNOWN) throw new Error("il modulo ha rifiutato l'evento");
  return n;
}

/// Il percorso della shell: un evento, una chiamata, le copie a ogni evento.
function runWasm(edge: Boundary, stabilizer: StabilizerConfig | null, stroke: Flow): number {
  const ink = edge.ink;
  const handle = newSession(ink, stabilizer);
  let out = 0;
  edge.copyIn([stroke.down]);
  let effects = checked(ink.ink_pointer_down(handle));
  out += edge.copyOut().length;
  for (const move of stroke.moves) {
    edge.copyMove(move);
    effects += checked(ink.ink_pointer_move(handle, stroke.coalesced, stroke.predicted));
    out += edge.copyOut().length;
  }
  edge.copyIn([stroke.up]);
  effects += checked(ink.ink_pointer_up(handle));
  out += edge.copyOut().length;
  ink.ink_session_free(handle);
  if (out === 0) throw new Error("il modulo non ha scritto effetti");
  return effects;
}

function newSession(ink: InkExports, stabilizer: StabilizerConfig | null): number {
  const s = stabilizer ?? { amount: 0, pulledString: false, catchUp: true, catchUpOnEnd: true };
  const handle = ink.ink_session_new(s.amount, Number(s.pulledString), Number(s.catchUp), Number(s.catchUpOnEnd));
  if (handle === 0) throw new Error("configurazione rifiutata dal modulo");
  return handle;
}

/// Tutto il tratto in fila, per `ink_run_flow`.
function flat(stroke: Flow): PointerSample[] {
  return [stroke.down, ...stroke.moves.flatMap((m) => [...m.coalesced, m.event, ...m.predicted]), stroke.up];
}

const EVENTS = 2_000;
const MEAN: StabilizerConfig = { amount: 0.5, pulledString: false, catchUp: true, catchUpOnEnd: true };
const mouse = flow("mouse", EVENTS, 0, 0);
const pen = flow("pen", EVENTS, 4, 3);
const SCENARIOS: ReadonlyArray<{ label: string; stroke: Flow; stabilizer: StabilizerConfig | null }> = [
  { label: "mouse, senza coalescenti", stroke: mouse, stabilizer: null },
  { label: "penna 240 Hz, 4 coalescenti, 3 predetti", stroke: pen, stabilizer: null },
  { label: "penna con stabilizzatore a media", stroke: pen, stabilizer: MEAN },
];

const present = fs.existsSync(WASM);
if (!present) {
  console.info(`banco WebAssembly dell'inchiostro saltato: manca ${WASM.pathname}\n  costruiscilo con: cargo build --manifest-path tools/ink-wasm-banco/Cargo.toml --release --target wasm32-unknown-unknown`);
}

const cell = (n: number): string => String(n).padStart(9);

describe.skipIf(!present)(`riduttore (Session), TypeScript contro WebAssembly, ${EVENTS} eventi per iterazione`, () => {
  let edge: Boundary;

  it("la prima chiamata: compilare, istanziare, il primo tratto a freddo", async () => {
    const bytes = fs.readFileSync(WASM);
    const t0 = performance.now();
    const module = await WebAssembly.compile(bytes);
    const t1 = performance.now();
    const instance = await WebAssembly.instantiate(module, {});
    const t2 = performance.now();
    edge = new Boundary(instance.exports as unknown as InkExports);
    const effects = runWasm(edge, null, mouse);
    const t3 = performance.now();
    // Il motore compila il modulo prima in fretta e poi, in sottofondo, per
    // bene: il riscaldamento lo aspetta, su tutti gli scenari e per le due
    // copie, così le misure dopo sono a regime e questo costo resta qui.
    const strokes: number[] = [];
    const warm = performance.now() + 1_500;
    while (performance.now() < warm) {
      for (const { stroke, stabilizer } of SCENARIOS) {
        const start = performance.now();
        runWasm(edge, stabilizer, stroke);
        if (stroke === mouse && stabilizer === null) strokes.push(performance.now() - start);
        // TypeScript ha lo stesso riscaldamento, perché le colonne partano pari.
        runTs(new Session(stabilizer ? { stabilizer } : {}), stroke);
      }
    }
    const us = (ms: number): string => `${Math.round(ms * 1000)} µs`;
    console.info(
      `prima chiamata: modulo di ${bytes.length} byte; compilare ${us(t1 - t0)}, istanziare ${us(t2 - t1)}, primo tratto (mouse, ${EVENTS} eventi) ${us(t3 - t2)}`,
    );
    console.info(
      `riscaldamento: 1,5 s su tutti gli scenari, TypeScript e WebAssembly; il tratto del mouse da ${us(strokes[0]!)} (il secondo) a ${us(strokes[strokes.length - 1]!)} (l'ultimo di ${strokes.length})`,
    );
    expect(effects).toBeGreaterThan(0);
  });

  it("intestazione", () => {
    console.info(`${"scenario".padEnd(46)} ${"TypeScript".padStart(10)} ${"WebAssembly".padStart(12)}   ns/evento, mediana`);
  });

  for (const { label, stroke, stabilizer } of SCENARIOS) {
    it(label, () => {
      const ts = time(EVENTS, () => runTs(new Session(stabilizer ? { stabilizer } : {}), stroke));
      const ink = edge.ink;
      const wasm = time(EVENTS, () => runWasm(edge, stabilizer, stroke));

      const all = flat(stroke);
      const flowRun = (): number => {
        const handle = newSession(ink, stabilizer);
        const n = checked(ink.ink_run_flow(handle, stroke.moves.length, stroke.coalesced, stroke.predicted));
        ink.ink_session_free(handle);
        return n;
      };
      edge.copyIn(all);
      const whole = time(EVENTS, flowRun);

      const copies = time(EVENTS, () => {
        let out = 0;
        edge.copyIn([stroke.down]);
        checked(ink.ink_echo(1));
        out += edge.copyOut().length;
        for (const move of stroke.moves) {
          edge.copyMove(move);
          checked(ink.ink_echo(move.coalesced.length + 1 + move.predicted.length));
          out += edge.copyOut().length;
        }
        edge.copyIn([stroke.up]);
        checked(ink.ink_echo(1));
        out += edge.copyOut().length;
        return out;
      });

      console.info(`${label.padEnd(46)} ${cell(ts.median).padStart(10)} ${cell(wasm.median).padStart(12)}   (minimi ${ts.min} e ${wasm.min}; giri ${ts.runs} e ${wasm.runs})`);
      console.info(`${"  └ WebAssembly, tratto in una chiamata".padEnd(46)} ${"".padStart(10)} ${cell(whole.median).padStart(12)}   (minimo ${whole.min}, ${whole.runs} giri)`);
      console.info(`${"  └ WebAssembly, solo copie dentro e fuori".padEnd(46)} ${"".padStart(10)} ${cell(copies.median).padStart(12)}   (minimo ${copies.min}, ${copies.runs} giri)`);

      // Le due copie del riduttore hanno fatto lo stesso lavoro.
      const tsEffects = runTs(new Session(stabilizer ? { stabilizer } : {}), stroke);
      expect(runWasm(edge, stabilizer, stroke)).toBe(tsEffects);
      edge.copyIn(all);
      expect(flowRun()).toBe(tsEffects);
      expect(copies.work).toBeGreaterThan(0);
    }, 120_000);
  }
});
