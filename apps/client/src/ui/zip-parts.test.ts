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

  it("un campo esteso più lungo del suo spazio si rifiuta con un errore leggibile", async () => {
    // Una voce ZIP64 il cui campo esteso dichiara 24 byte ma nella voce ne
    // restano 8: prima la lettura usciva dalla directory con un RangeError.
    const source = await zip([{ name: "a.md", body: text("# a\n"), zip64: true }]);
    const view = new DataView(source.buffer);
    const eocd = source.length - 22;
    const directoryStart = view.getUint32(eocd + 16, true);
    const extraStart = directoryStart + 46 + view.getUint16(directoryStart + 28, true);
    const cut = 16;
    const broken = new Uint8Array(source.length - cut);
    broken.set(source.subarray(0, extraStart + 12));
    broken.set(source.subarray(extraStart + 12 + cut), extraStart + 12);
    const brokenView = new DataView(broken.buffer);
    brokenView.setUint16(directoryStart + 30, 12, true);
    brokenView.setUint32(broken.length - 22 + 12, view.getUint32(eocd + 12, true) - cut, true);
    const error = await readDirectory(new Blob([broken])).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(RangeError);
    expect((error as Error).message).toMatch(/^ZIP: .*a\.md/);
  });

  it("una firma di fine archivio dentro il commento non inganna la ricerca", async () => {
    // Il commento finale contiene una finta fine dell'archivio (zero voci),
    // seguita da due byte: è lei la prima che si incontra cercando
    // all'indietro, ma la sua lunghezza del commento non porta alla fine
    // del file.
    const source = await zip([{ name: "a.md", body: text("# a\n") }]);
    const comment = new Uint8Array(24);
    new DataView(comment.buffer).setUint32(0, 0x06054b50, true);
    comment[22] = 0x78;
    comment[23] = 0x78;
    const withComment = new Uint8Array(source.length + comment.length);
    withComment.set(source);
    withComment.set(comment, source.length);
    new DataView(withComment.buffer).setUint16(source.length - 2, comment.length, true);
    const entries = await readDirectory(new Blob([withComment]));
    expect(entries.map((entry) => entry.name)).toEqual(["a.md"]);
  });

  it("un archivio con byte in più dopo la fine si legge ancora", async () => {
    // Alcuni programmi lasciano byte dopo la fine dell'archivio: nessun
    // candidato porta esattamente alla fine del file, e vale il primo.
    const source = await zip([{ name: "a.md", body: text("# a\n") }]);
    const padded = new Uint8Array(source.length + 3);
    padded.set(source);
    const entries = await readDirectory(new Blob([padded]));
    expect(entries.map((entry) => entry.name)).toEqual(["a.md"]);
  });
});
