// Le slide Markdown (P07/F08): spezzare il reso, riusare la resa.
//
// Lo split avviene sul DOM reso, solo su `hr` figli diretti (`:scope > hr`,
// cioe' `Block::ThematicBreak` del modello — mai scan del sorgente: `---` e'
// anche delimitatore frontmatter e underline Setext, e dentro i fence non e'
// un break; frontmatter e heading restano fuori dallo split per costruzione).
// Ogni slide riusa la stessa resa del documento (stessi renderer, stessa
// sanitize, stessi embed idratati). Navigazione, schermo intero con uscita
// accessibile (Escape, pulsante chiudi con fuoco intrappolato, `aria-modal`),
// tastiera (frecce, Home/End, PageUp/Down), hash `#slide=N` profondo.
// Tutti gli ascolti vivono nella `Lifetime` del deck (mai addEventListener
// nudi: la guardia check-listeners pretende un proprietario).
import { openLifetime } from "./lifetime";
import { t } from "../i18n/strings";

/** Spezza il contenuto reso in slide sui soli `hr` di primo livello. */
export function splitRenderedSlides(content: HTMLElement): HTMLElement[] {
  const slides: HTMLElement[] = [];
  let current = document.createElement("section");
  current.className = "slide";
  for (const child of Array.from(content.childNodes)) {
    if (child instanceof HTMLElement && child.tagName === "HR" && child.parentElement === content) {
      if (current.childNodes.length > 0) slides.push(current);
      current = document.createElement("section");
      current.className = "slide";
      continue;
    }
    current.append(child);
  }
  if (current.childNodes.length > 0) slides.push(current);
  if (slides.length === 0) {
    const single = document.createElement("section");
    single.className = "slide";
    slides.push(single);
  }
  return slides;
}

export interface SlideDeck {
  readonly element: HTMLElement;
  readonly count: number;
  goTo(index: number): void;
  next(): void;
  previous(): void;
  destroy(): void;
}

/** Monta il deck: una slide visibile, le altre `hidden`, roving live region. */
export function mountSlideDeck(
  host: HTMLElement,
  slides: HTMLElement[],
  options: { initial?: number; onClose?: () => void } = {},
): SlideDeck {
  const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const previousHash = location.hash;
  const life = openLifetime();
  const deck = document.createElement("div");
  deck.className = "slide-deck";
  deck.setAttribute("role", "dialog");
  deck.setAttribute("aria-modal", "true");
  deck.style.cssText = "position:fixed;inset:0;z-index:2147483000;overflow:auto;background:var(--surface, #fff);color:var(--text, #111);padding:2rem";
  deck.tabIndex = -1;

  const status = document.createElement("p");
  status.className = "slide-status";
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");

  const stage = document.createElement("div");
  stage.className = "slide-stage";
  const adopted: HTMLElement[] = [];
  for (const slide of slides) {
    slide.hidden = true;
    stage.append(slide);
    adopted.push(slide);
  }

  const controls = document.createElement("div");
  controls.className = "slide-controls";
  const prev = document.createElement("button");
  prev.type = "button";
  prev.textContent = "‹";
  const next = document.createElement("button");
  next.type = "button";
  next.textContent = "›";
  const close = document.createElement("button");
  close.type = "button";
  close.textContent = t("slides.close");
  controls.append(prev, next, close);
  deck.append(status, stage, controls);
  host.append(deck);

  let index = Math.min(Math.max(0, options.initial ?? slideFromHash(location.hash, adopted.length) ?? 0), adopted.length - 1);
  let closed = false;

  function show(n: number): void {
    if (closed || adopted.length === 0) return;
    index = (n + adopted.length) % adopted.length;
    adopted.forEach((slide, i) => {
      slide.hidden = i !== index;
    });
    status.textContent = t("slides.position", { index: index + 1, count: adopted.length });
    try {
      history.replaceState(null, "", `#slide=${index + 1}`);
    } catch {
      // deep link best-effort: in contesti senza history resta lo stato
    }
  }

  function teardown(): void {
    if (closed) return;
    closed = true;
    life.close();
    // Le slide tornano al mittente: il deck non possiede i nodi, li ospita.
    for (const slide of adopted) slide.remove();
    deck.remove();
    if (location.hash.startsWith("#slide=")) {
      try {
        history.replaceState(null, "", `${location.pathname}${location.search}${previousHash}`);
      } catch {
        // un contesto senza history mantiene il link dell'ultima slide
      }
    }
    if (previouslyFocused?.isConnected) previouslyFocused.focus();
  }

  function onKey(event: KeyboardEvent): void {
    if (closed) return;
    const target = event.target;
    if (event.key !== "Escape" && event.key !== "Tab" && target instanceof HTMLElement &&
        (target.isContentEditable || target.matches("input,textarea,select"))) return;
    switch (event.key) {
      case "Escape":
        event.preventDefault();
        teardown();
        options.onClose?.();
        break;
      case "ArrowRight":
      case "PageDown":
        event.preventDefault();
        show(index + 1);
        break;
      case "ArrowLeft":
      case "PageUp":
        event.preventDefault();
        show(index - 1);
        break;
      case "Home":
        event.preventDefault();
        show(0);
        break;
      case "End":
        event.preventDefault();
        show(adopted.length - 1);
        break;
    }
    if (event.key === "Tab") {
      const focusable = Array.from(deck.querySelectorAll<HTMLElement>(
        'button:not([disabled]),a[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])',
      )).filter((item) => !item.closest("[hidden]"));
      if (focusable.length === 0) {
        event.preventDefault();
        deck.focus();
      } else {
        const current = focusable.indexOf(document.activeElement as HTMLElement);
        if (event.shiftKey && current <= 0) {
          event.preventDefault();
          focusable[focusable.length - 1]!.focus();
        } else if (!event.shiftKey && (current < 0 || current === focusable.length - 1)) {
          event.preventDefault();
          focusable[0]!.focus();
        }
      }
    }
  }

  life.listen(prev, "click", () => show(index - 1));
  life.listen(next, "click", () => show(index + 1));
  life.listen(close, "click", () => {
    teardown();
    options.onClose?.();
  });
  life.listen(deck, "keydown", onKey);
  life.add(() => {
    closed = true;
    for (const slide of adopted) slide.remove();
    deck.remove();
  });
  show(index);
  deck.focus();

  return {
    element: deck,
    count: adopted.length,
    goTo: (n: number) => show(n),
    next: () => show(index + 1),
    previous: () => show(index - 1),
    destroy: teardown,
  };
}

/** La pagina iniziale da `#slide=N` (1-based): fuori misura torna `null`. */
export function slideFromHash(hash: string, count: number): number | null {
  const match = /^#slide=(\d+)$/.exec(hash);
  if (!match) return null;
  const page = Number(match[1]);
  if (!Number.isSafeInteger(page) || page < 1 || page > count) return null;
  return page - 1;
}

/** A slide mode over the existing sanitized render, without consuming its nodes. */
export function mountSlidePresentation(
  host: HTMLElement,
  rendered: HTMLElement,
  options: { onClose?: () => void } = {},
): SlideDeck {
  const copy = rendered.cloneNode(true) as HTMLElement;
  const slides = splitRenderedSlides(copy);
  if (slides.length < 2) throw new Error("the rendered document has no slide breaks");
  return mountSlideDeck(host, slides, options);
}
