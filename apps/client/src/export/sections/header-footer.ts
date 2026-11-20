// La sezione «Testata e piè di pagina» dello spazio «Esporta in PDF», e la
// testata e il piè disegnati su ogni pagina (E28, T73; il prototipo `.px-hfp`,
// `.px-hfr`, `.px-hfs`, `.px-hfm`, `.px-hd`, `.px-ft`, passo 29).
//
// Sei posti: a sinistra, al centro e a destra, sopra e sotto. In ognuno:
// niente, il titolo della nota, la sezione corrente, la data, la pagina,
// «pagina di pagine», l'autore, il percorso nel vault, o un testo tuo. Nel
// pannello i sei posti stanno come sulla pagina, tre sopra e tre sotto una
// paginetta finta; un clic su un posto apre il menu delle voci. Un posto col
// testo tuo ha il suo campo, sotto. Poi tre interruttori: il filo sotto la
// testata, la prima pagina senza testata, i numeri romani per frontespizio e
// indice.
//
// Sulla pagina la testata sta nel margine alto e il piè nel margine basso:
// non tolgono spazio al testo, e cambiarli non rifà l'impaginazione. Nel PDF
// sono artefatti (`pdf_export/tags.rs`): il lettore di schermo li salta. Coi
// margini a specchio, nelle pagine pari sinistra e destra si scambiano.

import { resolvedLanguage, t, type Key } from "../../i18n/strings";
import { showContextMenu, type MenuItem } from "../../ui/menu";
import type { PageGeometry } from "../probe";
import type { HeaderSlot, ProfileHeaderFooter } from "../profile";
import type { Sheet } from "../paginate/toc";
import type { SectionContext } from "./index";

/// I sei posti, come li chiama il profilo (`testata.posti`), nell'ordine
/// della pagina: prima la testata, poi il piè.
export const SLOT_IDS = ["sopra-sinistra", "sopra-centro", "sopra-destra", "sotto-sinistra", "sotto-centro", "sotto-destra"] as const;
export type SlotId = (typeof SLOT_IDS)[number];

/// Le voci di un posto (`voce`), nell'ordine del menu; `""` è «Niente».
export const SLOT_VOICES = ["", "titolo", "sezione", "data", "pagina", "pagina-di-pagine", "autore", "percorso", "testo"] as const;

const PLACE: Readonly<Record<SlotId, Key>> = {
  "sopra-sinistra": "pdf_export.place.top_left",
  "sopra-centro": "pdf_export.place.top_center",
  "sopra-destra": "pdf_export.place.top_right",
  "sotto-sinistra": "pdf_export.place.bottom_left",
  "sotto-centro": "pdf_export.place.bottom_center",
  "sotto-destra": "pdf_export.place.bottom_right",
};

/// Il nome di una voce nel menu.
const MENU_NAME: Readonly<Record<string, Key>> = {
  "": "pdf_export.slot.none",
  titolo: "pdf_export.slot.title_long",
  sezione: "pdf_export.slot.section",
  data: "pdf_export.slot.date",
  pagina: "pdf_export.slot.page",
  "pagina-di-pagine": "pdf_export.slot.page_of",
  autore: "pdf_export.slot.author",
  percorso: "pdf_export.slot.path_long",
  testo: "pdf_export.slot.text_long",
};

/// Il nome di una voce sul suo posto, nel pannello.
const BUTTON_NAME: Readonly<Record<string, Key>> = {
  titolo: "pdf_export.slot.title",
  sezione: "pdf_export.slot.section",
  data: "pdf_export.slot.date",
  pagina: "pdf_export.slot.page",
  "pagina-di-pagine": "pdf_export.slot.page_of",
  autore: "pdf_export.slot.author",
  percorso: "pdf_export.slot.path",
  testo: "pdf_export.slot.text",
};

/// Il nome breve di una voce, per la testa della sezione chiusa («Titolo,
/// Pagina»). Una voce che questa versione non conosce si legge «Testo», come
/// la disegna la pagina (vuota).
export function slotShortName(voce: string): string {
  if (voce === "pagina-di-pagine") return t("pdf_export.slot.page");
  return t(BUTTON_NAME[voce] ?? "pdf_export.slot.text");
}

/// Il nome di un posto: «Testata, a sinistra».
export function placeName(slot: SlotId): string {
  return t(PLACE[slot]);
}

/// Ciò che la testata e il piè sanno della nota.
export interface PageFacts {
  readonly title: string;
  /// Il percorso nel vault, senza l'estensione.
  readonly path: string;
  readonly author: string;
  /// La data dell'esportazione, già scritta per esteso.
  readonly date: string;
}

/// La data di oggi come la scrive la testata: «19 novembre 2026».
export function longDate(now = new Date()): string {
  return new Intl.DateTimeFormat(resolvedLanguage(), { dateStyle: "long" }).format(now);
}

/// Il percorso di una nota come lo mostra la testata: le cartelle separate
/// da « / » e senza l'estensione del file.
export function displayPath(doc: string): string {
  return doc.replace(/\.[^./]+$/u, "").split("/").filter(Boolean).join(" / ");
}

/// Che cosa scrive un posto su un foglio. `section` è la sezione corrente
/// della pagina (vuota prima del primo titolo, e fuori dalla nota).
export function slotText(slot: HeaderSlot | undefined, facts: PageFacts, sheet: Sheet, section: string): string {
  switch (slot?.voce) {
    case "titolo":
      return facts.title;
    case "sezione":
      return section;
    case "data":
      return facts.date;
    case "pagina":
      return sheet.number;
    case "pagina-di-pagine":
      return sheet.number ? t("pdf_export.slot.page_of_value", { page: sheet.number, total: sheet.total }) : "";
    case "autore":
      return facts.author;
    case "percorso":
      return facts.path;
    case "testo":
      return slot.testo ?? "";
    default:
      return "";
  }
}

/// Disegna testata e piè di un foglio sulla sua pagina: tre celle sopra e tre
/// sotto, nei margini. `mirrored`: a specchio, sinistra e destra scambiate.
export function drawHeaderFooter(
  page: HTMLElement,
  geometry: PageGeometry,
  config: ProfileHeaderFooter,
  facts: PageFacts,
  sheet: Sheet,
  section: string,
  mirrored: boolean,
): void {
  const row = (kind: "header" | "footer", slots: readonly SlotId[]): HTMLElement => {
    const band = document.createElement("div");
    band.className = `export-${kind}`;
    band.style.left = `${mirrored ? geometry.margin.right : geometry.margin.left}px`;
    band.style.right = `${mirrored ? geometry.margin.left : geometry.margin.right}px`;
    if (kind === "header") band.style.top = `${geometry.margin.top * 0.44}px`;
    else band.style.bottom = `${geometry.margin.bottom * 0.4}px`;
    const order = mirrored ? [slots[2], slots[1], slots[0]] : slots;
    for (const slot of order) {
      const cell = document.createElement("span");
      cell.className = "export-header-cell";
      cell.textContent = slotText(config.posti[slot], facts, sheet, section);
      band.append(cell);
    }
    return band;
  };
  if (sheet.header) {
    const header = row("header", SLOT_IDS.slice(0, 3));
    const filled = SLOT_IDS.slice(0, 3).some((slot) => (config.posti[slot]?.voce ?? "") !== "");
    header.classList.toggle("has-rule", config.filo && filled);
    page.append(header);
  }
  if (sheet.footer) page.append(row("footer", SLOT_IDS.slice(3)));
}

// ── I controlli del pannello ────────────────────────────────────────────────

/// Un interruttore del pannello (il prototipo `.px-tog`): la scritta, una
/// riga che spiega sotto (facoltativa) e il pallino.
export function sectionToggle(id: string, label: Key, hint: Key | null, on: boolean, flip: () => void): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "export-toggle";
  button.id = id;
  button.setAttribute("role", "switch");
  button.setAttribute("aria-checked", String(on));
  const text = document.createElement("span");
  text.className = "export-toggle-text";
  text.textContent = t(label);
  if (hint) {
    const small = document.createElement("small");
    small.className = "export-toggle-hint";
    small.textContent = t(hint);
    text.append(small);
  }
  const knob = document.createElement("i");
  knob.className = "export-toggle-knob";
  knob.setAttribute("aria-hidden", "true");
  button.append(text, knob);
  button.addEventListener("click", flip);
  return button;
}

function slotButton(slot: SlotId, value: HeaderSlot | undefined, open: (slot: SlotId, anchor: HTMLElement) => void): HTMLButtonElement {
  const voce = value?.voce ?? "";
  const button = document.createElement("button");
  button.type = "button";
  button.className = "export-slot-choice";
  button.id = `export-header-${slot}`;
  button.dataset["slot"] = slot;
  button.classList.toggle("is-set", voce !== "");
  button.setAttribute("aria-haspopup", "menu");
  const own = voce === "testo" ? (value?.testo ?? "").trim() : "";
  const shown = voce === "" ? "+" : own || t(BUTTON_NAME[voce] ?? "pdf_export.slot.text");
  button.textContent = shown;
  button.setAttribute("aria-label", t("pdf_export.slot.choice", { place: placeName(slot), value: t(MENU_NAME[voce] ?? "pdf_export.slot.text_long") }));
  button.title = voce === "" ? placeName(slot) : `${placeName(slot)}: ${shown}`;
  button.addEventListener("click", () => open(slot, button));
  return button;
}

/// Il profilo con un posto cambiato: `""` lo svuota (il posto non c'è più
/// nel file, come vuole il formato).
export function withSlot(config: ProfileHeaderFooter, slot: SlotId, value: HeaderSlot | null): ProfileHeaderFooter {
  const posti: Record<string, HeaderSlot> = { ...config.posti };
  if (value === null || value.voce === "") delete posti[slot];
  else posti[slot] = value;
  return { ...config, posti };
}

export function headerFooterBody(context: SectionContext): HTMLElement {
  const body = document.createElement("div");
  body.className = "export-header-section";
  const config = context.profile.testata;

  const change = (next: ProfileHeaderFooter, live = false) => context.change({ ...context.profile, testata: next }, { live });

  const open = (slot: SlotId, anchor: HTMLElement) => {
    const current = context.profile.testata.posti[slot];
    const items: MenuItem[] = SLOT_VOICES.map((voce) => ({
      label: t(MENU_NAME[voce]),
      choice: "radio",
      checked: (current?.voce ?? "") === voce,
      run: () => {
        if ((current?.voce ?? "") === voce) return;
        const value: HeaderSlot | null = voce === "" ? null : voce === "testo" ? { voce, testo: current?.testo ?? "" } : { voce };
        change(withSlot(context.profile.testata, slot, value));
        // Il testo tuo si scrive subito, nel suo campo.
        const target = voce === "testo" ? `export-header-text-${slot}` : `export-header-${slot}`;
        document.getElementById(target)?.focus({ preventScroll: true });
      },
    }));
    showContextMenu(anchor, items, { label: placeName(slot) });
  };

  const sheet = document.createElement("div");
  sheet.className = "export-header-grid";
  sheet.setAttribute("role", "group");
  sheet.setAttribute("aria-label", t("pdf_export.header.group"));
  const top = document.createElement("div");
  top.className = "export-header-row";
  const bottom = document.createElement("div");
  bottom.className = "export-header-row";
  for (const slot of SLOT_IDS.slice(0, 3)) top.append(slotButton(slot, config.posti[slot], open));
  for (const slot of SLOT_IDS.slice(3)) bottom.append(slotButton(slot, config.posti[slot], open));
  // La paginetta fra testata e piè: quattro righe di testo finto.
  const lines = document.createElement("div");
  lines.className = "export-header-lines";
  lines.setAttribute("aria-hidden", "true");
  for (const short of [false, false, false, true]) {
    const line = document.createElement("i");
    line.className = short ? "export-header-line export-header-line-short" : "export-header-line";
    lines.append(line);
  }
  sheet.append(top, lines, bottom);

  const note = document.createElement("p");
  note.className = "export-note";
  note.textContent = t("pdf_export.header.note");
  body.append(sheet, note);

  // Un campo per ogni posto col testo tuo: si vede mentre si scrive, si
  // salva a fine gesto.
  for (const slot of SLOT_IDS) {
    const value = config.posti[slot];
    if (value?.voce !== "testo") continue;
    const label = document.createElement("label");
    label.className = "export-row";
    const name = document.createElement("span");
    name.className = "export-row-label";
    name.textContent = placeName(slot);
    const input = document.createElement("input");
    input.type = "text";
    input.className = "export-input";
    input.id = `export-header-text-${slot}`;
    input.value = value.testo ?? "";
    input.maxLength = 80;
    input.spellcheck = false;
    input.placeholder = t("pdf_export.header.text_placeholder");
    input.setAttribute("aria-label", t("pdf_export.header.text_label", { place: placeName(slot) }));
    const write = (live: boolean) => change(withSlot(context.profile.testata, slot, { voce: "testo", testo: input.value }), live);
    input.addEventListener("input", () => write(true));
    input.addEventListener("change", () => write(false));
    label.append(name, input);
    body.append(label);
  }

  const flip = (key: "filo" | "prima_pagina_senza" | "numeri_romani") => () => change({ ...context.profile.testata, [key]: !context.profile.testata[key] });
  body.append(
    sectionToggle("export-header-rule", "pdf_export.header.rule", null, config.filo, flip("filo")),
    sectionToggle("export-header-first", "pdf_export.header.first", null, config.prima_pagina_senza, flip("prima_pagina_senza")),
    sectionToggle("export-header-roman", "pdf_export.header.roman", "pdf_export.header.roman_hint", config.numeri_romani, flip("numeri_romani")),
  );
  return body;
}
