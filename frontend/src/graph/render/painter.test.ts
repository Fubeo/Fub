import { describe, expect, it } from "vitest";
import { pulseOpacity } from "./painter";

describe("pulse dei nodi", () => {
  it("è assente sotto moto ridotto e presente col moto normale", () => {
    expect(pulseOpacity("n0", 100, 1, false)).toBeUndefined();
    expect(pulseOpacity("n0", 100, 1, true)).toBeDefined();
  });
});
