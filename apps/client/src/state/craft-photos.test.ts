// @vitest-environment happy-dom
//
// I dati di LightCraft sulle foto contro l'host finto: una domanda sola in
// volo per foto, la risposta che si dimentica quando la foto o un suo XMP
// cambia, nasce, si sposta, e quando il vault si chiude; nessuna domanda col
// componente spento o per ciò che non è una foto. Ogni caso riparte da moduli
// nuovi, perché il modulo ricorda le risposte.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FakeCraft, FakeHost } from "../host/fake";
import type { CraftXmpInfo } from "../host/craft";

const box = vi.hoisted(() => ({ host: null as FakeHost | null }));

vi.mock("../host/ipc", () => {
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

const { createFakeHost } = await import("../host/fake");

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

const FOTO = "Foto/spiaggia.jpg";
const XMP = "Foto/spiaggia.xmp";
const PDF = "Foto/guida.pdf";
const JPG = { bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), mime: "image/jpeg" };
const TEXT = { bytes: new TextEncoder().encode("<x:xmpmeta/>"), mime: "application/rdf+xml" };
const PDF_BYTES = { bytes: new TextEncoder().encode("%PDF-1.7\n"), mime: "application/pdf" };

function meta(patch: Partial<CraftXmpInfo>): CraftXmpInfo {
  return { rating: null, label: null, flag: null, keywords: [], ...patch };
}

async function boot(craft: FakeCraft | undefined, withXmp = true) {
  const resources: Record<string, { bytes: Uint8Array; mime: string }> = { [FOTO]: JPG, [PDF]: PDF_BYTES };
  if (withXmp) resources[XMP] = TEXT;
  const host = createFakeHost({ resources, craft });
  box.host = host;
  vi.resetModules();
  const store = await import("./store");
  store.state.vaultRoot = "/vault";
  store.setCommandSpecs(await host.module.api.listCommands());
  const kernel = await import("./kernel");
  const { openLifetime } = await import("../ui/lifetime");
  const photos = await import("./craft-photos");
  await kernel.startKernelRouter();
  const life = openLifetime();
  photos.mountCraftPhotos(life);
  let heard = 0;
  photos.watchPhoto(FOTO, life, () => heard++);
  return { host, photos, life, store, heard: () => heard };
}

function asked(host: FakeHost): unknown[] {
  return host.atGate("invokeCommand").map((call) => call.args);
}

beforeEach(() => {
  box.host = null;
});

describe("i dati di LightCraft sulle foto", () => {
  it("chiede craft.photo per la foto, una volta, e tiene la risposta", async () => {
    const craft: FakeCraft = { docs: { [XMP]: { info: { xmp: meta({ rating: 4, keywords: ["mare"] }) } } } };
    const { host, photos } = await boot(craft);
    const [a, b] = await Promise.all([photos.photoOf(FOTO), photos.photoOf(FOTO)]);
    expect(a).toBe(b);
    expect(a).toMatchObject({ doc: FOTO, xmp: XMP, meta: { rating: 4, keywords: ["mare"] } });
    expect(await photos.photoOf(FOTO)).toBe(a);
    expect(asked(host)).toHaveLength(1);
  });

  it("un XMP che cambia mentre la foto è aperta aggiorna la risposta", async () => {
    const craft: FakeCraft = { docs: { [XMP]: { info: { xmp: meta({ rating: 2 }) } } } };
    const { host, photos, heard } = await boot(craft);
    expect((await photos.photoOf(FOTO))?.meta?.rating).toBe(2);
    craft.docs![XMP]!.info = { xmp: meta({ rating: 5, label: "Red" }) };
    host.writeFromOutside(XMP, "<x:xmpmeta/>");
    await settle();
    expect(heard()).toBe(1);
    expect(photos.peekPhoto(FOTO)).toBeNull();
    expect((await photos.photoOf(FOTO))?.meta).toMatchObject({ rating: 5, label: "Red" });
  });

  it("un XMP creato dopo fa comparire i dati", async () => {
    const { host, photos, heard } = await boot({}, false);
    expect((await photos.photoOf(FOTO))?.xmp).toBeNull();
    host.writeFromOutside("Foto/spiaggia.jpg.xmp", "<x:xmpmeta/>");
    await settle();
    expect(heard()).toBe(1);
    expect((await photos.photoOf(FOTO))?.xmp).toBe("Foto/spiaggia.jpg.xmp");
  });

  it("un file che non è un candidato non tocca la foto", async () => {
    const { host, photos, heard } = await boot({});
    await photos.photoOf(FOTO);
    host.writeFromOutside("Foto/altra.xmp", "<x:xmpmeta/>");
    host.writeFromOutside("Foto/SPIAGGIA.xmp", "<x:xmpmeta/>");
    await settle();
    expect(heard()).toBe(0);
    expect(photos.peekPhoto(FOTO)).not.toBeNull();
  });

  it("la foto rinominata perde la risposta: il nome vecchio non ha più dati", async () => {
    const { host, photos, heard } = await boot({});
    await photos.photoOf(FOTO);
    host.renameFromOutside(FOTO, "Foto/mare.jpg");
    await settle();
    expect(heard()).toBe(1);
    expect(await photos.photoOf(FOTO)).toBeNull();
    expect((await photos.photoOf("Foto/mare.jpg"))?.xmp).toBeNull();
  });

  it("col componente spento non si chiede niente", async () => {
    const { host, photos } = await boot({ component: false });
    expect(photos.craftPhotosServed()).toBe(false);
    expect(await photos.photoOf(FOTO)).toBeNull();
    expect(asked(host)).toHaveLength(0);
  });

  it("senza il formato Craft non si chiede niente", async () => {
    const { host, photos } = await boot(undefined);
    expect(await photos.photoOf(FOTO)).toBeNull();
    expect(asked(host)).toHaveLength(0);
  });

  it("per un PDF, un audio o un XMP non si chiede niente", async () => {
    const { host, photos } = await boot({});
    expect(await photos.photoOf(PDF)).toBeNull();
    expect(await photos.photoOf("Voci/nota.m4a")).toBeNull();
    expect(await photos.photoOf(XMP)).toBeNull();
    expect(asked(host)).toHaveLength(0);
  });

  it("il componente che si accende dopo fa richiedere chi guarda", async () => {
    const { host, photos, store, heard } = await boot({ component: false });
    expect(await photos.photoOf(FOTO)).toBeNull();
    store.setCommandSpecs([
      { id: "craft.photo", title: "", description: "", keybinding: null, params: [], scope: { writes: false, reach: "session", reversible: true }, surfaces: [] },
    ]);
    expect(heard()).toBe(1);
    // Il finto resta spento: la domanda parte, e `unknown_command` vale niente.
    expect(await photos.photoOf(FOTO)).toBeNull();
    expect(asked(host)).toHaveLength(1);
  });

  it("il vault che si chiude fa dimenticare tutto, e una risposta in volo non entra", async () => {
    const { host, photos, heard } = await boot({});
    const release = host.throttle("invokeCommand");
    const late = photos.photoOf(FOTO);
    host.emit({ type: "vault_closed", root: "/vault" });
    await settle();
    expect(heard()).toBeGreaterThanOrEqual(1);
    release();
    expect(await late).toBeNull();
    expect(photos.peekPhoto(FOTO)).toBeNull();
  });

  it("una domanda partita prima che l'XMP cambi non porta la risposta vecchia", async () => {
    const craft: FakeCraft = { docs: { [XMP]: { info: { xmp: meta({ rating: 1 }) } } } };
    const { host, photos } = await boot(craft);
    const release = host.throttle("invokeCommand");
    const first = photos.photoOf(FOTO);
    craft.docs![XMP]!.info = { xmp: meta({ rating: 3 }) };
    host.writeFromOutside(XMP, "<x:xmpmeta/>");
    await settle();
    release();
    expect((await first)?.meta?.rating).toBe(3);
  });

  it("un guasto del comando rifiuta la domanda e non si tiene", async () => {
    const { host, photos } = await boot({});
    const restore = host.fault("invokeCommand", "disco");
    await expect(photos.photoOf(FOTO)).rejects.toBeDefined();
    restore();
    expect(photos.peekPhoto(FOTO)).toBeNull();
  });
});
