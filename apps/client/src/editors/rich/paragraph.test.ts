// @vitest-environment happy-dom
//
// Il paragrafo nella superficie ricca: allineamento, disposizione e stile che
// la proiezione porta in `align`, `p` e `s`, e i gesti che li cambiano.
import { afterEach, describe, expect, it } from "vitest";
import { Fragment, Slice } from "prosemirror-model";
import { selectedLayout, selectedStyle, setLayout, setStyle, splitParagraph } from "./commands";
import { RichEngine } from "./engine";
import { parseProjection, type Block, type Para } from "./projection";
import { t } from "../../i18n/strings";
import { richSchema } from "./schema";
import { mountRichRibbon } from "./ribbon";

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
    // Lo spazio e l'interlinea del file sono dati, come il carattere.
    expect(one!.style.getPropertyValue("--file-line")).toBe("calc(1.2 * 1.5)");
    expect(one!.style.lineHeight).toBe("");
    expect(two!.style.getPropertyValue("--file-font")).toContain("Aptos");
    expect(two!.style.getPropertyValue("--file-size")).toBe("14pt");
    expect(two!.style.fontFamily).toBe("");
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

  it("cambiando ruolo o stile il paragrafo prende subito l'aspetto che lo stile gli darà", () => {
    const parent = document.createElement("div");
    document.body.append(parent);
    const e = new RichEngine(parent, { label: () => "documento", onChange: () => {}, onSelectionChange: () => {} });
    engines.push(e);
    const H1 = { font: "Aptos Display", size: 20 };
    const H2 = { font: "Aptos Display", size: 16 };
    const QUOTE = { font: "Aptos", size: 11 };
    const TITLE = { font: "Aptos Display", size: 28 };
    e.setDoc(
      JSON.stringify({
        format: "fub-rich",
        version: 3,
        opaque_schema: 3,
        f: LOOK,
        styles: [...STYLES, { id: "Title", name: "Title", f: TITLE }],
        roles: { h: [H1, H2], quote: QUOTE },
        blocks: [para("uno"), para("due")],
      }),
    );
    selectParas(e, 0);
    const look = () => paras(e)[0]!.f;
    // Dalla galleria: Titolo, poi Titolo 1, Titolo 2, Sottotitolo, di nuovo
    // Titolo 1 e il testo normale; ognuno ha il suo carattere e la sua misura.
    expect(e.apply(setStyle({ s: "Title", f: TITLE }, e.documentLook()))).toBe(true);
    expect(look()).toEqual(TITLE);
    expect(e.apply(setStyle({ role: { kind: "heading", level: 1 } }, e.documentLook()))).toBe(true);
    expect(look()).toEqual(H1);
    expect(e.apply(setStyle({ role: { kind: "heading", level: 2 } }, e.documentLook()))).toBe(true);
    expect(look()).toEqual(H2);
    expect(e.apply(setStyle({ s: "Subtitle", f: STYLES[0]!.f }, e.documentLook()))).toBe(true);
    expect(look()).toEqual(STYLES[0]!.f);
    expect(e.apply(setStyle({ role: { kind: "heading", level: 1 } }, e.documentLook()))).toBe(true);
    expect(look()).toEqual(H1);
    // Un livello che il codec non sa dire torna al testo, non tiene il Titolo 1.
    expect(e.apply(setStyle({ role: { kind: "heading", level: 3 } }, e.documentLook()))).toBe(true);
    expect(look()).toEqual(LOOK);
    expect(e.apply(setStyle({ role: { kind: "quote" } }, e.documentLook()))).toBe(true);
    expect(look()).toEqual(QUOTE);
    // Dalla tastiera, come i comandi del Markdown: andata e ritorno.
    expect(e.run("markdown.heading.2")).toBe(true);
    expect(look()).toEqual(H2);
    expect(e.run("markdown.heading.2")).toBe(true);
    expect(paras(e)[0]!.role).toEqual({ kind: "body" });
    expect(look()).toEqual(LOOK);
    // Invio in fondo a un titolo: il paragrafo nuovo è testo, con la misura del testo.
    expect(e.run("markdown.heading.1")).toBe(true);
    e.select(e.state.doc.firstChild!.nodeSize - 1);
    expect(e.apply(splitParagraph)).toBe(true);
    expect(paras(e).slice(0, 2).map((p) => [p.role.kind, p.f])).toEqual([
      ["heading", H1],
      ["body", LOOK],
    ]);
  });

  it("l'allineamento che veniva dallo stile segue lo stile nuovo, quello scritto a mano resta", () => {
    const parent = document.createElement("div");
    document.body.append(parent);
    const e = new RichEngine(parent, { label: () => "documento", onChange: () => {}, onSelectionChange: () => {} });
    engines.push(e);
    e.setDoc(
      JSON.stringify({
        format: "fub-rich",
        version: 3,
        opaque_schema: 3,
        f: LOOK,
        styles: [...STYLES, { id: "Title", name: "Title", align: "center" }],
        roles: { quote: LOOK, align: { h: [null, "center"], quote: "center" } },
        blocks: [para("uno"), para("due", { align: "right" })],
      }),
    );
    const aligned = (index: number) => paras(e)[index]!.align;
    selectParas(e, 0);
    const steps: [Parameters<typeof setStyle>[0], string | undefined][] = [
      [{ role: { kind: "quote" } }, "center"],
      [{ role: { kind: "heading", level: 1 } }, undefined],
      [{ role: { kind: "heading", level: 2 } }, "center"],
      [{ s: "Subtitle", f: STYLES[0]!.f }, undefined],
      [{ s: "Title" }, "center"],
      [{ role: { kind: "body" } }, undefined],
    ];
    for (const [pick, want] of steps) {
      expect(e.apply(setStyle(pick, e.documentLook()))).toBe(true);
      expect([pick, aligned(0)]).toEqual([pick, want]);
    }
    // A destra a mano: resta, anche da titolo.
    selectParas(e, 1);
    expect(e.run("markdown.heading.2")).toBe(true);
    expect(aligned(1)).toBe("right");
    // Invio in fondo a un titolo centrato dal suo stile: il testo nuovo è a
    // sinistra, come il corpo.
    selectParas(e, 0);
    expect(e.run("markdown.heading.2")).toBe(true);
    expect(aligned(0)).toBe("center");
    e.select(e.state.doc.firstChild!.nodeSize - 1);
    expect(e.apply(splitParagraph)).toBe(true);
    expect([aligned(0), aligned(1)]).toEqual(["center", undefined]);
  });

  it("uno stile toglie, come Word, il carattere e la misura scritti su più di metà del paragrafo", () => {
    const H1 = { font: "Aptos Display", size: 20 };
    const parent = document.createElement("div");
    document.body.append(parent);
    const e = new RichEngine(parent, { label: () => "documento", onChange: () => {}, onSelectionChange: () => {} });
    engines.push(e);
    const big = { size: 22 };
    e.setDoc(
      JSON.stringify({
        format: "fub-rich",
        version: 3,
        opaque_schema: 3,
        f: LOOK,
        styles: STYLES,
        roles: { h: [H1] },
        blocks: [
          // Tutto a 22 pt e in rosso, una parola in Verdana.
          { t: "para", role: { kind: "body" }, f: LOOK, c: [
            { t: "text", x: "Tutto grande ", f: { ...big, color: "#ff0000" } },
            { t: "text", x: "e", f: { ...big, color: "#ff0000", font: "Verdana" } },
          ] },
          { t: "para", role: { kind: "body" }, f: LOOK, c: [{ t: "text", x: "Verdana", f: { font: "Verdana" } }] },
          para("due"),
          { t: "para", role: { kind: "body" }, f: LOOK, c: [{ t: "text", x: "voce", f: big }] },
        ],
      }),
    );
    const runs = (index: number) => (paras(e)[index]!.c as readonly { x?: string; f?: unknown }[]).map((run) => [run.x, run.f]);
    selectParas(e, 0);
    expect(e.apply(setStyle({ role: { kind: "heading", level: 1 } }, e.documentLook()))).toBe(true);
    expect(paras(e)[0]!.f).toEqual(H1);
    // La misura e il colore coprono tutto, e se ne vanno; la Verdana è su una
    // lettera sola, e resta.
    expect(runs(0)).toEqual([["Tutto grande ", undefined], ["e", { font: "Verdana" }]]);
    // Dalla tastiera lo stesso, e con uno stile del documento.
    selectParas(e, 1);
    expect(e.run("markdown.heading.1")).toBe(true);
    expect(runs(1)).toEqual([["Verdana", undefined]]);
    selectParas(e, 0);
    expect(e.apply(setStyle({ s: "Subtitle", f: STYLES[0]!.f }, e.documentLook()))).toBe(true);
    expect(runs(0)).toEqual([["Tutto grande ", undefined], ["e", { font: "Verdana" }]]);
    expect(paras(e)[0]!.f).toEqual(STYLES[0]!.f);
    // L'elenco non è uno stile: il paragrafo che lo diventa tiene la sua misura.
    selectParas(e, 3);
    expect(e.run("markdown.list.bullet")).toBe(true);
    expect(paras(e)[3]!.role.kind).toBe("list");
    expect(runs(3)).toEqual([["voce", big]]);
  });

  it("la barra propone gli stili del documento e la spaziatura del paragrafo", () => {
    const e = engine([para("uno", { p: { after: 8 } })]);
    selectParas(e, 0);
    const ribbon = mountRichRibbon(e, () => null);
    document.body.append(ribbon.element);
    // La galleria: lo stile di adesso è premuto, e ogni stile si scrive col
    // suo nome.
    const cell = (value: string) => ribbon.element.querySelector<HTMLButtonElement>(`.rich-ribbon-style[data-style="${value}"]`)!;
    expect(cell("body").getAttribute("aria-pressed")).toBe("true");
    expect(cell("s:Subtitle").textContent).toBe("Subtitle");
    cell("s:Subtitle").click();
    expect(paras(e)[0]!.s).toBe("Subtitle");
    ribbon.element.querySelector<HTMLButtonElement>('[data-command="rich.align.right"] button')!.click();
    expect(paras(e)[0]!.align).toBe("right");
    expect(ribbon.element.querySelector('[data-command="rich.align.right"] button')?.getAttribute("aria-pressed")).toBe("true");
    // La spaziatura: ogni campo ha un nome; il valore del paragrafo, o vuoto
    // dove segue lo stile.
    const spacing = ribbon.element.querySelector<HTMLButtonElement>(`[aria-label="${t("rich.spacing")}"]`)!;
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
    ribbon.destroy();
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
