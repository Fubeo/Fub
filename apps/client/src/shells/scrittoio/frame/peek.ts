// Il cassetto che si affaccia.
//
// Un cassetto chiuso non è perso: sfiorando il bordo della scrivania dalla sua
// parte compare sopra i fogli, e quando il puntatore se ne va si ritira da
// solo. Non è un'apertura. La preferenza resta «chiuso» e `hidden` non si
// tocca: qui si scrive una classe su `#layout` (`peek-sidebar`,
// `peek-inspector`) e la struttura mostra il cassetto in sovrapposizione
// finché c'è. Chi lo vuole tenere lo apre come sempre — comando, binario,
// bottone — e a quel punto l'affaccio lascia il posto al cassetto vero.
//
// È un gesto del puntatore: dalla tastiera un cassetto si apre col suo comando.
import { animate, DURATION, type Motion } from "../../../moto";
import { focusEditor } from "../../../state/document-controller";
import type { Lifetime } from "../../../ui/lifetime";
import { byId, follow } from "./dom";

export type PeekSide = "sidebar" | "inspector";

/// Quanto il puntatore sosta sul bordo prima che il cassetto si affacci: chi
/// attraversa il bordo per andare altrove non lo sveglia.
export const PEEK_DWELL_MS = 160;
/// Quanto il cassetto aspetta, uscito il puntatore, prima di ritirarsi.
export const PEEK_LEAVE_MS = 320;
/// Di quanto scorre affacciandosi e ritirandosi (px).
const TRAVEL = 28;

const PANEL: Record<PeekSide, string> = { sidebar: "sidebar", inspector: "right-pane" };
const CLASS: Record<PeekSide, string> = { sidebar: "peek-sidebar", inspector: "peek-inspector" };
/// Da che parte sta il bordo: il cassetto arriva da lì e lì torna.
const FROM: Record<PeekSide, number> = { sidebar: -1, inspector: 1 };

export function mountDrawerPeek(lifetime: Lifetime): void {
  const layout = byId("layout");
  if (!layout) return;
  const view = layout.ownerDocument.defaultView ?? window;

  let peeking: PeekSide | null = null;
  /// Il cassetto che si sta ritirando: si vede ancora, ma non riceve più niente.
  let leaving: { side: PeekSide; motion: Motion } | null = null;
  let dwell: number | undefined;
  let leave: number | undefined;
  let hovered = false;
  let dragging = false;

  const panelOf = (side: PeekSide): HTMLElement | null => byId(PANEL[side]);
  const stay = (): void => {
    view.clearTimeout(leave);
    leave = undefined;
  };
  const forget = (): void => {
    view.clearTimeout(dwell);
    dwell = undefined;
  };

  /// Toglie l'affaccio senza moto: lo stato finale, subito.
  const drop = (): void => {
    stay();
    if (leaving) {
      const { side, motion } = leaving;
      leaving = null;
      motion.cancel();
      layout.classList.remove(CLASS[side]);
      panelOf(side)?.removeAttribute("inert");
    }
    if (!peeking) return;
    layout.classList.remove(CLASS[peeking]);
    peeking = null;
  };

  const open = (side: PeekSide): void => {
    const panel = panelOf(side);
    if (!panel || !panel.hidden) return;
    if (leaving?.side === side) {
      // Stava uscendo: torna indietro da dov'è.
      leaving.motion.cancel();
      leaving = null;
      panel.removeAttribute("inert");
      peeking = side;
      animate(panel, { spring: "wide", whenReduced: "none", lifetime });
      return;
    }
    if (peeking === side) return;
    drop();
    peeking = side;
    layout.classList.add(CLASS[side]);
    animate(panel, {
      from: { x: FROM[side] * TRAVEL, opacity: 0 },
      spring: "wide",
      whenReduced: "fade",
      lifetime,
    });
  };

  const close = (): void => {
    stay();
    const side = peeking;
    if (!side) return;
    const panel = panelOf(side);
    peeking = null;
    if (!panel) {
      layout.classList.remove(CLASS[side]);
      return;
    }
    // Il fuoco non resta in un cassetto che sparisce: torna al foglio.
    if (panel.contains(panel.ownerDocument.activeElement)) focusEditor();
    // Da qui il cassetto è già chiuso per chi lo usa: l'uscita è solo ciò che
    // si vede, e finché dura non riceve né puntatore né fuoco.
    panel.setAttribute("inert", "");
    const motion = animate(panel, {
      to: { x: FROM[side] * TRAVEL, opacity: 0 },
      duration: DURATION.swap,
      easing: "ease-in",
      whenReduced: "none",
      lifetime,
    });
    const mine = { side, motion };
    leaving = mine;
    void motion.finished.then(() => {
      if (leaving !== mine) return;
      leaving = null;
      layout.classList.remove(CLASS[side]);
      panel.removeAttribute("inert");
    });
  };

  /// Ciò che tiene il cassetto affacciato anche senza il puntatore sopra.
  const held = (panel: HTMLElement): boolean =>
    dragging ||
    panel.contains(panel.ownerDocument.activeElement) ||
    panel.ownerDocument.getElementById("context-menu") !== null;

  const leaveSoon = (): void => {
    if (!peeking || leave !== undefined) return;
    leave = view.setTimeout(() => {
      leave = undefined;
      const panel = peeking ? panelOf(peeking) : null;
      if (!panel || hovered) return;
      // Trattenuto: si riprova più tardi, finché qualcosa non lo lascia andare.
      if (held(panel)) leaveSoon();
      else close();
    }, PEEK_LEAVE_MS);
  };

  const fine = (event: Event): boolean => {
    const pointer = event as PointerEvent;
    return pointer.pointerType !== "touch" && pointer.pointerType !== "pen";
  };

  for (const side of ["sidebar", "inspector"] as const) {
    const panel = panelOf(side);
    if (!panel) continue;
    // Il bordo: una striscia nel margine fra la cornice e i fogli. C'è solo
    // quando il cassetto è chiuso.
    const edge = layout.ownerDocument.createElement("div");
    edge.className = "drawer-edge";
    edge.dataset.edge = side;
    edge.setAttribute("aria-hidden", "true");
    layout.append(edge);
    lifetime.add(() => edge.remove());

    const sync = (): void => {
      const closed = panel.hidden;
      if (edge.hidden === closed) edge.hidden = !closed;
      // Aperto davvero: l'affaccio non serve più, e non deve restare sopra.
      if (!closed && (peeking === side || leaving?.side === side)) {
        forget();
        drop();
      }
    };
    sync();
    follow(lifetime, panel, sync, { attributes: ["hidden"] });

    lifetime.listen(edge, "pointerenter", (event) => {
      // Un trascinamento che passa di qui non sta chiedendo un cassetto.
      if (!fine(event) || (event as PointerEvent).buttons !== 0) return;
      hovered = true;
      stay();
      if (peeking === side || dwell !== undefined) return;
      dwell = view.setTimeout(() => {
        dwell = undefined;
        open(side);
      }, PEEK_DWELL_MS);
    });
    lifetime.listen(edge, "pointerleave", () => {
      hovered = false;
      forget();
      leaveSoon();
    });
    lifetime.listen(panel, "pointerenter", (event) => {
      if (!fine(event)) return;
      if (peeking !== side && leaving?.side !== side) return;
      hovered = true;
      stay();
      if (leaving?.side === side) open(side);
    });
    lifetime.listen(panel, "pointerleave", () => {
      if (peeking !== side) return;
      hovered = false;
      leaveSoon();
    });
    // Uscito il fuoco, niente lo trattiene più: se il puntatore è già altrove
    // parte l'attesa.
    lifetime.listen(panel, "focusout", () => {
      if (peeking === side && !hovered) leaveSoon();
    });
    lifetime.listen(panel, "dragstart", () => {
      dragging = true;
    });
    lifetime.listen(panel, "dragend", () => {
      dragging = false;
      if (peeking === side && !hovered) leaveSoon();
    });
    lifetime.listen(panel, "keydown", (event) => {
      if (peeking !== side || (event as KeyboardEvent).key !== "Escape" || event.defaultPrevented) return;
      event.preventDefault();
      close();
    });
  }

  lifetime.add(() => {
    forget();
    drop();
  });
}
