// Le proprietà della nota sotto il titolo (E28, T74; il prototipo `.pprops`,
// passo 29).
//
// La resa per la stampa non porta il frontmatter: le proprietà arrivano
// dall'indice (`noteProperties`), come al frontespizio. Tre scelte:
//
// - nessuna: la pagina comincia dal titolo e dal testo;
// - in evidenza: quelle che la testata della nota mostra senza aprire «Altre
//   proprietà», le prime quattro nell'ordine del file
//   (`featuredProperties`, `FEATURED_LIMIT`), senza le chiavi che la testata
//   disegna a modo suo (icona, copertina, classi) né le etichette;
// - tutte: ogni proprietà, etichette comprese, senza quelle chiavi.
//
// Le proprietà stanno in una riga che va a capo, col nome in grigio e il
// valore scritto per chi legge, fra due fili: un blocco che non si spezza.

import { resolvedLanguage, t } from "../../i18n/strings";
import type { ContentChanges } from "./changes";
import type { PropertiesChoice } from "./choices";

export interface NoteProperty {
  readonly key: string;
  readonly value: unknown;
}

export interface ShownProperty {
  readonly label: string;
  readonly value: string;
}

/// Le chiavi che la testata della nota disegna da sé (`PAGE_KEYS` in
/// `markdown/page/featured.ts`): non sono righe di proprietà.
const PAGE_KEYS = new Set(["icon", "cover", "cover-y", "cssclasses"]);
/// Le etichette: in evidenza le mostra la riga dei dati, non le proprietà.
const TAG_KEYS = new Set(["tags", "tag"]);
/// Quante proprietà stanno in evidenza (`FEATURED_LIMIT`).
export const FEATURED_PROPERTIES = 4;

/// Un valore del frontmatter scritto per chi legge: le liste con le virgole,
/// i link col nome della nota, le date per esteso, sì e no.
export function propertyText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) return value.map(propertyText).filter(Boolean).join(", ");
  if (typeof value === "boolean") return t(value ? "pdf_export.content.yes" : "pdf_export.content.no_value");
  if (typeof value === "number") return Number.isFinite(value) ? new Intl.NumberFormat(resolvedLanguage()).format(value) : "";
  if (typeof value !== "string") return "";
  const text = value.trim();
  const link = /^\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]+))?\]\]$/u.exec(text);
  if (link) return (link[2] ?? link[1]!.split("/").pop() ?? link[1]!).trim();
  const date = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(text);
  if (date) {
    const day = new Date(Date.UTC(Number(date[1]), Number(date[2]) - 1, Number(date[3])));
    if (!Number.isNaN(day.getTime()) && day.getUTCDate() === Number(date[3])) {
      return new Intl.DateTimeFormat(resolvedLanguage(), { dateStyle: "long", timeZone: "UTC" }).format(day);
    }
  }
  return text;
}

/// Le proprietà che escono con la scelta, nell'ordine del file. Una chiave
/// scritta due volte vale una volta, col valore dell'ultima, come la legge
/// YAML; una proprietà senza valore non è una riga.
export function shownProperties(entries: readonly NoteProperty[], choice: PropertiesChoice): ShownProperty[] {
  if (choice === "nessuna") return [];
  const last = new Map<string, unknown>();
  for (const { key, value } of entries) {
    last.delete(key);
    last.set(key, value);
  }
  // L'ordine è quello della prima volta che la chiave compare.
  const order = [...new Set(entries.map((entry) => entry.key))];
  const shown: ShownProperty[] = [];
  for (const key of order) {
    const lower = key.toLowerCase();
    if (PAGE_KEYS.has(lower) || (choice === "in-evidenza" && TAG_KEYS.has(lower))) continue;
    const value = propertyText(last.get(key));
    if (!value) continue;
    shown.push({ label: key, value });
    if (choice === "in-evidenza" && shown.length >= FEATURED_PROPERTIES) break;
  }
  return shown;
}

/// Mette le proprietà sotto il titolo della pagina di stampa (o in cima al
/// corpo, se il titolo non c'è).
export function applyProperties(page: HTMLElement, shown: readonly ShownProperty[], changes: ContentChanges): HTMLElement | null {
  if (shown.length === 0) return null;
  const block = document.createElement("div");
  block.className = "export-properties";
  block.setAttribute("role", "group");
  block.setAttribute("aria-label", t("pdf_export.content.properties_label"));
  const list = document.createElement("dl");
  for (const property of shown) {
    const row = document.createElement("div");
    const name = document.createElement("dt");
    name.textContent = property.label;
    const value = document.createElement("dd");
    value.textContent = property.value;
    row.append(name, value);
    list.append(row);
  }
  block.append(list);
  const title = page.querySelector(":scope > h1");
  if (title) title.after(block);
  else page.prepend(block);
  changes.add(block);
  return block;
}
