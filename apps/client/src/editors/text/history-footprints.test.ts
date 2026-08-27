import { describe, expect, it } from "vitest";
import { EditorState, type ChangeDesc, type ChangeSpec } from "@codemirror/state";
import {
  MAX_FOOTPRINTS,
  addFootprints,
  emptyFootprints,
  footprintsOverlap,
  mapFootprints,
  type FootprintState,
} from "./history-footprints";

function changeSet(doc: string, changes: ChangeSpec): ChangeDesc {
  return EditorState.create({ doc }).update({ changes }).changes;
}

function localFootprints(doc: string, changes: ChangeSpec): FootprintState {
  return addFootprints(emptyFootprints, changeSet(doc, changes));
}

describe("HistoryFootprints", () => {
  it("tratta i bordi di un intervallo come fratelli e l'interno come overlap", () => {
    const footprints = localFootprints("abcd", { from: 1, to: 2, insert: "XY" });
    expect(footprints.ranges).toEqual([{ from: 1, to: 3 }]);
    expect(footprintsOverlap(footprints, changeSet("aXYcd", { from: 1, insert: "L" }))).toBe(false);
    expect(footprintsOverlap(footprints, changeSet("aXYcd", { from: 3, insert: "R" }))).toBe(false);
    expect(footprintsOverlap(footprints, changeSet("aXYcd", { from: 2, insert: "M" }))).toBe(true);
  });

  it("conserva un anchor per una cancellazione e lo protegge", () => {
    const footprints = localFootprints("abcd", { from: 1, to: 3, insert: "" });
    expect(footprints.ranges).toEqual([]);
    expect(footprints.anchors).toEqual([1]);
    expect(footprintsOverlap(footprints, changeSet("ad", { from: 1, insert: "X" }))).toBe(true);
    expect(footprintsOverlap(footprints, changeSet("ad", { from: 0, to: 1, insert: "" }))).toBe(true);
    expect(footprintsOverlap(footprints, changeSet("ad", { from: 1, to: 2, insert: "" }))).toBe(true);
  });

  it("rimappa gli intervalli attraverso modifiche disgiunte", () => {
    const initial = localFootprints("abcd", { from: 1, to: 2, insert: "XY" });
    const mapped = mapFootprints(initial, changeSet("aXYcd", { from: 0, insert: "!" }));
    expect(mapped.ranges).toEqual([{ from: 2, to: 4 }]);
    expect(mapped.unknown).toBe(false);
  });

  it("trasforma un intervallo collassato da una sostituzione in un anchor", () => {
    const initial = localFootprints("abcd", { from: 1, to: 2, insert: "XY" });
    const mapped = mapFootprints(initial, changeSet("aXYcd", { from: 1, to: 3, insert: "" }));
    expect(mapped.ranges).toEqual([]);
    expect(mapped.anchors).toEqual([1]);
  });

  it("fallisce chiuso su mapping non valido", () => {
    const initial = localFootprints("abcd", { from: 1, to: 2, insert: "XY" });
    const broken = {
      empty: false,
      length: 5,
      newLength: 5,
      mapPos() {
        throw new Error("mapping rotto");
      },
      iterChangedRanges() {},
    } as unknown as ChangeDesc;
    const outside = {
      empty: false,
      length: 5,
      newLength: 2,
      mapPos: () => 99,
      iterChangedRanges() {},
    } as unknown as ChangeDesc;
    expect(mapFootprints(initial, outside).unknown).toBe(true);
    expect(mapFootprints(initial, broken).unknown).toBe(true);
    expect(footprintsOverlap(mapFootprints(initial, broken), changeSet("abcde", { from: 0, insert: "x" }))).toBe(true);
  });

  it("azzera la metadata quando supera il limite bounded", () => {
    const doc = " ".repeat(MAX_FOOTPRINTS * 2 + 1);
    const changes = Array.from({ length: MAX_FOOTPRINTS + 1 }, (_, index) => ({
      from: index * 2,
      insert: "x",
    }));
    const result = addFootprints(emptyFootprints, changeSet(doc, changes));
    expect(result.unknown).toBe(true);
    expect(result.ranges.length + result.anchors.length).toBe(0);
    expect(JSON.stringify(result)).not.toContain("x");
  });
});
