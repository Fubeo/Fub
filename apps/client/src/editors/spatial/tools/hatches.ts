// Le campiture (livello Standard): righe, righe incrociate e puntini che
// riempiono un oggetto, sopra un fondo o sopra ciò che sta sotto, come le
// scrive il formato della scena (formato della scena, risorse).
//
// - **L'oggetto dice la sua campitura** in `fub:pattern`, sul `pattern`
//   privato che usa come riempimento: «lines -45 8 1.5 #000000 #56b4e9» è
//   il genere, l'angolo, il passo, lo spessore, il colore delle righe e il
//   fondo, se c'è. Il contenuto del `pattern` ne discende, come il `d` di
//   una forma da `fub:geom`: un quadrato di lato il passo, col fondo e una
//   riga, due righe o un puntino, girato dell'angolo. Ogni lettore di SVG lo
//   mostra.
// - **È di FubDraw** soltanto un `pattern` che è, attributo per attributo e
//   figlio per figlio, quello che FubDraw scriverebbe per `fub:pattern`.
//   Ogni altro motivo è di un altro programma: si vede e si conserva.
// - **Le misure sono dell'oggetto:** il passo, lo spessore e l'angolo si
//   contano nelle sue coordinate (`userSpaceOnUse`), e la campitura si
//   sposta, gira e scala con lui, come in Inkscape e in Figma.
// - **Il ripiego** è il colore che la campitura dà vista da lontano: il
//   colore delle righe e il fondo mescolati secondo quanto le righe
//   coprono; senza fondo, il colore delle righe.

import { formatNumber } from "../number";
import { contrast } from "../scene/analysis";
import type { ElementPart } from "../scene/model";
import type { Elem } from "../scene/serialize";
import { number, paint, trim, type Rgb } from "../scene/values";
import { elemOf } from "./arrange";
import { sameElem } from "./effects";

/// Il genere di una campitura: righe, righe incrociate ad angolo retto,
/// puntini.
export type HatchKind = "lines" | "cross" | "dots";

export const HATCH_KINDS: readonly HatchKind[] = ["lines", "cross", "dots"];

/// Una campitura. L'angolo è quello delle righe, o della griglia dei
/// puntini, in gradi in senso orario, come `rotate()`, fra -180 escluso e
/// 180; il passo è la distanza fra due righe o due puntini, lo spessore
/// quello di una riga o il diametro di un puntino, al più il passo, nelle
/// coordinate dell'oggetto. I colori sono `#rrggbb` minuscoli; `background`
/// `null` lascia vedere ciò che sta sotto.
export interface Hatch {
  readonly kind: HatchKind;
  readonly angle: number;
  readonly spacing: number;
  readonly width: number;
  readonly color: string;
  readonly background: string | null;
}

/// Le campiture già pronte, nell'ordine del menu: diagonale, incrociata,
/// orizzontale, puntinata, quadrettata.
export type HatchPreset = "diagonal" | "cross" | "horizontal" | "dots" | "grid";

export const HATCH_PRESETS: readonly HatchPreset[] = ["diagonal", "cross", "horizontal", "dots", "grid"];

/// Il genere e l'angolo di ciascuna.
const PRESET_FORMS: Readonly<Record<HatchPreset, { readonly kind: HatchKind; readonly angle: number }>> = {
  diagonal: { kind: "lines", angle: -45 },
  cross: { kind: "cross", angle: 45 },
  horizontal: { kind: "lines", angle: 0 },
  dots: { kind: "dots", angle: 45 },
  grid: { kind: "cross", angle: 0 },
};

/// Il passo di una campitura nuova.
export const DEFAULT_SPACING = 8;

/// Lo spessore di una riga, e il diametro di un puntino, rispetto al passo,
/// in una campitura nuova: 1,5 e 3 su 8.
const LINE_SHARE = 0.1875;
const DOT_SHARE = 0.375;

/// I limiti del passo e dello spessore: sotto, le righe non si vedono più
/// come righe; sopra, la campitura è più grande di ogni oggetto.
export const MIN_SPACING = 0.5;
export const MAX_SPACING = 1000;
export const MIN_WIDTH = 0.1;

const BLACK = "#000000";
const WHITE = "#ffffff";

const HEX = /^#[0-9a-f]{6}$/;

/// Un numero di `fub:pattern`: al più due decimali.
const place = (value: number): string => formatNumber(value, 2);

/// Un numero del contenuto: al più quattro decimali, che tengono esatta la
/// metà di un numero a due.
const share = (value: number): string => formatNumber(value, 4);

/// Un numero di `fub:pattern` fra `lo` e `hi`, già a due decimali; `null`
/// altrimenti.
function amount(token: string | undefined, lo: number, hi: number): number | null {
  const value = token === undefined ? null : number(token);
  if (value === null || !(value >= lo && value <= hi)) return null;
  return Number(place(value)) === value ? value : null;
}

/// Lo spessore di partenza di `kind` col passo `spacing`.
export function defaultWidth(kind: HatchKind, spacing: number): number {
  return clampWidth(spacing * (kind === "dots" ? DOT_SHARE : LINE_SHARE), spacing);
}

/// `width` portato fra [`MIN_WIDTH`] e `spacing`, a due decimali.
export function clampWidth(width: number, spacing: number): number {
  return Number(place(Math.min(Math.max(width, MIN_WIDTH), spacing)));
}

/// `spacing` portato fra [`MIN_SPACING`] e [`MAX_SPACING`], a due decimali.
export function clampSpacing(spacing: number): number {
  return Number(place(Math.min(Math.max(spacing, MIN_SPACING), MAX_SPACING)));
}

/// `degrees` fra -180 escluso e 180, a due decimali.
export function normalAngle(degrees: number): number {
  const turned = Number(place(degrees)) % 360;
  const out = turned > 180 ? turned - 360 : turned <= -180 ? turned + 360 : turned;
  return Number(place(out)) || 0;
}

/// La campitura `preset`. Da `from` tiene il passo e i colori, e lo
/// spessore se le righe restano righe o i puntini puntini; senza, è nera,
/// senza fondo, col passo di partenza.
export function presetHatch(preset: HatchPreset, from: Hatch | null = null): Hatch {
  const { kind, angle } = PRESET_FORMS[preset];
  if (from === null) return { kind, angle, spacing: DEFAULT_SPACING, width: defaultWidth(kind, DEFAULT_SPACING), color: BLACK, background: null };
  const sameMark = (from.kind === "dots") === (kind === "dots");
  return { ...from, kind, angle, width: sameMark ? from.width : defaultWidth(kind, from.spacing) };
}

/// La campitura pronta che `hatch` è, a parte il passo, lo spessore e i
/// colori; `null` se non è nessuna. Le righe si guardano a meno di mezzo
/// giro, le righe incrociate e i puntini a meno di un quarto.
export function presetOf(hatch: Hatch): HatchPreset | null {
  const turn = hatch.kind === "lines" ? 180 : 90;
  const mod = (angle: number): number => ((angle % turn) + turn) % turn;
  return HATCH_PRESETS.find((preset) => PRESET_FORMS[preset].kind === hatch.kind && Math.abs(mod(PRESET_FORMS[preset].angle) - mod(hatch.angle)) < 0.005) ?? null;
}

/// La campitura di `fub:pattern`; `null` se il valore non si legge.
export function parseHatch(text: string): Hatch | null {
  const words = trim(text).split(/[ \t\n\r\f]+/);
  if (words.length !== 5 && words.length !== 6) return null;
  const [kind, a, s, w, color, background] = words as [string, string, string, string, string, string | undefined];
  if (!(HATCH_KINDS as readonly string[]).includes(kind)) return null;
  const angle = amount(a, -180, 180);
  const spacing = amount(s, MIN_SPACING, MAX_SPACING);
  const width = amount(w, MIN_WIDTH, MAX_SPACING);
  if (angle === null || angle === -180 || spacing === null || width === null || width > spacing) return null;
  if (!HEX.test(color) || (background !== undefined && !HEX.test(background))) return null;
  return { kind: kind as HatchKind, angle: angle || 0, spacing, width, color, background: background ?? null };
}

/// `hatch` come lo scrive `fub:pattern`.
export function formatHatch(hatch: Hatch): string {
  const words = [hatch.kind, place(hatch.angle), place(hatch.spacing), place(hatch.width), hatch.color];
  if (hatch.background !== null) words.push(hatch.background);
  return words.join(" ");
}

/// Il `pattern` `id` che disegna `hatch`, col ciclo di vita `role`.
export function hatchElem(id: string, hatch: Hatch, role: "private" | "shared" = "private"): Elem {
  const s = share(hatch.spacing);
  const w = share(hatch.width);
  const middle = share((hatch.spacing - hatch.width) / 2);
  const attrs: Record<string, string> = { id, "fub:role": role, "fub:pattern": formatHatch(hatch), patternUnits: "userSpaceOnUse", width: s, height: s };
  if (hatch.angle !== 0) attrs.patternTransform = `rotate(${place(hatch.angle)})`;
  const children: Elem[] = [];
  if (hatch.background !== null) children.push({ tag: "rect", attrs: { width: s, height: s, fill: hatch.background } });
  if (hatch.kind === "dots") {
    const half = share(hatch.spacing / 2);
    children.push({ tag: "circle", attrs: { cx: half, cy: half, r: share(hatch.width / 2), fill: hatch.color } });
  } else {
    children.push({ tag: "rect", attrs: { y: middle, width: s, height: w, fill: hatch.color } });
    if (hatch.kind === "cross") children.push({ tag: "rect", attrs: { x: middle, width: w, height: s, fill: hatch.color } });
  }
  return { tag: "pattern", attrs, children };
}

const read = new WeakMap<ElementPart, Hatch | null>();

/// La campitura che il `pattern` `node` disegna, se è di FubDraw: privata o
/// condivisa, e scritta esattamente come la scriverebbe [`hatchElem`].
/// `null` per ogni altra risorsa.
export function hatchOf(node: ElementPart): Hatch | null {
  let hatch = read.get(node);
  if (hatch === undefined) {
    hatch = readHatch(node);
    read.set(node, hatch);
  }
  return hatch;
}

function readHatch(node: ElementPart): Hatch | null {
  if (node.kind !== "leaf" || node.facts.local !== "pattern" || node.details?.role !== "resource") return null;
  const lifecycle = node.details.lifecycle;
  if (lifecycle !== "private" && lifecycle !== "shared") return null;
  const elem = elemOf(node);
  const text = elem?.attrs["fub:pattern"];
  const hatch = text === undefined ? null : parseHatch(text);
  if (elem === null || hatch === null || elem.attrs.id === undefined) return null;
  return sameElem(elem, hatchElem(elem.attrs.id, hatch, lifecycle)) ? hatch : null;
}

/// Il colore `#rrggbb` come canali.
function rgbOf(color: string): Rgb {
  return paint(color) as Rgb;
}

const hex = (rgb: readonly number[]): string => `#${rgb.map((value) => Math.round(value).toString(16).padStart(2, "0")).join("")}`;

/// Quanto della superficie coprono le righe o i puntini di `hatch`, da 0
/// a 1.
export function coverage(hatch: Pick<Hatch, "kind" | "spacing" | "width">): number {
  const ratio = hatch.width / hatch.spacing;
  switch (hatch.kind) {
    case "lines":
      return ratio;
    case "cross":
      return 1 - (1 - ratio) * (1 - ratio);
    case "dots":
      return (Math.PI * ratio * ratio) / 4;
  }
}

/// Il ripiego di chi usa `hatch`: il colore delle righe sul fondo, mescolati
/// in sRGB secondo quanto coprono; senza fondo, il colore delle righe.
export function hatchFallback(hatch: Hatch): string {
  if (hatch.background === null) return hatch.color;
  const c = coverage(hatch);
  const ink = rgbOf(hatch.color);
  const under = rgbOf(hatch.background);
  return hex(ink.map((value, at) => c * value + (1 - c) * under[at]!));
}

/// Il colore delle righe che si legge meglio su `background`: il nero o il
/// bianco, quello col contrasto più alto, il nero a parità; il nero senza
/// fondo.
export function inkFor(background: string | null): string {
  if (background === null) return BLACK;
  const under = rgbOf(background);
  return contrast(rgbOf(WHITE), under) > contrast(rgbOf(BLACK), under) ? WHITE : BLACK;
}

/// L'immagine CSS di `hatch` per il campione del pannello, grande intorno ai
/// 20 px: le righe a un passo di 6 px, o i puntini, sul fondo o su niente.
export function hatchImage(hatch: Hatch): string {
  const step = 6;
  const line = Math.max(1, Math.min(step - 1, (hatch.width / hatch.spacing) * step));
  const bg = hatch.background ?? "transparent";
  const px = (value: number): string => `${formatNumber(value, 2)}px`;
  const stripes = (angle: number, under: string): string =>
    `repeating-linear-gradient(${formatNumber(angle, 2)}deg, ${hatch.color} 0 ${px(line)}, ${under} ${px(line)} ${px(step)})`;
  switch (hatch.kind) {
    case "lines":
      return stripes(hatch.angle, bg);
    case "cross":
      return [stripes(hatch.angle, "transparent"), stripes(hatch.angle + 90, "transparent"), `linear-gradient(${bg}, ${bg})`].join(", ");
    case "dots": {
      const r = Math.max(1, Math.min(3, (hatch.width / hatch.spacing) * step));
      // A un quarto di giro i puntini stanno in quadrato, altrimenti a
      // quinconce.
      const square = Math.abs(normalAngle(hatch.angle) % 90) < 22.5 || Math.abs(normalAngle(hatch.angle) % 90) > 67.5;
      const spots = square ? ["25% 25%", "75% 25%", "25% 75%", "75% 75%"] : ["50% 50%", "0 0", "100% 0", "0 100%", "100% 100%"];
      const dot = (at: string): string => `radial-gradient(circle at ${at}, ${hatch.color} ${px(r)}, transparent ${px(r + 0.5)})`;
      return [...spots.map(dot), `linear-gradient(${bg}, ${bg})`].join(", ");
    }
  }
}
