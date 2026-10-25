// @vitest-environment happy-dom
//
// La revisione nella superficie ricca: trova e sostituisci, il conteggio
// delle parole e le revisioni tracciate.
import { afterEach, describe, expect, it } from "vitest";
import { t } from "../../i18n/strings";
import { backspace, deleteForward, splitParagraph } from "./commands";
import { RichEngine } from "./engine";
import { parseProjection, type Block, type Para, type TextInline } from "./projection";
import type { EditorView } from "prosemirror-view";
import { countText, findKey, findMatches, replaceAll, replaceMatch, revisionPlugin, revisions } from "./review";
import { mountRichRibbon } from "./ribbon";

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
const plain = { text: "", matchCase: false, wholeWord: false };

function texts(e: RichEngine, index = 0): TextInline[] {
  const block = parseProjection(e.getDoc()).blocks[index] as Para;
  return (block.c ?? []).filter((inline): inline is TextInline => inline.t === "text");
}

const slices = (e: RichEngine, query: typeof plain) =>
  findMatches(e.state.doc, query).map((m) => e.state.doc.textBetween(m.from, m.to));

describe("trova", () => {
  it("trova in ogni paragrafo, anche nelle tabelle, senza badare alle maiuscole", () => {
    const e = engine([
      para([{ t: "text", x: "Gatto e gatto" }]),
      { t: "table", rows: [{ cells: [{ blocks: [para([{ t: "text", x: "il GATTO" }])] }] }] } as Block,
    ]);
    expect(slices(e, { ...plain, text: "gatto" })).toEqual(["Gatto", "gatto", "GATTO"]);
    expect(slices(e, { ...plain, text: "gatto", matchCase: true })).toEqual(["gatto"]);
  });

  it("le parole intere non prendono un pezzo di parola", () => {
    const e = engine([para([{ t: "text", x: "re, regina e re_x, perché re" }])]);
    expect(slices(e, { ...plain, text: "re", wholeWord: true })).toEqual(["re", "re"]);
  });

  it("attraversa i tratti di aspetto diverso ma non un oggetto o un segno", () => {
    const e = engine([
      para([
        { t: "text", x: "pa", m: ["b"] },
        { t: "text", x: "rola " },
        { t: "text", x: "pa" },
        { t: "atom", k: "c", kind: "marker" },
        { t: "text", x: "rola" },
      ]),
    ]);
    expect(slices(e, { ...plain, text: "parola" })).toEqual(["parola"]);
  });
});

describe("sostituisci", () => {
  it("una occorrenza prende l'aspetto del primo carattere e si annulla", () => {
    const e = engine([para([{ t: "text", x: "il " }, { t: "text", x: "gatto", m: ["b"], k: "K" }, { t: "text", x: " dorme" }])]);
    const query = { ...plain, text: "gatto" };
    const [match] = findMatches(e.state.doc, query);
    expect(e.apply(replaceMatch(query, match!, "cane"))).toBe(true);
    expect(texts(e)).toEqual([
      { t: "text", x: "il " },
      { t: "text", x: "cane", m: ["b"], k: "K" },
      { t: "text", x: " dorme" },
    ]);
    // Un'occorrenza che non c'è più non si sostituisce.
    expect(e.apply(replaceMatch(query, match!, "topo"))).toBe(false);
    expect(e.run("text.undo")).toBe(true);
    expect(texts(e)[1]).toEqual({ t: "text", x: "gatto", m: ["b"], k: "K" });
  });

  it("tutte in una battuta, anche con niente", () => {
    const e = engine([para([{ t: "text", x: "a-b-c" }]), para([{ t: "text", x: "d-e" }])]);
    expect(e.apply(replaceAll({ ...plain, text: "-" }, ""))).toBe(true);
    expect(texts(e, 0)).toEqual([{ t: "text", x: "abc" }]);
    expect(texts(e, 1)).toEqual([{ t: "text", x: "de" }]);
    expect(e.run("text.undo")).toBe(true);
    expect(texts(e, 0)).toEqual([{ t: "text", x: "a-b-c" }]);
    expect(e.apply(replaceAll({ ...plain, text: "zz" }, "y"))).toBe(false);
  });
});

describe("la barra", () => {
  it("Mod-h apre trova e sostituisci: le occorrenze si vedono, si scorrono e si sostituiscono", () => {
    const e = engine([para([{ t: "text", x: "uno due uno tre uno" }])]);
    const ribbon = mountRichRibbon(e, () => null);
    document.body.append(ribbon.element, ribbon.findBar);
    expect(e.run("rich.find")).toBe(true);
    expect(ribbon.findBar.hidden).toBe(false);
    const field = (label: string) =>
      document.getElementById([...document.querySelectorAll("form label")].find((l) => l.textContent === label)!.getAttribute("for")!) as HTMLInputElement;
    const text = field(t("rich.find.text"));
    text.value = "uno";
    text.dispatchEvent(new Event("input"));
    const status = document.querySelector("form [role=status]")!;
    expect(status.textContent).toBe(t("rich.find.count", { current: "1", total: "3" }));
    expect(findKey.getState(e.state)?.decorations.find().length).toBe(3);
    text.form!.requestSubmit();
    expect(status.textContent).toBe(t("rich.find.count", { current: "2", total: "3" }));
    field(t("rich.find.replace")).value = "1";
    const press = (label: string) => [...document.querySelectorAll<HTMLButtonElement>("form button")].find((b) => b.textContent === label)!.click();
    press(t("rich.find.replace_one"));
    expect(texts(e)).toEqual([{ t: "text", x: "uno due 1 tre uno" }]);
    expect(status.textContent).toBe(t("rich.find.count", { current: "2", total: "2" }));
    press(t("rich.find.replace_all"));
    expect(texts(e)).toEqual([{ t: "text", x: "1 due 1 tre 1" }]);
    expect(status.textContent).toBe(t("rich.find.replaced", { n: "2" }));
    // Chiusa la ricerca con Esc, il testo non ha più segni.
    text.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(ribbon.findBar.hidden).toBe(true);
    expect(findKey.getState(e.state)?.decorations.find().length).toBe(0);
    ribbon.destroy();
    expect(findKey.getState(e.state)?.decorations.find().length).toBe(0);
  });

  it("il conteggio dice parole, caratteri e paragrafi del documento e della selezione", () => {
    const e = engine([para([{ t: "text", x: "Una  frase\tbreve." }]), para([]), para([{ t: "text", x: "Due" }])]);
    const ribbon = mountRichRibbon(e, () => null);
    document.body.append(ribbon.element);
    e.select(1, 4);
    [...ribbon.element.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.getAttribute("aria-label") === t("rich.count"))!.click();
    const rows = [...document.querySelectorAll("table tr")].map((row) => [...row.children].map((c) => c.textContent));
    expect(rows).toEqual([
      ["", t("rich.count.selection"), t("rich.count.document")],
      [t("rich.count.words"), "1", "4"],
      [t("rich.count.characters"), "3", "20"],
      [t("rich.count.visible"), "3", "17"],
      [t("rich.count.paragraphs"), "1", "2"],
    ]);
    ribbon.destroy();
  });
});

describe("il conteggio", () => {
  it("un oggetto separa le parole senza contare, un segno non separa", () => {
    const e = engine([
      para([
        { t: "text", x: "pa" },
        { t: "atom", k: "c", kind: "marker" },
        { t: "text", x: "rola" },
        { t: "atom", k: "i", kind: "image" },
        { t: "text", x: "altra" },
      ]),
    ]);
    expect(countText(e.state.doc)).toEqual({ words: 2, characters: 11, visible: 11, paragraphs: 1 });
  });
});

describe("le revisioni tracciate", () => {
  const ada = { by: "Ada", at: "2026-10-18T10:00:00Z" };
  const bea = { by: "Bea", at: "2026-10-18T11:00:00Z" };
  const tracked = () => [
    para([
      { t: "text", x: "fisso " },
      { t: "text", x: "aggiunto", ins: ada },
      { t: "text", x: " " },
      { t: "text", x: "tolto", del: bea },
    ]),
  ];
  const source = (blocks: readonly Block[]) => JSON.stringify({ format: "fub-rich", version: 1, blocks });
  const caretIn = (e: RichEngine, word: string) => {
    const at = findMatches(e.state.doc, { ...plain, text: word })[0]!;
    e.select(at.from + 1);
  };

  it("si leggono e si riscrivono identiche, con il segno di fine", () => {
    const blocks = [
      { t: "para", role: { kind: "body" }, ins: ada, c: [{ t: "text", x: "nuovo", ins: ada }, { t: "atom", k: "i", kind: "image", ins: ada, del: bea }] },
      para([{ t: "text", x: "dopo", del: { ...bea, mv: "m1" } }]),
    ] as Block[];
    const e = engine(blocks);
    expect(e.getDoc()).toBe(
      '{"format":"fub-rich","version":1,"blocks":[' +
        '{"t":"para","role":{"kind":"body"},"ins":{"by":"Ada","at":"2026-10-18T10:00:00Z"},"c":[' +
        '{"t":"text","x":"nuovo","ins":{"by":"Ada","at":"2026-10-18T10:00:00Z"}},' +
        '{"t":"atom","k":"i","kind":"image","ins":{"by":"Ada","at":"2026-10-18T10:00:00Z"},"del":{"by":"Bea","at":"2026-10-18T11:00:00Z"}}]},' +
        '{"t":"para","role":{"kind":"body"},"c":[{"t":"text","x":"dopo","del":{"by":"Bea","at":"2026-10-18T11:00:00Z","mv":"m1"}}]}]}',
    );
    // Inserito sottolineato, eliminato barrato, e il segno di fine si vede.
    const root = document.body;
    expect(root.querySelector("ins.rich-ins")?.getAttribute("title")).toContain("Ada");
    expect([...root.querySelectorAll("del.rich-del")].map((el) => el.textContent)).toEqual([`▣${t("rich.atom.image")}`, "dopo"]);
    expect(root.querySelector(".rich-ins-mark")?.textContent).toBe("¶");
    // Il testo, l'oggetto e il segno di fine nuovi fanno una modifica sola;
    // l'eliminazione dello spostamento è un'altra revisione.
    expect(revisions(e.state.doc).map((c) => [c.kind, c.rev.by, c.pieces.length])).toEqual([
      ["ins", "Ada", 3],
      ["del", "Bea", 1],
      ["del", "Bea", 1],
    ]);
  });

  it("accettare e rifiutare tengono o tolgono il testo, e vanno alla seguente", () => {
    const e = engine(tracked());
    caretIn(e, "aggiunto");
    expect(e.run("rich.rev.accept")).toBe(true);
    expect(texts(e)).toEqual([
      { t: "text", x: "fisso aggiunto " },
      { t: "text", x: "tolto", del: bea },
    ]);
    // La selezione è sulla seguente: rifiutare l'eliminazione la tiene.
    expect(e.state.doc.textBetween(e.state.selection.from, e.state.selection.to)).toBe("tolto");
    expect(e.run("rich.rev.reject")).toBe(true);
    expect(texts(e)).toEqual([{ t: "text", x: "fisso aggiunto tolto" }]);
    expect(e.run("rich.rev.accept")).toBe(false);
    expect(e.run("text.undo")).toBe(true);
    expect(e.run("text.undo")).toBe(true);
    expect(e.getDoc()).toBe(source(tracked()));

    // Il contrario toglie il testo, tutto in una battuta.
    expect(e.run("rich.rev.reject_all")).toBe(true);
    expect(texts(e)).toEqual([{ t: "text", x: "fisso  tolto" }]);
    expect(e.run("text.undo")).toBe(true);
    expect(e.run("rich.rev.accept_all")).toBe(true);
    expect(texts(e)).toEqual([{ t: "text", x: "fisso aggiunto " }]);
  });

  it("rifiutare un segno di fine inserito unisce il paragrafo al seguente, che dà le sue proprietà", () => {
    const e = engine([
      { t: "para", role: { kind: "body" }, k: "A", ins: ada, c: [{ t: "text", x: "uno" }] },
      { t: "para", role: { kind: "heading", level: 2 }, k: "B", c: [{ t: "text", x: "due" }] },
    ] as Block[]);
    // Il segno sta in fondo al paragrafo.
    e.select(2);
    expect(e.run("rich.rev.reject")).toBe(false);
    e.select(4);
    expect(e.run("rich.rev.reject")).toBe(true);
    expect(parseProjection(e.getDoc()).blocks).toEqual([
      { t: "para", role: { kind: "heading", level: 2 }, k: "B", c: [{ t: "text", x: "unodue" }] },
    ]);
    expect(e.run("text.undo")).toBe(true);
    e.select(4);
    expect(e.run("rich.rev.accept")).toBe(true);
    expect((parseProjection(e.getDoc()).blocks[0] as Para).ins).toBeUndefined();
  });

  it("i due capi di uno spostamento vanno insieme", () => {
    const mv = { ...ada, mv: "m" };
    const e = engine([
      para([{ t: "text", x: "via", del: mv }, { t: "text", x: " resta" }]),
      para([{ t: "text", x: "qui " }, { t: "text", x: "via", ins: mv }]),
    ]);
    e.select(2);
    expect(e.run("rich.rev.accept")).toBe(true);
    expect(texts(e, 0)).toEqual([{ t: "text", x: " resta" }]);
    expect(texts(e, 1)).toEqual([{ t: "text", x: "qui via" }]);
  });

  it("si scorrono in ordine, girando in fondo", () => {
    const e = engine(tracked());
    const selected = () => e.state.doc.textBetween(e.state.selection.from, e.state.selection.to);
    e.select(1);
    expect(e.run("rich.rev.next")).toBe(true);
    expect(selected()).toBe("aggiunto");
    expect(e.run("rich.rev.next")).toBe(true);
    expect(selected()).toBe("tolto");
    expect(e.run("rich.rev.next")).toBe(true);
    expect(selected()).toBe("aggiunto");
    expect(e.run("rich.rev.previous")).toBe(true);
    expect(selected()).toBe("tolto");
  });

  it("ciò che si scrive dentro una revisione o dopo non la prende", () => {
    const e = engine(tracked());
    const write = (text: string) => {
      const { from, to } = e.state.selection;
      const view = { state: e.state, dispatch: (tr: Parameters<RichEngine["dispatch"]>[0]) => e.dispatch(tr) } as unknown as EditorView;
      const handled = revisionPlugin.props.handleTextInput!.call(revisionPlugin, view, from, to, text, () => e.state.tr.insertText(text, from, to));
      if (!handled) e.dispatch(e.state.tr.insertText(text, from, to));
    };
    caretIn(e, "aggiunto");
    write("X");
    expect(texts(e).slice(0, 4)).toEqual([
      { t: "text", x: "fisso " },
      { t: "text", x: "a", ins: ada },
      { t: "text", x: "X" },
      { t: "text", x: "ggiunto", ins: ada },
    ]);
    // In coda a un tratto inserito, la marca non si allarga.
    const end = findMatches(e.state.doc, { ...plain, text: "ggiunto" })[0]!.to;
    e.select(end);
    write("Y");
    expect(texts(e)[4]).toEqual({ t: "text", x: "Y " });
  });

  it("il segno di fine revisionato resta quello che chiude il testo", () => {
    const marked = (e: RichEngine) => parseProjection(e.getDoc()).blocks.map((b) => (b as Para).ins?.by ?? null);
    const e = engine([
      { t: "para", role: { kind: "body" }, ins: ada, c: [{ t: "text", x: "unodue" }] },
      para([{ t: "text", x: "tre" }]),
    ] as Block[]);
    // A capo: il primo pezzo ha un segno nuovo, di chi scrive.
    e.select(4);
    expect(e.apply(splitParagraph)).toBe(true);
    expect(marked(e)).toEqual([null, "Ada", null]);
    // Unire due paragrafi lascia il segno del secondo.
    e.select(11);
    expect(e.apply(backspace)).toBe(true);
    expect(marked(e)).toEqual([null, null]);
    expect(texts(e, 1)).toEqual([{ t: "text", x: "duetre" }]);
    expect(e.run("text.undo")).toBe(true);
    e.select(4);
    expect(e.apply(deleteForward)).toBe(true);
    expect(marked(e)).toEqual(["Ada", null]);
  });
});
