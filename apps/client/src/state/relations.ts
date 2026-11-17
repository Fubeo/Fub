// Le note di una Relazione (T35), per l'editor della testata: cercarle dentro
// il bersaglio del registro e crearne una che non c'è. Il bersaglio lo dice il
// registro dei tipi (`targets`, T35a); quali note siano di un tipo lo dice il
// core (`note.type.get`), mai una regola rifatta qui.
//
// Arriva con un `import()` dall'editor che la usa: il chunk che apre la nota
// non la porta.
import type { RelationTarget } from "../editors/text/profiles/markdown/page/properties/kind";
import type { RelationNote } from "../editors/text/profiles/markdown/page/properties/values";
import { notesInFolder, notesWithProperty } from "../host/query";
import { NOTE_FROM_TYPE, noteTypeOf, TYPE_KEY, type NoteTypeState } from "./note-types";
import { api } from "../host/ipc";
import { openVaultRoot } from "./store";
import { createNote } from "./vault";

/// Quante note l'editor mostra, come la finestra dei nomi (`MAX_NAMES`).
const SHOWN = 20;
/// Quante note con un tipo si guardano per trovarne venti di un tipo solo.
const TYPED_WINDOW = 200;

/// Il link che una Relazione scrive per un documento: la pagina intera, senza
/// `.md` (`[[Libri/Dune]]`), che si risolve da ogni nota.
export function relationLink(doc: string): string {
  return `[[${doc.replace(/\.md$/i, "")}]]`;
}

export function relationNote(doc: string): RelationNote {
  return { doc, link: relationLink(doc) };
}

/// Il valore indicizzato di `tipo` come lo scrive il frontmatter, per
/// chiederne il tipo al core: un link `[[pagina]]`, o il testo. `null` per
/// ogni altra forma, che non nomina un tipo.
export function typeRaw(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const { kind, value: inner } = value as { kind?: unknown; value?: unknown };
  if (kind === "text" && typeof inner === "string") return inner;
  if (kind !== "link" || !inner || typeof inner !== "object") return null;
  const target = inner as { kind?: unknown; value?: unknown };
  if (target.kind === "wiki" && target.value && typeof target.value === "object") {
    const page = (target.value as { page?: unknown }).page;
    return typeof page === "string" && page !== "" ? `[[${page}]]` : null;
  }
  return target.kind === "path" && typeof target.value === "string" ? target.value : null;
}

/// Chi risponde a «di che tipo è?»: il core, una domanda per valore scritto
/// (le note di un tipo scrivono quasi sempre lo stesso). Si tiene finché
/// l'editor è aperto.
export type TypeLookup = (raw: string) => Promise<NoteTypeState>;

export function cachedTypeLookup(lookup: TypeLookup = noteTypeOf): TypeLookup {
  const known = new Map<string, Promise<NoteTypeState>>();
  return (raw) => {
    let answer = known.get(raw);
    if (!answer) {
      answer = lookup(raw);
      known.set(raw, answer);
    }
    return answer;
  };
}

/// Le note del tipo `page` il cui nome combacia con `text`: fra le note che
/// hanno `tipo`, quelle che il core risolve allo stesso file del tipo.
export async function notesOfType(page: string, text: string, lookup: TypeLookup): Promise<string[]> {
  const wanted = await lookup(`[[${page}]]`);
  if (wanted.state !== "typed") return [];
  const candidates = await notesWithProperty(TYPE_KEY, text, TYPED_WINDOW);
  const out: string[] = [];
  for (const candidate of candidates) {
    const raw = typeRaw(candidate.value);
    if (raw === null) continue;
    const state = await lookup(raw);
    if (state.state === "typed" && state.type.doc === wanted.type.doc) out.push(candidate.doc);
    if (out.length >= SHOWN) break;
  }
  return out;
}

/// Le note del bersaglio il cui nome combacia con `text`. Senza bersaglio,
/// `anyNote` (la ricerca dei nomi del vault, con le recenti a mani vuote).
export async function searchRelation(text: string, target: RelationTarget | null, anyNote: (text: string) => Promise<string[]>, lookup: TypeLookup): Promise<RelationNote[]> {
  const docs = target === null ? await anyNote(text)
    : target.kind === "folder" ? await notesInFolder(target.path, text, SHOWN)
      : await notesOfType(target.page, text, lookup);
  return docs.map(relationNote);
}

/// Crea la nota `name` nel bersaglio: del tipo (`note.from_type`, nella
/// cartella del tipo, con le sue proprietà), nella cartella, o dove vanno le
/// note nuove. Il comando non sovrascrive mai un file che c'è: sceglie un
/// nome libero, e la nota creata è quella che torna.
export async function createRelation(name: string, target: RelationTarget | null): Promise<RelationNote | null> {
  if (target?.kind === "type") {
    const outcome = await api.invokeCommand(NOTE_FROM_TYPE, { type: `[[${target.page}]]`, name }, "apply", openVaultRoot());
    return outcome.effect.kind === "navigate" ? relationNote(outcome.effect.doc) : null;
  }
  const doc = await createNote(name, target?.kind === "folder" ? target.path : undefined);
  return doc === null ? null : relationNote(doc);
}
