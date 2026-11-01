// I componenti accesi del vault aperto: una lettura alla volta, un giro in più
// per quanti eventi arrivino durante una lettura, e tutto acceso tranne i
// plugin spenti quando l'host non risponde.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ComponentsMap } from "../host/contract";
import { openLifetime } from "../ui/lifetime";

const world = vi.hoisted(() => ({
  root: "/vault" as string | undefined,
  map: vi.fn<(root?: string) => Promise<unknown>>(),
  settings: [] as unknown[],
  handlers: new Map<string, (payload: never) => void>(),
}));

vi.mock("../host/ipc", () => ({
  api: {
    componentsMap: (root?: string) => world.map(root),
    queryIndex: async () => ({ kind: "settings", value: world.settings }),
  },
}));
vi.mock("./kernel", () => ({
  onEvent: (type: string, handler: (payload: never) => void) => {
    world.handlers.set(type, handler);
    return () => world.handlers.delete(type);
  },
}));
vi.mock("./store", () => ({
  openVaultRoot: () => world.root,
  vaultArg: (root: string) => [root],
  on: () => () => {},
}));

const { components, componentsReady, mountComponents, onComponents } = await import("./components");

function map(lavagna: boolean): ComponentsMap {
  return {
    profilo: null,
    righe: [
      { id: "fub.lavagna", nome: "Lavagna", acceso: lavagna, ui: ["editors/canvas"] },
      { id: "fub.draw", nome: "Disegni", acceso: true, ui: ["editors/spatial"] },
      { id: "fub.pdf", nome: "PDF", acceso: false, ui: ["editors/media"] },
    ],
    profili: [],
  } as unknown as ComponentsMap;
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("i componenti del vault aperto", () => {
  beforeEach(() => {
    world.root = "/vault";
    world.map.mockReset();
    world.settings = [];
  });

  it("legge la mappa una volta e dice quali pezzi sono accesi", async () => {
    const lifetime = openLifetime();
    mountComponents(lifetime);
    world.map.mockResolvedValue(map(false));
    const state = await componentsReady();
    expect(world.map).toHaveBeenCalledTimes(1);
    expect(state?.uiOn("editors/canvas")).toBe(false);
    expect(state?.uiOn("editors/spatial")).toBe(true);
    // Un pezzo che nessuna riga nomina è del nucleo.
    expect(state?.uiOn("editors/text")).toBe(true);
    expect(state?.offRowFor("editors/media")?.nome).toBe("PDF");
    expect(components()).toBe(state);
    await componentsReady();
    expect(world.map).toHaveBeenCalledTimes(1);
    lifetime.close();
  });

  it("sei eventi durante una lettura chiedono un giro solo in più", async () => {
    const lifetime = openLifetime();
    mountComponents(lifetime);
    let release!: () => void;
    world.map.mockImplementationOnce(() => new Promise((resolve) => { release = () => resolve(map(true)); }));
    world.map.mockResolvedValue(map(false));
    const seen: boolean[] = [];
    const stop = onComponents((next) => seen.push(next.uiOn("editors/canvas")));
    const first = componentsReady();
    for (let i = 0; i < 6; i += 1) world.handlers.get("setting_changed")!({ key: "components.off" } as never);
    world.handlers.get("setting_changed")!({ key: "editor.font" } as never);
    release();
    const state = await first;
    await tick();
    expect(world.map).toHaveBeenCalledTimes(2);
    expect(state?.uiOn("editors/canvas")).toBe(false);
    // Chi ascolta sente lo stato finale, una volta.
    expect(seen).toEqual([false]);
    stop();
    lifetime.close();
  });

  it("un evento appena dopo la risposta chiede sempre un'altra lettura", async () => {
    // L'evento cade a ogni distanza, in microtask, dalla risposta in volo:
    // in nessun punto trova la lettura già finita e si perde.
    for (let hops = 0; hops < 16; hops += 1) {
      world.map.mockReset();
      const lifetime = openLifetime();
      mountComponents(lifetime);
      let release!: () => void;
      world.map.mockImplementationOnce(() => new Promise((resolve) => { release = () => resolve(map(true)); }));
      world.map.mockResolvedValue(map(false));
      const first = componentsReady();
      release();
      for (let i = 0; i < hops; i += 1) await Promise.resolve();
      world.handlers.get("setting_changed")!({ key: "components.off" } as never);
      await first;
      for (let i = 0; i < 4; i += 1) await tick();
      expect({ hops, reads: world.map.mock.calls.length }).toEqual({ hops, reads: 2 });
      expect(components()?.uiOn("editors/canvas")).toBe(false);
      lifetime.close();
    }
  });

  it("cambiata la lingua rilegge i nomi e chi ascolta lo sa", async () => {
    const lifetime = openLifetime();
    mountComponents(lifetime);
    world.map.mockResolvedValueOnce(map(true));
    await componentsReady();
    const english = map(true);
    english.righe[0] = { ...english.righe[0]!, nome: "Whiteboard" };
    world.map.mockResolvedValue(english);
    const seen: string[] = [];
    const stop = onComponents((next) => seen.push(next.row("fub.lavagna")?.nome ?? ""));
    world.handlers.get("setting_changed")!({ key: "locale.language" } as never);
    for (let i = 0; i < 4; i += 1) await tick();
    expect(world.map).toHaveBeenCalledTimes(2);
    expect(components()?.row("fub.lavagna")?.nome).toBe("Whiteboard");
    expect(seen).toEqual(["Whiteboard"]);
    stop();
    lifetime.close();
  });

  it("senza la mappa vale tutto acceso tranne i plugin spenti", async () => {
    const lifetime = openLifetime();
    mountComponents(lifetime);
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    world.map.mockRejectedValue(new Error("giù"));
    world.settings = [{ spec: { key: "plugins.disabled" }, value: ["fub.lavagna"] }];
    const state = await componentsReady();
    expect(state?.map).toBeNull();
    expect(state?.on("fub.lavagna")).toBe(false);
    expect(state?.on("fub.pdf")).toBe(true);
    expect(state?.uiOn("editors/canvas")).toBe(true);
    expect(error).toHaveBeenCalled();
    error.mockRestore();
    lifetime.close();
  });

  it("una lettura per un vault non arriva a un altro", async () => {
    const lifetime = openLifetime();
    mountComponents(lifetime);
    let release!: () => void;
    world.map.mockImplementationOnce(() => new Promise((resolve) => { release = () => resolve(map(true)); }));
    const old = componentsReady();
    world.root = "/altro";
    world.map.mockResolvedValue(map(false));
    const fresh = await componentsReady();
    release();
    await old;
    await tick();
    expect(fresh?.root).toBe("/altro");
    expect(components()?.root).toBe("/altro");
    expect(components()?.uiOn("editors/canvas")).toBe(false);
    lifetime.close();
  });
});
