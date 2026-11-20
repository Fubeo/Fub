// Il moto dell'albero: una cartella che si apre o si chiude.
//
// Aprire una cartella rifà di solito il solo suo sottoalbero, ma a volte
// tutto l'albero (`renderFileList`), e allora le righe dopo non sono le
// stesse di prima: la misura «prima» si lega al path, non al nodo. I figli nuovi entrano uno dopo l'altro, le righe sotto
// scivolano dal posto che avevano, e i figli di una cartella chiusa se ne
// vanno come immagine ferma, posata dentro la cartella perché il rientro resti
// quello della loro profondità. L'albero non è virtualizzato: basta FLIP.
//
// Si muove solo ciò che si vede. Una cartella di duecento voci darebbe
// duecento corse nello stesso fotogramma del ridisegno, e quel fotogramma
// salterebbe: entra sfalsato chi cade nella parte visibile dell'albero, e
// scivola chi si vedeva prima o si vede dopo. Chi arriva da fuori (le righe
// sotto una cartella che si chiude) parte appena oltre il bordo che attraversa,
// non da migliaia di px più in là: si vede la stessa corsa, senza la velocità
// di un viaggio che nessuno vede.
import type { Lifetime } from "../ui/lifetime";
import { animate, DURATION, enter, halt, liveState, prepareExit, stagger, type Ghost, type Motion, type MotionState } from "../moto";

/// Di quanto scende chi entra (px): un accenno, non un viaggio.
const ENTER_RISE_PX = 4;
/// Sotto questa differenza (px) una riga non si è mossa.
const NEGLIGIBLE_PX = 0.5;
/// Chiudere è un'uscita: le righe sotto risalgono entro il suo tempo, ma
/// partono da ferme. Con `ease-out` il primo fotogramma ne faceva un quinto
/// della corsa, un salto; così ne fa il 3 %, e il passo più lungo è lo stesso.
export const CLOSE_EASING = "ease-in-out";

/// La fascia dell'albero che si vede, in coordinate della finestra: la
/// finestra stretta da ogni antenato che taglia ciò che sborda.
interface Band {
  readonly top: number;
  readonly bottom: number;
}

const CLIPPING = new Set(["auto", "scroll", "hidden", "clip", "overlay"]);

function visibleBand(list: HTMLElement): Band {
  let top = 0;
  let bottom = window.innerHeight || document.documentElement.clientHeight || Number.POSITIVE_INFINITY;
  for (let el = list.parentElement; el && el !== document.body; el = el.parentElement) {
    if (!CLIPPING.has(getComputedStyle(el).overflowY)) continue;
    const box = el.getBoundingClientRect();
    top = Math.max(top, box.top);
    bottom = Math.min(bottom, box.bottom);
  }
  return { top, bottom };
}

/// Una riga alta `height` col bordo di sopra a `top` tocca la fascia?
function seen(top: number, height: number, band: Band): boolean {
  return top + height > band.top && top < band.bottom;
}

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

/// Misura l'albero prima che `path` si apra o si chiuda. Con `null` non si
/// apre niente: le righe che restano scivolano soltanto al loro posto nuovo,
/// come dopo un riordino.
export function beginTreeMotion(list: HTMLElement, path: string | null, lifetime?: Lifetime): TreeMotion {
  const before = new Map<string, number>();
  // Una riga ancora in volo (un'apertura subito dopo una chiusura) resta lo
  // stesso nodo: la misura comprende dove la si vede, e la corsa nuova parte
  // da lì con la sua velocità.
  const flying = new Map<HTMLElement, MotionState>();
  for (const [key, row] of rows(list)) {
    before.set(key, row.getBoundingClientRect().top);
    const state = liveState(row);
    if (state) flying.set(row, state);
  }
  const was = visibleBand(list);
  const group = (path === null ? null : folderEntry(list, path))?.querySelector<HTMLElement>(":scope > .tree-children:not([inert])");
  // L'immagine di chi esce arriva al bordo di sotto di ciò che si vede.
  const ghost: Ghost | null = group ? prepareExit(group, { cutBelow: was.bottom }) : null;

  let settled = false;
  return {
    settle() {
      if (settled) return [];
      settled = true;
      const motions: Motion[] = [];
      const folder = path === null ? null : folderEntry(list, path);
      const now = rows(list);
      // La misura «dopo» vuole il layout nudo: prima si fermano tutte, poi si
      // misura, perché ogni fermata dopo una misura rifarebbe il layout.
      for (const row of now.values()) if (flying.has(row)) halt(row);

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
      const view = visibleBand(list);
      // Chiudere è un'uscita: le righe sotto risalgono entro il suo tempo.
      const pace = group ? { duration: DURATION.swap, easing: CLOSE_EASING } : { spring: "soft" as const };
      const fresh: HTMLElement[] = [];
      const sliding: { row: HTMLElement; y: number; arrives: boolean }[] = [];
      // Chi arriva da fuori parte appena oltre il bordo che attraversa, e
      // tutti dello stesso passo: così restano in fila, alla loro distanza,
      // invece di partire ammucchiati sul bordo. Il passo è quello che basta
      // a nascondere la prima riga che arriva.
      let fromBelow = 0;
      let fromAbove = 0;
      for (const [key, row] of now) {
        const top = before.get(key);
        const box = row.getBoundingClientRect();
        if (top === undefined) {
          if (inside?.contains(row) && seen(box.top, box.height, view)) fresh.push(row);
          continue;
        }
        const y = top - box.top;
        if (Math.abs(y) < NEGLIGIBLE_PX) continue;
        const arrives = !seen(top, box.height, was);
        if (arrives && !seen(box.top, box.height, view)) continue;
        if (arrives && y > 0) fromBelow = Math.max(fromBelow, view.bottom - box.top);
        if (arrives && y < 0) fromAbove = Math.min(fromAbove, view.top - box.height - box.top);
        sliding.push({ row, y, arrives });
      }
      for (const { row, y: travel, arrives } of sliding) {
        const y = !arrives ? travel : travel > 0 ? Math.min(travel, fromBelow) : Math.max(travel, fromAbove);
        motions.push(animate(row, { from: { y }, velocity: flying.get(row)?.velocity, ...pace, lifetime }));
      }
      motions.push(
        stagger(fresh, (row) => enter(row, { from: { opacity: 0, y: -ENTER_RISE_PX }, spring: "soft", lifetime })),
      );
      return motions;
    },
  };
}
