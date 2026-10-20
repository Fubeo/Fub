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

it("«Due pagine» affianca la dispari e la pari, e le frecce vanno di due", async () => {
  const life = new Lifetime();
  // Come pdf.js: una resa nuova interrompe quella in corso.
  const drawn: number[] = [];
  let generation = 0;
  const renderPage = async (index: number) => {
    const mine = ++generation;
    await Promise.resolve();
    if (mine === generation) drawn.push(index);
  };
  const engine = { ...fake(undefined), pageCount: 5, renderPage };
  const view = mountPdfView(descriptor, new Uint8Array([1]), { loader: async () => engine, initialPage: 2 }, life);
  await settle();
  const buttons = [...view.element.querySelectorAll("button")];
  const status = view.element.querySelector("[role=status]")!;
  buttons.find((b) => b.textContent === t("media.pdf.two_pages"))!.click();
  await settle();
  expect(status.textContent).toBe(t("media.pdf.pages", { first: 1, last: 2, count: 5 }));
  buttons.find((b) => b.textContent === "›")!.click();
  await settle();
  expect(status.textContent).toBe(t("media.pdf.pages", { first: 3, last: 4, count: 5 }));
  expect(drawn.slice(-2)).toEqual([2, 3]);
  buttons.find((b) => b.textContent === "›")!.click();
  await settle();
  // L'ultima pagina, dispari, resta sola.
  expect(status.textContent).toBe(t("media.pdf.page", { page: 5, count: 5 }));
  expect(view.element.querySelectorAll("canvas")[1]!.hidden).toBe(true);
  expect(drawn.slice(-1)).toEqual([4]);
  life.close();
});

it("«Colori scuri» inverte le pagine e torna indietro", async () => {
  const life = new Lifetime();
  const view = mountPdfView(descriptor, new Uint8Array([1]), { loader: async () => fake(undefined) }, life);
  await settle();
  const button = [...view.element.querySelectorAll("button")].find((b) => b.textContent === t("media.pdf.dark"))!;
  const page = view.element.querySelector("canvas")!;
  button.click();
  expect(button.getAttribute("aria-pressed")).toBe("true");
  expect(page.style.filter).toContain("invert");
  button.click();
  expect(page.style.filter).toBe("");
  life.close();
});

it("«Miniature» apre la colonna delle pagine, che segna quella davanti e ci porta", async () => {
  const life = new Lifetime();
  const view = mountPdfView(descriptor, new Uint8Array([1]), {
    loader: async () => ({ ...fake(undefined), renderThumbnail: async () => {} }),
  }, life);
  await settle();
  const button = [...view.element.querySelectorAll("button")].find((b) => b.textContent === t("media.pdf.thumbnails"))!;
  expect(button.hidden).toBe(false);
  const column = view.element.querySelector<HTMLElement>("nav.media-pdf-thumbs")!;
  expect(column.hidden).toBe(true);
  button.click();
  expect(column.hidden).toBe(false);
  const items = [...column.querySelectorAll("button")];
  expect(items.map((b) => b.getAttribute("aria-label"))).toEqual([1, 2, 3].map((page) => t("media.pdf.page_number", { page })));
  expect(items[0]!.getAttribute("aria-current")).toBe("page");
  items[2]!.click();
  await settle();
  expect(view.element.querySelector("[role=status]")!.textContent).toBe(t("media.pdf.page", { page: 3, count: 3 }));
  expect(items.map((b) => b.getAttribute("aria-current"))).toEqual([null, null, "page"]);
  life.close();

  // Un motore senza miniature non offre il bottone.
  const bare = new Lifetime();
  const plain = mountPdfView(descriptor, new Uint8Array([1]), { loader: async () => fake(undefined) }, bare);
  await settle();
  expect([...plain.element.querySelectorAll("button")].find((b) => b.textContent === t("media.pdf.thumbnails"))!.hidden).toBe(true);
  bare.close();
});
