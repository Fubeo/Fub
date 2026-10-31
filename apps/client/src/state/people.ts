// Le persone (K5): le note della cartella `files.people-folder` (di norma
// `Persone`). `@` in una nota le propone e scrive `[[Persone/Nome|Nome]]`,
// che la Live e i Blocchi mostrano come una pastiglia; una persona che non
// c'è nasce lì. Qui si tiene soltanto la cartella letta dalle impostazioni
// del vault, rifatta quando cambia; le note le cerca l'indice.

import { notesInFolder, settings } from "../host/query";
import { Race } from "../ui/race";
import type { Lifetime } from "../ui/lifetime";
import { onEvent } from "./kernel";
import { emit, on, openVaultRoot } from "./store";
import { createNote } from "./vault";

/// La chiave dell'impostazione, gemella di `FILES_PEOPLE_FOLDER` in
/// `crates/fub-host/src/settings.rs`.
export const PEOPLE_FOLDER_KEY = "files.people-folder";
const DEFAULT_FOLDER = "Persone";

let folder = DEFAULT_FOLDER;
const race = new Race();

/// La cartella scritta nelle impostazioni, senza barre ai bordi: `""` se
/// l'utente l'ha svuotata, e allora `@` non propone persone.
export function normalizedFolder(value: unknown): string {
  if (typeof value !== "string") return DEFAULT_FOLDER;
  return value.trim().replace(/^\/+|\/+$/g, "");
}

/// La cartella delle persone del vault aperto.
export function peopleFolder(): string {
  return folder;
}

/// Il bersaglio di un wikilink nomina una persona: sta nella cartella delle
/// persone, senza distinguere le maiuscole come chi risolve i link.
export function isPersonTarget(page: string, within = folder): boolean {
  if (!within) return false;
  const written = page.trim().toLowerCase();
  const prefix = `${within.toLowerCase()}/`;
  return written.startsWith(prefix) && written.length > prefix.length;
}

/// Le persone il cui nome combacia con `text`, dalla più pertinente.
export async function searchPeople(text: string): Promise<string[]> {
  if (!folder) return [];
  return notesInFolder(folder, text);
}

/// Una persona nuova: la sua nota nella cartella delle persone. Torna il
/// documento creato, o `null` se il comando non dice dove.
export async function createPerson(name: string): Promise<string | null> {
  if (!folder) return null;
  return createNote(name, folder);
}

async function refresh(): Promise<void> {
  await race.last(async (expected) => {
    const entries = await expected(settings());
    const next = normalizedFolder(entries.find((entry) => entry.spec.key === PEOPLE_FOLDER_KEY)?.value);
    if (next === folder) return;
    folder = next;
    emit("people");
  });
}

/// Tiene la cartella allineata alle impostazioni finché `lifetime` è vivo.
export function mountPeople(lifetime: Lifetime): void {
  // Un'impostazione che non si legge lascia la cartella di prima: `@`
  // propone ancora, e la pastiglia è soltanto un aspetto.
  const again = (): void => void refresh().catch(() => {});
  lifetime.add(onEvent("setting_changed", (event) => {
    if (event.key === PEOPLE_FOLDER_KEY) again();
  }));
  lifetime.add(onEvent("vault_opened", again));
  lifetime.add(on("vault", again));
  lifetime.add(() => {
    race.cancel();
    folder = DEFAULT_FOLDER;
  });
  if (openVaultRoot() !== undefined) again();
}
