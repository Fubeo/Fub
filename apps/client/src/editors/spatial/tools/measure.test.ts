// La larghezza del testo: la stima, i grafemi e la misura del browser, con
// un canvas finto.

import { afterEach, describe, expect, it, vi } from "vitest";
import { browserMeasure, cssFont, estimate, graphemes, loadFonts, type Font } from "./measure";

const INTER: Font = { family: "Inter, sans-serif", size: 10, weight: "normal", style: "normal", spacing: 0 };

describe("i grafemi e la stima", () => {
  it("un grafema è una lettera coi suoi accenti o un'emoji intera", () => {
    expect(graphemes("éa")).toEqual(["é", "a"]);
    expect(graphemes("👨‍👩‍👧!")).toEqual(["👨‍👩‍👧", "!"]);
    expect(graphemes("")).toEqual([]);
  });

  it("ogni grafema è largo 0,6 volte il corpo, più la spaziatura", () => {
    expect(estimate("abc", INTER)).toBeCloseTo(18);
    expect(estimate("é", INTER)).toBeCloseTo(6);
    expect(estimate("ab", { ...INTER, size: 20, spacing: 1.5 })).toBeCloseTo(27);
  });

  it("il carattere come lo scrive CSS", () => {
    expect(cssFont({ ...INTER, weight: "bold", style: "italic" })).toBe("italic bold 10px Inter, sans-serif");
    expect(cssFont(INTER, 100)).toBe("normal normal 100px Inter, sans-serif");
  });
});

describe("la misura del browser", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /// Un canvas che misura 50 pixel per carattere a 100 pixel, e che non
  /// legge un carattere col nome `Rotto`.
  function fakeCanvas(): { calls: string[] } {
    const calls: string[] = [];
    class Context {
      private value = "10px sans-serif";
      get font(): string {
        return this.value;
      }
      set font(css: string) {
        if (!css.includes("Rotto")) this.value = css;
      }
      measureText(text: string): { width: number } {
        calls.push(`${this.value}|${text}`);
        return { width: text.length * 50 };
      }
    }
    vi.stubGlobal(
      "OffscreenCanvas",
      class {
        getContext(): Context {
          return new Context();
        }
      },
    );
    return { calls };
  }

  it("senza canvas non c'è", () => {
    vi.stubGlobal("OffscreenCanvas", undefined);
    expect(browserMeasure()).toBeNull();
  });

  it("misura a 100 pixel e scala al corpo, con la spaziatura dopo ogni grafema", () => {
    fakeCanvas();
    const measure = browserMeasure()!;
    expect(measure("abcd", INTER)).toBeCloseTo(20);
    expect(measure("abcd", { ...INTER, size: 30, spacing: 2 })).toBeCloseTo(68);
    expect(measure("", INTER)).toBe(0);
    expect(measure("abc", { ...INTER, size: 0 })).toBe(0);
  });

  it("ricorda le larghezze per carattere e per testo", () => {
    const { calls } = fakeCanvas();
    const measure = browserMeasure()!;
    measure("ciao", INTER);
    measure("ciao", { ...INTER, size: 48 });
    measure("ciao", { ...INTER, weight: "bold" });
    expect(calls).toEqual(["normal normal 100px Inter, sans-serif|ciao", "normal bold 100px Inter, sans-serif|ciao"]);
  });

  it("non ricorda le misure di un carattere che sta ancora arrivando", () => {
    const { calls } = fakeCanvas();
    let loaded = false;
    vi.stubGlobal("document", { fonts: { check: () => loaded } });
    const measure = browserMeasure()!;
    measure("ciao", INTER);
    measure("ciao", INTER);
    loaded = true;
    measure("ciao", INTER);
    measure("ciao", INTER);
    expect(calls).toHaveLength(3);
  });

  it("con la spaziatura, dove il canvas la mette, la mette lui: come SVG spegne le legature", () => {
    const calls: string[] = [];
    class Context {
      font = "10px sans-serif";
      letterSpacing = "0px";
      measureText(text: string): { width: number } {
        calls.push(`${this.letterSpacing}|${text}`);
        // «fi» è una legatura larga quanto una lettera, senza spaziatura.
        const letters = this.letterSpacing === "0px" ? text.replace("fi", "f").length : text.length;
        return { width: letters * 50 + text.length * parseFloat(this.letterSpacing) };
      }
    }
    vi.stubGlobal("OffscreenCanvas", class {
      getContext(): Context {
        return new Context();
      }
    });
    const measure = browserMeasure()!;
    expect(measure("fine", INTER)).toBeCloseTo(15);
    // A corpo 10 la spaziatura 2 è 20 pixel a 100: dopo ogni lettera, senza
    // legatura.
    expect(measure("fine", { ...INTER, spacing: 2 })).toBeCloseTo(28);
    expect(measure("fine", { ...INTER, spacing: 2 })).toBeCloseTo(28);
    expect(calls).toEqual(["0px|fine", "20px|fine"]);
  });

  it("un carattere che il browser non legge si stima", () => {
    fakeCanvas();
    const measure = browserMeasure()!;
    expect(measure("abc", { ...INTER, family: "Rotto" })).toBeCloseTo(estimate("abc", INTER));
  });
});

describe("i caratteri da caricare", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("chiede al browser solo quelli che non ha, una volta ciascuno", async () => {
    const load = vi.fn(async () => []);
    const check = vi.fn((css: string) => css.includes("Literata"));
    vi.stubGlobal("document", { fonts: { check, load } });
    await loadFonts([INTER, { ...INTER, size: 30 }, { ...INTER, family: "Literata, serif" }, { ...INTER, size: 0 }]);
    expect(load.mock.calls).toEqual([["normal normal 100px Inter, sans-serif"]]);
  });

  it("senza documento non c'è niente da chiedere", async () => {
    await expect(loadFonts([INTER])).resolves.toBeUndefined();
  });
});
