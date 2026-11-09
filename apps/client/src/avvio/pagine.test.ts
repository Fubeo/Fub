// @vitest-environment happy-dom
//
// Lo strato d'avvio sta nel <head> delle tre pagine, e deve essere lo stesso:
// chi ne cambia una e non le altre ha una finestra documento, o un telefono,
// che lampeggia di nuovo. Qui si legge l'HTML vero come documento.
import { describe, expect, it } from "vitest";
import { IT } from "../i18n/catalog";
import desktop from "../../index.html?raw";
import mobile from "../../mobile.html?raw";
import documento from "../../document.html?raw";
import foglio from "../../public/avvio/avvio.css?raw";
import foglioSenzaJs from "../../public/avvio/senza-js.css?raw";

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
    stile: stile?.outerHTML ?? "",
    senzaJs: senzaJs?.innerHTML ?? "",
    markup: markup?.outerHTML ?? "",
  };
}

describe("lo strato d'avvio nelle tre pagine", () => {
  it("stile, frase senza JS e markup sono identici", () => {
    const [prima, ...altre] = Object.values(PAGINE).map(strato);
    expect(prima.stile).toContain('href="/avvio/avvio.css"');
    expect(prima.senzaJs).toContain('href="/avvio/senza-js.css"');
    expect(prima.markup).toContain('class="avvio"');
    for (const altra of altre) expect(altra).toEqual(prima);
  });

  it.each(Object.entries(PAGINE))("%s: lo stile viene prima di ogni script, luce.js è sincrono, stati.js defer", (_, html) => {
    const doc = parse(html);
    const tutti = [...doc.querySelectorAll("style, script, link[rel='preload'], link[rel='stylesheet']")];
    const stile = doc.getElementById("avvio-stile")!;
    const script = [...doc.querySelectorAll("script")];
    expect(stile.parentElement).toBe(doc.head);
    expect(stile.tagName).toBe("LINK");
    expect(stile.getAttribute("rel")).toBe("stylesheet");
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

  // Tauri mette un nonce a ogni <style> delle pagine e lo aggiunge a
  // `style-src`: con un nonce la WebView ignora `'unsafe-inline'`, e gli
  // elementi <style> che CodeMirror e gli altri moduli aggiungono a pagina
  // avviata vengono rifiutati (gli editor senza stile, S7 di bench:webview).
  // Uno script in linea lo vieta già `script-src 'self'`.
  it.each(Object.entries(PAGINE))("%s: niente <style> né script in linea", (_, html) => {
    expect(html).not.toMatch(/<style[\s>]/i);
    for (const script of parse(html).querySelectorAll("script")) {
      expect(script.getAttribute("src"), script.outerHTML).toBeTruthy();
      expect(script.textContent?.trim()).toBe("");
    }
  });

  it("il foglio dello strato non nomina l'id, e ha le sue famiglie", () => {
    expect(foglio).not.toContain("#avvio");
    expect(foglio).toContain("@media (forced-colors: active)");
    // Famiglie proprie: quelle di fonts.css restano di fonts.css.
    expect(foglio).toContain('font-family: "Avvio Newsreader"');
    expect(foglio).toContain('font-family: "Avvio Hanken"');
    expect(foglio).not.toMatch(/Newsreader Variable|Hanken Grotesk Variable/);
    expect(foglioSenzaJs).toContain(".avvio-senza-js { display: block; }");
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

  it("lo strato è una regione col nome dal catalogo (axe «region»), e i suoi testi ci stanno dentro", () => {
    for (const [nome, html] of Object.entries(PAGINE)) {
      const avvio = parse(html).querySelector(".avvio")!;
      expect(avvio.getAttribute("role"), nome).toBe("region");
      const etichetta = avvio.querySelector(`#${avvio.getAttribute("aria-labelledby")}`)!;
      expect(etichetta.getAttribute("data-i18n"), nome).toBe("app.avvio.regione");
      expect(etichetta.hasAttribute("hidden"), nome).toBe(true);
      // stati.js cerca l'annuncio per classe: l'etichetta non deve prenderne il posto.
      expect(avvio.querySelector(".avvio-annuncio")!.id, nome).toBe("avvio-annuncio");
    }
  });

  it("col moto ridotto ciò che compare è visibile subito: il fuoco su Riprova non trova un bottone nascosto", () => {
    const stile = foglio.replace(/\s+/g, " ");
    for (const prefisso of ["", ':root[data-avvio-moto="ridotto"] ']) {
      const regola = `${prefisso}.avvio[data-stato="guasto"] .avvio-guasto { transition: opacity 90ms linear; }`;
      expect(stile, prefisso || "@media").toContain(regola);
      // Viene dopo la regola che ritarda visibility, a pari specificità.
      const ritardo = stile.indexOf(`${prefisso}.avvio[data-stato] .avvio-lento { transition: opacity 90ms linear, visibility 0s linear 90ms; }`);
      expect(ritardo, prefisso || "@media").toBeGreaterThan(-1);
      expect(stile.indexOf(regola)).toBeGreaterThan(ritardo);
    }
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
