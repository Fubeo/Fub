// La sezione «Frontespizio e indice» dello spazio «Esporta in PDF», e le due
// specie di pagina che aggiunge (E28, T73; il prototipo `.pcover`, `.ptoc`,
// passo 29).
//
// - Il frontespizio: una pagina col filo d'accento sul bordo, l'icona della
//   nota, il titolo grande, le proprietà in evidenza in una riga, e in fondo
//   chi (l'autore della nota, se lo dice) e quando (il giorno
//   dell'esportazione). Col frontespizio il titolo non apre più la prima
//   pagina della nota: sta qui.
// - L'indice: «Indice» e una riga per titolo, fino ai Titoli 2 o anche ai 3,
//   coi puntini e il numero della pagina vero. I numeri li calcola
//   `paginate/toc.ts` in due passate; finché l'impaginatore non ha finito
//   l'indice dice «…». Una nota senza titoli non ha indice.
// - I segnalibri nel PDF: i titoli nel pannello laterale del lettore; li
//   scrive lo scrittore (`pdf_export/outline.rs`), la banda li conta.

import { resolvedLanguage, t, type Key } from "../../i18n/strings";
import { drawPageMark, pageMarkValue } from "../../ui/page-mark";
import type { TocEntry } from "../paginate/toc";
import type { PageFacts } from "./header-footer";
import { sectionToggle } from "./header-footer";
import type { SectionContext } from "./index";

/// Una proprietà del frontespizio, già scritta per chi legge.
export interface CoverProperty {
  readonly label: string;
  readonly value: string;
}

/// Ciò che il frontespizio sa della nota, oltre alla testata.
export interface CoverFacts extends PageFacts {
  /// Il valore dell'icona (`icon:` del frontmatter), se la nota ne ha una.
  readonly icon: string | null;
  readonly properties: readonly CoverProperty[];
}

/// Le chiavi dell'autore, come le legge lo scrittore del PDF
/// (`dati_della_nota` in `pdf_export/lavoro.rs`).
const AUTHOR_KEYS = ["author", "autore", "authors", "autori"];

/// Le chiavi che il frontespizio non mostra fra le proprietà: quelle che la
/// testata della nota disegna a modo suo (`PAGE_KEYS` e `FACT_KEYS` in
/// `markdown/page/featured.ts`), il tipo, il titolo e l'autore, che il
/// frontespizio dice già.
const NOT_SHOWN = new Set(["icon", "cover", "cover-y", "cssclasses", "tags", "tag", "tipo", "title", "titolo", "aliases", "alias", ...AUTHOR_KEYS]);

/// Quante proprietà stanno in evidenza (`FEATURED_LIMIT` della testata).
const FEATURED = 4;

/// Un valore del frontmatter scritto per chi legge: le liste con le virgole,
/// i link col nome della nota, le date per esteso.
export function propertyText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) return value.map(propertyText).filter(Boolean).join(", ");
  if (typeof value === "boolean") return t(value ? "pdf_export.cover.yes" : "pdf_export.cover.no");
  if (typeof value === "number") return Number.isFinite(value) ? new Intl.NumberFormat(resolvedLanguage()).format(value) : "";
  if (typeof value !== "string") return "";
  const text = value.trim();
  const link = /^\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]+))?\]\]$/u.exec(text);
  if (link) return (link[2] ?? link[1].split("/").pop() ?? link[1]).trim();
  const date = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(text);
  if (date) {
    const day = new Date(Date.UTC(Number(date[1]), Number(date[2]) - 1, Number(date[3])));
    if (!Number.isNaN(day.getTime()) && day.getUTCDate() === Number(date[3])) {
      return new Intl.DateTimeFormat(resolvedLanguage(), { dateStyle: "long", timeZone: "UTC" }).format(day);
    }
  }
  return text;
}

/// Dal frontmatter della nota: l'icona, l'autore e le proprietà in evidenza
/// (le prime quattro che il frontespizio può mostrare, nell'ordine del file).
export function coverFactsOf(properties: readonly { readonly key: string; readonly value: unknown }[]): { icon: string | null; author: string; properties: CoverProperty[] } {
  const last = new Map<string, unknown>();
  for (const { key, value } of properties) last.set(key, value);
  const author = AUTHOR_KEYS.map((key) => propertyText(last.get(key))).find((text) => text !== "") ?? "";
  const shown: CoverProperty[] = [];
  for (const [key, value] of last) {
    if (shown.length >= FEATURED) break;
    if (NOT_SHOWN.has(key.toLowerCase())) continue;
    const text = propertyText(value);
    if (text) shown.push({ label: key, value: text });
  }
  return { icon: pageMarkValue(last.get("icon")), author, properties: shown };
}

/// Il frontespizio, nel corpo della pagina (fra i margini). `margin` serve
/// al filo d'accento, che va fino al bordo del foglio.
export function drawCover(body: HTMLElement, facts: CoverFacts, margin: { readonly top: number; readonly bottom: number; readonly left: number }): void {
  const cover = document.createElement("div");
  cover.className = "export-cover";
  const band = document.createElement("div");
  band.className = "export-cover-band";
  band.style.left = `${-margin.left}px`;
  band.style.top = `${-margin.top}px`;
  band.style.bottom = `${-margin.bottom}px`;
  cover.append(band);
  if (facts.icon) {
    const icon = document.createElement("div");
    icon.className = "export-cover-icon";
    if (drawPageMark(icon, facts.icon)) cover.append(icon);
  }
  const title = document.createElement("h1");
  title.className = "export-cover-title";
  title.textContent = facts.title;
  cover.append(title);
  if (facts.properties.length > 0) {
    const line = document.createElement("p");
    line.className = "export-cover-properties";
    line.textContent = facts.properties.map((property) => `${property.label}: ${property.value}`).join(" · ");
    cover.append(line);
  }
  const foot = document.createElement("div");
  foot.className = "export-cover-foot";
  if (facts.author) {
    const who = document.createElement("b");
    who.textContent = facts.author;
    foot.append(who);
  }
  const when = document.createElement("span");
  when.textContent = facts.date;
  foot.append(when);
  cover.append(foot);
  body.append(cover);
}

/// Una pagina dell'indice: il titolo sulla prima, poi le sue voci. `depth`
/// è il livello più alto fra le voci: le altre rientrano.
export function drawTocPage(body: HTMLElement, entries: readonly TocEntry[], first: boolean): HTMLElement {
  const toc = document.createElement("div");
  toc.className = "export-toc";
  toc.setAttribute("role", "list");
  if (first) {
    const title = document.createElement("div");
    title.className = "export-toc-title";
    title.textContent = t("pdf_export.toc.title");
    toc.append(title);
  }
  const top = entries.reduce((min, entry) => Math.min(min, entry.level), 6);
  for (const entry of entries) toc.append(tocRow(entry, entry.level - top));
  body.append(toc);
  return toc;
}

function tocRow(entry: TocEntry, depth: number): HTMLElement {
  const row = document.createElement("div");
  row.className = "export-toc-row";
  row.setAttribute("role", "listitem");
  row.dataset["depth"] = String(Math.min(2, depth));
  row.dataset["heading"] = entry.id;
  const name = document.createElement("span");
  name.className = "export-toc-name";
  if (entry.number) {
    const number = document.createElement("em");
    number.className = "export-toc-number";
    number.textContent = entry.number;
    name.append(number);
  }
  name.append(entry.text);
  const dots = document.createElement("i");
  dots.className = "export-toc-dots";
  dots.setAttribute("aria-hidden", "true");
  const page = document.createElement("b");
  page.className = "export-toc-page";
  page.textContent = entry.page;
  row.append(name, dots, page);
  return row;
}

/// Il nome di un livello dell'indice, per «Fin dove».
const DEPTHS: readonly [number, Key][] = [
  [2, "pdf_export.front.depth2"],
  [3, "pdf_export.front.depth3"],
];

export function coverTocBody(context: SectionContext): HTMLElement {
  const body = document.createElement("div");
  body.className = "export-front-section";
  const front = context.profile.frontespizio;
  const set = (next: Partial<typeof front>) => context.change({ ...context.profile, frontespizio: { ...context.profile.frontespizio, ...next } });

  body.append(
    sectionToggle("export-front-cover", "pdf_export.front.cover_toggle", "pdf_export.front.cover_hint", front.frontespizio, () => set({ frontespizio: !context.profile.frontespizio.frontespizio })),
    sectionToggle("export-front-toc", "pdf_export.front.toc_toggle", "pdf_export.front.toc_hint", front.indice, () => set({ indice: !context.profile.frontespizio.indice })),
  );
  if (front.indice) {
    const row = document.createElement("div");
    row.className = "export-row";
    const label = document.createElement("span");
    label.className = "export-row-label";
    label.id = "export-front-depth-label";
    label.textContent = t("pdf_export.front.depth");
    const group = document.createElement("div");
    group.className = "export-choices";
    group.setAttribute("role", "radiogroup");
    group.setAttribute("aria-labelledby", label.id);
    const chosen = front.profondita_indice >= 3 ? 3 : 2;
    for (const [depth, key] of DEPTHS) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "export-choice";
      button.id = `export-front-depth-${depth}`;
      button.setAttribute("role", "radio");
      button.setAttribute("aria-checked", String(depth === chosen));
      button.tabIndex = depth === chosen ? 0 : -1;
      button.textContent = t(key);
      button.addEventListener("click", () => {
        if (depth !== chosen) set({ profondita_indice: depth });
      });
      group.append(button);
    }
    // Le frecce passano da una scelta all'altra, come in un gruppo di radio.
    group.addEventListener("keydown", (event) => {
      if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
      event.preventDefault();
      set({ profondita_indice: chosen === 3 ? 2 : 3 });
      document.getElementById(`export-front-depth-${chosen === 3 ? 2 : 3}`)?.focus({ preventScroll: true });
    });
    row.append(label, group);
    body.append(row);
  }
  body.append(
    sectionToggle("export-front-bookmarks", "pdf_export.front.bookmarks", "pdf_export.front.bookmarks_hint", front.segnalibri, () => set({ segnalibri: !context.profile.frontespizio.segnalibri })),
  );
  return body;
}
