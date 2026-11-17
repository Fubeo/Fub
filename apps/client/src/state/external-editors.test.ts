// Le app Craft installate (N7): chieste all'apertura del vault, richieste
// quando cambia `craft.editor-paths` o il componente, «nessuna» quando il
// comando è rifiutato, e una risposta vecchia non scrive sopra la nuova.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CommandSpec } from "../host/contract";
import type { ExternalEditor } from "../host/ipc";

const world = vi.hoisted(() => ({
  vault: "/vault" as string | undefined,
  events: new Map<string, ((event: { key?: string }) => void)[]>(),
}));

vi.mock("./kernel", () => ({
  onEvent: (type: string, handler: (event: { key?: string }) => void) => {
    world.events.set(type, [...(world.events.get(type) ?? []), handler]);
    return () => world.events.set(type, (world.events.get(type) ?? []).filter((each) => each !== handler));
  },
}));
vi.mock("./store", async (original) => ({
  ...(await original<typeof import("./store")>()),
  openVaultRoot: () => world.vault,
}));

import { craftEditorsInstalled, mountExternalEditors } from "./external-editors";
import { emit, setCommandSpecs } from "./store";
import { Lifetime } from "../ui/lifetime";

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const fire = (type: string, event: { key?: string } = {}) => (world.events.get(type) ?? []).forEach((handler) => handler(event));

const editor = (id: string, installed: boolean): ExternalEditor => ({ id, name: id, opens: [id], installed, running: false });
const ONE = [editor("vectorcraft", false), editor("photocraft", true)];
const NONE = [editor("vectorcraft", false), editor("photocraft", false)];

const spec = (id: string): CommandSpec => ({
  id,
  title: id,
  description: "",
  keybinding: null,
  params: [],
  scope: { writes: false, reach: "session", reversible: true },
  surfaces: [],
});

/// Una domanda all'host che si può far rispondere quando si vuole.
function deferredList() {
  const calls: { vault: string; resolve: (list: readonly ExternalEditor[]) => void; reject: (error: unknown) => void }[] = [];
  const list = (vault: string) => new Promise<readonly ExternalEditor[]>((resolve, reject) => calls.push({ vault, resolve, reject }));
  return { calls, list };
}

beforeEach(() => {
  world.vault = "/vault";
  world.events.clear();
  setCommandSpecs([]);
});

describe("mountExternalEditors", () => {
  it("chiede all'apertura e tiene se ce n'è almeno una installata", async () => {
    const life = new Lifetime();
    const { calls, list } = deferredList();
    mountExternalEditors(life, list);
    expect(calls.map((call) => call.vault)).toEqual(["/vault"]);
    calls[0]!.resolve(ONE);
    await settle();
    expect(craftEditorsInstalled()).toBe(true);
    life.close();
    expect(craftEditorsInstalled()).toBe(false);
  });

  it("un rifiuto del comando, un'app vecchia, vale «nessuna»", async () => {
    const life = new Lifetime();
    const { calls, list } = deferredList();
    mountExternalEditors(life, list);
    calls[0]!.reject({ kind: "internal", message: "comando sconosciuto" });
    await settle();
    expect(craftEditorsInstalled()).toBe(false);
    life.close();
  });

  it("richiede quando cambia craft.editor-paths, e non per un'altra impostazione", async () => {
    const life = new Lifetime();
    const { calls, list } = deferredList();
    mountExternalEditors(life, list);
    calls[0]!.resolve(NONE);
    await settle();
    expect(craftEditorsInstalled()).toBe(false);
    fire("setting_changed", { key: "files.people-folder" });
    expect(calls).toHaveLength(1);
    fire("setting_changed", { key: "craft.editor-paths" });
    expect(calls).toHaveLength(2);
    calls[1]!.resolve(ONE);
    await settle();
    expect(craftEditorsInstalled()).toBe(true);
    life.close();
  });

  it("richiede quando il componente si accende o si spegne, non a ogni rilettura dei comandi", async () => {
    const life = new Lifetime();
    const { calls, list } = deferredList();
    mountExternalEditors(life, list);
    calls[0]!.resolve(NONE);
    await settle();
    setCommandSpecs([spec("note.extract")]);
    setCommandSpecs([spec("note.extract")]);
    expect(calls).toHaveLength(1);
    setCommandSpecs([spec("note.extract"), spec("craft.preview")]);
    expect(calls).toHaveLength(2);
    calls[1]!.resolve(ONE);
    await settle();
    expect(craftEditorsInstalled()).toBe(true);
    setCommandSpecs([spec("note.extract"), spec("craft.preview")]);
    expect(calls).toHaveLength(2);
    setCommandSpecs([spec("note.extract")]);
    expect(calls).toHaveLength(3);
    calls[2]!.resolve([]);
    await settle();
    expect(craftEditorsInstalled()).toBe(false);
    life.close();
  });

  it("una risposta del vault di prima non scrive sopra quella del vault nuovo", async () => {
    const life = new Lifetime();
    const { calls, list } = deferredList();
    mountExternalEditors(life, list);
    world.vault = "/altro";
    emit("vault", "/altro");
    expect(calls.map((call) => call.vault)).toEqual(["/vault", "/altro"]);
    calls[1]!.resolve(NONE);
    await settle();
    calls[0]!.resolve(ONE);
    await settle();
    expect(craftEditorsInstalled()).toBe(false);
    life.close();
  });

  it("il vault chiuso vale «nessuna», anche con una risposta in volo", async () => {
    const life = new Lifetime();
    const { calls, list } = deferredList();
    mountExternalEditors(life, list);
    fire("vault_closed");
    calls[0]!.resolve(ONE);
    await settle();
    expect(craftEditorsInstalled()).toBe(false);
    life.close();
  });

  it("aperture e chiusure ripetute non lasciano ascoltatori vivi", async () => {
    let asked = 0;
    for (let round = 0; round < 3; round += 1) {
      const life = new Lifetime();
      mountExternalEditors(life, async () => {
        asked += 1;
        return ONE;
      });
      await settle();
      expect(craftEditorsInstalled()).toBe(true);
      life.close();
    }
    expect(asked).toBe(3);
    expect([...world.events.values()].every((handlers) => handlers.length === 0)).toBe(true);
    emit("vault", "/vault");
    setCommandSpecs([spec("craft.preview")]);
    setCommandSpecs([]);
    await settle();
    expect(asked).toBe(3);
    expect(craftEditorsInstalled()).toBe(false);
  });
});
