// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { DocumentSource, EmbedContent, RenderedDocument } from "../host/contract";
import { operationFromText } from "../editor/text-operation";
import { DocumentSessionCollection, type DocumentSessionApi } from "../state/document-session";
import { renderMarkdown } from "../editors/text/profiles/markdown/render";
import { mountMarkdown } from "./markdown";
import { registerMermaidRenderer } from "./mermaid";

const query = vi.hoisted(() => ({
  renderPreview: vi.fn<(id: string) => Promise<RenderedDocument>>(),
  renderEmbed: vi.fn<(page: string, heading: string | null, block: string | null) => Promise<EmbedContent>>(),
}));
vi.mock("../host/query", () => query);
vi.mock("mermaid", () => ({ default: {
  initialize: vi.fn(),
  render: vi.fn(async () => ({ svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 40"></svg>' })),
} }));

import {
  acquireMarkdownResources,
  invalidateMarkdownResourceDocument,
} from "./markdown-resources";

const releases: Array<() => void> = [];

function apiFor(text: string): DocumentSessionApi {
  return {
    readDocument: vi.fn(async (): Promise<DocumentSource> => ({
      text,
      revision: "rev-1",
      format_id: "markdown",
      source_kind: "text",
    })),
    writeDocument: vi.fn(async () => "rev-2"),
    saveDraft: vi.fn(async () => {}),
    discardDraft: vi.fn(async () => {}),
  };
}

beforeEach(() => {
  query.renderPreview.mockReset();
  query.renderEmbed.mockReset();
});

afterEach(() => {
  for (const release of releases.splice(0).reverse()) release();
  vi.restoreAllMocks();
});

describe("risorse Markdown condivise", () => {
  it("mantiene il diagramma quando il rendering salvato sostituisce il recinto locale", async () => {
    registerMermaidRenderer();
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:native-diagram");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    const source = "```mermaid\nflowchart LR; A-->B\n```\n";
    const sessions = new DocumentSessionCollection(apiFor(source));
    await sessions.read("Nota.md");
    releases.push(() => { sessions.get("Nota.md")?.close(true); });
    query.renderPreview.mockResolvedValue({
      html: `<div data-fub-renderer="fub:diagram" data-fub-source-start="0" data-fub-source-end="${source.length}"><div data-ui-slot="0"></div></div>`,
      parts: [{ slot: 0, kind: "fub:diagram", node: {
        node: "custom", ns: "fub:diagram",
        payload: { engine: "mermaid", source: "flowchart LR; A-->B" },
        fallback: [{ node: "text", content: "flowchart LR; A-->B" }],
      } }],
    });
    const resources = acquireMarkdownResources("Nota.md", sessions)!;
    releases.push(resources.release);
    const root = document.createElement("div");
    releases.push(mountMarkdown(root, renderMarkdown(source).html, { resources }));
    await vi.waitFor(() => expect(root.querySelector('[data-ui-slot] .mermaid-diagram img')?.getAttribute("src")).toBe("blob:native-diagram"));
    expect(root.querySelector('[data-ui-slot] .mermaid-diagram')?.getAttribute("data-state")).toBe("ready");
  });

  it("riusa un artefatto nativo sui blocchi invariati senza sanificarlo due volte", async () => {
    const source = "prima\n:::box\nfine";
    const sessions = new DocumentSessionCollection(apiFor(source));
    await sessions.read("Nota.md");
    releases.push(() => { sessions.get("Nota.md")?.close(true); });
    query.renderPreview.mockResolvedValue({
      html: '<div data-fub-renderer="custom" data-fub-source-start="6" data-fub-source-end="13"><p id="risultato">Nativo</p></div>',
      parts: [],
    });
    const resources = acquireMarkdownResources("Nota.md", sessions);
    expect(resources).toBeDefined();
    if (!resources) return;
    releases.push(resources.release);
    const changes: string[] = [];
    resources.subscribe((change) => changes.push(change));

    await vi.waitFor(() => expect(query.renderPreview).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(resources.match(6, 12)).toBeDefined());
    const artifact = resources.match(6, 12)!;
    expect((artifact.createFragment().firstElementChild as HTMLElement).id).toBe("fub-contenuto-risultato");

    const session = sessions.get("Nota.md")!;
    const shifted = `X${source}`;
    expect(sessions.acceptSurfaceChange("Nota.md", "test", {
      text: shifted,
      operation: operationFromText(source, shifted),
    })).toEqual({ kind: "accepted" });
    expect(resources.match(7, 13)).toBe(artifact);
    expect(query.renderPreview).toHaveBeenCalledTimes(1);
    expect(changes).toContain("native");
    expect(session.dirty).toBe(true);
  });

  it("scarta la proiezione nativa quando la modifica attraversa il suo span", async () => {
    const source = "prima\n:::box\nfine";
    const sessions = new DocumentSessionCollection(apiFor(source));
    await sessions.read("Nota.md");
    releases.push(() => { sessions.get("Nota.md")?.close(true); });
    query.renderPreview.mockResolvedValue({
      html: '<div data-fub-renderer="custom" data-fub-source-start="6" data-fub-source-end="13"><p>Nativo</p></div>',
      parts: [],
    });
    const resources = acquireMarkdownResources("Nota.md", sessions)!;
    releases.push(resources.release);
    resources.subscribe(() => {});
    await vi.waitFor(() => expect(resources.match(6, 12)).toBeDefined());

    const changed = source.replace("box", "altro");
    expect(sessions.acceptSurfaceChange("Nota.md", "test", {
      text: changed,
      operation: operationFromText(source, changed),
    })).toEqual({ kind: "accepted" });
    expect(resources.match(6, 14)).toBeUndefined();
  });

  it("deduplica gli embed fra superfici e invalida il documento trascluso", async () => {
    const sessions = new DocumentSessionCollection(apiFor("![[Altra]]"));
    await sessions.read("Nota.md");
    releases.push(() => { sessions.get("Nota.md")?.close(true); });
    query.renderPreview.mockResolvedValue({ html: "<p>locale</p>", parts: [] });
    query.renderEmbed.mockResolvedValue({ doc_id: "Altra.md", html: "<p>prima</p>", parts: [] });
    const first = acquireMarkdownResources("Nota.md", sessions)!;
    const second = acquireMarkdownResources("Nota.md", sessions)!;
    releases.push(first.release, second.release);

    await expect(Promise.all([
      first.embed("Altra", null, null),
      second.embed("Altra", null, null),
    ])).resolves.toHaveLength(2);
    expect(query.renderEmbed).toHaveBeenCalledTimes(1);

    invalidateMarkdownResourceDocument("Altra.md");
    query.renderEmbed.mockResolvedValue({ doc_id: "Altra.md", html: "<p>seconda</p>", parts: [] });
    await expect(first.embed("Altra", null, null)).resolves.toMatchObject({ html: "<p>seconda</p>" });
    expect(query.renderEmbed).toHaveBeenCalledTimes(2);
  });

  it("arricchisce un blocco nativo annidato senza perdere la citazione e la prosa", async () => {
    const source = "Prima\n\n> ```math\n> x\n> ```\n\nDopo";
    const sessions = new DocumentSessionCollection(apiFor(source));
    await sessions.read("Nota.md");
    releases.push(() => { sessions.get("Nota.md")?.close(true); });
    const from = source.indexOf("```"), to = source.lastIndexOf("```") + 3;
    query.renderPreview.mockResolvedValue({
      html: `<blockquote><div data-fub-renderer="math" data-fub-source-start="${from}" data-fub-source-end="${to}"><strong>Formula</strong></div></blockquote>`,
      parts: [],
    });
    const resources = acquireMarkdownResources("Nota.md", sessions)!;
    releases.push(resources.release);
    const root = document.createElement("div");
    releases.push(mountMarkdown(root, renderMarkdown(source).html, { resources }));
    await vi.waitFor(() => expect(root.querySelector("blockquote strong")?.textContent).toBe("Formula"));
    expect(root.textContent).toBe("PrimaFormulaDopo");
    expect(root.querySelector("pre")).toBeNull();
  });
});
