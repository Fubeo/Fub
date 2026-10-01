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
import { mediaKindOfId } from "../../../media/media-types";
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
}

const hostPort: MediaPort = {
  resolve: async (target, from) => (await resolvedReference(target, from))?.doc ?? null,
  open: (id) => api.resourceOpen(id),
  close: (handle) => {
    void api.resourceClose(handle).catch(() => {});
  },
  url: (handle) => api.assetUrl(handle),
};

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
      img.dataset.vaultMedia = "loaded";
      img.dataset.vaultId = id;
      // Un file che c'è ma non si decodifica è un'immagine rotta anche lui:
      // il segnaposto dice quale, invece dell'icona del browser.
      life.listen(img, "error", () => showMissingImage(img, raw), { once: true });
      img.src = url;
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
      showEmbeddedMedia(container, slot, id, url, page);
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
      showEmbeddedMedia(container, slot, id, url, label);
    }),
  ]);
}
