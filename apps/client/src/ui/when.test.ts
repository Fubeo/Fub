import { afterEach, describe, expect, it, vi } from "vitest";
import { exactTime, relativeTime } from "./when";

// L'orologio del banco: il 19 agosto 2026 alle 9:30, ora di Roma.
const NOW = new Date("2026-08-19T09:30:00+02:00").getTime();

const setLanguage = (language: string) => vi.stubGlobal("navigator", { language });

afterEach(() => vi.unstubAllGlobals());

describe("l'ora relativa", () => {
  it("adesso, poi i minuti, poi l'ora senza secondi, poi la data", () => {
    setLanguage("it");
    expect(relativeTime(NOW - 10_000, NOW)).toBe("adesso");
    expect(relativeTime(NOW - 2 * 60_000, NOW)).toBe("2 min fa");
    expect(relativeTime(NOW - 59 * 60_000, NOW)).toBe("59 min fa");
    const hourAgo = relativeTime(NOW - 2 * 3_600_000, NOW);
    expect(hourAgo).toMatch(/^\d{2}:\d{2}$/);
    expect(relativeTime(NOW - 3 * 86_400_000, NOW)).toMatch(/ago|\d{2}:\d{2}/);
    expect(relativeTime(NOW - 3 * 86_400_000, NOW)).not.toBe(hourAgo);
  });

  it("parla la lingua della shell, e i secondi restano nel suggerimento", () => {
    setLanguage("en");
    expect(relativeTime(NOW - 1_000, NOW)).toBe("just now");
    expect(relativeTime(NOW - 5 * 60_000, NOW)).toBe("5 min. ago");
    expect(exactTime(NOW - 5_000)).toMatch(/:\d{2}:\d{2}/);
  });
});
