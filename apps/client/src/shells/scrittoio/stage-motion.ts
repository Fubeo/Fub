// Il moto del palco: fogli e cassetti quando la disposizione cambia.
//
// Dividere un foglio, chiuderne uno, aprire o chiudere un cassetto, entrare e
// uscire dalla concentrazione sono tutti la stessa cosa vista da qui: la
// disposizione salta al suo stato finale e i fogli devono arrivarci senza
// strappo. La regola è una sola.
//
// - **Ciò che c'è dentro un foglio è sempre al suo posto finale.** Il testo non
//   si sposta e non si deforma: l'editor è vivo, e chi scrive non aspetta.
// - **A muoversi è la carta**, cioè la sagoma del foglio (`.pane::before`):
//   parte dal rettangolo che occupava e arriva a quello nuovo.
// - Un foglio **nuovo** esce dal bordo di quello da cui è nato; di uno
//   **chiuso** resta per un momento una sagoma ferma che si dissolve, mentre i
//   vicini si allargano sopra il suo posto.
// - Un cassetto o una barra che **ricompare** entra dal suo bordo. Quando
//   sparisce, sparisce: a dire che se n'è andato è la carta che ne prende il
//   posto.
//
// Chi cambia la disposizione non ne sa niente: il modulo segue il DOM. Un
// osservatore sui figli diretti di `#panes` (il layout li rifà a ogni cambio
// dell'albero) e uno sugli attributi che nascondono la cornice. I rettangoli di
// prima sono quelli dell'ultimo fotogramma disegnato: li tiene aggiornati un
// `ResizeObserver`, così un trascinamento del divisore o della finestra non
// diventa mai un'animazione.
import {
  animate,
  DURATION,
  liveState,
  motionDriver,
  motionLevel,
  type Motion,
  type MotionState,
} from "../../moto";
import type { Lifetime } from "../../ui/lifetime";
import { byId } from "./frame/dom";

/// Di quanto scorre un cassetto rientrando (px): lo stesso passo dell'affaccio.
const DRAWER_TRAVEL = 28;
/// Quanto del suo lato percorre un foglio nuovo uscendo dal vicino, e il tetto (px).
const SHEET_TRAVEL_SHARE = 0.12;
const SHEET_TRAVEL_MAX = 64;
/// La sagoma di un foglio chiuso arretra appena mentre si dissolve.
const GHOST_SCALE = 0.97;
/// Sotto questa differenza (px) un foglio non si è mosso.
const NEGLIGIBLE_PX = 0.5;

/// Le parti della cornice che la shell nasconde e rimette, e da che bordo
/// rientrano.
const PARTS: readonly { id: string; x: number; y: number }[] = [
  { id: "rail", x: -1, y: 0 },
  { id: "sidebar", x: -1, y: 0 },
  { id: "right-pane", x: 1, y: 0 },
  { id: "status-band", x: 0, y: 1 },
];

interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/// Il riquadro di un foglio nel layout, e quanto sotto il suo bordo comincia la
/// carta (sopra ci sono le linguette, che stanno sulla scrivania).
interface Box extends Rect {
  inset: number;
}

const centerX = (rect: Rect): number => rect.left + rect.width / 2;
const centerY = (rect: Rect): number => rect.top + rect.height / 2;

function paperOf(box: Box): Rect {
  return { left: box.left, top: box.top + box.inset, width: box.width, height: box.height - box.inset };
}

/// Dove si vede adesso una carta la cui corsa è ancora in volo: la scala agisce
/// attorno al centro, che è l'origine di uno pseudo-elemento senza altre regole.
function seen(paper: Rect, live: MotionState | null): Rect {
  if (!live) return paper;
  const width = paper.width * (live.pose.scaleX ?? 1);
  const height = paper.height * (live.pose.scaleY ?? 1);
  return {
    left: centerX(paper) + (live.pose.x ?? 0) - width / 2,
    top: centerY(paper) + (live.pose.y ?? 0) - height / 2,
    width,
    height,
  };
}

export function mountStageMotion(lifetime: Lifetime): void {
  const panes = byId("panes");
  if (!panes || typeof MutationObserver === "undefined") return;
  const doc = panes.ownerDocument;
  const view = doc.defaultView ?? window;

  /// I fogli come stavano nell'ultimo fotogramma disegnato, per id di riquadro,
  /// e i loro elementi: di uno appena tolto serve ancora la corsa in volo.
  let known = new Map<string, Box>();
  let elements = new Map<string, HTMLElement>();
  /// Le parti della cornice che si vedevano.
  const shown = new Map<HTMLElement, boolean>();
  /// La corsa viva di ogni carta e di ogni foglio che entra.
  const papers = new Map<HTMLElement, Motion>();
  const bodies = new Map<HTMLElement, Motion>();

  const sheets = (): HTMLElement[] => [...panes.querySelectorAll<HTMLElement>(".pane[data-pane]")];
  const parts = (): { el: HTMLElement; x: number; y: number }[] =>
    PARTS.flatMap((part) => {
      const el = byId(part.id);
      return el ? [{ el, x: part.x, y: part.y }] : [];
    });

  /// Il riquadro nel layout: senza lo scarto di un'entrata ancora in volo.
  const measure = (el: HTMLElement): Box => {
    const rect = el.getBoundingClientRect();
    const live = liveState(el);
    const inset = Number.parseFloat(view.getComputedStyle(el, "::before").top);
    return {
      left: rect.left - (live?.pose.x ?? 0),
      top: rect.top - (live?.pose.y ?? 0),
      width: rect.width,
      height: rect.height,
      inset: Number.isFinite(inset) ? inset : 0,
    };
  };

  const visible = (el: HTMLElement): boolean => {
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  };

  /// I fogli che hanno un riquadro: uno nascosto dal benvenuto non c'è.
  const survey = (): Map<string, { el: HTMLElement; box: Box }> => {
    const found = new Map<string, { el: HTMLElement; box: Box }>();
    for (const el of sheets()) {
      const id = el.dataset.pane;
      if (!id) continue;
      const box = measure(el);
      if (box.width > 0 && box.height > 0) found.set(id, { el, box });
    }
    return found;
  };

  let sizes: ResizeObserver | null = null;
  if (typeof ResizeObserver !== "undefined") {
    sizes = new ResizeObserver(() => {
      if (lifetime.closed) return;
      const now = survey();
      known = new Map([...now].map(([id, { box }]) => [id, box]));
      elements = new Map([...now].map(([id, { el }]) => [id, el]));
      for (const { el } of parts()) shown.set(el, visible(el));
    });
    lifetime.add(() => sizes?.disconnect());
  }
  const watched = new WeakSet<Element>();
  const watch = (el: Element): void => {
    if (!sizes || watched.has(el)) return;
    watched.add(el);
    sizes.observe(el);
  };

  /// La carta di un foglio rimasto va dal rettangolo che si vedeva a quello nuovo.
  const morph = (el: HTMLElement, was: Box, box: Box): void => {
    const from = seen(paperOf(was), liveState(el, "::before"));
    const to = paperOf(box);
    papers.get(el)?.cancel();
    papers.delete(el);
    if (!(from.width > 0 && from.height > 0 && to.width > 0 && to.height > 0)) return;
    const x = centerX(from) - centerX(to);
    const y = centerY(from) - centerY(to);
    const still =
      Math.abs(x) < NEGLIGIBLE_PX &&
      Math.abs(y) < NEGLIGIBLE_PX &&
      Math.abs(from.width - to.width) < NEGLIGIBLE_PX &&
      Math.abs(from.height - to.height) < NEGLIGIBLE_PX;
    if (still) return;
    const motion = animate(el, {
      pseudo: "::before",
      from: { x, y, scaleX: from.width / to.width, scaleY: from.height / to.height },
      spring: "wide",
      whenReduced: "none",
      lifetime,
    });
    if (motion.running) papers.set(el, motion);
  };

  /// Un foglio nuovo esce dal bordo di quello da cui è nato: quello che prima
  /// occupava il suo posto. Senza un vicino da cui uscire compare e basta.
  const arrive = (el: HTMLElement, box: Box, before: Map<string, Box>, now: Map<string, { box: Box }>): void => {
    let x = 0;
    let y = 0;
    for (const [id, was] of before) {
      const origin = now.get(id)?.box;
      if (!origin) continue;
      const inside =
        centerX(box) >= was.left &&
        centerX(box) <= was.left + was.width &&
        centerY(box) >= was.top &&
        centerY(box) <= was.top + was.height;
      if (!inside) continue;
      const dx = centerX(box) - centerX(origin);
      const dy = centerY(box) - centerY(origin);
      if (Math.abs(dx) >= Math.abs(dy)) {
        x = -Math.sign(dx) * Math.min(SHEET_TRAVEL_MAX, box.width * SHEET_TRAVEL_SHARE);
      } else {
        y = -Math.sign(dy) * Math.min(SHEET_TRAVEL_MAX, box.height * SHEET_TRAVEL_SHARE);
      }
      break;
    }
    bodies.get(el)?.cancel();
    const motion = animate(el, { from: { x, y, opacity: 0 }, spring: "wide", whenReduced: "fade", lifetime });
    if (motion.running) bodies.set(el, motion);
  };

  /// Di un foglio chiuso resta la sagoma: l'editor è già staccato dalla sua
  /// sessione, e a uscire è un rettangolo di carta senza niente dentro. Parte
  /// da dove la carta si vedeva: se il foglio stava ancora entrando, la sagoma
  /// prosegue da quella posa e non salta al rettangolo pieno.
  const leave = (el: HTMLElement | undefined, was: Box): void => {
    const body = el ? liveState(el) : null;
    const paper = seen(paperOf(was), el ? liveState(el, "::before") : null);
    if (el) {
      bodies.get(el)?.cancel();
      papers.get(el)?.cancel();
      bodies.delete(el);
      papers.delete(el);
    }
    // Nel livello ridotto, o senza un tempo che scorre, non c'è niente da
    // dissolvere: il foglio se n'è andato e basta.
    if (motionLevel() === "reduced" || motionDriver().instant) return;
    if (!(paper.width > 0 && paper.height > 0)) return;
    const opacity = body?.pose.opacity ?? 1;
    // La sagoma occupa il riquadro intero, linguette comprese, e disegna la
    // carta dal suo stesso scarto: è il foglio com'era, senza ciò che c'era sopra.
    const ghost = doc.createElement("div");
    ghost.className = "sheet-ghost";
    ghost.setAttribute("aria-hidden", "true");
    ghost.style.left = `${paper.left + (body?.pose.x ?? 0)}px`;
    ghost.style.top = `${paper.top - was.inset + (body?.pose.y ?? 0)}px`;
    ghost.style.width = `${paper.width}px`;
    ghost.style.height = `${paper.height + was.inset}px`;
    ghost.style.setProperty("--sheet-inset", `${was.inset}px`);
    doc.body.append(ghost);
    const motion = animate(ghost, {
      from: { opacity, scale: 1 },
      to: { opacity: 0, scale: GHOST_SCALE },
      duration: DURATION.short,
      easing: "ease-out",
      whenReduced: "none",
      lifetime,
    });
    // A riposo la sagoma non si vede: fra la fine della corsa e la rimozione
    // non resta un fotogramma pieno.
    ghost.style.opacity = "0";
    void motion.finished.then(() => ghost.remove());
  };

  /// Confronta i fogli con quelli di prima e mette in moto la differenza.
  const settle = (): void => {
    const before = known;
    const gone = elements;
    const now = survey();
    known = new Map([...now].map(([id, { box }]) => [id, box]));
    elements = new Map([...now].map(([id, { el }]) => [id, el]));
    for (const { el } of now.values()) watch(el);
    // Un foglio che non c'è più non tiene una corsa: la sua, se c'era, la
    // prende la sagoma qui sotto o finisce con lui.
    const prune = (): void => {
      for (const map of [papers, bodies]) {
        for (const el of [...map.keys()]) if (!el.isConnected) map.delete(el);
      }
    };
    // Il primo disegno non ha un prima. E se nessun foglio è rimasto è
    // un'altra scena — un'area di lavoro, un vault — non una divisione.
    if (before.size === 0 || ![...now.keys()].some((id) => before.has(id))) {
      prune();
      return;
    }
    for (const [id, { el, box }] of now) {
      const was = before.get(id);
      if (was) morph(el, was, box);
      else arrive(el, box, before, now);
    }
    for (const [id, was] of before) if (!now.has(id)) leave(gone.get(id), was);
    prune();
  };

  /// Le parti della cornice che prima non si vedevano entrano dal loro bordo.
  /// Un cassetto affacciato si vedeva già: aprirlo davvero non lo fa rientrare.
  const reveal = (): void => {
    for (const { el, x, y } of parts()) {
      const now = visible(el);
      if (now && shown.get(el) === false) {
        animate(el, {
          from: { x: x * DRAWER_TRAVEL, y: y * DRAWER_TRAVEL, opacity: 0 },
          spring: "wide",
          whenReduced: "fade",
          lifetime,
        });
      }
      shown.set(el, now);
    }
  };

  const tree = new MutationObserver(() => {
    if (!lifetime.closed) settle();
  });
  tree.observe(panes, { childList: true });
  lifetime.add(() => tree.disconnect());

  const frame = new MutationObserver(() => {
    if (lifetime.closed) return;
    reveal();
    settle();
  });
  const app = byId("app");
  if (app) frame.observe(app, { attributes: true, attributeFilter: ["data-focus-mode"] });
  for (const { el } of parts()) {
    frame.observe(el, { attributes: true, attributeFilter: ["hidden"] });
    shown.set(el, visible(el));
    watch(el);
  }
  lifetime.add(() => frame.disconnect());

  watch(panes);
  const first = survey();
  known = new Map([...first].map(([id, { box }]) => [id, box]));
  elements = new Map([...first].map(([id, { el }]) => [id, el]));
  for (const { el } of first.values()) watch(el);
}
