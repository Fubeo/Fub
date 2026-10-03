// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import type { LinkTarget } from "../../../../host/contract";
import { openLifetime } from "../../../../ui/lifetime";
import {
  drawingTitle,
  embedOwnText,
  embedSize,
  hydrateVaultMedia,
  scenePlaceholder,
  showEmbeddedDrawing,
  vaultImageSource,
  type MediaPort,
} from "./media";

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

function html(markup: string): HTMLElement {
  const root = document.createElement("div");
  root.innerHTML = markup;
  return root;
}

describe("i media del vault dentro una nota", () => {
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
