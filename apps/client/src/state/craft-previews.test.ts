// @vitest-environment happy-dom
//
// Le anteprime dei file Craft contro l'host finto: una risposta per documento
// e misura, una domanda sola in volo, il job `craft.render` che porta
// l'immagine quando finisce, e le risposte che si dimenticano
// quando il documento, il vault o il consenso cambiano. `renderPreview`, la
// sola che chiede l'anteprima all'app: una richiesta per chiave, la risposta
// in coda tenuta, `no_consent` che fa richiedere. Ogni caso riparte da moduli nuovi,
// perché il modulo ricorda le risposte.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FakeCraft, FakeHost } from "../host/fake";
import type { CraftPreview, CraftPreviewImage, CraftPreviewSize } from "../host/craft";

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

async function boot(craft: FakeCraft, craftRender?: (doc: string, size: CraftPreviewSize) => Promise<CraftPreview>) {
  const host = createFakeHost({ resources: { [LOGO]: BYTES, [SCHIZZO]: BYTES }, craft, ...(craftRender ? { craftRender } : {}) });
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

function renders(host: FakeHost): unknown[] {
  return host.atGate("craftRender").map((call) => call.args);
}

/// `craft_render` del finto: la risposta di `craft.preview` in coda.
function queuing(host: () => FakeHost) {
  return async (doc: string, size: CraftPreviewSize): Promise<CraftPreview> => {
    const outcome = await host().module.api.invokeCommand("craft.preview", { doc, size });
    return { ...(outcome.effect as { payload: CraftPreview }).payload, queued: true };
  };
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

describe("renderPreview", () => {
  const ON = { docs: { [LOGO]: { render: { app: "VectorCraft", consent: "on" as const } } } };

  it("previewOf non chiama mai craft_render; renderPreview una volta, e tiene la risposta in coda", async () => {
    const { host, previews, heard } = await boot(ON, queuing(() => box.host!));
    await previews.previewOf(LOGO, "large");
    await previews.previewOf(LOGO, "small");
    expect(renders(host)).toEqual([]);
    const answer = await previews.renderPreview(LOGO, "large");
    expect(answer?.preview.queued).toBe(true);
    expect(renders(host)).toEqual([[LOGO, "large"]]);
    expect(previews.peekPreview(LOGO, "large")).toBe(answer);
    expect(heard).toContain(LOGO);
    // Una risposta in coda non ne fa partire un'altra, e `previewOf` la trova.
    expect(await previews.renderPreview(LOGO, "large")).toBe(answer);
    expect(await previews.previewOf(LOGO, "large")).toBe(answer);
    expect(renders(host)).toHaveLength(1);
  });

  it("due richieste insieme (due riquadri) fanno una chiamata sola", async () => {
    const { host, previews } = await boot(ON, queuing(() => box.host!));
    const [a, b] = await Promise.all([previews.renderPreview(LOGO, "large"), previews.renderPreview(LOGO, "large")]);
    expect(a).toBe(b);
    expect(renders(host)).toHaveLength(1);
  });

  it("la risposta di craft.preview della stessa revisione non copre quella in coda; il job_done porta l'immagine", async () => {
    const { host, previews } = await boot(ON, queuing(() => box.host!));
    const queued = await previews.renderPreview(LOGO, "large");
    host.writeFromOutside(SCHIZZO, "{}");
    await settle();
    expect(previews.peekPreview(LOGO, "large")).toBe(queued);
    host.emit({ type: "job_done", id: "j1", job: "craft.render", result: { Ok: rendered(queued!.preview, png(8, 8)) } });
    await settle();
    expect(previews.peekPreview(LOGO, "large")?.preview.image?.width).toBe(8);
  });

  it("no_consent rifiuta e fa dimenticare le risposte: chi guarda richiede", async () => {
    const denied = { kind: "permission_denied", message: "Le anteprime fatte dalle app sono spente" };
    const { host, previews, heard } = await boot(ON, () => Promise.reject(denied));
    await previews.previewOf(LOGO, "large");
    heard.length = 0;
    await expect(previews.renderPreview(LOGO, "large")).rejects.toEqual(denied);
    expect(previews.peekPreview(LOGO, "large")).toBeNull();
    expect(heard).toEqual([""]);
    expect(renders(host)).toHaveLength(1);
  });

  it("un altro rifiuto (nessuna CLI) non tocca le risposte", async () => {
    const missing = { kind: "not_found", message: "nessuna CLI" };
    const { previews } = await boot(ON, () => Promise.reject(missing));
    const before = await previews.previewOf(LOGO, "large");
    await expect(previews.renderPreview(LOGO, "large")).rejects.toEqual(missing);
    expect(previews.peekPreview(LOGO, "large")).toBe(before);
  });

  it("il consenso che cambia fa dimenticare le risposte, tranne quelle in coda", async () => {
    const { host, previews, heard } = await boot(
      { docs: { [LOGO]: { render: { app: "VectorCraft", consent: "on" } }, [SCHIZZO]: { render: { app: "VectorCraft" } } } },
      queuing(() => box.host!),
    );
    const queued = await previews.renderPreview(LOGO, "large");
    await previews.previewOf(SCHIZZO, "large");
    heard.length = 0;
    host.emit({ type: "setting_changed", key: "craft.cli-previews", scope: "machine" });
    await settle();
    expect(heard).toEqual([""]);
    expect(previews.peekPreview(SCHIZZO, "large")).toBeNull();
    expect(previews.peekPreview(LOGO, "large")).toBe(queued);
    // Un'altra impostazione non tocca niente.
    await previews.previewOf(SCHIZZO, "large");
    heard.length = 0;
    host.emit({ type: "setting_changed", key: "craft.editor-paths", scope: "machine" });
    await settle();
    expect(heard).toEqual([]);
    expect(previews.peekPreview(SCHIZZO, "large")).not.toBeNull();
  });

  it("il vault che cambia mentre la richiesta è in volo: la risposta non entra", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const queue = queuing(() => box.host!);
    const { host, previews } = await boot(ON, async (doc, size) => {
      await gate;
      return queue(doc, size);
    });
    const pending = previews.renderPreview(LOGO, "large");
    host.emit({ type: "vault_closed", root: "/vault" });
    await settle();
    release();
    expect(await pending).toBeNull();
    expect(previews.peekPreview(LOGO, "large")).toBeNull();
  });
});
