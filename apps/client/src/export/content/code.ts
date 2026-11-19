// Il codice con le righe numerate (E28, T74; il prototipo `.pcode.num`,
// passo 29).
//
// I numeri contano le righe del sorgente, non quelle che la carta manda a
// capo: una riga lunga che va a capo ha un numero solo, accanto al suo
// inizio. Il blocco prende a sinistra lo spazio dei numeri (largo quanto il
// numero più lungo), poi ogni numero si mette all'altezza della prima riga
// che la sua riga occupa, misurata sulla resa già disposta. I numeri stanno
// fuori dal testo (`aria-hidden`, non si scelgono): chi copia il codice dal
// PDF copia il codice.
//
// I blocchi che non sono codice da leggere restano come sono: un diagramma
// o un recinto dichiarato (`data-declared-fence`), la copia MathML di una
// formula.

import type { ContentChanges } from "./changes";

/// Le righe del sorgente di un blocco di codice: dove comincia ognuna, nel
/// testo del blocco. Un `\n` finale non apre una riga vuota.
export function lineStarts(text: string): number[] {
  const starts = [0];
  for (let index = 0; index < text.length; index++) {
    if (text[index] === "\n" && index + 1 < text.length) starts.push(index + 1);
  }
  return starts;
}

/// Il nodo di testo e la posizione dentro di lui del carattere `offset` del
/// testo di `root`.
function pointAt(root: Node, offset: number): { node: Text; at: number } | null {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let seen = 0;
  for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
    const length = node.data.length;
    if (offset < seen + length) return { node, at: offset - seen };
    seen += length;
  }
  return null;
}

/// I blocchi di codice da numerare: `pre` col suo `code`, fuori dai recinti
/// dichiarati e dai diagrammi.
export function codeBlocks(page: HTMLElement): HTMLPreElement[] {
  return [...page.querySelectorAll<HTMLPreElement>("pre")].filter((pre) => !pre.hasAttribute("data-declared-fence") && !pre.closest(".mermaid-diagram, .katex, .base-surface") && pre.querySelector("code") !== null);
}

/// Numera le righe di ogni blocco di codice. Torna quanti blocchi ha numerato.
export function applyCodeNumbers(page: HTMLElement, numbered: boolean, changes: ContentChanges): number {
  if (!numbered) return 0;
  const blocks = codeBlocks(page);
  for (const pre of blocks) {
    const code = pre.querySelector("code")!;
    const text = code.textContent ?? "";
    const starts = lineStarts(text);
    const digits = String(starts.length).length;
    changes.attribute(pre, "data-print-numbered", "");
    changes.style(pre, "--print-code-digits", String(digits));
    const gutter = document.createElement("span");
    gutter.className = "export-code-numbers";
    gutter.setAttribute("aria-hidden", "true");
    // Il blocco è già disposto con lo spazio dei numeri: le altezze delle
    // righe sono quelle che usciranno.
    const top = pre.getBoundingClientRect().top;
    const range = document.createRange();
    let fallback = 0;
    for (const [index, start] of starts.entries()) {
      const number = document.createElement("span");
      number.className = "export-code-number";
      number.textContent = String(index + 1);
      const point = pointAt(code, start);
      let y = Number.NaN;
      if (point) {
        try {
          range.setStart(point.node, point.at);
          range.setEnd(point.node, Math.min(point.node.data.length, point.at + 1));
          const rect = range.getClientRects()[0] ?? range.getBoundingClientRect();
          if (rect && rect.height > 0) y = rect.top - top;
        } catch {
          // Un browser senza i rettangoli del testo: i numeri vanno uno per riga.
        }
      }
      // Senza disposizione (i test) i numeri vanno uno per riga.
      if (Number.isNaN(y)) number.style.setProperty("--print-code-line", String(fallback));
      else number.style.top = `${y}px`;
      fallback++;
      gutter.append(number);
    }
    range.detach();
    pre.prepend(gutter);
    changes.add(gutter);
  }
  return blocks.length;
}
