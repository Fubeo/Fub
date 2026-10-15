// @vitest-environment happy-dom
//
// L'ordine d'avvio dello Scrittoio su un telefono. La shell comune legge la
// shell dichiarata e la serie del tema **mentre viene importata**: se una delle
// due arriva dopo, il telefono parte come un desktop o con la serie sbagliata,
// e non lo dice a nessuno.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MobileBridge } from "../shells/mobile/bridge";

const world = vi.hoisted(() => ({
  log: [] as string[],
  composeFails: false,
  storage: undefined as unknown,
}));

vi.mock("../platform/capabilities", () => ({
  declareShell: (shell: { id?: string }) => world.log.push(`shell:${shell.id ?? "?"}`),
}));
vi.mock("../shells/mobile/index", () => ({ MOBILE_SHELL: { id: "mobile" } }));
vi.mock("../theme/scrittoio/series", () => ({ SCRITTOIO_SERIES: { id: "scrittoio" } }));
vi.mock("../theme/theme", () => ({
  declareThemeSeries: (series: { id: string }) => {
    world.log.push(`series:${series.id}`);
    return () => world.log.push("restore:series");
  },
}));
vi.mock("../shells/mobile/bootstrap", () => ({
  mountMobileShell: (_bridge: unknown, options: { storage?: unknown }) => {
    world.log.push("mount:mobile");
    world.storage = options.storage;
    return () => world.log.push("teardown:mobile");
  },
}));
vi.mock("../shells/mobile/storage-ui", () => ({
  privateStoragePorts: () => ({ ports: "private" }),
}));
// La cornice importa la shell comune: la fabbrica gira al primo `import()`, e
// l'istante in cui gira è ciò che la prova guarda.
vi.mock("../shells/scrittoio/mobile/compose", () => {
  world.log.push("import:compose");
  return {
    composeScrittoioMobile: async () => {
      world.log.push("compose");
      if (world.composeFails) throw new Error("la cornice non parte");
      return () => world.log.push("teardown:scrittoio");
    },
  };
});

import { startupMobile } from "./mobile";

const bridge = {} as MobileBridge;

beforeEach(() => {
  world.log = [];
  world.composeFails = false;
  world.storage = undefined;
});

describe("l'avvio dello Scrittoio su un telefono", () => {
  it("dichiara la shell e la serie prima di importare la cornice, e monta la shell mobile", async () => {
    await startupMobile(bridge);
    const order = world.log.filter((entry) => entry !== "import:compose");
    expect(order).toEqual(["shell:mobile", "series:scrittoio", "mount:mobile", "compose"]);
    // La fabbrica gira una volta sola nel file: se c'è, è dopo le dichiarazioni.
    const imported = world.log.indexOf("import:compose");
    if (imported !== -1) expect(imported).toBeGreaterThan(world.log.indexOf("series:scrittoio"));
  });

  it("senza porte di storage native usa quelle dello spazio privato", async () => {
    await startupMobile(bridge);
    expect(world.storage).toEqual({ ports: "private" });
    const native = { marker: true };
    await startupMobile(bridge, { storage: native as never });
    expect(world.storage).toBe(native);
  });

  it("lo smontaggio toglie la shell mobile, la cornice, e ripristina la serie per ultima", async () => {
    const teardown = await startupMobile(bridge);
    world.log = [];
    teardown();
    expect(world.log).toEqual(["teardown:mobile", "teardown:scrittoio", "restore:series"]);
  });

  it("se la cornice non parte non restano montate né la shell mobile né la serie", async () => {
    world.composeFails = true;
    await expect(startupMobile(bridge)).rejects.toThrow("la cornice non parte");
    expect(world.log.slice(-2)).toEqual(["teardown:mobile", "restore:series"]);
  });
});

describe("gli import dell'ingresso", () => {
  const STATIC = /^import\s+(?!type\b)[^;]*?from\s+"([^"]+)"|^import\s+"([^"]+)"/gm;
  /// Ciò che un ingresso mobile può importare prima delle dichiarazioni: niente
  /// che porti con sé la shell comune.
  const ALLOWED = [
    "../platform/capabilities",
    "../shells/mobile/index",
    "../shells/mobile/bootstrap",
    "../shells/mobile/storage-ui",
    "../theme/scrittoio/series",
    "../theme/theme",
  ];

  it("`mobile.ts` importa in modo statico solo ciò che non avvia la shell comune", async () => {
    const source = (await import("./mobile.ts?raw")).default as string;
    const imports = [...source.matchAll(STATIC)].map((match) => match[1] ?? match[2]);
    expect(imports.sort()).toEqual([...ALLOWED].sort());
    expect(source).toContain('await import("../shells/scrittoio/mobile/compose")');
  });

  it("`mobile-main.ts` porta il ponte nativo, l'avvio e i due fogli di struttura", async () => {
    const source = (await import("./mobile-main.ts?raw")).default as string;
    const imports = [...source.matchAll(STATIC)].map((match) => match[1] ?? match[2]);
    expect(imports).toEqual([
      "../host/ipc",
      "./mobile",
      "../theme/scrittoio/structure.css",
      "../shells/scrittoio/mobile/mobile.css",
    ]);
  });
});
