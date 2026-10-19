import { describe, expect, it } from "vitest";
import { crc32, transform, zip, type Item } from "../__fixtures__/zip";
import { buildPart, partName, planParts, readDirectory, type PartLimits } from "./zip-parts";

const text = (value: string) => new TextEncoder().encode(value);

/// Le voci di un archivio riletto, coi corpi decompressi.
async function contents(bytes: Uint8Array<ArrayBuffer>): Promise<Map<string, string>> {
  const blob = new Blob([bytes]);
  const out = new Map<string, string>();
  for (const entry of await readDirectory(blob)) {
    const raw = new Uint8Array(await blob.slice(entry.offset, entry.end).arrayBuffer());
    const view = new DataView(raw.buffer);
    const start = 30 + view.getUint16(26, true) + view.getUint16(28, true);
    const data = raw.subarray(start, start + entry.compressed);
    const body = entry.method === 8 ? await transform(data, new DecompressionStream("deflate-raw")) : data;
    expect(crc32(body)).toBe(entry.crc);
    out.set(entry.name, new TextDecoder().decode(body));
  }
  return out;
}

const small: PartLimits = { bytes: 600, entries: 3, inflated: 10_000, entry: 2_000 };

describe("un archivio diviso in parti", () => {
  it("legge la directory con descrittori, ZIP64 e nomi UTF-8", async () => {
    const entries = await readDirectory(
      new Blob([
        await zip([
          { name: "Note/a.md", body: text("# a\n") },
          { name: "Note/è.md", body: text("# è\n".repeat(40)), deflate: true, descriptor: true },
          { name: "big.md", body: text("x".repeat(100)), zip64: true },
        ]),
      ]),
    );
    expect(entries.map((entry) => [entry.name, entry.size])).toEqual([
      ["Note/a.md", 4],
      ["Note/è.md", 200],
      ["big.md", 100],
    ]);
  });

  it("ogni parte resta sotto i tetti, e insieme portano ogni voce identica", async () => {
    const items: Item[] = Array.from({ length: 10 }, (_, index) => ({
      name: `Diario/${index}.md`,
      body: text(`# giorno ${index}\n`.repeat(index + 1)),
      deflate: index % 2 === 0,
      descriptor: index % 3 === 0,
    }));
    items.splice(4, 0, { name: "Diario/", body: new Uint8Array() });
    const source = await zip(items);
    const blob = new Blob([source]);
    const { parts, oversized } = planParts(await readDirectory(blob), small);
    expect(oversized).toEqual([]);
    expect(parts.length).toBeGreaterThan(3);
    const seen = new Map<string, string>();
    for (const part of parts) {
      expect(part.length).toBeLessThanOrEqual(small.entries);
      const bytes = await buildPart(blob, part);
      expect(bytes.length).toBeLessThanOrEqual(small.bytes);
      for (const [name, body] of await contents(bytes)) seen.set(name, body);
    }
    const original = await contents(source);
    original.delete("Diario/");
    expect(seen).toEqual(original);
  });

  it("una voce troppo grande non entra in nessuna parte, e lo si sa", async () => {
    const blob = new Blob([
      await zip([
        { name: "a.md", body: text("a") },
        { name: "video.bin", body: new Uint8Array(3_000) },
        { name: "b.md", body: text("b") },
      ]),
    ]);
    const { parts, oversized } = planParts(await readDirectory(blob), small);
    expect(oversized.map((entry) => entry.name)).toEqual(["video.bin"]);
    // Le voci attorno a quella saltata restano in una parte sola, e si
    // leggono senza portarsi dietro i suoi byte.
    expect(parts.map((part) => part.map((entry) => entry.name))).toEqual([["a.md", "b.md"]]);
    expect([...(await contents(await buildPart(blob, parts[0]!))).keys()]).toEqual(["a.md", "b.md"]);
  });

  it("ciò che non è uno ZIP si rifiuta, e una parte resta un .zip", async () => {
    await expect(readDirectory(new Blob([text("non sono un archivio, solo testo lungo abbastanza")]))).rejects.toThrow(/ZIP/);
    expect(partName("Export Notion.zip", "parte 2 di 5")).toBe("Export Notion (parte 2 di 5).zip");
  });
});
