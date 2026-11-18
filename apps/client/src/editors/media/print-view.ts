// Stampa ed export fedele dal reso esistente (P07/F30, lato shell).
// The caller must obtain a print-target render from the renderer; a screen
// preview is not a print projection. No browser PDF viewer or screenshot.
import type { RenderedDocument } from "../../host/contract";
import { setSanitizedHtml } from "../../ui/sanitize";
import { openLifetime } from "../../ui/lifetime";
import { adoptSheet } from "../../ui/stylesheets";
import { writeClipboardText } from "../../platform/clipboard";
import { t } from "../../i18n/strings";
import { errorText } from "../../host/errors";

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

/// Ciò che dopo l'attesa non è arrivato, o non si è lasciato decodificare:
/// i segnaposti ancora in caricamento e le immagini senza i loro pixel.
function undrawnElements(container: HTMLElement): HTMLElement[] {
  const pending = Array.from(container.querySelectorAll<HTMLElement>(PENDING));
  const outer = pending.filter((element) => !pending.some((other) => other !== element && other.contains(element)));
  const images = Array.from(container.querySelectorAll<HTMLImageElement>("img"))
    .filter((image) => !outer.some((element) => element.contains(image)) && (!image.complete || image.naturalWidth === 0));
  return [...outer, ...images];
}

/// Il nome che il riquadro di un contenuto non disegnato dice: il file o il
/// testo alternativo di un'immagine, se no la specie del blocco.
function undrawnName(element: HTMLElement): string {
  const image = element instanceof HTMLImageElement ? element : element.querySelector("img");
  const file = element.dataset.vaultId ?? image?.dataset.vaultId ?? image?.getAttribute("src") ?? "";
  const alt = image?.getAttribute("alt")?.trim();
  if (alt) return alt;
  const base = file.split(/[?#]/u)[0].split("/").pop() ?? "";
  if (base && !file.startsWith("blob:") && !file.startsWith("data:")) {
    try {
      return decodeURIComponent(base);
    } catch {
      return base;
    }
  }
  if (element.closest(".mermaid-diagram") || element.matches("[data-declared-fence], .mermaid-diagram")) return t("print.undrawn.diagram");
  if (element.matches(".math-block, .katex-display")) return t("print.undrawn.formula");
  if (image || element.hasAttribute("data-vault-media")) return t("print.undrawn.image");
  return t("print.undrawn.content");
}

/// Mette al posto di ogni diagramma, formula o immagine che non è arrivato
/// entro l'attesa (`PRINT_WAIT_MS`) il suo riquadro: il nome e «non
/// disegnato». Il blocco vero resta fuori dal documento: se arriva tardi, non
/// cambia le misure di una pagina già impaginata. Torna quanti riquadri ha
/// messo.
export function markUndrawn(container: HTMLElement): number {
  const elements = undrawnElements(container);
  for (const element of elements) {
    const name = undrawnName(element);
    const box = document.createElement("div");
    box.className = "print-undrawn";
    box.setAttribute("role", "img");
    box.setAttribute("aria-label", t("print.undrawn.label", { name }));
    for (const attribute of ["data-md-from", "data-md-to"]) {
      const value = element.getAttribute(attribute);
      if (value !== null) box.setAttribute(attribute, value);
    }
    const label = document.createElement("span");
    label.className = "print-undrawn-name";
    label.textContent = name;
    const state = document.createElement("span");
    state.className = "print-undrawn-state";
    state.textContent = t("print.undrawn");
    box.append(label, state);
    element.replaceWith(box);
  }
  return elements.length;
}

/// Il riquadro di ciò che non è arrivato: alto e largo il giusto per leggerlo,
/// coi colori del documento. Chi mostra le pagine può vestirlo meglio.
const UNDRAWN_CSS = `
  .print-undrawn {
    display: flex;
    align-items: baseline;
    gap: 0.6em;
    margin: 0.66em 0;
    padding: 0.9em 1em;
    border: 1px dashed var(--doc-rule, rgb(135 135 135 / 45%));
    border-radius: 6px;
    color: var(--muted, #605c56);
    font-size: 0.9em;
    line-height: 1.4;
  }
  .print-undrawn-name { font-weight: 600; color: var(--doc-fg, #2a2826); overflow-wrap: anywhere; }`;

/// Una resa per la stampa montata in un contenitore: il titolo e il corpo,
/// idratati da `mount` se c'è. `settled` si risolve quando ciò che arriva
/// dopo è arrivato, o l'attesa è finita e il resto ha il suo riquadro
/// (`markUndrawn`), col numero dei riquadri.
export interface PrintSurface {
  readonly page: HTMLElement;
  readonly body: HTMLElement;
  readonly settled: Promise<number>;
  dispose(): void;
}

/// Monta la resa per la stampa perché la si misuri (l'impaginatore
/// dell'esportazione, `export/paginate/slices.ts`): la stessa pagina che
/// `printRendered` manda alla stampa, senza stamparla.
export function mountPrintSurface(
  container: HTMLElement,
  options: { title: string; rendered: RenderedDocument; mount?: PrintMount; limit?: number },
): PrintSurface {
  const { page, body } = printPage(options.title);
  const sheet = adoptSheet(UNDRAWN_CSS);
  container.append(page);
  let mounted: ReturnType<PrintMount> | null = null;
  try {
    if (options.mount) mounted = options.mount(body, options.rendered);
    else setSanitizedHtml(body, options.rendered.html);
  } catch (error) {
    page.remove();
    sheet.dispose();
    throw error;
  }
  let disposed = false;
  const settled = settlePrint(body, mounted?.ready ?? Promise.resolve(), options.limit).then(() => (disposed ? 0 : markUndrawn(body)));
  return {
    page,
    body,
    settled,
    dispose() {
      if (disposed) return;
      disposed = true;
      mounted?.dispose();
      page.remove();
      sheet.dispose();
    },
  };
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
    throw new Error(t("errors.print.unavailable"));
  }
  const life = openLifetime();
  const host = document.createElement("div");
  host.className = "print-host";
  host.setAttribute("aria-hidden", "true");
  // Un foglio costruito e non un `<style>`: la CSP non ammette stili in linea
  // (`ui/stylesheets.ts`). Se ne va col contenitore.
  const stylesheet = adoptSheet(PRINT_CSS);
  life.add(() => stylesheet.dispose());
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
  if (!text) throw new Error(t("errors.print.nothing_to_copy"));
  try {
    await writeClipboardText(text);
  } catch (error) {
    throw new Error(t("errors.print.copy_failed", { reason: errorText(error, "specie") }));
  }
}
