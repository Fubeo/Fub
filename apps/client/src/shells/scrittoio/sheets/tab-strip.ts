// Le linguette dello Scrittoio: ciò che la striscia fa oltre a disegnarsi.
//
// La striscia la disegna la vista dei riquadri (`panels/document.ts`), che non
// conosce il movimento e a ogni cambio d'identità delle schede rifà i propri
// figli. Qui la si segue da fuori, senza toccarla:
//
// - la sagoma della linguetta attiva (`.tab-entry::before`) scorre dal posto
//   della vecchia attiva a quello della nuova, e il contenuto del foglio arriva
//   dal verso dello spostamento;
// - in fondo alla striscia sta il «+», che la vista spazzerebbe a ogni
//   ridisegno: lo si rimette;
// - una striscia che non sta nel foglio dice da che parte scorre
//   (`data-scrolled`), e la rotella verticale la muove.
//
// Lo stato cambia prima: quando questo modulo se ne accorge il DOM è già quello
// finale, e ciò che si muove è la differenza. Se il movimento manca non manca
// niente.
import { onLanguage, t } from "../../../i18n/strings";
import { animate, DURATION, liveState } from "../../../moto";
import { focusPane } from "../../../state/layout";
import { allCommands, ariaBinding, displayBinding } from "../../../ui/commands";
import { iconEl } from "../../../ui/icons";
import type { Lifetime } from "../../../ui/lifetime";
import { setTooltip } from "../../../ui/tooltip";
import { byId } from "../frame/dom";

const NEW_NOTE = "shell.note.new";
const SHAPE = "::before";
/// Di quanto il contenuto arriva di lato, in px.
const CONTENT_SHIFT = 12;

/// La linguetta attiva di una striscia, com'era all'ultima occhiata.
interface Seen {
  /// Che cosa mostra, senza ciò che cambia restando la stessa scheda.
  readonly identity: string;
  readonly index: number;
  /// Posto e larghezza nella striscia, scorrimento escluso.
  readonly left: number;
  readonly width: number;
  readonly entry: HTMLElement;
}

/// L'identità di una scheda: la chiave che la vista le scrive, tolti lo spillo
/// e la pila, che cambiano senza che cambi il documento.
function identityOf(key: string | undefined): string {
  if (!key) return "";
  try {
    const target = JSON.parse(key) as Record<string, unknown>;
    return JSON.stringify({ ...target, pinned: undefined, stack: undefined });
  } catch {
    return key;
  }
}

function stripOf(node: EventTarget | null): HTMLElement | null {
  return node instanceof Element ? node.closest<HTMLElement>(".pane-tabs") : null;
}

function paneOf(strip: HTMLElement): HTMLElement | null {
  return strip.closest<HTMLElement>(".pane");
}

export function mountTabStrips(lifetime: Lifetime): void {
  const panes = byId("panes");
  if (!panes || typeof MutationObserver === "undefined") return;

  const seen = new WeakMap<HTMLElement, Seen>();
  const watched = new WeakSet<HTMLElement>();
  const plus = new WeakMap<HTMLElement, HTMLButtonElement>();

  const strips = (): HTMLElement[] => [...panes.querySelectorAll<HTMLElement>(".pane-tabs")];

  // --- Il «+» -------------------------------------------------------------

  const newNote = (): ReturnType<typeof allCommands>[number] | undefined =>
    allCommands().find((entry) => entry.id === NEW_NOTE);

  const label = (button: HTMLButtonElement): void => {
    const entry = newNote();
    const name = t("commands.note.new");
    const chord = displayBinding(entry?.binding ?? null);
    button.setAttribute("aria-label", name);
    setTooltip(button, chord ? `${name} (${chord})` : name);
    const keys = ariaBinding(entry?.binding ?? null);
    if (keys) button.setAttribute("aria-keyshortcuts", keys);
    else button.removeAttribute("aria-keyshortcuts");
  };

  /// Il «+» della striscia: uno per striscia, sempre lo stesso nodo, rimesso
  /// prima dell'elenco ogni volta che la vista rifà i figli.
  const ensurePlus = (strip: HTMLElement): void => {
    let button = plus.get(strip);
    if (!button) {
      button = document.createElement("button");
      button.type = "button";
      button.className = "tab-new";
      const glyph = iconEl("plus");
      if (glyph) button.append(glyph);
      plus.set(strip, button);
    }
    label(button);
    if (button.parentElement === strip) return;
    strip.insertBefore(button, strip.querySelector(":scope > [data-tab-menu]"));
  };

  const createIn = (strip: HTMLElement): void => {
    const pane = paneOf(strip)?.dataset.pane;
    if (pane) focusPane(pane);
    void newNote()?.run?.();
  };

  lifetime.listen(panes, "click", (event) => {
    const button = event.target instanceof Element ? event.target.closest(".tab-new") : null;
    const strip = button ? stripOf(button) : null;
    if (strip) createIn(strip);
  });
  // Il doppio clic sul vuoto della striscia fa lo stesso: è il gesto di chi
  // non cerca il bottone.
  lifetime.listen(panes, "dblclick", (event) => {
    if (event.target instanceof HTMLElement && event.target.classList.contains("pane-tabs")) createIn(event.target);
  });

  // --- Lo scorrimento della striscia --------------------------------------

  const markScroll = (strip: HTMLElement): void => {
    const start = strip.scrollLeft > 1;
    const end = strip.scrollLeft + strip.clientWidth < strip.scrollWidth - 1;
    const value = start && end ? "both" : start ? "start" : end ? "end" : "";
    if (value) strip.dataset.scrolled = value;
    else delete strip.dataset.scrolled;
  };

  // La rotella verticale sopra le linguette le fa scorrere di lato: è l'unico
  // verso in cui la striscia può andare.
  lifetime.listen(
    panes,
    "wheel",
    (event) => {
      const strip = stripOf(event.target);
      if (!strip || event.ctrlKey || event.metaKey) return;
      if (strip.scrollWidth <= strip.clientWidth + 1) return;
      if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
      event.preventDefault();
      strip.scrollLeft += event.deltaY;
    },
    { passive: false },
  );
  // `scroll` non risale: lo si prende in cattura, una volta per tutte.
  lifetime.listen(
    panes,
    "scroll",
    (event) => {
      const strip = stripOf(event.target);
      if (strip && strip === event.target) markScroll(strip);
    },
    { capture: true, passive: true },
  );

  // --- Il raccordo e il contenuto -----------------------------------------

  /// Di quanto la sagoma sporge dalla linguetta, per lato: lo dice la struttura.
  const overhangOf = (entry: HTMLElement): number => {
    try {
      const left = Number.parseFloat(getComputedStyle(entry, SHAPE).left);
      return Number.isFinite(left) ? -left : 0;
    } catch {
      return 0;
    }
  };

  /// La sagoma scorre dal posto dov'era a quello dov'è. Se la vecchia era
  /// ancora in viaggio, la nuova riparte da dove la si vedeva e con la sua
  /// velocità: due cambi di fila non fanno uno scatto.
  const slide = (before: Seen, now: Seen): void => {
    const overhang = overhangOf(now.entry);
    const flying = liveState(before.entry, SHAPE);
    const wasWidth = (before.width + 2 * overhang) * (flying?.pose.scaleX ?? 1);
    const wasLeft = before.left + (flying?.pose.x ?? 0);
    const x = wasLeft - now.left;
    const scaleX = wasWidth / Math.max(1, now.width + 2 * overhang);
    if (Math.abs(x) < 0.5 && Math.abs(scaleX - 1) < 0.005) return;
    animate(now.entry, {
      pseudo: SHAPE,
      from: { x, scaleX },
      velocity: flying ? { x: flying.velocity.x } : undefined,
      spring: "soft",
      lifetime,
    });
  };

  /// Il contenuto del foglio arriva dal lato verso cui si è andati. Si anima il
  /// pannello intero, mai il testo: la superficie dell'editor è già quella
  /// nuova e non aspetta niente.
  const reveal = (strip: HTMLElement, direction: number): void => {
    const pane = paneOf(strip);
    const panel = pane ? [...pane.children].find((child) => child.getAttribute("role") === "tabpanel") : null;
    if (!(panel instanceof HTMLElement) || panel.hidden) return;
    animate(panel, {
      from: { x: direction * CONTENT_SHIFT, opacity: 0 },
      duration: DURATION.short,
      whenReduced: "fade",
      lifetime,
    });
  };

  const settle = (strip: HTMLElement): void => {
    ensurePlus(strip);
    markScroll(strip);
    const tab = strip.hidden ? null : strip.querySelector<HTMLElement>('.tab[aria-selected="true"]');
    const entry = tab?.closest<HTMLElement>(".tab-entry") ?? null;
    if (!tab || !entry) {
      seen.delete(strip);
      return;
    }
    const now: Seen = {
      identity: identityOf(tab.dataset.key),
      index: Number(tab.dataset.index) || 0,
      left: entry.offsetLeft,
      width: entry.offsetWidth,
      entry,
    };
    const before = seen.get(strip);
    seen.set(strip, now);
    // La prima volta non c'è un «da dove». E se l'attiva è la stessa è
    // cambiata solo la misura — il foglio diviso, un cassetto: la sagoma sta
    // con la sua linguetta, e a muoversi è la carta (`stage-motion.ts`).
    if (!before) return;
    if (before.identity === now.identity && before.index === now.index) return;
    slide(before, now);
    if (before.identity !== now.identity && before.index !== now.index) {
      reveal(strip, Math.sign(now.index - before.index));
    }
  };

  // Una striscia cambia nei figli (la vista li rifà) e nella selezione.
  const strip = new MutationObserver((records) => {
    if (lifetime.closed) return;
    const touched = new Set<HTMLElement>();
    for (const record of records) {
      const owner = stripOf(record.target);
      if (owner) touched.add(owner);
    }
    for (const owner of touched) settle(owner);
  });
  lifetime.add(() => strip.disconnect());

  /// Le strisce nascono e muoiono coi riquadri. Si guardano una per una e non
  /// con un solo osservatore sull'albero dei fogli: lì dentro c'è l'editor, e
  /// ogni battuta sveglierebbe questo modulo.
  const discover = (): void => {
    for (const each of strips()) {
      if (!watched.has(each)) {
        watched.add(each);
        strip.observe(each, {
          childList: true,
          subtree: true,
          attributes: true,
          attributeFilter: ["aria-selected", "hidden"],
        });
      }
      settle(each);
    }
  };

  // Il layout rifà i figli diretti di `#panes` a ogni cambio dell'albero.
  const tree = new MutationObserver(() => {
    if (!lifetime.closed) discover();
  });
  tree.observe(panes, { childList: true });
  lifetime.add(() => tree.disconnect());

  // La larghezza cambia senza che cambi il DOM: il posto ricordato va
  // riallineato, altrimenti al prossimo cambio la sagoma partirebbe da un
  // punto che non c'è più.
  if (typeof ResizeObserver !== "undefined") {
    const resize = new ResizeObserver(() => {
      if (lifetime.closed) return;
      for (const each of strips()) {
        markScroll(each);
        const known = seen.get(each);
        if (!known || !known.entry.isConnected) continue;
        seen.set(each, { ...known, left: known.entry.offsetLeft, width: known.entry.offsetWidth });
      }
    });
    resize.observe(panes);
    lifetime.add(() => resize.disconnect());
  }

  lifetime.add(onLanguage(() => {
    for (const each of strips()) {
      const button = plus.get(each);
      if (button) label(button);
    }
  }));

  lifetime.add(() => {
    for (const each of strips()) {
      plus.get(each)?.remove();
      delete each.dataset.scrolled;
    }
  });

  discover();
}
