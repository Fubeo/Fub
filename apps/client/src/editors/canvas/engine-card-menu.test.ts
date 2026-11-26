// @vitest-environment happy-dom
// Le prove di `CanvasEngine`: il menu della scheda (T17), copia e incolla (T68), i colori sconosciuti (T47b).
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { MENU_RULE, type SurfaceMenuItem } from "../core/editor-menu";
import { CanvasEngine, type CanvasEngineOptions } from "./engine";
import type { CanvasDocument } from "./model";
import { readCanvasClipboard } from "./clipboard";
import { t } from "../../i18n/strings";
import { canvasCoreReady } from "./wasm/core";
import { type CanvasPreferences } from "./preferences";
import { mounted, readCanvas } from "./engine-test-support";

// Le impostazioni della lavagna (T35): il motore monta `watchPreferences`, e la
// prova tiene le sue funzioni per cambiare «La rotella del mouse» a lavagna
// aperta, come farebbe un cambio da Impostazioni. Il resto del modulo è quello vero.
const watched = vi.hoisted(() => ({ appliers: [] as Array<(preferences: CanvasPreferences) => void> }));

vi.mock("./preferences", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./preferences")>()),
  watchPreferences: (apply: (preferences: CanvasPreferences) => void) => {
    watched.appliers.push(apply);
    return () => {
      watched.appliers = watched.appliers.filter((other) => other !== apply);
    };
  },
}));

// Le notifiche della shell (T70, «Estrai in una nota»): la prova legge che
// cosa dicono e quale gesto offrono. Il resto del modulo è quello vero.
const notices = vi.hoisted(() => ({ notify: vi.fn() }));

vi.mock("../../ui/notify", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../ui/notify")>()),
  notify: notices.notify,
}));

// Il nucleo si carica una volta: dopo, la tela si apre subito.
beforeAll(async () => {
  await canvasCoreReady();
});

afterEach(() => {
  document.body.replaceChildren();
});

// --- il menu della scheda (T17) ------------------------------------------------

describe("il menu della scheda (T17)", () => {
  /** Due schede della stessa nota, una di testo e un'immagine. */
  function board(): string {
    return JSON.stringify({
      nodes: [
        { id: "n1", type: "file", x: 0, y: 0, width: 240, height: 140, file: "Note/Idee.md", color: "2" },
        { id: "n2", type: "file", x: 300, y: 0, width: 240, height: 140, file: "Note/Idee.md" },
        { id: "t", type: "text", x: 0, y: 200, width: 240, height: 140, text: "\n  Prima riga\nseconda" },
        { id: "f", type: "file", x: 300, y: 200, width: 240, height: 140, file: "allegati/foto.png" },
      ],
      edges: [],
    });
  }

  function open(overrides: Partial<CanvasEngineOptions> = {}) {
    const trashed: string[] = [];
    const beside: string[] = [];
    const made = mounted(board(), {
      onOpenPathBeside: (path) => {
        beside.push(path);
      },
      onTrashPath: async (path) => {
        trashed.push(path);
        return true;
      },
      ...overrides,
    });
    const viewport = made.host.querySelector<HTMLElement>(".canvas-viewport")!;
    return { ...made, viewport, trashed, beside };
  }

  type Entry = string | SurfaceMenuItem;
  const card = (host: HTMLElement, id: string) => host.querySelector<HTMLElement>(`.canvas-node[data-node="${id}"]`)!;

  /** Il tasto destro sulla scheda `element`: la sceglie e torna il menu. */
  function menuOn(engine: CanvasEngine, element: Element) {
    const pointing = vi.spyOn(document, "elementFromPoint").mockReturnValue(element);
    try {
      return engine.contextMenu({ x: 10, y: 10 })!;
    } finally {
      pointing.mockRestore();
    }
  }

  function shape(entries: readonly Entry[]): unknown[] {
    return entries.map((entry) => (typeof entry === "string"
      ? entry
      : Array.isArray(entry.items) ? { [entry.id]: shape(entry.items as readonly Entry[]) } : entry.id));
  }

  /** La voce `id`, anche dentro i sottomenu. */
  function item(entries: readonly Entry[] | undefined, id: string): SurfaceMenuItem {
    const find = (list: readonly Entry[]): SurfaceMenuItem | null => {
      for (const entry of list) {
        if (typeof entry === "string") continue;
        if (entry.id === id) return entry;
        const inner = Array.isArray(entry.items) ? find(entry.items as readonly Entry[]) : null;
        if (inner) return inner;
      }
      return null;
    };
    const found = find(entries ?? []);
    if (!found) throw new Error(`nessuna voce ${id}`);
    return found;
  }

  function key(target: HTMLElement, init: KeyboardEventInit): KeyboardEvent {
    const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });
    target.dispatchEvent(event);
    return event;
  }

  const nodes = (engine: CanvasEngine) => readCanvas(engine.getDoc()).nodes;
  const removal = (host: HTMLElement) => host.querySelector(".canvas-removal")?.textContent ?? null;
  const undoButton = (host: HTMLElement) => host.querySelector<HTMLButtonElement>('[data-canvas-action="undo-removal"]');

  it("l'ordine delle voci, la testata, il pericoloso in fondo e i colori come scelte esclusive", () => {
    const { engine, host, beside } = open();
    const menu = menuOn(engine, card(host, "n1"));
    expect(menu.target).toEqual({ kind: "node", ref: "n1", label: "Scheda di nota", name: "Idee.md" });
    const context = menu.context as readonly Entry[];
    expect(shape(context)).toEqual([
      "canvas.open", "canvas.open_beside", "canvas.connect", "—",
      {
        "canvas.color": ["canvas.color.none", "canvas.color.1", "canvas.color.2", "canvas.color.3", "canvas.color.4", "canvas.color.5", "canvas.color.6", "—",
          { "canvas.color.notes": ["canvas.color.gray", "canvas.color.brown", "canvas.color.orange", "canvas.color.yellow", "canvas.color.green", "canvas.color.blue", "canvas.color.purple", "canvas.color.pink", "canvas.color.red"] },
          "canvas.color.other"],
      },
      {
        "canvas.arrange": ["canvas.bring_front", "canvas.send_back", "—",
          { "canvas.align": ["canvas.align.left", "canvas.align.center", "canvas.align.right", "canvas.align.top", "canvas.align.middle", "canvas.align.bottom"] },
          { "canvas.distribute": ["canvas.distribute_x", "canvas.distribute_y"] }, "—",
          "canvas.layout.grid", "canvas.layout.row", "canvas.layout.column", "canvas.layout.tree"],
      },
      "canvas.duplicate", "canvas.copy_code", "canvas.paste_code", "—", "canvas.delete", "canvas.trash_file",
    ]);
    // I nomi e i tasti del catalogo.
    expect(item(context, "canvas.connect")).toMatchObject({ label: "Collega…", chord: "C" });
    expect(item(context, "canvas.delete")).toMatchObject({ label: "Togli dalla lavagna", danger: true });
    expect(item(context, "canvas.trash_file")).toMatchObject({ label: "Sposta anche il file nel cestino", danger: true });
    expect(item(context, "canvas.trash_file").chord).toBeUndefined();
    expect(item(context, "canvas.duplicate").chord).toBe("Mod-d");
    expect(item(context, "canvas.bring_front").chord).toBe("Mod-]");
    expect(item(context, "canvas.send_back").chord).toBe("Mod-[");
    // Rosso solo in fondo.
    const flat = context.filter((entry): entry is SurfaceMenuItem => typeof entry !== "string");
    expect(flat.map((entry) => entry.danger === true)).toEqual([false, false, false, false, false, false, false, false, true, true]);
    // I colori: scelte esclusive, segnata quella della scheda.
    const colors = (item(context, "canvas.color").items as readonly Entry[])
      .flatMap((entry) => (typeof entry === "string" ? [] : Array.isArray(entry.items) ? (entry.items as readonly SurfaceMenuItem[]) : [entry]));
    expect(colors).toHaveLength(17);
    expect(colors.every((entry) => entry.radio === true)).toBe(true);
    expect(colors.filter((entry) => entry.checked).map((entry) => entry.id)).toEqual(["canvas.color.2"]);
    // Una scheda sola: allinea e distribuisci spenti, col perché.
    expect(item(context, "canvas.align")).toMatchObject({ enabled: false, description: t("canvas.commands.why.two") });
    // Apri a lato passa dalla porta nuova.
    item(context, "canvas.open_beside").run!();
    expect(beside).toEqual(["/Note/Idee.md"]);
    engine.destroy();
  });

  it("il menu dei colori (T47): i nomi, «Colori delle note», «Altro…» e la scelta segnata", () => {
    const { engine, host, changes } = open();
    let menu = menuOn(engine, card(host, "n2")).context as readonly Entry[];
    const color = item(menu, "canvas.color");
    // I nomi del menu: corti, il sottomenu dice di che cosa.
    expect(item(menu, "canvas.color.none")).toMatchObject({ label: "Nessuno", radio: true, checked: true, swatches: ["transparent"] });
    expect(item(menu, "canvas.color.5").label).toBe("Azzurro");
    expect(item(menu, "canvas.color.notes").label).toBe("Colori delle note");
    expect(item(menu, "canvas.color.blue")).toMatchObject({ label: "Blu", radio: true, checked: false });
    expect(item(menu, "canvas.color.other")).toMatchObject({ label: "Altro…", radio: true, checked: false });
    expect(color.items).toContain(MENU_RULE);
    // Uno dei nove si scrive col suo esadecimale chiaro, e torna segnato.
    item(menu, "canvas.color.blue").run!();
    expect(nodes(engine).find((node) => node.id === "n2")!.color).toBe("#0064b0");
    expect(card(host, "n2").dataset.canvasColor).toBe("blue");
    menu = menuOn(engine, card(host, "n2")).context as readonly Entry[];
    expect(item(menu, "canvas.color.blue").checked).toBe(true);
    expect(item(menu, "canvas.color.none").checked).toBe(false);
    // «Altro…» apre il selettore del kit sotto la scheda, coi nove fra i consigliati.
    item(menu, "canvas.color.other").run!();
    const popover = document.querySelector<HTMLElement>(".kit-color-popover")!;
    expect(popover).not.toBeNull();
    expect(popover.getAttribute("aria-label")).toBe("Altro colore…");
    expect([...popover.querySelectorAll<HTMLElement>(".kit-color-swatch")].map((swatch) => swatch.dataset.color))
      .toEqual(["#5e626b", "#84573e", "#984b00", "#795f00", "#007231", "#0064b0", "#7847a6", "#9e366f", "#b7191c"]);
    const input = popover.querySelector<HTMLInputElement>(".kit-color-input")!;
    input.value = "#7B3FA0";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(nodes(engine).find((node) => node.id === "n2")!.color).toBe("#7b3fa0");
    expect(card(host, "n2").style.getPropertyValue("--canvas-color")).toBe("#7b3fa0");
    menu = menuOn(engine, card(host, "n2")).context as readonly Entry[];
    expect(item(menu, "canvas.color.other").checked).toBe(true);
    expect(changes).toHaveLength(2);
    engine.destroy();
  });

  it("più schede con colori diversi: nessuna scelta segnata (T47)", () => {
    const { engine, host, viewport } = open();
    key(viewport, { key: "a", ctrlKey: true });
    const menu = engine.contextMenu(null)!.context as readonly Entry[];
    const leaves = (entries: readonly Entry[]): SurfaceMenuItem[] => entries.flatMap((entry) =>
      typeof entry === "string" ? [] : Array.isArray(entry.items) ? leaves(entry.items as readonly Entry[]) : [entry]);
    expect(leaves(item(menu, "canvas.color").items as readonly Entry[]).filter((entry) => entry.checked)).toEqual([]);
    expect(host.querySelectorAll(".canvas-node.selected")).toHaveLength(4);
    engine.destroy();
  });

  it("la scheda di testo: la prima riga nella testata e niente cestino", () => {
    const { engine, host } = open();
    const menu = menuOn(engine, card(host, "t"));
    expect(menu.target).toEqual({ kind: "node", ref: "t", label: "Scheda di testo", name: "Prima riga" });
    const ids = (menu.context ?? []).flatMap((entry) => (typeof entry === "string" ? [] : [entry.id]));
    expect(ids).toEqual(["canvas.edit", "canvas.connect", "canvas.color", "canvas.arrange", "canvas.duplicate", "canvas.copy_code", "canvas.paste_code", "canvas.delete"]);
    engine.destroy();
  });

  it("la testata di una scheda di testo dice il nome senza i segni del Markdown: «# **Idee**» è «Idee»", () => {
    const { engine, host } = mounted(JSON.stringify({
      nodes: [{ id: "h", type: "text", x: 0, y: 0, width: 240, height: 140, text: "# **Idee**\nil resto" }],
      edges: [],
    }));
    const menu = menuOn(engine, card(host, "h"));
    expect(menu.target).toEqual({ kind: "node", ref: "h", label: "Scheda di testo", name: "Idee" });
    engine.destroy();
  });

  it("più schede: la testata dice quante, niente Apri; in sola lettura le voci che cambiano sono spente, non nascoste", () => {
    const { engine, host, viewport } = open();
    viewport.focus();
    key(viewport, { key: "a", ctrlKey: true });
    const many = engine.contextMenu(null)!;
    expect(many.target.label).toBe("4 schede");
    const ids = (many.context ?? []).flatMap((entry) => (typeof entry === "string" ? [] : [entry.id]));
    expect(ids).toEqual(["canvas.color", "canvas.arrange", "canvas.duplicate", "canvas.copy_code", "canvas.paste_code", "canvas.delete", "canvas.trash_file"]);
    // Le schede hanno colori diversi: nessuno segnato.
    expect((item(many.context, "canvas.color").items as readonly SurfaceMenuItem[]).some((entry) => entry.checked)).toBe(false);
    expect(item(many.context, "canvas.distribute").enabled).toBe(true);

    key(viewport, { key: "Escape" });
    engine.setReadOnly(true);
    const locked = menuOn(engine, card(host, "n1")).context;
    const why = t("canvas.commands.why.read_only");
    for (const id of ["canvas.color", "canvas.arrange", "canvas.duplicate", "canvas.paste_code", "canvas.delete", "canvas.trash_file", "canvas.connect"]) {
      expect(item(locked, id), id).toMatchObject({ enabled: false, description: why });
    }
    // «Copia come codice» non cambia la lavagna (LIC T25): resta acceso.
    expect(item(locked, "canvas.copy_code").enabled).toBe(true);
    // Apri e Apri a lato non cambiano la lavagna: restano accesi.
    expect(item(locked, "canvas.open").enabled).toBe(true);
    expect(item(locked, "canvas.open_beside").enabled).toBe(true);
    engine.destroy();
  });

  it("C con una scheda scelta comincia il collegamento; mentre si scrive va nel testo", () => {
    const { engine, host, viewport } = open();
    menuOn(engine, card(host, "n1"));
    viewport.focus();
    expect(key(viewport, { key: "c" }).defaultPrevented).toBe(true);
    expect(viewport.dataset.tool).toBe("connect");
    // Il clic sull'altra scheda chiude il filo, e la colonna torna alla Selezione.
    const target = card(host, "f");
    const pointing = vi.spyOn(document, "elementFromPoint").mockReturnValue(target);
    target.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, pointerId: 2, clientX: 400, clientY: 300 }));
    viewport.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, button: 0, pointerId: 2, clientX: 400, clientY: 300 }));
    pointing.mockRestore();
    expect(readCanvas(engine.getDoc()).edges.map((edge) => [edge.fromNode, edge.toNode])).toEqual([["n1", "f"]]);
    expect(viewport.dataset.tool).toBe("select");

    // Senza scheda scelta C sceglie lo strumento; Esc torna alla Selezione.
    key(viewport, { key: "Escape" });
    key(viewport, { key: "c" });
    expect(viewport.dataset.tool).toBe("connect");
    key(viewport, { key: "Escape" });
    expect(viewport.dataset.tool).toBe("select");

    // Dentro una scheda di testo C è una lettera.
    card(host, "t").dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    const input = host.querySelector<HTMLTextAreaElement>(".canvas-text-editor")!;
    expect(input).not.toBeNull();
    expect(key(input, { key: "c" }).defaultPrevented).toBe(false);
    expect(viewport.dataset.tool).toBe("select");
    engine.destroy();
  });

  it("Ctrl+] e Ctrl+[ portano davanti e dietro", () => {
    const { engine, host, viewport } = open();
    menuOn(engine, card(host, "n1"));
    viewport.focus();
    expect(key(viewport, { key: "]", ctrlKey: true, code: "BracketRight" }).defaultPrevented).toBe(true);
    expect(nodes(engine).map((node) => node.id)).toEqual(["n2", "t", "f", "n1"]);
    key(viewport, { key: "[", ctrlKey: true, code: "BracketLeft" });
    expect(nodes(engine).map((node) => node.id)).toEqual(["n1", "n2", "t", "f"]);
    engine.destroy();
  });

  it("Togli dalla lavagna lo dice con Annulla, che fa ciò che fa Ctrl+Z; la modifica dopo spegne l'avviso", () => {
    const { engine, host, viewport, trashed } = open();
    menuOn(engine, card(host, "n1"));
    viewport.focus();
    key(viewport, { key: "Delete" });
    expect(nodes(engine).map((node) => node.id)).toEqual(["n2", "t", "f"]);
    expect(removal(host)).toBe("Tolta dalla lavagna. Il file resta.");
    undoButton(host)!.click();
    expect(nodes(engine).map((node) => node.id)).toEqual(["n1", "n2", "t", "f"]);
    expect(removal(host)).toBeNull();

    // Una scheda di testo: niente file.
    item(menuOn(engine, card(host, "t")).context, "canvas.delete").run!();
    expect(removal(host)).toBe("Scheda tolta.");
    // Una modifica dopo il togliere: l'avviso se ne va, col suo Annulla.
    menuOn(engine, card(host, "f"));
    viewport.focus();
    key(viewport, { key: "d", ctrlKey: true });
    expect(nodes(engine)).toHaveLength(4);
    expect(removal(host)).toBeNull();
    expect(undoButton(host)).toBeNull();

    // Più schede, una di file: «I file restano». Backspace come Canc.
    key(viewport, { key: "a", ctrlKey: true });
    key(viewport, { key: "Backspace" });
    expect(nodes(engine)).toHaveLength(0);
    expect(removal(host)).toBe("4 schede tolte dalla lavagna. I file restano.");
    undoButton(host)!.click();
    expect(nodes(engine)).toHaveLength(4);
    // Mai il file.
    expect(trashed).toEqual([]);
    engine.destroy();
  });

  it("Sposta anche il file nel cestino chiama la porta una volta per file, toglie ogni sua scheda, e mai da tastiera", async () => {
    const { engine, host, viewport, trashed } = open();
    // Nessun tasto lo fa.
    expect(engine.commands().find((one) => one.id === "canvas.trash_file")!.keys).toEqual([]);
    viewport.focus();
    key(viewport, { key: "a", ctrlKey: true });
    for (const press of [{ key: "Delete" }, { key: "Delete", shiftKey: true }, { key: "Delete", ctrlKey: true }, { key: "Backspace", ctrlKey: true }]) {
      key(viewport, { ...press });
      engine.undo();
      key(viewport, { key: "a", ctrlKey: true });
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(trashed).toEqual([]);
    expect(nodes(engine)).toHaveLength(4);
    key(viewport, { key: "Escape" });

    // La nota in due schede: un file solo, tutte e due tolte.
    item(menuOn(engine, card(host, "n1")).context, "canvas.trash_file").run!();
    await vi.waitFor(() => expect(nodes(engine).map((node) => node.id)).toEqual(["t", "f"]));
    expect(trashed).toEqual(["Note/Idee.md"]);
    expect(removal(host)).toBe("2 schede tolte dalla lavagna. «Idee.md» è nel cestino.");
    expect(undoButton(host)).toBeNull();

    // Due file scelti: la porta una volta ciascuno.
    key(viewport, { key: "a", ctrlKey: true });
    item(engine.contextMenu(null)!.context, "canvas.trash_file").run!();
    await vi.waitFor(() => expect(nodes(engine)).toHaveLength(0));
    expect(trashed).toEqual(["Note/Idee.md", "allegati/foto.png"]);
    engine.destroy();
  });

  it("il cestino che rifiuta lascia la scheda e dice l'errore dell'host; un no alla domanda la lascia in silenzio", async () => {
    let answer: "refuse" | "no" = "refuse";
    const { engine, host } = open({
      onTrashPath: async () => {
        if (answer === "refuse") throw new Error("Il cestino è pieno");
        return false;
      },
    });
    item(menuOn(engine, card(host, "f")).context, "canvas.trash_file").run!();
    await vi.waitFor(() => expect(host.querySelector(".canvas-intake-error")?.textContent).toBe("Il cestino è pieno"));
    expect(nodes(engine)).toHaveLength(4);
    answer = "no";
    item(menuOn(engine, card(host, "f")).context, "canvas.trash_file").run!();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(nodes(engine)).toHaveLength(4);
    expect(removal(host)).toBeNull();
    engine.destroy();
  });
});

describe("CanvasEngine: copia e incolla le schede (T68)", () => {
  const TYPE = "application/x-fub-canvas+json";
  const STROKE = {
    id: "s-1", tool: "pen",
    brush: "pf1 size=3 thinning=0.5 smoothing=0.5 streamline=0.5 taperStart=0 taperEnd=0 capStart=1 capEnd=1 sim=0 pen=ballpoint",
    color: "#0072b2", anchor: { kind: "card", width: 240, height: 140 }, ink: "1 s100 cxy 4000,2500 120,40 95,-10",
  };

  function source(): string {
    return JSON.stringify({
      nodes: [
        { id: "a", type: "text", x: 40, y: 40, width: 240, height: 140, text: "Prima" },
        { id: "b", type: "text", x: 400, y: 104, width: 240, height: 140, text: "Seconda", "fub:ink": { v: 1, strokes: [STROKE] }, vendor: { keep: true } },
        { id: "f", type: "file", x: 40, y: 320, width: 240, height: 140, file: "Corsi/voti.xlsx" },
      ],
      edges: [{ id: "e1", fromNode: "a", toNode: "b", toEnd: "arrow", label: "poi" }],
    });
  }

  /** Gli appunti di una prova: ciò che si scrive si rilegge. */
  function store(values: Record<string, string> = {}): DataTransfer & { values: Record<string, string> } {
    return {
      values, files: [], items: [],
      get types() { return Object.keys(values); },
      getData: (type: string) => values[type] ?? "",
      setData: (type: string, value: string) => { values[type] = value; },
    } as unknown as DataTransfer & { values: Record<string, string> };
  }

  function viewportOf(host: HTMLElement): HTMLElement {
    return host.querySelector<HTMLElement>(".canvas-viewport")!;
  }

  function clipboardEvent(type: "copy" | "cut" | "paste", target: HTMLElement, data: DataTransfer): Event {
    const event = new Event(type, { bubbles: true, cancelable: true });
    Object.defineProperty(event, "clipboardData", { value: data });
    target.dispatchEvent(event);
    return event;
  }

  /** Ctrl+A col fuoco sulla vista: tutte le schede scelte. */
  function selectAll(host: HTMLElement): void {
    const viewport = viewportOf(host);
    viewport.focus();
    viewport.dispatchEvent(new KeyboardEvent("keydown", { key: "a", ctrlKey: true, bubbles: true }));
  }

  function nodesOf(engine: CanvasEngine): CanvasDocument["nodes"] {
    return readCanvas(engine.getDoc()).nodes;
  }

  it("copia schede, filo e inchiostro e li incolla in un'altra lavagna sotto il puntatore: un commit, un annulla", async () => {
    const from = mounted(source());
    selectAll(from.host);
    expect(document.activeElement).toBe(viewportOf(from.host));
    const data = store();
    const copied = clipboardEvent("copy", viewportOf(from.host), data);
    expect(copied.defaultPrevented).toBe(true);
    expect(from.changes).toHaveLength(0);
    expect(JSON.parse(data.values[TYPE]!)).toEqual({ version: 1, ...readCanvas(source()) });
    expect(data.values["text/plain"]).toBe("Prima\n\nSeconda\n\n[[Corsi/voti.xlsx]]");
    from.engine.destroy();

    // Un'altra lavagna, di un altro vault: il file che lì non c'è resta un
    // percorso, e la scheda mostra «File mancante» (T16).
    const other = JSON.stringify({ nodes: [{ id: "q", type: "text", x: 0, y: 0, width: 200, height: 100, text: "qui" }], edges: [] });
    const to = mounted(other, { documentId: "altro/board.canvas" });
    viewportOf(to.host).dispatchEvent(new PointerEvent("pointermove", { bubbles: true, clientX: 300, clientY: 200 }));
    clipboardEvent("paste", viewportOf(to.host), data);
    await vi.waitFor(() => expect(to.changes).toHaveLength(1));
    const doc = readCanvas(to.engine.getDoc());
    const [a, b, f] = doc.nodes.slice(1);
    expect(doc.nodes).toHaveLength(4);
    expect(new Set([a!.id, b!.id, f!.id, "q"]).size).toBe(4);
    expect([a!.id, b!.id, f!.id]).not.toContain("a");
    // Le stesse distanze, l'angolo agganciato alla griglia.
    expect([b!.x - a!.x, b!.y - a!.y, f!.x - a!.x, f!.y - a!.y]).toEqual([360, 64, 0, 280]);
    expect([a!.x % 8 === 0, a!.y % 8 === 0]).toEqual([true, true]);
    expect(b).toMatchObject({ text: "Seconda", "fub:ink": { v: 1, strokes: [STROKE] }, vendor: { keep: true } });
    expect(f).toMatchObject({ type: "file", file: "Corsi/voti.xlsx" });
    expect(doc.edges).toEqual([{ id: doc.edges[0]!.id, fromNode: a!.id, toNode: b!.id, toEnd: "arrow", label: "poi" }]);
    expect(doc.edges[0]!.id).not.toBe("e1");
    // Le schede incollate sono le scelte.
    expect(to.engine.selectedText()).toEqual({ primary: "Corsi/voti.xlsx", secondary: ["Prima", "Seconda"] });
    expect(to.engine.undo()).toBe(true);
    expect(to.engine.getDoc()).toBe(other);
    to.engine.destroy();
  });

  it("incollare due volte fa due copie, la seconda sfalsata; copiare di nuovo riparte dal puntatore", async () => {
    const from = mounted(source());
    selectAll(from.host);
    const data = store();
    clipboardEvent("copy", viewportOf(from.host), data);
    viewportOf(from.host).dispatchEvent(new PointerEvent("pointermove", { bubbles: true, clientX: 300, clientY: 200 }));
    clipboardEvent("paste", viewportOf(from.host), data);
    clipboardEvent("paste", viewportOf(from.host), data);
    await vi.waitFor(() => expect(from.changes).toHaveLength(2));
    const pasted = nodesOf(from.engine).slice(3);
    expect(pasted).toHaveLength(6);
    expect([pasted[3]!.x - pasted[0]!.x, pasted[3]!.y - pasted[0]!.y]).toEqual([32, 32]);
    expect(readCanvas(from.engine.getDoc()).edges).toHaveLength(3);
    // Copiare le incollate fa appunti nuovi: il prossimo incolla torna al punto.
    const again = store();
    clipboardEvent("copy", viewportOf(from.host), again);
    clipboardEvent("paste", viewportOf(from.host), again);
    await vi.waitFor(() => expect(from.changes).toHaveLength(3));
    expect([nodesOf(from.engine)[9]!.x, nodesOf(from.engine)[9]!.y]).toEqual([pasted[0]!.x, pasted[0]!.y]);
    from.engine.destroy();
  });

  it("taglia: copia e toglie in un annulla, le schede di file restano file e l'avviso lo dice", async () => {
    const { engine, host, changes } = mounted(source());
    selectAll(host);
    const data = store();
    clipboardEvent("cut", viewportOf(host), data);
    expect(changes).toHaveLength(1);
    expect(nodesOf(engine)).toHaveLength(0);
    expect(readCanvas(engine.getDoc()).edges).toHaveLength(0);
    expect(JSON.parse(data.values[TYPE]!).nodes).toHaveLength(3);
    expect(host.querySelector(".canvas-removal")?.textContent).toBe(t("canvas.card.removed_many", { n: "3" }));
    expect(engine.undo()).toBe(true);
    expect(engine.getDoc()).toBe(source());
    // Incollate di nuovo, tornano con filo e inchiostro.
    clipboardEvent("paste", viewportOf(host), data);
    await vi.waitFor(() => expect(changes).toHaveLength(3));
    expect(nodesOf(engine)).toHaveLength(6);
    expect(readCanvas(engine.getDoc()).edges).toHaveLength(2);
    engine.destroy();
  });

  it("una versione futura si rifiuta con l'avviso, mai a metà; un JSON rotto si incolla come testo", async () => {
    const { engine, host, changes } = mounted(source());
    viewportOf(host).focus();
    const future = JSON.stringify({ version: 2, nodes: readCanvas(source()).nodes, edges: [] });
    const event = clipboardEvent("paste", viewportOf(host), store({ [TYPE]: future, "text/plain": "Prima" }));
    expect(event.defaultPrevented).toBe(true);
    await vi.waitFor(() => expect(host.querySelector(".canvas-intake-error")?.textContent).toBe(t("canvas.clipboard.future")));
    expect(changes).toHaveLength(0);

    clipboardEvent("paste", viewportOf(host), store({ [TYPE]: "{\"version\": 1, \"nodes\": [", "text/plain": "come testo" }));
    await vi.waitFor(() => expect(changes).toHaveLength(1));
    expect(nodesOf(engine).slice(3)).toEqual([expect.objectContaining({ type: "text", text: "come testo" })]);
    // Senza testo accanto, è il JSON rotto a diventare il testo.
    clipboardEvent("paste", viewportOf(host), store({ [TYPE]: "{rotto" }));
    await vi.waitFor(() => expect(changes).toHaveLength(2));
    expect(nodesOf(engine)[4]).toMatchObject({ type: "text", text: "{rotto" });
    engine.destroy();
  });

  it("schede che il nucleo rifiuta non entrano, nemmeno una: l'avviso lo dice", async () => {
    const { engine, host, changes } = mounted(source());
    const bad = JSON.stringify({ version: 1, nodes: [
      { id: "x", type: "text", x: 0, y: 0, width: 10, height: 10, text: "buona" },
      { id: "y", type: "text", x: 0, y: 0, width: 10, height: 10, text: "colore", color: "rosso" },
    ], edges: [] });
    clipboardEvent("paste", viewportOf(host), store({ [TYPE]: bad, "text/plain": "buona" }));
    await vi.waitFor(() => expect(host.querySelector(".canvas-intake-error")?.textContent).toBe(t("canvas.clipboard.refused")));
    expect(changes).toHaveLength(0);
    expect(engine.getDoc()).toBe(source());
    engine.destroy();
  });

  it("in sola lettura copiare si può, tagliare e incollare no", async () => {
    const { engine, host, changes } = mounted(source());
    engine.setReadOnly(true);
    selectAll(host);
    const data = store();
    clipboardEvent("copy", viewportOf(host), data);
    expect(JSON.parse(data.values[TYPE]!).nodes).toHaveLength(3);
    const cut = clipboardEvent("cut", viewportOf(host), store());
    expect(cut.defaultPrevented).toBe(false);
    clipboardEvent("paste", viewportOf(host), data);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(changes).toHaveLength(0);
    expect(engine.getDoc()).toBe(source());
    engine.destroy();
  });

  it("gli appunti restano del campo in cui si scrive, e di chi ha il fuoco fuori dalla lavagna", () => {
    const { engine, host } = mounted(source());
    selectAll(host);
    const field = document.createElement("textarea");
    viewportOf(host).append(field);
    field.focus();
    expect(clipboardEvent("copy", field, store()).defaultPrevented).toBe(false);
    const outside = document.createElement("input");
    document.body.append(outside);
    outside.focus();
    expect(clipboardEvent("copy", outside, store()).defaultPrevented).toBe(false);
    engine.destroy();
  });

  it("il menu della scheda offre Taglia, Copia e Incolla; quello del vuoto Incolla", () => {
    const { engine, host } = mounted(source());
    selectAll(host);
    const card = host.querySelector<HTMLElement>('.canvas-node[data-node="a"]')!;
    const pointing = vi.spyOn(document, "elementFromPoint").mockReturnValue(card);
    expect(engine.contextMenu({ x: 10, y: 10 })!.clipboard!.offers).toEqual({ cut: true, copy: true, paste: true });
    pointing.mockReturnValue(viewportOf(host));
    expect(engine.contextMenu({ x: 900, y: 900 })!.clipboard!.offers).toEqual({ paste: true });
    engine.setReadOnly(true);
    pointing.mockReturnValue(card);
    expect(engine.contextMenu({ x: 10, y: 10 })!.clipboard!.offers).toEqual({ cut: false, copy: true, paste: false });
    pointing.mockRestore();
    engine.destroy();
  });

  it("Ctrl+D dopo aver spostato la copia ripete lo stesso spostamento", () => {
    const { engine, host } = mounted(JSON.stringify({
      nodes: [{ id: "a", type: "text", x: 40, y: 40, width: 240, height: 140, text: "uno" }], edges: [],
    }));
    const viewport = viewportOf(host);
    selectAll(host);
    const press = (init: KeyboardEventInit): void => {
      viewport.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, ...init }));
    };
    press({ key: "d", ctrlKey: true });
    expect(nodesOf(engine).map((node) => [node.x, node.y])).toEqual([[40, 40], [72, 72]]);
    // La copia si sposta di due passi a destra: 48, 32 dalla prima.
    press({ key: "ArrowRight" });
    press({ key: "ArrowRight" });
    expect(nodesOf(engine)[1]).toMatchObject({ x: 88, y: 72 });
    press({ key: "d", ctrlKey: true });
    press({ key: "d", ctrlKey: true });
    expect(nodesOf(engine).map((node) => [node.x, node.y])).toEqual([[40, 40], [88, 72], [136, 104], [184, 136]]);
    // Un'altra scelta riparte dallo sfalsamento di sempre.
    selectAll(host);
    press({ key: "d", ctrlKey: true });
    expect(nodesOf(engine).slice(4).map((node) => [node.x, node.y])).toEqual([[72, 72], [120, 104], [168, 136], [216, 168]]);
    engine.destroy();
  });

  describe("i tratti liberi negli appunti (T94)", () => {
    const BRUSH = "pf1 size=3 thinning=0.5 smoothing=0.5 streamline=0.5 taperStart=0 taperEnd=0 capStart=1 capEnd=1 sim=0 pen=ballpoint";
    const free = (id: string, ink: string) => ({ id, tool: "pen", brush: BRUSH, color: "#0072b2", anchor: { kind: "free" }, ink });
    /** Da (400, 300), sotto la scheda: il Lazo lo prende con lei. */
    const F1 = free("f1", "1 s100 cxy 40000,30000 1200,400 950,-100");
    /** Da (800, 300), lontano: resta fuori dal giro delle schede. */
    const F2 = free("f2", "1 s100 cxy 80000,30000 1000,0");

    function inked(): string {
      return JSON.stringify({
        nodes: [{ id: "a", type: "text", x: 40, y: 40, width: 240, height: 140, text: "Prima" }],
        edges: [],
        "fub:ink": { v: 1, strokes: [F1, F2] },
      });
    }

    /** Un'altra lavagna, col suo tratto libero che ha già l'id `f1`. */
    function elsewhere(): string {
      return JSON.stringify({
        nodes: [{ id: "q", type: "text", x: 0, y: 0, width: 200, height: 100, text: "qui" }],
        edges: [],
        "fub:ink": { v: 1, strokes: [{ ...F2, id: "f1" }] },
      });
    }

    type Stroke = Record<string, unknown> & { id: string; ink: string };
    const freeOf = (engine: CanvasEngine): Stroke[] =>
      ((JSON.parse(engine.getDoc()) as { "fub:ink"?: { strokes: Stroke[] } })["fub:ink"]?.strokes ?? []);

    function cameraOf(host: HTMLElement): { x: number; y: number; zoom: number } {
      const transform = host.querySelector<HTMLElement>(".canvas-stage")!.style.transform;
      const match = /translate\((-?[\d.e+-]+)px, (-?[\d.e+-]+)px\) scale\(([\d.e+-]+)\)/.exec(transform);
      if (!match) throw new Error(`trasformazione inattesa: ${transform}`);
      return { x: Number(match[1]), y: Number(match[2]), zoom: Number(match[3]) };
    }

    /** Il Lazo, poi un giro col mouse attorno al riquadro dato della lavagna; il fuoco resta sulla vista. */
    function lassoAround(engine: CanvasEngine, host: HTMLElement, x0: number, y0: number, x1: number, y1: number): void {
      engine.commands().find((command) => command.id === "canvas.tool.lasso")!.run();
      const cam = cameraOf(host);
      const viewport = viewportOf(host);
      const points: [number, number][] = [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0 + 2]];
      const send = (type: string, [x, y]: [number, number], buttons: number): void => {
        viewport.dispatchEvent(new PointerEvent(type, {
          bubbles: true, cancelable: true, isPrimary: true, pointerId: 1, pointerType: "mouse",
          button: type === "pointermove" ? -1 : 0, buttons, clientX: x * cam.zoom + cam.x, clientY: y * cam.zoom + cam.y,
        }));
      };
      send("pointerdown", points[0]!, 1);
      for (const point of points.slice(1)) send("pointermove", point, 1);
      send("pointerup", points[points.length - 1]!, 0);
      viewport.focus();
    }

    /** Il primo campione di un `ink`, in unità quantizzate. */
    const head = (ink: string): [number, number] => ink.split(" ")[3]!.split(",").map(Number) as [number, number];

    it("copia schede e tratti liberi e li incolla in un'altra lavagna sotto il puntatore: ids nuovi, un commit, un annulla", async () => {
      const from = mounted(inked());
      lassoAround(from.engine, from.host, 20, 20, 460, 360);
      const data = store();
      expect(clipboardEvent("copy", viewportOf(from.host), data).defaultPrevented).toBe(true);
      expect(from.changes).toHaveLength(0);
      const json = JSON.parse(data.values[TYPE]!);
      expect(json).toEqual({ version: 1, nodes: [readCanvas(inked()).nodes[0]], edges: [], "fub:ink": { v: 1, strokes: [F1] } });
      // `text/plain` è quello delle schede: i tratti non hanno Markdown.
      expect(data.values["text/plain"]).toBe("Prima");
      from.engine.destroy();

      const to = mounted(elsewhere(), { documentId: "altro/board.canvas" });
      viewportOf(to.host).dispatchEvent(new PointerEvent("pointermove", { bubbles: true, clientX: 300, clientY: 200 }));
      clipboardEvent("paste", viewportOf(to.host), data);
      await vi.waitFor(() => expect(to.changes).toHaveLength(1));
      expect(to.changes[0]!.operation.patches.map((patch) => patch.kind)).toEqual(["upsert-node", "ink"]);
      const card = nodesOf(to.engine)[1]!;
      expect(card).toMatchObject({ type: "text", text: "Prima" });
      const strokes = freeOf(to.engine);
      expect(strokes).toHaveLength(2);
      // Il tratto di prima non cambia; quello incollato ha un id nuovo, anche se `f1` era libero da prendere qui.
      expect(strokes[0]).toEqual({ ...F2, id: "f1" });
      expect(strokes[1]!.id).not.toBe("f1");
      expect(strokes[1]!.id).toMatch(/^s-/);
      // Spostato quanto la scheda: stessa distanza fra loro, la forma uguale.
      const [x, y] = head(strokes[1]!.ink);
      expect([x / 100 - card.x, y / 100 - card.y]).toEqual([360, 260]);
      expect(strokes[1]!.ink.split(" ").slice(4)).toEqual(["1200,400", "950,-100"]);
      expect({ ...strokes[1], id: "f1", ink: F1.ink }).toEqual(F1);
      expect(to.engine.undo()).toBe(true);
      expect(to.engine.getDoc()).toBe(elsewhere());
      to.engine.destroy();
    });

    it("solo tratti: si incollano senza schede, e una seconda volta sfalsati con ids nuovi", async () => {
      const from = mounted(inked());
      lassoAround(from.engine, from.host, 780, 280, 830, 320);
      const data = store();
      clipboardEvent("copy", viewportOf(from.host), data);
      expect(JSON.parse(data.values[TYPE]!)).toEqual({ version: 1, nodes: [], edges: [], "fub:ink": { v: 1, strokes: [F2] } });
      expect(data.values["text/plain"]).toBe("");
      from.engine.destroy();

      const to = mounted(elsewhere());
      viewportOf(to.host).dispatchEvent(new PointerEvent("pointermove", { bubbles: true, clientX: 300, clientY: 200 }));
      clipboardEvent("paste", viewportOf(to.host), data);
      clipboardEvent("paste", viewportOf(to.host), data);
      await vi.waitFor(() => expect(to.changes).toHaveLength(2));
      expect(nodesOf(to.engine).map((node) => node.id)).toEqual(["q"]);
      const [, first, second] = freeOf(to.engine);
      expect(new Set(["f1", first!.id, second!.id]).size).toBe(3);
      const [x1, y1] = head(first!.ink);
      const [x2, y2] = head(second!.ink);
      expect([x2 - x1, y2 - y1]).toEqual([3200, 3200]);
      // Ognuno è un passo d'annulla suo.
      expect(to.engine.undo()).toBe(true);
      expect(freeOf(to.engine)).toHaveLength(2);
      expect(to.engine.undo()).toBe(true);
      expect(to.engine.getDoc()).toBe(elsewhere());
      to.engine.destroy();
    });

    it("taglia: toglie schede e tratti liberi scelti in un commit, e un annulla li rimette", () => {
      const { engine, host, changes } = mounted(inked());
      lassoAround(engine, host, 20, 20, 460, 360);
      const data = store();
      clipboardEvent("cut", viewportOf(host), data);
      expect(changes).toHaveLength(1);
      expect(nodesOf(engine)).toHaveLength(0);
      expect(freeOf(engine)).toEqual([F2]);
      expect(JSON.parse(data.values[TYPE]!)["fub:ink"]).toEqual({ v: 1, strokes: [F1] });
      expect(engine.undo()).toBe(true);
      expect(engine.getDoc()).toBe(inked());
      engine.destroy();
    });

    it("un fub:ink rotto, o un tratto che spostato esce dai numeri dell'inchiostro: l'avviso, e non entra niente", async () => {
      const { engine, host, changes } = mounted(elsewhere());
      viewportOf(host).focus();
      const card = { id: "c", type: "text", x: 0, y: 0, width: 100, height: 60, text: "accanto" };
      const broken = JSON.stringify({ version: 1, nodes: [card], edges: [], "fub:ink": { v: 2, strokes: [F1] } });
      const event = clipboardEvent("paste", viewportOf(host), store({ [TYPE]: broken, "text/plain": "accanto" }));
      expect(event.defaultPrevented).toBe(true);
      await vi.waitFor(() => expect(host.querySelector(".canvas-intake-error")?.textContent).toBe(t("canvas.clipboard.refused")));
      // Il primo tratto è all'estremo negativo: spostare il riquadro nel punto porta il secondo oltre il limite.
      const far = JSON.stringify({ version: 1, nodes: [card], edges: [], "fub:ink": { v: 1, strokes: [
        free("lo", "1 s100 cxy -9007199254740000,0 100,0"),
        free("hi", "1 s100 cxy 9007199254740000,0 100,0"),
      ] } });
      // La forma è buona: il rifiuto viene dal nucleo, che sposta i tratti.
      expect(readCanvasClipboard(far).kind).toBe("cards");
      expect(changes).toHaveLength(0);
      engine.destroy();

      const other = mounted(elsewhere());
      viewportOf(other.host).focus();
      clipboardEvent("paste", viewportOf(other.host), store({ [TYPE]: far, "text/plain": "accanto" }));
      await vi.waitFor(() => expect(other.host.querySelector(".canvas-intake-error")?.textContent).toBe(t("canvas.clipboard.refused")));
      expect(other.changes).toHaveLength(0);
      expect(other.engine.getDoc()).toBe(elsewhere());
      other.engine.destroy();
    });

    it("in sola lettura il Lazo copia i tratti; tagliare e incollare no", async () => {
      const { engine, host, changes } = mounted(inked());
      engine.setReadOnly(true);
      lassoAround(engine, host, 780, 280, 830, 320);
      const data = store();
      clipboardEvent("copy", viewportOf(host), data);
      expect(JSON.parse(data.values[TYPE]!)["fub:ink"]).toEqual({ v: 1, strokes: [F2] });
      expect(clipboardEvent("cut", viewportOf(host), store()).defaultPrevented).toBe(false);
      clipboardEvent("paste", viewportOf(host), data);
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(changes).toHaveLength(0);
      expect(engine.getDoc()).toBe(inked());
      engine.destroy();
    });
  });
});

describe("CanvasEngine: un colore che Fub non conosce non ferma la lavagna (T47b)", () => {
  // «rosso», «7» e il vuoto non sono colori di Fub: il nucleo li tiene come
  // sono, la tela non li disegna e non li segna nel menu.
  const source = JSON.stringify({
    nodes: [
      { id: "a", type: "text", x: 0, y: 0, width: 100, height: 80, color: "rosso", text: "a" },
      { id: "b", type: "text", x: 200, y: 0, width: 100, height: 80, color: "7", text: "b" },
      { id: "c", type: "text", x: 400, y: 0, width: 100, height: 80, color: "", text: "c" },
    ],
    edges: [{ id: "e1", fromNode: "a", toNode: "b", color: "rosso" }],
  });

  it("si apre; la scheda e il filo non hanno colore, e aprire non scrive", () => {
    const { engine, host, changes } = mounted(source);
    expect(engine.getDoc()).toBe(source);
    for (const id of ["a", "b", "c"]) {
      const card = host.querySelector<HTMLElement>(`.canvas-node[data-node="${id}"]`)!;
      expect(card).not.toBeNull();
      expect(card.dataset.canvasColor).toBeUndefined();
      expect(card.style.getPropertyValue("--canvas-color")).toBe("");
    }
    const edge = host.querySelector<SVGPathElement>('.canvas-edge-line[data-edge="e1"]')!.parentElement!;
    expect(edge.dataset.canvasColor).toBeUndefined();
    expect(changes).toHaveLength(0);
    engine.destroy();
  });

  it("scegliere un colore lo sostituisce, e l'annulla riporta il testo di prima", () => {
    const { engine, host, changes } = mounted(source);
    host.querySelector<HTMLElement>(".canvas-viewport")!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    engine.commands().find((command) => command.id === "canvas.color.1")!.run();
    expect(readCanvas(engine.getDoc()).nodes[0].color).toBe("1");
    expect(changes).toHaveLength(1);
    expect(engine.undo()).toBe(true);
    expect(engine.getDoc()).toBe(source);
    engine.destroy();
  });

  it("spostare la scheda riscrive soltanto la sua posizione: il colore che Fub non conosce resta com'era", () => {
    const { engine, host } = mounted(source);
    const viewport = host.querySelector<HTMLElement>(".canvas-viewport")!;
    viewport.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    viewport.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    expect(engine.getDoc()).toBe(source.replace('"x":0,"y":0,', '"x":0,"y":8,'));
    engine.destroy();
  });
});
