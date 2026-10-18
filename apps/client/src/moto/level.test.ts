// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";

type Level = typeof import("./level");

/// Un `matchMedia` finto, messo **prima** di importare il modulo: il canale
/// del moto ridotto legge il browser una volta sola.
function installMedia(initial: boolean) {
  let matches = initial;
  const listeners = new Set<(event: { matches: boolean }) => void>();
  const media = {
    get matches() {
      return matches;
    },
    addEventListener: vi.fn((_name: string, listener: (event: { matches: boolean }) => void) => {
      listeners.add(listener);
    }),
    removeEventListener: vi.fn((_name: string, listener: (event: { matches: boolean }) => void) => {
      listeners.delete(listener);
    }),
  };
  const previous = window.matchMedia;
  Object.defineProperty(window, "matchMedia", {
    value: () => media as unknown as MediaQueryList,
    configurable: true,
  });
  return {
    media,
    /// Il sistema cambia idea.
    system(next: boolean) {
      matches = next;
      for (const listener of [...listeners]) listener({ matches });
    },
    restore: () => Object.defineProperty(window, "matchMedia", { value: previous, configurable: true }),
  };
}

async function load(systemReduced: boolean): Promise<{ level: Level; fake: ReturnType<typeof installMedia> }> {
  vi.resetModules();
  const fake = installMedia(systemReduced);
  return { level: await import("./level"), fake };
}

const attribute = () => document.documentElement.dataset.motion;

describe("i livelli di movimento", () => {
  let restore = () => {};

  afterEach(() => {
    restore();
    delete document.documentElement.dataset.motion;
  });

  it("di serie è pieno; «calmo» e «ridotto» si scelgono e si leggono sul documento", async () => {
    const { level, fake } = await load(false);
    restore = fake.restore;
    expect(level.motionLevel()).toBe("full");
    expect(attribute()).toBeUndefined();

    level.setMotionPreference("calm");
    expect(level.motionLevel()).toBe("calm");
    expect(attribute()).toBe("calm");

    level.setMotionPreference("reduced");
    expect(level.motionLevel()).toBe("reduced");
    expect(attribute()).toBe("reduced");

    // Da «ridotto» a «calmo»: il canale cancella l'attributo, e «calmo» lo
    // riscrive dopo.
    level.setMotionPreference("calm");
    expect(level.motionLevel()).toBe("calm");
    expect(attribute()).toBe("calm");

    level.setMotionPreference("system");
    expect(level.motionLevel()).toBe("full");
    expect(attribute()).toBeUndefined();
  });

  it("se il sistema chiede meno movimento vale «ridotto», qualunque sia la scelta", async () => {
    const { level, fake } = await load(true);
    restore = fake.restore;
    for (const choice of ["system", "calm", "reduced"] as const) {
      level.setMotionPreference(choice);
      expect(level.motionLevel(), choice).toBe("reduced");
    }
  });

  it("avvisa una volta per cambio, col livello già in vigore e l'attributo già scritto", async () => {
    const { level, fake } = await load(false);
    restore = fake.restore;
    const seen: string[] = [];
    const stop = level.onMotionLevelChange((next) => {
      seen.push(`${next}:${level.motionLevel()}:${attribute() ?? ""}`);
    });

    level.setMotionPreference("reduced");
    level.setMotionPreference("calm");
    level.setMotionPreference("calm");
    level.setMotionPreference("system");
    expect(seen).toEqual(["reduced:reduced:reduced", "calm:calm:calm", "full:full:"]);
    stop();
  });

  it("segue il sistema: il cambio arriva a chi ascolta e scavalca «calmo»", async () => {
    const { level, fake } = await load(false);
    restore = fake.restore;
    level.setMotionPreference("calm");
    const seen: string[] = [];
    const stop = level.onMotionLevelChange((next) => seen.push(next));

    fake.system(true);
    expect(level.motionLevel()).toBe("reduced");
    fake.system(false);
    expect(level.motionLevel()).toBe("calm");
    expect(seen).toEqual(["reduced", "calm"]);
    stop();
  });

  it("il disposer toglie l'ascolto, e con l'ultimo anche quello del browser", async () => {
    const { level, fake } = await load(false);
    restore = fake.restore;
    expect(fake.media.addEventListener).not.toHaveBeenCalled();

    const first: string[] = [];
    const second: string[] = [];
    const stopFirst = level.onMotionLevelChange((next) => first.push(next));
    const stopSecond = level.onMotionLevelChange((next) => second.push(next));
    expect(fake.media.addEventListener).toHaveBeenCalledTimes(1);

    stopFirst();
    stopFirst();
    level.setMotionPreference("calm");
    expect(first).toEqual([]);
    expect(second).toEqual(["calm"]);
    expect(fake.media.removeEventListener).not.toHaveBeenCalled();

    stopSecond();
    expect(fake.media.removeEventListener).toHaveBeenCalledTimes(1);
    fake.system(true);
    expect(second).toEqual(["calm"]);
    // Un ascolto nuovo riparte dal sistema com'è adesso, non da com'era.
    const late: string[] = [];
    const stopLate = level.onMotionLevelChange((next) => late.push(next));
    expect(level.motionLevel()).toBe("reduced");
    level.setMotionPreference("system");
    expect(late).toEqual([]);
    fake.system(false);
    expect(late).toEqual(["full"]);
    stopLate();
  });
});
