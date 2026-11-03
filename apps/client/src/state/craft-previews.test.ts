// @vitest-environment happy-dom
//
// Le anteprime dei file Craft contro l'host finto: una risposta per documento
// e misura, una domanda sola in volo, il job `craft.render` che porta
// l'immagine quando finisce, e le risposte che si dimenticano
// quando il documento o il vault cambiano. Ogni caso riparte da moduli nuovi,
// perché il modulo ricorda le risposte.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FakeCraft, FakeHost } from "../host/fake";
import type { CraftPreview, CraftPreviewImage } from "../host/craft";

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

/// Un PNG di `width`×`height` in base64: la firma e l'intestazione bastano.
function png(width: number, height: number): CraftPreviewImage {
  const bytes = new Uint8Array(33);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return { media_type: "image/png", data: btoa(String.fromCharCode(...bytes)), width, height, orientation: 1 };
}

/// L'anteprima che il job `craft.render` consegna per `preview`: l'immagine
/// fatta dall'app.
function rendered(preview: CraftPreview, image: CraftPreviewImage): CraftPreview {
  return { ...preview, origin: "cli", image, missing: null, render: null };
}

const LOGO = "Disegni/logo.vectorcraft";
const SCHIZZO = "Disegni/schizzo.vectorcraft";
const BYTES = { bytes: new Uint8Array([0x7b, 0x7d, 0xff]), mime: "application/octet-stream" };

async function boot(craft: FakeCraft) {
  const host = createFakeHost({ resources: { [LOGO]: BYTES, [SCHIZZO]: BYTES }, craft });
  box.host = host;
  vi.resetModules();
  const store = await import("./store");
  store.state.vaultRoot = "/vault";
  const kernel = await import("./kernel");
  const { openLifetime } = await import("../ui/lifetime");
  const previews = await import("./craft-previews");
  await kernel.startKernelRouter();
  const life = openLifetime();
  previews.mountCraftPreviews(life);
  const heard: string[] = [];
  previews.watchCraftPreviews(life, (doc) => heard.push(doc));
  return { host, previews, life, heard, store };
}

function asked(host: FakeHost): unknown[] {
  return host.atGate("invokeCommand").map((call) => call.args);
}

beforeEach(() => {
  box.host = null;
});

describe("le anteprime dei file Craft", () => {
  it("chiede craft.preview col vault, e la seconda volta risponde la risposta tenuta", async () => {
    const { host, previews } = await boot({ docs: { [LOGO]: { image: png(4, 3), info: { format_version: "4" } } } });
    const first = await previews.previewOf(LOGO, "large");
    expect(first?.preview.origin).toBe("file");
    expect(first?.preview.image?.width).toBe(4);
    expect(first?.preview.info.format_version).toBe("4");
    // Soltanto `doc` e `size`: la shell non chiede mai di fare l'anteprima.
    expect(asked(host)).toEqual([["craft.preview", { doc: LOGO, size: "large" }, "apply", "/vault"]]);
    expect(await previews.previewOf(LOGO, "large")).toBe(first);
    // Un'altra misura è un'altra risposta.
    await previews.previewOf(LOGO, "small");
    expect(asked(host)).toHaveLength(2);
  });

  it("tiene una domanda sola in volo per chiave", async () => {
    const { host, previews } = await boot({});
    const release = host.throttle("invokeCommand");
    const one = previews.previewOf(LOGO, "large");
    const two = previews.previewOf(LOGO, "large");
    expect(two).toBe(one);
    release();
    await one;
    expect(asked(host)).toHaveLength(1);
  });

  it("un job_done di craft.render porta l'immagine, e chi richiede la trova senza chiedere", async () => {
    const { host, previews, heard } = await boot({ docs: { [LOGO]: { render: { app: "VectorCraft", consent: "ask" } } } });
    const plain = await previews.previewOf(LOGO, "large");
    expect(plain?.preview.render).toEqual({ app: "VectorCraft", consent: "ask" });
    expect(plain?.preview.queued).toBe(false);
    expect(plain?.preview.missing).toBe("absent");
    host.emit({ type: "job_done", id: "j1", job: "craft.render", result: { Ok: rendered(plain!.preview, png(8, 8)) } });
    await settle();
    expect(heard).toContain(LOGO);
    const done = previews.peekPreview(LOGO, "large");
    expect(done?.preview.origin).toBe("cli");
    expect(done?.preview.image?.width).toBe(8);
    const calls = asked(host).length;
    expect((await previews.previewOf(LOGO, "large"))?.preview.image?.width).toBe(8);
    expect(asked(host)).toHaveLength(calls);
  });

  it("un job_done di un altro documento non tocca questo", async () => {
    const { host, previews, heard } = await boot({});
    await previews.previewOf(LOGO, "large");
    const other = await previews.previewOf(SCHIZZO, "large");
    host.emit({ type: "job_done", id: "j1", job: "craft.render", result: { Ok: rendered(other!.preview, png(2, 2)) } });
    await settle();
    expect(heard).toEqual([SCHIZZO]);
    expect(previews.peekPreview(LOGO, "large")?.preview.image).toBeNull();
    expect(asked(host)).toHaveLength(2);
  });

  it("un job finito male non tocca un'anteprima che non aspettava", async () => {
    const error = { kind: "unserved" as const, message: "Nessuna app Craft installata può fare l'anteprima." };
    const { host, previews, heard } = await boot({});
    const before = await previews.previewOf(LOGO, "large");
    host.emit({ type: "job_done", id: "j1", job: "craft.render", result: { Err: error } });
    await settle();
    expect(heard).toEqual([]);
    expect(previews.peekPreview(LOGO, "large")).toBe(before);
    expect(before?.renderError).toBeNull();
  });

  it("una risposta senza revisione vale per ogni revisione chiesta", async () => {
    const { host, previews } = await boot({ docs: { [LOGO]: { revision: null } } });
    const first = await previews.previewOf(LOGO, "large");
    expect(first?.preview.revision).toBeNull();
    expect(await previews.previewOf(LOGO, "large", { revision: "qualunque" })).toBe(first);
    expect(asked(host)).toHaveLength(1);
  });

  it("un documento che cambia perde le sue risposte e lo dice; la domanda dopo legge la revisione nuova", async () => {
    const { host, previews, heard } = await boot({});
    const before = await previews.previewOf(LOGO, "large");
    host.writeFromOutside(LOGO, "{}");
    await settle();
    expect(heard).toContain(LOGO);
    expect(previews.peekPreview(LOGO, "large")).toBeNull();
    const after = await previews.previewOf(LOGO, "large");
    expect(after?.preview.revision).not.toBe(before?.preview.revision);
  });

  it("una revisione diversa da quella chiesta non basta", async () => {
    const { host, previews } = await boot({});
    const first = await previews.previewOf(LOGO, "large");
    await previews.previewOf(LOGO, "large", { revision: first!.preview.revision! });
    expect(asked(host)).toHaveLength(1);
    await previews.previewOf(LOGO, "large", { revision: "altra" });
    expect(asked(host)).toHaveLength(2);
  });

  it("il vault che si chiude fa dimenticare tutto, e una risposta in volo non entra", async () => {
    const { host, previews, heard } = await boot({});
    await previews.previewOf(LOGO, "large");
    const release = host.throttle("invokeCommand");
    const late = previews.previewOf(SCHIZZO, "large");
    host.emit({ type: "vault_closed", root: "/vault" });
    await settle();
    expect(heard).toEqual([""]);
    expect(previews.peekPreview(LOGO, "large")).toBeNull();
    release();
    expect(await late).toBeNull();
    expect(previews.peekPreview(SCHIZZO, "large")).toBeNull();
  });

  it("un guasto del comando rifiuta la domanda e non si tiene", async () => {
    const { previews } = await boot({ component: false });
    await expect(previews.previewOf(LOGO, "large")).rejects.toMatchObject({ kind: "unknown_command" });
    expect(previews.peekPreview(LOGO, "large")).toBeNull();
  });

  it("legge l'esito del job e l'effetto del comando solo nella forma del contratto", async () => {
    const { previews } = await boot({});
    expect(previews.readRenderDone({ Err: { kind: "unserved", message: "no" } })).toEqual({ error: { kind: "unserved", message: "no" } });
    expect(previews.readRenderDone({ Ok: { version: 2 } })).toBeNull();
    expect(previews.readRenderDone(null)).toBeNull();
    expect(previews.readPreviewOutcome({ notify: null, effect: { kind: "done" }, undo: null } as never)).toBeNull();
    expect(previews.readPreviewOutcome({ notify: null, effect: { kind: "custom", ns: "altro", payload: {} }, undo: null } as never)).toBeNull();
  });

  it("chiusa la vita del montaggio, chi guardava non sente più niente", async () => {
    const { host, previews, life, heard } = await boot({});
    await previews.previewOf(LOGO, "large");
    life.close();
    host.writeFromOutside(LOGO, "{}");
    await settle();
    expect(heard).toEqual([]);
  });
});
