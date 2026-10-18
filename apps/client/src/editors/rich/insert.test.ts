// @vitest-environment happy-dom
//
// Ciò che si inserisce nella superficie ricca: link, tabelle e salti di
// pagina e di colonna.
import { afterEach, describe, expect, it } from "vitest";
import { Fragment, Slice } from "prosemirror-model";
import { t } from "../../i18n/strings";
import { insertTable, linkAt, setLink } from "./commands";
import { RichEngine } from "./engine";
import { parseProjection, type Block, type Para, type Table, type TextInline } from "./projection";
import { mountStrip } from "./strip";

let engines: RichEngine[] = [];
afterEach(() => {
  for (const engine of engines) engine.destroy();
  engines = [];
  document.body.replaceChildren();
});

function engine(blocks: readonly Block[]): RichEngine {
  const parent = document.createElement("div");
  document.body.append(parent);
  const made = new RichEngine(parent, { label: () => "documento", onChange: () => {}, onSelectionChange: () => {} });
  made.setDoc(JSON.stringify({ format: "fub-rich", version: 1, blocks }));
  engines.push(made);
  return made;
}

const para = (c: unknown[]): Block => ({ t: "para", role: { kind: "body" }, c }) as Block;

function at(e: RichEngine, needle: string): number {
  let found = -1;
  e.state.doc.descendants((node, pos) => {
    if (found < 0 && node.isText && node.text!.includes(needle)) found = pos + node.text!.indexOf(needle);
    return found < 0;
  });
  if (found < 0) throw new Error(`${needle} non c'è`);
  return found;
}

function texts(e: RichEngine): TextInline[] {
  const first = parseProjection(e.getDoc()).blocks[0] as Para;
  return (first.c ?? []).filter((inline): inline is TextInline => inline.t === "text");
}

describe("i link", () => {
  it("si mettono su una selezione, si cambiano dal cursore e si tolgono", () => {
    const e = engine([para([{ t: "text", x: "vai al sito adesso" }])]);
    const from = at(e, "sito");
    e.select(from, from + "sito".length);
    expect(e.apply(setLink("https://fub.app"))).toBe(true);
    expect(texts(e)).toEqual([
      { t: "text", x: "vai al " },
      { t: "text", x: "sito", href: "https://fub.app" },
      { t: "text", x: " adesso" },
    ]);
    // Il cursore dentro il link lo trova tutto, e lo cambia tutto.
    e.select(from + 2);
    expect(e.read(linkAt)).toEqual({ href: "https://fub.app", from, to: from + 4 });
    expect(e.actionState("rich.link").active).toBe(true);
    expect(e.apply(setLink("https://fub.app/doc"))).toBe(true);
    expect(texts(e)[1]).toEqual({ t: "text", x: "sito", href: "https://fub.app/doc" });
    expect(e.run("rich.link.remove")).toBe(true);
    expect(texts(e)).toEqual([{ t: "text", x: "vai al sito adesso" }]);
  });

  it("senza selezione scrivono il testo come link; un indirizzo che non è web no", () => {
    const e = engine([para([{ t: "text", x: "fine" }])]);
    e.select(at(e, "fine") + 4);
    expect(e.apply(setLink("javascript:alert(1)", "male"))).toBe(false);
    expect(e.apply(setLink("mailto:a@b.it", " scrivimi"))).toBe(true);
    expect(texts(e)).toEqual([
      { t: "text", x: "fine" },
      { t: "text", x: " scrivimi", href: "mailto:a@b.it" },
    ]);
  });

  it("Mod-k chiede l'indirizzo alla striscia, che lo scrive", () => {
    const e = engine([para([{ t: "text", x: "una parola" }])]);
    const strip = mountStrip(e, () => null);
    document.body.append(strip.element);
    const from = at(e, "parola");
    e.select(from, from + "parola".length);
    expect(e.run("rich.link")).toBe(true);
    const address = document.querySelector<HTMLInputElement>(`#${CSS.escape(document.querySelector<HTMLLabelElement>("form label")!.htmlFor)}`)!;
    expect(document.querySelector("form label")?.textContent).toBe(t("rich.link.address"));
    // Un indirizzo sbagliato resta nel modulo e lo dice.
    address.value = "ftp://altrove";
    address.form!.requestSubmit();
    expect(document.querySelector<HTMLElement>("form [role=alert]")!.hidden).toBe(false);
    address.value = "https://fub.app";
    address.form!.requestSubmit();
    expect(texts(e)[1]).toEqual({ t: "text", x: "parola", href: "https://fub.app" });
    expect(document.querySelector("form")).toBeNull();
    strip.destroy();
    // Senza la striscia nessuno chiede: l'accordo non fa niente.
    expect(e.run("rich.link")).toBe(false);
  });
});

describe("i salti", () => {
  it("di pagina e di colonna sono foglie nel testo del paragrafo", () => {
    const e = engine([para([{ t: "text", x: "primadopo" }])]);
    e.select(at(e, "dopo"));
    expect(e.run("rich.break.page")).toBe(true);
    expect(e.run("rich.break.column")).toBe(true);
    expect(texts(e)).toEqual([{ t: "text", x: "prima\u000c\u000edopo" }]);
  });
});

describe("le tabelle nuove", () => {
  const shape = (e: RichEngine) => parseProjection(e.getDoc()).blocks.map((b) => (b.t === "table" ? `${b.rows.length}x${b.rows[0]!.cells.length}` : "p"));

  it("vanno dopo il paragrafo del cursore, senza k, e un paragrafo le segue", () => {
    const e = engine([para([{ t: "text", x: "sopra" }])]);
    e.select(at(e, "sopra") + 2);
    expect(e.apply(insertTable(2, 3))).toBe(true);
    expect(shape(e)).toEqual(["p", "2x3", "p"]);
    const table = parseProjection(e.getDoc()).blocks[1] as Table;
    expect(table.k).toBeUndefined();
    expect(table.rows.every((row) => row.k === undefined && row.cells.every((cell) => cell.k === undefined))).toBe(true);
    // Il cursore è nella prima cella: si scrive lì, e una riga nuova resta senza k.
    expect(e.run("markdown.table.row.after")).toBe(true);
    const grown = parseProjection(e.getDoc()).blocks[1] as Table;
    expect(grown.rows).toHaveLength(3);
    expect(grown.rows[1]!.k).toBeUndefined();
    // Dentro una tabella non se ne crea un'altra.
    expect(e.apply(insertTable(1, 1))).toBe(false);
    // Copiata e incollata resta una tabella, anche senza k.
    e.select(e.state.doc.content.size - 1);
    e.paste(new Slice(Fragment.from(e.state.doc.child(1)), 0, 0));
    expect(shape(e).filter((b) => b !== "p")).toEqual(["3x3", "3x3"]);
  });

  it("prendono il posto prima di un paragrafo vuoto, e il limite delle colonne vale", () => {
    const e = engine([para([{ t: "text", x: "uno" }]), para([])]);
    e.select(e.state.doc.content.size - 1);
    expect(e.apply(insertTable(1, 64))).toBe(false);
    expect(e.apply(insertTable(1, 2))).toBe(true);
    expect(shape(e)).toEqual(["p", "1x2", "p"]);
  });

  it("la striscia le dimensiona con la griglia, col mouse e con le frecce", () => {
    const e = engine([para([{ t: "text", x: "testo" }])]);
    e.select(at(e, "testo"));
    const strip = mountStrip(e, () => null);
    document.body.append(strip.element);
    const open = () => strip.element.querySelector<HTMLButtonElement>(`[aria-label="${t("rich.table")}"]`)!.click();
    open();
    const cell = (rows: number, cols: number) =>
      document.querySelector<HTMLButtonElement>(`[aria-label="${t("rich.table.cells", { rows: String(rows), cols: String(cols) })}"]`)!;
    cell(2, 3).dispatchEvent(new Event("pointerover", { bubbles: true }));
    expect(cell(1, 2).style.backgroundColor).not.toBe("");
    expect(cell(3, 1).style.backgroundColor).toBe("");
    cell(2, 3).click();
    expect(shape(e)).toEqual(["p", "2x3", "p"]);
    // Con le frecce: una a destra e una in giù.
    e.select(at(e, "testo"));
    open();
    cell(1, 1).focus();
    cell(1, 1).dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    (document.activeElement as HTMLElement).dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    expect(document.activeElement).toBe(cell(2, 2));
    cell(2, 2).click();
    expect(shape(e)).toEqual(["p", "2x2", "p", "2x3", "p"]);
    strip.destroy();
  });
});

describe("le colonne", () => {
  const cell = (x: string, k = `K${x}`) => ({ k, blocks: [para([{ t: "text", x }])] });
  const grid = (e: RichEngine) =>
    (parseProjection(e.getDoc()).blocks.find((b) => b.t === "table") as Table).rows.map((row) =>
      row.cells.map((c) => {
        const first = c.blocks[0] as Para;
        return `${(first.c?.[0] as TextInline | undefined)?.x ?? ""}${c.k ? `:${c.k}` : ""}`;
      }),
    );
  const table = (rows: ReturnType<typeof cell>[][]): Block => ({ t: "table", k: "T", rows: rows.map((cells, i) => ({ k: `R${i}`, cells })) });

  it("si aggiungono copiando la cella accanto, si spostano e si tolgono", () => {
    const e = engine([table([[cell("a"), cell("b")], [cell("c"), cell("d")]])]);
    e.select(at(e, "a") + 1);
    expect(e.run("markdown.table.column.after")).toBe(true);
    expect(grid(e)).toEqual([["a:Ka", ":Ka", "b:Kb"], ["c:Kc", ":Kc", "d:Kd"]]);
    // Il cursore è nella colonna nuova: si scrive lì.
    expect(e.apply((state, dispatch) => (dispatch?.(state.tr.insertText("n")), true))).toBe(true);
    expect(grid(e)[0]).toEqual(["a:Ka", "n:Ka", "b:Kb"]);
    expect(e.run("markdown.table.column.before")).toBe(true);
    expect(grid(e)[1]).toEqual(["c:Kc", ":Kc", ":Kc", "d:Kd"]);
    expect(e.run("markdown.table.column.delete")).toBe(true);
    expect(grid(e)[0]).toEqual(["a:Ka", "n:Ka", "b:Kb"]);
    // Sposta la colonna di «b» a sinistra, e il cursore la segue.
    e.select(at(e, "b") + 1);
    expect(e.run("markdown.table.column.left")).toBe(true);
    expect(grid(e)).toEqual([["a:Ka", "b:Kb", "n:Ka"], ["c:Kc", "d:Kd", ":Kc"]]);
    expect(e.state.selection.$from.parent.textContent).toBe("b");
    expect(e.run("markdown.table.column.right")).toBe(true);
    expect(e.run("markdown.table.column.right")).toBe(false);
    expect(e.state.selection.$from.parent.textContent).toBe("b");
  });

  it("non si toccano con righe di celle diverse, e l'ultima resta", () => {
    const e = engine([table([[cell("a"), cell("b")], [cell("unite")]])]);
    e.select(at(e, "a"));
    for (const id of ["markdown.table.column.before", "markdown.table.column.after", "markdown.table.column.delete"]) {
      expect(e.actionState(id).enabled).toBe(false);
    }
    const single = engine([table([[cell("x")]])]);
    single.select(at(single, "x"));
    expect(single.run("markdown.table.column.delete")).toBe(false);
    expect(single.run("markdown.table.column.after")).toBe(true);
  });

  it("«Inserisci tabella» della barra fa una tabella 2 × 2", () => {
    const e = engine([para([{ t: "text", x: "testo" }])]);
    e.select(at(e, "testo"));
    expect(e.run("markdown.table")).toBe(true);
    expect(grid(e)).toEqual([["", ""], ["", ""]]);
  });
});
