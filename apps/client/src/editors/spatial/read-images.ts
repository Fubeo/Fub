// Le immagini della Lettura. In Lettura il disegno è un `<img>` da un blob, e
// dentro un `<img>` un'immagine si vede soltanto se è un data URI: un percorso
// del vault non si apre, e un URL remoto non si carica mai. L'immagine mostra
// quindi un altro testo, che non si scrive nel file: ogni immagine del vault
// vi entra coi suoi byte, letti dalla shell, e ogni altra che non è un data
// URI raster vi è il segnaposto del painter, come sul foglio.

import { IMAGE_PLACEHOLDER } from "./painter/paint";
import { openSource } from "./scene/read";
import { href as hrefKind } from "./scene/values";
import { NS_NONE, NS_SVG, NS_XLINK } from "./scene/xml";

/// Quanti byte di immagini del vault la Lettura mette al più in un disegno,
/// quanti la shell ne legge al più in una volta: oltre, le immagini che
/// restano sono segnaposti.
export const READ_IMAGE_BYTES = 64 * 1024 * 1024;

/// Un `href` d'immagine che in un `<img>` non si vedrebbe, con gli indici del
/// suo valore nel testo, virgolette escluse.
export interface ImageRef {
  readonly start: number;
  readonly end: number;
  /// Il percorso del vault, ripulito come lo legge un URL; `null` per un URL
  /// remoto, o per un data URI che non è raster.
  readonly path: string | null;
}

/// Gli `href` delle immagini di `text` che in un `<img>` non si vedrebbero,
/// in ordine di testo: `href` e `xlink:href`, ciascuno per sé. Un testo che non
/// si legge non ne ha.
export function imageRefs(text: string): ImageRef[] {
  if (!text.includes("image")) return [];
  let nodes;
  try {
    nodes = openSource(text).doc.nodes;
  } catch {
    return [];
  }
  const refs: ImageRef[] = [];
  for (const node of nodes) {
    if (node.kind !== "element" || node.ns !== NS_SVG || node.local !== "image") continue;
    for (const attr of node.attrs) {
      if (attr.local !== "href" || (attr.ns !== NS_NONE && attr.ns !== NS_XLINK)) continue;
      const target = hrefKind(attr.value);
      if (target.kind === "data" && target.raster) continue;
      refs.push({ start: attr.raw[0], end: attr.raw[1], path: target.kind === "vault" ? target.url : null });
    }
  }
  return refs.sort((a, b) => a.start - b.start);
}

/// `text` con le immagini di `refs` al loro posto: il data URI che `sources`
/// dà per il percorso, o il segnaposto.
export function withImages(text: string, refs: readonly ImageRef[], sources: ReadonlyMap<string, string>): string {
  if (refs.length === 0) return text;
  let out = "";
  let at = 0;
  for (const ref of refs) {
    const uri = ref.path === null ? undefined : sources.get(ref.path);
    out += text.slice(at, ref.start) + (uri ?? IMAGE_PLACEHOLDER);
    at = ref.end;
  }
  return out + text.slice(at);
}

/// Un tipo d'immagine che si scrive in un attributo così com'è.
const IMAGE_TYPE = /^image\/[a-z0-9.+-]+$/i;

/// Il data URI dei byte di un'immagine; `null` se il loro tipo non è quello
/// di un'immagine o se non si leggono.
export function imageDataUri(blob: Blob): Promise<string | null> {
  if (!IMAGE_TYPE.test(blob.type)) return Promise.resolve(null);
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : null);
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(blob);
  });
}
