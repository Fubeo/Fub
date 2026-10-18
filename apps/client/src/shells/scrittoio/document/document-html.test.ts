// @vitest-environment happy-dom
//
// `document.html` è la finestra documento su un foglio dello Scrittoio. Gli id
// qui sotto sono quelli che la finestra ha sempre avuto, e che l'ingresso cerca:
// ognuno resta sullo stesso elemento e con lo stesso ruolo. Un id in meno è un
// pezzo di finestra che non risponde.
import { describe, expect, it } from "vitest";

const page = (await import("../../../../document.html?raw")).default;

/// Gli id di sempre della finestra documento, con ciò che li rende quello che sono.
const CONTRACT: Record<string, { tag: string; role?: string; live?: string; type?: string; hidden?: boolean }> = {
  "document-window": { tag: "MAIN" },
  "document-window-state": { tag: "P", role: "status", live: "polite" },
  "document-window-conflict": { tag: "DIV", hidden: true },
  "document-window-keep": { tag: "BUTTON", type: "button" },
  "document-window-discard": { tag: "BUTTON", type: "button" },
};

function parse(html: string): Document {
  return new DOMParser().parseFromString(html, "text/html");
}

describe("document.html", () => {
  it("ogni id di sempre è sullo stesso elemento, con lo stesso ruolo", () => {
    const doc = parse(page);
    for (const [id, want] of Object.entries(CONTRACT)) {
      const now = doc.getElementById(id) as HTMLElement | null;
      expect(now, id).not.toBeNull();
      expect(now?.tagName, id).toBe(want.tag);
      expect(now?.getAttribute("role") ?? undefined, `${id} role`).toBe(want.role);
      expect(now?.getAttribute("aria-live") ?? undefined, `${id} aria-live`).toBe(want.live);
      expect(now?.getAttribute("type") ?? undefined, `${id} type`).toBe(want.type);
      expect(now?.hasAttribute("hidden"), `${id} hidden`).toBe(want.hidden ?? false);
    }
  });

  it("carica l'ingresso della finestra documento dello Scrittoio, e nessun altro", () => {
    const scripts = [...page.matchAll(/<script[^>]*\ssrc="([^"]+)"/g)].map((match) => match[1]);
    expect(scripts).toEqual(["/src/shells/scrittoio/document/entry.ts"]);
  });

  it("il foglio ha una linguetta scelta che governa il pannello dell'editor", () => {
    const doc = parse(page);
    const tab = doc.getElementById("document-window-tab") as HTMLElement;
    expect(tab.getAttribute("role")).toBe("tab");
    expect(tab.getAttribute("aria-selected")).toBe("true");
    // Il pannello lo crea l'ingresso, con questo id.
    expect(tab.getAttribute("aria-controls")).toBe("document-window-panel");
    const tabs = doc.getElementById("document-window-tabs") as HTMLElement;
    expect(tabs.getAttribute("role")).toBe("tablist");
    expect(tabs.getAttribute("aria-owns")).toBe(tab.id);
  });
});
