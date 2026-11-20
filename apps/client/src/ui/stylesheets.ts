// Come uno stile scritto a runtime entra nel documento, sotto la CSP dell'app.
//
// La CSP (`crates/fub-app/tauri.conf.json`) è `style-src 'self';
// style-src-attr 'none'`: niente stili in linea. Un elemento `<style>` vale
// soltanto con il nonce della pagina, un attributo `style` scritto come markup
// non vale mai, e il rifiuto è silenzioso — il pezzo resta senza stile. Le
// strade che restano sono tre, e passano tutte da qui:
//
// - **un foglio costruito** (`new CSSStyleSheet()` in
//   `document.adoptedStyleSheets`): la CSP non lo guarda, perché non è markup.
//   È la strada di ogni foglio che l'app scrive da sé: il tema
//   (`theme/loader.ts`, con l'ordine dei suoi canali), la stampa, la vista dei
//   contorni della lavagna. `adoptSheet` lo monta dopo quelli che ci sono;
//
// - **il nonce della pagina**, per chi un foglio costruito non lo sa usare.
//   Ogni pagina porta un `<style data-fub-nonce></style>` vuoto: Tauri,
//   servendola, gli scrive un nonce casuale (uno per caricamento) e lo
//   aggiunge a `style-src`. `pageNonce` lo legge. Lo usa CodeMirror
//   (`EditorView.cspNonce`), che i suoi stili li mette in un `<style>`, e
//   Mermaid, che il nonce non lo sa chiedere, lo riceve da `withPageNonce`
//   per la durata del disegno;
//
// - la terza è CSSOM: `element.style.x = …`, `style.setProperty`,
//   `style.cssText` sono stile scritto da uno script, e la CSP non lo guarda.
//   `styledElement` la offre a chi descrive un elemento invece di crearlo
//   (il `toDOM` di uno schema ProseMirror, che un `style` fra gli attributi
//   lo scriverebbe con `setAttribute`), e `cssomStyleDescendants` al
//   contenitore dove una libreria scrive lo `style` dei suoi elementi con
//   `setAttribute` (Mermaid, dove misura).
//
// `.github/scripts/check-inline-styles.mjs` impedisce che torni un
// `<style>` creato da uno script o un `style` scritto come markup; il banco
// serve la CSP vera e fallisce alla prima violazione (`bench/stage.mjs`).

/** Il nonce che Tauri ha scritto sul portatore della pagina, o `null`. */
export function pageNonce(doc: Document = document): string | null {
  const carrier = doc.head?.querySelector<HTMLStyleElement>("style[data-fub-nonce]") ?? null;
  // La proprietà, non l'attributo: con la CSP in un header il browser svuota
  // l'attributo `nonce` appena l'elemento è nel documento, e il valore resta
  // soltanto lì.
  const nonce = carrier === null ? "" : carrier.nonce || carrier.getAttribute("nonce") || "";
  return nonce === "" ? null : nonce;
}

/** Un foglio costruito montato nel documento. */
export interface AdoptedSheet {
  /** Sostituisce il testo del foglio, al suo posto nella cascata. */
  replace(text: string): void;
  /** Toglie il foglio dal documento. Una seconda volta non fa niente. */
  dispose(): void;
}

/**
 * Monta `text` come foglio costruito, dopo i fogli costruiti che il documento
 * ha già: a parità di specificità vince su di loro e sui file CSS della
 * pagina, come vinceva un `<style>` aggiunto in coda.
 */
export function adoptSheet(text: string, doc: Document = document): AdoptedSheet {
  const Sheet = doc.defaultView?.CSSStyleSheet ?? CSSStyleSheet;
  const sheet = new Sheet();
  sheet.replaceSync(text);
  doc.adoptedStyleSheets = [...doc.adoptedStyleSheets, sheet];
  let mounted = true;
  return {
    replace(next) {
      if (mounted) sheet.replaceSync(next);
    },
    dispose() {
      if (!mounted) return;
      mounted = false;
      doc.adoptedStyleSheets = doc.adoptedStyleSheets.filter((existing) => existing !== sheet);
    },
  };
}

/**
 * Un elemento con i suoi attributi e uno stile scritto via CSSOM (proprietà
 * e variabili `--x`), mai come attributo `style`. Per il `toDOM` di uno schema:
 * restituisce `{ dom, contentDOM }` con l'elemento in tutte e due.
 */
export function styledElement(
  tag: string,
  attrs: Readonly<Record<string, string>>,
  style: Readonly<Record<string, string>>,
): { dom: HTMLElement; contentDOM: HTMLElement } {
  const dom = document.createElement(tag);
  for (const [name, value] of Object.entries(attrs)) dom.setAttribute(name, value);
  for (const [name, value] of Object.entries(style)) dom.style.setProperty(name, value);
  return { dom, contentDOM: dom };
}

/**
 * Un contenitore dove una libreria monta degli elementi e poi scrive il loro
 * stile con `setAttribute("style", …)`, che la CSP rifiuta: Mermaid, dove
 * misura. Lì d3 scrive lo `style` sul `<div>` che monta (`appendDivSvgG`,
 * `font-family`) e sui discendenti dell'SVG di prova: `style A
 * font-size:30px`, `linkStyle`, gli stili di un `classDef`. Il rifiuto non si
 * vede nei colori del disegno finale (l'attributo resta scritto, e l'immagine
 * non è sotto la CSP della pagina), ma si vede nelle misure: un'etichetta
 * misurata senza il suo `font-size` esce dal riquadro (#528).
 *
 * Per ogni elemento che entra nel contenitore, a qualunque profondità
 * (`appendChild` e `insertBefore`, le strade di d3), lo `style` scritto come
 * attributo diventa CSSOM (`style.cssText`): lo stesso stile, che la CSP
 * lascia valere, senza allentarla. Uno `style` che l'elemento portava già
 * quando è entrato si riscrive allo stesso modo. Il resto della pagina non
 * cambia: niente prototipi toccati, soltanto le proprietà degli elementi del
 * contenitore, che spariscono con loro.
 */
export function cssomStyleDescendants(container: HTMLElement): void {
  watchInsertions(container);
}

/** Gli elementi già preparati: uno spostato dentro il contenitore non si prepara due volte. */
const adopted = new WeakSet<Element>();

function watchInsertions(parent: Element): void {
  const append = Node.prototype.appendChild;
  const insert = Node.prototype.insertBefore;
  Object.defineProperty(parent, "appendChild", {
    configurable: true,
    writable: true,
    value: function appendChild<T extends Node>(this: Element, child: T): T {
      adoptInserted(child);
      return append.call(this, child) as T;
    },
  });
  Object.defineProperty(parent, "insertBefore", {
    configurable: true,
    writable: true,
    value: function insertBefore<T extends Node>(this: Element, child: T, reference: Node | null): T {
      adoptInserted(child);
      return insert.call(this, child, reference) as T;
    },
  });
}

function adoptInserted(node: Node): void {
  // Un frammento si svuota entrando: i suoi figli si preparano prima.
  if (node instanceof DocumentFragment) {
    for (const child of Array.from(node.children)) adopt(child);
  } else if (node instanceof Element) {
    adopt(node);
  }
}

function adopt(element: Element): void {
  if (adopted.has(element)) return;
  if (!(element instanceof HTMLElement || element instanceof SVGElement)) return;
  adopted.add(element);
  const asCssom = styleAttributeAsCssom(element);
  watchInsertions(element);
  const written = element.getAttribute("style");
  if (written !== null) asCssom(element, written);
  for (const child of Array.from(element.children)) adopt(child);
}

/// Prepara `element` e restituisce come scrivergli uno stile via CSSOM.
function styleAttributeAsCssom(element: HTMLElement | SVGElement): (target: HTMLElement | SVGElement, value: string) => void {
  const set = Element.prototype.setAttribute;
  const setNS = Element.prototype.setAttributeNS;
  // Un DOM che riflette `cssText` sull'attributo chiamando `setAttribute`
  // (happy-dom, nei test) torna qui: quella volta l'attributo si scrive e basta.
  let reflecting = false;
  const asCssom = (target: HTMLElement | SVGElement, value: string): void => {
    reflecting = true;
    try {
      target.style.cssText = String(value);
    } finally {
      reflecting = false;
    }
  };
  Object.defineProperty(element, "setAttribute", {
    configurable: true,
    writable: true,
    value: function setAttribute(this: HTMLElement | SVGElement, name: string, value: string): void {
      if (reflecting || name.toLowerCase() !== "style") set.call(this, name, value);
      else asCssom(this, value);
    },
  });
  Object.defineProperty(element, "setAttributeNS", {
    configurable: true,
    writable: true,
    value: function setAttributeNS(this: HTMLElement | SVGElement, namespace: string | null, name: string, value: string): void {
      if (reflecting || namespace !== null || name.toLowerCase() !== "style") setNS.call(this, namespace, name, value);
      else asCssom(this, value);
    },
  });
  return asCssom;
}

let stamping = 0;

/**
 * Esegue `run` con il nonce della pagina su ogni `<style>` che uno script
 * crea con `document.createElement` nel frattempo. È per una libreria che
 * scrive il suo `<style>` e non sa del nonce: Mermaid, che durante il disegno
 * mette il foglio del diagramma nell'SVG di prova e misura le etichette con
 * quei caratteri; senza il foglio le misure verrebbero da un altro carattere
 * e il disegno finale taglierebbe il testo. Il nonce non apre niente a un
 * estraneo: lo conosce solo uno script dell'app, e nessun HTML che arriva da
 * un vault porta un `<style>` (il sanitizzatore e DOMPurify lo tolgono).
 * Senza nonce `run` gira e basta. Le chiamate si possono annidare.
 */
export async function withPageNonce<T>(run: () => Promise<T>): Promise<T> {
  const nonce = pageNonce(document);
  if (nonce === null) return run();
  if (stamping++ === 0) {
    const create = Document.prototype.createElement;
    Object.defineProperty(document, "createElement", {
      configurable: true,
      writable: true,
      value: function createElement(this: Document, tag: string, options?: ElementCreationOptions): HTMLElement {
        const element = create.call(this, tag, options);
        if (element instanceof HTMLStyleElement) element.nonce = nonce;
        return element;
      },
    });
  }
  try {
    return await run();
  } finally {
    if (--stamping === 0) delete (document as { createElement?: unknown }).createElement;
  }
}
