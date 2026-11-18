// @vitest-environment happy-dom
// Le schede vive nella nota (E19, T41): un embed di file da solo nel paragrafo
// si mostra con l'ospite delle schede. Qui con un editor vero, la Live vera e
// una specie finta che conta i suoi montaggi, i suoi modi e i suoi ascolti.
import { afterEach, describe, expect, it, vi } from "vitest";
import { markdown } from "@codemirror/lang-markdown";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { undo } from "@codemirror/commands";
import { markdownGrammar } from "./grammar";
import { createTextEngine, type TextEngine } from "../../engine";
import { livePreview } from "./livepreview";
import {
  isLiveCardFile,
  liveCardEmbed,
  liveCardPart,
  liveCardPick,
  LiveCards,
  besideCardAt,
  embedRangeAtLine,
  liveCardDisplay,
  liveCardSize,
  liveCardWidthOf,
  liveCardWidthPx,
  relinkEmbedAt,
  removeEmbedAt,
  repartEmbedAt,
  showEmbedAt,
  sizeEmbedAt,
  type LiveCardKit,
  type LiveCardsPort,
} from "./live-cards";
import type { CardContext, CardKind, CardMode, CardRenderer, CardView } from "../../../core/cards/contract";
import { blockAt, markdownBlockGroup, sheetCardGroup, type BlockGroupHost } from "./block-groups";
import { mountMarkdown } from "./mount";
import { embedSize } from "./media";
import { removeColumnAt } from "./callout";
import { blockModel } from "./blocks/model";
import { blocksMode } from "./blocks";
import { blockSelection } from "./blocks/selection";
import { mountMarkdownSurface } from "./surface";

/// Una specie finta: ogni vista tiene il suo modo, ascolta il documento finché
/// è montata (per contare chi resta) e scrive in un «file» suo.
class FakeSpecies {
  readonly views: FakeView[] = [];
  /// Gli ascolti aperti sul documento dalle viste ancora montate.
  listeners = 0;
  renderer: CardRenderer = {
    kinds: ["pdf", "sheet"],
    mount: (node, host, mode, context) => {
      const view = new FakeView(this, node.file ?? "", host, mode, context);
      this.views.push(view);
      return view;
    },
  };
}

class FakeView implements CardView {
  mode: CardMode;
  entered = 0;
  left = 0;
  edits = 0;
  destroyed = false;
  readonly keys: string[] = [];
  /// Il «file» della scheda: ciò che si scrive, e la sua cronologia.
  text = "A1";
  readonly history: string[] = [];
  readonly #off: () => void;

  constructor(readonly species: FakeSpecies, readonly path: string, readonly host: HTMLElement, mode: CardMode, readonly context: CardContext) {
    this.mode = mode;
    host.append(Object.assign(document.createElement("div"), { className: "fake-card", textContent: path }));
    const listener = (): void => {};
    document.addEventListener("selectionchange", listener);
    species.listeners += 1;
    this.#off = () => {
      document.removeEventListener("selectionchange", listener);
      species.listeners -= 1;
    };
  }

  setMode(mode: CardMode): void {
    this.mode = mode;
  }

  enter(): boolean {
    this.entered += 1;
    return true;
  }

  leave(): void {
    this.left += 1;
    this.context.writing?.(null);
  }

  edit(): boolean {
    this.edits += 1;
    this.context.writing?.({ toolbar: Object.assign(document.createElement("div"), { className: "fake-toolbar" }) });
    return true;
  }

  key(event: KeyboardEvent): boolean {
    this.keys.push(event.key);
    if (event.key.length === 1) {
      this.history.push(this.text);
      this.text += event.key;
      return true;
    }
    if (event.key === "z" || (event.key === "Z" && event.ctrlKey)) return true;
    return false;
  }

  /// L'annulla del file della scheda.
  undo(): void {
    const before = this.history.pop();
    if (before !== undefined) this.text = before;
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.#off();
  }
}

function kindOf(path: string): CardKind {
  if (path.endsWith(".pdf")) return "pdf";
  if (path.endsWith(".xlsx")) return "sheet";
  return "file";
}

interface Rig {
  readonly parent: HTMLElement;
  readonly engine: TextEngine;
  readonly view: EditorView;
  readonly cards: LiveCards;
  readonly species: FakeSpecies;
  readonly opened: { path: string; subpath: string | null }[];
  destroy(): void;
}

const rigs: Rig[] = [];

afterEach(() => {
  for (const rig of rigs.splice(0)) rig.destroy();
});

function rig(text: string, options: {
  readonly files?: ReadonlySet<string> | "all";
  readonly kit?: boolean;
  readonly maxLive?: number;
  readonly editable?: boolean;
  readonly renderers?: readonly CardKind[];
  readonly pick?: LiveCardsPort["pick"];
  readonly sheetChanged?: () => void;
  readonly resolve?: LiveCardsPort["resolve"];
  /// I Blocchi accesi, come nella Scrittura di serie: la scheda si sceglie.
  readonly blocks?: boolean;
} = {}): Rig {
  const species = new FakeSpecies();
  const parent = document.createElement("div");
  document.body.append(parent);
  const opened: { path: string; subpath: string | null }[] = [];
  const renderers = new Set(options.renderers ?? ["pdf", "sheet"]);
  const kit: LiveCardKit = {
    registry: { rendererFor: (kind) => renderers.has(kind) ? species.renderer : null } as LiveCardKit["registry"],
    snapshots: {} as LiveCardKit["snapshots"],
    watch: () => () => {},
    kindOf,
    maxLive: options.maxLive ?? 40,
  };
  const files = options.files ?? "all";
  const port: LiveCardsPort = {
    load: async () => options.kit === false ? null : kit,
    resolve: options.resolve ?? (async (page) => files === "all" || files.has(page) ? `Archivio/${page}` : null),
    open: (path, subpath) => opened.push({ path, subpath }),
    ...(options.pick ? { pick: options.pick } : {}),
  };
  const editorView = (): EditorView | null => {
    const editor = parent.querySelector<HTMLElement>(".cm-editor");
    return editor ? EditorView.findFromDOM(editor) : null;
  };
  const cards = new LiveCards({
    port,
    hostDoc: () => "Note.md",
    editable: () => options.editable ?? true,
    text: (from, to) => {
      const state = editorView()?.state;
      return state && to <= state.doc.length ? state.sliceDoc(from, to) : null;
    },
    ...(options.sheetChanged ? { sheetChanged: options.sheetChanged } : {}),
  });
  const engine = createTextEngine(parent, {
    onChange() {},
    onSelectionChange() {},
    extensions: () => [markdown({ base: markdownGrammar }), livePreview({
      openWikilink() {},
      searchTag() {},
      liveCards: cards,
      // Le colonne rese come nella Scrittura vera: le schede dentro le prende
      // l'ospite (T42).
      mountRendered: (container, html, actions) => mountMarkdown(container, html, {
        ...actions,
        liveCard: (slot, life) => cards.hostSlot(slot, life),
      }),
    }), ...(options.blocks ? [blocksMode({ page: () => "Nota" })] : [])],
  });
  engine.setDoc(text);
  const view = EditorView.findFromDOM(parent.querySelector<HTMLElement>(".cm-editor")!)!;
  const made: Rig = {
    parent, engine, view, cards, species, opened,
    destroy() {
      engine.destroy();
      cards.destroy();
      parent.remove();
    },
  };
  rigs.push(made);
  return made;
}

/// Lascia arrivare l'ospite e il nome risolto (promesse), e il conto delle vive.
async function settle(): Promise<void> {
  for (let i = 0; i < 6; i += 1) await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function cardsIn(parent: HTMLElement): HTMLElement[] {
  return [...parent.querySelectorAll<HTMLElement>(".live-card")];
}

describe("quali embed sono schede", () => {
  it("un file da solo nel paragrafo, che la nota non mostra già a modo suo", () => {
    expect(isLiveCardFile("Contratto.pdf")).toBe(true);
    expect(isLiveCardFile("Conti.xlsx")).toBe(true);
    expect(isLiveCardFile("Logo.vectorcraft")).toBe(true);
    expect(isLiveCardFile("dati.zip")).toBe(true);
    // I documenti di Word e ODT sono schede (T44).
    expect(isLiveCardFile("Relazione.docx")).toBe(true);
    expect(isLiveCardFile("Relazione.odt")).toBe(true);
    // Un SVG è una scheda (T46): un disegno di Fub ci si disegna sul posto.
    expect(isLiveCardFile("Schizzo.svg")).toBe(true);
    expect(isLiveCardFile("Schizzo.SVG")).toBe(true);
    for (const page of ["Nota", "Nota.md", "Viste.base", "Lavagna.canvas", "Foto.png", "Voce.mp3", "Clip.mp4", "Scatto.xmp"]) {
      expect(isLiveCardFile(page), page).toBe(false);
    }
    expect(liveCardEmbed("![[Contratto.pdf#page=3]]")).toEqual({ page: "Contratto.pdf", subpath: "#page=3", alias: null });
    expect(liveCardEmbed("  ![[Conti.xlsx|Budget]]  ")).toEqual({ page: "Conti.xlsx", subpath: null, alias: "Budget" });
    expect(liveCardEmbed("Vedi ![[Contratto.pdf]]")).toBeNull();
    expect(liveCardEmbed("![[Contratto.pdf]] ![[Altro.pdf]]")).toBeNull();
    expect(liveCardEmbed("![[Nota]]")).toBeNull();
  });

  it("la testata dice la pagina, o la parte nominata", () => {
    expect(liveCardPart("#page=3")).toBe("p. 3");
    expect(liveCardPart("#Budget")).toBe("Budget");
    expect(liveCardPart("#Budget!A1:E7")).toBe("Budget · A1:E7");
    expect(liveCardPart("#'Conti 2024'!B2")).toBe("Conti 2024 · B2");
    expect(liveCardPart("#A1:E7")).toBe("A1:E7");
    expect(liveCardPart(null)).toBeNull();
  });

  it("vive al più quante ne tiene la lavagna, le più vicine; l'attiva sempre", () => {
    const cards = [
      { id: 1, distance: 300, active: false },
      { id: 2, distance: 0, active: false },
      { id: 3, distance: 50, active: false },
      { id: 4, distance: 900, active: true },
    ];
    expect([...liveCardPick(cards, 2)].sort()).toEqual([2, 4]);
    expect([...liveCardPick(cards, 3)].sort()).toEqual([2, 3, 4]);
  });
});

describe("la scheda nella Live", () => {
  it("si mostra a riposo, ferma, col nome del file e la parte", async () => {
    const { parent, species } = rig("Prima\n\n![[Contratto.pdf#page=3]]\n\nDopo\n");
    await settle();
    const [card] = cardsIn(parent);
    expect(card).toBeDefined();
    expect(card!.dataset.cardState).toBe("view");
    expect(card!.dataset.cardKind).toBe("pdf");
    expect(card!.querySelector(".live-card-name")?.textContent).toBe("Contratto.pdf");
    expect(card!.querySelector(".live-card-part")?.textContent).toContain("p. 3");
    expect(species.views).toHaveLength(1);
    expect(species.views[0]!.path).toBe("Archivio/Contratto.pdf");
    expect(species.views[0]!.context.subpath).toBe("#page=3");
    // Montata ferma; poi viva, perché sta nella vista e ce n'è posto.
    expect(species.views[0]!.mode).toBe("live");
    expect(species.views[0]!.entered).toBe(0);
    expect(species.views[0]!.edits).toBe(0);
  });

  it("col cursore dentro l'embed si scrive com'è", async () => {
    const { parent, view } = rig("Prima\n\n![[Contratto.pdf]]\n\nDopo\n");
    await settle();
    expect(cardsIn(parent)).toHaveLength(1);
    view.dispatch({ selection: { anchor: 10 } });
    expect(cardsIn(parent)).toHaveLength(0);
    expect(view.contentDOM.textContent).toContain("Contratto.pdf");
  });

  it("montata e smontata 20 volte non lascia ascolti né viste", async () => {
    const { parent, view, species } = rig("Prima\n\n![[Contratto.pdf]]\n\nDopo\n");
    const add = vi.spyOn(document, "addEventListener");
    const remove = vi.spyOn(document, "removeEventListener");
    for (let round = 0; round < 20; round += 1) {
      await settle();
      expect(cardsIn(parent)).toHaveLength(1);
      // Attivata e lasciata: il clic fuori si ascolta solo mentre è attiva.
      const card = view.contentDOM.querySelector<HTMLElement>(".live-card-body")!;
      card.click();
      view.dispatch({ selection: { anchor: 10 } });
      expect(cardsIn(parent)).toHaveLength(0);
      view.dispatch({ selection: { anchor: 0 } });
    }
    await settle();
    expect(species.views.length).toBeGreaterThanOrEqual(20);
    expect(species.views.filter((one) => !one.destroyed)).toHaveLength(1);
    expect(species.listeners).toBe(1);
    expect(add.mock.calls.length - remove.mock.calls.length).toBe(1);
    add.mockRestore();
    remove.mockRestore();
  });

  it("attiva: Invio o un clic dentro; scrive nel file della scheda, Esc esce e la nota non cambia", async () => {
    const { parent, view, cards, species } = rig("Prima\n\n![[Conti.xlsx]]\n\nDopo\n");
    await settle();
    const card = cardsIn(parent)[0]!;
    const before = view.state.doc.toString();
    expect(cards.activateAt(view, view.state.doc.line(3).from)).toBe(true);
    const fake = species.views[0]!;
    expect(card.dataset.cardActive).toBe("true");
    expect(fake.entered).toBe(1);
    expect(fake.edits).toBe(1);
    expect(card.dataset.cardWriting).toBe("true");
    expect(card.querySelector(".fake-toolbar")).not.toBeNull();
    // I tasti sono della scheda: si scrive nel suo file, non nella nota.
    card.dispatchEvent(new KeyboardEvent("keydown", { key: "7", bubbles: true, cancelable: true }));
    expect(fake.text).toBe("A17");
    expect(view.state.doc.toString()).toBe(before);
    // L'annulla della scheda è del suo file; quello della nota non tocca la scheda.
    fake.undo();
    expect(fake.text).toBe("A1");
    expect(undo(view)).toBe(false);
    // Esc esce: la scheda lascia la scrittura, la nota riprende il fuoco.
    card.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    expect(card.dataset.cardActive).toBeUndefined();
    expect(card.dataset.cardWriting).toBeUndefined();
    expect(fake.left).toBe(1);
    expect(cards.activeCard()).toBeNull();
  });

  it("una sola attiva alla volta; un clic fuori la lascia", async () => {
    const { parent, view, cards } = rig("Testo\n\n![[A.pdf]]\n\nIn mezzo\n\n![[B.pdf]]\n\nFine\n");
    await settle();
    const [a, b] = cardsIn(parent);
    a!.querySelector<HTMLElement>(".live-card-body")!.click();
    expect(a!.dataset.cardActive).toBe("true");
    b!.querySelector<HTMLElement>(".live-card-body")!.click();
    expect(a!.dataset.cardActive).toBeUndefined();
    expect(b!.dataset.cardActive).toBe("true");
    view.contentDOM.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    expect(b!.dataset.cardActive).toBeUndefined();
    expect(cards.activeCard()).toBeNull();
  });

  it("in sola lettura si guarda: entra ma non scrive", async () => {
    const { parent, species } = rig("Testo\n\n![[Conti.xlsx]]\n\nFine\n", { editable: false });
    await settle();
    cardsIn(parent)[0]!.querySelector<HTMLElement>(".live-card-body")!.click();
    expect(species.views[0]!.entered).toBe(1);
    expect(species.views[0]!.edits).toBe(0);
    expect(species.views[0]!.context.editors).toBeUndefined();
  });

  it("«Apri» apre il file alla sua parte", async () => {
    const { parent, opened } = rig("Testo\n\n![[Contratto.pdf#page=2]]\n\nFine\n");
    await settle();
    cardsIn(parent)[0]!.querySelector<HTMLButtonElement>(".live-card-open")!.click();
    expect(opened).toEqual([{ path: "Archivio/Contratto.pdf", subpath: "#page=2" }]);
  });

  it("«Apri» mentre la scheda si carica apre il file risolto, non il nome scritto", async () => {
    const answers: ((path: string | null) => void)[] = [];
    const { parent, opened } = rig("Testo\n\n![[Contratto.pdf#page=2]]\n\nFine\n", {
      resolve: () => new Promise((done) => answers.push(done)),
    });
    await settle();
    const card = cardsIn(parent)[0]!;
    expect(card.dataset.cardState).toBe("loading");
    card.querySelector<HTMLButtonElement>(".live-card-open")!.click();
    expect(opened).toEqual([]);
    for (const answer of answers) answer("Archivio/Contratto.pdf");
    await settle();
    expect(opened).toEqual([{ path: "Archivio/Contratto.pdf", subpath: "#page=2" }]);
  });

  it("«Apri» su un file che manca apre il nome com'è", async () => {
    const { parent, opened } = rig("Testo\n\n![[Sparito.pdf]]\n\nFine\n", { files: new Set() });
    await settle();
    cardsIn(parent)[0]!.querySelector<HTMLButtonElement>(".live-card-open")!.click();
    await settle();
    expect(opened).toEqual([{ path: "Sparito.pdf", subpath: null }]);
  });

  it("20 schede: vive al più quante ne tiene la lavagna, e una battuta non le rimonta", async () => {
    const text = "Testo\n\n" + Array.from({ length: 20 }, (_, i) => `![[F${i}.pdf]]`).join("\n\n") + "\n\nFine\n";
    const { parent, view, species } = rig(text, { maxLive: 5 });
    await settle();
    expect(cardsIn(parent).length).toBeGreaterThan(0);
    const before = species.views.filter((one) => !one.destroyed);
    const live = species.views.filter((one) => !one.destroyed && one.mode === "live");
    expect(live.length).toBeLessThanOrEqual(5);
    const end = view.state.doc.length;
    view.dispatch({ selection: { anchor: end } });
    const started = performance.now();
    for (let i = 0; i < 20; i += 1) {
      view.dispatch({ changes: { from: view.state.doc.length, insert: "x" }, userEvent: "input.type" });
    }
    const perKey = (performance.now() - started) / 20;
    await settle();
    // Le schede che c'erano sono le stesse: nessuna rimontata.
    expect(before.every((one) => !one.destroyed)).toBe(true);
    // La battuta non passa dalle schede: il budget della battuta della Live.
    expect(perKey).toBeLessThan(16);
  });
});

describe("la scheda scelta è un oggetto", () => {
  const ESC = (): KeyboardEvent => new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });

  /// La Scrittura vera (la superficie Markdown, Blocchi accesi di serie) con
  /// le schede: la bolla del testo scelto chiede a lei `selectionBox`.
  function surface(text: string) {
    const species = new FakeSpecies();
    const parent = document.createElement("div");
    document.body.append(parent);
    const kit: LiveCardKit = {
      registry: { rendererFor: () => species.renderer } as unknown as LiveCardKit["registry"],
      snapshots: {} as LiveCardKit["snapshots"],
      watch: () => () => {},
      kindOf,
      maxLive: 40,
    };
    const ed = mountMarkdownSurface({ paneId: "riquadro", documentId: "Note.md", parent }, {
      onChange: () => {},
      onSelectionChange: () => {},
      onOpenWikilink: () => {},
      onOpenPath: () => {},
      onSearchTag: () => {},
      completions: { searchNotes: async () => [], listTags: async () => [] },
      liveCards: { load: async () => kit, resolve: async (page) => `Archivio/${page}`, open: () => {} },
    });
    ed.buffer.setDoc(text);
    const view = EditorView.findFromDOM(parent.querySelector<HTMLElement>(".cm-editor")!)!;
    rigs.push({
      parent, view, species, opened: [],
      engine: null as unknown as TextEngine,
      cards: null as unknown as LiveCards,
      destroy() {
        ed.destroy();
        parent.remove();
      },
    });
    return { ed, parent, view, species };
  }

  it("scelta dalla testata o con Esc dall'interno, la bolla del testo non c'è; sul testo scelto sì", async () => {
    // jsdom non impagina: ogni posizione ha un rettangolo finto, così la sola
    // regola che resta è quella della superficie.
    const coords = vi.spyOn(EditorView.prototype, "coordsAtPos").mockReturnValue({ left: 10, right: 20, top: 30, bottom: 40 });
    try {
      const { ed, parent, view } = surface("Prima riga\n\n![[Contratto.pdf]]\n\nDopo\n");
      await settle();
      const box = (): unknown => ed.editorActions.selectionBox?.() ?? null;
      const card = cardsIn(parent)[0]!;
      expect(card).toBeDefined();
      expect(view.state.field(blockSelection, false)).not.toBeUndefined();
      // Il testo scelto ha la bolla.
      view.dispatch({ selection: { anchor: 0, head: 5 } });
      expect(box()).not.toBeNull();
      // Un clic sulla testata sceglie la scheda: è un oggetto, niente bolla.
      card.querySelector<HTMLElement>(".live-card-head")!.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
      expect(card.dataset.cardChosen).toBe("true");
      expect(view.state.selection.main.empty).toBe(false);
      expect(box()).toBeNull();
      // Attiva e poi Esc: di nuovo scelta, e di nuovo senza bolla.
      card.querySelector<HTMLElement>(".live-card-body")!.click();
      expect(card.dataset.cardActive).toBe("true");
      card.dispatchEvent(ESC());
      expect(card.dataset.cardActive).toBeUndefined();
      expect(card.dataset.cardChosen).toBe("true");
      expect(box()).toBeNull();
      // Un paragrafo scelto coi Blocchi resta testo: la bolla c'è.
      view.dispatch({ selection: { anchor: 1 } });
      view.contentDOM.dispatchEvent(ESC());
      expect(view.state.field(blockSelection)).not.toBeNull();
      expect(box()).not.toBeNull();
    } finally {
      coords.mockRestore();
    }
  });

  it("Esc da una scheda attiva la lascia scelta; il secondo Esc torna al testo e la scheda resta scheda", async () => {
    const { parent, view, cards, species } = rig("Prima\n\n![[Conti.xlsx]]\n\nDopo\n", { blocks: true });
    await settle();
    const card = cardsIn(parent)[0]!;
    card.querySelector<HTMLElement>(".live-card-body")!.click();
    expect(cards.activeCard()?.root).toBe(card);
    card.dispatchEvent(ESC());
    expect(cards.activeCard()).toBeNull();
    expect(species.views[0]!.left).toBe(1);
    expect(card.dataset.cardChosen).toBe("true");
    expect(cards.objectsChosen(view)).toBe(true);
    // Il secondo Esc: il cursore nella riga dopo la scheda, non nell'embed.
    view.contentDOM.dispatchEvent(ESC());
    expect(view.state.field(blockSelection)).toBeNull();
    expect(view.state.selection.main.empty).toBe(true);
    expect(view.state.doc.lineAt(view.state.selection.main.head).number).toBe(4);
    expect(cardsIn(parent)).toEqual([card]);
    expect(card.dataset.cardChosen).toBeUndefined();
  });

  it("Esc da un foglio attivo in una colonna sceglie le colonne, e le schede restano schede", async () => {
    const doc = "Prima\n\n> [!columns]\n> > [!column]\n> > ![[Contratto.pdf]]\n>\n> > [!column]\n> > ![[Conti.xlsx]]\n\nDopo\n";
    const { parent, view, cards } = rig(doc, { blocks: true });
    await settle();
    const sheet = parent.querySelector<HTMLElement>('.fub-column > .live-card[data-card-kind="sheet"]')!;
    sheet.querySelector<HTMLElement>(".live-card-body")!.click();
    expect(cards.activeCard()?.root).toBe(sheet);
    sheet.dispatchEvent(ESC());
    expect(cards.activeCard()).toBeNull();
    expect(view.state.field(blockSelection)).not.toBeNull();
    // Le colonne scelte restano rese: le due schede ci sono ancora, scelte.
    const inColumns = [...parent.querySelectorAll<HTMLElement>(".fub-column > .live-card")];
    expect(inColumns.map((one) => one.dataset.cardKind)).toEqual(["pdf", "sheet"]);
    expect(inColumns.every((one) => one.dataset.cardChosen === "true")).toBe(true);
    expect(cards.objectsChosen(view)).toBe(true);
    expect(view.state.doc.toString()).toBe(doc);
  });
});

describe("i casi limite", () => {
  it("un file mancante dice il nome, «Ritrova…» e «Togli dalla nota»", async () => {
    const pick = vi.fn(async () => "Archivio/Contratto firmato.pdf");
    const { parent, view } = rig("Prima\n\n![[Contratto.pdf#page=2|Firma]]\n\nDopo\n", { files: new Set(), pick });
    await settle();
    const card = cardsIn(parent)[0]!;
    expect(card.dataset.cardState).toBe("missing");
    expect(card.textContent).toContain("File mancante: Contratto.pdf");
    card.querySelector<HTMLButtonElement>("[data-live-card-action=relink]")!.click();
    await settle();
    expect(pick).toHaveBeenCalledWith("Contratto.pdf");
    expect(view.state.doc.toString()).toBe("Prima\n\n![[Archivio/Contratto firmato.pdf#page=2|Firma]]\n\nDopo\n");
  });

  it("«Togli dalla nota» toglie l'embed e mai il file, in un passo d'annullamento", async () => {
    const { parent, view } = rig("Prima\n\n![[Contratto.pdf]]\n\nDopo\n", { files: new Set() });
    await settle();
    cardsIn(parent)[0]!.querySelector<HTMLButtonElement>("[data-live-card-action=remove]")!.click();
    expect(view.state.doc.toString()).toBe("Prima\n\nDopo\n");
    expect(undo(view)).toBe(true);
    expect(view.state.doc.toString()).toBe("Prima\n\n![[Contratto.pdf]]\n\nDopo\n");
  });

  it("senza l'ospite (il componente spento) dice la specie e il percorso, con «Apri»", async () => {
    const { parent, opened } = rig("Testo\n\n![[Conti.xlsx]]\n\nFine\n", { kit: false });
    await settle();
    const card = cardsIn(parent)[0]!;
    expect(card.dataset.cardState).toBe("unsupported");
    expect(card.textContent).toContain("XLSX · Archivio/Conti.xlsx");
    card.querySelector<HTMLButtonElement>(".live-card-open")!.click();
    expect(opened).toEqual([{ path: "Archivio/Conti.xlsx", subpath: null }]);
  });

  it("un formato senza vista (un plugin che manca) dice la specie e il percorso", async () => {
    const { parent } = rig("Testo\n\n![[dati.zip]]\n\nFine\n");
    await settle();
    const card = cardsIn(parent)[0]!;
    expect(card.dataset.cardState).toBe("unsupported");
    expect(card.textContent).toContain("ZIP · Archivio/dati.zip");
    card.querySelector<HTMLElement>(".live-card-body")!.click();
    expect(card.dataset.cardActive).toBeUndefined();
  });

  it("la scheda che sparisce mentre è attiva esce e dice che manca", async () => {
    const { parent, cards, species } = rig("Testo\n\n![[Contratto.pdf]]\n\nFine\n");
    await settle();
    cardsIn(parent)[0]!.querySelector<HTMLElement>(".live-card-body")!.click();
    expect(cards.activeCard()).not.toBeNull();
    species.views[0]!.context.missing();
    expect(cards.activeCard()).toBeNull();
    expect(cardsIn(parent)[0]!.dataset.cardState).toBe("missing");
    expect(species.views[0]!.destroyed).toBe(true);
  });
});

describe("le transazioni sull'embed", () => {
  it("togliere in fondo porta via anche le righe vuote prima", () => {
    const state = EditorState.create({ doc: "Prima\n\n![[A.pdf]]\n" });
    const spec = removeEmbedAt(state, state.doc.line(3).from)!;
    expect(state.update(spec).state.doc.toString()).toBe("Prima\n");
  });

  it("ritrovare tiene la parte e l'alias", () => {
    const state = EditorState.create({ doc: "![[A.pdf#page=4|x]]" });
    expect(state.update(relinkEmbedAt(state, 0, "B/A.pdf")!).state.doc.toString()).toBe("![[B/A.pdf#page=4|x]]");
  });

  it("il menu del blocco ha il gruppo «Scheda»", () => {
    const state = EditorState.create({ doc: "Prima\n\n![[Conti.xlsx#Budget]]\n" });
    expect(blockAt(state, state.doc.line(3).from)).toMatchObject({ kind: "card", page: "Conti.xlsx", subpath: "#Budget" });
  });
});

describe("la scheda di foglio nella nota (T43)", () => {
  it("la specie sa di stare in una nota, e chiede l'altezza della sua parte", async () => {
    const { parent, species } = rig("Testo\n\n![[Conti.xlsx#Budget!A1:E7]]\n\nFine\n");
    await settle();
    const context = species.views[0]!.context;
    expect(context).toMatchObject({ host: "note", subpath: "#Budget!A1:E7" });
    const card = cardsIn(parent)[0]!;
    context.fitHeight!(218);
    expect(card.dataset.cardFit).toBe("true");
    expect(card.style.getPropertyValue("--live-card-fit")).toBe("218px");
    context.fitHeight!(null);
    expect(card.dataset.cardFit).toBeUndefined();
    expect(card.style.getPropertyValue("--live-card-fit")).toBe("");
  });

  it("«Scegli di nuovo» riscrive la parte nell'embed, in un passo d'annullamento; in sola lettura non c'è", async () => {
    const { view, species } = rig("Testo\n\n![[Conti.xlsx#Budget!A1:E7|conti]]\n\nFine\n");
    await settle();
    species.views[0]!.context.choosePart!("Totali");
    expect(view.state.doc.line(3).text).toBe("![[Conti.xlsx#Totali|conti]]");
    expect(undo(view)).toBe(true);
    expect(view.state.doc.line(3).text).toBe("![[Conti.xlsx#Budget!A1:E7|conti]]");

    const reading = rig("Testo\n\n![[Conti.xlsx#Sparito]]\n\nFine\n", { editable: false });
    await settle();
    expect(reading.species.views[0]!.context.choosePart).toBeUndefined();
  });

  it("la cella attiva della scheda di foglio attiva va alla superficie, e se ne va uscendo", async () => {
    const changed = vi.fn();
    const { parent, view, cards, species } = rig("Testo\n\n![[Conti.xlsx]]\n\nFine\n", { sheetChanged: changed });
    await settle();
    expect(cards.activeSheet()).toBeNull();
    expect(cards.activateAt(view, view.state.doc.line(3).from)).toBe(true);
    expect(cards.activeSheet()).toMatchObject({ context: null });
    const calls = changed.mock.calls.length;
    expect(calls).toBeGreaterThan(0);
    const fake = species.views[0]!;
    fake.context.writing!({ toolbar: null, context: { cell: "C3", formula: "=B3*2" } });
    expect(cards.activeSheet()!.context).toEqual({ cell: "C3", formula: "=B3*2" });
    expect(changed.mock.calls.length).toBe(calls + 1);
    // La stessa cella non avvisa di nuovo.
    fake.context.writing!({ toolbar: null, context: { cell: "C3", formula: "=B3*2" } });
    expect(changed.mock.calls.length).toBe(calls + 1);
    // Un clic nella barra di formato non è «fuori»: la scheda resta attiva.
    const bar = Object.assign(document.createElement("div"), { className: "format-bar" });
    const button = document.createElement("button");
    bar.append(button);
    document.body.append(bar);
    button.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    expect(cards.activeCard()).not.toBeNull();
    bar.remove();
    // «Apri» del gruppo apre il file, alla sua parte.
    cards.activeSheet()!.open();
    cardsIn(parent)[0]!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    expect(cards.activeSheet()).toBeNull();
  });

  it("una scheda che non è un foglio non dà il gruppo «Foglio»", async () => {
    const { view, cards } = rig("Testo\n\n![[A.pdf]]\n\nFine\n");
    await settle();
    expect(cards.activateAt(view, view.state.doc.line(3).from)).toBe(true);
    expect(cards.activeSheet()).toBeNull();
  });

  it("il gruppo «Foglio» ha la cella attiva e «Apri»", () => {
    const open = vi.fn();
    const group = sheetCardGroup({ open, context: { cell: "C3", formula: "860" } });
    expect(group).toMatchObject({ id: "sheet", label: "Foglio", context: { cell: "C3", formula: "860" } });
    expect(group.items).toHaveLength(1);
    const item = group.items[0] as { label: string; run: () => void };
    expect(item.label).toBe("Apri");
    item.run();
    expect(open).toHaveBeenCalledTimes(1);
  });
});

describe("riscrivere la parte (T43)", () => {
  it("tiene il nome scritto e l'alias, e rifiuta ciò che romperebbe il collegamento", () => {
    const state = EditorState.create({ doc: "![[Conti.xlsx#Budget!A1:E7|x]]" });
    expect(state.update(repartEmbedAt(state, 0, " 'Conti 2024' ")!).state.doc.toString()).toBe("![[Conti.xlsx#'Conti 2024'|x]]");
    for (const bad of ["", "a|b", "a]]b", "a#b", "a\nb", "^id"]) expect(repartEmbedAt(state, 0, bad)).toBeNull();
    const plain = EditorState.create({ doc: "Testo" });
    expect(repartEmbedAt(plain, 0, "Totali")).toBeNull();
  });
});

// ── T42: la misura, «Mostra come», le schede affiancate ─────────────────────

/// Il testo dopo aver applicato `spec`, o quello di prima se non c'è.
function applied(state: EditorState, spec: ReturnType<typeof sizeEmbedAt>): string {
  return spec ? state.update(spec).state.doc.toString() : state.doc.toString();
}

/// Uno stato col Markdown letto e il modello dei blocchi, come nella Scrittura.
function mdState(doc: string): EditorState {
  return EditorState.create({ doc, extensions: [markdown({ base: markdownGrammar }), blockModel] });
}

/// Quattro (o `names.length`) colonne con una scheda ciascuna.
function columnsOf(names: readonly string[]): string {
  return ["> [!columns]", names.map((name) => `> > [!column]\n> > ![[${name}.pdf]]`).join("\n>\n")].join("\n");
}

describe("la misura scritta come la capisce Obsidian", () => {
  it("si legge `|LxA` e `|L`; zero, parole e misure assurde no", () => {
    expect(liveCardSize("640x300")).toEqual({ width: 640, height: 300 });
    expect(liveCardSize("300")).toEqual({ width: 300, height: null });
    expect(liveCardSize("0x0")).toEqual({ width: null, height: null });
    expect(liveCardSize("0")).toEqual({ width: null, height: null });
    expect(liveCardSize("Budget")).toEqual({ width: null, height: null });
    expect(liveCardSize(null)).toEqual({ width: null, height: null });
    // Fuori dai limiti la misura si porta dentro.
    expect(liveCardSize("20x9000")).toEqual({ width: 160, height: 2400 });
    expect(liveCardSize("0x300")).toEqual({ width: null, height: 300 });
  });

  it("si scrive e si rilegge uguale", () => {
    const state = EditorState.create({ doc: "Prima\n\n![[Percorso.pdf|0x0]]\n" });
    const range = embedRangeAtLine(state, state.doc.line(3).from)!;
    const written = applied(state, sizeEmbedAt(state, range, { width: 640, height: 300 }));
    expect(written).toBe("Prima\n\n![[Percorso.pdf|640x300]]\n");
    const again = EditorState.create({ doc: written });
    expect(liveCardSize(liveCardEmbed(again.doc.line(3).text)!.alias)).toEqual({ width: 640, height: 300 });
    // Solo la larghezza, poi niente: torna l'embed di sempre.
    const back = embedRangeAtLine(again, again.doc.line(3).from)!;
    expect(applied(again, sizeEmbedAt(again, back, { width: 300, height: null }))).toBe("Prima\n\n![[Percorso.pdf|300]]\n");
    expect(applied(again, sizeEmbedAt(again, back, { width: null, height: null }))).toBe("Prima\n\n![[Percorso.pdf]]\n");
  });

  it("un'altezza sola prende la larghezza della colonna; senza colonna non si scrive", () => {
    const state = EditorState.create({ doc: "![[Conti.xlsx#Budget]]" });
    const range = embedRangeAtLine(state, 0)!;
    expect(applied(state, sizeEmbedAt(state, range, { width: null, height: 260 }, 620))).toBe("![[Conti.xlsx#Budget|620x260]]");
    expect(sizeEmbedAt(state, range, { width: null, height: 260 }, 0)).toBeNull();
  });

  it("le tre larghezze del menu, dalla colonna", () => {
    expect(liveCardWidthPx("column", 600)).toBe(600);
    expect(liveCardWidthPx("wide", 600)).toBe(664);
    expect(liveCardWidthPx("page", 600)).toBe(728);
    expect(liveCardWidthOf(null, 600)).toBe("column");
    expect(liveCardWidthOf(300, 600)).toBe("column");
    expect(liveCardWidthOf(664, 600)).toBe("wide");
    expect(liveCardWidthOf(728, 600)).toBe("page");
  });

  it("un'immagine tiene la misura di oggi: non è una scheda", () => {
    expect(liveCardEmbed("![[Foto.png|300]]")).toBeNull();
    expect(embedSize("120")).toEqual({ width: "120" });
    expect(embedSize("200x100")).toEqual({ width: "200", height: "100" });
  });
});

describe("«Mostra come»", () => {
  it("scheda, link, riga: cambia solo l'embed nella nota", () => {
    const state = EditorState.create({ doc: "![[Contratto.pdf#page=3|640x300]]" });
    const range = embedRangeAtLine(state, 0)!;
    expect(applied(state, showEmbedAt(state, range, "link"))).toBe("[[Contratto.pdf#page=3]]");
    const row = applied(state, showEmbedAt(state, range, "row"));
    expect(row).toBe("![[Contratto.pdf#page=3|row]]");
    expect(liveCardDisplay(liveCardEmbed(row)!.alias)).toBe("row");
    const rowState = EditorState.create({ doc: row });
    expect(applied(rowState, showEmbedAt(rowState, embedRangeAtLine(rowState, 0)!, "card"))).toBe("![[Contratto.pdf#page=3]]");
    // Un alias scritto a mano resta nel link.
    const own = EditorState.create({ doc: "![[Conti.xlsx|I conti]]" });
    expect(applied(own, showEmbedAt(own, embedRangeAtLine(own, 0)!, "link"))).toBe("[[Conti.xlsx|I conti]]");
  });

  it("la riga mostra icona e nome, senza la vista della specie", async () => {
    const { parent, species } = rig("Prima\n\n![[Conti.xlsx|row]]\n\nDopo\n");
    await settle();
    const [card] = cardsIn(parent);
    expect(card!.dataset.cardState).toBe("row");
    expect(card!.dataset.cardDisplay).toBe("row");
    expect(card!.dataset.cardKind).toBe("sheet");
    expect(card!.querySelector(".live-card-name")?.textContent).toBe("Conti.xlsx");
    expect(species.views).toHaveLength(0);
  });
});

describe("la misura sulla scheda", () => {
  it("la misura scritta arriva alla scheda; cambiarla non rifà la specie", async () => {
    const { parent, view, species } = rig("Prima\n\n![[Conti.xlsx|640x300]]\n\nDopo\n");
    await settle();
    const card = cardsIn(parent)[0]!;
    expect(card.dataset.cardWidth).toBe("set");
    expect(card.dataset.cardHeight).toBe("set");
    expect(card.style.getPropertyValue("--live-card-width")).toBe("640px");
    expect(card.style.getPropertyValue("--live-card-height")).toBe("300px");
    const line = view.state.doc.line(3);
    view.dispatch(sizeEmbedAt(view.state, embedRangeAtLine(view.state, line.from)!, { width: 700, height: 420 })!);
    await settle();
    expect(cardsIn(parent)[0]).toBe(card);
    expect(card.style.getPropertyValue("--live-card-height")).toBe("420px");
    expect(species.views).toHaveLength(1);
    expect(species.views[0]!.destroyed).toBe(false);
    // Un annulla torna alla misura di prima, sulla stessa scheda.
    expect(undo(view)).toBe(true);
    await settle();
    expect(view.state.doc.line(3).text).toBe("![[Conti.xlsx|640x300]]");
    expect(cardsIn(parent)[0]).toBe(card);
    expect(card.style.getPropertyValue("--live-card-height")).toBe("300px");
  });

  it("trascinare il bordo in basso scrive l'altezza; Esc la riporta com'era", async () => {
    const { parent, view } = rig("Prima\n\n![[Conti.xlsx|500]]\n\nDopo\n");
    await settle();
    const card = cardsIn(parent)[0]!;
    const handle = card.querySelector<HTMLElement>(".live-card-resize")!;
    card.dispatchEvent(new Event("pointerenter"));
    expect(card.dataset.cardResizable).toBe("true");
    // happy-dom non impagina: la scheda parte da 0 e il bordo scende di 260.
    handle.dispatchEvent(new PointerEvent("pointerdown", { button: 0, clientY: 100, pointerId: 1, bubbles: true }));
    handle.dispatchEvent(new PointerEvent("pointermove", { clientY: 360, pointerId: 1, bubbles: true }));
    expect(card.style.getPropertyValue("--live-card-height")).toBe("260px");
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    expect(card.dataset.cardHeight).toBeUndefined();
    expect(view.state.doc.line(3).text).toBe("![[Conti.xlsx|500]]");
    handle.dispatchEvent(new PointerEvent("pointerdown", { button: 0, clientY: 100, pointerId: 2, bubbles: true }));
    handle.dispatchEvent(new PointerEvent("pointermove", { clientY: 360, pointerId: 2, bubbles: true }));
    handle.dispatchEvent(new PointerEvent("pointerup", { clientY: 360, pointerId: 2, bubbles: true }));
    expect(view.state.doc.line(3).text).toBe("![[Conti.xlsx|500x260]]");
  });

  it("in sola lettura il bordo non si trascina", async () => {
    const { parent } = rig("Prima\n\n![[Conti.xlsx]]\n", { editable: false });
    await settle();
    const card = cardsIn(parent)[0]!;
    card.dispatchEvent(new Event("pointerenter"));
    expect(card.dataset.cardResizable).toBeUndefined();
    expect(card.querySelector<HTMLElement>(".live-card-resize")!.tabIndex).toBe(-1);
  });
});

describe("«Affianca»: le schede nelle colonne", () => {
  /// Un ospite del gruppo del blocco sopra la vista del banco.
  function groupHost(view: EditorView): BlockGroupHost {
    return {
      read: (read) => read(view.state),
      write: (change) => {
        const spec = change(view.state);
        if (!spec) return false;
        view.dispatch(spec);
        return true;
      },
      view: (gesture) => gesture(view),
      editable: () => true,
      copy() {},
      openLink() {},
    };
  }

  function besideItem(host: BlockGroupHost, pos: number) {
    const group = markdownBlockGroup(host, pos)!;
    expect(group.id).toBe("card");
    const item = group.items.find((one) => typeof one !== "string" && one.id === "markdown.card.beside");
    if (typeof item === "string" || !item) throw new Error("voce «Affianca» mancante");
    return item;
  }

  it("«Affianca» mette la scheda accanto a quella sotto: due colonne con le schede vive", async () => {
    const before = "Prima\n\n![[Contratto.pdf#page=2]]\n\n![[Conti.xlsx]]\n\nDopo\n";
    const { parent, view, species } = rig(before);
    await settle();
    expect(cardsIn(parent)).toHaveLength(2);
    const beside = besideItem(groupHost(view), view.state.doc.line(3).from);
    expect(beside.enabled).not.toBe(false);
    beside.run!();
    const after = view.state.doc.toString();
    expect(after).toContain("> [!columns]");
    expect(after.match(/\[!column\]/g)).toHaveLength(2);
    expect(after.indexOf("Contratto.pdf")).toBeLessThan(after.indexOf("Conti.xlsx"));
    await settle();
    const columns = parent.querySelector<HTMLElement>(".fub-columns");
    expect(columns?.dataset.liveCards).toBe("true");
    const inColumns = [...columns!.querySelectorAll<HTMLElement>(".fub-column > .live-card")];
    expect(inColumns).toHaveLength(2);
    expect(inColumns.every((card) => card.dataset.cardColumn === "true")).toBe(true);
    expect(inColumns.map((card) => card.querySelector(".live-card-name")?.textContent)).toEqual(["Contratto.pdf", "Conti.xlsx"]);
    expect(inColumns.map((card) => card.dataset.cardState)).toEqual(["view", "view"]);
    // Le schede di prima se ne sono andate con le loro viste.
    expect(species.views.filter((one) => !one.destroyed)).toHaveLength(2);
    // Un annulla le rimette una sotto l'altra.
    expect(undo(view)).toBe(true);
    await settle();
    expect(view.state.doc.toString()).toBe(before);
    expect(parent.querySelector(".fub-columns")).toBeNull();
    expect(cardsIn(parent)).toHaveLength(2);
    expect(species.views.filter((one) => !one.destroyed)).toHaveLength(2);
  });

  it("una scheda in una colonna si attiva e scrive nel suo file; la nota resta com'è", async () => {
    const doc = "Prima\n\n> [!columns]\n> > [!column]\n> > ![[Contratto.pdf]]\n>\n> > [!column]\n> > ![[Conti.xlsx]]\n\nDopo\n";
    const { parent, view, cards, species } = rig(doc);
    await settle();
    const sheet = parent.querySelector<HTMLElement>('.fub-column > .live-card[data-card-kind="sheet"]')!;
    expect(sheet).not.toBeNull();
    sheet.querySelector<HTMLElement>(".live-card-body")!.click();
    expect(cards.activeCard()?.root).toBe(sheet);
    sheet.dispatchEvent(new KeyboardEvent("keydown", { key: "4", bubbles: true, cancelable: true }));
    const fake = species.views.find((one) => one.path.endsWith("Conti.xlsx") && !one.destroyed)!;
    expect(fake.text).toBe("A14");
    expect(view.state.doc.toString()).toBe(doc);
  });

  it("togliere una scheda da due colonne lascia l'altra da sola, fuori dal riquadro", async () => {
    const doc = "Prima\n\n> [!columns]\n> > [!column]\n> > ![[Vecchio.pdf]]\n>\n> > [!column]\n> > ![[Conti.xlsx]]\n\nDopo\n";
    const { parent, view } = rig(doc, { files: new Set(["Conti.xlsx"]) });
    await settle();
    const missing = parent.querySelector<HTMLElement>('.fub-column > .live-card[data-card-state="missing"]')!;
    expect(missing).not.toBeNull();
    missing.querySelector<HTMLElement>('[data-live-card-action="remove"]')!.click();
    expect(view.state.doc.toString()).toBe("Prima\n\n![[Conti.xlsx]]\n\nDopo\n");
  });

  it("le colonne si tolgono una alla volta", () => {
    const three = columnsOf(["A", "B", "C"]);
    const state = EditorState.create({ doc: three });
    const spec = removeColumnAt(state, three.indexOf("B.pdf"))!;
    expect(state.update(spec).state.doc.toString()).toBe(columnsOf(["A", "C"]));
    expect(removeColumnAt(EditorState.create({ doc: "![[A.pdf]]" }), 2)).toBeNull();
  });

  it("cinque schede: al più quattro colonne, e la voce spenta lo dice", () => {
    const full = mdState(`![[E.pdf]]\n\n${columnsOf(["A", "B", "C", "D"])}\n`);
    expect(besideCardAt(full, 0)).toBe("full");
    const host: BlockGroupHost = {
      read: (read) => read(full),
      write: () => false,
      view: () => false,
      editable: () => true,
      copy() {},
      openLink() {},
    };
    const beside = besideItem(host, 0);
    expect(beside.enabled).toBe(false);
    expect(beside.description).toBe("Le colonne accanto sono già quattro: di più non ci stanno.");
    // Tre colonne prendono la quinta scheda, in testa.
    const room = mdState(`![[E.pdf]]\n\n${columnsOf(["A", "B", "C"])}\n`);
    const spec = besideCardAt(room, 0);
    if (spec === null || spec === "full") throw new Error("le colonne avevano posto");
    const after = room.update(spec).state.doc.toString();
    expect(after.match(/\[!column\]/g)).toHaveLength(4);
    expect(after.indexOf("E.pdf")).toBeLessThan(after.indexOf("A.pdf"));
    // Senza una scheda accanto, niente.
    expect(besideCardAt(mdState("Testo\n\n![[E.pdf]]\n\nAltro testo\n"), 7)).toBeNull();
  });
});
