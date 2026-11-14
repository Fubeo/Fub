import { describe, expect, it } from "vitest";
import { changeMap, motionAllowed, STILL_CELLS } from "./motion";

describe("il moto della cornice", () => {
  it("una riga aggiunta è nuova, le altre si riconoscono", () => {
    expect(changeMap([["a"], ["b"]], [["a"], [""], ["b"]])).toEqual({ rows: [0, -1, 1], columns: [0] });
  });

  it("le righe ordinate vengono dal loro posto di prima", () => {
    expect(changeMap([["h"], ["b"], ["a"]], [["h"], ["a"], ["b"]])).toEqual({ rows: [0, 2, 1], columns: [0] });
  });

  it("una colonna tolta lascia le altre al loro posto", () => {
    expect(changeMap([["a", "b", "c"]], [["a", "c"]])).toEqual({ rows: [0], columns: [0, 2] });
  });

  it("un valore cambiato non sposta niente", () => {
    expect(changeMap([["a", "b"]], [["a", "x"]])).toEqual({ rows: [0], columns: [0, 1] });
  });

  it("oltre il limite di celle la tabella sta ferma", () => {
    expect(motionAllowed(STILL_CELLS + 1)).toBe(false);
  });
});
