// @vitest-environment happy-dom
// `ExportContent` (T74): cambia la resa prima della misura e la rimette dopo;
// i blocchi tengono le identità di prima dei cambi, portano le note dei loro
// commenti, e una tabella lunga ripete l'intestazione solo se il profilo lo
// chiede. Le proprietà arrivano dopo e chiedono una misura nuova.

import { afterEach, describe, expect, it, vi } from "vitest";
import { blockId, printBlocks, type MeasuredBlock } from "../paginate/measure";
import type { FlowBox, TableBox } from "../paginate/model";
import { paginate } from "../paginate/rules";
import { frameOf, type BlockSource, type PrintLayout } from "../paginate/slices";
import { defaultProfile, printSettingsOf, type ExportProfile } from "../profile";
import { inertComments } from "./comments";
import { ADDED_PREFIX, ExportContent, notesShapeOf } from "./index";

const ROW = 38;
const HEAD = 40;

function layoutWith(contenuto: Partial<ExportProfile["contenuto"]>, interruzioni: Partial<ExportProfile["interruzioni"]> = {}): PrintLayout {
  const base = defaultProfile();
  return printSettingsOf({ ...base, contenuto: { ...base.contenuto, ...contenuto }, interruzioni: { ...base.interruzioni, ...interruzioni } }).layout;
}

function mount(html: string): { page: HTMLElement; host: HTMLElement } {
  const host = document.createElement("div");
  host.innerHTML = `<article class="print-page"><h1>Nota</h1><div class="print-body markdown-rendered">${inertComments(html)}</div></article>`;
  document.body.append(host);
  return { page: host.querySelector<HTMLElement>(".print-page")!, host };
}

/// Una misura finta: un paragrafo alto 20 per blocco, e una tabella con le
/// sue righe da 38 px e l'intestazione da 40.
function fakeBuild(page: HTMLElement): BlockSource & { dispose(): void } {
  const blocks = printBlocks(page);
  return {
    count: blocks.length,
    measure(index): MeasuredBlock {
      const element = blocks[index]!;
      const id = blockId(element, index);
      const table = element.matches("table") ? element : element.hasAttribute("data-print-table") ? element.querySelector("table") : null;
      const box: FlowBox = table
        ? { kind: "table", id, header: HEAD, rows: [...table.querySelectorAll("tbody tr:not([hidden])")].map(() => ROW) }
        : { kind: "paragraph", id, lines: [20] };
      return { box, top: 0, bottom: 20, exact: true };
    },
    dispose() {},
  };
}

function boxes(source: BlockSource): FlowBox[] {
  return Array.from({ length: source.count }, (_, index) => source.measure(index, "righe").box);
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("il contenuto sulla resa", () => {
  it("senza le scelte del contenuto misura la resa com'è", () => {
    const { page, host } = mount(`<p>uno</p>`);
    const content = new ExportContent({ title: "Nota", onChange() {} });
    const layout = { ...layoutWith({}), content: undefined };
    const source = content.measure(page, host, layout, fakeBuild);
    // Il titolo e il paragrafo.
    expect(source.count).toBe(2);
    expect(page.querySelector(".export-properties")).toBeNull();
  });

  it("un blocco aggiunto non sposta le identità degli altri, e la resa torna com'era", () => {
    const { page, host } = mount(`<p>uno</p><pre><code>a\nb</code></pre><p>tre</p>`);
    const pristine = page.innerHTML;
    const before = printBlocks(page).map((element, index) => blockId(element, index));
    const content = new ExportContent({ title: "Nota", onChange() {} });
    const source = content.measure(page, host, layoutWith({ proprieta: "tutte", codice_numerato: true }), fakeBuild);
    const ids = boxes(source).map((box) => box.id);
    for (const id of before) expect(ids).toContain(id);
    source.dispose();
    expect(page.innerHTML).toBe(pristine);
  });

  it("le proprietà arrivano dopo: una misura nuova le mette sotto il titolo", async () => {
    const { page, host } = mount(`<p>uno</p>`);
    const onChange = vi.fn();
    const content = new ExportContent({ title: "Nota", onChange, properties: async () => [{ key: "stato", value: "bozza" }] });
    const layout = layoutWith({ proprieta: "tutte" });
    content.measure(page, host, layout, fakeBuild).dispose();
    await Promise.resolve();
    await Promise.resolve();
    expect(onChange).toHaveBeenCalledTimes(1);
    const source = content.measure(page, host, layout, fakeBuild);
    expect(page.querySelector(".export-properties dd")!.textContent).toBe("bozza");
    expect(boxes(source).some((box) => box.id.startsWith(ADDED_PREFIX))).toBe(true);
    content.dispose();
    expect(page.querySelector(".export-properties")).toBeNull();
  });

  it("i commenti nel margine: la nota sta accanto alla resa e la scatola la porta", () => {
    const { page, host } = mount(`<p>uno<template class="comment-note" data-author="Anna">Vero?</template></p><p>due</p>`);
    const layout = layoutWith({ commenti: "margine" });
    const content = new ExportContent({ title: "Nota", onChange() {} });
    const source = content.measure(page, host, layout, fakeBuild);
    expect(notesShapeOf(layout)).toBe(frameOf(layout).frame.noteMargin >= 22 * (96 / 25.4) ? "margine" : "fondo");
    const container = host.querySelector(".export-comments")!;
    expect(container.querySelectorAll("[data-export-note]")).toHaveLength(1);
    const [title, first, second] = boxes(source);
    expect(title!.notes).toBeUndefined();
    expect(first!.notes?.map((note) => note.id)).toEqual(["commento-1"]);
    expect(second!.notes).toBeUndefined();
    source.dispose();
    expect(host.querySelector(".export-comments")).toBeNull();
  });

  it("i commenti in fondo hanno il titolo «Commenti» nella prima nota", () => {
    const { page, host } = mount(`<p>uno<template class="comment-note" data-author="Anna">Vero?</template></p>`);
    const layout = layoutWith({ commenti: "in-fondo" });
    expect(notesShapeOf(layout)).toBe("fondo");
    expect(frameOf(layout).frame.noteMargin).toBe(0);
    new ExportContent({ title: "Nota", onChange() {} }).measure(page, host, layout, fakeBuild);
    expect(host.querySelector(".export-comments .export-comments-title")!.textContent).toBe("Commenti");
  });

  it("commenti «No»: nessun numero e nessuna nota", () => {
    const { page, host } = mount(`<p>uno<template class="comment-note">Vero?</template></p>`);
    new ExportContent({ title: "Nota", onChange() {} }).measure(page, host, layoutWith({ commenti: "no" }), fakeBuild);
    expect(page.querySelector(".export-comment-mark")).toBeNull();
    expect(host.querySelector(".export-comments")).toBeNull();
  });
});

describe("una Base di mille righe", () => {
  function base(rows: number): string {
    const body = Array.from({ length: rows }, (_, i) => `<tr data-doc="Opere/${i}.md"><td>${i}</td></tr>`).join("");
    return `<div class="embed" data-embed-page="Opere.base"><div class="ui-slot" data-custom-kind="base"><div class="base-surface"><div class="base-bar"></div>
      <div class="base-body"><div class="base-table-viewport" style="max-height:560px"><table><thead><tr><th>Nome</th></tr></thead><tbody>${body}</tbody></table></div></div></div></div></div>`;
  }

  function tableBox(layout: PrintLayout): TableBox {
    const { page, host } = mount(base(1000));
    const source = new ExportContent({ title: "Nota", onChange() {} }).measure(page, host, layout, fakeBuild);
    const box = boxes(source).find((candidate): candidate is TableBox => candidate.kind === "table")!;
    expect(box.rows).toHaveLength(1000);
    return box;
  }

  it("continua pagina dopo pagina con la sua intestazione", () => {
    const layout = layoutWith({});
    const box = tableBox(layout);
    const result = paginate([box], frameOf(layout).frame);
    expect(result.pages.length).toBeGreaterThan(10);
    const repeated = result.pages.slice(1).filter((page) => page.placements.some((placement) => placement.part === "intestazione"));
    expect(repeated).toHaveLength(result.pages.length - 1);
  });

  it("senza «ripeti l'intestazione» l'intestazione resta solo in cima", () => {
    const layout = layoutWith({}, { ripeti_intestazione: false });
    const box = tableBox(layout);
    expect(box.header).toBe(0);
    expect(box.rows[0]).toBe(HEAD + ROW);
    const result = paginate([box], frameOf(layout).frame);
    expect(result.pages.some((page) => page.placements.some((placement) => placement.part === "intestazione"))).toBe(false);
  });
});
