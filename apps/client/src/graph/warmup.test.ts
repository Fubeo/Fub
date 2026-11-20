// @vitest-environment happy-dom
// Il grafo scaldato a riposo: due passi, l'atlas che il pittore vero riprende,
// e niente che resti nella pagina.
import { afterEach, describe, expect, it, vi } from "vitest";
import { RADIUS_BUCKETS, atlasFor, readTints } from "./render/atlas";
import { warmGraph } from "./warmup";
import structure from "../theme/scrittoio/structure.css?raw";

const frame = (run: () => void): void => void setTimeout(run, 0);

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

describe("warmGraph", () => {
  it("cuoce l'atlas al primo passo e monta un grafico invisibile al secondo", async () => {
    const seen: string[] = [];
    const next = vi.fn(async () => {
      const host = document.querySelector<HTMLElement>(".graph-warmup");
      seen.push(host === null ? "senza host" : `host ${host.querySelectorAll("canvas").length} canvas`);
    });
    await warmGraph(next, { frame });
    expect(seen).toEqual(["senza host", "host 0 canvas"]);
    expect(document.querySelector(".graph-warmup"), "l'host se ne va").toBeNull();
    expect(document.querySelectorAll("canvas")).toHaveLength(0);

    // Il pittore vero, con i colori della pagina, non lo ricuoce.
    const host = document.createElement("div");
    document.body.append(host);
    const create = vi.spyOn(document, "createElement");
    atlasFor(readTints(host), RADIUS_BUCKETS);
    expect(create).not.toHaveBeenCalled();
  });

  it("monta il grafico per qualche fotogramma, fuori vista e irraggiungibile", async () => {
    let during: HTMLElement | null = null;
    await warmGraph(async () => {}, {
      frame: (run) => {
        during ??= document.querySelector<HTMLElement>(".graph-warmup");
        expect(during?.querySelectorAll("canvas").length).toBe(2);
        setTimeout(run, 0);
      },
    });
    const host = during as HTMLElement | null;
    expect(host).not.toBeNull();
    expect(host!.getAttribute("aria-hidden")).toBe("true");
    expect(host!.inert).toBe(true);
    expect(host!.className).toBe("graph-warmup");
    expect(host!.getAttribute("style"), "niente stile in linea: lo dà la struttura").toBeNull();
    const rule = structure.match(/\.graph-warmup \{([^}]*)\}/)?.[1] ?? "";
    expect(rule).toContain("opacity: 0;");
    expect(rule).toContain("pointer-events: none;");
  });

  it("un passo che rifiuta lascia la pagina com'era", async () => {
    let steps = 0;
    await expect(
      warmGraph(async () => {
        steps += 1;
        if (steps === 2) throw new Error("fermo");
      }, { frame }),
    ).rejects.toThrow("fermo");
    expect(document.querySelector(".graph-warmup")).toBeNull();
  });

  // Lo stato «grafo già aperto» è del modulo e dura la sessione: ogni caso
  // qui sotto prende un modulo nuovo, e i casi sopra restano com'erano.
  it("con un grafo vero già aperto non cuoce e non monta niente", async () => {
    vi.resetModules();
    const fresh = await import("./warmup");
    fresh.noteGraphOpened();
    const next = vi.fn(async () => {});
    const append = vi.spyOn(document.body, "append");
    await fresh.warmGraph(next, { frame });
    expect(next).toHaveBeenCalledTimes(1);
    expect(append).not.toHaveBeenCalled();
    expect(document.querySelectorAll("canvas")).toHaveLength(0);
  });

  it("un grafo vero aperto durante l'attesa ferma il passo del grafico", async () => {
    vi.resetModules();
    const fresh = await import("./warmup");
    let steps = 0;
    const frames = vi.fn((run: () => void) => void setTimeout(run, 0));
    await fresh.warmGraph(async () => {
      steps += 1;
      if (steps === 2) fresh.noteGraphOpened();
    }, { frame: frames });
    expect(steps).toBe(2);
    expect(frames, "il grafico d'esercizio non si monta").not.toHaveBeenCalled();
    expect(document.querySelector(".graph-warmup"), "l'host se ne va").toBeNull();
  });
});
