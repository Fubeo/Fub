// La rotta privata del componente dei compiti (`fub.tasks`) vista dal client.
//
// Sta fuori da `query.ts` perché la usa ogni superficie Markdown: chi finge
// `query.ts` in un test non deve rifinire anche questa porta.
import { api } from "./ipc";
import { openVaultRoot, vaultArg } from "../state/store";
import { t } from "../i18n/strings";

/// Il componente dei compiti: lo spazio della sua rotta privata.
const TASKS_NS = "fub.tasks";

/// La riga del compito che nasce spuntando `line`, se `line` ricorre (`🔁`),
/// altrimenti `null` (`RemindersQuery::NextOccurrence` in `fub-features`).
///
/// La regola è quella di `note.task.toggle`: la chiede l'editor, che scrive la
/// spunta nel buffer e non nel file. Il giorno è quello del muro di chi spunta
/// (conta per `when done`), come l'ora dei promemoria la calcola chi chiede.
/// Un errore (il componente spento, una riga che non si può chiedere) arriva
/// a chi chiama: decide lui che la spunta valga lo stesso.
export async function nextTaskOccurrence(line: string, now: Date = new Date()): Promise<string | null> {
  const pad = (n: number) => String(n).padStart(2, "0");
  const today = `${String(now.getFullYear()).padStart(4, "0")}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const answer = await api.queryIndex(
    { kind: "custom", ns: TASKS_NS, query: { kind: "next_occurrence", version: 1, line, today } },
    ...vaultArg(openVaultRoot()),
  );
  if (answer.kind !== "custom") {
    throw new Error(t("errors.query.wrong_kind", { got: answer.kind, want: "custom" }));
  }
  const next = (answer.value as { line?: unknown } | null)?.line;
  if (next === null || next === undefined) return null;
  if (typeof next !== "string") throw new Error(t("errors.query.wrong_kind", { got: typeof next, want: "string" }));
  return next;
}
