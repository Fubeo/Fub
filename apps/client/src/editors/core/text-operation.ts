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

/** Transform disjoint edits on a shared preimage. An overlap is a recoverable conflict. */
export function transformPair(local: TextOperation, remote: TextOperation): [TextOperation, TextOperation] | null {
  if (local.beforeLength !== remote.beforeLength) return null;
  const shift = (edit: TextEdit, other: readonly TextEdit[]): TextEdit | null => {
    let delta = 0;
    for (const change of other) {
      // Adjacent edits are independent; coincident insertions have no stable order.
      if (change.from === change.to && edit.from === edit.to && change.from === edit.from) return null;
      if (change.to <= edit.from && !(change.from === change.to && change.from === edit.from)) {
        delta += change.inserted.length - change.deleted.length;
      } else if (change.from >= edit.to && !(edit.from === edit.to && change.from === edit.from)) {
        continue;
      } else {
        return null;
      }
    }
    return { ...edit, from: edit.from + delta, to: edit.to + delta };
  };
  const shiftAll = (source: TextOperation, other: TextOperation): TextOperation | null => {
    const edits: TextEdit[] = [];
    for (const edit of source.edits) {
      const mapped = shift(edit, other.edits);
      if (!mapped) return null;
      edits.push(mapped);
    }
    return { beforeLength: other.afterLength, afterLength: other.afterLength + source.afterLength - source.beforeLength, edits };
  };
  const left = shiftAll(local, remote);
  const right = shiftAll(remote, local);
  return left && right && !validateOperation(left) && !validateOperation(right) ? [left, right] : null;
}

/**
 * Rebases the change of a surface that fell behind onto the authoritative
 * text. The operation carries its own preimage, so inverting it on the
 * surface's text gives back the text the surface started from; what it missed
 * is the step from there to the authoritative text. Disjoint changes compose,
 * and `null` means they touch: then the authoritative text wins.
 *
 * Returns the merged text in the surface's line separator, the rebased
 * operation (preimage: the normalized authoritative text) and the catch-up
 * operation that brings the surface there (preimage: its normalized text).
 */
export function rebaseStaleChange(
  authoritative: string,
  change: { readonly text: string; readonly operation: TextOperation },
): { readonly text: string; readonly operation: TextOperation; readonly catchUp: TextOperation } | null {
  const surface = change.text.replace(/\r\n?/g, "\n");
  const target = authoritative.replace(/\r\n?/g, "\n");
  if (validateOperation(change.operation)) return null;
  const started = tryApplyOperation(surface, invertOperation(change.operation));
  if (started.kind !== "applied") return null;
  const pair = transformPair(change.operation, operationFromText(started.text, target));
  if (!pair) return null;
  const merged = tryApplyOperation(target, pair[0]);
  const caughtUp = tryApplyOperation(surface, pair[1]);
  if (merged.kind !== "applied" || caughtUp.kind !== "applied" || merged.text !== caughtUp.text) return null;
  const crlf = change.text.includes("\r\n") || (!change.text.includes("\n") && authoritative.includes("\r\n"));
  return {
    text: crlf ? merged.text.replace(/\n/g, "\r\n") : merged.text,
    operation: pair[0],
    catchUp: pair[1],
  };
}

/** Who produced a local change: a keystroke, or the surface's own history. */
export type EditorChangeOrigin = "input" | "undo" | "redo";

/** A change a surface made to its document: the resulting text and the typed operation behind it. */
export interface EditorChange {
  readonly text: string;
  readonly operation: TextOperation;
  readonly origin: EditorChangeOrigin;
}

/**
 * What the document session pushes to a surface: the authoritative text, with
 * the operation when the surface can apply it instead of replacing the text.
 */
export interface DocumentUpdate {
  readonly text: string;
  readonly operation: TextOperation | null;
}
