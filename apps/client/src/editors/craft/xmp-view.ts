// La scheda di un XMP di LightCraft (N7): voto, etichetta, scelta, parole
// chiave, la foto a cui appartiene e le sue copie `-Edit.psd`, in sola lettura.
//
// Le parole chiave sono tag del vault (D-5: «New York» è `#New-York`) e un
// clic le cerca, come un tag della nota; la foto e le copie si aprono con un
// clic. Un campo che l'XMP non dice ha la sua frase («Nessun voto»), mai un
// buco. In fondo resta fissa la riga su come LightCraft scrive questi dati:
// Fub non li scrive mai.

import type { CraftPreview } from "../../host/craft";
import { plural, t, type Key } from "../../i18n/strings";
import type { Lifetime } from "../../ui/lifetime";
import { craftInfoText, fileName, type CraftSurfaceDeps } from "./index";

/// Le cinque etichette come le scrive LightCraft, col colore del contenuto che
/// le dipinge. Un'altra etichetta si mostra com'è, senza colore.
const LABEL_COLORS: Readonly<Record<string, string>> = {
  Red: "red",
  Yellow: "yellow",
  Green: "green",
  Blue: "blue",
  Purple: "purple",
};

const COLOR_NAMES: Readonly<Record<string, Key>> = {
  red: "craft.xmp.color.red",
  yellow: "craft.xmp.color.yellow",
  green: "craft.xmp.color.green",
  blue: "craft.xmp.color.blue",
  purple: "craft.xmp.color.purple",
};

/// La parola chiave come nome di tag, come `tag_name_of` di `xmp.rs`: senza i
/// `#` davanti, e ogni serie di spazi diventata un `-`.
export function keywordTag(keyword: string): string {
  return keyword.replace(/^#+/, "").trim().replace(/\s+/g, "-");
}

/// Le parole chiave come tag, nell'ordine, senza doppioni né vuoti.
export function keywordTags(keywords: readonly string[]): string[] {
  const tags: string[] = [];
  for (const keyword of keywords) {
    const tag = keywordTag(keyword);
    if (tag && !tags.includes(tag)) tags.push(tag);
  }
  return tags;
}

/// La lettura del voto per lo schermo e per chi guarda: «3 stelle su 5»,
/// «Scartata» per -1, «Nessun voto» se l'XMP non lo dice.
export function ratingText(rating: number | null): string {
  if (rating === null) return t("craft.xmp.no_rating");
  if (rating < 0) return t("craft.xmp.rejected");
  return plural(rating, "craft.xmp.stars_one", "craft.xmp.stars_other", { count: rating });
}

export interface XmpView {
  readonly element: HTMLElement;
  destroy(): void;
}

function field(label: Key, ...content: Node[]): HTMLElement {
  const row = document.createElement("div");
  row.className = "craft-xmp-field";
  const term = document.createElement("dt");
  term.textContent = t(label);
  const value = document.createElement("dd");
  value.append(...content);
  row.append(term, value);
  return row;
}

function absent(key: Key): HTMLElement {
  const span = document.createElement("span");
  span.className = "craft-xmp-absent";
  span.textContent = t(key);
  return span;
}

/// Disegna la scheda dell'XMP di `preview`; gli ascolti vivono in `life`.
export function mountXmpView(preview: CraftPreview, deps: CraftSurfaceDeps, life: Lifetime): XmpView {
  const xmp = preview.info.xmp;
  const element = document.createElement("section");
  element.className = "craft-xmp";

  const head = document.createElement("header");
  head.className = "craft-xmp-head";
  const title = document.createElement("h2");
  title.className = "craft-xmp-title";
  title.textContent = fileName(preview.doc);
  const info = document.createElement("p");
  info.className = "craft-info";
  info.textContent = craftInfoText(preview.info);
  head.append(title, info);

  const fields = document.createElement("dl");
  fields.className = "craft-xmp-fields";

  // Il voto.
  const rating = xmp?.rating ?? null;
  if (rating !== null && rating >= 0) {
    const stars = document.createElement("span");
    stars.className = "craft-xmp-stars";
    stars.setAttribute("role", "img");
    stars.setAttribute("aria-label", ratingText(rating));
    stars.title = ratingText(rating);
    for (let i = 1; i <= 5; i++) {
      const star = document.createElement("span");
      star.className = "craft-xmp-star";
      star.dataset.on = String(i <= rating);
      star.textContent = i <= rating ? "★" : "☆";
      stars.append(star);
    }
    fields.append(field("craft.xmp.rating", stars));
  } else {
    fields.append(field("craft.xmp.rating", rating === null ? absent("craft.xmp.no_rating") : document.createTextNode(ratingText(rating))));
  }

  // L'etichetta.
  const label = xmp?.label ?? null;
  if (label === null) {
    fields.append(field("craft.xmp.label", absent("craft.xmp.no_label")));
  } else {
    const chip = document.createElement("span");
    chip.className = "craft-xmp-label";
    const color = LABEL_COLORS[label];
    const swatch = document.createElement("span");
    swatch.className = "craft-xmp-swatch";
    swatch.setAttribute("aria-hidden", "true");
    if (color) {
      chip.dataset.color = color;
      chip.append(swatch, document.createTextNode(t(COLOR_NAMES[color]!)));
    } else {
      chip.textContent = label;
    }
    fields.append(field("craft.xmp.label", chip));
  }

  // La scelta.
  const flag = xmp?.flag ?? null;
  fields.append(field(
    "craft.xmp.flag",
    flag === null ? absent("craft.xmp.flag.none") : document.createTextNode(t(flag === "pick" ? "craft.xmp.flag.pick" : "craft.xmp.flag.reject")),
  ));

  // Le parole chiave, come i tag della nota.
  const tags = keywordTags(xmp?.keywords ?? []);
  if (tags.length === 0) {
    fields.append(field("craft.xmp.keywords", absent("craft.xmp.no_keywords")));
  } else {
    const list = document.createElement("ul");
    list.className = "craft-xmp-tags";
    for (const tag of tags) {
      const item = document.createElement("li");
      const button = document.createElement("button");
      button.type = "button";
      button.className = "craft-xmp-tag";
      button.textContent = `#${tag}`;
      button.title = t("craft.xmp.search_tag", { tag: `#${tag}` });
      life.listen(button, "click", () => deps.onSearchTag(tag));
      item.append(button);
      list.append(item);
    }
    fields.append(field("craft.xmp.keywords", list));
  }

  // La foto e le copie.
  const link = (doc: string): HTMLButtonElement => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "craft-xmp-link";
    button.textContent = fileName(doc);
    button.title = t("craft.xmp.open", { name: doc });
    life.listen(button, "click", () => void Promise.resolve(deps.onOpenDocument(doc)).catch(() => {}));
    return button;
  };
  const photo = preview.info.photo;
  fields.append(field("craft.xmp.photo", photo === null ? absent("craft.xmp.no_photo") : link(photo)));
  if (preview.info.edits.length > 0) {
    const edits = document.createElement("span");
    edits.className = "craft-xmp-edits";
    edits.append(...preview.info.edits.map(link));
    fields.append(field("craft.xmp.edits", edits));
  }

  const body = document.createElement("div");
  body.className = "craft-xmp-body";
  body.append(head, fields);
  const note = document.createElement("p");
  note.className = "craft-xmp-note";
  note.textContent = t("craft.xmp.note");
  element.append(body, note);

  life.add(() => element.remove());
  return { element, destroy: () => life.close() };
}
