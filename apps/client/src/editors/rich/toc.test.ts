// @vitest-environment happy-dom
//
// Il sommario dei titoli nella superficie ricca: si mette, si rifà al suo
// posto e si riscrive con il campo che Word ricalcola.
import { afterEach, describe, expect, it } from "vitest";
import { t } from "../../i18n/strings";
import { RichEngine } from "./engine";
import { parseProjection, type Block, type Para } from "./projection";
import { mountStrip } from "./strip";
import { insertToc } from "./toc";

let engines: RichEngine[] = [];
afterEach(() => {
  for (const engine of engines) engine.destroy();
  engines = [];
  document.body.replaceChildren();
});

const para = (x: string, role: object = { kind: "body" }): Block => ({ t: "para", role, c: [{ t: "text", x }] }) as Block;
const heading = (x: string, level: number) => para(x, { kind: "heading", level });

function engine(blocks: Block[]): RichEngine {
  const parent = document.createElement("div");
  document.body.append(parent);
  const made = new RichEngine(parent, { label: () => "documento", onChange: () => {}, onSelectionChange: () => {} });
  const page = { w: 612, h: 792, top: 72, bottom: 72, left: 72, right: 72 };
  made.setDoc(JSON.stringify({ format: "fub-rich", version: 1, page, blocks }));
  engines.push(made);
  return made;
}

const styles = (e: RichEngine) => parseProjection(e.getDoc()).blocks.map((b) => (b as Para).s ?? null);

describe("sommario", () => {
  it("si mette prima del blocco del cursore, con una voce per titolo", () => {
    const e = engine([para("premessa"), heading("Uno", 1), para("testo"), heading("Uno punto uno", 2), heading("Profondo", 4)]);
    e.select(2);
    expect(e.apply(insertToc("Sommario"))).toBe(true);
    const blocks = parseProjection(e.getDoc()).blocks as Para[];
    expect(styles(e).slice(0, 4)).toEqual(["TOCHeading", "TOC1", "TOC2", null]);
    expect(blocks[0]!.c).toEqual([{ t: "text", x: "Sommario" }, { t: "atom", kind: "field", toc: 3 }]);
    expect(blocks[1]!.c).toEqual([{ t: "text", x: "Uno" }]);
    expect(blocks[2]!.c).toEqual([{ t: "text", x: "Uno punto uno" }]);
  });

  it("si rifà al suo posto, con i titoli di adesso", () => {
    const e = engine([para("premessa"), heading("Uno", 1), para("testo")]);
    e.select(2);
    e.apply(insertToc("Sommario"));
    // Il titolo cambia: il sommario rifatto lo segue, senza doppioni.
    let end = -1;
    e.state.doc.forEach((node, pos) => {
      if (node.textContent === "Uno" && node.attrs.role.kind === "heading") end = pos + node.nodeSize - 1;
    });
    e.dispatch(e.state.tr.insertText(" bis", end));
    e.select(e.state.doc.content.size - 2);
    expect(e.apply(insertToc("Sommario"))).toBe(true);
    expect(styles(e)).toEqual(["TOCHeading", "TOC1", null, null, null]);
    expect((parseProjection(e.getDoc()).blocks[1] as Para).c).toEqual([{ t: "text", x: "Uno bis" }]);
    e.run("text.undo");
    expect((parseProjection(e.getDoc()).blocks[1] as Para).c).toEqual([{ t: "text", x: "Uno" }]);
  });

  it("senza titoli non c'è sommario da fare, e la striscia lo dice spento", () => {
    const e = engine([para("solo testo")]);
    e.select(2);
    expect(e.apply(insertToc("Sommario"))).toBe(false);
    const strip = mountStrip(e, () => null);
    document.body.append(strip.element);
    const find = () => [...strip.element.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.getAttribute("aria-label") === t("rich.toc"))!;
    expect(find().disabled).toBe(true);
    strip.destroy();
  });
});
