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
//   lo scriverebbe con `setAttribute`), e `cssomStyleChildren` al
//   contenitore dove una libreria scrive lo `style` dei figli con
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
 * Un contenitore dove una libreria monta un elemento e poi gli scrive lo stile
 * con `setAttribute("style", …)`, che la CSP rifiuta: Mermaid, sul `<div>`
 * dove misura (`appendDivSvgG` scrive lì `font-family`). Per ogni elemento
 * che si aggiunge come figlio diretto del contenitore, lo `style` scritto come
 * attributo diventa CSSOM (`style.cssText`): lo stesso stile, che la CSP lascia
 * valere, senza allentarla. Il resto della pagina non cambia: niente prototipi
 * toccati, soltanto le proprietà dei due elementi.
 */
export function cssomStyleChildren(container: HTMLElement): void {
  const append = Node.prototype.appendChild;
  Object.defineProperty(container, "appendChild", {
    configurable: true,
    writable: true,
    value: function appendChild<T extends Node>(this: HTMLElement, child: T): T {
      if (child instanceof HTMLElement || child instanceof SVGElement) styleAttributeAsCssom(child);
      return append.call(this, child) as T;
    },
  });
}

function styleAttributeAsCssom(element: HTMLElement | SVGElement): void {
  const set = Element.prototype.setAttribute;
  // Un DOM che riflette `cssText` sull'attributo chiamando `setAttribute`
  // (happy-dom, nei test) torna qui: quella volta l'attributo si scrive e basta.
  let reflecting = false;
  Object.defineProperty(element, "setAttribute", {
    configurable: true,
    writable: true,
    value: function setAttribute(this: HTMLElement | SVGElement, name: string, value: string): void {
      if (reflecting || name.toLowerCase() !== "style") {
        set.call(this, name, value);
        return;
      }
      reflecting = true;
      try {
        this.style.cssText = String(value);
      } finally {
        reflecting = false;
      }
    },
  });
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
