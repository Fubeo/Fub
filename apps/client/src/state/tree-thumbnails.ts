// Le miniature dell'albero (T26): con `craft.tree-thumbnails` acceso, una riga
// in vista di un file Craft (VectorCraft, PhotoCraft, FigCraft), di un RAW, di
// un PDF o di un documento di Word mostra, al posto dell'icona, l'anteprima
// `small` che il file ha già.
//
// Si chiede soltanto `previewOf(doc, "small")`, cioè `craft.preview`, che non
// avvia mai un'app: l'albero non chiama né `renderPreview` né `craft_render`.
// Le domande passano da una coda con al più `TREE_THUMBS_IN_FLIGHT` in volo;
// una riga che esce dalla vista prima del suo turno esce dalla coda. Una
// risposta senza immagine lascia l'icona, senza una casella vuota.
//
// Ciò che si sa resta per documento finché la riga c'è nell'albero, così un
// ridisegno non rifà la domanda e non lampeggia. L'URL `blob:` di
// un'immagine si rilascia quando la riga lascia l'albero, quando le miniature
// si spengono e quando l'albero si chiude. Un documento che cambia (lo dice
// `watchCraftPreviews`) perde la sua miniatura, e la riga in vista la richiede.
// Una risposta arrivata dopo che la riga se n'è andata (una rinomina, un
// cestino, una cartella chiusa) non entra.

import { orientationTransform } from "../editors/media/orientation";
import type { CraftPreviewImage } from "../host/craft";
import { formatTagOf, isRawPhoto } from "../ui/format-kind";
import type { Lifetime } from "../ui/lifetime";
import { appPreviewSubject, previewOf, watchCraftPreviews } from "./craft-previews";

/// Le domande a `craft.preview` in volo al più, per tutto l'albero.
export const TREE_THUMBS_IN_FLIGHT = 2;

/// Le specie Craft che hanno un'anteprima nel file.
const CRAFT_TAGS: ReadonlySet<string> = new Set(["VECTORCRAFT", "FIGCRAFT", "PHOTOCRAFT"]);

/// Un documento che può avere una miniatura nell'albero: un file Craft, un
/// RAW, un PDF o un documento di Word. Un XMP no: non ha un'immagine sua.
export function hasTreeThumbnail(doc: string): boolean {
  if (isRawPhoto(doc) || appPreviewSubject(doc) !== null) return true;
  const tag = formatTagOf(doc);
  return tag !== null && CRAFT_TAGS.has(tag);
}

/// Le miniature dell'albero, vive quanto la `Lifetime` del pannello.
export interface TreeThumbnails {
  /// Guarda le righe di `root` appena disegnate: quelle tenute si dipingono
  /// subito, le altre si chiedono quando entrano in vista.
  paint(root: HTMLElement): void;
  /// Le miniature si spengono: le domande in coda se ne vanno, le immagini si
  /// rilasciano e le righe riprendono l'icona.
  reset(): void;
}

interface Thumb {
  readonly url: string;
  readonly orientation: number;
  readonly raw: boolean;
}

/// La riga di una voce che ha un'icona scelta da chi scrive: quella vince.
const OWN_ICON = "ownIcon";

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

export function mountTreeThumbnails(lifetime: Lifetime): TreeThumbnails {
  /// Ciò che si sa di un documento: la miniatura, o `null` se non ne ha.
  const known = new Map<string, Thumb | null>();
  /// Le righe in vista che aspettano il loro turno, nell'ordine in cui sono
  /// entrate.
  const waiting = new Set<string>();
  const asking = new Set<string>();
  const visible = new Set<string>();
  /// Le icone che una miniatura ha preso il posto, per rimetterle.
  const icons = new WeakMap<HTMLElement, Node[]>();
  /// Quante volte le miniature si sono spente, e quante volte ogni documento
  /// ha perso la sua: una risposta chiesta prima non entra.
  let epoch = 0;
  const epochs = new Map<string, number>();
  let root: HTMLElement | null = null;
  let observer: IntersectionObserver | null = null;

  const rowsOf = (doc: string): HTMLElement[] =>
    root ? [...root.querySelectorAll<HTMLElement>(`.tree-row.leaf[data-path="${CSS.escape(doc)}"]`)] : [];

  const restore = (row: HTMLElement): void => {
    const icon = row.querySelector<HTMLElement>(":scope > .row-icon");
    const before = icon ? icons.get(icon) : undefined;
    if (!icon || !before) return;
    icon.replaceChildren(...before);
    icons.delete(icon);
  };

  const draw = (row: HTMLElement, thumb: Thumb | null): void => {
    if (!thumb) {
      restore(row);
      return;
    }
    const icon = row.querySelector<HTMLElement>(":scope > .row-icon");
    if (!icon) return;
    const shown = icon.querySelector<HTMLImageElement>(":scope > img.tree-thumb");
    if (shown?.getAttribute("src") === thumb.url) return;
    if (!icons.has(icon)) icons.set(icon, [...icon.childNodes]);
    const img = document.createElement("img");
    img.className = "tree-thumb";
    img.alt = "";
    img.decoding = "async";
    img.src = thumb.url;
    // Il JPEG di un RAW sta sul disco come la macchina l'ha scritto: lo
    // raddrizza la trasformazione, non il browser (T28).
    if (thumb.raw) {
      img.style.transform = orientationTransform(thumb.orientation);
      img.style.imageOrientation = "none";
    }
    icon.replaceChildren(img);
  };

  const paintDoc = (doc: string): void => {
    const thumb = known.get(doc);
    if (thumb === undefined) return;
    for (const row of rowsOf(doc)) draw(row, thumb);
  };

  const drop = (doc: string): void => {
    const thumb = known.get(doc);
    if (thumb) URL.revokeObjectURL(thumb.url);
    known.delete(doc);
  };

  const pump = (): void => {
    while (asking.size < TREE_THUMBS_IN_FLIGHT && waiting.size > 0) {
      const doc = waiting.values().next().value as string;
      waiting.delete(doc);
      if (!visible.has(doc) || known.has(doc) || asking.has(doc)) continue;
      void ask(doc);
    }
  };

  const ask = async (doc: string): Promise<void> => {
    asking.add(doc);
    const asked = epoch;
    const mine = epochs.get(doc) ?? 0;
    const answer = await previewOf(doc, "small").catch(() => null);
    asking.delete(doc);
    if (lifetime.closed) return;
    if (asked === epoch && mine === (epochs.get(doc) ?? 0) && rowsOf(doc).length > 0) {
      const image = answer?.preview.image ?? null;
      const blob = image ? imageBlob(image) : null;
      known.set(doc, image && blob ? { url: URL.createObjectURL(blob), orientation: image.orientation, raw: isRawPhoto(doc) } : null);
      paintDoc(doc);
    } else if (visible.has(doc)) {
      // Il documento è cambiato mentre la domanda volava, o le miniature
      // si sono spente e riaccese: vale ciò che `craft.preview` dice
      // adesso. La riga in vista non ha richiesto niente, perché la domanda
      // era ancora in volo (`want`).
      waiting.add(doc);
    }
    pump();
  };

  const want = (doc: string): void => {
    visible.add(doc);
    if (known.has(doc)) {
      paintDoc(doc);
      return;
    }
    if (asking.has(doc)) return;
    waiting.add(doc);
    pump();
  };

  const leave = (doc: string): void => {
    visible.delete(doc);
    waiting.delete(doc);
  };

  const forget = (doc: string): void => {
    const docs = doc === "" ? [...known.keys(), ...asking] : [doc];
    for (const each of docs) {
      epochs.set(each, (epochs.get(each) ?? 0) + 1);
      drop(each);
      for (const row of rowsOf(each)) restore(row);
      if (visible.has(each)) waiting.add(each);
    }
    pump();
  };

  const clear = (): void => {
    epoch += 1;
    observer?.disconnect();
    waiting.clear();
    visible.clear();
    for (const doc of [...known.keys()]) drop(doc);
  };

  watchCraftPreviews(lifetime, forget);
  lifetime.add(() => {
    clear();
    observer = null;
    root = null;
  });

  return {
    paint(next) {
      if (lifetime.closed) return;
      root = next;
      if (!observer) {
        // Senza `IntersectionObserver` non si sa che cosa è in vista: niente
        // miniature, invece di chiederle tutte.
        if (typeof IntersectionObserver === "undefined") return;
        observer = new IntersectionObserver((records) => {
          for (const record of records) {
            const doc = (record.target as HTMLElement).dataset.path;
            if (doc === undefined) continue;
            if (record.isIntersecting) want(doc);
            else leave(doc);
          }
        }, { rootMargin: "64px 0px" });
      }
      // L'albero è stato rifatto: le righe vecchie non ci sono più, e chi è
      // in vista lo ridice l'osservatore per le righe nuove.
      observer.disconnect();
      waiting.clear();
      visible.clear();
      const present = new Set<string>();
      for (const row of next.querySelectorAll<HTMLElement>(".tree-row.leaf[data-path]")) {
        const doc = row.dataset.path;
        if (doc === undefined || row.dataset[OWN_ICON] !== undefined || !hasTreeThumbnail(doc)) continue;
        present.add(doc);
        const thumb = known.get(doc);
        if (thumb !== undefined) draw(row, thumb);
        observer.observe(row);
      }
      for (const doc of [...known.keys()]) if (!present.has(doc)) drop(doc);
    },
    reset() {
      const rows = root ? [...root.querySelectorAll<HTMLElement>(".tree-row.leaf[data-path]")] : [];
      clear();
      for (const row of rows) restore(row);
    },
  };
}
