// Le immagini e i media **del vault** dentro una nota resa (Live e Lettura).
//
// Il renderer scrive `<img src="Risorse/x.png">` e `![[x.png|120]]` così come
// li trova nella sorgente: un path del vault non è un URL che la webview sappia
// aprire. Qui ogni riferimento locale si risolve **col kernel** (`resolve`, la
// stessa regola dei link: relativo alla nota per i path, per nome per i
// wikilink) e i byte arrivano dal protocollo `fub-asset:` attraverso un lease
// `resource_open`, chiuso quando la resa si smonta. Nessun path diventa URL, e
// un riferimento che non si risolve resta dichiarato non risolto.
import { t } from "../../../../i18n/strings";
import type { LinkTarget } from "../../../../host/contract";
import { api } from "../../../../host/ipc";
import { resolvedReference } from "../../../../host/query";
import { mediaKindOfId, mimeOfId } from "../../../media/media-types";
import { openResourcePort, type ResourceTransport } from "../../../media/resource-port";
import type { VaultFontPort } from "../../../spatial/fonts/vault";
import { drawingFonts } from "../../../../state/drawing-fonts";
import type { Lifetime } from "../../../../ui/lifetime";
import type { Expected } from "../../../../ui/race";
import { VAULT_SRC_ATTRIBUTE } from "../../../../ui/sanitize";

/// Ciò che serve a idratare, iniettabile nei banchi.
export interface MediaPort {
  resolve(target: LinkTarget, from: string): Promise<string | null>;
  open(id: string): Promise<{ handle: string }>;
  close(handle: string): void;
  /// L'URL `fub-asset:` di un lease aperto: la forma è dell'host.
  url(handle: string): string;
  /// I byte del documento `id`, col loro tipo; `null` se pesa più di `limit`
  /// byte, che allora non si leggono. Senza, un disegno si mostra dal file.
  read?(id: string, limit: number): Promise<Blob | null>;
  /// I caratteri del vault che i testi di un disegno possono nominare;
  /// senza, i testi usano soltanto quelli dell'app.
  fonts?: VaultFontPort;
}

/// I byte dei file del vault, per chi li legge interi.
const transport: ResourceTransport = {
  open: (id, vault) => api.resourceOpen(id, vault ?? null),
  read_chunk: api.resourceReadChunk,
  close: api.resourceClose,
};

const hostPort: MediaPort = {
  resolve: async (target, from) => (await resolvedReference(target, from))?.doc ?? null,
  open: (id) => api.resourceOpen(id),
  close: (handle) => {
    void api.resourceClose(handle).catch(() => {});
  },
  url: (handle) => api.assetUrl(handle),
  read: async (id, limit) => {
    const port = await openResourcePort(transport, id);
    try {
      if (port.descriptor.len > limit) return null;
      return new Blob([(await port.readAll()) as BlobPart], { type: port.descriptor.mime });
    } finally {
      await port.close();
    }
  },
  fonts: drawingFonts,
};

/// Quanti byte pesa al più un disegno che una nota mostra coi caratteri e le
/// immagini dentro, e quanti byte di immagini del vault vi entrano al più:
/// oltre, il disegno si mostra dal file, o le immagini che restano sono
/// segnaposti.
export const EMBED_DRAWING_BYTES = 16 * 1024 * 1024;
export const EMBED_IMAGE_BYTES = 16 * 1024 * 1024;

/// Un disegno del vault come lo mostra la Lettura: dentro un `img` il
/// browser non carica né i caratteri dell'app e del vault né le immagini del
/// vault, e una copia del disegno li porta dentro, da un blob che vive quanto
/// la resa. Il file non cambia. Un carattere che non si carica non si dice:
/// lo dice il disegno, quando si apre. `null` per un file che non è un disegno, o che non si
/// legge: si mostra il file.
///
/// `heading` è la sezione che un embed nomina, `![[disegno#Copertina]]`: il
/// titolo mostra il disegno intero, una tavola il disegno ritagliato su di
/// lei. `false` se il disegno si legge e non ha quella sezione: l'embed non
/// si risolve, come il kernel risponde per lo stesso nome.
function drawingPicture(port: MediaPort, id: string, life: Lifetime): Promise<string | null>;
function drawingPicture(port: MediaPort, id: string, life: Lifetime, heading: string | null): Promise<string | false | null>;
async function drawingPicture(port: MediaPort, id: string, life: Lifetime, heading: string | null = null): Promise<string | false | null> {
  const read = port.read;
  if (read === undefined || mimeOfId(id) !== "image/svg+xml") return null;
  try {
    const file = await read(id, EMBED_DRAWING_BYTES);
    if (file === null || life.closed) return null;
    const text = await file.text();
    // Il modulo dei disegni arriva solo con un disegno da mostrare.
    const [{ fontSheets, section, selfContained }, { DrawingFonts, markupFonts, vaultFontsOf }] = await Promise.all([
      import("../../../spatial/picture"),
      import("../../../spatial/fonts/vault"),
    ]);
    const drawing = heading === null ? text : section(text, heading);
    if (drawing === null) return false;
    // Le facce del vault servono finché l'immagine non le porta dentro.
    const fonts = new DrawingFonts(port.fonts === undefined ? null : vaultFontsOf(port.fonts));
    let shown: string;
    try {
      fonts.useFonts(markupFonts(drawing).fonts);
      shown = await selfContained(drawing, async (path, limit) => {
        const target = await port.resolve({ kind: "path", value: path }, id).catch(() => null);
        return target === null || mediaKindOfId(target) !== "image" ? null : read(target, limit);
      }, EMBED_IMAGE_BYTES, fontSheets(fonts));
    } finally {
      fonts.dispose();
    }
    if (life.closed) return null;
    const url = URL.createObjectURL(new Blob([shown], { type: "image/svg+xml" }));
    life.add(() => URL.revokeObjectURL(url));
    return url;
  } catch {
    return null;
  }
}

/// Un `src` che è già un URL (schema, `//host`, frammento) non è del vault.
export function isVaultPath(src: string): boolean {
  return src !== "" && !/^[a-z][\w+.-]*:/i.test(src) && !src.startsWith("//") && !src.startsWith("#");
}

/// `120` o `200x100`: la dimensione di un embed, non la sua etichetta.
export function embedSize(label: string | undefined): { width: string; height?: string } | null {
  const match = /^\s*(\d{1,5})(?:x(\d{1,5}))?\s*$/.exec(label ?? "");
  if (!match) return null;
  return match[2] ? { width: match[1]!, height: match[2] } : { width: match[1]! };
}

async function lease(
  port: MediaPort,
  id: string,
  life: Lifetime,
): Promise<string | null> {
  const descriptor = await port.open(id);
  // Il lease è nato mentre la resa si smontava: si chiude subito, non resta.
  if (life.closed) {
    port.close(descriptor.handle);
    return null;
  }
  life.add(() => port.close(descriptor.handle));
  return port.url(descriptor.handle);
}

/// Un'immagine del vault per chi la mostra altrove (la lightbox): un lease
/// suo, nella sua vita, indipendente da quello della resa da cui viene.
export function vaultImageSource(id: string, port: MediaPort = hostPort): (life: Lifetime) => Promise<string | null> {
  return (life) => lease(port, id, life);
}

/// Un'immagine che non si vede: al suo posto il testo alternativo e il path,
/// in un riquadro che si legge come «qui c'era un'immagine». L'`img` resta nel
/// DOM, nascosta, con i suoi attributi: chi la cerca per path la ritrova.
function showMissingImage(img: HTMLImageElement, path: string): void {
  if (img.nextElementSibling?.classList.contains("image-missing")) return;
  const box = document.createElement("span");
  box.className = "image-missing";
  box.setAttribute("role", "img");
  const alt = img.getAttribute("alt")?.trim();
  box.setAttribute("aria-label", t("markdown.image_missing", { name: alt || path }));
  box.textContent = alt ? `${alt} · ${path}` : path;
  img.hidden = true;
  img.after(box);
}

/// Il media di un embed risolto al posto del suo segnaposto: `<img>`,
/// `<audio>` o `<video>`, con la dimensione scritta dopo la barra.
function showEmbeddedMedia(container: HTMLElement, slot: HTMLElement, id: string, url: string, label: string): void {
  const kind = mediaKindOfId(id);
  const media = kind === "audio" || kind === "video"
    ? Object.assign(document.createElement(kind), { controls: true, preload: "metadata" })
    : Object.assign(document.createElement("img"), { alt: label, loading: "lazy", decoding: "async" });
  media.src = url;
  if (kind !== "audio" && kind !== "video") media.dataset.vaultId = id;
  const size = embedSize(slot.dataset.embedSize);
  if (size) {
    media.setAttribute("width", size.width);
    if (size.height) media.setAttribute("height", size.height);
  }
  slot.dataset.vaultMedia = "loaded";
  slot.classList.add("embed-media");
  slot.replaceChildren(media);
  container.dispatchEvent(new Event("markdown-resize", { bubbles: true }));
}

/// Idrata le immagini con `src` locale e gli embed di media del vault: quelli
/// per nome (`![[foto.png]]`) e quelli per path che scrive la resa dell'host
/// (`<div class="embed" data-embed-path>` per `![alt](foto.png)`).
export async function hydrateVaultMedia(
  container: HTMLElement,
  documentId: string,
  expected: Expected,
  life: Lifetime,
  port: MediaPort = hostPort,
): Promise<void> {
  const images = Array.from(container.querySelectorAll<HTMLImageElement>(`img[${VAULT_SRC_ATTRIBUTE}]`))
    .filter((img) => !img.dataset.vaultMedia && isVaultPath(img.getAttribute(VAULT_SRC_ATTRIBUTE) ?? ""));
  const embeds = Array.from(container.querySelectorAll<HTMLElement>(".embed[data-embed-page]"))
    .filter((slot) => !slot.dataset.vaultMedia && mediaKindOfId(slot.dataset.embedPage ?? "") !== "other");
  const placed = Array.from(container.querySelectorAll<HTMLElement>(".embed[data-embed-path]"))
    .filter((slot) => {
      const path = slot.dataset.embedPath ?? "";
      const kind = mediaKindOfId(path);
      return !slot.dataset.vaultMedia && isVaultPath(path) && (kind === "image" || kind === "audio" || kind === "video");
    });
  await Promise.all([
    ...images.map(async (img) => {
      const raw = img.getAttribute(VAULT_SRC_ATTRIBUTE)!;
      img.dataset.vaultMedia = "pending";
      const id = await expected(port.resolve({ kind: "path", value: raw }, documentId).catch(() => null));
      const url = id ? await lease(port, id, life).catch(() => null) : null;
      if (!url || !id) {
        img.dataset.vaultMedia = "unresolved";
        img.classList.add("unresolved");
        img.dataset.vaultMissing = raw;
        showMissingImage(img, raw);
        return;
      }
      const drawing = await drawingPicture(port, id, life);
      if (life.closed) return;
      img.dataset.vaultMedia = "loaded";
      img.dataset.vaultId = id;
      // Un file che c'è ma non si decodifica è un'immagine rotta anche lui:
      // il segnaposto dice quale, invece dell'icona del browser.
      life.listen(img, "error", () => showMissingImage(img, raw), { once: true });
      img.src = drawing ?? url;
    }),
    ...embeds.map(async (slot) => {
      const page = slot.dataset.embedPage!;
      slot.dataset.vaultMedia = "pending";
      if (mediaKindOfId(page) === "pdf") {
        // Un PDF non si incorpora dentro la nota: diventa un collegamento
        // alla sua superficie, che lo apre nel visualizzatore dedicato.
        const link = Object.assign(document.createElement("a"), { href: "#", textContent: page });
        link.className = "wikilink";
        link.dataset.wikilinkPage = page;
        slot.dataset.vaultMedia = "loaded";
        slot.replaceChildren(link);
        return;
      }
      const id = await expected(
        port.resolve({ kind: "wiki", value: { page, heading: null, block: null } }, documentId).catch(() => null),
      );
      const url = id ? await lease(port, id, life).catch(() => null) : null;
      if (!url || !id) {
        slot.dataset.vaultMedia = "unresolved";
        slot.classList.add("unresolved");
        return;
      }
      const heading = slot.dataset.embedHeading ?? null;
      const drawing = await drawingPicture(port, id, life, heading);
      if (life.closed) return;
      if (drawing === false) {
        slot.dataset.vaultMedia = "unresolved";
        slot.classList.add("unresolved");
        return;
      }
      showEmbeddedMedia(container, slot, id, drawing ?? url, heading === null ? page : `${page}#${heading}`);
    }),
    ...placed.map(async (slot) => {
      const path = slot.dataset.embedPath!;
      // Il testo del segnaposto è l'`alt` che la sorgente ha scritto.
      const label = slot.textContent?.trim() || path;
      slot.dataset.vaultMedia = "pending";
      const id = await expected(port.resolve({ kind: "path", value: path }, documentId).catch(() => null));
      const url = id ? await lease(port, id, life).catch(() => null) : null;
      if (!url || !id) {
        slot.dataset.vaultMedia = "unresolved";
        slot.classList.add("unresolved");
        return;
      }
      const drawing = await drawingPicture(port, id, life);
      if (life.closed) return;
      showEmbeddedMedia(container, slot, id, drawing ?? url, label);
    }),
  ]);
}
