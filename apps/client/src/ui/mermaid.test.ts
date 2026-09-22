// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { createMermaidView, mountMermaidBlocks, type MermaidView } from "./mermaid";
import { sourceBlockAt } from "../panels/preview";

const renderer = vi.hoisted(() => ({ render: vi.fn(), initialize: vi.fn() }));
vi.mock("mermaid", () => ({ default: renderer }));
const mounted: MermaidView[] = [];
const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 40"><title>Flusso di lavoro</title><text x="0" y="20">A → B</text></svg>';

function view(source: string): MermaidView {
  const diagram = createMermaidView(source);
  mounted.push(diagram);
  document.body.append(diagram.element);
  return diagram;
}

afterEach(() => {
  for (const diagram of mounted.splice(0)) diagram.destroy();
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe("Mermaid lifecycle", () => {
  it("cannot revive a destroyed diagram when rendering completes late", async () => {
    let complete!: (value: { svg: string }) => void;
    renderer.render.mockImplementationOnce(() => new Promise((resolve) => { complete = resolve; }));
    const createUrl = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:late");
    const diagram = view("flowchart LR; A-->B");
    await vi.waitFor(() => expect(complete).toBeTypeOf("function"));
    diagram.destroy();
    complete({ svg });
    // Queue a second job to prove the first has settled without resurrecting it.
    renderer.render.mockResolvedValueOnce({ svg });
    const next = view("flowchart LR; B-->C");
    await vi.waitFor(() => expect(next.element.dataset.state).toBe("ready"));
    expect(diagram.element.querySelector("img")!.hasAttribute("src")).toBe(false);
    expect(createUrl).toHaveBeenCalledTimes(1);
  });

  it("preserves invalid source and allows the next diagram to render", async () => {
    renderer.render.mockRejectedValueOnce(new Error("Parse error at line 2"));
    renderer.render.mockResolvedValueOnce({ svg });
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:valid");
    const invalid = view("flowchart LR\nA[unfinished");
    const valid = view("flowchart LR; A-->B");
    await vi.waitFor(() => expect(valid.element.dataset.state).toBe("ready"));
    expect(invalid.element.dataset.state).toBe("error");
    expect(invalid.element.querySelector("details")!.open).toBe(true);
    expect(invalid.element.querySelector("code")!.textContent).toBe("flowchart LR\nA[unfinished");
    expect(invalid.element.querySelector('[role="status"]')!.textContent).toContain("line 2");
    expect(valid.element.querySelector("img")!.alt).toBe("Flusso di lavoro");
    expect(valid.element.querySelector("svg")).toBeNull();
  });

  it("releases the old image after a theme change and the last one on teardown", async () => {
    document.documentElement.dataset.theme = "dark";
    renderer.render.mockResolvedValue({ svg });
    vi.spyOn(URL, "createObjectURL").mockReturnValueOnce("blob:dark").mockReturnValueOnce("blob:light");
    const revoke = vi.spyOn(URL, "revokeObjectURL");
    const diagram = view("flowchart LR; A-->B");
    await vi.waitFor(() => expect(diagram.element.querySelector("img")!.getAttribute("src")).toBe("blob:dark"));
    document.documentElement.dataset.theme = "light";
    await vi.waitFor(() => expect(diagram.element.querySelector("img")!.getAttribute("src")).toBe("blob:light"));
    expect(revoke).toHaveBeenCalledWith("blob:dark");
    diagram.destroy();
    expect(revoke).toHaveBeenCalledWith("blob:light");
    expect(diagram.element.querySelector("img")!.hasAttribute("src")).toBe(false);
  });

  it("keeps reading anchors and byte mapping without converting ordinary code", () => {
    const container = document.createElement("div");
    container.innerHTML = '<pre id="fub-contenuto-diagram" data-fub-source-start="8" data-fub-source-end="48"><code class="language-mermaid">flowchart LR; A--&gt;B</code></pre><pre><code class="language-js">let x = 1;</code></pre>';
    const destroy = mountMermaidBlocks(container);
    const diagram = container.querySelector("figure")!;
    expect(sourceBlockAt(container, 20)).toBe(diagram);
    expect(diagram.querySelector("code")!.textContent).toBe("flowchart LR; A-->B");
    expect(container.querySelector("pre > code.language-js")!.textContent).toBe("let x = 1;");
    destroy();
  });
});
