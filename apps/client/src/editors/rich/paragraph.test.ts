// @vitest-environment happy-dom
//
// Il paragrafo nella superficie ricca: allineamento, disposizione e stile che
// la proiezione porta in `align`, `p` e `s`, e i gesti che li cambiano.
import { afterEach, describe, expect, it } from "vitest";
import { Fragment, Slice } from "prosemirror-model";
import { selectedLayout, selectedStyle, setLayout, setStyle } from "./commands";
import { RichEngine } from "./engine";
import { parseProjection, type Block, type Para } from "./projection";
import { t } from "../../i18n/strings";
import { richSchema } from "./schema";
import { mountStrip } from "./strip";

let engines: RichEngine[] = [];
afterEach(() => {
  for (const engine of engines) engine.destroy();
  engines = [];
  document.body.replaceChildren();
});

const LOOK = { font: "Aptos", size: 12 };
const STYLES = [{ id: "Subtitle", name: "Subtitle", f: { font: "Aptos", size: 14 } }];

function engine(blocks: readonly Block[]): RichEngine {
  const parent = document.createElement("div");
  document.body.append(parent);
  const made = new RichEngine(parent, { label: () => "documento", onChange: () => {}, onSelectionChange: () => {} });
  made.setDoc(JSON.stringify({ format: "fub-rich", version: 1, f: LOOK, styles: STYLES, blocks }));
  engines.push(made);
  return made;
}

const para = (x: string, extra: Partial<Para> = {}): Block =>
  ({ t: "para", role: { kind: "body" }, f: LOOK, c: [{ t: "text", x }], ...extra }) as Block;

function paras(e: RichEngine): Para[] {
  return parseProjection(e.getDoc()).blocks.filter((block): block is Para => block.t === "para");
}

/// Seleziona dall'inizio del primo paragrafo alla fine dell'ultimo dei due
/// indici dati.
function selectParas(e: RichEngine, first: number, last = first): void {
  const starts: number[] = [];
  const ends: number[] = [];
  e.state.doc.forEach((node, offset) => {
    starts.push(offset + 1);
    ends.push(offset + node.nodeSize - 1);
  });
  e.select(starts[first]!, ends[last]!);
}

describe("il paragrafo", () => {
  it("la proiezione porta align, p e s nei due versi, e il documento li mostra", () => {
    const blocks = [
      para("uno", { align: "center", p: { left: 36, first: -18, line: { multiple: 1.5 } } }),
      para("due", { s: "Subtitle", f: { font: "Aptos", size: 14 } }),
    ];
    const e = engine(blocks);
    expect(paras(e).map(({ align, p, s }) => ({ align, p, s }))).toEqual([
      { align: "center", p: { left: 36, first: -18, line: { multiple: 1.5 } }, s: undefined },
      { align: undefined, p: undefined, s: "Subtitle" },
    ]);
    const [one, two] = [...document.querySelectorAll<HTMLElement>(".rich-para")];
    expect(one!.style.textAlign).toBe("center");
    expect(one!.style.marginLeft).toBe("36pt");
    expect(one!.style.textIndent).toBe("-18pt");
    // Uno stile del documento si disegna col suo carattere, rispetto al testo.
    expect(two!.style.fontFamily).toContain("Aptos");
    expect(two!.dataset.richS).toBe("Subtitle");
  });

  it("allinea, e un secondo tocco torna a sinistra", () => {
    const e = engine([para("uno"), para("due")]);
    selectParas(e, 0, 1);
    expect(e.actionState("rich.align.left").active).toBe(true);
    expect(e.run("rich.align.justify")).toBe(true);
    expect(paras(e).map((p) => p.align)).toEqual(["justify", "justify"]);
    expect(e.actionState("rich.align.justify").active).toBe(true);
    expect(e.run("rich.align.justify")).toBe(true);
    expect(paras(e).map((p) => p.align)).toEqual([undefined, undefined]);
  });

  it("i rientri vanno a passi e non oltre il margine", () => {
    const e = engine([para("uno", { p: { left: 18, after: 6 } })]);
    selectParas(e, 0);
    expect(e.run("rich.indent.increase")).toBe(true);
    expect(paras(e)[0]!.p).toEqual({ left: 54, after: 6 });
    expect(e.run("rich.indent.decrease")).toBe(true);
    expect(e.run("rich.indent.decrease")).toBe(true);
    expect(paras(e)[0]!.p).toEqual({ left: 0, after: 6 });
    expect(e.run("rich.indent.decrease")).toBe(false);
  });

  it("un campo vuoto torna allo stile, e la selezione dice dove i paragrafi differiscono", () => {
    const e = engine([para("uno", { p: { before: 6 } }), para("due")]);
    selectParas(e, 0, 1);
    expect(e.read((state) => selectedLayout(state, "before"))).toBeNull();
    expect(e.read((state) => selectedLayout(state, "after"))).toBeUndefined();
    expect(e.run("rich.line.2")).toBe(true);
    expect(e.actionState("rich.line.2").active).toBe(true);
    expect(e.apply(setLayout({ before: null }))).toBe(true);
    expect(paras(e).map((p) => p.p)).toEqual([{ line: { multiple: 2 } }, { line: { multiple: 2 } }]);
  });

  it("uno stile del documento fa testo normale con quello stile; un ruolo lo toglie", () => {
    const e = engine([para("uno", { role: { kind: "heading", level: 1 } })]);
    selectParas(e, 0);
    expect(e.read(selectedStyle)).toBe("h:1");
    expect(e.apply(setStyle({ s: "Subtitle", f: STYLES[0]!.f }, e.documentLook()))).toBe(true);
    expect(paras(e)[0]).toMatchObject({ role: { kind: "body" }, s: "Subtitle", f: { font: "Aptos", size: 14 } });
    expect(e.read(selectedStyle)).toBe("s:Subtitle");
    expect(e.apply(setStyle({ role: { kind: "body" } }, e.documentLook()))).toBe(true);
    expect(paras(e)[0]).toMatchObject({ role: { kind: "body" }, f: LOOK });
    expect(paras(e)[0]!.s).toBeUndefined();
  });

  it("la striscia propone gli stili del documento e la spaziatura del paragrafo", () => {
    const e = engine([para("uno", { p: { after: 8 } })]);
    selectParas(e, 0);
    const strip = mountStrip(e, () => null);
    document.body.append(strip.element);
    const style = strip.element.querySelector<HTMLSelectElement>(".rich-strip-style")!;
    expect(style.value).toBe("body");
    expect([...style.options].map((o) => o.textContent)).toContain("Subtitle");
    style.value = "s:Subtitle";
    style.dispatchEvent(new Event("change"));
    expect(paras(e)[0]!.s).toBe("Subtitle");
    strip.element.querySelector<HTMLButtonElement>('[data-action="rich.align.right"]')!.click();
    expect(paras(e)[0]!.align).toBe("right");
    expect(strip.element.querySelector('[data-action="rich.align.right"]')?.getAttribute("aria-pressed")).toBe("true");
    // La spaziatura: ogni campo ha un nome; il valore del paragrafo, o vuoto
    // dove segue lo stile.
    const spacing = strip.element.querySelector<HTMLButtonElement>(`[aria-label="${t("rich.spacing")}"]`)!;
    spacing.click();
    // L'interlinea esatta, poi i rientri in centimetri e gli spazi in punti.
    const fields = [...document.querySelectorAll<HTMLInputElement>('input[inputmode="decimal"]')];
    expect(fields).toHaveLength(6);
    for (const input of fields) expect(document.querySelector(`label[for="${input.id}"]`)?.textContent).not.toBe("");
    expect(fields.map((input) => input.value)).toEqual(["", "", "", "", "", "8"]);
    expect(fields[0]!.disabled).toBe(true);
    const set = (input: HTMLInputElement, value: string) => {
      input.value = value;
      input.dispatchEvent(new Event("change"));
    };
    set(fields[4]!, "12");
    expect(paras(e)[0]!.p).toEqual({ before: 12, after: 8 });
    set(fields[1]!, "1,27");
    expect(paras(e)[0]!.p).toEqual({ left: 36, before: 12, after: 8 });
    // L'interlinea esatta prende i punti del suo campo.
    const caption = [...document.querySelectorAll("label")].find((label) => label.textContent === t("rich.spacing.line"))!;
    const line = document.getElementById(caption.htmlFor) as HTMLSelectElement;
    line.value = "exactly";
    line.dispatchEvent(new Event("change"));
    expect(fields[0]!.disabled).toBe(false);
    expect(paras(e)[0]!.p?.line).toEqual({ exactly: 12 });
    set(fields[0]!, "14,5");
    expect(paras(e)[0]!.p?.line).toEqual({ exactly: 14.5 });
    strip.destroy();
  });

  it("un paragrafo incollato da un altro documento perde il k e tiene allineamento e disposizione", () => {
    const e = engine([para("uno")]);
    const { para: p } = richSchema.nodes;
    const pasted = p.create({ role: { kind: "body" }, k: "ESTRANEO", align: "center", p: { left: 36 } }, [richSchema.text("incollato")]);
    e.select(e.state.doc.content.size - 1);
    e.paste(new Slice(Fragment.from([p.create(), pasted]), 1, 0));
    const last = paras(e)[paras(e).length - 1]!;
    expect(last).toMatchObject({ align: "center", p: { left: 36 } });
    expect(last.k).toBeUndefined();
  });
});
