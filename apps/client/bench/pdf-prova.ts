// La pagina della prova del motore del PDF (ADR 0247): monta la nota di
// `pdf-prova-nota.ts` con la resa della Lettura (`renderMarkdown` e
// `mountMarkdown`, la stessa della stampa), aspetta diagrammi, formule,
// immagini e caratteri come la stampa (`settlePrint`), e la misura con
// `measureNote`. L'esito sta in `window.__prova`, e `data-prova` dice quando.
//
// `?variant=` mette apposta una differenza fra la vista e l'elenco, perché il
// banco dimostri di vederla: `spostato` sposta tutto il testo di un pixel a
// destra, `senza-vettori` toglie diagramma e radice.

import "../src/theme/scrittoio/structure.css";
import { mount } from "../src/theme/loader";
import { SCRITTOIO_SERIES } from "../src/theme/scrittoio/series";
import { renderMarkdown } from "../src/editors/text/profiles/markdown/render";
import { mountMarkdown } from "../src/editors/text/profiles/markdown/mount";
import { settlePrint } from "../src/editors/media/print-view";
import { MARKDOWN_SYNTAX } from "../src/rules/syntax.generated";
import { declaredFences } from "../src/rules/syntax";
import { A4, measureNote, type ProbeResult } from "../src/export/probe";
import { NOTA, NOTA_DOC, NOTA_TITOLO } from "./pdf-prova-nota";

declare global {
  interface Window {
    __prova?: ProbeResult & { immagini: Record<string, string>; testoVista: string; inizio: { x: number; y: number } };
  }
}

const variant = new URLSearchParams(location.search).get("variant");
// Gli strati come nell'app (`kit.ts`): caratteri, pelle e foglio chiaro.
mount(SCRITTOIO_SERIES.fonts, "caratteri");
mount(SCRITTOIO_SERIES.skin, "pelle");
mount(SCRITTOIO_SERIES.sheet("light", "normal"), "foglio");
document.documentElement.dataset.theme = "light";

/// I `blob:` che la pagina crea, col loro contenuto: la CSP non lascia
/// rileggerli con `fetch`, e il banco fa la parte di chi li ha creati (il
/// diagramma, il finto host per la foto del vault).
const blobs = new Map<string, Blob>();
const createObjectURL = URL.createObjectURL.bind(URL);
URL.createObjectURL = (object: Blob | MediaSource) => {
  const url = createObjectURL(object);
  if (object instanceof Blob) blobs.set(url, object);
  return url;
};

/// I byte di un'immagine resa, in base64: quelli del suo `blob:`, se no
/// ridisegnata in PNG alla sua misura naturale.
async function base64(img: HTMLImageElement): Promise<string> {
  let bytes: Uint8Array;
  const blob = blobs.get(img.currentSrc);
  if (blob) bytes = new Uint8Array(await blob.arrayBuffer());
  else {
    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    canvas.getContext("2d")!.drawImage(img, 0, 0);
    const png = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/png"));
    if (!png) throw new Error(`l'immagine ${img.currentSrc} non si legge`);
    bytes = new Uint8Array(await png.arrayBuffer());
  }
  let out = "";
  for (let i = 0; i < bytes.length; i += 0x8000) out += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(out);
}

async function run(): Promise<void> {
  const nota = document.getElementById("nota")!;
  const declared = new Set(declaredFences(MARKDOWN_SYNTAX).map((info) => info.toLowerCase()));
  // La pagina vive quanto il banco: la resa non si smonta.
  mountMarkdown(nota, renderMarkdown(NOTA, MARKDOWN_SYNTAX).html, { documentId: NOTA_DOC, declaredFences: declared, diagramAppearance: "light" });
  await settlePrint(nota, Promise.resolve(), 20_000);
  // Due fotogrammi: i diagrammi si misurano dopo essersi disegnati.
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  // Il sorgente dei diagrammi, letto prima: la misura non aspetta.
  const vectors = new Map<string, string>();
  for (const [url, blob] of blobs) if (blob.type === "image/svg+xml") vectors.set(url, await blob.text());
  const result = measureNote(nota, A4, NOTA_TITOLO, { vectorOf: (img) => vectors.get(img.currentSrc) ?? null });
  if (variant === "spostato") {
    for (const page of result.elenco.pagine) {
      page.pezzi = page.pezzi.map((p) => (p.tipo === "testo" ? { ...p, x: p.x + 1 } : p));
    }
  } else if (variant === "senza-vettori") {
    for (const page of result.elenco.pagine) page.pezzi = page.pezzi.filter((p) => p.tipo !== "vettore");
  }
  const immagini: Record<string, string> = {};
  for (const img of nota.querySelectorAll("img")) {
    const file = img.dataset.vaultId ?? img.currentSrc;
    if (img.currentSrc && !vectors.has(img.currentSrc) && !(file in immagini))immagini[file] = await base64(img);
  }
  // Il testo della nota come si legge: senza la copia MathML delle formule,
  // che KaTeX tiene per i lettori di schermo e non si vede.
  const hidden = [...nota.querySelectorAll<HTMLElement>(".katex-mathml")];
  for (const node of hidden) node.hidden = true;
  const testoVista = nota.innerText.replace(/\s+/gu, "");
  for (const node of hidden) node.hidden = false;
  const box = nota.getBoundingClientRect();
  window.__prova = {
    ...result,
    immagini,
    testoVista,
    inizio: { x: box.left + window.scrollX, y: box.top + window.scrollY },
  };
  document.documentElement.dataset.prova = "ready";
}

run().catch((error: unknown) => {
  document.documentElement.dataset.error = String(error instanceof Error ? error.stack : error);
  document.documentElement.dataset.prova = "error";
});
