// La testata di una scheda di file (N6 T22, prototipo T25): accanto al
// titolo «↩ N», quante note citano il file, e «×N», quante schede della
// stessa lavagna mostrano lo stesso file (le gemelle, C14).
//
// Il conto delle citazioni è dell'indice: lo chiede una porta che la shell
// riempie con le domande di `query_index` (nessuna IPC nuova). Una lavagna
// può avere duemila schede, e la testata è un ornamento: si chiede soltanto
// per le schede in vista o vicine (la zona di `headZonePaths`, la stessa
// delle schede vive), una volta per file, al più `CITATIONS_IN_FLIGHT`
// domande insieme. Una scheda che entra nella zona chiede il suo conto se non
// l'ha o se è vecchio.
//
// Quando l'indice cambia, la porta dice quali documenti (o «non so»):
// diventano vecchi solo i conti che il cambio può toccare, cioè quelli dei
// documenti stessi, dei file che quei documenti citavano (le note che citano
// un file vengono con il suo conto) e dei file che citano adesso (lo dice la
// porta). Con «non so» diventano vecchi tutti. In ogni caso si richiedono
// subito solo quelli nella zona; gli altri aspettano di entrarci. Una
// risposta chiesta prima che il conto diventasse vecchio non scrive mai
// sopra: ogni file ha la sua epoca. Una domanda che fallisce lascia il numero
// com'era (o nessuno).
//
// Le gemelle si contano dal documento, a ogni resa: è una mappa dal percorso
// del file alle schede che lo mostrano (il `subpath` non conta, un estratto
// è una copia della stessa nota).

import { t, plural } from "../../i18n/strings";
import { LIVE_MARGIN, LIVE_ZOOM_MIN } from "./cards";
import type { CanvasNode } from "./model";
import { cardTarget } from "./sources";

/** La risposta dell'indice per un file. */
export interface CitationCount {
  /** Quante note citano il file. */
  readonly total: number;
  /** Le note che lo citano, se l'indice le ha date tutte; `null` se non si sa. */
  readonly citers: readonly string[] | null;
}

/** Ciò che la testata chiede all'indice. */
export interface CardCitations {
  /** Chi cita `path` (un percorso del vault, senza `/` in testa), e quanti sono. */
  count(path: string): Promise<CitationCount>;
  /** I file di `among` che `doc` cita adesso. */
  linksFrom(doc: string, among: readonly string[]): Promise<readonly string[]>;
  /**
   * Avvisa quando i conti possono essere cambiati, coi documenti cambiati
   * (`null`: non si sa quali); torna come smettere.
   */
  watch(changed: (docs: readonly string[] | null) => void): () => void;
}

/** Quante domande all'indice sono in volo insieme, al più. */
export const CITATIONS_IN_FLIGHT = 4;

/** La pausa, in ms, fra l'avviso dell'indice e le domande nuove. */
export const CITATIONS_SETTLE_MS = 600;

/** Oltre questi documenti cambiati in una pausa si fa come con «non so». */
export const CITATIONS_TOUCHED_MAX = 16;

interface Known {
  value: number;
  /** Le note che citano il file, se si sanno tutte. */
  citers: ReadonlySet<string> | null;
  /** `false`: l'indice è cambiato dopo la risposta, il conto va richiesto. */
  fresh: boolean;
}

/**
 * I conti delle citazioni per file, chiesti solo per la zona e tenuti finché
 * l'indice non li rende vecchi. `changed` arriva quando un conto nuovo è
 * diverso da quello che si mostrava.
 */
export class CitationCounts {
  readonly #port: CardCitations;
  readonly #changed: () => void;
  readonly #known = new Map<string, Known>();
  /** L'epoca di ogni file: cresce quando il suo conto diventa vecchio. */
  readonly #epochs = new Map<string, number>();
  /** I file della zona di adesso: solo questi si chiedono. */
  #wanted = new Set<string>();
  /** I file da chiedere, in ordine; quelli in volo stanno in `#asking`. */
  readonly #queue: string[] = [];
  readonly #queued = new Set<string>();
  readonly #asking = new Set<string>();
  /** I documenti cambiati nella pausa in corso; `null`: non si sa quali. */
  #touched: Set<string> | null | undefined;
  #timer: ReturnType<typeof setTimeout> | undefined;
  #stop: (() => void) | null;
  #disposed = false;

  constructor(port: CardCitations, changed: () => void) {
    this.#port = port;
    this.#changed = changed;
    this.#stop = port.watch((docs) => this.#indexChanged(docs));
  }

  /** Il conto di `path` che si sa adesso (0 se non si sa). Non chiede niente. */
  get(path: string): number {
    if (this.#disposed || path === "") return 0;
    return this.#known.get(path)?.value ?? 0;
  }

  /**
   * La zona di adesso: chiede i file che non hanno un conto o l'hanno
   * vecchio, e lascia in coda solo quelli che ci sono ancora.
   */
  want(paths: Iterable<string>): void {
    if (this.#disposed) return;
    const wanted = new Set<string>();
    for (const path of paths) if (path !== "") wanted.add(path);
    this.#wanted = wanted;
    if (this.#queue.length > 0) {
      const kept = this.#queue.filter((path) => wanted.has(path));
      this.#queue.length = 0;
      this.#queue.push(...kept);
      this.#queued.clear();
      for (const path of kept) this.#queued.add(path);
    }
    for (const path of wanted) {
      if (this.#known.get(path)?.fresh !== true) this.#ask(path);
    }
  }

  /** Smette di ascoltare l'indice; le risposte in volo non scrivono più. */
  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    clearTimeout(this.#timer);
    this.#timer = undefined;
    this.#stop?.();
    this.#stop = null;
    this.#queue.length = 0;
    this.#queued.clear();
    this.#wanted.clear();
  }

  #ask(path: string): void {
    if (this.#queued.has(path) || this.#asking.has(path)) return;
    this.#queued.add(path);
    this.#queue.push(path);
    this.#pump();
  }

  #pump(): void {
    while (!this.#disposed && this.#asking.size < CITATIONS_IN_FLIGHT && this.#queue.length > 0) {
      const path = this.#queue.shift()!;
      this.#queued.delete(path);
      this.#asking.add(path);
      const epoch = this.#epochs.get(path) ?? 0;
      let answer: Promise<CitationCount>;
      try {
        answer = this.#port.count(path);
      } catch (error) {
        answer = Promise.reject(error);
      }
      answer.then(
        (count) => this.#answered(path, epoch, count),
        () => this.#answered(path, epoch, null),
      );
    }
  }

  #answered(path: string, epoch: number, count: CitationCount | null): void {
    this.#asking.delete(path);
    if (this.#disposed) return;
    const known = this.#known.get(path);
    if (epoch !== (this.#epochs.get(path) ?? 0)) {
      // Chiesto prima che il conto diventasse vecchio: la risposta non vale, e
      // si richiede se il file è ancora nella zona.
      if (this.#wanted.has(path)) this.#ask(path);
    } else if (count !== null && Number.isFinite(count.total)) {
      const value = Math.max(0, Math.floor(count.total));
      // Le note che citano si tengono solo se sono tutte: altrimenti ogni
      // cambio di link può toccare questo conto.
      const citers = count.citers !== null && count.citers.length >= value ? new Set(count.citers) : null;
      // Un conto che non si sapeva si mostrava come nessuno (0).
      const before = known?.value ?? 0;
      this.#known.set(path, { value, citers, fresh: true });
      if (before !== value) this.#changed();
    } else if (known) {
      // Fallita: il numero resta com'era, e non si richiede fino al prossimo cambio.
      known.fresh = true;
    } else {
      this.#known.set(path, { value: 0, citers: null, fresh: true });
    }
    this.#pump();
  }

  /** L'indice è cambiato: si raccolgono i documenti, e dopo una pausa si fanno i conti. */
  #indexChanged(docs: readonly string[] | null): void {
    if (this.#disposed) return;
    if (docs === null) {
      this.#touched = null;
    } else if (this.#touched !== null) {
      const touched = this.#touched ?? new Set<string>();
      for (const doc of docs) touched.add(doc.replace(/^\/+/, ""));
      this.#touched = touched.size > CITATIONS_TOUCHED_MAX ? null : touched;
    }
    clearTimeout(this.#timer);
    this.#timer = setTimeout(() => this.#settle(), CITATIONS_SETTLE_MS);
  }

  #settle(): void {
    this.#timer = undefined;
    const touched = this.#touched;
    this.#touched = undefined;
    if (this.#disposed || touched === undefined) return;
    // Le domande in volo sono partite prima del cambio: la loro risposta può
    // essere vecchia, e non scrive.
    if (touched === null) {
      this.#makeStale([...this.#known.keys(), ...this.#asking]);
      return;
    }
    const hit: string[] = [...this.#asking];
    for (const [path, known] of this.#known) {
      if (touched.has(path) || known.citers === null) hit.push(path);
      else for (const citer of known.citers) {
        if (touched.has(citer)) {
          hit.push(path);
          break;
        }
      }
    }
    this.#makeStale(hit);
    // I file che i documenti cambiati citano adesso: fra quelli che si sanno.
    const among = [...this.#known.keys()].filter((path) => this.#known.get(path)!.fresh);
    if (among.length === 0) return;
    for (const doc of touched) {
      let links: Promise<readonly string[]>;
      try {
        links = this.#port.linksFrom(doc, among);
      } catch (error) {
        links = Promise.reject(error);
      }
      links.then(
        (paths) => {
          if (!this.#disposed) this.#makeStale(paths.filter((path) => this.#known.has(path)));
        },
        // Non si sa che cosa cita: come con «non so».
        () => {
          if (!this.#disposed) this.#makeStale(this.#known.keys());
        },
      );
    }
  }

  /**
   * Rende vecchi i conti di `paths` (e le risposte in volo per loro) e
   * richiede subito quelli della zona.
   */
  #makeStale(paths: Iterable<string>): void {
    for (const path of new Set(paths)) {
      const known = this.#known.get(path);
      if (known) known.fresh = false;
      else if (!this.#asking.has(path)) continue;
      this.#epochs.set(path, (this.#epochs.get(path) ?? 0) + 1);
      if (this.#wanted.has(path)) this.#ask(path);
    }
  }
}

/**
 * La zona in cui si chiedono i conti: le schede di file che toccano la vista
 * allargata di `LIVE_MARGIN` per lato, dallo zoom `LIVE_ZOOM_MIN` in su (sotto,
 * la testata non si vede: la scheda mostra il titolo grande), più quelle di
 * `kept` (l'attiva, quella che scrive), dovunque siano. Torna i percorsi.
 */
export function headZonePaths(
  nodes: readonly CanvasNode[],
  view: { readonly x: number; readonly y: number; readonly width: number; readonly height: number },
  zoom: number,
  kept: ReadonlySet<string> = new Set(),
): Set<string> {
  const paths = new Set<string>();
  const near = zoom >= LIVE_ZOOM_MIN && view.width > 0 && view.height > 0;
  const left = view.x - view.width * LIVE_MARGIN;
  const top = view.y - view.height * LIVE_MARGIN;
  const right = view.x + view.width * (1 + LIVE_MARGIN);
  const bottom = view.y + view.height * (1 + LIVE_MARGIN);
  for (const node of nodes) {
    if (node.type !== "file") continue;
    const inside = near && !(node.x > right || node.x + node.width < left || node.y > bottom || node.y + node.height < top);
    if (!inside && !kept.has(node.id)) continue;
    const path = cardFilePath(node);
    if (path !== "") paths.add(path);
  }
  return paths;
}

/** Il file che la scheda mostra, per le gemelle e le citazioni; `""` se non è di file. */
export function cardFilePath(node: CanvasNode): string {
  if (node.type !== "file") return "";
  return cardTarget(node).path.replace(/^\/+/, "").trim();
}

/**
 * Le gemelle della lavagna: per ogni file che più schede mostrano, gli id di
 * quelle schede nell'ordine del documento. Un file con una scheda sola non c'è.
 */
export function twinGroups(nodes: readonly CanvasNode[]): Map<string, readonly string[]> {
  const all = new Map<string, string[]>();
  for (const node of nodes) {
    const path = cardFilePath(node);
    if (path === "") continue;
    const ids = all.get(path);
    if (ids) ids.push(node.id);
    else all.set(path, [node.id]);
  }
  const groups = new Map<string, readonly string[]>();
  for (const [path, ids] of all) if (ids.length > 1) groups.set(path, ids);
  return groups;
}

/**
 * Mette nella testata, subito dopo il titolo, «↩ N» (se `cites` > 0) e «×N»
 * (se `twins` > 1), o li toglie. Non riscrive ciò che è già giusto.
 */
export function syncCardHead(title: HTMLElement, cites: number, twins: number): void {
  const handle = title.parentElement;
  if (!handle) return;
  let citesEl = handle.querySelector<HTMLElement>(":scope > .canvas-node-cites");
  let twinsEl = handle.querySelector<HTMLButtonElement>(":scope > .canvas-node-twins");
  if (cites > 0) {
    if (!citesEl) {
      citesEl = document.createElement("span");
      citesEl.className = "canvas-node-cites";
      const shown = document.createElement("span");
      shown.setAttribute("aria-hidden", "true");
      const said = document.createElement("span");
      said.className = "sr-only";
      citesEl.append(shown, said);
    }
    const [shown, said] = citesEl.children as unknown as [HTMLElement, HTMLElement];
    const mark = `↩ ${cites}`;
    if (shown.textContent !== mark) shown.textContent = mark;
    const words = plural(cites, "canvas.card.cites.one", "canvas.card.cites", { n: cites });
    if (said.textContent !== words) said.textContent = words;
  } else {
    citesEl?.remove();
    citesEl = null;
  }
  if (twins > 1) {
    if (!twinsEl) {
      twinsEl = document.createElement("button");
      twinsEl.type = "button";
      twinsEl.className = "canvas-node-twins";
      twinsEl.dataset.twins = "";
    }
    const mark = `×${twins}`;
    if (twinsEl.textContent !== mark) twinsEl.textContent = mark;
    const words = t("canvas.card.twins", { n: twins });
    if (twinsEl.getAttribute("aria-label") !== words) twinsEl.setAttribute("aria-label", words);
  } else {
    twinsEl?.remove();
    twinsEl = null;
  }
  // L'ordine: il titolo, «↩ N», «×N», poi il resto della riga.
  let after: Element = title;
  for (const el of [citesEl, twinsEl]) {
    if (!el) continue;
    if (after.nextElementSibling !== el) after.after(el);
    after = el;
  }
}
