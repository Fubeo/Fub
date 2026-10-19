// Che cosa si apre all'avvio, sopra la sessione ripristinata (`files.startup`):
// la scelta è del vault, il gesto è un comando che c'è già.

export const FILES_STARTUP = "files.startup";

const COMMANDS: ReadonlyMap<string, string> = new Map([
  ["daily", "note.daily"],
  ["new", "shell.note.new"],
]);

/// Il comando che la scelta nomina; `null` per la sola sessione, o per una
/// scelta che questa shell non conosce.
export function startupCommand(value: unknown): string | null {
  return typeof value === "string" ? COMMANDS.get(value) ?? null : null;
}
