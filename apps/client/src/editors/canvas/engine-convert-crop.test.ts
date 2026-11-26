// @vitest-environment happy-dom
// Le prove di `CanvasEngine`: «Apri a lato» (T45), convertire (T70), il ritaglio di un'immagine (T78).
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { MENU_RULE, type SurfaceMenuItem } from "../core/editor-menu";
import { CanvasEngine, NEXT_CARD_GAP, proposedNoteName, type CanvasEngineOptions } from "./engine";
import { t } from "../../i18n/strings";
import { canvasCoreReady } from "./wasm/core";
import { type CanvasPreferences } from "./preferences";
import { selectionBarPlaceBelow } from "./chrome/selection-bar";
import { setReducedMotionPreference } from "../../theme/reduced-motion";
import { createCardRegistry, type CardContext, type CardRenderer, type CardView } from "../core/cards/contract";
import { CardCache } from "./card-cache";
import { mounted, readCanvas, type } from "./engine-test-support";

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

// --- «Apri a lato per questo» (T45) --------------------------------------------

describe("«Apri a lato per questo» (T45)", () => {
  const BOARD = [
    { id: "s", type: "file", x: 0, y: 0, width: 400, height: 200, file: "Conti/voti.xlsx" },
    { id: "n", type: "file", x: 0, y: 260, width: 400, height: 200, file: "Note/Fisica.md", subpath: "#Scopo" },
    { id: "p", type: "file", x: 460, y: 0, width: 300, height: 400, file: "Libri/manuale.pdf" },
    { id: "w", type: "file", x: 460, y: 460, width: 300, height: 200, file: "Note/Tutta.md" },
  ];

  /**
   * Le schede vive per le prove: il foglio e le note scrivono (`edit`), il
   * PDF dice la pagina che mostra; i contesti restano per rispondere come
   * risponderebbe la porta (`writing`).
   */
  function board(overrides: Partial<CanvasEngineOptions> = {}) {
    const contexts = new Map<string, CardContext>();
    let page = 3;
    const renderer: CardRenderer = {
      kinds: ["sheet", "note", "pdf"],
      mount(node, host, _mode, context): CardView {
        contexts.set(node.id, context);
        const cell = document.createElement("div");
        cell.className = "probe-cell";
        cell.tabIndex = -1;
        host.append(cell);
        const pdf = (node.file ?? "").endsWith(".pdf");
        return {
          setMode: () => {},
          enter: () => true,
          leave: () => {},
          ...(pdf ? { page: () => page } : { edit: () => true }),
          destroy: () => {},
        };
      },
    };
    const beside: string[] = [];
    const made = mounted(JSON.stringify({ nodes: BOARD, edges: [] }), {
      cards: { registry: createCardRegistry([renderer]), snapshots: new CardCache(), watch: () => () => {} },
      onOpenPathBeside: (path) => {
        beside.push(path);
      },
      ...overrides,
    });
    return { ...made, contexts, beside, turnTo: (n: number) => (page = n) };
  }

  const cardEl = (host: HTMLElement, id: string) => host.querySelector<HTMLElement>(`.canvas-node[data-node="${id}"]`)!;

  /** Tab sulla scheda e Invio: si entra, e dove si scrive si scrive. */
  function enter(host: HTMLElement, id: string): void {
    const article = cardEl(host, id);
    article.focus();
    article.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
  }

  /** Il menu del tasto destro su `element`. */
  function menuOn(engine: CanvasEngine, element: Element) {
    const pointing = vi.spyOn(document, "elementFromPoint").mockReturnValue(element);
    try {
      return engine.contextMenu({ x: 10, y: 10 })!;
    } finally {
      pointing.mockRestore();
    }
  }

  const command = (engine: CanvasEngine) => engine.commands().find((one) => one.id === "canvas.open_beside_here")!;
  const rowButton = (host: HTMLElement) =>
    host.querySelector<HTMLButtonElement>('.canvas-options [data-option="beside"] [data-command="canvas.open_beside_here"]');

  it("da una cella che si scrive apre il foglio accanto su quella cella; il nome e il pulsante dicono la cella", () => {
    const { engine, host, contexts, beside } = board();
    expect(command(engine).disabled()).toBe(t("canvas.commands.why.no_active_card"));
    expect(rowButton(host)).toBeNull();
    enter(host, "s");
    contexts.get("s")!.writing?.({ toolbar: null, context: { cell: "B3", formula: "=B1+B2" } });
    expect(command(engine).label).toBe("Apri a lato su B3");
    expect(command(engine).disabled()).toBeNull();
    // Nella riga delle opzioni, dopo la formula: il pulsante col nome scritto.
    const button = rowButton(host)!;
    expect(button.textContent).toBe("Apri a lato su B3");
    expect(button.hasAttribute("data-label")).toBe(true);
    const items = [...host.querySelectorAll<HTMLElement>(".canvas-options .canvas-options-item")]
      .filter((item) => item.parentElement?.closest(".canvas-options-item") === null)
      .map((item) => item.dataset.option);
    expect(items).toEqual(["formula", "beside"]);
    button.click();
    expect(beside).toEqual(["/Conti/voti.xlsx#B3"]);
    // Un'altra cella: il nome la segue.
    contexts.get("s")!.writing?.({ toolbar: null, context: { cell: "C4", formula: "" } });
    expect(rowButton(host)!.textContent).toBe("Apri a lato su C4");
    engine.destroy();
  });

  it("col riquadro accanto già aperto porta lì il punto nuovo, ogni volta", () => {
    const { engine, host, contexts, beside } = board();
    enter(host, "s");
    contexts.get("s")!.writing?.({ toolbar: null, context: { cell: "B3", formula: "" } });
    command(engine).run();
    contexts.get("s")!.writing?.({ toolbar: null, context: { cell: "D7", formula: "" } });
    command(engine).run();
    // Lo stesso file col punto di adesso: chi apre a lato (la shell,
    // `onOpenPathBeside`) riceve ogni volta la cella nuova.
    expect(beside).toEqual(["/Conti/voti.xlsx#B3", "/Conti/voti.xlsx#D7"]);
    engine.destroy();
  });

  it("da una scheda di nota apre la sezione che mostra", () => {
    const { engine, host, contexts, beside } = board();
    enter(host, "n");
    contexts.get("n")!.writing?.({ toolbar: null });
    expect(command(engine).label).toBe("Apri a lato su «Scopo»");
    command(engine).run();
    expect(beside).toEqual(["/Note/Fisica.md#Scopo"]);
    engine.destroy();
  });

  it("da un PDF apre la pagina mostrata, e il nome segue la pagina", () => {
    const { engine, host, contexts, beside, turnTo } = board();
    enter(host, "p");
    expect(command(engine).label).toBe("Apri a lato alla pagina 3");
    expect(rowButton(host)!.textContent).toBe("Apri a lato alla pagina 3");
    turnTo(5);
    contexts.get("p")!.pageChanged?.(5);
    expect(rowButton(host)!.textContent).toBe("Apri a lato alla pagina 5");
    command(engine).run();
    expect(beside).toEqual(["/Libri/manuale.pdf#page=5"]);
    engine.destroy();
  });

  it("senza un punto apre il file com'è, col nome di sempre; uscendo il pulsante se ne va", () => {
    const { engine, host, beside } = board();
    enter(host, "w");
    expect(command(engine).label).toBe("Apri a lato per questo");
    command(engine).run();
    expect(beside).toEqual(["/Note/Tutta.md"]);
    expect(rowButton(host)).not.toBeNull();
    const body = cardEl(host, "w").querySelector<HTMLElement>(".canvas-card-body")!;
    body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    expect(host.querySelector(".canvas-node[data-card-active]")).toBeNull();
    expect(rowButton(host)).toBeNull();
    expect(command(engine).disabled()).toBe(t("canvas.commands.why.no_active_card"));
    engine.destroy();
  });

  it("il tasto destro su una cella della scheda in scrittura ha in testa «Apri a lato» su quella cella", () => {
    const { engine, host, contexts, beside } = board();
    enter(host, "s");
    contexts.get("s")!.writing?.({ toolbar: null, context: { cell: "B3", formula: "" } });
    const menu = menuOn(engine, cardEl(host, "s").querySelector(".probe-cell")!);
    const first = menu.context![0] as SurfaceMenuItem;
    expect(first.id).toBe("canvas.open_beside_here");
    expect(first.label).toBe("Apri a lato su B3");
    expect(first.enabled).toBe(true);
    expect(menu.context![1]).toBe(MENU_RULE);
    first.run!();
    expect(beside).toEqual(["/Conti/voti.xlsx#B3"]);
    // Sulla testata, fuori dal contenuto, resta il menu della scheda.
    const plain = menuOn(engine, cardEl(host, "s").querySelector(".canvas-node-handle")!);
    expect((plain.context ?? []).some((entry) => typeof entry !== "string" && entry.id === "canvas.open_beside_here")).toBe(false);
    engine.destroy();
  });

  it("nella finestra stretta apre nello stesso riquadro, come «Apri»; in sola lettura si apre lo stesso", () => {
    const opened: string[] = [];
    const { engine, host, contexts, beside } = board({
      onOpenPath: (path) => {
        opened.push(path);
      },
    });
    engine.setReadOnly(true);
    enter(host, "s");
    contexts.get("s")!.writing?.({ toolbar: null, context: { cell: "A1", formula: "" } });
    expect(command(engine).disabled()).toBeNull();
    expect(command(engine).label).toBe("Apri a lato su A1");
    host.querySelector(".canvas-surface")!.setAttribute("data-narrow", "");
    // Il nome dice che si apre qui, non a lato.
    expect(command(engine).label).toBe("Apri qui su A1");
    command(engine).run();
    expect(opened).toEqual(["/Conti/voti.xlsx#A1"]);
    expect(beside).toEqual([]);
    engine.destroy();
  });

  it("senza chi apre a lato la voce è spenta col perché", () => {
    const { engine, host } = board({ onOpenPathBeside: undefined });
    enter(host, "p");
    expect(command(engine).label).toBe("Apri a lato alla pagina 3");
    expect(command(engine).disabled()).toBe(t("canvas.commands.why.no_beside"));
    engine.destroy();
  });
});

describe("convertire (T70)", () => {
  /** Un tratto attaccato a una scheda, come lo scrive la penna. */
  const cardInk = (id: string) => ({ v: 1, strokes: [{ id, tool: "pen", brush: "pf1 size=3", color: "#0072b2", anchor: { kind: "card", width: 240, height: 140 }, ink: "1 s100 cxy 100,100 5,5" }] });

  /** Un testo con un titolo e l'inchiostro (`t`), una nota (`n`), un PDF alla pagina 2 con l'inchiostro (`p`), due fili. */
  const board = (noteHeight = 140) => JSON.stringify({
    nodes: [
      { id: "t", type: "text", x: 0, y: 0, width: 240, height: 140, color: "4", text: "# Idee per la gita\nportare il pranzo", "fub:ink": cardInk("s-t") },
      { id: "n", type: "file", x: 0, y: 400, width: 240, height: noteHeight, file: "Note/gita.md" },
      { id: "p", type: "file", x: 600, y: 0, width: 360, height: 480, file: "docs/manuale.pdf", subpath: "#page=2", "fub:ink": cardInk("s-p") },
    ],
    edges: [
      { id: "e1", fromNode: "t", toNode: "n" },
      { id: "e2", fromNode: "p", toNode: "t" },
    ],
  });

  /** La porta delle note finta: `taken` sono i nomi già presi nella cartella. */
  function notesPort(taken: readonly string[] = [], text = "testo della nota") {
    return {
      freeName: vi.fn(async (_folder: string, name: string) => {
        let free = name;
        for (let n = 1; taken.includes(free); n += 1) free = `${name} ${n}`;
        return free;
      }),
      create: vi.fn(async (folder: string, name: string, _text: string) => (folder ? `${folder}/${name}.md` : `${name}.md`)),
      read: vi.fn(async (_path: string) => text),
    };
  }

  function open(overrides: Partial<CanvasEngineOptions> = {}, source = board()) {
    const notes = notesPort();
    const made = mounted(source, { documentId: "Lavagne/gita.canvas", notes, ...overrides });
    return { ...made, notes: (overrides.notes ?? notes) as ReturnType<typeof notesPort> };
  }

  function choose(engine: CanvasEngine, host: HTMLElement, id: string) {
    const pointing = vi.spyOn(document, "elementFromPoint").mockReturnValue(host.querySelector<HTMLElement>(`.canvas-node[data-node="${id}"]`));
    try {
      return engine.contextMenu({ x: 10, y: 10 });
    } finally {
      pointing.mockRestore();
    }
  }

  function command(engine: CanvasEngine, id: string) {
    return engine.commands().find((one) => one.id === id)!;
  }

  function dialog(): HTMLElement {
    const all = document.querySelectorAll<HTMLElement>(".kit-dialog");
    return all[all.length - 1]!;
  }

  const nodes = (engine: CanvasEngine) => readCanvas(engine.getDoc()).nodes;
  const node = (engine: CanvasEngine, id: string) => nodes(engine).find((one) => one.id === id);
  const edges = (engine: CanvasEngine) => readCanvas(engine.getDoc()).edges.map((edge) => `${edge.fromNode}>${edge.toNode}`);

  beforeEach(() => {
    notices.notify.mockClear();
  });

  it("il nome proposto: la prima riga senza #, pulita come una nota nuova; vuota o di soli divieti, il nome di serie; al più 80", () => {
    expect(proposedNoteName("# Idee per la gita\naltro")).toBe("Idee per la gita");
    expect(proposedNoteName("### Titolo: a/b?")).toBe("Titolo a b");
    expect(proposedNoteName("#tag resta\n")).toBe("#tag resta");
    expect(proposedNoteName("")).toBe(t("canvas.extract.untitled"));
    expect(proposedNoteName("\nla seconda riga non conta")).toBe(t("canvas.extract.untitled"));
    expect(proposedNoteName("# ///")).toBe(t("canvas.extract.untitled"));
    expect(proposedNoteName("x".repeat(200))).toBe("x".repeat(80));
  });

  it("«Estrai in una nota»: chiede il nome (quello che c'è già diventa «nome 1»), la nota nasce col testo nella cartella della lavagna, la scheda la mostra allo stesso posto coi fili e l'inchiostro", async () => {
    const notes = notesPort(["Idee per la gita"]);
    const { engine, host, changes, opened } = open({ notes });
    choose(engine, host, "t");
    const before = node(engine, "t")!;
    command(engine, "canvas.extract_note").run();
    await vi.waitFor(() => expect(dialog().querySelector<HTMLInputElement>(".kit-field-input")?.value).toBe("Idee per la gita 1"));
    expect(notes.freeName).toHaveBeenCalledWith("Lavagne", "Idee per la gita");
    dialog().querySelector<HTMLButtonElement>('[data-action="extract"]')!.click();
    await vi.waitFor(() => expect(node(engine, "t")?.type).toBe("file"));
    expect(notes.create).toHaveBeenCalledWith("Lavagne", "Idee per la gita 1", "# Idee per la gita\nportare il pranzo");
    const after = node(engine, "t")!;
    expect(after).toMatchObject({ id: "t", type: "file", file: "Lavagne/Idee per la gita 1.md", x: before.x, y: before.y, width: before.width, height: before.height, color: "4" });
    expect(after.text).toBeUndefined();
    expect(after["fub:ink"]).toEqual(before["fub:ink"]);
    expect(edges(engine)).toEqual(["t>n", "p>t"]);
    expect(changes).toHaveLength(1);
    // La notifica dice che la nota resta, con «Apri».
    expect(notices.notify).toHaveBeenCalledTimes(1);
    const [message, , action] = notices.notify.mock.calls[0]!;
    expect(message).toBe(t("canvas.extract.done", { name: "Idee per la gita 1" }));
    expect((action as { label: string }).label).toBe(t("canvas.extract.open"));
    await (action as { run: () => Promise<void> | void }).run();
    expect(opened).toContainEqual({ path: "/Lavagne/Idee per la gita 1.md" });
    // Un annulla solo riporta la scheda di testo; la nota non si tocca.
    expect(engine.undo()).toBe(true);
    expect(node(engine, "t")).toEqual(before);
    expect(edges(engine)).toEqual(["t>n", "p>t"]);
    expect(notes.create).toHaveBeenCalledTimes(1);
    engine.destroy();
  });

  it("alla radice del vault la nota nasce alla radice; il nome si può cambiare, e si pulisce", async () => {
    const { engine, host, notes } = open({ documentId: "gita.canvas" });
    choose(engine, host, "t");
    command(engine, "canvas.extract_note").run();
    await vi.waitFor(() => expect(dialog().querySelector(".kit-field-input")).not.toBeNull());
    type(dialog().querySelector<HTMLInputElement>(".kit-field-input")!, "  Gita: il pranzo  ");
    dialog().querySelector<HTMLButtonElement>('[data-action="extract"]')!.click();
    await vi.waitFor(() => expect(notes.create).toHaveBeenCalledWith("", "Gita il pranzo", expect.any(String)));
    await vi.waitFor(() => expect(node(engine, "t")?.file).toBe("Gita il pranzo.md"));
    engine.destroy();
  });

  it("rinunciare al nome non crea niente e non cambia la lavagna", async () => {
    const { engine, host, notes, changes } = open();
    choose(engine, host, "t");
    command(engine, "canvas.extract_note").run();
    await vi.waitFor(() => expect(dialog().querySelector('[data-action="cancel"]')).not.toBeNull());
    dialog().querySelector<HTMLButtonElement>('[data-action="cancel"]')!.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(notes.create).not.toHaveBeenCalled();
    expect(changes).toHaveLength(0);
    expect(node(engine, "t")?.type).toBe("text");
    engine.destroy();
  });

  it("«Copia il testo qui»: una scheda di testo col testo della nota accanto, scelta; la nota non cambia; un annulla", async () => {
    const { engine, host, notes, changes } = open();
    choose(engine, host, "n");
    command(engine, "canvas.copy_note_text").run();
    await vi.waitFor(() => expect(nodes(engine)).toHaveLength(4));
    expect(notes.read).toHaveBeenCalledWith("Note/gita.md");
    expect(notes.create).not.toHaveBeenCalled();
    const copy = nodes(engine)[3]!;
    expect(copy).toMatchObject({ type: "text", text: "testo della nota", x: 240 + NEXT_CARD_GAP, y: 400, width: 240, height: 160 });
    expect(node(engine, "n")).toMatchObject({ type: "file", file: "Note/gita.md" });
    expect(engine.selectedText()?.primary).toBe("testo della nota");
    expect(changes).toHaveLength(1);
    expect(engine.undo()).toBe(true);
    expect(nodes(engine).map((one) => one.id)).toEqual(["t", "n", "p"]);
    engine.destroy();
  });

  it("«Copia il testo qui» su una scheda-estratto copia solo le sezioni mostrate; una sezione sparita non si copia e non è un errore (T99)", async () => {
    const text = "# Gita\nintro\n## Pranzo\npanini\n## Treno\nore 8\n## Ritorno\nsera\n";
    const excerptBoard = (sections: readonly string[]) => JSON.stringify({
      // Il `subpath` è la prima sezione, come la scrive la tela (T73).
      nodes: [{ id: "n", type: "file", x: 0, y: 400, width: 240, height: 140, file: "Note/gita.md", subpath: `#${sections[0]}`, "fub:parts": { kind: "sections", sections } }],
      edges: [],
    });
    // Il sommario del provider: i titoli col byte dove comincia la loro riga.
    const titles: [number, string][] = [[1, "Gita"], [2, "Pranzo"], [2, "Treno"], [2, "Ritorno"]];
    const headings = titles.map(([level, title]) => ({ level, text: title, start: text.indexOf(`${"#".repeat(level)} ${title}\n`) }));
    const outline = vi.fn(async (_path: string) => headings);
    const { engine, host } = open({ notes: notesPort([], text), parts: { outline } }, excerptBoard(["Ritorno", "Sparita", "Pranzo"]));
    choose(engine, host, "n");
    command(engine, "canvas.copy_note_text").run();
    await vi.waitFor(() => expect(nodes(engine)).toHaveLength(2));
    expect(outline).toHaveBeenCalledWith("Note/gita.md");
    // Nell'ordine della scheda, senza la sezione che la nota non ha più.
    expect(nodes(engine)[1]).toMatchObject({ type: "text", text: "## Ritorno\nsera\n\n## Pranzo\npanini" });
    expect(host.querySelector(".canvas-intake-error")).toBeNull();
    engine.destroy();
    // Senza sommario (la porta manca, o la domanda fallisce) si copia la nota intera, come prima.
    for (const parts of [undefined, { outline: async () => Promise.reject(new Error("indice fermo")) }]) {
      const whole = open({ notes: notesPort([], text), ...(parts ? { parts } : {}) }, excerptBoard(["Ritorno"]));
      choose(whole.engine, whole.host, "n");
      command(whole.engine, "canvas.copy_note_text").run();
      await vi.waitFor(() => expect(nodes(whole.engine)).toHaveLength(2));
      expect(nodes(whole.engine)[1]).toMatchObject({ type: "text", text });
      whole.engine.destroy();
    }
    // Con tutte le sezioni sparite non nasce niente, e la lavagna dice quali mancano.
    const gone = open({ notes: notesPort([], text), parts: { outline } }, excerptBoard(["Sparita"]));
    choose(gone.engine, gone.host, "n");
    command(gone.engine, "canvas.copy_note_text").run();
    await vi.waitFor(() => expect(gone.host.querySelector(".canvas-intake-error")?.textContent).toBe(t("canvas.excerpt.section_missing", { name: "Sparita" })));
    expect(nodes(gone.engine)).toHaveLength(1);
    gone.engine.destroy();
  });

  it("una nota lunga nasce alta al più come la vista", async () => {
    const { engine, host } = open({}, board(5000));
    // Al 100%, subito: la vista (600 px di riserva in happy-dom) è alta 600 sulla lavagna.
    setReducedMotionPreference(true);
    command(engine, "canvas.zoom_reset").run();
    setReducedMotionPreference(false);
    choose(engine, host, "n");
    command(engine, "canvas.copy_note_text").run();
    await vi.waitFor(() => expect(nodes(engine)).toHaveLength(4));
    const copy = nodes(engine)[3]!;
    expect(copy.height).toBe(600);
    engine.destroy();
  });

  it("«Sostituisci il file…»: il selettore di sempre; la scheda tiene posto, misura, fili e inchiostro, e cambia specie; un annulla", async () => {
    const onPickFile = vi.fn(async () => "foto/gita.png");
    const { engine, host, changes } = open({ onPickFile });
    choose(engine, host, "p");
    const before = node(engine, "p")!;
    command(engine, "canvas.replace_file").run();
    await vi.waitFor(() => expect(node(engine, "p")?.file).toBe("foto/gita.png"));
    expect(onPickFile).toHaveBeenCalledWith();
    const after = node(engine, "p")!;
    expect(after).toMatchObject({ id: "p", type: "file", x: 600, y: 0, width: 360, height: 480 });
    // La pagina era del PDF; l'inchiostro attaccato resta nel file.
    expect(after.subpath).toBeUndefined();
    expect(after["fub:ink"]).toEqual(before["fub:ink"]);
    expect(edges(engine)).toEqual(["t>n", "p>t"]);
    expect(host.querySelector<HTMLElement>('.canvas-node[data-node="p"] .canvas-card-body')?.dataset.mediaKind).toBe("image");
    expect(changes).toHaveLength(1);
    expect(engine.undo()).toBe(true);
    expect(node(engine, "p")).toEqual(before);
    engine.destroy();
  });

  it("le voci stanno nel menu della scheda giusta, e in sola lettura sono spente col perché", () => {
    const { engine, host } = open({ onPickFile: async () => null });
    const ids = (id: string) => (choose(engine, host, id)!.context ?? []).flatMap((entry) => (typeof entry === "string" ? [] : [entry.id]));
    expect(ids("t")).toContain("canvas.extract_note");
    expect(ids("t")).not.toContain("canvas.copy_note_text");
    expect(ids("n")).toEqual(expect.arrayContaining(["canvas.copy_note_text", "canvas.replace_file"]));
    expect(ids("p")).toContain("canvas.replace_file");
    expect(ids("p")).not.toContain("canvas.copy_note_text");
    engine.setReadOnly(true);
    choose(engine, host, "t");
    for (const id of ["canvas.extract_note", "canvas.copy_note_text", "canvas.replace_file"]) {
      expect(command(engine, id).disabled()).toBe(t("canvas.commands.why.read_only"));
    }
    engine.destroy();
  });

  it("senza la porta delle note i due comandi non ci sono", () => {
    const { engine } = mounted(board());
    expect(engine.commands().some((one) => one.id === "canvas.extract_note" || one.id === "canvas.copy_note_text")).toBe(false);
    engine.destroy();
  });
});

// «Ritaglia e ruota» (T78): la zona di un'immagine è `fub:parts` `image` sulla
// scheda, scritto in un commit; Esc lascia com'era; il file dell'immagine non
// riceve mai una scrittura (la tela non ha una porta per scrivere nel file di
// una scheda d'immagine: le porte che toccano file restano ferme, e cambia
// solo il testo della lavagna).
describe("il ritaglio di un'immagine (T78)", () => {
  const lastMount = (board: { mounts: Array<{ id: string; parts: CardContext["parts"] }> }) => board.mounts[board.mounts.length - 1]!;
  const CROP_INK = {
    id: "s-1", tool: "pen",
    brush: "pf1 size=3 thinning=0.5 smoothing=0.5 streamline=0.5 taperStart=0 taperEnd=0 capStart=1 capEnd=1 sim=0 pen=ballpoint",
    color: "#0072b2", anchor: { kind: "card", width: 400, height: 300 },
    ink: "1 s100 cxy 4000,2500 120,40 95,-10",
  };

  function cropBoard(extra: Record<string, unknown> = {}, overrides: Partial<CanvasEngineOptions> = {}) {
    const mounts: Array<{ id: string; parts: CardContext["parts"] }> = [];
    const renderer: CardRenderer = {
      kinds: ["image"],
      mount(node, host, _mode, context): CardView {
        mounts.push({ id: node.id, parts: context.parts ?? null });
        const root = document.createElement("div");
        root.className = "canvas-card-image";
        root.dataset.cardState = "picture";
        // L'immagine intera è 400 × 300; una zona la scheda la dipinge tagliata.
        const canvas = document.createElement("canvas");
        canvas.className = "canvas-card-picture";
        canvas.width = context.parts ? 120 : 400;
        canvas.height = context.parts ? 90 : 300;
        root.append(canvas);
        host.append(root);
        return { setMode: () => {}, destroy: () => root.remove() };
      },
    };
    const writes = { trash: vi.fn(), replace: vi.fn(async () => null), attach: vi.fn() };
    const made = mounted(JSON.stringify({
      nodes: [
        { id: "f", type: "file", file: "allegati/foto.png", x: 0, y: 0, width: 400, height: 300, ...extra },
        { id: "t", type: "text", x: 600, y: 0, width: 200, height: 100, text: "accanto" },
      ],
      edges: [],
    }), {
      cards: { registry: createCardRegistry([renderer]), snapshots: new CardCache(), watch: () => () => {} },
      onTrashPath: writes.trash,
      onPickFile: writes.replace,
      ...overrides,
    });
    const pick = (id = "f") => {
      const pointing = vi.spyOn(document, "elementFromPoint").mockReturnValue(made.host.querySelector<HTMLElement>(`.canvas-node[data-node="${id}"]`));
      try {
        return made.engine.contextMenu({ x: 10, y: 10 })!;
      } finally {
        pointing.mockRestore();
      }
    };
    const crop = () => made.engine.commands().find((one) => one.id === "canvas.crop")!;
    const card = () => made.host.querySelector<HTMLElement>('.canvas-node[data-node="f"]')!;
    const image = () => readCanvas(made.engine.getDoc()).nodes.find((one) => one.id === "f")!;
    const key = (target: Element, key: string, init: KeyboardEventInit = {}) =>
      target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init }));
    const box = () => card().querySelector<HTMLElement>(".canvas-crop-box")!;
    const barButton = (name: string) => made.host.querySelector<HTMLButtonElement>(`.canvas-crop-foot .canvas-crop-bar [data-crop="${name}"]`)!;
    return { ...made, mounts, writes, pick, crop, card, image, key, box, barButton };
  }

  it("la voce sta nel menu della scheda d'immagine dopo «Apri nel visore», in Ctrl+/ e nella barra della selezione", () => {
    const board = cropBoard();
    const items = (board.pick().context ?? []).filter((entry): entry is SurfaceMenuItem => typeof entry !== "string");
    const ids = items.map((item) => item.id);
    expect(ids.indexOf("canvas.crop")).toBe(ids.indexOf("canvas.open_viewer") + 1);
    const entry = items.find((item) => item.id === "canvas.crop")!;
    expect(entry.label).toBe(t("canvas.crop"));
    expect(entry.icon).toBe("draw-image");
    expect(board.crop().disabled()).toBeNull();
    expect(board.crop().label).toBe(t("canvas.crop"));
    expect(board.host.querySelector('.canvas-selection-bar [data-command="canvas.crop"]')).not.toBeNull();
    // Su una scheda di testo la voce non c'è e il comando è spento col perché.
    const other = board.pick("t");
    expect((other.context ?? []).some((item) => typeof item !== "string" && item.id === "canvas.crop")).toBe(false);
    expect(board.crop().disabled()).toBe(t("canvas.commands.why.one_image"));
    board.engine.destroy();
  });

  it("in sola lettura la voce non c'è e il comando è spento; senza chi mostra le immagini il comando non c'è", () => {
    const board = cropBoard();
    board.engine.setReadOnly(true);
    const items = (board.pick().context ?? []).filter((entry): entry is SurfaceMenuItem => typeof entry !== "string");
    expect(items.some((item) => item.id === "canvas.crop")).toBe(false);
    expect(board.crop().disabled()).toBe(t("canvas.commands.why.read_only"));
    board.crop().run();
    expect(board.host.querySelector(".canvas-crop")).toBeNull();
    board.engine.destroy();

    const bare = mounted();
    expect(bare.engine.commands().some((one) => one.id === "canvas.crop")).toBe(false);
    bare.engine.destroy();
  });

  it("apre il ritaglio sopra la scheda: l'immagine intera, la zona, la barra; niente si scrive", () => {
    const board = cropBoard({ "fub:parts": { kind: "image", rect: [0.25, 0, 0.5, 1] } });
    board.pick();
    expect(lastMount(board).parts).toEqual({ kind: "image", rect: [0.25, 0, 0.5, 1], rotate: null, extra: {} });
    board.crop().run();
    // La vista si rimonta sull'immagine intera.
    expect(lastMount(board).parts).toBeNull();
    expect(board.card().hasAttribute("data-card-cropping")).toBe(true);
    expect(board.card().querySelector(".canvas-card-body > .canvas-crop .canvas-crop-box")).not.toBeNull();
    // La barra sta nella zona della vista che non scala, come quella della selezione.
    expect(board.host.querySelector(".canvas-area > .canvas-crop-foot > .canvas-crop-bar")).not.toBeNull();
    expect(board.card().querySelector(".canvas-crop-bar")).toBeNull();
    expect(document.activeElement).toBe(board.box());
    expect(board.changes).toHaveLength(0);
    board.engine.destroy();
  });

  it("«Fatto» scrive la zona e le proporzioni in un commit solo, che un annulla toglie; il file non si tocca", () => {
    const board = cropBoard();
    const before = board.image();
    board.pick();
    board.crop().run();
    // La zona di serie è tutta l'immagine: la si stringe dall'angolo in basso a destra, poi si ruota.
    for (let i = 0; i < 5; i += 1) board.key(board.box(), "ArrowLeft", { altKey: true, shiftKey: true });
    board.barButton("rotate-right").click();
    board.barButton("done").click();
    expect(board.changes).toHaveLength(1);
    const after = board.image();
    expect(after["fub:parts"]).toEqual({ kind: "image", rect: [0, 0, 0.5, 1], rotate: 90 });
    expect(after.subpath).toBeUndefined();
    expect(after.file).toBe("allegati/foto.png");
    // La zona è 200 × 300 px; ruotata 300 × 200: la scheda tiene i 400 di
    // larghezza e prende 400 × 200 / 300.
    expect(after).toMatchObject({ x: 0, y: 0, width: 400, height: 267 });
    expect(board.card().hasAttribute("data-card-cropping")).toBe(false);
    expect(board.host.querySelector(".canvas-crop, .canvas-crop-foot")).toBeNull();
    // La scheda mostra la zona.
    expect(lastMount(board).parts).toEqual({ kind: "image", rect: [0, 0, 0.5, 1], rotate: 90, extra: {} });
    expect(board.engine.undo()).toBe(true);
    expect(board.image()).toEqual(before);
    // Ciò che cambia è solo la lavagna: nessuna porta che tocca file si è mossa.
    expect(board.writes.trash).not.toHaveBeenCalled();
    expect(board.writes.replace).not.toHaveBeenCalled();
    expect(board.changes.every((change) => readCanvas(change.text).nodes.some((one) => one.id === "f"))).toBe(true);
    board.engine.destroy();
  });

  it("Invio scrive come «Fatto»; un clic fuori dal ritaglio lo applica", () => {
    const board = cropBoard();
    board.pick();
    board.crop().run();
    board.key(board.box(), "ArrowUp", { altKey: true, shiftKey: true });
    board.key(board.box(), "Enter");
    expect(board.image()["fub:parts"]).toEqual({ kind: "image", rect: [0, 0, 1, 0.9] });
    expect(board.changes).toHaveLength(1);

    board.pick();
    board.crop().run();
    // Riaperto, la zona è quella scritta.
    board.key(board.box(), "ArrowUp", { altKey: true, shiftKey: true });
    board.host.querySelector(".canvas-viewport")!.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, pointerId: 4, clientX: 900, clientY: 900 }));
    expect(board.image()["fub:parts"]).toEqual({ kind: "image", rect: [0, 0, 1, 0.8] });
    expect(board.changes).toHaveLength(2);
    expect(board.host.querySelector(".canvas-crop")).toBeNull();
    board.engine.destroy();
  });

  it("Esc lascia com'era: niente commit, la scheda torna alla sua zona e alla sua altezza", () => {
    const board = cropBoard({ "fub:parts": { kind: "image", rect: [0.25, 0, 0.5, 1] }, height: 600 });
    const before = board.image();
    board.pick();
    board.crop().run();
    // Intanto la scheda mostra l'immagine intera (400 × 300) alla sua larghezza.
    expect(board.card().style.height).toBe("300px");
    board.barButton("rotate-left").click();
    expect(board.card().style.height).toBe("533px");
    board.key(board.box(), "ArrowRight");
    board.key(board.box(), "Escape");
    expect(board.changes).toHaveLength(0);
    expect(board.image()).toEqual(before);
    expect(board.card().style.height).toBe("600px");
    expect(board.card().querySelector(".canvas-crop")).toBeNull();
    expect(lastMount(board).parts).toEqual({ kind: "image", rect: [0.25, 0, 0.5, 1], rotate: null, extra: {} });
    // Esc sulla lavagna, col fuoco fuori dal ritaglio, fa lo stesso.
    board.crop().run();
    board.key(board.host.querySelector(".canvas-viewport")!, "Escape");
    expect(board.host.querySelector(".canvas-crop")).toBeNull();
    expect(board.changes).toHaveLength(0);
    board.engine.destroy();
  });

  it("«Togli il ritaglio» torna all'immagine intera in un commit, e la scheda tiene il resto", () => {
    const board = cropBoard({ "fub:parts": { kind: "image", rect: [0.25, 0, 0.5, 1], rotate: 90, "x-mio": 1 }, height: 600, color: "4" });
    board.pick();
    board.crop().run();
    board.barButton("remove").click();
    expect(board.changes).toHaveLength(1);
    const after = board.image();
    expect(after["fub:parts"]).toBeUndefined();
    expect(after).toMatchObject({ width: 400, height: 300, color: "4" });
    expect(lastMount(board).parts).toBeNull();
    expect(board.engine.undo()).toBe(true);
    expect(board.image()["fub:parts"]).toEqual({ kind: "image", rect: [0.25, 0, 0.5, 1], rotate: 90, "x-mio": 1 });
    board.engine.destroy();
  });

  it("i campi sconosciuti di una zona valida restano quando la si cambia", () => {
    const board = cropBoard({ "fub:parts": { kind: "image", rect: [0, 0, 0.5, 1], "x-mio": { a: 1 } } });
    board.pick();
    board.crop().run();
    board.key(board.box(), "ArrowRight", { shiftKey: true });
    board.key(board.box(), "Enter");
    expect(board.image()["fub:parts"]).toEqual({ kind: "image", rect: [0.1, 0, 0.5, 1], "x-mio": { a: 1 } });
    board.engine.destroy();
  });

  it("con l'inchiostro sulla scheda il piede dice che il tratto resta attaccato, e il tratto non si tocca", () => {
    const board = cropBoard({ "fub:ink": { v: 1, strokes: [CROP_INK] } });
    board.pick();
    board.crop().run();
    expect(board.host.querySelector(".canvas-crop-foot > .canvas-crop-note")?.textContent).toBe(t("canvas.crop.ink"));
    board.key(board.box(), "ArrowLeft", { altKey: true, shiftKey: true });
    board.barButton("done").click();
    expect(board.image()["fub:ink"]).toEqual({ v: 1, strokes: [CROP_INK] });
    board.engine.destroy();
  });

  it("si chiude da sé, senza scrivere, se la lavagna diventa di sola lettura o la scheda sparisce", () => {
    const board = cropBoard();
    board.pick();
    board.crop().run();
    board.engine.setReadOnly(true);
    expect(board.host.querySelector(".canvas-crop")).toBeNull();
    expect(board.changes).toHaveLength(0);
    board.engine.setReadOnly(false);
    board.pick();
    board.crop().run();
    expect(board.host.querySelector(".canvas-crop")).not.toBeNull();
    board.engine.setDoc(JSON.stringify({ nodes: [{ id: "t", type: "text", x: 600, y: 0, width: 200, height: 100, text: "accanto" }], edges: [] }));
    expect(board.host.querySelector(".canvas-crop, .canvas-crop-foot")).toBeNull();
    board.engine.destroy();
  });

  it("un'immagine che non si legge non si ritaglia", () => {
    const board = cropBoard();
    board.card().querySelector<HTMLElement>(".canvas-card-image")!.dataset.cardState = "unreadable";
    board.pick();
    expect(board.crop().disabled()).toBe(t("canvas.crop.why.unreadable"));
    board.engine.destroy();
  });

  /** La camera dello stage: `translate(x, y) scale(zoom)`. */
  function cropCamera(host: HTMLElement): { x: number; y: number; zoom: number } {
    const transform = host.querySelector<HTMLElement>(".canvas-stage")!.style.transform;
    const match = /translate\((-?[\d.e+-]+)px, (-?[\d.e+-]+)px\) scale\(([\d.e+-]+)\)/.exec(transform)!;
    return { x: Number(match[1]), y: Number(match[2]), zoom: Number(match[3]) };
  }
  /** Uno scatto della rotella (di serie sposta la lavagna). */
  function cropScroll(host: HTMLElement, deltaY: number): void {
    const event = new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY });
    Object.defineProperties(event, { clientX: { value: 300 }, clientY: { value: 200 } });
    host.querySelector(".canvas-viewport")!.dispatchEvent(event);
  }
  /** Dove la barra del ritaglio deve stare, con la camera di adesso (happy-dom: il piede misura 0, la vista 800 × 600). */
  function cropFootAt(host: HTMLElement, height: number): { left: number; top: number } {
    const camera = cropCamera(host);
    return selectionBarPlaceBelow(
      { left: camera.x, top: camera.y, right: camera.x + 400 * camera.zoom, bottom: camera.y + height * camera.zoom },
      { width: 0, height: 0 },
      { width: 800, height: 600 },
    )!;
  }

  it("a zoom basso la barra non scala: sta nella zona della vista, posata sotto la scheda come la barra della selezione", () => {
    const board = cropBoard();
    board.pick();
    board.crop().run();
    const viewport = board.host.querySelector<HTMLElement>(".canvas-viewport")!;
    for (let i = 0; i < 40 && cropCamera(board.host).zoom > 0.35; i += 1) {
      viewport.dispatchEvent(new KeyboardEvent("keydown", { key: "-", ctrlKey: true, bubbles: true, cancelable: true }));
    }
    expect(cropCamera(board.host).zoom).toBeLessThanOrEqual(0.35);
    const foot = board.host.querySelector<HTMLElement>(".canvas-crop-foot")!;
    // Fuori dallo stage che scala: la sua misura sullo schermo è la stessa a ogni zoom.
    expect(foot.closest(".canvas-stage")).toBeNull();
    expect(foot.parentElement!.classList.contains("canvas-area")).toBe(true);
    const at = cropFootAt(board.host, 300);
    expect([parseFloat(foot.style.left), parseFloat(foot.style.top)]).toEqual([at.left, at.top]);
    // Sotto la scheda, che sullo schermo è alta 300 × zoom.
    const camera = cropCamera(board.host);
    expect(parseFloat(foot.style.top)).toBeGreaterThan(camera.y + 300 * camera.zoom);
    board.engine.destroy();
  });

  it("con la scheda che esce dal fondo della vista la barra va sopra; ruotata in verticale resta nella vista", () => {
    const board = cropBoard();
    board.pick();
    board.crop().run();
    // La scheda scende finché la sua testa sta a 400 px: il fondo esce dalla vista di 600.
    cropScroll(board.host, cropCamera(board.host).y - 400);
    const camera = cropCamera(board.host);
    expect(camera.y).toBe(400);
    expect(camera.y + 300 * camera.zoom).toBeGreaterThan(600);
    const foot = board.host.querySelector<HTMLElement>(".canvas-crop-foot")!;
    expect(parseFloat(foot.style.top)).toBeLessThan(400);
    expect(parseFloat(foot.style.top)).toBe(cropFootAt(board.host, 300).top);
    // Un quarto di giro: la scheda si allunga (400 × 533), la barra resta sopra, dentro la vista.
    board.barButton("rotate-right").click();
    expect(board.card().style.height).toBe("533px");
    expect(parseFloat(foot.style.top)).toBe(cropFootAt(board.host, 533).top);
    expect(parseFloat(foot.style.top)).toBeGreaterThanOrEqual(8);
    expect(parseFloat(foot.style.top)).toBeLessThan(400);
    // Tutta fuori, sotto: la barra resta al fondo della vista, e «Fatto» si preme.
    cropScroll(board.host, -400);
    expect(cropCamera(board.host).y).toBe(800);
    expect(parseFloat(foot.style.top)).toBe(592);
    board.barButton("done").click();
    expect(board.image()["fub:parts"]).toEqual({ kind: "image", rect: [0, 0, 1, 1], rotate: 90 });
    board.engine.destroy();
  });
});
