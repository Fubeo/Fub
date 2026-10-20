// @vitest-environment happy-dom
// Il sommario del PDF: pdf.js lo dà con destinazioni per nome o scritte, e il
// lettore lo mostra in fila, con le pagine; una voce che non porta a una
// pagina resta fuori, le sue figlie no.
import { expect, it } from "vitest";
import { Lifetime } from "../../ui/lifetime";
import { t } from "../../i18n/strings";
import { makePdfJsLoader, mountPdfView, outlineRows, PDFJS_VERSION, type PdfEngine, type PdfJsModule } from "./pdf-view";

const PAGE_REF = { num: 7 };

function module(): PdfJsModule {
  const document = {
    numPages: 3,
    getPage: async () => { throw new Error("non serve"); },
    destroy: async () => {},
    getOutline: async () => [
      { title: "Capitolo", dest: "uno", items: [{ title: "Sezione", dest: [PAGE_REF], items: [] }] },
      { title: "Rotto", dest: "nessuno", items: [{ title: "Figlia", dest: [0], items: [] }] },
    ],
    getDestination: async (id: string) => (id === "uno" ? [1] : null),
    getPageIndex: async (ref: unknown) => (ref === PAGE_REF ? 2 : -1),
  };
  return {
    version: PDFJS_VERSION,
    GlobalWorkerOptions: { workerSrc: "" },
    getDocument: () => ({ promise: Promise.resolve(document), destroy: async () => {} }),
  } as unknown as PdfJsModule;
}

it("pdf.js risolve le destinazioni per nome e scritte", async () => {
  const engine = await makePdfJsLoader(async () => module(), "/pdf.worker.mjs")(new Uint8Array([1]));
  const outline = await engine.outline!();
  expect(outlineRows(outline)).toEqual([
    { title: "Capitolo", page: 2, depth: 0 },
    { title: "Sezione", page: 3, depth: 1 },
    { title: "Figlia", page: 1, depth: 1 },
  ]);
});

function fake(outline: PdfEngine["outline"]): PdfEngine {
  return {
    pageCount: 3,
    outline,
    search: async () => [],
    renderPage: async () => {},
    pageSize: async () => [600, 800] as const,
    renderArea: async () => true,
    destroy: () => {},
  };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const descriptor = { id: "manuale.pdf", mime: "application/pdf" } as never;

it("il lettore mostra il sommario e ci salta; senza sommario l'elenco non c'è", async () => {
  const life = new Lifetime();
  const view = mountPdfView(descriptor, new Uint8Array([1]), {
    loader: async () => fake(async () => [{ title: "Indice", page: 3, items: [] }]),
  }, life);
  await settle();
  const select = view.element.querySelector<HTMLSelectElement>("select.media-pdf-outline")!;
  expect(select.hidden).toBe(false);
  expect([...select.options].map((o) => o.textContent)).toEqual([t("media.pdf.outline"), "Indice · 3"]);
  select.value = "3";
  select.dispatchEvent(new Event("change"));
  await settle();
  expect(view.element.querySelector("[role=status]")!.textContent).toBe(t("media.pdf.page", { page: 3, count: 3 }));
  life.close();

  const bare = new Lifetime();
  const plain = mountPdfView(descriptor, new Uint8Array([1]), { loader: async () => fake(undefined) }, bare);
  await settle();
  expect(plain.element.querySelector<HTMLSelectElement>("select.media-pdf-outline")!.hidden).toBe(true);
  bare.close();
});

it("«Adatta alla larghezza» si accende e si spegne", async () => {
  const life = new Lifetime();
  const view = mountPdfView(descriptor, new Uint8Array([1]), { loader: async () => fake(undefined) }, life);
  await settle();
  const button = [...view.element.querySelectorAll("button")].find((b) => b.textContent === t("media.pdf.fit_width"))!;
  button.click();
  await settle();
  expect(button.getAttribute("aria-pressed")).toBe("true");
  button.click();
  expect(button.getAttribute("aria-pressed")).toBe("false");
  life.close();
});
