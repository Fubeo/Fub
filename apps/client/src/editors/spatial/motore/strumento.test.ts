import { describe, expect, it } from "vitest";
import type { DrawingToolState } from "../../../host/contract";
import { CURSORE_DI_SERIE, cursoreCss, motoreDelloStrumento, sceltaMentrePrepara, StatiStrumenti } from "./strumento";

const STATO: DrawingToolState = { busy: false, transforming: false, wants_text: false, composing: false, cursor: "arrow", options: null };

describe("lo strumento del motore", () => {
  it("manda il nome del contratto, `{ engine: { id } }`", () => {
    expect(motoreDelloStrumento("smartPen")).toEqual({ engine: { id: "smartPen" } });
  });

  it("il cursore conosciuto va nel suo CSS, uno sconosciuto è quello di serie", () => {
    expect(cursoreCss("pen_close")).toBe("pointer");
    expect(cursoreCss("move")).toBe("move");
    expect(cursoreCss("inventato")).toBe(CURSORE_DI_SERIE);
    expect(cursoreCss("constructor")).toBe(CURSORE_DI_SERIE);
  });

  it("lo stato dell'ultimo esito resta per lo strumento, e il gesto dopo lo legge", () => {
    const stati = new StatiStrumenti();
    expect(stati.stato("smartPen")).toBeNull();
    stati.registra("smartPen", { ...STATO, cursor: "pen_close" });
    stati.registra("smartPen", { ...STATO, cursor: "move" });
    expect(stati.stato("smartPen")?.cursor).toBe("move");
    expect(stati.stato("altro")).toBeNull();
  });

  it("uno strumento scelto mentre la famiglia arriva aspetta; se fallisce, il gesto non parte", () => {
    expect(sceltaMentrePrepara("in-corso")).toBe("attendi");
    expect(sceltaMentrePrepara("pronta")).toBe("avvia");
    expect(sceltaMentrePrepara("fallita")).toBe("errore");
  });

  it("chi ascolta gli stati riceve l'id a ogni esito, e il disposer lo toglie dalla lista", () => {
    const stati = new StatiStrumenti();
    const primo: string[] = [];
    const secondo: string[] = [];
    const spegniPrimo = stati.ascolta((id) => primo.push(id));
    stati.ascolta((id) => secondo.push(id));
    stati.registra("directSelection", STATO);
    expect(primo).toEqual(["directSelection"]);
    expect(secondo).toEqual(["directSelection"]);
    // Il disposer di uno solo: l'altro continua a sentire, il primo no.
    spegniPrimo();
    stati.registra("lasso", STATO);
    expect(primo).toEqual(["directSelection"]);
    expect(secondo).toEqual(["directSelection", "lasso"]);
    expect(stati.stato("lasso")).toBe(STATO);
  });

  it("un ascoltatore che si toglie durante l'avviso non riceve più quell'esito", () => {
    const stati = new StatiStrumenti();
    const visti: string[] = [];
    let spegni: () => void = () => {};
    stati.ascolta(() => spegni());
    spegni = stati.ascolta((id) => visti.push(id));
    stati.registra("zoom", STATO);
    expect(visti).toEqual([]);
  });
});
