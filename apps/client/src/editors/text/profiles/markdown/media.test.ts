// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LinkTarget } from "../../../../host/contract";
import type { VaultFontPort } from "../../../spatial/fonts/vault";
import { openLifetime } from "../../../../ui/lifetime";
import {
  drawingTitle,
  embedOwnText,
  embedSize,
  hydrateVaultMedia,
  scenePlaceholder,
  showEmbeddedDrawing,
  showRemoteImages,
  vaultImageSource,
  type MediaPort,
} from "./media";
import { setSanitizedHtml } from "../../../../ui/sanitize";
import type { EmbedContent } from "../../../../host/contract";
import type { CraftPreview } from "../../../../host/craft";
import type { MarkdownResources } from "../../../../ui/markdown-resources";
import { mountMarkdown } from "./mount";

// Le anteprime dei file Craft: lo store finto risponde e conta le domande;
// la figura vera passa da una spia, per sapere che la nota l'ha usata.
const craft = vi.hoisted(() => ({
  asks: [] as Array<{ doc: string; size: string; options: unknown }>,
  preview: null as CraftPreview | null,
  figures: [] as string[],
  render: vi.fn(),
}));
vi.mock("../../../../state/craft-previews", () => ({
  previewOf: async (doc: string, size: string, options: unknown) => {
    craft.asks.push({ doc, size, options });
    if (!craft.preview) throw new Error("componente spento");
    return { preview: { ...craft.preview, doc }, renderError: null };
  },
  watchCraftPreviews: () => {},
  renderPreview: craft.render,
}));
vi.mock("../../../craft/figure", async (original) => {
  const real = await original<typeof import("../../../craft/figure")>();
  return {
    ...real,
    showEmbeddedCraft: (...args: Parameters<typeof real.showEmbeddedCraft>) => {
      craft.figures.push(args[2].doc);
      return real.showEmbeddedCraft(...args);
    },
  };
});

function port(files: Record<string, string>, delay?: Promise<void>, names: Record<string, string> = {}) {
  const opened: string[] = [];
  const closed: string[] = [];
  const asked: Array<[LinkTarget, string]> = [];
  const named: string[] = [];
  const media: MediaPort = {
    resolve: async (target, from) => {
      asked.push([target, from]);
      const key = target.kind === "wiki" ? target.value.page : target.kind === "path" ? target.value : "";
      return files[key] ?? null;
    },
    open: async (id) => {
      await delay;
      opened.push(id);
      return { handle: `h-${id}` };
    },
    close: (handle) => closed.push(handle),
    url: (handle) => `fub-asset://localhost/${handle}`,
    drawingName: async (id) => {
      named.push(id);
      return names[id] ?? null;
    },
  };
  return { media, opened, closed, asked, named };
}

const same = <T,>(value: Promise<T>) => value;

/// Il foglio di un disegno con un testo `serif` quando i file dei caratteri
/// dell'app non si leggono: le sole famiglie, nessuna del sistema.
const SERIF_SHEET = '<style>:root{font-synthesis:none}:where(:root:not([font-family])){font-family:Literata, Inter, "JetBrains Mono"}:where([font-family="serif"]){font-family:Literata, Inter, "JetBrains Mono"}</style>';
/// `svg` col foglio `sheet` dopo l'apertura della radice.
const sheeted = (svg: string, sheet = SERIF_SHEET): string => svg.replace(/^<svg[^>]*>/, (open) => `${open}${sheet}`);

// I file dei caratteri dell'app non ci sono: happy-dom non ha il server
// dell'app.
beforeEach(() => vi.stubGlobal("fetch", async () => new Response(null, { status: 404 })));
afterEach(() => vi.unstubAllGlobals());

function html(markup: string): HTMLElement {
  const root = document.createElement("div");
  root.innerHTML = markup;
  return root;
}

describe("i media del vault dentro una nota", () => {
  it("un disegno si mostra come in Lettura, con le immagini del vault dentro, e il blob vive quanto la resa", async () => {
    const PNG_URI = "data:image/png;base64,iVBORw==";
    const DRAWING = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><image href="foto.png" width="5" height="5"/><text font-family="serif">Casa</text></svg>';
    const blobs = new Map<string, Blob>();
    const revoked: string[] = [];
    vi.spyOn(URL, "createObjectURL").mockImplementation((blob) => {
      const url = `blob:disegno-${blobs.size + 1}`;
      blobs.set(url, blob as Blob);
      return url;
    });
    vi.spyOn(URL, "revokeObjectURL").mockImplementation((url) => void revoked.push(url));
    try {
      const root = html('<span class="embed" data-embed-page="casa.svg">casa.svg</span><img data-vault-src="grande.svg" alt="g">');
      const { media, asked } = port({ "casa.svg": "Disegni/casa.svg", "foto.png": "Disegni/foto.png", "grande.svg": "Disegni/grande.svg" });
      const limits: number[] = [];
      media.read = async (id, limit) => {
        limits.push(limit);
        if (id === "Disegni/grande.svg") return null;
        return id.endsWith(".png")
          ? new Blob([Uint8Array.from([0x89, 0x50, 0x4e, 0x47])], { type: "image/png" })
          : new Blob([DRAWING], { type: "image/svg+xml" });
      };
      const life = openLifetime();
      await hydrateVaultMedia(root, "Note/qui.md", same, life, media);
      const embedded = root.querySelector<HTMLImageElement>(".embed img")!;
      expect(embedded.getAttribute("src")).toBe("blob:disegno-1");
      const shown = await blobs.get("blob:disegno-1")!.text();
      expect(shown).toBe(sheeted(DRAWING.replace('href="foto.png"', `href="${PNG_URI}"`)));
      // L'immagine si risolve dal disegno, non dalla nota.
      expect(asked.some(([target, from]) => target.kind === "path" && target.value === "foto.png" && from === "Disegni/casa.svg")).toBe(true);
      expect(limits).toContain(16 * 1024 * 1024);
      // Un disegno che non si legge si mostra dal file.
      expect(root.querySelector<HTMLImageElement>("img[alt=g]")!.getAttribute("src")).toBe("fub-asset://localhost/h-Disegni/grande.svg");
      life.close();
      expect(revoked).toEqual(["blob:disegno-1"]);
    } finally {
      vi.restoreAllMocks();
    }
  });

  it("un disegno con un heading mostra la sua tavola, o tutto per il titolo, e un altro nome non si risolve", async () => {
    const HEAD = '<svg xmlns="http://www.w3.org/2000/svg" xmlns:fub="https://fubeo.github.io/ns/scene/1" fub:version="1"';
    const BODY = '<title>Storia</title>'
      + '<view id="b00000001" fub:role="board" viewBox="0 0 600 400"><title>Copertina</title></view>'
      + '<view id="b00000002" fub:role="board" viewBox="700 0 600 400"><title>Copertina</title></view>'
      + '<view id="b00000003" fub:role="board" viewBox="0 500 300 200"><title>Storia</title></view>'
      + '<text font-family="serif">Casa</text></svg>';
    const DRAWING = `${HEAD} viewBox="0 0 1300 900" width="1300" height="900">${BODY}`;
    const blobs = new Map<string, Blob>();
    vi.spyOn(URL, "createObjectURL").mockImplementation((blob) => {
      const url = `blob:disegno-${blobs.size + 1}`;
      blobs.set(url, blob as Blob);
      return url;
    });
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    try {
      const root = html(
        '<span class="embed" data-embed-page="storia.svg" data-embed-heading="Copertina">storia.svg#Copertina</span>'
          + '<span class="embed" data-embed-page="storia.svg" data-embed-heading="Storia">storia.svg#Storia</span>'
          + '<span class="embed" data-embed-page="storia.svg">storia.svg</span>'
          + '<span class="embed" data-embed-page="storia.svg" data-embed-heading="Retro">storia.svg#Retro</span>'
          + '<span class="embed" data-embed-page="storia.svg" data-embed-heading="copertina">storia.svg#copertina</span>'
          + '<span class="embed" data-embed-page="grande.svg" data-embed-heading="Retro">grande.svg#Retro</span>',
      );
      const { media } = port({ "storia.svg": "Disegni/storia.svg", "grande.svg": "Disegni/grande.svg" });
      media.read = async (id) => (id === "Disegni/grande.svg" ? null : new Blob([DRAWING], { type: "image/svg+xml" }));
      await hydrateVaultMedia(root, "Note/qui.md", same, openLifetime(), media);
      const [cover, titled, whole, unknown, cased, large] = Array.from(root.querySelectorAll<HTMLElement>(".embed"));
      const shown = (slot: HTMLElement) => blobs.get(slot.querySelector("img")!.getAttribute("src")!)!.text();

      // La tavola: la prima che si chiama così, col suo rettangolo.
      expect(await shown(cover!)).toBe(sheeted(`${HEAD} viewBox="0 0 600 400" width="600" height="400">${BODY}`));
      expect(cover!.querySelector("img")!.alt).toBe("storia.svg#Copertina");
      expect(cover!.dataset.vaultMedia).toBe("loaded");
      // Il titolo è il disegno intero, prima della tavola che si chiama come
      // lui; senza heading, lo stesso.
      expect(await shown(titled!)).toBe(sheeted(DRAWING));
      expect(titled!.querySelector("img")!.alt).toBe("storia.svg#Storia");
      expect(await shown(whole!)).toBe(sheeted(DRAWING));
      expect(whole!.querySelector("img")!.alt).toBe("storia.svg");
      // Un nome che non è una sezione non si risolve, come un embed che non
      // si trova: i nomi si confrontano esatti.
      for (const slot of [unknown!, cased!]) {
        expect(slot.dataset.vaultMedia).toBe("unresolved");
        expect(slot.classList.contains("unresolved")).toBe(true);
        expect(slot.querySelector("img")).toBeNull();
      }
      // Un disegno che non si legge si mostra dal file, come oggi.
      expect(large!.querySelector("img")!.getAttribute("src")).toBe("fub-asset://localhost/h-Disegni/grande.svg");
      expect(blobs.size).toBe(3);
    } finally {
      vi.restoreAllMocks();
    }
  });

  it("un disegno porta dentro i caratteri del vault che i suoi testi nominano, e poi li lascia", async () => {
    const DRAWING = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><text font-family="Roboto, serif">Casa</text><text font-family="Lobster, cursive">Tetto</text></svg>';
    const FONT = new TextEncoder().encode("font:Roboto");
    // Il browser registra le facce: happy-dom non sa farlo.
    const fonts = new Set<object>();
    vi.stubGlobal("FontFace", class {
      constructor(readonly family: string) {}
      async load(): Promise<this> {
        return this;
      }
    });
    Object.defineProperty(document, "fonts", { configurable: true, value: { add: (face: object) => fonts.add(face), delete: (face: object) => fonts.delete(face) } });
    const vault: VaultFontPort = {
      files: async () => [{ id: "Caratteri/Roboto.ttf", size: FONT.length, mtime: 1 }],
      read: async () => FONT,
      ask: async () => ({ faces: [{ index: 0, family: "Roboto", names: ["Roboto"], generic: "sans-serif", weight: [400, 400], stretch: [100, 100], styles: [{ style: "normal", fixed: [] }], axes: [] }] }),
    };
    const blobs = new Map<string, Blob>();
    vi.spyOn(URL, "createObjectURL").mockImplementation((blob) => {
      const url = `blob:disegno-${blobs.size + 1}`;
      blobs.set(url, blob as Blob);
      return url;
    });
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    try {
      const root = html('<span class="embed" data-embed-page="casa.svg">casa.svg</span>');
      const { media } = port({ "casa.svg": "Disegni/casa.svg" });
      media.read = async () => new Blob([DRAWING], { type: "image/svg+xml" });
      media.fonts = vault;
      await hydrateVaultMedia(root, "Note/qui.md", same, openLifetime(), media);
      const shown = await blobs.get(root.querySelector(".embed img")!.getAttribute("src")!)!.text();
      // Roboto c'è, coi suoi byte; Lobster no, e il testo usa Literata.
      expect(shown).toBe(sheeted(DRAWING, '<style>:root{font-synthesis:none}:where(:root:not([font-family])){font-family:Literata, Inter, "JetBrains Mono"}'
        + ':where([font-family="Roboto, serif"]){font-family:Roboto, Literata, Inter, "JetBrains Mono"}'
        + ':where([font-family="Lobster, cursive"]){font-family:Literata, Inter, "JetBrains Mono"}'
        + `@font-face{font-family:"Roboto";src:url(data:application/octet-stream;base64,${btoa("font:Roboto")});font-weight:400;font-style:normal}</style>`));
      // L'immagine è fatta: la faccia non serve più a nessuno.
      await vi.waitFor(() => expect(fonts.size).toBe(0));
    } finally {
      vi.restoreAllMocks();
      Reflect.deleteProperty(document, "fonts");
    }
  });

  it("risolve col kernel, serve da fub-asset e chiude i lease allo smontaggio", async () => {
    const root = html(
      '<p><img data-vault-src="Risorse/a.png" alt="a"><img src="https://esterno/b.png"></p>'
        + '<span class="embed" data-embed-page="foto.png" data-embed-size="120">foto.png</span>',
    );
    const { media, opened, closed, asked } = port({ "Risorse/a.png": "Risorse/a.png", "foto.png": "img/foto.png" });
    const life = openLifetime();
    await hydrateVaultMedia(root, "Note/qui.md", same, life, media);

    const [local, remote] = root.querySelectorAll("img");
    expect(local!.getAttribute("src")).toBe("fub-asset://localhost/h-Risorse/a.png");
    expect(remote!.getAttribute("src")).toBe("https://esterno/b.png");
    const embedded = root.querySelector<HTMLImageElement>(".embed img");
    expect(embedded?.getAttribute("width")).toBe("120");
    expect(embedded?.getAttribute("src")).toBe("fub-asset://localhost/h-img/foto.png");
    expect(asked.map(([target, from]) => [target.kind, from])).toEqual([
      ["path", "Note/qui.md"],
      ["wiki", "Note/qui.md"],
    ]);
    expect(opened.sort()).toEqual(["Risorse/a.png", "img/foto.png"]);

    // Le immagini del vault portano il loro id: la lightbox ci prende un lease suo.
    expect(local!.dataset.vaultId).toBe("Risorse/a.png");
    expect(remote!.dataset.vaultId).toBeUndefined();
    expect(embedded?.dataset.vaultId).toBe("img/foto.png");

    life.close();
    expect(closed.sort()).toEqual(["h-Risorse/a.png", "h-img/foto.png"]);
  });

  it("la lightbox prende un lease suo, che chiude con la sua vita", async () => {
    const { media, opened, closed } = port({});
    const life = openLifetime();
    await expect(vaultImageSource("Risorse/a.png", media)(life)).resolves.toBe("fub-asset://localhost/h-Risorse/a.png");
    expect(opened).toEqual(["Risorse/a.png"]);
    expect(closed).toEqual([]);
    life.close();
    expect(closed).toEqual(["h-Risorse/a.png"]);
  });

  it("idrata anche gli embed per path della resa dell'host, e lascia gli URL e le note", async () => {
    const root = html(
      '<div class="embed" data-embed-path="../Risorse/porto.png">Il porto</div>'
        + '<div class="embed" data-embed-path="audio/voce.ogg">voce</div>'
        + '<div class="embed" data-embed-path="https://esterno/c.png">c</div>'
        + '<div class="embed" data-embed-path="Altra nota.md">nota</div>'
        + '<div class="embed" data-embed-path="Risorse/persa.png">persa</div>',
    );
    const { media, opened, asked } = port({ "../Risorse/porto.png": "Risorse/porto.png", "audio/voce.ogg": "audio/voce.ogg" });
    const life = openLifetime();
    await hydrateVaultMedia(root, "Note/qui.md", same, life, media);

    const picture = root.querySelector<HTMLImageElement>('[data-embed-path="../Risorse/porto.png"] img')!;
    expect(picture.getAttribute("src")).toBe("fub-asset://localhost/h-Risorse/porto.png");
    expect(picture.alt).toBe("Il porto");
    expect(picture.dataset.vaultId).toBe("Risorse/porto.png");
    expect(root.querySelector('[data-embed-path="audio/voce.ogg"] audio')).not.toBeNull();
    expect(root.querySelector('[data-embed-path="https://esterno/c.png"]')!.textContent).toBe("c");
    expect(root.querySelector('[data-embed-path="Altra nota.md"]')!.textContent).toBe("nota");
    expect(root.querySelector('[data-embed-path="Risorse/persa.png"]')!.classList.contains("unresolved")).toBe(true);
    expect(asked.map(([target, from]) => [target.kind, target.kind === "path" ? target.value : "", from])).toEqual([
      ["path", "../Risorse/porto.png", "Note/qui.md"],
      ["path", "audio/voce.ogg", "Note/qui.md"],
      ["path", "Risorse/persa.png", "Note/qui.md"],
    ]);
    expect(opened.sort()).toEqual(["Risorse/porto.png", "audio/voce.ogg"]);
    life.close();
  });

  it("un riferimento che non si risolve resta non risolto, senza src e senza lease", async () => {
    const root = html('<img data-vault-src="manca.png"><span class="embed" data-embed-page="manca.jpg">manca.jpg</span>');
    const { media, opened } = port({});
    await hydrateVaultMedia(root, "n.md", same, openLifetime(), media);
    expect(root.querySelector("img")?.hasAttribute("src")).toBe(false);
    expect(root.querySelector("img")?.classList.contains("unresolved")).toBe(true);
    expect(root.querySelector(".embed")?.classList.contains("unresolved")).toBe(true);
    expect(opened).toEqual([]);
  });

  it("un lease arrivato dopo lo smontaggio si chiude subito", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const root = html('<img data-vault-src="a.png">');
    const { media, closed } = port({ "a.png": "a.png" }, gate);
    const life = openLifetime();
    const running = hydrateVaultMedia(root, "n.md", same, life, media);
    life.close();
    release();
    await running;
    expect(closed).toEqual(["h-a.png"]);
    expect(root.querySelector("img")?.hasAttribute("src")).toBe(false);
  });

  it("un PDF incorporato diventa un collegamento, non un lease", async () => {
    const root = html('<span class="embed" data-embed-page="doc.pdf">doc.pdf</span>');
    const { media, opened } = port({ "doc.pdf": "doc.pdf" });
    await hydrateVaultMedia(root, "n.md", same, openLifetime(), media);
    expect(root.querySelector<HTMLElement>(".embed a.wikilink")?.dataset.wikilinkPage).toBe("doc.pdf");
    expect(opened).toEqual([]);
  });

  it("legge la dimensione di un embed e rifiuta ciò che non lo è", () => {
    expect(embedSize("120")).toEqual({ width: "120" });
    expect(embedSize(" 200x100 ")).toEqual({ width: "200", height: "100" });
    expect(embedSize("un alias")).toBeNull();
    expect(embedSize(undefined)).toBeNull();
  });
});

describe("i disegni dentro una nota", () => {
  const ACQUA = "disegni/acqua.svg";

  it("senza un testo del link, l'alt di ogni forma d'embed è il titolo del disegno", async () => {
    const root = html(
      `<p><img data-vault-src="../${ACQUA}" alt=""></p>`
        + '<span class="embed" data-embed-page="acqua.svg">acqua.svg</span>'
        + "<span class=\"embed\" data-embed-page=\"acqua.svg\" data-embed-heading=\"Ciclo dell'acqua\">acqua.svg#Ciclo dell'acqua</span>"
        + '<span class="embed" data-embed-page="acqua.svg" data-embed-size="120">acqua.svg</span>'
        + `<div class="embed" data-embed-path="../${ACQUA}">../${ACQUA}</div>`
        // La resa dell'host di `![[acqua.svg|200]]`: la dimensione come testo.
        + '<div class="embed" data-embed-page="acqua.svg">200</div>',
    );
    const { media, opened, named } = port(
      { [`../${ACQUA}`]: ACQUA, "acqua.svg": ACQUA },
      undefined,
      { [ACQUA]: "Ciclo dell'acqua" },
    );
    const life = openLifetime();
    await hydrateVaultMedia(root, "note/Indice.md", same, life, media);

    const images = Array.from(root.querySelectorAll("img"));
    expect(images).toHaveLength(6);
    for (const img of images) {
      expect(img.alt).toBe("Ciclo dell'acqua");
      expect(img.getAttribute("src")).toBe(`fub-asset://localhost/h-${ACQUA}`);
      expect(img.dataset.vaultId).toBe(ACQUA);
    }
    expect(opened).toHaveLength(6);
    expect(named).toEqual(Array(6).fill(ACQUA));
    // Il disegno è un'immagine: il suo markup non entra nella nota.
    expect(root.querySelector("svg, script, figure")).toBeNull();
    life.close();
  });

  it("il testo che il link scrive vince sul titolo, e non si chiede il nome", async () => {
    const root = html(
      `<img data-vault-src="${ACQUA}" alt="La pioggia">`
        + '<span class="embed" data-embed-page="acqua.svg">Il ciclo</span>'
        + `<div class="embed" data-embed-path="${ACQUA}">La mappa</div>`,
    );
    const { media, named } = port({ [ACQUA]: ACQUA, "acqua.svg": ACQUA }, undefined, { [ACQUA]: "Ciclo dell'acqua" });
    await hydrateVaultMedia(root, "Indice.md", same, openLifetime(), media);
    expect(Array.from(root.querySelectorAll("img"), (img) => img.alt)).toEqual(["La pioggia", "Il ciclo", "La mappa"]);
    expect(named).toEqual([]);
  });

  it("un disegno senza titolo prende il nome che l'host gli dà; un SVG che non è un documento resta com'era", async () => {
    const root = html(
      '<span class="embed" data-embed-page="flusso.svg">flusso.svg</span>'
        + '<span class="embed" data-embed-page="icona.svg">icona.svg</span>'
        + '<img data-vault-src="icona.svg" alt="">'
        + '<div class="embed" data-embed-path="icona.svg">icona.svg</div>',
    );
    const { media, named } = port(
      { "flusso.svg": "diagrammi/flusso.svg", "icona.svg": "icone/icona.svg" },
      undefined,
      { "diagrammi/flusso.svg": "flusso" },
    );
    await hydrateVaultMedia(root, "Indice.md", same, openLifetime(), media);
    const [flusso, icona, inline, placed] = Array.from(root.querySelectorAll("img"));
    expect(flusso!.alt).toBe("flusso");
    expect(icona!.alt).toBe("icona.svg");
    expect(inline!.alt).toBe("");
    expect(placed!.alt).toBe("icona.svg");
    expect(named.sort()).toEqual(["diagrammi/flusso.svg", "icone/icona.svg", "icone/icona.svg", "icone/icona.svg"]);
  });

  it("per un'immagine che non è un SVG non si chiede niente all'indice", async () => {
    const root = html('<img data-vault-src="a.png" alt=""><span class="embed" data-embed-page="b.jpg">b.jpg</span>');
    const { media, named } = port({ "a.png": "a.png", "b.jpg": "b.jpg" });
    await hydrateVaultMedia(root, "n.md", same, openLifetime(), media);
    expect(named).toEqual([]);
    expect(root.querySelector<HTMLImageElement>(".embed img")!.alt).toBe("b.jpg");
  });

  it("un nome che non arriva non ferma l'immagine", async () => {
    const root = html(`<span class="embed" data-embed-page="acqua.svg">acqua.svg</span>`);
    const { media } = port({ "acqua.svg": ACQUA });
    media.drawingName = () => Promise.reject(new Error("indice chiuso"));
    await hydrateVaultMedia(root, "n.md", same, openLifetime(), media);
    const img = root.querySelector<HTMLImageElement>(".embed img")!;
    expect(img.getAttribute("src")).toBe(`fub-asset://localhost/h-${ACQUA}`);
    expect(img.alt).toBe("acqua.svg");
  });

  it("un disegno che non si risolve resta non risolto, senza lease e senza nome", async () => {
    const root = html('<img data-vault-src="perso.svg" alt=""><span class="embed" data-embed-page="perso.svg">perso.svg</span>');
    const { media, opened, named } = port({});
    await hydrateVaultMedia(root, "n.md", same, openLifetime(), media);
    expect(root.querySelector("img")!.classList.contains("unresolved")).toBe(true);
    expect(root.querySelector(".embed")!.classList.contains("unresolved")).toBe(true);
    expect(opened).toEqual([]);
    expect(named).toEqual([]);
  });

  it("il segnaposto di `![[disegno]]` diventa l'immagine del disegno, con un lease suo", async () => {
    const root = html('<span class="embed" data-embed-page="acqua">acqua</span><span class="embed" data-embed-page="acqua">Il ciclo</span>');
    const [bare, aliased] = Array.from(root.querySelectorAll<HTMLElement>(".embed"));
    const { media, opened, closed, named } = port({});
    const life = openLifetime();
    const drawing = { doc: ACQUA, name: "Ciclo dell'acqua" };
    await showEmbeddedDrawing(root, bare!, drawing, life, media);
    await showEmbeddedDrawing(root, aliased!, drawing, life, media);
    expect(bare!.dataset.vaultMedia).toBe("loaded");
    expect(bare!.querySelector("img")!.alt).toBe("Ciclo dell'acqua");
    expect(aliased!.querySelector("img")!.alt).toBe("Il ciclo");
    expect(bare!.querySelector("img")!.dataset.vaultId).toBe(ACQUA);
    expect(opened).toEqual([ACQUA, ACQUA]);
    // La didascalia del segnaposto è già il nome: l'indice non serve.
    expect(named).toEqual([]);
    life.close();
    expect(closed).toEqual([`h-${ACQUA}`, `h-${ACQUA}`]);
  });

  it("un disegno che non si apre lascia lo slot non risolto", async () => {
    const root = html('<span class="embed" data-embed-page="acqua">acqua</span>');
    const slot = root.querySelector<HTMLElement>(".embed")!;
    const { media } = port({});
    media.open = () => Promise.reject(new Error("sparito"));
    await showEmbeddedDrawing(root, slot, { doc: ACQUA, name: "Ciclo dell'acqua" }, openLifetime(), media);
    expect(slot.dataset.vaultMedia).toBe("unresolved");
    expect(slot.classList.contains("unresolved")).toBe(true);
    expect(slot.textContent).toBe("acqua");
  });

  it("legge il testo proprio di un embed fra le due rese", () => {
    const span = (attrs: string, text: string) => html(`<span class="embed" ${attrs}>${text}</span>`).firstElementChild as HTMLElement;
    expect(embedOwnText(span('data-embed-page="acqua.svg"', "acqua.svg"))).toBeNull();
    expect(embedOwnText(span('data-embed-page="acqua.svg"', " acqua.svg "))).toBeNull();
    expect(embedOwnText(span('data-embed-page="acqua.svg" data-embed-heading="Titolo"', "acqua.svg#Titolo"))).toBeNull();
    expect(embedOwnText(span('data-embed-page="acqua.svg" data-embed-block="b1"', "acqua.svg#^b1"))).toBeNull();
    // Una dimensione dopo la barra non è un testo: la resa dell'host la scrive
    // come etichetta, questa shell scrive il bersaglio e la mette da parte.
    expect(embedOwnText(span('data-embed-page="acqua.svg"', "200x100"))).toBeNull();
    expect(embedOwnText(span('data-embed-page="acqua.svg" data-embed-size="120"', "acqua.svg"))).toBeNull();
    expect(embedOwnText(span('data-embed-page="acqua.svg"', "Il ciclo"))).toBe("Il ciclo");
    expect(embedOwnText(span('data-embed-page="acqua.svg" data-embed-heading="Titolo"', "acqua.svg"))).toBe("acqua.svg");
    expect(embedOwnText(span('data-embed-page="acqua.svg"', ""))).toBeNull();
    expect(embedOwnText(span('data-embed-path="d/acqua.svg"', "d/acqua.svg"))).toBeNull();
    expect(embedOwnText(span('data-embed-path="d/acqua.svg"', "La mappa"))).toBe("La mappa");
  });

  it("il titolo di un disegno è il primo di livello 1, e vuoto non è un titolo", () => {
    const heading = (level: number, text: string) => ({ level, text, slug: text, span: { start: 0, end: 0 }, explicit_anchor: null });
    expect(drawingTitle([])).toBeNull();
    expect(drawingTitle([heading(2, "Strato"), heading(1, " Ciclo "), heading(1, "Altro")])).toBe("Ciclo");
    expect(drawingTitle([heading(1, "  ")])).toBeNull();
  });

  it("riconosce il segnaposto di una scena e nient'altro", () => {
    const figure = (attrs: string, inner: string) => `<figure ${attrs}>${inner}</figure>`;
    expect(scenePlaceholder(figure(
      `class="fub-scene" data-embed-kind="scene" data-embed-doc="${ACQUA}"`,
      "<figcaption>Ciclo dell'acqua</figcaption>",
    ))).toEqual({ doc: ACQUA, name: "Ciclo dell'acqua" });
    expect(scenePlaceholder(figure(`data-embed-kind="scene" data-embed-doc="${ACQUA}"`, "<figcaption> </figcaption>")))
      .toEqual({ doc: ACQUA, name: "acqua" });
    expect(scenePlaceholder(figure(`data-embed-kind="table" data-embed-doc="${ACQUA}"`, ""))).toBeNull();
    expect(scenePlaceholder(figure('data-embed-kind="scene"', ""))).toBeNull();
    expect(scenePlaceholder("<h1>Nota</h1><p>testo</p>")).toBeNull();
    // Un segnaposto ostile passa dal cancello: della didascalia resta il testo.
    const hostile = scenePlaceholder(figure(
      `data-embed-kind="scene" data-embed-doc="${ACQUA}"`,
      '<figcaption><img src=x onerror="alert(1)">Ciclo<script>alert(2)</script></figcaption>',
    ));
    expect(hostile).toEqual({ doc: ACQUA, name: "Ciclo" });
  });
});

describe("le immagini remote (L04)", () => {
  function rendered(html: string): HTMLElement {
    const container = document.createElement("div");
    setSanitizedHtml(container, html);
    return container;
  }

  it("non partono: l'indirizzo resta inerte e il segnaposto dice da dove verrebbero", () => {
    const container = rendered('<p><img src="https://e.it/a.png" alt="gatto"> <img src="//t.invalid/p.gif"></p>');
    const [remote, relative] = Array.from(container.querySelectorAll("img"));
    expect(remote!.hasAttribute("src")).toBe(false);
    expect(remote!.dataset.remoteSrc).toBe("https://e.it/a.png");
    expect(relative!.hasAttribute("data-remote-src")).toBe(false);
    const life = openLifetime();
    showRemoteImages(container, life);
    const box = container.querySelector<HTMLElement>(".image-remote")!;
    expect(box.textContent).toBe("gatto · e.it");
    expect(box.querySelector("button")).toBeNull();
    expect(remote!.hidden).toBe(true);
    life.close();
  });

  it("si scaricano soltanto col gesto, una volta per clic", async () => {
    const container = rendered('<img src="https://e.it/a.png">');
    const life = openLifetime();
    const asked: string[] = [];
    let finish!: () => void;
    showRemoteImages(container, life, (url) => {
      asked.push(url);
      return new Promise<void>((resolve) => { finish = resolve; });
    });
    showRemoteImages(container, life, async () => { throw new Error("una seconda volta"); });
    const buttons = container.querySelectorAll<HTMLButtonElement>(".image-remote-load");
    expect(buttons).toHaveLength(1);
    expect(asked).toEqual([]);
    buttons[0]!.click();
    expect(asked).toEqual(["https://e.it/a.png"]);
    expect(buttons[0]!.disabled).toBe(true);
    finish();
    await Promise.resolve();
    await Promise.resolve();
    expect(buttons[0]!.disabled).toBe(false);
    life.close();
  });
});

describe("i file Craft dentro una nota", () => {
  const LOGO = "Disegni/logo.vectorcraft";
  const FIGURE = `<figure class="fub-craft" data-embed-kind="craft" data-embed-doc="${LOGO}" data-craft-app="vectorcraft">`
    + "<figcaption>logo.vectorcraft</figcaption></figure>";
  const PNG = btoa(String.fromCharCode(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a));

  /// Le risorse della nota: `embed` risponde come il kernel, col segnaposto
  /// del provider per ogni file Craft.
  function resources(answer: (page: string) => EmbedContent | Promise<EmbedContent>) {
    const asked: string[] = [];
    const value: MarkdownResources = {
      documentId: "Nota.md",
      match: () => undefined,
      embed: async (page) => {
        asked.push(page);
        return answer(page);
      },
      subscribe: () => () => {},
      invalidate: () => {},
      release: () => {},
    };
    return { value, asked };
  }

  function preview(image: boolean): CraftPreview {
    return {
      version: 2,
      doc: LOGO,
      revision: "r1",
      size: "small",
      origin: image ? "file" : "none",
      queued: false,
      image: image ? { media_type: "image/png", data: PNG, width: 40, height: 30, orientation: 1 } : null,
      missing: image ? null : "absent",
      limit_bytes: null,
      info: { app: "vectorcraft", editor: "VectorCraft", format_version: null, bytes: 2048, photo: null, edits: [], xmp: null },
      render: image ? null : { app: "VectorCraft", consent: "ask" },
    };
  }

  const disposers: Array<() => void> = [];
  beforeEach(() => {
    craft.asks = [];
    craft.figures = [];
    craft.preview = preview(true);
    vi.spyOn(URL, "createObjectURL").mockImplementation(() => "blob:logo");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  });
  afterEach(() => {
    for (const dispose of disposers.splice(0)) dispose();
    document.body.replaceChildren();
    vi.restoreAllMocks();
    // Nessuna figura ha chiesto all'app di fare l'anteprima.
    for (const ask of craft.asks) expect(ask.options).toBeUndefined();
  });

  function note(markup: string, embeds: ReturnType<typeof resources>, opened: string[] = []): HTMLElement {
    const root = document.createElement("div");
    root.className = "markdown-rendered";
    document.body.append(root);
    disposers.push(mountMarkdown(root, markup, {
      documentId: "Nota.md",
      resources: embeds.value,
      // La figura passa da `openFigure`, mai dal wikilink: un wikilink che non
      // risolve crea una nota, e un clic su una figura non scrive nel vault.
      openWikilink: (page) => { opened.push(`wikilink:${page}`); },
      openFigure: (doc) => { opened.push(doc); },
    }));
    return root;
  }

  it("`![[logo.vectorcraft]]` passa da showEmbeddedCraft: l'anteprima piccola, e un clic apre il file", async () => {
    const embeds = resources(() => ({ doc_id: LOGO, html: FIGURE, parts: [] }));
    const opened: string[] = [];
    const root = note('<p><span class="embed" data-embed-page="logo.vectorcraft">logo.vectorcraft</span></p>', embeds, opened);
    await vi.waitFor(() => expect(root.querySelector("figure.craft-figure img")).not.toBeNull());
    expect(craft.figures).toEqual([LOGO]);
    expect(craft.asks).toEqual([{ doc: LOGO, size: "small", options: undefined }]);
    expect(root.querySelector<HTMLImageElement>("figure.craft-figure img")!.getAttribute("src")).toBe("blob:logo");
    // Il segnaposto del provider non entra nella nota.
    expect(root.querySelector(".fub-craft")).toBeNull();
    root.querySelector<HTMLElement>("figure.craft-figure")!.click();
    await vi.waitFor(() => expect(opened).toEqual([LOGO]));
  });

  it("da sola nel paragrafo la didascalia è quella della resa (K10): una sola", async () => {
    const opened: string[] = [];
    const root = note(
      '<figure><span class="embed" data-embed-page="logo.vectorcraft">logo.vectorcraft</span><figcaption>logo.vectorcraft</figcaption></figure>'
        + '<figure><span class="embed" data-embed-page="schizzo.vectorcraft">schizzo.vectorcraft</span><figcaption>schizzo.vectorcraft</figcaption></figure>',
      resources((page) => page === "logo.vectorcraft"
        ? { doc_id: LOGO, html: FIGURE, parts: [] }
        : { doc_id: "Disegni/schizzo.vectorcraft", html: FIGURE.replaceAll(LOGO, "Disegni/schizzo.vectorcraft"), parts: [] }),
      opened,
    );
    await vi.waitFor(() => expect(root.querySelector("img.craft-figure-image")).not.toBeNull());
    expect(root.querySelectorAll("figcaption")).toHaveLength(2);
    expect(root.querySelector(".craft-figure")).toBeNull();
    root.querySelector<HTMLElement>("img.craft-figure-image")!.click();
    await vi.waitFor(() => expect(opened).toEqual([LOGO]));
  });

  it("senza anteprima resta il riquadro col nome, e l'app non si avvia", async () => {
    craft.preview = preview(false);
    const embeds = resources(() => ({ doc_id: LOGO, html: FIGURE, parts: [] }));
    const root = note('<span class="embed" data-embed-page="logo.vectorcraft">logo.vectorcraft</span>', embeds);
    await vi.waitFor(() => expect(root.querySelector(".embed")!.getAttribute("data-vault-media")).toBe("loaded"));
    expect(root.querySelector(".craft-figure-box")!.textContent).toBe("logo.vectorcraft · Disegno di VectorCraft · 2.0 KiB · Nessuna anteprima");
    expect(root.querySelector("img")).toBeNull();
  });

  it("la stessa figura dieci volte: una resa e una domanda sola", async () => {
    const embeds = resources(() => ({ doc_id: LOGO, html: FIGURE, parts: [] }));
    const root = note('<span class="embed" data-embed-page="logo.vectorcraft">logo.vectorcraft</span>'.repeat(10), embeds);
    await vi.waitFor(() => expect(root.querySelectorAll("figure.craft-figure img")).toHaveLength(10));
    expect(embeds.asked).toEqual(["logo.vectorcraft"]);
    expect(new Set(craft.asks.map((ask) => ask.doc))).toEqual(new Set([LOGO]));
  });

  it("un segnaposto che nomina un altro documento non è la figura di questo", async () => {
    const embeds = resources(() => ({ doc_id: "Altra.md", html: FIGURE, parts: [] }));
    const root = note('<span class="embed" data-embed-page="Altra">Altra</span>', embeds);
    await vi.waitFor(() => expect(root.querySelector(".embed-loaded")).not.toBeNull());
    expect(craft.figures).toEqual([]);
    expect(root.querySelector(".craft-figure, .craft-figure-box")).toBeNull();
  });

  it("una figura dentro un embed dentro un embed si mostra anche lì", async () => {
    const embeds = resources((page) => page === "Prima"
      ? { doc_id: "Prima.md", html: '<span class="embed" data-embed-page="Seconda">Seconda</span>', parts: [] }
      : page === "Seconda"
        ? { doc_id: "Seconda.md", html: '<span class="embed" data-embed-page="logo.vectorcraft">logo.vectorcraft</span>', parts: [] }
        : { doc_id: LOGO, html: FIGURE, parts: [] });
    const root = note('<span class="embed" data-embed-page="Prima">Prima</span>', embeds);
    await vi.waitFor(() => expect(root.querySelector(".embed-loaded .embed-loaded figure.craft-figure img")).not.toBeNull());
    expect(craft.figures).toEqual([LOGO]);
  });

  it("un file Craft che non c'è più resta l'embed non risolto", async () => {
    const embeds = resources(() => Promise.reject(new Error("non c'è")));
    const root = note('<span class="embed" data-embed-page="logo.vectorcraft">logo.vectorcraft</span>', embeds);
    await vi.waitFor(() => expect(root.querySelector(".embed.unresolved")).not.toBeNull());
    expect(craft.figures).toEqual([]);
    expect(craft.asks).toEqual([]);
  });
});

describe("i PDF dentro una nota (T31)", () => {
  const GUIDA = "Manuali/guida.pdf";
  const PNG = btoa(String.fromCharCode(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a));

  function preview(image: boolean): CraftPreview {
    return {
      version: 2,
      doc: GUIDA,
      revision: "r1",
      size: "small",
      origin: image ? "file" : "none",
      queued: false,
      image: image ? { media_type: "image/png", data: PNG, width: 181, height: 256, orientation: 1 } : null,
      missing: image ? null : "absent",
      limit_bytes: null,
      info: { app: "pdf", editor: "PdfCraft", format_version: null, bytes: 8192, photo: null, edits: [], xmp: null },
      render: image ? null : { app: "PdfCraft", consent: "on" },
    };
  }

  beforeEach(() => {
    craft.asks = [];
    craft.figures = [];
    craft.render.mockReset();
    craft.preview = preview(true);
    vi.spyOn(URL, "createObjectURL").mockImplementation(() => "blob:guida");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
    // La nota non chiede mai all'app di fare l'anteprima.
    expect(craft.render).not.toHaveBeenCalled();
  });

  it("`![[guida.pdf]]` con l'anteprima è la figura della prima pagina col nome, senza collegamento né lease", async () => {
    const root = html('<p><span class="embed" data-embed-page="guida.pdf">guida.pdf</span></p>');
    const { media, opened } = port({ "guida.pdf": GUIDA });
    const asked: string[] = [];
    await hydrateVaultMedia(root, "Nota.md", same, openLifetime(), media, (doc) => { asked.push(doc); });
    const img = root.querySelector<HTMLImageElement>(".embed figure.craft-figure img")!;
    expect(img).not.toBeNull();
    expect(img.className).toBe("craft-figure-image craft-figure-page");
    expect(img.getAttribute("src")).toBe("blob:guida");
    expect(img.getAttribute("width")).toBe("181");
    expect(root.querySelector("figcaption")!.textContent).toBe("guida.pdf");
    expect(root.querySelector("a.wikilink")).toBeNull();
    expect(opened).toEqual([]);
    expect(craft.figures).toEqual([GUIDA]);
    expect(craft.asks).toEqual([{ doc: GUIDA, size: "small", options: undefined }]);
    // Il clic apre il PDF (con il gesto: lo dice chi passa `open`).
    root.querySelector<HTMLElement>("figure.craft-figure")!.click();
    await vi.waitFor(() => expect(asked).toEqual([GUIDA]));
    root.querySelector<HTMLElement>("figure.craft-figure")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await vi.waitFor(() => expect(asked).toEqual([GUIDA, GUIDA]));
  });

  it("con una pagina scelta (`#page=3`) resta il collegamento, e non si chiede niente", async () => {
    const root = html('<span class="embed" data-embed-page="guida.pdf" data-embed-heading="page=3">guida.pdf#page=3</span>');
    const { media } = port({ "guida.pdf": GUIDA });
    await hydrateVaultMedia(root, "Nota.md", same, openLifetime(), media);
    expect(root.querySelector<HTMLElement>(".embed a.wikilink")?.dataset.wikilinkPage).toBe("guida.pdf");
    expect(root.querySelector("figure")).toBeNull();
    expect(craft.asks).toEqual([]);
  });

  it("senza anteprima (il PDF protetto, l'app che non c'è) resta il collegamento", async () => {
    craft.preview = preview(false);
    const root = html('<span class="embed" data-embed-page="guida.pdf">guida.pdf</span>');
    const { media } = port({ "guida.pdf": GUIDA });
    await hydrateVaultMedia(root, "Nota.md", same, openLifetime(), media);
    expect(root.querySelector<HTMLElement>(".embed a.wikilink")?.dataset.wikilinkPage).toBe("guida.pdf");
    expect(root.querySelector("img, .craft-figure-box")).toBeNull();
    expect(root.querySelector<HTMLElement>(".embed")!.dataset.vaultMedia).toBe("loaded");
  });

  it("un guasto della domanda lascia il collegamento", async () => {
    craft.preview = null;
    const root = html('<span class="embed" data-embed-page="guida.pdf">guida.pdf</span>');
    const { media } = port({ "guida.pdf": GUIDA });
    await hydrateVaultMedia(root, "Nota.md", same, openLifetime(), media);
    expect(root.querySelector(".embed a.wikilink")).not.toBeNull();
  });

  it("un PDF che non si risolve resta il collegamento, senza domande", async () => {
    const root = html('<span class="embed" data-embed-page="altro.pdf">altro.pdf</span>');
    const { media } = port({});
    await hydrateVaultMedia(root, "Nota.md", same, openLifetime(), media);
    expect(root.querySelector(".embed a.wikilink")).not.toBeNull();
    expect(craft.asks).toEqual([]);
  });

  it("un documento di Word incorporato non passa di qui: resta il suo testo", async () => {
    const root = html('<span class="embed" data-embed-page="lettera.docx">lettera.docx</span>');
    const { media, asked } = port({ "lettera.docx": "lettera.docx" });
    await hydrateVaultMedia(root, "Nota.md", same, openLifetime(), media);
    expect(root.querySelector(".embed")!.textContent).toBe("lettera.docx");
    expect(asked).toEqual([]);
    expect(craft.asks).toEqual([]);
  });
});
