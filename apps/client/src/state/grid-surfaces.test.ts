// L'elenco delle superfici grid si chiede una volta per vault, e si rilegge
// soltanto dopo i fatti che rimontano i provider.
import { describe, expect, it, vi } from "vitest";
import type { GridHost } from "../editors/grid/engine-host";
import type { GridSurfaceSpec } from "../host/contract";
import { openLifetime } from "../ui/lifetime";

const world = vi.hoisted(() => ({
  root: "/vault" as string | undefined,
  handlers: new Map<string, (payload: never) => void>(),
  components: new Set<() => void>(),
}));

vi.mock("./kernel", () => ({
  onEvent: (type: string, handler: (payload: never) => void) => {
    world.handlers.set(type, handler);
    return () => world.handlers.delete(type);
  },
}));
vi.mock("./store", () => ({ openVaultRoot: () => world.root }));
vi.mock("./components", () => ({
  componentChoiceKey: (key: string) => key.startsWith("components.") || key === "plugins.disabled",
  onComponents: (listener: () => void) => {
    world.components.add(listener);
    return () => world.components.delete(listener);
  },
}));

const { cachedGridSurfaces } = await import("./grid-surfaces");

const SPEC = { id: "xlsx.grid", family: "grid", format: "xlsx", protocol_version: 2 } as unknown as GridSurfaceSpec;

function host(list: () => Promise<readonly GridSurfaceSpec[]>): GridHost & { closed: string[] } {
  const closed: string[] = [];
  return {
    closed,
    listGridSurfaces: list,
    openGridBytes: vi.fn(),
    gridBytesWindow: vi.fn(),
    applyGridBytes: vi.fn(),
    gridBytesCommands: vi.fn(),
    gridBytesCommand: vi.fn(),
    closeGridBytes: async (_surface: string, instance: string) => {
      closed.push(instance);
    },
  } as unknown as GridHost & { closed: string[] };
}

const emit = (type: string, payload: unknown): void => world.handlers.get(type)?.(payload as never);

describe("le superfici grid in memoria", () => {
  it("una domanda per vault, riletta dopo una scelta dei componenti, un vault riaperto o chiuso", async () => {
    world.root = "/vault";
    const list = vi.fn(async () => [SPEC]);
    const lifetime = openLifetime();
    const cached = cachedGridSurfaces(host(list), lifetime);
    expect(await cached.listGridSurfaces()).toEqual([SPEC]);
    expect(await cached.listGridSurfaces()).toEqual([SPEC]);
    expect(list).toHaveBeenCalledTimes(1);
    // Una chiave qualsiasi non tocca i provider.
    emit("setting_changed", { key: "editor.font" });
    await cached.listGridSurfaces();
    expect(list).toHaveBeenCalledTimes(1);
    emit("setting_changed", { key: "components.fub.foglio" });
    await cached.listGridSurfaces();
    expect(list).toHaveBeenCalledTimes(2);
    emit("vault_opened", { root: "/vault" });
    await cached.listGridSurfaces();
    expect(list).toHaveBeenCalledTimes(3);
    emit("vault_closed", { root: "/vault" });
    await cached.listGridSurfaces();
    expect(list).toHaveBeenCalledTimes(4);
    for (const listener of world.components) listener();
    await cached.listGridSurfaces();
    expect(list).toHaveBeenCalledTimes(5);
    // Un altro vault è un'altra domanda.
    world.root = "/altro";
    await cached.listGridSurfaces();
    expect(list).toHaveBeenCalledTimes(6);
    lifetime.close();
    expect(world.handlers.size).toBe(0);
    expect(world.components.size).toBe(0);
  });

  it("una risposta in volo quando l'elenco si dimentica non resta, e un rifiuto nemmeno", async () => {
    world.root = "/vault";
    let answer!: (specs: readonly GridSurfaceSpec[]) => void;
    const list = vi.fn()
      .mockImplementationOnce(() => new Promise<readonly GridSurfaceSpec[]>((resolve) => { answer = resolve; }))
      .mockImplementationOnce(async () => { throw new Error("host"); })
      .mockImplementation(async () => [SPEC]);
    const lifetime = openLifetime();
    const cached = cachedGridSurfaces(host(list), lifetime);
    const first = cached.listGridSurfaces();
    emit("vault_opened", { root: "/vault" });
    answer([]);
    expect(await first).toEqual([]);
    await expect(cached.listGridSurfaces()).rejects.toThrow("host");
    expect(await cached.listGridSurfaces()).toEqual([SPEC]);
    expect(list).toHaveBeenCalledTimes(3);
    lifetime.close();
  });

  it("le altre porte passano all'host così come sono", async () => {
    const inner = host(async () => [SPEC]);
    const lifetime = openLifetime();
    await cachedGridSurfaces(inner, lifetime).closeGridBytes("xlsx.grid", "xlsx-1");
    expect(inner.closed).toEqual(["xlsx-1"]);
    lifetime.close();
  });
});
