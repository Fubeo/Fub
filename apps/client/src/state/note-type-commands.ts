// I comandi del kernel per i tipi di nota (T33, E5), senza dipendenze: li
// importano anche i test che contano le scritture, che da qui sanno quali
// chiamate a `invokeCommand` leggono soltanto.

export const NOTE_TYPES_NS = "fub.note_types";
export const NOTE_TYPE_LIST = "note.type.list";
export const NOTE_TYPE_GET = "note.type.get";
export const NOTE_FROM_TYPE = "note.from_type";
export const NOTE_TYPE_SET = "note.type.set";
/// L'impostazione della cartella dei tipi: cambiarla cambia quali note sono
/// tipi.
export const TYPES_FOLDER_SETTING = "files.types-folder";

/// I comandi dei tipi che leggono e non scrivono niente: il cassetto e la
/// testata li chiamano da sé quando il vault cambia.
export const NOTE_TYPE_READS: ReadonlySet<string> = new Set([NOTE_TYPE_LIST, NOTE_TYPE_GET]);

/// Le chiamate a `invokeCommand` registrate da un host finto, senza le
/// letture dei tipi: per i test che contano i comandi che un gesto manda.
export function withoutTypeReads<T extends { args: readonly unknown[] }>(calls: readonly T[]): T[] {
  return calls.filter((call) => !NOTE_TYPE_READS.has(String(call.args[0])));
}
