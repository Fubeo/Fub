// La porta del banco (`fake-ipc.ts`): il disegno e il suo motore finto; poi
// la luce, il vault e i componenti dell'avvio.
import { type DrawingFake } from "../src/host/fake";
import type { DrawingCommandInfo, DrawingCommandRequest, DrawingGesture, DrawingLoss, DrawingOutcome } from "../src/host/contract";
import { CONNECTORS_DOC, type ConnectorsFixture } from "./connectors-fixture";
import { DEFS_ID } from "../src/editors/spatial/scene/ids";
import { RISPOSTE, rispostaDiFamiglia } from "./disegno-famiglie/risposte";
import { comandiProva, comandiSelezione, comandiTrasformazioni, INDICE_PROVA } from "./disegno-indice-prova";
import { selezioneDelClic } from "./disegno-clic";
import { LARGE_DOC } from "./large-fixture";
import { params, CONNECTORS, LARGE } from "./fake-ipc-casi";

// `?campioni=N` (K6 T10, la scheda Risorse): il disegno dei connettori con N
// campioni del documento in `<defs>`, gradienti lineari con un `fub:name` e
// un solo stop, com'è scritto un campione che `scene/classify` legge. Senza,
// il disegno è quello di sempre.
const CAMPIONI_PARAM = params.get("campioni");

/// Il testo del disegno con `count` campioni nel primo `<defs>` aperto.
function conCampioni(text: string, count: number): string {
  if (!/^(0|[1-9]\d{0,3})$/.test(String(count))) throw new RangeError("campioni must be a count from 0 to 9999");
  const campioni = Array.from({ length: count }, (_, index) => {
    const colore = (((index + 1) * 2654435761) >>> 0) & 0xffffff;
    const hex = colore.toString(16).padStart(6, "0");
    return `<linearGradient id="campione-${index + 1}" fub:role="swatch" fub:name="Campione ${index + 1}"><stop stop-color="#${hex}"/></linearGradient>`;
  }).join("");
  return text.replace(/<defs\b[^>]*[^/]>/, (open) => `${open}${campioni}`);
}

// `?elabora=1` (K6 T12, giro 5, Elaborazione tracciati): il disegno dei connettori con
// due forme sovrapposte in fondo al primo livello, un rettangolo dietro e un cerchio
// davanti, nel vuoto in basso a destra. Le risposte di Unione e Meno davanti
// (`disegno-famiglie/tracciati.json`) le tolgono e mettono il tracciato al posto del
// cerchio, com'è il motore vero (`crates/fub-disegno/tests/famiglie/tracciati.json`).
const ELABORA_PARAM = params.get("elabora");
if (ELABORA_PARAM !== null && ELABORA_PARAM !== "1") throw new RangeError("elabora must be 1");

/// Il testo del disegno con le due forme sovrapposte alla fine del primo livello.
function conSovrapposte(text: string): string {
  const forme =
    `    <rect id="o0000001a" fub:name="Dietro" x="620" y="320" width="160" height="100" fill="#e9d8fd"/>\n` +
    `    <ellipse id="o0000001b" fub:name="Davanti" cx="780" cy="420" rx="60" ry="60" fill="#fce7f3" stroke="#1a202c" stroke-width="2"/>\n`;
  return text.replace(/\n  <\/g>\n<\/svg>/, (fine) => `\n${forme.trimEnd()}${fine}`);
}

// `?aspetto=contorno|sfumatura` (K6 T15, giro 5, le sezioni Contorno e Sfumatura): la prima forma del
// disegno dei connettori con un contorno spesso e tratteggiato, o riempita da una sfumatura lineare
// privata a tre punti, scritta come la scrive la scena. Senza, il disegno è quello di sempre.
const ASPETTO_PARAM = params.get("aspetto");

/// Il testo del disegno con l'aspetto `aspetto` sulla prima forma.
function conAspetto(text: string, fixture: ConnectorsFixture, aspetto: string): string {
  const forma = fixture.shapes[0];
  if (forma === undefined) return text;
  const apertura = new RegExp(`<(rect|ellipse|polygon)\\b[^>]*\\bid="${forma.id}"[^>]*?(/?)>`);
  const senza = (tag: string, nomi: readonly string[]): string => nomi.reduce((t, nome) => t.replace(new RegExp(`\\s${nome}="[^"]*"`), ""), tag);
  if (aspetto === "contorno") {
    return text.replace(apertura, (tag) =>
      senza(tag, ["stroke", "stroke-width", "stroke-dasharray"]).replace(/\s*(\/?)>$/, ' stroke="#1f2937" stroke-width="8" stroke-dasharray="20 8"$1>'));
  }
  if (aspetto !== "sfumatura") throw new RangeError("aspetto must be contorno or sfumatura");
  const g = forma.geometry;
  const [x1, x2, y] = forma.kind === "rect"
    ? [g[0]!, g[0]! + g[2]!, g[1]! + g[3]! / 2]
    : forma.kind === "ellipse"
      ? [g[0]! - g[2]!, g[0]! + g[2]!, g[1]!]
      : [Math.min(...g.filter((_, i) => i % 2 === 0)), Math.max(...g.filter((_, i) => i % 2 === 0)), g[1]!];
  const sfumatura = `<linearGradient id="rbanco001" fub:role="private" gradientUnits="userSpaceOnUse" x1="${x1}" y1="${y}" x2="${x2}" y2="${y}">`
    + '<stop offset="0" stop-color="#0072b2"/><stop offset="0.5" stop-color="#f0e442"/><stop offset="1" stop-color="#d55e00"/></linearGradient>';
  const conDefs = /<defs\b[^>]*[^/]>/.test(text)
    ? text.replace(/<defs\b[^>]*[^/]>/, (open) => `${open}${sfumatura}`)
    : text.replace(/(<svg\b[^>]*>)/, `$1<defs id="fub-defs">${sfumatura}</defs>`);
  return conDefs.replace(apertura, (tag) => senza(tag, ["fill"]).replace(/\s*(\/?)>$/, ' fill="url(#rbanco001) #a8a07a"$1>'));
}

/// Il testo del disegno dei connettori con i parametri della pagina.
function testoDeiConnettori(fixture: ConnectorsFixture): string {
  const conIParametri = CAMPIONI_PARAM === null ? fixture.text : conCampioni(fixture.text, Number(CAMPIONI_PARAM));
  const conAspetti = ASPETTO_PARAM === null ? conIParametri : conAspetto(conIParametri, fixture, ASPETTO_PARAM);
  return ELABORA_PARAM === "1" ? conSovrapposte(conAspetti) : conAspetti;
}

/// Il disegno che il banco apre dall'albero, se ne ha uno.
export const DRAWING = CONNECTORS !== null
  ? { doc: CONNECTORS_DOC, text: testoDeiConnettori(CONNECTORS) }
  : LARGE !== null
    ? { doc: LARGE_DOC, text: LARGE.text }
    : null;

// `?drawing=acceso|spento|errore` dà al banco il motore del disegno (K5 T23),
// per le scene del chip del motore (`draw-engine-*` in `scene.mjs`). Senza,
// come l'host senza il componente, le porte del disegno rispondono
// `unserved` e il disegno resta sugli strumenti semplici, come lo conoscono
// le foto di prima.
//
// - `acceso`: l'apertura dice due parti che restano come sono, due righe
//   delle parti del corpus (`crates/fub-disegno/tests/corpus/perdite.tsv`)
//   sugli elementi del disegno dei connettori: le risorse in `<defs>` e la
//   prima forma. I gesti rispondono le operazioni dei vettori dei gesti
//   (`__fixtures__/disegno-gesti/`) quando il disegno e lo strumento sono
//   quelli di un vettore; ogni altro gesto non scrive niente (`empty`): il
//   motore del banco sa soltanto i vettori.
//   I comandi rispondono con `disegno-famiglie/<famiglia>.json`
//   (`disegno-famiglie/risposte.ts`).
// - `spento`: il motore spento nel vault, ogni porta del disegno `unserved`.
// - `errore`: l'apertura fallisce con `internal`, il motore è fermo.
const DRAWING_ENGINE_PARAM = params.get("drawing");
// `?indice=prova` porta al Disegno completo l'indice di prova del menu ≡ e di
// Ctrl+/ (K6 T9a, `disegno-indice-prova.ts`), al posto di quello generato, che
// è vuoto finché nessuna riga è fatta.
export const INDICE_PARAM = params.get("indice");
if (DRAWING_ENGINE_PARAM !== null && !["acceso", "spento", "errore"].includes(DRAWING_ENGINE_PARAM)) {
  throw new RangeError("drawing must be acceso, spento or errore");
}
/// `?motore=prova|nuovo|rotto` (K6 T11): le preferenze del motore in
/// Impostazioni › Disegni, con il motore acceso (`?drawing=acceso`). `prova`:
/// `draw.motore` vuoto, campi accesi; `nuovo`: scritto da un Fub più nuovo;
/// `rotto`: non si legge. Nelle ultime due il riquadro è in sola lettura.
export const MOTORE_PARAM = params.get("motore");
if (MOTORE_PARAM !== null && !["prova", "nuovo", "rotto"].includes(MOTORE_PARAM)) {
  throw new RangeError("motore must be prova, nuovo or rotto");
}

/// `?punti=1` (K6 T12): con la Selezione diretta o il Punto di ancoraggio
/// del motore, lo stato dello strumento dice un punto scelto sulla prima
/// forma del disegno, per la fila dei punti; senza, nessun punto.
const PUNTI_PARAM = params.get("punti");
if (PUNTI_PARAM !== null && PUNTI_PARAM !== "1") throw new RangeError("punti must be 1");

/// Lo stato dello strumento del banco con un punto scelto (`?punti=1`), o
/// `null` per una richiesta che non lo chiede.
function benchStatoCoiPunti(request: DrawingCommandRequest): DrawingOutcome | null {
  if (PUNTI_PARAM !== "1" || request.id !== "disegno.strumento.stato") return null;
  const strumento = (request.value as { strumento?: unknown } | null)?.strumento;
  if (strumento !== "directSelection" && strumento !== "anchorPoint") return null;
  const element = CONNECTORS?.shapes[0]?.id ?? "banco";
  return {
    revision: request.revision, preview: null, ops: null, selection: request.selection, losses: [], refused: null, frame: null,
    state: {
      busy: false, transforming: false, wants_text: false, composing: false, cursor: "arrow", options: null,
      anchors: [{ element, subpath: 0, anchor: 0, at: [292.99, 170.14], end: false }],
    },
  };
}

/// Le righe di `prefs.list` del banco: un pezzo dell'elenco vero del motore
/// (`vendor/vectorcraft/crates/engine/src/cmd/prefscmds.rs`), con ogni tipo di
/// campo, nelle parole del motore che la sezione traduce.
const BENCH_PREFS: readonly Record<string, unknown>[] = [
  { key: "keyboardIncrement", category: "General", section: "", label: "Keyboard Increment", value: 1, kind: "number", min: 0.001, max: 1296, unit: "pt", measure: "General" },
  { key: "constrainAngle", category: "General", section: "", label: "Constrain Angle", value: 0, kind: "number", min: -360, max: 360, unit: "°" },
  { key: "cornerRadius", category: "General", section: "", label: "Corner Radius", value: 12, kind: "number", min: 0, max: 1296, unit: "pt", measure: "General" },
  { key: "usePreciseCursors", category: "General", section: "Options", label: "Use Precise Cursors", value: false, kind: "bool" },
  { key: "showToolTips", category: "General", section: "Options", label: "Show Tool Tips", value: true, kind: "bool" },
  { key: "scaleStrokes", category: "General", section: "Options", label: "Scale Strokes & Effects", value: false, kind: "bool" },
  { key: "zoomWithMouseWheel", category: "General", section: "Options", label: "Zoom with Mouse Wheel", value: false, kind: "bool" },
  { key: "selectionTolerance", category: "Selection & Anchor Display", section: "Selection", label: "Tolerance", value: 3, kind: "number", min: 1, max: 8, unit: "px" },
  { key: "anchorSize", category: "Selection & Anchor Display", section: "Anchor Points, Handle, and Bounding Box Display", label: "Size", value: 3, kind: "integer", min: 1, max: 7 },
  { key: "handleStyle", category: "Selection & Anchor Display", section: "Anchor Points, Handle, and Bounding Box Display", label: "Handles", value: "solid", kind: "choice", options: ["solid", "hollow", "large"] },
  { key: "guideColor", category: "Guides & Grid", section: "Guides", label: "Color", value: "#4affff", kind: "color" },
  { key: "guideStyle", category: "Guides & Grid", section: "Guides", label: "Style", value: "lines", kind: "choice", options: ["lines", "dots"] },
  { key: "gridColor", category: "Guides & Grid", section: "Grid", label: "Color", value: "#d0d0d0", kind: "color" },
  { key: "gridlineEvery", category: "Guides & Grid", section: "Grid", label: "Gridline every", value: 72, kind: "number", min: 1, max: 16383, unit: "pt", measure: "General" },
  { key: "gridSubdivisions", category: "Guides & Grid", section: "Grid", label: "Subdivisions", value: 8, kind: "integer", min: 1, max: 1000 },
  { key: "hyphenationExceptions", category: "Hyphenation", section: "", label: "Exceptions (comma separated)", value: "", kind: "text" },
];

/// L'esito di un comando delle preferenze del motore del banco.
function benchPrefsOutcome(request: DrawingCommandRequest): DrawingOutcome {
  const outcome: DrawingOutcome = { revision: request.revision, preview: null, ops: null, selection: request.selection, losses: [], refused: null, frame: null };
  return { ...outcome, reading: request.id === "disegno.prefs.list" ? BENCH_PREFS : null };
}

/// Un vettore dei gesti, per quel che il motore del banco ne legge.
interface BenchGestureVector {
  readonly input: string;
  readonly gesture: { readonly tool: string };
  readonly expect: { readonly ops: readonly unknown[] | null; readonly selection: readonly string[]; readonly refused: DrawingOutcome["refused"] };
}

const GESTURE_VECTORS = Object.values(
  import.meta.glob("../src/__fixtures__/disegno-gesti/*.json", { import: "default", eager: true }),
) as BenchGestureVector[];

/// Gli id nuovi che il motore del banco ha dato: uno nuovo per ogni `@n` di
/// ogni rilascio.
let benchDrawingIds = 0;

/// L'istanza dell'ultimo disegno aperto dal motore del banco: la finestra del
/// comando la usa (`window.bench.finestra`).
export let benchLastInstance: string | null = null;

/// Il comando che la finestra «Sposta tracciato» del banco manda. Il banco non
/// sposta niente: la finestra si guarda, e il suo esito è una riga tratteggiata
/// sul foglio quando l'anteprima è accesa.
export const BENCH_WINDOW_COMMAND = "tracciato.sposta";

/// L'esito del comando della finestra per il motore del banco: con `preview`
/// un'anteprima vuota (la forma il motore vera la calcola), altrimenti un passo
/// senza operazioni. Un comando di un altro id è una porta che il banco non
/// conosce.
function benchWindowOutcome(request: DrawingCommandRequest): DrawingOutcome {
  const outcome: DrawingOutcome = { revision: request.revision, preview: null, ops: null, selection: request.selection, losses: [], refused: null, frame: null };
  if (request.id !== BENCH_WINDOW_COMMAND) return { ...outcome, refused: "unsupported" };
  if (request.preview === true) return { ...outcome, preview: { shape: null, matrix: null, marquee: null, overlays: [] } };
  return { ...outcome, ops: "[]" };
}

/// La casella del Testo del motore del banco (K6 T16): dove il clic l'ha aperta e le righe scritte.
/// Il banco non sa misurare il carattere: il cursore sta dopo l'ultima lettera a mezzo corpo per
/// lettera, abbastanza per guardare la casella che si scrive.
let benchTypeBox: { x: number; y: number; righe: string[] } | null = null;
/// Il corpo e il carattere di un testo nuovo, come il ponte del motore vero (`TEXT_SIZE`, `TEXT_FAMILY`).
const BENCH_TYPE_SIZE = 32;

/// L'esito di un gesto del Testo del motore del banco: il clic apre la casella, i tasti e il testo
/// la riempiono, e finché è aperta l'anteprima mostra le righe e il cursore. La conferma scrive il
/// testo nel livello del gesto e lo lascia scelto, come il motore vero; una casella vuota non scrive
/// niente.
function benchTypeOutcome(gesture: DrawingGesture, outcome: DrawingOutcome): DrawingOutcome {
  const stato = (busy: boolean) => ({ busy, transforming: false, wants_text: busy, composing: false, cursor: "text", options: null });
  const primo = gesture.events[0];
  if (benchTypeBox === null && primo !== undefined && primo.kind === "down") benchTypeBox = { x: primo.x, y: primo.y, righe: [""] };
  const box = benchTypeBox;
  if (box === null) return { ...outcome, state: stato(false) };
  let preedit = "";
  for (const ingresso of gesture.inputs ?? []) {
    const ultima = box.righe.length - 1;
    if (ingresso.kind === "text") box.righe[ultima] += ingresso.text;
    else if (ingresso.kind === "ime") preedit = ingresso.preedit;
    else if (ingresso.kind === "key" && ingresso.pressed && ingresso.key === "Enter") box.righe.push("");
    else if (ingresso.kind === "key" && ingresso.pressed && ingresso.key === "Backspace") box.righe[ultima] = [...box.righe[ultima]!].slice(0, -1).join("");
  }
  const passo = BENCH_TYPE_SIZE * 1.2;
  const shape = {
    tag: "text",
    attrs: { x: String(box.x), y: String(box.y), "font-family": "Inter, sans-serif", "font-size": String(BENCH_TYPE_SIZE), fill: "#1a1a1a" },
    children: box.righe.map((riga, at) => ({
      tag: "tspan",
      attrs: { x: String(box.x), ...(at === 0 ? {} : { dy: String(passo) }) },
      text: at === box.righe.length - 1 ? riga + preedit : riga,
    })),
  };
  if (gesture.phase === "commit") {
    benchTypeBox = null;
    if (gesture.layer === null || box.righe.join("") === "") return { ...outcome, refused: "empty", state: stato(false) };
    const id = `oz${String(++benchDrawingIds).padStart(7, "0")}`;
    const elem = { ...shape, attrs: { id, ...shape.attrs } };
    return { ...outcome, ops: JSON.stringify([{ op: "add", parent: gesture.layer, pos: { last: true }, elem }]), selection: [id], state: stato(false) };
  }
  const ultima = box.righe[box.righe.length - 1]! + preedit;
  const cx = box.x + [...ultima].length * BENCH_TYPE_SIZE * 0.5;
  const cy = box.y + (box.righe.length - 1) * passo;
  const caret = { kind: "line" as const, a: [cx, cy - BENCH_TYPE_SIZE * 0.8] as [number, number], b: [cx, cy + BENCH_TYPE_SIZE * 0.2] as [number, number], role: "preview" as const, width: 1, dashed: false };
  return { ...outcome, preview: { shape, matrix: null, marquee: null, overlays: [caret] }, state: stato(true) };
}

/// Dove è cominciato il trascinamento dello strumento Sfumatura del banco.
let benchGradientStart: [number, number] | null = null;

/// L'esito di un gesto dello strumento Sfumatura del motore del banco (K6 T15, giro 6): mentre si
/// trascina, l'annotatore come lo disegna il motore vero (la barra dall'inizio al punto di adesso, la
/// maniglia d'inizio e un campione per punto, qui i due della sfumatura di serie); il rilascio non
/// scrive niente, come gli altri comandi dell'aspetto del banco.
function benchGradientOutcome(gesture: DrawingGesture, outcome: DrawingOutcome): DrawingOutcome {
  const primo = gesture.events[0];
  if (benchGradientStart === null && primo !== undefined && primo.kind === "down") benchGradientStart = [primo.x, primo.y];
  const ultimo = gesture.events[gesture.events.length - 1];
  const inizio = benchGradientStart;
  if (gesture.phase === "commit") {
    benchGradientStart = null;
    return inizio === null || gesture.selection.length === 0 ? { ...outcome, refused: "empty" } : { ...outcome, ops: "[]" };
  }
  if (inizio === null || ultimo === undefined) return outcome;
  const fine: [number, number] = [ultimo.x, ultimo.y];
  return {
    ...outcome,
    preview: {
      shape: null,
      matrix: null,
      marquee: null,
      overlays: [
        { kind: "line", a: inizio, b: fine, role: "guide", dashed: false },
        { kind: "handle", at: inizio, role: "guide" },
        { kind: "swatch", at: inizio, color: "#ffffff", selected: false },
        { kind: "swatch", at: fine, color: "#000000", selected: false },
      ],
    },
  };
}

/// L'esito di un gesto del motore del banco sulla copia di testo `text`.
function benchDrawingOutcome(gesture: DrawingGesture, text: string): DrawingOutcome {
  const outcome: DrawingOutcome = { revision: gesture.revision, preview: null, ops: null, selection: gesture.selection, losses: [], refused: null, frame: null };
  if (typeof gesture.tool === "object" && gesture.tool.engine.id === "type") return benchTypeOutcome(gesture, outcome);
  if (typeof gesture.tool === "object" && gesture.tool.engine.id === "gradient") return benchGradientOutcome(gesture, outcome);
  if (gesture.phase !== "commit") return outcome;
  const vector = GESTURE_VECTORS.find((each) => each.gesture.tool === gesture.tool && each.input === text);
  if (vector === undefined) {
    // Il clic di Selezione sceglie ciò che sta sotto il punto, come il motore (K6 T15, giro 2): la
    // Selezione di Fub e quella del Completo (`selection` del motore), che la sostituisce nella
    // colonna. Gli altri gesti senza vettore non cambiano niente.
    const selezione = gesture.tool === "select" || (typeof gesture.tool === "object" && gesture.tool.engine.id === "selection");
    const scelta = selezione ? selezioneDelClic(gesture) : null;
    return scelta === null ? { ...outcome, refused: "empty" } : { ...outcome, selection: scelta };
  }
  const names = new Map<string, string>();
  const real = (value: string): string =>
    value.replace(/@(\d+)/g, (found) => {
      if (!names.has(found)) names.set(found, `oz${String(++benchDrawingIds).padStart(7, "0")}`);
      return names.get(found)!;
    });
  return {
    ...outcome,
    ops: vector.expect.ops === null ? null : real(JSON.stringify(vector.expect.ops)),
    selection: vector.expect.selection.map(real),
    refused: vector.expect.refused,
  };
}

/// I livelli di Fub del testo `testo` come li legge `document.inspect` nel motore vero (K6 T15, giro 4): il
/// `name` è l'id della scena, il nome a parole resta in `fub:layer`; il numero è la posizione nel testo, così
/// resta lo stesso fra una lettura e la successiva. Occhio e lucchetto vengono dagli attributi.
function benchLivelli(testo: string): { id: number; name: string; kind: "Layer"; visible: boolean; locked: boolean; children: [] }[] {
  return [...testo.matchAll(/<g\s([^>]*\bfub:layer="[^"]*"[^>]*)>/g)].flatMap((trovato, indice) => {
    const attributi = trovato[1] ?? "";
    const id = /\bid="([^"]+)"/.exec(attributi)?.[1];
    if (id === undefined) return [];
    const visible = !/\bdisplay="none"/.test(attributi);
    const locked = /\bfub:locked="true"/.test(attributi);
    return [{ id: indice + 1, name: id, kind: "Layer" as const, visible, locked, children: [] as [] }];
  });
}

/// Seleziona tutto e Deseleziona sul disegno del banco: il Completo li manda al motore con
/// Ctrl+A e Esc. Tutto vuol dire gli oggetti in cima al disegno o in cima a un livello
/// visibile e non bloccato, senza le risorse di `<defs>` e senza gli oggetti bloccati, come
/// il motore vero. `null` per gli altri comandi.
function benchSelezioneOutcome(request: DrawingCommandRequest, testo: string): DrawingOutcome | null {
  if (request.id !== "disegno.select.all" && request.id !== "disegno.select.none") return null;
  const esito: DrawingOutcome = {
    revision: request.revision, preview: null, ops: null, selection: [], losses: [], refused: null, frame: null,
  };
  if (request.id === "disegno.select.none") return esito;
  const radice = new DOMParser().parseFromString(testo, "image/svg+xml").documentElement;
  const scelti: string[] = [];
  const raccogli = (padre: Element): void => {
    for (const figlio of padre.children) {
      const nome = figlio.localName;
      if (nome === "defs" || nome === "metadata" || nome === "title" || nome === "desc" || nome === "style") continue;
      if (figlio.getAttribute("fub:locked") === "true") continue;
      if (nome === "g" && figlio.hasAttribute("fub:layer")) {
        if (figlio.getAttribute("display") !== "none") raccogli(figlio);
        continue;
      }
      const id = figlio.getAttribute("id");
      if (id !== null && id !== "") scelti.push(id);
    }
  };
  raccogli(radice);
  return { ...esito, selection: scelti };
}

/// `disegno.document.node` sul disegno del banco: la lettura di un oggetto, che le sezioni del Design
/// chiedono appena qualcosa è scelto (Contorno, Quota, Oggetti sul tracciato). Ha l'id e il tipo
/// e, se l'oggetto ha un contorno, lo spessore e le opzioni come le rende il motore
/// (`crates/fub-disegno/src/famiglie/nucleo.rs`). Niente quota né oggetti sul tracciato: quelle
/// sezioni non ci sono. Un id che il disegno non ha è un rifiuto (`unmapped`). `null` per gli
/// altri comandi.
function benchNodoOutcome(request: DrawingCommandRequest, testo: string): DrawingOutcome | null {
  if (request.id !== "disegno.document.node") return null;
  const esito: DrawingOutcome = {
    revision: request.revision, preview: null, ops: null, selection: request.selection, losses: [], refused: null, frame: null,
  };
  const id = (request.value as { id?: unknown } | null)?.id;
  const radice = new DOMParser().parseFromString(testo, "image/svg+xml").documentElement;
  const nodo = typeof id === "string" ? [...radice.querySelectorAll("[id]")].find((el) => el.getAttribute("id") === id) : undefined;
  if (nodo === undefined) return { ...esito, refused: "unmapped" };
  const lettura: Record<string, unknown> = { id, type: nodo.localName };
  const tratto = nodo.getAttribute("stroke");
  if (tratto !== null && tratto !== "none") {
    const trattini = (nodo.getAttribute("stroke-dasharray") ?? "").split(/[\s,]+/).filter(Boolean).map(Number).filter(Number.isFinite);
    lettura.strokeWidth = Number(nodo.getAttribute("stroke-width") ?? "1");
    lettura.strokeOptions = { dash: trattini, dashOffset: 0, miterLimit: 10, align: "center", arrowScale: [100, 100], canAlign: nodo.localName !== "path" && nodo.localName !== "line" && nodo.localName !== "polyline" };
  }
  return { ...esito, reading: lettura };
}

/// I comandi della famiglia `livelli` sul disegno del banco (K6 T15, giro 4), con la regola del motore vero
/// (`crates/fub-disegno/src/famiglie/livelli.rs`): un livello bloccato non cambia nome e non si elimina, occhio
/// e lucchetto sì; un livello nuovo va in cima. `null` per gli altri comandi.
function benchLivelliOutcome(request: DrawingCommandRequest, testo: string): DrawingOutcome | null {
  const esito = (extra: Partial<DrawingOutcome>): DrawingOutcome => ({
    revision: request.revision, preview: null, ops: null, selection: request.selection, losses: [], refused: null, frame: null, ...extra,
  });
  const livelli = benchLivelli(testo);
  const valore = (request.value ?? {}) as { ids?: number[]; name?: string; visible?: boolean; locked?: boolean };
  const scelto = livelli.find((livello) => livello.id === valore.ids?.[0]);
  switch (request.id) {
    case "disegno.document.inspect":
      return esito({ reading: { layers: [...livelli].reverse() } });
    case "disegno.layer.new": {
      // Un id di livello come quelli della scena (`l` e otto cifre o lettere).
      const id = `lz${String(++benchDrawingIds).padStart(7, "0")}`;
      const elem = { tag: "g", attrs: { id, "fub:layer": valore.name ?? "Livello" }, children: [] };
      return esito({ ops: JSON.stringify([{ op: "add", parent: "#root", pos: { last: true }, elem }]) });
    }
    case "disegno.layer.setProps": {
      if (scelto === undefined) return esito({ refused: "empty" });
      if (valore.name !== undefined && scelto.locked) return esito({ refused: "locked" });
      const attrs: Record<string, string | null> = {};
      if (valore.name !== undefined) attrs["fub:layer"] = valore.name;
      if (valore.visible !== undefined) attrs.display = valore.visible ? null : "none";
      if (valore.locked !== undefined) attrs["fub:locked"] = valore.locked ? "true" : null;
      return esito({ ops: JSON.stringify([{ op: "set", id: scelto.name, attrs }]) });
    }
    case "disegno.layer.delete":
      if (scelto === undefined) return esito({ refused: "empty" });
      if (scelto.locked) return esito({ refused: "locked" });
      return esito({ ops: JSON.stringify([{ op: "remove", target: scelto.name }]) });
    default:
      return null;
  }
}

/// Il motore del disegno del banco, se la query ne chiede uno.
function benchDrawingEngine(): DrawingFake | undefined {
  if (DRAWING_ENGINE_PARAM === "spento") return { spento: () => true };
  if (DRAWING_ENGINE_PARAM === "errore") {
    return {
      open: () => {
        throw { kind: "internal", message: "banco: il motore del disegno si è fermato" };
      },
    };
  }
  if (DRAWING_ENGINE_PARAM !== "acceso") return undefined;
  const first = CONNECTORS?.shapes[0]?.id ?? null;
  const losses: DrawingLoss[] = [
    { element: DEFS_ID, kind: "unmapped", detail: "dentro <defs>: una risorsa, non un oggetto del disegno" },
    ...(first === null ? [] : [{ element: first, kind: "unmapped" as const, detail: "il motore non ne fa un oggetto suo" }]),
  ];
  let instances = 0;
  return {
    // I comandi della prova: quali valgono per la selezione, e il perché (K6 T9a).
    // Con `?comandi=risposti` valgono quelli a cui il banco sa rispondere
    // (`disegno-famiglie/`, K6 T12 giro 4): la finestra di Sposta tracciato e
    // Converti della sezione dei punti si aprono come col motore vero. Senza,
    // quelli delle trasformazioni (K6 T13 giro 3) e della Selezione (K6 T15).
    comandi:
      INDICE_PARAM === "prova"
        ? (selection) => comandiProva(selection)
        : params.get("comandi") === "risposti"
          ? () => comandiRisposti()
          : (selection) => [...comandiTrasformazioni(selection), ...comandiSelezione(selection, CONNECTORS?.labels ?? [])],
    open: () => {
      const instance = `banco-${++instances}`;
      benchLastInstance = instance;
      return { instance, revision: "0", mapped: 0, unmapped: losses.length, losses };
    },
    gesto: (gesture, copia) => benchDrawingOutcome(gesture, copia.text),
    // Il comando delle scene della finestra ha la sua risposta; gli altri
    // comandi del Disegno completo hanno quelle di `disegno-famiglie/`, e
    // `unserved` un comando che non ne ha una.
    // Le preferenze del motore rispondono sempre: il Completo le legge appena
    // si apre (`disegno.prefs.get`, la sezione Trasforma), e un `unserved` a
    // una richiesta della sessione aperta la ferma come motore spento.
    // Seleziona tutto e Deseleziona leggono la copia del disegno.
    // I livelli (K6 T15, giro 4) leggono e cambiano la copia del disegno, come il motore vero.
    comando: (request, copia) =>
      benchStatoCoiPunti(request) ?? benchSelezioneOutcome(request, copia.text) ?? benchNodoOutcome(request, copia.text) ?? benchLivelliOutcome(request, copia.text) ?? (request.id === BENCH_WINDOW_COMMAND
        ? benchWindowOutcome(request)
        : request.id.startsWith("disegno.prefs.")
          ? benchPrefsOutcome(request)
          : rispostaDiFamiglia(request)),
  };
}

/// I comandi che il banco sa fare con l'indice generato: uno per risposta di
/// `disegno-famiglie/`, accesi.
function comandiRisposti(): DrawingCommandInfo[] {
  return [...new Set(RISPOSTE.map((r) => r.comando))].map((id) => ({ id, enabled: true, disabled_reason: null }));
}

/// Il motore del disegno del banco: `undefined` senza `?drawing=`.
export const DRAWING_ENGINE = benchDrawingEngine();
// L'indice di prova entra prima che il Completo chieda il suo: `indice()` lo
// memorizza alla prima chiamata, e il banco apre il disegno dopo.
if (INDICE_PARAM === "prova") {
  void import("../src/editors/spatial/completo/indice").then((modulo) => modulo.usaIndiceDiProva(INDICE_PROVA));
}

// Il ramo Darwin deve nascere prima che `mountTitlebar` legga la piattaforma:
// la query prepara il browser del banco, mai la shell di produzione.
if (params.get("platform") === "darwin") {
  Object.defineProperty(globalThis.navigator, "platform", { value: "MacIntel", configurable: true });
}

/// La luce da fotografare. Il ripiego è lo scuro, che è la luce in cui Fub è
/// sempre stato — la stessa scelta di `theme.ts`.
export const LIGHT: "dark" | "light" = params.get("light") === "light" ? "light" : "dark";

/// Il vault che si apre: nessuno con `?vault=vuoto`, che è la scena della
/// finestra senza vault — l'unica in cui metà delle superfici non esiste, e
/// l'unica che si fotografa per vedere cosa resta.
export const ROOT = params.get("vault") === "vuoto" ? null : "/Bench vault";
/// `?vault=nuovo`: la finestra parte senza vault e «Crea un vault nuovo…»
/// apre una cartella vuota, coi componenti come li trova un vault appena
/// creato (`partenze.nuovo`) — la scena che chiede il profilo.
export const NEW_VAULT = params.get("vault") === "nuovo";
/// Lo stato da cui parte la pagina «Componenti»: un nome delle `partenze`
/// dello scenario (`solo-note`, `tutto`). Senza, «Studio».
export const COMPONENTS_START = params.get("componenti");

// `theme.ts` legge questa chiave prima di chiedere qualunque cosa al canale
// dati. Scriverla qui — cioè all'`import` di questo module, che Vite mette
// prima di `main.ts` perché `main.ts` lo importa — è ciò che evita il mezzo
// fotogramma nella luce sbagliata.
try {
  globalThis.window.localStorage.setItem("fub.appearance.theme", LIGHT);
} catch {
  // Un motore senza storage non è un motivo per non fotografare: l'altra metà
  // (l'impostazione servita qui sotto) arriva comunque.
}
