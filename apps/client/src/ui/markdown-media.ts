// Le immagini e i media **del vault** dentro una nota resa (Live e Lettura).
//
// Il renderer scrive `<img src="Risorse/x.png">` e `![[x.png|120]]` così come
// li trova nella sorgente: un path del vault non è un URL che la webview sappia
// aprire. Qui ogni riferimento locale si risolve **col kernel** (`resolve`, la
// stessa regola dei link: relativo alla nota per i path, per nome per i
// wikilink) e i byte arrivano dal protocollo `fub-asset:` attraverso un lease
// `resource_open`, chiuso quando la resa si smonta. Nessun path diventa URL, e
// un riferimento che non si risolve resta dichiarato non risolto.
import type { LinkTarget } from "../host/contract";
import { api } from "../host/ipc";
import { resolvedReference } from "../host/query";
import { assetUrl, mediaKindOfId } from "../editors/media/media-types";
import type { Lifetime } from "./lifetime";
import type { Expected } from "./race";
import { VAULT_SRC_ATTRIBUTE } from "./sanitize";

/// Ciò che serve a idratare, iniettabile nei banchi.
export interface MediaPort {
  resolve(target: LinkTarget, from: string): Promise<string | null>;
  open(id: string): Promise<{ handle: string }>;
  close(handle: string): void;
}

const hostPort: MediaPort = {
  resolve: async (target, from) => (await resolvedReference(target, from))?.doc ?? null,
  open: (id) => api.resourceOpen(id),
  close: (handle) => {
    void api.resourceClose(handle).catch(() => {});
  },
};

/// Un `src` che è già un URL (schema, `//host`, frammento) non è del vault.
function isVaultPath(src: string): boolean {
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
  return assetUrl(descriptor.handle);
}

/// Idrata le immagini con `src` locale e gli embed di media del vault.
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
  await Promise.all([
    ...images.map(async (img) => {
      const raw = img.getAttribute(VAULT_SRC_ATTRIBUTE)!;
      img.dataset.vaultMedia = "pending";
      const id = await expected(port.resolve({ kind: "path", value: raw }, documentId).catch(() => null));
      const url = id ? await lease(port, id, life).catch(() => null) : null;
      if (!url) {
        img.dataset.vaultMedia = "unresolved";
        img.classList.add("unresolved");
        img.dataset.vaultMissing = raw;
        return;
      }
      img.dataset.vaultMedia = "loaded";
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
      const kind = mediaKindOfId(id);
      const media = kind === "audio" || kind === "video"
        ? Object.assign(document.createElement(kind), { controls: true, preload: "metadata" })
        : Object.assign(document.createElement("img"), { alt: page, loading: "lazy", decoding: "async" });
      media.src = url;
      const size = embedSize(slot.dataset.embedSize);
      if (size) {
        media.setAttribute("width", size.width);
        if (size.height) media.setAttribute("height", size.height);
      }
      slot.dataset.vaultMedia = "loaded";
      slot.classList.add("embed-media");
      slot.replaceChildren(media);
      container.dispatchEvent(new Event("markdown-resize", { bubbles: true }));
    }),
  ]);
}
