// Le annotazioni di un PDF sopra le pagine del visore, in sola lettura
// (`docs/product/pdf-annotations.md`, «Il visore dei PDF»).
//
// Si carica con un `import()` e soltanto quando accanto al PDF c'è il suo
// `.fubann`: un PDF senza annotazioni non scarica il lettore della scena.
//
// Legge il file con il lettore delle scene (`spatial/scene/read.ts`) e le
// grammatiche delle annotazioni (`spatial/scene/annotations.ts`), senza
// cambiarle: una pagina annotata è un `g` figlio della radice con un
// `fub:page` valido. Di ogni pagina fa un documento SVG a sé, che il visore
// disegna come un `<img>` da blob, come gli strati immagine del painter
// (`spatial/painter/paint.ts`): lì script e risorse esterne non partono.
//
// Le coordinate sono quelle della superficie delle annotazioni
// (`spatial/pdf/surface.ts`): punti della pagina come si mostra, origine in
// alto a sinistra, scala 1. Il foglio è largo e alto quanto la pagina del
// PDF; se il PDF non dice la sua misura vale quella scritta nel gruppo, poi
// quella del primo gruppo che ne ha una, poi A4. Ciò che esce dalla pagina
// non si vede, come nella superficie.

import { digest as digestOf, pageSize, positive } from "../spatial/scene/annotations";
import { A4, pdfOf, verdict, type PdfFacts, type RootFacts } from "../spatial/pdf/pages";
import { openSource, ReadError } from "../spatial/scene/read";
import { href } from "../spatial/scene/values";
import { isSvg, NS_FUB, NS_NONE, valueOf, type ElementNode } from "../spatial/scene/xml";
import type { PdfAnnotationLayers } from "./pdf-view";

/// Ciò che il visore fa di un `.fubann`.
export type PdfAnnotationsRead =
  /// Si disegna: i fogli delle pagine e ciò che la radice dice del PDF.
  | { readonly kind: "drawn"; readonly layers: PdfAnnotationLayers; readonly root: RootFacts }
  /// Non è stato fatto con Fub (senza `fub:version`).
  | { readonly kind: "foreign" }
  /// Non si legge: malformato, non una scena, di una versione futura o troppo
  /// grande per avere le pagine.
  | { readonly kind: "unreadable" }
  /// Annota un altro PDF (`fub:annotates`): qui non c'entra.
  | { readonly kind: "elsewhere" };

/// Gli attributi della radice che dicono dove e quanto grande si disegna: il
/// foglio li riscrive con la misura della pagina. Gli stessi del painter.
const ROOT_VIEW: ReadonlySet<string> = new Set(["x", "y", "width", "height", "viewBox", "preserveAspectRatio", "transform", "style"]);

/// I figli della radice che non disegnano da soli e a cui le pagine possono
/// rimandare (una sfumatura, un marcatore, un simbolo per `use`).
const RESOURCES: ReadonlySet<string> = new Set([
  "defs",
  "style",
  "symbol",
  "linearGradient",
  "radialGradient",
  "pattern",
  "marker",
  "clipPath",
  "mask",
  "filter",
]);

function escapeAttribute(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
}

/// Un numero per `viewBox`, senza notazione esponenziale.
function coordinate(n: number): string {
  return String(Math.round(n * 1000) / 1000);
}

/// Legge `source`, il testo intero di `fubannId`, per il visore di `pdfId`.
export function readPdfAnnotations(source: string, fubannId: string, pdfId: string): PdfAnnotationsRead {
  let opened: ReturnType<typeof openSource>;
  try {
    opened = openSource(source);
  } catch (error) {
    if (error instanceof ReadError) return { kind: "unreadable" };
    throw error;
  }
  const { doc } = opened;
  if (opened.status === "foreign") return { kind: "foreign" };
  if (opened.readOnly.includes("invalid-version") || opened.readOnly.includes("future-version") || !doc.complete) {
    return { kind: "unreadable" };
  }
  const text = doc.source.text;
  const root = doc.element(doc.root)!;

  const written = valueOf(root, NS_FUB, "annotates");
  const target = written === undefined ? null : href(written);
  const facts: RootFacts = {
    annotates: target === null ? { kind: "absent" } : target.kind === "vault" ? { kind: "vault", url: target.url } : { kind: "other" },
    digest: digestOf(valueOf(root, NS_FUB, "digest")),
    pages: positive(valueOf(root, NS_FUB, "pages")),
  };
  if (pdfOf(fubannId, facts.annotates) !== pdfId) return { kind: "elsewhere" };

  // La radice del foglio: il suo nome e i suoi attributi, namespace compresi,
  // tranne quelli della vista.
  let head = `<${root.name}`;
  for (const attr of root.attrs) {
    if (attr.ns === NS_NONE && ROOT_VIEW.has(attr.local)) continue;
    head += ` ${attr.name}="${escapeAttribute(attr.value)}"`;
  }
  // Il DOCTYPE resta: le entità che dichiara si usano nelle pagine.
  const doctype = doc.doctype === null ? "" : text.slice(doc.nodes[doc.doctype]!.start, doc.nodes[doc.doctype]!.end);

  let resources = "";
  const pages = new Map<number, { raw: string; size: readonly [number, number] | null }[]>();
  for (const child of root.children) {
    const element = doc.element(child);
    if (element === null || element.ns !== root.ns) continue;
    const raw = text.slice(element.start, element.end);
    if (isSvg(element, "g")) {
      const number = positive(valueOf(element, NS_FUB, "page"));
      if (number !== null) {
        const list = pages.get(number) ?? [];
        list.push({ raw, size: pageSize(valueOf(element, NS_FUB, "page-size")) });
        pages.set(number, list);
        continue;
      }
    }
    if (isResource(element)) resources += raw;
  }
  const firstSize = [...pages.values()].flat().find((group) => group.size !== null)?.size ?? null;

  const cache = new Map<string, string>();
  const layers: PdfAnnotationLayers = {
    layer(page, size) {
      const groups = pages.get(page);
      if (groups === undefined) return null;
      const [width, height] = size ?? groups.find((group) => group.size !== null)?.size ?? firstSize ?? A4;
      const key = `${page} ${width} ${height}`;
      const cached = cache.get(key);
      if (cached !== undefined) return cached;
      const w = coordinate(width);
      const h = coordinate(height);
      const document = `${doctype}${head} width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">${resources}${groups.map((group) => group.raw).join("")}</${root.name}>`;
      cache.set(key, document);
      return document;
    },
  };
  return { kind: "drawn", layers, root: facts };
}

function isResource(element: ElementNode): boolean {
  return RESOURCES.has(element.local);
}

/// Vero se le annotazioni sono di un'altra versione del PDF: l'impronta non
/// torna, o senza impronta il numero di pagine (`verdict` della superficie).
export function annotationsChanged(root: RootFacts, pdf: PdfFacts): boolean {
  return verdict(root, pdf).state === "changed";
}

/// Vero se per dire `annotationsChanged` servono l'impronta e le pagine del
/// PDF: senza nessuna delle due le annotazioni non dicono di quale versione
/// sono.
export function needsPdfFacts(root: RootFacts): boolean {
  return root.digest !== null || root.pages !== null;
}
