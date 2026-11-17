// @vitest-environment happy-dom
//
// Gli editor di un componente si caricano soltanto se il componente è acceso
// (K2, T4). Ogni modulo pigro qui è sostituito da uno finto che conta quante
// volte è stato importato: spento non arriva mai, acceso arriva una volta sola
// e soltanto quando un file lo chiede.
import { beforeEach, describe, expect, it, vi } from "vitest";
import COMPONENTS_SCENARIO from "../../__fixtures__/components-scenario.json";
import type { EditorSurface, SurfaceMountContext, SurfaceRequest } from "./registry";

const imported = vi.hoisted(() => ({ counts: new Map<string, number>() }));

function count(name: string): void {
  imported.counts.set(name, (imported.counts.get(name) ?? 0) + 1);
}

function fakeSurface(family: string, profile: string, context: SurfaceMountContext): EditorSurface {
  return {
    family,
    profile,
    surfaceId: `${context.paneId}:${context.documentId}`,
    modes: [{ id: "edit", label: () => "Edit", presentation: "surface", contextMode: "source", looks: [] }],
    setMode: () => {},
    focus: () => {},
    destroy: () => {},
  } as unknown as EditorSurface;
}

/// I moduli pigri, finti, registrati di nuovo a ogni prova: il loro primo
/// import di quella prova si conta.
function mockEditors(): void {
  vi.doMock("../canvas/surface", () => {
    count("canvas");
    return { mountCanvasSurface: (profile: string, context: SurfaceMountContext) => fakeSurface("canvas", profile, context) };
  });
  vi.doMock("../rich/surface", () => {
    count("rich");
    return { mountRichSurface: (profile: string, context: SurfaceMountContext) => fakeSurface("rich", profile, context) };
  });
  vi.doMock("../spatial/lazy", () => {
    count("spatial");
    return { mountDrawingSurface: (profile: string, context: SurfaceMountContext) => fakeSurface("canvas", profile, context) };
  });
  vi.doMock("../grid/engine", () => {
    count("grid");
    return {};
  });
  vi.doMock("../grid/menu", () => {
    count("grid-menu");
    return {};
  });
  vi.doMock("pdfjs-dist/build/pdf.worker.min.mjs?url", () => {
    count("pdf");
    return { default: "pdf.worker.js" };
  });
}

type Bootstrap = typeof import("./bootstrap");
let bootstrap: Bootstrap;
const setComponentEditors: Bootstrap["setComponentEditors"] = (...args) => bootstrap.setComponentEditors(...args);
const hasComponentEditor: Bootstrap["hasComponentEditor"] = (ui) => bootstrap.hasComponentEditor(ui);

function registry() {
  return bootstrap.createDocumentSurfaceRegistry({
    onChange: vi.fn(), onSelectionChange: vi.fn(), onOpenWikilink: vi.fn(),
    onOpenPath: vi.fn(), onOpenDocument: vi.fn(), onSearchTag: vi.fn(),
    completions: { searchNotes: async () => [], listTags: async () => [] },
  });
}

const REQUESTS: Readonly<Record<string, SurfaceRequest>> = {
  canvas: { formatId: "canvas", sourceKind: "text", documentId: "Lavagna.canvas" },
  rich: { formatId: "docx", sourceKind: "bytes", documentId: "Lettera.docx" },
  spatial: { formatId: "svg", sourceKind: "text", documentId: "Schizzo.svg" },
  grid: { formatId: "xlsx", sourceKind: "bytes", documentId: "Conti.xlsx" },
  pdf: { formatId: null, sourceKind: "bytes", documentId: "Libro.pdf" },
};

const OFF = new Set(["editors/canvas", "editors/rich", "editors/grid", "editors/media", "editors/spatial"]);

describe("gli editor dei componenti", () => {
  // Moduli nuovi a ogni prova: un import di quella prima non conta per questa.
  beforeEach(async () => {
    vi.resetModules();
    mockEditors();
    imported.counts.clear();
    bootstrap = await import("./bootstrap");
  });

  it("spento, il codice dell'editor non si importa mai", async () => {
    const surfaces = registry();
    setComponentEditors(surfaces, (ui) => !OFF.has(ui));
    for (const request of Object.values(REQUESTS)) {
      await surfaces.load(request);
      // Senza il suo editor il file non è di nessuna famiglia che lo apra.
      expect(surfaces.resolve(request)?.family ?? "error").not.toMatch(/^(canvas|rich|grid)$/);
    }
    expect(surfaces.resolve(REQUESTS.pdf!)?.family).not.toBe("viewer");
    expect([...imported.counts.keys()]).toEqual([]);
  });

  it("registrarli non importa niente: il codice arriva col primo file, una volta", async () => {
    const surfaces = registry();
    setComponentEditors(surfaces, () => true);
    expect([...imported.counts.keys()]).toEqual([]);
    for (const request of Object.values(REQUESTS)) expect(surfaces.isLoaded(request)).toBe(false);

    await surfaces.load(REQUESTS.canvas!);
    expect(imported.counts.get("canvas")).toBe(1);
    expect(imported.counts.has("rich")).toBe(false);
    expect(surfaces.isLoaded(REQUESTS.canvas!)).toBe(true);
    const parent = document.createElement("div");
    expect(surfaces.mount(REQUESTS.canvas!, { paneId: "a", documentId: "Lavagna.canvas", parent }).family).toBe("canvas");

    await Promise.all(Object.values(REQUESTS).map((request) => surfaces.load(request)));
    await surfaces.load(REQUESTS.canvas!);
    expect(Object.fromEntries(imported.counts)).toEqual({ canvas: 1, rich: 1, spatial: 1, grid: 1, "grid-menu": 1, pdf: 1 });
  });

  it("spegnere toglie la registrazione, riaccendere la rimette senza un altro import", async () => {
    const surfaces = registry();
    await surfaces.load(REQUESTS.rich!);
    setComponentEditors(surfaces, (ui) => ui !== "editors/rich");
    expect(surfaces.resolve(REQUESTS.rich!)?.family).not.toBe("rich");
    expect(() => surfaces.mount(REQUESTS.rich!, { paneId: "a", documentId: "Lettera.docx", parent: document.createElement("div") }))
      .not.toThrow(/rich/);
    setComponentEditors(surfaces, () => true);
    expect(surfaces.resolve(REQUESTS.rich!)?.family).toBe("rich");
    await surfaces.load(REQUESTS.rich!);
    // Il modulo è già in memoria: la seconda registrazione lo riprende.
    expect(imported.counts.get("rich")).toBe(1);
  });

  it("le annotazioni di un PDF vogliono anche il lettore PDF", () => {
    const surfaces = registry();
    const fubann: SurfaceRequest = { formatId: "fubann", sourceKind: "text", documentId: "Libro.pdf.fubann" };
    setComponentEditors(surfaces, (ui) => ui !== "editors/media");
    expect(surfaces.resolve(fubann)?.profile).not.toBe("pdf");
    setComponentEditors(surfaces, () => true);
    expect(surfaces.resolve(fubann)).toMatchObject({ family: "canvas", profile: "pdf" });
  });

  it("ogni pezzo che la mappa dell'host nomina ha il suo caricatore", () => {
    const named = new Set(COMPONENTS_SCENARIO.mappe.flatMap((map) => map.righe.flatMap((row) => row.ui)));
    expect(named.size).toBeGreaterThan(0);
    for (const ui of named) expect(hasComponentEditor(ui), ui).toBe(true);
  });

  it("un pezzo sconosciuto si ignora e lo si dice nei log", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const surfaces = registry();
    setComponentEditors(surfaces, () => true, ["editors/sconosciuto", "editors/sconosciuto", "editors/text"]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]![0])).toContain("editors/sconosciuto");
    expect(imported.counts.size).toBe(0);
    warn.mockRestore();
  });
});
