import { api } from "../host/ipc";
import type { CommandOutcome, CommandSpec, InvokeMode } from "../host/contract";
import { activeDoc } from "./layout";
import { state } from "./store";

/// I comandi del menu `/`: quelli che lo dichiarano (`CommandSpec.surfaces`), e
/// chi trasforma la selezione soltanto quando c'è. Nessun elenco della shell e
/// nessuna ipotesi sui nomi dei parametri: un plugin ci arriva per la stessa
/// via di una feature ufficiale.
export function slashCandidates(specs: CommandSpec[], selection: string): CommandSpec[] {
  return specs.filter((spec) =>
    spec.surfaces.includes("slash") ||
    (selection !== "" && spec.surfaces.includes("slash_selection"))
  );
}

/// Gli argomenti che il contesto dell'editor sa dare; gli altri li chiede il
/// menu. `doc` è il documento su cui si scrive, col nome con cui i comandi del
/// registro chiamano il loro bersaglio; per chi trasforma la selezione, questa
/// è il suo primo testo obbligatorio. Mai un offset dedotto da una selezione
/// del DOM: gli span li porta il contesto pubblicato.
export function slashArgs(
  spec: CommandSpec,
  selection: string,
  doc: string | null = slashContextDoc(),
): Record<string, unknown> {
  const args: Record<string, unknown> = {};
  if (doc && spec.params.some((param) => param.name === "doc" && param.kind.kind === "document")) {
    args.doc = doc;
  }
  if (selection && spec.surfaces.includes("slash_selection")) {
    const text = spec.params.find((param) => param.required && param.kind.kind === "text" && !(param.name in args));
    if (text) args[text.name] = selection;
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
