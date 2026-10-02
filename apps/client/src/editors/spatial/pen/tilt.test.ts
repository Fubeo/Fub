import { describe, expect, it } from "vitest";
import { anglesFromTilt, penAngles, reportsTilt } from "./tilt";

describe("inclinazione della penna", () => {
  it("preferisce altitudine e azimut, convertiti da radianti a gradi", () => {
    expect(penAngles({ altitudeAngle: Math.PI / 4, azimuthAngle: Math.PI, tiltX: 10, tiltY: 0 }))
      .toEqual({ a: 45, z: 180 });
  });

  it("altrimenti converte tiltX e tiltY con le formule di Pointer Events 3", () => {
    const near = (tiltX: number, tiltY: number, a: number, z: number): void => {
      const angles = anglesFromTilt(tiltX, tiltY);
      expect(angles.a).toBeCloseTo(a, 10);
      expect(angles.z).toBeCloseTo(z, 10);
    };
    expect(anglesFromTilt(0, 0)).toEqual({ a: 90, z: 0 });
    near(30, 0, 60, 0);
    near(-30, 0, 60, 180);
    near(0, 30, 60, 90);
    near(0, -30, 60, 270);
    expect(anglesFromTilt(90, 0)).toEqual({ a: 0, z: 0 });
    expect(anglesFromTilt(0, -90)).toEqual({ a: 0, z: 270 });
    // Sul bordo l'azimut di una diagonale non è definito, e vale 0.
    expect(anglesFromTilt(90, 45)).toEqual({ a: 0, z: 0 });
    const diagonal = anglesFromTilt(45, 45);
    expect(diagonal.z).toBeCloseTo(45, 10);
    // tan(45°) = 1 in tutte e due le direzioni: atan(1/√2).
    expect(diagonal.a).toBeCloseTo((Math.atan(1 / Math.SQRT2) * 180) / Math.PI, 10);
    const third = anglesFromTilt(-20, -40);
    expect(third.z).toBeGreaterThan(180);
    expect(third.z).toBeLessThan(270);
    expect(penAngles({ tiltX: 30, tiltY: 0 })).toEqual(anglesFromTilt(30, 0));
  });

  it("senza angoli né inclinazioni non dà niente", () => {
    expect(penAngles({})).toBeNull();
    expect(penAngles({ altitudeAngle: Number.NaN, azimuthAngle: 0 })).toBeNull();
  });

  it("riconosce un sensore vero solo da un valore diverso dal default", () => {
    expect(reportsTilt({ tiltX: 0, tiltY: 0, altitudeAngle: Math.PI / 2, azimuthAngle: 0 })).toBe(false);
    expect(reportsTilt({})).toBe(false);
    expect(reportsTilt({ tiltX: 1, tiltY: 0 })).toBe(true);
    expect(reportsTilt({ tiltX: 0, tiltY: -3 })).toBe(true);
    expect(reportsTilt({ altitudeAngle: 1.2, azimuthAngle: 0 })).toBe(true);
    expect(reportsTilt({ altitudeAngle: Math.PI / 2, azimuthAngle: 0.5 })).toBe(true);
  });
});
