// @vitest-environment happy-dom
// Le schede vive della tela: le celle di un foglio (T42), i file che non si mostrano (T93), i livelli di dettaglio (T54), cerca (T60), la testata (T22).
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { WHEEL_SETTLE_MS, type CanvasCards } from "./engine";
import { LIVE_ZOOM_MIN, type CardContext, type CardMode, type CardRenderer, type CardView } from "../core/cards/contract";
import type { CanvasNode } from "./model";
import { CITATIONS_SETTLE_MS } from "./card-head";
import { pdfCardRenderer, type PdfCardPort } from "../core/cards/kinds/pdf";
import type { PdfEngine } from "../media/pdf-view";
import { canvasCoreReady } from "./wasm/core";
import { canvasViewKey, createCanvasViewMemory } from "./view-state";
import { setReducedMotionPreference } from "../../theme/reduced-motion";
import { BOARD, Mounted, TWO, actionOf, activeOf, boardSource, bodyOf, cameraOf, cameraValues, card, cardsOf, cardsWith, editingOf, enterWithKeys, fakeFiles, fakeRenderer, focused, image, liveOf, modeRenderer, mounted, optionsBar, panStart, press, probeRenderer, readNodes, settle, syncNode, wheelOn, wheelTick, zoomOf } from "./engine-cards-test-support";

beforeAll(async () => {
  await canvasCoreReady();
});

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

/**
 * Un renderer di fogli che scrive (T42): `edit(from)` ricorda l'elemento sotto
 * il gesto, e la prova risponde da sé come la scheda di foglio vera, con la
 * cella attiva e la sua formula come contesto.
 */
function sheetWriterRenderer() {
  const edits: (EventTarget | null | undefined)[] = [];
  const contexts = new Map<string, CardContext>();
  const renderer: CardRenderer = {
    kinds: ["sheet"],
    mount(node: CanvasNode, host: HTMLElement, _mode: CardMode, context: CardContext): CardView {
      contexts.set(node.id, context);
      const cell = document.createElement("div");
      cell.className = "probe-cell";
      cell.tabIndex = -1;
      host.append(cell);
      return {
        setMode: () => {},
        enter: () => true,
        leave: () => {},
        edit: (from) => {
          edits.push(from);
          return true;
        },
        destroy: () => {},
      };
    },
  };
  return { renderer, edits, contexts };
}

const SHEET_BOARD = [
  { id: "s", type: "file", x: 0, y: 0, width: 400, height: 200, file: "Conti/voti.xlsx" },
];

function formulaItem(host: HTMLElement): HTMLElement | null {
  return host.querySelector<HTMLElement>('.canvas-options [data-option="formula"]');
}

describe("scrivere nelle celle di una scheda di foglio (T42)", () => {
  it("il doppio clic su una cella scrive da quella cella; la cella e la formula vanno nella riga delle opzioni e nella banda", () => {
    const sheet = sheetWriterRenderer();
    const { engine, host } = mounted(boardSource(SHEET_BOARD), { cards: cardsOf(sheet.renderer) });
    const cell = card(host, "s").querySelector<HTMLElement>(".probe-cell")!;
    cell.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    // La scheda sa quale cella c'era sotto il gesto.
    expect(sheet.edits).toEqual([cell]);
    expect(formulaItem(host)).toBeNull();

    const context = sheet.contexts.get("s")!;
    context.writing?.({ toolbar: null, context: { cell: "B4", formula: "=SUM(B2:B3)" } });
    expect(editingOf(host)).toEqual(["s"]);
    const item = formulaItem(host)!;
    expect(item.querySelector(".grid-cell-name")?.textContent).toBe("B4");
    expect(item.querySelector(".canvas-formula-text")?.textContent).toBe("=SUM(B2:B3)");
    expect(optionsBar(host)).toBeNull();
    const writing = () => engine.statusItems().find((entry) => entry.id === "writing")?.text ?? null;
    expect(writing()).toMatch(/voti\.xlsx · B4$/);

    // Un'altra cella: lo stesso elemento, col testo nuovo.
    context.writing?.({ toolbar: null, context: { cell: "C4", formula: "#DIV/0!" } });
    expect(formulaItem(host)).toBe(item);
    expect(item.querySelector(".grid-cell-name")?.textContent).toBe("C4");
    expect(item.querySelector(".canvas-formula-text")?.textContent).toBe("#DIV/0!");
    expect(writing()).toMatch(/voti\.xlsx · C4$/);

    // Il secondo Esc (il primo l'ha preso la cella) esce dalla scrittura.
    expect(press(cell, "Escape").defaultPrevented).toBe(true);
    expect(editingOf(host)).toEqual([]);
    expect(formulaItem(host)).toBeNull();
    expect(writing()).toBeNull();
    engine.destroy();
  });

  it("un Esc che la cella ha già usato non esce dalla scrittura", () => {
    const sheet = sheetWriterRenderer();
    const { engine, host } = mounted(boardSource(SHEET_BOARD), { cards: cardsOf(sheet.renderer) });
    const cell = card(host, "s").querySelector<HTMLElement>(".probe-cell")!;
    cell.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    sheet.contexts.get("s")!.writing?.({ toolbar: null, context: { cell: "A1", formula: "" } });
    cell.addEventListener("keydown", (event) => event.preventDefault(), { once: true });
    press(cell, "Escape");
    expect(editingOf(host)).toEqual(["s"]);
    expect(activeOf(host)).toEqual(["s"]);
    engine.destroy();
  });

  it("il doppio clic scesa sul corpo della scheda (il primo clic l'ha accesa) scrive dalla cella sotto il puntatore", () => {
    const sheet = sheetWriterRenderer();
    const { engine, host } = mounted(boardSource(SHEET_BOARD), { cards: cardsOf(sheet.renderer) });
    const cell = card(host, "s").querySelector<HTMLElement>(".probe-cell")!;
    const body = card(host, "s").querySelector<HTMLElement>(".canvas-card-body")!;
    const pointing = vi.spyOn(document, "elementFromPoint").mockReturnValue(cell);
    body.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, clientX: 40, clientY: 60 }));
    expect(pointing).toHaveBeenCalledWith(40, 60);
    expect(sheet.edits).toEqual([cell]);
    pointing.mockRestore();
    engine.destroy();
  });

  it("Invio sulla scheda scelta scrive senza una cella sotto il gesto", () => {
    const sheet = sheetWriterRenderer();
    const { engine, host } = mounted(boardSource(SHEET_BOARD), { cards: cardsOf(sheet.renderer) });
    enterWithKeys(host, "s");
    expect(sheet.edits).toEqual([undefined]);
    engine.destroy();
  });

  it("una scrittura senza contesto torna alla riga dello strumento", () => {
    const sheet = sheetWriterRenderer();
    const { engine, host } = mounted(boardSource(SHEET_BOARD), { cards: cardsOf(sheet.renderer) });
    card(host, "s").querySelector<HTMLElement>(".probe-cell")!.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    const context = sheet.contexts.get("s")!;
    context.writing?.({ toolbar: null, context: { cell: "A1", formula: "Voce" } });
    expect(formulaItem(host)).not.toBeNull();
    context.writing?.({ toolbar: null, context: null });
    expect(formulaItem(host)).toBeNull();
    expect(engine.statusItems().find((entry) => entry.id === "writing")?.text).toMatch(/voti\.xlsx$/);
    engine.destroy();
  });
});

describe("il gesto su una scheda di file che non si mostra (T93)", () => {
  /**
   * Un renderer finto che dice in `data-card-state` che cosa mostra la scheda,
   * come la nota, l'immagine e il foglio (la radice della vista). `enter()`
   * c'è solo con la resa, come la nota.
   */
  function stateRenderer(states: Record<string, string>) {
    const mounts: Mounted[] = [];
    const renderer: CardRenderer = {
      kinds: ["note", "image", "pdf", "web"],
      mount(node: CanvasNode, host: HTMLElement, mode: CardMode, context: CardContext): CardView {
        const record: Mounted = { node: node.id, file: node.file, url: node.url, host, mode, context, destroyed: 0 };
        mounts.push(record);
        const root = document.createElement("div");
        root.className = "state-card";
        root.dataset.cardState = states[node.id] ?? "content";
        host.append(root);
        return {
          setMode: () => {},
          enter: () => root.dataset.cardState === "content",
          destroy: () => {
            record.destroyed++;
          },
        };
      },
    };
    return { renderer, mounts };
  }

  /** Il doppio clic col mouse sulla scheda `id`. */
  function dblclickOn(host: HTMLElement, id: string): void {
    card(host, id).dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
  }

  /** Lascia correre tutto ciò che è in attesa, anche le letture e i caricamenti a catena. */
  async function flush(): Promise<void> {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }

  /** Le schede di file con il renderer vero del PDF: `load` dice se il file si legge. */
  function pdfCards(load: PdfCardPort["load"]): CanvasCards {
    return cardsOf(pdfCardRenderer({ read: async () => new Uint8Array([1]), load, watch: () => () => {} }));
  }

  /** Un PDF di una pagina che si legge, senza disegnare niente davvero. */
  function readablePdf(): PdfEngine {
    return {
      pageCount: 1,
      search: async () => [],
      renderPage: async (_index, canvas) => {
        canvas.width = 1;
        canvas.height = 1;
      },
      pageSize: async () => [600, 800],
      renderArea: async () => true,
      destroy: () => {},
    };
  }

  /** Lo stato che la vista del PDF «p» dice in `data-card-state`. */
  function pdfStateOf(host: HTMLElement): string | undefined {
    return bodyOf(host, "p").querySelector<HTMLElement>(":scope > [data-card-state]")?.dataset.cardState;
  }

  it("doppio clic e Invio su una scheda mancante chiedono il file come «Ritrova…», senza aprire il campo", async () => {
    const files = fakeFiles();
    const { renderer, mounts } = fakeRenderer();
    const asked: (string | undefined)[] = [];
    let answer: string | null = null;
    const { engine, host, changes } = mounted(boardSource(), {
      cards: cardsWith(files, renderer),
      onPickFile: (name) => {
        asked.push(name);
        return answer;
      },
    });
    mounts[1]!.context.missing();
    // Un selettore annullato non cambia la scheda: resta mancante.
    dblclickOn(host, "i");
    await settle();
    expect(asked).toEqual(["foto.png"]);
    expect(host.querySelector(".canvas-field-editor")).toBeNull();
    expect(changes).toHaveLength(0);
    expect(card(host, "i").dataset.cardMissing).toBe("true");
    // Invio fa lo stesso; la scelta è un commit solo, che un annulla riporta.
    answer = "Archivio/foto.png";
    enterWithKeys(host, "i");
    await settle();
    expect(asked).toEqual(["foto.png", "foto.png"]);
    expect(host.querySelector(".canvas-field-editor")).toBeNull();
    expect(readNodes(engine.getDoc()).find((node) => node.id === "i")!.file).toBe("Archivio/foto.png");
    expect(changes).toHaveLength(1);
    expect(engine.undo()).toBe(true);
    expect(readNodes(engine.getDoc()).find((node) => node.id === "i")!.file).toBe("img/foto.png");
    engine.destroy();
  });

  it.each(["unreadable", "unavailable", "too-large"])("doppio clic e Invio su una scheda il cui file c'è ma non si mostra (%s) aprono il file, senza il campo", (state) => {
    const { renderer } = stateRenderer({ n: state });
    const opened: string[] = [];
    const { engine, host } = mounted(boardSource(), {
      cards: cardsOf(renderer),
      onOpenPath: (path) => {
        opened.push(path);
      },
    });
    dblclickOn(host, "n");
    expect(opened).toEqual(["/Note/idea.md"]);
    enterWithKeys(host, "n");
    expect(opened).toEqual(["/Note/idea.md", "/Note/idea.md"]);
    expect(host.querySelector(".canvas-field-editor")).toBeNull();
    expect(activeOf(host)).toEqual([]);
    engine.destroy();
  });

  it("in sola lettura la scheda mancante dice «File mancante» senza chiedere il file; la illeggibile si apre lo stesso, senza scrivere", () => {
    const files = fakeFiles();
    const { renderer, mounts } = stateRenderer({ n: "unreadable" });
    const asked: (string | undefined)[] = [];
    const opened: string[] = [];
    const { engine, host, changes } = mounted(boardSource(), {
      cards: cardsWith(files, renderer),
      onPickFile: (name) => {
        asked.push(name);
        return "Archivio/foto.png";
      },
      onOpenPath: (path) => {
        opened.push(path);
      },
    });
    mounts.find((entry) => entry.node === "i")!.context.missing();
    engine.setReadOnly(true);
    dblclickOn(host, "i");
    expect(asked).toEqual([]);
    expect(host.querySelector(".canvas-intake-error")?.textContent).toBe("File mancante: img/foto.png");
    dblclickOn(host, "n");
    expect(opened).toEqual(["/Note/idea.md"]);
    expect(activeOf(host)).toEqual([]);
    expect(changes).toHaveLength(0);
    engine.destroy();
  });

  it("senza un selettore di file la scheda mancante dice «File mancante», come in sola lettura", () => {
    const files = fakeFiles();
    const { renderer, mounts } = fakeRenderer();
    const { engine, host, changes } = mounted(boardSource(), { cards: cardsWith(files, renderer), onPickFile: undefined });
    mounts[1]!.context.missing();
    dblclickOn(host, "i");
    expect(host.querySelector(".canvas-field-editor")).toBeNull();
    expect(host.querySelector(".canvas-intake-error")?.textContent).toBe("File mancante: img/foto.png");
    expect(card(host, "i").dataset.cardMissing).toBe("true");
    expect(changes).toHaveLength(0);
    engine.destroy();
  });

  it("una scheda in caricamento non apre il campo, e il gesto non fa niente finché la resa non arriva", () => {
    const { renderer } = stateRenderer({ n: "loading" });
    const opened: string[] = [];
    const { engine, host } = mounted(boardSource(), {
      cards: cardsOf(renderer),
      onOpenPath: (path) => {
        opened.push(path);
      },
    });
    dblclickOn(host, "n");
    enterWithKeys(host, "n");
    expect(host.querySelector(".canvas-field-editor")).toBeNull();
    expect(opened).toEqual([]);
    expect(activeOf(host)).toEqual([]);
    // La resa arriva: il doppio clic entra, come su una nota viva.
    bodyOf(host, "n").querySelector<HTMLElement>("[data-card-state]")!.dataset.cardState = "content";
    dblclickOn(host, "n");
    expect(activeOf(host)).toEqual(["n"]);
    engine.destroy();
  });

  it("il doppio clic su una scheda di file viva che non entra apre il campo, come prima", () => {
    const { renderer } = probeRenderer();
    const { engine, host } = mounted(boardSource(BOARD), { cards: cardsOf(renderer) });
    dblclickOn(host, "p");
    expect(host.querySelector(".canvas-field-editor")).not.toBeNull();
    expect(activeOf(host)).toEqual([]);
    engine.destroy();
  });

  it("il doppio clic su «Ritrova…» non aggiunge un selettore: il pulsante fa la sua azione a ogni clic", () => {
    const files = fakeFiles();
    const { renderer, mounts } = fakeRenderer();
    const asked: (string | undefined)[] = [];
    const { engine, host } = mounted(boardSource(), {
      cards: cardsWith(files, renderer),
      onPickFile: (name) => {
        asked.push(name);
        return null;
      },
    });
    mounts[1]!.context.missing();
    // Due clic sul pulsante e poi il doppio clic, come il mouse: un selettore per clic, non di più.
    const relink = actionOf(host, "i", "relink")!;
    relink.click();
    relink.click();
    relink.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    expect(asked).toEqual(["foto.png", "foto.png"]);
    expect(host.querySelector(".canvas-field-editor")).toBeNull();
    engine.destroy();
  });

  it("un PDF che non si legge apre il file col doppio clic e con Invio, senza il campo", async () => {
    const opened: string[] = [];
    const { engine, host } = mounted(boardSource(BOARD), {
      cards: pdfCards(async () => {
        throw new Error("PasswordException");
      }),
      onOpenPath: (path) => {
        opened.push(path);
      },
    });
    await flush();
    expect(pdfStateOf(host)).toBe("unreadable");
    dblclickOn(host, "p");
    expect(opened).toEqual(["/doc/libro.pdf"]);
    enterWithKeys(host, "p");
    expect(opened).toEqual(["/doc/libro.pdf", "/doc/libro.pdf"]);
    expect(host.querySelector(".canvas-field-editor")).toBeNull();
    engine.destroy();
  });

  it("un PDF in caricamento non apre il campo, e il doppio clic e Invio non fanno niente", () => {
    const opened: string[] = [];
    const { engine, host } = mounted(boardSource(BOARD), {
      cards: pdfCards(() => new Promise<PdfEngine>(() => {})),
      onOpenPath: (path) => {
        opened.push(path);
      },
    });
    expect(pdfStateOf(host)).toBe("loading");
    dblclickOn(host, "p");
    enterWithKeys(host, "p");
    expect(host.querySelector(".canvas-field-editor")).toBeNull();
    expect(opened).toEqual([]);
    engine.destroy();
  });

  it("un PDF che si legge apre il campo col doppio clic, come prima", async () => {
    const { engine, host } = mounted(boardSource(BOARD), { cards: pdfCards(async () => readablePdf()) });
    await flush();
    expect(pdfStateOf(host)).toBe("content");
    dblclickOn(host, "p");
    expect(host.querySelector(".canvas-field-editor")).not.toBeNull();
    engine.destroy();
  });
});

describe("i livelli di dettaglio (T54)", () => {
  /** Il `data-card-detail` di ogni scheda, per id; `-` se non c'è. */
  function detailsOf(host: HTMLElement): Record<string, string> {
    const out: Record<string, string> = {};
    for (const el of host.querySelectorAll<HTMLElement>(".canvas-node")) out[el.dataset.node!] = el.dataset.cardDetail ?? "-";
    return out;
  }

  /** Conta i cambi di `data-card-detail` per scheda, da adesso. */
  function watchDetails(host: HTMLElement): { readonly writes: Map<string, number>; readonly stop: () => void } {
    const writes = new Map<string, number>();
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        const id = (record.target as HTMLElement).dataset.node!;
        writes.set(id, (writes.get(id) ?? 0) + 1);
      }
    });
    for (const el of host.querySelectorAll(".canvas-node")) observer.observe(el, { attributes: true, attributeFilter: ["data-card-detail"] });
    return { writes, stop: () => observer.disconnect() };
  }

  function detailZoomOf(host: HTMLElement): string {
    return host.querySelector<HTMLElement>(".canvas-stage")!.style.getPropertyValue("--canvas-detail-zoom");
  }

  /** Scatti di Ctrl+rotella indietro, senza fermarsi, finché lo zoom scende sotto `below`. */
  function zoomOutUntil(host: HTMLElement, viewport: HTMLElement, below: number, check: () => void = () => {}): void {
    for (let tick = 0; tick < 200 && zoomOf(host) >= below; tick++) {
      wheelTick(viewport, false);
      vi.advanceTimersByTime(WHEEL_SETTLE_MS - 50);
      check();
    }
    expect(zoomOf(host)).toBeLessThan(below);
  }

  function zoomInWithKeys(host: HTMLElement, viewport: HTMLElement, atLeast: number): void {
    for (let step = 0; step < 50 && zoomOf(host) < atLeast; step++) {
      viewport.dispatchEvent(new KeyboardEvent("keydown", { key: "+", ctrlKey: true, bubbles: true, cancelable: true }));
    }
    expect(zoomOf(host)).toBeGreaterThanOrEqual(atLeast);
  }

  const MIXED = [
    image("a", 0, 0),
    image("b", 400, 0),
    { id: "t", type: "text", x: 0, y: 200, width: 200, height: 100, text: "## Domande per giovedì\naltro" },
    { id: "g", type: "group", x: -40, y: -40, width: 700, height: 400, label: "Statistica" },
    { id: "f", type: "file", x: 400, y: 200, width: 200, height: 100, file: "dati/misure.csv" },
  ];
  const NEAR = { a: "-", b: "-", t: "-", g: "-", f: "-" };

  it("ogni scheda ha il titolo grande, nascosto, prima dell'inchiostro; da vicino nessun attributo", () => {
    const { renderer } = modeRenderer();
    const { engine, host } = mounted(boardSource(MIXED), { cards: cardsOf(renderer) });
    expect(zoomOf(host)).toBeGreaterThanOrEqual(LIVE_ZOOM_MIN);
    expect(detailsOf(host)).toEqual(NEAR);
    const far = (id: string) => card(host, id).querySelector<HTMLElement>(":scope > .canvas-node-far")!;
    expect(far("a").textContent).toBe("a.png");
    expect(far("t").textContent).toBe("Domande per giovedì");
    expect(far("g").textContent).toBe("Statistica");
    expect(far("f").textContent).toBe("misure.csv");
    expect(far("a").getAttribute("aria-hidden")).toBe("true");
    // Dopo il corpo: l'inchiostro della scheda, che arriva dopo, gli resta sopra.
    const children = [...card(host, "a").children];
    expect(children.indexOf(far("a"))).toBeGreaterThan(children.indexOf(bodyOf(host, "a")));
    // Il titolo segue la scheda che cambia.
    syncNode(engine, "t", { text: "Altro titolo" });
    expect(far("t").textContent).toBe("Altro titolo");
    engine.destroy();
  });

  it("l'attributo cambia solo a fine gesto, mai durante, e una volta sola per scheda", async () => {
    vi.useFakeTimers();
    try {
      const { renderer } = modeRenderer();
      const { engine, host, viewport } = mounted(boardSource(MIXED), { cards: cardsOf(renderer) });
      vi.spyOn(viewport, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 800, 600));
      // Inquadrate: «a» e «b» sono vive, quindi viste da vicino.
      expect(liveOf(host)).toEqual(["a", "b"]);
      const before = detailZoomOf(host);
      const watch = watchDetails(host);
      // Un gesto solo, che attraversa 0,35 e 0,15: niente cambia durante.
      zoomOutUntil(host, viewport, 0.15, () => {
        expect(detailsOf(host)).toEqual(NEAR);
        expect(detailZoomOf(host)).toBe(before);
      });
      await settle();
      expect(watch.writes.size).toBe(0);
      vi.advanceTimersByTime(WHEEL_SETTLE_MS);
      // A gesto finito: tutte blocchi, un cambio per scheda, e la misura del titolo.
      expect(detailsOf(host)).toEqual({ a: "block", b: "block", t: "block", g: "block", f: "block" });
      expect(Number(detailZoomOf(host))).toBeCloseTo(zoomOf(host));
      await settle();
      expect([...watch.writes.entries()].sort()).toEqual([["a", 1], ["b", 1], ["f", 1], ["g", 1], ["t", 1]]);
      // Dai tasti lo zoom è un gesto finito: risale fra 0,15 e 0,35, le due
      // viste da vicino restano ferme, le altre mostrano il titolo.
      zoomInWithKeys(host, viewport, 0.15);
      expect(zoomOf(host)).toBeLessThan(LIVE_ZOOM_MIN);
      expect(detailsOf(host)).toEqual({ a: "still", b: "still", t: "far", g: "far", f: "far" });
      // Di nuovo da vicino: l'attributo va via.
      zoomInWithKeys(host, viewport, LIVE_ZOOM_MIN);
      expect(detailsOf(host)).toEqual(NEAR);
      watch.stop();
      engine.destroy();
    } finally {
      vi.useRealTimers();
    }
  });

  it("una scheda mai vista da vicino mostra il titolo; lo spostamento non riscrive niente", async () => {
    vi.useFakeTimers();
    try {
      const { renderer } = modeRenderer();
      const { engine, host, viewport } = mounted(boardSource(TWO), { cards: cardsOf(renderer) });
      vi.spyOn(viewport, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 800, 600));
      // «c» arriva lontana: nasce ferma e non è mai viva.
      engine.syncDoc(boardSource([...TWO, image("c", 50_000, 0)]));
      zoomOutUntil(host, viewport, LIVE_ZOOM_MIN);
      vi.advanceTimersByTime(WHEEL_SETTLE_MS);
      expect(zoomOf(host)).toBeGreaterThanOrEqual(0.15);
      const seen = detailsOf(host);
      expect(seen).toEqual({ a: "still", b: "still", c: "far" });
      const watch = watchDetails(host);
      const up = panStart(viewport, -300, 0);
      expect(detailsOf(host)).toEqual(seen);
      up();
      expect(detailsOf(host)).toEqual(seen);
      await settle();
      expect(watch.writes.size).toBe(0);
      watch.stop();
      engine.destroy();
    } finally {
      vi.useRealTimers();
    }
  });

  it("la scheda attiva resta come da vicino, e uscendo diventa ferma", () => {
    vi.useFakeTimers();
    try {
      const { renderer } = probeRenderer();
      const { engine, host, viewport } = mounted(boardSource(BOARD), { cards: cardsOf(renderer) });
      enterWithKeys(host, "n");
      for (let tick = 0; tick < 12; tick++) wheelOn(viewport, true);
      vi.advanceTimersByTime(WHEEL_SETTLE_MS);
      expect(zoomOf(host)).toBeLessThan(LIVE_ZOOM_MIN);
      expect(zoomOf(host)).toBeGreaterThanOrEqual(0.15);
      expect(activeOf(host)).toEqual(["n"]);
      expect(detailsOf(host)).toEqual({ n: "-", p: "still", i: "still", t: "far" });
      press(focused(), "Escape");
      expect(activeOf(host)).toEqual([]);
      expect(detailsOf(host).n).toBe("still");
      engine.destroy();
    } finally {
      vi.useRealTimers();
    }
  });

  // 2000 schede in happy-dom sono lavoro di CPU, non un'attesa: niente orologio
  // (i timer sono finti), nessun evento da aspettare. Da sola gira sotto il
  // secondo; su una macchina molto carica i 5 s di default li superava. Il tetto
  // largo non decide l'esito: la prova conta le scritture, non i millisecondi.
  it("2000 schede al 5%: un solo cambio di attributo per scheda, a fine gesto", { timeout: 60_000 }, async () => {
    vi.useFakeTimers();
    try {
      const { renderer } = modeRenderer();
      // 50 × 40 schede di 40 × 40 ogni 50.
      const many = Array.from({ length: 2000 }, (_, index) => image(`c${index}`, (index % 50) * 50, Math.floor(index / 50) * 50, 40, 40));
      const { engine, host, viewport } = mounted(boardSource(many), { cards: cardsOf(renderer) });
      vi.spyOn(viewport, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 800, 600));
      const watch = watchDetails(host);
      zoomOutUntil(host, viewport, 0.06);
      await settle();
      expect(watch.writes.size).toBe(0);
      vi.advanceTimersByTime(WHEEL_SETTLE_MS);
      await settle();
      expect(zoomOf(host)).toBeLessThan(0.06);
      expect(watch.writes.size).toBe(2000);
      expect([...watch.writes.values()].every((count) => count === 1)).toBe(true);
      expect(Object.values(detailsOf(host)).every((detail) => detail === "block")).toBe(true);
      watch.stop();
      engine.destroy();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("cerca nella lavagna (T60)", () => {
  afterEach(() => {
    setReducedMotionPreference(false);
  });

  /** Tre schede di testo in riga, molto distanti, e una nota: la tela le inquadra tutte, piccole. */
  const FIND_BOARD = [
    { id: "a", type: "text", x: 0, y: 0, width: 200, height: 100, text: "La deviazione standard" },
    { id: "b", type: "text", x: 1600, y: 0, width: 200, height: 100, text: "La media" },
    { id: "c", type: "text", x: 3200, y: 0, width: 200, height: 100, text: "Deviazione e varianza" },
    { id: "n", type: "file", x: 1600, y: 800, width: 200, height: 100, file: "Note/esercizi.md" },
  ];

  /** Il segno della ricerca di ogni scheda: `veiled`, il valore di `data-card-found`, o `-`. */
  function marksOf(host: HTMLElement): Record<string, string> {
    const out: Record<string, string> = {};
    for (const el of host.querySelectorAll<HTMLElement>(".canvas-node")) {
      out[el.dataset.node!] = el.hasAttribute("data-card-veiled") ? "veiled" : el.dataset.cardFound ?? "-";
    }
    return out;
  }

  function searchFor(host: HTMLElement, text: string): HTMLInputElement {
    const input = host.querySelector<HTMLInputElement>(".canvas-find-input")!;
    input.value = text;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    return input;
  }

  function press(input: HTMLInputElement, key: string, init: KeyboardEventInit = {}): void {
    input.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init }));
  }

  /** Il centro della vista di prova (800 × 600) in coordinate della lavagna. */
  function viewCenter(host: HTMLElement): { x: number; y: number } {
    const view = cameraValues(host);
    return { x: (400 - view.x) / view.zoom, y: (300 - view.y) / view.zoom };
  }

  it("`find()` apre la barra col fuoco nel campo; le schede senza risultati si velano, la ricerca vuota e Esc tolgono il velo", () => {
    const { engine, host } = mounted(boardSource(FIND_BOARD), { findNotes: async () => new Set() });
    const bar = host.querySelector<HTMLElement>(".canvas-find")!;
    expect(bar.hidden).toBe(true);
    expect(engine.find()).toBe(true);
    expect(bar.hidden).toBe(false);
    expect(document.activeElement).toBe(host.querySelector(".canvas-find-input"));
    const input = searchFor(host, "deviazione");
    expect(marksOf(host)).toEqual({ a: "current", b: "veiled", c: "match", n: "veiled" });
    searchFor(host, "");
    expect(marksOf(host)).toEqual({ a: "-", b: "-", c: "-", n: "-" });
    searchFor(host, "covarianza");
    expect(marksOf(host)).toEqual({ a: "veiled", b: "veiled", c: "veiled", n: "veiled" });
    searchFor(host, "media");
    press(input, "Escape");
    expect(bar.hidden).toBe(true);
    expect(marksOf(host)).toEqual({ a: "-", b: "-", c: "-", n: "-" });
    // Il fuoco torna alla lavagna.
    expect(document.activeElement).toBe(host.querySelector(".canvas-viewport"));
    engine.destroy();
  });

  it("una scheda che nasce o cambia con la barra aperta prende il suo segno", () => {
    const { engine, host } = mounted(boardSource(FIND_BOARD), { findNotes: async () => new Set() });
    engine.find();
    searchFor(host, "deviazione");
    syncNode(engine, "b", { text: "Ancora la deviazione" });
    expect(marksOf(host)).toEqual({ a: "current", b: "match", c: "match", n: "veiled" });
    engine.syncDoc(boardSource([...FIND_BOARD, { id: "d", type: "text", x: 0, y: 800, width: 200, height: 100, text: "altro" }]));
    expect(marksOf(host).d).toBe("veiled");
    engine.destroy();
  });

  it("il velo e i livelli di dettaglio (T54) convivono: la scheda lontana tiene tutti e due gli attributi", () => {
    const { engine, host, viewport } = mounted(boardSource(FIND_BOARD), { findNotes: async () => new Set() });
    engine.find();
    searchFor(host, "deviazione");
    for (let step = 0; step < 50 && zoomOf(host) >= 0.15; step++) {
      viewport.dispatchEvent(new KeyboardEvent("keydown", { key: "-", ctrlKey: true, bubbles: true, cancelable: true }));
    }
    expect(zoomOf(host)).toBeLessThan(0.15);
    expect(card(host, "a").dataset.cardDetail).toBe("block");
    expect(card(host, "a").dataset.cardFound).toBe("current");
    expect(card(host, "b").dataset.cardDetail).toBe("block");
    expect(card(host, "b").hasAttribute("data-card-veiled")).toBe(true);
    engine.destroy();
  });

  it("Invio salta al risultato e lo mette al centro, Maiusc+Invio torna; Esc lascia la vista dov'è e Indietro torna al punto di partenza", () => {
    setReducedMotionPreference(true);
    const { engine, host } = mounted(boardSource(FIND_BOARD), { findNotes: async () => new Set() });
    const start = cameraOf(host);
    engine.find();
    const input = searchFor(host, "deviazione");
    // Scrivere non muove la vista.
    expect(cameraOf(host)).toBe(start);
    press(input, "Enter");
    expect(viewCenter(host).x).toBeCloseTo(100, 3);
    expect(viewCenter(host).y).toBeCloseTo(50, 3);
    press(input, "Enter");
    expect(viewCenter(host).x).toBeCloseTo(3300, 3);
    expect(marksOf(host)).toEqual({ a: "match", b: "veiled", c: "current", n: "veiled" });
    press(input, "Enter", { shiftKey: true });
    expect(viewCenter(host).x).toBeCloseTo(100, 3);
    const arrived = cameraOf(host);
    press(input, "Escape");
    expect(cameraOf(host)).toBe(arrived);
    // Ogni risultato è un salto (T56): Indietro li disfa fino al punto di partenza.
    expect(engine.jumpBack()).toBe(true);
    expect(engine.jumpBack()).toBe(true);
    expect(engine.jumpBack()).toBe(true);
    expect(cameraOf(host)).toBe(start);
    expect(engine.jumpBack()).toBe(false);
    engine.destroy();
  });

  it("il contenuto delle note: una richiesta all'indice con le note della lavagna, e la scheda della nota trovata è un risultato", async () => {
    vi.useFakeTimers();
    try {
      const findNotes = vi.fn(async (_query: string, notes: readonly string[]) => new Set(notes));
      const { engine, host } = mounted(boardSource(FIND_BOARD), { findNotes });
      engine.find();
      searchFor(host, "esercizio");
      expect(marksOf(host).n).toBe("veiled");
      vi.advanceTimersByTime(200);
      expect(findNotes).toHaveBeenCalledTimes(1);
      expect(findNotes).toHaveBeenCalledWith("esercizio", ["Note/esercizi.md"]);
      await settle();
      expect(marksOf(host)).toEqual({ a: "veiled", b: "veiled", c: "veiled", n: "current" });
      expect(host.querySelector(".canvas-find-count")!.textContent).toBe("1 di 1");
      engine.destroy();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("la testata: «↩ N» e le gemelle (T22)", () => {
  /** Una nota due volte (la seconda lontana, fuori dalla vista), un'immagine e un testo. */
  const TWINS = [
    { id: "a", type: "file", x: 0, y: 0, width: 240, height: 160, file: "Note/idea.md" },
    { id: "b", type: "file", x: 40000, y: 30000, width: 240, height: 160, file: "Note/idea.md", subpath: "#Titolo" },
    { id: "c", type: "file", x: 320, y: 0, width: 240, height: 160, file: "img/foto.png" },
    { id: "t", type: "text", x: 0, y: 240, width: 240, height: 120, text: "testo" },
  ];

  const twinsButton = (host: HTMLElement, id: string): HTMLButtonElement | null =>
    card(host, id).querySelector<HTMLButtonElement>(":scope > .canvas-node-handle > .canvas-node-twins");
  const lit = (host: HTMLElement): string[] =>
    [...host.querySelectorAll<HTMLElement>(".canvas-node[data-card-twin]")].map((el) => el.dataset.node!).sort();

  it("«×2» sulle schede dello stesso file, dopo il titolo; il `subpath` non conta", () => {
    const { engine, host } = mounted(boardSource(TWINS));
    expect(twinsButton(host, "a")?.textContent).toBe("×2");
    expect(twinsButton(host, "b")?.textContent).toBe("×2");
    expect(twinsButton(host, "a")?.getAttribute("aria-label")).toBe("2 copie su questa lavagna");
    expect(twinsButton(host, "c")).toBeNull();
    expect(twinsButton(host, "t")).toBeNull();
    expect(twinsButton(host, "a")?.previousElementSibling?.classList.contains("canvas-node-title")).toBe(true);
    engine.destroy();
  });

  it("al passaggio su «×2» le gemelle si illuminano, anche fuori vista; uscendo si spengono", () => {
    const { engine, host } = mounted(boardSource(TWINS));
    const button = twinsButton(host, "a")!;
    button.dispatchEvent(new PointerEvent("pointerover", { bubbles: true }));
    expect(lit(host)).toEqual(["a", "b"]);
    // Dentro il pulsante non è uscire.
    button.dispatchEvent(new PointerEvent("pointerout", { bubbles: true, relatedTarget: button.firstChild }));
    expect(lit(host)).toEqual(["a", "b"]);
    button.dispatchEvent(new PointerEvent("pointerout", { bubbles: true, relatedTarget: card(host, "c") }));
    expect(lit(host)).toEqual([]);
    engine.destroy();
  });

  it("col fuoco su «×2» le gemelle si illuminano e la banda dice quante sono; un clic sulla voce le inquadra", () => {
    // Una scheda lontana dall'altra parte: tutta la lavagna non è le sole gemelle.
    const far = { id: "z", type: "text", x: -90000, y: -90000, width: 240, height: 120, text: "lontano" };
    const { engine, host } = mounted(boardSource([...TWINS, far]));
    expect(engine.statusItems().some((item) => item.id === "twins")).toBe(false);
    twinsButton(host, "b")!.focus();
    expect(lit(host)).toEqual(["a", "b"]);
    const item = engine.statusItems().find((entry) => entry.id === "twins");
    expect(item?.text).toBe("2 copie di questo file");
    const stage = host.querySelector<HTMLElement>(".canvas-stage")!;
    const before = stage.style.transform;
    item!.open!();
    expect(stage.style.transform).not.toBe(before);
    twinsButton(host, "b")!.blur();
    expect(lit(host)).toEqual([]);
    engine.destroy();
  });

  it("la scheda scelta da sola con delle gemelle: la banda le dice", () => {
    const { engine, host } = mounted(boardSource(TWINS));
    card(host, "a").focus();
    expect(engine.statusItems().find((entry) => entry.id === "twins")?.text).toBe("2 copie di questo file");
    card(host, "c").focus();
    expect(engine.statusItems().some((entry) => entry.id === "twins")).toBe(false);
    engine.destroy();
  });

  it("«×30» su trenta copie, tutte illuminate insieme", () => {
    const copies = Array.from({ length: 30 }, (_, index) => ({
      id: `n${index}`, type: "file", x: (index % 6) * 300, y: Math.floor(index / 6) * 200, width: 240, height: 160, file: "Note/idea.md",
    }));
    const { engine, host } = mounted(boardSource(copies));
    expect(twinsButton(host, "n29")?.textContent).toBe("×30");
    twinsButton(host, "n7")!.dispatchEvent(new PointerEvent("pointerover", { bubbles: true }));
    expect(lit(host)).toHaveLength(30);
    engine.destroy();
  });

  it("la copia tolta mentre è illuminata: le altre si spengono e «×N» sparisce", () => {
    const { engine, host } = mounted(boardSource(TWINS));
    twinsButton(host, "a")!.dispatchEvent(new PointerEvent("pointerover", { bubbles: true }));
    expect(lit(host)).toEqual(["a", "b"]);
    engine.syncDoc(boardSource(TWINS.filter((node) => node.id !== "a")));
    expect(lit(host)).toEqual([]);
    expect(twinsButton(host, "b")).toBeNull();
    expect(engine.statusItems().some((entry) => entry.id === "twins")).toBe(false);
    engine.destroy();
  });

  it("con tre copie, togliere quella da cui si erano illuminate spegne le altre, che restano «×2»", () => {
    const three = [...TWINS, { id: "d", type: "file", x: 600, y: 300, width: 240, height: 160, file: "Note/idea.md" }];
    const { engine, host } = mounted(boardSource(three));
    twinsButton(host, "d")!.dispatchEvent(new PointerEvent("pointerover", { bubbles: true }));
    expect(lit(host)).toEqual(["a", "b", "d"]);
    engine.syncDoc(boardSource(three.filter((node) => node.id !== "d")));
    expect(lit(host)).toEqual([]);
    expect(twinsButton(host, "a")?.textContent).toBe("×2");
    engine.destroy();
  });

  it("«↩ N» dall'indice, una domanda per file; nessun segno se nessuna nota cita il file", async () => {
    const counts: Record<string, number> = { "Note/idea.md": 3, "img/foto.png": 0 };
    const count = vi.fn(async (path: string) => ({ total: counts[path] ?? 0, citers: null }));
    const cards: CanvasCards = { ...cardsOf(), citations: { count, linksFrom: async () => [], watch: () => () => {} } };
    // La copia lontana viene vicina: la lavagna intera si vede da vicino, e la testata con lei.
    const near = TWINS.map((node) => (node.id === "b" ? { ...node, x: 640, y: 0 } : node));
    const { engine, host } = mounted(boardSource(near), { cards });
    await settle();
    expect(count.mock.calls.map(([path]) => path).sort()).toEqual(["Note/idea.md", "img/foto.png"]);
    const cites = card(host, "a").querySelector(":scope > .canvas-node-handle > .canvas-node-cites");
    expect(cites?.querySelector("[aria-hidden]")?.textContent).toBe("↩ 3");
    expect(cites?.querySelector(".sr-only")?.textContent).toBe("Citata da 3 note");
    // I numeri prima del resto della riga: il titolo, «↩ 3», «×2».
    expect(cites?.previousElementSibling?.classList.contains("canvas-node-title")).toBe(true);
    expect(cites?.nextElementSibling?.classList.contains("canvas-node-twins")).toBe(true);
    expect(card(host, "c").querySelector(".canvas-node-cites")).toBeNull();
    engine.destroy();
  });

  // 2000 schede in happy-dom sono lavoro di CPU, non un'attesa: niente orologio
  // (i timer sono finti), nessun evento da aspettare. Da sola gira sotto il
  // secondo; su una macchina molto carica i 5 s di default li superava. Il tetto
  // largo non decide l'esito: la prova conta le scritture, non i millisecondi.
  it("2000 schede: si chiedono solo i conti della zona, anche dopo un cambio dell'indice; la zona che si sposta chiede i suoi", { timeout: 60_000 }, async () => {
    vi.useFakeTimers();
    try {
      // Una griglia di 50 × 40 schede, ognuna col suo file, a passi di 300 × 200.
      const nodes = Array.from({ length: 2000 }, (_, i) => ({
        id: `n${i}`, type: "file", x: (i % 50) * 300, y: Math.floor(i / 50) * 200, width: 240, height: 160, file: `Note/n${i}.md`,
      }));
      // Una vista di 800 × 600 a zoom 1 dall'origine: allargata di metà per
      // lato va da (-400, -300) a (1200, 900), cioè 5 colonne per 5 righe.
      const zone = new Set<string>();
      for (let row = 0; row < 5; row++) for (let col = 0; col < 5; col++) zone.add(`Note/n${row * 50 + col}.md`);
      const asked: string[] = [];
      let fire: (docs: readonly string[] | null) => void = () => {};
      const citations = {
        count: async (path: string) => {
          asked.push(path);
          // «n0» è citata da «Indice.md»; le altre da nessuno.
          return path === "Note/n0.md" ? { total: 1, citers: ["Indice.md"] } : { total: 0, citers: [] };
        },
        linksFrom: async () => [],
        watch: (changed: (docs: readonly string[] | null) => void) => {
          fire = changed;
          return () => {};
        },
      };
      const states = new Map<string, unknown>([[canvasViewKey("board.canvas"), { version: 1, camera: { x: 0, y: 0, zoom: 1 }, selection: [], pages: {} }]]);
      const memory = createCanvasViewMemory({ get: async (key) => states.get(key) ?? null, set: async (key, value) => void states.set(key, value) });
      const { engine, host, viewport } = mounted(boardSource(nodes), { cards: { ...cardsOf(), citations }, viewMemory: memory });
      await settle();
      expect(cameraOf(host)).toBe("translate(0px, 0px) scale(1)");
      await settle();
      expect(new Set(asked)).toEqual(zone);
      expect(asked).toHaveLength(zone.size);
      expect(card(host, "n0").querySelector(".canvas-node-cites [aria-hidden]")?.textContent).toBe("↩ 1");

      // «non so»: tutti i conti invecchiano, ma si richiedono solo i 25 della zona.
      asked.length = 0;
      fire(null);
      vi.advanceTimersByTime(CITATIONS_SETTLE_MS);
      await settle();
      expect(new Set(asked)).toEqual(zone);
      expect(asked).toHaveLength(zone.size);

      // Cambia «Indice.md»: tocca solo «n0», l'unico file che citava.
      asked.length = 0;
      fire(["Indice.md"]);
      vi.advanceTimersByTime(CITATIONS_SETTLE_MS);
      await settle();
      expect(asked).toEqual(["Note/n0.md"]);

      // La vista scende di 1000 punti: si chiedono le righe nuove, non quelle già sapute.
      asked.length = 0;
      panStart(viewport, 0, -1000)();
      vi.advanceTimersByTime(1000);
      await settle();
      expect(asked.length).toBeGreaterThan(0);
      expect(asked.length).toBeLessThanOrEqual(zone.size);
      expect(asked.every((path) => !zone.has(path))).toBe(true);
      engine.destroy();
    } finally {
      vi.useRealTimers();
    }
  });
});
