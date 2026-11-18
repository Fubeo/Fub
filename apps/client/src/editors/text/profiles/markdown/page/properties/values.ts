// Ciò che righe, editor e menu delle proprietà (T8) hanno in comune: chi li
// ospita, l'impronta di una voce e come si disegna un valore.
import type { PropertyType } from "../../../../../../host/enums.generated";
import { resolvedLanguage } from "../../../../../../i18n/strings";
import { iconEl } from "../../../../../../ui/icons";
import type { PropertyEntry, PropertyWrite } from "../../properties";
import { liveStrings } from "../../strings";
import { avatarTone, initials, linkName, type OptionColor, type OptionGroup, type PropertyKind, type PropertyTypes, type RelationTarget } from "./kind";

/// Com'è andata una scrittura: scritta; rifiutata perché il valore è cambiato
/// da quando l'editor si è aperto (`conflict`); non scritta per un'altra
/// ragione (sola lettura, una voce che la testata non sa riscrivere: lo YAML
/// si apre su di lei).
export type WriteOutcome = "written" | "conflict" | "refused";

/// Un'opzione da aggiungere al registro: il nome, il colore e, per lo Stato,
/// il gruppo (`null` per una Selezione).
export interface NewOption {
  readonly name: string;
  readonly color: OptionColor;
  readonly group: OptionGroup | null;
}

/// Una nota che l'editor della Relazione propone: il documento e il link che
/// il valore scrive (`[[Libri/Dune]]`).
export interface RelationNote {
  readonly doc: string;
  readonly link: string;
}

/// Le note di una Relazione (T35), da chi ospita la testata: cercarle dentro
/// il bersaglio, crearne una che non c'è, aprirne una dal suo link.
export interface RelationPort {
  /// Le note del bersaglio (ogni nota, senza) il cui nome combacia con
  /// `text`, dalla più pertinente; con `text` vuoto, le prime.
  search(text: string, target: RelationTarget | null): Promise<RelationNote[]>;
  /// Crea la nota `name` nel bersaglio (del tipo, o nella cartella): la nota
  /// creata, o `null` se il comando non dice quale. Senza, l'editor non offre
  /// «Crea».
  create?(name: string, target: RelationTarget | null): Promise<RelationNote | null>;
  /// Apre la nota del link `[[…]]`, risolto dalla nota che lo scrive.
  open(link: string): void;
}

/// Ciò che le righe chiedono a chi ospita la testata.
export interface PropertyRowHost {
  /// Si scrive: nome e valore si premono.
  readonly editable: boolean;
  /// Il registro dei tipi del vault.
  readonly types: PropertyTypes;
  /// Scrive (o toglie, con `null`) la proprietà, con un passo d'annullamento
  /// suo, se vale ancora `expected` (`entryStamp`): se no non scrive e dice
  /// `conflict`.
  write(key: string, value: PropertyWrite | null, expected: string | null): WriteOutcome;
  /// La voce di `key` adesso, nel testo.
  current(key: string): PropertyEntry | undefined;
  /// Rinomina la chiave nella nota: `null` se è andata, se no il perché no.
  renameKey(key: string, name: string): string | null;
  /// «Metti in evidenza» (`true`) o «Togli dall'evidenza».
  feature(key: string, on: boolean): void;
  /// Dichiara il tipo nel registro del vault: `null` se è andata, se no il
  /// perché no. Senza, il menu non offre «Tipo».
  setType?(key: string, type: PropertyType): Promise<string | null>;
  /// Aggiunge un'opzione di Selezione o di Stato nel registro del vault
  /// (`property.option.set`): `null` se è andata, se no il perché no. Senza,
  /// l'editor delle opzioni sceglie soltanto fra quelle che ci sono.
  addOption?(key: string, option: NewOption): Promise<string | null>;
  /// Le persone (le note della cartella delle persone, o le note) il cui nome
  /// combacia con `text`. Senza, l'editor delle persone cerca fra quelle che
  /// la proprietà ha già.
  searchPeople?(text: string): Promise<string[]>;
  /// Le note delle Relazioni. Senza, l'editor della Relazione cerca fra i
  /// link che la proprietà ha già, e un nome non si apre.
  readonly relations?: RelationPort;
  /// Il valore di `tipo` premuto: «Scegli il tipo» sotto `anchor`, che dà
  /// alla nota anche le proprietà del tipo. Senza, `tipo` si sceglie come
  /// ogni Relazione.
  chooseType?(anchor: HTMLElement): void;
  notify?(message: string, tone: "info" | "guasto"): void;
  /// Un editor o un menu si è aperto o chiuso: chi ospita non rifà la testata
  /// sotto le mani di chi scrive, e la rifà alla chiusura.
  editing(open: boolean): void;
  /// Il valore di una voce che la testata non sa riscrivere: lo YAML si apre
  /// su di lei.
  open(at: number): void;
}

/// L'impronta di una voce: cambia quando cambia ciò che dice. Un editor la
/// prende quando si apre e la porta alla scrittura.
export function entryStamp(entry: PropertyEntry | undefined): string | null {
  return entry ? JSON.stringify([entry.value, entry.items, entry.quoted]) : null;
}

/// Il nome di un tipo, nella lingua dell'interfaccia.
export function typeName(type: PropertyType | PropertyKind): string {
  return liveStrings.t(`page.properties.type.${type}` as Parameters<typeof liveStrings.t>[0]);
}

/// Il valore di una data come si legge: «20 marzo 2026», con l'ora se c'è.
export function longDate(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/.exec(value.trim());
  if (!match) return value;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(match[4] ?? 0), Number(match[5] ?? 0));
  if (Number.isNaN(date.getTime())) return value;
  const language = resolvedLanguage();
  const day = new Intl.DateTimeFormat(language, { day: "numeric", month: "long", year: "numeric" }).format(date);
  if (match[4] === undefined) return day;
  return `${day}, ${new Intl.DateTimeFormat(language, { hour: "2-digit", minute: "2-digit" }).format(date)}`;
}

export function figure(name: string): SVGElement | null {
  const svg = iconEl(name);
  svg?.setAttribute("aria-hidden", "true");
  return svg;
}

/// Una pastiglia di una voce d'elenco (o di un'etichetta).
export function chipElement(text: string, kind: "list" | "tags"): HTMLElement {
  const chip = document.createElement("span");
  chip.className = kind === "tags" ? "cm-fub-prop-chip cm-fub-prop-tag" : "cm-fub-prop-chip";
  chip.textContent = kind === "tags" ? `#${text.replace(/^#/, "")}` : text;
  return chip;
}

/// Un'opzione di Selezione o di Stato: la pastiglia del suo colore; lo Stato
/// ha davanti il pallino.
export function optionElement(name: string, color: OptionColor, status: boolean): HTMLElement {
  const pill = document.createElement("span");
  pill.className = "cm-fub-prop-opt";
  pill.dataset.color = color;
  if (status) pill.dataset.status = "";
  pill.textContent = name;
  return pill;
}

/// Le voci di una Relazione: un elenco, o il link solo.
export function relationItems(entry: PropertyEntry | undefined): string[] {
  if (!entry) return [];
  if (entry.items) return [...entry.items];
  const value = entry.value.trim();
  return value === "" ? [] : [value];
}

/// Una voce di una Relazione come si legge: il nome della nota (l'alias, se
/// il link ne scrive uno), sottolineato come un link della pagina. Dentro un
/// valore che è già un pulsante (la riga che si scrive) è un testo, che il
/// clic apre; altrove (Lettura, sola lettura) è un link vero, col fuoco. Una
/// voce che non è un link resta testo.
export function relationElement(item: string, inside: "button" | "page"): HTMLElement {
  if (!/^\[\[[^[\]]+\]\]$/.test(item.trim())) {
    const text = document.createElement("span");
    text.className = "cm-fub-prop-rel-text";
    text.textContent = item;
    return text;
  }
  const link = document.createElement(inside === "button" ? "span" : "a");
  link.className = "cm-fub-prop-rel";
  link.dataset.link = item.trim();
  link.textContent = linkName(item);
  if (link instanceof HTMLAnchorElement) {
    link.href = "#";
    link.title = item.trim();
  }
  return link;
}

/// Una persona: il tondo con le iniziali e il nome.
export function personElement(item: string): HTMLElement {
  const name = linkName(item);
  const person = document.createElement("span");
  person.className = "cm-fub-prop-person";
  const avatar = document.createElement("span");
  avatar.className = "cm-fub-prop-avatar";
  avatar.dataset.tone = avatarTone(name);
  avatar.setAttribute("aria-hidden", "true");
  avatar.textContent = initials(name);
  const label = document.createElement("span");
  label.textContent = name;
  person.append(avatar, label);
  return person;
}
