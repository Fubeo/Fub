// La griglia di trasparenza (K6 T11): lo scacchiere delle carte e il foglio senza
// riempimento stanno nella pelle del disegno. Il sanitizzatore del caricamento scarta
// in silenzio ciò che non ammette (un `conic-gradient`, per esempio), e la carta resta
// bianca: questo test fa cadere la regola se succede di nuovo.
import { describe, expect, it } from "vitest";
import { sanitizeThemeCss, type ThemeCssPolicy } from "../../ui/sanitize-css";
import { THEME_2_PROFILE } from "./profile";
import skin from "./skin.css?raw";

// La stessa politica che il caricamento dà alla pelle dello Scrittoio (`THEME_2_PROFILE`).
const profilo = THEME_2_PROFILE;
const POLICY: ThemeCssPolicy = {
  kind: "skin",
  assetNamespace: "",
  allowedHooks: profilo.hooks,
  requiredRoles: profilo.requiredRoles,
  vocabulary: profilo.vocabulary,
  gate: profilo.gate,
};

describe("la griglia di trasparenza passa il sanitizzatore della pelle", () => {
  const sanificato = sanitizeThemeCss(skin, POLICY);

  it("lo scacchiere resta fatto di gradienti lineari, che il sanitizzatore ammette", () => {
    // Il controllo è sul blocco: una dichiarazione scartata in silenzio lascerebbe il selettore.
    expect(sanificato).toMatch(/\.draw-surface\[data-transparency\] \.draw-page\s*\{[^}]*background-image:\s*linear-gradient\(45deg/);
    expect(sanificato).not.toMatch(/conic-gradient\(/);
  });

  it("il foglio del documento perde il suo riempimento con la griglia accesa", () => {
    expect(sanificato).toMatch(/\.draw-surface\[data-transparency\] \[data-paper\]\s*\{\s*fill:\s*none/);
  });
});
