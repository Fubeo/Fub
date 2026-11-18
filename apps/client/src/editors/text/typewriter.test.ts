// @vitest-environment happy-dom
import { EditorSelection, EditorState, type StateEffect, type StateEffectType, type Transaction, type TransactionSpec } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { describe, expect, it, vi } from "vitest";
import type { SettingEntry } from "../../host/contract";
import { settings } from "../../host/query";
import { forwardNotice } from "../../state/kernel";
import { createTextEngine, EDITOR_TYPEWRITER_KEY } from "./engine";
import { typewriter } from "./typewriter";

vi.mock("../../host/query", () => ({ settings: vi.fn() }));

const DOC = Array.from({ length: 40 }, (_, index) => `Riga ${index + 1}`).join("\n");

function stateWith(on: boolean): EditorState {
  return EditorState.create({ doc: DOC, selection: EditorSelection.cursor(DOC.indexOf("Riga 20")), extensions: typewriter.of(on) });
}

/// Lo scorrimento che la transazione chiede: la forma interna di CodeMirror
/// (`ScrollTarget`) non è esportata, se ne leggono i due campi che contano.
function centred(tr: Transaction): { head: number } | null {
  const scroll = (EditorView.scrollIntoView(0) as unknown as { type: StateEffectType<unknown> }).type;
  for (const effect of tr.effects as readonly StateEffect<unknown>[]) {
    if (!effect.is(scroll)) continue;
    const target = effect.value as { range: { head: number }; y: string } | undefined;
    if (target?.y === "center") return { head: target.range.head };
  }
  return null;
}

function run(on: boolean, spec: (state: EditorState) => TransactionSpec): Transaction {
  const state = stateWith(on);
  return state.update(spec(state));
}

describe("la macchina da scrivere", () => {
  it("la battuta porta la riga del cursore al centro", () => {
    const tr = run(true, (state) => ({
      changes: { from: state.selection.main.head, insert: "x" },
      selection: EditorSelection.cursor(state.selection.main.head + 1),
      scrollIntoView: true,
      userEvent: "input.type",
    }));
    expect(centred(tr)).toEqual({ head: tr.newSelection.main.head });
  });

  it("anche le frecce, Annulla e un a capo", () => {
    const down = run(true, (state) => ({
      selection: EditorSelection.cursor(state.doc.line(21).from),
      scrollIntoView: true,
      userEvent: "select",
    }));
    expect(centred(down)).toEqual({ head: down.newSelection.main.head });
    const undo = run(true, () => ({ changes: { from: 0, to: 4 }, scrollIntoView: true, userEvent: "undo" }));
    expect(centred(undo)).not.toBeNull();
  });

  it("spenta non chiede niente: resta lo scorrimento «quanto basta»", () => {
    const tr = run(false, (state) => ({
      changes: { from: state.selection.main.head, insert: "x" },
      scrollIntoView: true,
      userEvent: "input.type",
    }));
    expect(centred(tr)).toBeNull();
    expect(tr.scrollIntoView).toBe(true);
  });

  it("il clic, il trascinamento e la modifica di un altro riquadro lasciano il foglio fermo", () => {
    const click = run(true, (state) => ({ selection: EditorSelection.cursor(state.doc.line(3).from), scrollIntoView: true, userEvent: "select.pointer" }));
    expect(centred(click)).toBeNull();
    const drop = run(true, () => ({ changes: { from: 0, insert: "y" }, scrollIntoView: true, userEvent: "input.drop" }));
    expect(centred(drop)).toBeNull();
    const sync = run(true, () => ({ changes: { from: 0, insert: "z" }, userEvent: "sync" }));
    expect(centred(sync)).toBeNull();
  });

  it("un cursore che non si muove non chiede un altro scorrimento", () => {
    const still = run(true, (state) => ({ selection: state.selection, scrollIntoView: true, userEvent: "select" }));
    expect(centred(still)).toBeNull();
    // «Seleziona tutto» non chiede di vedere il cursore: niente salto in fondo.
    const all = run(true, (state) => ({ selection: EditorSelection.single(0, state.doc.length), userEvent: "select" }));
    expect(centred(all)).toBeNull();
  });

  it("accesa, l'editor ha lo spazio in fondo; spenta no", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const view = new EditorView({ parent: host, state: stateWith(true) });
    expect(view.dom.classList.contains("cm-fub-typewriter")).toBe(true);
    view.setState(stateWith(false));
    expect(view.dom.classList.contains("cm-fub-typewriter")).toBe(false);
    view.destroy();
    host.remove();
  });
});

function entry(key: string, value: boolean): SettingEntry {
  return {
    spec: {
      key, label: key, description: "", group: "Editor", scope: "machine",
      kind: { kind: "toggle", default: false },
      program_writable: false,
    },
    value,
    source: "machine",
  };
}

describe("editor.typewriter nel motore", () => {
  it("si accende e si spegne sulla stessa vista", async () => {
    const read = vi.mocked(settings);
    read.mockResolvedValue([entry(EDITOR_TYPEWRITER_KEY, true)]);
    const host = document.createElement("div");
    document.body.append(host);
    const engine = createTextEngine(host, { onChange: () => {}, onSelectionChange: () => {} });
    const view = EditorView.findFromDOM(host)!;
    engine.setDoc(DOC);
    await vi.waitFor(() => expect(view.dom.classList.contains("cm-fub-typewriter")).toBe(true));
    expect(view.state.facet(typewriter)).toBe(true);
    read.mockResolvedValue([entry(EDITOR_TYPEWRITER_KEY, false)]);
    forwardNotice({
      event: { type: "setting_changed", key: EDITOR_TYPEWRITER_KEY, scope: "machine" },
      origin: { actor: { kind: "user" }, batch: null },
    });
    await vi.waitFor(() => expect(view.dom.classList.contains("cm-fub-typewriter")).toBe(false));
    expect(engine.getDoc()).toBe(DOC);
    engine.destroy();
    host.remove();
  });

  it("un campo incorporato non la legge mai", async () => {
    const read = vi.mocked(settings);
    read.mockReset();
    read.mockResolvedValue([entry(EDITOR_TYPEWRITER_KEY, true)]);
    const host = document.createElement("div");
    document.body.append(host);
    const field = createTextEngine(host, { onChange: () => {}, onSelectionChange: () => {}, field: true });
    const view = EditorView.findFromDOM(host)!;
    await Promise.resolve();
    expect(read).not.toHaveBeenCalled();
    expect(view.state.facet(typewriter)).toBe(false);
    field.destroy();
    host.remove();
  });
});
