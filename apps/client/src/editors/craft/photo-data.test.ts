// @vitest-environment happy-dom
//
// La riga dei dati di LightCraft sotto una foto: ogni campo che manca, l'XMP
// vuoto o rotto, la foto senza XMP, 500 parole chiave tutte nella lista, il
// voto -1, i clic sui tag e su «Apri l'XMP», il nome della `section`; poi la
// riga viva, che segue l'XMP che cambia.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CraftPhotoSidecar, CraftXmpInfo } from "../../host/craft";
import type { FakeHost } from "../../host/fake";

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
const { mountPhotoData } = await import("./photo-data");
const { openLifetime } = await import("../../ui/lifetime");

const FOTO = "Foto/spiaggia.jpg";
const XMP = "Foto/spiaggia.xmp";

function meta(patch: Partial<CraftXmpInfo> = {}): CraftXmpInfo {
  return { rating: null, label: null, flag: null, keywords: [], ...patch };
}

function sidecar(info: CraftXmpInfo | null, xmp: string | null = XMP): CraftPhotoSidecar {
  return { version: 2, doc: FOTO, xmp, meta: info, edits: [] };
}

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

let root: HTMLElement;
let opened: string[];
let searched: string[];
const deps = {
  onOpenDocument: (doc: string) => void opened.push(doc),
  onSearchTag: (tag: string) => void searched.push(tag),
};

function mount(value: CraftPhotoSidecar) {
  const life = openLifetime();
  const section = mountPhotoData(root, value, deps, life);
  return { life, section };
}

function line(): HTMLElement {
  return root.querySelector<HTMLElement>(".photo-data-line")!;
}

beforeEach(() => {
  root = document.createElement("div");
  document.body.append(root);
  opened = [];
  searched = [];
});

afterEach(() => {
  root.remove();
});

describe("la riga dei dati di LightCraft", () => {
  it("con tutti i campi: stelle, etichetta, scelta, «Apri l'XMP» e le parole chiave", () => {
    const { section } = mount(sidecar(meta({ rating: 3, label: "Red", flag: "pick", keywords: ["mare", "estate"] })));
    expect(section?.tagName).toBe("SECTION");
    expect(section?.getAttribute("aria-label")).toBe("Dati di LightCraft");
    const stars = line().querySelector(".craft-xmp-stars")!;
    expect(stars.getAttribute("role")).toBe("img");
    expect([...stars.querySelectorAll<HTMLElement>(".craft-xmp-star")].map((s) => s.dataset.on)).toEqual(["true", "true", "true", "false", "false"]);
    const label = line().querySelector<HTMLElement>(".craft-xmp-label")!;
    expect(label.dataset.color).toBe("red");
    expect(label.querySelector(".sr-only")?.textContent).toBe("Etichetta: ");
    expect(label.textContent).toBe("Etichetta: Rossa");
    expect(line().textContent).toContain("Scelta");
    expect(line().querySelector(".photo-data-open.link-button")?.textContent).toBe("Apri l'XMP");
    const tags = root.querySelector("ul.craft-xmp-tags.photo-data-tags")!;
    expect(tags.parentElement).toBe(section);
    expect([...tags.querySelectorAll("button")].map((b) => b.textContent)).toEqual(["#mare", "#estate"]);
  });

  it("ogni campo che manca non lascia il suo posto", () => {
    mount(sidecar(meta({ label: "Blue" })));
    expect(line().querySelector(".craft-xmp-stars")).toBeNull();
    expect(line().querySelector(".craft-xmp-label")).not.toBeNull();
    expect(line().textContent).not.toContain("Scelta");
    expect(root.querySelector(".photo-data-tags")).toBeNull();
    root.replaceChildren();

    mount(sidecar(meta({ rating: 5 })));
    expect(line().querySelector(".craft-xmp-stars")).not.toBeNull();
    expect(line().querySelector(".craft-xmp-label")).toBeNull();
    root.replaceChildren();

    mount(sidecar(meta({ flag: "reject" })));
    expect(line().children).toHaveLength(2);
    expect(line().textContent).toContain("Scartata");
    root.replaceChildren();

    mount(sidecar(meta({ keywords: ["mare"] })));
    expect(line().children).toHaveLength(1);
    expect(root.querySelector(".craft-xmp-absent")).toBeNull();
    expect(root.querySelectorAll(".photo-data-tags li")).toHaveLength(1);
  });

  it("l'XMP vuoto lo dice, con «Apri l'XMP»", () => {
    mount(sidecar(meta()));
    expect(line().querySelector(".craft-xmp-absent")?.textContent).toBe("L'XMP non ha voto, etichetta, scelta né parole chiave");
    expect(line().querySelector(".photo-data-open")).not.toBeNull();
  });

  it("l'XMP rotto lo dice, con «Apri l'XMP»", () => {
    mount(sidecar(null));
    expect(line().querySelector(".craft-xmp-absent")?.textContent).toBe("I dati dell'XMP non si leggono");
    expect(line().querySelector(".photo-data-open")).not.toBeNull();
    expect(root.querySelector(".craft-xmp-stars")).toBeNull();
  });

  it("una foto senza XMP non ha la riga", () => {
    const { section } = mount(sidecar(null, null));
    expect(section).toBeNull();
    expect(root.childElementCount).toBe(0);
  });

  it("il voto -1 si legge «Scartata», senza stelle", () => {
    mount(sidecar(meta({ rating: -1 })));
    expect(line().querySelector(".craft-xmp-stars")).toBeNull();
    expect(line().firstElementChild?.textContent).toBe("Scartata");
  });

  it("un'etichetta che il catalogo non conosce si mostra com'è", () => {
    mount(sidecar(meta({ label: "Da rivedere" })));
    const label = line().querySelector<HTMLElement>(".craft-xmp-label")!;
    expect(label.dataset.color).toBeUndefined();
    expect(label.textContent).toBe("Etichetta: Da rivedere");
  });

  it("500 parole chiave, tutte nella lista", () => {
    const keywords = Array.from({ length: 500 }, (_, i) => `parola${i}`);
    mount(sidecar(meta({ keywords })));
    const items = root.querySelectorAll(".photo-data-tags li");
    expect(items).toHaveLength(500);
    expect(items[499]?.textContent).toBe("#parola499");
  });

  it("un clic su una parola chiave cerca il tag", () => {
    mount(sidecar(meta({ keywords: ["mare", "tramonto"] })));
    root.querySelectorAll<HTMLButtonElement>(".photo-data-tags button")[1]!.click();
    expect(searched).toEqual(["tramonto"]);
  });

  it("«Apri l'XMP» apre l'XMP", () => {
    mount(sidecar(meta({ rating: 2 })));
    const open = root.querySelector<HTMLButtonElement>(".photo-data-open")!;
    expect(open.title).toBe(`Apri ${XMP}`);
    open.click();
    expect(opened).toEqual([XMP]);
  });

  it("la riga se ne va con la sua vita, e i clic con lei", () => {
    const { life } = mount(sidecar(meta({ keywords: ["mare"] })));
    const tag = root.querySelector<HTMLButtonElement>(".photo-data-tags button")!;
    life.close();
    expect(root.querySelector(".photo-data")).toBeNull();
    tag.click();
    expect(searched).toEqual([]);
  });
});

describe("la riga viva sotto la foto", () => {
  async function live(withXmp: boolean) {
    const craft = { docs: { [XMP]: { info: { xmp: meta({ rating: 2 }) } } } };
    const resources: Record<string, { bytes: Uint8Array; mime: string }> = {
      [FOTO]: { bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), mime: "image/jpeg" },
    };
    if (withXmp) resources[XMP] = { bytes: new TextEncoder().encode("<x:xmpmeta/>"), mime: "application/rdf+xml" };
    const host = createFakeHost({ resources, craft });
    box.host = host;
    vi.resetModules();
    const store = await import("../../state/store");
    store.state.vaultRoot = "/vault";
    store.setCommandSpecs(await host.module.api.listCommands());
    const kernel = await import("../../state/kernel");
    const photos = await import("../../state/craft-photos");
    const view = await import("./photo-data");
    const lifetime = await import("../../ui/lifetime");
    await kernel.startKernelRouter();
    const window = lifetime.openLifetime();
    photos.mountCraftPhotos(window);
    const life = lifetime.openLifetime();
    view.showPhotoData(root, FOTO, deps, life);
    await settle();
    return { host, craft, life };
  }

  it("un XMP che cambia mentre la foto è aperta aggiorna la riga", async () => {
    const { host, craft } = await live(true);
    expect(root.querySelectorAll(".craft-xmp-star[data-on='true']")).toHaveLength(2);
    craft.docs[XMP]!.info = { xmp: meta({ rating: 4, keywords: ["mare"] }) };
    host.writeFromOutside(XMP, "<x:xmpmeta/>");
    await settle();
    await settle();
    expect(root.querySelectorAll(".photo-data")).toHaveLength(1);
    expect(root.querySelectorAll(".craft-xmp-star[data-on='true']")).toHaveLength(4);
    expect(root.querySelector(".photo-data-tags")?.textContent).toBe("#mare");
  });

  it("un XMP creato dopo fa comparire la riga; tolto, la riga se ne va", async () => {
    const { host } = await live(false);
    expect(root.querySelector(".photo-data")).toBeNull();
    host.writeFromOutside(XMP, "<x:xmpmeta/>");
    await settle();
    await settle();
    expect(root.querySelector(".photo-data")).not.toBeNull();
    host.renameFromOutside(XMP, "Altrove/spiaggia.xmp");
    await settle();
    await settle();
    expect(root.querySelector(".photo-data")).toBeNull();
  });

  it("la vita che chiude toglie la riga e non ridisegna più", async () => {
    const { host, craft, life } = await live(true);
    life.close();
    expect(root.querySelector(".photo-data")).toBeNull();
    craft.docs[XMP]!.info = { xmp: meta({ rating: 5 }) };
    host.writeFromOutside(XMP, "<x:xmpmeta/>");
    await settle();
    expect(root.querySelector(".photo-data")).toBeNull();
  });
});
