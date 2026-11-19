// La sezione «Pagina» dello spazio «Esporta in PDF» (E28, T72; il prototipo
// `.px-seg`, `.px-mm`, `.px-in`, `PXP`, `PXM`, passo 28).
//
// Il formato (A4, A5, A3, Lettera o una misura tua), il verso, una o due
// colonne, i margini: uno dei tre pronti, o i quattro numeri in millimetri, o
// le guide trascinate sulla pagina (`guides.ts`). Sotto, i margini a
// specchio per il fronte e retro e la filigrana su ogni pagina.
//
// Un numero fuori misura non rompe la pagina: un lato del foglio va da 50 a
// 1189 mm, e uno fuori resta scritto in rosso con la frase che lo dice, la
// pagina com'era; un margine va da 5 a 70 mm e lascia al testo almeno 30 mm
// (`clampMargins`): uno più largo diventa il più largo possibile, e la frase
// lo dice. Le colonne sono del tema finché non le scegli tu, come i
// caratteri.

import { t, type Key } from "../../i18n/strings";
import { clampMargins, MARGIN_PRESETS, MARGIN_SIDES, marginPreset, MAX_MARGIN_MM, MIN_MARGIN_MM, MIN_ROOM_MM, SIDE_NAMES, type MarginSide } from "../guides";
import type { PageDecor } from "../pages";
import { MAX_PAPER_MM, MIN_PAPER_MM, PAPER_MM, paperSize, validPaper, type ExportProfile, type Margins, type ProfilePage } from "../profile";
import { textOf } from "../themes";
import { decimal, row, segments, toggle, withText } from "./fonts";
import { formatName } from "./index";
import type { SectionContext } from "./index";

/// I formati della sezione, nell'ordine del prototipo, e la misura tua.
const FORMATS: readonly (readonly [string, Key])[] = [
  ["A4", "pdf_export.page.a4"],
  ["A5", "pdf_export.page.a5"],
  ["A3", "pdf_export.page.a3"],
  ["Lettera", "pdf_export.page.letter"],
  ["proprio", "pdf_export.page.own"],
];

const MARGIN_LABELS: Readonly<Record<MarginSide, Key>> = {
  sopra: "pdf_export.page.top_label",
  destra: "pdf_export.page.right_label",
  sotto: "pdf_export.page.bottom_label",
  sinistra: "pdf_export.page.left_label",
};

/// La frase di un numero corretto o rifiutato, fra un disegno e l'altro.
const NOTE_KEY = "pagina.avviso";

/// Quanti caratteri ha al più la filigrana, come nel prototipo.
export const WATERMARK_MAX = 18;

/// Ciò che la sezione mette sui fogli oltre alle fasce (`pages.ts`).
export function pageDecorOf(profile: ExportProfile): PageDecor {
  return { mirror: profile.pagina.specchio, watermark: profile.pagina.filigrana.slice(0, WATERMARK_MAX) };
}

/// La pagina con un campo cambiato, e i margini tenuti dentro il foglio
/// nuovo.
export function withPage(profile: ExportProfile, change: Partial<ProfilePage>): ExportProfile {
  const pagina = { ...profile.pagina, ...change };
  return { ...profile, pagina: { ...pagina, margini: clampMargins(pagina.margini, paperSize(pagina)) } };
}

/// Un numero scritto in un campo, o `null`.
function numberOf(input: HTMLInputElement): number | null {
  const value = input.value.trim().replace(",", ".");
  if (value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/// Un campo in millimetri (`.px-mm label`).
function mmField(id: string, label: Key, aria: Key, value: number, min: number, max: number): { field: HTMLElement; input: HTMLInputElement } {
  const field = document.createElement("label");
  field.className = "export-mm-field";
  field.htmlFor = id;
  const name = document.createElement("span");
  name.textContent = t(label);
  const input = document.createElement("input");
  input.type = "number";
  input.className = "export-mm-input";
  input.id = id;
  input.min = String(min);
  input.max = String(max);
  input.step = "1";
  input.value = String(Math.round(value * 10) / 10);
  input.setAttribute("aria-label", t(aria));
  const unit = document.createElement("em");
  unit.textContent = t("pdf_export.page.mm");
  unit.setAttribute("aria-hidden", "true");
  field.append(name, input, unit);
  return { field, input };
}

export function pageBody(context: SectionContext): HTMLElement {
  const body = document.createElement("div");
  body.className = "export-page-section";
  const profile = context.profile;
  const page = profile.pagina;
  const change = (next: ExportProfile, live = false) => context.change(next, { live });

  const note = document.createElement("p");
  note.className = "export-note export-page-error";
  note.id = "export-page-note";
  note.setAttribute("role", "status");
  const saved = context.memory.get(NOTE_KEY);
  note.textContent = typeof saved === "string" ? saved : "";
  note.hidden = typeof saved !== "string";
  const say = (text: string | null) => {
    if (text === null) context.memory.delete(NOTE_KEY);
    else context.memory.set(NOTE_KEY, text);
  };

  const known = page.formato in PAPER_MM || page.formato === "proprio" ? page.formato : "A4";
  const format = segments("export-page-format", t("pdf_export.page.format"), FORMATS.map(([value, label]) => [value, label] as const), page.formato === "proprio" && !validPaper(page.misura_propria) ? "A4" : known, (value) => {
    say(null);
    if (value === "proprio") {
      // La misura tua parte da quella di adesso, in verticale.
      const [w, h] = paperSize({ ...page, orizzontale: false });
      change(withPage(profile, { formato: "proprio", misura_propria: [Math.round(w * 10) / 10, Math.round(h * 10) / 10] }));
    } else {
      change(withPage(profile, { formato: value }));
    }
  });
  body.append(row(t("pdf_export.page.format"), format));

  // La misura tua: due campi, ognuno fra 50 e 1189 mm; uno fuori resta
  // scritto, rosso, e la pagina non cambia.
  if (page.formato === "proprio" && validPaper(page.misura_propria)) {
    const own = page.misura_propria;
    const sizes = document.createElement("div");
    sizes.className = "export-mm export-mm-paper";
    const width = mmField("export-page-width", "pdf_export.page.width", "pdf_export.page.width_label", own[0], MIN_PAPER_MM, MAX_PAPER_MM);
    const height = mmField("export-page-height", "pdf_export.page.height", "pdf_export.page.height_label", own[1], MIN_PAPER_MM, MAX_PAPER_MM);
    const apply = (live: boolean) => {
      const next = [numberOf(width.input), numberOf(height.input)];
      const good = validPaper(next as number[]);
      for (const [input, value] of [[width.input, next[0]], [height.input, next[1]]] as const) {
        const ok = value !== null && value >= MIN_PAPER_MM && value <= MAX_PAPER_MM;
        if (ok) input.removeAttribute("aria-invalid");
        else input.setAttribute("aria-invalid", "true");
        if (ok) input.removeAttribute("aria-describedby");
        else input.setAttribute("aria-describedby", note.id);
      }
      if (!good) {
        const text = t("pdf_export.page.size_invalid", { min: MIN_PAPER_MM, max: MAX_PAPER_MM, size: formatName(context.profile) });
        note.textContent = text;
        note.hidden = false;
        // Il numero sbagliato resta scritto: il pannello non si ridisegna.
        if (!live) say(null);
        return;
      }
      note.hidden = true;
      say(null);
      change(withPage(context.profile, { misura_propria: [next[0] as number, next[1] as number] }), live);
    };
    for (const input of [width.input, height.input]) {
      input.addEventListener("input", () => apply(true));
      input.addEventListener("change", () => apply(false));
    }
    sizes.append(width.field, height.field);
    body.append(sizes);
  }

  body.append(
    row(
      t("pdf_export.page.orientation"),
      segments("export-page-orientation", t("pdf_export.page.orientation"), [[false, "pdf_export.page.vertical"], [true, "pdf_export.page.horizontal"]], page.orizzontale, (value) => {
        say(null);
        change(withPage(profile, { orizzontale: value }));
      }),
    ),
    row(
      t("pdf_export.page.columns"),
      segments("export-page-columns", t("pdf_export.page.columns"), [[1, "pdf_export.page.one_column"], [2, "pdf_export.page.two_column"]], textOf(profile).colonne, (value) => change(withText(profile, { colonne: value }))),
    ),
    row(
      t("pdf_export.page.margins"),
      segments("export-page-margins", t("pdf_export.page.margins"), [["stretti", "pdf_export.page.narrow"], ["normali", "pdf_export.page.normal"], ["larghi", "pdf_export.page.wide"]], marginPreset(page.margini), (value) => {
        say(null);
        change(withPage(profile, { margini: MARGIN_PRESETS[value] }));
      }),
    ),
  );

  // I quattro margini: mentre si scrive le pagine seguono un numero che
  // regge; a campo lasciato il numero si tiene dentro la pagina, e se è
  // cambiato la frase lo dice.
  const margins = document.createElement("div");
  margins.className = "export-mm";
  for (const side of MARGIN_SIDES) {
    const { field, input } = mmField(`export-page-margin-${side}`, SIDE_NAMES[side], MARGIN_LABELS[side], page.margini[side], MIN_MARGIN_MM, MAX_MARGIN_MM);
    const apply = (live: boolean) => {
      const typed = numberOf(input);
      if (typed === null) {
        if (!live) input.value = String(context.profile.pagina.margini[side]);
        return;
      }
      const now = context.profile.pagina;
      const wanted: Margins = { ...now.margini, [side]: typed };
      const margini = clampMargins(wanted, paperSize(now), side);
      if (!live) {
        say(margini[side] !== typed ? t("pdf_export.page.margin_fixed", { min: MIN_MARGIN_MM, max: MAX_MARGIN_MM, room: MIN_ROOM_MM, side: t(SIDE_NAMES[side]), value: decimal(margini[side], 1) }) : null);
      }
      change({ ...context.profile, pagina: { ...now, margini } }, live);
    };
    input.addEventListener("input", () => apply(true));
    input.addEventListener("change", () => apply(false));
    margins.append(field);
  }
  const guidesNote = document.createElement("p");
  guidesNote.className = "export-note";
  guidesNote.textContent = t("pdf_export.page.guides_note");

  const watermark = document.createElement("input");
  watermark.type = "text";
  watermark.className = "export-input";
  watermark.id = "export-page-watermark";
  watermark.maxLength = WATERMARK_MAX;
  watermark.value = page.filigrana.slice(0, WATERMARK_MAX);
  watermark.placeholder = t("pdf_export.page.watermark_placeholder");
  watermark.setAttribute("aria-label", t("pdf_export.page.watermark_label"));
  const setWatermark = (live: boolean) => {
    const filigrana = watermark.value.slice(0, WATERMARK_MAX);
    if (filigrana === context.profile.pagina.filigrana && live) return;
    change({ ...context.profile, pagina: { ...context.profile.pagina, filigrana } }, live);
  };
  watermark.addEventListener("input", () => setWatermark(true));
  watermark.addEventListener("change", () => setWatermark(false));

  body.append(
    margins,
    note,
    guidesNote,
    toggle("export-page-mirror", "pdf_export.page.mirror", "pdf_export.page.mirror_hint", page.specchio, () => change({ ...profile, pagina: { ...page, specchio: !page.specchio } })),
    row(t("pdf_export.page.watermark"), watermark),
  );
  return body;
}
