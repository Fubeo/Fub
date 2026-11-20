// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createMermaidView,
  diagramFence,
  diagramProblem,
  diagramTitle,
  drawnDiagramSvg,
  flowDirectionEdit,
  flowLine,
  forgetMermaidRenders,
  mermaidLineOrigins,
  mountMermaidBlocks,
  problemSentence,
  registerMermaidRenderer,
  titleEdit,
  withoutTitle,
  type MermaidView,
  type MermaidViewOptions,
} from "./mermaid";
import { declareClipboard, type ClipboardContent } from "../platform/clipboard";
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

/// Una vista con le sue opzioni, montata nel documento.
function mountedView(source: string, options: MermaidViewOptions): MermaidView {
  const diagram = createMermaidView(source, options);
  mounted.push(diagram);
  document.body.append(diagram.element);
  return diagram;
}

/// Il tasto destro sul disegno.
function rightClick(diagram: MermaidView, init: MouseEventInit = {}): MouseEvent {
  const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true, button: 2, clientX: 60, clientY: 50, ...init });
  diagram.element.querySelector("img")!.dispatchEvent(event);
  return event;
}

const diagramMenu = () => document.querySelector<HTMLElement>(".diagram-menu");
const segment = (menu: HTMLElement, value: string) =>
  menu.querySelector<HTMLButtonElement>(`.diagram-menu-segment[data-value="${value}"]`)!;
const style = (menu: HTMLElement, id: string) =>
  menu.querySelector<HTMLButtonElement>(`[role="radio"][data-diagram-style="${id}"]`)!;
const actions = (menu: HTMLElement) => [...menu.querySelectorAll<HTMLButtonElement>('.diagram-menu-actions [role="menuitem"]')];

/// Appunti finti con più tipi: registrano ciò che ricevono.
function fakeClipboard(rich: boolean) {
  const data = vi.fn(async (_content: ClipboardContent) => {});
  const text = vi.fn(async (_text: string) => {});
  const supports = vi.fn((_type: string) => rich);
  const undo = declareClipboard(text, { write: data, read: async () => [], supports: (type) => supports(type) });
  return { data, text, supports, undo };
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

  it("un nodo con la classe internal-link diventa un wikilink alla nota col suo testo", async () => {
    renderer.render.mockResolvedValueOnce({ svg: `<svg xmlns="http://www.w3.org/2000/svg">
      <g class="node default internal-link" id="flowchart-A-0"><text><tspan>Idee</tspan> <tspan>sparse</tspan></text></g>
      <g class="node default" id="flowchart-B-1"><text>Solo testo</text></g>
      <g class="node default internal-link" id="flowchart-C-2"><text>Idee sparse</text></g>
    </svg>` });
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:note");
    const source = "flowchart LR; A[Idee sparse]-->B[Solo testo]; class A internal-link";
    const diagram = createMermaidView(source, { noteLinks: true });
    mounted.push(diagram);
    document.body.append(diagram.element);
    await vi.waitFor(() => expect(diagram.element.dataset.state).toBe("ready"));
    const nav = diagram.element.querySelector("nav")!;
    expect(nav.hidden).toBe(false);
    const anchors = Array.from(nav.querySelectorAll<HTMLAnchorElement>("a"));
    expect(anchors.map((anchor) => [anchor.className, anchor.dataset.wikilinkPage, anchor.textContent])).toEqual([
      ["wikilink", "Idee sparse", "Idee sparse"],
    ]);
    // Senza chi li apre, come in una vista dichiarativa, non compaiono.
    const inert = view(source);
    await vi.waitFor(() => expect(inert.element.dataset.state).toBe("ready"));
    expect(inert.element.querySelector("nav")!.hidden).toBe(true);
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
    renderer.render.mockRejectedValueOnce(new Error("Parse error on line 2:\n...LR\nA[unfinished\n-------------^\nExpecting 'SQE', got 'EOF'"));
    renderer.render.mockResolvedValueOnce({ svg });
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:valid");
    const invalid = view("flowchart LR\nA[unfinished");
    const valid = view("flowchart LR; A-->B");
    await vi.waitFor(() => expect(valid.element.dataset.state).toBe("ready"));
    expect(invalid.element.dataset.state).toBe("error");
    expect(invalid.element.querySelector("details")!.open).toBe(true);
    expect(invalid.element.querySelector("code")!.textContent).toBe("flowchart LR\nA[unfinished");
    // Dove, in parole semplici: mai il messaggio grezzo di Mermaid.
    expect(invalid.element.querySelector('[role="status"]')!.textContent).toMatch(/^Riga 2: /);
    expect(invalid.element.querySelector('[role="status"]')!.textContent).not.toContain("Expecting");
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
  it("l'aspetto imposto dall'esportazione vince sullo stile, dà i colori e toglie il fondo", async () => {
    setDiagramStylePreference("aurora");
    renderer.render.mockResolvedValue({ svg });
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:esporta");
    const diagram = mountedView("%% stile: inchiostro\nflowchart LR; A-->B", {
      appearance: "light",
      look: { style: "acquerello", colors: { nodes: "#1f4f8f", lines: "#b3261e" }, paper: false, ground: "#fffdf8" },
    });
    await vi.waitFor(() => expect(diagram.element.dataset.state).toBe("ready"));
    expect(diagram.element.dataset.diagramStyle).toBe("acquerello");
    expect(lastConfig().themeVariables.lineColor).toBe("#b3261e");
    expect(String(lastConfig().themeCSS)).toContain("fill:#1f4f8f;");
    // Senza il fondo la tavola non ha carta: sta sulla pagina.
    expect(diagram.element.style.getPropertyValue("--diagram-paper")).toBe("");
    // Il disegno si ritrova dall'immagine, per l'SVG che va nel PDF.
    expect(drawnDiagramSvg(diagram.element.querySelector("img")!)).toContain("<svg");
    // `%% stile:` nella nota resta com'è.
    expect(diagram.element.querySelector("pre code")!.textContent).toContain("%% stile: inchiostro");
  });

  it("con Armonia dell'esportazione legge i colori della carta di stampa", async () => {
    renderer.render.mockResolvedValue({ svg });
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:tema");
    const tokens = { ground: "#fbf8ee", "--doc-fg": "#2b2a27", "--muted": "#55524a", "--accent": "#8d2d63" };
    const diagram = mountedView("flowchart LR; A-->B", { appearance: "light", look: { style: "armonia", tokens } });
    await vi.waitFor(() => expect(diagram.element.dataset.state).toBe("ready"));
    expect(lastConfig().themeVariables.primaryColor).toBe(paletteFor("armonia", "light", "normal", (name) => tokens[name as keyof typeof tokens] ?? null).primary.fill);
  });

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
    await vi.waitFor(() => expect(diagram.element.dataset.diagramStyle).toBe("blueprint"));
    expect(String(lastConfig().fontFamily)).toContain("JetBrains Mono");
  });

  it("a riposo c'è soltanto il disegno: niente barra né pulsanti", async () => {
    renderer.render.mockResolvedValue({ svg });
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:riposo");
    const diagram = view("flowchart LR; A-->B");
    await vi.waitFor(() => expect(diagram.element.dataset.state).toBe("ready"));
    expect(diagram.element.querySelector("button")).toBeNull();
    // Senza `title` la didascalia è vuota: il foglio la nasconde.
    expect(diagram.element.querySelector("figcaption")!.textContent).toBe("");
    expect(diagram.caption.hasAttribute("data-empty")).toBe(true);
    // Il sorgente compare soltanto quando il disegno non c'è.
    expect(diagram.element.querySelector("details")!.hidden).toBe(true);
  });

  it("la tavola che scorre di lato entra nel giro del Tab, e ne esce quando il disegno ci sta", async () => {
    renderer.render.mockResolvedValue({ svg });
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:largo");
    const diagram = view("flowchart LR; A-->B");
    await vi.waitFor(() => expect(diagram.element.dataset.state).toBe("ready"));
    const stage = diagram.element.querySelector<HTMLElement>(".mermaid-diagram-view")!;
    const image = diagram.element.querySelector("img")!;
    // Il disegno ci sta: la tavola è una figura qualunque, fuori dal Tab.
    Object.defineProperty(stage, "clientWidth", { configurable: true, value: 600 });
    Object.defineProperty(stage, "scrollWidth", { configurable: true, value: 600 });
    image.dispatchEvent(new Event("load"));
    expect(stage.hasAttribute("tabindex")).toBe(false);
    expect(stage.hasAttribute("role")).toBe(false);
    // Più largo del riquadro: la tavola scorre, e la tastiera la raggiunge.
    Object.defineProperty(stage, "scrollWidth", { configurable: true, value: 900 });
    image.dispatchEvent(new Event("load"));
    expect(stage.tabIndex).toBe(0);
    expect(stage.getAttribute("role")).toBe("group");
    expect(stage.getAttribute("aria-label")).toBe("Disegno del diagramma: scorre di lato con le frecce");
    // Il riquadro si allarga di nuovo: fuori dal Tab, senza nome.
    Object.defineProperty(stage, "clientWidth", { configurable: true, value: 1000 });
    image.dispatchEvent(new Event("load"));
    expect(stage.hasAttribute("tabindex")).toBe(false);
    expect(stage.hasAttribute("aria-label")).toBe(false);
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
});

describe("il menu del tasto destro (E26)", () => {
  it("si apre sul disegno al posto di quello della nota, coi pezzi in ordine", async () => {
    document.documentElement.dataset.theme = "dark";
    renderer.render.mockResolvedValue({ svg });
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:menu");
    const diagram = view("---\ntitle: Il flusso\n---\nflowchart LR; A-->B");
    await vi.waitFor(() => expect(diagram.element.dataset.state).toBe("ready"));
    const event = rightClick(diagram);
    expect(event.defaultPrevented).toBe(true);
    const menu = diagramMenu()!;
    expect(menu.classList.contains("menu-at-point")).toBe(true);
    expect(menu.getAttribute("aria-label")).toBe("Diagramma · Il flusso");
    expect(menu.querySelector(".menu-head")!.textContent).toBe("DiagrammaIl flusso");
    const radios = [...menu.querySelectorAll<HTMLButtonElement>('[role="radio"]')];
    expect(radios.map((radio) => radio.textContent)).toEqual(["Armonia", "Acquerello", "Aurora", "Blueprint", "Inchiostro"]);
    expect(radios.map((radio) => radio.getAttribute("aria-checked"))).toEqual(["true", "false", "false", "false", "false"]);
    // Ogni miniatura nei suoi colori.
    const aurora = radios[2]!.querySelector<HTMLElement>(".diagram-menu-swatch")!;
    expect(aurora.style.getPropertyValue("--diagram-swatch-node")).toBe(paletteFor("aurora", "dark").primary.fill);
    // Senza chi scrive (Lettura in sola lettura) «Questo» non si sceglie.
    expect(segment(menu, "this").disabled).toBe(true);
    expect(segment(menu, "all").getAttribute("aria-pressed")).toBe("true");
    expect(segment(menu, "LR").getAttribute("aria-pressed")).toBe("true");
    expect(segment(menu, "TD").getAttribute("aria-pressed")).toBe("false");
    // Senza chi apre il sorgente, la prima azione non c'è.
    expect(actions(menu).map((row) => row.querySelector(".menu-label")!.textContent))
      .toEqual(["Ingrandisci", "Copia come immagine", "Esporta…"]);
    expect(actions(menu).map((row) => row.querySelector(".menu-hint")?.textContent ?? row.querySelector(".menu-description")?.textContent))
      .toEqual(["Spazio", "Ctrl C", "SVG o PNG"]);
    radios[3]!.click();
    expect(ipc.setSetting).toHaveBeenCalledWith("appearance.diagram-style", "blueprint");
    expect(diagramStylePreference()).toBe("blueprint");
    expect(diagramMenu()).toBeNull();
    await vi.waitFor(() => expect(diagram.element.dataset.diagramStyle).toBe("blueprint"));
  });

  it("Maiusc lascia il menu del sistema, e un diagramma senza flusso non ha l'orientamento", async () => {
    renderer.render.mockResolvedValue({ svg });
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:seq");
    const diagram = view("sequenceDiagram\nA->>B: ciao");
    await vi.waitFor(() => expect(diagram.element.dataset.state).toBe("ready"));
    expect(rightClick(diagram, { shiftKey: true }).defaultPrevented).toBe(false);
    expect(diagramMenu()).toBeNull();
    rightClick(diagram);
    expect(diagramMenu()!.querySelector('[data-value="TD"]')).toBeNull();
  });

  it("passare su una miniatura la mostra sul diagramma; uscire la rimette", async () => {
    renderer.render.mockResolvedValue({ svg });
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:anteprima");
    const diagram = view("flowchart TD; A-->B");
    await vi.waitFor(() => expect(diagram.element.dataset.state).toBe("ready"));
    rightClick(diagram);
    const menu = diagramMenu()!;
    const grid = menu.querySelector<HTMLElement>('[role="radiogroup"]')!;
    style(menu, "acquerello").dispatchEvent(new PointerEvent("pointerenter"));
    await vi.waitFor(() => expect(diagram.element.dataset.diagramStyle).toBe("acquerello"));
    // Il disegno di prima resta finché arriva l'altro.
    expect(diagram.element.querySelector("img")!.hidden).toBe(false);
    grid.dispatchEvent(new PointerEvent("pointerleave"));
    await vi.waitFor(() => expect(diagram.element.dataset.diagramStyle).toBe("armonia"));
    // Chiuso con un'anteprima accesa, il diagramma torna al suo stile.
    style(menu, "inchiostro").dispatchEvent(new PointerEvent("pointerenter"));
    await vi.waitFor(() => expect(diagram.element.dataset.diagramStyle).toBe("inchiostro"));
    menu.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await vi.waitFor(() => expect(diagramMenu()).toBeNull());
    await vi.waitFor(() => expect(diagram.element.dataset.diagramStyle).toBe("armonia"));
    expect(diagramStylePreference()).toBe("armonia");
    expect(ipc.setSetting).not.toHaveBeenCalled();
  });

  it("se l'impostazione non si scrive, la scelta torna indietro", async () => {
    renderer.render.mockResolvedValue({ svg });
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:rifiuto");
    ipc.setSetting.mockRejectedValueOnce(new Error("disco pieno"));
    const diagram = view("flowchart LR; A-->B");
    await vi.waitFor(() => expect(diagram.element.dataset.state).toBe("ready"));
    rightClick(diagram);
    style(diagramMenu()!, "aurora").click();
    expect(diagramStylePreference()).toBe("aurora");
    await vi.waitFor(() => expect(diagramStylePreference()).toBe("armonia"));
  });

  it("la didascalia: il titolo sotto il disegno; Invio lo scrive nel sorgente, Esc lo rimette", async () => {
    renderer.render.mockResolvedValue({ svg });
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:didascalia");
    const edits: unknown[] = [];
    const source = "---\ntitle: Il flusso\n---\nflowchart LR; A-->B";
    const diagram = mountedView(source, { editSource: (edit) => edits.push(edit) });
    await vi.waitFor(() => expect(diagram.element.dataset.state).toBe("ready"));
    expect(diagram.element.querySelector("figcaption.mermaid-diagram-caption")).toBe(diagram.caption);
    const caption = diagram.caption.querySelector<HTMLElement>(".mermaid-diagram-caption-text")!;
    expect(caption.textContent).toBe("Il flusso");
    expect(diagram.caption.hasAttribute("data-empty")).toBe(false);
    // Mermaid non lo disegna dentro: sta qui, nei caratteri della nota.
    expect(renderer.render.mock.calls[renderer.render.mock.calls.length - 1]![1]).not.toContain("title");
    expect(caption.getAttribute("role")).toBe("textbox");
    caption.focus();
    caption.textContent = "Altro";
    caption.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    expect(caption.textContent).toBe("Il flusso");
    expect(edits).toEqual([]);
    caption.focus();
    caption.textContent = "";
    caption.dispatchEvent(new Event("input", { bubbles: true }));
    expect(diagram.caption.hasAttribute("data-empty")).toBe(true);
    caption.textContent = "Il percorso: #2";
    caption.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    expect(edits).toEqual([{ from: 4, to: 20, insert: "title: \"Il percorso: #2\"" }]);
    // Il disegno non scende sotto il 72% della sua misura: oltre, la tavola scorre.
    expect(diagram.element.querySelector("img")!.style.getPropertyValue("--diagram-min-width")).toMatch(/^\d+px$/);
  });

  it("«Questo» scrive la direttiva dopo il frontmatter; «Tutti» la toglie e sceglie per tutti", async () => {
    renderer.render.mockResolvedValue({ svg });
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:questo");
    const edits: unknown[] = [];
    const plain = mountedView("---\ntitle: T\n---\nflowchart LR; A-->B", { editSource: (edit) => edits.push(edit) });
    await vi.waitFor(() => expect(plain.element.dataset.state).toBe("ready"));
    rightClick(plain);
    let menu = diagramMenu()!;
    // Senza uno stile suo il menu parte da «Tutti».
    expect(segment(menu, "all").getAttribute("aria-pressed")).toBe("true");
    segment(menu, "this").click();
    expect(segment(menu, "this").getAttribute("aria-pressed")).toBe("true");
    style(menu, "blueprint").click();
    expect(edits).toEqual([{ from: 17, to: 17, insert: "%% stile: blueprint\n" }]);
    expect(ipc.setSetting).not.toHaveBeenCalled();

    const own = mountedView("%% stile: aurora\nflowchart LR; A-->B", { editSource: (edit) => edits.push(edit) });
    await vi.waitFor(() => expect(own.element.dataset.state).toBe("ready"));
    rightClick(own);
    menu = diagramMenu()!;
    expect(segment(menu, "this").getAttribute("aria-pressed")).toBe("true");
    expect(style(menu, "aurora").getAttribute("aria-checked")).toBe("true");
    segment(menu, "all").click();
    style(menu, "inchiostro").click();
    expect(edits[edits.length - 1]).toEqual({ from: 0, to: 17, insert: "" });
    expect(ipc.setSetting).toHaveBeenCalledWith("appearance.diagram-style", "inchiostro");
  });

  it("un nome sconosciuto applica lo stile generale e il menu lo dice", async () => {
    renderer.render.mockResolvedValue({ svg });
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:ignoto");
    const diagram = mountedView("%% stile: nebbia\nflowchart LR; A-->B", { editSource: () => {} });
    await vi.waitFor(() => expect(diagram.element.dataset.state).toBe("ready"));
    expect(diagram.element.dataset.diagramStyle).toBe("armonia");
    rightClick(diagram);
    const menu = diagramMenu()!;
    expect(menu.querySelector(".diagram-menu-notice")!.textContent).toBe("«nebbia» non è uno stile: vale Armonia.");
    expect(style(menu, "armonia").getAttribute("aria-checked")).toBe("true");
  });

  it("in sola lettura uno stile scritto resta, e il menu lo dice", async () => {
    renderer.render.mockResolvedValue({ svg });
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:fisso");
    const diagram = view("%% stile: blueprint\nflowchart LR; A-->B");
    await vi.waitFor(() => expect(diagram.element.dataset.state).toBe("ready"));
    rightClick(diagram);
    const menu = diagramMenu()!;
    expect(menu.querySelector(".diagram-menu-notice")!.textContent).toBe("Il sorgente chiede Blueprint");
    expect(segment(menu, "this").disabled).toBe(true);
    expect(segment(menu, "TD").disabled).toBe(true);
  });

  it("l'orientamento riscrive soltanto la direzione, e chiude il menu", async () => {
    renderer.render.mockResolvedValue({ svg });
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:verso");
    const edits: unknown[] = [];
    const diagram = mountedView("graph TD;\nA-->B", { editSource: (edit) => edits.push(edit) });
    await vi.waitFor(() => expect(diagram.element.dataset.state).toBe("ready"));
    rightClick(diagram);
    segment(diagramMenu()!, "TD").click();
    expect(edits).toEqual([]);
    segment(diagramMenu()!, "LR").click();
    expect(edits).toEqual([{ from: 6, to: 8, insert: "LR" }]);
    expect(diagramMenu()).toBeNull();
  });

  it("le azioni: il sorgente, Ingrandisci, Esporta", async () => {
    setReducedMotionPreference(true);
    renderer.render.mockResolvedValue({ svg });
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:azioni");
    const reveal = vi.fn();
    const diagram = mountedView("flowchart LR; A-->B", { revealSource: reveal });
    // Prima del disegno ingrandire, copiare ed esportare non hanno niente.
    rightClick(diagram);
    expect(actions(diagramMenu()!).map((row) => row.getAttribute("aria-disabled") === "true")).toEqual([false, true, true, true]);
    diagramMenu()!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await vi.waitFor(() => expect(diagram.element.dataset.state).toBe("ready"));
    rightClick(diagram);
    expect(actions(diagramMenu()!)[0]!.querySelector(".menu-hint")!.textContent).toBe("↵");
    actions(diagramMenu()!)[0]!.click();
    expect(reveal).toHaveBeenCalledTimes(1);

    rightClick(diagram);
    actions(diagramMenu()!)[1]!.click();
    const box = document.querySelector<HTMLElement>(".lightbox")!;
    expect(box.getAttribute("aria-label")).toBe("Flusso di lavoro");
    expect(box.querySelector(".lightbox-caption")!.textContent).toBe("Mermaid · flowchart");
    // Sul fondo dello stile, con in fondo come si usa; Spazio chiude, come Esc.
    expect(box.classList.contains("lightbox-diagram")).toBe(true);
    expect(box.querySelector(".lightbox-diagram-hint")!.textContent).toContain("Esc");
    box.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true, cancelable: true }));
    expect(document.querySelector(".lightbox")).toBeNull();
    // Anche un clic sul disegno lo ingrandisce.
    diagram.element.querySelector<HTMLImageElement>("img")!.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    expect(document.querySelector(".lightbox")).not.toBeNull();
    closeLightbox();

    rightClick(diagram);
    actions(diagramMenu()!)[3]!.click();
    const items = menuItems("menuitem");
    expect(items.map((item) => item.querySelector(".menu-label")?.textContent ?? item.textContent))
      .toEqual(["Copia come SVG", "Salva come SVG…", "Salva come PNG…"]);
    items[1]!.click();
    await vi.waitFor(() => expect(ipc.saveArtifact).toHaveBeenCalledTimes(1));
    const [name, type, bytes] = ipc.saveArtifact.mock.calls[0]!;
    expect(name).toBe("diagramma-flowchart.svg");
    expect(type).toBe("image/svg+xml");
    const saved = new TextDecoder().decode(new Uint8Array(bytes));
    expect(saved).toContain('width="100"');
    expect(saved).toContain('height="40"');
    setReducedMotionPreference(false);
  });

  it("dalla tastiera: le frecce fra le miniature e fra le azioni", async () => {
    renderer.render.mockResolvedValue({ svg });
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:tasti");
    const diagram = mountedView("flowchart LR; A-->B", { revealSource: () => {} });
    await vi.waitFor(() => expect(diagram.element.dataset.state).toBe("ready"));
    diagram.menu({ x: 10, y: 10 }, false);
    const menu = diagramMenu()!;
    // Aperto dalla tastiera, il fuoco va sulla miniatura scelta.
    expect(document.activeElement).toBe(style(menu, "armonia"));
    style(menu, "armonia").dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    expect(document.activeElement).toBe(style(menu, "acquerello"));
    await vi.waitFor(() => expect(diagram.element.dataset.diagramStyle).toBe("acquerello"));
    const rows = actions(menu);
    rows[0]!.focus();
    rows[0]!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    expect(document.activeElement).toBe(rows[1]);
    rows[1]!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }));
    expect(document.activeElement).toBe(rows[0]);
    await vi.waitFor(() => expect(diagram.element.dataset.diagramStyle).toBe("armonia"));
  });

  it("Copia come immagine mette negli appunti l'immagine, l'SVG e il sorgente", async () => {
    renderer.render.mockResolvedValue({ svg });
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:copia");
    const clipboard = fakeClipboard(true);
    const diagram = view("flowchart LR; A-->B");
    await vi.waitFor(() => expect(diagram.element.dataset.state).toBe("ready"));
    await diagram.copy();
    expect(clipboard.data).toHaveBeenCalledTimes(1);
    const record = clipboard.data.mock.calls[0]![0] as Record<string, Blob | Promise<Blob>>;
    expect(Object.keys(record)).toEqual(["image/png", "image/svg+xml", "text/plain"]);
    expect(await (record["text/plain"] as Blob).text()).toBe("```mermaid\nflowchart LR; A-->B\n```");
    expect(await (record["image/svg+xml"] as Blob).text()).toContain("<svg");
    // Appunti che non prendono immagini: il sorgente, come testo.
    clipboard.supports.mockReturnValue(false);
    await diagram.copy();
    clipboard.undo();
    expect(clipboard.text).toHaveBeenCalledWith("```mermaid\nflowchart LR; A-->B\n```");
  });
});

describe("il sorgente che il menu legge", () => {
  it("il titolo del frontmatter", () => {
    expect(diagramTitle("---\ntitle: \"Il flusso\"\n---\ngraph TD")).toBe("Il flusso");
    expect(diagramTitle("---\nconfig: {}\n---\ngraph TD")).toBeNull();
    expect(diagramTitle("graph TD")).toBeNull();
  });

  it("il titolo con caratteri speciali, le virgolette e i commenti di YAML", () => {
    expect(diagramTitle("---\ntitle: 'L''inizio: # uno'\n---\ngraph TD")).toBe("L'inizio: # uno");
    expect(diagramTitle("---\ntitle: Piano # bozza\n---\ngraph TD")).toBe("Piano");
    expect(diagramTitle("---\ntitle: \"A \\\"B\\\"\"\n---\ngraph TD")).toBe("A \"B\"");
  });

  it("la didascalia si scrive nel frontmatter: aggiunge, riscrive, toglie", () => {
    const apply = (source: string, title: string) => {
      const edit = titleEdit(source, title);
      return edit ? source.slice(0, edit.from) + edit.insert + source.slice(edit.to) : source;
    };
    expect(apply("graph TD\nA-->B", "Il flusso")).toBe("---\ntitle: Il flusso\n---\ngraph TD\nA-->B");
    expect(apply("---\ntitle: Vecchio\n---\ngraph TD", "Nuovo")).toBe("---\ntitle: Nuovo\n---\ngraph TD");
    // Con altro nel frontmatter, il titolo si aggiunge e si toglie da solo.
    expect(apply("---\nconfig: {}\n---\ngraph TD", "T")).toBe("---\ntitle: T\nconfig: {}\n---\ngraph TD");
    expect(apply("---\ntitle: T\nconfig: {}\n---\ngraph TD", "")).toBe("---\nconfig: {}\n---\ngraph TD");
    // Un frontmatter che resta vuoto se ne va.
    expect(apply("---\ntitle: T\n---\ngraph TD", "  ")).toBe("graph TD");
    // Caratteri che YAML leggerebbe in un altro modo, e gli a capo: mai una riga rotta.
    const tricky = apply("graph TD", "Fase: #1 «prova»\nseconda");
    expect(tricky).toBe("---\ntitle: \"Fase: #1 «prova» seconda\"\n---\ngraph TD");
    expect(diagramTitle(tricky)).toBe("Fase: #1 «prova» seconda");
    expect(titleEdit("---\ntitle: Uguale\n---\ngraph TD", "Uguale")).toBeNull();
    // Mermaid non lo disegna dentro: la didascalia sta sotto, nei caratteri della nota.
    expect(withoutTitle("---\ntitle: T\nconfig: {}\n---\ngraph TD")).not.toContain("title");
  });

  it("le righe dell'errore contano il sorgente scritto, non quello pulito da Mermaid", () => {
    const source = "---\ntitle: T\n---\n%% stile: aurora\nflowchart TD\n  A --> B\n  A --> --> C";
    expect(mermaidLineOrigins(source).length).toBeGreaterThan(0);
    // Mermaid toglie frontmatter e commenti: la sua riga 3 è la 7 del recinto.
    expect(diagramProblem(new Error("Parse error on line 3:\n...\nExpecting 'AMP', got 'LINK'"), source).line).toBe(7);
  });

  it("l'errore in parole semplici, con la riga o senza", () => {
    const flow = diagramProblem(new Error("Parse error on line 2:\n...\nExpecting 'SQE', got 'LINK'"), "flowchart TD\nA --> --> B");
    expect(problemSentence(flow)).toBe("Riga 2: questa riga non è un nodo né un collegamento.");
    // La fine inattesa sta sull'ultima riga scritta, non dopo.
    const eof = diagramProblem(new Error("Parse error on line 3:\n...\nExpecting 'SQE', got 'EOF'"), "flowchart TD\nA[uno\n");
    expect(eof.line).toBe(2);
    expect(problemSentence(eof)).toMatch(/^Riga 2: /);
    // Un errore senza riga: una frase sola, mai il messaggio grezzo.
    const none = diagramProblem(new Error("Cannot read properties of undefined"), "flowchart TD\nA-->B");
    expect(none.line).toBeNull();
    expect(problemSentence(none)).not.toContain("undefined");
    // Un tipo che Mermaid non conosce lo dice per nome.
    const kind = diagramProblem(new Error("No diagram type detected matching given configuration for text: grafo"), "grafo\nA-->B");
    expect(problemSentence(kind)).toContain("grafo");
  });

  it("la direzione del flusso cambia una parola sola", () => {
    expect(flowDirectionEdit("graph TD; A-->B", "LR")).toEqual({ from: 6, to: 8, insert: "LR" });
    // TB e TD sono la stessa direzione: niente da riscrivere.
    expect(flowDirectionEdit("flowchart TB\nA-->B", "TD")).toBeNull();
    expect(flowDirectionEdit("flowchart TB\nA-->B", "LR")).toEqual({ from: 10, to: 12, insert: "LR" });
    expect(flowDirectionEdit("flowchart\nA-->B", "LR")).toEqual({ from: 9, to: 9, insert: " LR" });
    expect(flowDirectionEdit("flowchart\nA-->B", "TD")).toBeNull();
    expect(flowDirectionEdit("---\ntitle: T\n---\n%% stile: neon\nflowchart LR\nA", "TD")).toEqual({ from: 42, to: 44, insert: "TD" });
    expect(flowDirectionEdit("sequenceDiagram\nA->>B: x", "LR")).toBeNull();
    expect(flowLine("graph RL")!.direction).toBe("RL");
  });

  it("il recinto negli appunti è più lungo di ogni recinto nel sorgente", () => {
    expect(diagramFence("graph TD\n")).toBe("```mermaid\ngraph TD\n```");
    expect(diagramFence("A[\"````\"]")).toBe("`````mermaid\nA[\"````\"]\n`````");
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
