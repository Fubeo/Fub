// @vitest-environment happy-dom
//
// Il menu dell'editor: la superficie dice cosa offre, il compositore lo mette
// nelle sezioni di tutti i menu dell'editor. Qui si guarda la regola — ordine,
// nomi, voci spente e assenti, il tetto del primo livello — senza un editor
// vero: una superficie finta che conosce qualche azione basta.
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CommandSpec } from "../host/contract";
import type { EditorSurface } from "../editors/core/registry";
import type { SurfaceMenu } from "../editors/core/editor-menu";
import type { EditorActionState } from "../editors/core/editor-actions";
import type { CommandEntry } from "../ui/commands";
import { closeContextMenu, type MenuItem } from "../ui/menu";
import { composeEditorMenu, fromKeyboard, MAX_TOP, openEditorMenu, type EditorMenuHost } from "./editor-menu";

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

function surfaceWith(known: Record<string, EditorActionState>, menu: SurfaceMenu | null = null): EditorSurface {
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

describe("il compositore del menu dell'editor", () => {
  it("mette le sezioni nell'ordine di sempre, ognuna col suo gruppo", () => {
    const surface = surfaceWith({ "markdown.bold": { enabled: true, active: false } });
    const host = hostFor(surface, [spec("markdown.bold", "Grassetto"), spec("note.daily", "Nota del giorno", ["slash"])], [
      { id: "shell.doc.search", title: "Cerca nella nota", description: "", layer: "document", binding: "Mod-f", declared: null, spec: null, run: null },
    ]);
    const items = composeEditorMenu({
      target: { kind: "text" },
      context: [{ id: "x.here", label: "Qui sotto", run: () => {} }],
      clipboard: { offers: { copy: true, cut: false, "select-all": true }, run: () => {} },
      format: ["markdown.bold"],
      commands: true,
    }, host);
    expect(labels(items)).toEqual([
      "Qui sotto",
      "Taglia",
      "Copia",
      "Formato",
      "Comandi",
      "Cerca nella nota",
      "Seleziona tutto",
    ]);
    expect(items.find((item) => item.label === "Taglia")?.disabled).toBe(true);
    expect(new Set(items.map((item) => item.group)).size).toBe(5);
  });

  it("un'azione prende nome dal comando che la dichiara, icona, stato e accordo; senza comando non c'è", () => {
    const surface = surfaceWith({
      "markdown.bold": { enabled: true, active: true },
      "markdown.italic": { enabled: false, active: false },
      "markdown.code": { enabled: true, active: null },
    });
    const host = hostFor(surface, [spec("markdown.bold", "Grassetto"), spec("markdown.italic", "Corsivo")]);
    const [format] = composeEditorMenu({ target: { kind: "text" }, format: ["markdown.bold", "markdown.italic", "markdown.code"] }, host);
    const items = format!.items as MenuItem[];
    expect(labels(items)).toEqual(["Grassetto", "Corsivo"]);
    expect(items[0]).toMatchObject({ icon: "fmt-bold", choice: "checkbox", checked: true, disabled: false });
    expect(items[0]!.hint).toBeTruthy();
    expect(items[1]!.disabled).toBe(true);
    items[0]!.run!();
    expect(surface.editorActions!.run).toHaveBeenCalledWith("markdown.bold");
  });

  it("un sottomenu senza voci risolte sparisce, e «Comandi» esegue per la via del «/»", () => {
    const surface = surfaceWith({});
    const host = hostFor(surface, [spec("note.daily", "Nota del giorno", ["slash"])]);
    const items = composeEditorMenu({ target: { kind: "text" }, insert: ["markdown.table"], commands: true }, host);
    expect(labels(items)).toEqual(["Comandi"]);
    (items[0]!.items as MenuItem[])[0]!.run!();
    expect(host.runSlash).toHaveBeenCalledWith("note.daily");
  });

  it("oltre il tetto le utilità scendono in «Altro»", () => {
    const surface = surfaceWith({});
    const context = Array.from({ length: 10 }, (_, i) => ({ id: `c${i}`, label: `Voce ${i}`, run: () => {} }));
    const items = composeEditorMenu({
      target: { kind: "text" },
      context,
      clipboard: { offers: { cut: true, copy: true, paste: true, "select-all": true }, run: () => {} },
    }, hostFor(surface, []));
    expect(items.length).toBeLessThanOrEqual(MAX_TOP);
    const more = items[items.length - 1]!;
    expect(more.label).toBe("Altro");
    expect(labels(more.items as MenuItem[])).toContain("Seleziona tutto");
    expect(labels(more.items as MenuItem[])).toContain("Voce 9");
  });

  it("una voce con un comando lo esegue dopo il suo gesto", () => {
    const order: string[] = [];
    const host = hostFor(surfaceWith({}), []);
    vi.mocked(host.runCommand).mockImplementation((id) => void order.push(id));
    const [item] = composeEditorMenu({
      target: { kind: "page" },
      context: [{ id: "here", label: "Modifica da qui", run: () => void order.push("cursore"), command: "shell.mode.reading" }],
    }, host);
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
    const surface = surfaceWith({}, { target: { kind: "text" }, clipboard: { offers: { "select-all": true }, run: () => {} } });
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
