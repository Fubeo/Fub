// Il corpus del banco di fedeltà: scene piccole che insieme toccano ogni
// elemento e attributo che il disegno modifica, i testi in ogni carattere
// dell'app, in tondo e in corsivo, coi pezzi di riga, un'immagine, le
// risorse di ogni tipo, i campioni, le sfumature e le campiture come le
// scrive FubDraw, i motivi, le tavole con le loro carte, e gli estranei tipici di Inkscape, Illustrator e
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
    // Le punte delle linee come le scrive FubDraw, coi loro marcatori: due
    // forme e due misure su una linea, la punta aperta su una spezzata con
    // l'opacità del contorno, il quadrato e il rombo su una curva, le barre
    // su una linea tratteggiata con gli estremi quadrati, le punte di un
    // campione, quelle di una sfumatura col colore che ha nei capi, quelle di
    // un contorno ereditato da un gruppo ruotato, e una punta dopo un tratto
    // lungo zero, che Chromium gira verso destra: il foglio, la Lettura e
    // l'export la girano allo stesso modo.
    id: "punte",
    text: scene('<defs id="fub-defs">'
      + '<linearGradient id="s1" fub:role="swatch" fub:name="Arancio" gradientUnits="userSpaceOnUse"><stop stop-color="#e69f00"/></linearGradient>'
      + '<linearGradient id="g1" fub:role="private" x1="132" y1="0" x2="228" y2="0" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#0072b2"/><stop offset="1" stop-color="#d55e00"/></linearGradient>'
      + '<marker id="p1" fub:role="shared" fub:marker="triangle medium end" refX="3.44" refY="3" markerWidth="5.34" markerHeight="6" orient="auto"><path d="M4.84 3 L0.51 5.5 L0.51 0.5 Z" fill="#0072b2"/></marker>'
      + '<marker id="p2" fub:role="shared" fub:marker="circle small start" refX="1.9" refY="1.9" markerWidth="3.8" markerHeight="3.8" orient="auto"><circle cx="1.9" cy="1.9" r="1.4" fill="#0072b2"/></marker>'
      + '<marker id="p3" fub:role="shared" fub:marker="vee large end" refX="6.57" refY="4.5" markerWidth="8.07" markerHeight="9" orient="auto"><path d="M1.01 1 L7.07 4.5 L1.01 8" fill="none" stroke="#d55e00" stroke-width="1" stroke-opacity="0.6" stroke-linecap="round" stroke-linejoin="round"/></marker>'
      + '<marker id="p4" fub:role="shared" fub:marker="square medium start" refX="2.25" refY="2.25" markerWidth="4.5" markerHeight="4.5" orient="auto"><path d="M4 0.5 L0.5 0.5 L0.5 4 L4 4 Z" fill="#009e73"/></marker>'
      + '<marker id="p5" fub:role="shared" fub:marker="diamond medium end" refX="4.1" refY="2" markerWidth="6" markerHeight="4" orient="auto"><path d="M5.5 2 L3 3.5 L0.5 2 L3 0.5 Z" fill="#009e73"/></marker>'
      + '<marker id="p6" fub:role="shared" fub:marker="bar medium start" refX="1" refY="3" markerWidth="2" markerHeight="6" orient="auto"><path d="M1 0.5 L1 5.5" fill="none" stroke="#cc79a7" stroke-width="1" stroke-linecap="butt"/></marker>'
      + '<marker id="p7" fub:role="shared" fub:marker="bar medium end" refX="1" refY="3" markerWidth="2" markerHeight="6" orient="auto"><path d="M1 0.5 L1 5.5" fill="none" stroke="#cc79a7" stroke-width="1" stroke-linecap="butt"/></marker>'
      + '<marker id="p8" fub:role="shared" fub:marker="triangle large end" refX="5.17" refY="4" markerWidth="7.07" markerHeight="8" orient="auto"><path d="M6.57 4 L0.51 7.5 L0.51 0.5 Z" fill="url(#s1) #e69f00"/></marker>'
      + '<marker id="p9" fub:role="shared" fub:marker="triangle small start" refX="1.9" refY="2.25" markerWidth="4.04" markerHeight="4.5" orient="auto"><path d="M0.5 2.25 L3.53 4 L3.53 0.5 Z" fill="url(#s1) #e69f00"/></marker>'
      + '<marker id="p10" fub:role="shared" fub:marker="triangle medium start" refX="1.9" refY="3" markerWidth="5.34" markerHeight="6" orient="auto"><path d="M0.5 3 L4.83 5.5 L4.83 0.5 Z" fill="#1270a3"/></marker>'
      + '<marker id="p11" fub:role="shared" fub:marker="triangle medium end" refX="3.44" refY="3" markerWidth="5.34" markerHeight="6" orient="auto"><path d="M4.84 3 L0.51 5.5 L0.51 0.5 Z" fill="#c3600f"/></marker>'
      + '<marker id="p12" fub:role="shared" fub:marker="circle medium start" refX="2.5" refY="2.5" markerWidth="5" markerHeight="5" orient="auto"><circle cx="2.5" cy="2.5" r="2" fill="#56b4e9"/></marker>'
      + '<marker id="p13" fub:role="shared" fub:marker="vee medium end" refX="4.84" refY="3.5" markerWidth="6.34" markerHeight="7" orient="auto"><path d="M1.01 1 L5.34 3.5 L1.01 6" fill="none" stroke="#56b4e9" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"/></marker>'
      + '<marker id="p14" fub:role="shared" fub:marker="triangle medium end" refX="3.44" refY="3" markerWidth="5.34" markerHeight="6" orient="auto"><path d="M4.84 3 L0.51 5.5 L0.51 0.5 Z" fill="#1a202c"/></marker>'
      + `</defs>${LAYER}`
      + '<line id="o1" x1="16" y1="20" x2="104" y2="20" stroke="#0072b2" stroke-width="3" marker-start="url(#p2)" marker-end="url(#p1)"/>'
      + '<polyline id="o2" points="136,36 160,12 184,36 208,12" fill="none" stroke="#d55e00" stroke-width="2" stroke-opacity="0.6" stroke-linejoin="round" marker-end="url(#p3)"/>'
      + '<path id="o3" d="M 16 64 C 40 30 76 92 104 56" fill="none" stroke="#009e73" stroke-width="2.5" marker-start="url(#p4)" marker-end="url(#p5)"/>'
      + '<line id="o4" x1="140" y1="52" x2="224" y2="76" stroke="#cc79a7" stroke-width="3" stroke-linecap="square" stroke-dasharray="6 4" marker-start="url(#p6)" marker-end="url(#p7)"/>'
      + '<line id="o5" x1="20" y1="100" x2="100" y2="100" stroke="url(#s1) #e69f00" stroke-width="3" marker-start="url(#p9)" marker-end="url(#p8)"/>'
      + '<line id="o6" x1="140" y1="100" x2="220" y2="100" stroke="url(#g1) #6a6859" stroke-width="4" marker-start="url(#p10)" marker-end="url(#p11)"/>'
      + '<g id="g2" transform="rotate(-12 60 136)" stroke="#56b4e9" stroke-width="3"><path id="o7" d="M 20 136 L 100 136" fill="none" marker-start="url(#p12)" marker-end="url(#p13)"/></g>'
      + '<path id="o8" d="M 136 144 L 204 124 L 204 124" fill="none" stroke="#1a202c" stroke-width="2" marker-end="url(#p14)"/></g>'),
  },
  {
    // I ritagli e le maschere come li scrive FubDraw: un'immagine
    // ritagliata, e una ruotata, il cui ritaglio gira con lei; una maschera
    // di ritaglio, un cerchio, su un gruppo con un'immagine e una forma; un
    // testo che ritaglia una sfumatura; una maschera d'opacità che sfuma un
    // gruppo da sinistra a destra; e un livello col suo ritaglio, che taglia
    // ciò che contiene.
    id: "ritagli",
    text: scene('<defs id="fub-defs">'
      + '<clipPath id="c1" fub:role="private"><rect x="20" y="20" width="40" height="36"/></clipPath>'
      + '<clipPath id="c2" fub:role="private"><rect x="90" y="16" width="36" height="24"/></clipPath>'
      + '<clipPath id="c3" fub:role="private"><circle cx="196" cy="38" r="28"/></clipPath>'
      + '<linearGradient id="g1" fub:role="private" x1="12" y1="0" x2="116" y2="0" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#0072b2"/><stop offset="1" stop-color="#d55e00"/></linearGradient>'
      + '<clipPath id="c4" fub:role="private"><text x="14" y="114" font-family="Inter" font-size="40" font-weight="700"><tspan x="14" dy="0">Clip</tspan></text></clipPath>'
      + '<linearGradient id="g2" fub:role="private" x1="132" y1="0" x2="228" y2="0" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#000000"/></linearGradient>'
      + '<mask id="m1" fub:role="private" x="132" y="78" width="96" height="40" maskUnits="userSpaceOnUse"><rect x="132" y="78" width="96" height="40" fill="url(#g2) #808080"/></mask>'
      + '<clipPath id="c5" fub:role="private"><rect x="12" y="126" width="216" height="26" rx="13"/></clipPath>'
      + `</defs>${LAYER}`
      + `<image id="o1" x="12" y="12" width="64" height="64" clip-path="url(#c1)" href="${CHECKER}"/>`
      + `<image id="o2" x="84" y="8" width="48" height="40" clip-path="url(#c2)" transform="rotate(-15 108 28)" href="${CHECKER}"/>`
      + `<g id="g3" clip-path="url(#c3)"><image id="o3" x="160" y="4" width="48" height="48" href="${CHECKER}"/><rect id="o4" x="184" y="30" width="48" height="40" fill="#009e73" stroke="#1a202c" stroke-width="3"/></g>`
      + '<rect id="o5" x="12" y="80" width="104" height="42" fill="url(#g1) #6b6859" clip-path="url(#c4)"/>'
      + '<g id="g4" mask="url(#m1)"><rect id="o6" x="132" y="82" width="96" height="32" rx="6" fill="#0072b2"/><circle id="o7" cx="180" cy="98" r="14" fill="#e69f00" stroke="#1a202c" stroke-width="2"/></g></g>'
      + '<g id="l2" fub:layer="Ritagliato" clip-path="url(#c5)"><rect id="o8" x="0" y="120" width="120" height="40" fill="#cc79a7"/>'
      + '<ellipse id="o9" cx="180" cy="139" rx="60" ry="22" fill="#56b4e9" stroke="#1a202c" stroke-width="4"/></g>'),
  },
  {
    // Gli effetti e le fusioni come li scrive FubDraw: un'ombra esterna,
    // un'ombra interna, un bagliore esterno su un testo, un bagliore interno
    // con un'ombra, un'immagine sfocata, e tre effetti con la sfocatura su
    // tutto; in un gruppo isolato un cerchio che moltiplica, e in un livello
    // sopra un rettangolo che scherma ciò che c'è sotto, e il vuoto.
    id: "effetti",
    text: scene('<defs id="fub-defs">'
      + '<filter id="x1" fub:role="private" x="6" y="8" width="78" height="62" filterUnits="userSpaceOnUse" color-interpolation-filters="sRGB"><feGaussianBlur in="SourceAlpha" result="b1" stdDeviation="3"/><feOffset dx="3" dy="5" in="b1" result="o1"/><feFlood flood-color="#000000" flood-opacity="0.5"/><feComposite in2="o1" result="e1" operator="in"/><feMerge><feMergeNode in="e1"/><feMergeNode in="SourceGraphic"/></feMerge></filter>'
      + '<filter id="x2" fub:role="private" x="73" y="-1" width="90" height="74" filterUnits="userSpaceOnUse" color-interpolation-filters="sRGB"><feColorMatrix in="SourceAlpha" result="a1" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 -1 1"/><feGaussianBlur in="a1" result="b1" stdDeviation="3"/><feOffset dx="2" dy="4" in="b1" result="o1"/><feFlood flood-color="#000000" flood-opacity="0.6"/><feComposite in2="o1" operator="in"/><feComposite in2="SourceAlpha" result="e1" operator="in"/><feMerge><feMergeNode in="SourceGraphic"/><feMergeNode in="e1"/></feMerge></filter>'
      + '<filter id="x3" fub:role="private" x="136" y="2.5" width="110.4" height="67.5" filterUnits="userSpaceOnUse" color-interpolation-filters="sRGB"><feGaussianBlur in="SourceAlpha" result="b1" stdDeviation="3"/><feFlood flood-color="#e69f00" flood-opacity="0.9"/><feComposite in2="b1" result="e1" operator="in"/><feMerge><feMergeNode in="e1"/><feMergeNode in="SourceGraphic"/></feMerge></filter>'
      + '<filter id="x4" fub:role="private" x="-6" y="68" width="92" height="86" filterUnits="userSpaceOnUse" color-interpolation-filters="sRGB"><feColorMatrix in="SourceAlpha" result="a1" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 -1 1"/><feGaussianBlur in="a1" result="b1" stdDeviation="4"/><feFlood flood-color="#ffffff" flood-opacity="0.9"/><feComposite in2="b1" operator="in"/><feComposite in2="SourceAlpha" result="e1" operator="in"/><feGaussianBlur in="SourceAlpha" result="b2" stdDeviation="2"/><feOffset dx="0" dy="2" in="b2" result="o2"/><feFlood flood-color="#1a202c" flood-opacity="0.4"/><feComposite in2="o2" result="e2" operator="in"/><feMerge><feMergeNode in="e2"/><feMergeNode in="SourceGraphic"/><feMergeNode in="e1"/></feMerge></filter>'
      + '<filter id="x5" fub:role="private" x="79" y="83" width="54" height="54" filterUnits="userSpaceOnUse" color-interpolation-filters="sRGB"><feGaussianBlur in="SourceGraphic" stdDeviation="1"/></filter>'
      + '<filter id="x6" fub:role="private" x="179.5" y="66" width="60.5" height="57.5" filterUnits="userSpaceOnUse" color-interpolation-filters="sRGB"><feGaussianBlur in="SourceAlpha" result="b1" stdDeviation="2"/><feOffset dx="-3" dy="4" in="b1" result="o1"/><feFlood flood-color="#000000" flood-opacity="0.5"/><feComposite in2="o1" result="e1" operator="in"/><feGaussianBlur in="SourceAlpha" result="b2" stdDeviation="1.5"/><feFlood flood-color="#56b4e9" flood-opacity="1"/><feComposite in2="b2" result="e2" operator="in"/><feMerge><feMergeNode in="e1"/><feMergeNode in="e2"/><feMergeNode in="SourceGraphic"/></feMerge><feGaussianBlur stdDeviation="0.5"/></filter>'
      + '</defs><g id="l1" fub:layer="Livello 1">'
      + '<rect id="f1" x="14" y="14" width="56" height="40" rx="6" fill="#0072b2" filter="url(#x1)" fub:effect="shadow 3 5 6 #000000 0.5"/>'
      + '<ellipse id="f2" cx="118" cy="36" rx="30" ry="22" fill="#f0e442" filter="url(#x2)" fub:effect="inner-shadow 2 4 6 #000000 0.6"/>'
      + '<text id="f3" x="160" y="46" fill="#1a202c" filter="url(#x3)" font-family="Inter" font-size="26" font-weight="700" fub:effect="glow 6 #e69f00 0.9"><tspan x="160" dy="0">Luce</tspan></text>'
      + '<polygon id="f4" points="40,82 49,104 72,104 54,118 61,140 40,127 19,140 26,118 8,104 31,104" fill="#cc79a7" filter="url(#x4)" fub:effect="inner-glow 8 #ffffff 0.9; shadow 0 2 4 #1a202c 0.4"/>'
      + `<image id="f5" x="84" y="88" width="44" height="44" filter="url(#x5)" href="${CHECKER}" fub:effect="blur 2"/>`
      + '<g id="f6" style="isolation: isolate">'
      + '<rect id="f7" x="140" y="86" width="44" height="44" fill="#56b4e9"/><circle id="f8" cx="180" cy="120" r="22" fill="#e69f00" style="mix-blend-mode: multiply"/></g>'
      + '<rect id="f9" x="196" y="78" width="32" height="28" fill="#009e73" stroke="#1a202c" stroke-width="2" filter="url(#x6)" fub:effect="shadow -3 4 4 #000000 0.5; glow 3 #56b4e9 1; blur 1"/></g>'
      + '<g id="l2" fub:layer="Sopra">'
      + '<rect id="f10" x="190" y="112" width="44" height="36" fill="#d55e00" style="mix-blend-mode: screen"/></g>'),
  },
  {
    // Le campiture e i motivi come li scrive FubDraw: righe diagonali su un
    // fondo, righe incrociate senza fondo sopra un'altra forma, puntini,
    // righe orizzontali in un testo, una quadrettatura su un oggetto girato
    // e scalato, righe fitte a 30°, e un motivo del documento con una
    // sfumatura dentro, che riempie un rettangolo arrotondato.
    id: "campiture",
    text: scene('<defs id="fub-defs">'
      + '<pattern id="h1" fub:role="private" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(-45)" fub:pattern="lines -45 8 1.5 #000000 #56b4e9"><rect width="8" height="8" fill="#56b4e9"/><rect y="3.25" width="8" height="1.5" fill="#000000"/></pattern>'
      + '<pattern id="h2" fub:role="private" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)" fub:pattern="cross 45 6 1 #0072b2"><rect y="2.5" width="6" height="1" fill="#0072b2"/><rect x="2.5" width="1" height="6" fill="#0072b2"/></pattern>'
      + '<pattern id="h3" fub:role="private" width="10" height="10" patternUnits="userSpaceOnUse" patternTransform="rotate(45)" fub:pattern="dots 45 10 4 #ffffff #d55e00"><rect width="10" height="10" fill="#d55e00"/><circle cx="5" cy="5" r="2" fill="#ffffff"/></pattern>'
      + '<pattern id="h4" fub:role="private" width="4" height="4" patternUnits="userSpaceOnUse" fub:pattern="lines 0 4 2 #1a202c #e69f00"><rect width="4" height="4" fill="#e69f00"/><rect y="1" width="4" height="2" fill="#1a202c"/></pattern>'
      + '<pattern id="h5" fub:role="private" width="12" height="12" patternUnits="userSpaceOnUse" fub:pattern="cross 0 12 0.5 #000000 #ffffff"><rect width="12" height="12" fill="#ffffff"/><rect y="5.75" width="12" height="0.5" fill="#000000"/><rect x="5.75" width="0.5" height="12" fill="#000000"/></pattern>'
      + '<pattern id="h6" fub:role="private" width="3" height="3" patternUnits="userSpaceOnUse" patternTransform="rotate(30)" fub:pattern="lines 30 3 0.75 #000000 #f0e442"><rect width="3" height="3" fill="#f0e442"/><rect y="1.125" width="3" height="0.75" fill="#000000"/></pattern>'
      + '<linearGradient id="g1" fub:role="private" x1="3" y1="0" x2="13" y2="0" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#cc79a7"/><stop offset="1" stop-color="#0072b2"/></linearGradient>'
      + '<pattern id="m1" fub:role="swatch" fub:name="Pois" x="0" y="0" width="16" height="16" patternUnits="userSpaceOnUse"><circle cx="8" cy="8" r="5" fill="url(#g1) #6676ad"/><rect width="3" height="3" fill="#009e73"/></pattern>'
      + `</defs>${LAYER}`
      + '<rect id="k1" x="8" y="8" width="70" height="52" fill="url(#h1) #4692bd"/>'
      + '<rect id="k2" x="86" y="8" width="70" height="52" fill="#f0e442"/><ellipse id="k3" cx="121" cy="34" rx="30" ry="22" fill="url(#h2) #0072b2"/>'
      + '<circle id="k4" cx="196" cy="34" r="26" fill="url(#h3) #da7220"/>'
      + '<text id="k5" x="8" y="106" fill="url(#h4) #806016" font-family="Inter" font-size="40" font-weight="700"><tspan x="8" dy="0">Righe</tspan></text>'
      + '<rect id="k6" x="0" y="0" width="40" height="24" fill="url(#h5) #eaeaea" stroke="#1a202c" transform="matrix(1.4772 0.2605 -0.2605 1.4772 146 68)"/>'
      + '<ellipse id="k7" cx="186" cy="138" rx="44" ry="16" fill="url(#h6) #b4ab32"/>'
      + '<rect id="k8" x="8" y="116" width="120" height="38" rx="6" fill="url(#m1) #5e79a8"/></g>'),
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
