// @vitest-environment happy-dom
// Le pagine web incorporate (T37): l'elenco chiuso dei siti, il segnaposto
// «Carica» e la regola che nessun iframe entra nella shell.
import { afterEach, describe, expect, it, vi } from "vitest";
import { openLifetime } from "../../../../ui/lifetime";
import { setSanitizedHtml } from "../../../../ui/sanitize";
import { viewerSite, type EmbedOpening } from "../../../../ui/web-viewer";
import { showRemoteImages } from "./media";
import { mountMarkdown } from "./mount";
import { WEB_EMBED_SITES, webEmbedOf, webEmbedPlaceholder } from "./web-embed";

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

afterEach(() => {
  document.body.replaceChildren();
});

describe("l'elenco chiuso dei siti", () => {
  it("è fatto di id unici, host esatti in minuscolo che il visore apre", () => {
    const ids = WEB_EMBED_SITES.map((site) => site.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const site of WEB_EMBED_SITES) {
      expect(["video", "map", "drawing"]).toContain(site.kind);
      expect(site.name.trim()).not.toBe("");
      for (const host of site.hosts) {
        expect(host).toBe(host.toLowerCase());
        expect(viewerSite(`https://${host}/`)).toBe(host);
      }
    }
  });

  it("riconosce video, mappe e disegni dei siti dell'elenco", () => {
    const cases: [string, string, string][] = [
      ["https://www.youtube.com/watch?v=dQw4w9WgXcQ", "youtube", "https://www.youtube.com/watch?v=dQw4w9WgXcQ"],
      ["https://youtu.be/dQw4w9WgXcQ?t=42", "youtu-be", "https://youtu.be/dQw4w9WgXcQ?t=42"],
      ["https://vimeo.com/76979871", "vimeo", "https://vimeo.com/76979871"],
      ["https://www.openstreetmap.org/#map=15/45.4642/9.1900", "openstreetmap", "https://www.openstreetmap.org/#map=15/45.4642/9.1900"],
      ["https://www.google.com/maps/place/Milano", "google-maps", "https://www.google.com/maps/place/Milano"],
      ["https://www.figma.com/design/AbC123/Schizzo", "figma", "https://www.figma.com/design/AbC123/Schizzo"],
      ["https://excalidraw.com/#room=abc,def", "excalidraw", "https://excalidraw.com/#room=abc,def"],
    ];
    for (const [address, id, url] of cases) {
      const embed = webEmbedOf(address);
      expect(embed?.site.id, address).toBe(id);
      expect(embed?.url, address).toBe(url);
    }
  });

  it("fuori dall'elenco, o fuori dai contenuti del sito, non incorpora niente", () => {
    for (const address of [
      "https://esempio.it/video",
      "https://www.youtube.com/",
      "https://www.youtube.com/@canale",
      "https://www.google.com/search?q=mappe",
      "https://youtube.com.esempio.it/watch?v=x",
      "https://www.figma.com/",
      "mailto:qualcuno@esempio.it",
      "javascript:alert(1)",
      "Risorse/video.mp4",
      `https://www.youtube.com/watch?v=${"x".repeat(2100)}`,
    ]) {
      expect(webEmbedOf(address), address).toBeNull();
    }
  });

  it("un indirizzo http si apre in https; credenziali e porte strane lo escludono", () => {
    expect(webEmbedOf("http://www.youtube.com/watch?v=abc")?.url).toBe("https://www.youtube.com/watch?v=abc");
    expect(webEmbedOf("http://www.youtube.com:80/watch?v=abc")?.url).toBe("https://www.youtube.com/watch?v=abc");
    expect(webEmbedOf("https://WWW.YouTube.com:443/watch?v=abc")?.url).toBe("https://www.youtube.com/watch?v=abc");
    expect(webEmbedOf("https://www.youtube.com:8443/watch?v=abc")).toBeNull();
    expect(webEmbedOf("http://www.youtube.com:443/watch?v=abc")).toBeNull();
    expect(webEmbedOf("https://io:segreto@www.youtube.com/watch?v=abc")).toBeNull();
  });

  it("toglie i parametri di tracciamento, di tutti e del sito, e tiene gli altri", () => {
    expect(webEmbedOf("https://www.youtube.com/watch?v=abc&si=TRACCIA&utm_source=x&UTM_Medium=y&fbclid=z&t=42&list=PL1")?.url)
      .toBe("https://www.youtube.com/watch?v=abc&t=42&list=PL1");
    expect(webEmbedOf("https://youtu.be/abc?si=TRACCIA&feature=shared")?.url).toBe("https://youtu.be/abc");
    // `si` è di YouTube: su un altro sito resta.
    expect(webEmbedOf("https://www.google.com/maps/place/Milano?si=1&gclid=2")?.url).toBe("https://www.google.com/maps/place/Milano?si=1");
  });
});

describe("il segnaposto «Carica»", () => {
  function placeholder(open: (url: string) => Promise<EmbedOpening>) {
    const life = openLifetime();
    const embed = webEmbedOf("http://www.youtube.com/watch?v=abc&si=x")!;
    const box = webEmbedPlaceholder(embed, life, open);
    document.body.append(box);
    const button = box.querySelector<HTMLButtonElement>(".web-embed-load")!;
    const detail = box.querySelector<HTMLElement>(".web-embed-detail")!;
    return { life, box, button, detail };
  }

  it("a riposo dice il sito, la specie e l'host, e non chiede niente alla rete", () => {
    const fetch = vi.spyOn(globalThis, "fetch");
    const open = vi.fn(async () => "opened" as const);
    const { life, box, button, detail } = placeholder(open);
    expect(box.dataset.state).toBe("rest");
    expect(box.dataset.webEmbedSite).toBe("youtube");
    expect(box.getAttribute("role")).toBe("group");
    expect(box.getAttribute("aria-label")).toBe("Video da YouTube, da caricare");
    expect(box.querySelector(".web-embed-name")?.textContent).toBe("YouTube");
    expect(detail.textContent).toBe("Video · www.youtube.com");
    expect(detail.title).toBe("https://www.youtube.com/watch?v=abc");
    expect(button.textContent).toBe("Carica");
    expect(button.getAttribute("aria-label")).toBe("Carica la pagina di YouTube");
    expect(box.querySelector("img, iframe, object, embed, video")).toBeNull();
    expect(open).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    fetch.mockRestore();
    life.close();
  });

  it("il clic apre nel visore l'indirizzo in https e senza tracciamento, una volta per clic", async () => {
    let finish!: (outcome: EmbedOpening) => void;
    const open = vi.fn(() => new Promise<EmbedOpening>((resolve) => { finish = resolve; }));
    const { life, box, button } = placeholder(open);
    button.click();
    button.click();
    expect(open).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledWith("https://www.youtube.com/watch?v=abc");
    expect(box.dataset.state).toBe("pending");
    expect(button.disabled).toBe(true);
    finish("opened");
    await settle();
    expect(box.dataset.state).toBe("rest");
    expect(button.disabled).toBe(false);
    life.close();
  });

  it("un sito dell'elenco rifiutato dalla persona lo dice, e si può chiedere di nuovo", async () => {
    const open = vi.fn(async (): Promise<EmbedOpening> => "refused");
    const { life, box, button, detail } = placeholder(open);
    button.click();
    await settle();
    expect(box.dataset.state).toBe("refused");
    expect(detail.textContent).toBe("Non caricata: hai scelto di non aprire www.youtube.com.");
    expect(button.textContent).toBe("Chiedi di nuovo");
    open.mockResolvedValueOnce("opened");
    button.click();
    await settle();
    expect(open).toHaveBeenCalledTimes(2);
    expect(box.dataset.state).toBe("rest");
    expect(button.textContent).toBe("Carica");
    life.close();
  });

  it("senza visore, o con un visore che non apre, dice che non c'è", async () => {
    const { life, box, detail } = placeholder(async () => "unavailable");
    box.querySelector<HTMLButtonElement>(".web-embed-load")!.click();
    await settle();
    expect(box.dataset.state).toBe("unavailable");
    expect(detail.textContent).toBe("Il visore web non è disponibile in questa finestra.");
    life.close();
    const failing = placeholder(async () => { throw new Error("guasto"); });
    failing.button.click();
    await settle();
    expect(failing.box.dataset.state).toBe("unavailable");
    failing.life.close();
  });

  it("Invio, Spazio e Tab sul pulsante restano suoi: non arrivano all'editor che lo contiene", () => {
    const { life, box, button } = placeholder(async () => "opened");
    const editor = document.createElement("div");
    document.body.append(editor);
    editor.append(box);
    const heard: string[] = [];
    editor.addEventListener("keydown", (event) => heard.push(event.key));
    for (const key of ["Enter", " ", "Tab"]) {
      button.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
    }
    button.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true, cancelable: true }));
    expect(heard).toEqual([]);
    // Le scorciatoie della finestra passano.
    button.dispatchEvent(new KeyboardEvent("keydown", { key: "p", ctrlKey: true, bubbles: true, cancelable: true }));
    button.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    expect(heard).toEqual(["p", "Escape"]);
    life.close();
  });

  it("una risposta arrivata dopo lo smontaggio non tocca niente", async () => {
    let finish!: (outcome: EmbedOpening) => void;
    const { life, box, button } = placeholder(() => new Promise<EmbedOpening>((resolve) => { finish = resolve; }));
    button.click();
    life.close();
    finish("refused");
    await settle();
    expect(box.dataset.state).toBe("pending");
  });
});

describe("l'embed di un indirizzo nella nota", () => {
  function rendered(html: string): HTMLElement {
    const container = document.createElement("div");
    setSanitizedHtml(container, html);
    document.body.append(container);
    return container;
  }

  it("nella Live un sito dell'elenco è il segnaposto, un altro resta l'immagine remota", () => {
    const container = rendered('<figure><img src="https://www.youtube.com/watch?v=abc" alt=""></figure><p><img src="https://e.it/a.png" alt="gatto"></p>');
    const life = openLifetime();
    const open = vi.fn(async (): Promise<EmbedOpening> => "opened");
    showRemoteImages(container, life, undefined, open);
    showRemoteImages(container, life, undefined, open);
    const [video, picture] = Array.from(container.querySelectorAll("img"));
    expect(video!.hidden).toBe(true);
    expect(container.querySelectorAll(".web-embed")).toHaveLength(1);
    expect(video!.nextElementSibling?.classList.contains("web-embed")).toBe(true);
    expect(picture!.nextElementSibling?.classList.contains("image-remote")).toBe(true);
    container.querySelector<HTMLButtonElement>(".web-embed-load")!.click();
    expect(open).toHaveBeenCalledWith("https://www.youtube.com/watch?v=abc");
    life.close();
  });

  it("in Lettura il segnaposto della resa dell'host diventa il segnaposto «Carica»", () => {
    const container = rendered(
      '<div class="embed" data-embed-url="https://vimeo.com/76979871">https://vimeo.com/76979871</div>'
      + '<div class="embed" data-embed-url="https://esempio.it/a.png">https://esempio.it/a.png</div>',
    );
    const life = openLifetime();
    showRemoteImages(container, life);
    const [video, other] = Array.from(container.querySelectorAll<HTMLElement>(".embed"));
    expect(video!.querySelector(".web-embed")?.getAttribute("data-web-embed-site")).toBe("vimeo");
    expect(video!.classList.contains("embed-media")).toBe(true);
    expect(other!.querySelector(".web-embed")).toBeNull();
    expect(other!.textContent).toBe("https://esempio.it/a.png");
    life.close();
  });

  it("nessun iframe entra nella shell: né dalla resa, né dal segnaposto, né dal clic", async () => {
    const added: string[] = [];
    const watcher = new MutationObserver((records) => {
      for (const record of records) {
        for (const node of record.addedNodes) {
          if (node instanceof Element && (node.localName === "iframe" || node.querySelector("iframe"))) added.push(node.outerHTML);
        }
      }
    });
    watcher.observe(document.body, { childList: true, subtree: true });
    const container = document.createElement("div");
    document.body.append(container);
    const unmount = mountMarkdown(
      container,
      // Un `<iframe>` scritto nella nota lo toglie il sanitizzatore
      // (`ui/sanitize.test.ts`); qui conta che la resa non ne crei.
      '<p><img src="https://www.youtube.com/watch?v=abc"></p>'
      + '<div class="embed" data-embed-url="https://www.openstreetmap.org/#map=5/45/9">mappa</div>',
    );
    expect(container.querySelectorAll(".web-embed")).toHaveLength(2);
    // Senza visore montato il clic non apre niente altrove: lo dice.
    for (const button of container.querySelectorAll<HTMLButtonElement>(".web-embed-load")) button.click();
    await settle();
    expect([...container.querySelectorAll<HTMLElement>(".web-embed")].map((box) => box.dataset.state))
      .toEqual(["unavailable", "unavailable"]);
    await settle();
    watcher.disconnect();
    expect(document.querySelector("iframe")).toBeNull();
    expect(added).toEqual([]);
    unmount();
  });
});
