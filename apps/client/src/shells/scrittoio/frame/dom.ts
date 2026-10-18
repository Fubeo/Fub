// Due gesti che la cornice ripete: trovare un nodo che il markup promette, e
// seguire un attributo o un testo che scrive qualcun altro.
import type { Lifetime } from "../../../ui/lifetime";
import { closeContextMenu, showContextMenu, type MenuItem } from "../../../ui/menu";

export function byId<T extends HTMLElement = HTMLElement>(id: string): T | null {
  return document.getElementById(id) as T | null;
}

/**
 * Chiama `react` quando `target` cambia negli attributi nominati (o, senza
 * attributi, nel testo e nei figli). L'osservatore vive quanto `lifetime`.
 */
export function follow(
  lifetime: Lifetime,
  target: Node,
  react: () => void,
  options: { attributes?: readonly string[]; subtree?: boolean } = {},
): void {
  if (typeof MutationObserver === "undefined") return;
  const observer = new MutationObserver(() => {
    if (!lifetime.closed) react();
  });
  observer.observe(
    target,
    options.attributes
      ? { attributes: true, attributeFilter: [...options.attributes], subtree: options.subtree ?? false }
      : { childList: true, characterData: true, subtree: true },
  );
  lifetime.add(() => observer.disconnect());
}

/** Un clic finto sotto un bottone: è ciò che `showContextMenu` chiede per sapere dove aprirsi. */
export function below(trigger: HTMLElement, gap = 4): MouseEvent {
  const rect = trigger.getBoundingClientRect();
  return new MouseEvent("click", { clientX: rect.left, clientY: rect.bottom + gap });
}

/** Lo stesso, a fianco: per i bottoni del binario, che stanno su una colonna. */
export function beside(trigger: HTMLElement, gap = 6): MouseEvent {
  const rect = trigger.getBoundingClientRect();
  return new MouseEvent("click", { clientX: rect.right + gap, clientY: rect.top });
}

/** Un bottone che apre un menu e dice il vero su di sé. */
export interface MenuTrigger {
  /** Vero finché il menu che si vede è quello di questo bottone. */
  readonly open: boolean;
  show(at: MouseEvent, items: MenuItem[]): void;
  close(): void;
}

/**
 * Lega un bottone al menu che apre: `aria-expanded` segue il menu che si vede.
 *
 * `showContextMenu` chiude il menu precedente prima di aprire il nuovo, e la
 * chiusura avvisa chi l'aveva aperto. Se quel «chi» è lo stesso bottone,
 * l'avviso del vecchio arriverebbe sopra il nuovo e scriverebbe «chiuso» su un
 * menu aperto: il conto delle aperture dice quale avviso vale ancora.
 */
export function menuTrigger(trigger: HTMLElement): MenuTrigger {
  let opening = 0;
  let open = false;
  return {
    get open() {
      return open;
    },
    show(at, items) {
      const mine = ++opening;
      showContextMenu(at, items, {
        labelledBy: trigger.id,
        onClose: () => {
          if (mine !== opening) return;
          open = false;
          trigger.setAttribute("aria-expanded", "false");
        },
      });
      open = true;
      trigger.setAttribute("aria-expanded", "true");
    },
    close() {
      if (open) closeContextMenu();
    },
  };
}
