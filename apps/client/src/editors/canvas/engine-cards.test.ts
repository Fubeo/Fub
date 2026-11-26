// @vitest-environment happy-dom
// La tela tiene le schede (N6 T11): la resa è a chiavi, e una vista montata
// sopravvive a una modifica che non riguarda la sua scheda. Vivono solo le
// schede utili (N6 T13): quelle in vista, a gesto finito, con la penna su.
// Il file che manca (N6 T16): il segnaposto con «Ritrova…» e «Togli», e la
// vista che si rimonta quando il file torna.
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { SurfaceMenuItem } from "../core/editor-menu";
import { CARD_PAUSE_MS, WHEEL_SETTLE_MS } from "./engine";
import { LIVE_ZOOM_MIN, MAX_LIVE_CARDS, type CardRenderer } from "../core/cards/contract";
import { canvasCoreReady } from "./wasm/core";
import structure from "../../theme/scrittoio/structure.css?raw";
import { Mounted, TWO, actionOf, boardSource, bodyOf, card, cardsOf, cardsWith, defaultNodes, fakeFiles, fakeRenderer, image, liveOf, modeRenderer, mounted, panStart, readNodes, settle, syncNode, wheelTick, zoomOf } from "./engine-cards-test-support";

beforeAll(async () => {
  await canvasCoreReady();
});

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

/** Le viste ancora vive, per scheda. */
function alive(mounts: readonly Mounted[]): string[] {
  return mounts.filter((entry) => entry.destroyed === 0).map((entry) => entry.node).sort();
}

function drag(viewport: HTMLElement, from: HTMLElement, dx: number, dy: number, pointerId: number): void {
  from.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, pointerId, clientX: 10, clientY: 10 }));
  viewport.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, pointerId, clientX: 10 + dx, clientY: 10 + dy }));
  viewport.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerId, clientX: 10 + dx, clientY: 10 + dy }));
}

describe("la tela tiene le schede", () => {
  it("monta ogni scheda di file e di link una volta, ferma, con specie e modo sulla scheda", () => {
    const { renderer, mounts } = fakeRenderer();
    const { engine, host } = mounted(boardSource(), { cards: cardsOf(renderer) });
    expect(mounts.map((entry) => entry.node)).toEqual(["n", "i", "w"]);
    expect(mounts.every((entry) => entry.mode === "snapshot")).toBe(true);
    expect(card(host, "n").dataset.cardKind).toBe("note");
    expect(card(host, "i").dataset.cardKind).toBe("image");
    expect(card(host, "w").dataset.cardKind).toBe("web");
    // Montata ferma, poi accesa dalla tela perché è in vista (T13).
    expect(card(host, "n").dataset.cardMode).toBe("live");
    // Il testo si disegna come prima: nessuna specie, nessuna vista.
    expect(card(host, "t").dataset.cardKind).toBeUndefined();
    expect(mounts[0]!.host).toBe(bodyOf(host, "n"));
    expect(bodyOf(host, "n").querySelector(".fake-card")).not.toBeNull();
    // Il contesto: il file senza subpath, la lavagna, la misura e lo zoom.
    const context = mounts[0]!.context;
    expect(context.path).toBe("Note/idea.md");
    expect(context.subpath).toBeNull();
    expect(context.documentId).toBe("board.canvas");
    expect(context.size()).toEqual({ width: 240, height: 160 });
    expect(context.zoom()).toBeGreaterThan(0);
    expect(context.lifetime.closed).toBe(false);
    expect(mounts[2]!.context.path).toBe("");
    engine.destroy();
  });

  it("spostare, ridimensionare, colorare o scrivere in un'altra scheda non rimonta niente", () => {
    vi.useFakeTimers();
    try {
      const { renderer, mounts } = fakeRenderer();
      const { engine, host, viewport, changes } = mounted(boardSource(), { cards: cardsOf(renderer) });
      const noteBody = bodyOf(host, "n");
      const imageCard = card(host, "i");

      // Spostare l'immagine col mouse.
      drag(viewport, imageCard.querySelector<HTMLElement>(".canvas-node-handle")!, 40, 0, 3);
      expect(changes).toHaveLength(1);
      expect(readNodes(engine.getDoc()).find((node) => node.id === "i")!.x).toBe(360);
      // Ridimensionarla dalla maniglia.
      drag(viewport, imageCard.querySelector<HTMLElement>("[data-resize]")!, 40, 40, 4);
      expect(changes).toHaveLength(2);
      expect(readNodes(engine.getDoc()).find((node) => node.id === "i")!.width).toBe(280);
      // La misura nuova arriva alla vista dal contesto, senza rimontarla.
      expect(mounts[1]!.context.size()).toEqual({ width: 280, height: 200 });
      // Colorarla dal menu.
      vi.spyOn(document, "elementFromPoint").mockReturnValue(imageCard);
      const menu = engine.contextMenu({ x: 10, y: 10 })!;
      const color = (menu.context as readonly SurfaceMenuItem[]).find((item) => item.id === "canvas.color")!;
      (color.items as readonly SurfaceMenuItem[]).find((item) => item.id === "canvas.color.4")!.run!();
      expect(readNodes(engine.getDoc()).find((node) => node.id === "i")!.color).toBe("4");
      // Scrivere nella scheda di testo: la pausa registra, Esc chiude il campo.
      card(host, "t").dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
      const input = host.querySelector<HTMLTextAreaElement>(".canvas-text-editor")!;
      input.value = "testo nuovo";
      input.dispatchEvent(new Event("input", { bubbles: true }));
      vi.advanceTimersByTime(CARD_PAUSE_MS);
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
      expect(readNodes(engine.getDoc()).find((node) => node.id === "t")!.text).toBe("testo nuovo");
      expect(host.querySelector(".canvas-text-editor")).toBeNull();
      expect(bodyOf(host, "t").textContent).toContain("testo nuovo");
      // Una modifica da fuori che sposta la nota e colora il link.
      syncNode(engine, "n", { x: 8, y: 8 });
      syncNode(engine, "w", { color: "2", width: 320 });
      expect(card(host, "n").style.transform).toBe("translate(8px, 8px)");

      expect(mounts.map((entry) => entry.node)).toEqual(["n", "i", "w"]);
      expect(mounts.every((entry) => entry.destroyed === 0)).toBe(true);
      expect(bodyOf(host, "n")).toBe(noteBody);
      expect(card(host, "i")).toBe(imageCard);
      engine.destroy();
    } finally {
      vi.useRealTimers();
    }
  });

  it("cambiare il file rimonta la sola scheda, col file nuovo", () => {
    const { renderer, mounts } = fakeRenderer();
    const { engine, host } = mounted(boardSource(), { cards: cardsOf(renderer) });
    const article = card(host, "i");
    syncNode(engine, "i", { file: "img/altra.png" });
    expect(mounts.map((entry) => [entry.node, entry.file, entry.destroyed])).toEqual([
      ["n", "Note/idea.md", 0],
      ["i", "img/foto.png", 1],
      ["w", undefined, 0],
      ["i", "img/altra.png", 0],
    ]);
    // La vita della vista vecchia è chiusa; la scheda resta lo stesso elemento.
    expect(mounts[1]!.context.lifetime.closed).toBe(true);
    expect(card(host, "i")).toBe(article);
    expect(bodyOf(host, "i").textContent).toBe("i:img/altra.png");
    // Il subpath e l'indirizzo contano come il file.
    syncNode(engine, "n", { subpath: "#Titolo" });
    syncNode(engine, "w", { url: "https://example.org/" });
    expect(mounts.slice(4).map((entry) => [entry.node, entry.context.subpath])).toEqual([["n", "#Titolo"], ["w", null]]);
    expect(alive(mounts)).toEqual(["i", "n", "w"]);
    // Il file cambiato dal campo della scheda: il campo prende il posto della
    // vista, e alla chiusura nasce quella del file nuovo. Il doppio clic su
    // un'immagine è del visore (T14): il campo lo apre Invio, perché
    // nell'immagine non si entra.
    card(host, "i").focus();
    card(host, "i").dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    const field = host.querySelector<HTMLInputElement>(".canvas-field-editor")!;
    expect(mounts[3]!.destroyed).toBe(1);
    field.value = "img/terza.png";
    field.dispatchEvent(new Event("input", { bubbles: true }));
    field.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    expect(mounts[mounts.length - 1]!.file).toBe("img/terza.png");
    expect(alive(mounts)).toEqual(["i", "n", "w"]);
    engine.destroy();
  });

  it("togliere distrugge; l'annulla che la riporta monta una vista nuova", () => {
    const { renderer, mounts } = fakeRenderer();
    const { engine, host, viewport } = mounted(boardSource(), { cards: cardsOf(renderer) });
    card(host, "i").focus();
    viewport.dispatchEvent(new KeyboardEvent("keydown", { key: "Delete", bubbles: true, cancelable: true }));
    expect(card(host, "i")).toBeNull();
    expect(mounts[1]!.destroyed).toBe(1);
    expect(alive(mounts)).toEqual(["n", "w"]);
    expect(engine.undo()).toBe(true);
    expect(card(host, "i")).not.toBeNull();
    expect(mounts).toHaveLength(4);
    expect(mounts[3]!.node).toBe("i");
    expect(alive(mounts)).toEqual(["i", "n", "w"]);
    // L'ordine sulla scena è quello del file anche dopo il ritorno.
    expect([...host.querySelectorAll<HTMLElement>(".canvas-node")].map((el) => el.dataset.node)).toEqual(["n", "i", "t", "w"]);
    engine.destroy();
  });

  it("setDoc con le stesse schede non rimonta; un id cambiato con lo stesso file sì", () => {
    const { renderer, mounts } = fakeRenderer();
    const { engine, host } = mounted(boardSource(), { cards: cardsOf(renderer) });
    engine.setDoc(boardSource());
    expect(mounts).toHaveLength(3);
    const nodes = defaultNodes();
    nodes[1] = { ...nodes[1], id: "i2" };
    engine.setDoc(boardSource(nodes));
    expect(mounts.map((entry) => [entry.node, entry.destroyed])).toEqual([["n", 0], ["i", 1], ["w", 0], ["i2", 0]]);
    expect(card(host, "i")).toBeNull();
    expect(card(host, "i2").dataset.cardKind).toBe("image");
    engine.destroy();
  });

  it("l'ordine cambia senza rimontare: la scheda portata davanti è l'ultima", () => {
    const { renderer, mounts } = fakeRenderer();
    const { engine, host } = mounted(boardSource(), { cards: cardsOf(renderer) });
    const nodes = defaultNodes();
    engine.syncDoc(boardSource([nodes[1]!, nodes[3]!, nodes[2]!, nodes[0]!]));
    expect([...host.querySelectorAll<HTMLElement>(".canvas-node")].map((el) => el.dataset.node)).toEqual(["i", "w", "t", "n"]);
    expect(mounts).toHaveLength(3);
    expect(alive(mounts)).toEqual(["i", "n", "w"]);
    engine.destroy();
  });

  it("destroy della tela distrugge ogni vista una volta", () => {
    const { renderer, mounts } = fakeRenderer();
    const { engine } = mounted(boardSource(), { cards: cardsOf(renderer) });
    engine.destroy();
    engine.destroy();
    expect(mounts.map((entry) => entry.destroyed)).toEqual([1, 1, 1]);
    expect(mounts.every((entry) => entry.context.lifetime.closed)).toBe(true);
    // Dopo la tela, niente rinasce.
    engine.syncDoc(boardSource());
    expect(mounts).toHaveLength(3);
  });

  it("un renderer che lancia in mount lascia la scheda di file di sempre, e la tela va avanti", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { renderer, mounts } = fakeRenderer(["note", "web"]);
    const broken: CardRenderer = {
      kinds: ["image"],
      mount: () => {
        throw new Error("rotto");
      },
    };
    const { engine, host, viewport, changes } = mounted(boardSource(), { cards: cardsOf(renderer, broken) });
    expect(warn).toHaveBeenCalled();
    expect(card(host, "i").dataset.cardKind).toBeUndefined();
    expect(bodyOf(host, "i").querySelector(".canvas-file-link")?.textContent).toBe("img/foto.png");
    expect(alive(mounts)).toEqual(["n", "w"]);
    // La tela risponde ancora ai gesti.
    viewport.focus();
    viewport.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    viewport.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    expect(changes).toHaveLength(1);
    expect(alive(mounts)).toEqual(["n", "w"]);
    engine.destroy();
  });

  it("una vista che lancia nel distruggersi non ferma le altre", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const destroyed: string[] = [];
    const renderer: CardRenderer = {
      kinds: ["note", "image", "web"],
      mount: (node) => ({
        setMode: () => {},
        destroy: () => {
          destroyed.push(node.id);
          if (node.id === "n") throw new Error("rotto");
        },
      }),
    };
    const { engine } = mounted(boardSource(), { cards: cardsOf(renderer) });
    engine.destroy();
    expect(destroyed).toEqual(["n", "i", "w"]);
  });

  it("missing() dice che il file manca, smonta la vista e ascolta il file; una vista già distrutta non parla più", () => {
    const files = fakeFiles();
    const { renderer, mounts } = fakeRenderer();
    const { engine, host } = mounted(boardSource(), { cards: cardsWith(files, renderer), onPickFile: () => null });
    mounts[1]!.context.missing();
    expect(card(host, "i").dataset.cardMissing).toBe("true");
    expect(card(host, "i").dataset.cardKind).toBeUndefined();
    expect(mounts[1]!.destroyed).toBe(1);
    expect(bodyOf(host, "i").querySelector(".canvas-media-placeholder")?.textContent).toBe("File mancante: img/foto.png");
    expect(actionOf(host, "i", "relink")).not.toBeNull();
    expect(actionOf(host, "i", "remove")).not.toBeNull();
    expect(files.count("img/foto.png")).toBe(1);
    // Una vista già distrutta non parla più: né per la sua scheda, né dopo.
    mounts[1]!.context.missing();
    expect(mounts).toHaveLength(3);
    syncNode(engine, "n", { file: "Note/altra.md" });
    mounts[0]!.context.missing();
    expect(card(host, "n").dataset.cardMissing).toBeUndefined();
    expect(bodyOf(host, "n").textContent).toBe("n:Note/altra.md");
    engine.destroy();
    expect(files.count("img/foto.png")).toBe(0);
  });

  it("il file che torna rimonta la vista da sé; se manca ancora, la scheda torna mancante", () => {
    const files = fakeFiles();
    const { renderer, mounts } = fakeRenderer();
    const { engine, host } = mounted(boardSource(), { cards: cardsWith(files, renderer), onPickFile: () => null });
    mounts[1]!.context.missing();
    files.fire("img/foto.png");
    expect(mounts).toHaveLength(4);
    expect(mounts[3]!.node).toBe("i");
    expect(card(host, "i").dataset.cardMissing).toBeUndefined();
    expect(card(host, "i").dataset.cardKind).toBe("image");
    expect(bodyOf(host, "i").textContent).toBe("i:img/foto.png");
    expect(files.count("img/foto.png")).toBe(0);
    // Il file c'è ancora nella lista ma non si apre: il renderer dice di nuovo «manca».
    mounts[3]!.context.missing();
    expect(card(host, "i").dataset.cardMissing).toBe("true");
    expect(files.count("img/foto.png")).toBe(1);
    engine.destroy();
  });

  it("«Ritrova…» chiede il file col nome di quello che manca, lo mette al posto del percorso in un commit solo, e un annulla lo riporta", async () => {
    const files = fakeFiles();
    const { renderer, mounts } = fakeRenderer();
    const asked: (string | undefined)[] = [];
    const { engine, host, changes } = mounted(boardSource(), {
      cards: cardsWith(files, renderer),
      onPickFile: (name) => {
        asked.push(name);
        return "Archivio/foto.png";
      },
    });
    mounts[1]!.context.missing();
    actionOf(host, "i", "relink")!.click();
    await settle();
    expect(asked).toEqual(["foto.png"]);
    expect(readNodes(engine.getDoc()).find((node) => node.id === "i")!.file).toBe("Archivio/foto.png");
    expect(changes).toHaveLength(1);
    // La scheda ha la vista del file nuovo, e non è più mancante.
    const last = mounts[mounts.length - 1]!;
    expect(last.node).toBe("i");
    expect(last.file).toBe("Archivio/foto.png");
    expect(card(host, "i").dataset.cardMissing).toBeUndefined();
    expect(files.count("img/foto.png")).toBe(0);
    // Un annulla riporta il file di prima.
    expect(engine.undo()).toBe(true);
    expect(readNodes(engine.getDoc()).find((node) => node.id === "i")!.file).toBe("img/foto.png");
    engine.destroy();
  });

  it("«Ritrova…» annullato, o senza un file scelto, non cambia niente", async () => {
    const files = fakeFiles();
    const { renderer, mounts } = fakeRenderer();
    const { engine, host, changes } = mounted(boardSource(), { cards: cardsWith(files, renderer), onPickFile: () => null });
    mounts[1]!.context.missing();
    actionOf(host, "i", "relink")!.click();
    await settle();
    expect(changes).toHaveLength(0);
    expect(readNodes(engine.getDoc()).find((node) => node.id === "i")!.file).toBe("img/foto.png");
    expect(card(host, "i").dataset.cardMissing).toBe("true");
    engine.destroy();
  });

  it("il file torna mentre il selettore è aperto: la scelta vecchia non tocca la scheda", async () => {
    const files = fakeFiles();
    const { renderer, mounts } = fakeRenderer();
    let answer: (path: string | null) => void = () => {};
    const { engine, host, changes } = mounted(boardSource(), {
      cards: cardsWith(files, renderer),
      onPickFile: () => new Promise<string | null>((resolve) => {
        answer = resolve;
      }),
    });
    mounts[1]!.context.missing();
    actionOf(host, "i", "relink")!.click();
    files.fire("img/foto.png");
    expect(card(host, "i").dataset.cardMissing).toBeUndefined();
    expect(card(host, "i").dataset.cardKind).toBe("image");
    answer("Archivio/altra.png");
    await settle();
    expect(changes).toHaveLength(0);
    expect(readNodes(engine.getDoc()).find((node) => node.id === "i")!.file).toBe("img/foto.png");
    engine.destroy();
  });

  it("«Togli dalla lavagna» toglie la scheda come Canc, e un annulla la riporta", () => {
    const files = fakeFiles();
    const { renderer, mounts } = fakeRenderer();
    const { engine, host, changes } = mounted(boardSource(), { cards: cardsWith(files, renderer), onPickFile: () => null });
    mounts[1]!.context.missing();
    actionOf(host, "i", "remove")!.click();
    expect(readNodes(engine.getDoc()).map((node) => node.id)).toEqual(["n", "t", "w"]);
    expect(changes).toHaveLength(1);
    expect(host.querySelector('.canvas-node[data-node="i"]')).toBeNull();
    expect(mounts[1]!.destroyed).toBe(1);
    expect(files.count("img/foto.png")).toBe(0);
    expect(engine.undo()).toBe(true);
    expect(readNodes(engine.getDoc()).map((node) => node.id).sort()).toEqual(["i", "n", "t", "w"]);
    engine.destroy();
  });

  it("in sola lettura il segnaposto dice che il file manca e non ha gesti; tornando scrivibile li riprende", () => {
    const files = fakeFiles();
    const { renderer, mounts } = fakeRenderer();
    const { engine, host } = mounted(boardSource(), { cards: cardsWith(files, renderer), onPickFile: () => null });
    mounts[1]!.context.missing();
    engine.setReadOnly(true);
    expect(bodyOf(host, "i").querySelector(".canvas-media-placeholder")?.textContent).toBe("File mancante: img/foto.png");
    expect(host.querySelector("[data-card-action]")).toBeNull();
    engine.setReadOnly(false);
    expect(actionOf(host, "i", "relink")).not.toBeNull();
    expect(actionOf(host, "i", "remove")).not.toBeNull();
    engine.destroy();
  });

  it("senza un selettore di file «Ritrova…» non c'è, e «Togli» sì", () => {
    const files = fakeFiles();
    const { renderer, mounts } = fakeRenderer();
    const { engine, host } = mounted(boardSource(), { cards: cardsWith(files, renderer), onPickFile: undefined });
    mounts[1]!.context.missing();
    expect(actionOf(host, "i", "relink")).toBeNull();
    expect(actionOf(host, "i", "remove")).not.toBeNull();
    engine.destroy();
  });

  it("una scheda di link non manca mai: il suo missing() non fa niente", () => {
    const files = fakeFiles();
    const { renderer, mounts } = fakeRenderer();
    const { engine, host } = mounted(boardSource(), { cards: cardsWith(files, renderer), onPickFile: () => null });
    const link = mounts.find((entry) => entry.node === "w")!;
    link.context.missing();
    expect(card(host, "w").dataset.cardMissing).toBeUndefined();
    expect(link.destroyed).toBe(0);
    engine.destroy();
  });

  it("un renderer che dice «manca» mentre monta: la scheda è mancante quando la vista c'è, e la vista si smonta una volta", () => {
    const files = fakeFiles();
    let destroyed = 0;
    const renderer: CardRenderer = {
      kinds: ["image"],
      mount: (_node, _host, _mode, context) => {
        context.missing();
        return {
          setMode: () => {},
          destroy: () => {
            destroyed++;
          },
        };
      },
    };
    const { engine, host } = mounted(boardSource([defaultNodes()[1]!]), { cards: cardsWith(files, renderer), onPickFile: () => null });
    expect(card(host, "i").dataset.cardMissing).toBe("true");
    expect(destroyed).toBe(1);
    expect(files.count("img/foto.png")).toBe(1);
    engine.destroy();
    expect(destroyed).toBe(1);
  });

  it("molte schede mancanti insieme: ognuna ha il suo file, e ritorna solo quella il cui file torna", () => {
    const files = fakeFiles();
    const { renderer, mounts } = fakeRenderer(["image"]);
    const many = Array.from({ length: 5 }, (_, index) => ({
      id: `f${index}`, type: "file", x: index * 300, y: 0, width: 240, height: 160, file: `Cartella/f${index}.png`,
    }));
    const { engine, host } = mounted(boardSource(many), { cards: cardsWith(files, renderer), onPickFile: () => null });
    for (const entry of mounts) entry.context.missing();
    for (let index = 0; index < 5; index++) {
      expect(card(host, `f${index}`).dataset.cardMissing).toBe("true");
      expect(files.count(`Cartella/f${index}.png`)).toBe(1);
    }
    files.fire("Cartella/f2.png");
    expect(mounts).toHaveLength(6);
    expect(mounts[5]!.node).toBe("f2");
    expect(card(host, "f2").dataset.cardMissing).toBeUndefined();
    for (const index of [0, 1, 3, 4]) expect(card(host, `f${index}`).dataset.cardMissing).toBe("true");
    engine.destroy();
  });

  it("un file mancante non si rifà a ogni resa: spostare un'altra scheda lascia il suo segnaposto com'è", () => {
    const files = fakeFiles();
    const { renderer, mounts } = fakeRenderer();
    const { engine, host } = mounted(boardSource(), { cards: cardsWith(files, renderer), onPickFile: () => null });
    mounts[1]!.context.missing();
    const placeholder = bodyOf(host, "i");
    syncNode(engine, "n", { x: 40 });
    expect(bodyOf(host, "i")).toBe(placeholder);
    expect(mounts).toHaveLength(3);
    expect(card(host, "i").dataset.cardMissing).toBe("true");
    engine.destroy();
  });

  it("in sola lettura le viste restano e le maniglie se ne vanno", () => {
    const { renderer, mounts } = fakeRenderer();
    const { engine, host } = mounted(boardSource(), { cards: cardsOf(renderer) });
    engine.setReadOnly(true);
    expect(host.querySelector("[data-resize]")).toBeNull();
    expect(host.querySelector(".canvas-convert-note")).toBeNull();
    engine.setReadOnly(false);
    // Quattro schede, quattro maniglie ciascuna (T66).
    expect(host.querySelectorAll("[data-resize]")).toHaveLength(16);
    expect(mounts).toHaveLength(3);
    expect(alive(mounts)).toEqual(["i", "n", "w"]);
    engine.destroy();
  });

  it("oltre il limite delle schede nessuna vista; tornati sotto, rinascono", () => {
    const { renderer, mounts } = fakeRenderer();
    const { engine, host } = mounted(boardSource(), { cards: cardsOf(renderer) });
    const many = Array.from({ length: 2001 }, (_, index) => ({
      id: `c${index}`, type: "file", x: index * 8, y: 0, width: 40, height: 40, file: `img/${index}.png`,
    }));
    engine.setDoc(boardSource(many));
    expect(host.querySelector(".canvas-large-fallback")).not.toBeNull();
    expect(host.querySelector(".canvas-node")).toBeNull();
    expect(mounts).toHaveLength(3);
    expect(alive(mounts)).toEqual([]);
    engine.setDoc(boardSource());
    expect(host.querySelector(".canvas-large-fallback")).toBeNull();
    expect(alive(mounts)).toEqual(["i", "n", "w"]);
    engine.destroy();
  });

  it("senza le schede la tela disegna i corpi di sempre, e li tiene", () => {
    const { engine, host, viewport } = mounted(boardSource());
    expect(card(host, "i").dataset.cardKind).toBeUndefined();
    expect(bodyOf(host, "i").querySelector(".canvas-file-link")?.textContent).toBe("img/foto.png");
    const textBody = bodyOf(host, "t");
    const fileBody = bodyOf(host, "i");
    const article = card(host, "n");
    drag(viewport, card(host, "w").querySelector<HTMLElement>(".canvas-node-handle")!, 16, 16, 5);
    expect(bodyOf(host, "t")).toBe(textBody);
    expect(bodyOf(host, "i")).toBe(fileBody);
    expect(card(host, "n")).toBe(article);
    // Le sintassi nuove rifanno i corpi di testo.
    engine.setSyntaxForms([]);
    expect(bodyOf(host, "t")).not.toBe(textBody);
    expect(bodyOf(host, "i")).toBe(fileBody);
    engine.destroy();
  });
});

/** Un evento della penna (o, con `pointerType`, del dito). */
function penEvent(type: string, init: PointerEventInit): PointerEvent {
  return new PointerEvent(type, {
    bubbles: true, cancelable: true, composed: true, altitudeAngle: Math.PI / 2, azimuthAngle: 0,
    pointerId: 7, pointerType: "pen", isPrimary: true, ...init,
  });
}

describe("vivono solo le schede utili", () => {
  it("dopo lo spostamento le schede in vista sono vive e le altre ferme; durante, nessuna cambia", () => {
    const { renderer, log } = modeRenderer();
    const { engine, host, viewport } = mounted(boardSource(TWO), { cards: cardsOf(renderer) });
    // Inquadrate, tutte e due in vista: vive, e chiamate una volta.
    expect(liveOf(host)).toEqual(["a", "b"]);
    expect(log).toEqual([["a", "live"], ["b", "live"]]);
    log.length = 0;
    // A sinistra di 800 px: la vista va da 700 a 1500, allargata da 300 a
    // 1900. «a» (0–200) ne esce, «b» (400–600) resta.
    const up = panStart(viewport, -800, 0);
    expect(log).toEqual([]);
    expect(liveOf(host)).toEqual(["a", "b"]);
    up();
    expect(log).toEqual([["a", "snapshot"]]);
    expect(liveOf(host)).toEqual(["b"]);
    expect(card(host, "a").dataset.cardMode).toBe("snapshot");
    // Si torna: «a» si riaccende, «b» non riceve niente.
    panStart(viewport, 800, 0)();
    expect(log).toEqual([["a", "snapshot"], ["a", "live"]]);
    engine.destroy();
  });

  it("una scheda trascinata da fuori a dentro la vista si accende a fine gesto", () => {
    const { renderer, log } = modeRenderer();
    const { engine, host, viewport } = mounted(boardSource(TWO), { cards: cardsOf(renderer) });
    // Una scheda arrivata da fuori, lontana: nasce ferma e resta ferma.
    engine.syncDoc(boardSource([...TWO, image("c", 5000, 0)]));
    expect(liveOf(host)).toEqual(["a", "b"]);
    log.length = 0;
    const handle = card(host, "c").querySelector<HTMLElement>(".canvas-node-handle")!;
    handle.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, pointerId: 3, clientX: 10, clientY: 10 }));
    viewport.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, pointerId: 3, clientX: 10 - 4800, clientY: 10 + 200 }));
    expect(log).toEqual([]);
    viewport.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerId: 3, clientX: 10 - 4800, clientY: 10 + 200 }));
    expect(readNodes(engine.getDoc()).find((node) => node.id === "c")!.x).toBe(200);
    expect(log).toEqual([["c", "live"]]);
    expect(liveOf(host)).toEqual(["a", "b", "c"]);
    engine.destroy();
  });

  it("sotto 0,35 nessuna è viva; lo zoom che attraversa 0,35 in un gesto solo non cambia niente", () => {
    vi.useFakeTimers();
    try {
      const { renderer, log } = modeRenderer();
      const { engine, host, viewport } = mounted(boardSource(TWO), { cards: cardsOf(renderer) });
      // La misura vera del viewport: i tasti ingrandiscono attorno al suo centro.
      vi.spyOn(viewport, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 800, 600));
      log.length = 0;
      // Dodici scatti indietro e dodici avanti, senza fermarsi: lo zoom passa
      // sotto 0,35 e torna, e nessuna scheda cambia modo.
      for (const zoomIn of [...Array<boolean>(12).fill(false), ...Array<boolean>(12).fill(true)]) {
        wheelTick(viewport, zoomIn);
        vi.advanceTimersByTime(WHEEL_SETTLE_MS - 50);
      }
      expect(zoomOf(host)).toBeCloseTo(1);
      vi.advanceTimersByTime(WHEEL_SETTLE_MS);
      expect(log).toEqual([]);
      // Dodici scatti indietro e poi fermi: sotto 0,35, ma solo a gesto finito.
      for (let tick = 0; tick < 12; tick++) {
        wheelTick(viewport, false);
        vi.advanceTimersByTime(WHEEL_SETTLE_MS - 50);
      }
      expect(zoomOf(host)).toBeLessThan(LIVE_ZOOM_MIN);
      expect(log).toEqual([]);
      expect(liveOf(host)).toEqual(["a", "b"]);
      vi.advanceTimersByTime(WHEEL_SETTLE_MS);
      expect(liveOf(host)).toEqual([]);
      expect(log).toEqual([["a", "snapshot"], ["b", "snapshot"]]);
      // Dai tasti lo zoom è un gesto finito: risale e si riaccendono subito.
      log.length = 0;
      for (let step = 0; step < 6; step++) {
        viewport.dispatchEvent(new KeyboardEvent("keydown", { key: "+", ctrlKey: true, bubbles: true, cancelable: true }));
      }
      expect(zoomOf(host)).toBeGreaterThan(LIVE_ZOOM_MIN);
      expect(liveOf(host)).toEqual(["a", "b"]);
      engine.destroy();
    } finally {
      vi.useRealTimers();
    }
  });

  it("300 schede in vista a zoom 0,4: ne vivono 40, e mai più di MAX_LIVE_CARDS", () => {
    vi.useFakeTimers();
    try {
      const { renderer, log } = modeRenderer();
      // 20 × 15 schede di 40 × 40 ogni 50: la tela le inquadra a zoom 0,66.
      const many = Array.from({ length: 300 }, (_, index) => image(`c${index}`, (index % 20) * 50, Math.floor(index / 20) * 50, 40, 40));
      const { engine, host, viewport } = mounted(boardSource(many), { cards: cardsOf(renderer) });
      let most = 0;
      const live = new Set<string>();
      const replay = () => {
        for (const [id, mode] of log.splice(0)) {
          if (mode === "live") live.add(id);
          else live.delete(id);
          most = Math.max(most, live.size);
        }
      };
      replay();
      expect(live.size).toBe(MAX_LIVE_CARDS);
      for (let tick = 0; tick < 5; tick++) wheelTick(viewport, false);
      vi.advanceTimersByTime(WHEEL_SETTLE_MS);
      expect(zoomOf(host)).toBeGreaterThanOrEqual(LIVE_ZOOM_MIN);
      expect(zoomOf(host)).toBeLessThan(0.42);
      replay();
      expect(liveOf(host)).toHaveLength(MAX_LIVE_CARDS);
      expect(live.size).toBe(MAX_LIVE_CARDS);
      expect(most).toBe(MAX_LIVE_CARDS);
      engine.destroy();
    } finally {
      vi.useRealTimers();
    }
  });

  it("con la penna giù nessuna scheda cambia modo fino a quando si alza", async () => {
    const { renderer, log } = modeRenderer();
    const { engine, host, viewport } = mounted(boardSource(TWO), { cards: cardsOf(renderer) });
    log.length = 0;
    viewport.dispatchEvent(penEvent("pointerdown", { clientX: 300, clientY: 500, button: 0, buttons: 1, pressure: 0.5 }));
    panStart(viewport, -800, 0)();
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(log).toEqual([]);
    expect(liveOf(host)).toEqual(["a", "b"]);
    document.dispatchEvent(penEvent("pointerup", { clientX: 300, clientY: 500, button: 0, buttons: 0, pressure: 0 }));
    await vi.waitFor(() => expect(log).toEqual([["a", "snapshot"]]));
    expect(liveOf(host)).toEqual(["b"]);
    engine.destroy();
  });

  it("la penna che si posa durante uno spostamento col dito: il cambio aspetta che si alzi", async () => {
    const { renderer, log } = modeRenderer();
    const { engine, host, viewport } = mounted(boardSource(TWO), { cards: cardsOf(renderer) });
    log.length = 0;
    const touch = { pointerId: 1, pointerType: "touch", isPrimary: false, width: 10, height: 10 } as const;
    viewport.dispatchEvent(penEvent("pointerdown", { ...touch, clientX: 400, clientY: 300, button: 0, buttons: 1, pressure: 0.5 }));
    viewport.dispatchEvent(penEvent("pointermove", { ...touch, clientX: -400, clientY: 300, button: -1, buttons: 1, pressure: 0.5 }));
    // La penna si posa lontano dal dito: il dito si ferma dov'è arrivato.
    viewport.dispatchEvent(penEvent("pointerdown", { clientX: 100, clientY: 550, button: 0, buttons: 1, pressure: 0.5 }));
    viewport.dispatchEvent(penEvent("pointermove", { ...touch, clientX: -380, clientY: 300, button: -1, buttons: 1, pressure: 0.5 }));
    viewport.dispatchEvent(penEvent("pointerup", { ...touch, clientX: -380, clientY: 300, button: 0, buttons: 0, pressure: 0 }));
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(log).toEqual([]);
    document.dispatchEvent(penEvent("pointerup", { clientX: 100, clientY: 550, button: 0, buttons: 0, pressure: 0 }));
    await vi.waitFor(() => expect(log).toEqual([["a", "snapshot"]]));
    expect(liveOf(host)).toEqual(["b"]);
    engine.destroy();
  });

  it("la lavagna nascosta non cambia niente finché non torna in vista", () => {
    const observers: (() => void)[] = [];
    vi.stubGlobal("ResizeObserver", class {
      readonly #callback: () => void;
      constructor(callback: () => void) {
        this.#callback = callback;
      }
      // Solo quello della vista: la riga delle opzioni (T50) ha il suo, che
      // misura la riga e non le schede.
      observe(target: Element): void {
        if (target.classList.contains("canvas-viewport")) observers.push(this.#callback);
      }
      unobserve(): void {}
      disconnect(): void {
        const at = observers.indexOf(this.#callback);
        if (at >= 0) observers.splice(at, 1);
      }
    });
    try {
      const { renderer, log } = modeRenderer();
      const { engine, host, viewport } = mounted(boardSource(TWO), { cards: cardsOf(renderer) });
      expect(observers).toHaveLength(1);
      log.length = 0;
      // Un'altra linguetta: il riquadro della lavagna è nascosto.
      host.hidden = true;
      panStart(viewport, -800, 0)();
      engine.syncDoc(boardSource([...TWO, image("c", 600, 100)]));
      for (const notify of [...observers]) notify();
      expect(log).toEqual([]);
      expect(liveOf(host)).toEqual(["a", "b"]);
      // Torna in vista: la vista cambia misura e la scelta si rifà.
      host.hidden = false;
      for (const notify of [...observers]) notify();
      expect(log).toEqual([["a", "snapshot"], ["c", "live"]]);
      expect(liveOf(host)).toEqual(["b", "c"]);
      engine.destroy();
      expect(observers).toHaveLength(0);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("resize() arriva alla scheda ridimensionata a fine gesto, una volta", () => {
    const { renderer, resized } = modeRenderer();
    const { engine, host, viewport } = mounted(boardSource(TWO), { cards: cardsOf(renderer) });
    const grip = card(host, "a").querySelector<HTMLElement>("[data-resize]")!;
    grip.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, pointerId: 4, clientX: 10, clientY: 10 }));
    viewport.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, pointerId: 4, clientX: 30, clientY: 30 }));
    viewport.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, pointerId: 4, clientX: 50, clientY: 50 }));
    expect(resized).toEqual([]);
    viewport.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerId: 4, clientX: 50, clientY: 50 }));
    expect(readNodes(engine.getDoc()).find((node) => node.id === "a")!.width).toBe(240);
    expect(resized).toEqual(["a"]);
    // Spostare non è ridimensionare; una misura arrivata da fuori sì.
    drag(viewport, card(host, "b").querySelector<HTMLElement>(".canvas-node-handle")!, 40, 0, 5);
    syncNode(engine, "b", { height: 200 });
    expect(resized).toEqual(["a", "b"]);
    engine.destroy();
  });
});

describe("il titolo sopra la scheda (T39, D-21 a)", () => {
  /// Le dichiarazioni della regola di `structure.css` col selettore `selector`.
  function ruleOf(selector: string): string | null {
    const at = structure.indexOf(`${selector} {`);
    if (at < 0) return null;
    const open = structure.indexOf("{", at);
    return structure.slice(open + 1, structure.indexOf("}", open));
  }

  it("le schede di file e di link portano il titolo fuori, sopra: il nodo non cambia e il nome resta", () => {
    const { renderer } = fakeRenderer();
    const source = boardSource();
    const { engine, host } = mounted(source, { cards: cardsOf(renderer) });
    for (const [id, name, spoken] of [["i", "foto.png", "foto.png"], ["n", "idea.md", "idea"], ["w", "example.com", "example.com"]] as const) {
      const article = card(host, id);
      // Il rettangolo è il nodo: la misura del file, niente in più per la testata.
      expect([article.style.width, article.style.height]).toEqual(["240px", id === "w" ? "120px" : "160px"]);
      const handle = article.querySelector<HTMLElement>(":scope > .canvas-node-handle")!;
      expect(handle.querySelector(".canvas-node-title")!.textContent).toContain(name);
      // Il titolo è un figlio della scheda, prima del corpo: la lettura a schermo resta quella.
      expect(article.firstElementChild).toBe(handle);
      article.focus();
      expect(article.getAttribute("aria-label")).toContain(spoken);
    }
    // Disegnare la tela non scrive niente nel file.
    expect(engine.getDoc()).toBe(source);
    engine.destroy();
  });

  it("la struttura mette la testata fuori, sopra il bordo, solo per le schede di file e di link", () => {
    const outside = ruleOf(".canvas-node-file > .canvas-node-handle,\n.canvas-node-link > .canvas-node-handle");
    expect(outside).not.toBeNull();
    expect(outside).toMatch(/position:\s*absolute;/);
    expect(outside).toMatch(/bottom:\s*100%;/);
    expect(outside).toMatch(/left:\s*0;/);
    expect(outside).toMatch(/right:\s*0;/);
    // Le schede di testo non cambiano. La testata di un gruppo sta dentro la
    // cornice, sopra il corpo (`top: 0`), mai fuori (#411 C-04).
    expect(structure).not.toMatch(/\.canvas-node-text > \.canvas-node-handle\s*[,{][^}]*position:\s*absolute/);
    expect(ruleOf(".canvas-node-group > .canvas-node-handle")).toMatch(/top:\s*0;/);
    expect(ruleOf(".canvas-node-group > .canvas-node-handle")).not.toMatch(/bottom:\s*100%/);
    // Il contenuto è un mondo a sé, sotto l'inchiostro e le maniglie.
    expect(ruleOf(".canvas-node-file > .canvas-card-body,\n.canvas-node-link > .canvas-card-body")).toMatch(/isolation:\s*isolate;/);
  });
});
