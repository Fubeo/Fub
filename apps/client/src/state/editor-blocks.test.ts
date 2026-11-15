import { describe, expect, it, vi } from "vitest";

// `editor.blocks` letta all'avvio della finestra (T5): la prima nota si monta
// già nello stato giusto, senza le maniglie per un attimo.

const world = vi.hoisted(() => ({
  host: [] as { spec: { key: string }; value: unknown }[],
  fail: false,
  writes: [] as [string, unknown][],
  events: new Map<string, ((event: { key: string }) => void)[]>(),
}));

vi.mock("../host/query", () => ({
  settings: async () => {
    if (world.fail) throw new Error("illeggibile");
    return world.host;
  },
}));
vi.mock("../host/ipc", () => ({
  api: {
    setSetting: async (key: string, value: unknown) => {
      if (world.fail) throw new Error("disco pieno");
      world.writes.push([key, value]);
    },
  },
}));
vi.mock("./kernel", () => ({
  onEvent: (type: string, handler: (event: { key: string }) => void) => {
    world.events.set(type, [...(world.events.get(type) ?? []), handler]);
    return () => world.events.set(type, (world.events.get(type) ?? []).filter((each) => each !== handler));
  },
}));

import { blocksPreferred, mountBlocksPreference, setBlocksPreference } from "./editor-blocks";
import { Lifetime } from "../ui/lifetime";

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const fire = (type: string, key = "") => {
  for (const handler of world.events.get(type) ?? []) handler({ key });
};

describe("mountBlocksPreference", () => {
  it("legge la chiave all'avvio, la rilegge quando cambia o si apre un vault, e una lettura fallita lascia il valore di prima", async () => {
    world.host = [{ spec: { key: "editor.blocks" }, value: false }];
    const lifetime = new Lifetime();
    mountBlocksPreference(lifetime);
    await settle();
    expect(blocksPreferred()).toBe(false);

    world.host = [{ spec: { key: "editor.blocks" }, value: true }];
    fire("setting_changed", "editor.vim");
    await settle();
    expect(blocksPreferred(), "un'altra chiave non la rilegge").toBe(false);
    fire("setting_changed", "editor.blocks");
    await settle();
    expect(blocksPreferred()).toBe(true);

    world.host = [{ spec: { key: "editor.blocks" }, value: false }];
    fire("vault_opened");
    await settle();
    expect(blocksPreferred()).toBe(false);

    world.fail = true;
    fire("setting_changed", "editor.blocks");
    await settle();
    expect(blocksPreferred()).toBe(false);
    world.fail = false;

    lifetime.close();
    expect(world.events.get("setting_changed")).toEqual([]);
    expect(blocksPreferred(), "chiusa la finestra si torna al predefinito").toBe(true);
  });

  it("una scrittura fallita lascia il valore ricordato com'era", async () => {
    world.fail = true;
    await expect(setBlocksPreference(false)).rejects.toThrow("disco pieno");
    expect(blocksPreferred()).toBe(true);
    world.fail = false;
    await setBlocksPreference(false);
    expect(world.writes).toEqual([["editor.blocks", false]]);
    expect(blocksPreferred()).toBe(false);
  });
});
