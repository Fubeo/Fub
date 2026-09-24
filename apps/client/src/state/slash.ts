import { api } from "../host/ipc";
import type { CommandOutcome, CommandSpec, InvokeMode } from "../host/contract";
import { activeDoc } from "./layout";
import { state } from "./store";

// These commands are offered by the registry, not reimplemented by the editor.
// The slash surface collects any missing declared parameters.
const p05Commands: Record<string, true> = {
  "note.from_template": true, "note.daily": true, "note.unique": true,
  "note.random": true, "note.insert_datetime": true,
  "note.insert_template": true, "note.extract": true, "note.merge": true,
};

export function slashCandidates(specs: CommandSpec[]): CommandSpec[] {
  return specs.filter((spec) =>
    p05Commands[spec.id] === true || spec.id === "selection.wikilink" ||
    spec.params.some((p) =>
      p.name === "find" || p.name === "text" || p.name === "selection" || p.name === "at"
    )
  );
}

/// Only the editor's current buffer supplies arguments. Never infer byte
/// offsets from a DOM selection: the published session context owns spans.
export function slashArgs(
  spec: CommandSpec,
  selection: string,
  doc: string | null = slashContextDoc(),
): Record<string, unknown> | null {
  if (spec.id === "selection.wikilink") return selection ? {} : null;
  const args: Record<string, unknown> = {};
  for (const param of spec.params) {
    if (param.name === "doc" && doc && param.kind.kind === "document") args.doc = doc;
    if (
      selection && param.kind.kind === "text" &&
      (param.name === "find" || param.name === "text" || param.name === "selection")
    ) args[param.name] = selection;
    if (param.required && !(param.name in args) && !p05Commands[spec.id]) return null;
  }
  return args;
}

/// Invoca un comando slash con flush-before-patch: a buffer sporco le
/// coordinate del contesto non valgono per il file, e scrivere lì taglia i
/// byte sbagliati. `flushPendingSave` viene da `PaletteHost`, come la
/// palette: stessa guardia, stessa frase.
export async function invokeSlash(
  spec: CommandSpec,
  args: Record<string, unknown>,
  flushPendingSave: () => Promise<string[]>,
  isCurrent: () => boolean = () => true,
  publishCurrentContext?: () => Promise<void>,
  mode: InvokeMode = "apply",
): Promise<{ blocked: string[] } | { outcome: CommandOutcome } | { cancelled: true }> {
  if (!isCurrent()) return { cancelled: true };
  if (spec.scope.writes) {
    const pending = await flushPendingSave();
    if (!isCurrent()) return { cancelled: true };
    if (pending.length > 0) return { blocked: pending };
  }
  await publishCurrentContext?.();
  if (!isCurrent()) return { cancelled: true };
  const outcome = await api.invokeCommand(spec.id, args, mode);
  return { outcome };
}

export function slashContextDoc(): string | null {
  return activeDoc() ?? state.currentDoc;
}
