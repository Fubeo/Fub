// Stampa ed export fedele dal reso esistente (P07/F30, lato shell).
// The caller must obtain a print-target render from the renderer; a screen
// preview is not a print projection. No browser PDF viewer or screenshot.
import type { RenderedDocument } from "../../host/contract";
import { setSanitizedHtml } from "../../ui/sanitize";
import { openLifetime } from "../../ui/lifetime";
import { writeClipboardText } from "../../platform/clipboard";

export interface PrintOptions {
  title: string;
  rendered: RenderedDocument;
  /// Chi idrata la resa: parti dei renderer, diagrammi, formule, media del
  /// vault. Assente, si stampa l'HTML sanificato e basta.
  mount?: PrintMount;
  onAfterPrint?: () => void;
}
/** Injection port: composition obtains RenderTarget::Print from the host. */
export type PrintRenderer = (doc: string, target: "print") => Promise<RenderedDocument>;
/// Monta la resa di stampa nel contenitore. `ready` si risolve quando ciò che
/// arriva dopo (note trascluse, media) è arrivato o non arriverà.
export type PrintMount = (container: HTMLElement, rendered: RenderedDocument) => {
  readonly ready: Promise<void>;
  dispose(): void;
};

/// Quanto la stampa aspetta diagrammi, formule e immagini prima di partire
/// lo stesso: una stampa con un diagramma che non arriva resta una stampa.
export const PRINT_WAIT_MS = 8_000;

export async function printDocument(
  doc: string,
  title: string,
  render: PrintRenderer,
  mount?: PrintMount,
): Promise<() => void> {
  const rendered = await render(doc, "print");
  return printRendered({ title, rendered, mount });
}

function printPage(title: string): { page: HTMLElement; body: HTMLElement } {
  const page = document.createElement("article");
  page.className = "print-page";
  const heading = document.createElement("h1");
  heading.textContent = title;
  const body = document.createElement("div");
  // La tipografia del documento reso è quella della Lettura.
  body.className = "print-body markdown-rendered";
  page.append(heading, body);
  return { page, body };
}

/** Costruisce il documento stampabile: titolo, reso sanitizzato, contatore. */
export function buildPrintDocument(options: PrintOptions): HTMLElement {
  const { page, body } = printPage(options.title);
  setSanitizedHtml(body, options.rendered.html);
  return page;
}

/// Ciò che si carica dopo il montaggio: diagrammi e formule dichiarano
/// `data-state="loading"`, i media del vault `data-vault-media="pending"`.
const PENDING = '[data-state="loading"], [data-vault-media="pending"]';

/// Aspetta che la resa montata sia completa: arrivati embed e media, niente
/// più segnaposti in caricamento, ogni immagine decodificata, i font pronti.
/// Mai oltre `limit`.
export async function settlePrint(container: HTMLElement, ready: Promise<void>, limit = PRINT_WAIT_MS): Promise<void> {
  let timer: number | undefined;
  let observer: MutationObserver | undefined;
  const expired = new Promise<void>((resolve) => {
    timer = window.setTimeout(resolve, limit);
  });
  const quiet = () => new Promise<void>((resolve) => {
    if (!container.querySelector(PENDING)) {
      resolve();
      return;
    }
    observer = new MutationObserver(() => {
      if (!container.querySelector(PENDING)) resolve();
    });
    observer.observe(container, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["data-state", "data-vault-media"],
    });
  });
  const complete = async () => {
    await ready;
    await quiet();
    // Fuori dallo schermo un'immagine pigra non partirebbe mai.
    const images = Array.from(container.querySelectorAll("img"));
    for (const image of images) image.loading = "eager";
    // Un'immagine rotta non ferma la stampa: stampa il suo segnaposto.
    await Promise.all(images.map((image) => Promise.resolve().then(() => image.decode()).catch(() => undefined)));
    await document.fonts?.ready;
  };
  try {
    await Promise.race([complete(), expired]);
  } finally {
    window.clearTimeout(timer);
    observer?.disconnect();
  }
}

/// Lo stile della stampa. A schermo la resa sta fuori dalla vista ma
/// disposta, perché diagrammi e immagini si carichino; sulla carta resta solo
/// lei. La carta ha una luce sola: inchiostro scuro su bianco con i colori
/// del foglio chiaro, qualunque sia il tema, e i comandi dei blocchi
/// (didascalie, sorgenti, copia) non si stampano.
const PRINT_CSS = `
  @media screen {
    .print-host {
      position: fixed !important;
      top: 0;
      left: 0;
      width: 180mm;
      height: 0;
      overflow: hidden;
      visibility: hidden;
      pointer-events: none;
    }
  }
  @page { margin: 18mm 16mm; }
  @media print {
    html, body {
      height: auto !important;
      background: #ffffff !important;
      color-scheme: light;
    }
    body > :not(.print-host) { display: none !important; }
    .print-host {
      display: block !important;
      position: static !important;
      --doc-bg: #ffffff;
      --doc-fg: #2a2826;
      --doc-heading: #1f1d1b;
      --doc-link: #145785;
      --doc-fill: rgb(135 135 135 / 16%);
      --doc-fill-soft: rgb(135 135 135 / 10%);
      --doc-rule: rgb(135 135 135 / 45%);
      --doc-rule-soft: rgb(135 135 135 / 28%);
      --doc-highlight: rgb(240 200 80 / 38%);
      --doc-danger: #993836;
      --text: #2a2826;
      --muted: #605c56;
      --syn-keyword: #744981;
      --syn-name: #8c443a;
      --syn-function: #2b5f92;
      --syn-literal: #814f22;
      --syn-type: #705a12;
      --syn-operator: #236775;
      --syn-comment: #6a635b;
      --syn-string: #3e6840;
      --syn-heading: #1f1d1b;
      --syn-invalid: #9a2929;
      color: var(--doc-fg);
      background: var(--doc-bg);
    }
    .print-page { break-inside: auto; }
    .print-body pre, .print-body figure, .print-body table, .print-body img,
    .print-body .math-block, .print-body .callout { break-inside: avoid; }
    .print-body hr { break-after: page; visibility: hidden; }
    .print-body img { max-width: 100%; height: auto; }
    .print-body .mermaid-diagram figcaption,
    .print-body .mermaid-diagram[data-state="ready"] details,
    .print-body .markdown-code-copy { display: none !important; }
  }`;

/**
 * Stampa il reso: lo monta in un contenitore fuori vista, aspetta che sia
 * completo (`settlePrint`), chiama `window.print`, rimuove tutto su
 * `afterprint`. L'ascolto vive in una `Lifetime` dedicata (mai
 * `window.addEventListener` nudo: la guardia check-listeners pretende un
 * proprietario). Il teardown e' garantito anche se la stampa viene annullata:
 * l'evento `afterprint` scatta comunque.
 */
export async function printRendered(options: PrintOptions): Promise<() => void> {
  if (typeof window.print !== "function") {
    throw new Error("Printing is unavailable in this environment");
  }
  const life = openLifetime();
  const host = document.createElement("div");
  host.className = "print-host";
  host.setAttribute("aria-hidden", "true");
  const stylesheet = document.createElement("style");
  stylesheet.textContent = PRINT_CSS;
  host.append(stylesheet);
  const { page, body } = printPage(options.title);
  host.append(page);
  document.body.append(host);
  life.add(() => host.remove());
  let done = false;
  function teardown(): void {
    if (done) return;
    done = true;
    life.close();
    options.onAfterPrint?.();
  }
  try {
    if (options.mount) {
      const mounted = options.mount(body, options.rendered);
      life.add(() => mounted.dispose());
      await settlePrint(body, mounted.ready);
    } else {
      setSanitizedHtml(body, options.rendered.html);
    }
    life.listen(window, "afterprint", teardown);
    window.print();
  } catch (error) {
    teardown();
    throw error;
  }
  // Se `afterprint` non scatta (contesti senza stampa), il contenitore non
  // resta per sempre: chi chiama conserva il teardown e lo chiama al cambio
  // di tab. Qui si torna subito il teardown per quello scopo.
  return teardown;
}

/** Copia testo negli appunti, con errore che dice cosa e' fallito. */
export async function copyRenderedText(text: string): Promise<void> {
  if (!text) throw new Error("nothing to copy: the rendered text is empty");
  try {
    await writeClipboardText(text);
  } catch (error) {
    throw new Error(
      `cannot copy ${text.length} characters: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
