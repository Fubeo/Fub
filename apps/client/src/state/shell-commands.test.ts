// @vitest-environment happy-dom
// Un segnalibro web si apre fuori soltanto se è http(s), anche quando il
// bersaglio non è passato da chi legge i segnalibri.

import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../host/ipc", () => ({ api: {} }));
vi.mock("../host/query", () => ({ resolvedReference: vi.fn() }));
vi.mock("./document-controller", () => ({ openDocument: vi.fn(), reveal: vi.fn() }));

const { openBookmarkTarget } = await import("./shell-commands");

afterEach(() => {
  vi.restoreAllMocks();
});

describe("il bersaglio web di un segnalibro", () => {
  it("apre un indirizzo http(s) e lascia cadere ogni altro schema", async () => {
    const opened: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      opened.push(this.href);
    });
    await openBookmarkTarget({ k: "web", url: "https://esempio.it/a" });
    for (const url of ["javascript:alert(1)", "data:text/html,x", "file:///etc/passwd", " https://esempio.it/"]) {
      await openBookmarkTarget({ k: "web", url });
    }
    expect(opened).toEqual(["https://esempio.it/a"]);
  });
});
