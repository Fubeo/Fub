// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { createMermaidView, mountMermaidBlocks, registerMermaidRenderer, type MermaidView } from "./mermaid";
import { sourceElementAt } from "./markdown";
import { mountTree, unmountTree } from "./node";
import type { UiNode } from "../host/contract";

const renderer = vi.hoisted(() => ({ render: vi.fn(), initialize: vi.fn() }));
vi.mock("mermaid", () => ({ default: renderer }));
const mounted: MermaidView[] = [];
const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 40"><title>Flusso di lavoro</title><text x="0" y="20">A → B</text></svg>';
const linkedSvg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">
  <a href="https://example.test/guide"><text>Guide</text></a>
  <a xlink:href="mailto:team@example.test"><text>Email team</text></a>
  <a href="#section"><text>Section</text></a>
  <a href="http://example.test/"><text>Website</text></a>
  <a href="javascript:alert(1)"><text>Unsafe script</text></a>
  <a href="data:text/html,boom"><text>Unsafe data</text></a>
  <a href="file:///private"><text>Unsafe file</text></a>
  <a href="blob:payload"><text>Unsafe blob</text></a>
  <a href="fub-asset://localhost/1"><text>Unsafe asset</text></a>
  <a href="//example.test/"><text>Protocol relative</text></a>
  <a href="relative.md"><text>Relative path</text></a>
  <a href="https://"><text>Malformed URL</text></a>
  <a href="https://example.test/%zz"><text>Malformed escape</text></a>
  <a href="https://example.test/" xlink:href="javascript:alert(1)"><text>Conflicting target</text></a>
  <foreignObject><a xmlns="http://www.w3.org/1999/xhtml" href="https://example.test/hidden">HTML link</a></foreignObject>
  <script>alert(1)</script>
</svg>`;

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
  it("renders native diagram nodes and preserves fallback when the engine changes", async () => {
    registerMermaidRenderer();
    renderer.render.mockResolvedValue({ svg });
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:native");
    const revoke = vi.spyOn(URL, "revokeObjectURL");
    const root = document.createElement("div");
    document.body.append(root);
    const node = (engine: string, source: string): UiNode => ({
      node: "custom", ns: "fub:diagram", payload: { engine, source },
      fallback: [{ node: "text", content: source }],
    });
    try {
      mountTree(root, node("mermaid", "flowchart LR; A-->B"), () => {});
      await vi.waitFor(() => expect(root.querySelector("img")?.getAttribute("src")).toBe("blob:native"));
      mountTree(root, node("plantuml", "@startuml"), () => {});
      expect(root.querySelector("img")).toBeNull();
      expect(root.textContent).toBe("@startuml");
      expect(revoke).toHaveBeenCalledWith("blob:native");
      mountTree(root, node("mermaid", "flowchart LR; B-->C"), () => {});
      await vi.waitFor(() => expect(root.querySelector("img")?.getAttribute("src")).toBe("blob:native"));
    } finally {
      unmountTree(root);
    }
  });

  it("exposes only explicit safe SVG links as native, keyboard-reachable shell anchors", async () => {
    renderer.render.mockResolvedValueOnce({ svg: linkedSvg });
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:linked");
    const diagram = view("flowchart LR; A-->B");
    await vi.waitFor(() => expect(diagram.element.dataset.state).toBe("ready"));
    const nav = diagram.element.querySelector("nav")!;
    expect(nav.hidden).toBe(false);
    expect(nav.getAttribute("aria-label")).toBe("Link del diagramma");
    const anchors = Array.from(nav.querySelectorAll("a"));
    expect(anchors.map((anchor) => [anchor.textContent, anchor.getAttribute("href")])).toEqual([
      ["Guide", "https://example.test/guide"],
      ["Email team", "mailto:team@example.test"],
      ["Section", "#fub-contenuto-section"],
      ["Website", "http://example.test/"],
    ]);
    expect(anchors.every((anchor) => anchor.tabIndex === 0)).toBe(true);
    expect(anchors[0]?.target).toBe("_blank");
    expect(anchors[0]?.rel).toBe("noopener noreferrer");
    expect(anchors[1]?.hasAttribute("target")).toBe(false);
    const routed: string[] = [];
    diagram.element.addEventListener("click", (event) => {
      const anchor = (event.target as Element).closest("a");
      if (anchor) routed.push(anchor.getAttribute("href")!);
      event.preventDefault();
    });
    anchors[2]?.click();
    expect(routed).toEqual(["#fub-contenuto-section"]);
    expect(diagram.element.querySelector("svg, script, foreignObject")).toBeNull();
    expect(diagram.element.querySelector("code")?.textContent).toBe("flowchart LR; A-->B");
    diagram.destroy();
    expect(nav.querySelector("a")).toBeNull();
    expect(nav.hidden).toBe(true);
  });

  it("replaces links on theme rerender and discards stale rendering and failed diagrams", async () => {
    document.documentElement.dataset.theme = "dark";
    renderer.render.mockResolvedValueOnce({ svg: linkedSvg });
    let complete!: (value: { svg: string }) => void;
    renderer.render.mockImplementationOnce(() => new Promise((resolve) => { complete = resolve; }));
    renderer.render.mockRejectedValueOnce(new Error("Invalid diagram"));
    const callsBefore = renderer.render.mock.calls.length;
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:theme");
    const diagram = view("flowchart LR; A-->B");
    const nav = diagram.element.querySelector("nav")!;
    await vi.waitFor(() => expect(nav.querySelectorAll("a")).toHaveLength(4));
    document.documentElement.dataset.theme = "light";
    await vi.waitFor(() => expect(complete).toBeTypeOf("function"));
    expect(nav.querySelector("a")).toBeNull();
    document.documentElement.dataset.theme = "dark";
    complete({ svg: linkedSvg });
    await vi.waitFor(() => expect(diagram.element.dataset.state).toBe("error"));
    expect(renderer.render.mock.calls.length).toBe(callsBefore + 3);
    expect(diagram.element.querySelector("details")!.open).toBe(true);
    expect(diagram.element.querySelector("code")!.textContent).toBe("flowchart LR; A-->B");
    expect(nav.querySelector("a")).toBeNull();
    expect(nav.hidden).toBe(true);
  });

  it("cannot revive a destroyed diagram when rendering completes late", async () => {
    let complete!: (value: { svg: string }) => void;
    renderer.render.mockImplementationOnce(() => new Promise((resolve) => { complete = resolve; }));
    const createUrl = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:late");
    const diagram = view("flowchart LR; A-->B");
    await vi.waitFor(() => expect(complete).toBeTypeOf("function"));
    diagram.destroy();
    complete({ svg: linkedSvg });
    // Queue a second job to prove the first has settled without resurrecting it.
    renderer.render.mockResolvedValueOnce({ svg });
    const next = view("flowchart LR; B-->C");
    await vi.waitFor(() => expect(next.element.dataset.state).toBe("ready"));
    expect(diagram.element.querySelector("img")!.hasAttribute("src")).toBe(false);
    expect(createUrl).toHaveBeenCalledTimes(1);
    expect(diagram.element.querySelector("nav a")).toBeNull();
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
    renderer.render.mockResolvedValue({ svg: linkedSvg });
    vi.spyOn(URL, "createObjectURL").mockReturnValueOnce("blob:dark").mockReturnValueOnce("blob:light");
    const revoke = vi.spyOn(URL, "revokeObjectURL");
    const diagram = view("flowchart LR; A-->B");
    await vi.waitFor(() => expect(diagram.element.querySelector("img")!.getAttribute("src")).toBe("blob:dark"));
    expect(diagram.element.querySelectorAll("nav a")).toHaveLength(4);
    document.documentElement.dataset.theme = "light";
    await vi.waitFor(() => expect(diagram.element.querySelector("img")!.getAttribute("src")).toBe("blob:light"));
    expect(diagram.element.querySelectorAll("nav a")).toHaveLength(4);
    expect(revoke).toHaveBeenCalledWith("blob:dark");
    diagram.destroy();
    expect(revoke).toHaveBeenCalledWith("blob:light");
    expect(diagram.element.querySelector("img")!.hasAttribute("src")).toBe(false);
    expect(diagram.element.querySelector("nav a")).toBeNull();
  });

  it("keeps reading anchors and source mapping without converting ordinary code", () => {
    const container = document.createElement("div");
    container.innerHTML = '<pre id="fub-contenuto-diagram" data-md-from="8" data-md-to="48"><code class="language-mermaid">flowchart LR; A--&gt;B</code></pre><pre><code class="language-js">let x = 1;</code></pre>';
    const destroy = mountMermaidBlocks(container);
    const diagram = container.querySelector("figure")!;
    expect(sourceElementAt(container, 20)).toBe(diagram);
    expect(diagram.querySelector("code")!.textContent).toBe("flowchart LR; A-->B");
    expect(container.querySelector("pre > code.language-js")!.textContent).toBe("let x = 1;");
    destroy();
  });
});

describe("la larghezza naturale del diagramma", () => {
  const svg = (attrs: string) =>
    new DOMParser().parseFromString(`<svg xmlns="http://www.w3.org/2000/svg" ${attrs}></svg>`, "image/svg+xml");

  it("usa il max-width di mermaid, poi il viewBox, e rifiuta ciò che non è una misura", async () => {
    const { naturalWidth } = await import("./mermaid");
    expect(naturalWidth(svg('width="100%" style="max-width: 188.5px;" viewBox="0 0 188.5 70"'))).toBe(189);
    expect(naturalWidth(svg('viewBox="-8 -8 320 90"'))).toBe(320);
    expect(naturalWidth(svg('width="100%"'))).toBeNull();
  });
});
