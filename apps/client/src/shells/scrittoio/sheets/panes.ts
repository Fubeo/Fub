// Seguire da fuori le parti di un foglio.
//
// I fogli li disegna la vista (`panels/document.ts`): nascono e muoiono col
// layout, e la vista ne riscrive i pezzi a ogni ridisegno. Chi ci si appoggia
// deve sapere due cose — quando compare una parte nuova, e quando una che c'è
// cambia — senza mettere un osservatore su tutto l'albero dei fogli: lì dentro
// c'è l'editor, e ogni battuta sveglierebbe chi guarda.
//
// Quindi: un osservatore sui figli diretti di `#panes` (il layout li rifà a
// ogni cambio dell'albero) per scoprire le parti, e uno su ciascuna parte, con
// le sole mutazioni che interessano a chi la segue.
import type { Lifetime } from "../../../ui/lifetime";
import { byId } from "../frame/dom";

export interface PartWatch {
  /// Le parti che ci sono adesso.
  parts(): HTMLElement[];
  /// Ripassa tutte le parti: per chi ha cambiato qualcosa che il DOM non dice.
  refresh(): void;
}

/**
 * Chiama `react` per ogni parte dei fogli che corrisponde a `selector`: quando
 * compare, a ogni cambio dell'albero dei fogli, e quando la parte cambia
 * secondo `watch`. Senza `#panes` o senza osservatori non segue niente e
 * risponde `null`.
 */
export function watchParts(
  lifetime: Lifetime,
  selector: string,
  watch: MutationObserverInit | null,
  react: (part: HTMLElement) => void,
): PartWatch | null {
  const panes = byId("panes");
  if (!panes || typeof MutationObserver === "undefined") return null;

  const watched = new WeakSet<HTMLElement>();
  const parts = (): HTMLElement[] => [...panes.querySelectorAll<HTMLElement>(selector)];
  const owner = (node: Node): HTMLElement | null => {
    const element = node instanceof Element ? node : node.parentElement;
    return element?.closest<HTMLElement>(selector) ?? null;
  };

  const part = new MutationObserver((records) => {
    if (lifetime.closed) return;
    const touched = new Set<HTMLElement>();
    for (const record of records) {
      const each = owner(record.target);
      if (each) touched.add(each);
    }
    for (const each of touched) react(each);
  });
  lifetime.add(() => part.disconnect());

  const discover = (): void => {
    for (const each of parts()) {
      if (watch && !watched.has(each)) {
        watched.add(each);
        part.observe(each, watch);
      }
      react(each);
    }
  };

  const tree = new MutationObserver(() => {
    if (!lifetime.closed) discover();
  });
  tree.observe(panes, { childList: true });
  lifetime.add(() => tree.disconnect());

  discover();
  return { parts, refresh: discover };
}

/// L'id del riquadro a cui appartiene un nodo dei fogli.
export function paneIdOf(node: Element): string | null {
  return node.closest<HTMLElement>("[data-pane]")?.dataset.pane ?? null;
}
