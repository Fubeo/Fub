// I margini della pagina e le guide che li trascinano (E28, T72; il
// prototipo `.px-g`, `.px-tip`, `PXM`, passo 28).
//
// Sui quattro bordi del testo di ogni pagina c'è una guida, una maniglia
// alta 12 px con un filo nell'accento al centro: si vede appena con la
// sezione «Pagina» aperta, piena al passaggio e mentre si trascina. Il
// trascinamento cambia il margine di quel lato in millimetri, dal bordo della
// pagina al puntatore, e accanto al puntatore dice «Sopra 25 mm»: le pagine
// si rifanno «dal vivo», e a gesto finito si apre la sezione «Pagina» coi
// numeri nuovi. Con i margini a specchio, sulle pagine pari (la seconda, la
// quarta…) destra e sinistra si scambiano, e la guida di sinistra cambia il
// margine destro del profilo.
//
// Qui anche la regola che tiene i margini dentro la pagina (`clampMargins`):
// ogni margine fra 5 e 70 mm, come nel prototipo, e al testo restano almeno
// `MIN_ROOM_MM` in larghezza e in altezza, anche su un foglio piccolo o con
// margini scritti a mano in un profilo.

import { t, type Key } from "../i18n/strings";
import { openLifetime } from "../ui/lifetime";
import type { ExportProfile, Margins } from "./profile";

/// Il margine più stretto e il più largo, in millimetri.
export const MIN_MARGIN_MM = 5;
export const MAX_MARGIN_MM = 70;
/// Quanto resta almeno al testo, in larghezza e in altezza.
export const MIN_ROOM_MM = 30;

/// I tre margini pronti (`PXM`): sopra, destra, sotto, sinistra.
export const MARGIN_PRESETS: Readonly<Record<"stretti" | "normali" | "larghi", Margins>> = {
  stretti: { sopra: 15, destra: 15, sotto: 15, sinistra: 15 },
  normali: { sopra: 25, destra: 22, sotto: 25, sinistra: 22 },
  larghi: { sopra: 32, destra: 34, sotto: 32, sinistra: 34 },
};

export type MarginSide = keyof Margins;

export const MARGIN_SIDES: readonly MarginSide[] = ["sopra", "destra", "sotto", "sinistra"];

/// Il nome di un lato, per la guida e per l'avviso.
export const SIDE_NAMES: Readonly<Record<MarginSide, Key>> = {
  sopra: "pdf_export.page.top",
  destra: "pdf_export.page.right",
  sotto: "pdf_export.page.bottom",
  sinistra: "pdf_export.page.left",
};

/// Il lato opposto: lo spazio del testo è fra i due.
const OPPOSITE: Readonly<Record<MarginSide, MarginSide>> = { sopra: "sotto", sotto: "sopra", destra: "sinistra", sinistra: "destra" };

/// Quale dei tre pronti sono i margini, o `null` (i tuoi).
export function marginPreset(margins: Margins): keyof typeof MARGIN_PRESETS | null {
  for (const [name, preset] of Object.entries(MARGIN_PRESETS) as [keyof typeof MARGIN_PRESETS, Margins][]) {
    if (MARGIN_SIDES.every((side) => preset[side] === margins[side])) return name;
  }
  return null;
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/// I margini dentro la pagina `[larghezza, altezza]` (in millimetri, già
/// girata). Ogni margine sta fra 5 e 70 mm (uno che non è un numero torna a
/// quello normale); se due margini opposti lasciano al testo meno di
/// `MIN_ROOM_MM`, cede quello che si sta cambiando (`moving`; senza, il
/// primo dei due), e se non basta anche l'altro. Un foglio così piccolo che neanche i margini più
/// stretti lascerebbero il posto tiene i margini più stretti.
export function clampMargins(margins: Margins, paper: readonly [number, number], moving?: MarginSide): Margins {
  const out: Record<MarginSide, number> = { ...MARGIN_PRESETS.normali };
  for (const side of MARGIN_SIDES) {
    const value = Number(margins[side]);
    out[side] = Number.isFinite(value) ? clampNumber(Math.round(value * 10) / 10, MIN_MARGIN_MM, MAX_MARGIN_MM) : MARGIN_PRESETS.normali[side];
  }
  const fit = (a: MarginSide, b: MarginSide, length: number) => {
    const room = Math.max(MIN_ROOM_MM, 0);
    const excess = out[a] + out[b] + room - length;
    if (excess <= 0) return;
    // Cede prima il lato che si sta cambiando: l'altro resta dov'era.
    const [first, second] = moving === b ? [b, a] : [a, b];
    const fromFirst = Math.min(excess, out[first] - MIN_MARGIN_MM);
    out[first] -= fromFirst;
    out[second] = Math.max(MIN_MARGIN_MM, out[second] - (excess - fromFirst));
  };
  fit("sinistra", "destra", paper[0]);
  fit("sopra", "sotto", paper[1]);
  return out;
}

/// Il margine di un lato che si può ancora dare, con la pagina e il lato
/// opposto: per l'avviso.
export function marginLimit(side: MarginSide, margins: Margins, paper: readonly [number, number]): number {
  const length = side === "sopra" || side === "sotto" ? paper[1] : paper[0];
  return clampNumber(length - MIN_ROOM_MM - margins[OPPOSITE[side]], MIN_MARGIN_MM, MAX_MARGIN_MM);
}

/// I margini di una pagina come si disegnano: con lo specchio, sulle pagine
/// pari (indice dispari) destra e sinistra si scambiano.
export function marginsOfPage(margins: Margins, index: number, mirror: boolean): Margins {
  if (!mirror || index % 2 === 0) return margins;
  return { ...margins, destra: margins.sinistra, sinistra: margins.destra };
}

/// Il lato del profilo che una guida cambia: la guida di sinistra di una
/// pagina pari, con lo specchio, cambia il margine destro.
export function sideOfGuide(guide: MarginSide, index: number, mirror: boolean): MarginSide {
  if (!mirror || index % 2 === 0) return guide;
  if (guide === "sinistra") return "destra";
  if (guide === "destra") return "sinistra";
  return guide;
}

/// Il margine in millimetri dal bordo `guide` della pagina al puntatore.
/// `rect` è il foglio sullo schermo, `pxPerMm` i pixel di un millimetro allo
/// zoom di adesso.
export function marginAt(guide: MarginSide, rect: { left: number; top: number; right: number; bottom: number }, x: number, y: number, pxPerMm: number): number {
  const distance = guide === "sopra" ? y - rect.top : guide === "sotto" ? rect.bottom - y : guide === "sinistra" ? x - rect.left : rect.right - x;
  return Math.round(distance / pxPerMm);
}

export interface GuidesOptions {
  /// Le pagine dello spazio (`.export-doc`): le guide ci stanno dentro.
  readonly pages: HTMLElement;
  /// Dove si mette il cartellino accanto al puntatore e la classe del gesto.
  readonly root: HTMLElement;
  /// I pixel di un millimetro sulla pagina allo zoom di adesso.
  pxPerMm(): number;
  readonly profile: () => ExportProfile;
  /// La misura del foglio in millimetri, girata.
  paper(profile: ExportProfile): readonly [number, number];
  /// Il profilo coi margini nuovi: `live` mentre si trascina.
  change(next: ExportProfile, live: boolean): void;
  /// A gesto finito: si apre la sezione «Pagina».
  done(): void;
}

/// Le guide dello spazio: un solo ascoltatore sulle pagine, il gesto sulla
/// finestra finché dura. Torna il disposer.
export function attachGuides(options: GuidesOptions): () => void {
  const tip = document.createElement("div");
  tip.className = "export-guide-tip";
  tip.hidden = true;
  tip.setAttribute("aria-hidden", "true");
  options.root.append(tip);
  let stop: (() => void) | null = null;

  const down = (event: PointerEvent) => {
    if (event.button !== 0) return;
    const guide = (event.target as Element | null)?.closest<HTMLElement>(".export-guide");
    const slot = guide?.closest<HTMLElement>(".export-slot");
    if (!guide || !slot || !options.pages.contains(slot)) return;
    const visible = guide.dataset["guide"] as MarginSide | undefined;
    if (!visible || !MARGIN_SIDES.includes(visible)) return;
    event.preventDefault();
    event.stopPropagation();
    stop?.();
    const index = Number(slot.dataset["page"] ?? 0);
    const start = options.profile();
    const side = sideOfGuide(visible, index, start.pagina.specchio);
    options.root.classList.add("is-dragging");
    tip.hidden = false;

    const move = (ev: PointerEvent) => {
      // Il foglio si rilegge a ogni passo: l'impaginazione può spostarlo.
      const rect = slot.getBoundingClientRect();
      const now = options.profile();
      const paper = options.paper(now);
      const wanted = marginAt(visible, rect, ev.clientX, ev.clientY, options.pxPerMm());
      const margini = clampMargins({ ...now.pagina.margini, [side]: wanted }, paper, side);
      tip.textContent = t("pdf_export.page.guide_tip", { side: t(SIDE_NAMES[side]), mm: String(Math.round(margini[side])) });
      tip.style.left = `${ev.clientX + 14}px`;
      tip.style.top = `${ev.clientY + 14}px`;
      if (MARGIN_SIDES.some((s) => margini[s] !== now.pagina.margini[s])) {
        options.change({ ...now, pagina: { ...now.pagina, margini } }, true);
      }
    };
    const up = () => {
      finish();
      // Il profilo ha già i margini del gesto: ora si ridisegna il pannello.
      options.change(options.profile(), false);
      options.done();
    };
    const cancel = (ev: KeyboardEvent) => {
      if (ev.key !== "Escape") return;
      ev.preventDefault();
      ev.stopPropagation();
      finish();
      options.change(start, false);
    };
    // Gli ascolti del gesto vivono quanto il gesto: `finish` li chiude tutti.
    const gesture = openLifetime();
    const finish = () => {
      gesture.close();
      options.root.classList.remove("is-dragging");
      tip.hidden = true;
      stop = null;
    };
    stop = finish;
    gesture.listen(window, "pointermove", move);
    gesture.listen(window, "pointerup", up);
    gesture.listen(window, "pointercancel", up);
    gesture.listen(window, "keydown", cancel, { capture: true });
    move(event);
  };

  options.pages.addEventListener("pointerdown", down);
  return () => {
    stop?.();
    options.pages.removeEventListener("pointerdown", down);
    tip.remove();
  };
}
