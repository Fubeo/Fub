// Le proprietà della testata (E3): quali stanno in evidenza e come si
// disegnano. Senza tipo, le prime quattro del frontmatter; le altre stanno
// dietro «Altre N proprietà». Le chiavi che la testata mostra a modo suo
// (icona, copertina, classi della pagina) non sono righe, e nemmeno le
// etichette quando le mostra la riga dei dati, come nel prototipo. Il valore
// si disegna secondo il tipo, e un clic apre l'editor del tipo; un clic sul
// nome apre il menu della proprietà (`properties/`, T8).
import { t } from "../../../../../i18n/strings";
import { iconEl } from "../../../../../ui/icons";
import type { Lifetime } from "../../../../../ui/lifetime";
import type { PropertyEntry } from "../properties";
import { liveStrings } from "../strings";
import type { PropertyTypes } from "./properties/kind";
import { propertyRow, type PropertyRowHost } from "./properties/row";

/// Quante proprietà stanno in evidenza in una nota senza tipo.
export const FEATURED_LIMIT = 4;

/// Le chiavi che la testata disegna da sé: icona, copertina e la sua
/// posizione, le classi della pagina (il menu «…»).
export const PAGE_KEYS: ReadonlySet<string> = new Set(["icon", "cover", "cover-y", "cssclasses"]);

/// Le etichette: le mostra la riga dei dati, che le legge dall'indice.
export const FACT_KEYS: ReadonlySet<string> = new Set(["tags", "tag"]);

export interface FeaturedSplit {
  readonly featured: readonly PropertyEntry[];
  readonly rest: readonly PropertyEntry[];
}

/// Le voci del frontmatter divise fra quelle in evidenza e le altre, ognuna
/// nell'ordine del file. Una chiave scritta due volte è una riga sola, col
/// valore dell'ultima, come la legge YAML. Le etichette restano fuori solo
/// se la riga dei dati le mostra (`factTags`): finché l'indice non risponde,
/// o senza riga dei dati, `tags:` è una proprietà come le altre.
export function featuredProperties(entries: readonly PropertyEntry[], factTags = true): FeaturedSplit {
  const featured: PropertyEntry[] = [];
  const rest: PropertyEntry[] = [];
  const last = new Map<string, PropertyEntry>();
  for (const entry of entries) last.set(entry.key, entry);
  for (const entry of entries) {
    if (last.get(entry.key) !== entry) continue;
    if (PAGE_KEYS.has(entry.key) || (factTags && FACT_KEYS.has(entry.key))) continue;
    if (featured.length < FEATURED_LIMIT) featured.push(entry);
    else rest.push(entry);
  }
  return { featured, rest };
}

/// Le proprietà come la testata le mostra.
export interface PageProperties {
  /// `visible`: quelle in evidenza e «Altre N»; `hidden`: soltanto «Altre N».
  readonly display: "visible" | "hidden";
  readonly featured: readonly PropertyEntry[];
  readonly rest: readonly PropertyEntry[];
  /// Il frontmatter ha righe che YAML non legge: resta com'è scritto, e la
  /// testata lo dice invece di mostrare righe a metà.
  readonly unreadable: boolean;
  /// Lo YAML è aperto in Scrittura (il cursore ci è entrato): le righe si
  /// fanno da parte, e si scrive lì.
  readonly open: boolean;
  /// Il registro dei tipi del vault, con cui le righe scelgono l'editor.
  readonly types: PropertyTypes;
}

export function samePageProperties(a: PageProperties | null, b: PageProperties | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.display === b.display && a.unreadable === b.unreadable && a.open === b.open && a.types === b.types
    && sameEntries(a.featured, b.featured) && sameEntries(a.rest, b.rest);
}

function sameEntries(a: readonly PropertyEntry[], b: readonly PropertyEntry[]): boolean {
  return a.length === b.length && a.every((entry, index) => {
    const other = b[index]!;
    return entry.key === other.key && entry.value === other.value && entry.from === other.from
      && entry.simple === other.simple && entry.quoted === other.quoted
      && (entry.items ?? []).join("\u0000") === (other.items ?? []).join("\u0000") && (entry.items === null) === (other.items === null);
  });
}

/// Chi ospita le proprietà: ciò che chiedono le righe (`PropertyRowHost`),
/// più la sezione.
export interface PropertiesHost extends PropertyRowHost {
  /// «Aggiungi una proprietà».
  add(): void;
  /// «Altre N proprietà» aperto o chiuso, ricordato da chi ospita.
  readonly more: { readonly open: boolean; set(open: boolean): void };
  /// L'altezza della testata è cambiata.
  measure(): void;
}

/// La sezione delle proprietà, o `null` se non c'è niente da mostrare né da
/// fare. Un clic su «Altre N proprietà» la ridisegna sul posto.
export function propertiesElement(model: PageProperties, host: PropertiesHost, life: Lifetime): HTMLElement | null {
  if (model.unreadable) {
    const note = document.createElement("p");
    note.className = "cm-fub-page-unreadable";
    note.setAttribute("role", "note");
    note.textContent = liveStrings.t("page.properties.unreadable");
    return note;
  }
  if (model.open) return null;
  const total = model.featured.length + model.rest.length;
  if (total === 0 && !host.editable) return null;
  const section = document.createElement("div");
  // Il tasto destro qui dà il menu delle proprietà, come sul frontmatter
  // (`surface.ts`, `writingMenu`).
  section.className = "cm-fub-page-props";
  section.setAttribute("role", "group");
  section.setAttribute("aria-label", t("editor.properties.label"));
  let more = host.more.open;
  const draw = (focusToggle: boolean) => {
    const rows = model.display === "visible"
      ? [...model.featured, ...(more ? model.rest : [])]
      : more ? [...model.featured, ...model.rest] : [];
    const hidden = model.display === "visible" ? model.rest.length : total;
    const children: HTMLElement[] = rows.map((entry) => propertyRow(entry, host, life, model.rest.length > 0 ? model.featured.includes(entry) : null));
    if (hidden > 0) {
      const toggle = document.createElement("button");
      toggle.type = "button";
      toggle.className = "cm-fub-page-props-more";
      toggle.dataset.pageNav = "";
      toggle.setAttribute("aria-expanded", String(more));
      labelled(toggle, more ? "chevron-up" : "chevron", more
        ? liveStrings.t("page.properties.less")
        : liveStrings.plural(hidden, "page.properties.more.one", "page.properties.more", { count: String(hidden) }));
      life.listen(toggle, "click", () => {
        more = !more;
        host.more.set(more);
        draw(true);
        host.measure();
      });
      children.push(toggle);
    }
    if (host.editable) {
      const add = document.createElement("button");
      add.type = "button";
      add.className = "cm-fub-page-props-add";
      add.dataset.pageNav = "";
      labelled(add, "plus", t("editor.properties.add"));
      life.listen(add, "click", () => host.add());
      children.push(add);
    }
    section.replaceChildren(...children);
    if (focusToggle) section.querySelector<HTMLElement>(".cm-fub-page-props-more")?.focus();
  };
  draw(false);
  return section;
}

/// Il testo di un pulsante della sezione, con la sua figura davanti (se il
/// set la disegna).
function labelled(button: HTMLButtonElement, icon: string, text: string): void {
  const figure = iconEl(icon);
  figure?.setAttribute("aria-hidden", "true");
  const label = document.createElement("span");
  label.textContent = text;
  button.replaceChildren(...(figure ? [figure] : []), label);
}
