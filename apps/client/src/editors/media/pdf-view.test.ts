// @vitest-environment happy-dom
// Il piano del lettore PDF si raggiunge con Tab: scorre e tiene solo canvas,
// e senza un posto nell'ordine del fuoco chi usa la tastiera non lo
// percorre (il banco trovava «arrivato su nessun elemento»). Ha il nome della
// pagina che mostra, e la casella di ricerca ha il suo.
//
// La barra è la barra in una fila del kit: i foglietti nell'ordine del
// mockup, le figure col loro nome, «…» col menu, un solo punto di Tab e le
// frecce.
import { afterEach, describe, expect, it, vi } from "vitest";
import { Lifetime } from "../../ui/lifetime";
import { t } from "../../i18n/strings";
import { closeContextMenu } from "../../ui/menu";
import { icon } from "../../ui/icons";
import { mountPdfView, type PdfEngine, type PdfOutlineItem } from "./pdf-view";

function fake(pageCount: number, extra: Partial<PdfEngine> = {}): PdfEngine {
  return {
    pageCount,
    search: async () => [],
    renderPage: async () => {},
    pageSize: async () => [600, 800] as const,
    renderArea: async () => true,
    destroy: () => {},
    ...extra,
  };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const descriptor = { id: "manuale.pdf", mime: "application/pdf" } as never;
const lives: Lifetime[] = [];

afterEach(() => {
  closeContextMenu();
  for (const life of lives.splice(0)) life.close();
  document.body.replaceChildren();
});

type Options = Parameters<typeof mountPdfView>[2];

async function mounted(pageCount: number, options: Partial<Options> = {}, extra: Partial<PdfEngine> = {}) {
  const life = new Lifetime();
  lives.push(life);
  const view = mountPdfView(descriptor, new Uint8Array([1]), { loader: async () => fake(pageCount, extra), ...options }, life);
  document.body.append(view.element);
  await settle();
  await settle();
  const page = view.element.querySelector<HTMLElement>(".media-pdf-page")!;
  const toolbar = view.element.querySelector<HTMLElement>(".media-pdf-toolbar")!;
  return { view, page, toolbar, life };
}

/// Il bottone col nome accessibile `label`.
function named(root: HTMLElement, label: string): HTMLButtonElement {
  const found = [...root.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.getAttribute("aria-label") === label);
  if (!found) throw new Error(`nessun bottone «${label}»`);
  return found;
}

function key(target: HTMLElement, name: string): void {
  target.dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true }));
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

describe("la barra del PDF", () => {
  it("è la barra del kit coi foglietti nell'ordine del mockup", async () => {
    const { toolbar } = await mounted(3, { onAnnotate: () => {}, onOpenExternal: () => {}, onCopyLink: () => {} }, {
      renderThumbnail: async () => {},
      outline: async (): Promise<PdfOutlineItem[]> => [{ title: "Premessa", page: 2, items: [] }],
    });
    await settle();
    expect(toolbar.classList.contains("kit-bar")).toBe(true);
    expect(toolbar.getAttribute("role")).toBe("toolbar");
    expect(toolbar.getAttribute("aria-label")).toBe(t("media.pdf.toolbar"));
    const parts = [...toolbar.children].map((child) => {
      if (child.classList.contains("media-pdf-group")) {
        expect(child.classList.contains("kit-bar-group")).toBe(true);
        expect(child.getAttribute("role")).toBe("group");
        return [...child.querySelectorAll("button:not([hidden])")].map((button) => button.getAttribute("aria-label") ?? button.textContent).join(" + ");
      }
      if (child.classList.contains("media-pdf-search")) return "search";
      if (child instanceof HTMLSelectElement) return "outline";
      return child.getAttribute("aria-label");
    });
    expect(parts).toEqual([
      `${t("media.pdf.previous")} + ${t("media.pdf.next")}`,
      t("media.pdf.thumbnails"),
      "outline",
      "search",
      `${t("media.pdf.fit_width")} + ${t("media.pdf.two_pages")} + ${t("media.pdf.dark")}`,
      t("media.pdf.annotate"),
      t("media.pdf.more"),
    ]);
    const outline = toolbar.querySelector<HTMLSelectElement>("select")!;
    expect(outline.hidden).toBe(false);
    expect(outline.classList.contains("kit-bar-field")).toBe(true);
  });

  it("i pulsanti sono figure del kit col nome di sempre; la ricerca ha la lente", async () => {
    const { toolbar } = await mounted(3, {}, { renderThumbnail: async () => {} });
    const figures: [string, string][] = [
      ["media.pdf.previous", "media-page-previous"],
      ["media.pdf.next", "media-page-next"],
      ["media.pdf.thumbnails", "media-thumbnails"],
      ["media.pdf.fit_width", "media-fit-width"],
      ["media.pdf.two_pages", "media-two-pages"],
      ["media.pdf.dark", "media-dark-pages"],
    ];
    for (const [label, figure] of figures) {
      const button = named(toolbar, t(label as never));
      expect(button.classList.contains("kit-bar-button")).toBe(true);
      expect(button.querySelector(`svg[data-icon="${figure}"]`), figure).not.toBeNull();
      expect(button.textContent).toBe("");
    }
    expect(named(toolbar, t("media.pdf.fit_width")).getAttribute("aria-pressed")).toBe("false");
    const search = toolbar.querySelector(".media-pdf-search")!;
    expect(search.querySelector('svg[data-icon="search"]')).not.toBeNull();
    expect(search.querySelector("input")!.classList.contains("kit-bar-field")).toBe(true);
  });

  it("le figure si tolgono quando si smonta l'ultima barra", async () => {
    const first = await mounted(2);
    const second = await mounted(2);
    expect(icon("media-page-next")).not.toBe("");
    first.life.close();
    expect(icon("media-page-next")).not.toBe("");
    second.life.close();
    expect(icon("media-page-next")).toBe("");
  });

  it("un solo punto di Tab, e le frecce passano da un controllo all'altro", async () => {
    const { toolbar, view } = await mounted(3, { onCopyLink: () => {} });
    const controls = [...toolbar.querySelectorAll<HTMLElement>("button, select, input")];
    const prev = named(toolbar, t("media.pdf.previous"));
    const next = named(toolbar, t("media.pdf.next"));
    // Alla prima pagina «precedente» è spenta: il Tab entra su «successiva».
    expect(prev.disabled).toBe(true);
    expect(controls.filter((control) => control.tabIndex === 0)).toEqual([next]);
    next.focus();
    key(next, "ArrowRight");
    // Le miniature sono nascoste (il motore non le fa) e il sommario non c'è:
    // la freccia porta alla ricerca.
    const search = toolbar.querySelector<HTMLInputElement>('input[type="search"]')!;
    expect(document.activeElement).toBe(search);
    key(search, "ArrowRight");
    expect(document.activeElement).toBe(named(toolbar, t("media.pdf.fit_width")));
    key(document.activeElement as HTMLElement, "End");
    expect(document.activeElement).toBe(named(toolbar, t("media.pdf.more")));
    key(document.activeElement as HTMLElement, "ArrowRight");
    expect(document.activeElement).toBe(next);
    expect(controls.filter((control) => control.tabIndex === 0)).toEqual([next]);
    // All'ultima pagina «successiva» si spegne e il fuoco resta nella barra.
    next.click();
    await settle();
    next.click();
    await settle();
    expect(view.page()).toBe(3);
    expect(next.disabled).toBe(true);
    expect(prev.disabled).toBe(false);
    expect(toolbar.contains(document.activeElement)).toBe(true);
    expect(controls.filter((control) => control.tabIndex === 0)).toHaveLength(1);
  });

  it("un PDF di una pagina: precedente e successiva spente", async () => {
    const { toolbar } = await mounted(1);
    expect(named(toolbar, t("media.pdf.previous")).disabled).toBe(true);
    expect(named(toolbar, t("media.pdf.next")).disabled).toBe(true);
  });

  it("due pagine affiancate: la successiva salta la coppia, e all'ultima coppia si spegne", async () => {
    const { toolbar, view } = await mounted(4);
    named(toolbar, t("media.pdf.two_pages")).click();
    await settle();
    expect(view.where()).toEqual({ first: 1, last: 2, count: 4 });
    named(toolbar, t("media.pdf.next")).click();
    await settle();
    expect(view.where()).toEqual({ first: 3, last: 4, count: 4 });
    expect(named(toolbar, t("media.pdf.next")).disabled).toBe(true);
  });

  it("«…» apre il menu con l'altra app e il link alla pagina", async () => {
    const opened = vi.fn();
    const copied: number[] = [];
    const { toolbar, view } = await mounted(3, { onOpenExternal: opened, onCopyLink: (n) => void copied.push(n) });
    await view.goToPage(2);
    const more = named(toolbar, t("media.pdf.more"));
    expect(more.classList.contains("kit-options-more")).toBe(true);
    expect(more.getAttribute("aria-haspopup")).toBe("menu");
    expect(more.getAttribute("aria-expanded")).toBe("false");
    more.click();
    expect(more.getAttribute("aria-expanded")).toBe("true");
    const menu = document.querySelector<HTMLElement>('[role="menu"]')!;
    const items = [...menu.querySelectorAll<HTMLElement>('[role="menuitem"]')];
    expect(items.map((item) => item.textContent?.trim())).toEqual([t("media.open_external"), t("media.pdf.copy_link")]);
    items[1]!.click();
    await settle();
    expect(copied).toEqual([2]);
    expect(more.getAttribute("aria-expanded")).toBe("false");
    more.click();
    document.querySelectorAll<HTMLElement>('[role="menu"] [role="menuitem"]')[0]!.click();
    await settle();
    expect(opened).toHaveBeenCalledTimes(1);
  });

  it("senza l'altra app «…» ha solo il link; senza nessuno dei due non c'è", async () => {
    const only = await mounted(2, { onCopyLink: () => {} });
    named(only.toolbar, t("media.pdf.more")).click();
    expect([...document.querySelectorAll('[role="menu"] [role="menuitem"]')].map((item) => item.textContent?.trim())).toEqual([
      t("media.pdf.copy_link"),
    ]);
    closeContextMenu();
    const none = await mounted(2);
    expect(none.toolbar.querySelector(".kit-options-more")).toBeNull();
    expect(none.toolbar.querySelector(".media-pdf-annotate")).toBeNull();
  });

  it("la pagina si dice alla superficie; la riga di stato resta per il lettore di schermo", async () => {
    const onPage = vi.fn();
    const { view } = await mounted(5, { onPage });
    expect(view.where()).toEqual({ first: 1, last: null, count: 5 });
    expect(onPage).toHaveBeenCalled();
    const status = view.element.querySelector<HTMLElement>('[role="status"]')!;
    expect(status.textContent).toBe(t("media.pdf.page", { page: 1, count: 5 }));
    expect(status.classList.contains("sr-only")).toBe(true);
    onPage.mockClear();
    await view.goToPage(4);
    expect(onPage).toHaveBeenCalledTimes(1);
    expect(view.where()).toEqual({ first: 4, last: null, count: 5 });
  });

  it("la ricerca senza risultati si vede nella riga di stato", async () => {
    const { view } = await mounted(3);
    const search = view.element.querySelector<HTMLInputElement>('input[type="search"]')!;
    search.value = "inesistente";
    search.dispatchEvent(new Event("change"));
    await settle();
    const status = view.element.querySelector<HTMLElement>('[role="status"]')!;
    expect(status.textContent).toBe(t("media.pdf.no_matches", { needle: "inesistente" }));
    expect(status.classList.contains("sr-only")).toBe(false);
  });

  it("un PDF che non si apre: la nota d'errore, nessuna pagina, frecce spente", async () => {
    const life = new Lifetime();
    lives.push(life);
    const onPage = vi.fn();
    const view = mountPdfView(descriptor, new Uint8Array([1]), { loader: async () => Promise.reject(new Error("rotto")), onPage }, life);
    document.body.append(view.element);
    await settle();
    await settle();
    expect(view.where()).toBeNull();
    expect(view.element.querySelector(".media-pdf-page > p")?.textContent).toContain("manuale.pdf");
    const status = view.element.querySelector<HTMLElement>('[role="status"]')!;
    expect(status.textContent).toContain("rotto");
    expect(status.classList.contains("sr-only")).toBe(false);
    const toolbar = view.element.querySelector<HTMLElement>(".media-pdf-toolbar")!;
    expect(named(toolbar, t("media.pdf.previous")).disabled).toBe(true);
    expect(named(toolbar, t("media.pdf.next")).disabled).toBe(true);
  });
});

describe("le annotazioni sopra le pagine", () => {
  /// I blob creati, per URL: il visore li disegna in un `<img>`.
  function blobs() {
    const made = new Map<string, Blob>();
    const revoked: string[] = [];
    let next = 0;
    vi.spyOn(URL, "createObjectURL").mockImplementation((blob) => {
      const url = `blob:annotazioni-${++next}`;
      made.set(url, blob as Blob);
      return url;
    });
    vi.spyOn(URL, "revokeObjectURL").mockImplementation((url) => void revoked.push(url));
    return { made, revoked };
  }

  afterEach(() => vi.restoreAllMocks());

  /// Le annotazioni finte: un foglio che dice la sua pagina.
  function layers(pages: readonly number[]) {
    const asked: [number, readonly [number, number] | null][] = [];
    return {
      asked,
      layer(page: number, size: readonly [number, number] | null) {
        asked.push([page, size]);
        return pages.includes(page) ? `<svg xmlns="http://www.w3.org/2000/svg" data-page="${page}"/>` : null;
      },
    };
  }

  const marks = (root: HTMLElement) => [...root.querySelectorAll<HTMLImageElement>(".media-pdf-sheet > img.media-pdf-annotations")];

  it("ogni pagina che si vede porta il suo strato, sopra il suo canvas e alla misura della sua pagina, anche con due pagine affiancate", async () => {
    const { made } = blobs();
    const sizes: Record<number, readonly [number, number]> = { 0: [600, 800], 1: [500, 700], 2: [600, 800] };
    const { view, toolbar, page } = await mounted(3, {}, { pageSize: async (index: number) => sizes[index]! });
    const fake = layers([1, 2]);
    view.setAnnotations(fake, null);
    await settle();
    let shown = marks(page);
    expect(shown).toHaveLength(1);
    expect(shown[0]!.parentElement!.querySelector("canvas")).not.toBeNull();
    expect(shown[0]!.getAttribute("src")).toMatch(/^blob:/);
    expect(shown[0]!.getAttribute("aria-hidden")).toBe("true");
    const first = made.get(shown[0]!.getAttribute("src")!)!;
    expect(first.type).toBe("image/svg+xml");
    expect(await first.text()).toContain(`data-page="1"`);
    expect(fake.asked[fake.asked.length - 1]).toEqual([1, [600, 800]]);
    named(toolbar, t("media.pdf.two_pages")).click();
    await settle();
    await settle();
    shown = marks(page);
    expect(shown).toHaveLength(2);
    const sheets = [...page.querySelectorAll<HTMLElement>(".media-pdf-sheet")];
    expect(sheets.map((sheet) => sheet.querySelector("img") !== null)).toEqual([true, true]);
    expect(await made.get(sheets[1]!.querySelector("img")!.getAttribute("src")!)!.text()).toContain(`data-page="2"`);
    expect(fake.asked).toContainEqual([2, [500, 700]]);
    // «Adatta alla larghezza»: lo strato resta, la misura è sempre la pagina.
    named(toolbar, t("media.pdf.fit_width")).click();
    await settle();
    await settle();
    expect(marks(page)).toHaveLength(2);
    expect(fake.asked[fake.asked.length - 1]).toEqual([2, [500, 700]]);
    // La coppia 3–4 di un PDF di 3 pagine: la 3 non è annotata, niente strato.
    named(toolbar, t("media.pdf.next")).click();
    await settle();
    await settle();
    expect(marks(page)).toHaveLength(0);
  });

  it("l'interruttore c'è solo con le annotazioni, acceso; le spegne e le riaccende", async () => {
    blobs();
    const { view, toolbar, page } = await mounted(2, { onAnnotate: () => {} });
    const button = named(toolbar, t("media.pdf.annotations"));
    expect(button.closest("[hidden]")).not.toBeNull();
    view.setAnnotations(layers([1]), null);
    await settle();
    expect(button.closest("[hidden]")).toBeNull();
    // Nel foglietto di «Annota», prima di lui.
    expect(button.nextElementSibling?.classList.contains("media-pdf-annotate")).toBe(true);
    expect(button.classList.contains("kit-bar-button")).toBe(true);
    expect(button.querySelector('svg[data-icon="media-show-annotations"]')).not.toBeNull();
    expect(button.getAttribute("aria-pressed")).toBe("true");
    expect(marks(page)).toHaveLength(1);
    button.click();
    await settle();
    expect(button.getAttribute("aria-pressed")).toBe("false");
    expect(marks(page)).toHaveLength(0);
    button.click();
    await settle();
    expect(button.getAttribute("aria-pressed")).toBe("true");
    expect(marks(page)).toHaveLength(1);
    // Le annotazioni che spariscono tolgono interruttore e strato.
    view.setAnnotations(null, null);
    await settle();
    expect(button.closest("[hidden]")).not.toBeNull();
    expect(marks(page)).toHaveLength(0);
  });

  it("l'interruttore entra nelle frecce della barra", async () => {
    blobs();
    const { view, toolbar } = await mounted(2, { onAnnotate: () => {} });
    view.setAnnotations(layers([1]), null);
    await settle();
    const dark = named(toolbar, t("media.pdf.dark"));
    dark.focus();
    key(dark, "ArrowRight");
    expect(document.activeElement).toBe(named(toolbar, t("media.pdf.annotations")));
    key(document.activeElement as HTMLElement, "ArrowRight");
    expect((document.activeElement as HTMLElement).classList.contains("media-pdf-annotate")).toBe(true);
  });

  it("senza «Annota» l'interruttore sta da solo; senza annotazioni il foglietto non c'è", async () => {
    blobs();
    const { view, toolbar } = await mounted(2);
    const button = named(toolbar, t("media.pdf.annotations"));
    expect(button.parentElement!.hidden).toBe(true);
    view.setAnnotations(layers([1]), null);
    expect(button.parentElement!.hidden).toBe(false);
    expect(button.hidden).toBe(false);
  });

  it("le pagine annotate oltre l'ultima del PDF non si chiedono", async () => {
    blobs();
    const { view, toolbar } = await mounted(2);
    const fake = layers([1, 2, 5]);
    view.setAnnotations(fake, null);
    await settle();
    named(toolbar, t("media.pdf.next")).click();
    await settle();
    await settle();
    expect(fake.asked.length).toBeGreaterThan(0);
    expect(fake.asked.every(([n]) => n <= 2)).toBe(true);
  });

  it("la riga delle annotazioni si vede, e la ricerca non la copre", async () => {
    blobs();
    const { view } = await mounted(2);
    const line = view.element.querySelector<HTMLElement>(".media-pdf-note")!;
    expect(line.hidden).toBe(true);
    view.setAnnotations(layers([1]), t("pdf.changed"));
    expect(line.hidden).toBe(false);
    expect(line.textContent).toBe(t("pdf.changed"));
    expect(line.getAttribute("role")).toBe("status");
    const search = view.element.querySelector<HTMLInputElement>('input[type="search"]')!;
    search.value = "x";
    search.dispatchEvent(new Event("change"));
    await settle();
    expect(line.textContent).toBe(t("pdf.changed"));
    view.setAnnotations(null, null);
    expect(line.hidden).toBe(true);
  });

  it("i colori scuri non toccano le annotazioni", async () => {
    blobs();
    const { view, toolbar, page } = await mounted(2);
    view.setAnnotations(layers([1]), null);
    await settle();
    named(toolbar, t("media.pdf.dark")).click();
    expect(page.querySelector("canvas")!.style.filter).not.toBe("");
    expect(marks(page)[0]!.style.filter).toBe("");
  });

  it("smontato, i blob si revocano e una lettura arrivata dopo non disegna", async () => {
    const { revoked } = blobs();
    const { view, page, life } = await mounted(2);
    view.setAnnotations(layers([1]), null);
    await settle();
    const url = marks(page)[0]!.getAttribute("src")!;
    life.close();
    expect(revoked).toContain(url);
    view.setAnnotations(layers([1]), null);
    await settle();
    expect(marks(page)).toHaveLength(0);
  });

  it("senza annotazioni il piano tiene solo i canvas", async () => {
    const created = vi.spyOn(URL, "createObjectURL");
    const { page } = await mounted(3);
    expect(page.querySelectorAll("img")).toHaveLength(0);
    expect(created).not.toHaveBeenCalled();
  });
});
