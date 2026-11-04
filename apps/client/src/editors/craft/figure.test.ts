// @vitest-environment happy-dom
//
// La figura di un file Craft dentro una nota (N7) contro l'host finto: con
// l'anteprima e senza, un XMP coi suoi dati, il segnaposto che non è di un
// file Craft, il nome ostile, la stessa figura dieci volte, la nota chiusa
// prima della risposta, il componente spento, un JPEG. In nessun caso la
// figura chiede di fare l'anteprima: una nota non avvia mai l'app.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FakeCraft, FakeHost } from "../../host/fake";
import type { CraftPreviewImage } from "../../host/craft";

const box = vi.hoisted(() => ({ host: null as FakeHost | null }));

vi.mock("../../host/ipc", () => {
  const now = () => {
    if (!box.host) throw new Error("l'host finto non è stato montato");
    return box.host.module;
  };
  return {
    api: new Proxy(
      {},
      {
        get: (_t, name: string) => (...args: unknown[]) =>
          (now().api as unknown as Record<string, (...a: unknown[]) => unknown>)[name](...args),
      },
    ),
    onKernelEvent: (handler: (n: unknown) => void) => now().onKernelEvent(handler as never),
  };
});

const { createFakeHost } = await import("../../host/fake");

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

function png(width: number, height: number): CraftPreviewImage {
  const bytes = new Uint8Array(33);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return { media_type: "image/png", data: btoa(String.fromCharCode(...bytes)), width, height, orientation: 1 };
}

const LOGO = "Disegni/logo.vectorcraft";
const XMP = "Foto/IMG_0001.xmp";
const BYTES = { bytes: new Uint8Array([0x7b, 0x7d, 0xff]), mime: "application/octet-stream" };

/// Il segnaposto che il provider di `fub-format-craft` rende per `doc`.
function placeholderHtml(doc: string, app = "vectorcraft", kind = "craft", caption = doc.slice(doc.lastIndexOf("/") + 1)): string {
  return `<figure class="fub-craft" data-embed-kind="${kind}" data-embed-doc="${doc}" data-craft-app="${app}">`
    + `<figcaption>${caption}</figcaption></figure>`;
}

async function boot(craft: FakeCraft) {
  const host = createFakeHost({ resources: { [LOGO]: BYTES, [XMP]: BYTES }, craft });
  box.host = host;
  vi.resetModules();
  const store = await import("../../state/store");
  store.state.vaultRoot = "/vault";
  const kernel = await import("../../state/kernel");
  const { openLifetime } = await import("../../ui/lifetime");
  const previews = await import("../../state/craft-previews");
  const figure = await import("./figure");
  await kernel.startKernelRouter();
  previews.mountCraftPreviews(openLifetime());
  const container = document.createElement("div");
  container.className = "markdown-rendered";
  document.body.replaceChildren(container);
  return { host, figure, openLifetime, container };
}

/// Uno slot come lo scrive la resa per `![[page]]`.
function slot(container: HTMLElement, page = "logo.vectorcraft"): HTMLElement {
  const span = document.createElement("span");
  span.className = "embed";
  span.dataset.embedPage = page;
  span.textContent = page;
  container.append(span);
  return span;
}

/// Le domande a `craft.preview`: soltanto `doc` e `size`, mai `render`.
function previewAsks(host: FakeHost): Array<Record<string, unknown>> {
  const asks = host.atGate("invokeCommand")
    .map((call) => call.args as unknown[])
    .filter((args) => args[0] === "craft.preview")
    .map((args) => args[1] as Record<string, unknown>);
  for (const ask of asks) expect(Object.keys(ask).sort()).toEqual(["doc", "size"]);
  return asks;
}

const urls = { made: [] as string[], revoked: [] as string[], types: [] as string[] };

beforeEach(() => {
  box.host = null;
  urls.made = [];
  urls.revoked = [];
  urls.types = [];
  let next = 0;
  vi.spyOn(URL, "createObjectURL").mockImplementation((blob) => {
    urls.types.push((blob as Blob).type);
    const url = `blob:figura-${++next}`;
    urls.made.push(url);
    return url;
  });
  vi.spyOn(URL, "revokeObjectURL").mockImplementation((url) => {
    urls.revoked.push(url);
  });
});

describe("il segnaposto di un file Craft", () => {
  it("riconosce la figura del provider, anche di un XMP, con il nome della didascalia", async () => {
    const { figure } = await boot({});
    expect(figure.craftPlaceholder(placeholderHtml(LOGO))).toEqual({ doc: LOGO, app: "vectorcraft", name: "logo.vectorcraft" });
    expect(figure.craftPlaceholder(placeholderHtml(XMP, "xmp", "craft-xmp"))).toEqual({ doc: XMP, app: "xmp", name: "IMG_0001.xmp" });
    // Una didascalia vuota vale il nome del file.
    expect(figure.craftPlaceholder(placeholderHtml(LOGO, "vectorcraft", "craft", " "))?.name).toBe("logo.vectorcraft");
  });

  it("ogni altra resa non è una figura Craft", async () => {
    const { figure } = await boot({});
    expect(figure.craftPlaceholder("<h1>Nota</h1><p>testo</p>")).toBeNull();
    expect(figure.craftPlaceholder(`<figure class="fub-scene" data-embed-kind="scene" data-embed-doc="${LOGO}"></figure>`)).toBeNull();
    expect(figure.craftPlaceholder(placeholderHtml(LOGO, "wordcraft"))).toBeNull();
    // La specie e l'app vanno insieme.
    expect(figure.craftPlaceholder(placeholderHtml(LOGO, "xmp", "craft"))).toBeNull();
    expect(figure.craftPlaceholder(placeholderHtml(XMP, "vectorcraft", "craft-xmp"))).toBeNull();
    expect(figure.craftPlaceholder('<figure class="fub-craft" data-embed-kind="craft" data-craft-app="vectorcraft"></figure>')).toBeNull();
  });

  it("dà il documento che il segnaposto nomina: chi lo monta lo confronta col suo", async () => {
    const { figure } = await boot({});
    expect(figure.craftPlaceholder(placeholderHtml("Altro/marchio.vectorcraft"))?.doc).toBe("Altro/marchio.vectorcraft");
  });

  it("un nome ostile resta testo: niente markup del segnaposto entra nella nota", async () => {
    const { figure, container, openLifetime } = await boot({ docs: { [LOGO]: { image: png(8, 6) } } });
    const hostile = figure.craftPlaceholder(placeholderHtml(
      LOGO,
      "vectorcraft",
      "craft",
      '<img src="x" onerror="globalThis.__ostile = 1">Logo<script>globalThis.__ostile = 2</script> &lt;b&gt;',
    ));
    expect(hostile?.name).toBe("Logo <b>");
    await figure.showEmbeddedCraft(container, slot(container), hostile!, openLifetime());
    expect(container.querySelector("figcaption")!.textContent).toBe("Logo <b>");
    expect(container.querySelector("img")!.alt).toBe("Anteprima di Logo <b>");
    expect(container.querySelectorAll("img")).toHaveLength(1);
    expect(container.querySelector("script, b, [onerror]")).toBeNull();
    expect((globalThis as { __ostile?: number }).__ostile).toBeUndefined();
  });
});

describe("la figura nella nota", () => {
  it("con l'anteprima del file: l'immagine da un blob, col nome sotto, e un clic la apre", async () => {
    const { figure, host, container, openLifetime } = await boot({
      docs: { [LOGO]: { image: png(8, 6), render: { app: "VectorCraft" } } },
    });
    const life = openLifetime();
    const opened: Array<[string, unknown]> = [];
    const embed = slot(container);
    await figure.showEmbeddedCraft(container, embed, figure.craftPlaceholder(placeholderHtml(LOGO))!, life, {
      open: (doc, options) => { opened.push([doc, options]); },
    });
    const img = embed.querySelector<HTMLImageElement>("figure.craft-figure > img")!;
    expect(img.getAttribute("src")).toBe("blob:figura-1");
    expect(img.alt).toBe("Anteprima di logo.vectorcraft");
    expect([img.getAttribute("width"), img.getAttribute("height")]).toEqual(["8", "6"]);
    expect(embed.querySelector("figcaption")!.textContent).toBe("logo.vectorcraft");
    expect(embed.dataset.vaultMedia).toBe("loaded");
    expect(embed.classList.contains("embed-media")).toBe(true);
    embed.querySelector<HTMLElement>("figure")!.click();
    await settle();
    // Il clic è un gesto: la scheda che nasce lo porta. La figura no.
    expect(opened).toEqual([[LOGO, { gesture: true }]]);
    expect(previewAsks(host)).toEqual([{ doc: LOGO, size: "small" }]);
    expect(host.atGate("craftRender")).toHaveLength(0);
    life.close();
    expect(urls.revoked).toEqual(["blob:figura-1"]);
  });

  it("senza anteprima: il riquadro col nome e l'app, anche quando l'app saprebbe farla", async () => {
    const { figure, host, container, openLifetime } = await boot({
      docs: { [LOGO]: { info: { format_version: "4" }, render: { app: "VectorCraft", consent: "on" } } },
    });
    const embed = slot(container);
    await figure.showEmbeddedCraft(container, embed, figure.craftPlaceholder(placeholderHtml(LOGO))!, openLifetime());
    await settle();
    expect(embed.querySelector("img")).toBeNull();
    const shown = embed.querySelector<HTMLElement>(".image-missing.craft-figure-box")!;
    expect(shown.textContent).toBe("logo.vectorcraft · Disegno di VectorCraft · formato 4 · 3 B · Nessuna anteprima");
    expect(shown.getAttribute("role")).toBe("img");
    expect(urls.made).toEqual([]);
    expect(previewAsks(host)).toHaveLength(1);
    expect(host.atGate("invokeCommand").length).toBe(1);
    expect(host.atGate("craftRender")).toHaveLength(0);
  });

  it("l'alias del link è il nome della figura", async () => {
    const { figure, container, openLifetime } = await boot({ docs: { [LOGO]: { image: png(8, 6) } } });
    const embed = slot(container);
    embed.textContent = "Il logo";
    await figure.showEmbeddedCraft(container, embed, figure.craftPlaceholder(placeholderHtml(LOGO))!, openLifetime());
    expect(embed.querySelector("figcaption")!.textContent).toBe("Il logo");
  });

  it("un XMP incorporato è il riquadro coi suoi dati principali, senza immagine", async () => {
    const { figure, host, container, openLifetime } = await boot({
      docs: { [XMP]: { info: { xmp: { rating: 3, label: "Red", flag: "pick", keywords: ["New York"] } } } },
    });
    const embed = slot(container, "IMG_0001.xmp");
    await figure.showEmbeddedCraft(container, embed, figure.craftPlaceholder(placeholderHtml(XMP, "xmp", "craft-xmp"))!, openLifetime());
    expect(embed.querySelector("img")).toBeNull();
    expect(embed.querySelector(".craft-figure-box")!.textContent)
      .toBe("IMG_0001.xmp · Dati di una foto per LightCraft · 3 B · 3 stelle su 5 · Rossa · Scelta");
    previewAsks(host);
  });

  it("la stessa figura dieci volte fa una domanda sola", async () => {
    const { figure, host, container, openLifetime } = await boot({ docs: { [LOGO]: { image: png(8, 6) } } });
    const life = openLifetime();
    const placeholder = figure.craftPlaceholder(placeholderHtml(LOGO))!;
    const slots = Array.from({ length: 10 }, () => slot(container));
    await Promise.all(slots.map((embed) => figure.showEmbeddedCraft(container, embed, placeholder, life)));
    expect(container.querySelectorAll("figure.craft-figure img")).toHaveLength(10);
    expect(previewAsks(host)).toHaveLength(1);
  });

  it("la nota chiusa prima della risposta non mostra niente e non lascia blob", async () => {
    const { figure, host, container, openLifetime } = await boot({ docs: { [LOGO]: { image: png(8, 6) } } });
    const life = openLifetime();
    const embed = slot(container);
    const shown = figure.showEmbeddedCraft(container, embed, figure.craftPlaceholder(placeholderHtml(LOGO))!, life);
    life.close();
    await shown;
    expect(embed.querySelector("img")).toBeNull();
    expect(urls.made).toEqual([]);
    previewAsks(host);
  });

  it("col componente spento resta il riquadro col nome", async () => {
    const { figure, host, container, openLifetime } = await boot({ component: false, docs: { [LOGO]: { image: png(8, 6) } } });
    const embed = slot(container);
    await figure.showEmbeddedCraft(container, embed, figure.craftPlaceholder(placeholderHtml(LOGO))!, openLifetime());
    expect(embed.querySelector("img")).toBeNull();
    expect(embed.querySelector(".craft-figure-box")!.textContent).toBe("logo.vectorcraft · Disegno di VectorCraft · Nessuna anteprima");
    previewAsks(host);
  });

  it("un JPEG si mostra come un PNG, col suo tipo nel blob", async () => {
    const image: CraftPreviewImage = { ...png(8, 6), media_type: "image/jpeg", data: btoa("\xff\xd8\xff\xd9"), orientation: 6 };
    const { figure, container, openLifetime } = await boot({ docs: { [LOGO]: { image } } });
    const embed = slot(container);
    await figure.showEmbeddedCraft(container, embed, figure.craftPlaceholder(placeholderHtml(LOGO))!, openLifetime());
    const img = embed.querySelector<HTMLImageElement>("figure.craft-figure > img")!;
    expect(img.getAttribute("src")).toBe("blob:figura-1");
    expect([img.getAttribute("width"), img.getAttribute("height")]).toEqual(["8", "6"]);
    expect(urls.types).toEqual(["image/jpeg"]);
  });

  it("un file cambiato si richiede senza render e mostra l'anteprima nuova", async () => {
    const { figure, host, container, openLifetime } = await boot({ docs: { [LOGO]: { image: png(8, 6) } } });
    const embed = slot(container);
    await figure.showEmbeddedCraft(container, embed, figure.craftPlaceholder(placeholderHtml(LOGO))!, openLifetime());
    host.emit({ type: "document_changed", id: LOGO });
    for (let round = 0; round < 20 && previewAsks(host).length < 2; round++) await settle();
    await settle();
    expect(previewAsks(host)).toHaveLength(2);
    expect(embed.querySelector("img")!.getAttribute("src")).toBe("blob:figura-2");
    expect(urls.revoked).toEqual(["blob:figura-1"]);
  });
});
