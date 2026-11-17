// Le righe della griglia si riusano fra un disegno e l'altro: la riga
// disegnata prende gli attributi di quella nuova.

/// Dà a `target` gli attributi di `source`, e toglie quelli che lui non ha.
///
/// Lo stile passa dal CSSOM, mai dall'attributo: la CSP della WebView
/// (`style-src-attr 'none'`) scarta in silenzio `setAttribute("style", …)`,
/// e una riga riusata restava dov'era quando cambiava l'altezza di una riga
/// sopra (IMP-030). Il CSSOM non è stile in linea per la CSP.
export function syncAttributes(target: HTMLElement, source: HTMLElement): void {
  for (const attribute of [...target.attributes]) {
    if (attribute.name !== "style" && !source.hasAttribute(attribute.name)) target.removeAttribute(attribute.name);
  }
  for (const attribute of source.attributes) {
    if (attribute.name === "style") continue;
    if (target.getAttribute(attribute.name) !== attribute.value) target.setAttribute(attribute.name, attribute.value);
  }
  if (target.style.cssText !== source.style.cssText) target.style.cssText = source.style.cssText;
}
