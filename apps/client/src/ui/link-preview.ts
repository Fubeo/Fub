// L'anteprima di una nota **al passaggio su un wikilink** (P06.5).
//
// La scheda è quella di `state/preview.ts` — stessa lettura dal canale dati,
// stessa sanitizzazione, un solo proprietario per tutta la shell — e qui c'è
// soltanto chi la chiede: un ascoltatore delegato sul documento, che riconosce
// i wikilink dal contratto che la resa dà alla shell (`data-wikilink-*`, vedi
// `ui/sanitize.ts`). Lo posano la Lettura, le card e la Live: qui non si
// conosce la grammatica di nessun formato.
//
// - In Lettura basta passare sopra: la scheda arriva dopo il ritardo di
//   `state/preview.ts`; con Ctrl/Cmd arriva subito.
// - In Live serve Ctrl/Cmd: chi scrive passa col puntatore sul testo di
//   continuo, e una scheda a ogni passaggio sarebbe rumore.
// - Con `editor.preview-modifier` serve Ctrl/Cmd dappertutto.
// - Si chiude uscendo dal link e dalla scheda, con Esc, o quando la shell si
//   smonta. Un link che non si risolve non apre niente.
import { resolvedReference, settings } from "../host/query";
import { onEvent } from "../state/kernel";
import { cancelScheduledPreview, hidePreview, schedulePreview } from "../state/preview";
import { state } from "../state/store";
import type { Lifetime } from "./lifetime";

/// Quanto aspettare, uscito dal link, prima di chiudere: il tempo di arrivare
/// col puntatore sulla scheda.
const LEAVE_MS = 250;

/// L'impostazione che chiede Ctrl/Cmd anche fuori dalla Live.
export const PREVIEW_MODIFIER_KEY = "editor.preview-modifier";

interface Target {
  page: string;
  heading: string | null;
  block: string | null;
  live: boolean;
}

/// Il bersaglio del wikilink sotto il puntatore, se ce n'è uno. Un link
/// dentro un testo che si sta scrivendo (`contenteditable` acceso, la Live)
/// vuole il modificatore; il blocco reso dentro la Live non è scrivibile e
/// risponde come la Lettura.
export function linkTarget(element: Element | null): { link: HTMLElement; target: Target } | null {
  const link = element?.closest<HTMLElement>("[data-wikilink-page]");
  if (!link || link.closest(".link-preview")) return null;
  const editable = link.closest("[contenteditable]");
  return {
    link,
    target: {
      page: link.dataset.wikilinkPage ?? "",
      heading: link.dataset.wikilinkHeading ?? null,
      block: link.dataset.wikilinkBlock ?? null,
      live: editable !== null && editable.getAttribute("contenteditable") !== "false",
    },
  };
}

/// Chi apre la scheda adesso, finché l'ascoltatore è montato: il menu del
/// tasto destro («Anteprima») la chiede senza passare dal puntatore.
let openNow: ((link: HTMLElement) => void) | null = null;

/// La scheda si può chiedere: l'ascoltatore è montato.
export function canPreviewLink(): boolean {
  return openNow !== null;
}

/// La scheda del wikilink `element` subito, senza modificatore.
export function previewLink(element: Element): void {
  const hit = linkTarget(element);
  if (hit && openNow) openNow(hit.link);
}

export function mountLinkPreview(life: Lifetime): void {
  let box: HTMLElement | null = null;
  let current: HTMLElement | null = null;
  let leaving: number | undefined;
  let generation = 0;
  let needsModifier = false;
  let asked = 0;

  // Vale l'ultima lettura chiesta: una risposta vecchia non scrive sopra una
  // nuova.
  const loadPreference = async () => {
    const mine = ++asked;
    try {
      const entries = await settings();
      if (mine !== asked) return;
      needsModifier = entries.find((entry) => entry.spec.key === PREVIEW_MODIFIER_KEY)?.value === true;
    } catch {
      // Senza vault o senza impostazioni resta il comportamento di serie.
    }
  };
  life.add(onEvent("setting_changed", (event) => {
    if (event.key === PREVIEW_MODIFIER_KEY) void loadPreference();
  }));
  void loadPreference();

  const close = () => {
    generation += 1;
    if (leaving !== undefined) window.clearTimeout(leaving);
    leaving = undefined;
    current = null;
    hidePreview();
    box?.remove();
    box = null;
  };
  const leaveSoon = () => {
    if (leaving !== undefined) window.clearTimeout(leaving);
    leaving = window.setTimeout(() => {
      leaving = undefined;
      cancelScheduledPreview();
      close();
    }, LEAVE_MS);
  };

  const open = async (link: HTMLElement, target: Target, immediate: boolean) => {
    if (current === link) return;
    close();
    current = link;
    const mine = generation;
    const resolved = target.page || target.heading || target.block
      ? await resolvedReference(
          { kind: "wiki", value: { page: target.page, heading: target.heading, block: target.block } },
          state.currentDoc ?? undefined,
        ).catch(() => null)
      : null;
    if (mine !== generation || !resolved || !link.isConnected) return;
    // Solo un documento ha una resa da mostrare: un allegato nominato da un
    // wikilink si apre, non si trasclude in una scheda di testo.
    const extension = resolved.doc.slice(resolved.doc.lastIndexOf(".") + 1).toLowerCase();
    if (!state.handledExtensions.includes(extension)) return;
    const rect = link.getBoundingClientRect();
    const popover = document.createElement("div");
    popover.className = "link-preview";
    popover.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - 488))}px`;
    const below = rect.bottom + 6;
    if (below + 300 > window.innerHeight && rect.top > 320) {
      popover.style.bottom = `${window.innerHeight - rect.top + 6}px`;
    } else {
      popover.style.top = `${below}px`;
    }
    popover.addEventListener("pointerenter", () => {
      if (leaving !== undefined) window.clearTimeout(leaving);
      leaving = undefined;
    });
    popover.addEventListener("pointerleave", leaveSoon);
    document.body.appendChild(popover);
    box = popover;
    schedulePreview(resolved.doc, popover, immediate);
  };

  life.listen(document, "pointerover", (event) => {
    const hit = linkTarget(event.target instanceof Element ? event.target : null);
    if (!hit) return;
    const modifier = event.ctrlKey || event.metaKey;
    if ((hit.target.live || needsModifier) && !modifier) return;
    if (leaving !== undefined) window.clearTimeout(leaving);
    leaving = undefined;
    void open(hit.link, hit.target, modifier);
  });
  life.listen(document, "pointerout", (event) => {
    if (!current) return;
    const from = event.target instanceof Element ? event.target : null;
    const to = event.relatedTarget instanceof Element ? event.relatedTarget : null;
    if (!from || !current.contains(from)) return;
    if (to && (current.contains(to) || box?.contains(to))) return;
    leaveSoon();
  });
  life.listen(document, "keydown", (event) => {
    if (event.key === "Escape" && box) close();
  });
  // Il link può sparire sotto la scheda (un ridisegno, una nota chiusa) senza
  // che arrivi un `pointerout`: un clic fuori o uno scorrimento la chiudono.
  life.listen(document, "pointerdown", (event) => {
    if (box && !(event.target instanceof Node && box.contains(event.target))) close();
  });
  life.listen(document, "scroll", (event) => {
    if (box && !(event.target instanceof Node && box.contains(event.target))) close();
  }, { capture: true, passive: true });
  life.add(close);
  const now = (link: HTMLElement) => {
    const hit = linkTarget(link);
    if (hit) void open(hit.link, hit.target, true);
  };
  openNow = now;
  life.add(() => {
    if (openNow === now) openNow = null;
  });
}
