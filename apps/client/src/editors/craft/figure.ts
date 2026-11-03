// La figura di un file Craft dentro una nota (N7): `![[logo.vectorcraft]]`
// in Lettura e in Live, e l'anteprima al passaggio su `[[logo.vectorcraft]]`.
//
// Il provider del formato rende il file come un segnaposto
// (`figure.fub-craft[data-embed-kind="craft"]`, o `craft-xmp` per un XMP) col
// nome nella didascalia; qui il segnaposto diventa ciò che si vede, come la
// figura dei disegni (`showEmbeddedDrawing`): con l'anteprima piccola che il
// file porta, un'immagine con il nome sotto; senza, il riquadro col nome e
// l'app, e per un XMP i suoi dati principali. Un JPEG (la foto di un RAW) si
// mostra come un PNG. `craft.preview` non avvia mai l'app che farebbe
// l'anteprima, e una nota non la chiede. Il segnaposto non entra mai nella
// nota: il suo markup si legge e si butta.
//
// Tutto ciò che la figura accende (l'URL `blob:` dell'immagine, gli
// ascoltatori, l'ascolto delle anteprime) vive nella `Lifetime` della resa:
// una risposta che arriva a nota chiusa si scarta.

import type { CraftPreview, CraftPreviewImage, CraftPreviewSubject, CraftXmpInfo } from "../../host/craft";
import { t, type Key } from "../../i18n/strings";
import { previewOf, watchCraftPreviews, type CraftPreviewAnswer } from "../../state/craft-previews";
import { openLifetime, type Lifetime } from "../../ui/lifetime";
import { sanitizeFragment } from "../../ui/sanitize";
import { embedOwnText, embedSize } from "../text/profiles/markdown/media";
import { craftInfoText, fileName } from "./index";
import { ratingText } from "./xmp-view";

/// Le famiglie dei quattro provider di `fub-format-craft`, le sole che hanno
/// un segnaposto.
export type CraftPlaceholderApp = Extract<CraftPreviewSubject, "vectorcraft" | "photocraft" | "figcraft" | "xmp">;

/// Il segnaposto di un file Craft: il documento, la sua famiglia e il nome
/// della didascalia.
export interface CraftPlaceholder {
  readonly doc: string;
  readonly app: CraftPlaceholderApp;
  readonly name: string;
}

/// Ciò che la figura chiede alla shell. Di serie le anteprime sono quelle di
/// `state/craft-previews.ts`; senza `open` la figura non si apre con un clic
/// (la stampa).
export interface CraftFigureDeps {
  readonly open?: (doc: string) => void | Promise<void>;
  readonly previews?: {
    previewOf(doc: string, size: "small"): Promise<CraftPreviewAnswer | null>;
    watch(lifetime: Lifetime, watcher: (doc: string) => void): void;
  };
}

const STORE: NonNullable<CraftFigureDeps["previews"]> = {
  previewOf: (doc, size) => previewOf(doc, size),
  watch: watchCraftPreviews,
};

/// Il nome di ogni app quando il bundle non ha ancora risposto, o non
/// risponde (il componente spento): lo stesso di `CraftApp::editor_name`.
const EDITORS: Readonly<Record<CraftPlaceholderApp, string>> = {
  vectorcraft: "VectorCraft",
  photocraft: "PhotoCraft",
  figcraft: "FigCraft",
  xmp: "LightCraft",
};

const KIND_KEYS: Readonly<Record<CraftPlaceholderApp, Key>> = {
  vectorcraft: "craft.kind.vectorcraft",
  photocraft: "craft.kind.photocraft",
  figcraft: "craft.kind.figcraft",
  xmp: "craft.kind.xmp",
};

/// Le etichette di LightCraft che il catalogo traduce, come le legge la
/// scheda dell'XMP (`xmp-view.ts`); un'altra si mostra com'è.
const LABEL_KEYS: Readonly<Record<string, Key>> = {
  Red: "craft.xmp.color.red",
  Yellow: "craft.xmp.color.yellow",
  Green: "craft.xmp.color.green",
  Blue: "craft.xmp.color.blue",
  Purple: "craft.xmp.color.purple",
};

function isApp(value: string | null): value is CraftPlaceholderApp {
  return value !== null && Object.prototype.hasOwnProperty.call(EDITORS, value);
}

/// Il segnaposto con cui il provider di un file Craft rende un documento,
/// `null` per ogni altra resa. La specie e l'app vanno insieme: un XMP è
/// `craft-xmp`, gli altri tre `craft`.
export function craftPlaceholder(html: string): CraftPlaceholder | null {
  const figure = sanitizeFragment(html).firstElementChild;
  if (figure?.localName !== "figure" || !figure.classList.contains("fub-craft")) return null;
  const kind = figure.getAttribute("data-embed-kind");
  const app = figure.getAttribute("data-craft-app");
  if (!isApp(app) || (kind !== "craft" && kind !== "craft-xmp") || (kind === "craft-xmp") !== (app === "xmp")) return null;
  const doc = figure.getAttribute("data-embed-doc");
  if (!doc) return null;
  return { doc, app, name: figure.querySelector("figcaption")?.textContent?.trim() || fileName(doc) };
}

/// I dati principali di un XMP: voto, etichetta, scelta; solo quelli che dice.
function xmpParts(xmp: CraftXmpInfo | null): string[] {
  if (!xmp) return [];
  const parts: string[] = [];
  if (xmp.rating !== null) parts.push(ratingText(xmp.rating));
  if (xmp.label !== null) {
    const key = LABEL_KEYS[xmp.label];
    parts.push(key ? t(key) : xmp.label);
  }
  if (xmp.flag === "pick") parts.push(t("craft.xmp.flag.pick"));
  else if (xmp.flag === "reject") parts.push(t("craft.xmp.flag.reject"));
  return parts;
}

/// Il testo del riquadro senza immagine: il nome (se la didascalia della
/// figura non lo dice già), l'app (coi dati del file quando il bundle ha
/// risposto) e, a domanda finita, che l'anteprima non c'è.
function boxText(placeholder: CraftPlaceholder, label: string | null, preview: CraftPreview | null, settled: boolean): string {
  const parts = label === null ? [] : [label];
  if (preview) parts.push(craftInfoText(preview.info), ...xmpParts(preview.info.xmp));
  else parts.push(t(KIND_KEYS[placeholder.app], { app: EDITORS[placeholder.app] }));
  if (settled && placeholder.app !== "xmp") parts.push(t("craft.figure.no_preview"));
  return parts.join(" · ");
}

/// I byte dell'immagine che l'anteprima porta in base64, col suo tipo (PNG o
/// JPEG); `null` se non si legge.
function imageBlob(image: CraftPreviewImage): Blob | null {
  try {
    const binary = atob(image.data);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new Blob([bytes], { type: image.media_type });
  } catch {
    return null;
  }
}

/// La resa scrive la didascalia da sé quando l'embed sta da solo nel suo
/// paragrafo (K10, `<figure>` con lo slot e la `figcaption`): allora la
/// figura non ne aggiunge una seconda.
function captioned(slot: HTMLElement): boolean {
  const parent = slot.parentElement;
  return parent?.localName === "figure" && parent.querySelector(":scope > figcaption") !== null;
}

/// Mostra al posto di `slot` la figura del file Craft di `placeholder`:
/// l'anteprima `small` con il nome sotto, o il riquadro. `container` riceve
/// `markdown-resize` quando la figura cambia misura. Si ridisegna quando le
/// anteprime del documento cambiano (il file cambiato, l'anteprima fatta
/// dalla scheda); la stessa figura dieci volte fa una domanda sola, perché lo
/// store tiene la risposta e la domanda in volo.
export async function showEmbeddedCraft(
  container: HTMLElement,
  slot: HTMLElement,
  placeholder: CraftPlaceholder,
  life: Lifetime,
  deps: CraftFigureDeps = {},
): Promise<void> {
  if (life.closed) return;
  const previews = deps.previews ?? STORE;
  const label = embedOwnText(slot) ?? placeholder.name;
  const size = embedSize(slot.dataset.embedSize);
  slot.classList.add("embed-media");
  slot.dataset.craftDoc = placeholder.doc;
  // Ciò che il disegno di adesso accende: il disegno dopo lo spegne.
  let drawn = openLifetime();
  life.add(() => drawn.close());

  const openable = (element: HTMLElement, name: string): void => {
    const open = deps.open;
    if (!open) return;
    element.tabIndex = 0;
    element.setAttribute("role", "link");
    element.setAttribute("aria-label", name);
    // Chi apre dice da sé se non ci riesce.
    const go = (event: Event) => {
      event.preventDefault();
      event.stopPropagation();
      void Promise.resolve().then(() => open(placeholder.doc)).catch(() => {});
    };
    drawn.listen(element, "click", go);
    drawn.listen(element, "keydown", (event) => {
      if (event.key === "Enter") go(event);
    });
  };

  const draw = (answer: CraftPreviewAnswer | null, settled: boolean): void => {
    drawn.close();
    drawn = openLifetime();
    const preview = answer?.preview ?? null;
    const image = preview?.image ?? null;
    const blob = image && placeholder.app !== "xmp" ? imageBlob(image) : null;
    if (image && blob) {
      const url = URL.createObjectURL(blob);
      drawn.add(() => URL.revokeObjectURL(url));
      const img = Object.assign(document.createElement("img"), {
        alt: t("craft.figure.alt", { name: label }),
        decoding: "async",
        src: url,
      });
      img.setAttribute("width", size?.width ?? String(image.width));
      if (size?.height) img.setAttribute("height", size.height);
      else if (!size) img.setAttribute("height", String(image.height));
      img.className = "craft-figure-image";
      let shown: HTMLElement = img;
      if (!captioned(slot)) {
        const figure = document.createElement("figure");
        figure.className = "craft-figure";
        const caption = document.createElement("figcaption");
        caption.textContent = label;
        figure.append(img, caption);
        shown = figure;
      }
      openable(shown, t("craft.figure.alt", { name: label }));
      slot.dataset.vaultMedia = "loaded";
      slot.replaceChildren(shown);
    } else {
      const box = document.createElement("span");
      box.className = "image-missing craft-figure-box";
      box.textContent = boxText(placeholder, captioned(slot) ? null : label, preview, settled);
      // Il nome accessibile dice sempre il nome, anche quando lo mostra la didascalia.
      const name = boxText(placeholder, label, preview, settled);
      box.setAttribute("role", "img");
      box.setAttribute("aria-label", name);
      openable(box, name);
      slot.dataset.vaultMedia = settled ? "loaded" : "pending";
      slot.replaceChildren(box);
    }
    container.dispatchEvent(new Event("markdown-resize", { bubbles: true }));
  };

  // Vale l'ultima domanda: una risposta vecchia non copre una nuova.
  let asked = 0;
  const ask = async (): Promise<void> => {
    const mine = ++asked;
    // Il componente spento o un guasto: resta il riquadro col nome.
    const answer = await previews.previewOf(placeholder.doc, "small").catch(() => null);
    if (life.closed || mine !== asked) return;
    draw(answer, true);
  };

  draw(null, false);
  previews.watch(life, (doc) => {
    if (doc === placeholder.doc) void ask();
  });
  await ask();
}
