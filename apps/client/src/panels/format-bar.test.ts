// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { CommandSpec } from "../host/contract";
import type { EditorSurface } from "../editors/core/registry";
import {
  ACTION_UNAVAILABLE,
  type EditorActionState,
  type SurfaceEditorActions,
} from "../editors/core/editor-actions";
import { MARKDOWN_ACTIONS } from "../editors/text/profiles/markdown/actions";
import { icon } from "../ui/icons";
import { closeContextMenu } from "../ui/menu";
import { ACTION_LOOKS, createFormatBar, registerFormatIcons, toolbarGroups, type FormatBar } from "./format-bar";

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

/// Una superficie che conosce un sottoinsieme delle azioni e ne tiene lo
/// stato in una tabella: la barra non deve sapere altro.
function fakeActions(known: readonly string[]) {
  const states = new Map<string, EditorActionState>();
  const listeners = new Set<() => void>();
  const runs: string[] = [];
  let editable = true;
  const actions: SurfaceEditorActions = {
    has: (id) => known.includes(id),
    editable: () => editable,
    state: (id) => (known.includes(id) ? states.get(id) ?? { enabled: true, active: false } : ACTION_UNAVAILABLE),
    run: (id) => {
      runs.push(id);
      return true;
    },
    chord: (id) => (id === "markdown.bold" ? "Mod-b" : null),
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  return {
    actions,
    runs,
    listeners,
    set(id: string, state: EditorActionState) {
      states.set(id, state);
      for (const listener of listeners) listener();
    },
    setEditable(value: boolean) {
      editable = value;
    },
  };
}

function surfaceWith(actions: SurfaceEditorActions | undefined): EditorSurface {
  return {
    family: "text",
    profile: "markdown",
    surfaceId: "p1",
    modes: [],
    setMode: () => {},
    editorActions: actions,
    destroy: () => {},
  };
}

const SPECS = [
  spec("text.undo", "Annulla"),
  spec("markdown.paragraph", "Testo normale"),
  spec("markdown.heading.1", "Titolo 1"),
  spec("markdown.heading.2", "Titolo 2"),
  spec("markdown.bold", "Grassetto"),
  spec("markdown.italic", "Corsivo"),
  spec("markdown.table", "Inserisci tabella"),
  spec("markdown.table.row.after", "Riga sotto"),
  spec("fuori.dalla.barra", "Palette soltanto", []),
];

let retireIcons: () => void;
let bars: FormatBar[] = [];

beforeEach(() => {
  retireIcons = registerFormatIcons();
});

afterEach(() => {
  closeContextMenu();
  for (const bar of bars) bar.destroy();
  bars = [];
  retireIcons();
});

function mount(surface: EditorSurface | null, commands: string[] = []) {
  let writing = true;
  const bar = createFormatBar({
    surface: () => surface,
    writing: () => writing,
    focusPane: () => {},
    runCommand: (id) => commands.push(id),
  });
  document.body.append(bar.element);
  bars.push(bar);
  return {
    bar,
    setWriting(value: boolean) {
      writing = value;
    },
  };
}

function buttons(bar: FormatBar): HTMLButtonElement[] {
  return [...bar.element.querySelectorAll<HTMLButtonElement>("button")];
}

describe("i gruppi della barra", () => {
  it("seguono l'ordine del plugin e saltano ciò che la superficie non sa fare", () => {
    const { actions } = fakeActions(["markdown.bold", "markdown.italic", "markdown.heading.1", "markdown.paragraph"]);
    const groups = toolbarGroups(SPECS, actions);
    expect(groups.map((group) => group.id)).toEqual(["block", "inline"]);
    expect(groups[0]!.menu.map((entry) => entry.spec.id)).toEqual(["markdown.paragraph", "markdown.heading.1"]);
    expect(groups[1]!.inline.map((entry) => entry.spec.id)).toEqual(["markdown.bold", "markdown.italic"]);
  });

  it("un comando qualunque offerto nella barra è un pulsante col suo titolo", () => {
    const groups = toolbarGroups([spec("acme:data", "Inserisci data")], undefined);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.id).toBe("other");
    expect(groups[0]!.inline[0]!.action).toBeNull();
  });

  it("ogni azione disegnata è un'azione del profilo, e ogni azione del profilo ha una resa", () => {
    const drawn = Object.keys(ACTION_LOOKS).filter((id) => !id.startsWith("text."));
    expect(drawn.sort()).toEqual([...MARKDOWN_ACTIONS.keys()].sort());
    for (const [id, look] of Object.entries(ACTION_LOOKS)) {
      if (look.menu) continue;
      expect(icon(look.icon), `${id}: ${look.icon}`).not.toBe("");
    }
  });
});

describe("la barra di un riquadro", () => {
  it("è nascosta senza pulsanti, e compare coi comandi di un plugin", () => {
    const fake = fakeActions(["markdown.bold"]);
    const { bar } = mount(surfaceWith(fake.actions));
    bar.update([]);
    expect(bar.element.hidden).toBe(true);
    bar.update(SPECS);
    expect(bar.element.hidden).toBe(false);
    expect(bar.element.getAttribute("role")).toBe("toolbar");
    const bold = bar.element.querySelector<HTMLButtonElement>('[data-command="markdown.bold"]')!;
    expect(bold.getAttribute("aria-label")).toBe("Grassetto");
    expect(bold.getAttribute("aria-keyshortcuts")).toMatch(/^(Control|Meta)\+B$/);
  });

  it("in una resa da leggere, o senza superficie, non c'è", () => {
    const fake = fakeActions(["markdown.bold"]);
    const view = mount(surfaceWith(fake.actions));
    view.setWriting(false);
    view.bar.update(SPECS);
    expect(view.bar.element.hidden).toBe(true);
    const empty = mount(null);
    empty.bar.update(SPECS);
    expect(empty.bar.element.hidden).toBe(true);
  });

  it("dice premuto e spento come la superficie, e si aggiorna quando lei cambia", async () => {
    const fake = fakeActions(["markdown.bold", "markdown.italic"]);
    const { bar } = mount(surfaceWith(fake.actions));
    bar.update(SPECS);
    const bold = bar.element.querySelector<HTMLButtonElement>('[data-command="markdown.bold"]')!;
    expect(bold.getAttribute("aria-pressed")).toBe("false");
    fake.set("markdown.bold", { enabled: true, active: true });
    fake.set("markdown.italic", { enabled: false, active: false });
    await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
    expect(bold.getAttribute("aria-pressed")).toBe("true");
    const italic = bar.element.querySelector<HTMLButtonElement>('[data-command="markdown.italic"]')!;
    expect(italic.disabled).toBe(true);
    // Chi non commuta niente non dichiara un «premuto».
    fake.set("markdown.bold", { enabled: true, active: null });
    await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
    expect(bold.hasAttribute("aria-pressed")).toBe(false);
  });

  it("un clic esegue l'azione nella superficie, senza passare dal kernel", () => {
    const fake = fakeActions(["markdown.bold"]);
    const commands: string[] = [];
    const { bar } = mount(surfaceWith(fake.actions), commands);
    bar.update([...SPECS, spec("acme:data", "Inserisci data")]);
    bar.element.querySelector<HTMLButtonElement>('[data-command="markdown.bold"]')!.click();
    expect(fake.runs).toEqual(["markdown.bold"]);
    expect(commands).toEqual([]);
    bar.element.querySelector<HTMLButtonElement>('[data-command="acme:data"]')!.click();
    expect(commands).toEqual(["acme:data"]);
  });

  it("il puntatore non toglie il fuoco al testo", () => {
    const fake = fakeActions(["markdown.bold"]);
    const { bar } = mount(surfaceWith(fake.actions));
    bar.update(SPECS);
    const bold = bar.element.querySelector<HTMLButtonElement>('[data-command="markdown.bold"]')!;
    const down = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
    bold.dispatchEvent(down);
    expect(down.defaultPrevented).toBe(true);
  });

  it("ha un solo punto di tabulazione, e le frecce vi si muovono dentro", () => {
    const fake = fakeActions(["markdown.bold", "markdown.italic"]);
    const { bar } = mount(surfaceWith(fake.actions));
    bar.update(SPECS);
    const controls = buttons(bar).filter((button) => !button.hidden && !button.closest("[hidden]"));
    expect(controls.filter((button) => button.tabIndex === 0)).toHaveLength(1);
    const [bold, italic] = controls;
    bold!.focus();
    bold!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    expect(document.activeElement).toBe(italic);
    expect(italic!.tabIndex).toBe(0);
    expect(bold!.tabIndex).toBe(-1);
    italic!.dispatchEvent(new KeyboardEvent("keydown", { key: "Home", bubbles: true }));
    expect(document.activeElement).toBe(bold);
  });

  it("lo stile del paragrafo dice lo stile corrente e apre il menu dei titoli", () => {
    const fake = fakeActions(["markdown.paragraph", "markdown.heading.1", "markdown.heading.2"]);
    fake.set("markdown.heading.2", { enabled: true, active: true });
    const { bar } = mount(surfaceWith(fake.actions));
    bar.update(SPECS);
    const style = bar.element.querySelector<HTMLButtonElement>(".format-bar-style")!;
    expect(style.textContent).toContain("Titolo 2");
    expect(style.getAttribute("aria-haspopup")).toBe("menu");
    style.click();
    const items = [...document.querySelectorAll<HTMLButtonElement>("#context-menu [role=menuitem]")];
    expect(items.map((item) => item.textContent)).toEqual(["Testo normale", "Titolo 1", "Titolo 2"]);
    expect(style.getAttribute("aria-expanded")).toBe("true");
    items[1]!.click();
    expect(fake.runs).toEqual(["markdown.heading.1"]);
    expect(style.getAttribute("aria-expanded")).toBe("false");
  });

  it("smontata, non segue più la superficie", () => {
    const fake = fakeActions(["markdown.bold"]);
    const { bar } = mount(surfaceWith(fake.actions));
    bar.update(SPECS);
    expect(fake.listeners.size).toBe(1);
    bar.destroy();
    bars = bars.filter((candidate) => candidate !== bar);
    expect(fake.listeners.size).toBe(0);
    expect(bar.element.isConnected).toBe(false);
  });
});
