import { describe, expect, it } from "vitest";
import type { DrawingToolState } from "../../../host/contract";
import {
  CURSORE_DI_SERIE,
  cursoreCss,
  cursoreDelloStrumento,
  motoreDelloStrumento,
  sceltaMentrePrepara,
  STRUMENTI_CHE_DISEGNANO,
  StatiStrumenti,
} from "./strumento";

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

  it("avvisa solo se lo stato cambia, e un'anteprima a metà gesto lo tiene senza avvisare", () => {
    const stati = new StatiStrumenti();
    const visti: string[] = [];
    stati.ascolta((id) => visti.push(id));
    stati.registra("directSelection", STATO);
    // Lo stesso stato di nuovo: i pannelli non si rifanno.
    stati.registra("directSelection", { ...STATO });
    expect(visti).toEqual(["directSelection"]);
    // A metà gesto: si legge subito, ma nessuno è avvisato.
    const mosso = { ...STATO, cursor: "move" };
    stati.registra("directSelection", mosso, false);
    expect(stati.stato("directSelection")).toBe(mosso);
    expect(visti).toEqual(["directSelection"]);
    // L'esito che chiude il gesto avvisa, anche se uguale all'ultima anteprima.
    stati.registra("directSelection", { ...mosso });
    expect(visti).toEqual(["directSelection", "directSelection"]);
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

describe("il cursore degli strumenti che disegnano (K6 T11, cursori)", () => {
  it("elenca gli strumenti che disegnano: penna, matita, forme, pennelli e gomma dei punti", () => {
    expect(new Set(STRUMENTI_CHE_DISEGNANO)).toEqual(
      new Set([
        "pen",
        "smartPen",
        "pencil",
        "rectangle",
        "roundedRectangle",
        "ellipse",
        "polygon",
        "star",
        "lineSegment",
        "arc",
        "spiral",
        "rectangularGrid",
        "polarGrid",
        "paintbrush",
        "blobBrush",
        "anchorEraserBrush",
      ]),
    );
  });

  it("con la voce accesa la croce va agli strumenti che disegnano, non alla selezione né al testo", () => {
    expect(cursoreDelloStrumento("pencil", "arrow", true)).toBe("crosshair");
    expect(cursoreDelloStrumento("rectangle", "arrow", true)).toBe("crosshair");
    expect(cursoreDelloStrumento("anchorEraserBrush", undefined, true)).toBe("crosshair");
    expect(cursoreDelloStrumento("selection", "arrow", true)).toBe("default");
    expect(cursoreDelloStrumento("type", "text", true)).toBe("text");
  });

  it("accendi, cambia strumento (resta), spegni: lo strumento che disegna torna il suo cursore", () => {
    const cursoreDi: Record<string, string> = { pencil: "arrow", rectangle: "arrow" };
    const acceso = ["pencil", "rectangle", "pencil"].map((id) => cursoreDelloStrumento(id, cursoreDi[id], true));
    expect(acceso).toEqual(["crosshair", "crosshair", "crosshair"]);
    // Spenta, la matita torna la freccia che il motore le dà.
    expect(cursoreDelloStrumento("pencil", cursoreDi.pencil, false)).toBe("default");
  });

  it("la penna ha già la croce di serie: per lei accendere o spegnere la voce non cambia niente", () => {
    expect(cursoreDelloStrumento("pen", "pen", true)).toBe(cursoreDelloStrumento("pen", "pen", false));
    expect(cursoreDelloStrumento("pen", "pen", false)).toBe("crosshair");
  });

  it("lo strumento selezione non cambia con la voce: la freccia resta la freccia", () => {
    expect(cursoreDelloStrumento("selection", "arrow", true)).toBe(cursoreDelloStrumento("selection", "arrow", false));
  });

  it("senza motore o senza lo stato dello strumento, nessuna croce compare dal nulla", () => {
    expect(cursoreDelloStrumento(null, undefined, true)).toBe("");
    expect(cursoreDelloStrumento("pencil", undefined, false)).toBe("");
    // Con la voce accesa uno strumento che disegna mostra la croce anche prima di leggere il suo stato.
    expect(cursoreDelloStrumento("pencil", undefined, true)).toBe("crosshair");
  });
});
