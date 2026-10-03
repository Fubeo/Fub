// @vitest-environment happy-dom
//
// Il punto d'incontro della sessione live: i fogli che seguono il documento,
// l'operazione annotata da un gesto, le sessioni aperte.

import { describe, expect, it } from "vitest";
import { renameInDocumentCaches } from "../../../state/document-caches";
import { addLive, liveFor, liveSessions, noteSceneChange, offerStage, onStages, removeLive, stagesOf, takeSceneChange, type LiveHandle } from "./registry";
import { fakeStage } from "./test-support";

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
});
