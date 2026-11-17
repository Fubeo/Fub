// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EditorView, runScopeHandlers } from "@codemirror/view";
import type { CommandSpec } from "../host/contract";
import type { EditorSurface } from "../editors/core/registry";
import type { EditorActionState, SurfaceEditorActions } from "../editors/core/editor-actions";
import { mountMarkdownSurface, type MarkdownSurface } from "../editors/text/profiles/markdown/surface";
import { registerFormatIcons } from "./format-bar";
import {
  bubbleWanted,
  COMMENT_ACTION,
  createMiniBar,
  LINK_ACTION,
  MINIBAR_COLORS,
  miniBarModeOf,
  mountMiniBar,
  type MiniBar,
  type MiniBarMode,
} from "./mini-bar";
import { closeContextMenu, showContextMenu } from "../ui/menu";

// Il primo commento chiede chi firma (T22): le impostazioni sono finte.
vi.mock("../host/query", async (original) => ({
  ...(await original<typeof import("../host/query")>()),
  settings: async () => [
    { spec: { key: "profile.name" }, value: "Anna Bianchi" },
    { spec: { key: "comments.author" }, value: "nome" },
  ],
}));
vi.mock("mermaid", () => ({
  default: { initialize() {}, render: async () => ({ svg: "<svg xmlns=\"http://www.w3.org/2000/svg\"></svg>" }) },
}));

function spec(id: string, title: string): CommandSpec {
  return {
    id, title, description: "", keybinding: null, params: [],
    scope: { writes: false, reach: "session", reversible: true }, surfaces: ["toolbar"],
  };
}

/// I comandi che «Trasforma» offre: quelli che il plugin dichiara.
const SPECS = [
  spec("text.undo", "Annulla"),
  spec("markdown.paragraph", "Paragrafo"),
  spec("markdown.heading.2", "Titolo 2"),
  spec("markdown.heading.3", "Titolo 3"),
  spec("markdown.quote", "Citazione"),
  spec("markdown.list.bullet", "Elenco puntato"),
  spec("markdown.bold", "Grassetto"),
  spec("markdown.link", "Link"),
];

/// Il percorso dei pulsanti, nell'ordine del prototipo (E8).
const ORDER = [
  "mini-bar.transform",
  "markdown.bold",
  "markdown.italic",
  "markdown.underline",
  "markdown.strikethrough",
  "markdown.code",
  LINK_ACTION,
  "mini-bar.color",
  COMMENT_ACTION,
];

const CHORDS: Record<string, string> = {
  "markdown.bold": "Mod-b",
  "markdown.italic": "Mod-i",
  "markdown.underline": "Mod-u",
  "markdown.strikethrough": "Mod-Shift-x",
  "markdown.code": "Mod-`",
  [LINK_ACTION]: "Mod-k",
  [COMMENT_ACTION]: "Mod-Alt-m",
};

const KNOWN = new Set([
  ...Object.keys(CHORDS),
  "text.undo", "markdown.paragraph", "markdown.heading.2", "markdown.heading.3", "markdown.quote", "markdown.list.bullet",
  ...MINIBAR_COLORS.flatMap((color) => [`markdown.color.${color}`, `markdown.background.${color}`]),
  "markdown.color.default", "markdown.background.default",
]);

function fake(known: ReadonlySet<string> = KNOWN) {
  const runs: string[] = [];
  const states = new Map<string, EditorActionState>();
  let editable = true;
  const actions: SurfaceEditorActions = {
    has: (id) => known.has(id),
    editable: () => editable,
    state: (id) => (editable ? states.get(id) ?? { enabled: true, active: null } : { enabled: false, active: null }),
    run: (id) => (runs.push(id), true),
    chord: (id) => CHORDS[id] ?? null,
    subscribe: () => () => {},
  };
  const surface = { family: "text", profile: "markdown", surfaceId: "p", modes: [], setMode: () => {}, editorActions: actions, destroy: () => {} } as EditorSurface;
  return {
    surface,
    runs,
    states,
    setEditable(value: boolean) {
      editable = value;
    },
  };
}

const commandsOf = (root: ParentNode): string[] =>
  [...root.querySelectorAll<HTMLElement>(".mini-bar [data-command]")].map((el) => el.dataset["command"]!);

describe("quando c'è la mini-barra", () => {
  it("legge l'impostazione e cade su auto per ciò che non conosce", () => {
    expect(miniBarModeOf("always")).toBe("always");
    expect(miniBarModeOf("off")).toBe("off");
    expect(miniBarModeOf(undefined)).toBe("auto");
    expect(miniBarModeOf("altro")).toBe("auto");
  });

  it("sul testo scelto: auto solo a barra spenta, always sempre, menu e off mai", () => {
    const cases: [MiniBarMode, boolean, boolean][] = [
      ["auto", true, true], ["auto", false, false],
      ["always", false, true], ["always", true, true],
      ["menu", true, false], ["off", true, false],
    ];
    for (const [mode, barOff, shown] of cases) expect(bubbleWanted(mode, barOff)).toBe(shown);
  });
});

describe("la mini-barra", () => {
  let stop: () => void;
  let bar: MiniBar | null = null;

  beforeEach(() => {
    document.body.innerHTML = '<div id="app"></div>';
    stop = registerFormatIcons();
  });
  afterEach(() => {
    bar?.destroy();
    bar = null;
    closeContextMenu();
    stop();
    document.body.innerHTML = "";
  });

  function make(f = fake()): MiniBar {
    bar = createMiniBar({ surface: () => f.surface, writing: () => true, focusPane: () => {}, runCommand: () => {} });
    bar.update(SPECS);
    document.body.append(bar.element);
    return bar;
  }

  it("ha i pulsanti del prototipo, in quest'ordine, coi fili fra i gruppi", () => {
    const { element } = make();
    expect(element.getAttribute("role")).toBe("toolbar");
    expect(element.getAttribute("aria-label")).toBe("Formato della selezione");
    expect(commandsOf(element)).toEqual(ORDER);
    expect(element.querySelectorAll(".mini-bar-rule")).toHaveLength(3);
    const names = [...element.querySelectorAll("button")].map((button) => button.getAttribute("aria-label"));
    expect(names).toEqual(["Trasforma", "Grassetto", "Corsivo", "Sottolineato", "Barrato", "Codice in riga", "Collega", "Colore", "Commenta"]);
    // Trasforma e Commenta hanno il nome scritto, B I U S sono lettere.
    expect(element.querySelector("[data-command='mini-bar.transform'] .mini-bar-text")?.textContent).toBe("Trasforma");
    expect(element.querySelector(`[data-command='${COMMENT_ACTION}'] .mini-bar-text`)?.textContent).toBe("Commenta");
    expect(element.querySelector("[data-command='markdown.bold'] .mini-bar-glyph")?.textContent).toBe("B");
  });

  it("ogni pulsante dice la scorciatoia vera della superficie, a chi guarda e a chi ascolta", () => {
    const { element } = make();
    const bold = element.querySelector<HTMLButtonElement>("[data-command='markdown.bold']")!;
    expect(bold.getAttribute("aria-keyshortcuts")).toBe("Control+B");
    expect(element.querySelector(`[data-command='${COMMENT_ACTION}']`)!.getAttribute("aria-keyshortcuts")).toBe("Control+Alt+M");
    expect(element.querySelector(`[data-command='${LINK_ACTION}']`)!.getAttribute("aria-keyshortcuts")).toBe("Control+K");
    bold.dispatchEvent(new FocusEvent("focus"));
    const tip = document.getElementById(bold.getAttribute("aria-describedby")!);
    expect(tip?.textContent).toBe("Grassetto (Ctrl+B)");
  });

  it("una superficie che non sa un gesto non lo mostra, e il suo filo se ne va con lui", () => {
    const { element } = make(fake(new Set(["markdown.bold", "markdown.italic", COMMENT_ACTION])));
    expect(commandsOf(element)).toEqual(["markdown.bold", "markdown.italic", COMMENT_ACTION]);
    expect(element.querySelectorAll(".mini-bar-rule")).toHaveLength(1);
  });

  it("senza gesti è nascosta", () => {
    const { element } = make(fake(new Set()));
    expect(element.hidden).toBe(true);
  });

  it("premuto e spento li dice la superficie, e `refresh` li rilegge", () => {
    const f = fake();
    const b = make(f);
    f.states.set("markdown.bold", { enabled: true, active: true });
    f.states.set("markdown.code", { enabled: false, active: false });
    f.states.set(COMMENT_ACTION, { enabled: false, active: null });
    b.refresh();
    const at = (id: string) => b.element.querySelector<HTMLButtonElement>(`[data-command='${id}']`)!;
    expect(at("markdown.bold").getAttribute("aria-pressed")).toBe("true");
    expect(at("markdown.italic").getAttribute("aria-pressed")).toBeNull();
    expect(at("markdown.code").disabled).toBe(true);
    expect(at(COMMENT_ACTION).disabled).toBe(true);
    // Sola lettura: niente si può, la forma resta.
    f.setEditable(false);
    b.refresh();
    expect([...b.element.querySelectorAll("button")].every((button) => button.disabled)).toBe(true);
    expect(commandsOf(b.element)).toEqual(ORDER);
  });

  it("un clic esegue l'azione della scorciatoia, e Commenta la sua", () => {
    const f = fake();
    const { element } = make(f);
    for (const id of ["markdown.bold", "markdown.italic", "markdown.underline", "markdown.strikethrough", "markdown.code", LINK_ACTION, COMMENT_ACTION]) {
      element.querySelector<HTMLButtonElement>(`[data-command='${id}']`)!.click();
    }
    expect(f.runs).toEqual(["markdown.bold", "markdown.italic", "markdown.underline", "markdown.strikethrough", "markdown.code", LINK_ACTION, COMMENT_ACTION]);
  });

  it("il puntatore non prende il fuoco: la selezione resta all'editor", () => {
    const { element } = make();
    const press = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
    element.querySelector("[data-command='markdown.bold']")!.dispatchEvent(press);
    expect(press.defaultPrevented).toBe(true);
  });

  it("Trasforma apre «Trasforma in», lo stesso menu dello stile del blocco", () => {
    const f = fake();
    f.states.set("markdown.heading.2", { enabled: true, active: false });
    const { element } = make(f);
    const trigger = element.querySelector<HTMLButtonElement>("[data-command='mini-bar.transform']")!;
    trigger.click();
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(bar!.holding()).toBe(true);
    const items = [...document.querySelectorAll<HTMLElement>("#context-menu [role='menuitemradio']")];
    expect(items.map((item) => item.querySelector(".menu-label")?.textContent)).toEqual(["Testo", "Titolo 2", "Titolo 3", "Citazione", "Elenco puntato"]);
    items[1]!.click();
    expect(f.runs).toEqual(["markdown.heading.2"]);
  });

  it("Colore apre le due righe dei nove colori; un clic colora, il colore già scelto si toglie", () => {
    const f = fake();
    f.states.set("markdown.background.yellow", { enabled: true, active: true });
    const { element } = make(f);
    const trigger = element.querySelector<HTMLButtonElement>("[data-command='mini-bar.color']")!;
    // Dalla tastiera: Invio sul pulsante è un clic senza puntatore (`detail` 0).
    trigger.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 0 }));
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    const panel = document.querySelector<HTMLElement>(".mini-bar-colors")!;
    expect(panel.getAttribute("aria-label")).toBe("Colore");
    expect([...panel.querySelectorAll(".mini-bar-colors-label")].map((label) => label.textContent)).toEqual(["Testo", "Sfondo"]);
    const swatches = [...panel.querySelectorAll<HTMLButtonElement>(".mini-bar-swatch")];
    expect(swatches).toHaveLength(18);
    expect(swatches.map((swatch) => swatch.getAttribute("aria-label")).slice(0, 9)).toEqual(["Grigio", "Marrone", "Arancione", "Giallo", "Verde", "Blu", "Viola", "Rosa", "Rosso"]);
    // Il fuoco va sul colore scelto: il fondo giallo.
    expect(document.activeElement).toBe(panel.querySelector("[data-command='markdown.background.yellow']"));
    // Le frecce si muovono nella griglia.
    document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }));
    expect(document.activeElement).toBe(panel.querySelector("[data-command='markdown.color.yellow']"));
    panel.querySelector<HTMLButtonElement>("[data-command='markdown.color.red']")!.click();
    expect(f.runs).toEqual(["markdown.color.red"]);
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    // Col puntatore il fuoco resta dov'era.
    const before = document.activeElement;
    trigger.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 }));
    expect(document.activeElement).toBe(before);
    document.querySelector<HTMLButtonElement>(".mini-bar-colors [data-command='markdown.background.yellow']")!.click();
    expect(f.runs).toEqual(["markdown.color.red", "markdown.background.default"]);
  });
});

describe("la mini-barra del menu", () => {
  let stop: () => void;
  const f = fake();
  const barHost = { surface: () => f.surface, writing: () => true, focusPane: vi.fn(), runCommand: () => {} };

  beforeEach(() => {
    document.body.innerHTML = '<div id="app"></div>';
    stop = registerFormatIcons();
    f.runs.length = 0;
  });
  afterEach(() => {
    closeContextMenu();
    stop();
    document.body.innerHTML = "";
  });

  it("è la stessa mini-barra, in testa al menu", () => {
    const mount = mountMiniBar(barHost, SPECS, null)!;
    const host = document.createElement("div");
    const unmount = mount(host);
    expect(host.classList.contains("context-strip-mini")).toBe(true);
    expect(commandsOf(host)).toEqual(ORDER);
    unmount();
    expect(host.childElementCount).toBe(0);
    expect(host.classList.contains("context-strip-mini")).toBe(false);
  });

  it("un gesto dalla barra esegue l'azione e chiude il menu", async () => {
    const strip = mountMiniBar(barHost, SPECS, null)!;
    showContextMenu({ x: 10, y: 10 }, [{ label: "Copia", run: () => {} }], { strip });
    const bold = document.querySelector<HTMLButtonElement>('.context-strip [data-command="markdown.bold"]');
    expect(bold).not.toBeNull();
    bold!.click();
    expect(f.runs).toEqual(["markdown.bold"]);
    // Il menu esce con la sua animazione: basta che se ne vada.
    await vi.waitFor(() => expect(document.getElementById("context-menu")).toBeNull());
    expect(document.querySelector(".context-strip")).toBeNull();
  });

  it("spenta non c'è; una superficie con la sua la preferisce", () => {
    document.getElementById("app")!.dataset["minibar"] = "off";
    expect(mountMiniBar(barHost, SPECS, null)).toBeNull();
    document.getElementById("app")!.dataset["minibar"] = "menu";
    const own = { mount: vi.fn(() => () => {}) };
    const host = document.createElement("div");
    mountMiniBar(barHost, SPECS, own)!(host);
    expect(own.mount).toHaveBeenCalledWith(host);
  });
});

// # Pulsante e scorciatoia
//
// Su una nota vera (la superficie Markdown), ogni pulsante deve dare ciò che
// dà la sua scorciatoia: lo stesso testo, e un solo passo d'annullamento che
// lo riporta com'era. Dove la scorciatoia non c'è (Trasforma, Colore) il
// confronto è col comando che la palette e il «/» eseguono.

/// L'evento di un accordo come lo scrive la superficie (`Mod-Shift-x`).
function chordEvent(chord: string): KeyboardEvent {
  const parts = chord.split("-");
  const key = parts.pop()!;
  const shift = parts.includes("Shift");
  // CodeMirror cerca `Shift-x` col tasto di base (`keyCode`), come fa il
  // browser vero: senza, un accordo con Maiusc non lo trova.
  const event = new KeyboardEvent("keydown", {
    key: shift && key.length === 1 ? key.toUpperCase() : key,
    ctrlKey: parts.includes("Mod") || parts.includes("Ctrl"),
    altKey: parts.includes("Alt"),
    shiftKey: shift,
    bubbles: true,
    cancelable: true,
  });
  const code = key === "`" ? 192 : key.toUpperCase().charCodeAt(0);
  Object.defineProperty(event, "keyCode", { value: code });
  return event;
}

interface Outcome {
  doc: string;
  /// Ciò che il gesto ha aperto (il riquadro «Collegamento», il primo
  /// commento): il suo testo, o `null`.
  opened: string | null;
  /// Il testo dopo un solo «Annulla».
  undone: string;
}

const SAMPLE = "Il concerto si tiene nella sala grande del teatro.\n";
const PICK = "sala grande";

let mounted: { surface: MarkdownSurface; parent: HTMLElement }[] = [];

function mountNote(mode: "live_preview" | "source"): { surface: MarkdownSurface; view: EditorView } {
  const parent = document.createElement("div");
  document.body.append(parent);
  const surface = mountMarkdownSurface({ paneId: "mini", documentId: "note/mini.md", parent }, {
    onChange: () => {},
    onSelectionChange: () => {},
    onOpenWikilink: () => {},
    onOpenWikilinkBeside: () => {},
    onOpenPath: () => {},
    onShowFile: () => {},
    onSearchTag: () => {},
    completions: { searchNotes: async () => [], listTags: async () => [] },
  });
  mounted.push({ surface, parent });
  surface.buffer.setDoc(SAMPLE);
  surface.setMode(mode);
  const from = SAMPLE.indexOf(PICK);
  const view = EditorView.findFromDOM(parent.querySelector<HTMLElement>(".cm-editor")!)!;
  // happy-dom manda `selectionchange` dentro l'aggiornamento di una vista a
  // fuoco, e CodeMirror rifiuta di rientrare (un browser non lo fa): la vista
  // resta senza fuoco, per i tasti come per la barra.
  (document.activeElement as HTMLElement | null)?.blur();
  surface.focus = () => {};
  view.dispatch({ selection: { anchor: from, head: from + PICK.length } });
  return { surface, view };
}

/// Ciò che si è aperto sopra la nota: un dialogo o un popover.
const openedText = (): string | null => {
  const opened = document.querySelector(".kit-popover, [role='dialog']");
  if (!opened) return null;
  const fields = [...opened.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("input, textarea")].map((field) => field.value);
  return [(opened.textContent ?? "").replace(/\s+/g, " ").trim(), ...fields].join(" | ");
};

async function settle(): Promise<void> {
  for (let i = 0; i < 4; i++) await new Promise((resolve) => setTimeout(resolve, 0));
}

async function outcome(mode: "live_preview" | "source", gesture: (surface: MarkdownSurface, view: EditorView) => void): Promise<Outcome> {
  const { surface, view } = mountNote(mode);
  gesture(surface, view);
  await settle();
  const doc = surface.buffer.getDoc();
  const opened = openedText();
  surface.editorActions.run("text.undo");
  const undone = surface.buffer.getDoc();
  for (const each of mounted) {
    each.surface.destroy();
    each.parent.remove();
  }
  mounted = [];
  closeContextMenu();
  document.body.innerHTML = '<div id="app"></div>';
  return { doc, opened, undone };
}

function clickOn(surface: MarkdownSurface, selector: string, then?: (selector: string) => void): void {
  const bar = createMiniBar({ surface: () => surface, writing: () => true, focusPane: () => {}, runCommand: () => {} });
  bar.update(SPECS);
  document.body.append(bar.element);
  bar.element.querySelector<HTMLButtonElement>(selector)!.click();
  then?.(selector);
}

describe("ogni pulsante fa ciò che fa la sua scorciatoia, su una nota vera", () => {
  let stop: () => void;
  beforeEach(() => {
    document.body.innerHTML = '<div id="app"></div>';
    stop = registerFormatIcons();
  });
  afterEach(() => {
    stop();
    document.body.innerHTML = "";
  });

  const keyed = ["markdown.bold", "markdown.italic", "markdown.underline", "markdown.strikethrough", "markdown.code"];
  for (const action of keyed) {
    it(`${action}: lo stesso testo e lo stesso passo d'annullamento`, async () => {
      const byKeys = await outcome("live_preview", (surface, view) => {
        const chord = surface.editorActions.chord(action)!;
        expect(runScopeHandlers(view, chordEvent(chord), "editor")).toBe(true);
      });
      const byButton = await outcome("live_preview", (surface) => clickOn(surface, `[data-command='${action}']`));
      expect(byButton).toEqual(byKeys);
      expect(byButton.doc).not.toBe(SAMPLE);
      expect(byButton.undone).toBe(SAMPLE);
    });
  }

  it("Collega in Live: Mod-k e il pulsante aprono lo stesso riquadro «Collegamento»", async () => {
    const byKeys = await outcome("live_preview", (_surface, view) => {
      expect(runScopeHandlers(view, chordEvent("Mod-k"), "editor")).toBe(true);
    });
    const byButton = await outcome("live_preview", (surface) => clickOn(surface, `[data-command='${LINK_ACTION}']`));
    expect(byKeys.opened).toContain(PICK);
    expect(byButton).toEqual(byKeys);
  });

  it("Collega in Sorgente: Mod-k e il pulsante fanno lo stesso wikilink", async () => {
    const byKeys = await outcome("source", (_surface, view) => {
      expect(runScopeHandlers(view, chordEvent("Mod-k"), "editor")).toBe(true);
    });
    const byButton = await outcome("source", (surface) => clickOn(surface, `[data-command='${LINK_ACTION}']`));
    expect(byKeys.doc).toContain(`[[${PICK}]]`);
    expect(byButton).toEqual(byKeys);
  });

  it("Commenta: Ctrl Alt M e il pulsante aprono lo stesso primo messaggio sulla selezione", async () => {
    const byKeys = await outcome("live_preview", (surface, view) => {
      expect(runScopeHandlers(view, chordEvent(surface.editorActions.chord(COMMENT_ACTION)!), "editor")).toBe(true);
    });
    const byButton = await outcome("live_preview", (surface) => clickOn(surface, `[data-command='${COMMENT_ACTION}']`));
    expect(byKeys.opened).toContain(PICK);
    expect(byButton).toEqual(byKeys);
  });

  it("Trasforma: «Titolo 2» fa ciò che fa il comando", async () => {
    const byCommand = await outcome("live_preview", (surface) => surface.editorActions.run("markdown.heading.2"));
    const byButton = await outcome("live_preview", (surface) => clickOn(surface, "[data-command='mini-bar.transform']", () => {
      const item = [...document.querySelectorAll<HTMLElement>("#context-menu [role='menuitemradio']")]
        .find((each) => each.querySelector(".menu-label")?.textContent === "Titolo 2")!;
      item.click();
    }));
    expect(byCommand.doc.startsWith("## ")).toBe(true);
    expect(byButton).toEqual(byCommand);
  });

  it("Colore: un campione fa ciò che fa il comando del colore", async () => {
    const byCommand = await outcome("live_preview", (surface) => surface.editorActions.run("markdown.color.red"));
    const byButton = await outcome("live_preview", (surface) => clickOn(surface, "[data-command='mini-bar.color']", () => {
      document.querySelector<HTMLButtonElement>(".mini-bar-colors [data-command='markdown.color.red']")!.click();
    }));
    expect(byCommand.doc).not.toBe(SAMPLE);
    expect(byButton).toEqual(byCommand);
  });
});
