// @vitest-environment happy-dom
// Le schede vive della tela: entrare e uscire, scrivere in una nota (T41), riaprire dove eri (T36), seguire un link (T57).
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { WHEEL_SETTLE_MS, type CardLinkRef } from "./engine";
import { LIVE_ZOOM_MIN, type CardContext, type CardMode, type CardRenderer, type CardView } from "../core/cards/contract";
import type { CanvasNode } from "./model";
import { canvasCoreReady } from "./wasm/core";
import { canvasViewKey, createCanvasViewMemory } from "./view-state";
import { setReducedMotionPreference } from "../../theme/reduced-motion";
import { BOARD, Mounted, activeOf, boardSource, bodyOf, cameraOf, cameraValues, card, cardsOf, editingOf, enterWithKeys, fakeRenderer, focused, image, liveOf, mounted, optionsBar, panStart, press, probeRenderer, readNodes, settle, wheelOn, zoomOf } from "./engine-cards-test-support";

beforeAll(async () => {
  await canvasCoreReady();
});

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

function linkOf(host: HTMLElement, id: string): HTMLElement {
  return card(host, id).querySelector<HTMLElement>(".probe-link")!;
}

function textOf(host: HTMLElement, id: string): HTMLElement {
  return card(host, id).querySelector<HTMLElement>(".probe-text")!;
}

/** Un clic col mouse su `target`: giù, su e il `click`. Dà il `click`. */
function clickOn(viewport: HTMLElement, target: HTMLElement, init: MouseEventInit = {}): MouseEvent {
  const at = { bubbles: true, cancelable: true, button: 0, pointerId: 5, clientX: 50, clientY: 50, ...init };
  target.dispatchEvent(new PointerEvent("pointerdown", at));
  viewport.dispatchEvent(new PointerEvent("pointerup", at));
  const click = new MouseEvent("click", { bubbles: true, cancelable: true, button: 0, ...init });
  target.dispatchEvent(click);
  return click;
}

function selectedOf(host: HTMLElement): string[] {
  return [...host.querySelectorAll<HTMLElement>(".canvas-node.selected")].map((el) => el.dataset.node!).sort();
}

describe("entrare e uscire da una scheda", () => {
  it("un clic sceglie la scheda, anche sul link, e non lo segue; il clic dopo entra senza seguirlo", () => {
    const { renderer, log, followed } = probeRenderer();
    const { engine, host, viewport } = mounted(boardSource(BOARD), { cards: cardsOf(renderer) });
    log.length = 0;
    const first = clickOn(viewport, linkOf(host, "n"));
    expect(first.defaultPrevented).toBe(true);
    expect(followed).toEqual([]);
    expect(selectedOf(host)).toEqual(["n"]);
    expect(activeOf(host)).toEqual([]);
    expect(log).toEqual([]);
    // Il mouse giù sul link: il fuoco va alla scheda, non al link.
    const down = new PointerEvent("pointerdown", { bubbles: true, cancelable: true, button: 0, pointerId: 6 });
    linkOf(host, "n").dispatchEvent(down);
    viewport.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, button: 0, pointerId: 6 }));
    expect(down.defaultPrevented).toBe(true);
    expect(focused()).toBe(card(host, "n"));
    clickOn(viewport, linkOf(host, "n"));
    expect(followed).toEqual([]);
    expect(log).toEqual(["n:enter"]);
    expect(activeOf(host)).toEqual(["n"]);
    expect(card(host, "n").querySelector(".canvas-exit-hint")?.textContent).toBe("Esc per uscire");
    // Dentro, un clic sul link lo segue.
    clickOn(viewport, linkOf(host, "n"));
    expect(followed).toEqual(["n:Altra.md"]);
    engine.destroy();
  });

  it("Ctrl+clic e Meta+clic su un link lo seguono subito, attiva o no; fuori da un link aggiungono alla scelta", () => {
    const { renderer, followed } = probeRenderer();
    const { engine, host, viewport } = mounted(boardSource(BOARD), { cards: cardsOf(renderer) });
    const before = cameraOf(host);
    clickOn(viewport, linkOf(host, "n"), { ctrlKey: true });
    expect(followed).toEqual(["n:Altra.md"]);
    clickOn(viewport, linkOf(host, "p"), { metaKey: true });
    expect(followed).toEqual(["n:Altra.md", "p:Altra.md"]);
    expect(selectedOf(host)).toEqual([]);
    expect(activeOf(host)).toEqual([]);
    // Fuori da un link: la scelta cresce, la lavagna non si sposta.
    clickOn(viewport, textOf(host, "n"));
    clickOn(viewport, textOf(host, "p"), { ctrlKey: true });
    expect(selectedOf(host)).toEqual(["n", "p"]);
    clickOn(viewport, card(host, "i"), { metaKey: true });
    expect(selectedOf(host)).toEqual(["i", "n", "p"]);
    expect(cameraOf(host)).toBe(before);
    expect(activeOf(host)).toEqual([]);
    // Dentro una scheda attiva, anche.
    clickOn(viewport, viewport);
    clickOn(viewport, textOf(host, "n"));
    clickOn(viewport, textOf(host, "n"));
    expect(activeOf(host)).toEqual(["n"]);
    clickOn(viewport, linkOf(host, "n"), { ctrlKey: true });
    expect(followed).toEqual(["n:Altra.md", "p:Altra.md", "n:Altra.md"]);
    expect(activeOf(host)).toEqual(["n"]);
    engine.destroy();
  });

  it("Invio con la scheda scelta entra; Esc esce e il fuoco torna alla scheda", () => {
    const { renderer, log } = probeRenderer();
    const { engine, host } = mounted(boardSource(BOARD), { cards: cardsOf(renderer) });
    log.length = 0;
    const article = card(host, "n");
    article.focus();
    expect(press(article, "Enter").defaultPrevented).toBe(true);
    expect(log).toEqual(["n:enter"]);
    expect(activeOf(host)).toEqual(["n"]);
    expect(host.querySelector(".canvas-field-editor")).toBeNull();
    // Il fuoco va dentro: i tasti sono del contenuto, non della tela.
    expect(article.contains(focused())).toBe(true);
    expect(focused()).not.toBe(article);
    expect(press(focused(), "Delete").defaultPrevented).toBe(false);
    expect(readNodes(engine.getDoc()).map((node) => node.id)).toContain("n");
    expect(press(focused(), "Escape").defaultPrevented).toBe(true);
    expect(log).toEqual(["n:enter", "n:leave"]);
    expect(activeOf(host)).toEqual([]);
    expect(article.querySelector(".canvas-exit-hint")).toBeNull();
    expect(focused()).toBe(article);
    // Una scheda di testo: Invio scrive, come prima.
    enterWithKeys(host, "t");
    expect(host.querySelector(".canvas-text-editor")).not.toBeNull();
    expect(activeOf(host)).toEqual([]);
    engine.destroy();
  });

  it("Esc che il contenuto usa (un rettangolo di celle) non esce", () => {
    const { renderer, log } = probeRenderer();
    const { engine, host } = mounted(boardSource(BOARD), { cards: cardsOf(renderer) });
    log.length = 0;
    enterWithKeys(host, "n");
    const probe = card(host, "n").querySelector<HTMLElement>(".probe")!;
    probe.dataset.cells = "";
    press(probe, "Escape");
    expect(log).toEqual(["n:enter", "n:cells"]);
    expect(activeOf(host)).toEqual(["n"]);
    press(probe, "Escape");
    expect(log).toEqual(["n:enter", "n:cells", "n:leave"]);
    expect(activeOf(host)).toEqual([]);
    engine.destroy();
  });

  it("un clic fuori esce; un clic sulla testata della scheda attiva no", () => {
    const { renderer, log } = probeRenderer();
    const { engine, host, viewport } = mounted(boardSource(BOARD), { cards: cardsOf(renderer) });
    clickOn(viewport, textOf(host, "n"));
    clickOn(viewport, textOf(host, "n"));
    expect(activeOf(host)).toEqual(["n"]);
    log.length = 0;
    clickOn(viewport, card(host, "n").querySelector<HTMLElement>(".canvas-node-handle")!);
    expect(activeOf(host)).toEqual(["n"]);
    clickOn(viewport, viewport);
    expect(log).toEqual(["n:leave"]);
    expect(activeOf(host)).toEqual([]);
    expect(selectedOf(host)).toEqual([]);
    // Un clic su un'altra scheda, anche: esce e sceglie quella.
    clickOn(viewport, textOf(host, "n"));
    clickOn(viewport, textOf(host, "n"));
    expect(activeOf(host)).toEqual(["n"]);
    clickOn(viewport, textOf(host, "p"));
    expect(activeOf(host)).toEqual([]);
    expect(selectedOf(host)).toEqual(["p"]);
    engine.destroy();
  });

  it("la rotella fuori sposta la lavagna; sopra la scheda attiva va a lei, con Ctrl ingrandisce", () => {
    const { renderer } = probeRenderer();
    const { engine, host } = mounted(boardSource(BOARD), { cards: cardsOf(renderer) });
    let camera = cameraOf(host);
    expect(wheelOn(textOf(host, "n"), false, 10).defaultPrevented).toBe(true);
    expect(cameraOf(host)).not.toBe(camera);
    enterWithKeys(host, "n");
    expect(activeOf(host)).toEqual(["n"]);
    camera = cameraOf(host);
    expect(wheelOn(textOf(host, "n"), false, 10).defaultPrevented).toBe(false);
    expect(cameraOf(host)).toBe(camera);
    // Fuori dalla scheda attiva, ancora la lavagna.
    expect(wheelOn(textOf(host, "p"), false, 10).defaultPrevented).toBe(true);
    expect(cameraOf(host)).not.toBe(camera);
    expect(wheelOn(textOf(host, "n"), true).defaultPrevented).toBe(true);
    expect(zoomOf(host)).toBeLessThan(1);
    expect(activeOf(host)).toEqual(["n"]);
    engine.destroy();
  });

  it("PgGiù, PgSu, Home e Fine vanno alla scheda scelta e non attiva", () => {
    const { renderer, log } = probeRenderer();
    const { engine, host } = mounted(boardSource(BOARD), { cards: cardsOf(renderer) });
    log.length = 0;
    const article = card(host, "p");
    article.focus();
    expect(press(article, "PageDown").defaultPrevented).toBe(true);
    press(article, "PageUp");
    press(article, "Home");
    press(article, "End");
    expect(log).toEqual(["p:key PageDown", "p:key PageUp", "p:key Home", "p:key End"]);
    // Le frecce restano della tela: spostano la scheda.
    press(article, "ArrowRight");
    expect(log).toHaveLength(4);
    expect(readNodes(engine.getDoc()).find((node) => node.id === "p")!.x).toBeGreaterThan(400);
    // Dentro una scheda attiva i tasti sono del contenuto: `key` non c'entra.
    enterWithKeys(host, "n");
    log.length = 0;
    press(focused(), "PageDown");
    expect(log).toEqual([]);
    engine.destroy();
  });

  it("la scheda attiva resta viva sotto lo zoom delle schede vive, ed esce quando lascia la vista", () => {
    vi.useFakeTimers();
    try {
      const { renderer, log } = probeRenderer();
      const { engine, host, viewport } = mounted(boardSource(BOARD), { cards: cardsOf(renderer) });
      enterWithKeys(host, "n");
      log.length = 0;
      for (let tick = 0; tick < 12; tick++) wheelOn(viewport, true);
      vi.advanceTimersByTime(WHEEL_SETTLE_MS);
      expect(zoomOf(host)).toBeLessThan(LIVE_ZOOM_MIN);
      expect([...log].sort()).toEqual(["i:snapshot", "p:snapshot"]);
      expect(liveOf(host)).toEqual(["n"]);
      expect(activeOf(host)).toEqual(["n"]);
      log.length = 0;
      // Lontano: la scheda esce dalla vista, e allora esce e si spegne.
      panStart(viewport, -20_000, 0)();
      expect(log).toEqual(["n:leave", "n:snapshot"]);
      expect(activeOf(host)).toEqual([]);
      engine.destroy();
    } finally {
      vi.useRealTimers();
    }
  });

  it("entrare in una scheda ferma la accende, poi entra; uscendo torna ferma", () => {
    vi.useFakeTimers();
    try {
      const { renderer, log } = probeRenderer();
      const { engine, host, viewport } = mounted(boardSource(BOARD), { cards: cardsOf(renderer) });
      for (let tick = 0; tick < 12; tick++) wheelOn(viewport, true);
      vi.advanceTimersByTime(WHEEL_SETTLE_MS);
      expect(liveOf(host)).toEqual([]);
      log.length = 0;
      enterWithKeys(host, "n");
      expect(log).toEqual(["n:live", "n:enter"]);
      expect(activeOf(host)).toEqual(["n"]);
      press(focused(), "Escape");
      expect(log).toEqual(["n:live", "n:enter", "n:leave", "n:snapshot"]);
      engine.destroy();
    } finally {
      vi.useRealTimers();
    }
  });

  it("senza niente in cui entrare, Invio fa ciò che faceva; il doppio clic sull'immagine non apre il campo", () => {
    const { renderer, log } = probeRenderer();
    const { engine, host } = mounted(boardSource(BOARD), { cards: cardsOf(renderer) });
    log.length = 0;
    card(host, "i").dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    expect(host.querySelector(".canvas-field-editor")).toBeNull();
    expect(activeOf(host)).toEqual([]);
    expect(log).toEqual([]);
    // Il doppio clic sulla nota è come Invio.
    card(host, "n").dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    expect(log).toEqual(["n:enter"]);
    expect(activeOf(host)).toEqual(["n"]);
    press(focused(), "Escape");
    // Il PDF non ha dove entrare: Invio apre il campo del file, come prima.
    log.length = 0;
    enterWithKeys(host, "p");
    expect(log[0]).toBe("p:enter");
    expect(activeOf(host)).toEqual([]);
    expect(host.querySelector(".canvas-field-editor")).not.toBeNull();
    engine.destroy();
  });

  it("in sola lettura si entra; una scheda attiva tolta da fuori esce, e si rientra", () => {
    const { renderer, log } = probeRenderer();
    const { engine, host } = mounted(boardSource(BOARD), { cards: cardsOf(renderer) });
    engine.setReadOnly(true);
    log.length = 0;
    enterWithKeys(host, "n");
    expect(activeOf(host)).toEqual(["n"]);
    engine.setReadOnly(false);
    engine.syncDoc(boardSource(BOARD.filter((node) => node.id !== "n")));
    expect(log).toEqual(["n:enter", "n:leave", "n:destroy"]);
    expect(activeOf(host)).toEqual([]);
    engine.syncDoc(boardSource(BOARD));
    enterWithKeys(host, "n");
    expect(activeOf(host)).toEqual(["n"]);
    engine.destroy();
  });

  it("la scheda attiva tolta da un annulla esce", () => {
    const { renderer, log } = probeRenderer();
    const { engine, host, viewport } = mounted(boardSource(BOARD), { cards: cardsOf(renderer) });
    // Una copia della nota, scelta: Invio ci entra, l'annulla la toglie.
    card(host, "n").focus();
    viewport.dispatchEvent(new KeyboardEvent("keydown", { key: "d", ctrlKey: true, bubbles: true, cancelable: true }));
    const copy = readNodes(engine.getDoc()).map((node) => node.id).find((id) => !BOARD.some((node) => node.id === id))!;
    expect(copy).toBeDefined();
    log.length = 0;
    press(viewport, "Enter");
    expect(activeOf(host)).toEqual([copy]);
    engine.undo();
    expect(log).toEqual([`${copy}:enter`, `${copy}:leave`, `${copy}:destroy`]);
    expect(activeOf(host)).toEqual([]);
    expect(host.querySelector(".canvas-exit-hint")).toBeNull();
    engine.destroy();
  });
});

/**
 * Un renderer di note che scrive (T41): `edit()` dice sì per le note `.md`,
 * e la prova risponde da sé come risponderebbe la porta (`context.writing`,
 * `context.editState`). Dentro c'è un campo, al posto dell'editor vero.
 */
function writerRenderer() {
  const log: string[] = [];
  const contexts = new Map<string, CardContext>();
  const renderer: CardRenderer = {
    kinds: ["note", "pdf"],
    mount(node: CanvasNode, host: HTMLElement, _mode: CardMode, context: CardContext): CardView {
      contexts.set(node.id, context);
      const field = document.createElement("textarea");
      field.className = "writer-field";
      host.append(field);
      const md = (node.file ?? "").endsWith(".md");
      return {
        setMode: (mode) => log.push(`${node.id}:${mode}`),
        enter: () => {
          log.push(`${node.id}:enter`);
          return md;
        },
        leave: () => log.push(`${node.id}:leave`),
        ...(md ? {
          edit: () => {
            log.push(`${node.id}:edit`);
            return true;
          },
        } : {}),
        destroy: () => log.push(`${node.id}:destroy`),
      };
    },
  };
  /** La porta ha montato l'editor della scheda `id`: la barra e il fuoco nel campo. */
  const opened = (id: string, toolbar: HTMLElement | null = formatBar()): void => {
    contexts.get(id)!.writing?.({ toolbar });
    contexts.get(id)!.editState?.(null);
    fieldOf(id)?.focus();
  };
  let boardHost: HTMLElement | null = null;
  const fieldOf = (id: string): HTMLTextAreaElement | null =>
    boardHost?.querySelector<HTMLTextAreaElement>(`.canvas-node[data-node="${id}"] .writer-field`) ?? null;
  return { renderer, log, contexts, opened, bind: (host: HTMLElement) => (boardHost = host) };
}

function formatBar(): HTMLElement {
  const bar = document.createElement("div");
  bar.className = "format-bar";
  return bar;
}

function fieldIn(host: HTMLElement, id: string): HTMLTextAreaElement {
  return card(host, id).querySelector<HTMLTextAreaElement>(".writer-field")!;
}

describe("scrivere in una scheda di nota (T41)", () => {
  it("Invio entra in scrittura: il segno, la barra nella riga delle opzioni, il nome nella banda", () => {
    const writer = writerRenderer();
    const { engine, host } = mounted(boardSource(BOARD), { cards: cardsOf(writer.renderer) });
    writer.bind(host);
    writer.log.length = 0;
    enterWithKeys(host, "n");
    expect(writer.log).toEqual(["n:enter", "n:edit"]);
    expect(activeOf(host)).toEqual(["n"]);
    // Finché l'editor non c'è la scheda è attiva, non ancora in scrittura.
    expect(editingOf(host)).toEqual([]);
    expect(optionsBar(host)).toBeNull();
    writer.opened("n");
    expect(editingOf(host)).toEqual(["n"]);
    expect(optionsBar(host)).not.toBeNull();
    expect(card(host, "n").querySelector(".canvas-exit-hint")?.textContent).toBe("Esc per uscire");
    expect(engine.statusItems().find((item) => item.id === "writing")?.text).toBe("In scrittura: idea");
    expect(engine.statusItems().some((item) => item.id === "chosen")).toBe(false);
    engine.destroy();
  });

  it("il primo Esc esce dalla scrittura e lascia la scheda scelta; la riga torna allo strumento", () => {
    const writer = writerRenderer();
    const { engine, host } = mounted(boardSource(BOARD), { cards: cardsOf(writer.renderer) });
    writer.bind(host);
    enterWithKeys(host, "n");
    writer.opened("n");
    writer.log.length = 0;
    expect(press(fieldIn(host, "n"), "Escape").defaultPrevented).toBe(true);
    expect(writer.log).toEqual(["n:leave"]);
    expect(editingOf(host)).toEqual([]);
    expect(activeOf(host)).toEqual([]);
    expect(optionsBar(host)).toBeNull();
    expect(selectedOf(host)).toEqual(["n"]);
    expect(focused()).toBe(card(host, "n"));
    expect(engine.statusItems().some((item) => item.id === "writing")).toBe(false);
    // Una risposta tardiva della scheda che ha già smesso non la rimette in scrittura.
    writer.contexts.get("n")!.writing?.({ toolbar: formatBar() });
    expect(editingOf(host)).toEqual([]);
    engine.destroy();
  });

  it("un clic fuori esce dalla scrittura come Esc", () => {
    const writer = writerRenderer();
    const { engine, host, viewport } = mounted(boardSource(BOARD), { cards: cardsOf(writer.renderer) });
    writer.bind(host);
    enterWithKeys(host, "n");
    writer.opened("n");
    writer.log.length = 0;
    clickOn(viewport, viewport);
    expect(writer.log).toEqual(["n:leave"]);
    expect(editingOf(host)).toEqual([]);
    expect(optionsBar(host)).toBeNull();
    engine.destroy();
  });

  it("mentre si scrive i tasti di una lettera della lavagna tacciono, e Ctrl+Z è della nota", () => {
    const writer = writerRenderer();
    const { engine, host } = mounted(boardSource(BOARD), { cards: cardsOf(writer.renderer) });
    writer.bind(host);
    // Un passo d'annulla della lavagna, prima di scrivere.
    card(host, "p").focus();
    press(card(host, "p"), "ArrowRight");
    const moved = engine.getDoc();
    enterWithKeys(host, "n");
    writer.opened("n");
    const field = fieldIn(host, "n");
    for (const key of ["c", "t", "h", "d", "Delete", "Backspace", " "]) {
      expect(press(field, key).defaultPrevented, key).toBe(false);
    }
    const undo = new KeyboardEvent("keydown", { key: "z", ctrlKey: true, bubbles: true, cancelable: true });
    field.dispatchEvent(undo);
    expect(undo.defaultPrevented).toBe(false);
    expect(engine.getDoc()).toBe(moved);
    expect(readNodes(engine.getDoc()).map((node) => node.id)).toContain("n");
    expect(editingOf(host)).toEqual(["n"]);
    engine.destroy();
  });

  it("il doppio clic su una nota scelta, o già attiva da leggere, la scrive", () => {
    const writer = writerRenderer();
    const { engine, host, viewport } = mounted(boardSource(BOARD), { cards: cardsOf(writer.renderer) });
    writer.bind(host);
    card(host, "n").dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    expect(writer.log.filter((entry) => entry.endsWith(":edit"))).toEqual(["n:edit"]);
    press(fieldIn(host, "n"), "Escape");
    // Attiva per leggere (il clic dentro la scheda scelta), poi il doppio clic.
    clickOn(viewport, fieldIn(host, "n"));
    expect(activeOf(host)).toEqual(["n"]);
    writer.log.length = 0;
    fieldIn(host, "n").dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    expect(writer.log).toEqual(["n:edit"]);
    // Dentro una scheda che scrive il doppio clic è del testo.
    writer.opened("n");
    writer.log.length = 0;
    fieldIn(host, "n").dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    expect(writer.log).toEqual([]);
    expect(editingOf(host)).toEqual(["n"]);
    engine.destroy();
  });

  it("lo stato del salvataggio e la sola lettura stanno nella riga del titolo", () => {
    const writer = writerRenderer();
    const { engine, host } = mounted(boardSource(BOARD), { cards: cardsOf(writer.renderer) });
    writer.bind(host);
    enterWithKeys(host, "n");
    writer.opened("n");
    const context = writer.contexts.get("n")!;
    const handle = card(host, "n").querySelector<HTMLElement>(".canvas-node-handle")!;
    // Ogni stato con la parola della testata di un riquadro (T96).
    const words = {
      salvato: "Salvato",
      in_corso: "Salvataggio…",
      non_salvato: "Non salvato",
      fallito: "Salvataggio fallito",
      conflitto: "Cambiato su disco",
    } as const;
    for (const [state, word] of Object.entries(words) as [keyof typeof words, string][]) {
      context.editState?.(state);
      expect(handle.querySelectorAll(".save-state"), state).toHaveLength(1);
      expect(handle.querySelector(".save-state")?.textContent).toBe(word);
      expect(handle.querySelector<HTMLElement>(".save-state")?.dataset.state).toBe(state);
    }
    context.editState?.(null);
    expect(handle.querySelector(".save-state")).toBeNull();
    // La nota di sola lettura: la scheda smette di scrivere e resta attiva.
    context.editState?.("readonly", "idea.md è di sola lettura");
    context.writing?.(null);
    expect(editingOf(host)).toEqual([]);
    expect(activeOf(host)).toEqual(["n"]);
    expect(optionsBar(host)).toBeNull();
    const lock = handle.querySelector<HTMLElement>(".canvas-card-lock");
    expect(lock?.textContent).toBe("Sola lettura");
    expect(lock?.title).toBe("idea.md è di sola lettura");
    press(fieldIn(host, "n"), "Escape");
    expect(handle.querySelector(".canvas-card-lock")).toBeNull();
    engine.destroy();
  });

  it("la lavagna di sola lettura non toglie la scrittura della nota, che è un altro file (T96)", () => {
    const writer = writerRenderer();
    const { engine, host } = mounted(boardSource(BOARD), { cards: cardsOf(writer.renderer) });
    writer.bind(host);
    engine.setReadOnly(true);
    writer.log.length = 0;
    enterWithKeys(host, "n");
    expect(writer.log).toEqual(["n:enter", "n:edit"]);
    writer.opened("n");
    expect(editingOf(host)).toEqual(["n"]);
    // La lavagna resta ferma: i tasti di una lettera tacciono, niente si sposta.
    const before = engine.getDoc();
    for (const key of ["c", "Delete"]) expect(press(fieldIn(host, "n"), key).defaultPrevented, key).toBe(false);
    expect(engine.getDoc()).toBe(before);
    // Fermarla mentre la nota scrive non ferma la nota.
    engine.setReadOnly(false);
    engine.setReadOnly(true);
    expect(editingOf(host)).toEqual(["n"]);
    expect(writer.log).not.toContain("n:leave");
    press(fieldIn(host, "n"), "Escape");
    expect(editingOf(host)).toEqual([]);
    engine.destroy();
  });

  it("la scheda che scrive resta viva fuori dalla vista e sotto lo zoom delle vive", () => {
    vi.useFakeTimers();
    try {
      const writer = writerRenderer();
      const { engine, host, viewport } = mounted(boardSource(BOARD), { cards: cardsOf(writer.renderer) });
      writer.bind(host);
      enterWithKeys(host, "n");
      writer.opened("n");
      writer.log.length = 0;
      for (let tick = 0; tick < 12; tick++) wheelOn(viewport, true);
      vi.advanceTimersByTime(WHEEL_SETTLE_MS);
      expect(zoomOf(host)).toBeLessThan(LIVE_ZOOM_MIN);
      panStart(viewport, -20_000, 0)();
      expect(writer.log).not.toContain("n:leave");
      expect(liveOf(host)).toEqual(["n"]);
      expect(editingOf(host)).toEqual(["n"]);
      engine.destroy();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("riaprire dove eri (T36)", () => {
  const PDF_BOARD = [
    { id: "p", type: "file", x: 0, y: 0, width: 200, height: 260, file: "Corsi/manuale.pdf", subpath: "#page=2" },
    image("a", 400, 0),
    image("z", 1600, 1200),
  ];

  function viewStore(initial: Record<string, unknown> = {}) {
    const states = new Map<string, unknown>(Object.entries(initial));
    const writes: unknown[] = [];
    const memory = createCanvasViewMemory({
      get: async (key) => states.get(key) ?? null,
      set: async (key, value) => {
        writes.push(value);
        states.set(key, value);
      },
    });
    return { states, writes, memory };
  }

  /** Le viste montate della scheda `id`, dall'ultima. */
  function mountsOf(mounts: readonly Mounted[], id: string): Mounted[] {
    return mounts.filter((entry) => entry.node === id).reverse();
  }

  it("riaprendo tornano la camera, la scelta e la pagina del PDF; il .canvas non cambia", async () => {
    const source = boardSource(PDF_BOARD);
    const store = viewStore();
    const first = fakeRenderer();
    const a = mounted(source, { cards: cardsOf(first.renderer), viewMemory: store.memory });
    await settle();
    // Nessuno stato: si inquadra tutto, come prima.
    const fitted = cameraOf(a.host);
    panStart(a.viewport, -150, -40)();
    clickOn(a.viewport, bodyOf(a.host, "a"));
    expect(selectedOf(a.host)).toEqual(["a"]);
    const camera = cameraOf(a.host);
    expect(camera).not.toBe(fitted);
    mountsOf(first.mounts, "p")[0]!.context.pageChanged!(5);
    a.engine.destroy();
    await settle();
    expect(store.writes.length).toBe(1);
    expect(store.states.get(canvasViewKey("board.canvas"))).toMatchObject({ version: 1, selection: ["a"], pages: { p: 5 } });
    expect(a.changes).toEqual([]);
    expect(a.engine.getDoc()).toBe(source);

    const second = fakeRenderer();
    const b = mounted(source, { cards: cardsOf(second.renderer), viewMemory: store.memory });
    await settle();
    expect(cameraOf(b.host)).toBe(camera);
    expect(selectedOf(b.host)).toEqual(["a"]);
    // La scheda montata prima che la vista arrivasse si rimonta sulla sua pagina.
    const pdf = mountsOf(second.mounts, "p");
    expect(pdf[0]!.context.initialPage).toBe(5);
    expect(pdf[0]!.destroyed).toBe(0);
    expect(pdf.slice(1).every((entry) => entry.destroyed === 1)).toBe(true);
    // Le altre schede non si rimontano.
    expect(mountsOf(second.mounts, "a").length).toBe(1);
    // Il file resta identico byte per byte.
    expect(b.engine.getDoc()).toBe(source);
    expect(b.changes).toEqual([]);
    b.engine.destroy();
    await settle();
    // Riaperta e richiusa senza cambiare niente: niente da riscrivere.
    expect(store.writes.length).toBe(1);
  });

  it("una vista ricordata vuota inquadra tutto", async () => {
    const source = boardSource(PDF_BOARD);
    const plain = mounted(source, { cards: cardsOf(fakeRenderer().renderer) });
    const fitted = cameraOf(plain.host);
    plain.engine.destroy();
    const store = viewStore({
      [canvasViewKey("board.canvas")]: { version: 1, camera: { x: 90000, y: 90000, zoom: 1 }, selection: ["via"], pages: {} },
    });
    const b = mounted(source, { cards: cardsOf(fakeRenderer().renderer), viewMemory: store.memory });
    await settle();
    expect(cameraOf(b.host)).toBe(fitted);
    // Una scheda scelta che non c'è più non si sceglie.
    expect(selectedOf(b.host)).toEqual([]);
    b.engine.destroy();
  });

  it("la scelta torna con le sole schede che ci sono ancora, e la camera da sola", async () => {
    const store = viewStore({
      [canvasViewKey("board.canvas")]: { version: 1, camera: { x: 10, y: 20, zoom: 0.5 }, selection: ["via", "z", "a"], pages: {} },
    });
    const b = mounted(boardSource(PDF_BOARD), { cards: cardsOf(fakeRenderer().renderer), viewMemory: store.memory });
    await settle();
    expect(cameraOf(b.host)).toBe("translate(10px, 20px) scale(0.5)");
    expect(selectedOf(b.host)).toEqual(["a", "z"]);
    b.engine.destroy();
  });

  it("uno stato di un'altra versione o rotto: si parte come oggi, e quello di un'altra versione non si riscrive", async () => {
    const source = boardSource(PDF_BOARD);
    const plain = mounted(source, { cards: cardsOf(fakeRenderer().renderer) });
    const fitted = cameraOf(plain.host);
    plain.engine.destroy();
    const foreign = { version: 2, camera: { x: 10, y: 20, zoom: 0.5 }, selection: ["a"] };
    for (const stored of [foreign, "rotto", { camera: { x: 10, y: 20, zoom: 0.5 } }]) {
      const store = viewStore({ [canvasViewKey("board.canvas")]: stored });
      const b = mounted(source, { cards: cardsOf(fakeRenderer().renderer), viewMemory: store.memory });
      await settle();
      expect(cameraOf(b.host)).toBe(fitted);
      expect(selectedOf(b.host)).toEqual([]);
      panStart(b.viewport, -150, 0)();
      b.engine.destroy();
      await settle();
      if (stored === foreign) expect(store.writes).toEqual([]);
      else expect(store.writes.length).toBe(1);
    }
  });

  it("una vista mossa prima che quella ricordata arrivi resta com'è", async () => {
    const store = viewStore({
      [canvasViewKey("board.canvas")]: { version: 1, camera: { x: 10, y: 20, zoom: 0.5 }, selection: [], pages: {} },
    });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const viewMemory = {
      read: async (doc: string) => {
        await gate;
        return store.memory.read(doc);
      },
      write: store.memory.write,
    };
    const b = mounted(boardSource(PDF_BOARD), { cards: cardsOf(fakeRenderer().renderer), viewMemory });
    panStart(b.viewport, -150, 0)();
    const moved = cameraOf(b.host);
    release();
    await settle();
    expect(cameraOf(b.host)).toBe(moved);
    b.engine.destroy();
  });

  it("senza lavagna non si legge e non si scrive niente", async () => {
    const store = viewStore();
    const read = vi.spyOn(store.memory, "read");
    const b = mounted(boardSource(PDF_BOARD), { cards: cardsOf(fakeRenderer().renderer), viewMemory: store.memory, documentId: undefined });
    await settle();
    panStart(b.viewport, -150, 0)();
    b.engine.destroy();
    await settle();
    expect(read).not.toHaveBeenCalled();
    expect(store.writes).toEqual([]);
  });
});

/**
 * Una nota con i link che la resa Markdown mette nelle schede: un wikilink con
 * o senza sezione (`a.wikilink`), un percorso del vault (`a.internal-path`), un
 * link rotto e un indirizzo web. La montatura (`followed`) li segue solo se la
 * tela non li ha presi prima: T57 prende quelli che portano a un file.
 */
function linkNoteRenderer() {
  const followed: string[] = [];
  const renderer: CardRenderer = {
    kinds: ["note"],
    mount(node: CanvasNode, host: HTMLElement): CardView {
      const content = document.createElement("div");
      content.className = "link-note";
      content.innerHTML = [
        '<a class="wikilink" href="#" data-link="wiki" data-wikilink-page="Altra">Altra</a>',
        '<a class="wikilink" href="#" data-link="sec" data-wikilink-page="Altra" data-wikilink-heading="Titolo">Altra#Titolo</a>',
        '<a class="internal-path" href="Altra.md" data-link="path" data-path="Altra.md">Altra.md</a>',
        '<a class="wikilink" href="#" data-link="rotta" data-wikilink-page="Rotta">Rotta</a>',
        '<a href="https://example.com" data-link="web">web</a>',
        '<p class="link-text">testo</p>',
      ].join("");
      content.addEventListener("click", (event) => {
        if (event.defaultPrevented) return;
        const anchor = event.target instanceof Element ? event.target.closest("a") : null;
        if (!anchor) return;
        event.preventDefault();
        followed.push(`${node.id}:${anchor.dataset.link}`);
      });
      host.append(content);
      const enterable = (node.file ?? "").endsWith(".md");
      return {
        setMode: () => {},
        enter: () => enterable,
        leave: () => {},
        destroy: () => {},
      };
    },
  };
  return { renderer, followed };
}

/**
 * La lavagna di prova dei link. Il fit la inquadra con `n` sopra a sinistra:
 * `near` è la scheda di `Altra.md` più vicina al centro della vista, `far` la
 * più lontana, e ha la sezione `Titolo` nel suo `subpath`.
 */
const LINK_BOARD = [
  { id: "n", type: "file", x: 0, y: 0, width: 200, height: 100, file: "Note/idea.md" },
  { id: "far", type: "file", x: 800, y: 0, width: 200, height: 100, file: "Altra.md", subpath: "#Titolo" },
  { id: "near", type: "file", x: 0, y: 250, width: 200, height: 200, file: "Altra.md" },
];

/** La porta di risoluzione del test: `targets` dice a quale file di vault va ogni link (`null`: un link rotto). */
function resolving(targets: Record<string, string | null>) {
  return vi.fn(async (link: CardLinkRef): Promise<string | null> => {
    const key = link.kind === "wiki" ? link.page : link.path;
    return key in targets ? targets[key]! : null;
  });
}

/** L'ancora `data-link="name"` della scheda `id`. */
function anchorOf(host: HTMLElement, id: string, name: string): HTMLElement {
  return card(host, id).querySelector<HTMLElement>(`a[data-link="${name}"]`)!;
}

describe("seguire un link (T57)", () => {
  afterEach(() => {
    setReducedMotionPreference(false);
    vi.useRealTimers();
  });

  it("Ctrl+clic su un link a una nota con una scheda sulla lavagna: la tela la prende, la scheda lampeggia e la montatura non segue niente", async () => {
    const { renderer, followed } = linkNoteRenderer();
    const { engine, host, viewport } = mounted(boardSource(LINK_BOARD), {
      cards: cardsOf(renderer),
      resolveCardLink: resolving({ Altra: "Altra.md" }),
    });
    const click = clickOn(viewport, anchorOf(host, "n", "wiki"), { ctrlKey: true });
    await settle();
    expect(click.defaultPrevented).toBe(true);
    expect(followed).toEqual([]);
    // Ctrl+clic su un link non sceglie la scheda, come prima.
    expect(selectedOf(host)).toEqual([]);
    expect(card(host, "near").dataset.cardFlash).toBe("pulse");
    expect(card(host, "far").dataset.cardFlash).toBeUndefined();
    engine.destroy();
  });

  it("il salto vola alla scheda, la mette al centro della vista e Indietro torna dov'era; col movimento ridotto il lampo resta fermo", async () => {
    setReducedMotionPreference(true);
    const { renderer } = linkNoteRenderer();
    const { engine, host, viewport } = mounted(boardSource(LINK_BOARD), {
      cards: cardsOf(renderer),
      resolveCardLink: resolving({ Altra: "Altra.md" }),
    });
    const before = cameraOf(host);
    clickOn(viewport, anchorOf(host, "n", "wiki"), { ctrlKey: true });
    await settle();
    expect(card(host, "near").dataset.cardFlash).toBe("still");
    // La vista di prova è 800 × 600; il centro di `near` (100, 350) sta al centro.
    const view = cameraValues(host);
    expect(view.x + 100 * view.zoom).toBeCloseTo(400, 3);
    expect(view.y + 350 * view.zoom).toBeCloseTo(300, 3);
    // È un salto come gli altri: Indietro lo disfa, e riporta alla vista di prima.
    expect(engine.jumpBack()).toBe(true);
    expect(cameraOf(host)).toBe(before);
    expect(engine.jumpForward()).toBe(true);
    expect(cameraValues(host).x).toBeCloseTo(view.x, 6);
    engine.destroy();
  });

  it("fra più schede dello stesso file vince la più vicina alla vista, e una con la sezione del link vince su tutte", async () => {
    setReducedMotionPreference(true);
    const { renderer } = linkNoteRenderer();
    const { engine, host, viewport } = mounted(boardSource(LINK_BOARD), {
      cards: cardsOf(renderer),
      resolveCardLink: resolving({ Altra: "Altra.md" }),
    });
    clickOn(viewport, anchorOf(host, "n", "wiki"), { ctrlKey: true });
    await settle();
    expect(card(host, "near").dataset.cardFlash).toBe("still");
    expect(card(host, "far").dataset.cardFlash).toBeUndefined();
    // Con la sezione `Titolo` la scheda di `far` ce l'ha nel subpath: vince anche se è lontana.
    clickOn(viewport, anchorOf(host, "n", "sec"), { ctrlKey: true });
    await settle();
    expect(card(host, "far").dataset.cardFlash).toBe("still");
    // Un solo lampo alla volta: quello di `near` si spegne.
    expect(card(host, "near").dataset.cardFlash).toBeUndefined();
    engine.destroy();
  });

  it("un percorso del vault segue la stessa strada del wikilink", async () => {
    setReducedMotionPreference(true);
    const { renderer, followed } = linkNoteRenderer();
    const resolve = resolving({ "Altra.md": "Altra.md" });
    const { engine, host, viewport } = mounted(boardSource(LINK_BOARD), { cards: cardsOf(renderer), resolveCardLink: resolve });
    clickOn(viewport, anchorOf(host, "n", "path"), { ctrlKey: true });
    await settle();
    expect(resolve).toHaveBeenCalledWith({ kind: "path", path: "Altra.md" }, "Note/idea.md");
    expect(followed).toEqual([]);
    // Un percorso non ha sezione: vince la più vicina, come il wikilink senza `#`.
    expect(card(host, "near").dataset.cardFlash).toBe("still");
    expect(card(host, "far").dataset.cardFlash).toBeUndefined();
    engine.destroy();
  });

  it("un link a una nota che non è sulla lavagna si apre accanto, col wikilink com'è, e la vista non si muove", async () => {
    setReducedMotionPreference(true);
    const { renderer, followed } = linkNoteRenderer();
    const onOpenWikilinkBeside = vi.fn();
    const onOpenWikilink = vi.fn();
    const { engine, host, viewport } = mounted(boardSource(LINK_BOARD), {
      cards: cardsOf(renderer),
      resolveCardLink: resolving({ Altra: "Lontana.md" }),
      onOpenWikilinkBeside,
      onOpenWikilink,
    });
    const before = cameraOf(host);
    clickOn(viewport, anchorOf(host, "n", "sec"), { ctrlKey: true });
    await settle();
    expect(onOpenWikilinkBeside).toHaveBeenCalledWith("Altra", "Titolo", null);
    expect(onOpenWikilink).not.toHaveBeenCalled();
    expect(followed).toEqual([]);
    expect(cameraOf(host)).toBe(before);
    expect(card(host, "far").dataset.cardFlash).toBeUndefined();
    expect(engine.jumpBack()).toBe(false);
    engine.destroy();
  });

  it("un link rotto va dove va quello delle note: al riquadro, che per un wikilink crea la nota che manca", async () => {
    const { renderer } = linkNoteRenderer();
    const onOpenWikilinkBeside = vi.fn();
    const onOpenWikilink = vi.fn();
    const { engine, host, viewport } = mounted(boardSource(LINK_BOARD), {
      cards: cardsOf(renderer),
      resolveCardLink: resolving({}),
      onOpenWikilinkBeside,
      onOpenWikilink,
    });
    clickOn(viewport, anchorOf(host, "n", "rotta"), { ctrlKey: true });
    await settle();
    expect(onOpenWikilink).toHaveBeenCalledWith("Rotta", null, null);
    expect(onOpenWikilinkBeside).not.toHaveBeenCalled();
    engine.destroy();
  });

  it("dentro la scheda attiva un clic su un link a un file lo segue la tela; un indirizzo web resta alla montatura", async () => {
    const { renderer, followed } = linkNoteRenderer();
    const { engine, host, viewport } = mounted(boardSource(LINK_BOARD), {
      cards: cardsOf(renderer),
      resolveCardLink: resolving({ Altra: "Altra.md" }),
    });
    // Due clic sul testo: il primo sceglie, il secondo entra.
    clickOn(viewport, card(host, "n").querySelector<HTMLElement>(".link-text")!);
    clickOn(viewport, card(host, "n").querySelector<HTMLElement>(".link-text")!);
    expect(activeOf(host)).toEqual(["n"]);
    clickOn(viewport, anchorOf(host, "n", "wiki"));
    await settle();
    expect(followed).toEqual([]);
    expect(card(host, "near").dataset.cardFlash).toBe("pulse");
    clickOn(viewport, anchorOf(host, "n", "web"));
    expect(followed).toEqual(["n:web"]);
    engine.destroy();
  });

  it("senza la porta di risoluzione i link delle schede si seguono come prima, dalla montatura", () => {
    const { renderer, followed } = linkNoteRenderer();
    const { engine, host, viewport } = mounted(boardSource(LINK_BOARD), { cards: cardsOf(renderer) });
    clickOn(viewport, anchorOf(host, "n", "wiki"), { ctrlKey: true });
    expect(followed).toEqual(["n:wiki"]);
    expect(card(host, "near").dataset.cardFlash).toBeUndefined();
    engine.destroy();
  });

  it("la lavagna chiusa mentre la shell risolve il link non apre né salta niente", async () => {
    const { renderer } = linkNoteRenderer();
    let answer: (doc: string | null) => void = () => {};
    const resolve = vi.fn(() => new Promise<string | null>((done) => {
      answer = done;
    }));
    const onOpenWikilinkBeside = vi.fn();
    const { engine, host, viewport } = mounted(boardSource(LINK_BOARD), {
      cards: cardsOf(renderer),
      resolveCardLink: resolve,
      onOpenWikilinkBeside,
    });
    clickOn(viewport, anchorOf(host, "n", "sec"), { ctrlKey: true });
    engine.destroy();
    answer("Lontana.md");
    await settle();
    expect(resolve).toHaveBeenCalledTimes(1);
    expect(onOpenWikilinkBeside).not.toHaveBeenCalled();
  });

  it("il lampo dura un momento e il timer lo toglie; distruggere la lavagna lo ferma senza errori", async () => {
    vi.useFakeTimers();
    const { renderer } = linkNoteRenderer();
    const { engine, host, viewport } = mounted(boardSource(LINK_BOARD), {
      cards: cardsOf(renderer),
      resolveCardLink: resolving({ Altra: "Altra.md" }),
    });
    clickOn(viewport, anchorOf(host, "n", "wiki"), { ctrlKey: true });
    await settle();
    expect(card(host, "near").dataset.cardFlash).toBe("pulse");
    vi.advanceTimersByTime(999);
    expect(card(host, "near").dataset.cardFlash).toBe("pulse");
    vi.advanceTimersByTime(1);
    expect(card(host, "near").dataset.cardFlash).toBeUndefined();
    clickOn(viewport, anchorOf(host, "n", "wiki"), { ctrlKey: true });
    await settle();
    expect(card(host, "near").dataset.cardFlash).toBe("pulse");
    engine.destroy();
    expect(() => vi.advanceTimersByTime(2000)).not.toThrow();
  });
});
