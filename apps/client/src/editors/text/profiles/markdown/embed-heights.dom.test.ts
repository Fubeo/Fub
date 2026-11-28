// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EmbedContent } from "../../../../host/contract";

// UX-019: il posto di una nota riportata già vista tiene la sua altezza
// finché il contenuto non arriva, e la lascia appena arriva.

const query = vi.hoisted(() => ({
  renderEmbed: vi.fn(),
  matchingDocuments: vi.fn(),
  searchExpression: vi.fn((input: string) => ({ text: input })),
}));
vi.mock("../../../../host/query", () => query);

import { mountRenderedDocument } from "./mount";
import { embedHeightKey, forgetEmbedHeights, rememberedEmbedHeight } from "./embed-heights";

const SLOT = '<div class="embed" data-embed-page="Nota B">Nota B</div>';
const content: EmbedContent = { doc_id: "Nota B.md", html: "<p>Il primo paragrafo.</p>", parts: [] };

/// happy-dom non impagina: la pagina è larga 640 px, e una nota riportata
/// arrivata è alta 194 px.
function layout(): void {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    const height = this.classList.contains("embed-loaded") ? 194 : 36;
    return { x: 0, y: 0, top: 0, left: 0, width: 640, height, right: 640, bottom: height, toJSON: () => ({}) } as DOMRect;
  });
}

function mount(): { container: HTMLElement; ready: Promise<void>; dispose: () => void } {
  const container = document.createElement("div");
  document.body.append(container);
  const mounted = mountRenderedDocument(container, { html: SLOT, parts: [] }, { documentId: "Ospite.md" });
  return { container, ready: mounted.ready, dispose: mounted.dispose };
}

describe("il posto di una nota riportata mentre arriva", () => {
  beforeEach(() => {
    forgetEmbedHeights();
    layout();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    query.renderEmbed.mockReset();
    document.body.replaceChildren();
  });

  it("la prima volta aspetta senza altezza ricordata, poi la ricorda", async () => {
    let arrive!: (value: EmbedContent) => void;
    query.renderEmbed.mockReturnValueOnce(new Promise<EmbedContent>((done) => { arrive = done; }));
    const first = mount();
    const slot = first.container.querySelector<HTMLElement>(".embed")!;
    expect(slot.dataset.embedPending).toBe("");
    expect(slot.style.getPropertyValue("--embed-reserve")).toBe("");
    arrive(content);
    await first.ready;
    expect(slot.classList.contains("embed-loaded")).toBe(true);
    expect(slot.hasAttribute("data-embed-pending")).toBe(false);
    expect(rememberedEmbedHeight(embedHeightKey("lettura", "Ospite.md", "Nota B", null, null, 640))).toBe(194);
    first.dispose();
  });

  it("la volta dopo riserva l'altezza che aveva, e la lascia quando arriva", async () => {
    query.renderEmbed.mockResolvedValueOnce(content);
    const first = mount();
    await first.ready;
    first.dispose();

    let arrive!: (value: EmbedContent) => void;
    query.renderEmbed.mockReturnValueOnce(new Promise<EmbedContent>((done) => { arrive = done; }));
    const again = mount();
    const slot = again.container.querySelector<HTMLElement>(".embed")!;
    expect(slot.dataset.embedPending).toBe("");
    expect(slot.style.getPropertyValue("--embed-reserve")).toBe("194px");
    arrive(content);
    await again.ready;
    expect(slot.hasAttribute("data-embed-pending")).toBe(false);
    expect(slot.style.getPropertyValue("--embed-reserve")).toBe("");
    again.dispose();
  });

  it("una nota che non risponde lascia il posto senza riserva e non si ricorda", async () => {
    query.renderEmbed.mockRejectedValueOnce(new Error("giù"));
    const failed = mount();
    await failed.ready;
    const slot = failed.container.querySelector<HTMLElement>(".embed")!;
    expect(slot.classList.contains("unresolved")).toBe(true);
    expect(slot.hasAttribute("data-embed-pending")).toBe(false);
    expect(rememberedEmbedHeight(embedHeightKey("lettura", "Ospite.md", "Nota B", null, null, 640))).toBeNull();
    failed.dispose();
  });

  it("la larghezza conta a gradini, e senza larghezza non si ricorda niente", () => {
    const at = (width: number) => embedHeightKey("scrittura", "Ospite.md", "Nota B", null, null, width);
    expect(at(640)).toBe(at(646));
    expect(at(640)).not.toBe(at(700));
    expect(at(0)).toBeNull();
    expect(embedHeightKey("lettura", "Ospite.md", "Nota B", null, null, 640)).not.toBe(at(640));
  });
});
