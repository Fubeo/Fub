// Che cosa si apre all'avvio, sopra la sessione ripristinata (`files.startup`):
// la scelta è del vault, il gesto è un comando che c'è già.

export const FILES_STARTUP = "files.startup";
export const FILES_STARTUP_NOTE = "files.startup-note";

const COMMANDS: ReadonlyMap<string, string> = new Map([
  ["daily", "note.daily"],
  ["new", "shell.note.new"],
]);

/// Il comando che la scelta nomina; `null` per la sola sessione, o per una
/// scelta che questa shell non conosce.
export function startupCommand(value: unknown): string | null {
  return typeof value === "string" ? COMMANDS.get(value) ?? null : null;
}

/// La nota che `files.startup = note` apre: il percorso scritto, senza le barre
/// ai capi, con `.md` quando l'ultimo pezzo non ha estensione. `null` per
/// un'altra scelta o un percorso vuoto.
export function startupNote(choice: unknown, path: unknown): string | null {
  if (choice !== "note" || typeof path !== "string") return null;
  const trimmed = path.trim().replace(/^\/+|\/+$/g, "");
  if (trimmed === "") return null;
  const last = trimmed.slice(trimmed.lastIndexOf("/") + 1);
  return last.includes(".") ? trimmed : `${trimmed}.md`;
}
