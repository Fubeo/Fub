// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";

const fake = vi.hoisted(() => ({ render: vi.fn(), notify: vi.fn() }));
vi.mock("../host/query", () => ({ renderEmbed: fake.render }));
vi.mock("../ui/sanitize", () => ({ setSanitizedHtml: (el: HTMLElement, html: string) => { el.textContent = html; } }));
vi.mock("../ui/notify", () => ({ notify: fake.notify }));
vi.mock("../i18n/strings", () => ({ t: (key: string) => key }));
vi.mock("./store", () => ({ state: { currentDoc: null } }));
vi.mock("./layout", () => ({ activeDoc: () => null }));

import { hidePreview, previewStateForTest, showStickyPreview } from "./preview";

afterEach(() => {
  hidePreview();
  fake.render.mockReset();
  fake.notify.mockReset();
  document.body.replaceChildren();
});

describe("preview ownership", () => {
  it("disposes an in-flight preview and never paints an old reply after remount", async () => {
    const box = document.createElement("div");
    document.body.append(box);
    let resolve!: (value: { html: string }) => void;
    const promise = new Promise<{ html: string }>((accept) => {
      resolve = accept;
    });
    fake.render.mockReturnValueOnce(promise);
    const stale = showStickyPreview("old.md", box);
    hidePreview();
    fake.render.mockResolvedValueOnce({ html: "new text" });
    await showStickyPreview("new.md", box);
    resolve({ html: "old text" });
    await stale;
    expect(box.querySelectorAll(".doc-preview")).toHaveLength(1);
    expect(box.textContent).toBe("new text");
    expect(previewStateForTest()).toEqual({ doc: "new.md", sticky: true });
    expect(document.activeElement).toBe(box.querySelector(".doc-preview"));
  });
});
