// Le fonti di una lavagna (T77): quali file le schede mostrano e che cosa, e
// la barra che l'ispettore ne disegna con ciò che si sa del file.
import { describe, expect, it } from "vitest";
import type { CanvasNode } from "./model";
import { PARTS_KEY } from "./parts";
import { boardSources, cardTarget, SOURCE_BAR_MAX_PIECES, sourceBar, sourceName, sourceNeeds, subpathPage, type BoardSource } from "./sources";

const file = (id: string, path: string, extra: Partial<CanvasNode> = {}): CanvasNode => ({ id, type: "file", x: 0, y: 0, width: 200, height: 200, file: path, ...extra });
const text = (id: string): CanvasNode => ({ id, type: "text", x: 0, y: 0, width: 100, height: 40, text: id });

const only = (nodes: readonly CanvasNode[], path: string): BoardSource => {
  const found = boardSources(nodes).find((source) => source.path === path);
  if (!found) throw new Error(`nessuna fonte ${path}`);
  return found;
};

describe("cardTarget", () => {
  it("il file senza #… e il subpath: dal campo, sennò dal # nel percorso; il campo vince", () => {
    expect(cardTarget(file("a", "Corsi/Lezione 4.pdf"))).toEqual({ path: "Corsi/Lezione 4.pdf", subpath: null });
    expect(cardTarget(file("b", "Nota.md#Titolo"))).toEqual({ path: "Nota.md", subpath: "#Titolo" });
    expect(cardTarget(file("c", "Nota.md", { subpath: "#Varianza" }))).toEqual({ path: "Nota.md", subpath: "#Varianza" });
    expect(cardTarget(file("d", "Nota.md#Titolo", { subpath: "#Varianza" }))).toEqual({ path: "Nota.md", subpath: "#Varianza" });
    // Un subpath vuoto non conta: vale il # del percorso, se c'è.
    expect(cardTarget(file("e", "Nota.md#Titolo", { subpath: "" }))).toEqual({ path: "Nota.md", subpath: "#Titolo" });
  });

  it("una scheda che non è di file, o senza un file di testo, ha il percorso vuoto", () => {
    expect(cardTarget(text("t"))).toEqual({ path: "", subpath: null });
    expect(cardTarget({ id: "w", type: "link", x: 0, y: 0, width: 10, height: 10, url: "https://example.org/#x" })).toEqual({ path: "", subpath: null });
    expect(cardTarget({ id: "f", type: "file", x: 0, y: 0, width: 10, height: 10, file: 3 as unknown as string })).toEqual({ path: "", subpath: null });
  });
});

describe("subpathPage", () => {
  it("legge #page=N come la scheda del PDF, e nient'altro", () => {
    expect(subpathPage("#page=3")).toBe(3);
    expect(subpathPage("#zoom=2&page=12")).toBe(12);
    expect(subpathPage("#page=0")).toBeNull();
    expect(subpathPage("#page=3x")).toBeNull();
    expect(subpathPage("#Varianza")).toBeNull();
    expect(subpathPage(null)).toBeNull();
  });
});

describe("boardSources", () => {
  it("una lavagna senza file non ha fonti", () => {
    expect(boardSources([])).toEqual([]);
    expect(boardSources([text("a"), { id: "g", type: "group", x: 0, y: 0, width: 10, height: 10 }, { id: "w", type: "link", x: 0, y: 0, width: 10, height: 10, url: "https://example.org" }])).toEqual([]);
  });

  it("le pagine di un PDF: #page=N, «Spargi le pagine», fub:parts pages e region, in ordine e senza doppioni", () => {
    const nodes = [
      file("p7", "Corsi/Lezione 4.pdf", { subpath: "#page=7" }),
      // Le schede di «Spargi le pagine»: una per pagina, col subpath.
      file("s3", "Corsi/Lezione 4.pdf", { subpath: "#page=3" }),
      file("s4", "Corsi/Lezione 4.pdf", { subpath: "#page=4" }),
      file("pp", "Corsi/Lezione 4.pdf", { subpath: "#page=5", [PARTS_KEY]: { kind: "pages", pages: [5, 3, 9] } }),
      file("rg", "Corsi/Lezione 4.pdf", { subpath: "#page=12", [PARTS_KEY]: { kind: "region", page: 12, rect: [0, 0, 0.5, 0.5] } }),
    ];
    const source = only(nodes, "Corsi/Lezione 4.pdf");
    expect(source.kind).toBe("pdf");
    expect(source.name).toBe("Lezione 4.pdf");
    expect(source.cards).toEqual([0, 1, 2, 3, 4]);
    // Ogni pagina porta alla prima scheda che la mostra.
    expect(source.pages).toEqual([
      { page: 3, card: 1 },
      { page: 4, card: 2 },
      { page: 5, card: 3 },
      { page: 7, card: 0 },
      { page: 9, card: 3 },
      { page: 12, card: 4 },
    ]);
    expect(source.sections).toEqual([]);
    expect(source.whole).toBeNull();
  });

  it("le sezioni di una nota: #Titolo, #Capitolo#Titolo e fub:parts sections, nell'ordine in cui la lavagna le incontra", () => {
    const nodes = [
      file("a", "Fisica/Relazione.md", { subpath: "#Misure" }),
      file("b", "Fisica/Relazione.md", { subpath: "#Ipotesi", [PARTS_KEY]: { kind: "sections", sections: ["Ipotesi", "Metodo#Strumenti", "Misure"] } }),
      // Un blocco non è una sezione: la scheda conta, il pezzo no.
      file("c", "Fisica/Relazione.md", { subpath: "#^abc123" }),
      // `file` con il # dentro vale come il subpath.
      file("d", "Fisica/Relazione.md#Conclusioni"),
    ];
    const source = only(nodes, "Fisica/Relazione.md");
    expect(source.kind).toBe("note");
    expect(source.cards).toEqual([0, 1, 2, 3]);
    expect(source.sections).toEqual([
      { key: "Misure", card: 0 },
      { key: "Ipotesi", card: 1 },
      { key: "Metodo#Strumenti", card: 1 },
      { key: "Conclusioni", card: 3 },
    ]);
    expect(source.whole).toBeNull();
  });

  it("un fub:parts che si conserva senza mostrarlo conta come il subpath, come la scheda", () => {
    // Il subpath smentisce il campo: la scheda mostra il subpath.
    const nodes = [file("a", "Nota.md", { subpath: "#Media", [PARTS_KEY]: { kind: "sections", sections: ["Varianza"] } })];
    expect(only(nodes, "Nota.md").sections).toEqual([{ key: "Media", card: 0 }]);
  });

  it("il file intero: una scheda senza subpath, un'immagine anche ritagliata, un foglio", () => {
    const nodes = [
      file("n", "Varianza.md"),
      file("n2", "Varianza.md", { subpath: "#Formula" }),
      file("i", "foto.png", { [PARTS_KEY]: { kind: "image", rect: [0.1, 0.1, 0.5, 0.5] } }),
      file("x", "Dati.xlsx"),
    ];
    expect(only(nodes, "Varianza.md").whole).toBe(0);
    expect(only(nodes, "Varianza.md").sections).toEqual([{ key: "Formula", card: 1 }]);
    expect(only(nodes, "foto.png")).toMatchObject({ kind: "image", whole: 2 });
    expect(only(nodes, "Dati.xlsx")).toMatchObject({ kind: "sheet", whole: 3 });
  });

  it("ogni file una volta, in ordine di nome (numeri come numeri), poi di percorso", () => {
    const nodes = [
      file("a", "Z/Varianza.md"),
      text("t"),
      file("b", "Lezione 10.pdf"),
      file("c", "A/Varianza.md"),
      file("d", "lezione 9.pdf"),
      file("e", "Appunti sparsi.md"),
      file("f", "Lezione 10.pdf", { subpath: "#page=2" }),
    ];
    const sources = boardSources(nodes);
    expect(sources.map((source) => source.path)).toEqual(["Appunti sparsi.md", "lezione 9.pdf", "Lezione 10.pdf", "A/Varianza.md", "Z/Varianza.md"]);
    expect(sources.find((source) => source.path === "Lezione 10.pdf")!.cards).toEqual([2, 6]);
    // La posizione è fra le schede lette, testo compreso: dà il byte della scheda.
    expect(sources.find((source) => source.path === "A/Varianza.md")!.cards).toEqual([3]);
  });

  it("una scheda di file senza percorso non è una fonte", () => {
    expect(boardSources([file("a", ""), file("b", "#Titolo"), { id: "c", type: "file", x: 0, y: 0, width: 1, height: 1 } as CanvasNode])).toEqual([]);
  });

  it("il nome è l'ultimo pezzo del percorso", () => {
    expect(sourceName("Corsi/Fisica/Lezione 4.pdf")).toBe("Lezione 4.pdf");
    expect(sourceName("Nota.md")).toBe("Nota.md");
  });
});

describe("sourceBar", () => {
  const pdf = (pages: number[], extra: CanvasNode[] = []): BoardSource =>
    only([...pages.map((page, at) => file(`p${at}`, "Libro.pdf", { subpath: `#page=${page}` })), ...extra], "Libro.pdf");

  it("un PDF di cui si sa quante pagine ha: un pezzo per pagina, le usate con la loro scheda", () => {
    const source = pdf([3, 5]);
    expect(sourceNeeds(source)).toBe("pages");
    const bar = sourceBar(source, { pages: 6 });
    expect(bar.loose).toEqual([]);
    expect(bar.pieces).toEqual([
      { kind: "pages", from: 1, to: 1, card: null },
      { kind: "pages", from: 2, to: 2, card: null },
      { kind: "pages", from: 3, to: 3, card: 0 },
      { kind: "pages", from: 4, to: 4, card: null },
      { kind: "pages", from: 5, to: 5, card: 1 },
      { kind: "pages", from: 6, to: 6, card: null },
    ]);
  });

  it("un PDF di cui non si sa ancora quante pagine ha, o che manca: le pagine a parole, senza barra", () => {
    expect(sourceBar(pdf([7, 3]), {})).toEqual({ pieces: [], loose: [3, 7] });
    expect(sourceBar(pdf([2]), { pages: null })).toEqual({ pieces: [], loose: [2] });
  });

  it("una pagina usata oltre la fine che si sa allunga la barra", () => {
    expect(sourceBar(pdf([4]), { pages: 2 }).pieces).toHaveLength(4);
  });

  it("un PDF lungo mette più pagine in un pezzo", () => {
    const bar = sourceBar(pdf([1, 950]), { pages: 1000 });
    expect(bar.pieces).toHaveLength(SOURCE_BAR_MAX_PIECES);
    expect(bar.pieces[0]).toEqual({ kind: "pages", from: 1, to: 5, card: 0 });
    expect(bar.pieces[189]).toEqual({ kind: "pages", from: 946, to: 950, card: 1 });
    expect(bar.pieces[199]).toEqual({ kind: "pages", from: 996, to: 1000, card: null });
  });

  it("il file solo intero: un pezzo che riempie la barra, e non si chiede niente", () => {
    const whole = only([file("a", "Libro.pdf")], "Libro.pdf");
    expect(sourceNeeds(whole)).toBeNull();
    expect(sourceBar(whole, {})).toEqual({ pieces: [{ kind: "whole", card: 0 }], loose: [] });
    const note = only([file("a", "Varianza.md")], "Varianza.md");
    expect(sourceNeeds(note)).toBeNull();
    expect(sourceBar(note, { sections: [{ key: "Varianza", text: "Varianza" }] })).toEqual({ pieces: [{ kind: "whole", card: 0 }], loose: [] });
  });

  it("un PDF intero e qualche pagina: ogni pagina c'è, le usate portano alla loro scheda", () => {
    const source = pdf([2], [file("w", "Libro.pdf")]);
    expect(sourceBar(source, { pages: 3 }).pieces.map((piece) => piece.card)).toEqual([1, 0, 1]);
  });

  it("le sezioni di una nota dal suo sommario, le usate col colore della loro scheda", () => {
    const source = only([file("a", "Rel.md", { subpath: "#Misure" }), file("b", "Rel.md", { subpath: "#Metodo#Strumenti" })], "Rel.md");
    expect(sourceNeeds(source)).toBe("sections");
    const bar = sourceBar(source, {
      sections: [
        { key: "Ipotesi", text: "Ipotesi" },
        { key: "Strumenti", text: "Strumenti" },
        { key: "Misure", text: "Misure" },
      ],
    });
    expect(bar.pieces).toEqual([
      { kind: "section", key: "Ipotesi", text: "Ipotesi", card: null },
      // `Metodo#Strumenti` trova `Strumenti`: il titolo più interno è uno solo.
      { kind: "section", key: "Strumenti", text: "Strumenti", card: 1 },
      { kind: "section", key: "Misure", text: "Misure", card: 0 },
    ]);
  });

  it("una sezione usata che il sommario non ha più resta in fondo; due titoli uguali si distinguono per chiave", () => {
    const source = only([file("a", "Rel.md", { subpath: "#Vecchia" }), file("b", "Rel.md", { subpath: "#B#Note" })], "Rel.md");
    const bar = sourceBar(source, {
      sections: [
        { key: "A#Note", text: "Note" },
        { key: "B#Note", text: "Note" },
      ],
    });
    expect(bar.pieces).toEqual([
      { kind: "section", key: "A#Note", text: "Note", card: null },
      { kind: "section", key: "B#Note", text: "Note", card: 1 },
      { kind: "section", key: "Vecchia", text: "Vecchia", card: 0 },
    ]);
  });

  it("una nota senza titoli: solo «tutta», usata; finché il sommario non arriva, le sezioni usate", () => {
    const source = only([file("a", "Appunti.md", { subpath: "#Intro" })], "Appunti.md");
    expect(sourceBar(source, { sections: [] })).toEqual({ pieces: [{ kind: "whole", card: 0 }], loose: [] });
    expect(sourceBar(source, {})).toEqual({ pieces: [{ kind: "section", key: "Intro", text: "Intro", card: 0 }], loose: [] });
  });

  it("una nota mostrata solo a blocchi: il file intero non è sulla lavagna", () => {
    const source = only([file("a", "Appunti.md", { subpath: "#^abc" })], "Appunti.md");
    expect(sourceBar(source, {})).toEqual({ pieces: [{ kind: "whole", card: null }], loose: [] });
  });
});
