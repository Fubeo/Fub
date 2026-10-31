import { beforeEach, describe, expect, it, vi } from "vitest";

// Dove sta la giornaliera di un giorno (K6): il nome gemello di `daily_name`
// in `crates/fub-features/src/template.rs`, e le impostazioni rilette.

const world = vi.hoisted(() => ({
  template: [] as { spec: { key: string }; value: unknown }[],
  host: [] as { spec: { key: string }; value: unknown }[],
  events: new Map<string, ((event: { key: string }) => void)[]>(),
}));

vi.mock("../host/query", () => ({
  settings: async (plugin?: string) => (plugin === "fub.template" ? world.template : world.host),
}));
vi.mock("./kernel", () => ({
  onEvent: (type: string, handler: (event: { key: string }) => void) => {
    world.events.set(type, [...(world.events.get(type) ?? []), handler]);
    return () => world.events.set(type, (world.events.get(type) ?? []).filter((each) => each !== handler));
  },
}));
vi.mock("./store", async (original) => ({
  ...(await original<typeof import("./store")>()),
  openVaultRoot: () => "/vault",
}));
vi.mock("./locale", () => ({ systemLocale: () => ({ first_day_of_week: "sunday" }) }));

import { dailyFolder, dailyFormat, dailyName, dailyPath, firstWeekday, mountDates } from "./dates";
import { Lifetime } from "../ui/lifetime";

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  world.template = [];
  world.host = [];
  world.events.clear();
});

describe("dailyName", () => {
  it("segue il formato come note.daily", () => {
    expect(dailyName("YYYY-MM-DD", "2026-10-19", "it")).toBe("2026-10-19");
    expect(dailyName("YYYY/MMMM/YYYY-MMM-DD", "2026-10-19", "it")).toBe("2026/ottobre/2026-ott-19");
    expect(dailyName("YYYY/MM MMMM/dddd D", "2026-03-01", "en")).toBe("2026/03 March/Sunday 1");
    expect(dailyName("[Diario] YY.M.D ddd", "2024-02-29", "it")).toBe("Diario 24.2.29 gio");
    expect(dailyName("[YYYY", "2026-10-19", "it")).toBe("[2026");
  });
});

describe("dailyFolder e dailyFormat", () => {
  it("tornano a quelli di sempre se vuoti", () => {
    expect(dailyFolder(" /Diario/ ")).toBe("Diario");
    expect(dailyFolder("")).toBe("Daily");
    expect(dailyFormat("  ")).toBe("YYYY-MM-DD");
  });
});

describe("mountDates", () => {
  it("legge cartella, formato e primo giorno, e li rilegge quando cambiano", async () => {
    world.template = [
      { spec: { key: "daily.folder" }, value: "Diario" },
      { spec: { key: "daily.format" }, value: "YYYY/YYYY-MM-DD" },
    ];
    world.host = [{ spec: { key: "locale.first-day-of-week" }, value: "" }];
    const lifetime = new Lifetime();
    mountDates(lifetime);
    await settle();
    expect(dailyPath("2026-11-04")).toBe("Diario/2026/2026-11-04");
    // Vuoto è «come il sistema».
    expect(firstWeekday()).toBe(7);

    world.host = [{ spec: { key: "locale.first-day-of-week" }, value: "monday" }];
    for (const handler of world.events.get("setting_changed") ?? []) handler({ key: "locale.first-day-of-week" });
    await settle();
    expect(firstWeekday()).toBe(1);

    lifetime.close();
    expect(dailyPath("2026-11-04")).toBe("Daily/2026-11-04");
    expect(world.events.get("setting_changed")).toEqual([]);
  });
});
