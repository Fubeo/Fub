import { describe, expect, it } from "vitest";
import {
  attributoConsentito,
  esitoDelTag,
  esterno,
  linkConsentito,
  risorsaConsentita,
  styleConsentito,
} from "./sanitize";

// La **politica** del punto unico di sanitizzazione (§3.6). Il cammino sul DOM
// non è qui e non è testato: questa shell non ha un ambiente DOM nei test
// (§17.2). La divisione è deliberata ed è la stessa della decisione 0016 col
// riconciliatore — ciò in cui si sbaglia in un modo che non si vede è la
// decisione, non l'`appendChild`.

describe("cosa entra nella webview", () => {
  it("un tag sconosciuto perde il tag e tiene i figli, uno eseguibile sparisce", () => {
    // Non sono lo stesso «no»: un `<section>` che il rendering non doveva
    // produrre non deve portarsi via il paragrafo che contiene.
    expect(esitoDelTag("section")).toBe("scarta-tag");
    expect(esitoDelTag("script")).toBe("cancella");
    expect(esitoDelTag("iframe")).toBe("cancella");
    expect(esitoDelTag("p")).toBe("tieni");
    // Il case del tag non è un modo per rientrare.
    expect(esitoDelTag("ScRiPt")).toBe("cancella");
  });

  it("nessun gestore di evento passa, in nessuna forma", () => {
    for (const attr of ["onerror", "onclick", "ONLOAD", "onmouseover"]) {
      expect(attributoConsentito("img", attr)).toBe(false);
      expect(attributoConsentito("div", attr)).toBe(false);
    }
  });

  it("i data-* passano tutti: sono il canale fra rendering e shell", () => {
    // Sono il contratto vero — senza, metà dell'anteprima si spegne.
    expect(attributoConsentito("a", "data-wikilink-page")).toBe(true);
    expect(attributoConsentito("div", "data-embed-page")).toBe(true);
    expect(attributoConsentito("div", "data-ui-slot")).toBe(true);
    // E non possono eseguire niente, perché nessuno li interpreta come markup.
  });

  it("un attributo ammesso su un tag non lo è su tutti", () => {
    expect(attributoConsentito("a", "href")).toBe(true);
    expect(attributoConsentito("div", "href")).toBe(false);
    expect(attributoConsentito("img", "src")).toBe(true);
    expect(attributoConsentito("div", "src")).toBe(false);
  });

  it("lo style passa solo per l'allineamento delle colonne", () => {
    // È ciò che il provider markdown emette, e nient'altro.
    expect(styleConsentito("text-align:left")).toBe(true);
    expect(styleConsentito("text-align: center")).toBe(true);
    expect(styleConsentito("position:fixed;top:0")).toBe(false);
    expect(styleConsentito("background:url(https://tracker.invalid/x)")).toBe(false);
    // Ammettere l'attributo non è ammettere il valore.
    expect(attributoConsentito("td", "style")).toBe(true);
  });

  it("un link è navigazione: relativo e http passano, javascript e data no", () => {
    expect(linkConsentito("nota.md")).toBe(true);
    expect(linkConsentito("#titolo")).toBe(true);
    expect(linkConsentito("https://esempio.invalid/x")).toBe(true);
    expect(linkConsentito("mailto:a@b.invalid")).toBe(true);
    expect(linkConsentito("javascript:alert(1)")).toBe(false);
    expect(linkConsentito("JaVaScRiPt:alert(1)")).toBe(false);
    expect(linkConsentito("data:text/html,<script>alert(1)</script>")).toBe(false);
    // Protocol-relative: eredita lo schema della pagina ed è remoto lo stesso.
    expect(linkConsentito("//esempio.invalid/x")).toBe(false);
  });

  it("una risorsa è caricamento, e la differenza col link è tutta qui", () => {
    // Un `src` parte da solo, senza che nessuno clicchi, e dice a chi lo serve
    // che quella nota è aperta.
    expect(risorsaConsentita("assets/foto.png")).toBe(true);
    expect(risorsaConsentita("https://tracker.invalid/pixel.gif")).toBe(false);
    expect(risorsaConsentita("//tracker.invalid/pixel.gif")).toBe(false);
    expect(risorsaConsentita("javascript:alert(1)")).toBe(false);
    expect(risorsaConsentita("")).toBe(false);
    // Lo stesso URL come LINK è lecito: è l'utente a decidere se seguirlo.
    expect(linkConsentito("https://tracker.invalid/pixel.gif")).toBe(true);
    // E con il consenso esplicito (5.3, 23.2) la risorsa remota passerà: il
    // parametro esiste già, ciò che manca è dove l'utente lo esprime (§11.1).
    expect(risorsaConsentita("https://esempio.invalid/foto.png", true)).toBe(true);
  });

  it("un link che esce dall'app si riconosce", () => {
    expect(esterno("https://esempio.invalid")).toBe(true);
    expect(esterno("http://esempio.invalid")).toBe(true);
    expect(esterno("nota.md")).toBe(false);
    expect(esterno("#sezione")).toBe(false);
  });
});
