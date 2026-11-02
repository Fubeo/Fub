// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { FADED_OPACITY } from "../spatial/painter/svg-dom";
import { INK_ASPECT, INK_FADED_OPACITY, InkPathCache, paintBoard, paintCard, type DryStroke } from "./ink-paint";

const A: DryStroke = { id: "s1", path: "M0 0L10 0L10 10Z", fill: "#0072b2", ref: { width: 200, height: 100 } };
const B: DryStroke = { id: "s2", path: "M5 5L20 5L20 20Z", fill: "#d55e00", ref: { width: 200, height: 100 } };
const C: DryStroke = { id: "s3", path: "M1 1L2 1L2 2Z", fill: "#000000", ref: { width: 320, height: 240 } };

function cardElement(): HTMLElement {
  const host = document.createElement("div");
  host.className = "canvas-node";
  host.style.width = "200px";
  host.style.height = "100px";
  const content = document.createElement("div");
  content.className = "canvas-node-content";
  host.append(content);
  return host;
}

const layerOf = (host: Element, className: string) => host.querySelector<SVGSVGElement>(`:scope > svg.${className}`);

describe("l'inchiostro asciutto", () => {
  it("paintCard con due misure di riferimento fa due SVG annidati coi viewBox giusti", () => {
    const host = cardElement();
    paintCard(host, [A, B, C]);
    const svg = layerOf(host, "canvas-ink-card")!;
    expect(svg).not.toBeNull();
    expect(svg.getAttribute("width")).toBe("100%");
    expect(svg.getAttribute("height")).toBe("100%");
    expect(svg.getAttribute("aria-hidden")).toBe("true");
    // Dopo il contenuto della scheda: sopra di lui.
    expect(host.lastElementChild).toBe(svg);
    const nested = [...svg.children];
    expect(nested.map((each) => each.localName)).toEqual(["svg", "svg"]);
    expect(nested.map((each) => each.getAttribute("viewBox"))).toEqual(["0 0 200 100", "0 0 320 240"]);
    for (const each of nested) {
      expect(each.getAttribute("preserveAspectRatio")).toBe(INK_ASPECT);
      expect(each.getAttribute("width")).toBe("100%");
      expect(each.getAttribute("height")).toBe("100%");
    }
    expect(INK_ASPECT).toBe("none");
    const paths = [...nested[0]!.children];
    expect(paths.map((p) => [p.getAttribute("data-ink-stroke"), p.getAttribute("d"), p.getAttribute("fill")])).toEqual([
      ["s1", A.path, "#0072b2"],
      ["s2", B.path, "#d55e00"],
    ]);
    expect(nested[1]!.querySelector("path")!.getAttribute("fill")).toBe("#000000");
  });

  it("cambiare la misura dell'elemento non tocca i percorsi", () => {
    const host = cardElement();
    paintCard(host, [A, C]);
    const svg = layerOf(host, "canvas-ink-card")!;
    const before = [...svg.querySelectorAll("path")].map((p) => p.outerHTML);
    const observer = new MutationObserver(() => {});
    observer.observe(svg, { subtree: true, attributes: true, childList: true });
    // Come `#renderLive`: posizione e misura dell'elemento, nient'altro.
    host.style.transform = "translate(40px, 80px)";
    host.style.width = "400px";
    host.style.height = "50px";
    expect(observer.takeRecords()).toEqual([]);
    expect([...svg.querySelectorAll("path")].map((p) => p.outerHTML)).toEqual(before);
    expect([...svg.children].map((each) => each.getAttribute("viewBox"))).toEqual(["0 0 200 100", "0 0 320 240"]);
    observer.disconnect();
  });

  it("ridisegnare gli stessi tratti tiene gli stessi elementi senza riscriverli", () => {
    const host = cardElement();
    paintCard(host, [A, B]);
    const svg = layerOf(host, "canvas-ink-card")!;
    const paths = [...svg.querySelectorAll("path")];
    const observer = new MutationObserver(() => {});
    observer.observe(svg, { subtree: true, attributes: true, childList: true });
    paintCard(host, [{ ...A }, { ...B }]);
    expect(observer.takeRecords()).toEqual([]);
    expect(layerOf(host, "canvas-ink-card")).toBe(svg);
    expect([...svg.querySelectorAll("path")]).toEqual(paths);
    // Uno sbiadito cambia un attributo solo, del suo percorso.
    paintCard(host, [{ ...A, faded: true }, B]);
    const records = observer.takeRecords();
    expect(records.map((r) => [r.target, r.attributeName])).toEqual([[paths[0], "opacity"]]);
    expect(paths[0]!.getAttribute("opacity")).toBe(INK_FADED_OPACITY);
    paintCard(host, [A, B]);
    expect(paths[0]!.hasAttribute("opacity")).toBe(false);
    observer.disconnect();
  });

  it("l'opacità della gomma è quella del disegno", () => {
    expect(INK_FADED_OPACITY).toBe(FADED_OPACITY);
  });

  it("l'ordine dei tratti resta anche fra misure diverse; meno tratti tolgono il resto; nessun tratto toglie lo strato", () => {
    const host = cardElement();
    paintCard(host, [A, C, B]);
    const svg = layerOf(host, "canvas-ink-card")!;
    expect([...svg.children].map((each) => each.getAttribute("viewBox"))).toEqual(["0 0 200 100", "0 0 320 240", "0 0 200 100"]);
    expect([...svg.querySelectorAll("path")].map((p) => p.getAttribute("data-ink-stroke"))).toEqual(["s1", "s3", "s2"]);
    paintCard(host, [A]);
    expect(svg.children).toHaveLength(1);
    expect(svg.querySelectorAll("path")).toHaveLength(1);
    paintCard(host, []);
    expect(layerOf(host, "canvas-ink-card")).toBeNull();
    expect(host.children).toHaveLength(1);
  });

  it("un tratto senza misura dato a una scheda sta in pixel della scheda", () => {
    const host = cardElement();
    paintCard(host, [{ ...A, ref: null }]);
    const nested = layerOf(host, "canvas-ink-card")!.firstElementChild!;
    expect(nested.hasAttribute("viewBox")).toBe(false);
    expect(nested.hasAttribute("preserveAspectRatio")).toBe(false);
  });

  it("paintBoard mette l'inchiostro libero dopo le schede, in coordinate della lavagna", () => {
    const stage = document.createElement("div");
    stage.append(cardElement());
    const free: DryStroke = { id: "s9", path: "M-50 -50L0 0Z", fill: "#009e73", ref: null };
    paintBoard(stage, [free]);
    const svg = layerOf(stage, "canvas-ink-board")!;
    expect(stage.lastElementChild).toBe(svg);
    expect(svg.hasAttribute("viewBox")).toBe(false);
    expect(svg.querySelector("path")!.getAttribute("d")).toBe(free.path);
    // Una scheda aggiunta dopo: l'inchiostro torna in fondo, con lo stesso
    // percorso.
    const path = svg.querySelector("path");
    stage.append(cardElement());
    paintBoard(stage, [free]);
    expect(stage.lastElementChild).toBe(svg);
    expect(svg.querySelector("path")).toBe(path);
    paintBoard(stage, []);
    expect(layerOf(stage, "canvas-ink-board")).toBeNull();
  });
});

describe("la cache dei percorsi", () => {
  it("un tratto uguale non si ricalcola; uno cambiato sì", () => {
    const cache = new InkPathCache();
    const compute = vi.fn(() => "M0 0Z");
    expect(cache.path("s1", "ink-a", "pf1 size=4", compute)).toBe("M0 0Z");
    cache.sweep();
    expect(cache.path("s1", "ink-a", "pf1 size=4", compute)).toBe("M0 0Z");
    expect(compute).toHaveBeenCalledTimes(1);
    cache.path("s1", "ink-b", "pf1 size=4", compute);
    cache.path("s1", "ink-a", "pf1 size=8", compute);
    expect(compute).toHaveBeenCalledTimes(3);
  });

  it("lo stesso id in due livelli tiene due percorsi", () => {
    const cache = new InkPathCache();
    const compute = vi.fn((d: string) => d);
    for (let round = 0; round < 3; round++) {
      cache.path("s1", "ink-a", "b", () => compute("A"));
      cache.path("s1", "ink-b", "b", () => compute("B"));
      cache.sweep();
    }
    expect(compute).toHaveBeenCalledTimes(2);
    expect(cache.size).toBe(2);
  });

  it("a ogni giro lascia andare ciò che non si disegna più", () => {
    const cache = new InkPathCache();
    const compute = vi.fn(() => "M0 0Z");
    cache.path("s1", "ink-a", "b", compute);
    cache.path("s2", "ink-a", "b", compute);
    cache.sweep();
    expect(cache.size).toBe(2);
    cache.path("s1", "ink-a", "b", compute);
    cache.sweep();
    expect(cache.size).toBe(1);
    cache.sweep();
    expect(cache.size).toBe(0);
    cache.path("s1", "ink-a", "b", compute);
    expect(compute).toHaveBeenCalledTimes(3);
  });
});
