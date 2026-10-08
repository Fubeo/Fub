// Quali ordini cambierebbero qualcosa: lo stesso conto di `orderOps`, senza
// scrivere le operazioni.

import { describe, expect, it } from "vitest";
import { doc } from "../scene/test-support";
import { NewIds } from "./edit";
import { orderOps, type Order } from "./arrange";
import { orderChanges } from "./order-changes";
import { LAYER, open } from "./test-support";

const ORDERS: readonly Order[] = ["front", "forward", "backward", "back"];

const RECT = (id: string, x: number): string => `<rect id="${id}" x="${x}" y="0" width="10" height="10"/>`;

/// Due livelli e un gruppo, con oggetti senza id fra quelli con l'id.
const SOURCE = doc(
  `${LAYER}${RECT("oaaaaaaaa", 0)}${RECT("obbbbbbbb", 20)}<g id="ogggggggg">${RECT("oxxxxxxxx", 40)}<rect x="60" y="0" width="10" height="10"/>${RECT("ozzzzzzzz", 80)}</g>${RECT("occcccccc", 100)}</g>` +
    `<g id="l2" fub:layer="Due">${RECT("odddddddd", 120)}${RECT("oeeeeeeee", 140)}</g>`,
);

describe("gli ordini che cambierebbero qualcosa", () => {
  const opened = open(SOURCE);
  const ids = new NewIds((id) => opened.engine.holder(id) !== null);
  const everyone = [...opened.index.units, ...opened.index.children(opened.index.get("ogggggggg")!)];

  /// Ciò che dicono le operazioni di `orderOps`.
  const written = (chosen: typeof everyone): Order[] =>
    ORDERS.filter((order) => orderOps(opened.engine.model!, opened.index, chosen, order, ids).ops.length > 0);

  it("coincidono con quelli di `orderOps`, per ogni scelta di oggetti, anche in più genitori", () => {
    expect(everyone.map((unit) => unit.key)).toEqual(["oaaaaaaaa", "obbbbbbbb", "ogggggggg", "occcccccc", "odddddddd", "oeeeeeeee", "oxxxxxxxx", "@0.2.1", "ozzzzzzzz"]);
    let checked = 0;
    for (let mask = 1; mask < 1 << everyone.length; mask++) {
      const chosen = everyone.filter((_, at) => (mask & (1 << at)) !== 0);
      const expected = new Set(written(chosen));
      const found = orderChanges(opened.index, chosen);
      expect([...found].sort(), chosen.map((unit) => unit.key).join(" ")).toEqual([...expected].sort());
      checked++;
    }
    expect(checked).toBe(511);
  });

  it("per un oggetto solo: in cima non sale, in fondo non scende", () => {
    const at = (key: string) => [opened.index.get(key)!];
    expect([...orderChanges(opened.index, at("occcccccc"))].sort()).toEqual(["back", "backward"]);
    expect([...orderChanges(opened.index, at("oaaaaaaaa"))].sort()).toEqual(["forward", "front"]);
    expect([...orderChanges(opened.index, at("obbbbbbbb"))].sort()).toEqual(["back", "backward", "forward", "front"]);
    // Un gruppo in mezzo al suo livello si sposta in tutti e quattro i modi.
    expect(orderChanges(opened.index, [opened.index.get("ogggggggg")!]).size).toBe(4);
  });

  it("senza oggetti scelti non cambia niente", () => {
    expect(orderChanges(opened.index, []).size).toBe(0);
  });

  it("tutti gli oggetti di un genitore scelti non cambiano l'ordine", () => {
    const layer = opened.index.units.filter((unit) => unit.path[0] === 1);
    expect(layer.map((unit) => unit.key)).toEqual(["odddddddd", "oeeeeeeee"]);
    expect(orderChanges(opened.index, layer).size).toBe(0);
    expect(written(layer)).toEqual([]);
  });
});
