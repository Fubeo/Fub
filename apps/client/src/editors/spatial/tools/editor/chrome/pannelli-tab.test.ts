// @vitest-environment happy-dom
// Tab e Maiusc+Tab del Completo come `window.dock` e `window.panels` di VectorCraft.
import { describe, expect, it } from "vitest";
import { pannelliTab } from "./pannelli-tab";

function banco() {
  const barra = document.createElement("div");
  const colonna = document.createElement("div");
  const pannelli = { visti: true, siVedono: () => pannelli.visti, mostra: (si: boolean) => void (pannelli.visti = si) };
  const premi = pannelliTab(barra, colonna, pannelli);
  const visti = (): string => [barra.style.display !== "none" ? "barra" : "", colonna.style.display !== "none" ? "colonna" : "", pannelli.visti ? "pannelli" : ""].filter(Boolean).join(",");
  return { barra, colonna, pannelli, premi, visti };
}

describe("Tab del Completo", () => {
  it("Tab nasconde barra, colonna e pannelli, e il Tab dopo li rimostra", () => {
    const { premi, visti } = banco();
    premi(false);
    expect(visti()).toBe("");
    premi(false);
    expect(visti()).toBe("barra,colonna,pannelli");
  });

  it("Tab rimostra solo ciò che ha nascosto lui", () => {
    const { premi, visti, pannelli } = banco();
    pannelli.visti = false;
    premi(false);
    expect(visti()).toBe("");
    premi(false);
    expect(visti()).toBe("barra,colonna");
  });

  it("con niente in vista e niente nascosto da Tab, Tab mostra tutti e tre", () => {
    const { premi, visti, barra, colonna, pannelli } = banco();
    barra.style.display = "none";
    colonna.style.display = "none";
    pannelli.visti = false;
    premi(false);
    expect(visti()).toBe("barra,colonna,pannelli");
  });

  it("Maiusc+Tab mostra e nasconde i soli pannelli", () => {
    const { premi, visti } = banco();
    premi(true);
    expect(visti()).toBe("barra,colonna");
    premi(true);
    expect(visti()).toBe("barra,colonna,pannelli");
  });

  it("uscendo dal Completo torna tutto ciò che Tab aveva nascosto", () => {
    const { premi, visti } = banco();
    premi(false);
    premi(null);
    expect(visti()).toBe("barra,colonna,pannelli");
  });
});
