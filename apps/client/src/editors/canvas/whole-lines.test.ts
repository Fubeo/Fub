// @vitest-environment happy-dom
// Il taglio a riga intera delle schede ferme (#411): la regola pura e la
// misura, con i riquadri delle righe finti (happy-dom non fa layout).
import { afterEach, describe, expect, it, vi } from "vitest";
import { openLifetime } from "../../ui/lifetime";
import { CUT_PROPERTY, fitWholeLines, watchWholeLines, wholeLinesCut } from "./whole-lines";

afterEach(() => {
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

describe("wholeLinesCut", () => {
  it("taglia sotto l'ultima riga che sta tutta, mai a metà", () => {
    const lines = [{ top: 8, bottom: 30 }, { top: 38, bottom: 60 }, { top: 60, bottom: 82 }, { top: 92, bottom: 113 }];
    expect(wholeLinesCut(lines, 76)).toBe(60);
    expect(wholeLinesCut(lines, 82)).toBe(82);
  });

  it("niente taglio se tutto ci sta, o se non ci sta neanche la prima riga", () => {
    expect(wholeLinesCut([{ top: 0, bottom: 20 }, { top: 20, bottom: 40 }], 40)).toBeNull();
    expect(wholeLinesCut([{ top: 0, bottom: 20 }], 12)).toBeNull();
    expect(wholeLinesCut([], 12)).toBeNull();
  });

  it("le righe di più nodi sulla stessa riga contano una volta, e i riquadri vuoti non contano", () => {
    const lines = [{ top: 0, bottom: 20 }, { top: 0, bottom: 20 }, { top: 20, bottom: 20 }, { top: 20, bottom: 40 }];
    expect(wholeLinesCut(lines, 30)).toBe(20);
  });

  it("non taglia dentro un riquadro più alto della sua riga: il pulsante sta intero o non si vede", () => {
    // Una riga fino a 30, poi un pulsante da 34 a 58 con il testo da 38 a 54.
    const lines = [{ top: 8, bottom: 30 }, { top: 34, bottom: 58 }, { top: 38, bottom: 54 }];
    expect(wholeLinesCut(lines, 56)).toBe(30);
    expect(wholeLinesCut(lines, 58)).toBeNull();
    expect(wholeLinesCut([...lines, { top: 60, bottom: 80 }], 70)).toBe(58);
  });
});

/// Un contenitore alto `height` (con 8 px sopra e 16 sotto di riempimento) a
/// zoom `zoom`, con quattro paragrafi di una riga alti 22 dal bordo alto 8
/// (finiscono a 30, 52, 74 e 96).
function card(height: number, zoom: number) {
  const clip = document.createElement("div");
  clip.style.padding = "8px 0 16px";
  clip.style.boxSizing = "border-box";
  for (const text of ["uno", "due", "tre", "quattro"]) {
    const p = document.createElement("p");
    p.textContent = text;
    clip.append(p);
  }
  document.body.append(clip);
  Object.defineProperty(clip, "offsetHeight", { configurable: true, get: () => height });
  Object.defineProperty(clip, "clientHeight", { configurable: true, get: () => height });
  Object.defineProperty(clip, "scrollHeight", { configurable: true, get: () => 8 + 4 * 22 + 16 });
  const top = 100;
  clip.getBoundingClientRect = () => new DOMRect(0, top, 200, height * zoom);
  const texts = [...clip.querySelectorAll("p")].map((p) => p.firstChild!);
  vi.spyOn(Range.prototype, "getClientRects").mockImplementation(function (this: Range) {
    const index = texts.indexOf(this.startContainer as ChildNode);
    const lineTop = 8 + index * 22;
    return [new DOMRect(0, top + lineTop * zoom, 100, 22 * zoom)] as unknown as DOMRectList;
  });
  return clip;
}

describe("fitWholeLines", () => {
  it("taglia il bordo del riempimento sotto la fine dell'ultima riga intera, a ogni zoom", () => {
    for (const zoom of [0.6, 1]) {
      // 92 px: il riempimento sotto si vedrebbe fino a 92, la terza riga
      // finisce a 74 e la quarta (fino a 96) no.
      const clip = card(92, zoom);
      fitWholeLines(clip);
      expect(clip.style.getPropertyValue(CUT_PROPERTY)).toBe("74px");
      clip.remove();
      // 70 px: la terza riga (fino a 74) non entra.
      const small = card(70, zoom);
      fitWholeLines(small);
      expect(small.style.getPropertyValue(CUT_PROPERTY)).toBe("52px");
      small.remove();
    }
  });

  it("un controllo tutto sotto il taglio è inert finché resta fuori, e il fuoco torna quando ci sta", () => {
    const clip = card(70, 1);
    const button = document.createElement("button");
    button.textContent = "Estrai in una nota…";
    clip.append(button);
    // Sotto la quarta riga: da 100 a 124.
    let buttonTop = 100;
    button.getBoundingClientRect = () => new DOMRect(0, 100 + buttonTop, 100, 24);
    const inertByOthers = document.createElement("button");
    inertByOthers.inert = true;
    inertByOthers.getBoundingClientRect = () => new DOMRect(0, 100 + 8, 100, 20);
    clip.append(inertByOthers);
    // happy-dom non applica la pelle: la regola del taglio la mette qui.
    const maxHeight = () => clip.style.getPropertyValue(CUT_PROPERTY) || "none";
    const real = window.getComputedStyle;
    vi.spyOn(window, "getComputedStyle").mockImplementation((element, pseudo) => {
      const style = real(element, pseudo);
      if (element !== clip) return style;
      return new Proxy(style, { get: (target, key) => (key === "maxHeight" ? maxHeight() : Reflect.get(target, key)) });
    });
    fitWholeLines(clip);
    expect(clip.style.getPropertyValue(CUT_PROPERTY)).toBe("52px");
    expect(button.inert).toBe(true);
    expect(inertByOthers.inert).toBe(true);
    // Il contenitore cresce: il pulsante (da 8 a 32, sopra tutto) torna.
    Object.defineProperty(clip, "offsetHeight", { configurable: true, get: () => 200 });
    Object.defineProperty(clip, "clientHeight", { configurable: true, get: () => 200 });
    Object.defineProperty(clip, "scrollHeight", { configurable: true, get: () => 200 });
    clip.getBoundingClientRect = () => new DOMRect(0, 100, 200, 200);
    buttonTop = 8;
    fitWholeLines(clip);
    expect(clip.style.getPropertyValue(CUT_PROPERTY)).toBe("");
    expect(button.inert).toBe(false);
    expect(button.hasAttribute("data-canvas-cut-inert")).toBe(false);
    // Quello inert per altri resta com'era.
    expect(inertByOthers.inert).toBe(true);
  });

  it("dove il taglio non vale (la nota attiva scorre) nessun controllo diventa inert", () => {
    const clip = card(70, 1);
    const button = document.createElement("button");
    clip.append(button);
    button.getBoundingClientRect = () => new DOMRect(0, 200, 100, 24);
    fitWholeLines(clip);
    expect(clip.style.getPropertyValue(CUT_PROPERTY)).toBe("52px");
    expect(button.inert).toBe(false);
  });

  it("senza troppo testo, o senza layout, non taglia e toglie il taglio di prima", () => {
    const clip = card(200, 1);
    clip.style.setProperty(CUT_PROPERTY, "40px");
    fitWholeLines(clip);
    expect(clip.style.getPropertyValue(CUT_PROPERTY)).toBe("");
    const hidden = card(0, 1);
    fitWholeLines(hidden);
    expect(hidden.style.getPropertyValue(CUT_PROPERTY)).toBe("");
  });

  it("watchWholeLines taglia prima del disegno, rifà con `refit` e smette con la sua vita", async () => {
    const clip = card(70, 1);
    const life = openLifetime();
    const frame = () => new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
    const lines = watchWholeLines(clip, life);
    expect(clip.style.getPropertyValue(CUT_PROPERTY)).toBe("");
    await frame();
    expect(clip.style.getPropertyValue(CUT_PROPERTY)).toBe("52px");
    Object.defineProperty(clip, "offsetHeight", { configurable: true, get: () => 92 });
    Object.defineProperty(clip, "clientHeight", { configurable: true, get: () => 92 });
    clip.getBoundingClientRect = () => new DOMRect(0, 100, 200, 92);
    lines.refit();
    await frame();
    expect(clip.style.getPropertyValue(CUT_PROPERTY)).toBe("74px");
    life.close();
    clip.style.removeProperty(CUT_PROPERTY);
    lines.refit();
    await frame();
    expect(clip.style.getPropertyValue(CUT_PROPERTY)).toBe("");
  });
});
