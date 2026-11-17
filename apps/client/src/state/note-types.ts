// I tipi di nota (E5) visti dalla shell: l'elenco coi conteggi per il cassetto
// e per «Nuova nota», il tipo di una nota per la testata, e i gesti che li
// usano. Com'è fatto un tipo e a chi porta un nome lo decide il core
// (`fub-features`, `note_types`): qui si chiede e si legge la risposta, mai si
// rifà la regola.
//
// I dati arrivano da due comandi di sola lettura del componente delle
// proprietà, `note.type.list` e `note.type.get`, nell'esito
// (`effect: custom`, spazio `fub.note_types`). Un componente spento
// (`unknown_command`) vale come nessun tipo: «Nuova nota» crea una nota
// semplice e la testata non dice niente.
import { api } from "../host/ipc";
import type { CommandOutcome } from "../host/contract";
import { isErrorKind } from "../host/errors";
import { openVaultRoot } from "./store";

export const NOTE_TYPES_NS = "fub.note_types";
export const NOTE_TYPE_LIST = "note.type.list";
export const NOTE_TYPE_GET = "note.type.get";
export const NOTE_FROM_TYPE = "note.from_type";
export const NOTE_TYPE_SET = "note.type.set";
/// La chiave con cui una nota dice il suo tipo, e quella delle proprietà in
/// evidenza nel frontmatter di un tipo.
export const TYPE_KEY = "tipo";
export const FEATURED_KEY = "featured";

/// Una proprietà dichiarata da un tipo, col tipo che vale davvero (quello del
/// registro del vault, se ne dice uno).
export interface NoteTypeProperty {
  readonly key: string;
  readonly kind: string | null;
}

/// Un tipo di nota.
export interface NoteType {
  /// Il file del tipo: `Tipi/Libro.md`.
  readonly doc: string;
  /// Il percorso che il link scrive: `Tipi/Libro`.
  readonly link: string;
  /// Il nome che si legge: `Libro`.
  readonly name: string;
  readonly icon: string | null;
  readonly featured: readonly string[];
  readonly properties: readonly NoteTypeProperty[];
  /// La cartella delle note nuove.
  readonly folder: string | null;
  /// Quante note lo nominano (solo nell'elenco).
  readonly notes: number;
  /// Il tipo si legge (solo nell'elenco: un tipo guasto c'è, da aprire).
  readonly readable: boolean;
  /// La revisione del file del tipo (solo da `note.type.get`): chi ci scrive
  /// la passa, e se il tipo è cambiato intanto non si scrive.
  readonly revision: string | null;
}

export interface NoteTypeList {
  /// La cartella dei tipi; `null` se i tipi sono spenti.
  readonly folder: string | null;
  readonly types: readonly NoteType[];
}

/// Il tipo di una nota, com'è adesso.
export type NoteTypeState =
  | { readonly state: "untyped" }
  | { readonly state: "typed"; readonly type: NoteType }
  | { readonly state: "missing"; readonly wanted: string }
  | { readonly state: "ambiguous"; readonly wanted: string; readonly candidates: readonly string[] }
  | { readonly state: "unreadable"; readonly doc: string; readonly name: string }
  | { readonly state: "not_a_name" };

export const NO_TYPES: NoteTypeList = { folder: null, types: [] };

/// I tipi del vault coi conteggi. Nessun tipo se il componente non c'è.
export async function listNoteTypes(): Promise<NoteTypeList> {
  const payload = await readOnly(NOTE_TYPE_LIST, {});
  if (payload === null) return NO_TYPES;
  return parseNoteTypeList(payload);
}

/// Il tipo che il valore `raw` di `tipo` nomina. Senza componente, nessun tipo.
export async function noteTypeOf(raw: string): Promise<NoteTypeState> {
  if (raw.trim() === "") return { state: "untyped" };
  const payload = await readOnly(NOTE_TYPE_GET, { type: raw });
  if (payload === null) return { state: "untyped" };
  return parseNoteTypeState(payload);
}

/// Una nota nuova del tipo `type`: nella cartella del tipo, se ne dice una;
/// se no in `folder`. Torna la nota creata (il comando sceglie un nome libero:
/// non sovrascrive mai un file che c'è).
export async function createFromType(type: NoteType, folder?: string): Promise<string | null> {
  const args: Record<string, string> = { type: `[[${type.link}]]` };
  if (type.folder === null && folder) args.folder = folder;
  const outcome = await api.invokeCommand(NOTE_FROM_TYPE, args, "apply", openVaultRoot());
  return outcome.effect.kind === "navigate" ? outcome.effect.doc : null;
}

/// Dà alla nota `doc` il tipo `type` («Scegli il tipo»): aggiunge le
/// proprietà che mancano e non toglie niente, con un annulla.
export async function setNoteType(doc: string, type: NoteType, revision: string | null): Promise<CommandOutcome> {
  const args: Record<string, string> = { doc, type: `[[${type.link}]]` };
  if (revision !== null) args.expected_revision = revision;
  return api.invokeCommand(NOTE_TYPE_SET, args, "apply", openVaultRoot());
}

/// Le proprietà in evidenza del tipo con `key` messa (`on`) o tolta: in fondo
/// all'elenco se entra, al suo posto le altre.
export function featuredWith(featured: readonly string[], key: string, on: boolean): string[] {
  const rest = featured.filter((name) => name !== key);
  return on ? [...rest, key] : rest;
}

/// «In evidenza» su una nota con un tipo: scrive nel file del tipo, con la
/// revisione letta (un tipo cambiato intanto non si sovrascrive). L'esito porta
/// l'annulla del comando.
export async function featureInType(type: NoteType, key: string, on: boolean): Promise<CommandOutcome> {
  const next = featuredWith(type.featured, key, on);
  const args: Record<string, string> = { doc: type.doc, key: FEATURED_KEY, value: yamlList(next) };
  if (type.revision !== null) args.expected_revision = type.revision;
  return api.invokeCommand("note.property.set", args, "apply", openVaultRoot());
}

/// Un elenco di chiavi in YAML di flusso: `[autore, "letto: sì"]`. Una chiave
/// che YAML non leggerebbe nuda va fra virgolette, in JSON (che è YAML).
export function yamlList(keys: readonly string[]): string {
  return `[${keys.map((key) => (/^[\p{L}\p{N}_][\p{L}\p{N}_ -]*$/u.test(key) && key.trim() === key ? key : JSON.stringify(key))).join(", ")}]`;
}

/// L'esito di un comando di sola lettura dei tipi, o `null` se il componente
/// non c'è. Ogni altro errore torna a chi chiede.
async function readOnly(command: string, args: Record<string, string>): Promise<unknown> {
  let outcome: CommandOutcome;
  try {
    outcome = await api.invokeCommand(command, args, "apply", openVaultRoot());
  } catch (error) {
    if (isErrorKind(error, "unknown_command")) return null;
    throw error;
  }
  const effect = outcome.effect;
  if (effect.kind !== "custom" || effect.ns !== NOTE_TYPES_NS) return null;
  return effect.payload;
}

function text(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function texts(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

/// Un tipo dall'esito, o `null` se non ha la forma che serve.
export function parseNoteType(raw: unknown): NoteType | null {
  if (typeof raw !== "object" || raw === null) return null;
  const row = raw as Record<string, unknown>;
  const doc = text(row.doc);
  const link = text(row.link);
  const name = text(row.name);
  if (doc === null || link === null || name === null) return null;
  const properties = Array.isArray(row.properties)
    ? row.properties.flatMap((item): NoteTypeProperty[] => {
      const key = text((item as Record<string, unknown> | null)?.key);
      return key === null ? [] : [{ key, kind: text((item as Record<string, unknown>).kind) }];
    })
    : [];
  return {
    doc,
    link,
    name,
    icon: text(row.icon),
    featured: texts(row.featured),
    properties,
    folder: text(row.folder),
    notes: typeof row.notes === "number" && Number.isFinite(row.notes) ? row.notes : 0,
    readable: row.readable !== false,
    revision: text(row.revision),
  };
}

export function parseNoteTypeList(raw: unknown): NoteTypeList {
  if (typeof raw !== "object" || raw === null) return NO_TYPES;
  const payload = raw as Record<string, unknown>;
  const types = Array.isArray(payload.types) ? payload.types.map(parseNoteType).filter((type): type is NoteType => type !== null) : [];
  return { folder: text(payload.folder), types };
}

export function parseNoteTypeState(raw: unknown): NoteTypeState {
  const payload = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  switch (payload.state) {
    case "typed": {
      const type = parseNoteType(payload.type);
      return type === null ? { state: "untyped" } : { state: "typed", type };
    }
    case "missing":
      return { state: "missing", wanted: text(payload.wanted) ?? "" };
    case "ambiguous":
      return { state: "ambiguous", wanted: text(payload.wanted) ?? "", candidates: texts(payload.candidates) };
    case "unreadable":
      return { state: "unreadable", doc: text(payload.doc) ?? "", name: text(payload.name) ?? "" };
    case "not_a_name":
      return { state: "not_a_name" };
    default:
      return { state: "untyped" };
  }
}
