// Le note che un wikilink nomina e che non ci sono ancora (UX-016): la
// Scrittura le sottolinea a tratti, e al passaggio dice che un clic le crea.
// Chi lo sa è l'indice: qui si tiene l'ultima risposta per ogni coppia «nota
// che contiene il link, pagina scritta», come nelle schede (`note-cards.ts`),
// perché lo stesso nome porta a note diverse da cartelle diverse.
//
// Le domande si raccolgono e partono insieme, una risoluzione per link nuovo:
// una resa intera della Scrittura chiede tutti i suoi link nello stesso giro,
// e la Scrittura non chiede il link che si sta scrivendo (la sua sorgente è in
// vista), quindi una battuta non fa domande. Finché la risposta non c'è, o
// l'indice non risponde, il link si mostra come sempre: un tratteggio sbagliato
// direbbe una cosa falsa, uno che manca soltanto non la dice.
//
// Una nota che nasce può far esistere soltanto i link che mancavano: a ogni
// cambio dell'indice si richiedono quelli, e solo fra i chiesti di recente.
// Una nota spostata o tolta può togliere qualunque bersaglio: allora si
// richiedono tutti i recenti. Un vault nuovo li dimentica tutti.

import { resolvedReference } from "../host/query";
import type { Lifetime } from "../ui/lifetime";
import { onEvent } from "./kernel";
import { on, openVaultRoot } from "./store";

/// Un link chiesto più di così fa non si richiede a un cambio dell'indice: la
/// Scrittura che lo mostra lo richiede alla sua prossima resa.
const RECENT_MS = 10 * 60_000;
/// Quante risposte si tengono al più: oltre, si dimenticano le chieste meno di
/// recente.
const LIMIT = 2_000;

/// Ciò con cui si chiede all'indice; i test ne danno di finti.
export interface LinkTargetQueries {
  /// Il documento a cui porta `page` scritto in `from`, o `null`.
  resolve(page: string, from: string | undefined): Promise<string | null>;
  /// Il vault aperto adesso: una risposta di un altro vault non entra.
  vault(): string | null;
  now(): number;
}

interface Entry {
  readonly page: string;
  readonly from: string | undefined;
  /// `true` manca, `false` c'è, `undefined` non si sa ancora.
  missing: boolean | undefined;
  asked: number;
  /// L'ultima tornata che l'ha chiesta: una risposta più vecchia non entra.
  ticket: number;
}

export interface LinkTargetHub {
  /// La pagina `page` scritta in `from` non c'è: `true` soltanto quando
  /// l'indice l'ha detto. La prima volta la chiede.
  missing(page: string, from?: string): boolean;
  watch(listener: () => void): () => void;
  /// L'indice è cambiato: si richiedono i link che mancavano.
  refresh(): void;
  /// Un documento spostato o tolto: si richiedono tutti i link recenti.
  moved(): void;
  /// Un vault nuovo: tutto si dimentica.
  forget(): void;
  /// Le domande partite, per i test.
  settled(): Promise<void>;
}

function keyOf(page: string, from: string | undefined): string {
  return `${from ?? ""}\u0000${page}`;
}

export function createLinkTargetHub(queries: LinkTargetQueries): LinkTargetHub {
  let entries = new Map<string, Entry>();
  const listeners = new Set<() => void>();
  let generation = 0;
  let round = 0;
  let wanted = new Set<string>();
  let scheduled = false;
  const inflight = new Set<Promise<void>>();

  function changed(): void {
    for (const listener of [...listeners]) {
      try {
        listener();
      } catch (error) {
        console.error(error);
      }
    }
  }

  function schedule(): void {
    if (scheduled) return;
    scheduled = true;
    const run: Promise<void> = Promise.resolve().then(() => {
      scheduled = false;
      return flush();
    }).finally(() => {
      inflight.delete(run);
    });
    inflight.add(run);
  }

  /// Le risposte oltre `LIMIT`, le chieste meno di recente per prime.
  function trim(): void {
    if (entries.size <= LIMIT) return;
    const oldest = [...entries].sort(([, a], [, b]) => a.asked - b.asked);
    for (const [key] of oldest.slice(0, entries.size - LIMIT)) entries.delete(key);
  }

  async function flush(): Promise<void> {
    const vault = queries.vault();
    const asked = generation;
    const batch = [...wanted].map((key) => entries.get(key)).filter((entry): entry is Entry => entry !== undefined);
    wanted = new Set();
    if (!vault || batch.length === 0) return;
    const mine = ++round;
    for (const entry of batch) entry.ticket = mine;
    let different = false;
    await Promise.all(batch.map(async (entry) => {
      let missing: boolean | undefined;
      try {
        missing = (await queries.resolve(entry.page, entry.from)) === null;
      } catch (error) {
        // Un indice che non risponde lascia il link come si mostrava.
        console.error(error);
        return;
      }
      if (asked !== generation || queries.vault() !== vault) return;
      if (entry.ticket !== mine || entries.get(keyOf(entry.page, entry.from)) !== entry) return;
      if (entry.missing !== missing) different = true;
      entry.missing = missing;
    }));
    trim();
    if (different) changed();
  }

  function again(which: (entry: Entry) => boolean): void {
    const since = queries.now() - RECENT_MS;
    for (const [key, entry] of entries) if (entry.asked >= since && which(entry)) wanted.add(key);
    if (wanted.size > 0) schedule();
  }

  return {
    missing(page, from) {
      const key = keyOf(page, from);
      let entry = entries.get(key);
      if (!entry) {
        entry = { page, from, missing: undefined, asked: 0, ticket: 0 };
        entries.set(key, entry);
        wanted.add(key);
        schedule();
      }
      entry.asked = queries.now();
      return entry.missing === true;
    },
    watch(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    refresh() {
      again((entry) => entry.missing !== false);
    },
    moved() {
      again(() => true);
    },
    forget() {
      generation++;
      wanted = new Set();
      const any = [...entries.values()].some((entry) => entry.missing === true);
      entries = new Map();
      if (any) changed();
    },
    async settled() {
      while (inflight.size > 0) await Promise.all([...inflight]);
    },
  };
}

const hub = createLinkTargetHub({
  resolve: async (page, from) => {
    const target = await resolvedReference({ kind: "wiki", value: { page, heading: null, block: null } }, from);
    return target?.doc ?? null;
  },
  vault: () => openVaultRoot() ?? null,
  now: () => Date.now(),
});

/// La pagina `page` scritta nella nota `from` non c'è ancora.
export function linkTargetMissing(page: string, from?: string): boolean {
  return hub.missing(page, from);
}

/// Avvisa quando un link comincia o smette di mancare; torna lo smontaggio.
export function watchLinkTargets(listener: () => void): () => void {
  return hub.watch(listener);
}

/// Tiene le risposte allineate all'indice finché `lifetime` è vivo.
export function mountLinkTargets(lifetime: Lifetime): void {
  const refresh = (): void => hub.refresh();
  const moved = (): void => hub.moved();
  const forget = (): void => hub.forget();
  for (const event of ["index_updated", "batch_ended"] as const) lifetime.add(onEvent(event, refresh));
  for (const event of ["document_renamed", "document_removed"] as const) lifetime.add(onEvent(event, moved));
  for (const event of ["vault_opened", "vault_closed"] as const) lifetime.add(onEvent(event, forget));
  lifetime.add(on("vault", forget));
  lifetime.add(forget);
}
