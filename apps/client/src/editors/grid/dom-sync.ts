// Le righe e le celle della griglia si riusano fra un disegno e l'altro:
// quella disegnata prende gli attributi e i figli di quella nuova, e le
// righe che restano non escono dal documento.

/// Dà a `target` gli attributi di `source`, e toglie quelli che lui non ha.
///
/// Lo stile passa dal CSSOM, mai dall'attributo: la CSP della WebView
/// (`style-src-attr 'none'`) scarta in silenzio `setAttribute("style", …)`,
/// e una riga riusata restava dov'era quando cambiava l'altezza di una riga
/// sopra (IMP-030). Il CSSOM non è stile in linea per la CSP.
export function syncAttributes(target: HTMLElement | SVGElement, source: HTMLElement | SVGElement): void {
  for (const attribute of [...target.attributes]) {
    if (attribute.name !== "style" && !source.hasAttribute(attribute.name)) target.removeAttribute(attribute.name);
  }
  for (const attribute of source.attributes) {
    if (attribute.name === "style") continue;
    if (target.getAttribute(attribute.name) !== attribute.value) target.setAttribute(attribute.name, attribute.value);
  }
  if (target.style.cssText !== source.style.cssText) target.style.cssText = source.style.cssText;
}

/// Porta i figli di `target` a essere come quelli di `source`, tranne
/// `keep` (che resta in fondo, dov'è). Se hanno la stessa forma (gli stessi
/// nodi, con gli stessi tag) si aggiornano sul posto: attributi e testo,
/// senza togliere e rimettere nodi nel documento, che costa di più. Se no,
/// quelli di `target` lasciano il posto a quelli di `source`.
export function morphChildren(target: Node, source: Node, keep: Node | null): void {
  const before = [...target.childNodes].filter((child) => child !== keep);
  const after = [...source.childNodes];
  const same = before.length === after.length && before.every((child, index) => {
    const other = after[index];
    if (child.nodeType !== other.nodeType) return false;
    return !(child instanceof Element) || child.tagName === (other as Element).tagName;
  });
  if (same) {
    before.forEach((child, index) => {
      const other = after[index];
      if (child instanceof HTMLElement || child instanceof SVGElement) {
        syncAttributes(child, other as HTMLElement | SVGElement);
        morphChildren(child, other, null);
      } else if (child.nodeValue !== other.nodeValue) {
        child.nodeValue = other.nodeValue;
      }
    });
    return;
  }
  for (const child of before) child.remove();
  const content = document.createDocumentFragment();
  content.append(...after);
  target.insertBefore(content, keep && keep.parentNode === target ? keep : null);
}

/// Mette `elements` in `parent`, nell'ordine, prima di `end`, e toglie i
/// figli di `parent` che `owned` riconosce e che non ci sono più. Un elemento
/// già al suo posto non si muove: una riga che resta non esce dal DOM.
export function placeInOrder(parent: HTMLElement, elements: readonly HTMLElement[], end: ChildNode | null, owned: (element: Element) => boolean): void {
  const keep = new Set<Element>(elements);
  for (const child of [...parent.children]) if (owned(child) && !keep.has(child)) child.remove();
  let next: ChildNode | null = end;
  // Gli elementi nuovi uno accanto all'altro (le righe che entrano da un
  // bordo) entrano insieme, con un solo inserimento.
  let fresh: HTMLElement[] = [];
  const flush = () => {
    if (!fresh.length) return;
    const ordered = fresh.reverse();
    const batch = document.createDocumentFragment();
    batch.append(...ordered);
    parent.insertBefore(batch, next);
    next = ordered[0];
    fresh = [];
  };
  for (let index = elements.length - 1; index >= 0; index -= 1) {
    const element = elements[index];
    if (element.parentNode !== parent) {
      fresh.push(element);
      continue;
    }
    flush();
    if (element.nextSibling !== next) parent.insertBefore(element, next);
    next = element;
  }
  flush();
}
