// Le porte risorsa dell'host finto: il contratto che il kernel promette alla
// shell — lease numerati, fette ≤ 64 KiB, CAS sulla revisione, eventi senza
// modello — e che i banchi usano per mostrare immagini vere.

import { describe, expect, it, vi } from "vitest";
import type { KernelEvent, LinkTarget } from "./contract";
import { createFakeHost } from "./fake";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

async function readAll(api: ReturnType<typeof createFakeHost>["module"]["api"], handle: string, len: number): Promise<Uint8Array> {
  const out = new Uint8Array(len);
  let offset = 0;
  while (offset < len) {
    const chunk = new Uint8Array(await api.resourceReadChunk(handle, offset, 1 << 20));
    expect(chunk.byteLength).toBeGreaterThan(0);
    expect(chunk.byteLength).toBeLessThanOrEqual(64 * 1024);
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

describe("le risorse dell'host finto", () => {
  it("apre un binario con MIME, specie e revisione, e lo serve a fette", async () => {
    const big = new Uint8Array(150_000).map((_, i) => i % 251);
    big.set(PNG);
    const { module } = createFakeHost({ resources: { "Risorse/foto.png": { bytes: big } } });
    const descriptor = await module.api.resourceOpen("Risorse/foto.png");
    expect(descriptor).toMatchObject({ id: "Risorse/foto.png", len: 150_000, mime: "image/png", kind: "image" });
    expect(descriptor.revision).toMatch(/^r\d+$/);
    expect(await readAll(module.api, descriptor.handle, descriptor.len)).toEqual(big);
    await module.api.resourceClose(descriptor.handle);
    await expect(module.api.resourceReadChunk(descriptor.handle, 0, 10)).rejects.toThrow();
  });

  it("un file di testo si apre come i suoi byte UTF-8", async () => {
    const svg = "<svg xmlns='http://www.w3.org/2000/svg'><title>è</title></svg>";
    const { module } = createFakeHost({ file: { "icona.svg": svg } });
    const descriptor = await module.api.resourceOpen("icona.svg");
    expect(descriptor).toMatchObject({ mime: "image/svg+xml", kind: "image" });
    expect(new TextDecoder().decode(await readAll(module.api, descriptor.handle, descriptor.len))).toBe(svg);
  });

  it("un id che non c'è non si apre", async () => {
    const { module } = createFakeHost({});
    await expect(module.api.resourceOpen("manca.png")).rejects.toMatchObject({ kind: "not_found" });
  });

  it("l'URL di un lease è un blob dei suoi byte, revocato alla chiusura", async () => {
    const { module } = createFakeHost({ resources: { "a.png": { bytes: PNG } } });
    const { handle } = await module.api.resourceOpen("a.png");
    const url = module.api.assetUrl(handle);
    expect(url).toMatch(/^blob:/);
    expect(module.api.assetUrl(handle)).toBe(url);
    const revoke = vi.spyOn(URL, "revokeObjectURL");
    try {
      await module.api.resourceClose(handle);
      expect(revoke).toHaveBeenCalledWith(url);
    } finally {
      revoke.mockRestore();
    }
    // Un handle che non è (più) aperto ha la forma del protocollo, e basta.
    expect(module.api.assetUrl(handle)).toBe(`fub-asset://localhost/${handle}`);
  });

  it("resourceWrite fa il CAS sulla revisione ed emette entry_changed", async () => {
    const host = createFakeHost({ file: { "icona.svg": "<svg/>" } });
    const { api } = host.module;
    const events: KernelEvent[] = [];
    await host.module.onKernelEvent((notice) => events.push(notice.event));
    const { revision } = await api.readDocument("icona.svg");

    const receipt = await api.resourceWrite("icona.svg", new TextEncoder().encode("<svg>2</svg>"), revision);
    expect(receipt.revision).not.toBe(revision);
    expect(host.files()["icona.svg"]).toBe("<svg>2</svg>");
    expect((await api.readDocument("icona.svg")).revision).toBe(receipt.revision);
    expect(events).toContainEqual({ type: "entry_changed", id: "icona.svg", kind: "asset" });

    // La revisione vecchia non scrive più: conflitto, byte intatti.
    await expect(api.resourceWrite("icona.svg", new TextEncoder().encode("vecchio"), revision))
      .rejects.toMatchObject({ kind: "conflict" });
    expect(host.files()["icona.svg"]).toBe("<svg>2</svg>");
    // `null` è «solo creazione».
    await expect(api.resourceWrite("icona.svg", new Uint8Array(), null)).rejects.toMatchObject({ kind: "already_exists" });
    await expect(api.resourceWrite("nuovo.svg", new TextEncoder().encode("<svg/>"), null)).resolves.toMatchObject({ id: "nuovo.svg" });
  });

  it("writeDocument rifiuta un file che nessun formato serve, come il kernel", async () => {
    const host = createFakeHost({ file: { "appunti.txt": "a", "Nota.md": "b" } });
    const { api } = host.module;
    const txt = await api.readDocument("appunti.txt");
    expect(txt.format_id).toBeNull();
    await expect(api.writeDocument("appunti.txt", "nuovo", { kind: "descends_from", value: txt.revision }))
      .rejects.toMatchObject({ kind: "unserved" });
    expect(host.files()["appunti.txt"]).toBe("a");
    const md = await api.readDocument("Nota.md");
    await expect(api.writeDocument("Nota.md", "c", { kind: "descends_from", value: md.revision })).resolves.toBeTruthy();
  });
});

describe("i riferimenti agli allegati nell'host finto", () => {
  it("risolve i path dalla cartella della nota e gli allegati per nome, come il kernel", async () => {
    const { module } = createFakeHost({
      file: { "Guida/Nota.md": "x", "Guida/Una nota.md": "y" },
      resources: { "Risorse/schema.png": { bytes: PNG } },
    });
    const resolve = async (target: LinkTarget, from = "Guida/Nota.md") => {
      const result = await module.api.queryIndex({ kind: "resolve", target, from });
      return result.kind === "resolved" ? result.value?.doc ?? null : "?";
    };
    expect(await resolve({ kind: "path", value: "../Risorse/schema.png" })).toBe("Risorse/schema.png");
    expect(await resolve({ kind: "path", value: "/Risorse/schema.png#dettaglio" })).toBe("Risorse/schema.png");
    expect(await resolve({ kind: "path", value: "Una%20nota.md" })).toBe("Guida/Una nota.md");
    expect(await resolve({ kind: "path", value: "Una%20nota" })).toBe("Guida/Una nota.md");
    // Relativo alla cartella della nota: `Risorse/` sotto `Guida/` non c'è.
    expect(await resolve({ kind: "path", value: "Risorse/schema.png" })).toBeNull();
    expect(await resolve({ kind: "path", value: "../../fuori.png" })).toBeNull();
    expect(await resolve({ kind: "wiki", value: { page: "schema.png", heading: null, block: null } })).toBe("Risorse/schema.png");
    expect(await resolve({ kind: "wiki", value: { page: "Una nota", heading: null, block: null } })).toBe("Guida/Una nota.md");
  });
});
