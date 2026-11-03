// @vitest-environment happy-dom
// I vettori dei gesti (`__fixtures__/disegno-gesti/`): gli oracoli dei gesti
// del disegno, registrati dagli strumenti TypeScript di oggi, che sono il
// riferimento. Il motore del disegno li rigioca (T14, T15, T17 di K5) e il
// finto host del client li usa (T10). La forma e le regole sono in §10 di
// `docs/reference/scene-operations.md`.
//
// Ogni vettore nasce da una definizione qui sotto: il testo di partenza e il
// gesto. Il test monta l'editor sul testo, prepara lo strumento, il livello,
// la selezione, lo zoom, la griglia e lo stile del gesto, lo fa col
// puntatore portando i punti della scena sullo schermo, e registra le
// operazioni che l'editor scrive (`DrawChange.op`), la selezione, il
// rifiuto e il testo di dopo. Gli id nuovi, casuali, diventano `@1`, `@2`…
// nell'ordine in cui compaiono. Ogni vettore si registra due volte, e le due
// volte devono dare lo stesso file; il gesto si rigioca dal solo JSON, come
// lo rigioca il motore.
//
// Rigenerare i file dopo aver cambiato un vettore o uno strumento:
//
//   UPDATE_GESTI=1 npm --prefix apps/client test -- src/editors/spatial/tools/gesti-vettori.test.ts
//
// scrive i file al posto di confrontarli; poi si rilancia senza, e si guarda
// il diff di Git.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openLifetime, type Lifetime } from "../../../ui/lifetime";
import { SceneEngine } from "../scene/engine";
import type { Op } from "../scene/ops";
import { t, type DrawKey } from "../strings";
import { toScreen } from "../view";
import { createDrawEditor, type DrawChange, type DrawEditor } from "./editor";
import { DEFAULT_GRID } from "./grid";

// --- La forma ----------------------------------------------------------------

/// Gli strumenti che i vettori registrano: quelli del disegno che passano
/// dal motore.
type GestureTool = "select" | "rect" | "ellipse" | "line" | "arrow";

interface GestureEvent {
  readonly kind: "down" | "drag" | "up" | "move" | "double_click";
  /// In coordinate di scena.
  readonly x: number;
  readonly y: number;
  readonly pressure: number;
  readonly shift: boolean;
  readonly alt: boolean;
  /// Ctrl o ⌘.
  readonly cmd: boolean;
}

interface Style {
  /// `#rrggbb`.
  readonly stroke: string;
  readonly width: number;
  /// Gli strumenti di oggi non riempiono: sempre `null`, e la forma scrive
  /// `fill="none"`.
  readonly fill: string | null;
}

interface Gesture {
  readonly tool: GestureTool;
  /// Il livello scelto prima del gesto; `null`, quello che l'editor sceglie
  /// da sé.
  readonly layer: string | null;
  /// Le chiavi degli oggetti scelti prima del gesto.
  readonly selection: readonly string[];
  /// La scala della camera: un'unità della scena è `zoom` pixel.
  readonly zoom: number;
  readonly snap: {
    /// Il passo della griglia che aggancia, o `null` se non aggancia.
    readonly grid: number | null;
    /// Ctrl o ⌘ tenuto per tutto il gesto: aggancio e calamite spenti. Gli
    /// eventi lo ripetono in `cmd`.
    readonly free: boolean;
  };
  /// Lo stile dello strumento di forma; `null` per la selezione.
  readonly style: Style | null;
  readonly events: readonly GestureEvent[];
}

/// Perché il gesto non ha scritto niente, quando lo strumento lo rifiuta:
/// `empty` non c'è niente da scrivere (una forma sotto la misura minima, un
/// trascinamento che non prende niente), `locked` e `hidden` il livello è
/// bloccato o nascosto. `unmapped`, ciò che il motore non sa modificare, non
/// lo scrive mai uno strumento di oggi.
type Refusal = "unmapped" | "empty" | "locked" | "hidden";

interface Expect {
  /// Le operazioni scritte, una per passo di annulla; `null` se il gesto
  /// non ha scritto niente.
  readonly ops: readonly Op[] | null;
  readonly selection: readonly string[];
  readonly refused: Refusal | null;
  /// Il testo grezzo di dopo, coi terminatori del file.
  readonly text: string;
}

interface Vector {
  readonly name: string;
  readonly description: string;
  readonly input: string;
  readonly gesture: Gesture;
  readonly expect: Expect;
}

// --- I documenti -------------------------------------------------------------

const ROOT =
  '<svg xmlns="http://www.w3.org/2000/svg" xmlns:fub="https://fubeo.github.io/ns/scene/1" fub:version="1" viewBox="0 0 400 300" width="400" height="300">';
const PAPER = '<rect id="fub-paper" fub:role="paper" x="0" y="0" width="400" height="300" fill="#ffffff"/>';

/// Un disegno di 400 × 300 con la carta e i livelli `layers`, ognuno con le
/// sue righe; `eol` separa le righe.
function drawing(layers: ReadonlyArray<{ readonly open: string; readonly body: readonly string[] }>, eol = "\n"): string {
  const lines = [ROOT, "  <title>Prova</title>", `  ${PAPER}`];
  for (const layer of layers) lines.push(`  ${layer.open}`, ...layer.body.map((line) => `    ${line}`), "  </g>");
  lines.push("</svg>", "");
  return lines.join(eol);
}

const A = "oa1a1a1a1";
const B = "ob2b2b2b2";
const K = "ok3k3k3k3";
const L1 = '<g id="l1a2b3c4d" fub:layer="Livello 1">';

/// Un rettangolo pieno senza contorno, da (100, 100) a (200, 150): la cornice
/// gli sta a 4 px, l'angolo in basso a destra è (204, 154), il lato destro
/// (204, 125), la maniglia della rotazione (150, 72).
const RECT_A = `<rect id="${A}" x="100" y="100" width="100" height="50" fill="#000000"/>`;
const RECT_B = `<rect id="${B}" x="260" y="180" width="60" height="40" fill="#e69f00"/>`;

const EMPTY = drawing([{ open: L1, body: [] }]);
const ONE = drawing([{ open: L1, body: [RECT_A] }]);
const TWO = drawing([{ open: L1, body: [RECT_A, RECT_B] }]);

/// Due livelli: «Sfondo» sotto, con A, e «Note» sopra, con B.
function layered(note: string): string {
  return drawing([
    { open: '<g id="l1a2b3c4d" fub:layer="Sfondo">', body: [RECT_A] },
    { open: `<g id="l2b3c4d5e" fub:layer="Note"${note}>`, body: [RECT_B] },
  ]);
}

/// Alfa e Beta, e un connettore dal lato destro di Alfa al sinistro di Beta.
const LINKED = drawing([
  {
    open: L1,
    body: [
      `<rect id="${A}" x="40" y="60" width="60" height="40" fill="#e69f00"><title>Alfa</title></rect>`,
      `<rect id="${B}" x="240" y="60" width="60" height="40" fill="#e69f00"><title>Beta</title></rect>`,
      `<path id="${K}" fub:shape="connector" fub:geom="straight 100 80 240 80" fub:from="${A} right" fub:to="${B} left" d="M100 80 L240 80" fill="none" stroke="#000000"/>`,
    ],
  },
]);

/// Un gruppo di disegni estranei: si sposta, ma l'editor non ne riscrive
/// la geometria.
const FOREIGN = drawing([{ open: L1, body: ['<g id="w"><rect class="logo" x="100" y="100" width="100" height="50"/></g>'] }]);

/// Un rettangolo senza id.
const NAMELESS = drawing([{ open: L1, body: ['<rect x="100" y="100" width="100" height="50" fill="#000000"/>'] }]);

// --- Le definizioni ----------------------------------------------------------

interface Modifiers {
  readonly shift?: boolean;
  readonly alt?: boolean;
  readonly cmd?: boolean;
}

/// Un trascinamento col mouse lungo `points`: giù sul primo, su
/// sull'ultimo.
function dragging(points: readonly (readonly [number, number])[], keys: Modifiers = {}): GestureEvent[] {
  const event = (kind: GestureEvent["kind"], [x, y]: readonly [number, number]): GestureEvent => ({
    kind,
    x,
    y,
    pressure: kind === "up" ? 0 : 0.5,
    shift: keys.shift ?? false,
    alt: keys.alt ?? false,
    cmd: keys.cmd ?? false,
  });
  const last = points[points.length - 1]!;
  return [event("down", points[0]!), ...points.slice(1).map((point) => event("drag", point)), event("up", last)];
}

/// Un clic in (`x`, `y`).
const click = (x: number, y: number, keys: Modifiers = {}): GestureEvent[] => dragging([[x, y]], keys);

/// Il puntatore che passa senza premere.
const hovering = (points: readonly (readonly [number, number])[]): GestureEvent[] =>
  points.map(([x, y]) => ({ kind: "move", x, y, pressure: 0, shift: false, alt: false, cmd: false }));

interface Definition {
  readonly name: string;
  readonly description: string;
  readonly input: string;
  readonly tool: GestureTool;
  readonly events: readonly GestureEvent[];
  readonly layer?: string;
  readonly selection?: readonly string[];
  readonly zoom?: number;
  readonly grid?: number;
  readonly free?: boolean;
  /// Il colore e lo spessore dello strumento di forma, se non quelli di serie.
  readonly stroke?: string;
  readonly width?: number;
}

const DEFINITIONS: readonly Definition[] = [
  // Le forme.
  {
    name: "controllo-coordinate",
    description: "rettangolo da (10, 10) a (60, 40) senza griglia: le coordinate degli eventi sono quelle della scena",
    input: EMPTY,
    tool: "rect",
    events: dragging([[10, 10], [60, 40]]),
  },
  {
    name: "controllo-coordinate-zoom",
    description: "lo stesso rettangolo con lo zoom al 200%: sullo schermo è grande il doppio, nella scena è lo stesso",
    input: EMPTY,
    tool: "rect",
    zoom: 2,
    events: dragging([[10, 10], [60, 40]]),
  },
  {
    name: "rettangolo",
    description: "un rettangolo nel livello, coi punti di mezzo del trascinamento",
    input: ONE,
    tool: "rect",
    events: dragging([[220, 40], [260, 70], [300, 90]]),
  },
  {
    name: "rettangolo-al-contrario",
    description: "un rettangolo tirato dal basso a destra verso l'alto a sinistra",
    input: EMPTY,
    tool: "rect",
    events: dragging([[300, 200], [250, 150], [220, 120]]),
  },
  {
    name: "rettangolo-maiusc-quadrato",
    description: "con Maiusc il rettangolo è un quadrato, del lato più lungo",
    input: EMPTY,
    tool: "rect",
    events: dragging([[40, 40], [90, 60], [140, 70]], { shift: true }),
  },
  {
    name: "ellisse",
    description: "un'ellisse inscritta nel riquadro tirato",
    input: EMPTY,
    tool: "ellipse",
    events: dragging([[40, 40], [80, 60], [140, 100]]),
  },
  {
    name: "ellisse-maiusc-cerchio",
    description: "con Maiusc l'ellisse è un cerchio",
    input: EMPTY,
    tool: "ellipse",
    events: dragging([[40, 40], [140, 80]], { shift: true }),
  },
  {
    name: "ellisse-stile-scelto",
    description: "un'ellisse col colore e lo spessore scelti",
    input: EMPTY,
    tool: "ellipse",
    stroke: "#0072b2",
    width: 8,
    events: dragging([[40, 40], [140, 100]]),
  },
  {
    name: "linea",
    description: "una linea da dove si preme a dove si rilascia",
    input: EMPTY,
    tool: "line",
    events: dragging([[40, 40], [100, 70], [160, 90]]),
  },
  {
    name: "linea-maiusc-15",
    description: "con Maiusc la linea va a passi di 15°: a 20° si posa su 15°",
    input: EMPTY,
    tool: "line",
    events: dragging([[40, 200], [140, 164]], { shift: true }),
  },
  {
    name: "freccia",
    description: "una freccia: la linea con la punta alla fine",
    input: EMPTY,
    tool: "arrow",
    events: dragging([[40, 40], [100, 60], [160, 80]]),
  },
  {
    name: "freccia-maiusc",
    description: "con Maiusc la freccia va a passi di 15°: quasi orizzontale diventa orizzontale",
    input: EMPTY,
    tool: "arrow",
    events: dragging([[40, 100], [160, 106]], { shift: true }),
  },
  {
    name: "freccia-stile-scelto",
    description: "una freccia col colore e lo spessore scelti: la punta li segue",
    input: EMPTY,
    tool: "arrow",
    stroke: "#d55e00",
    width: 2,
    events: dragging([[40, 40], [160, 120]]),
  },
  {
    name: "rettangolo-sotto-misura-minima",
    description: "un rettangolo più piccolo di MIN_SHAPE_PX sullo schermo non scrive niente",
    input: EMPTY,
    tool: "rect",
    events: dragging([[40, 40], [42, 42]]),
  },
  {
    name: "linea-sotto-misura-minima",
    description: "una linea più corta di MIN_SHAPE_PX sullo schermo non scrive niente",
    input: EMPTY,
    tool: "line",
    events: dragging([[40, 40], [41, 41]]),
  },
  {
    name: "rettangolo-piccolo-con-zoom",
    description: "con lo zoom al 400% due unità della scena sono otto pixel: oltre la misura minima, la forma c'è",
    input: EMPTY,
    tool: "rect",
    zoom: 4,
    events: dragging([[20, 20], [22, 22]]),
  },
  {
    name: "rettangolo-con-griglia",
    description: "con la griglia di 20 i due angoli vanno sugli incroci",
    input: EMPTY,
    tool: "rect",
    grid: 20,
    events: dragging([[43, 37], [90, 70], [127, 96]]),
  },
  {
    name: "rettangolo-griglia-libera",
    description: "con la griglia e Ctrl o ⌘ tenuto i punti restano dove sono",
    input: EMPTY,
    tool: "rect",
    grid: 20,
    free: true,
    events: dragging([[43, 37], [90, 70], [127, 96]], { cmd: true }),
  },
  {
    name: "rettangolo-livello-scelto",
    description: "scelto il livello di sotto, il rettangolo va lì, in cima ai suoi oggetti",
    input: layered(""),
    tool: "rect",
    layer: "l1a2b3c4d",
    events: dragging([[20, 200], [80, 260]]),
  },
  {
    name: "rettangolo-livello-bloccato",
    description: "in un livello bloccato non si disegna: il gesto è rifiutato e il file non cambia",
    input: layered(' fub:locked="true"'),
    tool: "rect",
    layer: "l2b3c4d5e",
    events: dragging([[20, 200], [80, 260]]),
  },
  {
    name: "rettangolo-livello-nascosto",
    description: "in un livello nascosto non si disegna: il gesto è rifiutato e il file non cambia",
    input: layered(' display="none"'),
    tool: "rect",
    layer: "l2b3c4d5e",
    events: dragging([[20, 200], [80, 260]]),
  },
  {
    name: "rettangolo-crlf",
    description: "un rettangolo in un file con righe CRLF: il testo di dopo tiene i CRLF",
    input: drawing([{ open: L1, body: [RECT_A] }], "\r\n"),
    tool: "rect",
    events: dragging([[220, 40], [300, 90]]),
  },

  // La selezione.
  {
    name: "clic-sul-vuoto",
    description: "un clic sul vuoto toglie la selezione, e non scrive niente",
    input: ONE,
    tool: "select",
    selection: [A],
    events: click(30, 250),
  },
  {
    name: "clic-su-forma",
    description: "un clic su una forma la sceglie, e non scrive niente",
    input: TWO,
    tool: "select",
    events: click(150, 125),
  },
  {
    name: "maiusc-clic-aggiunge",
    description: "Maiusc e un clic su un'altra forma la aggiunge alla selezione",
    input: TWO,
    tool: "select",
    selection: [A],
    events: click(290, 200, { shift: true }),
  },
  {
    name: "maiusc-clic-toglie",
    description: "Maiusc e un clic su una forma scelta la toglie dalla selezione",
    input: TWO,
    tool: "select",
    selection: [A, B],
    events: click(290, 200, { shift: true }),
  },
  {
    name: "riquadro-di-selezione",
    description: "un riquadro dal vuoto sceglie le forme che contiene per intero",
    input: TWO,
    tool: "select",
    events: dragging([[90, 90], [150, 130], [210, 160]]),
  },
  {
    name: "riquadro-due-forme",
    description: "un riquadro che contiene due forme le sceglie tutte e due, in ordine di documento",
    input: TWO,
    tool: "select",
    events: dragging([[330, 230], [200, 150], [90, 90]]),
  },
  {
    name: "selezione-vuota-trascinata",
    description: "senza niente di scelto, un trascinamento sul vuoto che non prende niente non scrive e non sceglie niente",
    input: ONE,
    tool: "select",
    events: dragging([[20, 200], [50, 230], [80, 260]]),
  },

  // Spostare.
  {
    name: "sposta",
    description: "premere su una forma e trascinarla la sposta con `transform`, in un passo",
    input: ONE,
    tool: "select",
    events: dragging([[150, 125], [160, 130], [170, 130]]),
  },
  {
    name: "sposta-andata-e-ritorno",
    description: "spostata di (+7, +5) e riportata indietro nello stesso gesto: lo spostamento è nullo",
    input: ONE,
    tool: "select",
    events: dragging([[150, 125], [157, 130], [150, 125]]),
  },
  {
    name: "sposta-con-griglia",
    description: "con la griglia di 20 il punto preso va sull'incrocio più vicino",
    input: ONE,
    tool: "select",
    grid: 20,
    events: dragging([[150, 125], [160, 130], [173, 131]]),
  },
  {
    name: "sposta-griglia-libera",
    description: "con la griglia e Ctrl o ⌘ tenuto lo spostamento resta quello del puntatore",
    input: ONE,
    tool: "select",
    grid: 20,
    free: true,
    events: dragging([[150, 125], [160, 130], [173, 131]], { cmd: true }),
  },
  {
    name: "sposta-due-forme",
    description: "due forme scelte si spostano insieme, in un passo",
    input: TWO,
    tool: "select",
    selection: [A, B],
    events: dragging([[150, 125], [140, 115], [130, 105]]),
  },
  {
    name: "sposta-con-zoom",
    description: "con lo zoom al 200% lo spostamento si misura nella scena, non sullo schermo",
    input: ONE,
    tool: "select",
    zoom: 2,
    events: dragging([[150, 125], [155, 128], [160, 130]]),
  },
  {
    name: "sposta-crlf",
    description: "spostare una forma in un file con righe CRLF: il testo di dopo tiene i CRLF",
    input: drawing([{ open: L1, body: [RECT_A, RECT_B] }], "\r\n"),
    tool: "select",
    events: dragging([[150, 125], [157, 130]]),
  },
  {
    name: "sposta-senza-id",
    description: "una forma senza id che si sposta riceve un id con `ident` nello stesso passo",
    input: NAMELESS,
    tool: "select",
    events: dragging([[150, 125], [160, 130], [170, 135]]),
  },
  {
    name: "sposta-estraneo",
    description: "un gruppo di disegni estranei si sposta: il suo `transform` cambia, il contenuto resta com'è",
    input: FOREIGN,
    tool: "select",
    events: dragging([[150, 125], [160, 130], [170, 130]]),
  },
  {
    name: "connettore-segue",
    description: "spostando Alfa, il connettore agganciato al suo lato destro lo segue nello stesso passo",
    input: LINKED,
    tool: "select",
    events: dragging([[70, 80], [75, 100], [70, 120]]),
  },
  {
    name: "sposta-livello-bloccato",
    description: "una forma di un livello bloccato non si prende: il trascinamento diventa un riquadro e il file non cambia",
    input: layered(' fub:locked="true"'),
    tool: "select",
    events: dragging([[290, 200], [300, 210], [310, 215]]),
  },

  // Ridimensionare.
  {
    name: "ridimensiona-angolo",
    description: "l'angolo in basso a destra tira due bordi e tiene fermo l'opposto",
    input: ONE,
    tool: "select",
    selection: [A],
    events: [...hovering([[204, 154]]), ...dragging([[204, 154], [230, 170], [254, 179]])],
  },
  {
    name: "ridimensiona-angolo-maiusc",
    description: "con Maiusc l'angolo tiene le proporzioni",
    input: ONE,
    tool: "select",
    selection: [A],
    events: dragging([[204, 154], [230, 154], [254, 154]], { shift: true }),
  },
  {
    name: "ridimensiona-lato",
    description: "il lato destro tira un bordo solo",
    input: ONE,
    tool: "select",
    selection: [A],
    events: dragging([[204, 125], [230, 140], [254, 140]]),
  },
  {
    name: "ridimensiona-lato-alt",
    description: "con Alt il lato tirato tiene fermo il centro",
    input: ONE,
    tool: "select",
    selection: [A],
    events: dragging([[204, 125], [214, 125], [224, 125]], { alt: true }),
  },
  {
    name: "ridimensiona-con-griglia",
    description: "con la griglia di 20 il bordo tirato si posa sulla riga",
    input: ONE,
    tool: "select",
    selection: [A],
    grid: 20,
    events: dragging([[204, 125], [220, 125], [237, 125]]),
  },
  {
    name: "ridimensiona-estraneo",
    description:
      "un gruppo di disegni estranei scelto, tirato dall'angolo: oggi si ridimensiona col suo `transform`, come uno spostamento, e il contenuto resta com'è",
    input: FOREIGN,
    tool: "select",
    selection: ["w"],
    events: dragging([[204, 154], [230, 170], [254, 179]]),
  },

  // Ruotare.
  {
    name: "ruota",
    description: "la maniglia in alto ruota attorno al centro, e si ferma da sola sull'angolo retto",
    input: ONE,
    tool: "select",
    selection: [A],
    events: dragging([[150, 72], [180, 80], [203, 124]]),
  },
  {
    name: "ruota-libera",
    description: "con Ctrl o ⌘ la calamita degli angoli retti è spenta",
    input: ONE,
    tool: "select",
    selection: [A],
    free: true,
    events: dragging([[150, 72], [180, 80], [203, 124]], { cmd: true }),
  },
  {
    name: "ruota-maiusc-15",
    description: "con Maiusc la rotazione va a passi di 15°: a 20° si posa su 15°",
    input: ONE,
    tool: "select",
    selection: [A],
    events: dragging([[150, 72], [160, 74], [168, 75]], { shift: true }),
  },
];

// --- La registrazione --------------------------------------------------------

const DEFAULT_STYLE = (editor: DrawEditor): Style => ({ stroke: editor.color, width: editor.width, fill: null });

/// Il gesto di `definition`, con lo stile di serie dello strumento letto
/// dall'editor quando la definizione non ne sceglie uno.
/// Lo stile di serie di ogni strumento di forma, letto una volta da un editor.
const DEFAULTS = new Map<GestureTool, Style>();

function defaultStyle(tool: GestureTool): Style {
  let style = DEFAULTS.get(tool);
  if (style === undefined) {
    const probe = mountOn(EMPTY);
    probe.setTool(tool);
    style = DEFAULT_STYLE(probe);
    probe.dispose();
    DEFAULTS.set(tool, style);
  }
  return style;
}

function gestureOf(definition: Definition): Gesture {
  const shape = definition.tool !== "select";
  let style: Style | null = null;
  if (shape) {
    const base = defaultStyle(definition.tool);
    style = { stroke: definition.stroke ?? base.stroke, width: definition.width ?? base.width, fill: null };
  }
  return {
    tool: definition.tool,
    layer: definition.layer ?? null,
    selection: definition.selection ?? [],
    zoom: definition.zoom ?? 1,
    snap: { grid: definition.grid ?? null, free: definition.free ?? false },
    style,
    events: definition.events,
  };
}

let host: HTMLElement;
let owner: Lifetime;

function mountOn(source: string, changes: DrawChange[] = [], grid: number | null = null): DrawEditor {
  return createDrawEditor(host, SceneEngine.open(source), owner, {
    onChange: (change) => changes.push(change),
    grid: grid === null ? DEFAULT_GRID : { ...DEFAULT_GRID, snap: true, step: grid },
  });
}

const surfaceOf = (): HTMLElement => host.querySelector<HTMLElement>(".draw-surface")!;
const spoken = (): string => (host.querySelector('.draw-editor > .sr-only[role="status"]')?.textContent ?? "").trim();

/// Il nome del livello `id` nel testo.
function layerName(input: string, id: string): string {
  const name = new RegExp(`<g id="${id}"[^>]* fub:layer="([^"]*)"`).exec(input)?.[1];
  if (name === undefined) throw new Error(`nessun livello ${id}`);
  return name;
}

/// Sceglie il livello `id` dal menu dei livelli, come chi disegna.
function chooseLayer(input: string, id: string): void {
  const name = layerName(input, id);
  host.querySelector<HTMLButtonElement>(".draw-layer-button")!.click();
  const open = document.querySelectorAll<HTMLElement>(".context-menu");
  const entry = [...open[open.length - 1]!.querySelectorAll<HTMLButtonElement>("button")].find((each) => each.querySelector(".menu-label")?.textContent === name);
  if (entry === undefined) throw new Error(`il menu dei livelli non ha «${name}»`);
  entry.click();
  for (const menu of document.querySelectorAll(".context-menu")) menu.remove();
}

/// Le frasi con cui l'editor rifiuta un gesto, per ogni ragione.
const REFUSALS: ReadonlyArray<readonly [Exclude<Refusal, "unmapped" | "empty">, DrawKey]> = [
  ["locked", "draw.layer.locked_here"],
  ["hidden", "draw.layer.hidden_here"],
  ["locked", "draw.no_layer"],
];

/// La ragione del rifiuto che l'editor ha detto in `said`, se è una.
function refusalIn(said: string): Refusal | null {
  const escape = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  for (const [reason, key] of REFUSALS) {
    const pattern = escape(t(key, { name: "\u0001" })).replace(/\u0001/g, ".+");
    if (new RegExp(`(^|\\s)${pattern}($|\\s)`).test(said)) return reason;
  }
  return null;
}

let clock = 1000;

/// Il puntatore che corrisponde a `event`, nel punto dello schermo dove la
/// camera mostra il punto della scena.
function dispatch(editor: DrawEditor, event: GestureEvent): void {
  const target = surfaceOf();
  const box = target.getBoundingClientRect();
  const [sx, sy] = toScreen(editor.stage.camera, [event.x, event.y]);
  const down = event.kind === "down" || event.kind === "drag";
  const type = event.kind === "down" ? "pointerdown" : event.kind === "up" ? "pointerup" : event.kind === "double_click" ? null : "pointermove";
  if (type === null) throw new Error("`double_click`: nessuno strumento registrato lo usa ancora");
  const init: PointerEventInit = {
    bubbles: true,
    cancelable: true,
    composed: true,
    isPrimary: true,
    pointerId: 1,
    pointerType: "mouse",
    altitudeAngle: Math.PI / 2,
    button: event.kind === "down" || event.kind === "up" ? 0 : -1,
    buttons: down ? 1 : 0,
    pressure: event.pressure,
    clientX: box.left + sx,
    clientY: box.top + sy,
    shiftKey: event.shift,
    altKey: event.alt,
    ctrlKey: event.cmd,
  };
  const pointer = new PointerEvent(type, init);
  Object.defineProperty(pointer, "timeStamp", { value: (clock += 8) });
  target.dispatchEvent(pointer);
}

/// Gli id del testo, a ogni profondità.
const idsIn = (text: string): Set<string> => new Set([...text.matchAll(/ id="([^"]+)"/g)].map((found) => found[1]!));

/// Ogni stringa di `value`, passata per `map`.
function mapStrings<T>(value: T, map: (text: string) => string): T {
  if (typeof value === "string") return map(value) as T;
  if (Array.isArray(value)) return value.map((each) => mapStrings(each, map)) as T;
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, each] of Object.entries(value)) out[key] = mapStrings(each, map);
    return out as T;
  }
  return value;
}

/// Gli id che le operazioni danno, nell'ordine in cui compaiono: quelli di
/// `attrs.id` e di `ident`.
function idsGiven(value: unknown, into: string[]): string[] {
  if (Array.isArray(value)) for (const each of value) idsGiven(each, into);
  else if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (record.op === "ident" && typeof record.id === "string") into.push(record.id);
    for (const [key, each] of Object.entries(record)) {
      if (key === "attrs" && each !== null && typeof each === "object" && typeof (each as Record<string, unknown>).id === "string") into.push((each as Record<string, string>).id);
      idsGiven(each, into);
    }
  }
  return into;
}

/// `expect` con gli id nuovi, quelli che `input` non ha, scritti `@1`, `@2`…
/// nell'ordine della prima comparsa: nelle operazioni, poi nel testo, poi
/// nella selezione.
function canonical(input: string, expected: Expect): Expect {
  const known = idsIn(input);
  const order: string[] = [];
  const meet = (id: string): void => {
    if (!known.has(id) && !order.includes(id)) order.push(id);
  };
  idsGiven(expected.ops, []).forEach(meet);
  idsIn(expected.text).forEach(meet);
  expected.selection.forEach(meet);
  if (order.length === 0) return expected;
  const names = new Map(order.map((id, at) => [id, `@${at + 1}`]));
  const pattern = new RegExp(`(?<![A-Za-z0-9_-])(${order.map((id) => id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})(?![A-Za-z0-9_-])`, "g");
  const rename = (text: string): string => text.replace(pattern, (id) => names.get(id)!);
  return mapStrings(expected, rename);
}

/// Fa il gesto `gesture` su un editor aperto su `input`, e ne registra
/// l'esito, con gli id nuovi canonici.
function record(input: string, gesture: Gesture): Expect {
  const changes: DrawChange[] = [];
  const editor = mountOn(input, changes, gesture.snap.grid);
  try {
    editor.stage.setCamera({ scale: gesture.zoom, tx: 0, ty: 0 });
    editor.setTool(gesture.tool);
    if (gesture.style !== null) {
      if (gesture.style.fill !== null) throw new Error("gli strumenti di oggi non riempiono: `style.fill` è sempre null");
      editor.setColor(gesture.style.stroke);
      editor.setWidth(gesture.style.width);
      expect([editor.color, editor.width]).toEqual([gesture.style.stroke, gesture.style.width]);
    }
    if (gesture.layer !== null) chooseLayer(input, gesture.layer);
    editor.select(gesture.selection);
    expect(editor.selection).toEqual(gesture.selection);
    expect(gesture.events.every((event) => event.cmd === gesture.snap.free) || !gesture.snap.free).toBe(true);
    const before = { said: spoken(), selection: [...editor.selection] };
    changes.length = 0;
    for (const event of gesture.events) dispatch(editor, event);
    const written = changes.filter((change) => change.origin === "input");
    expect(written).toEqual(changes);
    const ops = written.map((change) => {
      if (change.op === null) throw new Error("un gesto senza operazione");
      return change.op;
    });
    const text = editor.engine.text;
    if (ops.length > 0) expect(written[written.length - 1]!.text).toBe(text);
    else expect(text).toBe(input);
    const selection = [...editor.selection];
    let refused: Refusal | null = null;
    if (ops.length === 0) {
      const said = spoken();
      const reason = said === before.said ? null : refusalIn(said);
      const chose = selection.join(" ") !== before.selection.join(" ");
      refused = reason ?? (gesture.tool === "select" && chose ? null : "empty");
    }
    return canonical(input, { ops: ops.length === 0 ? null : ops, selection, refused, text });
  } finally {
    editor.dispose();
    for (const menu of document.querySelectorAll(".context-menu")) menu.remove();
  }
}

/// Il JSON di un vettore: le chiavi nell'ordine della forma, le operazioni
/// in quello in cui l'editor le scrive, due spazi e LF finale.
function serialize(vector: Vector): string {
  const { gesture, expect: expected } = vector;
  const ordered = {
    name: vector.name,
    description: vector.description,
    input: vector.input,
    gesture: {
      tool: gesture.tool,
      layer: gesture.layer,
      selection: gesture.selection,
      zoom: gesture.zoom,
      snap: { grid: gesture.snap.grid, free: gesture.snap.free },
      style: gesture.style === null ? null : { stroke: gesture.style.stroke, width: gesture.style.width, fill: gesture.style.fill },
      events: gesture.events.map((event) => ({
        kind: event.kind,
        x: event.x,
        y: event.y,
        pressure: event.pressure,
        shift: event.shift,
        alt: event.alt,
        cmd: event.cmd,
      })),
    },
    expect: { ops: expected.ops, selection: expected.selection, refused: expected.refused, text: expected.text },
  };
  return `${JSON.stringify(ordered, null, 2)}\n`;
}

// --- I file ------------------------------------------------------------------

const FILES = import.meta.glob("../../../__fixtures__/disegno-gesti/*.json", { query: "?raw", import: "default", eager: true }) as Record<string, string>;
const SAVED = new Map<string, string>(Object.entries(FILES).map(([path, text]) => [path.slice(path.lastIndexOf("/") + 1), text]));

const environment = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env ?? {};
/// Vero se la prova è lanciata per riscrivere i file.
const UPDATE = environment.UPDATE_GESTI === "1";

const fileOf = (name: string): string => `${name}.json`;

interface NodeFs {
  writeFileSync(path: string, text: string): void;
  mkdirSync(path: string, options: { recursive: boolean }): void;
  readdirSync(path: string): string[];
  unlinkSync(path: string): void;
}

/// Il modulo di Node, importato col nome calcolato: il client non ha i tipi
/// di Node, e non ne ha bisogno altrove.
async function nodeFs(): Promise<NodeFs> {
  const prefix = "node:";
  return (await import(/* @vite-ignore */ `${prefix}fs`)) as NodeFs;
}

/// La cartella dei file, come percorso calcolato dal testo dell'indirizzo di
/// questo file: sotto happy-dom `URL` è quello del finto browser, che non
/// risolve gli indirizzi `file:` e che `node:fs` non accetta.
const FOLDER = `${decodeURIComponent(import.meta.url.replace(/^file:\/\//, "")).replace(/\/src\/editors\/spatial\/tools\/[^/]+$/, "")}/src/__fixtures__/disegno-gesti/`;

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  owner = openLifetime();
});

afterEach(() => {
  owner.close();
  host.remove();
  vi.restoreAllMocks();
});

describe("i vettori dei gesti", () => {
  it("le definizioni sono almeno trenta, coi nomi in kebab-case e senza doppioni", () => {
    expect(DEFINITIONS.length).toBeGreaterThanOrEqual(30);
    const names = DEFINITIONS.map((definition) => definition.name);
    expect(new Set(names).size).toBe(names.length);
    for (const name of names) expect(name).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
  });

  it.runIf(UPDATE)("toglie i file che nessuna definizione ha più", async () => {
    const fs = await nodeFs();
    fs.mkdirSync(FOLDER, { recursive: true });
    const wanted = new Set(DEFINITIONS.map((definition) => fileOf(definition.name)));
    for (const file of fs.readdirSync(FOLDER)) if (file.endsWith(".json") && !wanted.has(file)) fs.unlinkSync(`${FOLDER}${file}`);
  });

  // Riscrivendo i file non c'è niente da confrontare: quelli salvati sono
  // quelli letti prima della riscrittura.
  it.skipIf(UPDATE)("ogni file ha la sua definizione, e ogni definizione il suo file", () => {
    expect([...SAVED.keys()].sort()).toEqual(DEFINITIONS.map((definition) => fileOf(definition.name)).sort());
  });

  for (const definition of DEFINITIONS) {
    it(`${definition.name}: ${definition.description}`, { timeout: 60_000 }, async () => {
      const gesture = gestureOf(definition);
      const vectorOf = (input: string, played: Gesture): Vector => ({
        name: definition.name,
        description: definition.description,
        input,
        gesture: played,
        expect: record(input, played),
      });
      if (UPDATE) {
        // Due registrazioni, lo stesso file: un vettore che non si rifà uguale
        // non è un oracolo.
        const first = serialize(vectorOf(definition.input, gesture));
        const second = serialize(vectorOf(definition.input, gesture));
        expect(second, `${definition.name}: due registrazioni danno due file diversi`).toBe(first);
        const fs = await nodeFs();
        fs.mkdirSync(FOLDER, { recursive: true });
        fs.writeFileSync(`${FOLDER}${fileOf(definition.name)}`, first);
        return;
      }
      const saved = SAVED.get(fileOf(definition.name));
      if (saved === undefined) throw new Error(`${definition.name}: manca il file ${fileOf(definition.name)}; rigeneralo con UPDATE_GESTI=1`);
      const vector = JSON.parse(saved) as Vector;
      // Il gesto si rigioca dal solo file, due volte, e dà sempre il suo
      // esito: è ciò che il motore deve rifare.
      const first = record(vector.input, vector.gesture);
      const second = record(vector.input, vector.gesture);
      expect(second, `${definition.name}: due registrazioni danno due esiti diversi`).toEqual(first);
      expect(first, `${definition.name}: il gesto non dà più l'esito del file`).toEqual(vector.expect);
      // E il file è quello che la definizione scrive, byte per byte: chiavi,
      // ordine, due spazi e LF finale.
      const written = serialize({ name: definition.name, description: definition.description, input: definition.input, gesture, expect: first });
      expect(saved, `${definition.name}: il file non è quello che la definizione scrive; rigeneralo con UPDATE_GESTI=1`).toBe(written);
    });
  }
});
