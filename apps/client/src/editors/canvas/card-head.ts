// La testata di una scheda di file (N6 T22, prototipo T25): accanto al
// titolo «↩ N», quante note citano il file, e «×N», quante schede della
// stessa lavagna mostrano lo stesso file (le gemelle, C14).
//
// Il conto delle citazioni è dell'indice: lo chiede una porta che la shell
// riempie con la domanda `backlinks` di `query_index` (nessuna IPC nuova).
// Si chiede una volta per file, non per scheda né per resa, al più
// `CITATIONS_IN_FLIGHT` domande insieme; quando l'indice può essere cambiato
// la porta lo dice e i conti si richiedono tutti, dopo una pausa. Una
// risposta di un giro vecchio non scrive mai sopra una nuova. La testata è un
// ornamento: una domanda che fallisce lascia il numero com'era (o nessuno).
//
// Le gemelle si contano dal documento, a ogni resa: è una mappa dal percorso
// del file alle schede che lo mostrano (il `subpath` non conta, un estratto
// è una copia della stessa nota).

import { t, plural } from "../../i18n/strings";
import type { CanvasNode } from "./model";
import { cardTarget } from "./sources";

/** Ciò che la testata chiede all'indice. */
export interface CardCitations {
  /** Quante note citano `path` (un percorso del vault, senza `/` in testa). */
  count(path: string): Promise<number>;
  /** Avvisa quando i conti possono essere cambiati; torna come smettere. */
  watch(changed: () => void): () => void;
}

/** Quante domande all'indice sono in volo insieme, al più. */
export const CITATIONS_IN_FLIGHT = 4;

/** La pausa, in ms, fra l'avviso dell'indice e le domande nuove. */
export const CITATIONS_SETTLE_MS = 600;

/**
 * I conti delle citazioni per file, chiesti una volta e tenuti finché
 * l'indice non avvisa. `changed` arriva quando un conto nuovo è diverso da
 * quello che si mostrava.
 */
export class CitationCounts {
  readonly #port: CardCitations;
  readonly #changed: () => void;
  readonly #counts = new Map<string, number>();
  /** I file da chiedere, in ordine; quelli in volo stanno in `#asking`. */
  readonly #queue: string[] = [];
  readonly #queued = new Set<string>();
  readonly #asking = new Set<string>();
  #round = 0;
  #timer: ReturnType<typeof setTimeout> | undefined;
  #stop: (() => void) | null;
  #disposed = false;

  constructor(port: CardCitations, changed: () => void) {
    this.#port = port;
    this.#changed = changed;
    this.#stop = port.watch(() => this.#stale());
  }

  /** Il conto di `path` che si sa adesso (0 se non si sa ancora); se non si sa, lo chiede. */
  get(path: string): number {
    if (this.#disposed || path === "") return 0;
    const known = this.#counts.get(path);
    if (known === undefined) this.#ask(path);
    return known ?? 0;
  }

  /** Smette di ascoltare l'indice; le risposte in volo non scrivono più. */
  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#round += 1;
    clearTimeout(this.#timer);
    this.#timer = undefined;
    this.#stop?.();
    this.#stop = null;
    this.#queue.length = 0;
    this.#queued.clear();
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
      const round = this.#round;
      let answer: Promise<number>;
      try {
        answer = this.#port.count(path);
      } catch (error) {
        answer = Promise.reject(error);
      }
      answer.then(
        (count) => this.#answered(path, round, count),
        () => this.#answered(path, round, null),
      );
    }
  }

  #answered(path: string, round: number, count: number | null): void {
    this.#asking.delete(path);
    if (this.#disposed) return;
    if (round === this.#round && count !== null && Number.isFinite(count)) {
      const value = Math.max(0, Math.floor(count));
      // Un conto che non si sapeva si mostrava come nessuno (0).
      const before = this.#counts.get(path) ?? 0;
      this.#counts.set(path, value);
      if (before !== value) this.#changed();
    } else if (round !== this.#round) {
      // Chiesto prima dell'avviso: la risposta è vecchia, si chiede di nuovo.
      this.#ask(path);
    } else if (!this.#counts.has(path)) {
      // Fallita: per questo giro il conto è nessuno, e non si richiede a ogni resa.
      this.#counts.set(path, 0);
    }
    this.#pump();
  }

  /** L'indice dice che i conti possono essere cambiati: dopo una pausa si richiedono tutti. */
  #stale(): void {
    if (this.#disposed) return;
    clearTimeout(this.#timer);
    this.#timer = setTimeout(() => {
      this.#timer = undefined;
      if (this.#disposed) return;
      this.#round += 1;
      // I conti di prima restano in vista finché arrivano i nuovi: niente lampo.
      for (const path of this.#counts.keys()) this.#ask(path);
    }, CITATIONS_SETTLE_MS);
  }
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
