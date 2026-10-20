import { describe, expect, it } from "vitest";

import { slowPhase, startupClock, SLOW_STARTUP_MS } from "./startup-timing";

const clockAt = (...marks: number[]) => {
  let i = 0;
  return startupClock(() => marks[i++] ?? marks[marks.length - 1]!);
};

describe("quanto ha impiegato l'avvio", () => {
  it("ogni tratto finisce dove comincia il successivo", () => {
    const clock = clockAt(1200, 1600, 12_000);
    clock.mark("page");
    clock.mark("shell");
    clock.mark("vault");
    expect(clock.times()).toEqual({
      phases: [{ phase: "page", ms: 1200 }, { phase: "shell", ms: 400 }, { phase: "vault", ms: 10_400 }],
      total: 12_000,
    });
  });

  it("un avvio lento nomina il tratto più lungo, uno svelto niente", () => {
    const slow = clockAt(1200, 1600, 12_000);
    slow.mark("page");
    slow.mark("shell");
    slow.mark("vault");
    expect(slowPhase(slow.times())).toBe("vault");

    const quick = clockAt(300, 500, SLOW_STARTUP_MS - 1);
    quick.mark("page");
    quick.mark("shell");
    quick.mark("vault");
    expect(slowPhase(quick.times())).toBeNull();
  });

  it("un orologio fermo, come quello del banco, non è mai lento", () => {
    const frozen = clockAt(0, 0, 0);
    frozen.mark("page");
    frozen.mark("shell");
    frozen.mark("vault");
    expect(slowPhase(frozen.times())).toBeNull();
  });
});
