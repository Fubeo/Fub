// La pagina d'anteprima del lavoro sull'editor di FubDraw.
//
// Monta su un foglio vero il codice dei pacchetti man mano che arriva: la
// pipeline della penna e il pennello pf1 (FD-203), la camera condivisa
// (FD-101). Ciò che ancora non c'è — il painter di FD-204, gli strumenti di
// FD-205, la superficie registrata nella shell di FD-206b — qui è una cucitura
// provvisoria, scritta per sparire: un `<g>` di `<path>` per i tratti conclusi
// e un canvas per il tratto in corso.
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
import {
  attachPenInput,
  type CancelReason,
  type FinishedStroke,
  type InkPointerType,
} from "../src/editors/spatial/pen/pen-input";
import { PF1_DEFAULTS, brushForInput, formatBrush, parseBrush, type Pf1Brush } from "../src/editors/spatial/ink/brush";
import { pf1, pf1Outline, type OutlinePoint } from "../src/editors/spatial/ink/pf1";
import {
  INK_MAX_SAMPLES,
  quantizeInk,
  type InkSample,
  type QuantizedInk,
  type QuantizedSample,
} from "../src/editors/spatial/ink/sample";
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
const SVG = "http://www.w3.org/2000/svg";

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
// Il foglio

const foglio = byId<HTMLDivElement>("foglio");
const disegno = foglio.querySelector("svg")!;
const mondo = disegno.querySelector("g")!;
const sovrapposizione = byId<HTMLCanvasElement>("in-corso");
const pennello2d = sovrapposizione.getContext("2d")!;
const annunci = byId<HTMLElement>("annunci");

function annuncia(testo: string): void {
  // Lo stesso testo due volte di fila si annuncia comunque: si svuota prima.
  annunci.textContent = "";
  window.requestAnimationFrame(() => (annunci.textContent = testo));
}

/// Un tratto concluso, com'è nel documento: colore, pennello, inchiostro
/// quantizzato e il `d` che `pf1` ne ricava.
interface Tratto {
  readonly colore: string;
  readonly brush: Pf1Brush;
  readonly ink: QuantizedInk;
  readonly d: string;
  readonly dispositivo: InkPointerType;
  readonly inclinazione: boolean;
  readonly diviso: boolean;
  readonly elemento: SVGPathElement;
}

type Azione =
  | { readonly tipo: "aggiungi"; readonly tratto: Tratto }
  | { readonly tipo: "svuota"; readonly tratti: readonly Tratto[] };

const tratti: Tratto[] = [];
const daAnnullare: Azione[] = [];
const daRipetere: Azione[] = [];

let colore: string = COLORI[0].valore;
let spessore: number = SPESSORI[1].valore;

/// Il pennello di un tratto nuovo: i valori di `getStroke` con lo spessore
/// scelto, come nell'esempio del formato (§5). `sim` lo decide il
/// dispositivo, con `brushForInput`.
function pennelloBase(): Pf1Brush {
  return { ...PF1_DEFAULTS, size: spessore, sim: false };
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

// --- Tratti conclusi ----------------------------------------------------------

function elementoDi(d: string, fill: string): SVGPathElement {
  const path = document.createElementNS(SVG, "path");
  path.setAttribute("d", d);
  path.setAttribute("fill", fill);
  return path;
}

function aggiungi(t: Tratto): void {
  tratti.push(t);
  mondo.append(t.elemento);
}

function togli(t: Tratto): void {
  const i = tratti.lastIndexOf(t);
  if (i >= 0) tratti.splice(i, 1);
  t.elemento.remove();
}

function applica(a: Azione, avanti: boolean): void {
  if (a.tipo === "aggiungi") {
    if (avanti) aggiungi(a.tratto);
    else togli(a.tratto);
  } else if (avanti) {
    for (const t of a.tratti) togli(t);
  } else {
    for (const t of a.tratti) aggiungi(t);
  }
}

function esegui(a: Azione): void {
  applica(a, true);
  daAnnullare.push(a);
  daRipetere.length = 0;
  cambiato();
}

function annulla(): void {
  const a = daAnnullare.pop();
  if (!a) return;
  applica(a, false);
  daRipetere.push(a);
  cambiato();
  annuncia(a.tipo === "aggiungi" ? "Tratto annullato." : "Foglio ripristinato.");
}

function ripeti(): void {
  const a = daRipetere.pop();
  if (!a) return;
  applica(a, true);
  daAnnullare.push(a);
  cambiato();
  annuncia(a.tipo === "aggiungi" ? "Tratto ripetuto." : "Foglio svuotato.");
}

function svuota(): void {
  if (tratti.length === 0) return;
  esegui({ tipo: "svuota", tratti: [...tratti] });
  annuncia("Foglio svuotato. Ctrl+Z lo ripristina.");
}

function concludi(s: FinishedStroke, corrente: InCorso): void {
  let ink: QuantizedInk;
  let d: string;
  try {
    ink = quantizeInk(s.samples);
    d = pf1(ink, corrente.brush);
  } catch (errore) {
    annuncia(`Tratto scartato: ${errore instanceof Error ? errore.message : String(errore)}`);
    return;
  }
  if (d === "") return;
  esegui({
    tipo: "aggiungi",
    tratto: {
      colore: corrente.colore,
      brush: corrente.brush,
      ink,
      d,
      dispositivo: s.pointerType,
      inclinazione: s.tilt,
      diviso: s.split,
      elemento: elementoDi(d, corrente.colore),
    },
  });
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
    ispettore.append(el("p", "vuoto", "Disegna qualcosa: qui compaiono i dati del tratto che il file conserverebbe."));
    return;
  }
  const lista = el("dl");
  const campioni = t.ink.samples;
  const pressione = campioni[0]?.p !== undefined;
  riga(lista, "Dispositivo", DISPOSITIVI[t.dispositivo]);
  riga(lista, "Campioni", `${campioni.length}${t.diviso ? ", diviso al limite" : ""}`);
  riga(lista, "Durata", `${campioni[campioni.length - 1]?.t ?? 0} ms`);
  riga(lista, "Pressione", pressione ? "dalla penna, 0…255" : "simulata dalla velocità (sim=1)");
  riga(lista, "Inclinazione", t.inclinazione ? "sì, altitudine e azimut" : "no");
  riga(lista, "fub:brush", codice(formatBrush(t.brush)));
  riga(lista, "fub:ink", codice(`scala s${t.ink.scale}, ${campioni.length} campioni interi`));
  const d = el("details");
  d.append(el("summary", undefined, `${t.d.length} caratteri`), el("pre", undefined, t.d));
  riga(lista, "d", d);
  ispettore.append(lista);
}

// ---------------------------------------------------------------------------
// Salvataggio nel browser: il disegno sopravvive a un ricaricamento

interface Salvato {
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
  if (tratti.length === 0) {
    scrivi(CHIAVE_DISEGNO, null);
    return;
  }
  const dati: Salvato = {
    v: 1,
    tratti: tratti.map((t) => ({
      colore: t.colore,
      brush: formatBrush(t.brush),
      dispositivo: t.dispositivo,
      inclinazione: t.inclinazione,
      diviso: t.diviso,
      scala: t.ink.scale,
      campioni: t.ink.samples,
    })),
  };
  scrivi(CHIAVE_DISEGNO, JSON.stringify(dati));
}

/// Rilegge il disegno salvato: il pennello passa da `parseBrush` e `d` si
/// ricalcola dagli interi, come farà chi apre il file.
function ripristina(): number {
  const testo = leggi(CHIAVE_DISEGNO);
  if (!testo) return 0;
  let dati: Partial<Salvato> | null;
  try {
    dati = JSON.parse(testo) as Partial<Salvato> | null;
  } catch {
    return 0;
  }
  const elenco: Salvato["tratti"] | undefined = dati?.v === 1 ? dati.tratti : undefined;
  if (!Array.isArray(elenco)) return 0;
  let letti = 0;
  for (const s of elenco as Salvato["tratti"]) {
    try {
      if (s.scala !== 10 && s.scala !== 100) continue;
      if (!COLORI.some((c) => c.valore === s.colore)) continue;
      const brush = parseBrush(s.brush);
      const ink: QuantizedInk = { scale: s.scala, samples: s.campioni };
      const d = pf1(ink, brush);
      if (d === "") continue;
      aggiungi({
        colore: s.colore,
        brush,
        ink,
        d,
        dispositivo: DISPOSITIVI[s.dispositivo] ? s.dispositivo : "mouse",
        inclinazione: s.inclinazione === true,
        diviso: s.diviso === true,
        elemento: elementoDi(d, s.colore),
      });
      letti++;
    } catch {
      // Un tratto illeggibile si salta: gli altri restano.
    }
  }
  return letti;
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
        const link = el("a", "pr", `#${p.pr}`);
        link.href = `https://github.com/Fubeo/Fub/pull/${p.pr}`;
        link.target = "_blank";
        link.rel = "noopener";
        link.title = `Fubeo/Fub#${p.pr}`;
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
  bottoneAnnulla.disabled = daAnnullare.length === 0;
  bottoneRipeti.disabled = daRipetere.length === 0;
  bottoneSvuota.disabled = tratti.length === 0;
  foglio.classList.toggle("vuoto", tratti.length === 0);
  aggiornaIspettore();
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
