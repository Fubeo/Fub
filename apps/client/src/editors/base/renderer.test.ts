// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { customRenderer, NO_RENDER_CONTEXT } from "../../ui/custom";
import { BASE_RENDERER_NS } from "./ids";
import { acceptsBaseEmbed, registerBaseRenderer } from "./renderer";

describe("la resa delle Basi incorporate", () => {
  it("riconosce un blocco o un file .base, e nient'altro", () => {
    expect(acceptsBaseEmbed({ source: "views: []\n" })).toBe(true);
    expect(acceptsBaseEmbed({ base: "Opere.base" })).toBe(true);
    expect(acceptsBaseEmbed({ view: "Tabella" })).toBe(false);
    expect(acceptsBaseEmbed(["Opere.base"])).toBe(false);
    expect(acceptsBaseEmbed(null)).toBe(false);
  });

  it("smontata prima che la superficie arrivi, non monta più niente", async () => {
    registerBaseRenderer(() => {});
    const payload = { source: "views:\n  - {name: Tabella, type: table}\n" };
    const render = customRenderer(BASE_RENDERER_NS, payload);
    expect(render).toBeDefined();
    const host = document.createElement("div");
    document.body.append(host);
    const dispose = render!(host, payload, () => {}, NO_RENDER_CONTEXT);
    dispose?.();
    // Il modulo della superficie arriva dopo lo smontaggio.
    await import("./surface");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(host.childElementCount).toBe(0);
    host.remove();
  });
});
