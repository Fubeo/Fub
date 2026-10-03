// La pagina d'anteprima del lavoro sull'editor di FubDraw.
//
// Monta su un foglio vero il codice dei pacchetti man mano che arriva: la
// pipeline della penna e il pennello pf1 (FD-203), la camera condivisa
// (FD-101), la scena e il motore delle operazioni (FD-201, FD-202). Il
// disegno è un file .svg tenuto da un `SceneEngine`: ogni tratto è
// un'operazione `add`, annulla e ripeti sono l'undo del motore, e il pannello
// del file mostra il testo che si salverebbe, con le righe appena cambiate.
//
// Ciò che ancora non c'è — il painter di FD-204, gli strumenti di FD-205, la
// superficie registrata nella shell di FD-206b — qui è una cucitura
// provvisoria, scritta per sparire: un `<g>` coi `<path>` letti dal file e un
// canvas per il tratto in corso.
//
// Come il catalogo del banco, qui non gira `main.ts`: i quattro strati del
// tema si montano con lo stesso caricatore della shell, e la carta è bianca in
// entrambi i temi (DEC-13).

import "../src/theme/structure.css";
import darkSheet from "../src/theme/serie/sheet-dark.css?raw";
import lightSheet from "../src/theme/serie/sheet-light.css?raw";
import skin from "../src/theme/serie/skin.css?raw";
import fonts from "../src/theme/serie/fonts.css?raw";
import { mount } from "../src/theme/loader";
import { openLifetime } from "../src/ui/lifetime";
import type { TextOperation } from "../src/editors/core/text-operation";
import {
  attachPenInput,
  type CancelReason,
  type FinishedStroke,
  type InkPointerType,
} from "../src/editors/spatial/pen/pen-input";
import { PF1_DEFAULTS, brushForInput, formatBrush, parseBrush, type Pf1Brush } from "../src/editors/spatial/ink/brush";
import { decodeInk, encodeInk, inkFromQuantized, inkToQuantized } from "../src/editors/spatial/ink/codec";
import { pf1, pf1Outline, type OutlinePoint } from "../src/editors/spatial/ink/pf1";
import {
  INK_MAX_SAMPLES,
  quantizeInk,
  type InkSample,
  type QuantizedInk,
  type QuantizedSample,
} from "../src/editors/spatial/ink/sample";
import type { ElementItem } from "../src/editors/spatial/scene/classify";
import { SceneEngine, type Applied, type Outcome, type Undo } from "../src/editors/spatial/scene/engine";
import { createId } from "../src/editors/spatial/scene/ids";
import type { AddOp, Op } from "../src/editors/spatial/scene/ops";
import { FUB_NS, SUPPORTED_VERSION, SVG_NS } from "../src/editors/spatial/scene/read";
import { fit, screenToWorld, zoomAtPoint, type Camera, type Point, type ScaleLimits } from "../src/spatial/camera";
import { ORDINE_STATI, PACCHETTI, STATI } from "./stato";

// ---------------------------------------------------------------------------
// Costanti del prodotto

/// La tavolozza dell'Essenziale (DEC-13), con i nomi.
const COLORI = [
  { nome: "Nero", valore: "#000000" },
  { nome: "Blu", valore: "#0072b2" },
  { nome: "Vermiglio", valore: "#d55e00" },
  { nome: "Verde", valore: "#009e73" },
  { nome: "Porpora", valore: "#cc79a7" },
  { nome: "Arancione", valore: "#e69f00" },
  { nome: "Azzurro", valore: "#56b4e9" },
  { nome: "Giallo", valore: "#f0e442" },
] as const;

/// Gli spessori di DEC-13, in unità della scena.
const SPESSORI = [
  { nome: "Sottile", valore: 2 },
  { nome: "Medio", valore: 4 },
  { nome: "Spesso", valore: 8 },
] as const;

/// I limiti della camera della superficie (FD-205).
const LIMITI: ScaleLimits = { min: 0.1, max: 32 };

/// Il disegno della pagina: il nome del file e la pagina di un disegno nuovo,
/// come li scrive `serialize` del provider svg (§2).
const NOME_FILE = "Prova.svg";
const TITOLO = "Prova";
const PAGINA = { w: 1600, h: 1000 };
const PRIMO_LIVELLO = "Livello 1";

/// Il passo con cui la pagina si allarga quando un tratto ne esce (§2).
const PASSO_PAGINA = 256;

/// Oltre questa lunghezza un valore del pannello del file si accorcia, se non
/// si chiedono i valori interi.
const VALORE_CORTO = 56;

const DISPOSITIVI: Readonly<Record<InkPointerType, string>> = { pen: "Penna", mouse: "Mouse", touch: "Dito" };

const MOTIVI: Readonly<Record<CancelReason, string>> = {
  pointercancel: "il sistema ha interrotto il puntatore",
  lostcapture: "il puntatore è sfuggito alla superficie",
  blur: "la finestra ha perso il fuoco",
  hidden: "la pagina è stata nascosta",
  palm: "era il palmo, è arrivata la penna",
  gesture: "è diventato un gesto a due dita",
  api: "annullato",
  destroy: "la superficie è stata smontata",
};

const CHIAVE_LUCE = "fubdraw-anteprima:luce";
const CHIAVE_DISEGNO = "fubdraw-anteprima:disegno";
const CHIAVE_INTERI = "fubdraw-anteprima:valori-interi";

// ---------------------------------------------------------------------------
// Utilità

/// Il localStorage può mancare o lanciare (finestra privata, dati bloccati):
/// la pagina funziona lo stesso, e dimentica.
function leggi(chiave: string): string | null {
  try {
    return window.localStorage.getItem(chiave);
  } catch {
    return null;
  }
}

function scrivi(chiave: string, valore: string | null): void {
  try {
    if (valore === null) window.localStorage.removeItem(chiave);
    else window.localStorage.setItem(chiave, valore);
  } catch {
    // Pieno o bloccato: il disegno resta finché la pagina è aperta.
  }
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, classe?: string, testo?: string): HTMLElementTagNameMap[K] {
  const n = document.createElement(tag);
  if (classe) n.className = classe;
  if (testo !== undefined) n.textContent = testo;
  return n;
}

function byId<T extends HTMLElement>(id: string): T {
  const n = document.getElementById(id);
  if (!n) throw new Error(`#${id} manca nella pagina`);
  return n as T;
}

const numeri = new Intl.NumberFormat("it-IT");

function messaggio(errore: unknown): string {
  return errore instanceof Error ? errore.message : String(errore);
}

// ---------------------------------------------------------------------------
// Tema

type Luce = "dark" | "light";

const vita = openLifetime();
vita.listen(window, "pagehide", () => vita.close(), { once: true });

const sistemaChiaro = window.matchMedia("(prefers-color-scheme: light)");
const salvata = leggi(CHIAVE_LUCE);
let luceScelta: Luce | null = salvata === "light" || salvata === "dark" ? salvata : null;
const bottoneLuce = byId<HTMLButtonElement>("luce");

function applicaLuce(): void {
  const luce: Luce = luceScelta ?? (sistemaChiaro.matches ? "light" : "dark");
  mount(luce === "light" ? lightSheet : darkSheet, "foglio");
  document.documentElement.dataset.theme = luce;
  bottoneLuce.textContent = luce === "light" ? "Tema scuro" : "Tema chiaro";
}

mount(fonts, "caratteri");
mount(skin, "pelle");
applicaLuce();
vita.listen(sistemaChiaro, "change", () => applicaLuce());
vita.listen(bottoneLuce, "click", () => {
  luceScelta = document.documentElement.dataset.theme === "light" ? "dark" : "light";
  scrivi(CHIAVE_LUCE, luceScelta);
  applicaLuce();
});

// ---------------------------------------------------------------------------
// Il documento: un file .svg nel motore delle operazioni

/// Un disegno nuovo, byte per byte come quello di `serialize` (§2, §3): la
/// radice, il titolo, la carta e «Livello 1» vuoto in forma aperta.
function documentoNuovo(): string {
  const livello = createId("layer", () => false);
  return [
    `<svg xmlns="${SVG_NS}" xmlns:fub="${FUB_NS}" fub:version="${SUPPORTED_VERSION}" ` +
      `viewBox="0 0 ${PAGINA.w} ${PAGINA.h}" width="${PAGINA.w}" height="${PAGINA.h}">`,
    `  <title>${TITOLO}</title>`,
    `  <rect id="fub-paper" fub:role="paper" x="0" y="0" width="${PAGINA.w}" height="${PAGINA.h}" fill="#ffffff"/>`,
    `  <g id="${livello}" fub:layer="${PRIMO_LIVELLO}">`,
    "  </g>",
    "</svg>",
    "",
  ].join("\n");
}

/// Ciò che di un tratto il file non conserva: si sa solo di quelli disegnati
/// in questo browser.
interface Origine {
  readonly dispositivo: InkPointerType;
  readonly diviso: boolean;
}

/// Un tratto com'è scritto nel file: gli attributi letti dal suo testo e il
/// `<path>` che il foglio disegna.
interface Tratto {
  readonly id: string;
  readonly colore: string;
  readonly brush: Pf1Brush;
  readonly ink: QuantizedInk;
  readonly d: string;
  readonly at: string | null;
  readonly elemento: SVGPathElement;
}

/// Un passo della cronologia: l'undo del motore e il nome per gli annunci.
interface Azione {
  readonly nome: string;
  readonly undo: Undo;
}

/// Il riquadro di un tratto, in unità della scena.
interface Riquadro {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

let motore: SceneEngine = SceneEngine.open(documentoNuovo());
/// I tratti della scena, in ordine di documento.
let tratti: Tratto[] = [];
/// Ogni tratto letto dal file in questa pagina, per id: un tratto tolto e
/// rimesso dall'undo non si rilegge.
const letti = new Map<string, Tratto>();
const origini = new Map<string, Origine>();
const daAnnullare: Azione[] = [];
const daRipetere: Azione[] = [];
/// L'ultima modifica del testo e il suo nome, per il pannello del file.
let ultima: { readonly nome: string; readonly operazione: TextOperation } | null = null;

/// Le voci della scena che sono tratti a penna.
function vociTratto(): ElementItem[] {
  return motore.scene().filter((v): v is ElementItem => v.kind === "element" && v.stroke !== undefined && v.id !== null);
}

/// L'id del primo livello, dove vanno i tratti nuovi.
function livelloDi(m: SceneEngine): string | null {
  for (const v of m.scene()) if (v.kind === "element" && v.layer !== undefined && v.id !== null) return v.id;
  return null;
}

/// Il `viewBox` della radice, letto dal suo tag d'apertura.
function viewBox(): readonly [number, number, number, number] {
  const radice = motore.scene().find((v) => v.kind === "root");
  const tag = radice ? motore.text.slice(radice.tags.open.utf16[0], radice.tags.open.utf16[1]) : "";
  const valori = /\sviewBox\s*=\s*"([^"]*)"/.exec(tag)?.[1]?.trim().split(/[\s,]+/).map(Number) ?? [];
  if (valori.length !== 4 || valori.some((n) => !Number.isFinite(n))) return [0, 0, PAGINA.w, PAGINA.h];
  return valori as unknown as readonly [number, number, number, number];
}

/// La pagina che contiene anche `r`: ogni lato si allarga a passi di 256
/// unità finché il riquadro non ci sta; `null` se ci sta già. La pagina non si
/// restringe mai da sola (§2).
function paginaPer(r: Riquadro): string | null {
  const [x, y, w, h] = viewBox();
  const passi = (fuori: number): number => (fuori > 0 ? Math.ceil(fuori / PASSO_PAGINA) * PASSO_PAGINA : 0);
  const sinistra = passi(x - r.minX);
  const sopra = passi(y - r.minY);
  const destra = passi(r.maxX - (x + w));
  const sotto = passi(r.maxY - (y + h));
  if (sinistra + sopra + destra + sotto === 0) return null;
  const n = (v: number): string => String(Number(v.toFixed(3)));
  return `${n(x - sinistra)} ${n(y - sopra)} ${n(w + sinistra + destra)} ${n(h + sopra + sotto)}`;
}

/// Il riquadro del contorno di un tratto: le curve passano per i punti medi
/// fra i vertici, quindi stanno dentro il riquadro dei vertici.
function riquadroDi(ink: QuantizedInk, brush: Pf1Brush): Riquadro | null {
  const contorno = pf1Outline(ink, brush);
  if (contorno.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of contorno) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  return { minX, minY, maxX, maxY };
}

function unisci(a: Riquadro | null, b: Riquadro | null): Riquadro | null {
  if (!a || !b) return a ?? b;
  return { minX: Math.min(a.minX, b.minX), minY: Math.min(a.minY, b.minY), maxX: Math.max(a.maxX, b.maxX), maxY: Math.max(a.maxY, b.maxY) };
}

/// L'operazione che aggiunge un tratto in cima al livello. Il `d` non si
/// manda: il motore lo calcola da `fub:ink` e `fub:brush` con `pf1`.
function aggiuntaTratto(livello: string, id: string, colore: string, brush: Pf1Brush, ink: QuantizedInk, at: string | null): AddOp {
  const attrs: Record<string, string> = { id, "fub:tool": "pen" };
  if (at !== null) attrs["fub:at"] = at;
  attrs["fub:brush"] = formatBrush(brush);
  attrs.fill = colore;
  attrs["fub:ink"] = encodeInk(inkFromQuantized(ink));
  return { op: "add", parent: livello, pos: { last: true }, elem: { tag: "path", attrs } };
}

function idNuovo(): string {
  const presi = new Set<string>();
  for (const v of motore.scene()) if (v.kind === "element" && v.id !== null) presi.add(v.id);
  return createId("object", (id) => presi.has(id));
}

const lettore = new DOMParser();

/// Rilegge un tratto dal testo del file, come farà chi lo apre: il colore, il
/// pennello, l'inchiostro e il `d` che il motore ha scritto.
function leggiTratto(voce: ElementItem): Tratto | null {
  const sorgente = motore.text.slice(voce.utf16[0], voce.utf16[1]);
  const doc = lettore.parseFromString(`<svg xmlns="${SVG_NS}" xmlns:fub="${FUB_NS}">${sorgente}</svg>`, "image/svg+xml");
  const path = doc.documentElement.firstElementChild;
  if (!path || path.namespaceURI !== SVG_NS || path.localName !== "path") return null;
  try {
    const brush = parseBrush(path.getAttributeNS(FUB_NS, "brush") ?? "");
    const ink = inkToQuantized(decodeInk(path.getAttributeNS(FUB_NS, "ink") ?? ""));
    const colore = path.getAttribute("fill") ?? "#000000";
    const d = path.getAttribute("d") ?? pf1(ink, brush);
    const elemento = document.createElementNS(SVG_NS, "path");
    elemento.setAttribute("d", d);
    elemento.setAttribute("fill", colore);
    return { id: voce.id!, colore, brush, ink, d, at: path.getAttributeNS(FUB_NS, "at"), elemento };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Il foglio

const foglio = byId<HTMLDivElement>("foglio");
const disegno = foglio.querySelector("svg")!;
const mondo = disegno.querySelector("g")!;
const sovrapposizione = byId<HTMLCanvasElement>("in-corso");
const pennello2d = sovrapposizione.getContext("2d")!;
const annunci = byId<HTMLElement>("annunci");

/// Il bordo della pagina del file, tratteggiato: la carta è bianca come il
/// foglio intorno, e senza bordo non si vedrebbe allargarsi.
const bordoPagina = document.createElementNS(SVG_NS, "rect");
bordoPagina.setAttribute("class", "bordo-pagina");
bordoPagina.setAttribute("fill", "none");
bordoPagina.setAttribute("stroke", "#8a8a8a");
bordoPagina.setAttribute("stroke-dasharray", "6 4");
bordoPagina.setAttribute("vector-effect", "non-scaling-stroke");

function annuncia(testo: string): void {
  // Lo stesso testo due volte di fila si annuncia comunque: si svuota prima.
  annunci.textContent = "";
  window.requestAnimationFrame(() => (annunci.textContent = testo));
}

let colore: string = COLORI[0].valore;
let spessore: number = SPESSORI[1].valore;

/// Il pennello di un tratto nuovo: i valori di `getStroke` con lo spessore
/// scelto, come nell'esempio del formato (§5). `sim` lo decide il
/// dispositivo, con `brushForInput`.
function pennelloBase(): Pf1Brush {
  return { ...PF1_DEFAULTS, size: spessore, sim: false };
}

/// Porta il foglio alla scena del motore: i tratti nell'ordine del file, letti
/// dal testo la prima volta che compaiono, e il bordo della pagina.
function allinea(): void {
  const ora: Tratto[] = [];
  for (const voce of vociTratto()) {
    let t = letti.get(voce.id!);
    if (!t) {
      const nuovo = leggiTratto(voce);
      if (!nuovo) continue;
      letti.set(nuovo.id, nuovo);
      t = nuovo;
    }
    ora.push(t);
  }
  tratti = ora;
  const [x, y, w, h] = viewBox();
  bordoPagina.setAttribute("x", String(x));
  bordoPagina.setAttribute("y", String(y));
  bordoPagina.setAttribute("width", String(w));
  bordoPagina.setAttribute("height", String(h));
  mondo.replaceChildren(bordoPagina, ...tratti.map((t) => t.elemento));
}

// --- Camera -----------------------------------------------------------------

let camera: Camera = { scale: 1, tx: 0, ty: 0 };
const livelloZoom = byId<HTMLButtonElement>("zoom-livello");

function impostaCamera(c: Camera): void {
  camera = c;
  mondo.setAttribute("transform", `matrix(${c.scale} 0 0 ${c.scale} ${c.tx} ${c.ty})`);
  livelloZoom.textContent = `${Math.round(c.scale * 100)}%`;
  disegnaInCorso();
}

function puntoLocale(clientX: number, clientY: number): Point {
  const r = foglio.getBoundingClientRect();
  return { x: clientX - r.left, y: clientY - r.top };
}

function centroFoglio(): Point {
  return { x: foglio.clientWidth / 2, y: foglio.clientHeight / 2 };
}

/// Adatta alla finestra. Un disegno piccolo non si ingrandisce oltre il 100%:
/// tre scarabocchi a 3200% non sono un disegno che si riconosce.
function adatta(): void {
  if (tratti.length === 0) {
    impostaCamera({ scale: 1, tx: 0, ty: 0 });
    return;
  }
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const t of tratti) {
    const b = t.elemento.getBBox();
    minX = Math.min(minX, b.x);
    minY = Math.min(minY, b.y);
    maxX = Math.max(maxX, b.x + b.width);
    maxY = Math.max(maxY, b.y + b.height);
  }
  const v = { w: foglio.clientWidth, h: foglio.clientHeight };
  impostaCamera(fit({ minX, minY, maxX, maxY }, v, 0.08, 0, { min: LIMITI.min, max: 1 }));
}

// --- Tratto in corso (cucitura provvisoria di FD-204) -----------------------

interface InCorso {
  readonly id: number;
  readonly colore: string;
  readonly brush: Pf1Brush;
  readonly campioni: InkSample[];
  predetti: readonly InkSample[];
}

let inCorso: InCorso | null = null;
let densita = 1;

function dimensiona(): void {
  densita = window.devicePixelRatio || 1;
  sovrapposizione.width = Math.max(1, Math.round(foglio.clientWidth * densita));
  sovrapposizione.height = Math.max(1, Math.round(foglio.clientHeight * densita));
  disegnaInCorso();
}

/// Il contorno chiuso con le stesse curve di `outlinePath`: dal punto medio
/// fra l'ultimo e il primo vertice, una quadratica per vertice fino al punto
/// medio successivo. Così il tratto in corso e quello concluso hanno la
/// stessa forma, e alla fine non «scatta».
function riempiContorno(ctx: CanvasRenderingContext2D, punti: readonly OutlinePoint[]): void {
  const n = punti.length;
  if (n < 3) return;
  const ultimo = punti[n - 1]!;
  const primo = punti[0]!;
  ctx.beginPath();
  ctx.moveTo((ultimo[0] + primo[0]) / 2, (ultimo[1] + primo[1]) / 2);
  for (let i = 0; i < n; i++) {
    const p = punti[i]!;
    const q = punti[i + 1 === n ? 0 : i + 1]!;
    ctx.quadraticCurveTo(p[0], p[1], (p[0] + q[0]) / 2, (p[1] + q[1]) / 2);
  }
  ctx.closePath();
  ctx.fill();
}

/// Ridisegna il tratto in corso, con la predizione in coda. Si chiama dentro
/// il gestore dell'evento, mai al fotogramma dopo (FD-203).
function disegnaInCorso(): void {
  pennello2d.setTransform(1, 0, 0, 1, 0, 0);
  pennello2d.clearRect(0, 0, sovrapposizione.width, sovrapposizione.height);
  const t = inCorso;
  if (!t || t.campioni.length === 0) return;
  const campioni = t.campioni.length + t.predetti.length <= INK_MAX_SAMPLES
    ? [...t.campioni, ...t.predetti]
    : t.campioni;
  let contorno: OutlinePoint[];
  try {
    contorno = pf1Outline(quantizeInk(campioni), t.brush, { last: false });
  } catch {
    return;
  }
  const s = camera.scale * densita;
  pennello2d.setTransform(s, 0, 0, s, camera.tx * densita, camera.ty * densita);
  pennello2d.fillStyle = t.colore;
  riempiContorno(pennello2d, contorno);
}

// --- Operazioni, annulla e ripeti ---------------------------------------------

/// Applica `op` al documento. Un rifiuto si annuncia e non lascia traccia: il
/// motore applica tutto o niente.
function esegui(nome: string, op: Op): Applied | null {
  const esito = motore.apply(op);
  if (esito.outcome === "rejected") {
    annuncia(`${nome}: il motore ha rifiutato l'operazione (${esito.reason}, ${esito.detail}).`);
    return null;
  }
  daAnnullare.push({ nome, undo: esito.undo });
  daRipetere.length = 0;
  ultima = { nome, operazione: esito.operation };
  cambiato();
  return esito;
}

/// Annulla o ripete il passo in cima a `da`, e mette in `a` quello che lo
/// disfa. Se il motore lo rifiuta la cronologia non vale più: si svuota.
function torna(da: Azione[], a: Azione[], verbo: string): void {
  const azione = da.pop();
  if (!azione) return;
  const esito: Outcome = motore.undo(azione.undo);
  if (esito.outcome === "rejected") {
    daAnnullare.length = 0;
    daRipetere.length = 0;
    cambiato();
    annuncia(`${verbo} non riuscito: ${esito.reason}. La cronologia è stata azzerata.`);
    return;
  }
  a.push({ nome: azione.nome, undo: esito.undo });
  ultima = { nome: `${verbo} «${azione.nome}»`, operazione: esito.operation };
  cambiato();
  annuncia(`${verbo} «${azione.nome}».`);
}

function annulla(): void {
  torna(daAnnullare, daRipetere, "Annulla");
}

function ripeti(): void {
  torna(daRipetere, daAnnullare, "Ripeti");
}

/// Toglie tutti i tratti con un `batch` di `remove`: una sola voce della
/// cronologia, e la pagina resta com'è.
function svuota(): void {
  if (tratti.length === 0) return;
  const ops: Op[] = tratti.map((t) => ({ op: "remove", target: t.id }));
  if (esegui("Svuota", { op: "batch", label: "Svuota", ops })) annuncia("Foglio svuotato. Ctrl+Z lo ripristina.");
}

function concludi(s: FinishedStroke, corrente: InCorso): void {
  const livello = livelloDi(motore);
  if (livello === null) {
    annuncia("Tratto scartato: il disegno non ha un livello.");
    return;
  }
  let ink: QuantizedInk;
  let riquadro: Riquadro | null;
  try {
    ink = quantizeInk(s.samples);
    riquadro = riquadroDi(ink, corrente.brush);
  } catch (errore) {
    annuncia(`Tratto scartato: ${messaggio(errore)}`);
    return;
  }
  if (!riquadro) return;
  const id = idNuovo();
  const at = new Date(performance.timeOrigin + s.timeStamp).toISOString();
  const ops: Op[] = [aggiuntaTratto(livello, id, corrente.colore, corrente.brush, ink, at)];
  const pagina = paginaPer(riquadro);
  if (pagina !== null) ops.push({ op: "page", viewBox: pagina });
  origini.set(id, { dispositivo: s.pointerType, diviso: s.split });
  esegui(pagina === null ? "Tratto" : "Tratto e pagina", ops.length === 1 ? ops[0]! : { op: "batch", label: "Tratto", ops });
}

// --- La penna -----------------------------------------------------------------

const penna = attachPenInput(
  foglio,
  {
    toScene: (clientX, clientY) => screenToWorld(camera, puntoLocale(clientX, clientY)),
    onStart(s) {
      inCorso = {
        id: s.id,
        colore,
        brush: brushForInput(pennelloBase(), s.pressure),
        campioni: [],
        predetti: [],
      };
    },
    onSamples(id, campioni) {
      if (inCorso?.id !== id) return;
      for (const c of campioni) inCorso.campioni.push(c);
      disegnaInCorso();
    },
    onPredicted(id, campioni) {
      if (inCorso?.id !== id) return;
      inCorso.predetti = campioni;
      disegnaInCorso();
    },
    onEnd(s) {
      const corrente = inCorso;
      inCorso = null;
      disegnaInCorso();
      if (corrente?.id === s.id) concludi(s, corrente);
    },
    onCancel(id, motivo) {
      if (inCorso?.id !== id) return;
      inCorso = null;
      disegnaInCorso();
      annuncia(`Tratto annullato: ${MOTIVI[motivo]}.`);
    },
  },
  vita,
);

// --- Navigazione: tasto centrale, dita, rotella --------------------------------

/// I puntatori che muovono la vista, con l'ultima posizione locale. Il ruolo
/// lo decide la pipeline (`roles.ts`), che ascolta in cattura: qui, in bolla,
/// è già aggiornato. Un dito che disegnava diventa navigazione quando se ne
/// appoggia un secondo, quindi il ruolo si rilegge a ogni evento.
const navigazione = new Map<number, Point>();
let gesto: { chiave: string; centro: Point; distanza: number } | null = null;

function misuraGesto(): typeof gesto {
  if (navigazione.size === 0) return null;
  const punti = [...navigazione.values()];
  const centro = {
    x: punti.reduce((s, p) => s + p.x, 0) / punti.length,
    y: punti.reduce((s, p) => s + p.y, 0) / punti.length,
  };
  const distanza = punti.length >= 2 ? Math.hypot(punti[0]!.x - punti[1]!.x, punti[0]!.y - punti[1]!.y) : 0;
  return { chiave: [...navigazione.keys()].sort((a, b) => a - b).join(","), centro, distanza };
}

function seguiGesto(): void {
  const ora = misuraGesto();
  if (ora && gesto && ora.chiave === gesto.chiave) {
    let c = camera;
    if (ora.distanza > 0 && gesto.distanza > 0) c = zoomAtPoint(c, ora.distanza / gesto.distanza, gesto.centro, LIMITI);
    impostaCamera({ ...c, tx: c.tx + ora.centro.x - gesto.centro.x, ty: c.ty + ora.centro.y - gesto.centro.y });
  }
  gesto = ora;
}

function puntatore(e: PointerEvent): void {
  if (penna.roleOf(e.pointerId) === "navigate") {
    if (!navigazione.has(e.pointerId)) {
      try {
        foglio.setPointerCapture(e.pointerId);
      } catch {
        // Non catturabile: il gesto prosegue finché il puntatore resta sopra.
      }
    }
    navigazione.set(e.pointerId, puntoLocale(e.clientX, e.clientY));
    // Il tasto centrale del mouse, senza questo, apre lo scorrimento automatico.
    if (e.type === "pointerdown") e.preventDefault();
  } else {
    navigazione.delete(e.pointerId);
  }
  seguiGesto();
}

function fine(e: PointerEvent): void {
  if (!navigazione.delete(e.pointerId)) return;
  seguiGesto();
}

vita.listen(foglio, "pointerdown", puntatore);
vita.listen(foglio, "pointermove", puntatore);
vita.listen(foglio, "pointerup", fine);
vita.listen(foglio, "pointercancel", fine);
vita.listen(foglio, "lostpointercapture", fine);

vita.listen(
  foglio,
  "wheel",
  (e) => {
    e.preventDefault();
    const unita = e.deltaMode === WheelEvent.DOM_DELTA_LINE ? 16 : e.deltaMode === WheelEvent.DOM_DELTA_PAGE ? foglio.clientHeight : 1;
    const dx = e.deltaX * unita;
    const dy = e.deltaY * unita;
    if (e.ctrlKey || e.metaKey) {
      // Il pizzico del trackpad arriva così, a passi piccoli; la rotella del
      // mouse a passi da 100: il limite tiene lo scatto entro il 22%.
      const passo = Math.max(-50, Math.min(50, dy));
      impostaCamera(zoomAtPoint(camera, Math.exp(-passo * 0.005), puntoLocale(e.clientX, e.clientY), LIMITI));
    } else if (e.shiftKey && dx === 0) {
      impostaCamera({ ...camera, tx: camera.tx - dy });
    } else {
      impostaCamera({ ...camera, tx: camera.tx - dx, ty: camera.ty - dy });
    }
  },
  { passive: false },
);

function zoomAlCentro(fattore: number): void {
  impostaCamera(zoomAtPoint(camera, fattore, centroFoglio(), LIMITI));
}

// ---------------------------------------------------------------------------
// Barra degli strumenti

const barraColori = byId<HTMLElement>("colori");
const barraSpessori = byId<HTMLElement>("spessori");
const bottoniColore: HTMLButtonElement[] = [];
const bottoniSpessore: HTMLButtonElement[] = [];

for (const c of COLORI) {
  const b = el("button", "scelta colore");
  b.type = "button";
  b.dataset.valore = c.valore;
  const campione = el("span", "campione");
  campione.style.background = c.valore;
  b.append(campione, el("span", "nome", c.nome));
  b.addEventListener("click", () => {
    colore = c.valore;
    segnaScelte();
  });
  bottoniColore.push(b);
  barraColori.append(b);
}

for (const s of SPESSORI) {
  const b = el("button", "scelta spessore");
  b.type = "button";
  b.dataset.valore = String(s.valore);
  // Il punto è grande il doppio dello spessore: 2 unità a schermo sarebbero
  // un puntino che non si distingue dal 4.
  const punto = el("span", "punto");
  punto.style.width = punto.style.height = `${s.valore * 2}px`;
  const riquadro = el("span", "punto-riquadro");
  riquadro.append(punto);
  b.append(riquadro, el("span", "nome", s.nome));
  b.addEventListener("click", () => {
    spessore = s.valore;
    segnaScelte();
  });
  bottoniSpessore.push(b);
  barraSpessori.append(b);
}

function segnaScelte(): void {
  for (const b of bottoniColore) b.setAttribute("aria-pressed", String(b.dataset.valore === colore));
  for (const b of bottoniSpessore) b.setAttribute("aria-pressed", String(Number(b.dataset.valore) === spessore));
  barraSpessori.style.setProperty("--colore-scelto", colore);
}

const bottoneAnnulla = byId<HTMLButtonElement>("annulla");
const bottoneRipeti = byId<HTMLButtonElement>("ripeti");
const bottoneSvuota = byId<HTMLButtonElement>("svuota");
vita.listen(bottoneAnnulla, "click", annulla);
vita.listen(bottoneRipeti, "click", ripeti);
vita.listen(bottoneSvuota, "click", svuota);
vita.listen(byId("zoom-meno"), "click", () => zoomAlCentro(1 / 1.25));
vita.listen(byId("zoom-piu"), "click", () => zoomAlCentro(1.25));
vita.listen(livelloZoom, "click", () => zoomAlCentro(1 / camera.scale));
vita.listen(byId("adatta"), "click", adatta);

vita.listen(window, "keydown", (e) => {
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
  const mod = e.ctrlKey || e.metaKey;
  const tasto = e.key.toLowerCase();
  if (mod && !e.altKey && tasto === "z") {
    if (e.shiftKey) ripeti();
    else annulla();
  } else if (mod && !e.altKey && !e.shiftKey && tasto === "y") {
    ripeti();
  } else if (!mod && !e.altKey && (e.key === "+" || e.key === "=")) {
    zoomAlCentro(1.25);
  } else if (!mod && !e.altKey && e.key === "-") {
    zoomAlCentro(1 / 1.25);
  } else if (!mod && !e.altKey && e.key === "0") {
    zoomAlCentro(1 / camera.scale);
  } else if (!mod && !e.altKey && e.shiftKey && e.code === "Digit1") {
    adatta();
  } else {
    return;
  }
  e.preventDefault();
});

// ---------------------------------------------------------------------------
// Il pannello del file

const fileMisure = byId<HTMLElement>("file-misure");
const fileModifica = byId<HTMLElement>("file-modifica");
const fileTesto = byId<HTMLElement>("file-testo");
const fileInteri = byId<HTMLInputElement>("file-interi");
let indirizzoFile: string | null = null;

fileInteri.checked = leggi(CHIAVE_INTERI) === "1";
vita.listen(fileInteri, "change", () => {
  scrivi(CHIAVE_INTERI, fileInteri.checked ? "1" : null);
  mostraFile(false);
});

/// Un URL blob del testo corrente; il precedente si revoca.
function urlDelFile(): string {
  if (indirizzoFile !== null) URL.revokeObjectURL(indirizzoFile);
  indirizzoFile = URL.createObjectURL(new Blob([motore.text], { type: "image/svg+xml" }));
  return indirizzoFile;
}

vita.add(() => {
  if (indirizzoFile !== null) URL.revokeObjectURL(indirizzoFile);
});
vita.listen(byId("file-scarica"), "click", () => {
  const a = el("a");
  a.href = urlDelFile();
  a.download = NOME_FILE;
  a.click();
});
vita.listen(byId("file-apri"), "click", () => {
  window.open(urlDelFile(), "_blank", "noopener");
});

/// Le righe del testo a LF toccate da ciò che `op` ha inserito, contate da 0.
/// Una riga solo tolta non c'è più: la conta il riassunto.
function righeToccate(op: TextOperation, testo: string): Set<number> {
  const inizi = [0];
  for (let i = testo.indexOf("\n"); i >= 0; i = testo.indexOf("\n", i + 1)) inizi.push(i + 1);
  const rigaDi = (offset: number): number => {
    let basso = 0;
    let alto = inizi.length - 1;
    while (basso < alto) {
      const mezzo = (basso + alto + 1) >> 1;
      if (inizi[mezzo]! <= offset) basso = mezzo;
      else alto = mezzo - 1;
    }
    return basso;
  };
  const righe = new Set<number>();
  let scarto = 0;
  for (const e of op.edits) {
    const da = e.from + scarto;
    scarto += e.inserted.length - (e.to - e.from);
    // Un `add` inserisce «a capo e riga»: l'a capo in testa appartiene alla
    // riga di prima, che non cambia.
    const testa = e.inserted.length - e.inserted.replace(/^\n+/, "").length;
    const coda = e.inserted.length - e.inserted.replace(/\n+$/, "").length;
    if (testa + coda >= e.inserted.length) continue;
    const prima = rigaDi(da + testa);
    const ultimaRiga = rigaDi(da + e.inserted.length - coda - 1);
    for (let r = prima; r <= ultimaRiga; r++) righe.add(r);
  }
  return righe;
}

function riassunto(op: TextOperation): string {
  let inseriti = 0;
  let tolti = 0;
  let righePiu = 0;
  let righeMeno = 0;
  for (const e of op.edits) {
    inseriti += e.inserted.length;
    tolti += e.deleted.length;
    righePiu += e.inserted.split("\n").length - 1;
    righeMeno += e.deleted.split("\n").length - 1;
  }
  const n = op.edits.length;
  const parti = [`${n} ${n === 1 ? "modifica" : "modifiche"} al testo`, `+${numeri.format(inseriti)} −${numeri.format(tolti)} caratteri`];
  const righe = righePiu - righeMeno;
  if (righe !== 0) parti.push(`${righe > 0 ? "+" : "−"}${Math.abs(righe)} ${Math.abs(righe) === 1 ? "riga" : "righe"}`);
  return parti.join(", ");
}

/// Una riga del file, coi tag, i nomi e i valori colorati. I valori lunghi si
/// accorciano, se non si chiedono interi.
function rigaColorata(riga: string, interi: boolean): DocumentFragment {
  const pezzi = document.createDocumentFragment();
  const segni = /(<\/?|\/?>)|([A-Za-z_][\w:.-]*)(=)("[^"]*"|'[^']*')/g;
  let da = 0;
  let nomeTag = false;
  for (let m = segni.exec(riga); m !== null; m = segni.exec(riga)) {
    if (m.index > da) {
      const prima = riga.slice(da, m.index);
      if (nomeTag) {
        const nome = /^[^\s/>]+/.exec(prima)?.[0] ?? "";
        pezzi.append(el("span", "x-tag", nome), prima.slice(nome.length));
      } else {
        pezzi.append(prima);
      }
    }
    nomeTag = m[1]?.startsWith("<") ?? false;
    if (m[1] !== undefined) {
      pezzi.append(el("span", "x-segno", m[1]));
    } else {
      const valore = m[4]!;
      pezzi.append(el("span", "x-nome", m[2]!), m[3]!);
      if (interi || valore.length <= VALORE_CORTO) {
        pezzi.append(el("span", "x-valore", valore));
      } else {
        pezzi.append(el("span", "x-valore", `${valore.slice(0, VALORE_CORTO - 8)}…${valore.slice(-1)}`));
        pezzi.append(el("span", "x-corto", ` ${numeri.format(valore.length - 2)} car.`));
      }
    }
    da = m.index + m[0].length;
  }
  if (da < riga.length) {
    const resto = riga.slice(da);
    if (nomeTag) {
      const nome = /^[^\s/>]+/.exec(resto)?.[0] ?? "";
      pezzi.append(el("span", "x-tag", nome), resto.slice(nome.length));
    } else {
      pezzi.append(resto);
    }
  }
  return pezzi;
}

/// Ridisegna il pannello: misure, ultima modifica e testo. Con `segui` la
/// prima riga toccata si porta in vista.
function mostraFile(segui: boolean): void {
  const testo = motore.normalized;
  const byte = new TextEncoder().encode(motore.text).length;
  const [x, y, w, h] = viewBox();
  const origine = x === 0 && y === 0 ? "" : ` da ${x}, ${y}`;
  const quanti = `${tratti.length} ${tratti.length === 1 ? "tratto" : "tratti"}`;
  fileMisure.textContent = `${numeri.format(byte)} byte · ${quanti} · pagina ${w} × ${h}${origine}`;
  fileModifica.textContent = ultima
    ? `${ultima.nome}: ${riassunto(ultima.operazione)}. Il resto del file non cambia.`
    : "Disegna un tratto: diventa un’operazione add del motore, e qui compare la riga che aggiunge.";

  const toccate = ultima ? righeToccate(ultima.operazione, testo) : new Set<number>();
  const righe = testo.endsWith("\n") ? testo.slice(0, -1).split("\n") : testo.split("\n");
  const lista = el("ol", "righe");
  let prima: HTMLElement | null = null;
  for (let i = 0; i < righe.length; i++) {
    const voce = el("li", toccate.has(i) ? "riga toccata" : "riga");
    voce.append(el("span", "numero", String(i + 1)));
    const corpo = el("span", "codice");
    corpo.append(rigaColorata(righe[i]!, fileInteri.checked));
    voce.append(corpo);
    if (toccate.has(i) && prima === null) prima = voce;
    lista.append(voce);
  }
  fileTesto.replaceChildren(lista);
  if (segui && prima !== null) {
    const sopra = prima.offsetTop;
    const sotto = sopra + prima.offsetHeight;
    if (sopra < fileTesto.scrollTop || sotto > fileTesto.scrollTop + fileTesto.clientHeight) {
      fileTesto.scrollTop = Math.max(0, sopra - fileTesto.clientHeight / 3);
    }
  }
}

// ---------------------------------------------------------------------------
// Ispettore dell'ultimo tratto

const ispettore = byId<HTMLElement>("ispettore");

function riga(lista: HTMLDListElement, nome: string, valore: string | Node): void {
  const dd = el("dd");
  dd.append(valore);
  lista.append(el("dt", undefined, nome), dd);
}

function codice(testo: string): HTMLElement {
  return el("code", undefined, testo);
}

function aggiornaIspettore(): void {
  ispettore.replaceChildren();
  const t = tratti[tratti.length - 1];
  if (!t) {
    ispettore.append(el("p", "vuoto", "Disegna qualcosa: qui compaiono i dati del tratto, letti dal file."));
    return;
  }
  const lista = el("dl");
  const campioni = t.ink.samples;
  const origine = origini.get(t.id);
  const pressione = campioni[0]?.p !== undefined;
  const inclinazione = campioni[0]?.a !== undefined;
  riga(lista, "id", codice(t.id));
  riga(lista, "Dispositivo", origine ? DISPOSITIVI[origine.dispositivo] : "non scritto nel file");
  riga(lista, "Campioni", `${campioni.length}${origine?.diviso ? ", diviso al limite" : ""}`);
  riga(lista, "Durata", `${campioni[campioni.length - 1]?.t ?? 0} ms`);
  riga(lista, "Pressione", pressione ? "dalla penna, 0…255" : "simulata dalla velocità (sim=1)");
  riga(lista, "Inclinazione", inclinazione ? "sì, altitudine e azimut" : "no");
  riga(lista, "fub:at", t.at === null ? "assente" : codice(t.at));
  riga(lista, "fub:brush", codice(formatBrush(t.brush)));
  riga(lista, "fub:ink", codice(`scala s${t.ink.scale}, ${campioni.length} campioni interi`));
  const d = el("details");
  d.append(el("summary", undefined, `${numeri.format(t.d.length)} caratteri, ricalcolati dal motore`), el("pre", undefined, t.d));
  riga(lista, "d", d);
  ispettore.append(lista);
}

// ---------------------------------------------------------------------------
// Salvataggio nel browser: il disegno sopravvive a un ricaricamento

/// Il file e ciò che il file non conserva dei tratti disegnati qui.
interface Salvato {
  readonly v: 2;
  readonly svg: string;
  readonly origini: Readonly<Record<string, Origine>>;
}

/// Il formato di prima del motore: i tratti uno per uno.
interface SalvatoV1 {
  readonly v: 1;
  readonly tratti: readonly {
    readonly colore: string;
    readonly brush: string;
    readonly dispositivo: InkPointerType;
    readonly inclinazione: boolean;
    readonly diviso: boolean;
    readonly scala: number;
    readonly campioni: readonly QuantizedSample[];
  }[];
}

function salva(): void {
  if (tratti.length === 0 && daAnnullare.length === 0) {
    scrivi(CHIAVE_DISEGNO, null);
    return;
  }
  const conservate: Record<string, Origine> = {};
  for (const t of tratti) {
    const o = origini.get(t.id);
    if (o) conservate[t.id] = o;
  }
  const dati: Salvato = { v: 2, svg: motore.text, origini: conservate };
  scrivi(CHIAVE_DISEGNO, JSON.stringify(dati));
}

function origineValida(o: unknown): o is Origine {
  if (o === null || typeof o !== "object") return false;
  const { dispositivo, diviso } = o as Record<string, unknown>;
  return typeof dispositivo === "string" && dispositivo in DISPOSITIVI && typeof diviso === "boolean";
}

/// Riapre il file salvato. Un file che il motore non apre come disegno
/// modificabile con un livello si scarta: la pagina riparte da un foglio
/// nuovo.
function riapri(dati: Partial<Salvato>): boolean {
  if (typeof dati.svg !== "string") return false;
  let m: SceneEngine;
  try {
    m = SceneEngine.open(dati.svg);
  } catch {
    return false;
  }
  if (m.status !== "fubdraw" || livelloDi(m) === null) return false;
  motore = m;
  for (const [id, o] of Object.entries(dati.origini ?? {})) if (origineValida(o)) origini.set(id, o);
  return true;
}

/// Porta nel file i tratti salvati col formato di prima: un `batch` di
/// `add`, fuori dalla cronologia. Il pennello passa da `parseBrush` e il `d`
/// lo ricalcola il motore.
function migra(dati: Partial<SalvatoV1>): boolean {
  if (!Array.isArray(dati.tratti)) return false;
  const livello = livelloDi(motore);
  if (livello === null) return false;
  const ops: Op[] = [];
  const presi = new Set<string>();
  let tutto: Riquadro | null = null;
  for (const s of dati.tratti as SalvatoV1["tratti"]) {
    try {
      if (s.scala !== 10 && s.scala !== 100) continue;
      if (!COLORI.some((c) => c.valore === s.colore)) continue;
      const brush = parseBrush(s.brush);
      const ink: QuantizedInk = { scale: s.scala, samples: s.campioni };
      const riquadro = riquadroDi(ink, brush);
      if (!riquadro) continue;
      const id = createId("object", (x) => presi.has(x) || x === livello);
      presi.add(id);
      ops.push(aggiuntaTratto(livello, id, s.colore, brush, ink, null));
      tutto = unisci(tutto, riquadro);
      if (s.dispositivo in DISPOSITIVI) origini.set(id, { dispositivo: s.dispositivo, diviso: s.diviso === true });
    } catch {
      // Un tratto illeggibile si salta: gli altri restano.
    }
  }
  if (ops.length === 0) return false;
  const pagina = tutto ? paginaPer(tutto) : null;
  if (pagina !== null) ops.push({ op: "page", viewBox: pagina });
  return motore.apply({ op: "batch", label: "Tratti salvati", ops }).outcome === "applied";
}

function ripristina(): number {
  const testo = leggi(CHIAVE_DISEGNO);
  if (!testo) return 0;
  let dati: Record<string, unknown> | null;
  try {
    dati = JSON.parse(testo) as Record<string, unknown> | null;
  } catch {
    return 0;
  }
  const riuscito = dati?.v === 2 ? riapri(dati as Partial<Salvato>) : dati?.v === 1 ? migra(dati as Partial<SalvatoV1>) : false;
  if (!riuscito) {
    motore = SceneEngine.open(documentoNuovo());
    origini.clear();
    return 0;
  }
  return vociTratto().length;
}

// ---------------------------------------------------------------------------
// Stato del lavoro

function mostraStato(): void {
  const contenitore = byId<HTMLElement>("stato");
  for (const stato of ORDINE_STATI) {
    const pacchetti = PACCHETTI.filter((p) => p.stato === stato);
    if (pacchetti.length === 0) continue;
    const gruppo = el("section", "gruppo");
    gruppo.dataset.stato = stato;
    gruppo.append(el("h3", undefined, STATI[stato]));
    const lista = el("ul");
    for (const p of pacchetti) {
      const voce = el("li");
      const testa = el("div", "voce-testa");
      testa.append(el("span", "codice", p.codice), el("span", "titolo", p.titolo));
      if (p.pr !== undefined) {
        const repo = p.repo ?? "Fub";
        const link = el("a", "pr", p.repo === undefined ? `#${p.pr}` : `${repo}#${p.pr}`);
        link.href = `https://github.com/Fubeo/${repo}/pull/${p.pr}`;
        link.target = "_blank";
        link.rel = "noopener";
        link.title = `Fubeo/${repo}#${p.pr}`;
        testa.append(link);
      }
      voce.append(testa, el("p", "nota", p.nota));
      lista.append(voce);
    }
    gruppo.append(lista);
    contenitore.append(gruppo);
  }
}

async function mostraVersione(): Promise<void> {
  const dove = byId<HTMLElement>("versione");
  try {
    const risposta = await fetch("/__anteprima/git", { cache: "no-store" });
    if (!risposta.ok) return;
    const { commit, quando } = (await risposta.json()) as { commit: string; quando: string };
    const data = new Date(quando);
    const formato = new Intl.DateTimeFormat("it-IT", { dateStyle: "medium", timeStyle: "short" });
    dove.textContent = `${commit} · ${formato.format(data)}`;
    dove.title = "Commit del ramo d'anteprima che questa pagina mostra";
    dove.hidden = false;
  } catch {
    // Senza il server dell'anteprima la riga non serve.
  }
}

// ---------------------------------------------------------------------------
// Avvio

function cambiato(): void {
  allinea();
  bottoneAnnulla.disabled = daAnnullare.length === 0;
  bottoneRipeti.disabled = daRipetere.length === 0;
  bottoneSvuota.disabled = tratti.length === 0;
  foglio.classList.toggle("vuoto", tratti.length === 0);
  aggiornaIspettore();
  mostraFile(true);
  salva();
}

segnaScelte();
mostraStato();
void mostraVersione();
const ripristinati = ripristina();
cambiato();

const osservatore = new ResizeObserver(() => dimensiona());
osservatore.observe(foglio);
vita.add(() => osservatore.disconnect());
vita.add(() => penna.destroy());
dimensiona();
if (ripristinati > 0) adatta();
else impostaCamera(camera);
