// Il moto dell'albero: una cartella che si apre o si chiude.
//
// Aprire una cartella ridisegna tutto l'albero (`renderFileList`), quindi le
// righe dopo non sono le stesse di prima: la misura «prima» si lega al path,
// non al nodo. I figli nuovi entrano uno dopo l'altro, le righe sotto
// scivolano dal posto che avevano, e i figli di una cartella chiusa se ne
// vanno come immagine ferma, posata dentro la cartella perché il rientro resti
// quello della loro profondità. L'albero non è virtualizzato: basta FLIP.
import type { Lifetime } from "../ui/lifetime";
import { animate, DURATION, enter, prepareExit, stagger, type Ghost, type Motion } from "../moto";

/// Di quanto scende chi entra (px): un accenno, non un viaggio.
const ENTER_RISE_PX = 4;
/// Sotto questa differenza (px) una riga non si è mossa.
const NEGLIGIBLE_PX = 0.5;

/// Un giro dell'albero misurato prima del ridisegno. `settle` va chiamata col
/// nuovo albero già nel DOM, una volta.
export interface TreeMotion {
  settle(): Motion[];
}

/// La riga di ogni voce dell'albero, per path.
function rows(list: HTMLElement): Map<string, HTMLElement> {
  const out = new Map<string, HTMLElement>();
  for (const li of list.querySelectorAll<HTMLElement>('li[role="treeitem"]')) {
    const row = li.querySelector<HTMLElement>(":scope > .tree-row");
    if (li.dataset.path !== undefined && row) out.set(li.dataset.path, row);
  }
  return out;
}

function folderEntry(list: HTMLElement, path: string): HTMLElement | null {
  return list.querySelector<HTMLElement>(`li[role="treeitem"][data-path="${CSS.escape(path)}"]`);
}

/// Misura l'albero prima che `path` si apra o si chiuda.
export function beginTreeMotion(list: HTMLElement, path: string, lifetime?: Lifetime): TreeMotion {
  const before = new Map<string, number>();
  for (const [key, row] of rows(list)) before.set(key, row.getBoundingClientRect().top);
  const group = folderEntry(list, path)?.querySelector<HTMLElement>(":scope > .tree-children:not([inert])");
  const ghost: Ghost | null = group ? prepareExit(group) : null;

  let settled = false;
  return {
    settle() {
      if (settled) return [];
      settled = true;
      const motions: Motion[] = [];
      const folder = folderEntry(list, path);

      // Chi esce: l'immagine sta nella cartella, quindi alla sua profondità,
      // ma non è dell'albero: niente ruoli né path che un giro dopo si
      // possano contare come voci.
      if (ghost && folder) {
        const motion = ghost.play({
          to: { opacity: 0, y: -ENTER_RISE_PX },
          // Breve e subito trasparente: le righe sotto le salgono addosso.
          duration: DURATION.state,
          easing: "ease-out",
          layer: folder,
          lifetime,
        });
        const node = folder.lastElementChild;
        if (motion.running && node?.hasAttribute("inert")) {
          for (const marked of [node, ...node.querySelectorAll("[role], [data-path], [draggable]")]) {
            marked.removeAttribute("role");
            marked.removeAttribute("data-path");
            marked.removeAttribute("draggable");
          }
          motions.push(motion);
        }
      }

      // Chi c'era scivola dal suo posto vecchio; chi è nuovo ed è dentro la
      // cartella aperta entra sfalsato.
      const inside = folder?.querySelector(":scope > .tree-children:not([inert])") ?? null;
      const fresh: HTMLElement[] = [];
      for (const [key, row] of rows(list)) {
        const top = before.get(key);
        if (top === undefined) {
          if (inside?.contains(row)) fresh.push(row);
          continue;
        }
        const y = top - row.getBoundingClientRect().top;
        if (Math.abs(y) < NEGLIGIBLE_PX) continue;
        // Chiudere è un'uscita: le righe sotto risalgono entro il suo tempo.
        const pace = group ? { duration: DURATION.swap, easing: "ease-out" } : { spring: "soft" as const };
        motions.push(animate(row, { from: { y }, ...pace, lifetime }));
      }
      motions.push(
        stagger(fresh, (row) => enter(row, { from: { opacity: 0, y: -ENTER_RISE_PX }, spring: "soft", lifetime })),
      );
      return motions;
    },
  };
}
