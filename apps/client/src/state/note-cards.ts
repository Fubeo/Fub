// Le schede delle note (E11, T20): ciò che la Scrittura mostra al posto di un
// paragrafo fatto soltanto di un wikilink. Chi le possiede è l'indice: qui si
// tiene l'ultima risposta per ogni link, cioè per la coppia «nota che contiene
// il link, bersaglio scritto» — lo stesso nome porta a note diverse da
// cartelle diverse.
//
// Le schede che contano sono quelle tenute: ogni superficie tiene i link
// delle schede che ha nel testo (`holdNoteCard`) e li lascia quando li perde
// o si smonta. Le domande si raccolgono e partono insieme: una risoluzione
// per link nuovo (poi resta finché un documento non si sposta o sparisce),
// **una** domanda `documents` per tutte le note tenute, e il conto dei
// collegamenti di ciascuna. Quando l'indice dice di essere cambiato si
// richiedono soltanto le schede tenute, e la Scrittura sente soltanto quelle
// davvero diverse: una nota salvata non fa lampeggiare le schede. Una scheda
// che nessuno tiene più si dimentica; un vault nuovo le dimentica tutte.
//
// Che cosa c'è nella scheda lo dicono le proprietà della nota: `icon:`,
// `description:`, `cover:` e la prima data fra `date:`, `updated:`,
// `modified:` e `created:`; poi quante note la citano. Il titolo è il nome
// della nota.
//
// La resa è di `editors/text/profiles/markdown/link-card.ts`.

import { api } from "../host/ipc";
import type { DocumentMatch } from "../host/contract";
import { backlinkCount, resolvedReference } from "../host/query";
import type { NoteCard, NoteCardView } from "../editors/text/profiles/markdown/link-card";
import { resolvedLanguage } from "../i18n/strings";
import { pageName } from "../rules/mirrored";
import { iconValue } from "./page-icons";
import type { Lifetime } from "../ui/lifetime";
import { onEvent } from "./kernel";
import { activeDoc } from "./layout";
import { on, openVaultRoot, vaultArg } from "./store";

/// Le chiavi del frontmatter che la scheda legge.
const KEYS = ["icon", "description", "cover", "date", "updated", "modified", "created"] as const;
/// Le chiavi della data, in ordine di preferenza.
const DATE_KEYS = ["date", "updated", "modified", "created"] as const;
/// Oltre questa misura la descrizione si taglia: la scheda mostra due righe.
const MAX_DESCRIPTION = 280;
/// Una scheda chiesta e non (ancora) tenuta resta questo tempo prima di
/// dimenticarla: la superficie la tiene subito dopo averla disegnata.
const UNHELD_GRACE_MS = 5_000;

/// Se il documento è una nota: le altre (un PDF, un foglio) restano link.
export function isNoteDoc(doc: string): boolean {
  return /\.(?:md|markdown)$/i.test(doc);
}

function text(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "";
}

/// Una data del frontmatter detta a parole (`10 novembre 2026`); un valore
/// che non è una data si mostra com'è, purché breve.
export function cardDate(value: unknown, language = resolvedLanguage()): string {
  const raw = text(value);
  if (raw === "") return "";
  const day = /^(\d{4})-(\d{2})-(\d{2})(?:[T ][\d:.]+(?:Z|[+-]\d{2}:?\d{2})?)?$/.exec(raw);
  if (day) {
    const date = new Date(Date.UTC(Number(day[1]), Number(day[2]) - 1, Number(day[3])));
    if (!Number.isNaN(date.getTime()) && date.getUTCDate() === Number(day[3])) {
      return date.toLocaleDateString(language, { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
    }
  }
  return raw.length <= 40 ? raw : "";
}

/// La scheda di una nota dalla risposta dell'indice e dal conto dei suoi
/// collegamenti; esportata per i test.
export function noteCardOf(doc: string, match: DocumentMatch | undefined, links = 0, language = resolvedLanguage()): NoteCard {
  const property = (key: string): unknown => match?.properties?.find((p) => p.key === key)?.value;
  const description = text(property("description"));
  let date = "";
  for (const key of DATE_KEYS) {
    date = cardDate(property(key), language);
    if (date !== "") break;
  }
  return {
    doc,
    title: pageName(doc),
    icon: iconValue(property("icon")) ?? "",
    description: description.length > MAX_DESCRIPTION ? `${description.slice(0, MAX_DESCRIPTION - 1)}…` : description,
    date,
    cover: text(property("cover")),
    links,
  };
}

/// Ciò con cui le schede chiedono all'indice; i test ne danno di finte.
export interface NoteCardQueries {
  /// Il documento a cui porta `page` scritto in `from`, o `null`.
  resolve(page: string, from: string | undefined): Promise<string | null>;
  /// Le proprietà delle note `docs`, in una domanda sola.
  documents(docs: readonly string[]): Promise<readonly DocumentMatch[]>;
  /// Quante note citano `doc`.
  links(doc: string): Promise<number>;
  /// Il vault aperto adesso: una risposta di un altro vault non entra.
  vault(): string | null;
  now(): number;
}

interface Entry {
  readonly page: string;
  readonly from: string | undefined;
  view: NoteCardView;
  /// Le superfici che la mostrano.
  holds: number;
  /// L'ultima volta che una superficie l'ha chiesta.
  asked: number;
  /// Il documento risolto: `undefined` da risolvere, `null` nessuno.
  doc: string | null | undefined;
  /// L'ultima tornata che l'ha chiesta.
  ticket: number;
}

export interface NoteCardHub {
  view(page: string, from?: string): NoteCardView;
  hold(page: string, from?: string): () => void;
  watch(listener: () => void): () => void;
  /// L'indice è cambiato: si richiedono le schede tenute.
  refresh(): void;
  /// Un documento spostato o tolto: le risoluzioni si rifanno.
  moved(): void;
  /// Un vault nuovo: tutto si dimentica.
  forget(): void;
  /// Le domande raccolte, per i test: si risolve quando la tornata è finita.
  settled(): Promise<void>;
}

function keyOf(page: string, from: string | undefined): string {
  return `${from ?? ""}\u0000${page}`;
}

export function createNoteCardHub(queries: NoteCardQueries): NoteCardHub {
  let entries = new Map<string, Entry>();
  const listeners = new Set<() => void>();
  /// Le domande partite col vault di adesso.
  let generation = 0;
  /// Il numero dell'ultima tornata partita.
  let round = 0;
  /// Le schede da chiedere alla prossima tornata (le nuove, o tutte le tenute
  /// dopo un cambio dell'indice).
  let wanted = new Set<string>();
  let scheduled: Promise<void> | null = null;
  /// Le tornate non ancora finite (per `settled`).
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
    const run: Promise<void> = Promise.resolve().then(() => {
      scheduled = null;
      return flush();
    }).finally(() => {
      inflight.delete(run);
    });
    scheduled = run;
    inflight.add(run);
  }

  function entryOf(page: string, from: string | undefined): Entry {
    const key = keyOf(page, from);
    let entry = entries.get(key);
    if (!entry) {
      entry = { page, from, view: { kind: "loading" }, holds: 0, asked: queries.now(), doc: undefined, ticket: 0 };
      entries.set(key, entry);
      wanted.add(key);
      schedule();
    }
    return entry;
  }

  /// Le schede che nessuno tiene, chieste da troppo: si dimenticano. Nessuna
  /// superficie le mostra, quindi nessuno va avvisato.
  function sweep(): void {
    const now = queries.now();
    for (const [key, entry] of entries) {
      if (entry.holds === 0 && now - entry.asked > UNHELD_GRACE_MS) entries.delete(key);
    }
  }

  async function flush(): Promise<void> {
    const vault = queries.vault();
    const asked = generation;
    const keys = wanted;
    wanted = new Set();
    const batch = [...keys].map((key) => entries.get(key)).filter((entry): entry is Entry => entry !== undefined);
    if (!vault || batch.length === 0) return;
    // Ogni scheda ricorda l'ultima tornata che l'ha chiesta: la risposta di
    // una tornata vecchia non copre quella di una nuova.
    const mine = ++round;
    for (const entry of batch) entry.ticket = mine;
    const live = (): boolean => asked === generation && queries.vault() === vault;
    const ours = (entry: Entry): boolean => entry.ticket === mine && entries.get(keyOf(entry.page, entry.from)) === entry;
    const views = new Map<Entry, NoteCardView>();
    try {
      await Promise.all(batch.filter((entry) => typeof entry.doc !== "string").map(async (entry) => {
        const doc = await queries.resolve(entry.page, entry.from).catch((error: unknown) => {
          console.error(error);
          return null;
        });
        if (ours(entry)) entry.doc = doc;
      }));
      if (!live()) return;
      const docs = [...new Set(batch.map((entry) => entry.doc).filter((doc): doc is string => typeof doc === "string" && isNoteDoc(doc)))];
      const [matches, counts] = await Promise.all([
        docs.length > 0 ? queries.documents(docs) : Promise.resolve([] as readonly DocumentMatch[]),
        Promise.all(docs.map((doc) => queries.links(doc).catch(() => 0))),
      ]);
      if (!live()) return;
      const byDoc = new Map(matches.map((match) => [match.doc, match] as const));
      const linksOf = new Map(docs.map((doc, index) => [doc, counts[index] ?? 0] as const));
      for (const entry of batch) {
        const doc = entry.doc;
        views.set(entry, typeof doc === "string" && isNoteDoc(doc)
          ? { kind: "card", card: noteCardOf(doc, byDoc.get(doc), linksOf.get(doc) ?? 0) }
          : { kind: "missing" });
      }
    } catch (error) {
      // Un indice che non risponde lascia i link come sono: la scheda è un
      // modo di mostrarli, non un dato.
      console.error(error);
      if (!live()) return;
      for (const entry of batch) views.set(entry, { kind: "missing" });
    }
    let different = false;
    for (const [entry, view] of views) {
      if (!ours(entry)) continue;
      if (JSON.stringify(entry.view) !== JSON.stringify(view)) different = true;
      entry.view = view;
    }
    sweep();
    if (different) changed();
  }

  function refresh(): void {
    sweep();
    for (const [key, entry] of entries) if (entry.holds > 0) wanted.add(key);
    if (wanted.size > 0) schedule();
  }

  return {
    view(page, from) {
      const entry = entryOf(page, from);
      entry.asked = queries.now();
      return entry.view;
    },
    hold(page, from) {
      const entry = entryOf(page, from);
      entry.holds++;
      let held = true;
      return () => {
        if (!held) return;
        held = false;
        entry.holds = Math.max(0, entry.holds - 1);
        entry.asked = queries.now();
      };
    },
    watch(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    refresh,
    moved() {
      for (const entry of entries.values()) entry.doc = undefined;
      refresh();
    },
    forget() {
      generation++;
      wanted = new Set();
      if (entries.size === 0) return;
      // Le superfici che le tengono le richiedono alla prossima resa: le
      // prenotazioni restano, le risposte no.
      const kept = new Map<string, Entry>();
      for (const [key, entry] of entries) {
        if (entry.holds === 0) continue;
        entry.view = { kind: "loading" };
        entry.doc = undefined;
        kept.set(key, entry);
        wanted.add(key);
      }
      entries = kept;
      if (wanted.size > 0) schedule();
      changed();
    },
    async settled() {
      while (inflight.size > 0) await Promise.all([...inflight]);
    },
  };
}

/// Le schede della finestra, sulle domande vere all'indice.
const hub = createNoteCardHub({
  resolve: async (page, from) => {
    const target = await resolvedReference({ kind: "wiki", value: { page, heading: null, block: null } }, from ?? activeDoc() ?? undefined);
    return target?.doc ?? null;
  },
  documents: async (docs) => {
    const vault = openVaultRoot();
    const result = await api.queryIndex({
      kind: "documents",
      matching: { any: [{ all: [{ negated: false, predicate: { kind: "docs", docs: [...docs] } }] }] },
      sort: null,
      select: { kind: "keys", keys: [...KEYS] },
      page: { offset: 0, limit: docs.length },
      excerpts: "omit",
    }, ...vaultArg(vault));
    if (result.kind !== "documents") throw new Error(`expected documents, got ${result.kind}`);
    return result.value.items;
  },
  links: (doc) => backlinkCount(doc),
  vault: () => openVaultRoot() ?? null,
  now: () => Date.now(),
});

/// Ciò che si sa della nota `page` scritta nella nota `from`. La prima volta
/// la chiede, e intanto la Scrittura mostra il link.
export function noteCardView(page: string, from?: string): NoteCardView {
  return hub.view(page, from);
}

/// Una superficie mostra la scheda di `page` scritta in `from`: finché la
/// tiene, un cambio dell'indice la richiede. Torna come lasciarla.
export function holdNoteCard(page: string, from?: string): () => void {
  return hub.hold(page, from);
}

/// Avvisa quando una scheda cambia; torna lo smontaggio.
export function watchNoteCards(listener: () => void): () => void {
  return hub.watch(listener);
}

/// Tiene le schede allineate all'indice finché `lifetime` è vivo.
export function mountNoteCards(lifetime: Lifetime): void {
  const refresh = (): void => hub.refresh();
  const moved = (): void => hub.moved();
  const forget = (): void => hub.forget();
  for (const event of ["index_updated", "batch_ended"] as const) lifetime.add(onEvent(event, refresh));
  for (const event of ["document_renamed", "document_removed"] as const) lifetime.add(onEvent(event, moved));
  for (const event of ["vault_opened", "vault_closed"] as const) lifetime.add(onEvent(event, forget));
  lifetime.add(on("vault", forget));
  lifetime.add(forget);
}
