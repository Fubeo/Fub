// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Page = {
  items: Array<{
    doc: string;
    snippet: string;
    occurrences: Array<{ span: { start: number; end: number }; revision: string }>;
  }>;
  offset: number;
  total: number;
};

const fixture = vi.hoisted(() => ({
  state: { currentDoc: "old.md" as string | null },
  matching: vi.fn(),
  reveal: vi.fn(),
  pending: [] as Array<{ resolve: (page: Page) => void }>,
}));

vi.mock("../state/store", () => ({ state: fixture.state }));
vi.mock("../host/query", () => ({ matchingDocuments: fixture.matching }));
vi.mock("../panels/document", () => ({ reveal: fixture.reveal }));
vi.mock("../ui/commands", () => ({ registerShellCommand: vi.fn() }));
vi.mock("../ui/a11y", () => ({
  trapFocus: (_root: HTMLElement, _close: () => void) => () => {},
}));
vi.mock("../ui/motion", () => ({
  enterSurface: (_element: HTMLElement) => {},
  exitSurface: (_element: HTMLElement, conceal: () => void) => {
    window.setTimeout(conceal, 600);
  },
}));
vi.mock("../ui/tooltip", () => ({ setTooltip: (_element: HTMLElement, _text: string) => {} }));
vi.mock("../i18n/strings", () => ({
  t: (key: string, args: Record<string, string | number> = {}) =>
    args.count === undefined ? key : `${key}:${args.count}`,
}));

import { closeInDocumentSearch, openInDocumentSearch } from "./doc-search";

function page(doc: string, offset: number, snippet: string): Page {
  return {
    items: [{
      doc,
      snippet,
      occurrences: [{ span: { start: offset, end: offset + 1 }, revision: "r1" }],
    }],
    offset: 0,
    total: 1,
  };
}

function box(): HTMLElement {
  return document.querySelector<HTMLElement>("#doc-search .palette-box")!;
}

function input(): HTMLInputElement {
  return box().querySelector<HTMLInputElement>("input")!;
}

async function flush(): Promise<void> {
  for (let i = 0; i < 8; i += 1) await Promise.resolve();
}

beforeEach(() => {
  vi.useFakeTimers();
  document.body.replaceChildren();
  fixture.state.currentDoc = "old.md";
  fixture.matching.mockReset();
  fixture.matching.mockImplementation(
    () => new Promise<Page>((resolve) => fixture.pending.push({ resolve })),
  );
  fixture.pending.length = 0;
  fixture.reveal.mockReset();
});

afterEach(() => {
  closeInDocumentSearch();
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
  document.body.replaceChildren();
});

describe("ciclo di vita della ricerca nella nota", () => {
  it("annulla il debounce chiuso e riusa un solo albero durante l'uscita", () => {
    openInDocumentSearch();
    input().value = "old query";
    input().dispatchEvent(new Event("input"));
    vi.advanceTimersByTime(179);

    closeInDocumentSearch();
    fixture.state.currentDoc = "new.md";
    openInDocumentSearch();

    expect(box().querySelectorAll("input")).toHaveLength(1);
    expect(box().querySelectorAll("ul")).toHaveLength(1);

    vi.advanceTimersByTime(1);
    expect(fixture.matching).not.toHaveBeenCalled();
    vi.advanceTimersByTime(599);
    expect(document.getElementById("doc-search")).not.toBeNull();
  });

  it("scarta una risposta tardiva e il click di un risultato vecchio", async () => {
    openInDocumentSearch();
    input().value = "first";
    input().dispatchEvent(new Event("input"));
    vi.advanceTimersByTime(180);
    expect(fixture.pending).toHaveLength(1);

    fixture.pending[0]!.resolve(page("old.md", 10, "old result"));
    await flush();
    const oldButton = box().querySelector<HTMLButtonElement>("button.search-result")!;

    input().value = "late old";
    input().dispatchEvent(new Event("input"));
    vi.advanceTimersByTime(180);
    expect(fixture.pending).toHaveLength(2);

    closeInDocumentSearch();
    fixture.state.currentDoc = "new.md";
    openInDocumentSearch();
    input().value = "new query";
    input().dispatchEvent(new Event("input"));
    vi.advanceTimersByTime(180);
    expect(fixture.pending).toHaveLength(3);

    fixture.pending[1]!.resolve(page("old.md", 20, "late old result"));
    await flush();
    expect(input().value).toBe("new query");
    expect(box().querySelector("button.search-result")).toBeNull();

    oldButton.click();
    expect(fixture.reveal).not.toHaveBeenCalled();
    expect(input().value).toBe("new query");

    fixture.pending[2]!.resolve(page("new.md", 30, "new result"));
    await flush();
    expect(box().textContent).toContain("new result");

    // Il punto va al documento cercato, nominato: non al riquadro col fuoco.
    box().querySelector<HTMLButtonElement>("button.search-result")!.click();
    expect(fixture.reveal).toHaveBeenCalledWith("new.md", { span: { start: 30, end: 30 } });
  });
});
