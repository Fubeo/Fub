// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import type { LinkTarget } from "../../../../host/contract";
import { openLifetime } from "../../../../ui/lifetime";
import { embedSize, hydrateVaultMedia, vaultImageSource, type MediaPort } from "./media";

function port(files: Record<string, string>, delay?: Promise<void>) {
  const opened: string[] = [];
  const closed: string[] = [];
  const asked: Array<[LinkTarget, string]> = [];
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
  };
  return { media, opened, closed, asked };
}

const same = <T,>(value: Promise<T>) => value;

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
      expect(shown).toBe(DRAWING.replace('href="foto.png"', `href="${PNG_URI}"`));
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
        '<span class="embed" data-embed-page="storia.svg" data-embed-heading="Copertina">storia.svg</span>'
          + '<span class="embed" data-embed-page="storia.svg" data-embed-heading="Storia">storia.svg</span>'
          + '<span class="embed" data-embed-page="storia.svg">storia.svg</span>'
          + '<span class="embed" data-embed-page="storia.svg" data-embed-heading="Retro">storia.svg</span>'
          + '<span class="embed" data-embed-page="storia.svg" data-embed-heading="copertina">storia.svg</span>'
          + '<span class="embed" data-embed-page="grande.svg" data-embed-heading="Retro">grande.svg</span>',
      );
      const { media } = port({ "storia.svg": "Disegni/storia.svg", "grande.svg": "Disegni/grande.svg" });
      media.read = async (id) => (id === "Disegni/grande.svg" ? null : new Blob([DRAWING], { type: "image/svg+xml" }));
      await hydrateVaultMedia(root, "Note/qui.md", same, openLifetime(), media);
      const [cover, titled, whole, unknown, cased, large] = Array.from(root.querySelectorAll<HTMLElement>(".embed"));
      const shown = (slot: HTMLElement) => blobs.get(slot.querySelector("img")!.getAttribute("src")!)!.text();

      // La tavola: la prima che si chiama così, col suo rettangolo.
      expect(await shown(cover!)).toBe(`${HEAD} viewBox="0 0 600 400" width="600" height="400">${BODY}`);
      expect(cover!.querySelector("img")!.alt).toBe("storia.svg#Copertina");
      expect(cover!.dataset.vaultMedia).toBe("loaded");
      // Il titolo è il disegno intero, prima della tavola che si chiama come
      // lui; senza heading, lo stesso.
      expect(await shown(titled!)).toBe(DRAWING);
      expect(titled!.querySelector("img")!.alt).toBe("storia.svg#Storia");
      expect(await shown(whole!)).toBe(DRAWING);
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
