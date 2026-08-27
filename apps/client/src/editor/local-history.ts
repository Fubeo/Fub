/**
 * Internal text operations and per-surface local history.
 *
 * Positions are CodeMirror's normalized UTF-16 offsets.  The module deliberately
 * has no knowledge of CodeMirror, Markdown, the DOM, or the transport that may
 * eventually carry these values.
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

export interface SelectionRangeSnapshot {
  readonly from: TextOffset;
  readonly to: TextOffset;
}

export interface SelectionSnapshot {
  readonly ranges: readonly SelectionRangeSnapshot[];
  readonly mainIndex: number;
}

export type HistoryGrouping =
  | "input"
  | "command"
  | "paste"
  | "composition"
  | "other";

export type RebaseResult =
  | { readonly kind: "mapped"; readonly operation: TextOperation }
  | { readonly kind: "noop" }
  | { readonly kind: "conflict"; readonly reason: string };

export type HistoryDecision =
  | {
      readonly kind: "apply";
      readonly operation: TextOperation;
      readonly selection?: SelectionSnapshot;
      readonly token: number;
    }
  | { readonly kind: "noop"; readonly reason: string }
  | { readonly kind: "conflict"; readonly reason: string }
  | { readonly kind: "empty" };

export interface LocalHistoryOptions {
  /** Maximum number of undo or redo frames retained per stack. */
  readonly maxFrames?: number;
  readonly maxJournalOperations?: number;
  /** Maximum UTF-8 payload retained by the operation journal. */
  readonly maxJournalBytes?: number;
  /** Aggregate UTF-8 payload cap across journal entries and history frames. */
  readonly maxRetainedBytes?: number;
}

interface HistoryFrame {
  action: TextOperation;
  validAtJournalSequence: number;
  grouping: HistoryGrouping;
  beforeSelection?: SelectionSnapshot;
  afterSelection?: SelectionSnapshot;
  /** Selection expected after applying `action`. */
  targetSelection?: SelectionSnapshot;
}

interface JournalEntry {
  readonly sequence: number;
  readonly operation: TextOperation;
}

interface PendingDecision {
  readonly token: number;
  readonly direction: "undo" | "redo";
  readonly operation: TextOperation;
  readonly frame: HistoryFrame;
}

const DEFAULT_MAX_FRAMES = 128;
const DEFAULT_MAX_JOURNAL_OPERATIONS = 512;
const DEFAULT_MAX_JOURNAL_BYTES = 2_000_000;

type Affinity = "left" | "right";

function isInteger(value: number): boolean {
  return Number.isInteger(value) && Number.isFinite(value);
}

function operationShapeError(operation: TextOperation): string | null {
  if (!operation || typeof operation !== "object") return "operazione assente";
  if (!isInteger(operation.beforeLength) || operation.beforeLength < 0) {
    return "beforeLength non valido";
  }
  if (!isInteger(operation.afterLength) || operation.afterLength < 0) {
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
    if (!isInteger(edit.from) || !isInteger(edit.to) || edit.from < 0 || edit.to < edit.from) {
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

function emptyOperation(length: number): TextOperation {
  return { beforeLength: length, afterLength: length, edits: [] };
}

function copySelection(selection: SelectionSnapshot | undefined): SelectionSnapshot | undefined {
  if (!selection) return undefined;
  return {
    ranges: selection.ranges.map((range) => ({ from: range.from, to: range.to })),
    mainIndex: selection.mainIndex,
  };
}

function copyEdit(edit: TextEdit): TextEdit {
  return { from: edit.from, to: edit.to, deleted: edit.deleted, inserted: edit.inserted };
}

function copyOperation(operation: TextOperation): TextOperation {
  return {
    beforeLength: operation.beforeLength,
    afterLength: operation.afterLength,
    edits: operation.edits.map(copyEdit),
  };
}


function sameOperation(a: TextOperation, b: TextOperation): boolean {
  if (a.beforeLength !== b.beforeLength || a.afterLength !== b.afterLength) return false;
  if (a.edits.length !== b.edits.length) return false;
  return a.edits.every((edit, index) => {
    const other = b.edits[index];
    return (
      edit.from === other.from &&
      edit.to === other.to &&
      edit.deleted === other.deleted &&
      edit.inserted === other.inserted
    );
  });
}

function normalizedEdits(edits: readonly TextEdit[]): TextEdit[] {
  const sorted = edits
    .filter((edit) => edit.deleted.length > 0 || edit.inserted.length > 0)
    .map(copyEdit)
    .sort((a, b) => a.from - b.from || a.to - b.to);
  const result: TextEdit[] = [];

  for (const edit of sorted) {
    const previous = result[result.length - 1];
    if (!previous || previous.to < edit.from) {
      result.push(edit);
      continue;
    }
    // Two edits at the same anchor are legal only when they can be expressed as
    // one replacement.  Rebase normally produces this at a range boundary.
    if (previous.to === edit.from) {
      result[result.length - 1] = {
        from: previous.from,
        to: edit.to,
        deleted: previous.deleted + edit.deleted,
        inserted: previous.inserted + edit.inserted,
      };
      continue;
    }
    // The caller should have partitioned overlaps.  Preserve a malformed result
    // so the final shape validation fails safely instead of guessing.
    result.push(edit);
  }
  return result;
}

function sameSelection(
  a: SelectionSnapshot | undefined,
  b: SelectionSnapshot | undefined,
): boolean {
  if (!a || !b) return a === b;
  return (
    a.mainIndex === b.mainIndex &&
    a.ranges.length === b.ranges.length &&
    a.ranges.every(
      (range, index) =>
        range.from === b.ranges[index]?.from && range.to === b.ranges[index]?.to,
    )
  );
}

/**
 * Groups consecutive plain typing/deletion transactions. Composition and paste
 * are already atomic CM transactions, while commands and selection movement
 * deliberately close a typing group.
 */
function groupedInverse(
  previous: TextOperation,
  next: TextOperation,
): TextOperation | null {
  if (previous.edits.length !== 1 || next.edits.length !== 1) return null;
  const a = previous.edits[0]!;
  const b = next.edits[0]!;
  if (a.deleted.length > 0 && a.inserted === "" && b.deleted.length > 0 && b.inserted === "") {
    if (b.from !== a.to) return null;
    return {
      beforeLength: next.beforeLength,
      afterLength: previous.afterLength,
      edits: [
        {
          from: a.from,
          to: b.to,
          deleted: a.deleted + b.deleted,
          inserted: "",
        },
      ],
    };
  }
  if (a.deleted === "" && a.inserted.length > 0 && b.deleted === "" && b.inserted.length > 0) {
    if (b.from === a.from) {
      return {
        beforeLength: next.beforeLength,
        afterLength: previous.afterLength,
        edits: [{ from: a.from, to: a.from, deleted: "", inserted: a.inserted + b.inserted }],
      };
    }
    if (b.to === a.from) {
      return {
        beforeLength: next.beforeLength,
        afterLength: previous.afterLength,
        edits: [{ from: b.from, to: b.from, deleted: "", inserted: b.inserted + a.inserted }],
      };
    }
  }
  return null;
}

/**
 * Auto-pair inserts its two delimiters in one transaction, then the next
 * character is inserted inside that range.  Those inverse deletions nest rather
 * than touch at an edge; compose only this unambiguous, insertion-free case.
 */
function groupedNestedDeletion(
  previous: TextOperation,
  next: TextOperation,
): TextOperation | null {
  if (previous.edits.length !== 1 || next.edits.length !== 1) return null;
  const a = previous.edits[0]!;
  const b = next.edits[0]!;
  if (
    a.inserted !== "" ||
    b.inserted !== "" ||
    a.deleted.length === 0 ||
    b.deleted.length === 0 ||
    b.from < a.from ||
    b.from >= a.to
  ) {
    return null;
  }
  const relative = b.from - a.from;
  const deleted = a.deleted.slice(0, relative) + b.deleted + a.deleted.slice(relative);
  return {
    beforeLength: next.beforeLength,
    afterLength: previous.afterLength,
    edits: [
      {
        from: a.from,
        to: a.to + b.deleted.length,
        deleted,
        inserted: "",
      },
    ],
  };
}

function operationFromEdits(
  beforeLength: number,
  edits: readonly TextEdit[],
): TextOperation | null {
  const normalized = normalizedEdits(edits);
  const delta = normalized.reduce(
    (total, edit) => total + edit.inserted.length - edit.deleted.length,
    0,
  );
  const operation: TextOperation = {
    beforeLength,
    afterLength: beforeLength + delta,
    edits: normalized,
  };
  return operationShapeError(operation) ? null : operation;
}

/** Applies an operation, checking both its dimensions and every deleted preimage. */
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

/** A single bounded prefix/suffix patch for a full-text synchronization. */
export function operationFromText(before: string, after: string): TextOperation {
  if (before === after) return emptyOperation(before.length);
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

function mapPoint(
  position: TextOffset,
  operation: TextOperation,
  affinity: Affinity,
): number | null {
  let delta = 0;
  for (const edit of operation.edits) {
    if (position < edit.from) return position + delta;

    if (edit.from === edit.to) {
      if (position === edit.from) {
        return position + delta + (affinity === "right" ? edit.inserted.length : 0);
      }
      delta += edit.inserted.length;
      continue;
    }

    if (position === edit.from) {
      return edit.from + delta + (affinity === "right" ? edit.inserted.length : 0);
    }
    if (position === edit.to) {
      return edit.from + delta + edit.inserted.length;
    }
    if (position < edit.to) {
      return edit.from + delta + (affinity === "right" ? edit.inserted.length : 0);
    }
    delta += edit.inserted.length - edit.deleted.length;
  }
  return position + delta;
}

/** Maps an editor selection through an applied operation. */
export function mapSelection(
  selection: SelectionSnapshot,
  operation: TextOperation,
): SelectionSnapshot {
  const shapeError = operationShapeError(operation);
  if (shapeError) throw new Error(shapeError);
  const ranges = selection.ranges.map((range) => {
    const collapsed = range.from === range.to;
    const from = mapPoint(range.from, operation, collapsed ? "right" : "left");
    const to = mapPoint(range.to, operation, "right");
    if (from === null || to === null) {
      return { from: 0, to: 0 };
    }
    return {
      from: Math.max(0, Math.min(operation.afterLength, from)),
      to: Math.max(0, Math.min(operation.afterLength, to)),
    };
  });
  return {
    ranges,
    mainIndex: Math.max(0, Math.min(selection.mainIndex, Math.max(0, ranges.length - 1))),
  };
}

interface BaseInterval {
  readonly from: number;
  readonly to: number;
}

function subtractThroughRanges(
  from: number,
  to: number,
  through: TextOperation,
): BaseInterval[] {
  const result: BaseInterval[] = [];
  let cursor = from;
  for (const edit of through.edits) {
    if (edit.from === edit.to || edit.to <= from) continue;
    if (edit.from >= to) break;
    const overlapFrom = Math.max(from, edit.from);
    const overlapTo = Math.min(to, edit.to);
    if (overlapFrom > cursor) result.push({ from: cursor, to: overlapFrom });
    cursor = Math.max(cursor, overlapTo);
  }
  if (cursor < to) result.push({ from: cursor, to });
  return result;
}

function splitAtInsertions(
  interval: BaseInterval,
  through: TextOperation,
): BaseInterval[] {
  const cuts = through.edits
    .filter((edit) => edit.from === edit.to && edit.from > interval.from && edit.from < interval.to)
    .map((edit) => edit.from);
  if (cuts.length === 0) return [interval];
  const result: BaseInterval[] = [];
  let cursor = interval.from;
  for (const cut of cuts) {
    if (cut > cursor) result.push({ from: cursor, to: cut });
    cursor = cut;
  }
  if (cursor < interval.to) result.push({ from: cursor, to: interval.to });
  return result;
}

function overlaps(aFrom: number, aTo: number, bFrom: number, bTo: number): boolean {
  return aFrom < bTo && bFrom < aTo;
}

function exactReplacementAlreadyApplied(
  action: TextEdit,
  through: TextOperation,
): boolean {
  return (
    through.edits.length === 1 &&
    through.edits[0].from === action.from &&
    through.edits[0].to === action.to &&
    through.edits[0].deleted === action.deleted &&
    through.edits[0].inserted === action.inserted
  );
}

/**
 * Rebases `action`, valid on a base document, through one later operation.
 * Later inserted text has right affinity and is never consumed by a historical
 * deletion. Ambiguous overlapping replacements return a conflict instead.
 */
export function rebaseOperation(
  action: TextOperation,
  through: TextOperation,
): RebaseResult {
  const actionError = operationShapeError(action);
  if (actionError) return { kind: "conflict", reason: `azione non valida: ${actionError}` };
  const throughError = operationShapeError(through);
  if (throughError) return { kind: "conflict", reason: `operazione successiva non valida: ${throughError}` };
  if (action.beforeLength !== through.beforeLength) {
    return { kind: "conflict", reason: "le operazioni hanno basi di lunghezza diversa" };
  }
  if (action.edits.length === 0) return { kind: "noop" };

  const mapped: TextEdit[] = [];
  for (const edit of action.edits) {
    if (edit.from === edit.to) {
      for (const later of through.edits) {
        if (later.from === later.to) continue;
        if (later.from === edit.from || overlaps(later.from, later.to, edit.from, edit.from + 1)) {
          return { kind: "conflict", reason: "il punto di inserimento è stato sostituito" };
        }
      }
      const from = mapPoint(edit.from, through, "right");
      if (from === null) {
        return { kind: "conflict", reason: "punto di inserimento ambiguo" };
      }
      mapped.push({ from, to: from, deleted: "", inserted: edit.inserted });
      continue;
    }

    const overlapping = through.edits.filter((later) =>
      later.from !== later.to && overlaps(edit.from, edit.to, later.from, later.to),
    );
    if (edit.inserted.length > 0 && overlapping.length > 0) {
      if (exactReplacementAlreadyApplied(edit, through)) return { kind: "noop" };
      return { kind: "conflict", reason: "sovrapposizione fra sostituzioni ambigue" };
    }

    const surviving = subtractThroughRanges(edit.from, edit.to, through);
    if (surviving.length === 0) {
      if (edit.inserted.length > 0) {
        return { kind: "conflict", reason: "la preimmagine della sostituzione è scomparsa" };
      }
      continue;
    }

    for (const interval of surviving.flatMap((item) => splitAtInsertions(item, through))) {
      const from = mapPoint(interval.from, through, "right");
      const to = mapPoint(interval.to, through, "left");
      if (from === null || to === null || to < from) {
        return { kind: "conflict", reason: "intervallo storico non mappabile" };
      }
      const relativeFrom = interval.from - edit.from;
      const relativeTo = interval.to - edit.from;
      mapped.push({
        from,
        to,
        deleted: edit.deleted.slice(relativeFrom, relativeTo),
        inserted: "",
      });
    }

    if (edit.inserted.length > 0) {
      const from = mapPoint(edit.from, through, "right");
      if (from === null) {
        return { kind: "conflict", reason: "sostituzione storica non mappabile" };
      }
      mapped.push({ from, to: from, deleted: "", inserted: edit.inserted });
    }
  }

  const operation = operationFromEdits(through.afterLength, mapped);
  if (!operation || operation.edits.length === 0) return { kind: "noop" };
  return { kind: "mapped", operation };
}

/** Short alias used by the editor adapter and focused tests. */
export const rebase = rebaseOperation;

function mapFrameTarget(
  frame: HistoryFrame,
  mappedAction: TextOperation,
  through: readonly JournalEntry[],
): SelectionSnapshot | undefined {
  if (!frame.targetSelection) return undefined;
  let selection = copySelection(frame.targetSelection);
  if (!selection) return undefined;

  try {
    // The target is in the result of `frame.action`. Bring it to the frame's
    // base, walk the later journal, then apply the rebased action.
    selection = mapSelection(selection, invertOperation(frame.action));
    for (const entry of through) selection = mapSelection(selection, entry.operation);
    selection = mapSelection(selection, mappedAction);
    return selection;
  } catch {
    return undefined;
  }
}

const utf8Encoder = new TextEncoder();

function operationPayloadBytes(operation: TextOperation): number {
  return operation.edits.reduce(
    (total, edit) =>
      total + utf8Encoder.encode(edit.deleted).byteLength + utf8Encoder.encode(edit.inserted).byteLength,
    0,
  );
}

/**
 * Owns one undo/redo stack and the complete bounded journal for one surface.
 * `maxRetainedBytes` is the single aggregate UTF-8 payload bound across both
 * stacks and the journal; `maxJournalBytes` is an additional journal-only cap.
 * Journal entries are appended only after a guarded editor transaction has
 * succeeded, so a pending decision cannot mutate text on its own.
 */
export class LocalHistory {
  private readonly maxFrames: number;
  private readonly maxJournalOperations: number;
  private readonly maxJournalBytes: number;
  private readonly maxRetainedBytes: number;
  private readonly undoStack: HistoryFrame[] = [];
  private readonly redoStack: HistoryFrame[] = [];
  private readonly journal: JournalEntry[] = [];
  private sequence = 0;
  private nextToken = 1;
  private pending: PendingDecision | undefined;
  private disposed = false;

  public constructor(options: LocalHistoryOptions = {}) {
    this.maxFrames = Math.max(1, Math.floor(options.maxFrames ?? DEFAULT_MAX_FRAMES));
    this.maxJournalOperations = Math.max(
      1,
      Math.floor(options.maxJournalOperations ?? DEFAULT_MAX_JOURNAL_OPERATIONS),
    );
    this.maxJournalBytes = Math.max(1, Math.floor(options.maxJournalBytes ?? DEFAULT_MAX_JOURNAL_BYTES));
    this.maxRetainedBytes = Math.max(
      1,
      Math.floor(options.maxRetainedBytes ?? this.maxJournalBytes * 2),
    );
  }
  public get undoDepth(): number {
    return this.undoStack.length;
  }

  public get redoDepth(): number {
    return this.redoStack.length;
  }

  public get journalSize(): number {
    return this.journal.length;
  }

  public get journalBytes(): number {
    return this.journal.reduce(
      (total, entry) => total + operationPayloadBytes(entry.operation),
      0,
    );
  }

  public get retainedPayloadBytes(): number {
    return (
      this.journalBytes +
      this.undoStack.reduce((total, frame) => total + operationPayloadBytes(frame.action), 0) +
      this.redoStack.reduce((total, frame) => total + operationPayloadBytes(frame.action), 0)
    );
  }

  public get journalSequence(): number {
    return this.sequence;
  }

  public get isDisposed(): boolean {
    return this.disposed;
  }

  public acceptLocal(
    operation: TextOperation,
    grouping: HistoryGrouping = "input",
    beforeSelection?: SelectionSnapshot,
    afterSelection?: SelectionSnapshot,
  ): boolean {
    if (this.disposed || operationShapeError(operation)) return false;
    this.pending = undefined;
    if (operation.edits.length === 0) return true;
    const sequence = this.appendJournal(operation);
    if (sequence === null) return false;

    const inverse = invertOperation(operation);
    const previous = this.undoStack[this.undoStack.length - 1];
    const canGroup =
      grouping === "input" &&
      previous?.grouping === "input" &&
      previous.validAtJournalSequence === sequence - 1 &&
      sameSelection(previous.afterSelection, beforeSelection);
    if (canGroup) {
      const combined =
        groupedInverse(previous.action, inverse) ?? groupedNestedDeletion(previous.action, inverse);
      if (combined) {
        previous.action = combined;
        previous.validAtJournalSequence = sequence;
        previous.afterSelection = copySelection(afterSelection);
      } else {
        this.undoStack.push({
          action: inverse,
          validAtJournalSequence: sequence,
          grouping,
          beforeSelection: copySelection(beforeSelection),
          afterSelection: copySelection(afterSelection),
          targetSelection: copySelection(beforeSelection),
        });
      }
    } else {
      this.undoStack.push({
        action: inverse,
        validAtJournalSequence: sequence,
        grouping,
        beforeSelection: copySelection(beforeSelection),
        afterSelection: copySelection(afterSelection),
        targetSelection: copySelection(beforeSelection),
      });
    }
    this.redoStack.length = 0;
    this.compactJournal();
    this.boundFrames();
    return true;
  }

  public acceptExternal(operation: TextOperation): boolean {
    if (this.disposed || operationShapeError(operation)) return false;
    this.pending = undefined;
    if (operation.edits.length === 0) return true;
    const sequence = this.appendJournal(operation);
    if (sequence === null) return false;
    this.compactJournal();
    this.boundFrames();
    return true;
  }

  public undo(current: string): HistoryDecision {
    return this.prepare("undo", current);
  }

  public redo(current: string): HistoryDecision {
    return this.prepare("redo", current);
  }

  /** Commits a decision after its guarded editor transaction has applied. */
  public commit(
    decision: HistoryDecision,
    beforeSelection?: SelectionSnapshot,
    afterSelection?: SelectionSnapshot,
    appliedOperation: TextOperation | undefined = undefined,
  ): boolean {
    if (this.disposed || decision.kind !== "apply") return false;
    const pending = this.pending;
    if (!pending || pending.token !== decision.token) return false;
    if (!sameOperation(pending.operation, decision.operation)) return false;
    if (appliedOperation && !sameOperation(pending.operation, appliedOperation)) return false;

    this.pending = undefined;
    const sequence = this.appendJournal(pending.operation);
    if (sequence === null) return false;

    const opposite: HistoryFrame = {
      action: invertOperation(pending.operation),
      validAtJournalSequence: sequence,
      grouping: "command",
      beforeSelection: copySelection(afterSelection),
      afterSelection: copySelection(beforeSelection),
      targetSelection: copySelection(beforeSelection),
    };
    if (pending.direction === "undo") this.redoStack.push(opposite);
    else this.undoStack.push(opposite);
    this.compactJournal();
    this.boundFrames();
    return true;
  }

  /** Abandons a prepared undo/redo when the editor refused its transaction. */
  public cancelPending(): void {
    this.pending = undefined;
  }
  public reset(): void {
    if (this.disposed) return;
    this.pending = undefined;
    this.undoStack.length = 0;
    this.redoStack.length = 0;
    this.journal.length = 0;
  }

  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.pending = undefined;
    this.undoStack.length = 0;
    this.redoStack.length = 0;
    this.journal.length = 0;
  }

  private prepare(direction: "undo" | "redo", current: string): HistoryDecision {
    if (this.disposed) return { kind: "conflict", reason: "cronologia smontata" };
    if (this.pending) return { kind: "conflict", reason: "operazione di cronologia già in attesa" };

    const stack = direction === "undo" ? this.undoStack : this.redoStack;
    const frame = stack.pop();
    if (!frame) return { kind: "empty" };

    let action = frame.action;
    const later = this.journal.filter((entry) => entry.sequence > frame.validAtJournalSequence);
    for (const entry of later) {
      const mapped = rebaseOperation(action, entry.operation);
      if (mapped.kind === "conflict") return mapped;
      if (mapped.kind === "noop") return { kind: "noop", reason: "il residuo locale è già scomparso" };
      action = mapped.operation;
    }

    const applied = tryApplyOperation(current, action);
    if (applied.kind === "invalid") {
      return { kind: "conflict", reason: `preimmagine di undo non valida: ${applied.reason}` };
    }

    const selection = mapFrameTarget(frame, action, later);
    const token = this.nextToken++;
    this.pending = { token, direction, operation: action, frame };
    return { kind: "apply", operation: action, selection, token };
  }

  private appendJournal(operation: TextOperation): number | null {
    if (operationShapeError(operation)) return null;
    const sequence = ++this.sequence;
    this.journal.push({ sequence, operation: copyOperation(operation) });
    return sequence;
  }

  private boundFrames(): void {
    if (this.undoStack.length > this.maxFrames) {
      this.undoStack.splice(0, this.undoStack.length - this.maxFrames);
    }
    if (this.redoStack.length > this.maxFrames) {
      this.redoStack.splice(0, this.redoStack.length - this.maxFrames);
    }

    let frameBytes =
      this.undoStack.reduce((total, frame) => total + operationPayloadBytes(frame.action), 0) +
      this.redoStack.reduce((total, frame) => total + operationPayloadBytes(frame.action), 0);
    while (this.journalBytes + frameBytes > this.maxRetainedBytes) {
      const stack = this.undoStack.length > 0 ? this.undoStack : this.redoStack;
      const dropped = stack.shift();
      if (!dropped) break;
      frameBytes -= operationPayloadBytes(dropped.action);
    }
  }

  private compactJournal(): void {
    let bytes = this.journal.reduce((total, entry) => total + operationPayloadBytes(entry.operation), 0);
    while (
      this.journal.length > 0 &&
      (this.journal.length > this.maxJournalOperations ||
        bytes > this.maxJournalBytes ||
        bytes > this.maxRetainedBytes)
    ) {
      const dropped = this.journal.shift();
      if (!dropped) break;
      bytes -= operationPayloadBytes(dropped.operation);
      this.rebaseFramesThrough(dropped);
    }
  }

  private rebaseFramesThrough(dropped: JournalEntry): void {
    const rebaseStack = (stack: HistoryFrame[]): void => {
      for (let index = stack.length - 1; index >= 0; index -= 1) {
        const frame = stack[index];
        if (frame.validAtJournalSequence >= dropped.sequence) continue;
        const mapped = rebaseOperation(frame.action, dropped.operation);
        if (mapped.kind !== "mapped") {
          // A frame whose residue is gone is safely quarantined while unrelated
          // older/newer frames remain available.
          stack.splice(index, 1);
          continue;
        }
        (frame as { action: TextOperation }).action = mapped.operation;
        frame.validAtJournalSequence = dropped.sequence;
      }
    };
    rebaseStack(this.undoStack);
    rebaseStack(this.redoStack);
  }
}

export function createLocalHistory(options: LocalHistoryOptions = {}): LocalHistory {
  return new LocalHistory(options);
}