// Il taglio a riga intera delle schede ferme (#411): una scheda di testo o
// l'anteprima di una nota che non ci sta tutta si ferma sotto l'ultima riga
// che si legge intera, mai a metà di una riga.
//
// - **Chi taglia.** Il contenitore (`clip`) ha già `overflow: hidden` e
//   l'altezza che la scheda gli dà; questo modulo scrive solo la variabile
//   `--canvas-card-cut` (l'altezza fino alla fine dell'ultima riga intera) e
//   la pelle la usa come `max-height` fuori dalla scheda attiva. Dentro la
//   scheda attiva il testo scorre e la variabile non conta.
// - **Le righe.** I riquadri delle righe di ogni nodo di testo
//   (`Range.getClientRects`) e quelli degli elementi senza testo che occupano
//   righe (immagini, disegni, formule). La regola pura è `wholeLinesCut`, che
//   i test provano senza layout.
// - **La misura.** Si toglie la variabile, si misura lo spazio vero, si
//   rimette. Le coordinate dello schermo si riportano a quelle della scheda
//   (lo zoom della lavagna è una trasformazione e non cambia il layout).
//   Un `ResizeObserver` (sul contenitore e sul suo genitore, la scheda che
//   cambia misura), le immagini che arrivano, lo scorrimento e i caratteri
//   caricati rifanno il conto; chi cambia il contenuto chiama `refit`. I
//   conti chiesti nello stesso giro si fanno insieme in un microtask, con un
//   layout solo per tutte le schede.

import type { Lifetime } from "../../ui/lifetime";

/// La variabile che la pelle legge.
export const CUT_PROPERTY = "--canvas-card-cut";

/// Gli elementi senza testo che occupano una riga.
const BOXES = "img, svg, canvas, video, picture, math, hr";

export interface LineBox {
  readonly top: number;
  readonly bottom: number;
}

/// Dove tagliare perché nessuna riga resti a metà: la fine dell'ultima riga
/// che sta tutta sopra `limit`. `null` se tutto ci sta (nessun taglio) o se
/// non ci sta neanche la prima riga (meglio mezza riga che una scheda vuota).
/// Le misure sono dal bordo alto del contenitore.
export function wholeLinesCut(lines: readonly LineBox[], limit: number): number | null {
  const EPSILON = 0.5;
  let cut = -Infinity;
  let overflow = false;
  for (const line of lines) {
    if (line.bottom - line.top <= 0) continue;
    if (line.bottom <= limit + EPSILON) cut = Math.max(cut, line.bottom);
    else overflow = true;
  }
  if (!overflow || cut === -Infinity) return null;
  return cut;
}

/// Le righe di `clip`, in px della scheda dal suo bordo alto. Si ferma alla
/// prima riga oltre `stop`: il resto non cambia il taglio.
function lineBoxes(clip: HTMLElement, scale: number, origin: number, stop: number): LineBox[] {
  const out: LineBox[] = [];
  const range = document.createRange();
  const walker = document.createTreeWalker(clip, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  const local = (rect: DOMRect): LineBox => ({ top: (rect.top - origin) / scale, bottom: (rect.bottom - origin) / scale });
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node instanceof Element) {
      if (!node.matches(BOXES)) continue;
      const box = local(node.getBoundingClientRect());
      out.push(box);
      if (box.top > stop) break;
      continue;
    }
    if (!node.nodeValue?.trim()) continue;
    range.selectNodeContents(node);
    let past = false;
    for (const rect of range.getClientRects()) {
      const box = local(rect);
      out.push(box);
      if (box.top > stop) past = true;
    }
    if (past) break;
  }
  range.detach();
  return out;
}

/// Il taglio di `clip` misurato senza taglio, come valore della variabile;
/// `null` se non serve.
function measureCut(clip: HTMLElement): string | null {
  const height = clip.offsetHeight;
  // Nascosto (da lontano la scheda non ha corpo) o senza layout: niente.
  if (height <= 0 || clip.scrollHeight <= clip.clientHeight + 1) return null;
  const rect = clip.getBoundingClientRect();
  const scale = rect.height / height || 1;
  const style = getComputedStyle(clip);
  const borderTop = parseFloat(style.borderTopWidth) || 0;
  const paddingTop = parseFloat(style.paddingTop) || 0;
  const paddingBottom = parseFloat(style.paddingBottom) || 0;
  const borderBottom = parseFloat(style.borderBottomWidth) || 0;
  const limit = borderTop + clip.clientHeight - paddingBottom;
  const cut = wholeLinesCut(lineBoxes(clip, scale, rect.top, limit), limit);
  if (cut === null) return null;
  // `max-height` conta come `box-sizing`: il bordo e il riempimento sotto
  // restano fuori dal testo.
  const value = style.boxSizing === "border-box" ? cut + paddingBottom + borderBottom : cut - borderTop - paddingTop;
  // Al centesimo: lo zoom lascia resti di virgola mobile (73,99999…).
  return `${Math.max(0, Math.round(value * 100) / 100)}px`;
}

/// Rifà il taglio dei contenitori `clips` adesso, tutti insieme: prima si
/// tolgono tutti i tagli, poi si misura, poi si scrive, così il layout si fa
/// una volta e non una per scheda.
export function fitWholeLines(...clips: HTMLElement[]): void {
  for (const clip of clips) clip.style.removeProperty(CUT_PROPERTY);
  const cuts = clips.map(measureCut);
  clips.forEach((clip, index) => {
    const cut = cuts[index];
    if (cut) clip.style.setProperty(CUT_PROPERTY, cut);
  });
}

/// I contenitori da rifare al prossimo giro: un microtask, dopo il codice che
/// ha cambiato le schede e prima che si dipinga (niente lampo di righe a
/// metà, niente fotogramma in più).
const queue = new Set<HTMLElement>();
let queued = false;
function flush(): void {
  queued = false;
  const clips = [...queue].filter((clip) => clip.isConnected);
  queue.clear();
  fitWholeLines(...clips);
}

export interface WholeLines {
  /// Il contenuto è cambiato: rifà il taglio prima del prossimo disegno.
  refit(): void;
}

/// Tiene il taglio di `clip` per tutta `lifetime`.
export function watchWholeLines(clip: HTMLElement, lifetime: Lifetime): WholeLines {
  const refit = (): void => {
    if (lifetime.closed) return;
    queue.add(clip);
    if (queued) return;
    queued = true;
    queueMicrotask(flush);
  };
  lifetime.add(() => queue.delete(clip));
  if (typeof ResizeObserver !== "undefined") {
    // Il taglio cambia la misura del contenitore: il conto che segue dà lo
    // stesso taglio e lo `ResizeObserver` si ferma lì. La prima osservazione
    // fa il primo taglio.
    const observer = new ResizeObserver(refit);
    observer.observe(clip);
    if (clip.parentElement) observer.observe(clip.parentElement);
    lifetime.add(() => observer.disconnect());
  }
  // Un'immagine che arriva cambia le righe; il caricamento non risale, si
  // sente in cattura.
  lifetime.listen(clip, "load", refit, { capture: true });
  // La resa di una nota attiva scorre, e uscendo resta dov'era: il taglio
  // segue le righe che si vedono.
  lifetime.listen(clip, "scroll", refit, { passive: true });
  void document.fonts?.ready.then(refit, () => undefined);
  refit();
  return { refit };
}
