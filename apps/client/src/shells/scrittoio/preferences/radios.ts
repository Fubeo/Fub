// Un gruppo di scelta: una sola fermata nel Tab, e le frecce che spostano
// insieme il fuoco e la scelta.
//
// Gli ascolti stanno sul gruppo e non sui bottoni: chi lo possiede può
// riscriverne le opzioni senza registrare niente di nuovo.
import type { Lifetime } from "../../../ui/lifetime";

export interface RadioGroup {
  /// Rimette la fermata sulla scelta corrente, o sulla prima che si può
  /// scegliere. Va chiamata dopo aver cambiato `aria-checked` o `disabled`.
  settle(): void;
}

function radiosOf(group: HTMLElement): HTMLButtonElement[] {
  return [...group.querySelectorAll<HTMLButtonElement>('button[role="radio"]')];
}

function step(key: string, index: number, count: number): number | null {
  if (key === "ArrowLeft" || key === "ArrowUp") return (index - 1 + count) % count;
  if (key === "ArrowRight" || key === "ArrowDown") return (index + 1) % count;
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  return null;
}

/**
 * Lega un `role="radiogroup"` alla tastiera e al puntatore. `choose` riceve
 * l'opzione appena scelta, già segnata e col fuoco: la scelta si vede subito, e
 * chi la scrive la conferma o la riporta indietro col valore riletto.
 *
 * Scegliere l'opzione già scelta non chiama nessuno.
 */
export function radioGroup(lifetime: Lifetime, group: HTMLElement, choose: (radio: HTMLButtonElement) => void): RadioGroup {
  const settle = (): void => {
    const radios = radiosOf(group);
    const enabled = radios.filter((radio) => !radio.disabled);
    const stop = enabled.find((radio) => radio.getAttribute("aria-checked") === "true") ?? enabled[0];
    for (const radio of radios) {
      const index = radio === stop ? 0 : -1;
      if (radio.tabIndex !== index) radio.tabIndex = index;
    }
  };

  const activate = (radio: HTMLButtonElement): void => {
    const already = radio.getAttribute("aria-checked") === "true";
    for (const other of radiosOf(group)) {
      const checked = String(other === radio);
      if (other.getAttribute("aria-checked") !== checked) other.setAttribute("aria-checked", checked);
    }
    settle();
    radio.focus();
    if (!already) choose(radio);
  };

  lifetime.listen(group, "click", (event) => {
    const radio = event.target instanceof Element ? event.target.closest<HTMLButtonElement>('button[role="radio"]') : null;
    if (radio && group.contains(radio) && !radio.disabled) activate(radio);
  });
  lifetime.listen(group, "keydown", (event) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const radio = event.target instanceof Element ? event.target.closest<HTMLButtonElement>('button[role="radio"]') : null;
    if (!radio || !group.contains(radio)) return;
    const enabled = radiosOf(group).filter((candidate) => !candidate.disabled);
    const index = enabled.indexOf(radio);
    const next = index === -1 ? null : step(event.key, index, enabled.length);
    if (next === null) return;
    event.preventDefault();
    activate(enabled[next]!);
  });

  return { settle };
}
