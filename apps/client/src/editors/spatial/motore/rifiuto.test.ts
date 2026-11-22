// Il motivo a parole di un rifiuto del motore (K6 T13, giro 3): un oggetto bloccato nella
// selezione dice di sbloccarlo o toglierlo dalla selezione, per ogni comando (decisione b).
import { describe, expect, it } from "vitest";
import { t } from "../strings";
import { motivoDelRifiuto } from "./rifiuto";

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
