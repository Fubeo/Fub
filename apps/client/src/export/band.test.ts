// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { createBand } from "./band";
import { defaultProfile } from "./profile";

describe("la banda dello spazio", () => {
  it("dice pagine, formato, margini, segnalibri e millisecondi", () => {
    const band = createBand();
    band.update(defaultProfile(), { pages: 5, bookmarks: 7, ms: 96.4 });
    const info = band.element.querySelector(".export-band-info")!;
    expect([...info.children].map((node) => node.textContent)).toEqual(["5 pagine", "A4 verticale", "margini 25/22/25/22 mm", "7 segnalibri", "impaginata in 96 ms"]);
  });

  it("senza segnalibri non li conta; mentre impagina dice «… pagine»", () => {
    const band = createBand();
    band.update(defaultProfile(), { pages: null, bookmarks: null, ms: 3 });
    const info = band.element.querySelector(".export-band-info")!;
    expect(info.textContent).toContain("… pagine");
    expect(info.textContent).not.toContain("segnalib");
  });

  it("annuncia il numero delle pagine solo quando cambia", () => {
    const band = createBand();
    const live = band.element.querySelector("[role=status]")!;
    expect(live.getAttribute("aria-live")).toBe("polite");
    band.update(defaultProfile(), { pages: null, bookmarks: 0, ms: 1 });
    expect(live.textContent).toBe("");
    band.update(defaultProfile(), { pages: 1, bookmarks: 0, ms: 1 });
    expect(live.textContent).toBe("1 pagina");
    live.textContent = "";
    band.update(defaultProfile(), { pages: 1, bookmarks: 0, ms: 9 });
    expect(live.textContent).toBe("");
    band.update(defaultProfile(), { pages: 3, bookmarks: 0, ms: 9 });
    expect(live.textContent).toBe("3 pagine");
  });

  it("il suggerimento si toglie", () => {
    const band = createBand();
    const hint = band.element.querySelector<HTMLElement>(".export-band-hint")!;
    band.setHint("ciao");
    expect(hint.hidden).toBe(false);
    band.setHint(null);
    expect(hint.hidden).toBe(true);
  });
});
