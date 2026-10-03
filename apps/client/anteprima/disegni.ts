// I disegni del vault dell'anteprima: la shell (a /index.html) li apre come
// disegni, perché l'host dell'anteprima dichiara la feature `draw`. Vivono solo
// nel ramo d'anteprima, come il resto di `anteprima/`.

const HEAD =
  '<svg xmlns="http://www.w3.org/2000/svg" xmlns:fub="https://fubeo.github.io/ns/scene/1" fub:version="1" viewBox="0 0 800 600">';

export const DISEGNI: Record<string, string> = {
  /// Un disegno di FubDraw: si apre nel Disegno, con gli strumenti.
  "Disegni/Casa.svg": [
    HEAD,
    "  <title>Casa</title>",
    '  <g id="l1" fub:layer="Livello 1">',
    '    <rect id="o1a2b3c4d" x="250" y="260" width="300" height="220" fill="none" stroke="#000000" stroke-width="4"/>',
    '    <path id="o5e6f7a8b" d="M230 270 L400 130 L570 270" fill="none" stroke="#D55E00" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>',
    '    <rect id="o9a0b1c2d" x="370" y="380" width="60" height="100" fill="none" stroke="#0072B2" stroke-width="4"/>',
    '    <ellipse id="o3e4f5a6b" cx="640" cy="120" rx="50" ry="50" fill="none" stroke="#E69F00" stroke-width="4"/>',
    "  </g>",
    "</svg>",
    "",
  ].join("\n"),
  /// Un SVG fatto altrove: si guarda come immagine, e «Modifica» lo adotta.
  "Disegni/Logo esterno.svg": [
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200">',
    "  <title>Logo esterno</title>",
    '  <circle cx="100" cy="100" r="80" fill="#009E73"/>',
    '  <path d="M60 100 L90 130 L145 70" fill="none" stroke="#FFFFFF" stroke-width="14" stroke-linecap="round" stroke-linejoin="round"/>',
    "</svg>",
    "",
  ].join("\n"),
  /// Un file che non si legge come disegno: l'avviso dice dove.
  "Disegni/Rotto.svg": '<svg xmlns="http://www.w3.org/2000/svg" fub:version="1"><g></svg>\n',
};
