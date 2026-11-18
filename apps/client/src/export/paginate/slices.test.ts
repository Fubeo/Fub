// @vitest-environment happy-dom
// L'impaginatore a fette (T69b): prima le pagine che si vedono, il resto nei
// tempi morti, il totale «…» finché non ha finito; i colori non rifanno
// l'impaginazione, caratteri e margini sì; una nota cambiata durante il
// lavoro segue la revisione nuova e tiene le regolazioni.

import { describe, expect, it, vi } from "vitest";
import type { RenderedDocument } from "../../host/contract";
import { A4 } from "../probe";
import { applyBreaks } from "./breaks";
import type { MeasureDepth, MeasuredBlock } from "./measure";
import type { Box, FlowBox, PageFrame } from "./model";
import { paginate } from "./rules";
import {
  IDLE_SLICE_MS,
  PrintPaginator,
  SlicedPagination,
  VISIBLE_SLICE_MS,
  frameOf,
  layoutChanged,
  pageShift,
  type BlockSource,
  type PrintSettings,
  type Scheduler,
  type SlicedResult,
} from "./slices";

/// Un calendario a mano: le fette girano quando il test lo dice, e l'ora
/// avanza solo con le misure.
class ManualScheduler implements Scheduler {
  time = 0;
  readonly queue: { kind: "soon" | "idle"; task: () => void }[] = [];
  readonly ran: ("soon" | "idle")[] = [];
  now = () => this.time;
  soon(task: () => void) {
    return this.push("soon", task);
  }
  idle(task: () => void) {
    return this.push("idle", task);
  }
  /// Fa girare la prossima fetta; `false` se non ce n'è.
  step(): boolean {
    const next = this.queue.shift();
    if (!next) return false;
    this.ran.push(next.kind);
    next.task();
    return true;
  }
  drain(limit = 100_000): void {
    for (let i = 0; i < limit && this.step(); i++);
  }
  private push(kind: "soon" | "idle", task: () => void) {
    const entry = { kind, task };
    this.queue.push(entry);
    return () => {
      const at = this.queue.indexOf(entry);
      if (at >= 0) this.queue.splice(at, 1);
    };
  }
}

const LINE = 22;
const GAP = 9.7;

/// Una nota finta già disposta: paragrafi di righe da 22 px, con un titolo
/// ogni tanto e qualche riga più alta (una formula in linea), che la stima
/// non vede.
function fakeNote(blocks: number, clock: ManualScheduler, costs = { stima: 0.01, righe: 0.2 }) {
  const real: MeasuredBlock[] = [];
  let y = 0;
  for (let i = 0; i < blocks; i++) {
    const id = `md:${i}`;
    let box: FlowBox;
    if (i % 9 === 0) box = { kind: "heading", id, level: 2, height: 25.8 };
    else {
      const lines = Array.from({ length: 3 + (i % 5) }, (_, k) => (i % 4 === 0 && k === 1 ? LINE + 8 : LINE));
      box = { kind: "paragraph", id, lines };
    }
    const height = box.kind === "paragraph" ? box.lines.reduce((a, b) => a + b, 0) : (box as { height: number }).height;
    real.push({ box, top: y, bottom: y + height, exact: true });
    y += height + GAP;
  }
  const calls: { index: number; depth: MeasureDepth }[] = [];
  const source: BlockSource = {
    count: blocks,
    measure(index, depth) {
      calls.push({ index, depth });
      clock.time += costs[depth];
      const block = real[index];
      if (depth === "righe" || block.box.kind !== "paragraph") return block;
      const total = block.box.lines.reduce((a, b) => a + b, 0);
      const n = block.box.lines.length;
      const uniform = block.box.lines.every((line) => line === LINE);
      return { ...block, box: { ...block.box, lines: Array.from({ length: n }, () => total / n) }, exact: uniform };
    },
  };
  return { source, real, calls };
}

/// La stima di questo blocco è già la misura: un titolo, o righe tutte uguali.
function estimateExact(block: MeasuredBlock): boolean {
  return block.box.kind !== "paragraph" || block.box.lines.every((line) => line === LINE);
}

const FRAME: PageFrame ={ height: 933.5, columns: 1, noteMargin: 83 };
const BREAKS = { everyHeading2: false, separator: false };

/// Le pagine che le regole fanno con le misure vere, tutte insieme.
function reference(real: MeasuredBlock[]) {
  const boxes: Box[] = [];
  real.forEach((block, i) => {
    const gap = i === 0 ? 0 : Math.max(0, block.top - real[i - 1].bottom);
    boxes.push(...applyBreaks([{ ...block.box, gap }], BREAKS));
  });
  return paginate(boxes, FRAME);
}

describe("le fette", () => {
  it("escono prima le pagine che si vedono, il resto nei tempi morti, e il totale aspetta la fine", () => {
    const clock = new ManualScheduler();
    const { source, real, calls } = fakeNote(600, clock);
    const updates: SlicedResult[] = [];
    const slices = new SlicedPagination({ source, frame: FRAME, breaks: BREAKS, onUpdate: (r) => updates.push(r), scheduler: clock });
    slices.start({ first: 0, last: 1 });

    expect(clock.step()).toBe(true);
    expect(clock.ran).toEqual(["soon"]);
    // Dopo una fetta sola: le due pagine che si vedono, misurate riga per riga.
    expect(updates).toHaveLength(1);
    const first = updates[0];
    expect(first.final).toBe(false);
    expect(first.total).toBeNull();
    expect(first.firstPage).toBeNull();
    expect(first.ready).toBeGreaterThan(1);
    const shown = new Set(first.pagination.pages.slice(0, 2).flatMap((p) => p.placements.map((pl) => first.blocks[pl.box])));
    for (const block of shown) expect(calls.some((c) => c.index === block && (c.depth === "righe" || estimateExact(real[block])))).toBe(true);
    // Ha stimato solo l'inizio della nota, non tutta.
    expect(calls.length).toBeLessThan(source.count / 4);
    // Le due pagine sono già quelle vere.
    const truth = reference(real);
    expect(first.pagination.pages.slice(0, 2)).toEqual(truth.pages.slice(0, 2));

    clock.drain();
    // Il resto è andato a fette nei tempi morti, ognuna corta.
    expect(clock.ran.filter((k) => k === "idle").length).toBeGreaterThan(3);
    const last = updates[updates.length - 1];
    expect(last.final).toBe(true);
    expect(last.total).toBe(truth.pages.length);
    expect(last.firstPage).toEqual(truth.firstPage);
    expect(last.pagination).toEqual(truth);
    // Prima della fine il conto delle pagine non si è mai detto.
    expect(updates.slice(0, -1).every((u) => u.total === null && u.firstPage === null)).toBe(true);
    // Ogni blocco misurato riga per riga al più una volta.
    const fine = calls.filter((c) => c.depth === "righe").map((c) => c.index);
    expect(new Set(fine).size).toBe(fine.length);
  });

  it("una pagina lontana passa davanti: si stima fino a lì e si misurano a fondo i suoi blocchi", () => {
    const clock = new ManualScheduler();
    const { source, real, calls } = fakeNote(2400, clock);
    const updates: SlicedResult[] = [];
    const slices = new SlicedPagination({ source, frame: FRAME, breaks: BREAKS, onUpdate: (r) => updates.push(r), scheduler: clock });
    slices.start({ first: 0, last: 0 });
    clock.step();
    const truth = reference(real);
    const far = Math.floor(truth.pages.length * 0.8);
    slices.setVisible({ first: far, last: far });
    const before = updates.length;
    let slicesRun = 0;
    while (updates.length === before && clock.step()) slicesRun++;
    const shown = updates[updates.length - 1];
    expect(shown.ready).toBeGreaterThan(far);
    expect(shown.final).toBe(false);
    // Le fette urgenti, non i tempi morti.
    expect(clock.ran.slice(1, 1 + slicesRun).every((k) => k === "soon")).toBe(true);
    const onFar = new Set(shown.pagination.pages[far].placements.map((p) => shown.blocks[p.box]));
    for (const block of onFar) {
      expect(calls.some((c) => c.index === block && (c.depth === "righe" || estimateExact(real[block])))).toBe(true);
    }
    // I blocchi delle prime pagine (oltre la prima) non sono stati misurati a fondo.
    const early = truth.pages[5].placements.map((p) => p.box);
    expect(early.some((box) => !calls.some((c) => c.index === box && c.depth === "righe") && real[box].box.kind === "paragraph" && !real[box].box.lines.every((l) => l === LINE))).toBe(true);
    // Con le stime prima di lei, la pagina lontana si sposta al più di una riga
    // rispetto alla vera.
    const got = shown.pagination.pages[far].placements[0];
    const want = truth.pages[far].placements[0];
    const lineOf = (block: number, from: number) => real[block].top + from;
    expect(Math.abs(lineOf(shown.blocks[got.box], got.from) - lineOf(want.box, want.from))).toBeLessThanOrEqual(LINE + 8 + GAP);

    clock.drain();
    expect(updates[updates.length - 1].pagination).toEqual(truth);
  });

  it("una fetta urgente sta sotto un compito lungo, una nei tempi morti in pochi millisecondi", () => {
    const clock = new ManualScheduler();
    const { source } = fakeNote(3000, clock, { stima: 0.05, righe: 0.5 });
    const durations: { kind: string; ms: number }[] = [];
    const slices = new SlicedPagination({ source, frame: FRAME, breaks: BREAKS, onUpdate: () => {}, scheduler: clock });
    slices.start({ first: 300, last: 301 });
    for (let i = 0; i < 400; i++) {
      const kind = clock.queue[0]?.kind;
      const t0 = clock.time;
      if (!clock.step()) break;
      durations.push({ kind: kind!, ms: clock.time - t0 });
    }
    // Una misura sola può sforare la fetta di poco (la sua durata).
    for (const d of durations.filter((d) => d.kind === "soon")) expect(d.ms).toBeLessThanOrEqual(VISIBLE_SLICE_MS + 0.5 * 40);
    for (const d of durations.filter((d) => d.kind === "idle")) expect(d.ms).toBeLessThanOrEqual(IDLE_SLICE_MS + 0.5);
    expect(slices.finished).toBe(true);
  });

  it("una nota vuota esce come una pagina bianca, finita", () => {
    const clock = new ManualScheduler();
    const updates: SlicedResult[] = [];
    const slices = new SlicedPagination({ source: { count: 0, measure: () => { throw new Error("niente"); } }, frame: FRAME, breaks: BREAKS, onUpdate: (r) => updates.push(r), scheduler: clock });
    slices.start();
    clock.drain();
    expect(updates[updates.length - 1]).toMatchObject({ final: true, total: 1 });
    expect(updates[updates.length - 1]!.pagination.pages).toEqual([{ placements: [], notes: [] }]);
  });

  it("una misura che fallisce ferma le fette e lo dice", () => {
    const clock = new ManualScheduler();
    const onError = vi.fn();
    const slices = new SlicedPagination({ source: { count: 3, measure: () => { throw new Error("blocco tolto"); } }, frame: FRAME, breaks: BREAKS, onUpdate: () => {}, onError, scheduler: clock });
    slices.start();
    clock.drain();
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: "blocco tolto" }));
    expect(clock.queue).toHaveLength(0);
  });

  it("dice dove spostare il disegno di una fascia", () => {
    const placement = { box: 1, id: "b", part: "corpo" as const, from: 44, to: 88, column: 0, y: 10, scale: 1, continued: true, continues: false };
    expect(pageShift({ tops: [0, 500] }, placement)).toEqual({ offset: 10 - 544, scale: 1 });
    // Una riga della resa a 544 (l'inizio della fascia) va a 10 sulla pagina.
    const { offset, scale } = pageShift({ tops: [0, 500] }, { ...placement, scale: 0.5 });
    expect((544 * scale) + offset).toBe(10);
  });
});

describe("le regolazioni", () => {
  const settings = (over: Partial<PrintSettings["layout"]> = {}, colors: Record<string, string> = { "--doc-link": "#145785" }): PrintSettings => ({
    layout: { page: A4, columns: 1, columnGap: 24, breaks: BREAKS, type: { "--doc-font-size": "14.7px" }, excluded: [], ...over },
    look: { colors },
  });

  it("colori e link non rifanno l'impaginazione; caratteri, margini, formato e contenuto sì", () => {
    const base = settings();
    expect(layoutChanged(base.layout, settings({}, { "--doc-link": "#aa0000" }).layout)).toBe(false);
    expect(layoutChanged(base.layout, { ...base.layout, columnGap: 40 })).toBe(false);
    expect(layoutChanged(base.layout, { ...base.layout, type: { "--doc-font-size": "16px" } })).toBe(true);
    expect(layoutChanged(base.layout, { ...base.layout, page: { ...A4, margin: { ...A4.margin, left: 40 } } })).toBe(true);
    expect(layoutChanged(base.layout, { ...base.layout, page: { ...A4, width: 816, height: 1056 } })).toBe(true);
    expect(layoutChanged(base.layout, { ...base.layout, excluded: ["md:40"] })).toBe(true);
    expect(layoutChanged(base.layout, { ...base.layout, breaks: { everyHeading2: true, separator: false } })).toBe(true);
  });

  it("la colonna e la pagina vengono dal formato e dai margini", () => {
    const one = frameOf(settings().layout);
    expect(one.width).toBe(794 - 144);
    expect(one.frame).toEqual({ height: 1123 - 144, columns: 1, noteMargin: 72 });
    const two = frameOf(settings({ columns: 2, columnGap: 24 }).layout);
    expect(two.width).toBe((794 - 144 - 24) / 2);
    expect(() => frameOf(settings({ page: { ...A4, margin: { top: 600, bottom: 600, left: 72, right: 72 } } }).layout)).toThrow(RangeError);
  });

  function paginator(options: { render?: () => Promise<RenderedDocument>; initial?: PrintSettings } = {}) {
    const clock = new ManualScheduler();
    const note = fakeNote(120, clock);
    const measured = vi.fn(() => note.source);
    const updates: SlicedResult[] = [];
    const render = vi.fn(options.render ?? (async () => ({ html: "<p>uno</p>", parts: [] })));
    const p = new PrintPaginator({
      doc: "nota.md",
      title: "Nota",
      render,
      settings: options.initial ?? settings(),
      onUpdate: (r) => updates.push(r),
      scheduler: clock,
      measure: measured,
      waitMs: 10,
    });
    return { p, clock, measured, updates, render, note };
  }

  it("il cambio di colore cambia una variabile e non rifà l'impaginazione", async () => {
    const { p, clock, measured, updates, render, note } = paginator();
    await p.open();
    clock.drain();
    expect(p.layouts).toBe(1);
    const callsBefore = note.calls.length;
    const updatesBefore = updates.length;
    expect(p.host.style.getPropertyValue("--doc-link")).toBe("#145785");

    p.update(settings({}, { "--doc-link": "#aa0000", "--doc-heading": "#112233" }));
    clock.drain();
    expect(p.host.style.getPropertyValue("--doc-link")).toBe("#aa0000");
    expect(p.host.style.getPropertyValue("--doc-heading")).toBe("#112233");
    expect(p.layouts).toBe(1);
    expect(measured).toHaveBeenCalledTimes(1);
    expect(note.calls.length).toBe(callsBefore);
    expect(updates.length).toBe(updatesBefore);
    expect(clock.queue).toHaveLength(0);

    // Un colore tolto torna quello del tema.
    p.update(settings({}, {}));
    expect(p.host.style.getPropertyValue("--doc-link")).toBe("");
    expect(p.layouts).toBe(1);

    // Il corpo del testo invece rifà misura e impaginazione, non la resa.
    p.update(settings({ type: { "--doc-font-size": "16px" } }, {}));
    expect(p.host.style.getPropertyValue("--doc-font-size")).toBe("16px");
    clock.drain();
    expect(p.layouts).toBe(2);
    expect(measured).toHaveBeenCalledTimes(2);
    expect(render).toHaveBeenCalledTimes(1);
    expect(updates[updates.length - 1]!.final).toBe(true);
    p.dispose();
    expect(p.host.isConnected).toBe(false);
  });

  it("i margini cambiano la larghezza della colonna; una variabile che non è una variabile si rifiuta", async () => {
    const { p, clock } = paginator();
    await p.open();
    clock.drain();
    expect(p.host.style.width).toBe("650px");
    p.update(settings({ page: { ...A4, margin: { top: 72, bottom: 72, left: 100, right: 100 } } }));
    expect(p.host.style.width).toBe("594px");
    expect(() => p.update(settings({}, { color: "red" }))).toThrow(RangeError);
    p.dispose();
  });

  it("la nota cambiata durante l'impaginazione: segue la revisione nuova, tiene le regolazioni e le pagine sotto gli occhi", async () => {
    let resolveOld!: (r: RenderedDocument) => void;
    const old = new Promise<RenderedDocument>((r) => { resolveOld = r; });
    let k = 0;
    const render = () => (k++ === 0 ? old : Promise.resolve({ html: `<p>nuova ${k}</p>`, parts: [] }));
    const custom = settings({ type: { "--doc-font-size": "18px" } }, { "--doc-link": "#000000" });
    const { p, clock, updates } = paginator({ render, initial: custom });
    const opening = p.open();
    p.setVisible({ first: 3, last: 4 });
    // La nota cambia prima che la prima resa arrivi.
    await p.reload();
    expect(p.host.textContent).toContain("nuova");
    // La resa vecchia arriva dopo: si scarta.
    resolveOld({ html: "<p>vecchia</p>", parts: [] });
    await opening;
    expect(p.host.textContent).toContain("nuova");
    expect(p.host.textContent).not.toContain("vecchia");
    expect(p.host.style.getPropertyValue("--doc-font-size")).toBe("18px");
    expect(p.host.style.getPropertyValue("--doc-link")).toBe("#000000");
    clock.step();
    // Le prime pagine uscite sono quelle che si guardavano.
    expect(updates[0].ready).toBeGreaterThan(4);
    expect(p.layouts).toBe(1);
    // Un cambio mentre le fette girano le ferma: niente esce dalla misura vecchia.
    await p.reload();
    clock.drain();
    expect(p.layouts).toBe(2);
    expect(updates[updates.length - 1]!.final).toBe(true);
    p.dispose();
  });

  it("i blocchi lasciati fuori non si dispongono", async () => {
    const { p, clock } = paginator({ render: async () => ({ html: '<p data-md-from="0">uno</p><p data-md-from="10">due</p>', parts: [] }) });
    await p.open();
    clock.drain();
    const second = p.host.querySelector<HTMLElement>('[data-md-from="10"]')!;
    expect(second.hidden).toBe(false);
    p.update(settings({ excluded: ["md:10"] }));
    expect(second.hidden).toBe(true);
    p.update(settings({ excluded: [] }));
    expect(second.hidden).toBe(false);
    p.dispose();
  });

  it("una resa che non arriva lo dice, e non lascia contenitori", async () => {
    const onError = vi.fn();
    const p = new PrintPaginator({
      doc: "nota.md",
      title: "Nota",
      render: async () => { throw new Error("il core non risponde"); },
      settings: settings(),
      onUpdate: () => {},
      onError,
      scheduler: new ManualScheduler(),
    });
    await p.open();
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: "il core non risponde" }));
    p.dispose();
    expect(document.querySelector(".export-measure")).toBeNull();
  });
});
