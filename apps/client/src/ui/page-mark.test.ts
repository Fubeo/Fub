// @vitest-environment happy-dom
//
// Il segno di una cartella o di una nota (Scrittoio 2, D7): un valore solo,
// la stessa stringa di sempre, che è un'emoji o una figura `fub:<nome>`.
import { describe, expect, it } from "vitest";

import {
  drawPageMark,
  figureLabel,
  figureMask,
  figureValue,
  PAGE_FIGURES,
  pageMarkContent,
  pageMarkLabel,
  pageMarkText,
  pageMarkValue,
  readPageMark,
} from "./page-mark";

describe("che cosa vuol dire un valore d'icona", () => {
  it("`fub:<nome>` con un nome noto è una figura", () => {
    expect(readPageMark("fub:book")).toEqual({ kind: "figure", name: "book" });
    expect(readPageMark(" fub:music ")).toEqual({ kind: "figure", name: "music" });
    for (const name of PAGE_FIGURES) expect(readPageMark(figureValue(name))).toEqual({ kind: "figure", name });
  });

  it("un'emoji, anche composta, o una lettera è un testo, com'era", () => {
    expect(readPageMark("🌱")).toEqual({ kind: "text", text: "🌱" });
    expect(readPageMark("🇮🇹")).toEqual({ kind: "text", text: "🇮🇹" });
    expect(readPageMark("👨‍👩‍👧‍👦")).toEqual({ kind: "text", text: "👨‍👩‍👧‍👦" });
    expect(readPageMark("A")).toEqual({ kind: "text", text: "A" });
  });

  it("un `fub:` con un nome sconosciuto non si disegna, e non è un errore", () => {
    expect(readPageMark("fub:astronave")).toBeNull();
    expect(readPageMark("fub:")).toBeNull();
    // `star` è della cornice, non delle figure che si scelgono.
    expect(readPageMark("fub:star")).toBeNull();
    expect(pageMarkContent("fub:astronave")).toBeNull();
    expect(pageMarkText("fub:astronave")).toBeNull();
    expect(pageMarkLabel("fub:astronave")).toBeNull();
  });

  it("niente valore, niente segno", () => {
    expect(readPageMark(null)).toBeNull();
    expect(readPageMark(undefined)).toBeNull();
    expect(readPageMark("  ")).toBeNull();
  });
});

describe("che cosa si accetta da `icon:`", () => {
  it("un testo breve o una figura, anche sconosciuta", () => {
    expect(pageMarkValue(" 🌱 ")).toBe("🌱");
    expect(pageMarkValue("fub:book")).toBe("fub:book");
    expect(pageMarkValue("fub:astronave")).toBe("fub:astronave");
  });

  it("non un path, un indirizzo o un `fub:` che non è un nome", () => {
    expect(pageMarkValue("img/foglia.png")).toBeNull();
    expect(pageMarkValue("https://notion.so/icon.png")).toBeNull();
    expect(pageMarkValue("fub://book")).toBeNull();
    expect(pageMarkValue("fub:Book")).toBeNull();
    expect(pageMarkValue("fub:../x")).toBeNull();
    expect(pageMarkValue("a:b")).toBeNull();
    expect(pageMarkValue(3)).toBeNull();
  });
});

describe("dove si mette", () => {
  it("in una riga: la figura è un svg, l'emoji un testo", () => {
    const figure = document.createElement("span");
    expect(drawPageMark(figure, "fub:book")).toBe(true);
    expect(figure.querySelector("svg")?.getAttribute("data-icon")).toBe("book");
    expect(figure.dataset.pageFigure).toBe("book");
    expect(figure.textContent).toBe("");

    const emoji = document.createElement("span");
    expect(drawPageMark(emoji, "🌱")).toBe(true);
    expect(emoji.textContent).toBe("🌱");
    expect(emoji.dataset.pageFigure).toBeUndefined();

    // Ridisegnare toglie ciò che c'era, anche la marca della figura.
    expect(drawPageMark(figure, "fub:astronave")).toBe(false);
    expect(figure.childNodes).toHaveLength(0);
    expect(figure.dataset.pageFigure).toBeUndefined();
  });

  it("in un nome: l'emoji sì, la figura no", () => {
    expect(pageMarkText("🌱")).toBe("🌱");
    expect(pageMarkText("fub:book")).toBeNull();
  });

  it("per chi ascolta: l'emoji stessa o il nome della figura", () => {
    expect(pageMarkLabel("🌱")).toBe("🌱");
    expect(pageMarkLabel("fub:book")).toBe(figureLabel("book"));
    expect(figureLabel("book")).toBe("Libro");
  });

  it("ogni figura ha la sua maschera, un svg completo", () => {
    for (const name of PAGE_FIGURES) {
      const mask = figureMask(name);
      expect(mask.startsWith('url("data:image/svg+xml,')).toBe(true);
      expect(decodeURIComponent(mask)).toContain('xmlns="http://www.w3.org/2000/svg"');
      // Le virgolette dell'svg sono codificate: l'url non si chiude prima.
      expect(mask.slice('url("'.length, -'")'.length)).not.toContain('"');
    }
  });
});
