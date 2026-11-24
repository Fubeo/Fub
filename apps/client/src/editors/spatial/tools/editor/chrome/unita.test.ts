// «Cambia unità» (`document.switchUnits`, `./unita.ts`): l'unità del documento passa alla successiva
// col campo Unità; un rifiuto si annuncia.
import { describe, expect, it, vi } from "vitest";
import type { LengthUnit } from "../../../scene/rulers";
import { CAMBIA_UNITA, cambiaUnita } from "./unita";

function finto(unita: LengthUnit, rifiuto: string | null = null) {
  return {
    scene: { root: { units: unita } },
    changeField: vi.fn(() => rifiuto),
    announce: vi.fn(),
  } as unknown as Parameters<typeof cambiaUnita>[0] & { changeField: ReturnType<typeof vi.fn>; announce: ReturnType<typeof vi.fn> };
}

describe("document.switchUnits", () => {
  it("è la voce del motore che il client fa", () => {
    expect(CAMBIA_UNITA).toBe("document.switchUnits");
  });

  it("scrive l'unità successiva col campo Unità", () => {
    const ctx = finto("pt");
    cambiaUnita(ctx);
    expect(ctx.changeField).toHaveBeenCalledWith("unit", "in");
    expect(ctx.announce).not.toHaveBeenCalled();
    const dai = finto("px");
    cambiaUnita(dai);
    expect(dai.changeField).toHaveBeenCalledWith("unit", "pt");
  });

  it("un rifiuto del disegno si annuncia", () => {
    const ctx = finto("mm", "Il disegno è in sola lettura.");
    cambiaUnita(ctx);
    expect(ctx.announce).toHaveBeenCalledWith("Il disegno è in sola lettura.");
  });
});
