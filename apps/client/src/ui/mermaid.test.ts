// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { createMermaidView, forgetMermaidRenders, mountMermaidBlocks, registerMermaidRenderer, type MermaidView } from "./mermaid";
import { sourceElementAt } from "../editors/text/profiles/markdown/mount";
import { renderMarkdown } from "../editors/text/profiles/markdown/render";
import { mountTree, unmountTree } from "./node";
import type { UiNode } from "../host/contract";
import { closeContextMenu } from "./menu";
import { closeLightbox } from "./lightbox";
import { setReducedMotionPreference } from "../theme/reduced-motion";
import { paletteFor } from "./mermaid-styles";
import { diagramStylePreference, setDiagramStylePreference } from "../theme/diagram-style";

const renderer = vi.hoisted(() => ({ render: vi.fn(), initialize: vi.fn() }));
vi.mock("mermaid", () => ({ default: renderer }));
const ipc = vi.hoisted(() => ({
  setSetting: vi.fn(async (_key: string, _value: unknown) => {}),
  saveArtifact: vi.fn(async (_name: string, _type: string, _bytes: readonly number[]) =>
    ({ status: "saved" as const, path: "/esportati/diagramma.svg" })),
}));
vi.mock("../host/ipc", () => ({ api: ipc }));
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
  closeContextMenu();
  for (const diagram of mounted.splice(0)) diagram.destroy();
  document.body.replaceChildren();
  delete document.documentElement.dataset.contrast;
  forgetMermaidRenders();
  setDiagramStylePreference(undefined);
  ipc.setSetting.mockClear();
  ipc.saveArtifact.mockClear();
  vi.restoreAllMocks();
});

/// L'ultima configurazione data a Mermaid.
function lastConfig(): Record<string, unknown> & { themeVariables: Record<string, unknown> } {
  return renderer.initialize.mock.calls[renderer.initialize.mock.calls.length - 1]![0];
}

function menuItems(role: string): HTMLButtonElement[] {
  return [...document.querySelectorAll<HTMLButtonElement>(`#context-menu [role="${role}"]`)];
}

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
    // Tornare al buio ritroverebbe la resa in cache: il terzo aspetto è il
    // contrasto alto, che si ridisegna e fallisce.
    document.documentElement.dataset.contrast = "high";
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
    container.innerHTML = '<pre id="fub-contenuto-diagram" data-md-from="8" data-md-to="48" data-declared-fence><code class="language-mermaid">flowchart LR; A--&gt;B</code></pre><pre><code class="language-js">let x = 1;</code></pre>';
    const destroy = mountMermaidBlocks(container);
    const diagram = container.querySelector("figure")!;
    expect(sourceElementAt(container, 20)).toBe(diagram);
    expect(diagram.querySelector("code")!.textContent).toBe("flowchart LR; A-->B");
    expect(container.querySelector("pre > code.language-js")!.textContent).toBe("let x = 1;");
    destroy();
  });

  // I78: with the diagrams syntax off for the vault the fence is not declared,
  // and it stays code instead of turning into a diagram anyway.
  it("leaves an undeclared mermaid fence as code", () => {
    const container = document.createElement("div");
    container.innerHTML = renderMarkdown("```mermaid\nflowchart LR; A-->B\n```\n", []).html;
    const destroy = mountMermaidBlocks(container);
    expect(container.querySelector("figure")).toBeNull();
    expect(container.querySelector("pre > code.language-mermaid")!.textContent).toBe("flowchart LR; A-->B");
    destroy();
    container.innerHTML = renderMarkdown("```mermaid\nflowchart LR; A-->B\n```\n").html;
    const declared = mountMermaidBlocks(container);
    expect(container.querySelector("figure")).not.toBeNull();
    declared();
  });
});

describe("gli stili dei diagrammi", () => {
  it("disegna con lo stile scelto e ridisegna quando la scelta cambia", async () => {
    document.documentElement.dataset.theme = "dark";
    setDiagramStylePreference("aurora");
    renderer.render.mockResolvedValue({ svg });
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:stile");
    const diagram = view("flowchart LR; A-->B");
    await vi.waitFor(() => expect(diagram.element.dataset.state).toBe("ready"));
    expect(diagram.element.dataset.diagramStyle).toBe("aurora");
    expect(lastConfig().theme).toBe("base");
    expect(lastConfig().themeVariables.primaryColor).toBe(paletteFor("aurora", "dark").primary.fill);
    // La carta di Aurora allarga il disegno del suo margine.
    expect(diagram.element.querySelector("img")!.width).toBeGreaterThan(100);
    const calls = renderer.render.mock.calls.length;
    setDiagramStylePreference("blueprint");
    await vi.waitFor(() => expect(renderer.render.mock.calls.length).toBe(calls + 1));
    await vi.waitFor(() => expect(diagram.element.dataset.state).toBe("ready"));
    expect(diagram.element.dataset.diagramStyle).toBe("blueprint");
    expect(String(lastConfig().fontFamily)).toContain("JetBrains Mono");
    expect(diagram.element.querySelector(".mermaid-action")!.getAttribute("aria-label"))
      .toBe("Stile del diagramma: Blueprint");
  });

  it("lo stile scritto nel sorgente vince sulla scelta generale", async () => {
    document.documentElement.dataset.theme = "light";
    setDiagramStylePreference("aurora");
    renderer.render.mockResolvedValue({ svg });
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:suo");
    const diagram = view("%% stile: inchiostro\nflowchart LR; A-->B");
    await vi.waitFor(() => expect(diagram.element.dataset.state).toBe("ready"));
    expect(diagram.element.dataset.diagramStyle).toBe("inchiostro");
    expect(lastConfig().themeVariables.primaryBorderColor).toBe(paletteFor("inchiostro", "light").primary.border);
    const calls = renderer.render.mock.calls.length;
    setDiagramStylePreference("blueprint");
    await Promise.resolve();
    expect(renderer.render.mock.calls.length).toBe(calls);
    expect(diagram.element.querySelector(".mermaid-action")!.getAttribute("aria-label"))
      .toBe("Stile di questo diagramma: Inchiostro");
  });

  it("un diagramma già disegnato con lo stesso aspetto non si ridisegna, e ogni vista ha il suo URL", async () => {
    document.documentElement.dataset.theme = "dark";
    renderer.render.mockResolvedValue({ svg });
    vi.spyOn(URL, "createObjectURL").mockReturnValueOnce("blob:primo").mockReturnValueOnce("blob:secondo");
    const revoke = vi.spyOn(URL, "revokeObjectURL");
    const first = view("flowchart LR; A-->B");
    await vi.waitFor(() => expect(first.element.dataset.state).toBe("ready"));
    const calls = renderer.render.mock.calls.length;
    const second = view("flowchart LR; A-->B");
    expect(second.element.dataset.state).toBe("ready");
    expect(renderer.render.mock.calls.length).toBe(calls);
    expect(second.element.querySelector("img")!.getAttribute("src")).toBe("blob:secondo");
    expect(second.element.querySelector("img")!.alt).toBe("Flusso di lavoro");
    first.destroy();
    expect(revoke).toHaveBeenCalledWith("blob:primo");
    expect(revoke).not.toHaveBeenCalledWith("blob:secondo");
  });

  it("il menu Stile mostra i cinque stili, segna quello attivo e sceglie per tutti", async () => {
    document.documentElement.dataset.theme = "dark";
    renderer.render.mockResolvedValue({ svg });
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:menu");
    const diagram = view("flowchart LR; A-->B");
    await vi.waitFor(() => expect(diagram.element.dataset.state).toBe("ready"));
    const trigger = diagram.element.querySelector<HTMLButtonElement>(".mermaid-action")!;
    trigger.click();
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    const items = menuItems("menuitemradio");
    expect(items.map((item) => item.querySelector(".menu-label")!.textContent))
      .toEqual(["Armonia", "Acquerello", "Aurora", "Blueprint", "Inchiostro"]);
    expect(items.map((item) => item.getAttribute("aria-checked"))).toEqual(["true", "false", "false", "false", "false"]);
    expect(items.every((item) => item.querySelectorAll(".menu-swatch").length === 6)).toBe(true);
    // In Lettura il sorgente non si scrive: niente «solo questo diagramma».
    expect(menuItems("menuitemcheckbox")).toHaveLength(0);
    items[3]!.click();
    expect(ipc.setSetting).toHaveBeenCalledWith("appearance.diagram-style", "blueprint");
    expect(diagramStylePreference()).toBe("blueprint");
    await vi.waitFor(() => expect(diagram.element.dataset.diagramStyle).toBe("blueprint"));
  });

  it("se l'impostazione non si scrive, la scelta torna indietro", async () => {
    renderer.render.mockResolvedValue({ svg });
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:rifiuto");
    ipc.setSetting.mockRejectedValueOnce(new Error("disco pieno"));
    const diagram = view("flowchart LR; A-->B");
    await vi.waitFor(() => expect(diagram.element.dataset.state).toBe("ready"));
    diagram.element.querySelector<HTMLButtonElement>(".mermaid-action")!.click();
    menuItems("menuitemradio")[2]!.click();
    expect(diagramStylePreference()).toBe("aurora");
    await vi.waitFor(() => expect(diagramStylePreference()).toBe("armonia"));
  });

  it("«Solo per questo diagramma» scrive la direttiva, e poi la scelta resta sua", async () => {
    renderer.render.mockResolvedValue({ svg });
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:solo");
    const edits: unknown[] = [];
    const plain = createMermaidView("flowchart LR; A-->B", { editSource: (edit) => edits.push(edit) });
    mounted.push(plain);
    document.body.append(plain.element);
    await vi.waitFor(() => expect(plain.element.dataset.state).toBe("ready"));
    plain.element.querySelector<HTMLButtonElement>(".mermaid-action")!.click();
    const only = menuItems("menuitemcheckbox");
    expect(only).toHaveLength(1);
    expect(only[0]!.getAttribute("aria-checked")).toBe("false");
    only[0]!.click();
    expect(edits).toEqual([{ from: 0, to: 0, insert: "%% stile: armonia\n" }]);

    const own = createMermaidView("%% stile: aurora\nflowchart LR; A-->B", { editSource: (edit) => edits.push(edit) });
    mounted.push(own);
    document.body.append(own.element);
    await vi.waitFor(() => expect(own.element.dataset.state).toBe("ready"));
    own.element.querySelector<HTMLButtonElement>(".mermaid-action")!.click();
    expect(menuItems("menuitemcheckbox")[0]!.getAttribute("aria-checked")).toBe("true");
    menuItems("menuitemradio")[3]!.click();
    expect(edits[edits.length - 1]).toEqual({ from: 0, to: 16, insert: "%% stile: blueprint" });
    expect(ipc.setSetting).not.toHaveBeenCalled();
    own.element.querySelector<HTMLButtonElement>(".mermaid-action")!.click();
    menuItems("menuitemcheckbox")[0]!.click();
    expect(edits[edits.length - 1]).toEqual({ from: 0, to: 17, insert: "" });
  });

  it("Esporta compare a diagramma pronto e salva un SVG con la sua misura", async () => {
    renderer.render.mockResolvedValue({ svg });
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:esporta");
    const diagram = view("flowchart LR; A-->B");
    const exporter = diagram.element.querySelectorAll<HTMLButtonElement>(".mermaid-action")[1]!;
    expect(exporter.hidden).toBe(true);
    await vi.waitFor(() => expect(diagram.element.dataset.state).toBe("ready"));
    expect(exporter.hidden).toBe(false);
    exporter.click();
    const items = menuItems("menuitem");
    expect(items.map((item) => item.textContent)).toEqual(["Copia come SVG", "Salva come SVG…", "Salva come PNG…"]);
    items[1]!.click();
    await vi.waitFor(() => expect(ipc.saveArtifact).toHaveBeenCalledTimes(1));
    const [name, type, bytes] = ipc.saveArtifact.mock.calls[0]!;
    expect(name).toBe("diagramma-flowchart.svg");
    expect(type).toBe("image/svg+xml");
    const saved = new TextDecoder().decode(new Uint8Array(bytes));
    expect(saved).toContain('width="100"');
    expect(saved).toContain('height="40"');
  });
});

describe("il diagramma a schermo intero", () => {
  it("il bottone compare a diagramma pronto e apre la lightbox; anche un clic sul disegno", async () => {
    // Senza moto la lightbox si toglie subito, invece che a fine animazione.
    setReducedMotionPreference(true);
    renderer.render.mockResolvedValue({ svg });
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:intero");
    const diagram = view("flowchart LR; A-->B");
    const full = diagram.element.querySelectorAll<HTMLButtonElement>(".mermaid-action")[2]!;
    expect(full.getAttribute("aria-label") ?? full.textContent).toContain("Schermo intero");
    expect(full.hidden).toBe(true);
    await vi.waitFor(() => expect(diagram.element.dataset.state).toBe("ready"));
    expect(full.hidden).toBe(false);
    full.click();
    const box = document.querySelector<HTMLElement>(".lightbox")!;
    expect(box.getAttribute("aria-label")).toBe("Flusso di lavoro");
    expect(box.querySelector(".lightbox-caption")!.textContent).toBe("Mermaid · flowchart");
    closeLightbox();
    expect(document.querySelector(".lightbox")).toBeNull();
    diagram.element.querySelector<HTMLImageElement>("img")!.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    expect(document.querySelector(".lightbox")).not.toBeNull();
    closeLightbox();
    setReducedMotionPreference(false);
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
