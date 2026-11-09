// @vitest-environment happy-dom
//
// Marcuzzo (D26) sta in più posti: il disegno in `assets/logo/`, la copia del
// client per le Informazioni, il marchio della barra e l'avvio in linea nelle
// pagine. Qui ogni copia resta uguale alla sua forma, così il logo si cambia
// in un posto solo e i test dicono dove ricopiarlo.
import { describe, expect, it } from "vitest";
import desktop from "../../index.html?raw";
import mobile from "../../mobile.html?raw";
import documento from "../../document.html?raw";
import intera from "../../../../assets/logo/marcuzzo.svg?raw";
import minima24 from "../../../../assets/logo/marcuzzo-24.svg?raw";
import minima16 from "../../../../assets/logo/marcuzzo-16.svg?raw";
import { MARCUZZO_SVG, marcuzzoElement } from "./marcuzzo";

const FORME: Readonly<Record<string, string>> = {
  "marcuzzo.svg": intera,
  "marcuzzo-24.svg": minima24,
  "marcuzzo-16.svg": minima16,
};
const forma = (nome: string): string => FORME[nome]!;

/// I tracciati di un SVG, con classe, colore e forma: ciò che si vede.
function tracciati(svg: Element): string[] {
  return [...svg.querySelectorAll("path")].map(
    (path) => `${path.getAttribute("class") ?? ""}|${path.getAttribute("fill") ?? ""}|${path.getAttribute("d") ?? ""}`,
  );
}

function svgDi(testo: string): Element {
  return new DOMParser().parseFromString(testo, "image/svg+xml").documentElement;
}

function pagina(html: string): Document {
  return new DOMParser().parseFromString(html, "text/html");
}

describe("Marcuzzo, ovunque sia, è la sua forma", () => {
  it("la copia del client è assets/logo/marcuzzo.svg byte per byte", () => {
    expect(MARCUZZO_SVG).toBe(forma("marcuzzo.svg"));
  });

  it.each([["index.html", desktop], ["mobile.html", mobile]])(
    "%s: il marchio della barra è la forma minima 24, decorativa, nel bottone del menu",
    (_, html) => {
      const bottone = pagina(html).getElementById("brand-menu")!;
      const svg = bottone.querySelector("svg")!;
      expect(bottone.children).toHaveLength(1);
      expect([...svg.classList]).toEqual(["brand-glyph", "brand-logo", "marcuzzo"]);
      expect(svg.getAttribute("aria-hidden")).toBe("true");
      expect(svg.getAttribute("focusable")).toBe("false");
      expect(svg.querySelector("title")).toBeNull();
      expect(bottone.getAttribute("aria-label")).toBe("Menu di Fub");
      const attesa = svgDi(forma("marcuzzo-24.svg"));
      expect(svg.getAttribute("viewBox")).toBe(attesa.getAttribute("viewBox"));
      expect(tracciati(svg)).toEqual(tracciati(attesa));
    },
  );

  it.each([["index.html", desktop], ["mobile.html", mobile], ["document.html", documento]])(
    "%s: l'avvio mostra la forma intera al posto della «f»",
    (_, html) => {
      const marchio = pagina(html).querySelector(".avvio-marchio")!;
      const svg = marchio.querySelector("svg.avvio-logo")!;
      expect(marchio.querySelector(".avvio-glifo")).toBeNull();
      expect(svg.getAttribute("aria-hidden")).toBe("true");
      expect(svg.getAttribute("focusable")).toBe("false");
      const attesa = svgDi(forma("marcuzzo.svg"));
      expect(svg.getAttribute("viewBox")).toBe(attesa.getAttribute("viewBox"));
      expect(tracciati(svg)).toEqual(tracciati(attesa));
    },
  );

  it("le forme portano i ruoli della cartella, e i fill di Smeraldo come ripiego", () => {
    for (const nome of ["marcuzzo.svg", "marcuzzo-24.svg", "marcuzzo-16.svg"]) {
      const svg = svgDi(forma(nome));
      for (const ruolo of ["logo-cartella", "logo-cartella-retro", "logo-foglio-1", "logo-foglio-2"]) {
        const parti = svg.querySelectorAll(`path.${ruolo}`);
        expect(parti.length, `${nome}: ${ruolo}`).toBeGreaterThan(0);
        for (const parte of parti) expect(parte.getAttribute("fill"), `${nome}: ${ruolo}`).toMatch(/^#[0-9a-f]{6}$/);
      }
    }
  });
});

describe("marcuzzoElement", () => {
  it("costruisce un svg decorativo, senza titolo, con la classe chiesta", () => {
    const svg = marcuzzoElement("about-logo marcuzzo");
    expect(svg.tagName.toLowerCase()).toBe("svg");
    expect(svg.namespaceURI).toBe("http://www.w3.org/2000/svg");
    expect(svg.getAttribute("class")).toBe("about-logo marcuzzo");
    expect(svg.getAttribute("aria-hidden")).toBe("true");
    expect(svg.getAttribute("focusable")).toBe("false");
    expect(svg.querySelector("title")).toBeNull();
    expect(svg.ownerDocument).toBe(document);
    expect(tracciati(svg)).toEqual(tracciati(svgDi(forma("marcuzzo.svg"))));
  });

  it("ogni chiamata dà un elemento nuovo", () => {
    expect(marcuzzoElement("a")).not.toBe(marcuzzoElement("a"));
  });
});
