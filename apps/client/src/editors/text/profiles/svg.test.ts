// @vitest-environment happy-dom
// Il profilo SVG: la verifica del sorgente, i tre modi, e l'anteprima che
// cambia soltanto quando la versione nuova si disegna davvero — provata fuori
// schermo, col suo URL revocato quando non serve più.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { checkSvg, mountSvgSurface, parseProblem, problemText, SVG_PREVIEW_MS } from "./svg";
import type { EditorSurface } from "../../core/registry";
import { setReducedMotionPreference } from "../../../theme/reduced-motion";

const GOOD = '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80"><rect width="10" height="10"/></svg>';
const BETTER = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 32"><circle r="4"/></svg>';

describe("la verifica di un sorgente SVG", () => {
  it("accetta un SVG con le sue misure, anche dopo il prologo XML", () => {
    expect(checkSvg(GOOD)).toEqual({ ok: true, size: { width: 120, height: 80 } });
    expect(checkSvg(`﻿<?xml version="1.0"?>\n<!-- licenza -->\n${BETTER}`))
      .toEqual({ ok: true, size: { width: 64, height: 32 } });
  });

  it("dice riga, colonna e motivo di un XML rotto", () => {
    const check = checkSvg('<svg xmlns="http://www.w3.org/2000/svg">\n  <g>\n</svg>');
    expect(check.ok).toBe(false);
    if (check.ok) return;
    expect(check.problem).toMatchObject({ kind: "parse", line: 3, column: expect.any(Number) });
    expect(problemText(check.problem)).toMatch(/^SVG non valido alla riga 3, colonna \d+: .*mismatch/);
  });

  it("distingue una radice che non è svg e uno spazio dei nomi mancante", () => {
    expect(checkSvg("<html><body/></html>")).toEqual({ ok: false, problem: { kind: "root" } });
    expect(checkSvg("")).toEqual({ ok: false, problem: { kind: "root" } });
    expect(checkSvg("<svg><rect/></svg>")).toEqual({ ok: false, problem: { kind: "namespace" } });
    expect(problemText({ kind: "namespace" })).toContain('xmlns="http://www.w3.org/2000/svg"');
  });

  it("legge il messaggio di Gecko, e senza coordinate tiene il motivo", () => {
    expect(parseProblem("XML Parsing Error: mismatched tag. Expected: </g>.\nLocation: blob:x\nLine Number 4, Column 9:"))
      .toEqual({ kind: "parse", line: 4, column: 9, reason: "mismatched tag. Expected: </g>." });
    const unplaced = parseProblem("qualcosa è andato storto");
    expect(unplaced).toEqual({ kind: "parse", line: null, column: null, reason: "qualcosa è andato storto" });
    expect(problemText(unplaced)).toBe("SVG non valido: qualcosa è andato storto");
  });
});

describe("la superficie SVG", () => {
  let urls = 0;
  const blobs = new Map<string, Blob>();
  /// Ogni `<img>` a cui si è dato un `src`: la prova fuori schermo e la vista.
  const images: HTMLImageElement[] = [];
  let parent: HTMLElement;
  let surface: EditorSurface | null = null;

  beforeEach(() => {
    setReducedMotionPreference(true);
    urls = 0;
    blobs.clear();
    images.length = 0;
    vi.spyOn(URL, "createObjectURL").mockImplementation((blob) => {
      const url = `blob:svg-${++urls}`;
      blobs.set(url, blob as Blob);
      return url;
    });
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    const src = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, "src")!;
    vi.spyOn(HTMLImageElement.prototype, "src", "set").mockImplementation(function (this: HTMLImageElement, value: string) {
      images.push(this);
      src.set!.call(this, value);
    });
    parent = document.createElement("div");
    parent.className = "pane-editor";
    document.body.append(parent);
  });

  afterEach(() => {
    surface?.destroy();
    surface = null;
    document.body.replaceChildren();
    setReducedMotionPreference(false);
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  function mount(): EditorSurface {
    surface = mountSvgSurface(
      { paneId: "p1", documentId: "arte/logo.svg", parent },
      { onChange: vi.fn(), onSelectionChange: vi.fn() },
    );
    return surface;
  }

  /// La prova fuori schermo più recente: l'`<img>` che non sta nel documento.
  function probe(): HTMLImageElement {
    const offscreen = images.filter((image) => !image.isConnected);
    const found = offscreen[offscreen.length - 1];
    if (!found) throw new Error("nessuna prova in corso");
    return found;
  }

  function shown(): string | null {
    return parent.querySelector<HTMLImageElement>(".zoom-content")?.getAttribute("src") ?? null;
  }

  function status(): HTMLElement {
    return parent.querySelector<HTMLElement>(".svg-error")!;
  }

  it("dichiara i tre modi con gli id di Markdown, e parte da Diviso", () => {
    const mounted = mount();
    expect(mounted.family).toBe("text");
    expect(mounted.profile).toBe("svg");
    expect(mounted.modes.map((mode) => [mode.id, mode.label(), mode.presentation])).toEqual([
      ["source", "Sorgente", "surface"],
      ["live_preview", "Diviso", "surface"],
      ["reading", "Anteprima", "rendered"],
    ]);
    expect(mounted.defaultMode).toBe("live_preview");
    mounted.setMode("reading");
    expect(parent.dataset.svgMode).toBe("reading");
    expect(() => mounted.setMode("slides")).toThrow(RangeError);
    expect(parent.querySelector(".svg-preview")?.getAttribute("aria-label")).toBe("Anteprima di logo.svg");
  });

  it("disegna il buffer da un Blob, e lo mostra solo quando la prova si è caricata", async () => {
    const mounted = mount();
    mounted.buffer!.setDoc(GOOD);
    expect(shown()).toBeNull();
    const first = probe();
    expect(first.getAttribute("src")).toBe("blob:svg-1");
    expect(blobs.get("blob:svg-1")?.type).toBe("image/svg+xml");
    expect(await blobs.get("blob:svg-1")!.text()).toBe(GOOD);

    first.dispatchEvent(new Event("load"));
    expect(shown()).toBe("blob:svg-1");
    expect(status().hidden).toBe(true);
    expect(parent.querySelector(".zoom-info")?.textContent).toMatch(/^SVG · 120 × 80 px · /);
  });

  it("aspetta la pausa, poi scambia la versione e revoca quella di prima", () => {
    vi.useFakeTimers();
    const mounted = mount();
    mounted.buffer!.setDoc(GOOD);
    probe().dispatchEvent(new Event("load"));

    mounted.buffer!.syncDoc(`${GOOD}\n`);
    mounted.buffer!.syncDoc(BETTER);
    vi.advanceTimersByTime(SVG_PREVIEW_MS - 1);
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    expect(URL.createObjectURL).toHaveBeenCalledTimes(2);
    expect(URL.revokeObjectURL).not.toHaveBeenCalledWith("blob:svg-1");

    probe().dispatchEvent(new Event("load"));
    expect(shown()).toBe("blob:svg-2");
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:svg-1");
  });

  it("un sorgente rotto lascia l'ultima versione buona, attenuata, col motivo accanto", () => {
    vi.useFakeTimers();
    const mounted = mount();
    mounted.buffer!.setDoc(GOOD);
    probe().dispatchEvent(new Event("load"));

    mounted.buffer!.syncDoc('<svg xmlns="http://www.w3.org/2000/svg">\n<g>\n</svg>');
    vi.advanceTimersByTime(SVG_PREVIEW_MS);
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
    expect(shown()).toBe("blob:svg-1");
    expect(status().hidden).toBe(false);
    expect(status().getAttribute("role")).toBe("status");
    expect(status().textContent).toMatch(/riga 3/);
    expect(parent.querySelector(".svg-preview")!.hasAttribute("data-stale")).toBe(true);

    mounted.buffer!.syncDoc(BETTER);
    vi.advanceTimersByTime(SVG_PREVIEW_MS);
    probe().dispatchEvent(new Event("load"));
    expect(status().hidden).toBe(true);
    expect(parent.querySelector(".svg-preview")!.hasAttribute("data-stale")).toBe(false);
  });

  it("una versione che il browser non disegna lo dice e rilascia il suo URL", () => {
    const mounted = mount();
    mounted.buffer!.setDoc(GOOD);
    probe().dispatchEvent(new Event("error"));
    expect(shown()).toBeNull();
    expect(status().textContent).toBe("Il browser non riesce a disegnare questa versione dell'SVG.");
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:svg-1");
  });

  it("in Sorgente non disegna niente; tornando all'anteprima disegna subito", () => {
    vi.useFakeTimers();
    const mounted = mount();
    mounted.setMode("source");
    mounted.buffer!.setDoc(GOOD);
    mounted.buffer!.syncDoc(BETTER);
    vi.advanceTimersByTime(SVG_PREVIEW_MS * 4);
    expect(URL.createObjectURL).not.toHaveBeenCalled();

    mounted.setMode("reading");
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
    expect(blobs.get("blob:svg-1")).toBeDefined();
  });

  it("smontata, revoca ciò che mostrava e ciò che provava, e non lascia timer", () => {
    vi.useFakeTimers();
    const mounted = mount();
    mounted.buffer!.setDoc(GOOD);
    probe().dispatchEvent(new Event("load"));
    mounted.buffer!.syncDoc(BETTER);
    vi.advanceTimersByTime(SVG_PREVIEW_MS);
    mounted.buffer!.syncDoc(GOOD);

    mounted.destroy();
    surface = null;
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:svg-1");
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:svg-2");
    expect(vi.getTimerCount()).toBe(0);
    expect(parent.dataset.svgMode).toBeUndefined();
    expect(parent.querySelector(".svg-preview, .cm-editor")).toBeNull();
  });
});
