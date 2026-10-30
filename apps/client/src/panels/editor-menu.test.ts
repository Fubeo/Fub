// @vitest-environment happy-dom
//
// Il menu dell'editor: la superficie dice cosa offre, il compositore lo mette
// nelle parti di tutti i menu dell'editor. Qui si guarda la regola — ordine,
// gruppi, nomi, voci spente e assenti, ciò che si trova scrivendo — senza un editor
// vero: una superficie finta che conosce qualche azione basta.
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CommandSpec } from "../host/contract";
import type { EditorSurface } from "../editors/core/registry";
import { MENU_RULE, type SurfaceMenu } from "../editors/core/editor-menu";
import type { EditorActionState } from "../editors/core/editor-actions";
import type { CommandEntry } from "../ui/commands";
import { closeContextMenu, type MenuItem } from "../ui/menu";
import { composeEditorMenu, fromKeyboard, openEditorMenu, type EditorMenuHost } from "./editor-menu";

// Le voci dei plugin passano dall'host vero: qui nessuna view ne offre.
vi.mock("../ui/context-views", () => ({ contextMenuItems: async () => [], hasContextMenuViews: () => false }));
// «Comandi ▸» filtra le specifiche dichiarate per il «/», senza vault.
vi.mock("../state/slash", () => ({
  slashCandidates: (specs: readonly CommandSpec[]) => specs.filter((spec) => spec.surfaces.includes("slash")),
}));

function spec(id: string, title = id, surfaces: CommandSpec["surfaces"] = ["toolbar"]): CommandSpec {
  return {
    id,
    title,
    description: "",
    keybinding: null,
    params: [],
    scope: { writes: false, reach: "session", reversible: true },
    surfaces,
  };
}

function surfaceWith(known: Record<string, EditorActionState>, menu: SurfaceMenu | null = null, find = true): EditorSurface {
  const run = vi.fn(() => true);
  return {
    family: "text",
    profile: "markdown",
    surfaceId: "p",
    modes: [],
    setMode: () => {},
    destroy: () => {},
    anchorHere: () => null,
    editorActions: {
      has: (id) => id in known,
      editable: () => true,
      state: (id) => known[id] ?? { enabled: false, active: null },
      run,
      chord: (id) => (id === "markdown.bold" ? "Mod-b" : null),
      subscribe: () => () => {},
    },
    contextMenu: () => menu,
    ...(find ? { find: () => true } : {}),
  };
}

function hostFor(surface: EditorSurface, specs: CommandSpec[], commands: CommandEntry[] = []): EditorMenuHost {
  return {
    surface: () => surface,
    specs: () => specs,
    commands: () => commands,
    selection: () => "",
    runSlash: vi.fn(),
    runCommand: vi.fn(),
    focusPane: vi.fn(),
  };
}

const labels = (items: readonly MenuItem[]): string[] => items.map((item) => item.label);

const search: CommandEntry = { id: "shell.doc.search", title: "Cerca nel documento", description: "", layer: "document", binding: "Mod-f", declared: null, spec: null, run: null };

/// I gruppi del primo livello, come li vede chi guarda: i nomi delle voci,
/// spezzati dove una voce apre un gruppo.
function groupsOf(items: readonly MenuItem[]): string[][] {
  const groups: string[][] = [];
  for (const item of items) {
    if (item.separator || groups.length === 0) groups.push([]);
    groups[groups.length - 1]!.push(item.label);
  }
  return groups;
}

describe("il compositore del menu dell'editor", () => {
  it("mette testata, appunti, voci del posto nei loro gruppi; il resto si trova scrivendo", () => {
    const surface = surfaceWith({ "markdown.bold": { enabled: true, active: false } });
    const host = hostFor(surface, [spec("markdown.bold", "Grassetto"), spec("note.daily", "Nota del giorno", ["slash"])], [search]);
    const menu = composeEditorMenu({
      target: { kind: "heading", label: "Titolo 2", name: "Formula" },
      context: [{ id: "x.here", label: "Qui sotto", run: () => {} }, MENU_RULE, { id: "x.there", label: "Là", run: () => {} }],
      clipboard: { offers: { copy: true, cut: true, paste: true, "paste-plain": true, "select-all": true }, run: () => {} },
      format: ["markdown.bold"],
      miniBar: true,
      commands: true,
    }, host);
    expect(menu.header).toEqual({ icon: "fmt-h2", kind: "Titolo 2", name: "Formula" });
    expect(labels(menu.clipboard)).toEqual(["Taglia", "Copia", "Incolla"]);
    expect(groupsOf(menu.items)).toEqual([["Qui sotto"], ["Là"]]);
    expect(labels(menu.searchable)).toEqual(["Incolla senza formattazione", "Grassetto", "Nota del giorno", "Cerca nel documento", "Seleziona tutto"]);
  });

  it("un gesto degli appunti che non si può fare non c'è; uno solo è una voce, coi suoi compagni, prima o dopo", () => {
    const host = hostFor(surfaceWith({}), []);
    const first = composeEditorMenu({
      target: { kind: "text" },
      context: [{ id: "x", label: "Inserisci un blocco…", run: () => {} }],
      clipboard: { offers: { cut: false, copy: false, paste: true, "paste-plain": true }, run: () => {} },
    }, host);
    expect(first.clipboard).toEqual([]);
    expect(groupsOf(first.items)).toEqual([["Incolla", "Incolla senza formattazione"], ["Inserisci un blocco…"]]);
    expect(first.header?.kind).toBe("Paragrafo");
  });

  it("ciò che cancella va in fondo, da solo, qualunque posto la superficie gli dia", () => {
    const menu = composeEditorMenu({
      target: { kind: "properties" },
      context: [
        { id: "a", label: "Aggiungi una proprietà", run: () => {} },
        { id: "z", label: "Svuota le proprietà", danger: true, run: () => {} },
        { id: "c", label: "Copia le proprietà", run: () => {} },
      ],
    }, hostFor(surfaceWith({}), []));
    expect(groupsOf(menu.items)).toEqual([["Aggiungi una proprietà", "Copia le proprietà"], ["Svuota le proprietà"]]);
  });

  it("«Cerca nel documento» si trova solo dove la superficie ha la sua ricerca", () => {
    const menu: SurfaceMenu = { target: { kind: "media" } };
    expect(labels(composeEditorMenu(menu, hostFor(surfaceWith({}, null, true), [], [search])).searchable)).toEqual(["Cerca nel documento"]);
    expect(composeEditorMenu(menu, hostFor(surfaceWith({}, null, false), [], [search])).searchable, "un PDF, un'immagine, un foglio, una lavagna").toEqual([]);
  });

  it("un'azione prende nome dal comando che la dichiara, icona, stato e accordo; spenta o senza comando non c'è", () => {
    const surface = surfaceWith({
      "markdown.bold": { enabled: true, active: true },
      "markdown.italic": { enabled: false, active: false },
      "markdown.underline": { enabled: true, active: false },
    });
    const host = hostFor(surface, [spec("markdown.bold", "Grassetto"), spec("markdown.italic", "Corsivo")]);
    const [format] = composeEditorMenu({ target: { kind: "text" }, format: ["markdown.bold", "markdown.italic", "markdown.underline"] }, host).items;
    const items = format!.items as MenuItem[];
    expect(format!.label, "senza mini-barra il formato è un sottomenu").toBe("Formato");
    expect(labels(items)).toEqual(["Grassetto"]);
    expect(items[0]).toMatchObject({ icon: "fmt-bold", choice: "checkbox", checked: true });
    expect(items[0]!.hint).toBeTruthy();
    items[0]!.run!();
    expect(surface.editorActions!.run).toHaveBeenCalledWith("markdown.bold");
  });

  it("una voce con un'azione ha il suo nome e lo stato dell'azione; una voce grigia senza motivo non c'è", () => {
    const surface = surfaceWith({ "markdown.heading.2": { enabled: true, active: true }, "markdown.heading.3": { enabled: true, active: false } });
    const host = hostFor(surface, []);
    const { items } = composeEditorMenu({
      target: { kind: "heading" },
      context: [
        { id: "level", label: "Livello", items: [
          { id: "h2", label: "Titolo 2", action: "markdown.heading.2", radio: true },
          { id: "h3", label: "Titolo 3", action: "markdown.heading.3", radio: true },
          { id: "h9", label: "Titolo 9", action: "markdown.heading.9", radio: true },
        ] },
        { id: "grey", label: "Grigia", enabled: false, run: () => {} },
        { id: "why", label: "Grigia con motivo", enabled: false, description: "Serve una selezione", run: () => {} },
      ],
    }, host);
    expect(labels(items)).toEqual(["Livello", "Grigia con motivo"]);
    const level = items[0]!.items as MenuItem[];
    expect(level.map((item) => [item.label, item.choice, item.checked])).toEqual([["Titolo 2", "radio", true], ["Titolo 3", "radio", false]]);
    level[1]!.run!();
    expect(surface.editorActions!.run).toHaveBeenCalledWith("markdown.heading.3");
  });

  it("un sottomenu senza voci risolte sparisce, e i comandi del vault si eseguono per la via del «/»", () => {
    const surface = surfaceWith({});
    const host = hostFor(surface, [spec("note.daily", "Nota del giorno", ["slash"]), spec("note.extract", "Estrai")]);
    const menu = composeEditorMenu({
      target: { kind: "text" },
      insert: ["markdown.table"],
      commands: true,
      context: [{ id: "x", label: "Estrai la sezione", slash: "note.extract", run: () => {} }, { id: "y", label: "Manca", slash: "note.nope" }],
    }, host);
    expect(labels(menu.items)).toEqual(["Estrai la sezione"]);
    menu.items[0]!.run!();
    expect(host.runSlash).toHaveBeenCalledWith("note.extract");
    menu.searchable[0]!.run!();
    expect(host.runSlash).toHaveBeenCalledWith("note.daily");
  });

  it("nessun tetto taglia il menu: niente più «Altro»", () => {
    const context = Array.from({ length: 10 }, (_, i) => ({ id: `c${i}`, label: `Voce ${i}`, run: () => {} }));
    const { items } = composeEditorMenu({ target: { kind: "text" }, context }, hostFor(surfaceWith({}), []));
    expect(items).toHaveLength(10);
    expect(labels(items)).not.toContain("Altro");
  });

  it("una voce con un comando lo esegue dopo il suo gesto", () => {
    const order: string[] = [];
    const host = hostFor(surfaceWith({}), []);
    vi.mocked(host.runCommand).mockImplementation((id) => void order.push(id));
    const [item] = composeEditorMenu({
      target: { kind: "page" },
      context: [{ id: "here", label: "Modifica qui", run: () => void order.push("cursore"), command: "shell.mode.reading" }],
    }, host).items;
    item!.run!();
    expect(order).toEqual(["cursore", "shell.mode.reading"]);
  });
});

describe("l'apertura dal riquadro", () => {
  afterEach(() => closeContextMenu());

  it("senza un menu della superficie lascia quello del sistema", () => {
    const event = new MouseEvent("contextmenu", { button: 2, clientX: 5, clientY: 5, cancelable: true });
    const pane = document.createElement("div");
    expect(openEditorMenu(event, pane, hostFor(surfaceWith({}, null), []))).toBe(false);
    expect(event.defaultPrevented).toBe(false);
  });

  it("con un menu lo apre e ferma quello del sistema; dalla tastiera la superficie riceve null", () => {
    const pane = document.createElement("div");
    document.body.append(pane);
    const surface = surfaceWith({}, { target: { kind: "text" }, clipboard: { offers: { paste: true, "select-all": true }, run: () => {} } });
    const asked = vi.spyOn(surface, "contextMenu");
    const mouse = new MouseEvent("contextmenu", { button: 2, clientX: 40, clientY: 50, cancelable: true });
    expect(openEditorMenu(mouse, pane, hostFor(surface, []))).toBe(true);
    expect(mouse.defaultPrevented).toBe(true);
    expect(asked).toHaveBeenLastCalledWith({ x: 40, y: 50 });
    expect(document.getElementById("context-menu")).not.toBeNull();

    const key = new MouseEvent("contextmenu", { button: 0, cancelable: true });
    expect(fromKeyboard(key)).toBe(true);
    openEditorMenu(key, pane, hostFor(surface, []));
    expect(asked).toHaveBeenLastCalledWith(null);
  });
});
