// @vitest-environment happy-dom
// Il piano del lettore PDF si raggiunge con Tab: scorre e tiene solo canvas,
// e senza un posto nell'ordine del fuoco chi usa la tastiera non lo
// percorre (il banco trovava «arrivato su nessun elemento»). Ha il nome della
// pagina che mostra, e la casella di ricerca ha il suo.
import { afterEach, expect, it } from "vitest";
import { Lifetime } from "../../ui/lifetime";
import { t } from "../../i18n/strings";
import { mountPdfView, type PdfEngine } from "./pdf-view";

function fake(pageCount: number): PdfEngine {
  return {
    pageCount,
    search: async () => [],
    renderPage: async () => {},
    pageSize: async () => [600, 800] as const,
    renderArea: async () => true,
    destroy: () => {},
  };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const descriptor = { id: "manuale.pdf", mime: "application/pdf" } as never;
const lives: Lifetime[] = [];

afterEach(() => {
  for (const life of lives.splice(0)) life.close();
});

async function mounted(pageCount: number) {
  const life = new Lifetime();
  lives.push(life);
  const view = mountPdfView(descriptor, new Uint8Array([1]), { loader: async () => fake(pageCount) }, life);
  document.body.append(view.element);
  await settle();
  await settle();
  const page = view.element.querySelector<HTMLElement>(".media-pdf-page")!;
  return { view, page };
}

it("la pagina si raggiunge con Tab e dice quale pagina è, anche quando cambia", async () => {
  const { view, page } = await mounted(3);
  expect(page.tabIndex).toBe(0);
  expect(page.getAttribute("role")).toBe("region");
  expect(page.getAttribute("aria-label")).toBe(t("media.pdf.page", { page: 1, count: 3 }));
  await view.goToPage(3);
  expect(page.getAttribute("aria-label")).toBe(t("media.pdf.page", { page: 3, count: 3 }));
  page.focus();
  expect(document.activeElement).toBe(page);
});

it("un PDF di una pagina: la pagina 1 di 1", async () => {
  const { page } = await mounted(1);
  expect(page.tabIndex).toBe(0);
  expect(page.getAttribute("aria-label")).toBe(t("media.pdf.page", { page: 1, count: 1 }));
});

it("la casella di ricerca ha un nome suo, non solo il segnaposto", async () => {
  const { view } = await mounted(3);
  const search = view.element.querySelector<HTMLInputElement>('input[type="search"]')!;
  expect(search.getAttribute("aria-label")).toBe(t("media.pdf.search_label"));
  expect(search.getAttribute("aria-label")).not.toBe("media.pdf.search_label");
});
