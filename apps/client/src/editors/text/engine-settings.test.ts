// @vitest-environment happy-dom
import { smartLists } from "./smart-lists";
import { pasteHtml } from "./paste-html";
import { propertiesDisplay } from "./properties-display";
import { describe, expect, it, vi } from "vitest";
import { getCM } from "@replit/codemirror-vim";
import { EditorView } from "@codemirror/view";
import type { SettingEntry } from "../../host/contract";
import { settings } from "../../host/query";
import { forwardNotice } from "../../state/kernel";
import {
  createTextEngine,
  EDITOR_CLOSE_BRACKETS_KEY,
  EDITOR_FOLD_GUTTER_KEY,
  EDITOR_SMART_LISTS_KEY,
  EDITOR_INDENT_GUIDES_KEY,
  EDITOR_PASTE_HTML_KEY,
  EDITOR_PROPERTIES_KEY,
  EDITOR_RTL_KEY,
  EDITOR_SPELLCHECK_KEY,
  EDITOR_VIM_KEY,
} from "./engine";

vi.mock("../../host/query", () => ({ settings: vi.fn() }));
const setSetting = vi.hoisted(() => vi.fn(() => Promise.resolve()));
vi.mock("../../host/ipc", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../host/ipc")>();
  return { ...real, api: { ...real.api, setSetting } };
});

function entry(key: string, value: boolean): SettingEntry {
  return {
    spec: {
      key, label: key, description: "", group: "Editor", scope: "machine",
      kind: { kind: "toggle", default: key === EDITOR_SPELLCHECK_KEY },
      program_writable: false,
    },
    value,
    source: "machine",
  };
}

describe("text input settings", () => {
  it("applies setting changes on the same view and stops listening after destroy", async () => {
    const read = vi.mocked(settings);
    read.mockResolvedValueOnce([entry(EDITOR_SPELLCHECK_KEY, true), entry(EDITOR_VIM_KEY, false)]);
    const host = document.createElement("div");
    document.body.append(host);
    const engine = createTextEngine(host, { onChange: () => {}, onSelectionChange: () => {} });
    const view = EditorView.findFromDOM(host)!;
    engine.setDoc("שלום");
    await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(1));
    read.mockResolvedValue([entry(EDITOR_SPELLCHECK_KEY, false), entry(EDITOR_VIM_KEY, true)]);
    forwardNotice({
      event: { type: "setting_changed", key: EDITOR_VIM_KEY, scope: "machine" },
      origin: { actor: { kind: "user" }, batch: null },
    });
    await vi.waitFor(() => expect(getCM(view)).not.toBeNull());
    expect(view.contentDOM.getAttribute("spellcheck")).toBe("false");
    expect(engine.getDoc()).toBe("שלום");
    engine.destroy();
    const calls = read.mock.calls.length;
    forwardNotice({
      event: { type: "setting_changed", key: EDITOR_SPELLCHECK_KEY, scope: "machine" },
      origin: { actor: { kind: "user" }, batch: null },
    });
    expect(read).toHaveBeenCalledTimes(calls);
    host.remove();
  });

  it("a field keeps its fixed layout and never reads the writing preferences", async () => {
    const read = vi.mocked(settings);
    read.mockReset();
    read.mockResolvedValue([entry(EDITOR_SPELLCHECK_KEY, true), entry(EDITOR_VIM_KEY, true)]);
    const document_ = document.createElement("div");
    const field = document.createElement("div");
    document.body.append(document_, field);
    const text = createTextEngine(document_, { onChange: () => {}, onSelectionChange: () => {} });
    const cell = createTextEngine(field, { onChange: () => {}, onSelectionChange: () => {}, field: true });
    const view = EditorView.findFromDOM(field)!;
    await vi.waitFor(() => expect(getCM(EditorView.findFromDOM(document_)!)).not.toBeNull());
    forwardNotice({
      event: { type: "setting_changed", key: EDITOR_VIM_KEY, scope: "machine" },
      origin: { actor: { kind: "user" }, batch: null },
    });
    await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(2));
    expect(getCM(view)).toBeNull();
    expect(field.querySelector(".cm-lineNumbers")).toBeNull();
    expect(document_.querySelector(".cm-lineNumbers")).not.toBeNull();
    expect(view.contentDOM.getAttribute("spellcheck")).toBe("false");
    text.destroy();
    cell.destroy();
    document_.remove();
    field.remove();
  });

  it("il testo da destra a sinistra gira la stessa vista e torna indietro", async () => {
    const read = vi.mocked(settings);
    read.mockReset();
    read.mockResolvedValue([entry(EDITOR_RTL_KEY, true)]);
    const host = document.createElement("div");
    document.body.append(host);
    const engine = createTextEngine(host, { onChange: () => {}, onSelectionChange: () => {} });
    const view = EditorView.findFromDOM(host)!;
    await vi.waitFor(() => expect(view.contentDOM.getAttribute("dir")).toBe("rtl"));
    read.mockResolvedValue([entry(EDITOR_RTL_KEY, false)]);
    forwardNotice({
      event: { type: "setting_changed", key: EDITOR_RTL_KEY, scope: "machine" },
      origin: { actor: { kind: "user" }, batch: null },
    });
    // Spento, torna la direzione che il testo dice da sé.
    await vi.waitFor(() => expect(view.contentDOM.getAttribute("dir")).toBe("auto"));
    engine.destroy();
    host.remove();
  });

  it("il margine di piegatura e la chiusura delle parentesi si spengono dalla stessa vista", async () => {
    const read = vi.mocked(settings);
    read.mockReset();
    read.mockResolvedValue([]);
    const host = document.createElement("div");
    document.body.append(host);
    const engine = createTextEngine(host, { onChange: () => {}, onSelectionChange: () => {} });
    const view = EditorView.findFromDOM(host)!;
    await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(1));
    expect(host.querySelector(".cm-foldGutter")).not.toBeNull();
    const typeBracket = () => {
      view.dispatch({ selection: { anchor: 0 } });
      const handled = view.state.facet(EditorView.inputHandler).some((h) => h(view, 0, 0, "(", () => view.state.update({ changes: { from: 0, insert: "(" } })));
      return { handled, text: view.state.doc.toString() };
    };
    expect(typeBracket().handled).toBe(true);
    read.mockResolvedValue([entry(EDITOR_FOLD_GUTTER_KEY, false), entry(EDITOR_CLOSE_BRACKETS_KEY, false)]);
    forwardNotice({
      event: { type: "setting_changed", key: EDITOR_FOLD_GUTTER_KEY, scope: "machine" },
      origin: { actor: { kind: "user" }, batch: null },
    });
    await vi.waitFor(() => expect(host.querySelector(".cm-foldGutter")).toBeNull());
    expect(view.state.facet(EditorView.inputHandler).some((h) => h(view, 0, 0, "(", () => view.state.update({}))))
      .toBe(false);
    engine.destroy();
    host.remove();
  });

  it("gli elenchi intelligenti seguono l'impostazione", async () => {
    const read = vi.mocked(settings);
    read.mockReset();
    read.mockResolvedValue([]);
    const host = document.createElement("div");
    document.body.append(host);
    const engine = createTextEngine(host, { onChange: () => {}, onSelectionChange: () => {} });
    const view = EditorView.findFromDOM(host)!;
    await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(1));
    expect(view.state.facet(smartLists)).toBe(true);
    read.mockResolvedValue([entry(EDITOR_SMART_LISTS_KEY, false)]);
    forwardNotice({
      event: { type: "setting_changed", key: EDITOR_SMART_LISTS_KEY, scope: "machine" },
      origin: { actor: { kind: "user" }, batch: null },
    });
    await vi.waitFor(() => expect(view.state.facet(smartLists)).toBe(false));
    expect(view.state.facet(pasteHtml)).toBe(true);
    read.mockResolvedValue([entry(EDITOR_PASTE_HTML_KEY, false)]);
    forwardNotice({
      event: { type: "setting_changed", key: EDITOR_PASTE_HTML_KEY, scope: "machine" },
      origin: { actor: { kind: "user" }, batch: null },
    });
    await vi.waitFor(() => expect(view.state.facet(pasteHtml)).toBe(false));
    engine.destroy();
    host.remove();
  });

  it("le guide di rientro si accendono dall'impostazione e disegnano un fondo sulle righe rientrate", async () => {
    const read = vi.mocked(settings);
    read.mockReset();
    read.mockResolvedValue([]);
    const host = document.createElement("div");
    document.body.append(host);
    const engine = createTextEngine(host, { onChange: () => {}, onSelectionChange: () => {} });
    engine.setDoc("- uno\n    - due\n");
    await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(1));
    const guided = () => host.querySelectorAll<HTMLElement>(".cm-line[style*='repeating-linear-gradient']").length;
    expect(guided()).toBe(0);
    read.mockResolvedValue([entry(EDITOR_INDENT_GUIDES_KEY, true)]);
    forwardNotice({
      event: { type: "setting_changed", key: EDITOR_INDENT_GUIDES_KEY, scope: "machine" },
      origin: { actor: { kind: "user" }, batch: null },
    });
    await vi.waitFor(() => expect(guided()).toBe(1));
    engine.destroy();
    host.remove();
  });

  it("editor.properties sceglie come Live mostra il frontmatter, e un valore ignoto resta YAML", async () => {
    const read = vi.mocked(settings);
    read.mockReset();
    read.mockResolvedValue([]);
    const host = document.createElement("div");
    document.body.append(host);
    const engine = createTextEngine(host, { onChange: () => {}, onSelectionChange: () => {} });
    const view = EditorView.findFromDOM(host)!;
    await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(1));
    expect(view.state.facet(propertiesDisplay)).toBe("source");
    const change = (value: string) => {
      read.mockResolvedValue([{ ...entry(EDITOR_PROPERTIES_KEY, false), value }]);
      forwardNotice({
        event: { type: "setting_changed", key: EDITOR_PROPERTIES_KEY, scope: "machine" },
        origin: { actor: { kind: "user" }, batch: null },
      });
    };
    change("visible");
    await vi.waitFor(() => expect(view.state.facet(propertiesDisplay)).toBe("visible"));
    change("tabella");
    await vi.waitFor(() => expect(view.state.facet(propertiesDisplay)).toBe("source"));
    engine.destroy();
    host.remove();
  });

  it("il tasto destro sul margine mostra o nasconde numeri di riga e frecce, non sul testo né in un campo", async () => {
    const read = vi.mocked(settings);
    read.mockReset();
    read.mockResolvedValue([]);
    const host = document.createElement("div");
    const field = document.createElement("div");
    document.body.append(host, field);
    const engine = createTextEngine(host, { onChange: () => {}, onSelectionChange: () => {} });
    const cell = createTextEngine(field, { onChange: () => {}, onSelectionChange: () => {}, field: true });
    await vi.waitFor(() => expect(host.querySelector(".cm-gutters")).not.toBeNull());
    const press = (target: Element) => {
      const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 4, clientY: 4 });
      target.dispatchEvent(event);
      return event.defaultPrevented;
    };
    expect(press(host.querySelector(".cm-content")!)).toBe(false);
    expect(document.getElementById("context-menu")).toBeNull();
    expect(press(field.querySelector(".cm-content")!)).toBe(false);
    expect(press(host.querySelector(".cm-gutters")!)).toBe(true);
    const items = [...document.querySelectorAll<HTMLButtonElement>("#context-menu [role=menuitem]")];
    expect(items.map((item) => item.textContent)).toEqual([
      "Nascondi i numeri di riga",
      "Nascondi le frecce per piegare",
      "Piega tutto",
      "Apri tutto",
    ]);
    items[0]!.click();
    expect(setSetting).toHaveBeenCalledWith("editor.line-numbers", false);
    engine.destroy();
    cell.destroy();
    host.remove();
    field.remove();
  });
});
