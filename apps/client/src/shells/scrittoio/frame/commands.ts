// Ciò che la cornice chiede al registro dei comandi: esegui questo, e dimmi
// con che tasti si fa. La cornice non registra comandi: preme quelli che ci
// sono, come il menu dell'applicazione.
import { on } from "../../../state/store";
import { paletteHost } from "../../../state/palette-host";
import { onLanguage } from "../../../i18n/strings";
import { allCommands, ariaBinding, displayBinding } from "../../../ui/commands";
import type { Lifetime } from "../../../ui/lifetime";
import { startCommand } from "../../../ui/palette";
import { setTooltip } from "../../../ui/tooltip";

/** Esegue un comando del registro. Un id che non c'è non fa niente. */
export function run(id: string): void {
  const entry = allCommands().find((candidate) => candidate.id === id);
  if (entry) startCommand(entry, paletteHost);
}

/** L'accordo del comando come lo si preme; vuoto se non ne ha. */
export function chordOf(id: string): string {
  return displayBinding(allCommands().find((entry) => entry.id === id)?.binding ?? null);
}

/**
 * Nome, suggerimento e scorciatoia di un bottone che preme un comando: il
 * suggerimento aggiunge i tasti, l'attributo li annuncia.
 */
export function labelCommandButton(button: HTMLElement, name: string, id: string): void {
  const binding = allCommands().find((entry) => entry.id === id)?.binding ?? null;
  const chord = displayBinding(binding);
  button.setAttribute("aria-label", name);
  setTooltip(button, chord ? `${name} (${chord})` : name);
  const aria = ariaBinding(binding);
  if (aria) button.setAttribute("aria-keyshortcuts", aria);
  else button.removeAttribute("aria-keyshortcuts");
}

/**
 * Richiama `draw` ora, e ogni volta che cambiano la lingua o gli accordi: sono
 * i due fatti che invecchiano un'etichetta della cornice.
 */
export function keepLabelled(lifetime: Lifetime, draw: () => void): void {
  draw();
  lifetime.add(onLanguage(draw));
  lifetime.add(on("commands", draw));
}
