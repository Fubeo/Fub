import { describe, expect, it } from "vitest";
import { InflateError, inflateRaw, inflateZlib } from "./inflate";

/// I byte di un base64.
const bytesOf = (base64: string): Uint8Array => Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));

const TEXT = "Ciao, mondo! àèìòù";

/// Lo stesso testo compresso da zlib: un blocco senza compressione, uno coi
/// codici fissi, e il flusso zlib.
const STORED = "ARcA6P9DaWFvLCBtb25kbyEgw6DDqMOsw7LDuQ==";
const FIXED = "c85MzNdRyM3PS8lXVDi84PCKw2sObzq8EwA=";
const ZLIB = "eJxzzkzM11HIzc9LyVdUOLzg8IrDaw5vOrwTAG8qC1U=";

const decoded = (bytes: Uint8Array): string => new TextDecoder().decode(bytes);

/// `bytes` compressi dal `CompressionStream` della piattaforma.
async function compressed(bytes: Uint8Array<ArrayBuffer>, format: "deflate" | "deflate-raw"): Promise<Uint8Array> {
  const stream = new CompressionStream(format);
  const writer = stream.writable.getWriter();
  void writer.write(bytes);
  void writer.close();
  const reader = stream.readable.getReader();
  const chunks: Uint8Array[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  const out = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0));
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.length;
  }
  return out;
}

/// Un testo lungo, che si ripete a pezzi a distanze diverse: abbastanza
/// per i blocchi coi codici dinamici, e per le distanze lunghe.
function longText(): Uint8Array<ArrayBuffer> {
  const words = ["disegno", "forma", "connettore", "etichetta", "livello", "tavola", "àèìòù", "→", "🙂"];
  const parts: string[] = [];
  let seed = 7;
  for (let i = 0; i < 40000; i++) {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    parts.push(words[seed % words.length]!);
    if (seed % 13 === 0) parts.push(String(seed));
  }
  return new TextEncoder().encode(parts.join(" "));
}

describe("inflateRaw", () => {
  it("legge un blocco senza compressione e uno coi codici fissi", () => {
    expect(decoded(inflateRaw(bytesOf(STORED), 1000))).toBe(TEXT);
    expect(decoded(inflateRaw(bytesOf(FIXED), 1000))).toBe(TEXT);
  });

  it("legge i blocchi coi codici dinamici e le distanze lunghe, com'erano", async () => {
    const text = longText();
    const raw = await compressed(text, "deflate-raw");
    // Il primo blocco ha i codici dinamici.
    expect((raw[0]! >> 1) & 3).toBe(2);
    expect(inflateRaw(raw, text.length)).toEqual(text);
  });

  it("si ferma al limite: un flusso che si allarga oltre non si legge", async () => {
    const text = longText();
    const raw = await compressed(text, "deflate-raw");
    expect(() => inflateRaw(raw, text.length - 1)).toThrow(InflateError);
    expect(() => inflateRaw(bytesOf(STORED), 5)).toThrow(InflateError);
  });

  it("non legge un flusso troncato, un tipo di blocco che non c'è, né un blocco con la lunghezza sbagliata", () => {
    const fixed = bytesOf(FIXED);
    expect(() => inflateRaw(fixed.subarray(0, fixed.length - 3), 1000)).toThrow(InflateError);
    expect(() => inflateRaw(new Uint8Array([]), 1000)).toThrow(InflateError);
    // BFINAL 1, BTYPE 3.
    expect(() => inflateRaw(new Uint8Array([0x07, 0x00]), 1000)).toThrow(InflateError);
    // Un blocco senza compressione con NLEN che non è il complemento di LEN.
    const stored = bytesOf(STORED).slice();
    stored[3] = stored[3]! ^ 0x01;
    expect(() => inflateRaw(stored, 1000)).toThrow(InflateError);
  });
});

describe("inflateZlib", () => {
  it("legge il flusso zlib di draw.io, testa e somma comprese", async () => {
    expect(decoded(inflateZlib(bytesOf(ZLIB), 1000))).toBe(TEXT);
    const text = longText();
    expect(inflateZlib(await compressed(text, "deflate"), text.length)).toEqual(text);
  });

  it("non legge ciò che non comincia come zlib, né un flusso con un dizionario", () => {
    expect(() => inflateZlib(bytesOf(FIXED), 1000)).toThrow(InflateError);
    expect(() => inflateZlib(new Uint8Array([0x78]), 1000)).toThrow(InflateError);
    // FDICT: la testa 0x78 0xbb vale, ma chiede un dizionario.
    expect(() => inflateZlib(new Uint8Array([0x78, 0xbb, 0x00, 0x00]), 1000)).toThrow(InflateError);
  });
});
