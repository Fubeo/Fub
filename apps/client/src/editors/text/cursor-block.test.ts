// @vitest-environment happy-dom
import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it, vi } from "vitest";
import { settings } from "../../host/query";
import { setConcentrating } from "../../state/concentration";
import { cursorBlock, cursorBlockLines, refreshCursorBlock } from "./cursor-block";
import { createTextEngine, EDITOR_VIM_KEY } from "./engine";
import type { SettingEntry } from "../../host/contract";
import { getCM } from "@replit/codemirror-vim";

vi.mock("../../host/query", () => ({ settings: vi.fn(() => Promise.resolve([])) }));

const DOC = [
  "# Titolo",
  "",
  "Un paragrafo che va",
  "a capo a mano.",
  "",
  "- uno",
  "- due",
  "",
  "Ultima riga.",
].join("\n");

function mount(head: number, anchor = head): EditorView {
  const host = document.createElement("div");
  document.body.append(host);
  return new EditorView({
    parent: host,
    state: EditorState.create({ doc: DOC, selection: EditorSelection.single(anchor, head), extensions: cursorBlock }),
  });
}

function litLines(view: EditorView): string[] {
  return [...view.contentDOM.querySelectorAll(".cm-line.cm-fub-cursor-block")].map((line) => line.textContent ?? "");
}

afterEach(() => {
  setConcentrating(false);
  document.body.replaceChildren();
});

describe("il blocco del cursore", () => {
  it("fuori dalla concentrazione non segna niente", () => {
    const view = mount(DOC.indexOf("a capo"));
    expect(litLines(view)).toEqual([]);
    view.destroy();
  });

  it("in concentrazione accende il paragrafo intero, anche andato a capo a mano", () => {
    setConcentrating(true);
    const view = mount(DOC.indexOf("a capo"));
    expect(litLines(view)).toEqual(["Un paragrafo che va", "a capo a mano."]);
    view.dispatch({ selection: { anchor: DOC.indexOf("due") } });
    expect(litLines(view)).toEqual(["- uno", "- due"]);
    view.destroy();
  });

  it("una scelta accende tutti i blocchi che attraversa, e la riga vuota resta sola", () => {
    setConcentrating(true);
    const view = mount(DOC.indexOf("uno"), DOC.indexOf("paragrafo"));
    expect(litLines(view)).toEqual(["Un paragrafo che va", "a capo a mano.", "", "- uno", "- due"]);
    view.dispatch({ selection: { anchor: DOC.indexOf("\n\n- uno") + 1 } });
    expect(cursorBlockLines(view)).toEqual({ first: 5, last: 5 });
    view.destroy();
  });

  it("entrare e uscire ridisegna la vista quando lo si dice", () => {
    const view = mount(0);
    setConcentrating(true);
    view.dispatch({ effects: refreshCursorBlock.of(null) });
    expect(litLines(view)).toEqual(["# Titolo"]);
    setConcentrating(false);
    view.dispatch({ effects: refreshCursorBlock.of(null) });
    expect(litLines(view)).toEqual([]);
    view.destroy();
  });

  it("il motore lo dice da sé a ogni editor, e smette quando l'editor si chiude", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const engine = createTextEngine(host, { onChange: () => {}, onSelectionChange: () => {} });
    engine.setDoc(DOC);
    await vi.waitFor(() => expect(settings).toHaveBeenCalled());
    const view = EditorView.findFromDOM(host)!;
    setConcentrating(true);
    expect(litLines(view)).toEqual(["# Titolo"]);
    setConcentrating(false);
    expect(litLines(view)).toEqual([]);
    engine.destroy();
    // Una vista chiusa non riceve più niente: niente eccezioni a vista smontata.
    expect(() => setConcentrating(true)).not.toThrow();
  });

  it("con Vim, Esc in concentrazione resta di Vim: la shell lo vede già preso", async () => {
    const entry: SettingEntry = {
      spec: {
        key: EDITOR_VIM_KEY, label: EDITOR_VIM_KEY, description: "", group: "Editor", scope: "machine",
        kind: { kind: "toggle", default: false }, program_writable: false,
      },
      value: true,
      source: "machine",
    };
    vi.mocked(settings).mockResolvedValue([entry]);
    const host = document.createElement("div");
    document.body.append(host);
    const engine = createTextEngine(host, { onChange: () => {}, onSelectionChange: () => {} });
    engine.setDoc(DOC);
    const view = EditorView.findFromDOM(host)!;
    await vi.waitFor(() => expect(getCM(view)).not.toBeNull());
    setConcentrating(true);
    view.focus();
    const key = (k: string) => {
      const event = new KeyboardEvent("keydown", {
        key: k, code: k === "Escape" ? "Escape" : "KeyI", keyCode: k === "Escape" ? 27 : 73, bubbles: true, cancelable: true,
      });
      view.contentDOM.dispatchEvent(event);
      return event.defaultPrevented;
    };
    // In modo normale Vim lascia passare Esc; in concentrazione lo si prende
    // lo stesso, così un Esc per abitudine non ne fa uscire.
    expect(key("Escape")).toBe(true);
    expect(key("i")).toBe(true);
    const esc = new KeyboardEvent("keydown", { key: "Escape", code: "Escape", keyCode: 27, bubbles: true, cancelable: true });
    view.contentDOM.dispatchEvent(esc);
    // In inserimento Esc torna al modo normale, e `desktop-shell.ts` esce dalla concentrazione soltanto su un Esc che
    // nessuno ha preso (`defaultPrevented` falso).
    expect(esc.defaultPrevented).toBe(true);
    setConcentrating(false);
    // Fuori dalla concentrazione Esc in modo normale resta libero come prima.
    expect(key("Escape")).toBe(false);
    engine.destroy();
    vi.mocked(settings).mockResolvedValue([]);
  });
});
