// @vitest-environment happy-dom
// La superficie del disegno caricata quando serve: ciò che la shell dice prima
// che il codice arrivi raggiunge la superficie vera, e un caricamento fallito
// lascia il testo alla sessione e lo dice.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EditorSurface } from "../core/registry";
import { notify } from "../../ui/notify";
import { mountVectorSurfaceLazily } from "./lazy";
import { doc } from "./scene/test-support";
import { LAYER } from "./tools/test-support";

vi.mock("../../ui/notify", () => ({ notify: vi.fn() }));

type SurfaceModule = typeof import("./surface");

const SOURCE = doc(
  `<title>Casa</title>${LAYER}<rect id="o1a2b3c4d" x="60" y="60" width="20" height="20" fill="none" stroke="#000000" stroke-width="2"/></g>`,
);
const FOREIGN = SOURCE.replace(' fub:version="1"', "");

let parent: HTMLElement;
let surface: EditorSurface | null;
let loader: { resolve(module: SurfaceModule): void; reject(error: unknown): void };

function mount(): EditorSurface {
  const promise = new Promise<SurfaceModule>((resolve, reject) => {
    loader = { resolve, reject };
  });
  surface = mountVectorSurfaceLazily(
    { paneId: "p1", documentId: "disegni/casa.svg", parent },
    { onChange: () => {}, onSelectionChange: () => {} },
    () => promise,
  );
  return surface;
}

/// Il codice arriva, e la superficie si monta.
async function arrive(): Promise<void> {
  loader.resolve(await import("./surface"));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

async function fail(error: unknown): Promise<void> {
  loader.reject(error);
  await new Promise((resolve) => setTimeout(resolve, 0));
}

const at = (text: string, marker: string): number => new TextEncoder().encode(text.slice(0, text.indexOf(marker))).length + 1;

beforeEach(() => {
  parent = document.createElement("div");
  document.body.append(parent);
  surface = null;
  vi.mocked(notify).mockClear();
});

afterEach(() => {
  surface?.destroy();
  parent.remove();
});

describe("prima che il codice arrivi", () => {
  it("il riquadro aspetta, e tiene il testo della sessione", () => {
    const lazy = mount();
    expect(lazy.modes.map((mode) => mode.id)).toEqual(["draw", "read"]);
    expect(lazy.defaultMode).toBe("draw");
    // Gli export del profilo ci sono già: il menu del riquadro non aspetta il
    // codice del disegno.
    expect(lazy.exports?.map((offered) => offered.target)).toEqual(["draw.png", "draw.pdf"]);
    lazy.buffer!.setDoc(SOURCE);
    const pending = parent.querySelector<HTMLElement>(".vector-pending")!;
    expect(pending.getAttribute("aria-busy")).toBe("true");
    expect(pending.querySelector<HTMLElement>(".vector-notice")!.hidden).toBe(true);
    expect(lazy.buffer!.getDoc()).toBe(SOURCE);
    lazy.buffer!.syncDoc(FOREIGN);
    expect(lazy.buffer!.getDoc()).toBe(FOREIGN);
    expect(lazy.selections!()).toBeUndefined();
    expect(lazy.selectedText!()).toBeNull();
    lazy.focus!();
    expect(document.activeElement).toBe(pending);
    expect(() => lazy.setMode("source")).toThrow(RangeError);
  });

  it("modalità, sola lettura e fuoco passano alla superficie vera", async () => {
    const lazy = mount();
    lazy.buffer!.setDoc(FOREIGN);
    lazy.setMode("read");
    lazy.setReadOnly!(true);
    lazy.focus!();
    await arrive();
    expect(parent.querySelector(".vector-pending")).toBeNull();
    const root = parent.querySelector<HTMLElement>(".vector-surface")!;
    expect(root.dataset.mode).toBe("read");
    expect(lazy.buffer!.getDoc()).toBe(FOREIGN);
    // Il fuoco era nel segnaposto: passa alla parte che si vede, il palco.
    expect(root.querySelector(".vector-read")!.contains(document.activeElement)).toBe(true);
    lazy.setMode("draw");
    // In sola lettura un SVG estraneo non offre «Modifica».
    expect(root.querySelector<HTMLElement>(".vector-notice-action")!.hidden).toBe(true);
  });

  it("un rimando aspetta la scena, e la sceglie", async () => {
    const lazy = mount();
    lazy.buffer!.setDoc(SOURCE);
    const point = at(SOURCE, "<rect");
    expect(lazy.reveal!({ span: { start: point, end: point } })).toBe(true);
    await arrive();
    expect(lazy.selectedText!()!.primary).toMatch(/^<rect id="o1a2b3c4d"/);
    expect(notify).not.toHaveBeenCalled();
  });

  it("un rimando che la scena non raggiunge lo dice con le parole della shell", async () => {
    const lazy = mount();
    lazy.buffer!.setDoc(SOURCE);
    const point = at(SOURCE, "<title>");
    expect(lazy.reveal!({ span: { start: point, end: point } })).toBe(true);
    await arrive();
    expect(notify).toHaveBeenCalledWith("Questa vista di casa non sa portare a quel punto.", "info");
  });

  it("chiuso prima, non monta niente", async () => {
    const lazy = mount();
    lazy.buffer!.setDoc(SOURCE);
    lazy.destroy();
    surface = null;
    await arrive();
    expect(parent.childElementCount).toBe(0);
  });
});

describe("dopo", () => {
  it("tutto passa alla superficie vera", async () => {
    const lazy = mount();
    await arrive();
    lazy.buffer!.setDoc(SOURCE);
    expect(parent.querySelectorAll(".vector-surface")).toHaveLength(1);
    expect(parent.querySelector(".draw-surface [data-scene-id='o1a2b3c4d']")).not.toBeNull();
    lazy.buffer!.syncDoc(SOURCE.replace('x="60"', 'x="70"'));
    expect(lazy.buffer!.getDoc()).toContain('x="70"');
    lazy.focus!();
    expect(document.activeElement).toBe(parent.querySelector(".draw-surface"));
    lazy.destroy();
    surface = null;
    expect(parent.childElementCount).toBe(0);
  });

  it("un caricamento fallito lo dice, e il testo resta della sessione", async () => {
    const lazy = mount();
    lazy.buffer!.setDoc(SOURCE);
    await fail(new Error("rete assente"));
    const pending = parent.querySelector<HTMLElement>(".vector-pending")!;
    expect(pending.hasAttribute("aria-busy")).toBe(false);
    expect(pending.querySelector<HTMLElement>(".vector-notice")!.hidden).toBe(false);
    expect(pending.querySelector(".vector-notice-text")!.textContent).toBe(
      "L’editor del disegno non si è caricato: rete assente. «Apri come sorgente» ne mostra il testo.",
    );
    expect(notify).toHaveBeenCalledWith("rete assente", "guasto");
    lazy.buffer!.syncDoc(FOREIGN);
    expect(lazy.buffer!.getDoc()).toBe(FOREIGN);
  });
});
