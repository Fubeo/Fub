// Stampa ed export fedele dal reso esistente (P07/F30, lato shell).
// The caller must obtain a print-target render from the renderer; a screen
// preview is not a print projection. No browser PDF viewer or screenshot.
import type { RenderedDocument } from "../../host/contract";
import { setSanitizedHtml } from "../../ui/sanitize";
import { openLifetime } from "../../ui/lifetime";

export interface PrintOptions {
  title: string;
  rendered: RenderedDocument;
  onAfterPrint?: () => void;
}
/** Injection port: composition obtains RenderTarget::Print from the host. */
export type PrintRenderer = (doc: string, target: "print") => Promise<RenderedDocument>;

export async function printDocument(
  doc: string,
  title: string,
  render: PrintRenderer,
): Promise<() => void> {
  const rendered = await render(doc, "print");
  return printRendered({ title, rendered });
}

/** Costruisce il documento stampabile: titolo, reso sanitizzato, contatore. */
export function buildPrintDocument(options: PrintOptions): HTMLElement {
  const page = document.createElement("article");
  page.className = "print-page";
  const heading = document.createElement("h1");
  heading.textContent = options.title;
  const body = document.createElement("div");
  body.className = "print-body";
  setSanitizedHtml(body, options.rendered.html);
  page.append(heading, body);
  return page;
}

/**
 * Stampa il reso: lo monta in un contenitore nascosto, chiama `window.print`,
 * rimuove tutto su `afterprint`. L'ascolto vive in una `Lifetime` dedicata
 * (mai `window.addEventListener` nudo: la guardia check-listeners pretende un
 * proprietario). Il teardown e' garantito anche se la stampa viene annullata:
 * l'evento `afterprint` scatta comunque.
 */
export function printRendered(options: PrintOptions): () => void {
  if (typeof window.print !== "function") {
    throw new Error("Printing is unavailable in this environment");
  }
  const life = openLifetime();
  const host = document.createElement("div");
  host.className = "print-host";
  host.setAttribute("aria-hidden", "true");
  const stylesheet = document.createElement("style");
  stylesheet.textContent = `
    @media screen { .print-host { display: none !important; } }
    @media print {
      body > :not(.print-host) { display: none !important; }
      .print-host { display: block !important; position: static !important; }
      .print-page { break-inside: auto; }
      .print-body pre, .print-body figure, .print-body table { break-inside: avoid; }
      .print-body hr { break-after: page; visibility: hidden; }
    }`;
  host.append(stylesheet);
  host.append(buildPrintDocument(options));
  document.body.append(host);
  let done = false;
  function teardown(): void {
    if (done) return;
    done = true;
    life.close();
    host.remove();
  }
  life.listen(window, "afterprint", teardown);
  life.add(() => {
    if (!done) {
      done = true;
      host.remove();
      options.onAfterPrint?.();
    }
  });
  try {
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
    await navigator.clipboard.writeText(text);
  } catch (error) {
    throw new Error(
      `cannot copy ${text.length} characters: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
