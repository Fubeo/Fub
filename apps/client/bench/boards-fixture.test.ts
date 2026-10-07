import { describe, expect, it } from "vitest";

import { SceneEngine } from "../src/editors/spatial/scene/engine";
import { MAX_BOARDS, MAX_EDIT_BYTES, MAX_ELEMENTS, openSource, readScene } from "../src/editors/spatial/scene/read";
import { boardsOf } from "../src/editors/spatial/tools/boards";
import { boardsFixture } from "./boards-fixture";

describe("il disegno del banco delle tavole", () => {
  it.each([1, 20, MAX_BOARDS])("con %i tavole si apre modificabile, pulito, con le tavole e le carte che dice", (count) => {
    const fixture = boardsFixture(count);
    const scene = readScene(fixture.text);
    expect(scene.status).toBe("fubdraw");
    expect(scene.readOnly).toEqual([]);
    expect(scene.diagnostics).toEqual([]);
    expect(scene.items.filter((item) => item.kind === "foreign")).toEqual([]);
    expect(openSource(fixture.text).doc.elements).toBe(fixture.elements);
    expect(fixture.elements).toBeLessThan(MAX_ELEMENTS);
    expect(new TextEncoder().encode(fixture.text).length).toBeLessThan(MAX_EDIT_BYTES);

    const boards = boardsOf(SceneEngine.open(fixture.text).model!);
    expect(boards.map(({ id, name, rect }) => ({ id, name, rect: [...rect] }))).toEqual(
      fixture.boards.map(({ id, name, rect }) => ({ id, name, rect: [...rect] })),
    );
    expect(boards.map((board) => board.paper !== null)).toEqual(fixture.boards.map((board) => board.paper !== null));
    expect(new Set(fixture.boards.map((board) => board.name)).size).toBe(count);
  });

  it("ha da 40 a 80 oggetti per tavola, e 40 a mille tavole", () => {
    const twenty = boardsFixture(20);
    expect(twenty.objects).toBeGreaterThanOrEqual(20 * 40);
    expect(twenty.objects).toBeLessThanOrEqual(20 * 80);
    expect(twenty.objects).toBeGreaterThan(20 * 50);
    expect(boardsFixture(MAX_BOARDS).objects).toBe(MAX_BOARDS * 40);
  });

  it("ha carte bianche, colorate, e tavole senza carta", () => {
    const papers = new Set(boardsFixture(20).boards.map((board) => board.paper));
    expect(papers.has("#ffffff")).toBe(true);
    expect(papers.has(null)).toBe(true);
    expect(papers.size).toBeGreaterThan(2);
  });

  it("è lo stesso disegno a ogni chiamata", () => {
    const first = boardsFixture(20);
    const again = boardsFixture(20);
    expect(again.text).toBe(first.text);
    expect(again.digest).toBe(first.digest);
    expect(boardsFixture(21).digest).not.toBe(first.digest);
  });

  it("non fa disegni senza tavole o con più tavole di quante se ne ricevono", () => {
    for (const count of [0, -1, 1.5, Number.NaN, MAX_BOARDS + 1]) {
      expect(() => boardsFixture(count)).toThrow(RangeError);
    }
  });
});
