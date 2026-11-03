import { describe, expect, it, vi } from "vitest";
import {
  CARD_QUIET_KEY,
  LIVE_MARGIN,
  LIVE_ZOOM_MIN,
  MAX_LIVE_CARDS,
  cardKindOf,
  createCardRegistry,
  liveCardIds,
  snapshotPart,
  updateLiveCards,
  type CardMode,
  type CardQuiet,
  type CardRenderer,
  type CardView,
  type Rect,
} from "./cards";
import type { CanvasNode } from "./model";

function fileNode(file: string, extra: Partial<CanvasNode> = {}): CanvasNode {
  return { id: file, type: "file", x: 0, y: 0, width: 100, height: 100, file, ...extra };
}

function card(id: string, x: number, y: number, width = 100, height = 100): CanvasNode {
  return { id, type: "file", x, y, width, height, file: `${id}.md` };
}

describe("cardKindOf", () => {
  it("testo e gruppi la tela li disegna da sé", () => {
    expect(cardKindOf({ id: "t", type: "text", x: 0, y: 0, width: 1, height: 1, text: "a.md" })).toBeNull();
    expect(cardKindOf({ id: "g", type: "group", x: 0, y: 0, width: 1, height: 1 })).toBeNull();
  });

  it("un link è una pagina web", () => {
    expect(cardKindOf({ id: "l", type: "link", x: 0, y: 0, width: 1, height: 1, url: "https://a.it/x.pdf" })).toBe("web");
  });

  it.each([
    ["Nota.md", "note"],
    ["Corsi/Lezione.markdown", "note"],
    ["Tesi.docx", "document"],
    ["Vecchio.doc", "document"],
    ["Lettera.rtf", "document"],
    ["Relazione.odt", "document"],
    ["Statistica/voti.xlsx", "sheet"],
    ["Modello.xltm", "sheet"],
    ["Libro.pdf", "pdf"],
    ["foto.png", "image"],
    ["foto.jpeg", "image"],
    ["foto.webp", "image"],
    ["anim.gif", "image"],
    ["schema.svg", "image"],
    ["dati.csv", "file"],
    ["Altra.canvas", "file"],
    ["voce.mp3", "file"],
    ["clip.mp4", "file"],
    ["archivio.zip", "file"],
    ["Makefile", "file"],
    ["Corsi.2026/leggimi", "file"],
    [".md", "file"],
    ["strano.", "file"],
    ["", "file"],
  ] as const)("%s → %s", (file, kind) => {
    expect(cardKindOf(fileNode(file))).toBe(kind);
  });

  it("l'estensione maiuscola conta come minuscola", () => {
    expect(cardKindOf(fileNode("FOTO.JPG"))).toBe("image");
    expect(cardKindOf(fileNode("Nota.MD"))).toBe("note");
  });

  it("un punto nel subpath non conta per l'estensione", () => {
    expect(cardKindOf(fileNode("Nota.md#1.2 Titolo"))).toBe("note");
    expect(cardKindOf(fileNode("Nota.md", { subpath: "#1.2 Titolo" }))).toBe("note");
    expect(cardKindOf(fileNode("leggimi#a.pdf"))).toBe("file");
  });

  it("un nodo di file senza file è una scheda di file", () => {
    expect(cardKindOf({ id: "f", type: "file", x: 0, y: 0, width: 1, height: 1 })).toBe("file");
  });

  it("nessuna estensione porta a craft", () => {
    for (const file of ["a.fubdraw", "a.craft", "a.vcraft", "a.pcraft"]) {
      expect(cardKindOf(fileNode(file))).toBe("file");
    }
  });
});

describe("snapshotPart", () => {
  it("arrotonda la larghezza al multiplo di 32 più vicino", () => {
    expect(snapshotPart("page-3", 640)).toBe("page-3@640");
    expect(snapshotPart("page-3", 650)).toBe("page-3@640");
    expect(snapshotPart("page-3", 657)).toBe("page-3@672");
    expect(snapshotPart("whole", 0)).toBe("whole@32");
    expect(snapshotPart("whole", 3)).toBe("whole@32");
  });

  it("rifiuta un prefisso vuoto o con @ e una larghezza non finita", () => {
    expect(() => snapshotPart("", 640)).toThrow(RangeError);
    expect(() => snapshotPart("a@b", 640)).toThrow(RangeError);
    expect(() => snapshotPart("whole", Number.NaN)).toThrow(RangeError);
    expect(() => snapshotPart("whole", Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });
});

describe("createCardRegistry", () => {
  const renderer = (...kinds: CardRenderer["kinds"][number][]): CardRenderer => ({
    kinds,
    mount: () => ({ setMode: () => {}, destroy: () => {} }),
  });

  it("dà il renderer di ogni specie, e null per quelle senza", () => {
    const notes = renderer("note", "document");
    const pdf = renderer("pdf");
    const registry = createCardRegistry([notes, pdf]);
    expect(registry.rendererFor("note")).toBe(notes);
    expect(registry.rendererFor("document")).toBe(notes);
    expect(registry.rendererFor("pdf")).toBe(pdf);
    expect(registry.rendererFor("sheet")).toBeNull();
  });

  it("due renderer per la stessa specie sono un errore detto subito", () => {
    expect(() => createCardRegistry([renderer("image"), renderer("pdf", "image")])).toThrow(
      new Error("card kind image has two renderers"),
    );
  });

  it("lo stesso renderer che nomina due volte una specie non è un doppione", () => {
    const image = renderer("image", "image");
    expect(createCardRegistry([image]).rendererFor("image")).toBe(image);
  });
});

describe("liveCardIds", () => {
  const view: Rect = { x: 0, y: 0, width: 1000, height: 1000 };

  it("i valori di partenza", () => {
    expect(LIVE_ZOOM_MIN).toBe(0.35);
    expect(LIVE_MARGIN).toBe(0.5);
    expect(MAX_LIVE_CARDS).toBe(40);
  });

  it("sotto 0,35 nessuna, a 0,35 esatto sì", () => {
    const nodes = [card("a", 100, 100)];
    expect(liveCardIds(nodes, view, 0.349).size).toBe(0);
    expect([...liveCardIds(nodes, view, LIVE_ZOOM_MIN)]).toEqual(["a"]);
    expect([...liveCardIds(nodes, view, 4)]).toEqual(["a"]);
    expect(liveCardIds(nodes, view, Number.NaN).size).toBe(0);
  });

  it("la vista si allarga di metà per lato: dentro chi la tocca, anche sul bordo", () => {
    const nodes = [
      card("dentro", 100, 100),
      card("margine-sinistro", -550, 100),
      card("bordo-sinistro", -600, 100),
      card("fuori-sinistra", -601, 100),
      card("bordo-destro", 1500, 100),
      card("fuori-destra", 1501, 100),
      card("bordo-alto", 100, -600),
      card("fuori-alto", 100, -601),
      card("bordo-basso", 100, 1500),
      card("fuori-basso", 100, 1501),
    ];
    expect(liveCardIds(nodes, view, 1)).toEqual(
      new Set(["dentro", "margine-sinistro", "bordo-sinistro", "bordo-destro", "bordo-alto", "bordo-basso"]),
    );
  });

  it("il margine segue la misura della vista, anche fuori dall'origine", () => {
    const wide: Rect = { x: 1000, y: 0, width: 200, height: 100 };
    const nodes = [card("a", 870, 0, 30, 30), card("b", 869, 0, 30, 30), card("c", 1300, 140, 10, 10)];
    expect(liveCardIds(nodes, wide, 1)).toEqual(new Set(["a", "c"]));
  });

  it("una vista vuota non ha schede vive", () => {
    const nodes = [card("a", 0, 0)];
    expect(liveCardIds(nodes, { x: 0, y: 0, width: 0, height: 500 }, 1).size).toBe(0);
    expect(liveCardIds(nodes, { x: 0, y: 0, width: 500, height: 0 }, 1).size).toBe(0);
  });

  it("solo le schede con una specie", () => {
    const nodes: CanvasNode[] = [
      { id: "t", type: "text", x: 0, y: 0, width: 10, height: 10, text: "x" },
      { id: "g", type: "group", x: 0, y: 0, width: 10, height: 10 },
      { id: "l", type: "link", x: 0, y: 0, width: 10, height: 10, url: "https://a.it" },
      { id: "f", type: "file", x: 0, y: 0, width: 10, height: 10, file: "dati.csv" },
    ];
    expect(liveCardIds(nodes, view, 1)).toEqual(new Set(["l", "f"]));
  });

  it("una scheda più grande della vista che la contiene tutta è viva", () => {
    expect([...liveCardIds([card("grande", -5000, -5000, 20000, 20000)], view, 1)]).toEqual(["grande"]);
  });

  it("oltre il limite restano le più vicine al centro", () => {
    const nodes = [
      card("lontana", 1400, 1400, 50, 50),
      card("centro", 450, 450),
      card("vicina", 700, 450),
      card("media", 900, 900),
    ];
    expect(liveCardIds(nodes, view, 1, 2)).toEqual(new Set(["centro", "vicina"]));
    expect(liveCardIds(nodes, view, 1, 3)).toEqual(new Set(["centro", "vicina", "media"]));
    expect(liveCardIds(nodes, view, 1, 4).size).toBe(4);
  });

  it("la distanza è dal punto più vicino della scheda: chi copre il centro vale zero", () => {
    const nodes = [card("piccola", 560, 480, 20, 20), card("larga", -400, 400, 1800, 200)];
    expect([...liveCardIds(nodes, view, 1, 1)]).toEqual(["larga"]);
  });

  it("a pari distanza vince l'ordine del file", () => {
    const nodes = [card("prima", 700, 450), card("seconda", 200, 450), card("terza", 450, 700)];
    expect([...liveCardIds(nodes, view, 1, 1)]).toEqual(["prima"]);
    expect(liveCardIds(nodes, view, 1, 2)).toEqual(new Set(["prima", "seconda"]));
  });

  it("limite 0 o negativo: nessuna; il limite di serie è MAX_LIVE_CARDS", () => {
    const nodes = Array.from({ length: 50 }, (_, i) => card(`c${i}`, (i % 10) * 100, Math.floor(i / 10) * 100, 50, 50));
    expect(liveCardIds(nodes, view, 1, 0).size).toBe(0);
    expect(liveCardIds(nodes, view, 1, -3).size).toBe(0);
    expect(liveCardIds(nodes, view, 1).size).toBe(MAX_LIVE_CARDS);
    expect(liveCardIds(nodes, view, 1, 2.9).size).toBe(2);
  });
});

describe("updateLiveCards", () => {
  /// Un `quiet` finto che tiene i lavori finché il test non li lascia andare.
  function heldQuiet() {
    const held: { key: string; work: () => void }[] = [];
    const quiet: CardQuiet = { defer: (key, work) => void held.push({ key, work }) };
    const release = () => {
      for (const { work } of held.splice(0)) work();
    };
    return { quiet, held, release };
  }

  function view() {
    return { setMode: vi.fn<(mode: CardMode) => void>(), destroy: vi.fn<() => void>() } satisfies CardView;
  }

  it("chiama setMode solo nel lavoro rimandato «cards», e aggiorna current lì", () => {
    const a = view();
    const b = view();
    const cards = new Map<string, CardView>([["a", a], ["b", b]]);
    const current = new Map<string, CardMode>([["a", "snapshot"], ["b", "snapshot"]]);
    const { quiet, held, release } = heldQuiet();

    updateLiveCards(cards, new Set(["a"]), current, quiet);

    expect(held.map((job) => job.key)).toEqual([CARD_QUIET_KEY]);
    expect(CARD_QUIET_KEY).toBe("cards");
    expect(a.setMode).not.toHaveBeenCalled();
    expect(current.get("a")).toBe("snapshot");

    release();
    expect(a.setMode).toHaveBeenCalledExactlyOnceWith("live");
    expect(b.setMode).not.toHaveBeenCalled();
    expect(current).toEqual(new Map([["a", "live"], ["b", "snapshot"]]));
  });

  it("solo dove il modo cambia, nei due versi", () => {
    const a = view();
    const b = view();
    const c = view();
    const cards = new Map<string, CardView>([["a", a], ["b", b], ["c", c]]);
    const current = new Map<string, CardMode>([["a", "live"], ["b", "live"], ["c", "snapshot"]]);
    const { quiet, release } = heldQuiet();

    updateLiveCards(cards, new Set(["a", "c"]), current, quiet);
    release();

    expect(a.setMode).not.toHaveBeenCalled();
    expect(b.setMode).toHaveBeenCalledExactlyOnceWith("snapshot");
    expect(c.setMode).toHaveBeenCalledExactlyOnceWith("live");
    expect(current).toEqual(new Map([["a", "live"], ["b", "snapshot"], ["c", "live"]]));
  });

  it("una scheda senza modo noto lo riceve", () => {
    const a = view();
    const current = new Map<string, CardMode>();
    const { quiet, release } = heldQuiet();
    updateLiveCards(new Map([["a", a]]), new Set(), current, quiet);
    release();
    expect(a.setMode).toHaveBeenCalledExactlyOnceWith("snapshot");
    expect(current.get("a")).toBe("snapshot");
  });

  it("wanted si legge quando si chiama; le schede quando il lavoro va", () => {
    const a = view();
    const b = view();
    const cards = new Map<string, CardView>([["a", a], ["b", b]]);
    const current = new Map<string, CardMode>([["a", "snapshot"], ["b", "snapshot"], ["via", "live"]]);
    const wanted = new Set(["a", "b"]);
    const { quiet, release } = heldQuiet();

    updateLiveCards(cards, wanted, current, quiet);
    wanted.delete("a");
    cards.delete("b");
    release();

    expect(a.setMode).toHaveBeenCalledExactlyOnceWith("live");
    expect(b.setMode).not.toHaveBeenCalled();
    expect(current).toEqual(new Map([["a", "live"]]));
  });

  it("un setMode che lancia non ferma le altre schede e lascia il suo modo", () => {
    const a = view();
    a.setMode.mockImplementation(() => {
      throw new Error("guasto");
    });
    const b = view();
    const current = new Map<string, CardMode>([["a", "snapshot"], ["b", "snapshot"]]);
    const { quiet, release } = heldQuiet();

    updateLiveCards(new Map([["a", a], ["b", b]]), new Set(["a", "b"]), current, quiet);
    expect(release).toThrow("guasto");
    expect(b.setMode).toHaveBeenCalledExactlyOnceWith("live");
    expect(current).toEqual(new Map([["a", "snapshot"], ["b", "live"]]));
  });
});
