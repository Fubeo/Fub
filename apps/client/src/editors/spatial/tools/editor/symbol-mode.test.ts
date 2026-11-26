// «Modifica simbolo» ed «Esci dalla modalità modifica simbolo» del Completo:
// la modalità di modifica dei simboli dell'app, dalle istanze scelte.

import { describe, expect, it, vi } from "vitest";
import { SceneEngine } from "../../scene/engine";
import { doc } from "../../scene/test-support";
import { t } from "../../strings";
import { LAYER } from "../test-support";
import { comandoDiFub } from "./chrome/status";
import type { EditorContext } from "./context";

const SOURCE = doc(
  '<defs id="fub-defs"><symbol id="r1" overflow="visible"><title>Presa</title><rect id="o1" x="0" y="0" width="10" height="10"/></symbol>' +
    '<symbol id="r2" overflow="visible"><title>Lampada</title><circle id="o2" cx="0" cy="0" r="5"/></symbol></defs>' +
    `${LAYER}<use id="oi1" href="#r1" transform="translate(10 0)"/><use id="oi2" href="#r1" transform="translate(40 0)"/><use id="oi3" href="#r2" transform="translate(80 0)"/><rect id="oq1" x="0" y="50" width="5" height="5"/></g>`,
);

/// Un editor finto sul disegno vero: le unità scelte sono quelle con gli id
/// `scelti`, e il ruolo è quello del modello.
function fingi(scelti: readonly string[]) {
  const engine = SceneEngine.open(SOURCE);
  const units = scelti.map((id) => {
    const node = engine.holder(id)!;
    return { key: id, node, role: node.details!.role };
  });
  const announce = vi.fn();
  const isolate = vi.fn(() => true);
  const ctx = { engine, selectedUnits: () => units, announce, isolate } as unknown as EditorContext;
  return { ctx, units, announce, isolate };
}

describe("Modifica simbolo", () => {
  it("entra dalla prima istanza scelta, anche fra altri oggetti", () => {
    const { ctx, units, isolate, announce } = fingi(["oq1", "oi2", "oi1"]);
    expect(comandoDiFub(ctx, "disegno.symbol.edit")).toBe(true);
    expect(isolate).toHaveBeenCalledWith(units[1], null);
    expect(announce).not.toHaveBeenCalled();
  });

  it("istanze di simboli diversi: lo dice e non entra", () => {
    const { ctx, isolate, announce } = fingi(["oi1", "oi3"]);
    comandoDiFub(ctx, "disegno.symbol.edit");
    expect(isolate).not.toHaveBeenCalled();
    expect(announce).toHaveBeenCalledWith(t("draw.symbol.edit.mixed"));
  });

  it("senza un'istanza scelta: lo dice e non entra", () => {
    const { ctx, isolate, announce } = fingi(["oq1"]);
    comandoDiFub(ctx, "disegno.symbol.edit");
    expect(isolate).not.toHaveBeenCalled();
    expect(announce).toHaveBeenCalledWith(t("draw.symbol.edit.none"));
  });
});

describe("Esci dalla modalità modifica simbolo", () => {
  /// Un isolamento finto: i ruoli dei contenitori aperti, dal più esterno.
  function isolato(ruoli: string[]) {
    const leaveIsolation = vi.fn(() => {
      if (ruoli.length === 0) return false;
      ruoli.pop();
      return true;
    });
    const isolationSteps = () => (ruoli.length === 0 ? null : ruoli.map((role) => ({ node: { details: { role } } })));
    const ctx = { leaveIsolation, isolationSteps } as unknown as EditorContext;
    return { ctx, leaveIsolation, ruoli };
  }

  it("esce dal simbolo anche da un suo gruppo isolato, e l'isolamento di prima resta", () => {
    const { ctx, leaveIsolation, ruoli } = isolato(["group", "symbol", "group"]);
    expect(comandoDiFub(ctx, "disegno.symbol.exitEditing")).toBe(true);
    expect(leaveIsolation).toHaveBeenCalledTimes(2);
    expect(leaveIsolation).toHaveBeenCalledWith(false);
    expect(ruoli).toEqual(["group"]);
  });

  it("fuori da un simbolo non fa niente", () => {
    const { ctx, leaveIsolation } = isolato(["group"]);
    comandoDiFub(ctx, "disegno.symbol.exitEditing");
    expect(leaveIsolation).not.toHaveBeenCalled();
  });
});
