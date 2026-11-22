// Il motivo a parole di un rifiuto del motore (K6 T13, giro 3): un oggetto bloccato nella
// selezione dice di sbloccarlo o toglierlo dalla selezione, per ogni comando (decisione b).
import { describe, expect, it } from "vitest";
import { t } from "../strings";
import { motivoDelRifiuto, motivoDelRifiutoDelloStrumento } from "./rifiuto";

describe("motivoDelRifiuto", () => {
  it("un oggetto bloccato nella selezione dice di sbloccarlo o toglierlo dalla selezione", () => {
    const motivo = motivoDelRifiuto("locked");
    expect(motivo).toBe("draw.reason.lockedSelection");
    expect(t(motivo!)).toContain("sblocca o togli dalla selezione");
  });

  it("un oggetto nascosto resta con il suo motivo, e il bloccato della selezione non è quello", () => {
    expect(motivoDelRifiuto("hidden")).toBe("draw.reason.locked");
    expect(motivoDelRifiuto("empty")).toBeNull();
  });
});

describe("motivoDelRifiutoDelloStrumento (K6 T14, giro 7)", () => {
  it("il Contagocce dice che non legge i colori di un'immagine, in italiano", () => {
    const motivo = motivoDelRifiutoDelloStrumento("unsupported", "eyedropper");
    expect(motivo).toBe("draw.contagocce.immagine");
    expect(t(motivo!)).toBe("Il Contagocce non legge i colori di un'immagine.");
  });

  it("gli altri strumenti restano con il motivo generico, e gli altri rifiuti non cambiano", () => {
    expect(motivoDelRifiutoDelloStrumento("unsupported", "pen")).toBe("draw.reason.foreign");
    expect(motivoDelRifiutoDelloStrumento("locked", "eyedropper")).toBe("draw.reason.lockedSelection");
    expect(motivoDelRifiutoDelloStrumento("empty", "eyedropper")).toBeNull();
  });
});
