// Le view `context_menu`: ciò che ne diventa voce, i params che si mandano e i
// guasti che non si vedono.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { UiNode, ViewSpec } from "../host/contract";

const fake = vi.hoisted(() => ({
  render: vi.fn(),
  action: vi.fn(),
  intents: vi.fn(),
}));
vi.mock("../host/ipc", () => ({ api: { renderView: fake.render, viewAction: fake.action } }));
vi.mock("./intents", () => ({ applyIntent: fake.intents }));

import { choicesOf, contextMenuItems, hasContextMenuViews, paramsFor, setContextMenuViews } from "./context-views";

const spec = (id: string, names: string[]): ViewSpec =>
  ({
    id,
    title: id,
    surface: "context_menu",
    refresh: [],
    follows: [],
    params: names.map((name) => ({ name, title: name, description: "", kind: "text", required: false })),
    icon: null,
    order: 0,
    open_by_default: false,
    preferred_size: null,
    closable: false,
  }) as unknown as ViewSpec;

const button = (label: string, action: string, intent = "neutral"): UiNode =>
  ({ node: "button", label, intent, action: { action, payload: { x: 1 } } }) as UiNode;

beforeEach(() => {
  vi.clearAllMocks();
  setContextMenuViews([]);
});

describe("view sulla superficie context_menu", () => {
  it("senza view non c'è niente da aspettare", async () => {
    expect(hasContextMenuViews()).toBe(false);
    expect(await contextMenuItems({ kind: "note", id: "a.md" })).toEqual([]);
    expect(fake.render).not.toHaveBeenCalled();
  });

  it("manda solo i params che la view dichiara", () => {
    const target = { kind: "folder", id: "Guida" } as const;
    expect(paramsFor(spec("v", ["target", "target_kind"]), target)).toEqual({ target: "Guida", target_kind: "folder" });
    expect(paramsFor(spec("v", ["target"]), target)).toEqual({ target: "Guida" });
    expect(paramsFor(spec("v", []), target)).toEqual({});
    expect(paramsFor(spec("v", ["altro"]), target)).toEqual({});
  });

  it("prende dall'albero solo ciò che si sceglie, nell'ordine, col tetto", () => {
    const tree = {
      node: "stack",
      dir: "vertical",
      gap: 0,
      children: [
        { node: "text", content: "ciao" },
        button("Uno", "a"),
        { node: "list", items: [{ node: "list_item", title: "Due", subtitle: null, action: { action: "b", payload: null }, selected: false }] },
        { node: "list_item", title: "Muta", subtitle: null, action: null, selected: false },
        button("Tre", "c", "danger"),
      ],
    } as unknown as UiNode;
    expect(choicesOf(tree).map((c) => [c.label, c.danger])).toEqual([["Uno", false], ["Due", false], ["Tre", true]]);
    const many = { node: "stack", dir: "vertical", gap: 0, children: Array.from({ length: 20 }, (_, i) => button(`b${i}`, "x")) } as unknown as UiNode;
    expect(choicesOf(many)).toHaveLength(8);
  });

  it("diventano voci che, scelte, tornano alla view col bersaglio", async () => {
    setContextMenuViews([spec("plug.menu", ["target"])]);
    fake.render.mockResolvedValue(button("Fai", "go"));
    fake.action.mockResolvedValue({ kind: "navigate", doc_id: "b.md" });
    const items = await contextMenuItems({ kind: "note", id: "a.md" });
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ label: "Fai", separator: true });
    expect(fake.render).toHaveBeenCalledWith("plug.menu", undefined, { target: "a.md" });
    items[0]!.run!();
    await vi.waitFor(() => expect(fake.intents).toHaveBeenCalledWith({ kind: "navigate", doc_id: "b.md" }));
    expect(fake.action).toHaveBeenCalledWith("plug.menu", null, { target: "a.md" }, "go", { x: 1 }, []);
  });

  it("una view che sbaglia o non risponde non c'è, e le altre restano", async () => {
    vi.useFakeTimers();
    try {
      setContextMenuViews([spec("rotta", []), spec("muta", []), spec("buona", [])]);
      fake.render.mockImplementation(async (id: string) => {
        if (id === "rotta") throw new Error("no");
        if (id === "muta") return new Promise(() => {});
        return button("Ok", "ok");
      });
      const pending = contextMenuItems({ kind: "file", id: "x.png" });
      await vi.advanceTimersByTimeAsync(400);
      expect((await pending).map((i) => i.label)).toEqual(["Ok"]);
    } finally {
      vi.useRealTimers();
    }
  });
});
