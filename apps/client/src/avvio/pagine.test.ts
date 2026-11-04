// @vitest-environment happy-dom
//
// Lo strato d'avvio sta in linea nelle tre pagine, e deve essere lo stesso:
// chi ne cambia una e non le altre ha una finestra documento, o un telefono,
// che lampeggia di nuovo. Qui si legge l'HTML vero come documento.
import { describe, expect, it } from "vitest";
import { IT } from "../i18n/catalog";
import desktop from "../../index.html?raw";
import mobile from "../../mobile.html?raw";
import documento from "../../document.html?raw";

const PAGINE = { "index.html": desktop, "mobile.html": mobile, "document.html": documento };

function parse(html: string): Document {
  return new DOMParser().parseFromString(html, "text/html");
}

/// I tre pezzi dello strato di una pagina, come testo.
function strato(html: string): { stile: string; senzaJs: string; markup: string } {
  const doc = parse(html);
  const stile = doc.getElementById("avvio-stile");
  const senzaJs = doc.head.querySelector("noscript");
  const markup = doc.body.querySelector(".avvio");
  return {
    stile: stile?.textContent ?? "",
    senzaJs: senzaJs?.innerHTML ?? "",
    markup: markup?.outerHTML ?? "",
  };
}

describe("lo strato d'avvio nelle tre pagine", () => {
  it("stile, frase senza JS e markup sono identici", () => {
    const [prima, ...altre] = Object.values(PAGINE).map(strato);
    expect(prima.stile.length).toBeGreaterThan(2000);
    expect(prima.senzaJs).toContain(".avvio-senza-js");
    expect(prima.markup).toContain('class="avvio"');
    for (const altra of altre) expect(altra).toEqual(prima);
  });

  it.each(Object.entries(PAGINE))("%s: lo stile viene prima di ogni script, luce.js è sincrono, stati.js defer", (_, html) => {
    const doc = parse(html);
    const tutti = [...doc.querySelectorAll("style, script, link[rel='preload']")];
    const stile = doc.getElementById("avvio-stile")!;
    const script = [...doc.querySelectorAll("script")];
    expect(stile.parentElement).toBe(doc.head);
    for (const uno of script) expect(tutti.indexOf(stile)).toBeLessThan(tutti.indexOf(uno));
    // I due caratteri prima dello stile, così la richiesta parte subito.
    const caratteri = tutti.slice(0, tutti.indexOf(stile)).map((el) => el.getAttribute("href"));
    expect(caratteri).toEqual([
      "/fonts/newsreader-latin-opsz-italic.woff2",
      "/fonts/hanken-grotesk-latin-wght-normal.woff2",
    ]);
    for (const link of doc.querySelectorAll("link[rel='preload']")) {
      expect(link.getAttribute("as")).toBe("font");
      expect(link.getAttribute("type")).toBe("font/woff2");
      expect(link.hasAttribute("crossorigin")).toBe(true);
    }
    const [luce, stati] = script;
    expect(luce.getAttribute("src")).toBe("/avvio/luce.js");
    expect(luce.hasAttribute("defer") || luce.hasAttribute("async") || luce.hasAttribute("type")).toBe(false);
    expect(stati.getAttribute("src")).toBe("/avvio/stati.js");
    expect(stati.hasAttribute("defer")).toBe(true);
    expect(stati.hasAttribute("type")).toBe(false);
    // Lo strato è il primo figlio del corpo.
    expect(doc.body.firstElementChild?.classList.contains("avvio")).toBe(true);
  });

  it("il CSS in linea non nomina l'id e non si chiude prima del tempo", () => {
    const html = desktop;
    const { stile } = strato(html);
    expect(stile).not.toContain("#avvio");
    expect(stile.toLowerCase()).not.toContain("</style");
    // Il testo dell'elemento arriva fino all'ultima regola: un `</style` in un
    // commento lo taglierebbe a metà.
    const aperto = html.indexOf('<style id="avvio-stile">');
    const grezzo = html.slice(aperto + '<style id="avvio-stile">'.length, html.indexOf("</style>", aperto));
    expect(stile).toBe(grezzo);
    expect(stile).toContain("@media (forced-colors: active)");
    // Famiglie proprie: quelle di fonts.css restano di fonts.css.
    expect(stile).toContain('font-family: "Avvio Newsreader"');
    expect(stile).toContain('font-family: "Avvio Hanken"');
    expect(stile).not.toMatch(/Newsreader Variable|Hanken Grotesk Variable/);
  });

  it("ogni testo dello strato ha la sua chiave nel catalogo, e l'HTML ne porta l'italiano", () => {
    const doc = parse(desktop);
    const nominati = [...doc.querySelectorAll(".avvio [data-i18n]")];
    expect(nominati.length).toBeGreaterThanOrEqual(5);
    for (const el of nominati) {
      const chiave = el.getAttribute("data-i18n")!;
      expect(chiave in IT, chiave).toBe(true);
      expect(el.textContent?.trim(), chiave).toBe(IT[chiave as keyof typeof IT]);
    }
    // L'annuncio è vuoto finché il marchio non entra.
    const annuncio = doc.querySelector(".avvio-annuncio")!;
    expect(annuncio.getAttribute("role")).toBe("status");
    expect(annuncio.textContent).toBe("");
  });

  it("l'app è inerte sotto lo strato, e solo lei", () => {
    for (const [nome, html] of Object.entries(PAGINE)) {
      const doc = parse(html);
      const inerti = [...doc.querySelectorAll("[inert]")].map((el) => el.id || el.className);
      const attesi = nome === "document.html" ? ["document-window"] : ["skip-link", "app"];
      expect(inerti, nome).toEqual(attesi);
      for (const el of doc.querySelectorAll("[inert]")) expect(el.getAttribute("aria-busy"), nome).toBe("true");
    }
  });
});
