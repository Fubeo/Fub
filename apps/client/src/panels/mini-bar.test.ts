// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CommandSpec } from "../host/contract";
import type { EditorSurface } from "../editors/core/registry";
import type { SurfaceEditorActions } from "../editors/core/editor-actions";
import { registerFormatIcons } from "./format-bar";
import { bubbleWanted, miniBarModeOf, mountMiniBar, type MiniBarMode } from "./mini-bar";
import { closeContextMenu, showContextMenu } from "../ui/menu";

function spec(id: string, title: string): CommandSpec {
  return {
    id, title, description: "", keybinding: null, params: [],
    scope: { writes: false, reach: "session", reversible: true }, surfaces: ["toolbar"],
  };
}

const SPECS = [
  spec("text.undo", "Annulla"),
  spec("markdown.heading.1", "Titolo 1"),
  spec("markdown.bold", "Grassetto"),
  spec("markdown.link", "Link"),
  spec("markdown.list.bullet", "Elenco puntato"),
];

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

describe("la mini-barra del menu", () => {
  let stop: () => void;
  const runs: string[] = [];
  const actions: SurfaceEditorActions = {
    has: (id) => SPECS.some((each) => each.id === id),
    editable: () => true,
    state: () => ({ enabled: true, active: false }),
    run: (id) => (runs.push(id), true),
    chord: () => null,
    subscribe: () => () => {},
  };
  const surface = { family: "text", profile: "markdown", surfaceId: "p", modes: [], setMode: () => {}, editorActions: actions, destroy: () => {} } as EditorSurface;
  const barHost = { surface: () => surface, writing: () => true, focusPane: vi.fn(), runCommand: () => {} };

  beforeEach(() => {
    document.body.innerHTML = '<div id="app"></div>';
    stop = registerFormatIcons();
    runs.length = 0;
  });
  afterEach(() => {
    closeContextMenu();
    stop();
    document.body.innerHTML = "";
  });

  it("porta lo stile della riga, il carattere e i link, non la cronologia né le liste", () => {
    const mount = mountMiniBar(barHost, SPECS, null)!;
    const host = document.createElement("div");
    const unmount = mount(host);
    const commands = [...host.querySelectorAll<HTMLElement>("[data-command]")].map((el) => el.dataset["command"]);
    expect(commands).toContain("markdown.bold");
    expect(commands).toContain("markdown.link");
    expect(commands).not.toContain("text.undo");
    expect(commands).not.toContain("markdown.list.bullet");
    unmount();
    expect(host.childElementCount).toBe(0);
  });

  it("un gesto dalla barra esegue l'azione e chiude il menu", async () => {
    const strip = mountMiniBar(barHost, SPECS, null)!;
    showContextMenu({ x: 10, y: 10 }, [{ label: "Copia", run: () => {} }], { strip });
    const bold = document.querySelector<HTMLButtonElement>('.context-strip [data-command="markdown.bold"]');
    expect(bold).not.toBeNull();
    bold!.click();
    expect(runs).toEqual(["markdown.bold"]);
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
