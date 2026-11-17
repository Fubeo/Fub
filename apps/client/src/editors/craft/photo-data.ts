// I dati di LightCraft sotto una foto (N7, D-5 (d)): le stelle, l'etichetta
// col suo colore, la scelta, le parole chiave e «Apri l'XMP», in sola
// lettura.
//
// I pezzi sono quelli della scheda dell'XMP (`xmp-view.ts`): le stesse stelle,
// la stessa etichetta, gli stessi tag, che un clic cerca. Una foto senza XMP
// non ha la riga, e nemmeno il suo posto; un XMP rotto o vuoto lo dice,
// sempre con «Apri l'XMP», che apre l'XMP col gesto di ogni documento. Fub non
// scrive mai l'XMP: LightCraft lo scrive, e la riga si aggiorna da sola
// quando cambia (`state/craft-photos.ts`).

import type { CraftPhotoSidecar } from "../../host/craft";
import { onLanguage, t, type Key } from "../../i18n/strings";
import { openLifetime, type Lifetime } from "../../ui/lifetime";
import { photoOf, watchPhoto } from "../../state/craft-photos";
import { COLOR_NAMES, LABEL_COLORS, keywordTags, ratingText } from "./xmp-view";

/// Ciò che la riga chiede alla shell: gli stessi gesti della scheda dell'XMP.
export interface PhotoDataDeps {
  /// Apre l'XMP, come un clic su un file del vault.
  readonly onOpenDocument: (doc: string) => void | Promise<void>;
  /// Cerca un tag, come un clic su un tag della nota.
  readonly onSearchTag: (tag: string) => void;
}

function span(className: string, text: string): HTMLSpanElement {
  const element = document.createElement("span");
  if (className) element.className = className;
  element.textContent = text;
  return element;
}

function absent(key: Key): HTMLSpanElement {
  return span("craft-xmp-absent", t(key));
}

function stars(rating: number): HTMLElement {
  const label = ratingText(rating);
  const box = document.createElement("span");
  box.className = "craft-xmp-stars";
  box.setAttribute("role", "img");
  box.setAttribute("aria-label", label);
  box.title = label;
  for (let i = 1; i <= 5; i++) {
    const star = span("craft-xmp-star", i <= rating ? "★" : "☆");
    star.dataset.on = String(i <= rating);
    box.append(star);
  }
  return box;
}

/// L'etichetta col suo colore; un'etichetta che il catalogo non conosce si
/// mostra com'è, senza colore. Davanti, per il lettore di schermo, il nome
/// del campo.
function labelChip(label: string): HTMLElement {
  const chip = document.createElement("span");
  chip.className = "craft-xmp-label";
  chip.append(span("sr-only", `${t("craft.xmp.label")}: `));
  const color = LABEL_COLORS[label];
  const name = color ? COLOR_NAMES[color] : undefined;
  if (color && name) {
    chip.dataset.color = color;
    const swatch = span("craft-xmp-swatch", "");
    swatch.setAttribute("aria-hidden", "true");
    chip.append(swatch, document.createTextNode(t(name)));
  } else {
    chip.append(document.createTextNode(label));
  }
  return chip;
}

/// Disegna i dati di `sidecar` in fondo a `root`: la `section.photo-data`, o
/// niente se la foto non ha un XMP (`xmp: null`). Gli ascolti vivono in
/// `life`, che alla chiusura toglie anche la riga.
export function mountPhotoData(
  root: HTMLElement,
  sidecar: CraftPhotoSidecar,
  deps: PhotoDataDeps,
  life: Lifetime,
): HTMLElement | null {
  const xmp = sidecar.xmp;
  if (xmp === null || life.closed) return null;
  const section = document.createElement("section");
  section.className = "photo-data";
  section.setAttribute("aria-label", t("craft.photo.region"));

  const open = document.createElement("button");
  open.type = "button";
  open.className = "link-button photo-data-open";
  open.textContent = t("craft.photo.open_xmp");
  open.title = t("craft.xmp.open", { name: xmp });
  life.listen(open, "click", () => void Promise.resolve(deps.onOpenDocument(xmp)).catch(() => {}));

  const line = document.createElement("div");
  line.className = "photo-data-line";
  section.append(line);
  const meta = sidecar.meta;
  if (meta === null) {
    line.append(absent("craft.photo.unreadable"), open);
  } else {
    if (meta.rating !== null) line.append(meta.rating >= 0 ? stars(meta.rating) : span("", ratingText(meta.rating)));
    if (meta.label !== null) line.append(labelChip(meta.label));
    if (meta.flag !== null) line.append(span("", t(meta.flag === "pick" ? "craft.xmp.flag.pick" : "craft.xmp.flag.reject")));
    const tags = keywordTags(meta.keywords);
    if (line.childElementCount === 0 && tags.length === 0) line.append(absent("craft.photo.empty"));
    line.append(open);
    if (tags.length > 0) {
      const list = document.createElement("ul");
      list.className = "craft-xmp-tags photo-data-tags";
      list.setAttribute("aria-label", t("craft.xmp.keywords"));
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
      section.append(list);
    }
  }

  root.append(section);
  life.add(() => section.remove());
  return section;
}

/// Mostra in fondo a `root` i dati dell'XMP accanto alla foto `doc`, finché
/// `life` è vivo: li chiede, li ridisegna quando la foto o il suo XMP
/// cambiano e quando cambia la lingua, e li toglie se l'XMP sparisce. Una
/// risposta vecchia non copre quella nuova; un guasto non lascia la riga.
export function showPhotoData(root: HTMLElement, doc: string, deps: PhotoDataDeps, life: Lifetime): void {
  if (life.closed) return;
  let shown: Lifetime | null = null;
  let last: CraftPhotoSidecar | null = null;
  let turn = 0;

  function draw(sidecar: CraftPhotoSidecar | null): void {
    shown?.close();
    shown = null;
    last = sidecar;
    if (!sidecar || life.closed) return;
    const row = openLifetime();
    shown = row;
    mountPhotoData(root, sidecar, deps, row);
  }

  function refresh(): void {
    const mine = ++turn;
    photoOf(doc).then(
      (sidecar) => {
        if (mine === turn && !life.closed) draw(sidecar);
      },
      () => {
        if (mine === turn && !life.closed) draw(null);
      },
    );
  }

  // Una sola chiusura nella vita della superficie, per la riga di adesso:
  // ogni ridisegno chiude la sua da sé.
  life.add(() => {
    shown?.close();
    shown = null;
  });
  watchPhoto(doc, life, refresh);
  life.add(onLanguage(() => draw(last)));
  life.add(() => {
    turn++;
  });
  refresh();
}
