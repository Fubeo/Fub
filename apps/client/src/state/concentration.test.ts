import { afterEach, describe, expect, it, vi } from "vitest";
import { concentrating, escapeLeavesConcentration, onConcentration, setConcentrating } from "./concentration";

const esc = (init: Partial<KeyboardEvent> = {}): KeyboardEvent =>
  ({
    key: "Escape", ctrlKey: false, metaKey: false, altKey: false, shiftKey: false,
    isComposing: false, defaultPrevented: false, ...init,
  }) as KeyboardEvent;

afterEach(() => setConcentrating(false));

describe("la concentrazione", () => {
  it("chi ascolta lo sa solo quando cambia davvero, e smette quando vuole", () => {
    const seen = vi.fn();
    const stop = onConcentration(seen);
    setConcentrating(true);
    setConcentrating(true);
    setConcentrating(false);
    stop();
    setConcentrating(true);
    expect(seen.mock.calls).toEqual([[true], [false]]);
    expect(concentrating()).toBe(true);
  });

  it("Esc ne esce soltanto se nessuno l'ha preso, senza modificatori e fuori da una composizione", () => {
    expect(escapeLeavesConcentration(esc())).toBe(false);
    setConcentrating(true);
    expect(escapeLeavesConcentration(esc())).toBe(true);
    // Un menu aperto, un dialogo o Vim l'hanno già preso.
    expect(escapeLeavesConcentration(esc({ defaultPrevented: true }))).toBe(false);
    expect(escapeLeavesConcentration(esc({ isComposing: true }))).toBe(false);
    expect(escapeLeavesConcentration(esc({ shiftKey: true }))).toBe(false);
    expect(escapeLeavesConcentration(esc({ ctrlKey: true }))).toBe(false);
    expect(escapeLeavesConcentration(esc({ key: "Enter" }))).toBe(false);
  });
});
