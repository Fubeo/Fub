// L'orientamento EXIF: gli otto valori, e quelli fuori scala che valgono 1.
import { describe, expect, it } from "vitest";
import { orientationOf, orientationTransform } from "./orientation";

describe("l'orientamento EXIF", () => {
  it("gli otto valori danno giro e specchio", () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8].map((exif) => orientationOf(exif))).toEqual([
      { rotation: 0, mirrored: false },
      { rotation: 0, mirrored: true },
      { rotation: 180, mirrored: false },
      { rotation: 180, mirrored: true },
      { rotation: 270, mirrored: true },
      { rotation: 90, mirrored: false },
      { rotation: 90, mirrored: true },
      { rotation: 270, mirrored: false },
    ]);
  });

  it("0, 9, un numero rotto e nessun numero valgono come 1", () => {
    for (const exif of [0, 9, -1, 2.5, Number.NaN, null, undefined]) {
      expect(orientationOf(exif), String(exif)).toEqual({ rotation: 0, mirrored: false });
      expect(orientationTransform(exif), String(exif)).toBe("");
    }
  });

  it("la trasformazione: 1 vuota, 6 un quarto di giro, 5 girata e specchiata", () => {
    expect(orientationTransform(1)).toBe("");
    expect(orientationTransform(6)).toBe("rotate(90deg)");
    expect(orientationTransform(5)).toBe("rotate(270deg) scaleX(-1)");
    expect(orientationTransform(2)).toBe("scaleX(-1)");
  });
});
