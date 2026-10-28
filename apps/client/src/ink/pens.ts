// Le penne di sistema: sette ricette di pennello con un nome.
//
// Sei sono `pf1` con altri numeri (formato della scena, §5) e la Calligrafia
// è la punta piatta `nib1`. Il pennello di un tratto porta la penna come
// chiave conservata, `pen=<id>`: `pf1` non la conosce e la tiene, quindi un
// file scritto con una penna si apre uguale anche dove le penne non ci sono.
// Le rastremazioni sono in multipli della misura, perché una penna più grossa
// resti la stessa penna.
//
// Qui stanno soltanto i numeri. Il nome che si legge, l'icona e l'ordine
// nella galleria sono del prodotto.

import { brushForInput, NIB1_DEFAULTS, PF1_DEFAULTS, penOf, withPen, type InkBrush } from "./brush";

/// Gli id delle penne di sistema, nell'ordine della galleria.
export const PEN_IDS = ["ballpoint", "fountain", "brush", "marker", "pencil", "calligraphy", "highlighter"] as const;

export type PenId = (typeof PEN_IDS)[number];

/// Come si fonde il tratto con ciò che sta sotto.
export type PenBlend = "normal" | "multiply";

/// Una penna: la sua misura di serie, quanto copre e la ricetta del pennello.
export interface Pen {
  readonly id: PenId;
  /// Lo strumento che la usa: le penne della Penna, o l'evidenziatore.
  readonly tool: "pen" | "highlighter";
  /// La misura di serie, in unità.
  readonly size: number;
  /// Quanto copre: 1 pieno.
  readonly opacity: number;
  readonly blend: PenBlend;
  /// Lo spessore segue la pressione quando il dispositivo la dà.
  readonly pressure: boolean;
  /// Il pennello di misura `size`, senza la chiave `pen`.
  recipe(size: number): InkBrush;
}

const pf1Pen = (
  id: PenId,
  size: number,
  numbers: { thinning: number; taperStart?: number; taperEnd?: number; caps?: boolean; smoothing?: number; streamline?: number },
  look: { opacity?: number; blend?: PenBlend; pressure?: boolean; tool?: "pen" | "highlighter" } = {},
): Pen => ({
  id,
  tool: look.tool ?? "pen",
  size,
  opacity: look.opacity ?? 1,
  blend: look.blend ?? "normal",
  pressure: look.pressure ?? true,
  recipe: (width) => ({
    ...PF1_DEFAULTS,
    size: width,
    thinning: numbers.thinning,
    smoothing: numbers.smoothing ?? PF1_DEFAULTS.smoothing,
    streamline: numbers.streamline ?? PF1_DEFAULTS.streamline,
    taperStart: (numbers.taperStart ?? 0) * width,
    taperEnd: (numbers.taperEnd ?? 0) * width,
    capStart: numbers.caps ?? true,
    capEnd: numbers.caps ?? true,
    sim: false,
  }),
});

/// Le sette penne.
export const PENS: Readonly<Record<PenId, Pen>> = {
  ballpoint: pf1Pen("ballpoint", 2, { thinning: 0.25, taperStart: 1, taperEnd: 4 }),
  fountain: pf1Pen("fountain", 3, { thinning: 0.6, taperStart: 2, taperEnd: 8, smoothing: 0.6, streamline: 0.45 }),
  brush: pf1Pen("brush", 10, { thinning: 0.85, taperStart: 4, taperEnd: 8, caps: false, smoothing: 0.7 }),
  marker: pf1Pen("marker", 6, { thinning: 0 }, { opacity: 0.92, pressure: false }),
  pencil: pf1Pen("pencil", 1.5, { thinning: 0.35 }, { opacity: 0.8 }),
  calligraphy: {
    id: "calligraphy",
    tool: "pen",
    size: 12,
    opacity: 1,
    blend: "normal",
    pressure: true,
    recipe: (width) => ({ ...NIB1_DEFAULTS, size: width, tip: Math.min(NIB1_DEFAULTS.tip, width) }),
  },
  highlighter: pf1Pen("highlighter", 16, { thinning: 0, caps: false }, { opacity: 0.5, blend: "multiply", pressure: false, tool: "highlighter" }),
};

/// La penna di serie della Penna.
export const DEFAULT_PEN: PenId = "ballpoint";

/// `id` è una penna di sistema?
export function isPenId(id: string | null | undefined): id is PenId {
  return id !== null && id !== undefined && (PEN_IDS as readonly string[]).includes(id);
}

/// Il pennello della penna `pen` di misura `size`, per un tratto nato con o
/// senza la pressione del dispositivo. Una penna che non la segue non la
/// finge nemmeno: il suo `sim` resta 0.
export function penBrush(pen: PenId, size: number, pressure: boolean): InkBrush {
  const spec = PENS[pen];
  const brush = withPen(spec.recipe(size), pen);
  return spec.pressure ? brushForInput(brush, pressure) : brush;
}

/// Quanto copre e come si fonde un tratto col pennello `brush`, scritto da
/// `tool`: dalla penna che il pennello dice, o dalla penna di serie dello
/// strumento per i tratti nati prima delle penne.
export function penLook(brush: InkBrush | null, tool: string): { opacity: number; blend: PenBlend } {
  const named = brush === null ? null : penOf(brush);
  if (isPenId(named)) return { opacity: PENS[named].opacity, blend: PENS[named].blend };
  return tool === "highlighter" ? { opacity: PENS.highlighter.opacity, blend: PENS.highlighter.blend } : { opacity: 1, blend: "normal" };
}

/// La misura più piccola e la più grande di una penna, in unità.
export const MIN_PEN_SIZE = 0.25;
export const MAX_PEN_SIZE = 200;

/// I passi del cursore della misura: logaritmico, perché fra 0,25 e 2 conta
/// ogni decimo e fra 100 e 200 no.
export const SIZE_SLIDER_STEPS = 1000;

/// La posizione del cursore, 0…`SIZE_SLIDER_STEPS`, per la misura `size`.
export function sizeToSlider(size: number): number {
  const clamped = Math.min(MAX_PEN_SIZE, Math.max(MIN_PEN_SIZE, size));
  return Math.round((Math.log(clamped / MIN_PEN_SIZE) / Math.log(MAX_PEN_SIZE / MIN_PEN_SIZE)) * SIZE_SLIDER_STEPS);
}

/// La misura per la posizione `step` del cursore, con due decimali sotto 10
/// e uno sopra: un cursore non dà numeri che nessuno scriverebbe.
export function sliderToSize(step: number): number {
  const k = Math.min(SIZE_SLIDER_STEPS, Math.max(0, step)) / SIZE_SLIDER_STEPS;
  const size = MIN_PEN_SIZE * (MAX_PEN_SIZE / MIN_PEN_SIZE) ** k;
  const places = size < 10 ? 100 : 10;
  return Math.min(MAX_PEN_SIZE, Math.max(MIN_PEN_SIZE, Math.round(size * places) / places));
}

/// Una penna salvata da chi disegna: una penna di sistema con la sua misura,
/// il suo colore, quanto copre e un nome.
export interface SavedPen {
  readonly name: string;
  readonly pen: PenId;
  readonly size: number;
  /// `#rrggbb`.
  readonly color: string;
  /// 0…1, moltiplica quella della penna.
  readonly opacity: number;
}

/// Quante penne si salvano al massimo, e quanto è lungo un nome.
export const MAX_SAVED_PENS = 24;
export const MAX_PEN_NAME = 60;

/// `value` come penne salvate: quelle del suo elenco `pens` che si leggono,
/// nell'ordine, una per nome, al più [`MAX_SAVED_PENS`]. Una che non si
/// legge non conta, e non toglie le altre.
export function savedPensOf(value: unknown): readonly SavedPen[] {
  const pens = typeof value === "object" && value !== null ? (value as Record<string, unknown>).pens : undefined;
  if (!Array.isArray(pens)) return [];
  const out: SavedPen[] = [];
  for (const each of pens as unknown[]) {
    const pen = savedPenOf(each);
    if (pen === null || out.some((other) => other.name === pen.name)) continue;
    out.push(pen);
    if (out.length === MAX_SAVED_PENS) break;
  }
  return out;
}

function savedPenOf(value: unknown): SavedPen | null {
  if (typeof value !== "object" || value === null) return null;
  const { name, pen, size, color, opacity } = value as Record<string, unknown>;
  if (typeof name !== "string" || name.trim() === "" || name.length > MAX_PEN_NAME) return null;
  if (typeof pen !== "string" || !isPenId(pen)) return null;
  if (typeof size !== "number" || !Number.isFinite(size) || size < MIN_PEN_SIZE || size > MAX_PEN_SIZE) return null;
  if (typeof color !== "string" || !/^#[0-9a-f]{6}$/i.test(color)) return null;
  if (typeof opacity !== "number" || !Number.isFinite(opacity) || opacity <= 0 || opacity > 1) return null;
  return { name: name.trim(), pen, size, color: color.toLowerCase(), opacity };
}
