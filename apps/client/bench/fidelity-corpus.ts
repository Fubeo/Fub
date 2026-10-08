// Il corpus del banco di fedeltà: scene piccole che insieme toccano ogni
// elemento e attributo che il disegno modifica, i testi in ogni carattere
// dell'app, in tondo e in corsivo, coi pezzi di riga, un'immagine, le
// risorse di ogni tipo, i campioni, le sfumature come le scrive FubDraw, le
// tavole con le loro carte, e gli estranei tipici di Inkscape, Illustrator e
// Mermaid. Ogni scena è un disegno intero, grande quanto la sua resa; quella
// che mostra una tavola sola è più grande, e la sua tavola è grande quanto la
// resa.

/// La misura di ogni scena, in pixel CSS.
export const FIDELITY_SIZE = { width: 240, height: 160 } as const;

/// La radice di un disegno di `width` × `height`.
const root = (width: number, height: number): string => '<svg xmlns="http://www.w3.org/2000/svg" xmlns:fub="https://fubeo.github.io/ns/scene/1"'
  + ' xmlns:xlink="http://www.w3.org/1999/xlink" fub:version="1"'
  + ` width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`;
const HEAD = root(FIDELITY_SIZE.width, FIDELITY_SIZE.height);
const LAYER = '<g id="l1" fub:layer="Livello 1">';
const scene = (body: string, head = HEAD): string => `${head}${body}</svg>`;

/// Un PNG di 8 × 8 a scacchi, rosso e blu.
const CHECKER = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAH0lEQVR4nGO4Y6MBRBoVJ4AImc2AUwJTCMLGLUEHOwA5N1UBvmzgIgAAAABJRU5ErkJggg==";

/// La tavola `id`, che si chiama `name`, sul rettangolo `x y w h`.
const board = (id: string, name: string, rect: string): string => `<view id="${id}" fub:role="board" viewBox="${rect}"><title>${name}</title></view>`;

/// La carta `id` della tavola `of`, sul suo rettangolo, col colore `fill`.
const paper = (id: string, of: string, [x, y, width, height]: readonly number[], fill: string): string =>
  `<rect id="${id}" fub:role="paper" fub:board="${of}" x="${x}" y="${y}" width="${width}" height="${height}" fill="${fill}"/>`;

export interface FidelityScene {
  readonly id: string;
  readonly text: string;
  /// Il nome della tavola che la scena mostra da sola: il foglio la guarda
  /// al 100%, la Lettura e l'export sono quelli del suo embed,
  /// `![[disegno#nome]]`. Senza, la scena mostra il disegno intero.
  readonly board?: string;
}

export const FIDELITY: readonly FidelityScene[] = [
  {
    id: "forme",
    text: scene(`${LAYER}<rect id="r1" x="12" y="12" width="70" height="50" fill="#2b6cb0" stroke="#1a202c" stroke-width="3"/>`
      + '<rect id="r2" x="96" y="12" width="60" height="50" rx="12" fill="#f6ad55" fill-opacity="0.6"/>'
      + '<ellipse id="e1" cx="200" cy="38" rx="28" ry="22" fill="none" stroke="#c53030" stroke-width="4"/>'
      + '<line id="n1" x1="12" y1="84" x2="228" y2="84" stroke="#2f855a" stroke-width="2"/>'
      + '<path id="p1" d="M 20 140 C 60 90 100 150 140 100 S 210 120 226 140 Z" fill="#9f7aea" fill-rule="evenodd" opacity="0.8"/>'
      + '<polyline id="y1" points="150,96 170,120 190,100 210,124" fill="none" stroke="#000" stroke-width="2"/></g>'),
  },
  {
    id: "tratteggi",
    text: scene(`${LAYER}<line id="d1" x1="16" y1="24" x2="224" y2="24" stroke="#1a202c" stroke-width="4" stroke-dasharray="12 6"/>`
      + '<line id="d2" x1="16" y1="52" x2="224" y2="52" stroke="#2b6cb0" stroke-width="6" stroke-dasharray="1 10" stroke-linecap="round"/>'
      + '<polyline id="d3" points="16,130 60,80 104,130 148,80 192,130" fill="none" stroke="#c53030" stroke-width="10" stroke-linejoin="round" stroke-linecap="square"/>'
      + '<rect id="d4" x="150" y="96" width="74" height="50" fill="none" stroke="#2f855a" stroke-width="3" stroke-dasharray="8 4 2 4"/></g>'),
  },
  {
    id: "testi",
    text: scene(`${LAYER}<text id="t1" x="12" y="34" font-family="Inter" font-size="22" fill="#1a202c">Inter, così</text>`
      + '<text id="t2" x="12" y="66" font-family="Inter" font-size="18" font-weight="700" fill="#2b6cb0">Grassetto 0123</text>'
      + '<text id="t3" x="12" y="100" font-family="Literata" font-size="22" fill="#1a202c">Literata àèìòù</text>'
      + '<text id="t4" x="120" y="140" font-family="JetBrains Mono" font-size="16" text-anchor="middle" fill="#c53030">{ mono: 42 }</text></g>'),
  },
  {
    id: "tipografia",
    text: scene(`${LAYER}<text id="t5" x="12" y="30" fill="#1a202c" font-family="Inter, sans-serif" font-size="20">`
      + '<tspan x="12" dy="0">Evap<tspan fill="#2b6cb0" font-weight="bold">orazione</tspan></tspan>'
      + '<tspan x="12" dy="26" font-style="italic" letter-spacing="1.5">in <tspan font-weight="600" text-decoration="underline">pioggia</tspan></tspan></text>'
      + '<text id="t6" x="12" y="100" fill="#c53030" font-family="Literata, serif" font-size="22" font-style="italic" text-decoration="line-through">Literata corsiva</text>'
      + '<text id="t7" x="228" y="140" fill="#2f855a" font-family="JetBrains Mono, monospace" font-size="16" font-weight="300" font-style="italic" letter-spacing="-0.5" text-anchor="end">{ corsivo: 1 }</text></g>'),
  },
  {
    // Un testo in area allineato a sinistra, con un pezzo e una parola
    // spezzata, e uno allineato a destra, in corsivo.
    id: "in-area",
    text: scene(`${LAYER}<text id="t8" fub:wrap="150" x="12" y="26" fill="#1a202c" font-family="Inter, sans-serif" font-size="15">`
      + '<tspan x="12" dy="0">L’acqua del mare sale</tspan>'
      + '<tspan fub:join="space" x="12" dy="19">in <tspan font-weight="bold" fill="#2b6cb0">cielo</tspan> e torna giù,</tspan>'
      + '<tspan fub:join="space" x="12" dy="19">precipitevolissimevol</tspan>'
      + '<tspan fub:join="word" x="12" dy="19">mente.</tspan></text>'
      + '<text id="t9" fub:wrap="96" x="228" y="112" fill="#c53030" font-family="Literata, serif" font-size="14" font-style="italic" text-anchor="end">'
      + '<tspan x="228" dy="0">The quick brown</tspan>'
      + '<tspan fub:join="space" x="228" dy="18">fox jumps over</tspan>'
      + '<tspan fub:join="space" x="228" dy="18" letter-spacing="0.5">the lazy dog.</tspan></text></g>'),
  },
  {
    // Un testo su una curva, al centro, con un pezzo; uno su una linea,
    // spaziato, con `xlink:href`.
    id: "su-tracciato",
    text: scene('<defs id="fub-defs"><path id="rp1a2b3c4" fub:role="private" d="M 16 130 C 60 20 180 20 224 130"/>'
      + `<path id="rp5e6f7g8" fub:role="private" d="M 20 150 L 220 150"/></defs>${LAYER}`
      + '<text id="t10" fill="#2b6cb0" font-family="Literata, serif" font-size="18" text-anchor="middle">'
      + '<textPath startOffset="50%" href="#rp1a2b3c4">Sopra <tspan font-weight="bold" fill="#c53030">la</tspan> collina</textPath></text>'
      + '<text id="t11" fill="#2f855a" font-family="JetBrains Mono, monospace" font-size="12" font-style="italic" letter-spacing="1">'
      + '<textPath startOffset="12" xlink:href="#rp5e6f7g8">along the line</textPath></text></g>'),
  },
  {
    id: "gruppi",
    text: scene(`${LAYER}<g id="g1" transform="translate(60 80) rotate(-20) scale(1.2)">`
      + '<polygon id="q1" points="0,-40 38,-12 24,32 -24,32 -38,-12" fill="#ecc94b" stroke="#744210" stroke-width="2" stroke-opacity="0.5"/>'
      + '<circle id="c1" r="10" fill="#2b6cb0"/></g>'
      + '<a id="a1" href="Note/altra.md"><rect id="r3" x="140" y="40" width="80" height="80" fill="#38a169" transform="skewX(-10)"/></a></g>'
      + '<g id="l2" fub:layer="Livello 2" opacity="0.5"><rect id="r4" x="120" y="100" width="100" height="40" fill="#c53030"/></g>'),
  },
  {
    id: "immagine",
    text: scene(`${LAYER}<image id="i1" x="20" y="20" width="96" height="96" href="${CHECKER}"/>`
      + `<image id="i2" x="140" y="40" width="80" height="40" preserveAspectRatio="none" href="${CHECKER}"/></g>`),
  },
  {
    // Ogni risorsa modificabile, usata da oggetti modificabili: sul foglio
    // stanno nella `defs` viva, in Lettura e nell'export nel file.
    id: "risorse",
    text: scene('<defs id="fub-defs">'
      + '<linearGradient id="r1" fub:role="private" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#2b6cb0"/>'
      + '<stop offset="1" stop-color="#9f7aea" stop-opacity="0.6"/></linearGradient>'
      + '<radialGradient id="r2" fub:role="private" cx="0.5" cy="0.5" r="0.5" fx="0.35" fy="0.35"><stop offset="0" stop-color="#f6ad55"/>'
      + '<stop offset="100%" stop-color="#c53030"/></radialGradient>'
      + '<pattern id="r3" fub:role="shared" x="0" y="0" width="12" height="12" patternUnits="userSpaceOnUse">'
      + '<rect x="0" y="0" width="12" height="12" fill="#ffffff"/><rect x="0" y="0" width="6" height="6" fill="url(#r1) #2b6cb0"/>'
      + '<circle cx="9" cy="9" r="3" fill="#2f855a"/></pattern>'
      + '<marker id="r4" fub:role="shared" refX="5" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse" viewBox="0 0 10 10">'
      + '<path d="M 0 0 L 10 5 L 0 10 Z" fill="#1a202c"/></marker>'
      + '<clipPath id="r5" fub:role="private" clipPathUnits="objectBoundingBox"><circle cx="0.5" cy="0.5" r="0.5"/></clipPath>'
      + '<linearGradient id="r6" fub:role="private" x2="1"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#000000"/></linearGradient>'
      + '<mask id="r7" fub:role="private" maskContentUnits="objectBoundingBox"><rect x="0" y="0" width="1" height="1" fill="url(#r6) #ffffff"/></mask>'
      + '<filter id="r8" fub:role="shared" x="-0.3" y="-0.3" width="1.6" height="1.6">'
      + '<feDropShadow dx="3" dy="4" stdDeviation="3" flood-color="#1a202c" flood-opacity="0.5"/></filter>'
      + '<filter id="r9" fub:role="shared" x="-0.2" y="-0.2" width="1.4" height="1.6"><feGaussianBlur in="SourceAlpha" stdDeviation="1.5" result="ombra"/>'
      + '<feOffset in="ombra" dx="2" dy="2" result="spostata"/><feMerge><feMergeNode in="spostata"/><feMergeNode in="SourceGraphic"/></feMerge></filter>'
      + `</defs>${LAYER}`
      + '<rect id="o1" x="10" y="10" width="100" height="40" rx="6" fill="url(#r1) #2b6cb0" filter="url(#r8)"/>'
      + '<circle id="o2" cx="164" cy="34" r="24" fill="url(#r2) #f6ad55" stroke="url(#r3) #2f855a" stroke-width="6"/>'
      + '<path id="o3" d="M 16 70 L 80 70 L 112 96" fill="none" stroke="#1a202c" stroke-width="2" marker-start="url(#r4)" marker-mid="url(#r4)" marker-end="url(#r4)"/>'
      + '<rect id="o4" x="140" y="68" width="84" height="56" fill="url(#r3) #2f855a" clip-path="url(#r5)"/>'
      + '<rect id="o5" x="10" y="108" width="110" height="40" fill="#c53030" mask="url(#r7)"/>'
      + '<text id="o6" x="140" y="148" font-family="Inter" font-size="18" font-weight="700" fill="url(#r1) #2b6cb0" filter="url(#r9)"><tspan x="140" dy="0">Risorse</tspan></text></g>'),
  },
  {
    // I campioni: un riempimento, un contorno, una linea orizzontale, il cui
    // riquadro è alto zero, un riempimento ereditato da un gruppo, un testo,
    // e in un livello bloccato un oggetto col ripiego di prima, che dipinge
    // comunque il colore del campione.
    id: "campioni",
    text: scene('<defs id="fub-defs">'
      + '<linearGradient id="s1" fub:role="swatch" fub:name="Blu mare" gradientUnits="userSpaceOnUse"><stop stop-color="#0072b2"/></linearGradient>'
      + '<linearGradient id="s2" fub:role="swatch" fub:name="Vermiglio" gradientUnits="userSpaceOnUse"><stop stop-color="#d55e00"/></linearGradient>'
      + '<linearGradient id="s3" fub:role="swatch" fub:name="Prato" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#009e73"/></linearGradient>'
      + `</defs>${LAYER}`
      + '<rect id="o1" x="12" y="12" width="96" height="56" rx="8" fill="url(#s1) #0072b2" stroke="url(#s2) #d55e00" stroke-width="4"/>'
      + '<line id="o2" x1="124" y1="20" x2="228" y2="20" stroke="url(#s2) #d55e00" stroke-width="6"/>'
      + '<g id="g1" fill="url(#s3) #009e73"><circle id="o3" cx="146" cy="52" r="16"/><rect id="o4" x="174" y="36" width="50" height="32"/></g>'
      + '<text id="o5" x="12" y="104" font-family="Inter" font-size="22" font-weight="700" fill="url(#s1) #0072b2"><tspan x="12" dy="0">Campioni</tspan></text></g>'
      + '<g id="l2" fub:layer="Bloccato" fub:locked="true"><rect id="o6" x="140" y="92" width="84" height="56" fill="url(#s3) #cc79a7"/></g>'),
  },
  {
    // Le sfumature come le scrive FubDraw, nelle coordinate di chi le usa:
    // una lineare con un punto trasparente, una radiale col fuoco che si
    // ripete a specchio, una ellittica che ricomincia, una nel contorno, una
    // inclinata da uno scorrimento, come la scrive «Applica trasformazione»,
    // una che un gruppo ruotato porta con sé, e una su una linea
    // orizzontale, il cui riquadro è alto zero.
    id: "sfumature",
    text: scene('<defs id="fub-defs">'
      + '<linearGradient id="g1" fub:role="private" x1="12" y1="0" x2="108" y2="0" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#0072b2"/>'
      + '<stop offset="0.5" stop-color="#f0e442" stop-opacity="0.4"/><stop offset="1" stop-color="#d55e00"/></linearGradient>'
      + '<radialGradient id="g2" fub:role="private" cx="146" cy="36" r="12" fx="140" fy="30" gradientUnits="userSpaceOnUse" spreadMethod="reflect">'
      + '<stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#cc79a7"/></radialGradient>'
      + '<radialGradient id="g3" fub:role="private" cx="204" cy="36" r="14" gradientUnits="userSpaceOnUse" gradientTransform="matrix(1 0 0 0.5 0 18)" spreadMethod="repeat">'
      + '<stop offset="0" stop-color="#009e73"/><stop offset="1" stop-color="#56b4e9"/></radialGradient>'
      + '<linearGradient id="g4" fub:role="private" x1="0" y1="84" x2="0" y2="140" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#e69f00"/>'
      + '<stop offset="1" stop-color="#0072b2"/></linearGradient>'
      + '<linearGradient id="g5" fub:role="private" x1="128" y1="0" x2="168" y2="0" gradientUnits="userSpaceOnUse" gradientTransform="matrix(1 0 0.5 1 -42 0)">'
      + '<stop offset="0" stop-color="#009e73"/><stop offset="1" stop-color="#f0e442"/></linearGradient>'
      + '<linearGradient id="g6" fub:role="private" x1="0" y1="88" x2="0" y2="136" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#cc79a7"/>'
      + '<stop offset="1" stop-color="#0072b2"/></linearGradient>'
      + '<linearGradient id="g7" fub:role="private" x1="12" y1="0" x2="228" y2="0" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#0072b2"/>'
      + '<stop offset="0.33" stop-color="#e69f00"/><stop offset="0.66" stop-color="#009e73"/><stop offset="1" stop-color="#cc79a7"/></linearGradient>'
      + `</defs>${LAYER}`
      + '<rect id="o1" x="12" y="12" width="96" height="48" rx="8" fill="url(#g1) #a49d4f"/>'
      + '<circle id="o2" cx="146" cy="36" r="24" fill="url(#g2) #e6bcd3"/>'
      + '<ellipse id="o3" cx="204" cy="36" rx="28" ry="24" fill="url(#g3) #2ba9ae"/>'
      + '<line id="o4" x1="12" y1="72" x2="228" y2="72" stroke="url(#g7) #6f9160" stroke-width="4"/>'
      + '<polyline id="o5" points="16,140 48,84 80,140 112,84" fill="none" stroke="url(#g4) #738959" stroke-width="10" stroke-linejoin="round"/>'
      + '<path id="o6" d="M 128 84 L 168 84 L 192 132 L 152 132 Z" fill="url(#g5) #78c15b"/>'
      + '<g id="o7" transform="rotate(-20 214 112)"><rect id="o8" x="196" y="88" width="36" height="48" fill="url(#g6) #6676ad"/></g></g>'),
  },
  {
    // Tre tavole: due con la carta, bianca e azzurra, una senza, che mostra
    // il fondo. Le forme stanno sulle tavole, il testo su quella senza carta,
    // e un rettangolo passa sopra lo spazio fra le prime due.
    id: "tavole",
    text: scene(paper("c1", "b1", [8, 8, 104, 72], "#ffffff") + paper("c2", "b2", [128, 8, 104, 72], "#bee3f8")
      + board("b1", "Copertina", "8 8 104 72") + board("b2", "Evaporazione", "128 8 104 72") + board("b3", "Senza carta", "8 96 224 56")
      + `${LAYER}<rect id="v1" x="20" y="20" width="44" height="30" fill="#2b6cb0" stroke="#1a202c" stroke-width="2"/>`
      + '<ellipse id="v2" cx="84" cy="62" rx="18" ry="11" fill="none" stroke="#c53030" stroke-width="3"/>'
      + '<path id="v3" d="M 140 68 C 160 22 192 72 222 26" fill="none" stroke="#2f855a" stroke-width="3" stroke-linecap="round"/>'
      + '<rect id="v4" x="96" y="30" width="48" height="22" rx="6" fill="#f6ad55" fill-opacity="0.85" stroke="#1a202c"/>'
      + '<text id="v5" x="20" y="132" font-family="Inter" font-size="20" fill="#1a202c"><tspan x="20" dy="0">Tre tavole</tspan></text>'
      + '<line id="v6" x1="150" y1="110" x2="220" y2="140" stroke="#9f7aea" stroke-width="4" stroke-linecap="round"/></g>'),
  },
  {
    // La seconda di due tavole, da sola come la incorpora una nota: il
    // rettangolo che viene dalla prima e la forma che esce in basso si
    // tagliano sul bordo, e ciò che sta sulla prima non si vede.
    id: "tavola-sola",
    board: "Evaporazione",
    text: scene(paper("c1", "b1", [0, 20, 240, 160], "#ffffff") + paper("c2", "b2", [280, 20, 240, 160], "#bee3f8")
      + board("b1", "Copertina", "0 20 240 160") + board("b2", "Evaporazione", "280 20 240 160")
      + `${LAYER}<ellipse id="w1" cx="120" cy="100" rx="70" ry="50" fill="#c53030"/>`
      + '<rect id="w2" x="200" y="60" width="120" height="40" fill="#2b6cb0" stroke="#1a202c" stroke-width="3"/>'
      + '<path id="w3" d="M 300 160 C 340 90 400 200 500 120" fill="none" stroke="#2f855a" stroke-width="4"/>'
      + '<ellipse id="w4" cx="470" cy="170" rx="40" ry="24" fill="#f6ad55" stroke="#744210" stroke-width="2"/>'
      + '<text id="w5" x="400" y="56" font-family="Literata" font-size="22" text-anchor="middle" fill="#1a202c"><tspan x="400" dy="0">Evaporazione</tspan></text></g>',
    root(520, 200)),
  },
  {
    id: "inkscape",
    text: scene('<sodipodi:namedview xmlns:sodipodi="http://sodipodi.sourceforge.net/DTD/sodipodi-0.dtd" pagecolor="#ffffff"/>'
      + '<g xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" inkscape:groupmode="layer" inkscape:label="Layer 1" id="layer1">'
      + '<path style="fill:#2b6cb0;stroke:#1a202c;stroke-width:2;stroke-dasharray:6,3" d="M 20,20 H 120 V 90 H 20 Z" id="rect1"/>'
      + '<circle style="fill:#f6ad55;fill-opacity:0.7" cx="160" cy="90" r="50" id="c1"/>'
      + '<text style="font-family:Inter;font-size:18px;fill:#1a202c" x="24" y="140" id="tx1">Inkscape</text></g>'),
  },
  {
    id: "illustrator",
    text: scene('<style>.st0{fill:#c53030;}.st1{fill:none;stroke:#2f855a;stroke-width:4;stroke-dasharray:10 5;}.st2{font-family:Literata;font-size:20px;}</style>'
      + '<rect class="st0" x="16" y="16" width="90" height="60"/><circle class="st1" cx="170" cy="56" r="40"/>'
      + '<text class="st2" x="16" y="130">Illustrator</text>'),
  },
  {
    id: "mermaid",
    text: scene('<style>#m .node rect{fill:#ECECFF;stroke:#9370DB;stroke-width:1px;}#m .label{font-family:Inter;font-size:14px;fill:#333;}#m .edge{stroke:#333;stroke-width:2px;fill:none;}</style>'
      + '<g id="m"><g class="node"><rect x="10" y="50" width="90" height="40" rx="5"/><text class="label" x="55" y="75" text-anchor="middle">Inizio</text></g>'
      + '<path class="edge" d="M 100 70 L 140 70"/><path d="M 140 64 L 150 70 L 140 76 Z" fill="#333"/>'
      + '<g class="node"><rect x="150" y="50" width="80" height="40" rx="5"/><text class="label" x="190" y="75" text-anchor="middle">Fine</text></g></g>'),
  },
];
