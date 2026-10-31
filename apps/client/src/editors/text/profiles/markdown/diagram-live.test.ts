// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MermaidView } from "../../../../ui/mermaid";
import { DIAGRAM_QUIET_MS, DiagramLive, fenceBody } from "./diagram-live";

// La corsa del diagramma (C5): una resa vecchia non sostituisce la nuova, e
// un errore non toglie l'ultimo disegno buono.

function fakes() {
  const made: { source: string; view: MermaidView; destroyed: boolean }[] = [];
  const make = (source: string): MermaidView => {
    const element = document.createElement("figure");
    element.dataset.state = "loading";
    const status = document.createElement("p");
    status.setAttribute("role", "status");
    element.append(status);
    const entry = { source, destroyed: false, view: { element, destroy: () => { entry.destroyed = true; } } };
    made.push(entry);
    return entry.view;
  };
  return { made, make };
}
const settle = () => new Promise((done) => setTimeout(done, 0));
const finish = (view: MermaidView, state: "ready" | "error", reason = "") => {
  view.element.querySelector('[role="status"]')!.textContent = reason;
  view.element.dataset.state = state;
};

afterEach(() => {
  vi.useRealTimers();
  document.body.replaceChildren();
});

describe("il corpo del recinto", () => {
  it("toglie le righe dei recinti", () => {
    expect(fenceBody("```mermaid\ngraph TD\nA-->B\n```")).toBe("graph TD\nA-->B");
    expect(fenceBody("```mermaid\ngraph TD")).toBe("graph TD");
  });
});

describe("la corsa delle rese", () => {
  it("disegna dopo la quiete, una volta sola per una raffica", () => {
    vi.useFakeTimers();
    const { made, make } = fakes();
    const root = document.createElement("div");
    const live = new DiagramLive(root, "a", () => {}, make);
    live.schedule("ab");
    live.schedule("abc");
    vi.advanceTimersByTime(DIAGRAM_QUIET_MS - 1);
    expect(made.map((m) => m.source)).toEqual(["a"]);
    vi.advanceTimersByTime(1);
    expect(made.map((m) => m.source)).toEqual(["a", "abc"]);
    live.dispose();
    expect(made.every((m) => m.destroyed)).toBe(true);
  });

  it("una resa vecchia che finisce dopo la nuova non la sostituisce", async () => {
    vi.useFakeTimers();
    const { made, make } = fakes();
    const root = document.createElement("div");
    document.body.append(root);
    const live = new DiagramLive(root, "uno", () => {}, make);
    live.schedule("due");
    vi.advanceTimersByTime(DIAGRAM_QUIET_MS);
    vi.useRealTimers();
    const [first, second] = made;
    finish(second!.view, "ready");
    await settle();
    finish(first!.view, "ready");
    await settle();
    expect(root.contains(second!.view.element)).toBe(true);
    expect(root.contains(first!.view.element)).toBe(false);
    expect(second!.view.element.classList.contains("cm-fub-diagram-trying")).toBe(false);
    live.dispose();
  });

  it("con un errore resta l'ultimo disegno buono, e l'avviso lo dice", async () => {
    vi.useFakeTimers();
    const { made, make } = fakes();
    const root = document.createElement("div");
    document.body.append(root);
    const live = new DiagramLive(root, "buono", () => {}, make);
    vi.useRealTimers();
    finish(made[0]!.view, "ready");
    await settle();
    vi.useFakeTimers();
    live.schedule("sbagliato");
    vi.advanceTimersByTime(DIAGRAM_QUIET_MS);
    vi.useRealTimers();
    finish(made[1]!.view, "error", "Parse error");
    await settle();
    expect(root.contains(made[0]!.view.element)).toBe(true);
    expect(root.contains(made[1]!.view.element)).toBe(false);
    expect(live.notice.hidden).toBe(false);
    expect(live.notice.textContent).toContain("Parse error");
    live.dispose();
  });
});
