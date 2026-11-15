// Le schede delle note (E11, T20): ciò che la Scrittura mostra al posto di un
// paragrafo fatto soltanto di un wikilink. Chi le possiede è l'indice: qui si
// tiene l'ultima risposta per ogni bersaglio scritto, chiesta la prima volta
// che la Scrittura ne mostra uno. Quando l'indice dice di essere cambiato le
// schede che si conoscono si richiedono, e la Scrittura sente soltanto quelle
// davvero diverse: una nota salvata non fa lampeggiare le schede. Una domanda
// per scheda, non una per battuta; un vault nuovo le dimentica.
//
// Che cosa c'è nella scheda lo dicono le proprietà della nota: `icon:`,
// `description:`, `cover:` e la prima data fra `date:`, `updated:`,
// `modified:` e `created:`. Il titolo è il nome della nota.
//
// La resa è di `editors/text/profiles/markdown/link-card.ts`.

import { api } from "../host/ipc";
import type { DocumentMatch } from "../host/contract";
import { resolvedReference } from "../host/query";
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

let known = new Map<string, NoteCardView>();
/// Le domande partite col vault di adesso: una risposta di un altro vault non
/// entra.
let generation = 0;
/// L'ultima domanda per ogni bersaglio: la risposta di una domanda vecchia
/// non copre quella di una nuova.
const asking = new Map<string, number>();
let next = 0;
const listeners = new Set<() => void>();

function changed(): void {
  for (const listener of [...listeners]) {
    try {
      listener();
    } catch (error) {
      console.error(error);
    }
  }
}

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

/// La scheda di una nota dalla risposta dell'indice; esportata per i test.
export function noteCardOf(doc: string, match: DocumentMatch | undefined, language = resolvedLanguage()): NoteCard {
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
  };
}

async function ask(page: string): Promise<void> {
  const vault = openVaultRoot();
  const asked = generation;
  const mine = ++next;
  asking.set(page, mine);
  if (!vault) return;
  const current = (): boolean => asked === generation && asking.get(page) === mine;
  const settle = (view: NoteCardView): void => {
    if (!current()) return;
    asking.delete(page);
    const before = known.get(page);
    known.set(page, view);
    if (JSON.stringify(before) !== JSON.stringify(view)) changed();
  };
  try {
    const target = await resolvedReference({ kind: "wiki", value: { page, heading: null, block: null } }, activeDoc() ?? undefined);
    if (!current()) return;
    if (!target || !isNoteDoc(target.doc)) {
      settle({ kind: "missing" });
      return;
    }
    const result = await api.queryIndex({
      kind: "documents",
      matching: { any: [{ all: [{ negated: false, predicate: { kind: "docs", docs: [target.doc] } }] }] },
      sort: null,
      select: { kind: "keys", keys: [...KEYS] },
      page: { offset: 0, limit: 1 },
      excerpts: "omit",
    }, ...vaultArg(vault));
    if (result.kind !== "documents") throw new Error(`expected documents, got ${result.kind}`);
    settle({ kind: "card", card: noteCardOf(target.doc, result.value.items.find((item) => item.doc === target.doc)) });
  } catch (error) {
    // Un indice che non risponde lascia il link com'è: la scheda è un modo di
    // mostrarlo, non un dato.
    console.error(error);
    settle({ kind: "missing" });
  }
}

/// Ciò che si sa della nota `page`. La prima volta la chiede, e intanto la
/// Scrittura mostra il link.
export function noteCardView(page: string): NoteCardView {
  const seen = known.get(page);
  if (seen) return seen;
  known.set(page, { kind: "loading" });
  void ask(page);
  return { kind: "loading" };
}

/// Avvisa quando una scheda cambia; torna lo smontaggio.
export function watchNoteCards(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/// Dimentica le risposte (un vault nuovo): la prossima resa le richiede.
function forget(): void {
  generation++;
  asking.clear();
  if (known.size === 0) return;
  known = new Map();
  changed();
}

/// L'indice è cambiato: si richiedono le schede che si conoscono, e la
/// Scrittura sente soltanto quella che risponde diversa.
function refresh(): void {
  for (const page of known.keys()) void ask(page);
}

/// Tiene le schede allineate all'indice finché `lifetime` è vivo.
export function mountNoteCards(lifetime: Lifetime): void {
  for (const event of ["index_updated", "batch_ended"] as const) lifetime.add(onEvent(event, refresh));
  for (const event of ["vault_opened", "vault_closed"] as const) lifetime.add(onEvent(event, forget));
  lifetime.add(on("vault", forget));
  lifetime.add(forget);
}
