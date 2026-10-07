// Il corpus del banco di fedeltà: scene piccole che insieme toccano ogni
// elemento e attributo che il disegno modifica, i testi in ogni carattere
// dell'app, in tondo e in corsivo, coi pezzi di riga, un'immagine, e gli estranei tipici di Inkscape, Illustrator e
// Mermaid. Ogni scena è un disegno intero, grande quanto la sua resa.

/// La misura di ogni scena, in pixel CSS.
export const FIDELITY_SIZE = { width: 240, height: 160 } as const;

const HEAD = '<svg xmlns="http://www.w3.org/2000/svg" xmlns:fub="https://fubeo.github.io/ns/scene/1"'
  + ' xmlns:xlink="http://www.w3.org/1999/xlink" fub:version="1"'
  + ` width="${FIDELITY_SIZE.width}" height="${FIDELITY_SIZE.height}" viewBox="0 0 ${FIDELITY_SIZE.width} ${FIDELITY_SIZE.height}">`;
const LAYER = '<g id="l1" fub:layer="Livello 1">';
const scene = (body: string, head = HEAD): string => `${head}${body}</svg>`;

/// Un PNG di 8 × 8 a scacchi, rosso e blu.
const CHECKER = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAH0lEQVR4nGO4Y6MBRBoVJ4AImc2AUwJTCMLGLUEHOwA5N1UBvmzgIgAAAABJRU5ErkJggg==";

export interface FidelityScene {
  readonly id: string;
  readonly text: string;
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
