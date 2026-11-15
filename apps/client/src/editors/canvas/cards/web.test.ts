// @vitest-environment happy-dom
// La scheda di pagina web: i quattro stati della porta, l'indirizzo non
// valido, «Mostra l'anteprima» che chiede una volta sola, la porta che avvisa
// dopo lo smontaggio, e che la scheda non vada mai in rete da sé (niente
// `fetch`, niente `XMLHttpRequest`, niente iframe, niente immagini remote).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openLifetime, type Lifetime } from "../../../ui/lifetime";
import type { CardContext, CardMode, CardSnapshot, CardView } from "../cards";
import type { CanvasNode } from "../model";
import { webCardAddress, webCardIcon, webCardRenderer, type WebCardPort, type WebCardView } from "./web";

const URL_PAGE = "https://www.esempio.it/articoli/lavagna?x=1";
const ICON = "data:image/png;base64,iVBORw0KGgo=";

/// Una porta finta: lo stato per indirizzo, chi ascolta, le richieste e le
/// aperture contate.
function fakePort(initial: WebCardView = { kind: "bare" }) {
  const views = new Map<string, WebCardView>();
  let fallback = initial;
  const listeners = new Set<() => void>();
  const stale: (() => void)[] = [];
  const requests: string[] = [];
  const opened: string[] = [];
  const unwatched = { count: 0 };
  const port: WebCardPort = {
    view: (url) => views.get(url) ?? fallback,
    request: (url) => {
      requests.push(url);
    },
    watch: (changed) => {
      listeners.add(changed);
      stale.push(changed);
      return () => {
        unwatched.count += 1;
        listeners.delete(changed);
      };
    },
    open: (url) => {
      opened.push(url);
    },
  };
  return {
    port,
    requests,
    opened,
    unwatched,
    listeners,
    /// Cambia lo stato e avvisa chi ascolta.
    set(view: WebCardView, url?: string) {
      if (url === undefined) fallback = view;
      else views.set(url, view);
      for (const listener of [...listeners]) listener();
    },
    /// Chiama anche chi ha già smesso di ascoltare: una porta sbadata.
    notifyEveryone() {
      for (const listener of stale) listener();
    },
  };
}

function snapshots() {
  const parts = new Map<string, CardSnapshot>();
  return {
    get: (path: string, part: string) => parts.get(`${path} ${part}`),
    put: (path: string, part: string, snapshot: CardSnapshot) => void parts.set(`${path} ${part}`, snapshot),
    forget: () => undefined,
  };
}

function linkNode(url: string | undefined): CanvasNode {
  const node: CanvasNode = { id: "web-1", type: "link", x: 0, y: 0, width: 400, height: 200 };
  if (url !== undefined) node.url = url;
  return node;
}

interface Mounted {
  readonly host: HTMLElement;
  readonly view: CardView;
  readonly lifetime: Lifetime;
  root(): HTMLElement;
  preview(): HTMLButtonElement | null;
  open(): HTMLButtonElement | null;
}

function mount(port: WebCardPort, options: { url?: string; mode?: CardMode } = {}): Mounted {
  const host = document.createElement("div");
  document.body.append(host);
  const lifetime = openLifetime();
  const context: CardContext = {
    path: "",
    subpath: null,
    documentId: "Lavagne/studio.canvas",
    lifetime,
    snapshots: snapshots(),
    size: () => ({ width: 400, height: 200 }),
    zoom: () => 1,
    missing: () => undefined,
  };
  const url = "url" in options ? options.url : URL_PAGE;
  const view = webCardRenderer(port).mount(linkNode(url), host, options.mode ?? "live", context);
  return {
    host,
    view,
    lifetime,
    root: () => host.querySelector<HTMLElement>(".canvas-card-web")!,
    preview: () => host.querySelector<HTMLButtonElement>(".canvas-card-web-preview"),
    open: () => host.querySelector<HTMLButtonElement>(".canvas-open-url"),
  };
}

function text(host: HTMLElement, selector: string): string | null {
  return host.querySelector(selector)?.textContent ?? null;
}

let fetchSpy: ReturnType<typeof vi.fn>;
let xhrSpy: ReturnType<typeof vi.fn>;
let xhrBefore: typeof XMLHttpRequest;
let fetchBefore: typeof fetch;

beforeEach(() => {
  document.body.replaceChildren();
  fetchBefore = globalThis.fetch;
  xhrBefore = globalThis.XMLHttpRequest;
  fetchSpy = vi.fn(() => Promise.reject(new Error("la scheda non va in rete")));
  xhrSpy = vi.fn();
  globalThis.fetch = fetchSpy as unknown as typeof fetch;
  globalThis.XMLHttpRequest = xhrSpy as unknown as typeof XMLHttpRequest;
});

afterEach(() => {
  // Qualunque cosa sia successa nel test, la scheda non è andata in rete e
  // non ha messo una pagina nella lavagna.
  expect(fetchSpy).not.toHaveBeenCalled();
  expect(xhrSpy).not.toHaveBeenCalled();
  expect(document.querySelector("iframe, frame, object, embed")).toBeNull();
  for (const image of document.querySelectorAll("img")) {
    expect(image.getAttribute("src") ?? "").toMatch(/^data:image\//);
  }
  globalThis.fetch = fetchBefore;
  globalThis.XMLHttpRequest = xhrBefore;
});

describe("webCardAddress", () => {
  it("tiene soltanto http e https con un dominio", () => {
    expect(webCardAddress(URL_PAGE)).toEqual({ href: URL_PAGE, domain: "www.esempio.it" });
    expect(webCardAddress("  http://esempio.it  ")).toEqual({ href: "http://esempio.it/", domain: "esempio.it" });
    for (const bad of ["", "esempio.it", "/relativo", "mailto:a@b.it", "javascript:alert(1)", "data:text/html,x", "ftp://esempio.it", "https://", "//esempio.it"]) {
      expect(webCardAddress(bad), bad).toBeNull();
    }
  });
});

describe("webCardIcon", () => {
  it("ammette soltanto un'immagine raster inline", () => {
    expect(webCardIcon(ICON)).toBe(ICON);
    expect(webCardIcon("https://esempio.it/favicon.ico")).toBeNull();
    expect(webCardIcon("data:image/svg+xml;base64,PHN2Zz4=")).toBeNull();
    expect(webCardIcon("")).toBeNull();
  });
});

describe("la scheda di pagina web", () => {
  it("senza anteprima: indirizzo, dominio, Apri e «Mostra l'anteprima»", () => {
    const fake = fakePort({ kind: "bare" });
    const card = mount(fake.port);
    expect(card.root().dataset.cardState).toBe("bare");
    expect(card.root().dataset.cardKind).toBe("web");
    expect(text(card.host, ".canvas-url-text")).toBe(URL_PAGE);
    expect(text(card.host, ".canvas-card-web-host")).toBe("www.esempio.it");
    expect(card.host.querySelector(".canvas-card-web-title")).toBeNull();
    expect(card.preview()?.textContent).toBe("Mostra l'anteprima");
    expect(card.preview()?.disabled).toBe(false);
    expect(card.open()?.disabled).toBe(false);
    expect(fake.requests).toEqual([]);
  });

  it("«Mostra l'anteprima» chiama `request` una volta sola, anche con due clic", () => {
    const fake = fakePort({ kind: "bare" });
    const card = mount(fake.port);
    const button = card.preview()!;
    button.click();
    button.click();
    expect(fake.requests).toEqual([URL_PAGE]);
    expect(button.disabled).toBe(true);
  });

  it("in corso: il pulsante dice «Apro…» ed è spento", () => {
    const fake = fakePort({ kind: "bare" });
    const card = mount(fake.port);
    fake.set({ kind: "loading" });
    expect(card.root().dataset.cardState).toBe("loading");
    expect(card.preview()?.disabled).toBe(true);
    expect(card.preview()?.textContent).toBe("Apro…");
    card.preview()!.click();
    expect(fake.requests).toEqual([]);
    expect(text(card.host, ".canvas-url-text")).toBe(URL_PAGE);
  });

  it("con l'anteprima: titolo, descrizione, sito, icona inline e dominio", () => {
    const fake = fakePort({
      kind: "card",
      card: { url: URL_PAGE, title: "La lavagna", description: "Come si studia", site: "Esempio", icon: ICON },
    });
    const card = mount(fake.port);
    expect(card.root().dataset.cardState).toBe("card");
    expect(text(card.host, ".canvas-card-web-title")).toBe("La lavagna");
    expect(text(card.host, ".canvas-card-web-description")).toBe("Come si studia");
    expect(text(card.host, ".canvas-card-web-site")).toBe("Esempio");
    expect(text(card.host, ".canvas-card-web-host")).toBe("www.esempio.it");
    expect(text(card.host, ".canvas-url-text")).toBe(URL_PAGE);
    expect(card.host.querySelector<HTMLImageElement>(".canvas-card-web-icon")?.getAttribute("src")).toBe(ICON);
    expect(card.preview()).toBeNull();
  });

  it("con l'anteprima: un'icona remota non si mostra, un titolo vuoto diventa l'indirizzo", () => {
    const fake = fakePort({
      kind: "card",
      card: { url: URL_PAGE, title: "", description: "", site: "www.esempio.it", icon: "https://esempio.it/favicon.png" },
    });
    const card = mount(fake.port);
    expect(card.host.querySelector("img")).toBeNull();
    expect(text(card.host, ".canvas-card-web-title")).toBe(URL_PAGE);
    expect(card.host.querySelector(".canvas-card-web-description")).toBeNull();
    // Un sito uguale al dominio non si ripete.
    expect(card.host.querySelector(".canvas-card-web-site")).toBeNull();
  });

  it("un titolo lunghissimo resta intero: lo taglia il CSS, non la scheda", () => {
    const title = "Titolo ".repeat(500).trim();
    const fake = fakePort({ kind: "card", card: { url: URL_PAGE, title, description: "", site: "", icon: "" } });
    const card = mount(fake.port);
    expect(text(card.host, ".canvas-card-web-title")).toBe(title);
  });

  it("anteprima fallita: indirizzo e dominio, niente rosso, si può chiedere di nuovo", () => {
    const fake = fakePort({ kind: "bare" });
    const card = mount(fake.port);
    card.preview()!.click();
    fake.set({ kind: "failed", reason: "Nessuna rete" });
    const root = card.root();
    expect(root.dataset.cardState).toBe("failed");
    expect(text(card.host, ".canvas-url-text")).toBe(URL_PAGE);
    expect(text(card.host, ".canvas-card-web-host")).toBe("www.esempio.it");
    expect(root.textContent).not.toContain("Nessuna rete");
    expect(root.querySelector("[class*='error'], [class*='danger'], [role='alert']")).toBeNull();
    expect(root.title).toBe("Nessuna rete");
    expect(card.preview()?.disabled).toBe(false);
    card.preview()!.click();
    expect(fake.requests).toEqual([URL_PAGE, URL_PAGE]);
  });

  it("indirizzo non valido: resta il testo, nessun pulsante, nessuna domanda alla porta", () => {
    for (const url of ["non è un indirizzo", "javascript:alert(1)", ""]) {
      const fake = fakePort({ kind: "bare" });
      const view = vi.spyOn(fake.port, "view");
      const watch = vi.spyOn(fake.port, "watch");
      const card = mount(fake.port, { url });
      expect(card.root().dataset.cardState).toBe("invalid");
      expect(text(card.host, ".canvas-url-text")).toBe(url);
      expect(card.host.querySelector("button")).toBeNull();
      expect(card.host.querySelector(".canvas-card-web-host")).toBeNull();
      expect(view).not.toHaveBeenCalled();
      expect(watch).not.toHaveBeenCalled();
      card.view.destroy();
    }
    const fake = fakePort();
    const card = mount(fake.port, { url: undefined });
    expect(text(card.host, ".canvas-url-text")).toBe("");
    expect(card.host.querySelector("button")).toBeNull();
  });

  it("Apri passa dalla porta, con l'indirizzo normalizzato", () => {
    const fake = fakePort();
    const card = mount(fake.port, { url: "https://esempio.it" });
    card.open()!.click();
    expect(fake.opened).toEqual(["https://esempio.it/"]);
  });

  it("un clic sui pulsanti non arriva alla lavagna", () => {
    const fake = fakePort();
    const card = mount(fake.port);
    const reached = vi.fn();
    card.host.addEventListener("click", reached);
    card.open()!.click();
    card.preview()!.click();
    expect(reached).not.toHaveBeenCalled();
  });

  it("ferma: inerte e senza ascolti; viva di nuovo, rilegge lo stato", () => {
    const fake = fakePort({ kind: "bare" });
    const card = mount(fake.port, { mode: "snapshot" });
    expect(card.root().inert).toBe(true);
    expect(fake.listeners.size).toBe(0);
    card.preview()!.click();
    card.open()!.click();
    expect(fake.requests).toEqual([]);
    expect(fake.opened).toEqual([]);

    fake.set({ kind: "card", card: { url: URL_PAGE, title: "Arrivata", description: "", site: "", icon: "" } });
    expect(card.host.querySelector(".canvas-card-web-title")).toBeNull();

    card.view.setMode("live");
    expect(card.root().inert).toBe(false);
    expect(fake.listeners.size).toBe(1);
    expect(text(card.host, ".canvas-card-web-title")).toBe("Arrivata");

    card.view.setMode("snapshot");
    expect(fake.listeners.size).toBe(0);
    expect(fake.unwatched.count).toBe(1);
    expect(card.root().inert).toBe(true);
    // L'ultimo stato resta in vista.
    expect(text(card.host, ".canvas-card-web-title")).toBe("Arrivata");
  });

  it("`watch` dopo `destroy`: la scheda smette di ascoltare e non tocca più niente", () => {
    const fake = fakePort({ kind: "bare" });
    const card = mount(fake.port);
    const view = vi.spyOn(fake.port, "view");
    card.view.destroy();
    expect(fake.unwatched.count).toBe(1);
    expect(fake.listeners.size).toBe(0);
    expect(card.host.childElementCount).toBe(0);
    fake.notifyEveryone();
    expect(view).not.toHaveBeenCalled();
    expect(card.host.childElementCount).toBe(0);
    card.view.setMode("snapshot");
    card.view.destroy();
    expect(fake.unwatched.count).toBe(1);
  });

  it("la vita della scheda che si chiude smonta tutto anche senza `destroy`", () => {
    const fake = fakePort({ kind: "bare" });
    const card = mount(fake.port);
    card.lifetime.close();
    expect(fake.unwatched.count).toBe(1);
    expect(card.host.childElementCount).toBe(0);
    fake.notifyEveryone();
    expect(card.host.childElementCount).toBe(0);
  });

  it("non c'è niente in cui entrare", () => {
    const card = mount(fakePort().port);
    expect(card.view.enter?.()).toBe(false);
  });

  it("dichiara la specie web", () => {
    expect(webCardRenderer(fakePort().port).kinds).toEqual(["web"]);
  });
});
