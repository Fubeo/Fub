import { describe, expect, it } from "vitest";
import {
  allowedAttribute,
  resultOfTag,
  external,
  isAllowedLink,
  inContentSpace,
  isAllowedResource,
  isAllowedStyle,
  attributeValue,
} from "./sanitize";

// La **politica** del punto unico di sanitizzazione (§3.6): funzioni pure, e
// per questo il file gira **senza DOM**. Qui c'era scritto che il cammino sul
// DOM «non è testato perché questa shell non ha un ambiente DOM nei test
// (§17.2)»: la seconda metà ha smesso di essere vera con `happy-dom` (0112), e
// il cammino si prova in `sanitize.dom.test.ts`, che l'ambiente ce l'ha —
// l'ambiente è per file, quindi sono due file e non due `describe`.
//
// La divisione fra politica e cammino resta deliberata ed è la stessa della
// decisione 0016 col riconciliatore — ciò in cui si sbaglia in un modo che non
// si vede è la decisione, non l'`appendChild`.

describe("cosa entra nella webview", () => {
  it("un tag sconosciuto perde il tag e tiene i figli, uno eseguibile sparisce", () => {
    // Non sono lo stesso «no»: un `<section>` che il rendering non doveva
    // produrre non deve portarsi via il paragrafo che contiene.
    expect(resultOfTag("section")).toBe("scarta-tag");
    expect(resultOfTag("script")).toBe("cancella");
    expect(resultOfTag("iframe")).toBe("cancella");
    expect(resultOfTag("p")).toBe("tieni");
    // Il case del tag non è un modo per rientrare.
    expect(resultOfTag("ScRiPt")).toBe("cancella");
  });

  it("nessun gestore di evento passa, in nessuna forma", () => {
    for (const attr of ["onerror", "onclick", "ONLOAD", "onmouseover"]) {
      expect(allowedAttribute("img", attr)).toBe(false);
      expect(allowedAttribute("div", attr)).toBe(false);
    }
  });

  it("i data-* passano tutti: sono il canale fra rendering e shell", () => {
    // Sono il contratto vero — senza, metà dell'anteprima si spegne.
    expect(allowedAttribute("a", "data-wikilink-page")).toBe(true);
    expect(allowedAttribute("div", "data-embed-page")).toBe(true);
    expect(allowedAttribute("div", "data-ui-slot")).toBe(true);
    // E non possono eseguire niente, perché nessuno li interpreta come markup.
  });

  it("un attributo ammesso su un tag non lo è su tutti", () => {
    expect(allowedAttribute("a", "href")).toBe(true);
    expect(allowedAttribute("div", "href")).toBe(false);
    expect(allowedAttribute("img", "src")).toBe(true);
    expect(allowedAttribute("div", "src")).toBe(false);
  });

  it("lo style passa solo per l'allineamento delle colonne", () => {
    // È ciò che il provider markdown emette, e nient'altro.
    expect(isAllowedStyle("text-align:left")).toBe(true);
    expect(isAllowedStyle("text-align: center")).toBe(true);
    expect(isAllowedStyle("position:fixed;top:0")).toBe(false);
    expect(isAllowedStyle("background:url(https://tracker.invalid/x)")).toBe(false);
    // Ammettere l'attributo non è ammettere il valore.
    expect(allowedAttribute("td", "style")).toBe(true);
  });

  it("un link è navigazione: relativo e http passano, javascript e data no", () => {
    expect(isAllowedLink("nota.md")).toBe(true);
    expect(isAllowedLink("#titolo")).toBe(true);
    expect(isAllowedLink("https://esempio.invalid/x")).toBe(true);
    expect(isAllowedLink("mailto:a@b.invalid")).toBe(true);
    expect(isAllowedLink("javascript:alert(1)")).toBe(false);
    expect(isAllowedLink("JaVaScRiPt:alert(1)")).toBe(false);
    expect(isAllowedLink("data:text/html,<script>alert(1)</script>")).toBe(false);
    // Protocol-relative: eredita lo schema della pagina ed è remoto lo stesso.
    expect(isAllowedLink("//esempio.invalid/x")).toBe(false);
  });

  it("una risorsa è caricamento, e la differenza col link è tutta qui", () => {
    // Un `src` parte da solo, senza che nessuno clicchi, e dice a chi lo serve
    // che quella nota è aperta.
    expect(isAllowedResource("assets/foto.png")).toBe(true);
    expect(isAllowedResource("https://tracker.invalid/pixel.gif")).toBe(false);
    expect(isAllowedResource("//tracker.invalid/pixel.gif")).toBe(false);
    expect(isAllowedResource("javascript:alert(1)")).toBe(false);
    expect(isAllowedResource("")).toBe(false);
    // Lo stesso URL come LINK è lecito: è l'utente a decidere se seguirlo.
    expect(isAllowedLink("https://tracker.invalid/pixel.gif")).toBe(true);
    // E con il consenso esplicito (5.3, 23.2) la risorsa remota passerà: il
    // parametro esiste già, ciò che manca è dove l'utente lo esprime (§11.1).
    expect(isAllowedResource("https://esempio.invalid/foto.png", true)).toBe(true);
  });

  it("un link che esce dall'app si riconosce", () => {
    expect(external("https://esempio.invalid")).toBe(true);
    expect(external("http://esempio.invalid")).toBe(true);
    expect(external("nota.md")).toBe(false);
    expect(external("#sezione")).toBe(false);
  });

  it("le due metà del prefisso sono la stessa espressione, non due", () => {
    // È la riga che tiene insieme lo scrivere e il cercare. Se qualcuno
    // prefissasse l'`id` e non il frammento — o li prefissasse in due modi —
    // qui i due lati non si toccherebbero più, e ogni legame interno di ogni nota
    // cadrebbe nel vuoto. Il comportamento sta in `sanitize.dom.test.ts`;
    // questa è l'**identità** fra i due lati, che è ciò che si rompe per primo.
    expect(attributeValue("id", "blocco-1")).toBe(
      attributeValue("href", "#blocco-1").slice(1),
    );
    expect(attributeValue("id", "blocco-1")).toBe(inContentSpace("blocco-1"));
  });

  it("l'attributo che non nomina un identificatore passa com'è", () => {
    // La traslazione è per due attributi, non per tutti: un `title` prefissato
    // sarebbe testo mostrato all'utente con dentro il nostro prefisso.
    expect(attributeValue("title", "blocco-1")).toBe("blocco-1");
    expect(attributeValue("class", "callout")).toBe("callout");
    expect(attributeValue("data-wikilink-page", "Nota")).toBe("Nota");
    expect(attributeValue("href", "https://esempio.invalid/#x")).toBe(
      "https://esempio.invalid/#x",
    );
    // Il segnaposto dei wikilink: un `#` solo non nomina niente.
    expect(attributeValue("href", "#")).toBe("#");
  });
});
