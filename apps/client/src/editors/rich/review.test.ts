// @vitest-environment happy-dom
//
// La revisione nella superficie ricca: trova e sostituisci, e il conteggio
// delle parole.
import { afterEach, describe, expect, it } from "vitest";
import { t } from "../../i18n/strings";
import { RichEngine } from "./engine";
import { parseProjection, type Block, type Para, type TextInline } from "./projection";
import { countText, findKey, findMatches, replaceAll, replaceMatch } from "./review";
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

describe("la striscia", () => {
  it("Mod-h apre trova e sostituisci: le occorrenze si vedono, si scorrono e si sostituiscono", () => {
    const e = engine([para([{ t: "text", x: "uno due uno tre uno" }])]);
    const strip = mountStrip(e, () => null);
    document.body.append(strip.element);
    expect(e.run("rich.find")).toBe(true);
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
    // Chiusa la ricerca, il testo non ha più segni.
    strip.destroy();
    expect(findKey.getState(e.state)?.decorations.find().length).toBe(0);
  });

  it("il conteggio dice parole, caratteri e paragrafi del documento e della selezione", () => {
    const e = engine([para([{ t: "text", x: "Una  frase\tbreve." }]), para([]), para([{ t: "text", x: "Due" }])]);
    const strip = mountStrip(e, () => null);
    document.body.append(strip.element);
    e.select(1, 4);
    [...strip.element.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.getAttribute("aria-label") === t("rich.count"))!.click();
    const rows = [...document.querySelectorAll("table tr")].map((row) => [...row.children].map((c) => c.textContent));
    expect(rows).toEqual([
      ["", t("rich.count.selection"), t("rich.count.document")],
      [t("rich.count.words"), "1", "4"],
      [t("rich.count.characters"), "3", "20"],
      [t("rich.count.visible"), "3", "17"],
      [t("rich.count.paragraphs"), "1", "2"],
    ]);
    strip.destroy();
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
