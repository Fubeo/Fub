// Le sezioni «Contenuto» e «Interruzioni di pagina» dello spazio «Esporta in
// PDF» (E28, T74; il prototipo, passo 29: `pxRow`, `pxSeg`, `pxTog`).
//
// Contenuto: una riga per specie di blocco, col nome a sinistra e le scelte a
// destra (proprietà, commenti, link, compiti fatti, ripiegabili, schede vive,
// tabelle), poi l'interruttore del codice numerato. Che cosa fa ogni scelta
// sulla resa lo dice `export/content/`.
//
// Interruzioni: tre interruttori (ogni Titolo 2, il separatore, le
// intestazioni delle tabelle lunghe) e la nota su ciò che vale sempre.
//
// Ogni controllo ha un `id` stabile: il pannello si ridisegna dopo un gesto
// e il fuoco torna sul controllo che l'aveva.

import { t, type Key } from "../../i18n/strings";
import {
  CARDS_CHOICES,
  COMMENTS_CHOICES,
  contentChoicesOf,
  FOLDS_CHOICES,
  LINKS_CHOICES,
  PROPERTIES_CHOICES,
  TABLES_CHOICES,
} from "../content/choices";
import type { ExportProfile, ProfileBreaks, ProfileContent } from "../profile";
import type { SectionContext } from "./index";

/// Un interruttore del pannello (il prototipo `pxTog`), come quelli dei Colori.
function toggle(id: string, label: Key, hint: Key | null, on: boolean, flip: () => void): HTMLButtonElement {
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

/// Una riga con il nome e le scelte (il prototipo `pxRow` con `pxSeg`): un
/// gruppo di radio, le frecce passano da una scelta all'altra.
export function choiceRow<T extends string>(id: string, label: Key, choices: readonly (readonly [T, Key])[], chosen: T, pick: (value: T) => void): HTMLElement {
  const row = document.createElement("div");
  row.className = "export-row";
  row.dataset["row"] = id;
  const name = document.createElement("span");
  name.className = "export-row-label";
  name.id = `${id}-label`;
  name.textContent = t(label);
  const group = document.createElement("div");
  group.className = "export-choices";
  group.setAttribute("role", "radiogroup");
  group.setAttribute("aria-labelledby", name.id);
  const buttons = choices.map(([value, key]) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "export-choice";
    button.id = `${id}-${value}`;
    button.setAttribute("role", "radio");
    button.setAttribute("aria-checked", String(value === chosen));
    button.tabIndex = value === chosen ? 0 : -1;
    button.textContent = t(key);
    button.addEventListener("click", () => {
      if (value !== chosen) pick(value);
    });
    return button;
  });
  group.append(...buttons);
  group.addEventListener("keydown", (event) => {
    const step = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 0;
    if (step === 0) return;
    event.preventDefault();
    const at = Math.max(0, choices.findIndex(([value]) => value === chosen));
    const next = choices[(at + step + choices.length) % choices.length]![0];
    pick(next);
    document.getElementById(`${id}-${next}`)?.focus({ preventScroll: true });
  });
  row.append(name, group);
  return row;
}

/// Il nome di ogni scelta, nell'ordine dell'elenco di `choices.ts`.
function named<T extends string>(values: readonly T[], keys: Readonly<Record<T, Key>>): (readonly [T, Key])[] {
  return values.map((value) => [value, keys[value]] as const);
}

const PROPERTIES_NAMES = named(PROPERTIES_CHOICES, { nessuna: "pdf_export.content.properties.none", "in-evidenza": "pdf_export.content.properties.featured", tutte: "pdf_export.content.properties.all" });
const COMMENTS_NAMES = named(COMMENTS_CHOICES, { no: "pdf_export.content.comments.none", margine: "pdf_export.content.comments.margin", "in-fondo": "pdf_export.content.comments.end" });
const LINKS_NAMES = named(LINKS_CHOICES, { colorati: "pdf_export.content.links.colored", sottolineati: "pdf_export.content.links.underlined", "come-il-testo": "pdf_export.content.links.text" });
const FOLDS_NAMES = named(FOLDS_CHOICES, { aperti: "pdf_export.content.folds.open", chiusi: "pdf_export.content.folds.closed" });
const CARDS_NAMES = named(CARDS_CHOICES, { anteprima: "pdf_export.content.cards.preview", "solo-nome": "pdf_export.content.cards.name", "pagine-in-coda": "pdf_export.content.cards.pages" });
const TABLES_NAMES = named(TABLES_CHOICES, { linee: "pdf_export.content.tables.lines", "righe-alterne": "pdf_export.content.tables.stripes", griglia: "pdf_export.content.tables.grid" });
const DONE_NAMES: (readonly ["mostra" | "togli", Key])[] = [
  ["mostra", "pdf_export.content.done.show"],
  ["togli", "pdf_export.content.done.remove"],
];

export function contentBody(context: SectionContext): HTMLElement {
  const body = document.createElement("div");
  body.className = "export-content-section";
  const choices = contentChoicesOf(context.profile.contenuto);
  const set = (next: Partial<ProfileContent>) => context.change({ ...context.profile, contenuto: { ...context.profile.contenuto, ...next } });
  body.append(
    choiceRow("export-content-properties", "pdf_export.content.properties", PROPERTIES_NAMES, choices.properties, (proprieta) => set({ proprieta })),
    choiceRow("export-content-comments", "pdf_export.content.comments_row", COMMENTS_NAMES, choices.comments, (commenti) => set({ commenti })),
    choiceRow("export-content-links", "pdf_export.content.links", LINKS_NAMES, choices.links, (link) => set({ link })),
    choiceRow("export-content-done", "pdf_export.content.done", DONE_NAMES, choices.doneTasks ? "mostra" : "togli", (value) => set({ compiti_fatti: value === "mostra" })),
    choiceRow("export-content-folds", "pdf_export.content.folds", FOLDS_NAMES, choices.folds, (ripiegabili) => set({ ripiegabili })),
    choiceRow("export-content-cards", "pdf_export.content.cards", CARDS_NAMES, choices.cards, (schede) => set({ schede })),
    choiceRow("export-content-tables", "pdf_export.content.tables", TABLES_NAMES, choices.tables, (tabelle) => set({ tabelle })),
    toggle("export-content-code", "pdf_export.content.code", null, choices.codeNumbers, () => set({ codice_numerato: !contentChoicesOf(context.profile.contenuto).codeNumbers })),
  );
  return body;
}

export function breaksBody(context: SectionContext): HTMLElement {
  const body = document.createElement("div");
  body.className = "export-content-section";
  const breaks = context.profile.interruzioni;
  const flip = (key: keyof ProfileBreaks) => () => {
    const now: ExportProfile = context.profile;
    context.change({ ...now, interruzioni: { ...now.interruzioni, [key]: !now.interruzioni[key] } });
  };
  const always = document.createElement("p");
  always.className = "export-note";
  always.textContent = t("pdf_export.breaks.always");
  body.append(
    toggle("export-breaks-heading2", "pdf_export.breaks.heading2_toggle", null, breaks.ogni_titolo_2, flip("ogni_titolo_2")),
    toggle("export-breaks-separator", "pdf_export.breaks.separator", "pdf_export.breaks.separator_hint", breaks.separatore, flip("separatore")),
    toggle("export-breaks-header", "pdf_export.breaks.repeat_header", "pdf_export.breaks.repeat_header_hint", breaks.ripeti_intestazione, flip("ripeti_intestazione")),
    always,
  );
  return body;
}
