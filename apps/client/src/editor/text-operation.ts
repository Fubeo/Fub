/**
 * Typed text operations shared by the editor and document transport.
 *
 * Positions are CodeMirror's normalized UTF-16 offsets. This module deliberately
 * has no knowledge of CodeMirror, the DOM, or the history implementation.
 */

export type TextOffset = number;

export interface TextEdit {
  readonly from: TextOffset;
  readonly to: TextOffset;
  readonly deleted: string;
  readonly inserted: string;
}

export interface TextOperation {
  readonly beforeLength: number;
  readonly afterLength: number;
  readonly edits: readonly TextEdit[];
}

function operationShapeError(operation: TextOperation): string | null {
  if (!operation || typeof operation !== "object") return "operazione assente";
  if (!Number.isInteger(operation.beforeLength) || !Number.isFinite(operation.beforeLength) || operation.beforeLength < 0) {
    return "beforeLength non valido";
  }
  if (!Number.isInteger(operation.afterLength) || !Number.isFinite(operation.afterLength) || operation.afterLength < 0) {
    return "afterLength non valido";
  }
  if (!Array.isArray(operation.edits)) return "lista modifiche non valida";

  let previousTo = 0;
  let delta = 0;
  for (let index = 0; index < operation.edits.length; index += 1) {
    const edit = operation.edits[index];
    if (!edit || typeof edit !== "object") return `modifica non valida alla posizione ${index}`;
    if (typeof edit.deleted !== "string" || typeof edit.inserted !== "string") {
      return `testo non valido alla modifica ${index}`;
    }
    if (
      !Number.isInteger(edit.from) ||
      !Number.isFinite(edit.from) ||
      !Number.isInteger(edit.to) ||
      !Number.isFinite(edit.to) ||
      edit.from < 0 ||
      edit.to < edit.from
    ) {
      return `intervallo non valido alla modifica ${index}`;
    }
    if (edit.to > operation.beforeLength || edit.from < previousTo) {
      return `intervalli sovrapposti alla modifica ${index}`;
    }
    if (edit.deleted.length !== edit.to - edit.from) {
      return `preimmagine incoerente alla modifica ${index}`;
    }
    previousTo = edit.to;
    delta += edit.inserted.length - edit.deleted.length;
  }

  if (operation.beforeLength + delta !== operation.afterLength) {
    return "afterLength non corrisponde alle modifiche";
  }
  return null;
}

/** Returns a shape error, or `null` for a well-formed operation. */
export function validateOperation(operation: TextOperation): string | null {
  return operationShapeError(operation);
}

/** Applies an operation, checking dimensions and every deleted preimage. */
export function applyOperation(text: string, operation: TextOperation): string {
  const shapeError = operationShapeError(operation);
  if (shapeError) throw new Error(shapeError);
  if (text.length !== operation.beforeLength) {
    throw new Error("la lunghezza del testo non corrisponde all'operazione");
  }

  const chunks: string[] = [];
  let cursor = 0;
  for (const edit of operation.edits) {
    if (text.slice(edit.from, edit.to) !== edit.deleted) {
      throw new Error("preimmagine non valida");
    }
    chunks.push(text.slice(cursor, edit.from), edit.inserted);
    cursor = edit.to;
  }
  chunks.push(text.slice(cursor));
  return chunks.join("");
}

/** Non-throwing operation application for guarded editor boundaries. */
export function tryApplyOperation(
  text: string,
  operation: TextOperation,
): { readonly kind: "applied"; readonly text: string } | { readonly kind: "invalid"; readonly reason: string } {
  try {
    return { kind: "applied", text: applyOperation(text, operation) };
  } catch (error) {
    return { kind: "invalid", reason: error instanceof Error ? error.message : "operazione non valida" };
  }
}

/** The inverse action, expressed in the document produced by `operation`. */
export function invertOperation(operation: TextOperation): TextOperation {
  const shapeError = operationShapeError(operation);
  if (shapeError) throw new Error(shapeError);
  const edits: TextEdit[] = [];
  let delta = 0;
  for (const edit of operation.edits) {
    const from = edit.from + delta;
    edits.push({
      from,
      to: from + edit.inserted.length,
      deleted: edit.inserted,
      inserted: edit.deleted,
    });
    delta += edit.inserted.length - edit.deleted.length;
  }
  return {
    beforeLength: operation.afterLength,
    afterLength: operation.beforeLength,
    edits,
  };
}

/** A single prefix/suffix patch for a full-text synchronization. */
export function operationFromText(before: string, after: string): TextOperation {
  if (before === after) return { beforeLength: before.length, afterLength: before.length, edits: [] };
  let prefix = 0;
  const minimum = Math.min(before.length, after.length);
  while (prefix < minimum && before[prefix] === after[prefix]) prefix += 1;

  let suffix = 0;
  while (
    suffix < minimum - prefix &&
    before[before.length - 1 - suffix] === after[after.length - 1 - suffix]
  ) {
    suffix += 1;
  }

  const edit: TextEdit = {
    from: prefix,
    to: before.length - suffix,
    deleted: before.slice(prefix, before.length - suffix),
    inserted: after.slice(prefix, after.length - suffix),
  };
  return {
    beforeLength: before.length,
    afterLength: after.length,
    edits: [edit],
  };
}
