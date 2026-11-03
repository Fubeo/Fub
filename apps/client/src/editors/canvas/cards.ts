// Il contratto delle schede della lavagna: la forma che la tela e i renderer
// di ogni specie (nota, foglio, PDF, immagine, pagina web, file) condividono.
//
// Una scheda di file mostra il contenuto del suo file. Può essere *viva*
// (il renderer ha aperto il file e ci si può entrare, scorrere, scegliere) o
// *ferma* (mostra l'ultima immagine che ha avuto, o il suo contenuto inerte,
// senza nessuna risorsa aperta). Quali schede sono vive lo decide
// `liveCardIds`, e `updateLiveCards` le cambia di modo a fine gesto.
//
// La specie viene dall'estensione del file, come fa la shell in
// `ui/format-kind.ts`: il client non sa il provider di un file senza
// chiederlo. Un renderer legge e non scrive mai il file della sua scheda.
//
// Qui niente DOM vivo: solo tipi e funzioni pure, così la tela e i test le
// usano senza montare niente. La pagina di riferimento è
// `docs/reference/canvas-cards.md`.

import { formatKindOf } from "../../ui/format-kind";
import type { Lifetime } from "../../ui/lifetime";
import { mediaKindOfId } from "../media/media-types";
import type { CanvasNode } from "./model";

/// Viva: il renderer ha aperto il file. Ferma: nessuna risorsa aperta.
export type CardMode = "live" | "snapshot";

/// La specie di una scheda, che sceglie il renderer.
export type CardKind = "note" | "document" | "sheet" | "pdf" | "image" | "web" | "craft" | "file";

/// La specie di una scheda dalla sua forma: `null` per testo e gruppi, che
/// la tela disegna da sé.
///
/// Per un file conta l'estensione del percorso, in minuscolo, senza
/// `subpath`: un punto nel nome di una cartella o dopo il `#` non conta.
/// L'SVG è un'immagine ferma, anche se `formatKindOf` lo dice disegno.
/// `craft` non ha ancora un'estensione che ci porti (arriva con T18).
export function cardKindOf(node: CanvasNode): CardKind | null {
  switch (node.type) {
    case "text":
    case "group":
      return null;
    case "link":
      return "web";
    case "file":
      return fileKindOf(typeof node.file === "string" ? node.file : "");
  }
}

function fileKindOf(file: string): CardKind {
  const path = withoutSubpath(file);
  const extension = extensionOf(path);
  if (extension === null) return "file";
  if (extension === "md" || extension === "markdown") return "note";
  switch (formatKindOf(path)) {
    case "word":
    case "odt":
      return "document";
    case "sheet":
      return "sheet";
    default:
      break;
  }
  switch (mediaKindOfId(path)) {
    case "pdf":
      return "pdf";
    case "image":
      return "image";
    default:
      return "file";
  }
}

/// Il percorso senza `#…`: `Nota.md#1.2 Titolo` → `Nota.md`.
function withoutSubpath(file: string): string {
  const hash = file.indexOf("#");
  return hash < 0 ? file : file.slice(0, hash);
}

/// L'estensione dell'ultimo segmento, in minuscolo; `null` se non c'è (un
/// nome senza punto, o un nome nascosto come `.md`).
function extensionOf(path: string): string | null {
  const base = path.split("/").pop() ?? "";
  const point = base.lastIndexOf(".");
  if (point <= 0 || point === base.length - 1) return null;
  return base.slice(point + 1).toLowerCase();
}

/// Una misura in unità della lavagna.
export interface CardSize {
  readonly width: number;
  readonly height: number;
}

/// Un rettangolo in unità della lavagna.
export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/// Un'immagine ferma e il suo peso in memoria, che la cache conta.
export interface CardSnapshot {
  readonly bitmap: ImageBitmap | HTMLCanvasElement;
  readonly bytes: number;
}

/// Le immagini ferme di un file, per parte. La parte dice che cosa è e a che
/// larghezza, arrotondata a 32 px, ed è sempre fatta da `snapshotPart`:
/// `whole@640` per l'immagine intera, `page-3@640` per una pagina.
export interface CardSnapshots {
  get(path: string, part: string): CardSnapshot | undefined;
  put(path: string, part: string, snapshot: CardSnapshot): void;
  /// Dimentica tutte le parti del file (cambiato, spostato, tolto).
  forget(path: string): void;
}

/// Il passo a cui si arrotonda la larghezza di un'immagine ferma.
export const SNAPSHOT_WIDTH_STEP = 32;

/// La parte di un'immagine ferma: `snapshotPart("page-3", 650)` → `page-3@640`.
///
/// La larghezza si arrotonda al multiplo di 32 più vicino, mai sotto 32, così
/// una scheda che cambia misura di poco ritrova la stessa immagine. Il
/// prefisso non è vuoto e non contiene `@`, che separa la larghezza.
export function snapshotPart(prefix: string, width: number): string {
  if (prefix === "" || prefix.includes("@")) {
    throw new RangeError(`snapshot part prefix ${JSON.stringify(prefix)} is not valid`);
  }
  if (!Number.isFinite(width)) {
    throw new RangeError(`snapshot part width ${width} is not finite`);
  }
  const steps = Math.max(1, Math.round(width / SNAPSHOT_WIDTH_STEP));
  return `${prefix}@${steps * SNAPSHOT_WIDTH_STEP}`;
}

/// Ciò che la tela dà a una scheda montata.
export interface CardContext {
  /// Il file, dal vault, senza `subpath`.
  readonly path: string;
  /// `#page=3`, `#Titolo`…, o `null`.
  readonly subpath: string | null;
  /// La lavagna che contiene la scheda.
  readonly documentId: string;
  /// Si chiude con `destroy`: ascolti, osservatori e timer passano da qui.
  readonly lifetime: Lifetime;
  readonly snapshots: CardSnapshots;
  /// La misura della scheda, in unità della lavagna.
  size(): CardSize;
  zoom(): number;
  /// Il file non c'è: la tela mostra la scheda «File mancante» (arriva con T16).
  missing(): void;
}

/// Una scheda montata da un renderer.
export interface CardView {
  /// Passa da viva a ferma o al contrario; la tela la chiama solo se cambia.
  setMode(mode: CardMode): void;
  /// La scheda ha cambiato misura (a fine gesto).
  resize?(): void;
  /// Entra nella scheda; `false` se non c'è niente in cui entrare.
  enter?(): boolean;
  leave?(): void;
  /// `true` se il tasto è della scheda e la tela non deve usarlo.
  key?(event: KeyboardEvent): boolean;
  /// La pagina mostrata, da 1 (il PDF).
  page?(): number;
  destroy(): void;
}

/// Chi sa mostrare una o più specie.
export interface CardRenderer {
  readonly kinds: readonly CardKind[];
  mount(node: CanvasNode, host: HTMLElement, mode: CardMode, context: CardContext): CardView;
}

export interface CardRegistry {
  /// Il renderer della specie, o `null`: allora la scheda è una scheda di file.
  rendererFor(kind: CardKind): CardRenderer | null;
}

/// Il registro per specie. Due renderer per la stessa specie sono un errore
/// detto subito, non al primo uso.
export function createCardRegistry(renderers: readonly CardRenderer[]): CardRegistry {
  const byKind = new Map<CardKind, CardRenderer>();
  for (const renderer of renderers) {
    for (const kind of renderer.kinds) {
      const known = byKind.get(kind);
      if (known !== undefined && known !== renderer) {
        throw new Error(`card kind ${kind} has two renderers`);
      }
      byKind.set(kind, renderer);
    }
  }
  return { rendererFor: (kind) => byKind.get(kind) ?? null };
}

/// Lo zoom da cui in su una scheda può essere viva (valore di partenza).
export const LIVE_ZOOM_MIN = 0.35;
/// Di quanto si allarga la vista per lato, in frazione della sua misura
/// (valore di partenza).
export const LIVE_MARGIN = 0.5;
/// Il massimo di schede vive insieme (valore di partenza).
export const MAX_LIVE_CARDS = 40;

/// Le schede che devono essere vive: dentro la vista allargata di metà per
/// lato, dallo zoom 0,35 in su, al più `limit`, le più vicine al centro.
///
/// «Dentro» vuol dire che il rettangolo della scheda tocca la vista allargata
/// (anche solo sul bordo). Contano solo le schede con una specie. La distanza
/// è quella fra il centro della vista e il punto più vicino della scheda: una
/// scheda che copre il centro è a distanza zero. A pari distanza vince
/// l'ordine del file.
export function liveCardIds(
  nodes: readonly CanvasNode[],
  view: Rect,
  zoom: number,
  limit: number = MAX_LIVE_CARDS,
): Set<string> {
  const live = new Set<string>();
  if (!(zoom >= LIVE_ZOOM_MIN)) return live;
  if (!(view.width > 0) || !(view.height > 0)) return live;
  const most = Math.floor(limit);
  if (!(most > 0)) return live;

  const left = view.x - view.width * LIVE_MARGIN;
  const top = view.y - view.height * LIVE_MARGIN;
  const right = view.x + view.width * (1 + LIVE_MARGIN);
  const bottom = view.y + view.height * (1 + LIVE_MARGIN);
  const centerX = view.x + view.width / 2;
  const centerY = view.y + view.height / 2;

  const inside: { readonly id: string; readonly distance: number; readonly order: number }[] = [];
  nodes.forEach((node, order) => {
    if (cardKindOf(node) === null) return;
    const nodeRight = node.x + node.width;
    const nodeBottom = node.y + node.height;
    if (node.x > right || nodeRight < left || node.y > bottom || nodeBottom < top) return;
    const dx = Math.max(node.x - centerX, 0, centerX - nodeRight);
    const dy = Math.max(node.y - centerY, 0, centerY - nodeBottom);
    inside.push({ id: node.id, distance: dx * dx + dy * dy, order });
  });

  if (inside.length > most) {
    inside.sort((a, b) => a.distance - b.distance || a.order - b.order);
    inside.length = most;
  }
  for (const card of inside) live.add(card.id);
  return live;
}

/// La forma del lavoro rimandato della penna (`PenQuiet` di N4): un lavoro
/// per chiave, eseguito quando la penna è su.
export interface CardQuiet {
  defer(key: string, work: () => void): void;
}

/// La chiave del lavoro rimandato che cambia modo alle schede.
export const CARD_QUIET_KEY = "cards";

/// Mette ogni scheda nel modo voluto, nel lavoro rimandato «cards».
///
/// Tutto avviene dentro il lavoro: lì si leggono le schede montate in quel
/// momento, si chiama `setMode` solo dove il modo cambia e si aggiorna
/// `current`. `wanted` si copia subito, perché è la decisione di adesso. Una
/// scheda non più montata esce da `current`. Se un `setMode` lancia, le altre
/// schede cambiano lo stesso, quella resta col modo di prima e l'errore esce
/// alla fine.
export function updateLiveCards(
  cards: ReadonlyMap<string, CardView>,
  wanted: ReadonlySet<string>,
  current: Map<string, CardMode>,
  quiet: CardQuiet,
): void {
  const want = new Set(wanted);
  quiet.defer(CARD_QUIET_KEY, () => {
    let failure: { readonly error: unknown } | null = null;
    for (const id of [...current.keys()]) {
      if (!cards.has(id)) current.delete(id);
    }
    for (const [id, card] of cards) {
      const mode: CardMode = want.has(id) ? "live" : "snapshot";
      if (current.get(id) === mode) continue;
      try {
        card.setMode(mode);
        current.set(id, mode);
      } catch (error) {
        failure ??= { error };
      }
    }
    if (failure !== null) throw failure.error;
  });
}
