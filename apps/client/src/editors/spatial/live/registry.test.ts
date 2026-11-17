// @vitest-environment happy-dom
//
// Il punto d'incontro della sessione live: i fogli che seguono il documento,
// l'operazione annotata da un gesto, le sessioni aperte.

import { describe, expect, it, vi } from "vitest";
import { renameInDocumentCaches } from "../../../state/document-caches";
import { addLive, liveFor, liveSessions, noteSceneChange, offerStage, onStages, removeLive, stagesOf, takeSceneChange, type LiveHandle } from "./registry";
import { fakeStage } from "./test-support";
import type { DrawStage } from "../tools/editor";

/// La raccolta della memoria di V8, a comando. `tsconfig.json` dichiara i soli
/// tipi di Vite: il poco di Node che serve è tipato qui a mano.
interface NodeProcess {
  getBuiltinModule(id: "node:v8"): { setFlagsFromString(flags: string): void };
  getBuiltinModule(id: "node:vm"): { runInNewContext(code: string): unknown };
}
function collector(): () => void {
  const node = (globalThis as unknown as { process: NodeProcess }).process;
  node.getBuiltinModule("node:v8").setFlagsFromString("--expose-gc");
  return node.getBuiltinModule("node:vm").runInNewContext("gc") as () => void;
}

describe("il registro della sessione live", () => {
  it("i fogli offerti seguono il documento anche quando cambia nome", () => {
    const stage = fakeStage();
    let changes = 0;
    const stop = onStages(() => changes++);
    const withdraw = offerStage("a.svg", stage);
    expect(stagesOf("a.svg")).toEqual([stage]);
    renameInDocumentCaches("a.svg", "b.svg");
    expect(stagesOf("a.svg")).toEqual([]);
    expect(stagesOf("b.svg")).toEqual([stage]);
    withdraw();
    withdraw();
    expect(stagesOf("b.svg")).toEqual([]);
    expect(changes).toBe(2);
    stop();
  });

  it("l'operazione di un gesto si ritrova una volta, e solo per il suo testo", () => {
    const op = { op: "page", viewBox: "0 0 10 10" } as const;
    noteSceneChange("uno", op);
    expect(takeSceneChange("due")).toBeNull();
    noteSceneChange("uno", op);
    expect(takeSceneChange("uno")).toBe(op);
    expect(takeSceneChange("uno")).toBeNull();
  });

  it("tiene le sessioni aperte, per documento", () => {
    const handle: LiveHandle = { doc: "c.svg", show: () => {}, stop: async () => {} };
    addLive(handle);
    expect(liveFor("c.svg")).toBe(handle);
    expect(liveSessions()).toContain(handle);
    removeLive(handle);
    expect(liveFor("c.svg")).toBeNull();
  });

  it("ritirato, il primo foglio offerto non resta in memoria", async () => {
    // Un modulo nuovo: la prima `offerStage` è quella che iscrive la cache
    // delle rinomine, per sempre. Se la cache nascesse nel suo contesto, il
    // primo editor del disegno aperto resterebbe vivo, DOM compreso.
    vi.resetModules();
    const fresh = await import("./registry");
    const gc = collector();
    let held: WeakRef<object> | null = null;
    (() => {
      const stage = { root: document.createElement("div"), stage: {} as DrawStage, visible: () => true };
      held = new WeakRef(stage);
      fresh.offerStage("a.svg", stage)();
    })();
    // Un `WeakRef` tiene il suo oggetto fino alla fine del giro in cui l'ha letto.
    await new Promise((done) => setTimeout(done, 0));
    gc();
    await new Promise((done) => setTimeout(done, 0));
    gc();
    expect(held!.deref()).toBeUndefined();
  });
});
