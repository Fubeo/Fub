// @vitest-environment happy-dom
// Chi scrive cambia luce col mouse e continua a scrivere: il clic sul bottone
// della luce non porta via il fuoco all'editor, e le battute che seguono
// entrano nella nota (IMP-6401). Con la tastiera il fuoco arriva al bottone e
// ci resta.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EditorView } from "@codemirror/view";
import { press, realClick } from "../../../kit/testing";
import type { CommandEntry } from "../../../ui/commands";
import { openLifetime, type Lifetime } from "../../../ui/lifetime";

const LIGHT_COMMAND = "shell.light.toggle";

const world = vi.hoisted(() => ({ started: [] as string[] }));

vi.mock("../../../ui/commands", async (original) => ({
  ...(await original<typeof import("../../../ui/commands")>()),
  allCommands: (): CommandEntry[] => [
    { id: "shell.light.toggle", title: "Luce", description: "", layer: "global", binding: null, declared: null, spec: null, run: () => {} },
  ],
}));
// Il comando cambia la luce montata, come fa quello vero a scena finita: il
// bottone si ridisegna mentre il fuoco è altrove.
vi.mock("../../../ui/palette", () => ({
  startCommand: (entry: { id: string }) => {
    world.started.push(entry.id);
    const root = document.documentElement;
    root.dataset.theme = root.dataset.theme === "light" ? "dark" : "light";
  },
}));
vi.mock("../../../state/palette-host", () => ({ paletteHost: {} }));
vi.mock("../../../host/ipc", () => ({ api: { setSetting: () => Promise.resolve() } }));

import { mountLightSwitch } from "./light";

let lifetime: Lifetime;
let view: EditorView;

/// Scrive come la tastiera su ciò che ha il fuoco: il tasto arriva
/// all'elemento attivo e, se nessuno lo consuma, il browser ne mette il testo
/// nell'editor che ha il fuoco. Un tasto che arriva a un bottone non scrive
/// niente da nessuna parte.
function type(text: string): void {
  for (const ch of text) {
    const target = document.activeElement ?? document.body;
    const event = press(target, ch);
    if (event.defaultPrevented || !(target instanceof HTMLElement)) continue;
    const editor = EditorView.findFromDOM(target);
    if (editor && editor.hasFocus) editor.dispatch(editor.state.replaceSelection(ch), { userEvent: "input.type" });
  }
}

const settled = async (): Promise<void> => {
  for (let turn = 0; turn < 10; turn++) await Promise.resolve();
};

beforeEach(() => {
  world.started.length = 0;
  document.documentElement.dataset.theme = "dark";
  document.body.innerHTML = '<div id="nota"></div><button id="toggle-light" type="button" class="rail-btn" aria-label="Cambia luce"></button>';
  view = new EditorView({ doc: "Pratica A\n", parent: document.getElementById("nota")! });
  view.focus();
  view.dispatch({ selection: { anchor: view.state.doc.length } });
  lifetime = openLifetime();
  mountLightSwitch(lifetime);
});

afterEach(() => {
  lifetime.close();
  view.destroy();
  document.body.replaceChildren();
  delete document.documentElement.dataset.theme;
});

const button = (): HTMLButtonElement => document.getElementById("toggle-light") as HTMLButtonElement;

describe("il bottone della luce e chi scrive (IMP-6401)", () => {
  it("il clic col mouse cambia la luce e le battute dopo entrano nella nota", async () => {
    type("a1");
    realClick(button());
    await settled();
    expect(world.started).toEqual([LIGHT_COMMAND]);
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(view.hasFocus, "il fuoco è rimasto all'editor").toBe(true);
    type("a2");

    realClick(button());
    await settled();
    expect(document.documentElement.dataset.theme).toBe("dark");
    type("b1");
    expect(view.state.doc.toString()).toBe("Pratica A\na1a2b1");
  });

  it("con la tastiera il fuoco arriva al bottone e ci resta, col suo nome", async () => {
    button().focus();
    expect(document.activeElement).toBe(button());
    expect(button().tabIndex).toBe(0);
    button().click();
    await settled();
    expect(world.started).toEqual([LIGHT_COMMAND]);
    expect(document.activeElement).toBe(button());
    expect(button().getAttribute("aria-label")).toBe("Passa alla luce notte");
  });

  it("smontato, il clic torna quello del browser: il bottone prende il fuoco", () => {
    lifetime.close();
    realClick(button());
    expect(document.activeElement).toBe(button());
    expect(world.started).toEqual([]);
  });
});
